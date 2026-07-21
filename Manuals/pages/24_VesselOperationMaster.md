# VesselOperationMaster

## Purpose
Manage vessel operations (loading, unloading, transfers). Vessels include barges, shuttle tankers, and FSOs that move hydrocarbons between locations.

## File Locations
- **Frontend:** `frontend/src/pages/VesselOperationMaster.jsx`
- **API Module:** `frontend/src/api/vesselOperationApi.js`
- **Backend Router:** `backend/app/routers/vessel_operations.py` (prefix: `/vessel-operations`)
- **Models:** `VesselOperation`, `ShuttleVoyage`, `FSOVoyage`

## API Endpoints
| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/vessel-operations` | List vessel operations |
| `POST` | `/vessel-operations` | Create vessel operation |
| `PUT` | `/vessel-operations/{id}` | Update vessel operation |
| `DELETE` | `/vessel-operations/{id}` | Delete vessel operation |

## Props
| Prop | Source |
|------|--------|
| `locations` | App.jsx |
| `assetTypes` | App.jsx |

## Permissions
- **View:** View Vessel Operation

## Dependencies
- Connected to ShuttleTracking and FSOTracking for detailed tracking
- Vessel operations use vessel assets defined in AssetMaster

---

## Full-Stack Architecture Diagram — VesselOperationMaster

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ FRONTEND                        BACKEND                        DATA                                 │
│                                                                                                      │
│ VesselOperationMaster vesselOpApi   vessel_operations.py       VesselOperation                       │
│ ─────────────────────── ──────────  ────────────────────       ─────────────────                     │
│ Props: locations[]       getOps()   GET  /vessel-operations    id (PK) | Integer                     │
│        assetTypes[]      createOp() POST /vessel-operations    vessel_operation_code|String(80)      │
│                          updateOp() PUT  /vessel-operations/   vessel_operation_label|String(150)   │
│ Form: vessel op code,    deleteOp() DELETE /vessel-operations/  vessel_type | String(50)              │
│ label, type (Barge,                 {id}                        (Barge/Shuttle/FSO)                  │
│ Shuttle, FSO), status               ─────────────               description | Text?                  │
│                          conv:      Perm: ('View Vessel Op')    status | String(20)                  │
│                          opCode↔    Audit: module='Vessel Op'   ─────────────────                     │
│                          vessel_     ─────────────               ─────────────────                     │
│                          operation_                                                                    │
│                          code                                   ShuttleVoyage (per shuttle vessel)    │
│                          opLabel↔                                  ────────────────                    │
│                          vessel_                                 voyage_number, convoy_number,        │
│                          operation_                              shuttle_asset_code, location_code,   │
│                          label                                   status (OPEN/CLOSED)                 │
│                          vesselType↔                           ────────────────                       │
│                          vessel_type                            FSOVoyage (per FSO vessel)            │
│                                                                  ─────────                            │
│                                                                  voyage_number, fso_asset_code,       │
│  RELATIONSHIPS:                                                  location_code, status (OPEN/CLOSED) │
│    VesselOperation ──< defines category of vessel ops                                             │
│    VesselOperation used by OperationType (via op_category)                                            │
│    VesselOperation referenced in ShuttleTracking / FSOTracking                                        │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
```
