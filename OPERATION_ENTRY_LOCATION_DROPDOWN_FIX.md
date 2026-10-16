# Operation Entry — Destination / Receiver dropdown fix

**Module:** Operation Entry (`frontend/src/pages/OperationEntry.jsx`)
**Symptom:** Origin and Sender default correctly to the signed-in user's own
location, but Destination and Receiver only offer that same one location instead
of every location in the system.
**Verdict:** Not a permission problem and not a setting that was left off. It is
a **frontend/backend request bug** — the page asked for an illegal page size,
the API answered `422`, and the error was swallowed, so the dropdowns quietly
fell back to the location-scoped list.

---

## 1. What the module intends

`OperationEntry.jsx` deliberately keeps two different location lists:

| List | Source | Used by |
| --- | --- | --- |
| `activeLocations` | location-scoped (`getLocations()` → `apply_location_filter`) | Origin, Sender, local assets, operation availability |
| `allActiveLocations` | unscoped (`getLocations({ all_locations: true })` → `db.query(Location)`) | **Destination, Receiver** |

`Origin` / `Sender` are prefilled from `defaultEntryLocationCode`, which is the
user's own location when they have exactly one assigned location
(`OperationEntry.jsx`, `emptyEntry`). That part was already correct.

The intent for Destination / Receiver is documented in the page:

```js
// Get all locations for receiver/destination dropdown - not filtered by user scope
```

So the design was right — the request that feeds it was not.

## 2. Root cause

```js
// frontend/src/pages/OperationEntry.jsx (before)
getLocations({ all_locations: true, limit: 500 })
  .then((data) => { if (active) setAllSystemLocations(data?.items || []) })
  .catch(() => {})                       // <— hides everything
```

```python
# backend/app/routers/locations.py (before)
limit: int = Query(50, ge=1, le=200)      # <— hard cap
```

`getLocations()` builds `GET /locations?skip=0&limit=500&all_locations=true`.
Because `limit` is declared `le=200`, FastAPI rejects the request **before the
handler runs**:

```
422  {"detail":[{"type":"less_than_equal","loc":["query","limit"],
      "msg":"Input should be less than or equal to 200","input":"500","ctx":{"le":200}}]}
```

`.catch(() => {})` discarded it. `allSystemLocations` stayed `[]`, so
`allActiveLocations` fell back to the scoped `locations` prop:

```js
const source = allSystemLocations?.length ? allSystemLocations : locations
```

`locations` arrives from `App.jsx` via `getLocations()` — **without**
`all_locations` — so the backend applies `apply_location_filter` and returns
only the user's assigned location. That is exactly the reported symptom.

The `all_locations=true` flag itself was never the problem; the request never
reached it.

## 3. Fix

**Backend — `app/routers/locations.py`**
The page size is now clamped per mode instead of hard-rejected, following the
`clamp_limit` convention already used by `operation_transactions`,
`out_turn_summary`, `tank_stock_ledger` and others:

* `all_locations=true` (reference data) → up to `MAX_LIST_LIMIT` (1000)
* scoped browsing (Location Master grid) → unchanged 200-row cap

**Frontend — `src/api/locationApi.js`**
New `getAllLocations()` pages the master at 200 rows until `has_more` is false
(mirroring the existing `getAllPermissions()` helper), so dropdowns stay
complete past 200 locations.

**Frontend — `src/pages/OperationEntry.jsx`**
Uses `getAllLocations()` and now **reports** a failure with `notifyError`
instead of swallowing it — the silent `.catch(() => {})` is what turned a
one-line API mismatch into a mysterious "wrong data" report.

## 4. Was it a permission issue?

Partly worth checking, but **not the cause here**.

`GET /locations` requires the `View Location` permission
(`locations.py`: `require_user_permission(current_user, "View Location", db)`),
which is granted only through **Role Permission Assignment → Location Master**.
If a user lacks it, both location calls return `403` and the location lists come
back empty.

Diagnostic:

| What you see | Cause |
| --- | --- |
| Origin/Sender **also** empty, and dropdowns blank | Missing **`View Location`** permission → Role Permission Assignment → Location Master |
| Origin/Sender show the user's location, Destination/Receiver show only that same location | **This bug** — fixed in this change |

Because the user reported that Origin/Sender *do* default correctly, location
data is loading — so the permission is present and this bug is the cause.

### Settings — no change required

`User Location Assignment → All Locations Access` and the assigned-location list
control *scoped* browsing and validation only. Destination / Receiver are meant
to show every location regardless of that flag, so turning "All Locations
Access" on would have masked the bug rather than fixed it (and would have handed
the user write scope they should not have).

## 5. Verification

| Check | Result |
| --- | --- |
| `backend/tests/test_operation_entry_location_lookup.py` (new, 6 tests) | 6 passed |
| Full backend suite | **192 passed** |
| `frontend/scripts/test-operation-entry-locations.mjs` (new, 9 checks) | 9/9 passed |
| Same script against the old single-call implementation | **fails 5/9** (guard is real) |
| `npm run smoke` (63 checks, all pages) | 63/63, 0 runtime errors |
| `npm run smoke -- /operation-entry` | 18/18, calls `GET /locations?skip=0&limit=200&all_locations=true` |
| ESLint on changed files | unchanged from baseline (9 errors / 4 warnings, all pre-existing) |
| `npm run build` | success |

Reproduce:

```bash
cd backend && pytest tests/test_operation_entry_location_lookup.py -v
cd frontend && npm run test:operation-entry-locations
```
