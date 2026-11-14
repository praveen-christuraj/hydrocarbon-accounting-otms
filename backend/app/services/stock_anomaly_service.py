"""Hydrocarbon Accounting Intelligence: Loss/Gain, CUSUM Drift & Readiness.

Implements the domain accounting & stock analysis skills across Hydrocarbon
Accounting OTMS using the application's canonical ledgers and tracking tables,
strictly honoring RBAC permissions, Location Scope, and Party Involvement Scope:

1. **Material Balance Loss/Gain Root-Cause Analyzer**
   - Separates physical crude loss vs. BS&W / free-water error (GSV vs NSV).
   - Separates thermal / VCF error (GOV vs GSV & temperature shifts).
   - Correlates Loss/Gain spikes with Draft/Submitted/Correction-Hold tickets,
     Out-Turn sequence discontinuities, and internal transfer imbalances.
2. **CUSUM Creeping-Loss & Meter Drift Radar**
   - Applies Page's two-sided CUSUM over tank & location daily Loss/Gain %
     to surface subtle, sustained directional losses/gains.
3. **Custody Transfer & Transit Variance Intelligence**
   - Scans Tanker Tracking, Barge Trip Comparisons, FSO/Shuttle variances, and
     Movement Mapping comparisons (BARGE_TO_SHUTTLE / SHUTTLE_TO_FSO / BARGE_TO_FSO).
   - Escalates High-Risk security events where transit loss coincides with a
     seal mismatch.
   - Identifies chronic asset/route transit bias and orphaned unclosed movements.
4. **Terminal Health & Month-End Close Readiness**
   - Out-Turn sequence breaks, tanks missing active calibration tables, pending
     tickets/correction holds, overdue flowmeter calibrations, unacknowledged
     tanker receipts, unclosed trips/mappings, and missing accounting-day /
     Material Balance templates.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Any

from sqlalchemy.orm import Session

from app.config import (
    AI_MATERIAL_BALANCE_WARNING_PCT,
    AI_TRANSIT_LOSS_WARNING_PCT,
    APPROVED_TRANSACTION_STATUS,
    CORRECTION_HOLD_STATUS,
)
from app.dependencies.permissions import (
    apply_location_filter,
    apply_transaction_party_scope_filter,
    user_has_permission,
)
from app.models import (
    ApprovedTransactionCorrectionRequest,
    Asset,
    AssetCalibrationTable,
    FlowmeterConfig,
    FSOVoyage,
    Location,
    LocationAccountingDaySetting,
    MaterialBalanceTemplate,
    MovementMapping,
    MovementMappingComparison,
    OperationTransaction,
    OperationTransactionValue,
    ShuttleVoyage,
    TankerReceiptAcknowledgement,
    TankStockLedger,
    Trip,
    TripComparison,
    User,
)
from app.services import entry_statistics as stats
from app.services.entry_checks_service import list_open_ticket_abnormalities
from app.utils.helpers import get_transaction_ticket_number, safe_float


def _coerce_dict(raw: Any) -> dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str) and raw.strip():
        import json
        try:
            parsed = json.loads(raw)
            return parsed if isinstance(parsed, dict) else {}
        except (TypeError, ValueError):
            return {}
    return {}


def _analyze_material_balance_and_cusum(
    db: Session,
    current_user: User,
    *,
    location_code: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    """Compute Material Balance Loss/Gain events, Root-Cause Diagnostics & CUSUM Drift."""
    end_dt = date_to or date.today()
    start_dt = date_from or (end_dt - timedelta(days=45))

    q = db.query(TankStockLedger).filter(
        TankStockLedger.status == "Active",
    )
    q = apply_location_filter(q, TankStockLedger, current_user, db)
    if location_code:
        q = q.filter(TankStockLedger.location_code.ilike(location_code))

    all_rows = (
        q.order_by(
            TankStockLedger.location_code.asc(),
            TankStockLedger.tank_asset_code.asc(),
            TankStockLedger.accounting_date.asc(),
            TankStockLedger.operation_date.asc(),
            TankStockLedger.id.asc(),
        )
        .limit(4000)
        .all()
    )

    # Pre-fetch pending/unapproved tickets in the same window so root-cause can cite them
    pending_q = db.query(OperationTransaction).filter(
        OperationTransaction.status.in_(["Draft", "Submitted", CORRECTION_HOLD_STATUS]),
    )
    pending_q = apply_transaction_party_scope_filter(pending_q, OperationTransaction, current_user, db)
    if location_code:
        pending_q = pending_q.filter(OperationTransaction.origin_location_code.ilike(location_code))
    pending_by_loc_tank: dict[tuple[str, str], list[str]] = defaultdict(list)
    for tx in pending_q.limit(300).all():
        key = ((tx.origin_location_code or "").upper(), (tx.primary_asset_code or "").upper())
        pending_by_loc_tank[key].append(f"{get_transaction_ticket_number(tx)} ({tx.status})")

    # Group ledger rows per (location, tank) and check sequence continuity + daily Loss/Gain
    by_tank: dict[tuple[str, str], list[TankStockLedger]] = defaultdict(list)
    for row in all_rows:
        by_tank[(row.location_code or "", row.tank_asset_code or "")].append(row)

    loss_gain_events: list[dict[str, Any]] = []
    cusum_alerts: list[dict[str, Any]] = []
    sequence_breaks: list[dict[str, Any]] = []

    for (loc, tank), rows in by_tank.items():
        # Sequence continuity audit (same logic as validate_out_turn_report_tank_sequence)
        prev_row: TankStockLedger | None = None
        for r in rows:
            if prev_row is not None:
                expected_prev = safe_float(prev_row.stock_nsv_bbl or prev_row.running_balance_nsv_bbl)
                actual_prev = safe_float(r.previous_stock_nsv_bbl)
                if abs(round(actual_prev, 3) - round(expected_prev, 3)) > 0.05:
                    sequence_breaks.append({
                        "location_code": loc,
                        "tank_asset_code": tank,
                        "ticket_number": r.ticket_number,
                        "accounting_date": (r.accounting_date or r.operation_date).isoformat() if (r.accounting_date or r.operation_date) else None,
                        "expected_previous_nsv_bbl": round(expected_prev, 3),
                        "actual_previous_nsv_bbl": round(actual_prev, 3),
                        "gap_bbl": round(actual_prev - expected_prev, 3),
                    })
            prev_row = r

        # Daily accounting aggregation per tank: Opening + IN - OUT = Book Closing vs Actual Closing
        by_day: dict[date, list[TankStockLedger]] = defaultdict(list)
        for r in rows:
            acct_d = r.accounting_date or r.operation_date
            if acct_d is not None:
                by_day[acct_d].append(r)

        sorted_days = sorted(by_day.keys())
        prior_closing_nsv: float | None = None
        prior_closing_gsv: float | None = None
        daily_pct_series: list[float] = []
        daily_points: list[dict[str, Any]] = []

        for day in sorted_days:
            day_rows = by_day[day]
            opening_nsv = prior_closing_nsv if prior_closing_nsv is not None else safe_float(day_rows[0].previous_stock_nsv_bbl)
            opening_gsv = prior_closing_gsv if prior_closing_gsv is not None else safe_float(day_rows[0].previous_stock_gsv_bbl)

            in_nsv = out_nsv = in_gsv = out_gsv = 0.0
            has_closing_snapshot = False
            for r in day_rows:
                sign = str(r.tank_operation_sign or "").strip().upper()
                mv_nsv = safe_float(r.movement_nsv_bbl)
                mv_gsv = safe_float(r.movement_gsv_bbl)
                if sign == "IN":
                    in_nsv += abs(mv_nsv)
                    in_gsv += abs(mv_gsv)
                elif sign == "OUT":
                    out_nsv += abs(mv_nsv)
                    out_gsv += abs(mv_gsv)
                elif sign in ("SET", "NEUTRAL"):
                    has_closing_snapshot = True

            last = day_rows[-1]
            actual_closing_nsv = safe_float(last.stock_nsv_bbl or last.running_balance_nsv_bbl)
            actual_closing_gsv = safe_float(last.stock_gsv_bbl or last.running_balance_gsv_bbl)

            # Book closing = Opening + IN - OUT (matching tank_stock_ledger.py)
            book_closing_nsv = opening_nsv + in_nsv - out_nsv
            book_closing_gsv = opening_gsv + in_gsv - out_gsv
            lg_nsv = actual_closing_nsv - book_closing_nsv
            lg_gsv = actual_closing_gsv - book_closing_gsv

            denom = max(opening_nsv + in_nsv, actual_closing_nsv, 1.0)
            lg_nsv_pct = (lg_nsv / denom) * 100.0
            lg_gsv_pct = (lg_gsv / max(opening_gsv + in_gsv, actual_closing_gsv, 1.0)) * 100.0

            prior_closing_nsv = actual_closing_nsv
            prior_closing_gsv = actual_closing_gsv

            if day < start_dt or day > end_dt:
                continue

            daily_pct_series.append(lg_nsv_pct)
            daily_points.append({
                "date": day.isoformat(),
                "loss_gain_nsv_bbl": round(lg_nsv, 3),
                "loss_gain_pct": round(lg_nsv_pct, 4),
            })

            # Flag significant daily Loss/Gain and run deterministic Root-Cause Diagnosis
            if abs(lg_nsv) >= 5.0 and abs(lg_nsv_pct) >= AI_MATERIAL_BALANCE_WARNING_PCT:
                causes: list[str] = []
                directives: list[str] = []

                # 1. GSV vs NSV separation diagnostic (BS&W / free water)
                if abs(lg_gsv_pct) < AI_MATERIAL_BALANCE_WARNING_PCT * 0.5 and abs(lg_nsv_pct) >= AI_MATERIAL_BALANCE_WARNING_PCT:
                    causes.append("BS&W / Free Water divergence (GSV balanced while NSV diverged)")
                    directives.append("Cross-check lab BS&W% certificate and water dip readings on this accounting day.")
                elif abs(lg_gsv - lg_nsv) > max(abs(lg_nsv) * 0.35, 10.0):
                    causes.append("Mixed physical and BS&W/water variance")
                    directives.append("Verify both gross dip/temperature (VCF) and BS&W% entries.")
                else:
                    causes.append("Physical volume / dip / thermal (VCF) discrepancy")
                    directives.append("Re-verify opening/closing dips, tank temperature (°C/°F), and active calibration chart.")

                # 2. Check pending Draft/Submitted/Correction-Hold tickets
                pending_list = pending_by_loc_tank.get((loc.upper(), tank.upper()), [])
                if pending_list:
                    causes.append(f"{len(pending_list)} unapproved or correction-hold ticket(s) on this tank")
                    directives.append(f"Review pending ticket(s): {', '.join(pending_list[:3])}.")

                # 3. Check sequence breaks for this tank
                tank_breaks = [b for b in sequence_breaks if b["location_code"] == loc and b["tank_asset_code"] == tank]
                if tank_breaks:
                    causes.append("Out-Turn previous-stock sequence break detected")
                    directives.append("Run Tank Stock Ledger sequence validation / rebuild.")

                if not has_closing_snapshot and abs(lg_nsv) > 10.0:
                    causes.append("Opening/movement continuity gap without a static closing gauge")

                severity = "warning" if abs(lg_nsv_pct) >= AI_MATERIAL_BALANCE_WARNING_PCT * 2.0 else "info"
                loss_gain_events.append({
                    "location_code": loc,
                    "tank_asset_code": tank,
                    "accounting_date": day.isoformat(),
                    "product_name": last.product_name or "",
                    "opening_nsv_bbl": round(opening_nsv, 2),
                    "receipts_in_nsv_bbl": round(in_nsv, 2),
                    "dispatches_out_nsv_bbl": round(out_nsv, 2),
                    "book_closing_nsv_bbl": round(book_closing_nsv, 2),
                    "actual_closing_nsv_bbl": round(actual_closing_nsv, 2),
                    "loss_gain_nsv_bbl": round(lg_nsv, 2),
                    "loss_gain_nsv_pct": round(lg_nsv_pct, 3),
                    "loss_gain_gsv_bbl": round(lg_gsv, 2),
                    "loss_gain_gsv_pct": round(lg_gsv_pct, 3),
                    "direction": "Loss" if lg_nsv < 0 else "Gain",
                    "severity": severity,
                    "root_cause": "; ".join(causes),
                    "directive": " ".join(directives),
                    "route": "/material-balance-report",
                })

        # CUSUM creeping-loss / creeping-gain scan for this tank
        cusum = stats.detect_cusum_drift(daily_pct_series, unit_label="%")
        if cusum.direction != "none":
            cusum_alerts.append({
                "location_code": loc,
                "tank_asset_code": tank,
                "direction": "Creeping Loss" if cusum.direction == "loss" else "Creeping Gain",
                "severity": cusum.severity,
                "sample_count": cusum.sample_count,
                "rolling_mean_pct": cusum.rolling_mean,
                "cumulative_pct": cusum.cumulative_sum,
                "cusum_peak": cusum.cusum_peak,
                "threshold": cusum.threshold,
                "streak_length": cusum.streak_length,
                "summary": cusum.summary,
                "trend_points": daily_points[-20:],
                "route": "/material-balance-report",
            })

    loss_gain_events.sort(key=lambda e: (0 if e["severity"] == "warning" else 1, -abs(e["loss_gain_nsv_bbl"])))
    cusum_alerts.sort(key=lambda c: (0 if c["severity"] == "warning" else 1, -c["cusum_peak"]))
    return loss_gain_events[:100], cusum_alerts[:50], sequence_breaks[:100]


def _analyze_custody_transfer_variances(
    db: Session,
    current_user: User,
    *,
    location_code: str | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Scan Movement Mappings, Barge Trip Comparisons & Tanker Transfers for loss/gain & seal risks."""
    transit_alerts: list[dict[str, Any]] = []
    asset_variances: dict[tuple[str, str], list[float]] = defaultdict(list)

    # 1. Movement Mappings (BARGE_TO_SHUTTLE, SHUTTLE_TO_FSO, BARGE_TO_FSO)
    if user_has_permission(current_user, "View Movement Mapping", db):
        mm_q = db.query(MovementMapping, MovementMappingComparison).join(
            MovementMappingComparison,
            MovementMappingComparison.mapping_id == MovementMapping.id,
        )
        mm_q = apply_location_filter(mm_q, MovementMapping, current_user, db)
        if location_code:
            mm_q = mm_q.filter(MovementMapping.location_code.ilike(location_code))

        for mapping, cmp_row in mm_q.order_by(MovementMapping.id.desc()).limit(120).all():
            diff_bbl = safe_float(cmp_row.diff_nsv_bbl)
            diff_pct = safe_float(cmp_row.diff_nsv_percent)
            src_nsv = safe_float(cmp_row.source_nsv_bbl)
            tgt_nsv = safe_float(cmp_row.target_nsv_bbl)
            if src_nsv <= 0:
                continue
            asset_variances[("Movement Mapping", f"{mapping.mapping_type} · {mapping.location_code}")].append(diff_pct)
            if abs(diff_pct) >= AI_TRANSIT_LOSS_WARNING_PCT:
                transit_alerts.append({
                    "module": "Movement Mapping",
                    "reference": mapping.reference_number or f"MM-{mapping.id}",
                    "location_code": mapping.location_code,
                    "asset_code": mapping.mapping_type,
                    "source_nsv_bbl": round(src_nsv, 2),
                    "target_nsv_bbl": round(tgt_nsv, 2),
                    "variance_bbl": round(diff_bbl, 2),
                    "variance_pct": round(diff_pct, 3),
                    "seal_issue": False,
                    "severity": "warning" if abs(diff_pct) >= AI_TRANSIT_LOSS_WARNING_PCT * 1.8 else "info",
                    "directive": (
                        f"{mapping.mapping_type} reconciliation shows {diff_bbl:+,.2f} BBL ({diff_pct:+.2f}%). "
                        "Verify all source/target tickets are attached and compare GSV vs NSV water delta."
                    ),
                    "route": "/movement-mappings",
                })

    # 2. Barge Trip Comparisons
    if user_has_permission(current_user, "View Barge Tracking", db):
        bt_q = db.query(Trip, TripComparison).join(TripComparison, TripComparison.trip_id == Trip.id)
        for trip, cmp_row in bt_q.order_by(TripComparison.id.desc()).limit(100).all():
            summary = _coerce_dict(cmp_row.summary_json)
            diff_nsv = safe_float(summary.get("diff_nsv_bbl") or summary.get("nsv_variance_bbl") or (summary.get("diff") or {}).get("NSV"))
            src_nsv = safe_float(summary.get("left_nsv_bbl") or (summary.get("left") or {}).get("NSV"))
            tgt_nsv = safe_float(summary.get("right_nsv_bbl") or (summary.get("right") or {}).get("NSV"))
            diff_pct = (diff_nsv / src_nsv * 100.0) if src_nsv > 0 else safe_float(summary.get("diff_nsv_percent"))
            barge_code = trip.primary_barge_asset_code or trip.convoy_number or "Barge"
            if src_nsv > 0:
                asset_variances[("Barge", barge_code)].append(diff_pct)
            if src_nsv > 0 and abs(diff_pct) >= AI_TRANSIT_LOSS_WARNING_PCT:
                transit_alerts.append({
                    "module": "Barge Tracking",
                    "reference": trip.convoy_number,
                    "location_code": "",
                    "asset_code": barge_code,
                    "source_nsv_bbl": round(src_nsv, 2),
                    "target_nsv_bbl": round(tgt_nsv, 2),
                    "variance_bbl": round(diff_nsv, 2),
                    "variance_pct": round(diff_pct, 3),
                    "seal_issue": False,
                    "severity": "warning" if abs(diff_pct) >= AI_TRANSIT_LOSS_WARNING_PCT * 1.8 else "info",
                    "directive": (
                        f"Barge convoy {trip.convoy_number} ({barge_code}) variance is {diff_nsv:+,.2f} BBL "
                        f"({diff_pct:+.2f}%). Inspect compartment per-tank comparison and manifold seals."
                    ),
                    "route": "/barge-tracking",
                })

    # 3. Tanker sender-vs-receiver comparisons with seal-mismatch security escalation
    if user_has_permission(current_user, "View Tanker Tracking", db):
        tx_q = db.query(OperationTransaction).filter(
            OperationTransaction.status == APPROVED_TRANSACTION_STATUS,
        )
        tx_q = apply_transaction_party_scope_filter(tx_q, OperationTransaction, current_user, db)
        if location_code:
            tx_q = tx_q.filter(
                (OperationTransaction.origin_location_code.ilike(location_code))
                | (OperationTransaction.destination_location_code.ilike(location_code))
            )
        tx_ids_subq = tx_q.with_entities(OperationTransaction.id).scalar_subquery()
        tanker_vals = (
            db.query(OperationTransaction, OperationTransactionValue)
            .join(OperationTransactionValue, OperationTransactionValue.transaction_id == OperationTransaction.id)
            .filter(
                OperationTransaction.id.in_(tx_ids_subq),
                OperationTransactionValue.field_code.in_(["tanker_payload", "linked_sender_transaction_id"]),
            )
            .all()
        )
        tx_map: dict[int, OperationTransaction] = {}
        payload_by_tx: dict[int, dict[str, Any]] = {}
        link_by_tx: dict[int, int] = {}
        for tx, val in tanker_vals:
            tx_map[tx.id] = tx
            if val.field_code == "tanker_payload":
                payload_by_tx[tx.id] = _coerce_dict(val.field_value)
            elif val.field_code == "linked_sender_transaction_id" and val.field_value:
                try:
                    link_by_tx[tx.id] = int(str(val.field_value))
                except (TypeError, ValueError):
                    pass

        for recv_id, sender_id in link_by_tx.items():
            recv_tx = tx_map.get(recv_id)
            sender_p = payload_by_tx.get(sender_id)
            recv_p = payload_by_tx.get(recv_id)
            if not recv_tx or not sender_p or not recv_p:
                continue
            s_inp, s_calc = sender_p.get("inputs") or {}, sender_p.get("calculated") or {}
            r_inp, r_calc = recv_p.get("inputs") or {}, recv_p.get("calculated") or {}
            s_nsv = safe_float(s_calc.get("nsvBbl") or s_calc.get("nsv_bbl"))
            r_nsv = safe_float(r_calc.get("nsvBbl") or r_calc.get("nsv_bbl"))
            if s_nsv <= 0 or r_nsv <= 0:
                continue
            diff_bbl = r_nsv - s_nsv
            diff_pct = (diff_bbl / s_nsv) * 100.0
            seal_mismatch = any(
                str(s_inp.get(k) or "").strip().upper() != str(r_inp.get(k) or "").strip().upper()
                and bool(str(s_inp.get(k) or "").strip())
                and bool(str(r_inp.get(k) or "").strip())
                for k in ("sealC1", "sealC2", "sealM1", "sealM2")
            )
            asset_key = recv_tx.primary_asset_code or s_inp.get("tankerName") or "Tanker"
            asset_variances[("Tanker", asset_key)].append(diff_pct)
            if abs(diff_pct) >= AI_TRANSIT_LOSS_WARNING_PCT or seal_mismatch:
                transit_alerts.append({
                    "module": "Tanker Tracking",
                    "reference": get_transaction_ticket_number(recv_tx),
                    "location_code": recv_tx.origin_location_code or "",
                    "asset_code": asset_key,
                    "source_nsv_bbl": round(s_nsv, 2),
                    "target_nsv_bbl": round(r_nsv, 2),
                    "variance_bbl": round(diff_bbl, 2),
                    "variance_pct": round(diff_pct, 3),
                    "seal_issue": seal_mismatch,
                    "severity": "warning" if (seal_mismatch or abs(diff_pct) >= AI_TRANSIT_LOSS_WARNING_PCT * 1.5) else "info",
                    "directive": (
                        "HIGH PRIORITY: Transit loss coincides with seal mismatch — initiate custody-transfer investigation."
                        if (seal_mismatch and diff_bbl < 0)
                        else (
                            "Seal mismatch recorded between sender and receiver tickets."
                            if seal_mismatch
                            else f"Tanker transit variance {diff_bbl:+,.2f} BBL ({diff_pct:+.2f}%). Check calibration & temperature."
                        )
                    ),
                    "route": "/tanker-tracking",
                })

    # Chronic asset/route bias summary
    chronic_bias: list[dict[str, Any]] = []
    for (mod, asset_label), pcts in asset_variances.items():
        if len(pcts) < 4:
            continue
        avg_pct = sum(pcts) / len(pcts)
        if abs(avg_pct) >= AI_TRANSIT_LOSS_WARNING_PCT * 0.75:
            chronic_bias.append({
                "module": mod,
                "asset_code": asset_label,
                "trips_analyzed": len(pcts),
                "mean_variance_pct": round(avg_pct, 3),
                "direction": "Chronic Loss" if avg_pct < 0 else "Chronic Gain",
                "directive": (
                    f"{asset_label} averaged {avg_pct:+.2f}% across {len(pcts)} reconciled movements. "
                    "Recommend calibration chart / VEF / compartment strapping audit."
                ),
            })

    transit_alerts.sort(key=lambda a: (0 if a["seal_issue"] else 1, 0 if a["severity"] == "warning" else 1, -abs(a["variance_pct"])))
    chronic_bias.sort(key=lambda c: -abs(c["mean_variance_pct"]))
    return transit_alerts[:80], chronic_bias[:30]


def get_terminal_readiness_checks(
    db: Session,
    current_user: User,
    *,
    location_code: str | None = None,
) -> list[dict[str, Any]]:
    """Permission- & scope-filtered list of operational and month-end readiness gaps."""
    checks: list[dict[str, Any]] = []

    # 1. Pending Draft / Submitted / Correction-Hold Operation Transactions
    if user_has_permission(current_user, "View Operation Transaction", db):
        base_tx = apply_transaction_party_scope_filter(
            db.query(OperationTransaction), OperationTransaction, current_user, db
        )
        if location_code:
            base_tx = base_tx.filter(OperationTransaction.origin_location_code.ilike(location_code))
        drafts = base_tx.filter(OperationTransaction.status == "Draft").count()
        submitted = base_tx.filter(OperationTransaction.status == "Submitted").count()
        if drafts:
            checks.append({
                "code": "pending-draft-tickets",
                "label": "Draft operation tickets awaiting submission",
                "value": str(drafts),
                "severity": "info",
                "hint": "Draft tickets do not post to Tank Stock Ledger or Material Balance until submitted and approved.",
                "route": "/operation-transactions",
                "permission": "Submit Operation Transaction",
            })
        if submitted:
            checks.append({
                "code": "pending-submitted-tickets",
                "label": "Submitted tickets awaiting approval",
                "value": str(submitted),
                "severity": "warning",
                "hint": "Pending approvals can create temporary Material Balance Loss/Gain until posted.",
                "route": "/operation-tasks",
                "permission": "Approve Operation Transaction",
            })
        holds = (
            db.query(ApprovedTransactionCorrectionRequest)
            .filter(ApprovedTransactionCorrectionRequest.status == "Pending")
            .count()
        )
        if holds:
            checks.append({
                "code": "pending-correction-requests",
                "label": "Pending approved-ticket correction requests",
                "value": str(holds),
                "severity": "warning",
                "hint": "Tickets on correction hold should be resolved before period close.",
                "route": "/operation-tasks",
                "permission": "Admin Revoke Approved Transaction",
            })

    # 2. Active locations missing Accounting Day Setting or Material Balance Template
    if user_has_permission(current_user, "View Location", db):
        loc_q = apply_location_filter(
            db.query(Location).filter(Location.status == "Active"),
            Location,
            current_user,
            db,
        )
        if location_code:
            loc_q = loc_q.filter(Location.location_code.ilike(location_code))
        active_locs = [l.location_code for l in loc_q.all()]
        if active_locs:
            configured_days = {
                r.location_code.upper()
                for r in db.query(LocationAccountingDaySetting)
                .filter(LocationAccountingDaySetting.status == "Active")
                .all()
                if r.location_code
            }
            missing_day = [c for c in active_locs if c.upper() not in configured_days]
            if missing_day:
                checks.append({
                    "code": "missing-accounting-day-setting",
                    "label": "Active locations without Accounting Day Setting",
                    "value": str(len(missing_day)),
                    "severity": "warning",
                    "hint": f"Configure cutoff & timezone for: {', '.join(missing_day[:6])}.",
                    "route": "/location-accounting-day-settings",
                    "permission": "View Location Accounting Day Setting",
                })
            configured_mb = {
                r.location_code.upper()
                for r in db.query(MaterialBalanceTemplate)
                .filter(MaterialBalanceTemplate.status == "Active")
                .all()
                if r.location_code
            }
            missing_mb = [c for c in active_locs if c.upper() not in configured_mb]
            if missing_mb:
                checks.append({
                    "code": "missing-material-balance-template",
                    "label": "Active locations without Material Balance Template",
                    "value": str(len(missing_mb)),
                    "severity": "info",
                    "hint": f"Material Balance Report requires an active template for: {', '.join(missing_mb[:6])}.",
                    "route": "/material-balance-template-master",
                    "permission": "View Material Balance Template",
                })

    # 3. Active Tank assets missing calibration tables
    if user_has_permission(current_user, "View Asset", db) and user_has_permission(current_user, "View Asset Calibration", db):
        asset_q = db.query(Asset).filter(Asset.status == "Active")
        asset_q = apply_location_filter(asset_q, Asset, current_user, db, column_name="location_code")
        if location_code:
            asset_q = asset_q.filter(Asset.location_code.ilike(location_code))
        tanks = [
            a.asset_code
            for a in asset_q.all()
            if "TANK" in str(a.asset_type_code or "").upper()
        ]
        if tanks:
            calibrated = {
                t.asset_code.upper()
                for t in db.query(AssetCalibrationTable)
                .filter(AssetCalibrationTable.status == "Active")
                .all()
                if t.asset_code
            }
            uncalibrated = [code for code in tanks if code.upper() not in calibrated]
            if uncalibrated:
                checks.append({
                    "code": "tanks-missing-calibration",
                    "label": "Active tanks without an active calibration table",
                    "value": str(len(uncalibrated)),
                    "severity": "warning",
                    "hint": f"Gauging volume interpolation requires calibration tables for: {', '.join(uncalibrated[:6])}.",
                    "route": "/asset-calibrations",
                    "permission": "Create Asset Calibration",
                })

    # 4. Flowmeters with overdue calibration (> 365 days)
    if user_has_permission(current_user, "View Flowmeter Config", db):
        fm_q = apply_location_filter(
            db.query(FlowmeterConfig).filter(FlowmeterConfig.status == "Active"),
            FlowmeterConfig,
            current_user,
            db,
        )
        if location_code:
            fm_q = fm_q.filter(FlowmeterConfig.location_code.ilike(location_code))
        cutoff_date = date.today() - timedelta(days=365)
        overdue = [
            f"{c.asset_code}/{c.meter_label}"
            for c in fm_q.all()
            if c.calibration_date is not None and c.calibration_date < cutoff_date
        ]
        if overdue:
            checks.append({
                "code": "flowmeter-calibration-overdue",
                "label": "Flowmeters overdue for annual calibration",
                "value": str(len(overdue)),
                "severity": "info",
                "hint": f"Verify meter factor proving for: {', '.join(overdue[:6])}.",
                "route": "/flowmeter-configs",
                "permission": "Edit Flowmeter Config",
            })

    # 5. Open / Unclosed Custody-Transfer Movements
    if user_has_permission(current_user, "View Movement Mapping", db):
        open_mm_q = apply_location_filter(
            db.query(MovementMapping).filter(MovementMapping.status == "OPEN"),
            MovementMapping,
            current_user,
            db,
        )
        if location_code:
            open_mm_q = open_mm_q.filter(MovementMapping.location_code.ilike(location_code))
        open_mm = open_mm_q.count()
        if open_mm:
            checks.append({
                "code": "open-movement-mappings",
                "label": "Open Movement Mappings awaiting closure",
                "value": str(open_mm),
                "severity": "info",
                "hint": "Attach remaining target tickets and close reconciled convoy mappings before month-end.",
                "route": "/movement-mappings",
                "permission": "Close Movement Mapping",
            })

    if user_has_permission(current_user, "View Barge Tracking", db):
        open_trips = db.query(Trip).filter(Trip.status == "OPEN").count()
        if open_trips:
            checks.append({
                "code": "open-barge-trips",
                "label": "Open Barge Trips awaiting closure",
                "value": str(open_trips),
                "severity": "info",
                "hint": "Review sender/receiver barge comparisons and close completed convoys.",
                "route": "/barge-tracking",
                "permission": "Close Barge Movement",
            })

    if user_has_permission(current_user, "View Shuttle Tracking", db):
        open_sh = apply_location_filter(
            db.query(ShuttleVoyage).filter(ShuttleVoyage.status == "OPEN"),
            ShuttleVoyage,
            current_user,
            db,
        )
        if location_code:
            open_sh = open_sh.filter(ShuttleVoyage.location_code.ilike(location_code))
        cnt = open_sh.count()
        if cnt:
            checks.append({
                "code": "open-shuttle-voyages",
                "label": "Open Shuttle Voyages awaiting closure",
                "value": str(cnt),
                "severity": "info",
                "hint": "Close completed shuttle voyages after FSO reconciliation.",
                "route": "/shuttle-tracking",
                "permission": "Close Shuttle Voyage",
            })

    if user_has_permission(current_user, "View FSO Tracking", db):
        open_fso = apply_location_filter(
            db.query(FSOVoyage).filter(FSOVoyage.status == "OPEN"),
            FSOVoyage,
            current_user,
            db,
        )
        if location_code:
            open_fso = open_fso.filter(FSOVoyage.location_code.ilike(location_code))
        cnt = open_fso.count()
        if cnt:
            checks.append({
                "code": "open-fso-voyages",
                "label": "Open FSO Voyages awaiting closure",
                "value": str(cnt),
                "severity": "info",
                "hint": "Verify FSO variance and close completed off-take voyages.",
                "route": "/fso-tracking",
                "permission": "Close FSO Voyage",
            })

    if user_has_permission(current_user, "View Tanker Tracking", db):
        open_ack = (
            db.query(TankerReceiptAcknowledgement)
            .filter(TankerReceiptAcknowledgement.status == "Acknowledged")
            .count()
        )
        if open_ack:
            checks.append({
                "code": "open-tanker-acknowledgements",
                "label": "Acknowledged tanker receipts not yet closed",
                "value": str(open_ack),
                "severity": "info",
                "hint": "Complete receiver unloading ticket and close tanker tracking movements.",
                "route": "/tanker-tracking",
                "permission": "Close Tanker Movement",
            })

    return checks


def get_stock_anomaly_overview(
    db: Session,
    current_user: User,
    *,
    location_code: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
) -> dict[str, Any]:
    """Build the unified Hydrocarbon Accounting & Stock Anomaly Analytics response."""
    loss_gain_events, cusum_alerts, sequence_breaks = _analyze_material_balance_and_cusum(
        db,
        current_user,
        location_code=location_code,
        date_from=date_from,
        date_to=date_to,
    )
    transit_alerts, chronic_bias = _analyze_custody_transfer_variances(
        db,
        current_user,
        location_code=location_code,
    )
    open_ticket_abnormalities = (
        list_open_ticket_abnormalities(db, current_user, location_code=location_code, limit=40)
        if user_has_permission(current_user, "View Entry Checks", db)
        else []
    )
    readiness_checks = get_terminal_readiness_checks(db, current_user, location_code=location_code)

    if sequence_breaks:
        readiness_checks.insert(
            0,
            {
                "code": "out-turn-sequence-breaks",
                "label": "Out-Turn tank stock sequence discontinuities",
                "value": str(len(sequence_breaks)),
                "severity": "warning",
                "hint": "Previous stock does not match the preceding gauge on one or more tanks. Rebuild Tank Stock Ledger.",
                "route": "/out-turn-summary",
                "permission": "Rebuild Tank Stock Ledger",
            },
        )

    # Readiness score (100 minus weighted penalties, clamped 0..100)
    warn_penalties = (
        sum(1 for c in readiness_checks if c["severity"] == "warning") * 12
        + sum(1 for c in readiness_checks if c["severity"] != "warning") * 4
        + sum(1 for a in transit_alerts if a["seal_issue"]) * 10
        + len(cusum_alerts) * 6
    )
    readiness_score = max(0, min(100, 100 - warn_penalties))

    return {
        "generated_at": datetime.utcnow().isoformat(),
        "location_code": location_code or "ALL",
        "kpis": {
            "loss_gain_events": len(loss_gain_events),
            "loss_gain_warnings": sum(1 for e in loss_gain_events if e["severity"] == "warning"),
            "cusum_drift_alerts": len(cusum_alerts),
            "transit_variance_alerts": len(transit_alerts),
            "seal_security_escalations": sum(1 for a in transit_alerts if a["seal_issue"]),
            "open_ticket_abnormalities": len(open_ticket_abnormalities),
            "sequence_breaks": len(sequence_breaks),
            "readiness_score": readiness_score,
        },
        "loss_gain_events": loss_gain_events,
        "cusum_alerts": cusum_alerts,
        "transit_alerts": transit_alerts,
        "chronic_bias": chronic_bias,
        "sequence_breaks": sequence_breaks,
        "open_ticket_abnormalities": open_ticket_abnormalities,
        "readiness_checks": readiness_checks,
    }
