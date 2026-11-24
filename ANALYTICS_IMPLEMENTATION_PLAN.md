# Analytics — Interactive Dashboard Implementation Plan

**Repository:** `praveen-christuraj/hydrocarbon-accounting-otms`  
**Branch:** `arena/9ba67694-hydrocarbon-accounting-otms` (from `ee365e5b`)  
**Date:** 2026-11-24  
**Status:** `DRAFT — for owner review before coding`  
**Author:** Arena Agent (thorough codebase study, no code changed)  
**References:** `REPORT_BUILDER.md` (410 lines), `CLAUDE.md` (538 lines, standing rules 1–12), `PERMISSION_CRITERIA_MODEL.md`, `BOOK_DATA_HIERARCHY.md`, `BULK_UPLOAD_EXPORT.md`, `PRINT_REPORT_PROFILE.md`, existing `dashboard` + `report_builder` backend & frontend.

> This plan delivers the requested **Power BI–like Analytics studio**: a permission-gated, location-scoped, drag-drop dashboard builder with KPI cards, charts (bar/column/line/area/combo), tables (tabular + matrix/pivot), pie/donut and gauge visuals, plus slicers, separate date & date-range filters, drill-through, user+location RBAC, direct-DB + calculated + comparative measures, and the Report Builder formula/condition/formatting engine reused verbatim. It respects all **12 standing instructions** and reuses `report_catalog` / `report_formula` / `report_engine` instead of reinventing them.

---

## Table of contents

1. [Goals extracted from the request](#1-goals-extracted-from-the-request)
2. [Current state — what already exists](#2-current-state--what-already-exists)
3. [Gap analysis](#3-gap-analysis)
4. [Product vision & information architecture](#4-product-vision--information-architecture)
5. [RBAC — user & location controlled](#5-rbac--user--location-controlled)
6. [Data layer — catalog, conditions, calculations, comparisons](#6-data-layer--catalog-conditions-calculations-comparisons)
7. [Visual catalogue](#7-visual-catalogue)
8. [Slicers, filters & time controls](#8-slicers-filters--time-controls)
9. [Interactions — cross-filter, drill-through, tooltip](#9-interactions--cross-filter-drill-through-tooltip)
10. [Formatting & conditional formatting](#10-formatting--conditional-formatting)
11. [Builder UX — Power BI parity](#11-builder-ux--power-bi-parity)
12. [Viewer, gallery, and placement](#12-viewer-gallery-and-placement)
13. [Backend design](#13-backend-design)
14. [Frontend design](#14-frontend-design)
15. [State, performance, caps & caching](#15-state-performance-caps--caching)
16. [Audit, export, print & bulk](#16-audit-export-print--bulk)
17. [Theming, responsive & accessibility](#17-theming-responsive--accessibility)
18. [Phased delivery plan](#18-phased-delivery-plan)
19. [File & code map (exact paths)](#19-file--code-map-exact-paths)
20. [Definition JSON — schema v2 (proposed)](#20-definition-json--schema-v2-proposed)
21. [API surface (proposed)](#21-api-surface-proposed)
22. [Permission catalog additions](#22-permission-catalog-additions)
23. [Risks, constraints & mitigations](#23-risks-constraints--mitigations)
24. [Open decisions for the owner](#24-open-decisions-for-the-owner)
25. [Appendices](#25-appendices)

---

## 1. Goals extracted from the request

| # | Requirement | Owner wording | Plan response |
|---|-------------|---------------|---------------|
| G1 | **Interactive dashboard builder** inside the app | “like Report Builder … can build the dashboard here itself” | New **Analytics Studio** at `Configurations → Analytics Builder` (design) + `Analytics → My Dashboards` (run), same 6-step designer pattern as Report Builder but visual-first, drag-drop canvas. |
| G2 | **Visual types** | “KPI cards, Charts (Bars, Columns, Graphs), Tables (Both Column & Matrix), Pie charts, etc.” | Full visual catalogue §7: `KPI_CARD`, `TABLE`, `MATRIX`, `BAR`, `COLUMN`, `LINE`, `AREA`, `COMBO`, `PIE`, `DONUT`, `GAUGE`, `SCATTER`, `WATERFALL`, `FUNNEL`, `TREEMAP`, `KPI_TREND` (phase 1 ships KPI, TABLE, MATRIX, BAR/COLUMN/LINE/AREA, PIE/DONUT; phase 2 adds remainder). Every visual is a single `echarts-for-react` or table renderer. |
| G3 | **Free placement** | “he can place it wherever he wants just like Power BI” | `react-grid-layout` (already in `package.json` `^1.5.3`) 12-col responsive canvas, resize, reorder, snap, lock. Dashboard JSON stores `layout[]` + `visuals{}` like current `dashboard_configs.config_json` but upgraded to schema v2. Dashboards can be embedded as **home widgets** or linked from the top nav, same as “one menu item per published report” pattern in `TopNavigation.jsx`. |
| G4 | **Slicers & time** | “Slicers, Date & date Range filters, etc.” | First-class **slicers** (§8) + **separate** single-date and date-range controls (rule 5). Slicers are visuals that *are* filters: single/multi-select, dropdown, list, hierarchy, slider, search. Date range uses the Report Builder `date_basis` semantics (`PAYLOAD_OPERATION_DATE`, `ACCOUNTING_DATE`, `OPERATION_DATE`, `CREATED_AT`, `COLUMN`, `NONE`). |
| G5 | **RBAC: user & location** | “proper User & Location controlled RBACs” | Inherits the multi-criteria model (`PERMISSION_CRITERIA_MODEL.md`): permission × location × report-location scope × party rule. Per-dashboard grants `USER | ROLE | LOCATION` with `VIEW | EDIT` (identical to `report_access_grants`), plus runner scope `user_report_location_codes` ∩ runtime slicer choice. Party rule applied for cross-location tickets. |
| G6 | **Measure kinds** | “Some KPIs/Visuals are fetching the data from DB directly, some will be calculated, some will be comparisons” | Three kinds: **(a) direct** = a catalogued column / virtual / JSON path / ticket field / payload path, **(b) calculated** = `report_formula` expression over other columns, **(c) comparison** = column-level `value_conditions` (conditional measures) + period comparisons (WoW/MoM/YoY, variance, % of total). |
| G7 | **Conditions & formulas** | “We need to use conditions (if, or, and etc), formatting, etc. … take that as a reference [Report Builder]” | Reuse **exactly**: `services/report_formula.py` (IF/IFS/AND/OR/NOT/IFERROR/COALESCE/ISBLANK/ABS/ROUND/SUM/AVG/MIN/MAX/PCT/CONCAT/UPPER/LOWER/TRIM/LEN/LEFT/RIGHT/YEAR/MONTH/DAY/DATEDIFF, operators `+ - * / % ^` and comparisons `= <> > >= < <=`, logical `AND OR NOT && || !`), plus `ReportDataTable` formatting, `FormulaBuilder` & `ComparisonConditionsEditor` UIs. No fork. |
| G8 | **Enterprise constraints** | Standing rules 1–12 | Every list paginated 20/50/100, `Modal` only, `Toast`/`AlertMessage` never `alert`, navy+white theme tokens, `logUiAction` + server `AuditLog`, `ExportMenu` xlsx/csv/pdf, print via `PrintProfileProvider`, top nav, light/dark, bulk upload where editable. |

Out of scope for the first cut (explicitly deferred to phase 2/3): row-level security beyond location scope, write-back visuals, paginated report export >50k rows, real-time streaming, custom D3, map visuals that need tiling keys.

---

## 2. Current state — what already exists

### 2.1 Report Builder — the reference implementation (study notes)

* **Router:** `backend/app/routers/report_builder.py` (prefix `/report-builder`, ~893 lines). Endpoints: `/catalog`, `/operation-fields`, `/json-paths` (POST), `/formula/validate`, `/lookups`, `/definitions` (CRUD + duplicate/publish/run/from-starter), `/run-preview`, `/definitions/{id}/versions`, `/my-reports`, `/my-reports/{id}/run|export`. Design permissions `View/Create/Edit/Delete/Publish Report Definition`; run permissions `View/Export Custom Report`.
* **Catalog:** `services/report_catalog.py` (~714 lines). `build_catalog()` catalogues **every non-denied table** (`TABLE_GROUPS`, 9 groups, ~45 tables) + two featured datasets: `operation_tickets` (tickets + payloads + virtual dates/names) and `tank_stock_ledger`. Each table entry lists columns with `data_type` (`text|number|date|datetime|time|json`), `is_json`, `is_location`, `is_date`, plus `relationships` (single-column FK to unique parent). Sensitive columns filtered by `is_sensitive_column` (password/secret/token/2fa). `TICKET_VIRTUAL_FIELDS` (12 entries) and `LEDGER_VIRTUAL_FIELDS` (2 entries) supply derived fields. `humanize()` handles abbreviations (`GSV → GSV`, `bsw → BS&W`).
* **Formula engine:** `services/report_formula.py` (~680 lines). Tokeniser + recursive-descent parser producing AST tuples. `FUNCTIONS` & `FUNCTION_HELP` (15+ functions) + `OPERATOR_HELP`. `to_decimal`/`truthy`/`is_blank`, `MAX_AST_NODES`, `MAX_FORMULA_LENGTH`, `Decimal` arithmetic, `DIV0` ↔ `IFERROR`, `referenced_columns()`, `validate_formula()` (unknown column check), `evaluate(node, row, today)`. Used both server validation and per-row execution with a 25s budget.
* **Execution:** `services/report_engine.py` (~1758 lines). Validates definition → loads base rows (SQLAlchemy, parameterised) limited to runner scope → splits JSON (dot paths, `[]` explosion, wildcards) → runs calculated columns in dependency order → applies per-column `value_conditions` (conditional measure, up to 20 per column / 100 per report, logic `AND|OR`) → fixed + runtime filters (`FILTER_OPERATORS` 15 kinds) → `group_by` aggregation (8 aggregates incl. `PRODUCT`) or `matrix` pivot (60 column cap, remainder → *Other*) → sorting, totals, pagination. Caps: `SCAN_CAP 50k`, `EXPLODED_CAP 100k`, `EXPORT_CAP 50k`, `MAX_MATRIX_COLUMNS 60`, `MAX_TEXT_CELL 2000`. Book Stock entity mapping via `BOOK_STOCK_SCOPED_TABLES` + `export_location_entity`. Party-scope re-check. `date_basis` handling includes `PAYLOAD_OPERATION_DATE`/`ACCOUNTING_DATE` using `services/operation_datetime.py` and location `LocationAccountingDaySetting`.
* **Frontend builder:** `frontend/src/pages/ReportBuilder.jsx` (~2000 lines, 6 steps: Report & Data → Columns → Rows & Layout → Filters → Access → Preview & Save). Uses `FormulaBuilder.jsx` (click/IF/IFS/text tabs, live server validation, `validateReportFormula`) and `ComparisonConditionsEditor.jsx` (value_conditions), `JsonColumnPicker.jsx` and `ReportDataTable.jsx` (totals, warnings, matrix, export). `utils/reportBuilder.js` holds `emptyDefinition()`, `slugColumnKey`, `formulaInWords`, `formatCellValue`, `AGGREGATES`, `BUCKETS`, `FILTER_OPERATORS`, `dateRangeDefaults`.
* **Viewer:** `frontend/src/pages/CustomReportViewer.jsx` (~1200 lines). Date range + runtime filters + search + pagination + TOTAL row + About + warnings + `ReportDataTable` with drill groups + Excel/CSV (server) + `ExportMenu` (client) + Print (via `PrintProfileProvider`). Dynamically appends one nav item per published shared report in `TopNavigation`.

### 2.2 Dashboard — existing but minimal (study notes)

* **Models:** `backend/app/models.py:1515-1620` — `DashboardConfig` (`name`, `scope_type GLOBAL|LOCATION`, `location_code`, `status Draft|Published|Archived`, `active_version_id`), `DashboardVersion` (`config_id`, `version_number`, `config_json JSONB`, `change_note`), `DashboardDataSource` (`data_source_code` unique, `data_source_name`, `handler_key` enum 8 values `FSO_OTR|FSO_MATERIAL_BALANCE|FSO_OUTTURN|SHUTTLE_SUMMARY|TANK_STOCK_SNAPSHOT|ASSET_LIST|OP_TRANSACTIONS|OP_STATUS_COUNTS`, `allowed_params_json {allowed:[{key,type,required}]}`, `status Active|Inactive`).
* **Schemas:** `backend/app/schemas.py:2573-2750` — `DashboardConfigCreate/Update/Response`, `DashboardVersionResponse`, `DashboardDataSourceCreate/Update/Response`, `DashboardDataRequest/Response`, `DashboardPublishRequest/RevertRequest`.
* **Router:** `backend/app/routers/dashboard.py` (~2025 lines). CRUD for configs/versions/data-sources plus `POST /dashboard/data` gateway that validates allowed params, coerces types, checks location scope (`get_user_location_codes`/`ensure_location_in_user_scope`), and dispatches to handler keys. Handlers already include tank snapshot with calibration max capacity, fill %, stock values, `TANK_STOCK_SNAPSHOT` etc., plus FSO/OTR/material balance builders by reusing `routers/reports.py`.
* **Frontend:** `frontend/src/pages/Dashboard.jsx` (~973 lines) — read-only viewer: picks a `Published` config (LOCATION → GLOBAL fallback), loads `active_version.config_json {layout[], widgets{}}`, renders `KPIWidget`, `TableWidget`, `TankVisualWidget`, `TextWidget`, `DataWidget` inside a `react-grid-layout` (`ResponsiveGridLayout`) grid (12 cols). Fetches per-widget via `POST /dashboard/data` with caching (`cacheRef`). `DashboardBuilder.jsx` (~1273 lines) — creator: GLOBAL/LOCATION scope, name/remarks,  universal `dashFilters` (location/asset_type/asset/operation_type/date range), widget list (KPI/TABLE/CHART/TANK_VISUAL/TEXT), per-widget `data_source_code + params + mapping/config`, params validated against `allowed_params_json`, auto-fill from dashboard filters, preview per widget (`fetchDashboardData`), local draft in `localStorage`, validation, publish.
* **API clients:** `frontend/src/api/dashboardApi.js` (configs/versions/publish) + `dashboardDataApi.js` (`listDashboardDataSources`, `fetchDashboardData`). Already used by builder.
* **Limitations to extend:** handler set is fixed to 8, visuals limited to 4 types (KPI/TABLE/CHART/TANK_VISUAL), no slicers, no drill-through, no matrix/pie formally, no per-visual calculations/comparisons/conditional formatting, no per-dashboard grants (only config scope), no cross-filter.

### 2.3 RBAC & location model (study notes)

* **Catalog:** `backend/app/utils/default_permissions.py` (857 lines). `PERMISSION_CATALOG` = 9 categories, 226 permissions (`User Management` … `Administration`). Module `Dashboard` currently 5 perms: `View/Create/Edit/Delete/Publish Dashboard`. Report side: `View/Create/Edit/Delete/Publish Report Definition`, `View/Export Custom Report`. Derivation via `DERIVED_PERMISSION_GRANTS` and legacy `LEGACY_PERMISSION_REPLACEMENTS`.
* **Dependencies:** `backend/app/dependencies/permissions.py` (~948 lines). `is_admin_user` (Admin & Super Admin bypass), `user_has_permission`, `require_user_permission`, `get_user_location_codes` (None = all), `get_user_report_location_codes` (operational + explicit report-only via `user_report_locations`/`role_report_locations`), `apply_transaction_party_scope_filter` / `ensure_transaction_in_user_party_scope` (origin/destination/sender/receiver), `get_user_role_ids`, `ensure_location_in_user_scope`, `normalize_location_code`. Used by every dashboard/report endpoint.
* **Frontend helpers:** `frontend/src/hooks/usePermissions.js` (Admin via roles, `userHasPermission`, `hasAny/hasAll`), `frontend/src/utils/permissionCatalog.js`, `frontend/src/components/PermissionGuard.jsx` (route guard by permission), `frontend/src/data/navigationItems.js` (top nav, one entry per published custom report appended dynamically), `frontend/src/data/defaultPermissions.js` (seed for UI).
* **Scope tables:** `user_locations`, `role_locations`, `user_report_locations`, `role_report_locations`, `export_location_entity` (location→entity for Book Stock). Book Stock reuses the same location→entity mapping to avoid cross-entity leakage.

### 2.4 Frontend stack & UI conventions (study notes)

* **Core:** React `19.2.5` + `react-router-dom` `7.15`, Vite `8`, ESLint, `happy-dom`. Charts: `echarts` `6.1` + `echarts-for-react` `3.0.6`. Grid: `react-grid-layout` `1.5.3` + `react-resizable`. Exports: `exceljs` `4.4` + `jspdf` `4.2` + `jspdf-autotable` `5.0`. Fonts: `@fontsource-variable/inter`. No second chart library — keep single `echarts` instance.
* **Standing UI rules enforced:** `TopNavigation.jsx` + `navigationItems.js` (top menu, no side nav); `ThemeProvider.jsx` + `index.css` tokens `var(--surface|--text|--primary|--border|--divider)` (no hard-coded colours); `PaginationControls.jsx` (20/50/100, persisted); `DataFilterBar.jsx` + `useDataFilters.js` (quick search + advanced condition builder + *separate* single-date and date-range); `ExportMenu.jsx` + `DataTableToolbar.jsx` + `ImportDialog.jsx` + `importUtils.js` (xlsx+csv both, xlsx/csv/pdf exports); `AlertMessage.jsx` + `Toast.jsx` + `ConfirmDialog` + `Modal.jsx` (never backdrop close, never `alert`); `actionLogger.js` (`logUiAction`); `PrintProfileProvider.jsx` (every Print picks a `CompanyReportProfile`).
* **Existing shared widgets:** `Icon.jsx` (inline SVG, no emoji), `AssetCalibrationTable.jsx` chart per asset, `StockAnomalyAnalytics.jsx` (`CusumTrendChart`), `Home.jsx` tiles, `MaterialBalanceReport.jsx`, `TankerTransactionReport.jsx` etc. Provide prior art for KPI formatting.

### 2.5 Other relevant surfaces

* `backend/app/services/operation_datetime.py` — `PAYLOAD_FIELD_CODES`, `coerce_payload_dict`, `resolve_accounting_date`, `parse_date_value`, `operation_parts_from_values`. Critical for correct accounting dates.
* `backend/app/services/permission_catalog.py` + `tracking_*`, `services/report_catalog.discover_json_paths` / `discover_operation_fields` for dynamic fields.
* `frontend/src/components/reportBuilder/*` and `utils/reportBuilder.js` already ship `FormulaBuilder` helpers (`buildIfFormula`, `buildIfsFormula`, `quoteOperand`, `formulaInWords`, `formatCellValue`, `isNumericValue`).
* `frontend/scripts/mock-api.mjs` — dev mock that will need an Analytics section added.

---

## 3. Gap analysis

| Area | Report Builder strength to reuse | Dashboard current | Gap to close for Analytics |
|------|-----------------------------------|-------------------|----------------------------|
| **Builder pattern** | 6-step wizard, Monaco-like formula builder, live validation, preview, duplicate/publish/versioning, `ReportAccessGrant` sharing | Basic builder (KPI/TABLE/CHART/TANK) tied to fixed handler keys, no steps, no grants, no version UX beyond publish | Need a **visual-first studio** with canvas, slicers, calculated/comparison columns, formatting — modelled on Report Builder steps but not a duplicate. |
| **Data sources** | Catalog of every reportable table + 2 featured datasets, JSON discovery, per-tank explosion, payload/accounting dates, related-column lookup | 8 hard-coded handler keys, `allowed_params_json` whitelisting per source | Keep the handler gateway for curated heavy joins (FSO/OTR/material balance) but add a **generic `ANALYTICS_QUERY` handler** that executes an `analytics definition` via `report_engine.run_report` — i.e., any visual can be backed by either a named handler or an ad-hoc Analytics query (so new tables need zero backend code). |
| **Calculations** | Decimal engine, 15+ functions, dependency-ordered per-row eval, per-cell `IFERROR` blanking, cycle detection | None per visual | Expose **calculated columns & measures** per visual via the same engine; add a thin **analytics measure compiler** that maps a visual's `columns[]` → `report_engine` columns. |
| **Comparisons** | `value_conditions` (conditional measure, per column, logic `AND|OR`) e.g. two rules on one quantity source for location A vs B | Not present | Promote to **comparison measures** (variance, variance %, % of total, period-over-period) plus conditional colour/symbol. Same `ComparisonConditionsEditor`. |
| **Slicers & time** | `runtime_filters` (8 types incl. location/status/asset/text/number/date/select) + viewer date range on `date_basis` | `dashFilters` (location/asset_type/asset/operation_type/date_from/date_to) only | Replace with **first-class slicers** (§8) that are themselves visuals; keep `runtime_filters` as the underlying contract so `report_engine` needs no change. Enforce separate single-date vs date-range controls. |
| **Tables** | `TABULAR` + `MATRIX` (pivot) with 60-col cap & *Other*, grouping/aggregation (8 aggs, 6 buckets), per-column formatting, hidden columns, sorting, totals | Simple `TABLE` widget with field/header/limit only; no matrix/pivot, no aggs, no buckets | Ship **tabular + matrix** table visuals reusing `report_engine` `MATRIX` path and `ReportDataTable`. |
| **Charts** | Drill groups on dates (YEAR→QUARTER→MONTH→WEEK→DAY→DETAIL) in `CustomReportViewer` | Preview chart only (BAR/LINE via `xField/yField`) | Full charting: BAR (clustered/stacked/100%), COLUMN, LINE (with markers, smoothing, area variant), AREA, COMBO (bar+line), PIE/DONUT, GAUGE (KPI), SCATTER, later WATERFALL/FUNNEL/TREEMAP. All via `echarts` theme-aware options, navy palette. |
| **Interactions** | Date drill + per-row actions | None | Add **cross-filter** (click a bar → filter other visuals), **cross-highlight**, **drill-through** (to detail page, to a Custom Report, to transaction `OperationTransactionDetail`), tooltip pinning, “see records”. |
| **KPI cards** | No KPI primitive (only totals) | `KPIWidget` reading `meta.total_rows` or a deep path | Promote to **KPI card** with value/comparison/trendline/sparkline, thresholds, prefix/suffix/decimals, conditional colour, comparison arrow, and optional mini chart. |
| **RBAC** | Per-report grants `USER|ROLE|LOCATION` + `visibility PRIVATE|INTERNAL`, runner `report_location_codes`, party rule, payload for approvals | Per-config `scope_type GLOBAL|LOCATION` + `View Dashboard` only; no per-dashboard sharing, no `EDIT` distinction for viewers | Add **dashboard grants** analogous to `report_access_grants` plus the same runner scope semantics. |
| **Placement** | One nav link per published report (dynamic in `TopNavigation`) | Viewer picks one config; builder is GLOBAL/LOCATION scoped | New **Analytics gallery** + ability to **pin a dashboard as a nav shortcut / home tile / embed** (“place it wherever he wants”). Each pinned placement is a permission-gated link, not a data copy. |
| **Governance** | `report_definition_versions`, publish/unpublish, audit, export, print via profile | `dashboard_versions` already (version_number + config_json) + publish/revert | Align dashboard versioning with report versioning (immutable snapshots, `change_note`, audit). Add dashboard grants to the versioned JSON for reproducibility. |
| **Performance** | SCAN/EXPLODED/EXPORT caps + warnings, 25 s budget | No caps on widget data | Enforce per-visual caps via the underlying report run (same caps). Batch render uses one endpoint + caching. |

**Key takeaway:** do **not** rewrite the reporting stack. Wrap it. Analytics visuals are thin presentations over `report_engine` runs (or the few curated handler runs that must stay fast). The biggest net-new pieces are the **canvas & slicer interaction model** and the **chart/KPI presentation layer**.

---

## 4. Product vision & information architecture

### 4.1 Modules & routes

```
Top nav →  Analytics  (new top-level dropdown, like Reporting)
           ├─ Analytics Home ............. /analytics ............ gallery + pinned dashboards
           ├─ Analytics Builder .......... /analytics/builder .... studio (create / edit)
           ├─ Analytics Builder (new) .... /analytics/builder/new
           ├─ My Dashboards ............. /analytics/my-dashboards ... published shared with me
           └─ (dynamic) one link per published analytics dashboard shared with me
                same pattern as Custom Reports appended by TopNavigation

Hidden / deep links:
  /analytics/view/:dashboardId .......... viewer (read-only render)
  /analytics/embed/:dashboardId ......... minimal chrome for iframe / home tile
  /analytics/builder/:dashboardId ....... edit draft (same component as /builder)
  /analytics/detail/:dashboardId/:visualId ... drill-through detail

Configurations nav:
  Analytics Builder also reachable from Configurations → Analytics Builder
  (parity with Report Builder under Configurations)
```

`frontend/src/data/navigationItems.js` gains a new top group:

```js
{
  label: 'Analytics',
  type: 'dropdown',
  items: [
    { label: 'Analytics Home',   path: '/analytics',                permission: 'View Analytics Dashboard' },
    { label: 'My Dashboards',    path: '/analytics/my-dashboards',  permission: 'View Analytics Dashboard' },
    { label: 'Analytics Builder',path: '/analytics/builder',        permission: 'View Analytics Definition' },
  ],
}
```

And the “published dashboard per-user” links are appended under `Analytics` exactly like the existing `Custom Reports` block in `TopNavigation.jsx`.

### 4.2 User roles in the flow

* **Viewer** (holds `View Analytics Dashboard`): browses gallery, opens a published dashboard, uses slicers, drills through, exports the page/PDF, prints via company profile. No edit chrome.
* **Designer** (holds `Create/Edit Analytics Definition` + `Publish Analytics Definition` for publish): creates a dashboard draft, adds visuals, binds data, writes calculations/comparison rules, styles, sets grants, previews, saves, publishes, versions, reverts. May be location-scoped (can only create LOCATION dashboards inside own scope).
* **Administrator** (holds all, plus `Edit Analytics Definition` is global): manages data sources (`Create/Edit Analytics Data Source`), seeds, and can edit any dashboard; sees all locations.

### 4.3 Mental model (Power BI parity, reduced)

| Power BI concept | OTMS Analytics equivalent | Where it lives |
|------------------|---------------------------|----------------|
| Dataset / Data model | **Catalog** — `operation_tickets` / `tank_stock_ledger` / any reportable table + curated handlers (`TANK_STOCK_SNAPSHOT`, etc.) | `report_catalog.build_catalog()` |
| Table & column | **Column** inside a visual’s `definition.columns[]` (`source.type: column|virtual|ticket_field|payload_path|json_path|related_column`) | Visual editor → Data pane |
| Measure | **Calculated column** (`kind: calculated`, `formula`, `data_type`, `format`) | Formula builder (same as Report Builder) |
| Conditional measure / calculated column with filter | **Comparison rule** (`value_conditions[]` + `value_condition_logic`) on a data column | Comparison conditions editor |
| Slicer visual | **Slicer visual** (`type: SLICER`) that writes into `dashboardFilters` and `visualFilters` | Left/filter pane + canvas |
| Filter pane (visual/page/report) | **Three filter levels:** `slicerFilters` (dashboard slicers) → `pageFilters` (per-page) → `visualFilters` (per-visual) — merged before run | Builder filter pane; `report_engine` `filters[]` + `runtime_filters` |
| Visual | **Visual** (`type: KPI_CARD|TABLE|MATRIX|BAR|COLUMN|LINE|AREA|COMBO|PIE|DONUT|GAUGE|...`) with `layout` entry | Canvas |
| Page | **Page** (later) — phase 1 dashboards are single-page; schema reserves `pages[]` | Definition JSON |
| Bookmark / Selection | **Slicer state** persisted in URL (`?slicer_state=`) + “Reset slicers” button | Viewer |
| Drill-through | **Drill-through** target — transaction detail, ledger, Custom Report, or a filtered copy of the same dashboard | Visual interaction menu |
| Workspace / App | **Dashboard** (`analytics_dashboard_definitions` / `dashboard_configs` v2) with `GLOBAL|LOCATION` scope | Gallery + builder |
| RLS | **Location scope + grants** (`USER|ROLE|LOCATION`, party rule, Book Stock entity mapping) | Permissions layer |

Phase 1 is **single-page dashboards**. The schema reserves `pages[]` so multi-page is additive.

---

## 5. RBAC — user & location controlled

### 5.1 Principles (inherited, not invented)

This module follows `PERMISSION_CRITERIA_MODEL.md` and the `report_builder` grants model exactly:

* **Permission check is live, per request** (no JWT claim trust). `require_user_permission` / `require_any_user_permission` read `role_permissions` at request time.
* **Admin bypass:** `is_admin_user` (Admin / Super Admin) bypasses permission and location checks — same as every other router.
* **Two location concepts** (kept distinct):
  * **Operational scope** — `get_user_location_codes(user, db)` → `None` means “all”, else a lower-cased set from `user_locations` + `role_locations`. Controls which **configs** are visible and which **rows** a visual may read (operational + `user/role_report_locations` for reporting scope).
  * **Reporting scope** — `get_user_report_location_codes(user, db)` (operational ∪ explicit report-only). Used at **run time** by `report_engine._requested_locations` to scope rows. A viewer whose reporting scope is `{A}` never sees rows from `{B}` even if a slicer asks for `B`; `report_engine` shrinks `effective_locations` to the intersection and warns when it does.
* **Party rule:** for cross-location datasets whose rows carry origin/destination/sender/receiver, the *visible set* is “*any* party location is in my scope”, not just `origin_location_code`. Implemented by `_load_ticket_rows` re-check (`party & allowed_scope`). The Analytics runner inherits this automatically because visuals run through `report_engine`.
* **Book Stock special:** entity codes are derived from the runner’s location scope via `export_location_entity` (`_book_stock_entity_codes`), never from the row alone.

### 5.2 Dashboard-level grants (new, aligned with Report Builder)

Reuse the `report_access_grants` pattern verbatim:

```sql
analytics_dashboard_grants (
  id bigserial pk,
  dashboard_id int fk analytics_dashboard_definitions.id on delete cascade,
  grant_type text  -- USER | ROLE | LOCATION
  user_id int null fk users.id,
  role_id int null fk roles.id,
  location_code text null fk locations.location_code,
  access_level text -- VIEW | EDIT (LOCATION only VIEW, like reports)
  created_by text,
  created_at timestamptz default now()
)
```

* `VIEW` = can open the published dashboard in the viewer / gallery / embed.
* `EDIT` = `VIEW` plus can open the builder for that dashboard and save new drafts. `OWNER` (creator or Admin) always has `EDIT`.
* An extra `INTERNAL` visibility toggle (like `report_definitions.visibility`): `PRIVATE` = grants only, `INTERNAL` = any user who holds `View Analytics Dashboard` can run a **published** dashboard (VIEW), grants still add EDIT. Phase 1 can ship with `PRIVATE` only and add `INTERNAL` later with a one-line `report_builder._my_access`-style branch.

**Who can list what:**

* `GET /analytics/dashboards` returns dashboards where caller has `VIEW|EDIT|OWNER`, or (if `INTERNAL` is added) every published dashboard when caller holds `View Analytics Dashboard`.
* `GET /analytics/dashboards/{id}` enforces the same.
* `PUT /analytics/dashboards/{id}` (edit) requires `EDIT|OWNER` or `Edit Analytics Definition` *and* the dashboard is still inside the editor’s location scope.
* Publish requires `Publish Analytics Definition` (OWNER or explicit permission). Non-Admin editors cannot widen a dashboard’s grants to include a location outside their own scope — same check as `report_builder._validate_grants` (admin bypass, scope intersection).

### 5.3 Per-visual RBAC — intentionally not exposed in phase 1

A visual inherits its dashboard’s grants **and** the runner’s reporting scope. There is no per-visual permission matrix in phase 1 — it creates “which visual can I see?” confusion and leaks through data (totals still reveal hidden visuals). If needed later, the clean extension is a `visual_acl` map inside `definition_json` that hides a visual for `VIEW` holders but never relaxes row scope.

### 5.4 Location scope on the builder

* `scope_type GLOBAL` — visible to everyone with `View Analytics Dashboard`; only Admin (or a user with `Edit Global Asset`-like trust — not needed in phase 1) can create GLOBAL analytics dashboards. Simplest: GLOBAL creation gated by `Create Analytics Definition` *and* (`is_admin_user` OR holds `View Dashboard` at GLOBAL level — reuse the `dashboard` guard). Non-Admin GLOBAL dashboard creation is blocked with `403` until the owner explicitly asks for it — matches current Dashboard behaviour where GLOBAL creation is admin-only in practice.
* `scope_type LOCATION` — `location_code` must be inside the creator’s `get_user_location_codes`. Editing a LOCATION dashboard requires the dashboard’s location stays inside the editor’s scope (or Admin).

### 5.5 Endpoint-level permission gating (proposed)

Every route calls `require_user_permission(current_user, "<name>", db)` first, then the object-level grant check — same two-layer pattern as `report_builder`.

| Endpoint | Minimal permission | Location note |
|----------|-------------------|---------------|
| `GET /analytics/catalog` | `View Analytics Definition` (builder) or `View Analytics Dashboard` (viewer calls a lighter endpoint) | Returns the full catalog; sensitive columns already stripped by `report_catalog` |
| `POST /analytics/formula/validate` | `View Analytics Definition` | Reuses `report_formula.validate_formula` |
| `CRUD /analytics/dashboards` | `View/Create/Edit/Delete Analytics Definition` resp. | LOCATION scope enforced |
| `POST /publish /revert /duplicate` | `Publish Analytics Definition` | OWNER check |
| `GET /my-dashboards /my-dashboards/{id}/run-batch` | `View Analytics Dashboard` | Grant + publishing + scope |
| `GET/POST /analytics/data-sources` | `View/Create/Edit/Delete Analytics Data Source` | Admin-ish |

---

## 6. Data layer — catalog, conditions, calculations, comparisons

### 6.1 Direct DB measure — catalog reuse

Every visual’s **data columns** are a subset of what `report_catalog` already catalogues:

* Base choice: `source.kind ∈ {operation_tickets, tank_stock_ledger, table}` (table = any reportable table name). Featured datasets keep their virtual fields and `supports_template_fields`/`supports_payload_json` flags. “Any other saved table” also exposes `related_column` (declared single-column FK to unique parent, single hop, many-to-one, never reverse) — same `reportable_relationships` gate.
* For each column: `source ∈ {column, virtual, ticket_field, payload_path, json_path, related_column}` with the same validators as `_validate_source_spec`, `_validate_path`, `FIELD_CODE_RE`, `PATH_SEGMENT_RE`. JSON path features (`a.b.c`, `a[].b`, `@key`) and `explode_keep_empty_rows` carry over.
* Addition for Analytics: **aggregated measures** are first-class. A visual field can be `aggregate: SUM|AVG|COUNT|MIN|MAX|PRODUCT|FIRST|LAST` (same `AGGREGATES`) combined with an optional `bucket: VALUE|DAY|WEEK|MONTH|QUARTER|YEAR` (`BUCKETS`) on the group-by dimension. The builder exposes the same selectors as `ReportBuilder.jsx` rows step.

**Why not invent a new catalog?** Rebuilding a second SQL allow-list would drift. Analytics imports `report_catalog.build_catalog / allowed_columns / get_table_catalog / table_group / TICKET_VIRTUAL_FIELDS / LEDGER_VIRTUAL_FIELDS / discover_json_paths / discover_operation_fields` directly. Sensitive-column filtering and relationship checks are therefore identical and audited once.

### 6.2 Calculated measure — formula reuse (no fork)

A column with `kind: calculated` carries `formula: string` (optionally starting with `=`), `data_type`, `format {decimals,prefix,suffix}` and may reference any other column by **report key** (`[my_key]`). The builder’s `FormulaBuilder` (click / IF / IFS / text) is imported unchanged and shown when editing a calculated visual field.

Server side, Analytics reuses `report_formula.parse_formula`, `referenced_columns`, `validate_formula`, `evaluate` exactly as `report_engine._apply_calculations` does: columns are topologically sorted by references, evaluated per row with `Decimal`, per-cell `FormulaError/DIV0` blanks with warnings (never fail the visual). `report_formula.FUNCTION_HELP` and `OPERATOR_HELP` are the tooltip source in the builder.

**Analytics-only extension (phase 2, backward compatible):** window/time helpers compiled to post-aggregation passes:

```text
PREVIOUS([net_qty], -1)        -- previous bucket value
YOY([closing_stock])            -- same period last year
MTD([closing_stock])            -- month-to-date running
RANK([variance_pct])            -- rank within current slice
```

Phase 1 ships *without* these; the schema reserves `formula_extensions: { window: … }` so they are additive.

### 6.3 Comparison / conditional measure — same `value_conditions`

Each **data column** may carry:

```json
{
  "value_conditions": [
    {"source":{"type":"column","column":"status"}, "operator":"eq", "value":"Approved"},
    {"source":{"type":"column","column":"origin_location_code"}, "operator":"eq", "value":"ONSHORE-A"}
  ],
  "value_condition_logic":"AND"
}
```

Up to 20 per column, 100 per visual definition. At execution the engine materialises a hidden column per rule (`__cv_<key>_<i>`) and blanks the measure when the rule fails — the source row is **not** dropped (so totals stay correct). The UI is the existing `ComparisonConditionsEditor.jsx`. Example that the owner flagged as important: two conditional measures on the same quantity source, each gated to a different location/operation type — exactly what `test_report_builder` covers and exactly what Analytics needs for “actual vs plan” or “A vs B”.

Comparison kinds in phase 1:

* **Conditional measure** (row-level) — the above.
* **Visual-level comparison** — duplicate a measure with different `value_conditions`, then add a calculated `Variance = [actual] - [plan]` and `Variance % = PCT([variance],[plan])` (or `[variance] % [plan]`).
* **Total-relative** — `is_total_relative: true` on a doughnut/pie visual field to show % of visual total (computed post-aggregation, presentation only).

### 6.4 Filtering — three levels, merged before run

```
slicerFilters   (dashboard slicers — bound to slicer visuals)
      ↓
pageFilters     (per-page — phase 2)
      ↓
visualFilters   (per-visual fixed filters — entered in the builder)
      ↓
merged into report_engine `filters[]` with `filter_logic AND|OR`
      + `runtime_filters[]` bound to slicer state + date range
```

`FILTER_OPERATORS` are the 15 from the engine (`eq|ne|gt|gte|lt|lte|contains|not_contains|starts_with|ends_with|in|not_in|between|is_blank|is_not_blank`). Text operators work on `text` columns; numeric on `number`; `between` carries `value2`. Date operators work on `date|datetime|time`.

Each visual definition carries its own `filters[]`, `filter_logic`, plus optional `date_basis`/`date_column` at visual or dashboard level. The **dashboard date range** is applied as `run_params.date_from / date_to` (ISO) using the same `date_basis` as reports — `CustomReportViewer` already does this; Analytics repeats it per visual (or shared per batch).

### 6.5 Formatting — column & visual level

Reuses `utils/reportBuilder.formatCellValue` and `frontend/src/utils/format.js` (`formatNumber`, `formatCalendarDate`, `formatDateTime`). Each column may specify:

```js
format: {
  data_type: 'number|text|date|datetime|time|boolean',
  decimals: 0..6,        // numbers only
  prefix: '$', suffix: ' BBL',
  number_format: 'number|percent|bytes|duration' // phase 2
}
```

Visual-level formatting entries add the Power BI touches without inventing a second system:

* **Conditional formatting rules** — `{ field, operator, value, style: { color, background, icon, dataBar } }` evaluated per cell in `ReportDataTable` / chart tooltip / KPI card. Phase 1: colour + icon; phase 2: data bars / colour scales.
* **KPI thresholds** — `{ good: 95, warning: 80, bad: 60, invert: false }` mapping value relative to target to `success|warning|danger` (used for card border/dot + chart point colour).
* **Totals & subtotals** — `options.show_totals`, `show_row_totals`, `show_column_totals` (matrix), `totals_position: top|bottom`.

---

## 7. Visual catalogue

### 7.1 Supported visuals (phase 1 — buildable today with `echarts` + table)

| Visual | `type` | How it renders | Data shape | Phase |
|--------|--------|---------------|------------|-------|
| **KPI card** | `KPI_CARD` | Big number + label + comparison delta + tiny sparkline (optional `LINE` mini chart) | One aggregated measure (with optional comparison measure). Uses `options.show_totals` semantic as `single value`. | 1 |
| **Table (tabular)** | `TABLE` | `ReportDataTable` — paginated, sortable, exportable, inline sparklines optional | `TABULAR` run → `columns[]` + `rows[]` + `totals{}` | 1 |
| **Matrix / Pivot** | `MATRIX` | `ReportDataTable` matrix branch (pivot) — rows × columns × value | `MATRIX` run → `matrix{row_keys,column_key,column_bucket,value_key,aggregate}` | 1 |
| **Bar (horizontal)** | `BAR` | `echarts` `bar` (horizontal) — clustered, stacked, 100% variants | `group_by[]` dims + 1–4 measures; `series` per measure or per `column_key` | 1 |
| **Column (vertical)** | `COLUMN` | `echarts` `bar` (vertical) — same variants as BAR | same | 1 |
| **Line / Graph** | `LINE` | `echarts` `line` — smooth toggle, showSymbol toggle, area fill toggle | time dimension (`DAY|WEEK|MONTH|QUARTER|YEAR`) required for time series, or categorical | 1 |
| **Area** | `AREA` | `line` with `areaStyle` | same as LINE | 1 |
| **Pie** | `PIE` | `echarts` `pie` — label/legend placement | 1 dimension + 1 measure | 1 |
| **Donut** | `DONUT` | `pie` with `radius: ['45%','70%']` | same as PIE | 1 |
| **Combo (bar+line)** | `COMBO` | Two `yAxis` — bar + line, measures assigned per axis | 1–2 dims + 2–4 measures with `series[].yAxisIndex` | 1 |
| **Gauge** | `GAUGE` | `echarts` `gauge` (semicircle) — KPI value vs min/max/target | 1 measure + optional target | 1 |
| **Slicer** | `SLICER` | List / dropdown / chips / date pickers (HTML controls, not `echarts`) | Bound to a column’s distinct values (server `distinct` helper or `lookups` endpoint) | 1 |
| **Text / Image** | `TEXT` | Rich text card (no data binding) | none | 1 |
| **Tank visual** | `TANK_VISUAL` | Existing `TankVisualWidget` (kept as-is, reused for backward compat) | `TANK_STOCK_SNAPSHOT` handler | 1 (carry-over) |

**Phase 2 additions (no schema break):** `SCATTER` (x vs y + size), `WATERFALL` (running total), `FUNNEL` (staged drop-off), `TREEMAP` (hierarchical), `HEATMAP` (matrix-coloured), `KPI_TREND` (KPI + embedded line). Add by extending the `type` union and adding one `echarts` option builder — no migration.

### 7.2 Visual configuration object (shared)

```ts
type VisualConfig = {
  // Data binding — mirrors report definition columns but scoped per visual
  query: {
    source: { kind: 'operation_tickets'|'tank_stock_ledger'|'table', table?: string,
              operation_type_codes?: string[], template_ids?: number[], statuses?: string[] },
    date_basis: 'PAYLOAD_OPERATION_DATE'|'ACCOUNTING_DATE'|'OPERATION_DATE'|'CREATED_AT'|'COLUMN'|'NONE',
    date_column?: string,
    columns: VisualColumn[],     // data + calculated, each with key/label/kind/source/formula/aggregate/format…
    filters: Filter[],           // per-visual fixed filters
    filter_logic: 'AND'|'OR',
    group_by: { key: string, bucket?: Bucket }[],  // empty = single aggregate (KPI)
    matrix?: MatrixSpec,         // only when type is MATRIX
    sort: { key: string, dir: 'asc'|'desc' }[],
    options: { show_totals: boolean, page_size: number, empty_text: string, explode_keep_empty_rows?: boolean }
  },

  // Visual presentation
  display: {
    title: string, subtitle?: string,
    showTitle: boolean, showLegend: boolean, legendPosition: 'top'|'right'|'bottom',
    colorScheme: 'navy'|'categorical'|'sequential', // maps to CSS tokens + echarts palette
    xAxis?: AxisSpec, yAxis?: AxisSpec, y2Axis?: AxisSpec, // COMBO
    stack?: 'none'|'stack'|'percent',
    dataLabels?: { show: boolean, position: 'inside'|'outside'|'center', decimals: number },
    conditionalFormatting?: CondFormatRule[],
    thresholds?: { low: number, high: number, invert?: boolean },
    unit?: string,               // KPI / gauge unit text
    columns?: TabularColumnSpec[] // TABLE column widths / pinning / header overrides
  },

  // Interactions (per-visual opt-in)
  interactions: {
    crossFilter: boolean,        // clicking this visual filters others
    crossHighlight: boolean,
    drillThrough?: DrillThroughSpec
  }
}
```

### 7.3 Chart option building

One function per chart type in `frontend/src/components/analytics/ChartOptions.js`, returning an `echarts` `option`:

* Uses `var(--primary)` / `var(--text-secondary)` / `var(--border)` so light/dark themes are free (same tokens as the rest of the app).
* Single palette array derived from the navy enterprise theme (no random colours): `[#0f2a44, #1d4ed8, #0e7490, #a16207, #7c3aed, #065f46, #b45309, #991b1b]` stored in `frontend/src/styles/tokens.css` and reused by `reportBuilder` formatting.
* `tooltip: { trigger: 'axis' }` for cartesian, `trigger: 'item'` for pie/gauge, formatter calls `formatCellValue(column, value)` so number/date formatting is consistent with the table.
* `grid: { left: 50, right: 16, top: 22, bottom: 46 }` (consistent with `DashboardBuilder.renderEChartPreview` today). Axes rotate long labels `30°`.

---

## 8. Slicers, filters & time controls

### 8.1 Slicer types (each slicer is a visual)

| Slicer | Visual `type: 'SLICER'` `slicerKind` | Selection | Backing |
|--------|--------------------------------------|-----------|---------|
| **Dropdown** | `DROPDOWN` | single | distinct values via `GET /analytics/column-distinct?table=&column=` (server `distinct` with scope) + `GET /report-builder/lookups` for location/status/asset |
| **Multi-select list** | `MULTI_SELECT` | multi + search | same |
| **Chips / button bar** | `CHIPS` | multi or single | same |
| **Slider (numeric)** | `SLIDER` | between | column min/max |
| **Hierarchy slicer** | `HIERARCHY` | drillable list (Location → Asset, Entity → Block → Field) | server hierarchy endpoints (reuse `GET /locations`, `GET /book-stock/fields`) |
| **Date picker** | `DATE` | single date `YYYY-MM-DD` | no backing |
| **Date range** | `DATE_RANGE` | `{from,to}` ISO | no backing — two `<input type=date>` as mandated by rule 5 |

**Rule 5 compliance (first-class):** single-date and date-range are never the same control. The builder’s filter pane shows a **Date** card and a separate **Date range** card, exactly like `DataFilterBar.jsx` does for lists. The JSON reflects this as two runtime types (`date` vs dedicated `date_range` visual kind `DATE_RANGE`).

### 8.2 Filter levels and precedence

```
Dashboard definition
 ├─ dashboardFilters (slicers): { location_codes[], statuses[], … , date_from, date_to, custom: {key: value} }
 ├─ pages[0].pageFilters: Filter[]           // phase 1: one page, so this is the dashboard filter bar
 └─ visuals[].query.filters + query.group_by + query.options

Run sequence (per visual):
  1. Take visual.query.filters
  2. Append dashboardFilters translated via binding map (which slicer feeds which column)
  3. Append pageFilters
  4. Append visualInteractions cross-filters (selections from other visuals)
  5. Validate against catalog (same as report_engine)
  6. Apply runner scope (_requested_locations party check)
```

A **binding map** at dashboard level declares the slicer↔column wiring explicitly (Power BI’s “which slicer affects which visual”, but simplified to one default: every slicer affects every visual that exposes the same column key, with an override per visual):

```json
{
  "bindings": [
    {"slicerId":"s1","columnKey":"origin_location_code","mode":"filter","operator":"in"},
    {"slicerId":"s_date","dateBasis":"ACCOUNTING_DATE","mode":"date_range"}
  ],
  "visualOverrides": {
    "w_kpi_1": {"ignoreSlicers":["s2"]}
  }
}
```

Builder UI shows the bindings as a small “Affected visuals — All / Selected” toggle per slicer (Power BI user tester language, no jargon).

### 8.3 Time controls in detail

* **Dashboard time slicer** (`DATE_RANGE`) is the primary period for all time-aware visuals. Its `date_basis` is chosen once at dashboard level (default `ACCOUNTING_DATE`). Each visual may override to a column date.
* **Period granularity slicer** (`BUCKET`) — an optional `SLICER` with `slicerKind: BUCKET` values `DAY|WEEK|MONTH|QUARTER|YEAR` that controls `group_by[].bucket` for line/area/column visuals. Changing granularity re-runs only visuals that declare `affectedByBucket: true`.
* **Relative period quick picks:** Today, Yesterday, This week, This month, Last 30 days, This quarter, This year, All time — rendered as chips above the date-range picker, writing `date_from/date_to` via `dateRangeDefaults()`.

---

## 9. Interactions — cross-filter, drill-through, tooltip

### 9.1 Cross-filter / cross-highlight

* Clicking a bar/point/pie slice/row sets a **selection** `{ visualId, columnKey, value, bucket? }`. The viewer’s `selectionState: Selection[]` is pure React state (and mirrored in the URL `?sel=base64json` so reload keeps it).
* Other visuals whose `interactions.crossFilter === true` apply an ephemeral `eq` filter on that `columnKey` and re-run (batch endpoint). `crossHighlight` dims non-selected series instead of filtering (charts highlight via `echarts` `dispatchAction({ type: 'highlight' })`; tables highlight via row className).
* Header shows a **filter bar chip** per active selection with × to clear. “Clear all” resets `selectionState`.

### 9.2 Drill-through

Two drill-through modes, both opt-in per visual in the builder’s **Interactions** tab:

| Mode | What happens | Who can use it | How it’s configured |
|------|--------------|----------------|-------------------|
| **Detail page** | Opens `OperationTransactionDetail` (`/operation-transactions/:id`) or `TankStockLedger` / Book Stock ledger row, or the ticket’s payload detail, in a new tab or `Modal` | `View Operation Transaction` etc. (checked in the drill endpoint) | `drillThrough: { target: 'TRANSACTION_DETAIL', keyColumn: 'operation_transaction_id' }` |
| **Analytics filter** | Opens the same (or a different) analytics dashboard with the clicked dimension pre-filtered (e.g., click a bar for “Location A” → filtered dashboard showing only `origin_location_code = A`) | Dashboard `VIEW` on the target dashboard | `drillThrough: { target: 'ANALYTICS_DASHBOARD', dashboardId: 12, bindings: [{fromKey:"origin_location_code",toParam:"slice_location"}] }` |
| **Custom Report** | Opens a `CustomReportViewer` (`/reporting/custom-reports/:id`) with `runtime_filters` pre-set | `View Custom Report` + report grant | `drillThrough: { target: 'CUSTOM_REPORT', reportId: 7 }` |

The click handler in each visual renderer (`onChartClick` / `onTableRowClick`) does:

1. `logUiAction('Analytics drill-through', 'Drill')` (audit).
2. If single-target and the viewer holds the required permission, navigate directly.
3. If multiple targets or the viewer must choose, show `Modal` “Where would you like to go?” listing only the allowed targets (permission filtered).
4. Always enforce runner scope on the *target* dataset as well (a drill can’t evade location scope).

### 9.3 Tooltip & “See records”

* Chart tooltip uses `echarts` `tooltip.formatter` calling `formatCellValue` per series (so number/date formatting is consistent). Shows `value`, `comparison`, `variance` when those measures exist.
* **See records** — every visual’s header `⋯` menu has “Show underlying records”. It runs the same visual query with `group_by: []` + `page_size: 50` (first page) and renders a `ReportDataTable`-style modal with paging, search and Export. This satisfies the auditability requirement that aggregated cards are traceable to rows.

---

## 10. Formatting & conditional formatting

Reuses the column `format` contract (§6.5) everywhere. On top of that:

* **Number/date/boolean formatting** is centralised in `formatCellValue(value, column, emptyText)` and `format.js` helpers — no per-visual fork.
* **Visual conditional formatting** (phase 1 colour + icon):
  ```js
  { columnKey: 'variance_pct', operator: 'lt', value: 0,
    then: { color: '#991b1b', background: '#fef2f2', icon: 'trendDown' } },
  { columnKey: 'variance_pct', operator: 'gte', value: 0,
    then: { color: '#065f46', background: '#ecfdf5', icon: 'trendUp' } }
  ```
  Rendered as pill/badge on KPI cards, cell background on tables, point colour on charts (`visualMap` or per-point `itemStyle`).

* **Data bars** (phase 2): per-column `dataBar: { show: true, max: 'auto'|number, color: 'var(--primary)' }` rendered inside `ReportDataTable` cells as a width-controlled inner div.

* **Sorting:** per-visual `sort[]` with `key + dir`. Table headers are sortable (click header toggles direction), same `buckets` + `collation` note as reports.

* **Totals:** `TABLE`/`MATRIX` show a `TOTAL` row (`show_totals`) with per-column `show_total` flag; aggregated visuals show the same totals object in `rows[0]` meta for KPI binding.

---

## 11. Builder UX — Power BI parity

### 11.1 Page layout (1440 px +, responsive down to 1024)

```
┌─ TopNavigation (Analytics dropdown, as §4.1) ─────────────────────────────────┐
│  Actions: Back to gallery │ Preview │ Save draft │ Publish │ Revert │ Duplicate │
├─ Left: Data & Visuals ─┬─ Centre: Canvas (12-col grid) ─┬─ Right: Properties ─┤
│  Datasets (catalog)     │  Slicers bar (sticky, chips / │  Selected visual    │
│  ── tables grouped by  │  date range, bound slicers)   │  tabs: Data ·       │
│  Operation Tickets      │  ┌─────────────────────┐      │  Format ·           │
│  Tank Stock Ledger      │  │ KPI  │ LINE chart   │      │  Filters ·          │
│  Any table › columns,   │  ├─────────────────────┤      │  Interactions ·     │
│  virtuals, ticket fields│  │ TABLE │ PIE         │      │  General             │
│  ── Search columns     │  └─────────────────────┘      │                     │
│  Fields pane (drag      │  Grid controls: add KPI/     │  Page/dashboard      │
│  to Data) + calculated  │  TABLE/MATRIX/CHART/PIE/     │  settings when no     │
│  Visuals palette        │  KPI/TEXT/SLICER             │  visual selected     │
│  (KPI/TABLE/MATRIX/    │  Resize handles · snap ·      │                     │
├─────────────────────────┴──────────────────────────────┴─────────────────────┤
│  Filters pane (bottom or collapsible): pageFilters + runner scope note       │
└──────────────────────────────────────────────────────────────────────────────┘
```

* Left palette is a narrower clone of `ReportBuilder` step 2’s column list: searchable, grouped by `group` (e.g., “Dates (from ticket answers)”, “Tank Ledger”, “Book Data — Book Stock”). Dragging a column onto a visual’s Data pane creates a `VisualColumn` (data kind). “Add calculated” opens `FormulaBuilder` (imported directly).
* Centre canvas is `ResponsiveGridLayout` (12 cols, `rowHeight: 32`, `margin: [12,12]`, `isResizable: true`, `isDraggable: true`, `compactType: 'vertical'`). Widgets are not `Modal`s.
* Right pane is isomorphic to `ReportBuilder` step 2’s column detail drawer: for the selected visual it shows bound fields (each with pill for columnOriginLabel + aggregate/bucket selectors + format), `Filters` list (with `FILTER_OPERATORS` dropdown and `value_condition_logic` toggle), `Format` controls, and `Interactions` toggles with drill-through target picker.

### 11.2 Workflow (modelled on ReportBuilder’s 6 steps but condensed)

```
1 · Dashboard & Data  → name, scope_type, location_code, date_basis, dataset(s) hint
2 · Visuals & Data    → add visuals, drag fields, set aggregates/buckets, add calculated (FormulaBuilder), add comparisons (ComparisonConditionsEditor)
3 · Filters & Slicers → add SLICER visuals, wire bindings, add visual/page filters
4 · Format & Interact → conditional formats, thresholds, drill-through targets
5 · Who Can Use It    → grants (USER|ROLE|LOCATION) — same component pattern as ReportBuilder step 5
6 · Preview & Publish → full-width preview (with live slicers), save draft, publish, version note
```

Step headers reuse the `STEPS` pill bar from `ReportBuilder`. Phase 1 may ship as a single long form with collapsible sections rather than strict steps — either is acceptable as long as the *logic* matches the Report Builder’s validation order.

### 11.3 Builder validation & save flow

* On `saveDraft` / `publish`, the frontend runs the same frontend guard as `ReportBuilder.switchDataset`: clearing columns warns, unknown column aborts.
* The POST sends `{ definition }` (the full JSON §20). The server runs `validate_analytics_definition(db, current_user, definition)` — catalog check, formula validation (calls `report_formula.validate_formula` per calculated column), `MAX_COLUMNS 60`, `MAX_VALUE_CONDITIONS`, cycle check — returns `{ valid, errors[] }`. On error the builder shows an `AlertMessage` next to the offending section (rule 8), never a bare toast alone.
* On success the builder version is bumped (`dashboard_versions.version_number +1`, `config_json = definition`, `change_note` optional) and `dashboard_configs.active_version_id` points to the new version only after `publish`. Draft saves do not change `active_version_id` (so a bad draft never takes down the viewer) — matches current `dashboard` publish/revert pattern.

---

## 12. Viewer, gallery, and placement

### 12.1 Gallery (`/analytics`)

* Cards grid (like `BookStockDashboard` / `Home` tiles): each card shows dashboard name, scope badge (`GLOBAL` / location display name), status (`Draft|Published|Archived`), owner, updated date, grants summary (“Shared with: Sales, Onshore-A”), and a mini preview thumbnail (first 3 visual names). Controls:
  * **Open** → `GET /analytics/dashboards/:id` → render viewer (§12.2). Permission: `VIEW|EDIT|OWNER` or Admin.
  * **Edit in Builder** — visible only when `hasPermission('Edit Analytics Definition')` and caller has EDIT|OWNER on that dashboard.
  * **Duplicate** — `POST /duplicate` (requires `Create Analytics Definition`), clones `definition_json` with copied `grants` limited to caller’s scope.
  * **Delete** — `ConfirmDialog`, requires `Delete Analytics Definition` and OWNER.

* Filters: quick search, scope filter (All / Global / My locations), status filter, pagination `20|50|100` (`PaginationControls`). Date & date-range filters are NOT needed here — the gallery filters by metadata, not data.

* “New dashboard” CTA card (when `hasPermission('Create Analytics Definition')`) opens `/analytics/builder/new`.

### 12.2 Viewer (`/analytics/view/:id`)

* Structure analogous to `CustomReportViewer`:
  * Header: `PageHeader` (title = dashboard name, subtitle = scope + owner + version + last published date).
  * **Slicer bar** (sticky below header, `no-print` class): renders every visual with `type === 'SLICER'` in order, plus the dashboard `DATE_RANGE` slicer. Slicers show counts (`12 selected`, `1 Jan–31 Jan`). “Clear slicers” and “Reset to defaults” buttons.
  * **Canvas:** the same `ResponsiveGridLayout` but `isDraggable: false, isResizable: false, static: true` so the viewer respects the designer’s layout exactly. Each visual tile has a title bar with `⋯` menu (See records, Export visual data, Pin, About visual).
  * **About drawer:** per-visual provenance — dataset, columns (labels not keys), calculated formulas in words (`formulaInWords`), comparison rules (`comparisonRuleText`), filters applied, date basis, runner scope, and backend `meta.warnings` (caps, blank handling). Same pattern as `CustomReportViewer`’s “About this report”.
  * **Toolbar (no-print):** `ExportMenu` (client xlsx/csv/pdf of the visible page or a visual), **Excel / CSV (all rows — server)** per visual (calls `POST /my-dashboards/:id/export` with the visual’s bound run), **Print** (via `PrintProfileProvider` → picks a `CompanyReportProfile` then `window.print` with `@media print` CSS hiding the slicer bar controls).
  * **Live behaviour:** all slicer changes, selection clicks, and drill-throughs call the **batch run** endpoint (§21). The viewer shows per-visual spinners (`AlertMessage tone neutral` beside the visual) and surfaces `warnings[]` beneath the canvas just like `CustomReportViewer` does.

### 12.3 Placements — “put it wherever he wants”

Without copying data, a dashboard can appear as a **placement** — a link/shortcut that respects the same grants and scope:

1. **Top nav link** — auto-appended under `Analytics` for every published dashboard shared with the user (same code path as published Custom Reports today). Cost: zero — `TopNavigation` already fetches `GET /my-reports`; new code fetches `GET /analytics/my-dashboards` alongside it.
2. **Home tile** — `Home.jsx` gains an Analytics section that lists “My dashboards” when `hasPermission('View Analytics Dashboard')`; each tile deep-links to `/analytics/view/:id`.
3. **Report Builder link** — a published dashboard can be referenced from a report’s About drawer (“Related dashboard: …”).
4. **Embed** — `/analytics/embed/:id` (minimal TopNavigation, no Gallery chrome) for iframe or external portal, still permission & scope checked server-side. CSP: no `frame-ancestors` loosening beyond the existing `http_hardening` config; same-origin embed only unless owner asks for `allow-from`.

No mutable “copy” placements exist — de-duplication and audit remain trivial.

---

## 13. Backend design

### 13.1 Choice of model — extend or new tables

**Recommendation: new `analytics_*` tables, keep `dashboard_*` read-compatible.**

Reasons:
* Existing `dashboard_configs` are scarce and already used for the FSO/OTR dashboards. Renaming or broadening them now would require a risky data migration and confuse audit history.
* Analytics needs per-dashboard **grants** (like reports), **pages** later, and a richer `definition_json` that would not fit cleanly into the current `dashboard_versions.config_json` without a major coupling.

So:

* Leave `dashboard_configs / dashboard_versions / dashboard_data_sources` untouched and readable under the same router (so the FSO/OTR dashboards keep working).
* Add `analytics_*` tables that own the new product surface. A later migration may alias `dashboard_configs` reads to `analytics_definitions` for the FSO handlers if the owner wants a single list — not required for phase 1.

**Alternative kept open (low cost):** if the owner prefers a single dashboard list, the Analytics builder can write into `dashboard_configs` with `config_json.schema_version = 2`. The plan below notes where a second write target would plug in — the API contract is the same either way.

### 13.2 Tables (proposed, append to `backend/app/models.py`)

```python
class AnalyticsDashboardDefinition(Base):
    __tablename__ = "analytics_dashboard_definitions"
    id = Column(Integer, primary_key=True, index=True)
    dashboard_code = Column(String(120), nullable=False, unique=True, index=True)  # slug
    dashboard_name = Column(String(200), nullable=False, index=True)
    description = Column(Text, nullable=True)

    scope_type = Column(String(20), nullable=False, index=True)   # GLOBAL | LOCATION
    location_code = Column(String(50), nullable=True, index=True) # nullable iff GLOBAL

    definition_json = Column(JSONB, nullable=False, default=dict)  # schema_version 2

    # PRIVATE = grants only; INTERNAL = any View Analytics Dashboard holder can run published
    visibility = Column(String(20), nullable=False, default="PRIVATE")
    is_published = Column(String(10), nullable=False, default="No", index=True)
    status = Column(String(20), nullable=False, default="Active", index=True)  # Active|Archived
    version = Column(Integer, nullable=False, default=1)

    # Dashboard-level slicers’ defaults live inside definition_json, not here.
    owner_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    created_by = Column(String(150), nullable=True)
    updated_by = Column(String(150), nullable=True)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("dashboard_name", "scope_type", "location_code",
                         name="unique_analytics_dashboard_scope"),
    )

class AnalyticsDashboardGrant(Base):
    __tablename__ = "analytics_dashboard_grants"
    id = Column(Integer, primary_key=True, index=True)
    dashboard_id = Column(Integer,
        ForeignKey("analytics_dashboard_definitions.id", ondelete="CASCADE"),
        nullable=False, index=True)
    grant_type = Column(String(20), nullable=False, index=True)  # USER|ROLE|LOCATION
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    role_id = Column(Integer, ForeignKey("roles.id", ondelete="CASCADE"), nullable=True, index=True)
    location_code = Column(String(50), nullable=True, index=True)
    access_level = Column(String(10), nullable=False, default="VIEW")  # VIEW|EDIT
    created_by = Column(String(150), nullable=True)
    created_at = Column(DateTime, nullable=False, server_default=func.now())

class AnalyticsDashboardVersion(Base):
    __tablename__ = "analytics_dashboard_versions"
    id = Column(Integer, primary_key=True, index=True)
    dashboard_id = Column(Integer,
        ForeignKey("analytics_dashboard_definitions.id", ondelete="CASCADE"),
        nullable=False, index=True)
    version_number = Column(Integer, nullable=False)
    definition_json = Column(JSONB, nullable=False, default=dict)
    change_note = Column(Text, nullable=True)
    created_by = Column(String(150), nullable=True)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    __table_args__ = (
        UniqueConstraint("dashboard_id", "version_number",
                         name="unique_analytics_dashboard_version"),
    )

# Opt-in: reuse report's report-location tables or add:
# analytics_dashboard_data_source — not needed Phase 1 because visuals
# can already bind to ANY catalogued column. Curated handlers reuse
# the existing dashboard_data_sources table (TANK_STOCK_SNAPSHOT etc.)
# so no second data-source table is created in Phase 1.
```

All three are created idempotently at startup (same `Base.metadata.create_all` / `db_migrations.ensure_*` pattern as `report_definitions` + `user_report_locations`).

### 13.3 Services (new files, thin wrappers)

```
backend/app/services/
  report_catalog.py   ← reused as-is (no change)
  report_formula.py   ← reused as-is (no change)
  report_engine.py    ← reused as-is (no change, except maybe export helper)
  analytics_catalog.py  (NEW — maybe 80 lines)
      — helpers that specialise report_catalog for Analytics:
        build_analytics_catalog() = build_catalog() + handler list
        handler_metadata() mirrors dashboard VALID_HANDLER_KEYS
        visual_type_defs() — title, icon, allowed aggs per visual

  analytics_engine.py   (NEW — ~350 lines, orchestrator)
      — validate_analytics_definition(db, user, definition)   → reuses report_engine.validate_definition per visual
      — plan_analytics_visual(visual)                         → builds per-visual plan (same normalised form as report plan)
      — run_analytics_visual(db, user, visualDef, params)     → delegates to
            • report_engine.run_report() when visual.query != handler
            • dashboard.dashboard_data_gateway handler when handler_key present
        Runner scope is always checked inside run_report (which calls _requested_locations + party check).
      — run_analytics_dashboard_batch(db, user, dashboard, slicerState, selections)
            loops visuals, runs those affected by changed slicer, collects rows/meta/warnings
            enforces TIME_BUDGET_SECONDS per visual, returns aggregated meta
```

Key property: **`analytics_engine` does not reimplement SQL**. Curated heavy joins (FSO/OTR/Book Stock) stay in `routers/reports.py` + `routers/dashboard.py` handlers. Generic visuals go through `report_engine` which already handles JSON discovery, Decimal formulas, value_conditions, grouping, matrix.

### 13.4 Routers (new file, mirrors `report_builder.py` shape)

`backend/app/routers/analytics.py` (prefix `/analytics`, tag `Analytics`), following the access helpers ` _grants_of / _my_access / _require_builder_access / _require_run_access` from `report_builder.py`:

```
GET  /analytics/catalog               → build_analytics_catalog() (datasets+tables+handlers+visual types)
GET  /analytics/column-distinct       → distinct values for a column (scoped, capped, for slicer population)
POST /analytics/formula/validate      → {text, known_columns} → report_formula.validate_formula
GET  /analytics/lookups               → reuse report_builder lookups + dashboard lookups (locations/assets/…)
CRUD /analytics/dashboards            → list/create/get/update/delete
POST /analytics/dashboards/{id}/duplicate|publish|revert
GET  /analytics/dashboards/{id}/versions
POST /analytics/run-preview           → run unsaved definition (builder preview, one visual at a time)
GET  /analytics/my-dashboards         → published dashboards accessible to me
POST /analytics/my-dashboards/{id}/run-batch     → run all visuals with slicer/selection state
POST /analytics/my-dashboards/{id}/visual/{visualId}/export → XLSX/CSV for one visual’s full rows
GET  /analytics/my-dashboards/{id}/visual/{visualId}/records → drill “see records” paginated
```

All Dashboards routes keep their existing `prefix="/dashboard"` unchanged. New routes never shadow them. `backend/app/main.py` adds `app.include_router(analytics.router)` right after `report_builder` and `dashboard`.

### 13.5 Validation outline (`analytics_engine.validate_analytics_definition`)

Reuses `report_engine` primitives per visual:

1. Check `schema_version == 2`, `status ∈ {Active,Archived}`, `scope_type`.
2. For each `visual`:
   * `type` in `VISUAL_TYPES`.
   * If `query.handler_key` present → assert `handler_key ∈ VALID_DASHBOARD_HANDLER_KEYS ∪ {ANALYTICS_QUERY}` and allowed params (kept for curated handlers).
   * Else → build a synthetic `report_engine` definition:
     ```py
     synth = {
       "schema_version": 1,
       "report_type": "MATRIX" if visual.type=="MATRIX" else "TABULAR",
       "source": visual.query.source,
       "date_basis": visual.query.date_basis,
       "date_column": visual.query.date_column,
       "columns": visual.query.columns,      # incl. calculated
       "filters": visual.query.filters,
       "filter_logic": visual.query.filter_logic,
       "runtime_filters": [...slicer-derived],
       "group_by": visual.query.group_by,
       "matrix": visual.query.matrix,
       "sort": visual.query.sort,
       "options": visual.query.options,
     }
     ```
     Call `validate_definition(synth)` (which validates table/columns/paths/formulas/value_conditions/explode/group_by/buckets/aggregates). Collect errors prefixed with `Visual "Sales by location": …`.
   * Validate `slicers[]` — each slicer’s `boundColumn` must be a column that at least one other visual exposes; date slicer’s `date_basis` must be valid.
   * Validate layout: `layout[].i` must correspond to a `visuals{ id }`, `w,h,x,y` within bounds, no duplicate ids.
3. Grants validation (mirrors `_validate_grants`): exactly one of user_id/role_id/location_code, level ∈ {VIEW,EDIT}, LOCATION only VIEW, scope check, dedup.
4. On success, return `{ valid: True, plan: … }` (plan = per-visual normalised plans for fast batch runs).

### 13.6 Execution — batch run

`POST /analytics/my-dashboards/{id}/run-batch`:

```
body: {
  slicer_state: { date_from, date_to, s1: "A", s2: ["A","B"], bucket: "MONTH" },
  selections:  [ { visualId: "w3", columnKey: "origin_location_code", value: "ON-A" } ],
  visual_ids?: string[]  # optional: only re-run these visuals (delta after one slicer change)
}

server:
  1. _require_run_access(db, user, dashboard)  # grant + published + Active + scope
  2. scope, effective_locations = _requested_locations(db, user, {location_codes: slicer_state.locations}, dashboard.definition_json)
  3. for each visual in definition.visuals (or subset):
       params = translate(slicer_state + selections + bindings)
       if visual.query.handler_key:
          result = dashboard_handler(params)   # already scope-aware
       else:
          result = report_engine.run_report(db, user, synth_definition(params), params)
       collect { visualId, columns, rows, totals, meta: {warnings, date_basis_label, ...}, page }
  4. return {
       dashboard: { id, dashboard_name, version, dashboard_code },
       slicer_state,
       results: { [visualId]: { columns, rows, totals, meta, warnings, truncated } },
       applied_scope: { scope, effective_locations },
       duration_ms
     }
```

 caps: each visual respects `SCAN_CAP / EXPLODED_CAP / EXPORT_CAP / TIME_BUDGET_SECONDS` — the response includes `meta.warnings[]` verbatim (e.g., “More than 50,000 tickets matched…”). The viewer shows these as `AlertMessage` pills.

### 13.7 Auditing (rule 1)

Every mutation endpoint calls `create_audit_log` with:

* `module_name: "Analytics"`
* `action ∈ {Create/Update/Delete/Duplicate/Publish/Revert AnalyticsDashboard, Run Batch, Export Visual, Seed}`
* `entity_type: "AnalyticsDashboard"` + `entity_id` + label = dashboard name
* `details` includes the pre/post `definition_json` summary (visual count, layout, grant labels) — never raw rows.

Read operations (`run-batch`, `records`) log at `INFO` with `remarks: "Analytics visual run"` and the `visualId`.

---

## 14. Frontend design

### 14.1 Libraries — no new dependencies

* Charts: existing `echarts` `^6.1.0` + `echarts-for-react` `^3.0.6` (single chart lib).
* Grid: existing `react-grid-layout` `^1.5.3`.
* Formatting: existing `format.js`.
* Export: existing `exceljs`/`jspdf`/`jspdf-autotable`.
* Everything else is in-repo (`Modal`, `Toast`, `PaginationControls`, `DataTableToolbar`, `ExportMenu`, `usePermissions`, `actionLogger`).

If a future visual needs `leaflet` for maps, it is deferred to phase 3 and added as an opt-in import.

### 14.2 Pages (new)

```
frontend/src/pages/
  AnalyticsHome.jsx            — gallery (cards, filters, pagination, create CTA)
  AnalyticsBuilder.jsx         — studio (1 800–2 200 lines; imports ReportBuilder pieces)
  AnalyticsViewer.jsx          — viewer (batch loader, slicer bar, grid, per-visual menu)

frontend/src/pages/analytics/
  GalleryTiles.jsx             — tile per dashboard, mini preview
  BuilderSidebar.jsx           — datasets + searchable column list + visual palette
  BuilderCanvas.jsx            — ResponsiveGridLayout wrapper
  BuilderProperties.jsx        — Data/Format/Filters/Interactions tabs for selected visual
  ViewerSlicerBar.jsx          — horizontal slicer chips
  ViewerGrid.jsx               — static grid + per-visual menu
```

Reused components **imported directly** (not copied):

* `components/reportBuilder/FormulaBuilder.jsx` + `ComparisonConditionsEditor.jsx` + `JsonColumnPicker.jsx` + `ReportDataTable.jsx`
* `components/common/Modal.jsx`, `PaginationControls.jsx`, `DataFilterBar.jsx` pattern, `ExportMenu.jsx`, `AlertMessage.jsx`, `Icon.jsx`
* `hooks/usePermissions.js`, `hooks/useDataFilters.js` pattern, `utils/reportBuilder.js` (`slugColumnKey`, `formulaInWords`, `formatCellValue`, `AGGREGATES`, `BUCKETS`, `emptyDefinition` analogues)

### 14.3 API clients (new)

```js
// frontend/src/api/analyticsApi.js
export const getAnalyticsCatalog = () => apiGet('/analytics/catalog')
export const validateAnalyticsFormula = (text, knownColumns) =>
  apiPost('/analytics/formula/validate', { formula: text, column_keys: knownColumns })
export const listAnalyticsDashboards = (params) => apiGet(`/analytics/dashboards${qs(params)}`)
export const getAnalyticsDashboard = (id) => apiGet(`/analytics/dashboards/${id}`)
export const createAnalyticsDashboard = (payload) => apiPost('/analytics/dashboards', payload)
export const updateAnalyticsDashboard = (id, payload) => apiPut(`/analytics/dashboards/${id}`, payload)
export const duplicateAnalyticsDashboard = (id) => apiPost(`/analytics/dashboards/${id}/duplicate`)
export const publishAnalyticsDashboard = (id, publish) => apiPost(`/analytics/dashboards/${id}/publish`, { is_published: publish })
export const revertAnalyticsDashboard = (id, versionId) => apiPost(`/analytics/dashboards/${id}/revert`, { version_id: versionId })
export const runAnalyticsPreview = (definition, params) => apiPost('/analytics/run-preview', { definition, params })
export const getMyAnalyticsDashboards = () => apiGet('/analytics/my-dashboards')
export const runAnalyticsBatch = (id, body) => apiPost(`/analytics/my-dashboards/${id}/run-batch`, body)
export const exportAnalyticsVisual = (id, visualId, run) => apiPost(`/analytics/my-dashboards/${id}/visual/${visualId}/export`, run)
// plus column-distinct helper for slicers
export const getAnalyticsColumnDistinct = (table, column, q) => apiGet(`/analytics/column-distinct?table=${table}&column=${column}&q=${q}`)
```

### 14.4 State (per page, no global store needed)

**Builder** (`AnalyticsBuilder.jsx`):
```js
const [dashboard, setDashboard] = useState(null) // { id, dashboard_name, scope_type, location_code, definition, grants }
const [definition, setDefinition] = useState(emptyAnalyticsDefinition())
const [selectedVisualId, setSelectedVisualId] = useState('')
const [slicerState, setSlicerState] = useState({ date_from, date_to, ... })
const [selectionState, setSelectionState] = useState([]) // cross-filter
const [previewResults, setPreviewResults] = useState({}) // { [visualId]: { rows, columns, meta } }
const [dirty, setDirty] = useState(false)
const [busy, setBusy] = useState(false)
```

**Viewer** (`AnalyticsViewer.jsx`):
```js
const [dashboard, setDashboard] = useState(null)
const [results, setResults] = useState({})    // batch results keyed by visualId
const [slicerState, setSlicerState] = useState(defaultsFromDefinition)
const [selectionState, setSelectionState] = useState([])
const [loadingVisuals, setLoadingVisuals] = useState(new Set())
const cacheRef = useRef(new Map()) // key = visualId + JSON(slicerState+selections) → result
```

Both pages use `usePermissions()` for gating and `logUiAction("Analytics …", action)` for every UI-triggered action (navigation, filter use, preview, export, print, drill).

### 14.5 Chart rendering (per visual)

One thin wrapper per type:

```js
// frontend/src/components/analytics/VisualRenderer.jsx
export default function VisualRenderer({ visual, rows, columns, slicerState, selections, onSelect, onDrill }) {
  const kind = visual.type
  if (kind === 'KPI_CARD')   return <KpiCard    visual={visual} rows={rows} columns={columns} />
  if (kind === 'TABLE')      return <AnalyticsTable visual={visual} rows={rows} columns={columns} onSelect={onSelect} onDrill={onDrill} />
  if (kind === 'MATRIX')     return <MatrixTable  visual={visual} rows={rows} columns={columns} />
  if (kind === 'SLICER')     return <SlicerControl visual={visual} state={slicerState} onChange={…} />
  if (kind === 'TEXT')       return <TextCard visual={visual} />
  // cartesian / pie / gauge all go through ChartRenderer
  return <ChartRenderer visual={visual} rows={rows} columns={columns} onSelect={onSelect} onDrill={onDrill} />
}
```

`ChartRenderer.jsx` builds the `option` (tooltip, grid, xAxis/yAxis/series, colour, legend, dataLabels, stack, smooth) and forwards `onEvents={{ click: handleClick }}` to `ReactECharts`. Clicking a bar/point calls `onSelect({ columnKey, value })` (cross-filter) and offers drill-through from the `⋯` menu.

### 14.6 Builder property panes

* **Data pane** — field list grouped by `group` (mirrors catalog), draggable to drop zone; each dropped field shows `columnOriginLabel`, `aggregate` selector, `bucket` selector, hidden/format toggles. “Add calculated” → `FormulaBuilder` modal; “Add comparison” → `ComparisonConditionsEditor` modal (both imported). Fields are draggable to reorder.
* **Format pane** — per-visual `display` controls: title/subtitle, legend, stack, colour scheme, axis labels/min/max, data labels, conditional formatting rules editor (list of `{ operator, value, style }`), thresholds for gauge/KPI.
* **Filters pane** — list of `Filter` rows (`field / operator / value (+ value2)` + `filter_logic` toggle `AND|OR`). Plus a distinct “Runtime slicers affecting this visual” read-only summary with “Ignore slicer X” overrides.
* **Interactions pane** — `crossFilter / crossHighlight` toggles, `drillThrough` target picker (Transaction detail / Another analytics dashboard / Custom Report), key-column selector.

All panes reuse the small UI vocabulary from `ReportBuilder` steps 3–4: `rb-field`, `rb-choice-row`, `rb-click-help`, `rb-operand`, etc., so the look is consistent without copying large blocks.

---

## 15. State, performance, caps & caching

* **Batch run, not N round-trips:** viewer always calls `run-batch` once per slicer/selection change, even though the JSON describes many visuals. The server fans out inside one request so auth/scope checks are once and DB connection pooling is local.
* **Delta re-run:** when one slicer changes, only visuals bound to that slicer are re-run (allowed by `bindings.visualOverrides`). Others are served from `cacheRef` in the viewer (key = `visualId|json(slicerState+selections)`). Invalidation is trivial: clearing slicers clears the cache.
* **Server caps inherited:** `SCAN_CAP`, `EXPLODED_CAP`, `EXPORT_CAP`, `MAX_MATRIX_COLUMNS 60`, `TIME_BUDGET_SECONDS 25` per visual — same `meta.warnings[]` propagated per visual. A dashboard with 6 visuals can therefore warn per visual without failing the whole dashboard.
* **Client caps:** builder preview per visual capped to `page_size ≤ 200` (sensible for canvas). Viewer tables paginate (server page `page_size 50` default, options 20/50/100); charts cap series points to `1000` with client-side truncation warning (“Showing 1000 of 2 341 points — narrow the slicers”) — enough for a bar/line without blocking the UI.
* **Request time budget:** `fetchWithTimeout` in `apiClient.js` caps visual runs to `60 s` overall; a slow dashboard surfaces per-visual “timed out, narrow the filters” warnings rather than a blank canvas.
* **Local draft:** builder persists `definition` to `localStorage` under `analytics_builder_draft_{id|scope}` every 3 s (dirty debounce) — same as `DashboardBuilder.localDraftKey`. “Restore draft” chips on re-enter.

---

## 16. Audit, export, print & bulk

* **Audit:** §13.7. Additionally, every `logUiAction` call is visible in `UserMenu → Activity` (the ring buffer from `actionLogger.js`: navigation, slicer use, drill-through, exports, prints, theme changes).
* **Export:**
  * **This page (client):** `ExportMenu` via `exceljs`/`jspdf` (xlsx/csv/pdf) for the currently rendered page rows — same as `CustomReportViewer.rb-viewer-toolbar`. Available per visual in the tile `⋯` menu.
  * **Visual full export (server):** `POST /analytics/my-dashboards/{id}/visual/{visualId}/export` streams `xlsx`/`csv` up to `EXPORT_CAP` rows, same `_xlsx_bytes`/`_csv_bytes` helpers as `ReportBuilder.my-reports/{id}/export`. Permission `Export Analytics Dashboard` (or reuse `Export Custom Report` if owner wants fewer perm names — see §22).
  * **Bulk upload:** not applicable per visual (dashboards are definitions, not data). No import dialog attached — intentional.
* **Print:** any “Print” or tile-menu → `usePrintDialog().requestPrint({ title: dashboard_name, subtitle, headerMeta })` → `PrintProfileProvider` dialog listing `GET /company-report-profiles/print-options` (global, login-only). `window.print()` only after the user picks a profile and confirms. Print CSS (`@media print`) hides the slicer bar controls, the builder left/right panes, and paginates the canvas (each visual `page-break-inside: avoid`). Same as every other report.
* **Pagination:** every paginated view (gallery, “see records”, TABLE visuals) uses `PaginationControls.jsx` with 20/50/100, global persisted size. Charts have no pagination — they aggregate.

---

## 17. Theming, responsive & accessibility

* **Theme tokens only:** every new CSS class references `var(--surface)`, `var(--text)`, `var(--text-secondary)`, `var(--primary)`, `var(--border)`, `var(--divider)` from `frontend/src/index.css` and `styles/tokens.css` (`[data-theme="dark"]` override). No hard-coded hex except the categorical palette which itself uses `var(--primary)` as primary and the navy scale.
* **Top nav:** analytics entries live under `TopNavigation.jsx` → `navigationItems.js`; builder and viewer pages wrap with `PermissionGuard` and `AppShell`.
* **Modals:** every dialog (FormulaBuilder, ComparisonConditionsEditor, drill chooser, “See records”, publish confirm) uses `Modal.jsx` which portals to `<body>`; backdrop has no click handler and Escape is ignored (rule 10). No inline panels.
* **Responsive:** builder targets 1280 px min; gallery/viewer are 12-col responsive (`ResponsiveGridLayout` breakpoints `{ lg: 1200, md: 996, sm: 768, xs: 480 }` collapsed to `Cols: { lg: 12, md: 10, sm: 6, xs: 2 }`). Slicer bar becomes a drawer below `sm`. Charts `resize` on `window.resize` via `echarts` auto-resize.
* **Accessibility:** chart `aria-label` on each visual title, table `<th scope="col">`, slicer controls labelled (`aria-label="Location slicer"`), `prefers-reduced-motion` honoured (no hover lift).

---

## 18. Phased delivery plan

| Phase | What ships | Why this order | Acceptance |
|-------|------------|----------------|------------|
| **Phase 0 — Scaffolding (1–2 days)** | Migrations (`analytics_*` tables), startup creation, empty routers/pages that compile, nav items hidden behind `View Analytics Definition` so nothing leaks | Proves DB/hosting pipeline before heavy UI | `GET /analytics/catalog` returns `{datasets,tables}`; gallery renders “No dashboards yet — Create one” |
| **Phase 1 — Core dashboards (6–8 days)** | Visuals: **KPI_CARD, TABLE, MATRIX, BAR, COLUMN, LINE, AREA, PIE, DONUT, GAUGE, TEXT, SLICER (dropdown/multi + date range), TANK_VISUAL**. Builder: sections §11 simplified to one long form, `FormulaBuilder` + `ComparisonConditionsEditor` wired, gallery + viewer + batch + slicers + date/range separate + pagination + export/page via `ExportMenu` + server visual export + print via profile + publish/version + per-dashboard grants + party/entity scoping + audit + `logUiAction` | Delivers “Power BI inside OTMS” day one; reuses the largest tested surface (`report_engine`) so risk is UI-only | Owner can build a KPI + bar + matrix dashboard gated to Onshore-A and Location B, with two conditional measures on one quantity, with slicers, and a second user sees only their location’s slices |
| **Phase 2 — Chart depth & interactivity (5–6 days)** | Additional visuals COMBO/SCATTER; period granularity slicer (BUCKET), variance & % of total measures (presentation-side), cross-filter / cross-highlight, drill-through (transaction detail + analytics filter + custom report), “See records”, conditional formatting (colour+icon), data bars, thresholds, slicer bindings override per visual, viewer URL state | Brings “like Power BI” parity past static charts | Click a bar for Location A → all bound visuals filter to A → drill to transaction detail works; URL persists after reload |
| **Phase 3 — Polish & power features (4–5 days)** | Extra visuals WATERFALL/FUNNEL/TREEMAP/HEATMAP, relative period chips, RANK/PREVIOUS window calcs (phase 2 formula extension), bookmarks/slicer-state share link, placement on Home/top nav, export entire dashboard as single XLSX workbook (one sheet per visual), mock-api support | The last 10% that users notice most | Entire dashboard exports to one workbook; Home shows “My dashboards” tiles; `dev:mock` renders analytics visuals offline |
| **Phase 4 — Hardening (3–4 days)** | `mock-api.mjs` + smoke (`test:bulk:ui` analogues), `check:print-actions` coverage for new Print surfaces, pagination/performance soak with `SCAN_CAP`/`EXPLODED_CAP` banners, RBAC matrix tests mirroring `test_report_builder` & `test_role_location_scope`, `BULK_UPLOAD_EXPORT.md` / `REPORT_BUILDER.md` doc updates | Ship like reports ship: sampled but serious | CI row: catalog safety (no sensitive columns), location scope, party rule, grants, publish gates, caps warnings, export audits — all pass by reusing report tests with an `analytics` param |
| **Total** | | **~18–24 dev-days, 4 milestones; first milestone 6–8 days → usable dashboard** | |

Phase 1 alone qualifies as “bigger update to this application” and is worth merging before phase 2; the plan supports incremental merges because migrations are additive and the feature is gated by permissions.

### 18.1 Sequencing rationale

* **Data before chrome.** Reusing `report_engine` means phase 1 needs zero risky SQL; risk concentrates in `echarts` options + `react-grid-layout` state (both reversible).
* **RBAC on day one.** Wiring grants + scope in phase 1 prevents a post-build “we shipped data leakage”.
* **Interactions after visuals.** Cross-filter is meaningless before visuals render.

### 18.2 Branching & merging note

Work stays on `arena/9ba67694-hydrocarbon-accounting-otms` per session rule; no branch rename. Each phase pushes to this branch and PRs from it. The standing rule “backend & DB are frozen” is relaxed only for the owner-approved analytics extension — noted in §13.

---

## 19. File & code map (exact paths)

### 19.1 Backend (new + edited)

```
backend/app/models.py
  ADD: AnalyticsDashboardDefinition, AnalyticsDashboardGrant, AnalyticsDashboardVersion
       (optionally AnalyticsDashboardPage for multi-page later)

backend/app/schemas.py
  ADD: AnalyticsDashboardCreate/Update/Response, AnalyticsDashboardVersionResponse,
       AnalyticsDashboardGrantIn/Response, AnalyticsBatchRunRequest/Response,
       AnalyticsVisualExportRequest, AnalyticsColumnDistinctResponse

backend/app/routers/analytics.py            NEW (analytics prefix) — mirrors report_builder shape
  helpers: _grants_of, _my_access, _require_builder_access, _require_run_access,
           _slug_code, _validate_grants, _replace_grants, _grant_labels

backend/app/services/analytics_engine.py    NEW — validation + batch orchestration
backend/app/services/analytics_catalog.py   NEW — visual-type registry + handler list
backend/app/services/report_catalog.py      REUSE (no change; analytics imports it)
backend/app/services/report_formula.py      REUSE (no change)
backend/app/services/report_engine.py       REUSE (no change)
backend/app/utils/default_permissions.py    EDIT — add Analytics category §22
backend/app/utils/db_migrations.py         EDIT — ensure_analytics_tables() idempotent
backend/app/dependencies/permissions.py     REUSE (no change; analytics imports helpers)
backend/app/main.py                         EDIT — include analytics.router

backend/tests/test_analytics.py             NEW — RBAC + grants + scope + caps (mirrors test_report_builder)
```

### 19.2 Frontend (new + edited)

```
frontend/src/pages/
  AnalyticsHome.jsx                 NEW — gallery
  AnalyticsBuilder.jsx              NEW — studio (uses reportBuilder pieces)
  AnalyticsViewer.jsx               NEW — viewer / embed

frontend/src/pages/analytics/       NEW folder — builder/viewer sub-components
  GalleryTiles.jsx
  BuilderSidebar.jsx
  BuilderCanvas.jsx
  BuilderProperties.jsx
  ViewerSlicerBar.jsx
  ViewerGrid.jsx
  VisualRenderers/
    KpiCard.jsx
    AnalyticsTable.jsx     (wraps ReportDataTable)
    MatrixTable.jsx        (wraps ReportDataTable matrix)
    ChartRenderer.jsx      (BAR/COLUMN/LINE/AREA/COMBO/PIE/DONUT/GAUGE)
    SlicerControl.jsx
    TextCard.jsx
    TankVisualWidget.jsx   (re-export of Dashboard.jsx TankVisualWidget)

frontend/src/components/analytics/
  VisualRenderer.jsx
  ChartOptions.js            — per-type echarts option factories
  SlicerBindingsEditor.jsx   — binding map UI (per slicer → affected visuals)
  DrillThroughPicker.jsx     — target selector modal
  ConditionalFormatEditor.jsx— rules list (colour/icon/dataBar)
  ThresholdEditor.jsx        — low/high/invert for KPI/gauge
  (reused directly:)
  ../reportBuilder/FormulaBuilder.jsx
  ../reportBuilder/ComparisonConditionsEditor.jsx
  ../reportBuilder/JsonColumnPicker.jsx
  ../reportBuilder/ReportDataTable.jsx

frontend/src/api/analyticsApi.js    NEW — thin fetchers §14.3
frontend/src/utils/analytics.js     NEW — emptyAnalyticsDefinition(), visual helpers,
                                     slicerState helpers, layout helpers, slug,
                                     analyticsInWords() (like formulaInWords for visuals)

frontend/src/data/navigationItems.js EDIT — Analytics top group §4.1
frontend/src/App.jsx                 EDIT — import + routes for Analytics*, hide builder
                                     behind anyOfPermissions, viewer behind View Analytics Dashboard
frontend/src/theme/                  (no change)
frontend/src/styles/
  analytics.css                      NEW — canvas grid, card, slicer bar, print overrides
  tokens.css                         EDIT — categorical palette vars

frontend/scripts/mock-api.mjs        EDIT — mock /analytics/* (catalog, previews)
frontend/scripts/
  check-print-actions.mjs            EDIT — add analytics Print surfaces
  smoke-render.mjs                   (no change or add analytics smoke)
```

### 19.3 Docs (new)

```
ANALYTICS_IMPLEMENTATION_PLAN.md     THIS FILE — design before code
ANALYTICS.md                         (created in Phase 1 after shipping) — user guide,
                                     mirror of REPORT_BUILDER.md structure: builder walk-through,
                                     visual catalogue, slicer docs, formatting, drill-through,
                                     caps/warnings, API reference, tested flows.
```

---

## 20. Definition JSON — schema v2 (proposed)

A single dashboard’s **definition_json** (stored in `analytics_dashboard_definitions.definition_json` and versioned in `analytics_dashboard_versions`). Phase 1 uses a single page (`pages[0]`); additional pages are additive.

```jsonc
{
  "schema_version": 2,
  "dashboard_type": "ANALYTICS",          // vs legacy "DASHBOARD" for old configs
  "display": {
    "page_size": 50,                      // default table page size
    "empty_text": "—",
    "theme": "navy",                      // maps to tokens.css palette
    "show_totals": true
  },
  // Date range that seeds the dashboard DATE_RANGE slicer.
  // Visuals that declare date_basis: "DASHBOARD" inherit this.
  "date_basis": "ACCOUNTING_DATE",
  "date_column": null,

  // Slicers are visuals (type: SLICER) → also listed in visuals{}.
  // This top-level array gives order + binding defaults.
  "slicers": [
    { "visualId": "sl_location", "boundColumnKey": "origin_location_code",
      "operator": "in", "required": false },
    { "visualId": "sl_date", "date_basis": "ACCOUNTING_DATE", "required": true }
  ],
  "bindings": {
    "slicer_to_column": {
      "sl_location": "origin_location_code",
      "sl_date": null                     // date slicer binds to date_basis, not a column
    },
    "visual_overrides": {
      "v_kpi": { "ignoreSlicers": [] }
    }
  },

  "filters": [],                          // dashboard-level fixed filters (optional)
  "filter_logic": "AND",

  // Canvas layout — react-grid-layout JSON, ordered.
  // w/h in grid units (12 cols, rowHeight 32). Must match visuals keys.
  "layout": [
    { "i": "v_kpi", "x": 0, "y": 0, "w": 3, "h": 4 },
    { "i": "v_bar", "x": 3, "y": 0, "w": 9, "h": 8 },
    { "i": "v_table", "x": 0, "y": 8, "w": 12, "h": 10 }
  ],

  // One entry per tile on the canvas.
  "visuals": {
    "v_kpi": {
      "type": "KPI_CARD",
      "title": "Closing Stock (BBL)",
      "query": {
        "source": { "kind": "table", "table": "book_stock_daily_entries" },
        "date_basis": "COLUMN", "date_column": "entry_date",
        "columns": [
          {
            "key": "closing_stock", "label": "Closing Stock",
            "kind": "data",
            "source": { "type": "column", "column": "closing_stock" },
            "data_type": "number", "aggregate": "SUM", "show_total": true
          },
          {
            "key": "closing_plan", "label": "Plan",
            "kind": "data",
            "source": { "type": "column", "column": "closing_stock" },
            "data_type": "number", "aggregate": "SUM",
            "value_conditions": [
              { "source": { "type": "column", "column": "entity_code" },
                "operator": "eq", "value": "PLAN" }
            ],
            "value_condition_logic": "AND"
          },
          {
            "key": "variance", "label": "Variance",
            "kind": "calculated", "formula": "[closing_stock] - [closing_plan]",
            "data_type": "number", "format": { "decimals": 2 }
          }
        ],
        "filters": [
          { "column_key": "product_code", "operator": "eq", "value": "CRUDE" }
        ],
        "filter_logic": "AND",
        "group_by": [],
        "sort": [],
        "options": { "show_totals": true, "page_size": 1, "empty_text": "—" }
      },
      "display": {
        "valueColumnKey": "closing_stock",
        "comparisonColumnKey": "variance",
        "format": { "decimals": 0, "suffix": " BBL" },
        "thresholds": { "low": -1000, "high": 1000, "invert": false },
        "showTrend": false
      },
      "interactions": { "crossFilter": false, "drillThrough": null }
    },

    "v_bar": {
      "type": "BAR", // | COLUMN | LINE | AREA | COMBO | PIE | DONUT | GAUGE | …
      "title": "Closing Stock by Location",
      "query": {
        "source": { "kind": "operation_tickets", "statuses": ["Approved"] },
        "date_basis": "DASHBOARD",
        "columns": [
          { "key": "origin_location_code", "label": "Location",
            "kind": "data", "source": { "type": "column", "column": "origin_location_code" } },
          { "key": "observed_qty", "label": "Observed qty",
            "kind": "data", "source": { "type": "payload_path", "field_code": "tank_gauging", "path": "observedQty" },
            "data_type": "number", "aggregate": "SUM", "show_total": true }
        ],
        "group_by": [{ "key": "origin_location_code", "bucket": "VALUE" }],
        "sort": [{ "key": "observed_qty", "dir": "desc" }],
        "options": { "show_totals": true, "page_size": 50, "empty_text": "—" }
      },
      "display": {
        "xField": "origin_location_code",
        "yField": "observed_qty",
        "stack": "none",                 // none | stack | percent
        "dataLabels": { "show": false },
        "conditionalFormatting": [
          { "columnKey":"observed_qty","operator":"lt","value":1000,
            "then":{"color":"#991b1b"} }
        ]
      },
      "interactions": {
        "crossFilter": true,
        "crossHighlight": true,
        "drillThrough": {
          "target": "CUSTOM_REPORT",    // TRANSACTION_DETAIL | ANALYTICS_DASHBOARD | CUSTOM_REPORT
          "reportId": 7,
          "columnKey": "origin_location_code"
        }
      }
    },

    "sl_location": {
      "type": "SLICER",
      "title": "Location",
      "slicerKind": "MULTI_SELECT",      // DROPDOWN | MULTI_SELECT | CHIPS | SLIDER | HIERARCHY | DATE | DATE_RANGE | BUCKET
      "query": {
        "source": { "kind": "operation_tickets", "statuses": ["Approved"] },
        "columns": [
          { "key":"origin_location_code","label":"Location",
            "kind":"data","source":{"type":"column","column":"origin_location_code"} }
        ],
        "group_by": [{ "key":"origin_location_code","bucket":"VALUE" }],
        "options": { "page_size": 200, "empty_text":"—" }
      },
      "display": { "placeholder": "All locations", "showSearch": true, "showSelectAll": true }
    }
  },

  "pages": [
    // Phase 1 single page mirrors top-level layout/visuals.
    // Phase 2 may introduce multiple pages here.
  ],

  "grants": [
    { "grant_type":"ROLE","role_id":3,"access_level":"VIEW" },
    { "grant_type":"LOCATION","location_code":"ONSHORE-A","access_level":"VIEW" }
  ]
}
```

**Validation rules** (mirroring `report_engine.validate_definition` per visual + canvas rules):

* `visuals` ≤ 24 per dashboard, `layout.length === visuals count`, each `layout.i` matches a `visuals` key, ids unique, `w∈[2,12]`, `h∈[2,16]`, `x+w ≤12`, no two layout entries identical (overlap allowed but discouraged — builder shows warning).
* `columns ≤ 60` per visual, `value_conditions ≤20` per column, `≤100` per visual, `filters ≤ 20` per visual, `group_by ≤ 6` per visual.
* Formula references resolved via `referenced_columns`; cycle → error; blank rules same as reports.
* Colour values if non-empty must be `^#[0-9a-fA-F]{6}$` or `var(--…)` token (no arbitrary CSS).
* Location slicer bound column must exist in at least one non-SLICER visual — otherwise the slicer does nothing and a warning is raised.

---

## 21. API surface (proposed)

### 21.1 Builder & sharing

| Method | Endpoint | Permission | Purpose | Audit |
|--------|----------|------------|---------|-------|
| GET | `/analytics/catalog` | `View Analytics Definition` | `{datasets, tables, handlers, visualTypes}` (reuses `report_catalog`) | — |
| GET | `/analytics/column-distinct?table=&column=&q=` | `View Analytics Definition` | distinct values for slicers, scope-aware, capped 500 | — |
| POST | `/analytics/formula/validate` | `View Analytics Definition` | `{formula, column_keys} → {valid,error,code,position,referenced_columns}` | — |
| GET | `/analytics/lookups` | `View Analytics Definition` | locations/statuses/assets/users/roles (reuses report lookups) | — |
| GET | `/analytics/dashboards` | `View Analytics Definition` | list drafts+published reachable to caller (grants + scope), filter `scope_type, location_code, status, q` | — |
| POST | `/analytics/dashboards` | `Create Analytics Definition` | create draft `dashboard_definitions` + grants | Create AnalyticsDashboard |
| GET | `/analytics/dashboards/{id}` | `View Analytics Definition` + grant | read one + grants | — |
| PUT | `/analytics/dashboards/{id}` | `Edit Analytics Definition` + EDIT/OWNER | update draft (`definition`, `grants`, `scope_type`, `location_code`) | Update |
| DELETE | `/analytics/dashboards/{id}` | `Delete Analytics Definition` + OWNER/Admin | delete dashboard + versions + grants | Delete |
| POST | `/analytics/dashboards/{id}/duplicate` | `Create Analytics Definition` + VIEW on source | clone | Create |
| POST | `/analytics/dashboards/{id}/publish` | `Publish Analytics Definition` + EDIT/OWNER | set `is_published=Yes`, bump `version`, capture `AnalyticsDashboardVersion` | Publish |
| POST | `/analytics/dashboards/{id}/revert` | `Publish Analytics Definition` + EDIT/OWNER | restore `definition_json` from a version, bump | Revert |
| GET | `/analytics/dashboards/{id}/versions` | grant EDIT/OWNER | history | — |
| POST | `/analytics/run-preview` | `Create Analytics Definition` OR `Edit Analytics Definition` | run unsaved `definition` single visual / full batch preview (no grants check) | — |
| POST | `/analytics/dashboards/from-starter` | `Create Analytics Definition` | create from a template (optional: KPI pack, Ops overview, Book Stock) | Create |

### 21.2 Viewer

| Method | Endpoint | Permission | Purpose |
|--------|----------|------------|---------|
| GET | `/analytics/my-dashboards` | `View Analytics Dashboard` | published dashboards reachable to caller (grants + scope + Published + Active) |
| GET | `/analytics/my-dashboards/{id}` | `View Analytics Dashboard` + grant | one published dashboard + `definition` |
| POST | `/analytics/my-dashboards/{id}/run-batch` | `View Analytics Dashboard` + grant + scope | execute all (or subset) visuals with `slicer_state + selections` — scope enforced per visual |
| GET | `/analytics/my-dashboards/{id}/visual/{visualId}/records` | `View Analytics Dashboard` + grant | “see records” — paginated underlying rows (`page, page_size, search`) |
| POST | `/analytics/my-dashboards/{id}/visual/{visualId}/export` | `Export Analytics Dashboard` (or reuse `Export Custom Report`) + grant | server xlsx/csv full result up to `EXPORT_CAP` |
| GET | `/analytics/my-dashboards/{id}/export-xlsx` | `Export Analytics Dashboard` | one workbook, one sheet per visual (phase 3) |

Batch and records endpoints enforce row scope (`_requested_locations` party check) on top of dashboard grants — a slicer cannot widen the runner’s scope; `effective_locations` in the response tells the viewer what was actually applied.

---

## 22. Permission catalog additions

Single new category (proposed placement near `Reporting` + existing `Dashboard`):

```python
{
    "category": "Analytics",
    "modules": [
        {
            "module_name": "Analytics Definition",
            "permissions": [
                _perm("View Analytics Definition",   VIEW,
                      "Can view analytics dashboard designs in Analytics Builder"),
                _perm("Create Analytics Definition", CREATE,
                      "Can design new analytics dashboards (canvas, visuals, slicers, calculations)"),
                _perm("Edit Analytics Definition",   EDIT,
                      "Can edit analytics dashboard designs and their access grants"),
                _perm("Delete Analytics Definition", DELETE,
                      "Can delete analytics dashboard designs"),
                _perm("Publish Analytics Definition", OTHER,
                      "Can publish analytics dashboards to My Dashboards (and unpublish / revert versions)"),
            ],
        },
        {
            "module_name": "Analytics Dashboard",
            "permissions": [
                _perm("View Analytics Dashboard",   VIEW,
                      "Can run published analytics dashboards shared with the user, their roles or their locations"),
                _perm("Export Analytics Dashboard", OTHER,
                      "Can download analytics visual results as Excel/CSV (full result up to 50k rows)"),
            ],
        },
        {
            "module_name": "Analytics Data Source",
            "permissions": [
                _perm("View Analytics Data Source",   VIEW,
                      "Can view the curated analytics data sources (handlers and their parameters)"),
                _perm("Create Analytics Data Source", CREATE,
                      "Can create curated analytics data sources (handler_key + allowed params)"),
                _perm("Edit Analytics Data Source",   EDIT,
                      "Can edit curated analytics data sources"),
                _perm("Delete Analytics Data Source", DELETE,
                      "Can delete curated analytics data sources"),
            ],
        },
    ],
},
```

Notes:

* `Dashboard` (the old module) is kept unchanged so the FSO/OTR dashboards keep their 5 perms (`View/Create/Edit/Delete/Publish Dashboard`). New `Analytics *` perms are parallel — no rename, no breaking `test_permission_catalog`.
* `DERIVED_PERMISSION_GRANTS` entry so operators aren’t locked out on first upgrade:
  ```python
  "View Analytics Dashboard": ["View Dashboard", "View Custom Report", "View Material Balance Report"],
  "View Analytics Definition": ["View Report Definition"],
  ```
  Gives existing Dashboard/Report users the Analytics viewer by default; tightens later if owner wants.
* `LEGACY` block stays untouched.

---

## 23. Risks, constraints & mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| **Backend frozen** — plan requires new tables/endpoints | High (standing rule 0) | Build blocked | Owner already approved Analytics as a “bigger update” (exception). Migrations are idempotent; `dashboard_*` untouched so rollback is safe. Keep changes additive. |
| **Location scope leakage via handler visuals** | Medium | Data shown to wrong location | Every batch run calls `get_user_report_location_codes` + `apply_transaction_party_scope_filter` inside `report_engine`; curated handlers also call the same helper before returning rows. Add per-visual scope tests that mirror `test_role_location_scope`. |
| **Sensitive columns via custom table choice** | Low | Secrets exposed | Reuse `report_catalog.is_sensitive_column` + `validate_definition` rejecting `DENIED_TABLES` (`users`, `permissions`, `auth_*`, `token_blacklist` etc.) — no second allow-list. |
| **Per-dashboard caps causing “why is my chart short?”** | High | User confusion | Each visual’s `meta.warnings[]` is shown beneath the canvas (like `CustomReportViewer`). Banners for SCAN/EXPLODED/EXPORT/time budget, colour `warning`. E2E help in `ANALYTICS.md`. |
| **Performance — N visuals × 50k scan** | Medium | Slow dashboards | Batch endpoint, cache, and advice: dashboards with >6 data visuals warn at save (“Consider splitting”). Server keeps per-visual `TIME_BUDGET_SECONDS 25` so one bad visual doesn’t kill the rest. |
| **Formula drift between Report Builder & Analytics** | Low | Different results for same expression | Import the **same** module — no copy. Validation endpoint uses `report_formula.validate_formula` with the visual’s `columnKeys`. |
| **react-grid-layout on small screens** | Medium | Unusable on tablet | `ResponsiveGridLayout` with breakpoints; read-only viewer collapses to single-column under `768px`; builder shows “Use a wider screen to edit layout” banner under `1024px`. |
| **Dark theme chart invisibility** | Low | Charts unreadable in dark | Palette + grid colours use `var(--…)` tokens; `echarts` option reads `getComputedStyle(document.documentElement).getPropertyValue('--text')` so theme switch is immediate. |
| **Export audit volume** | Low | Audit table bloat | Export of 50k rows already audited once in `report_engine` export path; per-visual exports are one audit row per visual (acceptable). Batch run is a single audit row (or none for refresh — use `logUiAction` for view telemetry). |
| **Print overflows canvas** | Medium | Cut pages | `analytics.css` `@media print` with `page-break-inside: avoid` on each visual card, hides slicer bar controls and gallery chrome. Print profile still required (rule 12). |
| **Permission proliferation fatigue** | Low | Admins confused by too many new perms | 7 new permissions (vs 226). Docs show recommended preset assignments; preset tests mirror `test_permission_catalog`. |
| **Mock/dev parity** | Medium | Builder broken in `dev:mock` | Phase 3 adds `scripts/mock-api.mjs` handlers; phase 1 marks the viewer “API required” with a clear `AlertMessage` when the mock is not extended. |

---

## 24. Open decisions for the owner

These are branch points that change wording but not the architecture. Defaults proposed after each question.

1. **Category name** — `Analytics` (default) vs `Hydrocarbon Analytics` / `OTMS Analytics`? → Default `Analytics` (short, matches nav).
2. **Placement beyond nav** — should a dashboard be pinnable on **Home** tiles in phase 1 or deferred to phase 3? → Default phase 1: Home tiles already (small addition).
3. **Who may create GLOBAL analytics dashboards?** Today any non-admin is rejected (mirrors old Dashboard). Loosen to `Create Analytics Definition` holders? → Default: keep Admin-only for GLOBAL, LOCATION otherwise; broaden later on request.
4. **Analog of `INTERNAL` visibility**: allow “any `View Analytics Dashboard` holder can see a `Published+INTERNAL` dashboard” or require explicit grants? → Default: add `INTERNAL` (like reports), but start with `PRIVATE`-only to keep audit tight; flip one check when desired.
5. **Export permission** — new `Export Analytics Dashboard` (clean) vs reuse `Export Custom Report` (fewer perms)? → Default new clean perm; derived grant handles migration so no loss.
6. **Map visuals** (Location geo map) — any lat/lng available on assets? Currently no. Defer.
7. **Book Stock variance reporting** — should the shipped starters include a Book Stock KPI pack (closing by entity/block, by product) à la `book-stock-daily` report starter? → Default yes (2 starter dashboards in `starter_templates` analogue).
8. **Retention / archival** — need a retention policy for unpublished drafts (e.g., auto-archive 90-day stale)? Not needed in phase 1.
9. **Legacy `Dashboard` dashboards** — keep the old FSO viewers post-Analytics or deprecate after a toggle period? → Default keep coexistence; don’t delete FSO routes.
10. **Slicer limit** — max slicers per dashboard (performance): 6 (default) or 10?

Owner answers can be inlined as a one-line decision log before coding begins.

---

## 25. Appendices

### 25.1 Standing instruction compliance checklist

| # | Instruction | How Analytics complies |
|---|-------------|-----------------------|
| 1 | Every action logged and audited | Server `create_audit_log` on all mutations + `logUiAction` on every viewer/builder UI action (nav, slicer, drill, export, print, preview). Same pattern as Report Builder. |
| 2 | Light & Dark theme | `ThemeProvider` tokens only, `prefers-reduced-motion`, no hard-coded colours. `analytics.css` uses `var(--…)`. |
| 3 | Top-side navigation | New `Analytics` dropdown in `navigationItems.js` + dynamic per-dashboard links appended by `TopNavigation` (like Custom Reports). |
| 4 | Pagination 20/50/100 | `PaginationControls` on gallery, “see records”, TABLE visuals. Size persisted globally. |
| 5 | Easy + advanced filters, **date & date-range separate** | `DataFilterBar` pattern for visual filters + slicers: `SLICER` type `DATE` vs `DATE_RANGE` are two distinct visual kinds with separate cards/inputs. |
| 6 | Bulk upload (xlsx+csv) & export (xlsx/csv/pdf) on every list | Gallery + builder respect this: no bulk upload (no data table), but every list exports (gallery, table visual, “see records”) via `ExportMenu` + server xlsx/csv. Print via PDF path. |
| 7 | Navy & White, no animations, no emoji | Palette & type scale from `DESIGN_SYSTEM.md`, `echarts` palette uses navy, transitions ≤150 ms. |
| 8 | Alerts next to section or as pop-ups, never far away | `AlertMessage` above the offending section, `Toast`/`ConfirmDialog` for non-blocking. No `alert()`. |
| 9 | Every page ships Auditing + RBAC, per-permission | `PermissionGuard` per route + per-action `hasPermission` gates on create/edit/delete/publish/close controls, plus object-level grants. |
| 10 | Pop-ups never close on backdrop click | `Modal.jsx` throughout (FormulaBuilder, Conditions, Drill chooser, publish confirm). No overlay `onClick`. |
| 11 | Cross-location party rule | Row scope via `apply_transaction_party_scope_filter` + `user_is_party_to_transaction` + `approved_transaction_not_on_correction_hold` + Book Stock entity mapping. |
| 12 | Every Print prompts Company Report Profile | `PrintProfileProvider.requestPrint` gate before `window.print`, reads `GET /company-report-profiles/print-options` (global). |

### 25.2 Reused vs new code — inventory

**Zero-change reuse (import directly):**

* `services/report_catalog.py` — `build_catalog`, `allowed_columns`, `table_group`, `TICKET_VIRTUAL_FIELDS`, `LEDGER_VIRTUAL_FIELDS`, `discover_json_paths`, `discover_operation_fields`, `humanize`, `reportable_relationships`
* `services/report_formula.py` — `parse_formula`, `referenced_columns`, `validate_formula`, `evaluate`, `FUNCTION_HELP`, `OPERATOR_HELP`, `to_decimal`, `is_blank`, `truthy`
* `services/report_engine.py` — `validate_definition`, `run_report`, `export_xlsx_bytes`, `export_csv_bytes`, `date_basis_label`, constants `SCAN_CAP` etc., helpers `_load_ticket_rows`, `_load_table_rows`, `_extract_rows`, `_apply_calculations`, `_matrix_transform`
* `dependencies/permissions.py` — all helpers including `get_user_report_location_codes`
* `components/reportBuilder/FormulaBuilder.jsx`, `ComparisonConditionsEditor.jsx`, `JsonColumnPicker.jsx`, `ReportDataTable.jsx`
* `utils/reportBuilder.js` — `slugColumnKey`, `formulaInWords`, `formatCellValue`, `AGGREGATES`, `BUCKETS`, `FILTER_OPERATORS`, `emptyDefinition` (as template)
* `api/reportBuilderApi.js` — pattern to copy for `validateReportFormula` etc.
* `components/common/{Modal,Toast,ConfirmDialog,AlertMessage,Icon,PaginationControls,ExportMenu,DataTableToolbar,LocationScopeSelector,PageHeader}`
* `utils/format.js`, `utils/actionLogger.js`, `hooks/usePermissions.js`, `components/PermissionGuard.jsx`

**Net new (~1 500 lines of product code beyond reuse):**

* `models` + `schemas` for `analytics_*`
* `routers/analytics.py` + `services/analytics_engine.py` + `services/analytics_catalog.py`
* `api/analyticsApi.js`, `utils/analytics.js`, `pages/Analytics*.jsx`, `pages/analytics/*`, `components/analytics/*`, `styles/analytics.css`

### 25.3 Example: minimal dashboards that exercise the whole contract

**Dashboard A — “Onshore-A Ops Snapshot” (LOCATION scope)**

* `scope_type: LOCATION`, `location_code: ONSHORE-A`, `visibility: PRIVATE`, grants `ROLE: Operators → VIEW`.
* Visuals: `KPI_CARD` (total `closing_stock` sum, Book Stock), `BAR` (observed qty by `operation_type_code`), `PIE` (share by `status`), `SLICER` multi-select on `origin_location_code` (bounded to Onshore-A’s allowed values), `DATE_RANGE` (last 30 days default).
* A user in `Onshore-B` never sees this dashboard in gallery; an Admin does. A user with `Onshore-A` report scope and the role sees it.

**Dashboard B — “Cross-entity comparison” (GLOBAL)**

* `GLOBAL`, `INTERNAL`, published.
* Two conditional measures on the same quantity source: `qty_A` (when `origin_location_code = ONSHORE-A`) and `qty_B` (when `origin_location_code = ONSHORE-B`), plus `variance`, `variance_pct` = `PCT([variance],[qty_A])`. Bar chart shows all three per month (MONTH bucket).
* Demonstrates Report Builder’s two-rule-on-one-source pattern that Analytics inherits.

**Dashboard C — “Tank health” (reuses TANK_VISUAL)**

* One `TANK_VISUAL` (`TANK_STOCK_SNAPSHOT` handler) plus a `LINE` visual of `closing_stock` over `MONTH`.
* Slicers wired to the same location so the line chart and tank visuals react together (binding map).

### 25.4 Compliance testing sketch (what `test_analytics.py` will assert)

Reuses the patterns in `backend/tests/test_report_builder.py` + `test_role_location_scope.py`:

1. Formula: precedence, %, `IF/IFS/AND/OR/NOT`, `DIV0/IFERROR`, blank rules, cycles, `Decimal` accuracy, injection rejection (unknown/sensitive table denial), `validate_formula` unknown-column rejection.
2. Catalog safety: sensitive columns never in `GET /analytics/catalog`.
3. Scope: handler and `table` visuals return `0` rows for a viewer with disjoint location; `effective_locations` in batch response reflects the intersection.
4. Party rule: ticket where `destination_location_code` matches viewer’s location is visible even though `origin` doesn’t.
5. Grants: non-owner without grant gets `404`; role grant works; location grant works; LOCATION grants cannot carry EDIT; non-admin cannot widen grants beyond own scope.
6. Publish: only `Publish Analytics Definition` holder or OWNER can publish/revert; Draft not visible via `my-dashboards` when published-only.
7. Caps: rows beyond `SCAN_CAP` trigger warning, first `SCAN_CAP` returned; `MAX_MATRIX_COLUMNS 60` → 61st bucket collapsed into *Other* and totals stay correct.
8. Export: `POST /visual/{id}/export` sets `content-disposition` and `AuditLog` row.

### 25.5 Related book-keeping

* Update `CLAUDE.md` standing rules table with the new Analytics permissions if the Owner wants them enumerated there (not required — `default_permissions` is authoritative).
* Add a row to `PERMISSION_CRITERIA_MODEL.md` §7.2 for Analytics (same as `Custom Reports` but with `analytics_dashboard_grants`).
* Extend `REPORT_BUILDER.md` *Companion* section pointing to `ANALYTICS.md` (written phase 1).

---

## How to use this plan

1. Owner reviews §24, picks defaults or overrides, and marks `Status: APPROVED`.
2. Implement phases in order on `arena/9ba67694-hydrocarbon-accounting-otms`; each phase is a PR from this branch.
3. Do not add `pytests`/`gh checks` outside the analytics runner until the publisher confirms reporting of the existing test suite still passes (plan is doc-only as requested).

---

*End of plan — no code changed in this commit. The document itself is the deliverable and lives at `ANALYTICS_IMPLEMENTATION_PLAN.md`.*
