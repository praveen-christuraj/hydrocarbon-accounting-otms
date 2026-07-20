# BargeTracking

## Purpose
Track barge trips — manage trip events, seal checks, comparisons, and complete tracking lifecycle for barge operations (loading at terminal, transit, unloading at destination).

## File Locations
- **Frontend:** `frontend/src/pages/BargeTracking.jsx`
- **API Module:** `frontend/src/api/bargeTrackingApi.js`
- **Backend Router:** `backend/app/routers/barge_trip_tracking.py` (prefix: `/barge-trip`)
- **Models:** `Trip`, `TripEvent`, `TripComparison`, `BargeSealMaster`

## API Endpoints
| Method | Endpoint | Purpose |
|--------|----------|---------|
| Various | `/barge-trip/*` | Trip management, events, comparisons |
| `POST` | `/trip-events` | Create trip event |
| `POST` | `/trip-comparisons` | Create/update comparisons |

## Key Functions (Backend)
- `create_trip_comparison()` — Compare before/after volumes with User attribution
- `create_trip_event()` — Record seal events and checkpoints
- `ensure_barge_unload_comparison()` — Auto-create unload comparison records
- `get_trip_by_convoy_or_none()` — Find trips by convoy identifier
- `ensure_trip_not_closed()` — Guard against operations on closed trips

## Key Features
- Trip lifecycle: Created → Departed → Arrived → Unloaded → Closed
- Convoy tracking for multi-barge operations
- Seal management: port manifold, starboard manifold, pumproom, tank seals
- Before/after comparison calculations
- Integration with operation transactions for cargo tracking
- Create trip events at each lifecycle milestone

## Props
| Prop | Source |
|------|--------|
| `loggedInUser` | App.jsx |

## Permissions
- **View:** View Barge Tracking
- **Manage:** Manage Barge Tracking

## Data Flow
```
Barge loaded (OperationEntry → approved transaction) → 
BargeTrip created → Departure event → 
Transit events → Arrival event → 
Unload comparison → Trip closed
```
