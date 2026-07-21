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

---

## Full-Stack Architecture Diagram — LoginPage

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND LAYER  (React SPA)                                             │
│                                                                                                      │
│  ┌─────────────────────────────────────────┐                                                         │
│  │  LoginPage.jsx                           │                                                         │
│  │  ─────────────                            │                                                         │
│  │  State: username, password, twoFACode,    │                                                         │
│  │         challenge, showReset, loading,    │                                                         │
│  │         error, successMsg                 │                                                         │
│  │                                          │                                                         │
│  │  handleSubmit(e)                         │                                                         │
│  │    ├─ Validates fields                   │                                                         │
│  │    ├─ Calls loginUser(u, p)              │───────────┐                                            │
│  │    ├─ If requires2FA → setChallenge()    │           │                                            │
│  │    └─ Else → onLogin(user)               │           │                                            │
│  │                                          │           │                                            │
│  │  handleVerify2FA(e)                      │           │                                            │
│  │    ├─ Calls verifyLogin2FA(cid, code)    │───────────┤                                            │
│  │    └─ onLogin(user)                      │           │                                            │
│  │                                          │           │                                            │
│  │  handlePasswordResetRequest(e)           │           │                                            │
│  │    └─ Calls requestPasswordReset(u,r,f)  │───────────┤                                            │
│  └─────────────────────────────────────────┘           │                                            │
│                                                         │                                            │
│  ┌─────────────────────────────────────────┐            │                                            │
│  │  authApi.js                              │◀──────────┘                                            │
│  │  ──────────                               │                                                       │
│  │  loginUser(u, p)                         │                                                       │
│  │    ├─ apiPost('/auth/login', {...})      │───────────▶  apiClient.js                              │
│  │    ├─ if requires_2fa → return {2FA}     │            ──────────────                              │
│  │    └─ saveLoginTokens() + convertUser()  │            fetch() + Bearer JWT                       │
│  │                                          │            apiPost(endpoint, body)                     │
│  │  verifyLogin2FA(cid, code)               │            apiGet(endpoint)                            │
│  │    ├─ apiPost('/auth/2fa/verify', {...}) │───────────▶                                            │
│  │    └─ saveLoginTokens() + convertUser()  │            Auto-refresh on 401                         │
│  │                                          │                                                       │
│  │  requestPasswordReset(u, r, f)           │                                                       │
│  │    └─ apiPost('/auth/forgot-password',)  │───────────▶                                            │
│  │                                          │            HTTP Target: http://127.0.0.1:8000          │
│  │  convertLoggedInUserFromApi(data)        │                                                       │
│  │    └─ Maps snake_case API → camelCase    │                                                       │
│  └─────────────────────────────────────────┘            └─────────────────┬──────────────────────────┘
│                                                                          │
│   Token Storage: localStorage ('access_token', 'refresh_token')          │
└──────────────────────────────────────────────────────────────────────────┼──────────────────────────┘
                                                                           │
                                                                           ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                              BACKEND LAYER  (FastAPI)                                                │
│                                                                                                      │
│  ┌──────────────────────────────────────────────────────────────────────────────────────────────┐   │
│  │  Router: auth.py  (prefix: /auth)                                                             │   │
│  │  ──────────────────────                                                                        │   │
│  │                                                                                                │   │
│  │  POST /auth/login                                                                             │   │
│  │    ├─ Validate: LoginRequest (username, password)                                              │   │
│  │    ├─ Check: User exists? (User.username.ilike)                                                │   │
│  │    ├─ Check: User.status == 'Active'?                                                          │   │
│  │    ├─ Check: User.locked_until? → 423 if locked                                                │   │
│  │    ├─ Verify: verify_password() via passlib bcrypt                                             │   │
│  │    │    └─ On fail: failed_login_count++ → lock at 5+ fails                                    │   │
│  │    ├─ Check: totp_enabled == 'Yes'?                                                            │   │
│  │    │    └─ Yes: create_login_challenge() → return requires_2fa                                 │   │
│  │    ├─ Build: build_logged_in_user_response(user, db) → gets role + permissions                  │   │
│  │    ├─ Create JWT: create_access_token({user_id, username})                                     │   │
│  │    ├─ Create Refresh: create_refresh_token({user_id, username})                                │   │
│  │    ├─ Audit: create_audit_log('Login Success')                                                 │   │
│  │    └─ Return: { access_token, refresh_token, user, role, permissions }                         │   │
│  │                                                                                                │   │
│  │  POST /auth/2fa/verify                                                                         │   │
│  │    ├─ Validate: TwoFAVerifyRequest (challenge_id, code)                                        │   │
│  │    ├─ Check: AuthLoginChallenge exists + status='Pending' + not expired                         │   │
│  │    ├─ Verify: verify_totp_or_backup_code(user, code)                                           │   │
│  │    │    └─ Checks TOTP via pyotp OR backup_code hash match                                     │   │
│  │    ├─ Update: challenge.status = 'Verified'                                                     │   │
│  │    ├─ Build + JWT + Audit (same as login)                                                      │   │
│  │    └─ Return: { access_token, refresh_token, user, role, permissions }                         │   │
│  │                                                                                                │   │
│  │  POST /auth/forgot-password                                                                    │   │
│  │    ├─ Rate limit: max 3 requests per IP per 15 min                                             │   │
│  │    ├─ Create: PasswordResetRequest (status='Pending')                                          │   │
│  │    ├─ Create: OperationTask (type='PASSWORD_RESET_REQUEST')                                    │   │
│  │    ├─ Audit: create_audit_log('Request Password Reset')                                        │   │
│  │    └─ Return: generic message (don't reveal if user exists)                                    │   │
│  └──────────────────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                                      │
│  ┌──────────────────────────────────────────┐    ┌──────────────────────────────────────────────┐   │
│  │  Schemas (schemas.py)                     │    │  Dependencies                                │   │
│  │  ──────────────────                       │    │  ─────────────                                │   │
│  │  LoginRequest                             │    │  auth.py: get_current_user_from_token()       │   │
│  │    ├─ username: str                       │    │    └─ Decode JWT → extract user_id            │   │
│  │    └─ password: str                       │    │       → query User from DB                   │   │
│  │                                           │    │                                              │   │
│  │  TwoFAVerifyRequest                       │    │  permissions.py:                              │   │
│  │    ├─ challenge_id: str                   │    │    require_user_permission()                  │   │
│  │    └─ code: str                           │    │    build_logged_in_user_response()            │   │
│  │                                           │    │       └─ User → UserRole → Role               │   │
│  │  ForgotPasswordRequest                    │    │          → RolePermission → Permission        │   │
│  │    ├─ username: str                       │    └──────────────────────────────────────────────┘   │
│  │    ├─ reason: str | None                  │                                                       │
│  │    └─ reset_2fa: bool                     │    ┌──────────────────────────────────────────────┐   │
│  │                                           │    │  Utils                                       │   │
│  │  AdminResetPasswordRequest                │    │  ─────                                       │   │
│  │    ├─ new_password: str (min 12)          │    │  jwt.py: create_access_token(), decode()      │   │
│  │    ├─ force_password_change: bool         │    │  security.py: hash_password(), verify_pass()  │   │
│  │    ├─ reset_2fa: bool                     │    │  totp.py: create_login_challenge(), verify()   │   │
│  │    └─ remarks: str | None                 │    │  password_policy.py: validate_password_policy │   │
│  └──────────────────────────────────────────┘    └──────────────────────────────────────────────┘   │
│                                                                                                      │
│  ┌─────────────────────────────────────────────────────────────────────────┐                        │
│  │  Services                                                               │                        │
│  │  ────────                                                                │                        │
│  │  audit_service.py: create_audit_log(db, module_name='Authentication',   │                        │
│  │                      action='Login Success'/'Login Failed'/'2FA Failed')│                        │
│  └─────────────────────────────────────────────────────────────────────────┘                        │
└──────────────────────────────────────┬──────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                              DATA LAYER  (SQLAlchemy + PostgreSQL)                                    │
│                                                                                                      │
│  ┌──────────────────────────────────────────────────────────────────────────────────────────────┐   │
│  │  Model: User (__tablename__ = "users")                                                        │   │
│  │  ──────────────────────────────                                                                 │   │
│  │  id              │ Integer  │ PK                                                                │   │
│  │  full_name       │ String   │ NOT NULL                                                          │   │
│  │  username        │ String   │ UNIQUE INDEX  ← Queried on login                                  │   │
│  │  email           │ String   │ NOT NULL                                                          │   │
│  │  password_hash   │ Text     │ NOT NULL  ← Stored as bcrypt hash                                  │   │
│  │  status          │ String   │ Default 'Active'  ← Checked on login                               │   │
│  │  failed_login_count │ Int   │ Default 0  ← Incremented on failed login                           │   │
│  │  locked_until    │ DateTime │ NULL  ← Set after 5 failed attempts                                │   │
│  │  last_login_at   │ DateTime │ NULL  ← Set on successful login                                    │   │
│  │  last_login_ip   │ String   │ NULL                                                              │   │
│  │  totp_enabled    │ String   │ Default 'No'  ← Triggers 2FA flow                                  │   │
│  │  totp_secret_encrypted │Text│ NULL  ← Encrypted TOTP secret                                      │   │
│  │  force_password_change  │String│Default 'No'                                                     │   │
│  │  ... (additional security columns)                                                               │   │
│  └──────────────────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                                      │
│  ┌──────────────────────────────────────────────────────────────────────────────────────────────┐   │
│  │  Model: AuthLoginChallenge (__tablename__ = "auth_login_challenges")                           │   │
│  │  ────────────────────────────────────────────                                                   │   │
│  │  id            │ Integer  │ PK                                                                  │   │
│  │  challenge_id  │ String   │ UNIQUE INDEX ← Sent to frontend for 2FA verify                      │   │
│  │  user_id       │ Integer  │ FK → users.id  (CASCADE)                                            │   │
│  │  status        │ String   │ Default 'Pending' → 'Verified' after 2FA                           │   │
│  │  expires_at    │ DateTime │ NOT NULL  ← Checked during verification                              │   │
│  │  ip_address    │ String   │ NULL                                                                 │   │
│  │  created_at    │ DateTime │ server_default=func.now()                                            │   │
│  │  verified_at   │ DateTime │ NULL                                                                 │   │
│  └──────────────────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                                      │
│  ┌──────────────────────────────────────────────────────────────────────────────────────────────┐   │
│  │  Model: PasswordResetRequest (__tablename__ = "password_reset_requests")                       │   │
│  │  ────────────────────────────────────────────────                                               │   │
│  │  id            │ Integer  │ PK                                                                  │   │
│  │  request_number│ String   │ UNIQUE INDEX  ← Format: PWR-YYYYMMDD-NNNN                           │   │
│  │  user_id       │ Integer  │ FK → users.id  (CASCADE)                                            │   │
│  │  username      │ String   │ INDEX                                                                │   │
│  │  status        │ String   │ Default 'Pending' → 'Completed'                                     │   │
│  │  reason        │ Text     │ NULL                                                                 │   │
│  │  reset_2fa     │ String   │ Default 'No'                                                         │   │
│  │  task_id       │ Integer  │ FK → operation_tasks.id  (NULLABLE)                                  │   │
│  │  requested_by_ip │ String │ NULL                                                                 │   │
│  │  ... (acted_by, acted_at, action_notes)                                                          │   │
│  └──────────────────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                                      │
│  ┌──────────────────────────────────────────────────────────────────────────────────────────────┐   │
│  │  Additional Model: TokenBlacklist (__tablename__ = "token_blacklist")                          │   │
│  │  ────────────────────────────────────────────                                                   │   │
│  │  id            │ Integer  │ PK                                                                  │   │
│  │  token_hash    │ String   │ UNIQUE INDEX ← SHA256 hash of JWT                                   │   │
│  │  expires_at    │ DateTime │ NOT NULL  ← Original JWT expiry                                      │   │
│  │  blacklisted_at│ DateTime │ server_default=func.now()                                            │   │
│  └──────────────────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                                      │
│  Database: PostgreSQL via SQLAlchemy (engine = create_engine(DATABASE_URL))                           │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Login Data Flow Sequence

```
Step 1: User enters credentials
────────
LoginPage.jsx                        authApi.js                    apiClient.js
    │                                    │                              │
    │── handleSubmit(e) ────────────────▶│                              │
    │   setLoading(true)                 │                              │
    │                                    │── apiPost('/auth/login',    │
    │                                    │     {username, password}) ──▶│── fetch() ──────────────────▶
    │                                    │                              │                              │
    │◀── If requires2FA ────────────────│                              │                              │
    │    setChallenge(data)              │                              │                              │
    │                                    │                              │                              │
    │── 2FA form shown ─────────────────│                              │                              │
    │   handleVerify2FA(e) ────────────▶│                              │                              │
    │                                    │── apiPost('/auth/2fa/verify',│                              │
    │                                    │     {challenge_id, code}) ──▶│── fetch() ──────────────────▶
    │◀── onLogin(user) ◀───────────────│                              │                              │
    │   save token to localStorage      │                              │                              │
    │   App.jsx receives loggedInUser   │                              │                              │
    │   → loads data via useEffect      │                              │                              │


Step 2: Backend processes
────────
auth.py (FastAPI Router)                   schemas.py            dependencies/permissions.py
    │                                           │                        │
    │◀── POST /auth/login                       │                        │
    │   │                                       │                        │
    │   ├─ Validate LoginRequest ──────────────▶│                        │
    │   ├─ Query: User.username = input         │                        │
    │   ├─ Check: status == 'Active'            │                        │
    │   ├─ Verify: password_hash → bcrypt       │                        │
    │   │    └─ On fail: increment              │                        │
    │   │      failed_login_count               │                        │
    │   ├─ Check: totp_enabled == 'Yes'?        │                        │
    │   │    └─ Yes: create_login_challenge() ──▶── models.py            │
    │   │         return requires_2fa            │    AuthLoginChallenge  │
    │   │                                        │                        │
    │   ├─ build_logged_in_user_response() ──────┼──────────────────────▶│
    │   │                                        │    User → UserRole     │
    │   │                                        │    → Role → RolePerm   │
    │   │                                        │    → Permission set    │
    │   ├─ create_access_token() ────────────────┼── jwt.py              │
    │   ├─ create_refresh_token()                │                        │
    │   ├─ create_audit_log('Login Success') ────┼── audit_service.py    │
    │   └─ Return JSON ─────────────────────────▶│                        │


Step 3: Data layer
────────
models.py                            database.py                   PostgreSQL
    │                                    │                            │
    │── User (users table) ──────────────│── Base.metadata            │
    │   .username.ilike()                │    .create_all()           │
    │   .password_hash                   │                            │
    │   .status, .locked_until           │── engine.execute() ───────▶│
    │                                    │                            │
    │── AuthLoginChallenge               │── get_db() provides        │
    │   .challenge_id                    │    Session for each req    │
    │   .expires_at                      │                            │
    │                                    │── Pool: pool_size=10       │
    │── PasswordResetRequest             │    max_overflow=20         │
    │   .request_number                  │    pool_recycle=1800       │
    │   .user_id → users.id              │                            │
    └────────────────────────────────────┴────────────────────────────┘
```
