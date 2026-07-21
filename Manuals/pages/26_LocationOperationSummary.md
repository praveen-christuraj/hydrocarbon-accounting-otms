# LocationOperationSummary

## Purpose
Consolidated read-only view showing which operations are available at each location. Provides a quick overview for operational planning.

## File Locations
- **Frontend:** `frontend/src/pages/LocationOperationSummary.jsx`
- **Backend Router:** `location_operation_availability.py`
- **Model:** `LocationOperationAvailability`

## Key Features
- Grid view: locations × operation types
- Shows availability status per combination
- Read-only (configuration done in LocationOperationAvailability)

## Props
| Prop | Source |
|------|--------|
| `locations` | App.jsx |

## Permissions
- **View:** View Location Operation Availability

---

## Full-Stack Architecture Diagram — LocationOperationSummary

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ FRONTEND (React)                           BACKEND                     DATA                           │
│                                                                                                      │
│ LocationOperationSummary                   (No dedicated API — data from App.jsx)                     │
│ ─────────────────────────                  ─────────────────────                                     │
│ Props: locations[] (from App.jsx)          Uses same model as                                       │
│                                            LocationOperationAvailability                            │
│ Grid/Matrix:                                ─────────────                                           │
│   Rows: locations                          location_operation_                                       │
│   Columns: operation types                 availability.py                                          │
│   Cells: ✓ (available) / ✗ (not)                                                                     │
│                                            GET /location-operation-                                  │
│ Data Source: locations[] +                  availability                                              │
│  operationTypes[] both passed                                                                         │
│  as props (not fetched here)                                                                          │
│                                            (Same endpoint as the                                      │
│ What it shows:                              configuration page)                                       │
│  Which operations are available at                                                                     │
│  which locations in a compact overview    LocationOperationAvailability                              │
│                                            ──────────────────────                                   │
│ Read-only: no edit capability               location_code | String(50) IX                            │
│ Configuration done in                       operation_type_code | String(80) IX                      │
│ LocationOperationAvailability                is_available | Boolean                                  │
│                                              settings_json | JSONB                                   │
│                                              status | String(20)                                     │
│                                              ──────────────────────                                   │
│                                                                                                       │
│  DATA FLOW:                                                                                          │
│  App.jsx loads locationOperationAvailabilities[] → passes to this page →                              │
│  Renders matrix: merge locations[] × operationTypes[] →                                              │
│  Look up each cell from availabilities data → show ✓ or ✗                                            │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
```
