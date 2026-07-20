from datetime import date, datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import PrimeMoverTankerLink, Asset, User
from app.schemas import (
    PrimeMoverTankerLinkCreate,
    PrimeMoverTankerLinkResponse,
    CurrentPrimeMoverTankerLinkResponse,
)
from app.dependencies.auth import get_current_user_from_token
from app.dependencies.permissions import require_user_permission
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


def is_prime_mover_asset(asset: Asset | None):
    if not asset:
        return False

    asset_type_code = str(asset.asset_type_code or "").strip().upper()
    asset_name = str(asset.asset_name or "").strip().upper()
    asset_code = str(asset.asset_code or "").strip().upper()

    return (
        "PRIME" in asset_type_code
        or "MOVER" in asset_type_code
        or "PRIME" in asset_name
        or "MOVER" in asset_name
        or asset_code.startswith("PM")
    )


def is_tanker_trailer_asset(asset: Asset | None):
    if not asset:
        return False

    asset_type_code = str(asset.asset_type_code or "").strip().upper()
    asset_name = str(asset.asset_name or "").strip().upper()

    return (
        "TANKER" in asset_type_code
        or "TRAILER" in asset_type_code
        or "TRUCK" in asset_type_code
        or "TANKER" in asset_name
        or "TRAILER" in asset_name
    )


def build_prime_mover_tanker_link_response(link: PrimeMoverTankerLink, db: Session):
    prime_mover_asset = get_asset_by_code_case_insensitive(
        link.prime_mover_asset_code,
        db,
    )

    tanker_asset = get_asset_by_code_case_insensitive(
        link.tanker_asset_code,
        db,
    )

    return {
        "id": link.id,
        "prime_mover_asset_code": link.prime_mover_asset_code,
        "prime_mover_asset_name": prime_mover_asset.asset_name
        if prime_mover_asset
        else "",
        "prime_mover_asset_type_code": prime_mover_asset.asset_type_code
        if prime_mover_asset
        else "",
        "tanker_asset_code": link.tanker_asset_code,
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

    if not is_prime_mover_asset(prime_mover_asset):
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

    if not is_tanker_trailer_asset(tanker_asset):
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
        "View Asset",
        db,
    )

    query = db.query(PrimeMoverTankerLink)

    cleaned_status = clean_optional_text(status)

    if cleaned_status:
        query = query.filter(PrimeMoverTankerLink.status == cleaned_status)

    cleaned_prime_mover_asset_code = clean_optional_text(prime_mover_asset_code)

    if cleaned_prime_mover_asset_code:
        query = query.filter(
            PrimeMoverTankerLink.prime_mover_asset_code.ilike(
                cleaned_prime_mover_asset_code
            )
        )

    cleaned_tanker_asset_code = clean_optional_text(tanker_asset_code)

    if cleaned_tanker_asset_code:
        query = query.filter(
            PrimeMoverTankerLink.tanker_asset_code.ilike(
                cleaned_tanker_asset_code
            )
        )

    links = (
        query.order_by(
            PrimeMoverTankerLink.status.asc(),
            PrimeMoverTankerLink.linked_from.desc(),
            PrimeMoverTankerLink.id.desc(),
        )
        .all()
    )

    return [
        build_prime_mover_tanker_link_response(link, db)
        for link in links
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
        "View Asset",
        db,
    )

    link = (
        db.query(PrimeMoverTankerLink)
        .filter(
            PrimeMoverTankerLink.prime_mover_asset_code.ilike(
                prime_mover_asset_code
            ),
            PrimeMoverTankerLink.status == "Active",
        )
        .order_by(
            PrimeMoverTankerLink.linked_from.desc(),
            PrimeMoverTankerLink.id.desc(),
        )
        .first()
    )

    if not link:
        return {
            "has_active_link": False,
            "link": None,
        }

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
        "Manage Asset",
        db,
    )

    validated_data = validate_prime_mover_tanker_link(
        link_request,
        db,
    )

    new_link = PrimeMoverTankerLink(
        prime_mover_asset_code=validated_data["prime_mover_asset_code"],
        tanker_asset_code=validated_data["tanker_asset_code"],
        linked_from=validated_data["linked_from"],
        linked_to=validated_data["linked_to"],
        remarks=validated_data["remarks"],
        status=validated_data["status"],
        created_by=get_current_user_display_name(current_user),
    )

    db.add(new_link)
    db.flush()

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

    db.commit()
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
        "Manage Asset",
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

    before_data = build_prime_mover_tanker_link_audit_snapshot(
        existing_link,
        db,
    )

    validated_data = validate_prime_mover_tanker_link(
        link_request,
        db,
        link_id=link_id,
    )

    existing_link.prime_mover_asset_code = validated_data[
        "prime_mover_asset_code"
    ]
    existing_link.tanker_asset_code = validated_data["tanker_asset_code"]
    existing_link.linked_from = validated_data["linked_from"]
    existing_link.linked_to = validated_data["linked_to"]
    existing_link.remarks = validated_data["remarks"]
    existing_link.status = validated_data["status"]
    existing_link.updated_at = datetime.now()

    db.flush()

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

    db.commit()
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
        "Manage Asset",
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

    db.flush()

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

    db.commit()
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
        "Manage Asset",
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
    db.commit()

    return {
        "message": "Prime Mover Tanker link deleted successfully",
    }