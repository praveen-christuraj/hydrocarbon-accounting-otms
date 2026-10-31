import math
import os

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import false, func, or_
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import AssetCalibrationTable, AssetCalibrationData, Asset, CalibrationTemplate, CalibrationTemplateColumn, User
from app.schemas import (
    AssetCalibrationDataRowsResponse,
    AssetCalibrationTableCreate,
    AssetCalibrationTableResponse,
    AssetCalibrationTableSummaryResponse,
)
from app.dependencies.auth import get_current_user_from_token
from app.dependencies.permissions import (
    ensure_location_in_user_scope,
    get_user_location_codes,
    is_admin_user,
    require_user_permission,
)
from app.services.audit_service import create_audit_log
from app.utils.helpers import clean_optional_text

router = APIRouter(prefix="/asset-calibration-tables", tags=["Asset Calibration Tables"])
MAX_CALIBRATION_ROWS = int(os.getenv("MAX_CALIBRATION_ROWS", "1000"))
MAX_CALIBRATION_VALUE = float(os.getenv("MAX_CALIBRATION_VALUE", "1000000000000"))


def _batch_load_asset_and_template_lookups(db: Session, tables: list):
    """Asset/template lookups only -- never touches calibration data rows."""
    asset_codes = {t.asset_code for t in tables}
    template_ids = {t.template_id for t in tables}

    assets = {
        a.asset_code: a
        for a in db.query(Asset).filter(Asset.asset_code.in_(asset_codes)).all()
    }
    templates = {
        t.id: t
        for t in db.query(CalibrationTemplate).filter(CalibrationTemplate.id.in_(template_ids)).all()
    }
    return assets, templates


def _load_row_counts(db: Session, table_ids: set[int]) -> dict[int, int]:
    """Row count per calibration table without loading the rows themselves."""
    if not table_ids:
        return {}
    counts = (
        db.query(
            AssetCalibrationData.calibration_table_id,
            func.count(AssetCalibrationData.id),
        )
        .filter(AssetCalibrationData.calibration_table_id.in_(table_ids))
        .group_by(AssetCalibrationData.calibration_table_id)
        .all()
    )
    return {table_id: count for table_id, count in counts}


def _load_rows_by_table(db: Session, table_ids: set[int]) -> dict[int, list]:
    rows_by_table: dict[int, list] = {}
    if not table_ids:
        return rows_by_table
    all_rows = (
        db.query(AssetCalibrationData)
        .filter(AssetCalibrationData.calibration_table_id.in_(table_ids))
        .order_by(AssetCalibrationData.calibration_table_id, AssetCalibrationData.row_number)
        .all()
    )
    for row in all_rows:
        rows_by_table.setdefault(row.calibration_table_id, []).append(row)
    return rows_by_table


def _batch_load_references(db: Session, tables: list):
    """Full references (assets, templates, rows) for a handful of tables.

    Only used by the single-table endpoints (create/update/delete/detail),
    where loading one table's rows is cheap. The list endpoint uses the
    leaner count-only helpers above.
    """
    assets, templates = _batch_load_asset_and_template_lookups(db, tables)
    rows_by_table = _load_rows_by_table(db, {t.id for t in tables})
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


def build_asset_calibration_table_summary(calibration_table: AssetCalibrationTable, assets: dict, templates: dict, row_counts: dict):
    asset = assets.get(calibration_table.asset_code)
    template = templates.get(calibration_table.template_id)

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
        "row_count": row_counts.get(calibration_table.id, 0),
        "created_at": calibration_table.created_at,
        "updated_at": calibration_table.updated_at,
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


def ensure_asset_calibration_scope(asset: Asset, current_user: User, db: Session, *, write: bool = False):
    if str(asset.asset_scope or "").strip().casefold() == "global":
        if write and not is_admin_user(current_user, db):
            raise HTTPException(status_code=403, detail="Only an administrator may change calibration data for Global assets")
        return
    ensure_location_in_user_scope(current_user, db, asset.location_code, "Asset location")


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
    if len(calibration_table.rows) > MAX_CALIBRATION_ROWS:
        raise HTTPException(
            status_code=400,
            detail=f"A calibration table cannot exceed {MAX_CALIBRATION_ROWS} rows",
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
    numeric_columns = {
        _norm_col(col.column_name): col.column_name
        for col in template_columns
        if str(col.data_type or "").strip().casefold() in {"number", "numeric", "decimal", "float", "integer"}
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

        for normalized_name, column_name in numeric_columns.items():
            template_key = template_col_map.get(normalized_name, column_name)
            value = row.row_data.get(template_key)
            if value is None or str(value).strip() == "":
                continue
            try:
                numeric_value = float(value)
            except (TypeError, ValueError):
                raise HTTPException(
                    status_code=400,
                    detail=f"Column '{column_name}' must be numeric. RowNumber={getattr(row, 'row_number', None)}.",
                )
            if not math.isfinite(numeric_value):
                raise HTTPException(
                    status_code=400,
                    detail=f"Column '{column_name}' must be a finite number. RowNumber={getattr(row, 'row_number', None)}.",
                )
            if numeric_value < 0:
                raise HTTPException(
                    status_code=400,
                    detail=f"Column '{column_name}' cannot be negative. RowNumber={getattr(row, 'row_number', None)}.",
                )
            if numeric_value > MAX_CALIBRATION_VALUE:
                raise HTTPException(
                    status_code=400,
                    detail=f"Column '{column_name}' exceeds the maximum supported value. RowNumber={getattr(row, 'row_number', None)}.",
                )
            row.row_data[template_key] = numeric_value

    return asset


def _scoped_calibration_table_query(db: Session, current_user: User):
    """Base query for calibration tables visible to ``current_user``.

    Applies the same location/Global scope rule the list endpoint has always
    used (location scoped users only see tables for assets inside their
    locations plus Global assets) so the detail/rows endpoints cannot leak
    tables the list would hide.
    """
    query = db.query(AssetCalibrationTable)
    allowed_codes = get_user_location_codes(current_user, db)
    if allowed_codes is not None:
        if not allowed_codes:
            query = query.filter(false())
        else:
            visible_assets = db.query(Asset.asset_code).filter(
                or_(
                    Asset.asset_scope.ilike("Global"),
                    func.lower(func.trim(Asset.location_code)).in_(allowed_codes),
                )
            )
            query = query.filter(AssetCalibrationTable.asset_code.in_(visible_assets))
    return query


@router.get("", response_model=list[AssetCalibrationTableSummaryResponse])
def get_asset_calibration_tables(
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "View Asset Calibration",
        db,
    )

    query = _scoped_calibration_table_query(db, current_user)
    calibration_tables = query.order_by(AssetCalibrationTable.id).all()

    assets, templates = _batch_load_asset_and_template_lookups(db, calibration_tables)
    row_counts = _load_row_counts(db, {ct.id for ct in calibration_tables})

    return [
        build_asset_calibration_table_summary(ct, assets, templates, row_counts)
        for ct in calibration_tables
    ]


def _get_scoped_calibration_table(db: Session, current_user: User, calibration_table_id: int) -> AssetCalibrationTable:
    calibration_table = _scoped_calibration_table_query(db, current_user).filter(
        AssetCalibrationTable.id == calibration_table_id
    ).first()

    if not calibration_table:
        raise HTTPException(
            status_code=404,
            detail="Asset calibration table not found",
        )

    return calibration_table


@router.get("/{calibration_table_id}", response_model=AssetCalibrationTableResponse)
def get_asset_calibration_table(
    calibration_table_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    """Full calibration table (including its data rows) for one table."""
    require_user_permission(
        current_user,
        "View Asset Calibration",
        db,
    )

    calibration_table = _get_scoped_calibration_table(db, current_user, calibration_table_id)
    assets, templates, rows_by_table = _batch_load_references(db, [calibration_table])
    return build_asset_calibration_table_response(calibration_table, assets, templates, rows_by_table)


@router.get("/{calibration_table_id}/rows", response_model=AssetCalibrationDataRowsResponse)
def get_asset_calibration_table_rows(
    calibration_table_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    """Calibration data rows for one table.

    Operation entry layouts interpolate against the active table for the
    selected asset; fetching only that table's rows keeps the payload small
    instead of shipping every row of every table to the browser.
    """
    require_user_permission(
        current_user,
        "View Asset Calibration",
        db,
    )

    calibration_table = _get_scoped_calibration_table(db, current_user, calibration_table_id)
    rows = (
        db.query(AssetCalibrationData)
        .filter(AssetCalibrationData.calibration_table_id == calibration_table.id)
        .order_by(AssetCalibrationData.row_number)
        .all()
    )

    return {
        "table_id": calibration_table.id,
        "rows": [
            {
                "id": row.id,
                "row_number": row.row_number,
                "row_data": row.row_data,
            }
            for row in rows
        ],
    }


@router.post("", response_model=AssetCalibrationTableResponse)
def create_asset_calibration_table(
    calibration_table: AssetCalibrationTableCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Create Asset Calibration",
        db,
    )

    asset = validate_asset_calibration_table(calibration_table, db)
    ensure_asset_calibration_scope(asset, current_user, db, write=True)

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
        "Edit Asset Calibration",
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

    existing_asset = db.query(Asset).filter(
        Asset.asset_code.ilike(existing_calibration_table.asset_code)
    ).first()
    if not existing_asset:
        raise HTTPException(status_code=404, detail="Calibration asset not found")
    ensure_asset_calibration_scope(existing_asset, current_user, db, write=True)

    assets, templates, rows_by_table = _batch_load_references(db, [existing_calibration_table])
    before_data = build_asset_calibration_table_audit_snapshot(
        existing_calibration_table, assets, templates, rows_by_table
    )

    asset = validate_asset_calibration_table(calibration_table, db)
    ensure_asset_calibration_scope(asset, current_user, db, write=True)

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
        "Delete Asset Calibration",
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

    asset = db.query(Asset).filter(
        Asset.asset_code.ilike(existing_calibration_table.asset_code)
    ).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Calibration asset not found")
    ensure_asset_calibration_scope(asset, current_user, db, write=True)

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
