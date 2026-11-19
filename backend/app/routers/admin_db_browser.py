from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import MetaData, Table, func, inspect, select
from sqlalchemy.orm import Session
import re

from app.utils.errors import commit_or_409
from app.database import engine, get_db
from app.models import User
from app.dependencies.auth import get_current_user_from_token
from app.dependencies.permissions import require_user_permission
from app.services.audit_service import create_audit_log

router = APIRouter(prefix="/admin/db", tags=["Admin DB Browser"])

# Known table names from the models — acts as allowlist
KNOWN_TABLES = {
    "users", "auth_login_challenges", "auth_sessions", "password_reset_requests",
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
    "report_definitions", "report_access_grants", "report_definition_versions",
    "book_stock_products", "book_stock_fields", "book_stock_field_products",
    "book_stock_daily_entries", "book_stock_field_productions", "book_stock_configs",
    "book_stock_sub_fields", "book_stock_field_stocks", "book_stock_sub_field_productions",
    "assistant_memory", "assistant_conversations",
    "entry_check_reviews", "asset_metric_profiles",
}

# Explicitly classified secret-bearing fields plus a conservative fallback for
# future schema columns. Keep safe password-policy metadata visible.
SENSITIVE_COLUMNS: dict[str, set[str]] = {
    "users": {
        "password_hash", "password_history_json", "totp_secret_encrypted",
        "backup_codes_hash_json", "mfa_secret", "otp_secret", "session_id",
    },
    "token_blacklist": {"token_hash"},
    "auth_sessions": {"session_id", "refresh_token", "access_token", "token_hash"},
    "auth_login_challenges": {"token_hash", "challenge_hash", "challenge_id", "totp_secret", "backup_codes_hash_json"},
    "password_reset_requests": {"token_hash", "reset_token", "token"},
}
SAFE_PASSWORD_METADATA = {
    "password_changed_at", "password_expiry_days", "password_never_expires",
    "force_password_change",
}
SENSITIVE_STEMS = re.compile(
    r"(^password|secret|totp|(^|_)otp($|_)|token|_hash$|^passphrase$|"
    r"^api_key$|^private_key$|^encrypted_key$|^session_id$|cookie)",
    re.IGNORECASE,
)


def _get_table_columns(table_name: str) -> list[str]:
    """Get column names for a table using SQLAlchemy inspect."""
    inspector = inspect(engine)
    columns = inspector.get_columns(table_name)
    return [col["name"] for col in columns]


def _reflected_table(table_name: str) -> Table:
    if table_name not in KNOWN_TABLES:
        raise HTTPException(status_code=404, detail=f"Unknown table: {table_name}")
    inspector = inspect(engine)
    if table_name not in set(inspector.get_table_names()):
        raise HTTPException(status_code=404, detail=f"Table does not exist: {table_name}")
    return Table(table_name, MetaData(), autoload_with=engine)


def _is_sensitive_column(col_name: str, table_name: str | None = None) -> bool:
    normalized = col_name.casefold()
    if normalized in SAFE_PASSWORD_METADATA:
        return False
    if table_name and normalized in {name.casefold() for name in SENSITIVE_COLUMNS.get(table_name, set())}:
        return True
    return bool(SENSITIVE_STEMS.search(normalized))


def _redact_row(row: dict, columns: list[str], table_name: str) -> dict:
    """Return visible values while preserving the schema's column ordering."""
    return {
        col: "*** REDACTED ***" if _is_sensitive_column(col, table_name) else row.get(col)
        for col in columns
    }


@router.get("/tables")
def list_tables(
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    """Return all known tables with column info and row count."""
    require_user_permission(current_user, "View Database Browser", db)

    inspector = inspect(engine)
    actual_tables = set(inspector.get_table_names())
    available = sorted(KNOWN_TABLES & actual_tables)

    result = []
    for table_name in available:
        columns = _get_table_columns(table_name)
        try:
            table = _reflected_table(table_name)
            count = db.execute(select(func.count()).select_from(table)).scalar()
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
    require_user_permission(current_user, "View Database Browser", db)

    if table_name not in KNOWN_TABLES:
        raise HTTPException(status_code=404, detail=f"Unknown table: {table_name}")

    table = _reflected_table(table_name)
    columns = [column.name for column in table.columns]
    offset = (page - 1) * per_page

    try:
        safe_columns = [column for column in table.columns if not _is_sensitive_column(column.name, table_name)]
        query = select(*safe_columns).limit(per_page).offset(offset)
        first_safe_column = safe_columns[0] if safe_columns else None
        if first_safe_column is not None:
            query = query.order_by(first_safe_column.asc())
        rows = db.execute(query).mappings().all()
        total = db.execute(select(func.count()).select_from(table)).scalar()
    except Exception:
        create_audit_log(
            db=db,
            module_name="System Settings",
            action="Database Browser Read Failed",
            current_user=current_user,
            entity_type="DatabaseTable",
            entity_label=table_name,
            remarks="Table read failed",
            request_path=f"/admin/db/tables/{table_name}",
            details={"table_name": table_name},
        )
        commit_or_409(db)
        raise HTTPException(status_code=500, detail="Unable to read the requested table")

    data = [_redact_row(dict(row), columns, table_name) for row in rows]

    # Reading raw tables is a privileged diagnostic action: record who read
    # what, without copying row contents into the audit log.
    create_audit_log(
        db=db,
        module_name="System Settings",
        action="Browse Database Table",
        current_user=current_user,
        entity_type="DatabaseTable",
        entity_label=table_name,
        remarks="Administrator browsed a database table",
        request_path=f"/admin/db/tables/{table_name}",
        details={
            "table_name": table_name,
            "page": page,
            "per_page": per_page,
            "returned_rows": len(data),
            "total_rows": total,
            "sensitive_columns_redacted": [c for c in columns if _is_sensitive_column(c, table_name)],
        },
    )
    commit_or_409(db)

    return {
        "table_name": table_name,
        "columns": columns,
        "data": data,
        "page": page,
        "per_page": per_page,
        "total": total,
        "total_pages": max(1, (total + per_page - 1) // per_page),
    }
