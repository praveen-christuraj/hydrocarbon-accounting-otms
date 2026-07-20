from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import (
    ApprovedTransactionCorrectionRequest,
    OperationTask,
    OperationTransaction,
    TankStockLedger,
    User,
)
from app.schemas import (
    ApprovedTransactionCorrectionRequestCreate,
    ApprovedTransactionCorrectionRequestResponse,
)
from app.dependencies.auth import get_current_user_from_token
from app.dependencies.permissions import (
    require_user_permission,
    user_has_permission,
    get_role_ids_with_permission,
    user_can_act_on_operation_task,
)
from app.services.audit_service import create_audit_log
from app.utils.helpers import (
    clean_optional_text,
    get_transaction_ticket_number,
    get_current_user_display_name,
)
from app.config import APPROVED_TRANSACTION_STATUS, APPROVED_CORRECTION_WINDOW_HOURS
from app.services.transaction_helpers import (
    generate_operation_task_number,
    add_operation_task_event,
    approved_transaction_not_on_correction_hold,
    transaction_has_pending_correction_request,
    build_correction_request_response,
    create_approved_transaction_revoke_task,
    ensure_approved_correction_window_open,
    get_latest_transaction_approval_time,
)

router = APIRouter(prefix="/operation-transactions", tags=["Correction Requests"])


def generate_correction_request_number(db: Session):
    today = datetime.now().strftime("%Y%m%d")
    prefix = f"CORR-{today}"
    count = (
        db.query(ApprovedTransactionCorrectionRequest)
        .filter(ApprovedTransactionCorrectionRequest.request_number.ilike(f"{prefix}%"))
        .count()
    )
    return f"{prefix}-{count + 1:04d}"


def _rebuild_tank_stock_running_balances(
    db: Session,
    location_code: str,
    tank_asset_code: str,
    product_name: str | None,
):
    from app.routers.reports import rebuild_tank_stock_running_balances as _r
    _r(db=db, location_code=location_code, tank_asset_code=tank_asset_code, product_name=product_name)


def reverse_tank_stock_ledger_for_revoked_transaction(
    db: Session,
    transaction: OperationTransaction,
):
    rows = (
        db.query(TankStockLedger)
        .filter(
            TankStockLedger.transaction_id == transaction.id,
            TankStockLedger.status.in_(["Active", "Correction Hold"]),
        )
        .all()
    )

    group_keys = set()
    for row in rows:
        row.status = "Reversed"
        row.updated_at = datetime.now()
        group_keys.add((row.location_code, row.tank_asset_code, row.product_name))

    for location_code, tank_asset_code, product_name in group_keys:
        _rebuild_tank_stock_running_balances(
            db=db,
            location_code=location_code,
            tank_asset_code=tank_asset_code,
            product_name=product_name,
        )

    return {
        "reversed_rows": len(rows),
        "groups_rebuilt": len(group_keys),
    }


def set_tank_stock_ledger_correction_hold(
    db: Session,
    transaction: OperationTransaction,
):
    rows = (
        db.query(TankStockLedger)
        .filter(
            TankStockLedger.transaction_id == transaction.id,
            TankStockLedger.status == "Active",
        )
        .all()
    )

    group_keys = set()
    for row in rows:
        row.status = "Correction Hold"
        row.updated_at = datetime.now()
        group_keys.add((row.location_code, row.tank_asset_code, row.product_name))

    for location_code, tank_asset_code, product_name in group_keys:
        _rebuild_tank_stock_running_balances(
            db=db,
            location_code=location_code,
            tank_asset_code=tank_asset_code,
            product_name=product_name,
        )

    return {
        "held_rows": len(rows),
        "groups_rebuilt": len(group_keys),
    }


def restore_tank_stock_ledger_from_correction_hold(
    db: Session,
    transaction: OperationTransaction,
):
    rows = (
        db.query(TankStockLedger)
        .filter(
            TankStockLedger.transaction_id == transaction.id,
            TankStockLedger.status == "Correction Hold",
        )
        .all()
    )

    group_keys = set()
    for row in rows:
        row.status = "Active"
        row.updated_at = datetime.now()
        group_keys.add((row.location_code, row.tank_asset_code, row.product_name))

    for location_code, tank_asset_code, product_name in group_keys:
        _rebuild_tank_stock_running_balances(
            db=db,
            location_code=location_code,
            tank_asset_code=tank_asset_code,
            product_name=product_name,
        )

    return {
        "restored_rows": len(rows),
        "groups_rebuilt": len(group_keys),
    }


@router.post(
    "/{transaction_id}/correction-requests",
    response_model=ApprovedTransactionCorrectionRequestResponse,
)
def create_approved_transaction_correction_request(
    transaction_id: int,
    request: ApprovedTransactionCorrectionRequestCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    if not (
        user_has_permission(current_user, "Request Approved Transaction Correction", db)
        or user_has_permission(current_user, "Approve Operation Transaction", db)
    ):
        raise HTTPException(
            status_code=403,
            detail="Permission required: Request Approved Transaction Correction or Approve Operation Transaction",
        )

    transaction = (
        db.query(OperationTransaction)
        .filter(OperationTransaction.id == transaction_id)
        .first()
    )
    if not transaction:
        raise HTTPException(status_code=404, detail="Operation transaction not found")
    if transaction.status != APPROVED_TRANSACTION_STATUS:
        raise HTTPException(
            status_code=400,
            detail="Only Approved transactions can be marked for correction",
        )
    ensure_approved_correction_window_open(db, transaction)

    request_type = clean_optional_text(request.request_type)
    suggested_action = clean_optional_text(request.suggested_action)
    reason = clean_optional_text(request.reason)
    if not request_type:
        raise HTTPException(status_code=400, detail="Correction type is required")
    if not suggested_action:
        raise HTTPException(status_code=400, detail="Suggested action is required")
    if not reason:
        raise HTTPException(status_code=400, detail="Reason is required")

    existing = (
        db.query(ApprovedTransactionCorrectionRequest)
        .filter(
            ApprovedTransactionCorrectionRequest.transaction_id == transaction.id,
            ApprovedTransactionCorrectionRequest.status == "Pending Admin Review",
        )
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=400,
            detail="A pending correction request already exists for this approved transaction",
        )

    correction_request = ApprovedTransactionCorrectionRequest(
        request_number=generate_correction_request_number(db),
        transaction_id=transaction.id,
        ticket_number=get_transaction_ticket_number(transaction),
        operation_number=transaction.operation_number,
        request_type=request_type,
        suggested_action=suggested_action,
        reason=reason,
        status="Pending Admin Review",
        requested_by_user_id=current_user.id,
        requested_by_display=get_current_user_display_name(current_user),
        requested_at=datetime.now(),
    )
    db.add(correction_request)
    db.flush()

    task = create_approved_transaction_revoke_task(
        db=db,
        transaction=transaction,
        correction_request=correction_request,
        current_user=current_user,
    )

    ledger_hold_result = set_tank_stock_ledger_correction_hold(
        db=db,
        transaction=transaction,
    )

    create_audit_log(
        db=db,
        module_name="Operation Transaction Correction",
        action="Request Approved Transaction Correction",
        current_user=current_user,
        entity_type="ApprovedTransactionCorrectionRequest",
        entity_id=correction_request.id,
        entity_label=correction_request.request_number,
        ticket_number=get_transaction_ticket_number(transaction),
        operation_number=transaction.operation_number,
        old_status=transaction.status,
        new_status=transaction.status,
        remarks=reason,
        request_path=f"/operation-transactions/{transaction_id}/correction-requests",
        details={
            "transaction_id": transaction.id,
            "task_id": task.id,
            "request_type": request_type,
            "suggested_action": suggested_action,
            "reason": reason,
            "correction_window_hours": APPROVED_CORRECTION_WINDOW_HOURS,
            "ledger_hold_result": ledger_hold_result,
        },
    )

    create_audit_log(
        db=db,
        module_name="Tank Stock Ledger",
        action="Hold Ledger Rows On Correction Request",
        current_user=current_user,
        entity_type="OperationTransaction",
        entity_id=transaction.id,
        entity_label=get_transaction_ticket_number(transaction),
        ticket_number=get_transaction_ticket_number(transaction),
        operation_number=transaction.operation_number,
        remarks="Derived tank stock ledger rows placed on correction hold",
        request_path=f"/operation-transactions/{transaction_id}/correction-requests",
        details=ledger_hold_result,
    )

    create_audit_log(
        db=db,
        module_name="Operation Task",
        action="Create Approved Transaction Revoke Task",
        current_user=current_user,
        entity_type="OperationTask",
        entity_id=task.id,
        entity_label=task.task_number,
        ticket_number=task.ticket_number,
        operation_number=task.operation_number,
        new_status=task.status,
        remarks="Admin revoke task created from approved transaction correction request",
        request_path=f"/operation-transactions/{transaction_id}/correction-requests",
        details={
            "correction_request_id": correction_request.id,
            "request_number": correction_request.request_number,
            "assigned_role_ids": task.assigned_role_ids_json,
        },
    )

    db.commit()
    db.refresh(correction_request)
    return build_correction_request_response(correction_request)


@router.get(
    "/{transaction_id}/correction-requests",
    response_model=list[ApprovedTransactionCorrectionRequestResponse],
)
def get_transaction_correction_requests(
    transaction_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "View Operation Transaction", db)
    rows = (
        db.query(ApprovedTransactionCorrectionRequest)
        .filter(ApprovedTransactionCorrectionRequest.transaction_id == transaction_id)
        .order_by(
            ApprovedTransactionCorrectionRequest.created_at.desc(),
            ApprovedTransactionCorrectionRequest.id.desc(),
        )
        .all()
    )
    return [build_correction_request_response(row) for row in rows]
