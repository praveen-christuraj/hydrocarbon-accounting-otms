# BargeSealMaster

## Purpose
Manage barge seal records. This is a reference data page for the seal numbers used on barge manifolds and tank hatches. Seal numbers are verified during barge tracking to detect tampering.

## File Locations
- **Frontend:** `frontend/src/pages/BargeSealMaster.jsx`
- **API Module:** `frontend/src/api/bargeSealApi.js`
- **Backend Router:** `backend/app/routers/barge_seal_master.py` (prefix: `/barge-seal-master`)
- **Model:** `BargeSealMaster`

## API Endpoints
| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/barge-seal-master/bulk` | Bulk create/update seals |

## Key Features
- Manage seal numbers for each barge/compartment
- Bulk import/update seals
- Integration with BargeTracking for seal verification during trips
- Master seal numbers compared against observed seals

## Props
| Prop | Source |
|------|--------|
| `assets` | App.jsx |
| `assetCalibrationTables` | App.jsx |
| `calibrationTemplates` | App.jsx |
| `loggedInUser` | App.jsx |

## Permissions
- **View:** View Barge Seal Master
