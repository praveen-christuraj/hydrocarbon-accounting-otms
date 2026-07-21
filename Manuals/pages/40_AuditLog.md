# AuditLog

## Purpose
View the system audit trail. Every mutation (create, update, delete, status change) across all modules is logged with the user who performed it, what changed, and when.

## File Locations
- **Frontend:** `frontend/src/pages/AuditLog.jsx`
- **API Module:** `frontend/src/api/auditLogApi.js`
- **Backend Router:** `backend/app/routers/audit_logs.py` (prefix: `/audit-logs`)
- **Model:** `AuditLog` (`backend/app/models.py` line 118)
- **Service:** `backend/app/services/audit_service.py`

## API Endpoints
| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/audit-logs` | Get paginated audit log entries |

## API Response
```json
{
  "items": [
    {
      "id": 1,
      "module_name": "User Master",
      "action": "Create",
      "entity_type": "User",
      "entity_id": 5,
      "entity_label": "John Doe",
      "ticket_number": null,
      "performed_by": "admin",
      "remarks": "Created new user account",
      "old_status": null,
      "new_status": "Active",
      "request_path": "/users",
      "details": { "changes": {...} },
      "created_at": "2024-01-15T10:00:00Z"
    }
  ],
  "total": 1500,
  "page": 1,
  "page_size": 50
}
```

## Key Features
- Filter by module, action, date range, user
- Paginated browsing
- Detailed view of what changed (old/new values in `details` JSONB)
- Export capability

## `create_audit_log()` — Cross-Cutting Service
Every mutation across ALL routers calls this function. It records:
- **Who:** `performed_by` — the authenticated User
- **What:** `module_name`, `action`, `entity_type`, `entity_id`
- **Status change:** `old_status` → `new_status`
- **Context:** `request_path`, `ticket_number`, `operation_number`
- **Details:** Full JSONB snapshot of changes

## Props
| Prop | Source |
|------|--------|
| None (self-contained data fetching) | |

## Permissions
- **View:** View Audit Log

---

## Full-Stack Architecture Diagram — AuditLog

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ FRONTEND                          BACKEND                          DATA                                      │
│                                                                                                              │
│ AuditLog           auditLogApi     audit_logs.py                   AuditLog                                 │
│ ─────────           ────────────   ─────────────                   ─────────                                 │
│ Paginated table     getLogs()      GET /audit-logs                 id (PK) | BigInt                         │
│ with filters:       ────────────    ?page=&page_size=&module=      module_name | String(100)                │
│ module, action,     conv:           &action=&date_from=&date_to=   action | String(100)                     │
│ date range, user    getLogs↔        &user_id=&search=              entity_type | String(100)               │
│                     GET /audit-logs ─────────────                   entity_id | Integer?                     │
│ Columns:                           Perm: ('View Audit Log')        entity_label | String(200)               │
│ Timestamp, Module, ─────────────   Audit: module='Audit Log'       ticket_number | String?                  │
│ Action, Entity,    ─────────────  ─────────────                    operation_number | String?                │
| Performed By,       Cross-cutting  ─────────────                   old_status | String(50)                  │
| Old Status, New     service:                                        new_status | String(50)                  │
| Status, Remarks,    create_audit_log()                             performed_by | String(100)               │
| Details                          Called from every router          remarks | Text?                           │
│                                    after every mutation.           request_path | String(500)               │
│                                    Records:                        details | JSONB                          │
│                                    - User identity                 created_at | DateTime                    │
│                                    - Module/action                                                          │
│                                    - Entity + ID                                                            │
│                                    - Old/new status                  AUDIT SERVICE:                         │
│                                    - Changes snapshot (JSONB)        app/services/audit_service.py           │
│                                    - Request path                   create_audit_log(db, module_name,       │
│                                                                      action, current_user, entity_type,    │
│                                                                      entity_id, entity_label,              │
│                                                                      ticket_number, operation_number,      │
│                                                                      old_status, new_status, remarks,      │
│                                                                      request_path, details)                │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```
