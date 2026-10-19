# Profile & Security / Security Console

## Purpose

Enterprise account-security module covering:

1. **Self-service password management** – change password, password policy feedback, expiry and forced-change handling.
2. **Two-factor authentication (TOTP)** – enrolment, reconfiguration, recovery codes, disable, mandatory-2FA enforcement.
3. **Administrator account security** – locked-account registry, admin password reset, unlock, 2FA reset, session revocation, per-user 2FA policy.
4. **Password reset request workflow** – requests raised from the sign-in page, linked Task Manager tasks, approve / reject / cancel with audit trail.

Backend and database changes in this module were explicitly authorised by the product owner (this is the module named in the request), overriding `CLAUDE.md` rule 0 for this scope only.

## Screens and file locations

| Screen | Path | Files |
|--------|------|-------|
| My Profile & Security | `/profile-security` | `frontend/src/pages/ProfileSecurity.jsx`, `frontend/src/components/security/MySecurityPanel.jsx` |
| Security Console (admin) | `/security` | `frontend/src/pages/SecurityConsole.jsx`, `UserSecurityPanel.jsx`, `UserSecurityDialog.jsx`, `PasswordResetRequestsPanel.jsx` |
| Blocking security gate | rendered instead of the app while a prerequisite is outstanding | `frontend/src/components/security/SecurityGate.jsx` |
| Shared UI atoms | – | `frontend/src/components/security/SecurityPrimitives.jsx` |
| API module | – | `frontend/src/api/securityApi.js` |

Top navigation: **User Management → Profile & Security** (own security) and **User Management → Security Console** (requires `View User Security`). User Master also links each row to `/security?user_id=<id>` and shows lock / 2FA / password state.

## Permissions

Every route is wrapped in `PermissionGuard`; every mutating control checks its exact catalog permission.

| Permission | Controls |
|------------|----------|
| `View Own Security Settings` | Profile & Security route |
| `Edit Own Security Settings` | Change password, 2FA setup/regenerate/disable (forced remediation bypasses this check so an account can never be stranded) |
| `View User Security` | Security Console route, account registry, history, reset-request queue |
| `Reset User Password` | Admin password reset, "require password change", reset-request approval |
| `Reset User 2FA` | Reset a user's authenticator, per-user 2FA policy |
| `Lock User Account` | Lock account |
| `Unlock User Account` | Unlock account |
| `Revoke User Sessions` | Revoke all sessions |
| `Approve Password Reset Requests` | Approve / reject the self-service queue |

Additional server-side guard rails:

* Location-scoped administrators only administer users inside their scope.
* Only an `Admin` may reset / lock / revoke another `Admin`.
* Nobody can administer their own account through the console (use Profile & Security).
* The last active administrator cannot be locked or have their password reset by a non-admin.

## Password policy (server-enforced, mirrored in the UI)

* Minimum 12 characters, maximum 72 bytes (bcrypt limit).
* At least one uppercase, lowercase, digit and special character.
* Must not contain the username, email local part or full name.
* Must not match the current password or the last `PASSWORD_HISTORY_COUNT` (default 5) passwords.
* `PASSWORD_HISTORY_COUNT`, `PASSWORD_EXPIRY_DAYS_DEFAULT`, `MAX_FAILED_LOGIN_ATTEMPTS`, `ACCOUNT_LOCKOUT_MINUTES`, `MAX_2FA_ATTEMPTS` and `TOTP_SETUP_TTL_MINUTES` are environment-configurable in `backend/app/config.py`.

The frontend renders `PasswordPolicyChecklist` next to every password field. The server repeats every rule, including history, on all write paths (create user, self change, admin reset, reset-request approval, bulk import through the create endpoint).

## Self-service endpoints (`/auth`)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/auth/me` | Returns the user plus `security` flags (2FA state, password expiry, lock state, remaining recovery codes) |
| `GET` | `/auth/password-policy` | Machine-readable policy used by the UI |
| `POST` | `/auth/change-password` | Change own password; rejects the current password and history; rotates the security stamp and returns fresh tokens so only other sessions are signed out |
| `POST` | `/auth/2fa/setup/start` | Start enrolment (or reconfiguration, which requires current password + code); returns QR data URL, manual secret, expiry |
| `POST` | `/auth/2fa/setup/verify` | Verify the pending TOTP secret and return ten one-time recovery codes |
| `POST` | `/auth/2fa/backup-codes/regenerate` | Re-issue recovery codes (current password + TOTP/recovery code) |
| `POST` | `/auth/2fa/disable` | Disable 2FA (current password + TOTP/recovery code); blocked while `force_2fa = Yes`; rotates the security stamp |
| `GET` | `/auth/my/reset-requests` | Own password-reset requests and their status |
| `POST` | `/auth/my/reset-requests/{id}/cancel` | Cancel an own pending request; the linked Task Manager task is closed |
| `GET` | `/auth/my/security-activity` | Recent security audit events on the own account |
| `POST` | `/auth/forgot-password` | Raise a reset request from the sign-in page (rate limited, generic response, creates a Task Manager task) |

## Administrator endpoints

### Console router (`/security`)

| Method | Endpoint | Permission |
|--------|----------|------------|
| `GET` | `/security/overview` | View User Security |
| `GET` | `/security/users` | View User Security |
| `GET` | `/security/users/{id}` | View User Security |
| `GET` | `/security/users/{id}/history` | View User Security |
| `POST` | `/security/users/{id}/lock` | Lock User Account |
| `POST` | `/security/users/{id}/unlock` | Unlock User Account |
| `POST` | `/security/users/{id}/reset-2fa` | Reset User 2FA |
| `POST` | `/security/users/{id}/revoke-sessions` | Revoke User Sessions |
| `POST` | `/security/users/{id}/require-password-change` | Reset User Password |
| `POST` | `/security/users/{id}/two-factor-policy` | Reset User 2FA |
| `GET` | `/security/password-reset-requests` | View User Security |
| `POST` | `/security/password-reset-requests/{id}/approve` | Approve Password Reset Requests + Reset User Password (+ Reset User 2FA when requested) |
| `POST` | `/security/password-reset-requests/{id}/reject` | Approve Password Reset Requests |

### Admin reset (historical path kept for the existing UI contract)

`POST /auth/users/{user_id}/security/reset-password` – requires `Reset User Password`; `reset_2fa` additionally requires `Reset User 2FA`.

Body:

```json
{
  "generate_password": true,
  "new_password": null,
  "force_password_change": true,
  "reset_2fa": false,
  "unlock_account": true,
  "remarks": "Ticket INC-1042, identity verified"
}
```

The generated password is returned **once** as `temporary_password`. The reset always revokes every existing session by rotating `security_stamp`, closes pending reset requests/tasks and writes an audit event.

## Lockout model

* Five failed password attempts (configurable) lock the account for 15 minutes; the response is `423` with the remaining minutes and the remaining attempt count is returned for the last two failures.
* A successful sign-in, an administrator unlock and a password reset clear the counter and lock.
* Administrative locks may be timed (15 min – 365 days) or indefinite (`locked_until = 9999-12-31`), and store `locked_reason` + `locked_by_user_id`.
* Expired automatic locks are released on the next sign-in; indefinite locks never are.
* Locked accounts are visible in the Security Console with reason, expiry and the administrator who applied the lock. User Master shows a `Locked` pill.

## Two-factor authentication model

* TOTP (RFC 6238, 30-second step, ±1 step clock skew) with a provisioning QR code and manual secret.
* `pending_totp_secret_encrypted` keeps an in-progress enrolment separate, so starting setup can never disable an active authenticator.
* Setup expires after `TOTP_SETUP_TTL_MINUTES`.
* Login returns `requires_2fa` + `challenge_id`; the challenge expires after 5 minutes, allows `MAX_2FA_ATTEMPTS` attempts and is superseded by a newer password login.
* Accepted TOTP steps are recorded (`totp_last_used_step`) to prevent replay within the same 30-second window.
* Recovery codes are ten one-time codes hashed with SHA-256 (legacy bcrypt hashes still verify); codes are shown only at generation time.
* `force_2fa = Yes` makes the second factor mandatory. If the user has not enrolled, the API blocks business endpoints with `403` and the UI renders the blocking **2FA enrolment** screen. The user cannot disable 2FA while the policy is mandatory.
* Administrators can reset a user's authenticator and toggle the per-user 2FA policy from the console.

## Password reset request workflow

1. A user selects **Reset password** on the sign-in page; `POST /auth/forgot-password` creates `PasswordResetRequest` `PWR-YYYYMMDD-NNNN` and an `OperationTask` of type `PASSWORD_RESET_REQUEST`.
2. The user can follow the status and cancel a pending request from Profile & Security.
3. An administrator opens **Security Console → Password reset requests**, reviews the reason/2FA flag and approves (generated or manual password, force change, unlock, optional 2FA reset) or rejects with a mandatory reason.
4. Approval applies the same reset service as the console: password history, policy, stamp rotation, unlock, optional 2FA clear, request/task closure, audit.
5. Rejection closes the request and task, and the user sees the administrator note in Profile & Security.

## Blocking security prerequisite

`app/dependencies/auth.py` enforces `security_change_required()` on every request. While a password change is forced/expired, or mandatory 2FA enrolment is outstanding, only these paths remain available:

`/auth/change-password`, `/auth/me`, `/auth/logout`, `/auth/refresh`, `/auth/password-policy`, `/auth/2fa/setup/start`, `/auth/2fa/setup/verify`, `/auth/2fa/disable`, `/auth/2fa/backup-codes/regenerate`, `/auth/my/reset-requests`, `/auth/my/security-activity`.

All other endpoints return `403` with an explanatory message. The SPA mirrors this with `SecurityGate`, which replaces the application with either the password-change screen or the 2FA enrolment wizard, and `App.jsx` skips business-data preloading until the prerequisite is satisfied.

## Audit trail

All server mutations write `AuditLog` rows (module `User Security` / `Authentication`) with old/new status, target user, reason and request path. Key actions include:

`Login Success`, `Login Failed`, `Login Blocked`, `Account Locked`, `Account Unlocked`, `Change Own Password`, `Admin Reset User Password`, `Require Password Change`, `Start 2FA Setup`, `Enable 2FA`, `Reconfigure 2FA`, `Disable 2FA`, `Regenerate 2FA Backup Codes`, `Reset User 2FA`, `Update 2FA Policy`, `Revoke User Sessions`, `Password Reset Requested`, `Approve Password Reset Request`, `Reject Password Reset Request`, `Cancel Password Reset Request`.

The UI additionally calls `logUiAction` for tab switches, opening a user's security dialog and filter changes.

## Data model additions

`users`: `security_stamp`, `password_history_json`, `pending_totp_secret_encrypted`, `totp_setup_started_at`, `totp_last_used_step`, `locked_reason`, `locked_by_user_id`.

`auth_login_challenges`: `attempt_count`, `last_attempt_at`.

`backend/app/utils/db_migrations.py` adds the columns idempotently on startup (existing databases included) and backfills a security stamp for every existing user, so old tokens keep working until they expire and every account is immediately revocable.

## Tests

* `backend/tests/test_user_security.py` – 18 tests covering lockout, admin reset, 2FA challenge/replay, reset-request approval, session revocation, 2FA policy, the forced password-change flow and the prerequisite gate.
* `backend/tests/test_frontend_route_contract.py` – asserts every endpoint the frontend calls is served.
* Full suite: `cd backend && .venv/bin/python -m pytest tests/ -q`.
