## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

## Recent Fixes (2026-07-15)

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
