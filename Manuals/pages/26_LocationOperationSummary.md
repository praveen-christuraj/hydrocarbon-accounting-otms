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
