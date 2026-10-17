# MaterialBalanceTemplateMaster

## Purpose
Configure, per location, the columns of the Material Balance Report from Tank Operations. No report column is
hard-coded: each template column is an Opening, Movement, Book Closing, Actual Closing, Loss/Gain, Information or
Formula column, and movement columns add up the Tank Operations mapped to them.

## File Locations
- **Frontend page:** `frontend/src/pages/MaterialBalanceTemplateMaster.jsx`
- **Dialogs / designer:** `frontend/src/components/materialBalance/` (`TemplateFormDialog`, `ColumnFormDialog`,
  `GenerateColumnsDialog`, `TemplateDesigner`)
- **Rules mirrored from the backend:** `frontend/src/utils/materialBalanceTemplate.js` (key normalisation, report
  usage, Book Closing treatment, column ordering, configuration checks, columns proposed from Tank Operations)
- **API Module:** `frontend/src/api/materialBalanceTemplateApi.js`
- **Backend Router:** `backend/app/routers/material_balance_templates.py` (prefix: `/material-balance-templates`)
- **Report logic:** `backend/app/services/material_balance_helpers.py`, `backend/app/routers/reports.py`
- **Models:** `MaterialBalanceTemplate`, `MaterialBalanceTemplateColumn`

## API Endpoints
| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/material-balance-templates` | List templates (no columns in the list response) |
| `GET` | `/material-balance-templates/{id}` | Template with its columns |
| `POST` | `/material-balance-templates` | Create template |
| `PUT` | `/material-balance-templates/{id}` | Update template |
| `DELETE` | `/material-balance-templates/{id}` | Delete template (its columns are deleted with it) |
| `POST` | `/material-balance-templates/{id}/columns` | Add a column |
| `PUT` | `/material-balance-templates/material-balance-template-columns/{column_id}` | Update a column |
| `DELETE` | `/material-balance-templates/material-balance-template-columns/{column_id}` | Delete a column |
| `GET` | `/tank-operations?location_code=…&status=Active` | Tank Operations offered for mapping |

## How the report uses a template
- Per location the report uses the **newest Active** template (highest id). The list shows **Used by report**,
  **Not used – newer template** or **Not used – inactive**; **Use for report** activates a template and
  deactivates newer active templates of the same location.
- OPENING = previous day's closing stock, or the day's Opening Stock entry.
- MOVEMENT = daily total of the mapped Tank Operations whose sign equals the column direction (IN / OUT / NEUTRAL);
  excluded codes are never counted in that column.
- Book Closing = opening + IN − OUT of movement columns that are **Counted in Book Closing**. Internal transfer
  (ITT) columns, and movement columns with MB = No and Book = No, remove their operations from Book Closing for
  the whole template.
- ACTUAL_CLOSING = the day's Closing Stock entry (or the last tank entry); LOSS_GAIN = actual − book closing;
  INFO / FORMULA show 0.

## Key Features
- **New Template** dialog: location, name, status, description and how to start – columns from Tank Operations,
  copy of an existing template, or empty. A location that already reports with another template starts the new
  template Inactive so the report is not broken while the columns are configured.
- **Columns from Tank Operations**: one reviewable table that proposes Opening Stock, one movement column per IN /
  OUT / NEUTRAL operation (ITT-looking operations pre-set as internal transfers), Book Closing, Closing Stock and
  Loss/Gain; labels and treatments can be changed before adding.
- **Designer** for the opened template: report column preview, Book Closing formula in words, configuration checks
  (operations not shown in any column, unknown or wrong-sign codes, missing standard columns, ITT clashes) with
  one-click fixes, ordered column list with move up / down, Edit and Delete.
- **Column dialog** in decision order: label (key follows the label), type, direction, Tank Operations to count /
  exclude, Book Closing treatment, position in the report, status, remarks.
- **Duplicate** a template, **Export Columns** in the bulk-upload layout, and **Bulk Upload** (one row per column;
  an existing column key is updated).

## Props
| Prop | Source |
|------|--------|
| `locations` | App.jsx |
| `loggedInUser` | App.jsx |

## Permissions
- **View:** View Material Balance Template (route guard, View Columns)
- **Create:** Create Material Balance Template (New Template, Duplicate)
- **Edit:** Edit Material Balance Template (edit template, Use for report, every column action)
- **Delete:** Delete Material Balance Template (delete template)
- Tank Operation lists and checks additionally need View Tank Operation; without it codes can be typed in.
