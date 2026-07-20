# AssetTypeMaster

## Purpose
Create and manage asset type classifications. Asset types categorize assets (e.g., Tank, Pump, Meter, Vehicle, Vessel) and are used as a basis for calibration templates.

## File Locations
- **Frontend:** `frontend/src/pages/AssetTypeMaster.jsx`
- **API Module:** `frontend/src/api/assetTypeApi.js`
- **Backend Router:** `backend/app/routers/asset_types.py` (prefix: `/asset-types`)
- **Model:** `AssetType`

## API Endpoints
| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/asset-types` | List all asset types |
| `POST` | `/asset-types` | Create new asset type |
| `PUT` | `/asset-types/{id}` | Update asset type |
| `DELETE` | `/asset-types/{id}` | Delete asset type |

## API Request/Response
```json
{ "asset_type_name": "Storage Tank", "description": "Fixed roof storage tank", "status": "Active" }
```

## Props
| Prop | Source |
|------|--------|
| `assetTypes` | App.jsx |
| `setAssetTypes` | State setter |
| `reloadAssetTypes` | Callback |
| `loggedInUser` | Permission checking |

## Permissions
- **View:** View Asset Type
- **Manage:** Manage Asset Type
