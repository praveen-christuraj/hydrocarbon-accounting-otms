# AssetCalibrationTable

## Purpose
Manage calibration data tables for specific assets. Each asset can have calibration data based on a template — this includes tank strapping tables, meter factors, and other calibration coefficients used in volume calculations.

## File Locations
- **Frontend:** `frontend/src/pages/AssetCalibrationTable.jsx`
- **API Module:** `frontend/src/api/assetCalibrationApi.js`
- **Backend Router:** `backend/app/routers/asset_calibration_tables.py` (prefix: `/asset-calibration-tables`)
- **Model:** `AssetCalibrationTable`

## API Endpoints
| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/asset-calibration-tables` | List all calibration tables |
| `POST` | `/asset-calibration-tables` | Create calibration table entry |
| `PUT` | `/asset-calibration-tables/{id}` | Update calibration entry |
| `DELETE` | `/asset-calibration-tables/{id}` | Delete calibration entry |

## Key Features
- Select asset + template → loads matching calibration data
- Enter calibration points (e.g., dip → volume mappings for tank strapping)
- Supports Table 11 factors for volume correction

## Props
| Prop | Source |
|------|--------|
| `assets` | App.jsx |
| `calibrationTemplates` | App.jsx |
| `calibrationTables` | App.jsx |
| `setCalibrationTables` | App.jsx |
| `reloadAssetCalibrationTables` | App.jsx |
| `loggedInUser` | App.jsx |

## Permissions
- **View:** View Asset Calibration
- **Manage:** Manage Asset Calibration

## Downstream Dependencies
Calibration data feeds into:
- Tank gauging calculations in OperationEntry
- Material balance report calculations
- OutTurn report calculations
- Tank stock ledger valuations

---

## Full-Stack Architecture Diagram — AssetCalibrationTable

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│ FRONTEND                              BACKEND                              DATA                  │
│                                                                                                  │
│ AssetCalibTable       assetCalibApi    asset_calib_tables.py    AssetCalibrationTable            │
│ ──────────────────    ─────────────    ─────────────────────     ─────────────────────            │
│ Props: assets[],      getTables()      GET  /asset-calib-tables  id (PK)        │ Integer        │
│        calibTemplates createTable()    POST /asset-calib-tables  calib_name     │ String(150)    │
│        calibTables[]  updateTable()    PUT  /asset-calib-tables/ asset_code     │ String(80)     │
│        reloadTables() deleteTable()    DELETE /asset-calib-tables template_id   │ FK → CT.id     │
│        loggedInUser    ─────────────    /{id}                      effective_date│ Date           │
│                        calibName↔      ─────────────               remarks      │ Text?          │
│  Select Asset +        calib_name       Perm: ('View/Manage       status        │ String(20)     │
│  Template → loads      assetCode↔        Asset Calibration')       ─────────────────────         │
│  calibration data      asset_code       Validates: template                  │                  │
│                        templateId↔        exists                   CalibrationData (child)       │
│  Enter data rows       template_id      Audit: module='Asset       id (PK)   │ Integer          │
│  for each column                         Calibration'              calib_tbl_id│FK → ACT.id      │
│  defined in template                     ─────────────              row_number │ Integer          │
│                                          Data rows stored as       row_data   │ JSONB           │
│                                          JSONB for flexibility     UNIQUE(table_id, row_number)   │
│                                                                                                  │
│  RELATIONSHIP: Template defines columns → CalibTable instantiates → CalibData stores row_values  │
│  DOWNSTREAM: Tank gauging (OperationEntry) uses interpolation against CalibrationData            │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```
