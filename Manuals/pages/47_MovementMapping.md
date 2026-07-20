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
