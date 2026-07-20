from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import (
    OperationTemplate,
    OperationTemplateField,
    OperationType,
    OperationTransaction,
    OperationTemplateLayout,
    OperationTemplateLayoutSection,
    OperationTemplateLayoutItem,
    User,
)
from app.schemas import (
    OperationTemplateCreate,
    OperationTemplateResponse,
    OperationTemplateLayoutCreate,
    OperationTemplateLayoutUpdate,
    OperationTemplateLayoutResponse,
)
from app.dependencies.auth import get_current_user_from_token
from app.dependencies.permissions import require_user_permission
from app.services.audit_service import create_audit_log
from app.utils.helpers import clean_optional_text

router = APIRouter(prefix="/operation-templates", tags=["Operation Templates"])

VALID_ENTRY_LAYOUT_TYPES = [
    "Standard Form",
    "Stock Movement",
    "Tank Gauging",
    "Multi-Tank Before/After",
    "Vessel Cycle",
    "Tanker Loading",
    "Meter Reading",
    "Shuttle Tracking",
    "FSO Tracking",
]

VALID_CALCULATION_ENGINES = [
    "None",
    "Stock Movement Net/Variance",
    "Tank Quantity",
    "Barge Before/After Quantity",
    "Vessel Cycle Quantity",
    "Tanker Quantity",
    "Meter Reading Quantity",
]


def build_operation_template_response(template: OperationTemplate, db: Session):
    operation_type = db.query(OperationType).filter(
        OperationType.operation_type_code == template.operation_type_code
    ).first()

    fields = (
        db.query(OperationTemplateField)
        .filter(OperationTemplateField.template_id == template.id)
        .order_by(OperationTemplateField.sort_order, OperationTemplateField.id)
        .all()
    )

    return {
        "id": template.id,
        "template_name": template.template_name,
        "operation_type_code": template.operation_type_code,
        "operation_type_name": (
            operation_type.operation_type_name if operation_type else ""
        ),
        "entry_layout_type": template.entry_layout_type or "Standard Form",
        "calculation_engine": template.calculation_engine or "None",
        "description": template.description,
        "status": template.status,
        "created_at": template.created_at,
        "updated_at": template.updated_at,
        "fields": [
            {
                "id": field.id,
                "field_name": field.field_name,
                "field_code": field.field_code,
                "field_group": field.field_group,
                "data_type": field.data_type,
                "unit": field.unit,
                "is_required": field.is_required,
                "input_mode": field.input_mode,
                "calculation_role": field.calculation_role,
                "sort_order": field.sort_order,
                "status": field.status,
            }
            for field in fields
        ],
    }


def build_operation_template_audit_snapshot(template: OperationTemplate, db: Session):
    operation_type = db.query(OperationType).filter(
        OperationType.operation_type_code == template.operation_type_code
    ).first()

    fields = (
        db.query(OperationTemplateField)
        .filter(OperationTemplateField.template_id == template.id)
        .order_by(OperationTemplateField.sort_order, OperationTemplateField.id)
        .all()
    )

    return {
        "id": template.id,
        "template_name": template.template_name,
        "operation_type_code": template.operation_type_code,
        "operation_type_name": operation_type.operation_type_name if operation_type else "",
        "entry_layout_type": template.entry_layout_type or "Standard Form",
        "calculation_engine": template.calculation_engine or "None",
        "description": template.description,
        "status": template.status,
        "field_count": len(fields),
        "fields": [
            {
                "id": field.id,
                "field_name": field.field_name,
                "field_code": field.field_code,
                "field_group": field.field_group,
                "data_type": field.data_type,
                "unit": field.unit,
                "is_required": field.is_required,
                "input_mode": field.input_mode,
                "calculation_role": field.calculation_role,
                "sort_order": field.sort_order,
                "status": field.status,
            }
            for field in fields
        ],
    }


def validate_operation_template(template: OperationTemplateCreate, db: Session):
    operation_type = db.query(OperationType).filter(
        OperationType.operation_type_code.ilike(template.operation_type_code)
    ).first()

    if not operation_type:
        raise HTTPException(
            status_code=400,
            detail="Operation type not found",
        )

    if operation_type.status != "Active":
        raise HTTPException(
            status_code=400,
            detail="Only Active operation types can be used",
        )

    if template.entry_layout_type not in VALID_ENTRY_LAYOUT_TYPES:
        raise HTTPException(
            status_code=400,
            detail="Invalid entry layout type",
        )

    if template.calculation_engine not in VALID_CALCULATION_ENGINES:
        raise HTTPException(
            status_code=400,
            detail="Invalid calculation engine",
        )

    if len(template.fields) == 0:
        raise HTTPException(
            status_code=400,
            detail="Please add at least one operation template field",
        )

    field_codes = [
        field.field_code.strip().lower()
        for field in template.fields
    ]

    if len(field_codes) != len(set(field_codes)):
        raise HTTPException(
            status_code=400,
            detail="Duplicate field codes are not allowed in the same template",
        )

    field_names = [
        field.field_name.strip().lower()
        for field in template.fields
    ]

    if len(field_names) != len(set(field_names)):
        raise HTTPException(
            status_code=400,
            detail="Duplicate field names are not allowed in the same template",
        )

    return operation_type


@router.get("", response_model=list[OperationTemplateResponse])
def get_operation_templates(
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "View Operation Template",
        db,
    )

    templates = (
        db.query(OperationTemplate)
        .order_by(OperationTemplate.id)
        .all()
    )

    return [
        build_operation_template_response(template, db)
        for template in templates
    ]


@router.post("", response_model=OperationTemplateResponse)
def create_operation_template(
    template: OperationTemplateCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Manage Operation Template", db)

    existing_template = db.query(OperationTemplate).filter(
        OperationTemplate.template_name.ilike(template.template_name)
    ).first()

    if existing_template:
        raise HTTPException(
            status_code=400,
            detail="Operation template name already exists",
        )

    operation_type = validate_operation_template(template, db)

    new_template = OperationTemplate(
        template_name=template.template_name.strip(),
        operation_type_code=operation_type.operation_type_code,
        entry_layout_type=template.entry_layout_type,
        calculation_engine=template.calculation_engine,
        description=clean_optional_text(template.description),
        status=template.status,
    )

    db.add(new_template)
    db.flush()

    for index, field in enumerate(template.fields):
        new_field = OperationTemplateField(
            template_id=new_template.id,
            field_name=field.field_name.strip(),
            field_code=field.field_code.strip(),
            field_group=field.field_group,
            data_type=field.data_type,
            unit=clean_optional_text(field.unit),
            is_required=field.is_required,
            input_mode=field.input_mode,
            calculation_role=field.calculation_role,
            sort_order=field.sort_order or index + 1,
            status=field.status,
        )
        db.add(new_field)

    db.flush()

    after_data = build_operation_template_audit_snapshot(new_template, db)

    create_audit_log(
        db=db,
        module_name="Operations",
        action="Create Operation Template",
        current_user=current_user,
        entity_type="OperationTemplate",
        entity_id=new_template.id,
        entity_label=new_template.template_name,
        remarks="Operation template created",
        request_path="/operation-templates",
        details={"after": after_data},
    )

    db.commit()
    db.refresh(new_template)

    return build_operation_template_response(new_template, db)


@router.put("/{template_id}", response_model=OperationTemplateResponse)
def update_operation_template(
    template_id: int,
    template: OperationTemplateCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Manage Operation Template", db)

    existing_template = db.query(OperationTemplate).filter(
        OperationTemplate.id == template_id
    ).first()

    if not existing_template:
        raise HTTPException(
            status_code=404,
            detail="Operation template not found",
        )

    duplicate_template = db.query(OperationTemplate).filter(
        OperationTemplate.template_name.ilike(template.template_name),
        OperationTemplate.id != template_id,
    ).first()

    if duplicate_template:
        raise HTTPException(
            status_code=400,
            detail="Operation template name already exists",
        )

    before_data = build_operation_template_audit_snapshot(existing_template, db)

    operation_type = validate_operation_template(template, db)

    existing_template.template_name = template.template_name.strip()
    existing_template.operation_type_code = operation_type.operation_type_code
    existing_template.entry_layout_type = template.entry_layout_type
    existing_template.calculation_engine = template.calculation_engine
    existing_template.description = clean_optional_text(template.description)
    existing_template.status = template.status

    db.query(OperationTemplateField).filter(
        OperationTemplateField.template_id == template_id
    ).delete()

    for index, field in enumerate(template.fields):
        new_field = OperationTemplateField(
            template_id=template_id,
            field_name=field.field_name.strip(),
            field_code=field.field_code.strip(),
            field_group=field.field_group,
            data_type=field.data_type,
            unit=clean_optional_text(field.unit),
            is_required=field.is_required,
            input_mode=field.input_mode,
            calculation_role=field.calculation_role,
            sort_order=field.sort_order or index + 1,
            status=field.status,
        )
        db.add(new_field)

    db.flush()

    after_data = build_operation_template_audit_snapshot(existing_template, db)

    create_audit_log(
        db=db,
        module_name="Operations",
        action="Update Operation Template",
        current_user=current_user,
        entity_type="OperationTemplate",
        entity_id=existing_template.id,
        entity_label=existing_template.template_name,
        remarks="Operation template updated",
        request_path=f"/operation-templates/{template_id}",
        details={"before": before_data, "after": after_data},
    )

    db.commit()
    db.refresh(existing_template)

    return build_operation_template_response(existing_template, db)


@router.delete("/{template_id}")
def delete_operation_template(
    template_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Manage Operation Template", db)

    existing_template = db.query(OperationTemplate).filter(
        OperationTemplate.id == template_id
    ).first()

    if not existing_template:
        raise HTTPException(
            status_code=404,
            detail="Operation template not found",
        )

    existing_transaction = (
        db.query(OperationTransaction)
        .filter(OperationTransaction.operation_template_id == template_id)
        .first()
    )

    if existing_transaction:
        raise HTTPException(
            status_code=400,
            detail="Cannot delete operation template because transactions exist for it",
        )

    deleted_data = build_operation_template_audit_snapshot(existing_template, db)

    create_audit_log(
        db=db,
        module_name="Operations",
        action="Delete Operation Template",
        current_user=current_user,
        entity_type="OperationTemplate",
        entity_id=existing_template.id,
        entity_label=existing_template.template_name,
        remarks="Operation template deleted",
        request_path=f"/operation-templates/{template_id}",
        details={"deleted": deleted_data},
    )

    db.query(OperationTemplateField).filter(
        OperationTemplateField.template_id == template_id
    ).delete()

    db.delete(existing_template)
    db.commit()

    return {"message": "Operation template deleted successfully"}


# -------- Operation Template Layout routes --------

layout_router = APIRouter(prefix="", tags=["Operation Template Layouts"])


def build_operation_template_layout_response(layout: OperationTemplateLayout, db: Session):
    sections = (
        db.query(OperationTemplateLayoutSection)
        .filter(OperationTemplateLayoutSection.layout_id == layout.id)
        .order_by(OperationTemplateLayoutSection.sort_order.asc(), OperationTemplateLayoutSection.id.asc())
        .all()
    )
    items = (
        db.query(OperationTemplateLayoutItem)
        .filter(OperationTemplateLayoutItem.layout_id == layout.id)
        .order_by(
            OperationTemplateLayoutItem.row_no.asc(),
            OperationTemplateLayoutItem.col_start.asc(),
            OperationTemplateLayoutItem.sort_order.asc(),
            OperationTemplateLayoutItem.id.asc(),
        )
        .all()
    )

    return {
        "id": layout.id,
        "template_id": layout.template_id,
        "layout_name": layout.layout_name,
        "version_no": layout.version_no,
        "status": layout.status,
        "is_default": layout.is_default,
        "created_at": layout.created_at,
        "updated_at": layout.updated_at,
        "sections": [
            {
                "id": s.id,
                "layout_id": s.layout_id,
                "section_key": s.section_key,
                "title": s.title,
                "sort_order": s.sort_order,
                "collapsible": s.collapsible,
                "default_open": s.default_open,
                "visibility_rule_json": s.visibility_rule_json,
            }
            for s in sections
        ],
        "items": [
            {
                "id": i.id,
                "layout_id": i.layout_id,
                "section_id": i.section_id,
                "field_id": i.field_id,
                "row_no": i.row_no,
                "col_start": i.col_start,
                "col_span": i.col_span,
                "sort_order": i.sort_order,
                "label_override": i.label_override,
                "placeholder_override": i.placeholder_override,
                "read_only_override": i.read_only_override,
                "width_mode": i.width_mode,
                "rule_json": i.rule_json,
            }
            for i in items
        ],
    }


def validate_operation_template_layout_payload(payload_sections, payload_items):
    sections = payload_sections or []
    items = payload_items or []

    if len(sections) == 0:
        raise HTTPException(status_code=400, detail="At least one layout section is required")

    cleaned_section_keys = []
    for section in sections:
        section_key = str(section.section_key or "").strip().lower()
        if section_key == "":
            raise HTTPException(status_code=400, detail="section_key cannot be blank")
        cleaned_section_keys.append(section_key)

    if len(set(cleaned_section_keys)) != len(cleaned_section_keys):
        raise HTTPException(status_code=400, detail="Duplicate section_key found in layout sections")

    used_field_ids = []
    occupied_cells = set()
    for item in items:
        field_id = int(item.field_id or 0)
        row_no = int(item.row_no or 1)
        col_start = int(item.col_start or 1)
        col_span = int(item.col_span or 1)

        if field_id <= 0:
            raise HTTPException(status_code=400, detail="Invalid field_id in layout item")
        if row_no <= 0:
            raise HTTPException(status_code=400, detail="row_no must be greater than 0")
        if col_start <= 0:
            raise HTTPException(status_code=400, detail="col_start must be greater than 0")
        if col_span <= 0:
            raise HTTPException(status_code=400, detail="col_span must be greater than 0")
        if (col_start + col_span - 1) > 3:
            raise HTTPException(status_code=400, detail="Layout grid allows max 3 columns per row")

        used_field_ids.append(field_id)

        for column in range(col_start, col_start + col_span):
            key = (int(item.section_id or 0), row_no, column)
            if key in occupied_cells:
                raise HTTPException(
                    status_code=400,
                    detail="Overlapping layout cells detected in the same section/row/column",
                )
            occupied_cells.add(key)

    if len(set(used_field_ids)) != len(used_field_ids):
        raise HTTPException(status_code=400, detail="Each template field can be placed only once in a layout")


@router.get("/{template_id}/layouts", response_model=list[OperationTemplateLayoutResponse])
def get_operation_template_layouts(
    template_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "View Operation Template", db)

    template = db.query(OperationTemplate).filter(OperationTemplate.id == template_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Operation template not found")

    layouts = (
        db.query(OperationTemplateLayout)
        .filter(OperationTemplateLayout.template_id == template_id)
        .order_by(OperationTemplateLayout.version_no.desc(), OperationTemplateLayout.id.desc())
        .all()
    )
    return [build_operation_template_layout_response(layout, db) for layout in layouts]


@router.post("/{template_id}/layouts", response_model=OperationTemplateLayoutResponse)
def create_operation_template_layout(
    template_id: int,
    payload: OperationTemplateLayoutCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Manage Operation Template", db)

    template = db.query(OperationTemplate).filter(OperationTemplate.id == template_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Operation template not found")

    if str(payload.layout_name or "").strip() == "":
        raise HTTPException(status_code=400, detail="layout_name is required")
    validate_operation_template_layout_payload(payload.sections, payload.items)
    if (payload.is_default or "No") == "Yes" and (payload.status or "Draft") != "Active":
        raise HTTPException(status_code=400, detail="Default layout must be in Active status")

    existing = (
        db.query(OperationTemplateLayout)
        .filter(
            OperationTemplateLayout.template_id == template_id,
            OperationTemplateLayout.layout_name.ilike(payload.layout_name.strip()),
            OperationTemplateLayout.version_no == payload.version_no,
        )
        .first()
    )
    if existing:
        raise HTTPException(status_code=400, detail="Layout version already exists for this template")

    layout = OperationTemplateLayout(
        template_id=template_id,
        layout_name=payload.layout_name.strip(),
        version_no=payload.version_no or 1,
        status=payload.status or "Draft",
        is_default=payload.is_default or "No",
    )
    db.add(layout)
    db.flush()

    if layout.is_default == "Yes":
        db.query(OperationTemplateLayout).filter(
            OperationTemplateLayout.template_id == template_id,
            OperationTemplateLayout.id != layout.id,
        ).update({"is_default": "No"}, synchronize_session=False)

    for index, section in enumerate(payload.sections or []):
        db.add(
            OperationTemplateLayoutSection(
                layout_id=layout.id,
                section_key=str(section.section_key or "").strip(),
                title=str(section.title or "").strip(),
                sort_order=section.sort_order or index + 1,
                collapsible=section.collapsible or "No",
                default_open=section.default_open or "Yes",
                visibility_rule_json=section.visibility_rule_json,
            )
        )

    db.flush()

    sections_in_layout = (
        db.query(OperationTemplateLayoutSection)
        .filter(OperationTemplateLayoutSection.layout_id == layout.id)
        .order_by(OperationTemplateLayoutSection.sort_order.asc(), OperationTemplateLayoutSection.id.asc())
        .all()
    )
    section_ids = {s.id for s in sections_in_layout}
    section_id_by_position = {index + 1: section.id for index, section in enumerate(sections_in_layout)}
    template_field_ids = {
        f.id
        for f in db.query(OperationTemplateField).filter(
            OperationTemplateField.template_id == template_id
        ).all()
    }

    for index, item in enumerate(payload.items or []):
        resolved_section_id = item.section_id
        if resolved_section_id not in section_ids:
            resolved_section_id = section_id_by_position.get(item.section_id)
        if resolved_section_id not in section_ids:
            raise HTTPException(status_code=400, detail=f"Invalid section_id for layout: {item.section_id}")
        if item.field_id not in template_field_ids:
            raise HTTPException(status_code=400, detail=f"field_id does not belong to template: {item.field_id}")
        db.add(
            OperationTemplateLayoutItem(
                layout_id=layout.id,
                section_id=resolved_section_id,
                field_id=item.field_id,
                row_no=item.row_no or 1,
                col_start=item.col_start or 1,
                col_span=item.col_span or 1,
                sort_order=item.sort_order or index + 1,
                label_override=clean_optional_text(item.label_override),
                placeholder_override=clean_optional_text(item.placeholder_override),
                read_only_override=clean_optional_text(item.read_only_override),
                width_mode=clean_optional_text(item.width_mode),
                rule_json=item.rule_json,
            )
        )

    db.flush()

    create_audit_log(
        db=db,
        module_name="Operations",
        action="Create Operation Template Layout",
        current_user=current_user,
        entity_type="OperationTemplateLayout",
        entity_id=layout.id,
        entity_label=f"{template.template_name} / {layout.layout_name} v{layout.version_no}",
        remarks="Operation template layout created",
        request_path=f"/operation-templates/{template_id}/layouts",
        details={
            "template_id": template_id,
            "layout_name": layout.layout_name,
            "version_no": layout.version_no,
            "status": layout.status,
            "is_default": layout.is_default,
            "section_count": len(payload.sections or []),
            "item_count": len(payload.items or []),
        },
    )

    db.commit()
    db.refresh(layout)
    return build_operation_template_layout_response(layout, db)


layout_detail_router = APIRouter(prefix="/operation-template-layouts", tags=["Operation Template Layouts"])


@layout_detail_router.get("/{layout_id}", response_model=OperationTemplateLayoutResponse)
def get_operation_template_layout(
    layout_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "View Operation Template", db)

    layout = db.query(OperationTemplateLayout).filter(OperationTemplateLayout.id == layout_id).first()
    if not layout:
        raise HTTPException(status_code=404, detail="Operation template layout not found")

    return build_operation_template_layout_response(layout, db)


@layout_detail_router.put("/{layout_id}", response_model=OperationTemplateLayoutResponse)
def update_operation_template_layout(
    layout_id: int,
    payload: OperationTemplateLayoutUpdate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Manage Operation Template", db)

    layout = db.query(OperationTemplateLayout).filter(OperationTemplateLayout.id == layout_id).first()
    if not layout:
        raise HTTPException(status_code=404, detail="Operation template layout not found")

    before_data = build_operation_template_layout_response(layout, db)

    if payload.layout_name is not None:
        name = payload.layout_name.strip()
        if name == "":
            raise HTTPException(status_code=400, detail="layout_name cannot be blank")
        layout.layout_name = name
    if payload.status is not None:
        layout.status = payload.status
    if payload.is_default is not None:
        layout.is_default = payload.is_default
    if layout.is_default == "Yes" and layout.status != "Active":
        raise HTTPException(status_code=400, detail="Default layout must be in Active status")
    if payload.sections is not None or payload.items is not None:
        if payload.sections is None or payload.items is None:
            raise HTTPException(
                status_code=400,
                detail="Both sections and items must be provided together when updating layout structure",
            )
        validate_operation_template_layout_payload(payload.sections, payload.items)

    if payload.sections is not None:
        db.query(OperationTemplateLayoutSection).filter(
            OperationTemplateLayoutSection.layout_id == layout_id
        ).delete()
        for index, section in enumerate(payload.sections):
            db.add(
                OperationTemplateLayoutSection(
                    layout_id=layout_id,
                    section_key=str(section.section_key or "").strip(),
                    title=str(section.title or "").strip(),
                    sort_order=section.sort_order or index + 1,
                    collapsible=section.collapsible or "No",
                    default_open=section.default_open or "Yes",
                    visibility_rule_json=section.visibility_rule_json,
                )
            )
        db.flush()

    if payload.items is not None:
        sections_in_layout = (
            db.query(OperationTemplateLayoutSection)
            .filter(OperationTemplateLayoutSection.layout_id == layout_id)
            .order_by(OperationTemplateLayoutSection.sort_order.asc(), OperationTemplateLayoutSection.id.asc())
            .all()
        )
        section_ids = {s.id for s in sections_in_layout}
        section_id_by_position = {index + 1: section.id for index, section in enumerate(sections_in_layout)}
        template_field_ids = {
            f.id
            for f in db.query(OperationTemplateField).filter(
                OperationTemplateField.template_id == layout.template_id
            ).all()
        }

        db.query(OperationTemplateLayoutItem).filter(
            OperationTemplateLayoutItem.layout_id == layout_id
        ).delete()
        for index, item in enumerate(payload.items):
            resolved_section_id = item.section_id
            if resolved_section_id not in section_ids:
                resolved_section_id = section_id_by_position.get(item.section_id)
            if resolved_section_id not in section_ids:
                raise HTTPException(status_code=400, detail=f"Invalid section_id for layout: {item.section_id}")
            if item.field_id not in template_field_ids:
                raise HTTPException(status_code=400, detail=f"field_id does not belong to template: {item.field_id}")
            db.add(
                OperationTemplateLayoutItem(
                    layout_id=layout_id,
                    section_id=resolved_section_id,
                    field_id=item.field_id,
                    row_no=item.row_no or 1,
                    col_start=item.col_start or 1,
                    col_span=item.col_span or 1,
                    sort_order=item.sort_order or index + 1,
                    label_override=clean_optional_text(item.label_override),
                    placeholder_override=clean_optional_text(item.placeholder_override),
                    read_only_override=clean_optional_text(item.read_only_override),
                    width_mode=clean_optional_text(item.width_mode),
                    rule_json=item.rule_json,
                )
            )
        db.flush()

    if layout.is_default == "Yes":
        db.query(OperationTemplateLayout).filter(
            OperationTemplateLayout.template_id == layout.template_id,
            OperationTemplateLayout.id != layout.id,
        ).update({"is_default": "No"}, synchronize_session=False)

    layout.updated_at = datetime.now()

    after_data = build_operation_template_layout_response(layout, db)
    create_audit_log(
        db=db,
        module_name="Operations",
        action="Update Operation Template Layout",
        current_user=current_user,
        entity_type="OperationTemplateLayout",
        entity_id=layout.id,
        entity_label=f"Template {layout.template_id} / {layout.layout_name} v{layout.version_no}",
        remarks="Operation template layout updated",
        request_path=f"/operation-template-layouts/{layout_id}",
        details={"before": before_data, "after": after_data},
    )

    db.commit()
    db.refresh(layout)
    return build_operation_template_layout_response(layout, db)