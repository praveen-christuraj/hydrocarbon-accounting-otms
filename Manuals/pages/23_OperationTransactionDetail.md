# OperationTransactionDetail

## Purpose
View and manage a single operation transaction in full detail. This page shows the complete transaction data including computed values, status history, correction requests, and supports status changes, report generation, and seal checks.

## File Locations
- **Frontend:** `frontend/src/pages/OperationTransactionDetail.jsx` (2931 lines — one of the most complex pages)
- **API Modules:** `operationTransactionApi.js`, `operationWorkflowPolicyApi.js`, `companyReportProfileApi.js`
- **Backend Routers:** `operation_transactions.py` (prefix: `/operation-transactions`), `correction_requests.py`, `reports.py`

## API Endpoints Used
| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/operation-transactions/{id}` | Get transaction detail with field values |
| `PUT` | `/operation-transactions/{id}/status` | Update transaction status |
| `GET` | `/operation-transactions/{id}/status-history` | Get status change history |
| `GET` | `/operation-transactions/{id}/correction-requests` | Get correction requests |
| `POST` | `/operation-transactions/{id}/correction-requests` | Create correction request |
| `GET` | `/operation-workflow-policies/check` | Check allowed status transitions |
| `GET` | `/company-report-profiles` | Load report profiles |

## Key Features

### Transaction Data Display
- Base fields: ticket number, operation type, location, asset, status, dates
- Dynamic field values rendered based on field codes (JSONB payloads):
  - `tank_gauging_payload` → TankGaugingLayout display
  - `multi_tank_payload` → MultiTankBeforeAfterLayout display
  - `shuttle_payload` → ShuttleTrackingLayout display
  - `flowmeter_payload` → FlowmeterReadingLayout display

### Status Management
- Workflow policy-driven status transitions
- Status history timeline
- Approval/rejection actions with remarks

### Correction Requests
- Submit correction request for approved transactions
- View existing correction request status
- Admin can approve/reject correction requests

### Tank Gauging Report Generation
- Select company report profile for branding
- Preview tank gauging calculation summary
- Download formatted report

### Seal Checks (Multi-Tank & Tanker)
- Before/after seal verification
- Mismatch detection and reporting

## Payload Structure (Tank Gauging Example)
```json
{
  "meta": { "assetId": 1, "locationId": 1 },
  "inputs": {
    "gaugingDate": "2024-01-15",
    "gaugingTime": "10:00",
    "dipCm": 850.5,
    "waterLevelCm": 5.2,
    "tankTemperature": 28.5,
    "sampleTemperature": 27.8,
    "bswPercent": 0.5,
    "observedDensity": 0.865,
    "observedInputType": "density"
  },
  "calculated": {
    "observedBarrels": 45200,
    "netStandardVolume": 44950,
    "grossStandardVolume": 45100
  }
}
```

## Status Lifecycle
```
Draft → Pending → Submitted → Approved → (TankStockLedger updated)
                                       → Rejected (can be revised)
Approved → Correction Request → Pending Admin Review → Approved/Rejected
```

## Props
| Prop | Source |
|------|--------|
| Route param: `id` | URL parameter |

## Permissions
- **View:** View Operation Transaction
- **Manage:** Manage Operation (for status changes)
