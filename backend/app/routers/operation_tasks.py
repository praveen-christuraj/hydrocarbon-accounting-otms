from datetime import datetime, date, time as datetime_time
from fastapi import APIRouter, Depends, HTTPException
from fastapi.encoders import jsonable_encoder
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import (
    OperationTask,
    OperationTaskEvent,
    OperationTransaction,
    OperationTransactionStatusHistory,
    OperationWorkflowPolicyRole,
    OperationWorkflowPolicyUser,
    User,
    ApprovedTransactionCorrectionRequest,
)
from app.schemas import (
    OperationTaskActionRequest,
    OperationTaskResponse,
    OperationTaskEventResponse,
    OperationTransactionStatusUpdate,
    ApprovedTransactionCorrectionAdminAction,
    ApprovedTransactionCorrectionRequestResponse,
)
from app.dependencies.auth import get_current_user_from_token
from app.dependencies.permissions import (
    user_has_permission,
    require_user_permission,
    get_role_ids_with_permission,
    user_can_act_on_operation_task,
    find_matching_operation_workflow_policy,
)
from app.services.audit_service import create_audit_log
from app.utils.helpers import clean_optional_text, get_transaction_ticket_number, get_current_user_display_name
from app.config import APPROVED_TRANSACTION_STATUS
from app.services.transaction_helpers import (
    generate_operation_task_number,
    add_operation_task_event,
    approved_transaction_not_on_correction_hold,
    transaction_has_pending_correction_request,
    build_correction_request_response,
    create_approved_transaction_revoke_task,
)

router = APIRouter(prefix="/operation-tasks", tags=["Operation Tasks"])


def create_operation_approval_task_for_transaction(
    db: Session,
    transaction: OperationTransaction,
    current_user: User,
):
    existing = (
        db.query(OperationTask)
        .filter(
            OperationTask.transaction_id == transaction.id,
            OperationTask.task_type == "OPERATION_APPROVAL",
            OperationTask.status.in_(["Pending", "In Progress"]),
        )
        .first()
    )
    if existing:
        return existing

    policy = find_matching_operation_workflow_policy(
        db=db,
        action_code="APPROVE",
        operation_type_code=clean_optional_text(transaction.operation_type_code),
        operation_template_id=transaction.operation_template_id,
        asset_type_code=clean_optional_text(transaction.primary_asset_type_code),
        location_code=clean_optional_text(transaction.origin_location_code),
    )

    assigned_role_ids = []
    assigned_user_ids = []
    if policy:
        assigned_role_ids = [
            row.role_id
            for row in db.query(OperationWorkflowPolicyRole)
            .filter(OperationWorkflowPolicyRole.policy_id == policy.id)
            .all()
        ]
        assigned_user_ids = [
            row.user_id
            for row in db.query(OperationWorkflowPolicyUser)
            .filter(
                OperationWorkflowPolicyUser.policy_id == policy.id,
                OperationWorkflowPolicyUser.mode == "ALLOW",
            )
            .all()
        ]

    if not assigned_role_ids and not assigned_user_ids:
        assigned_role_ids = get_role_ids_with_permission(db, "Approve Operation Transaction")

    task = OperationTask(
        task_number=generate_operation_task_number(db),
        task_type="OPERATION_APPROVAL",
        transaction_id=transaction.id,
        ticket_number=get_transaction_ticket_number(transaction),
        operation_number=transaction.operation_number,
        operation_type_code=transaction.operation_type_code,
        operation_template_id=transaction.operation_template_id,
        asset_type_code=transaction.primary_asset_type_code,
        primary_asset_code=transaction.primary_asset_code,
        location_code=transaction.origin_location_code,
        raised_by_user_id=current_user.id,
        assigned_policy_id=policy.id if policy else None,
        assigned_role_ids_json=assigned_role_ids,
        assigned_user_ids_json=assigned_user_ids,
        status="Pending",
        priority="Normal",
    )
    db.add(task)
    db.flush()
    add_operation_task_event(
        db=db,
        task=task,
        event_type="Created",
        current_user=current_user,
        new_status="Pending",
        details={
            "assigned_policy_id": task.assigned_policy_id,
            "assigned_role_ids": assigned_role_ids,
            "assigned_user_ids": assigned_user_ids,
        },
    )
    return task


def close_operation_approval_tasks_for_transaction(
    db: Session,
    transaction: OperationTransaction,
    current_user: User,
    task_status: str,
    action_taken: str,
    notes: str | None = None,
):
    tasks = (
        db.query(OperationTask)
        .filter(
            OperationTask.transaction_id == transaction.id,
            OperationTask.task_type == "OPERATION_APPROVAL",
            OperationTask.status.in_(["Pending", "In Progress"]),
        )
        .all()
    )
    for task in tasks:
        old_status = task.status
        task.status = task_status
        task.action_taken = action_taken
        task.acted_by_user_id = current_user.id
        task.acted_at = datetime.now()
        task.remarks = notes
        task.updated_at = datetime.now()
        add_operation_task_event(
            db=db,
            task=task,
            event_type=action_taken,
            current_user=current_user,
            old_status=old_status,
            new_status=task_status,
            notes=notes,
        )
        create_audit_log(
            db=db,
            module_name="Operation Task",
            action=f"Task {action_taken}",
            current_user=current_user,
            entity_type="OperationTask",
            entity_id=task.id,
            entity_label=task.task_number,
            ticket_number=task.ticket_number,
            operation_number=task.operation_number,
            old_status=old_status,
            new_status=task.status,
            remarks=notes or "",
            request_path=f"/operation-tasks/{task.id}",
            details={
                "task_type": task.task_type,
                "transaction_id": task.transaction_id,
                "operation_type_code": task.operation_type_code,
                "operation_template_id": task.operation_template_id,
                "asset_type_code": task.asset_type_code,
                "primary_asset_code": task.primary_asset_code,
                "location_code": task.location_code,
                "action_taken": action_taken,
            },
        )


def build_operation_task_response(task: OperationTask, db: Session, include_transaction: bool = True):
    from app.routers.operation_transactions import build_operation_transaction_response

    transaction_payload = None
    if include_transaction:
        transaction = (
            db.query(OperationTransaction)
            .filter(OperationTransaction.id == task.transaction_id)
            .first()
        )
        if transaction:
            transaction_payload = build_operation_transaction_response(transaction, db)

    return {
        "id": task.id,
        "task_number": task.task_number,
        "task_type": task.task_type,
        "transaction_id": task.transaction_id,
        "ticket_number": task.ticket_number,
        "operation_number": task.operation_number,
        "operation_type_code": task.operation_type_code,
        "operation_template_id": task.operation_template_id,
        "asset_type_code": task.asset_type_code,
        "primary_asset_code": task.primary_asset_code,
        "location_code": task.location_code,
        "raised_by_user_id": task.raised_by_user_id,
        "assigned_policy_id": task.assigned_policy_id,
        "assigned_role_ids_json": task.assigned_role_ids_json or [],
        "assigned_user_ids_json": task.assigned_user_ids_json or [],
        "status": task.status,
        "priority": task.priority,
        "due_at": task.due_at,
        "taken_by_user_id": task.taken_by_user_id,
        "taken_at": task.taken_at,
        "acted_by_user_id": task.acted_by_user_id,
        "acted_at": task.acted_at,
        "action_taken": task.action_taken,
        "remarks": task.remarks,
        "created_at": task.created_at,
        "updated_at": task.updated_at,
        "transaction": transaction_payload,
    }


def parse_task_filter_date(value: str | None, field_label: str):
    cleaned_value = clean_optional_text(value)

    if not cleaned_value:
        return None

    try:
        return date.fromisoformat(cleaned_value)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"{field_label} must be in YYYY-MM-DD format",
        )


def apply_operation_task_filters(
    query,
    status: str | None,
    task_type: str | None,
    search: str | None,
    created_from: str | None = None,
    created_to: str | None = None,
):
    cleaned_status = clean_optional_text(status)
    cleaned_task_type = clean_optional_text(task_type)
    cleaned_search = clean_optional_text(search)
    from_date = parse_task_filter_date(created_from, "Created From")
    to_date = parse_task_filter_date(created_to, "Created To")

    if cleaned_status and cleaned_status != "ALL":
        query = query.filter(OperationTask.status == cleaned_status)
    if cleaned_task_type and cleaned_task_type != "ALL":
        query = query.filter(OperationTask.task_type == cleaned_task_type)
    if from_date:
        query = query.filter(
            OperationTask.created_at >= datetime.combine(from_date, datetime_time.min)
        )
    if to_date:
        query = query.filter(
            OperationTask.created_at <= datetime.combine(to_date, datetime_time.max)
        )
    if cleaned_search:
        pattern = f"%{cleaned_search}%"
        query = query.filter(
            or_(
                OperationTask.task_number.ilike(pattern),
                OperationTask.ticket_number.ilike(pattern),
                OperationTask.operation_number.ilike(pattern),
                OperationTask.primary_asset_code.ilike(pattern),
                OperationTask.location_code.ilike(pattern),
            )
        )
    return query


def get_pending_correction_request_for_task(db: Session, task_id: int):
    row = (
        db.query(ApprovedTransactionCorrectionRequest)
        .filter(
            ApprovedTransactionCorrectionRequest.task_id == task_id,
            ApprovedTransactionCorrectionRequest.status == "Pending Admin Review",
        )
        .first()
    )
    if not row:
        raise HTTPException(
            status_code=404,
            detail="Pending approved transaction correction request not found for this task",
        )
    return row


@router.get("/my", response_model=list[OperationTaskResponse])
def get_my_operation_tasks(
    status: str | None = None,
    task_type: str | None = None,
    search: str | None = None,
    created_from: str | None = None,
    created_to: str | None = None,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "View My Tasks", db)
    query = db.query(OperationTask).order_by(OperationTask.created_at.desc(), OperationTask.id.desc())
    query = apply_operation_task_filters(
        query,
        status,
        task_type,
        search,
        created_from,
        created_to,
    )
    tasks = query.all()
    visible = [task for task in tasks if user_can_act_on_operation_task(db, current_user, task)]
    return [build_operation_task_response(task, db) for task in visible]


@router.get("", response_model=list[OperationTaskResponse])
def get_operation_tasks(
    status: str | None = None,
    task_type: str | None = None,
    search: str | None = None,
    created_from: str | None = None,
    created_to: str | None = None,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Manage Operation Tasks", db)
    query = db.query(OperationTask).order_by(OperationTask.created_at.desc(), OperationTask.id.desc())
    query = apply_operation_task_filters(
        query,
        status,
        task_type,
        search,
        created_from,
        created_to,
    )
    return [build_operation_task_response(task, db) for task in query.all()]


@router.get("/{task_id}", response_model=OperationTaskResponse)
def get_operation_task(
    task_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "View My Tasks", db)
    task = db.query(OperationTask).filter(OperationTask.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Operation task not found")
    if not user_can_act_on_operation_task(db, current_user, task) and not user_has_permission(current_user, "Manage Operation Tasks", db):
        raise HTTPException(status_code=403, detail="You are not assigned to this task")
    return build_operation_task_response(task, db)


@router.get("/{task_id}/events", response_model=list[OperationTaskEventResponse])
def get_operation_task_events(
    task_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    get_operation_task(task_id, current_user, db)
    events = (
        db.query(OperationTaskEvent)
        .filter(OperationTaskEvent.task_id == task_id)
        .order_by(OperationTaskEvent.created_at.asc(), OperationTaskEvent.id.asc())
        .all()
    )
    return events


@router.post("/{task_id}/take-ownership", response_model=OperationTaskResponse)
def take_operation_task_ownership(
    task_id: int,
    payload: OperationTaskActionRequest | None = None,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Act On Operation Task", db)
    task = db.query(OperationTask).filter(OperationTask.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Operation task not found")
    if task.status not in ["Pending", "In Progress"]:
        raise HTTPException(status_code=400, detail="Only open tasks can be taken")
    if not user_can_act_on_operation_task(db, current_user, task):
        raise HTTPException(status_code=403, detail="You are not assigned to this task")

    old_status = task.status
    task.status = "In Progress"
    task.taken_by_user_id = current_user.id
    task.taken_at = datetime.now()
    task.updated_at = datetime.now()
    add_operation_task_event(
        db=db,
        task=task,
        event_type="Taken",
        current_user=current_user,
        old_status=old_status,
        new_status=task.status,
        notes=payload.remarks if payload else None,
    )
    create_audit_log(
        db=db,
        module_name="Operation Task",
        action="Take Operation Task Ownership",
        current_user=current_user,
        entity_type="OperationTask",
        entity_id=task.id,
        entity_label=task.task_number,
        ticket_number=task.ticket_number,
        operation_number=task.operation_number,
        old_status=old_status,
        new_status=task.status,
        remarks=payload.remarks if payload else "",
        request_path=f"/operation-tasks/{task_id}/take-ownership",
        details={
            "task_type": task.task_type,
            "transaction_id": task.transaction_id,
            "operation_type_code": task.operation_type_code,
            "operation_template_id": task.operation_template_id,
            "asset_type_code": task.asset_type_code,
            "primary_asset_code": task.primary_asset_code,
            "location_code": task.location_code,
            "taken_by_user_id": current_user.id,
        },
    )
    db.commit()
    db.refresh(task)
    return build_operation_task_response(task, db)


@router.post("/{task_id}/release", response_model=OperationTaskResponse)
def release_operation_task(
    task_id: int,
    payload: OperationTaskActionRequest | None = None,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Act On Operation Task", db)
    task = db.query(OperationTask).filter(OperationTask.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Operation task not found")
    if task.status != "In Progress":
        raise HTTPException(status_code=400, detail="Only In Progress tasks can be released")
    if task.taken_by_user_id != current_user.id and not user_has_permission(current_user, "Manage Operation Tasks", db):
        raise HTTPException(status_code=403, detail="Only the owner or task manager can release this task")

    old_status = task.status
    task.status = "Pending"
    task.taken_by_user_id = None
    task.taken_at = None
    task.updated_at = datetime.now()
    add_operation_task_event(
        db=db,
        task=task,
        event_type="Released",
        current_user=current_user,
        old_status=old_status,
        new_status=task.status,
        notes=payload.remarks if payload else None,
    )
    create_audit_log(
        db=db,
        module_name="Operation Task",
        action="Release Operation Task",
        current_user=current_user,
        entity_type="OperationTask",
        entity_id=task.id,
        entity_label=task.task_number,
        ticket_number=task.ticket_number,
        operation_number=task.operation_number,
        old_status=old_status,
        new_status=task.status,
        remarks=payload.remarks if payload else "",
        request_path=f"/operation-tasks/{task_id}/release",
        details={
            "task_type": task.task_type,
            "transaction_id": task.transaction_id,
            "operation_type_code": task.operation_type_code,
            "operation_template_id": task.operation_template_id,
            "asset_type_code": task.asset_type_code,
            "primary_asset_code": task.primary_asset_code,
            "location_code": task.location_code,
            "released_by_user_id": current_user.id,
        },
    )
    db.commit()
    db.refresh(task)
    return build_operation_task_response(task, db)


@router.post("/{task_id}/approve")
def approve_operation_task(
    task_id: int,
    payload: OperationTaskActionRequest,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    from app.routers.operation_transactions import update_operation_transaction_status

    require_user_permission(current_user, "Act On Operation Task", db)
    task = db.query(OperationTask).filter(OperationTask.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Operation task not found")
    if task.status not in ["Pending", "In Progress"]:
        raise HTTPException(status_code=400, detail="Only open tasks can be approved")
    if not user_can_act_on_operation_task(db, current_user, task):
        raise HTTPException(status_code=403, detail="You are not assigned to this task")

    return update_operation_transaction_status(
        transaction_id=task.transaction_id,
        status_update=OperationTransactionStatusUpdate(
            status="Approved",
            remarks=payload.remarks,
            review_confirmed=True,
        ),
        current_user=current_user,
        db=db,
    )


@router.post("/{task_id}/reject")
def reject_operation_task(
    task_id: int,
    payload: OperationTaskActionRequest,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    from app.routers.operation_transactions import update_operation_transaction_status

    require_user_permission(current_user, "Act On Operation Task", db)
    task = db.query(OperationTask).filter(OperationTask.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Operation task not found")
    if task.status not in ["Pending", "In Progress"]:
        raise HTTPException(status_code=400, detail="Only open tasks can be rejected")
    if not user_can_act_on_operation_task(db, current_user, task):
        raise HTTPException(status_code=403, detail="You are not assigned to this task")

    return update_operation_transaction_status(
        transaction_id=task.transaction_id,
        status_update=OperationTransactionStatusUpdate(
            status="Rejected",
            remarks=payload.remarks,
            review_confirmed=False,
        ),
        current_user=current_user,
        db=db,
    )


@router.post(
    "/{task_id}/admin-reject-approved-revoke",
    response_model=ApprovedTransactionCorrectionRequestResponse,
)
def admin_reject_approved_transaction_revoke_request(
    task_id: int,
    payload: ApprovedTransactionCorrectionAdminAction,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    from app.routers.correction_requests import restore_tank_stock_ledger_from_correction_hold

    require_user_permission(current_user, "Admin Revoke Approved Transaction", db)
    task = db.query(OperationTask).filter(OperationTask.id == task_id).first()
    if not task or task.task_type != "APPROVED_TRANSACTION_REVOKE_REQUEST":
        raise HTTPException(status_code=404, detail="Approved transaction revoke task not found")
    if task.status not in ["Pending", "In Progress"]:
        raise HTTPException(status_code=400, detail="Only open revoke tasks can be rejected")
    if not user_can_act_on_operation_task(db, current_user, task):
        raise HTTPException(status_code=403, detail="You are not assigned to this task")

    correction_request = get_pending_correction_request_for_task(db, task.id)
    transaction = (
        db.query(OperationTransaction)
        .filter(OperationTransaction.id == correction_request.transaction_id)
        .first()
    )
    if not transaction:
        raise HTTPException(status_code=404, detail="Operation transaction not found")

    remarks = clean_optional_text(payload.remarks) or "Admin rejected approved transaction revoke request"
    ledger_restore_result = restore_tank_stock_ledger_from_correction_hold(
        db=db,
        transaction=transaction,
    )

    old_task_status = task.status
    task.status = "Rejected"
    task.action_taken = "Admin Rejected"
    task.acted_by_user_id = current_user.id
    task.acted_at = datetime.now()
    task.remarks = remarks
    task.updated_at = datetime.now()

    correction_request.status = "Admin Rejected"
    correction_request.admin_action = "Rejected"
    correction_request.admin_remarks = remarks
    correction_request.admin_user_id = current_user.id
    correction_request.admin_action_at = datetime.now()
    correction_request.updated_at = datetime.now()

    add_operation_task_event(
        db=db,
        task=task,
        event_type="Admin Rejected",
        current_user=current_user,
        old_status=old_task_status,
        new_status=task.status,
        notes=remarks,
        details={"correction_request_id": correction_request.id},
    )

    create_audit_log(
        db=db,
        module_name="Operation Transaction Correction",
        action="Reject Approved Transaction Correction Request",
        current_user=current_user,
        entity_type="ApprovedTransactionCorrectionRequest",
        entity_id=correction_request.id,
        entity_label=correction_request.request_number,
        ticket_number=correction_request.ticket_number,
        operation_number=correction_request.operation_number,
        old_status="Pending Admin Review",
        new_status=correction_request.status,
        remarks=remarks,
        request_path=f"/operation-tasks/{task_id}/admin-reject-approved-revoke",
        details={
            "task_id": task.id,
            "transaction_id": correction_request.transaction_id,
            "request_type": correction_request.request_type,
            "suggested_action": correction_request.suggested_action,
            "ledger_restore_result": ledger_restore_result,
        },
    )

    create_audit_log(
        db=db,
        module_name="Tank Stock Ledger",
        action="Restore Ledger Rows After Correction Rejection",
        current_user=current_user,
        entity_type="OperationTransaction",
        entity_id=transaction.id,
        entity_label=get_transaction_ticket_number(transaction),
        ticket_number=get_transaction_ticket_number(transaction),
        operation_number=transaction.operation_number,
        remarks="Correction request rejected; held tank stock ledger rows restored",
        request_path=f"/operation-tasks/{task_id}/admin-reject-approved-revoke",
        details=ledger_restore_result,
    )

    create_audit_log(
        db=db,
        module_name="Operation Task",
        action="Task Admin Rejected",
        current_user=current_user,
        entity_type="OperationTask",
        entity_id=task.id,
        entity_label=task.task_number,
        ticket_number=task.ticket_number,
        operation_number=task.operation_number,
        old_status=old_task_status,
        new_status=task.status,
        remarks=remarks,
        request_path=f"/operation-tasks/{task_id}/admin-reject-approved-revoke",
        details={
            "task_type": task.task_type,
            "correction_request_id": correction_request.id,
            "request_number": correction_request.request_number,
        },
    )

    db.commit()
    db.refresh(correction_request)
    return build_correction_request_response(correction_request)


@router.post(
    "/{task_id}/admin-revoke-approved-transaction",
    response_model=ApprovedTransactionCorrectionRequestResponse,
)
def admin_revoke_approved_transaction_from_task(
    task_id: int,
    payload: ApprovedTransactionCorrectionAdminAction,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    from app.routers.correction_requests import reverse_tank_stock_ledger_for_revoked_transaction
    create_approval_task = create_operation_approval_task_for_transaction

    require_user_permission(current_user, "Admin Revoke Approved Transaction", db)
    task = db.query(OperationTask).filter(OperationTask.id == task_id).first()
    if not task or task.task_type != "APPROVED_TRANSACTION_REVOKE_REQUEST":
        raise HTTPException(status_code=404, detail="Approved transaction revoke task not found")
    if task.status not in ["Pending", "In Progress"]:
        raise HTTPException(status_code=400, detail="Only open revoke tasks can be acted on")
    if not user_can_act_on_operation_task(db, current_user, task):
        raise HTTPException(status_code=403, detail="You are not assigned to this task")

    correction_request = get_pending_correction_request_for_task(db, task.id)
    transaction = (
        db.query(OperationTransaction)
        .filter(OperationTransaction.id == correction_request.transaction_id)
        .first()
    )
    if not transaction:
        raise HTTPException(status_code=404, detail="Operation transaction not found")
    if transaction.status != APPROVED_TRANSACTION_STATUS:
        raise HTTPException(
            status_code=400,
            detail="Only currently Approved transactions can be revoked",
        )

    remarks = clean_optional_text(payload.remarks) or "Admin revoked approval for operational correction"
    changed_by = get_current_user_display_name(current_user)
    old_transaction_status = transaction.status

    ledger_result = reverse_tank_stock_ledger_for_revoked_transaction(
        db=db,
        transaction=transaction,
    )

    transaction.status = "Submitted"
    transaction.updated_at = datetime.now()
    existing_remarks = transaction.remarks or ""
    transaction.remarks = (
        f"{existing_remarks}\n"
        f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] "
        f"{changed_by} revoked approval from {old_transaction_status} to Submitted: "
        f"{remarks}"
    ).strip()

    history = OperationTransactionStatusHistory(
        transaction_id=transaction.id,
        old_status=old_transaction_status,
        new_status="Submitted",
        changed_by=changed_by,
        remarks=f"[ADMIN APPROVAL REVOKE] {remarks}",
        changed_at=datetime.now(),
    )
    db.add(history)

    old_task_status = task.status
    task.status = "Approved"
    task.action_taken = "Admin Revoked"
    task.acted_by_user_id = current_user.id
    task.acted_at = datetime.now()
    task.remarks = remarks
    task.updated_at = datetime.now()

    correction_request.status = "Admin Revoked"
    correction_request.admin_action = "Revoked"
    correction_request.admin_remarks = remarks
    correction_request.admin_user_id = current_user.id
    correction_request.admin_action_at = datetime.now()
    correction_request.previous_status_before_revoke = old_transaction_status
    correction_request.new_status_after_revoke = "Submitted"
    correction_request.updated_at = datetime.now()

    add_operation_task_event(
        db=db,
        task=task,
        event_type="Admin Revoked",
        current_user=current_user,
        old_status=old_task_status,
        new_status=task.status,
        notes=remarks,
        details={
            "correction_request_id": correction_request.id,
            "old_transaction_status": old_transaction_status,
            "new_transaction_status": "Submitted",
            "ledger_result": ledger_result,
        },
    )

    approval_task = create_approval_task(
        db=db,
        transaction=transaction,
        current_user=current_user,
    )

    create_audit_log(
        db=db,
        module_name="Operation Transaction",
        action="Admin Revoke Approved Transaction",
        current_user=current_user,
        entity_type="OperationTransaction",
        entity_id=transaction.id,
        entity_label=get_transaction_ticket_number(transaction),
        ticket_number=get_transaction_ticket_number(transaction),
        operation_number=transaction.operation_number,
        old_status=old_transaction_status,
        new_status="Submitted",
        remarks=remarks,
        request_path=f"/operation-tasks/{task_id}/admin-revoke-approved-transaction",
        details={
            "correction_request_id": correction_request.id,
            "correction_request_number": correction_request.request_number,
            "request_type": correction_request.request_type,
            "suggested_action": correction_request.suggested_action,
            "reason": correction_request.reason,
            "revoke_task_id": task.id,
            "new_approval_task_id": approval_task.id,
            "ledger_result": ledger_result,
        },
    )

    create_audit_log(
        db=db,
        module_name="Operation Transaction Correction",
        action="Admin Revoke Approved Transaction Correction Request",
        current_user=current_user,
        entity_type="ApprovedTransactionCorrectionRequest",
        entity_id=correction_request.id,
        entity_label=correction_request.request_number,
        ticket_number=correction_request.ticket_number,
        operation_number=correction_request.operation_number,
        old_status="Pending Admin Review",
        new_status=correction_request.status,
        remarks=remarks,
        request_path=f"/operation-tasks/{task_id}/admin-revoke-approved-transaction",
        details={
            "transaction_id": transaction.id,
            "old_transaction_status": old_transaction_status,
            "new_transaction_status": "Submitted",
            "new_approval_task_id": approval_task.id,
        },
    )

    create_audit_log(
        db=db,
        module_name="Operation Task",
        action="Task Admin Revoked",
        current_user=current_user,
        entity_type="OperationTask",
        entity_id=task.id,
        entity_label=task.task_number,
        ticket_number=task.ticket_number,
        operation_number=task.operation_number,
        old_status=old_task_status,
        new_status=task.status,
        remarks=remarks,
        request_path=f"/operation-tasks/{task_id}/admin-revoke-approved-transaction",
        details={
            "task_type": task.task_type,
            "correction_request_id": correction_request.id,
            "request_number": correction_request.request_number,
            "new_approval_task_id": approval_task.id,
        },
    )

    create_audit_log(
        db=db,
        module_name="Tank Stock Ledger",
        action="Reverse Ledger Rows On Approval Revoke",
        current_user=current_user,
        entity_type="OperationTransaction",
        entity_id=transaction.id,
        entity_label=get_transaction_ticket_number(transaction),
        ticket_number=get_transaction_ticket_number(transaction),
        operation_number=transaction.operation_number,
        remarks="Derived tank stock ledger rows reversed because approval was revoked",
        request_path=f"/operation-tasks/{task_id}/admin-revoke-approved-transaction",
        details=ledger_result,
    )

    db.commit()
    db.refresh(correction_request)
    return build_correction_request_response(correction_request)
