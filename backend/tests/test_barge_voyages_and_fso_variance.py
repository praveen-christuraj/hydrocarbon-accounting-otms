"""
Regression tests for:
  * Barge Tracking voyage list (Open / Closed tabs) – GET /barge-trip/voyages
  * FSO variance sign convention – shuttle discharge minus FSO movement
"""

from datetime import date

from app.models import (
    Location,
    OperationTransaction,
    OperationTransactionValue,
    Permission,
    Role,
    RolePermission,
    Trip,
    User,
    UserLocation,
    UserRole,
)
from tests.conftest import create_user

PASSWORD = "StrongPass123!"


def _make_user(db, client, username, permissions, all_locations=True):
    role = Role(role_name=f"{username}_role", status="Active")
    db.add(role)
    db.flush()

    for permission_name in permissions:
        permission = (
            db.query(Permission)
            .filter(Permission.permission_name == permission_name)
            .first()
        )
        if permission is None:
            permission = Permission(
                permission_name=permission_name,
                module_name="Test",
                status="Active",
            )
            db.add(permission)
            db.flush()
        db.add(RolePermission(role_id=role.id, permission_id=permission.id))

    user = create_user(db, username, PASSWORD, roles=[role])
    user.all_locations_access = "Yes" if all_locations else "No"
    db.commit()

    login = client.post("/auth/login", json={"username": username, "password": PASSWORD})
    assert login.status_code == 200, login.text
    return {"Authorization": f"Bearer {login.json()['access_token']}"}, user


def _add_transaction(
    db,
    *,
    number,
    convoy=None,
    asset_code="BARGE_01",
    asset_type="BARGE",
    origin="AGGE",
    status="Approved",
    op_date=date(2026, 10, 1),
    fso_payload=None,
):
    tx = OperationTransaction(
        operation_number=number,
        operation_type_code="BARGE_LOAD",
        primary_asset_code=asset_code,
        primary_asset_type_code=asset_type,
        convoy_number=convoy,
        origin_location_code=origin,
        destination_location_code="LEKKI",
        operation_date=op_date,
        status=status,
        created_by="tester",
    )
    db.add(tx)
    db.flush()
    if fso_payload is not None:
        db.add(
            OperationTransactionValue(
                transaction_id=tx.id,
                field_code="fso_payload",
                field_name="FSO Payload",
                data_type="json",
                field_value=fso_payload,
            )
        )
    db.flush()
    return tx


# ---------------------------------------------------------------------------
# Barge Tracking – voyage list
# ---------------------------------------------------------------------------


def _seed_barge_voyages(db):
    db.add_all(
        [
            Location(location_code="AGGE", location_name="Agge", location_type="Terminal", status="Active"),
            Location(location_code="LEKKI", location_name="Lekki", location_type="Terminal", status="Active"),
        ]
    )
    db.flush()

    # CNV-OPEN-1: approved barge ticket, no trip row yet -> OPEN
    _add_transaction(db, number="BRG-1", convoy="CNV-OPEN-1", asset_code="BARGE_A", op_date=date(2026, 10, 2))

    # CNV-OPEN-2: approved barge ticket and an OPEN trip row
    _add_transaction(db, number="BRG-2", convoy="CNV-OPEN-2", asset_code="BARGE_B", op_date=date(2026, 10, 5))
    db.add(Trip(convoy_number="CNV-OPEN-2", status="OPEN"))

    # CNV-CLOSED-1: two barges, two approved tickets, trip CLOSED
    _add_transaction(db, number="BRG-3", convoy="CNV-CLOSED-1", asset_code="BARGE_A", op_date=date(2026, 9, 20))
    _add_transaction(db, number="BRG-4", convoy="CNV-CLOSED-1", asset_code="BARGE_C", op_date=date(2026, 9, 21))
    db.add(Trip(convoy_number="CNV-CLOSED-1", status="CLOSED", remarks="settled"))

    # Excluded: draft barge ticket, approved tanker ticket with a convoy number
    _add_transaction(db, number="BRG-DRAFT", convoy="CNV-DRAFT", status="Draft")
    _add_transaction(
        db,
        number="TNK-1",
        convoy="CNV-TANKER",
        asset_code="TANKER_1",
        asset_type="TANKER",
    )
    db.commit()


def test_barge_voyages_split_into_open_and_closed_tabs(client, db):
    headers, _ = _make_user(db, client, "barge_viewer", ["View Barge Tracking"])
    _seed_barge_voyages(db)

    open_resp = client.get("/barge-trip/voyages?tab=OPEN", headers=headers)
    assert open_resp.status_code == 200, open_resp.text
    open_data = open_resp.json()

    assert open_data["tab"] == "OPEN"
    assert open_data["open_count"] == 2
    assert open_data["closed_count"] == 1
    assert [row["convoy_number"] for row in open_data["rows"]] == ["CNV-OPEN-2", "CNV-OPEN-1"]
    assert all(row["status"] == "OPEN" for row in open_data["rows"])
    # Draft barge tickets and tanker tickets never appear as voyages.
    convoys = {row["convoy_number"] for row in open_data["rows"]}
    assert "CNV-DRAFT" not in convoys
    assert "CNV-TANKER" not in convoys

    closed_resp = client.get("/barge-trip/voyages?tab=CLOSED", headers=headers)
    assert closed_resp.status_code == 200, closed_resp.text
    closed_data = closed_resp.json()

    assert closed_data["tab"] == "CLOSED"
    assert closed_data["open_count"] == 2
    assert closed_data["closed_count"] == 1
    assert len(closed_data["rows"]) == 1

    closed_row = closed_data["rows"][0]
    assert closed_row["convoy_number"] == "CNV-CLOSED-1"
    assert closed_row["status"] == "CLOSED"
    assert closed_row["barge_count"] == 2
    assert closed_row["ticket_count"] == 2
    assert closed_row["trip_remarks"] == "settled"
    assert closed_row["first_operation_date"] == "2026-09-20"
    assert closed_row["last_operation_date"] == "2026-09-21"


def test_barge_voyage_rows_carry_barges_and_locations(client, db):
    headers, _ = _make_user(db, client, "barge_detail", ["View Barge Tracking"])
    _seed_barge_voyages(db)

    rows = client.get("/barge-trip/voyages?tab=OPEN", headers=headers).json()["rows"]
    open_two = next(row for row in rows if row["convoy_number"] == "CNV-OPEN-2")

    assert open_two["trip_id"] is not None
    assert open_two["barge_asset_codes"] == ["BARGE_B"]
    assert open_two["origin_location_codes"] == ["AGGE"]
    assert open_two["destination_location_codes"] == ["LEKKI"]

    open_one = next(row for row in rows if row["convoy_number"] == "CNV-OPEN-1")
    assert open_one["trip_id"] is None  # no trip row yet, still OPEN


def test_barge_voyages_default_tab_is_open_and_bad_tab_is_rejected(client, db):
    headers, _ = _make_user(db, client, "barge_default", ["View Barge Tracking"])
    _seed_barge_voyages(db)

    default_data = client.get("/barge-trip/voyages", headers=headers).json()
    assert default_data["tab"] == "OPEN"

    bad = client.get("/barge-trip/voyages?tab=ARCHIVED", headers=headers)
    assert bad.status_code == 400


def test_barge_voyages_requires_view_barge_tracking(client, db):
    headers, _ = _make_user(db, client, "no_barge_perm", ["View Tanker Tracking"])
    _seed_barge_voyages(db)

    resp = client.get("/barge-trip/voyages?tab=OPEN", headers=headers)
    assert resp.status_code == 403


def test_barge_voyages_respects_location_scope(client, db):
    headers, user = _make_user(
        db, client, "barge_scoped", ["View Barge Tracking"], all_locations=False
    )
    _seed_barge_voyages(db)
    db.add(UserLocation(user_id=user.id, location_code="AGGE"))
    # Voyage that starts at a location the user is not assigned to.
    _add_transaction(db, number="BRG-OUT", convoy="CNV-OUT-OF-SCOPE", origin="KLNG", asset_code="BARGE_D")
    db.commit()

    data = client.get("/barge-trip/voyages?tab=OPEN", headers=headers).json()
    convoys = {row["convoy_number"] for row in data["rows"]}
    assert "CNV-OUT-OF-SCOPE" not in convoys
    assert "CNV-OPEN-1" in convoys


def test_barge_voyages_listing_is_read_only(client, db):
    headers, _ = _make_user(db, client, "barge_readonly", ["View Barge Tracking"])
    _seed_barge_voyages(db)

    trips_before = db.query(Trip).count()
    client.get("/barge-trip/voyages?tab=OPEN", headers=headers)
    client.get("/barge-trip/voyages?tab=CLOSED", headers=headers)
    trips_after = db.query(Trip).count()

    # The list must never create trip rows for convoys that lack one.
    assert trips_before == trips_after
    assert db.query(Trip).filter(Trip.convoy_number == "CNV-OPEN-1").first() is None


# ---------------------------------------------------------------------------
# FSO variance – discharge minus FSO movement
# ---------------------------------------------------------------------------

FSO_LOCATION = "AGGE"
FSO_ASSET = "FSO_MV_1"
FSO_SHUTTLE = "SH-100"


def _fso_receipt_payload(stored_variance=None):
    net = {
        "net_stock_bbl": 800.0,
        "net_water_bbl": 0.0,
    }
    if stored_variance is not None:
        # Value written under the previous (reversed) sign convention.
        net["variance_bbl"] = stored_variance
    return {
        "meta": {
            "schema": "fso_payload_v2",
            "operation_label": "Receipt",
            "operation_sign": "IN",
            "shuttle_number": FSO_SHUTTLE,
            "source_shuttle_discharge_bbl": 1000.0,
        },
        "inputs": {
            "shuttle_number": FSO_SHUTTLE,
            "vessel_quantity_bbl": 1000.0,
            "opening_stock_bbl": 0.0,
            "closing_stock_bbl": 800.0,
            "opening_water_bbl": 0.0,
            "closing_water_bbl": 0.0,
        },
        "calculated": {"net": net},
    }


def _seed_fso_receipt(db, stored_variance=None):
    db.add(Location(location_code=FSO_LOCATION, location_name="Agge", location_type="Terminal", status="Active"))
    db.flush()
    _add_transaction(
        db,
        number="FSO-RCPT-1",
        convoy=FSO_SHUTTLE,
        asset_code=FSO_ASSET,
        asset_type="FSO",
        origin=FSO_LOCATION,
        op_date=date(2026, 10, 3),
        fso_payload=_fso_receipt_payload(stored_variance),
    )
    db.commit()


def test_fso_otr_variance_is_discharge_minus_receipt(client, db):
    headers, _ = _make_user(db, client, "fso_otr", ["View FSO Tracking"])
    _seed_fso_receipt(db)

    resp = client.get(
        "/reports/fso/otr",
        params={
            "location_code": FSO_LOCATION,
            "fso_asset_code": FSO_ASSET,
            "date_from": "2026-10-01",
            "date_to": "2026-10-31",
        },
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()

    row = data["rows"][0]
    # Shuttle discharged 1000 bbl, FSO received 800 bbl -> +200 (positive = loss).
    assert row["variance_bbl"] == 200.0
    assert data["total_variance_bbl"] == 200.0
    # Compare variance = shuttle discharge - FSO movement.
    assert row["compare_variance_bbl"] == 200.0


def test_fso_outturn_variance_is_discharge_minus_receipt(client, db):
    headers, _ = _make_user(db, client, "fso_outturn", ["View FSO Tracking"])
    _seed_fso_receipt(db)

    resp = client.get(
        "/reports/fso/outturn",
        params={
            "location_code": FSO_LOCATION,
            "fso_asset_code": FSO_ASSET,
            "date_from": "2026-10-01",
            "date_to": "2026-10-31",
        },
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()

    assert data["total_shuttle_discharge_bbl"] == 1000.0
    assert data["total_fso_receipt_bbl"] == 800.0
    assert data["total_variance_bbl"] == 200.0
    assert data["total_variance_pct"] == 20.0


def test_fso_tracking_variance_ignores_stale_stored_sign(client, db):
    headers, _ = _make_user(db, client, "fso_tracking", ["View FSO Tracking"])
    # Ticket saved before the fix carries the old, reversed value (-200).
    _seed_fso_receipt(db, stored_variance=-200.0)

    resp = client.get(
        "/shuttle-fso/fso-tracking",
        params={"tab": "OPEN", "include_tickets": "true"},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    rows = resp.json()["rows"]
    assert len(rows) == 1

    group = rows[0]
    assert group["shuttle_discharge_bbl"] == 1000.0
    assert group["fso_receipt_bbl"] == 800.0
    assert group["variance_bbl"] == 200.0
    assert group["total_variance_bbl"] == 200.0

    tickets = group["tickets"]
    assert len(tickets) == 1
    assert tickets[0]["variance_bbl"] == 200.0
    assert tickets[0]["vessel_quantity_bbl"] == 1000.0
