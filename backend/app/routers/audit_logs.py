from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import AuditLog, User
from app.schemas import AuditLogResponse
from app.dependencies.auth import get_current_user_from_token
from app.dependencies.permissions import require_user_permission
from app.services.audit_service import build_audit_log_response

router = APIRouter(prefix="/audit-logs", tags=["Audit Logs"])


@router.get("/", response_model=list[AuditLogResponse])
def get_audit_logs(
    module_name: str | None = None,
    action: str | None = None,
    entity_type: str | None = None,
    ticket_number: str | None = None,
    operation_number: str | None = None,
    performed_by: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    limit: int = 200,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "View Audit Log",
        db,
    )

    query = db.query(AuditLog)

    if module_name:
        query = query.filter(AuditLog.module_name.ilike(f"%{module_name.strip()}%"))

    if action:
        query = query.filter(AuditLog.action.ilike(f"%{action.strip()}%"))

    if entity_type:
        query = query.filter(AuditLog.entity_type.ilike(f"%{entity_type.strip()}%"))

    if ticket_number:
        query = query.filter(AuditLog.ticket_number.ilike(f"%{ticket_number.strip()}%"))

    if operation_number:
        query = query.filter(
            AuditLog.operation_number.ilike(f"%{operation_number.strip()}%")
        )

    if performed_by:
        query = query.filter(AuditLog.performed_by.ilike(f"%{performed_by.strip()}%"))

    if date_from:
        try:
            parsed_date_from = datetime.fromisoformat(date_from)
            query = query.filter(AuditLog.created_at >= parsed_date_from)
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail="date_from must be in ISO format, for example 2026-05-13",
            )

    if date_to:
        try:
            parsed_date_to = datetime.fromisoformat(date_to)
            query = query.filter(AuditLog.created_at <= parsed_date_to)
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail="date_to must be in ISO format, for example 2026-05-13",
            )

    safe_limit = min(max(limit, 1), 1000)

    audit_logs = (
        query.order_by(AuditLog.id.desc())
        .limit(safe_limit)
        .all()
    )

    return [
        build_audit_log_response(audit_log)
        for audit_log in audit_logs
    ]


@router.get("/{audit_log_id}", response_model=AuditLogResponse)
def get_audit_log_by_id(
    audit_log_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "View Audit Log",
        db,
    )

    audit_log = db.query(AuditLog).filter(AuditLog.id == audit_log_id).first()

    if not audit_log:
        raise HTTPException(
            status_code=404,
            detail="Audit log not found",
        )

    return build_audit_log_response(audit_log)
