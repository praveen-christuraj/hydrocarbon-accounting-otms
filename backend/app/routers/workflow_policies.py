from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import (
    OperationWorkflowPolicy,
    OperationWorkflowPolicyRole,
    OperationWorkflowPolicyUser,
    Role,
    User,
    OperationType,
    OperationTemplate,
    AssetType,
    Location,
)
from app.schemas import (
    OperationWorkflowPolicyCreate,
    OperationWorkflowPolicyUpdate,
    OperationWorkflowPolicyResponse,
    OperationWorkflowPolicyRoleAssignRequest,
    OperationWorkflowPolicyUserAssignRequest,
    OperationWorkflowPolicyCheckRequest,
    OperationWorkflowPolicyCheckResponse,
    OperationWorkflowPolicyRoleItem,
    OperationWorkflowPolicyUserItem,
)
from app.dependencies.auth import get_current_user_from_token
from app.dependencies.permissions import (
    require_user_permission,
    evaluate_operation_workflow_policy,
)
from app.services.audit_service import create_audit_log
from app.utils.helpers import clean_optional_text

router = APIRouter(prefix="/operation-workflow-policies", tags=["Operation Workflow Policies"])


def build_operation_workflow_policy_response(policy: OperationWorkflowPolicy, db: Session):
    role_rows = (
        db.query(OperationWorkflowPolicyRole, Role)
        .join(Role, Role.id == OperationWorkflowPolicyRole.role_id)
        .filter(OperationWorkflowPolicyRole.policy_id == policy.id)
        .all()
    )
    user_rows = (
        db.query(OperationWorkflowPolicyUser, User)
        .join(User, User.id == OperationWorkflowPolicyUser.user_id)
        .filter(OperationWorkflowPolicyUser.policy_id == policy.id)
        .all()
    )
    return {
        "id": policy.id,
        "policy_name": policy.policy_name,
        "action_code": policy.action_code,
        "operation_type_code": policy.operation_type_code,
        "operation_template_id": policy.operation_template_id,
        "asset_type_code": policy.asset_type_code,
        "location_code": policy.location_code,
        "priority": policy.priority,
        "status": policy.status,
        "roles": [
            {"role_id": r.id, "role_name": r.role_name}
            for _, r in role_rows
        ],
        "users": [
            {
                "user_id": u.id,
                "username": u.username,
                "full_name": u.full_name,
                "mode": policy_user.mode,
            }
            for policy_user, u in user_rows
        ],
        "created_at": policy.created_at,
        "updated_at": policy.updated_at,
    }


@router.get("", response_model=list[OperationWorkflowPolicyResponse])
def get_operation_workflow_policies(
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "View Operation Workflow Policy", db)
    rows = db.query(OperationWorkflowPolicy).order_by(
        OperationWorkflowPolicy.priority.asc(),
        OperationWorkflowPolicy.id.asc(),
    ).all()
    return [build_operation_workflow_policy_response(row, db) for row in rows]


@router.post("", response_model=OperationWorkflowPolicyResponse)
def create_operation_workflow_policy(
    payload: OperationWorkflowPolicyCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Manage Operation Workflow Policy", db)
    policy = OperationWorkflowPolicy(
        policy_name=str(payload.policy_name or "").strip(),
        action_code=str(payload.action_code or "").strip().upper(),
        operation_type_code=clean_optional_text(payload.operation_type_code),
        operation_template_id=payload.operation_template_id,
        asset_type_code=clean_optional_text(payload.asset_type_code),
        location_code=clean_optional_text(payload.location_code),
        priority=payload.priority or 100,
        status=payload.status or "Active",
    )
    if policy.policy_name == "" or policy.action_code == "":
        raise HTTPException(status_code=400, detail="policy_name and action_code are required")
    db.add(policy)
    db.flush()

    for role_id in sorted(set(payload.role_ids or [])):
        role = db.query(Role).filter(Role.id == role_id).first()
        if role:
            db.add(OperationWorkflowPolicyRole(policy_id=policy.id, role_id=role.id))

    for item in payload.users or []:
        user = db.query(User).filter(User.id == item.user_id).first()
        if user:
            db.add(
                OperationWorkflowPolicyUser(
                    policy_id=policy.id,
                    user_id=user.id,
                    mode=str(item.mode or "ALLOW").upper(),
                )
            )

    create_audit_log(
        db=db,
        module_name="Operation Workflow Policy",
        action="Create Operation Workflow Policy",
        current_user=current_user,
        entity_type="OperationWorkflowPolicy",
        entity_id=policy.id,
        entity_label=policy.policy_name,
        remarks="Workflow policy created",
        request_path="/operation-workflow-policies",
        details={"action_code": policy.action_code, "priority": policy.priority, "status": policy.status},
    )
    db.commit()
    db.refresh(policy)
    return build_operation_workflow_policy_response(policy, db)


@router.put("/{policy_id}", response_model=OperationWorkflowPolicyResponse)
def update_operation_workflow_policy(
    policy_id: int,
    payload: OperationWorkflowPolicyUpdate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Manage Operation Workflow Policy", db)
    policy = db.query(OperationWorkflowPolicy).filter(OperationWorkflowPolicy.id == policy_id).first()
    if not policy:
        raise HTTPException(status_code=404, detail="Workflow policy not found")
    before = build_operation_workflow_policy_response(policy, db)

    if payload.policy_name is not None:
        policy.policy_name = str(payload.policy_name).strip()
    if payload.action_code is not None:
        policy.action_code = str(payload.action_code).strip().upper()
    if payload.operation_type_code is not None:
        policy.operation_type_code = clean_optional_text(payload.operation_type_code)
    if payload.operation_template_id is not None:
        policy.operation_template_id = payload.operation_template_id
    if payload.asset_type_code is not None:
        policy.asset_type_code = clean_optional_text(payload.asset_type_code)
    if payload.location_code is not None:
        policy.location_code = clean_optional_text(payload.location_code)
    if payload.priority is not None:
        policy.priority = payload.priority
    if payload.status is not None:
        policy.status = payload.status
    policy.updated_at = datetime.now()

    after = build_operation_workflow_policy_response(policy, db)
    create_audit_log(
        db=db,
        module_name="Operation Workflow Policy",
        action="Update Operation Workflow Policy",
        current_user=current_user,
        entity_type="OperationWorkflowPolicy",
        entity_id=policy.id,
        entity_label=policy.policy_name,
        remarks="Workflow policy updated",
        request_path=f"/operation-workflow-policies/{policy_id}",
        details={"before": before, "after": after},
    )
    db.commit()
    db.refresh(policy)
    return build_operation_workflow_policy_response(policy, db)


@router.post("/{policy_id}/roles", response_model=OperationWorkflowPolicyResponse)
def save_operation_workflow_policy_roles(
    policy_id: int,
    payload: OperationWorkflowPolicyRoleAssignRequest,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Manage Operation Workflow Policy", db)
    policy = db.query(OperationWorkflowPolicy).filter(OperationWorkflowPolicy.id == policy_id).first()
    if not policy:
        raise HTTPException(status_code=404, detail="Workflow policy not found")
    db.query(OperationWorkflowPolicyRole).filter(OperationWorkflowPolicyRole.policy_id == policy_id).delete()
    for role_id in sorted(set(payload.role_ids or [])):
        role = db.query(Role).filter(Role.id == role_id).first()
        if role:
            db.add(OperationWorkflowPolicyRole(policy_id=policy_id, role_id=role.id))
    db.commit()
    db.refresh(policy)
    return build_operation_workflow_policy_response(policy, db)


@router.post("/{policy_id}/users", response_model=OperationWorkflowPolicyResponse)
def save_operation_workflow_policy_users(
    policy_id: int,
    payload: OperationWorkflowPolicyUserAssignRequest,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Manage Operation Workflow Policy", db)
    policy = db.query(OperationWorkflowPolicy).filter(OperationWorkflowPolicy.id == policy_id).first()
    if not policy:
        raise HTTPException(status_code=404, detail="Workflow policy not found")
    db.query(OperationWorkflowPolicyUser).filter(OperationWorkflowPolicyUser.policy_id == policy_id).delete()
    for item in payload.users or []:
        user = db.query(User).filter(User.id == item.user_id).first()
        if user:
            db.add(
                OperationWorkflowPolicyUser(
                    policy_id=policy_id,
                    user_id=user.id,
                    mode=str(item.mode or "ALLOW").upper(),
                )
            )
    db.commit()
    db.refresh(policy)
    return build_operation_workflow_policy_response(policy, db)


@router.delete("/{policy_id}")
def delete_operation_workflow_policy(
    policy_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Manage Operation Workflow Policy", db)
    policy = db.query(OperationWorkflowPolicy).filter(OperationWorkflowPolicy.id == policy_id).first()
    if not policy:
        raise HTTPException(status_code=404, detail="Workflow policy not found")
    create_audit_log(
        db=db,
        module_name="Operation Workflow Policy",
        action="Delete Operation Workflow Policy",
        current_user=current_user,
        entity_type="OperationWorkflowPolicy",
        entity_id=policy.id,
        entity_label=policy.policy_name,
        remarks="Workflow policy deleted",
        request_path=f"/operation-workflow-policies/{policy_id}",
        details={"policy_name": policy.policy_name, "action_code": policy.action_code},
    )
    db.delete(policy)
    db.commit()
    return {"message": "Workflow policy deleted successfully"}


@router.post("/check", response_model=OperationWorkflowPolicyCheckResponse)
def check_operation_workflow_policy(
    payload: OperationWorkflowPolicyCheckRequest,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "View Operation Workflow Policy", db)
    allowed, reason, matched = evaluate_operation_workflow_policy(
        db=db,
        current_user=current_user,
        action_code=str(payload.action_code or "").upper(),
        operation_type_code=clean_optional_text(payload.operation_type_code),
        operation_template_id=payload.operation_template_id,
        asset_type_code=clean_optional_text(payload.asset_type_code),
        location_code=clean_optional_text(payload.location_code),
    )
    if allowed is None:
        return {"allowed": True, "reason": "No policy matched; fallback to legacy permission map"}
    return {
        "allowed": bool(allowed),
        "reason": reason,
        "matched_policy_id": matched.id if matched else None,
        "matched_policy_name": matched.policy_name if matched else None,
    }