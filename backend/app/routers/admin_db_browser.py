from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import inspect, text
from sqlalchemy.orm import Session
import re

from app.database import engine, get_db
from app.models import User
from app.dependencies.auth import get_current_user_from_token
from app.dependencies.permissions import is_admin_user

router = APIRouter(prefix="/admin/db", tags=["Admin DB Browser"])

# Known table names from the models — acts as allowlist
KNOWN_TABLES = {
    "users", "auth_login_challenges", "password_reset_requests",
    "operation_transaction_values", "operation_transaction_status_history",
    "audit_logs", "roles", "permissions", "role_permissions", "user_roles",
    "user_locations", "system_notifications", "system_notification_receipts",
    "backup_settings", "backup_jobs", "backup_restore_requests",
    "backup_restore_validations", "operation_workflow_policies",
    "operation_workflow_policy_roles", "operation_workflow_policy_users",
    "operation_tasks", "operation_task_events",
    "locations", "location_accounting_day_settings",
    "asset_types", "assets", "calibration_templates",
    "calibration_template_columns", "asset_calibration_tables",
    "asset_calibration_data", "asset_assignments", "prime_mover_tanker_links",
    "operation_types", "tank_operations", "tank_stock_ledger",
    "location_operation_availability", "operation_templates",
    "operation_template_fields", "operation_template_layouts",
    "operation_template_layout_sections", "operation_template_layout_items",
    "tanker_receipt_acknowledgements", "operation_transactions",
    "approved_transaction_correction_requests", "material_balance_templates",
    "material_balance_template_columns", "table11_factors",
    "trips", "trip_events", "trip_comparisons",
    "company_report_profiles", "dashboard_configs", "dashboard_versions",
    "dashboard_data_sources", "barge_seal_master",
    "flowmeter_configs", "flowmeter_records", "flowmeter_config_history",
    "vessel_operations", "vessel_stock_ledger",
    "movement_mappings", "movement_mapping_items", "movement_mapping_comparisons",
    "shuttle_voyages", "fso_voyages", "token_blacklist",
    "export_locations", "export_entities", "export_location_entities",
    "export_entity_blocks", "export_blocks", "export_permits",
    "export_transactions", "export_permit_block_assignments",
    "export_consignees", "export_configs",
}

# Column names whose values should be redacted
SENSITIVE_COLUMN_PATTERNS = re.compile(
    r"^(password|password_hash|totp_secret|totp_secret_encrypted|backup_codes|backup_codes_hash_json"
    r"|mfa_secret|otp_secret|refresh_token|access_token|auth_token|api_key|secret_key"
    r"|private_key|encrypted_key|passphrase)$",
    re.IGNORECASE,
)


def _get_table_columns(table_name: str) -> list[str]:
    """Get column names for a table using SQLAlchemy inspect."""
    inspector = inspect(engine)
    columns = inspector.get_columns(table_name)
    return [col["name"] for col in columns]


def _is_sensitive_column(col_name: str) -> bool:
    return bool(SENSITIVE_COLUMN_PATTERNS.match(col_name))


def _redact_row(row: dict, columns: list[str]) -> dict:
    """Return a copy of row with sensitive column values replaced."""
    out = {}
    for col in columns:
        if _is_sensitive_column(col):
            out[col] = "*** REDACTED ***"
        else:
            out[col] = row.get(col)
    return out


@router.get("/tables")
def list_tables(
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    """Return all known tables with column info and row count."""
    if not is_admin_user(current_user, db):
        raise HTTPException(status_code=403, detail="Admin access required")

    inspector = inspect(engine)
    actual_tables = set(inspector.get_table_names())
    available = sorted(KNOWN_TABLES & actual_tables)

    result = []
    for table_name in available:
        columns = _get_table_columns(table_name)
        try:
            count = db.execute(text(f"SELECT COUNT(*) FROM \"{table_name}\"")).scalar()
        except Exception:
            count = -1
        result.append({
            "table_name": table_name,
            "columns": columns,
            "row_count": count,
        })

    return result


@router.get("/tables/{table_name}")
def get_table_data(
    table_name: str,
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=500),
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    """Return paginated data for a specific table."""
    if not is_admin_user(current_user, db):
        raise HTTPException(status_code=403, detail="Admin access required")

    if table_name not in KNOWN_TABLES:
        raise HTTPException(status_code=404, detail=f"Unknown table: {table_name}")

    inspector = inspect(engine)
    actual_tables = set(inspector.get_table_names())
    if table_name not in actual_tables:
        raise HTTPException(status_code=404, detail=f"Table does not exist: {table_name}")

    columns = _get_table_columns(table_name)
    offset = (page - 1) * per_page

    try:
        rows = db.execute(
            text(f"SELECT * FROM \"{table_name}\" ORDER BY 1 ASC LIMIT :limit OFFSET :offset"),
            {"limit": per_page, "offset": offset},
        ).mappings().all()

        total = db.execute(text(f"SELECT COUNT(*) FROM \"{table_name}\"")).scalar()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    data = [_redact_row(dict(row), columns) for row in rows]

    return {
        "table_name": table_name,
        "columns": columns,
        "data": data,
        "page": page,
        "per_page": per_page,
        "total": total,
        "total_pages": max(1, (total + per_page - 1) // per_page),
    }
