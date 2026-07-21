# OutTurnReport

## Purpose
Generate out-turn reports — comparing expected vs actual quantities for hydrocarbon movements. Out-turn (also called "loss control") reports are critical for identifying discrepancies between loaded and received quantities.

## File Locations
- **Frontend:** `frontend/src/pages/OutTurnReport.jsx`
- **API Module:** `frontend/src/api/outTurnReportApi.js`
- **Backend Router:** `backend/app/routers/reports.py` (prefix: `/reports`)

## API Endpoints
| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/reports/out-turn-report` | Get out-turn report data |

## Key Features
- Filter by date range, location, operation type
- Compare bill of lading (BOL) quantities vs received quantities
- Calculate loss/gain percentages
- Export to Excel/CSV

## Business Logic
- Uses `build_mapping_response()` and `recompute_mapping_comparison()` from `reports.py`
- References calibration data for volume corrections (temperature, density, VCF)
- Applies Table 11 factors for weight calculations

## Props
| Prop | Source |
|------|--------|
| `loggedInUser` | App.jsx |

## Permissions
- **View:** View Reports

---

## Full-Stack Architecture Diagram — OutTurnReport

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ FRONTEND                          BACKEND (reports.py)                   DATA                            │
│                                                                                                          │
│ OutTurnReport     outTurnRptApi    reports.py                           MovementMapping                │
│ ───────────────   ──────────────   ─────────                             ───────────────                 │
│ Props:            getReport()     GET /reports/out-turn-report           id (PK) | Integer               │
│  loggedInUser     ──────────────   ?date_from=&date_to=                  mapping_name | String(150)     │
│ ──────────────    conv:            &location_code=&op_type=              location_code | String          │
│ Filters: date     getReport↔     ─────────────                           period_from | Date              │
│ range, location,  GET /reports/   Perm: ('View Reports')                 period_to | Date                │
│ op type           out-turn-report Audit: module='Reports'                status | String                 │
│                    ────────────── ─────────────                                                           │
│ Shows:             SHARED                                                  MovementMappingItem            │
│ BOL qty vs         build_mapping_response()                              ────────────────────            │
│ Received qty       recompute_mapping_comparison()                         mapping_id (FK)                │
│ Loss/Gain %        (also used by MovementMapping page)                    role (SOURCE/TARGET)           │
│                    ─────────────                                           asset_code | String            │
│ USES:               Queries: MovementMapping +                                                            │
│ MovementMapping     MovementMappingItem → compares                         qty_bbl | Float                │
│ data to compute     SOURCE vs TARGET rows                                 water_bbl | Float              │
│ out-turn values    ─────────────                                           nsv_bbl | Float                │
│                     Also reads: TankStockLedger for                       api_gravity | Float            │
│                     inventory corrections                                  temperature | Float            │
│                                                                           density | Float                │
│                    ─────────────                                           ────────────────────            │
│                     ─────────────                                                                        │
│                    ─────────────                                           MovementMappingComparison      │
│                                                                            ────────────────────            │
│                                                                           mapping_id (FK)                │
│                                                                            source_qty/source_nsv          │
│                                                                            target_qty/target_nsv          │
│                                                                            diff_nsv/diff_percent          │
│                                                                            summary_json | JSONB           │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```
