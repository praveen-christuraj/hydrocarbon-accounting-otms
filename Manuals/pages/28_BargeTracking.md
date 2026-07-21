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

---

## Full-Stack Architecture Diagram — BargeTracking

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ FRONTEND                          BACKEND                           DATA                                   │
│                                                                                                            │
│ BargeTracking      bargeTrackApi   barge_trip_tracking.py          Trip                                    │
│ ─────────────      ──────────────  ─────────────────────           ───────────                             │
│ Trip lifecycle:    getTrips()      GET /barge-trip/*               id (PK) | Integer                      │
│ Created→Departed→  createEvent()   POST /trip-events               convoy_number | String (unique)        │
│ Arrived→Unloaded→  createCompar()  POST /trip-comparisons          primary_barge_asset_code|String         │
│ Closed             closeTrip()     ─────────────────────           status (OPEN/CLOSED)                   │
│ ─────────────      ─────────────   ─thru: trip conv/event/         created_by | String                    │
│ Convoy tracking    conv:           comparison endpoints            created_at | DateTime                  │
│ Seal verification  getTrips()↔     ─────────────────────                                                  │
│ Before/after        conv:          Perm: ('View/Manage Barge       TripEvent                               │
│ comparison calc     API conv       Tracking')                      ──────────                              │
│ Integration with    patterns       Audit: module='Barge Trip'      id (PK) | Integer                      │
│ OpTransaction                        ─────────────────────        trip_id (FK→Trip)                       │
│                     ─────────────   ─thru shared helpers:          event_type: LOAD_1/LOAD_2_TOPUP/       │
│ PROPS:              Helpers from     get_trip_by_convoy_or_none     UNLOAD/STS/DEPART/ARRIVE/SEAL_CHECK   │
│ loggedInUser         op_txns.py:     ensure_trip_not_closed        location_code | String                 │
│                      get_trip_by_    ensure_barge_unload_           asset_code | String                    │
│                      convoy_or_none  comparison                     operation_transaction_id (FK→OpTxn)   │
│                      ensure_trip_    load_multi_tank_payload        sequence_no | Integer                 │
│                      not_closed      build_multitank_comparison_   event_datetime | DateTime             │
│                      load_multi_     json                           created_by | String                   │
│                      tank_payload                                                                          │
│                      build_multi_   trip_events created             TripComparison                        │
│                      tank_comp_     automatically when              ──────────────                        │
│                      json           OpTransaction is APPROVED       id (PK) | Integer                     │
│                                      (from op_txns.py)             trip_id (FK→Trip)                     │
│                                                                     comparison_type (LOAD_AFTER_vs_       │
│  BARGE TRIP LIFECYCLE:                                               UNLOAD_BEFORE / SEAL_CHECK)          │
│  OperationEntry→Approved→auto-creates Trip+TripEvent(LOAD_1)       left_transaction_id (FK→OpTxn)       │
│  → Barge crew departs port → DEPART event                          right_transaction_id (FK→OpTxn)      │
│  → En route events → ARRIVE event                                  summary_json | JSONB                  │
│  → Unload → UNLOAD event → TripComparison auto-created             per_tank_json | JSONB                 │
│    (compares LOAD_AFTER vs UNLOAD_BEFORE)                          created_by | String                   │
│  → Trip status = CLOSED                                                                                 │
└────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```
