# MovementMapping

## Purpose
Map operation transactions to create movement comparisons. This page links related transactions (e.g., a load operation and its corresponding delivery/receipt) to compare quantities and detect discrepancies.

## File Locations
- **Frontend:** `frontend/src/pages/MovementMapping.jsx`
- **API Modules:** `movementMappingApi.js`, `bargeTrackingApi.js`, `operationTransactionApi.js`
- **Backend Router:** `backend/app/routers/movement_mappings.py` (prefix: `/movement-mappings`)
- **Models:** `MovementMapping`, `MovementMappingItem`, `MovementMappingComparison`

## API Endpoints
| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/movement-mappings` | List mappings |
| `POST` | `/movement-mappings` | Create mapping |
| `PUT` | `/movement-mappings/{id}` | Update mapping |
| `DELETE` | `/movement-mappings/{id}` | Delete mapping |

## Key Backend Functions
- `add_mapping_items()` — Add transactions to a mapping, with User attribution
- `recompute_mapping_comparison()` — Recalculate comparison values
- `build_mapping_response()` — Format mapping data for display

## Key Features
- View unmapped transactions
- Create movement pairs (source → destination)
- Compare quantities: bill of lading vs received
- Calculate differences and percentages
- View mapping history

## Props
| Prop | Source |
|------|--------|
| `loggedInUser` | App.jsx |

## Permissions
- **View:** View Movement Mapping
- **Manage:** Manage Movement Mapping

---

## Full-Stack Architecture Diagram — MovementMapping

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ FRONTEND                          BACKEND                             DATA                                   │
│                                                                                                              │
│ MovementMapping     movMapApi    movement_mappings.py                MovementMapping                        │
│ ─────────────────   ──────────   ───────────────────                 ───────────────                        │
│ Props: loggedInUser  getMaps()   GET /movement-mappings              id (PK) | Integer                      │
│                      createMap() POST /movement-mappings             mapping_name | String(150)             │
│ View unmapped        updateMap() PUT /movement-mappings/{id}         mapping_type (Barge/Tanker/            │
│ transactions,        deleteMap() DELETE /movement-mappings/{id}       Shuttle/Pipeline)                     │
│ create movement      addItems()  ─────────────                       location_code | String(50)             │
│ pairs (source →      ──────────  Perm: ('View/Mng Movement           period_from | Date                    │
│ target), compare      conv:        Mapping')                          period_to | Date                      │
│ quantities            getMaps↔    Audit: module='Movement Mapping'   status | String                        │
│                       GET /maps  ─────────────                       created_by | String                    │
│ SOURCE/TARGET         createMap↔                                      created_at | DateTime                  │
│ role assignment       POST /maps ─────────────                        ───────────────                        │
│                       updateMap↔                                                                             │
│ Difference/ % calc    PUT /maps   CROSS-CUTTING:                    MovementMappingItem                    │
│                       addItems↔   reports.py:                        ────────────────────                   │
│ Mapping links to       conv        recompute_mapping_comparison()     id (PK) | Integer                      │
| OpTransactions        ──────────   build_mapping_response()          mapping_id (FK)                        │
│                                    Also called from OutTurnReport    role (SOURCE/TARGET)                   │
│                                    ─────────────                      transaction_id (FK→OpTxn)             │
│                                                                       asset_code | String                    │
│  DATA FLOW:                                                           product_name | String                  │
│  Identify unmapped OpTransactions → select → Create mapping →        qty_bbl | Float                       │
│    → Add source items (load) → Add target items (unload) →           water_bbl | Float                     │
│    → Recompute comparison → Show diff (NSV, loss/gain %)             nsv_bbl | Float                       │
│                                                                       api_gravity | Float                   │
│                                                                       temperature | Float                    │
│  COMPARISON OUTPUT:                                                   density | Float                       │
│  Source: qty, water, NSV | Target: qty, water, NSV |                 sort_order | Integer                   │
│  Diff: NSV = target - source | Diff% = (diff/source)*100             ────────────────────                   │
│                                                                                                                │
│                                                                      MovementMappingComparison              │
│                                                                      ──────────────────────                 │
│                                                                      mapping_id (FK)                        │
│                                                                      source_qty/target_qty                  │
│                                                                      source_nsv/target_nsv                  │
│                                                                      diff_nsv/diff_percent                  │
│                                                                      summary_json/per_tank_json             │
│                                                                      ──────────────────────                 │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```
