# MaterialBalanceReport

## Purpose
Generate material balance reports for regulatory compliance and operational reconciliation. This report provides a comprehensive view of hydrocarbon movements across locations over a period.

## File Locations
- **Frontend:** `frontend/src/pages/MaterialBalanceReport.jsx`
- **API Module:** `frontend/src/api/materialBalanceReportApi.js`
- **Backend Router:** `backend/app/routers/reports.py` (prefix: `/reports`)

## API Endpoints
| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/reports/material-balance-report` | Get material balance report data |

## Key Features
- Opening inventory
- Receipts (transfers in, production)
- Deliveries (transfers out, sales)
- Adjustments
- Closing inventory
- Loss/gain analysis
- Reconciliation against expected balances

## Props
| Prop | Source |
|------|--------|
| `loggedInUser` | App.jsx |

## Permissions
- **View:** View Reports
