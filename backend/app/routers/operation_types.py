from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import OperationType, AssetType, OperationTemplate, OperationTransaction, User
from app.schemas import OperationTypeCreate, OperationTypeResponse
from app.dependencies.auth import get_current_user_from_token
from app.dependencies.permissions import require_user_permission
from app.services.audit_service import create_audit_log
from app.utils.helpers import clean_optional_text

router = APIRouter(prefix="/operation-types", tags=["Operation Types"])


@router.get("", response_model=list[OperationTypeResponse])
def get_operation_types(
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "View Operation Type", db)

    operation_types = db.query(OperationType).order_by(OperationType.id).all()
    return operation_types


@router.post("", response_model=OperationTypeResponse)
def create_operation_type(
    operation_type: OperationTypeCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Manage Operation Type", db)

    existing_operation_type = (
        db.query(OperationType)
        .filter(OperationType.operation_type_code.ilike(operation_type.operation_type_code))
        .first()
    )
    if existing_operation_type:
        raise HTTPException(status_code=400, detail="Operation type code already exists")

    asset_type = (
        db.query(AssetType)
        .filter(AssetType.asset_type_code.ilike(operation_type.applicable_asset_type_code))
        .first()
    )
    if not asset_type:
        raise HTTPException(status_code=400, detail="Applicable asset type not found")

    new_operation_type = OperationType(
        operation_type_name=operation_type.operation_type_name.strip(),
        operation_type_code=operation_type.operation_type_code.strip(),
        operation_category=operation_type.operation_category,
        applicable_asset_type_code=operation_type.applicable_asset_type_code.strip(),
        requires_sender_location=operation_type.requires_sender_location,
        requires_receiver_location=operation_type.requires_receiver_location,
        requires_comparison=operation_type.requires_comparison,
        requires_approval=operation_type.requires_approval,
        description=clean_optional_text(operation_type.description),
        status=operation_type.status,
    )

    db.add(new_operation_type)
    db.flush()

    after_data = {
        "operation_type_name": new_operation_type.operation_type_name,
        "operation_type_code": new_operation_type.operation_type_code,
        "operation_category": new_operation_type.operation_category,
        "applicable_asset_type_code": new_operation_type.applicable_asset_type_code,
        "requires_sender_location": new_operation_type.requires_sender_location,
        "requires_receiver_location": new_operation_type.requires_receiver_location,
        "requires_comparison": new_operation_type.requires_comparison,
        "requires_approval": new_operation_type.requires_approval,
        "description": new_operation_type.description,
        "status": new_operation_type.status,
    }

    create_audit_log(
        db=db,
        module_name="Operations",
        action="Create Operation Type",
        current_user=current_user,
        entity_type="OperationType",
        entity_id=new_operation_type.id,
        entity_label=f"{new_operation_type.operation_type_name} ({new_operation_type.operation_type_code})",
        remarks="Operation type created",
        request_path="/operation-types",
        details={"after": after_data},
    )

    db.commit()
    db.refresh(new_operation_type)
    return new_operation_type


@router.put("/{operation_type_id}", response_model=OperationTypeResponse)
def update_operation_type(
    operation_type_id: int,
    operation_type: OperationTypeCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Manage Operation Type", db)

    existing_operation_type = (
        db.query(OperationType)
        .filter(OperationType.id == operation_type_id)
        .first()
    )
    if not existing_operation_type:
        raise HTTPException(status_code=404, detail="Operation type not found")

    duplicate_operation_type = (
        db.query(OperationType)
        .filter(
            OperationType.operation_type_code.ilike(operation_type.operation_type_code),
            OperationType.id != operation_type_id,
        )
        .first()
    )
    if duplicate_operation_type:
        raise HTTPException(status_code=400, detail="Operation type code already exists")

    asset_type = (
        db.query(AssetType)
        .filter(AssetType.asset_type_code.ilike(operation_type.applicable_asset_type_code))
        .first()
    )
    if not asset_type:
        raise HTTPException(status_code=400, detail="Applicable asset type not found")

    before_data = {
        "operation_type_name": existing_operation_type.operation_type_name,
        "operation_type_code": existing_operation_type.operation_type_code,
        "operation_category": existing_operation_type.operation_category,
        "applicable_asset_type_code": existing_operation_type.applicable_asset_type_code,
        "requires_sender_location": existing_operation_type.requires_sender_location,
        "requires_receiver_location": existing_operation_type.requires_receiver_location,
        "requires_comparison": existing_operation_type.requires_comparison,
        "requires_approval": existing_operation_type.requires_approval,
        "description": existing_operation_type.description,
        "status": existing_operation_type.status,
    }

    existing_operation_type.operation_type_name = operation_type.operation_type_name.strip()
    existing_operation_type.operation_type_code = operation_type.operation_type_code.strip()
    existing_operation_type.operation_category = operation_type.operation_category
    existing_operation_type.applicable_asset_type_code = operation_type.applicable_asset_type_code.strip()
    existing_operation_type.requires_sender_location = operation_type.requires_sender_location
    existing_operation_type.requires_receiver_location = operation_type.requires_receiver_location
    existing_operation_type.requires_comparison = operation_type.requires_comparison
    existing_operation_type.requires_approval = operation_type.requires_approval
    existing_operation_type.description = clean_optional_text(operation_type.description)
    existing_operation_type.status = operation_type.status

    after_data = {
        "operation_type_name": existing_operation_type.operation_type_name,
        "operation_type_code": existing_operation_type.operation_type_code,
        "operation_category": existing_operation_type.operation_category,
        "applicable_asset_type_code": existing_operation_type.applicable_asset_type_code,
        "requires_sender_location": existing_operation_type.requires_sender_location,
        "requires_receiver_location": existing_operation_type.requires_receiver_location,
        "requires_comparison": existing_operation_type.requires_comparison,
        "requires_approval": existing_operation_type.requires_approval,
        "description": existing_operation_type.description,
        "status": existing_operation_type.status,
    }

    create_audit_log(
        db=db,
        module_name="Operations",
        action="Update Operation Type",
        current_user=current_user,
        entity_type="OperationType",
        entity_id=existing_operation_type.id,
        entity_label=f"{existing_operation_type.operation_type_name} ({existing_operation_type.operation_type_code})",
        remarks="Operation type updated",
        request_path=f"/operation-types/{operation_type_id}",
        details={"before": before_data, "after": after_data},
    )

    db.commit()
    db.refresh(existing_operation_type)
    return existing_operation_type


@router.delete("/{operation_type_id}")
def delete_operation_type(
    operation_type_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Manage Operation Type", db)

    existing_operation_type = (
        db.query(OperationType)
        .filter(OperationType.id == operation_type_id)
        .first()
    )
    if not existing_operation_type:
        raise HTTPException(status_code=404, detail="Operation type not found")

    operation_template = (
        db.query(OperationTemplate)
        .filter(OperationTemplate.operation_type_code.ilike(existing_operation_type.operation_type_code))
        .first()
    )
    if operation_template:
        raise HTTPException(
            status_code=400,
            detail="Cannot delete operation type because operation templates exist for it",
        )

    operation_transaction = (
        db.query(OperationTransaction)
        .filter(OperationTransaction.operation_type_code.ilike(existing_operation_type.operation_type_code))
        .first()
    )
    if operation_transaction:
        raise HTTPException(
            status_code=400,
            detail="Cannot delete operation type because transactions exist for it",
        )

    deleted_data = {
        "operation_type_name": existing_operation_type.operation_type_name,
        "operation_type_code": existing_operation_type.operation_type_code,
        "operation_category": existing_operation_type.operation_category,
        "applicable_asset_type_code": existing_operation_type.applicable_asset_type_code,
        "requires_sender_location": existing_operation_type.requires_sender_location,
        "requires_receiver_location": existing_operation_type.requires_receiver_location,
        "requires_comparison": existing_operation_type.requires_comparison,
        "requires_approval": existing_operation_type.requires_approval,
        "description": existing_operation_type.description,
        "status": existing_operation_type.status,
    }

    create_audit_log(
        db=db,
        module_name="Operations",
        action="Delete Operation Type",
        current_user=current_user,
        entity_type="OperationType",
        entity_id=existing_operation_type.id,
        entity_label=f"{existing_operation_type.operation_type_name} ({existing_operation_type.operation_type_code})",
        remarks="Operation type deleted",
        request_path=f"/operation-types/{operation_type_id}",
        details={"deleted": deleted_data},
    )

    db.delete(existing_operation_type)
    db.commit()

    return {"message": "Operation type deleted successfully"}