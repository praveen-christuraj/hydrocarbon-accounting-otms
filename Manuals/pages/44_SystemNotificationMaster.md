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
