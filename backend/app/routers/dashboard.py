from datetime import date, datetime
from fastapi import APIRouter, Depends, HTTPException
from fastapi.encoders import jsonable_encoder
from sqlalchemy import and_, func, literal, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.config import APPROVED_TRANSACTION_STATUS, CORRECTION_HOLD_STATUS
from app.models import (
    ApprovedTransactionCorrectionRequest,
    Asset,
    AssetCalibrationData,
    AssetCalibrationTable,
    CalibrationTemplateColumn,
    DashboardConfig,
    DashboardDataSource,
    DashboardVersion,
    OperationTransaction,
    OperationTransactionValue,
    ShuttleVoyage,
    TankStockLedger,
    User,
)
from app.schemas import (
    DashboardConfigCreate,
    DashboardConfigResponse,
    DashboardConfigUpdate,
    DashboardDataRequest,
    DashboardDataResponse,
    DashboardDataSourceCreate,
    DashboardDataSourceResponse,
    DashboardDataSourceUpdate,
    DashboardPublishRequest,
    DashboardRevertRequest,
    DashboardVersionResponse,
)
from app.dependencies.auth import get_current_user_from_token
from app.dependencies.permissions import require_user_permission
from app.services.audit_service import create_audit_log
from app.utils.helpers import clean_optional_text, get_asset_by_code, get_current_user_display_name, get_location_by_code, safe_float
from app.routers.shuttle_fso_voyages import get_shuttle_voyage_by_key
from app.routers.tank_stock_ledger import build_fso_material_balance, build_fso_otr_report, build_fso_outturn_report
from app.services.transaction_helpers import approved_transaction_not_on_correction_hold

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])

VALID_DASHBOARD_SCOPE_TYPES = {"GLOBAL", "LOCATION"}
VALID_DASHBOARD_STATUSES = {"Draft", "Published", "Archived"}
VALID_DASHBOARD_DATA_SOURCE_STATUSES = {"Active", "Inactive"}
VALID_DASHBOARD_HANDLER_KEYS = {
    "FSO_OTR",
    "FSO_MATERIAL_BALANCE",
    "FSO_OUTTURN",
    "SHUTTLE_SUMMARY",
    "TANK_STOCK_SNAPSHOT",
    "ASSET_LIST",
    "OP_TRANSACTIONS",
    "OP_STATUS_COUNTS",
}


def normalize_dashboard_scope_type(value: str | None):
    cleaned = str(value or "").strip().upper()
    if cleaned not in VALID_DASHBOARD_SCOPE_TYPES:
        raise HTTPException(
            status_code=400,
            detail="scope_type must be GLOBAL or LOCATION",
        )
    return cleaned


def normalize_dashboard_status(value: str | None):
    cleaned = str(value or "").strip().lower()
    mapping = {
        "draft": "Draft",
        "published": "Published",
        "archived": "Archived",
    }
    out = mapping.get(cleaned)
    if out not in VALID_DASHBOARD_STATUSES:
        raise HTTPException(
            status_code=400,
            detail="status must be Draft, Published, or Archived",
        )
    return out


def build_dashboard_config_response(config: DashboardConfig):
    return {
        "id": config.id,
        "name": config.name,
        "scope_type": config.scope_type,
        "location_code": config.location_code,
        "status": config.status,
        "active_version_id": config.active_version_id,
        "created_by": config.created_by,
        "remarks": config.remarks,
        "created_at": config.created_at,
        "updated_at": config.updated_at,
    }


def build_dashboard_version_response(version: DashboardVersion):
    return {
        "id": version.id,
        "config_id": version.config_id,
        "version_number": version.version_number,
        "config_json": version.config_json,
        "change_note": version.change_note,
        "created_by": version.created_by,
        "created_at": version.created_at,
    }


def normalize_dashboard_data_source_code(value: str | None):
    cleaned = str(value or "").strip().upper()
    if cleaned == "":
        raise HTTPException(
            status_code=400,
            detail="data_source_code is required",
        )
    return cleaned


def normalize_dashboard_data_source_status(value: str | None):
    cleaned = str(value or "").strip()
    if cleaned == "":
        cleaned = "Active"
    if cleaned not in VALID_DASHBOARD_DATA_SOURCE_STATUSES:
        raise HTTPException(
            status_code=400,
            detail="status must be Active or Inactive",
        )
    return cleaned


def normalize_dashboard_handler_key(value: str | None):
    cleaned = str(value or "").strip().upper()
    if cleaned == "":
        raise HTTPException(
            status_code=400,
            detail="handler_key is required",
        )
    return cleaned


def normalize_allowed_params_json(value):
    if not isinstance(value, dict):
        raise HTTPException(
            status_code=400,
            detail="allowed_params_json must be an object",
        )
    allowed = value.get("allowed")
    if not isinstance(allowed, list):
        raise HTTPException(
            status_code=400,
            detail='allowed_params_json must contain "allowed" as a list',
        )

    normalized_allowed = []
    seen_keys = set()
    for item in allowed:
        if not isinstance(item, dict):
            raise HTTPException(
                status_code=400,
                detail='allowed_params_json.allowed items must be objects',
            )

        key = str(item.get("key") or "").strip()
        if key == "":
            raise HTTPException(
                status_code=400,
                detail='allowed_params_json.allowed[].key is required',
            )
        if key in seen_keys:
            raise HTTPException(
                status_code=400,
                detail=f"Duplicate allowed param key: {key}",
            )
        seen_keys.add(key)

        typ = str(item.get("type") or "").strip().lower()
        if typ not in ("str", "int", "float", "bool", "date"):
            raise HTTPException(
                status_code=400,
                detail=f"Invalid allowed param type for {key}",
            )

        required = bool(item.get("required"))
        normalized_allowed.append(
            {
                "key": key,
                "type": typ,
                "required": required,
            }
        )

    return {"allowed": normalized_allowed}


def build_dashboard_data_source_response(obj: DashboardDataSource):
    return {
        "id": obj.id,
        "data_source_code": obj.data_source_code,
        "data_source_name": obj.data_source_name,
        "description": obj.description,
        "handler_key": obj.handler_key,
        "allowed_params_json": obj.allowed_params_json,
        "status": obj.status,
        "created_by": obj.created_by,
        "remarks": obj.remarks,
        "created_at": obj.created_at,
        "updated_at": obj.updated_at,
    }


def seed_dashboard_data_sources(db: Session, current_user_label: str | None):
    defs = [
        {
            "data_source_code": "FSO_OTR",
            "data_source_name": "FSO OTR",
            "description": "FSO operations ticket register (OTR)",
            "handler_key": "FSO_OTR",
            "allowed_params_json": {
                "allowed": [
                    {"key": "location_code", "type": "str", "required": True},
                    {"key": "fso_asset_code", "type": "str", "required": True},
                    {"key": "date_from", "type": "date", "required": True},
                    {"key": "date_to", "type": "date", "required": True},
                    {"key": "shuttle_number", "type": "str", "required": False},
                ]
            },
            "status": "Active",
        },
        {
            "data_source_code": "FSO_MATERIAL_BALANCE",
            "data_source_name": "FSO Material Balance",
            "description": "FSO daily material balance",
            "handler_key": "FSO_MATERIAL_BALANCE",
            "allowed_params_json": {
                "allowed": [
                    {"key": "location_code", "type": "str", "required": True},
                    {"key": "fso_asset_code", "type": "str", "required": True},
                    {"key": "date_from", "type": "date", "required": True},
                    {"key": "date_to", "type": "date", "required": True},
                ]
            },
            "status": "Active",
        },
        {
            "data_source_code": "FSO_OUTTURN",
            "data_source_name": "FSO Outturn",
            "description": "FSO outturn (receipt vs shuttle discharge)",
            "handler_key": "FSO_OUTTURN",
            "allowed_params_json": {
                "allowed": [
                    {"key": "location_code", "type": "str", "required": True},
                    {"key": "fso_asset_code", "type": "str", "required": True},
                    {"key": "date_from", "type": "date", "required": True},
                    {"key": "date_to", "type": "date", "required": True},
                ]
            },
            "status": "Active",
        },
        {
            "data_source_code": "SHUTTLE_SUMMARY",
            "data_source_name": "Shuttle Summary",
            "description": "Shuttle voyage summary (group list)",
            "handler_key": "SHUTTLE_SUMMARY",
            "allowed_params_json": {
                "allowed": [
                    {"key": "location_code", "type": "str", "required": False},
                    {"key": "shuttle_number", "type": "str", "required": False},
                    {"key": "shuttle_asset_code", "type": "str", "required": False},
                    {"key": "tab", "type": "str", "required": False},
                    {"key": "search", "type": "str", "required": False},
                    {"key": "date_from", "type": "date", "required": False},
                    {"key": "date_to", "type": "date", "required": False},
                    {"key": "page", "type": "int", "required": False},
                    {"key": "page_size", "type": "int", "required": False},
                ]
            },
            "status": "Active",
        },
        {
            "data_source_code": "ASSET_LIST",
            "data_source_name": "Asset Registry (Any Asset)",
            "description": "List of assets filtered by location/type/status.",
            "handler_key": "ASSET_LIST",
            "allowed_params_json": {
                "allowed": [
                    {"key": "location_code", "type": "str", "required": False},
                    {"key": "asset_type_code", "type": "str", "required": False},
                    {"key": "status", "type": "str", "required": False},
                    {"key": "limit", "type": "int", "required": False},
                ]
            },
            "status": "Active",
        },
        {
            "data_source_code": "OP_TRANSACTIONS",
            "data_source_name": "Operation Tickets (Any Asset)",
            "description": "Operation transactions list (filter by location/asset/type/status/date).",
            "handler_key": "OP_TRANSACTIONS",
            "allowed_params_json": {
                "allowed": [
                    {"key": "location_code", "type": "str", "required": False},
                    {"key": "asset_type_code", "type": "str", "required": False},
                    {"key": "asset_code", "type": "str", "required": False},
                    {"key": "operation_type_code", "type": "str", "required": False},
                    {"key": "status", "type": "str", "required": False},
                    {"key": "date_from", "type": "date", "required": False},
                    {"key": "date_to", "type": "date", "required": False},
                    {"key": "limit", "type": "int", "required": False},
                ]
            },
            "status": "Active",
        },
        {
            "data_source_code": "OP_STATUS_COUNTS",
            "data_source_name": "Operation Ticket Status Counts",
            "description": "Counts grouped by status (filter by location/asset/type/date).",
            "handler_key": "OP_STATUS_COUNTS",
            "allowed_params_json": {
                "allowed": [
                    {"key": "location_code", "type": "str", "required": False},
                    {"key": "asset_type_code", "type": "str", "required": False},
                    {"key": "asset_code", "type": "str", "required": False},
                    {"key": "operation_type_code", "type": "str", "required": False},
                    {"key": "date_from", "type": "date", "required": False},
                    {"key": "date_to", "type": "date", "required": False},
                ]
            },
            "status": "Active",
        },
        {
            "data_source_code": "TANK_STOCK_SNAPSHOT",
            "data_source_name": "Tank Stock Snapshot",
            "description": "Tank stock snapshot (placeholder)",
            "handler_key": "TANK_STOCK_SNAPSHOT",
            "allowed_params_json": {
                "allowed": [
                    {"key": "location_code", "type": "str", "required": True},
                    {"key": "asset_type_code", "type": "str", "required": False},
                    {"key": "asset_type_codes", "type": "str", "required": False},
                    {"key": "value_field", "type": "str", "required": False},
                    {"key": "capacity_source", "type": "str", "required": False},
                    {"key": "as_of_date", "type": "date", "required": False},
                    {"key": "limit", "type": "int", "required": False},
                    {"key": "sort_by", "type": "str", "required": False},
                ]
            },
            "status": "Active",
        },
    ]

    created = 0
    updated = 0

    for d in defs:
        code = normalize_dashboard_data_source_code(d.get("data_source_code"))
        existing = (
            db.query(DashboardDataSource)
            .filter(DashboardDataSource.data_source_code == code)
            .first()
        )

        normalized_allowed = normalize_allowed_params_json(d.get("allowed_params_json"))
        handler_key = normalize_dashboard_handler_key(d.get("handler_key"))
        status_value = normalize_dashboard_data_source_status(d.get("status"))

        if not existing:
            obj = DashboardDataSource(
                data_source_code=code,
                data_source_name=str(d.get("data_source_name") or "").strip(),
                description=clean_optional_text(d.get("description")),
                handler_key=handler_key,
                allowed_params_json=jsonable_encoder(normalized_allowed),
                status=status_value,
                created_by=current_user_label,
                remarks=None,
            )
            db.add(obj)
            created += 1
        else:
            existing.data_source_name = str(d.get("data_source_name") or "").strip()
            existing.description = clean_optional_text(d.get("description"))
            existing.handler_key = handler_key
            existing.allowed_params_json = jsonable_encoder(normalized_allowed)
            existing.status = status_value
            existing.updated_at = datetime.now()
            updated += 1

    return {"created": created, "updated": updated, "total": created + updated}


def coerce_dashboard_param_value(param_type: str, raw_value, field_name: str):
    t = str(param_type or "").strip().lower()

    if t == "date":
        if raw_value is None:
            return None
        return parse_date_filter(str(raw_value), field_name)

    if t == "int":
        if raw_value is None:
            return None
        try:
            return int(raw_value)
        except Exception:
            raise HTTPException(status_code=400, detail=f"{field_name} must be an integer")

    if t == "float":
        if raw_value is None:
            return None
        try:
            return float(raw_value)
        except Exception:
            raise HTTPException(status_code=400, detail=f"{field_name} must be a number")

    if t == "bool":
        if raw_value is None:
            return None
        if isinstance(raw_value, bool):
            return raw_value
        v = str(raw_value or "").strip().lower()
        if v in ("true", "1", "yes", "y", "on"):
            return True
        if v in ("false", "0", "no", "n", "off"):
            return False
        raise HTTPException(status_code=400, detail=f"{field_name} must be a boolean")

    if raw_value is None:
        return None
    return str(raw_value).strip()


def parse_date_filter(value: str | None, field_name: str):
    cleaned = str(value or "").strip()
    if cleaned == "":
        return None
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(cleaned, fmt).date()
        except ValueError:
            continue
    raise HTTPException(
        status_code=400,
        detail=f"{field_name} must be a valid date (YYYY-MM-DD or DD-MM-YYYY)",
    )


def build_shuttle_summary_rows(
    db: Session,
    date_from: date | None = None,
    date_to: date | None = None,
    location_code: str | None = None,
    shuttle_number: str | None = None,
    shuttle_asset_code: str | None = None,
    tab: str | None = None,
    search: str | None = None,
    page: int = 1,
    page_size: int = 20,
):
    def _norm(v):
        return str(v or "").strip().upper()

    def _abs_qty(net_stock, net_water):
        try:
            return abs(float(net_stock or 0.0)) + abs(float(net_water or 0.0))
        except Exception:
            return 0.0

    def _op_code(meta):
        return _norm(meta.get("vessel_operation_code"))

    def _op_label(meta):
        return _norm(meta.get("vessel_operation_label"))

    def _is_loading(meta):
        code = _op_code(meta)
        if code == "LOADING":
            return True
        label = _op_label(meta)
        return ("LOADING" in label) and ("UNLOADING" not in label)

    def _is_sts_in(meta):
        code = _op_code(meta)
        if code == "STS_IN":
            return True
        label = _op_label(meta)
        return "STS IN" in label or "STS_IN" in label

    def _is_sts_out(meta):
        code = _op_code(meta)
        if code == "STS_OUT":
            return True
        label = _op_label(meta)
        return "STS OUT" in label or "STS_OUT" in label

    def _is_unloading(meta):
        code = _op_code(meta)
        if code == "UNLOADING":
            return True
        label = _op_label(meta)
        return ("UNLOADING" in label) or ("UNLOAD" in label)

    def _is_top_up(meta):
        code = _op_code(meta)
        if code == "TOP_UP":
            return True
        label = _op_label(meta)
        return ("TOP UP" in label) or ("TOP-UP" in label) or ("TOP_UP" in label)

    lc = clean_optional_text(location_code)
    sn = clean_optional_text(shuttle_number)
    ac = clean_optional_text(shuttle_asset_code)

    tab_norm = (clean_optional_text(tab) or "OPEN").upper()
    search_norm = (clean_optional_text(search) or "").strip()

    page = 1 if page is None or page < 1 else page
    page_size = 20 if page_size is None or page_size < 1 else min(int(page_size), 200)
    offset = (page - 1) * page_size

    base_q = (
        db.query(OperationTransaction)
        .join(
            OperationTransactionValue,
            OperationTransactionValue.transaction_id == OperationTransaction.id,
        )
        .filter(
            OperationTransactionValue.field_code == "shuttle_payload",
            OperationTransaction.status == APPROVED_TRANSACTION_STATUS,
            approved_transaction_not_on_correction_hold(db),
        )
    )

    if date_from:
        base_q = base_q.filter(OperationTransaction.operation_date >= date_from)
    if date_to:
        base_q = base_q.filter(OperationTransaction.operation_date <= date_to)
    if lc:
        base_q = base_q.filter(OperationTransaction.origin_location_code.ilike(lc))
    if sn:
        base_q = base_q.filter(OperationTransaction.convoy_number.ilike(sn))
    if ac:
        base_q = base_q.filter(OperationTransaction.primary_asset_code.ilike(ac))

    if search_norm:
        like = f"%{search_norm}%"
        base_q = base_q.filter(
            or_(
                OperationTransaction.origin_location_code.ilike(like),
                OperationTransaction.convoy_number.ilike(like),
                OperationTransaction.primary_asset_code.ilike(like),
                OperationTransaction.operation_number.ilike(like),
                OperationTransaction.operation_ticket_number.ilike(like),
                OperationTransaction.product_name.ilike(like),
            )
        )

    voyage_status_expr = func.coalesce(ShuttleVoyage.status, literal("OPEN"))

    key_loc = OperationTransaction.origin_location_code
    key_shuttle = OperationTransaction.convoy_number
    key_asset = OperationTransaction.primary_asset_code

    group_q = (
        base_q.with_entities(
            key_loc.label("location_code"),
            key_shuttle.label("shuttle_number"),
            key_asset.label("shuttle_asset_code"),
            func.min(OperationTransaction.operation_date).label("first_date"),
            func.max(OperationTransaction.operation_date).label("last_date"),
        )
        .outerjoin(
            ShuttleVoyage,
            and_(
                ShuttleVoyage.location_code == key_loc,
                ShuttleVoyage.shuttle_number == key_shuttle,
                ShuttleVoyage.shuttle_asset_code == key_asset,
            ),
        )
        .group_by(key_loc, key_shuttle, key_asset, voyage_status_expr)
    )

    if tab_norm == "CLOSED":
        group_q = group_q.filter(voyage_status_expr == "CLOSED")
    else:
        group_q = group_q.filter(voyage_status_expr != "CLOSED")

    total_groups = group_q.count()

    group_rows = (
        group_q.order_by(func.max(OperationTransaction.operation_date).desc(), key_loc.asc())
        .offset(offset)
        .limit(page_size)
        .all()
    )

    if not group_rows:
        return {
            "rows": [],
            "total_groups": total_groups,
            "page": page,
            "page_size": page_size,
            "has_more": total_groups > offset + page_size,
        }

    keys = [(r.location_code, r.shuttle_number, r.shuttle_asset_code) for r in group_rows]

    key_filters = []
    for (loc_code, sh_num, asset_code) in keys:
        key_filters.append(
            and_(
                OperationTransaction.origin_location_code == loc_code,
                OperationTransaction.convoy_number == sh_num,
                OperationTransaction.primary_asset_code == asset_code,
            )
        )

    payload_rows = (
        db.query(
            OperationTransaction.origin_location_code,
            OperationTransaction.convoy_number,
            OperationTransaction.primary_asset_code,
            OperationTransactionValue.field_value,
        )
        .join(
            OperationTransactionValue,
            OperationTransactionValue.transaction_id == OperationTransaction.id,
        )
        .filter(
            OperationTransactionValue.field_code == "shuttle_payload",
            OperationTransaction.status == APPROVED_TRANSACTION_STATUS,
            approved_transaction_not_on_correction_hold(db),
        )
        .filter(or_(*key_filters))
        .all()
    )

    totals_map = {}
    for (loc_code, sh_num, asset_code, field_value) in payload_rows:
        k = f"{loc_code}|{sh_num}|{asset_code}"
        if k not in totals_map:
            totals_map[k] = {"net_receipt_bbl": 0.0, "net_discharge_bbl": 0.0}

        if isinstance(field_value, dict):
            fv = field_value
            meta = fv.get("meta") or {}
            net = ((fv.get("calculated") or {}).get("net") or {})
            net_stock = float(safe_float(net.get("net_stock_bbl")))
            net_water = float(safe_float(net.get("net_water_bbl")))
            qty_bbl = _abs_qty(net_stock, net_water)

            if (_is_loading(meta) or _is_sts_in(meta) or _is_top_up(meta)) and (not _is_unloading(meta)):
                totals_map[k]["net_receipt_bbl"] += qty_bbl
            if _is_unloading(meta) and not _is_sts_out(meta):
                totals_map[k]["net_discharge_bbl"] += qty_bbl

    rows = []
    for (loc_code, sh_num, asset_code) in keys:
        asset = get_asset_by_code(asset_code, db)
        loc = get_location_by_code(loc_code, db)
        voyage = get_shuttle_voyage_by_key(db, loc_code, sh_num or "", asset_code)

        k = f"{loc_code}|{sh_num}|{asset_code}"
        t = totals_map.get(k, {"net_receipt_bbl": 0.0, "net_discharge_bbl": 0.0})

        rows.append(
            {
                "group_key": k,
                "location_code": loc_code,
                "location_name": loc.location_name if loc else "",
                "shuttle_number": sh_num or "",
                "shuttle_asset_code": asset_code,
                "shuttle_asset_name": asset.asset_name if asset else "",
                "voyage_status": voyage.status if voyage else "OPEN",
                "closed_by": voyage.closed_by if voyage else None,
                "closed_at": voyage.closed_at if voyage else None,
                "closure_remarks": voyage.closure_remarks if voyage else None,
                "net_receipt_bbl": float(t["net_receipt_bbl"]),
                "net_discharge_bbl": float(t["net_discharge_bbl"]),
            }
        )

    return {
        "rows": rows,
        "total_groups": total_groups,
        "page": page,
        "page_size": page_size,
        "has_more": total_groups > offset + page_size,
    }


@router.get("/configs", response_model=list[DashboardConfigResponse])
def get_dashboard_configs(
    scope_type: str | None = None,
    location_code: str | None = None,
    status: str | None = None,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "View Dashboard",
        db,
    )

    query = db.query(DashboardConfig)

    if scope_type:
        query = query.filter(
            DashboardConfig.scope_type == normalize_dashboard_scope_type(scope_type)
        )

    if location_code is not None and str(location_code).strip() != "":
        query = query.filter(
            DashboardConfig.location_code.ilike(str(location_code).strip())
        )

    if status:
        query = query.filter(
            DashboardConfig.status == normalize_dashboard_status(status)
        )

    configs = (
        query.order_by(
            DashboardConfig.scope_type.asc(),
            DashboardConfig.location_code.asc().nullsfirst(),
            DashboardConfig.name.asc(),
        )
        .all()
    )

    return [
        build_dashboard_config_response(config)
        for config in configs
    ]


@router.get("/configs/{config_id}", response_model=DashboardConfigResponse)
def get_dashboard_config_by_id(
    config_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "View Dashboard",
        db,
    )

    config = (
        db.query(DashboardConfig)
        .filter(DashboardConfig.id == config_id)
        .first()
    )

    if not config:
        raise HTTPException(
            status_code=404,
            detail="Dashboard config not found",
        )

    return build_dashboard_config_response(config)


@router.post("/configs", response_model=DashboardConfigResponse)
def create_dashboard_config(
    request: DashboardConfigCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage Dashboard",
        db,
    )

    name = str(request.name or "").strip()
    if name == "":
        raise HTTPException(
            status_code=400,
            detail="name is required",
        )

    scope_type = normalize_dashboard_scope_type(request.scope_type)
    location_code = clean_optional_text(request.location_code)

    if scope_type == "GLOBAL":
        location_code = None
    else:
        if not location_code:
            raise HTTPException(
                status_code=400,
                detail="location_code is required when scope_type is LOCATION",
            )

    new_config = DashboardConfig(
        name=name,
        scope_type=scope_type,
        location_code=location_code,
        status="Draft",
        active_version_id=None,
        created_by=get_current_user_display_name(current_user),
        remarks=clean_optional_text(request.remarks),
    )

    db.add(new_config)

    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=400,
            detail="Dashboard config already exists for this scope",
        )

    create_audit_log(
        db=db,
        module_name="Dashboard",
        action="Create DashboardConfig",
        current_user=current_user,
        entity_type="DashboardConfig",
        entity_id=new_config.id,
        entity_label=new_config.name,
        remarks="Dashboard config created",
        request_path="/dashboard-configs",
        details=build_dashboard_config_response(new_config),
    )

    db.commit()
    db.refresh(new_config)

    return build_dashboard_config_response(new_config)


@router.put("/configs/{config_id}", response_model=DashboardConfigResponse)
def update_dashboard_config(
    config_id: int,
    request: DashboardConfigUpdate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage Dashboard",
        db,
    )

    config = (
        db.query(DashboardConfig)
        .filter(DashboardConfig.id == config_id)
        .first()
    )

    if not config:
        raise HTTPException(
            status_code=404,
            detail="Dashboard config not found",
        )

    old_details = build_dashboard_config_response(config)
    payload = request.model_dump(exclude_unset=True)

    if "name" in payload:
        name = str(payload.get("name") or "").strip()
        if name == "":
            raise HTTPException(
                status_code=400,
                detail="name cannot be empty",
            )
        config.name = name

    if "scope_type" in payload:
        config.scope_type = normalize_dashboard_scope_type(payload.get("scope_type"))

    if "location_code" in payload:
        config.location_code = clean_optional_text(payload.get("location_code"))

    if "status" in payload:
        config.status = normalize_dashboard_status(payload.get("status"))

    if "remarks" in payload:
        config.remarks = clean_optional_text(payload.get("remarks"))

    if config.scope_type == "GLOBAL":
        config.location_code = None
    else:
        if not clean_optional_text(config.location_code):
            raise HTTPException(
                status_code=400,
                detail="location_code is required when scope_type is LOCATION",
            )

    config.updated_at = datetime.now()

    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=400,
            detail="Dashboard config already exists for this scope",
        )

    create_audit_log(
        db=db,
        module_name="Dashboard",
        action="Update DashboardConfig",
        current_user=current_user,
        entity_type="DashboardConfig",
        entity_id=config.id,
        entity_label=config.name,
        remarks="Dashboard config updated",
        request_path=f"/dashboard-configs/{config_id}",
        details={
            "old": old_details,
            "new": build_dashboard_config_response(config),
        },
    )

    db.commit()
    db.refresh(config)

    return build_dashboard_config_response(config)


@router.get(
    "/configs/{config_id}/versions",
    response_model=list[DashboardVersionResponse],
)
def get_dashboard_versions_for_config(
    config_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "View Dashboard",
        db,
    )

    config = (
        db.query(DashboardConfig)
        .filter(DashboardConfig.id == config_id)
        .first()
    )

    if not config:
        raise HTTPException(
            status_code=404,
            detail="Dashboard config not found",
        )

    versions = (
        db.query(DashboardVersion)
        .filter(DashboardVersion.config_id == config_id)
        .order_by(DashboardVersion.version_number.desc())
        .all()
    )

    return [
        build_dashboard_version_response(v)
        for v in versions
    ]


@router.get("/versions/{version_id}", response_model=DashboardVersionResponse)
def get_dashboard_version_by_id(
    version_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "View Dashboard",
        db,
    )

    version = (
        db.query(DashboardVersion)
        .filter(DashboardVersion.id == version_id)
        .first()
    )

    if not version:
        raise HTTPException(
            status_code=404,
            detail="Dashboard version not found",
        )

    return build_dashboard_version_response(version)


@router.post("/configs/{config_id}/publish", response_model=DashboardConfigResponse)
def publish_dashboard_config(
    config_id: int,
    request: DashboardPublishRequest,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage Dashboard",
        db,
    )

    config = (
        db.query(DashboardConfig)
        .filter(DashboardConfig.id == config_id)
        .first()
    )

    if not config:
        raise HTTPException(
            status_code=404,
            detail="Dashboard config not found",
        )

    max_version = (
        db.query(func.max(DashboardVersion.version_number))
        .filter(DashboardVersion.config_id == config_id)
        .scalar()
        or 0
    )

    next_version_number = int(max_version) + 1

    new_version = DashboardVersion(
        config_id=config_id,
        version_number=next_version_number,
        config_json=jsonable_encoder(request.config_json),
        change_note=clean_optional_text(request.change_note),
        created_by=get_current_user_display_name(current_user),
    )

    db.add(new_version)
    db.flush()

    old_details = build_dashboard_config_response(config)

    config.status = "Published"
    config.active_version_id = new_version.id
    config.updated_at = datetime.now()

    create_audit_log(
        db=db,
        module_name="Dashboard",
        action="Publish Dashboard",
        current_user=current_user,
        entity_type="DashboardConfig",
        entity_id=config.id,
        entity_label=config.name,
        remarks="Dashboard published",
        request_path=f"/dashboard-configs/{config_id}/publish",
        details={
            "config_id": config.id,
            "version_id": new_version.id,
            "version_number": new_version.version_number,
            "change_note": new_version.change_note,
            "old": old_details,
            "new": build_dashboard_config_response(config),
        },
    )

    db.commit()
    db.refresh(config)

    return build_dashboard_config_response(config)


@router.post("/configs/{config_id}/revert", response_model=DashboardConfigResponse)
def revert_dashboard_config(
    config_id: int,
    request: DashboardRevertRequest,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage Dashboard",
        db,
    )

    config = (
        db.query(DashboardConfig)
        .filter(DashboardConfig.id == config_id)
        .first()
    )

    if not config:
        raise HTTPException(
            status_code=404,
            detail="Dashboard config not found",
        )

    version = (
        db.query(DashboardVersion)
        .filter(
            DashboardVersion.id == request.version_id,
            DashboardVersion.config_id == config_id,
        )
        .first()
    )

    if not version:
        raise HTTPException(
            status_code=400,
            detail="version_id does not belong to this config",
        )

    from_version_id = config.active_version_id
    old_details = build_dashboard_config_response(config)

    config.active_version_id = version.id
    config.updated_at = datetime.now()

    create_audit_log(
        db=db,
        module_name="Dashboard",
        action="Revert Dashboard",
        current_user=current_user,
        entity_type="DashboardConfig",
        entity_id=config.id,
        entity_label=config.name,
        remarks="Dashboard reverted",
        request_path=f"/dashboard-configs/{config_id}/revert",
        details={
            "from_version_id": from_version_id,
            "to_version_id": version.id,
            "change_note": clean_optional_text(request.change_note),
            "old": old_details,
            "new": build_dashboard_config_response(config),
        },
    )

    db.commit()
    db.refresh(config)

    return build_dashboard_config_response(config)


@router.get(
    "/data-sources",
    response_model=list[DashboardDataSourceResponse],
)
def get_dashboard_data_sources(
    status: str | None = None,
    q: str | None = None,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "View Dashboard",
        db,
    )

    query = db.query(DashboardDataSource)

    cleaned_status = clean_optional_text(status)
    if cleaned_status:
        query = query.filter(
            DashboardDataSource.status == normalize_dashboard_data_source_status(cleaned_status)
        )

    cleaned_q = clean_optional_text(q)
    if cleaned_q:
        like = f"%{cleaned_q}%"
        query = query.filter(
            or_(
                DashboardDataSource.data_source_code.ilike(like),
                DashboardDataSource.data_source_name.ilike(like),
                DashboardDataSource.handler_key.ilike(like),
            )
        )

    rows = query.order_by(DashboardDataSource.data_source_code.asc()).all()

    return [
        build_dashboard_data_source_response(r)
        for r in rows
    ]


@router.get(
    "/data-sources/{data_source_id}",
    response_model=DashboardDataSourceResponse,
)
def get_dashboard_data_source_by_id(
    data_source_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "View Dashboard",
        db,
    )

    obj = (
        db.query(DashboardDataSource)
        .filter(DashboardDataSource.id == data_source_id)
        .first()
    )

    if not obj:
        raise HTTPException(
            status_code=404,
            detail="Dashboard data source not found",
        )

    return build_dashboard_data_source_response(obj)


@router.post(
    "/data-sources",
    response_model=DashboardDataSourceResponse,
)
def create_dashboard_data_source(
    request: DashboardDataSourceCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage Dashboard",
        db,
    )

    code = normalize_dashboard_data_source_code(request.data_source_code)
    name = str(request.data_source_name or "").strip()
    if name == "":
        raise HTTPException(
            status_code=400,
            detail="data_source_name is required",
        )

    handler_key = normalize_dashboard_handler_key(request.handler_key)
    allowed_params_json = normalize_allowed_params_json(request.allowed_params_json)
    status_value = normalize_dashboard_data_source_status(request.status)

    obj = DashboardDataSource(
        data_source_code=code,
        data_source_name=name,
        description=clean_optional_text(request.description),
        handler_key=handler_key,
        allowed_params_json=jsonable_encoder(allowed_params_json),
        status=status_value,
        created_by=get_current_user_display_name(current_user),
        remarks=clean_optional_text(request.remarks),
    )

    db.add(obj)

    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=400,
            detail="data_source_code already exists",
        )

    create_audit_log(
        db=db,
        module_name="Dashboard",
        action="Create DashboardDataSource",
        current_user=current_user,
        entity_type="DashboardDataSource",
        entity_id=obj.id,
        entity_label=obj.data_source_code,
        remarks="Dashboard data source created",
        request_path="/dashboard-data-sources",
        details=build_dashboard_data_source_response(obj),
    )

    db.commit()
    db.refresh(obj)

    return build_dashboard_data_source_response(obj)


@router.put(
    "/data-sources/{data_source_id}",
    response_model=DashboardDataSourceResponse,
)
def update_dashboard_data_source(
    data_source_id: int,
    request: DashboardDataSourceUpdate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage Dashboard",
        db,
    )

    obj = (
        db.query(DashboardDataSource)
        .filter(DashboardDataSource.id == data_source_id)
        .first()
    )

    if not obj:
        raise HTTPException(
            status_code=404,
            detail="Dashboard data source not found",
        )

    old_details = build_dashboard_data_source_response(obj)
    payload = request.model_dump(exclude_unset=True)

    if "data_source_code" in payload:
        obj.data_source_code = normalize_dashboard_data_source_code(payload.get("data_source_code"))

    if "data_source_name" in payload:
        name = str(payload.get("data_source_name") or "").strip()
        if name == "":
            raise HTTPException(
                status_code=400,
                detail="data_source_name cannot be empty",
            )
        obj.data_source_name = name

    if "description" in payload:
        obj.description = clean_optional_text(payload.get("description"))

    if "handler_key" in payload:
        obj.handler_key = normalize_dashboard_handler_key(payload.get("handler_key"))

    if "allowed_params_json" in payload:
        obj.allowed_params_json = jsonable_encoder(
            normalize_allowed_params_json(payload.get("allowed_params_json"))
        )

    if "status" in payload:
        obj.status = normalize_dashboard_data_source_status(payload.get("status"))

    if "remarks" in payload:
        obj.remarks = clean_optional_text(payload.get("remarks"))

    obj.updated_at = datetime.now()

    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=400,
            detail="data_source_code already exists",
        )

    create_audit_log(
        db=db,
        module_name="Dashboard",
        action="Update DashboardDataSource",
        current_user=current_user,
        entity_type="DashboardDataSource",
        entity_id=obj.id,
        entity_label=obj.data_source_code,
        remarks="Dashboard data source updated",
        request_path=f"/dashboard-data-sources/{data_source_id}",
        details={
            "old": old_details,
            "new": build_dashboard_data_source_response(obj),
        },
    )

    db.commit()
    db.refresh(obj)

    return build_dashboard_data_source_response(obj)


@router.delete("/data-sources/{data_source_id}")
def delete_dashboard_data_source(
    data_source_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage Dashboard",
        db,
    )

    obj = (
        db.query(DashboardDataSource)
        .filter(DashboardDataSource.id == data_source_id)
        .first()
    )

    if not obj:
        raise HTTPException(
            status_code=404,
            detail="Dashboard data source not found",
        )

    old_details = build_dashboard_data_source_response(obj)

    create_audit_log(
        db=db,
        module_name="Dashboard",
        action="Delete DashboardDataSource",
        current_user=current_user,
        entity_type="DashboardDataSource",
        entity_id=obj.id,
        entity_label=obj.data_source_code,
        remarks="Dashboard data source deleted",
        request_path=f"/dashboard-data-sources/{data_source_id}",
        details=old_details,
    )

    db.delete(obj)
    db.commit()

    return {"message": "Dashboard data source deleted successfully"}


@router.post("/data-sources/seed")
def seed_dashboard_data_sources_api(
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage Dashboard",
        db,
    )

    current_user_label = get_current_user_display_name(current_user)
    result = seed_dashboard_data_sources(db, current_user_label)

    create_audit_log(
        db=db,
        module_name="Dashboard",
        action="Seed DashboardDataSources",
        current_user=current_user,
        entity_type="DashboardDataSource",
        entity_id=None,
        entity_label="dashboard_data_sources",
        remarks="Dashboard data sources seeded",
        request_path="/dashboard-data-sources/seed",
        details=result,
    )

    db.commit()
    return result


@router.post("/data", response_model=DashboardDataResponse)
def dashboard_data_gateway(
    request: DashboardDataRequest,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "View Dashboard",
        db,
    )

    code = normalize_dashboard_data_source_code(request.data_source_code)
    data_source = (
        db.query(DashboardDataSource)
        .filter(DashboardDataSource.data_source_code == code)
        .first()
    )

    if not data_source:
        raise HTTPException(
            status_code=404,
            detail="Dashboard data source not found",
        )

    if data_source.status != "Active":
        raise HTTPException(
            status_code=400,
            detail="Dashboard data source is not Active",
        )

    allowed_spec = data_source.allowed_params_json if isinstance(data_source.allowed_params_json, dict) else {}
    allowed = allowed_spec.get("allowed") if isinstance(allowed_spec, dict) else None
    if not isinstance(allowed, list):
        raise HTTPException(
            status_code=400,
            detail="Dashboard data source allowed_params_json is invalid",
        )

    params = request.params if isinstance(request.params, dict) else None
    if params is None:
        raise HTTPException(
            status_code=400,
            detail="params must be an object",
        )

    allowed_keys = [
        str(i.get("key")).strip()
        for i in allowed
        if isinstance(i, dict) and i.get("key") is not None and str(i.get("key")).strip() != ""
    ]
    allowed_key_set = set(allowed_keys)

    extra_keys = [k for k in params.keys() if k not in allowed_key_set]
    if extra_keys:
        raise HTTPException(
            status_code=400,
            detail=f"Unexpected params: {', '.join(sorted(extra_keys))}",
        )

    missing_required = []
    resolved = {}
    for item in allowed:
        if not isinstance(item, dict):
            continue
        k = str(item.get("key") or "").strip()
        if k == "":
            continue
        required = bool(item.get("required"))
        if k in params:
            resolved[k] = coerce_dashboard_param_value(item.get("type"), params.get(k), k)
        if required and (k not in resolved or resolved.get(k) in (None, "")):
            missing_required.append(k)

    if missing_required:
        raise HTTPException(
            status_code=400,
            detail=f"Missing required params: {', '.join(missing_required)}",
        )

    handler_key = str(data_source.handler_key or "").strip().upper()
    if handler_key not in VALID_DASHBOARD_HANDLER_KEYS:
        raise HTTPException(
            status_code=400,
            detail="Unsupported handler_key",
        )

    if handler_key == "FSO_OTR":
        rows, totals = build_fso_otr_report(
            db=db,
            location_code=resolved["location_code"],
            fso_asset_code=resolved["fso_asset_code"],
            date_from=resolved["date_from"],
            date_to=resolved["date_to"],
            shuttle_number=resolved.get("shuttle_number"),
        )
        return {
            "data_source_code": code,
            "rows": rows,
            "meta": {
                "totals": totals,
            },
        }

    if handler_key == "FSO_MATERIAL_BALANCE":
        rows = build_fso_material_balance(
            db=db,
            location_code=resolved["location_code"],
            fso_asset_code=resolved["fso_asset_code"],
            date_from=resolved["date_from"],
            date_to=resolved["date_to"],
        )
        return {
            "data_source_code": code,
            "rows": rows,
            "meta": {},
        }

    if handler_key == "FSO_OUTTURN":
        rows, totals, totals_pct = build_fso_outturn_report(
            db=db,
            location_code=resolved["location_code"],
            fso_asset_code=resolved["fso_asset_code"],
            date_from=resolved["date_from"],
            date_to=resolved["date_to"],
        )
        return {
            "data_source_code": code,
            "rows": rows,
            "meta": {
                "totals": totals,
                "totals_pct": totals_pct,
            },
        }

    if handler_key == "SHUTTLE_SUMMARY":
        summary = build_shuttle_summary_rows(
            db=db,
            date_from=resolved.get("date_from"),
            date_to=resolved.get("date_to"),
            location_code=resolved.get("location_code"),
            shuttle_number=resolved.get("shuttle_number"),
            shuttle_asset_code=resolved.get("shuttle_asset_code"),
            tab=resolved.get("tab"),
            search=resolved.get("search"),
            page=resolved.get("page") or 1,
            page_size=resolved.get("page_size") or 20,
        )
        return {
            "data_source_code": code,
            "rows": summary.get("rows") or [],
            "meta": {
                "total_groups": summary.get("total_groups", 0),
                "page": summary.get("page", 1),
                "page_size": summary.get("page_size", 20),
                "has_more": summary.get("has_more", False),
            },
        }

    if handler_key == "ASSET_LIST":
        q = db.query(Asset)

        if resolved.get("location_code"):
            q = q.filter(Asset.location_code == resolved["location_code"])

        if resolved.get("asset_type_code"):
            q = q.filter(Asset.asset_type_code == resolved["asset_type_code"])

        if resolved.get("status"):
            q = q.filter(Asset.status == resolved["status"])

        total_rows = q.count()

        limit = resolved.get("limit") or 500
        if limit < 1:
            limit = 1
        if limit > 5000:
            limit = 5000

        items = q.order_by(Asset.asset_code.asc()).limit(limit).all()

        rows = []
        for a in items:
            rows.append(
                {
                    "asset_code": a.asset_code,
                    "asset_name": a.asset_name,
                    "asset_type_code": a.asset_type_code,
                    "asset_scope": a.asset_scope,
                    "location_code": a.location_code,
                    "status": a.status,
                }
            )

        return {
            "data_source_code": code,
            "rows": rows,
            "meta": {"total_rows": total_rows, "limit": limit},
        }

    if handler_key == "OP_TRANSACTIONS":
        q = db.query(OperationTransaction)

        if resolved.get("location_code"):
            q = q.filter(
                OperationTransaction.origin_location_code == resolved["location_code"]
            )

        if resolved.get("asset_type_code"):
            q = q.filter(
                OperationTransaction.primary_asset_type_code == resolved["asset_type_code"]
            )

        if resolved.get("asset_code"):
            q = q.filter(OperationTransaction.primary_asset_code == resolved["asset_code"])

        if resolved.get("operation_type_code"):
            q = q.filter(
                OperationTransaction.operation_type_code == resolved["operation_type_code"]
            )

        if resolved.get("status"):
            q = q.filter(OperationTransaction.status == resolved["status"])

        if resolved.get("date_from"):
            q = q.filter(OperationTransaction.operation_date >= resolved["date_from"])

        if resolved.get("date_to"):
            q = q.filter(OperationTransaction.operation_date <= resolved["date_to"])

        total_rows = q.count()

        limit = resolved.get("limit") or 200
        if limit < 1:
            limit = 1
        if limit > 2000:
            limit = 2000

        items = (
            q.order_by(
                OperationTransaction.operation_date.desc(),
                OperationTransaction.id.desc(),
            )
            .limit(limit)
            .all()
        )

        rows = []
        for t in items:
            rows.append(
                {
                    "transaction_id": t.id,
                    "ticket_number": t.operation_ticket_number or t.operation_number,
                    "operation_type_code": t.operation_type_code,
                    "asset_code": t.primary_asset_code,
                    "asset_type_code": t.primary_asset_type_code,
                    "location_code": t.origin_location_code,
                    "operation_date": str(t.operation_date) if t.operation_date else None,
                    "status": t.status,
                    "product_name": t.product_name,
                    "remarks": t.remarks,
                }
            )

        return {
            "data_source_code": code,
            "rows": rows,
            "meta": {"total_rows": total_rows, "limit": limit},
        }

    if handler_key == "OP_STATUS_COUNTS":
        q = db.query(
            OperationTransaction.status.label("status"),
            func.count(OperationTransaction.id).label("count"),
        )

        if resolved.get("location_code"):
            q = q.filter(
                OperationTransaction.origin_location_code == resolved["location_code"]
            )

        if resolved.get("asset_type_code"):
            q = q.filter(
                OperationTransaction.primary_asset_type_code == resolved["asset_type_code"]
            )

        if resolved.get("asset_code"):
            q = q.filter(OperationTransaction.primary_asset_code == resolved["asset_code"])

        if resolved.get("operation_type_code"):
            q = q.filter(
                OperationTransaction.operation_type_code == resolved["operation_type_code"]
            )

        if resolved.get("date_from"):
            q = q.filter(OperationTransaction.operation_date >= resolved["date_from"])

        if resolved.get("date_to"):
            q = q.filter(OperationTransaction.operation_date <= resolved["date_to"])

        q = q.group_by(OperationTransaction.status).order_by(
            func.count(OperationTransaction.id).desc()
        )

        rows = [{"status": r.status, "count": int(r.count)} for r in q.all()]

        return {
            "data_source_code": code,
            "rows": rows,
            "meta": {"total_rows": len(rows)},
        }

    if handler_key == "TANK_STOCK_SNAPSHOT":
        location_code = resolved.get("location_code")
        if not location_code:
            raise HTTPException(status_code=400, detail="location_code is required")

        asset_type_code = clean_optional_text(resolved.get("asset_type_code"))
        asset_type_codes_raw = clean_optional_text(resolved.get("asset_type_codes"))
        as_of_date = resolved.get("as_of_date")

        value_field = str(resolved.get("value_field") or "NSV_BBL").strip().upper()

        capacity_source = str(resolved.get("capacity_source") or "CALIBRATION_MAX").strip().upper()

        sort_by = str(resolved.get("sort_by") or "NAME").strip().upper()
        limit = resolved.get("limit") or 200
        if limit < 1:
            limit = 1
        if limit > 2000:
            limit = 2000

        type_list = []
        if asset_type_codes_raw:
            type_list = [t.strip().upper() for t in asset_type_codes_raw.split(",") if t.strip()]
        if asset_type_code:
            type_list = [asset_type_code.strip().upper()]

        aq = db.query(Asset).filter(
            Asset.location_code == location_code,
            Asset.status == "Active",
        )
        if type_list:
            aq = aq.filter(Asset.asset_type_code.in_(type_list))

        assets = aq.order_by(Asset.asset_code.asc()).all()

        if not assets:
            return {
                "data_source_code": code,
                "rows": [],
                "meta": {
                    "total_rows": 0,
                    "limit": limit,
                    "note": "No matching active assets for this location/filter",
                },
            }

        asset_code_list = [a.asset_code for a in assets]

        lq = db.query(TankStockLedger).filter(
            TankStockLedger.location_code == location_code,
            TankStockLedger.tank_asset_code.in_(asset_code_list),
        )

        if as_of_date:
            lq = lq.filter(TankStockLedger.operation_date <= as_of_date)

        latest_sub = (
            lq.with_entities(
                TankStockLedger.tank_asset_code.label("tank_asset_code"),
                func.max(TankStockLedger.id).label("max_id"),
            )
            .group_by(TankStockLedger.tank_asset_code)
            .subquery()
        )

        latest_rows = (
            db.query(TankStockLedger)
            .join(latest_sub, TankStockLedger.id == latest_sub.c.max_id)
            .all()
        )

        ledger_by_code = {r.tank_asset_code: r for r in latest_rows}

        def _safe_num(v):
            try:
                if v is None:
                    return 0.0
                return float(v)
            except Exception:
                return 0.0

        def _get_stock_value(ledger_row: TankStockLedger):
            if not ledger_row:
                return 0.0
            if value_field == "GSV_BBL":
                return _safe_num(getattr(ledger_row, "stock_gsv_bbl", 0))
            if value_field == "LT":
                return _safe_num(getattr(ledger_row, "stock_lt", 0))
            if value_field == "MT":
                return _safe_num(getattr(ledger_row, "stock_mt", 0))
            return _safe_num(getattr(ledger_row, "stock_nsv_bbl", 0))

        def _capacity_from_calibration(asset_code: str):
            tables = (
                db.query(AssetCalibrationTable)
                .filter(
                    AssetCalibrationTable.asset_code == asset_code,
                    AssetCalibrationTable.status == "Active",
                )
                .order_by(AssetCalibrationTable.id.desc())
                .all()
            )
            if not tables:
                return 0.0, None

            for t in tables:
                out_cols = (
                    db.query(CalibrationTemplateColumn)
                    .filter(
                        CalibrationTemplateColumn.template_id == t.template_id,
                        CalibrationTemplateColumn.interpolation_role == "Output",
                    )
                    .order_by(
                        CalibrationTemplateColumn.sort_order.asc(),
                        CalibrationTemplateColumn.id.asc(),
                    )
                    .all()
                )
                if not out_cols:
                    continue

                output_key = str(out_cols[0].column_name or "").strip()
                if not output_key:
                    continue

                rows = (
                    db.query(AssetCalibrationData)
                    .filter(AssetCalibrationData.calibration_table_id == t.id)
                    .order_by(AssetCalibrationData.row_number.asc())
                    .all()
                )
                max_val = 0.0
                for r in rows:
                    data = r.row_data if isinstance(r.row_data, dict) else {}
                    val = data.get(output_key)
                    max_val = max(max_val, _safe_num(val))

                if max_val > 0:
                    return max_val, output_key

            return 0.0, None

        rows = []
        for a in assets:
            ledger = ledger_by_code.get(a.asset_code)
            stock_val = _get_stock_value(ledger)

            capacity_val = 0.0
            capacity_key = None

            if capacity_source == "CALIBRATION_MAX":
                capacity_val, capacity_key = _capacity_from_calibration(a.asset_code)

            fill_percent = 0.0
            empty_val = 0.0
            if capacity_val and capacity_val > 0:
                fill_percent = (stock_val / capacity_val) * 100.0
                empty_val = max(capacity_val - stock_val, 0.0)

            rows.append(
                {
                    "tank_asset_code": a.asset_code,
                    "tank_asset_name": a.asset_name,
                    "asset_type_code": a.asset_type_code,
                    "location_code": a.location_code,
                    "as_of_date": str(as_of_date) if as_of_date else None,
                    "value_field": value_field,
                    "stock_value": float(stock_val),
                    "capacity_source": capacity_source,
                    "capacity_value": float(capacity_val),
                    "capacity_output_column": capacity_key,
                    "fill_percent": float(fill_percent),
                    "empty_value": float(empty_val),
                }
            )

        if sort_by == "FILL_PERCENT":
            rows.sort(key=lambda x: x.get("fill_percent", 0.0), reverse=True)
        elif sort_by == "STOCK_VALUE":
            rows.sort(key=lambda x: x.get("stock_value", 0.0), reverse=True)
        else:
            rows.sort(key=lambda x: (x.get("tank_asset_name") or "", x.get("tank_asset_code") or ""))

        rows = rows[:limit]

        return {
            "data_source_code": code,
            "rows": rows,
            "meta": {
                "total_rows": len(rows),
                "limit": limit,
                "capacity_source": capacity_source,
                "value_field": value_field,
                "sort_by": sort_by,
            },
        }

    return {
        "data_source_code": code,
        "rows": [],
        "meta": {"note": "not implemented"},
    }
