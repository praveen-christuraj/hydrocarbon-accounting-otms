"""FastAPI router for Hydrocarbon Accounting & Stock Anomaly Analytics."""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies.auth import get_current_user_from_token
from app.dependencies.permissions import ensure_location_in_user_scope, require_user_permission
from app.models import User
from app.services import entry_checks_service, stock_anomaly_service
from app.services.audit_service import create_audit_log

router = APIRouter(prefix="/analytics/stock-anomalies", tags=["Stock Anomaly Analytics"])


@router.get("/overview")
def get_stock_anomalies_overview(
    location_code: str | None = Query(default=None),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_from_token),
):
    require_user_permission(current_user, "View Stock Anomaly Analytics", db)
    if location_code:
        ensure_location_in_user_scope(current_user, db, location_code)
    return stock_anomaly_service.get_stock_anomaly_overview(
        db,
        current_user,
        location_code=location_code or None,
        date_from=date_from,
        date_to=date_to,
    )


@router.post("/refresh-profiles")
def refresh_asset_profiles(
    location_code: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_from_token),
):
    require_user_permission(current_user, "View Stock Anomaly Analytics", db)
    if location_code:
        ensure_location_in_user_scope(current_user, db, location_code)
    summary = entry_checks_service.refresh_asset_metric_profiles(
        db,
        location_code=location_code or None,
    )
    create_audit_log(
        db=db,
        module_name="Stock Anomaly Analytics",
        action="Refresh Asset Metric Profiles",
        current_user=current_user,
        entity_type="asset_metric_profiles",
        entity_label=location_code or "ALL",
        remarks=f"Refreshed {summary['profiles_updated']} metric profiles across {summary['assets_scanned']} assets",
        request_path="/analytics/stock-anomalies/refresh-profiles",
        details=summary,
    )
    db.commit()
    return summary
