from datetime import date, datetime, time
from typing import Any, Optional
from pydantic import BaseModel, ConfigDict, EmailStr, Field


# ---------------------------------------------------------------------------
# Auth schemas
# ---------------------------------------------------------------------------

class LoginRequest(BaseModel):
    username: str
    password: str


class TwoFAVerifyRequest(BaseModel):
    challenge_id: str
    code: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=12)
    confirm_password: str


class ForgotPasswordRequest(BaseModel):
    username: str
    reason: str | None = None
    reset_2fa: bool = False


class AdminResetPasswordRequest(BaseModel):
    new_password: str = Field(min_length=12)
    force_password_change: bool = True
    reset_2fa: bool = False
    remarks: str | None = None


class TwoFASetupVerifyRequest(BaseModel):
    code: str


class TwoFADisableRequest(BaseModel):
    current_password: str
    code: str


class DevResetPasswordRequest(BaseModel):
    username: str
    new_password: str = Field(min_length=12)


class RefreshTokenRequest(BaseModel):
    refresh_token: str


# ---------------------------------------------------------------------------
# User schemas
# ---------------------------------------------------------------------------

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


class OperationWorkflowPolicyBase(BaseModel):
    policy_name: str
    action_code: str
    operation_type_code: Optional[str] = None
    operation_template_id: Optional[int] = None
    asset_type_code: Optional[str] = None
    location_code: Optional[str] = None
    priority: int = 100
    status: str = "Active"


class OperationWorkflowPolicyRoleAssignRequest(BaseModel):
    role_ids: list[int] = []


class OperationWorkflowPolicyUserAssignItem(BaseModel):
    user_id: int
    mode: str = "ALLOW"


class OperationWorkflowPolicyUserAssignRequest(BaseModel):
    users: list[OperationWorkflowPolicyUserAssignItem] = []


class OperationWorkflowPolicyCreate(OperationWorkflowPolicyBase):
    role_ids: list[int] = []
    users: list[OperationWorkflowPolicyUserAssignItem] = []


class OperationWorkflowPolicyUpdate(BaseModel):
    policy_name: Optional[str] = None
    action_code: Optional[str] = None
    operation_type_code: Optional[str] = None
    operation_template_id: Optional[int] = None
    asset_type_code: Optional[str] = None
    location_code: Optional[str] = None
    priority: Optional[int] = None
    status: Optional[str] = None


class OperationWorkflowPolicyRoleItem(BaseModel):
    role_id: int
    role_name: str


class OperationWorkflowPolicyUserItem(BaseModel):
    user_id: int
    username: str
    full_name: str
    mode: str


class OperationWorkflowPolicyResponse(OperationWorkflowPolicyBase):
    id: int
    roles: list[OperationWorkflowPolicyRoleItem] = []
    users: list[OperationWorkflowPolicyUserItem] = []
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class OperationWorkflowPolicyCheckRequest(BaseModel):
    action_code: str
    operation_type_code: Optional[str] = None
    operation_template_id: Optional[int] = None
    asset_type_code: Optional[str] = None
    location_code: Optional[str] = None


class OperationWorkflowPolicyCheckResponse(BaseModel):
    allowed: bool
    reason: str
    matched_policy_id: Optional[int] = None
    matched_policy_name: Optional[str] = None


class OperationTaskActionRequest(BaseModel):
    remarks: Optional[str] = None


class OperationTaskResponse(BaseModel):
    id: int
    task_number: str
    task_type: str
    transaction_id: Optional[int] = None
    ticket_number: Optional[str] = None
    operation_number: Optional[str] = None
    operation_type_code: Optional[str] = None
    operation_template_id: Optional[int] = None
    asset_type_code: Optional[str] = None
    primary_asset_code: Optional[str] = None
    location_code: Optional[str] = None
    raised_by_user_id: Optional[int] = None
    assigned_policy_id: Optional[int] = None
    assigned_role_ids_json: Optional[Any] = None
    assigned_user_ids_json: Optional[Any] = None
    status: str
    priority: str
    due_at: Optional[datetime] = None
    taken_by_user_id: Optional[int] = None
    taken_at: Optional[datetime] = None
    acted_by_user_id: Optional[int] = None
    acted_at: Optional[datetime] = None
    action_taken: Optional[str] = None
    remarks: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    transaction: Optional[Any] = None

    model_config = ConfigDict(from_attributes=True)


class OperationTaskEventResponse(BaseModel):
    id: int
    task_id: int
    event_type: str
    old_status: Optional[str] = None
    new_status: Optional[str] = None
    actor_user_id: Optional[int] = None
    actor_display: Optional[str] = None
    notes: Optional[str] = None
    details: Optional[Any] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ApprovedTransactionCorrectionRequestCreate(BaseModel):
    request_type: str
    suggested_action: str
    reason: str


class ApprovedTransactionCorrectionAdminAction(BaseModel):
    remarks: Optional[str] = None


class ApprovedTransactionCorrectionRequestResponse(BaseModel):
    id: int
    request_number: str
    transaction_id: int
    task_id: Optional[int] = None
    ticket_number: Optional[str] = None
    operation_number: Optional[str] = None
    request_type: str
    suggested_action: str
    reason: str
    status: str
    requested_by_user_id: Optional[int] = None
    requested_by_display: Optional[str] = None
    requested_at: datetime
    admin_action: Optional[str] = None
    admin_remarks: Optional[str] = None
    admin_user_id: Optional[int] = None
    admin_action_at: Optional[datetime] = None
    previous_status_before_revoke: Optional[str] = None
    new_status_after_revoke: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


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

# -------------------------
# Prime Mover - Tanker Link Schemas
# -------------------------

class PrimeMoverTankerLinkBase(BaseModel):
    prime_mover_asset_code: str
    tanker_asset_code: str
    linked_from: date
    linked_to: Optional[date] = None
    remarks: Optional[str] = None
    status: str = "Active"


class PrimeMoverTankerLinkCreate(PrimeMoverTankerLinkBase):
    pass


class PrimeMoverTankerLinkResponse(PrimeMoverTankerLinkBase):
    id: int

    prime_mover_asset_name: Optional[str] = None
    prime_mover_asset_type_code: Optional[str] = None

    tanker_asset_name: Optional[str] = None
    tanker_asset_type_code: Optional[str] = None
    tanker_chassis_number: Optional[str] = None

    created_by: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class CurrentPrimeMoverTankerLinkResponse(BaseModel):
    has_active_link: bool
    link: Optional[PrimeMoverTankerLinkResponse] = None

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
# Vessel Operation Schemas
# -------------------------

class VesselOperationBase(BaseModel):
    location_code: str
    applicable_asset_type_code: str

    operation_code: str
    operation_label: str

    operation_category: str
    operation_sign: str
    show_in: str = "Both"  # Entry / Tracking / Both

    sort_order: int = 1
    description: Optional[str] = None
    status: str = "Active"


class VesselOperationCreate(VesselOperationBase):
    pass


class VesselOperationResponse(VesselOperationBase):
    id: int
    location_name: str
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# -------------------------
# Vessel Stock Ledger Schemas
# -------------------------

class VesselStockLedgerResponse(BaseModel):
    id: int
    transaction_id: int

    ticket_number: Optional[str] = None
    operation_number: Optional[str] = None
    status: str

    location_code: str
    location_name: Optional[str] = None

    vessel_asset_code: str
    vessel_asset_name: Optional[str] = None
    vessel_asset_type_code: Optional[str] = None

    operation_date: date
    product_name: Optional[str] = None

    movement_reference: Optional[str] = None

    vessel_operation_code: Optional[str] = None
    vessel_operation_label: Optional[str] = None
    vessel_operation_category: Optional[str] = None
    vessel_operation_sign: Optional[str] = None

    qty_bbl: Optional[float] = 0
    water_bbl: Optional[float] = 0
    nsv_bbl: Optional[float] = 0

    opening_stock: Optional[float] = 0
    opening_water: Optional[float] = 0
    closing_stock: Optional[float] = 0
    closing_water: Optional[float] = 0
    net_stock: Optional[float] = 0
    net_water: Optional[float] = 0
    net_nsv: Optional[float] = 0

    created_by: Optional[str] = None
    remarks: Optional[str] = None

    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# -------------------------
# Movement Mapping Schemas
# -------------------------

class MovementMappingCreate(BaseModel):
    mapping_type: str
    location_code: str
    reference_number: str
    product_name: Optional[str] = None
    remarks: Optional[str] = None


class MovementMappingItemAddRequest(BaseModel):
    role: str  # SOURCE / TARGET
    transaction_ids: list[int]


class MovementMappingItemResponse(BaseModel):
    id: int
    mapping_id: int
    transaction_id: int
    role: str

    asset_code: Optional[str] = None
    asset_type_code: Optional[str] = None

    ticket_number: Optional[str] = None
    operation_date: Optional[date] = None

    qty_bbl: Optional[float] = 0
    water_bbl: Optional[float] = 0
    nsv_bbl: Optional[float] = 0

    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class MovementMappingComparisonResponse(BaseModel):
    id: int
    mapping_id: int

    source_qty_bbl: Optional[float] = 0
    source_water_bbl: Optional[float] = 0
    source_nsv_bbl: Optional[float] = 0

    target_qty_bbl: Optional[float] = 0
    target_water_bbl: Optional[float] = 0
    target_nsv_bbl: Optional[float] = 0

    diff_nsv_bbl: Optional[float] = 0
    diff_nsv_percent: Optional[float] = 0

    summary_json: Optional[dict] = None

    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class MovementMappingResponse(BaseModel):
    id: int
    mapping_type: str
    location_code: str
    reference_number: str
    product_name: Optional[str] = None
    status: str
    remarks: Optional[str] = None

    created_by: Optional[str] = None
    closed_by: Optional[str] = None
    closed_at: Optional[datetime] = None

    created_at: datetime
    updated_at: datetime

    items: list[MovementMappingItemResponse] = []
    comparison: Optional[MovementMappingComparisonResponse] = None

    model_config = ConfigDict(from_attributes=True)

class ShuttleVoyageCloseRequest(BaseModel):
    location_code: str
    shuttle_number: str
    shuttle_asset_code: str
    closure_remarks: Optional[str] = None


class ShuttleVoyageReopenRequest(BaseModel):
    location_code: str
    shuttle_number: str
    shuttle_asset_code: str
    remarks: Optional[str] = None


class ShuttleVoyageResponse(BaseModel):
    id: int
    location_code: str
    shuttle_number: str
    shuttle_asset_code: str
    status: str

    created_by: Optional[str] = None
    remarks: Optional[str] = None

    closed_by: Optional[str] = None
    closed_at: Optional[datetime] = None
    closure_remarks: Optional[str] = None

    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ShuttleTrackingTicketResponse(BaseModel):
    transaction_id: int
    ticket_number: Optional[str] = None
    operation_number: Optional[str] = None

    location_code: str
    location_name: str

    shuttle_number: str
    shuttle_asset_code: str
    shuttle_asset_name: str

    product_name: Optional[str] = None
    operation_date: Optional[date] = None
    event_time: Optional[str] = None

    opening_stock_bbl: float = 0
    opening_water_bbl: float = 0
    closing_stock_bbl: float = 0
    closing_water_bbl: float = 0

    net_stock_bbl: float = 0
    net_water_bbl: float = 0

    barge_reference: Optional[str] = None
    remarks: Optional[str] = None

    vessel_operation_code: Optional[str] = None
    vessel_operation_label: Optional[str] = None
    vessel_operation_category: Optional[str] = None
    vessel_operation_sign: Optional[str] = None

    tov_bbl: float = 0
    free_water_bbl: float = 0
    nsv_bbl: float = 0

    status: str = ""
    created_by: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class ShuttleTrackingGroupResponse(BaseModel):
    group_key: str

    location_code: str
    location_name: str

    shuttle_number: str
    shuttle_asset_code: str
    shuttle_asset_name: str

    voyage_status: str = "OPEN"
    closed_by: Optional[str] = None
    closed_at: Optional[datetime] = None
    closure_remarks: Optional[str] = None

    total_tov_bbl: float = 0
    total_free_water_bbl: float = 0
    total_nsv_bbl: float = 0

    net_receipt_bbl: float = 0
    net_discharge_bbl: float = 0

    tickets: list[ShuttleTrackingTicketResponse] = []


class ShuttleTrackingResponse(BaseModel):
    rows: list[ShuttleTrackingGroupResponse] = []
    total_groups: int = 0

    # ✅ NEW: pagination metadata
    page: int = 1
    page_size: int = 20
    has_more: bool = False

class FSOVoyageCloseRequest(BaseModel):
    location_code: str
    shuttle_number: str
    fso_asset_code: str
    closure_remarks: Optional[str] = None


class FSOVoyageReopenRequest(BaseModel):
    location_code: str
    shuttle_number: str
    fso_asset_code: str
    remarks: Optional[str] = None


class FSOVoyageResponse(BaseModel):
    id: int
    location_code: str
    shuttle_number: str
    fso_asset_code: str
    status: str

    created_by: Optional[str] = None
    remarks: Optional[str] = None

    closed_by: Optional[str] = None
    closed_at: Optional[datetime] = None
    closure_remarks: Optional[str] = None

    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class FSOTrackingTicketResponse(BaseModel):
    transaction_id: int
    ticket_number: Optional[str] = None
    operation_number: Optional[str] = None

    location_code: str
    location_name: str

    shuttle_number: str
    fso_asset_code: str
    fso_asset_name: str

    product_name: Optional[str] = None
    operation_date: Optional[date] = None
    event_time: Optional[str] = None

    operation_label: Optional[str] = None  # Receipt / Export / Stock Opening (soft-coded)
    vessel_name: Optional[str] = None
    vessel_quantity_bbl: float = 0

    opening_stock_bbl: float = 0
    opening_water_bbl: float = 0
    closing_stock_bbl: float = 0
    closing_water_bbl: float = 0

    net_stock_bbl: float = 0
    net_water_bbl: float = 0
    variance_bbl: float = 0

    remarks: Optional[str] = None

    status: str = ""
    created_by: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class FSOTrackingGroupResponse(BaseModel):
    group_key: str

    location_code: str
    location_name: str

    shuttle_number: str
    fso_asset_code: str
    fso_asset_name: str

    voyage_status: str = "OPEN"
    closed_by: Optional[str] = None
    closed_at: Optional[datetime] = None
    closure_remarks: Optional[str] = None

    # OTR-style summary (like old fso_operations.py)
    total_receipts_bbl: float = 0
    total_exports_bbl: float = 0
    total_water_in_bbl: float = 0
    total_water_out_bbl: float = 0
    net_water_bbl: float = 0
    loss_gain_bbl: float = 0
    total_variance_bbl: float = 0

    # ✅ Compare fields

    shuttle_discharge_bbl: float = 0
    fso_receipt_bbl: float = 0
    variance_bbl: float = 0

    tickets: list[FSOTrackingTicketResponse] = []


class FSOTrackingResponse(BaseModel):
    rows: list[FSOTrackingGroupResponse] = []
    total_groups: int = 0

    page: int = 1
    page_size: int = 20
    has_more: bool = False

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

# -------------------------
# Out-Turn Report Schemas
# -------------------------

class OutTurnReportResponse(BaseModel):
    ledger_id: int
    transaction_id: int

    ticket_number: str
    operation_number: str

    accounting_date: Optional[date] = None
    operation_datetime: Optional[datetime] = None

    location_code: str
    location_name: Optional[str] = None

    tank_asset_code: str
    tank_asset_name: Optional[str] = None

    product_name: Optional[str] = None

    tank_operation_code: str
    tank_operation_label: str
    tank_operation_category: str
    tank_operation_sign: str

    previous_stock_gsv_bbl: float = 0
    previous_stock_nsv_bbl: float = 0
    previous_stock_lt: float = 0
    previous_stock_mt: float = 0

    stock_after_gsv_bbl: float = 0
    stock_after_nsv_bbl: float = 0
    stock_after_lt: float = 0
    stock_after_mt: float = 0

    net_receipt_gsv_bbl: float = 0
    net_receipt_nsv_bbl: float = 0
    net_receipt_lt: float = 0
    net_receipt_mt: float = 0

    net_dispatch_gsv_bbl: float = 0
    net_dispatch_nsv_bbl: float = 0
    net_dispatch_lt: float = 0
    net_dispatch_mt: float = 0

    signed_net_movement_gsv_bbl: float = 0
    signed_net_movement_nsv_bbl: float = 0
    signed_net_movement_lt: float = 0
    signed_net_movement_mt: float = 0

    status: str
    remarks: Optional[str] = None

# -------------------------
# FSO Report Schemas (FINAL)
# -------------------------

class FSOOTRRowResponse(BaseModel):
    transaction_id: int
    ticket_number: str
    operation_number: Optional[str] = None

    accounting_date: date
    operation_date: date
    event_time: Optional[str] = None

    location_code: str
    location_name: Optional[str] = None

    fso_asset_code: str
    fso_asset_name: Optional[str] = None

    operation_label: str
    operation_sign: str  # IN / OUT / SET / NEUTRAL

    shuttle_number: Optional[str] = None

    vessel_name: Optional[str] = None
    vessel_quantity_bbl: float = 0

    opening_stock_bbl: float = 0
    opening_water_bbl: float = 0
    closing_stock_bbl: float = 0
    closing_water_bbl: float = 0

    net_stock_bbl: float = 0
    net_water_bbl: float = 0

    movement_qty_bbl: float = 0
    variance_bbl: float = 0

    source_shuttle_discharge_bbl: float = 0
    compare_variance_bbl: float = 0

    remarks: Optional[str] = None


class FSOOTRReportResponse(BaseModel):
    rows: list[FSOOTRRowResponse] = []

    total_receipt_bbl: float = 0
    total_export_bbl: float = 0
    total_movement_bbl: float = 0
    total_variance_bbl: float = 0
    total_compare_variance_bbl: float = 0


class FSOMaterialBalanceRowResponse(BaseModel):
    accounting_date: date

    opening_stock_bbl: float = 0
    receipt_bbl: float = 0
    export_bbl: float = 0

    book_closing_bbl: float = 0
    physical_closing_bbl: float = 0
    physical_closing_water_bbl: float = 0

    loss_gain_bbl: float = 0


class FSOMaterialBalanceReportResponse(BaseModel):
    rows: list[FSOMaterialBalanceRowResponse] = []


class FSOOutturnRowResponse(BaseModel):
    accounting_date: date
    shuttle_number: str

    shuttle_discharge_bbl: float = 0
    fso_receipt_bbl: float = 0
    variance_bbl: float = 0
    variance_pct: float = 0


class FSOOutturnReportResponse(BaseModel):
    rows: list[FSOOutturnRowResponse] = []

    total_shuttle_discharge_bbl: float = 0
    total_fso_receipt_bbl: float = 0
    total_variance_bbl: float = 0
    total_variance_pct: float = 0

# -------------------------
# Material Balance Template Configuration Schemas
# -------------------------

class MaterialBalanceTemplateBase(BaseModel):
    location_code: str
    template_name: str
    description: Optional[str] = None
    status: str = "Active"


class MaterialBalanceTemplateCreate(MaterialBalanceTemplateBase):
    pass


class MaterialBalanceTemplateUpdate(MaterialBalanceTemplateBase):
    pass


class MaterialBalanceTemplateResponse(MaterialBalanceTemplateBase):
    id: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class MaterialBalanceTemplateColumnBase(BaseModel):
    column_label: str
    column_key: str
    column_order: int = 1
    column_type: str
    movement_direction: Optional[str] = None
    mapped_operation_codes: list[str] = []
    excluded_operation_codes: list[str] = []
    include_in_material_balance: str = "Yes"
    include_in_book_closing: str = "Yes"
    is_internal_transfer: str = "No"
    formula_json: Optional[Any] = None
    remarks: Optional[str] = None
    status: str = "Active"


class MaterialBalanceTemplateColumnCreate(MaterialBalanceTemplateColumnBase):
    pass


class MaterialBalanceTemplateColumnUpdate(MaterialBalanceTemplateColumnBase):
    pass


class MaterialBalanceTemplateColumnResponse(MaterialBalanceTemplateColumnBase):
    id: int
    template_id: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class MaterialBalanceTemplateDetailResponse(MaterialBalanceTemplateResponse):
    columns: list[MaterialBalanceTemplateColumnResponse] = []

# -------------------------
# Material Balance Report Schemas
# -------------------------

class MaterialBalanceDynamicTemplateResponse(BaseModel):
    id: int
    location_code: str
    template_name: str


class MaterialBalanceDynamicColumnResponse(BaseModel):
    column_key: str
    column_label: str
    column_order: int
    column_type: str
    movement_direction: Optional[str] = None
    include_in_material_balance: str = "Yes"
    include_in_book_closing: str = "Yes"
    is_internal_transfer: str = "No"


class MaterialBalanceDynamicRowResponse(BaseModel):
    accounting_date: date

    location_code: str
    location_name: Optional[str] = None

    tank_asset_code: Optional[str] = None
    tank_asset_name: Optional[str] = None

    product_name: Optional[str] = None

    values: dict[str, Any] = {}

    rows_count: int = 0
    last_ticket_number: Optional[str] = None


class MaterialBalanceDynamicReportResponse(BaseModel):
    template: MaterialBalanceDynamicTemplateResponse
    columns: list[MaterialBalanceDynamicColumnResponse]
    rows: list[MaterialBalanceDynamicRowResponse]

class MaterialBalanceReportResponse(BaseModel):
    accounting_date: date

    location_code: str
    location_name: Optional[str] = None

    tank_asset_code: Optional[str] = None
    tank_asset_name: Optional[str] = None

    product_name: Optional[str] = None

    opening_gsv_bbl: float = 0
    opening_nsv_bbl: float = 0
    opening_lt: float = 0
    opening_mt: float = 0

    receipt_gsv_bbl: float = 0
    receipt_nsv_bbl: float = 0
    receipt_lt: float = 0
    receipt_mt: float = 0

    production_gsv_bbl: float = 0
    production_nsv_bbl: float = 0
    production_lt: float = 0
    production_mt: float = 0

    dispatch_gsv_bbl: float = 0
    dispatch_nsv_bbl: float = 0
    dispatch_lt: float = 0
    dispatch_mt: float = 0

    draining_gsv_bbl: float = 0
    draining_nsv_bbl: float = 0
    draining_lt: float = 0
    draining_mt: float = 0

    other_in_gsv_bbl: float = 0
    other_in_nsv_bbl: float = 0
    other_in_lt: float = 0
    other_in_mt: float = 0

    other_out_gsv_bbl: float = 0
    other_out_nsv_bbl: float = 0
    other_out_lt: float = 0
    other_out_mt: float = 0

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
    operation_template_id: Optional[int] = None
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

# -------------------------
# Operation Transaction Register (Paged) Schemas
# -------------------------

class OperationTransactionRegisterRowResponse(BaseModel):
    id: int
    ticket_number: Optional[str] = None
    operation_number: Optional[str] = None
    convoy_number: Optional[str] = None

    operation_date: Optional[date] = None

    operation_type_id: Optional[int] = None
    operation_type_code: Optional[str] = None
    operation_type_name: Optional[str] = None

    location_id: Optional[int] = None
    location_code: Optional[str] = None
    location_name: Optional[str] = None

    primary_asset_id: Optional[int] = None
    primary_asset_code: Optional[str] = None
    primary_asset_name: Optional[str] = None

    status: Optional[str] = None
    field_count: int = 0
    created_at: Optional[datetime] = None


class OperationTransactionStatusCountResponse(BaseModel):
    status: str
    count: int


class OperationTransactionRegisterPagedResponse(BaseModel):
    rows: list[OperationTransactionRegisterRowResponse] = []
    total_rows: int = 0

    page: int = 1
    page_size: int = 20
    has_more: bool = False

    status_counts: list[OperationTransactionStatusCountResponse] = []

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

    # ✅ Enterprise enforcement: must be true for Submitted/Approved
    review_confirmed: Optional[bool] = False

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


class SystemNotificationBase(BaseModel):
    title: str
    message: str
    notification_type: str = "Info"
    priority: str = "Normal"
    delivery_mode: str = "Banner + Inbox"
    target_scope: str = "All Users"
    target_role_ids: Optional[list[int]] = None
    target_user_ids: Optional[list[int]] = None
    target_location_codes: Optional[list[str]] = None
    display_from: Optional[datetime] = None
    display_until: Optional[datetime] = None
    requires_acknowledgement: str = "No"
    popup_enabled: str = "No"
    banner_enabled: str = "Yes"
    auto_dismiss_seconds: Optional[int] = None


class SystemNotificationCreate(SystemNotificationBase):
    status: str = "Draft"


class SystemNotificationUpdate(SystemNotificationBase):
    status: Optional[str] = None


class SystemNotificationActionRequest(BaseModel):
    remarks: Optional[str] = None


class SystemNotificationResponse(BaseModel):
    id: int
    notification_number: str
    title: str
    message: str
    notification_type: str
    priority: str
    delivery_mode: str
    target_scope: str
    target_role_ids: Optional[list[int]] = None
    target_user_ids: Optional[list[int]] = None
    target_location_codes: Optional[list[str]] = None
    display_from: Optional[datetime] = None
    display_until: Optional[datetime] = None
    requires_acknowledgement: str
    popup_enabled: str
    banner_enabled: str
    auto_dismiss_seconds: Optional[int] = None
    status: str
    created_by_user_id: Optional[int] = None
    created_by_display: Optional[str] = None
    published_at: Optional[datetime] = None
    deactivated_at: Optional[datetime] = None
    deactivation_reason: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    receipt_status: Optional[str] = None
    first_seen_at: Optional[datetime] = None
    dismissed_at: Optional[datetime] = None
    acknowledged_at: Optional[datetime] = None
    delivery_count: int = 0
    seen_count: int = 0
    acknowledged_count: int = 0
    dismissed_count: int = 0

    model_config = ConfigDict(from_attributes=True)


class SystemNotificationReceiptResponse(BaseModel):
    id: int
    notification_id: int
    user_id: int
    username: Optional[str] = None
    delivered_at: datetime
    first_seen_at: Optional[datetime] = None
    last_seen_at: Optional[datetime] = None
    dismissed_at: Optional[datetime] = None
    acknowledged_at: Optional[datetime] = None
    acknowledgement_remarks: Optional[str] = None
    status: str
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class BackupSettingsUpdate(BaseModel):
    enabled: str = "No"
    schedule_mode: str = "Daily"
    interval_value: int = 24
    run_time: str = "02:00"
    retention_days: int = 30
    keep_minimum: int = 5
    backup_directory: Optional[str] = None
    compression_enabled: str = "Yes"


class BackupSettingsResponse(BaseModel):
    id: int
    enabled: str
    schedule_mode: str
    interval_value: int
    run_time: str
    retention_days: int
    keep_minimum: int
    backup_directory: Optional[str] = None
    compression_enabled: str
    status: str
    next_run_at: Optional[datetime] = None
    last_run_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class BackupManualCreate(BaseModel):
    description: Optional[str] = None


class BackupJobResponse(BaseModel):
    id: int
    backup_number: str
    backup_type: str
    trigger_source: str
    status: str
    description: Optional[str] = None
    file_name: Optional[str] = None
    file_size_bytes: Optional[int] = None
    checksum_sha256: Optional[str] = None
    database_name: Optional[str] = None
    backup_format: str
    requested_by_user_id: Optional[int] = None
    requested_by_display: Optional[str] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    error_message: Optional[str] = None
    metadata_json: Optional[Any] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class BackupRestoreRequestCreate(BaseModel):
    backup_job_id: int
    reason: str
    business_impact: Optional[str] = None


class BackupRestoreRequestAction(BaseModel):
    remarks: Optional[str] = None


class BackupRestoreExecuteRequest(BaseModel):
    confirmation_text: str
    remarks: Optional[str] = None


class BackupRestoreRequestResponse(BaseModel):
    id: int
    request_number: str
    backup_job_id: int
    backup_number: str
    status: str
    reason: str
    business_impact: Optional[str] = None
    requested_by_user_id: Optional[int] = None
    requested_by_display: Optional[str] = None
    requested_at: datetime
    approved_by_user_id: Optional[int] = None
    approved_by_display: Optional[str] = None
    approved_at: Optional[datetime] = None
    rejected_by_user_id: Optional[int] = None
    rejected_by_display: Optional[str] = None
    rejected_at: Optional[datetime] = None
    cancelled_by_user_id: Optional[int] = None
    cancelled_by_display: Optional[str] = None
    cancelled_at: Optional[datetime] = None
    action_remarks: Optional[str] = None
    metadata_json: Optional[Any] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class BackupRestoreValidationResponse(BaseModel):
    id: int
    validation_number: str
    restore_request_id: int
    backup_job_id: int
    backup_number: str
    status: str
    validation_database_name: Optional[str] = None
    started_by_user_id: Optional[int] = None
    started_by_display: Optional[str] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    error_message: Optional[str] = None
    table_counts_json: Optional[Any] = None
    validation_report_json: Optional[Any] = None
    created_at: datetime
    updated_at: datetime

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

# -------------------------
# Tanker Transaction Report Schemas
# -------------------------

class TankerTransactionReportRow(BaseModel):
    transaction_id: int
    operation_number: str
    ticket_number: Optional[str] = None

    operation_date: date
    operation_start_datetime: Optional[datetime] = None
    operation_end_datetime: Optional[datetime] = None

    operation_type_code: str
    operation_type_name: Optional[str] = None

    location_code: str
    location_name: Optional[str] = None

    asset_code: str
    asset_name: Optional[str] = None
    asset_type_code: Optional[str] = None

    convoy_number: Optional[str] = None
    tanker_name: Optional[str] = None
    prime_mover_number: Optional[str] = None
    chassis_number: Optional[str] = None

    cargo: Optional[str] = None
    tanker_operation: Optional[str] = None
    destination: Optional[str] = None
    loading_bay: Optional[str] = None
    compartment: Optional[str] = None

    total_dip_cm: float = 0
    water_dip_cm: float = 0
    bsw_percent: float = 0

    tank_temperature: Optional[float] = None
    tank_temperature_unit: Optional[str] = None
    sample_temperature: Optional[float] = None
    sample_temperature_unit: Optional[str] = None

    observed_input_type: Optional[str] = None
    observed_api: Optional[float] = None
    observed_density: Optional[float] = None
    api60: Optional[float] = None
    vcf: Optional[float] = None

    tov_bbl: float = 0
    free_water_bbl: float = 0
    gov_bbl: float = 0
    gsv_bbl: float = 0
    bsw_bbl: float = 0
    nsv_bbl: float = 0

    lt_factor: Optional[float] = None
    lt: float = 0
    mt: float = 0

    seal_c1: Optional[str] = None
    seal_c2: Optional[str] = None
    seal_m1: Optional[str] = None
    seal_m2: Optional[str] = None

    remarks: Optional[str] = None
    status: str
    created_by: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class TankerTransactionReportTotals(BaseModel):
    rows_count: int = 0
    total_tov_bbl: float = 0
    total_free_water_bbl: float = 0
    total_gov_bbl: float = 0
    total_gsv_bbl: float = 0
    total_bsw_bbl: float = 0
    total_nsv_bbl: float = 0
    total_lt: float = 0
    total_mt: float = 0


class TankerTransactionReportResponse(BaseModel):
    rows: list[TankerTransactionReportRow]
    totals: TankerTransactionReportTotals

# -------------------------
# Tanker Tracking Schemas
# -------------------------

class TankerTrackingSealCheckResponse(BaseModel):
    seal_name: str
    sender_value: Optional[str] = None
    receiver_value: Optional[str] = None
    status: str


class TankerTrackingQuantityComparisonResponse(BaseModel):
    sender_transaction_id: Optional[int] = None
    receiver_transaction_id: Optional[int] = None

    sender_gov_bbl: float = 0
    receiver_gov_bbl: float = 0
    gov_variance_bbl: float = 0

    sender_gsv_bbl: float = 0
    receiver_gsv_bbl: float = 0
    gsv_variance_bbl: float = 0

    sender_nsv_bbl: float = 0
    receiver_nsv_bbl: float = 0
    nsv_variance_bbl: float = 0
    nsv_variance_percent: float = 0

    sender_lt: float = 0
    receiver_lt: float = 0
    lt_variance: float = 0

    sender_mt: float = 0
    receiver_mt: float = 0
    mt_variance: float = 0


class TankerTrackingTicketResponse(BaseModel):
    transaction_id: int
    ticket_number: Optional[str] = None
    operation_number: str

    movement_role: str

    operation_date: date
    operation_type_code: str
    operation_type_name: Optional[str] = None

    origin_location_code: str
    origin_location_name: Optional[str] = None
    destination_location_code: Optional[str] = None
    destination_location_name: Optional[str] = None
    sender_location_code: Optional[str] = None
    sender_location_name: Optional[str] = None
    receiver_location_code: Optional[str] = None
    receiver_location_name: Optional[str] = None

    primary_asset_code: str
    primary_asset_name: Optional[str] = None
    primary_asset_type_code: Optional[str] = None

    prime_mover_asset_code: Optional[str] = None
    prime_mover_asset_name: Optional[str] = None

    tanker_asset_code: Optional[str] = None
    tanker_asset_name: Optional[str] = None
    tanker_chassis_number: Optional[str] = None

    convoy_number: Optional[str] = None
    product_name: Optional[str] = None

    compartment: Optional[str] = None
    total_dip_cm: float = 0
    water_dip_cm: float = 0
    bsw_percent: float = 0

    tank_temperature: Optional[float] = None
    tank_temperature_unit: Optional[str] = None
    sample_temperature: Optional[float] = None
    sample_temperature_unit: Optional[str] = None

    observed_input_type: Optional[str] = None
    observed_api: Optional[float] = None
    observed_density: Optional[float] = None
    api60: Optional[float] = None
    vcf: Optional[float] = None

    tov_bbl: float = 0
    free_water_bbl: float = 0
    gov_bbl: float = 0
    gsv_bbl: float = 0
    bsw_bbl: float = 0
    nsv_bbl: float = 0
    lt: float = 0
    mt: float = 0

    seal_c1: Optional[str] = None
    seal_c2: Optional[str] = None
    seal_m1: Optional[str] = None
    seal_m2: Optional[str] = None

    remarks: Optional[str] = None
    status: str
    created_by: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class TankerTrackingGroupResponse(BaseModel):
    group_key: str
    convoy_number: str

    tanker_asset_code: Optional[str] = None
    tanker_asset_name: Optional[str] = None
    tanker_chassis_number: Optional[str] = None

    prime_mover_asset_code: Optional[str] = None
    prime_mover_asset_name: Optional[str] = None

    product_name: Optional[str] = None

    sender_ticket: Optional[TankerTrackingTicketResponse] = None
    receiver_tickets: list[TankerTrackingTicketResponse] = []
    latest_receiver_ticket: Optional[TankerTrackingTicketResponse] = None

    acknowledgement_id: Optional[int] = None
    acknowledged_by: Optional[str] = None
    acknowledged_at: Optional[datetime] = None
    acknowledgement_remarks: Optional[str] = None
    closed_by: Optional[str] = None
    closed_at: Optional[datetime] = None
    closure_remarks: Optional[str] = None

    seal_checks: list[TankerTrackingSealCheckResponse] = []
    quantity_comparison: Optional[TankerTrackingQuantityComparisonResponse] = None

    tracking_status: str
    warning_messages: list[str] = []


class TankerTrackingResponse(BaseModel):
    rows: list[TankerTrackingGroupResponse]
    total_groups: int = 0
    pending_receipts: int = 0
    received_groups: int = 0
    compared_groups: int = 0
    seal_mismatch_groups: int = 0
    quantity_variance_groups: int = 0

# -------------------------
# Tanker Receipt Acknowledgement Schemas
# -------------------------

class TankerReceiptAcknowledgementCreate(BaseModel):
    sender_transaction_id: int
    receiver_location_code: Optional[str] = None
    remarks: Optional[str] = None


class TankerReceiptAcknowledgementResponse(BaseModel):
    id: int
    sender_transaction_id: int

    convoy_number: str
    tanker_asset_code: Optional[str] = None
    tanker_asset_name: Optional[str] = None
    tanker_chassis_number: Optional[str] = None

    prime_mover_asset_code: Optional[str] = None
    prime_mover_asset_name: Optional[str] = None

    receiver_location_code: Optional[str] = None
    receiver_location_name: Optional[str] = None

    acknowledged_by: Optional[str] = None
    acknowledged_at: datetime

    remarks: Optional[str] = None
    status: str
    closed_by: Optional[str] = None
    closed_at: Optional[datetime] = None
    closure_remarks: Optional[str] = None

    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class TankerTrackingClosureCreate(BaseModel):
    acknowledgement_id: int
    closure_remarks: Optional[str] = None


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


class DashboardConfigCreate(BaseModel):
    name: str
    scope_type: str
    location_code: Optional[str] = None
    remarks: Optional[str] = None


class DashboardConfigUpdate(BaseModel):
    name: Optional[str] = None
    scope_type: Optional[str] = None
    location_code: Optional[str] = None
    status: Optional[str] = None
    remarks: Optional[str] = None


class DashboardConfigResponse(BaseModel):
    id: int
    name: str
    scope_type: str
    location_code: Optional[str] = None
    status: str
    active_version_id: Optional[int] = None
    created_by: Optional[str] = None
    remarks: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class OperationTemplateLayoutSectionBase(BaseModel):
    section_key: str
    title: str
    sort_order: int = 1
    collapsible: str = "No"
    default_open: str = "Yes"
    visibility_rule_json: Optional[dict[str, Any]] = None


class OperationTemplateLayoutSectionCreate(OperationTemplateLayoutSectionBase):
    pass


class OperationTemplateLayoutSectionResponse(OperationTemplateLayoutSectionBase):
    id: int
    layout_id: int

    model_config = ConfigDict(from_attributes=True)


class OperationTemplateLayoutItemBase(BaseModel):
    section_id: int
    field_id: int
    row_no: int = 1
    col_start: int = 1
    col_span: int = 1
    sort_order: int = 1
    label_override: Optional[str] = None
    placeholder_override: Optional[str] = None
    read_only_override: Optional[str] = None
    width_mode: Optional[str] = None
    rule_json: Optional[dict[str, Any]] = None


class OperationTemplateLayoutItemCreate(OperationTemplateLayoutItemBase):
    pass


class OperationTemplateLayoutItemResponse(OperationTemplateLayoutItemBase):
    id: int
    layout_id: int

    model_config = ConfigDict(from_attributes=True)


class OperationTemplateLayoutBase(BaseModel):
    layout_name: str
    version_no: int = 1
    status: str = "Draft"
    is_default: str = "No"


class OperationTemplateLayoutCreate(OperationTemplateLayoutBase):
    sections: list[OperationTemplateLayoutSectionCreate] = []
    items: list[OperationTemplateLayoutItemCreate] = []


class OperationTemplateLayoutUpdate(BaseModel):
    layout_name: Optional[str] = None
    status: Optional[str] = None
    is_default: Optional[str] = None
    sections: Optional[list[OperationTemplateLayoutSectionCreate]] = None
    items: Optional[list[OperationTemplateLayoutItemCreate]] = None


class OperationTemplateLayoutResponse(OperationTemplateLayoutBase):
    id: int
    template_id: int
    created_at: datetime
    updated_at: datetime
    sections: list[OperationTemplateLayoutSectionResponse] = []
    items: list[OperationTemplateLayoutItemResponse] = []

    model_config = ConfigDict(from_attributes=True)


class DashboardVersionResponse(BaseModel):
    id: int
    config_id: int
    version_number: int
    config_json: Any
    change_note: Optional[str] = None
    created_by: Optional[str] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class DashboardPublishRequest(BaseModel):
    config_json: dict
    change_note: Optional[str] = None


class DashboardRevertRequest(BaseModel):
    version_id: int
    change_note: Optional[str] = None


class DashboardDataSourceCreate(BaseModel):
    data_source_code: str
    data_source_name: str
    description: Optional[str] = None
    handler_key: str
    allowed_params_json: dict
    status: str = "Active"
    remarks: Optional[str] = None


class DashboardDataSourceUpdate(BaseModel):
    data_source_code: Optional[str] = None
    data_source_name: Optional[str] = None
    description: Optional[str] = None
    handler_key: Optional[str] = None
    allowed_params_json: Optional[dict] = None
    status: Optional[str] = None
    remarks: Optional[str] = None


class DashboardDataSourceResponse(BaseModel):
    id: int
    data_source_code: str
    data_source_name: str
    description: Optional[str] = None
    handler_key: str
    allowed_params_json: Any
    status: str
    created_by: Optional[str] = None
    remarks: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class DashboardDataRequest(BaseModel):
    data_source_code: str
    params: dict


class DashboardDataResponse(BaseModel):
    data_source_code: str
    rows: list[dict]
    meta: dict

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


# -------------------------
# Flowmeter Config Schemas
# -------------------------

class FlowmeterConfigBase(BaseModel):
    location_code: Optional[str] = None
    asset_code: str
    stream_name: str = "Default"
    meter_asset_code: Optional[str] = None
    meter_label: str
    meter_factor: float = 1.0
    meter_unit: str = "bbls"  # bbls or m3
    calibration_date: Optional[date] = None
    remarks: Optional[str] = None
    status: str = "Active"


class FlowmeterConfigCreate(FlowmeterConfigBase):
    pass


class FlowmeterConfigResponse(FlowmeterConfigBase):
    id: int
    location_name: Optional[str] = None
    asset_name: Optional[str] = None
    meter_asset_name: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# -------------------------
# Flowmeter Record Schemas
# -------------------------

class FlowmeterRecordBase(BaseModel):
    location_code: str
    asset_code: str
    stream_name: Optional[str] = None
    meter_label: str
    reading_date: date
    opening_reading: float
    closing_reading: float
    meter_factor: float = 1.0
    meter_unit: str = "bbls"
    remarks: Optional[str] = None
    status: str = "Active"


class FlowmeterRecordCreate(FlowmeterRecordBase):
    pass


class FlowmeterRecordResponse(FlowmeterRecordBase):
    id: int
    location_name: Optional[str] = None
    asset_name: Optional[str] = None

    gross_observed: float = 0
    net_standard: float = 0
    net_standard_bbl: float = 0

    created_by: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class FlowmeterConfigHistoryResponse(BaseModel):
    id: int
    config_id: int
    location_code: str
    asset_code: str
    stream_name: str
    meter_asset_code: Optional[str] = None
    meter_label: str
    old_meter_factor: Optional[float] = None
    new_meter_factor: Optional[float] = None
    old_meter_unit: Optional[str] = None
    new_meter_unit: Optional[str] = None
    old_calibration_date: Optional[date] = None
    new_calibration_date: Optional[date] = None
    old_status: Optional[str] = None
    new_status: Optional[str] = None
    change_action: str
    changed_by: Optional[str] = None
    remarks: Optional[str] = None
    changed_at: datetime

    model_config = ConfigDict(from_attributes=True)
