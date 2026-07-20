# DashboardBuilder

## Purpose
Create and edit dashboard configurations. Users can define custom dashboards by selecting data sources, configuring widget types, and arranging layout.

## File Locations
- **Frontend:** `frontend/src/pages/DashboardBuilder.jsx`
- **API Modules:** `dashboardApi.js`, `dashboardDataApi.js`
- **Backend Router:** `dashboard.py` (prefix: `/dashboard`)

## API Endpoints
| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/dashboard/configs` | List dashboard configs |
| `POST` | `/dashboard/configs` | Create dashboard config |
| `PUT` | `/dashboard/configs/{id}` | Update dashboard config |
| `DELETE` | `/dashboard/configs/{id}` | Delete dashboard config |
| `POST` | `/dashboard/configs/{id}/publish` | Publish dashboard |
| `POST` | `/dashboard/configs/{id}/revert` | Revert to published version |

## Key Features
- Create new dashboards with name and description
- Add/remove widgets with specific data sources
- Configure widget parameters
- Drag-and-drop layout arrangement
- Version management (draft vs published)
- Publish/revert workflow

## Props
| Prop | Source |
|------|--------|
| `loggedInUser` | App.jsx |

## Permissions
- **View:** View Dashboard
- **Manage:** Manage Dashboard
