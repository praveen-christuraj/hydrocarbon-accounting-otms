# FlowmeterRecordEntry

## Purpose
Enter flowmeter reading records. This page captures flowmeter readings at specific times for tracking flow volumes.

## File Locations
- **Frontend:** `frontend/src/pages/FlowmeterRecordEntry.jsx`
- **API Module:** `frontend/src/api/flowmeterApi.js`
- **Backend Router:** `flowmeter_configs_records.py` (prefix: `/flowmeter`)
- **Models:** `FlowmeterRecord`, `FlowmeterConfig`

## API Endpoints
| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/flowmeter/flowmeter-records` | Create reading |
| `GET` | `/flowmeter/flowmeter-records` | Get readings for a flowmeter |

## Key Features
- Select flowmeter by location/asset
- Enter meter reading (start/end values)
- Calculate flow volume
- View reading history

## Props
| Prop | Source |
|------|--------|
| `loggedInUser` | App.jsx |

## Permissions
- **View:** View Flowmeter Config
