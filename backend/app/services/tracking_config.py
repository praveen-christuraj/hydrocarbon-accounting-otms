"""
Tracking Module Configuration - operation type to tracking module mapping.

The Tracking Module Configuration page (Configurations menu) lets an admin say
which operation types feed which tracking module and in which role:

  * BARGE  - Barge Tracking (convoy voyages, load / unload / STS timeline)
  * TANKER - Tanker Tracking (sender ticket -> receiver ticket comparison)

Rules used by the tracking code:

  * A module with NO configuration rows keeps the legacy behaviour (barge =
    barge asset type + convoy number, tanker = tanker asset type / payload).
    This keeps existing installations working until the admin configures them.
  * A module WITH configuration rows captures only the approved tickets whose
    operation type is an *Active* row for that module. Inactive rows and
    unconfigured operation types are not captured.
  * The configured movement role is authoritative for Tanker Tracking, which
    uses a separate operation type per side: a receiving tanker ticket must use
    an operation type mapped as RECEIVER.
  * Barge Tracking uses ONE operation type for both sides of a movement - the
    sender ticket and the receiving ticket the receiver creates against it -
    so every Active barge mapping is a valid receiving operation type. See
    ``receiving_config_rows``.
  * No movement stage is configured here. The barge stage belongs to the
    ticket (the entry screen captures it in the ``barge_event_type`` value
    field), exactly like Tanker Tracking - one operation type can be used with
    any stage by any location.

The per-request cache lives on the SQLAlchemy session (``db.info``) so a single
request does not re-query the configuration for every ticket it loops over.
"""

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import OperationType, TrackingModuleConfig
from app.services.asset_family import (
    FAMILY_LABELS,
    asset_type_conflicting_module,
)


MODULE_BARGE = "BARGE"
MODULE_TANKER = "TANKER"

TRACKING_MODULES = {
    MODULE_BARGE: "Barge Tracking",
    MODULE_TANKER: "Tanker Tracking",
}

ROLE_SENDER = "SENDER"
ROLE_RECEIVER = "RECEIVER"
MOVEMENT_ROLES = {
    ROLE_SENDER: "Sender (creates the approved ticket that is tracked)",
    ROLE_RECEIVER: "Receiver (creates a ticket against an approved sender ticket)",
}

STATUS_ACTIVE = "Active"
STATUS_INACTIVE = "Inactive"
CONFIG_STATUSES = [STATUS_ACTIVE, STATUS_INACTIVE]


def _key(value) -> str:
    return str(value or "").strip().lower()


def clean_code(value) -> str:
    return str(value or "").strip()


def tracking_catalog() -> dict:
    """Modules, roles and statuses offered by the configuration page."""
    return {
        "modules": [
            {"code": code, "label": label}
            for code, label in TRACKING_MODULES.items()
        ],
        "roles": [
            {"code": code, "label": label}
            for code, label in MOVEMENT_ROLES.items()
        ],
        "statuses": CONFIG_STATUSES,
    }


def _module_index(db: Session, module_code: str) -> dict:
    """{'has_rows': bool, 'rows': {op_code_lower: row} (Active rows only)}."""
    cache = db.info.setdefault("tracking_config_index", {})
    if module_code in cache:
        return cache[module_code]

    rows = (
        db.query(TrackingModuleConfig)
        .filter(TrackingModuleConfig.module_code == module_code)
        .all()
    )
    index = {
        "has_rows": len(rows) > 0,
        "rows": {
            _key(row.operation_type_code): row
            for row in rows
            if str(row.status or "").strip() == STATUS_ACTIVE
        },
    }
    cache[module_code] = index
    return index


def invalidate_tracking_config_cache(db: Session) -> None:
    """Call after the configuration is changed in the same session."""
    db.info.pop("tracking_config_index", None)


def module_is_configured(db: Session, module_code: str) -> bool:
    """True when the admin has configured at least one operation type."""
    return _module_index(db, module_code)["has_rows"]


def get_active_config_row(db: Session, module_code: str, operation_type_code):
    """Active configuration row for an operation type in a module, or None."""
    return _module_index(db, module_code)["rows"].get(_key(operation_type_code))


def configured_operation_type_codes(db: Session, module_code: str):
    """
    Lower-case operation type codes captured by a module, or None when the
    module is not configured (legacy detection applies).
    """
    index = _module_index(db, module_code)
    if not index["has_rows"]:
        return None
    return set(index["rows"].keys())


def configured_rows(db: Session, module_code: str) -> list[TrackingModuleConfig]:
    """Active configuration rows of a module, ordered by operation type code."""
    rows = list(_module_index(db, module_code)["rows"].values())
    rows.sort(key=lambda row: _key(row.operation_type_code))
    return rows


def receiving_config_rows(db: Session, module_code: str) -> list[TrackingModuleConfig]:
    """
    Active configuration rows a receiving ticket may use.

    Tanker Tracking has a dedicated receiving operation type per side, so only
    rows configured as RECEIVER qualify. Barge Tracking uses one operation type
    for the sender ticket and for the receiving ticket created against it, so
    every Active barge mapping can be used by either side.
    """
    rows = configured_rows(db, module_code)
    if module_code == MODULE_BARGE:
        return rows
    return [row for row in rows if row.movement_role == ROLE_RECEIVER]


def configured_operation_type_code_list(db: Session, module_code: str) -> list[str]:
    """Active operation type codes of a module, for messages and dropdowns."""
    return [clean_code(row.operation_type_code) for row in configured_rows(db, module_code)]


def is_ticket_captured(db: Session, module_code: str, transaction):
    """
    True / False when the module is configured; None when it is not
    configured yet (caller applies the legacy rule).
    """
    index = _module_index(db, module_code)
    if not index["has_rows"]:
        return None
    return _key(transaction.operation_type_code) in index["rows"]


def configured_role_for_transaction(db: Session, module_code: str, transaction):
    row = get_active_config_row(db, module_code, transaction.operation_type_code)
    return row.movement_role if row else None


def validate_config_payload(
    db: Session,
    module_code: str,
    operation_type_code: str,
    movement_role: str,
    status: str,
    exclude_id: int | None = None,
):
    """Business rules for one configuration row. Raises HTTPException(400).

    The row maps an operation type to a tracking module and a movement role.
    No stage is configured: the barge stage is captured on the ticket itself
    (entry screen ``barge_event_type`` value), so one operation type serves
    every stage and both sides of a barge movement.
    """
    module = clean_code(module_code).upper()
    if module not in TRACKING_MODULES:
        raise HTTPException(status_code=400, detail="Unknown tracking module")

    role = clean_code(movement_role).upper()
    if role not in MOVEMENT_ROLES:
        raise HTTPException(status_code=400, detail="Movement role must be SENDER or RECEIVER")

    if status not in CONFIG_STATUSES:
        raise HTTPException(status_code=400, detail="Status must be Active or Inactive")

    operation_type = (
        db.query(OperationType)
        .filter(OperationType.operation_type_code.ilike(clean_code(operation_type_code)))
        .first()
    )
    if operation_type is None:
        raise HTTPException(status_code=400, detail="Operation type not found in Operation Type Master")
    if str(operation_type.status or "").strip() != STATUS_ACTIVE:
        raise HTTPException(status_code=400, detail="Only Active operation types can be mapped to a tracking module")

    if module == MODULE_BARGE:
        # Barge Tracking captures the operation types the admin maps to it. The
        # old rule required the literal text "barge" in the asset type code,
        # which refused perfectly valid installations whose barge asset type is
        # a custom code (reported case: operation type BARGE_MOVE on asset type
        # 'YADE'). Only an operation type that clearly belongs to another
        # tracking module (a tanker movement, for example) is refused here; the
        # admin's mapping is the source of truth for custom / unknown codes.
        conflicting_module = asset_type_conflicting_module(db, operation_type, MODULE_BARGE)
        if conflicting_module is not None:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Operation type {operation_type.operation_type_code} applies to asset type "
                    f"'{operation_type.applicable_asset_type_code}', which is a "
                    f"{FAMILY_LABELS.get(conflicting_module, conflicting_module.lower())} asset. "
                    f"{TRACKING_MODULES.get(conflicting_module, conflicting_module)} captures those "
                    f"operation types - map this operation type there instead of in Barge Tracking."
                ),
            )

    duplicate_query = db.query(TrackingModuleConfig).filter(
        TrackingModuleConfig.module_code == module,
        TrackingModuleConfig.operation_type_code.ilike(operation_type.operation_type_code),
    )
    if exclude_id is not None:
        duplicate_query = duplicate_query.filter(TrackingModuleConfig.id != exclude_id)
    if duplicate_query.first() is not None:
        raise HTTPException(
            status_code=400,
            detail=f"Operation type {operation_type.operation_type_code} is already mapped to {TRACKING_MODULES[module]}",
        )

    return {
        "module_code": module,
        "operation_type_code": operation_type.operation_type_code,
        "movement_role": role,
        "status": status,
    }
