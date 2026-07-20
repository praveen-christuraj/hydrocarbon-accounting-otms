# LoginPage

## Purpose
The login page is the entry point to the Hydrocarbon Accounting System. It provides username/password authentication with optional TOTP 2FA verification and a self-service password reset request flow.

## File Locations
- **Frontend:** `frontend/src/pages/LoginPage.jsx`
- **API Module:** `frontend/src/api/authApi.js`
- **Backend Router:** `backend/app/routers/auth.py` (prefix: `/auth`)
- **Models:** `User` (`backend/app/models.py` line 8), `AuthLoginChallenge` (line 37)

## Key Functions

### `handleSubmit()` — Primary Login
- Calls `loginUser(username, password)` → `POST /auth/login`
- If response has `requires_2fa === true`, shows 2FA challenge form
- Otherwise calls `onLogin(loggedInUser)` to set app state

### `handleVerify2FA()` — 2FA Verification
- Calls `verifyLogin2FA(challengeId, code)` → `POST /auth/2fa/verify`
- Code can be 6-digit TOTP or backup code
- On success, saves JWT token and calls `onLogin()`

### `handlePasswordResetRequest()` — Password Reset
- Calls `requestPasswordReset(username, reason, reset2FA)` → `POST /auth/forgot-password`
- Creates a `PasswordResetRequest` record (marked as a task)
- Admin processes it via the Operation Task Manager page

## API Endpoints Used

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/auth/login` | Authenticate with username/password |
| `POST` | `/auth/2fa/verify` | Verify TOTP challenge code |
| `POST` | `/auth/forgot-password` | Request password reset |

## State Management
| State | Purpose |
|-------|---------|
| `username` / `password` | Login form fields |
| `twoFACode` | 2FA verification code |
| `challenge` | 2FA challenge object from backend |
| `resetUsername` / `resetReason` / `reset2FA` | Password reset form |
| `showReset` | Toggle password reset form visibility |
| `loading` | Disables buttons during API calls |

## Key User Flows
1. **Standard Login:** Enter username + password → click Login
2. **2FA Login:** Enter credentials → enter 6-digit code or backup code → click Verify
3. **Password Reset:** Click "Need Password Reset?" → enter username/reason → submit → admin processes in Task Manager

## Backend Response Format (Login Success)
```json
{
  "access_token": "jwt_token_string",
  "token_type": "bearer",
  "user": {
    "id": 1, "full_name": "Admin", "username": "admin",
    "email": "admin@example.com", "status": "Active",
    "role": { "id": 1, "role_name": "Admin", "status": "Active" },
    "permissions": [{ "id": 1, "permission_name": "View User", "module_name": "User Master", "status": "Active" }]
  }
}
```

## Backend Response Format (2FA Required)
```json
{
  "requires_2fa": true,
  "challenge_id": "uuid",
  "user_hint": { "full_name": "Admin User", "username": "admin" }
}
```

## Connections
- Receives `onLogin` callback from `App.jsx`
- On success, entire user object is stored in app state
- Token is saved to `localStorage` for subsequent API calls via `apiClient.js`
