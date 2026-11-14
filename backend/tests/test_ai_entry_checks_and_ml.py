"""Tests for Entry Statistics, Hydrocarbon Rules, Tier 2 Multivariate ML & Entry Check APIs."""

from __future__ import annotations

import json
import time
from datetime import date, timedelta

from app.models import (
    AuditLog,
    Location,
    OperationTemplate,
    OperationTransaction,
    OperationTransactionValue,
    OperationType,
    Role,
    User,
    UserRole,
)
from app.services import entry_statistics as stats
from app.services.hydrocarbon_entry_rules import (
    evaluate_book_stock_rules,
    evaluate_export_rules,
    evaluate_flowmeter_rules,
    evaluate_multi_tank_rules,
    evaluate_tank_gauging_rules,
    evaluate_tanker_rules,
    evaluate_vessel_voyage_rules,
)
from app.services.multivariate_anomaly_ml import evaluate_multivariate_anomaly
from app.utils.security import hash_password


def _seed_admin(db, username: str = "admin", password: str = "Admin@123456") -> User:
    role = Role(role_name="Admin", description="Administrator", status="Active")
    db.add(role)
    db.flush()
    user = User(
        full_name="System Admin",
        username=username,
        email="admin@example.com",
        password_hash=hash_password(password),
        force_password_change="No",
        all_locations_access="Yes",
        status="Active",
    )
    db.add(user)
    db.flush()
    db.add(UserRole(user_id=user.id, role_id=role.id))
    db.commit()
    return user


def _auth_headers(client, username: str, password: str) -> dict[str, str]:
    resp = client.post("/auth/login", json={"username": username, "password": password})
    assert resp.status_code == 200, resp.text
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _create_limited_user(db, username: str, password: str) -> User:
    role = Role(role_name=f"Role_{username}", description="No entry-check perms", status="Active")
    db.add(role)
    db.flush()
    user = User(
        full_name="Limited User",
        username=username,
        email=f"{username}@example.com",
        password_hash=hash_password(password),
        force_password_change="No",
        status="Active",
    )
    db.add(user)
    db.flush()
    db.add(UserRole(user_id=user.id, role_id=role.id))
    db.commit()
    return user


# ---------------------------------------------------------------------------
# 1. Pure Statistics, Keying-Slip Solvers & CUSUM Drift
# ---------------------------------------------------------------------------


def test_entry_statistics_profiles_and_keying_slips():
    history = [240.0, 245.0, 248.0, 250.0, 252.0, 246.0, 249.0, 251.0]
    profile = stats.build_profile(history)
    assert profile is not None
    assert profile.count == 8
    assert 247.0 <= profile.median <= 250.0

    # Extra zero / x10 keying slip
    slip = stats.explain_slip(2485.0, profile, stats.DECIMAL_FAMILIES)
    assert slip is not None
    assert slip.kind == stats.SCALE_10
    assert 240.0 <= float(slip.corrected) <= 260.0

    # Transposed adjacent digits (e.g. 520 instead of 250)
    typo = stats.explain_slip(520.0, profile, stats.DECIMAL_FAMILIES)
    assert typo is not None
    assert typo.kind == stats.SWAPPED_DIGITS
    assert abs(float(typo.corrected) - 250.0) < 1e-6


def test_cusum_detects_creeping_loss_and_ignores_noise():
    # Steady -0.22%/day creeping loss (each day alone is below a 0.30% alarm!)
    creeping = [-0.20, -0.24, -0.18, -0.25, -0.21, -0.22, -0.19, -0.26, -0.23, -0.20, -0.24, -0.22]
    res = stats.detect_cusum_drift(creeping, unit_label="%")
    assert res.direction == "loss"
    assert res.severity in ("warning", "info")
    assert res.streak_length >= 6

    # Balanced zero-mean random noise stays clean
    balanced = [0.05, -0.04, 0.03, -0.06, 0.04, -0.02, 0.01, -0.03, 0.05, -0.04]
    clean = stats.detect_cusum_drift(balanced, unit_label="%")
    assert clean.direction == "none"


# ---------------------------------------------------------------------------
# 2. Tier 2 Multi-Variable Anomaly ML (IsolationForest + HalfSpace + Mahalanobis)
# ---------------------------------------------------------------------------


def test_tier2_multivariate_ml_flags_combination_outlier_and_calibrates_feedback():
    feature_names = ["dip_cm", "water_cm", "tank_temp_c", "api60", "bsw_pct", "delta_nsv"]
    history = [
        [
            250.0 + (i % 5) * 1.5,
            2.0 + (i % 3) * 0.2,
            32.0 + (i % 4) * 0.5,
            34.0 + (i % 4) * 0.15,
            0.4 + (i % 3) * 0.05,
            500.0 + (i % 5) * 20.0,
        ]
        for i in range(28)
    ]

    normal_pt = [252.0, 2.2, 32.5, 34.15, 0.45, 520.0]
    t0 = time.perf_counter()
    normal_res = evaluate_multivariate_anomaly(
        history,
        normal_pt,
        feature_names=feature_names,
        threshold=0.68,
    )
    elapsed_ms = (time.perf_counter() - t0) * 1000.0
    assert normal_res.available is True
    assert normal_res.is_anomaly is False
    assert elapsed_ms < 250.0  # fast pure-NumPy CPU execution

    # Subtle multivariate combination anomaly
    outlier_pt = [310.0, 8.5, 44.0, 29.0, 2.4, -1800.0]
    outlier_res = evaluate_multivariate_anomaly(
        history,
        outlier_pt,
        feature_names=feature_names,
        threshold=0.68,
    )
    assert outlier_res.available is True
    assert outlier_res.is_anomaly is True
    assert outlier_res.score >= 0.68
    assert len(outlier_res.drivers) >= 1

    # Operator feedback calibration attenuates repeat false positives
    calibrated_res = evaluate_multivariate_anomaly(
        history,
        outlier_pt,
        feature_names=feature_names,
        confirmed_history_rows=[outlier_pt],
        threshold=0.68,
    )
    assert calibrated_res.feedback_attenuation < 1.0
    assert calibrated_res.score < outlier_res.score


# ---------------------------------------------------------------------------
# 3. Pure Hydrocarbon Domain Rules Across Modules
# ---------------------------------------------------------------------------


def test_hydrocarbon_domain_rules_cover_all_modules():
    # Tank Gauging: water > dip, °C/°F swap, API/Density swap, above calibration, duplicate
    tank_findings, _ = evaluate_tank_gauging_rules(
        asset_code="TK-101",
        inputs={
            "dipCm": 220,
            "waterLevelCm": 260,
            "tankTemperature": 90,
            "tankTemperatureUnit": "C",
            "observedApi": 850,
            "bswPercent": 0.5,
            "gaugingDate": "2026-10-15",
            "gaugingTime": "06:05",
        },
        calculated={"nsvBbl": 5000, "vcf": 0.99},
        history=[],
        max_calibration_dip_cm=200,
        accounting_cutoff_hhmm="06:00",
        duplicate_tickets=["TKT-0099"],
        ml_enabled=False,
    )
    tank_codes = {f.code for f in tank_findings}
    assert "water-exceeds-dip" in tank_codes
    assert "temp-unit-swap" in tank_codes
    assert "api-density-swap" in tank_codes
    assert "dip-above-calibration" in tank_codes
    assert "potential-duplicate-ticket" in tank_codes

    # Multi-Tank Barge: inverted Before/After time & CCF out of bounds
    multi_findings, _ = evaluate_multi_tank_rules(
        asset_code="BRG-01",
        payload={
            "before": {"date": "2026-10-15", "time": "14:00", "ccf": 1.25, "rows": []},
            "after": {"date": "2026-10-15", "time": "10:00", "ccf": 1.0, "rows": []},
            "calculated": {"net": {"NSV": 1200}},
        },
        history=[],
        ml_enabled=False,
    )
    multi_codes = {f.code for f in multi_findings}
    assert "before-after-time-inversion" in multi_codes
    assert "ccf-out-of-range" in multi_codes

    # Tanker: Seal Mismatch + Transit Shortage > 0.35%
    tanker_findings, _ = evaluate_tanker_rules(
        asset_code="TNK-01",
        inputs={"totalDipCm": 200, "waterDipCm": 2, "sealC1": "SEAL-BAD", "sealC2": "C2-OK"},
        calculated={"nsvBbl": 4800, "api60": 34.0},
        sender_reference={"ticketNumber": "SND-01", "sealC1": "SEAL-ORIG", "sealC2": "C2-OK", "nsvBbl": 5000, "api60": 34.0},
        history=[],
        ml_enabled=False,
    )
    tanker_codes = {f.code for f in tanker_findings}
    assert "tanker-seal-mismatch" in tanker_codes
    assert "transit-nsv-variance" in tanker_codes

    # Flowmeter: opening discontinuity + negative delta + overdue calibration
    fm_findings, _ = evaluate_flowmeter_rules(
        asset_code="FM-01",
        meters=[{"meter_label": "M1", "opening_reading": 2000, "closing_reading": 1950, "meter_factor": 1.0}],
        previous_closings={"M1": 1800},
        calibration_dates={"M1": date.today() - timedelta(days=420)},
        history=[],
        ml_enabled=False,
    )
    fm_codes = {f.code for f in fm_findings}
    assert "flowmeter-totalizer-gap" in fm_codes
    assert "flowmeter-negative-delta" in fm_codes
    assert "flowmeter-calibration-overdue" in fm_codes

    # FSO: variance exceeding tolerance
    fso_findings, _ = evaluate_vessel_voyage_rules(
        mode="fso",
        asset_code="FSO-01",
        inputs={
            "opening_stock_bbl": 100000,
            "closing_stock_bbl": 110000,
            "opening_water_bbl": 500,
            "closing_water_bbl": 500,
            "vessel_quantity_bbl": 12000,
        },
        history=[],
        ml_enabled=False,
    )
    assert any(f.code == "fso-variance-high" for f in fso_findings)

    # Book Stock: negative closing + omitted usual producing field
    bs_findings, _ = evaluate_book_stock_rules(
        entity_code="ENT1",
        block_code="BLK1",
        product_code="CRUDE",
        opening_stock=100,
        production=0,
        dispatch=500,
        adjustment=0,
        suggested_opening=100,
        field_productions=[{"field_code": "F1", "field_name": "Field 1", "production_qty": 0}],
        usual_active_fields=[{"code": "F1", "name": "Field 1", "streak": 6, "median": 1200.0}],
        history=[],
        ml_enabled=False,
    )
    bs_codes = {f.code for f in bs_findings}
    assert "book-negative-closing" in bs_codes
    assert "usual-field-missing" in bs_codes

    # Export: permit over-allocation
    exp_findings = evaluate_export_rules(
        entity_code="ENT1",
        block_code="BLK1",
        lifting_volume=600000,
        permit_number="PRM-01",
        permit_allocated=1000000,
        permit_used=500000,
        permit_expired=False,
        history_volumes=[],
    )
    assert any(f.code == "export-permit-exceeded" for f in exp_findings)


# ---------------------------------------------------------------------------
# 4. End-to-End FastAPI Router, Audited Reviews & RBAC Tests
# ---------------------------------------------------------------------------


def test_entry_checks_api_preview_keep_reopen_and_audit_trail(client, db):
    admin = _seed_admin(db)
    headers = _auth_headers(client, admin.username, "Admin@123456")

    db.add(Location(location_name="Terminal One", location_code="LOC01", location_type="Terminal", status="Active"))
    op_type = OperationType(
        operation_type_name="Tank Gauging",
        operation_type_code="TANK_GAUGE",
        operation_category="Tank",
        applicable_asset_type_code="TANK",
        status="Active",
    )
    db.add(op_type)
    db.flush()
    tpl = OperationTemplate(
        template_name="Tank Gauge Crude",
        operation_type_code="TANK_GAUGE",
        entry_layout_type="Tank Gauging",
        status="Active",
    )
    db.add(tpl)
    db.flush()

    tx = OperationTransaction(
        operation_ticket_number="TG-2026-0001",
        operation_number="OP-2026-0001",
        operation_type_code="TANK_GAUGE",
        operation_template_id=tpl.id,
        primary_asset_code="TK-101",
        primary_asset_type_code="TANK",
        origin_location_code="LOC01",
        sender_location_code="LOC01",
        operation_date=date(2026, 10, 15),
        product_name="Crude Oil",
        created_by="admin",
        status="Draft",
    )
    db.add(tx)
    db.flush()
    payload_obj = {
        "inputs": {
            "dipCm": 220,
            "waterLevelCm": 240,
            "tankTemperature": 88,
            "tankTemperatureUnit": "C",
            "observedApi": 34.5,
            "bswPercent": 0.4,
            "gaugingDate": "2026-10-15",
            "gaugingTime": "08:00",
        },
        "calculated": {"nsvBbl": 5000, "vcf": 0.99},
    }
    val_row = OperationTransactionValue(
        transaction_id=tx.id,
        field_code="tank_gauging_payload",
        field_name="Tank Gauging",
        field_group="Payload",
        data_type="JSON",
        field_value=json.dumps(payload_obj),
        sort_order=1,
    )
    db.add(val_row)
    db.commit()

    # 1. Live preview catches water > dip and °C/°F swap
    prev = client.post(
        "/entry-checks/preview",
        headers=headers,
        json={
            "layout": "tank_gauging",
            "location_code": "LOC01",
            "asset_code": "TK-101",
            "payload": payload_obj,
        },
    )
    assert prev.status_code == 200, prev.text
    body = prev.json()
    assert body["open_warnings"] >= 2
    codes = {c["code"] for c in body["checks"]}
    assert "water-exceeds-dip" in codes
    assert "temp-unit-swap" in codes

    # 2. Bulk preview screens multiple rows cleanly
    bulk = client.post(
        "/entry-checks/bulk-preview",
        headers=headers,
        json={
            "layout": "tank_gauging",
            "rows": [
                {"row_number": 2, "location_code": "LOC01", "asset_code": "TK-101", "payload": payload_obj},
            ],
        },
    )
    assert bulk.status_code == 200, bulk.text
    assert bulk.json()["rows_with_warnings"] == 1

    # 3. Saved transaction checks + Keep as entered + AuditLog
    saved = client.get(f"/entry-checks/transactions/{tx.id}", headers=headers)
    assert saved.status_code == 200, saved.text
    temp_finding = next(c for c in saved.json()["checks"] if c["code"] == "temp-unit-swap")

    keep = client.post(
        "/entry-checks/reviews",
        headers=headers,
        json={
            "entity_type": "operation_transaction",
            "entity_id": tx.id,
            "check_key": temp_finding["key"],
            "check_code": temp_finding["code"],
            "fingerprint": temp_finding["fingerprint"],
            "subject_label": temp_finding["subject_label"],
            "value_label": temp_finding["current_display"],
            "note": "Heated crude storage tank verified with thermometer",
        },
    )
    assert keep.status_code == 200, keep.text

    # Reload saved checks -> finding is now marked reviewed!
    saved_after = client.get(f"/entry-checks/transactions/{tx.id}", headers=headers).json()
    matched = next(c for c in saved_after["checks"] if c["key"] == temp_finding["key"])
    assert matched["reviewed"] is True
    assert "Heated crude" in matched["review_note"]

    # AuditLog recorded the decision
    audit_row = (
        db.query(AuditLog)
        .filter(AuditLog.module_name == "Entry Quality Checks", AuditLog.action == "Keep Entry Check As Entered")
        .first()
    )
    assert audit_row is not None

    # Fingerprint auto-reopen: mutating the temperature automatically reopens the warning
    payload_obj["inputs"]["tankTemperature"] = 95
    val_row.field_value = json.dumps(payload_obj)
    db.commit()
    saved_changed = client.get(f"/entry-checks/transactions/{tx.id}", headers=headers).json()
    reopened_by_change = next(c for c in saved_changed["checks"] if c["key"] == temp_finding["key"])
    assert reopened_by_change["reviewed"] is False

    # Explicit reopen endpoint also works & writes audit log
    reopen = client.post(
        "/entry-checks/reviews/reopen",
        headers=headers,
        json={
            "entity_type": "operation_transaction",
            "entity_id": tx.id,
            "check_key": temp_finding["key"],
        },
    )
    assert reopen.status_code == 200
    assert reopen.json()["reopened"] is True

    # Open abnormalities summary lists the Draft ticket
    summary = client.get("/entry-checks/open-summary?location_code=LOC01", headers=headers)
    assert summary.status_code == 200
    assert any(item["transaction_id"] == tx.id for item in summary.json()["items"])

    # RBAC: user without View Entry Checks gets 403
    _create_limited_user(db, "no_checks_user", "User@123456")
    limited_headers = _auth_headers(client, "no_checks_user", "User@123456")
    denied = client.post(
        "/entry-checks/preview",
        headers=limited_headers,
        json={"layout": "tank_gauging", "payload": payload_obj},
    )
    assert denied.status_code == 403
