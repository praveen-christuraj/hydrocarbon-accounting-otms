"""
Report visibility follows the party rule (PERMISSION_CRITERIA_MODEL.md).

Section 7 of the model extends the cross-location "party" rule - a
location-scoped user sees a ticket when ANY of origin / destination / sender /
receiver is inside their assigned locations - to the remaining origin-only
report surfaces (Out-Turn summary, Tank Operation Summary, Flowmeter records,
Out-Turn Report query).

Before this pass those reports filtered on ``origin_location_code`` alone, so
the receiving terminal of a movement (whose tickets carry the sending
terminal's origin when created without a link) saw none of its own rows.
"""

from datetime import date

from app.models import (
    Asset,
    AssetType,
    Location,
    OperationTemplate,
    OperationTransaction,
    OperationTransactionValue,
    UserLocation,
)
from tests.test_barge_voyages_and_fso_variance import _make_user

REPORT_PERMISSIONS = [
    "View Tank Operation Summary",
    "View Out-Turn Summary",
    "View Flowmeter Record",
]


def _seed_report_masters(db):
    db.add_all(
        [
            Location(location_code="AGGE", location_name="Agge", location_type="Terminal", status="Active"),
            Location(location_code="LEKKI", location_name="Lekki", location_type="Terminal", status="Active"),
            Location(location_code="PHC", location_name="Port Harcourt", location_type="Terminal", status="Active"),
            AssetType(asset_type_code="TANK", asset_type_name="Tank", status="Active"),
        ]
    )
    db.flush()
    db.add(
        Asset(
            asset_code="AGGE-TK-1",
            asset_name="Agge Tank 1",
            asset_type_code="TANK",
            asset_scope="Local",
            location_code="AGGE",
            status="Active",
        )
    )
    template = OperationTemplate(
        template_name="Tank Gauging",
        operation_type_code="TANK_GAUGING",
        entry_layout_type="Tank Gauging",
        calculation_engine="Tank Quantity",
        status="Active",
    )
    db.add(template)
    db.flush()

    # A movement ticket created at AGGE and addressed to LEKKI: the receiving
    # terminal is a party to it although the origin is another terminal.
    tx = OperationTransaction(
        operation_number="TOS-1",
        operation_type_code="TANK_GAUGING",
        operation_template_id=template.id,
        primary_asset_code="AGGE-TK-1",
        primary_asset_type_code="TANK",
        origin_location_code="AGGE",
        destination_location_code="LEKKI",
        sender_location_code="AGGE",
        receiver_location_code="LEKKI",
        operation_date=date(2026, 10, 12),
        status="Approved",
        created_by="tester",
    )
    db.add(tx)
    db.flush()
    # Both summary reports only render transactions that carry the gauging
    # payload snapshot.
    db.add(
        OperationTransactionValue(
            transaction_id=tx.id,
            field_code="tank_gauging_payload",
            field_name="Tank Gauging Payload",
            data_type="JSON",
            field_value={
                "inputs": {"totalDip": 1000.0, "waterDip": 0.0},
                "calculated": {"nsvBbl": 950.0, "gsvBbl": 960.0, "lt": 12.0, "mt": 11.9},
            },
        )
    )
    db.commit()
    return tx


def _scoped_user(db, client, username, location_code):
    headers, user = _make_user(
        db, client, username, REPORT_PERMISSIONS, all_locations=False
    )
    db.add(UserLocation(user_id=user.id, location_code=location_code))
    db.commit()
    return headers


def test_tank_operation_summary_visible_to_destination_side_user(client, db):
    _seed_report_masters(db)
    receiver_headers = _scoped_user(db, client, "tos_receiver", "LEKKI")

    response = client.get("/tank-operation-summary", headers=receiver_headers)
    assert response.status_code == 200, response.text
    rows = response.json()["rows"]
    assert [row["operation_number"] for row in rows] == ["TOS-1"]
    # The row still reports its own origin location.
    assert rows[0]["location_code"] == "AGGE"


def test_tank_operation_summary_visible_to_sender_side_user(client, db):
    _seed_report_masters(db)
    sender_headers = _scoped_user(db, client, "tos_sender", "AGGE")

    rows = client.get("/tank-operation-summary", headers=sender_headers).json()["rows"]
    assert [row["operation_number"] for row in rows] == ["TOS-1"]


def test_tank_operation_summary_hidden_from_third_party(client, db):
    _seed_report_masters(db)
    stranger_headers = _scoped_user(db, client, "tos_stranger", "PHC")

    rows = client.get("/tank-operation-summary", headers=stranger_headers).json()["rows"]
    assert rows == []


def test_out_turn_summary_visible_to_destination_side_user(client, db):
    _seed_report_masters(db)
    receiver_headers = _scoped_user(db, client, "ots_receiver", "LEKKI")

    response = client.get("/out-turn-summary", headers=receiver_headers)
    assert response.status_code == 200, response.text
    rows = response.json()["rows"]
    assert [row["operation_number"] for row in rows] == ["TOS-1"]


def test_out_turn_summary_hidden_from_third_party(client, db):
    _seed_report_masters(db)
    stranger_headers = _scoped_user(db, client, "ots_stranger", "PHC")

    rows = client.get("/out-turn-summary", headers=stranger_headers).json()["rows"]
    assert rows == []


def _seed_flowmeter_records(db):
    """Approved meter-reading tickets: AGGE->LEKKI, LEKKI->LEKKI and PHC->PHC."""
    template = OperationTemplate(
        template_name="Meter Reading",
        operation_type_code="METER_READING",
        entry_layout_type="Meter Reading",
        calculation_engine="Flowmeter",
        status="Active",
    )
    db.add(template)
    db.flush()

    ids = {}
    for key, origin, destination in (
        ("movement", "AGGE", "LEKKI"),
        ("local", "LEKKI", "LEKKI"),
        ("third_party", "PHC", "PHC"),
    ):
        tx = OperationTransaction(
            operation_number=f"FMR-{key}",
            operation_type_code="METER_READING",
            operation_template_id=template.id,
            primary_asset_code="AGGE-TK-1",
            primary_asset_type_code="TANK",
            origin_location_code=origin,
            destination_location_code=destination,
            sender_location_code=origin,
            receiver_location_code=destination,
            operation_date=date(2026, 10, 12),
            status="Approved",
            created_by="tester",
        )
        db.add(tx)
        db.flush()
        db.add(
            OperationTransactionValue(
                transaction_id=tx.id,
                field_code="flowmeter_payload",
                field_name="Flowmeter Payload",
                data_type="JSON",
                field_value={
                    "inputs": {
                        "stream_name": "Crude",
                        "meters": [{"opening_reading": 100.0, "closing_reading": 150.0}],
                    },
                    "calculated": {"nsv_bbl": 49.5, "gsv_bbl": 50.0},
                },
            )
        )
        ids[key] = tx.id
    db.commit()
    return ids


def test_flowmeter_records_visible_to_destination_side_user(client, db):
    _seed_report_masters(db)
    ids = _seed_flowmeter_records(db)
    receiver_headers = _scoped_user(db, client, "fmr_receiver", "LEKKI")

    response = client.get("/flowmeter/records", headers=receiver_headers)
    assert response.status_code == 200, response.text
    rows = response.json()
    assert {row["id"] for row in rows} == {ids["movement"], ids["local"]}
    # The cross-location row still reports its own origin location.
    movement_row = next(row for row in rows if row["id"] == ids["movement"])
    assert movement_row["location_code"] == "AGGE"


def test_flowmeter_records_keep_own_rows_and_drop_foreign_rows(client, db):
    _seed_report_masters(db)
    ids = _seed_flowmeter_records(db)
    stranger_headers = _scoped_user(db, client, "fmr_third", "PHC")

    rows = client.get("/flowmeter/records", headers=stranger_headers).json()
    assert {row["id"] for row in rows} == {ids["third_party"]}


def test_flowmeter_records_explicit_location_is_scope_checked(client, db):
    _seed_report_masters(db)
    ids = _seed_flowmeter_records(db)
    receiver_headers = _scoped_user(db, client, "fmr_explicit", "LEKKI")

    own = client.get("/flowmeter/records?location_code=LEKKI", headers=receiver_headers)
    assert own.status_code == 200, own.text
    assert {row["id"] for row in own.json()} == {ids["local"]}

    foreign = client.get("/flowmeter/records?location_code=AGGE", headers=receiver_headers)
    assert foreign.status_code == 403, foreign.text
