# OperationTemplateMaster

## Purpose
Create and manage operation templates. Templates define the data fields, layout sections, and calculation engines used during operation entry. They are the blueprint for how operations are recorded.

## File Locations
- **Frontend:** `frontend/src/pages/OperationTemplateMaster.jsx`
- **API Module:** `frontend/src/api/operationTemplateApi.js`
- **Backend Router:** `backend/app/routers/operation_templates.py` (prefix: `/operation-templates`)
- **Models:** `OperationTemplate`, `OperationTemplateField`, `OperationTemplateLayout`, `OperationTemplateLayoutSection`, `OperationTemplateLayoutItem`

## API Endpoints
| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/operation-templates` | List templates |
| `POST` | `/operation-templates` | Create template |
| `PUT` | `/operation-templates/{id}` | Update template |
| `DELETE` | `/operation-templates/{id}` | Delete template |
| `GET` | `/operation-templates/{id}/layout-detail` | Get layout detail |

## Key Features
- Templates are tied to an operation type
- Each template has:
  - **Fields**: Define what data is captured (name, type, unit, calculation role)
  - **Layout Sections**: Visual grouping of fields
  - **Layout Items**: Individual field placements
  - **Entry Layout Type**: Standard Form, Tank Gauging, Tanker Truck, Multi-Tank, Vessel, etc.
  - **Calculation Engine**: Business logic for computing values

## Entry Layout Types
- Standard Form
- Tank Gauging Layout
- Tanker Truck Layout
- Multi-Tank Before/After Layout
- Vessel Cycle Layout
- Stock Movement Layout
- Shuttle Tracking Layout
- FSO Tracking Layout
- Flowmeter Reading Layout

## Props
| Prop | Source |
|------|--------|
| `operationTypes` | App.jsx |
| `operationTemplates` | App.jsx |
| `reloadOperationTemplates` | App.jsx |
| `loggedInUser` | App.jsx |

## Permissions
- **View:** View Operation Template

## Downstream Dependencies
Templates are used by OperationEntry to render dynamic forms for data collection.
