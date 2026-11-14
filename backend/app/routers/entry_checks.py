"""FastAPI router for Pre-Save Entry Checks, Tier 2 ML Screening & Audited Reviews."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies.auth import get_current_user_from_token
from app.dependencies.permissions import require_user_permission
from app.models import User
from app.services import entry_checks_service

router = APIRouter(prefix="/entry-checks", tags=["Entry Quality Checks"])


class EntryCheckPreviewRequest(BaseModel):
    layout: str = Field(..., min_length=1, max_length=60)
    entity_type: str = Field(default="operation_transaction", max_length=60)
    entity_id: int | None = None
    location_code: str = Field(default="", max_length=100)
    asset_code: str = Field(default="", max_length=100)
    linked_sender_transaction_id: int | None = None
    payload: dict[str, Any] = Field(default_factory=dict)


class BulkPreviewRowRequest(BaseModel):
    row_number: int
    location_code: str = ""
    asset_code: str = ""
    payload: dict[str, Any] = Field(default_factory=dict)


class BulkEntryCheckPreviewRequest(BaseModel):
    layout: str = Field(..., min_length=1, max_length=60)
    rows: list[BulkPreviewRowRequest] = Field(default_factory=list)


class KeepCheckReviewRequest(BaseModel):
    entity_type: str = Field(default="operation_transaction", max_length=60)
    entity_id: int
    check_key: str = Field(..., min_length=1, max_length=255)
    check_code: str = Field(..., min_length=1, max_length=60)
    fingerprint: str = Field(..., min_length=1, max_length=96)
    subject_label: str = Field(default="", max_length=255)
    value_label: str = Field(default="", max_length=160)
    note: str = Field(default="", max_length=300)
    location_code: str | None = Field(default=None, max_length=100)
    asset_code: str | None = Field(default=None, max_length=100)
    feature_vector: list[float | None] | None = None


class ReopenCheckReviewRequest(BaseModel):
    entity_type: str = Field(default="operation_transaction", max_length=60)
    entity_id: int
    check_key: str = Field(..., min_length=1, max_length=255)


@router.post("/preview")
def preview_entry_checks(
    body: EntryCheckPreviewRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_from_token),
):
    require_user_permission(current_user, "View Entry Checks", db)
    return entry_checks_service.evaluate_preview(db, current_user, body.model_dump())


@router.post("/bulk-preview")
def bulk_preview_entry_checks(
    body: BulkEntryCheckPreviewRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_from_token),
):
    require_user_permission(current_user, "View Entry Checks", db)
    results: list[dict[str, Any]] = []
    for item in body.rows[:50]:
        res = entry_checks_service.evaluate_preview(
            db,
            current_user,
            {
                "layout": body.layout,
                "entity_type": "bulk_import_row",
                "location_code": item.location_code,
                "asset_code": item.asset_code,
                "payload": item.payload,
            },
        )
        results.append({
            "row_number": item.row_number,
            "open_warnings": res["open_warnings"],
            "open_notices": res["open_notices"],
            "checks": res["checks"],
        })
    return {
        "rows_checked": len(results),
        "rows_with_warnings": sum(1 for r in results if r["open_warnings"] > 0),
        "rows_with_notices": sum(1 for r in results if r["open_notices"] > 0),
        "results": results,
    }


@router.get("/transactions/{transaction_id}")
def get_transaction_entry_checks(
    transaction_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_from_token),
):
    require_user_permission(current_user, "View Entry Checks", db)
    try:
        return entry_checks_service.evaluate_saved_transaction(db, current_user, transaction_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/reviews")
def keep_entry_check_as_entered(
    body: KeepCheckReviewRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_from_token),
):
    require_user_permission(current_user, "Review Entry Check", db)
    try:
        row = entry_checks_service.keep_check_as_entered(
            db,
            current_user,
            entity_type=body.entity_type,
            entity_id=body.entity_id,
            check_key=body.check_key,
            check_code=body.check_code,
            fingerprint=body.fingerprint,
            subject_label=body.subject_label,
            value_label=body.value_label,
            note=body.note,
            location_code=body.location_code,
            asset_code=body.asset_code,
            feature_vector=body.feature_vector,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {
        "id": row.id,
        "entity_type": row.entity_type,
        "entity_id": row.entity_id,
        "check_key": row.check_key,
        "fingerprint": row.fingerprint,
        "note": row.note,
        "reviewed_by": row.reviewed_by,
        "reviewed_at": row.reviewed_at.isoformat() if row.reviewed_at else None,
    }


@router.post("/reviews/reopen")
def reopen_entry_check(
    body: ReopenCheckReviewRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_from_token),
):
    require_user_permission(current_user, "Review Entry Check", db)
    try:
        removed = entry_checks_service.reopen_check_review(
            db,
            current_user,
            entity_type=body.entity_type,
            entity_id=body.entity_id,
            check_key=body.check_key,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"reopened": removed, "check_key": body.check_key}


@router.get("/open-summary")
def get_open_abnormalities_summary(
    location_code: str | None = Query(default=None),
    limit: int = Query(default=40, ge=1, le=80),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_from_token),
):
    require_user_permission(current_user, "View Entry Checks", db)
    items = entry_checks_service.list_open_ticket_abnormalities(
        db,
        current_user,
        location_code=location_code,
        limit=limit,
    )
    return {"count": len(items), "items": items}
