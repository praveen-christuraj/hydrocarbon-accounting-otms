from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from app.database import engine, SessionLocal
from app.models import (
    OperationType,
    OperationTemplate,
    OperationTemplateField,
    Permission,
)
from app.utils.default_permissions import STANDARD_PERMISSIONS


def ensure_user_security_columns():
    inspector = inspect(engine)
    if "users" not in inspector.get_table_names():
        return

    cols = {c["name"] for c in inspector.get_columns("users")}
    column_sql = {
        "password_changed_at": "ALTER TABLE users ADD COLUMN password_changed_at TIMESTAMP;",
        "force_password_change": "ALTER TABLE users ADD COLUMN force_password_change VARCHAR(20) DEFAULT 'No';",
        "password_never_expires": "ALTER TABLE users ADD COLUMN password_never_expires VARCHAR(20) DEFAULT 'No';",
        "password_expiry_days": "ALTER TABLE users ADD COLUMN password_expiry_days INTEGER DEFAULT 30;",
        "failed_login_count": "ALTER TABLE users ADD COLUMN failed_login_count INTEGER DEFAULT 0;",
        "locked_until": "ALTER TABLE users ADD COLUMN locked_until TIMESTAMP;",
        "last_login_at": "ALTER TABLE users ADD COLUMN last_login_at TIMESTAMP;",
        "last_login_ip": "ALTER TABLE users ADD COLUMN last_login_ip VARCHAR(80);",
        "totp_enabled": "ALTER TABLE users ADD COLUMN totp_enabled VARCHAR(20) DEFAULT 'No';",
        "totp_secret_encrypted": "ALTER TABLE users ADD COLUMN totp_secret_encrypted TEXT;",
        "totp_confirmed_at": "ALTER TABLE users ADD COLUMN totp_confirmed_at TIMESTAMP;",
        "force_2fa": "ALTER TABLE users ADD COLUMN force_2fa VARCHAR(20) DEFAULT 'No';",
        "backup_codes_hash_json": "ALTER TABLE users ADD COLUMN backup_codes_hash_json JSONB;",
    }

    with engine.begin() as connection:
        for col_name, sql in column_sql.items():
            if col_name not in cols:
                connection.execute(text(sql))
        connection.execute(text("UPDATE users SET force_password_change = 'No' WHERE force_password_change IS NULL;"))
        connection.execute(text("UPDATE users SET password_never_expires = 'No' WHERE password_never_expires IS NULL;"))
        connection.execute(text("UPDATE users SET password_expiry_days = 30 WHERE password_expiry_days IS NULL;"))
        connection.execute(text("UPDATE users SET failed_login_count = 0 WHERE failed_login_count IS NULL;"))
        connection.execute(text("UPDATE users SET totp_enabled = 'No' WHERE totp_enabled IS NULL;"))
        connection.execute(text("UPDATE users SET force_2fa = 'No' WHERE force_2fa IS NULL;"))


def ensure_operation_ticket_number_column():
    with engine.begin() as connection:
        connection.execute(
            text(
                """
                ALTER TABLE operation_transactions
                ADD COLUMN IF NOT EXISTS operation_ticket_number VARCHAR(100);
                """
            )
        )

        connection.execute(
            text(
                """
                CREATE UNIQUE INDEX IF NOT EXISTS
                ix_operation_transactions_operation_ticket_number
                ON operation_transactions(operation_ticket_number)
                WHERE operation_ticket_number IS NOT NULL;
                """
            )
        )

        connection.execute(
            text(
                """
                ALTER TABLE operation_templates
                ADD COLUMN IF NOT EXISTS entry_layout_type VARCHAR(80);
                """
            )
        )

        connection.execute(
            text(
                """
                ALTER TABLE operation_templates
                ADD COLUMN IF NOT EXISTS calculation_engine VARCHAR(100);
                """
            )
        )

        connection.execute(
            text(
                """
                UPDATE operation_templates
                SET entry_layout_type = 'Standard Form'
                WHERE entry_layout_type IS NULL OR TRIM(entry_layout_type) = '';
                """
            )
        )

        connection.execute(
            text(
                """
                UPDATE operation_templates
                SET calculation_engine = 'None'
                WHERE calculation_engine IS NULL OR TRIM(calculation_engine) = '';
                """
            )
        )

        connection.execute(
            text(
                """
                ALTER TABLE operation_templates
                ALTER COLUMN entry_layout_type SET DEFAULT 'Standard Form';
                """
            )
        )

        connection.execute(
            text(
                """
                ALTER TABLE operation_templates
                ALTER COLUMN calculation_engine SET DEFAULT 'None';
                """
            )
        )


def ensure_tank_stock_ledger_accounting_columns():
    with engine.begin() as connection:
        connection.execute(
            text(
                """
                ALTER TABLE tank_stock_ledger
                ADD COLUMN IF NOT EXISTS accounting_date DATE;
                """
            )
        )

        connection.execute(
            text(
                """
                ALTER TABLE tank_stock_ledger
                ADD COLUMN IF NOT EXISTS accounting_day_start TIMESTAMP;
                """
            )
        )

        connection.execute(
            text(
                """
                ALTER TABLE tank_stock_ledger
                ADD COLUMN IF NOT EXISTS accounting_day_end TIMESTAMP;
                """
            )
        )

        connection.execute(
            text(
                """
                ALTER TABLE tank_stock_ledger
                ADD COLUMN IF NOT EXISTS accounting_day_setting_id INTEGER;
                """
            )
        )


def ensure_tank_stock_ledger_stock_snapshot_columns():
    with engine.begin() as connection:
        connection.execute(
            text(
                """
                ALTER TABLE tank_stock_ledger
                ADD COLUMN IF NOT EXISTS stock_gsv_bbl DOUBLE PRECISION DEFAULT 0;
                """
            )
        )

        connection.execute(
            text(
                """
                ALTER TABLE tank_stock_ledger
                ADD COLUMN IF NOT EXISTS stock_nsv_bbl DOUBLE PRECISION DEFAULT 0;
                """
            )
        )

        connection.execute(
            text(
                """
                ALTER TABLE tank_stock_ledger
                ADD COLUMN IF NOT EXISTS stock_lt DOUBLE PRECISION DEFAULT 0;
                """
            )
        )

        connection.execute(
            text(
                """
                ALTER TABLE tank_stock_ledger
                ADD COLUMN IF NOT EXISTS stock_mt DOUBLE PRECISION DEFAULT 0;
                """
            )
        )

        connection.execute(
            text(
                """
                ALTER TABLE tank_stock_ledger
                ADD COLUMN IF NOT EXISTS previous_stock_gsv_bbl DOUBLE PRECISION DEFAULT 0;
                """
            )
        )

        connection.execute(
            text(
                """
                ALTER TABLE tank_stock_ledger
                ADD COLUMN IF NOT EXISTS previous_stock_nsv_bbl DOUBLE PRECISION DEFAULT 0;
                """
            )
        )

        connection.execute(
            text(
                """
                ALTER TABLE tank_stock_ledger
                ADD COLUMN IF NOT EXISTS previous_stock_lt DOUBLE PRECISION DEFAULT 0;
                """
            )
        )

        connection.execute(
            text(
                """
                ALTER TABLE tank_stock_ledger
                ADD COLUMN IF NOT EXISTS previous_stock_mt DOUBLE PRECISION DEFAULT 0;
                """
            )
        )


def ensure_tanker_acknowledgement_closure_columns():
    inspector = inspect(engine)

    if "tanker_receipt_acknowledgements" not in inspector.get_table_names():
        return

    columns = {
        column["name"]
        for column in inspector.get_columns("tanker_receipt_acknowledgements")
    }

    with engine.begin() as connection:
        if "closed_by" not in columns:
            connection.execute(
                text(
                    "ALTER TABLE tanker_receipt_acknowledgements "
                    "ADD COLUMN closed_by VARCHAR(150)"
                )
            )

        if "closed_at" not in columns:
            connection.execute(
                text(
                    "ALTER TABLE tanker_receipt_acknowledgements "
                    "ADD COLUMN closed_at TIMESTAMP"
                )
            )

        if "closure_remarks" not in columns:
            connection.execute(
                text(
                    "ALTER TABLE tanker_receipt_acknowledgements "
                    "ADD COLUMN closure_remarks TEXT"
                )
            )


def ensure_vessel_operation_show_in_column():
    inspector = inspect(engine)

    if "vessel_operations" not in inspector.get_table_names():
        return

    cols = {c["name"] for c in inspector.get_columns("vessel_operations")}
    if "show_in" in cols:
        return

    with engine.begin() as conn:
        conn.execute(
            text(
                "ALTER TABLE vessel_operations ADD COLUMN show_in VARCHAR(20) DEFAULT 'Both';"
            )
        )
        conn.execute(
            text(
                "UPDATE vessel_operations SET show_in = 'Both' "
                "WHERE show_in IS NULL OR TRIM(show_in) = '';"
            )
        )


def ensure_flowmeter_stream_columns():
    inspector = inspect(engine)

    table_names = inspector.get_table_names()

    if "flowmeter_configs" in table_names:
        cols = {c["name"] for c in inspector.get_columns("flowmeter_configs")}
        with engine.begin() as conn:
            if "stream_name" not in cols:
                conn.execute(
                    text(
                        "ALTER TABLE flowmeter_configs "
                        "ADD COLUMN stream_name VARCHAR(150) DEFAULT 'Default';"
                    )
                )
                conn.execute(
                    text(
                        "UPDATE flowmeter_configs SET stream_name = 'Default' "
                        "WHERE stream_name IS NULL OR TRIM(stream_name) = '';"
                    )
                )
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_flowmeter_configs_stream_name "
                    "ON flowmeter_configs(stream_name);"
                )
            )
            if "meter_asset_code" not in cols:
                conn.execute(
                    text(
                        "ALTER TABLE flowmeter_configs "
                        "ADD COLUMN meter_asset_code VARCHAR(80);"
                    )
                )
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_flowmeter_configs_meter_asset_code "
                    "ON flowmeter_configs(meter_asset_code);"
                )
            )
            if "calibration_date" not in cols:
                conn.execute(
                    text(
                        "ALTER TABLE flowmeter_configs "
                        "ADD COLUMN calibration_date DATE;"
                    )
                )

    if "flowmeter_config_history" in table_names:
        cols = {c["name"] for c in inspector.get_columns("flowmeter_config_history")}
        with engine.begin() as conn:
            if "stream_name" not in cols:
                conn.execute(
                    text(
                        "ALTER TABLE flowmeter_config_history "
                        "ADD COLUMN stream_name VARCHAR(150) DEFAULT 'Default';"
                    )
                )
                conn.execute(
                    text(
                        "UPDATE flowmeter_config_history SET stream_name = 'Default' "
                        "WHERE stream_name IS NULL OR TRIM(stream_name) = '';"
                    )
                )
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_flowmeter_config_history_stream_name "
                    "ON flowmeter_config_history(stream_name);"
                )
            )
            if "meter_asset_code" not in cols:
                conn.execute(
                    text(
                        "ALTER TABLE flowmeter_config_history "
                        "ADD COLUMN meter_asset_code VARCHAR(80);"
                    )
                )
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_flowmeter_config_history_meter_asset_code "
                    "ON flowmeter_config_history(meter_asset_code);"
                )
            )
            if "old_calibration_date" not in cols:
                conn.execute(
                    text(
                        "ALTER TABLE flowmeter_config_history "
                        "ADD COLUMN old_calibration_date DATE;"
                    )
                )
            if "new_calibration_date" not in cols:
                conn.execute(
                    text(
                        "ALTER TABLE flowmeter_config_history "
                        "ADD COLUMN new_calibration_date DATE;"
                    )
                )


def ensure_barge_event_type_template_field():
    from app.database import engine as _engine
    db = Session(bind=_engine)
    try:
        barge_op_codes = [
            x.operation_type_code
            for x in db.query(OperationType)
            .filter(
                OperationType.applicable_asset_type_code == "BARGE",
                OperationType.status == "Active",
            )
            .all()
        ]

        if not barge_op_codes:
            return

        barge_templates = (
            db.query(OperationTemplate)
            .filter(
                OperationTemplate.entry_layout_type == "Multi-Tank Before/After",
                OperationTemplate.status == "Active",
                OperationTemplate.operation_type_code.in_(barge_op_codes),
            )
            .all()
        )

        for t in barge_templates:
            exists = (
                db.query(OperationTemplateField)
                .filter(
                    OperationTemplateField.template_id == t.id,
                    OperationTemplateField.field_code == "barge_event_type",
                )
                .first()
            )

            if exists:
                continue

            db.add(
                OperationTemplateField(
                    template_id=t.id,
                    field_name="Barge Movement Stage",
                    field_code="barge_event_type",
                    field_group="Barge Tracking",
                    data_type="Text",
                    unit=None,
                    is_required="No",
                    input_mode="Manual",
                    calculation_role="Input",
                    sort_order=0,
                    status="Active",
                )
            )

        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def ensure_operation_workflow_policy_tables():
    with engine.begin() as connection:
        connection.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS operation_workflow_policies (
                    id SERIAL PRIMARY KEY,
                    policy_name VARCHAR(150) NOT NULL,
                    action_code VARCHAR(60) NOT NULL,
                    operation_type_code VARCHAR(50),
                    operation_template_id INTEGER,
                    asset_type_code VARCHAR(50),
                    location_code VARCHAR(50),
                    priority INTEGER NOT NULL DEFAULT 100,
                    status VARCHAR(20) NOT NULL DEFAULT 'Active',
                    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
                );
                """
            )
        )
        connection.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS operation_workflow_policy_roles (
                    id SERIAL PRIMARY KEY,
                    policy_id INTEGER NOT NULL REFERENCES operation_workflow_policies(id) ON DELETE CASCADE,
                    role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
                    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                    CONSTRAINT uq_operation_workflow_policy_role UNIQUE (policy_id, role_id)
                );
                """
            )
        )
        connection.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS operation_workflow_policy_users (
                    id SERIAL PRIMARY KEY,
                    policy_id INTEGER NOT NULL REFERENCES operation_workflow_policies(id) ON DELETE CASCADE,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    mode VARCHAR(20) NOT NULL DEFAULT 'ALLOW',
                    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                    CONSTRAINT uq_operation_workflow_policy_user UNIQUE (policy_id, user_id)
                );
                """
            )
        )
        connection.commit()


def ensure_operation_task_tables():
    with engine.begin() as connection:
        connection.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS operation_tasks (
                    id SERIAL PRIMARY KEY,
                    task_number VARCHAR(120) NOT NULL UNIQUE,
                    task_type VARCHAR(80) NOT NULL DEFAULT 'OPERATION_APPROVAL',
                    transaction_id INTEGER REFERENCES operation_transactions(id) ON DELETE CASCADE,
                    ticket_number VARCHAR(120),
                    operation_number VARCHAR(120),
                    operation_type_code VARCHAR(50),
                    operation_template_id INTEGER,
                    asset_type_code VARCHAR(50),
                    primary_asset_code VARCHAR(80),
                    location_code VARCHAR(50),
                    raised_by_user_id INTEGER REFERENCES users(id),
                    assigned_policy_id INTEGER REFERENCES operation_workflow_policies(id),
                    assigned_role_ids_json JSONB,
                    assigned_user_ids_json JSONB,
                    status VARCHAR(30) NOT NULL DEFAULT 'Pending',
                    priority VARCHAR(30) NOT NULL DEFAULT 'Normal',
                    due_at TIMESTAMP,
                    taken_by_user_id INTEGER REFERENCES users(id),
                    taken_at TIMESTAMP,
                    acted_by_user_id INTEGER REFERENCES users(id),
                    acted_at TIMESTAMP,
                    action_taken VARCHAR(50),
                    remarks TEXT,
                    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
                );
                """
            )
        )
        connection.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS operation_task_events (
                    id SERIAL PRIMARY KEY,
                    task_id INTEGER NOT NULL REFERENCES operation_tasks(id) ON DELETE CASCADE,
                    event_type VARCHAR(80) NOT NULL,
                    old_status VARCHAR(30),
                    new_status VARCHAR(30),
                    actor_user_id INTEGER REFERENCES users(id),
                    actor_display VARCHAR(150),
                    notes TEXT,
                    details JSONB,
                    created_at TIMESTAMP NOT NULL DEFAULT NOW()
                );
                """
            )
        )
        connection.execute(
            text(
                """
                ALTER TABLE operation_tasks
                ALTER COLUMN transaction_id DROP NOT NULL;
                """
            )
        )
        connection.execute(
            text(
                """
                CREATE INDEX IF NOT EXISTS ix_operation_tasks_user_lookup
                ON operation_tasks(status, task_type, location_code, operation_type_code);
                """
            )
        )
        connection.execute(
            text(
                """
                CREATE UNIQUE INDEX IF NOT EXISTS uq_operation_tasks_active_approval
                ON operation_tasks(transaction_id)
                WHERE task_type = 'OPERATION_APPROVAL' AND status IN ('Pending', 'In Progress');
                """
            )
        )


def ensure_operation_template_layout_columns():
    with engine.begin() as connection:
        connection.execute(
            text("""
                CREATE TABLE IF NOT EXISTS operation_template_layouts (
                    id SERIAL PRIMARY KEY,
                    template_id INTEGER NOT NULL REFERENCES operation_templates(id) ON DELETE CASCADE,
                    layout_name VARCHAR(150) NOT NULL,
                    version_no INTEGER NOT NULL DEFAULT 1,
                    status VARCHAR(20) NOT NULL DEFAULT 'Draft',
                    is_default VARCHAR(10) NOT NULL DEFAULT 'No',
                    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
                    CONSTRAINT unique_operation_template_layout_version
                        UNIQUE (template_id, layout_name, version_no)
                );
            """)
        )
        connection.execute(
            text("""
                CREATE TABLE IF NOT EXISTS operation_template_layout_sections (
                    id SERIAL PRIMARY KEY,
                    layout_id INTEGER NOT NULL REFERENCES operation_template_layouts(id) ON DELETE CASCADE,
                    section_key VARCHAR(120) NOT NULL,
                    title VARCHAR(150) NOT NULL,
                    sort_order INTEGER NOT NULL DEFAULT 1,
                    collapsible VARCHAR(10) NOT NULL DEFAULT 'No',
                    default_open VARCHAR(10) NOT NULL DEFAULT 'Yes',
                    visibility_rule_json JSONB,
                    CONSTRAINT unique_operation_template_layout_section_key
                        UNIQUE (layout_id, section_key)
                );
            """)
        )
        connection.execute(
            text("""
                CREATE TABLE IF NOT EXISTS operation_template_layout_items (
                    id SERIAL PRIMARY KEY,
                    layout_id INTEGER NOT NULL REFERENCES operation_template_layouts(id) ON DELETE CASCADE,
                    section_id INTEGER NOT NULL REFERENCES operation_template_layout_sections(id) ON DELETE CASCADE,
                    field_id INTEGER NOT NULL REFERENCES operation_template_fields(id) ON DELETE CASCADE,
                    row_no INTEGER NOT NULL DEFAULT 1,
                    col_start INTEGER NOT NULL DEFAULT 1,
                    col_span INTEGER NOT NULL DEFAULT 1,
                    sort_order INTEGER NOT NULL DEFAULT 1,
                    label_override VARCHAR(150),
                    placeholder_override VARCHAR(150),
                    read_only_override VARCHAR(10),
                    width_mode VARCHAR(30),
                    rule_json JSONB,
                    CONSTRAINT unique_operation_template_layout_field_placement
                        UNIQUE (layout_id, field_id)
                );
            """)
        )
        connection.execute(
            text("""
                CREATE INDEX IF NOT EXISTS ix_operation_template_layouts_template_id
                ON operation_template_layouts(template_id);
            """)
        )
        connection.execute(
            text("""
                CREATE INDEX IF NOT EXISTS ix_operation_template_layout_sections_layout_id
                ON operation_template_layout_sections(layout_id);
            """)
        )
        connection.execute(
            text("""
                CREATE INDEX IF NOT EXISTS ix_operation_template_layout_items_layout_id
                ON operation_template_layout_items(layout_id);
            """)
        )
        connection.execute(
            text("""
                CREATE INDEX IF NOT EXISTS ix_operation_template_layout_items_section_id
                ON operation_template_layout_items(section_id);
            """)
        )
        connection.execute(
            text("""
                CREATE INDEX IF NOT EXISTS ix_operation_template_layout_items_field_id
                ON operation_template_layout_items(field_id);
            """)
        )


def seed_default_permissions():
    db = SessionLocal()
    try:
        created_count = 0
        existing_count = 0
        for permission_data in STANDARD_PERMISSIONS:
            existing = (
                db.query(Permission)
                .filter(
                    Permission.permission_name.ilike(permission_data["permission_name"]),
                    Permission.module_name.ilike(permission_data["module_name"]),
                )
                .first()
            )
            if existing:
                existing_count += 1
                continue
            db.add(Permission(
                permission_name=permission_data["permission_name"],
                module_name=permission_data["module_name"],
                description=permission_data["description"],
                status="Active",
            ))
            created_count += 1
        db.commit()
        if created_count:
            print(f"Seeded {created_count} default permissions ({existing_count} already existed)")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def migrate_boolean_columns():
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())

    # Map of table -> list of (column, temp_default_if_missing)
    boolean_columns = {
        "users": [
            ("force_password_change", "No"),
            ("password_never_expires", "No"),
            ("totp_enabled", "No"),
            ("force_2fa", "No"),
            ("is_active", "Yes"),
        ],
        "assets": [
            ("is_active", "Yes"),
        ],
        "barges": [
            ("is_active", "Yes"),
        ],
        "tanks": [
            ("is_active", "Yes"),
        ],
        "vessels": [
            ("is_active", "Yes"),
        ],
        "shuttles": [
            ("is_active", "Yes"),
        ],
        "fso": [
            ("is_active", "Yes"),
        ],
        "locations": [
            ("is_active", "Yes"),
        ],
        "asset_types": [
            ("is_active", "Yes"),
        ],
        "roles": [
            ("is_active", "Yes"),
        ],
    }

    with engine.begin() as conn:
        for table_name, columns in boolean_columns.items():
            if table_name not in existing_tables:
                continue

            table_cols = {c["name"] for c in inspector.get_columns(table_name)}
            for col_name, default_val in columns:
                if col_name not in table_cols:
                    continue

                col_type = str(
                    [c["type"] for c in inspector.get_columns(table_name) if c["name"] == col_name][0]
                )
                if "BOOLEAN" in col_type.upper():
                    continue

                conn.execute(text(
                    f'UPDATE {table_name} SET {col_name} = \'Yes\' '
                    f'WHERE {col_name} NOT IN (\'Yes\', \'No\') OR {col_name} IS NULL;'
                ))
                conn.execute(text(
                    f'ALTER TABLE {table_name} ALTER COLUMN {col_name} '
                    f'DROP DEFAULT;'
                ))
                conn.execute(text(
                    f'ALTER TABLE {table_name} ALTER COLUMN {col_name} '
                    f'TYPE BOOLEAN USING (CASE WHEN {col_name} = \'Yes\' THEN TRUE ELSE FALSE END);'
                ))
                conn.execute(text(
                    f'ALTER TABLE {table_name} ALTER COLUMN {col_name} '
                    f'SET DEFAULT FALSE;'
                ))
