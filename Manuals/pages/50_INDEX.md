# Hydrocarbon Accounting System — Page Documentation Index

## Architecture
| # | File | Description |
|---|------|-------------|
| 00 | [00_ARCHITECTURE_USER_DATA_FLOW.md](00_ARCHITECTURE_USER_DATA_FLOW.md) | User data flow across all system domains |

## Access Control & Auth
| # | Page | API Module | Backend Router | Model |
|---|------|------------|----------------|-------|
| 01 | [01_LoginPage.md](01_LoginPage.md) | authApi | auth.py | User, AuthLoginChallenge |
| 02 | [02_UserMaster.md](02_UserMaster.md) | userApi | users.py | User |
| 03 | [03_RoleMaster.md](03_RoleMaster.md) | roleApi | roles.py | Role |
| 04 | [04_PermissionMaster.md](04_PermissionMaster.md) | permissionApi | permissions.py | Permission |
| 05 | [05_RolePermissionAssignment.md](05_RolePermissionAssignment.md) | rolePermissionApi | role_permissions.py | RolePermission |
| 06 | [06_UserRoleAssignment.md](06_UserRoleAssignment.md) | userRoleApi | user_roles.py | UserRole |
| 07 | [07_AccessSummary.md](07_AccessSummary.md) | (composite) | (composite) | (composite) |
| 08 | [08_ProfileSecurity.md](08_ProfileSecurity.md) | securityApi | auth.py | User |

## Master Data
| # | Page | API Module | Backend Router | Model |
|---|------|------------|----------------|-------|
| 09 | [09_LocationMaster.md](09_LocationMaster.md) | locationApi | locations.py | Location |
| 10 | [10_LocationAccountingDaySetting.md](10_LocationAccountingDaySetting.md) | locationAccountingDaySettingApi | locations.py | LocationAccountingDaySetting |
| 11 | [11_AssetTypeMaster.md](11_AssetTypeMaster.md) | assetTypeApi | asset_types.py | AssetType |
| 12 | [12_AssetMaster.md](12_AssetMaster.md) | assetApi | assets.py | Asset |
| 13 | [13_CalibrationTemplateMaster.md](13_CalibrationTemplateMaster.md) | calibrationTemplateApi | calibration_templates.py | CalibrationTemplate |
| 14 | [14_AssetCalibrationTable.md](14_AssetCalibrationTable.md) | assetCalibrationApi | asset_calibration_tables.py | AssetCalibrationTable |
| 15 | [15_AssetAssignment.md](15_AssetAssignment.md) | assetAssignmentApi | asset_assignments.py | AssetAssignment |
| 16 | [16_AssetAssignmentSummary.md](16_AssetAssignmentSummary.md) | (composite) | (composite) | (composite) |
| 17 | [17_CompanyReportProfileMaster.md](17_CompanyReportProfileMaster.md) | companyReportProfileApi | company_report_profiles.py | CompanyReportProfile |

## Core Operations
| # | Page | API Module | Backend Router | Model |
|---|------|------------|----------------|-------|
| 18 | [18_OperationTypeMaster.md](18_OperationTypeMaster.md) | operationTypeApi | operation_types.py | OperationType |
| 19 | [19_TankOperationMaster.md](19_TankOperationMaster.md) | tankOperationApi | tank_operations.py | TankOperation |
| 20 | [20_OperationTemplateMaster.md](20_OperationTemplateMaster.md) | operationTemplateApi | operation_templates.py | OperationTemplate |
| 21 | [21_OperationEntry.md](21_OperationEntry.md) | operationEntryApi | operation_entries.py | OperationTransaction |
| 22 | [22_OperationTransactionRegister.md](22_OperationTransactionRegister.md) | operationTransactionApi | operation_transactions.py | OperationTransaction |
| 23 | [23_OperationTransactionDetail.md](23_OperationTransactionDetail.md) | operationTransactionApi | operation_transactions.py | OperationTransaction |
| 24 | [24_VesselOperationMaster.md](24_VesselOperationMaster.md) | vesselOperationApi | vessel_operations.py | VesselOperation |
| 25 | [25_LocationOperationAvailability.md](25_LocationOperationAvailability.md) | locationOperationAvailabilityApi | location_operation_availability.py | LocationOperationAvailability |
| 26 | [26_LocationOperationSummary.md](26_LocationOperationSummary.md) | (composite) | location_operation_availability.py | LocationOperationAvailability |

## Logistics & Tracking
| # | Page | API Module | Backend Router | Model |
|---|------|------------|----------------|-------|
| 27 | [27_TankerTracking.md](27_TankerTracking.md) | tankerTrackingApi | tanker_tracking.py | TankerReceiptAcknowledgement |
| 28 | [28_BargeTracking.md](28_BargeTracking.md) | bargeTrackingApi | barge_trip_tracking.py | Trip, TripEvent, TripComparison |
| 29 | [29_BargeSealMaster.md](29_BargeSealMaster.md) | bargeSealApi | barge_seal_master.py | BargeSealMaster |
| 30 | [30_ShuttleTracking.md](30_ShuttleTracking.md) | shuttleTrackingApi | shuttle_fso_voyages.py | ShuttleVoyage |
| 31 | [31_FSOTracking.md](31_FSOTracking.md) | fsoReportApi | shuttle_fso_voyages.py | FSOVoyage |
| 32 | [32_PrimeMoverTankerLinkMaster.md](32_PrimeMoverTankerLinkMaster.md) | primeMoverTankerLinkApi | prime_mover_tanker_links.py | PrimeMoverTankerLink |
| 33 | [33_TankerTransactionReport.md](33_TankerTransactionReport.md) | tankerTransactionReportApi | tanker_tracking.py | (report) |

## Reports & Analytics
| # | Page | API Module | Backend Router | Model |
|---|------|------------|----------------|-------|
| 34 | [34_Dashboard.md](34_Dashboard.md) | dashboardApi, dashboardDataApi | dashboard.py | DashboardConfig |
| 35 | [35_DashboardBuilder.md](35_DashboardBuilder.md) | dashboardApi, dashboardDataApi | dashboard.py | DashboardConfig |
| 36 | [36_TankStockLedger.md](36_TankStockLedger.md) | tankStockLedgerApi | tank_stock_ledger.py | TankStockLedger |
| 37 | [37_OutTurnReport.md](37_OutTurnReport.md) | outTurnReportApi | reports.py | (report) |
| 38 | [38_MaterialBalanceReport.md](38_MaterialBalanceReport.md) | materialBalanceReportApi | reports.py | (report) |
| 39 | [39_MaterialBalanceTemplateMaster.md](39_MaterialBalanceTemplateMaster.md) | materialBalanceTemplateApi | material_balance_templates.py | MaterialBalanceTemplate |
| 40 | [40_AuditLog.md](40_AuditLog.md) | auditLogApi | audit_logs.py | AuditLog |

## System Administration
| # | Page | API Module | Backend Router | Model |
|---|------|------------|----------------|-------|
| 41 | [41_BackupRecovery.md](41_BackupRecovery.md) | backupApi | backup_restore.py | BackupJob |
| 42 | [42_FlowmeterConfigMaster.md](42_FlowmeterConfigMaster.md) | flowmeterApi | flowmeter_configs_records.py | FlowmeterConfig |
| 43 | [43_FlowmeterRecordEntry.md](43_FlowmeterRecordEntry.md) | flowmeterApi | flowmeter_configs_records.py | FlowmeterRecord |
| 44 | [44_SystemNotificationMaster.md](44_SystemNotificationMaster.md) | systemNotificationApi | system_notifications.py | SystemNotification |
| 45 | [45_OperationWorkflowPolicyMaster.md](45_OperationWorkflowPolicyMaster.md) | operationWorkflowPolicyApi | workflow_policies.py | OperationWorkflowPolicy |
| 46 | [46_OperationTaskManager.md](46_OperationTaskManager.md) | operationTaskApi | operation_tasks.py | OperationTask |
| 47 | [47_MovementMapping.md](47_MovementMapping.md) | movementMappingApi | movement_mappings.py | MovementMapping |
| 48 | [48_Table11FactorMaster.md](48_Table11FactorMaster.md) | table11Api | table11_factors.py | Table11Factor |
| 49 | [49_Home.md](49_Home.md) | — | — | — |

## System Architecture (docker-compose.yaml)

```
┌─────────────┐     HTTP 5173     ┌──────────────┐    5432     ┌──────────┐
│  Frontend    │ ◄──────────────► │   Backend     │ ◄─────────► │ Postgres │
│  React/Vite  │   JSON API       │  FastAPI      │             │    16    │
│  49 pages    │                  │  39 routers   │             │   ~40    │
│  45 API mods │                  │  1833-line    │             │  tables  │
└─────────────┘                   │  models.py    │             └──────────┘
                                  └──────────────┘
```

## API Client Core
All API modules import from `apiClient.js` which provides:
- `apiGet(endpoint)` — `GET` request
- `apiPost(endpoint, body)` — `POST` request
- `apiPut(endpoint, body)` — `PUT` request
- `apiDelete(endpoint)` — `DELETE` request
- `apiDownload(endpoint, filename)` — File download
- Base URL: `VITE_API_BASE_URL` or `http://127.0.0.1:8000`
- Auth: Bearer token from localStorage added automatically
- 401 handling: auto-clears token on unauthorized response
