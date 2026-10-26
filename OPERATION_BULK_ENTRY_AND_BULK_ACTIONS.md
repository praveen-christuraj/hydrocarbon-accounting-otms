# Operation Entry bulk upload + Operation Transaction Register bulk actions

Owner request: capture operation-entry data in bulk from Excel / CSV (the metadata **and**
the payload of every operation layout), save each row **as its own Draft ticket**, and let a
user who may submit / approve / reject / cancel act on **several register tickets at once**.

Both features are implemented entirely in `frontend/`. The backend and the database
structure are unchanged (`CLAUDE.md` §0): the upload calls the existing
`POST /operation-entries` once per row, and the register calls the existing
`PATCH /operation-transactions/{id}/status` once per ticket, so every created / changed
ticket keeps the server-side validation, workflow policy, numbering and audit trail that the
single-ticket screens already use.

---

## 1. Operation Entry – “Bulk Upload Tickets”

**Where:** Operation Entry page header, next to the existing page actions
(`frontend/src/pages/OperationEntry.jsx` → `frontend/src/components/operationEntry/OperationEntryBulkImportDialog.jsx`).

**Who:** anyone who can open Operation Entry and create tickets. The dialog only lists
operation types that are Active **and** available to the signed-in user's locations, exactly
like the entry form.

### 1.1 The wizard

| Step | What it does |
| --- | --- |
| 1 · Choose the ticket type | Operation Type + Operation Template. The template decides the layout, the template fields and the payload columns, so one file always describes one kind of ticket. |
| 2 · Defaults (optional) | Sender location, receiver location, product and created-by. Blank cells fall back to these values. `createdBy` defaults to the signed-in user. The “calculate tank quantities” switch only appears for Tank Gauging. |
| 3 · Template | **Download XLSX template** / **Download CSV template** of exactly the columns the dialog will accept, optionally with one example row. The picker above it is the same layered template store used by every master-data upload (`useBulkTemplates`): rename a variant, hide/reorder optional columns, reset to the built-in default. |
| 4 · Upload | Drop or choose `.xlsx`, `.xlsm`, `.csv` or `.txt`. First row = column headings. Up to **500 ticket rows** per file. Headings are auto-mapped by label/alias/path; anything unrecognised is reported and remains unmapped. |
| 5 · Review | The dialog shows how many rows are ready, the reason for every row that is **not** ready, the mapping table (change any column), and a preview of the first five tickets. Nothing is written until “Import N valid rows as Draft”. |
| 6 · Results | One progress step per row. Each row ends as `success`, `failed` or `skipped` with the server/validation message and any warning (for example “no active calibration table”). Buttons: **Download rows to fix** (only the rejected rows, in the upload layout), **Download results**, **Import another file**, **Close**. |

Closing the dialog never loses tickets that were already created; the page reloads the
register list and shows a toast with the created count.

### 1.2 File layout

The download order is: **operation-entry metadata → template fields → payload columns**.

| Column group | Examples | Notes |
| --- | --- | --- |
| Metadata (always present) | `Operation Type Code`, `Operation Template`, `Primary Asset Code`, `Sender Location Code`, `Receiver Location Code`, `Convoy / Shuttle Number`, `Product`, `Created By`, `Remarks` | Sender writes origin **and** sender; receiver writes destination **and** receiver, like the clubbed dropdowns on the form. A local-scope asset pins the sender to the asset's own location. |
| Template fields | `Sample Reference`, `Shift Code`, … | One column per Active, non-payload template field. Fields marked “required” must be filled. Numbers are converted to numbers. |
| Payload paths | `payload.tank_gauging_payload.inputs.dipCm` | Flat columns whose key is the JSON path inside the payload field. |
| Raw payload | `payload.tank_gauging_payload` | Optional; one cell may hold the whole payload JSON. Path columns override individual keys of that document. |

Payload path rules (`utils/operationEntryBulkImport.js`):

- Separators are `.`; numeric segments build arrays (`inputs.meters.0.opening_reading`
  → `inputs.meters[0].opening_reading`), so per-meter rows work.
- **Any** path is accepted, not only the columns the template proposes. Columns that follow
  `payload.<field_code>.<path>` (or `<field_code>.<path>`) are detected automatically and
  flagged “detected” in the mapping step — this is how the per-tank multi-tank dips
  (`…inputs.before.dips.TK-101.total`) are entered.
- Blank cells never overwrite a value: the payload is built only from filled cells (plus the
  raw JSON document when supplied).
- Values typed as numbers in the layout (`dipCm`, `bswPercent`, `observedApi`, …) arrive as
  numbers on the ticket, so the entry layout can calculate immediately.

### 1.3 What is validated before anything is written

Every row is checked against the same masters the entry form uses, and a failing row is
listed with its spreadsheet row number:

- Operation Type: unknown, inactive, not allowed for the user's locations, or not the type
  selected in the dialog.
- Operation Template: a filled cell must match the selected template.
- Primary Asset: unknown, inactive, wrong asset type for the operation type, or a local asset
  combined with a different sender location.
- Sender / Receiver: unknown or inactive location; the receiver is required when the
  operation type requires one.
- Convoy / Shuttle Number: required for Shuttle Tracking, Tanker and Multi-Tank layouts;
  a shuttle number repeated in the file or already used by another ticket is rejected.
- Required template fields (manual input) must be filled.
- Payload: mandatory sections per layout —

| Layout | Mandatory payload values |
| --- | --- |
| Tank Gauging | gauging date, gauging time, dip, water level, tank temperature, sample temperature, BS&W %, observed API **or** density |
| Tanker | tanker date/time, compartment, total dip, water dip, BS&W %, tank/sample temperature, observed API or density |
| Multi-Tank Before/After | tank ids, before/after tank temperature, sample temperature, BS&W %, observed mode + value, and total/water dip for **every** listed tank |
| Shuttle / FSO | operation date |
| Flowmeter / Meter Reading | reading date, tank/sample temperature, BS&W 0–100, observed API or density, opening + closing reading for each meter, closing ≥ opening |

- Duplicate rows: same metadata + same values as an earlier row in the file → skipped with
  “Duplicate of an earlier row in this file”.

### 1.4 Calculated values

- **Tank Gauging**: the `calculated` block is rebuilt **during the upload** with the same
  engine the layout uses (`utils/tankQuantityEngine.js`), the asset's active calibration
  table (rows fetched on demand) and the Table 11 LT factor — TOV, free water, GOV, VCF,
  density @ 15, GSV, BS&W volume, NSV, LT, MT, plus the validation object. If the asset has
  no active calibration table, the payload is still saved and the row reports why:
  “No active calibration table for X: quantities are completed when the ticket is opened.”
  The user can also switch the calculation off in step 2.
- **Shuttle Tracking / FSO Tracking**: net stock, net water and (FSO) vessel variance are
  derived from the opening/closing figures.
- **Tanker, Multi-Tank, Flowmeter**: the entered observations are saved with the ticket;
  quantities that depend on compartment / per-tank / per-meter structures are completed when
  the ticket is opened for review. The dialog says so for the selected layout.

### 1.5 Result

- Every valid row becomes **one Draft ticket** (status `Draft`) with its own ticket number —
  never a merged or edited record. Duplicate-checking, numbering, audit logging and
  validation all stay on the server.
- Partial success is normal: created tickets stay created, failed rows can be downloaded and
  re-uploaded.
- UI actions logged with `logUiAction` (`Operation Entry`): `Bulk Import File Selected`,
  `Bulk Import Template Downloaded`, `Bulk Import Started`, `Bulk Import Completed`.
- Submitting / approving those drafts is done from the register (below) — by a user with the
  workflow permissions — keeping the two responsibilities separate.

### 1.6 Limits (deliberate)

- One template per file (the payload shape depends on it). Different layouts are uploaded as
  separate files.
- 500 rows per file, each row a separate API call, so one failure never rolls back the
  tickets already created.
- The `.xls` (legacy binary) format is not supported — save as `.xlsx` or `.csv`.

---

## 2. Operation Transaction Register – bulk workflow actions

`frontend/src/pages/OperationTransactionRegister.jsx`

### 2.1 Selection

- A checkbox column appears only for users who hold at least one workflow permission.
- Only statuses that can still move are selectable: **Draft, Submitted, Rejected**. Approved
  and Cancelled tickets are terminal and their checkbox is disabled with a tooltip.
- Header checkbox selects / clears the actionable rows on the current page and shows the
  mixed state.
- Selection survives paging and filter changes; **Select all matching filters** collects up
  to **1 000** tickets (server-paged, 200 per request) and says so when the cap is hit.
- Header actions: **Clear selection** and **Export selected** (xlsx / csv / pdf).
- Selected rows are tinted with `var(--primary-soft)`; the toolbar shows the count and a
  reminder that every ticket keeps its own audit trail.

### 2.2 Actions and rules

| Action | From | To | Permissions checked (client and server) | Extra input |
| --- | --- | --- | --- | --- |
| Submit selected | Draft, Rejected | Submitted | Submit Operation Transaction + Review Operation Transaction | review confirmation + shared remarks |
| Approve selected | Submitted | Approved | Approve Operation Transaction + Review Operation Transaction | review confirmation + shared remarks |
| Reject selected | Submitted | Rejected | Reject Operation Transaction | remarks **required** |
| Recall to Draft | Submitted | Draft | Submit Operation Transaction | shared remarks |
| Cancel selected | Draft, Rejected | Cancelled | Cancel Operation Transaction | remarks **required** |

These are exactly the transitions the backend allows
(`backend/app/routers/operation_transactions.py` → `validate_operation_status_transition`)
and the permissions it enforces (`get_required_permission_for_status_change`, plus
`Review Operation Transaction` whenever `review_confirmed` is sent).

- Buttons that the user cannot use are hidden; the handler re-checks the permission.
- The dialog lists the eligible tickets, names the selected tickets that will be left
  untouched because of their status, requires the same review confirmation as the
  single-ticket screen (Submit/Approve) and requires remarks for Reject/Cancel.
- Workflow policies are evaluated by the server per ticket; a ticket blocked by policy is
  reported individually instead of aborting the run.

### 2.3 Processing and reporting

- Tickets are processed one at a time with a progress line; the list shows a per-ticket
  result (success / failed with the server message).
- Failures never abort the run (unless nothing succeeds); successful tickets leave the
  selection, failed ones stay selected for a retry.
- The register reloads the current page (and status counts) when the run finishes, and a toast
  summarises successes/failures. `logUiAction`: `Bulk <Action> Started` / `Bulk <Action>
  Completed`; the server writes the audit + status-history row per ticket.

---

## 3. Files touched

| File | Change |
| --- | --- |
| `frontend/src/utils/operationEntryBulkImport.js` | New. Pure, tested spreadsheet ⇄ ticket engine: metadata definitions, payload profiles/paths, template-field builder, row → entry assembly, validation, calibration/Table 11 enrichment. |
| `frontend/src/components/operationEntry/OperationEntryBulkImportDialog.jsx` | New. Six-step bulk upload dialog (choose type → defaults → template → upload → review/map → results), built on `Modal` + the shared upload utilities. |
| `frontend/src/pages/OperationEntry.jsx` | Renders the “Bulk Upload Tickets” action (permission-gated), passes masters + calibration data, reloads the lists after an upload. |
| `frontend/src/pages/OperationTransactionRegister.jsx` | Checkbox selection, bulk toolbar, bulk action dialog, selected-row export, workflow gating. |
| `frontend/src/App.jsx` | Passes `loggedInUser` to the register so permissions resolve. |
| `frontend/src/styles/components.css` | Register selection/bulk styles and the bulk upload layout (light + dark via CSS variables, 900 px breakpoint). |
| `frontend/scripts/test-operation-entry-bulk-import.mjs` | New contract test (62 checks) for the engine, including real `.xlsx`/`.csv` round-trips. |
| `frontend/scripts/smoke-render.mjs` | Drives the register bulk selection/approve flow and the full upload → import → results flow. |
| `frontend/scripts/mock-api.mjs` | Dev-only fixtures: register tickets, `/operation-transactions/paged`, `/operation-transactions/{id}/status`, a usable tank-gauging template. |
| `frontend/package.json` | `test:operation-entry-bulk` script. |

## 4. Verification

```bash
cd frontend
npm run test:operation-entry-bulk   # 62 checks: layout, assembly, validation, xlsx/csv round-trip
npm run smoke                       # 105 checks: every route + both bulk features, 0 runtime errors
npm run test:bulk                   # existing upload/export pipeline, unchanged
npm run test:bulk:ui                # existing upload/export dialogs, unchanged
npm run test:operation-entry-locations
npm run test:sender-receiver
npm run test:gauging-reports
npm run check:print-actions
```

Run them sequentially: the Vite dev server used by `smoke` and `test:bulk:ui` binds one HMR
port, so parallel runs report “Port 24678 is already in use”.

## 5. Try it with sample data

```bash
cd frontend
npm run mock-api      # http://127.0.0.1:8000
npm run dev:mock      # http://127.0.0.1:5173  (any username / password)
```

The mock seeds three register tickets (Draft, Submitted, Approved) and a tank-gauging
template whose asset `AGGE-TANK-1` has an active calibration table, so the whole flow —
download template, upload, import, then bulk-approve from the register — can be exercised
without PostgreSQL.
