# OperationTaskManager

## Purpose
Manage operation tasks — the workflow approval system. Tasks are created when operations require review/approval (e.g., password reset requests, transaction approvals, correction requests). Admins can review, approve, or reject tasks.

## File Locations
- **Frontend:** `frontend/src/pages/OperationTaskManager.jsx`
- **API Module:** `frontend/src/api/operationTaskApi.js`
- **Backend Router:** `backend/app/routers/operation_tasks.py` (prefix: `/operation-tasks`)
- **Models:** `OperationTask`, `OperationTaskEvent`

## API Endpoints
| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/operation-tasks` | List tasks |
| `POST` | `/operation-tasks` | Create task |
| `PUT` | `/operation-tasks/{id}` | Update task |
| `DELETE` | `/operation-tasks/{id}` | Delete task |

## Key Backend Functions
- `admin_revoke_approved_transaction_from_task()` — Admin revokes an approved transaction via a task, with User attribution
- `admin_reject_approved_transaction_revoke_request()` — Admin rejects a revocation request, with User attribution
- `add_operation_task_event()` — Record task lifecycle events with User identity

## Task Types
- **Approval Tasks:** Operation transactions pending approval
- **Correction Tasks:** Correction requests on approved transactions
- **Password Reset Tasks:** Password reset requests from LoginPage
- **Admin Review Tasks:** General admin review items

## Props
| Prop | Source |
|------|--------|
| `loggedInUser` | App.jsx |

## Permissions
- **View:** View Operation Task
- **Manage:** Manage Operation Task (admin actions)

## Data Flow
```
LoginPage (password reset) → creates PasswordResetRequest → 
creates OperationTask → appears in Task Manager →
Admin reviews → approves/rejects → 
PasswordReset processed → User notified
```
