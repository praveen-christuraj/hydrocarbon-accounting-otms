from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from pydantic import BaseModel

from app.database import get_db
from app.models import (
    Trip,
    TripEvent,
    TripComparison,
    OperationTransaction,
    OperationTransactionValue,
    OperationType,
    User,
)
from app.schemas import (
    TripEventCreate,
    TripEventResponse,
    TripComparisonCreate,
    TripComparisonResponse,
    ConvoyTrackerResponse,
)
from app.dependencies.auth import get_current_user_from_token
from app.dependencies.permissions import (
    TRANSACTION_PARTY_LOCATION_FIELDS,
    ensure_location_in_user_scope,
    ensure_user_is_party_to_location_codes,
    get_user_location_codes,
    require_user_permission,
    require_any_user_permission,
    user_is_party_to_location_codes,
)
from app.services.audit_service import create_audit_log
from app.services.operation_datetime import (
    resolve_transaction_operation_datetime_from_db as resolve_payload_operation_datetime,
)
from app.services.location_pairing import (
    resolve_receiver_location_code,
    resolve_sender_location_code,
)
from app.utils.helpers import (
    clean_optional_text,
    get_transaction_ticket_number,
    get_current_user_display_name,
    get_location_name_by_code,
    get_location_by_code,
    get_asset_by_code,
)
from app.config import APPROVED_TRANSACTION_STATUS
from app.services.transaction_helpers import (
    get_operation_type_by_code,
    require_approved_transaction_for_tracking,
    transaction_has_pending_correction_request,
)
from app.services.tracking_config import (
    MODULE_BARGE,
    ROLE_RECEIVER,
    ROLE_SENDER,
    configured_role_for_transaction,
)
from app.services.tracking_links import (
    get_linked_sender_transaction_id,
    get_receiver_links_for_convoy,
)
from app.services.tracking_helpers import (
    is_barge_transaction,
    get_trip_by_convoy_or_none,
    ensure_trip_not_closed,
    ensure_barge_trip_timeline as _ensure_barge_trip_timeline,
    load_multi_tank_payload,
    build_multitank_comparison_json_v2 as build_multitank_comparison_json,
    build_multitank_seal_checks,
    resolve_comparison_stages,
    get_payload_stage,
    require_barge_tracking_ready_for_closure as _require_barge_tracking_ready_for_closure,
    ensure_barge_unload_comparison as _ensure_barge_unload_comparison,
)

router = APIRouter(prefix="/barge-trip", tags=["Barge / Trip Tracking"])


class TripStatusUpdateRequest(BaseModel):
    remarks: str | None = None


# All helper functions delegated to app.services.tracking_helpers
# ---------------------------------------------------------------------------
# The canonical implementations live in app/services/tracking_helpers.py
# ---------------------------------------------------------------------------


def ensure_barge_movement_location_scope(
    transactions: list[OperationTransaction],
    current_user: User,
    db: Session,
):
    """Authorize a convoy when any location on any of its barge tickets is in scope.

    Sender and receiver details can live on different tickets in the same
    convoy. Checking each ticket independently blocks the receiver from the
    movement when the approved sender ticket predates the receiver fields.
    """
    party_location_codes = [
        getattr(transaction, field_name, None)
        for transaction in transactions
        for field_name in TRANSACTION_PARTY_LOCATION_FIELDS
    ]
    ensure_user_is_party_to_location_codes(
        current_user,
        db,
        party_location_codes,
        "barge movement",
    )


def barge_movement_in_user_scope(
    transactions: list[OperationTransaction],
    current_user: User,
    db: Session,
) -> bool:
    party_location_codes = [
        getattr(transaction, field_name, None)
        for transaction in transactions
        for field_name in TRANSACTION_PARTY_LOCATION_FIELDS
    ]
    return user_is_party_to_location_codes(current_user, db, party_location_codes)


def barge_ticket_movement_role(
    db: Session,
    transaction,
    linked_sender,
    has_receiver: bool = False,
) -> str:
    """
    SENDER / RECEIVER of a barge ticket.

    Barge Tracking does not need two operation types: the receiver creates his
    ticket against the approved sender ticket of the same barge and convoy, so
    the ticket links identify the two sides even when both share one operation
    type - a ticket with a linked sender is the RECEIVER, a ticket that has a
    receiver ticket linked to it is the SENDER. Only a ticket without any link
    falls back to the configured movement role (rows created before the link
    existed), and a plain barge ticket is the sender side.
    """
    if linked_sender is not None:
        return ROLE_RECEIVER
    if has_receiver:
        return ROLE_SENDER
    return (
        configured_role_for_transaction(db, MODULE_BARGE, transaction)
        or ROLE_SENDER
    )


def ensure_trip_location_scope(trip: Trip, current_user: User, db: Session):
    """
    A user may view / act on a trip when they are a party to at least one
    location of the voyage: any trip-event location or any end (origin,
    destination, sender, receiver) of a linked ticket inside their assigned
    scope. Legs that call at terminals outside the user's scope do not block
    access - a barge voyage is cross-location by definition.

    The party decision itself comes from the shared helpers in
    app/dependencies/permissions.py. A trip that has no location context at all
    (no event and no ticket location) stays closed to location-scoped users,
    which is the historical behaviour of this endpoint.
    """
    if get_user_location_codes(current_user, db) is None:
        return

    events = db.query(TripEvent).filter(TripEvent.trip_id == trip.id).all()
    transaction_ids = {event.operation_transaction_id for event in events if event.operation_transaction_id}
    comparisons = db.query(TripComparison).filter(TripComparison.trip_id == trip.id).all()
    for comparison in comparisons:
        transaction_ids.update((comparison.left_transaction_id, comparison.right_transaction_id))

    transactions = {
        transaction.id: transaction
        for transaction in db.query(OperationTransaction).filter(
            OperationTransaction.convoy_number.ilike(trip.convoy_number)
        ).all()
    }
    if transaction_ids:
        transactions.update({
            transaction.id: transaction
            for transaction in db.query(OperationTransaction).filter(
                OperationTransaction.id.in_(transaction_ids)
            ).all()
        })

    party_location_codes = [
        clean_optional_text(event.location_code) for event in events
    ]
    for transaction in transactions.values():
        party_location_codes.extend(
            getattr(transaction, field_name, None)
            for field_name in TRANSACTION_PARTY_LOCATION_FIELDS
        )

    if all(
        clean_optional_text(location_code) is None
        for location_code in party_location_codes
    ):
        raise HTTPException(
            status_code=403,
            detail="This trip has no location context in your assigned scope",
        )

    ensure_user_is_party_to_location_codes(
        current_user, db, party_location_codes, "barge movement"
    )


@router.get("/convoy-tracker", response_model=ConvoyTrackerResponse)
def get_convoy_tracker(
    convoy_number: str,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    """
    Approved barge tickets of one convoy, grouped by barge.

    Only tickets captured by Barge Tracking are listed (Tracking Module
    Configuration). A ticket is shown when one of its four locations is in the
    user's scope - the receiver sees the sender's approved ticket even though the
    sender side is another terminal. Each ticket also carries its movement role,
    its stage and the sender / receiver ticket it is linked to.
    """
    require_user_permission(current_user, "View Barge Tracking", db)

    convoy = clean_optional_text(convoy_number)
    if convoy is None:
        raise HTTPException(status_code=400, detail="convoy_number is required")

    convoy_transactions = (
        db.query(OperationTransaction)
        .filter(
            OperationTransaction.convoy_number.ilike(convoy),
        )
        .order_by(OperationTransaction.operation_date.asc(), OperationTransaction.id.asc())
        .all()
    )
    barge_transactions = [
        tx for tx in convoy_transactions if is_barge_transaction(db, tx)
    ]
    approved_barge_transactions = [
        tx
        for tx in barge_transactions
        if tx.status == APPROVED_TRANSACTION_STATUS
    ]

    if approved_barge_transactions:
        ensure_barge_movement_location_scope(
            barge_transactions,
            current_user,
            db,
        )

    transactions = approved_barge_transactions

    receiver_by_sender = get_receiver_links_for_convoy(db, convoy)

    asset_map = {}
    for tx in transactions:
        asset_code = tx.primary_asset_code
        asset = get_asset_by_code(asset_code, db)
        if asset_code not in asset_map:
            asset_map[asset_code] = {
                "asset_code": asset_code,
                "asset_name": asset.asset_name if asset else "",
                "tickets": [],
            }
        op_type = get_operation_type_by_code(tx.operation_type_code, db)

        sender_code = resolve_sender_location_code(tx)
        receiver_code = resolve_receiver_location_code(tx)

        receiver = receiver_by_sender.get(tx.id)
        linked_sender_id = get_linked_sender_transaction_id(db, tx.id)
        linked_sender = (
            db.query(OperationTransaction).filter(OperationTransaction.id == linked_sender_id).first()
            if linked_sender_id is not None else None
        )

        asset_map[asset_code]["tickets"].append({
            "transaction_id": tx.id,
            "ticket_number": get_transaction_ticket_number(tx),
            "operation_type_code": tx.operation_type_code,
            "operation_type_name": op_type.operation_type_name if op_type else "",
            "operation_date": tx.operation_date,
            "origin_location_code": tx.origin_location_code,
            "origin_location_name": get_location_name_by_code(tx.origin_location_code, db),
            "destination_location_code": tx.destination_location_code,
            "destination_location_name": get_location_name_by_code(tx.destination_location_code, db),
            "sender_location_code": tx.sender_location_code,
            "receiver_location_code": tx.receiver_location_code,
            # Clubbed Sender / Receiver pairing: the single Sender of the
            # record (sender, else origin) and its single Receiver
            # (receiver, else destination). Tracking decisions and the UI
            # read these, so records created before the clubbing behave
            # exactly like new ones.
            "sender_code": sender_code,
            "sender_name": get_location_name_by_code(sender_code, db),
            "receiver_code": receiver_code,
            "receiver_name": get_location_name_by_code(receiver_code, db),
            "status": tx.status,
            # The links decide the sides: Barge Tracking uses one operation
            # type for both sides, so a ticket created against an approved
            # sender ticket is the RECEIVER ticket and the ticket it points
            # back to is the SENDER, whatever the configured role says.
            "movement_role": barge_ticket_movement_role(
                db, tx, linked_sender, has_receiver=receiver is not None
            ),
            "receiver_transaction_id": receiver.id if receiver else None,
            "receiver_ticket_number": get_transaction_ticket_number(receiver) if receiver else None,
            "receiver_status": receiver.status if receiver else None,
            "linked_sender_transaction_id": linked_sender.id if linked_sender else None,
            "linked_sender_ticket_number": get_transaction_ticket_number(linked_sender) if linked_sender else None,
        })

    return {
        "convoy_number": convoy,
        "total_tickets": len(transactions),
        "assets": list(asset_map.values()),
    }


@router.get("/barge-tracking", response_model=ConvoyTrackerResponse, deprecated=True, description="Deprecated: use GET /barge-trip/convoy-tracker instead")
def get_barge_tracking(
    convoy_number: str,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    """Deprecated. Delegates to /barge-trip/convoy-tracker."""
    return get_convoy_tracker(
        convoy_number=convoy_number,
        current_user=current_user,
        db=db,
    )


@router.get("/voyages")
def get_barge_voyages(
    tab: str | None = "OPEN",
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    """
    List barge voyages (convoys) for the Barge Tracking Open / Closed tabs.

    A voyage is built from its Approved barge tickets, grouped by convoy number.
    Its status comes from the Trip row; a convoy without a Trip row is OPEN.
    This endpoint is read-only: it never creates or repairs trip rows (that is
    done by GET /trips/by-convoy/{convoy_number} when a voyage is opened).
    Both tab counts are returned so the UI can show them without a second call.
    """
    require_user_permission(current_user, "View Barge Tracking", db)

    tab_norm = (clean_optional_text(tab) or "OPEN").upper()
    if tab_norm not in ("OPEN", "CLOSED"):
        raise HTTPException(status_code=400, detail="tab must be OPEN or CLOSED")

    base_query = db.query(OperationTransaction).filter(
        OperationTransaction.convoy_number.isnot(None),
        OperationTransaction.status == APPROVED_TRANSACTION_STATUS,
    )
    approved_transactions = base_query.order_by(
        OperationTransaction.operation_date.asc(),
        OperationTransaction.id.asc(),
    ).all()

    approved_barge_transactions = [
        tx for tx in approved_transactions if is_barge_transaction(db, tx)
    ]
    convoy_keys = {
        str(tx.convoy_number or "").strip().lower()
        for tx in approved_barge_transactions
        if clean_optional_text(tx.convoy_number)
    }
    related_transactions = (
        db.query(OperationTransaction)
        .filter(func.lower(func.trim(OperationTransaction.convoy_number)).in_(convoy_keys))
        .all()
        if convoy_keys
        else []
    )
    related_barge_transactions = [
        tx for tx in related_transactions if is_barge_transaction(db, tx)
    ]
    scope_rows_by_convoy = {}
    for tx in related_barge_transactions:
        key = str(tx.convoy_number or "").strip().lower()
        scope_rows_by_convoy.setdefault(key, []).append(tx)

    transactions = [
        tx
        for tx in approved_barge_transactions
        if barge_movement_in_user_scope(
            scope_rows_by_convoy.get(
                str(tx.convoy_number or "").strip().lower(),
                [tx],
            ),
            current_user,
            db,
        )
    ]

    voyages = {}
    asset_name_cache = {}

    def asset_name_for(asset_code):
        if asset_code not in asset_name_cache:
            asset = get_asset_by_code(asset_code, db)
            asset_name_cache[asset_code] = asset.asset_name if asset else ""
        return asset_name_cache[asset_code]

    for tx in transactions:
        convoy = clean_optional_text(tx.convoy_number)
        if convoy is None or not is_barge_transaction(db, tx):
            continue

        key = convoy.lower()
        voyage = voyages.get(key)
        if voyage is None:
            voyage = {
                "convoy_number": convoy,
                "barge_asset_codes": [],
                "ticket_count": 0,
                "first_operation_date": tx.operation_date,
                "last_operation_date": tx.operation_date,
                "origin_location_codes": [],
                "destination_location_codes": [],
            }
            voyages[key] = voyage

        voyage["ticket_count"] += 1
        voyage["last_operation_date"] = tx.operation_date or voyage["last_operation_date"]

        asset_code = clean_optional_text(tx.primary_asset_code)
        if asset_code and asset_code not in voyage["barge_asset_codes"]:
            voyage["barge_asset_codes"].append(asset_code)

        # Clubbed Sender / Receiver pairing: a convoy's two ends are the
        # single Sender (sender, else origin) and the single Receiver
        # (receiver, else destination) of its tickets. Reading the raw
        # origin / destination columns instead mixed the receiving
        # terminal into the "origin" list, because a receiver ticket keeps
        # the receiving terminal as its origin for location scoping.
        origin = resolve_sender_location_code(tx)
        if origin and origin not in voyage["origin_location_codes"]:
            voyage["origin_location_codes"].append(origin)

        destination = resolve_receiver_location_code(tx)
        if destination and destination not in voyage["destination_location_codes"]:
            voyage["destination_location_codes"].append(destination)

    trips = {}
    if voyages:
        trip_rows = db.query(Trip).filter(
            func.lower(Trip.convoy_number).in_(list(voyages.keys()))
        ).all()
        trips = {str(trip.convoy_number or "").strip().lower(): trip for trip in trip_rows}

    all_rows = []
    for key, voyage in voyages.items():
        trip = trips.get(key)
        status = str(trip.status or "OPEN").strip().upper() if trip else "OPEN"

        all_rows.append({
            "trip_id": trip.id if trip else None,
            "convoy_number": voyage["convoy_number"],
            "status": status,
            "barge_asset_codes": voyage["barge_asset_codes"],
            "barges": [
                {"asset_code": code, "asset_name": asset_name_for(code)}
                for code in voyage["barge_asset_codes"]
            ],
            "barge_count": len(voyage["barge_asset_codes"]),
            "ticket_count": voyage["ticket_count"],
            "first_operation_date": voyage["first_operation_date"],
            "last_operation_date": voyage["last_operation_date"],
            "origin_location_codes": voyage["origin_location_codes"],
            "destination_location_codes": voyage["destination_location_codes"],
            "trip_created_by": trip.created_by if trip else None,
            "trip_remarks": trip.remarks if trip else None,
            "trip_updated_at": trip.updated_at if trip else None,
        })

    open_count = sum(1 for row in all_rows if row["status"] != "CLOSED")
    closed_count = sum(1 for row in all_rows if row["status"] == "CLOSED")

    rows = [
        row for row in all_rows
        if (row["status"] == "CLOSED") == (tab_norm == "CLOSED")
    ]
    rows.sort(
        key=lambda row: (
            str(row["last_operation_date"] or ""),
            row["convoy_number"].lower(),
        ),
        reverse=True,
    )

    return {
        "tab": tab_norm,
        "open_count": open_count,
        "closed_count": closed_count,
        "rows": rows,
    }


@router.post("/trip-events", response_model=TripEventResponse)
def create_trip_event(
    request: TripEventCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    # Acknowledge / revoke receipt is the receiving side of a cross-location
    # movement: it is allowed with the general barge tracking edit right or
    # with the scoped "Acknowledge Shipment Receipt" capability
    # (PERMISSION_CRITERIA_MODEL.md, section 7.1). Every other timeline event
    # (manual fixes, backfills) stays restricted to Edit Barge Tracking.
    event_type_code = str(clean_optional_text(request.event_type) or "").upper()
    if event_type_code in ("RECEIVED", "RECEIPT_REVOKED"):
        require_any_user_permission(
            current_user,
            ["Edit Barge Tracking", "Acknowledge Shipment Receipt"],
            db,
        )
    else:
        require_user_permission(current_user, "Edit Barge Tracking", db)

    convoy = clean_optional_text(request.convoy_number)
    if convoy is None:
        raise HTTPException(status_code=400, detail="convoy_number is required")

    asset_code = clean_optional_text(request.asset_code)
    if asset_code is None:
        raise HTTPException(status_code=400, detail="asset_code is required")

    tx = None
    if request.operation_transaction_id is not None:
        tx = (
            db.query(OperationTransaction)
            .filter(OperationTransaction.id == request.operation_transaction_id)
            .first()
        )
        if not tx:
            raise HTTPException(status_code=404, detail="Operation transaction not found")
        movement_transactions = db.query(OperationTransaction).filter(
            OperationTransaction.convoy_number.ilike(convoy)
        ).all()
        scoped_movement_transactions = [
            row for row in movement_transactions if is_barge_transaction(db, row)
        ]
        ensure_barge_movement_location_scope(
            scoped_movement_transactions or [tx],
            current_user,
            db,
        )

        if str(tx.primary_asset_code or "").strip().lower() != asset_code.lower():
            raise HTTPException(
                status_code=400,
                detail="asset_code does not match the operation ticket primary_asset_code",
            )

        require_approved_transaction_for_tracking(tx, "barge timeline event", db=db)

        if clean_optional_text(tx.convoy_number) is None:
            tx.convoy_number = convoy
            db.flush()
        elif str(tx.convoy_number).strip().lower() != convoy.lower():
            raise HTTPException(
                status_code=400,
                detail="Ticket convoy_number does not match request convoy_number",
            )

        existing_event_for_ticket = (
            db.query(TripEvent)
            .filter(TripEvent.operation_transaction_id == tx.id)
            .first()
        )
        if existing_event_for_ticket:
            updated_location_code = (
                clean_optional_text(request.location_code)
                or existing_event_for_ticket.location_code
            )
            ensure_location_in_user_scope(
                current_user, db, updated_location_code, "Trip event location"
            )
            existing_event_for_ticket.event_type = (
                clean_optional_text(request.event_type)
                or existing_event_for_ticket.event_type
            )
            existing_event_for_ticket.location_code = updated_location_code
            existing_event_for_ticket.asset_code = asset_code
            existing_event_for_ticket.event_datetime = (
                request.event_datetime
                or existing_event_for_ticket.event_datetime
            )
            cleaned_remarks = clean_optional_text(request.remarks)
            if cleaned_remarks:
                existing_event_for_ticket.remarks = cleaned_remarks
            existing_event_for_ticket.updated_at = datetime.now()
            db.commit()
            db.refresh(existing_event_for_ticket)

            if tx and str(existing_event_for_ticket.event_type or "").strip().upper() == "UNLOAD":
                trip_for_cmp = db.query(Trip).filter(Trip.convoy_number.ilike(convoy)).first()
                if trip_for_cmp:
                    ensure_trip_not_closed(trip_for_cmp)
                    _ensure_barge_unload_comparison(
                        db=db,
                        trip=trip_for_cmp,
                        asset_code=asset_code,
                        unload_tx=tx,
                        current_user=current_user,
                        remarks="Backfilled from Fix Timeline",
                    )
                    db.commit()

            return {
                "id": existing_event_for_ticket.id,
                "trip_id": existing_event_for_ticket.trip_id,
                "convoy_number": convoy,
                "event_type": existing_event_for_ticket.event_type,
                "location_code": existing_event_for_ticket.location_code,
                "asset_code": existing_event_for_ticket.asset_code,
                "operation_transaction_id": existing_event_for_ticket.operation_transaction_id,
                "sequence_no": existing_event_for_ticket.sequence_no,
                "event_datetime": existing_event_for_ticket.event_datetime,
                "created_by": existing_event_for_ticket.created_by,
                "remarks": existing_event_for_ticket.remarks,
                "created_at": existing_event_for_ticket.created_at,
                "updated_at": existing_event_for_ticket.updated_at,
            }

    trip = db.query(Trip).filter(Trip.convoy_number.ilike(convoy)).first()
    if trip:
        ensure_trip_location_scope(trip, current_user, db)
    created_by_display = get_current_user_display_name(current_user)

    if not trip:
        trip = Trip(
            convoy_number=convoy,
            primary_barge_asset_code=asset_code,
            status="OPEN",
            created_by=created_by_display,
            remarks=None,
        )
        db.add(trip)
        db.flush()

    ensure_trip_not_closed(trip)

    if request.sequence_no is None:
        max_seq = (
            db.query(func.max(TripEvent.sequence_no))
            .filter(TripEvent.trip_id == trip.id)
            .scalar()
        )
        sequence_no = (max_seq or 0) + 1
    else:
        sequence_no = int(request.sequence_no)

    event_type = clean_optional_text(request.event_type)
    if event_type is None:
        raise HTTPException(status_code=400, detail="event_type is required")

    location_code = clean_optional_text(request.location_code)
    if location_code is None and tx is not None:
        location_code = clean_optional_text(tx.origin_location_code)
    if location_code is None:
        raise HTTPException(
            status_code=400,
            detail="location_code is required when operation_transaction_id is not provided",
        )
    ensure_location_in_user_scope(current_user, db, location_code, "Trip event location")

    event_datetime = (
        request.event_datetime
        or (resolve_payload_operation_datetime(db, tx) if tx else None)
        or datetime.now()
    )

    op_tx_id = tx.id if tx else None

    new_event = TripEvent(
        trip_id=trip.id,
        event_type=event_type.upper(),
        location_code=location_code,
        asset_code=asset_code,
        operation_transaction_id=op_tx_id,
        sequence_no=sequence_no,
        event_datetime=event_datetime,
        created_by=created_by_display,
        remarks=clean_optional_text(request.remarks),
    )

    try:
        db.add(new_event)
        db.flush()
    except IntegrityError:
        db.rollback()
        if op_tx_id is not None:
            existing = (
                db.query(TripEvent)
                .filter(TripEvent.operation_transaction_id == op_tx_id)
                .first()
            )
            if existing:
                existing.event_type = event_type.upper()
                existing.location_code = location_code
                existing.asset_code = asset_code
                existing.event_datetime = event_datetime
                cleaned_remarks = clean_optional_text(request.remarks)
                if cleaned_remarks:
                    existing.remarks = cleaned_remarks
                existing.updated_at = datetime.now()
                db.commit()
                db.refresh(existing)
                return {
                    "id": existing.id,
                    "trip_id": existing.trip_id,
                    "convoy_number": convoy,
                    "event_type": existing.event_type,
                    "location_code": existing.location_code,
                    "asset_code": existing.asset_code,
                    "operation_transaction_id": existing.operation_transaction_id,
                    "sequence_no": existing.sequence_no,
                    "event_datetime": existing.event_datetime,
                    "created_by": existing.created_by,
                    "remarks": existing.remarks,
                    "created_at": existing.created_at,
                    "updated_at": existing.updated_at,
                }
        raise HTTPException(
            status_code=500,
            detail="Failed to create/update trip event due to duplicate operation_transaction_id",
        )

    create_audit_log(
        db=db,
        module_name="Barge Tracking",
        action="Create Trip Event",
        current_user=current_user,
        entity_type="TripEvent",
        entity_id=new_event.id,
        entity_label=f"{convoy} | {new_event.event_type} | {asset_code}",
        ticket_number=(get_transaction_ticket_number(tx) if tx else None),
        operation_number=(tx.operation_number if tx else None),
        remarks="Trip event created",
        request_path="/barge-trip/trip-events",
        details={
            "convoy_number": convoy,
            "trip_id": trip.id,
            "event_type": new_event.event_type,
            "asset_code": asset_code,
            "location_code": location_code,
            "operation_transaction_id": op_tx_id,
            "sequence_no": sequence_no,
        },
    )

    if tx and str(new_event.event_type or "").strip().upper() == "UNLOAD":
        _ensure_barge_unload_comparison(
            db=db,
            trip=trip,
            asset_code=asset_code,
            unload_tx=tx,
            current_user=current_user,
            remarks="Auto-created from trip event creation",
        )

    db.commit()
    db.refresh(new_event)

    return {
        "id": new_event.id,
        "trip_id": new_event.trip_id,
        "convoy_number": convoy,
        "event_type": new_event.event_type,
        "location_code": new_event.location_code,
        "asset_code": new_event.asset_code,
        "operation_transaction_id": new_event.operation_transaction_id,
        "sequence_no": new_event.sequence_no,
        "event_datetime": new_event.event_datetime,
        "created_by": new_event.created_by,
        "remarks": new_event.remarks,
        "created_at": new_event.created_at,
        "updated_at": new_event.updated_at,
    }


@router.get("/trips/by-convoy/{convoy_number}")
def get_trip_timeline_by_convoy(
    convoy_number: str,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_any_user_permission(current_user, ["View Barge Tracking", "View Movement Mapping"], db)

    convoy = clean_optional_text(convoy_number)
    if convoy is None:
        raise HTTPException(status_code=400, detail="convoy_number is required")

    convoy_transactions = db.query(OperationTransaction).filter(
        OperationTransaction.convoy_number.ilike(convoy)
    ).all()
    barge_convoy_transactions = [
        transaction
        for transaction in convoy_transactions
        if is_barge_transaction(db, transaction)
    ]
    if barge_convoy_transactions:
        ensure_barge_movement_location_scope(
            barge_convoy_transactions,
            current_user,
            db,
        )
    trip, timeline_changed = _ensure_barge_trip_timeline(
        db=db,
        convoy_number=convoy,
        current_user=current_user,
    )

    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found for this convoy number")
    ensure_trip_location_scope(trip, current_user, db)

    if timeline_changed:
        # Approved tickets existed without a trip row / events (e.g. tickets
        # approved before auto-creation was added). Persist the rebuilt timeline
        # so unloading, comparison and closure all work from Barge Tracking.
        db.commit()
        db.refresh(trip)

    events = (
        db.query(TripEvent)
        .filter(TripEvent.trip_id == trip.id)
        .order_by(TripEvent.sequence_no.asc(), TripEvent.id.asc())
        .all()
    )

    comparisons = (
        db.query(TripComparison)
        .filter(TripComparison.trip_id == trip.id)
        .order_by(TripComparison.id.asc())
        .all()
    )

    event_rows = []
    for ev in events:
        tx = db.query(OperationTransaction).filter(OperationTransaction.id == ev.operation_transaction_id).first()
        asset = get_asset_by_code(ev.asset_code, db)
        event_rows.append({
            "id": ev.id,
            "trip_id": ev.trip_id,
            "convoy_number": convoy,
            "event_type": ev.event_type,
            "sequence_no": ev.sequence_no,
            "event_datetime": ev.event_datetime,
            "location_code": ev.location_code,
            "location_name": get_location_name_by_code(ev.location_code, db),
            "asset_code": ev.asset_code,
            "asset_name": asset.asset_name if asset else "",
            "operation_transaction_id": ev.operation_transaction_id,
            "ticket_number": get_transaction_ticket_number(tx) if tx else "",
            "ticket_status": tx.status if tx else "",
        })

    comparison_rows = []

    for cmp in comparisons:
        left_tx = (
            db.query(OperationTransaction)
            .filter(OperationTransaction.id == cmp.left_transaction_id)
            .first()
        )
        right_tx = (
            db.query(OperationTransaction)
            .filter(OperationTransaction.id == cmp.right_transaction_id)
            .first()
        )

        summary_json = cmp.summary_json
        per_tank_json = cmp.per_tank_json
        if left_tx and right_tx:
            require_approved_transaction_for_tracking(left_tx, "barge comparison report", db=db)
            require_approved_transaction_for_tracking(right_tx, "barge comparison report", db=db)
            left_payload = load_multi_tank_payload(db, left_tx.id)
            right_payload = load_multi_tank_payload(db, right_tx.id)
            if left_payload and right_payload:
                summary_json, per_tank_json = build_multitank_comparison_json(
                    left_tx=left_tx, right_tx=right_tx,
                    comparison_type=cmp.comparison_type,
                    left_payload=left_payload, right_payload=right_payload,
                )

        asset_code = (left_tx.primary_asset_code if left_tx else "") or (
            right_tx.primary_asset_code if right_tx else ""
        )
        asset = get_asset_by_code(asset_code, db) if asset_code else None

        comparison_rows.append({
            "id": cmp.id,
            "trip_id": cmp.trip_id,
            "convoy_number": convoy,
            "comparison_type": cmp.comparison_type,
            "asset_code": asset_code,
            "asset_name": asset.asset_name if asset else "",
            "left_transaction_id": cmp.left_transaction_id,
            "left_ticket_number": get_transaction_ticket_number(left_tx) if left_tx else "",
            "right_transaction_id": cmp.right_transaction_id,
            "right_ticket_number": get_transaction_ticket_number(right_tx) if right_tx else "",
            "summary_json": summary_json,
            "per_tank_json": per_tank_json,
            "created_by": cmp.created_by,
            "remarks": cmp.remarks,
            "created_at": cmp.created_at,
            "updated_at": cmp.updated_at,
        })

    warnings = []
    if timeline_changed:
        warnings.append(
            "Trip timeline was rebuilt from the Approved barge tickets of this convoy."
        )

    return {
        "trip": {
            "id": trip.id,
            "convoy_number": trip.convoy_number,
            "primary_barge_asset_code": trip.primary_barge_asset_code,
            "status": trip.status,
            "created_by": trip.created_by,
            "remarks": trip.remarks,
            "created_at": trip.created_at,
            "updated_at": trip.updated_at,
        },
        "events": event_rows,
        "comparisons": comparison_rows,
        "timeline_rebuilt": timeline_changed,
        "warnings": warnings,
    }


@router.post("/trip-comparisons", response_model=TripComparisonResponse)
def create_trip_comparison(
    request: TripComparisonCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Edit Barge Tracking", db)

    convoy = clean_optional_text(request.convoy_number)
    if convoy is None:
        raise HTTPException(status_code=400, detail="convoy_number is required")

    trip = db.query(Trip).filter(Trip.convoy_number.ilike(convoy)).first()
    if trip:
        ensure_trip_location_scope(trip, current_user, db)
    created_by_display = get_current_user_display_name(current_user)

    if not trip:
        trip = Trip(
            convoy_number=convoy,
            primary_barge_asset_code=None,
            status="OPEN",
            created_by=created_by_display,
            remarks=None,
        )
        db.add(trip)
        db.flush()

    ensure_trip_not_closed(trip)

    left_tx = db.query(OperationTransaction).filter(OperationTransaction.id == request.left_transaction_id).first()
    right_tx = db.query(OperationTransaction).filter(OperationTransaction.id == request.right_transaction_id).first()

    if not left_tx or not right_tx:
        raise HTTPException(status_code=404, detail="Left or Right transaction not found")
    ensure_barge_movement_location_scope(
        [left_tx, right_tx],
        current_user,
        db,
    )

    require_approved_transaction_for_tracking(left_tx, "barge sender/receiver comparison", db=db)
    require_approved_transaction_for_tracking(right_tx, "barge sender/receiver comparison", db=db)

    if clean_optional_text(left_tx.convoy_number) is None:
        left_tx.convoy_number = convoy
    if clean_optional_text(right_tx.convoy_number) is None:
        right_tx.convoy_number = convoy

    if str(left_tx.convoy_number).strip().lower() != convoy.lower() or str(right_tx.convoy_number).strip().lower() != convoy.lower():
        raise HTTPException(status_code=400, detail="Both tickets must belong to the same convoy_number")

    if (left_tx.id == right_tx.id
            or not is_barge_transaction(db, left_tx)
            or not is_barge_transaction(db, right_tx)
            or str(left_tx.primary_asset_code or "").strip().lower()
               != str(right_tx.primary_asset_code or "").strip().lower()):
        raise HTTPException(status_code=400, detail="Comparison requires two distinct tickets for the same barge")

    comparison_type = clean_optional_text(request.comparison_type)
    if comparison_type is None:
        raise HTTPException(status_code=400, detail="comparison_type is required")

    left_payload = load_multi_tank_payload(db, left_tx.id)
    right_payload = load_multi_tank_payload(db, right_tx.id)
    summary_json = None
    per_tank_json = None
    if left_payload and right_payload:
        summary_json, per_tank_json = build_multitank_comparison_json(
            left_tx=left_tx, right_tx=right_tx, comparison_type=comparison_type,
            left_payload=left_payload, right_payload=right_payload,
        )

    if summary_json is None or per_tank_json is None:
        raise HTTPException(
            status_code=400,
            detail=(
                "Unable to auto-build comparison data. "
                "Ensure BOTH tickets are Multi-Tank tickets and contain field_code 'multi_tank_payload'. "
                f"left_ticket_id={left_tx.id} has_payload={bool(left_payload)} | "
                f"right_ticket_id={right_tx.id} has_payload={bool(right_payload)}"
            ),
        )

    new_cmp = TripComparison(
        trip_id=trip.id,
        comparison_type=comparison_type,
        left_transaction_id=left_tx.id,
        right_transaction_id=right_tx.id,
        summary_json=summary_json,
        per_tank_json=per_tank_json,
        created_by=created_by_display,
        remarks=clean_optional_text(request.remarks),
    )

    db.add(new_cmp)
    db.flush()

    create_audit_log(
        db=db,
        module_name="Barge Tracking",
        action="Create Barge Comparison",
        current_user=current_user,
        entity_type="TripComparison",
        entity_id=new_cmp.id,
        entity_label=f"{convoy} | {comparison_type}",
        ticket_number=get_transaction_ticket_number(left_tx),
        operation_number=left_tx.operation_number,
        remarks="Barge comparison created",
        request_path="/barge-trip/trip-comparisons",
        details={
            "convoy_number": convoy,
            "trip_id": trip.id,
            "comparison_type": comparison_type,
            "left_transaction_id": left_tx.id,
            "left_ticket_number": get_transaction_ticket_number(left_tx),
            "right_transaction_id": right_tx.id,
            "right_ticket_number": get_transaction_ticket_number(right_tx),
        },
    )

    db.commit()
    db.refresh(new_cmp)

    return {
        "id": new_cmp.id,
        "trip_id": new_cmp.trip_id,
        "convoy_number": convoy,
        "comparison_type": new_cmp.comparison_type,
        "left_transaction_id": new_cmp.left_transaction_id,
        "right_transaction_id": new_cmp.right_transaction_id,
        "summary_json": new_cmp.summary_json,
        "per_tank_json": new_cmp.per_tank_json,
        "created_by": new_cmp.created_by,
        "remarks": new_cmp.remarks,
        "created_at": new_cmp.created_at,
        "updated_at": new_cmp.updated_at,
    }


@router.post("/trips/{trip_id}/close")
def close_trip(
    trip_id: int,
    request: TripStatusUpdateRequest | None = None,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Close Barge Movement", db)

    trip = db.query(Trip).filter(Trip.id == trip_id).first()
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")
    ensure_trip_location_scope(trip, current_user, db)

    if str(trip.status or "").upper() == "CLOSED":
        return {"message": "Barge movement already CLOSED", "trip_id": trip.id, "status": trip.status}

    _require_barge_tracking_ready_for_closure(trip, db)

    before_status = trip.status
    trip.status = "CLOSED"
    trip.updated_at = datetime.now()

    closure_remarks = clean_optional_text(request.remarks) if request else None
    if closure_remarks:
        trip.remarks = f"{trip.remarks or ''}\n[Barge Movement Closed] {closure_remarks}".strip()

    create_audit_log(
        db=db,
        module_name="Barge Tracking",
        action="Close Barge Movement",
        current_user=current_user,
        entity_type="Trip",
        entity_id=trip.id,
        entity_label=trip.convoy_number,
        remarks="Barge movement closed after comparison review",
        request_path=f"/barge-trip/trips/{trip_id}/close",
        details={
            "convoy_number": trip.convoy_number,
            "before_status": before_status,
            "after_status": trip.status,
            "closure_remarks": closure_remarks,
        },
    )

    db.commit()
    db.refresh(trip)

    return {"message": "Barge movement CLOSED", "trip_id": trip.id, "status": trip.status}


@router.post("/trips/{trip_id}/reopen")
def reopen_trip(
    trip_id: int,
    request: TripStatusUpdateRequest | None = None,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Reopen Barge Movement", db)

    trip = db.query(Trip).filter(Trip.id == trip_id).first()
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")
    ensure_trip_location_scope(trip, current_user, db)

    if str(trip.status or "").upper() == "OPEN":
        return {"message": "Barge movement already OPEN", "trip_id": trip.id, "status": trip.status}

    before_status = trip.status
    trip.status = "OPEN"
    trip.updated_at = datetime.now()

    reopen_remarks = clean_optional_text(request.remarks) if request else None
    if reopen_remarks:
        trip.remarks = f"{trip.remarks or ''}\n[Barge Movement Reopened] {reopen_remarks}".strip()

    create_audit_log(
        db=db,
        module_name="Barge Tracking",
        action="Reopen Barge Movement",
        current_user=current_user,
        entity_type="Trip",
        entity_id=trip.id,
        entity_label=trip.convoy_number,
        remarks="Barge movement reopened manually",
        request_path=f"/barge-trip/trips/{trip_id}/reopen",
        details={
            "convoy_number": trip.convoy_number,
            "before_status": before_status,
            "after_status": trip.status,
            "reopen_remarks": reopen_remarks,
        },
    )

    db.commit()
    db.refresh(trip)

    return {"message": "Barge movement OPEN", "trip_id": trip.id, "status": trip.status}
