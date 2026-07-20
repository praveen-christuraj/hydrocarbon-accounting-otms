from fastapi.encoders import jsonable_encoder
from sqlalchemy.orm import Session

from app.models import AuditLog, User
from app.utils.helpers import get_current_user_display_name


def create_audit_log(
    db: Session,
    module_name: str,
    action: str,
    current_user: User | None = None,
    entity_type: str | None = None,
    entity_id: int | None = None,
    entity_label: str | None = None,
    ticket_number: str | None = None,
    operation_number: str | None = None,
    old_status: str | None = None,
    new_status: str | None = None,
    remarks: str | None = None,
    request_path: str | None = None,
    details: dict | None = None,
):
    performed_by = None

    if current_user:
        performed_by = get_current_user_display_name(current_user)

    safe_details = jsonable_encoder(details) if details is not None else None

    audit_log = AuditLog(
        module_name=module_name,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        entity_label=entity_label,
        ticket_number=ticket_number,
        operation_number=operation_number,
        old_status=old_status,
        new_status=new_status,
        performed_by=performed_by,
        remarks=remarks,
        request_path=request_path,
        details=safe_details,
    )

    db.add(audit_log)
    return audit_log


def build_audit_log_response(audit_log: AuditLog):
    return {
        "id": audit_log.id,
        "module_name": audit_log.module_name,
        "action": audit_log.action,
        "entity_type": audit_log.entity_type,
        "entity_id": audit_log.entity_id,
        "entity_label": audit_log.entity_label,
        "ticket_number": audit_log.ticket_number,
        "operation_number": audit_log.operation_number,
        "old_status": audit_log.old_status,
        "new_status": audit_log.new_status,
        "performed_by": audit_log.performed_by,
        "remarks": audit_log.remarks,
        "request_path": audit_log.request_path,
        "details": audit_log.details,
        "created_at": audit_log.created_at,
    }
