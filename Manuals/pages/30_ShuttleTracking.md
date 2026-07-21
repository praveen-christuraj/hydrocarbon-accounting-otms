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

---

## Full-Stack Architecture Diagram — ShuttleTracking

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ FRONTEND                        BACKEND                         DATA                                 │
│                                                                                                      │
│ ShuttleTracking  shuttleTrackApi  shuttle_fso_voyages.py      ShuttleVoyage                         │
│ ───────────────  ───────────────  ──────────────────────       ─────────────                         │
│ Props:            closeVoyage()   POST /shuttle-fso/           id (PK) | Integer                     │
│  loggedInUser     reopenVoyage()   shuttle-voyages/close       voyage_number | String(100)           │
│ ───────────────  ───────────────  ──────────────────────       convoy_number | String(100)           │
│ Views:            conv:           POST /shuttle-fso/           shuttle_asset_code | String(50)       │
│ voyage list,      closeVoyage↔     shuttle-voyages/reopen     location_code | String(50)            │
│ voyage details    POST /shuttle- ──────────────────────        status (OPEN/CLOSED)                  │
│ Close/reopen      fso/shuttle-   Perm: ('View/Manage           created_by | String                   │
│ voyage lifecycle   voyages/close   Shuttle Tracking')          created_at | DateTime                 │
│                   reopenVoyage↔  Audit: module='Shuttle        ─────────────                         │
│ Integration with   POST /shuttle-  Voyage'                                                          │
│ OperationTxn       fso/shuttle-  ──────────────────────        REFERENCED BY:                        │
│ for cargo data     voyages/                                                                          │
│                    reopen         SHARED:                       OperationTransaction                  │
│                                   operation_transactions.py     (via convoy_number lookup)           │
│                                   auto-creates ShuttleVoyage   VesselStockLedger                     │
│                                   when ShuttleTracking op       (stock movements during voyage)      │
│                                   is APPROVED (from PATCH      ──────────────────────                 │
│                                   /{id}/status → get_or_                                            │
│                                   create_shuttle_voyage())                                          │
│                                                                                                      │
│  SHUTTLE VESSEL LIFECYCLE:                                                                          │
│  FSO Loading → OpTransaction(Approved) → ShuttleVoyage auto-created →                                │
│  Shuttle transits → Unload at discharge port → ShuttleVoyage → CLOSED                                │
│  (close/reopen via this page)                                                                        │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
```
