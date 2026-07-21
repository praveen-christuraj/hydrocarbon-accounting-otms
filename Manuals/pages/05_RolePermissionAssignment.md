# RolePermissionAssignment

## Purpose
Assign permissions to roles. This is the mapping layer that connects the RBAC system — by assigning permissions to a role, every user with that role inherits the permissions.

## File Locations
- **Frontend:** `frontend/src/pages/RolePermissionAssignment.jsx`
- **API Module:** `frontend/src/api/rolePermissionApi.js`
- **Backend Router:** `backend/app/routers/role_permissions.py` (prefix: `/role-permissions`)

## Key Functions

### `handleRoleChange(roleId)` — Select a role
- Loads existing permissions for the selected role
- Checks `rolePermissionAssignments` prop for existing data

### `handlePermissionChange(permissionId)` — Toggle permission
- Adds/removes permission ID from `selectedPermissions` array

### `handleSave()` — Save assignment
- `saveRolePermissions(roleId, permissionIds)` → `POST /role-permissions/{roleId}`
- Sends array of permission IDs

## API Endpoints
| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/role-permissions` | Get all role-permission mappings |
| `GET` | `/role-permissions/{roleId}` | Get permissions for a role |
| `POST` | `/role-permissions/{roleId}` | Save permissions for a role |

## API Request/Response
```json
// Save Request
{ "permission_ids": [1, 2, 3, 5, 8] }

// Response
{
  "role_id": 1,
  "role_name": "Operator",
  "permissions": [
    { "permission_id": 1, "permission_name": "View User", "module_name": "User Master", "status": "Active" }
  ]
}
```

## Props
| Prop | Source |
|------|--------|
| `roles` | App.jsx |
| `permissions` | App.jsx |
| `rolePermissionAssignments` | App.jsx |
| `reloadRolePermissions` | Callback |

## User Interface
- Dropdown to select a role (shows only Active roles)
- Grid of permission cards with checkboxes (shows only Active permissions)
- Permissions grouped by enabling/disabling individual permission toggles
- Read-only table showing current assignments per role

---

## Full-Stack Architecture Diagram — RolePermissionAssignment

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND LAYER (React SPA)                                              │
│                                                                                                      │
│  ┌────────────────────────────────────────────┐                                                      │
│  │  RolePermissionAssignment.jsx               │                                                      │
│  │  ──────────────────────────────────          │                                                      │
│  │  Props: roles[], permissions[],              │                                                      │
│  │         rolePermissionAssignments[],          │                                                      │
│  │         reloadRolePermissions()              │                                                      │
│  │                                              │                                                      │
│  │  State: selectedRoleId, selectedPermIds[]    │                                                      │
│  │                                              │                                                      │
│  │  handleRoleChange(roleId)                    │                                                      │
│  │    └─ Loads existing permissions for role     │                                                      │
│  │       from rolePermissionAssignments[] prop   │                                                      │
│  │                                              │                                                      │
│  │  handlePermissionChange(permId)              │                                                      │
│  │    └─ Toggle permId in selectedPermIds[]     │                                                      │
│  │                                              │                                                      │
│  │  handleSave()                                │                                                      │
│  │    └─ saveRolePermissions(roleId, permIds) ──┤───────────┐                                         │
│  └────────────────────────────────────────────┘            │                                         │
│                                                              │                                         │
│  ┌────────────────────────────────────────────┐              │                                         │
│  │  rolePermissionApi.js                       │◀────────────┘                                         │
│  │  ─────────────────────                      │                                                       │
│  │  getAllRolePermissions()                    │                                                       │
│  │    └─ apiGet('/role-permissions') ──────────│───────────▶  apiClient.js                             │
│  │                                              │            ──────────────                            │
│  │  getRolePermissions(roleId)                  │            fetch() + Bearer JWT                      │
│  │    └─ apiGet('/role-permissions/{id}') ──────│───────────▶                                         │
│  │                                              │                                                       │
│  │  saveRolePermissions(roleId, permIds)        │                                                       │
│  │    └─ apiPost('/role-permissions/{id}',      │                                                       │
│  │         {permission_ids: [...]}) ────────────│───────────▶                                         │
│  │                                              │                                                       │
│  │  CONVERSION:  roleId ↔ role_id,              │                                                       │
│  │               permissionName ↔ perm_name     │                                                       │
│  └────────────────────────────────────────────┘            └─────────────────┬─────────────────────────┘
└──────────────────────────────────────────────────────────────────────────────┼─────────────────────────┘
                                                                               │
                                                                               ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                              BACKEND LAYER (FastAPI)                                                 │
│                                                                                                      │
│  ┌──────────────────────────────────────────────────────────────────────────────────────────────┐   │
│  │  Router: role_permissions.py  (prefix: /role-permissions)                                      │   │
│  │  ─────────────────────────────────────                                                         │   │
│  │                                                                                                │   │
│  │  GET /role-permissions — Get ALL role-permission mappings                                      │   │
│  │    ├─ Permission: require_user_permission('View Role Permission Assignment')                   │   │
│  │    ├─ Query: all Roles → for each, load_permissions_by_role() via join                         │   │
│  │    │   SELECT permission.*, rp.role_id FROM permissions                                        │   │
│  │    │   JOIN role_permissions rp ON rp.permission_id = permissions.id                           │   │
│  │    │   WHERE rp.role_id IN (...)                                                               │   │
│  │    └─ Return: [{ role_id, role_name, permissions: [...] }]                                    │   │
│  │                                                                                                │   │
│  │  GET /role-permissions/{role_id} — Get permissions for ONE role                                │   │
│  │    ├─ Check: Role exists? 404 if not                                                          │   │
│  │    └─ Same join filtered by single role_id                                                     │   │
│  │                                                                                                │   │
│  │  POST /role-permissions/{role_id} — SAVE (replace all) permissions for a role                  │   │
│  │    ├─ Schema: RolePermissionSaveRequest { permission_ids: list[int] }                          │   │
│  │    ├─ Permission: require_user_permission('Manage Role Permission Assignment')                 │   │
│  │    ├─ Check: Role exists? 404 if not                                                          │   │
│  │    ├─ Capture BEFORE state (current permissions for audit)                                     │   │
│  │    ├─ Validate: no duplicate IDs, all IDs valid                                                │   │
│  │    ├─ DELETE all existing RolePermission rows for this role_id                                │   │
│  │    ├─ INSERT new RolePermission rows for each permission_id                                   │   │
│  │    ├─ Audit: create_audit_log with before/after diff (added/removed IDs)                      │   │
│  │    └─ Return: { role_id, role_name, permissions: [...] }                                      │   │
│  └──────────────────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                                      │
│  ┌──────────────────────────────────────┐    ┌──────────────────────────────────────────────────┐   │
│  │  Schemas                              │    │  Dependencies & Utilities                       │   │
│  │  RolePermissionSaveRequest            │    │  permissions.py: require_user_permission()      │   │
│  │    permission_ids: list[int]           │    │  audit_service.py: create_audit_log()           │   │
│  │                                       │    │    module_name = 'Role Permission Assignment'   │   │
│  │  RolePermissionResponse               │    │    action = 'Update Role Permission Assignment'│   │
│  │    role_id, role_name, permissions[]  │    └──────────────────────────────────────────────────┘   │
│  └──────────────────────────────────────┘                                                            │
└──────────────────────────────────────┬──────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                              DATA LAYER (SQLAlchemy + PostgreSQL)                                     │
│                                                                                                      │
│  ┌──────────────────────────────────────────────────────────────────────────────────────────────┐   │
│  │  RolePermission (__tablename__ = "role_permissions")     FK Chain:                             │   │
│  │  ────────────────────────────────────────                                                    │   │
│  │  id (PK)          │ Integer                   roles.id ◀──┐                                  │   │
│  │  role_id          │ FK → roles.id (CASCADE)                │                                  │   │
│  │  permission_id    │ FK → permissions.id (CASCADE)          │   role_permissions                 │   │
│  │  created_at       │ DateTime                  permissions.id ◀──┘                                  │   │
│  │  ─────────────────                                                                               │   │
│  │  UNIQUE(role_id, permission_id)                                                                   │   │
│  └──────────────────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                                      │
│  ┌──────────────────────────────────────────────────────────────────────────────────────────────┐   │
│  │  Related Tables                                                                               │   │
│  │                                                                                                │   │
│  │  Role (roles) ───┬──< RolePermission >──┬── Permission (permissions)                          │   │
│  │  role_name        │                      │  permission_name                                    │   │
│  │  description     │    M : M              │  module_name                                        │   │
│  │                   │                      │                                                     │   │
│  │  UserRole (user_roles) interacts with both:                                                     │   │
│  │  ┌─────────────────────────────────────────────────────────────────────────────┐               │   │
│  │  │  User → UserRole → Role → RolePermission → Permission → permission_name    │               │   │
│  │  │  This chain is evaluated by require_user_permission() on every protected    │               │   │
│  │  │  endpoint across the entire system.                                         │               │   │
│  │  └─────────────────────────────────────────────────────────────────────────────┘               │   │
│  └──────────────────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                                      │
│  DB: PostgreSQL → Table: role_permissions                                                             │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
```
