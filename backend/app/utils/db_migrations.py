from sqlalchemy import func, inspect, text
from sqlalchemy.orm import Session

from app.database import engine, SessionLocal
from app.models import (
    OperationType,
    OperationTemplate,
    OperationTemplateField,
    Permission,
    Role,
    RolePermission,
    User,
    UserRole,
)
from datetime import datetime, timezone


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
    from app.services.asset_family import (
        operation_type_is_barge,
        resolve_template_family,
    )

    db = Session(bind=_engine)
    try:
        # Barge operation types are resolved by asset family (Tracking Module
        # Configuration -> asset type / asset masters -> operation type ->
        # entry layout), not by the literal comparison
        # applicable_asset_type_code == "BARGE": installations whose barge asset
        # type is a custom code (e.g. 'YADE') must get the stage field too.
        barge_op_codes = [
            x.operation_type_code
            for x in db.query(OperationType)
            .filter(OperationType.status == "Active")
            .all()
            if operation_type_is_barge(db, x)
        ]

        if not barge_op_codes:
            return

        barge_templates = (
            db.query(OperationTemplate)
            .filter(
                OperationTemplate.status == "Active",
                OperationTemplate.operation_type_code.in_(barge_op_codes),
            )
            .all()
        )

        # Only the barge entry layouts (Multi-Tank Before/After) carry the
        # stage field; keep the previous filter as a fallback when a template
        # has no layout resolved at all.
        barge_templates = [
            t
            for t in barge_templates
            if resolve_template_family(db, t.id) == "BARGE"
            or str(t.entry_layout_type or "").strip() == "Multi-Tank Before/After"
        ]

        if not barge_templates:
            return

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


def ensure_user_role_multi_role_constraint():
    """Upgrade user_roles from one-role-per-user to unique user/role pairs.

    This additive migration preserves every existing assignment row and ID.
    It is safe to run at every startup. The old single-role constraint is
    removed only after the replacement table/constraint is ready.
    """
    inspector = inspect(engine)
    if "user_roles" not in inspector.get_table_names():
        return

    unique_constraints = inspector.get_unique_constraints("user_roles")
    has_pair_constraint = any(
        set(constraint.get("column_names") or []) == {"user_id", "role_id"}
        for constraint in unique_constraints
    )
    single_user_constraints = [
        constraint
        for constraint in unique_constraints
        if set(constraint.get("column_names") or []) == {"user_id"}
    ]
    if has_pair_constraint and not single_user_constraints:
        return

    if engine.dialect.name == "postgresql":
        with engine.begin() as connection:
            # Create the replacement constraint first; if it fails, the legacy
            # one-role-per-user constraint remains intact.
            if not has_pair_constraint:
                connection.execute(
                    text(
                        "ALTER TABLE user_roles ADD CONSTRAINT unique_user_role_pair "
                        "UNIQUE (user_id, role_id)"
                    )
                )
            for constraint in single_user_constraints:
                name = constraint.get("name")
                if name:
                    quoted_name = engine.dialect.identifier_preparer.quote(name)
                    connection.execute(
                        text(f"ALTER TABLE user_roles DROP CONSTRAINT IF EXISTS {quoted_name}")
                    )
        return

    if engine.dialect.name == "sqlite":
        # SQLite cannot drop a UNIQUE constraint in-place. Rebuild only this
        # small association table, copying all original values before swapping.
        with engine.begin() as connection:
            connection.execute(text("""
                CREATE TABLE user_roles__rbac_upgrade (
                    id INTEGER NOT NULL PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
                    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    CONSTRAINT unique_user_role_pair UNIQUE (user_id, role_id)
                )
            """))
            connection.execute(text("""
                INSERT INTO user_roles__rbac_upgrade (id, user_id, role_id, created_at)
                SELECT id, user_id, role_id, created_at FROM user_roles
            """))
            connection.execute(text("DROP TABLE user_roles"))
            connection.execute(text("ALTER TABLE user_roles__rbac_upgrade RENAME TO user_roles"))
            connection.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_user_roles_id ON user_roles(id)"
            ))
        return

    raise RuntimeError(
        f"RBAC user-role migration is not implemented for {engine.dialect.name}"
    )


def ensure_user_location_columns():
    """Add all_locations_access column to users table if missing."""
    inspector = inspect(engine)
    if "users" not in inspector.get_table_names():
        return
    cols = {c["name"] for c in inspector.get_columns("users")}
    if "all_locations_access" not in cols:
        with engine.begin() as connection:
            connection.execute(
                text(
                    "ALTER TABLE users ADD COLUMN all_locations_access VARCHAR(20) DEFAULT 'No';"
                )
            )
            connection.execute(
                text(
                    "UPDATE users SET all_locations_access = 'No' WHERE all_locations_access IS NULL;"
                )
            )


def seed_default_permissions():
    """Seed the standard permission catalog and convert legacy permissions.

    Catalog permissions are matched by name (case-insensitive) so module
    renames update the existing rows instead of creating duplicates. Legacy
    "Manage <Entity>" permissions are converted once: every role holding one
    is granted the matching Create/Edit/Delete permissions before the legacy
    permission is removed (see app.services.permission_catalog).
    """
    from app.services.audit_service import create_audit_log
    from app.services.permission_catalog import apply_permission_catalog

    db = SessionLocal()
    try:
        result = apply_permission_catalog(db)
        migration = result["migration"]
        if migration["migrated"]:
            create_audit_log(
                db=db,
                module_name="Permission Master",
                action="Migrate Permission Catalog",
                entity_type="Permission",
                entity_label="Module-wise CRUD permission catalog",
                remarks=(
                    "Converted legacy permissions to module-wise CRUD permissions "
                    "and granted the replacements to every role that held them"
                ),
                request_path="startup",
                details={
                    "created_count": result["created_count"],
                    "updated_count": result["updated_count"],
                    "legacy_permissions_removed": migration["legacy_permissions_removed"],
                    "role_permissions_granted": migration["role_permissions_granted"],
                    "roles_affected": migration["roles_affected"],
                    "conversions": migration["conversions"],
                },
            )
        db.commit()
        if result["created_count"] or result["updated_count"]:
            print(
                f"Permission catalog: {result['created_count']} created, "
                f"{result['updated_count']} updated "
                f"({result['total_standard_permissions']} standard permissions)"
            )
        if migration["migrated"]:
            print(
                f"Permission migration: removed {migration['legacy_permissions_removed']} legacy "
                f"permissions, granted {migration['role_permissions_granted']} replacement "
                f"assignments across {migration['roles_affected']} roles"
            )
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def seed_admin_role():
    """Create Admin role (if missing), assign ALL permissions to it, and ensure
    the default 'admin' user exists and is assigned the Admin role.
    Runs on every startup so the admin role/user is always fully authorized."""
    from app.utils.security import hash_password
    import secrets

    db = SessionLocal()
    try:
        # 1. Ensure Admin role exists
        role = db.query(Role).filter(func.lower(func.trim(Role.role_name)) == "admin").first()
        if not role:
            now = datetime.now(timezone.utc)
            role = Role(
                role_name="Admin",
                description="Full system access — all permissions granted",
                status="Active",
                created_at=now,
                updated_at=now,
            )
            db.add(role)
            db.flush()
            print(f"[SEED] Created 'Admin' role (id={role.id})")
        else:
            print(f"[SEED] 'Admin' role already exists (id={role.id})")

        # 2. Assign ALL permissions to the Admin role
        all_perms = db.query(Permission).filter(Permission.status == "Active").all()
        assigned = 0
        skipped = 0
        for perm in all_perms:
            exists = (
                db.query(RolePermission)
                .filter(
                    RolePermission.role_id == role.id,
                    RolePermission.permission_id == perm.id,
                )
                .first()
            )
            if exists:
                skipped += 1
                continue
            db.add(RolePermission(
                role_id=role.id,
                permission_id=perm.id,
                created_at=datetime.now(timezone.utc),
            ))
            assigned += 1

        # 3. Ensure default 'admin' user exists and has Admin role
        admin_user = db.query(User).filter(func.lower(func.trim(User.username)) == "admin").first()
        if not admin_user:
            now = datetime.now(timezone.utc)
            admin_password = secrets.token_urlsafe(16)
            hashed = hash_password(admin_password)
            admin_user = User(
                full_name="System Administrator",
                username="admin",
                email="admin@hydrocarbon.example.com",
                phone=None,
                department="IT Administration",
                designation="System Administrator",
                password_hash=hashed,
                password_changed_at=now,
                force_password_change="No",
                password_never_expires="Yes",
                password_expiry_days=30,
                failed_login_count=0,
                totp_enabled="No",
                force_2fa="No",
                status="Active",
                created_at=now,
                updated_at=now,
            )
            db.add(admin_user)
            db.flush()
            print(f"[SEED] Created 'admin' user (id={admin_user.id})")
            print(f"[SEED] Default admin password: {admin_password}")
        else:
            print(f"[SEED] 'admin' user already exists (id={admin_user.id})")
            # Do not reactivate an administrator account that an operator has
            # intentionally disabled. Authentication checks this status live.

        # 4. Add the reserved Admin role without replacing any legacy role
        # assignments. The association table supports multiple roles after the
        # additive migration above; preserving previous assignments avoids data loss.
        user_role = (
            db.query(UserRole)
            .filter(UserRole.user_id == admin_user.id, UserRole.role_id == role.id)
            .first()
        )
        if not user_role:
            user_role = UserRole(user_id=admin_user.id, role_id=role.id)
            db.add(user_role)
            db.flush()
            print(f"[SEED] Assigned 'Admin' role to 'admin' user")
        else:
            print(f"[SEED] 'admin' user already has 'Admin' role")

        # 5. Verify the setup
        print(f"[SEED] VERIFICATION: admin user (id={admin_user.id}) -> role (id={role.id}, name={role.role_name})")

        db.commit()
        if assigned:
            print(f"[SEED] Assigned {assigned} permissions to 'Admin' role ({skipped} already existed)")
        else:
            print(f"[SEED] Admin role already has all {skipped} permissions assigned")
    except Exception as e:
        db.rollback()
        print(f"[SEED] ERROR: {e}")
        raise
    finally:
        db.close()


def verify_admin_setup():
    """Verify admin user has Admin role with all permissions. Returns dict with status."""
    db = SessionLocal()
    try:
        admin_user = db.query(User).filter(func.lower(func.trim(User.username)) == "admin").first()
        if not admin_user:
            return {"ok": False, "error": "admin user not found"}

        admin_roles = (
            db.query(Role)
            .join(UserRole, UserRole.role_id == Role.id)
            .filter(UserRole.user_id == admin_user.id)
            .all()
        )
        role = next(
            (candidate for candidate in admin_roles if str(candidate.role_name or "").strip().casefold() == "admin"),
            None,
        )
        if not role:
            return {"ok": False, "error": "admin user has no Admin role assignment"}

        # Count only active permissions assigned to the active Admin role.
        perm_count = (
            db.query(RolePermission)
            .join(Permission, Permission.id == RolePermission.permission_id)
            .filter(RolePermission.role_id == role.id, Permission.status == "Active")
            .count()
        )
        total_active_perms = db.query(Permission).filter(Permission.status == "Active").count()

        return {
            "ok": True,
            "admin_user_id": admin_user.id,
            "admin_username": admin_user.username,
            "admin_status": admin_user.status,
            "role_id": role.id,
            "role_name": role.role_name,
            "role_status": role.status,
            "permissions_assigned": perm_count,
            "total_active_permissions": total_active_perms,
            "has_all_permissions": perm_count >= total_active_perms,
        }
    finally:
        db.close()


ROLE_LOCATIONS_DDL = (
    """
    CREATE TABLE IF NOT EXISTS role_locations (
        id SERIAL PRIMARY KEY,
        role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        location_code VARCHAR(50) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT unique_role_location UNIQUE (role_id, location_code)
    );
    """,
    """
    CREATE INDEX IF NOT EXISTS ix_role_locations_id
    ON role_locations(id);
    """,
    """
    CREATE INDEX IF NOT EXISTS ix_role_locations_role_id
    ON role_locations(role_id);
    """,
)


def _role_location_table_is_missing() -> bool:
    """True when ``role_locations`` still has to be created on this database."""
    inspector = inspect(engine)
    table_names = inspector.get_table_names()
    if "role_locations" in table_names:
        return False
    # Without the referenced table the DDL cannot run; create_all will get to it
    # on the next start once roles exists.
    return "roles" in table_names


def ensure_role_location_table():
    """Create the ``role_locations`` table for per-role location scope.

    PERMISSION_CRITERIA_MODEL.md section 7.2: a user's effective location scope
    is the additive union of the *user_locations* rows and the *role_locations*
    rows of every active role the user holds. A role therefore can only widen a
    user's scope, never remove a location assigned directly to the user.

    ``Base.metadata.create_all`` already creates the table on fresh databases;
    this helper covers existing PostgreSQL deployments and is safe to run on
    every application start.
    """
    if not _role_location_table_is_missing():
        return

    with engine.begin() as connection:
        for statement in ROLE_LOCATIONS_DDL:
            connection.execute(text(statement))


def ensure_export_operations_tables():
    with engine.begin() as connection:
        connection.execute(text("""
            CREATE TABLE IF NOT EXISTS export_locations (
                id SERIAL PRIMARY KEY,
                location_name VARCHAR(150) NOT NULL,
                location_code VARCHAR(50) NOT NULL UNIQUE,
                description TEXT,
                status VARCHAR(20) NOT NULL DEFAULT 'Active',
                created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMP NOT NULL DEFAULT NOW()
            );
        """))
        connection.execute(text("""
            CREATE TABLE IF NOT EXISTS export_entities (
                id SERIAL PRIMARY KEY,
                entity_name VARCHAR(200) NOT NULL,
                entity_code VARCHAR(50) NOT NULL UNIQUE,
                description TEXT,
                status VARCHAR(20) NOT NULL DEFAULT 'Active',
                created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMP NOT NULL DEFAULT NOW()
            );
        """))
        connection.execute(text("""
            CREATE TABLE IF NOT EXISTS export_blocks (
                id SERIAL PRIMARY KEY,
                block_name VARCHAR(200) NOT NULL,
                block_code VARCHAR(50) NOT NULL UNIQUE,
                description TEXT,
                status VARCHAR(20) NOT NULL DEFAULT 'Active',
                created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMP NOT NULL DEFAULT NOW()
            );
        """))
        connection.execute(text("""
            CREATE TABLE IF NOT EXISTS export_location_entities (
                id SERIAL PRIMARY KEY,
                location_code VARCHAR(50) NOT NULL REFERENCES export_locations(location_code) ON DELETE CASCADE,
                entity_code VARCHAR(50) NOT NULL REFERENCES export_entities(entity_code) ON DELETE CASCADE,
                status VARCHAR(20) NOT NULL DEFAULT 'Active',
                created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                CONSTRAINT unique_export_location_entity UNIQUE (location_code, entity_code)
            );
        """))
        connection.execute(text("""
            CREATE TABLE IF NOT EXISTS export_entity_blocks (
                id SERIAL PRIMARY KEY,
                entity_code VARCHAR(50) NOT NULL REFERENCES export_entities(entity_code) ON DELETE CASCADE,
                block_code VARCHAR(50) NOT NULL REFERENCES export_blocks(block_code) ON DELETE CASCADE,
                status VARCHAR(20) NOT NULL DEFAULT 'Active',
                created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                CONSTRAINT unique_export_entity_block UNIQUE (entity_code, block_code)
            );
        """))
        connection.execute(text("""
            CREATE TABLE IF NOT EXISTS export_permits (
                id SERIAL PRIMARY KEY,
                permit_number VARCHAR(100) NOT NULL UNIQUE,
                location_code VARCHAR(50) NOT NULL REFERENCES export_locations(location_code) ON DELETE RESTRICT,
                entity_code VARCHAR(50) NOT NULL REFERENCES export_entities(entity_code) ON DELETE RESTRICT,
                block_code VARCHAR(50) NOT NULL REFERENCES export_blocks(block_code) ON DELETE RESTRICT,
                quarter VARCHAR(20) NOT NULL,
                permit_volume DOUBLE PRECISION NOT NULL DEFAULT 0,
                supplementary_permit VARCHAR(10) NOT NULL DEFAULT 'No',
                remarks TEXT,
                status VARCHAR(20) NOT NULL DEFAULT 'Active',
                created_by VARCHAR(150),
                created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMP NOT NULL DEFAULT NOW()
            );
        """))
        connection.execute(text("""
            CREATE TABLE IF NOT EXISTS export_transactions (
                id SERIAL PRIMARY KEY,
                bl_date DATE NOT NULL,
                location_code VARCHAR(50) NOT NULL REFERENCES export_locations(location_code) ON DELETE RESTRICT,
                entity_code VARCHAR(50) NOT NULL REFERENCES export_entities(entity_code) ON DELETE RESTRICT,
                block_code VARCHAR(50) NOT NULL REFERENCES export_blocks(block_code) ON DELETE RESTRICT,
                volume DOUBLE PRECISION NOT NULL DEFAULT 0,
                consignee VARCHAR(200) NOT NULL,
                destination VARCHAR(200) NOT NULL,
                country VARCHAR(150) NOT NULL,
                vessel_name VARCHAR(200),
                quarter VARCHAR(20) NOT NULL,
                permit_number VARCHAR(100),
                created_by VARCHAR(150),
                status VARCHAR(20) NOT NULL DEFAULT 'Active',
                created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMP NOT NULL DEFAULT NOW()
            );
        """))
        connection.execute(text("""
            CREATE INDEX IF NOT EXISTS ix_export_transactions_bl_date ON export_transactions(bl_date);
        """))
        connection.execute(text("""
            CREATE INDEX IF NOT EXISTS ix_export_transactions_quarter ON export_transactions(quarter);
        """))
        connection.execute(text("""
            CREATE INDEX IF NOT EXISTS ix_export_transactions_permit_number ON export_transactions(permit_number);
        """))
        connection.execute(text("""
            CREATE TABLE IF NOT EXISTS export_configs (
                id SERIAL PRIMARY KEY,
                config_key VARCHAR(100) NOT NULL UNIQUE,
                config_value TEXT,
                description TEXT,
                status VARCHAR(20) NOT NULL DEFAULT 'Active',
                created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMP NOT NULL DEFAULT NOW()
            );
        """))
        connection.execute(text("""
            CREATE TABLE IF NOT EXISTS export_consignees (
                id SERIAL PRIMARY KEY,
                consignee_name VARCHAR(200) NOT NULL UNIQUE,
                description TEXT,
                status VARCHAR(20) NOT NULL DEFAULT 'Active',
                created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMP NOT NULL DEFAULT NOW()
            );
        """))

        # Add missing columns to tables that may have been created by older model versions
        for sql in [
            "ALTER TABLE export_permits ADD COLUMN IF NOT EXISTS remarks TEXT;",
            "ALTER TABLE export_permits ADD COLUMN IF NOT EXISTS supplementary_permit VARCHAR(10) NOT NULL DEFAULT 'No';",
            "ALTER TABLE export_permits ADD COLUMN IF NOT EXISTS created_by VARCHAR(150);",
            "ALTER TABLE export_transactions ADD COLUMN IF NOT EXISTS permit_number VARCHAR(100);",
            "ALTER TABLE export_transactions ADD COLUMN IF NOT EXISTS created_by VARCHAR(150);",
            "ALTER TABLE export_transactions ADD COLUMN IF NOT EXISTS destination VARCHAR(200);",
            "ALTER TABLE export_transactions ADD COLUMN IF NOT EXISTS country VARCHAR(150);",
            "ALTER TABLE export_transactions ADD COLUMN IF NOT EXISTS consignee VARCHAR(200);",
            "ALTER TABLE export_transactions ADD COLUMN IF NOT EXISTS remarks TEXT;",
            "ALTER TABLE export_transactions ADD COLUMN IF NOT EXISTS vessel_name VARCHAR(200);",
            "ALTER TABLE export_locations ADD COLUMN IF NOT EXISTS description TEXT;",
            "ALTER TABLE export_entities ADD COLUMN IF NOT EXISTS description TEXT;",
            "ALTER TABLE export_blocks ADD COLUMN IF NOT EXISTS description TEXT;",
        ]:
            connection.execute(text(sql))

        # Ensure status column has a database-level default (in case table was created by ORM without one)
        connection.execute(text("""
            ALTER TABLE export_configs ALTER COLUMN status SET DEFAULT 'Active';
        """))
        connection.execute(text("""
            UPDATE export_configs SET status = 'Active' WHERE status IS NULL;
        """))

        # Seed default configs
        connection.execute(text("""
            INSERT INTO export_configs (config_key, config_value, description, status)
            VALUES ('permit_insufficiency_threshold_pct', '90', 'Permit insufficiency alert threshold (%)', 'Active')
            ON CONFLICT (config_key) DO NOTHING;
        """))
        connection.execute(text("""
            INSERT INTO export_configs (config_key, config_value, description, status)
            VALUES ('default_export_uom', 'bbls', 'Default unit of measure for volumes', 'Active')
            ON CONFLICT (config_key) DO NOTHING;
        """))


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


def ensure_tank_stock_ledger_multi_entry_constraint():
    inspector = inspect(engine)

    if "tank_stock_ledger" not in inspector.get_table_names():
        return

    existing_constraints = {
        c["name"] for c in inspector.get_unique_constraints("tank_stock_ledger")
    }

    if "unique_tank_stock_ledger_transaction" not in existing_constraints:
        return

    with engine.begin() as connection:
        connection.execute(text(
            "ALTER TABLE tank_stock_ledger DROP CONSTRAINT unique_tank_stock_ledger_transaction;"
        ))
        connection.execute(text(
            "ALTER TABLE tank_stock_ledger ADD CONSTRAINT unique_tank_stock_ledger_transaction_tank UNIQUE (transaction_id, tank_asset_code);"
        ))


def ensure_operation_transaction_indexes():
    """Indexes for the register / summary filter columns.

    ``Base.metadata.create_all`` only creates indexes on fresh databases,
    so existing deployments need them added explicitly. The transaction
    register and the tank/out-turn summaries filter and sort by these
    columns on every page load; without indexes PostgreSQL sequentially
    scans ``operation_transactions`` (and the payload join scans
    ``operation_transaction_values``), which is what made those pages take
    longer and longer as history grew.
    """
    inspector = inspect(engine)
    table_names = inspector.get_table_names()

    statements = []

    if "operation_transactions" in table_names:
        statements += [
            "CREATE INDEX IF NOT EXISTS ix_operation_transactions_operation_date "
            "ON operation_transactions (operation_date);",
            "CREATE INDEX IF NOT EXISTS ix_operation_transactions_status "
            "ON operation_transactions (status);",
            "CREATE INDEX IF NOT EXISTS ix_operation_transactions_origin_location_code "
            "ON operation_transactions (origin_location_code);",
            "CREATE INDEX IF NOT EXISTS ix_operation_transactions_operation_type_code "
            "ON operation_transactions (operation_type_code);",
            "CREATE INDEX IF NOT EXISTS ix_operation_transactions_primary_asset_code "
            "ON operation_transactions (primary_asset_code);",
            # Summary reports: approved gauging tickets per location/tank in date order.
            "CREATE INDEX IF NOT EXISTS ix_operation_transactions_status_location_asset_date "
            "ON operation_transactions (status, origin_location_code, primary_asset_code, operation_date, id);",
        ]

    if "operation_transaction_values" in table_names:
        statements += [
            "CREATE INDEX IF NOT EXISTS ix_operation_transaction_values_transaction_field "
            "ON operation_transaction_values (transaction_id, field_code);",
        ]

    if "tank_stock_ledger" in table_names:
        statements += [
            "CREATE INDEX IF NOT EXISTS ix_tank_stock_ledger_location_asset_date "
            "ON tank_stock_ledger (location_code, tank_asset_code, accounting_date, id);",
        ]

    if not statements:
        return

    with engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))


def ensure_asset_calibration_table_indexes():
    """Indexes for asset calibration table lookups.

    The asset calibration list endpoint filters tables by asset/location scope
    and loads every data row for the visible tables. Without indexes PostgreSQL
    sequentially scans ``asset_calibration_tables`` and ``asset_calibration_data``
    as history grows, which is what made loading asset calibration tables time
    out. These indexes keep the scoped lookup and per-table row fetch fast.
    """
    inspector = inspect(engine)
    table_names = inspector.get_table_names()

    statements = []

    if "asset_calibration_tables" in table_names:
        statements += [
            "CREATE INDEX IF NOT EXISTS ix_asset_calibration_tables_asset_code "
            "ON asset_calibration_tables (asset_code);",
            "CREATE INDEX IF NOT EXISTS ix_asset_calibration_tables_status "
            "ON asset_calibration_tables (status);",
        ]

    if "asset_calibration_data" in table_names:
        statements += [
            "CREATE INDEX IF NOT EXISTS ix_asset_calibration_data_table_row "
            "ON asset_calibration_data (calibration_table_id, row_number);",
        ]

    if not statements:
        return

    with engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))
