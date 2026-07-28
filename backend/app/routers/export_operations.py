from datetime import datetime, date
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.database import get_db
from app.models import (
    ExportLocation, ExportEntity, ExportLocationEntity, ExportEntityBlock,
    ExportBlock, ExportPermit, ExportTransaction, ExportConfig, ExportConsignee, User
)
from app.schemas import (
    ExportLocationCreate, ExportLocationResponse,
    ExportEntityCreate, ExportEntityResponse,
    ExportBlockCreate, ExportBlockResponse,
    ExportPermitCreate, ExportPermitUpdate, ExportPermitResponse,
    ExportTransactionCreate, ExportTransactionUpdate, ExportTransactionResponse,
    ExportConfigCreate, ExportConfigResponse,
    ExportConsigneeCreate, ExportConsigneeUpdate, ExportConsigneeResponse,
    ExportDashboardResponse, BulkUploadRequest, BulkUploadItem,
    PermitBulkUploadRequest, PermitBulkUploadItem,
)
from app.dependencies.auth import get_current_user_from_token
from app.dependencies.permissions import require_user_permission
from app.services.audit_service import create_audit_log

router = APIRouter(prefix="/export-operations", tags=["Export Operations"])


def build_permit_quarter_code(quarter: str | None, year: str | int | None) -> str:
    if not quarter:
        return ""
    normalized_quarter = str(quarter).strip().upper()
    if "_" in normalized_quarter:
        return normalized_quarter
    if normalized_quarter.startswith("Q"):
        quarter_code = normalized_quarter
    else:
        quarter_code = f"Q{normalized_quarter}"
    if year is None:
        return quarter_code
    return f"{quarter_code}_{year}"


def parse_permit_quarter_code(code: str | None) -> tuple[str | None, int | None]:
    if not code:
        return None, None
    text = str(code).strip().upper()
    if "_" in text:
        quarter, year_text = text.split("_", 1)
        try:
            return quarter, int(year_text)
        except ValueError:
            return quarter, None
    return text, None


def expand_export_transaction_payloads(payload: dict) -> list[dict]:
    if payload.get("block_entries"):
        block_entries = payload["block_entries"]
        created = []
        for entry in block_entries:
            row = dict(payload)
            row.pop("block_entries", None)
            row["block_code"] = entry.get("block_code")
            row["volume"] = entry.get("volume", 0)
            row["quarter"] = get_quarter_from_date(payload.get("bl_date"))
            created.append(row)
        return created
    row = dict(payload)
    row.pop("block_entries", None)
    row["quarter"] = get_quarter_from_date(payload.get("bl_date"))
    return [row]


def get_quarter_from_date(d: date) -> str:
    month = d.month
    year = d.year
    if month <= 3:
        return f"Q1_{year}"
    elif month <= 6:
        return f"Q2_{year}"
    elif month <= 9:
        return f"Q3_{year}"
    else:
        return f"Q4_{year}"


def get_quarter_end_date(quarter: str | None, as_of_date: date | None = None) -> date | None:
    if not quarter:
        return None
    text = str(quarter).strip().upper()
    if "_" in text:
        quarter_code, year_text = text.split("_", 1)
    else:
        quarter_code = text
        year_text = str((as_of_date or date.today()).year)
    try:
        year = int(year_text)
    except ValueError:
        return None
    q = quarter_code.replace("Q", "")
    if q == "1":
        return date(year, 3, 31)
    if q == "2":
        return date(year, 6, 30)
    if q == "3":
        return date(year, 9, 30)
    if q == "4":
        return date(year, 12, 31)
    return None


def is_quarter_expired(quarter: str | None, as_of_date: date | None = None) -> bool:
    end_date = get_quarter_end_date(quarter, as_of_date=as_of_date)
    if not end_date:
        return False
    reference_date = as_of_date or date.today()
    return reference_date > end_date


def expire_permits_if_needed(db: Session, as_of_date: date | None = None):
    reference_date = as_of_date or date.today()
    permits = db.query(ExportPermit).filter(ExportPermit.status == "Active").all()
    for permit in permits:
        if is_quarter_expired(permit.quarter, as_of_date=reference_date):
            permit.status = "Expired"
            if not permit.remarks:
                permit.remarks = "Auto-expired after quarter ended"
    if permits:
        db.commit()


def calculate_used_permit_volume(db: Session, permit: ExportPermit) -> float:
    return db.query(func.coalesce(func.sum(ExportTransaction.volume), 0)).filter(
        ExportTransaction.permit_number == permit.permit_number,
        ExportTransaction.status == "Active",
    ).scalar() or 0


def validate_permit_limit(required_volume: float, remaining_volume: float, permit_number: str | None, block_code: str | None, override: bool = False):
    if not permit_number or not block_code:
        return None
    required = float(required_volume or 0)
    remaining = float(remaining_volume or 0)
    if required <= 0 or remaining >= required:
        return None
    if override:
        return None
    raise HTTPException(
        status_code=400,
        detail=f"Permit {permit_number} has insufficient remaining volume for block {block_code}. Required {required}, remaining {remaining}. Check override to save.",
    )


def build_delete_blocker_error(entity_type: str, has_active_blocks: bool = False, has_active_entities: bool = False):
    if entity_type == "entity" and has_active_blocks:
        raise HTTPException(status_code=400, detail="Cannot delete entity because it has active blocks")
    if entity_type == "location" and (has_active_entities or has_active_blocks):
        if has_active_entities and has_active_blocks:
            raise HTTPException(status_code=400, detail="Cannot delete location because it has active entities and blocks")
        if has_active_entities:
            raise HTTPException(status_code=400, detail="Cannot delete location because it has active entities")
        raise HTTPException(status_code=400, detail="Cannot delete location because it has active blocks")


def resolve_permit_allocation(db: Session, location_code: str, entity_code: str, block_code: str, quarter: str, required_volume: float, permit_number: str | None = None, override: bool = False):
    expire_permits_if_needed(db)
    query = db.query(ExportPermit).filter(
        ExportPermit.location_code == location_code,
        ExportPermit.entity_code == entity_code,
        ExportPermit.quarter == quarter,
        ExportPermit.status == "Active",
    )
    candidate_permits = query.all()
    if not candidate_permits:
        if override:
            return []
        raise HTTPException(status_code=400, detail="No active permit found for the selected block and quarter")

    ordered = []
    if permit_number:
        matching = [p for p in candidate_permits if p.permit_number == permit_number]
        other = [p for p in candidate_permits if p.permit_number != permit_number]
        ordered.extend(matching)
        ordered.extend(other)
    else:
        ordered = candidate_permits

    ordered = sorted(
        ordered,
        key=lambda permit: (
            0 if permit.block_code == block_code else 1,
            0 if permit.supplementary_permit != "Yes" else 1,
            permit.permit_number,
        ),
    )

    remaining_requirement = float(required_volume or 0)
    allocations = []
    for permit in ordered:
        if remaining_requirement <= 0:
            break
        remaining_volume = max(0, permit.permit_volume - calculate_used_permit_volume(db, permit))
        if remaining_volume <= 0:
            continue
        consumed = min(remaining_requirement, remaining_volume)
        allocations.append((permit.permit_number, consumed))
        remaining_requirement -= consumed

    if remaining_requirement > 0 and not override:
        raise HTTPException(
            status_code=400,
            detail=f"Permit volume is insufficient for block {block_code}. Required {required_volume}, remaining available {max(0, required_volume - (sum(v for _, v in allocations) if allocations else 0))}. Check override to save.",
        )
    return allocations


def build_location_response(loc):
    return {
        "id": loc.id,
        "location_name": loc.location_name,
        "location_code": loc.location_code,
        "description": loc.description,
        "status": loc.status,
        "created_at": loc.created_at,
        "updated_at": loc.updated_at,
    }


def build_entity_response(entity):
    return {
        "id": entity.id,
        "entity_name": entity.entity_name,
        "entity_code": entity.entity_code,
        "description": entity.description,
        "status": entity.status,
        "created_at": entity.created_at,
        "updated_at": entity.updated_at,
    }


def build_block_response(block, db=None):
    entity_names = []
    if db:
        # Get entities linked to this block via entity-block mapping
        entity_blocks = db.query(ExportEntityBlock).filter(
            ExportEntityBlock.block_code == block.block_code,
            ExportEntityBlock.status == "Active",
        ).all()
        for eb in entity_blocks:
            ent = db.query(ExportEntity).filter(ExportEntity.entity_code == eb.entity_code).first()
            if ent:
                entity_names.append(ent.entity_name)
    return {
        "id": block.id,
        "block_name": block.block_name,
        "block_code": block.block_code,
        "entity_names": entity_names,
        "description": block.description,
        "status": block.status,
        "created_at": block.created_at,
        "updated_at": block.updated_at,
    }


def build_permit_response(permit, db):
    loc = db.query(ExportLocation).filter(ExportLocation.location_code == permit.location_code).first()
    ent = db.query(ExportEntity).filter(ExportEntity.entity_code == permit.entity_code).first()
    blk = db.query(ExportBlock).filter(ExportBlock.block_code == permit.block_code).first()
    used_vol = calculate_used_permit_volume(db, permit)
    return {
        "id": permit.id,
        "permit_number": permit.permit_number,
        "location_code": permit.location_code,
        "location_name": loc.location_name if loc else None,
        "entity_code": permit.entity_code,
        "entity_name": ent.entity_name if ent else None,
        "block_code": permit.block_code,
        "block_name": blk.block_name if blk else None,
        "quarter": permit.quarter,
        "permit_volume": permit.permit_volume,
        "supplementary_permit": permit.supplementary_permit,
        "remarks": permit.remarks,
        "used_volume": used_vol,
        "remaining_volume": max(0, permit.permit_volume - used_vol),
        "status": permit.status,
        "created_by": permit.created_by,
        "created_at": permit.created_at,
        "updated_at": permit.updated_at,
    }


def build_transaction_response(tx, db):
    loc = db.query(ExportLocation).filter(ExportLocation.location_code == tx.location_code).first()
    ent = db.query(ExportEntity).filter(ExportEntity.entity_code == tx.entity_code).first()
    blk = db.query(ExportBlock).filter(ExportBlock.block_code == tx.block_code).first()
    return {
        "id": tx.id,
        "bl_date": tx.bl_date,
        "location_code": tx.location_code,
        "location_name": loc.location_name if loc else None,
        "entity_code": tx.entity_code,
        "entity_name": ent.entity_name if ent else None,
        "block_code": tx.block_code,
        "block_name": blk.block_name if blk else None,
        "volume": tx.volume,
        "consignee": tx.consignee,
        "destination": tx.destination,
        "country": tx.country,
        "vessel_name": tx.vessel_name,
        "quarter": tx.quarter,
        "permit_number": tx.permit_number,
        "remarks": tx.remarks,
        "created_by": tx.created_by,
        "status": tx.status,
        "created_at": tx.created_at,
        "updated_at": tx.updated_at,
    }


# ---------------------------------------------------------------------------
# Export Locations CRUD
# ---------------------------------------------------------------------------

@router.get("/locations", response_model=list[ExportLocationResponse])
def list_export_locations(db: Session = Depends(get_db), current_user: User = Depends(get_current_user_from_token)):
    return [build_location_response(l) for l in db.query(ExportLocation).filter(ExportLocation.status == "Active").all()]


@router.post("/locations", response_model=ExportLocationResponse)
def create_export_location(data: ExportLocationCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user_from_token)):
    require_user_permission(current_user, "Manage Export Operations", db)
    existing = db.query(ExportLocation).filter(ExportLocation.location_code.ilike(data.location_code)).first()
    if existing:
        raise HTTPException(status_code=400, detail="Export location code already exists")
    loc = ExportLocation(**data.model_dump())
    db.add(loc)
    db.commit()
    db.refresh(loc)
    create_audit_log(db, "Export Operations", "Create Export Location", current_user, entity_type="ExportLocation", entity_id=loc.id, entity_label=loc.location_name)
    return build_location_response(loc)


@router.put("/locations/{location_id}", response_model=ExportLocationResponse)
def update_export_location(location_id: int, data: ExportLocationCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user_from_token)):
    require_user_permission(current_user, "Manage Export Operations", db)
    loc = db.query(ExportLocation).filter(ExportLocation.id == location_id).first()
    if not loc:
        raise HTTPException(status_code=404, detail="Export location not found")
    for k, v in data.model_dump().items():
        setattr(loc, k, v)
    db.commit()
    db.refresh(loc)
    create_audit_log(db, "Export Operations", "Update Export Location", current_user, entity_type="ExportLocation", entity_id=loc.id, entity_label=loc.location_name)
    return build_location_response(loc)


@router.delete("/locations/{location_id}")
def delete_export_location(location_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user_from_token)):
    require_user_permission(current_user, "Manage Export Operations", db)
    loc = db.query(ExportLocation).filter(ExportLocation.id == location_id).first()
    if not loc:
        raise HTTPException(status_code=404, detail="Export location not found")

    has_active_entities = db.query(ExportLocationEntity).filter(
        ExportLocationEntity.location_code == loc.location_code,
        ExportLocationEntity.status == "Active",
    ).first() is not None
    entity_subq = db.query(ExportLocationEntity.entity_code).filter(
        ExportLocationEntity.location_code == loc.location_code,
        ExportLocationEntity.status == "Active",
    ).subquery()
    has_active_blocks = db.query(ExportEntityBlock).filter(
        ExportEntityBlock.entity_code.in_(entity_subq),
        ExportEntityBlock.status == "Active",
    ).first() is not None
    build_delete_blocker_error("location", has_active_blocks=has_active_blocks, has_active_entities=has_active_entities)

    loc.status = "Inactive"
    db.commit()
    create_audit_log(db, "Export Operations", "Delete Export Location", current_user, entity_type="ExportLocation", entity_id=loc.id, entity_label=loc.location_name)
    return {"detail": "Export location deleted"}


# ---------------------------------------------------------------------------
# Export Entities CRUD
# ---------------------------------------------------------------------------

@router.get("/entities", response_model=list[ExportEntityResponse])
def list_export_entities(location_code: str = Query(None), db: Session = Depends(get_db), current_user: User = Depends(get_current_user_from_token)):
    q = db.query(ExportEntity).filter(ExportEntity.status == "Active")
    if location_code:
        subq = db.query(ExportLocationEntity.entity_code).filter(
            ExportLocationEntity.location_code == location_code,
            ExportLocationEntity.status == "Active",
        ).subquery()
        q = q.filter(ExportEntity.entity_code.in_(subq))
    return [build_entity_response(e) for e in q.all()]


@router.post("/entities", response_model=ExportEntityResponse)
def create_export_entity(data: ExportEntityCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user_from_token)):
    require_user_permission(current_user, "Manage Export Operations", db)
    existing = db.query(ExportEntity).filter(ExportEntity.entity_code.ilike(data.entity_code)).first()
    if existing:
        raise HTTPException(status_code=400, detail="Export entity code already exists")
    ent = ExportEntity(**data.model_dump())
    db.add(ent)
    db.commit()
    db.refresh(ent)
    create_audit_log(db, "Export Operations", "Create Export Entity", current_user, entity_type="ExportEntity", entity_id=ent.id, entity_label=ent.entity_name)
    return build_entity_response(ent)


@router.put("/entities/{entity_id}", response_model=ExportEntityResponse)
def update_export_entity(entity_id: int, data: ExportEntityCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user_from_token)):
    require_user_permission(current_user, "Manage Export Operations", db)
    ent = db.query(ExportEntity).filter(ExportEntity.id == entity_id).first()
    if not ent:
        raise HTTPException(status_code=404, detail="Export entity not found")
    for k, v in data.model_dump().items():
        setattr(ent, k, v)
    db.commit()
    db.refresh(ent)
    create_audit_log(db, "Export Operations", "Update Export Entity", current_user, entity_type="ExportEntity", entity_id=ent.id, entity_label=ent.entity_name)
    return build_entity_response(ent)


@router.delete("/entities/{entity_id}")
def delete_export_entity(entity_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user_from_token)):
    require_user_permission(current_user, "Manage Export Operations", db)
    ent = db.query(ExportEntity).filter(ExportEntity.id == entity_id).first()
    if not ent:
        raise HTTPException(status_code=404, detail="Export entity not found")
    has_active_blocks = db.query(ExportEntityBlock).filter(
        ExportEntityBlock.entity_code == ent.entity_code,
        ExportEntityBlock.status == "Active",
    ).first() is not None
    build_delete_blocker_error("entity", has_active_blocks=has_active_blocks)
    ent.status = "Inactive"
    db.commit()
    create_audit_log(db, "Export Operations", "Delete Export Entity", current_user, entity_type="ExportEntity", entity_id=ent.id, entity_label=ent.entity_name)
    return {"detail": "Export entity deleted"}


# ---------------------------------------------------------------------------
# Location-Entity mapping
# ---------------------------------------------------------------------------

@router.get("/location-entities")
def list_location_entities(location_code: str = Query(None), db: Session = Depends(get_db), current_user: User = Depends(get_current_user_from_token)):
    q = db.query(ExportLocationEntity).filter(ExportLocationEntity.status == "Active")
    if location_code:
        q = q.filter(ExportLocationEntity.location_code == location_code)
    results = []
    for le in q.all():
        loc = db.query(ExportLocation).filter(ExportLocation.location_code == le.location_code).first()
        ent = db.query(ExportEntity).filter(ExportEntity.entity_code == le.entity_code).first()
        results.append({
            "id": le.id,
            "location_code": le.location_code,
            "location_name": loc.location_name if loc else None,
            "entity_code": le.entity_code,
            "entity_name": ent.entity_name if ent else None,
        })
    return results


@router.post("/location-entities")
def create_location_entity(location_code: str, entity_code: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user_from_token)):
    require_user_permission(current_user, "Manage Export Operations", db)
    existing_active = db.query(ExportLocationEntity).filter(
        ExportLocationEntity.location_code == location_code,
        ExportLocationEntity.entity_code == entity_code,
        ExportLocationEntity.status == "Active",
    ).first()
    if existing_active:
        raise HTTPException(status_code=400, detail="Location-entity mapping already exists")
    existing_inactive = db.query(ExportLocationEntity).filter(
        ExportLocationEntity.location_code == location_code,
        ExportLocationEntity.entity_code == entity_code,
        ExportLocationEntity.status == "Inactive",
    ).first()
    if existing_inactive:
        existing_inactive.status = "Active"
        db.commit()
        create_audit_log(db, "Export Operations", "Restore Location-Entity", current_user, entity_type="ExportLocationEntity", entity_label=f"{location_code}-{entity_code}")
        return {"detail": "Location-entity mapping restored"}
    le = ExportLocationEntity(location_code=location_code, entity_code=entity_code)
    db.add(le)
    db.commit()
    create_audit_log(db, "Export Operations", "Create Location-Entity", current_user, entity_type="ExportLocationEntity", entity_label=f"{location_code}-{entity_code}")
    return {"detail": "Location-entity mapping created"}


@router.delete("/location-entities/{mapping_id}")
def delete_location_entity(mapping_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user_from_token)):
    require_user_permission(current_user, "Manage Export Operations", db)
    le = db.query(ExportLocationEntity).filter(ExportLocationEntity.id == mapping_id).first()
    if not le:
        raise HTTPException(status_code=404, detail="Mapping not found")
    le.status = "Inactive"
    db.commit()
    create_audit_log(db, "Export Operations", "Delete Location-Entity", current_user, entity_type="ExportLocationEntity", entity_label=f"{le.location_code}-{le.entity_code}")
    return {"detail": "Location-entity mapping deleted"}


# ---------------------------------------------------------------------------
# Export Blocks CRUD
# ---------------------------------------------------------------------------

@router.get("/blocks", response_model=list[ExportBlockResponse])
def list_export_blocks(entity_code: str = Query(None), db: Session = Depends(get_db), current_user: User = Depends(get_current_user_from_token)):
    q = db.query(ExportBlock).filter(ExportBlock.status == "Active")
    if entity_code:
        # Filter blocks that are linked to this entity via entity-block mapping
        subq = db.query(ExportEntityBlock.block_code).filter(
            ExportEntityBlock.entity_code == entity_code,
            ExportEntityBlock.status == "Active",
        ).subquery()
        q = q.filter(ExportBlock.block_code.in_(subq))
    return [build_block_response(b, db) for b in q.all()]


@router.post("/blocks", response_model=ExportBlockResponse)
def create_export_block(data: ExportBlockCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user_from_token)):
    require_user_permission(current_user, "Manage Export Operations", db)
    existing = db.query(ExportBlock).filter(ExportBlock.block_code.ilike(data.block_code)).first()
    if existing:
        raise HTTPException(status_code=400, detail="Export block code already exists")
    # Remove entity_code if present (not part of block model anymore)
    block_data = data.model_dump()
    block_data.pop("entity_code", None)
    blk = ExportBlock(**block_data)
    db.add(blk)
    db.commit()
    db.refresh(blk)
    create_audit_log(db, "Export Operations", "Create Export Block", current_user, entity_type="ExportBlock", entity_id=blk.id, entity_label=blk.block_name)
    return build_block_response(blk, db)


@router.put("/blocks/{block_id}", response_model=ExportBlockResponse)
def update_export_block(block_id: int, data: ExportBlockCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user_from_token)):
    require_user_permission(current_user, "Manage Export Operations", db)
    blk = db.query(ExportBlock).filter(ExportBlock.id == block_id).first()
    if not blk:
        raise HTTPException(status_code=404, detail="Export block not found")
    update_data = data.model_dump()
    update_data.pop("entity_code", None)
    for k, v in update_data.items():
        setattr(blk, k, v)
    db.commit()
    db.refresh(blk)
    create_audit_log(db, "Export Operations", "Update Export Block", current_user, entity_type="ExportBlock", entity_id=blk.id, entity_label=blk.block_name)
    return build_block_response(blk, db)


@router.delete("/blocks/{block_id}")
def delete_export_block(block_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user_from_token)):
    require_user_permission(current_user, "Manage Export Operations", db)
    blk = db.query(ExportBlock).filter(ExportBlock.id == block_id).first()
    if not blk:
        raise HTTPException(status_code=404, detail="Export block not found")
    blk.status = "Inactive"
    db.commit()
    create_audit_log(db, "Export Operations", "Delete Export Block", current_user, entity_type="ExportBlock", entity_id=blk.id, entity_label=blk.block_name)
    return {"detail": "Export block deleted"}


# ---------------------------------------------------------------------------
# Entity-Block Mapping
# ---------------------------------------------------------------------------

@router.get("/entity-blocks")
def list_entity_blocks(entity_code: str = Query(None), block_code: str = Query(None), db: Session = Depends(get_db), current_user: User = Depends(get_current_user_from_token)):
    q = db.query(ExportEntityBlock).filter(ExportEntityBlock.status == "Active")
    if entity_code:
        q = q.filter(ExportEntityBlock.entity_code == entity_code)
    if block_code:
        q = q.filter(ExportEntityBlock.block_code == block_code)
    results = []
    for eb in q.all():
        ent = db.query(ExportEntity).filter(ExportEntity.entity_code == eb.entity_code).first()
        blk = db.query(ExportBlock).filter(ExportBlock.block_code == eb.block_code).first()
        results.append({
            "id": eb.id,
            "entity_code": eb.entity_code,
            "entity_name": ent.entity_name if ent else None,
            "block_code": eb.block_code,
            "block_name": blk.block_name if blk else None,
        })
    return results


@router.post("/entity-blocks")
def create_entity_block(entity_code: str, block_code: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user_from_token)):
    require_user_permission(current_user, "Manage Export Operations", db)
    existing_active = db.query(ExportEntityBlock).filter(
        ExportEntityBlock.entity_code == entity_code,
        ExportEntityBlock.block_code == block_code,
        ExportEntityBlock.status == "Active",
    ).first()
    if existing_active:
        raise HTTPException(status_code=400, detail="Entity-block mapping already exists")
    existing_inactive = db.query(ExportEntityBlock).filter(
        ExportEntityBlock.entity_code == entity_code,
        ExportEntityBlock.block_code == block_code,
        ExportEntityBlock.status == "Inactive",
    ).first()
    if existing_inactive:
        existing_inactive.status = "Active"
        db.commit()
        create_audit_log(db, "Export Operations", "Restore Entity-Block", current_user, entity_type="ExportEntityBlock", entity_label=f"{entity_code}-{block_code}")
        return {"detail": "Entity-block mapping restored"}
    eb = ExportEntityBlock(entity_code=entity_code, block_code=block_code)
    db.add(eb)
    db.commit()
    create_audit_log(db, "Export Operations", "Create Entity-Block", current_user, entity_type="ExportEntityBlock", entity_label=f"{entity_code}-{block_code}")
    return {"detail": "Entity-block mapping created"}


@router.delete("/entity-blocks/{mapping_id}")
def delete_entity_block(mapping_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user_from_token)):
    require_user_permission(current_user, "Manage Export Operations", db)
    eb = db.query(ExportEntityBlock).filter(ExportEntityBlock.id == mapping_id).first()
    if not eb:
        raise HTTPException(status_code=404, detail="Mapping not found")
    eb.status = "Inactive"
    db.commit()
    create_audit_log(db, "Export Operations", "Delete Entity-Block", current_user, entity_type="ExportEntityBlock", entity_label=f"{eb.entity_code}-{eb.block_code}")
    return {"detail": "Entity-block mapping deleted"}


# ---------------------------------------------------------------------------
# Export Permits CRUD
# ---------------------------------------------------------------------------

@router.get("/permits", response_model=list[ExportPermitResponse])
def list_export_permits(
    location_code: str = Query(None),
    entity_code: str = Query(None),
    quarter: str = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_from_token),
):
    expire_permits_if_needed(db)
    q = db.query(ExportPermit).filter(ExportPermit.status == "Active")
    if location_code:
        q = q.filter(ExportPermit.location_code == location_code)
    if entity_code:
        q = q.filter(ExportPermit.entity_code == entity_code)
    if quarter:
        q = q.filter(ExportPermit.quarter == quarter)
    return [build_permit_response(p, db) for p in q.order_by(ExportPermit.quarter.desc()).all()]


@router.post("/permits", response_model=ExportPermitResponse)
def create_export_permit(data: ExportPermitCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user_from_token)):
    require_user_permission(current_user, "Manage Export Operations", db)
    existing = db.query(ExportPermit).filter(ExportPermit.permit_number == data.permit_number).first()
    if existing:
        raise HTTPException(status_code=400, detail="Permit number already exists")
    permit = ExportPermit(**data.model_dump(), created_by=current_user.full_name or current_user.username)
    if is_quarter_expired(permit.quarter):
        permit.status = "Expired"
        if not permit.remarks:
            permit.remarks = "Auto-expired after quarter ended"
    db.add(permit)
    db.commit()
    db.refresh(permit)
    create_audit_log(db, "Export Operations", "Create Export Permit", current_user, entity_type="ExportPermit", entity_id=permit.id, entity_label=permit.permit_number)
    return build_permit_response(permit, db)


@router.put("/permits/{permit_id}", response_model=ExportPermitResponse)
def update_export_permit(permit_id: int, data: ExportPermitUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user_from_token)):
    require_user_permission(current_user, "Manage Export Operations", db)
    permit = db.query(ExportPermit).filter(ExportPermit.id == permit_id).first()
    if not permit:
        raise HTTPException(status_code=404, detail="Export permit not found")
    update_data = {k: v for k, v in data.model_dump().items() if v is not None}
    for k, v in update_data.items():
        setattr(permit, k, v)
    if permit.quarter and is_quarter_expired(permit.quarter) and permit.status == "Active":
        permit.status = "Expired"
        if not permit.remarks:
            permit.remarks = "Auto-expired after quarter ended"
    db.commit()
    db.refresh(permit)
    create_audit_log(db, "Export Operations", "Update Export Permit", current_user, entity_type="ExportPermit", entity_id=permit.id, entity_label=permit.permit_number)
    return build_permit_response(permit, db)


@router.delete("/permits/{permit_id}")
def delete_export_permit(permit_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user_from_token)):
    require_user_permission(current_user, "Manage Export Operations", db)
    permit = db.query(ExportPermit).filter(ExportPermit.id == permit_id).first()
    if not permit:
        raise HTTPException(status_code=404, detail="Export permit not found")
    permit.status = "Inactive"
    db.commit()
    create_audit_log(db, "Export Operations", "Delete Export Permit", current_user, entity_type="ExportPermit", entity_id=permit.id, entity_label=permit.permit_number)
    return {"detail": "Export permit deleted"}


# ---------------------------------------------------------------------------
# Export Transactions CRUD
# ---------------------------------------------------------------------------

@router.get("/transactions", response_model=list[ExportTransactionResponse])
def list_export_transactions(
    location_code: str = Query(None),
    entity_code: str = Query(None),
    quarter: str = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_from_token),
):
    q = db.query(ExportTransaction).filter(ExportTransaction.status == "Active")
    if location_code:
        q = q.filter(ExportTransaction.location_code == location_code)
    if entity_code:
        q = q.filter(ExportTransaction.entity_code == entity_code)
    if quarter:
        q = q.filter(ExportTransaction.quarter == quarter)
    return [build_transaction_response(tx, db) for tx in q.order_by(ExportTransaction.bl_date.desc()).all()]


@router.post("/transactions", response_model=ExportTransactionResponse)
def create_export_transaction(data: ExportTransactionCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user_from_token)):
    require_user_permission(current_user, "Manage Export Operations", db)
    payload_data = data.model_dump()
    override = bool(payload_data.get("override", False))
    payload_rows = expand_export_transaction_payloads({k: v for k, v in payload_data.items() if k != "override"})
    created_transactions = []
    for entry in payload_rows:
        permit_number = entry.get("permit_number")
        if permit_number:
            allocation = resolve_permit_allocation(
                db,
                location_code=entry["location_code"],
                entity_code=entry["entity_code"],
                block_code=entry["block_code"],
                quarter=entry.get("quarter") or get_quarter_from_date(entry["bl_date"]),
                required_volume=entry.get("volume", 0),
                permit_number=permit_number,
                override=override,
            )
            if allocation:
                entry["permit_number"] = allocation[0][0]
            elif not override:
                raise HTTPException(status_code=400, detail="Permit volume is insufficient for the selected block and quarter")
        tx = ExportTransaction(
            bl_date=entry["bl_date"],
            location_code=entry["location_code"],
            entity_code=entry["entity_code"],
            block_code=entry["block_code"],
            volume=entry.get("volume", 0),
            consignee=entry["consignee"],
            destination=entry["destination"],
            country=entry["country"],
            quarter=entry.get("quarter") or get_quarter_from_date(entry["bl_date"]),
            permit_number=entry.get("permit_number"),
            vessel_name=entry.get("vessel_name"),
            remarks=entry.get("remarks"),
            created_by=current_user.full_name or current_user.username,
        )
        db.add(tx)
        created_transactions.append(tx)
    db.commit()
    for tx in created_transactions:
        db.refresh(tx)
    create_audit_log(db, "Export Operations", "Create Export Transaction", current_user, entity_type="ExportTransaction", entity_id=created_transactions[0].id if created_transactions else None, entity_label=data.bl_date.isoformat())
    return build_transaction_response(created_transactions[0], db)


@router.put("/transactions/{transaction_id}", response_model=ExportTransactionResponse)
def update_export_transaction(transaction_id: int, data: ExportTransactionUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user_from_token)):
    tx = db.query(ExportTransaction).filter(ExportTransaction.id == transaction_id).first()
    if not tx:
        raise HTTPException(status_code=404, detail="Export transaction not found")
    update_data = {k: v for k, v in data.model_dump().items() if v is not None}
    override = bool(update_data.pop("override", False))
    block_entries = update_data.pop("block_entries", None)
    payload_for_validation = {
        "bl_date": update_data.get("bl_date") or tx.bl_date,
        "location_code": update_data.get("location_code", tx.location_code),
        "entity_code": update_data.get("entity_code", tx.entity_code),
        "block_code": update_data.get("block_code", tx.block_code),
        "volume": update_data.get("volume", tx.volume),
        "consignee": update_data.get("consignee", tx.consignee),
        "destination": update_data.get("destination", tx.destination),
        "country": update_data.get("country", tx.country),
        "permit_number": update_data.get("permit_number", tx.permit_number),
        "block_entries": block_entries,
    }
    if "bl_date" in update_data:
        update_data["quarter"] = get_quarter_from_date(update_data["bl_date"])
    payload_rows = expand_export_transaction_payloads(payload_for_validation)
    for entry in payload_rows:
        permit_number = entry.get("permit_number")
        if permit_number:
            allocation = resolve_permit_allocation(
                db,
                location_code=entry["location_code"],
                entity_code=entry["entity_code"],
                block_code=entry["block_code"],
                quarter=entry.get("quarter") or get_quarter_from_date(entry["bl_date"]),
                required_volume=entry.get("volume", 0),
                permit_number=permit_number,
                override=override,
            )
            if allocation:
                entry["permit_number"] = allocation[0][0]
            elif not override:
                raise HTTPException(status_code=400, detail="Permit volume is insufficient for the selected block and quarter")
    for k, v in update_data.items():
        setattr(tx, k, v)
    if block_entries:
        entry = block_entries[0]
        tx.block_code = entry.get("block_code", tx.block_code)
        tx.volume = entry.get("volume", tx.volume)
        if tx.bl_date:
            tx.quarter = get_quarter_from_date(tx.bl_date)
    db.commit()
    db.refresh(tx)
    create_audit_log(db, "Export Operations", "Update Export Transaction", current_user, entity_type="ExportTransaction", entity_id=tx.id, entity_label=tx.bl_date.isoformat())
    return build_transaction_response(tx, db)


@router.delete("/transactions/{transaction_id}")
def delete_export_transaction(transaction_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user_from_token)):
    tx = db.query(ExportTransaction).filter(ExportTransaction.id == transaction_id).first()
    if not tx:
        raise HTTPException(status_code=404, detail="Export transaction not found")
    tx.status = "Inactive"
    db.commit()
    create_audit_log(db, "Export Operations", "Delete Export Transaction", current_user, entity_type="ExportTransaction", entity_id=tx.id)
    return {"detail": "Export transaction deleted"}


# ---------------------------------------------------------------------------
# Bulk Upload
# ---------------------------------------------------------------------------

@router.post("/bulk-upload")
def bulk_upload_export_transactions(data: BulkUploadRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user_from_token)):
    require_user_permission(current_user, "Manage Export Operations", db)
    created = 0
    errors = []
    for item in data.items:
        try:
            quarter = get_quarter_from_date(item.bl_date)
            tx = ExportTransaction(
                bl_date=item.bl_date,
                location_code=item.location_code,
                entity_code=item.entity_code,
                block_code=item.block_code,
                volume=item.volume,
                consignee=item.consignee,
                destination=item.destination,
                country=item.country,
                quarter=quarter,
                permit_number=item.permit_number,
                vessel_name=item.vessel_name,
                remarks=item.remarks,
                created_by=current_user.full_name or current_user.username,
            )
            db.add(tx)
            created += 1
        except Exception as e:
            errors.append({"item": item.model_dump(), "error": str(e)})
    db.commit()
    create_audit_log(db, "Export Operations", "Bulk Upload", current_user, details={"created": created, "errors": len(errors)})
    return {"created": created, "errors": errors, "total": len(data.items)}


@router.post("/permits/bulk-upload")
def bulk_upload_export_permits(data: PermitBulkUploadRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user_from_token)):
    require_user_permission(current_user, "Manage Export Operations", db)
    created = 0
    errors = []
    for item in data.items:
        try:
            quarter_code = build_permit_quarter_code(item.quarter, item.year)
            existing = db.query(ExportPermit).filter(ExportPermit.permit_number == item.permit_number).first()
            if existing:
                errors.append({"item": item.model_dump(), "error": f"Permit number {item.permit_number} already exists"})
                continue
            permit = ExportPermit(
                permit_number=item.permit_number,
                location_code=item.location_code,
                entity_code=item.entity_code,
                block_code=item.block_code,
                quarter=quarter_code,
                permit_volume=item.permit_volume,
                supplementary_permit=item.supplementary_permit,
                status=item.status,
                remarks=item.remarks,
                created_by=current_user.full_name or current_user.username,
            )
            if is_quarter_expired(permit.quarter):
                permit.status = "Expired"
                if not permit.remarks:
                    permit.remarks = "Auto-expired after quarter ended"
            db.add(permit)
            created += 1
        except Exception as e:
            errors.append({"item": item.model_dump(), "error": str(e)})
    db.commit()
    create_audit_log(db, "Export Operations", "Bulk Upload Permits", current_user, details={"created": created, "errors": len(errors)})
    return {"created": created, "errors": errors, "total": len(data.items)}


# ---------------------------------------------------------------------------
# Export Config
# ---------------------------------------------------------------------------

@router.get("/configs", response_model=list[ExportConfigResponse])
def list_export_configs(db: Session = Depends(get_db), current_user: User = Depends(get_current_user_from_token)):
    return [
        {
            "id": c.id,
            "config_key": c.config_key,
            "config_value": c.config_value,
            "description": c.description,
            "status": c.status,
            "created_at": c.created_at,
            "updated_at": c.updated_at,
        }
        for c in db.query(ExportConfig).filter(ExportConfig.status == "Active").order_by(ExportConfig.config_key).all()
    ]


@router.post("/configs", response_model=ExportConfigResponse)
def create_export_config(data: ExportConfigCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user_from_token)):
    require_user_permission(current_user, "Manage Export Operations", db)
    existing = db.query(ExportConfig).filter(ExportConfig.config_key == data.config_key).first()
    if existing:
        existing.config_value = data.config_value
        existing.description = data.description
        db.commit()
        db.refresh(existing)
        return {
            "id": existing.id,
            "config_key": existing.config_key,
            "config_value": existing.config_value,
            "description": existing.description,
            "status": existing.status,
            "created_at": existing.created_at,
            "updated_at": existing.updated_at,
        }
    cfg = ExportConfig(**data.model_dump())
    db.add(cfg)
    db.commit()
    db.refresh(cfg)
    return {
        "id": cfg.id,
        "config_key": cfg.config_key,
        "config_value": cfg.config_value,
        "description": cfg.description,
        "status": cfg.status,
        "created_at": cfg.created_at,
        "updated_at": cfg.updated_at,
    }


# ---------------------------------------------------------------------------
# Export Consignees CRUD
# ---------------------------------------------------------------------------

@router.get("/consignees", response_model=list[ExportConsigneeResponse])
def list_export_consignees(db: Session = Depends(get_db), current_user: User = Depends(get_current_user_from_token)):
    return [
        {
            "id": c.id,
            "consignee_name": c.consignee_name,
            "description": c.description,
            "status": c.status,
            "created_at": c.created_at,
            "updated_at": c.updated_at,
        }
        for c in db.query(ExportConsignee).filter(ExportConsignee.status == "Active").order_by(ExportConsignee.consignee_name).all()
    ]


@router.post("/consignees", response_model=ExportConsigneeResponse)
def create_export_consignee(data: ExportConsigneeCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user_from_token)):
    require_user_permission(current_user, "Manage Export Operations", db)
    existing = db.query(ExportConsignee).filter(ExportConsignee.consignee_name == data.consignee_name).first()
    if existing:
        if existing.status == "Inactive":
            existing.status = "Active"
            existing.description = data.description
            db.commit()
            db.refresh(existing)
            return {
                "id": existing.id,
                "consignee_name": existing.consignee_name,
                "description": existing.description,
                "status": existing.status,
                "created_at": existing.created_at,
                "updated_at": existing.updated_at,
            }
        raise HTTPException(status_code=400, detail="Consignee already exists")
    c = ExportConsignee(**data.model_dump())
    db.add(c)
    db.commit()
    db.refresh(c)
    return {
        "id": c.id,
        "consignee_name": c.consignee_name,
        "description": c.description,
        "status": c.status,
        "created_at": c.created_at,
        "updated_at": c.updated_at,
    }


@router.put("/consignees/{consignee_id}", response_model=ExportConsigneeResponse)
def update_export_consignee(consignee_id: int, data: ExportConsigneeUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user_from_token)):
    require_user_permission(current_user, "Manage Export Operations", db)
    c = db.query(ExportConsignee).filter(ExportConsignee.id == consignee_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Consignee not found")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(c, k, v)
    db.commit()
    db.refresh(c)
    return {
        "id": c.id,
        "consignee_name": c.consignee_name,
        "description": c.description,
        "status": c.status,
        "created_at": c.created_at,
        "updated_at": c.updated_at,
    }


@router.delete("/consignees/{consignee_id}")
def delete_export_consignee(consignee_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user_from_token)):
    require_user_permission(current_user, "Manage Export Operations", db)
    c = db.query(ExportConsignee).filter(ExportConsignee.id == consignee_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Consignee not found")
    c.status = "Inactive"
    db.commit()
    return {"detail": "Consignee deleted"}


# ---------------------------------------------------------------------------
# Dashboard / KPI
# ---------------------------------------------------------------------------

@router.get("/dashboard", response_model=ExportDashboardResponse)
def get_export_dashboard(
    location_code: str = Query(None),
    quarter: str = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_from_token),
):
    q = db.query(ExportTransaction).filter(ExportTransaction.status == "Active")
    if location_code:
        q = q.filter(ExportTransaction.location_code == location_code)
    if quarter:
        q = q.filter(ExportTransaction.quarter == quarter)

    total_volume = q.with_entities(func.coalesce(func.sum(ExportTransaction.volume), 0)).scalar() or 0

    recent = q.order_by(ExportTransaction.created_at.desc()).limit(10).all()
    recent_exports = [build_transaction_response(tx, db) for tx in recent]

    permits = db.query(ExportPermit).filter(ExportPermit.status == "Active").all()
    permit_responses = [build_permit_response(p, db) for p in permits]
    total_permits = len(permit_responses)
    used_volume = sum(p["used_volume"] for p in permit_responses)
    remaining_volume = sum(p["remaining_volume"] for p in permit_responses)

    threshold_config = db.query(ExportConfig).filter(ExportConfig.config_key == "permit_insufficiency_threshold_pct").first()
    threshold_pct = float(threshold_config.config_value) if threshold_config and threshold_config.config_value else 90.0

    permits_with_exceed = []
    for p in permit_responses:
        if p["permit_volume"] > 0:
            usage_pct = (p["used_volume"] / p["permit_volume"]) * 100
            if usage_pct >= threshold_pct:
                permits_with_exceed.append(p)

    volume_by_location = db.query(
        ExportTransaction.location_code,
        func.coalesce(func.sum(ExportTransaction.volume), 0).label("total"),
    ).filter(ExportTransaction.status == "Active")
    if quarter:
        volume_by_location = volume_by_location.filter(ExportTransaction.quarter == quarter)
    if location_code:
        volume_by_location = volume_by_location.filter(ExportTransaction.location_code == location_code)
    volume_by_location = volume_by_location.group_by(ExportTransaction.location_code).all()

    vol_loc = []
    for row in volume_by_location:
        loc = db.query(ExportLocation).filter(ExportLocation.location_code == row.location_code).first()
        vol_loc.append({"location_code": row.location_code, "location_name": loc.location_name if loc else row.location_code, "total": float(row.total)})

    volume_by_quarter = db.query(
        ExportTransaction.quarter,
        func.coalesce(func.sum(ExportTransaction.volume), 0).label("total"),
    ).filter(ExportTransaction.status == "Active")
    if location_code:
        volume_by_quarter = volume_by_quarter.filter(ExportTransaction.location_code == location_code)
    volume_by_quarter = volume_by_quarter.group_by(ExportTransaction.quarter).all()

    vol_q = [{"quarter": row.quarter, "total": float(row.total)} for row in volume_by_quarter]

    return {
        "total_volume": total_volume,
        "total_permits": total_permits,
        "used_volume": used_volume,
        "remaining_volume": remaining_volume,
        "permit_insufficient_count": len(permits_with_exceed),
        "insufficient_threshold_pct": threshold_pct,
        "recent_exports": recent_exports,
        "volume_by_location": vol_loc,
        "volume_by_quarter": vol_q,
        "permits_with_exceed": permits_with_exceed,
    }


# ---------------------------------------------------------------------------
# Report data endpoint
# ---------------------------------------------------------------------------

@router.get("/report")
def get_export_report(
    location_code: str = Query(None),
    quarter: str = Query(None),
    from_date: date = Query(None),
    to_date: date = Query(None),
    country: str = Query(None),
    format: str = Query("json"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_from_token),
):
    q = db.query(ExportTransaction).filter(ExportTransaction.status == "Active")
    if location_code:
        q = q.filter(ExportTransaction.location_code == location_code)
    if quarter:
        q = q.filter(ExportTransaction.quarter == quarter)
    if from_date:
        q = q.filter(ExportTransaction.bl_date >= from_date)
    if to_date:
        q = q.filter(ExportTransaction.bl_date <= to_date)
    if country:
        q = q.filter(ExportTransaction.country == country)

    rows = [build_transaction_response(tx, db) for tx in q.order_by(ExportTransaction.bl_date.desc()).all()]

    total_volume = sum(r["volume"] for r in rows)

    return {
        "rows": rows,
        "total_volume": total_volume,
        "total_rows": len(rows),
    }
