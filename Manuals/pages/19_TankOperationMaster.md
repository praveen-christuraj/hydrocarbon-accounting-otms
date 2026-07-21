# TankOperationMaster

## Purpose
Manage tank-specific operations. This page handles operations that involve storage tanks — tank gauging, dipping, temperature readings, and other tank-related activities at specific locations.

## File Locations
- **Frontend:** `frontend/src/pages/TankOperationMaster.jsx`
- **API Module:** `frontend/src/api/tankOperationApi.js`
- **Backend Router:** `backend/app/routers/tank_operations.py` (prefix: `/tank-operations`)
- **Models:** `TankOperation`, `OperationTransaction` (line 1039)

## API Endpoints
| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/tank-operations` | List tank operations |
| `POST` | `/tank-operations` | Create tank operation |
| `PUT` | `/tank-operations/{id}` | Update tank operation |
| `DELETE` | `/tank-operations/{id}` | Delete tank operation |

## Key Features
- Filter by location
- View, create, edit tank operations
- Connects to the broader operations workflow

## Props
| Prop | Source |
|------|--------|
| `locations` | App.jsx |
| `loggedInUser` | App.jsx |

## Permissions
- **View:** View Tank Operation
- **Manage:** Manage Tank Operation

---

## Full-Stack Architecture Diagram — TankOperationMaster

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ FRONTEND                       BACKEND                       DATA                        │
│                                                                                          │
│ TankOperationMaster tankOpApi    tank_operations.py          TankOperation               │
│ ─────────────────── ──────────   ─────────────────           ──────────────────           │
│ Props: locations[],  getOps()    GET  /tank-operations       id (PK)     │ Integer        │
│        loggedInUser  createOp()  POST /tank-operations       location_code│String(50) IX  │
│                      updateOp()  PUT  /tank-operations/{id}  op_code     │String(50) IX  │
│  Form: location,     deleteOp()  DELETE /tank-operations/    op_label    │String(150)    │
│  op_code, label,      ─────────  {id}                         op_category │String(50) IX  │
│  category (OPENING,  conv:       ─────────────                 (OPENING/RECEIPT/PRODUCTION/ │
│  RECEIPT, PRODUCTION opCode↔     Perm: ('View/Manage TK Op')  DISPATCH/DRAINING/CLOSING/   │
│  DISPATCH, ...),     operation_  Validate: unique per loc     ADJUSTMENT)                  │
│  sign (SET/IN/OUT/   code        Audit: module='Tank Ops'     op_sign  │String(20)        │
│  NEUTRAL), sort_order opLabel↔   ─────────────                 (SET=declare, IN=increase,   │
│                        op_label                                 OUT=decrease, NEUTRAL=none) │
│                        category↔                                sort_order│Integer         │
│                        operation_category                       description│Text?          │
│                        sign↔                                    status│String(20)          │
│                        operation_sign                           ──────────────────           │
│                                                                  ──────────────────           │
│  RELATIONSHIPS:                                                  TankStockLedger             │
│    Location ──< TankOperation (per location)                      ────────────────           │
│    TankOperation ──> TankStockLedger (drives stock movements)     Maps tank_operation_code    │
│    TankStockLedger uses op_category + op_sign to determine         to stock movement sign     │
│     whether stock increases, decreases, or is set                  (+/-/SET)                 │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```
