# Hydrocarbon Accounting – Project Memory

> **Read this file first in every session.** The "Standing Instructions" below are permanent
> project rules given by the product owner. They apply to every page, every module and every
> future change. Never drop or weaken them.

## 0. Hard Constraint – Backend & Database Are Frozen

- **Do NOT change backend code (`backend/`) or any database structure** (models, migrations,
  seed data, routers, schemas) unless the owner explicitly asks for it. UI/UX work must be done
  entirely in `frontend/`. Changing the backend "will collapse the functionality".
- The backend already writes an audit row for every mutation via
  `app/services/audit_service.create_audit_log` (used in 40+ routers) – the frontend relies on
  this for server-side auditing and must never bypass the API.

## 1. Standing Instructions (product owner, 2026-10-14)

| # | Rule | How it is implemented in this repo |
|---|------|------------------------------------|
| 1 | **All actions in all pages must be properly logged and audited.** | Server: every create/update/delete/approve/export endpoint writes an `AuditLog` row (already in place – keep using the existing API endpoints). Client: `frontend/src/utils/actionLogger.js` (`logUiAction`) records UI-only actions (navigation, exports, imports, prints, filter use, theme changes) with user, route and timestamp into a local ring buffer that is visible from the user menu ("Activity"). Every new page must call `logUiAction` for its user-triggered actions. |
| 2 | **Provide Light & Dark theme selection** with matching fonts, colours and other changes. | `frontend/src/theme/ThemeProvider.jsx` + CSS variables in `frontend/src/index.css` (`:root` = light, `[data-theme="dark"]` = dark). Never hard-code colours in new CSS/JSX – use the tokens (`var(--surface)`, `var(--text)`, `var(--primary)` …). Theme choice (Light / Dark / System) is persisted per browser in `localStorage` and toggled from the top bar. |
| 3 | **Top-side navigation with dropdown menus** – never a side navigation. | `frontend/src/components/layout/TopNavigation.jsx` driven by `frontend/src/data/navigationItems.js`. New pages are registered there (label, path, permission). |
| 4 | **Always paginate list pages** with page sizes **20 / 50 / 100**. | `frontend/src/components/common/PaginationControls.jsx` (`paginateRows`, `usePageSize`, `PAGE_SIZE_OPTIONS`). The chosen page size is a global, persisted user preference. Every table of data must use it. Server-paginated pages pass the same page size as `limit`. |
| 5 | **Easy + advanced filters** on any criteria of the available content, with **date and date-range filters kept separate**. | `frontend/src/components/common/DataFilterBar.jsx` + `frontend/src/hooks/useDataFilters.js`: quick search (all columns), advanced condition builder (field / operator / value, match all/any), a single-date filter and a separate date-range filter. Every list page must wire its rows through `useDataFilters`. |
| 6 | **Bulk upload (.xlsx & .csv) and bulk export (.xlsx, .csv, .pdf) on every list page.** | `frontend/src/utils/exportUtils.js` (CSV / XLSX via `exceljs`, PDF via `jspdf` + `jspdf-autotable`), `frontend/src/components/common/ExportMenu.jsx`, `frontend/src/components/common/DataTableToolbar.jsx` (single place that mounts filter bar + `ExportMenu` + bulk-upload button), `frontend/src/components/common/ImportDialog.jsx` (4-step wizard: choose file → map columns → preview → results), `frontend/src/utils/importUtils.js` (`parseImportFile`, `parseImportMatrix`, `autoMapColumns`, `parseCsvText`), `frontend/src/utils/importTemplateStore.js` + `frontend/src/hooks/useBulkTemplates.js` (layered, user-configurable upload templates). **Both** `.xlsx` and `.csv` are accepted everywhere an upload exists; **all three** formats are offered everywhere an export exists. Read-only pages (summaries, registers, reports) get export only. See `BULK_UPLOAD_EXPORT.md`. |
| 7 | **Professional Navy Blue & White theme**, no unnecessary animations, no emojis, enterprise-grade and well-structured modules. | Palette & type scale are documented in `frontend/DESIGN_SYSTEM.md`. Only state-feedback transitions (≤150 ms, colour/opacity) are allowed; no hover "lift" transforms, no decorative motion, `prefers-reduced-motion` is honoured. Icons are inline SVG (`frontend/src/components/common/Icon.jsx`), never emoji characters. |
| 8 | **All user alerts (errors, cautions, success) are shown next to the respective data-entry section or as pop-ups** – never `window.alert`, never far away from the field/section they belong to. | Inline: `frontend/src/components/common/AlertMessage.jsx` placed directly above/below the form or table it concerns, field errors under the field. Pop-up: `ToastProvider`/`useToast` (`frontend/src/components/common/Toast.jsx`) for non-blocking notices and `ConfirmDialog` for confirmations. `window.alert`/`window.confirm` are banned (ESLint `no-alert`). |
| 9 | **Every page ships with Auditing and RBAC by default**, controlled by the admin user. | Wrap every route in `PermissionGuard` (module **View** permission) and gate every mutating control with the matching **action** permission from the catalog: `usePermissions(loggedInUser).hasPermission('Create Location')` / `'Edit Location'` / `'Delete Location'` / the named workflow permission (`Close Movement Mapping`, `Approve Operation Transaction`, …). Never use a single `Manage …` flag for create, edit and delete – the legacy `Manage X` names no longer exist. Permission names must exist in the Permission Master so the admin can assign them per role. Audit = rule 1. |
| 10 | **Pop-ups must not close when the user clicks outside them.** Only the Cancel / Close button closes a dialog. | Use `frontend/src/components/common/Modal.jsx` (and `ConfirmDialog`) for every dialog. The backdrop has no click handler and Escape is ignored by design. Never add `onClick` to a backdrop/overlay element. Any dialog that is rendered inline (for example a column configuration panel) is a bug: it must go through `Modal`, which portals to `<body>`, so its CSS cannot live under a page-scoped selector. |

### Permission model (read before gating any control)

* **Single source of truth:** `backend/app/utils/default_permissions.py` – 194 permissions in
  8 categories that mirror the top menu: User Management, Master Data Management, Configurations,
  Operations, Operation Tracking, Export Operations, Reporting, Administration.
* Per module the catalog defines **View / Create / Edit / Delete** plus named workflow actions
  (`Submit Operation Transaction`, `Close Movement Mapping`, `Approve Backup Restore`, …).
  `GET /permissions/catalog` serves the same structure to the UI.
* **Frontend helpers:** `frontend/src/hooks/usePermissions.js` (`usePermissions(user)`,
  `userHasPermission`, `isAdminUser` – admin bootstrap always passes) and
  `frontend/src/utils/permissionCatalog.js` (groups the catalog for Permission Master, Role
  Permission Assignment and Access Summary).
* **Rules**
  * Route guards use the module's **View** permission (`PermissionGuard`).
  * A create form needs `Create X`, an edit form / row Edit button needs `Edit X`, a delete
    needs `Delete X`. When one form does both, use `editId === null ? canCreate : canEdit`.
  * Workflow buttons use their own permission, not a CRUD one.
  * Hide the control (and the Actions column) when the permission is missing; also guard the
    handler, because the API enforces the same permission server-side.
  * Never invent a permission name – check the catalog first. `backend/tests/test_permission_catalog.py`
    fails the build when a router checks a permission that is not in the catalog.

### UI craft references (apply the principles manually – plugins are not installed here)

The owner asked that the following Claude Code UI skills guide all UI work. Their key rules are
condensed in `frontend/DESIGN_SYSTEM.md` and must be followed even though the plugins themselves
cannot be installed in the sandbox:

1. `frontend-design` (Anthropic) – commit to one deliberate aesthetic (here: navy & white
   enterprise), real hierarchy, no generic "card kit", no decorative motion, visible focus.
2. `UI UX Pro Max` – derive a full design system (style, palette, fonts, spacing, anti-patterns)
   before building; it lives in `frontend/DESIGN_SYSTEM.md`.
3. `Taste Skill` – metric-driven spacing/typography/motion rules; audit existing screens.
4. `Impeccable` – critique → polish → typeset → colorize passes before shipping.
5. `Emil Kowalski's skills` – motion only where it answers a user action, correct easing/duration.
6. `Interface Design` – persist design decisions (button heights, radius, spacing, colours) in a
   system file so new pages stay consistent → `frontend/DESIGN_SYSTEM.md`.
7. `shadcn/ui` – CSS-variable theming & dark mode conventions (we are not using shadcn
   components, only its theming approach).
8. `Web Design Guidelines` (Vercel) – accessibility, focus states, forms, reduced motion,
   `Intl` formatting, dark-mode `color-scheme`; use as the pre-ship checklist.
9. `webapp-testing` (Anthropic) – when a browser is available, click through the flows and take
   screenshots before handing over.

### Checklist for every new or modified page

1. Route wrapped in `PermissionGuard` (module **View** permission); every mutating control gated
   by its own action permission (`Create …` / `Edit …` / `Delete …` / named workflow), and the
   Actions column hidden when the user holds none of them.
2. Page header via `PageHeader`; lists via `DataFilterBar` + `PaginationControls` (20/50/100).
3. Bulk export (CSV / XLSX / PDF) on every list, including read-only summaries; bulk upload
   (`.xlsx` + `.csv`) wherever a create/replace API exists. Wire both through
   `DataTableToolbar` (`module`, `canExport`, `importConfig`, `canImport`) — never bolt on a
   one-off `<input type="file">` or a bespoke export button. Upload errors from the DB must be
   surfaced to the user row-by-row in the ImportDialog results step so the file can be corrected
   and re-uploaded.
4. Dialogs only via `Modal` / `ConfirmDialog` (no outside-click close); create/edit forms use
   `FormDialog`. Destructive actions use `useConfirm`.
5. Alerts via `AlertMessage` next to the section, or `useToast`; never `alert()`.
6. `logUiAction` on user-triggered actions that the backend does not already audit.
7. Colours and fonts only via CSS variables; verify in both Light and Dark themes.
8. No emojis, no decorative animation; icons from `Icon.jsx`.

---

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
