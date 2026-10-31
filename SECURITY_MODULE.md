# Password Management, Sessions & 2FA — Security Module

For the 24-finding disposition, the deployment runbook, and residual risks see
[`SECURITY_REMEDIATION.md`](SECURITY_REMEDIATION.md),
[`DEPLOYMENT_SECURITY.md`](DEPLOYMENT_SECURITY.md) and
[`SECURITY_AUDIT_REPORT.md`](SECURITY_AUDIT_REPORT.md).

Single source of truth for the password lifecycle, session model and 2FA flows
after the October 2026 overhaul and the Pass-2 hardening.

## 1. Password policy

Enforced server-side in `backend/app/utils/password_policy.py` and mirrored for
instant feedback in `frontend/src/utils/passwordPolicy.js`. The API publishes
the machine-readable version at `GET /auth/password-policy`.

| Rule | Value |
|---|---|
| Length | 12–128 characters |
| Character classes | at least one uppercase, lowercase, digit and special character |
| Identity containment | must not contain the username, full name or e-mail (case/ punctuation insensitive) |
| Common passwords | rejected, including leet substitutions (`P@ssw0rd`, `Adm1n123` …) |
| Patterns | no 4 identical characters in a row; no 4-character keyboard or numeric sequence (`1234`, `qwer`, `asdf`, `zxcv`) |
| Current password | the new password must differ from the current one |
| History | the last 5 bcrypt hashes are stored in `users.password_history_json` and reuse is refused with HTTP 400 |
| Generator | the UI generates 16-character passwords with `crypto.getRandomValues` |

`GET /auth/password-policy` is deliberately public: it contains no secrets and
lets the login/forced-change screens describe the rules before authentication.

## 2. Expiry and forced rotation

| Account type | Default expiry | Hard limit |
|---|---|---|
| Standard user | 30 days (`DEFAULT_PASSWORD_EXPIRY_DAYS`) | 365 days (`MAX_PASSWORD_EXPIRY_DAYS`) |
| Admin-role account | 60 days (`ADMIN_PASSWORD_EXPIRY_DAYS`) | 90 days, never-expiry refused |

- `password_changed_at` drives the clock. Startup migration backfills legacy
  rows so upgrading does not lock anyone out.
- An expired password or `force_password_change=Yes` sets
  `must_change_password` on the login response **and** makes the API return
  HTTP 403 `{"code": "PASSWORD_CHANGE_REQUIRED", "reason": ...}` for every
  route outside a small allowlist: `/auth/me`, `/auth/change-password`,
  `/auth/password-policy`, `/auth/logout`, `/auth/logout-all`, `/auth/refresh`
  and the 2FA self-management endpoints.
- The frontend shows a full-screen gate (`ForcePasswordChange.jsx`) and also
  listens for `PASSWORD_CHANGE_REQUIRED` mid-session, so a password that expires
  while a tab is open forces the same gate without a page reload.
- Administrators cannot set "never expires" on an Admin-role account (HTTP 400),
  cannot reset their own password through the admin reset endpoint, and any
  admin-initiated reset always forces a change at the next sign-in.
- `INITIAL_ADMIN_PASSWORD` must satisfy the policy; the seeded bootstrap admin
  is created with `force_password_change=Yes`.

## 3. Flows

| Flow | Endpoint | Behaviour |
|---|---|---|
| Sign in | `POST /auth/login` | Enumeration-safe failure text, account lockout, IP/identity throttles; returns `access_token` plus `must_change_password` and, when enabled, a 2FA challenge |
| Second factor | `POST /auth/2fa/verify` | 5 attempts per challenge, 5-minute lifetime, per-IP and per-user throttles, TOTP single-use |
| Change own password | `POST /auth/change-password` | Requires the current password, applies policy + history, revokes every other session, returns a fresh access token and rotates the refresh cookie |
| Forgot password | `POST /auth/forgot-password` | 3 requests / 15 min / IP; identical response for known and unknown users; creates a `PasswordResetRequest` and an Operation Task for the security administrators |
| Admin reset | `POST /auth/users/{id}/security/reset-password` | Requires `Reset User Password`; sets `force_password_change=Yes`, clears lockout, optionally resets 2FA, revokes sessions, closes the pending request/task |
| Unlock account | `POST /auth/users/{id}/security/unlock` | Requires `Reset User Password`; clears `failed_login_count` and `locked_until` |
| Reset 2FA | `POST /auth/users/{id}/security/reset-2fa` | Requires `Reset User 2FA`; removes the enrolment and backup codes |
| Require change | `POST /auth/users/{id}/security/require-password-change` | Requires `Reset User Password`; sets the flag without knowing the password |
| Revoke sessions | `POST /auth/users/{id}/security/revoke-sessions` | Requires `Reset User Password`; bumps `session_epoch`, killing every access and refresh token |
| Sign out | `POST /auth/logout` | Blacklists the presented access/refresh token and clears the cookie |
| Sign out everywhere | `POST /auth/logout-all` | Revokes every session of the caller |
| Policy change | `PUT /auth/users/{id}/security/password-policy` | Admin-only; enforces the admin expiry cap and refuses never-expiry for admins |

Reserved usernames (`admin`, `administrator`, `root`, `system`, `superuser`)
cannot be created. Usernames are compared case-insensitively (`lower(trim(...))`)
for duplicates and login lookup; a database `IntegrityError` becomes HTTP 409.
Self-deactivation is refused (HTTP 403); deleting the reserved admin is refused.

## 4. Sessions

- **Access token** — HS256 JWT, 15 minutes, claims `sub`-equivalent `user_id`,
  `username`, `token_type=access`, `jti`, `iat`, `nbf`, `exp`, `iss`, `aud`,
  `session_epoch`. Kept only in JavaScript module memory.
- **Refresh token** — 1 day, HttpOnly + SameSite=Strict cookie
  (`hydrocarbon_refresh`), Secure in production, path `/`. Rotated on every
  refresh; the previous token is stored (SHA-256 hash) in `token_blacklist`.
- **Reuse detection** — presenting a blacklisted refresh token revokes every
  session of the account and writes a `Refresh Token Reuse` audit row.
- **Revocation** — `users.session_epoch` is embedded in every token. Bumping the
  epoch (admin revoke, password change, reset, deactivation, reuse detection)
  invalidates every token minted earlier, without relying on second-resolution
  timestamps. `session_revoked_at` is retained for the security console display.
- **Refresh cookie CSRF** — a browser `Origin`/`Referer` that is not in
  `CORS_ORIGINS` is rejected with 403 for cookie-authenticated refresh.
- **Legacy tokens** — tokens without `session_epoch` fall back to the
  `iat`-versus-`session_revoked_at` comparison with the revocation instant
  rounded up, so a pre-upgrade token cannot survive a revocation.

## 5. Lockout and throttling

| Scope | Limit |
|---|---|
| Failed sign-ins per account | 5 → locked 15 min (HTTP 423 with remaining minutes) |
| Sign-ins per IP | 20 / 5 min |
| Sign-ins per identity | 10 / 15 min |
| 2FA per challenge | 5 attempts, then burned |
| 2FA per user / per IP | 10 / 15 min · 20 / 5 min |
| Forgot password per IP | 3 / 15 min |
| Sensitive actions per user | 10 / 5 min |
| Refresh per IP | 120 / 5 min |
| Admin security console per actor | 30 / 5 min |

Throttles return HTTP 429 with `Retry-After`; the frontend appends
"Try again in N seconds." to the message. Limiters are in-process (see the
residual-risk table in `SECURITY_REMEDIATION.md`); the account lockout itself is
database-backed and shared across workers.

## 6. 2FA

- TOTP, 30-second step, `valid_window=1`; the highest accepted step is stored in
  `users.totp_last_used_step` and later steps are refused, so a code cannot be
  replayed inside its window.
- `POST /auth/2fa/setup/start` refuses to start a new enrolment while 2FA is
  already enabled (prevents a silent downgrade by an attacker holding a session).
- `POST /auth/2fa/setup/start` returns the secret, issuer and account for manual
  entry plus a QR data URL; verification returns 10 single-use backup codes
  (bcrypt-hashed at rest).
- Admin reset removes the enrolment; the user re-enrols at next sign-in.

## 7. Frontend

- `frontend/src/api/authToken.js` — memory-only access token, one-time purge of
  legacy localStorage keys, no refresh-token helpers.
- `frontend/src/api/apiClient.js` — sends the bearer token, retries once after a
  silent cookie refresh, surfaces `Retry-After`, and broadcasts
  `hydrocarbon:password-change-required` when the API returns that code.
- `frontend/src/App.jsx` — re-pulls the logged-in user on that event so the gate
  appears mid-session.
- `frontend/src/pages/ProfileSecurity.jsx` — live policy checklist (including
  name/e-mail containment), server-published policy summary, password
  generator, 2FA wizard, security KPI strip, reset-request queue and per-user
  actions including **Revoke Sessions** and **Sign out of all devices**.
- `frontend/src/pages/ForcePasswordChange.jsx` — the blocking gate with the same
  checklist and reason text (`expired` vs `administrator requirement`).

## 8. Tests

| File | Coverage |
|---|---|
| `backend/tests/test_security_module.py` | Password policy, lockout/unlock, 2FA lifecycle and attempt caps, admin reset, reset-request queue |
| `backend/tests/test_security_hardening_v2.py` | Forced/expired password enforcement, history reuse, admin expiry cap, self-reset refusal, revocation, refresh reuse, TOTP replay, 2FA downgrade, throttling, enumeration, LIKE escaping |
| `backend/tests/test_hardening_infrastructure.py` | Request body ceiling, request id, production docs gating, error-message contract, DB-browser audit/redaction, reserved/duplicate usernames, self-deactivation |
| `backend/tests/test_vulnerability_remediation.py` | Token claims, cookie refresh, CORS, headers, backup containment, KDF |

Run:

```bash
cd backend
python -m pytest tests/test_security_module.py tests/test_security_hardening_v2.py \
  tests/test_hardening_infrastructure.py tests/test_vulnerability_remediation.py -q
```
