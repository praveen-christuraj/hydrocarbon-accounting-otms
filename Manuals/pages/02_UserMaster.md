# UserMaster

## Purpose
Create, update, and manage application users. This is where user accounts are provisioned with their basic identity information and login credentials.

## File Locations
- **Frontend:** `frontend/src/pages/UserMaster.jsx`
- **API Module:** `frontend/src/api/userApi.js`
- **Backend Router:** `backend/app/routers/users.py` (prefix: `/users`)
- **Model:** `User` (`backend/app/models.py` line 8)

## Key Functions

### `reloadUsers()` — Load user list
- Calls `getUsers()` → `GET /users`
- Response: array of user objects
- Called on mount via `useEffect`

### `handleSubmit()` — Create or Update User
- For new users: `createUser(user)` → `POST /users`
- For edits: `updateUser(userId, user)` → `PUT /users/{userId}`
- Requires `Manage User` permission

### `handleEdit(user)` — Populate form for editing
- Sets form fields from selected user
- Username is disabled during edit (cannot change)

### `handleDelete(userId)` — Delete a user
- Calls `deleteUser(userId)` → `DELETE /users/{userId}`
- Confirmation dialog before deletion

## API Endpoints
| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/users` | List all users |
| `POST` | `/users` | Create new user |
| `PUT` | `/users/{id}` | Update existing user |
| `DELETE` | `/users/{id}` | Delete user |

## API Request Format (Create/Update)
```json
{
  "full_name": "John Doe",
  "username": "johndoe",
  "email": "john@example.com",
  "phone": "1234567890",
  "department": "Operations",
  "designation": "Operator",
  "password": "securepassword",
  "status": "Active"
}
```

## API Response Format (List)
```json
{
  "items": [
    {
      "id": 1,
      "full_name": "John Doe",
      "username": "johndoe",
      "email": "john@example.com",
      "phone": "1234567890",
      "department": "Operations",
      "designation": "Operator",
      "status": "Active",
      "created_at": "2024-01-01T00:00:00",
      "updated_at": "2024-01-01T00:00:00"
    }
  ]
}
```

## State Management
| State | Purpose |
|-------|---------|
| `users` | Array of all users from API |
| `user` | Current form fields (fullName, username, email, phone, department, designation, password, status) |
| `editId` | ID of user being edited (null for new) |
| `loading` | Loading state during API calls |

## Permission Requirements
- **View:** View User permission required to see the table
- **Manage:** Manage User permission required for create, edit, delete
- The `admin` bootstrap user bypasses permission checks

## Validation
- Full Name, Username, Email required
- Password required for new users
- Username must be unique (checked client-side against loaded users)
- Username disabled during edit (cannot be changed)

## Dependencies
- **App.jsx** passes `loggedInUser` for permission checking
- Uses `apiGet`, `apiPost`, `apiPut`, `apiDelete` from `apiClient.js`
- Token-based auth via `Authorization: Bearer` header added by apiClient

## User Lifecycle
1. Admin creates user via UserMaster → `password_hash` stored in DB
2. User logs in via LoginPage → JWT issued
3. User assigned to Role via UserRoleAssignment
4. User's permissions derive from Role via RolePermissionAssignment
5. User can change own password via ProfileSecurity
6. Admin can reset user password from ProfileSecurity
7. User can be set to Inactive/Blocked to disable login
