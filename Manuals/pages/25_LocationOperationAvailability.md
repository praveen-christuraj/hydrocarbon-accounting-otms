# LocationOperationAvailability

## Purpose
Configure which operation types are available at each location. This controls what operations can be performed where — e.g., tank gauging might be available at terminals but not offices.

## File Locations
- **Frontend:** `frontend/src/pages/LocationOperationAvailability.jsx`
- **API Module:** `frontend/src/api/locationOperationAvailabilityApi.js`
- **Backend Router:** `backend/app/routers/location_operation_availability.py` (prefix: `/location-operation-availability`)
- **Model:** `LocationOperationAvailability`

## API Endpoints
| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/location-operation-availability` | List all configurations |
| `POST` | `/location-operation-availability` | Create configuration |
| `PUT` | `/location-operation-availability/{id}` | Update configuration |
| `DELETE` | `/location-operation-availability/{id}` | Delete configuration |

## Key Features
- Select a location and an operation type
- Mark operation as available/unavailable
- Configure operation-specific settings per location

## Props
| Prop | Source |
|------|--------|
| `locations` | App.jsx |
| `loggedInUser` | App.jsx |

## Permissions
- **View:** View Location Operation Availability
