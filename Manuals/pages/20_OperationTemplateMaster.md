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

---

## Full-Stack Architecture Diagram — OperationTemplateMaster

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ FRONTEND (React)                  BACKEND (FastAPI)                   DATA (PostgreSQL)              │
│                                                                                                      │
│ OpTemplateMaster   opTemplateApi   operation_templates.py           OperationTemplate                │
│ ─────────────────  ─────────────   ──────────────────────           ─────────────────                 │
│ Props: opTypes[],  getTemplates()  GET  /operation-templates        id (PK)          │ Integer       │
│        opTemplates createTempl()   POST /operation-templates        template_name    │ String(150)   │
│        reloadOTpl() updateTempl()  PUT  /operation-templates/{id}   operation_type   │ String(80)    │
│        loggedInUser deleteTempl()  DELETE /operation-templates/{id}  _code           │               │
│                        ─────────  ─────────────                      entry_layout     │ String(80)    │
│  Template form: name, conv:        Perm: ('View/Manage OT')          _type            │               │
│  op_type_code, layout  templateName Validation: unique name          calculation      │ String(100)   │
│  type, calculation     ↔ template_ Audit: module='Op Template'       _engine          │               │
│  engine                 name        ─────────────                     description      │ Text?         │
│                        opTypeCode                                     status          │ String(20)    │
│  Layout Detail tab:    ↔ operation_                                    ─────────────────                 │
│  Sections → Fields →   type_code                                                                    │
│  Items (positions)                                 ┌────────────────────────────────────────────────┐│
│                        OperationTemplateField       │  OPERATION TEMPLATE HIERARCHY:                ││
│                        ───────────────────────      │                                              ││
│                        id, template_id (FK),        │  1 Template → N Fields (data capture defs)   ││
│                        field_name, field_code,       │  1 Template → N Layouts (visual structures)  ││
│                        field_group, data_type,       │  1 Layout → N Sections (tab groups)          ││
│                        unit, is_required,            │  1 Section → N Items (field placements)      ││
│                        input_mode, calculation_role, │                                              ││
│                        sort_order                    │  FIELD: name, code, type, unit, calc_role    ││
│                                                      │  ITEM: row, col_start, col_span, sort_order ││
│                        OperationTemplateLayout        └────────────────────────────────────────────────┘│
│                        id, template_id (FK)                                                            │
│                        layout_name, version_no                                                          │
│                        status (Draft/Published)                                                         │
│                        is_default                                                                    │
│                                                                                                      │
│  DOWNSTREAM: OperationEntry uses these templates to render dynamic forms                              │
│              OperationTransaction stores field_values based on field_codes                           │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
```
