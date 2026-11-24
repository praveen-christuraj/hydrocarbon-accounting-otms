# Analytics dashboards

Analytics adds a visual dashboard builder and published dashboard gallery without changing the legacy FSO/OTR Dashboard routes. Dashboard queries reuse the Report Builder catalog and execution engine; they do not accept SQL or arbitrary table names outside the existing report catalog.

## Entry points

- **My Dashboards:** `/analytics`
- **Analytics Studio:** `/analytics/builder`
- **Dashboard viewer:** `/analytics/view/{id}`
- **Material Balance source:** the builder's `Material Balance Report — active location template` source reads the active template and the same continuity-aware Tank Stock Ledger routines as the Material Balance Report. It renders as a dynamic table. The viewer requires one location and a date range for this source.

## Building a dashboard

1. Open Analytics Studio and give the dashboard a name, description and location. The location list is restricted to the user's reporting scope. GLOBAL definitions are intentionally admin-only in this release.
2. Select a governed data source. Operation Tickets default to Approved records; Tank Stock Ledger and other reportable catalog tables are available as well. Sensitive/denied catalog tables remain excluded by `report_catalog`.
3. Choose a table, KPI, bar/column/line/area, pie/donut or matrix visual. Select fields; charts and KPIs require a numeric measure, and charts require a category field. Add a calculated measure using the shared Formula Builder; formulas are checked by the Analytics API against the selected fields.
4. Arrange visuals on the responsive dashboard canvas by dragging and resizing them. Their layout is stored with the dashboard definition.
5. Add optional text/select slicers tied to a visual field. A dashboard can have up to six slicers.
6. Preview a visual or the dashboard, save the definition, then publish it. Published dashboards appear to the owner and users covered by explicit dashboard grants. Location dashboards created in Studio share View access with the selected location by default.

The viewer supplies separate Date From and Date To controls plus the location selector (for Global dashboards). Text/select slicers are separate from those time controls. The visual table renderer paginates using the shared 20/50/100 user preference. Charts use ECharts and respond to the active application theme.

## Permissions and scope

- `View Analytics Definition`, `Create Analytics Definition`, `Edit Analytics Definition`, `Delete Analytics Definition`, and `Publish Analytics Definition` govern Analytics Studio.
- `View Analytics Dashboard` gates the gallery and runtime; `Export Analytics Dashboard` gates the server-side XLSX/CSV visual exports.
- Explicit grants can target a user, role or location. Location grants are View-only; Edit grants target a user or role. User and role reporting scope remains enforced by the report engine at execution.
- A dashboard using the Material Balance source also requires `View Material Balance Report` and is constrained to the dashboard runner's report-location scope.
- Analytics dashboard runs and exports, and all definition mutations, are written to the existing Audit Log service. UI interactions use `logUiAction`.

## API outline

- `GET /analytics/catalog`
- `GET/POST /analytics/definitions`, `GET/PUT/DELETE /analytics/definitions/{id}`
- `POST /analytics/definitions/{id}/publish`, `GET /analytics/definitions/{id}/versions`
- `POST /analytics/run-preview`
- `GET /analytics/my-dashboards`, `GET /analytics/my-dashboards/{id}`
- `POST /analytics/my-dashboards/{id}/run-batch`
- `POST /analytics/my-dashboards/{id}/visual/{visual_id}/export` (`xlsx` or `csv`)

Definitions are versioned JSON (`schema_version: 2`). Each query visual contains a Report Builder definition (`schema_version: 1`) and is validated with the existing report formula/source/filter validation before saving or running. The backend stores dashboard definitions, grants and immutable version snapshots in the additive `analytics_dashboard_*` tables.

## Current release boundaries

This is the core dashboard release: one dashboard page, shared date/location filters, select slicers, report-engine visuals, dynamic Material Balance tables, grants, publishing, version snapshots and visual exports. Cross-filter interactions, drill-through, more advanced visual types, bookmarks, a full distinct-value slicer picker and single-workbook dashboard export remain later-phase work. The legacy `/dashboard` API and FSO/OTR viewers are unchanged.
