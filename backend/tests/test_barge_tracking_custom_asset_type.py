"""
Barge Tracking with a *custom* barge asset type (reported case: 'YADE').

The reported installation registers its barges under an asset type whose code
is not the literal word "BARGE" ('YADE'), and its barge tickets use an
operation type called 'BARGE_MOVE'. Two things used to break:

  1. Tracking Module Configuration refused the mapping with
     "Operation type BARGE_MOVE applies to asset type 'YADE'. Barge Tracking
      only captures operation types for barge assets."
  2. Even with a mapping in place (or in legacy mode) Barge Tracking listed
     nothing, because the ticket was recognised as a barge ticket only when the
     asset type code contained the literal text "barge".

These tests pin the fixed behaviour: the admin mapping is authoritative, a
custom asset type must not hide the voyage from the Open / Closed lists, and
the timeline / convoy tracker keep working.
"""

from datetime import date

from app.models import (
    Asset,
    AssetType,
    Location,
    OperationTransaction,
    OperationType,
    Permission,
    Role,
    RolePermission,
    Trip,
    UserRole,
)
from tests.conftest import create_user
from tests.test_barge_voyages_and_fso_variance import _make_user

PASSWORD = "StrongPass123!"

ASSET_TYPE_CODE = "YADE"
ASSET_CODE = "YADE-01"
OPERATION_TYPE_CODE = "BARGE_MOVE"
CONVOY_OPEN = "CNV-YADE-OPEN"
CONVOY_CLOSED = "CNV-YADE-CLOSED"

CONFIG_PERMS = [
    "View Tracking Module Configuration",
    "Create Tracking Module Configuration",
    "Edit Tracking Module Configuration",
    "Delete Tracking Module Configuration",
]
BARGE_PERMS = [
    "View Barge Tracking",
    "Edit Barge Tracking",
    "Close Barge Movement",
    "Reopen Barge Movement",
]


def _seed_masters(db, asset_type_name="YADE"):
    db.add_all(
        [
            Location(location_code="AGGE", location_name="Agge", location_type="Terminal", status="Active"),
            Location(location_code="LEKKI", location_name="Lekki", location_type="Terminal", status="Active"),
            AssetType(asset_type_code=ASSET_TYPE_CODE, asset_type_name=asset_type_name, status="Active"),
        ]
    )
    db.flush()

    db.add(
        Asset(
            asset_code=ASSET_CODE,
            asset_name="Yade One",
            asset_type_code=ASSET_TYPE_CODE,
            asset_scope="Global",
            status="Active",
        )
    )
    db.add(
        OperationType(
            operation_type_code=OPERATION_TYPE_CODE,
            operation_type_name="Barge Move",
            applicable_asset_type_code=ASSET_TYPE_CODE,
            operation_category="Movement",
            requires_sender_location="No",
            requires_receiver_location="No",
            status="Active",
        )
    )
    db.commit()


def _add_ticket(db, *, number, convoy, status="Approved"):
    tx = OperationTransaction(
        operation_number=number,
        operation_type_code=OPERATION_TYPE_CODE,
        primary_asset_code=ASSET_CODE,
        primary_asset_type_code=ASSET_TYPE_CODE,
        convoy_number=convoy,
        origin_location_code="AGGE",
        destination_location_code="LEKKI",
        operation_date=date(2026, 10, 12),
        status=status,
        created_by="tester",
    )
    db.add(tx)
    db.flush()
    return tx


def _map_barge_module(client, headers):
    return client.post(
        "/tracking-module-configs",
        json={
            "module_code": "BARGE",
            "operation_type_code": OPERATION_TYPE_CODE,
            "movement_role": "SENDER",
            "tracking_stage": "LOAD_1",
            "status": "Active",
        },
        headers=headers,
    )


# ---------------------------------------------------------------------------
# 1. The mapping itself
# ---------------------------------------------------------------------------

def test_custom_barge_asset_type_can_be_mapped_to_barge_tracking(client, db):
    _seed_masters(db)
    admin_headers, _ = _make_user(db, client, "yade_cfg_admin", CONFIG_PERMS, all_locations=True)

    mapped = _map_barge_module(client, admin_headers)
    assert mapped.status_code == 200, mapped.text
    assert mapped.json()["module_code"] == "BARGE"
    assert mapped.json()["tracking_stage"] == "LOAD_1"
    assert mapped.json()["applicable_asset_type_code"] == ASSET_TYPE_CODE


def test_mapping_is_not_limited_to_the_literal_word_barge(client, db):
    """The asset type name may not contain 'barge' either ('YADE')."""
    _seed_masters(db, asset_type_name="YADE")
    admin_headers, _ = _make_user(db, client, "yade_named_admin", CONFIG_PERMS, all_locations=True)

    mapped = _map_barge_module(client, admin_headers)
    assert mapped.status_code == 200, mapped.text


def test_tanker_operation_type_is_still_refused_for_barge_module(client, db):
    """A clearly tanker-side asset type must not be mapped to Barge Tracking."""
    _seed_masters(db)
    db.add(AssetType(asset_type_code="TANKER", asset_type_name="Tanker", status="Active"))
    db.add(
        OperationType(
            operation_type_code="TANKER_RECEIPT",
            operation_type_name="Tanker Receipt",
            applicable_asset_type_code="TANKER",
            operation_category="Movement",
            status="Active",
        )
    )
    db.commit()
    admin_headers, _ = _make_user(db, client, "yade_tanker_admin", CONFIG_PERMS, all_locations=True)

    refused = client.post(
        "/tracking-module-configs",
        json={
            "module_code": "BARGE",
            "operation_type_code": "TANKER_RECEIPT",
            "movement_role": "SENDER",
            "tracking_stage": "LOAD_1",
            "status": "Active",
        },
        headers=admin_headers,
    )
    assert refused.status_code == 400, refused.text
    assert "Barge Tracking" in refused.text


# ---------------------------------------------------------------------------
# 2. Open / Closed voyage lists (the reported empty lists)
# ---------------------------------------------------------------------------

def test_custom_asset_type_voyages_are_listed_in_both_tabs(client, db):
    _seed_masters(db)
    admin_headers, _ = _make_user(db, client, "yade_list_admin", CONFIG_PERMS, all_locations=True)
    assert _map_barge_module(client, admin_headers).status_code == 200

    viewer_headers, _ = _make_user(db, client, "yade_viewer", BARGE_PERMS, all_locations=True)

    _add_ticket(db, number="YADE-OPEN-1", convoy=CONVOY_OPEN)
    _add_ticket(db, number="YADE-CLOSED-1", convoy=CONVOY_CLOSED)
    db.add(Trip(convoy_number=CONVOY_CLOSED, status="CLOSED", remarks="settled"))
    db.add(Trip(convoy_number=CONVOY_OPEN, status="OPEN"))
    db.commit()

    open_data = client.get("/barge-trip/voyages?tab=OPEN", headers=viewer_headers)
    assert open_data.status_code == 200, open_data.text
    open_body = open_data.json()
    assert [row["convoy_number"] for row in open_body["rows"]] == [CONVOY_OPEN]
    assert open_body["open_count"] == 1
    assert open_body["closed_count"] == 1
    assert open_body["rows"][0]["barge_asset_codes"] == [ASSET_CODE]
    assert open_body["rows"][0]["ticket_count"] == 1

    closed_data = client.get("/barge-trip/voyages?tab=CLOSED", headers=viewer_headers)
    assert closed_data.status_code == 200, closed_data.text
    closed_body = closed_data.json()
    assert [row["convoy_number"] for row in closed_body["rows"]] == [CONVOY_CLOSED]
    assert closed_body["rows"][0]["status"] == "CLOSED"


def test_unmapped_barge_still_works_in_legacy_mode(client, db):
    """
    Before any Tracking Module Configuration exists the legacy rule applies.
    A ticket for a custom barge asset type must still be a barge ticket: the
    barge is identified from the operation type / asset / layout, not from the
    literal text "barge" in the asset type code.
    """
    _seed_masters(db)
    viewer_headers, _ = _make_user(db, client, "yade_legacy_viewer", BARGE_PERMS, all_locations=True)

    _add_ticket(db, number="YADE-LEGACY-1", convoy="CNV-YADE-LEGACY")
    db.commit()

    data = client.get("/barge-trip/voyages?tab=OPEN", headers=viewer_headers)
    assert data.status_code == 200, data.text
    assert [row["convoy_number"] for row in data.json()["rows"]] == ["CNV-YADE-LEGACY"]


def test_draft_tickets_are_not_listed_for_custom_asset_type(client, db):
    _seed_masters(db)
    admin_headers, _ = _make_user(db, client, "yade_draft_admin", CONFIG_PERMS, all_locations=True)
    assert _map_barge_module(client, admin_headers).status_code == 200
    viewer_headers, _ = _make_user(db, client, "yade_draft_viewer", BARGE_PERMS, all_locations=True)

    _add_ticket(db, number="YADE-DRAFT-1", convoy="CNV-YADE-DRAFT", status="Draft")
    _add_ticket(db, number="YADE-DRAFT-2", convoy="CNV-YADE-DRAFT", status="Submitted")
    db.commit()

    data = client.get("/barge-trip/voyages?tab=OPEN", headers=viewer_headers).json()
    assert data["rows"] == []


# ---------------------------------------------------------------------------
# 3. Convoy tracker + timeline
# ---------------------------------------------------------------------------

def test_convoy_tracker_and_timeline_for_custom_asset_type(client, db):
    _seed_masters(db)
    admin_headers, _ = _make_user(db, client, "yade_timeline_admin", CONFIG_PERMS, all_locations=True)
    assert _map_barge_module(client, admin_headers).status_code == 200
    viewer_headers, _ = _make_user(db, client, "yade_timeline_viewer", BARGE_PERMS, all_locations=True)

    tx = _add_ticket(db, number="YADE-TL-1", convoy="CNV-YADE-TL")
    db.commit()

    tracker = client.get(
        f"/barge-trip/convoy-tracker?convoy_number={tx.convoy_number}", headers=viewer_headers
    )
    assert tracker.status_code == 200, tracker.text
    body = tracker.json()
    assert body["total_tickets"] == 1
    assert body["assets"][0]["asset_code"] == ASSET_CODE
    ticket = body["assets"][0]["tickets"][0]
    assert ticket["transaction_id"] == tx.id
    assert ticket["movement_role"] == "SENDER"
    assert ticket["tracking_stage"] == "LOAD_1"

    timeline = client.get(
        f"/barge-trip/trips/by-convoy/{tx.convoy_number}", headers=viewer_headers
    )
    assert timeline.status_code == 200, timeline.text
    timeline_body = timeline.json()
    assert timeline_body["trip"]["convoy_number"] == tx.convoy_number
    assert [event["event_type"] for event in timeline_body["events"]] == ["LOAD_1"]
    assert timeline_body["events"][0]["operation_transaction_id"] == tx.id


def test_trip_is_created_on_approval_for_custom_asset_type(client, db):
    """
    The Approval hook must recognise the ticket as a barge ticket so the trip
    row and its timeline event exist before the user opens Barge Tracking.
    """
    from app.routers.operation_transactions import auto_create_barge_tracking_on_approval

    _seed_masters(db)
    admin_headers, _ = _make_user(db, client, "yade_hook_admin", CONFIG_PERMS, all_locations=True)
    assert _map_barge_module(client, admin_headers).status_code == 200
    _, admin_user = _make_user(db, client, "yade_hook_admin_2", CONFIG_PERMS, all_locations=True)

    tx = _add_ticket(db, number="YADE-HOOK-1", convoy="CNV-YADE-HOOK")
    db.commit()

    trip, event, _comparison = auto_create_barge_tracking_on_approval(db, tx, admin_user)
    db.commit()

    assert trip is not None
    assert event is not None
    assert trip.convoy_number == "CNV-YADE-HOOK"
    assert event.event_type == "LOAD_1"
