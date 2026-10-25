# ReportBuilder

## Purpose
Design custom tabular and matrix (cross-tab) reports from any saved data — including ticket payloads and other JSON columns split into separate columns — and publish them into the Reporting module for chosen users, roles and/or locations. The viewer (`CustomReportViewer`) runs published reports with date range, filters, export and Company Report Profile printing. Full guide: `REPORT_BUILDER.md` (repo root).

## File Locations
- **Frontend:** `frontend/src/pages/ReportBuilder.jsx`, `frontend/src/pages/CustomReportViewer.jsx`, `frontend/src/components/reportBuilder/`
- **API Modules:** `reportBuilderApi.js`
- **Backend Router:** `report_builder.py` (prefix: `/report-builder`)
- **Backend Services:** `report_catalog.py`, `report_formula.py`, `report_engine.py`

## API Endpoints
| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/report-builder/catalog` | Datasets, tables/columns, formula help |
| `GET` | `/report-builder/operation-fields` | Operation template fields + saved ticket field codes |
| `POST` | `/report-builder/json-paths` | Sample JSON, list splittable paths / wildcard sections |
| `POST` | `/report-builder/formula/validate` | Validate a calculated-column formula |
| `GET` | `/report-builder/lookups` | Locations, types, templates, statuses, assets, users, roles |
| `GET/POST` | `/report-builder/definitions` | List / create report definitions |
| `GET/PUT/DELETE` | `/report-builder/definitions/{id}` | Read / update (versioned) / delete |
| `POST` | `/report-builder/definitions/{id}/duplicate` | Copy a report design |
| `POST` | `/report-builder/definitions/{id}/publish` | Publish / unpublish |
| `POST` | `/report-builder/definitions/{id}/run` | Run a saved (draft) definition |
| `POST` | `/report-builder/definitions/from-starter` | Create from a starter template |
| `POST` | `/report-builder/run-preview` | Run an unsaved design (preview) |
| `GET` | `/report-builder/definitions/{id}/versions` | Design history |
| `GET` | `/report-builder/my-reports` | Published reports available to the user |
| `GET` | `/report-builder/my-reports/{id}` | Report detail for the viewer |
| `POST` | `/report-builder/my-reports/{id}/run` | Run a published report |
| `POST` | `/report-builder/my-reports/{id}/export` | Download XLSX / CSV (full result) |

## Key Features
- 6-step plain-English designer: data source, columns, rows & layout, runtime filters, access, preview & save
- Data sources: Operation Tickets (header + every ticket answer + payload values), Tank Stock Ledger, any other table (passwords/secrets never listed)
- JSON columns exploded into separate columns by sampling saved values; repeated sections become one row per item (`dips.*.field`, `rows[].field`, `…@key`)
- Calculated columns with `+ − * / %` (percent-of), `IF / IFS / AND / OR` composers, safe Decimal evaluation (no SQL, no eval)
- Grouped summaries, matrix pivots with totals, fixed + runtime filters, sorting
- Dates resolved from ticket payloads; Accounting Date uses the Location Accounting Day Setting
- Access by user / role / location (View or Edit) + publish step; published reports appear by name in the Reporting menu
- Runner location scope always enforced; row/time caps reported as warnings; designs versioned; actions audited

## Props
| Prop | Source |
|------|--------|
| `loggedInUser` | App.jsx |

## Permissions
- **View:** View Report Definition, View Custom Report
- **Create:** Create Report Definition
- **Edit:** Edit Report Definition
- **Delete:** Delete Report Definition
- **Publish:** Publish Report Definition
- **Excel Export:** Export Custom Report

---

## Full-Stack Architecture Diagram — ReportBuilder

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ FRONTEND                          BACKEND                        DATA                                    │
│                                                                                                          │
│ ReportBuilder   reportBuilderApi  report_builder.py              ReportDefinition                        │
│ ──────────────  ────────────────  ─────────────────               ────────────────                         │
│ 6-step designer  getCatalog()     GET /report-builder/catalog    id (PK) | report_code (UQ)              │
│ (data, columns,  discoverJson..() POST .../json-paths            report_name | definition_json (JSONB)   │
│  layout, filters validateForm..() POST .../formula/validate      visibility | is_published             │
│  access, preview)getDefinitions() GET .../definitions            → ReportAccessGrant (user/role/loc)     │
│                  create/put/del   POST/PUT/DELETE                → ReportDefinitionVersion (snapshots)    │
│ FormulaBuilder   runPreview()     POST .../run-preview           ────────────────                          │
│ JsonColumnPicker publishReport()  POST .../publish                report_catalog.py (live catalog from    │
│ ReportDataTable  ──────────────── ─────────────────                Base.metadata, secrets excluded, JSON  │
│                                  Perm: View/Create/Edit/Delete/  flatten/discovery)                      │
│ CustomReportViewer getMyReports() Publish Report Definition;     report_engine.py (validate + run: SQL  │
│ (Reporting menu)   runMyReport()  View/Export Custom Report      load → payload/JSON resolve → explode   │
│                    exportReport() Audit: module='Report Builder' → filters → formulas (Decimal) →        │
│ Date range,       conv: getCatalog↔GET /catalog                   group/matrix → sort/page)              │
│ runtime filters, runMyReport↔POST /my-reports/{id}/run            report_formula.py (safe parser)          │
│ Excel/CSV/print   exportReport↔POST .../export                   Dates: operation_datetime.py +           │
│ (Company Report                                                               Location Accounting Day    │
│  Profile)                                                                     Setting                     │
│                                                                                                          │
│  WORKFLOW:                                                                                               │
│  Design (Configurations) → Preview real data → Share (user/role/location) →                              │
│  Publish → appears in Reporting menu → Run with runner location scope →                                  │
│  Export Excel/CSV/PDF or print with company branding                                                     │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```
