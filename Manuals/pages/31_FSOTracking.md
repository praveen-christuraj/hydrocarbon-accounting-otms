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

---

## Full-Stack Architecture Diagram — FSOTracking

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ FRONTEND                         BACKEND                          DATA                                     │
│                                                                                                            │
│ FSOTracking       fsoTrackApi     shuttle_fso_voyages.py       FSOVoyage                                  │
│ ───────────       ────────────    ──────────────────────        ─────────                                   │
│ Props:             closeFsoVoy()  POST /shuttle-fso/fso-        id (PK) | Integer                          │
│  loggedInUser       reopenFsoVoy() voyages/close                voyage_number | String(100)                │
│ ───────────       ────────────   ──────────────────────         fso_asset_code | String(50)                 │
│ FSO inventory      conv:          POST /shuttle-fso/fso-        location_code | String(50)                  │
│ FSO→shuttle         closeFsoVoy↔   voyages/reopen               status (OPEN/CLOSED)                       │
│ transfers           POST /shuttle- ─────────────────────        start_date | DateTime                      │
│ Stock ledger        fso/fso-      Perm: ('View FSO              end_date | DateTime                        │
│ Report gen          voyages/close  Tracking')                    closing_inventory_bbl | Float              │
│ (incl. Excel)      ────────────   Audit: module='FSO            created_by | String                        │
│ ───────────        ────────────    Voyage'                      ─────────                                   │
│                     fsoReportApi ─────────────────────                                                    │
│                     ────────────  SHARED:                       VesselStockLedger                          │
│                     getFsoReport()  operation_transactions.py    ────────────────                          │
│                     downloadFso     auto-creates VesselStock-    transaction_id (FK→OpTxn)                │
│                     ReportXlsx()    Ledger entries on APPROVE   vessel_asset_code | String                 │
│                                      ─────────────────────       tank_number | String                       │
│                     conv:                                        before/after_volume | Float                │
│                     getFsoReport↔  Reports app:                  volume_change | Float                     │
│                     GET /shuttle-   GET /shuttle-fso/fso/report  before/after_mass | Float                  │
│                     fso/fso/report  GET /shuttle-fso/fso/        mass_change | Float                        │
│                     downloadFsoRpt   report/xlsx                 operation_date | Date                     │
│                     ↔ GET /shuttle- ─────────────────────        created_by | String                       │
│                     fso/fso/report                                                                         │
│                     /xlsx          ─────────────────────                                                    │
│                                                                                                            │
│  FSO VESSEL LIFECYCLE:                                                                                    │
│  Production → FSO storage → Shuttle loading (OpTransaction Approved) →                                    │
│    → VesselStockLedger updated → FSO→Shuttle transfer → FSOVoyage → CLOSED                                │
└────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```
