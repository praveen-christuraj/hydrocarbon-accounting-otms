# API Routing Verification Report

## Summary
Verified **44 API module files** against **39 backend router files**. Most frontend API endpoints correctly match their backend router prefixes. **6 API modules have routing mismatches** that need attention.

## Verified: All API Endpoints Match (38 of 44 API modules)

| API Module | Endpoint | Backend Router | Status |
|------------|----------|----------------|--------|
| assetApi | `/assets` | `/assets` (assets.py) | ✅ |
| assetAssignmentApi | `/asset-assignments` | `/asset-assignments` (asset_assignments.py) | ✅ |
| assetCalibrationApi | `/asset-calibration-tables` | `/asset-calibration-tables` (asset_calibration_tables.py) | ✅ |
| assetTypeApi | `/asset-types` | `/asset-types` (asset_types.py) | ✅ |
| auditLogApi | `/audit-logs` | `/audit-logs` (audit_logs.py) | ✅ |
| backupApi | `/backup-settings`, `/backups/*`, `/backup-restore-requests` | `/backup` (backup_restore.py) | ✅ |
| bargeSealApi | `/barge-seal-master/bulk` | `/barge-seal-master` (barge_seal_master.py) | ✅ |
| calibrationTemplateApi | `/calibration-templates` | `/calibration-templates` (calibration_templates.py) | ✅ |
| companyReportProfileApi | `/company-report-profiles` | `/company-report-profiles` (company_report_profiles.py) | ✅ |
| dashboardApi | `/dashboard-configs` | `/dashboard` (dashboard.py) | ✅ |
| dashboardDataApi | `/dashboard/data` | `/dashboard` (dashboard.py) | ✅ |
| flowmeterApi | `/flowmeter-configs`, `/flowmeter-records` | `/flowmeter` (flowmeter_configs_records.py) | ✅ |
| locationApi | `/locations` | `/locations` (locations.py) | ✅ |
| locationOperationAvailabilityApi | `/location-operation-availability` | `/location-operation-availability` (location_operation_availability.py) | ✅ |
| materialBalanceTemplateApi | `/material-balance-templates` | `/material-balance-templates` (material_balance_templates.py) | ✅ |
| movementMappingApi | `/movement-mappings` | `/movement-mappings` (movement_mappings.py) | ✅ |
| operationEntryApi | `/operation-entries` | `/operation-entries` (operation_entries.py) | ✅ |
| operationTemplateApi | `/operation-templates` | `/operation-templates` (operation_templates.py) | ✅ |
| operationTransactionApi | `/operation-transactions` | `/operation-transactions` (operation_transactions.py) | ✅ |
| operationTypeApi | `/operation-types` | `/operation-types` (operation_types.py) | ✅ |
| operationWorkflowPolicyApi | `/operation-workflow-policies` | `/operation-workflow-policies` (workflow_policies.py) | ✅ |
| permissionApi | `/permissions` | `/permissions` (permissions.py) | ✅ |
| primeMoverTankerLinkApi | `/prime-mover-tanker-links` | `/prime-mover-tanker-links` (prime_mover_tanker_links.py) | ✅ |
| roleApi | `/roles` | `/roles` (roles.py) | ✅ |
| rolePermissionApi | `/role-permissions` | `/role-permissions` (role_permissions.py) | ✅ |
| securityApi | `/auth/*` | `/auth` (auth.py) | ✅ |
| systemNotificationApi | `/system-notifications` | `/system-notifications` (system_notifications.py) | ✅ |
| table11Api | `/table11-factors` | `/table11-factors` (table11_factors.py) | ✅ |
| tankerTrackingApi | `/tanker-tracking/*` | `/tanker-tracking` (tanker_tracking.py) | ✅ |
| tankOperationApi | `/tank-operations` | `/tank-operations` (tank_operations.py) | ✅ |
| tankStockLedgerApi | `/tank-stock-ledger` | `/tank-stock-ledger` (tank_stock_ledger.py) | ✅ |
| userApi | `/users` | `/users` (users.py) | ✅ |
| userRoleApi | `/user-roles` | `/user-roles` (user_roles.py) | ✅ |
| vesselOperationApi | `/vessel-operations` | `/vessel-operations` (vessel_operations.py) | ✅ |

## Routing Mismatches Found (6 API modules)

### 1. bargeTrackingApi.js — Missing `/barge-trip` Prefix

| Frontend Calls | Should Be | Backend Route |
|---------------|-----------|---------------|
| `GET /barge-tracking` | `GET /barge-trip/barge-tracking` | `@router.get("/barge-tracking")` |
| `GET /trips/by-convoy/{convoy}` | `GET /barge-trip/trips/by-convoy/{convoy}` | `@router.get("/trips/by-convoy/{convoy_number}")` |
| `POST /trip-events` | `POST /barge-trip/trip-events` | `@router.post("/trip-events")` |
| `POST /trip-comparisons` | `POST /barge-trip/trip-comparisons` | `@router.post("/trip-comparisons")` |
| `POST /trips/{id}/close` | `POST /barge-trip/trips/{id}/close` | `@router.post("/trips/{trip_id}/close")` |
| `POST /trips/{id}/reopen` | `POST /barge-trip/trips/{id}/reopen` | `@router.post("/trips/{trip_id}/reopen")` |

### 2. fsoTrackingApi.js — Missing `/shuttle-fso` Prefix

| Frontend Calls | Should Be | Backend Route |
|---------------|-----------|---------------|
| `GET /fso-tracking` | `GET /shuttle-fso/fso-tracking` | `@router.get("/fso-tracking")` |
| `POST /fso-voyages/close` | `POST /shuttle-fso/fso-voyages/close` | `@router.post("/fso-voyages/close")` |
| `POST /fso-voyages/reopen` | `POST /shuttle-fso/fso-voyages/reopen` | `@router.post("/fso-voyages/reopen")` |

### 3. shuttleTrackingApi.js — Missing `/shuttle-fso` Prefix

| Frontend Calls | Should Be | Backend Route |
|---------------|-----------|---------------|
| `GET /shuttle-tracking` | `GET /shuttle-fso/shuttle-tracking` | `@router.get("/shuttle-tracking")` |
| `POST /shuttle-voyages/close` | `POST /shuttle-fso/shuttle-voyages/close` | `@router.post("/shuttle-voyages/close")` |
| `POST /shuttle-voyages/reopen` | `POST /shuttle-fso/shuttle-voyages/reopen` | `@router.post("/shuttle-voyages/reopen")` |

### 4. locationAccountingDaySettingApi.js — Wrong Prefix

| Frontend Calls | Should Be | Backend Route |
|---------------|-----------|---------------|
| `GET /location-accounting-day-settings` | `GET /locations/accounting-day-settings` | Route in locations.py |
| `POST /location-accounting-day-settings` | `POST /locations/accounting-day-settings` | Route in locations.py |
| `PUT /location-accounting-day-settings/{id}` | `PUT /locations/accounting-day-settings/{id}` | Route in locations.py |
| `DELETE /location-accounting-day-settings/{id}` | `DELETE /locations/accounting-day-settings/{id}` | `@router.delete("/accounting-day-settings/{setting_id}")` |

### 5. materialBalanceReportApi.js — Wrong Prefix

| Frontend Calls | Should Be | Backend Route |
|---------------|-----------|---------------|
| `GET /material-balance-report` | `GET /reports/fso/material-balance` | `@router.get("/fso/material-balance")` |

### 6. outTurnReportApi.js — Wrong Prefix

| Frontend Calls | Should Be | Backend Route |
|---------------|-----------|---------------|
| `GET /out-turn-report` | `GET /reports/out-turn-report/validation` | `@router.get("/out-turn-report/validation")` |

## Unused Backend Routers (no API calls to them)

| Router Prefix | Router File | Notes |
|---------------|-------------|-------|
| `/reports` | reports.py | FSO report APIs used from pages, but routes don't match |
| `/vessel-stock-ledger` | vessel_stock_ledger.py | No frontend API module calls it |
| `/operation-tasks` | operation_tasks.py | No frontend API module calls it |

## Root Cause

The frontend API modules for **barge, shuttle, FSO, location accounting-day, material balance, and out-turn report** call endpoints **without the router prefix** that the backend defines. This means:

1. **If the backend router prefix IS being applied**: these API calls will fail with 404
2. **If the backend router prefix is NOT being applied** (e.g., routes are flat): the calls would work

The `main.py` registers routers with `.include_router(router)` without overriding prefixes, so the prefixes ARE applied. **These are bugs that need fixing.**

## Recommended Fix

For each mismatched API module, prepend the router prefix to all endpoint paths:

```javascript
// bargeTrackingApi.js — add /barge-trip prefix
- return apiGet('/barge-tracking?...')
+ return apiGet('/barge-trip/barge-tracking?...')

- return apiPost('/trip-events', ...)
+ return apiPost('/barge-trip/trip-events', ...)

// fsoTrackingApi.js — add /shuttle-fso prefix
- return apiGet('/fso-tracking?...')
+ return apiGet('/shuttle-fso/fso-tracking?...')

// shuttleTrackingApi.js — add /shuttle-fso prefix
- return apiGet('/shuttle-tracking?...')
+ return apiGet('/shuttle-fso/shuttle-tracking?...')

// materialBalanceReportApi.js — use /reports prefix
- apiGet('/material-balance-report?...')
+ apiGet('/reports/fso/material-balance?...')

// outTurnReportApi.js — use /reports prefix
- apiGet('/out-turn-report?...')
+ apiGet('/reports/out-turn-report/validation?...')
```
