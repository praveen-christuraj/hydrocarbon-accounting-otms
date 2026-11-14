"""Database orchestration, profile caching & audited reviews for Entry Checks.

Connects the pure domain rules (:mod:`app.services.hydrocarbon_entry_rules`)
and Tier 2 Multi-Variable ML (:mod:`app.services.multivariate_anomaly_ml`) to
Hydrocarbon Accounting OTMS's database models while guaranteeing:

* **Advice only & fail-open:** An internal error degrades gracefully to an
  empty finding list and never blocks Save, Submit or Approve.
* **Location & Party Scoping:** Historical reads and saved ticket lookups
  strictly respect ``apply_location_filter`` and ``apply_transaction_party_scope_filter``.
* **Audited Decisions:** ``Keep as entered`` and ``Reopen`` persist typed rows
  in ``entry_check_reviews`` tied to the exact value ``fingerprint`` and record
  an ``AuditLog`` row via ``create_audit_log``.
* **Fast Profile Cache:** ``asset_metric_profiles`` caches robust statistics
  per asset/metric so checks run in milliseconds.
"""

from __future__ import annotations

import json
import logging
from datetime import date, datetime, timedelta
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.config import (
    AI_ENTRY_CHECKS_ENABLED,
    AI_HISTORY_WINDOW,
    AI_ML_ANOMALY_ENABLED,
    AI_ML_ANOMALY_THRESHOLD,
    AI_TRANSIT_LOSS_WARNING_PCT,
    APPROVED_TRANSACTION_STATUS,
)
from app.dependencies.permissions import (
    apply_location_filter,
    apply_transaction_party_scope_filter,
    ensure_location_in_user_scope,
    ensure_transaction_in_user_party_scope,
)
from app.models import (
    AssetCalibrationData,
    AssetCalibrationTable,
    AssetMetricProfile,
    BookStockDailyEntry,
    BookStockFieldProduction,
    CalibrationTemplateColumn,
    EntryCheckReview,
    ExportPermit,
    ExportTransaction,
    FlowmeterConfig,
    FlowmeterRecord,
    LocationAccountingDaySetting,
    OperationTemplate,
    OperationTransaction,
    OperationTransactionValue,
    PrimeMoverTankerLink,
    TankStockLedger,
    User,
)
from app.services import entry_statistics as stats
from app.services.audit_service import create_audit_log
from app.services.hydrocarbon_entry_rules import (
    EntryFinding,
    evaluate_book_stock_rules,
    evaluate_export_rules,
    evaluate_flowmeter_rules,
    evaluate_multi_tank_rules,
    evaluate_tank_gauging_rules,
    evaluate_tanker_rules,
    evaluate_vessel_voyage_rules,
)
from app.utils.helpers import get_current_user_display_name, get_transaction_ticket_number, safe_float

logger = logging.getLogger(__name__)


def _coerce_dict(raw: Any) -> dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str) and raw.strip():
        try:
            parsed = json.loads(raw)
            return parsed if isinstance(parsed, dict) else {}
        except (TypeError, ValueError):
            return {}
    return {}


def _to_celsius(val: Any, unit: Any) -> float | None:
    if val is None or val == "":
        return None
    try:
        v = float(val)
    except (TypeError, ValueError):
        return None
    u = str(unit or "C").replace("°", "").strip().upper()
    return (v - 32.0) / 1.8 if u.startswith("F") else v


def _extract_value_map(db: Session, transaction_id: int) -> dict[str, Any]:
    rows = (
        db.query(OperationTransactionValue)
        .filter(OperationTransactionValue.transaction_id == transaction_id)
        .all()
    )
    return {row.field_code: row.field_value for row in rows}


def _detect_layout_from_values(
    value_map: dict[str, Any],
    template: OperationTemplate | None = None,
) -> str:
    if "tank_gauging_payload" in value_map:
        return "tank_gauging"
    if "multi_tank_payload" in value_map:
        return "multi_tank"
    if "tanker_payload" in value_map:
        return "tanker"
    if "flowmeter_payload" in value_map:
        return "flowmeter"
    if "fso_payload" in value_map:
        return "fso"
    if "shuttle_payload" in value_map:
        return "shuttle"
    layout_type = str(getattr(template, "entry_layout_type", "") or "").strip().lower()
    if "multi" in layout_type or "barge" in layout_type:
        return "multi_tank"
    if "tanker" in layout_type:
        return "tanker"
    if "flowmeter" in layout_type:
        return "flowmeter"
    if "fso" in layout_type:
        return "fso"
    if "shuttle" in layout_type:
        return "shuttle"
    if "tank" in layout_type or "gaug" in layout_type:
        return "tank_gauging"
    return "generic"


def _load_confirmed_vectors(
    db: Session,
    *,
    entity_type: str,
    asset_code: str | None,
    location_code: str | None = None,
) -> list[list[float | None]]:
    """Load operator-confirmed feature vectors to calibrate Tier 2 ML."""
    q = db.query(EntryCheckReview).filter(
        EntryCheckReview.entity_type == entity_type,
        EntryCheckReview.check_code == "ml-multivariate-anomaly",
        EntryCheckReview.feature_vector_json.isnot(None),
    )
    if asset_code:
        q = q.filter(EntryCheckReview.asset_code.ilike(asset_code))
    if location_code:
        q = q.filter(EntryCheckReview.location_code.ilike(location_code))
    rows = q.order_by(EntryCheckReview.reviewed_at.desc()).limit(30).all()
    vectors: list[list[float | None]] = []
    for row in rows:
        vec = row.feature_vector_json
        if isinstance(vec, list) and vec:
            vectors.append(vec)
    return vectors


def _attach_reviews(
    db: Session,
    entity_type: str,
    entity_id: int | None,
    findings: list[EntryFinding],
) -> list[EntryFinding]:
    if not entity_id or not findings:
        return findings
    reviews = (
        db.query(EntryCheckReview)
        .filter(
            EntryCheckReview.entity_type == entity_type,
            EntryCheckReview.entity_id == entity_id,
        )
        .all()
    )
    by_key = {rev.check_key: rev for rev in reviews}
    for finding in findings:
        rev = by_key.get(finding.key)
        if rev is not None and rev.fingerprint == finding.fingerprint:
            finding.reviewed = True
            finding.reviewed_by = rev.reviewed_by
            finding.reviewed_at = rev.reviewed_at.isoformat() if rev.reviewed_at else None
            finding.review_note = rev.note or ""
    return findings


def _get_max_calibration_dip(db: Session, asset_code: str) -> float | None:
    if not asset_code:
        return None
    table = (
        db.query(AssetCalibrationTable)
        .filter(
            AssetCalibrationTable.asset_code.ilike(asset_code),
            AssetCalibrationTable.status == "Active",
        )
        .order_by(AssetCalibrationTable.id.desc())
        .first()
    )
    if not table:
        return None
    col = (
        db.query(CalibrationTemplateColumn)
        .filter(
            CalibrationTemplateColumn.template_id == table.template_id,
            CalibrationTemplateColumn.column_role.ilike("input_x"),
        )
        .first()
    )
    col_name = col.column_name if col else None
    last_rows = (
        db.query(AssetCalibrationData)
        .filter(AssetCalibrationData.calibration_table_id == table.id)
        .order_by(AssetCalibrationData.row_number.desc())
        .limit(5)
        .all()
    )
    max_val: float | None = None
    for r in last_rows:
        data = _coerce_dict(r.row_data)
        raw = data.get(col_name) if col_name else None
        if raw is None:
            for k, v in data.items():
                if "dip" in str(k).lower() or "height" in str(k).lower() or "mm" in str(k).lower() or "cm" in str(k).lower():
                    raw = v
                    break
        try:
            v = float(raw) if raw not in (None, "") else None
        except (TypeError, ValueError):
            v = None
        if v is not None and (max_val is None or v > max_val):
            max_val = v
    return max_val


def _get_accounting_cutoff(db: Session, location_code: str) -> str | None:
    if not location_code:
        return None
    setting = (
        db.query(LocationAccountingDaySetting)
        .filter(
            LocationAccountingDaySetting.location_code.ilike(location_code),
            LocationAccountingDaySetting.status == "Active",
        )
        .order_by(LocationAccountingDaySetting.id.desc())
        .first()
    )
    return str(setting.day_start_time or "").strip()[:5] if setting else None


def _load_tank_history_and_prev(
    db: Session,
    *,
    location_code: str,
    asset_code: str,
    exclude_transaction_id: int | None = None,
) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
    q = (
        db.query(TankStockLedger)
        .filter(
            TankStockLedger.tank_asset_code.ilike(asset_code),
            TankStockLedger.status == "Active",
        )
    )
    if location_code:
        q = q.filter(TankStockLedger.location_code.ilike(location_code))
    if exclude_transaction_id is not None:
        q = q.filter(TankStockLedger.transaction_id != exclude_transaction_id)

    rows = (
        q.order_by(TankStockLedger.operation_date.desc(), TankStockLedger.id.desc())
        .limit(AI_HISTORY_WINDOW)
        .all()
    )
    history: list[dict[str, Any]] = []
    previous_ledger: dict[str, Any] | None = None

    for idx, row in enumerate(rows):
        payload = _coerce_dict(row.source_payload)
        inputs = payload.get("inputs") or {}
        calc = payload.get("calculated") or {}
        stock_nsv = safe_float(row.stock_nsv_bbl or row.running_balance_nsv_bbl)
        prev_nsv = safe_float(row.previous_stock_nsv_bbl)
        delta_nsv = stock_nsv - prev_nsv

        item = {
            "dip_cm": inputs.get("dipCm"),
            "water_cm": inputs.get("waterLevelCm"),
            "tank_temp_c": _to_celsius(inputs.get("tankTemperature"), inputs.get("tankTemperatureUnit")),
            "api60": calc.get("api60"),
            "bsw_pct": inputs.get("bswPercent"),
            "delta_nsv": delta_nsv,
            "stock_nsv": stock_nsv,
            "free_water_bbl": calc.get("freeWaterBbl"),
        }
        history.append(item)
        if idx == 0:
            previous_ledger = {
                "ticket_number": row.ticket_number,
                "stock_after_nsv_bbl": stock_nsv,
                "stock_after_gsv_bbl": safe_float(row.stock_gsv_bbl or row.running_balance_gsv_bbl),
                "gauging_date": inputs.get("gaugingDate") or (row.operation_date.isoformat() if row.operation_date else ""),
                "gauging_time": inputs.get("gaugingTime") or "",
                "free_water_bbl": calc.get("freeWaterBbl"),
            }
    return history, previous_ledger


def _find_duplicate_tank_tickets(
    db: Session,
    *,
    location_code: str,
    asset_code: str,
    gauging_date: str,
    gauging_time: str,
    dip_cm: Any,
    exclude_transaction_id: int | None = None,
) -> list[str]:
    if not asset_code or not gauging_date:
        return []
    q = (
        db.query(OperationTransaction)
        .filter(
            OperationTransaction.primary_asset_code.ilike(asset_code),
            OperationTransaction.status != "Cancelled",
        )
    )
    if location_code:
        q = q.filter(OperationTransaction.origin_location_code.ilike(location_code))
    if exclude_transaction_id is not None:
        q = q.filter(OperationTransaction.id != exclude_transaction_id)

    recent = q.order_by(OperationTransaction.id.desc()).limit(25).all()
    if not recent:
        return []
    tx_ids = [t.id for t in recent]
    vals = (
        db.query(OperationTransactionValue)
        .filter(
            OperationTransactionValue.transaction_id.in_(tx_ids),
            OperationTransactionValue.field_code == "tank_gauging_payload",
        )
        .all()
    )
    by_tx = {v.transaction_id: _coerce_dict(v.field_value) for v in vals}
    dups: list[str] = []
    for tx in recent:
        payload = by_tx.get(tx.id) or {}
        inp = payload.get("inputs") or {}
        g_d = str(inp.get("gaugingDate") or "").strip()[:10]
        g_t = str(inp.get("gaugingTime") or "").strip()[:5]
        if g_d != str(gauging_date).strip()[:10]:
            continue
        same_time = bool(gauging_time and g_t and g_t == str(gauging_time).strip()[:5])
        same_dip = (
            dip_cm not in (None, "")
            and inp.get("dipCm") not in (None, "")
            and abs(safe_float(dip_cm) - safe_float(inp.get("dipCm"))) < 1e-6
        )
        if same_time or same_dip:
            dups.append(get_transaction_ticket_number(tx) or f"TX-{tx.id}")
    return dups


def _load_payload_history(
    db: Session,
    *,
    field_code: str,
    asset_code: str,
    location_code: str = "",
    exclude_transaction_id: int | None = None,
) -> list[dict[str, Any]]:
    if not asset_code:
        return []
    q = (
        db.query(OperationTransaction, OperationTransactionValue)
        .join(
            OperationTransactionValue,
            OperationTransactionValue.transaction_id == OperationTransaction.id,
        )
        .filter(
            OperationTransaction.primary_asset_code.ilike(asset_code),
            OperationTransaction.status == APPROVED_TRANSACTION_STATUS,
            OperationTransactionValue.field_code == field_code,
        )
    )
    if location_code:
        q = q.filter(OperationTransaction.origin_location_code.ilike(location_code))
    if exclude_transaction_id is not None:
        q = q.filter(OperationTransaction.id != exclude_transaction_id)

    rows = q.order_by(OperationTransaction.id.desc()).limit(AI_HISTORY_WINDOW).all()
    out: list[dict[str, Any]] = []
    for _tx, val in rows:
        payload = _coerce_dict(val.field_value)
        if not payload:
            continue
        if field_code == "multi_tank_payload":
            calc = payload.get("calculated") or {}
            net = calc.get("net") or {}
            after = payload.get("after") or {}
            out.append({
                "net_nsv": net.get("NSV") or net.get("net_nsv_bbl"),
                "net_fw": net.get("FW") or net.get("net_water_bbl"),
                "tank_temp_c": _to_celsius(after.get("tankTemp"), after.get("tankTempUnit")),
                "bsw_pct": after.get("bswPct"),
                "ccf": after.get("ccf"),
            })
        elif field_code == "tanker_payload":
            inp = payload.get("inputs") or {}
            calc = payload.get("calculated") or {}
            out.append({
                "total_dip_cm": inp.get("totalDipCm"),
                "water_dip_cm": inp.get("waterDipCm"),
                "tank_temp_c": _to_celsius(inp.get("tankTemperature"), inp.get("tankTemperatureUnit")),
                "api60": calc.get("api60"),
                "bsw_pct": inp.get("bswPercent"),
                "nsv_bbl": calc.get("nsvBbl") or calc.get("nsv_bbl"),
            })
        elif field_code in ("fso_payload", "shuttle_payload"):
            inp = payload.get("inputs") or {}
            calc = payload.get("calculated") or {}
            out.append({
                "opening_stock_bbl": inp.get("opening_stock_bbl"),
                "closing_stock_bbl": inp.get("closing_stock_bbl"),
                "net_stock": calc.get("net_stock_bbl") or calc.get("netStock"),
                "net_water": calc.get("net_water_bbl") or calc.get("netWater"),
                "vessel_qty": inp.get("vessel_quantity_bbl"),
                "variance": calc.get("variance_bbl") or calc.get("variance"),
            })
        elif field_code == "flowmeter_payload":
            calc = payload.get("calculated") or {}
            inp = payload.get("inputs") or {}
            meters = inp.get("meters") or []
            total_delta = sum(
                safe_float(m.get("closing_reading")) - safe_float(m.get("opening_reading"))
                for m in meters
                if isinstance(m, dict)
            )
            out.append({
                "net_bbl": calc.get("net_standard_bbl") or calc.get("gross_observed_bbl"),
                "delta": total_delta,
                "meters": meters,
            })
    return out


def _load_sender_reference_for_tanker(
    db: Session,
    linked_sender_id: int | None,
) -> dict[str, Any] | None:
    if not linked_sender_id:
        return None
    tx = db.query(OperationTransaction).filter(OperationTransaction.id == linked_sender_id).first()
    if not tx:
        return None
    vmap = _extract_value_map(db, tx.id)
    payload = _coerce_dict(vmap.get("tanker_payload"))
    inp = payload.get("inputs") or {}
    calc = payload.get("calculated") or {}
    return {
        "ticketNumber": get_transaction_ticket_number(tx),
        "sealC1": inp.get("sealC1"),
        "sealC2": inp.get("sealC2"),
        "sealM1": inp.get("sealM1"),
        "sealM2": inp.get("sealM2"),
        "nsvBbl": calc.get("nsvBbl") or calc.get("nsv_bbl"),
        "api60": calc.get("api60"),
    }


def _summarize_response(
    findings: list[EntryFinding],
    *,
    layout: str,
    entity_type: str,
    entity_id: int | None,
    history_count: int,
    ml_meta: dict[str, Any] | None = None,
    degraded: bool = False,
) -> dict[str, Any]:
    open_warnings = sum(1 for f in findings if not f.reviewed and f.severity == "warning")
    open_notices = sum(1 for f in findings if not f.reviewed and f.severity != "warning")
    reviewed_count = sum(1 for f in findings if f.reviewed)
    return {
        "enabled": AI_ENTRY_CHECKS_ENABLED,
        "degraded": degraded,
        "layout": layout,
        "entity_type": entity_type,
        "entity_id": entity_id,
        "history_count": history_count,
        "open_warnings": open_warnings,
        "open_notices": open_notices,
        "reviewed": reviewed_count,
        "ml": ml_meta or {"enabled": AI_ML_ANOMALY_ENABLED, "available": False},
        "checks": [f.to_dict() for f in findings],
    }


def evaluate_preview(
    db: Session,
    current_user: User,
    request_data: dict[str, Any],
) -> dict[str, Any]:
    """Evaluate an unsaved operational form in real time (fail-open)."""
    layout = str(request_data.get("layout") or "generic").strip().lower()
    entity_type = str(request_data.get("entity_type") or "operation_transaction").strip()
    entity_id = request_data.get("entity_id")
    location_code = str(request_data.get("location_code") or "").strip()
    asset_code = str(request_data.get("asset_code") or "").strip()

    if not AI_ENTRY_CHECKS_ENABLED:
        return _summarize_response([], layout=layout, entity_type=entity_type, entity_id=entity_id, history_count=0)

    if location_code:
        ensure_location_in_user_scope(current_user, db, location_code)

    try:
        payload = _coerce_dict(request_data.get("payload"))
        confirmed_vectors = _load_confirmed_vectors(
            db,
            entity_type=entity_type,
            asset_code=asset_code or None,
            location_code=location_code or None,
        )

        if layout == "tank_gauging":
            inputs = payload.get("inputs") or payload
            calculated = payload.get("calculated") or {}
            history, prev_ledger = _load_tank_history_and_prev(
                db,
                location_code=location_code,
                asset_code=asset_code,
                exclude_transaction_id=entity_id,
            )
            max_dip = _get_max_calibration_dip(db, asset_code)
            cutoff = _get_accounting_cutoff(db, location_code)
            dups = _find_duplicate_tank_tickets(
                db,
                location_code=location_code,
                asset_code=asset_code,
                gauging_date=str(inputs.get("gaugingDate") or ""),
                gauging_time=str(inputs.get("gaugingTime") or ""),
                dip_cm=inputs.get("dipCm"),
                exclude_transaction_id=entity_id,
            )
            findings, ml_meta = evaluate_tank_gauging_rules(
                asset_code=asset_code,
                inputs=inputs,
                calculated=calculated,
                history=history,
                previous_ledger=prev_ledger,
                max_calibration_dip_cm=max_dip,
                accounting_cutoff_hhmm=cutoff,
                duplicate_tickets=dups,
                confirmed_vectors=confirmed_vectors,
                ml_enabled=AI_ML_ANOMALY_ENABLED,
                ml_threshold=AI_ML_ANOMALY_THRESHOLD,
            )
            _attach_reviews(db, entity_type, entity_id, findings)
            return _summarize_response(
                findings,
                layout=layout,
                entity_type=entity_type,
                entity_id=entity_id,
                history_count=len(history),
                ml_meta=ml_meta,
            )

        if layout == "multi_tank":
            history = _load_payload_history(
                db,
                field_code="multi_tank_payload",
                asset_code=asset_code,
                location_code=location_code,
                exclude_transaction_id=entity_id,
            )
            findings, ml_meta = evaluate_multi_tank_rules(
                asset_code=asset_code,
                payload=payload,
                history=history,
                confirmed_vectors=confirmed_vectors,
                ml_enabled=AI_ML_ANOMALY_ENABLED,
                ml_threshold=AI_ML_ANOMALY_THRESHOLD,
            )
            _attach_reviews(db, entity_type, entity_id, findings)
            return _summarize_response(
                findings,
                layout=layout,
                entity_type=entity_type,
                entity_id=entity_id,
                history_count=len(history),
                ml_meta=ml_meta,
            )

        if layout == "tanker":
            inputs = payload.get("inputs") or payload
            calculated = payload.get("calculated") or {}
            history = _load_payload_history(
                db,
                field_code="tanker_payload",
                asset_code=asset_code,
                location_code=location_code,
                exclude_transaction_id=entity_id,
            )
            linked_sender_id = request_data.get("linked_sender_transaction_id")
            sender_ref = _load_sender_reference_for_tanker(db, linked_sender_id)
            expected_tanker = None
            pm_code = str(inputs.get("primeMoverNumber") or asset_code or "").strip()
            if pm_code:
                link = (
                    db.query(PrimeMoverTankerLink)
                    .filter(
                        PrimeMoverTankerLink.prime_mover_asset_code.ilike(pm_code),
                        PrimeMoverTankerLink.status == "Active",
                    )
                    .order_by(PrimeMoverTankerLink.id.desc())
                    .first()
                )
                if link:
                    expected_tanker = link.tanker_asset_code
            findings, ml_meta = evaluate_tanker_rules(
                asset_code=asset_code,
                inputs=inputs,
                calculated=calculated,
                sender_reference=sender_ref,
                expected_linked_tanker=expected_tanker,
                history=history,
                transit_loss_warning_pct=AI_TRANSIT_LOSS_WARNING_PCT,
                confirmed_vectors=confirmed_vectors,
                ml_enabled=AI_ML_ANOMALY_ENABLED,
                ml_threshold=AI_ML_ANOMALY_THRESHOLD,
            )
            _attach_reviews(db, entity_type, entity_id, findings)
            return _summarize_response(
                findings,
                layout=layout,
                entity_type=entity_type,
                entity_id=entity_id,
                history_count=len(history),
                ml_meta=ml_meta,
            )

        if layout == "flowmeter":
            inputs = payload.get("inputs") or payload
            meters = inputs.get("meters") or []
            if not meters and "opening_reading" in inputs:
                meters = [inputs]

            prev_closings: dict[str, float] = {}
            cal_dates: dict[str, date | None] = {}
            if asset_code:
                cfgs = (
                    db.query(FlowmeterConfig)
                    .filter(
                        FlowmeterConfig.asset_code.ilike(asset_code),
                        FlowmeterConfig.status == "Active",
                    )
                    .all()
                )
                for cfg in cfgs:
                    cal_dates[cfg.meter_label] = cfg.calibration_date

                rec_q = db.query(FlowmeterRecord).filter(
                    FlowmeterRecord.asset_code.ilike(asset_code),
                    FlowmeterRecord.status == "Active",
                )
                if location_code:
                    rec_q = rec_q.filter(FlowmeterRecord.location_code.ilike(location_code))
                if entity_type == "flowmeter_record" and entity_id:
                    rec_q = rec_q.filter(FlowmeterRecord.id != entity_id)
                recent_recs = rec_q.order_by(FlowmeterRecord.reading_date.desc(), FlowmeterRecord.id.desc()).limit(AI_HISTORY_WINDOW).all()
                history = []
                for rec in recent_recs:
                    if rec.meter_label not in prev_closings:
                        prev_closings[rec.meter_label] = safe_float(rec.closing_reading)
                    history.append({
                        "net_bbl": safe_float(rec.net_standard_bbl),
                        "delta": safe_float(rec.closing_reading) - safe_float(rec.opening_reading),
                    })
                # Also merge operation-entry flowmeter payload history if FlowmeterRecord is empty
                if not history:
                    tx_hist = _load_payload_history(
                        db,
                        field_code="flowmeter_payload",
                        asset_code=asset_code,
                        location_code=location_code,
                        exclude_transaction_id=entity_id,
                    )
                    for h in tx_hist:
                        for m in h.get("meters") or []:
                            if isinstance(m, dict):
                                lbl = str(m.get("meter_label") or "").strip()
                                if lbl and lbl not in prev_closings and m.get("closing_reading") not in (None, ""):
                                    prev_closings[lbl] = safe_float(m.get("closing_reading"))
                        history.append({"net_bbl": h.get("net_bbl"), "delta": h.get("delta")})
            else:
                history = []

            findings, ml_meta = evaluate_flowmeter_rules(
                asset_code=asset_code,
                meters=meters,
                previous_closings=prev_closings,
                calibration_dates=cal_dates,
                history=history,
                confirmed_vectors=confirmed_vectors,
                ml_enabled=AI_ML_ANOMALY_ENABLED,
                ml_threshold=AI_ML_ANOMALY_THRESHOLD,
            )
            _attach_reviews(db, entity_type, entity_id, findings)
            return _summarize_response(
                findings,
                layout=layout,
                entity_type=entity_type,
                entity_id=entity_id,
                history_count=len(history),
                ml_meta=ml_meta,
            )

        if layout in ("shuttle", "fso"):
            inputs = payload.get("inputs") or payload
            meta = payload.get("meta") or {}
            field_code = "fso_payload" if layout == "fso" else "shuttle_payload"
            history = _load_payload_history(
                db,
                field_code=field_code,
                asset_code=asset_code,
                location_code=location_code,
                exclude_transaction_id=entity_id,
            )
            prev_closing = history[0] if history else None
            findings, ml_meta = evaluate_vessel_voyage_rules(
                mode=layout,
                asset_code=asset_code,
                inputs=inputs,
                operation_sign=str(meta.get("operation_sign") or meta.get("vessel_operation_sign") or ""),
                previous_closing=prev_closing,
                history=history,
                confirmed_vectors=confirmed_vectors,
                ml_enabled=AI_ML_ANOMALY_ENABLED,
                ml_threshold=AI_ML_ANOMALY_THRESHOLD,
            )
            _attach_reviews(db, entity_type, entity_id, findings)
            return _summarize_response(
                findings,
                layout=layout,
                entity_type=entity_type,
                entity_id=entity_id,
                history_count=len(history),
                ml_meta=ml_meta,
            )

        if layout == "book_stock":
            entity_code = str(payload.get("entity_code") or "").strip()
            block_code = str(payload.get("block_code") or "").strip()
            product_code = str(payload.get("product_code") or "").strip()
            entry_date_raw = str(payload.get("entry_date") or "").strip()[:10]
            try:
                entry_dt = date.fromisoformat(entry_date_raw) if entry_date_raw else date.today()
            except ValueError:
                entry_dt = date.today()

            q = db.query(BookStockDailyEntry).filter(
                BookStockDailyEntry.entity_code.ilike(entity_code),
                BookStockDailyEntry.block_code.ilike(block_code),
                BookStockDailyEntry.product_code.ilike(product_code),
                BookStockDailyEntry.entry_date < entry_dt,
            )
            if entity_id:
                q = q.filter(BookStockDailyEntry.id != entity_id)
            prev_entries = (
                q.order_by(BookStockDailyEntry.entry_date.desc())
                .limit(AI_HISTORY_WINDOW)
                .all()
            )
            history = [
                {
                    "opening_stock": safe_float(r.opening_stock),
                    "production": safe_float(r.production),
                    "dispatch": safe_float(r.dispatch),
                    "adjustment": safe_float(r.adjustment),
                    "closing_stock": safe_float(r.closing_stock),
                }
                for r in prev_entries
            ]
            suggested_opening = safe_float(prev_entries[0].closing_stock) if prev_entries else None

            # Identify usual active fields (produced on each of the last 5 recorded entries)
            usual_fields: list[dict[str, Any]] = []
            if len(prev_entries) >= 5:
                last5_ids = [r.id for r in prev_entries[:5]]
                fp_rows = (
                    db.query(BookStockFieldProduction)
                    .filter(BookStockFieldProduction.entry_id.in_(last5_ids))
                    .all()
                )
                by_field: dict[str, list[tuple[str, float]]] = {}
                for fp in fp_rows:
                    if safe_float(fp.production_qty) > 0:
                        by_field.setdefault(fp.field_code, []).append((fp.field_name, safe_float(fp.production_qty)))
                for f_code, pairs in by_field.items():
                    if len(pairs) >= 5:
                        vals = sorted(p[1] for p in pairs)
                        usual_fields.append({
                            "code": f_code,
                            "name": pairs[0][0],
                            "streak": len(pairs),
                            "median": stats._median(vals),
                        })

            findings, ml_meta = evaluate_book_stock_rules(
                entity_code=entity_code,
                block_code=block_code,
                product_code=product_code,
                opening_stock=safe_float(payload.get("opening_stock")),
                production=safe_float(payload.get("production")),
                dispatch=safe_float(payload.get("dispatch")),
                adjustment=safe_float(payload.get("adjustment")),
                suggested_opening=suggested_opening,
                field_productions=payload.get("field_productions") or [],
                usual_active_fields=usual_fields,
                history=history,
                confirmed_vectors=confirmed_vectors,
                ml_enabled=AI_ML_ANOMALY_ENABLED,
                ml_threshold=AI_ML_ANOMALY_THRESHOLD,
            )
            _attach_reviews(db, "book_stock_entry", entity_id, findings)
            return _summarize_response(
                findings,
                layout=layout,
                entity_type="book_stock_entry",
                entity_id=entity_id,
                history_count=len(history),
                ml_meta=ml_meta,
            )

        if layout == "export":
            entity_code = str(payload.get("entity_code") or "").strip()
            block_code = str(payload.get("block_code") or "").strip()
            permit_no = str(payload.get("permit_number") or "").strip() or None
            vol = safe_float(payload.get("volume"))

            permit_alloc = None
            permit_used = None
            permit_expired = False
            if permit_no:
                permit = (
                    db.query(ExportPermit)
                    .filter(ExportPermit.permit_number.ilike(permit_no))
                    .first()
                )
                if permit:
                    permit_alloc = safe_float(permit.permit_volume) + safe_float(permit.supplementary_permit)
                    permit_used = safe_float(
                        db.query(func.coalesce(func.sum(ExportTransaction.volume), 0.0))
                        .filter(
                            ExportTransaction.permit_number.ilike(permit_no),
                            ExportTransaction.status != "Deleted",
                        )
                        .scalar()
                    )
                    permit_expired = str(permit.status or "").strip().lower() == "expired"

            hist_vols = [
                safe_float(r.volume)
                for r in db.query(ExportTransaction)
                .filter(
                    ExportTransaction.entity_code.ilike(entity_code),
                    ExportTransaction.block_code.ilike(block_code),
                    ExportTransaction.status != "Deleted",
                )
                .order_by(ExportTransaction.id.desc())
                .limit(AI_HISTORY_WINDOW)
                .all()
            ]
            findings = evaluate_export_rules(
                entity_code=entity_code,
                block_code=block_code,
                lifting_volume=vol,
                permit_number=permit_no,
                permit_allocated=permit_alloc,
                permit_used=permit_used,
                permit_expired=permit_expired,
                history_volumes=hist_vols,
            )
            return _summarize_response(
                findings,
                layout=layout,
                entity_type="export_transaction",
                entity_id=entity_id,
                history_count=len(hist_vols),
            )

        return _summarize_response([], layout=layout, entity_type=entity_type, entity_id=entity_id, history_count=0)
    except Exception as exc:  # noqa: BLE001 - fail-open guarantee
        logger.warning("Entry check preview degraded safely (%s): %s", layout, exc)
        return _summarize_response(
            [],
            layout=layout,
            entity_type=entity_type,
            entity_id=entity_id,
            history_count=0,
            degraded=True,
        )


def evaluate_saved_transaction(
    db: Session,
    current_user: User,
    transaction_id: int,
) -> dict[str, Any]:
    """Run entry checks for an already-saved OperationTransaction."""
    tx = db.query(OperationTransaction).filter(OperationTransaction.id == transaction_id).first()
    if not tx:
        raise LookupError(f"Operation transaction {transaction_id} not found")
    ensure_transaction_in_user_party_scope(current_user, db, tx)

    template = (
        db.query(OperationTemplate).filter(OperationTemplate.id == tx.operation_template_id).first()
        if tx.operation_template_id
        else None
    )
    vmap = _extract_value_map(db, tx.id)
    layout = _detect_layout_from_values(vmap, template)

    payload_key_map = {
        "tank_gauging": "tank_gauging_payload",
        "multi_tank": "multi_tank_payload",
        "tanker": "tanker_payload",
        "flowmeter": "flowmeter_payload",
        "fso": "fso_payload",
        "shuttle": "shuttle_payload",
    }
    raw_payload = vmap.get(payload_key_map.get(layout, ""))
    linked_sender = None
    if vmap.get("linked_sender_transaction_id") not in (None, ""):
        try:
            linked_sender = int(str(vmap["linked_sender_transaction_id"]))
        except (TypeError, ValueError):
            linked_sender = None

    # Use location-safe evaluation without throwing on party-scoped receiver reads
    result = evaluate_preview(
        db,
        current_user,
        {
            "layout": layout,
            "entity_type": "operation_transaction",
            "entity_id": tx.id,
            "location_code": "",  # already verified via party scope above
            "asset_code": tx.primary_asset_code or "",
            "payload": _coerce_dict(raw_payload),
            "linked_sender_transaction_id": linked_sender,
        },
    )
    result["ticket_number"] = get_transaction_ticket_number(tx)
    result["transaction_status"] = tx.status
    result["primary_asset_code"] = tx.primary_asset_code
    result["location_code"] = tx.origin_location_code
    return result


def keep_check_as_entered(
    db: Session,
    current_user: User,
    *,
    entity_type: str,
    entity_id: int,
    check_key: str,
    check_code: str,
    fingerprint: str,
    subject_label: str = "",
    value_label: str = "",
    note: str = "",
    location_code: str | None = None,
    asset_code: str | None = None,
    feature_vector: list[float | None] | None = None,
) -> EntryCheckReview:
    """Persist an audited 'Keep as entered' review decision bound to ``fingerprint``."""
    if entity_type == "operation_transaction":
        tx = db.query(OperationTransaction).filter(OperationTransaction.id == entity_id).first()
        if not tx:
            raise LookupError(f"Operation transaction {entity_id} not found")
        ensure_transaction_in_user_party_scope(current_user, db, tx)
        if str(tx.status or "").strip() == APPROVED_TRANSACTION_STATUS:
            raise ValueError("Approved tickets are locked; request a correction before changing check decisions.")
        location_code = location_code or tx.origin_location_code
        asset_code = asset_code or tx.primary_asset_code
    elif location_code:
        ensure_location_in_user_scope(current_user, db, location_code)

    reviewer = get_current_user_display_name(current_user)
    clean_note = (note or "").strip()[:300]

    row = (
        db.query(EntryCheckReview)
        .filter(
            EntryCheckReview.entity_type == entity_type,
            EntryCheckReview.entity_id == entity_id,
            EntryCheckReview.check_key == check_key,
        )
        .first()
    )
    if row is None:
        row = EntryCheckReview(
            entity_type=entity_type,
            entity_id=entity_id,
            location_code=location_code,
            asset_code=asset_code,
            check_key=check_key,
            check_code=check_code[:60],
            fingerprint=fingerprint[:96],
            subject_label=(subject_label or "")[:255],
            value_label=(value_label or "")[:160],
            feature_vector_json=feature_vector,
            note=clean_note,
            reviewed_by=reviewer,
            reviewed_at=datetime.utcnow(),
        )
        db.add(row)
    else:
        row.fingerprint = fingerprint[:96]
        row.check_code = check_code[:60]
        row.subject_label = (subject_label or row.subject_label or "")[:255]
        row.value_label = (value_label or row.value_label or "")[:160]
        if feature_vector is not None:
            row.feature_vector_json = feature_vector
        row.note = clean_note
        row.reviewed_by = reviewer
        row.reviewed_at = datetime.utcnow()

    db.flush()
    create_audit_log(
        db=db,
        module_name="Entry Quality Checks",
        action="Keep Entry Check As Entered",
        current_user=current_user,
        entity_type=entity_type,
        entity_id=entity_id,
        entity_label=f"{subject_label or asset_code or entity_id} · {check_code}",
        remarks=clean_note or f"Kept {check_code} value ({value_label}) as entered",
        request_path="/entry-checks/reviews",
        details={
            "check_key": check_key,
            "check_code": check_code,
            "fingerprint": fingerprint,
            "value_label": value_label,
            "note": clean_note,
        },
    )
    db.commit()
    db.refresh(row)
    return row


def reopen_check_review(
    db: Session,
    current_user: User,
    *,
    entity_type: str,
    entity_id: int,
    check_key: str,
) -> bool:
    """Withdraw a 'Keep as entered' review decision with full audit trail."""
    if entity_type == "operation_transaction":
        tx = db.query(OperationTransaction).filter(OperationTransaction.id == entity_id).first()
        if not tx:
            raise LookupError(f"Operation transaction {entity_id} not found")
        ensure_transaction_in_user_party_scope(current_user, db, tx)
        if str(tx.status or "").strip() == APPROVED_TRANSACTION_STATUS:
            raise ValueError("Approved tickets are locked; reviews cannot be reopened.")

    row = (
        db.query(EntryCheckReview)
        .filter(
            EntryCheckReview.entity_type == entity_type,
            EntryCheckReview.entity_id == entity_id,
            EntryCheckReview.check_key == check_key,
        )
        .first()
    )
    if row is None:
        return False

    check_code = row.check_code
    subject = row.subject_label
    db.delete(row)
    db.flush()
    create_audit_log(
        db=db,
        module_name="Entry Quality Checks",
        action="Reopen Entry Check",
        current_user=current_user,
        entity_type=entity_type,
        entity_id=entity_id,
        entity_label=f"{subject or entity_id} · {check_code}",
        remarks=f"Reopened entry check {check_key}",
        request_path="/entry-checks/reviews/reopen",
        details={"check_key": check_key, "check_code": check_code},
    )
    db.commit()
    return True


def list_open_ticket_abnormalities(
    db: Session,
    current_user: User,
    *,
    location_code: str | None = None,
    limit: int = 40,
) -> list[dict[str, Any]]:
    """Scan recent Draft/Submitted tickets in scope and list those with open checks."""
    q = db.query(OperationTransaction).filter(
        OperationTransaction.status.in_(["Draft", "Submitted", "Rejected"]),
    )
    q = apply_transaction_party_scope_filter(q, OperationTransaction, current_user, db)
    if location_code:
        q = q.filter(OperationTransaction.origin_location_code.ilike(location_code))

    tickets = q.order_by(OperationTransaction.id.desc()).limit(max(1, min(limit, 80))).all()
    flagged: list[dict[str, Any]] = []
    for tx in tickets:
        try:
            res = evaluate_saved_transaction(db, current_user, tx.id)
        except Exception:  # noqa: BLE001
            continue
        if res["open_warnings"] > 0 or res["open_notices"] > 0:
            flagged.append({
                "transaction_id": tx.id,
                "ticket_number": get_transaction_ticket_number(tx),
                "operation_number": tx.operation_number,
                "status": tx.status,
                "location_code": tx.origin_location_code,
                "asset_code": tx.primary_asset_code,
                "operation_date": tx.operation_date.isoformat() if tx.operation_date else None,
                "layout": res["layout"],
                "open_warnings": res["open_warnings"],
                "open_notices": res["open_notices"],
                "reviewed": res["reviewed"],
                "top_finding": res["checks"][0]["title"] if res["checks"] else "",
                "checks": res["checks"][:5],
            })
    return flagged


def refresh_asset_metric_profiles(
    db: Session,
    *,
    location_code: str | None = None,
) -> dict[str, int]:
    """Rebuild cached robust profiles in ``asset_metric_profiles`` from approved ledgers."""
    q = db.query(TankStockLedger).filter(TankStockLedger.status == "Active")
    if location_code:
        q = q.filter(TankStockLedger.location_code.ilike(location_code))
    rows = q.order_by(TankStockLedger.operation_date.desc(), TankStockLedger.id.desc()).limit(1500).all()

    grouped: dict[tuple[str, str], list[TankStockLedger]] = {}
    for row in rows:
        grouped.setdefault((row.location_code or "", row.tank_asset_code or ""), []).append(row)

    updated = 0
    for (loc, asset), items in grouped.items():
        if not asset:
            continue
        metrics: dict[tuple[str, str], list[float]] = {
            ("dip_cm", "cm"): [],
            ("bsw_pct", "%"): [],
            ("api60", "API"): [],
            ("tank_temp_c", "C"): [],
            ("nsv_bbl", "BBL"): [],
        }
        latest_date: date | None = None
        for r in items[:AI_HISTORY_WINDOW]:
            if r.operation_date and (latest_date is None or r.operation_date > latest_date):
                latest_date = r.operation_date
            p = _coerce_dict(r.source_payload)
            inp = p.get("inputs") or {}
            calc = p.get("calculated") or {}
            for key, val in (
                (("dip_cm", "cm"), inp.get("dipCm")),
                (("bsw_pct", "%"), inp.get("bswPercent")),
                (("api60", "API"), calc.get("api60")),
                (("tank_temp_c", "C"), _to_celsius(inp.get("tankTemperature"), inp.get("tankTemperatureUnit"))),
                (("nsv_bbl", "BBL"), r.stock_nsv_bbl),
            ):
                if val not in (None, ""):
                    try:
                        f = float(val)
                        if f > 0:
                            metrics[key].append(f)
                    except (TypeError, ValueError):
                        pass

        for (metric_name, unit), values in metrics.items():
            if not values:
                continue
            prof = stats.build_profile(values)
            if not prof:
                continue
            existing = (
                db.query(AssetMetricProfile)
                .filter(
                    AssetMetricProfile.module_type == "tank_gauging",
                    AssetMetricProfile.location_code == loc,
                    AssetMetricProfile.asset_code == asset,
                    AssetMetricProfile.metric_name == metric_name,
                    AssetMetricProfile.unit == unit,
                )
                .first()
            )
            if existing is None:
                existing = AssetMetricProfile(
                    module_type="tank_gauging",
                    location_code=loc,
                    asset_code=asset,
                    metric_name=metric_name,
                    unit=unit,
                )
                db.add(existing)
            existing.sample_count = prof.count
            existing.median_value = round(prof.median, 6)
            existing.spread = round(prof.spread, 6)
            existing.low_value = round(prof.low, 6)
            existing.high_value = round(prof.high, 6)
            existing.common_value = round(prof.common, 6) if prof.common is not None else None
            existing.last_observed_on = latest_date
            existing.refreshed_at = datetime.utcnow()
            updated += 1

    db.commit()
    return {"assets_scanned": len(grouped), "profiles_updated": updated}
