# ShuttleTracking

## Purpose
Track shuttle tanker operations — loading at FSO/FPSO, transit, and unloading at discharge port. Shuttles are a specific type of vessel operation with their own lifecycle.

## File Locations
- **Frontend:** `frontend/src/pages/ShuttleTracking.jsx`
- **API Modules:** `shuttleTrackingApi.js`, `operationEntryApi.js`, `vesselOperationApi.js`
- **Backend Router:** `backend/app/routers/shuttle_fso_voyages.py` (prefix: `/shuttle-fso`)
- **Models:** `ShuttleVoyage`, `FSOVoyage`

## API Endpoints
| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/shuttle-fso/shuttle-voyages/close` | Close a shuttle voyage |
| `POST` | `/shuttle-fso/shuttle-voyages/reopen` | Reopen a closed voyage |

## Key Features
- View shuttle voyages (voyage list, details)
- Track voyage lifecycle
- Close/reopen voyages as needed
- Integration with operation transactions for cargo data

## Props
| Prop | Source |
|------|--------|
| `loggedInUser` | App.jsx |

## Permissions
- **View:** View Shuttle Tracking
- **Manage:** Manage Shuttle Tracking
