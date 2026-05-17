from datetime import date, datetime, time
from typing import Any, Optional
from datetime import date, datetime
from typing import Optional, Any
from pydantic import BaseModel, ConfigDict
from pydantic import BaseModel, ConfigDict, EmailStr


class UserBase(BaseModel):
    full_name: str
    username: str
    email: EmailStr
    phone: Optional[str] = None
    department: Optional[str] = None
    designation: Optional[str] = None
    status: str = "Active"


class UserCreate(UserBase):
    password: str


class UserUpdate(UserBase):
    password: Optional[str] = None


class UserResponse(UserBase):
    id: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)



class RoleBase(BaseModel):
    role_name: str
    description: Optional[str] = None
    status: str = "Active"


class RoleCreate(RoleBase):
    pass


class RoleResponse(RoleBase):
    id: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class PermissionBase(BaseModel):
    permission_name: str
    module_name: str
    description: Optional[str] = None
    status: str = "Active"


class PermissionCreate(PermissionBase):
    pass


class PermissionResponse(PermissionBase):
    id: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class RolePermissionSaveRequest(BaseModel):
    permission_ids: list[int]


class RolePermissionItem(BaseModel):
    id: int
    permission_id: int
    permission_name: str
    module_name: str
    description: Optional[str] = None
    status: str


class RolePermissionResponse(BaseModel):
    role_id: int
    role_name: str
    permissions: list[RolePermissionItem]


class UserRoleSaveRequest(BaseModel):
    user_id: int
    role_id: int


class UserRoleResponse(BaseModel):
    id: int
    user_id: int
    full_name: str
    username: str
    role_id: int
    role_name: str


class LocationBase(BaseModel):
    location_name: str
    location_code: str
    location_type: str
    parent_location_code: Optional[str] = None
    description: Optional[str] = None
    status: str = "Active"


class LocationCreate(LocationBase):
    pass


class LocationResponse(LocationBase):
    id: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# -------------------------
# Location Accounting Day Setting Schemas
# -------------------------

class LocationAccountingDaySettingBase(BaseModel):
    location_code: str
    day_start_time: time
    day_end_time: time
    effective_from: date
    effective_to: Optional[date] = None
    timezone_name: str = "Africa/Lagos"
    description: Optional[str] = None
    status: str = "Active"


class LocationAccountingDaySettingCreate(LocationAccountingDaySettingBase):
    pass


class LocationAccountingDaySettingResponse(LocationAccountingDaySettingBase):
    id: int
    location_name: str
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AssetTypeBase(BaseModel):
    asset_type_name: str
    asset_type_code: str
    description: Optional[str] = None
    status: str = "Active"


class AssetTypeCreate(AssetTypeBase):
    pass


class AssetTypeResponse(AssetTypeBase):
    id: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AssetBase(BaseModel):
    asset_name: str
    asset_code: str
    asset_scope: str
    asset_type_code: str
    location_code: Optional[str] = None
    serial_number: Optional[str] = None
    manufacturer: Optional[str] = None
    model: Optional[str] = None
    commission_date: Optional[date] = None
    description: Optional[str] = None
    status: str = "Active"


class AssetCreate(AssetBase):
    pass


class AssetResponse(AssetBase):
    id: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)

class CalibrationTemplateColumnBase(BaseModel):
    column_name: str
    data_type: str
    unit: Optional[str] = None
    is_required: str = "Yes"
    interpolation_role: str = "None"
    sort_order: int = 1


class CalibrationTemplateColumnCreate(CalibrationTemplateColumnBase):
    pass


class CalibrationTemplateColumnResponse(CalibrationTemplateColumnBase):
    id: int

    model_config = ConfigDict(from_attributes=True)


class CalibrationTemplateBase(BaseModel):
    template_name: str
    asset_type_code: str
    calibration_type: str
    description: Optional[str] = None
    status: str = "Active"


class CalibrationTemplateCreate(CalibrationTemplateBase):
    columns: list[CalibrationTemplateColumnCreate]


class CalibrationTemplateResponse(CalibrationTemplateBase):
    id: int
    created_at: datetime
    updated_at: datetime
    columns: list[CalibrationTemplateColumnResponse]

    model_config = ConfigDict(from_attributes=True)


class AssetCalibrationDataRowBase(BaseModel):
    row_number: int
    row_data: dict


class AssetCalibrationDataRowCreate(AssetCalibrationDataRowBase):
    pass


class AssetCalibrationDataRowResponse(AssetCalibrationDataRowBase):
    id: int

    model_config = ConfigDict(from_attributes=True)


class AssetCalibrationTableBase(BaseModel):
    calibration_name: str
    asset_code: str
    template_id: int
    effective_date: Optional[date] = None
    remarks: Optional[str] = None
    status: str = "Active"


class AssetCalibrationTableCreate(AssetCalibrationTableBase):
    rows: list[AssetCalibrationDataRowCreate]


class AssetCalibrationTableResponse(AssetCalibrationTableBase):
    id: int
    asset_name: str
    template_name: str
    created_at: datetime
    updated_at: datetime
    rows: list[AssetCalibrationDataRowResponse]

    model_config = ConfigDict(from_attributes=True)


class AssetAssignmentBase(BaseModel):
    asset_code: str
    asset_scope: str
    assignment_location_code: str
    assigned_to_type: str
    assigned_to: str
    assignment_date: date
    return_date: Optional[date] = None
    remarks: Optional[str] = None
    status: str = "Active"


class AssetAssignmentCreate(AssetAssignmentBase):
    pass


class AssetAssignmentResponse(AssetAssignmentBase):
    id: int
    asset_name: str
    assignment_location_name: str
    assigned_to_display: str
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class OperationTypeBase(BaseModel):
    operation_type_name: str
    operation_type_code: str
    applicable_asset_type_code: str
    operation_category: str
    requires_sender_location: str = "No"
    requires_receiver_location: str = "No"
    requires_comparison: str = "No"
    requires_approval: str = "No"
    description: Optional[str] = None
    status: str = "Active"


class OperationTypeCreate(OperationTypeBase):
    pass


class OperationTypeResponse(OperationTypeBase):
    id: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# -------------------------
# Tank Operation Master Schemas
# -------------------------

class TankOperationBase(BaseModel):
    location_code: str
    operation_code: str
    operation_label: str
    operation_category: str
    operation_sign: str
    sort_order: int = 1
    description: Optional[str] = None
    status: str = "Active"


class TankOperationCreate(TankOperationBase):
    pass


class TankOperationResponse(TankOperationBase):
    id: int
    location_name: str
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# -------------------------
# Tank Stock Ledger Schemas
# -------------------------

class TankStockLedgerResponse(BaseModel):
    id: int

    transaction_id: int
    ticket_number: str
    operation_number: str

    location_code: str
    location_name: Optional[str] = None

    tank_asset_code: str
    tank_asset_name: Optional[str] = None

    operation_date: date
    product_name: Optional[str] = None

    accounting_date: Optional[date] = None
    accounting_day_start: Optional[datetime] = None
    accounting_day_end: Optional[datetime] = None
    accounting_day_setting_id: Optional[int] = None

    tank_operation_code: str
    tank_operation_label: str
    tank_operation_category: str
    tank_operation_sign: str

    movement_gsv_bbl: Optional[float] = 0
    movement_nsv_bbl: Optional[float] = 0
    movement_lt: Optional[float] = 0
    movement_mt: Optional[float] = 0

    stock_gsv_bbl: Optional[float] = 0
    stock_nsv_bbl: Optional[float] = 0
    stock_lt: Optional[float] = 0
    stock_mt: Optional[float] = 0

    previous_stock_gsv_bbl: Optional[float] = 0
    previous_stock_nsv_bbl: Optional[float] = 0
    previous_stock_lt: Optional[float] = 0
    previous_stock_mt: Optional[float] = 0

    running_balance_gsv_bbl: Optional[float] = 0
    running_balance_nsv_bbl: Optional[float] = 0
    running_balance_lt: Optional[float] = 0
    running_balance_mt: Optional[float] = 0

    status: str
    created_by: Optional[str] = None
    remarks: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class TankStockLedgerSummaryResponse(BaseModel):
    location_code: str
    location_name: Optional[str] = None
    tank_asset_code: str
    tank_asset_name: Optional[str] = None
    product_name: Optional[str] = None

    opening_nsv_bbl: float = 0
    total_in_nsv_bbl: float = 0
    total_out_nsv_bbl: float = 0
    closing_nsv_bbl: float = 0

    opening_lt: float = 0
    total_in_lt: float = 0
    total_out_lt: float = 0
    closing_lt: float = 0

    opening_mt: float = 0
    total_in_mt: float = 0
    total_out_mt: float = 0
    closing_mt: float = 0


class TankStockLedgerDailySummaryResponse(BaseModel):
    accounting_date: date

    location_code: str
    location_name: Optional[str] = None

    tank_asset_code: str
    tank_asset_name: Optional[str] = None

    product_name: Optional[str] = None

    opening_gsv_bbl: float = 0
    opening_nsv_bbl: float = 0
    opening_lt: float = 0
    opening_mt: float = 0

    total_in_gsv_bbl: float = 0
    total_in_nsv_bbl: float = 0
    total_in_lt: float = 0
    total_in_mt: float = 0

    total_out_gsv_bbl: float = 0
    total_out_nsv_bbl: float = 0
    total_out_lt: float = 0
    total_out_mt: float = 0

    book_closing_gsv_bbl: float = 0
    book_closing_nsv_bbl: float = 0
    book_closing_lt: float = 0
    book_closing_mt: float = 0

    actual_closing_gsv_bbl: float = 0
    actual_closing_nsv_bbl: float = 0
    actual_closing_lt: float = 0
    actual_closing_mt: float = 0

    loss_gain_gsv_bbl: float = 0
    loss_gain_nsv_bbl: float = 0
    loss_gain_lt: float = 0
    loss_gain_mt: float = 0

    rows_count: int = 0
    last_ticket_number: Optional[str] = None

class LocationOperationAvailabilityBase(BaseModel):
    location_code: str
    operation_type_code: str
    status: str = "Active"
    remarks: Optional[str] = None


class LocationOperationAvailabilityCreate(LocationOperationAvailabilityBase):
    pass


class LocationOperationAvailabilityResponse(LocationOperationAvailabilityBase):
    id: int
    location_name: str
    operation_type_name: str
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
    
class OperationTransactionBase(BaseModel):
    operation_type_code: str
    primary_asset_code: str
    convoy_number: Optional[str] = None
    origin_location_code: str
    destination_location_code: Optional[str] = None
    sender_location_code: Optional[str] = None
    receiver_location_code: Optional[str] = None
    operation_date: date
    operation_start_datetime: Optional[datetime] = None
    operation_end_datetime: Optional[datetime] = None
    product_name: Optional[str] = None
    created_by: Optional[str] = None
    remarks: Optional[str] = None
    status: str = "Draft"


class OperationTransactionCreate(OperationTransactionBase):
    pass


class OperationTransactionResponse(OperationTransactionBase):
    id: int
    operation_number: str
    operation_ticket_number: Optional[str] = None
    ticket_number: Optional[str] = None
    primary_asset_type_code: str
    operation_type_name: str
    primary_asset_name: str
    origin_location_name: Optional[str] = None
    destination_location_name: Optional[str] = None
    sender_location_name: Optional[str] = None
    receiver_location_name: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)

class OperationTransactionStatusHistoryResponse(BaseModel):
    id: int
    transaction_id: int
    old_status: Optional[str] = None
    new_status: str
    changed_by: Optional[str] = None
    remarks: Optional[str] = None
    changed_at: datetime

    model_config = ConfigDict(from_attributes=True)

class OperationTransactionStatusUpdate(BaseModel):
    status: str
    remarks: Optional[str] = None
    changed_by: Optional[str] = None

# -------------------------
# Trip / Convoy Tracking Schemas
# -------------------------

class TripBase(BaseModel):
    convoy_number: str
    primary_barge_asset_code: Optional[str] = None
    status: str = "OPEN"
    remarks: Optional[str] = None


class TripCreate(TripBase):
    pass


class TripResponse(TripBase):
    id: int
    created_by: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class TripEventCreate(BaseModel):
    convoy_number: str
    event_type: str
    location_code: Optional[str] = None
    asset_code: str
    operation_transaction_id: Optional[int] = None
    sequence_no: Optional[int] = None
    event_datetime: Optional[datetime] = None
    remarks: Optional[str] = None


class TripEventResponse(BaseModel):
    id: int
    trip_id: int
    convoy_number: str
    event_type: str
    location_code: Optional[str] = None
    asset_code: str
    operation_transaction_id: Optional[int] = None
    sequence_no: int
    event_datetime: Optional[datetime] = None
    created_by: Optional[str] = None
    remarks: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class TripComparisonCreate(BaseModel):
    convoy_number: str
    comparison_type: str
    left_transaction_id: int
    right_transaction_id: int
    summary_json: Optional[Any] = None
    per_tank_json: Optional[Any] = None
    remarks: Optional[str] = None


class TripComparisonResponse(BaseModel):
    id: int
    trip_id: int
    convoy_number: str
    comparison_type: str
    left_transaction_id: int
    right_transaction_id: int
    summary_json: Optional[Any] = None
    per_tank_json: Optional[Any] = None
    created_by: Optional[str] = None
    remarks: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class ConvoyTrackerTicket(BaseModel):
    transaction_id: int
    ticket_number: str
    operation_type_code: str
    operation_type_name: str
    operation_date: date
    origin_location_code: str
    origin_location_name: Optional[str] = None
    destination_location_code: Optional[str] = None
    destination_location_name: Optional[str] = None
    status: str


class ConvoyTrackerAssetGroup(BaseModel):
    asset_code: str
    asset_name: str
    tickets: list[ConvoyTrackerTicket]


class ConvoyTrackerResponse(BaseModel):
    convoy_number: str
    total_tickets: int
    assets: list[ConvoyTrackerAssetGroup]

# -------------------------
# Audit Log Schemas
# -------------------------

class AuditLogResponse(BaseModel):
    id: int
    module_name: str
    action: str
    entity_type: Optional[str] = None
    entity_id: Optional[int] = None
    entity_label: Optional[str] = None
    ticket_number: Optional[str] = None
    operation_number: Optional[str] = None
    old_status: Optional[str] = None
    new_status: Optional[str] = None
    performed_by: Optional[str] = None
    remarks: Optional[str] = None
    request_path: Optional[str] = None
    details: Optional[Any] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)

class OperationEntryValueCreate(BaseModel):
    field_code: str
    field_value: Optional[Any] = None


class OperationEntryCreate(BaseModel):
    operation_template_id: int
    transaction: OperationTransactionCreate
    values: list[OperationEntryValueCreate]


class OperationEntryValueResponse(BaseModel):
    id: int
    field_code: str
    field_name: str
    field_group: str
    data_type: str
    unit: Optional[str] = None
    input_mode: str
    calculation_role: str
    field_value: Optional[Any] = None
    sort_order: int

    model_config = ConfigDict(from_attributes=True)


class OperationEntryResponse(BaseModel):
    transaction: OperationTransactionResponse
    operation_template_id: int
    operation_template_name: str
    values: list[OperationEntryValueResponse]


class OperationTemplateFieldBase(BaseModel):
    field_name: str
    field_code: str
    field_group: str = "General"
    data_type: str
    unit: Optional[str] = None
    is_required: str = "Yes"
    input_mode: str = "Manual"
    calculation_role: str = "Input"
    sort_order: int = 1
    status: str = "Active"


class OperationTemplateFieldCreate(OperationTemplateFieldBase):
    pass


class OperationTemplateFieldResponse(OperationTemplateFieldBase):
    id: int

    model_config = ConfigDict(from_attributes=True)


class OperationTemplateBase(BaseModel):
    template_name: str
    operation_type_code: str
    entry_layout_type: str = "Standard Form"
    calculation_engine: str = "None"
    description: Optional[str] = None
    status: str = "Active"


class OperationTemplateCreate(OperationTemplateBase):
    fields: list[OperationTemplateFieldCreate]


class OperationTemplateResponse(OperationTemplateBase):
    id: int
    operation_type_name: str
    created_at: datetime
    updated_at: datetime
    fields: list[OperationTemplateFieldResponse]

    model_config = ConfigDict(from_attributes=True)

# -------------------------
# Common Table 11 Factor Schemas
# -------------------------

class Table11FactorCreate(BaseModel):
    api60: float
    lt_factor: float


class Table11FactorBulkCreate(BaseModel):
    rows: list[Table11FactorCreate]


class Table11FactorResponse(BaseModel):
    id: int
    api60: float
    lt_factor: float
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class Table11LookupResponse(BaseModel):
    api60: float
    lower_api60: float | None = None
    upper_api60: float | None = None
    lt_factor: float
    lookup_method: str

# -------------------------
# Company Report Profile Schemas
# -------------------------

class CompanyReportProfileBase(BaseModel):
    profile_name: str
    company_name: str
    system_name: str = "Hydrocarbon Accounting System"
    report_subtitle: str = "Tank Gauging Quantity Report"
    logo_data_url: Optional[str] = None
    logo_text: str = "LOGO"
    footer_formula: Optional[str] = None
    footer_note: Optional[str] = None
    status: str = "Active"


class CompanyReportProfileCreate(CompanyReportProfileBase):
    pass


class CompanyReportProfileResponse(CompanyReportProfileBase):
    id: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)

# -------------------------
# Barge Seal Master Schemas
# -------------------------

class BargeSealMasterRowBase(BaseModel):
    tank_id: str
    seal_position: str
    seal_number: str
    remarks: Optional[str] = None
    status: str = "Active"


class BargeSealMasterRowCreate(BargeSealMasterRowBase):
    pass


class BargeSealMasterBulkSaveRequest(BaseModel):
    asset_code: str
    effective_date: Optional[date] = None
    rows: list[BargeSealMasterRowCreate]


class BargeSealMasterResponse(BargeSealMasterRowBase):
    id: int
    asset_code: str
    effective_date: Optional[date] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
