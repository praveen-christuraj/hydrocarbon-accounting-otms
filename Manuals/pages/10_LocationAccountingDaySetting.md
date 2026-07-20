# LocationAccountingDaySetting

## Purpose
Manage accounting day configurations per location. Each location can have custom accounting day settings that define how transactions are grouped and reported.

## File Locations
- **Frontend:** `frontend/src/pages/LocationAccountingDaySetting.jsx`
- **API Module:** `frontend/src/api/locationAccountingDaySettingApi.js`
- **Backend Router:** `backend/app/routers/locations.py` (part of `/locations` or shared)
- **Model:** `LocationAccountingDaySetting`

## API Endpoints
| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/location-accounting-day-settings` | List all settings |
| `POST` | `/location-accounting-day-settings` | Create setting |
| `PUT` | `/location-accounting-day-settings/{id}` | Update setting |
| `DELETE` | `/location-accounting-day-settings/{id}` | Delete setting |

## Key Features
- Select a location to configure
- Set accounting day parameters (cutoff time, day offset, etc.)
- Each location can have one active accounting day setting

## Props
| Prop | Source |
|------|--------|
| `locations` | App.jsx |

## Permissions
- **View:** View Location Accounting Day Setting
