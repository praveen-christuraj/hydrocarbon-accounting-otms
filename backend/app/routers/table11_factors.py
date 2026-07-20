from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Table11Factor, User
from app.schemas import Table11FactorBulkCreate, Table11FactorResponse, Table11LookupResponse
from app.dependencies.auth import get_current_user_from_token
from app.dependencies.permissions import require_user_permission
from app.services.audit_service import create_audit_log

router = APIRouter(prefix="/table11-factors", tags=["Table 11 Factors"])


def build_table11_factor_response(row: Table11Factor):
    return {
        "id": row.id,
        "api60": float(row.api60),
        "lt_factor": float(row.lt_factor),
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }


def interpolate_table11_factor(api60: float, db: Session):
    if api60 is None:
        raise HTTPException(
            status_code=400,
            detail="API @ 60\u00b0F is required",
        )

    api_value = float(api60)

    rows = (
        db.query(Table11Factor)
        .order_by(Table11Factor.api60.asc())
        .all()
    )

    if len(rows) == 0:
        raise HTTPException(
            status_code=400,
            detail="Table 11 factor master is empty. Please upload API@60 and LT factor data first.",
        )

    exact_row = next(
        (
            row
            for row in rows
            if float(row.api60) == api_value
        ),
        None,
    )

    if exact_row:
        return {
            "api60": api_value,
            "lower_api60": float(exact_row.api60),
            "upper_api60": float(exact_row.api60),
            "lt_factor": float(exact_row.lt_factor),
            "lookup_method": "Exact match",
        }

    lower_row = None
    upper_row = None

    for row in rows:
        row_api = float(row.api60)

        if row_api < api_value:
            lower_row = row

        if row_api > api_value:
            upper_row = row
            break

    if lower_row is None:
        first_row = rows[0]

        return {
            "api60": api_value,
            "lower_api60": float(first_row.api60),
            "upper_api60": float(first_row.api60),
            "lt_factor": float(first_row.lt_factor),
            "lookup_method": "Below range - nearest factor used",
        }

    if upper_row is None:
        last_row = rows[-1]

        return {
            "api60": api_value,
            "lower_api60": float(last_row.api60),
            "upper_api60": float(last_row.api60),
            "lt_factor": float(last_row.lt_factor),
            "lookup_method": "Above range - nearest factor used",
        }

    lower_api = float(lower_row.api60)
    upper_api = float(upper_row.api60)
    lower_factor = float(lower_row.lt_factor)
    upper_factor = float(upper_row.lt_factor)

    if upper_api == lower_api:
        interpolated_factor = lower_factor
    else:
        ratio = (api_value - lower_api) / (upper_api - lower_api)
        interpolated_factor = lower_factor + ratio * (upper_factor - lower_factor)

    return {
        "api60": api_value,
        "lower_api60": lower_api,
        "upper_api60": upper_api,
        "lt_factor": round(interpolated_factor, 10),
        "lookup_method": "Linear interpolation",
    }


def build_table11_audit_snapshot(db: Session, preview_limit: int = 20):
    rows = db.query(Table11Factor).order_by(Table11Factor.api60.asc()).all()

    count = len(rows)

    min_api = float(rows[0].api60) if count > 0 else None
    max_api = float(rows[-1].api60) if count > 0 else None

    preview_rows = rows[:preview_limit]

    return {
        "count": count,
        "min_api60": min_api,
        "max_api60": max_api,
        "preview_limit": preview_limit,
        "preview_rows": [
            {
                "api60": float(r.api60),
                "lt_factor": float(r.lt_factor),
            }
            for r in preview_rows
        ],
    }


@router.get(
    "",
    response_model=list[Table11FactorResponse],
)
def get_table11_factors(
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "View Asset Calibration",
        db,
    )

    rows = (
        db.query(Table11Factor)
        .order_by(Table11Factor.api60.asc())
        .all()
    )

    return [
        build_table11_factor_response(row)
        for row in rows
    ]


@router.get(
    "/lookup",
    response_model=Table11LookupResponse,
)
def lookup_table11_factor(
    api60: float,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "View Asset Calibration",
        db,
    )

    return interpolate_table11_factor(api60, db)


@router.post(
    "/bulk",
    response_model=list[Table11FactorResponse],
)
def bulk_save_table11_factors(
    request: Table11FactorBulkCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage Asset Calibration",
        db,
    )

    if len(request.rows) == 0:
        raise HTTPException(
            status_code=400,
            detail="Please provide at least one Table 11 row",
        )

    api_values = [float(row.api60) for row in request.rows]

    if len(api_values) != len(set(api_values)):
        raise HTTPException(
            status_code=400,
            detail="Duplicate API @ 60\u00b0F values are not allowed",
        )

    for row in request.rows:
        if row.api60 <= 0:
            raise HTTPException(
                status_code=400,
                detail="API @ 60\u00b0F must be greater than zero",
            )
        if row.lt_factor <= 0:
            raise HTTPException(
                status_code=400,
                detail=f"LT factor must be greater than zero for API @ 60\u00b0F {row.api60}",
            )

    before_snapshot = build_table11_audit_snapshot(db, preview_limit=20)

    db.query(Table11Factor).delete()

    for row in request.rows:
        db.add(
            Table11Factor(
                api60=float(row.api60),
                lt_factor=float(row.lt_factor),
            )
        )

    db.flush()

    after_snapshot = build_table11_audit_snapshot(db, preview_limit=20)

    create_audit_log(
        db=db,
        module_name="Table 11 Factor Master",
        action="Bulk Save Table 11 Factors",
        current_user=current_user,
        entity_type="Table11Factor",
        entity_id=None,
        entity_label="Table 11 Factor Master",
        remarks="Replaced Table 11 factor master rows",
        request_path="/table11-factors/bulk",
        details={
            "before": before_snapshot,
            "after": after_snapshot,
            "input_row_count": len(request.rows),
        },
    )

    db.commit()

    saved_rows = db.query(Table11Factor).order_by(Table11Factor.api60.asc()).all()

    return [build_table11_factor_response(row) for row in saved_rows]


@router.delete("")
def clear_table11_factors(
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage Asset Calibration",
        db,
    )

    before_snapshot = build_table11_audit_snapshot(db, preview_limit=20)

    deleted_count = db.query(Table11Factor).delete()
    db.flush()

    after_snapshot = build_table11_audit_snapshot(db, preview_limit=20)

    create_audit_log(
        db=db,
        module_name="Table 11 Factor Master",
        action="Clear Table 11 Factors",
        current_user=current_user,
        entity_type="Table11Factor",
        entity_id=None,
        entity_label="Table 11 Factor Master",
        remarks="Cleared all Table 11 factor rows",
        request_path="/table11-factors",
        details={
            "before": before_snapshot,
            "after": after_snapshot,
            "deleted_count": deleted_count,
        },
    )

    db.commit()

    return {
        "message": "Table 11 factors cleared successfully",
        "deleted_count": deleted_count,
    }
