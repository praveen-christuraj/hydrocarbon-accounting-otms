from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Asset, AssetType, Location, AssetCalibrationTable, AssetAssignment, FlowmeterConfig, User
from app.schemas import AssetCreate, AssetResponse
from app.dependencies.auth import get_current_user_from_token
from app.dependencies.permissions import require_user_permission
from app.services.audit_service import create_audit_log
from app.utils.helpers import clean_optional_text
from app.utils.pagination import paginate_query

router = APIRouter(prefix="/assets", tags=["Assets"])


@router.get("")
def get_assets(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    search: str | None = Query(None),
    asset_type_code: str | None = Query(None),
    location_code: str | None = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_from_token),
):
    require_user_permission(current_user, "View Asset", db)
    query = db.query(Asset).order_by(Asset.id)
    if search:
        query = query.filter(
            or_(
                Asset.asset_name.ilike(f"%{search}%"),
                Asset.asset_code.ilike(f"%{search}%"),
            )
        )
    if asset_type_code:
        query = query.filter(Asset.asset_type_code == asset_type_code)
    if location_code:
        query = query.filter(Asset.location_code == location_code)
    result = paginate_query(query, skip, limit)
    return {
        "items": [AssetResponse.model_validate(a) for a in result["items"]],
        "total": result["total"],
        "skip": result["skip"],
        "limit": result["limit"],
        "has_more": result["has_more"],
    }


@router.post("", response_model=AssetResponse)
def create_asset(
    asset: AssetCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage Asset",
        db,
    )

    existing_asset = db.query(Asset).filter(
        Asset.asset_code.ilike(asset.asset_code)
    ).first()

    if existing_asset:
        raise HTTPException(
            status_code=400,
            detail="Asset code already exists",
        )

    asset_type = db.query(AssetType).filter(
        AssetType.asset_type_code.ilike(asset.asset_type_code)
    ).first()

    if not asset_type:
        raise HTTPException(
            status_code=400,
            detail="Asset type not found",
        )

    if asset.asset_scope not in ["Local", "Global"]:
        raise HTTPException(
            status_code=400,
            detail="Asset scope must be Local or Global",
        )

    location_code = clean_optional_text(asset.location_code)

    if asset.asset_scope == "Local" and location_code is None:
        raise HTTPException(
            status_code=400,
            detail="Location is required for Local assets",
        )

    if asset.asset_scope == "Local":
        location = db.query(Location).filter(
            Location.location_code.ilike(location_code)
        ).first()

        if not location:
            raise HTTPException(
                status_code=400,
                detail="Location not found",
            )

        if location.status != "Active":
            raise HTTPException(
                status_code=400,
                detail="Only Active location can be used for Local assets",
            )

    new_asset = Asset(
        asset_name=asset.asset_name.strip(),
        asset_code=asset.asset_code.strip(),
        asset_scope=asset.asset_scope,
        asset_type_code=asset.asset_type_code.strip(),
        location_code=location_code if asset.asset_scope == "Local" else None,
        serial_number=clean_optional_text(asset.serial_number),
        manufacturer=clean_optional_text(asset.manufacturer),
        model=clean_optional_text(asset.model),
        commission_date=asset.commission_date,
        description=clean_optional_text(asset.description),
        status=asset.status,
    )

    db.add(new_asset)
    db.flush()

    after_data = {
        "asset_name": new_asset.asset_name,
        "asset_code": new_asset.asset_code,
        "asset_scope": new_asset.asset_scope,
        "asset_type_code": new_asset.asset_type_code,
        "location_code": new_asset.location_code,
        "serial_number": new_asset.serial_number,
        "manufacturer": new_asset.manufacturer,
        "model": new_asset.model,
        "commission_date": str(new_asset.commission_date) if new_asset.commission_date else None,
        "description": new_asset.description,
        "status": new_asset.status,
    }

    create_audit_log(
        db=db,
        module_name="Asset Master",
        action="Create Asset",
        current_user=current_user,
        entity_type="Asset",
        entity_id=new_asset.id,
        entity_label=f"{new_asset.asset_name} ({new_asset.asset_code})",
        remarks="Asset created",
        request_path="/assets",
        details={"after": after_data},
    )

    db.commit()
    db.refresh(new_asset)

    return new_asset


@router.put("/{asset_id}", response_model=AssetResponse)
def update_asset(
    asset_id: int,
    asset: AssetCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage Asset",
        db,
    )

    existing_asset = db.query(Asset).filter(
        Asset.id == asset_id
    ).first()

    if not existing_asset:
        raise HTTPException(
            status_code=404,
            detail="Asset not found",
        )

    duplicate_asset = db.query(Asset).filter(
        Asset.asset_code.ilike(asset.asset_code),
        Asset.id != asset_id,
    ).first()

    if duplicate_asset:
        raise HTTPException(
            status_code=400,
            detail="Asset code already exists",
        )

    asset_type = db.query(AssetType).filter(
        AssetType.asset_type_code.ilike(asset.asset_type_code)
    ).first()

    if not asset_type:
        raise HTTPException(
            status_code=400,
            detail="Asset type not found",
        )

    if asset.asset_scope not in ["Local", "Global"]:
        raise HTTPException(
            status_code=400,
            detail="Asset scope must be Local or Global",
        )

    location_code = clean_optional_text(asset.location_code)

    if asset.asset_scope == "Local" and location_code is None:
        raise HTTPException(
            status_code=400,
            detail="Location is required for Local assets",
        )

    if asset.asset_scope == "Local":
        location = db.query(Location).filter(
            Location.location_code.ilike(location_code)
        ).first()

        if not location:
            raise HTTPException(
                status_code=400,
                detail="Location not found",
            )

        if location.status != "Active":
            raise HTTPException(
                status_code=400,
                detail="Only Active location can be used for Local assets",
            )

    before_data = {
        "asset_name": existing_asset.asset_name,
        "asset_code": existing_asset.asset_code,
        "asset_scope": existing_asset.asset_scope,
        "asset_type_code": existing_asset.asset_type_code,
        "location_code": existing_asset.location_code,
        "serial_number": existing_asset.serial_number,
        "manufacturer": existing_asset.manufacturer,
        "model": existing_asset.model,
        "commission_date": str(existing_asset.commission_date) if existing_asset.commission_date else None,
        "description": existing_asset.description,
        "status": existing_asset.status,
    }

    existing_asset.asset_name = asset.asset_name.strip()
    existing_asset.asset_code = asset.asset_code.strip()
    existing_asset.asset_scope = asset.asset_scope
    existing_asset.asset_type_code = asset.asset_type_code.strip()
    existing_asset.location_code = (
        location_code if asset.asset_scope == "Local" else None
    )
    existing_asset.serial_number = clean_optional_text(asset.serial_number)
    existing_asset.manufacturer = clean_optional_text(asset.manufacturer)
    existing_asset.model = clean_optional_text(asset.model)
    existing_asset.commission_date = asset.commission_date
    existing_asset.description = clean_optional_text(asset.description)
    existing_asset.status = asset.status

    after_data = {
        "asset_name": existing_asset.asset_name,
        "asset_code": existing_asset.asset_code,
        "asset_scope": existing_asset.asset_scope,
        "asset_type_code": existing_asset.asset_type_code,
        "location_code": existing_asset.location_code,
        "serial_number": existing_asset.serial_number,
        "manufacturer": existing_asset.manufacturer,
        "model": existing_asset.model,
        "commission_date": str(existing_asset.commission_date) if existing_asset.commission_date else None,
        "description": existing_asset.description,
        "status": existing_asset.status,
    }

    create_audit_log(
        db=db,
        module_name="Asset Master",
        action="Update Asset",
        current_user=current_user,
        entity_type="Asset",
        entity_id=existing_asset.id,
        entity_label=f"{existing_asset.asset_name} ({existing_asset.asset_code})",
        remarks="Asset updated",
        request_path=f"/assets/{asset_id}",
        details={"before": before_data, "after": after_data},
    )

    db.commit()
    db.refresh(existing_asset)

    return existing_asset


@router.delete("/{asset_id}")
def delete_asset(
    asset_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage Asset",
        db,
    )

    existing_asset = db.query(Asset).filter(
        Asset.id == asset_id
    ).first()

    if not existing_asset:
        raise HTTPException(
            status_code=404,
            detail="Asset not found",
        )

    calibration_table = db.query(AssetCalibrationTable).filter(
        AssetCalibrationTable.asset_code.ilike(existing_asset.asset_code)
    ).first()

    if calibration_table:
        raise HTTPException(
            status_code=400,
            detail="Cannot delete asset because calibration table exists for this asset",
        )

    assignment = db.query(AssetAssignment).filter(
        AssetAssignment.asset_code.ilike(existing_asset.asset_code)
    ).first()

    if assignment:
        raise HTTPException(
            status_code=400,
            detail="Cannot delete asset because assignment history exists for this asset",
        )

    flowmeter_config = db.query(FlowmeterConfig).filter(
        FlowmeterConfig.asset_code.ilike(existing_asset.asset_code)
    ).first()
    if flowmeter_config:
        raise HTTPException(
            status_code=400,
            detail="Cannot delete stream asset because flowmeters are configured under this stream",
        )

    deleted_data = {
        "asset_name": existing_asset.asset_name,
        "asset_code": existing_asset.asset_code,
        "asset_scope": existing_asset.asset_scope,
        "asset_type_code": existing_asset.asset_type_code,
        "location_code": existing_asset.location_code,
        "serial_number": existing_asset.serial_number,
        "manufacturer": existing_asset.manufacturer,
        "model": existing_asset.model,
        "commission_date": str(existing_asset.commission_date) if existing_asset.commission_date else None,
        "description": existing_asset.description,
        "status": existing_asset.status,
    }

    create_audit_log(
        db=db,
        module_name="Asset Master",
        action="Delete Asset",
        current_user=current_user,
        entity_type="Asset",
        entity_id=existing_asset.id,
        entity_label=f"{existing_asset.asset_name} ({existing_asset.asset_code})",
        remarks="Asset deleted",
        request_path=f"/assets/{asset_id}",
        details={"deleted": deleted_data},
    )

    db.delete(existing_asset)
    db.commit()

    return {"message": "Asset deleted successfully"}