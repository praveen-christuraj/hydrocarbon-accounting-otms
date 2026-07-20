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
