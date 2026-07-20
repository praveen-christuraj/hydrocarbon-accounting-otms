from datetime import datetime, date, timedelta
from fastapi import HTTPException
from fastapi.encoders import jsonable_encoder
from sqlalchemy.orm import Session

from app.config import APPROVED_CORRECTION_WINDOW_HOURS, APPROVED_TRANSACTION_STATUS, CORRECTION_HOLD_STATUS
from app.models import (
    ApprovedTransactionCorrectionRequest,
    OperationTask,
    OperationTaskEvent,
    OperationTransaction,
    OperationTransactionStatusHistory,
    OperationType,
    User,
)
from app.utils.helpers import (
    clean_optional_text,
    get_current_user_display_name,
    get_transaction_ticket_number,
)
from app.dependencies.permissions import get_role_ids_with_permission


def generate_operation_task_number(db: Session):
    today = datetime.now().strftime("%Y%m%d")
    prefix = f"TASK-{today}"
    count = db.query(OperationTask).filter(OperationTask.task_number.ilike(f"{prefix}%")).count()
    return f"{prefix}-{count + 1:04d}"


def add_operation_task_event(
    db: Session,
    task: OperationTask,
    event_type: str,
    current_user: User | None = None,
    old_status: str | None = None,
    new_status: str | None = None,
    notes: str | None = None,
    details: dict | None = None,
):
    event = OperationTaskEvent(
        task_id=task.id,
        event_type=event_type,
        old_status=old_status,
        new_status=new_status,
        actor_user_id=current_user.id if current_user else None,
        actor_display=get_current_user_display_name(current_user) if current_user else None,
        notes=notes,
        details=jsonable_encoder(details) if details is not None else None,
    )
    db.add(event)
    return event


def approved_transaction_not_on_correction_hold(db: Session):
    return ~OperationTransaction.id.in_(
        db.query(ApprovedTransactionCorrectionRequest.transaction_id).filter(
            ApprovedTransactionCorrectionRequest.status == CORRECTION_HOLD_STATUS
        )
    )


def transaction_has_pending_correction_request(db: Session, transaction_id: int):
    return (
        db.query(ApprovedTransactionCorrectionRequest.id)
        .filter(
            ApprovedTransactionCorrectionRequest.transaction_id == transaction_id,
            ApprovedTransactionCorrectionRequest.status == CORRECTION_HOLD_STATUS,
        )
        .first()
        is not None
    )


def build_correction_request_response(row: ApprovedTransactionCorrectionRequest):
    return {
        "id": row.id,
        "request_number": row.request_number,
        "transaction_id": row.transaction_id,
        "task_id": row.task_id,
        "ticket_number": row.ticket_number,
        "operation_number": row.operation_number,
        "request_type": row.request_type,
        "suggested_action": row.suggested_action,
        "reason": row.reason,
        "status": row.status,
        "requested_by_user_id": row.requested_by_user_id,
        "requested_by_display": row.requested_by_display,
        "requested_at": row.requested_at,
        "admin_action": row.admin_action,
        "admin_remarks": row.admin_remarks,
        "admin_user_id": row.admin_user_id,
        "admin_action_at": row.admin_action_at,
        "previous_status_before_revoke": row.previous_status_before_revoke,
        "new_status_after_revoke": row.new_status_after_revoke,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }


def create_approved_transaction_revoke_task(
    db: Session,
    transaction: OperationTransaction,
    correction_request: ApprovedTransactionCorrectionRequest,
    current_user: User,
):
    assigned_role_ids = get_role_ids_with_permission(
        db,
        "Admin Revoke Approved Transaction",
    )
    if not assigned_role_ids:
        assigned_role_ids = get_role_ids_with_permission(db, "Manage Operation Tasks")

    task = OperationTask(
        task_number=generate_operation_task_number(db),
        task_type="APPROVED_TRANSACTION_REVOKE_REQUEST",
        transaction_id=transaction.id,
        ticket_number=get_transaction_ticket_number(transaction),
        operation_number=transaction.operation_number,
        operation_type_code=transaction.operation_type_code,
        operation_template_id=transaction.operation_template_id,
        asset_type_code=transaction.primary_asset_type_code,
        primary_asset_code=transaction.primary_asset_code,
        location_code=transaction.origin_location_code,
        raised_by_user_id=current_user.id,
        assigned_role_ids_json=assigned_role_ids,
        assigned_user_ids_json=[],
        status="Pending",
        priority="High",
        remarks=(
            f"{correction_request.request_number}: "
            f"{correction_request.request_type} / {correction_request.suggested_action}. "
            f"{correction_request.reason}"
        ),
    )
    db.add(task)
    db.flush()

    correction_request.task_id = task.id

    add_operation_task_event(
        db=db,
        task=task,
        event_type="Created",
        current_user=current_user,
        new_status="Pending",
        notes="Approved transaction correction request created",
        details={
            "correction_request_id": correction_request.id,
            "request_number": correction_request.request_number,
            "request_type": correction_request.request_type,
            "suggested_action": correction_request.suggested_action,
            "assigned_role_ids": assigned_role_ids,
        },
    )
    return task


def get_operation_type_by_code(operation_type_code: str | None, db: Session):
    if not operation_type_code:
        return None
    return db.query(OperationType).filter(
        OperationType.operation_type_code == operation_type_code
    ).first()


def parse_date_filter(value: str | None, field_name: str):
    cleaned_value = clean_optional_text(value)

    if not cleaned_value:
        return None

    try:
        return date.fromisoformat(cleaned_value)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"{field_name} must be in YYYY-MM-DD format",
        )


def get_latest_transaction_approval_time(db: Session, transaction_id: int):
    latest_history = (
        db.query(OperationTransactionStatusHistory)
        .filter(
            OperationTransactionStatusHistory.transaction_id == transaction_id,
            OperationTransactionStatusHistory.new_status == APPROVED_TRANSACTION_STATUS,
        )
        .order_by(OperationTransactionStatusHistory.changed_at.desc())
        .first()
    )
    return latest_history.changed_at if latest_history else None


def ensure_approved_correction_window_open(db: Session, transaction: OperationTransaction):
    approved_at = get_latest_transaction_approval_time(db, transaction.id)
    if not approved_at:
        approved_at = transaction.updated_at or transaction.created_at

    if approved_at and datetime.now() > approved_at + timedelta(hours=APPROVED_CORRECTION_WINDOW_HOURS):
        raise HTTPException(
            status_code=400,
            detail="Approved transaction correction window expired after 24 hours",
        )


def require_approved_transaction_for_tracking(
    transaction: OperationTransaction | None,
    action_label: str = "tracking",
    db: Session | None = None,
):
    if not transaction:
        raise HTTPException(
            status_code=404,
            detail="Operation transaction not found",
        )

    if transaction.status != APPROVED_TRANSACTION_STATUS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Only Approved transactions can be used for {action_label}. "
                f"Current status is {transaction.status}."
            ),
        )

    if db is not None and transaction_has_pending_correction_request(db, transaction.id):
        raise HTTPException(
            status_code=400,
            detail=(
                f"This approved transaction is marked for correction and cannot be used for {action_label} "
                "until the correction request is resolved and the ticket is approved again."
            ),
        )
