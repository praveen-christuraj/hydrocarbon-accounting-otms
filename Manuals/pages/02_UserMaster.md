# UserMaster

## Purpose
Create, update, and manage application users. This is where user accounts are provisioned with their basic identity information and login credentials.

## File Locations
- **Frontend:** `frontend/src/pages/UserMaster.jsx`
- **API Module:** `frontend/src/api/userApi.js`
- **Backend Router:** `backend/app/routers/users.py` (prefix: `/users`)
- **Model:** `User` (`backend/app/models.py` line 8)

## Key Functions

### `reloadUsers()` — Load user list
- Calls `getUsers()` → `GET /users`
- Response: array of user objects
- Called on mount via `useEffect`

### `handleSubmit()` — Create or Update User
- For new users: `createUser(user)` → `POST /users`
- For edits: `updateUser(userId, user)` → `PUT /users/{userId}`
- Requires `Manage User` permission

### `handleEdit(user)` — Populate form for editing
- Sets form fields from selected user
- Username is disabled during edit (cannot change)

### `handleDelete(userId)` — Delete a user
- Calls `deleteUser(userId)` → `DELETE /users/{userId}`
- Confirmation dialog before deletion

## API Endpoints
| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/users` | List all users |
| `POST` | `/users` | Create new user |
| `PUT` | `/users/{id}` | Update existing user |
| `DELETE` | `/users/{id}` | Delete user |

## API Request Format (Create/Update)
```json
{
  "full_name": "John Doe",
  "username": "johndoe",
  "email": "john@example.com",
  "phone": "1234567890",
  "department": "Operations",
  "designation": "Operator",
  "password": "securepassword",
  "status": "Active"
}
```

## API Response Format (List)
```json
{
  "items": [
    {
      "id": 1,
      "full_name": "John Doe",
      "username": "johndoe",
      "email": "john@example.com",
      "phone": "1234567890",
      "department": "Operations",
      "designation": "Operator",
      "status": "Active",
      "created_at": "2024-01-01T00:00:00",
      "updated_at": "2024-01-01T00:00:00"
    }
  ]
}
```

## State Management
| State | Purpose |
|-------|---------|
| `users` | Array of all users from API |
| `user` | Current form fields (fullName, username, email, phone, department, designation, password, status) |
| `editId` | ID of user being edited (null for new) |
| `loading` | Loading state during API calls |

## Permission Requirements
- **View:** View User permission required to see the table
- **Manage:** Manage User permission required for create, edit, delete
- The `admin` bootstrap user bypasses permission checks

## Validation
- Full Name, Username, Email required
- Password required for new users
- Username must be unique (checked client-side against loaded users)
- Username disabled during edit (cannot be changed)

## Dependencies
- **App.jsx** passes `loggedInUser` for permission checking
- Uses `apiGet`, `apiPost`, `apiPut`, `apiDelete` from `apiClient.js`
- Token-based auth via `Authorization: Bearer` header added by apiClient

## User Lifecycle
1. Admin creates user via UserMaster → `password_hash` stored in DB
2. User logs in via LoginPage → JWT issued
3. User assigned to Role via UserRoleAssignment
4. User's permissions derive from Role via RolePermissionAssignment
5. User can change own password via ProfileSecurity
6. Admin can reset user password from ProfileSecurity
7. User can be set to Inactive/Blocked to disable login

---

## Full-Stack Architecture Diagram — UserMaster

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND LAYER  (React SPA)                                             │
│                                                                                                      │
│  ┌─────────────────────────────────────────┐                                                         │
│  │  UserMaster.jsx                          │                                                         │
│  │  ───────────────                         │                                                         │
│  │  Props (from App.jsx):                   │                                                         │
│  │    ├─ users (array)                      │                                                         │
│  │    ├─ reloadUsers (fn)                   │                                                         │
│  │    └─ loggedInUser (object)              │                                                         │
│  │                                          │                                                         │
│  │  State: user form fields, editId,        │                                                         │
│  │         loading, search                   │                                                         │
│  │                                          │                                                         │
│  │  handleSubmit()                          │                                                         │
│  │    ├─ If editId: updateUser(id, data) ───┤───────────┐                                            │
│  │    └─ Else: createUser(data) ────────────┤───────────┤                                            │
│  │                                          │           │                                            │
│  │  handleDelete(userId)                    │           │                                            │
│  │    └─ confirm() → deleteUser(id) ────────┤───────────┤                                            │
│  │                                          │           │                                            │
│  │  reloadUsers() on mount                   │           │                                            │
│  │    └─ getUsers() ────────────────────────┤───────────┤                                            │
│  └─────────────────────────────────────────┘           │                                            │
│                                                         │                                            │
│  ┌─────────────────────────────────────────┐            │                                            │
│  │  userApi.js                              │◀──────────┘                                            │
│  │  ──────────                               │                                                       │
│  │  getUsers(params)                        │                                                       │
│  │    ├─ apiGet('/users?skip=0&limit=50')  │───────────▶  apiClient.js                              │
│  │    └─ convertUserFromApi(items)          │            ──────────────                              │
│  │                                          │            fetch() + Bearer JWT                        │
│  │  createUser(user)                        │                                                       │
│  │    ├─ convertUserToApi(frontend→backend) │───────────▶  apiPost('/users', body)                  │
│  │    └─ convertUserFromApi(response)       │                                                       │
│  │                                          │                                                       │
│  │  updateUser(id, user)                    │                                                       │
│  │    ├─ convertUserToApi(data)             │───────────▶  apiPut('/users/{id}', body)              │
│  │    └─ convertUserFromApi(response)       │                                                       │
│  │                                          │                                                       │
│  │  deleteUser(id)                          │                                                       │
│  │    └─ apiDelete('/users/{id}') ──────────│───────────▶  apiDelete(endpoint)                      │
│  │                                          │                                                       │
│  │  CONVERSION:                             │                                                       │
│  │    JS camelCase      → API snake_case    │                                                       │
│  │    fullName          → full_name          │                                                       │
│  │    createdAt         → created_at         │                                                       │
│  └─────────────────────────────────────────┘            └─────────────────┬──────────────────────────┘
│                                                                          │
│   Props Flow: App.jsx passes users[] + reloadUsers() to UserMaster       │
│   Data loaded on login: if hasPermission('View User') → reloadUsers()    │
└──────────────────────────────────────────────────────────────────────────┼──────────────────────────┘
                                                                           │
                                                                           ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                              BACKEND LAYER  (FastAPI)                                                │
│                                                                                                      │
│  ┌──────────────────────────────────────────────────────────────────────────────────────────────┐   │
│  │  Router: users.py  (prefix: /users)                                                          │   │
│  │  ──────────────────────                                                                       │   │
│  │                                                                                               │   │
│  │  GET /users?skip=0&limit=50&search=                                                          │   │
│  │    ├─ Dependency: get_current_user_from_token → JWT decode → User query                       │   │
│  │    ├─ Permission: require_user_permission('View User')                                        │   │
│  │    ├─ Query: db.query(User).order_by(User.id)                                                 │   │
│  │    ├─ Optional filter: or_(full_name.ilike, username.ilike, email.ilike)                       │   │
│  │    ├─ Paginate: paginate_query(query, skip, limit)                                            │   │
│  │    └─ Return: { items: [UserResponse], total, skip, limit, has_more }                         │   │
│  │                                                                                               │   │
│  │  POST /users                                                                                  │   │
│  │    ├─ Schema: UserCreate (full_name, username, email, password, ...)                          │   │
│  │    ├─ Permission: require_user_permission('Manage User')                                      │   │
│  │    ├─ Validate: username uniqueness check (User.username.ilike)                               │   │
│  │    ├─ Validate: password not empty                                                            │   │
│  │    ├─ Create: User(..., password_hash=hash_password(pwd), force_password_change='Yes')        │   │
│  │    ├─ Audit: create_audit_log('User Master', 'Create User', details={after})                  │   │
│  │    └─ Return: UserResponse (id, full_name, username, email, ...)                              │   │
│  │                                                                                               │   │
│  │  PUT /users/{user_id}                                                                         │   │
│  │    ├─ Schema: UserUpdate (same fields, password optional)                                     │   │
│  │    ├─ Permission: require_user_permission('Manage User')                                      │   │
│  │    ├─ Check: User exists? 404 if not                                                          │   │
│  │    ├─ Check: username uniqueness (excluding self)                                             │   │
│  │    ├─ Capture before_data for audit                                                           │   │
│  │    ├─ Update fields + optional password rehash                                                │   │
│  │    ├─ Audit: create_audit_log('User Master', 'Update User', {before, after})                  │   │
│  │    └─ Return: UserResponse (updated)                                                          │   │
│  │                                                                                               │   │
│  │  DELETE /users/{user_id}                                                                      │   │
│  │    ├─ Permission: require_user_permission('Manage User')                                      │   │
│  │    ├─ Check: User exists? 404 if not                                                          │   │
│  │    ├─ Check: Not deleting self                                                                │   │
│  │    ├─ Check: No UserRole assignments exist → block if present                                 │   │
│  │    ├─ Audit: create_audit_log('User Master', 'Delete User', {deleted})                        │   │
│  │    └─ Return: { message: 'User deleted successfully' }                                       │   │
│  └──────────────────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                                      │
│  ┌──────────────────────────────────────────┐    ┌──────────────────────────────────────────────┐   │
│  │  Schemas (schemas.py)                     │    │  Dependencies                                │   │
│  │  ──────────────────                       │    │  ─────────────                                │   │
│  │  UserBase:                                 │    │  auth.py: get_current_user_from_token()       │   │
│  │    full_name: str                          │    │  permissions.py:                              │   │
│  │    username: str                           │    │    require_user_permission(perm_name)          │   │
│  │    email: EmailStr                         │    │                                              │   │
│  │    phone: Optional[str]                    │    │  Utils:                                       │   │
│  │    department: Optional[str]               │    │    security.py: hash_password() (bcrypt)      │   │
│  │    designation: Optional[str]              │    │    pagination.py: paginate_query()            │   │
│  │    status: str = 'Active'                  │    └──────────────────────────────────────────────┘   │
│  │                                           │                                                       │
│  │  UserCreate(UserBase):  + password         │    ┌──────────────────────────────────────────────┐   │
│  │  UserUpdate(UserBase):  + password opt     │    │  Services                                    │   │
│  │  UserResponse(UserBase): + id + timestamps │    │  audit_service.py: create_audit_log()         │   │
│  └──────────────────────────────────────────┘    │    module_name = 'User Master'                  │   │
│                                                   │    actions: Create/Update/Delete User          │   │
│                                                   └──────────────────────────────────────────────┘   │
└──────────────────────────────────────┬──────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                              DATA LAYER  (SQLAlchemy + PostgreSQL)                                    │
│                                                                                                      │
│  ┌──────────────────────────────────────────────────────────────────────────────────────────────┐   │
│  │  Model: User (__tablename__ = "users")                                                        │   │
│  │  ──────────────────────────────                                                                 │   │
│  │  COLUMN              │ TYPE      │ CONSTRAINTS          │ NOTES                                │   │
│  │──────────────────────┼───────────┼──────────────────────┼──────────────────────────────────────│   │
│  │ id                   │ Integer   │ PK, INDEX            │ Auto-increment                        │   │
│  │ full_name            │ String(150)│ NOT NULL             │ User's full name                      │   │
│  │ username             │ String(80) │ UNIQUE, NOT NULL, IX │ Login identifier, used in auth        │   │
│  │ email                │ String(150)│ NOT NULL             │ Contact email                         │   │
│  │ phone                │ String(50) │ NULLABLE             │ Optional contact                      │   │
│  │ department           │ String(100)│ NULLABLE             │ e.g. Operations, Admin                │   │
│  │ designation          │ String(100)│ NULLABLE             │ e.g. Operator, Manager                │   │
│  │ password_hash        │ Text      │ NOT NULL             │ bcrypt hash via passlib                │   │
│  │ password_changed_at  │ DateTime  │ NULLABLE             │ Track last password change             │   │
│  │ force_password_change│ String(20)│ NOT NULL, def='No'   │ Force user to change on next login     │   │
│  │ password_never_expires│ String(20)│ NOT NULL, def='No'  │ Bypass expiry policy                   │   │
│  │ password_expiry_days │ Integer   │ NOT NULL, def=30     │ Days until password expires            │   │
│  │ failed_login_count   │ Integer   │ NOT NULL, def=0      │ Incremented on failed auth             │   │
│  │ locked_until         │ DateTime  │ NULLABLE             │ Set after 5 failed attempts            │   │
│  │ last_login_at        │ DateTime  │ NULLABLE             │ Set on successful login                │   │
│  │ last_login_ip        │ String(80)│ NULLABLE             │ Client IP on last login                │   │
│  │ totp_enabled         │ String(20)│ NOT NULL, def='No'   │ 2FA status                             │   │
│  │ totp_secret_encrypted│ Text      │ NULLABLE             │ Encrypted TOTP secret                  │   │
│  │ totp_confirmed_at    │ DateTime  │ NULLABLE             │ When 2FA was confirmed                 │   │
│  │ force_2fa            │ String(20)│ NOT NULL, def='No'   │ Mandatory 2FA for this user            │   │
│  │ backup_codes_hash_json│ JSONB    │ NULLABLE             │ Hashed backup codes for 2FA recovery   │   │
│  │ status               │ String(20)│ NOT NULL, def='Active'│ Active / Inactive / Blocked            │   │
│  │ created_at           │ DateTime  │ server_default=now()  │ Auto-set on create                     │   │
│  │ updated_at           │ DateTime  │ server_default=now()  │ Auto-updated on change                 │   │
│  └──────────────────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                                      │
│  Related Tables: User references                                                                     │
│    UserRole ─── user_id → users.id (CASCADE)    ─── One user = ONE role                               │
│    AssetAssignment ─── assigned_to → users.full_name   (by name string)                               │
│    OperationTransaction ─── created_by → users.username (by username string)                           │
│    AuditLog ─── performed_by → users.full_name                                                        │
│                                                                                                      │
│  DB: PostgreSQL → Table: users                                                                       │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### UserMaster — CRUD Data Flow Sequence

```
CREATE FLOW:
UserMaster.jsx        userApi.js              apiClient.js       users.py (router)       DB: users
    │                     │                       │                     │                     │
    │── handleSubmit() ──▶│── convertUserToApi()  │                     │                     │
    │   form data         │   → snake_case         │                     │                     │
    │                     │── apiPost('/users',   │                     │                     │
    │                     │     body) ────────────▶│── fetch() ─────────▶│                     │
    │                     │                        │   POST + Bearer    │── check perm        │
    │                     │                        │                     │── validate unique   │
    │                     │                        │                     │── hash_password()   │
    │                     │                        │                     │── audit_log()       │
    │                     │                        │                     │── INSERT INTO users ──▶│
    │◀── reloadUsers() ◀─│◀── convertFromApi() ◀──│◀─── 201 JSON ◀─────│◀───────────────────│

READ FLOW:
    │── useEffect ──────▶│── apiGet('/users?      │                     │                     │
    │   → reloadUsers()  │     skip=0&limit=50')─▶── fetch() ─────────▶│── paginate_query()  │
    │                     │                        │                     │── SELECT * FROM     │
    │                     │                        │                     │   users ORDER BY id ──▶│
    │◀── items[] ◀───────│◀── convertFromApi() ◀──│◀─── JSON ◀─────────│◀───────────────────│

DELETE FLOW:
    │── handleDelete(id)▶│── apiDelete('/users/   │                     │                     │
    │   confirm()        │     {id}') ────────────▶── fetch() ─────────▶│── check: not self   │
    │                     │                        │   DELETE + JWT    │── check: no role    │
    │                     │                        │                     │── audit_log()       │
    │                     │                        │                     │── DELETE FROM users ──▶│
    │◀── reloadUsers() ◀─│◀── 200 OK ◀───────────│◀─── 200 OK ◀───────│◀───────────────────│
```
