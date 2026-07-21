# PermissionMaster

## Purpose
Create and manage system permissions for the RBAC system. Each permission represents a specific action (View, Manage, Create, Edit, Delete) on a specific module in the application.

## File Locations
- **Frontend:** `frontend/src/pages/PermissionMaster.jsx`
- **API Module:** `frontend/src/api/permissionApi.js`
- **Backend Router:** `backend/app/routers/permissions.py` (prefix: `/permissions`)
- **Model:** `Permission` (`backend/app/models.py`)

## Key Functions

### `handleSubmit()` — Create or Update Permission
- New: `createPermission(permission)` → `POST /permissions`
- Edit: `updatePermission(id, permission)` → `PUT /permissions/{id}`
- Requires `Manage Permission`

### `handleEdit(permissionToEdit)` — Populate form
### `handleDelete(permissionId)` — Delete permission

## API Endpoints
| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/permissions` | List all permissions |
| `POST` | `/permissions` | Create new permission |
| `PUT` | `/permissions/{id}` | Update permission |
| `DELETE` | `/permissions/{id}` | Delete permission |

## API Request/Response
```json
// Request
{ "permission_name": "View User", "module_name": "User Master", "description": "...", "status": "Active" }

// Response
{ "id": 1, "permission_name": "View User", "module_name": "...", "description": "...", "status": "Active" }
```

## Available Module Names (from form dropdown)
User Master, Role Master, Permission Master, Role Permission Assignment, User Role Assignment, Access Summary, Location Master, Asset Type Master, Asset Master, Calibration Template Master, Asset Calibration Table, Asset Assignment, Asset Assignment Summary, Operations, Barge Seal Master, Company Report Profile, Reports, Admin

## Props
| Prop | Source |
|------|--------|
| `permissions` | App.jsx (loaded via permissionApi) |
| `reloadPermissions` | Callback to refresh |
| `loggedInUser` | For permission checking |

## Permission Requirements
- **View:** View Permission
- **Manage:** Manage Permission

---

## Full-Stack Architecture Diagram — PermissionMaster

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        FRONTEND LAYER (React SPA)                               │
│                                                                                 │
│  PermissionMaster.jsx         permissionApi.js          apiClient.js            │
│  ────────────────────         ─────────────────         ────────────             │
│  Props: permissions[],        getPermissions()           fetch() + JWT           │
│         reloadPermissions(),   ├─ apiGet('/permissions')  apiGet/Put/Post/Delete │
│         loggedInUser          createPermission()          ────────────           │
│                               └─ apiPost('/permissions')                         │
│  CRUD: Create/Edit/Delete     updatePermission()          camelCase ↔ snake_case │
│  Search: by name/module       └─ apiPut('/perms/{id})    permissionName ↔ perm  │
│                               deletePermission()          moduleName ↔ mod_nam   │
│                               └─ apiDelete('/perms/{id})                        │
└──────────────────────────────────────────────────────────────────┬──────────────┘
                                                                   │
┌──────────────────────────────────────────────────────────────────┴──────────────┐
│                        BACKEND LAYER (FastAPI)                                   │
│                                                                                 │
│  permissions.py (prefix: /permissions)                                          │
│  ─────────────────────────────────                                               │
│  GET  /permissions          → list (paginated, filterable by search + module)   │
│  POST /permissions          → create (checks unique per module)                  │
│  PUT  /permissions/{id}     → update (checks duplicate excluding self)           │
│  DELETE /permissions/{id}   → delete (blocks if assigned to roles)              │
│  POST /permissions/seed     → seed standard permissions from STANDARD_PERMISSIONS│
│                                                                                 │
│  Schemas: PermissionCreate / PermissionResponse                                  │
│    permission_name: str, module_name: str, description: str?, status: str        │
│    (Response: + id, created_at, updated_at)                                      │
│                                                                                 │
│  Dependencies: get_current_user_from_token() → require_user_permission()        │
│  Audit: module_name='Permission Master'                                         │
└──────────────────────────────────────────────────────────────────┬──────────────┘
                                                                   │
┌──────────────────────────────────────────────────────────────────┴──────────────┐
│                        DATA LAYER (SQLAlchemy + PostgreSQL)                      │
│                                                                                 │
│  Permission (permissions)                  RolePermission (role_permissions)    │
│  ────────────────────────                  ─────────────────────────────         │
│  id (PK)          │ Integer                id (PK)          │ Integer           │
│  permission_name  │ String(120)            role_id          │ FK → roles.id     │
│  module_name      │ String(120)            permission_id    │ FK → permissions   │
│  description      │ Text?                  created_at       │ DateTime          │
│  status           │ String(20)             UNIQUE(role_id, permission_id)       │
│  created_at       │ DateTime                                                        │
│  updated_at       │ DateTime               RBAC Chain:                            │
│  UNIQUE(permission_name, module_name)      User → Role → Permission              │
│                                            (via UserRole → RolePermission)       │
└──────────────────────────────────────────────────────────────────────────────────┘
```
