# LocationMaster

## Purpose
Create, update, and manage operational locations. Locations form a hierarchical structure (Company → Region → Terminal → Tank Farm → etc.) and are referenced throughout the system — assets, operations, and reports all depend on locations.

## File Locations
- **Frontend:** `frontend/src/pages/LocationMaster.jsx`
- **API Module:** `frontend/src/api/locationApi.js`
- **Backend Router:** `backend/app/routers/locations.py` (prefix: `/locations`)
- **Model:** `Location` (`backend/app/models.py` line 505)

## API Endpoints
| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/locations` | List all locations |
| `POST` | `/locations` | Create new location |
| `PUT` | `/locations/{id}` | Update location |
| `DELETE` | `/locations/{id}` | Delete location |

## API Request/Response
```json
// Request
{
  "location_name": "Utapate Terminal",
  "location_code": "UTP",
  "location_type": "Terminal",
  "parent_location": "COMPANY",
  "description": "Main oil terminal",
  "status": "Active"
}

// Response
{
  "id": 1,
  "location_name": "Utapate Terminal",
  "location_code": "UTP",
  "location_type": "Terminal",
  "parent_location": "COMPANY",
  "description": "Main oil terminal",
  "status": "Active"
}
```

## Location Types
Company, Region, Terminal, Station, Tank Farm, Jetty, Warehouse, Office, Other

## Validation
- Location Name, Code, and Type are required
- Location Code must be unique
- A location cannot be its own parent
- Parent must be from active locations (excluding self during edit)

## Props
| Prop | Source |
|------|--------|
| `locations` | App.jsx (loaded via locationApi) |
| `reloadLocations` | Callback |

## Permissions
- **View:** View Location
- No explicit Manage Location permission check in the component (assumes authenticated user)

## Dependencies
- Used by: AssetMaster, AssetAssignment, OperationEntry, Dashboard, flowmeter pages, barge tracking, tanker tracking, and all operation pages
- Location data is loaded globally in App.jsx on login
