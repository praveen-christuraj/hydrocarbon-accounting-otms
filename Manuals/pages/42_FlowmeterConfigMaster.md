# FlowmeterConfigMaster

## Purpose
Configure flowmeter devices that measure hydrocarbon flow. Flowmeters are physical instruments installed at assets, and their configuration determines how readings are captured and calculated.

## File Locations
- **Frontend:** `frontend/src/pages/FlowmeterConfigMaster.jsx`
- **API Module:** `frontend/src/api/flowmeterApi.js`
- **Backend Router:** `backend/app/routers/flowmeter_configs_records.py` (prefix: `/flowmeter`)
- **Models:** `FlowmeterConfig`, `FlowmeterConfigHistory`, `FlowmeterRecord`

## API Endpoints
| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/flowmeter/flowmeter-configs` | List flowmeter configs |
| `POST` | `/flowmeter/flowmeter-configs` | Create config |
| `PUT` | `/flowmeter/flowmeter-configs/{id}` | Update config |
| `DELETE` | `/flowmeter/flowmeter-configs/{id}` | Delete config |
| `POST` | `/flowmeter/flowmeter-records` | Create reading record |
| Various | `/flowmeter/*` | Additional endpoints |

## Key Features
- Configure flowmeter parameters (K-factor, meter factor, etc.)
- Assign flowmeter to asset/location
- Track configuration history (changes over time)
- View active vs inactive flowmeters

## Props
| Prop | Source |
|------|--------|
| `locations` | App.jsx |
| `assets` | App.jsx |
| `assetAssignments` | App.jsx |

## Permissions
- **View:** View Flowmeter Config
