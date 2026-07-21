# OperationTransactionRegister

## Purpose
Browse, filter, and view all operation transactions in a paginated table. This is the central registry for all hydrocarbon operations recorded in the system.

## File Locations
- **Frontend:** `frontend/src/pages/OperationTransactionRegister.jsx`
- **API Module:** `frontend/src/api/operationTransactionApi.js`
- **Backend Router:** `backend/app/routers/operation_transactions.py` (prefix: `/operation-transactions`)

## API Endpoints
| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/operation-transactions` | Get paginated transactions |
| `GET` | `/operation-transactions/export/csv` | Export to CSV |

## API Request (Paged Query)
```json
// GET /operation-transactions?page=1&pageSize=20&searchText=&dateFrom=&dateTo=&operationTypeId=&locationId=&assetId=&status=
```

## API Response
```json
{
  "rows": [
    {
      "id": 1,
      "ticket_number": "TKT-2024-001",
      "operation_type_name": "Tank Gauging",
      "location_name": "Utapate Terminal",
      "asset_name": "T-101",
      "status": "Approved",
      "created_at": "2024-01-15T10:00:00",
      "created_by_name": "John Doe"
    }
  ],
  "total_rows": 150,
  "has_more": false,
  "status_counts": [
    { "status": "Pending", "count": 45 },
    { "status": "Approved", "count": 90 },
    { "status": "Rejected", "count": 15 }
  ]
}
```

## Features
- **Filters:** Search text, date range, operation type, location, asset, status
- **Pagination:** Adjustable page size (default 20)
- **Column Sorting:** By various fields (implementation-dependent)
- **Status Count Summary:** Shows pending/approved/rejected counts at top
- **CSV Export:** Download filtered results

## Props
| Prop | Source |
|------|--------|
| `operationTypes` | App.jsx |
| `locations` | App.jsx |
| `assets` | App.jsx |

## Navigation
- Click a transaction → navigates to OperationTransactionDetail
- Status badges are color-coded (Pending, Approved, Rejected, etc.)

---

## Full-Stack Architecture Diagram — OperationTransactionRegister

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ FRONTEND                               BACKEND                               DATA                     │
│                                                                                                      │
│ OpTransactionRegister  opTransApi      operation_transactions.py           OperationTransaction      │
│ ─────────────────────  ───────────     ──────────────────────────           ────────────────────      │
│ Props: opTypes[]        getTrans()     GET /operation-transactions          id (PK) │ Integer        │
│        locations[]      exportCSV()     ?page=&pageSize=&searchText=        ticket_number│String     │
│        assets[]                        &dateFrom=&dateTo=&opTypeId=        location_code │String      │
│                       ───────────      &locationId=&assetId=&status=       asset_code │String        │
│ Filters: search, date  conv:                                                  op_type_code │String    │
│ range, op type, location getTrans()↔   Perm: ('View Op Transaction')         status │String(20)      │
│ asset, status          GET /op-trans   Audit: module='Op Trans'              ────────────────────      │
│                         ───────────    ─────────────                                                      │
│ Table columns: ID,     exportCSV()↔                                                                      │
│ ticket_number, op_type, GET /op-trans   RESPONSE PACKAGE:                                                │
│ location, asset,       /export/csv      { rows: [...], total_rows, has_more, status_counts }              │
│ status, created_at,                                                                                      │
│ created_by                               STATUS COUNTS:                                                  │
│                                           ┌────────────┬───────┐                                          │
│ Action: click row →                     │ Pending    │  45  │                                          │
│ /op-trans/{id} (Detail)                  │ Approved   │  90  │                                          │
│                                           │ Rejected   │  15  │                                          │
│                                           └────────────┴───────┘                                          │
│                                                                                                          │
│  DATA FLOW:                                                                                              │
│  Page Load → getTrans(params) → GET /operation-transactions?page=1&... →                                 │
│  Router → query OperationTransaction model with SQL filters →                                            │
│  Return { rows, total_rows, status_counts } → Frontend renders table                                    │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```
