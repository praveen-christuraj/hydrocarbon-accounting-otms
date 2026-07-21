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
- **Manage:** Manage Flowmeter Config

---

## Full-Stack Architecture Diagram — FlowmeterConfigMaster

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ FRONTEND                          BACKEND                              DATA                              │
│                                                                                                          │
│ FlowmeterConfigMaster  flowmeterApi  flowmeter_configs_records.py     FlowmeterConfig                   │
│ ─────────────────────  ────────────  ─────────────────────────────    ────────────────                   │
│ Props: locations[],    getConfigs()  GET /flowmeter/flowmeter-configs id (PK) | Integer                  │
│        assets[],        createConfig POST /flowmeter/flowmeter-configs config_code | String(80)          │
│        assetAssign[]    updateConfig PUT /flowmeter/flowmeter-configs config_name | String(150)          │
│                         deleteConfig /{id}                             location_code | String(50)        │
│ Config form: code,      ──────────── DELETE /flowmeter/flowmeter-      asset_code | String(50)          │
│ name, location, asset,  conv:          configs/{id}                    meter_factor | Float             │
│ meter factor, K-factor, getConfigs↔  ─────────────                     k_factor | Float                 │
| unit, status           GET /configs  Perm: ('View/Mng Flowmeter        meter_unit | String(50)          │
│                         createConfig↔  Config')                        stream_config | JSONB            │
│ History tracking:       POST /configs Audit: module='Flowmeter Config'  (multi-meter stream grouping)    │
│ changes captured in    ───────────── ─────────────                      status (Active/Inactive)        │
│ FlowmeterConfigHistory ─────────────                                     ────────────────                 │
│                                             ─────────────                                              │
│                        ─────────────         ─────────────              FlowmeterConfigHistory           │
│                                                                         ──────────────────────           │
│  USED BY: FlowmeterRecordEntry (reads configs)                         config_id (FK), field,            │
│           OperationEntry FlowmeterReadingLayout (uses config)            old_value, new_value,           │
│           FlowmeterCalculatedSummary (review modal)                      changed_by, changed_at          │
│                                                                         ──────────────────────           │
│                                                                                                            │
│                                                                         FlowmeterRecord                  │
│                                                                         ────────────────                  │
│                                                                         config_id (FK), reading_date,     │
│                                                                         opening_reading, closing_reading, │
│                                                                         gross_observed, calculated        │
│                                                                         volume, created_by                │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```
