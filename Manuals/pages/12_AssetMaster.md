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

---

## Full-Stack Architecture Diagram — AssetMaster

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│   FRONTEND LAYER                                                                                     │
│                                                                                                      │
│  AssetMaster.jsx          assetApi.js                  apiClient.js                                  │
│  ──────────────           ──────────                   ────────────                                  │
│  Props: assets[],         getAssets(params)            fetch() + Bearer JWT                          │
│         setAssets(),      createAsset(data)            apiGet('/assets?skip=0&limit=200')            │
│         reloadAssets(),   updateAsset(id, data)        apiPost('/assets', body)                      │
│         assetTypes[]      deleteAsset(id)              apiPut('/assets/{id}', body)                  │
│         locations[]        ──────────                   apiDelete('/assets/{id}')                    │
│         loggedInUser      assetName ↔ asset_name        ────────────                                  │
│                           assetCode ↔ asset_code       Auto-refresh on 401                           │
│  Fields: name, code,      assetScope ↔ asset_scope                                                   │
│  scope (Local/Global),    assetTypeCode ↔ asset_type                                                 │
│  type, location (Local),  locationCode ↔ location_code                                               │
│  serial, manufacturer,    serialNumber ↔ serial_number                                                │
│  model, commission date,  manufacturer ↔ manufacturer                                                │
│  description, status      model ↔ model                                                              │
└──────────────────────────────────────────────────────────────────────┬───────────────────────────────┘
                                                                       │
┌──────────────────────────────────────────────────────────────────────┴───────────────────────────────┐
│   BACKEND LAYER                                                                                      │
│                                                                                                      │
│  assets.py (prefix: /assets)                                                                         │
│  ─────────────────────────                                                                           │
│  GET    /assets?skip=0&limit=200&search=&asset_type_code=&location_code=                             │
│           ├─ Perm: require_user_permission('View Asset')                                             │
│           ├─ Query: Asset.order_by(id) + optional filters                                            │
│           └─ Paginated: { items: [AssetResponse], total, has_more }                                 │
│                                                                                                      │
│  POST   /assets                                                                                      │
│           ├─ Schema: AssetCreate (asset_name, asset_code, asset_scope, asset_type_code, ...)        │
│           ├─ Perm: require_user_permission('Manage Asset')                                           │
│           ├─ Validates: unique code, asset_type exists, scope='Local'→location exists+Active        │
│           ├─ Audit: create_audit_log('Asset Master', 'Create Asset')                                │
│           └─ Return: AssetResponse                                                                   │
│                                                                                                      │
│  PUT    /assets/{id}   (same validation as create)                                                   │
│  DELETE /assets/{id}   (blocks if calibration/assignment/flowmeter exists)                          │
│                                                                                                      │
│  Audit: module_name = 'Asset Master', actions: Create/Update/Delete Asset                            │
└────────────────────────────────────────┬─────────────────────────────────────────────────────────────┘
                                         │
┌────────────────────────────────────────┴─────────────────────────────────────────────────────────────┐
│   DATA LAYER                                                                                          │
│                                                                                                      │
│  Asset (assets)                                                                                      │
│  ──────────────                                                                                      │
│  COLUMN            │ TYPE         │ CONSTRAINTS    │ CONNECTS TO                                    │
│────────────────────┼──────────────┼────────────────┼────────────────────────────────────────────────│
│ id                 │ Integer      │ PK, INDEX      │ (primary)                                      │
│ asset_name         │ String(150)  │ NOT NULL       │                                                │
│ asset_code         │ String(80)   │ UNIQUE, IX     │ FK target for: CalibrationTable, Assignment,    │
│                    │              │                │   FlowmeterConfig, OperationTransaction,         │
│                    │              │                │   BargeSealMaster, TripEvent, TankStockLedger  │
│ asset_scope        │ String(20)   │ NOT NULL       │ Local / Global                                 │
│ asset_type_code    │ String(50)   │ NOT NULL       │ FK → asset_types.asset_type_code               │
│ location_code      │ String(50)   │ NULLABLE       │ FK → locations.location_code (for Local)       │
│ serial_number      │ String(100)  │ NULLABLE       │                                                │
│ manufacturer       │ String(150)  │ NULLABLE       │                                                │
│ model              │ String(150)  │ NULLABLE       │                                                │
│ commission_date    │ Date         │ NULLABLE       │                                                │
│ description        │ Text         │ NULLABLE       │                                                │
│ status             │ String(20)   │ NOT NULL       │ Active / Inactive / Decommissioned             │
│ created_at         │ DateTime     │ server_default │                                                │
│ updated_at         │ DateTime     │ server_default │                                                │
│────────────────────┴──────────────┴────────────────┴────────────────────────────────────────────────│
│                                                                                                      │
│  Entity Relationship (Asset is central to operations):                                             │
│                                                                                                      │
│    AssetType ───────┐                                                                               │
│    Location ────────┤                                                                               │
│                     │                                                                               │
│    AssetCalibTbl ───┤── asset_code ──▶ Asset ◀── asset_code ── CalibrationTemplate                 │
│    AssetAssignment ─┘                   │                                                           │
│    FlowmeterConfig ─────────────────────┤                                                           │
│    OperationTransaction ────────────────┤── primary_asset_code                                      │
│    PrimeMoverTankerLink ────────────────┤── prime_mover/tanker asset code                          │
│    BargeSealMaster ─────────────────────┤── asset_code                                              │
│    TripEvent ───────────────────────────┤── asset_code                                              │
│    TankStockLedger ─────────────────────┤── tank_asset_code                                        │
│    TankerReceiptAcknowledgement ────────┤── tanker/prime_mover asset code                          │
│    OperationTask ───────────────────────┤── primary_asset_code                                     │
│    ... and more                         │                                                           │
│                                         │                                                           │
│  DB: PostgreSQL → Table: assets                                                                     │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
```
