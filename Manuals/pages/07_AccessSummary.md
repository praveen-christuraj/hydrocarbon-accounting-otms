# AccessSummary

## Purpose
View a consolidated report of what permissions each user has, derived from their role assignment and the role-permission mappings. This is a read-only page for auditing access across the system.

## File Locations
- **Frontend:** `frontend/src/pages/AccessSummary.jsx`
- **Backend:** No dedicated API — combines data from users, roles, and role-permission endpoints (loaded via App.jsx)

## Key Logic

### Data Derivation Chain
```
users[] + userRoleAssignments[] → each user's assigned role
roles[] + rolePermissionAssignments[] → each role's permissions
Combined: usersWithAccess[] → each user with their effective permissions
```

### `getUserRole(user)` — Find a user's role assignment
### `getRolePermissions(roleName)` — Find all permissions for a role
### `groupPermissionsByModule(permissions)` — Organize permissions by module

## Features
- **Search:** Filter users by fullName, username, email, department, designation
- **Role Filter:** Filter users by assigned role
- **Status Filter:** Filter users by user status
- **Permission grouping:** Each user's permissions displayed grouped by module name
- **Count badges:** Shows permission count per user

## Props
| Prop | Source |
|------|--------|
| `users` | App.jsx |
| `roles` | App.jsx |
| `permissions` | App.jsx |
| `userRoleAssignments` | App.jsx |
| `rolePermissionAssignments` | App.jsx |

## Permission Requirements
- **View:** View Access Summary
