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

---

## Full-Stack Architecture Diagram — AssetTypeMaster

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│   FRONTEND                            BACKEND                          DATA LAYER      │
│                                                                                        │
│  AssetTypeMaster    assetTypeApi       asset_types.py       AssetType (asset_types)    │
│  ────────────────   ──────────────     ──────────────       ───────────────────────    │
│  Props: assetTypes  getAssetTypes()    GET  /asset-types    id (PK)       │ Integer     │
│         setAT()     createAssetType()  POST /asset-types    asset_type_name│String(150) │
│         reloadAT()  updateAssetType()  PUT  /asset-types/id asset_type_code│String(50)  │
│         loggedInUsr deleteAssetType()  DELETE /asset-typ/id  description   │ Text?      │
│                                        ──────────────       status        │ String(20) │
│  Form: name, code,  conv:              require_permission   created_at    │ DateTime   │
│  description, status assetTypeName ↔   ('View/Manage AT')   updated_at    │ DateTime   │
│                      asset_type_name   unique check code   UNIQUE(asset_type_code)      │
│                      assetTypeCode ↔   on create/update    ───────────────────────       │
│                      asset_type_code   block if used on    Used by: Asset, Calibration   │
│                                        delete              Template, OperationType, etc  │
│                                        Audit: module='AT'  FK: Asset.asset_type_code     │
└────────────────────────────────────────────────────────────────────────────────────────┘
```
