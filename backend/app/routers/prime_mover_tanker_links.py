from datetime import date, datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.utils.errors import commit_or_409, flush_or_409
from app.database import get_db
from app.models import PrimeMoverTankerLink, Asset, AssetType, AuditLog, User
from app.schemas import (
    PrimeMoverTankerLinkCreate,
    PrimeMoverTankerLinkResponse,
    CurrentPrimeMoverTankerLinkResponse,
)
from app.dependencies.auth import get_current_user_from_token
from app.dependencies.permissions import (
    ensure_location_in_user_scope,
    get_user_location_codes,
    require_user_permission,
    user_has_location_access,
)
from app.services.audit_service import create_audit_log
from app.utils.helpers import clean_optional_text, get_current_user_display_name

router = APIRouter(prefix="/prime-mover-tanker-links", tags=["Prime Mover - Tanker Links"])


def get_asset_by_code_case_insensitive(asset_code: str | None, db: Session):
    cleaned_asset_code = clean_optional_text(asset_code)

    if not cleaned_asset_code:
        return None

    return (
        db.query(Asset)
        .filter(Asset.asset_code.ilike(cleaned_asset_code))
        .first()
    )


def ensure_link_asset_scope(asset: Asset, current_user: User, db: Session, *, write: bool = False):
    if str(asset.asset_scope or "").strip().casefold() == "global":
        if write:
            require_user_permission(current_user, "Edit Global Prime Mover Tanker Link", db)
        return
    ensure_location_in_user_scope(current_user, db, asset.location_code, "Asset location")


def _resolve_historical_link_asset(link: PrimeMoverTankerLink, side: str, db: Session) -> Asset | None:
    asset_id = getattr(link, f"{side}_asset_id", None)
    if asset_id:
        asset = db.query(Asset).filter(Asset.id == asset_id).first()
        if asset:
            return asset
    code_column = "prime_mover_asset_code" if side == "prime_mover" else "tanker_asset_code"
    stored_code = str(getattr(link, code_column, "") or "").strip()
    by_code = get_asset_by_code_case_insensitive(stored_code, db)
    if by_code:
        return by_code
    if not stored_code:
        return None
    # Older rows have no FK and may retain the pre-rename code. Use the audited
    # Asset update snapshots as a read-only alias map; never rewrite rows here.
    for audit in db.query(AuditLog).filter(AuditLog.entity_type == "Asset").order_by(AuditLog.id.desc()).limit(1000).all():
        details = audit.details if isinstance(audit.details, dict) else {}
        before = details.get("before") if isinstance(details.get("before"), dict) else {}
        after = details.get("after") if isinstance(details.get("after"), dict) else {}
        if str(before.get("asset_code") or "").strip().casefold() != stored_code.casefold():
            continue
        if audit.entity_id is not None:
            asset = db.query(Asset).filter(Asset.id == audit.entity_id).first()
            if asset:
                return asset
        newer_code = str(after.get("asset_code") or "").strip()
        if newer_code:
            asset = get_asset_by_code_case_insensitive(newer_code, db)
            if asset:
                return asset
    return None


def get_link_assets(link: PrimeMoverTankerLink, db: Session):
    return (
        _resolve_historical_link_asset(link, "prime_mover", db),
        _resolve_historical_link_asset(link, "tanker", db),
    )


def ensure_prime_mover_tanker_link_scope(
    link: PrimeMoverTankerLink,
    current_user: User,
    db: Session,
    *,
    write: bool = False,
):
    prime_mover, tanker = get_link_assets(link, db)
    if not prime_mover or not tanker:
        raise HTTPException(status_code=404, detail="Linked asset not found")
    ensure_link_asset_scope(prime_mover, current_user, db, write=write)
    ensure_link_asset_scope(tanker, current_user, db, write=write)
    if write:
        # Repair stale codes only as part of an explicit user edit/close/delete.
        link.prime_mover_asset_id = prime_mover.id
        link.prime_mover_asset_code = prime_mover.asset_code
        link.tanker_asset_id = tanker.id
        link.tanker_asset_code = tanker.asset_code
    return prime_mover, tanker


def is_prime_mover_asset(asset: Asset | None, db: Session | None = None):
    if not asset:
        return False
    asset_type_code = str(asset.asset_type_code or "").strip().upper()
    asset_name = str(asset.asset_name or "").strip().upper()
    asset_code = str(asset.asset_code or "").strip().upper()
    type_name = ""
    if db is not None:
        asset_type = db.query(AssetType).filter(func.lower(func.trim(AssetType.asset_type_code)) == asset_type_code.casefold()).first()
        type_name = str(asset_type.asset_type_name or "").strip().upper() if asset_type else ""
        linked = db.query(PrimeMoverTankerLink.id).filter(
            PrimeMoverTankerLink.status == "Active",
            (PrimeMoverTankerLink.prime_mover_asset_id == asset.id) |
            (func.lower(func.trim(PrimeMoverTankerLink.prime_mover_asset_code)) == asset_code.casefold()),
        ).first()
        if linked:
            return True
    return any(token in value for token in (asset_type_code, type_name, asset_name) for token in ("PRIME", "MOVER")) or asset_code.startswith("PM")


def is_tanker_trailer_asset(asset: Asset | None, db: Session | None = None):
    if not asset:
        return False
    asset_type_code = str(asset.asset_type_code or "").strip().upper()
    asset_name = str(asset.asset_name or "").strip().upper()
    type_name = ""
    if db is not None:
        asset_type = db.query(AssetType).filter(func.lower(func.trim(AssetType.asset_type_code)) == asset_type_code.casefold()).first()
        type_name = str(asset_type.asset_type_name or "").strip().upper() if asset_type else ""
        linked = db.query(PrimeMoverTankerLink.id).filter(
            PrimeMoverTankerLink.status == "Active",
            (PrimeMoverTankerLink.tanker_asset_id == asset.id) |
            (func.lower(func.trim(PrimeMoverTankerLink.tanker_asset_code)) == str(asset.asset_code or "").strip().casefold()),
        ).first()
        if linked:
            return True
    return any(token in value for value in (asset_type_code, type_name, asset_name) for token in ("TANKER", "TRAILER", "TRUCK"))


def prime_mover_tanker_link_is_visible(
    link: PrimeMoverTankerLink, current_user: User, db: Session
) -> bool:
    allowed_codes = get_user_location_codes(current_user, db)
    if allowed_codes is None:
        return True
    prime_mover, tanker = get_link_assets(link, db)
    if not prime_mover or not tanker:
        return False
    for asset in (prime_mover, tanker):
        if str(asset.asset_scope or "").strip().casefold() != "global" and not user_has_location_access(
            current_user, db, asset.location_code
        ):
            return False
    return True


def build_prime_mover_tanker_link_response(link: PrimeMoverTankerLink, db: Session):
    prime_mover_asset, tanker_asset = get_link_assets(link, db)

    return {
        "id": link.id,
        "prime_mover_asset_code": prime_mover_asset.asset_code if prime_mover_asset else link.prime_mover_asset_code,
        "prime_mover_asset_name": prime_mover_asset.asset_name
        if prime_mover_asset
        else "",
        "prime_mover_asset_type_code": prime_mover_asset.asset_type_code
        if prime_mover_asset
        else "",
        "tanker_asset_code": tanker_asset.asset_code if tanker_asset else link.tanker_asset_code,
        "tanker_asset_name": tanker_asset.asset_name if tanker_asset else "",
        "tanker_asset_type_code": tanker_asset.asset_type_code
        if tanker_asset
        else "",
        "tanker_chassis_number": tanker_asset.serial_number
        if tanker_asset
        else "",
        "linked_from": link.linked_from,
        "linked_to": link.linked_to,
        "remarks": link.remarks,
        "status": link.status,
        "created_by": link.created_by,
        "created_at": link.created_at,
        "updated_at": link.updated_at,
    }


def build_prime_mover_tanker_link_audit_snapshot(link: PrimeMoverTankerLink, db: Session):
    return build_prime_mover_tanker_link_response(link, db)


def validate_prime_mover_tanker_link(
    link_request: PrimeMoverTankerLinkCreate,
    db: Session,
    link_id: int | None = None,
):
    prime_mover_asset_code = str(
        link_request.prime_mover_asset_code or ""
    ).strip()

    tanker_asset_code = str(
        link_request.tanker_asset_code or ""
    ).strip()

    if prime_mover_asset_code == "":
        raise HTTPException(
            status_code=400,
            detail="Prime Mover asset is required",
        )

    if tanker_asset_code == "":
        raise HTTPException(
            status_code=400,
            detail="Tanker Trailer asset is required",
        )

    if prime_mover_asset_code.lower() == tanker_asset_code.lower():
        raise HTTPException(
            status_code=400,
            detail="Prime Mover and Tanker Trailer cannot be the same asset",
        )

    prime_mover_asset = get_asset_by_code_case_insensitive(
        prime_mover_asset_code,
        db,
    )

    if not prime_mover_asset:
        raise HTTPException(
            status_code=400,
            detail="Prime Mover asset not found",
        )

    if prime_mover_asset.status != "Active":
        raise HTTPException(
            status_code=400,
            detail="Only Active Prime Mover asset can be linked",
        )

    if not is_prime_mover_asset(prime_mover_asset, db):
        raise HTTPException(
            status_code=400,
            detail=(
                "Selected Prime Mover asset does not look like a Prime Mover. "
                "Use asset type code such as PRIME_MOVER."
            ),
        )

    tanker_asset = get_asset_by_code_case_insensitive(
        tanker_asset_code,
        db,
    )

    if not tanker_asset:
        raise HTTPException(
            status_code=400,
            detail="Tanker Trailer asset not found",
        )

    if tanker_asset.status != "Active":
        raise HTTPException(
            status_code=400,
            detail="Only Active Tanker Trailer asset can be linked",
        )

    if not is_tanker_trailer_asset(tanker_asset, db):
        raise HTTPException(
            status_code=400,
            detail=(
                "Selected Tanker asset does not look like a Tanker Trailer. "
                "Use asset type code such as TANKER_TRAILER."
            ),
        )

    if link_request.linked_to is not None:
        if link_request.linked_to < link_request.linked_from:
            raise HTTPException(
                status_code=400,
                detail="Linked To cannot be earlier than Linked From",
            )

    cleaned_status = str(link_request.status or "").strip()

    if cleaned_status not in ["Active", "Inactive"]:
        raise HTTPException(
            status_code=400,
            detail="Status must be Active or Inactive",
        )

    if cleaned_status == "Active":
        active_prime_mover_link_query = (
            db.query(PrimeMoverTankerLink)
            .filter(
                PrimeMoverTankerLink.prime_mover_asset_code.ilike(
                    prime_mover_asset_code
                ),
                PrimeMoverTankerLink.status == "Active",
            )
        )

        active_tanker_link_query = (
            db.query(PrimeMoverTankerLink)
            .filter(
                PrimeMoverTankerLink.tanker_asset_code.ilike(
                    tanker_asset_code
                ),
                PrimeMoverTankerLink.status == "Active",
            )
        )

        if link_id is not None:
            active_prime_mover_link_query = active_prime_mover_link_query.filter(
                PrimeMoverTankerLink.id != link_id
            )

            active_tanker_link_query = active_tanker_link_query.filter(
                PrimeMoverTankerLink.id != link_id
            )

        active_prime_mover_link = active_prime_mover_link_query.first()

        if active_prime_mover_link:
            raise HTTPException(
                status_code=400,
                detail=(
                    "This Prime Mover already has an Active Tanker link. "
                    "Close or deactivate the old link before creating a new one."
                ),
            )

        active_tanker_link = active_tanker_link_query.first()

        if active_tanker_link:
            raise HTTPException(
                status_code=400,
                detail=(
                    "This Tanker Trailer is already linked to another Active "
                    "Prime Mover. Close or deactivate the old link first."
                ),
            )

    return {
        "prime_mover_asset_code": prime_mover_asset.asset_code,
        "tanker_asset_code": tanker_asset.asset_code,
        "linked_from": link_request.linked_from,
        "linked_to": link_request.linked_to,
        "remarks": clean_optional_text(link_request.remarks),
        "status": cleaned_status,
    }


@router.get("", response_model=list[PrimeMoverTankerLinkResponse])
def get_prime_mover_tanker_links(
    status: str | None = None,
    prime_mover_asset_code: str | None = None,
    tanker_asset_code: str | None = None,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "View Prime Mover Tanker Link",
        db,
    )

    query = db.query(PrimeMoverTankerLink)

    cleaned_status = clean_optional_text(status)

    if cleaned_status:
        query = query.filter(PrimeMoverTankerLink.status == cleaned_status)

    cleaned_prime_mover_asset_code = clean_optional_text(prime_mover_asset_code)
    prime_mover_filter = None

    if cleaned_prime_mover_asset_code:
        prime_mover = get_asset_by_code_case_insensitive(
            cleaned_prime_mover_asset_code, db
        )
        if not prime_mover:
            raise HTTPException(status_code=404, detail="Prime Mover asset not found")
        ensure_link_asset_scope(prime_mover, current_user, db)
        prime_mover_filter = prime_mover

    cleaned_tanker_asset_code = clean_optional_text(tanker_asset_code)
    tanker_filter = None

    if cleaned_tanker_asset_code:
        tanker = get_asset_by_code_case_insensitive(
            cleaned_tanker_asset_code, db
        )
        if not tanker:
            raise HTTPException(status_code=404, detail="Tanker asset not found")
        ensure_link_asset_scope(tanker, current_user, db)
        tanker_filter = tanker

    links = (
        query.order_by(
            PrimeMoverTankerLink.status.asc(),
            PrimeMoverTankerLink.linked_from.desc(),
            PrimeMoverTankerLink.id.desc(),
        )
        .all()
    )
    if prime_mover_filter is not None:
        links = [link for link in links if _resolve_historical_link_asset(link, "prime_mover", db) is not None and _resolve_historical_link_asset(link, "prime_mover", db).id == prime_mover_filter.id]
    if tanker_filter is not None:
        links = [link for link in links if _resolve_historical_link_asset(link, "tanker", db) is not None and _resolve_historical_link_asset(link, "tanker", db).id == tanker_filter.id]

    return [
        build_prime_mover_tanker_link_response(link, db)
        for link in links
        if prime_mover_tanker_link_is_visible(link, current_user, db)
    ]


@router.get(
    "/current-by-prime-mover/{prime_mover_asset_code}",
    response_model=CurrentPrimeMoverTankerLinkResponse,
)
def get_current_prime_mover_tanker_link(
    prime_mover_asset_code: str,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "View Prime Mover Tanker Link",
        db,
    )

    asset = get_asset_by_code_case_insensitive(prime_mover_asset_code, db)
    if not asset:
        return {"has_active_link": False, "link": None}
    ensure_link_asset_scope(asset, current_user, db)

    candidates = (
        db.query(PrimeMoverTankerLink)
        .filter(PrimeMoverTankerLink.status == "Active")
        .order_by(PrimeMoverTankerLink.linked_from.desc(), PrimeMoverTankerLink.id.desc())
        .all()
    )
    link = next(
        (candidate for candidate in candidates
         if (resolved := _resolve_historical_link_asset(candidate, "prime_mover", db)) is not None
         and resolved.id == asset.id),
        None,
    )

    if not link:
        return {
            "has_active_link": False,
            "link": None,
        }

    ensure_prime_mover_tanker_link_scope(link, current_user, db)
    return {
        "has_active_link": True,
        "link": build_prime_mover_tanker_link_response(link, db),
    }


@router.post("", response_model=PrimeMoverTankerLinkResponse)
def create_prime_mover_tanker_link(
    link_request: PrimeMoverTankerLinkCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Create Prime Mover Tanker Link",
        db,
    )

    validated_data = validate_prime_mover_tanker_link(
        link_request,
        db,
    )
    for asset_code in (
        validated_data["prime_mover_asset_code"],
        validated_data["tanker_asset_code"],
    ):
        asset = get_asset_by_code_case_insensitive(asset_code, db)
        ensure_link_asset_scope(asset, current_user, db, write=True)

    prime_asset = get_asset_by_code_case_insensitive(validated_data["prime_mover_asset_code"], db)
    tanker_asset = get_asset_by_code_case_insensitive(validated_data["tanker_asset_code"], db)
    new_link = PrimeMoverTankerLink(
        prime_mover_asset_id=prime_asset.id if prime_asset else None,
        tanker_asset_id=tanker_asset.id if tanker_asset else None,
        prime_mover_asset_code=validated_data["prime_mover_asset_code"],
        tanker_asset_code=validated_data["tanker_asset_code"],
        linked_from=validated_data["linked_from"],
        linked_to=validated_data["linked_to"],
        remarks=validated_data["remarks"],
        status=validated_data["status"],
        created_by=get_current_user_display_name(current_user),
    )

    db.add(new_link)
    flush_or_409(db)

    after_data = build_prime_mover_tanker_link_audit_snapshot(
        new_link,
        db,
    )

    create_audit_log(
        db=db,
        module_name="Prime Mover Tanker Link",
        action="Create Prime Mover Tanker Link",
        current_user=current_user,
        entity_type="PrimeMoverTankerLink",
        entity_id=new_link.id,
        entity_label=(
            f"{new_link.prime_mover_asset_code} -> "
            f"{new_link.tanker_asset_code}"
        ),
        remarks="Prime mover tanker link created",
        request_path="/prime-mover-tanker-links",
        details={
            "after": after_data,
        },
    )

    commit_or_409(db)
    db.refresh(new_link)

    return build_prime_mover_tanker_link_response(new_link, db)


@router.put("/{link_id}", response_model=PrimeMoverTankerLinkResponse)
def update_prime_mover_tanker_link(
    link_id: int,
    link_request: PrimeMoverTankerLinkCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Edit Prime Mover Tanker Link",
        db,
    )

    existing_link = (
        db.query(PrimeMoverTankerLink)
        .filter(PrimeMoverTankerLink.id == link_id)
        .first()
    )

    if not existing_link:
        raise HTTPException(
            status_code=404,
            detail="Prime Mover Tanker link not found",
        )

    ensure_prime_mover_tanker_link_scope(
        existing_link, current_user, db, write=True
    )

    before_data = build_prime_mover_tanker_link_audit_snapshot(
        existing_link,
        db,
    )

    validated_data = validate_prime_mover_tanker_link(
        link_request,
        db,
        link_id=link_id,
    )
    for asset_code in (
        validated_data["prime_mover_asset_code"],
        validated_data["tanker_asset_code"],
    ):
        asset = get_asset_by_code_case_insensitive(asset_code, db)
        ensure_link_asset_scope(asset, current_user, db, write=True)

    prime_asset = get_asset_by_code_case_insensitive(validated_data["prime_mover_asset_code"], db)
    tanker_asset = get_asset_by_code_case_insensitive(validated_data["tanker_asset_code"], db)
    existing_link.prime_mover_asset_id = prime_asset.id if prime_asset else None
    existing_link.tanker_asset_id = tanker_asset.id if tanker_asset else None
    existing_link.prime_mover_asset_code = validated_data["prime_mover_asset_code"]
    existing_link.tanker_asset_code = validated_data["tanker_asset_code"]
    existing_link.linked_from = validated_data["linked_from"]
    existing_link.linked_to = validated_data["linked_to"]
    existing_link.remarks = validated_data["remarks"]
    existing_link.status = validated_data["status"]
    existing_link.updated_at = datetime.now()

    flush_or_409(db)

    after_data = build_prime_mover_tanker_link_audit_snapshot(
        existing_link,
        db,
    )

    create_audit_log(
        db=db,
        module_name="Prime Mover Tanker Link",
        action="Update Prime Mover Tanker Link",
        current_user=current_user,
        entity_type="PrimeMoverTankerLink",
        entity_id=existing_link.id,
        entity_label=(
            f"{existing_link.prime_mover_asset_code} -> "
            f"{existing_link.tanker_asset_code}"
        ),
        remarks="Prime mover tanker link updated",
        request_path=f"/prime-mover-tanker-links/{link_id}",
        details={
            "before": before_data,
            "after": after_data,
        },
    )

    commit_or_409(db)
    db.refresh(existing_link)

    return build_prime_mover_tanker_link_response(existing_link, db)


@router.post("/{link_id}/close", response_model=PrimeMoverTankerLinkResponse)
def close_prime_mover_tanker_link(
    link_id: int,
    linked_to: date | None = None,
    remarks: str | None = None,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Edit Prime Mover Tanker Link",
        db,
    )

    existing_link = (
        db.query(PrimeMoverTankerLink)
        .filter(PrimeMoverTankerLink.id == link_id)
        .first()
    )

    if not existing_link:
        raise HTTPException(
            status_code=404,
            detail="Prime Mover Tanker link not found",
        )

    ensure_prime_mover_tanker_link_scope(
        existing_link, current_user, db, write=True
    )

    close_date = linked_to or date.today()

    if close_date < existing_link.linked_from:
        raise HTTPException(
            status_code=400,
            detail="Close date cannot be earlier than Linked From",
        )

    before_data = build_prime_mover_tanker_link_audit_snapshot(
        existing_link,
        db,
    )

    existing_link.linked_to = close_date
    existing_link.status = "Inactive"

    cleaned_remarks = clean_optional_text(remarks)

    if cleaned_remarks:
        if existing_link.remarks:
            existing_link.remarks = (
                f"{existing_link.remarks}\nClose Remarks: {cleaned_remarks}"
            )
        else:
            existing_link.remarks = f"Close Remarks: {cleaned_remarks}"

    existing_link.updated_at = datetime.now()

    flush_or_409(db)

    after_data = build_prime_mover_tanker_link_audit_snapshot(
        existing_link,
        db,
    )

    create_audit_log(
        db=db,
        module_name="Prime Mover Tanker Link",
        action="Close Prime Mover Tanker Link",
        current_user=current_user,
        entity_type="PrimeMoverTankerLink",
        entity_id=existing_link.id,
        entity_label=(
            f"{existing_link.prime_mover_asset_code} -> "
            f"{existing_link.tanker_asset_code}"
        ),
        remarks="Prime mover tanker link closed",
        request_path=f"/prime-mover-tanker-links/{link_id}/close",
        details={
            "before": before_data,
            "after": after_data,
        },
    )

    commit_or_409(db)
    db.refresh(existing_link)

    return build_prime_mover_tanker_link_response(existing_link, db)


@router.delete("/{link_id}")
def delete_prime_mover_tanker_link(
    link_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Delete Prime Mover Tanker Link",
        db,
    )

    existing_link = (
        db.query(PrimeMoverTankerLink)
        .filter(PrimeMoverTankerLink.id == link_id)
        .first()
    )

    if not existing_link:
        raise HTTPException(
            status_code=404,
            detail="Prime Mover Tanker link not found",
        )

    ensure_prime_mover_tanker_link_scope(
        existing_link, current_user, db, write=True
    )

    deleted_data = build_prime_mover_tanker_link_audit_snapshot(
        existing_link,
        db,
    )

    create_audit_log(
        db=db,
        module_name="Prime Mover Tanker Link",
        action="Delete Prime Mover Tanker Link",
        current_user=current_user,
        entity_type="PrimeMoverTankerLink",
        entity_id=existing_link.id,
        entity_label=(
            f"{existing_link.prime_mover_asset_code} -> "
            f"{existing_link.tanker_asset_code}"
        ),
        remarks="Prime mover tanker link deleted",
        request_path=f"/prime-mover-tanker-links/{link_id}",
        details={
            "deleted": deleted_data,
        },
    )

    db.delete(existing_link)
    commit_or_409(db)

    return {
        "message": "Prime Mover Tanker link deleted successfully",
    }