# Hydrocarbon Accounting Security Remediation Register

This file is the repository memory for the findings in
`hydrocarbon_report.docx` (Internal Security Assessment v1.0, 5 September
2026). Future maintainers and coding agents should read this register before
changing authentication, authorization, exports, calibration, backup, or
diagnostic behavior.

Last verified: 2026-10-31. The review covered all 24 findings against the
current backend and frontend, including items already corrected before this
remediation branch.

## Finding disposition

| # | Severity | Finding | Disposition and control |
|---|---|---|---|
| 01 | High | CORS misconfiguration | Fixed. Production requires an explicit HTTPS `CORS_ORIGINS` allowlist; wildcard origins are rejected and methods/headers are restricted. |
| 02 | High | Username-based admin backdoor | Fixed. Administrative access requires an active `Admin` role. Reserved usernames cannot be created or assigned through User Master. Frontend username shortcuts were removed. |
| 03 | High | JWT type confusion and long sessions | Fixed. Both token decoders require `exp`, `iat`, `jti`, `user_id`, and the correct `token_type`. Defaults are 15 minutes for access and 1 day for refresh. |
| 04 | High | Refresh token survives logout/reuse | Fixed. Refresh tokens rotate and the prior token is blacklisted. Logout revokes access and refresh tokens and expires the refresh cookie. |
| 05 | High | No 2FA verification attempt limit | Previously fixed and verified. A login challenge is invalidated after five failed attempts. |
| 06 | High | Password policy missing on user writes | Previously fixed and verified. Backend create, update, reset, and self-change flows enforce the shared password policy. |
| 07 | High | Missing location scope on operational endpoints | Previously fixed and verified. Export, correction, tanker, vessel ledger, movement mapping, flowmeter, assignment, FSO/shuttle, and barge routes apply actor location/party scope. Existing scope regression suites cover these flows. |
| 08 | High | Backup path traversal | Fixed. Backup settings and recorded files resolve beneath `BACKUP_ROOT`; traversal and outside absolute paths are rejected. |
| 09 | High | Seeded admin secret in logs | Fixed. Production bootstrap requires `INITIAL_ADMIN_PASSWORD`; neither seed path prints the value. Development migration-generated credentials are also never printed. |
| 10 | Medium | Calibration values lack validation | Fixed. Numeric template columns reject text, negative, non-finite, and excessive values. Submissions default to a maximum of 1,000 rows. |
| 11 | Medium | Browser tokens in localStorage | Fixed. Access tokens are held in memory and refresh tokens are delivered only through an HttpOnly, SameSite=Strict cookie. Legacy localStorage tokens are removed during one-time migration. |
| 12 | Medium | Database credentials in process arguments | Fixed. PostgreSQL tools receive discrete connection flags and `PGPASSWORD`/`PGSSLMODE` through the child environment; URLs and passwords are absent from argv. |
| 13 | Medium | Spreadsheet formula injection | Fixed. Shared backend and frontend helpers neutralize formula prefixes in CSV and XLSX output. The named material balance, flowmeter, tank summary, and transaction exports use them. |
| 14 | Medium | SQL built with f-strings | Fixed. The database browser uses allowlisted reflected SQLAlchemy tables and expression queries. Internal database errors are not returned to clients. |
| 15 | Medium | Tanker export HTML injection | The reported Tanker Tracking HTML builder was already absent on current `main`. An adjacent legacy HTML-as-`.xls` tanker transaction export was found during the wider audit and replaced with native, sanitized `.xlsx` generation. |
| 16 | Medium | Mixed naive/aware lockout datetimes | Previously fixed and verified. Authentication normalizes database timestamps to UTC-compatible values before comparison. |
| 17 | Medium | Insecure production API fallback | Fixed. Production uses configured HTTPS or same-origin `/api`; an explicit production `http://` URL fails startup. |
| 18 | Low | Unsanitized API error display | Fixed. API detail text is normalized, control characters are removed, angle brackets are neutralized, and output is length-limited, including download failures. |
| 19 | Low | Asset uniqueness race | Fixed. Asset create/update catches database `IntegrityError`, rolls back, and returns HTTP 409. Referenced deletes also return a controlled conflict. |
| 20 | Low | RBAC diagnostics disclosure | Fixed. `/auth/rbac-diagnostics` requires `Edit System Settings`. |
| 21 | Low | Admin password never expires | Fixed. New and existing bootstrap administrators use password expiry with a 90-day period; new accounts must change the initial password. |
| 22 | Low | Fast unsalted encryption-key derivation | Fixed. New ciphertext uses PBKDF2-HMAC-SHA256 with 600,000 iterations and a persistent salt. Legacy SHA-256-derived ciphertext remains readable for migration. |
| 23 | Low | Missing browser security headers | Fixed. API middleware sets CSP, clickjacking, MIME-sniffing, referrer, and permissions headers on every response; HSTS is enabled in production. |
| 24 | Low | Public database diagnostic | Fixed. `/db-test` now requires authentication plus `Edit System Settings`. Public `/health` remains a non-database liveness check. |

## Production configuration required

Set and retain these values in the deployment secret/configuration store:

- `ENVIRONMENT=production`
- `CORS_ORIGINS=https://<trusted-frontend-origin>` (comma-separated if needed)
- `JWT_SECRET_KEY=<high-entropy-secret>`
- `ENCRYPTION_KEY=<high-entropy-secret>`
- `SECURITY_KDF_SALT=<persistent-random-value-of-at-least-16-bytes>`
- `INITIAL_ADMIN_PASSWORD=<strong-one-time-password>` for the first bootstrap only
- `BACKUP_ROOT=<approved-dedicated-backup-directory>`
- `AUTH_COOKIE_SECURE=true`

The refresh cookie is SameSite=Strict. Serve the frontend and API from the
same site (a reverse-proxied `/api` path is the default production layout).
Changing `SECURITY_KDF_SALT` after v2 values are written makes those values
unreadable, so back it up with the encryption key.

## Regression evidence

- `backend/tests/test_vulnerability_remediation.py` covers token type claims,
  cookie-only refresh sessions and logout, CORS behavior, security headers,
  diagnostic authentication, reserved usernames, backup containment,
  credential-free PostgreSQL argv, spreadsheet neutralization, KDF migration,
  and calibration ranges.
- `backend/tests/test_security_module.py` covers password policy, account
  lockout, 2FA attempt limits, reset flows, and session invalidation.
- `backend/tests/test_rbac_hardening.py` and the location/party-scope suites
  cover RBAC, location visibility, refresh rotation, and operation scope.
- `frontend/scripts/test-bulk-io.mjs` verifies CSV/XLSX formula neutralization
  and memory-only access-token storage. The production build, smoke suite, and
  targeted lint validate the shared client changes. The repository-wide lint
  command still reports unrelated pre-existing React hook and unused-variable
  findings outside this remediation.

When a security control changes, update this register in the same commit and
add or adjust a regression test that demonstrates the intended boundary.
