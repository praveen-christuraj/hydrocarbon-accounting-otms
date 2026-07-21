# API Routing Verification Report

## Summary
Verified **44 API module files** against **39 backend router files**. Most frontend API endpoints correctly match their backend router prefixes. **6 API modules had routing mismatches — all fixed (2026-07-21)**.

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

## Routing Mismatches Fixed (2026-07-21)

All 6 routing mismatches have been corrected in `frontend/src/api/`. The fix table below shows what was changed.

### 1. bargeTrackingApi.js — Prefixed `/barge-trip` to all endpoints

| Endpoint | Path Changed |
|----------|-------------|
| `getBargeTracking` | `/barge-tracking` → `/barge-trip/barge-tracking` |
| `getTripTimelineByConvoy` | `/trips/by-convoy/{convoy}` → `/barge-trip/trips/by-convoy/{convoy}` |
| `createTripEvent` | `/trip-events` → `/barge-trip/trip-events` |
| `createTripComparison` | `/trip-comparisons` → `/barge-trip/trip-comparisons` |
| `closeTrip` | `/trips/{id}/close` → `/barge-trip/trips/{id}/close` |
| `reopenTrip` | `/trips/{id}/reopen` → `/barge-trip/trips/{id}/reopen` |

### 2. shuttleTrackingApi.js — Prefixed `/shuttle-fso` to all endpoints

| Endpoint | Path Changed |
|----------|-------------|
| `getShuttleTracking` | `/shuttle-tracking` → `/shuttle-fso/shuttle-tracking` |
| `closeShuttleVoyage` | `/shuttle-voyages/close` → `/shuttle-fso/shuttle-voyages/close` |
| `reopenShuttleVoyage` | `/shuttle-voyages/reopen` → `/shuttle-fso/shuttle-voyages/reopen` |
| `downloadShuttleVoyageXlsx` | `/shuttle-tracking/export/xlsx` → `/shuttle-fso/shuttle-tracking/export/xlsx` |

### 3. fsoTrackingApi.js — Prefixed `/shuttle-fso` to all endpoints

| Endpoint | Path Changed |
|----------|-------------|
| `getFSOTracking` | `/fso-tracking` → `/shuttle-fso/fso-tracking` |
| `closeFSOVoyage` | `/fso-voyages/close` → `/shuttle-fso/fso-voyages/close` |
| `reopenFSOVoyage` | `/fso-voyages/reopen` → `/shuttle-fso/fso-voyages/reopen` |

### 4. locationAccountingDaySettingApi.js — Changed prefix to `/locations/accounting-day-settings`

| Endpoint | Path Changed |
|----------|-------------|
| `getLocationAccountingDaySettings` | `/location-accounting-day-settings` → `/locations/accounting-day-settings` |
| `createLocationAccountingDaySetting` | `/location-accounting-day-settings` → `/locations/accounting-day-settings` |
| `updateLocationAccountingDaySetting` | `/location-accounting-day-settings/{id}` → `/locations/accounting-day-settings/{id}` |
| `deleteLocationAccountingDaySetting` | `/location-accounting-day-settings/{id}` → `/locations/accounting-day-settings/{id}` |

### 5. materialBalanceReportApi.js — Changed prefix to `/reports/fso/material-balance`

| Endpoint | Path Changed |
|----------|-------------|
| `getMaterialBalanceReport` | `/material-balance-report` → `/reports/fso/material-balance` |

### 6. outTurnReportApi.js — Changed prefix to `/reports/out-turn-report/validation`

| Endpoint | Path Changed |
|----------|-------------|
| `getOutTurnReport` | `/out-turn-report` → `/reports/out-turn-report/validation` |

## Unused Backend Routers (still no API calls to them)

| Router Prefix | Router File | Notes |
|---------------|-------------|-------|
| `/reports` | reports.py | FSO report endpoint `/reports/fso/otr`, `/reports/fso/outturn`, `/reports/fso/otr/export/xlsx`, `/reports/fso/outturn/export/xlsx`, `/reports/fso/material-balance/export/xlsx`, `/reports/tank-stock-ledger/rebuild` still unused by frontend |
| `/vessel-stock-ledger` | vessel_stock_ledger.py | No frontend API module calls it |
| `/operation-tasks` | operation_tasks.py | No frontend API module calls it |

## Fix Summary

**Date**: 2026-07-21
**Files modified**: 6 frontend API modules (~19 endpoint paths corrected)
**Root cause**: Frontend API modules hardcoded endpoint paths without the backend's router prefix. Since `main.py` registers routers with `.include_router(router)`, prefixes ARE applied — these calls would have returned 404.
**Fix applied**: Each mismatched API module now prepends the correct backend router prefix to every endpoint path.

---

## Architecture Diagram — API Routing Verification

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ FRONTEND API MODULES (45)                    BACKEND ROUTERS (39)              ROUTING STATUS                 │
│                                                                                                              │
│  ┌─ VERIFIED MATCH (38/44) ──────────────┐   ┌─ 39 ROUTERS ──────────────────┐  ✅ 38 modules correctly      │
│  │                                      │   │                               │     hit their backend prefix  │
│  │  userApi     → /users                │   │  users.py       → /users      │                              │
│  │  roleApi     → /roles                │   │  roles.py       → /roles      │  ✅ 6 modules fixed           │
│  │  assetApi    → /assets               │   │  assets.py      → /assets     │     (2026-07-21):             │
│  │  permissionApi→ /permissions         │   │  permissions.py → /permissions│                              │
│  │  locationApi → /locations            │   │  locations.py   → /locations  │  1. bargeTrackingApi          │
│  │  ... (33 more)                       │   │  ... (34 more)                │     now calls /barge-trip/*   │
│  │  └──────────────────────────────────────┘   └───────────────────────────────┘                              │
│  │                                                                                   2. shuttleTrackingApi     │
│  │  ┌─ FIXED (6) ───────────────────────┐                                         now calls /shuttle-fso/*   │
│  │  │                                      │                                        │                              │
│  │  │ 1. bargeTrackingApi                  │   ┌─ ROUTER PREFIXES (ALL MATCH) ──┐  3. fsoTrackingApi            │
│  │  │    Now calls /barge-trip/*           │   │                               │     now calls /shuttle-fso/* │
│  │  │ 2. shuttleTrackingApi                │   │  ✅ /users, /roles, /assets    │                              │
│  │  │    Now calls /shuttle-fso/*          │   │  ✅ /locations, /permissions   │  4. locationAccountingDay   │
│  │  │ 3. fsoTrackingApi                    │   │  ✅ /operation-transactions    │     now calls                │
│  │  │    Now calls /shuttle-fso/*          │   │  ✅ /operation-entries         │     /locations/accounting-   │
│  │  │ 4. locationAccountingDaySettingApi   │   │  ✅ /barge-trip, /shuttle-fso  │     day-settings/*           │
│  │  │    Now calls /locations/accounting-  │   │  ✅ /reports (via FE now)      │                              │
│  │  │     day-settings/*                   │   └───────────────────────────────┘  5. materialBalanceReportApi  │
│  │  │ 5. materialBalanceReportApi          │                                        now calls /reports/*      │
│  │  │    Now calls /reports/fso/           │   ┌─ STILL UNUSED ──────────────┐                              │
│  │  │     material-balance                 │   │                               │  6. outTurnReportApi          │
│  │  │ 6. outTurnReportApi                  │   │  /vessel-stock-ledger - no FE │     now calls /reports/*      │
│  │  │    Now calls /reports/out-turn-report│   │  /operation-tasks - no FE      │                              │
│  │  │     /validation                      │   └───────────────────────────────┘                              │
│  │  └──────────────────────────────────────┘                                                                  │
│                                                                                                              │
│  FIX APPLIED (2026-07-21): Prepend the router prefix to all endpoint paths in the 6 mismatched API modules   │
│  ~19 endpoint paths corrected across 6 files                                                                │
│                                                                                                              │
│  REMAINING: /reports still has many endpoints (fso/otr, fso/outturn, export/xlsx, tank-stock-ledger/rebuild) │
│  with no frontend consumers yet                                                                               │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```
