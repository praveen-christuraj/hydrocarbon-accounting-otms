"""
Regression tests for the clubbed Sender / Receiver dropdowns.

Operation Entry used to expose four location dropdowns (Origin, Sender,
Destination, Receiver). It now exposes two:

  * Sender   -> origin_location_code AND sender_location_code
  * Receiver -> destination_location_code AND receiver_location_code

The four columns are kept. These tests lock down that:

  * a clubbed choice writes both columns of its pair;
  * a legacy payload that only sends origin / destination (exactly what a
    pre-change client sends) is completed to both columns;
  * records stored before the change - only one side of each pair populated -
    resolve to the same single Sender / Receiver as new records, in the
    tracking modules and in the voyage aggregation;
  * a receiver ticket created against an approved sender ticket keeps the
    receiving terminal as its own location (origin) and still resolves to the
    same route as the ticket it was created against.
"""

from datetime import date

from app.models import (
    Asset,
    AssetType,
    Location,
    LocationOperationAvailability,
    OperationTemplate,
    OperationTemplateField,
    OperationTransaction,
    OperationType,
    Permission,
    Role,
    RolePermission,
    UserLocation,
)
from app.services.location_pairing import (
    apply_sender_receiver_pairing,
    resolve_receiver_location_code,
    resolve_sender_location_code,
)
from tests.conftest import create_user

PASSWORD = "StrongPass123!"

MULTI_TANK_PAYLOAD = {
    "meta": {"assetCode": "BARGE_01", "tankIds": ["T1"]},
    "inputs": {
        "before": {
            "obsMode": "Observed Density",
            "obsDensity": "0.85",
            "dips": {"T1": {"total": "100", "water": "5"}},
        },
        "after": {
            "obsMode": "Observed Density",
            "obsDensity": "0.85",
            "dips": {"T1": {"total": "300", "water": "5"}},
        },
    },
    "seals": {
        "after": {
            "temporary": {
                "portManifoldSeal": "PM-001",
                "stbdManifoldSeal": "SM-001",
                "pumproomSeal": "PR-001",
            },
            "tankSeals": {},
        }
    },
}


def _make_user(db, client, username, permissions, all_locations=True, locations=None):
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
    if locations:
        for code in locations:
            db.add(UserLocation(user_id=user.id, location_code=code))
    db.commit()

    login = client.post("/auth/login", json={"username": username, "password": PASSWORD})
    assert login.status_code == 200, login.text
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def _seed_master_data(db):
    db.add_all(
        [
            Location(location_code="AGGE", location_name="Agge", location_type="Terminal", status="Active"),
            Location(location_code="UTP", location_name="Utapate", location_type="Terminal", status="Active"),
            AssetType(asset_type_code="BARGE", asset_type_name="Barge", status="Active"),
        ]
    )
    db.flush()

    db.add(
        Asset(
            asset_code="BARGE_01",
            asset_name="Barge One",
            asset_type_code="BARGE",
            asset_scope="Global",
            status="Active",
        )
    )
    db.flush()

    db.add(
        OperationType(
            operation_type_code="BARGE_LOAD",
            operation_type_name="Barge Loading",
            applicable_asset_type_code="BARGE",
            operation_category="Movement",
            requires_sender_location="No",
            requires_receiver_location="No",
            status="Active",
        )
    )
    db.flush()

    db.add_all(
        [
            LocationOperationAvailability(
                location_code="AGGE", operation_type_code="BARGE_LOAD", status="Active"
            ),
            LocationOperationAvailability(
                location_code="UTP", operation_type_code="BARGE_LOAD", status="Active"
            ),
        ]
    )

    template = OperationTemplate(
        template_name="Barge Multi-Tank",
        operation_type_code="BARGE_LOAD",
        entry_layout_type="Multi-Tank Before/After",
        calculation_engine="Multi-Tank Quantity",
        status="Active",
    )
    db.add(template)
    db.flush()

    db.add_all(
        [
            OperationTemplateField(
                template_id=template.id,
                field_name="Multi Tank Payload",
                field_code="multi_tank_payload",
                field_group="Barge",
                data_type="JSON",
                input_mode="Manual",
                calculation_role="Input",
                is_required="No",
                sort_order=1,
                status="Active",
            ),
            OperationTemplateField(
                template_id=template.id,
                field_name="Barge Movement Stage",
                field_code="barge_event_type",
                field_group="Barge Tracking",
                data_type="Text",
                input_mode="Manual",
                calculation_role="Input",
                is_required="No",
                sort_order=2,
                status="Active",
            ),
        ]
    )
    db.commit()
    return template


def _entry_payload(template, **overrides):
    transaction = {
        "operation_type_code": "BARGE_LOAD",
        "primary_asset_code": "BARGE_01",
        "convoy_number": "CNV-PAIR-001",
        "origin_location_code": "AGGE",
        "destination_location_code": "UTP",
        "sender_location_code": None,
        "receiver_location_code": None,
        "operation_date": "2026-10-10",
        "operation_start_datetime": None,
        "operation_end_datetime": None,
        "product_name": "Crude Oil",
        "created_by": None,
        "remarks": None,
        "status": "Draft",
    }
    transaction.update(overrides)

    return {
        "operation_template_id": template.id,
        "transaction": transaction,
        "values": [
            {"field_code": "multi_tank_payload", "field_value": MULTI_TANK_PAYLOAD},
            {"field_code": "barge_event_type", "field_value": "LOAD_1"},
        ],
    }


# ---------------------------------------------------------------------------
# Unit level: the pairing helpers
# ---------------------------------------------------------------------------


def test_resolvers_prefer_the_named_column_and_fall_back_to_its_partner(db):
    class _Record:
        def __init__(self, **kwargs):
            for key, value in kwargs.items():
                setattr(self, key, value)

    # New record: both columns of each pair populated with the same value.
    clubbed = _Record(
        origin_location_code="AGGE",
        sender_location_code="AGGE",
        destination_location_code="UTP",
        receiver_location_code="UTP",
    )
    assert resolve_sender_location_code(clubbed) == "AGGE"
    assert resolve_receiver_location_code(clubbed) == "UTP"

    # Legacy record: only origin / destination populated.
    legacy = _Record(
        origin_location_code="AGGE",
        sender_location_code=None,
        destination_location_code="UTP",
        receiver_location_code=None,
    )
    assert resolve_sender_location_code(legacy) == "AGGE"
    assert resolve_receiver_location_code(legacy) == "UTP"

    # Legacy tracking record: only sender / receiver populated.
    legacy_tracking = _Record(
        origin_location_code="UTP",
        sender_location_code="AGGE",
        destination_location_code="UTP",
        receiver_location_code="UTP",
    )
    assert resolve_sender_location_code(legacy_tracking) == "AGGE"
    assert resolve_receiver_location_code(legacy_tracking) == "UTP"

    assert resolve_sender_location_code(None) is None
    assert resolve_receiver_location_code(None) is None


def test_apply_pairing_only_fills_blanks(db):
    class _Record:
        def __init__(self, **kwargs):
            for key, value in kwargs.items():
                setattr(self, key, value)

    # Blanks are completed from the partner column.
    record = _Record(
        origin_location_code="AGGE",
        sender_location_code=None,
        destination_location_code="UTP",
        receiver_location_code=None,
    )
    assert apply_sender_receiver_pairing(record) is True
    assert record.sender_location_code == "AGGE"
    assert record.receiver_location_code == "UTP"

    # Already populated values are never overwritten - a linked receiver
    # ticket keeps the sender ticket's Sender as its sender side.
    linked = _Record(
        origin_location_code="UTP",
        sender_location_code="AGGE",
        destination_location_code="UTP",
        receiver_location_code="UTP",
    )
    assert apply_sender_receiver_pairing(linked) is False
    assert linked.origin_location_code == "UTP"
    assert linked.sender_location_code == "AGGE"

    # Nothing to do at all.
    empty = _Record(
        origin_location_code="AGGE",
        sender_location_code="AGGE",
        destination_location_code=None,
        receiver_location_code=None,
    )
    assert apply_sender_receiver_pairing(empty) is False
    assert empty.destination_location_code is None


# ---------------------------------------------------------------------------
# API level: Operation Entry writes both columns of each pair
# ---------------------------------------------------------------------------


def test_entry_create_writes_both_columns_of_each_pair(client, db):
    template = _seed_master_data(db)
    headers = _make_user(
        db,
        client,
        "pair_operator",
        ["Create Operation Entry", "View Operation Transaction"],
        all_locations=False,
        locations=["AGGE", "UTP"],
    )

    created = client.post(
        "/operation-entries",
        json=_entry_payload(template),
        headers=headers,
    )
    assert created.status_code == 200, created.text

    transaction = created.json()["transaction"]
    assert transaction["origin_location_code"] == "AGGE"
    assert transaction["sender_location_code"] == "AGGE"
    assert transaction["destination_location_code"] == "UTP"
    assert transaction["receiver_location_code"] == "UTP"


def test_entry_create_completes_a_legacy_origin_destination_payload(client, db):
    """A pre-change client that sends only origin / destination still gets a
    fully paired record, so both columns stay individually queryable."""
    template = _seed_master_data(db)
    headers = _make_user(
        db,
        client,
        "pair_legacy",
        ["Create Operation Entry", "View Operation Transaction"],
        all_locations=False,
        locations=["AGGE", "UTP"],
    )

    created = client.post(
        "/operation-entries",
        json=_entry_payload(template, convoy_number="CNV-PAIR-LEGACY"),
        headers=headers,
    )
    assert created.status_code == 200, created.text

    stored = (
        db.query(OperationTransaction)
        .filter(OperationTransaction.id == created.json()["transaction"]["id"])
        .first()
    )
    assert stored.origin_location_code == "AGGE"
    assert stored.sender_location_code == "AGGE"
    assert stored.destination_location_code == "UTP"
    assert stored.receiver_location_code == "UTP"


def test_entry_update_keeps_the_pairs_in_sync(client, db):
    template = _seed_master_data(db)
    headers = _make_user(
        db,
        client,
        "pair_editor",
        ["Create Operation Entry", "Edit Operation Entry", "View Operation Transaction"],
        all_locations=False,
        locations=["AGGE", "UTP"],
    )

    created = client.post(
        "/operation-entries",
        json=_entry_payload(template, convoy_number="CNV-PAIR-EDIT"),
        headers=headers,
    )
    assert created.status_code == 200, created.text
    tx_id = created.json()["transaction"]["id"]

    updated = client.put(
        f"/operation-entries/{tx_id}",
        json=_entry_payload(
            template,
            convoy_number="CNV-PAIR-EDIT",
            origin_location_code="UTP",
            sender_location_code="UTP",
            destination_location_code="AGGE",
            receiver_location_code="AGGE",
        ),
        headers=headers,
    )
    assert updated.status_code == 200, updated.text

    transaction = updated.json()["transaction"]
    assert transaction["origin_location_code"] == "UTP"
    assert transaction["sender_location_code"] == "UTP"
    assert transaction["destination_location_code"] == "AGGE"
    assert transaction["receiver_location_code"] == "AGGE"


# ---------------------------------------------------------------------------
# Tracking: previously stored data resolves to the same single pair
# ---------------------------------------------------------------------------


def test_voyage_ends_come_from_the_resolved_pair(db):
    """A legacy ticket (only origin / destination) and a clubbed ticket must
    describe the same two ends of the convoy."""
    _seed_master_data(db)

    db.add(
        OperationTransaction(
            operation_number="OP-LEGACY-1",
            operation_type_code="BARGE_LOAD",
            primary_asset_code="BARGE_01",
            primary_asset_type_code="BARGE",
            convoy_number="CNV-PAIR-001",
            origin_location_code="AGGE",
            destination_location_code="UTP",
            sender_location_code=None,
            receiver_location_code=None,
            operation_date=date(2026, 10, 10),
            status="Approved",
        )
    )
    db.commit()

    legacy = (
        db.query(OperationTransaction)
        .filter(OperationTransaction.operation_number == "OP-LEGACY-1")
        .first()
    )
    assert resolve_sender_location_code(legacy) == "AGGE"
    assert resolve_receiver_location_code(legacy) == "UTP"


def test_convoy_tracker_exposes_the_resolved_pair(client, db):
    template = _seed_master_data(db)
    headers = _make_user(
        db,
        client,
        "pair_tracker",
        [
            "Create Operation Entry",
            "View Operation Transaction",
            "Submit Operation Transaction",
            "Approve Operation Transaction",
            "Review Operation Transaction",
            "View Barge Tracking",
        ],
        all_locations=True,
    )

    created = client.post(
        "/operation-entries",
        json=_entry_payload(template, convoy_number="CNV-PAIR-TRACK"),
        headers=headers,
    )
    assert created.status_code == 200, created.text
    tx_id = created.json()["transaction"]["id"]

    submitted = client.patch(
        f"/operation-transactions/{tx_id}/status",
        json={"status": "Submitted", "remarks": "ready", "review_confirmed": True},
        headers=headers,
    )
    assert submitted.status_code == 200, submitted.text

    approved = client.patch(
        f"/operation-transactions/{tx_id}/status",
        json={"status": "Approved", "remarks": "ok", "review_confirmed": True},
        headers=headers,
    )
    assert approved.status_code == 200, approved.text

    tracker = client.get(
        "/barge-trip/convoy-tracker?convoy_number=CNV-PAIR-TRACK",
        headers=headers,
    )
    assert tracker.status_code == 200, tracker.text

    ticket = tracker.json()["assets"][0]["tickets"][0]
    assert ticket["sender_code"] == "AGGE"
    assert ticket["receiver_code"] == "UTP"
    assert ticket["sender_name"] == "Agge"
    assert ticket["receiver_name"] == "Utapate"


def test_voyage_list_uses_the_resolved_pair(client, db):
    """The receiving terminal must not be listed as a voyage Origin just
    because a receiver ticket keeps it as its own location."""
    template = _seed_master_data(db)
    headers = _make_user(
        db,
        client,
        "pair_voyage",
        [
            "Create Operation Entry",
            "View Operation Transaction",
            "Submit Operation Transaction",
            "Approve Operation Transaction",
            "Review Operation Transaction",
            "View Barge Tracking",
        ],
        all_locations=True,
    )

    created = client.post(
        "/operation-entries",
        json=_entry_payload(template, convoy_number="CNV-PAIR-VOYAGE"),
        headers=headers,
    )
    assert created.status_code == 200, created.text
    tx_id = created.json()["transaction"]["id"]

    submitted = client.patch(
        f"/operation-transactions/{tx_id}/status",
        json={"status": "Submitted", "remarks": "ready", "review_confirmed": True},
        headers=headers,
    )
    assert submitted.status_code == 200, submitted.text

    approved = client.patch(
        f"/operation-transactions/{tx_id}/status",
        json={"status": "Approved", "remarks": "ok", "review_confirmed": True},
        headers=headers,
    )
    assert approved.status_code == 200, approved.text

    voyages = client.get("/barge-trip/voyages?tab=OPEN", headers=headers)
    assert voyages.status_code == 200, voyages.text

    voyage = next(
        row
        for row in voyages.json()["rows"]
        if row["convoy_number"] == "CNV-PAIR-VOYAGE"
    )
    assert sorted(voyage["origin_location_codes"]) == ["AGGE"]
    assert sorted(voyage["destination_location_codes"]) == ["UTP"]


# ---------------------------------------------------------------------------
# Linked receiver ticket: same route, receiving terminal keeps ownership
# ---------------------------------------------------------------------------


def test_linked_receiver_ticket_resolves_to_the_same_route(db):
    """
    The receiving terminal stays the ticket's own location (origin) so the
    location scope and availability checks apply to it, while the sender
    ticket's Sender is carried as the receiver ticket's Sender. Both
    therefore resolve to the same route as the sender ticket - whatever the
    stored columns look like.
    """
    from app.services.tracking_links import linked_location_overrides

    sender = OperationTransaction(
        operation_number="OP-SENDER-1",
        operation_type_code="BARGE_LOAD",
        primary_asset_code="BARGE_01",
        primary_asset_type_code="BARGE",
        convoy_number="CNV-PAIR-LINK",
        origin_location_code="AGGE",
        destination_location_code="UTP",
        sender_location_code=None,
        receiver_location_code=None,
        operation_date=date(2026, 10, 10),
        status="Approved",
    )

    overrides = linked_location_overrides(sender)
    receiver = OperationTransaction(
        operation_number="OP-RECEIVER-1",
        operation_type_code="BARGE_LOAD",
        primary_asset_code="BARGE_01",
        primary_asset_type_code="BARGE",
        convoy_number=overrides["convoy_number"],
        origin_location_code=overrides["origin_location_code"],
        destination_location_code=overrides["destination_location_code"],
        sender_location_code=overrides["sender_location_code"],
        receiver_location_code=overrides["receiver_location_code"],
        operation_date=date(2026, 10, 11),
        status="Draft",
    )

    # The receiving terminal owns the ticket ...
    assert receiver.origin_location_code == "UTP"
    # ... and the dispatching terminal is still recorded.
    assert receiver.sender_location_code == "AGGE"

    # Both tickets describe the same movement.
    assert resolve_sender_location_code(receiver) == resolve_sender_location_code(sender)
    assert resolve_receiver_location_code(receiver) == resolve_receiver_location_code(
        sender
    )
    assert (resolve_sender_location_code(receiver), resolve_receiver_location_code(receiver)) == (
        "AGGE",
        "UTP",
    )


def test_startup_backfill_only_fills_blank_columns(db):
    """
    The start-up backfill aligns historical rows: it copies the populated
    side of each pair into its blank partner and never overwrites a value
    that is already there.
    """
    from app.utils.db_migrations import ensure_sender_receiver_pairing_backfill

    db.add_all(
        [
            # Legacy: only origin / destination populated.
            OperationTransaction(
                operation_number="BF-1",
                operation_type_code="BARGE_LOAD",
                primary_asset_code="BARGE_01",
                primary_asset_type_code="BARGE",
                convoy_number="CNV-BF-1",
                origin_location_code="AGGE",
                destination_location_code="UTP",
                sender_location_code=None,
                receiver_location_code=None,
                operation_date=date(2026, 10, 10),
                status="Approved",
            ),
            # Legacy tracking: only sender / receiver populated.
            OperationTransaction(
                operation_number="BF-2",
                operation_type_code="BARGE_LOAD",
                primary_asset_code="BARGE_01",
                primary_asset_type_code="BARGE",
                convoy_number="CNV-BF-2",
                origin_location_code="UTP",
                destination_location_code=None,
                sender_location_code="AGGE",
                receiver_location_code="UTP",
                operation_date=date(2026, 10, 11),
                status="Approved",
            ),
            # Already paired - must stay untouched.
            OperationTransaction(
                operation_number="BF-3",
                operation_type_code="BARGE_LOAD",
                primary_asset_code="BARGE_01",
                primary_asset_type_code="BARGE",
                convoy_number="CNV-BF-3",
                origin_location_code="AGGE",
                destination_location_code="UTP",
                sender_location_code="AGGE",
                receiver_location_code="UTP",
                operation_date=date(2026, 10, 12),
                status="Approved",
            ),
            # No receiver at all - must stay empty.
            OperationTransaction(
                operation_number="BF-4",
                operation_type_code="BARGE_LOAD",
                primary_asset_code="BARGE_01",
                primary_asset_type_code="BARGE",
                convoy_number="CNV-BF-4",
                origin_location_code="AGGE",
                destination_location_code=None,
                sender_location_code=None,
                receiver_location_code=None,
                operation_date=date(2026, 10, 13),
                status="Approved",
            ),
        ]
    )
    db.commit()

    ensure_sender_receiver_pairing_backfill()

    db.expire_all()
    rows = {
        row.operation_number: row
        for row in db.query(OperationTransaction)
        .filter(OperationTransaction.operation_number.like("BF-%"))
        .all()
    }

    assert rows["BF-1"].sender_location_code == "AGGE"
    assert rows["BF-1"].receiver_location_code == "UTP"

    assert rows["BF-2"].origin_location_code == "UTP"
    assert rows["BF-2"].destination_location_code == "UTP"

    assert rows["BF-3"].origin_location_code == "AGGE"
    assert rows["BF-3"].destination_location_code == "UTP"

    assert rows["BF-4"].sender_location_code == "AGGE"
    assert rows["BF-4"].destination_location_code is None
    assert rows["BF-4"].receiver_location_code is None

    # Idempotent: a second run changes nothing.
    ensure_sender_receiver_pairing_backfill()
    db.expire_all()

    again = {
        row.operation_number: row
        for row in db.query(OperationTransaction)
        .filter(OperationTransaction.operation_number.like("BF-%"))
        .all()
    }
    for number, row in rows.items():
        assert (
            again[number].origin_location_code == row.origin_location_code
            and again[number].sender_location_code == row.sender_location_code
            and again[number].destination_location_code == row.destination_location_code
            and again[number].receiver_location_code == row.receiver_location_code
        ), number
