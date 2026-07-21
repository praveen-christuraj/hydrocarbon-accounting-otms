# OperationEntry

## Purpose
The primary data entry page for recording hydrocarbon operations. This is the most complex page in the system — it dynamically renders different entry layouts based on the selected operation template.

## File Locations
- **Frontend:** `frontend/src/pages/OperationEntry.jsx` (1993 lines)
- **API Modules:** `operationEntryApi.js`, `operationTemplateApi.js`, `tankerTrackingApi.js`, `apiClient.js`
- **Backend Routers:** `operation_entries.py` (prefix: `/operation-entries`), `operation_templates.py`, `operation_transactions.py`
- **Models:** `OperationTemplate`, `OperationTransaction`, `OperationTransactionValue`

## Layout Types Rendered
| Layout | Component | Purpose |
|--------|-----------|---------|
| Tank Gauging | `TankGaugingLayout` | Manual tank dipping data |
| Multi-Tank Before/After | `MultiTankBeforeAfterLayout` | Before/after volumes |
| Tanker Truck | `TankerTruckLayout` | Truck loading data |
| Tanker Payload Preview | `TankerPayloadPreview` | Truck payload calculations |
| Stock Movement | `StockMovementLayout` | Inter-tank transfers |
| Vessel Cycle | `VesselCycleLayout` | Vessel loading/unloading |
| Shuttle Tracking | `ShuttleTrackingLayout` | Shuttle operations |
| FSO Tracking | `FSOTrackingLayout` | FSO operations |
| Flowmeter Reading | `FlowmeterReadingLayout` | Meter readings |

## API Endpoints Used
| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/operation-templates` | Load available templates |
| `GET` | `/operation-templates/{id}/layout-detail` | Load layout with fields |
| `POST` | `/operation-entries` | Create operation entry |
| `PUT` | `/operation-entries/{id}` | Update operation entry |
| `DELETE` | `/operation-entries/{id}` | Delete operation entry |
| `GET` | `/tanker-tracking/{type}` | Tanker reference data |

## Key Functions

### Frontend
- `createOperationEntry()` — POST the operation data
- `updateOperationEntry()` — PUT update to existing entry
- `getOperationTemplateLayouts()` — GET template layout structures
- `getTankerSenderReference()` — GET tanker reference data

### Backend (operation_entries.py)
- Creates `OperationTransaction` records from entry data
- Handles different operation types with different business logic
- Applies calculation engines for computed fields
- Records the User who created the entry

## State Management
Complex state management includes:
- Selected location, asset, operation type
- Dynamic form fields based on template layout
- Before/after values for multi-tank operations
- Seal data for tanker and barge operations

## Props
| Prop | Source |
|------|--------|
| `operationTypes` | App.jsx |
| `operationTemplates` | App.jsx |
| `operationEntries` | App.jsx |
| `reloadOperationEntries` | App.jsx |
| `loggedInUser` | App.jsx |

## Permissions
- **View:** View Operation Template
- **Manage:** Manage Operation

## Downstream Flow
1. OperationEntry creates a pending `OperationTransaction`
2. Transaction goes through workflow approval via OperationTaskManager
3. Once approved, `TankStockLedger` is updated
4. Reports pull from approved transactions

---

## Full-Stack Architecture Diagram — OperationEntry

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ FRONTEND                               BACKEND                              DATA                     │
│                                                                                                      │
│ OperationEntry (1993 lines)            operation_entries.py               OperationTransaction       │
│ ──────────────────────────             ────────────────────               ────────────────────        │
│                                                                                                      │
│  ┌─ Layout Engine ──────────┐          GET  /operation-templates/         id (PK)         │ Integer  │
│  │ Based on template's     │          │      {id}/layout-detail           ticket_number  │ String   │
│  │ entry_layout_type:      │          │                                    location_code │ String   │
│  │                        │          ├─ POST /operation-entries           asset_code     │ String   │
│  │ TankGaugingLayout      │          │  (creates OpTransaction + values)   op_type_code   │ String   │
│  │ MultiTankBeforeAfter   │          │                                    template_id    │ Integer  │
│  │ TankerTruckLayout      │          ├─ PUT /operation-entries/{id}       transaction    │ String   │
│  │ StockMovementLayout    │          │  (updates pending entry)            _date         │          │
│  │ VesselCycleLayout      │          │                                    status        │ String   │
│  │ ShuttleTrackingLayout  │          ├─ DELETE /operation-entries/{id}    field_values   │ JSONB   │
│  │ FSOTrackingLayout      │          │                                    ────────────────────        │
│  │ FlowmeterReadingLayout │          │  Perm: ('View Op Template',                                │
│  └────────────────────────┘          │         'Manage Op')              OperationTransactionValue │
│                                      │  Audit: module='Op Entry'         ────────────────────        │
│  ┌─ Data Sources ──────┐            ────                                 id, transaction_id (FK),   │
│  │ operationTypes      │            conv:                               field_code, field_label,    │
│  │ operationTemplates  │            createOpEntry() ↔                   field_value, field_type     │
│  │ entries[]           │            POST /operation-entries                                       │
│  │ loggedInUser       │            (sends layout-specific payload)     TankerTruckTracking           │
│  └─────────────────────┘                                                 ────────────────────        │
│                                                                          shuttle_number (ref)       │
│  ┌─ Payload Types ───────┐          RELATED:                           ────────────────────        │
│  │ tank_gauging_payload  │          tankerTrackingApi.js               BargeTripTracking             │
│  │ multi_tank_payload    │          ─────────────                       ────────────────────        │
│  │ shuttle_payload       │          GET /tanker-tracking/               convoy_number (ref)         │
│  │ flowmeter_payload     │          sender/receiver                    ────────────────────        │
│  └───────────────────────┘                                                                        │
│                                                                                                  │
│  OPERATION DATA FLOW:                                                                            │
│  Form Input → Layout Component → createOpEntry() → POST /operation-entries →                      │
│  Router (operation_entries.py) → CREATE OperationTransaction(field_values=JSONB)→ Returns {id}     │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
```
