## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

## Recent Fixes (2026-08-11) - RBAC Flow Hardening

### Approve Blocked Despite Full Permissions (root cause found 2026-08-11)
- **Root cause was DATA, not code**: workflow policy #1 "OPERATION_APPROVAL" (created 2026-06-03, action=APPROVE, no context filters) listed ONLY the Admin role. The Operation Workflow Policy layer gates actions AFTER RBAC permissions — when an active policy matches, only its listed roles may act, regardless of Role Permission Assignment.
- Data fix: added Operator role to policy #1 (manageable via Operation Workflow Policy page).
- **workflow_policies.py**: `/operation-workflow-policies/check` no longer requires "View Operation Workflow Policy" — it is a self-scoped check any authenticated user needs.
- **permissions.py**: `evaluate_operation_workflow_policy` + `find_matching_operation_workflow_policy` now compare context codes (operation type, asset type, location) case-insensitively; added admin bypass so admins can't be locked out; denial reason now names the blocking policy.
- **OperationTransactionDetail.jsx**: UI now distinguishes "missing RBAC permission" from "blocked by workflow policy '<name>'" in both the disabled-button hints and the modal error messages (stores reason/policy name from the check response).
- Reference RBAC survey of spatiumddi-main & OpenConstructionERP-main done — see conversation notes; key borrowable patterns: router-level `require_resource_permission` dependency factory, `None`-means-no-filter admin scoping, audit row on every denial, approver ≠ submitter rule.

### Critical RBAC Bugs Fixed
1. **Global Asset Visibility** — Global assets (scope='Global') now appear for location-scoped users when operation type is available
2. **Case-Insensitive Location Filtering** — Location codes "AGGE"/"agge" now match correctly via `func.lower()` normalization
3. **Multi-Role Permission Aggregation** — Users with multiple roles now get permissions from ALL active roles
4. **Inactive Role Bypass** — Inactive/deleted roles no longer grant permissions (filtered by `Role.status == "Active"`)
5. **Tank Operation Summary Visibility** — Approved Operation Entry tickets now appear in summary (fixed case-sensitive layout matching)
6. **Operation Transaction Register (Non-Admin)** — Non-admin users can now see paged register (fixed location filter + multi-role support)

### RBAC Hardening Additions
- **Diagnostics Endpoint** — `GET /auth/me/rbac-diagnostics` shows user's actual permissions, roles, location scopes
- **Regression Test Suite** — `backend/tests/test_rbac_regression.py` with 6 test classes covering all fix scenarios
- **RBAC Hardening Guide** — `RBAC_HARDENING_GUIDE.md` with best practices, checklist for 57+ pages, common patterns

### Files Modified (11 total)
**Backend Routers:** assets.py, auth.py, operation_entries.py, operation_transactions.py, tank_operations.py, vessel_operations.py  
**Backend Dependencies:** permissions.py  
**Backend Utils:** helpers.py (added `normalize_location_code()`, `apply_location_filter()`)  
**Backend Tests:** test_rbac_regression.py (NEW)  
**Frontend:** authApi.js, OperationEntry.jsx  
**Documentation:** RBAC_HARDENING_GUIDE.md (NEW), RBAC_FIX_SUMMARY.md (NEW)

---

## Previous Fixes (2026-07-15)

### Critical Bugs Fixed
- **users.py**: Added missing `datetime` import (was causing `NameError` on user creation)
- **permissions.py**: Added missing `User` model import (was causing `NameError` on GET endpoint)
- **roles.py**: Added missing `UserRole` and `RolePermission` imports (was causing `NameError` on role deletion)
- **reports.py**: Fixed broken `build_mapping_response` function (was a copy-paste error with wrong variable names)
- **reports.py**: Added missing `build_date_range` function (was referenced but not defined)

### Deduplication
- **app/utils/helpers.py**: Added shared `normalize_code()` function
- **tank_operations.py**: Removed local `normalize_code()`, now imports from `app.utils.helpers`
- **vessel_operations.py**: Removed local `normalize_code()`, now imports from `app.utils.helpers`
- **reports.py**: Removed local `normalize_code()`, now imports from `app.utils.helpers`

### Remaining Known Duplicates (Not Yet Fixed)
- `get_trip_by_convoy_or_none`: duplicated in operation_transactions.py, barge_trip_tracking.py, operation_entries.py
- `ensure_trip_not_closed`: duplicated in operation_transactions.py, barge_trip_tracking.py
- `ensure_shuttle_voyage_not_closed`: duplicated in operation_transactions.py, shuttle_fso_voyages.py
- `get_or_create_shuttle_voyage`: duplicated in operation_transactions.py, shuttle_fso_voyages.py (different implementations)
- `load_multi_tank_payload`: duplicated in operation_transactions.py, barge_trip_tracking.py
- `build_multitank_comparison_json`: duplicated in operation_transactions.py, barge_trip_tracking.py (different implementations)
- Report/stock ledger functions: ~25 functions duplicated between tank_stock_ledger.py, reports.py, material_balance_templates.py
- `recompute_mapping_comparison` / `build_mapping_response`: duplicated between movement_mappings.py, reports.py

### Inconsistencies (Not Yet Fixed)
- Empty router prefix used by 6 routers (tank_stock_ledger, tanker_tracking, dashboard, backup_restore, reports, flowmeter_configs_records)
- Duplicate endpoint `/barge-trip/barge-tracking` duplicates `/barge-trip/convoy-tracker`
- Shared prefix `/operation-transactions` used by both correction_requests.py and operation_transactions.py
