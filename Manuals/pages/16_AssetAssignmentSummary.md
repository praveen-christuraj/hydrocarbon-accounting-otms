# AssetAssignmentSummary

## Purpose
Read-only consolidated view of which assets are assigned to which users, grouped by asset type and location. Provides an audit view of the asset assignment landscape.

## File Locations
- **Frontend:** `frontend/src/pages/AssetAssignmentSummary.jsx`
- **Backend:** No dedicated API — combines data from assets, users, assignments
- **Props-driven:** Combines `assets`, `assetTypes`, `locations`, `users`, `assetAssignments`

## Key Features
- Group assets by type and location
- Show assigned user for each asset
- Filter by location
- Summary counts

## Props
| Prop | Source |
|------|--------|
| `assets` | App.jsx |
| `assetTypes` | App.jsx |
| `locations` | App.jsx |
| `users` | App.jsx |
| `assetAssignments` | App.jsx |

## Permissions
- **View:** Requires View Asset + View Asset Assignment + View Asset Assignment Summary

---

## Full-Stack Architecture Diagram — AssetAssignmentSummary

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ FRONTEND (React SPA) — Read-Only, NO dedicated backend API                                │
│                                                                                          │
│  AssetAssignmentSummary.jsx                                                              │
│  ──────────────────────────                                                              │
│  Props: assets[], assetTypes[], locations[], users[], assetAssignments[]                  │
│         (ALL loaded by App.jsx on login via their respective APIs)                       │
│                                                                                          │
│  Derivation (client-side):                                                               │
│    ┌─────────────────────────────────────────────────────────────────────────────────┐   │
│    │  For each asset, find its assignment:                                           │   │
│    │    asset.asset_code → assetAssignments.find(a => a.assetCode === asset.assetCode)│   │
│    │  Then group by: assetTypes → locations → assets → assigned user                 │   │
│    │                                                                                  │   │
│    │  OUTPUT:  Storage Tank ──▶ UTP Terminal ──▶ T-101 ──▶ John (Operator)            │   │
│    │           (asset type)       (location)      (asset)    (assigned user)          │   │
│    └─────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                          │
│  Filters: by location                                                                     │
│  Summary: count of assets assigned / unassigned per type/location                         │
│                                                                                          │
│  DATA SOURCES (from App.jsx state):                                                      │
│    assets[]           ← assetApi.getAssets()      → assets table                          │
│    assetTypes[]       ← assetTypeApi.getATs()     → asset_types table                    │
│    locations[]        ← locationApi.getLocs()     → locations table                      │
│    users[]            ← userApi.getUsers()        → users table                           │
│    assetAssignments[] ← assetAssgnApi.getAssign() → asset_assignments table               │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```
