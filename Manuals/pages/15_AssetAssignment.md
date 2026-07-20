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
