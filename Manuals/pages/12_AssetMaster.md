# AssetMaster

## Purpose
Create and manage physical assets (tanks, pumps, meters, vehicles, vessels, etc.). Assets are assigned to locations and have specific types. They are referenced by operations, calibration tables, assignments, and tracking pages.

## File Locations
- **Frontend:** `frontend/src/pages/AssetMaster.jsx`
- **API Module:** `frontend/src/api/assetApi.js`
- **Backend Router:** `backend/app/routers/assets.py` (prefix: `/assets`)
- **Model:** `Asset` (`backend/app/models.py` line 557) — **292 edges in graph, connected to every domain**

## API Endpoints
| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/assets` | List all assets |
| `POST` | `/assets` | Create new asset |
| `PUT` | `/assets/{id}` | Update asset |
| `DELETE` | `/assets/{id}` | Delete asset |

## API Request/Response
```json
// Request
{
  "asset_name": "Crude Tank T-101",
  "asset_code": "T-101",
  "asset_type_id": 1,
  "location_id": 1,
  "capacity": 50000,
  "unit": "BBL",
  "status": "Active"
}

// Response
{ "id": 1, "asset_name": "Crude Tank T-101", "asset_code": "T-101", "asset_type_id": 1, "location_id": 1, "capacity": 50000, "unit": "BBL", "status": "Active" }
```

## Key Connections
- Asset → AssetType (classification)
- Asset → Location (physical location)
- Asset → AssetAssignment (assigned to users)
- Asset → AssetCalibrationTable (calibration data)
- Asset → CalibrationTemplate (template reference)
- Asset → TankOperation, VesselOperation (operations use assets)
- Asset → BargeSealMaster, PrimeMoverTankerLink (tracking uses assets)
- Asset → FlowmeterConfig (flowmeters are assets)
- Asset → Dashboard data sources

## Props
| Prop | Source |
|------|--------|
| `assets` | App.jsx |
| `setAssets` | App.jsx |
| `reloadAssets` | App.jsx |
| `assetTypes` | App.jsx |
| `locations` | App.jsx |
| `loggedInUser` | App.jsx |

## Permissions
- **View:** View Asset
- **Manage:** Manage Asset
