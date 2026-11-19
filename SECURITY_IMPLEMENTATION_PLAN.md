# Hydrocarbon Accounting OTMS — Security Implementation Plan

**Date:** 2026-11-19
**Branch:** `arena/5b8ad7e2-hydrocarbon-accounting-otms` (base `aec2b66b6f1f81151b4b092a62165eb88cf527f6`)
**Source of findings:** `Hydrocarbon_Open_Security_Issues.xlsx` (5 tabs: Open Issues 1–8, Hardening H-01–H-07, Doc/claim mismatches D-01–D-04, Checked-not-issues N-01–N-12, How-to-read)
**Status of this document:** The plan was prepared before implementation; implementation is now underway on the branch above. No live database was touched. Code references below describe the pre-implementation checkout.

---

## 0. Ground rules (agreed constraints)

1. **No changes to users, passwords, password hashes, password history, roles, role assignments, sessions, tokens, or TOTP enrollment state.** No password resets, no rehashes, no user recreation, no role reseeding, no forced sign-outs.
2. **No changes to existing operational data.** Dashboard configs/versions, barge seal rows, transactions, ledgers, etc. are not rewritten, reseeded, reassigned, or "cleaned up" by this plan. The only permitted new database writes are **audit-log rows** (OI-06, and audit fields that already exist), and — **only if separately approved after a read-only count** — **TOTP ciphertext re-encryption** (OI-08), which changes ciphertext only, never the underlying secret, flags, or codes.
3. **Barges are Global only.** Per the owner: there are no local barges; a barge seal is shared and any location holding the applicable permission (`View Barge Seal Master` / `Edit Barge Seal Master`) may read/update it. The implementation still checks the linked asset's `asset_scope` so that a misconfigured Local barge asset cannot be read/written cross-location — see OI-02.
4. **Keep existing permissions and legitimate workflows.** The governing rule: enforce *record scope* where the permission alone is not enough. `View Dashboard` means "may use the dashboard", not "may see every terminal's data". Global assets and Global dashboard layouts remain shared; the location check applies only to Local/location-bound records.
5. **No existing functionality may break:** login + 2FA + refresh, delegated role administration, imports/exports, print/report parity, dashboard location selection and the Global fallback in `Dashboard.jsx`, Operation Entry seal autofill, backup/restore.

---

## 1. What was verified in the code (basis of this plan)

| Workbook claim | Verified in checkout |
|---|---|
| OI-01: `/dashboard/data` gateway only checks `View Dashboard`; params validated for type/requiredness, not scope | Yes — `backend/app/routers/dashboard.py:1458-1540`; 8 handler keys in `VALID_DASHBOARD_HANDLER_KEYS` (:60-69): `FSO_OTR`, `FSO_MATERIAL_BALANCE`, `FSO_OUTTURN`, `SHUTTLE_SUMMARY`, `TANK_STOCK_SNAPSHOT`, `ASSET_LIST`, `OP_TRANSACTIONS`, `OP_STATUS_COUNTS`. FSO builders in `reports.py:1560/1678/1785` take no user. `build_shuttle_summary_rows` in `dashboard.py:454` applies **no scope when `location_code` omitted** and uses `ilike` (wildcard-widening) at :545-551. |
| OI-01: `/dashboard/configs` filters on client value with `ilike` | Yes — `dashboard.py:720-722`. Config detail `:744`, versions `:937`, version-by-id `:973` check only `View Dashboard`, no scope. Create `:771`/`Edit `:843`/publish `:1000`/revert `:1077` validate shape, not scope. |
| OI-01: scope helpers exist and return early on blank | Yes — `dependencies/permissions.py`: `get_user_location_codes` (:~555, returns `None` = unrestricted), `ensure_location_in_user_scope` (:~753, returns early on None/blank), `apply_location_filter`, `apply_transaction_party_scope_filter` + `TRANSACTION_PARTY_LOCATION_FIELDS` (party rule). Standalone routes already use them: `reports.py:1915/1940/1957/1982/2056/2110/2168`, `shuttle_fso_voyages.py:449-461` (`/shuttle-tracking` applies party scope always and `ensure_location_in_user_scope` when a location is supplied). |
| OI-02: barge seal GET/POST not asset/location-scoped | Yes — `barge_seal_master.py:17-35` (GET filters `BargeSealMaster.asset_code.ilike(...)` after `View Barge Seal Master` only) and :53-70 (POST resolves asset by `ilike`, only checks existence, then mutates). `BargeSealMaster` has no location column; the check belongs on `Asset`. Asset module already implements the Global/Local rule — `assets.py:38-49` (`or_(asset_scope ilike 'Global', lower(trim(location_code)) in allowed)`) and create/update scope checks at :139-144, :293-296. |
| OI-03: `password_history_json` and `token_hash` not masked | Yes — `admin_db_browser.py:56-61` anchored alternation; a scan of all model columns confirms the current pattern matches only `backup_codes_hash_json`, `password_hash`, `session_id`, `totp_secret_encrypted` and misses `password_history_json` (users, JSONB, models.py:22) and `token_hash` (token_blacklist, models.py:2000). |
| OI-04: redaction regex has blind spots | Yes — `utils/logging_config.py:20-27` uses `\b`-anchored key names, so quoted JSON keys (`"password": ...`), `PASSWORD_HISTORY_JSON=...`-style env dumps etc. are not caught. Deployment secret names to add: `INITIAL_ADMIN_PASSWORD`, `SECURITY_KDF_SALT`, `JWT_SECRET_KEY`, `ENCRYPTION_KEY`, `PGPASSWORD`, plus refresh cookie name `AUTH_COOKIE_NAME` (default `hydrocarbon_refresh`, config.py:106). |
| OI-05: print() bypasses formatter | Yes — exactly **24** `print(` calls, **all** in `backend/app/utils/db_migrations.py`; 6 interpolate raw exception text (:1169, :1727, :1847, :1952, :1982, :2030). `RedactingFormatter` is attached only to the root StreamHandler (`logging_config.py:65-68`); `docker-compose.prod.yaml` has no `logging:` block, so stdout lands in the Docker json-file log unredacted. `backend/seed_admin.py` prints are deliberate CLI output — leave them. |
| OI-06: diagnostics endpoints unaudited | Yes — `auth.py:653-659` (`/auth/me/rbac-diagnostics`, gated `Edit System Settings`) and `permissions.py:414+` (`/access-diagnostic`, gated `View Access Summary`) have no `create_audit_log` call. `create_audit_log` (`services/audit_service.py:8`) is `db.add` only — caller commits (see the read-audit pattern in `admin_db_browser.py`). |
| OI-07: `/permissions/catalog` ungated | Yes — `permissions.py:63-76` has no `require_user_permission`, while the list at :47 requires `View Permission`. Frontend consumers of `GET /permissions/catalog` (`frontend/src/api/permissionApi.js:83`): `PermissionMaster.jsx` (page gated `View Permission`, App.jsx:338), `RolePermissionAssignment.jsx` and `PermissionPresets.jsx` (both gated `View Role Permission Assignment`, App.jsx:355/374), `AccessSummary.jsx` (gated `View Access Summary`, App.jsx:446). `buildPermissionGroups` (`frontend/src/utils/permissionCatalog.js`) already tolerates a null catalog and derives the action from the permission name (`actionFromName`); presets are stored client-side (`permissionPresetStore.js`) but built-in preset definitions derive names from the catalog (`permissionPresets.js:40`). |
| OI-08: legacy TOTP ciphertext never re-encrypted | Yes — `utils/security.py:45-51` `get_legacy_fernet()` (SHA-256 of `ENCRYPTION_KEY`); `decrypt_security_value` falls back to legacy when there is no `v2:` prefix; `utils/totp.py:44-45` fails closed (returns False → admin reset needed) if a legacy row can't be decrypted. |
| H-01: one genuinely mixed datetime comparison | Yes — `services/transaction_helpers.py:257-260`: fallback compares `datetime.now()` (naive local) against `transaction.updated_at/created_at` (`server_default=func.now()` → DB clock, UTC on the shipped Postgres image). All other compared writers are local-vs-local or UTC-vs-UTC (lockout uses `as_naive_utc`). `system_notifications.py:542` Scheduled/Published depends on what the UI sends — verify separately, don't change in this release. |
| H-02: bootstrap-admin guards keyed to mutable username | Yes — `dependencies/permissions.py:28-30` (`username == 'admin'`); guards at `user_roles.py:64-65` and `:235-236`; `users.py:39-44` `validate_reserved_username` blocks renaming **to** a reserved name, not **away from** `admin`; `users.py:250` calls it on update. |
| H-03: password policy gaps | Yes — `config.py:125` `PASSWORD_HISTORY_COUNT` min 1; `utils/password_policy.py:136-143` history compares bcrypt hashes (case-flip passes), :88-145 rule-based, :33-45 small static common list (already canonicalised + leet-translated). |
| H-04: backup subprocess inherits whole env | Yes — `routers/backup_restore.py:348` `process_env = os.environ.copy()` then sets `PGPASSWORD`/`PGSSLMODE`. |
| H-05: calibration validation gaps | Yes — `asset_calibration_tables.py:30` `MAX_CALIBRATION_VALUE = float(os.getenv(...))` (accepts `inf`/`nan`); numeric validation chosen by declared `data_type` (:322-326); no duplicate-axis / non-monotonic checks. |
| H-06: six small items | Verified — `assets.py:162-166` (dead `except IntegrityError` after `flush_or_409`, which already raises 409 with its `detail`; same shape :195, :386, :495; `utils/errors.py:41-53`); `apiClient.js:195-200` interpolates raw `Retry-After`; `exportUtils.js:99-107` XLSX header not neutralised; `ShuttleTracking.jsx:647` `headers.join(',')` and `FlowmeterRecordEntry.jsx` header row not passed through `escapeCsvCell`; `backup_restore.py:63-73` containment is `resolve()`-based (TOCTOU-narrowed); `auth.py:974-979` logout revocation failure is silent. |
| H-07 / N-12: per-worker throttle dilution; wildcard proxy trust | Yes — `utils/rate_limit.py` is in-process; `docker-compose.prod.yaml:58,64` `WEB_CONCURRENCY` default **2**, no `limit_req` in `frontend/nginx.prod.conf` or `deploy/nginx.conf`; `docker-compose.prod.yaml:45` sets `TRUSTED_PROXY_IPS: "*"` (code default is empty — `config.py:166-170`). DB-backed controls are worker-independent: account lockout (`auth.py` `failed_login_count`/`locked_until`) and per-challenge `attempt_count` cap. |
| D-01: HSTS not actually enabled at nginx | Yes — `frontend/nginx.prod.conf:80` and `deploy/nginx.conf:80` have the HSTS `add_header` **commented out**; COOP is HTTPS-only via the `$hydrocarbon_coop` map; the API itself sends HSTS when `IS_PRODUCTION and not ALLOW_INSECURE_HTTP` (`http_hardening.py:176-178`). `SECURITY_REMEDIATION.md:40` overclaims. |
| D-02: "http:// base URL fails the production build" is false | Yes — the guard is a runtime browser throw (`apiClient.js:13-15`); `package.json` build script is plain `vite build`. A prebuild-check pattern already exists (`check:print-actions` → `scripts/check-print-actions.mjs`). |
| D-03: no lint guards | Yes — `eslint.config.js` has `no-alert` only; no `no-restricted-syntax` for `dangerouslySetInnerHTML`/`innerHTML`; nothing forbids bare `datetime.now()` on the Python side. |
| D-04: CSP mismatch between layers | Yes — nginx `img-src 'self' data: blob:` (both nginx confs :77) vs app `img-src 'self' data:` (`http_hardening.py:169`). |

### Corrections / refinements to the draft plan you provided

1. **OI-01 handler count:** the gateway has **8** handler keys (3 FSO + Shuttle Summary + Tank Stock Snapshot + Asset List + Operation Transactions + Operation Status Counts), not just the four named in the workbook. All eight need the same scope boundary.
2. **Duplicate shuttle builder:** `build_shuttle_summary_rows` exists twice — `dashboard.py:454` (used by the gateway) and `shuttle_fso_voyages.py:1381` (the standalone copy; the live `/shuttle-tracking` route at :405 scopes inline via `apply_transaction_party_scope_filter` + `ensure_location_in_user_scope` at :449-461). Fix the gateway path by mirroring that established standalone pattern; do not change `/shuttle-tracking` behavior. During implementation, confirm the :1381 copy is dead code and consolidate if so (optional, non-functional).
3. **OI-01 `/configs` list:** don't just validate a supplied `location_code` — **constrain the whole list** to the caller's scope (GLOBAL configs + LOCATION configs whose `location_code` is in scope), and replace `ilike` with normalized equality. Same for config detail, version list, and version-by-ID (via the parent config).
4. **OI-03 masking pattern:** a broad `.*_key` / `.*token.*` substring rule would over-mask **non-secret** columns — a model scan found `check_key`, `column_key`, `config_key`, `handler_key`, `memory_key`, `section_key`, `force_password_change`, `password_changed_at`, `password_expiry_days`, `password_never_expires` would all match. Use an explicit per-table sensitive-column classification with default-mask for unreviewed columns, plus a conservative pattern only for clearly-secret stems (`password*`, `*secret*`, `*token*` except known-safe, `*_hash`, `passphrase`, `api_key`, `private_key`, `encrypted_key`, `session_id`). Minimum fix: add `password_history_json` and `token_hash`. Also **select only safe columns** instead of `SELECT *` + mask, so secrets never enter memory/logs.
5. **OI-05 print() count:** all 24 are in `db_migrations.py` (none elsewhere under `backend/app/`); only the 6 listed interpolate raw exceptions. `seed_admin.py`/`verify_admin.py` are CLI entry points — leave their prints.
6. **OI-07 frontend compatibility:** `buildPermissionGroups` already accepts a null catalog, and presets are client-side — but built-in presets need catalog *names*. Cleanest compatible fix: add a server-filtered subset endpoint (e.g. `GET /permissions/catalog?scope=held` or `/permissions/catalog/mine`) returning only modules/permissions intersecting the caller's effective permissions (which `/me` already exposes), use it on the three non-`View Permission` pages, **then** gate the full catalog with `View Permission`. Never ship the full catalogue in the JS bundle and never auto-grant `View Permission`.
7. **OI-02 barges:** since barges are Global-only, the scope check is a no-op for real barge assets — implement it anyway on the linked `Asset` (`asset_scope` casefold == `"global"` → shared; anything else → require `ensure_location_in_user_scope` on `asset.location_code`; **never infer Global from a blank location**; a Local asset with blank location is denied and reported as an orphan). Use exact normalized matching (`lower(trim(...)) == normalize_location_code(...)`; case-insensitive unique indexes already guarantee uniqueness, N-01) instead of `ilike`, and store the canonical `asset.asset_code` in new seal rows.
8. **Scope semantics for the dashboard:** standalone FSO/shuttle routes use **operational** scope (`get_user_location_codes`); report-only grants (`get_user_report_location_codes`) are used by `report_builder.py` only. Use operational scope in the gateway (consistent with the standalone routes); confirm with Operations whether any dashboard consumer relies on report-only grants before rollout.
9. **H-01:** only the `transaction_helpers.py:257-260` fallback is genuinely mixed; fix just that (compare against the DB clock / `utc_now_naive()`), add a CI AST guard for new bare `datetime.now()`, and leave timestamp-column migration as a separate proposal.
10. **N-12:** `TRUSTED_PROXY_IPS="*"` comes from `docker-compose.prod.yaml:45` (code default is empty). Safe only while the API port is unpublished and nginx overwrites `X-Forwarded-For`; narrow it to the compose subnet as defence in depth.
11. Your "two requirements" paragraph is correct and is kept verbatim as a constraint: the only intended new writes are audit rows, plus TOTP ciphertext **only if approved after the read-only count**.

---

## 2. Detailed implementation plan

### OI-01 (High) — Location-scope the dashboard data gateway and dashboard configs

**Files:** `backend/app/routers/dashboard.py`, `backend/app/routers/reports.py` (builder signatures), `backend/app/dependencies/permissions.py` (reuse; maybe one new helper), frontend `Dashboard.jsx` / `DashboardBuilder.jsx` (no change expected).

**Steps:**
1. Add one server-side scope resolver in the gateway, reusing existing helpers: `allowed = get_user_location_codes(current_user, db)` (`None` = unrestricted, e.g. Admin / `all_locations_access=Yes`).
2. After param coercion (:1526-1545), for every handler that accepts `location_code`:
   - If supplied: normalize (`strip` + casefold via `normalize_location_code`), then `ensure_location_in_user_scope(current_user, db, value)` → 403 when out of scope; filter with **equality** on `lower(trim(col)) == normalized` (never `ilike` on the raw client string — kills the `%`/`AG%` wildcard widening).
   - If omitted/blank (only allowed where the param is optional: `SHUTTLE_SUMMARY`, `ASSET_LIST`, `OP_TRANSACTIONS`, `OP_STATUS_COUNTS`): **narrow to the caller's scope instead of returning everything or erroring** (owner decision (a) in the workbook): pass `current_user` into the builders (new optional kwarg, default `None` = current behavior, so standalone callers are untouched) and apply scope in the query **before** count/aggregate/paginate.
3. Per handler:
   - `FSO_OTR`, `FSO_MATERIAL_BALANCE`, `FSO_OUTTURN` (location **required**): validate scope, then call the existing builders in `reports.py` with the canonical location — identical to the standalone routes `reports.py:1915/1940/1957/1982`. Preserve accounting-day windows, opening balances, totals; no calculation changes.
   - `SHUTTLE_SUMMARY`: apply `apply_transaction_party_scope_filter` (party rule: any of origin/destination/sender/receiver in scope) to **both** the group query and the second payload/totals query in `build_shuttle_summary_rows`; if `location_code` supplied, additionally `ensure_location_in_user_scope` + equality filter. Escape `search` with `escape_like(..., escape="\\")` as done elsewhere. Same treatment in the duplicate copy if it is live.
   - `OP_TRANSACTIONS`, `OP_STATUS_COUNTS`: same party-scope rule on `OperationTransaction`; validate supplied `location_code` against scope, equality filter.
   - `ASSET_LIST`: mirror the asset-master rule (`assets.py:38-49`): `or_(asset_scope ilike 'Global', lower(trim(location_code)) in allowed)`; empty scope → zero rows; unrestricted → unchanged. Supplied `location_code` → validate + equality (existing behavior preserved).
   - `TANK_STOCK_SNAPSHOT` (location **required**): `ensure_location_in_user_scope` first; assets already filtered by exact location; the ledger query is filtered by the same location + the scoped asset list, and calibration reads are keyed by those asset codes — verify no join can pull unrelated locations. A Global *dashboard layout* never grants access to Local stock — the check is on the requested location, independent of layout.
4. Configs lifecycle — one policy everywhere:
   - `GET /configs`: constrain list to caller's scope (GLOBAL configs always; LOCATION configs only when `lower(trim(location_code)) in allowed`; unrestricted → all; empty scope → GLOBAL only). Supplied `location_code` → validate + equality (replaces `ilike` at :721).
   - `GET /configs/{id}`, `GET /configs/{id}/versions`, `GET /versions/{id}`: fetch config (version via its parent config), apply the same visibility rule → 404 (not 403, to avoid existence leaks — consistent with `ensure_user_in_actor_location_scope` which raises 404).
   - `POST /configs`, `PUT /configs/{id}`, `publish`, `revert`: keep `Create/Edit/Publish Dashboard` permissions; additionally validate that any proposed **LOCATION** `location_code` is in the caller's scope on create, edit, publish, and revert. GLOBAL configs stay manageable by anyone with those permissions (shared by design, matching the `Dashboard.jsx` Global fallback at :799-817); audit already records old/new. Do **not** rewrite or reseed existing configs/versions. Open decision for the owner: whether managing GLOBAL layouts should additionally require admin — record the decision; do not silently change it in this release.
5. Keep `View Dashboard` as the feature gate on all read paths; keep all existing required-param behavior (FSO/Tank Stock widgets are single-location; no implicit cross-terminal rollup).

**Compatibility guards:** builders get optional `user=None` params so every existing caller (standalone report/print routes) behaves identically; no changes to calculation windows, pagination shapes, or response models; `Dashboard.jsx` location picker + Global fallback keep working because GLOBAL configs remain listable and LOCATION configs remain listable when in scope.

**Acceptance tests:** before/after parity of widget rows, totals, `total_rows`, `total_groups`, `has_more`, and print/export output for an authorized terminal; negative tests: another terminal's code → 403, wildcard `AG%` → 403, omitted location on SHUTTLE_SUMMARY → only caller-scope rows (not org-wide), no-location user → zero location-bound rows, unrestricted user → unchanged, party visibility (sender at A sees ticket addressed to B and vice versa; unrelated terminal C gets nothing), case/spacing variants (`" ag "` vs `AG`) handled by normalization, config detail/versions cross-location → 404, denied config writes leave rows unchanged. Extend `backend/tests/test_location_scope_smoke.py`, `test_report_party_visibility.py`, plus new dashboard-gateway tests.

---

### OI-02 (High) — Scope barge seal master; Global stays shared

**Files:** `backend/app/routers/barge_seal_master.py`; frontend `BargeSealMaster.jsx`, `components/operationLayouts/MultiTankBeforeAfterLayout.jsx` (autofill — no change expected).

**Steps:**
1. One shared asset-resolution + authorization helper used by **both** endpoints:
   - Resolve the asset by exact normalized code: `lower(trim(Asset.asset_code)) == normalize_location_code-style normalize(asset_code)` (case-insensitive unique indexes exist, N-01). Not found → 404 `Asset not found` (GET currently returns `[]` for unknown assets; POST already 400s — align both on 404/400 consistently, keep it an error, not an empty success).
   - Authorization: `str(asset.asset_scope).strip().casefold() == "global"` → allowed for any holder of the route permission (barges are Global — this is the common path). Otherwise require `ensure_location_in_user_scope(current_user, db, asset.location_code)`; blank/non-Global scope with blank location → deny (never infer Global from a blank location).
2. `GET /barge-seal-master`: permission `View Barge Seal Master`, then the helper, then query seals with **exact equality** on the canonical `asset.asset_code` (not `ilike` on the client string) + effective_date filter as today.
3. `POST /barge-seal-master/bulk`: permission `Edit Barge Seal Master`, resolve asset, **authorize before any row is touched**, then validate all rows (existing duplicate/required checks unchanged), then add/update/delete, `db.flush()`, audit event, `db.commit()` — preserving per-asset atomicity. A denied save changes nothing. On write, store the canonical `asset.asset_code` on new rows.
4. Frontend importer (`BargeSealMaster.jsx:336-365`) loops one bulk request per asset — keep that; the asset list it draws from is already scope-filtered (`/assets` Global rule), so imports remain authorized. Prevalidate rows client-side as today and keep per-asset success/failure reporting; **do not** promise whole-file rollback across separate requests.
5. Read-only pre-rollout inventory (no writes): list seal rows whose `asset_code` matches no asset (orphans) and Local assets with blank location (malformed). Report for owner review only — no deletion, reassignment, or scope conversion.

**Acceptance tests:** users at two locations with the permissions can read and update the same Global barge; a user without `View`/`Edit Barge Seal Master` gets 403; a Local-asset seal save from an out-of-scope location is denied with all rows unchanged; default and dated seal sets, import/export, and Operation Entry seal autofill still work; `asset_code="%"` or `"AG%"` returns no cross-asset data.

---

### OI-03 (Medium) — Keep credential material out of Database Browser responses

**Files:** `backend/app/routers/admin_db_browser.py`.

**Steps:**
1. Replace the single anchored regex with an explicit **per-table classification**: `SENSITIVE_COLUMNS: dict[str, set[str]]` (start with `users`: `password_hash`, `password_history_json`, `totp_secret_encrypted`, `backup_codes_hash_json`, plus the existing names; `token_blacklist`: `token_hash`; `auth_sessions`/`auth_login_challenges`: token/challenge secrets as applicable), plus a conservative default pattern for unclassified tables that matches only clearly-secret stems: `password*`, `*secret*`, `*totp*`/`otp*`, `*token*` (note: `token_hash` yes; no legitimate non-secret `*token*` column exists today), `*_hash`, `passphrase`, `api_key`, `private_key`, `encrypted_key`, `session_id`, `*cookie*`. **Do not** use bare `.*_key` — it would mask non-secret config columns (`handler_key`, `config_key`, `check_key`, …) and break the browser's usefulness.
2. **Select only safe columns**: build the `select()` from `[c for c in table.columns if not sensitive(c)]` and insert `"*** REDACTED ***"` placeholders at the masked positions in the response, so secrets are never read into memory or logged. Keep column labels, pagination, table list, `View Database Browser` gate, and the existing read-audit (which records only `sensitive_columns_redacted` names — never values).
3. Review JSON/JSONB columns separately wherever they can nest security data (`password_history_json`, `backup_codes_hash_json` — masked wholesale).
4. No updates to hashes, token rows, or users.

**Acceptance tests:** with synthetic values, current + historical password hashes, `token_hash`, TOTP ciphertext, and backup-code hashes never appear in responses or audit details; safe columns (including `password_changed_at`, `handler_key`, etc.) still display; a test that reflects the schema and asserts every secret-stem column is classified, so a future column like `api_token` is masked by default.

---

### OI-04 (Medium) + OI-05 (Low) — Logging redaction net and print() bypass

**Files:** `backend/app/utils/logging_config.py`, `backend/app/utils/db_migrations.py` (24 prints), tests.

**Steps (OI-04):**
1. Strengthen `_REDACTIONS` in `logging_config.py`: drop the `\b` anchor in favour of a non-word-delimited key match; allow optional quotes around the key (handles `"password": "x"` and `'password' = 'x'`); keep value-only replacement. Add explicit deployment secret names: `INITIAL_ADMIN_PASSWORD`, `SECURITY_KDF_SALT`, `JWT_SECRET_KEY`, `ENCRYPTION_KEY`, `PGPASSWORD`, `DATABASE_URL`-style URLs (already handled), plus the refresh cookie name from `AUTH_COOKIE_NAME` (default `hydrocarbon_refresh`) and a `Set-Cookie`-header shape. Keep the existing bearer/JWT/DB-URL rules.
2. Prefer structured logging of named, approved fields at call sites (identifiers, never secrets).
3. Unit-test `redact()` against each shape (env assignment, quoted JSON key, `key='value'`, `Set-Cookie: hydrocarbon_refresh=...`, DSN with password, Bearer, JWT) asserting `REDACTED` — the workbook notes this control regresses silently.
4. Verify handler topology: `configure_logging` already clears uvicorn handlers and propagates to the root handler with `RedactingFormatter` + `RequestIdLogFilter`; confirm no other `addHandler`/`basicConfig` exists (verified: none under `backend/app/`), so container/proxy/ASGI logs all pass through the formatter.

**Steps (OI-05):** convert the 24 `print()` calls in `db_migrations.py` to `get_logger(__name__).info/warning(...)`; for the 6 exception paths (:1169, :1727, :1847, :1952, :1982, :2030) log event name + safe identifiers + `type(error).__name__` via `logger.exception`-style structured fields — **never** the raw exception text (which could embed DSN/driver credentials). Keep every `session.rollback()` and the "skip and continue" startup semantics identical. Leave CLI scripts (`seed_admin.py`, `verify_admin.py`) as deliberate CLI output.

**Acceptance tests:** synthetic secret values do not appear in captured logs on happy and exception paths; request IDs, levels, and startup events remain; add a regression test that AST-scans `backend/app/**/*.py` for new `print(` calls (allowlist: none) and for raw credential-logging patterns.

---

### OI-06 (Low) — Audit the two RBAC diagnostics routes

**Files:** `backend/app/routers/auth.py` (`/me/rbac-diagnostics`), `backend/app/routers/permissions.py` (`/access-diagnostic`).

**Steps:**
1. In both endpoints, after the permission check and at each outcome, `create_audit_log(...)` + commit with: actor id/name, request id (available via the logging filter / scope state), endpoint path, target `user_id` where applicable, which optional inputs were supplied (`transaction_id`, `action_code`) as booleans/ids — never raw query strings — and a bounded outcome: `allowed` / `denied` / `not_found` / `error`. Do **not** log the returned authorization profile or any credential. Follow the existing read-audit pattern from `admin_db_browser.py`.
2. Define failure behavior explicitly: if the audit insert/commit fails, roll back and return a controlled 500 for these two privileged reads and alert support — ordinary sign-in and `/me` are unaffected.
3. Keep the existing permission gates (`Edit System Settings`, `View Access Summary`). Open owner decision (do not change silently): whether `View Access Summary` is meant to be organization-wide support access, or should be delegated by terminal using the existing `user_is_within_actor_location_scope` actor→target rule. If delegated, apply it **after** owner approval, in a separate change.

**Acceptance tests:** every call to both endpoints produces exactly one audit row with the bounded fields; denied (403) and not-found (404) paths are audited too; no profile contents in `details`; ordinary login flow unaffected when the audit table is unavailable (controlled error only on the two diagnostics endpoints).

---

### OI-07 (Low) — Gate the permission catalogue without breaking delegated administration

**Files:** `backend/app/routers/permissions.py`, new subset endpoint; `frontend/src/api/permissionApi.js`, `PermissionMaster.jsx`, `RolePermissionAssignment.jsx`, `AccessSummary.jsx`, `PermissionPresets.jsx`, `utils/permissionCatalog.js`.

**Steps:**
1. **Frontend first (or deploy atomically):** add a server-filtered subset, e.g. `GET /permissions/catalog/mine` (authenticated only), returning the catalog restricted to modules/permissions that intersect the caller's effective permissions (`get_user_permissions` — the same set `/me` already returns). `buildPermissionGroups` already tolerates a missing/null catalog and derives actions from names; point `RolePermissionAssignment`, `AccessSummary`, and `PermissionPresets` at the subset endpoint when the caller lacks `View Permission` (they cannot assign anything beyond their own permissions anyway — `ensure_role_permissions_within_actor_scope` enforces this server-side), and keep the full catalog for `PermissionMaster`. Do not embed the full catalogue in the JS bundle; do not auto-grant `View Permission`.
2. **Then** add `require_user_permission(current_user, "View Permission", db)` to `GET /permissions/catalog` (`permissions.py:64`).
3. Presets: built-in preset definitions reference standard permission names; with the subset they resolve only the caller-manageable permissions, and `resolvePreset(..., canAssign)` already marks the rest as non-assignable — preview/apply of what the caller can already manage is preserved.

**Acceptance tests:** with each permission combination — `View Permission` only, `View Role Permission Assignment` only, `View Access Summary` only, none — verify Permission Master, delegated assignment, presets, Access Summary, and login/navigation via `/me` all work; unauthenticated/low-privilege `GET /permissions/catalog` → 403; the subset endpoint never returns names outside the caller's own permissions.

---

### OI-08 (Low) — Retire legacy TOTP encryption without re-enrollment

**Files:** `backend/app/utils/security.py`, `backend/app/utils/totp.py`; new separately-invoked script (pattern: `backend/seed_admin.py`).

**Steps:**
1. **Read-only count first** (no export, no per-account logging):
   `SELECT count(*) FROM users WHERE totp_secret_encrypted IS NOT NULL AND totp_secret_encrypted NOT LIKE 'v2:%';`
   If 0: no user-row update is needed; keep `get_legacy_fernet` until restore-procedure verification is done, then delete it in a later change.
2. If nonzero: **separate approval required** for a ciphertext-only backfill. Implement as a separately invoked, idempotent script (never in the FastAPI lifespan/startup): for each affected row, in a bounded transaction — read old ciphertext, `decrypt_security_value` (legacy reader), re-encrypt with `encrypt_security_value` (`v2:` prefix), verify the new ciphertext decrypts to the **same secret**, then `UPDATE ... WHERE id=? AND totp_secret_encrypted = <old ciphertext>` (compare-and-set, so a concurrent enrollment/reset is never clobbered). Leave undecryptable rows untouched and escalate — never auto-reset anyone's 2FA (`verify_totp` already fails closed).
3. Rehearse on an isolated restore with securely supplied deployment keys; keep `ENCRYPTION_KEY` and `SECURITY_KDF_SALT` unchanged; preserve TOTP flags, `totp_last_used_step`, backup codes, passwords, sessions, and enrollment. Verify normal login + 2FA on controlled accounts and that backups can still be restored. Record counts only (before/after legacy count), no secret values in artifacts.
4. Add a counter/log line on the legacy-decrypt branch so the team sees when the last legacy row is read; retire the legacy reader only after active data **and** the documented restore procedure are both accounted for. Both formats must remain readable during the transition.

---

### H-01 — Time conventions (Hardening)

1. Fix only the confirmed mixed comparison: `services/transaction_helpers.py:257-260` — when no approval-history row exists, compare against the database clock (e.g. `SELECT now()` cast to naive, or `utc_now_naive()`), not `datetime.now()`, because `updated_at`/`created_at` are `server_default=func.now()`. Do not bulk-shift historical values.
2. Standardize **new** code on `utc_now_naive()`; add a CI/AST check rejecting new bare `datetime.now()` outside a documented allowlist. Timestamp-column `TIMESTAMPTZ` migration is a separate proposal. Leave accounting dates, local backup schedules, and the `system_notifications.py:542` behavior unchanged (verify its UI convention separately).
3. Test the 24-hour correction-window boundary in UTC and in a non-UTC timezone.

### H-02 — Bootstrap administrator identity

1. In `users.py` update (around :250), refuse to rename the account whose current username normalizes to `admin` (block renaming the bootstrap account **away** from `admin`), while preserving all ordinary profile updates. Longer term, key the identity to a stable seeded id/boolean via the existing additive migration mechanism — separate change.
2. Preflight deployments: confirm from trusted records (`verify_admin.py`) whether the bootstrap account was already renamed anywhere; reconcile with seeding so no second admin is created. **Do not** rename, create, reactivate, or reassign any account as part of this remediation.

### H-03 — Password policy strength/history (prospective only)

1. Enforce a code-level floor of 3–5 on `PASSWORD_HISTORY_COUNT` (config currently allows min 1, `config.py:125`) — applies only when a new password is voluntarily set or normally reset.
2. Keep the existing exact bcrypt history check; historical bcrypt hashes cannot be compared case-insensitively. If case-only reuse must be blocked, implement a separately approved **keyed** (HMAC) prospective history check populated only on future password changes, and document the coverage limit during transition. Never lowercase the password used for authentication.
3. No changes to sign-in verification, existing expiry dates, hashes, or history rows. Optionally add a zxcvbn-style strength floor for new passwords only.

### H-04 — Backup subprocess environment

1. In `backup_restore.py:348` (and every subprocess spawn), replace `os.environ.copy()` with a minimal allowlist: `PATH` (binary resolution), `PGPASSWORD` (from the parsed URL, as today — never in argv), `PGSSLMODE`/`PGSSLROOTCERT` when TLS is configured, optionally `LANG`/`PGOPTIONS`. Never pass `DATABASE_URL`, `JWT_SECRET_KEY`, `ENCRYPTION_KEY`, `SECURITY_KDF_SALT`, `INITIAL_ADMIN_PASSWORD`.
2. Verify manual + scheduled backups, download/checksum, and restore validation on disposable databases, including TLS/private-CA setups. Never test restore over production.

### H-05 — Calibration validation

1. Validate `MAX_CALIBRATION_VALUE` at import: must be finite and > 0, else fall back to the default (rejects `inf`/`nan`).
2. Validate interpolation-axis columns by `interpolation_role` as well as declared `data_type`; reject duplicate axis coordinates per template dimensionality; warn first on non-monotonic charts and confirm legitimate exceptions before enforcing. Apply to new/replaced data only — existing charts and large-upload behavior unchanged.

### H-06 — Six small fixes

1. `assets.py:162-166` (and :195, :386, :495): pass the specific message through `flush_or_409(db, detail="Asset code already exists")` and delete the dead `except IntegrityError` branches (the specific message is currently unreachable).
2. `apiClient.js`: sanitize/parse the `Retry-After` header (e.g. parse int, fall back to generic text) instead of raw interpolation.
3. `exportUtils.js`: neutralise XLSX **header** cells with the same formula-injection neutraliser used for data cells.
4. `ShuttleTracking.jsx:647` and the `FlowmeterRecordEntry.jsx` header line: map headers through `escapeCsvCell` (static today — defence in depth).
5. `backup_restore.py:63-73`: re-assert containment at the actual file operation (`os.open` with `O_NOFOLLOW` where supported, dirfd-relative resolution), not only at request validation; keep root 0700.
6. `auth.py` logout (:974-979): log failed server-side revocation at warning level (exception class only, via `utils/errors.log_exception`) while preserving cookie clearing and the existing success response.

### H-07 — Multi-worker throttling

1. Keep the database-backed controls unchanged and authoritative: account lockout (`failed_login_count`/`locked_until`) and per-challenge `attempt_count` cap.
2. Choose one: (a) shared counter store (e.g. Redis) for the in-process limiter scopes, (b) an nginx `limit_req` zone in front of `/api/auth/` as a coarse per-IP ceiling, or (c) pin `WEB_CONCURRENCY=1` for the auth-serving container. Validate real client-IP handling with `TRUST_PROXY_HEADERS` at the trusted proxy; monitor legitimate 429s; test counter-store failure behavior (fail open for availability, but never weaken the DB lockout); do not throttle refresh/session routes.
3. N-12: narrow `TRUSTED_PROXY_IPS` in `docker-compose.prod.yaml` from `"*"` to the compose subnet (valid today only because the API port is unpublished and nginx overwrites `X-Forwarded-For`).

### D-01 — Headers/HSTS at the right layer

1. Identify the actual TLS terminator. Enable the (currently commented) HSTS `add_header` in `frontend/nginx.prod.conf` / `deploy/nginx.conf` **only for HTTPS deployments**, starting with a short `max-age`, no `includeSubDomains`/`preload` until the domain inventory is verified.
2. Keep COOP HTTPS-only via the existing map; document the internal-HTTP exception (`ALLOW_INSECURE_HTTP`). Correct the `SECURITY_REMEDIATION.md:40` claim or enable the header — do both consistently. `DEPLOYMENT_SECURITY.md` already documents `ENVIRONMENT=production` behavior; align it with the nginx reality.

### D-02 — Build-time API origin guard

1. Add a `scripts/check-api-base-url.mjs` prebuild script (same pattern as `check-print-actions.mjs`) that fails the build when `VITE_API_BASE_URL` is set to an insecure (`http://`), protocol-relative, or malformed origin; accept unset, same-origin relative paths, and approved HTTPS origins. Wire it into `"build"` and test the real Docker build (`frontend/Dockerfile.prod`) as well as CI. (The runtime throw in `apiClient.js:13-15` stays as defence in depth.)

### D-03 — Lint guards

1. ESLint `no-restricted-syntax` (core rule, no plugin needed): forbid `dangerouslySetInnerHTML` JSX attributes and `innerHTML` assignments. Baseline existing findings instead of a repo-wide cleanup.
2. Python-side CI check (AST) rejecting new unqualified `datetime.now()` calls outside the documented allowlist (see H-01).

### D-04 — CSP alignment

1. Make the nginx and app CSP strings identical — add `blob:` to the app `img-src` in `http_hardening.py:169` (the SPA legitimately uses `blob:` images). Keep `style-src 'unsafe-inline'` (required by React inline styles) and document it as the single relaxation. Add a test that extracts both strings from the files and asserts equality. Smoke-test charts, print, downloads, deep links.

### N-01 … N-12 — Checked, not issues

Keep as non-findings; do not reopen. Preserve the case-insensitive uniqueness controls (30 functional unique indexes, `models.py` + `db_migrations.py` collision pre-check), reserved role-name checks (`roles.py`), lockout behavior, deliberate logout/cookie behavior, and the `decode_token_claims_ignoring_exp` logout-path confinement. Apply the N-12 narrowing above as defence in depth.

---

## 3. Cross-cutting compatibility guarantees

- **Users & credentials untouched:** no password resets/rehashes, no history rewrites, no user recreation/deactivation, no role reseeding, no session/token revocation, no TOTP reset. Startup (`main.py` lifespan) still runs only the existing additive migrations + `seed_default_permissions()` + `seed_admin_role()` — the plan adds **no** startup writes; stop rollout if startup would create an account or reseed permissions unexpectedly.
- **Only intended new writes:** audit-log rows (OI-06 and existing audit fields) and, only if separately approved after the read-only count, TOTP ciphertext updates (OI-08). Everything else is read-only or code-only.
- **Permissions unchanged:** no new permission grants, no permission renames; gates reuse existing permission names.
- **Existing suites to extend, not replace:** `test_location_scope_smoke.py`, `test_report_party_visibility.py`, `test_tracking_party_visibility.py`, `test_access_diagnostic.py`, `test_permission_catalog.py`, `test_security_hardening_v2.py`, `test_security_module.py`, `test_backup_safety.py`, `test_assets.py`, `test_auth.py`, `test_users.py`, `test_vulnerability_remediation.py`, `test_hardening_infrastructure.py` — plus new tests for the dashboard gateway scope, barge-seal scope, DB-browser redaction, log redaction, and catalogue gating. Note: `conftest.py` uses SQLite (`DATABASE_URL` env), which does **not** exercise the PostgreSQL startup path — rehearse startup on an isolated PostgreSQL restore.

## 4. Release plan (dependency order)

1. **Baseline:** isolated PostgreSQL restore with restricted access and external side effects disabled; capture read-only counts and protected before/after comparisons for users, password hashes/history, roles, assignments, locations, seal records, dashboard configs/versions, operational tables. Never copy secret values into test artifacts.
2. **Release 1 (High):** OI-01 dashboard scope + OI-02 barge seals. Positive and negative evidence per the acceptance tests above; verify denials do not mutate records.
3. **Release 2 (Medium/Low):** OI-03 DB-browser redaction, OI-04/OI-05 logging, OI-06 diagnostics audit.
4. **Release 3 (Low):** OI-07 catalogue — ship the frontend subset usage **before** (or atomically with) the backend gate; verify each page per permission combination.
5. **Independent/reversible:** D-01 headers and D-02 build guard and H-07 edge throttling can ship separately and revert independently.
6. **Last, separate change ticket:** OI-08 TOTP ciphertext job, only after the read-only count and explicit approval; pause on verification failure; both ciphertext formats remain readable during transition.
7. **Hardening batch (H-01…H-06, D-03, D-04, N-12):** small, individually revertible fixes; baseline lint findings first.
8. **Rollback = roll back the release, not the live database.** Keep prior compatible images and edge config ready. Never restore a production snapshot over current operations as routine rollback; if reverting an access-control fix would re-expose cross-location data, restrict the affected endpoint temporarily or roll forward with a targeted correction.

## 5. Open owner decisions to settle before implementation

1. Dashboard scope = operational vs. report-only grants (plan recommends operational, matching the standalone FSO/shuttle routes; report-only stays for Report Builder).
2. Who may manage **Global** dashboard layouts (currently anyone with Create/Edit/Publish Dashboard) and what happens to historical versions when a config changes location (plan: keep versions, validate scope on change, audit — no rewrite).
3. Whether `View Access Summary` / `/access-diagnostic` is organization-wide support access or delegated by terminal (auditing ships regardless; scoping is a separate approved change).
4. Whether the TOTP ciphertext backfill is authorized after the read-only count (if not, OI-08 closes as "count = 0 / accepted risk with legacy reader retained and monitored").

## 6. Closure checklist (per workbook ID)

Record each of OI-01…OI-08, H-01…H-07, D-01…D-04 with its acceptance evidence and any approved exception; confirm N-01…N-12 remain non-findings. None of the above requires changing anyone's password or touching user rows.
