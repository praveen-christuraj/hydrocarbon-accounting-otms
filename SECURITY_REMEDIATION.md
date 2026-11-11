# Hydrocarbon Accounting Security Remediation Register

This file is the repository memory for the findings in
`hydrocarbon_report.docx` (Internal Security Assessment v1.0, 5 September
2026) plus hardening passes through 11 November 2026. Future maintainers and
coding agents should read this register before changing authentication,
authorization, exports, calibration, backup, or diagnostic behavior.

Last verified: 2026-11-11 (Pass 3). All 383 backend tests and the production
frontend build passed. Repository-wide ESLint is not clean: it reports
unused-variable and React effect-rule errors across the application, including
some modified files; these are not addressed as part of this security pass.

## 1. Disposition of the 24 assessment findings

| # | Severity | Finding | Disposition and control |
|---|---|---|---|
| 01 | High | CORS misconfiguration | Fixed. Production requires an explicit HTTPS `CORS_ORIGINS` allowlist; wildcard origins are rejected at startup and methods/headers are restricted to those the SPA uses. |
| 02 | High | Username-based admin backdoor | Fixed. Administrative capability requires an active `Admin` or `Super Admin` role (`is_admin_user`); only an explicit `Super Admin` holder may grant that top tier. The bootstrap `admin` account receives both reserved roles at seed time. Reserved usernames cannot be created or assigned. |
| 03 | High | JWT type confusion and long sessions | Fixed. Both decoders require `exp`, `iat`, `nbf`, `jti`, `user_id`, `iss`, `aud`, and the correct `token_type`. Access 15 min; refresh 1 day; refresh tokens are refused as bearer tokens. |
| 04 | High | Refresh token survives logout/reuse | Fixed. Refresh tokens rotate within a server-side `auth_sessions` family (`sid`); logout revokes that family, including after access-token expiry, and refresh preserves the family ID. Legacy sid-less tokens retain account-wide revocation. Reuse detection revokes every account session (epoch bump). |
| 05 | High | No 2FA verification attempt limit | Verified. A challenge is burned after 5 wrong codes; a per-IP limiter adds 20 attempts / 5 min and a per-user limiter 10 failures / 15 min. |
| 06 | High | Password policy missing on user writes | Verified and extended. Create, update, admin reset and self-change all call `validate_password_policy`; Pass 2 added history reuse checks, common-password/sequence checks, and name/email containment. |
| 07 | High | Missing location scope on operational endpoints | Verified for export, correction, tanker, vessel ledger, movement mapping, flowmeter, assignment, FSO/shuttle and barge routes. Pass 2 found one additional IDOR: the correction-request **read** endpoint lacked a location check and was fixed. |
| 08 | High | Backup path traversal | Verified. Backup and restore paths resolve beneath `BACKUP_ROOT`; traversal and absolute paths outside the root are rejected. |
| 09 | High | Seeded admin secret in logs | Verified. Production bootstrap requires `INITIAL_ADMIN_PASSWORD`; no seeding path prints credentials. `seed_admin.py` now imports the application's PBKDF2/bcrypt helper rather than creating a second context. |
| 10 | Medium | Calibration values lack validation | Verified. Numeric template columns reject text, negative, non-finite and excessive values; submissions are capped at 1,000 rows. |
| 11 | Medium | Browser tokens in localStorage | Fixed in Pass 2. Access token lives only in module memory; the refresh token is HttpOnly/SameSite=Strict; legacy localStorage keys are purged on first read. No refresh token is ever written to storage. |
| 12 | Medium | Database credentials in process arguments | Verified. PostgreSQL tools receive `PGPASSWORD`/`PGSSLMODE` through the child environment; URLs and passwords never appear in argv. |
| 13 | Medium | Spreadsheet formula injection | Verified. Shared backend/frontend helpers neutralise `=`, `+`, `-`, `@`, tab and CR prefixes in CSV/XLSX output. |
| 14 | Medium | SQL built with f-strings | Verified and tightened. The database browser uses allowlisted reflected tables and bound expressions. The only remaining identifier interpolation (backup validation table counts) is guarded by `_SAFE_TABLE_NAME` (`^[a-z][a-z0-9_]{0,62}$`). `LIKE`/`ILIKE` searches escape `%`, `_` and `\` via `escape_like()` with `escape="\\"`. |
| 15 | Medium | Tanker export HTML injection | Verified. The reported builder is absent; the legacy HTML-as-`.xls` export was replaced with native sanitized `.xlsx`. |
| 16 | Medium | Mixed naive/aware lockout datetimes | Verified. `as_naive_utc()` normalises every database timestamp before comparison. |
| 17 | Medium | Insecure production API fallback | Verified. Production uses HTTPS or same-origin `/api`; an `http://` base URL fails the production build. |
| 18 | Low | Unsanitized API error display | Fixed in Pass 2. `safe_client_error()` returns a fixed sentence plus the request id; `stored_error_message()` persists only the exception type; full tracebacks go to the server log. Frontend still normalises control characters and angle brackets. |
| 19 | Low | Asset uniqueness race | Fixed. Functional unique indexes enforce trimmed/case-folded uniqueness where legacy rows are collision-free; colliding tables are logged and skipped without modifying data. A FastAPI `IntegrityError` handler and router helpers return HTTP 409; referenced deletes return a controlled conflict. |
| 20 | Low | RBAC diagnostics disclosure | Verified. `/auth/me/rbac-diagnostics` requires `Edit System Settings`. |
| 21 | Low | Admin password never expires | Fixed. Admin and Super Admin accounts are capped at `ADMIN_PASSWORD_EXPIRY_DAYS` (≤ 90), non-expiring passwords are always refused for administrators, and ordinary accounts may use them only when `ALLOW_NON_ADMIN_PASSWORD_NEVER_EXPIRES=true`. Newly elevated users are reconciled immediately. |
| 22 | Low | Fast unsalted encryption-key derivation | Verified. New ciphertext uses PBKDF2-HMAC-SHA256, 600k iterations, with the persistent `SECURITY_KDF_SALT`; legacy SHA-256 ciphertext remains readable for migration. |
| 23 | Low | Missing browser security headers | Verified and extended. Every API response sets CSP, `X-Frame-Options: DENY`, `nosniff`, referrer, permissions, COOP/CORP, `Cache-Control: no-store`, and HSTS in production. The production SPA image sets the same headers at nginx. |
| 24 | Low | Public database diagnostic | Verified. `/db-test` requires authentication plus `Edit System Settings`; `/health` is a non-database liveness probe. |

## 2. Pass-2 controls added on top of the assessment

### 2.1 Password lifecycle

- Minimum 12 / maximum 128 characters; upper, lower, digit and special
  required; must not contain the username, full name or e-mail; must not match
  a common-password list (including leet variants); no 4-character repeated run
  or keyboard/numeric sequence.
- History of the last 5 bcrypt hashes (`password_history_json`) blocks reuse.
- Per-user expiry: 30 days by default, 60 for administrators, configurable up
  to 365; expiry is evaluated server-side, not only in the UI.
- Forced rotation: `force_password_change=Yes` (set by User Master or an admin
  reset) or an expired password produces HTTP 403 with
  `{"code": "PASSWORD_CHANGE_REQUIRED"}` on every endpoint except the small
  allowlist needed to complete the change.
- Administrators may never disable expiry on an Admin-role account and may not
  use the admin reset endpoint against themselves (self-service change is
  required, which re-verifies the current password).

### 2.2 Session management

- Every access/refresh token carries `session_epoch`. Revoking a user's
  sessions increments the counter, invalidating all previously issued tokens
  immediately and deterministically (no clock-resolution race).
- Revocation triggers: admin "Revoke Sessions", password change, admin reset,
  account deactivation, refresh-token reuse.
- `POST /auth/logout-all` ends every session of the caller.
- Access tokens are never persisted in the browser.

### 2.3 Abuse resistance

- Login: 5 failed attempts lock the account for 15 minutes (HTTP 423);
  20 failures / 5 min per IP; 10 failures / 15 min per identity.
- 2FA: 5 attempts per challenge, 5-minute challenge lifetime, 10 failures /
  15 min per user, 20 / 5 min per IP, TOTP codes single-use (highest accepted
  time-step is stored).
- Forgot password: 3 requests / 15 min per IP, uniform response for known and
  unknown accounts.
- Sensitive actions (change password, 2FA setup/disable):
  10 / 5 min per user. Refresh: 120 / 5 min per IP. Admin security console:
  30 / 5 min per actor.
- Request bodies are capped at 25 MB (`MAX_REQUEST_BODY_BYTES`), enforced for
  declared `Content-Length` and chunked uploads before buffering.

### 2.4 Error, logging and transport

- `safe_client_error()` never echoes exception text; HTTP 500 responses contain
  a generic message and the `X-Request-ID`.
- `stored_error_message()` persists only the exception type for
  `BackupRestoreValidation.error_message`, job rows and audit details.
- Global exception handler logs the traceback once and returns
  `{"detail": ..., "request_id": ...}`.
- `X-Request-ID` is echoed when the caller supplies a safe value
  (`[A-Za-z0-9._-]{8,64}`) and generated otherwise.
- `TrustedHostMiddleware` (when `TRUSTED_HOSTS` is set), optional HTTPS
  redirect, `Cache-Control: no-store`, and API-doc routes disabled in
  production unless `ENABLE_API_DOCS=true`.
- Redacting log formatter masks `password`, `token`, `secret`, `authorization`,
  `cookie`, DSN and bearer values.

### 2.5 Auditability

- Database browser reads now write `Browse Database Table` audit rows (actor,
  table, page, row counts, redacted column list) and failures write
  `Database Browser Read Failed`. Row contents are never copied into audit
  details.
- Backup/restore validation errors are persisted without driver text; checksum
  verification uses `hmac.compare_digest`.
- Security console actions (unlock, reset password, reset 2FA, require change,
  revoke sessions), 2FA lifecycle, login/logout and password changes are all
  audited.

## 3. Pass-3 controls added on 2026-11-11

### 3.1 Session-family revocation and database concurrency

- Interactive login, successful 2FA, and password change create an `auth_sessions`
  row and mint both JWTs with a shared `sid`; refresh rotates token IDs while
  retaining that `sid` and extends the session expiry.
- Protected requests and refresh reject revoked, expired, or mismatched session
  families. Logout verifies JWT signature/issuer/audience while ignoring only
  `exp`, so an expired access token can still revoke its family. Legacy tokens
  without `sid` trigger account-wide revocation for compatibility.
- Startup creates `auth_sessions` and nullable linked-asset FK columns without
  rewriting legacy link data. Case-insensitive unique indexes are created only
  where normalized data has no collisions; existing collisions are logged and
  left untouched. Database integrity races return HTTP 409 with CORS headers.

### 3.2 Administrator tiers and non-expiring password controls

- `Admin` and `Super Admin` both receive administrative authorization; only an
  explicit `Super Admin` role holder can grant the Super Admin tier. The
  bootstrap `admin` account is seeded with both reserved roles. System roles
  cannot be edited or unassigned through ordinary role administration.
- Administrator password expiry is capped at the configured administrator
  window, stale `password_never_expires` values are reconciled at startup and
  as soon as an Admin/Super Admin role is granted, and administrator bypass is
  unconditionally refused. Non-admin bypass is opt-in via
  `ALLOW_NON_ADMIN_PASSWORD_NEVER_EXPIRES` (default `false`).

### 3.3 Global assets and linked-asset continuity

- Global assets, prime-mover/tanker links involving Global assets, and Global
  asset calibration changes have distinct `Edit Global …` permissions in the
  backend and frontend.
- Asset recodes propagate to active and historical prime-mover/tanker link
  references, calibration tables, assignments, and flowmeter configuration;
  asset deletion is blocked while linked references exist.
- Link resolution prefers asset FKs and uses audit-log rename snapshots as a
  read-only fallback for older rows. Explicit edit/close/delete actions may
  repair stale codes; startup never rewrites legacy links. Asset-type names and
  active links preserve prime-mover/tanker classification across asset renames.

## 4. Production configuration required

```dotenv
ENVIRONMENT=production
CORS_ORIGINS=https://<trusted-frontend-origin>
JWT_SECRET_KEY=<high-entropy-secret>
ENCRYPTION_KEY=<high-entropy-secret>
SECURITY_KDF_SALT=<persistent-random-value-of-at-least-16-bytes>
INITIAL_ADMIN_PASSWORD=<strong-one-time-password>   # first bootstrap only
BACKUP_ROOT=<approved-dedicated-backup-directory>
AUTH_COOKIE_SECURE=true
TRUSTED_HOSTS=<public-hostname>
TRUST_PROXY_HEADERS=true                            # only behind the proxy
TRUSTED_PROXY_IPS=<proxy IP/CIDR>                   # "*" inside the compose network
ENFORCE_HTTPS=true
MAX_REQUEST_BODY_BYTES=26214400
```

See [`.env.example`](.env.example) for the full list and
[`DEPLOYMENT_SECURITY.md`](DEPLOYMENT_SECURITY.md) for the deployment runbook.

Changing `SECURITY_KDF_SALT` after v2 ciphertext is written makes those values
unreadable, so back it up with the encryption key.

## 5. Residual risks accepted for this release

| Risk | Why it remains | Mitigation |
|---|---|---|
| In-memory rate limiter is per process | Avoids a Redis dependency; `RATE_LIMIT_ENABLED` can be disabled in tests | Keep `WEB_CONCURRENCY` low, or front the API with an edge limiter; account lockout is database-backed and shared |
| `TokenBlacklist` rows are only purged by the admin endpoint | No scheduler in the stack | `POST /auth/cleanup-blacklist` (or a cron calling it) every night |
| Dashboard configuration metadata is readable across locations | Configs are treated as global templates; returned payload contains layout only | Add a location filter if configs ever carry operational data |
| `/company-report-profiles/print-options` and `/permissions/catalog` require only authentication | Needed by the shared print dialog and role editor for non-admin users | Both return static/master data only; both are audited by access logs |
| TOTP secret is stored with reversible encryption | Required to verify codes | `ENCRYPTION_KEY` + PBKDF2 salt must be protected as top-tier secrets |

## 6. Regression evidence

- `backend/tests/test_vulnerability_remediation.py` — token type claims,
  cookie refresh/logout, CORS, headers, diagnostics, reserved usernames, backup
  containment, credential-free argv, spreadsheet neutralisation, KDF migration,
  calibration ranges.
- `backend/tests/test_security_module.py` — password policy, lockout, 2FA
  limits, reset flows, session invalidation.
- `backend/tests/test_security_hardening_v2.py` — forced/expired password
  server-side enforcement, password history, username normalisation, LIKE
  escaping, admin expiry cap, default refusal/opt-in for non-admin non-expiring
  passwords, unconditional Admin/Super Admin refusal, expired-access logout
  family revocation, self-reset refusal, session revocation and refresh-reuse
  detection, TOTP replay, cross-site cookie refresh, throttling,
  enumeration-safe login, request-id and header checks.
- `backend/tests/test_hardening_infrastructure.py` — body ceiling (declared and
  chunked), request-id echo/sanitisation, production docs gating, error-message
  contract, LIKE escaping, reserved/duplicate usernames, self-deactivation,
  password rotation revocation, database-browser audit row and redaction.
- `backend/tests/test_rbac_hardening.py`, location/party-scope suites — RBAC
  and operation scope.
- `backend/tests` — full suite: **383 passed** on 2026-11-11.
- `frontend` — `npm run build` succeeds. `npm run lint:src` remains failing with
  127 errors / 62 warnings across the SPA, mostly unused variables and React
  effect-rule findings; this pass does not claim a clean lint run.

When a security control changes, update this register in the same commit and
add or adjust a regression test that demonstrates the intended boundary.
