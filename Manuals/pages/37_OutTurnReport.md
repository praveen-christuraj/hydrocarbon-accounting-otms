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
