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

---

## Full-Stack Architecture Diagram — BargeSealMaster

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ FRONTEND                        BACKEND                        DATA                                  │
│                                                                                                      │
│ BargeSealMaster   bargeSealApi   barge_seal_master.py         BargeSealMaster                       │
│ ────────────────   ────────────  ──────────────────────       ───────────────                       │
│ Props: assets[],   bulkUpdate()  POST /barge-seal-master/     id (PK) | Integer                     │
│        assetCalib  ─────────────  bulk                         barge_asset_code | String(50)       │
│        Tables[],   conv:         ────────────────              compartment | String(50)              │
│        calibration bulkUpdate↔    (Bulk create/update)         seal_type (MANIFOLD/HATCH)           │
│        Templates[], POST /barge- ────────────────              seal_number | String(100)            │
│        loggedInUser  seal-master  Perm: ('View Barge Seal      is_master | Boolean                  │
│                      /bulk        Master')                     status | String(20)                  │
│  Manage seal                     Audit: module='Barge Seal    installed_at | DateTime               │
│  numbers per                      Master'                     ───────────────                       │
│  barge/compartment,              ────────────────                                                  │
│  bulk import/update                                          USED BY: BargeTracking (seal           │
│  master seal numbers                                          verification during Trip lifecycle)   │
│  for verification                                                               BargeSealMaster     │
│                                                                                 ───────────────     │
│  DATA FLOW:                                                                                         │
│  BargeSealMaster stores reference seals → BargeTracking compares observed                           │
│  seals (from TripEvent) against master seal numbers for mismatch detection                         │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
```
