# VesselOperationMaster

## Purpose
Manage vessel operations (loading, unloading, transfers). Vessels include barges, shuttle tankers, and FSOs that move hydrocarbons between locations.

## File Locations
- **Frontend:** `frontend/src/pages/VesselOperationMaster.jsx`
- **API Module:** `frontend/src/api/vesselOperationApi.js`
- **Backend Router:** `backend/app/routers/vessel_operations.py` (prefix: `/vessel-operations`)
- **Models:** `VesselOperation`, `ShuttleVoyage`, `FSOVoyage`

## API Endpoints
| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/vessel-operations` | List vessel operations |
| `POST` | `/vessel-operations` | Create vessel operation |
| `PUT` | `/vessel-operations/{id}` | Update vessel operation |
| `DELETE` | `/vessel-operations/{id}` | Delete vessel operation |

## Props
| Prop | Source |
|------|--------|
| `locations` | App.jsx |
| `assetTypes` | App.jsx |

## Permissions
- **View:** View Vessel Operation

## Dependencies
- Connected to ShuttleTracking and FSOTracking for detailed tracking
- Vessel operations use vessel assets defined in AssetMaster
