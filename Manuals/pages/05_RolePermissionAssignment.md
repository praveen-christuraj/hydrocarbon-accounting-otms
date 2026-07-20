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
