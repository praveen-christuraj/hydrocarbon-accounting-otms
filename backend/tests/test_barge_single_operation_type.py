"""
Barge Tracking with ONE operation type per movement (reported case: BARGE_MOVE).

The reported installation maps its single barge operation type - BARGE_MOVE -
to Barge Tracking and uses it on both sides of the movement: the loading
terminal approves the sender ticket, the receiving terminal acknowledges the
barge and creates its receiving ticket against that approved sender ticket with
the *same* operation type. The receiver used to be refused with

    "Operation type BARGE_MOVE is not configured as a receiver operation for
     Barge Tracking. Select the configured receiving operation type."

because the module asked for a separate RECEIVER mapping (and a barge stage per
mapping) - exactly like Tanker Tracking, which has two operation types.

These tests pin the fixed behaviour:

  * Tracking Module Configuration no longer contains a Barge Stage: the stage is
    captured on the ticket (``barge_event_type``), so one operation type works
    with every stage from every location.
  * Every Active barge mapping may be used by the receiver; the ticket link -
    not the configured role - identifies the receiving side.
  * Tanker Tracking keeps its two-operation-type rule (TANKER kind).
"""

from app.models import (
    Asset,
    AssetType,
    Location,
    LocationOperationAvailability,
    OperationTemplate,
    OperationTemplateField,
    OperationTransactionValue,
    OperationType,
    Trip,
    TripComparison,
    TripEvent,
)
from tests.test_barge_end_to_end_approval import MULTI_TANK_PAYLOAD, _make_user

CONVOY = "CNV-BARGE-MOVE-1"
OPERATION_TYPE = "BARGE_MOVE"
ASSET_TYPE = "YADE"
ASSET_CODE = "YADE-01"

CONFIG_PERMS = [
    "View Tracking Module Configuration",
    "Create Tracking Module Configuration",
    "Edit Tracking Module Configuration",
    "Delete Tracking Module Configuration",
]
BARGE_PERMS = [
    "Create Operation Entry",
    "Edit Operation Entry",
    "Submit Operation Transaction",
    "Review Operation Transaction",
    "View Operation Transaction",
    "View Barge Tracking",
    "Edit Barge Tracking",
]
APPROVER_PERMS = [
    "Approve Operation Transaction",
    "Review Operation Transaction",
    "View Operation Transaction",
    "View Barge Tracking",
    "Edit Barge Tracking",
    "Close Barge Movement",
    "Reopen Barge Movement",
]


def _seed(db, extra_operation_type=None):
    """Locations, the custom barge asset type/asset and the barge operation type."""
    db.add_all(
        [
            Location(location_code="AGGE", location_name="Agge", location_type="Terminal", status="Active"),
            Location(location_code="LEKKI", location_name="Lekki", location_type="Terminal", status="Active"),
            AssetType(asset_type_code=ASSET_TYPE, asset_type_name="YADE", status="Active"),
        ]
    )
    db.flush()
    db.add(
        Asset(
            asset_code=ASSET_CODE,
            asset_name="Yade One",
            asset_type_code=ASSET_TYPE,
            asset_scope="Global",
            status="Active",
        )
    )
    db.flush()

    operation_types = [
        OperationType(
            operation_type_code=OPERATION_TYPE,
            operation_type_name="Barge Move",
            applicable_asset_type_code=ASSET_TYPE,
            operation_category="Movement",
            requires_sender_location="No",
            requires_receiver_location="No",
            status="Active",
        )
    ]
    if extra_operation_type:
        operation_types.append(
            OperationType(
                operation_type_code=extra_operation_type,
                operation_type_name="Barge Move (not tracked)",
                applicable_asset_type_code=ASSET_TYPE,
                operation_category="Movement",
                requires_sender_location="No",
                requires_receiver_location="No",
                status="Active",
            )
        )
    db.add_all(operation_types)
    db.flush()

    codes = [OPERATION_TYPE] + ([extra_operation_type] if extra_operation_type else [])
    for code in codes:
        for location in ["AGGE", "LEKKI"]:
            db.add(
                LocationOperationAvailability(
                    location_code=location, operation_type_code=code, status="Active"
                )
            )

    templates = {}
    for code in codes:
        template = OperationTemplate(
            template_name=f"Barge Multi-Tank {code}",
            operation_type_code=code,
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
        templates[code] = template
    db.commit()
    return templates


def _entry_payload(template_id, op_code, *, convoy=CONVOY, origin="AGGE", destination="LEKKI",
                   sender="AGGE", receiver="LEKKI", linked_ticket_id=None, event_type="LOAD_1"):
    payload = {
        "operation_template_id": template_id,
        "transaction": {
            "operation_type_code": op_code,
            "primary_asset_code": ASSET_CODE,
            "convoy_number": convoy,
            "origin_location_code": origin,
            "destination_location_code": destination,
            "sender_location_code": sender,
            "receiver_location_code": receiver,
            "operation_date": "2026-10-12",
            "operation_start_datetime": None,
            "operation_end_datetime": None,
            "product_name": "Crude Oil",
            "created_by": None,
            "remarks": None,
            "status": "Draft",
        },
        "values": [
            {"field_code": "multi_tank_payload", "field_value": MULTI_TANK_PAYLOAD},
            {"field_code": "barge_event_type", "field_value": event_type},
        ],
    }
    if linked_ticket_id is not None:
        payload["linked_ticket_id"] = linked_ticket_id
    return payload


def _advance(client, tx_id, headers, status):
    res = client.patch(
        f"/operation-transactions/{tx_id}/status",
        json={"status": status, "remarks": status, "review_confirmed": True},
        headers=headers,
    )
    assert res.status_code == 200, res.text
    return res


def _configure_barge_single_type(client, admin_headers, op_code=OPERATION_TYPE, role="SENDER"):
    """One mapping - no stage - for the single barge operation type."""
    return client.post(
        "/tracking-module-configs",
        json={
            "module_code": "BARGE",
            "operation_type_code": op_code,
            "movement_role": role,
            "status": "Active",
        },
        headers=admin_headers,
    )


def _approve_sender_ticket(client, template, sender_headers, approver_headers):
    created = client.post(
        "/operation-entries",
        json=_entry_payload(template.id, OPERATION_TYPE, event_type="LOAD_1"),
        headers=sender_headers,
    )
    assert created.status_code == 200, created.text
    tx_id = created.json()["transaction"]["id"]
    _advance(client, tx_id, sender_headers, "Submitted")
    _advance(client, tx_id, approver_headers, "Approved")
    return tx_id


def _acknowledge(client, headers, location="LEKKI"):
    res = client.post(
        "/barge-trip/trip-events",
        json={
            "convoy_number": CONVOY,
            "event_type": "RECEIVED",
            "location_code": location,
            "asset_code": ASSET_CODE,
            "operation_transaction_id": None,
            "remarks": "Receiver acknowledged receipt",
        },
        headers=headers,
    )
    assert res.status_code in (200, 201), res.text
    return res


# ---------------------------------------------------------------------------
# 1. Configuration: operation type only, no barge stage
# ---------------------------------------------------------------------------

def test_single_operation_type_is_mapped_without_a_stage(client, db):
    _seed(db)
    admin_headers, _ = _make_user(db, client, "single_cfg", CONFIG_PERMS, all_locations=True)

    catalog = client.get("/tracking-module-configs/catalog", headers=admin_headers)
    assert catalog.status_code == 200, catalog.text
    assert "stages" not in catalog.json()

    mapped = _configure_barge_single_type(client, admin_headers)
    assert mapped.status_code == 200, mapped.text
    body = mapped.json()
    assert body["module_code"] == "BARGE"
    assert body["operation_type_code"] == OPERATION_TYPE
    assert body["movement_role"] == "SENDER"
    assert "tracking_stage" not in body


# ---------------------------------------------------------------------------
# 2. The reported flow: receiver uses the sender's operation type
# ---------------------------------------------------------------------------

def test_receiver_can_use_the_sender_operation_type(client, db):
    templates = _seed(db)
    admin_headers, _ = _make_user(
        db, client, "single_admin", CONFIG_PERMS + APPROVER_PERMS, all_locations=True
    )
    assert _configure_barge_single_type(client, admin_headers).status_code == 200

    sender_headers, _ = _make_user(
        db, client, "single_sender", BARGE_PERMS, all_locations=False, locations=["AGGE"]
    )
    receiver_headers, _ = _make_user(
        db, client, "single_receiver", BARGE_PERMS, all_locations=False, locations=["LEKKI"]
    )
    approver_headers, _ = _make_user(
        db, client, "single_approver", APPROVER_PERMS, all_locations=True
    )

    # 1. the sending terminal approves the barge ticket (sent by YADE-01)
    sender_tx_id = _approve_sender_ticket(
        client, templates[OPERATION_TYPE], sender_headers, approver_headers
    )

    # 2. the receiving terminal opens the receiving-ticket form: the sender's
    #    own operation type must be offered (previously the form/validation
    #    demanded a separately mapped RECEIVER operation type)
    info = client.get(
        f"/operation-entries/linked-sender/{sender_tx_id}", headers=receiver_headers
    )
    assert info.status_code == 200, info.text
    info_json = info.json()
    assert info_json["module_code"] == "BARGE"
    assert [op["operation_type_code"] for op in info_json["receiver_operation_types"]] == [
        OPERATION_TYPE
    ]
    # the receiving terminal becomes the origin of the receiver ticket
    assert info_json["origin_location_code"] == "LEKKI"
    assert info_json["sender_location_code"] == "AGGE"

    # 3. the receiver must acknowledge the barge before creating his ticket
    early = client.post(
        "/operation-entries",
        json=_entry_payload(
            templates[OPERATION_TYPE].id, OPERATION_TYPE,
            origin="LEKKI", destination="LEKKI", sender="LEKKI", receiver="LEKKI",
            linked_ticket_id=sender_tx_id, event_type="UNLOAD",
        ),
        headers=receiver_headers,
    )
    assert early.status_code == 400, early.text
    assert "Acknowledge receipt" in early.text

    _acknowledge(client, receiver_headers)

    # 4. the receiving ticket uses the SAME operation type (the reported 400)
    created = client.post(
        "/operation-entries",
        json=_entry_payload(
            templates[OPERATION_TYPE].id, OPERATION_TYPE,
            origin="LEKKI", destination="LEKKI", sender="LEKKI", receiver="LEKKI",
            linked_ticket_id=sender_tx_id, event_type="UNLOAD",
        ),
        headers=receiver_headers,
    )
    assert created.status_code == 200, created.text
    receiver_tx = created.json()["transaction"]
    receiver_tx_id = receiver_tx["id"]
    assert created.json()["linked_ticket_id"] == sender_tx_id
    assert receiver_tx["operation_type_code"] == OPERATION_TYPE
    assert receiver_tx["origin_location_code"] == "LEKKI"
    assert receiver_tx["sender_location_code"] == "AGGE"
    assert receiver_tx["convoy_number"] == CONVOY
    assert receiver_tx["primary_asset_code"] == ASSET_CODE

    # 5. the receiving ticket is approved -> comparison + UNLOAD timeline event
    _advance(client, receiver_tx_id, receiver_headers, "Submitted")
    _advance(client, receiver_tx_id, approver_headers, "Approved")

    trip = db.query(Trip).filter(Trip.convoy_number == CONVOY).first()
    assert trip is not None
    comparisons = db.query(TripComparison).filter(TripComparison.trip_id == trip.id).all()
    assert comparisons, "the receiving ticket must be compared with its sender ticket"

    event_types = {
        event.operation_transaction_id: event.event_type
        for event in db.query(TripEvent).filter(TripEvent.trip_id == trip.id).all()
    }
    assert event_types[sender_tx_id] == "LOAD_1"
    assert event_types[receiver_tx_id] == "UNLOAD"

    # 6. the convoy tracker tells the two sides apart by the link, not by the
    #    (identical) operation type
    tracker = client.get(
        f"/barge-trip/convoy-tracker?convoy_number={CONVOY}", headers=approver_headers
    )
    assert tracker.status_code == 200, tracker.text
    tickets = {
        ticket["transaction_id"]: ticket
        for ticket in tracker.json()["assets"][0]["tickets"]
    }
    assert tickets[sender_tx_id]["movement_role"] == "SENDER"
    assert tickets[sender_tx_id]["receiver_transaction_id"] == receiver_tx_id
    assert tickets[receiver_tx_id]["movement_role"] == "RECEIVER"
    assert tickets[receiver_tx_id]["linked_sender_transaction_id"] == sender_tx_id

    # 7. the receiving ticket is never itself a sender ticket
    chained = client.post(
        "/operation-entries",
        json=_entry_payload(
            templates[OPERATION_TYPE].id, OPERATION_TYPE,
            linked_ticket_id=receiver_tx_id, event_type="UNLOAD",
        ),
        headers=receiver_headers,
    )
    assert chained.status_code == 400, chained.text
    assert "receiving ticket" in chained.text


def test_untracked_operation_type_is_still_refused_for_the_receiver(client, db):
    """An operation type that is not mapped to Barge Tracking cannot be received."""
    templates = _seed(db, extra_operation_type="BARGE_OTHER")
    admin_headers, _ = _make_user(
        db, client, "other_admin", CONFIG_PERMS + APPROVER_PERMS, all_locations=True
    )
    assert _configure_barge_single_type(client, admin_headers).status_code == 200

    sender_headers, _ = _make_user(
        db, client, "other_sender", BARGE_PERMS, all_locations=False, locations=["AGGE"]
    )
    receiver_headers, _ = _make_user(
        db, client, "other_receiver", BARGE_PERMS, all_locations=False, locations=["LEKKI"]
    )
    approver_headers, _ = _make_user(
        db, client, "other_approver", APPROVER_PERMS, all_locations=True
    )

    sender_tx_id = _approve_sender_ticket(
        client, templates[OPERATION_TYPE], sender_headers, approver_headers
    )
    _acknowledge(client, receiver_headers)

    refused = client.post(
        "/operation-entries",
        json=_entry_payload(
            templates["BARGE_OTHER"].id, "BARGE_OTHER",
            origin="LEKKI", destination="LEKKI", sender="LEKKI", receiver="LEKKI",
            linked_ticket_id=sender_tx_id, event_type="UNLOAD",
        ),
        headers=receiver_headers,
    )
    assert refused.status_code == 400, refused.text
    assert "is not mapped to Barge Tracking" in refused.text
    assert OPERATION_TYPE in refused.text


def test_receiver_ticket_without_a_stage_lands_as_unload(client, db):
    """
    The receiver may leave the stage of his ticket empty (the entry layout has
    its own dropdown). The receiving side of a linked ticket must never be
    recorded as a load on the timeline.
    """
    templates = _seed(db)
    admin_headers, _ = _make_user(
        db, client, "nostage_admin", CONFIG_PERMS + APPROVER_PERMS, all_locations=True
    )
    assert _configure_barge_single_type(client, admin_headers).status_code == 200

    sender_headers, _ = _make_user(
        db, client, "nostage_sender", BARGE_PERMS, all_locations=False, locations=["AGGE"]
    )
    receiver_headers, _ = _make_user(
        db, client, "nostage_receiver", BARGE_PERMS, all_locations=False, locations=["LEKKI"]
    )
    approver_headers, _ = _make_user(
        db, client, "nostage_approver", APPROVER_PERMS, all_locations=True
    )

    # the sender ticket also has no stage: it is the first load of the barge
    sender_tx_id = _approve_sender_ticket(
        client, templates[OPERATION_TYPE], sender_headers, approver_headers
    )
    _acknowledge(client, receiver_headers)

    payload = _entry_payload(
        templates[OPERATION_TYPE].id, OPERATION_TYPE,
        origin="LEKKI", destination="LEKKI", sender="LEKKI", receiver="LEKKI",
        linked_ticket_id=sender_tx_id,
    )
    payload["values"] = [
        {"field_code": "multi_tank_payload", "field_value": MULTI_TANK_PAYLOAD},
        {"field_code": "barge_event_type", "field_value": ""},
    ]
    created = client.post("/operation-entries", json=payload, headers=receiver_headers)
    assert created.status_code == 200, created.text
    receiver_tx_id = created.json()["transaction"]["id"]

    # the ticket really carries no stage
    stage_row = (
        db.query(OperationTransactionValue)
        .filter(
            OperationTransactionValue.transaction_id == receiver_tx_id,
            OperationTransactionValue.field_code == "barge_event_type",
        )
        .first()
    )
    assert stage_row is None or not str(stage_row.field_value or "").strip()

    _advance(client, receiver_tx_id, receiver_headers, "Submitted")
    _advance(client, receiver_tx_id, approver_headers, "Approved")

    trip = db.query(Trip).filter(Trip.convoy_number == CONVOY).first()
    event_type = (
        db.query(TripEvent)
        .filter(
            TripEvent.trip_id == trip.id,
            TripEvent.operation_transaction_id == receiver_tx_id,
        )
        .first()
        .event_type
    )
    assert event_type == "UNLOAD"

    # the ticket is dated for the receiving side (no accidental LOAD on the timeline)
    assert db.query(TripEvent).filter(
        TripEvent.trip_id == trip.id,
        TripEvent.operation_transaction_id == sender_tx_id,
        TripEvent.event_type == "LOAD_1",
    ).first() is not None
