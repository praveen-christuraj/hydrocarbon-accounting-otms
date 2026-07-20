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
