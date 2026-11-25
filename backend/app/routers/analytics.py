"""Interactive Analytics dashboards, sharing, execution and exports."""
from __future__ import annotations

import copy
import re
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies.auth import get_current_user_from_token
from app.dependencies.permissions import (
    get_user_report_location_codes,
    get_user_role_ids,
    is_admin_user,
    normalize_location_code,
    require_any_user_permission,
    require_user_permission,
)
from app.models import (
    AnalyticsDashboardDefinition,
    AnalyticsDashboardGrant,
    AnalyticsDashboardVersion,
    Location,
    Role,
    User,
)
from app.schemas import (
    AnalyticsBatchRunRequest,
    AnalyticsDashboardCreate,
    AnalyticsDashboardUpdate,
    FormulaValidateRequest,
)
from app.services.analytics_engine import (
    ReportDefinitionError,
    export_dashboard_workbook_bytes,
    run_dashboard,
    run_visual,
    run_visual_records,
    validate_analytics_definition,
)
from app.services.audit_service import create_audit_log
from app.services.report_catalog import build_catalog
from app.services.report_engine import export_csv_bytes, export_xlsx_bytes
from app.services.report_formula import validate_formula
from app.utils.helpers import get_current_user_display_name

router = APIRouter(prefix="/analytics", tags=["Analytics"])
BUILDER_PERMISSIONS = ["View Analytics Definition", "Create Analytics Definition", "Edit Analytics Definition"]


def _grants_of(db: Session, dashboard_id: int) -> list[AnalyticsDashboardGrant]:
    return (
        db.query(AnalyticsDashboardGrant)
        .filter(AnalyticsDashboardGrant.dashboard_id == dashboard_id)
        .order_by(AnalyticsDashboardGrant.grant_type, AnalyticsDashboardGrant.id)
        .all()
    )


def _my_access(db: Session, user: User, dashboard: AnalyticsDashboardDefinition, grants=None) -> str | None:
    if is_admin_user(user, db) or dashboard.owner_user_id == user.id:
        return "OWNER"
    role_ids = get_user_role_ids(db, user)
    scope = get_user_report_location_codes(user, db)
    best = None
    for grant in grants if grants is not None else _grants_of(db, dashboard.id):
        matched = (
            grant.grant_type == "USER" and grant.user_id == user.id
        ) or (
            grant.grant_type == "ROLE" and grant.role_id in role_ids
        ) or (
            grant.grant_type == "LOCATION"
            and (scope is None or normalize_location_code(grant.location_code) in scope)
        )
        if matched and grant.access_level == "EDIT":
            return "EDIT"
        if matched:
            best = "VIEW"
    return best


def _get_dashboard_or_404(db: Session, dashboard_id: int):
    dashboard = db.query(AnalyticsDashboardDefinition).filter(
        AnalyticsDashboardDefinition.id == dashboard_id
    ).first()
    if not dashboard:
        raise HTTPException(status_code=404, detail="Dashboard not found")
    return dashboard


def _require_builder_access(db, user, dashboard, minimum="VIEW"):
    access = _my_access(db, user, dashboard)
    rank = {"VIEW": 1, "EDIT": 2, "OWNER": 3}
    if access is None or rank[access] < rank[minimum]:
        raise HTTPException(status_code=404, detail="Dashboard not found")
    return access


def _require_run_access(db, user, dashboard):
    require_user_permission(user, "View Analytics Dashboard", db)
    if dashboard.status != "Active" or dashboard.is_published != "Yes":
        raise HTTPException(status_code=404, detail="Dashboard not found")
    access = _my_access(db, user, dashboard)
    if access is None:
        raise HTTPException(status_code=404, detail="Dashboard not found")
    if dashboard.scope_type == "LOCATION":
        allowed = get_user_report_location_codes(user, db)
        if allowed is not None and normalize_location_code(dashboard.location_code) not in allowed:
            raise HTTPException(status_code=404, detail="Dashboard not found")
    return access


def _slug_code(db: Session, name: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", str(name or "dashboard").casefold()).strip("-")[:100] or "dashboard"
    candidate, suffix = base, 2
    while db.query(AnalyticsDashboardDefinition).filter_by(dashboard_code=candidate).first():
        candidate = f"{base}-{suffix}"
        suffix += 1
    return candidate


def _validate_grants(db: Session, actor: User, grants_in):
    cleaned, seen = [], set()
    scope = get_user_report_location_codes(actor, db)
    admin = is_admin_user(actor, db)
    for grant in grants_in or []:
        kind = str(grant.grant_type or "").upper()
        level = str(grant.access_level or "VIEW").upper()
        if kind not in {"USER", "ROLE", "LOCATION"} or level not in {"VIEW", "EDIT"}:
            raise HTTPException(status_code=400, detail="Dashboard grants must target a User, Role or Location with View or Edit access.")
        row = {"grant_type": kind, "user_id": None, "role_id": None, "location_code": None, "access_level": level}
        if kind == "USER":
            if not grant.user_id or not db.query(User).filter(User.id == grant.user_id).first():
                raise HTTPException(status_code=400, detail="A selected dashboard user no longer exists.")
            row["user_id"] = grant.user_id
            marker = (kind, grant.user_id, level)
        elif kind == "ROLE":
            if not grant.role_id or not db.query(Role).filter(Role.id == grant.role_id).first():
                raise HTTPException(status_code=400, detail="A selected dashboard role no longer exists.")
            row["role_id"] = grant.role_id
            marker = (kind, grant.role_id, level)
        else:
            if level == "EDIT":
                raise HTTPException(status_code=400, detail="Location grants are View-only; grant Edit to a named user or role.")
            code = str(grant.location_code or "").strip().upper()
            location = db.query(Location).filter(func.upper(Location.location_code) == code).first()
            if not location:
                raise HTTPException(status_code=400, detail="A selected dashboard location no longer exists.")
            if not admin and scope is not None and normalize_location_code(code) not in scope:
                raise HTTPException(status_code=403, detail="You cannot share a dashboard with a location outside your assigned scope.")
            row["location_code"] = location.location_code
            marker = (kind, location.location_code, level)
        if marker not in seen:
            cleaned.append(row)
            seen.add(marker)
    return cleaned


def _replace_grants(db, user, dashboard_id, grants):
    db.query(AnalyticsDashboardGrant).filter(
        AnalyticsDashboardGrant.dashboard_id == dashboard_id
    ).delete(synchronize_session=False)
    created_by = get_current_user_display_name(user)
    for row in grants:
        db.add(AnalyticsDashboardGrant(dashboard_id=dashboard_id, created_by=created_by, **row))


def _grant_response(db, grant):
    label = grant.location_code
    if grant.grant_type == "USER":
        target = db.query(User).filter(User.id == grant.user_id).first()
        label = f"{target.full_name} ({target.username})" if target else f"User #{grant.user_id}"
    elif grant.grant_type == "ROLE":
        target = db.query(Role).filter(Role.id == grant.role_id).first()
        label = target.role_name if target else f"Role #{grant.role_id}"
    elif grant.grant_type == "LOCATION":
        target = db.query(Location).filter(Location.location_code == grant.location_code).first()
        label = f"{grant.location_code} — {target.location_name}" if target else grant.location_code
    return {
        "id": grant.id, "grant_type": grant.grant_type, "user_id": grant.user_id,
        "role_id": grant.role_id, "location_code": grant.location_code,
        "access_level": grant.access_level, "label": label,
    }


def _serialize(db, user, dashboard, include_definition=True):
    owner = db.query(User).filter(User.id == dashboard.owner_user_id).first() if dashboard.owner_user_id else None
    output = {
        "id": dashboard.id, "dashboard_code": dashboard.dashboard_code,
        "dashboard_name": dashboard.dashboard_name, "description": dashboard.description,
        "scope_type": dashboard.scope_type, "location_code": dashboard.location_code,
        "visibility": dashboard.visibility, "is_published": dashboard.is_published == "Yes",
        "status": dashboard.status, "version": dashboard.version,
        "owner_user_id": dashboard.owner_user_id,
        "owner_name": owner.full_name if owner else dashboard.created_by,
        "created_by": dashboard.created_by, "updated_by": dashboard.updated_by,
        "created_at": dashboard.created_at, "updated_at": dashboard.updated_at,
        "my_access": _my_access(db, user, dashboard) or "VIEW",
        "visual_count": len((dashboard.definition_json or {}).get("visuals") or []),
    }
    if include_definition:
        output["definition"] = copy.deepcopy(dashboard.definition_json or {})
        output["grants"] = [_grant_response(db, grant) for grant in _grants_of(db, dashboard.id)]
    return output


def _ensure_unique_name(db, name, scope_type, location_code, exclude_id=None):
    query = db.query(AnalyticsDashboardDefinition).filter(
        func.lower(func.trim(AnalyticsDashboardDefinition.dashboard_name)) == str(name or "").strip().casefold(),
        AnalyticsDashboardDefinition.scope_type == scope_type,
    )
    if exclude_id is not None:
        query = query.filter(AnalyticsDashboardDefinition.id != exclude_id)
    if location_code is None:
        query = query.filter(AnalyticsDashboardDefinition.location_code.is_(None))
    else:
        query = query.filter(func.upper(AnalyticsDashboardDefinition.location_code) == str(location_code).upper())
    if query.first():
        raise HTTPException(status_code=400, detail="A dashboard with this name already exists in the selected scope.")


def _validated_location(db, user, scope_type, location_code):
    scope_type = str(scope_type or "LOCATION").upper()
    if scope_type not in {"GLOBAL", "LOCATION"}:
        raise HTTPException(status_code=400, detail="Dashboard scope must be GLOBAL or LOCATION.")
    if scope_type == "GLOBAL":
        if not is_admin_user(user, db):
            raise HTTPException(status_code=403, detail="Only administrators can create GLOBAL analytics dashboards.")
        return None
    code = str(location_code or "").strip().upper()
    if not code:
        raise HTTPException(status_code=400, detail="Choose a location for a location-scoped dashboard.")
    location = db.query(Location).filter(func.upper(Location.location_code) == code).first()
    if not location:
        raise HTTPException(status_code=404, detail=f"Location {code} was not found.")
    scope = get_user_report_location_codes(user, db)
    if not is_admin_user(user, db) and scope is not None and normalize_location_code(code) not in scope:
        raise HTTPException(status_code=403, detail="The dashboard location is outside your assigned scope.")
    return location.location_code


def _runner_params(db, user, dashboard, request):
    values = dict(request.runtime_values or {})
    params = {
        "date_from": request.date_from,
        "date_to": request.date_to,
        "runtime_values": values,
        "selection_filters": list(getattr(request, "selection_filters", None) or []),
        "location_codes": list(request.location_codes or []),
        "search": getattr(request, "search", None),
        "page_size": 500,
    }
    if dashboard.scope_type == "LOCATION":
        params["location_codes"] = [dashboard.location_code]
    else:
        scope = get_user_report_location_codes(user, db)
        requested = params["location_codes"]
        if scope is not None:
            if requested:
                outside = [code for code in requested if normalize_location_code(code) not in scope]
                if outside:
                    raise HTTPException(status_code=403, detail="One or more selected locations are outside your reporting scope.")
            else:
                params["location_codes"] = sorted(scope)
    if request.date_from and request.date_to and request.date_from > request.date_to:
        raise HTTPException(status_code=400, detail="Date From cannot be after Date To.")
    return params


def _audit(db, user, action, dashboard, details=None):
    create_audit_log(
        db=db, module_name="Analytics", action=action, current_user=user,
        entity_type="AnalyticsDashboard", entity_id=dashboard.id,
        entity_label=dashboard.dashboard_name, remarks=action,
        request_path="/analytics", details=details or {},
    )


def _save_version(db, user, dashboard, note=None):
    db.add(AnalyticsDashboardVersion(
        dashboard_id=dashboard.id, version_number=dashboard.version,
        definition_json=copy.deepcopy(dashboard.definition_json or {}),
        change_note=note, created_by=get_current_user_display_name(user),
    ))


@router.post("/formula/validate")
def validate_analytics_formula(
    payload: FormulaValidateRequest,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_any_user_permission(current_user, BUILDER_PERMISSIONS, db)
    return validate_formula(payload.formula, set(payload.column_keys or []) or None)


@router.get("/catalog")
def get_analytics_catalog(
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_any_user_permission(current_user, BUILDER_PERMISSIONS, db)
    catalog = build_catalog()
    visible_scope = get_user_report_location_codes(current_user, db)
    location_rows = db.query(Location).filter(Location.status == "Active").order_by(Location.location_name.asc()).all()
    catalog["locations"] = [
        {"location_code": location.location_code, "location_name": location.location_name}
        for location in location_rows
        if visible_scope is None or normalize_location_code(location.location_code) in visible_scope
    ]
    catalog["is_admin"] = is_admin_user(current_user, db)
    catalog["datasets"].append({
        "id": "tank_snapshot",
        "kind": "tank_snapshot",
        "name": "Shore Tank Capacity & Stock Snapshot — live ledger + calibration",
        "description": "Live closing stock, active strapping capacity, ullage and fill % across active shore tanks in scope.",
        "icon": "droplet",
        "columns": [
            {"column": "tank_asset_code", "label": "Tank Code", "data_type": "text"},
            {"column": "tank_asset_name", "label": "Tank Name", "data_type": "text"},
            {"column": "location_code", "label": "Location", "data_type": "text", "is_location": True},
            {"column": "product_name", "label": "Product", "data_type": "text"},
            {"column": "current_stock", "label": "Current Stock", "data_type": "number"},
            {"column": "capacity", "label": "Max Capacity", "data_type": "number"},
            {"column": "ullage", "label": "Available Ullage", "data_type": "number"},
            {"column": "fill_pct", "label": "Fill %", "data_type": "number"},
            {"column": "accounting_date", "label": "Last Accounting Date", "data_type": "date", "is_date": True},
        ],
        "virtual_fields": [], "supports_template_fields": False,
        "supports_payload_json": False, "default_date_basis": "ACCOUNTING_DATE",
    })
    catalog["datasets"].append({
        "id": "material_balance",
        "kind": "material_balance",
        "name": "Material Balance Report — active location template",
        "description": "Reads the location's active Material Balance Template and continuity-aware Tank Stock Ledger; choose a location and date range when viewing.",
        "icon": "database",
        "columns": [
            {"column": "accounting_date", "label": "Accounting Date", "data_type": "date", "is_date": True},
            {"column": "tank_asset_code", "label": "Tank", "data_type": "text"},
            {"column": "product_name", "label": "Product", "data_type": "text"},
            {"column": "values", "label": "Template-defined columns", "data_type": "number", "is_dynamic": True},
        ],
        "virtual_fields": [], "supports_template_fields": False,
        "supports_payload_json": False, "default_date_basis": "ACCOUNTING_DATE",
    })
    return catalog


@router.get("/lookups")
def get_analytics_lookups(
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_any_user_permission(current_user, BUILDER_PERMISSIONS, db)
    visible_scope = get_user_report_location_codes(current_user, db)
    users = db.query(User).order_by(User.full_name.asc(), User.username.asc()).limit(500).all()
    roles = db.query(Role).order_by(Role.role_name.asc()).all()
    locations = db.query(Location).filter(Location.status == "Active").order_by(Location.location_name.asc()).all()
    return {
        "users": [{"id": u.id, "username": u.username, "full_name": u.full_name} for u in users],
        "roles": [{"id": r.id, "role_name": r.role_name} for r in roles],
        "locations": [
            {"location_code": loc.location_code, "location_name": loc.location_name}
            for loc in locations
            if visible_scope is None or normalize_location_code(loc.location_code) in visible_scope
        ],
    }


@router.get("/definitions")
def list_definitions(
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_any_user_permission(current_user, BUILDER_PERMISSIONS, db)
    dashboards = db.query(AnalyticsDashboardDefinition).order_by(
        AnalyticsDashboardDefinition.updated_at.desc(), AnalyticsDashboardDefinition.id.desc()
    ).all()
    return [_serialize(db, current_user, dashboard, include_definition=False) for dashboard in dashboards
            if _my_access(db, current_user, dashboard) is not None]


@router.get("/definitions/{dashboard_id}")
def get_definition(
    dashboard_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_any_user_permission(current_user, BUILDER_PERMISSIONS, db)
    dashboard = _get_dashboard_or_404(db, dashboard_id)
    _require_builder_access(db, current_user, dashboard)
    return _serialize(db, current_user, dashboard)


@router.post("/definitions")
def create_definition(
    payload: AnalyticsDashboardCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Create Analytics Definition", db)
    try:
        definition = validate_analytics_definition(payload.definition)
    except ReportDefinitionError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    scope_type = str(payload.scope_type or "LOCATION").upper()
    location_code = _validated_location(db, current_user, scope_type, payload.location_code)
    _ensure_unique_name(db, payload.dashboard_name, scope_type, location_code)
    if str(payload.visibility or "PRIVATE").upper() != "PRIVATE":
        raise HTTPException(status_code=400, detail="Only PRIVATE dashboard visibility is enabled in this release; share with explicit grants.")
    if payload.is_published:
        require_user_permission(current_user, "Publish Analytics Definition", db)
    grants = _validate_grants(db, current_user, payload.grants)
    if payload.status not in {"Active", "Archived"}:
        raise HTTPException(status_code=400, detail="Dashboard status must be Active or Archived.")
    dashboard = AnalyticsDashboardDefinition(
        dashboard_code=_slug_code(db, payload.dashboard_name),
        dashboard_name=payload.dashboard_name.strip(), description=payload.description,
        scope_type=scope_type, location_code=location_code, definition_json=definition,
        visibility="PRIVATE", is_published="Yes" if payload.is_published else "No",
        status=payload.status, version=1, owner_user_id=current_user.id,
        created_by=get_current_user_display_name(current_user), updated_by=get_current_user_display_name(current_user),
    )
    db.add(dashboard)
    db.flush()
    _replace_grants(db, current_user, dashboard.id, grants)
    _save_version(db, current_user, dashboard, payload.change_note or "Initial version")
    _audit(db, current_user, "Create Analytics Dashboard", dashboard, {"visual_count": len(definition.get("visuals") or [])})
    db.commit()
    db.refresh(dashboard)
    return _serialize(db, current_user, dashboard)


@router.put("/definitions/{dashboard_id}")
def update_definition(
    dashboard_id: int,
    payload: AnalyticsDashboardUpdate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Edit Analytics Definition", db)
    dashboard = _get_dashboard_or_404(db, dashboard_id)
    _require_builder_access(db, current_user, dashboard, "EDIT")
    try:
        definition = validate_analytics_definition(payload.definition)
    except ReportDefinitionError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    scope_type = str(payload.scope_type or dashboard.scope_type).upper()
    location_code = _validated_location(db, current_user, scope_type, payload.location_code or dashboard.location_code)
    _ensure_unique_name(db, payload.dashboard_name, scope_type, location_code, exclude_id=dashboard.id)
    if str(payload.visibility or "PRIVATE").upper() != "PRIVATE":
        raise HTTPException(status_code=400, detail="Only PRIVATE dashboard visibility is enabled in this release.")
    if bool(payload.is_published) != (dashboard.is_published == "Yes"):
        require_user_permission(current_user, "Publish Analytics Definition", db)
    grants = _validate_grants(db, current_user, payload.grants)
    if payload.status not in {"Active", "Archived"}:
        raise HTTPException(status_code=400, detail="Dashboard status must be Active or Archived.")
    old = {"dashboard_name": dashboard.dashboard_name, "version": dashboard.version, "is_published": dashboard.is_published}
    dashboard.dashboard_name = payload.dashboard_name.strip()
    dashboard.description = payload.description
    dashboard.scope_type = scope_type
    dashboard.location_code = location_code
    dashboard.definition_json = definition
    dashboard.status = payload.status
    dashboard.is_published = "Yes" if payload.is_published else "No"
    dashboard.visibility = "PRIVATE"
    dashboard.version += 1
    dashboard.updated_by = get_current_user_display_name(current_user)
    dashboard.updated_at = datetime.now()
    _replace_grants(db, current_user, dashboard.id, grants)
    _save_version(db, current_user, dashboard, payload.change_note)
    _audit(db, current_user, "Update Analytics Dashboard", dashboard, {"old": old, "visual_count": len(definition.get("visuals") or [])})
    db.commit()
    db.refresh(dashboard)
    return _serialize(db, current_user, dashboard)


@router.delete("/definitions/{dashboard_id}")
def delete_definition(
    dashboard_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Delete Analytics Definition", db)
    dashboard = _get_dashboard_or_404(db, dashboard_id)
    _require_builder_access(db, current_user, dashboard, "EDIT")
    details = {"dashboard_name": dashboard.dashboard_name, "version": dashboard.version}
    _audit(db, current_user, "Delete Analytics Dashboard", dashboard, details)
    db.delete(dashboard)
    db.commit()
    return {"message": "Analytics dashboard deleted."}


@router.post("/definitions/{dashboard_id}/publish")
def publish_definition(
    dashboard_id: int,
    payload: dict,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Publish Analytics Definition", db)
    dashboard = _get_dashboard_or_404(db, dashboard_id)
    _require_builder_access(db, current_user, dashboard, "EDIT")
    if not isinstance(payload.get("published"), bool):
        raise HTTPException(status_code=400, detail="Published must be true or false.")
    published = payload["published"]
    if published:
        try:
            validate_analytics_definition(dashboard.definition_json or {})
        except ReportDefinitionError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    dashboard.is_published = "Yes" if published else "No"
    dashboard.version += 1
    dashboard.updated_at = datetime.now()
    dashboard.updated_by = get_current_user_display_name(current_user)
    _save_version(db, current_user, dashboard, "Published" if published else "Unpublished")
    _audit(db, current_user, "Publish Analytics Dashboard" if published else "Unpublish Analytics Dashboard", dashboard)
    db.commit()
    db.refresh(dashboard)
    return _serialize(db, current_user, dashboard)


@router.get("/definitions/{dashboard_id}/versions")
def list_versions(
    dashboard_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_any_user_permission(current_user, BUILDER_PERMISSIONS, db)
    dashboard = _get_dashboard_or_404(db, dashboard_id)
    _require_builder_access(db, current_user, dashboard)
    versions = db.query(AnalyticsDashboardVersion).filter(
        AnalyticsDashboardVersion.dashboard_id == dashboard_id
    ).order_by(AnalyticsDashboardVersion.version_number.desc()).all()
    return [{"id": item.id, "version_number": item.version_number, "definition": item.definition_json,
             "change_note": item.change_note, "created_by": item.created_by, "created_at": item.created_at}
            for item in versions]


@router.post("/run-preview")
def run_preview(
    payload: dict,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_any_user_permission(current_user, BUILDER_PERMISSIONS, db)
    definition = payload.get("definition") or {}
    params = dict(payload.get("params") or {})
    scope = get_user_report_location_codes(current_user, db)
    requested_locations = params.get("location_codes") or []
    if isinstance(requested_locations, str):
        requested_locations = [requested_locations]
    if scope is not None:
        outside = [code for code in requested_locations if normalize_location_code(code) not in scope]
        if outside:
            raise HTTPException(status_code=403, detail="One or more selected locations are outside your reporting scope.")
        if not requested_locations:
            params["location_codes"] = sorted(scope)
    for key in ("date_from", "date_to"):
        value = params.get(key)
        if isinstance(value, str) and value.strip():
            try:
                params[key] = date.fromisoformat(value.strip())
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=f"{key} must be an ISO date.") from exc
    try:
        normalized = validate_analytics_definition(definition)
        if scope is not None:
            for visual in normalized.get("visuals", []):
                source = ((visual.get("query") or {}).get("source") or {})
                source_location = source.get("location_code") if source.get("kind") == "material_balance" else None
                if source_location and normalize_location_code(source_location) not in scope:
                    raise HTTPException(status_code=403, detail="The Material Balance visual location is outside your reporting scope.")
        result = run_dashboard(db, current_user, normalized, params, payload.get("visual_ids"))
    except ReportDefinitionError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return result


@router.get("/my-dashboards")
def list_my_dashboards(
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "View Analytics Dashboard", db)
    dashboards = db.query(AnalyticsDashboardDefinition).filter(
        AnalyticsDashboardDefinition.status == "Active",
        AnalyticsDashboardDefinition.is_published == "Yes",
    ).order_by(AnalyticsDashboardDefinition.dashboard_name.asc()).all()
    return [_serialize(db, current_user, dashboard, include_definition=False) for dashboard in dashboards
            if _my_access(db, current_user, dashboard) is not None
            and (dashboard.scope_type != "LOCATION" or get_user_report_location_codes(current_user, db) is None
                 or normalize_location_code(dashboard.location_code) in get_user_report_location_codes(current_user, db))]


@router.get("/my-dashboards/{dashboard_id}")
def get_my_dashboard(
    dashboard_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    dashboard = _get_dashboard_or_404(db, dashboard_id)
    _require_run_access(db, current_user, dashboard)
    response = _serialize(db, current_user, dashboard)
    scope = get_user_report_location_codes(current_user, db)
    available = db.query(Location).filter(Location.status == "Active").order_by(Location.location_name.asc()).all()
    response["available_locations"] = [
        {"location_code": location.location_code, "location_name": location.location_name}
        for location in available
        if scope is None or normalize_location_code(location.location_code) in scope
    ]
    return response


@router.post("/my-dashboards/{dashboard_id}/run-batch")
def run_batch(
    dashboard_id: int,
    payload: AnalyticsBatchRunRequest,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    dashboard = _get_dashboard_or_404(db, dashboard_id)
    _require_run_access(db, current_user, dashboard)
    params = _runner_params(db, current_user, dashboard, payload)
    try:
        result = run_dashboard(db, current_user, dashboard.definition_json or {}, params, payload.visual_ids)
    except ReportDefinitionError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    create_audit_log(
        db=db, module_name="Analytics", action="Run Analytics Dashboard",
        current_user=current_user, entity_type="AnalyticsDashboard", entity_id=dashboard.id,
        entity_label=dashboard.dashboard_name, remarks="Analytics dashboard visual batch run",
        request_path=f"/analytics/my-dashboards/{dashboard_id}/run-batch",
        details={"visual_ids": payload.visual_ids or [v.get("id") for v in (dashboard.definition_json or {}).get("visuals", [])]},
    )
    db.commit()
    return {"dashboard": {"id": dashboard.id, "dashboard_name": dashboard.dashboard_name, "version": dashboard.version},
            "slicer_state": payload.runtime_values, "results": result["results"], "applied_scope": {"scope_type": dashboard.scope_type, "location_code": dashboard.location_code}}


@router.post("/my-dashboards/{dashboard_id}/slicer-values")
def get_slicer_values(
    dashboard_id: int,
    payload: dict,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    dashboard = _get_dashboard_or_404(db, dashboard_id)
    _require_run_access(db, current_user, dashboard)
    slicer_key = str(payload.get("slicer_key") or "").strip()
    if not slicer_key:
        raise HTTPException(status_code=400, detail="slicer_key is required.")
    definition = dashboard.definition_json or {}
    slicers = definition.get("slicers") or []
    slicer = next((item for item in slicers if str(item.get("key")) == slicer_key), None)
    if not slicer:
        raise HTTPException(status_code=404, detail="Slicer not found.")
    column_key = str(slicer.get("column_key") or slicer.get("field") or "")
    if not column_key:
        raise HTTPException(status_code=400, detail="Slicer is not bound to a field.")

    # Build a minimal visual/query to fetch distinct values through the report engine.
    target_visual = None
    for visual in definition.get("visuals") or []:
        if slicer.get("visual_ids") and visual.get("id") not in (slicer.get("visual_ids") or []):
            continue
        if any(str(col.get("key")) == column_key for col in ((visual.get("query") or {}).get("columns") or [])):
            target_visual = visual
            break
    if target_visual is None:
        for visual in definition.get("visuals") or []:
            if not slicer.get("visual_ids") or visual.get("id") in (slicer.get("visual_ids") or []):
                target_visual = visual
                break
    if target_visual is None:
        raise HTTPException(status_code=400, detail="No visual available for this slicer.")

    query = copy.deepcopy((target_visual.get("query") or {}))
    source = query.get("source") or {}
    if source.get("kind") == "material_balance":
        raise HTTPException(status_code=400, detail="Distinct slicer values are not available for Material Balance visuals.")

    # Ensure the column exists in query; add hidden if missing.
    columns = list(query.get("columns") or [])
    col = next((c for c in columns if str(c.get("key")) == column_key), None)
    if not col:
        col = {
            "key": column_key,
            "label": slicer.get("label") or column_key,
            "kind": "data",
            "source": {"type": "column", "column": column_key},
            "data_type": str(slicer.get("data_type") or "text"),
        }
        columns.append(col)
    distinct_query = {
        "schema_version": 1,
        "report_type": "TABULAR",
        "source": source,
        "date_basis": query.get("date_basis", "ACCOUNTING_DATE"),
        "date_column": query.get("date_column"),
        "columns": [{
            "key": str(col.get("key")),
            "label": col.get("label") or col.get("key"),
            "kind": col.get("kind", "data"),
            "source": col.get("source"),
            "data_type": col.get("data_type", "text"),
            "format": col.get("format") or {"decimals": 2},
        }],
        "filters": list(query.get("filters") or []),
        "filter_logic": query.get("filter_logic", "AND"),
        "runtime_filters": [],
        "group_by": [{"key": str(col.get("key")), "bucket": "VALUE"}],
        "sort": [{"key": str(col.get("key")), "direction": "ASC"}],
        "options": {"show_totals": False, "page_size": 200},
    }

    params = {
        "date_from": payload.get("date_from"),
        "date_to": payload.get("date_to"),
        "location_codes": payload.get("location_codes") or [],
        "runtime_values": payload.get("runtime_values") or {},
        "page_size": 200,
    }
    # Parse dates if strings
    for key in ("date_from", "date_to"):
        value = params.get(key)
        if isinstance(value, str) and value.strip():
            try:
                params[key] = date.fromisoformat(value.strip())
            except ValueError:
                params[key] = None
    # Apply dashboard scope rules
    fake_req = AnalyticsBatchRunRequest(
        date_from=params.get("date_from"),
        date_to=params.get("date_to"),
        location_codes=params.get("location_codes") or [],
        runtime_values=params.get("runtime_values") or {},
    )
    params = _runner_params(db, current_user, dashboard, fake_req)
    params["page_size"] = 200

    try:
        from app.services.report_engine import run_report
        result = run_report(db, current_user, distinct_query, params)
    except ReportDefinitionError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    values = []
    seen = set()
    for row in result.get("rows") or []:
        value = row.get(column_key)
        if value is None or value == "":
            continue
        label = str(value)
        marker = label.casefold()
        if marker in seen:
            continue
        seen.add(marker)
        values.append({"value": value, "label": label})
        if len(values) >= 200:
            break
    return {"slicer_key": slicer_key, "values": values}


@router.post("/definitions/{dashboard_id}/slicer-values")
def get_definition_slicer_values(
    dashboard_id: int,
    payload: dict,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_any_user_permission(current_user, BUILDER_PERMISSIONS, db)
    dashboard = _get_dashboard_or_404(db, dashboard_id)
    _require_builder_access(db, current_user, dashboard)
    # Reuse the same logic by temporarily allowing access; simplest is to inline via calling internal logic.
    # Build on definition directly.
    definition = dashboard.definition_json or {}
    slicer_key = str(payload.get("slicer_key") or "").strip()
    slicer = next((item for item in (definition.get("slicers") or []) if str(item.get("key")) == slicer_key), None)
    if not slicer:
        raise HTTPException(status_code=404, detail="Slicer not found.")
    column_key = str(slicer.get("column_key") or slicer.get("field") or "")
    target_visual = None
    for visual in definition.get("visuals") or []:
        if slicer.get("visual_ids") and visual.get("id") not in (slicer.get("visual_ids") or []):
            continue
        if any(str(col.get("key")) == column_key for col in ((visual.get("query") or {}).get("columns") or [])):
            target_visual = visual
            break
    if target_visual is None:
        target_visual = next((v for v in (definition.get("visuals") or []) if not slicer.get("visual_ids") or v.get("id") in (slicer.get("visual_ids") or [])), None)
    if target_visual is None:
        raise HTTPException(status_code=400, detail="No visual available for this slicer.")
    query = copy.deepcopy((target_visual.get("query") or {}))
    source = query.get("source") or {}
    if source.get("kind") == "material_balance":
        return {"slicer_key": slicer_key, "values": []}
    columns = list(query.get("columns") or [])
    col = next((c for c in columns if str(c.get("key")) == column_key), None)
    if not col:
        col = {"key": column_key, "label": slicer.get("label") or column_key, "kind": "data", "source": {"type": "column", "column": column_key}, "data_type": str(slicer.get("data_type") or "text")}
    distinct_query = {
        "schema_version": 1, "report_type": "TABULAR", "source": source,
        "date_basis": query.get("date_basis", "ACCOUNTING_DATE"), "date_column": query.get("date_column"),
        "columns": [{"key": str(col.get("key")), "label": col.get("label") or col.get("key"), "kind": col.get("kind", "data"), "source": col.get("source"), "data_type": col.get("data_type", "text"), "format": col.get("format") or {"decimals": 2}}],
        "filters": list(query.get("filters") or []), "filter_logic": query.get("filter_logic", "AND"),
        "runtime_filters": [], "group_by": [{"key": str(col.get("key")), "bucket": "VALUE"}],
        "sort": [{"key": str(col.get("key")), "direction": "ASC"}], "options": {"show_totals": False, "page_size": 200},
    }
    params = {"date_from": payload.get("date_from"), "date_to": payload.get("date_to"), "location_codes": payload.get("location_codes") or [], "runtime_values": payload.get("runtime_values") or {}, "page_size": 200}
    for key in ("date_from", "date_to"):
        value = params.get(key)
        if isinstance(value, str) and value.strip():
            try: params[key] = date.fromisoformat(value.strip())
            except ValueError: params[key] = None
    scope = get_user_report_location_codes(current_user, db)
    requested = params.get("location_codes") or []
    if scope is not None:
        requested = [c for c in requested if normalize_location_code(c) in scope] or sorted(scope)
        params["location_codes"] = requested
    try:
        from app.services.report_engine import run_report
        result = run_report(db, current_user, distinct_query, params)
    except ReportDefinitionError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    values = []
    seen = set()
    for row in result.get("rows") or []:
        value = row.get(column_key)
        if value is None or value == "":
            continue
        marker = str(value).casefold()
        if marker in seen:
            continue
        seen.add(marker)
        values.append({"value": value, "label": str(value)})
        if len(values) >= 200:
            break
    return {"slicer_key": slicer_key, "values": values}


@router.post("/my-dashboards/{dashboard_id}/visual/{visual_id}/export")
def export_visual(
    dashboard_id: int,
    visual_id: str,
    payload: AnalyticsBatchRunRequest,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Export Analytics Dashboard", db)
    dashboard = _get_dashboard_or_404(db, dashboard_id)
    _require_run_access(db, current_user, dashboard)
    visual = next((item for item in (dashboard.definition_json or {}).get("visuals", []) if item.get("id") == visual_id), None)
    if not visual:
        raise HTTPException(status_code=404, detail="Dashboard visual not found")
    params = _runner_params(db, current_user, dashboard, payload)
    params["for_export"] = True
    try:
        result = run_visual(db, current_user, visual, dashboard.definition_json or {}, params)
    except ReportDefinitionError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    fmt = str(payload.format or "xlsx").lower()
    if fmt not in {"xlsx", "csv"}:
        raise HTTPException(status_code=400, detail="Export format must be xlsx or csv.")
    content = export_csv_bytes(result) if fmt == "csv" else export_xlsx_bytes(result, visual.get("title") or dashboard.dashboard_name)
    filename = re.sub(r"[^A-Za-z0-9_-]+", "_", f"{dashboard.dashboard_name}_{visual.get('title') or visual_id}").strip("_") or "analytics"
    _audit(db, current_user, "Export Analytics Visual", dashboard, {"visual_id": visual_id, "format": fmt})
    db.commit()
    media = "text/csv" if fmt == "csv" else "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    ext = fmt
    return StreamingResponse(iter([content]), media_type=media, headers={"Content-Disposition": f'attachment; filename="{filename}.{ext}"'})


@router.post("/definitions/{dashboard_id}/duplicate")
def duplicate_definition(
    dashboard_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Create Analytics Definition", db)
    source = _get_dashboard_or_404(db, dashboard_id)
    _require_builder_access(db, current_user, source, "VIEW")
    scope_type = source.scope_type
    location_code = source.location_code
    if scope_type == "GLOBAL" and not is_admin_user(current_user, db):
        scope = get_user_report_location_codes(current_user, db)
        if scope:
            scope_type = "LOCATION"
            location_code = sorted(scope)[0].upper()
    base_name = f"{source.dashboard_name} (Copy)"[:185]
    candidate_name = base_name
    suffix = 2
    while True:
        try:
            _ensure_unique_name(db, candidate_name, scope_type, location_code)
            break
        except HTTPException:
            candidate_name = f"{base_name} {suffix}"
            suffix += 1
    normalized = validate_analytics_definition(copy.deepcopy(source.definition_json or {}))
    clone = AnalyticsDashboardDefinition(
        dashboard_code=_slug_code(db, candidate_name),
        dashboard_name=candidate_name,
        description=source.description,
        scope_type=scope_type,
        location_code=location_code,
        definition_json=normalized,
        visibility="PRIVATE",
        is_published="No",
        status="Active",
        version=1,
        owner_user_id=current_user.id,
        created_by=get_current_user_display_name(current_user),
        updated_by=get_current_user_display_name(current_user),
    )
    db.add(clone)
    db.flush()
    default_grants = [{"grant_type": "LOCATION", "user_id": None, "role_id": None, "location_code": location_code, "access_level": "VIEW"}] if location_code else []
    _replace_grants(db, current_user, clone.id, default_grants)
    _save_version(db, current_user, clone, f"Duplicated from #{source.id}")
    _audit(db, current_user, "Duplicate Analytics Dashboard", clone, {"source_dashboard_id": source.id})
    db.commit()
    db.refresh(clone)
    return _serialize(db, current_user, clone)


@router.post("/definitions/{dashboard_id}/revert")
def revert_definition(
    dashboard_id: int,
    payload: dict,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Edit Analytics Definition", db)
    dashboard = _get_dashboard_or_404(db, dashboard_id)
    _require_builder_access(db, current_user, dashboard, "EDIT")
    version_id = payload.get("version_id")
    version_number = payload.get("version_number")
    query = db.query(AnalyticsDashboardVersion).filter(AnalyticsDashboardVersion.dashboard_id == dashboard_id)
    if version_id is not None:
        target = query.filter(AnalyticsDashboardVersion.id == int(version_id)).first()
    elif version_number is not None:
        target = query.filter(AnalyticsDashboardVersion.version_number == int(version_number)).first()
    else:
        raise HTTPException(status_code=400, detail="Choose a version to restore.")
    if not target:
        raise HTTPException(status_code=404, detail="Dashboard version snapshot not found.")
    try:
        restored = validate_analytics_definition(copy.deepcopy(target.definition_json or {}))
    except ReportDefinitionError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    dashboard.definition_json = restored
    dashboard.version += 1
    dashboard.updated_at = datetime.now()
    dashboard.updated_by = get_current_user_display_name(current_user)
    _save_version(db, current_user, dashboard, f"Restored from version {target.version_number}")
    _audit(db, current_user, "Revert Analytics Dashboard", dashboard, {"restored_version": target.version_number})
    db.commit()
    db.refresh(dashboard)
    return _serialize(db, current_user, dashboard)


@router.post("/my-dashboards/{dashboard_id}/visual/{visual_id}/records")
def get_visual_underlying_records(
    dashboard_id: int,
    visual_id: str,
    payload: AnalyticsBatchRunRequest,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    dashboard = _get_dashboard_or_404(db, dashboard_id)
    _require_run_access(db, current_user, dashboard)
    visual = next((item for item in (dashboard.definition_json or {}).get("visuals", []) if item.get("id") == visual_id), None)
    if not visual:
        raise HTTPException(status_code=404, detail="Dashboard visual not found")
    params = _runner_params(db, current_user, dashboard, payload)
    try:
        result = run_visual_records(db, current_user, visual, dashboard.definition_json or {}, params)
    except ReportDefinitionError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    _audit(db, current_user, "Inspect Analytics Visual Records", dashboard, {"visual_id": visual_id})
    db.commit()
    return result


@router.post("/my-dashboards/{dashboard_id}/export-workbook")
def export_dashboard_workbook(
    dashboard_id: int,
    payload: AnalyticsBatchRunRequest,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Export Analytics Dashboard", db)
    dashboard = _get_dashboard_or_404(db, dashboard_id)
    _require_run_access(db, current_user, dashboard)
    params = _runner_params(db, current_user, dashboard, payload)
    params["for_export"] = True
    definition = dashboard.definition_json or {}
    try:
        batch = run_dashboard(db, current_user, definition, params)
    except ReportDefinitionError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    content = export_dashboard_workbook_bytes(batch.get("results") or {}, definition.get("visuals") or [], dashboard.dashboard_name)
    filename = re.sub(r"[^A-Za-z0-9_-]+", "_", f"{dashboard.dashboard_name}_Workbook").strip("_") or "analytics_dashboard"
    _audit(db, current_user, "Export Analytics Dashboard Workbook", dashboard, {"format": "xlsx"})
    db.commit()
    return StreamingResponse(
        iter([content]),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}.xlsx"'},
    )
