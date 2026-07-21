# SystemNotificationMaster

## Purpose
Create and manage system notifications. Notifications can be targeted to specific users, roles, or locations. Users can acknowledge/dismiss notifications via the notification center.

## File Locations
- **Frontend:** `frontend/src/pages/SystemNotificationMaster.jsx`
- **API Module:** `frontend/src/api/systemNotificationApi.js`
- **Backend Router:** `backend/app/routers/system_notifications.py` (prefix: `/system-notifications`)
- **Models:** `SystemNotification`, `SystemNotificationReceipt`

## API Endpoints
| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/system-notifications` | List all notifications |
| `POST` | `/system-notifications` | Create notification |
| `PUT` | `/system-notifications/{id}` | Update notification |
| `DELETE` | `/system-notifications/{id}` | Delete notification |
| `GET` | `/system-notifications/active` | Get active (current) notifications |
| `GET` | `/system-notifications/my` | Get notifications for current user |

## Key Features
- Create notifications with title, message, severity
- Target by: all users, specific role, specific user, specific location
- Set active date range (planned start/end)
- Auto-dismissal based on expiry
- Receipt tracking (who has acknowledged)

## Notification Center Integration
- `SystemNotificationCenter` component (in `components/`) renders in `App.jsx`
- Shows unacknowledged notifications for the current user
- Users can acknowledge/dismiss

## Props
| Prop | Source |
|------|--------|
| `roles` | App.jsx |
| `users` | App.jsx |
| `locations` | App.jsx |

## Permissions
- **View:** View System Notification
- **Manage:** Manage System Notification

---

## Full-Stack Architecture Diagram — SystemNotificationMaster

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ FRONTEND                          BACKEND                            DATA                                    │
│                                                                                                             │
│ SystemNotificationMaster  notifApi   system_notifications.py       SystemNotification                      │
│ ────────────────────────  ────────   ──────────────────────────    ─────────────────                         │
│ Props: roles[],           list()     GET /system-notifications     id (PK) | Integer                        │
│        users[],           create()   POST /system-notifications    title | String(200)                      │
│        locations[]        update()   PUT /system-notifications/    message | Text                           │
│                          delete()     {id}                         severity (Info/Warning/Error/Critical)   │
│ Create/edit form:         active()   DELETE /system-notifications/  target_type (All/Role/User/Location)    │
│ title, message,            my()        {id}                         target_ids_json | JSONB                 │
| severity, target          ─────────  GET /system-notifications/     start_datetime | DateTime               │
│ (All/Role/User/           conv:        active                        end_datetime | DateTime                 │
│ Location), date           list()↔    GET /system-notifications/my  is_acknowledgement_required | Boolean    │
│ range                    GET /notifs ─────────────                   status (Active/Expired/Draft)           │
│                           create()↔  Perm: ('View/Mng System        created_by | String                     │
│ Notification Center:      POST /notifs Notif')                       created_at | DateTime                   │
│ SystemNotificationCenter  active()↔  Audit: module='System Notif'  ─────────────────                         │
│ component in App.jsx      GET /notifs ─────────────                                                          │
│ shows unacknowledged       /active                                                                           │
│ notifications for user   my()↔      ─────────────                    SystemNotificationReceipt               │
│                           GET /notifs                                 ──────────────────────                 │
│ Users acknowledge/         /my                                                                              │
│ dismiss via receipt                                               │ notification_id (FK)                    │
│                                                                      user_id (FK→User)                      │
│                                                                      acknowledged_at | DateTime              │
│                                                                      dismissed_at | DateTime                 │
│                                                                      ──────────────────────                  │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```
