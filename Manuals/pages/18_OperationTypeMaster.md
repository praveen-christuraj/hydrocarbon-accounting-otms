# OperationTypeMaster

## Purpose
Create and manage operation types. Operation types classify the different kinds of hydrocarbon operations — tank gauging, truck loading, barge unloading, vessel transfer, etc.

## File Locations
- **Frontend:** `frontend/src/pages/OperationTypeMaster.jsx`
- **API Module:** `frontend/src/api/operationTypeApi.js`
- **Backend Router:** `backend/app/routers/operation_types.py` (prefix: `/operation-types`)
- **Model:** `OperationType` (`backend/app/models.py` line 694)

## API Endpoints
| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/operation-types` | List all types |
| `POST` | `/operation-types` | Create type |
| `PUT` | `/operation-types/{id}` | Update type |
| `DELETE` | `/operation-types/{id}` | Delete type |

## API Request/Response
```json
{ "operation_type_name": "Tank Gauging", "description": "Manual tank dipping", "status": "Active" }
```

## Key Connections
- OperationType → OperationTemplate (templates are per operation type)
- OperationType → OperationTransaction (each transaction has an operation type)
- OperationType → TankOperation, VesselOperation

## Props
| Prop | Source |
|------|--------|
| `assetTypes` | App.jsx |
| `operationTypes` | App.jsx |
| `reloadOperationTypes` | App.jsx |
| `loggedInUser` | App.jsx |

## Permissions
- **View:** View Operation Type
- **Manage:** Manage Operation Type

---

## Full-Stack Architecture Diagram — OperationTypeMaster

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ FRONTEND                        BACKEND                        DATA                    │
│                                                                                        │
│ OperationTypeMaster  opTypeApi       operation_types.py         OperationType           │
│ ───────────────────  ─────────       ────────────────────       ──────────────────      │
│ Props: assetTypes[], getOpTypes()    GET  /operation-types      id (PK) │ Integer       │
│        opTypes[],     createOpType() POST /operation-types      op_type_name│String(150) │
│        reloadOT(),    updateOpType() PUT  /operation-types/{id} op_type_code│String(80)  │
│        loggedInUser   deleteOpType() DELETE /operation-types/   UNIQUE IX               │
│                        ─────────────  {id}                      applicable_asset        │
│  Form: name, code,   conv:           ─────────────               _type_code│String(50)  │
│  asset_type_code     opTypeName↔     Perm: ('View/Manage OT')   op_category│String(100) │
│  (e.g. Tank Gauging→ op_type_name    Validate: unique code      requires_sender_loc     │
│  TANK), category,    assetTypeCode↔  Audit: module='OT'         requires_receiver_loc    │
│  sender/receiver/     asset_type_                                requires_comparison     │
│  comparison/approval  code                                       requires_approval       │
│  requirement flags                                                description│Text?      │
│                                                                  status │ String(20)     │
│                                                                  ──────────────────       │
│  USED BY: OperationTemplate (per op_type_code)                                            │
│           OperationTransaction (op_type_code FK)                                          │
│           TankOperation (operation_code)                                                  │
│           Workflow Policies, OperationAvailability                                        │
└────────────────────────────────────────────────────────────────────────────────────────┘
```
