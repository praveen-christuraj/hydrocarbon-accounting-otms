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

---

## Full-Stack Architecture Diagram — AccessSummary

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND LAYER (React SPA)                                              │
│                                                                                                      │
│  ┌──────────────────────────────────────────────────────────────────────────────────────────────┐   │
│  │  AccessSummary.jsx  (Read-Only — Combines Multiple Data Sources Locally)                      │   │
│  │  ─────────────────                                                                             │   │
│  │                                                                                                │   │
│  │  Props (ALL from App.jsx central state — NO dedicated API calls):                              │   │
│  │    ├─ users[]                   ── loaded by App.jsx via userApi.getUsers()                    │   │
│  │    ├─ userRoleAssignments[]     ── loaded via userRoleApi.getUserRoleAssignments()             │   │
│  │    ├─ rolePermissionAssignments[] ── loaded via rolePermissionApi.getAllRolePermissions()      │   │
│  │    ├─ roles[]                   ── loaded via roleApi.getRoles()                               │   │
│  │    └─ permissions[]             ── loaded via permissionApi.getPermissions()                    │   │
│  │                                                                                                │   │
│  │  Data Derivation (all client-side, NO backend endpoint):                                      │   │
│  │                                                                                                │   │
│  │  usersWithAccess = users.map(user => {                                                        │   │
│  │    role = userRoleAssignments.find(a => a.userId === user.id)                                  │   │
│  │    rolePerms = rolePermissionAssignments.find(r => r.roleId === role?.roleId)                  │   │
│  │    return { ...user, roleName: role?.roleName, permissions: rolePerms?.permissions || [] }     │   │
│  │  })                                                                                            │   │
│  │                                                                                                │   │
│  │  ┌──────────────────────────────────────────────────────────────────────────────────────┐     │   │
│  │  │  USER 1: John (Operator)                       │  USER 2: Mary (Admin)                │     │   │
│  │  │  ├─ Permissions derived from:                  │  ├─ Permissions derived from:         │     │   │
│  │  │  │  userRoleAssignment: John → Operator        │  │  userRoleAssignment: Mary → Admin  │     │   │
│  │  │  │  rolePermissionAssignment: Operator → [     │  │  rolePermissionAssignment: Admin→[ │     │   │
│  │  │  │    'View User', 'View Location',            │  │    'View User','Manage User',      │     │   │
│  │  │  │    'View Asset', 'Create Op Entry'          │  │    'View Role','Manage Role',      │     │   │
│  │  │  │  ]                                          │  │    'View Permission', ... all...   │     │   │
│  │  │  └─ Permission Count: 4                        │  │  ]                                │     │   │
│  │  └────────────────────────────────────────────────┘  └────────────────────────────────────┘     │   │
│  └──────────────────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                                      │
│  Features: Search (name/email/dept), Filter by role, Filter by status,                               │
│            Permission grouping by module, Count badges                                                │
└──────────────────────────────────────────────────────────────────┬───────────────────────────────────┘
                                                                   │
           ALL DATA COMES FROM App.jsx CENTRAL STATE (loaded on login)
                                                                   │
┌──────────────────────────────────────────────────────────────────┴───────────────────────────────────┐
│                              BACKEND LAYER (FastAPI) — NO dedicated router for AccessSummary         │
│                                                                                                      │
│  AccessSummary reuses data from these existing routers (already loaded by App.jsx):                  │
│                                                                                                      │
│  ┌────────────┐    ┌──────────────┐    ┌──────────────────┐    ┌──────────────────┐                  │
│  │  users.py   │    │  user_roles  │    │ role_permissions │    │    roles.py      │                  │
│  │  /users     │    │  /user-roles │    │ /role-permissions│    │    /roles        │                  │
│  └────────────┘    └──────────────┘    └──────────────────┘    └──────────────────┘                  │
│       │                  │                       │                       │                           │
│       ▼                  ▼                       ▼                       ▼                           │
│  ┌──────────────────────────────────────────────────────────────────────────────────────────────┐   │
│  │  Data Join (Visual Representation of the Client-Side Merge)                                   │   │
│  │                                                                                                │   │
│  │  users TABLE        user_roles TABLE      roles TABLE        role_permissions TABLE            │   │
│  │  ──────────         ───────────────       ──────────         ────────────────────              │   │
│  │  id: 1     ───────▶ user_id: 1 ──────────▶ role_id: 1 ──────▶ role_id: 1                      │   │
│  │  name: John         role_id: 2            id: 2               permission_id: 5                 │   │
│  │                     ─────────             name: Operator      permission_id: 8                 │   │
│  │  id: 2     ───────▶ user_id: 2 ──────────▶ role_id: 1       permissions TABLE                  │   │
│  │  name: Mary         role_id: 1            id: 1             ────────────────                   │   │
│  │                     ─────────             name: Admin        id: 5 → 'View User'              │   │
│  │                                                                 id: 8 → 'View Location'         │   │
│  │                                                                                                │   │
│  │  RESULT (derived in frontend):                                                                  │   │
│  │    John → Operator → [View User, View Location, View Asset, Create Op Entry]                   │   │
│  │    Mary → Admin → [View User, Manage User, View Role, Manage Role, ... ALL permissions...]     │   │
│  └──────────────────────────────────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────┬──────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                              DATA LAYER (SQLAlchemy + PostgreSQL)                                     │
│                                                                                                      │
│  ┌──────────────────────────────────────────────────────────────────────────────────────────────┐   │
│  │  Tables Queried (via their respective routers):                                                │   │
│  │                                                                                                │   │
│  │  users          │  user_roles       │  roles          │  role_permissions  │  permissions      │   │
│  │  ───────────────┼───────────────────┼─────────────────┼────────────────────┼───────────────────│   │
│  │  id (PK)        │  id (PK)          │  id (PK)        │  id (PK)           │  id (PK)          │   │
│  │  full_name      │  user_id (FK)     │  role_name      │  role_id (FK)      │  permission_name  │   │
│  │  username       │  role_id (FK)     │  description    │  permission_id(FK) │  module_name      │   │
│  │  email          │  ───────────       │  status         │  ───────────       │  status           │   │
│  │  department     │  UNIQUE(user_id)  │                 │  UNIQUE(role_id,   │                   │   │
│  │  status         │  (1 role/user)    │                 │   permission_id)   │                   │   │
│  │                 │                   │                 │                    │                   │   │
│  │  └──< user_roles >── roles ──< role_permissions >── permissions              │   │
│  └──────────────────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                                      │
│  DB: PostgreSQL → Tables: users, user_roles, roles, role_permissions, permissions                    │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
```
