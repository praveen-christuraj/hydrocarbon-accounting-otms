# UserRoleAssignment

## Purpose
Assign roles to users. Each user can have one role — the role determines what permissions the user has across the system.

## File Locations
- **Frontend:** `frontend/src/pages/UserRoleAssignment.jsx`
- **API Module:** `frontend/src/api/userRoleApi.js`
- **Backend Router:** `backend/app/routers/user_roles.py` (prefix: `/user-roles`)
- **Models:** `User` (line 8), `Role` (line 145), `UserRole` (line ~185)

## API Endpoints
| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/user-roles` | List all user-role assignments |
| `POST` | `/user-roles` | Create/update a user-role assignment |
| `DELETE` | `/user-roles/{id}` | Remove a user-role assignment |

## API Request/Response
```json
// POST Request
{ "user_id": 1, "role_id": 2 }

// Response
{ "id": 1, "user_id": 1, "full_name": "John Doe", "username": "johndoe", "role_id": 2, "role_name": "Operator" }

// GET Response (array)
[{ "id": 1, "user_id": 1, "full_name": "John", "username": "jdoe", "role_id": 2, "role_name": "Operator" }]
```

## Props
| Prop | Source |
|------|--------|
| `users` | App.jsx |
| `roles` | App.jsx |
| `userRoleAssignments` | App.jsx |
| `reloadUserRoleAssignments` | Callback |
| `loggedInUser` | Permission checking |

## Permission Requirements
- **View:** View User Role Assignment
- **Manage:** Manage User Role Assignment

## Note
- Saving again for the same user updates their role (one role per user)
- Only Active users and Active roles shown in dropdowns

---

## Full-Stack Architecture Diagram — UserRoleAssignment

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND LAYER (React SPA)                                              │
│                                                                                                      │
│  ┌────────────────────────────────────────────┐                                                      │
│  │  UserRoleAssignment.jsx                      │                                                      │
│  │  ──────────────────────                      │                                                      │
│  │  Props: users[], roles[],                    │                                                      │
│  │         userRoleAssignments[],               │                                                      │
│  │         reloadUserRoleAssignments(),         │                                                      │
│  │         loggedInUser                         │                                                      │
│  │                                              │                                                      │
│  │  State: selectedUserId, selectedRoleId        │                                                      │
│  │                                              │                                                      │
│  │  handleAssignRole(userId, roleId)            │                                                      │
│  │    └─ saveUserRole(userId, roleId) ──────────┤───────────┐                                         │
│  │                                              │           │                                         │
│  │  handleRemoveAssignment(assignmentId)        │           │                                         │
│  │    └─ deleteUserRole(assignmentId) ──────────┤───────────┤                                         │
│  │                                              │           │                                         │
│  │  Shows: User dropdown, Role dropdown,        │           │                                         │
│  │         current assignments table              │           │                                         │
│  └────────────────────────────────────────────┘            │                                         │
│                                                              │                                         │
│  ┌────────────────────────────────────────────┐              │                                         │
│  │  userRoleApi.js                             │◀────────────┘                                         │
│  │  ──────────────                             │                                                       │
│  │  getUserRoleAssignments()                   │                                                       │
│  │    └─ apiGet('/user-roles') ────────────────│───────────▶  apiClient.js                             │
│  │                                              │            ──────────────                            │
│  │  saveUserRole(userId, roleId)                │            fetch() + Bearer JWT                      │
│  │    └─ apiPost('/user-roles',                 │                                                       │
│  │         {user_id, role_id}) ─────────────────│───────────▶                                         │
│  │                                              │                                                       │
│  │  deleteUserRole(assignmentId)                │                                                       │
│  │    └─ apiDelete('/user-roles/{id}') ─────────│───────────▶                                         │
│  │                                              │                                                       │
│  │  CONVERSION: userId ↔ user_id,               │                                                       │
│  │               roleId ↔ role_id,               │                                                       │
│  │               fullName ↔ full_name            │                                                       │
│  └────────────────────────────────────────────┘            └─────────────────┬─────────────────────────┘
└──────────────────────────────────────────────────────────────────────────────┼─────────────────────────┘
                                                                               │
                                                                               ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                              BACKEND LAYER (FastAPI)                                                 │
│                                                                                                      │
│  ┌──────────────────────────────────────────────────────────────────────────────────────────────┐   │
│  │  Router: user_roles.py  (prefix: /user-roles)                                                  │   │
│  │  ────────────────────────────                                                                   │   │
│  │                                                                                                │   │
│  │  GET /user-roles — List ALL user-role assignments                                              │   │
│  │    ├─ Permission: require_user_permission('View User Role Assignment')                         │   │
│  │    ├─ Query: UserRole JOIN User JOIN Role                                                      │   │
│  │    │   SELECT assignment.*, user.full_name, user.username,                                     │   │
│  │    │          role.role_name FROM user_roles                                                   │   │
│  │    │   JOIN users ON users.id = user_roles.user_id                                             │   │
│  │    │   JOIN roles ON roles.id = user_roles.role_id                                             │   │
│  │    └─ Return: [{ id, user_id, full_name, username, role_id, role_name }]                       │   │
│  │                                                                                                │   │
│  │  POST /user-roles — CREATE or UPDATE a user-role assignment                                    │   │
│  │    ├─ Schema: UserRoleSaveRequest { user_id: int, role_id: int }                              │   │
│  │    ├─ Permission: require_user_permission('Manage User Role Assignment')                       │   │
│  │    ├─ Check: User exists + status = 'Active'?                                                  │   │
│  │    ├─ Check: Role exists + status = 'Active'?                                                  │   │
│  │    ├─ Check: existing assignment for userId?                                                   │   │
│  │    │    ├─ YES → UPDATE role_id (capture before/after for audit)                              │   │
│  │    │    └─ NO  → INSERT new UserRole row                                                      │   │
│  │    ├─ Audit: create_audit_log('User Role Assignment', 'Create' / 'Update')                     │   │
│  │    └─ Return: { id, user_id, full_name, username, role_id, role_name }                         │   │
│  │                                                                                                │   │
│  │  DELETE /user-roles/{assignment_id} — REMOVE a user-role assignment                            │   │
│  │    ├─ Permission: require_user_permission('Manage User Role Assignment')                       │   │
│  │    ├─ Check: assignment exists? 404 if not                                                     │   │
│  │    ├─ Audit: capture user + role info before deletion                                        │   │
│  │    ├─ DELETE FROM user_roles WHERE id = assignment_id                                         │   │
│  │    └─ Return: { message: '...deleted successfully' }                                          │   │
│  └──────────────────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                                      │
│  Schemas: UserRoleSaveRequest { user_id: int, role_id: int }                                         │
│           UserRoleResponse { id, user_id, full_name, username, role_id, role_name }                   │
│                                                                                                      │
│  Audit: module_name = 'User Role Assignment', actions: Create / Update / Delete                      │
└──────────────────────────────────────┬──────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                              DATA LAYER (SQLAlchemy + PostgreSQL)                                     │
│                                                                                                      │
│  ┌──────────────────────────────────────────────────────────────────────────────────────────────┐   │
│  │  UserRole (__tablename__ = "user_roles")                                                      │   │
│  │  ────────────────────────────────                                                              │   │
│  │  COLUMN      │ TYPE      │ CONSTRAINTS        │ NOTES                                        │   │
│  │──────────────┼───────────┼────────────────────┼──────────────────────────────────────────────│   │
│  │ id           │ Integer   │ PK, INDEX          │ Auto-increment                                │   │
│  │ user_id      │ Integer   │ FK → users.id      │ CASCADE on delete                            │   │
│  │              │           │ (CASCADE), UNIQUE   │ ONE role per user constraint                  │   │
│  │ role_id      │ Integer   │ FK → roles.id      │ CASCADE on delete                            │   │
│  │              │           │ (CASCADE)           │                                               │   │
│  │ created_at   │ DateTime  │ server_default      │ Auto-set                                     │   │
│  │──────────────┴───────────┴────────────────────┴──────────────────────────────────────────────│   │
│  │ UNIQUE(user_id)  ← Enforces ONE ROLE PER USER                                                 │   │
│  └──────────────────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                                      │
│  ┌──────────────────────────────────────────────────────────────────────────────────────────────┐   │
│  │  Complete RBAC Chain (evaluated on every protected endpoint)                                   │   │
│  │                                                                                                │   │
│  │   users ──< user_roles >── roles ──< role_permissions >── permissions                          │   │
│  │    │           │            │                    │               │                              │   │
│  │    │           │            │                    │               │                              │   │
│  │    ▼           ▼            ▼                    ▼               ▼                              │   │
│  │  JWT auth  1 user : 1 role  Role name   M : M permission   perm_name =                        │   │
│  │  identity   per user        + status    assignment        'View User'                         │   │
│  │                                                                                                │   │
│  │  require_user_permission('View Role Permission Assignment')                                    │   │
│  │    └─ get user from JWT → get user_role → get role → get all role_permissions                 │   │
│  │       → get permission names → check if required perm in set → ALLOW or 403                    │   │
│  └──────────────────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                                      │
│  DB: PostgreSQL → Table: user_roles                                                                  │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
```
