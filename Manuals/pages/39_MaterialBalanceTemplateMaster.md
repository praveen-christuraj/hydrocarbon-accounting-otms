# MaterialBalanceTemplateMaster

## Purpose
Configure material balance report templates. These templates define the structure, columns, and data sources for material balance reports.

## File Locations
- **Frontend:** `frontend/src/pages/MaterialBalanceTemplateMaster.jsx`
- **API Module:** `frontend/src/api/materialBalanceTemplateApi.js`
- **Backend Router:** `backend/app/routers/material_balance_templates.py` (prefix: `/material-balance-templates`)
- **Models:** `MaterialBalanceTemplate`, `MaterialBalanceTemplateColumn`

## API Endpoints
| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/material-balance-templates` | List templates |
| `POST` | `/material-balance-templates` | Create template |
| `PUT` | `/material-balance-templates/{id}` | Update template |
| `DELETE` | `/material-balance-templates/{id}` | Delete template |

## Key Features
- Define template columns with data types and units
- Configure calculation fields
- Set default sorting and grouping
- Template assigned to specific locations

## Props
| Prop | Source |
|------|--------|
| `locations` | App.jsx |

## Permissions
- **View:** View Material Balance Template

---

## Full-Stack Architecture Diagram — MaterialBalanceTemplateMaster

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ FRONTEND                            BACKEND                             DATA                                 │
│                                                                                                              │
│ MatBalTemplateMaster matBalTplApi   material_balance_templates.py     MaterialBalanceTemplate                │
│ ──────────────────── ─────────────  ─────────────────────────────     ──────────────────────                 │
│ Props: locations[]    getTemplates() GET /material-balance-templates  id (PK) | Integer                      │
│                       createTempl() POST /material-balance-templates  template_name | String(150)           │
│ Template form:         updateTempl() PUT /material-balance-templates  location_code | String(50)            │
│ name, location,        deleteTempl() DELETE /material-balance-        period_type (Daily/Monthly/Custom)    │
│ description,                        templates/{id}                    description | Text?                    │
│ status                conv:         ─────────────                     is_default | Boolean                   │
│                       getTemplates↔ Perm: ('View Mat Balance          status | String(20)                   │
│ Column editor:         GET /material-  Template')                     ──────────────────────                 │
│ add/remove/reorder     balance-      Audit: module='Mat Balance       ──────────────────────                 │
│ columns with:          templates       Template'                                                        │
│ column_name,           createTempl↔  ─────────────                    MaterialBalanceTemplateColumn           │
│ data_source (links   POST /material-                                   ──────────────────────                 │
│  to TankStockLedger   balance-      TEMPLATE STRUCTURE:               id (PK) | Integer                      │
│  fields),              templates     1 Template → N Columns            template_id (FK)                      │
│ aggregation type,                    Each Column defines:              column_name | String(100)             │
│ sort_order                           - column_name (display label)     data_source | String(100)             │
│                                       - data_source (which field       agg_type (SUM/AVG/COUNT/LAST)        │
│                                       - aggregate_type (SUM/AVG)       formula | Text?                       │
│                                       - sort_order                     unit | String(50)                    │
│                                       - formula (computed fields)      sort_order | Integer                  │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```
