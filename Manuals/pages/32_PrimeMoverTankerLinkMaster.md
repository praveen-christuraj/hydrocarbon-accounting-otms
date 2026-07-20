# PrimeMoverTankerLinkMaster

## Purpose
Manage links between prime movers (tractors/trucks) and tankers (trailers). This tracks which tanker is assigned to which prime mover at any given time for operational tracking.

## File Locations
- **Frontend:** `frontend/src/pages/PrimeMoverTankerLinkMaster.jsx`
- **API Module:** `frontend/src/api/primeMoverTankerLinkApi.js`
- **Backend Router:** `backend/app/routers/prime_mover_tanker_links.py` (prefix: `/prime-mover-tanker-links`)
- **Model:** `PrimeMoverTankerLink`

## API Endpoints
| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/prime-mover-tanker-links` | List all links |
| `POST` | `/prime-mover-tanker-links` | Create link |
| `PUT` | `/prime-mover-tanker-links/{id}` | Update link |
| `DELETE` | `/prime-mover-tanker-links/{id}` | Delete link |

## Props
| Prop | Source |
|------|--------|
| `assets` | App.jsx |
| `loggedInUser` | App.jsx |

## Permissions
- **View:** View Asset (shared permission)
