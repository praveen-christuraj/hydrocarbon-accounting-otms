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

---

## Full-Stack Architecture Diagram — FlowmeterRecordEntry

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ FRONTEND                          BACKEND                              DATA                              │
│                                                                                                          │
│ FlowmeterRecordEntry  flowmeterApi  flowmeter_configs_records.py     FlowmeterRecord                    │
│ ────────────────────  ────────────  ─────────────────────────────    ────────────────                    │
│ Props: loggedInUser    createRecord POST /flowmeter/flowmeter-records id (PK) | Integer                  │
│                        getRecords() GET /flowmeter/flowmeter-records  config_id (FK→FlowmeterConfig)    │
│ Select flowmeter       ──────────── ─────────────                     reading_date | Date                │
│ by location/asset      conv:        Perm: ('View Flowmeter Config')   reading_time | Time                │
│ from configs           createRec↔   Audit: module='Flowmeter Rec'     opening_reading | Float            │
│                        POST /records ─────────────                     closing_reading | Float            │
│ Enter: reading date,   getRecords↔                                     meter_factor_used | Float         │
│ time, opening          GET /records  SHARED:                          gross_observed | Float             │
│ reading, closing                      FlowmeterConfig model           gross_observed_bbl | Float        │
│ reading                              (reads config details:           api60 | Float                      │
│                                       meter_factor, K-factor,         vcf | Float                        │
│ Result: gross                         unit, stream_config)             gsv_bbl | Float                    │
│ observed, calculated                                                 │ bsw_bbl | Float                    │
│ volume, API @ 60,                    FlowmeterCalculatedSummary       nsv_bbl | Float                    │
│ VCF, GSV, NSV                       (review component in Ops Detail)  temperature | Float                │
│                                                                       density | Float                    │
│  FLOW:                                                               │ sample_temperature | Float         │
│  User selects config → enters opening/closing → POST /records →        bsw_percent | Float               │
│  Backend calculates: gross = closing - opening, then applies           remarks | Text?                    │
│  VCF/API correction → GSV = gross × VCF → NSV = GSV - BSW            created_by | String                │
│  → Returns calculated values → Frontend displays summary               created_at | DateTime              │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```
