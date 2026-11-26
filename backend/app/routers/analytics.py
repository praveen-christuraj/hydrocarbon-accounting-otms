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
    Asset,
    AssetType,
    Location,
    OperationTemplate,
    OperationTransaction,
    OperationType,
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
    TRACKING_STATUS_KINDS,
    _TANK_SNAPSHOT_COLS,
    _TRACKING_STATUS_COLS,
    _is_tank_snapshot_visual,
    _resolve_missing_slicer_column,
    _run_tank_snapshot_visual,
    _run_tracking_status_visual,
    export_dashboard_workbook_bytes,
    run_dashboard,
    run_preview_records,
    run_visual,
    run_visual_records,
    validate_analytics_definition,
    visual_execution_params,
)
from app.services.audit_service import create_audit_log
from app.services.report_catalog import (
    LEDGER_VIRTUAL_FIELDS,
    TICKET_VIRTUAL_FIELDS,
    allowed_columns as catalog_allowed_columns,
    build_catalog,
    discover_json_paths,
    discover_operation_fields,
    sample_json_values,
)
from app.services.report_engine import DATE_BASES, export_csv_bytes, export_xlsx_bytes
from app.services.report_formula import FUNCTION_HELP, OPERATOR_HELP, validate_formula
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
        # "ALL" = the caller deliberately asked for the whole reporting scope.
        # Never converted into a location list here; consumers treat an empty
        # location_codes + ALL as "no location filter".
        "scope_mode": str(getattr(request, "scope_mode", "SELECTED") or "SELECTED").upper(),
        # What the caller asked for, before scope clamping — lets the UI label
        # "All Locations in Your Scope" instead of listing every granted code.
        "requested_location_count": len([c for c in (request.location_codes or []) if str(c or "").strip()]),
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
    # Studio parity with Report Builder: the same formula/operator/date-basis
    # help text, so the Studio never has to hard-code (and drift from) the engine.
    catalog["formula_help"] = FUNCTION_HELP
    catalog["operator_help"] = OPERATOR_HELP
    catalog["date_bases"] = [
        {"value": "ACCOUNTING_DATE", "label": "Accounting Date (location accounting day)", "help": "Recommended for stock accounting. Uses the ticket's own date/time with the Location Accounting Day Setting."},
        {"value": "PAYLOAD_OPERATION_DATE", "label": "Operation / Gauging Date (from ticket answers)", "help": "The date typed inside the ticket, without the accounting-day shift."},
        {"value": "OPERATION_DATE", "label": "Operation Date (ticket header)", "help": "The header operation date stored on the ticket."},
        {"value": "CREATED_AT", "label": "Created Date", "help": "When the record was created in the system."},
        {"value": "COLUMN", "label": "A date column I choose", "help": "Pick any date column of the selected table."},
        {"value": "NONE", "label": "No date filtering", "help": "For master-data style visuals."},
    ]
    catalog["date_basis_values"] = sorted(DATE_BASES)
    # Table-backed datasets expose the same payload/JSON split support the Report
    # Builder advertises (build_catalog already lists virtual_fields for them);
    # the Studio only needs to know which JSON column to sample.
    for dataset in catalog.get("datasets", []):
        kind = str(dataset.get("kind") or "")
        if kind == "operation_tickets":
            dataset["virtual_fields"] = TICKET_VIRTUAL_FIELDS
            dataset["supports_payload_json"] = True
            dataset["payload_source"] = {"field_code": "tank_gauging_payload"}
        elif kind == "tank_stock_ledger":
            dataset["virtual_fields"] = LEDGER_VIRTUAL_FIELDS
            dataset["supports_payload_json"] = True
            dataset.update({
                "payload_source": {
                    "json_column": "source_payload",
                    "label": "Ticket answers stored with the ledger row",
                },
            })
    catalog["datasets"].append({
        "id": "tank_snapshot",
        "kind": "tank_snapshot",
        "name": "Shore Tank Capacity & Stock Snapshot — live ledger + calibration",
        "description": "Live closing stock, active strapping capacity, ullage and fill % across active shore tanks in scope.",
        "icon": "droplet",
        "columns": [
            {"column": "tank_asset_code", "label": "Tank Code", "data_type": "text"},
            {"column": "tank_asset_name", "label": "Tank Name", "data_type": "text"},
            {"column": "asset_type_code", "label": "Asset Type", "data_type": "text"},
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
    catalog["datasets"].append({
        "id": "tracking_status",
        "kind": "tracking_status",
        "name": "Vessel & Barge Tracking Status — live movement status",
        "description": "Live tracking status for barge, shuttle, FSO and tanker movements across locations, including current loaded/unloaded/in-transit status, last event, voyage state and ticket reference.",
        "icon": "mapPin",
        "columns": [
            {"column": "tracking_module", "label": "Tracking Module", "data_type": "text"},
            {"column": "tracking_ref", "label": "Tracking Ref / Convoy", "data_type": "text"},
            {"column": "asset_code", "label": "Asset Code", "data_type": "text"},
            {"column": "asset_name", "label": "Asset Name", "data_type": "text"},
            {"column": "location_code", "label": "Location", "data_type": "text", "is_location": True},
            {"column": "from_location_code", "label": "From Location", "data_type": "text", "is_location": True},
            {"column": "to_location_code", "label": "To Location", "data_type": "text", "is_location": True},
            {"column": "current_status", "label": "Current Status", "data_type": "text"},
            {"column": "voyage_status", "label": "Voyage Status", "data_type": "text"},
            {"column": "last_event_type", "label": "Last Event Type", "data_type": "text"},
            {"column": "last_event_at", "label": "Last Event Date/Time", "data_type": "datetime", "is_date": True},
            {"column": "ticket_number", "label": "Last Ticket Number", "data_type": "text"},
            {"column": "product_name", "label": "Product", "data_type": "text"},
            {"column": "quantity_gsv_bbl", "label": "Last Qty GSV (BBL)", "data_type": "number"},
            {"column": "quantity_nsv_bbl", "label": "Last Qty NSV (BBL)", "data_type": "number"},
            {"column": "movement_count", "label": "Movements", "data_type": "number"},
            {"column": "remarks", "label": "Remarks / Status Detail", "data_type": "text"},
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
    asset_types = db.query(AssetType).filter(AssetType.status == "Active").order_by(AssetType.asset_type_name.asc()).all()
    # Same picker data the Report Builder offers (source restrictions, slicer
    # values, "split JSON" source lists) so Studio can match its feature set.
    statuses = [row[0] for row in db.query(OperationTransaction.status).distinct().all() if row[0]]
    for standard in ("Draft", "Submitted", "Approved", "Rejected", "Cancelled"):
        if standard not in statuses:
            statuses.append(standard)
    return {
        "users": [{"id": u.id, "username": u.username, "full_name": u.full_name} for u in users],
        "roles": [{"id": r.id, "role_name": r.role_name} for r in roles],
        "locations": [
            {"location_code": loc.location_code, "location_name": loc.location_name}
            for loc in locations
            if visible_scope is None or normalize_location_code(loc.location_code) in visible_scope
        ],
        "asset_types": [
            {"asset_type_code": at.asset_type_code, "asset_type_name": at.asset_type_name}
            for at in asset_types
        ],
        "operation_types": [
            {
                "operation_type_code": row.operation_type_code,
                "operation_type_name": row.operation_type_name,
                "operation_category": row.operation_category,
                "applicable_asset_type_code": row.applicable_asset_type_code,
            }
            for row in db.query(OperationType).filter(OperationType.status == "Active").order_by(OperationType.operation_type_name).all()
        ],
        "templates": [
            {
                "id": row.id,
                "template_name": row.template_name,
                "operation_type_code": row.operation_type_code,
                "entry_layout_type": row.entry_layout_type,
            }
            for row in db.query(OperationTemplate).filter(OperationTemplate.status == "Active").order_by(OperationTemplate.template_name).all()
        ],
        "statuses": sorted(statuses),
        "products": [
            row[0] for row in db.query(OperationTransaction.product_name).distinct().limit(200).all() if row[0]
        ],
        "assets": [
            {
                "asset_code": row.asset_code,
                "asset_name": row.asset_name,
                "asset_type_code": row.asset_type_code,
                "location_code": row.location_code,
            }
            for row in db.query(Asset)
            .filter(Asset.status == "Active")
            .order_by(Asset.asset_code)
            .limit(2000)
            .all()
            if visible_scope is None
            or row.location_code is None
            or normalize_location_code(row.location_code) in visible_scope
        ],
    }


@router.get("/operation-fields")
def get_analytics_operation_fields(
    operation_type_codes: str = "",
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    """Template fields + saved ticket answer fields, for the Studio field explorer."""
    require_any_user_permission(current_user, BUILDER_PERMISSIONS, db)
    codes = [code.strip() for code in (operation_type_codes or "").split(",") if code.strip()]
    return discover_operation_fields(db, codes or None)


@router.post("/json-paths")
def post_analytics_json_paths(
    payload: dict,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    """List every pickable path inside a sampled payload/JSON column.

    Mirrors ``POST /report-builder/json-paths`` (same discovery helper) so a
    payload column picked in Studio resolves and runs identically.
    """
    require_any_user_permission(current_user, BUILDER_PERMISSIONS, db)
    source_kind = str(payload.get("source_kind") or "operation_tickets").strip()
    if source_kind not in {"operation_tickets", "tank_stock_ledger", "table"}:
        raise HTTPException(status_code=400, detail="Choose a data source to read the payload from.")
    field_code = str(payload.get("field_code") or "").strip()
    json_column = str(payload.get("json_column") or "").strip()
    table = str(payload.get("table") or "").strip()
    if source_kind == "operation_tickets" and not field_code:
        raise HTTPException(status_code=400, detail="Choose which saved payload / answer to split into columns.")
    if source_kind != "operation_tickets":
        table_name = "tank_stock_ledger" if source_kind == "tank_stock_ledger" else table
        columns_meta = catalog_allowed_columns(table_name)
        if json_column not in columns_meta or not columns_meta[json_column].get("is_json"):
            raise HTTPException(status_code=400, detail="Choose a JSON column to split into columns.")
    try:
        sample_size = max(1, min(200, int(payload.get("sample_size") or 100)))
    except (TypeError, ValueError):
        sample_size = 100
    scope = get_user_report_location_codes(current_user, db)
    codes = payload.get("operation_type_codes")
    values = sample_json_values(
        db,
        source_kind=source_kind,
        scope=scope,
        table=table or None,
        json_column=json_column or None,
        field_code=field_code or None,
        operation_type_codes=[str(code) for code in (codes if isinstance(codes, list) else []) if str(code or "").strip()],
        sample_size=sample_size,
    )
    result = discover_json_paths(values, len(values))
    result["source_kind"] = source_kind
    result["field_code"] = field_code or None
    result["json_column"] = json_column or None
    result["table"] = table or None
    return result


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
    # "ALL" is an explicit "whole reporting scope" request from the Studio, as
    # opposed to an empty list that an older client may have sent by accident.
    params["scope_mode"] = "ALL" if str(params.get("scope_mode") or "").upper() == "ALL" else "SELECTED"
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
        normalized = validate_analytics_definition(definition, strict_visuals=False)
        if scope is not None:
            for visual in normalized.get("visuals", []):
                source = ((visual.get("query") or {}).get("source") or {})
                source_location = source.get("location_code") if source.get("kind") in {"material_balance", "tank_snapshot"} else None
                if source_location and normalize_location_code(source_location) not in scope:
                    raise HTTPException(status_code=403, detail="The selected visual location is outside your reporting scope.")
        result = run_dashboard(
            db,
            current_user,
            normalized,
            params,
            payload.get("visual_ids"),
            isolate_errors=True,
        )
    except ReportDefinitionError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return result


@router.post("/run-preview/visual/{visual_id}/records")
def run_preview_visual_records(
    visual_id: str,
    payload: dict,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    """Drill-through for an unsaved Studio preview (same rows as the Viewer)."""
    require_any_user_permission(current_user, BUILDER_PERMISSIONS, db)
    definition = payload.get("definition") or {}
    params = dict(payload.get("params") or {})
    scope = get_user_report_location_codes(current_user, db)
    requested_locations = params.get("location_codes") or []
    if isinstance(requested_locations, str):
        requested_locations = [requested_locations]
    params["scope_mode"] = "ALL" if str(params.get("scope_mode") or "").upper() == "ALL" else "SELECTED"
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
        return run_preview_records(db, current_user, definition, visual_id, params)
    except ReportDefinitionError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


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


def _resolve_slicer_values(
    db: Session,
    current_user: User,
    dashboard: AnalyticsDashboardDefinition,
    payload: dict,
    use_runner_scope: bool,
) -> dict:
    slicer_key = str(payload.get("slicer_key") or payload.get("slicer_id") or "").strip()
    inline_slicer = payload.get("slicer") if isinstance(payload.get("slicer"), dict) else None
    if not slicer_key and inline_slicer:
        slicer_key = str(inline_slicer.get("key") or inline_slicer.get("id") or "").strip()
    if not slicer_key:
        raise HTTPException(status_code=400, detail="slicer_key is required.")
    definition = (
        payload.get("definition")
        if (not use_runner_scope and isinstance(payload.get("definition"), dict))
        else (dashboard.definition_json or {})
    )
    slicers = definition.get("slicers") or []
    slicer = next(
        (item for item in slicers if str(item.get("key")) == slicer_key or str(item.get("id")) == slicer_key),
        None,
    )
    if not slicer and inline_slicer and not use_runner_scope:
        slicer = inline_slicer
    if not slicer:
        raise HTTPException(status_code=404, detail="Slicer not found.")
    canonical_key = str(slicer.get("key") or slicer.get("id") or slicer_key)
    column_key = str(slicer.get("column_key") or slicer.get("field") or "")
    if not column_key:
        raise HTTPException(status_code=400, detail="Slicer is not bound to a field.")

    targeted_visuals = [
        visual for visual in (definition.get("visuals") or [])
        if str(visual.get("type") or "").upper() != "TEXT"
        and (not slicer.get("visual_ids") or visual.get("id") in (slicer.get("visual_ids") or []))
    ]
    # Prefer standard report_engine visuals that explicitly expose the bound column
    def _is_standard(v):
        kind = (((v.get("query") or {}).get("source") or {}).get("kind") or "")
        return kind not in {"material_balance", "tank_snapshot"} | TRACKING_STATUS_KINDS and not _is_tank_snapshot_visual(v)

    target_visual = next(
        (v for v in targeted_visuals if _is_standard(v) and any(str(c.get("key")) == column_key for c in ((v.get("query") or {}).get("columns") or []))),
        None,
    )
    if target_visual is None and column_key in _TANK_SNAPSHOT_COLS:
        target_visual = next((v for v in targeted_visuals if _is_tank_snapshot_visual(v)), None)
    if target_visual is None and column_key in _TRACKING_STATUS_COLS:
        target_visual = next((v for v in targeted_visuals if (((v.get("query") or {}).get("source") or {}).get("kind") or "") in TRACKING_STATUS_KINDS), None)
    if target_visual is None:
        target_visual = next((v for v in targeted_visuals if _is_standard(v)), None)
    if target_visual is None:
        target_visual = targeted_visuals[0] if targeted_visuals else None
    if target_visual is None:
        raise HTTPException(status_code=400, detail="No visual available for this slicer.")

    query = copy.deepcopy((target_visual.get("query") or {}))
    source = query.get("source") or {}
    if source.get("kind") == "material_balance":
        return {"slicer_key": canonical_key, "values": []}

    parsed_dates: dict[str, date | None] = {}
    for key in ("date_from", "date_to"):
        value = payload.get(key)
        if isinstance(value, date):
            parsed_dates[key] = value
        elif isinstance(value, str) and value.strip():
            try:
                parsed_dates[key] = date.fromisoformat(value.strip())
            except ValueError:
                parsed_dates[key] = None
        else:
            parsed_dates[key] = None

    if use_runner_scope:
        fake_req = AnalyticsBatchRunRequest(
            date_from=parsed_dates["date_from"],
            date_to=parsed_dates["date_to"],
            location_codes=payload.get("location_codes") or [],
            runtime_values=payload.get("runtime_values") or {},
        )
        params = _runner_params(db, current_user, dashboard, fake_req)
    else:
        params = {
            "date_from": parsed_dates["date_from"],
            "date_to": parsed_dates["date_to"],
            "location_codes": list(payload.get("location_codes") or []),
            "runtime_values": dict(payload.get("runtime_values") or {}),
            # Mirrors _runner_params: an explicit ALL means "whole scope", so the
            # option list is built from every scope location rather than none.
            "scope_mode": "ALL" if str(payload.get("scope_mode") or "").upper() == "ALL" else "SELECTED",
        }
        scope = get_user_report_location_codes(current_user, db)
        if scope is not None:
            requested = [c for c in params["location_codes"] if normalize_location_code(c) in scope] or sorted(scope)
            params["location_codes"] = requested
    params["page_size"] = 200

    if _is_tank_snapshot_visual(target_visual):
        result = _run_tank_snapshot_visual(db, current_user, target_visual, params)
    elif source.get("kind") in TRACKING_STATUS_KINDS:
        result = _run_tracking_status_visual(db, current_user, target_visual, params)
    else:
        columns = list(query.get("columns") or [])
        col = next((c for c in columns if str(c.get("key")) == column_key), None)
        if not col:
            source_kind = str(source.get("kind") or "operation_tickets")
            table_name = source.get("table") if source_kind == "table" else ("operation_transactions" if source_kind == "operation_tickets" else ("tank_stock_ledger" if source_kind == "tank_stock_ledger" else None))
            table_cols = catalog_allowed_columns(table_name) if table_name else {}
            virtuals = {f["field"]: f for f in (TICKET_VIRTUAL_FIELDS if source_kind == "operation_tickets" else (LEDGER_VIRTUAL_FIELDS if source_kind == "tank_stock_ledger" else []))}
            if column_key in virtuals:
                meta = virtuals[column_key]
                col = {"key": column_key, "label": slicer.get("label") or meta.get("label") or column_key, "kind": "data", "source": {"type": "virtual", "field": column_key}, "data_type": meta.get("data_type", "text")}
            else:
                meta = table_cols.get(column_key) or {}
                col = {"key": column_key, "label": slicer.get("label") or meta.get("label") or column_key, "kind": "data", "source": {"type": "column", "column": column_key}, "data_type": meta.get("data_type") or str(slicer.get("data_type") or "text")}
        primary_key = str(col.get("key"))
        distinct_columns = [{
            "key": primary_key,
            "label": col.get("label") or primary_key,
            "kind": col.get("kind", "data"),
            "source": col.get("source"),
            "data_type": col.get("data_type", "text"),
            "format": col.get("format") or {"decimals": 2},
        }]
        distinct_keys = {primary_key}
        distinct_filters = copy.deepcopy(list(query.get("filters") or []))
        probe_query = {"source": source, "group_by": [{"key": primary_key, "bucket": "VALUE"}]}
        for flt in distinct_filters:
            if not isinstance(flt, dict) or not flt.get("column_key"):
                continue
            fkey = str(flt["column_key"])
            if fkey in distinct_keys:
                continue
            existing = next((c for c in columns if isinstance(c, dict) and str(c.get("key")) == fkey), None)
            if existing:
                cloned_col = copy.deepcopy(existing)
                cloned_col["hidden"] = True
                cloned_col["aggregate"] = cloned_col.get("aggregate") or "FIRST"
                distinct_columns.append(cloned_col)
                distinct_keys.add(fkey)
            else:
                injected = _resolve_missing_slicer_column(probe_query, fkey, {"label": fkey}, allow_ticket_field=True)
                if injected and injected.get("key") not in distinct_keys:
                    distinct_columns.append(injected)
                    distinct_keys.add(str(injected["key"]))
                    flt["column_key"] = str(injected["key"])
        distinct_query = {
            "schema_version": 1,
            "report_type": "TABULAR",
            "source": source,
            "date_basis": query.get("date_basis", "ACCOUNTING_DATE"),
            "date_column": query.get("date_column"),
            "columns": distinct_columns,
            "filters": distinct_filters,
            "filter_logic": query.get("filter_logic", "AND"),
            "runtime_filters": [],
            "group_by": [{"key": primary_key, "bucket": "VALUE"}],
            "sort": [{"key": primary_key, "direction": "ASC"}],
            "options": {"show_totals": False, "page_size": 200},
        }
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
    values.sort(key=lambda item: item["label"].casefold())
    return {"slicer_key": canonical_key, "values": values}


@router.post("/my-dashboards/{dashboard_id}/slicer-values")
def get_slicer_values(
    dashboard_id: int,
    payload: dict,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    dashboard = _get_dashboard_or_404(db, dashboard_id)
    _require_run_access(db, current_user, dashboard)
    return _resolve_slicer_values(db, current_user, dashboard, payload, use_runner_scope=True)


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
    return _resolve_slicer_values(db, current_user, dashboard, payload, use_runner_scope=False)


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
    definition = dashboard.definition_json or {}
    try:
        # Match the batch/records paths: normalise the definition before
        # selecting the visual so an older or partially saved definition
        # exports the same rows the dashboard displays.
        normalized = validate_analytics_definition(definition, strict_visuals=False)
    except ReportDefinitionError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    visual = next((item for item in normalized.get("visuals", []) if item.get("id") == visual_id), None)
    if not visual:
        raise HTTPException(status_code=404, detail="Dashboard visual not found")
    params = _runner_params(db, current_user, dashboard, payload)
    params["for_export"] = True
    try:
        result = run_visual(db, current_user, visual, normalized, params)
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
    definition = dashboard.definition_json or {}
    params = _runner_params(db, current_user, dashboard, payload)
    try:
        # Match the dashboard batch path: normalise the definition first so
        # legacy or partially saved visuals execute with the same shape.
        normalized = validate_analytics_definition(definition, strict_visuals=False)
        visual = next((item for item in normalized.get("visuals", []) if item.get("id") == visual_id), None)
        if not visual:
            raise HTTPException(status_code=404, detail="Dashboard visual not found")
        result = run_visual_records(db, current_user, visual, normalized, params)
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
