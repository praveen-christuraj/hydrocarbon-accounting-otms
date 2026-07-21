# TankerTracking

## Purpose
Track tanker truck operations — acknowledge receipts, manage deliveries, and close out tanker movements. Tanker tracking links upstream operations (loading) with downstream receipts.

## File Locations
- **Frontend:** `frontend/src/pages/TankerTracking.jsx`
- **API Module:** `frontend/src/api/tankerTrackingApi.js`
- **Backend Router:** `backend/app/routers/tanker_tracking.py` (prefix: `/tanker-tracking`)
- **Models:** `TankerReceiptAcknowledgement`, `Trip`, `OperationTransaction`

## API Endpoints
| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/tanker-tracking/acknowledge` | Acknowledge tanker receipt |
| `POST` | `/tanker-tracking/close` | Close tanker tracking movement |

## Key Functions

### Frontend
- `acknowledgeTankerReceipt()` — POST acknowledgment with seal checks
- `closeTankerMovement()` — POST close out movement

### Backend (tanker_tracking.py)
- `acknowledge_tanker_receipt()` — Records acknowledgment with User identity
- Ties tanker operations to parent operation transactions
- Creates trip events for tanker movements
- Manages seal verification during acknowledgment

## Key Features
- View incoming tanker deliveries
- Enter receipt acknowledgment with quantities
- Seal verification: port manifold, starboard manifold, pumproom
- Compare against expected values from the load operation
- Close out completed tanker movements
- Integration with OperationTransaction for cross-referencing

## Props
| Prop | Source |
|------|--------|
| `locations` | App.jsx |
| `loggedInUser` | App.jsx |

## Permissions
- **View:** View Tanker Tracking
- **Manage:** Manage Tanker Tracking

## Data Flow
```
OperationEntry (load) → OperationTransaction (approved) → 
TankerTracking (acknowledge receipt) → 
Auto-creates TankerReceiptAcknowledgement → 
Trip/TripEvent created for tracking
```

---

## Full-Stack Architecture Diagram — TankerTracking

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ FRONTEND                          BACKEND                         DATA                                 │
│                                                                                                        │
│ TankerTracking     tankerTrackApi   tanker_tracking.py          TankerReceiptAcknowledgement          │
│ ────────────────    ──────────────  ───────────────────         ────────────────────────────           │
│ Views: incoming     acknowledge()  POST /tanker-tracking/       id (PK) | Integer                       │
│ deliveries,         closeMovement  acknowledge                   transaction_id (FK→OpTxn)              │
│ receipt            ()              ────────────────              acknowledged_by | String                │
│ acknowledgment,                     (Seal checks: port,         acknowledged_at | DateTime              │
│ seal verification   conv:          stbd manifold, pumproom)     seal_port_manifold | String              │
│                     ackMethod↔                                    seal_stbd_manifold | String            │
│ TankerPayload       POST /tanker-  POST /tanker-tracking/close   seal_pumproom | String                 │
│ Preview component   tracking/      ────────────────              receiver_notes | String                 │
│ (shows computed      acknowledge   (Close out movement)          status | String (Open/Closed)          │
│ values for                        ─────────────                  ────────────────────────────           │
│ approval)            closeMethod↔  Perm: ('View/Manage                                                    │
│                      POST /tanker-  Tanker Tracking')           Trip (auto-created on ack)              │
│ Convoy ref:          tracking/     Audit: module='Tanker         ────────────                           │
│ convoy_number from   close          Tracking'                    convoy_number | String PK              │
│ OperationTransaction               ─────────────                 status (OPEN/CLOSED)                   │
│                                                                  primary_barge_asset_code               │
│  FLOW:                                                                                                  │
│  OperationEntry(TankerTruck) → OpTransaction(Approved) →                                                │
│    TankerTracking shows pending → Enter receipt ack with seals →                                        │
│    POST /acknowledge → Trip auto-created → TripEvent added →                                            │
│    POST /close → status=CLOSED                                                                          │
└────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```
