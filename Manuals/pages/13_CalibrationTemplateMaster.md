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
