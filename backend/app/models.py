from sqlalchemy import Column, Date, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, Float, Time
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func
from datetime import datetime
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
    status = Column(String(20), nullable=False, default="Active")
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now())


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

    changed_at = Column(DateTime, default=datetime.utcnow, nullable=False)

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

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
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

class BargeSealMaster(Base):
    __tablename__ = "barge_seal_master"

    id = Column(Integer, primary_key=True, index=True)

    # Barge asset code (YADE-01)
    asset_code = Column(String(80), nullable=False, index=True)

    # Tank id or special group code:
    # examples: C1, C2, P1... or PORT_MANIFOLD, STBD_MANIFOLD, PUMPROOM
    tank_id = Column(String(50), nullable=False, index=True)

    # Seal position:
    # tank examples: MH1, MH2, LOCK, DIPHATCH
    # manifold/pumproom examples: S1, S2, S3...
    seal_position = Column(String(50), nullable=False, index=True)

    seal_number = Column(String(100), nullable=False)

    # Optional effective date (same master can be revised by date later if needed)
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
