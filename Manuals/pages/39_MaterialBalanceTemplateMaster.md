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
