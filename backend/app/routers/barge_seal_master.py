from datetime import datetime, date
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import BargeSealMaster, Asset, User
from app.schemas import BargeSealMasterBulkSaveRequest, BargeSealMasterResponse
from app.dependencies.auth import get_current_user_from_token
from app.dependencies.permissions import require_user_permission
from app.services.audit_service import create_audit_log
from app.utils.helpers import clean_optional_text

router = APIRouter(prefix="/barge-seal-master", tags=["Barge Seal Master"])


@router.get("", response_model=list[BargeSealMasterResponse])
def get_barge_seal_master(
    asset_code: str,
    effective_date: date | None = None,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "View Barge Seal Master",
        db,
    )

    asset_code_clean = (asset_code or "").strip()
    if asset_code_clean == "":
        raise HTTPException(status_code=400, detail="asset_code is required")

    query = db.query(BargeSealMaster).filter(
        BargeSealMaster.asset_code.ilike(asset_code_clean)
    )

    if effective_date is None:
        query = query.filter(BargeSealMaster.effective_date.is_(None))
    else:
        query = query.filter(BargeSealMaster.effective_date == effective_date)

    rows = (
        query.order_by(
            BargeSealMaster.tank_id.asc(),
            BargeSealMaster.seal_position.asc(),
        ).all()
    )

    return rows


@router.post("/bulk", response_model=list[BargeSealMasterResponse])
def bulk_save_barge_seal_master(
    request: BargeSealMasterBulkSaveRequest,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage Barge Seal Master",
        db,
    )

    asset_code = (request.asset_code or "").strip()
    if asset_code == "":
        raise HTTPException(status_code=400, detail="asset_code is required")

    asset = db.query(Asset).filter(Asset.asset_code.ilike(asset_code)).first()
    if not asset:
        raise HTTPException(status_code=400, detail="Asset not found")

    if request.rows is None or len(request.rows) == 0:
        raise HTTPException(status_code=400, detail="Please provide at least one seal row")

    def norm(s: str) -> str:
        return str(s or "").strip()

    def norm_pos(s: str) -> str:
        return str(s or "").strip().upper()

    req_map = {}
    duplicate_keys = []

    for row in request.rows:
        tank_id = norm(row.tank_id)
        seal_position = norm_pos(row.seal_position)
        seal_number = norm(row.seal_number)

        if tank_id == "":
            raise HTTPException(status_code=400, detail="tank_id is required in rows")
        if seal_position == "":
            raise HTTPException(status_code=400, detail="seal_position is required in rows")
        if seal_number == "":
            raise HTTPException(status_code=400, detail="seal_number is required in rows")

        key = (tank_id, seal_position)
        if key in req_map:
            duplicate_keys.append(f"{tank_id}:{seal_position}")
            continue

        req_map[key] = {
            "tank_id": tank_id,
            "seal_position": seal_position,
            "seal_number": seal_number,
            "remarks": clean_optional_text(row.remarks),
            "status": row.status or "Active",
        }

    if duplicate_keys:
        raise HTTPException(
            status_code=400,
            detail=f"Duplicate seal keys in request: {', '.join(duplicate_keys)}",
        )

    existing_q = db.query(BargeSealMaster).filter(
        BargeSealMaster.asset_code.ilike(asset_code)
    )

    if request.effective_date is None:
        existing_q = existing_q.filter(BargeSealMaster.effective_date.is_(None))
    else:
        existing_q = existing_q.filter(BargeSealMaster.effective_date == request.effective_date)

    existing_rows = existing_q.all()

    def existing_key(obj: BargeSealMaster):
        return (norm(obj.tank_id), norm_pos(obj.seal_position))

    existing_map = {existing_key(r): r for r in existing_rows}

    before_count = len(existing_rows)

    added = []
    updated = []
    removed = []

    for key, obj in existing_map.items():
        if key not in req_map:
            removed.append({
                "tank_id": obj.tank_id,
                "seal_position": obj.seal_position,
                "seal_number": obj.seal_number,
                "status": obj.status,
            })
            db.delete(obj)

    for key, incoming in req_map.items():
        if key in existing_map:
            obj = existing_map[key]

            changed = (
                (obj.seal_number or "") != (incoming["seal_number"] or "")
                or (obj.status or "") != (incoming["status"] or "")
                or (obj.remarks or "") != (incoming["remarks"] or "")
                or obj.effective_date != request.effective_date
            )

            if changed:
                updated.append({
                    "tank_id": obj.tank_id,
                    "seal_position": obj.seal_position,
                    "before_seal_number": obj.seal_number,
                    "after_seal_number": incoming["seal_number"],
                    "before_status": obj.status,
                    "after_status": incoming["status"],
                })

                obj.seal_number = incoming["seal_number"]
                obj.status = incoming["status"]
                obj.remarks = incoming["remarks"]
                obj.effective_date = request.effective_date
                obj.updated_at = datetime.now()
        else:
            new_row = BargeSealMaster(
                asset_code=asset_code,
                tank_id=incoming["tank_id"],
                seal_position=incoming["seal_position"],
                seal_number=incoming["seal_number"],
                effective_date=request.effective_date,
                remarks=incoming["remarks"],
                status=incoming["status"],
            )
            db.add(new_row)

            added.append({
                "tank_id": incoming["tank_id"],
                "seal_position": incoming["seal_position"],
                "seal_number": incoming["seal_number"],
                "status": incoming["status"],
            })

    db.flush()

    after_count = before_count - len(removed) + len(added)

    create_audit_log(
        db=db,
        module_name="Barge Seal Master",
        action="Bulk Save Barge Seals",
        current_user=current_user,
        entity_type="BargeSealMaster",
        entity_id=None,
        entity_label=asset_code,
        remarks="Barge seal master bulk saved",
        request_path="/barge-seal-master/bulk",
        details={
            "asset_code": asset_code,
            "effective_date": str(request.effective_date) if request.effective_date else None,
            "before_count": before_count,
            "after_count": after_count,
            "added_count": len(added),
            "updated_count": len(updated),
            "removed_count": len(removed),
            "added_sample": added[:20],
            "updated_sample": updated[:20],
            "removed_sample": removed[:20],
        },
    )

    db.commit()

    out_q = db.query(BargeSealMaster).filter(
        BargeSealMaster.asset_code.ilike(asset_code)
    )

    if request.effective_date is None:
        out_q = out_q.filter(BargeSealMaster.effective_date.is_(None))
    else:
        out_q = out_q.filter(BargeSealMaster.effective_date == request.effective_date)

    return out_q.order_by(
        BargeSealMaster.tank_id.asc(),
        BargeSealMaster.seal_position.asc(),
    ).all()
