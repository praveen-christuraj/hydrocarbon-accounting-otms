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
