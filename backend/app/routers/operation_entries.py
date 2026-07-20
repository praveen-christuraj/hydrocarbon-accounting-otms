from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import (
    Asset,
    Location,
    OperationTemplate,
    OperationTemplateField,
    OperationTransaction,
    OperationTransactionValue,
    OperationTransactionStatusHistory,
    OperationType,
    User,
)
from app.schemas import (
    OperationEntryCreate,
    OperationEntryResponse,
)
from app.dependencies.auth import get_current_user_from_token
from app.dependencies.permissions import (
    require_user_permission,
    evaluate_operation_workflow_policy,
)
from app.services.audit_service import create_audit_log
from app.utils.helpers import (
    clean_optional_text,
    get_transaction_ticket_number,
)
from app.routers.operation_transactions import (
    build_operation_transaction_response,
    generate_operation_number,
    generate_operation_ticket_number,
    normalize_jsonb_value,
    get_trip_by_convoy_or_none,
    ensure_trip_not_closed,
    ensure_shuttle_voyage_not_closed,
    get_or_create_shuttle_voyage,
)

router = APIRouter(prefix="/operation-entries", tags=["Operation Entries"])


def build_operation_entry_response(
    transaction: OperationTransaction,
    db: Session,
):
    template = None

    if transaction.operation_template_id:
        template = db.query(OperationTemplate).filter(
            OperationTemplate.id == transaction.operation_template_id
        ).first()

    values = (
        db.query(OperationTransactionValue)
        .filter(OperationTransactionValue.transaction_id == transaction.id)
        .order_by(
            OperationTransactionValue.sort_order,
            OperationTransactionValue.id,
        )
        .all()
    )

    return {
        "transaction": build_operation_transaction_response(transaction, db),
        "operation_template_id": transaction.operation_template_id,
        "operation_template_name": template.template_name if template else "",
        "values": [
            {
                "id": value.id,
                "field_code": value.field_code,
                "field_name": value.field_name,
                "field_group": value.field_group,
                "data_type": value.data_type,
                "unit": value.unit,
                "input_mode": value.input_mode,
                "calculation_role": value.calculation_role,
                "field_value": value.field_value,
                "sort_order": value.sort_order,
            }
            for value in values
        ],
    }


def validate_operation_entry(
    entry: OperationEntryCreate,
    db: Session,
):
    template = db.query(OperationTemplate).filter(
        OperationTemplate.id == entry.operation_template_id
    ).first()

    if not template:
        raise HTTPException(
            status_code=400,
            detail="Operation template not found",
        )

    if template.status != "Active":
        raise HTTPException(
            status_code=400,
            detail="Only Active operation templates can be used",
        )

    transaction_operation_type_code = clean_optional_text(
        getattr(entry.transaction, "operation_type_code", None)
    )

    if transaction_operation_type_code is None:
        transaction_operation_type_code = template.operation_type_code

    if transaction_operation_type_code is None:
        raise HTTPException(
            status_code=400,
            detail="Operation type is missing in operation entry request",
        )

    if template.operation_type_code.lower() != transaction_operation_type_code.lower():
        raise HTTPException(
            status_code=400,
            detail="Selected template does not belong to selected operation type",
        )

    operation_type = db.query(OperationType).filter(
        OperationType.operation_type_code.ilike(transaction_operation_type_code)
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

    if not clean_optional_text(entry.transaction.primary_asset_code):
        raise HTTPException(
            status_code=400,
            detail="Primary asset is missing in operation entry request",
        )

    asset = db.query(Asset).filter(
        Asset.asset_code.ilike(entry.transaction.primary_asset_code)
    ).first()

    if not asset:
        raise HTTPException(
            status_code=400,
            detail="Asset not found",
        )

    if asset.status != "Active":
        raise HTTPException(
            status_code=400,
            detail="Only Active assets can be used for operation",
        )

    if asset.asset_type_code.lower() != operation_type.applicable_asset_type_code.lower():
        raise HTTPException(
            status_code=400,
            detail="Selected operation type is not applicable for this asset type",
        )

    if not clean_optional_text(entry.transaction.origin_location_code):
        raise HTTPException(
            status_code=400,
            detail="Origin location is missing in operation entry request",
        )

    origin_location = db.query(Location).filter(
        Location.location_code.ilike(entry.transaction.origin_location_code)
    ).first()

    if not origin_location:
        raise HTTPException(
            status_code=400,
            detail="Origin location not found",
        )

    if origin_location.status != "Active":
        raise HTTPException(
            status_code=400,
            detail="Only Active origin location can be used",
        )

    if entry.transaction.destination_location_code:
        destination_location = db.query(Location).filter(
            Location.location_code.ilike(entry.transaction.destination_location_code)
        ).first()

        if not destination_location:
            raise HTTPException(
                status_code=400,
                detail="Destination location not found",
            )

        if destination_location.status != "Active":
            raise HTTPException(
                status_code=400,
                detail="Only Active destination location can be used",
            )

    if operation_type.requires_sender_location == "Yes":
        if not entry.transaction.sender_location_code:
            raise HTTPException(
                status_code=400,
                detail="Sender location is required for this operation type",
            )

    if operation_type.requires_receiver_location == "Yes":
        if not entry.transaction.receiver_location_code:
            raise HTTPException(
                status_code=400,
                detail="Receiver location is required for this operation type",
            )

    template_fields = (
        db.query(OperationTemplateField)
        .filter(
            OperationTemplateField.template_id == template.id,
            OperationTemplateField.status == "Active",
        )
        .order_by(OperationTemplateField.sort_order, OperationTemplateField.id)
        .all()
    )

    if len(template_fields) == 0:
        raise HTTPException(
            status_code=400,
            detail="Selected operation template has no active fields",
        )

    field_map = {
        field.field_code: field
        for field in template_fields
    }

    value_map = {
        value.field_code: value.field_value
        for value in entry.values
    }

    for field in template_fields:
        if field.is_required == "Yes" and field.input_mode == "Manual":
            if field.field_code not in value_map:
                raise HTTPException(
                    status_code=400,
                    detail=f"Required field missing: {field.field_name}",
                )

            value = value_map.get(field.field_code)

            if value is None or str(value).strip() == "":
                raise HTTPException(
                    status_code=400,
                    detail=f"Required field cannot be blank: {field.field_name}",
                )

    for value in entry.values:
        if value.field_code not in field_map:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid field code: {value.field_code}",
            )

    return (
        template,
        operation_type,
        asset,
        template_fields,
        value_map,
        transaction_operation_type_code,
    )


@router.get(
    "/",
    response_model=list[OperationEntryResponse],
)
def get_operation_entries(
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "View Operation Transaction",
        db,
    )

    transactions = (
        db.query(OperationTransaction)
        .filter(OperationTransaction.operation_template_id.isnot(None))
        .filter(OperationTransaction.status.in_(["Draft", "Rejected"]))
        .order_by(OperationTransaction.id.desc())
        .all()
    )

    return [
        build_operation_entry_response(transaction, db)
        for transaction in transactions
    ]


@router.post(
    "/",
    response_model=OperationEntryResponse,
)
def create_operation_entry(
    entry: OperationEntryCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Create Operation Entry",
        db,
    )

    (
        template,
        operation_type,
        asset,
        template_fields,
        value_map,
        transaction_operation_type_code,
    ) = validate_operation_entry(entry, db)

    policy_allowed, policy_reason, _ = evaluate_operation_workflow_policy(
        db=db,
        current_user=current_user,
        action_code="CREATE_ENTRY",
        operation_type_code=clean_optional_text(transaction_operation_type_code),
        operation_template_id=template.id,
        asset_type_code=clean_optional_text(asset.asset_type_code),
        location_code=clean_optional_text(entry.transaction.origin_location_code),
    )
    if policy_allowed is False:
        raise HTTPException(status_code=403, detail=f"Workflow policy denied action: {policy_reason}")

    trip = None
    if str(operation_type.applicable_asset_type_code or "").strip().upper() == "BARGE":
        trip = get_trip_by_convoy_or_none(db, entry.transaction.convoy_number)
        ensure_trip_not_closed(trip)

    if str(template.entry_layout_type or "").strip() == "Shuttle Tracking":
        voyage = get_or_create_shuttle_voyage(
            db=db,
            location_code=entry.transaction.origin_location_code,
            shuttle_number=entry.transaction.convoy_number or "",
            shuttle_asset_code=asset.asset_code,
            current_user=current_user,
        )
        ensure_shuttle_voyage_not_closed(voyage)

    ticket_number = generate_operation_ticket_number(
        db=db,
        location_code=entry.transaction.origin_location_code,
        asset_code=asset.asset_code,
        operation_date=entry.transaction.operation_date,
    )

    new_transaction = OperationTransaction(
        operation_number=generate_operation_number(db),
        operation_ticket_number=ticket_number,
        operation_type_code=transaction_operation_type_code,
        operation_template_id=template.id,
        primary_asset_code=asset.asset_code,
        primary_asset_type_code=asset.asset_type_code,
        convoy_number=clean_optional_text(entry.transaction.convoy_number),
        origin_location_code=entry.transaction.origin_location_code.strip(),
        destination_location_code=clean_optional_text(
            entry.transaction.destination_location_code
        ),
        sender_location_code=clean_optional_text(entry.transaction.sender_location_code),
        receiver_location_code=clean_optional_text(entry.transaction.receiver_location_code),
        operation_date=entry.transaction.operation_date,
        operation_start_datetime=entry.transaction.operation_start_datetime,
        operation_end_datetime=entry.transaction.operation_end_datetime,
        product_name=clean_optional_text(entry.transaction.product_name),
        created_by=(
            f"{current_user.full_name} ({current_user.username})"
            if current_user.full_name
            else current_user.username
        ),
        remarks=clean_optional_text(entry.transaction.remarks),
        status=entry.transaction.status or "Draft",
    )

    db.add(new_transaction)
    db.flush()

    for field in template_fields:
        new_value = OperationTransactionValue(
            transaction_id=new_transaction.id,
            field_code=field.field_code,
            field_name=field.field_name,
            field_group=field.field_group,
            data_type=field.data_type,
            unit=field.unit,
            input_mode=field.input_mode,
            calculation_role=field.calculation_role,
            field_value=normalize_jsonb_value(value_map.get(field.field_code)),
            sort_order=field.sort_order,
        )

        db.add(new_value)

    create_audit_log(
        db=db,
        module_name="Operation Transaction",
        action="Create Operation Entry",
        current_user=current_user,
        entity_type="OperationTransaction",
        entity_id=new_transaction.id,
        entity_label=ticket_number,
        ticket_number=ticket_number,
        operation_number=new_transaction.operation_number,
        new_status=new_transaction.status,
        remarks="Operation entry created",
        request_path="/operation-entries",
        details={
            "operation_type_code": new_transaction.operation_type_code,
            "operation_template_id": new_transaction.operation_template_id,
            "primary_asset_code": new_transaction.primary_asset_code,
            "origin_location_code": new_transaction.origin_location_code,
            "operation_date": str(new_transaction.operation_date),
        },
    )

    db.commit()
    db.refresh(new_transaction)

    return build_operation_entry_response(new_transaction, db)


@router.put(
    "/{transaction_id}",
    response_model=OperationEntryResponse,
)
def update_operation_entry(
    transaction_id: int,
    entry: OperationEntryCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Create Operation Entry",
        db,
    )

    existing_transaction = db.query(OperationTransaction).filter(
        OperationTransaction.id == transaction_id
    ).first()

    if not existing_transaction:
        raise HTTPException(
            status_code=404,
            detail="Operation entry not found",
        )

    if existing_transaction.status not in ["Draft", "Rejected"]:
        raise HTTPException(
            status_code=400,
            detail=(
                "Only Draft or Rejected operation entries can be edited. "
                "Recall Submitted tickets to Draft before editing."
            ),
        )

    convoy_to_check = clean_optional_text(entry.transaction.convoy_number) or clean_optional_text(existing_transaction.convoy_number)
    trip = get_trip_by_convoy_or_none(db, convoy_to_check)
    ensure_trip_not_closed(trip)

    (
        template,
        operation_type,
        asset,
        template_fields,
        value_map,
        transaction_operation_type_code,
    ) = validate_operation_entry(entry, db)

    policy_allowed, policy_reason, _ = evaluate_operation_workflow_policy(
        db=db,
        current_user=current_user,
        action_code="EDIT_DRAFT",
        operation_type_code=clean_optional_text(transaction_operation_type_code),
        operation_template_id=template.id,
        asset_type_code=clean_optional_text(asset.asset_type_code),
        location_code=clean_optional_text(entry.transaction.origin_location_code),
    )
    if policy_allowed is False:
        raise HTTPException(status_code=403, detail=f"Workflow policy denied action: {policy_reason}")

    existing_transaction.operation_type_code = transaction_operation_type_code
    existing_transaction.operation_template_id = template.id
    existing_transaction.primary_asset_code = asset.asset_code
    existing_transaction.primary_asset_type_code = asset.asset_type_code
    existing_transaction.convoy_number = clean_optional_text(entry.transaction.convoy_number)
    existing_transaction.origin_location_code = entry.transaction.origin_location_code.strip()
    existing_transaction.destination_location_code = clean_optional_text(
        entry.transaction.destination_location_code
    )
    existing_transaction.sender_location_code = clean_optional_text(
        entry.transaction.sender_location_code
    )
    existing_transaction.receiver_location_code = clean_optional_text(
        entry.transaction.receiver_location_code
    )
    existing_transaction.operation_date = entry.transaction.operation_date
    existing_transaction.operation_start_datetime = entry.transaction.operation_start_datetime
    existing_transaction.operation_end_datetime = entry.transaction.operation_end_datetime
    existing_transaction.product_name = clean_optional_text(entry.transaction.product_name)
    existing_transaction.remarks = clean_optional_text(entry.transaction.remarks)
    existing_transaction.updated_at = datetime.now()

    db.query(OperationTransactionValue).filter(
        OperationTransactionValue.transaction_id == transaction_id
    ).delete()

    for field in template_fields:
        new_value = OperationTransactionValue(
            transaction_id=transaction_id,
            field_code=field.field_code,
            field_name=field.field_name,
            field_group=field.field_group,
            data_type=field.data_type,
            unit=field.unit,
            input_mode=field.input_mode,
            calculation_role=field.calculation_role,
            field_value=normalize_jsonb_value(value_map.get(field.field_code)),
            sort_order=field.sort_order,
        )

        db.add(new_value)

    changed_by = (
        f"{current_user.full_name} ({current_user.username})"
        if current_user.full_name
        else current_user.username
    )

    existing_remarks = existing_transaction.remarks or ""
    existing_transaction.remarks = (
        f"{existing_remarks}\n"
        f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] "
        f"Edited by {changed_by}"
    ).strip()

    create_audit_log(
        db=db,
        module_name="Operation Transaction",
        action="Update Operation Entry",
        current_user=current_user,
        entity_type="OperationTransaction",
        entity_id=existing_transaction.id,
        entity_label=get_transaction_ticket_number(existing_transaction),
        ticket_number=get_transaction_ticket_number(existing_transaction),
        operation_number=existing_transaction.operation_number,
        old_status=existing_transaction.status,
        new_status=existing_transaction.status,
        remarks="Operation entry edited",
        request_path=f"/operation-entries/{transaction_id}",
        details={
            "operation_type_code": existing_transaction.operation_type_code,
            "operation_template_id": existing_transaction.operation_template_id,
            "primary_asset_code": existing_transaction.primary_asset_code,
            "origin_location_code": existing_transaction.origin_location_code,
            "operation_date": str(existing_transaction.operation_date),
            "field_count": len(template_fields),
        },
    )

    db.commit()
    db.refresh(existing_transaction)

    return build_operation_entry_response(existing_transaction, db)


@router.delete("/{transaction_id}")
def delete_operation_entry(
    transaction_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Cancel Operation Transaction",
        db,
    )

    existing_transaction = db.query(OperationTransaction).filter(
        OperationTransaction.id == transaction_id
    ).first()

    if not existing_transaction:
        raise HTTPException(
            status_code=404,
            detail="Operation entry not found",
        )

    if existing_transaction.status not in ["Draft", "Rejected"]:
        raise HTTPException(
            status_code=400,
            detail=(
                "Only Draft or Rejected operation entries can be cancelled. "
                "Submitted tickets must be recalled first. Approved and Cancelled tickets are locked."
            ),
        )

    old_status = existing_transaction.status

    changed_by = (
        f"{current_user.full_name} ({current_user.username})"
        if current_user.full_name
        else current_user.username
    )

    existing_transaction.status = "Cancelled"
    existing_transaction.updated_at = datetime.now()

    existing_remarks = existing_transaction.remarks or ""
    existing_transaction.remarks = (
        f"{existing_remarks}\n"
        f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] "
        f"Cancelled by {changed_by}"
    ).strip()

    history = OperationTransactionStatusHistory(
        transaction_id=existing_transaction.id,
        old_status=old_status,
        new_status="Cancelled",
        changed_by=changed_by,
        remarks="Cancelled from Operation Entry editable list",
        changed_at=datetime.now(),
    )

    db.add(history)

    field_count = (
        db.query(OperationTransactionValue)
        .filter(OperationTransactionValue.transaction_id == existing_transaction.id)
        .count()
    )

    create_audit_log(
        db=db,
        module_name="Operation Transaction",
        action="Cancel Operation Entry",
        current_user=current_user,
        entity_type="OperationTransaction",
        entity_id=existing_transaction.id,
        entity_label=get_transaction_ticket_number(existing_transaction),
        ticket_number=get_transaction_ticket_number(existing_transaction),
        operation_number=existing_transaction.operation_number,
        old_status=old_status,
        new_status="Cancelled",
        remarks="Cancelled from Operation Entry editable list",
        request_path=f"/operation-entries/{transaction_id}",
        details={
            "operation_type_code": existing_transaction.operation_type_code,
            "operation_template_id": existing_transaction.operation_template_id,
            "primary_asset_code": existing_transaction.primary_asset_code,
            "origin_location_code": existing_transaction.origin_location_code,
            "operation_date": str(existing_transaction.operation_date),
            "field_count": field_count,
        },
    )

    db.commit()
    db.refresh(existing_transaction)

    return {
        "message": "Operation entry cancelled successfully"
    }
