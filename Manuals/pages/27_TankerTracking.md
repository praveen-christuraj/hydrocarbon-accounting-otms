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
