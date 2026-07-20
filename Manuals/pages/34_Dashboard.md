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
