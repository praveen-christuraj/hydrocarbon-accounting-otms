# Analytics Dashboard — Fix Plan (for approval)

**Status:** Plan only. No implementation performed. No pytest / CI / GitHub checks run.
**Branch:** `arena/66f74c74-hydrocarbon-accounting-otms`
**Scope:** Published Analytics dashboard (`AnalyticsViewer`) — drill-through records, location scope, print, shore-tank visual.

---

## 1. Executive summary

| # | Reported symptom | Exact code-level cause | Proposed fix |
|---|------------------|------------------------|--------------|
| 1 | Dashboard shows data, **Inspect underlying source records** shows no records | Viewer keeps *two* filter states: the dashboard is rendered from the last executed payload, but `handleInspectRecords()` (and exports) build a fresh payload from the current, possibly unapplied, UI state (`AnalyticsViewer.jsx:81-110, 249-256, 280-320, 449-487`). Additionally `run_dashboard()` strips dates for `date_basis: NONE` visuals (`analytics_engine.py:2027-2030`) while `run_visual_records()` does not (`analytics_engine.py:1954-2003`), and the records endpoint runs the **raw** saved visual while the dashboard runs the **normalised** visual (`analytics.py:1042` vs `analytics_engine.py:2007`). | Snapshot the exact payload of the last successful run and use it for inspect/export/print; centralise date handling for both run paths; normalise the visual before running records; expose filter diagnostics in the records modal. |
| 2 | Location fixed at design time makes the location slicer useless | `get_my_dashboard()` always returns `available_locations` and the Viewer always renders the Locations slicer (`analytics.py:656-669`, `AnalyticsViewer.jsx:449-483`), but `_runner_params()` forcibly replaces `location_codes` with `[dashboard.location_code]` for `LOCATION` dashboards (`analytics.py:266-267`). A second, newer problem: the per-visual `Location Override` **replaces** the runner scope instead of intersecting it (`analytics_engine.py:1110-1112`). | Lock the global Locations control for `LOCATION` dashboards (read-only scope chip). Convert the per-visual location setting from an *override* into an *intersection* with the runner scope, so global slicers still narrow within the fixed scope and no data from outside the dashboard scope can leak. |
| 3 | Print button returns a blank page | Global print CSS hides everything except `.printable-report` (`index.css:1739-1758`, plus the compact layer at `index.css:6474-6485`). The Viewer only wraps the company header (`:368`) and footer (`:534`) in `.printable-report`; every visual lives in `<GridStackCanvas>` (`:506`) **outside** any printed container. Both header/footer wrappers are also absolutely positioned at `left:0; top:0` in print, so they overlap. | One printable report wrapper containing company header → print canvas → company footer. Render a dedicated print canvas from the same `results` and canonical 12-column layout. Use `requestPrint({ onBeforePrint, onAfterPrint })` to mount/size charts before `window.print()`, then restore the interactive canvas. |
| 4 | Tank visual shows "No active shore tanks" (worked 2–3 commits ago) | Commit `6a49c7e` changed tank discovery from "all active assets with ledger/calibration in scope" to a whitelist: per-visual `asset_type_codes` gates discovery (`analytics_engine.py:1143-1150`), `_is_shore_tank_asset()` excludes by asset-family/keyword (`analytics_engine.py:1236-1252`), and `source.location_code` overrides runner scope (`:1110-1112`). The fallback that rescues unknown tank types only runs when **zero** tanks were already found (`:1254-1262`). The empty message itself is `TankVisualRenderer.jsx:90-96`. | Keep every per-visual filter, but make discovery **evidence-first** (ledger rows / active calibration + active assignment), apply type/fixed/slicer/cross-filter as row-level predicates, intersect location scope, and return warnings that explain exactly which filter removed rows. Fix tank-visual detection to be source-kind-first. |

---

## 2. Detailed findings and fix design

### Issue 1 — "Inspect underlying source records" returns no records

#### Confirmed code path

1. `AnalyticsVisual.jsx:365-375` renders the database icon; `AnalyticsViewer.jsx:280-295` handles the click:
   ```js
   const data = await getAnalyticsVisualRecords(dashboard.id, visual.id, buildRunnerPayload())
   ```
2. `buildRunnerPayload()` (`AnalyticsViewer.jsx:81-88`) reads `dateFrom/dateTo/singleDate/selectedLocations/runtimeValues/selectionFilters` from React state.
3. Those values are only sent to the backend on **Apply & Refresh** (`onApply` at `:487`), date presets, or cross-filter clicks (`:225-246`). Changing a date input, single date, runtime slicer, or location (`onRuntimeValueChange`, `onDateRangeChange`, `handleLocationsChange`) merely updates state — the dashboard keeps showing the previous result set.
4. The records modal therefore applies filters the user has *not yet applied* to the dashboard. If the new filter value has no matching rows, `PerspectiveGrid.jsx:499-505` renders "No rows matched the selected filters." This exactly matches "dashboard shows data, inspect shows no records".
5. The same mismatch affects `handleExportVisual()` (`:300-308`) and `handleExportWorkbook()` (`:310-322`), and the print header subtitle which reads unapplied `effectiveDateWindow`.

#### Backend asymmetries (also confirmed)

* `run_dashboard()` removes `date_from`/`date_to` when `visual.query.date_basis === 'NONE'` (`analytics_engine.py:2027-2030`). `run_visual_records()` never does this. At least one shipped blueprint uses `date_basis: 'NONE'` (master-data KPI in `frontend/src/utils/analyticsEngine.js:1882`). Those visuals show data on the dashboard and return zero rows on drill-through whenever a global date window is active.
* `run_dashboard()` runs `validate_analytics_definition()` first and passes normalised visuals (`analytics_engine.py:2007`); the records endpoint looks up the raw visual in `dashboard.definition_json` (`analytics.py:1042`). Older/partially saved definitions can therefore execute differently in the two paths.
* `run_visual()` uses `ignore_source_match=True` so a cross-filter from a visual does not blank that same visual; `run_visual_records()` deliberately uses `False` (comment at `analytics_engine.py:1987`). That is intentional, but grouped/bucketed keys (e.g. a DAY-bucketed date) may not equal a raw source value, so an `eq` cross-filter can yield zero drill-through rows. This is a secondary risk to handle in the same pass.

#### Fix steps

1. In `AnalyticsViewer.jsx`:
   * Add `lastAppliedPayloadRef` (and a `pendingFilters` boolean for UI feedback).
   * In `runBatch()`, save the exact payload only after a successful `runAnalyticsDashboard()` response. Initial auto-run, presets, cross-filters, Apply, and Reset all go through `runBatch()`, so the ref is always the payload that produced the visible `results`.
   * `handleInspectRecords()`, `handleExportVisual()`, `handleExportWorkbook()`, and print use `lastAppliedPayloadRef.current ?? buildRunnerPayload()`.
   * Show a small "Filters changed — click Apply & Refresh" hint in `SlicerBar` when current UI state differs from the applied snapshot. Never silently use unapplied state for a data request.
2. Extract a shared backend helper, e.g. `_visual_execution_params(visual, params)`, that applies the `date_basis === 'NONE'` rule. Call it from **both** `run_dashboard()` and `run_visual_records()` (and from the visual export endpoint for consistency).
3. In `get_visual_underlying_records()` (`analytics.py:1029-1050`), normalise the definition before selecting the visual (reuse `validate_analytics_definition(definition, strict_visuals=False)`) so records and dashboard operate on the same visual shape.
4. For cross-filter translation, when the clicked column is a bucketed group key, convert the grouped value to a raw-source predicate (e.g. DAY bucket `2026-11-26` → `>=`/`<` range, or match on the raw key) before injecting the extra filter. Do not drop the user's "filter for each visual" requirement — keep the filter, make it valid against ungrouped rows.
5. In the records modal, display `meta.scanned_rows`, `meta.filtered_rows`, `meta.total_rows`, warnings, and the applied filter chips. Replace the generic "No underlying records available." with an actionable message (`Applied filters removed all source rows — reset drill-through filters`) and a one-click "Clear drill-through filters" action.

---

### Issue 2 — Fixed location vs. location slicer

#### Confirmed behaviour

* `get_my_dashboard()` returns all in-scope locations regardless of `dashboard.scope_type` (`analytics.py:656-669`).
* `AnalyticsViewer.jsx:449-483` always renders `<SlicerBar availableLocations=... selectedLocations=...>`.
* `_runner_params()` (`analytics.py:259-285`) then ignores the selection entirely:
  ```py
  if dashboard.scope_type == "LOCATION":
      params["location_codes"] = [dashboard.location_code]
  ```
  So the control changes UI state but cannot change results. `handleClearAllFilters()` also resets to the fixed location (`:256-272`).
* Newer per-visual setting: `_run_tank_snapshot_visual()` (`analytics_engine.py:1110-1112`) does:
  ```py
  if visual_loc:
      requested_codes = [visual_loc]   # runner/slicer codes discarded
  ```
  This can display tanks from a location outside the dashboard scope (still constrained by the user's report scope) and silently ignores the slicer.

#### Chosen solution (recommended over simply disabling everything)

1. **Dashboard-level fixed location → lock the slicer.** Pass `locationLocked={dashboard.scope_type === 'LOCATION'}` to `SlicerBar`. Render a disabled/read-only chip showing `dashboard.location_code` with tooltip `Location is fixed in this dashboard's scope`; keep date, custom slicers, and cross-filters fully active. Do not send location changes for locked dashboards. Hide location from "Clear all" semantics (reset other filters only).
2. **Visual-level fixed location → intersection, not override.** Add a backend helper:
   ```py
   runner_codes = {normalize_location_code(c) for c in params.get("location_codes") or [] if c}
   fixed_code = normalize_location_code(source_cfg.get("location_code") or query_cfg.get("location_code"))
   if fixed_code:
       allowed_codes = [fixed_code] if (not runner_codes or fixed_code in runner_codes) else []
   else:
       allowed_codes = sorted(runner_codes)
   ```
   If the intersection is empty, return an empty result **with a warning** (`This visual is restricted to X, outside the dashboard/slicer scope`) instead of silently showing another location. This preserves `_runner_params()` as the single authority for dashboard scope.
3. Apply the same intersection rule to Material Balance (`analytics_engine.py:1459-1463` currently raises an error on mismatch) so all fixed-location visuals behave consistently.
4. Builder UI: rename "Location Override (optional)" (`AnalyticsBuilder.jsx:1622`) to "Restrict this visual to a location"; explain that it narrows the dashboard/slicer scope and cannot widen it. For `LOCATION` dashboards, prefill/disable it at the dashboard location.
5. Print header subtitle uses the applied location scope from the payload snapshot (not the stale UI state).

No migration is needed; existing definitions remain valid. A visual whose fixed location is outside the dashboard scope will now correctly show the new warning instead of wrong data.

---

### Issue 3 — Print produces a blank page

#### Confirmed CSS/DOM mismatch

* `index.css:1739` — `.printable-report { display: none; }` on screen.
* `index.css:1745-1758` — in print, `body * { visibility: hidden; }`; only `.printable-report` and its descendants become visible; those blocks are absolutely positioned at `left:0; top:0`.
* `index.css:6474-6485` (last/compact layer) also hides `.no-print` and all dialogs.
* `analytics.css:1890-1901` only hides visual action buttons/shelves and prevents card breaks. It never makes the GridStack canvas printable.
* `AnalyticsViewer.jsx` structure: `.printable-report` (header `:368`) → `.no-print` header (`:381`) → `.no-print` slicer bar (`:450`) → `GridStackCanvas` (`:506`) → `.printable-report` (footer `:534`). Therefore the only printed content is the header and footer, both stacked at the same absolute position, with no visuals between them.

#### Fix design

1. **One printable surface.** Add a new component `AnalyticsPrintCanvas.jsx` and a single wrapper in `AnalyticsViewer.jsx`:
   ```jsx
   <div className="printable-report analytics-print-report">
     <CompanyPrintHeader ... />
     {printMode ? <AnalyticsPrintCanvas .../> : null}
     <CompanyPrintFooter ... />
   </div>
   ```
   Keep the current on-screen header/slicer/GridStack markup unchanged for normal use. Remove the two standalone `.printable-report` wrappers.
2. **Print canvas uses the same data and layout.** `AnalyticsPrintCanvas` receives `visuals`, `results`, `activeLayout` (already normalised by `normalizeLayoutForGridStack`), `definition.canvas`, and the same `renderVisual` callback used by `GridStackCanvas` — but with `printMode` so action icons/shelves/selectors are not rendered. It uses a 12-column CSS grid with `grid-column: x+1 / span w`, `grid-row: y+1 / span h`, and row height derived from `definition.canvas.cellHeight`. This preserves the published arrangement (including session-arranged layout) rather than reflowing visuals arbitrarily.
3. **Prepare charts before printing.** Use the provider hook that already exists:
   ```js
   requestPrint({
     module: 'Analytics',
     reportName: dashboardName,
     onBeforePrint: async () => {
       setPrintMode(true)
       await new Promise((resolve) =>
         requestAnimationFrame(() => requestAnimationFrame(resolve)))
     },
     onAfterPrint: () => setPrintMode(false),
   })
   ```
   `PrintProfileProvider.jsx:230-244` awaits `onBeforePrint`, so ECharts/Plotly canvases are mounted and sized before `window.print()`. `print-color-adjust: exact` keeps chart/tank colours.
4. **Print CSS** (add at the end of `analytics.css` so it wins after all `index.css` blocks):
   * `.analytics-page .printable-report { display: block !important; position: static !important; width: 100% !important; visibility: visible !important; }`
   * hide all siblings of the printable wrapper in print (existing `body * {visibility:hidden}` already does this, but add `display:none` for `.no-print` and the GridStack shell to avoid reserved space);
   * `.analytics-print-grid` page-break rules: cards `break-inside: avoid`, tables may paginate, `thead { display: table-header-group; }`;
   * no changes to the shared A4-landscape compact layer.
5. Keep the print profile prompt and company header/footer behaviour unchanged.

Result: one PDF document with company header, all visual cards in the same 12-column arrangement, and company footer — not a blank page.

---

### Issue 4 — Tank visual: "No active shore tanks"

#### History (why it worked before)

| Commit | Change relevant to tank visuals |
|--------|----------------------------------|
| `5b29c63`, `245d10f` | Analytics overhaul introduced the tank visual. Discovery was simple: active assets in scope + active ledger rows + active calibration capacity. |
| `601873c` | Added dashboard slicers and per-visual fixed filters. `_row_matches_tank_filters()` (`analytics_engine.py:906`) and `_snapshot_row_matches_fixed_filters()` (`:1003`) began filtering tank rows. |
| `6a49c7e` (latest, "Fix Analytics Studio 400/404, Tank Levels & Tracking bugs…") | Added `_is_tank_snapshot_visual()` heuristic (`:468`), per-visual `source.location_code` override (`:1110`), `asset_type_codes` allow-list (`:1143-1150`), `_is_shore_tank_asset()` family/keyword whitelist (`:1236-1252`), evidence-based ledger discovery and location dedupe. Renderer gained LT/MT units and `(location, code)` dedupe (`TankVisualRenderer.jsx`). |

The empty-state text the user sees is `TankVisualRenderer.jsx:90-96`; it appears whenever `result.rows` is empty. All rendering changes in `6a49c7e` are cosmetic — the regression is in `_run_tank_snapshot_visual()`.

#### Exact failure modes introduced

1. **Location override replaces scope** (`:1110-1112`). A fixed visual location discards dashboard/slicer locations. If that location has no active tanks/ledger rows, the visual is empty and the location slicer cannot fix it.
2. **Asset-type allow-list gates discovery** (`:1143-1150`, and `if not explicit_types:` at `:1264-1272`). When any type is selected, ledger-only tanks and tanks whose master type differs from the selection are excluded before filters are applied.
3. **Keyword/family whitelist can drop calibrated tanks.** `_is_shore_tank_asset()` rejects assets whose type resolves to a tracking family or contains mobile keywords, and only accepts generic types containing `tank`/`stk`/`silo`. Ledger-backed assets are accepted early, but tanks with **only calibration capacity** and installation-specific type codes can be dropped. The fallback at `:1254-1262` runs only when *no* asset passed the whitelist, so one unrelated "tank-like" asset can suppress it.
4. **Detection heuristic is inverted for custom tank visuals.** `_is_tank_snapshot_visual()` (`:468-482`) returns `False` for a `TANK_VISUAL` whose columns contain `tank_asset_code`/`current_stock`/etc., sending it to `report_engine` with an unsupported `tank_snapshot` source. Source kind should be authoritative.
5. **Global date window as an as-of filter** (`:1120-1133`) can remove all ledger rows for a "live levels" visual. This is data-dependent, but it produces the same empty state.

#### Fix design — preserve every per-visual filter

Rewrite discovery in `_run_tank_snapshot_visual()` as **evidence first, filters second**:

1. Resolve location with the intersection helper from Issue 2. Record the effective scope in `meta` for the UI.
2. Load all active ledger rows in scope **before** classification (already done at `:1134-1141`), and additionally collect the set of asset codes with **active calibration tables** before classification (currently capacity is loaded later, at `:1300+`).
3. Build candidates from: active `Asset` in scope, active `AssetAssignment` in scope, ledger tank codes, and calibrated asset codes.
4. Include an asset when any of these is true:
   * it has a ledger row in scope, or
   * it has an active calibration table (real stock/capacity evidence), or
   * its type text/code indicates a shore tank (`tank`, `stk`, `silo`) and it is not a tracking/mobile family.
   Apply the visual's `asset_type_codes` selection as a **row-level predicate**, not as a gate that disables ledger/calibration discovery. Mobile assets (barge/tanker/vessel/FSO/shuttle) remain excluded unless they have explicit shore-tank evidence.
5. Keep `_snapshot_row_matches_fixed_filters()` and `_row_matches_tank_filters()` exactly in place — the per-visual filters the user needs stay functional — but collect `meta.filter_breakdown` (candidates, after evidence, after type filter, after fixed filters, after slicers/cross-filters) and warnings such as `Filter product_name = 'X' removed 4 of 5 tanks`.
6. Treat tank snapshots as live visuals by default (no global date window) unless the visual explicitly opts into an as-of date; set `date_basis: 'NONE'` for tank snapshot visuals during normalisation so `run_dashboard()` and `run_visual_records()` agree.
7. Simplify `_is_tank_snapshot_visual()` to: `source.kind === 'tank_snapshot' || visual.type === 'TANK_VISUAL'` (unless the source was explicitly changed to a supported standard kind). Remove the contradictory column-key heuristic.
8. Update `TankVisualRenderer` empty state to use `meta` warnings (e.g. `Visual restricted to LOC-A — no tanks in scope` vs `3 tanks filtered out by product = X`), while leaving the tank cards/unit pills/dedupe unchanged.

No per-visual filter is removed; filters become transparent and non-destructive to tank discovery.

---

## 3. Implementation order

1. **Backend shared helpers first** (`analytics_engine.py`, `analytics.py`): applied-date handling, location intersection, normalised records visual, tank discovery rewrite + warnings.
2. **Viewer state contract** (`AnalyticsViewer.jsx`): applied payload ref, pending-filter indicator, records/export/print use applied payload.
3. **Location lock** (`SlicerBar.jsx`, `AnalyticsViewer.jsx`, `AnalyticsBuilder.jsx`): dashboard-level lock + visual-level wording.
4. **Print surface** (new `AnalyticsPrintCanvas.jsx`, `AnalyticsViewer.jsx`, `analytics.css`): single printable wrapper, print-mode toggle via `onBeforePrint`/`onAfterPrint`, print CSS.
5. **Tank empty-state messaging** (`TankVisualRenderer.jsx`) using backend `meta`.

**Files expected to change:** `backend/app/services/analytics_engine.py`, `backend/app/routers/analytics.py`, `frontend/src/pages/AnalyticsViewer.jsx`, `frontend/src/pages/AnalyticsBuilder.jsx`, `frontend/src/components/analytics/SlicerBar.jsx`, `frontend/src/components/analytics/AnalyticsVisual.jsx` (printMode prop only), new `frontend/src/components/analytics/AnalyticsPrintCanvas.jsx`, `frontend/src/components/analytics/TankVisualRenderer.jsx`, `frontend/src/styles/analytics.css`. No schema/DB migration.

---

## 4. Manual verification matrix (no pytest, no GH checks)

| # | Check | Expected |
|---|-------|----------|
| 1 | Change a date/runtime/location slicer **without** pressing Apply, then inspect a visual | Records match the rows still shown on the dashboard; "pending filters" hint is visible; after Apply, records match the new state. |
| 2 | Open drill-through on a `date_basis: NONE` master-data KPI with a date window set | Rows are returned (date window ignored consistently in both paths). |
| 3 | LOCATION-scoped dashboard | Locations control is locked with a visible fixed-location chip; date/custom slicers and cross-filters still rerun visuals. |
| 4 | GLOBAL dashboard, tank visual restricted to `LOC-A`, slicer set to `LOC-B` | Empty result with explicit "visual restricted to LOC-A / outside slicer scope" warning; selecting `LOC-A` shows tanks; no visual ever shows `LOC-B` data. |
| 5 | Tank visual with an asset-type selection and a calibration-only tank | Tank still appears when it has calibration/stock evidence; mobile assets stay excluded; fixed product/fill filters still remove only their matches. |
| 6 | Tank visual with and without cross-filter | Dashboard card is not blanked by its own cross-filter; inspect records honours the same filter and shows the matching tank rows. |
| 7 | Print any published dashboard (table, chart, KPI, tank visual) | Single PDF with header, all cards in the same arrangement, charts/tanks/tables visible, footer; no blank page; controls/slicers absent. |
| 8 | Build check only | `npm --prefix frontend run build` succeeds. No pytest / CI / gh commands. |

---

## 5. Decisions with recommended defaults

* **Print size:** keep the existing global A4-landscape compact layer; scale the 12-column grid to fit page width. If pixel-identical sizing is required, we can switch the print surface to an A3 landscape page and preserve `cellHeight` in mm — say so at approval and I will use that instead.
* **Tank date semantics:** recommended default is "live" (ignore global date range for tank snapshot visuals). If you want an as-of-date mode, I will expose it as an explicit per-visual filter rather than reusing the global date slicer.
* **Unapplied slicers:** recommended behaviour is "show a pending hint; drill-through/export use the last applied payload". Alternative is auto-rerun on every slicer change (more queries, slower); tell me if you prefer auto-rerun.

---

**Awaiting approval to implement.**

---

## 6. Additional approved change — KPI delta toggle

KPI cards can now hide the green/red comparison percentage:

* `style.kpi.showDelta` (default `true`) is normalised in `analytics_engine.py`, so existing dashboards keep their current behaviour.
* Studio → Style & Interactions now has **Show Comparison Delta % (green / red)** for KPI-style visuals.
* `KpiCardRenderer` skips the delta badge when the toggle is off; sparkline, target progress and the headline value are unaffected.
