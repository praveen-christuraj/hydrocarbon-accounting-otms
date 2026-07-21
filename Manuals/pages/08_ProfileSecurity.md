# ProfileSecurity

## Purpose
Self-service user profile and security settings. Users can change their own password, set up TOTP 2FA, manage backup codes, and disable 2FA. Admins can reset other users' passwords and 2FA.

## File Locations
- **Frontend:** `frontend/src/pages/ProfileSecurity.jsx`
- **API Module:** `frontend/src/api/securityApi.js`
- **Backend Router:** `backend/app/routers/auth.py` (prefix: `/auth`)

## API Endpoints (via securityApi.js)
| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/auth/change-password` | Change own password |
| `POST` | `/auth/2fa/setup/start` | Start TOTP setup (returns QR code URI + secret) |
| `POST` | `/auth/2fa/setup/verify` | Verify and confirm TOTP setup |
| `POST` | `/auth/2fa/backup-codes/regenerate` | Regenerate backup codes |
| `POST` | `/auth/2fa/disable` | Disable 2FA on account |
| `POST` | `/auth/admin-reset-password` | Admin reset another user's password |

## Features
1. **Password Change** — requires current password, new password (min 12 chars), confirmation
2. **2FA Setup** — scans QR code with authenticator app, enters 6-digit code, receives backup codes
3. **2FA Disable** — requires current password + TOTP code
4. **Backup Code Management** — view/regenerate backup codes
5. **Admin Password Reset** — Admin can reset any user's password, force change on next login, and reset 2FA

## Key Functions

### Self-Service
| Function | API Call |
|----------|----------|
| `submitPasswordChange()` | `POST /auth/change-password` |
| `begin2FASetup()` | `POST /auth/2fa/setup/start` |
| `submit2FASetup()` | `POST /auth/2fa/setup/verify` |
| `regenerateCodes()` | `POST /auth/2fa/backup-codes/regenerate` |
| `submitDisable2FA()` | `POST /auth/2fa/disable` |

### Admin
| Function | API Call |
|----------|----------|
| `submitAdminPasswordReset()` | `POST /auth/admin-reset-password` |

## Permission Requirements
- **Self-Service:** View Own Security Settings
- **Admin Password Reset:** Manage User or Admin role

---

## Full-Stack Architecture Diagram — ProfileSecurity

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND LAYER (React SPA)                                              │
│                                                                                                      │
│  ┌──────────────────────────────────────────────────────────────────────────────────────────────┐   │
│  │  ProfileSecurity.jsx                                                                          │   │
│  │  ───────────────────                                                                          │   │
│  │  Props: loggedInUser, users[]  (users for admin dropdown)                                      │   │
│  │                                                                                                │   │
│  │  ┌─────────────────┐   ┌───────────────────┐   ┌──────────────────────┐   ┌──────────────┐     │   │
│  │  │  Password Change │   │  2FA Setup        │   │  2FA Disable         │   │  Admin Reset │     │   │
│  │  │                  │   │                   │   │                      │   │              │     │   │
│  │  │  changeOwnPwd()  │   │  start2FASetup()  │   │  disableOwn2FA()     │   │  adminReset  │     │   │
│  │  │  ────────────────│   │  ────────────     │   │  ──────────────      │   │  UserPwd()   │     │   │
│  │  │  POST /auth/     │   │  POST /auth/      │   │  POST /auth/        │   │  ─────────── │     │   │
│  │  │  change-password │   │  2fa/setup/start  │   │  2fa/disable        │   │  POST /users  │     │   │
│  │  │                  │   │  (returns QR URL) │   │  (needs pwd + code) │   │  /{id}/       │     │   │
│  │  │  submitPwd()     │   │  verify2FASetup() │   │  regenerateCodes()  │   │  security/    │     │   │
│  │  │  ────────────────│   │  ──────────────   │   │  ────────────────   │   │  reset-pwd    │     │   │
│  │  │  POST /auth/     │   │  POST /auth/      │   │  POST /auth/        │   │              │     │   │
│  │  │  2fa/setup/verify│   │  2fa/backup-codes │   │  2fa/backup-codes   │   │              │     │   │
│  │  │  (enter code)    │   │  /regenerate      │   │  /regenerate        │   │              │     │   │
│  │  └─────────────────┘   └───────────────────┘   └──────────────────────┘   └──────────────┘     │   │
│  └──────────────────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                                      │
│  ┌────────────────────────────────────────────┐                                                    │
│  │  securityApi.js                             │                                                    │
│  │  ──────────────                             │                                                    │
│  │  changeOwnPassword({current, new, confirm})─│───────────▶  apiClient.js                         │
│  │  start2FASetup()                           │            ──────────────                           │
│  │  verify2FASetup(code)                      │            fetch() + Bearer JWT                    │
│  │  regenerate2FABackupCodes()                 │                                                    │
│  │  disableOwn2FA(pwd, code)                   │            CONVERSION:                             │
│  │  adminResetUserPassword(id, payload)        │            currentPassword ↔ current_password       │
│  │                                              │            newPassword ↔ new_password              │
│  │  All → apiPost(endpoint, body)               │            confirmPassword ↔ confirm_password      │
│  └────────────────────────────────────────────┘            └─────────────────┬───────────────────────┘
└──────────────────────────────────────────────────────────────────────────────┼───────────────────────┘
                                                                               │
                                                                               ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                              BACKEND LAYER (FastAPI) — Router: auth.py (prefix: /auth)               │
│                                                                                                      │
│  ┌──────────────────────────────────────────────────────────────────────────────────────────────┐   │
│  │  Security Endpoints (all in auth.py)                                                          │   │
│  │                                                                                                │   │
│  │  POST /auth/change-password                                                                   │   │
│  │    ├─ Schema: ChangePasswordRequest(current, new, confirm) — new_password min 12 chars         │   │
│  │    ├─ Permission: require_user_permission('Manage Own Security Settings')                      │   │
│  │    ├─ Validate: new == confirm, password policy, current password matches                      │   │
│  │    ├─ Security: hash_password(new), force_password_change='No', reset failed_login_count       │   │
│  │    ├─ Audit: create_audit_log('User Security', 'Change Own Password')                          │   │
│  │    └─ Return: { message: 'Password changed successfully' }                                    │   │
│  │                                                                                                │   │
│  │  POST /auth/2fa/setup/start — BEGIN 2FA setup                                                 │   │
│  │    ├─ Permission: require_user_permission('Manage Own Security Settings')                      │   │
│  │    ├─ Generate: pyotp.random_base32() → encrypt and store in totp_secret_encrypted             │   │
│  │    ├─ Build: provisioning URI → QR code data URL (for authenticator app scan)                 │   │
│  │    └─ Return: { qr_code_data_url, message }                                                    │   │
│  │                                                                                                │   │
│  │  POST /auth/2fa/setup/verify — CONFIRM 2FA setup                                              │   │
│  │    ├─ Schema: TwoFASetupVerifyRequest { code: str }                                           │   │
│  │    ├─ Permission: require_user_permission('Manage Own Security Settings')                      │   │
│  │    ├─ Decrypt totp_secret, verify code via pyotp.TOTP(secret).verify()                         │   │
│  │    ├─ Generate backup codes, hash them, store in backup_codes_hash_json                        │   │
│  │    ├─ Set: totp_enabled='Yes', totp_confirmed_at=now                                          │   │
│  │    ├─ Audit: create_audit_log('User Security', 'Enable 2FA')                                  │   │
│  │    └─ Return: { message, backup_codes[] }  (show codes ONCE to user)                          │   │
│  │                                                                                                │   │
│  │  POST /auth/2fa/disable — DISABLE 2FA                                                         │   │
│  │    ├─ Schema: TwoFADisableRequest { current_password, code }                                   │   │
│  │    ├─ Check: force_2fa != 'Yes'  (can't disable if mandatory)                                │   │
│  │    ├─ Verify: current password + TOTP/backup code                                             │   │
│  │    ├─ Clear: totp_secret=null, backup_codes=null, totp_enabled='No'                           │   │
│  │    └─ Audit + Return success                                                                  │   │
│  │                                                                                                │   │
│  │  POST /auth/2fa/backup-codes/regenerate — REGENERATE backup codes                             │   │
│  │    ├─ Permission: require_user_permission('Manage Own Security Settings')                      │   │
│  │    ├─ Check: totp_enabled == 'Yes'                                                            │   │
│  │    ├─ Generate new codes, hash them, store                                                    │   │
│  │    └─ Return: { backup_codes[] }                                                              │   │
│  │                                                                                                │   │
│  │  POST /users/{user_id}/security/reset-password — ADMIN RESET (admin function)                  │   │
│  │    ├─ Schema: AdminResetPasswordRequest(new_password, force_change, reset_2fa, remarks)        │   │
│  │    ├─ Permission: require_user_permission('Reset User Password')                              │   │
│  │    ├─ If reset_2fa: require_user_permission('Reset User 2FA') as well                         │   │
│  │    ├─ Hash new password, set force_password_change='Yes', clear locks                          │   │
│  │    ├─ If reset_2fa: clear totp fields                                                          │   │
│  │    ├─ Close any pending PasswordResetRequest tasks                                            │   │
│  │    └─ Audit + Return                                                                           │   │
│  └──────────────────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                                      │
│  ├─ Utils: security.py (hash/verify password, encrypt/decrypt), totp.py (QR, verify, generate codes) │
│  │         jwt.py (token creation), password_policy.py (strength validation)                         │   │
│  └─ Audit: module_name = 'User Security', services/audit_service.py                                  │
└──────────────────────────────────────┬──────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                              DATA LAYER (SQLAlchemy + PostgreSQL)                                     │
│                                                                                                      │
│  ┌──────────────────────────────────────────────────────────────────────────────────────────────┐   │
│  │  User (users table) — Security-Related Columns                                                  │   │
│  │  ────────────────────────────────────                                                            │   │
│  │  COLUMN                  │ TYPE      │ PURPOSE                         │ MODIFIED BY              │   │
│  │──────────────────────────┼───────────┼─────────────────────────────────┼─────────────────────────│   │
│  │ password_hash            │ Text      │ bcrypt hash of password         │ change-password          │   │
│  │ password_changed_at      │ DateTime  │ Timestamp of last change        │ change-password          │   │
│  │ force_password_change    │ String(20)│ 'Yes' = must change on login    │ admin-reset              │   │
│  │ password_never_expires   │ String(20)│ 'Yes' = bypass expiry           │ admin edit               │   │
│  │ password_expiry_days     │ Integer   │ Days until password expires     │ admin edit               │   │
│  │ totp_enabled             │ String(20)│ 'Yes'/'No' — 2FA status        │ setup/verify/disable      │   │
│  │ totp_secret_encrypted    │ Text      │ Encrypted TOTP secret (AES)     │ setup/start, disable      │   │
│  │ totp_confirmed_at        │ DateTime  │ When 2FA was verified           │ setup/verify              │   │
│  │ backup_codes_hash_json   │ JSONB     │ Hashed backup codes (SHA256)    │ setup/verify, regenerate  │   │
│  │ force_2fa                │ String(20)│ 'Yes' = 2FA mandatory           │ admin edit               │   │
│  │ failed_login_count       │ Integer   │ Failed attempts counter         │ login (auto)              │   │
│  │ locked_until             │ DateTime  │ Temporary lock timestamp        │ login (auto)              │   │
│  │ last_login_at            │ DateTime  │ Last successful login           │ login (auto)              │   │
│  │ last_login_ip            │ String(80)│ Client IP at login              │ login (auto)              │   │
│  └──────────────────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                                      │
│  2FA Flow Data:                                                                                      │
│    authenticator app ←── scans QR code (provisioning URI with secret)                                │
│    user enters 6-digit TOTP code ←── app generates from secret + time                                │
│    server verifies: pyotp.TOTP(decrypted_secret).verify(code)                                       │
│    backup codes: 8 random codes, stored as SHA256 hashes, each usable once                           │
│                                                                                                      │
│  DB: PostgreSQL → Table: users (25 security/password columns total)                                  │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
```
