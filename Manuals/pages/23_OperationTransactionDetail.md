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

---

## Full-Stack Architecture Diagram — OperationTransactionDetail

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ FRONTEND (React)                                          BACKEND (FastAPI)                          DATA (PostgreSQL)        │
│                                                                                                                            │
│ OperationTransactionDetail (2945 lines)                     operation_transactions.py                 OperationTransaction     │
│ ─────────────────────────────────────                       ────────────────────────                  ─────────────────────     │
│                                                                                                                            │
│  ┌─ State Variables ─────────────────────────────┐         GET /{id}                                 id (PK) | Integer      │
│  │ transaction, statusHistory, correctionRequests │          ────────────                              operation_number|String │
│  │ loading, statusLoading, correctionLoading      │         Return: 35+ fields +                      operation_ticket_nbr       │
│  │ pendingStatus, pendingRemarks                  │         field_values[] array                     | String                │
│  │ workflowActionAllow {}, reportProfiles[]       │         (with field_code, field_value,            operation_type_code    │
│  │ selectedReportProfileName, reportSettings      │          data_type, unit, etc.)                   | String               │
│  │ successMsg, errorMsg, showCorrectionForm       │                                                    primary_asset_code    │
│  │ correctionForm {requestType,suggestedAction,   │         Perm: View Operation Transaction           | String               │
│  │  reason}                                       │         Audit: module='Op Transaction'             primary_asset_type    │
│  └────────────────────────────────────────────────┘                                                    _code | String        │
│                                                              PATCH /{id}/status                        convoy_number|String   │
│  ┌─ Derived Payloads (useMemo) ────────────────┐              ────────────────                          origin/destination│   │
│  │ tankPayload     = getTankPayload()          │             Status transition validation:              sender/receiver_loc │   │
│  │ multiTankPayload = getMultiTankPayload()    │              1. Permission check                       operation_date     │   │
│  │ shuttlePayload   = getShuttlePayload()      │              2. Workflow policy check                  status|String(20)  │   │
│  │ flowmeterPayload = getFlowmeterPayload()    │                (SUBMIT/APPROVE/REJECT/CANCEL/RECALL)   created_by|String  │   │
│  │ tankerPayload existence check               │              3. Status transition validation           created_at|DateTime│   │
│  └────────────────────────────────────────────┘              4. Seal validation (Multi-Tank Submit)      updated_at|DateTime│   │
│                                                               5. Review confirmation required           ─────────────────────     │
│  ┌─ Payload Extraction Helpers ───────────────┐              6. Auto-create on APPROVE:               ─────────────────────     │
│  │ getTankPayloadFromTransaction()            │               - ShuttleVoyage (if ShuttleTracking)     OperationTransaction       │
│  │ getMultiTankPayloadFromTransaction()       │               - Trip/TripEvent (if BARGE)                Value                     │
│  │ getShuttlePayloadFromTransaction()         │               - TankStockLedger entries                ─────────────────────     │
│  │ getFlowmeterPayloadFromTransaction()       │               - VesselStockLedger entries              id (PK) | Integer         │
│  │ (each: finds fieldValue by fieldCode       │               (BOUNCE: template layout check)           transaction_id (FK)       │
│  │  in fieldValues[], parses JSON string)     │              7. Auto-create on SUBMIT:                 field_code | String       │
│  └────────────────────────────────────────────┘               - OperationTask (approval task)           field_name | String       │
│                                                                                                         field_group | String     │
│  ┌─ Validation Helpers ──────────────────────┐               ON REJECT/RECALL/CANCEL:                  field_value | JSONB     │
│  │ getTankGaugingMandatoryMissing()          │               Close OperationTask                        data_type | String       │
│  │  (checks 7 inputs: date, time, dip,       │                                                        unit | String            │
│  │   water, tank temp, sample temp, BSW,     │         correction_requests.py                          input_mode | String      │
│  │   observed API/density)                   │         ─────────────────────                            sort_order | Integer     │
│  │ getMultiTankMandatoryMissing()            │                                                        ─────────────────────     │
│  │  (checks before/after dips, temps, BSW)    │         POST /{id}/correction-requests                                    │
│  │ getMultiTankSubmitSealCheck()             │          ──────────────────────                        OperationalTransaction     │
│  │  (checks temporary seals + tank seal       │         Validates:                                      StatusHistory            │
│  │   master vs observed mismatches)          │         - Status == 'Approved'                          ─────────────────────     │
│  └────────────────────────────────────────────┘         - 24h correction window open                    id (PK) | Integer        │
│                                                          - No pending correction exists                 transaction_id (FK)      │
│  ┌─ Status-Based Action Renderer ────────────┐          - Permission check                              old_status | String      │
│  │ renderStatusActions():                     │         Creates:                                        new_status | String      │
│  │  Draft   → {Submit, Cancel}               │         - ApprovedTransactionCorrectionRequest          changed_by | String      │
│  │  Submitted → {Approve, Reject, Recall}    │         - OperationTask (revoke task)                   changed_at | DateTime   │
│  │  Rejected  → {Resubmit, Cancel}           │         - TankStockLedger → "Correction Hold"           remarks | String         │
│  │  Approved  → {Mark for Correction}        │          (reverses stock impact via hold)                ─────────────────────     │
│  │  (Each action: permission + workflow       │                                                        ─────────────────────     │
│  │   policy check before enabling button)    │         GET /{id}/correction-requests                  ApprovedTransaction       │
│  └────────────────────────────────────────────┘          ──────────────────────                          CorrectionRequest        │
│                                                          Return list of correction requests             ─────────────────────     │
│  ┌─ ReviewConfirmationModal ────────────────┐          with status, reason, admin action               request_number | String  │
│  │ Shown before any status change           │                                                        transaction_id (FK)      │
│  │ Displays: ticket header summary,          │                                                        request_type | String    │
│  │  calculated values (per payload type),    │         operationWorkflowPolicyApi.js                   suggested_action|String  │
│  │  seal validation warnings,                │         ──────────────────────────                       reason | Text            │
│  │  mandatory missing field warnings,        │                                                        status | String          │
│  │  remarks textarea + review checkbox       │         GET /operation-workflow-policies/check          requested_by | User FK   │
│  │ Prevents Submit/Approve without review    │          ?action_code=&operation_type_code=              requested_by_display     │
│  └────────────────────────────────────────────┘          &operation_template_id=&asset_type_code=       requested_at | DateTime  │
│                                                            &location_code=                              admin_action | String    │
│  ┌─ Report Generation ──────────────────────┐           Returns { allowed, reason }                    admin_remarks | Text     │
│  │ PrintableTankGaugingReport               │                                                        admin_action_at|DateTime  │
│  │  (print CSS @media print hidden)          │         companyReportProfileApi.js                      ─────────────────────     │
│  │  - Company header + logo                  │         ──────────────────────────                                        │
│  │  - Ticket info table                     │                                                        ─────────────────────     │
│  │  - Tank gauging inputs table             │         GET /company-report-profiles                     TankStockLedger           │
│  │  - Calculated values table               │         Returns: profile list (company info,            ─────────────────────     │
│  │  - Status/approval info                  │          logo, footer formula/note)                       transaction_id (FK)      │
│  │  - Signature section (Prepared/Check/Appr)│                                                         tank_number | String     │
│  │  - Footer formula + disclaimer           │                                                         location_code | String   │
│  │                                          │                                                         before/after_volume      │
│  │ PrintableMultiTankReport (same format)    │         OperationTask (auto-created on Submit)          volume_change | Float    │
│  │  - Plus: per-tank dip summary table       │         ────────────────                                before/after_mass        │
│  │  - Seal details section (tank seals      │         task_number, type='Approval', status,            before/after_ullage      │
│  │    master/observed + temporary)           │         assigned_role_ids, policy_id                    before/after_temp        │
│  │  - Verification/approval signature        │                                                        before/after_density     │
│  │                                          │                                                        status | String           │
│  │ handleExportTankGaugingCsv()              │         ──────────────────────                                                    │
│  │  (manually builds CSV with formatCsvValue)│         ──────────────────────                                                    │
│  └────────────────────────────────────────────┘                                                      ─────────────────────     │
│                                                                                                       VesselStockLedger          │
│  ┌─ Correction Form ────────────────────────┐          STATUS LIFECYCLE (backend enforced):            ─────────────────────     │
│  │ requestType: Data/Quantity/Wrong         │                                                          transaction_id (FK)      │
│  │  Asset/Date/Duplicate/Other              │         ┌──────────┐                                     vessel_asset_code        │
│  │ suggestedAction: Reopen for              │    ┌────│  DRAFT   │◄──── (Recall)                       tank_number | String     │
│  │  Edit/Cancellation/Re-approval/Review    │    │    └────┬─────┘                                     before/after_volume      │
│  │ reason (textarea)                        │    │         │ Submit (permission + workflow + seals)      volume_change | Float    │
│  │ 24h deadline enforcement                │    │    ┌────▼────────┐                                   ─────────────────────     │
│  │ Pending correction blocks new requests  │    │    │  SUBMITTED  │                                                          │
│  └──────────────────────────────────────────┘    │    └────┬────────┘                                 ShuttleVoyage              │
│                                                   │    ┌────┴────┐                                      ──────────────            │
│  ┌─ Field Values Table ───────────────────┐       │    │         │                                      voyage_number | String   │
│  │ Lists all saved field codes, names,    │       │  Approve   Reject                                  convoy_number | String   │
│  │ types, units, values                   │       │  (review   (reason required)                        shuttle_asset_code       │
│  │ Payload fields hidden (shown above)    │       │   confirm)  │                                       location_code | String   │
│  │ JSON values masked as structured data  │       │    │         │                                      status | String          │
│  └────────────────────────────────────────┘       │    ▼         ▼                                         ──────────────            │
│                                                   │ ┌────────┐ ┌──────────┐                                                    │
│  ┌─ Status History Table ───────────────┐        │ │APPROVED│ │ REJECTED │                             Trip (auto-created)       │
│  │ Old/New Status, Changed By, At,      │        │ └──┬─────┘ └─────┬────┘                             ──────────────            │
│  │ Remarks (full audit trail)          │        │    │              │ Resubmit                           convoy_number | String   │
│  └──────────────────────────────────────┘        │    │ Correction  ▼                                   status | String          │
│                                                   │    │ Request    ┌──────────┐                                                  │
│  ┌─ Permission Matrix ──────────────────┐        │    │ (24h       │ DRAFT    │──► (Repeat cycle)      TripEvent                 │
│  │ canViewTransaction                   │        │    │  window)   └──────────┘                          ──────────────            │
│  │ canSubmitTransaction                 │        │    │                                                    trip_id (FK)            │
│  │ canApproveTransaction                │        │    ▼                                                    event_type|String       │
│  │ canRejectTransaction                 │        │ ┌──────────────┐                                         (LOAD_1/LOAD_2_TOPUP/   │
│  │ canCancelTransaction                 │        │ │CORRECTION    │                                          UNLOAD/STS)            │
│  │ canRecallTransaction                 │        │ │ REQUEST      │                                         operation_transaction_id│
│  │ canRequestApprovedCorrection         │        │ └──────┬───────┘                                         sequence_no|Integer    │
│  │ (All from loggedInUser.permissions   │        │        │ Admin Review                                    ──────────────          │
│  │  AND workflowActionAllow checks)     │        │   ┌────┴───────┐                                                              │
│  └──────────────────────────────────────┘        │   │            │                                      TankStockLedger           │
│                                                   │ Approve       Reject                                 ──────────────           │
│                                                   │ (Revoke      │ (Deny)                                 (created on APPROVE)    │
│                                                   │  approval)   │                                                               │
│                                                   ▼              ▼                                                               │
│                                             ┌────────────┐ ┌──────────┐                                                        │
│                                             │ REVOKED TO │ │CORRECTION│                                                        │
│                                             │ DRAFT      │ │ DENIED   │                                                        │
│                                             │(Txn→Draft, │ └──────────┘                                                        │
│                                             │ Ledger     │                                                                     │
│                                             │ Reversed)  │                                                                     │
│                                             └────────────┘                                                                     │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```
