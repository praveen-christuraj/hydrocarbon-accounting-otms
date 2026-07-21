# CalibrationTemplateMaster

## Purpose
Create and manage calibration templates. Calibration templates define the structure (columns, data types) for calibration data that can be applied to assets of a specific type.

## File Locations
- **Frontend:** `frontend/src/pages/CalibrationTemplateMaster.jsx`
- **API Module:** `frontend/src/api/calibrationTemplateApi.js`
- **Backend Router:** `backend/app/routers/calibration_templates.py` (prefix: `/calibration-templates`)
- **Models:** `CalibrationTemplate`, `CalibrationTemplateColumn`

## API Endpoints
| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/calibration-templates` | List templates |
| `POST` | `/calibration-templates` | Create template |
| `PUT` | `/calibration-templates/{id}` | Update template |
| `DELETE` | `/calibration-templates/{id}` | Delete template |

## Key Features
- Templates are tied to an asset type
- Each template has columns defining what calibration data to capture
- Calibration tables use templates as their schema definition

## Props
| Prop | Source |
|------|--------|
| `assetTypes` | App.jsx |
| `calibrationTemplates` | App.jsx |
| `setCalibrationTemplates` | App.jsx |
| `reloadCalibrationTemplates` | App.jsx |
| `loggedInUser` | App.jsx |

## Permissions
- **View:** View Calibration Template

---

## Full-Stack Architecture Diagram — CalibrationTemplateMaster

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ FRONTEND (React)                   BACKEND (FastAPI)            DATA (PostgreSQL)        │
│                                                                                          │
│ CalibTemplateMaster    calibTemplApi     calib_templates.py     CalibrationTemplate      │
│ ────────────────────   ─────────────     ─────────────────       ──────────────────       │
│ Props: assetTypes[],   getTemplates()    GET  /calib-templates   id (PK)    │ Integer    │
│        calibTemplates  createTemplate()  POST /calib-templates   template   │ String(150)│
│        reloadCT()      updateTemplate()  PUT  /calib-templates/   name       │ UNIQUE IX   │
│        loggedInUser    deleteTemplate()  DELETE /calib-templates/ asset_type │ String(50) │
│                         ─────────────     {id}                   _code      │             │
│ Template form: name,   templateName↔     ─────────────           calib_type │ String(100)│
│ asset_type_code,       template_name     Perm: ('View/Manage    description│ Text?      │
│ calib_type, columns     assetTypeCode↔    Calibration Template') status    │ String(20) │
│ (dynamic CRUD)          asset_type_code  Validation: unique name            │             │
│                         calibType↔       Audit: module='CT'     ──────────────────        │
│                         calibration_type                                   │             │
│                         column CRUD inline                     CalibrationTemplateColumn  │
│                                                                ─────────────────────────    │
│  Template has child COLUMNS:                                    id (PK)     │ Integer     │
│  colName, dataType, unit, required,                             template_id │ FK → CT.id   │
│  interpolation_role, sort_order                                  col_name    │ String(120) │
│                                                                  data_type   │ String(50)  │
│                                                                  unit,interp,│ sort_order   │
│                                                                  is_required  │ dec check  │
│                                                                  UNIQUE(template_id, col_name)  │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```
