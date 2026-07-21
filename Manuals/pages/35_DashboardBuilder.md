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

---

## Full-Stack Architecture Diagram — DashboardBuilder

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ FRONTEND                          BACKEND                        DATA                                    │
│                                                                                                          │
│ DashboardBuilder  dashboardApi    dashboard.py                   DashboardConfig                        │
│ ────────────────  ────────────    ────────────                   ───────────────                        │
│ Create/edit       getConfigs()    GET /dashboard/configs         id (PK) | Integer                      │
│ dashboards:        createConfig() POST /dashboard/configs        config_name | String(150)              │
│ name, description, updateConfig() PUT /dashboard/configs/{id}    description | Text?                     │
│ add/remove         deleteConfig() DELETE /dashboard/configs/{id} widget_defs | JSONB                    │
│ widgets,           publishConfig() POST /dashboard/configs/{id}/  (widget type, data source, params)    │
│ arrange layout     revertConfig()   publish                       layout_json | JSONB (grid positions)  │
│                    ────────────   POST /dashboard/configs/{id}/   status (Draft/Published)              │
│ Widget config:      conv:           revert                        version_no | Integer                  │
│ type (CHART/KPI/   getConfigs↔    ─────────────                  published_version_no | Integer         │
│ TABLE), data        GET /configs  Perm: ('Manage Dashboard')     created_by | String                    │
│ source, params      createConfig↔ Audit: module='Dashboard'      ───────────────                        │
│                     POST /configs ─────────────                                                          │
│ Draft vs Published                                                                                      │
│ versioning                                                                                              │
│                                                                                                          │
│  WORKFLOW:                                                                                               │
│  Draft config → Add widgets → Set layout → Publish →                                                    │
│  Active dashboard shows published version →                                                              │
│  Edit creates new draft → Publish overwrites published version                                           │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```
