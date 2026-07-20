# FSOTracking

## Purpose
Track Floating Storage and Offloading (FSO) vessel operations. FSOs are stationary storage vessels that serve as intermediate storage between production and shuttle tankers.

## File Locations
- **Frontend:** `frontend/src/pages/FSOTracking.jsx`
- **API Modules:** `fsoReportApi.js`, `fsoTrackingApi.js`
- **Backend Router:** `backend/app/routers/shuttle_fso_voyages.py` (prefix: `/shuttle-fso`)
- **Models:** `FSOVoyage`, `VesselStockLedger`, `ShuttleVoyage`

## API Endpoints
| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/shuttle-fso/fso-voyages/close` | Close FSO voyage |
| `POST` | `/shuttle-fso/fso-voyages/reopen` | Reopen FSO voyage |
| `GET` | `/shuttle-fso/fso/report` | FSO report data |
| `GET` | `/shuttle-fso/fso/report/xlsx` | Download FSO report as Excel |

## Key Features
- FSO inventory tracking
- FSO-to-shuttle transfer management
- Stock ledger for FSO
- FSO report generation (including Excel download)
- Integration with shuttle tanker operations

## Props
| Prop | Source |
|------|--------|
| `loggedInUser` | App.jsx |

## Permissions
- **View:** View FSO Tracking
