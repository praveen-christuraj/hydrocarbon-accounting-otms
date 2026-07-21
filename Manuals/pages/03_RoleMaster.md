# RoleMaster

## Purpose
Create, update, and manage application roles. Roles are the central construct in the RBAC (Role-Based Access Control) system — users are assigned roles, and roles are granted permissions.

## File Locations
- **Frontend:** `frontend/src/pages/RoleMaster.jsx`
- **API Module:** `frontend/src/api/roleApi.js`
- **Backend Router:** `backend/app/routers/roles.py` (prefix: `/roles`)
- **Model:** `Role` (`backend/app/models.py` line 145)

## Key Functions

### `handleSubmit()` — Create or Update Role
- New: `createRole(role)` → `POST /roles`
- Edit: `updateRole(roleId, role)` → `PUT /roles/{roleId}`
- Requires `Manage Role` permission

### `handleEdit(roleToEdit)` — Populate form
- Sets form fields: roleName, description, status

### `handleDelete(roleId)` — Delete a role
- `deleteRole(roleId)` → `DELETE /roles/{roleId}`
- Confirmation dialog required

## API Endpoints
| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/roles` | List all roles |
| `POST` | `/roles` | Create new role |
| `PUT` | `/roles/{id}` | Update role |
| `DELETE` | `/roles/{id}` | Delete role |

## API Request/Response Format
```json
// Create/Update Request
{ "role_name": "Operator", "description": "Field operations staff", "status": "Active" }

// Response
{ "id": 1, "role_name": "Operator", "description": "...", "status": "Active", "created_at": "...", "updated_at": "..." }
```

## Props
| Prop | Source |
|------|--------|
| `roles` | App.jsx (loaded via roleApi) |
| `reloadRoles` | Callback to refresh roles |
| `loggedInUser` | For permission checking |

## Permission Requirements
- **View:** View Role
- **Manage:** Manage Role

## Role → Permission → User Chain
```
PermissionMaster defines permissions
        ↓
RoleMaster defines roles
        ↓
RolePermissionAssignment assigns permissions to roles
        ↓
UserRoleAssignment assigns roles to users
        ↓
User now has effective permissions from their role

---

## Full-Stack Architecture Diagram — RoleMaster

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND LAYER  (React SPA)                                             │
│                                                                                                      │
│  ┌─────────────────────────────────────────┐                                                         │
│  │  RoleMaster.jsx                          │                                                         │
│  │  ──────────────                          │                                                         │
│  │  Props: roles[], reloadRoles(),          │                                                         │
│  │         loggedInUser                     │                                                         │
│  │                                          │                                                         │
│  │  State: form fields (roleName, desc,     │                                                         │
│  │         status), editId, loading          │                                                         │
│  │                                          │                                                         │
│  │  handleSubmit()                          │                                                         │
│  │    ├─ editId? → updateRole(id,data) ─────┤───────────┐                                            │
│  │    └─ new → createRole(data) ────────────┤───────────┤                                            │
│  │                                          │           │                                            │
│  │  handleDelete(id)                        │           │                                            │
│  │    └─ confirm() → deleteRole(id) ────────┤───────────┤                                            │
│  │                                          │           │                                            │
│  │  useEffect → reloadRoles() ──────────────┤───────────┤                                            │
│  └─────────────────────────────────────────┘           │                                            │
│                                                         │                                            │
│  ┌─────────────────────────────────────────┐            │                                            │
│  │  roleApi.js                              │◀──────────┘                                            │
│  │  ──────────                               │                                                       │
│  │  getRoles(params)                        │                                                       │
│  │    └─ apiGet('/roles?skip=0&limit=200')─▶│───────────▶  apiClient.js                              │
│  │                                          │            ──────────────                              │
│  │  createRole(role)                        │            fetch() + Bearer JWT                        │
│  │    └─ apiPost('/roles', {role_name,...})─│───────────▶                                           │
│  │                                          │                                                       │
│  │  updateRole(id, role)                    │                                                       │
│  │    └─ apiPut('/roles/{id}', body) ───────│───────────▶                                           │
│  │                                          │                                                       │
│  │  deleteRole(id)                          │                                                       │
│  │    └─ apiDelete('/roles/{id}') ──────────│───────────▶                                           │
│  │                                          │                                                       │
│  │  CONVERSION:  roleName ↔ role_name       │                                                       │
│  └─────────────────────────────────────────┘            └─────────────────┬──────────────────────────┘
└──────────────────────────────────────────────────────────────────────────┼──────────────────────────┘
                                                                           │
                                                                           ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                              BACKEND LAYER  (FastAPI)                                                │
│                                                                                                      │
│  ┌──────────────────────────────────────────────────────────────────────────────────────────────┐   │
│  │  Router: roles.py  (prefix: /roles)                                                          │   │
│  │  ──────────────────────                                                                       │   │
│  │                                                                                               │   │
│  │  GET /roles?skip=0&limit=200                                                                  │   │
│  │    ├─ Permission: require_user_permission('View Role')                                        │   │
│  │    ├─ Query: db.query(Role).order_by(Role.id)                                                 │   │
│  │    └─ Paginated: { items: [RoleResponse], total, skip, limit, has_more }                     │   │
│  │                                                                                               │   │
│  │  POST /roles                                                                                  │   │
│  │    ├─ Schema: RoleCreate (role_name, description, status)                                     │   │
│  │    ├─ Permission: require_user_permission('Manage Role')                                      │   │
│  │    ├─ Check: role_name unique (case-insensitive)                                              │   │
│  │    ├─ Create: Role(role_name, description, status)                                            │   │
│  │    ├─ Audit: create_audit_log('Role Master', 'Create Role')                                   │   │
│  │    └─ Return: RoleResponse                                                                    │   │
│  │                                                                                               │   │
│  │  PUT /roles/{role_id}                                                                         │   │
│  │    ├─ Schema: RoleCreate (same as create)                                                     │   │
│  │    ├─ Permission: require_user_permission('Manage Role')                                      │   │
│  │    ├─ Check: Role exists? 404 if not                                                          │   │
│  │    ├─ Check: role_name unique (excluding self)                                                │   │
│  │    ├─ Capture before/after for audit                                                          │   │
│  │    ├─ Update fields                                                                            │   │
│  │    └─ Return: RoleResponse (updated)                                                          │   │
│  │                                                                                               │   │
│  │  DELETE /roles/{role_id}                                                                      │   │
│  │    ├─ Permission: require_user_permission('Manage Role')                                      │   │
│  │    ├─ Check: Role exists? 404 if not                                                          │   │
│  │    ├─ Check: No UserRole assignments → block if assigned                                      │   │
│  │    ├─ Check: No RolePermission assignments → block if assigned                                │   │
│  │    ├─ Audit: create_audit_log('Role Master', 'Delete Role')                                   │   │
│  │    └─ Return: { message: 'Role deleted successfully' }                                       │   │
│  └──────────────────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                                      │
│  ┌──────────────────────────────────────┐    ┌──────────────────────────────────────────────────┐   │
│  │  Schemas:                             │    │  Dependencies                                    │   │
│  │  RoleCreate / RoleResponse            │    │  auth.py: get_current_user_from_token()           │   │
│  │    role_name: str                     │    │  permissions.py: require_user_permission()        │   │
│  │    description: str | None            │    │  pagination.py: paginate_query()                  │   │
│  │    status: str = 'Active'             │    │  audit_service.py: create_audit_log()              │   │
│  │    (Response: + id, created_at,       │    │    module_name = 'Role Master'                    │   │
│  │     updated_at)                       │    └──────────────────────────────────────────────────┘   │
│  └──────────────────────────────────────┘                                                            │
└──────────────────────────────────────┬──────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                              DATA LAYER  (SQLAlchemy + PostgreSQL)                                    │
│                                                                                                      │
│  ┌──────────────────────────────────────────────────────────────────────────────────────────────┐   │
│  │  Model: Role (__tablename__ = "roles")                                                        │   │
│  │  ─────────────────────────────                                                                 │   │
│  │  COLUMN        │ TYPE        │ CONSTRAINTS      │ NOTES                                      │   │
│  │────────────────┼─────────────┼──────────────────┼────────────────────────────────────────────│   │
│  │ id             │ Integer     │ PK, INDEX        │ Auto-increment                              │   │
│  │ role_name      │ String(100) │ UNIQUE, NOT NULL  │ Role identifier, used in RBAC chain        │   │
│  │ description    │ Text        │ NULLABLE          │ Free-text description                      │   │
│  │ status         │ String(20)  │ NOT NULL, 'Active'│ Active / Inactive                          │   │
│  │ created_at     │ DateTime    │ server_default    │ Auto-set                                   │   │
│  │ updated_at     │ DateTime    │ server_default    │ Auto-updated                               │   │
│  └──────────────────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                                      │
│  ┌──────────────────────────────────────────────────────────────────────────────────────────────┐   │
│  │  Related Models (Role is the central RBAC node)                                                │   │
│  │                                                                                                │   │
│  │  UserRole ─── role_id → roles.id (CASCADE)    ─── One role → many users                       │   │
│  │                     user_id → users.id (CASCADE)  (one role per user)                          │   │
│  │                                                                                                │   │
│  │  RolePermission ─── role_id → roles.id (CASCADE)  ─── One role → many permissions             │   │
│  │                      permission_id → permissions.id (CASCADE)                                  │   │
│  │                                                                                                │   │
│  │  OperationWorkflowPolicyRole ─── role_id → roles.id (CASCADE)  ─── Workflow policies           │   │
│  │  OperationWorkflowPolicyUser ─── user_id → users.id (CASCADE)   ─── per-user overrides        │   │
│  │                                                                                                │   │
│  │  RBAC Chain:                                                                                   │   │
│  │    User → UserRole → Role → RolePermission → Permission → permission_name                      │   │
│  │    Used by: require_user_permission() in permissions.py                                         │   │
│  └──────────────────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                                      │
│  DB: PostgreSQL → Table: roles                                                                      │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### RoleMaster — CRUD Data Flow Sequence

```
CREATE FLOW:
RoleMaster.jsx          roleApi.js              apiClient.js          roles.py             DB: roles
    │                       │                       │                     │                     │
    │── handleSubmit() ────▶│── convertRoleToApi()  │                     │                     │
    │   form data           │   → snake_case         │                     │                     │
    │                       │── apiPost('/roles',   │                     │                     │
    │                       │     body) ────────────▶│── fetch() ─────────▶│                     │
    │                       │                        │   POST + JWT       │── check perm        │
    │                       │                        │                     │── check unique      │
    │                       │                        │                     │── INSERT INTO roles ──▶│
    │◀── reloadRoles() ◀───│◀── RoleResponse ◀──────│◀─── 201 JSON ◀─────│◀───────────────────│

DELETE FLOW:
    │── handleDelete(id) ──▶│── apiDelete('/roles/  │                     │                     │
    │   confirm()           │     {id}') ────────────▶── fetch() ─────────▶│                     │
    │                       │                        │   DELETE + JWT    │── check: no users   │
    │                       │                        │                     │── check: no perms   │
    │                       │                        │                     │── DELETE FROM roles ──▶│
    │◀── reloadRoles() ◀───│◀── 200 OK ◀───────────│◀─── 200 OK ◀───────│◀───────────────────│

RBAC EVALUATION CHAIN (used across ALL pages):
    require_user_permission('View Role')
        │
        ├─▶ User (from JWT)
        │      │
        │      ▼
        ├─▶ UserRole (user_id ↔ role_id)
        │      │
        │      ▼
        ├─▶ Role (role_name, status)
        │      │
        │      ▼
        └─▶ RolePermission (role_id ↔ permission_id)
               │
               ▼
           Permission (permission_name = 'View Role')
               │
               ▼
           ALLOW or 403 FORBIDDEN
```
```
