# BackupRecovery

## Purpose
Manage database backup and restore operations. Supports automatic scheduled backups, manual backups, backup cleanup, and point-in-time restore.

## File Locations
- **Frontend:** `frontend/src/pages/BackupRecovery.jsx`
- **API Module:** `frontend/src/api/backupApi.js`
- **Backend Router:** `backend/app/routers/backup_restore.py` (prefix: `/backup`)
- **Models:** `BackupJob`, `BackupSettings`, `BackupRestoreRequest`, `BackupRestoreValidation`

## API Endpoints
| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/backup/settings` | Get backup settings |
| `POST` | `/backup/settings` | Save backup settings |
| `POST` | `/backup/backups/manual` | Trigger manual backup |
| `POST` | `/backup/backups/cleanup` | Clean up old backups |
| `GET` | `/backup/backup-restore-requests` | List restore requests |
| Various | `/backup/*` | Additional backup management |

## Key Features

### Backup Settings
- Schedule configuration (cron expression)
- Retention policy (number of backups to keep)
- Backup storage location
- Automatic backup via scheduler (started in `main.py` lifespan)

### Manual Backup
- Trigger immediate backup
- View backup progress and status
- Download backup files

### Restore
- View restore requests
- Create restore request (requires admin approval)
- Execute restore (tracked with User identity via `execute_backup_restore_request()`)

### Cleanup
- Remove old backups based on retention policy
- Free up storage space

### Scheduler
- Started in `main.py` lifespan: `start_backup_scheduler()`
- Runs in background thread
- Executes backup at configured schedule
- Creates `BackupJob` records for each run

## Props
| Prop | Source |
|------|--------|
| `loggedInUser` | App.jsx |

## Permissions
- **View:** View Backup
- **Manage:** Manage Backup

---

## Full-Stack Architecture Diagram — BackupRecovery

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ FRONTEND                          BACKEND (backup_restore.py)          DATA                               │
│                                                                                                            │
│ BackupRecovery     backupApi      backup_restore.py                   BackupSettings                      │
│ ──────────────     ─────────      ────────────────                    ───────────────                     │
│ Backup settings:    getSettings() GET  /backup/settings                id (PK) | Integer                  │
│ schedule (cron),    saveSettings() POST /backup/settings               schedule_cron | String(100)        │
│ retention count,    manualBackup()POST /backup/backups/manual          retention_count | Integer          │
│ storage location    cleanup()     POST /backup/backups/cleanup         storage_path | String(500)         │
│ ─────────────       getRequests() GET  /backup/backup-restore-requests auto_backup_enabled | Boolean      │
│ Manual backup:      ─────────     ────────────────                     last_backup_at | DateTime          │
│ trigger, view       conv:         Perm: ('View/Manage Backup')         ───────────────                     │
│ progress, download  getSettings↔  Audit: module='Backup Restore'                                          │
│ ─────────────       GET /settings ────────────────                     BackupJob                          │
│ Restore: create     manualBackup↔ ────────────────                     ─────────                          │
│ restore request,    POST /backups/ SHARED:                             id, job_type (manual/auto/schedule)│
│ execute restore     manual        main.py: start_backup_scheduler()    status, started_at, completed_at    │
│ ─────────────       ─────────────  runs in background thread           file_path, file_size               │
│ Cleanup: purge old  ─────────────                                       error_message, created_by         │
│ backups             ─────────────                                       ─────────                          │
│                                                                                                            │
│  SCHEDULER FLOW:                         BackupRestoreRequest           BackupRestoreValidation            │
│  main.py on startup → start_backup_     ────────────────────            ────────────────────              │
│   scheduler() → runs cron → creates      id, backup_id, requested_by,   id, request_id, status            │
│   BackupJob records → cleanup on           status (Pending/Approved/    validation_result, validated_by   │
│   retention policy                        Rejected/Executed/Failed),     ────────────────────              │
│                                           executed_at, created_at                                          │
└────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```
