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
```
