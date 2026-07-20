from sqlalchemy import Column, Date, DateTime, ForeignKey, Integer, BigInteger, String, Text, UniqueConstraint, Float, Time
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func
from datetime import datetime, timezone
from app.database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    full_name = Column(String(150), nullable=False)
    username = Column(String(80), nullable=False, unique=True, index=True)
    email = Column(String(150), nullable=False)
    phone = Column(String(50), nullable=True)
    department = Column(String(100), nullable=True)
    designation = Column(String(100), nullable=True)
    password_hash = Column(Text, nullable=False)
    password_changed_at = Column(DateTime, nullable=True)
    force_password_change = Column(String(20), nullable=False, default="No")
    password_never_expires = Column(String(20), nullable=False, default="No")
    password_expiry_days = Column(Integer, nullable=False, default=30)
    failed_login_count = Column(Integer, nullable=False, default=0)
    locked_until = Column(DateTime, nullable=True)
    last_login_at = Column(DateTime, nullable=True)
    last_login_ip = Column(String(80), nullable=True)
    totp_enabled = Column(String(20), nullable=False, default="No")
    totp_secret_encrypted = Column(Text, nullable=True)
    totp_confirmed_at = Column(DateTime, nullable=True)
    force_2fa = Column(String(20), nullable=False, default="No")
    backup_codes_hash_json = Column(JSONB, nullable=True)
    status = Column(String(20), nullable=False, default="Active")
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now())


class AuthLoginChallenge(Base):
    __tablename__ = "auth_login_challenges"

    id = Column(Integer, primary_key=True, index=True)
    challenge_id = Column(String(120), nullable=False, unique=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    status = Column(String(30), nullable=False, default="Pending")
    expires_at = Column(DateTime, nullable=False, index=True)
    ip_address = Column(String(80), nullable=True)
    user_agent = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    verified_at = Column(DateTime, nullable=True)


class PasswordResetRequest(Base):
    __tablename__ = "password_reset_requests"

    id = Column(Integer, primary_key=True, index=True)
    request_number = Column(String(120), nullable=False, unique=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    username = Column(String(80), nullable=False, index=True)
    status = Column(String(30), nullable=False, default="Pending", index=True)
    reason = Column(Text, nullable=True)
    reset_2fa = Column(String(20), nullable=False, default="No")
    requested_at = Column(DateTime, nullable=False, server_default=func.now())
    requested_by_ip = Column(String(80), nullable=True)
    task_id = Column(Integer, ForeignKey("operation_tasks.id"), nullable=True, index=True)
    acted_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    acted_at = Column(DateTime, nullable=True)
    action_notes = Column(Text, nullable=True)


class OperationTransactionValue(Base):
    __tablename__ = "operation_transaction_values"

    id = Column(Integer, primary_key=True, index=True)
    transaction_id = Column(
        Integer,
        ForeignKey("operation_transactions.id", ondelete="CASCADE"),
        nullable=False,
    )
    field_code = Column(String(100), nullable=False)
    field_name = Column(String(150), nullable=False)
    field_group = Column(String(50), nullable=False, default="General")
    data_type = Column(String(50), nullable=False)
    unit = Column(String(50), nullable=True)
    input_mode = Column(String(50), nullable=False, default="Manual")
    calculation_role = Column(String(50), nullable=False, default="Input")
    field_value = Column(JSONB, nullable=True)
    sort_order = Column(Integer, nullable=False, default=1)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now())

    __table_args__ = (
        UniqueConstraint(
            "transaction_id",
            "field_code",
            name="unique_field_value_per_operation_transaction",
        ),
    )

class OperationTransactionStatusHistory(Base):
    __tablename__ = "operation_transaction_status_history"

    id = Column(Integer, primary_key=True, index=True)

    transaction_id = Column(
        Integer,
        ForeignKey("operation_transactions.id"),
        nullable=False,
        index=True,
    )

    old_status = Column(String(50), nullable=True)
    new_status = Column(String(50), nullable=False)

    changed_by = Column(String(100), nullable=True)
    remarks = Column(Text, nullable=True)

    changed_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)

class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, index=True)

    module_name = Column(String(120), nullable=False, index=True)
    action = Column(String(120), nullable=False, index=True)

    entity_type = Column(String(120), nullable=True, index=True)
    entity_id = Column(Integer, nullable=True, index=True)
    entity_label = Column(String(200), nullable=True)

    ticket_number = Column(String(120), nullable=True, index=True)
    operation_number = Column(String(120), nullable=True, index=True)

    old_status = Column(String(50), nullable=True)
    new_status = Column(String(50), nullable=True)

    performed_by = Column(String(150), nullable=True, index=True)
    remarks = Column(Text, nullable=True)

    request_path = Column(String(250), nullable=True)

    details = Column(JSONB, nullable=True)

    created_at = Column(DateTime, nullable=False, server_default=func.now())

class Role(Base):
    __tablename__ = "roles"

    id = Column(Integer, primary_key=True, index=True)
    role_name = Column(String(100), nullable=False, unique=True)
    description = Column(Text, nullable=True)
    status = Column(String(20), nullable=False, default="Active")
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now())


class Permission(Base):
    __tablename__ = "permissions"

    id = Column(Integer, primary_key=True, index=True)
    permission_name = Column(String(120), nullable=False)
    module_name = Column(String(120), nullable=False)
    description = Column(Text, nullable=True)
    status = Column(String(20), nullable=False, default="Active")
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now())

    __table_args__ = (
        UniqueConstraint(
            "permission_name",
            "module_name",
            name="unique_permission_per_module",
        ),
    )


class RolePermission(Base):
    __tablename__ = "role_permissions"

    id = Column(Integer, primary_key=True, index=True)
    role_id = Column(
        Integer,
        ForeignKey("roles.id", ondelete="CASCADE"),
        nullable=False,
    )
    permission_id = Column(
        Integer,
        ForeignKey("permissions.id", ondelete="CASCADE"),
        nullable=False,
    )
    created_at = Column(DateTime, nullable=False, server_default=func.now())

    __table_args__ = (
        UniqueConstraint(
            "role_id",
            "permission_id",
            name="unique_role_permission",
        ),
    )


class UserRole(Base):
    __tablename__ = "user_roles"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    role_id = Column(
        Integer,
        ForeignKey("roles.id", ondelete="CASCADE"),
        nullable=False,
    )
    created_at = Column(DateTime, nullable=False, server_default=func.now())

    __table_args__ = (
        UniqueConstraint(
            "user_id",
            name="unique_user_role",
        ),
    )


class SystemNotification(Base):
    __tablename__ = "system_notifications"

    id = Column(Integer, primary_key=True, index=True)
    notification_number = Column(String(80), nullable=False, unique=True, index=True)
    title = Column(String(180), nullable=False)
    message = Column(Text, nullable=False)
    notification_type = Column(String(40), nullable=False, default="Info", index=True)
    priority = Column(String(30), nullable=False, default="Normal", index=True)
    delivery_mode = Column(String(50), nullable=False, default="Banner + Inbox")
    target_scope = Column(String(50), nullable=False, default="All Users", index=True)
    target_role_ids_json = Column(JSONB, nullable=True)
    target_user_ids_json = Column(JSONB, nullable=True)
    target_location_codes_json = Column(JSONB, nullable=True)
    display_from = Column(DateTime, nullable=True, index=True)
    display_until = Column(DateTime, nullable=True, index=True)
    requires_acknowledgement = Column(String(10), nullable=False, default="No")
    popup_enabled = Column(String(10), nullable=False, default="No")
    banner_enabled = Column(String(10), nullable=False, default="Yes")
    auto_dismiss_seconds = Column(Integer, nullable=True)
    status = Column(String(30), nullable=False, default="Draft", index=True)
    created_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    created_by_display = Column(String(150), nullable=True)
    published_at = Column(DateTime, nullable=True)
    deactivated_at = Column(DateTime, nullable=True)
    deactivated_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    deactivation_reason = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now())


class SystemNotificationReceipt(Base):
    __tablename__ = "system_notification_receipts"

    id = Column(Integer, primary_key=True, index=True)
    notification_id = Column(
        Integer,
        ForeignKey("system_notifications.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    username = Column(String(80), nullable=True, index=True)
    delivered_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    first_seen_at = Column(DateTime, nullable=True)
    last_seen_at = Column(DateTime, nullable=True)
    dismissed_at = Column(DateTime, nullable=True)
    acknowledged_at = Column(DateTime, nullable=True)
    acknowledgement_remarks = Column(Text, nullable=True)
    status = Column(String(30), nullable=False, default="Unread", index=True)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now())

    __table_args__ = (
        UniqueConstraint(
            "notification_id",
            "user_id",
            name="unique_system_notification_receipt_user",
        ),
    )


class BackupSettings(Base):
    __tablename__ = "backup_settings"

    id = Column(Integer, primary_key=True, index=True)
    enabled = Column(String(10), nullable=False, default="No")
    schedule_mode = Column(String(30), nullable=False, default="Daily")
    interval_value = Column(Integer, nullable=False, default=24)
    run_time = Column(String(10), nullable=False, default="02:00")
    retention_days = Column(Integer, nullable=False, default=30)
    keep_minimum = Column(Integer, nullable=False, default=5)
    backup_directory = Column(String(300), nullable=True)
    compression_enabled = Column(String(10), nullable=False, default="Yes")
    status = Column(String(30), nullable=False, default="Active", index=True)
    next_run_at = Column(DateTime, nullable=True, index=True)
    last_run_at = Column(DateTime, nullable=True)
    updated_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now())


class BackupJob(Base):
    __tablename__ = "backup_jobs"

    id = Column(Integer, primary_key=True, index=True)
    backup_number = Column(String(80), nullable=False, unique=True, index=True)
    backup_type = Column(String(40), nullable=False, default="Manual", index=True)
    trigger_source = Column(String(40), nullable=False, default="Manual", index=True)
    status = Column(String(40), nullable=False, default="Pending", index=True)
    description = Column(Text, nullable=True)
    file_name = Column(String(240), nullable=True)
    file_path = Column(Text, nullable=True)
    file_size_bytes = Column(BigInteger, nullable=True)
    checksum_sha256 = Column(String(128), nullable=True)
    database_name = Column(String(160), nullable=True)
    backup_format = Column(String(40), nullable=False, default="custom")
    requested_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    requested_by_display = Column(String(150), nullable=True)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    error_message = Column(Text, nullable=True)
    metadata_json = Column(JSONB, nullable=True)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now())


class BackupRestoreRequest(Base):
    __tablename__ = "backup_restore_requests"

    id = Column(Integer, primary_key=True, index=True)
    request_number = Column(String(80), nullable=False, unique=True, index=True)
    backup_job_id = Column(Integer, ForeignKey("backup_jobs.id"), nullable=False, index=True)
    backup_number = Column(String(80), nullable=False, index=True)
    status = Column(String(40), nullable=False, default="Pending Approval", index=True)
    reason = Column(Text, nullable=False)
    business_impact = Column(Text, nullable=True)
    requested_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    requested_by_display = Column(String(150), nullable=True)
    requested_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    approved_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    approved_by_display = Column(String(150), nullable=True)
    approved_at = Column(DateTime, nullable=True)
    rejected_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    rejected_by_display = Column(String(150), nullable=True)
    rejected_at = Column(DateTime, nullable=True)
    cancelled_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    cancelled_by_display = Column(String(150), nullable=True)
    cancelled_at = Column(DateTime, nullable=True)
    action_remarks = Column(Text, nullable=True)
    metadata_json = Column(JSONB, nullable=True)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now())


class BackupRestoreValidation(Base):
    __tablename__ = "backup_restore_validations"

    id = Column(Integer, primary_key=True, index=True)
    validation_number = Column(String(80), nullable=False, unique=True, index=True)
    restore_request_id = Column(
        Integer,
        ForeignKey("backup_restore_requests.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    backup_job_id = Column(Integer, ForeignKey("backup_jobs.id"), nullable=False, index=True)
    backup_number = Column(String(80), nullable=False, index=True)
    status = Column(String(40), nullable=False, default="Pending", index=True)
    validation_database_name = Column(String(180), nullable=True)
    started_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    started_by_display = Column(String(150), nullable=True)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    error_message = Column(Text, nullable=True)
    table_counts_json = Column(JSONB, nullable=True)
    validation_report_json = Column(JSONB, nullable=True)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now())


class OperationWorkflowPolicy(Base):
    __tablename__ = "operation_workflow_policies"

    id = Column(Integer, primary_key=True, index=True)
    policy_name = Column(String(150), nullable=False)
    action_code = Column(String(60), nullable=False, index=True)
    operation_type_code = Column(String(50), nullable=True, index=True)
    operation_template_id = Column(Integer, nullable=True, index=True)
    asset_type_code = Column(String(50), nullable=True, index=True)
    location_code = Column(String(50), nullable=True, index=True)
    priority = Column(Integer, nullable=False, default=100)
    status = Column(String(20), nullable=False, default="Active")
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now())


class OperationWorkflowPolicyRole(Base):
    __tablename__ = "operation_workflow_policy_roles"

    id = Column(Integer, primary_key=True, index=True)
    policy_id = Column(
        Integer,
        ForeignKey("operation_workflow_policies.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    role_id = Column(
        Integer,
        ForeignKey("roles.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    created_at = Column(DateTime, nullable=False, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("policy_id", "role_id", name="uq_operation_workflow_policy_role"),
    )


class OperationWorkflowPolicyUser(Base):
    __tablename__ = "operation_workflow_policy_users"

    id = Column(Integer, primary_key=True, index=True)
    policy_id = Column(
        Integer,
        ForeignKey("operation_workflow_policies.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    mode = Column(String(20), nullable=False, default="ALLOW")
    created_at = Column(DateTime, nullable=False, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("policy_id", "user_id", name="uq_operation_workflow_policy_user"),
    )


class OperationTask(Base):
    __tablename__ = "operation_tasks"

    id = Column(Integer, primary_key=True, index=True)
    task_number = Column(String(120), nullable=False, unique=True, index=True)
    task_type = Column(String(80), nullable=False, default="OPERATION_APPROVAL", index=True)
    transaction_id = Column(
        Integer,
        ForeignKey("operation_transactions.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    ticket_number = Column(String(120), nullable=True, index=True)
    operation_number = Column(String(120), nullable=True, index=True)
    operation_type_code = Column(String(50), nullable=True, index=True)
    operation_template_id = Column(Integer, nullable=True, index=True)
    asset_type_code = Column(String(50), nullable=True, index=True)
    primary_asset_code = Column(String(80), nullable=True, index=True)
    location_code = Column(String(50), nullable=True, index=True)
    raised_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    assigned_policy_id = Column(Integer, ForeignKey("operation_workflow_policies.id"), nullable=True, index=True)
    assigned_role_ids_json = Column(JSONB, nullable=True)
    assigned_user_ids_json = Column(JSONB, nullable=True)
    status = Column(String(30), nullable=False, default="Pending", index=True)
    priority = Column(String(30), nullable=False, default="Normal", index=True)
    due_at = Column(DateTime, nullable=True)
    taken_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    taken_at = Column(DateTime, nullable=True)
    acted_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    acted_at = Column(DateTime, nullable=True)
    action_taken = Column(String(50), nullable=True)
    remarks = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now())


class OperationTaskEvent(Base):
    __tablename__ = "operation_task_events"

    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(
        Integer,
        ForeignKey("operation_tasks.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    event_type = Column(String(80), nullable=False, index=True)
    old_status = Column(String(30), nullable=True)
    new_status = Column(String(30), nullable=True)
    actor_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    actor_display = Column(String(150), nullable=True)
    notes = Column(Text, nullable=True)
    details = Column(JSONB, nullable=True)
    created_at = Column(DateTime, nullable=False, server_default=func.now())


class Location(Base):
    __tablename__ = "locations"

    id = Column(Integer, primary_key=True, index=True)
    location_name = Column(String(150), nullable=False)
    location_code = Column(String(50), nullable=False, unique=True, index=True)
    location_type = Column(String(100), nullable=False)
    parent_location_code = Column(String(50), nullable=True)
    description = Column(Text, nullable=True)
    status = Column(String(20), nullable=False, default="Active")
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now())


class LocationAccountingDaySetting(Base):
    __tablename__ = "location_accounting_day_settings"

    id = Column(Integer, primary_key=True, index=True)

    location_code = Column(String(50), nullable=False, index=True)

    # Example:
    # day_start_time = 06:01
    # day_end_time = 06:00
    # This means accounting day runs from 06:01 today to 06:00 next day.
    day_start_time = Column(Time, nullable=False)
    day_end_time = Column(Time, nullable=False)

    effective_from = Column(Date, nullable=False, index=True)
    effective_to = Column(Date, nullable=True, index=True)

    timezone_name = Column(String(100), nullable=False, default="Africa/Lagos")

    description = Column(Text, nullable=True)
    status = Column(String(20), nullable=False, default="Active")

    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now())


class AssetType(Base):
    __tablename__ = "asset_types"

    id = Column(Integer, primary_key=True, index=True)
    asset_type_name = Column(String(150), nullable=False)
    asset_type_code = Column(String(50), nullable=False, unique=True, index=True)
    description = Column(Text, nullable=True)
    status = Column(String(20), nullable=False, default="Active")
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now())


class Asset(Base):
    __tablename__ = "assets"

    id = Column(Integer, primary_key=True, index=True)
    asset_name = Column(String(150), nullable=False)
    asset_code = Column(String(80), nullable=False, unique=True, index=True)
    asset_scope = Column(String(20), nullable=False)
    asset_type_code = Column(String(50), nullable=False)
    location_code = Column(String(50), nullable=True)
    serial_number = Column(String(100), nullable=True)
    manufacturer = Column(String(150), nullable=True)
    model = Column(String(150), nullable=True)
    commission_date = Column(Date, nullable=True)
    description = Column(Text, nullable=True)
    status = Column(String(20), nullable=False, default="Active")
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now())


class CalibrationTemplate(Base):
    __tablename__ = "calibration_templates"

    id = Column(Integer, primary_key=True, index=True)
    template_name = Column(String(150), nullable=False, unique=True, index=True)
    asset_type_code = Column(String(50), nullable=False)
    calibration_type = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)
    status = Column(String(20), nullable=False, default="Active")
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now())


class CalibrationTemplateColumn(Base):
    __tablename__ = "calibration_template_columns"

    id = Column(Integer, primary_key=True, index=True)
    template_id = Column(
        Integer,
        ForeignKey("calibration_templates.id", ondelete="CASCADE"),
        nullable=False,
    )
    column_name = Column(String(120), nullable=False)
    data_type = Column(String(50), nullable=False)
    unit = Column(String(50), nullable=True)
    is_required = Column(String(10), nullable=False, default="Yes")
    interpolation_role = Column(String(50), nullable=False, default="None")
    sort_order = Column(Integer, nullable=False, default=1)

    __table_args__ = (
        UniqueConstraint(
            "template_id",
            "column_name",
            name="unique_column_per_calibration_template",
        ),
    )


class AssetCalibrationTable(Base):
    __tablename__ = "asset_calibration_tables"

    id = Column(Integer, primary_key=True, index=True)
    calibration_name = Column(String(150), nullable=False)
    asset_code = Column(String(80), nullable=False)
    template_id = Column(
        Integer,
        ForeignKey("calibration_templates.id", ondelete="RESTRICT"),
        nullable=False,
    )
    effective_date = Column(Date, nullable=True)
    remarks = Column(Text, nullable=True)
    status = Column(String(20), nullable=False, default="Active")
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now())


class AssetCalibrationData(Base):
    __tablename__ = "asset_calibration_data"

    id = Column(Integer, primary_key=True, index=True)
    calibration_table_id = Column(
        Integer,
        ForeignKey("asset_calibration_tables.id", ondelete="CASCADE"),
        nullable=False,
    )
    row_number = Column(Integer, nullable=False)
    row_data = Column(JSONB, nullable=False)
    created_at = Column(DateTime, nullable=False, server_default=func.now())

    __table_args__ = (
        UniqueConstraint(
            "calibration_table_id",
            "row_number",
            name="unique_calibration_table_row_number",
        ),
    )


class AssetAssignment(Base):
    __tablename__ = "asset_assignments"

    id = Column(Integer, primary_key=True, index=True)
    asset_code = Column(String(80), nullable=False)
    asset_scope = Column(String(20), nullable=False)
    assignment_location_code = Column(String(50), nullable=False)
    assigned_to_type = Column(String(50), nullable=False)
    assigned_to = Column(String(150), nullable=False)
    assignment_date = Column(Date, nullable=False)
    return_date = Column(Date, nullable=True)
    remarks = Column(Text, nullable=True)
    status = Column(String(20), nullable=False, default="Active")
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now())

class PrimeMoverTankerLink(Base):
    __tablename__ = "prime_mover_tanker_links"

    id = Column(Integer, primary_key=True, index=True)

    # Prime mover / tractor head asset code.
    # This is the operationally selected asset in Operation Entry.
    prime_mover_asset_code = Column(String(80), nullable=False, index=True)

    # Tanker trailer / tank body asset code.
    # Calibration chart belongs to this asset.
    tanker_asset_code = Column(String(80), nullable=False, index=True)

    linked_from = Column(Date, nullable=False, index=True)
    linked_to = Column(Date, nullable=True, index=True)

    remarks = Column(Text, nullable=True)
    status = Column(String(20), nullable=False, default="Active", index=True)

    created_by = Column(String(150), nullable=True)

    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now())
    
class OperationType(Base):
    __tablename__ = "operation_types"

    id = Column(Integer, primary_key=True, index=True)
    operation_type_name = Column(String(150), nullable=False)
    operation_type_code = Column(String(80), nullable=False, unique=True, index=True)
    applicable_asset_type_code = Column(String(50), nullable=False)
    operation_category = Column(String(100), nullable=False)
    requires_sender_location = Column(String(10), nullable=False, default="No")
    requires_receiver_location = Column(String(10), nullable=False, default="No")
    requires_comparison = Column(String(10), nullable=False, default="No")
    requires_approval = Column(String(10), nullable=False, default="No")
    description = Column(Text, nullable=True)
    status = Column(String(20), nullable=False, default="Active")
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now())


class TankOperation(Base):
    __tablename__ = "tank_operations"

    id = Column(Integer, primary_key=True, index=True)

    location_code = Column(String(50), nullable=False, index=True)

    operation_code = Column(String(50), nullable=False, index=True)
    operation_label = Column(String(150), nullable=False)

    # Standard system category used for inventory calculations:
    # OPENING, RECEIPT, PRODUCTION, DISPATCH, DRAINING, CLOSING, ADJUSTMENT
    operation_category = Column(String(50), nullable=False, index=True)

    # Standard movement sign:
    # SET = set/declare balance
    # IN = increase stock
    # OUT = decrease stock
    # NEUTRAL = no stock movement
    operation_sign = Column(String(20), nullable=False)

    sort_order = Column(Integer, nullable=False, default=1)
    description = Column(Text, nullable=True)
    status = Column(String(20), nullable=False, default="Active")

    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now())

    __table_args__ = (
        UniqueConstraint(
            "location_code",
            "operation_code",
            name="unique_tank_operation_code_per_location",
        ),
        UniqueConstraint(
            "location_code",
            "operation_label",
            name="unique_tank_operation_label_per_location",
        ),
    )

class TankStockLedger(Base):
    __tablename__ = "tank_stock_ledger"

    id = Column(Integer, primary_key=True, index=True)

    transaction_id = Column(
        Integer,
        ForeignKey("operation_transactions.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )

    ticket_number = Column(String(120), nullable=False, index=True)
    operation_number = Column(String(120), nullable=False, index=True)

    location_code = Column(String(50), nullable=False, index=True)
    tank_asset_code = Column(String(80), nullable=False, index=True)
    tank_asset_name = Column(String(150), nullable=True)

    operation_date = Column(Date, nullable=False, index=True)
    product_name = Column(String(150), nullable=True)

    accounting_date = Column(Date, nullable=True, index=True)
    accounting_day_start = Column(DateTime, nullable=True)
    accounting_day_end = Column(DateTime, nullable=True)

    accounting_day_setting_id = Column(
        Integer,
        ForeignKey("location_accounting_day_settings.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
    )

    tank_operation_code = Column(String(50), nullable=False, index=True)
    tank_operation_label = Column(String(150), nullable=False)
    tank_operation_category = Column(String(50), nullable=False, index=True)
    tank_operation_sign = Column(String(20), nullable=False)

    movement_gsv_bbl = Column(Float, nullable=True, default=0)
    movement_nsv_bbl = Column(Float, nullable=True, default=0)
    movement_lt = Column(Float, nullable=True, default=0)
    movement_mt = Column(Float, nullable=True, default=0)

    # Total stock in tank after this gauging operation.
    # Tank Gauging calculated values are stock snapshot values, not direct movement quantities.
    stock_gsv_bbl = Column(Float, nullable=True, default=0)
    stock_nsv_bbl = Column(Float, nullable=True, default=0)
    stock_lt = Column(Float, nullable=True, default=0)
    stock_mt = Column(Float, nullable=True, default=0)

    # Previous chronological stock before this ticket.
    previous_stock_gsv_bbl = Column(Float, nullable=True, default=0)
    previous_stock_nsv_bbl = Column(Float, nullable=True, default=0)
    previous_stock_lt = Column(Float, nullable=True, default=0)
    previous_stock_mt = Column(Float, nullable=True, default=0)

    running_balance_gsv_bbl = Column(Float, nullable=True, default=0)
    running_balance_nsv_bbl = Column(Float, nullable=True, default=0)
    running_balance_lt = Column(Float, nullable=True, default=0)
    running_balance_mt = Column(Float, nullable=True, default=0)

    source_payload = Column(JSONB, nullable=True)

    # Active = current valid ledger row
    # Reversed = reversed due to ticket recall/cancel/rejection in future
    # Cancelled = manually cancelled in future
    status = Column(String(30), nullable=False, default="Active")

    created_by = Column(String(150), nullable=True)
    remarks = Column(Text, nullable=True)

    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now())

    __table_args__ = (
        UniqueConstraint(
            "transaction_id",
            name="unique_tank_stock_ledger_transaction",
        ),
    )


class LocationOperationAvailability(Base):
    __tablename__ = "location_operation_availability"

    id = Column(Integer, primary_key=True, index=True)

    location_code = Column(String(50), nullable=False, index=True)
    operation_type_code = Column(String(50), nullable=False, index=True)

    status = Column(String(50), default="Active", nullable=False)
    remarks = Column(Text, nullable=True)

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

class OperationTemplate(Base):
    __tablename__ = "operation_templates"

    id = Column(Integer, primary_key=True, index=True)
    template_name = Column(String(150), nullable=False, unique=True, index=True)
    operation_type_code = Column(String(80), nullable=False)

    entry_layout_type = Column(
        String(80),
        nullable=False,
        default="Standard Form",
    )

    calculation_engine = Column(
        String(100),
        nullable=False,
        default="None",
    )

    description = Column(Text, nullable=True)
    status = Column(String(20), nullable=False, default="Active")
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now())


class OperationTemplateField(Base):
    __tablename__ = "operation_template_fields"

    id = Column(Integer, primary_key=True, index=True)
    template_id = Column(
        Integer,
        ForeignKey("operation_templates.id", ondelete="CASCADE"),
        nullable=False,
    )
    field_name = Column(String(150), nullable=False)
    field_code = Column(String(100), nullable=False)
    field_group = Column(String(50), nullable=False, default="General")
    data_type = Column(String(50), nullable=False)
    unit = Column(String(50), nullable=True)
    is_required = Column(String(10), nullable=False, default="Yes")
    input_mode = Column(String(50), nullable=False, default="Manual")
    calculation_role = Column(String(50), nullable=False, default="Input")
    sort_order = Column(Integer, nullable=False, default=1)
    status = Column(String(20), nullable=False, default="Active")

    __table_args__ = (
        UniqueConstraint(
            "template_id",
            "field_code",
            name="unique_field_code_per_operation_template",
        ),
    )


class OperationTemplateLayout(Base):
    __tablename__ = "operation_template_layouts"

    id = Column(Integer, primary_key=True, index=True)
    template_id = Column(
        Integer,
        ForeignKey("operation_templates.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    layout_name = Column(String(150), nullable=False)
    version_no = Column(Integer, nullable=False, default=1)
    status = Column(String(20), nullable=False, default="Draft")  # Draft / Published / Archived
    is_default = Column(String(10), nullable=False, default="No")  # Yes / No
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now())

    __table_args__ = (
        UniqueConstraint(
            "template_id",
            "layout_name",
            "version_no",
            name="unique_operation_template_layout_version",
        ),
    )


class OperationTemplateLayoutSection(Base):
    __tablename__ = "operation_template_layout_sections"

    id = Column(Integer, primary_key=True, index=True)
    layout_id = Column(
        Integer,
        ForeignKey("operation_template_layouts.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    section_key = Column(String(120), nullable=False)
    title = Column(String(150), nullable=False)
    sort_order = Column(Integer, nullable=False, default=1)
    collapsible = Column(String(10), nullable=False, default="No")
    default_open = Column(String(10), nullable=False, default="Yes")
    visibility_rule_json = Column(JSONB, nullable=True)

    __table_args__ = (
        UniqueConstraint(
            "layout_id",
            "section_key",
            name="unique_operation_template_layout_section_key",
        ),
    )


class OperationTemplateLayoutItem(Base):
    __tablename__ = "operation_template_layout_items"

    id = Column(Integer, primary_key=True, index=True)
    layout_id = Column(
        Integer,
        ForeignKey("operation_template_layouts.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    section_id = Column(
        Integer,
        ForeignKey("operation_template_layout_sections.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    field_id = Column(
        Integer,
        ForeignKey("operation_template_fields.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    row_no = Column(Integer, nullable=False, default=1)
    col_start = Column(Integer, nullable=False, default=1)
    col_span = Column(Integer, nullable=False, default=1)
    sort_order = Column(Integer, nullable=False, default=1)

    label_override = Column(String(150), nullable=True)
    placeholder_override = Column(String(150), nullable=True)
    read_only_override = Column(String(10), nullable=True)  # Yes / No / null
    width_mode = Column(String(30), nullable=True)  # Auto / Compact / Full
    rule_json = Column(JSONB, nullable=True)

    __table_args__ = (
        UniqueConstraint(
            "layout_id",
            "field_id",
            name="unique_operation_template_layout_field_placement",
        ),
    )

class TankerReceiptAcknowledgement(Base):
    __tablename__ = "tanker_receipt_acknowledgements"

    id = Column(Integer, primary_key=True, index=True)

    sender_transaction_id = Column(
        Integer,
        ForeignKey("operation_transactions.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )

    convoy_number = Column(String(80), nullable=False, index=True)
    tanker_asset_code = Column(String(80), nullable=True, index=True)
    prime_mover_asset_code = Column(String(80), nullable=True, index=True)

    receiver_location_code = Column(String(50), nullable=True, index=True)

    acknowledged_by = Column(String(150), nullable=True)
    acknowledged_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))

    remarks = Column(Text, nullable=True)
    status = Column(String(30), nullable=False, default="Acknowledged")
    closed_by = Column(String(150), nullable=True)
    closed_at = Column(DateTime, nullable=True)
    closure_remarks = Column(Text, nullable=True)
    
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now())

    __table_args__ = (
        UniqueConstraint(
            "sender_transaction_id",
            name="unique_tanker_receipt_acknowledgement_per_sender",
        ),
    )
    
class OperationTransaction(Base):
    __tablename__ = "operation_transactions"

    id = Column(Integer, primary_key=True, index=True)
    operation_ticket_number = Column(String(100), unique=True, nullable=True, index=True)
    operation_number = Column(String(80), nullable=False, unique=True, index=True)
    operation_type_code = Column(String(80), nullable=False)
    operation_template_id = Column(
        Integer,
        ForeignKey("operation_templates.id", ondelete="RESTRICT"),
        nullable=True,
    )
    primary_asset_code = Column(String(80), nullable=False)
    primary_asset_type_code = Column(String(50), nullable=False)
    convoy_number = Column(String(50), nullable=True, index=True)
    origin_location_code = Column(String(50), nullable=False)
    destination_location_code = Column(String(50), nullable=True)
    sender_location_code = Column(String(50), nullable=True)
    receiver_location_code = Column(String(50), nullable=True)
    operation_date = Column(Date, nullable=False)
    operation_start_datetime = Column(DateTime, nullable=True)
    operation_end_datetime = Column(DateTime, nullable=True)
    product_name = Column(String(150), nullable=True)
    created_by = Column(String(80), nullable=True)
    remarks = Column(Text, nullable=True)
    status = Column(String(50), nullable=False, default="Draft")
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now())


class ApprovedTransactionCorrectionRequest(Base):
    __tablename__ = "approved_transaction_correction_requests"

    id = Column(Integer, primary_key=True, index=True)
    request_number = Column(String(80), nullable=False, unique=True, index=True)
    transaction_id = Column(
        Integer,
        ForeignKey("operation_transactions.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    task_id = Column(
        Integer,
        ForeignKey("operation_tasks.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    ticket_number = Column(String(100), nullable=True, index=True)
    operation_number = Column(String(80), nullable=True, index=True)
    request_type = Column(String(80), nullable=False)
    suggested_action = Column(String(80), nullable=False)
    reason = Column(Text, nullable=False)
    status = Column(String(50), nullable=False, default="Pending Admin Review", index=True)
    requested_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    requested_by_display = Column(String(150), nullable=True)
    requested_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    admin_action = Column(String(80), nullable=True)
    admin_remarks = Column(Text, nullable=True)
    admin_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    admin_action_at = Column(DateTime, nullable=True)
    previous_status_before_revoke = Column(String(50), nullable=True)
    new_status_after_revoke = Column(String(50), nullable=True)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now())


class MaterialBalanceTemplate(Base):
    __tablename__ = "material_balance_templates"

    id = Column(Integer, primary_key=True, index=True)

    location_code = Column(String(50), nullable=False, index=True)
    template_name = Column(String(150), nullable=False)

    description = Column(Text, nullable=True)

    # Only one Active template should normally be used per location.
    # We are not enforcing that at database level yet because future versions
    # may allow multiple templates per location/product.
    status = Column(String(20), nullable=False, default="Active")

    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now())

    __table_args__ = (
        UniqueConstraint(
            "location_code",
            "template_name",
            name="unique_material_balance_template_per_location",
        ),
    )


class MaterialBalanceTemplateColumn(Base):
    __tablename__ = "material_balance_template_columns"

    id = Column(Integer, primary_key=True, index=True)

    template_id = Column(
        Integer,
        ForeignKey("material_balance_templates.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    column_label = Column(String(150), nullable=False)
    column_key = Column(String(120), nullable=False)
    column_order = Column(Integer, nullable=False, default=1)

    # Allowed values planned:
    # OPENING, MOVEMENT, BOOK_CLOSING, ACTUAL_CLOSING, LOSS_GAIN, FORMULA, INFO
    column_type = Column(String(50), nullable=False)

    # For MOVEMENT columns only:
    # IN, OUT, NEUTRAL
    movement_direction = Column(String(20), nullable=True)

    # List of Tank Operation codes selected by the user.
    # Example: ["RECEIPT", "PRODUCTION", "RECEIPT_FROM_AGU"]
    mapped_operation_codes = Column(JSONB, nullable=False, default=list)

    # Extra safety list.
    # Example: ["ITT_IN", "ITT_OUT", "INTERNAL_TANK_TRANSFER_IN"]
    excluded_operation_codes = Column(JSONB, nullable=False, default=list)

    # Yes/No. If No, this column can be displayed but not counted in Material Balance totals.
    include_in_material_balance = Column(String(10), nullable=False, default="Yes")

    # Yes/No. If No, this column is not included in Book Closing formula.
    # Useful for ITT / internal transfers / informational columns.
    include_in_book_closing = Column(String(10), nullable=False, default="Yes")

    # Yes/No. Strong flag for future frontend/backend logic.
    # Internal transfers should normally be Yes and excluded from book closing.
    is_internal_transfer = Column(String(10), nullable=False, default="No")

    # Optional future formula support.
    # Example:
    # {"op":"subtract","cols":["actual_closing","book_closing"]}
    formula_json = Column(JSONB, nullable=True)

    remarks = Column(Text, nullable=True)
    status = Column(String(20), nullable=False, default="Active")

    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now())

    __table_args__ = (
        UniqueConstraint(
            "template_id",
            "column_key",
            name="unique_material_balance_column_key_per_template",
        ),
        UniqueConstraint(
            "template_id",
            "column_label",
            name="unique_material_balance_column_label_per_template",
        ),
    )

class Table11Factor(Base):
    __tablename__ = "table11_factors"

    id = Column(Integer, primary_key=True, index=True)
    api60 = Column(Float, nullable=False, unique=True, index=True)
    lt_factor = Column(Float, nullable=False)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now())

class Trip(Base):
    __tablename__ = "trips"

    id = Column(Integer, primary_key=True, index=True)

    # Convoy / Voyage number (unique per trip)
    convoy_number = Column(String(50), nullable=False, unique=True, index=True)

    # Optional: a “main” barge code for convenience
    primary_barge_asset_code = Column(String(80), nullable=True)

    # OPEN / CLOSED
    status = Column(String(20), nullable=False, default="OPEN")

    created_by = Column(String(100), nullable=True)
    remarks = Column(Text, nullable=True)

    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now())


class TripEvent(Base):
    __tablename__ = "trip_events"

    id = Column(Integer, primary_key=True, index=True)

    trip_id = Column(
        Integer,
        ForeignKey("trips.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Examples: LOAD_1, LOAD_2_TOPUP, UNLOAD, STS_OUT, STS_IN, SHUTTLE_RECEIPT
    event_type = Column(String(50), nullable=False, index=True)

    # Location code (we use code to keep it simple with your existing design)
    location_code = Column(String(50), nullable=True, index=True)

    # Barge / Shuttle asset code
    asset_code = Column(String(80), nullable=False, index=True)

    # Link to your saved operation ticket (FK)
    operation_transaction_id = Column(
        Integer,
        ForeignKey("operation_transactions.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
    )

    # Timeline order under the convoy
    sequence_no = Column(Integer, nullable=False, default=1)

    event_datetime = Column(DateTime, nullable=True)

    created_by = Column(String(100), nullable=True)
    remarks = Column(Text, nullable=True)

    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now())

    __table_args__ = (
        UniqueConstraint(
            "trip_id",
            "sequence_no",
            name="unique_trip_event_trip_sequence",
        ),
        UniqueConstraint(
            "operation_transaction_id",
            name="unique_trip_event_operation_transaction",
        ),
    )


class TripComparison(Base):
    __tablename__ = "trip_comparisons"

    id = Column(Integer, primary_key=True, index=True)

    trip_id = Column(
        Integer,
        ForeignKey("trips.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Examples:
    # LOAD_AFTER_vs_UNLOAD_BEFORE, LOAD1_AFTER_vs_LOAD2_BEFORE, STS_OUT_NET
    comparison_type = Column(String(80), nullable=False, index=True)

    left_transaction_id = Column(
        Integer,
        ForeignKey("operation_transactions.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )

    right_transaction_id = Column(
        Integer,
        ForeignKey("operation_transactions.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )

    summary_json = Column(JSONB, nullable=True)
    per_tank_json = Column(JSONB, nullable=True)

    created_by = Column(String(100), nullable=True)
    remarks = Column(Text, nullable=True)

    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now())

    __table_args__ = (
        UniqueConstraint(
            "trip_id",
            "comparison_type",
            "left_transaction_id",
            "right_transaction_id",
            name="unique_trip_comparison_key",
        ),
    )

class CompanyReportProfile(Base):
    __tablename__ = "company_report_profiles"

    id = Column(Integer, primary_key=True, index=True)

    profile_name = Column(String(150), nullable=False, unique=True, index=True)
    company_name = Column(String(200), nullable=False)

    system_name = Column(
        String(200),
        nullable=False,
        default="Hydrocarbon Accounting System",
    )

    report_subtitle = Column(
        String(200),
        nullable=False,
        default="Tank Gauging Quantity Report",
    )

    logo_data_url = Column(Text, nullable=True)
    logo_text = Column(String(50), nullable=False, default="LOGO")

    footer_formula = Column(Text, nullable=True)
    footer_note = Column(Text, nullable=True)

    status = Column(String(20), nullable=False, default="Active")

    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now())


class DashboardConfig(Base):
    __tablename__ = "dashboard_configs"

    id = Column(Integer, primary_key=True, index=True)

    name = Column(String(150), nullable=False, index=True)
    scope_type = Column(String(20), nullable=False, index=True)
    location_code = Column(String(50), nullable=True, index=True)

    status = Column(String(20), nullable=False, default="Draft", index=True)

    active_version_id = Column(
        Integer,
        ForeignKey("dashboard_versions.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    created_by = Column(String(150), nullable=True)
    remarks = Column(Text, nullable=True)

    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now())

    __table_args__ = (
        UniqueConstraint(
            "name",
            "scope_type",
            "location_code",
            name="unique_dashboard_config_scope",
        ),
    )


class DashboardVersion(Base):
    __tablename__ = "dashboard_versions"

    id = Column(Integer, primary_key=True, index=True)

    config_id = Column(
        Integer,
        ForeignKey("dashboard_configs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    version_number = Column(Integer, nullable=False)
    config_json = Column(JSONB, nullable=False)

    change_note = Column(Text, nullable=True)
    created_by = Column(String(150), nullable=True)

    created_at = Column(DateTime, nullable=False, server_default=func.now())

    __table_args__ = (
        UniqueConstraint(
            "config_id",
            "version_number",
            name="unique_dashboard_version_per_config",
        ),
    )


class DashboardDataSource(Base):
    __tablename__ = "dashboard_data_sources"

    id = Column(Integer, primary_key=True, index=True)

    data_source_code = Column(String(120), nullable=False, index=True)
    data_source_name = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)

    handler_key = Column(String(120), nullable=False, index=True)
    allowed_params_json = Column(JSONB, nullable=False)

    status = Column(String(20), nullable=False, default="Active")
    created_by = Column(String(150), nullable=True)
    remarks = Column(Text, nullable=True)

    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now())

    __table_args__ = (
        UniqueConstraint(
            "data_source_code",
            name="unique_dashboard_data_source_code",
        ),
    )


class BargeSealMaster(Base):
    __tablename__ = "barge_seal_master"

    id = Column(Integer, primary_key=True, index=True)

    asset_code = Column(String(80), nullable=False, index=True)
    tank_id = Column(String(50), nullable=False, index=True)
    seal_position = Column(String(50), nullable=False, index=True)
    seal_number = Column(String(100), nullable=False)

    effective_date = Column(Date, nullable=True)

    remarks = Column(Text, nullable=True)
    status = Column(String(20), nullable=False, default="Active")

    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now())

    __table_args__ = (
        UniqueConstraint(
            "asset_code",
            "tank_id",
            "seal_position",
            name="unique_barge_seal_master_key",
        ),
    )

class FlowmeterConfig(Base):
    __tablename__ = "flowmeter_configs"

    id = Column(Integer, primary_key=True, index=True)

    location_code = Column(String(50), nullable=False, index=True)
    asset_code = Column(String(80), nullable=False, index=True)
    stream_name = Column(String(150), nullable=False, default="Default", index=True)
    meter_asset_code = Column(String(80), nullable=True, index=True)

    meter_label = Column(String(150), nullable=False)
    meter_factor = Column(Float, nullable=False, default=1.0)
    meter_unit = Column(String(10), nullable=False, default="bbls")  # bbls or m3
    calibration_date = Column(Date, nullable=True)

    remarks = Column(Text, nullable=True)
    status = Column(String(20), nullable=False, default="Active")

    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now())

    __table_args__ = (
        UniqueConstraint(
            "location_code",
            "asset_code",
            "stream_name",
            "meter_asset_code",
            "meter_label",
            name="unique_flowmeter_config_key",
        ),
    )


class FlowmeterRecord(Base):
    __tablename__ = "flowmeter_records"

    id = Column(Integer, primary_key=True, index=True)

    location_code = Column(String(50), nullable=False, index=True)
    asset_code = Column(String(80), nullable=False, index=True)
    meter_label = Column(String(150), nullable=False, index=True)

    reading_date = Column(Date, nullable=False, index=True)
    opening_reading = Column(Float, nullable=False, default=0)
    closing_reading = Column(Float, nullable=False, default=0)
    gross_observed = Column(Float, nullable=False, default=0)

    meter_factor = Column(Float, nullable=False, default=1.0)
    meter_unit = Column(String(10), nullable=False, default="bbls")
    net_standard = Column(Float, nullable=False, default=0)
    net_standard_bbl = Column(Float, nullable=False, default=0)

    created_by = Column(String(150), nullable=True)
    remarks = Column(Text, nullable=True)
    status = Column(String(20), nullable=False, default="Active")

    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now())

class FlowmeterConfigHistory(Base):
    __tablename__ = "flowmeter_config_history"

    id = Column(Integer, primary_key=True, index=True)
    config_id = Column(Integer, ForeignKey("flowmeter_configs.id", ondelete="CASCADE"), nullable=False, index=True)

    location_code = Column(String(50), nullable=False, index=True)
    asset_code = Column(String(80), nullable=False, index=True)
    stream_name = Column(String(150), nullable=False, default="Default", index=True)
    meter_asset_code = Column(String(80), nullable=True, index=True)
    meter_label = Column(String(150), nullable=False, index=True)

    old_meter_factor = Column(Float, nullable=True)
    new_meter_factor = Column(Float, nullable=True)
    old_meter_unit = Column(String(10), nullable=True)
    new_meter_unit = Column(String(10), nullable=True)
    old_calibration_date = Column(Date, nullable=True)
    new_calibration_date = Column(Date, nullable=True)
    old_status = Column(String(20), nullable=True)
    new_status = Column(String(20), nullable=True)

    change_action = Column(String(20), nullable=False, default="UPDATE")
    changed_by = Column(String(150), nullable=True)
    remarks = Column(Text, nullable=True)

    changed_at = Column(DateTime, nullable=False, server_default=func.now(), index=True)

class VesselOperation(Base):
    __tablename__ = "vessel_operations"

    id = Column(Integer, primary_key=True, index=True)

    location_code = Column(String(50), nullable=False, index=True)
    applicable_asset_type_code = Column(String(50), nullable=False, index=True)

    operation_code = Column(String(50), nullable=False, index=True)
    operation_label = Column(String(150), nullable=False)

    operation_category = Column(String(50), nullable=False, index=True)
    operation_sign = Column(String(20), nullable=False)  # IN / OUT / NEUTRAL / SET
    show_in = Column(String(20), nullable=False, default="Both")

    sort_order = Column(Integer, nullable=False, default=1)
    description = Column(Text, nullable=True)
    status = Column(String(20), nullable=False, default="Active")

    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now())

    __table_args__ = (
        UniqueConstraint(
            "location_code",
            "applicable_asset_type_code",
            "operation_code",
            name="unique_vessel_operation_code_per_location_asset_type",
        ),
        UniqueConstraint(
            "location_code",
            "applicable_asset_type_code",
            "operation_label",
            name="unique_vessel_operation_label_per_location_asset_type",
        ),
    )


class VesselStockLedger(Base):
    """
    Approved-only derived ledger for Shuttle Vessel / FSO (manual entry layouts).
    One row per approved operation transaction (unique transaction_id).
    """
    __tablename__ = "vessel_stock_ledger"

    id = Column(Integer, primary_key=True, index=True)

    transaction_id = Column(
        Integer,
        ForeignKey("operation_transactions.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
        unique=True,
    )

    ticket_number = Column(String(120), nullable=True, index=True)
    operation_number = Column(String(120), nullable=True, index=True)
    status = Column(String(20), nullable=False, default="Approved")

    location_code = Column(String(50), nullable=False, index=True)

    vessel_asset_code = Column(String(80), nullable=False, index=True)
    vessel_asset_name = Column(String(150), nullable=True)
    vessel_asset_type_code = Column(String(50), nullable=True, index=True)

    operation_date = Column(Date, nullable=False, index=True)
    product_name = Column(String(150), nullable=True)

    movement_reference = Column(String(120), nullable=True, index=True)

    vessel_operation_code = Column(String(50), nullable=True, index=True)
    vessel_operation_label = Column(String(150), nullable=True)
    vessel_operation_category = Column(String(50), nullable=True, index=True)
    vessel_operation_sign = Column(String(20), nullable=True)

    # Vessel Cycle (manual)
    qty_bbl = Column(Float, nullable=True, default=0)
    water_bbl = Column(Float, nullable=True, default=0)
    nsv_bbl = Column(Float, nullable=True, default=0)

    # Stock Movement (manual)
    opening_stock = Column(Float, nullable=True, default=0)
    opening_water = Column(Float, nullable=True, default=0)
    closing_stock = Column(Float, nullable=True, default=0)
    closing_water = Column(Float, nullable=True, default=0)
    net_stock = Column(Float, nullable=True, default=0)
    net_water = Column(Float, nullable=True, default=0)
    net_nsv = Column(Float, nullable=True, default=0)

    created_by = Column(String(150), nullable=True)
    remarks = Column(Text, nullable=True)

    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now())


class MovementMapping(Base):
    """
    Enterprise mapping layer to link many-to-many:
    Barge UNLOAD -> Shuttle Receipt -> FSO Receipt (etc.)
    """
    __tablename__ = "movement_mappings"

    id = Column(Integer, primary_key=True, index=True)

    mapping_type = Column(String(50), nullable=False, index=True)  # BARGE_TO_SHUTTLE, SHUTTLE_TO_FSO, etc.
    location_code = Column(String(50), nullable=False, index=True)

    reference_number = Column(String(120), nullable=False, index=True)  # Shuttle No / Batch / Voyage / etc.
    product_name = Column(String(150), nullable=True)

    status = Column(String(20), nullable=False, default="OPEN")  # OPEN/CLOSED

    remarks = Column(Text, nullable=True)

    created_by = Column(String(150), nullable=True)
    closed_by = Column(String(150), nullable=True)
    closed_at = Column(DateTime, nullable=True)

    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now())

    __table_args__ = (
        UniqueConstraint(
            "mapping_type",
            "location_code",
            "reference_number",
            name="unique_mapping_per_type_location_reference",
        ),
    )


class MovementMappingItem(Base):
    __tablename__ = "movement_mapping_items"

    id = Column(Integer, primary_key=True, index=True)

    mapping_id = Column(
        Integer,
        ForeignKey("movement_mappings.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    transaction_id = Column(
        Integer,
        ForeignKey("operation_transactions.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )

    role = Column(String(20), nullable=False)  # SOURCE / TARGET

    asset_code = Column(String(80), nullable=True, index=True)
    asset_type_code = Column(String(50), nullable=True, index=True)

    ticket_number = Column(String(120), nullable=True)
    operation_date = Column(Date, nullable=True)

    # Snapshot quantities at mapping time
    qty_bbl = Column(Float, nullable=True, default=0)
    water_bbl = Column(Float, nullable=True, default=0)
    nsv_bbl = Column(Float, nullable=True, default=0)

    created_at = Column(DateTime, nullable=False, server_default=func.now())

    __table_args__ = (
        UniqueConstraint(
            "mapping_id",
            "transaction_id",
            name="unique_mapping_item_per_transaction",
        ),
    )


class MovementMappingComparison(Base):
    __tablename__ = "movement_mapping_comparisons"

    id = Column(Integer, primary_key=True, index=True)

    mapping_id = Column(
        Integer,
        ForeignKey("movement_mappings.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )

    source_qty_bbl = Column(Float, nullable=True, default=0)
    source_water_bbl = Column(Float, nullable=True, default=0)
    source_nsv_bbl = Column(Float, nullable=True, default=0)

    target_qty_bbl = Column(Float, nullable=True, default=0)
    target_water_bbl = Column(Float, nullable=True, default=0)
    target_nsv_bbl = Column(Float, nullable=True, default=0)

    diff_nsv_bbl = Column(Float, nullable=True, default=0)
    diff_nsv_percent = Column(Float, nullable=True, default=0)

    summary_json = Column(JSONB, nullable=True)

    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now())

class ShuttleVoyage(Base):
    __tablename__ = "shuttle_voyages"

    id = Column(Integer, primary_key=True, index=True)

    location_code = Column(String(50), nullable=False, index=True)
    shuttle_number = Column(String(80), nullable=False, index=True)  # stored in convoy_number on tickets
    shuttle_asset_code = Column(String(80), nullable=False, index=True)

    status = Column(String(20), nullable=False, default="OPEN")  # OPEN / CLOSED

    created_by = Column(String(150), nullable=True)
    remarks = Column(Text, nullable=True)

    closed_by = Column(String(150), nullable=True)
    closed_at = Column(DateTime, nullable=True)
    closure_remarks = Column(Text, nullable=True)

    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now())

    __table_args__ = (
        UniqueConstraint(
            "location_code",
            "shuttle_number",
            "shuttle_asset_code",
            name="unique_shuttle_voyage_key",
        ),
    )

class FSOVoyage(Base):
    __tablename__ = "fso_voyages"

    id = Column(Integer, primary_key=True, index=True)

    # Location of the FSO operation (FSO location)
    location_code = Column(String(50), nullable=False, index=True)

    # Shuttle number is the base tracking reference (stored in convoy_number on tickets)
    shuttle_number = Column(String(80), nullable=False, index=True)

    # Primary asset on FSO tickets (the FSO asset code)
    fso_asset_code = Column(String(80), nullable=False, index=True)

    status = Column(String(20), nullable=False, default="OPEN")  # OPEN / CLOSED

    created_by = Column(String(150), nullable=True)
    remarks = Column(Text, nullable=True)

    closed_by = Column(String(150), nullable=True)
    closed_at = Column(DateTime, nullable=True)
    closure_remarks = Column(Text, nullable=True)

    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now())

    __table_args__ = (
        UniqueConstraint(
            "location_code",
            "shuttle_number",
            "fso_asset_code",
            name="unique_fso_voyage_key",
        ),
    )


class TokenBlacklist(Base):
    __tablename__ = "token_blacklist"

    id = Column(Integer, primary_key=True, index=True)
    token_hash = Column(String(200), nullable=False, unique=True, index=True)
    expires_at = Column(DateTime, nullable=False, index=True)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
