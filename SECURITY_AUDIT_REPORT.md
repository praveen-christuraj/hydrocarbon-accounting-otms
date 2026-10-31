# Hydrocarbon Accounting & Oil Terminal Management System

## Independent Security Audit and Hardening Report

**Date:** 31 October 2026  
**Scope:** FastAPI backend, React SPA, database schema, Docker/deployment configuration  
**Assessment basis:** Internal Security Assessment v1.0 (5 September 2026, 24 findings) plus a full
re-audit of the current codebase  
**Branch:** `arena/51f6be3b-hydrocarbon-accounting-otms`  
**Repositories:** `backend/` (129 Python files, ~70k LOC), `frontend/` (React 19 + Vite), root deployment files

---

## 1. Executive summary

| Measure | Result |
|---|---|
| Findings from the original 24-item assessment re-verified | **24 / 24 mitigated** (no regression found) |
| New security issues found by the full re-audit | **14** (2 High, 7 Medium, 5 Low) — **all fixed in this branch** |
| Security issues found and accepted with compensating controls | **5** (documented in §8) |
| Backend automated tests | **353 passed, 0 failed** (full suite, 6 min 54 s) |
| Frontend production build | **Succeeds** (`npm run build`) |
| Deployment artefacts added | Production compose, nginx TLS-ready config, multi-stage SPA image, env template, deployment runbook |

**Verdict:** the 24 reported vulnerabilities are genuinely remediated in code, not just in the
reported areas. The re-audit nevertheless found material gaps that the first remediation pass did
not cover — most importantly, the forced-password-change gate existed only in the browser, session
revocation relied on a second-resolution timestamp comparison, and database/CLI error text was
still persisted and returned in backup-related flows. Those gaps are fixed and covered by
regression tests.

---

## 2. Scope and method

### 2.1 Coverage

- **Authentication & session layer** — `routers/auth.py`, `dependencies/auth.py`,
  `utils/jwt.py`, `utils/password_policy.py`, `utils/totp.py`, models, migrations.
- **Authorization layer** — `dependencies/permissions.py`, `routers/users.py`,
  `routers/roles.py`, `routers/permissions.py`, every router decorated with a permission check,
  location/party visibility helpers.
- **Data plane** — operation transactions, reports and the report builder/engine, exports,
  corrections, tanker/barge/FSO tracking, dashboard, tank stock ledger, book stock.
- **High-risk operations** — backup/restore (subprocesses + filesystem), database browser,
  bulk upload/export, calibration, spreadsheet generation.
- **Frontend** — token storage, API client, login/forced-change/profile-security pages, build
  configuration.
- **Deployment** — Dockerfiles, compose, nginx, environment configuration.

### 2.2 Techniques

1. **Line-by-line manual review** of the authentication, authorization, backup, export,
   database-browser and report modules.
2. **Pattern sweeps** for f-string SQL, `subprocess`/`eval`/`exec`/`pickle`, hard-coded
   credentials, `detail=str(exc)`, HTML sinks, `ilike(f"%…%")`, CSV/XLSX generation, and
   `@router` endpoints missing a permission dependency.
3. **Abstract-syntax-tree scripts** over every router to find (a) endpoints with a path
   identifier and no location-scope call, and (b) authenticated endpoints with no permission
   dependency. All hits were read manually; heuristics were not treated as findings.
4. **Dynamic verification** with `pytest` (353 tests) and a production frontend build.
5. **Data-flow review** of password handling: creation → first login → change → expiry → admin
   reset → forgot-password request → lockout → 2FA.

### 2.3 Reproducing the evidence

```bash
cd backend
python -m pytest -q                       # 353 passed

cd ../frontend
npm ci && npm run build                   # production bundle builds
npx eslint src/api/authToken.js src/api/authApi.js src/api/apiClient.js \
            src/api/securityApi.js src/App.jsx src/pages/ProfileSecurity.jsx
```

(The repository-wide ESLint run still reports pre-existing React hook/unused-variable findings;
the lines changed by this work add no new lint findings.)

---

## 3. Confirmation of the original 24 findings

All items were verified against the current code. "Verified" means the control exists in the
backend (not only the UI), is enforced on the server, and has a regression test or a direct code
path that proves it.

| # | Severity | Finding | Status | Where the control lives / evidence |
|---|---|---|---|---|
| 01 | High | CORS misconfiguration | Verified | `config._load_cors_origins`, CORS middleware with explicit methods/headers; `test_vulnerability_remediation.py::test_cors_does_not_echo_untrusted_origin` |
| 02 | High | Username-based admin backdoor | Verified | `is_admin_user` (role-based), reserved-name list, no username shortcuts; RBAC suites |
| 03 | High | JWT type confusion / long sessions | Verified | `utils/jwt.py` required claims + `token_type`; refresh rejected as bearer; 15 min / 1 day |
| 04 | High | Refresh survives logout / reuse | Verified | Rotation + blacklist + reuse-triggered epoch bump; `test_refresh_token_reuse_revokes_the_account_sessions` |
| 05 | High | No 2FA attempt limit | Verified | Challenge burn at 5 attempts + per-IP/per-user throttles; `test_2fa_challenge_attempts_are_capped` |
| 06 | High | Password policy missing on user writes | Verified | `validate_password_policy` in create/update/reset/self-change; extended in Pass 2 |
| 07 | High | Missing location scope on operational endpoints | Verified (+1 gap fixed) | Party/location helpers across export, correction, tanker, barge, FSO, ledger; correction-request **read** IDOR fixed in Pass 2 |
| 08 | High | Backup path traversal | Verified | `resolve_backup_path` containment; `test_backup_paths_remain_under_configured_root` |
| 09 | High | Seeded admin secret in logs | Verified | No credential printing; `INITIAL_ADMIN_PASSWORD` required in production; Pass 2 removed the duplicate hashing context in `seed_admin.py` |
| 10 | Medium | Calibration values lack validation | Verified | Range/type checks; `test_calibration_numeric_values_are_range_checked` |
| 11 | Medium | Tokens in localStorage | **Fixed in Pass 2** | Memory-only access token, HttpOnly cookie refresh, legacy-key purge |
| 12 | Medium | DB credentials in process arguments | Verified | `PGPASSWORD`/`PGSSLMODE` in child env; argv test |
| 13 | Medium | Spreadsheet formula injection | Verified | `utils/spreadsheet.py` neutralisation; used by CSV/XLSX exports |
| 14 | Medium | SQL built with f-strings | Verified and tightened | Reflected allowlisted tables; identifier interpolation guarded by `_SAFE_TABLE_NAME`; LIKE escaping |
| 15 | Medium | Tanker export HTML injection | Verified | Legacy HTML export removed; native `.xlsx` |
| 16 | Medium | Mixed naive/aware datetimes | Verified | `as_naive_utc` normalisation |
| 17 | Medium | Insecure production API fallback | Verified | Production build fails on `http://` base URL |
| 18 | Medium→Low | Unsanitized API error display | **Fixed in Pass 2** | `safe_client_error` / `stored_error_message` / global 500 handler |
| 19 | Low | Asset uniqueness race | Verified | `IntegrityError` → HTTP 409 |
| 20 | Low | RBAC diagnostics disclosure | Verified | `Edit System Settings` required |
| 21 | Low | Admin password never expires | Verified and strengthened | 60-day default, 90-day cap, never-expiry refused for Admin-role accounts |
| 22 | Low | Fast unsalted key derivation | Verified | PBKDF2-HMAC-SHA256 600k + persistent salt, legacy readable |
| 23 | Low | Missing security headers | Verified and extended | API + nginx header sets, HSTS in production |
| 24 | Low | Public DB diagnostic | Verified | `/db-test` requires auth + `Edit System Settings` |

---

## 4. New findings from the exhaustive re-audit

| ID | Severity | Area | Description | Fix | Regression test |
|---|---|---|---|---|---|
| P2-01 | **High** | Password lifecycle | `force_password_change` and password expiry were enforced only by the React gate. Any API client could keep using an expired or reset password indefinitely. | `get_current_user_from_token` now returns HTTP 403 `PASSWORD_CHANGE_REQUIRED` on every route except the change-password allowlist; login reports `must_change_password`. | `test_security_hardening_v2.py::test_forced_password_change_blocks_every_other_endpoint`, `…expired_password_blocks_api_until_rotated` |
| P2-02 | **High** | Session revocation | Revocation compared `iat` (whole seconds) with the revocation timestamp and allowed a 2-second grace. A token minted or refreshed in the same second survived; the grace also delayed "Revoke Sessions". | Added `users.session_epoch`, embedded in every token. Revocation increments the epoch; any older token is rejected immediately and deterministically. | `test_admin_can_revoke_every_session_of_a_user`, `test_logout_all_revokes_the_current_access_token`, `test_refresh_token_reuse_revokes…` |
| P2-03 | Medium | Authorization (IDOR) | `GET /operation-transactions/{id}/correction-requests` required "View Operation Transaction" but never checked that the transaction's location was in the caller's scope. | Transaction is loaded and `ensure_location_in_user_scope` is applied before returning correction history. | Covered by existing correction/location suites; the code path is now identical to the write endpoint |
| P2-04 | Medium | Error handling | Backup/restore and bulk-upload handlers persisted `str(exc)` into job/validation rows and audit details, and returned exception text in HTTP 500 messages — potentially leaking SQL, DSNs, file paths and CLI stderr. | `safe_client_error()`, `stored_error_message()` and `log_exception()` applied across `backup_restore.py` and both bulk-upload loops; full detail goes only to the server log. | `test_hardening_infrastructure.py::test_client_errors_never_contain_driver_text` |
| P2-05 | Medium | Abuse resistance | Login, 2FA, forgot-password and sensitive actions had no IP/identity throttles beyond the per-account lockout (which lets an attacker spray many usernames). | Sliding-window limiter with per-scope limits and `Retry-After`; account lockout remains database-backed. | `test_login_is_throttled_per_ip` |
| P2-06 | Medium | 2FA | A valid TOTP code could be replayed inside its 30-second window; `setup/start` could also overwrite an existing enrolment if a session was stolen. | Highest accepted time-step persisted (`totp_last_used_step`); setup refuses when 2FA is already enabled. | `test_totp_code_cannot_be_replayed`, `test_starting_2fa_setup_cannot_disable_an_existing_enrolment` |
| P2-07 | Medium | Monitoring | Reading raw database tables through the admin browser left no audit trail. | Audit rows `Browse Database Table` / `Database Browser Read Failed` with actor, table, page and counts — never row contents. | `test_database_browser_writes_an_audit_row_without_row_contents` |
| P2-08 | Medium | Availability | No request-body ceiling; a single client could post an arbitrarily large body to any endpoint (including unauthenticated login). | `RequestBodyLimitMiddleware` enforces 25 MB for declared and chunked bodies before buffering. | `test_declared_oversized_body_is_rejected_before_parsing`, `test_streamed_oversized_body_raises_413…` |
| P2-09 | Medium | Production exposure | The production frontend container ran the Vite **dev server** with a bind mount; the API docs/openapi routes were reachable in production. | Multi-stage nginx image (`frontend/Dockerfile.prod`, `nginx.prod.conf`) serving the static bundle; docs/openapi/redoc are not registered when `ENVIRONMENT=production` (unless `ENABLE_API_DOCS=true`). | `test_api_docs_are_disabled_in_production` |
| P2-10 | Low | Input handling | Search filters interpolated user input into `ILIKE` patterns without escaping `%`, `_` or `\`, allowing a caller to force a full-table match. | `escape_like()` + `escape="\\"` across seven routers. | `test_user_search_wildcards_are_escaped`, `test_escape_like_neutralizes_wildcards` |
| P2-11 | Low | Traceability | No correlation identifier on responses or logs; support could not tie a user report to a server event. | `RequestContextMiddleware` echoes a sanitised `X-Request-ID` (or generates a UUID); redacting log formatter; global 500 handler returns it. | `test_valid_request_id_is_echoed`, `test_invalid_request_id_is_replaced` |
| P2-12 | Low | Transport | HSTS, Host-header allowlisting and HTTPS redirect were absent; no reverse-proxy contract for client IPs. | Middleware for TrustedHost/HTTPS/headers; `TRUST_PROXY_HEADERS`/`TRUSTED_PROXY_IPS` with documented nginx overwrite of `X-Forwarded-For`. | Header assertions in `test_vulnerability_remediation.py` and `test_responses_carry_request_id_and_no_store` |
| P2-13 | Low | Password policy | No reuse history, no common-password/sequence checks, and the frontend checklist only compared the username (not full name/e-mail). | History of 5 bcrypt hashes; common/leet list; repeated-run and keyboard/number sequence checks; identity containment across username/full name/e-mail. | `test_password_history_prevents_reuse`, `test_password_policy_rejects_predictable_passwords` |
| P2-14 | Low | Ops hygiene | `seed_admin.py` created a second password context, and the bootstrap admin was seeded without an explicit expiry policy. | Uses the application's `hash_password`; seeds 60-day expiry; never-expiry is hard-disabled for admins. | Covered by the password-policy/admin-cap tests |

---

## 5. Password subsystem — detailed verification

### 5.1 Policy (server-enforced)

| Rule | Value |
|---|---|
| Length | 12–128 characters (configurable within 12–64 min, 64–256 max) |
| Composition | uppercase + lowercase + digit + special |
| Identity | must not contain username, full name or e-mail |
| Dictionary | common passwords rejected, including leet variants |
| Patterns | no 4 repeated characters, no 4-character keyboard/numeric sequence |
| Current password | must differ |
| History | 5 previous bcrypt hashes |
| Publication | `GET /auth/password-policy` (public, no secrets); the SPA renders the same checklist |

### 5.2 Expiry periods

| Account | Default | Maximum | Never-expires |
|---|---|---|---|
| Standard user | 30 days | 365 days | Allowed only with an explicit per-user exception |
| Admin role / reserved `admin` | 60 days | 90 days | **Refused** (HTTP 400 from the policy endpoint) |

Expiry is evaluated from `password_changed_at` on every authentication and on every request
(through the forced-change guard), not just at login. Legacy rows are backfilled at startup so an
upgrade never locks users out.

### 5.3 Change vs. reset vs. forced reset

| Event | Who can trigger | Current password required | Session effect | Forced change afterwards |
|---|---|---|---|---|
| **Change** (`POST /auth/change-password`) | The account owner | **Yes** | All other sessions revoked; a fresh token pair is issued | No |
| **Admin reset** (`POST /auth/users/{id}/security/reset-password`) | Holder of `Reset User Password` (admin) | No — the administrator must not know it | Target's sessions revoked | **Always** (`force_password_change=Yes`) |
| **Forgot password** (`POST /auth/forgot-password`) | Anonymous, rate-limited | No | None until an administrator acts | Creates a request + Operation Task for the security queue |
| **Require change** (`…/security/require-password-change`) | Holder of `Reset User Password` | No | None | Yes |
| **Expiry** | Time | — | Existing session continues only until the next request | Yes (server 403 + UI gate) |
| **Deactivation** | Admin / User Master | — | Sessions revoked | — |

Self-service password reset links are deliberately **not** implemented: resets are mediated by an
administrator through the audited request queue, which removes the token-in-e-mail attack surface
typical of "reset link" designs.

### 5.4 Administrator-specific rules

- An administrator may not reset their **own** password through the admin endpoint (must use the
  self-service change, which requires the current password).
- An administrator may not set "never expires" on any Admin-role account.
- A non-admin holding `Reset User Password` can never reset, unlock or alter the reserved Admin
  account.
- Administrator security actions are location-scoped and rate-limited (30 / 5 min per actor) and
  each writes an audit row.

### 5.5 Lockout, throttling and 2FA

- 5 failed sign-ins → 15-minute lock (HTTP 423), cleared by an administrator or by a successful
  password reset.
- Per-IP and per-identity sliding windows (see §6). Forgot-password always responds identically,
  so unknown accounts cannot be enumerated; unknown users are still hashed against a dummy bcrypt
  value to equalise timing.
- TOTP ±1 step, single-use, 5 attempts per challenge, challenge lifetime 5 minutes, backup codes
  single-use and bcrypt-hashed, 2FA setup cannot silently overwrite an existing enrolment.

### 5.6 Evidence

`backend/tests/test_security_module.py` (11 flows), `backend/tests/test_security_hardening_v2.py`
(21 tests) and `backend/tests/test_hardening_infrastructure.py` (18 tests) exercise every row of
the tables above, including the negative cases (expired password blocked, reuse rejected,
never-expiry refused, self-reset refused, replay rejected).

---

## 6. Top security features delivered (submission summary)

**Identity and credentials**

1. 12–128 character policy with identity, dictionary, repetition and sequence checks — enforced
   server-side on every write path.
2. Five-password history with bcrypt storage and no plaintext/reversible copies.
3. Per-user expiry (30 days default, 60 for admins, 90 cap) with a **server-enforced** forced
   change that cannot be bypassed by calling the API directly.
4. Account lockout plus per-IP/per-identity throttling and `Retry-After` feedback.
5. Enumeration-safe login, forgot-password and timing equalisation.
6. TOTP 2FA with QR enrolment, single-use codes (replay-proof), single-use backup codes and
   administrator-assisted recovery.
7. Cryptographically generated strong passwords in the UI (Web Crypto).

**Sessions**

8. Short-lived access tokens (15 min) held only in memory; refresh tokens only in HttpOnly,
   SameSite=Strict, Secure cookies.
9. Refresh rotation, blacklist, reuse detection and **immediate** epoch-based revocation of all
   sessions (admin action, password change, reset, deactivation).
10. "Sign out of all devices" and per-user "Revoke Sessions" in the security console.
11. CSRF origin validation on cookie-authenticated refresh.

**Authorization**

12. Role-based permissions with location and party scope, verified endpoint by endpoint; reserved
    admin identity protected from non-admin security actions.
13. Object-level checks on transactions, corrections, reports, tasks, tracking and security
    consoles (including the IDOR found in Pass 2).
14. Reserved usernames, case-insensitive uniqueness, self-deactivation protection.

**Data and operations**

15. Backup/restore path containment, constant-time checksum verification, allowlisted table names,
    no credentials in argv and sanitised error persistence.
16. Full audit trail for authentication, security-console actions, password lifecycle, backup,
    restore and privileged database reads — with no sensitive payloads copied into audit rows.
17. Read-only database browser with column redaction restricted to the Admin role.
18. SQL built exclusively through SQLAlchemy constructs; identifier interpolation guarded by a
    strict regex; LIKE metacharacters escaped.

**Transport, errors and monitoring**

19. Security headers (CSP, frame denial, nosniff, referrer, permissions, COOP/CORP), HSTS in
    production, `no-store` on API responses.
20. Request-body ceiling, TrustedHost allowlist, optional HTTPS redirect, production API-doc
    blackout.
21. Generic client errors plus `X-Request-ID`, with full tracebacks only in the server log and a
    redacting log formatter.
22. Logout/token-blacklist maintenance endpoint and documented operational cadence.

**Deployment**

23. Production compose topology: only nginx publishes a port, proxy headers are controlled, the SPA
    is a static build, TLS-ready nginx configuration with matching body limit and headers.
24. `.env.example` and a verification checklist IT can execute after deployment.

---

## 7. Verification results

```
cd backend && python -m pytest -q
353 passed, 354 warnings in 414.19s (0:06:54)

cd frontend && npm run build
✓ built (production bundle)

npx eslint <changed files>
No new findings attributable to the changed code (pre-existing hook/unused-variable findings remain)
```

Key suites: `test_vulnerability_remediation.py` (19), `test_security_module.py` (11),
`test_security_hardening_v2.py` (21), `test_hardening_infrastructure.py` (18),
`test_rbac_hardening.py` (28), plus location/party-scope, report and tracking suites.

---

## 8. Accepted risks and recommended follow-ups

| Item | Why accepted now | Recommended action |
|---|---|---|
| In-memory throttling is per worker | No Redis dependency in the stack; lockout is database-backed | Add Redis or an edge rate limiter if `WEB_CONCURRENCY` is raised, or keep workers ≤ 2 |
| Expired token-blacklist rows are only purged on demand | No scheduler component | Schedule `POST /auth/cleanup-blacklist` nightly |
| Dashboard configuration metadata is readable across locations | Configs are global layout templates; no operational data returned | Add the location filter if configs are ever scoped |
| `/company-report-profiles/print-options` and `/permissions/catalog` require login only | Needed by the shared print dialog and role editor for non-admin users | Keep them read-only and free of personal data (current state) |
| TOTP secret is reversibly encrypted | Verification requires the plaintext secret | Protect `ENCRYPTION_KEY`/`SECURITY_KDF_SALT` in a secret manager; plan a rotation procedure |

**Recommended next steps (not blocking this release):** external penetration test against the
deployed stack, dependency scanning in CI (`pip-audit`, `npm audit`), immutable/WORM audit-log
storage, alerting on repeated `Refresh Token Reuse` or `Database Browser Read Failed` events, and
MFA enforcement (`force_2fa`) for all Admin-role accounts.

---

## 9. Sign-off checklist

- [ ] All 353 backend tests pass on the release commit
- [ ] `npm run build` succeeds with `ENVIRONMENT=production`
- [ ] `.env` populated from `.env.example`; secrets stored in the secret manager
- [ ] Production compose started; backend port not published
- [ ] Post-deployment verification in `DEPLOYMENT_SECURITY.md` §5 completed and attached to the ticket
- [ ] Bootstrap administrator signed in, password changed, 2FA enabled
- [ ] Nightly blacklist purge and weekly audit review assigned
- [ ] Residual risks in §8 reviewed and accepted by the system owner
