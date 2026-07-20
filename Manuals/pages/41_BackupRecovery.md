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
