from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import AssetCalibrationTable, AssetCalibrationData, Asset, CalibrationTemplate, CalibrationTemplateColumn, User
from app.schemas import AssetCalibrationTableCreate, AssetCalibrationTableResponse
from app.dependencies.auth import get_current_user_from_token
from app.dependencies.permissions import require_user_permission
from app.services.audit_service import create_audit_log
from app.utils.helpers import clean_optional_text

router = APIRouter(prefix="/asset-calibration-tables", tags=["Asset Calibration Tables"])


def _batch_load_references(db: Session, tables: list):
    asset_codes = {t.asset_code for t in tables}
    template_ids = {t.template_id for t in tables}
    table_ids = {t.id for t in tables}

    assets = {
        a.asset_code: a
        for a in db.query(Asset).filter(Asset.asset_code.in_(asset_codes)).all()
    }
    templates = {
        t.id: t
        for t in db.query(CalibrationTemplate).filter(CalibrationTemplate.id.in_(template_ids)).all()
    }
    rows_by_table: dict[int, list] = {}
    if table_ids:
        all_rows = (
            db.query(AssetCalibrationData)
            .filter(AssetCalibrationData.calibration_table_id.in_(table_ids))
            .order_by(AssetCalibrationData.calibration_table_id, AssetCalibrationData.row_number)
            .all()
        )
        for row in all_rows:
            rows_by_table.setdefault(row.calibration_table_id, []).append(row)
    return assets, templates, rows_by_table


def build_asset_calibration_table_response(calibration_table: AssetCalibrationTable, assets: dict, templates: dict, rows_by_table: dict):
    asset = assets.get(calibration_table.asset_code)
    template = templates.get(calibration_table.template_id)
    rows = rows_by_table.get(calibration_table.id, [])

    return {
        "id": calibration_table.id,
        "calibration_name": calibration_table.calibration_name,
        "asset_code": calibration_table.asset_code,
        "asset_name": asset.asset_name if asset else "",
        "template_id": calibration_table.template_id,
        "template_name": template.template_name if template else "",
        "effective_date": calibration_table.effective_date,
        "remarks": calibration_table.remarks,
        "status": calibration_table.status,
        "created_at": calibration_table.created_at,
        "updated_at": calibration_table.updated_at,
        "rows": [
            {
                "id": row.id,
                "row_number": row.row_number,
                "row_data": row.row_data,
            }
            for row in rows
        ],
    }


def build_asset_calibration_table_audit_snapshot(calibration_table: AssetCalibrationTable, assets: dict, templates: dict, rows_by_table: dict, max_rows: int = 50):
    asset = assets.get(calibration_table.asset_code)
    template = templates.get(calibration_table.template_id)
    rows = rows_by_table.get(calibration_table.id, [])

    row_count = len(rows)
    preview_rows = rows[:max_rows]

    return {
        "id": calibration_table.id,
        "calibration_name": calibration_table.calibration_name,
        "asset_code": calibration_table.asset_code,
        "asset_name": asset.asset_name if asset else "",
        "template_id": calibration_table.template_id,
        "template_name": template.template_name if template else "",
        "effective_date": str(calibration_table.effective_date)
        if calibration_table.effective_date
        else None,
        "remarks": calibration_table.remarks,
        "status": calibration_table.status,
        "row_count": row_count,
        "row_numbers": [r.row_number for r in rows],
        "rows_preview_limit": max_rows,
        "rows_preview": [
            {
                "row_number": r.row_number,
                "row_data": r.row_data,
            }
            for r in preview_rows
        ],
    }


def validate_asset_calibration_table(calibration_table: AssetCalibrationTableCreate, db: Session):
    asset = db.query(Asset).filter(
        Asset.asset_code.ilike(calibration_table.asset_code)
    ).first()

    if not asset:
        raise HTTPException(
            status_code=400,
            detail="Asset not found",
        )

    template = db.query(CalibrationTemplate).filter(
        CalibrationTemplate.id == calibration_table.template_id
    ).first()

    if not template:
        raise HTTPException(
            status_code=400,
            detail="Calibration template not found",
        )

    if asset.asset_type_code.lower() != template.asset_type_code.lower():
        raise HTTPException(
            status_code=400,
            detail="Selected template does not belong to this asset type",
        )

    if len(calibration_table.rows) == 0:
        raise HTTPException(
            status_code=400,
            detail="Please add at least one calibration data row",
        )

    template_columns = (
        db.query(CalibrationTemplateColumn)
        .filter(CalibrationTemplateColumn.template_id == template.id)
        .order_by(CalibrationTemplateColumn.sort_order)
        .all()
    )

    required_columns = [
        column.column_name
        for column in template_columns
        if column.is_required == "Yes"
    ]

    def _norm_col(name: str) -> str:
        return str(name or "").strip().lower()

    template_col_map = {
        _norm_col(col.column_name): col.column_name
        for col in template_columns
    }

    for row in calibration_table.rows:
        original = row.row_data or {}
        original_keys = list(original.keys())

        normalized_row_data = {}
        for k, v in original.items():
            nk = _norm_col(k)
            if nk in template_col_map:
                normalized_row_data[template_col_map[nk]] = v
            else:
                normalized_row_data[k] = v

        row.row_data = normalized_row_data

        normalized_keys = list(row.row_data.keys())
        row_keys_norm = {_norm_col(k) for k in row.row_data.keys()}

        for required_column in required_columns:
            rn = _norm_col(required_column)

            if rn not in row_keys_norm:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Required column missing: {required_column}. "
                        f"RowNumber={getattr(row, 'row_number', None)}. "
                        f"IncomingKeys={original_keys}. "
                        f"NormalizedKeys={normalized_keys}."
                    ),
                )

            template_key = template_col_map.get(rn, required_column)
            value = row.row_data.get(template_key)

            if value is None or str(value).strip() == "":
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Required column cannot be blank: {required_column}. "
                        f"RowNumber={getattr(row, 'row_number', None)}."
                    ),
                )


@router.get("", response_model=list[AssetCalibrationTableResponse])
def get_asset_calibration_tables(
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "View Asset Calibration",
        db,
    )

    calibration_tables = (
        db.query(AssetCalibrationTable)
        .order_by(AssetCalibrationTable.id)
        .all()
    )

    assets, templates, rows_by_table = _batch_load_references(db, calibration_tables)

    return [
        build_asset_calibration_table_response(ct, assets, templates, rows_by_table)
        for ct in calibration_tables
    ]


@router.post("", response_model=AssetCalibrationTableResponse)
def create_asset_calibration_table(
    calibration_table: AssetCalibrationTableCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage Asset Calibration",
        db,
    )

    validate_asset_calibration_table(calibration_table, db)

    new_calibration_table = AssetCalibrationTable(
        calibration_name=calibration_table.calibration_name.strip(),
        asset_code=calibration_table.asset_code.strip(),
        template_id=calibration_table.template_id,
        effective_date=calibration_table.effective_date,
        remarks=clean_optional_text(calibration_table.remarks),
        status=calibration_table.status,
    )

    db.add(new_calibration_table)
    db.flush()

    for index, row in enumerate(calibration_table.rows):
        new_row = AssetCalibrationData(
            calibration_table_id=new_calibration_table.id,
            row_number=row.row_number or index + 1,
            row_data=row.row_data,
        )
        db.add(new_row)

    db.flush()

    assets, templates, rows_by_table = _batch_load_references(db, [new_calibration_table])
    after_data = build_asset_calibration_table_audit_snapshot(
        new_calibration_table, assets, templates, rows_by_table
    )

    create_audit_log(
        db=db,
        module_name="Asset Calibration Table",
        action="Create Asset Calibration Table",
        current_user=current_user,
        entity_type="AssetCalibrationTable",
        entity_id=new_calibration_table.id,
        entity_label=new_calibration_table.calibration_name,
        remarks="Asset calibration table created",
        request_path="/asset-calibration-tables",
        details={"after": after_data},
    )

    db.commit()
    db.refresh(new_calibration_table)

    assets, templates, rows_by_table = _batch_load_references(db, [new_calibration_table])
    return build_asset_calibration_table_response(new_calibration_table, assets, templates, rows_by_table)


@router.put("/{calibration_table_id}", response_model=AssetCalibrationTableResponse)
def update_asset_calibration_table(
    calibration_table_id: int,
    calibration_table: AssetCalibrationTableCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage Asset Calibration",
        db,
    )

    existing_calibration_table = db.query(AssetCalibrationTable).filter(
        AssetCalibrationTable.id == calibration_table_id
    ).first()

    if not existing_calibration_table:
        raise HTTPException(
            status_code=404,
            detail="Asset calibration table not found",
        )

    assets, templates, rows_by_table = _batch_load_references(db, [existing_calibration_table])
    before_data = build_asset_calibration_table_audit_snapshot(
        existing_calibration_table, assets, templates, rows_by_table
    )

    validate_asset_calibration_table(calibration_table, db)

    existing_calibration_table.calibration_name = (
        calibration_table.calibration_name.strip()
    )
    existing_calibration_table.asset_code = calibration_table.asset_code.strip()
    existing_calibration_table.template_id = calibration_table.template_id
    existing_calibration_table.effective_date = calibration_table.effective_date
    existing_calibration_table.remarks = clean_optional_text(
        calibration_table.remarks
    )
    existing_calibration_table.status = calibration_table.status

    db.query(AssetCalibrationData).filter(
        AssetCalibrationData.calibration_table_id == calibration_table_id
    ).delete()

    for index, row in enumerate(calibration_table.rows):
        new_row = AssetCalibrationData(
            calibration_table_id=calibration_table_id,
            row_number=row.row_number or index + 1,
            row_data=row.row_data,
        )
        db.add(new_row)

    db.flush()

    assets, templates, rows_by_table = _batch_load_references(db, [existing_calibration_table])
    after_data = build_asset_calibration_table_audit_snapshot(
        existing_calibration_table, assets, templates, rows_by_table
    )

    create_audit_log(
        db=db,
        module_name="Asset Calibration Table",
        action="Update Asset Calibration Table",
        current_user=current_user,
        entity_type="AssetCalibrationTable",
        entity_id=existing_calibration_table.id,
        entity_label=existing_calibration_table.calibration_name,
        remarks="Asset calibration table updated",
        request_path=f"/asset-calibration-tables/{calibration_table_id}",
        details={"before": before_data, "after": after_data},
    )

    db.commit()
    db.refresh(existing_calibration_table)

    assets, templates, rows_by_table = _batch_load_references(db, [existing_calibration_table])
    return build_asset_calibration_table_response(existing_calibration_table, assets, templates, rows_by_table)


@router.delete("/{calibration_table_id}")
def delete_asset_calibration_table(
    calibration_table_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage Asset Calibration",
        db,
    )

    existing_calibration_table = db.query(AssetCalibrationTable).filter(
        AssetCalibrationTable.id == calibration_table_id
    ).first()

    if not existing_calibration_table:
        raise HTTPException(
            status_code=404,
            detail="Asset calibration table not found",
        )

    assets, templates, rows_by_table = _batch_load_references(db, [existing_calibration_table])
    deleted_data = build_asset_calibration_table_audit_snapshot(
        existing_calibration_table, assets, templates, rows_by_table
    )

    create_audit_log(
        db=db,
        module_name="Asset Calibration Table",
        action="Delete Asset Calibration Table",
        current_user=current_user,
        entity_type="AssetCalibrationTable",
        entity_id=existing_calibration_table.id,
        entity_label=existing_calibration_table.calibration_name,
        remarks="Asset calibration table deleted",
        request_path=f"/asset-calibration-tables/{calibration_table_id}",
        details={"deleted": deleted_data},
    )

    db.query(AssetCalibrationData).filter(
        AssetCalibrationData.calibration_table_id == calibration_table_id
    ).delete()

    db.delete(existing_calibration_table)
    db.commit()

    return {
        "message": "Asset calibration table deleted successfully"
    }