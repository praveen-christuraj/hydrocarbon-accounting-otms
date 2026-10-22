# Operation date/time — payload is the only source, accounting day per location

**Rule (product owner, 2026-10-22):** the operation date and time of a ticket
are the values entered inside the respective operation type's payload —
nothing else. The Location Accounting Day Setting of the ticket's location
is applied to that payload moment for every calculation and report, and
chronological order always uses the payload date **and time**.

## What was wrong

The Operation Date / Start / End inputs had been removed from the Operation
Entry metadata, but the backend still extracted the operation moment from
the metadata in several places:

* `resolve_transaction_datetime_for_accounting_day()` (Tank Stock Ledger
  creation on approval) preferred the metadata `operation_start_datetime`
  over the payload gauging date/time, so tickets recorded while the
  metadata existed got their accounting day from the wrong moment.
* Tank Operation Summary and Out-Turn Summary reported
  `accounting_date = operation_date` (metadata) and never applied the
  location accounting-day setting at all; the Out-Turn chain ordered
  same-day tickets by row id instead of gauging time.
* The transaction-based Out-Turn Report (`reports.py`) did the same, and
  its multi-tank rows never read the before/after payload times.
* FSO reports computed the accounting date from the metadata date plus
  the payload `event_time`, ignoring the payload `operation_date`.
* The daily stock summary ordered rows within a day by
  `accounting_day_start` (identical for the whole day) → effectively by id.
* Barge timeline events used the metadata start or `datetime.now()`.

## The fix — one resolver

`backend/app/services/operation_datetime.py` is now the single source:

| Payload | Operation date/time keys |
| --- | --- |
| `tank_gauging_payload` | `inputs.gaugingDate` + `inputs.gaugingTime` |
| `tanker_payload` | `inputs.tankerTransactionDate` + `inputs.tankerTransactionTime` |
| `multi_tank_payload` | `inputs.before.date/time` (fallback `inputs.after.*`) — same choice as the frontend resolver |
| `flowmeter_payload` / `meter_payload` | `inputs.reading_date` + `inputs.event_time` |
| `fso_payload` / `shuttle_payload` | `inputs.operation_date` + `inputs.event_time` |

Unknown payload shapes fall back to the same scored generic search the
frontend uses (`frontend/src/utils/operationDate.js`), so browser and
server never disagree. Resolution order for a ticket is:

1. payload date/time;
2. legacy metadata `operation_start_datetime` — **only** when the payload
   carries no date/time at all (Stock Movement / Vessel Cycle payloads
   have none);
3. `operation_transactions.operation_date`.

`resolve_transaction_accounting()` pairs that moment with the origin
location's active Location Accounting Day Setting (effective on the
payload operation date): an operation before the day-start time belongs
to the previous accounting day; no entered time (or no setting) keeps the
calendar date — the long-standing `compute_accounting_date` semantics.
Locations without a setting therefore behave exactly as before in the
transaction-based summaries.

## Where it is applied

* **Write path** (`operation_entries.py` create/update): the ticket
  `operation_date` column is derived from the payload server-side before
  ticket-number generation, so the stored column always equals the
  payload date. Ticket numbers of edited tickets are not regenerated.
* **Tank Stock Ledger** (`reports.py`): approval-time creation, previous-
  row lookup and running-balance rebuild all resolve the payload moment;
  a rebuild now re-derives `operation_date` and the accounting window
  from the payload every time, so "Rebuild Tank Stock Ledger" also
  repairs historical rows.
* **Ledger ordering** (`tank_stock_ledger.py`): `get_ledger_operation_datetime`
  reads the payload in `source_payload` for every payload type; the
  filtered-ledger, daily-summary and material-balance orderings are
  chronological by it within each accounting day.
* **Tank Operation Summary / Out-Turn Summary**: rows show the payload
  operation date and the accounting date under the location setting;
  explicit date ranges filter on the accounting date (candidates are
  loaded with one extra day at the top end because an early-hours
  operation on `date_to + 1` can belong to `date_to`); out-turn chains
  and their pre-window seed are chronological by payload date/time, and
  range filtering happens after the chain is built so previous-stock
  values stay correct.
* **Out-Turn Report from transactions** (`reports.py`): same treatment,
  including multi-tank payload times.
* **FSO OTR / Material Balance / Outturn** (`reports.py`, also used by
  the dashboard): accounting date, displayed operation date and within-
  day ordering come from the FSO payload.
* **Tracking timelines**: barge trip events and Shuttle voyage rows/MTR
  export use the payload moment; flowmeter records show the payload
  reading date; vessel stock ledger rows take the resolved date.

List endpoints that filter on the `operation_date` column (register,
dashboard, voyage lists, flowmeter record range) keep working unchanged
because the column is now guaranteed to hold the payload date — see the
backfill below.

## Previous entries — start-up backfill

`ensure_payload_operation_dates()` (`backend/app/utils/db_migrations.py`,
run from `main.py` after `ensure_fso_shuttle_payload_operation_date()`):

* sets `operation_transactions.operation_date` to the payload date where
  they differ (ticket numbers untouched);
* sets `tank_stock_ledger.operation_date` from `source_payload` and
  recomputes accounting date/window/setting from the payload moment,
  then rebuilds running balances for affected (location, tank) groups;
* syncs `vessel_stock_ledger.operation_date` with its ticket.

It never modifies payloads, never inserts/deletes rows, never
recalculates quantities, skips rows whose location has no effective
setting, is idempotent, and cannot block start-up.

## Tests

`backend/tests/test_payload_operation_datetime.py` (10 tests): per-layout
extraction, payload-over-metadata resolution, write-path derivation,
ledger creation with a 06:01 accounting day, both summaries, the
transaction out-turn report, daily-summary closing order, FSO report,
and the backfill (including idempotency).
`test_tracking_report_integrity.py` was updated to backdate its history
ticket in the payload (where the operation date lives) instead of only
in the metadata.
