# AssetAssignment

## Purpose
Assign assets to users. This tracks which user is responsible for which asset at a given location. Used for accountability and operational tracking.

## File Locations
- **Frontend:** `frontend/src/pages/AssetAssignment.jsx`
- **API Module:** `frontend/src/api/assetAssignmentApi.js`
- **Backend Router:** `backend/app/routers/asset_assignments.py` (prefix: `/asset-assignments`)
- **Model:** `AssetAssignment`, `PrimeMoverTankerLink`

## API Endpoints
| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/asset-assignments` | List all assignments |
| `POST` | `/asset-assignments` | Create assignment |
| `PUT` | `/asset-assignments/{id}` | Update assignment |
| `DELETE` | `/asset-assignments/{id}` | Delete assignment |

## Key Features
- Select asset, location, and user to create an assignment
- Track assignment start/end dates
- Filter by location to see relevant assets

## Props
| Prop | Source |
|------|--------|
| `assets` | App.jsx |
| `locations` | App.jsx |
| `users` | App.jsx |
| `assetAssignments` | App.jsx |
| `setAssetAssignments` | App.jsx |
| `reloadAssetAssignments` | App.jsx |
| `loggedInUser` | App.jsx |

## Permissions
- **View:** View Asset Assignment
- **Manage:** Manage Asset Assignment

---

## Full-Stack Architecture Diagram — AssetAssignment

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ FRONTEND                          BACKEND                         DATA                 │
│                                                                                        │
│ AssetAssignment   assetAssgnApi   asset_assignments.py           AssetAssignment       │
│ ───────────────   ──────────────  ────────────────────           ────────────────       │
│ Props: assets[],  getAssignments  GET  /asset-assignments        id (PK)   │ Integer    │
│        locations  createAssgn()   POST /asset-assignments        asset_code│ String(80) │
│        users[]    updateAssgn()   PUT  /asset-assignments/{id}   asset_scope│String(20)  │
│        assignmnts deleteAssgn()   DELETE /asset-assignments/{id}  assign_loc │ String(50) │
│        loggedInUsr ─────────────  ─────────────                   _code      │ FK→loc     │
│                        conv:     Perm: ('View/Manage AA')        assigned_to│ String(150)│
│  Select: Asset,      assetCode↔  validates: unique per asset?    _type     │ String(50) │
│  Location, User,     asset_code   Audit: module='AA'              assigned   │ String(150)│
│  Date, ReturnDate    assignDate↔                                  _to        │ FK→user    │
│                       assignment_date                             assign_date │ Date       │
│                                                                   return_date│ Date?      │
│                                                                   status     │ String(20) │
│                                                                   ────────────────         │
│  PrimeMoverTankerLink (separate but related):                      ────────────────         │
│    Links prime mover (tractor) to tanker (trailer) as a pair       PrimeMoverTankerLink    │
│    for convoy operations. Created from AssetAssignment page        prime_mover_asset_code   │
│    or dedicated PrimeMoverTankerLinkMaster page.                   tanker_asset_code        │
│                                                                   linked_from/to dates      │
└────────────────────────────────────────────────────────────────────────────────────────┘
```
