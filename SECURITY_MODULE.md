# Password Management & 2FA — Security Module

For the full 24-finding assessment disposition and deployment requirements,
see [`SECURITY_REMEDIATION.md`](SECURITY_REMEDIATION.md).

How authentication security works after the 2026-10 overhaul of the Profile &
Security module. Single source of truth for the flows an administrator or a
user can trigger.

## What was broken before (and is now fixed)

| # | Defect | Root cause | Fix |
|---|--------|-----------|-----|
| 1 | Enabling 2FA always failed with HTTP 500 | `verify_2fa_setup` used `pyotp` that was only imported inside another function (`NameError`) | Module-level import; full flow covered by `backend/tests/test_security_module.py` |
| 2 | 2FA sign-in verification crashed with HTTP 500 | Naive DB timestamp compared with a timezone-aware `datetime` (`TypeError`) | All auth timestamps normalized to naive UTC (`utc_now_naive` / `as_naive_utc`) |
| 3 | Locked accounts invisible, no unlock | No API exposed `locked_until` / `failed_login_count`; no unlock endpoint | `GET /auth/users/security-overview` + `POST /auth/users/{id}/security/unlock` + admin console UI |
| 4 | Admin could not change own password in User Master | Frontend turned the self-password caution into a blocking validation error | Caution is now non-blocking and explains the session sign-out |
| 5 | 2FA setup showed "Manual code: undefined" | `/auth/2fa/setup/start` never returned the secret | Response now includes `secret`, `issuer`, `account` |
| 6 | Reset requests unmanageable | No list/decline endpoints; only an Operation Task existed | Queue endpoints + approve/decline UI in Profile & Security |
| 7 | `force_password_change` was never enforced | Flag set on user create / admin reset, never checked | Full-screen forced password change gate before the app renders |
| 8 | Password policy not enforced server-side on user create/update | Only the 12-char check in the frontend | `validate_password_policy` on `/users` create & update |

## Policies

* **Password policy** (`backend/app/utils/password_policy.py`, mirrored in
  `frontend/src/utils/passwordPolicy.js`): ≥12 and ≤128 chars, upper + lower +
  digit + special, must not contain the username, must differ from the current
  password. Enforced on self change, admin reset, user create and user update.
* **Account lockout**: 5 failed sign-ins → locked 15 minutes (HTTP 423 with
  remaining time). An `Account Locked` audit row is written. Administrators
  unlock instantly from the console.
* **2FA brute force**: a login challenge accepts at most 5 wrong codes, then
  it is burned and the user must sign in again. TOTP accepts ±1 time step of
  clock drift. Backup codes are single-use (bcrypt-hashed).
* **Session revocation**: access/refresh tokens carry `iat`; any token issued
  more than 60 s before the user's `password_changed_at` is rejected. An admin
  reset therefore ends every open session of the target user. Self-service
  password change returns a fresh access token and rotates the HttpOnly refresh
  cookie so the active session continues.
* **Forced password change**: `force_password_change=Yes` or an expired
  password (per-user `password_expiry_days`, default 30, unless
  `password_never_expires=Yes`) routes the user to a full-screen change form
  before anything else loads. Changing one's own password is an inherent right
  of every authenticated account and is NOT permission-gated (new users have
  no role yet); 2FA self-management stays behind `Edit Own Security Settings`.

## Endpoints (all under `/auth`, all audited)

| Endpoint | Permission | Purpose |
|----------|-----------|---------|
| `POST /change-password` | authenticated | Rotate own password, return a fresh access token, and rotate the refresh cookie |
| `POST /2fa/setup/start` / `setup/verify` | Edit Own Security Settings | Enrol TOTP, returns QR + manual secret, then 10 backup codes |
| `POST /2fa/backup-codes/regenerate` / `2fa/disable` | Edit Own Security Settings | Backup code / disable management |
| `GET /users/security-overview` | Reset User Password or Reset User 2FA | Lock state, failed counts, 2FA, password age for every user in scope |
| `POST /users/{id}/security/reset-password` | Reset User Password (+ Reset User 2FA for the 2FA flag) | Hard reset; clears lock; auto-completes pending reset requests and their tasks |
| `POST /users/{id}/security/unlock` | Reset User Password | Clear lockout + failed counter |
| `POST /users/{id}/security/reset-2fa` | Reset User 2FA | Remove 2FA enrolment (lost device) |
| `POST /users/{id}/security/require-password-change` | Reset User Password | Flag account for forced change at next sign-in |
| `GET /password-reset-requests` | Reset User Password | Queue (`?status=Pending/Completed/Declined/All`) |
| `POST /password-reset-requests/{id}/decline` | Reset User Password | Close a request without a reset (closes its task) |
| `POST /forgot-password` | anonymous, rate-limited 3/15 min/IP | Creates request + `PASSWORD_RESET_REQUEST` task |

Admin-account shield: a non-admin holding `Reset User Password` can never
reset/unlock/alter the reserved Admin account, and all admin security actions
respect the actor's location scope.

## Frontend

* `frontend/src/pages/ProfileSecurity.jsx` — account overview, change
  password with live policy checklist, 2FA wizard (QR + manual key, backup
  codes with copy/download), and for security admins: KPI strip, the password
  reset request queue (approve → prefilled reset dialog / decline with notes)
  and the user security table (unlock, reset password with strong-password
  generator, reset 2FA, require change) with filters, pagination and export.
* `frontend/src/pages/ForcePasswordChange.jsx` — the forced-change gate
  (wired in `App.jsx` before the router).
* Tests: `backend/tests/test_security_module.py` (12 end-to-end flows).
