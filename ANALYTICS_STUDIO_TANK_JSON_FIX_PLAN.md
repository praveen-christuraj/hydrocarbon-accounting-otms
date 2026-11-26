# Analytics Studio — Tank Visuals, JSON/Payload Fields & Report Builder Parity

**Status:** PLAN ONLY. No application code changed. No pytests and no GitHub/CI checks were run (per your instruction). Evidence below comes from reading the source plus three local, read-only experiments (listed in §2).
**Branch:** `arena/2bd61df1-hydrocarbon-accounting-otms` (base `415a6be`, clean tree).
**Scope:** (1) the `404` / `400` console errors that keep tank visuals from rendering, (2) JSON-stored values and Operation-Ticket payload splits not being usable in Analytics Studio, (3) an in-depth Analytics Studio ⇄ Report Builder parity review.

---

## 1. Executive summary

| # | What you see | Exact, code-level cause | Fix |
|---|---|---|---|
| **1** | `GET /api/analytics/lookups` → **404** (×7), `POST /api/analytics/my-dashboards/2/visual/vis_mwxilfyg_x4e/records` → **404** | The routes exist and are correct in this repo (`analytics.py:397`, `analytics.py:1030`) — verified by importing the app and listing all 415 routes (`/analytics/lookups`, `/analytics/.../records`, `/analytics/run-preview` all present, nothing shadowing them). The mock API is **not** the source: it has no `/analytics/*` handler and its generic fallback answers **200 `[]`/`{}`**, never 404 (verified by running it). So the browser is being answered by a **backend build older than these two endpoints** — i.e. a stale backend process / a Docker `backend` image built before they were added, while the frontend files are current (Vite/bind-mount). | Rebuild/restart the backend, then make the dev topology fail loudly instead of silently (`/api` proxy always on, mock returns real 404s, start-up version handshake). |
| **2** | `POST /api/analytics/run-preview` → **400** | Same stale backend validating an older/stricter contract — *plus* real 400 sources in today's code that you will hit next: `OPERATIONAL_DATE` is offered in Studio but is not a valid date basis (`AnalyticsBuilder.jsx:1848` vs `report_engine.py:110`; save returns `400 Unknown date basis 'OPERATIONAL_DATE'` — reproduced), `schema_version: 1` dashboards (`analytics_engine.py:797`), duplicate visual ids, Material-Balance unit. | Surface the backend's real `detail` for the 400, then remove/fix the invalid inputs (date-basis list, schema-version upgrade on load). |
| **3** | Tank visual still not working even when the API answers | **Two genuine engine bugs**, both reproduced from code: (a) a tank visual gets **zero locations** whenever `location_codes` is empty (GLOBAL dashboard, or Studio preview of a GLOBAL dashboard) → early return with "No location is in scope for this tank visual." (`analytics_engine.py:1202-1212` + `:1232`); the Viewer sends `location_codes: []` for every GLOBAL dashboard (`AnalyticsViewer.jsx:162`), the Builder sends `location_codes: []` when no location is set (`AnalyticsBuilder.jsx:351`); (b) the visual silently applies `date_to` as an as-of cutoff even though tank visuals are normalised to `date_basis: "NONE"` (`analytics_engine.py:1285-1286`), so a preview window can delete the newest ledger rows. | Treat "no explicit selection" as "whole scope" in the tank engine (same rule `report_engine._requested_locations` already uses), and honour `date_basis NONE` for the as-of cutoff. |
| **4** | Report Builder splits JSON/payloads into usable columns; **Studio shows nothing** | Structural, not cosmetic: Studio's field explorer only lists `dataset.columns` (**no `virtual_fields`, no JSON/payload paths** — `AnalyticsBuilder.jsx:826-839`), the synthetic column builder drops JSON columns (`:154`), toggling a field can only create `{type:'column'}` specs (`:615-670`), filters and slicers are built from the same column-only list (`:841-906`), and Studio never calls the JSON-path discovery endpoint (`JsonColumnPicker` is wired into Report Builder only). The **backend already supports `payload_path` / `json_path` / `virtual` / `ticket_field` inside a dashboard visual** — I validated `payload_path` columns and slicers against `validate_analytics_definition` and they pass (`report_engine.py:183-200`). | Add a real "split JSON/payload into columns" flow to Studio (reuse `JsonColumnPicker`), expose `virtual_fields`, allow payload/virtual specs in columns, filters, slicers and comparison rules; add the missing backend plumbing (`/analytics/json-paths`, virtual/payload injection for slicers). |
| **5** | "In-depth parity" ask | Studio cannot edit the ticket **source restrictions** it silently hard-codes (`statuses: ['Approved']`, empty operation types/templates — `AnalyticsBuilder.jsx:188-194`), has no `formula_help`/`operator_help`/`date_bases` in its catalog (Report Builder has them, `report_builder.py:318-336`), no `operation_types`/`templates`/`statuses`/`products` in its lookups (`analytics.py:397-420`), no sort/hidden-column editors, no "Split JSON" affordance, and no drill-through *inside* Studio. | Phase 3 of the plan: bring Studio to Report Builder parity on source config, catalog help, lookups, and the persistence-side features that matter (sort, hidden, split). |

Everything below is a design proposal; nothing is implemented.

---

## 2. How the conclusions were verified (read-only)

| Experiment | Result that matters |
|---|---|
| Imported `app.main` in a throwaway venv and printed `app.routes` | 415 routes; `/analytics/lookups` (GET), `/analytics/my-dashboards/{dashboard_id}/visual/{visual_id}/records` (POST) and `/analytics/run-preview` (POST) are all registered. **No** `/analytics/{param}` catch-all can shadow them. |
| Ran `frontend/scripts/mock-api.mjs` on port 8321 and curled the three failing calls | All three returned **200**. `grep -c analytics mock-api.mjs` = **0**; unknown paths fall through to `sendJson(res, 200, method === 'GET' ? [] : {})` (`mock-api.mjs:1305-1310`). → The mock cannot produce the observed 404s. |
| Installed Vite 8 in a scratch dir with **no** `/api` proxy and curled it | `POST /api/...` → **404**; `GET /api/...` with `Accept: application/json` → **404**; with `Accept: */*` → 200 `text/html` (SPA fallback). → An unproxied dev server does not reproduce "GET → 404" for a normal `fetch`, which rules out "bare `npm run dev`" as the explainer and points at a real upstream 404. |
| Ran `validate_analytics_definition` on hand-built definitions | `payload_path` columns → OK; `schema_version: 1` → `400 Unsupported Analytics dashboard design version.`; duplicate visual id → `400 Visual 2 needs a unique id.`; duplicate slicer key → `400 Every slicer needs a unique key.`; `OPERATIONAL_DATE` → preview OK, **save 400** `Unknown date basis 'OPERATIONAL_DATE'`; Material Balance `unit: barrels` → `400`. |

Conclusion for issue 1/2: the frontend in this checkout is not the problem — **the responding backend is older than the checkout**. The frontend half of the fix below is about making that impossible to miss next time.

---

## 3. Issue 1 — the 404s (`/analytics/lookups`, `.../visual/{id}/records`)

### 3.1 Why it is a stale backend and not the frontend

* Paths are identical on both sides: `analyticsApi.js:11` `GET /analytics/lookups` ⇄ `analytics.py:397`; `analyticsApi.js:39-40` `POST /analytics/my-dashboards/{id}/visual/{visual_id}/records` ⇄ `analytics.py:1030`.
* `apiClient.js:10-11`: dev default is `http://127.0.0.1:8000`; because the browser called `:5173/api/...`, `VITE_API_BASE_URL=/api` was in effect (Docker, `dev:mock`, or a `.env.local`), so the `/api` prefix was stripped by the Vite proxy (`vite.config.js:19-30`) or by nginx (`nginx.prod.conf:45-50`).
* Either way the request reached **a** backend that answered `404`. That backend answered `400` on `run-preview`, so it *has* the analytics router — just an older one. `/lookups` and `/records` are the two newest analytics endpoints, which is exactly the pair that 404s.
* The most likely topology in your setup: `docker compose up` reusing a `hydrocarbon-backend` image built before those endpoints were added (`docker-compose.yaml:34-70`). The frontend container mounts `./frontend` as a volume (`docker-compose.yaml:71-73`) so it always runs current code; the backend is baked into the image and keeps running old code (`restart: unless-stopped`).
* Second most likely: a `uvicorn` process from an earlier checkout still holding `:8000` (the same thing happens with `start_app.bat` if the window was never closed).

### 3.2 60-second confirmation (no code change)

```bash
# 1) what is actually serving :8000?
curl -i http://127.0.0.1:8000/health
curl -i http://127.0.0.1:8000/analytics/lookups          # 401 = route exists, 404 = route missing
curl -i -X POST http://127.0.0.1:8000/analytics/my-dashboards/2/visual/vis_mwxilfyg_x4e/records \
     -H 'Content-Type: application/json' -d '{}'          # 401 = route exists, 404 = route missing
curl -i http://127.0.0.1:8000/openapi.json | grep -c '"\/analytics\/lookups"'   # 0 = stale build
# 2) Docker?
docker compose ps
docker inspect -f '{{.Image}} {{.Created}}' hydrocarbon-backend
```

`401` on the two calls above (with `401` meaning "auth required", not "not found") proves the route exists; `404` proves the running build is old.

### 3.3 Fix design

1. **Rebuild the backend** (`docker compose build --no-cache backend && docker compose up -d backend`), or stop the stale `uvicorn` and restart it from this checkout. This is the actual repair for the reported 404s.
2. **`frontend/vite.config.js` — make the proxy deterministic.** Today it only proxies when `MOCK_API=1` or `API_PROXY_TARGET` is set (`:11`). Add an explicit `DEV_API_PROXY` switch and, when `VITE_API_BASE_URL` is a relative path (`/api`) and no proxy is configured, fail the dev server with a clear message instead of silently 404-ing. Development must never resolve `/api/...` to the SPA HTML shell.
3. **`frontend/scripts/mock-api.mjs` — stop lying.** Any unmatched path must return a real `404 {detail: "Not in mock API: <path>"}` instead of `200 []`/`{}` (`:1305-1310`), and add thin analytics handlers (`/analytics/catalog`, `/analytics/lookups`, `/analytics/run-preview`, `/analytics/my-dashboards`, `/analytics/my-dashboards/:id/run-batch`, `.../visual/:vid/records`) so `dev:mock` renders the Studio and gallery offline instead of pretending success.
4. **Start-up handshake / version banner.** Add `build` info to `GET /health` (git sha + app version) and have the app compare it with the frontend build at boot; if the API is missing a required route group, show one actionable banner ("Backend is older than this frontend — rebuild it") instead of seven console 404s. Cheapest version: on first `404` from any `/analytics/*` call, show that banner once.
5. **`export_visual` normalisation.** For consistency with the already-fixed `records` path (`analytics.py:1040-1045`), `export_visual` (`analytics.py:920`) still looks the visual up in the **raw** saved definition; it should normalise first, like `records` does. Low risk, same class of bug the previous fix addressed.

---

## 4. Issue 2 — the `400` on `run-preview`

The 400 came from the older backend, so **its real `detail` must be read once the backend is rebuilt** (DevTools → Network → `run-preview` → Response, or the toast text, which already renders `detail` via `formatApiError`).

Independently of that, the current code has four inputs that legitimately produce `400` on this route, and two of them are bugs in Studio's UI:

| Source | Line | Behaviour |
|---|---|---|
| `schema_version` not 2/3 | `analytics_engine.py:797` | `400 Unsupported Analytics dashboard design version.` Hits dashboards/version-history snapshots saved by an older release; Studio loads them verbatim (`AnalyticsBuilder.jsx:404-420`) and then previews them. |
| Duplicate visual id / missing id | `analytics_engine.py:819-823` | `400 Visual N needs a unique id.` `handleDuplicateVisual` mints `vis_${Date.now().toString(36)}` (`AnalyticsBuilder.jsx:537`) — no random suffix, unlike `addVisualToCanvas` (`:497`), so a double-click can collide. |
| Duplicate/empty slicer key | `analytics_engine.py:907-916` | `400 Every slicer needs a unique key.` Studio keys slicers `s_<column>_<n+1>` from the *current length* (`AnalyticsBuilder.jsx:1360-1361`) — remove one and re-add and the regenerated key can collide with a surviving one. |
| Invalid date basis | `report_engine.py:110` + `analytics_engine.py:934-939` | `OPERATIONAL_DATE` is offered in Studio (`AnalyticsBuilder.jsx:1848`) but is not in `DATE_BASES`. Preview passes (strict validation is skipped) and **Save** fails with `400 Unknown date basis 'OPERATIONAL_DATE'` — reproduced. |
| Empty dashboard / bad material-balance unit | `analytics_engine.py:810, 881` | `400 Add at least one visual…`, `400 Material Balance unit must be GSV, NSV, LT or MT.` |

### Fix design

1. **Date basis**: replace the two-option list with the authoritative set (`ACCOUNTING_DATE`, `PAYLOAD_OPERATION_DATE`, `OPERATION_DATE`, `CREATED_AT`, `COLUMN` + `date_column` picker, `NONE`) sourced from the catalog instead of hard-coded strings. Migrate any stored `OPERATIONAL_DATE` to `OPERATION_DATE` on load (both mean "the ticket header date").
2. **Stable keys**: use a monotonic random id for visuals (`vis_<base36 time>_<3 random chars>`, already used by `addVisualToCanvas`) and for slicers (`slicer_<random>`, key `s_<column>_<random>`), and de-duplicate against existing ids before insert.
3. **Schema upgrade on load**: when the loaded/inspected definition has `schema_version < 2`, migrate it in memory (`schema_version: 2`, `canvas` defaults, `layout` normaliser — the code already does the canvas/layout part at `AnalyticsBuilder.jsx:413-419`) and mark the dashboard dirty so the next save persists it, instead of sending the old version to the API.
4. **Readable 400s**: prefix validation errors with the endpoint and visual so the toast names the offending visual (`Visual 'X': …` already happens for report-engine errors — extend it to definition-level errors).
5. Keep `strict_visuals=False` for preview and `True` for save (current behaviour is right); the fix is to make the UI never *build* something that fails strict validation.

---

## 5. Issue 3 — why the tank visual is still broken (engine bugs)

This is separate from the 404s and will still bite after the backend is rebuilt.

### 5.1 Bug A — an empty `location_codes` means "no tanks"

`_run_tank_snapshot_visual()` (`analytics_engine.py:1162`):

```python
# 1202
requested_codes, scope_warning = _resolve_visual_location_scope(visual, params)
...
# 1207-1210
elif scope is not None:                        # restricted user
    allowed_codes = [c for c in requested_codes if c in scope] if requested_codes else sorted(scope)
else:                                          # unrestricted / admin
    allowed_codes = requested_codes            # []  ← empty list
# 1232
if not allowed_codes:
    return {... "warnings": warnings or ["No location is in scope for this tank visual."] ...}
```

`_resolve_visual_location_scope()` (`:526-546`) returns `sorted(runner_codes)`, i.e. `[]`, when the visual has no fixed location and `params["location_codes"]` is empty.

Who sends an empty list?

* **Viewer, every GLOBAL dashboard**: `const initLocations = item.location_code ? [item.location_code] : []` (`AnalyticsViewer.jsx:162`) → `run-batch` gets `location_codes: []`.
* **Studio preview**: `location_codes: loc ? [loc] : []` (`AnalyticsBuilder.jsx:351`) → empty whenever the dashboard scope is GLOBAL (`locationCode` is `''` — `AnalyticsBuilder.jsx:421-427`).

Both are "no explicit selection ⇒ whole reporting scope", which is exactly the rule `report_engine._requested_locations()` already implements for tickets/ledger (`report_engine.py:286-305`: *"No explicit (in-scope) choice: whole runner scope applies"*) and which `run_preview` also implements (`analytics.py:610-612`). The tank engine is the only place that reads `[]` as "nothing". Result: **admin/GLOBAL dashboards always render "No location is in scope for this tank visual."**, and a `LOCATION` dashboard only works because `_runner_params` forces `[dashboard.location_code]` (`analytics.py:277-278`).

### 5.2 Bug B — a live snapshot is filtered by the date window

`analytics_engine.py:1274-1286` reads `params["date_to"]` and drops ledger rows with `accounting_date > date_to`, regardless of the visual's `date_basis`. But tank visuals are normalised to `date_basis: "NONE"` (`:858-865`) and `visual_execution_params()` (`:507-521`) exists precisely so "NONE" means "no date window". So a Studio preview range (`AnalyticsBuilder.jsx:981-995`) or a Viewer range silently deletes the newest stock rows → tanks either disappear (no ledger + no calibration ⇒ `:1535` `if ledger is None and cap <= 0: continue`) or show stale/zero stock.

### 5.3 Fix design (no filters are removed)

1. **Empty selection = whole scope.** In `_run_tank_snapshot_visual`, replace the `allowed_codes` block with one helper shared with the other special sources:

   ```python
   codes, warning = _resolve_visual_location_scope(visual, params)
   if warning: allowed = []
   elif scope is not None:
       allowed = [c for c in codes if c in scope] or ([] if codes else sorted(scope))
   else:
       allowed = codes or pool_of_locations_in_use()   # unrestricted user, no selection
   ```

   For the unrestricted branch, derive the pool from the data actually being read (distinct `TankStockLedger.location_code` ∪ active `AssetAssignment.assignment_location_code` ∪ in-scope `Asset.location_code`) rather than from the (possibly huge) location master. Keep `_runner_params` and `run_preview` as the single authority for scope — this only fills in "unpecified".
2. **Honour `date_basis` for the as-of cutoff.** Apply the `date_to` cutoff only when the visual explicitly opts in (`date_basis` not `NONE`, or a new `query.as_of_date` flag). Default = live snapshot.
3. **Keep every per-visual filter** exactly as-is: `explicit_types` (`:1247-1253`, applied as a row predicate at `:1540`), `_row_matches_tank_filters` (slicers/cross-filters, `:995`), `_snapshot_row_matches_fixed_filters` (`:1092`). They already produce `filter_breakdown` and per-stage warnings (`:1593-1601`) — after the fix those messages become the useful ones.
4. **Renderer empty state.** `TankVisualRenderer.jsx:84-89` already prints `meta.warnings`; extend the engine's empty-case warnings to name the effective scope (`"Scope: UTP, BNY — no active shore tanks with stock or calibration"`) and the `filter_breakdown` counts, so the next report of "it doesn't work" is self-diagnosing.
5. **Studio/Viewer payload hygiene (defence in depth).** Send `location_codes: []` + `all_locations: true`-style intent explicitly (a new optional `scope_mode: "ALL"` on `AnalyticsBatchRunRequest`, defaulting to today's meaning) so the API never has to guess; keep the backend inference above for older clients.

---

## 6. Issue 4 — JSON / payload values are unreachable in Analytics Studio

### 6.1 Report Builder does it because it has three things Studio lacks

| Capability | Report Builder | Analytics Studio |
|---|---|---|
| Field explorer lists `virtual_fields` (payload dates, looked-up names) | `ReportBuilder.jsx:367-376` | ✗ — only `dataset.columns` (`AnalyticsBuilder.jsx:826-839`) |
| Explicit "Split saved JSON into columns" callout | `ReportBuilder.jsx:894-906` | ✗ — nothing |
| JSON path discovery (`POST /report-builder/json-paths`) | `JsonColumnPicker.jsx:23-31` | ✗ — no API helper, no endpoint |
| Payload choice discovery (which `*_payload` fields exist) | `ReportBuilder.jsx:415-448` (`GET /report-builder/operation-fields`) | ✗ |
| Column spec of type `payload_path` / `json_path` / `virtual` / `ticket_field` | `ReportBuilder.jsx:346-359` (`handleJsonAdd`) | ✗ — `toggleFieldOnSelectedVisual` only builds `{type:'column'}` (`:615-670`) |
| `value_conditions` (comparison rules) bound to payload fields | `ReportBuilder.jsx:452-505` | Partially — the editor is mounted (`:2037`) but its field list is built only from `ds.columns` minus JSON (`:841-872`) |
| Slicer bound to a payload/virtual field | Report Builder runtime filters | ✗ — `getSlicerFieldOptions` uses `ds.columns` only (`:874-906`) |

Meanwhile the **engine already understands all of it**: `report_definition_for_visual()` deep-copies the visual's query and hands it to `report_engine`, and `_validate_source_spec()` accepts `payload_path` (tickets: `field_code` + `path`; ledger: `json_column` + `path`), `json_path`, `virtual` and `ticket_field` (`report_engine.py:160-200`). I validated a dashboard visual containing a `payload_path` column and a `payload_path`-bound slicer against `validate_analytics_definition(..., strict_visuals=True)` — both pass. The gap is therefore **the Studio UI plus three small backend additions**, not the query engine.

### 6.2 Additional Studio-specific blockers (found while tracing)

* `buildQueryFromDataset()` filters JSON columns out of the auto-built columns (`AnalyticsBuilder.jsx:154-156`) and hard-codes the source (`:188-194`: `operation_type_codes: []`, `template_ids: []`, `statuses: ['Approved']`), so a Studio visual can never be pointed at Draft/Submitted tickets or a specific operation type — a parity gap in its own right.
* `allDatasets` drops `json_columns`, `location_columns`, `date_columns` and `relationships` when it maps `catalog.tables` (`AnalyticsBuilder.jsx:327-334`), so even the table datasets lose the metadata the picker would need.
* `_resolve_missing_slicer_column()` (`analytics_engine.py:606-680`) can inject `column` and `virtual` specs but **not** `payload_path`; a slicer on a payload field that is not already a displayed column falls through to the `ticket_field` branch (or fails strict validation) — silently wrong rather than loudly wrong.
* The analytics catalog hard-codes `virtual_fields: []`, `supports_payload_json: false`, `supports_template_fields: false` for the three synthetic datasets (`analytics.py:331-392`). For `tank_snapshot` / `material_balance` / `tracking_status` that is *correct* (their rows are built by the engine, there is no payload to split), but the flag currently reads as "Analytics has no payload support at all" and the UI has no honest place to say "JSON splitting is available for Operation Tickets and Tank Stock Ledger, not for this engine dataset".
* Analytics `GET /analytics/lookups` (`analytics.py:397-420`) returns only users/roles/locations/asset_types — no `operation_types`, `templates`, `statuses`, `products`, no `formula_help`/`operator_help`/`date_bases` (`report_builder.py:318-336` has all of them). Studio therefore cannot offer the source selectors or the formula help that Report Builder has.

### 6.3 Fix design

**Backend (small, additive):**

1. `POST /analytics/json-paths` in `analytics.py` — same body/response as `report_builder.post_json_paths` (`report_builder.py:343-405`). Implement by delegating to the existing function's body (extract it into `report_catalog.discover_json_paths_for(db, user, request)` and call it from both routers) so behaviour cannot drift.
2. `GET /analytics/operation-fields` — thin wrapper over `discover_operation_fields()` (already used by Report Builder, `report_catalog.py:615-700`).
3. `_resolve_missing_slicer_column()` — add a `payload_path` branch: if the column key matches a declared payload column of the visual (`source.type == 'payload_path'` with the same key) or an explicit `slicer.payload` descriptor (`field_code` + `path`), inject `{"type": "payload_path", "field_code": …, "path": …}` instead of falling back to `ticket_field`.
4. `validate_analytics_definition()` — allow a visual's `query.columns` entry with `source.type == "payload_path"` to satisfy slicer binding in the `exposed` map (`:939-956`); today it already does because it copies all query columns, but add a regression assertion in the manual matrix.
5. Extend `GET /analytics/catalog` with `formula_help`, `operator_help`, `date_bases` (reuse the Report Builder constants, `report_builder.py:318-336`) and add `operation_types`, `templates`, `statuses`, `products` to `GET /analytics/lookups` (copy the queries from `report_builder.py:420-488`, respecting `get_user_report_location_codes`).
6. Keep `supports_payload_json: false` on the three synthetic datasets, but add `"payload_note": "Engine dataset — rows are computed; JSON splitting applies to Operation Tickets and Tank Stock Ledger."` so the UI can explain itself.

**Frontend (`frontend/src/pages/AnalyticsBuilder.jsx` + a small new component):**

7. New `frontend/src/components/analytics/AnalyticsJsonPanel.jsx` (or reuse `reportBuilder/JsonColumnPicker` directly, which is already generic — it only needs a `discoverJsonPaths` prop/API): lists the payloads/paths available for the selected dataset.
   * `operation_tickets` → `GET /analytics/operation-fields`, filter `is_payload` → choices → "Split into columns".
   * `tank_stock_ledger` → the `source_payload` JSON column → "Split into columns".
   * `table:*` datasets → each `json_columns` entry → "Split JSON".
   * Hide the panel with the honest note for `tank_snapshot` / `material_balance` / `tracking_status`.
8. Field explorer (`filteredDatasetFields`, `:826-839`) becomes a list of **sections**: `Derived fields (virtual_fields)` → `Data columns` → `JSON / payload fields` (collapsed, with a "Add…" button that opens the picker). Keep the checkbox behaviour for plain columns.
9. `toggleFieldOnSelectedVisual` (`:615-670`) generalised to accept a full `source` descriptor, so it can add `{type:'virtual', field}` and `{type:'payload_path', field_code|json_column, path}` with a de-duplicated safe key (`makeSafeKey(label)` + numeric suffix), correct `data_type`, and `aggregate` only when grouped.
10. `visualConditionFields` (`:841-872`) and `getSlicerFieldOptions` (`:874-906`) gain virtual + payload entries. For filters/slicers the widget must carry the descriptor, not just a key: store `{column_key, source}` on the filter and `{column_key, source}` on the slicer, and extend `_slicer_column_key()` / `_ensure_column()` so the backend resolves them (see item 3).
11. `buildQueryFromDataset()` (`:154-156`) — stop dropping JSON columns from the *available* list (keep them out of the auto-picked default columns only).
12. `allDatasets` (`:327-334`) — pass through `json_columns`, `relationships`, `location_columns`, `date_columns`.
13. Add a real **source restrictions** editor (statuses, operation types, templates, date basis) so the hard-coded `['Approved']` is a default rather than a fact.
14. Keep everything optimistic and non-blocking: if the payload picker returns nothing (no saved values yet), show "No saved values for this payload yet" rather than an error.

**Result:** a Studio visual can show `Ticket No, GSV (BBL), NSV (BBL), Tank, Ullum…` exactly like the Report Builder report, and those payload columns can be used in group-by, filters, slicers, KPI/measure selection, comparison rules and drill-through.

---

## 7. Issue 5 — the rest of the parity review (ranked, all evidence-backed)

| Feature | Report Builder | Analytics Studio | Recommendation |
|---|---|---|---|
| Source restrictions (statuses / operation types / templates) | full editor | hard-coded `['Approved']`, no editor (`AnalyticsBuilder.jsx:188-194`) | **Add** — without it Studio can't reproduce most shipped reports |
| Date basis choices | 6 including `COLUMN` + `NONE` | 2, one of which is invalid (`:1848`) | **Fix** (blocking save) |
| Virtual/payload fields | full | none | **Add** (§6) |
| Split JSON picker | yes | none | **Add** (§6) |
| Formula help / operator help / function list | in catalog | absent | **Add** (cheap, same constants) |
| Lookups for operation types / templates / statuses / products | present | absent | **Add** |
| Sort editor | yes | none (`sort: []`, no UI) | Add later (low value in dashboards, but grouping order matters for LINE/COLUMN) |
| Hidden columns | yes | none (all Studio columns are visible) | Add later with the sort editor |
| Matrix (`report_type: MATRIX` + `matrix{}`) | yes | `MATRIX` visual exists but no matrix config UI | Add later, or hide the `MATRIX` type until configured |
| Drill-through from Studio | n/a | absent (`AnalyticsVisual` supports `onInspectRecords`, Builder doesn't pass it: `AnalyticsBuilder.jsx:1287-1301`) | **Add** — one prop + reuse the Viewer's modal; solves "I can't see the rows behind this number" inside Studio |
| Row-count / warning surfacing | `meta.warnings` shown | warnings only in the tank renderer | Add a visual footer chip (scanned/filtered rows, warnings) |
| Catalog per-user isolation flags | `is_admin` | `is_admin` | OK |
| Export | report export | visual/workbook export | OK (but normalise the definition first — §3.3 item 5) |
| Slicer bound to a payload field | runtime filters | not possible until §6 | covered by §6 |

---

## 8. Implementation order (after approval)

**Phase 1 — Environment & diagnosability (no behaviour change)**
`frontend/vite.config.js`, `frontend/scripts/mock-api.mjs`, `backend/app/main.py` (`/health` build info), `frontend/src/api/apiClient.js` (one-time stale-backend banner), `frontend/src/App.jsx` (banner mount). Plus the operational step: rebuild the backend.
*Accept:* `curl /health` reports the same sha as `git rev-parse --short HEAD`; the three failing calls return `200`/`401` against `:8000`; `dev:mock` returns real 404s for unimplemented paths.

**Phase 2 — Tank engine correctness**
`backend/app/services/analytics_engine.py` (`_run_tank_snapshot_visual` scope resolution + as-of date + empty-state warnings), `frontend/src/components/analytics/TankVisualRenderer.jsx` (message only), `frontend/src/pages/AnalyticsViewer.jsx` + `AnalyticsBuilder.jsx` (explicit scope intent).
*Accept:* GLOBAL dashboard as admin shows tanks in Viewer **and** Studio preview with empty `location_codes`; LOCATION dashboard unchanged; a preview date range no longer removes tanks; filter_breakdown appears in the empty state.

**Phase 3 — Studio 400 hardening**
`AnalyticsBuilder.jsx` (date-basis list from catalog, `OPERATIONAL_DATE`→`OPERATION_DATE` migration, stable visual/slicer ids, schema-version migration on load), `backend/app/services/analytics_engine.py` (error text includes visual title), `backend/app/routers/analytics.py` (nothing structural).
*Accept:* every Studio save path returns 200 or a message that names the offending visual; `OPERATIONAL_DATE` can no longer be produced.

**Phase 4 — JSON/payload parity (the big one)**
Backend: `analytics.py` (+`/json-paths`, +`/operation-fields`, catalog help, richer lookups), `analytics_engine.py` (`_resolve_missing_slicer_column` payload branch, `_ensure_column` descriptor support), `report_catalog.py` (extract reusable discovery helper), `report_builder.py` (call the helper).
Frontend: new `AnalyticsJsonPanel.jsx`, `analyticsApi.js` (+3 helpers), `AnalyticsBuilder.jsx` (field explorer sections, generic toggle, filter/slicer descriptors, source restrictions editor), `ComparisonConditionsEditor` reuse.
*Accept:* see the matrix below rows 5-9.

**Phase 5 — Parity polish**
Drill-through inside Studio, sort/hidden editors, visual footer with counts/warnings, `export_visual` normalisation, docs (`ANALYTICS.md`, `REPORT_BUILDER.md`).

**No database migration** is required; all changes are additive JSON-definition fields, and existing definitions remain valid (new keys are optional and default to today's behaviour).

---

## 9. Manual verification matrix (no pytest, no GH checks)

| # | Check | Expected |
|---|---|---|
| 1 | `curl :8000/openapi.json` contains `/analytics/lookups` and `.../records` | present; Studio loads with 0 console 404s |
| 2 | `npm run dev` **without** `MOCK_API`/`API_PROXY_TARGET` | dev server refuses to start (or warns loudly) instead of 404-ing `/api` |
| 3 | `dev:mock` → open Studio | catalog/lookups/preview answer from the mock; an unimplemented path returns a real 404 message |
| 4 | GLOBAL dashboard (admin) → tank visual in Viewer and in Studio preview | tank cards render; `meta.scope` lists the locations used |
| 5 | Same dashboard with a Preview date range that excludes the newest ledger date | tanks still render (live snapshot) |
| 6 | LOCATION dashboard → tank visual | unchanged from today (works) |
| 7 | Studio → Operation Tickets dataset → explorer | sections show `Dates (from ticket answers)`, `Names (looked up)`, `Data columns`, `JSON / payload fields` |
| 8 | "Split into columns" → pick `calculated.gsvBbl` | column appears on the visual, preview shows values, can be used as a measure |
| 9 | Same payload column used in a fixed filter, a slicer, and a comparison rule | each saves (200) and affects results identically to Report Builder |
| 10 | Re-add a deleted slicer; duplicate a visual twice quickly | no `400 …unique id/key` |
| 11 | Open a dashboard saved by the previous release | loads, previews, saves (schema migrated) |
| 12 | Studio visual → drill-through | rows for that visual appear (after Phase 5) |

---

## 10. Risks & rollback

* **Phase 2** changes tank discovery for unrestricted users only (restricted users already fall back to `sorted(scope)`); worst case is "more tanks shown", never "another location's data", because `_runner_params`/`run_preview` still clamp scope and `_resolve_visual_location_scope` still intersects a fixed visual location.
* **Phase 3** updates stored definitions on the next save — reversible by restoring a version snapshot (`/analytics/definitions/{id}/revert`).
* **Phase 4** is additive; if a payload column is removed from the catalog later, strict validation returns a named 400 instead of silent wrong data (an improvement).
* Every phase is independently shippable; Phases 1 and 2 alone restore the tank visuals.

---

## 11. Decisions I need from you before implementing

1. **Tank scope default** — when a dashboard/caller sends no locations, should an unrestricted user see *all locations with tank data* (my proposal), or only the dashboard's location (if any) plus a picker in the viewer? (This changes what "Global dashboard" means for tank visuals.)
2. **Payload splitting in Studio** — do you want *all* payload paths surfaced (including the "one row per item / per tank" wildcard splits, which change row grain), or plain scalar paths only for the first iteration?
3. **`MATRIX` visual** — expose a matrix config UI, or hide `MATRIX` in Studio until it is configurable?
4. **Parity scope** — is Phase 5 (drill-through in Studio, sort/hidden editors) in this round, or Phases 1-4 only?
