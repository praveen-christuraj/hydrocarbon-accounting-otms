from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import (
    AssetType,
    CalibrationTemplate,
    CalibrationTemplateColumn,
    AssetCalibrationTable,
    User,
)
from app.schemas import (
    CalibrationTemplateCreate,
    CalibrationTemplateResponse,
)
from app.dependencies.auth import get_current_user_from_token
from app.dependencies.permissions import require_user_permission
from app.services.audit_service import create_audit_log
from app.utils.helpers import clean_optional_text

router = APIRouter(prefix="/calibration-templates", tags=["Calibration Templates"])


def build_calibration_template_response(template: CalibrationTemplate, db: Session):
    template_columns = (
        db.query(CalibrationTemplateColumn)
        .filter(CalibrationTemplateColumn.template_id == template.id)
        .order_by(
            CalibrationTemplateColumn.sort_order,
            CalibrationTemplateColumn.id,
        )
        .all()
    )

    return {
        "id": template.id,
        "template_name": template.template_name,
        "asset_type_code": template.asset_type_code,
        "calibration_type": template.calibration_type,
        "description": template.description,
        "status": template.status,
        "created_at": template.created_at,
        "updated_at": template.updated_at,
        "columns": [
            {
                "id": column.id,
                "column_name": column.column_name,
                "data_type": column.data_type,
                "unit": column.unit,
                "is_required": column.is_required,
                "interpolation_role": column.interpolation_role,
                "sort_order": column.sort_order,
            }
            for column in template_columns
        ],
    }


def validate_calibration_template(template: CalibrationTemplateCreate, db: Session):
    asset_type = db.query(AssetType).filter(
        AssetType.asset_type_code.ilike(template.asset_type_code)
    ).first()

    if not asset_type:
        raise HTTPException(
            status_code=400,
            detail="Asset type not found",
        )

    if len(template.columns) == 0:
        raise HTTPException(
            status_code=400,
            detail="Please add at least one template column",
        )

    column_names = [
        column.column_name.strip().lower()
        for column in template.columns
    ]

    if len(column_names) != len(set(column_names)):
        raise HTTPException(
            status_code=400,
            detail="Duplicate column names are not allowed in the same template",
        )

    input_x_exists = any(
        column.interpolation_role == "Input X"
        for column in template.columns
    )

    output_exists = any(
        column.interpolation_role == "Output"
        for column in template.columns
    )

    if not input_x_exists:
        raise HTTPException(
            status_code=400,
            detail="At least one column must have Interpolation Role as Input X",
        )

    if not output_exists:
        raise HTTPException(
            status_code=400,
            detail="At least one column must have Interpolation Role as Output",
        )


@router.get("", response_model=list[CalibrationTemplateResponse])
def get_calibration_templates(
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "View Calibration Template",
        db,
    )

    templates = (
        db.query(CalibrationTemplate)
        .order_by(CalibrationTemplate.id)
        .all()
    )

    return [
        build_calibration_template_response(template, db)
        for template in templates
    ]


@router.post("", response_model=CalibrationTemplateResponse)
def create_calibration_template(
    template: CalibrationTemplateCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage Calibration Template",
        db,
    )

    existing_template = db.query(CalibrationTemplate).filter(
        CalibrationTemplate.template_name.ilike(template.template_name)
    ).first()

    if existing_template:
        raise HTTPException(
            status_code=400,
            detail="Template name already exists",
        )

    validate_calibration_template(template, db)

    new_template = CalibrationTemplate(
        template_name=template.template_name.strip(),
        asset_type_code=template.asset_type_code.strip(),
        calibration_type=template.calibration_type.strip(),
        description=clean_optional_text(template.description),
        status=template.status,
    )

    db.add(new_template)
    db.flush()

    for index, column in enumerate(template.columns):
        new_column = CalibrationTemplateColumn(
            template_id=new_template.id,
            column_name=column.column_name.strip(),
            data_type=column.data_type,
            unit=clean_optional_text(column.unit),
            is_required=column.is_required,
            interpolation_role=column.interpolation_role,
            sort_order=column.sort_order or index + 1,
        )
        db.add(new_column)

    db.flush()

    after_data = build_calibration_template_response(new_template, db)

    create_audit_log(
        db=db,
        module_name="Calibration Template Master",
        action="Create Calibration Template",
        current_user=current_user,
        entity_type="CalibrationTemplate",
        entity_id=new_template.id,
        entity_label=new_template.template_name,
        remarks="Calibration template created",
        request_path="/calibration-templates",
        details={
            "after": after_data,
        },
    )

    db.commit()
    db.refresh(new_template)

    return build_calibration_template_response(new_template, db)


@router.put("/{template_id}", response_model=CalibrationTemplateResponse)
def update_calibration_template(
    template_id: int,
    template: CalibrationTemplateCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage Calibration Template",
        db,
    )

    existing_template = db.query(CalibrationTemplate).filter(
        CalibrationTemplate.id == template_id
    ).first()

    if not existing_template:
        raise HTTPException(
            status_code=404,
            detail="Calibration template not found",
        )

    duplicate_template = db.query(CalibrationTemplate).filter(
        CalibrationTemplate.template_name.ilike(template.template_name),
        CalibrationTemplate.id != template_id,
    ).first()

    if duplicate_template:
        raise HTTPException(
            status_code=400,
            detail="Template name already exists",
        )

    validate_calibration_template(template, db)

    before_data = build_calibration_template_response(existing_template, db)

    existing_template.template_name = template.template_name.strip()
    existing_template.asset_type_code = template.asset_type_code.strip()
    existing_template.calibration_type = template.calibration_type.strip()
    existing_template.description = clean_optional_text(template.description)
    existing_template.status = template.status

    db.query(CalibrationTemplateColumn).filter(
        CalibrationTemplateColumn.template_id == template_id
    ).delete()

    for index, column in enumerate(template.columns):
        new_column = CalibrationTemplateColumn(
            template_id=template_id,
            column_name=column.column_name.strip(),
            data_type=column.data_type,
            unit=clean_optional_text(column.unit),
            is_required=column.is_required,
            interpolation_role=column.interpolation_role,
            sort_order=column.sort_order or index + 1,
        )
        db.add(new_column)

    db.flush()

    after_data = build_calibration_template_response(existing_template, db)

    create_audit_log(
        db=db,
        module_name="Calibration Template Master",
        action="Update Calibration Template",
        current_user=current_user,
        entity_type="CalibrationTemplate",
        entity_id=existing_template.id,
        entity_label=existing_template.template_name,
        remarks="Calibration template updated",
        request_path=f"/calibration-templates/{template_id}",
        details={
            "before": before_data,
            "after": after_data,
        },
    )

    db.commit()
    db.refresh(existing_template)

    return build_calibration_template_response(existing_template, db)


@router.delete("/{template_id}")
def delete_calibration_template(
    template_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage Calibration Template",
        db,
    )

    existing_template = db.query(CalibrationTemplate).filter(
        CalibrationTemplate.id == template_id
    ).first()

    if not existing_template:
        raise HTTPException(
            status_code=404,
            detail="Calibration template not found",
        )

    used_calibration_table = (
        db.query(AssetCalibrationTable)
        .filter(AssetCalibrationTable.template_id == template_id)
        .first()
    )

    if used_calibration_table:
        raise HTTPException(
            status_code=400,
            detail="Cannot delete calibration template because it is used by asset calibration tables",
        )

    deleted_data = build_calibration_template_response(existing_template, db)

    create_audit_log(
        db=db,
        module_name="Calibration Template Master",
        action="Delete Calibration Template",
        current_user=current_user,
        entity_type="CalibrationTemplate",
        entity_id=existing_template.id,
        entity_label=existing_template.template_name,
        remarks="Calibration template deleted",
        request_path=f"/calibration-templates/{template_id}",
        details={
            "deleted": deleted_data,
        },
    )

    db.query(CalibrationTemplateColumn).filter(
        CalibrationTemplateColumn.template_id == template_id
    ).delete()

    db.delete(existing_template)
    db.commit()

    return {
        "message": "Calibration template deleted successfully"
    }