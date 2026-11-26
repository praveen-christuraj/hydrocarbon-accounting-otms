# Analytics dashboards

Analytics adds a visual dashboard builder and published dashboard gallery without changing the legacy FSO/OTR Dashboard routes. Dashboard queries reuse the Report Builder catalog and execution engine; they do not accept SQL or arbitrary table names outside the existing report catalog.

## Entry points

- **My Dashboards:** `/analytics`
- **Analytics Studio:** `/analytics/builder`
- **Dashboard viewer:** `/analytics/view/{id}`
- **Material Balance source:** the builder's `Material Balance Report — active location template` source reads the active template and the same continuity-aware Tank Stock Ledger routines as the Material Balance Report. It renders as a dynamic table. The viewer requires one location and a date range for this source.

## Building a dashboard

1. Open Analytics Studio and give the dashboard a name, description and location. The location list is restricted to the user's reporting scope. GLOBAL definitions are intentionally admin-only in this release.
2. Select a governed data source. Operation Tickets, Tank Stock Ledger, the pre-modelled Shore Tank Snapshot / Material Balance / Vessel & Barge Tracking datasets and every reportable catalog table are available. Sensitive/denied catalog tables remain excluded by `report_catalog`. New Operation Tickets visuals are created with **no** status restriction; use the inspector's **Source Restrictions** panel to limit ticket statuses, operation types and entry forms per visual (the Report Builder's `source.statuses` / `operation_type_codes` / `template_ids` contract).
3. Choose a table, KPI, bar/column/line/area, pie/donut or matrix visual. Select fields; charts and KPIs require a numeric measure, and charts require a category field. Add a calculated measure using the shared Formula Builder; formulas are checked by the Analytics API against the selected fields.
4. Arrange visuals on the responsive dashboard canvas by dragging and resizing them. Their layout is stored with the dashboard definition.
5. Add optional text/select slicers tied to a visual field. A dashboard can have up to six slicers.
6. Add rows to the visual from the field explorer. It is grouped exactly like the Report Builder explorer — *Dates (from ticket answers)*, *Names (looked up)*, *Data columns* and *JSON / payload columns* — so virtual fields (payload gauging date, looked-up names) can be used as dimensions/measures.
7. **JSON / payload fields.** For Operation Tickets, Tank Stock Ledger and any table with a JSON column, the explorer's JSON panel lists the values actually saved inside the payload and adds them as real columns (`source: {type: "payload_path" | "json_path", path: ...}`). Repeated sections can be added as "one row per item" (per-tank) wildcard columns. Payload columns behave like any other column: they can be a measure, a fixed filter, a slicer (bound through `slicer.source`) and a comparison rule, and they validate and execute through the same report engine as the Report Builder.
8. Inspector **Sort & Hidden Columns** saves `query.sort` (up to three columns) and per-column `hidden`, so the on-screen visual matches the exported workbook.
9. Preview a visual or the dashboard, save the definition, then publish it. Published dashboards appear to the owner and users covered by explicit dashboard grants. Location dashboards created in Studio share View access with the selected location by default.

The viewer supplies separate Date From and Date To controls plus the location selector (for Global dashboards). Text/select slicers are separate from those time controls. When no location is selected the runner is told `scope_mode: "ALL"`, which explicitly means "every location in my reporting scope" — an empty selection is never read as "nothing in scope".

### Date basis

The visual's date basis is chosen from the catalog list (`GET /analytics/catalog` → `date_bases`), which mirrors the engine's accepted values: `ACCOUNTING_DATE`, `PAYLOAD_OPERATION_DATE`, `OPERATION_DATE`, `CREATED_AT`, `COLUMN` (plus `date_column`) and `NONE`. Legacy names are still accepted on read/save and normalised (`OPERATIONAL_DATE` → `OPERATION_DATE`, `GAUGING_DATE` → `PAYLOAD_OPERATION_DATE`, …), so a dashboard saved by an older release loads, previews and re-saves instead of failing with *Unknown date basis*.

Shore Tank Snapshot visuals ignore the runner's date window (`date_basis: NONE` is the live-snapshot contract). Set `query.as_of_date: true` on the visual only if you deliberately want `date_to` applied as a stock cut-off. The visual table renderer paginates using the shared 20/50/100 user preference. Charts use ECharts and respond to the active application theme.

## Permissions and scope

- `View Analytics Definition`, `Create Analytics Definition`, `Edit Analytics Definition`, `Delete Analytics Definition`, and `Publish Analytics Definition` govern Analytics Studio.
- `View Analytics Dashboard` gates the gallery and runtime; `Export Analytics Dashboard` gates the server-side XLSX/CSV visual exports.
- Explicit grants can target a user, role or location. Location grants are View-only; Edit grants target a user or role. User and role reporting scope remains enforced by the report engine at execution.
- A dashboard using the Material Balance source also requires `View Material Balance Report` and is constrained to the dashboard runner's report-location scope.
- Analytics dashboard runs and exports, and all definition mutations, are written to the existing Audit Log service. UI interactions use `logUiAction`.

## API outline

- `GET /analytics/catalog` (datasets, tables, locations, `is_admin`, `formula_help`, `operator_help`, `date_bases`, and per-dataset `virtual_fields` / `supports_payload_json`)
- `GET /analytics/lookups` (users, roles, locations, asset types, **operation types, entry-form templates, ticket statuses, products, assets**)
- `GET /analytics/operation-fields?operation_type_codes=` and `POST /analytics/json-paths` — the same discovery helpers the Report Builder uses
- `GET/POST /analytics/definitions`, `GET/PUT/DELETE /analytics/definitions/{id}`
- `POST /analytics/definitions/{id}/publish`, `GET /analytics/definitions/{id}/versions`
- `POST /analytics/run-preview`, `POST /analytics/run-preview/visual/{visual_id}/records` (Studio drill-through against the unsaved design)
- `GET /analytics/my-dashboards`, `GET /analytics/my-dashboards/{id}`
- `POST /analytics/my-dashboards/{id}/run-batch`
- `POST /analytics/my-dashboards/{id}/visual/{visual_id}/export` (`xlsx` or `csv`)

Definitions are versioned JSON (`schema_version: 2`). Each query visual contains a Report Builder definition (`schema_version: 1`) and is validated with the existing report formula/source/filter validation before saving or running. The backend stores dashboard definitions, grants and immutable version snapshots in the additive `analytics_dashboard_*` tables.

## Diagnosing an empty visual

A visual that renders nothing now explains itself:

- The tank farm renderer prints the effective scope (`meta.scope_mode` **ALL** / **SELECTED**) plus the engine's filter funnel (`meta.filter_breakdown`: candidates → with stock/calibration → after type filter → after slicers → after fixed filters).
- The visual footer shows the row count returned plus the first engine warning (row-count pill + warning icon).
- Drill-through (*Underlying Records* on the visual header, in both the Viewer and Studio) shows the ungrouped rows and the same funnel.

A `404` from `/analytics/...` means the API answering the page is older than the frontend. `/health` reports `routes: {analytics, analytics_records, analytics_preview_records, analytics_json_paths, analytics_operation_fields}`; any `false` (or a banner in the app) means rebuild/restart the backend (`docker compose build backend && docker compose up -d backend`, or restart uvicorn from this checkout).

## Current release boundaries

This release covers: one dashboard page, shared date/location filters, select slicers, report-engine visuals, dynamic Material Balance tables, grants, publishing, version snapshots, per-visual exports, payload/JSON columns with slicers/filters/comparison rules, source restrictions, sort/hidden editors, drill-through in the Viewer **and** Studio, and a diagnostics footer. Bookmarks and multi-page dashboards remain later-phase work. The legacy `/dashboard` API and FSO/OTR viewers are unchanged.
