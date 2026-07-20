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
