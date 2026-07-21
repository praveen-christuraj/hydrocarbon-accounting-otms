# Architecture: The User Data Flow — Backbone of the Hydrocarbon Accounting System

## Overview

The **User** entity is the single most connected node in this system — **292 edges** in the knowledge graph, spanning **22+ distinct communities**. It is not merely an authentication record; it is the cross-cutting identity that connects every feature, every permission check, every audit trail entry, and every transactional record.

This document traces the User through every layer: how it's created, how it authenticates, and how its identity flows into every domain.

---

## 1. How the User Entity Is Created

### Frontend: UserMaster Page
- **File:** `frontend/src/pages/UserMaster.jsx`
- **API Module:** `frontend/src/api/userApi.js`
- **Endpoint:** `POST /users`

**Data Flow:**
```
UserMaster.jsx → createUser(user) → apiPost('/users', payload) → Backend
```

**Request Payload (userApi.js `convertUserToApi`):**
```json
{
  "full_name": "string",
  "username": "string",
  "email": "string",
  "phone": "string|null",
  "department": "string|null",
  "designation": "string|null",
  "password": "string",
  "status": "Active|Inactive|Blocked"
}
```

**Validation (frontend side):**
- Full Name, Username, Email required
- Password required for new users
- Username uniqueness checked against loaded user list
- Permission check: `Manage User` required to create/edit/delete

### Backend: Users Router
- **File:** `backend/app/routers/users.py`
- **Prefix:** `/users`
- **Models:** `User` (`backend/app/models.py`, line 8)

**CRUD Endpoints:**
| Method | Endpoint | Handler Action |
|--------|----------|----------------|
| `GET` | `/users` | List all users |
| `POST` | `/users` | Create user (password hashed via passlib bcrypt) |
| `PUT` | `/users/{id}` | Update user |
| `DELETE` | `/users/{id}` | Delete user |

**Database Model (`backend/app/models.py` line 8-35):**
```python
class User(Base):
    __tablename__ = "users"
    columns: id, full_name, username, email, phone, department, designation,
             password_hash, password_changed_at, force_password_change,
             password_never_expires, password_expiry_days, failed_login_count,
             locked_until, last_login_at, last_login_ip, totp_enabled,
             totp_secret_encrypted, totp_confirmed_at, force_2fa,
             backup_codes_hash_json, status, created_at, updated_at
```

---

## 2. How the User Authenticates

### Frontend: LoginPage
- **File:** `frontend/src/pages/LoginPage.jsx`
- **API Module:** `frontend/src/api/authApi.js`
- **Endpoints:** `POST /auth/login`, `POST /auth/2fa/verify`

**Login Flow:**
```
1. User enters username + password
2. POST /auth/login with { username, password }
3. If requires_2fa → show 2FA code input
4. POST /auth/2fa/verify with { challenge_id, code }
5. On success → save access_token to localStorage → call onLogin(user)
```

**Backend: Auth Router (`backend/app/routers/auth.py`)**
| Endpoint | Purpose |
|----------|---------|
| `POST /auth/login` | Verify credentials, create JWT or 2FA challenge |
| `POST /auth/2fa/verify` | Verify TOTP code, issue JWT |
| `POST /auth/forgot-password` | Create password reset request |
| `GET /auth/me` | Get current user from token |
| `POST /auth/change-password` | Change own password |
| `POST /auth/2fa/setup/start` | Begin TOTP setup (returns QR code) |
| `POST /auth/2fa/setup/verify` | Verify and confirm TOTP setup |
| `POST /auth/2fa/backup-codes/regenerate` | Regenerate backup codes |
| `POST /auth/2fa/disable` | Disable 2FA |

**Login Response (after successful auth):**
```json
{
  "access_token": "jwt_token_string",
  "token_type": "bearer",
  "user": {
    "id": 1,
    "full_name": "Admin User",
    "username": "admin",
    "email": "admin@example.com",
    "status": "Active",
    "role": { "id": 1, "role_name": "Admin", "description": "...", "status": "Active" },
    "permissions": [
      { "id": 1, "permission_name": "View User", "module_name": "User Master", "status": "Active" }
    ]
  }
}
```

**2FA Challenge Response:**
```json
{
  "requires_2fa": true,
  "challenge_id": "uuid-string",
  "user_hint": { "full_name": "Admin User", "username": "admin" }
}
```

---

## 3. How User Identity Flows Into Every Domain

### 3.1 — Permission Checks (RBAC)
- **File:** `backend/app/dependencies/permissions.py`
- **Key Function:** `require_user_permission()` — **237 edges**
- Every protected endpoint calls this dependency.
- The current user is extracted from the JWT → their role is looked up → their permissions are checked against the required permission for the endpoint.

### 3.2 — Audit Logging
- **File:** `backend/app/services/audit_service.py`
- **Key Function:** `create_audit_log()` — **150 edges**
- Every mutation (create/update/delete) across ALL routers calls this.
- Records: `performed_by` (user identity), `module_name`, `action`, `entity_type`, `entity_id`, `old_status`, `new_status`, `remarks`, `request_path`, `details` (JSONB).
- The User is the `performed_by` — making every action traceable.

### 3.3 — Operation Transactions (Core Domain)
- **File:** `backend/app/routers/operation_transactions.py`
- **Key Function:** `update_operation_transaction_status()` — references User
- The User performing the status change is recorded in `OperationTransactionStatusHistory.changed_by`
- The User who created the transaction is the `OperationTransaction.created_by`
- **Flow:**
  ```
  OperationEntry.jsx → operationEntryApi.js → POST /operation-entries → 
  operation_entries.py → create OperationTransaction → 
  User recorded as created_by
  ```

### 3.4 — Tank Stock Ledger
- **File:** `backend/app/routers/tank_stock_ledger.py`
- **Key Function:** `create_tank_stock_ledger_from_approved_transaction()`
- When an operation is approved (by a User), the stock ledger is updated.
- The User who approved is recorded.

### 3.5 — Barge Trip Tracking
- **File:** `backend/app/routers/barge_trip_tracking.py`
- **Key Functions:**
  - `create_trip_comparison()` — references User
  - `create_trip_event()` — references User
  - `ensure_barge_unload_comparison()` — references User
- **Flow:**
  ```
  BargeTracking.jsx → bargeTrackingApi.js → POST /barge-trip/* → 
  User performs seal checks, trip events, comparisons
  ```

### 3.6 — Tanker Tracking
- **File:** `backend/app/routers/tanker_tracking.py`
- **Key Function:** `acknowledge_tanker_receipt()`
- The acknowledging User is recorded.
- **Flow:**
  ```
  TankerTracking.jsx → tankerTrackingApi.js → POST /tanker-tracking/acknowledge → 
  User acknowledged stored in TankerReceiptAcknowledgement
  ```

### 3.7 — Shuttle & FSO Voyages
- **File:** `backend/app/routers/shuttle_fso_voyages.py`
- **Key Function:** `get_shuttle_tracking()` — references User
- User actions on shuttle/FSO operations are logged.

### 3.8 — Backup & Restore
- **File:** `backend/app/routers/backup_restore.py`
- **Key Function:** `execute_backup_restore_request()` — references User
- The User who requested/approved the backup or restore is recorded.

### 3.9 — Operation Tasks (Workflow)
- **File:** `backend/app/routers/operation_tasks.py`
- **Key Functions:**
  - `admin_revoke_approved_transaction_from_task()` — references User
  - `admin_reject_approved_transaction_revoke_request()` — references User
  - `add_operation_task_event()` — references User
- Every task action is attributed to a User.

### 3.10 — Correction Requests
- **File:** `backend/app/routers/correction_requests.py`
- **Key Function:** `create_approved_transaction_correction_request()` — references User
- The requesting User and the reviewing admin User are both tracked.

### 3.11 — System Notifications
- **File:** `backend/app/routers/system_notifications.py`
- `SystemNotification` and `SystemNotificationReceipt` have User FK.
- Notifications target specific Users; receipts track acknowledgment.

### 3.12 — Movement Mappings
- **File:** `backend/app/routers/movement_mappings.py`
- **Key Function:** `add_mapping_items()` — references User
- User performs mapping operations between operation transactions.

### 3.13 — Dashboard Config
- **File:** `backend/app/routers/dashboard.py`
- Users create, publish, and manage dashboard configurations.

---

## 4. The Permission Gate: `require_user_permission()`

This function (237 edges in the graph) is the single most important cross-cutting concern. It is called on nearly every protected endpoint.

**How it works:**
1. Extracts JWT from `Authorization: Bearer <token>` header
2. Decodes token → gets user_id
3. Loads User from database
4. Loads User's Role via `UserRole` table
5. Loads Role's Permissions via `RolePermission` table
6. Checks if the required permission_name exists in the user's permission set
7. If not → raises 403 Forbidden

**Chain:** `apiGet/apiPost` → `require_user_permission()` → `User` → `Role` → `Permission`

This means the User connects to: `Location`, `Asset`, `OperationTransaction`, `OperationType`, `TankOperation`, `VesselOperation`, `BackupJob`, `SystemNotification`, `Trip`, `ShuttleVoyage`, `FSOVoyage`, `MovementMapping` — and every other entity that has a protected endpoint.

---

## 5. Graph Summary: User as the Universal Bridge

| Community | User Connection Path | Entities Connected |
|-----------|---------------------|-------------------|
| Auth & Users | `User` ← `users.py` ← `auth.py` | Passwords, 2FA, JWT |
| Permissions | `User` → `Role` → `Permission` | RBAC throughout system |
| Core Operations | `User` ← `operation_transactions.py` | Tank ops, vessel ops, entries |
| Logistics | `User` ← `barge_trip_tracking.py` `tanker_tracking.py` `shuttle_fso_voyages.py` | Trips, seals, comparisons |
| Stock & Reporting | `User` ← `tank_stock_ledger.py` `reports.py` | Ledger entries, reports |
| Audit | `User` ← `create_audit_log()` | Every mutation everywhere |
| Tasks | `User` ← `operation_tasks.py` | Workflow approvals, rejections |
| Corrections | `User` ← `correction_requests.py` | Transaction corrections |
| Notifications | `User` ← `system_notifications.py` | System alerts |
| Backup | `User` ← `backup_restore.py` | Backup/restore requests |
| Dashboard | `User` ← `dashboard.py` | Configs, publishing |
| Mapping | `User` ← `movement_mappings.py` | Transaction mapping |

The User is not just an authentication artifact — it is the **identity thread** woven through every record, every action, and every permission check in the entire Hydrocarbon Accounting System.

---

## 6. Full-Stack Architectural Diagram — System-Wide View

The following diagram maps the complete technology stack and data flow for the Hydrocarbon Accounting System, showing how every layer connects from the browser to the database.

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                   FRONTEND LAYER  (React SPA)                                        │
│                                                                                                      │
│  ┌────────────────────────────────┐    ┌────────────────────────────┐    ┌─────────────────────────┐  │
│  │   React Page Components        │    │    API Module Files        │    │   apiClient.js           │  │
│  │   ─────────────────────        │    │    ─────────────────       │    │   ──────────────         │  │
│  │   pages/UserMaster.jsx         │───▶│   api/userApi.js           │───▶│   fetch() + JWT          │  │
│  │   pages/LoginPage.jsx          │    │   api/authApi.js           │    │   Bearer Token           │  │
│  │   pages/RoleMaster.jsx         │    │   api/roleApi.js           │    │                         │  │
│  │   pages/LocationMaster.jsx     │    │   api/locationApi.js       │    │   apiGet(endpoint)       │  │
│  │   pages/OperationEntry.jsx     │    │   api/operationEntryApi.js │    │   apiPost(endpoint,{})   │  │
│  │   ... (49 page components)     │    │   ... (46 API modules)     │    │   apiPut/Patch/Delete()  │  │
│  │                                │    │                            │    │                         │  │
│  │   Props: data arrays +         │    │   Converts camelCase JS    │    │   Auto-refresh on 401    │  │
│  │   reload/state setter fns      │    │   ↔ snake_case API JSON    │    │   Handles all HTTP        │  │
│  └────────────────────────────────┘    └────────────────────────────┘    └──────────┬──────────────┘  │
│                                                                                     │                  │
│   ┌──────────────────────────────────────────────────────────────────────────────────┴──────────────┐ │
│   │  App.jsx (Router + State Manager)                                                                 │ │
│   │  ──────────────────────────────────                                                                 │ │
│   │  - BrowserRouter with 40+ Routes wrapped in <PermissionGuard>                                      │ │
│   │  - Centralized useState for: users, roles, permissions, locations, assets,                          │ │
│   │    calibrationTemplates, operationTypes, operationTemplates,                                        │ │
│   │    operationEntries, operationTransactions, ... (18 state arrays)                                   │ │
│   │  - useEffect on loggedInUser loads data based on permissions                                        │ │
│   │  - <NavigationBar> with permission-filtered dropdown menus                                         │ │
│   │  - <PageHelp> component (per-route help modal)                                                     │ │
│   └────────────────────────────────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────┬───────────────────────────────────────────────────┘
                                                       │
                          HTTP REQUEST (JSON via fetch) │  HTTPS in production
                          Authorization: Bearer <JWT>  │  Target: http://127.0.0.1:8000 (dev)
                                                       ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                   BACKEND LAYER  (FastAPI + Python)                                   │
│                                                                                                      │
│  ┌─────────────────────────────────────┐                                                             │
│  │  FastAPI Application (main.py)       │                                                             │
│  │  ──────────────────────────────       │                                                             │
│  │  - Lifespan: auto-create tables       │                                                             │
│  │  - CORS Middleware (allowed_origins)  │                                                             │
│  │  - 35 routers included + registered   │                                                             │
│  │  - /health, /db-test endpoints        │                                                             │
│  └──────────────────┬────────────────────┘                                                             │
│                     │                                                                                  │
│         ┌───────────┴──────────────────────────────────────────────┐                                 │
│         ▼                                                          ▼                                  │
│  ┌─────────────────────────────────┐         ┌─────────────────────────────────────┐                  │
│  │  FastAPI Routers (routers/)      │         │  Middleware / Dependencies           │                  │
│  │  ────────────────────────        │         │  ─────────────────────────           │                  │
│  │  users.py         /users         │────────▶│  permissions.py                      │                  │
│  │  auth.py          /auth          │         │  ───────────────                     │                  │
│  │  roles.py         /roles         │         │  require_user_permission()           │                  │
│  │  locations.py     /locations     │         │  checks: User → Role → Permission    │                  │
│  │  assets.py        /assets        │         │                                      │                  │
│  │  operation_*.py   /operation-*   │         │  get_current_user() from JWT         │                  │
│  │  barge_trip_*.py  /barge-trip    │         │  get_db() dependency injection       │                  │
│  │  tanker_tracking  /tanker-track  │         └─────────────────────────────────────┘                  │
│  │  ... (35 routers)                │                                                                    │
│  │                                  │         ┌─────────────────────────────────────┐                  │
│  │  Each router:                    │         │  Services Layer                     │                  │
│  │  - GET/POST/PUT/DELETE handlers  │────────▶│  ───────────────                     │                  │
│  │  - Pydantic schema validation    │         │  audit_service.py  (create_audit)   │                  │
│  │  - Permission checks via dep     │         │  transaction_helpers.py             │                  │
│  │  - Business logic + DB queries   │         │  material_balance_helpers.py        │                  │
│  └─────────────────────────────────┘         └─────────────────────────────────────┘                  │
│                                                                                                      │
│  ┌────────────────────────────────────────────────────────────────────────────────────────────────┐  │
│  │  Pydantic Schemas (schemas.py - 2617 lines)                                                     │  │
│  │  ─────────────────────────────────────────                                                       │  │
│  │  Validation layer between HTTP request/response and models                                       │  │
│  │  Examples: UserCreate, UserUpdate, UserResponse, RoleCreate, PermissionCreate,                   │  │
│  │            LoginRequest, OperationTransactionCreate, TankStockLedgerResponse, ...                 │  │
│  └────────────────────────────────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────┬───────────────────────────────────────────────────────────────────┘
                                   │
              SQLAlchemy ORM (Session.query / db.execute) │
                                   ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                    DATA LAYER  (SQLAlchemy + PostgreSQL)                             │
│                                                                                                      │
│  ┌────────────────────────────────────────────────────────────────────────────────────────────────┐  │
│  │  SQLAlchemy Models (models.py)                                                                  │  │
│  │  ────────────────────────────                                                                    │  │
│  │  Each model = one database table, defined with Column(), ForeignKey(), UniqueConstraint()        │  │
│  │                                                                                                  │  │
│  │  CORE TABLES:                          TRANSACTION TABLES:        TRACKING TABLES:               │  │
│  │  ┌──────────────┐                     ┌──────────────────────┐  ┌──────────────────────┐        │  │
│  │  │ users        │──┬──▶ user_roles    │ operation_transactions│  │ trips                │        │  │
│  │  │ roles        │──┘   role_permissions│ operation_values     │  │ trip_events          │        │  │
│  │  │ permissions  │                     │ status_history       │  │ trip_comparisons     │        │  │
│  │  ├──────────────┤                     ├──────────────────────┤  ├──────────────────────┤        │  │
│  │  │ locations    │                     │ tank_stock_ledger    │  │ tanker_acknowledge   │        │  │
│  │  │ asset_types  │                     │ vessel_stock_ledger  │  │ shuttle_voyages      │        │  │
│  │  │ assets       │                     │ movement_mappings    │  │ fso_voyages          │        │  │
│  │  │ assignments  │                     │ movement_map_items   │  └──────────────────────┘        │  │
│  │  │ calibrations │                     ├──────────────────────┤                                 │  │
│  │  │ templates    │                     │ correction_requests  │  CONFIG/ADMIN TABLES:            │  │
│  │  │ calibration  │                     │ operation_tasks      │  ┌──────────────────────┐        │  │
│  │  │ _data        │                     │ task_events          │  │ backup_settings      │        │  │
│  │  ├──────────────┤                     └──────────────────────┘  │ backup_jobs          │        │  │
│  │  │ operation    │                                               │ restore_requests     │        │  │
│  │  │ _types       │                                               │ restore_validations  │        │  │
│  │  │ operation    │                                               │ system_notifications │        │  │
│  │  │ _templates   │                                               │ notification_receipts│        │  │
│  │  │ template     │                                               │ audit_logs           │        │  │
│  │  │ _fields      │                                               │ workflow_policies    │        │  │
│  │  │ layouts/secs │                                               │ flowmeter_configs    │        │  │
│  │  │ /items       │                                               │ flowmeter_records    │        │  │
│  │  └──────────────┘                                               └──────────────────────┘        │  │
│  └────────────────────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                                      │
│  ┌────────────────────────────────────────────────────────────────────────────────────────────────┐  │
│  │  Database Configuration (database.py)                                                            │  │
│  │  ──────────────────────────────────────                                                            │  │
│  │  Engine:  create_engine(DATABASE_URL, pool_size=10, max_overflow=20, pool_recycle=1800)            │  │
│  │  Session: SessionLocal = sessionmaker(autocommit=False, autoflush=False)                           │  │
│  │  Base:    Base = declarative_base()   ← All models inherit this                                   │  │
│  │  DB:      PostgreSQL (via psycopg2)                                                                │  │
│  └────────────────────────────────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Legend — Data Flow Direction

```
  Page Component ──▶ API Module ──▶ apiClient.fetch() ──▶ FastAPI Router ──▶ Model ──▶ Database
       │                  │                │                    │               │            │
       │   Props & State  │  JSON payload  │   HTTP Request    │  ORM Query   │  SQL via   │
       │   (React)        │  (camelCase)   │   Bearer JWT      │  + Schema    │  psycopg2  │
       │                  │                │                    │  Validation  │            │
       ◀──────────────────◀────────────────◀────────────────────◀─────────────◀─────────────◀
                                    Response JSON (snake_case → camelCase conversion)
```

### Key Architectural Patterns

| Layer | Pattern | Details |
|-------|---------|---------|
| Frontend | SPA with Centralized State | All data loaded in App.jsx `useEffect` after login, passed as props to pages |
| Frontend | Permission-Gated Routing | Each route is wrapped in `<PermissionGuard>` checking `loggedInUser.permissions` |
| Frontend | Auto-Refresh on 401 | `apiClient.js` silently refreshes JWT via `/auth/refresh` on 401 responses |
| Backend | Dependency Injection | `get_db()` provides SQLAlchemy session per request; `get_current_user()` extracts user from JWT |
| Backend | RBAC via Dependency | `require_user_permission()` is a FastAPI dependency checked before every protected endpoint |
| Backend | Audit Logging | Every mutation calls `create_audit_log()` in `services/audit_service.py` |
| Data | Declarative ORM | All models inherit `Base` from `database.py`; tables auto-created on startup |
| Data | JSONB for Flexibility | `field_value`, `details`, `row_data` columns use PostgreSQL JSONB for dynamic/structured data |
| Cross-Cutting | JWT Auth | Access token (8h) + Refresh token (30d) with automatic rotation on expiry |
| Cross-Cutting | Snake ↔ Camel Case | Backend uses `snake_case` (Python convention); Frontend uses `camelCase` (JS convention); manual conversion in API modules |
