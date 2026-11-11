import math
import os

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import false, func, insert, or_
from sqlalchemy.orm import Session

from app.config import MAX_CALIBRATION_ROWS
from app.utils.errors import commit_or_409, flush_or_409
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
    require_user_permission,
)
from app.services.audit_service import create_audit_log
from app.utils.helpers import clean_optional_text

from sqlalchemy.exc import IntegrityError

router = APIRouter(prefix="/asset-calibration-tables", tags=["Asset Calibration Tables"])
MAX_CALIBRATION_VALUE = float(os.getenv("MAX_CALIBRATION_VALUE", "1000000000000"))
CALIBRATION_INSERT_BATCH_SIZE = 2_000


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
        "row_numbers": [r.row_number for r in preview_rows],
        "row_numbers_truncated": row_count > len(preview_rows),
        "rows_preview_limit": max_rows,
        "rows_preview": [
            {
                "row_number": r.row_number,
                "row_data": r.row_data,
            }
            for r in preview_rows
        ],
    }


def _audit_snapshot_from_input(
    calibration_table: AssetCalibrationTable,
    asset: Asset,
    template: CalibrationTemplate,
    rows,
    max_rows: int = 50,
):
    """Build a bounded audit record without loading a large chart again."""
    preview = list(rows[:max_rows])
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
        "row_count": len(rows),
        "row_numbers": [row.row_number for row in preview],
        "row_numbers_truncated": len(rows) > len(preview),
        "rows_preview_limit": max_rows,
        "rows_preview": [
            {"row_number": row.row_number, "row_data": row.row_data}
            for row in preview
        ],
    }


def _load_bounded_audit_snapshot(
    db: Session,
    calibration_table: AssetCalibrationTable,
    max_rows: int = 50,
):
    """Read only a row count and preview for update/delete auditing."""
    assets, templates = _batch_load_asset_and_template_lookups(db, [calibration_table])
    preview_rows = (
        db.query(AssetCalibrationData)
        .filter(AssetCalibrationData.calibration_table_id == calibration_table.id)
        .order_by(AssetCalibrationData.row_number)
        .limit(max_rows)
        .all()
    )
    snapshot = build_asset_calibration_table_audit_snapshot(
        calibration_table,
        assets,
        templates,
        {calibration_table.id: preview_rows},
        max_rows=max_rows,
    )
    row_count = (
        db.query(func.count(AssetCalibrationData.id))
        .filter(AssetCalibrationData.calibration_table_id == calibration_table.id)
        .scalar()
        or 0
    )
    snapshot["row_count"] = row_count
    snapshot["row_numbers_truncated"] = row_count > len(preview_rows)
    return snapshot


def _bulk_insert_calibration_rows(db: Session, table_id: int, rows) -> None:
    """Insert large calibration charts with bounded executemany batches."""
    for start in range(0, len(rows), CALIBRATION_INSERT_BATCH_SIZE):
        batch = rows[start : start + CALIBRATION_INSERT_BATCH_SIZE]
        db.execute(
            insert(AssetCalibrationData),
            [
                {
                    "calibration_table_id": table_id,
                    "row_number": row.row_number or start + index + 1,
                    "row_data": row.row_data,
                }
                for index, row in enumerate(batch)
            ],
        )


def ensure_asset_calibration_scope(asset: Asset, current_user: User, db: Session, *, write: bool = False):
    if str(asset.asset_scope or "").strip().casefold() == "global":
        if write:
            require_user_permission(current_user, "Edit Global Asset Calibration", db)
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


def find_calibration_table_for_asset(
    db: Session,
    asset_code: str,
    exclude_table_id: int | None = None,
) -> AssetCalibrationTable | None:
    """The calibration chart already stored for an asset, if any.

    Asset codes are unique in the Asset Master; the comparison is done
    case-insensitively so differently-cased uploads cannot slip past.
    """
    code = str(asset_code or "").strip()
    if not code:
        return None
    query = db.query(AssetCalibrationTable).filter(
        func.lower(AssetCalibrationTable.asset_code) == code.lower()
    )
    if exclude_table_id is not None:
        query = query.filter(AssetCalibrationTable.id != exclude_table_id)
    return query.order_by(AssetCalibrationTable.id.asc()).first()


def raise_calibration_chart_exists(asset_code: str, existing: AssetCalibrationTable | None):
    if existing is not None:
        detail = (
            f"Asset \"{asset_code}\" already has a calibration chart "
            f"('{existing.calibration_name}'). Only one calibration chart is allowed per asset. "
            "Edit the existing chart and replace its calibration values, or delete it fully, "
            "before uploading a new one."
        )
    else:
        detail = (
            f"Asset \"{asset_code}\" already has a calibration chart. "
            "Only one calibration chart is allowed per asset. "
            "Edit the existing chart and replace its calibration values, or delete it fully, "
            "before uploading a new one."
        )
    raise HTTPException(status_code=409, detail=detail)


def _is_asset_unique_violation(exc: IntegrityError) -> bool:
    message = str(getattr(exc, "orig", exc) or exc).lower()
    return (
        "ux_asset_calibration_tables_lower_asset_code" in message
        or ("asset_code" in message and "unique" in message)
    )


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


@router.post("", response_model=AssetCalibrationTableResponse | AssetCalibrationTableSummaryResponse)
def create_asset_calibration_table(
    calibration_table: AssetCalibrationTableCreate,
    compact: bool = False,
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

    existing_chart = find_calibration_table_for_asset(db, calibration_table.asset_code)
    if existing_chart is not None:
        raise_calibration_chart_exists(calibration_table.asset_code.strip(), existing_chart)

    new_calibration_table = AssetCalibrationTable(
        calibration_name=calibration_table.calibration_name.strip(),
        asset_code=calibration_table.asset_code.strip(),
        template_id=calibration_table.template_id,
        effective_date=calibration_table.effective_date,
        remarks=clean_optional_text(calibration_table.remarks),
        status=calibration_table.status,
    )

    db.add(new_calibration_table)
    try:
        flush_or_409(db)
    except IntegrityError as exc:
        db.rollback()
        if not _is_asset_unique_violation(exc):
            raise
        # Lost a race: another request created this asset's chart first.
        existing_chart = find_calibration_table_for_asset(db, calibration_table.asset_code)
        raise_calibration_chart_exists(calibration_table.asset_code.strip(), existing_chart)

    _bulk_insert_calibration_rows(db, new_calibration_table.id, calibration_table.rows)

    template = db.query(CalibrationTemplate).filter(
        CalibrationTemplate.id == calibration_table.template_id
    ).first()
    after_data = _audit_snapshot_from_input(
        new_calibration_table, asset, template, calibration_table.rows
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

    commit_or_409(db)
    db.refresh(new_calibration_table)

    if compact:
        return build_asset_calibration_table_summary(
            new_calibration_table,
            {new_calibration_table.asset_code: asset},
            {new_calibration_table.template_id: template},
            {new_calibration_table.id: len(calibration_table.rows)},
        )
    assets, templates, rows_by_table = _batch_load_references(db, [new_calibration_table])
    return build_asset_calibration_table_response(new_calibration_table, assets, templates, rows_by_table)


@router.put("/{calibration_table_id}", response_model=AssetCalibrationTableResponse | AssetCalibrationTableSummaryResponse)
def update_asset_calibration_table(
    calibration_table_id: int,
    calibration_table: AssetCalibrationTableCreate,
    compact: bool = False,
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

    before_data = _load_bounded_audit_snapshot(db, existing_calibration_table)

    asset = validate_asset_calibration_table(calibration_table, db)
    ensure_asset_calibration_scope(asset, current_user, db, write=True)

    # Renaming/repointing this chart at an asset that already has one would
    # create the duplicate the one-chart-per-asset rule forbids.
    other_chart = find_calibration_table_for_asset(
        db,
        calibration_table.asset_code,
        exclude_table_id=calibration_table_id,
    )
    if other_chart is not None:
        raise_calibration_chart_exists(calibration_table.asset_code.strip(), other_chart)

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

    try:
        db.query(AssetCalibrationData).filter(
            AssetCalibrationData.calibration_table_id == calibration_table_id
        ).delete()
        flush_or_409(db)
    except IntegrityError as exc:
        db.rollback()
        if not _is_asset_unique_violation(exc):
            raise
        existing_chart = find_calibration_table_for_asset(
            db, calibration_table.asset_code, exclude_table_id=calibration_table_id
        )
        raise_calibration_chart_exists(calibration_table.asset_code.strip(), existing_chart)

    _bulk_insert_calibration_rows(db, calibration_table_id, calibration_table.rows)

    template = db.query(CalibrationTemplate).filter(
        CalibrationTemplate.id == calibration_table.template_id
    ).first()
    after_data = _audit_snapshot_from_input(
        existing_calibration_table, asset, template, calibration_table.rows
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

    commit_or_409(db)
    db.refresh(existing_calibration_table)

    if compact:
        return build_asset_calibration_table_summary(
            existing_calibration_table,
            {existing_calibration_table.asset_code: asset},
            {existing_calibration_table.template_id: template},
            {existing_calibration_table.id: len(calibration_table.rows)},
        )
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

    deleted_data = _load_bounded_audit_snapshot(db, existing_calibration_table)

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
    commit_or_409(db)

    return {
        "message": "Asset calibration table deleted successfully"
    }
