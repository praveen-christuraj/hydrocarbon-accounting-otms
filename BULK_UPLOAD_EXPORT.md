# Bulk Upload & Bulk Export

Every list page in the application now ships **bulk upload** and **bulk export** through one
shared pair of controls, so behaviour is identical everywhere.

| Capability | Formats |
| --- | --- |
| Bulk upload | `.xlsx` (Excel) **and** `.csv` — always both, everywhere an upload exists |
| Bulk export | `.xlsx`, `.csv`, `.pdf` — always all three, everywhere an export exists |

---

## 1. The building blocks

| File | Responsibility |
| --- | --- |
| `frontend/src/components/common/DataTableToolbar.jsx` | The single mount point. Renders `DataFilterBar`, the `ExportMenu` and (when allowed) the **Bulk Upload** button + `ImportDialog`. |
| `frontend/src/components/common/ExportMenu.jsx` | Dropdown with **Excel (.xlsx)**, **CSV** and **PDF**. |
| `frontend/src/components/common/ImportDialog.jsx` | Four-step wizard: choose file → map columns → preview → row-by-row result. |
| `frontend/src/utils/importUtils.js` | `parseImportFile`, `parseImportMatrix`, `autoMapColumns`, `parseCsvText`, `SUPPORTED_IMPORT_EXTENSIONS = ['.xlsx', '.csv']`. |
| `frontend/src/utils/exportUtils.js` | `rowsToCsv`, `exportRows` (xlsx via `exceljs`, pdf via `jspdf` + `jspdf-autotable`). CSV values starting with `= + - @` are prefixed with `'` to block spreadsheet formula injection. |
| `frontend/src/utils/importTemplateStore.js` | Layered, per-module upload templates persisted in `localStorage`. |
| `frontend/src/hooks/useBulkTemplates.js` | React binding for the template store. |

### Wiring a page

```jsx
<DataTableToolbar
  filters={filters}
  columns={filters.columns}
  exportFileName="location-master"
  exportTitle="Location Master"
  module="locations"                       // template namespace
  importConfig={importConfig}              // omit for read-only pages
  canImport={canCreate}                    // RBAC gate
/>
```

```js
const importConfig = {
  title: 'Bulk upload locations',
  description: 'Upload an Excel (.xlsx) or CSV file …',
  templateFileName: 'location-master-upload-template',
  fields: [
    { key: 'locationCode', label: 'Location Code', required: true, example: 'LOC-001',
      aliases: ['Code', 'Location'] },
  ],
  validateRow: (row) => (row.locationCode ? null : 'Location Code is required'), // never throw
  onImportRow: async (row) => { await createLocation(toPayload(row)) },
  onComplete: async () => { await reload() },
}
```

Use `onImportBatch(rows)` instead of `onImportRow` when the API takes the whole set at once or
when rows are sub-records of a parent (`BargeSealMaster`, `AssetCalibrationTable`,
`OperationTemplateMaster`, `MaterialBalanceTemplateMaster`). It may return
`[{ rowNumber, status: 'skipped' | 'failed', message }]` overrides.

---

## 2. Layered templates ("template masters")

Each page carries a safe **built-in system default** template, and admins can layer their own
variant on top without ever breaking the page:

1. **System default (built-in)** — always present, always listed first, cannot be deleted.
2. **User templates** — saved per module from inside the upload dialog: rename columns, change
   their order, switch optional columns off, and add aliases so a client's own headers map
   automatically.
3. **Reset to default** — restores the system template.

`applyTemplate` semantics:

- every **required** column is always kept;
- an optional column the template explicitly switches **off** is dropped;
- a column the template never mentions is appended at the end.

No new backend template master was added. Dynamic structures continue to use the existing,
user-configured **Calibration Template Master** (`/calibration-templates`) — on
**Asset Calibration Table** the upload dialog's template picker *is* that master, and switching
the template swaps the dynamic columns in the file layout.

---

## 3. Error surfacing (dynamic DB structures)

For pages backed by a dynamic or user-defined structure the user prepares their own file, so a
rejection has to be actionable:

- `validateRow` flags problems **before** anything is sent (unknown codes, duplicate keys,
  missing parents).
- Any error the DB/API returns is caught per row and shown against that row's number in the
  **results** step, together with a per-row status.
- Partial success is preserved: rows that succeeded are committed, failed rows are listed so the
  user can rectify the file and re-upload just those rows.

`AssetCalibrationTable` and `Table11FactorMaster` keep their positional/validating parsers —
they accept both `.xlsx` and `.csv` through `parseImportMatrix` and report duplicate-API and
validation errors row by row.

---

## 4. Page coverage

### Master Data Management

| Page | Upload | Export |
| --- | --- | --- |
| Location Master | yes | xlsx / csv / pdf |
| Asset Type Master | yes | xlsx / csv / pdf |
| Asset Master | yes | xlsx / csv / pdf |
| Prime Mover – Tanker Link | yes | xlsx / csv / pdf |
| Calibration Template Master | yes | xlsx / csv / pdf |
| Asset Calibration Table | yes (Calibration Template Master) | xlsx / csv / pdf |
| Asset Assignment | yes | xlsx / csv / pdf |
| Asset Assignment Summary | read-only | xlsx / csv / pdf (3 lists) |

### Configurations

| Page | Upload | Export |
| --- | --- | --- |
| Operation Type Master | yes | xlsx / csv / pdf |
| Tank Operation Master | yes | xlsx / csv / pdf |
| Vessel Operation Master | yes | xlsx / csv / pdf |
| Operation Template Master | yes (rows = template fields) | xlsx / csv / pdf |
| Operation Workflow Policy | yes | xlsx / csv / pdf |
| Location Operation Availability | yes | xlsx / csv / pdf |
| Table 11 Factor Master | yes (validating parser) | xlsx / csv / pdf |
| Company Report Profile Master | yes | xlsx / csv / pdf |
| Barge Seal Master | yes (bulk replace per barge) | xlsx / csv / pdf |
| Location Accounting Day Settings | yes | xlsx / csv / pdf |
| Material Balance Template | yes (rows = template columns) | xlsx / csv / pdf |
| Flowmeter Config Master | yes | xlsx / csv / pdf |

### Also completed (any other page with a create API)

Export Transactions, Export Permits, Export reference pages (Locations, Entities, Blocks,
Consignees, Settings), Permission Master, Role Master, User Master, System Notifications,
Role Permission Assignment, User Role Assignment, User Location Assignment, Audit Log,
plus every read-only summary / register / report page (export only).

Read-only pages — Access Summary, Tank Stock Ledger, OutTurn Report/Summary, Tank Operation
Summary, Tanker Tracking, Barge Tracking, Tanker Transaction Report, Material Balance Report,
Export Reports, Backup Recovery — get **export in all three formats**, with no upload button,
because there is no create API behind them.

### Operations

| Page | Upload | Export |
| --- | --- | --- |
| Operation Entry | **yes** – spreadsheet of complete tickets (metadata + template fields + asset payload), one Draft ticket per row | – |
| Operation Transaction Register | – (server-side paging) | CSV from the backend; **Export selected** (xlsx / csv / pdf) |

See `OPERATION_BULK_ENTRY_AND_BULK_ACTIONS.md` for the operation-entry upload layout, the
payload column convention and the register's bulk workflow actions.

Still outside this change: Operation Task Manager, Movement Mapping, Location Operation
Summary, Flowmeter Record Entry, FSO / Shuttle Tracking, Dashboard, Dashboard Builder and
Database Browser. Say the word and they get the same treatment.

---

## 5. Running it locally without PostgreSQL

```bash
cd frontend
npm install
npm run mock-api        # in-memory REST server on http://127.0.0.1:8000
npm run dev:mock        # Vite on 0.0.0.0:5173, proxies /api -> the mock server
```

`npm run mock-api` is a dev-only, dependency-free Node server (`frontend/scripts/mock-api.mjs`)
seeded with locations, asset types, assets, calibration templates and tables, barge seals,
Table 11 factors, users, roles, permissions, operation types/templates, and three register
tickets (Draft / Submitted / Approved) so the bulk upload and the register bulk actions can be
exercised end to end. It is never part of the production build.
`MOCK_API_TARGET` overrides the proxy target; `MOCK_API_PORT` overrides the mock port.

Production (`npm run dev`, `npm run build`, Docker) is untouched: the `/api` proxy is only
installed when `MOCK_API=1`.

---

## 6. Tests

```bash
npm run smoke                      # renders every route in happy-dom, asserts 0 runtime errors
npm run test:bulk                  # round-trips real .xlsx/.csv through the parser, mapper,
                                   # template store and the three exporters
npm run test:bulk:ui               # boots the mock API, renders the app and drives the controls
npm run test:operation-entry-bulk  # operation-entry spreadsheet ⇄ ticket engine
npx eslint src                     # lint
```

`npm run test:bulk:ui` currently asserts 53 checks, including that every upload dialog accepts
both `.xlsx` and `.csv`, that the layered template picker renders and swaps dynamic columns, and
that each export menu offers all three formats.

---

## 7. Government Data — Book Stock Management

All Book Stock list pages use `DataTableToolbar`, so both upload (`.xlsx` + `.csv`) and export
(`.xlsx` / `.csv` / `.pdf`) behave exactly like the rest of the application, including layered
upload templates and row-by-row error reporting.

| Page | Upload | Export |
| --- | --- | --- |
| Book Stock Products | yes (creates products) | xlsx / csv / pdf |
| Book Stock Fields | yes (one row per producing field) | xlsx / csv / pdf |
| Book Stock Daily Entries | yes (bulk-upload endpoint, partial success) | xlsx / csv / pdf |
| Block Stock Summary | read-only | xlsx / csv / pdf |
| Entity Stock Summary | read-only | xlsx / csv / pdf |
| Book Stock Dashboard | read-only | xlsx / csv / pdf |
| Export Operations (Book Stock) | read-only | xlsx / csv / pdf |

### Products upload

`product_code`, `product_name`, `unit`, `display_order`, `description`, `status`. The server keeps
the **two active products** rule: a row that would create a third active product is rejected for
that row only.

### Fields upload

`entity_code`, `block_code`, `field_code`, `field_name`, `product_codes` (comma separated, e.g.
`OIL,GAS`), `description`, `status`. The row is validated against the Export Operations
entity/block mapping and the active products before it is sent.

### Daily entries upload

One row per **stock date + entity + block + product**:

| Column | Notes |
| --- | --- |
| `entry_date` | `YYYY-MM-DD` |
| `entity_code`, `block_code` | Must be an active Export Operations mapping |
| `product_code` | Must be one of the two active products |
| `opening_stock` | Blank = auto-carry the previous day's closing for the same entity + block + product |
| `dispatch` | Block-level dispatch, zero or more |
| `adjustment` | Signed: negative deducts, positive adds |
| `field_productions` | `FIELD_CODE=QTY` pairs separated by `;` (e.g. `F1=120; F2=80`) |
| `remarks` | Free text |

Rows are saved through `POST /book-stock/daily-entries/bulk-upload`. A blank `opening_stock`
uses the same auto-carry rule as the entry form. Valid rows are committed even when other rows
fail; each failed row keeps the server's message (duplicate date + entity + block + product,
unknown/inactive product, field that does not produce the product, negative closing when
disabled in settings, …) so only those rows need correcting. Dispatch is always at block level;
field production lines are summed into the entry's production before the closing stock is
calculated: **Closing = Opening + Production − Dispatch + Adjustment**.

After a create, edit or delete, later entries whose opening was auto-carried are re-flowed
from the corrected closing stock, and each changed row is audited as *Recalculate Book Stock
Entry*. Rows whose opening was entered manually are left untouched and act as the new starting
point for the days that follow.
