# TankerTransactionReport

## Purpose
View consolidated reports of tanker transactions — showing loading, transport, and delivery data for tanker truck operations in a report format.

## File Locations
- **Frontend:** `frontend/src/pages/TankerTransactionReport.jsx`
- **API Module:** `frontend/src/api/tankerTransactionReportApi.js`
- **Backend Router:** `tanker_tracking.py` (prefix: `/tanker-tracking`) or dedicated report endpoint

## API Endpoints
| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/tanker-tracking/report` | Get tanker transaction report data |

## Key Features
- Filter by date range, location, tanker
- View transaction summaries
- Compare loaded vs delivered quantities
- Loss/gain analysis

## Props
| Prop | Source |
|------|--------|
| `loggedInUser` | App.jsx |

## Permissions
- **View:** View Tanker Transaction Report
