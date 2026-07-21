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
- **Manage:** Manage Location Accounting Day Setting

---

## Full-Stack Architecture Diagram — LocationAccountingDaySetting

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│                     FRONTEND LAYER                                            BACKEND   │
│                                                                                          │
│  LocationAccountingDay       locationAccountingDay    apiClient.js     locations.py      │
│  Setting.jsx                 SettingApi.js                             (same router)     │
│  ──────────────────────     ──────────────────────    ────────────    ──────────────      │
│  Props: locations[]         getDaySettings()          fetch() + JWT   GET  /locations/   │
│                              createDaySetting()       apiPost/Put/      accounting-day-  │
│  Lists locations             updateDaySetting()        apiDelete         settings         │
│  Shows accounting day        deleteDaySetting()                         POST /locations/ │
│  config per location:         ──────────────                              accounting-day- │
│  - Day Start/End Time        setting ↔ setting_name                      settings        │
│  - Effective From/To Dates   dayStartTime ↔ day_start_time              PUT/DELETE ...   │
│  - Timezone                  dayEndTime ↔ day_end_time                   ──────────────   │
│  - Status                    effectiveFrom ↔ effective_from                               │
│                              timezoneName ↔ timezone_name              Validates:        │
│  ┌────────────────────┐                                                   location active │
│  │ Accounting Day:    │    Schema:                                        date overlap    │
│  │ 06:01 today        │    LocationAccountingDaySettingCreate             time != end     │
│  │   to 06:00 next day│      location_code, day_start_time,               timezone req    │
│  │  Timezone: Africa/  │      day_end_time, effective_from,                                  │
│  │  Lagos             │      effective_to?, timezone_name,              Audit: module=     │
│  └────────────────────┘      description?, status                       'Location Acctg   │
│                                                                            Day Setting'    │
└──────────────────────────────────────────┬───────────────────────────────────────────────┘
                                           │
┌──────────────────────────────────────────┴───────────────────────────────────────────────┐
│                              DATA LAYER                                                  │
│                                                                                          │
│  LocationAccountingDaySetting (location_accounting_day_settings)                         │
│  ─────────────────────────────────────────────────────────                                │
│  id (PK)           │ Integer       location_code → locations.location_code                │
│  location_code     │ String(50) IX                                                        │
│  day_start_time    │ Time NOT NULL  ─── Defines accounting day boundary                   │
│  day_end_time      │ Time NOT NULL  ─── e.g., 06:01 start → 06:00 end                    │
│  effective_from    │ Date NOT NULL  ─── When this config becomes active                    │
│  effective_to      │ Date NULL      ─── When it ends (NULL = no end)                      │
│  timezone_name     │ String(100)    ─── e.g., 'Africa/Lagos', 'UTC'                      │
│  description       │ Text?                                                                │
│  status            │ String(20)     ─── Active / Inactive                                 │
│  created_at        │ DateTime                                                             │
│  updated_at        │ DateTime                                                             │
│                                                                                          │
│  Used by: TankStockLedger (accounting_day_setting_id FK)                                 │
│                                                                                          │
│  DB: PostgreSQL → Table: location_accounting_day_settings                                │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```
