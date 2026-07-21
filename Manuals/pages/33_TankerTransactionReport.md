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

---

## Full-Stack Architecture Diagram — TankerTransactionReport

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ FRONTEND                         BACKEND                           DATA                              │
│                                                                                                      │
│ TankerTransactionReport  txnReportApi  tanker_tracking.py        TankerReceiptAcknowledgement       │
│ ───────────────────────  ────────────  ───────────────────       ────────────────────────────        │
│ Props: loggedInUser       getReport()  GET /tanker-tracking/      transaction_id (FK→OpTxn)         │
│                           ────────────  report?date_from=         acknowledged_by | String          │
│ Filters: date range,      conv:         &date_to=&location_code=  acknowledged_at | DateTime        │
│ location, tanker          getReport↔    &tanker_code=              receiver_notes | String          │
│                            GET /tanker- ────────────               status | String                   │
│ Report shows:              tracking/    Perm: ('View Tanker        ────────────────────────────       │
│ loading qty, delivery      report        Transaction Report')                                        │
│ qty, loss/gain,            conv:        Audit: module='Tanker      OperationTransaction              │
│ seal details               API conv     Report'                   ──────────────────                 │
│                                        ────────────               operation_type_code (TANKER)      │
│ Compares loaded vs                                                 primary_asset_code (truck)        │
│ delivered quantities       QUERIES:                                origin_location_code              │
│ for loss/gain analysis     TankerReceiptAcknowledgement           convoy_number                     │
│                             joined with                            status, ticket_number             │
│                             OperationTransaction                  ──────────────────                 │
│                             grouped by tanker/trip                                                   │
│                                                                                                      │
│  REPORT STRUCTURE:                                                                                   │
│  Ticket | Load Location | Unload Location | Product | Load Qty | Delivered Qty | Loss/Gain | Seals   │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
```
