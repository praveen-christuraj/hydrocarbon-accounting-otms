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
