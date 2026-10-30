"""Report Builder API (Configurations) + Custom Reports runtime (Reporting).

Design-time endpoints require the Report Builder RBAC permissions; run-time
endpoints require the Reporting permissions *and* the per-report access
grants chosen when the report was created (specific users, roles or
locations).  Data is always additionally restricted to the runner's own
location scope inside the engine.
"""

from __future__ import annotations

import copy
import re
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.database import Base, get_db
from app.dependencies.auth import get_current_user_from_token
from app.dependencies.permissions import (
    get_user_location_codes,
    get_user_role_ids,
    is_admin_user,
    normalize_location_code,
    require_any_user_permission,
    require_user_permission,
    user_has_permission,
)
from app.models import (
    Asset,
    Location,
    OperationTemplate,
    OperationTransaction,
    OperationTransactionValue,
    OperationType,
    ReportAccessGrant,
    ReportDefinition,
    ReportDefinitionVersion,
    Role,
    User,
)
from app.schemas import (
    FormulaValidateRequest,
    JsonPathsRequest,
    ReportDefinitionCreate,
    ReportDefinitionResponse,
    ReportDefinitionSummary,
    ReportDefinitionUpdate,
    ReportExportRequest,
    ReportFromStarterRequest,
    ReportPreviewRequest,
    ReportRunRequest,
)
from app.services.audit_service import create_audit_log
from app.services.report_catalog import (
    allowed_columns,
    build_catalog,
    discover_json_paths,
    discover_operation_fields,
    humanize,
)
from app.services.report_engine import (
    ReportDefinitionError,
    export_csv_bytes,
    export_xlsx_bytes,
    public_definition,
    run_report,
    starter_templates,
    validate_definition,
)
from app.services.report_formula import FUNCTION_HELP, OPERATOR_HELP, validate_formula
from app.utils.helpers import get_current_user_display_name

router = APIRouter(prefix="/report-builder", tags=["Report Builder"])

BUILDER_ANY = ["View Report Definition", "Create Report Definition", "Edit Report Definition"]


# ---------------------------------------------------------------------------
# Access helpers
# ---------------------------------------------------------------------------

def _grants_of(db: Session, report_id: int) -> list[ReportAccessGrant]:
    return (
        db.query(ReportAccessGrant)
        .filter(ReportAccessGrant.report_id == report_id)
        .order_by(ReportAccessGrant.grant_type, ReportAccessGrant.id)
        .all()
    )


def _my_access(db: Session, user: User, report: ReportDefinition, grants: list[ReportAccessGrant], *, for_run: bool) -> str | None:
    if is_admin_user(user, db):
        return "OWNER"
    if report.owner_user_id == user.id:
        return "OWNER"
    role_ids = get_user_role_ids(db, user)
    scope = get_user_location_codes(user, db)
    best = None
    for grant in grants:
        matched = False
        if grant.grant_type == "USER" and grant.user_id == user.id:
            matched = True
        elif grant.grant_type == "ROLE" and grant.role_id in role_ids:
            matched = True
        elif grant.grant_type == "LOCATION":
            code = normalize_location_code(grant.location_code)
            matched = scope is None or (code is not None and code in scope)
        if matched:
            if grant.access_level == "EDIT":
                return "EDIT"
            best = "VIEW"
    if best:
        return best
    if for_run and (report.visibility or "PRIVATE") == "INTERNAL":
        return "VIEW"
    return None


def _get_report_or_404(db: Session, report_id: int) -> ReportDefinition:
    report = db.query(ReportDefinition).filter(ReportDefinition.id == report_id).first()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    return report


def _require_builder_access(db, user, report, minimum: str = "VIEW") -> str:
    access = _my_access(db, user, report, _grants_of(db, report.id), for_run=False)
    rank = {"VIEW": 1, "EDIT": 2, "OWNER": 3}
    if access is None or rank[access] < rank[minimum]:
        raise HTTPException(status_code=404, detail="Report not found")
    return access


def _require_run_access(db, user, report) -> str:
    if report.status != "Active":
        raise HTTPException(status_code=404, detail="Report not found")
    access = _my_access(db, user, report, _grants_of(db, report.id), for_run=True)
    published = (report.is_published or "No") == "Yes"
    if access is None:
        raise HTTPException(status_code=404, detail="Report not found")
    if not published and access == "VIEW":
        raise HTTPException(status_code=404, detail="Report not found")
    return access


def _slug_code(db: Session, report_name: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", str(report_name or "report").casefold()).strip("-")[:80] or "report"
    candidate = base
    suffix = 2
    while db.query(ReportDefinition).filter(ReportDefinition.report_code == candidate).first():
        candidate = f"{base}-{suffix}"
        suffix += 1
    return candidate


def _validate_grants(db: Session, user: User, grants_in) -> list[dict]:
    cleaned: list[dict] = []
    seen: set[tuple] = set()
    scope = get_user_location_codes(user, db)
    admin = is_admin_user(user, db)
    for grant in grants_in or []:
        grant_type = str(grant.grant_type or "").upper()
        level = str(grant.access_level or "VIEW").upper()
        if grant_type not in ("USER", "ROLE", "LOCATION"):
            raise HTTPException(status_code=400, detail="Access can be given to a User, a Role or a Location.")
        if level not in ("VIEW", "EDIT"):
            raise HTTPException(status_code=400, detail="Access level must be View or Edit.")
        row = {"grant_type": grant_type, "user_id": None, "role_id": None, "location_code": None, "access_level": level}
        if grant_type == "USER":
            target = db.query(User).filter(User.id == grant.user_id).first()
            if not target:
                raise HTTPException(status_code=400, detail="One of the selected users no longer exists.")
            row["user_id"] = target.id
            marker = ("USER", target.id, level)
        elif grant_type == "ROLE":
            target = db.query(Role).filter(Role.id == grant.role_id).first()
            if not target:
                raise HTTPException(status_code=400, detail="One of the selected roles no longer exists.")
            row["role_id"] = target.id
            marker = ("ROLE", target.id, level)
        else:
            if level == "EDIT":
                raise HTTPException(status_code=400, detail="A Location can be given View access only. Give Edit access to named users or roles.")
            target = (
                db.query(Location)
                .filter(func.upper(Location.location_code) == str(grant.location_code or "").strip().upper())
                .first()
            )
            if not target:
                raise HTTPException(status_code=400, detail="One of the selected locations no longer exists.")
            if not admin and scope is not None and normalize_location_code(target.location_code) not in scope:
                raise HTTPException(status_code=403, detail="You cannot give access for a location outside your own location scope.")
            row["location_code"] = target.location_code
            marker = ("LOCATION", target.location_code, level)
        if marker in seen:
            continue
        seen.add(marker)
        cleaned.append(row)
    return cleaned


def _replace_grants(db: Session, user: User, report_id: int, cleaned: list[dict]):
    db.query(ReportAccessGrant).filter(ReportAccessGrant.report_id == report_id).delete(synchronize_session=False)
    display = get_current_user_display_name(user)
    for row in cleaned:
        db.add(ReportAccessGrant(report_id=report_id, created_by=display, **row))


def _grant_labels(db: Session, grants: list[ReportAccessGrant]) -> list[dict]:
    out = []
    for grant in grants:
        label = None
        if grant.grant_type == "USER" and grant.user_id:
            target = db.query(User).filter(User.id == grant.user_id).first()
            label = f"{target.full_name} ({target.username})" if target else f"User #{grant.user_id}"
        elif grant.grant_type == "ROLE" and grant.role_id:
            target = db.query(Role).filter(Role.id == grant.role_id).first()
            label = target.role_name if target else f"Role #{grant.role_id}"
        elif grant.grant_type == "LOCATION":
            target = db.query(Location).filter(Location.location_code == grant.location_code).first()
            label = f"{grant.location_code} — {target.location_name}" if target else grant.location_code
        out.append({
            "id": grant.id,
            "grant_type": grant.grant_type,
            "user_id": grant.user_id,
            "role_id": grant.role_id,
            "location_code": grant.location_code,
            "access_level": grant.access_level,
            "label": label,
        })
    return out


def _definition_summary(report: ReportDefinition, definition: dict) -> dict:
    source = definition.get("source") or {}
    return {
        "report_type": str(definition.get("report_type") or report.report_type or "TABULAR").upper(),
        "source_kind": source.get("kind") or report.source_kind or "operation_tickets",
        "source_table": source.get("table") if (source.get("kind") == "table") else None,
        "column_count": len(definition.get("columns") or []),
    }


def _build_response(db: Session, user: User, report: ReportDefinition, *, include_grants: bool = True, access: str | None = None) -> dict:
    definition = public_definition(report.definition_json or {})
    summary = _definition_summary(report, definition)
    owner = db.query(User).filter(User.id == report.owner_user_id).first() if report.owner_user_id else None
    grants = _grants_of(db, report.id) if include_grants else []
    if access is None:
        access = _my_access(db, user, report, _grants_of(db, report.id), for_run=True) or "VIEW"
    return {
        "id": report.id,
        "report_code": report.report_code,
        "report_name": report.report_name,
        "description": report.description,
        "report_type": summary["report_type"],
        "source_kind": summary["source_kind"],
        "source_table": summary["source_table"],
        "definition": definition,
        "visibility": report.visibility or "PRIVATE",
        "is_published": (report.is_published or "No") == "Yes",
        "status": report.status,
        "version": report.version or 1,
        "owner_user_id": report.owner_user_id,
        "owner_name": (owner.full_name if owner else None) or report.created_by,
        "created_by": report.created_by,
        "updated_by": report.updated_by,
        "created_at": report.created_at,
        "updated_at": report.updated_at,
        "grants": _grant_labels(db, grants) if include_grants else [],
        "my_access": access,
        "column_count": summary["column_count"],
    }


def _run_params(payload: ReportRunRequest, *, for_export: bool = False) -> dict:
    return {
        "date_from": payload.date_from,
        "date_to": payload.date_to,
        "location_codes": payload.location_codes or [],
        "runtime_values": payload.runtime_values or {},
        "search": payload.search or "",
        "page": payload.page or 1,
        "page_size": payload.page_size or 50,
        "sort": payload.sort,
        "date_drill": payload.date_drill,
        "for_export": for_export,
    }


def _execute(db: Session, user: User, definition: dict, params: dict) -> dict:
    try:
        result = run_report(db, user, copy.deepcopy(definition), params)
    except ReportDefinitionError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    result["meta"].pop("_export_rows", None) if not params.get("for_export") else None
    return result


# ---------------------------------------------------------------------------
# Catalog / discovery
# ---------------------------------------------------------------------------

@router.get("/catalog")
def get_catalog(
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_any_user_permission(current_user, BUILDER_ANY, db)
    catalog = build_catalog()
    catalog["formula_help"] = FUNCTION_HELP
    catalog["operator_help"] = OPERATOR_HELP
    catalog["date_bases"] = [
        {"value": "ACCOUNTING_DATE", "label": "Accounting Date (location accounting day)", "help": "Recommended for stock accounting. Uses the ticket's own date/time with the Location Accounting Day Setting."},
        {"value": "PAYLOAD_OPERATION_DATE", "label": "Operation / Gauging Date (from ticket answers)", "help": "The date typed inside the ticket, without the accounting-day shift."},
        {"value": "OPERATION_DATE", "label": "Operation Date (ticket header)", "help": "The header operation date stored on the ticket."},
        {"value": "CREATED_AT", "label": "Created Date", "help": "When the record was created in the system."},
        {"value": "COLUMN", "label": "A date column I choose", "help": "Pick any date column of the table."},
        {"value": "NONE", "label": "No date filtering", "help": "For master-data style reports."},
    ]
    return catalog


@router.get("/operation-fields")
def get_operation_fields(
    operation_type_codes: str = Query(default=""),
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_any_user_permission(current_user, BUILDER_ANY, db)
    codes = [code.strip() for code in (operation_type_codes or "").split(",") if code.strip()]
    return discover_operation_fields(db, codes or None)


@router.post("/json-paths")
def post_json_paths(
    payload: JsonPathsRequest,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    """Sample saved JSON values and list every pickable path inside them."""
    require_any_user_permission(current_user, BUILDER_ANY, db)
    sample_size = max(1, min(200, int(payload.sample_size or 100)))
    scope = get_user_location_codes(current_user, db)
    values: list = []

    if payload.source_kind == "operation_tickets":
        field_code = str(payload.field_code or "").strip()
        if not field_code:
            raise HTTPException(status_code=400, detail="Choose which saved payload / answer to split into columns.")
        query = (
            db.query(OperationTransactionValue, OperationTransaction)
            .join(OperationTransaction, OperationTransaction.id == OperationTransactionValue.transaction_id)
            .filter(OperationTransactionValue.field_code == field_code)
        )
        codes = [c for c in (payload.operation_type_codes or []) if str(c or "").strip()]
        if codes:
            query = query.filter(OperationTransaction.operation_type_code.in_(codes))
        rows = query.order_by(OperationTransactionValue.id.desc()).limit(sample_size * 3).all()
        for value_row, tx in rows:
            if scope is not None:
                party = {
                    normalize_location_code(code)
                    for code in (tx.origin_location_code, tx.destination_location_code, tx.sender_location_code, tx.receiver_location_code)
                    if code
                }
                if not (party & scope):
                    continue
            values.append(value_row.field_value)
            if len(values) >= sample_size:
                break
    else:
        table_name = "tank_stock_ledger" if payload.source_kind == "tank_stock_ledger" else (payload.table or "")
        columns_meta = allowed_columns(table_name)
        json_column = payload.json_column or ""
        if json_column not in columns_meta or not columns_meta[json_column].get("is_json"):
            raise HTTPException(status_code=400, detail="Choose a JSON column to split into columns.")
        table = Base.metadata.tables[table_name]
        location_columns = [name for name, meta in columns_meta.items() if meta.get("is_location")]
        from sqlalchemy import select

        stmt = select(table.c[json_column], *[table.c[name] for name in location_columns])
        if "id" in table.c:
            stmt = stmt.order_by(table.c["id"].desc())
        stmt = stmt.limit(sample_size * 3)
        for mapping in db.execute(stmt).mappings().all():
            if scope is not None and location_columns:
                codes = {normalize_location_code(mapping.get(name)) for name in location_columns if mapping.get(name)}
                if codes and not (codes & scope):
                    continue
            values.append(mapping.get(json_column))
            if len(values) >= sample_size:
                break

    result = discover_json_paths(values, len(values))
    result["field_code"] = payload.field_code
    result["json_column"] = payload.json_column
    return result


@router.post("/formula/validate")
def post_formula_validate(
    payload: FormulaValidateRequest,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_any_user_permission(current_user, BUILDER_ANY, db)
    known = set(payload.column_keys or []) or None
    return validate_formula(payload.formula, known)


@router.get("/lookups")
def get_lookups(
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    """Pickers for the designer (grants, filters) and the report viewer."""
    require_any_user_permission(current_user, [*BUILDER_ANY, "View Custom Report"], db)
    scope = get_user_location_codes(current_user, db)
    locations = db.query(Location).filter(Location.status == "Active").order_by(Location.location_code).all()
    if scope is not None:
        locations = [loc for loc in locations if normalize_location_code(loc.location_code) in scope]
    can_design = user_has_permission(current_user, "Create Report Definition", db) or user_has_permission(current_user, "Edit Report Definition", db) or user_has_permission(current_user, "View Report Definition", db) or is_admin_user(current_user, db)

    statuses = [
        row[0] for row in db.query(OperationTransaction.status).distinct().all() if row[0]
    ]
    for standard in ("Draft", "Submitted", "Approved", "Rejected", "Cancelled"):
        if standard not in statuses:
            statuses.append(standard)

    payload: dict = {
        "locations": [
            {"location_code": loc.location_code, "location_name": loc.location_name, "location_type": loc.location_type}
            for loc in locations
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
            {"id": row.id, "template_name": row.template_name, "operation_type_code": row.operation_type_code, "entry_layout_type": row.entry_layout_type}
            for row in db.query(OperationTemplate).filter(OperationTemplate.status == "Active").order_by(OperationTemplate.template_name).all()
        ],
        "statuses": sorted(statuses),
        "assets": [
            {"asset_code": row.asset_code, "asset_name": row.asset_name, "asset_type_code": row.asset_type_code, "location_code": row.location_code}
            for row in db.query(Asset).filter(Asset.status == "Active").order_by(Asset.asset_code).limit(2000).all()
        ],
        "products": [
            row[0] for row in db.query(OperationTransaction.product_name).distinct().limit(200).all() if row[0]
        ],
        "users": [],
        "roles": [],
    }
    if can_design:
        payload["users"] = [
            {"id": row.id, "full_name": row.full_name, "username": row.username}
            for row in db.query(User).filter(User.status == "Active").order_by(User.full_name).all()
        ]
        payload["roles"] = [
            {"id": row.id, "role_name": row.role_name}
            for row in db.query(Role).filter(Role.status == "Active").order_by(Role.role_name).all()
        ]
    return payload


@router.get("/starter-templates")
def get_starters(
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_any_user_permission(current_user, BUILDER_ANY, db)
    return starter_templates()


# ---------------------------------------------------------------------------
# Definition CRUD
# ---------------------------------------------------------------------------

def _save_new_report(db: Session, user: User, payload: ReportDefinitionCreate) -> ReportDefinition:
    try:
        validate_definition(payload.definition)
    except ReportDefinitionError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if payload.is_published:
        require_user_permission(user, "Publish Report Definition", db)
    if str(payload.visibility or "PRIVATE").upper() not in ("PRIVATE", "INTERNAL"):
        raise HTTPException(status_code=400, detail="Visibility must be Private (named people) or Internal (all report users).")
    cleaned_grants = _validate_grants(db, user, payload.grants)
    stored_definition = public_definition(copy.deepcopy(payload.definition))
    summary_source = ReportDefinition(report_code="tmp", report_name=payload.report_name)
    summary = _definition_summary(summary_source, stored_definition)
    display = get_current_user_display_name(user)
    report = ReportDefinition(
        report_code=_slug_code(db, payload.report_name),
        report_name=str(payload.report_name).strip(),
        description=(payload.description or None),
        report_type=summary["report_type"],
        source_kind=summary["source_kind"],
        source_table=summary["source_table"],
        definition_json=stored_definition,
        visibility=str(payload.visibility or "PRIVATE").upper(),
        is_published="Yes" if payload.is_published else "No",
        status=payload.status if payload.status in ("Active", "Inactive") else "Active",
        version=1,
        owner_user_id=user.id,
        created_by=display,
        updated_by=display,
        updated_at=datetime.now(),
    )
    db.add(report)
    db.flush()
    _replace_grants(db, user, report.id, cleaned_grants)
    db.add(ReportDefinitionVersion(
        report_id=report.id, version_number=1, definition_json=stored_definition,
        change_note=payload.change_note or "Report created", created_by=display,
    ))
    create_audit_log(
        db=db, module_name="Report Builder", action="Create Report Definition",
        current_user=user, entity_type="ReportDefinition", entity_id=report.id,
        entity_label=report.report_name, remarks="Custom report created",
        request_path="/report-builder/definitions",
        details={"report_code": report.report_code, "report_type": report.report_type, "source_kind": report.source_kind, "grants": len(cleaned_grants), "published": bool(payload.is_published)},
    )
    db.commit()
    db.refresh(report)
    return report


@router.post("/definitions/from-starter", response_model=ReportDefinitionResponse)
def create_from_starter(
    payload: ReportFromStarterRequest,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Create Report Definition", db)
    starter = next((item for item in starter_templates() if item["id"] == payload.starter_id), None)
    if not starter:
        raise HTTPException(status_code=404, detail="Starter report not found")
    create = ReportDefinitionCreate(
        report_name=(payload.report_name or starter["name"]).strip(),
        description=starter["description"],
        definition=copy.deepcopy(starter["definition"]),
        visibility="PRIVATE",
        is_published=False,
        grants=[],
        change_note=f"Created from starter '{starter['name']}'",
    )
    report = _save_new_report(db, current_user, create)
    return _build_response(db, current_user, report, access="OWNER")


@router.get("/definitions", response_model=list[ReportDefinitionSummary])
def list_definitions(
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "View Report Definition", db)
    if is_admin_user(current_user, db):
        reports = db.query(ReportDefinition).order_by(ReportDefinition.report_name).all()
    else:
        granted_ids = set()
        role_ids = get_user_role_ids(db, current_user)
        scope = get_user_location_codes(current_user, db)
        grant_rows = db.query(ReportAccessGrant).all()
        for grant in grant_rows:
            if grant.grant_type == "USER" and grant.user_id == current_user.id:
                granted_ids.add(grant.report_id)
            elif grant.grant_type == "ROLE" and grant.role_id in role_ids:
                granted_ids.add(grant.report_id)
            elif grant.grant_type == "LOCATION" and (scope is None or normalize_location_code(grant.location_code) in (scope or set())):
                granted_ids.add(grant.report_id)
        reports = (
            db.query(ReportDefinition)
            .filter(or_(ReportDefinition.owner_user_id == current_user.id, ReportDefinition.id.in_(granted_ids or {-1})))
            .order_by(ReportDefinition.report_name)
            .all()
        )
    out = []
    for report in reports:
        full = _build_response(db, current_user, report, include_grants=False)
        out.append({
            key: full[key]
            for key in ("id", "report_code", "report_name", "description", "report_type", "source_kind", "visibility", "is_published", "status", "version", "owner_name", "created_by", "updated_at", "my_access", "column_count")
        })
    return out


@router.post("/definitions", response_model=ReportDefinitionResponse)
def create_definition(
    payload: ReportDefinitionCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Create Report Definition", db)
    report = _save_new_report(db, current_user, payload)
    return _build_response(db, current_user, report, access="OWNER")


@router.get("/definitions/{report_id}", response_model=ReportDefinitionResponse)
def get_definition(
    report_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "View Report Definition", db)
    report = _get_report_or_404(db, report_id)
    access = _require_builder_access(db, current_user, report, "VIEW")
    return _build_response(db, current_user, report, access=access)


@router.put("/definitions/{report_id}", response_model=ReportDefinitionResponse)
def update_definition(
    report_id: int,
    payload: ReportDefinitionUpdate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Edit Report Definition", db)
    report = _get_report_or_404(db, report_id)
    _require_builder_access(db, current_user, report, "EDIT")
    try:
        validate_definition(payload.definition)
    except ReportDefinitionError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    was_published = (report.is_published or "No") == "Yes"
    if payload.is_published and not was_published:
        require_user_permission(current_user, "Publish Report Definition", db)
    if str(payload.visibility or "PRIVATE").upper() not in ("PRIVATE", "INTERNAL"):
        raise HTTPException(status_code=400, detail="Visibility must be Private (named people) or Internal (all report users).")
    cleaned_grants = _validate_grants(db, current_user, payload.grants)
    stored_definition = public_definition(copy.deepcopy(payload.definition))
    summary = _definition_summary(report, stored_definition)
    display = get_current_user_display_name(current_user)
    report.report_name = str(payload.report_name).strip()
    report.description = payload.description or None
    report.report_type = summary["report_type"]
    report.source_kind = summary["source_kind"]
    report.source_table = summary["source_table"]
    report.definition_json = stored_definition
    report.visibility = str(payload.visibility or "PRIVATE").upper()
    report.is_published = "Yes" if payload.is_published else "No"
    report.status = payload.status if payload.status in ("Active", "Inactive") else "Active"
    report.version = (report.version or 1) + 1
    report.updated_by = display
    report.updated_at = datetime.now()
    _replace_grants(db, current_user, report.id, cleaned_grants)
    db.add(ReportDefinitionVersion(
        report_id=report.id, version_number=report.version, definition_json=stored_definition,
        change_note=payload.change_note or "Report updated", created_by=display,
    ))
    create_audit_log(
        db=db, module_name="Report Builder", action="Update Report Definition",
        current_user=current_user, entity_type="ReportDefinition", entity_id=report.id,
        entity_label=report.report_name, remarks="Custom report updated",
        request_path=f"/report-builder/definitions/{report_id}",
        details={"version": report.version, "grants": len(cleaned_grants), "published": bool(payload.is_published)},
    )
    db.commit()
    db.refresh(report)
    return _build_response(db, current_user, report)


@router.delete("/definitions/{report_id}")
def delete_definition(
    report_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Delete Report Definition", db)
    report = _get_report_or_404(db, report_id)
    _require_builder_access(db, current_user, report, "OWNER")
    create_audit_log(
        db=db, module_name="Report Builder", action="Delete Report Definition",
        current_user=current_user, entity_type="ReportDefinition", entity_id=report.id,
        entity_label=report.report_name, remarks="Custom report deleted",
        request_path=f"/report-builder/definitions/{report_id}",
        details={"report_code": report.report_code},
    )
    db.delete(report)
    db.commit()
    return {"message": "Report deleted successfully"}


@router.post("/definitions/{report_id}/duplicate", response_model=ReportDefinitionResponse)
def duplicate_definition(
    report_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Create Report Definition", db)
    report = _get_report_or_404(db, report_id)
    _require_builder_access(db, current_user, report, "VIEW")
    grants = [
        {"grant_type": g.grant_type, "user_id": g.user_id, "role_id": g.role_id, "location_code": g.location_code, "access_level": g.access_level}
        for g in _grants_of(db, report.id)
    ]
    from app.schemas import ReportAccessGrantIn

    create = ReportDefinitionCreate(
        report_name=f"{report.report_name} (Copy)"[:200],
        description=report.description,
        definition=copy.deepcopy(public_definition(report.definition_json or {})),
        visibility=report.visibility or "PRIVATE",
        is_published=False,
        grants=[ReportAccessGrantIn(**g) for g in grants],
        change_note=f"Copied from '{report.report_name}'",
    )
    copied = _save_new_report(db, current_user, create)
    return _build_response(db, current_user, copied, access="OWNER")


@router.post("/definitions/{report_id}/publish", response_model=ReportDefinitionResponse)
def publish_definition(
    report_id: int,
    payload: dict,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Publish Report Definition", db)
    report = _get_report_or_404(db, report_id)
    _require_builder_access(db, current_user, report, "EDIT")
    published = bool((payload or {}).get("published", True))
    try:
        validate_definition(report.definition_json or {})
    except ReportDefinitionError as exc:
        raise HTTPException(status_code=400, detail=f"This report cannot be published yet: {exc}") from exc
    report.is_published = "Yes" if published else "No"
    if published:
        report.status = "Active"
    report.updated_by = get_current_user_display_name(current_user)
    report.updated_at = datetime.now()
    create_audit_log(
        db=db, module_name="Report Builder", action="Publish Report Definition" if published else "Unpublish Report Definition",
        current_user=current_user, entity_type="ReportDefinition", entity_id=report.id,
        entity_label=report.report_name, remarks="Custom report published to Reporting" if published else "Custom report removed from Reporting",
        request_path=f"/report-builder/definitions/{report_id}/publish",
        details={"published": published},
    )
    db.commit()
    db.refresh(report)
    return _build_response(db, current_user, report)


@router.get("/definitions/{report_id}/versions")
def list_versions(
    report_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "View Report Definition", db)
    report = _get_report_or_404(db, report_id)
    _require_builder_access(db, current_user, report, "VIEW")
    rows = (
        db.query(ReportDefinitionVersion)
        .filter(ReportDefinitionVersion.report_id == report_id)
        .order_by(ReportDefinitionVersion.version_number.desc())
        .all()
    )
    return [
        {"id": row.id, "version_number": row.version_number, "change_note": row.change_note, "created_by": row.created_by, "created_at": row.created_at}
        for row in rows
    ]


@router.post("/run-preview")
def run_preview(
    payload: ReportPreviewRequest,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_any_user_permission(current_user, ["Create Report Definition", "Edit Report Definition"], db)
    return _execute(db, current_user, payload.definition, _run_params(payload))


@router.post("/definitions/{report_id}/run")
def run_saved_from_builder(
    report_id: int,
    payload: ReportRunRequest,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "View Report Definition", db)
    report = _get_report_or_404(db, report_id)
    _require_builder_access(db, current_user, report, "VIEW")
    return _execute(db, current_user, report.definition_json or {}, _run_params(payload))


# ---------------------------------------------------------------------------
# Reporting-module runtime
# ---------------------------------------------------------------------------

@router.get("/my-reports", response_model=list[ReportDefinitionSummary])
def list_my_reports(
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "View Custom Report", db)
    reports = (
        db.query(ReportDefinition)
        .filter(ReportDefinition.is_published == "Yes", ReportDefinition.status == "Active")
        .order_by(ReportDefinition.report_name)
        .all()
    )
    out = []
    for report in reports:
        access = _my_access(db, current_user, report, _grants_of(db, report.id), for_run=True)
        if access is None:
            continue
        full = _build_response(db, current_user, report, include_grants=False, access=access)
        out.append({key: full[key] for key in ("id", "report_code", "report_name", "description", "report_type", "source_kind", "visibility", "is_published", "status", "version", "owner_name", "created_by", "updated_at", "my_access", "column_count")})
    return out


@router.get("/my-reports/{report_id}", response_model=ReportDefinitionResponse)
def get_my_report(
    report_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "View Custom Report", db)
    report = _get_report_or_404(db, report_id)
    access = _require_run_access(db, current_user, report)
    return _build_response(db, current_user, report, include_grants=False, access=access)


@router.post("/my-reports/{report_id}/run")
def run_my_report(
    report_id: int,
    payload: ReportRunRequest,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "View Custom Report", db)
    report = _get_report_or_404(db, report_id)
    _require_run_access(db, current_user, report)
    return _execute(db, current_user, report.definition_json or {}, _run_params(payload))


@router.post("/my-reports/{report_id}/export")
def export_my_report(
    report_id: int,
    payload: ReportExportRequest,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Export Custom Report", db)
    report = _get_report_or_404(db, report_id)
    _require_run_access(db, current_user, report)
    result = _execute(db, current_user, report.definition_json or {}, _run_params(payload, for_export=True))
    stamp = datetime.now().strftime("%Y%m%d%H%M%S")
    safe_name = re.sub(r"[^a-z0-9]+", "-", (report.report_name or "report").casefold()).strip("-")
    fmt = str(payload.format or "xlsx").lower()
    create_audit_log(
        db=db, module_name="Reporting", action="Export Custom Report",
        current_user=current_user, entity_type="ReportDefinition", entity_id=report.id,
        entity_label=report.report_name, remarks=f"Custom report exported ({fmt})",
        request_path=f"/report-builder/my-reports/{report_id}/export",
        details={"format": fmt, "rows": result["meta"].get("total_rows")},
    )
    db.commit()
    if fmt == "csv":
        content = export_csv_bytes(result)
        media = "text/csv; charset=utf-8"
        filename = f"{safe_name}-{stamp}.csv"
    else:
        content = export_xlsx_bytes(result, report.report_name)
        media = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        filename = f"{safe_name}-{stamp}.xlsx"
    return Response(content=content, media_type=media, headers={"Content-Disposition": f'attachment; filename="{filename}"'})
