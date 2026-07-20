# TankOperationMaster

## Purpose
Manage tank-specific operations. This page handles operations that involve storage tanks — tank gauging, dipping, temperature readings, and other tank-related activities at specific locations.

## File Locations
- **Frontend:** `frontend/src/pages/TankOperationMaster.jsx`
- **API Module:** `frontend/src/api/tankOperationApi.js`
- **Backend Router:** `backend/app/routers/tank_operations.py` (prefix: `/tank-operations`)
- **Models:** `TankOperation`, `OperationTransaction` (line 1039)

## API Endpoints
| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/tank-operations` | List tank operations |
| `POST` | `/tank-operations` | Create tank operation |
| `PUT` | `/tank-operations/{id}` | Update tank operation |
| `DELETE` | `/tank-operations/{id}` | Delete tank operation |

## Key Features
- Filter by location
- View, create, edit tank operations
- Connects to the broader operations workflow

## Props
| Prop | Source |
|------|--------|
| `locations` | App.jsx |
| `loggedInUser` | App.jsx |

## Permissions
- **View:** View Tank Operation
