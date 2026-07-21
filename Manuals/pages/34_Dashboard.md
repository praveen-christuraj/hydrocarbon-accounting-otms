# Dashboard

## Purpose
Interactive data dashboard with customizable grid layout and ECharts visualizations. Users can add, arrange, and configure chart widgets that display data from various data sources.

## File Locations
- **Frontend:** `frontend/src/pages/Dashboard.jsx` (973 lines)
- **API Modules:** `dashboardApi.js`, `dashboardDataApi.js`
- **Backend Routers:** `dashboard.py` (prefix: `/dashboard`)

## API Endpoints Used
| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/dashboard/configs` | Get dashboard configurations |
| `GET` | `/dashboard/configs/{id}` | Get specific dashboard |
| `GET` | `/dashboard/data` | Fetch widget data from data sources |

## Key Features

### Layout Management
- React-Grid-Layout with drag-and-drop
- WidthProvider for responsive resizing
- Widget positions saved per dashboard config

### Data Sources
- `listDashboardDataSources()` — GET available data sources with parameter schemas
- `fetchDashboardData()` — POST to execute a data source query
- Widgets resolve parameters including `{{location_code}}` template variables

### Widget Types
- Various ECharts visualizations (bar, line, pie, etc.)
- KPI/value cards with formatting
- Parameterized data queries with validation

### Caching
- Cache key built from `dataSourceCode::serializedParams`
- Prevents redundant API calls for the same data

## Parameter Resolution
```javascript
// Widget params can reference:
'$location_code' → resolves to selectedLocationCode
'{{location_code}}' → resolves to selectedLocationCode
```

## State Management
| State | Purpose |
|-------|---------|
| `dashboardConfigs` | Available dashboard configs |
| `selectedConfig` | Currently active dashboard |
| `widgets` | Widget definitions |
| `widgetLayouts` | Widget positions on grid |
| `widgetData` | Cached data per widget |

## Props
| Prop | Source |
|------|--------|
| `loggedInUser` | App.jsx |

## Permissions
- **View:** View Dashboard

---

## Full-Stack Architecture Diagram — Dashboard

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ FRONTEND (React)                            BACKEND (FastAPI)           DATA                             │
│                                                                                                          │
│ Dashboard (973 lines)                        dashboard.py                DashboardConfig                 │
│ ─────────────────────                       ────────────                ───────────────                  │
│                                                                                                          │
│  ┌─ Grid Layout ───────────────┐            GET /dashboard/configs      id (PK) | Integer               │
│  │ React-Grid-Layout           │            GET /dashboard/configs/{id}  config_name | String(150)       │
│  │ Drag-and-drop widgets       │            GET /dashboard/data         description | Text?              │
│  │ Responsive WidthProvider    │            POST /dashboard/configs     widget_defs | JSONB              │
│  └────────────────────────────┘            PUT /dashboard/configs/{id}   (array of widget configs)       │
│                                             DELETE /dashboard/configs/  layout_json | JSONB              │
│  ┌─ Widget Types ─────────────┐             {id}                         (grid positions)                │
│  │ ECharts: bar/line/pie/etc  │            POST /dashboard/configs/    status (Draft/Published)         │
│  │ KPI value cards            │             {id}/publish                created_by | String              │
│  │ Custom param queries       │            POST /dashboard/configs/     created_at | DateTime            │
│  └────────────────────────────┘             {id}/revert                 published_at | DateTime?         │
│                                             ─────────────               ───────────────                  │
│  ┌─ Data Caching ────────────┐             Perm: ('View Dashboard',                                   │
│  │ Cache key: dataSource_    │              'Manage Dashboard')         DashboardWidgetSettings          │
│  │  Code::serializedParams   │             Audit: module='Dashboard'    ────────────────────             │
│  │ Prevents redundant API    │             ─────────────                 widget_type (CHART/KPI/TABLE)  │
│  │  calls                    │                                           data_source_code | String       │
│  └────────────────────────────┘             ─────────────                param_json | JSONB              │
│                                              conv:                      ────────────────────             │
│  ┌─ Parameter Resolution ───┐              getDashboardConfigs↔                                          │
│  │ $location_code → resolves│              GET /dashboard/configs                                        │
│  │ {{location_code}} → same │              fetchDashboardData↔                                           │
│  └──────────────────────────┘              POST /dashboard/data                                           │
│                                                                                                          │
│  ┌─ Widget State ───────────┐                                                                           │
│  │ dashboardConfigs[]       │                                                                           │
│  │ selectedConfig           │      DATA FLOW:                                                           │
│  │ widgets[]                │      Dashboard loads config → renders widgets →                            │
│  │ widgetLayouts (grid pos) │      each widget calls fetchDashboardData →                               │
│  │ widgetData (cache Map)   │       resolves params → executes data source →                            │
│  └──────────────────────────┘       returns data → ECharts renders chart                                │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```
