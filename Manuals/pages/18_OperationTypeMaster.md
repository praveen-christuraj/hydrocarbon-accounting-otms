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
