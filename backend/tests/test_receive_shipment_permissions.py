"""
Shipment-receipt permission family (PERMISSION_CRITERIA_MODEL.md, section 7.1).

A receiving terminal must be able to acknowledge the movement addressed to it
and to create / edit its own receiving ticket without being granted the general
data-entry and tracking-edit rights of the sending terminal:

  * ``Acknowledge Shipment Receipt``  -> barge / tanker receipt acknowledgement
  * ``Create Receiving Ticket``       -> the linked receiving ticket

Every endpoint that enforces the new capability also still accepts the general
permission (Edit Barge Tracking / Edit Tanker Tracking / Create Operation Entry
/ Edit Operation Entry / View Operation Transaction), so no existing role loses
access - the tests below pin both sides of that rule.
"""

from app.models import Permission, RolePermission, Trip, UserRole
from tests.test_tracking_module_config_flow import (
    APPROVER_PERMS,
    CONFIG_PERMS,
    CONVOY,
    SENDER_PERMS,
    _acknowledge,
    _advance,
    _configure_barge,
    _entry_payload,
    _seed,
)
from tests.test_barge_end_to_end_approval import _make_user

PASSWORD = "StrongPass123!"

RECEIVER_ONLY_PERMS = [
    "View Barge Tracking",
    "Acknowledge Shipment Receipt",
    "Create Receiving Ticket",
    "Submit Operation Transaction",
    "Review Operation Transaction",
    "View Operation Transaction",
]


def _receiver_headers(db, client, name="receipt_receiver"):
    headers, user = _make_user(
        db, client, name, RECEIVER_ONLY_PERMS, all_locations=False, locations=["UTP"]
    )
    return headers, user


def test_catalog_contains_the_shipment_receipt_permissions():
    from app.utils.default_permissions import PERMISSION_CATALOG

    module = next(
        module
        for category in PERMISSION_CATALOG
        for module in category["modules"]
        if module["module_name"] == "Shipment Receipt"
    )
    names = {permission["permission_name"] for permission in module["permissions"]}
    assert names == {"Acknowledge Shipment Receipt", "Create Receiving Ticket"}


def test_receiver_with_only_shipment_permissions_can_acknowledge_and_receive(client, db):
    templates = _seed(db)
    admin_headers, _ = _make_user(db, client, "sr_admin", CONFIG_PERMS + APPROVER_PERMS, all_locations=True)
    _configure_barge(client, admin_headers)

    sender_headers, _ = _make_user(db, client, "sr_sender", SENDER_PERMS, all_locations=False, locations=["AGGE"])
    approver_headers, _ = _make_user(db, client, "sr_approver", APPROVER_PERMS, all_locations=True)
    receiver_headers, receiver_user = _receiver_headers(db, client)

    # The receiving role deliberately holds neither "Edit Barge Tracking" nor
    # "Create Operation Entry" / "Edit Operation Entry".
    held = {
        name
        for (name,) in db.query(Permission.permission_name)
        .join(RolePermission, RolePermission.permission_id == Permission.id)
        .join(UserRole, UserRole.role_id == RolePermission.role_id)
        .filter(UserRole.user_id == receiver_user.id)
        .all()
    }
    assert "Edit Barge Tracking" not in held
    assert "Create Operation Entry" not in held
    assert "Edit Operation Entry" not in held

    # 1. Approved sender ticket at AGGE addressed to UTP.
    created = client.post(
        "/operation-entries",
        json=_entry_payload(templates["BARGE_LOAD"].id, "BARGE_LOAD", sender="AGGE", event_type="LOAD_1"),
        headers=sender_headers,
    )
    assert created.status_code == 200, created.text
    sender_tx_id = created.json()["transaction"]["id"]
    _advance(client, sender_tx_id, sender_headers, "Submitted")
    _advance(client, sender_tx_id, approver_headers, "Approved")

    # 2. Acknowledge receipt with only "Acknowledge Shipment Receipt".
    _acknowledge(client, receiver_headers)

    # 3. The sender reference and the entry list are reachable.
    info = client.get(f"/operation-entries/linked-sender/{sender_tx_id}", headers=receiver_headers)
    assert info.status_code == 200, info.text
    assert info.json()["origin_location_code"] == "UTP"

    listed = client.get("/operation-entries", headers=receiver_headers)
    assert listed.status_code == 200, listed.text

    # 4. Create the receiving ticket with only "Create Receiving Ticket".
    receiving = client.post(
        "/operation-entries",
        json=_entry_payload(templates["BARGE_UNLOAD"].id, "BARGE_UNLOAD",
                            linked_ticket_id=sender_tx_id, event_type="UNLOAD"),
        headers=receiver_headers,
    )
    assert receiving.status_code == 200, receiving.text
    receiving_id = receiving.json()["transaction"]["id"]
    assert receiving.json()["linked_ticket_id"] == sender_tx_id

    # 5. Edit the Draft receiving ticket with the same capability.
    edited = client.put(
        f"/operation-entries/{receiving_id}",
        json=_entry_payload(templates["BARGE_UNLOAD"].id, "BARGE_UNLOAD", event_type="UNLOAD"),
        headers=receiver_headers,
    )
    assert edited.status_code == 200, edited.text
    assert edited.json()["linked_ticket_id"] == sender_tx_id

    # 6. Submit + approve still create the comparison, i.e. the normal flow is
    #    not side-tracked by the narrower permission.
    _advance(client, receiving_id, receiver_headers, "Submitted")
    _advance(client, receiving_id, approver_headers, "Approved")

    trip = db.query(Trip).filter(Trip.convoy_number == CONVOY).first()
    assert trip is not None


def test_shipment_receipt_permission_does_not_grant_sender_entry(client, db):
    """The scoped capability must not open general data entry."""
    _seed(db)
    receiver_headers, _ = _receiver_headers(db, client, "sr_sender_guard")

    created = client.post(
        "/operation-entries",
        json=_entry_payload(1, "BARGE_LOAD", sender="UTP"),
        headers=receiver_headers,
    )
    # 403 (no Create Operation Entry) - never 200.
    assert created.status_code == 403, created.text


def test_receiver_without_any_permission_is_still_blocked(client, db):
    templates = _seed(db)
    admin_headers, _ = _make_user(db, client, "sr_admin2", CONFIG_PERMS + APPROVER_PERMS, all_locations=True)
    _configure_barge(client, admin_headers)
    sender_headers, _ = _make_user(db, client, "sr_sender2", SENDER_PERMS, all_locations=False, locations=["AGGE"])
    approver_headers, _ = _make_user(db, client, "sr_approver2", APPROVER_PERMS, all_locations=True)

    created = client.post(
        "/operation-entries",
        json=_entry_payload(templates["BARGE_LOAD"].id, "BARGE_LOAD", sender="AGGE", event_type="LOAD_1"),
        headers=sender_headers,
    )
    sender_tx_id = created.json()["transaction"]["id"]
    _advance(client, sender_tx_id, sender_headers, "Submitted")
    _advance(client, sender_tx_id, approver_headers, "Approved")

    viewer_headers, _ = _make_user(
        db, client, "sr_viewer_only", ["View Barge Tracking"], all_locations=False, locations=["UTP"]
    )

    acknowledge_attempt = client.post(
        "/barge-trip/trip-events",
        json={
            "convoy_number": CONVOY,
            "event_type": "RECEIVED",
            "location_code": "UTP",
            "asset_code": "BARGE_01",
        },
        headers=viewer_headers,
    )
    assert acknowledge_attempt.status_code == 403, acknowledge_attempt.text

    entry_attempt = client.post(
        "/operation-entries",
        json=_entry_payload(templates["BARGE_UNLOAD"].id, "BARGE_UNLOAD",
                            linked_ticket_id=sender_tx_id, event_type="UNLOAD"),
        headers=viewer_headers,
    )
    assert entry_attempt.status_code == 403, entry_attempt.text


def test_edit_barge_tracking_still_acknowledges(client, db):
    """The general permission keeps working (no regression for existing roles)."""
    templates = _seed(db)
    admin_headers, _ = _make_user(db, client, "sr_admin3", CONFIG_PERMS + APPROVER_PERMS, all_locations=True)
    _configure_barge(client, admin_headers)
    sender_headers, _ = _make_user(db, client, "sr_sender3", SENDER_PERMS, all_locations=False, locations=["AGGE"])
    approver_headers, _ = _make_user(db, client, "sr_approver3", APPROVER_PERMS, all_locations=True)

    created = client.post(
        "/operation-entries",
        json=_entry_payload(templates["BARGE_LOAD"].id, "BARGE_LOAD", sender="AGGE", event_type="LOAD_1"),
        headers=sender_headers,
    )
    sender_tx_id = created.json()["transaction"]["id"]
    _advance(client, sender_tx_id, sender_headers, "Submitted")
    _advance(client, sender_tx_id, approver_headers, "Approved")

    legacy_headers, _ = _make_user(
        db, client, "sr_legacy_editor",
        ["View Barge Tracking", "Edit Barge Tracking"],
        all_locations=False,
        locations=["UTP"],
    )
    _acknowledge(client, legacy_headers, asset="BARGE_01", location="UTP")
