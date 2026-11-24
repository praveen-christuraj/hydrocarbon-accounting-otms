# Material Balance Template — Multi-Operation Mapping Failure: Root Cause & Remediation Plan

**Date:** 2026-11-24
**Branch:** `arena/d9cfc11a-hydrocarbon-accounting-otms` (base `e98a2fabffc72c61b12377e8773688e9567d50c1`)
**Status:** `DRAFT — for owner review before coding. No source file was changed and no test suite was run for this study.`
**Scope:** Material Balance Template configuration + Material Balance Report (`/material-balance-report`), backend and frontend. **No database schema change.**
**Owner request:** Locations with two or more Tank Operations under the same Operation Category (`RECEIPT` / `DISPATCH`), with different codes and labels, are not reflected in the Material Balance Report. The same data appears correctly in Report Builder. Find the exact error and produce a remediation plan.

---

## 0. The exact error in place (read this first)

**There is no exception, no stack trace and no error message.** The report returns HTTP 200 with `0` in the affected movement columns, and the template designer reports **"Configuration check passed"**. The defect is a **silent canonicalisation mismatch** between the template write path and the report read path:

| Side | File | Lines | What it does to a Tank Operation code |
|---|---|---|---|
| **Write path** (saves the template) | `backend/app/routers/material_balance_templates.py` | `153-163` → `normalize_column_key()` at `59-73` | Trims, uppercases, **converts spaces / hyphens / slashes to underscores** |
| **Read path** (matches ledger rows) | `backend/app/services/material_balance_helpers.py` | `102-125` → `normalize_material_balance_code_value()` at `29-30` | **Only trims and uppercases** |

So for an operation code `RECEIPT-FROM-FSO`:

```
Template column stores:  "RECEIPT_FROM_FSO"
Ledger row contains:     "RECEIPT-FROM-FSO"
Comparison:              "RECEIPT-FROM-FSO" not in {"RECEIPT_FROM_FSO"}   →  False
```

`should_row_match_material_balance_column()` returns `False`, the movement is **not added to the column** and **not eligible for Book Closing**. The report shows `0`; Book Closing and Loss/Gain are wrong.

**Why only multi-operation locations fail:** a location with one `RECEIPT` and one `DISPATCH` operation normally uses the bare codes `RECEIPT` / `DISPATCH` (no separators), so both normalisers produce the same string and the report works. A location with two or more operations under the same category **must** use distinguishing codes such as `RECEIPT-01`, `RECEIPT FROM FSO`, `DISPATCH/REFINERY` — exactly the codes that trigger the mismatch. That is the entire correlation in the owner's report.

**Why Report Builder works:** the Report Builder starter templates group the Tank Stock Ledger by `tank_operation_label` / `tank_operation_category` (`backend/app/services/report_engine.py:1670-1710`), never by the template's `mapped_operation_codes`. It never performs the broken comparison, so every operation appears.

**Why the designer says "passed":** `analyzeTemplate()` (`frontend/src/utils/materialBalanceTemplate.js:519-665`) normalises **both** sides with `normalizeOperationCode()` — the exact frontend mirror of `normalize_column_key` — so it agrees with the write path and cannot see the backend read-path mismatch. The designer is not lying about its own model; it is using a different model from the report.

**Primary fix (Phase 1):** make the read path use the same canonical form as the write path. One new function, three call sites, no schema change, no data migration. Existing templates start working immediately.

---

## 1. Symptom as reported

| Observation | Explanation |
|---|---|
| Works at locations with a single `RECEIPT` and a single `DISPATCH` operation | Codes are normally `RECEIPT` / `DISPATCH`, no separators → both normalisers agree |
| Fails at locations with 2+ operations per category, different codes & labels | Codes need separators (`-`, space, `/`) to be distinct → write/read normalisers disagree |
| Report Builder shows the data | Groups by label/category, not by template mapping |
| Material Balance Report shows 0 / wrong Book Closing / inflated Loss-Gain | `should_row_match_material_balance_column()` returns `False` |
| No error in the UI or logs | The failure is a boolean `False`, not an exception |
| Designer says "Configuration check passed" | `analyzeTemplate()` normalises both sides with the write-path normaliser |

### 1.1 What the user actually sees

For a location with `RECEIPT` and `RECEIPT-FROM-FSO` (both `IN`) and `DISPATCH` and `DISPATCH-TO-REFINERY` (both `OUT`), on a day with opening 100, receipts 10 and 20, dispatches 5 and 7, closing 118:

| Value | Before fix | After fix |
|---|---|---|
| `Receipt` column | 10 | 10 |
| `Receipt From FSO` column | **0** | 20 |
| `Dispatch` column | 5 | 5 |
| `Dispatch To Refinery` column | **0** | 7 |
| Book Closing | **105** | 118 |
| Actual Closing | 118 | 118 |
| Loss/Gain | **+13** | 0 |

The report's `Rows` count is **non-zero** (the ledger rows exist), but the movement cells are `0`. That combination — `rows_count > 0` with zero movements — is the tell-tale signature of an unmapped operation. The summary cards `Total IN` / `Total OUT` are also understated.

---

## 2. Exact reproduction trace

```
Tank Operation Master
  operation_code = "RECEIPT-FROM-FSO"
  (normalize_code = trim + upper → separators preserved)
        │
        ▼
Operation Entry (Tank Gauging layout)
  payload.inputs.tankOperationCode = "RECEIPT-FROM-FSO"
        │
        ▼
Approval → TankStockLedger
  tank_operation_code = "RECEIPT-FROM-FSO"
        │
        ▼
Material Balance Template → "Columns from Tank Operations"
  proposeColumns()  [frontend/src/utils/materialBalanceTemplate.js:452-466]
    const code = normalizeOperationCode("RECEIPT-FROM-FSO")   → "RECEIPT_FROM_FSO"
    mappedOperationCodes: [code]                              → ["RECEIPT_FROM_FSO"]
        │
        ▼
POST /material-balance-templates/{id}/columns
  validate_material_balance_template_column_payload()
    [backend/app/routers/material_balance_templates.py:153-163]
    mapped_operation_codes = [normalize_column_key("RECEIPT_FROM_FSO")]
                           = ["RECEIPT_FROM_FSO"]
        │
        ▼
DB: material_balance_template_columns.mapped_operation_codes = ["RECEIPT_FROM_FSO"]
        │
        ▼
GET /reports/material-balance-report
  should_row_match_material_balance_column()
    [backend/app/services/material_balance_helpers.py:102-125]
    row_operation_code     = normalize_material_balance_code_value("RECEIPT-FROM-FSO")
                           = "RECEIPT-FROM-FSO"          ← trim + upper only
    mapped_operation_codes = {"RECEIPT_FROM_FSO"}         ← stored canonical form
    "RECEIPT-FROM-FSO" not in {"RECEIPT_FROM_FSO"}        → False
        │
        ▼
  values[column_key] = 0
  calculate_book_closing_from_eligible_ledger_rows()      → row skipped
        │
        ▼
Report: column = 0, Book Closing wrong, Loss/Gain inflated
```

Designer check at the same time:

```
analyzeTemplate()  [frontend/src/utils/materialBalanceTemplate.js:519-665]
  byCode = Map(normalizeOperationCode("RECEIPT-FROM-FSO") → operation)
         = Map("RECEIPT_FROM_FSO" → operation)
  byCode.get(normalizeOperationCode("RECEIPT_FROM_FSO"))  → found
  mapped.add("RECEIPT_FROM_FSO|IN")
  notInReport → none
  → "Configuration check passed"
```

The designer is using the write-path normaliser on both sides; the report is using a different normaliser on the row side. The two never meet.

---

## 3. Blast radius — every consumer of the broken comparison

| Consumer | File:lines | Effect |
|---|---|---|
| Per-tank report rows | `backend/app/routers/tank_stock_ledger.py:946` | Movement column = 0 |
| Per-tank Book Closing | `backend/app/routers/tank_stock_ledger.py:959` → `material_balance_helpers.py:190-223` | Missing movement excluded from Book Closing |
| Location consolidation | `backend/app/routers/tank_stock_ledger.py:1058-1216` | Recomputes Book Closing from the already-zero column values; wrong at location level too |
| ITT exclusion | `material_balance_helpers.py:128-153` | ITT codes with separators are not recognised as internal |
| Book Closing eligibility | `material_balance_helpers.py:155-188` | Rows with separator codes are skipped |
| Report endpoint | `backend/app/routers/reports.py:1471-1560` | Returns 200 with zeros, no coverage signal |

**Not affected — do not change:**

- **Report Builder** — `report_engine.py` starter templates group by `tank_operation_label` / `tank_operation_category`.
- **OutTurn Report** — label/category based.
- **Stock Anomaly Analytics** — `stock_anomaly_service.py` aggregates by sign.
- **Tank Stock Ledger summary / daily summary** — sign based.
- **FSO Material Balance** — vessel operations, separate model.

---

## 4. Rule these out first (other causes of the same symptom)

Before assuming the canonicalisation bug, check the following. The audit script in Appendix A reports each of them separately.

| # | Check | How to recognise | Fix |
|---|---|---|---|
| 4.1 | **Wrong template** — the location has a newer Active template than the one being edited | Designer shows **"Not used – newer template"**; report uses the newest Active template (`get_active_material_balance_template_for_location`, `material_balance_helpers.py:33-54`) | Open the template marked **Used by report**; use **Use for report** if needed |
| 4.2 | **Real mapping gap** — the operation is not mapped to any column | Designer shows **"Tank Operations not shown in any column"** | Use **Columns from Tank Operations** or the one-click **Add columns** |
| 4.3 | **Label stored as the code** — the template maps the label (e.g. `Receipt From FSO`) instead of the code (e.g. `RECEIPT-FROM-FSO`), common after a bulk upload | Designer shows **"unknown-operation"** warning | Edit the column and tick the operation by its code |
| 4.4 | **Legacy ledger code is the label** — the ledger row stores a label, not a code | Audit script `unmapped_ledger_rows` shows a code that looks like a label | Repair script (optional) re-resolves from `tankOperationId` / label |
| 4.5 | **Date / status / tank filter** — the rows are outside the selected window or status | `rows_count == 0` | Adjust filters |
| 4.6 | **Column is "Shown only" / "Internal transfer"** — displayed but not counted by design | Designer shows the role | Change the Book Closing treatment |
| 4.7 | **NEUTRAL operation** — never changes Book Closing by design | Operation sign is `NEUTRAL` | Expected behaviour |
| 4.8 | **Canonical collision** — two operations' codes normalise to the same string (`RCPT-1` vs `RCPT_1`) | Audit script `canonical_collisions` | Rename one operation (Phase 3 adds a save-time check) |

If none of 4.1–4.8 applies and the code contains a space, hyphen, slash or parenthesis, it is the canonicalisation defect described in Section 0.

### 4.9 Quick two-minute confirmation

1. Open **Material Balance Template Configuration** → the affected location → the template marked **Used by report**.
2. Look at a MOVEMENT column's mapping chips. If the chip shows `RECEIPT_FROM_FSO` while **Tank Operation Master** shows `RECEIPT-FROM-FSO`, the write path has canonicalised the code — this is the bug.
3. Open **Material Balance Report** for the same location and a date range with known tickets. `Rows` is non-zero but the movement column is `0`.
4. Open **Report Builder → Tank Stock Ledger → Daily Movements** for the same date range. The same ticket appears under `RECEIPT-FROM-FSO`.

Steps 2 + 3 + 4 together are conclusive.

---

## 5. Remediation plan

### Phase 0 — Read-only audit on the real database (no code change)

**Goal:** prove the diagnosis on the owner's data and size the impact before changing anything.

Add `backend/scripts/audit_material_balance_coverage.py` (read-only; full source in **Appendix A**). It prints:

1. **Template mappings** — every active `MOVEMENT` column, its stored mapped/excluded codes, the canonical form, and the active Tank Operations that canonicalise to it (`ok` / `ambiguous` / `unknown`).
2. **Unmapped operations** — active `IN`/`OUT` operations of each location that are not covered by any active column of the location's active template(s).
3. **Unmapped ledger rows** — rows in the requested date range whose canonical `tank_operation_code` is not covered (count and sample tickets).
4. **Canonical collisions** — operation codes of the same location that canonicalise identically.

**Exit criteria:** the affected locations show at least one `unknown` / `unmapped` entry whose raw code contains a space, hyphen, slash or parenthesis; the unmapped ledger rows match the tickets the owner sees missing in Report Builder.

**Command (after approval):**

```bash
cd backend
python -m scripts.audit_material_balance_coverage \
  --date-from 2026-11-01 --date-to 2026-11-24 \
  --json /tmp/mb-coverage.json
```

---

### Phase 1 — Backend hotfix: one canonical form on both sides (the actual fix)

**Goal:** make the report match what the template stored, without touching the database or the frontend.

#### 1.1 Add the canonical operation-code normaliser

`backend/app/services/material_balance_helpers.py` (near `normalize_material_balance_code_value`, line 29):

```python
def normalize_operation_code(value: str | None) -> str:
    """Canonical form of a Tank Operation code.

    Must stay byte-for-byte identical to normalize_column_key() in
    app.routers.material_balance_templates and normalizeOperationCode() in
    frontend/src/utils/materialBalanceTemplate.js, because template columns
    store mapped/excluded operation codes through that function.

    Tank Operation codes are free text (spaces, hyphens, slashes, parentheses
    are all allowed by Tank Operation Master), while the ledger stores the raw
    code. Both sides must be canonicalised with this function before comparing.
    """
    text = str(value or "").strip().lower()
    if not text:
        return ""
    text = text.replace(" ", "_").replace("-", "_").replace("/", "_")
    while "__" in text:
        text = text.replace("__", "_")
    return text.upper()
```

#### 1.2 Make `normalize_column_key` delegate to it (single source of truth)

`backend/app/routers/material_balance_templates.py:59-73`:

```python
from app.services.material_balance_helpers import normalize_operation_code

def normalize_column_key(value: str):
    return normalize_operation_code(value)
```

Behaviour is unchanged for column keys; the two domains now share one implementation. `material_balance_templates.py` already imports several functions from `material_balance_helpers.py`, so there is no new import cycle.

#### 1.3 Use it for every operation-code comparison

`backend/app/services/material_balance_helpers.py`:

```python
def should_row_match_material_balance_column(row, column):
    if normalize_material_balance_code_value(column.column_type) != "MOVEMENT":
        return False
    row_operation_code = normalize_operation_code(row.tank_operation_code)      # changed
    row_sign = normalize_material_balance_code_value(row.tank_operation_sign)
    column_direction = normalize_material_balance_code_value(column.movement_direction)
    mapped_operation_codes = {
        normalize_operation_code(code)                                          # changed
        for code in (column.mapped_operation_codes or [])
    }
    excluded_operation_codes = {
        normalize_operation_code(code)                                          # changed
        for code in (column.excluded_operation_codes or [])
    }
    if row_operation_code in excluded_operation_codes:
        return False
    if mapped_operation_codes and row_operation_code not in mapped_operation_codes:
        return False
    if column_direction and row_sign != column_direction:
        return False
    return True


def get_global_internal_transfer_operation_codes(columns):
    internal_codes = set()
    for column in columns:
        ...
        if is_internal_transfer:
            for code in column.mapped_operation_codes or []:
                internal_codes.add(normalize_operation_code(code))              # changed
        if (column_type == "MOVEMENT" and not include_in_material_balance
                and not include_in_book_closing):
            for code in column.mapped_operation_codes or []:
                internal_codes.add(normalize_operation_code(code))              # changed
    return internal_codes


def should_row_be_in_book_closing_formula(row, columns, global_internal_transfer_codes):
    row_operation_code = normalize_operation_code(row.tank_operation_code)      # changed
    row_sign = normalize_material_balance_code_value(row.tank_operation_sign)
    ...
```

`normalize_material_balance_code_value()` **stays** for tokens: `column_type`, `movement_direction`, `tank_operation_sign`, `include_in_*`, `is_internal_transfer`, `unit`. Those are fixed enums and must not be separator-normalised.

#### 1.4 Why all three functions must change together

If only `should_row_match_material_balance_column()` is fixed, a separator-coded ITT operation that is also mapped in a counted column would start matching the counted column while the ITT exclusion set still fails to recognise it — turning a silent zero into a **double count**. The three functions are one contract; change them atomically.

#### 1.5 Expected result

| Before | After |
|---|---|
| `RECEIPT-FROM-FSO` column = 0 | column = actual quantity |
| Book Closing excludes the movement | Book Closing includes it |
| Loss/Gain inflated | Loss/Gain reconciles |
| ITT with separator code not excluded | excluded correctly |
| Designer "passed" but report wrong | designer and report agree |

No schema change, no migration, no frontend change required for the data to appear.

---

### Phase 2 — Write-path hardening (optional, recommended after Phase 1 is verified)

**Goal:** store the **raw** Tank Operation code in `mapped_operation_codes` / `excluded_operation_codes`, so the UI, exports and API show the real code (`RECEIPT-FROM-FSO`) instead of the canonical form (`RECEIPT_FROM_FSO`), and so canonical collisions cannot silently merge two operations.

#### 2.1 Change the write path

`material_balance_templates.py:153-163`:

```python
mapped_operation_codes = [
    clean_optional_text(item).upper()
    for item in (column.mapped_operation_codes or [])
    if clean_optional_text(item)
]
excluded_operation_codes = [
    clean_optional_text(item).upper()
    for item in (column.excluded_operation_codes or [])
    if clean_optional_text(item)
]
```

The matcher already canonicalises both sides after Phase 1, so raw storage is safe.

#### 2.2 Change the frontend proposal to send raw codes

`frontend/src/utils/materialBalanceTemplate.js:452-466`:

```js
const code = operation.operationCode            // raw, e.g. "RECEIPT-FROM-FSO"
...
columnKey: existing ? suggestColumnKey(code) : uniqueKey(suggestColumnKey(code), usedKeys),
mappedOperationCodes: [code],
```

`analyzeTemplate()` already normalises both sides for comparison; no change needed there.

#### 2.3 Data repair (dry-run by default)

`backend/scripts/repair_material_balance_template_codes.py` (full source in **Appendix B**):

- For each active template column, for each stored mapped/excluded code:
  - find active Tank Operations of the template's location whose canonical code equals the stored code;
  - exactly one → replace the stored code with the operation's raw code;
  - multiple → report as ambiguous, do not change;
  - none → report as orphan, do not change.
- `--apply` writes through the ORM and writes an audit row per changed column (`create_audit_log`, module `Material Balance Template`, action `Repair Material Balance Template Column Codes`).
- Without `--apply` it only prints the plan.

#### 2.4 Compatibility

- Existing API consumers that expect canonical codes will now receive raw codes. This is an internal app; the only consumer is the template UI, which normalises for comparison. Acceptable.
- The report matcher is indifferent (canonicalises both sides).
- Rollback: re-run the repair with a `--normalise` mode (canonicalise stored codes), or revert the write path; the report keeps working because the matcher canonicalises both sides.

---

### Phase 3 — Guardrails and observability (prevents recurrence)

#### 3.1 Report coverage field

`backend/app/schemas.py`:

```python
class MaterialBalanceCoverageOperation(BaseModel):
    operation_code: str
    operation_label: str
    operation_category: Optional[str] = None
    operation_sign: Optional[str] = None


class MaterialBalanceCoverageResponse(BaseModel):
    unmapped_operations: list[MaterialBalanceCoverageOperation] = []
    unmapped_ledger_rows_count: int = 0
```

Add to `MaterialBalanceDynamicReportResponse` (line 1571):

```python
coverage: Optional[MaterialBalanceCoverageResponse] = None
```

`backend/app/routers/reports.py` (inside `get_material_balance_report`, after `ledger_rows` and `columns` are loaded):

```python
coverage = build_material_balance_coverage(
    db=db,
    location_code=cleaned_location_code,
    columns=columns,
    ledger_rows=ledger_rows,
    date_from_value=date_from_value,
    date_to_value=date_to_value,
)
...
return {..., "coverage": coverage}
```

`build_material_balance_coverage()` (new helper in `material_balance_helpers.py`; add `TankOperation` to the existing `app.models` import at the top of that file):

```python
def build_material_balance_coverage(db, location_code, columns, ledger_rows,
                                    date_from_value, date_to_value):
    active_operations = db.query(TankOperation).filter(
        TankOperation.location_code.ilike(location_code),
        TankOperation.status == "Active",
    ).all()

    mapped = set()
    for column in columns:
        if normalize_material_balance_code_value(column.column_type) != "MOVEMENT":
            continue
        excluded = {
            normalize_operation_code(code)
            for code in (column.excluded_operation_codes or [])
        }
        for code in (column.mapped_operation_codes or []):
            canonical = normalize_operation_code(code)
            if canonical not in excluded:
                mapped.add(canonical)

    unmapped_operations = [
        {
            "operation_code": op.operation_code,
            "operation_label": op.operation_label,
            "operation_category": op.operation_category,
            "operation_sign": op.operation_sign,
        }
        for op in active_operations
        if str(op.operation_sign or "").upper() in ("IN", "OUT")
        and normalize_operation_code(op.operation_code) not in mapped
    ]

    unmapped_rows = [
        row for row in ledger_rows
        if row.accounting_date is not None
        and date_from_value <= row.accounting_date <= date_to_value
        and str(row.tank_operation_sign or "").upper() in ("IN", "OUT")
        and normalize_operation_code(row.tank_operation_code) not in mapped
    ]

    return {
        "unmapped_operations": unmapped_operations,
        "unmapped_ledger_rows_count": len(unmapped_rows),
    }
```

#### 3.2 Frontend warning

`frontend/src/api/materialBalanceReportApi.js`:

```js
coverage: data?.coverage
  ? {
      unmappedOperations: (data.coverage.unmapped_operations || []).map((op) => ({
        operationCode: op.operation_code || '',
        operationLabel: op.operation_label || '',
        operationCategory: op.operation_category || '',
        operationSign: op.operation_sign || '',
      })),
      unmappedLedgerRowsCount: Number(data.coverage.unmapped_ledger_rows_count || 0),
    }
  : null,
```

`frontend/src/pages/MaterialBalanceReport.jsx` — after the "Active Template" info box:

```jsx
{coverage?.unmappedOperations?.length > 0 && (
  <AlertMessage tone="warning">
    <span>
      {coverage.unmappedOperations.length} Tank Operation
      {coverage.unmappedOperations.length === 1 ? '' : 's'} of {filters.locationCode}{' '}
      {coverage.unmappedOperations.length === 1 ? 'is' : 'are'} not mapped to any column of the
      active Material Balance Template and {coverage.unmappedOperations.length === 1 ? 'is' : 'are'}{' '}
      excluded from this report and from Book Closing:{' '}
      {coverage.unmappedOperations
        .map((op) => `${op.operationLabel || op.operationCode} (${op.operationSign})`)
        .join(', ')}.
      {coverage.unmappedLedgerRowsCount > 0 &&
        ` ${coverage.unmappedLedgerRowsCount} ledger row(s) in this period are affected.`}
    </span>
  </AlertMessage>
)}
```

This makes the exact failure visible on the report page instead of silently showing 0.

#### 3.3 Save-time validation

`material_balance_templates.py`: add a helper and call it in both column create and update, after `validate_material_balance_template_column_payload()`:

```python
def validate_operation_codes_for_template(db, template, mapped_codes, excluded_codes):
    operations = (
        db.query(TankOperation)
        .filter(
            TankOperation.location_code.ilike(template.location_code),
            TankOperation.status == "Active",
        )
        .all()
    )
    by_canonical = {}
    for op in operations:
        by_canonical.setdefault(normalize_operation_code(op.operation_code), []).append(op)

    unknown = []
    ambiguous = []
    for code in [*mapped_codes, *excluded_codes]:
        canonical = normalize_operation_code(code)
        matches = by_canonical.get(canonical, [])
        if not matches:
            unknown.append(code)
        elif len(matches) > 1:
            ambiguous.append(f"{code} -> {', '.join(m.operation_code for m in matches)}")

    if unknown:
        raise HTTPException(
            status_code=400,
            detail=(
                "Mapped Tank Operation(s) not found for this location: "
                + ", ".join(unknown)
                + ". Create them in Tank Operation Master first, or remove them from the column."
            ),
        )
    if ambiguous:
        raise HTTPException(
            status_code=400,
            detail=(
                "Mapped Tank Operation code(s) match more than one operation of this location: "
                + "; ".join(ambiguous)
                + ". Rename the operations so their codes differ after normalisation."
            ),
        )
```

Call sites:

- `create_material_balance_template_column()` after `validated = validate_...`
- `update_material_balance_template_column()` after `validated = validate_...`

Add the same two checks to `analyzeTemplate()` as `unknown-operation` (already exists) and a new `ambiguous-operation` error.

#### 3.4 Template designer: canonical-collision and repair hints

`frontend/src/utils/materialBalanceTemplate.js` `analyzeTemplate()`:

- Build `byCanonical` and detect operations of the same location whose codes canonicalise identically → new check `canonical-collision` (error) listing them.
- If a stored mapped code canonicalises to an operation but the stored text differs from the raw code → new check `normalised-mapping` (info) with a one-click **Repair mapping** that re-saves the column with the raw codes.

`TemplateDesigner.jsx`: render the new checks like the existing ones.

#### 3.5 Optional: expose mapped codes on the report header

Add `mapped_operation_codes` to `MaterialBalanceDynamicColumnResponse` and `build_dynamic_material_balance_columns_response()`, then show it as a tooltip under the column header in `MaterialBalanceReport.jsx` ("Counts: RECEIPT, RECEIPT-FROM-FSO"). This lets the user verify the mapping without leaving the report.

---

### Phase 4 — Tests (to be written after approval; not executed in this study)

#### 4.1 Backend (`backend/tests/test_material_balance_report.py` or a new `test_material_balance_multi_operation.py`)

| Test | Setup | Asserts |
|---|---|---|
| `test_multi_operation_per_category_is_fully_reflected` | Location with `RECEIPT`, `RECEIPT-02` (IN) and `DISPATCH`, `DISPATCH-02` (OUT); one column per operation; ledger rows for all four | Each column equals its own quantity; Book Closing = opening + both receipts − both dispatches; Loss/Gain = 0 |
| `test_operation_code_with_space_hyphen_slash_and_parentheses_matches` | Codes `RECEIPT FROM FSO`, `RECEIPT-02`, `DISPATCH/REFINERY`, `RECEIPT (FSO)` | Each row lands in its column; no zero columns |
| `test_excluded_operation_code_is_not_counted` | Column maps `RECEIPT-01, RECEIPT-02`, excludes `RECEIPT-02` | Column = `RECEIPT-01` only; Book Closing includes only `RECEIPT-01` |
| `test_internal_transfer_code_is_excluded_even_when_clashed` | Internal column maps `ITT-IN`; counted column also maps `ITT-IN` (clash) | `ITT-IN` is excluded from Book Closing; counted column shows 0; no double count |
| `test_book_closing_matches_tank_and_location_consolidation` | Two tanks, two operations per category | Per-tank and consolidated rows reconcile |
| `test_report_coverage_lists_unmapped_operations` | Template maps only `RECEIPT`; location also has `RECEIPT-02` | `coverage.unmapped_operations` contains `RECEIPT-02`; `unmapped_ledger_rows_count` > 0 |
| `test_column_with_unknown_operation_code_is_rejected` | POST column with mapped code `DOES-NOT-EXIST` | 400 with a clear message |
| `test_column_with_ambiguous_operation_code_is_rejected` | Operations `RCPT-1` and `RCPT_1`; column maps `RCPT_1` | 400 naming both operations |
| `test_template_save_and_report_round_trip` | Save via API, then run the report with separator codes | Values match |

#### 4.2 Frontend (`frontend/scripts/test-material-balance-template.mjs`)

- `proposeColumns()` proposes one column per operation and maps the raw code for separator codes.
- `analyzeTemplate()` reports no false "operations-not-in-report" when the backend matcher would match.
- `analyzeTemplate()` reports `canonical-collision` for `RCPT-1` / `RCPT_1`.
- `MaterialBalanceReport.jsx` renders the coverage warning when the API returns unmapped operations.

#### 4.3 Regression (existing suites, after approval)

- `backend/tests/test_material_balance_report.py`
- `backend/tests/test_gauging_payload_accounting_reports.py`
- `backend/tests/test_rbac_hardening.py`
- `npm run smoke` (renders `/material-balance-report`)

---

### Phase 5 — Rollout and verification

1. **Deploy Phase 1** (backend only). No template changes, no migration.
2. **Re-run the audit script.** Every previously unmapped separator code should now be `ok`; the unmapped ledger row count should drop to only genuinely unmapped operations.
3. **Verify with the owner's affected locations:**
   - Open Material Balance Report for the location and date range.
   - Confirm the previously missing receipt/dispatch quantities appear.
   - Confirm Book Closing and Loss/Gain reconcile with Actual Closing.
   - Compare with Report Builder's Tank Stock Ledger daily movements (same date range, same tank).
   - Open the template designer and confirm the configuration check still passes.
4. **Deploy Phase 3** (coverage warning + save validation). Existing templates are unaffected; the warning appears only for genuinely unmapped operations.
5. **Optional Phase 2** (raw-code storage + repair) after the owner confirms the display benefit. Run the repair in dry-run first, review the ambiguous/orphan list, then `--apply`.
6. **Documentation:** update `Manuals/pages/38_MaterialBalanceReport.md`, `Manuals/pages/39_MaterialBalanceTemplateMaster.md`, and add a "Recent Fixes" entry to `CLAUDE.md`.
7. **Communication:** tell users that (a) separator-coded operations now work with no template change, (b) a new warning will name any operation that is still not mapped, (c) if a template intentionally omits an operation, the warning is expected and can be ignored or the operation mapped as "Shown only".
8. **Post-implementation:** run `graphify update .` (CLAUDE.md graph rule) so the knowledge graph reflects the changed functions.

---

## 6. File-by-file change map

| File | Phase | Change | Risk |
|---|---|---|---|
| `backend/app/services/material_balance_helpers.py` | 1 | Add `normalize_operation_code`; use it in the 3 comparison functions; add `build_material_balance_coverage` (Phase 3) | Low |
| `backend/app/routers/material_balance_templates.py` | 1, 2, 3 | Delegate `normalize_column_key`; store raw codes (Phase 2); add save-time validation (Phase 3); clean dead imports | Low–medium (Phase 2 changes stored values) |
| `backend/app/routers/tank_stock_ledger.py` | — | No direct change; calls the fixed helpers | None |
| `backend/app/routers/reports.py` | 3 | Compute and return `coverage` | Low |
| `backend/app/schemas.py` | 3 | Add coverage models and field | Low |
| `backend/scripts/audit_material_balance_coverage.py` | 0 | New read-only audit script | None |
| `backend/scripts/repair_material_balance_template_codes.py` | 2 | New dry-run-by-default repair script | Medium (writes only with `--apply`) |
| `frontend/src/utils/materialBalanceTemplate.js` | 2, 3 | Send raw codes; add collision/normalised-mapping checks | Low |
| `frontend/src/api/materialBalanceReportApi.js` | 3 | Convert `coverage` | Low |
| `frontend/src/pages/MaterialBalanceReport.jsx` | 3 | Render coverage warning | Low |
| `frontend/src/components/materialBalance/TemplateDesigner.jsx` | 3 | Render new checks | Low |
| `Manuals/pages/38_MaterialBalanceReport.md` | 5 | Document coverage warning and matching rule | None |
| `Manuals/pages/39_MaterialBalanceTemplateMaster.md` | 5 | Document raw-code storage and validation | None |
| `CLAUDE.md` | 5 | Recent Fixes entry | None |

---

## 7. Test plan (detail)

### 7.1 Backend unit tests

Use the existing `db` fixture pattern (`backend/tests/conftest.py`) and `SimpleNamespace` rows like `test_material_balance_report.py`.

**Test A — multi-operation per category (the owner's exact case)**

```python
def test_multi_operation_per_category_is_fully_reflected(db):
    # Tank operations: RECEIPT + RECEIPT-02 (IN), DISPATCH + DISPATCH-02 (OUT)
    # Template: one MOVEMENT column per operation + OPENING/BOOK/ACTUAL/LOSS
    # Ledger: opening 100; +10; +20; -5; -7; closing 118
    # Assert: RECEIPT=10, RECEIPT_02=20, DISPATCH=5, DISPATCH_02=7,
    #         BOOK=118, ACTUAL=118, LOSS_GAIN=0
```

**Test B — separator variants**

```python
@pytest.mark.parametrize("code", [
    "RECEIPT FROM FSO",
    "RECEIPT-FROM-FSO",
    "RECEIPT/FROM/FSO",
    "RECEIPT (FSO)",
])
def test_operation_code_with_separators_matches_its_column(db, code):
    # one operation with this code, one column mapped to it, one ledger row
    # assert the column value equals the row's movement
```

**Test C — excluded codes**

```python
def test_excluded_operation_code_is_not_counted(db):
    # column maps ["RECEIPT-01", "RECEIPT-02"], excludes ["RECEIPT-02"]
    # rows +10 and +20 → column 10, book closing +10
```

**Test D — ITT clash**

```python
def test_internal_transfer_code_is_excluded_even_when_clashed(db):
    # ITT-IN mapped in an internal column and in a counted column
    # row +5 → counted column 0, book closing excludes 5
```

**Test E — coverage**

```python
def test_report_coverage_names_unmapped_operations(client, db):
    # template maps RECEIPT only; location also has RECEIPT-02
    # GET /reports/material-balance-report → coverage.unmapped_operations == [RECEIPT-02]
```

**Test F — save validation**

```python
def test_column_with_unknown_operation_code_is_rejected(client, db):
    # POST column mapped ["DOES-NOT-EXIST"] → 400
```

### 7.2 Frontend tests

Add `frontend/scripts/test-material-balance-template.mjs` (pure logic, no browser) covering `proposeColumns`, `analyzeTemplate`, and the coverage warning formatting. Add a `materialBalanceCoverage` pure helper if useful.

### 7.3 Manual verification script for the owner

1. Pick the affected location.
2. Open Tank Operation Master → note the two RECEIPT and two DISPATCH codes.
3. Open Material Balance Template Configuration → open the active template → confirm each operation has a column and the mapping chips show the codes.
4. Open Material Balance Report → select the location and a date range with known tickets.
5. Compare the movement columns with Report Builder → Tank Stock Ledger → Daily Movements (grouped by Tank Operation).
6. Confirm Book Closing = Opening + IN − OUT and Loss/Gain is plausible.

---

## 8. Risks, rollback, compatibility

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Separator-coded operations now match a column they should not (canonical collision) | Low | Medium | Phase 3 collision check + save validation; audit script lists collisions |
| Existing templates with canonical codes keep working | Certain | Positive | Phase 1 canonicalises both sides; no migration |
| Phase 2 raw-code storage changes API output | Certain (if Phase 2) | Low | Only the template UI consumes it; it normalises for comparison |
| Report response gains a field | Certain (Phase 3) | None | Nullable field, backward compatible |
| Save-time rejection breaks bulk uploads with not-yet-created operations | Medium | Low | Create operations first; message names the missing codes; optional env flag to downgrade to warning |
| Performance of coverage query | Low | Low | One extra `TankOperation` query per report request; indexed on location/status |

**Rollback:**

- **Phase 1:** revert the three helper functions and the delegation; no data was changed.
- **Phase 2:** re-run the repair with `--normalise` (canonicalise stored codes) or revert the write path; the matcher keeps working because it canonicalises both sides.
- **Phase 3:** remove the `coverage` field and warning; no data was changed.

---

## 9. Open decisions for the owner

1. **Phase 1 only, or Phase 1 + Phase 2?** Phase 1 fixes the data immediately. Phase 2 additionally makes the UI/API display the real codes and removes the canonical-collision ambiguity. My recommendation: **Phase 1 + Phase 3**, then decide on Phase 2 after seeing the audit output.
2. **Unknown mapped code: reject (400) or warn?** Rejecting prevents the silent zero but can block a bulk upload that creates operations in the same file. My recommendation: **reject on create/update**, with a clear message; keep the bulk-upload order "operations first, templates second".
3. **Ambiguous canonical code: reject or warn?** My recommendation: **reject**, because it can double-count.
4. **Report coverage: warning banner only, or also an email/notification?** My recommendation: **banner only** for this release; the report is already the place the user looks.
5. **Should the repair script be shipped in the repo?** My recommendation: **yes** — read-only audit always; repair dry-run by default.
6. **Do you want the report to fail (HTTP 422) when a location has unmapped IN/OUT operations?** My recommendation: **no** — a missing mapping should not stop the report; the warning is enough.

---

## 10. What this study did and did not do

**Did:**

- Read the full Material Balance Template backend (`material_balance_templates.py`, `material_balance_helpers.py`, `reports.py`, `tank_stock_ledger.py`, `models.py`, `schemas.py`).
- Read the full Material Balance Template frontend (`MaterialBalanceTemplateMaster.jsx`, `TemplateDesigner.jsx`, `ColumnFormDialog.jsx`, `GenerateColumnsDialog.jsx`, `TemplateFormDialog.jsx`, `materialBalanceTemplate.js`, `materialBalanceTemplateApi.js`).
- Read the Material Balance Report frontend (`MaterialBalanceReport.jsx`, `materialBalanceReportApi.js`).
- Compared with Report Builder (`report_engine.py` starter templates) and the other consumers of `TankStockLedger` (OutTurn, summary, anomaly service).
- Reproduced the normalisation mismatch with the exact function bodies (standalone script, no app import) — every separator code returned `False`.
- Verified the line numbers and call graph.

**Did not:**

- Change any source file.
- Run pytest, npm tests, or `gh` checks (per instruction).
- Touch any database.
- Implement any part of the plan.

---

## Appendix A — Read-only audit script

```python
"""
audit_material_balance_coverage.py

Read-only audit of Material Balance Template mappings.

Usage:
    cd backend
    python -m scripts.audit_material_balance_coverage \
        [--location CODE] [--date-from YYYY-MM-DD] [--date-to YYYY-MM-DD] [--json FILE]

Prints:
  1. every active MOVEMENT column mapping and whether it resolves to an
     active Tank Operation of the template's location;
  2. active IN/OUT operations not covered by any active column;
  3. ledger rows in the date range whose operation code is not covered;
  4. canonical collisions between operation codes of the same location.

No database writes.
"""
from __future__ import annotations

import argparse
import json
from collections import defaultdict
from datetime import date

from app.database import SessionLocal
from app.models import (
    MaterialBalanceTemplate,
    MaterialBalanceTemplateColumn,
    TankOperation,
    TankStockLedger,
)
from app.services.material_balance_helpers import normalize_operation_code


def parse_date(value: str | None) -> date | None:
    if not value:
        return None
    return date.fromisoformat(value)


def audit(db, location: str | None, date_from: date | None, date_to: date | None) -> dict:
    templates = (
        db.query(MaterialBalanceTemplate)
        .filter(MaterialBalanceTemplate.status == "Active")
        .order_by(MaterialBalanceTemplate.location_code, MaterialBalanceTemplate.id)
        .all()
    )
    if location:
        templates = [t for t in templates if t.location_code.lower() == location.lower()]

    operations = db.query(TankOperation).filter(TankOperation.status == "Active").all()
    ops_by_location = defaultdict(list)
    for op in operations:
        ops_by_location[(op.location_code or "").strip().lower()].append(op)

    # The report uses the newest Active template per location. Mirror that rule.
    newest_by_location = {}
    for template in templates:
        loc = (template.location_code or "").strip().lower()
        current = newest_by_location.get(loc)
        if current is None or template.id > current.id:
            newest_by_location[loc] = template

    mappings = []
    covered_by_location = defaultdict(set)

    for template in templates:
        columns = (
            db.query(MaterialBalanceTemplateColumn)
            .filter(
                MaterialBalanceTemplateColumn.template_id == template.id,
                MaterialBalanceTemplateColumn.status == "Active",
            )
            .order_by(MaterialBalanceTemplateColumn.column_order, MaterialBalanceTemplateColumn.id)
            .all()
        )
        location_ops = ops_by_location[(template.location_code or "").strip().lower()]
        by_canonical = defaultdict(list)
        for op in location_ops:
            by_canonical[normalize_operation_code(op.operation_code)].append(op)

        for column in columns:
            if str(column.column_type or "").upper() != "MOVEMENT":
                continue
            excluded = {
                normalize_operation_code(code)
                for code in (column.excluded_operation_codes or [])
            }
            for code in column.mapped_operation_codes or []:
                canonical = normalize_operation_code(code)
                matches = by_canonical.get(canonical, [])
                status = "ok" if len(matches) == 1 else "ambiguous" if matches else "unknown"
                mappings.append(
                    {
                        "location_code": template.location_code,
                        "template_name": template.template_name,
                        "column_key": column.column_key,
                        "stored_code": code,
                        "canonical": canonical,
                        "matches": [m.operation_code for m in matches],
                        "status": status,
                    }
                )
                # Only the newest Active template decides report coverage.
                newest = newest_by_location.get(
                    (template.location_code or "").strip().lower()
                )
                if (
                    newest is not None
                    and newest.id == template.id
                    and canonical not in excluded
                ):
                    covered_by_location[(template.location_code or "").lower()].add(canonical)

    unmapped_operations = []
    for loc, template in newest_by_location.items():
        covered = covered_by_location.get(loc, set())
        for op in ops_by_location.get(loc, []):
            if str(op.operation_sign or "").upper() not in ("IN", "OUT"):
                continue
            if normalize_operation_code(op.operation_code) not in covered:
                unmapped_operations.append(
                    {
                        "location_code": template.location_code,
                        "template_name": template.template_name,
                        "operation_code": op.operation_code,
                        "operation_label": op.operation_label,
                        "operation_category": op.operation_category,
                        "operation_sign": op.operation_sign,
                    }
                )

    ledger_query = db.query(TankStockLedger).filter(TankStockLedger.status == "Active")
    if location:
        ledger_query = ledger_query.filter(TankStockLedger.location_code.ilike(location))
    if date_from:
        ledger_query = ledger_query.filter(TankStockLedger.accounting_date >= date_from)
    if date_to:
        ledger_query = ledger_query.filter(TankStockLedger.accounting_date <= date_to)

    unmapped_rows = []
    for row in ledger_query.all():
        canonical = normalize_operation_code(row.tank_operation_code)
        if canonical in covered_by_location[(row.location_code or "").lower()]:
            continue
        unmapped_rows.append(
            {
                "location_code": row.location_code,
                "tank_asset_code": row.tank_asset_code,
                "accounting_date": str(row.accounting_date),
                "ticket_number": row.ticket_number,
                "tank_operation_code": row.tank_operation_code,
                "tank_operation_label": row.tank_operation_label,
                "movement_nsv_bbl": row.movement_nsv_bbl,
            }
        )

    collisions = {}
    for loc, ops in ops_by_location.items():
        by_canonical = defaultdict(list)
        for op in ops:
            by_canonical[normalize_operation_code(op.operation_code)].append(op.operation_code)
        hits = {k: v for k, v in by_canonical.items() if len(v) > 1}
        if hits:
            collisions[loc] = hits

    return {
        "mappings": mappings,
        "unmapped_operations": unmapped_operations,
        "unmapped_ledger_rows": unmapped_rows,
        "canonical_collisions": collisions,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--location")
    parser.add_argument("--date-from")
    parser.add_argument("--date-to")
    parser.add_argument("--json")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        result = audit(
            db,
            location=args.location,
            date_from=parse_date(args.date_from),
            date_to=parse_date(args.date_to),
        )
    finally:
        db.close()

    if args.json:
        with open(args.json, "w", encoding="utf-8") as handle:
            json.dump(result, handle, indent=2, default=str)
        print(f"Written {args.json}")

    print("\n=== MAPPINGS ===")
    for item in result["mappings"]:
        print(
            f"{item['location_code']:10} {item['template_name'][:28]:28} "
            f"{item['column_key'][:22]:22} {item['stored_code'][:28]:28} "
            f"{item['status']:9} {', '.join(item['matches'])}"
        )
    print("\n=== UNMAPPED OPERATIONS ===")
    for item in result["unmapped_operations"]:
        print(
            f"{item['location_code']:10} {item['operation_code'][:28]:28} "
            f"{item['operation_label'][:28]:28} {item['operation_sign']}"
        )
    print(f"\n=== UNMAPPED LEDGER ROWS: {len(result['unmapped_ledger_rows'])} ===")
    for item in result["unmapped_ledger_rows"][:50]:
        print(
            f"{item['location_code']:10} {item['tank_asset_code'][:14]:14} "
            f"{item['accounting_date']:12} {item['tank_operation_code'][:28]:28} "
            f"{item['movement_nsv_bbl']} {item['ticket_number']}"
        )
    print("\n=== CANONICAL COLLISIONS ===")
    for loc, hits in result["canonical_collisions"].items():
        for canonical, codes in hits.items():
            print(f"{loc:10} {canonical:20} <- {', '.join(codes)}")


if __name__ == "__main__":
    main()
```

---

## Appendix B — Repair script (dry-run by default)

```python
"""
repair_material_balance_template_codes.py

Replaces canonicalised mapped/excluded Tank Operation codes with the raw
operation codes of the template's location. Dry-run by default.

Usage:
    cd backend
    python -m scripts.repair_material_balance_template_codes            # dry run
    python -m scripts.repair_material_balance_template_codes --apply    # write + audit
"""
from __future__ import annotations

import argparse
from collections import defaultdict

from app.database import SessionLocal
from app.models import (
    MaterialBalanceTemplate,
    MaterialBalanceTemplateColumn,
    TankOperation,
)
from app.services.material_balance_helpers import normalize_operation_code


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        templates = (
            db.query(MaterialBalanceTemplate)
            .filter(MaterialBalanceTemplate.status == "Active")
            .all()
        )
        operations = db.query(TankOperation).filter(TankOperation.status == "Active").all()
        ops_by_location = defaultdict(list)
        for op in operations:
            ops_by_location[(op.location_code or "").strip().lower()].append(op)

        changes = []
        problems = []
        for template in templates:
            columns = (
                db.query(MaterialBalanceTemplateColumn)
                .filter(
                    MaterialBalanceTemplateColumn.template_id == template.id,
                    MaterialBalanceTemplateColumn.status == "Active",
                )
                .all()
            )
            location_ops = ops_by_location[(template.location_code or "").strip().lower()]
            by_canonical = defaultdict(list)
            for op in location_ops:
                by_canonical[normalize_operation_code(op.operation_code)].append(op)

            for column in columns:
                for field_name in ("mapped_operation_codes", "excluded_operation_codes"):
                    codes = list(getattr(column, field_name) or [])
                    new_codes = []
                    changed = False
                    for code in codes:
                        matches = by_canonical.get(normalize_operation_code(code), [])
                        if len(matches) == 1:
                            raw = matches[0].operation_code
                            if raw != code:
                                changed = True
                            new_codes.append(raw)
                        elif len(matches) > 1:
                            problems.append(
                                f"{template.location_code}/{template.template_name}/"
                                f"{column.column_key}: {code} -> "
                                f"{[m.operation_code for m in matches]} (ambiguous, not changed)"
                            )
                            new_codes.append(code)
                        else:
                            problems.append(
                                f"{template.location_code}/{template.template_name}/"
                                f"{column.column_key}: {code} -> no active operation (not changed)"
                            )
                            new_codes.append(code)
                    if changed:
                        changes.append((column, field_name, codes, new_codes))

        print(f"{len(changes)} change(s), {len(problems)} problem(s).")
        for column, field_name, old, new in changes:
            print(f"{column.template_id}/{column.column_key}.{field_name}: {old} -> {new}")
        for problem in problems:
            print(f"PROBLEM: {problem}")

        if not args.apply:
            print("\nDry run. Re-run with --apply to write.")
            return

        for column, field_name, old, new in changes:
            setattr(column, field_name, new)
            # Audit every changed column (standing rule 1).
            from app.services.audit_service import create_audit_log

            create_audit_log(
                db=db,
                module_name="Material Balance Template",
                action="Repair Material Balance Template Column Codes",
                current_user=None,
                entity_type="MaterialBalanceTemplateColumn",
                entity_id=column.id,
                entity_label=column.column_label,
                remarks="Replaced canonical operation codes with raw Tank Operation codes",
                request_path="/scripts/repair-material-balance-template-codes",
                details={"field": field_name, "old": old, "new": new},
            )
        db.commit()
        print("Applied.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
```

---

## Appendix C — Normalisation reference table

| Input | `normalize_column_key` / `normalize_operation_code` (write + UI) | `normalize_material_balance_code_value` (current read) | Match? |
|---|---|---|---|
| `RECEIPT` | `RECEIPT` | `RECEIPT` | Yes |
| `RECEIPT-01` | `RECEIPT_01` | `RECEIPT-01` | **No** |
| `RECEIPT FROM FSO` | `RECEIPT_FROM_FSO` | `RECEIPT FROM FSO` | **No** |
| `RECEIPT/AGU` | `RECEIPT_AGU` | `RECEIPT/AGU` | **No** |
| `RECEIPT (FSO)` | `RECEIPT_(FSO)` | `RECEIPT (FSO)` | **No** |
| `RCPT-2` | `RCPT_2` | `RCPT-2` | **No** |
| `RECEIPT_01` | `RECEIPT_01` | `RECEIPT_01` | Yes |

This table is the one-page proof of the defect.

---

## Appendix D — Exact line references (pre-fix checkout)

| Symbol | File | Lines |
|---|---|---|
| `normalize_column_key` | `backend/app/routers/material_balance_templates.py` | 59-73 |
| `validate_material_balance_template_column_payload` | `backend/app/routers/material_balance_templates.py` | 89-174 (mapped codes 153-157, excluded 159-163) |
| `normalize_material_balance_code_value` | `backend/app/services/material_balance_helpers.py` | 29-30 |
| `should_row_match_material_balance_column` | `backend/app/services/material_balance_helpers.py` | 102-125 |
| `get_global_internal_transfer_operation_codes` | `backend/app/services/material_balance_helpers.py` | 128-153 |
| `should_row_be_in_book_closing_formula` | `backend/app/services/material_balance_helpers.py` | 155-188 |
| `calculate_book_closing_from_eligible_ledger_rows` | `backend/app/services/material_balance_helpers.py` | 190-223 |
| `build_dynamic_material_balance_tank_rows` | `backend/app/routers/tank_stock_ledger.py` | 825-1056 (match call 946, book call 959) |
| `consolidate_dynamic_material_balance_rows_by_location` | `backend/app/routers/tank_stock_ledger.py` | 1058-1216 |
| `get_material_balance_report` | `backend/app/routers/reports.py` | 1471-1560 |
| `normalizeColumnKey` / `normalizeOperationCode` | `frontend/src/utils/materialBalanceTemplate.js` | 110-126 |
| `proposeColumns` | `frontend/src/utils/materialBalanceTemplate.js` | 425-485 (code at 452-466) |
| `analyzeTemplate` | `frontend/src/utils/materialBalanceTemplate.js` | 519-665 |
| `TemplateDesigner` check call | `frontend/src/components/materialBalance/TemplateDesigner.jsx` | 72 |
| `MaterialBalanceDynamicReportResponse` | `backend/app/schemas.py` | 1571-1573 |
