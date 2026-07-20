from datetime import datetime, date
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import (
    MaterialBalanceTemplate, MaterialBalanceTemplateColumn,
    TankStockLedger, User, Location,
)
from app.schemas import (
    MaterialBalanceTemplateCreate, MaterialBalanceTemplateUpdate,
    MaterialBalanceTemplateResponse, MaterialBalanceTemplateColumnCreate,
    MaterialBalanceTemplateColumnUpdate, MaterialBalanceTemplateColumnResponse,
    MaterialBalanceTemplateDetailResponse,
)
from app.dependencies.auth import get_current_user_from_token
from app.dependencies.permissions import require_user_permission
from app.services.audit_service import create_audit_log
from app.utils.helpers import safe_float, clean_optional_text, get_location_by_code
from app.services.material_balance_helpers import (
    normalize_material_balance_category,
    normalize_material_balance_code_value,
    get_active_material_balance_template_for_location,
    get_active_material_balance_template_columns,
    get_movement_value_for_unit,
    get_snapshot_value_for_unit,
    should_row_match_material_balance_column,
    get_global_internal_transfer_operation_codes,
    should_row_be_in_book_closing_formula,
    calculate_book_closing_from_eligible_ledger_rows,
)

router = APIRouter(prefix="/material-balance-templates", tags=["Material Balance Templates"])

VALID_MATERIAL_BALANCE_COLUMN_TYPES = {
    "OPENING",
    "MOVEMENT",
    "BOOK_CLOSING",
    "ACTUAL_CLOSING",
    "LOSS_GAIN",
    "FORMULA",
    "INFO",
}

VALID_MATERIAL_BALANCE_DIRECTIONS = {
    "IN",
    "OUT",
    "NEUTRAL",
}





def normalize_column_key(value: str):
    cleaned_value = clean_optional_text(value)

    if not cleaned_value:
        return ""

    normalized = cleaned_value.strip().lower()
    normalized = normalized.replace(" ", "_")
    normalized = normalized.replace("-", "_")
    normalized = normalized.replace("/", "_")

    while "__" in normalized:
        normalized = normalized.replace("__", "_")

    return normalized.upper()


def validate_yes_no(value: str | None, field_name: str):
    cleaned_value = clean_optional_text(value) or "No"
    cleaned_value = cleaned_value.strip().title()

    if cleaned_value not in ["Yes", "No"]:
        raise HTTPException(
            status_code=400,
            detail=f"{field_name} must be Yes or No",
        )

    return cleaned_value


def validate_material_balance_template_column_payload(column):
    column_type = clean_optional_text(column.column_type).upper()

    if column_type not in VALID_MATERIAL_BALANCE_COLUMN_TYPES:
        raise HTTPException(
            status_code=400,
            detail=(
                "Column Type must be one of: "
                + ", ".join(sorted(VALID_MATERIAL_BALANCE_COLUMN_TYPES))
            ),
        )

    movement_direction = clean_optional_text(column.movement_direction)

    if column_type == "MOVEMENT":
        if not movement_direction:
            raise HTTPException(
                status_code=400,
                detail="Movement Direction is required for MOVEMENT columns",
            )

        movement_direction = movement_direction.upper()

        if movement_direction not in VALID_MATERIAL_BALANCE_DIRECTIONS:
            raise HTTPException(
                status_code=400,
                detail="Movement Direction must be IN, OUT, or NEUTRAL",
            )

        if len(column.mapped_operation_codes or []) == 0:
            raise HTTPException(
                status_code=400,
                detail="At least one Tank Operation must be mapped for MOVEMENT columns",
            )
    else:
        movement_direction = None

    include_in_material_balance = validate_yes_no(
        column.include_in_material_balance,
        "Include in Material Balance",
    )

    include_in_book_closing = validate_yes_no(
        column.include_in_book_closing,
        "Include in Book Closing",
    )

    is_internal_transfer = validate_yes_no(
        column.is_internal_transfer,
        "Is Internal Transfer",
    )

    if is_internal_transfer == "Yes":
        include_in_material_balance = "No"
        include_in_book_closing = "No"

    column_key = normalize_column_key(column.column_key or column.column_label)

    if not column_key:
        raise HTTPException(
            status_code=400,
            detail="Column Key is required",
        )

    mapped_operation_codes = [
        normalize_column_key(item)
        for item in (column.mapped_operation_codes or [])
        if clean_optional_text(item)
    ]

    excluded_operation_codes = [
        normalize_column_key(item)
        for item in (column.excluded_operation_codes or [])
        if clean_optional_text(item)
    ]

    return {
        "column_key": column_key,
        "column_type": column_type,
        "movement_direction": movement_direction,
        "mapped_operation_codes": mapped_operation_codes,
        "excluded_operation_codes": excluded_operation_codes,
        "include_in_material_balance": include_in_material_balance,
        "include_in_book_closing": include_in_book_closing,
        "is_internal_transfer": is_internal_transfer,
    }


def build_material_balance_template_response(
    template: MaterialBalanceTemplate,
):
    return {
        "id": template.id,
        "location_code": template.location_code,
        "template_name": template.template_name,
        "description": template.description,
        "status": template.status,
        "created_at": template.created_at,
        "updated_at": template.updated_at,
    }


def build_material_balance_template_column_response(
    column: MaterialBalanceTemplateColumn,
):
    return {
        "id": column.id,
        "template_id": column.template_id,
        "column_label": column.column_label,
        "column_key": column.column_key,
        "column_order": column.column_order,
        "column_type": column.column_type,
        "movement_direction": column.movement_direction,
        "mapped_operation_codes": column.mapped_operation_codes or [],
        "excluded_operation_codes": column.excluded_operation_codes or [],
        "include_in_material_balance": column.include_in_material_balance,
        "include_in_book_closing": column.include_in_book_closing,
        "is_internal_transfer": column.is_internal_transfer,
        "formula_json": column.formula_json,
        "remarks": column.remarks,
        "status": column.status,
        "created_at": column.created_at,
        "updated_at": column.updated_at,
    }


def build_material_balance_template_detail_response(
    template: MaterialBalanceTemplate,
    db: Session,
):
    columns = (
        db.query(MaterialBalanceTemplateColumn)
        .filter(MaterialBalanceTemplateColumn.template_id == template.id)
        .order_by(
            MaterialBalanceTemplateColumn.column_order.asc(),
            MaterialBalanceTemplateColumn.id.asc(),
        )
        .all()
    )

    response = build_material_balance_template_response(template)
    response["columns"] = [
        build_material_balance_template_column_response(column)
        for column in columns
    ]

    return response


@router.get(
    "",
    response_model=list[MaterialBalanceTemplateResponse],
)
def get_material_balance_templates(
    location_code: str | None = None,
    status: str | None = None,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "View Material Balance Template",
        db,
    )

    query = db.query(MaterialBalanceTemplate)

    cleaned_location_code = clean_optional_text(location_code)
    cleaned_status = clean_optional_text(status)

    if cleaned_location_code:
        query = query.filter(
            MaterialBalanceTemplate.location_code.ilike(cleaned_location_code)
        )

    if cleaned_status:
        query = query.filter(MaterialBalanceTemplate.status == cleaned_status)

    templates = (
        query.order_by(
            MaterialBalanceTemplate.location_code.asc(),
            MaterialBalanceTemplate.template_name.asc(),
        )
        .all()
    )

    return [
        build_material_balance_template_response(template)
        for template in templates
    ]


@router.get(
    "/{template_id}",
    response_model=MaterialBalanceTemplateDetailResponse,
)
def get_material_balance_template_detail(
    template_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "View Material Balance Template",
        db,
    )

    template = (
        db.query(MaterialBalanceTemplate)
        .filter(MaterialBalanceTemplate.id == template_id)
        .first()
    )

    if not template:
        raise HTTPException(
            status_code=404,
            detail="Material Balance Template not found",
        )

    return build_material_balance_template_detail_response(template, db)


@router.post(
    "",
    response_model=MaterialBalanceTemplateResponse,
)
def create_material_balance_template(
    template_data: MaterialBalanceTemplateCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage Material Balance Template",
        db,
    )

    location_code = clean_optional_text(template_data.location_code)

    if not location_code:
        raise HTTPException(
            status_code=400,
            detail="Location is required",
        )

    location = get_location_by_code(location_code, db)

    if not location:
        raise HTTPException(
            status_code=404,
            detail=f"Location {location_code} not found",
        )

    template_name = clean_optional_text(template_data.template_name)

    if not template_name:
        raise HTTPException(
            status_code=400,
            detail="Template Name is required",
        )

    existing_template = (
        db.query(MaterialBalanceTemplate)
        .filter(
            MaterialBalanceTemplate.location_code.ilike(location_code),
            MaterialBalanceTemplate.template_name.ilike(template_name),
        )
        .first()
    )

    if existing_template:
        raise HTTPException(
            status_code=400,
            detail="Material Balance Template already exists for this location",
        )

    new_template = MaterialBalanceTemplate(
        location_code=location_code.upper(),
        template_name=template_name,
        description=clean_optional_text(template_data.description),
        status=template_data.status or "Active",
    )

    db.add(new_template)
    db.flush()

    create_audit_log(
        db=db,
        module_name="Material Balance Template",
        action="Create Material Balance Template",
        current_user=current_user,
        entity_type="MaterialBalanceTemplate",
        entity_id=new_template.id,
        entity_label=new_template.template_name,
        remarks="Created Material Balance Template",
        request_path="/material-balance-templates",
        details=build_material_balance_template_response(new_template),
    )

    db.commit()
    db.refresh(new_template)

    return build_material_balance_template_response(new_template)


@router.put(
    "/{template_id}",
    response_model=MaterialBalanceTemplateResponse,
)
def update_material_balance_template(
    template_id: int,
    template_data: MaterialBalanceTemplateUpdate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage Material Balance Template",
        db,
    )

    template = (
        db.query(MaterialBalanceTemplate)
        .filter(MaterialBalanceTemplate.id == template_id)
        .first()
    )

    if not template:
        raise HTTPException(
            status_code=404,
            detail="Material Balance Template not found",
        )

    location_code = clean_optional_text(template_data.location_code)
    template_name = clean_optional_text(template_data.template_name)

    if not location_code:
        raise HTTPException(status_code=400, detail="Location is required")

    if not template_name:
        raise HTTPException(status_code=400, detail="Template Name is required")

    duplicate_template = (
        db.query(MaterialBalanceTemplate)
        .filter(
            MaterialBalanceTemplate.id != template_id,
            MaterialBalanceTemplate.location_code.ilike(location_code),
            MaterialBalanceTemplate.template_name.ilike(template_name),
        )
        .first()
    )

    if duplicate_template:
        raise HTTPException(
            status_code=400,
            detail="Another Material Balance Template already exists for this location",
        )

    old_details = build_material_balance_template_response(template)

    template.location_code = location_code.upper()
    template.template_name = template_name
    template.description = clean_optional_text(template_data.description)
    template.status = template_data.status or "Active"
    template.updated_at = datetime.now()

    db.flush()

    create_audit_log(
        db=db,
        module_name="Material Balance Template",
        action="Update Material Balance Template",
        current_user=current_user,
        entity_type="MaterialBalanceTemplate",
        entity_id=template.id,
        entity_label=template.template_name,
        remarks="Updated Material Balance Template",
        request_path=f"/material-balance-templates/{template_id}",
        details={
            "old": old_details,
            "new": build_material_balance_template_response(template),
        },
    )

    db.commit()
    db.refresh(template)

    return build_material_balance_template_response(template)


@router.delete("/{template_id}")
def delete_material_balance_template(
    template_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage Material Balance Template",
        db,
    )

    template = (
        db.query(MaterialBalanceTemplate)
        .filter(MaterialBalanceTemplate.id == template_id)
        .first()
    )

    if not template:
        raise HTTPException(
            status_code=404,
            detail="Material Balance Template not found",
        )

    old_details = build_material_balance_template_detail_response(template, db)

    db.delete(template)

    create_audit_log(
        db=db,
        module_name="Material Balance Template",
        action="Delete Material Balance Template",
        current_user=current_user,
        entity_type="MaterialBalanceTemplate",
        entity_id=template_id,
        entity_label=template.template_name,
        remarks="Deleted Material Balance Template",
        request_path=f"/material-balance-templates/{template_id}",
        details=old_details,
    )

    db.commit()

    return {"message": "Material Balance Template deleted successfully"}


@router.post(
    "/{template_id}/columns",
    response_model=MaterialBalanceTemplateColumnResponse,
)
def create_material_balance_template_column(
    template_id: int,
    column_data: MaterialBalanceTemplateColumnCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage Material Balance Template",
        db,
    )

    template = (
        db.query(MaterialBalanceTemplate)
        .filter(MaterialBalanceTemplate.id == template_id)
        .first()
    )

    if not template:
        raise HTTPException(
            status_code=404,
            detail="Material Balance Template not found",
        )

    validated = validate_material_balance_template_column_payload(column_data)

    duplicate_column = (
        db.query(MaterialBalanceTemplateColumn)
        .filter(
            MaterialBalanceTemplateColumn.template_id == template_id,
            MaterialBalanceTemplateColumn.column_key == validated["column_key"],
        )
        .first()
    )

    if duplicate_column:
        raise HTTPException(
            status_code=400,
            detail="Column Key already exists in this template",
        )

    new_column = MaterialBalanceTemplateColumn(
        template_id=template_id,
        column_label=clean_optional_text(column_data.column_label),
        column_key=validated["column_key"],
        column_order=column_data.column_order or 1,
        column_type=validated["column_type"],
        movement_direction=validated["movement_direction"],
        mapped_operation_codes=validated["mapped_operation_codes"],
        excluded_operation_codes=validated["excluded_operation_codes"],
        include_in_material_balance=validated["include_in_material_balance"],
        include_in_book_closing=validated["include_in_book_closing"],
        is_internal_transfer=validated["is_internal_transfer"],
        formula_json=column_data.formula_json,
        remarks=clean_optional_text(column_data.remarks),
        status=column_data.status or "Active",
    )

    db.add(new_column)
    db.flush()

    create_audit_log(
        db=db,
        module_name="Material Balance Template",
        action="Create Material Balance Template Column",
        current_user=current_user,
        entity_type="MaterialBalanceTemplateColumn",
        entity_id=new_column.id,
        entity_label=new_column.column_label,
        remarks="Created Material Balance Template Column",
        request_path=f"/material-balance-templates/{template_id}/columns",
        details=build_material_balance_template_column_response(new_column),
    )

    db.commit()
    db.refresh(new_column)

    return build_material_balance_template_column_response(new_column)


@router.put(
    "/material-balance-template-columns/{column_id}",
    response_model=MaterialBalanceTemplateColumnResponse,
)
def update_material_balance_template_column(
    column_id: int,
    column_data: MaterialBalanceTemplateColumnUpdate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage Material Balance Template",
        db,
    )

    column = (
        db.query(MaterialBalanceTemplateColumn)
        .filter(MaterialBalanceTemplateColumn.id == column_id)
        .first()
    )

    if not column:
        raise HTTPException(
            status_code=404,
            detail="Material Balance Template Column not found",
        )

    validated = validate_material_balance_template_column_payload(column_data)

    duplicate_column = (
        db.query(MaterialBalanceTemplateColumn)
        .filter(
            MaterialBalanceTemplateColumn.id != column_id,
            MaterialBalanceTemplateColumn.template_id == column.template_id,
            MaterialBalanceTemplateColumn.column_key == validated["column_key"],
        )
        .first()
    )

    if duplicate_column:
        raise HTTPException(
            status_code=400,
            detail="Column Key already exists in this template",
        )

    old_details = build_material_balance_template_column_response(column)

    column.column_label = clean_optional_text(column_data.column_label)
    column.column_key = validated["column_key"]
    column.column_order = column_data.column_order or 1
    column.column_type = validated["column_type"]
    column.movement_direction = validated["movement_direction"]
    column.mapped_operation_codes = validated["mapped_operation_codes"]
    column.excluded_operation_codes = validated["excluded_operation_codes"]
    column.include_in_material_balance = validated["include_in_material_balance"]
    column.include_in_book_closing = validated["include_in_book_closing"]
    column.is_internal_transfer = validated["is_internal_transfer"]
    column.formula_json = column_data.formula_json
    column.remarks = clean_optional_text(column_data.remarks)
    column.status = column_data.status or "Active"
    column.updated_at = datetime.now()

    db.flush()

    create_audit_log(
        db=db,
        module_name="Material Balance Template",
        action="Update Material Balance Template Column",
        current_user=current_user,
        entity_type="MaterialBalanceTemplateColumn",
        entity_id=column.id,
        entity_label=column.column_label,
        remarks="Updated Material Balance Template Column",
        request_path=f"/material-balance-template-columns/{column_id}",
        details={
            "old": old_details,
            "new": build_material_balance_template_column_response(column),
        },
    )

    db.commit()
    db.refresh(column)

    return build_material_balance_template_column_response(column)


@router.delete("/material-balance-template-columns/{column_id}")
def delete_material_balance_template_column(
    column_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage Material Balance Template",
        db,
    )

    column = (
        db.query(MaterialBalanceTemplateColumn)
        .filter(MaterialBalanceTemplateColumn.id == column_id)
        .first()
    )

    if not column:
        raise HTTPException(
            status_code=404,
            detail="Material Balance Template Column not found",
        )

    old_details = build_material_balance_template_column_response(column)

    db.delete(column)

    create_audit_log(
        db=db,
        module_name="Material Balance Template",
        action="Delete Material Balance Template Column",
        current_user=current_user,
        entity_type="MaterialBalanceTemplateColumn",
        entity_id=column_id,
        entity_label=column.column_label,
        remarks="Deleted Material Balance Template Column",
        request_path=f"/material-balance-template-columns/{column_id}",
        details=old_details,
    )

    db.commit()

    return {"message": "Material Balance Template Column deleted successfully"}
