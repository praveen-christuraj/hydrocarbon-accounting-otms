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
