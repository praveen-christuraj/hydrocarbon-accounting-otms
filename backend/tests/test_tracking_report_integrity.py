"""Database-backed regressions for snapshot continuity and voyage reports."""
from copy import deepcopy
from datetime import date
from io import BytesIO

import openpyxl
from app.models import OperationTransactionValue
from app.routers.out_turn_summary import get_out_turn_summary_rows
from app.routers.reports import get_out_turn_report_rows_from_transactions
from app.routers.tanker_tracking import build_tanker_quantity_comparison, build_tanker_tracking_ticket
from app.services.tracking_helpers import build_multitank_comparison_json_v2
from tests.test_barge_voyages_and_fso_variance import (
    _add_transaction, _make_user, _seed_fso_receipt,
)
from tests.test_out_turn_layout_matching import _seed_tank_gauging_transaction


def _value(db, tx, code, payload):
    db.add(OperationTransactionValue(
        transaction_id=tx.id, field_code=code, field_name=code,
        data_type="JSON", input_mode="System", field_value=payload,
    ))
    db.flush()


def test_out_turn_history_ignores_product_and_lower_date_filter(db):
    _seed_tank_gauging_transaction(db, "Tank Gauging")
    from app.models import OperationTransaction
    first = db.query(OperationTransaction).filter_by(operation_number="OP-0001").one()
    first.operation_date = date(2026, 8, 10)
    first.product_name = "Old grade"
    second = _add_transaction(db, number="SNAP-2", asset_code=first.primary_asset_code,
                              asset_type="TANK", op_date=date(2026, 8, 11))
    second.operation_template_id = first.operation_template_id
    second.product_name = "New grade"
    _value(db, second, "tank_gauging_payload", {"calculated": {
        "nsvBbl": 900, "gsvBbl": 920, "lt": 120, "mt": 122,
    }})
    # Same-day ordering must use transaction ID, not the selected product.
    third = _add_transaction(db, number="SNAP-3", asset_code=first.primary_asset_code,
                             asset_type="TANK", op_date=date(2026, 8, 11))
    third.operation_template_id = first.operation_template_id
    third.product_name = "Old grade"
    _value(db, third, "tank_gauging_payload", {"calculated": {
        "nsvBbl": 950, "gsvBbl": 970, "lt": 125, "mt": 127,
    }})
    db.commit()
    rows = get_out_turn_summary_rows(db, product_name="New grade", date_from="2026-08-11")
    assert len(rows) == 1
    assert rows[0]["previous_nsv"] == 990
    assert rows[0]["net_dispatch_nsv"] == 90
    assert rows[0]["net_dispatch_gsv"] == 80
    assert rows[0]["net_dispatch_lt"] == 10
    assert rows[0]["net_dispatch_mt"] == 10
    rows = get_out_turn_summary_rows(db, product_name="Old grade", date_from="2026-08-11")
    assert rows[0]["previous_nsv"] == 900
    assert rows[0]["net_receipt_nsv"] == 50

    report_rows = get_out_turn_report_rows_from_transactions(
        db, product_name="Old grade", date_from="2026-08-11"
    )
    assert len(report_rows) == 1
    assert report_rows[0]["previous_nsv"] == 900
    assert report_rows[0]["signed_net_nsv"] == 50


def _seed_shuttle(db):
    stages = [
        ("LOADING", 100, 0, "IN", "2026-10-01"),
        ("TOP_UP", 20, 0, "IN", "2026-10-02"),
        ("STS_IN", 10, 0, "IN", "2026-10-03"),
        ("STS_OUT", -5, 0, "OUT", "2026-10-04"),
        ("UNLOADING", -125, 0, "OUT", "2026-10-05"),
    ]
    for index, (code, stock, water, sign, day) in enumerate(stages):
        tx = _add_transaction(db, number=f"SH-{index}", convoy="SH-V1", asset_code="SHUTTLE_A",
                              asset_type="SHUTTLE", op_date=date.fromisoformat(day))
        _value(db, tx, "shuttle_payload", {
            "meta": {"schema": "shuttle_payload_v2", "vessel_operation_code": code,
                     "vessel_operation_label": code, "vessel_operation_sign": sign},
            "inputs": {"event_time": "08:00", "closing_stock_bbl": 0},
            "calculated": {"net": {"net_stock_bbl": stock, "net_water_bbl": water,
                                    "TOV": stock, "FW": water, "NSV": stock}},
        })
    draft = _add_transaction(db, number="SH-DRAFT", convoy="SH-V1", asset_code="SHUTTLE_A",
                             asset_type="SHUTTLE", status="Draft")
    _value(db, draft, "shuttle_payload", {"meta": {"vessel_operation_code": "LOADING"},
                                           "calculated": {"net": {"net_stock_bbl": 999}}})
    db.commit()


def test_shuttle_summary_detail_export_and_closed_voyage_agree(client, db):
    headers, _ = _make_user(db, client, "shuttle_integrity", ["View Shuttle Tracking", "Close Shuttle Voyage"])
    _seed_shuttle(db)
    key = "AGGE|SH-V1|SHUTTLE_A"
    # Filters identify a voyage, not a partial subset of its accounting tickets.
    params = {"date_from": "2026-10-05", "search": "SH-4"}
    summary = client.get("/shuttle-fso/shuttle-tracking", params=params, headers=headers)
    assert summary.status_code == 200, summary.text
    summary = summary.json()["rows"][0]
    detail = client.get("/shuttle-fso/shuttle-tracking", params={**params, "include_tickets": True}, headers=headers).json()["rows"][0]
    for row in (summary, detail):
        assert row["net_receipt_bbl"] == 130
        assert row["net_discharge_bbl"] == 125
        assert row["transfer_in_bbl"] == 10
        assert row["transfer_out_bbl"] == 5
        assert row["total_nsv_bbl"] == 0  # OUT must not be inverted a second time
    assert summary["tickets"] == []
    assert len(detail["tickets"]) == 5
    assert detail["tickets"][-1]["nsv_bbl"] == -125
    exported = client.get("/shuttle-fso/shuttle-tracking/export/xlsx", params={"group_key": key}, headers=headers)
    assert exported.status_code == 200, exported.text
    ws = openpyxl.load_workbook(BytesIO(exported.content)).active
    assert list(ws.values)[6][1:4] == (5, 130, 125)
    assert list(ws.values)[6][-2:] == (10, 5)
    closed = client.post("/shuttle-fso/shuttle-voyages/close", headers=headers, json={
        "location_code": "AGGE", "shuttle_number": "SH-V1", "shuttle_asset_code": "SHUTTLE_A",
        "closure_remarks": "Reconciled",
    })
    assert closed.status_code == 200, closed.text
    after = client.get("/shuttle-fso/shuttle-tracking", params={"group_key": key}, headers=headers)
    assert after.status_code == 200, after.text
    after = after.json()["rows"][0]
    assert len(after["tickets"]) == 5
    assert after["net_discharge_bbl"] == 125
    assert after["closure_remarks"] == "Reconciled"


def test_fso_search_and_input_mapping(client, db):
    headers, _ = _make_user(db, client, "fso_integrity", ["View FSO Tracking"])
    _seed_fso_receipt(db)
    value = db.query(OperationTransactionValue).filter_by(field_code="fso_payload").one()
    payload = deepcopy(value.field_value)
    payload["inputs"].update({"event_time": "09:30", "vessel_name": "Vessel One",
                              "remarks": "Measured receipt", "opening_stock_bbl": 50,
                              "closing_stock_bbl": 850})
    value.field_value = payload
    db.commit()
    response = client.get("/shuttle-fso/fso-tracking", params={"search": "FSO", "include_tickets": True}, headers=headers)
    assert response.status_code == 200, response.text
    ticket = response.json()["rows"][0]["tickets"][0]
    assert ticket["event_time"] == "09:30"
    assert ticket["vessel_name"] == "Vessel One"
    assert ticket["opening_stock_bbl"] == 50
    assert ticket["closing_stock_bbl"] == 850
    assert ticket["remarks"] == "Measured receipt"


def test_tanker_mapping_and_missing_payload_does_not_create_false_comparison(db):
    tx = _add_transaction(db, number="TNK-MAP", asset_type="TANKER", asset_code="TANKER_1")
    payload = {"inputs": {"totalDipCm": 123.4, "waterDipCm": 2, "sealC1": "SEAL-1"},
               "calculated": {"tovBbl": 105, "freeWaterBbl": 5, "govBbl": 100,
                              "gsvBbl": 99, "nsvBbl": 98, "lt": 12, "mt": 13}}
    sender = build_tanker_tracking_ticket(tx, payload, db)
    assert sender["total_dip_cm"] == 123.4
    assert sender["seal_c1"] == "SEAL-1"
    assert sender["nsv_bbl"] == 98
    receiver = {**sender, "transaction_id": tx.id + 1, "nsv_bbl": 97}
    assert build_tanker_quantity_comparison(sender, receiver)["nsv_variance_bbl"] == -1
    assert build_tanker_quantity_comparison(sender, {**receiver, "payload_missing": True}) is None


def test_barge_maps_every_tank_and_database_totals(db):
    left = _add_transaction(db, number="BRG-S", convoy="C1")
    right = _add_transaction(db, number="BRG-R", convoy="C1")
    tanks = {str(i): {"totalDip": i * 10, "waterDip": i, "tovCorrected": i * 100,
                       "fwCorrected": i * 2} for i in range(1, 13)}
    totals = {"TOV": 1000, "FW": 10, "GOV": 990, "GSV": 980, "NSV": 970, "LT": 120, "MT": 122}
    summary, per_tank = build_multitank_comparison_json_v2(left, right, "LOAD_AFTER_vs_UNLOAD_BEFORE",
        {"perTank": {"after": tanks}, "calculated": {"after": totals}},
        {"perTank": {"before": tanks}, "calculated": {"before": {**totals, "NSV": 960}}})
    assert len(per_tank["tanks"]) == 12
    assert summary["left"]["totals"] == totals
    assert summary["delta"]["totals"]["NSV"] == 10
    assert next(t for t in per_tank["tanks"] if t["tank_id"] == "12")["left"]["total_dip"] == 120


def test_barge_comparison_does_not_treat_missing_gsv_as_zero(db):
    left = _add_transaction(db, number="BRG-GSV-MISSING-S", convoy="C-GSV")
    right = _add_transaction(db, number="BRG-GSV-MISSING-R", convoy="C-GSV")
    summary, _ = build_multitank_comparison_json_v2(
        left,
        right,
        "LOAD_AFTER_vs_UNLOAD_BEFORE",
        {"calculated": {"after": {"TOV": 10, "FW": 1, "NSV": 8}}},
        {"calculated": {"before": {"TOV": 12, "FW": 2, "GSV": 9, "NSV": 7}}},
    )

    assert summary["delta"]["totals"]["GSV"] is None
    assert summary["delta"]["totals"]["NSV"] == 1
    assert summary["delta"]["totals"]["TOV"] == -2


def test_barge_comparison_rejects_cross_asset_and_client_totals(client, db):
    headers, _ = _make_user(db, client, "barge_integrity", ["Edit Barge Tracking"])
    left = _add_transaction(db, number="BRG-C1", convoy="C2", asset_code="BARGE_A")
    right = _add_transaction(db, number="BRG-C2", convoy="C2", asset_code="BARGE_B")
    _value(db, left, "multi_tank_payload", {"calculated": {"after": {"NSV": 100}}})
    _value(db, right, "multi_tank_payload", {"calculated": {"before": {"NSV": 90}}})
    db.commit()
    request = {"convoy_number": "C2", "comparison_type": "LOAD_AFTER_vs_UNLOAD_BEFORE",
               "left_transaction_id": left.id, "right_transaction_id": right.id,
               "summary_json": {"fabricated": True}, "per_tank_json": {"fabricated": True}}
    response = client.post("/barge-trip/trip-comparisons", headers=headers, json=request)
    assert response.status_code == 400, response.text
    right.primary_asset_code = "BARGE_A"
    db.commit()
    response = client.post("/barge-trip/trip-comparisons", headers=headers, json=request)
    assert response.status_code == 200, response.text
    assert response.json()["summary_json"]["delta"]["totals"]["NSV"] == 10
    assert "fabricated" not in response.json()["summary_json"]
    from app.models import Trip, TripComparison
    trip = db.query(Trip).filter_by(convoy_number="C2").one()
    comparison = db.query(TripComparison).filter_by(id=response.json()["id"]).one()
    trip.status = "CLOSED"
    comparison.summary_json = {"left": {"totals": {"NSV": 9999}}}
    comparison.per_tank_json = {"tanks": []}
    db.commit()
    # Read the report after closure using View permission, without rewriting
    # the stored comparison or reopening the voyage.
    view_headers, _ = _make_user(db, client, "barge_closed_report", ["View Barge Tracking"])
    report = client.get("/barge-trip/trips/by-convoy/C2", headers=view_headers)
    assert report.status_code == 200, report.text
    assert report.json()["trip"]["status"] == "CLOSED"
    assert report.json()["comparisons"][0]["summary_json"]["left"]["totals"]["NSV"] == 100
    db.refresh(comparison)
    assert comparison.summary_json["left"]["totals"]["NSV"] == 9999


def test_barge_seals_map_current_layout_and_prefer_explicit_before():
    from app.services.tracking_helpers import build_multitank_seal_checks, build_multitank_permanent_seal_checks
    observed = {"temporary": {"sealC1": "S1"},
                "tankSeals": {"T1": {"MH1": {"master": "M1", "observed": "M1"}}}}
    sender = {"seals": {"after": observed}}
    receiver = {"seals": {"after": deepcopy(observed)}}
    checks, _ = build_multitank_seal_checks(sender, receiver)
    assert checks[0]["status"] == "MATCH"
    permanent, _ = build_multitank_permanent_seal_checks(sender, receiver)
    assert permanent[0]["status"] == "MATCH"
    receiver["seals"]["before"] = {"temporary": {"sealC1": "CHANGED"}}
    assert build_multitank_seal_checks(sender, receiver)[0][0]["status"] == "MISMATCH"


def test_fso_repeated_source_discharge_is_not_double_counted(client, db):
    headers, _ = _make_user(db, client, "fso_split_receipt", ["View FSO Tracking"])
    _seed_fso_receipt(db)
    value = db.query(OperationTransactionValue).filter_by(field_code="fso_payload").one()
    second = _add_transaction(db, number="FSO-RCPT-2", convoy="SH-100", asset_code="FSO_MV_1",
                              asset_type="FSO", op_date=date(2026, 10, 3))
    payload = deepcopy(value.field_value)
    payload["calculated"]["net"]["net_stock_bbl"] = 200
    _value(db, second, "fso_payload", payload)
    db.commit()
    for include in (False, True):
        response = client.get("/shuttle-fso/fso-tracking", params={"include_tickets": include}, headers=headers)
        assert response.status_code == 200, response.text
        row = response.json()["rows"][0]
        assert row["shuttle_discharge_bbl"] == 1000
        assert row["fso_receipt_bbl"] == 1000
        assert row["variance_bbl"] == 0


def test_fso_reports_include_next_calendar_morning_in_accounting_day(db):
    from datetime import time
    from app.models import LocationAccountingDaySetting
    from app.routers.reports import build_fso_otr_report, build_fso_material_balance, build_fso_outturn_report
    db.add(LocationAccountingDaySetting(
        location_code="AGGE", day_start_time=time(6), day_end_time=time(5, 59),
        effective_from=date(2026, 1, 1), status="Active",
    ))
    for index, (day, event_time, qty) in enumerate([
        (date(2026, 10, 3), "05:00", 10),  # prior accounting day
        (date(2026, 10, 3), "08:00", 100),
        (date(2026, 10, 4), "05:00", 200), # same accounting day
        (date(2026, 10, 4), "08:00", 20),  # following accounting day
    ]):
        tx = _add_transaction(db, number=f"FSO-DAY-{index}", convoy="DAY-1",
                              asset_code="FSO_1", asset_type="FSO", op_date=day)
        _value(db, tx, "fso_payload", {
            "meta": {"operation_label": "Receipt", "operation_sign": "IN"},
            "inputs": {"event_time": event_time, "vessel_quantity_bbl": qty,
                       "opening_stock_bbl": 0, "closing_stock_bbl": qty},
            "calculated": {"net": {"net_stock_bbl": qty, "net_water_bbl": 0}},
        })
    db.commit()
    args = (db, "AGGE", "FSO_1", date(2026, 10, 3), date(2026, 10, 3))
    rows, totals = build_fso_otr_report(*args)
    assert len(rows) == 2
    assert totals["receipt"] == 300
    assert build_fso_material_balance(*args)[0]["receipt_bbl"] == 300
    assert build_fso_outturn_report(*args)[1]["receipt"] == 300
