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

---

## Full-Stack Architecture Diagram — OperationTaskManager

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ FRONTEND                          BACKEND                             DATA                                   │
│                                                                                                              │
│ OperationTaskManager  opTaskApi   operation_tasks.py                 OperationTask                          │
│ ────────────────────  ──────────  ─────────────────                  ──────────────                          │
│ Props: loggedInUser    getTasks() GET /operation-tasks               id (PK) | Integer                      │
│                        createTask POST /operation-tasks              task_number | String(100)              │
│ Task list view with    updateTask PUT /operation-tasks/{id}          task_type | String(80)                 │
│ filters by type,       deleteTask DELETE /operation-tasks/{id}        (Approval/PasswordReset/Correction/   │
│ status, assigned to   ────────── ─────────────                        AdminRevoke)                          │
│                        conv:      Perm: ('View/Mng Op Task')        status (Open/InProgress/Approved/      │
│ Task types:            getTasks↔  Audit: module='Op Task'             Rejected/Cancelled)                  │
│ - Approval (from      GET /tasks ─────────────                       assigned_role_ids_json | JSONB        │
│   OpTxn Submit)       ──────────                                       assigned_user_ids_json | JSONB      │
│ - Password Reset      ──────────  ─────────────                      associated_policy_id | Integer?       │
│   (from LoginPage)                KEY FUNCTIONS:                     transaction_id (FK→OpTxn)?            │
│ - Correction (from                admin_revoke_approved_             ticket_number | String                 │
│   OpTxn correction)                transaction_from_task()           operation_number | String               │
│ - Admin Revoke (from              admin_reject_approved_             created_by | String                    │
│   correction request)              transaction_revoke_request()      created_at | DateTime                   │
│                                    add_operation_task_event()        updated_at | DateTime                   │
│ Admin can:                        create_operation_approval_        ──────────────                          │
│ review details,                    task_for_transaction()            ──────────────                          │
│ approve, reject                  close_operation_approval_tasks_                                           │
│                                    for_transaction()                OperationTaskEvent                     │
│ Admin Revoke flow:                generate_operation_task_number()   ──────────────────                    │
│ correction_request → creates                                          task_id (FK→OperationTask)            │
│ OperationTask + AuditLog →        AUTO-CREATED BY:                   event_type | String                   │
│ admin approves → ledger            OperationTransactionDetail on      event_data | JSONB                    │
│ reversed, txn→Draft                Submit: approval task              performed_by | String                 │
│                                    on Approval: close task            performed_at | DateTime               │
│                                    correction_requests.py: revoke     remarks | Text                         │
│                                    task                              ──────────────────                     │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```
