# Report Builder — User & Technical Guide

The **Report Builder** (Configurations → Report Builder) lets authorised users
design their own **tabular** and **matrix (cross-tab)** reports from any saved
data in the system — in plain English, without SQL and without IT help.
Published reports appear by name in the **Reporting** menu for exactly the
users, roles or locations chosen while the report is being created. Every
report has a date range, filters, export (Excel / CSV / PDF / print) and
prints with the Company Report Profile branding like every other report.

---

## 1. Who can do what (permissions)

| Permission (module) | What it allows |
|---|---|
| **View Report Definition** (Report Builder) | Open Configurations → Report Builder and see reports you own or that were shared with you |
| **Create Report Definition** | Design new reports, use starters, duplicate, preview with real data |
| **Edit Report Definition** | Redesign reports you own or were given *Edit* access to |
| **Delete Report Definition** | Delete reports you own |
| **Publish Report Definition** | Put a report into the Reporting menu (or take it out) |
| **View Custom Report** (Custom Reports) | Run published reports shared with you / your roles / your locations |
| **Export Custom Report** | Download full results as Excel / CSV from the viewer |

Administrators automatically hold all of them (seeded at startup through the
standard permission catalog in `backend/app/utils/default_permissions.py`).

**Per-report access** is chosen during creation (Step 5): named **users**,
**roles**, or **everyone at a location**, each with *View* (run / export /
print) or *Edit* (also redesign). Locations can only be given View. A report
can alternatively be marked *Internal* (any holder of “View Custom Report”).
In all cases the **data itself is still limited to each runner’s own
locations**, reusing the system’s `user_locations` + `role_locations`
location scope. Only **published + Active** reports appear in Reporting.

## 2. Designing a report (6 steps, plain English)

1. **Report & Data** — name, tabular vs matrix, and where the data comes from
   (see §3). Choose **which date the From–To filter uses** — *Accounting
   Date* is recommended for stock accounting.
2. **Columns** — click values to add them; rename headings; reorder; set
   decimal places / suffix (e.g. ` %`), TOTAL-row membership and summaries.
   **Calculated columns** are built by clicking columns + operators, with the
   *IF…then…else* and *Bands (IFS)* composers, or by typing the formula.
   **Split saved JSON into columns** opens any payload / JSON column and
   lists every value actually saved inside it (see §5).
3. **Rows & Layout** — detail rows or a **grouped summary**
   (Total / Average / Count / Min / Max per group, with Day/Week/Month/Year
   date grouping); for matrix reports choose rows (up to 3), columns
   (optionally one per Day/Week/Month/Year) and the value. Add **fixed
   conditions** (always applied) and sorting.
4. **Filters for Users** — questions asked at run time: Location, Operation
   Type, Status, Asset, or a filter (text / number / date / choice list) on
   any column. Runtime answers can only *narrow* the designer’s fixed sets.
5. **Who Can Use It** — visibility + grants + publish (see §1).
6. **Preview & Save** — run against real data (first 25 rows + warnings),
   then *Save as draft* or *Save & publish*. Every save keeps a version.

Five one-click **starter reports** (Ticket Register, Tank Gauging Quantities
with payload split, Daily Stock Movements, Tank × Operation Category matrix,
Tank × Month matrix) can be copied and adjusted.

## 3. Data sources — built around the operation payloads

| Source | What it is |
|---|---|
| **Operation Tickets** | `operation_transactions` header **flattened with** every ticket answer (`operation_transaction_values`) and every value inside its JSON **payloads**: `tank_gauging_payload` (`inputs.gaugingDate/Time`, `inputs.tankOperation*`, `calculated.gsvBbl/nsvBbl/lt/mt…`), `multi_tank_payload` (`inputs.before/after.dips.<tank>…`, seals), `tanker_payload` (`tankerTransactionDate/Time`, `calculated.*`), `flowmeter_payload`/`meter_payload` (reading date/time), `fso_payload` / `shuttle_payload` (`meta.*`, `inputs.operation_date`, `inputs.event_time`, `calculated.net.*`). Fields come from the **Operation Template** masters *and* from values actually saved, so custom forms work too. |
| **Tank Stock Ledger** | Movements, stock snapshots and running balances per tank with accounting dates, plus the ticket answers snapshot in `source_payload` (splittable). |
| **Any other table** | **Every** application table/column (77+ tables discovered live from the models) — masters, tracking, voyages, export operations, audit logs… **except** security material: `password_hash`, TOTP secrets, backup codes, tokens and the `token_blacklist` / `auth_login_challenges` tables are never listed or extractable. Tables without a location column show a warning because they cannot be location-limited. |

**Dates & times (payload-first, exactly like the accounting reports).** The
ticket’s operational date/time is resolved from inside its payload with the
shared `app.services.operation_datetime` resolver (gauging date/time, tanker
transaction date/time, multi-tank before/after, flowmeter reading, FSO/shuttle
operation date + event time — including stringified-JSON and flat
`input_*` shapes), falling back to the header only when no payload date
exists. The **Accounting Date** applies the origin location’s *Location
Accounting Day Setting* (e.g. 06:01–06:00) to that moment. Date bases
available per report: Accounting Date, Operation/Gauging Date (payload),
Operation Date (header), Created Date, a chosen date column, or none.

## 4. Calculated columns & conditions (formula language)

Formulas reference columns as `[column_key]` and are evaluated with
**Decimal** arithmetic by a purpose-built parser — never `eval`, never SQL.

```
[gsv_bbl] - [nsv_bbl]
[variance_bbl] % [received_bbl]                      # percent of (a ÷ b × 100)
IFERROR([variance_bbl] % [received_bbl], 0)
IF(AND([bsw_pct] <= 0.5, OR([location] = "BONNY", [location] = "ESC")), "OK", "Check")
IFS([nsv_bbl] >= 1000, "Large", [nsv_bbl] >= 100, "Medium", "Small")
SUM([oil_bbl], COALESCE([water_bbl], 0))
```

- Operators: `+ − * / % ^`, comparisons `= <> > >= < <=`, logic via
  `AND/OR/NOT` as functions or infix, parentheses.
- `%` between two columns means **percent of** (what terminal accountants
  mean); use `MOD(a,b)` for remainder and `PCT(a,b)` as the function form.
- Functions: `IF, IFS, AND, OR, NOT, ISBLANK, COALESCE, IFERROR, ABS, ROUND,
  SUM, AVG, MIN, MAX, COUNT, MOD, PCT, CONCAT, UPPER, LOWER, TRIM, LEN, LEFT,
  RIGHT, YEAR, MONTH, DAY, DATEDIFF, TODAY`.
- **Blanks stay blank** through arithmetic (`5 + blank = blank`), so “no
  reading” never silently becomes zero; `COALESCE(x, 0)` opts out and
  `SUM/AVG/MIN/MAX/COUNT` ignore blanks. Division by zero blanks only that
  cell (marked ⚠ and counted in the run warnings) unless wrapped in
  `IFERROR`. Comparisons coerce text numbers (`"28"`) and dates sensibly.
- Formulas are **validated** (syntax, unknown columns/functions, circular
  references) live in the builder and again on save/run. Calculated columns
  may use other calculated columns (dependency-ordered).

## 5. JSON → separate columns (required feature)

Wherever data is saved as JSON — ticket payloads, ledger `source_payload`,
calibration `row_data`, audit `details`, trip/movement summaries, any
`JSONB` column — **Split into columns** samples real saved values (within
your locations), flattens them to dot-paths (`calculated.nsvBbl`,
`inputs.before.dips.T1.total`) with inferred types, occurrence counts and
example values, and turns each ticked path into a normal report column that
can be filtered, grouped, totalled and used in formulas.

Repeated sections are handled with **one row per item**: per-tank maps such
as `inputs.before.dips` offer `…dips.*.total` plus `…dips.@key` (the tank
id), and arrays offer `tanks[].nsvBbl` — the ticket repeats once per tank /
array item. One repeated section per report (to keep rows unambiguous).
Stringified (double-encoded) JSON payloads are unwrapped the same way the
accounting reports unwrap them.

## 6. Running, exporting and printing (Reporting module)

Each published report appears under **Reporting → (its name)** and in
**Reporting → Custom Reports**. The viewer offers: date range (on the
report’s date basis), the designer’s filter questions, quick search,
server-side pagination, TOTAL row, ⚠ cell warnings with run statistics,
**About this report** (calculations explained in words), **Excel / CSV
(all rows, server-generated)**, screen-page export incl. PDF via the shared
export menu, and **Print** through the global Company Report Profile dialog
(branded header/footer, full result up to 500 rows, compact print layout).

## 7. Accuracy & safety rules

- Definitions are re-validated against the live catalog on every save and
  run: unknown/sensitive tables, columns, payload fields or JSON paths are
  rejected, so hand-crafted definitions cannot reach secrets or inject SQL
  (all data access is parameterised SQLAlchemy on catalogued columns).
- Location scope = grant ∩ runner scope ∩ runtime choice; ticket party
  locations (origin/destination/sender/receiver) follow the same
  party-visibility rule as the built-in reports.
- Caps with explicit warnings (never silent): 50,000 base rows scanned,
  100,000 exploded rows, 60 matrix columns (remainder combined into *Other*
  so totals stay correct), 50,000 export rows, 25-second calculation budget,
  long text shortened for display. Rows without the chosen date are excluded
  by a date range **and counted** in the warnings.
- Everything is audited (create / update / publish / delete / export) and
  designs are versioned (`report_definition_versions`).

## 8. Technical reference

**Backend** — `backend/app/routers/report_builder.py` (prefix
`/report-builder`), services `report_catalog.py` (live catalog + JSON
discovery), `report_formula.py` (safe Decimal formula engine),
`report_engine.py` (validation + execution + starters + exports). Tables:
`report_definitions` (`definition_json` holds the versioned design),
`report_access_grants`, `report_definition_versions`. No migration step is
needed: tables are created by `create_all` and permissions are seeded by the
standard catalog (`Report Builder` module under *Configurations*, `Custom
Reports` under *Reporting*).

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/report-builder/catalog` | Datasets, all tables/columns, formula help, date bases |
| GET | `/report-builder/operation-fields` | Template fields + saved ticket field codes |
| POST | `/report-builder/json-paths` | Sample JSON and list splittable paths (+ wildcards) |
| POST | `/report-builder/formula/validate` | Validate a formula against column keys |
| GET | `/report-builder/lookups` | Locations / types / templates / statuses / assets / users / roles |
| GET/POST | `/report-builder/definitions` | List (mine/shared) / create |
| GET/PUT/DELETE | `/report-builder/definitions/{id}` | Read / update (new version) / delete |
| POST | `/report-builder/definitions/{id}/duplicate|publish|run` | Copy / publish-unpublish / run a draft |
| POST | `/report-builder/definitions/from-starter` | Create from a starter design |
| POST | `/report-builder/run-preview` | Run an unsaved design (builder preview) |
| GET | `/report-builder/definitions/{id}/versions` | Design history |
| GET | `/report-builder/my-reports[/{id}]` | Published reports available to me |
| POST | `/report-builder/my-reports/{id}/run` | Run a published report |
| POST | `/report-builder/my-reports/{id}/export` | Download XLSX/CSV (full result) |

**Definition JSON (schema_version 1)** — `report_type`
(`TABULAR|MATRIX`), `source` (`kind`, `table`, `operation_type_codes`,
`template_ids`, `statuses`), `date_basis` (+`date_column`), `columns[]`
(`key`, `label`, `kind: data|calculated`, `source: {type: column|virtual|
ticket_field|payload_path|json_path, …}`, `formula`, `data_type`, `format
{decimals,prefix,suffix}`, `aggregate`, `show_total`, `hidden`), `filters[]`
+ `filter_logic`, `runtime_filters[]` (`type: location|operation_type|
status|asset|text|number|date|select`, `column_key`, `operator`, `options`,
`required`, `default`), `group_by[]` (`{key,bucket}`), `matrix`
(`row_keys`, `column_key`, `column_bucket`, `value_key`, `aggregate`,
totals), `sort[]`, `options` (`show_totals`, `page_size`, `empty_text`,
`explode_keep_empty_rows`).

**Frontend** — `frontend/src/pages/ReportBuilder.jsx` (Configurations,
`/report-builder`), `frontend/src/pages/CustomReportViewer.jsx` (Reporting,
`/reporting/custom-reports[/:reportId]`), components in
`frontend/src/components/reportBuilder/` (`FormulaBuilder`,
`JsonColumnPicker`, `ReportDataTable`), `frontend/src/api/reportBuilderApi.js`,
`frontend/src/utils/reportBuilder.js`. The Reporting menu gains one entry per
published report shared with the signed-in user (`TopNavigation` fetches
`/my-reports`). The dev mock API (`frontend/scripts/mock-api.mjs`) implements
the same surface with sample rows for frontend-only work.

**Tests** — `backend/tests/test_report_builder.py` covers the formula engine
(precedence, %, IF/IFS/AND/OR, DIV0/IFERROR, blank rules, Decimal accuracy,
injection rejection, cycles), catalog safety (no secrets), JSON discovery +
per-tank explosion, payload/accounting-date runs, grouping, matrix totals,
grants (role/location/user), publish permission, runner location scoping,
exports, starters and versioning.
