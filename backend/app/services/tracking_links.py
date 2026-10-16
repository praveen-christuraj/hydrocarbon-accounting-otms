"""
Sender -> receiver ticket links for tracking modules (Barge / Tanker).

When a receiver acknowledges an approved sender ticket and creates his own
ticket against it, the receiver ticket stores the sender ticket id in an
operation transaction value (field_code ``linked_ticket_id``). No table
structure changes are needed for this link.

Rules enforced on the server (not only in the UI):

  * the sender ticket must be Approved (correction hold respected) and belong
    to a convoy;
  * the sender ticket must be a SENDER ticket of its tracking module when that
    module is configured (Tracking Module Configuration);
  * one sender ticket can have only one active receiver ticket (Cancelled
    receiver tickets do not count);
  * origin, destination, sender and receiver locations (and the convoy) of the
    receiver ticket are taken from the sender ticket, whatever the client sent.
"""

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.dependencies.permissions import user_has_location_access
from app.models import OperationTransaction, OperationTransactionValue, User
from app.services.tracking_config import (
    MODULE_BARGE,
    MODULE_TANKER,
    ROLE_RECEIVER,
    ROLE_SENDER,
    TRACKING_MODULES,
    configured_operation_type_code_list,
    configured_role_for_transaction,
    get_active_config_row,
    is_ticket_captured,
    module_is_configured,
    receiving_config_rows,
)
from app.services.transaction_helpers import require_approved_transaction_for_tracking
from app.utils.helpers import clean_optional_text, get_transaction_ticket_number

LINKED_TICKET_FIELD_CODE = "linked_ticket_id"
LINKED_TICKET_FIELD_NAME = "Linked Sender Ticket"
INACTIVE_LINK_STATUSES = {"Cancelled"}


def _parse_int(value):
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def get_linked_sender_transaction_id(db: Session, transaction_id: int | None):
    """Sender ticket id stored on a receiver ticket, or None."""
    if transaction_id is None:
        return None
    row = (
        db.query(OperationTransactionValue)
        .filter(
            OperationTransactionValue.transaction_id == transaction_id,
            OperationTransactionValue.field_code == LINKED_TICKET_FIELD_CODE,
        )
        .first()
    )
    return _parse_int(row.field_value) if row else None


def get_receiver_links_for_convoy(db: Session, convoy_number: str | None):
    """
    {sender_transaction_id: receiver OperationTransaction} for every active
    receiver ticket of a convoy.
    """
    convoy = clean_optional_text(convoy_number)
    if convoy is None:
        return {}

    rows = (
        db.query(OperationTransactionValue, OperationTransaction)
        .join(
            OperationTransaction,
            OperationTransaction.id == OperationTransactionValue.transaction_id,
        )
        .filter(
            OperationTransactionValue.field_code == LINKED_TICKET_FIELD_CODE,
            OperationTransaction.convoy_number.ilike(convoy),
            OperationTransaction.status.notin_(list(INACTIVE_LINK_STATUSES)),
        )
        .order_by(OperationTransaction.id.asc())
        .all()
    )

    links = {}
    for value_row, receiver_tx in rows:
        sender_id = _parse_int(value_row.field_value)
        if sender_id is not None and sender_id not in links:
            links[sender_id] = receiver_tx
    return links


def find_active_receiver_for_sender(
    db: Session,
    sender_transaction_id: int,
    convoy_number: str | None,
    exclude_transaction_id: int | None = None,
):
    receiver = get_receiver_links_for_convoy(db, convoy_number).get(sender_transaction_id)
    if receiver is not None and receiver.id == exclude_transaction_id:
        return None
    return receiver


def set_linked_sender_value(db: Session, transaction_id: int, sender_transaction_id: int):
    """Store (or replace) the sender link on a receiver ticket."""
    db.query(OperationTransactionValue).filter(
        OperationTransactionValue.transaction_id == transaction_id,
        OperationTransactionValue.field_code == LINKED_TICKET_FIELD_CODE,
    ).delete()

    db.add(
        OperationTransactionValue(
            transaction_id=transaction_id,
            field_code=LINKED_TICKET_FIELD_CODE,
            field_name=LINKED_TICKET_FIELD_NAME,
            field_group="Tracking",
            data_type="Number",
            unit=None,
            input_mode="System",
            calculation_role="Reference",
            field_value=int(sender_transaction_id),
            sort_order=9999,
        )
    )


def linked_location_overrides(sender: OperationTransaction) -> dict:
    """
    Locations a receiver ticket inherits from the approved sender ticket.

    The receiving terminal (the sender's receiver / destination) becomes the
    origin of the receiver ticket, so the receiver's own location scope and
    location availability checks apply to the terminal that really receives.
    """
    receiving = (
        clean_optional_text(sender.receiver_location_code)
        or clean_optional_text(sender.destination_location_code)
        or clean_optional_text(sender.origin_location_code)
    )
    return {
        "origin_location_code": receiving,
        "destination_location_code": (
            clean_optional_text(sender.destination_location_code) or receiving
        ),
        "sender_location_code": (
            clean_optional_text(sender.sender_location_code)
            or clean_optional_text(sender.origin_location_code)
        ),
        "receiver_location_code": (
            clean_optional_text(sender.receiver_location_code)
            or clean_optional_text(sender.destination_location_code)
            or receiving
        ),
        "convoy_number": clean_optional_text(sender.convoy_number),
    }


def sender_module_code(db: Session, sender: OperationTransaction):
    """Tracking module the sender ticket belongs to, or None when unknown."""
    from app.services.tracking_helpers import is_barge_transaction

    if is_barge_transaction(db, sender):
        return MODULE_BARGE
    if is_ticket_captured(db, MODULE_TANKER, sender):
        return MODULE_TANKER
    return None


def barge_receipt_acknowledged(db: Session, convoy_number: str | None, asset_code: str | None) -> bool:
    """
    True when the latest RECEIVED / RECEIPT_REVOKED trip event for this barge
    on this convoy is RECEIVED (receiver acknowledged arrival).
    """
    from app.models import Trip, TripEvent

    convoy = clean_optional_text(convoy_number)
    asset = clean_optional_text(asset_code)
    if convoy is None or asset is None:
        return False
    trip = db.query(Trip).filter(Trip.convoy_number.ilike(convoy)).first()
    if trip is None:
        return False
    latest = (
        db.query(TripEvent)
        .filter(
            TripEvent.trip_id == trip.id,
            TripEvent.asset_code.ilike(asset),
            TripEvent.event_type.in_(["RECEIVED", "RECEIPT_REVOKED"]),
        )
        .order_by(TripEvent.sequence_no.desc(), TripEvent.id.desc())
        .first()
    )
    return latest is not None and str(latest.event_type).upper() == "RECEIVED"


def validate_linked_sender_ticket(
    db: Session,
    sender_transaction_id: int,
    current_user: User,
    requested_convoy_number: str | None = None,
    exclude_transaction_id: int | None = None,
):
    """
    Validate that a receiver ticket may be created against a sender ticket.

    Returns (sender_transaction, module_code, overrides). Raises HTTPException.
    """
    sender = (
        db.query(OperationTransaction)
        .filter(OperationTransaction.id == sender_transaction_id)
        .first()
    )
    if sender is None:
        raise HTTPException(status_code=404, detail="Linked sender ticket not found")

    require_approved_transaction_for_tracking(
        sender, "creating a receiving ticket", db=db
    )

    if clean_optional_text(sender.convoy_number) is None:
        raise HTTPException(
            status_code=400,
            detail="The linked sender ticket has no convoy number. Only convoy tickets can be received.",
        )

    requested = clean_optional_text(requested_convoy_number)
    if requested is not None and requested.lower() != str(sender.convoy_number).strip().lower():
        raise HTTPException(
            status_code=400,
            detail="Convoy number must match the linked sender ticket",
        )

    if get_linked_sender_transaction_id(db, sender.id) is not None:
        # A receiving ticket is never a sender ticket, whatever role its
        # operation type is mapped with. This is the Barge Tracking case: the
        # same operation type is used by both sides, so the link (and not the
        # configured role) tells the two apart.
        raise HTTPException(
            status_code=400,
            detail=(
                f"Ticket {get_transaction_ticket_number(sender)} is itself a receiving ticket. "
                "Only a sender ticket can be received."
            ),
        )

    module_code = sender_module_code(db, sender)
    if module_code is None:
        if any(module_is_configured(db, code) for code in TRACKING_MODULES):
            raise HTTPException(
                status_code=400,
                detail=(
                    "The linked sender ticket's operation type is not mapped to any tracking "
                    "module. Configure it in Tracking Module Configuration first."
                ),
            )
    else:
        # Tanker Tracking has a dedicated sending operation type. Barge
        # Tracking uses one operation type for both sides, so its role is only
        # a nominal one and must not block the receiving side.
        if module_code != MODULE_BARGE and module_is_configured(db, module_code):
            role = configured_role_for_transaction(db, module_code, sender)
            if role != ROLE_SENDER:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Ticket {get_transaction_ticket_number(sender)} is not a sender ticket for "
                        f"{TRACKING_MODULES.get(module_code, module_code)}. Only sender tickets can be received."
                    ),
                )

    if not user_has_location_access(current_user, db, sender.origin_location_code) and not any(
        user_has_location_access(current_user, db, code)
        for code in (
            sender.destination_location_code,
            sender.sender_location_code,
            sender.receiver_location_code,
        )
    ):
        raise HTTPException(
            status_code=403,
            detail="The linked sender ticket does not involve any location in your assigned scope.",
        )

    if module_code == MODULE_BARGE and not barge_receipt_acknowledged(
        db, sender.convoy_number, sender.primary_asset_code
    ):
        raise HTTPException(
            status_code=400,
            detail=(
                f"Acknowledge receipt of barge {sender.primary_asset_code} on the Barge Tracking "
                "page before creating a receiving ticket for it."
            ),
        )

    active_receiver = find_active_receiver_for_sender(
        db, sender.id, sender.convoy_number, exclude_transaction_id
    )
    if active_receiver is not None:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Ticket {get_transaction_ticket_number(sender)} already has a receiving ticket "
                f"({get_transaction_ticket_number(active_receiver)}). Cancel it before creating another one."
            ),
        )

    return sender, module_code, linked_location_overrides(sender)


def validate_receiver_operation_type(
    db: Session,
    module_code: str | None,
    operation_type_code: str,
):
    """
    A receiving ticket must use an operation type captured by its module.

    Tanker Tracking uses two operation types - one per side - so the receiving
    ticket must use the type mapped as RECEIVER. Barge Tracking uses ONE
    operation type for both sides (the receiver ticket is created against the
    approved sender ticket of the same barge and convoy), so every Active barge
    mapping is accepted here whatever role it was mapped with.
    """
    if module_code is None or not module_is_configured(db, module_code):
        return

    row = get_active_config_row(db, module_code, operation_type_code)
    if row is None:
        configured = ", ".join(
            configured_operation_type_code_list(db, module_code)
        )
        hint = (
            f"Select one of the configured operation types: {configured}."
            if configured
            else "Configure the mapping in Tracking Module Configuration first."
        )
        raise HTTPException(
            status_code=400,
            detail=(
                f"Operation type {operation_type_code} is not mapped to "
                f"{TRACKING_MODULES.get(module_code, module_code)}. {hint}"
            ),
        )

    if module_code == MODULE_BARGE:
        # One barge operation type serves both sides of the movement.
        return

    if row.movement_role != ROLE_RECEIVER:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Operation type {operation_type_code} is not configured as a receiver operation for "
                f"{TRACKING_MODULES.get(module_code, module_code)}. Select the configured receiving operation type."
            ),
        )


def describe_linked_sender(db: Session, sender_transaction_id: int, current_user: User):
    """
    Read model for the receiver entry screen: the sender ticket, its route and
    the receiving operation types configured for its tracking module
    (Tanker Tracking: the operation types mapped as RECEIVER; Barge Tracking:
    every Active mapping, because one barge operation type serves both sides).
    Does not require the receiver to hold View Operation Transaction.
    """
    from app.models import Location, OperationType
    from app.services.tracking_config import TRACKING_MODULES as _MODULES

    sender = (
        db.query(OperationTransaction)
        .filter(OperationTransaction.id == sender_transaction_id)
        .first()
    )
    if sender is None:
        raise HTTPException(status_code=404, detail="Linked sender ticket not found")

    if not any(
        user_has_location_access(current_user, db, code)
        for code in (
            sender.origin_location_code,
            sender.destination_location_code,
            sender.sender_location_code,
            sender.receiver_location_code,
        )
    ):
        raise HTTPException(
            status_code=403,
            detail="The linked sender ticket does not involve any location in your assigned scope.",
        )

    location_names = {
        str(loc.location_code or "").strip().lower(): loc.location_name
        for loc in db.query(Location).all()
    }

    def loc_label(code):
        if not code:
            return None
        name = location_names.get(str(code).strip().lower())
        return f"{name} ({code})" if name else code

    module_code = sender_module_code(db, sender)
    receiver_options = []
    if module_code is not None:
        for row in receiving_config_rows(db, module_code):
            operation_type = (
                db.query(OperationType)
                .filter(OperationType.operation_type_code.ilike(row.operation_type_code))
                .first()
            )
            receiver_options.append({
                "operation_type_code": row.operation_type_code,
                "operation_type_name": operation_type.operation_type_name if operation_type else row.operation_type_code,
                "movement_role": row.movement_role,
            })
    receiver_options.sort(key=lambda item: item["operation_type_code"])

    active_receiver = find_active_receiver_for_sender(
        db, sender.id, sender.convoy_number
    )

    operation_type = (
        db.query(OperationType)
        .filter(OperationType.operation_type_code.ilike(sender.operation_type_code))
        .first()
    )
    asset = None
    if sender.primary_asset_code:
        from app.models import Asset

        asset = (
            db.query(Asset)
            .filter(Asset.asset_code.ilike(sender.primary_asset_code))
            .first()
        )

    overrides = linked_location_overrides(sender)

    return {
        "transaction_id": sender.id,
        "ticket_number": get_transaction_ticket_number(sender),
        "operation_number": sender.operation_number,
        "status": sender.status,
        "operation_date": sender.operation_date,
        "operation_type_code": sender.operation_type_code,
        "operation_type_name": operation_type.operation_type_name if operation_type else "",
        "convoy_number": sender.convoy_number,
        "primary_asset_code": sender.primary_asset_code,
        "primary_asset_name": asset.asset_name if asset else "",
        "primary_asset_type_code": sender.primary_asset_type_code,
        "product_name": sender.product_name,
        "origin_location_code": overrides["origin_location_code"],
        "origin_location_name": loc_label(overrides["origin_location_code"]),
        "destination_location_code": overrides["destination_location_code"],
        "destination_location_name": loc_label(overrides["destination_location_code"]),
        "sender_location_code": overrides["sender_location_code"],
        "sender_location_name": loc_label(overrides["sender_location_code"]),
        "receiver_location_code": overrides["receiver_location_code"],
        "receiver_location_name": loc_label(overrides["receiver_location_code"]),
        "module_code": module_code,
        "module_label": _MODULES.get(module_code, "") if module_code else "",
        "receiver_operation_types": receiver_options,
        "already_received_transaction_id": active_receiver.id if active_receiver else None,
        "already_received_ticket_number": (
            get_transaction_ticket_number(active_receiver) if active_receiver else None
        ),
    }
