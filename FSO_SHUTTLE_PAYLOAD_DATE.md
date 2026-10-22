# Operation Entry — FSO / Shuttle payload operation date

**Modules:** Operation Entry (`frontend/src/components/operationLayouts/FSOTrackingLayout.jsx`,
`ShuttleTrackingLayout.jsx`), Operation Transaction Detail
(`frontend/src/pages/OperationTransactionDetail.jsx`), startup migrations
(`backend/app/utils/db_migrations.py`).

**Symptom:** after the Operation Date / Start Date-Time / End Date-Time inputs
were removed from the Operation Entry metadata section, every asset-specific
payload carried its own date — the tank gauging date, the tanker transaction
date and the multi-tank before/after dates. The **FSO Tracking** and **Shuttle
Tracking** payloads only had a *Time* (`event_time`) field, so their operation
date could not be entered at all.

---

## 1. Where the date lives now

The date is part of the payload, exactly like the other layouts:

```json
{
  "meta": { "schema": "fso_payload_v2", "...": "..." },
  "inputs": {
    "operation_date": "2026-10-20",
    "event_time": "08:30"
  },
  "calculated": { "net": { "...": "..." } }
}
```

| Layout | Date key inside the payload |
| --- | --- |
| Tank Gauging | `inputs.gaugingDate` |
| Multi-Tank Before/After (barges) | `inputs.before.date` / `inputs.after.date` |
| Tanker Loading | `inputs.tankerTransactionDate` |
| Flowmeter Reading | `inputs.reading_date` (+ mirrored `inputs.operation_date`) |
| **FSO Tracking** | **`inputs.operation_date`** |
| **Shuttle Tracking** | **`inputs.operation_date`** (same key the Shuttle Tracking page already used) |

`resolveOperationDate()` (`frontend/src/utils/operationDate.js`) already ranks
`operation_date` inside a payload, so the ticket column is derived from the
payload when a draft is saved — no new resolver logic was needed.

> **Update (2026-10-22):** the payload date/time is now the only authoritative
> operation moment for every calculation and report, resolved server-side by
> `backend/app/services/operation_datetime.py`; the `operation_date` column is
> a derived cache kept equal to the payload date by the write path and the
> `ensure_payload_operation_dates()` backfill. See
> `PAYLOAD_OPERATION_DATETIME.md`.

## 2. Frontend changes

* **FSO Tracking layout** — a `Date *` input (`operation_date`) next to the time.
  It loads from `inputs.operation_date`, then the ticket date, then today, and
  writes itself into the payload and the ticket date
  (`setEntryField('operationDate', ...)`).
* **Shuttle Tracking layout** — same date input, same initialisation and the
  same ticket-date sync (the layout now receives `setEntryField`).
* Both layouts add only the missing `operation_date` key to a legacy payload
  that was saved before this change (no other key is rebuilt), so old drafts
  open with the right date and submit without a false validation error.
* The saved operation labels/categories/signs are kept when the asynchronous
  Vessel Operation list has not loaded yet, so editing only the date cannot
  blank them.
* The layouts are keyed by ticket/template/asset so switching between two
  drafts never carries the previous ticket's date across.
* Submit validation reports `FSO Date is required.` / `Shuttle Date is
  required.` only when the date is genuinely missing.
* Operation Transaction Detail now shows the payload date in the FSO and
  Shuttle summaries.

## 3. Database changes (no schema change)

The payloads are stored in `operation_transaction_values.field_value` (JSONB),
so storing one more key needs **no DDL**. To keep historical tickets coherent
with the new field the startup migration
`ensure_fso_shuttle_payload_operation_date()` runs on every boot and:

* only **adds** `inputs.operation_date` to `fso_payload` / `shuttle_payload`
  rows that do not have it yet;
* takes the value from the ticket's own
  `operation_transactions.operation_date` — the date every report already uses —
  so nothing that is displayed or reported changes;
* never overwrites an existing payload date, never removes a key, never
  recalculates a quantity, and never inserts or deletes a row;
* is idempotent (a second run changes nothing) and a failure is reported
  without blocking startup.

Existing payloads keep working untouched; when a draft's date is edited in
Operation Entry, the payload date and the ticket column are updated together by
the normal `PUT /operation-entries/{id}` path (the ticket number is not
regenerated).

## 4. Tests

* `backend/tests/test_fso_shuttle_payload_date.py` — backfill adds the missing
  key, preserves existing payload dates and other layouts, is idempotent, and
  leaves the ticket dates unchanged.
* `frontend/scripts/test-sender-receiver-pairing.mjs` — already covers the FSO /
  Shuttle operation-date resolution case.
