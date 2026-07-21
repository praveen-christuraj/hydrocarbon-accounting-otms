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

---

## Full-Stack Architecture Diagram — PrimeMoverTankerLinkMaster

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ FRONTEND                         BACKEND                         DATA                                │
│                                                                                                      │
│ PrimeMoverTankerLink  primeMoverLinkApi prime_mover_tanker_links.py  PrimeMoverTankerLink           │
│ ────────────────────  ────────────────  ──────────────────────────  ────────────────────             │
│ Props: assets[]        getLinks()       GET /prime-mover-tanker-links   id (PK) | Integer            │
│        loggedInUser    createLink()     POST /prime-mover-tanker-links  prime_mover_code|String(80) │
│                        updateLink()     PUT /prime-mover-tanker-links   tanker_code | String(80)     │
│ Select prime mover                     /{id}                            link_date | Date              │
│ (tractor) + tanker                     DELETE /prime-mover-tanker-links  unlink_date | Date?          │
│ (trailer) from assets,                  /{id}                            status | String(20)          │
│ set link date           conv:          ──────────────                    created_by | String          │
│                        getLinks()↔     Perm: ('View Asset')             ────────────────────          │
│ Unlink date optional   GET /prime-     Audit: module='Prime Mover       ────────────────────          │
│                        mover-tanker-    Tanker Link'                    UNIQUE: prime_mover_code +   │
│                        links           ──────────────                    tanker_code (active only)   │
│                        createLink↔                                                                   │
│ USED BY:               POST /prime-    HELPS: Track which tanker                                      │
│ TankerTracking (to     mover-tanker-   (trailer) is paired with which                                 │
│ determine active       links           prime mover (tractor) at any                                  │
│ tanker config)                          given time for tanker truck ops                              │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
```
