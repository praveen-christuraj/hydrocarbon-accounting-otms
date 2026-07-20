from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import AssetType, Asset, User
from app.schemas import AssetTypeCreate, AssetTypeResponse
from app.dependencies.auth import get_current_user_from_token
from app.dependencies.permissions import require_user_permission
from app.services.audit_service import create_audit_log
from app.utils.pagination import paginate_query

router = APIRouter(prefix="/asset-types", tags=["Asset Types"])


@router.get("")
def get_asset_types(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    search: str | None = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_from_token),
):
    require_user_permission(current_user, "View Asset Type", db)
    query = db.query(AssetType).order_by(AssetType.id)
    if search:
        query = query.filter(
            or_(
                AssetType.asset_type_name.ilike(f"%{search}%"),
                AssetType.asset_type_code.ilike(f"%{search}%"),
            )
        )
    result = paginate_query(query, skip, limit)
    return {
        "items": [AssetTypeResponse.model_validate(a) for a in result["items"]],
        "total": result["total"],
        "skip": result["skip"],
        "limit": result["limit"],
        "has_more": result["has_more"],
    }


@router.post("", response_model=AssetTypeResponse)
def create_asset_type(
    asset_type: AssetTypeCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Manage Asset Type", db)

    existing_asset_type = db.query(AssetType).filter(
        AssetType.asset_type_code.ilike(asset_type.asset_type_code)
    ).first()

    if existing_asset_type:
        raise HTTPException(status_code=400, detail="Asset Type Code already exists")

    new_asset_type = AssetType(
        asset_type_name=asset_type.asset_type_name,
        asset_type_code=asset_type.asset_type_code,
        description=asset_type.description,
        status=asset_type.status,
    )

    db.add(new_asset_type)
    db.flush()

    after_data = {
        "asset_type_name": new_asset_type.asset_type_name,
        "asset_type_code": new_asset_type.asset_type_code,
        "description": new_asset_type.description,
        "status": new_asset_type.status,
    }

    create_audit_log(
        db=db,
        module_name="Asset Type Master",
        action="Create Asset Type",
        current_user=current_user,
        entity_type="AssetType",
        entity_id=new_asset_type.id,
        entity_label=f"{new_asset_type.asset_type_name} ({new_asset_type.asset_type_code})",
        remarks="Asset type created",
        request_path="/asset-types",
        details={"after": after_data},
    )

    db.commit()
    db.refresh(new_asset_type)
    return new_asset_type


@router.put("/{asset_type_id}", response_model=AssetTypeResponse)
def update_asset_type(
    asset_type_id: int,
    asset_type: AssetTypeCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Manage Asset Type", db)

    existing_asset_type = db.query(AssetType).filter(
        AssetType.id == asset_type_id
    ).first()

    if not existing_asset_type:
        raise HTTPException(status_code=404, detail="Asset Type not found")

    duplicate_asset_type = db.query(AssetType).filter(
        AssetType.asset_type_code.ilike(asset_type.asset_type_code),
        AssetType.id != asset_type_id,
    ).first()

    if duplicate_asset_type:
        raise HTTPException(status_code=400, detail="Asset Type Code already exists")

    before_data = {
        "asset_type_name": existing_asset_type.asset_type_name,
        "asset_type_code": existing_asset_type.asset_type_code,
        "description": existing_asset_type.description,
        "status": existing_asset_type.status,
    }

    existing_asset_type.asset_type_name = asset_type.asset_type_name
    existing_asset_type.asset_type_code = asset_type.asset_type_code
    existing_asset_type.description = asset_type.description
    existing_asset_type.status = asset_type.status

    after_data = {
        "asset_type_name": existing_asset_type.asset_type_name,
        "asset_type_code": existing_asset_type.asset_type_code,
        "description": existing_asset_type.description,
        "status": existing_asset_type.status,
    }

    create_audit_log(
        db=db,
        module_name="Asset Type Master",
        action="Update Asset Type",
        current_user=current_user,
        entity_type="AssetType",
        entity_id=existing_asset_type.id,
        entity_label=f"{existing_asset_type.asset_type_name} ({existing_asset_type.asset_type_code})",
        remarks="Asset type updated",
        request_path=f"/asset-types/{asset_type_id}",
        details={"before": before_data, "after": after_data},
    )

    db.commit()
    db.refresh(existing_asset_type)
    return existing_asset_type


@router.delete("/{asset_type_id}")
def delete_asset_type(
    asset_type_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Manage Asset Type", db)

    existing_asset_type = db.query(AssetType).filter(
        AssetType.id == asset_type_id
    ).first()

    if not existing_asset_type:
        raise HTTPException(status_code=404, detail="Asset Type not found")

    used_asset = db.query(Asset).filter(
        Asset.asset_type_code.ilike(existing_asset_type.asset_type_code)
    ).first()

    if used_asset:
        raise HTTPException(
            status_code=400,
            detail="Cannot delete asset type because it is already used by assets",
        )

    deleted_data = {
        "asset_type_name": existing_asset_type.asset_type_name,
        "asset_type_code": existing_asset_type.asset_type_code,
        "description": existing_asset_type.description,
        "status": existing_asset_type.status,
    }

    create_audit_log(
        db=db,
        module_name="Asset Type Master",
        action="Delete Asset Type",
        current_user=current_user,
        entity_type="AssetType",
        entity_id=existing_asset_type.id,
        entity_label=f"{existing_asset_type.asset_type_name} ({existing_asset_type.asset_type_code})",
        remarks="Asset type deleted",
        request_path=f"/asset-types/{asset_type_id}",
        details={"deleted": deleted_data},
    )

    db.delete(existing_asset_type)
    db.commit()

    return {"message": "Asset Type deleted successfully"}