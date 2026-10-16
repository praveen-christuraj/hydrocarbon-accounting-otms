# Hydrocarbon Accounting – Frontend Design System

This file is the single source of truth for visual and interaction decisions in the frontend.
It exists so that every new page looks and behaves like the pages before it (see the
"Interface Design" and "UI UX Pro Max" skill principles referenced in `/CLAUDE.md`).
Read it before touching any UI code. Update it when a decision changes.

## 1. Brief

* Product: enterprise hydrocarbon accounting / terminal operations (tanks, vessels, barges,
  tankers, calibration, material balance, RBAC, audit).
* Audience: operators, supervisors, accountants, administrators working long sessions on
  desktop screens, often with dense tables.
* Primary job of the UI: let a trained user find, enter, verify and approve operational
  numbers quickly and without error.
* Owner's direction: **professional Navy Blue & White**, enterprise/business oriented,
  well-structured modules, **no unnecessary animation, no emojis**, Light & Dark themes,
  top navigation with dropdowns.

## 2. Aesthetic direction

"Control-room ledger": a quiet navy frame (top bar) around white working surfaces, strong
tabular typography, information conveyed by structure (borders, column alignment, status
chips) rather than decoration. The single memorable element is the deep navy top band with
the product mark; everything below it is calm, flat and precise.

Anti-patterns we deliberately avoid (they read as generic/generated UI):

* identical rounded cards with the same soft shadow everywhere;
* gradient washes, glassmorphism, hover "lift" transforms, fade-in-on-scroll;
* all-caps tracked eyebrow labels, "→" appended to links, middle-dot meta strings;
* emoji icons, colourful tile icons;
* bright "SaaS blue" (#2563eb) as the primary colour – we use navy.

## 3. Colour tokens

All colours are CSS custom properties defined in `src/index.css`. Light values live on
`:root`, dark values on `[data-theme="dark"]`. **Never hard-code a hex colour in a component
or in new CSS – always use a token.**

### Navy ramp (brand)

| Token | Light | Use |
|-------|-------|-----|
| `--navy-950` | `#07172e` | top bar in dark theme |
| `--navy-900` | `#0b2447` | top bar, table header, modal header |
| `--navy-800` | `#12315f` | primary button |
| `--navy-700` | `#1b3f7a` | primary button hover, active nav underline |
| `--navy-600` | `#255091` | focus ring, links (dark theme) |
| `--navy-500` | `#2f63b3` | links (light theme) |
| `--navy-300` | `#93b0dd` | secondary text on navy |
| `--navy-100` | `#e3ebf7` | selected row / soft highlight |
| `--navy-50`  | `#f2f6fc` | hover background |

### Semantic tokens (light → dark)

| Token | Light | Dark |
|-------|-------|------|
| `--bg` | `#f3f5f9` | `#0b1220` |
| `--surface` | `#ffffff` | `#121b2e` |
| `--surface-2` | `#f7f9fc` | `#182339` |
| `--surface-3` | `#eef2f7` | `#1f2b44` |
| `--border` | `#d8e0ea` | `#27354d` |
| `--border-strong` | `#b9c6d8` | `#3a4a66` |
| `--text` | `#0f1f3d` | `#e7edf6` |
| `--text-secondary` | `#2f3f5c` | `#c6d2e3` |
| `--text-muted` | `#5b6b85` | `#a3b2c8` |
| `--text-faint` | `#8a98ad` | `#7b8ba3` |
| `--text-inverse` | `#ffffff` | `#ffffff` |
| `--primary` | `#12315f` | `#4a7fd0` |
| `--primary-hover` | `#1b3f7a` | `#6594db` |
| `--primary-soft` | `#e8eff9` | `rgba(74,127,208,.18)` |
| `--link` | `#2f63b3` | `#8db2ea` |
| `--focus-ring` | `rgba(47,99,179,.35)` | `rgba(141,178,234,.45)` |
| `--success` / `--success-text` / `--success-soft` | `#1f7a4d` / `#166534` / `#e8f5ee` | `#3fbf7f` / `#7ee2ad` / `rgba(63,191,127,.16)` |
| `--warning` / `--warning-text` / `--warning-soft` | `#b36b00` / `#8a4b00` / `#fff4e0` | `#e0a030` / `#ffcc80` / `rgba(224,160,48,.16)` |
| `--danger` / `--danger-text` / `--danger-soft` | `#b42318` / `#9b1c12` / `#fdecea` | `#e5534b` / `#ff9b94` / `rgba(229,83,75,.16)` |
| `--info` / `--info-text` / `--info-soft` | `#1b4f9c` / `#1b4f9c` / `#e8f0fb` | `#6aa0e8` / `#a9c8f3` / `rgba(106,160,232,.16)` |

Print always uses the light palette (`@media print` re-declares the light tokens on `:root`).

## 4. Typography

* Family: **Inter Variable** (bundled via `@fontsource-variable/inter`), fallback
  `"Segoe UI", system-ui, Arial, sans-serif`. One family for everything; weight carries
  hierarchy.
* Numbers in tables use `font-variant-numeric: tabular-nums`.
* Scale (px / line-height / weight):
  * Page title `h2`: 20 / 1.3 / 600
  * Section title `h3`: 16 / 1.35 / 600
  * Body & tables: 14 / 1.45 / 400 (dense tables may use 13)
  * Labels: 13 / 1.3 / 500, normal case (never all-caps)
  * Helper / meta: 12 / 1.4 / 400, `--text-muted`
* Headings use `text-wrap: balance`. Loading states end with "…".

## 5. Shape, spacing, elevation

* Radius: controls 6 px, panels/cards 8 px, modals 10 px, chips 999 px.
* Control heights (compacted 2026-10-14): inputs/selects **34 px** (`--control-height`),
  buttons **32 px** (`--button-height`), compact buttons inside tables and toolbars
  **28 px** (`--button-height-compact`, used by `td button` and `.btn-sm`).
* Density: page shell padding 16/24 px (main content) and 16/20 px (page surface);
  `th` 8×10 px, `td` 7×10 px; `h2` 14 px below, `h3` 22 px above / 10 px below;
  `.page-title` 14 px below with a 12 px rule gap; `.section-title` 20 px above / 10 px below;
  top bar 52 px, top navigation row and nav links 40 px, footer 10 px vertical.
* Spacing scale: 4, 8, 12, 16, 20, 24, 32 px.
* Borders do the structural work (1 px `--border`). Shadows only on floating layers
  (dropdown menus, modals, toasts): `0 12px 32px rgba(7, 23, 46, .18)`.
* Page content is a white surface with a 1 px border, not a floating card.

## 6. Motion

* Only state feedback: colour / opacity / border transitions ≤ 150 ms with
  `cubic-bezier(.2,0,0,1)`. No transforms on hover, no entrance animations, no spinners that
  spin forever without a message.
* `prefers-reduced-motion: reduce` disables all transitions.

## 7. Components (all in `src/components/common` unless noted)

| Component | Purpose / rules |
|-----------|-----------------|
| `layout/AppShell` + `layout/TopNavigation` | Navy top bar (brand, theme switch, notifications, user menu) + white top navigation with dropdown menus (click or hover to open, Escape / outside click closes **menus**, arrow keys move). Active route is underlined in navy. |
| `FormDialog` | Create / edit form as a pop-up (owner rule 10). `open`, `title`, `submitLabel`, `busy`, `error`, `onDismissError`, `onSubmit`, `onCancel`; `size` sm/md/lg/xl, `columns` 1–3, `hideSubmit` for read-only dialogs. Built on `Modal`, so only Cancel/Close and the header X close it. New master-data pages open their form this way (header `New …` button + row Edit/Delete actions). |
| `PageHeader` | `title`, `description`, `count`, `actions` – the only page header pattern. |
| `AlertMessage` | Inline alert (`tone`: error / success / warning / info) placed **next to the section it concerns**. Dismissible. `role="alert"` for errors, `aria-live="polite"` otherwise. |
| `Toast` (`ToastProvider`, `useToast`) | Non-blocking pop-up notices (top-right). Use for cross-page/app-level messages; never `window.alert`. |
| `Modal` | Dialog with header, body, footer. **Backdrop click and Escape never close it** – only the Close/Cancel buttons (owner rule 10). Focus is trapped inside. |
| `ConfirmDialog` / `ConfirmProvider` (`useConfirm`) | Built on `Modal`; required for every destructive action. `const confirm = useConfirm()` then `if (!(await confirm({ title, message, details, tone: 'danger', confirmLabel: 'Delete', module: 'Page Name' }))) return`. Passing `module` logs Confirm/Cancel to the activity log. |
| `PaginationControls` | Page size 20 / 50 / 100 (global persisted preference via `usePageSize`), first/prev/next/last, jump-to-page. `paginateRows(rows, page, pageSize)`. |
| `DataFilterBar` + `hooks/useDataFilters` | Quick search over all columns, advanced condition builder (field / operator / value, match all or any), **separate** single-date filter and date-range filter. |
| `ExportMenu` | Export the current (filtered) rows to CSV, XLSX or PDF. Logs the action. |
| `ImportDialog` | Import rows from `.xlsx` / `.csv` with column mapping, preview, per-row results. Only for master data with a create API. |
| `DataTableToolbar` | Composes filter bar + export/import + record count for list pages. Props: `filters` (from `useDataFilters`), `columns`, `exportFileName`, `exportTitle`, `module`, optional `importConfig` (`{ title, description, fields:[{ key, label, required, options, defaultValue, hint, example }], validateRow(record) → string|null, onImportRow(record), onComplete(summary) }`), `canImport`, `extraActions`, `searchPlaceholder`. |
| `Icon` | Inline SVG icon set (stroke 1.75, 16/18/20 px). Decorative icons get `aria-hidden`. Icon-only buttons need `aria-label`. |
| `LocationScopeSelector` | Checkbox list used by User / Role Location Assignment. Props: `locations`, `selectedCodes`, `onToggle(code)`, `onSelectCodes(codes, checked)`, `onClear()`, `disabled`, `emptyMessage`, `footnote`. Owns its search box, the tri-state "select all (shown)" box, the live `n of m selected` count and the row order (name, then code, `Intl.Collator` with `numeric`). Rendered inside a page `<form>` – see the `form div` rule below. |


### List page recipe

```jsx
const pageSize = usePageSize()                       // 20 / 50 / 100, persisted
const [page, setPage] = useState(1)
const columns = useAutoColumns(rows, { exclude: ['password'], labels: {…}, types: { createdAt: 'date' } })
const filters = useDataFilters(rows, columns, { module: 'Page Name' })
const visible = paginateRows(filters.filteredRows, page, pageSize)

<DataTableToolbar filters={filters} columns={columns} exportFileName="users" exportTitle="User Master"
  module="User Master" importConfig={importConfig} canImport={canCreate} />
<table>… {filters.filteredRows.length === 0 ? emptyRow : visible.map(…)} …</table>
<PaginationControls currentPage={page} totalRows={filters.filteredRows.length} onPageChange={setPage} />
```

Server-paginated lists (e.g. Shuttle Tracking voyages) pass `pageSize` as the API `page_size`/`limit`
and `totalRows` from the server total. Lists capped by the API (users: 200 per call) are loaded in
chunks so filtering, paging and export work on the complete data set.

## 7b. Permissions in the UI

* The catalog (`backend/app/utils/default_permissions.py`, served by `GET /permissions/catalog`)
  is grouped into the 8 top-menu categories: **User Management, Master Data Management,
  Configurations, Operations, Operation Tracking, Export Operations, Reporting,
  Administration**. Every module exposes View / Create / Edit / Delete and, where a CRUD verb
  would be ambiguous, a named workflow action (`Close Movement Mapping`,
  `Approve Operation Transaction`, `Publish System Notification`, …).
* Pages read permissions with `usePermissions(loggedInUser)` (admins bypass every check):

  ```jsx
  const { hasPermission } = usePermissions(loggedInUser)
  const canCreate = hasPermission('Create Location')
  const canEdit = hasPermission('Edit Location')
  const canDelete = hasPermission('Delete Location')
  const readOnly = !canCreate && !canEdit && !canDelete
  ```

* Gate each control with **its own** action: `New …` header button → Create, row **Edit** → Edit,
  row **Delete** → Delete, workflow buttons → their named permission. Hide the Actions column
  when the user holds none of them, and show an `info-box` naming the permissions that are
  missing instead of leaving dead disabled buttons everywhere.
* Route guards (`PermissionGuard`) use the module's **View** permission.
* `PermissionMatrix` renders the Role Permission Assignment pop-up; `Access Summary` shows the
  effective access of all of a user's roles.

## 8. Forms & validation

* Every input has a `<label htmlFor>`; a group of checkboxes / radios is labelled by a
  `<span className="field-label" id>` plus `role="group"` (or `role="radiogroup"`) with
  `aria-labelledby`. Field errors render directly under the field with
  `className="field-error"` and the input gets `aria-invalid="true"`.
* Section-level errors (API failures) render in an `AlertMessage` directly above the form's
  action buttons.
* Submit buttons show a progress label ("Saving…") while a request is in flight.
* Primary action on the left of the action row; Cancel to its right (existing convention).
* Create / edit forms open in `FormDialog` (see §7). The form is only rendered when the user
  holds `Create X` (new record) or `Edit X` (existing record); the submit button repeats the
  check with `editId === null ? canCreate : canEdit`, and the handler guards it again because
  the API enforces the same permission.

### Two global rules that bite inside `<form>` (read before styling a form)

1. `form div { display:flex; flex-direction: column }` (index.css) matches **every** `div` in
   a page form. A row of controls inside a form must therefore set `flex-direction: row`
   itself, otherwise it renders as a vertically stacked, centre-aligned column (this is what
   made the old `.location-filter-bar` look broken: `align-items: center` + a `220px`
   `flex-basis` on the search input turned it into a tall centred stack).
2. `form button[type='submit']` / `form button[type='button']` outrank any single-class
   button rule (1 attribute + 2 type selectors). Ghost or icon buttons inside a form need a
   two-class selector, e.g. `form .location-scope .location-scope-search-clear`.

### Assignment modules

User / Role Location Assignment wrap their data entry in a module panel instead of loose
fields – `.assignment-panel` (border + `.assignment-panel-head` strip with the `h3` and a
`record-count` chip + `.assignment-panel-body`), then the usual `.section-title` +
`DataTableToolbar` + table + `PaginationControls`. Inside the panel:

* `.choice-row` / `.choice-option` – radio cards (Yes / No answers) with `is-selected`.
* `.location-scope` – the `LocationScopeSelector` panel: bordered box, `.location-scope-toolbar`
  (search with icon, tri-state "select all", "Clear all" ghost button, `n of m selected`
  count), `.location-scope-body` grid of `.location-option` rows (fixed 16 px checkbox column,
  ellipsised name, right-aligned mono code in `min-width: 64px`), `.location-scope-footer`
  summary. 2 columns ≥ 1100 px, 1 column below.
* `.assignment-readout` – dashed read-only companion field (what a role grants today).
* `.code-chip` / `.code-chip-list` – location-code chips in tables; `.cell-code` for a bare
  code in a cell; `.assignment-group-cell` + `rowSpan` merges the User / All Locations cells
  of a one-to-many assignment table.

## 9. Tables

* Navy header (`--navy-900`) with white text; 1 px row dividers; row hover `--navy-50`.
* Numbers right-aligned with tabular numerals (`class="num"`).
* Status chips via `.status-badge` (semantic soft background + text colour).
* Every table: `DataFilterBar` above, `PaginationControls` below, `ExportMenu` in the toolbar.

## 10. Accessibility floor

* Visible `:focus-visible` ring on every interactive element.
* Colour contrast ≥ 4.5:1 for text in both themes.
* `color-scheme` set per theme so native controls match.
* Dialogs: `role="dialog"`, `aria-modal`, labelled by their title.
* Dates and numbers are formatted with `Intl.*` helpers in `src/utils/format.js`.
