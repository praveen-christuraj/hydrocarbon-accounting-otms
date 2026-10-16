"""
Party-based location scope for cross-location tickets (owner fix, 2026-16-10):

"Location B may not have access to location A but he should see the ticket
assigned to his location. This should be applied for all the tracking modules."

Scenario: location A (AGGE) creates and approves a tanker ticket with receiver
location B (UTP) in the receiver dropdown. A user scoped only to UTP must see
that ticket on Tanker Tracking, in the Operation Transaction Register and in
the acknowledgement list - even though AGGE is outside their assigned
locations. A user scoped to an unrelated location (OTHER) must not see it.
"""

from datetime import date, datetime, timezone

from app.dependencies.permissions import (
    TRANSACTION_PARTY_LOCATION_FIELDS,
    apply_transaction_party_scope_filter,
    ensure_transaction_in_user_party_scope,
    ensure_user_is_party_to_location_codes,
    get_user_location_codes,
    user_is_party_to_location_codes,
    user_is_party_to_transaction,
)
from app.models import (
    Asset,
    AssetType,
    Location,
    OperationTransaction,
    OperationTransactionValue,
    OperationType,
    Permission,
    Role,
    RolePermission,
    TankerReceiptAcknowledgement,
    UserLocation,
)
from app.routers.shuttle_fso_voyages import ensure_voyage_in_user_scope
from tests.conftest import create_user

PASSWORD = "StrongPass123!"

TANKER_PAYLOAD = {
    "meta": {"tanker_name": "Test Tanker"},
    "inputs": {"compartment": "1"},
    "calculated": {},
}


def _make_user(db, client, username, permissions, locations):
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
    user.all_locations_access = "No"
    for code in locations:
        db.add(UserLocation(user_id=user.id, location_code=code))
    db.commit()

    login = client.post("/auth/login", json={"username": username, "password": PASSWORD})
    assert login.status_code == 200, login.text
    return {"Authorization": f"Bearer {login.json()['access_token']}"}, user


def _seed_locations_and_tanker(db):
    db.add_all(
        [
            Location(location_code="AGGE", location_name="Agge", location_type="Terminal", status="Active"),
            Location(location_code="UTP", location_name="Utapate", location_type="Terminal", status="Active"),
            Location(location_code="OTHER", location_name="Other", location_type="Terminal", status="Active"),
            AssetType(asset_type_code="TANKER", asset_type_name="Tanker Truck", status="Active"),
            Asset(
                asset_code="TANKER_01",
                asset_name="Test Tanker",
                asset_type_code="TANKER",
                asset_scope="Global",
                status="Active",
            ),
            OperationType(
                operation_type_code="TANKER_LOAD",
                operation_type_name="Tanker Load",
                operation_category="Loading",
                applicable_asset_type_code="TANKER",
                status="Active",
            ),
        ]
    )
    db.flush()


def _create_cross_location_ticket(db):
    """Approved sender ticket at AGGE addressed to receiver location UTP."""
    tx = OperationTransaction(
        operation_number="OP-T-001",
        operation_ticket_number="TKT-AGGE-001",
        operation_type_code="TANKER_LOAD",
        primary_asset_code="TANKER_01",
        primary_asset_type_code="TANKER",
        convoy_number="CNV-T-001",
        origin_location_code="AGGE",
        destination_location_code="UTP",
        sender_location_code="AGGE",
        receiver_location_code="UTP",
        operation_date=date.today(),
        product_name="Crude",
        status="Approved",
    )
    db.add(tx)
    db.flush()
    db.add(
        OperationTransactionValue(
            transaction_id=tx.id,
            field_code="tanker_payload",
            field_name="Tanker Payload",
            data_type="JSON",
            field_value=TANKER_PAYLOAD,
            sort_order=1,
        )
    )
    db.commit()
    return tx


VIEW_TRACKING_PERMS = ["View Tanker Tracking", "View Operation Transaction"]


# ---------------------------------------------------------------------------
# Helper level
# ---------------------------------------------------------------------------


def test_party_helpers_accept_any_involved_location(db):
    scoped = create_user(db, "party_helper_user", PASSWORD)
    scoped.all_locations_access = "No"
    db.add(UserLocation(user_id=scoped.id, location_code="UTP"))
    db.flush()

    cross_location = OperationTransaction(
        origin_location_code="AGGE",
        destination_location_code="UTP",
        sender_location_code="AGGE",
        receiver_location_code="UTP",
    )
    same_location = OperationTransaction(
        origin_location_code="AGGE",
        destination_location_code=None,
        sender_location_code=None,
        receiver_location_code=None,
    )
    unrelated = OperationTransaction(
        origin_location_code="AGGE",
        destination_location_code="LAG",
        sender_location_code="AGGE",
        receiver_location_code="LAG",
    )
    empty = OperationTransaction(
        origin_location_code=None,
        destination_location_code=None,
        sender_location_code=None,
        receiver_location_code=None,
    )

    assert user_is_party_to_transaction(scoped, db, cross_location) is True
    assert user_is_party_to_transaction(scoped, db, same_location) is False
    assert user_is_party_to_transaction(scoped, db, unrelated) is False
    assert user_is_party_to_transaction(scoped, db, empty) is True

    ensure_transaction_in_user_party_scope(scoped, db, cross_location)
    ensure_user_is_party_to_location_codes(scoped, db, ["AGGE", "UTP"], "ticket")

    import pytest
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as exc_info:
        ensure_transaction_in_user_party_scope(scoped, db, unrelated)
    assert exc_info.value.status_code == 403

    assert set(get_user_location_codes(scoped, db)) == {"utp"}
    assert user_is_party_to_location_codes(scoped, db, []) is True
    assert user_is_party_to_location_codes(scoped, db, ["agge"]) is False


def test_party_query_filter_matches_any_column(db):
    scoped = create_user(db, "party_query_user", PASSWORD)
    scoped.all_locations_access = "No"
    db.add(UserLocation(user_id=scoped.id, location_code="UTP"))
    db.flush()
    _seed_locations_and_tanker(db)
    _create_cross_location_ticket(db)

    query = apply_transaction_party_scope_filter(
        db.query(OperationTransaction), OperationTransaction, scoped, db
    )
    rows = query.all()
    assert len(rows) == 1
    assert rows[0].operation_number == "OP-T-001"

    assert set(TRANSACTION_PARTY_LOCATION_FIELDS) == {
        "origin_location_code",
        "destination_location_code",
        "sender_location_code",
        "receiver_location_code",
    }


# ---------------------------------------------------------------------------
# HTTP level - Tanker Tracking list
# ---------------------------------------------------------------------------


def test_receiver_and_sender_see_cross_location_tanker_ticket(db, client):
    _seed_locations_and_tanker(db)
    tx = _create_cross_location_ticket(db)

    receiver_headers, _ = _make_user(
        db,
        client,
        "utp_receiver",
        [*VIEW_TRACKING_PERMS, "Create Operation Entry"],
        ["UTP"],
    )
    sender_headers, _ = _make_user(db, client, "agge_sender", VIEW_TRACKING_PERMS, ["AGGE"])
    # Same permissions as the receiver, but scoped to an unrelated location -
    # the 403 below therefore proves the location party rule, not the RBAC one.
    stranger_headers, _ = _make_user(
        db,
        client,
        "other_user",
        [*VIEW_TRACKING_PERMS, "Create Operation Entry"],
        ["OTHER"],
    )

    def convoy_numbers(headers):
        response = client.get("/tanker-tracking", headers=headers)
        assert response.status_code == 200, response.text
        return [row.get("convoy_number") for row in response.json()["rows"]]

    # Receiver scoped only to UTP sees the ticket addressed to UTP ...
    assert "CNV-T-001" in convoy_numbers(receiver_headers)
    # ... and the sender side keeps seeing its own ticket ...
    assert "CNV-T-001" in convoy_numbers(sender_headers)
    # ... while an unrelated location sees nothing.
    assert convoy_numbers(stranger_headers) == []

    # Sender-ticket lookup used by the acknowledgement flow must also work
    # for the receiver (it is the party that acknowledges receipt).
    sender_ref = client.get(
        f"/tanker-tracking/sender-reference/{tx.id}", headers=receiver_headers
    )
    assert sender_ref.status_code == 200, sender_ref.text

    blocked_ref = client.get(
        f"/tanker-tracking/sender-reference/{tx.id}", headers=stranger_headers
    )
    assert blocked_ref.status_code == 403


def test_acknowledgement_list_shows_receiver_party(db, client):
    _seed_locations_and_tanker(db)
    tx = _create_cross_location_ticket(db)
    db.add(
        TankerReceiptAcknowledgement(
            sender_transaction_id=tx.id,
            convoy_number="CNV-T-001",
            tanker_asset_code="TANKER_01",
            receiver_location_code="UTP",
            acknowledged_by="utp_receiver",
            acknowledged_at=datetime.now(timezone.utc),
            status="Acknowledged",
        )
    )
    db.commit()

    receiver_headers, _ = _make_user(db, client, "utp_receiver", VIEW_TRACKING_PERMS, ["UTP"])
    sender_headers, _ = _make_user(db, client, "agge_sender", VIEW_TRACKING_PERMS, ["AGGE"])
    stranger_headers, _ = _make_user(db, client, "other_user", VIEW_TRACKING_PERMS, ["OTHER"])

    def ack_rows(headers):
        response = client.get("/tanker-tracking/acknowledgements", headers=headers)
        assert response.status_code == 200, response.text
        return [row for row in response.json() if row.get("convoy_number") == "CNV-T-001"]

    assert len(ack_rows(receiver_headers)) == 1
    assert len(ack_rows(sender_headers)) == 1
    assert ack_rows(stranger_headers) == []


# ---------------------------------------------------------------------------
# HTTP level - Operation Transaction Register + detail
# ---------------------------------------------------------------------------


def test_register_and_detail_show_received_ticket(db, client):
    _seed_locations_and_tanker(db)
    tx = _create_cross_location_ticket(db)

    receiver_headers, _ = _make_user(db, client, "utp_receiver", VIEW_TRACKING_PERMS, ["UTP"])
    stranger_headers, _ = _make_user(db, client, "other_user", VIEW_TRACKING_PERMS, ["OTHER"])

    register = client.get("/operation-transactions/paged", headers=receiver_headers)
    assert register.status_code == 200, register.text
    tickets = [row.get("ticket_number") for row in register.json()["rows"]]
    assert "TKT-AGGE-001" in tickets

    stranger_register = client.get("/operation-transactions/paged", headers=stranger_headers)
    assert stranger_register.status_code == 200, stranger_register.text
    assert stranger_register.json()["rows"] == []

    detail = client.get(f"/operation-transactions/{tx.id}", headers=receiver_headers)
    assert detail.status_code == 200, detail.text

    stranger_detail = client.get(f"/operation-transactions/{tx.id}", headers=stranger_headers)
    assert stranger_detail.status_code == 403

    history = client.get(
        f"/operation-transactions/{tx.id}/status-history", headers=receiver_headers
    )
    assert history.status_code == 200, history.text


# ---------------------------------------------------------------------------
# Voyage party scope (Shuttle / FSO tracking)
# ---------------------------------------------------------------------------


def test_voyage_scope_uses_party_rule(db):
    _seed_locations_and_tanker(db)

    receiver = create_user(db, "voyage_receiver", PASSWORD)
    receiver.all_locations_access = "No"
    db.add(UserLocation(user_id=receiver.id, location_code="UTP"))

    stranger = create_user(db, "voyage_stranger", PASSWORD)
    stranger.all_locations_access = "No"
    db.add(UserLocation(user_id=stranger.id, location_code="OTHER"))
    db.flush()

    # Voyage keyed at AGGE whose only ticket is addressed to receiver UTP.
    _create_cross_location_ticket(db)

    # The receiver may open / act on the voyage although its key location
    # (AGGE) is outside their assigned scope.
    ensure_voyage_in_user_scope(db, receiver, "AGGE", "CNV-T-001", "TANKER_01")

    import pytest
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as exc_info:
        ensure_voyage_in_user_scope(db, stranger, "AGGE", "CNV-T-001", "TANKER_01")
    assert exc_info.value.status_code == 403

    # An empty voyage falls back to the voyage's own location code.
    ensure_voyage_in_user_scope(db, receiver, "UTP", "CNV-EMPTY", "TANKER_01")
    with pytest.raises(HTTPException) as exc_info:
        ensure_voyage_in_user_scope(db, receiver, "AGGE", "CNV-EMPTY", "TANKER_01")
    assert exc_info.value.status_code == 403
