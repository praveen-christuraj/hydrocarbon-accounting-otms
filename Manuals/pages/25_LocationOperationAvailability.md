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
- **Manage:** Manage Location Operation Availability

---

## Full-Stack Architecture Diagram — LocationOperationAvailability

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ FRONTEND                          BACKEND                          DATA                              │
│                                                                                                      │
│ LocationOpAvailability  locOpAvailApi  location_operation_availability.py  LocationOpAvailability    │
│ ──────────────────────  ────────────  ──────────────────────────────────  ──────────────────────      │
│ Props: locations[]       getConfigs() GET /location-operation-availability  id (PK) | Integer        │
│        loggedInUser      createConfig POST /location-operation-availability  location_code | String   │
│                          updateConfig PUT  /location-operation-availability  operation_type_code      │
│ Grid: select location,                 /{id}                                | String(80)             │
│ select operation type,                  DELETE /location-operation-          is_available | Boolean   │
│ toggle available/unavailable            availability/{id}                   settings_json | JSONB    │
│ with optional settings                  ─────────────                        (per-location operation   │
│ (e.g. default parameters) Perm: ('View/Manage LOC Op Avail')                   configuration)        │
│                               Audit: module='LOC Op Avail'                 status | String(20)       │
│                               ─────────────                                ──────────────────────      │
│                                                                             ──────────────────────      │
│                               conv:                                         UNIQUE: location_code +   │
│                               getConfigs()↔GET /loc-op-avail               operation_type_code       │
│                                                                                                        │
│  CONTROL FLOW:                                                                                        │
│  LocationOperationSummary (read-only view) reads same LocationOperationAvailability                   │
│  OperationEntry checks this table to validate operation types for a location                          │
│  OperationTemplateMaster filters templates by available operations for a location                     │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
```
