"""
Tracking Module Configuration + sender/receiver linked tickets (barge).

Covers the flow the product owner asked for:
  1. Admin maps Barge Tracking operation types (SENDER / RECEIVER). No stage is
     configured: the barge stage is captured on the ticket (barge_event_type).
  2. Sender location approves a LOAD ticket -> convoy shows under OPEN voyages
     for the receiving location.
  3. Receiver acknowledges receipt, creates a linked UNLOAD ticket. Origin,
     destination, sender and receiver are inherited from the sender ticket.
  4. Receiver ticket approval creates the barge comparison and the trip can be closed.
  5. Unconfigured operation types are not captured while a module is configured;
     legacy behaviour applies while no configuration exists.
"""

from app.models import (
    Asset,
    AssetType,
    Location,
    LocationOperationAvailability,
    OperationTemplate,
    OperationTemplateField,
    OperationTransaction,
    OperationType,
    Trip,
    TripComparison,
)
from tests.test_barge_end_to_end_approval import MULTI_TANK_PAYLOAD, _make_user

CONVOY = "CNV-CFG-001"

SENDER_PERMS = [
    "Create Operation Entry",
    "Submit Operation Transaction",
    "Review Operation Transaction",
    "View Operation Transaction",
    "View Barge Tracking",
    "Edit Barge Tracking",
    "Edit Operation Entry",
]
RECEIVER_PERMS = SENDER_PERMS
APPROVER_PERMS = [
    "Approve Operation Transaction",
    "Review Operation Transaction",
    "View Operation Transaction",
    "View Barge Tracking",
    "Edit Barge Tracking",
    "Close Barge Movement",
    "Reopen Barge Movement",
]
CONFIG_PERMS = [
    "View Tracking Module Configuration",
    "Create Tracking Module Configuration",
    "Edit Tracking Module Configuration",
    "Delete Tracking Module Configuration",
]


def _seed(db, with_unused_barge_type=True):
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

    op_types = [
        OperationType(
            operation_type_code="BARGE_LOAD",
            operation_type_name="Barge Loading",
            applicable_asset_type_code="BARGE",
            operation_category="Movement",
            requires_sender_location="No",
            requires_receiver_location="No",
            status="Active",
        ),
        OperationType(
            operation_type_code="BARGE_UNLOAD",
            operation_type_name="Barge Unloading",
            applicable_asset_type_code="BARGE",
            operation_category="Movement",
            requires_sender_location="No",
            requires_receiver_location="No",
            status="Active",
        ),
    ]
    if with_unused_barge_type:
        op_types.append(
            OperationType(
                operation_type_code="BARGE_TRANSFER",
                operation_type_name="Barge Transfer (not tracked)",
                applicable_asset_type_code="BARGE",
                operation_category="Movement",
                requires_sender_location="No",
                requires_receiver_location="No",
                status="Active",
            )
        )
    db.add_all(op_types)
    db.flush()

    for op_code in ["BARGE_LOAD", "BARGE_UNLOAD"] + (["BARGE_TRANSFER"] if with_unused_barge_type else []):
        for loc in ["AGGE", "UTP"]:
            db.add(
                LocationOperationAvailability(
                    location_code=loc, operation_type_code=op_code, status="Active"
                )
            )

    templates = {}
    for op_code, name in [("BARGE_LOAD", "Barge Load"), ("BARGE_UNLOAD", "Barge Unload"),
                          ("BARGE_TRANSFER", "Barge Transfer")]:
        if op_code == "BARGE_TRANSFER" and not with_unused_barge_type:
            continue
        template = OperationTemplate(
            template_name=f"{name} Multi-Tank",
            operation_type_code=op_code,
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
        templates[op_code] = template
    db.commit()
    return templates


def _entry_payload(template_id, op_code, convoy=CONVOY, origin="AGGE", destination="UTP",
                   sender=None, receiver=None, linked_ticket_id=None, event_type="LOAD_1"):
    payload = {
        "operation_template_id": template_id,
        "transaction": {
            "operation_type_code": op_code,
            "primary_asset_code": "BARGE_01",
            "convoy_number": convoy,
            "origin_location_code": origin,
            "destination_location_code": destination,
            "sender_location_code": sender,
            "receiver_location_code": receiver,
            "operation_date": "2026-10-10",
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


def _create_and_approve_sender(client, template, sender_headers, approver_headers, convoy=CONVOY):
    created = client.post(
        "/operation-entries",
        json=_entry_payload(template.id, "BARGE_LOAD", convoy=convoy, origin="AGGE",
                            destination="UTP", sender="AGGE", event_type="LOAD_1"),
        headers=sender_headers,
    )
    assert created.status_code == 200, created.text
    tx_id = created.json()["transaction"]["id"]
    _advance(client, tx_id, sender_headers, "Submitted")
    _advance(client, tx_id, approver_headers, "Approved")
    return tx_id


def _open_voyage_convoys(client, headers):
    res = client.get("/barge-trip/voyages?tab=OPEN", headers=headers)
    assert res.status_code == 200, res.text
    return [row["convoy_number"] for row in res.json()["rows"]]


def _acknowledge(client, headers, convoy=CONVOY, asset="BARGE_01", location="UTP"):
    res = client.post(
        "/barge-trip/trip-events",
        json={
            "convoy_number": convoy,
            "event_type": "RECEIVED",
            "location_code": location,
            "asset_code": asset,
            "operation_transaction_id": None,
            "remarks": "Receiver acknowledged receipt",
        },
        headers=headers,
    )
    assert res.status_code in (200, 201), res.text
    return res


def _config(client, headers, module, op_code, role, extra=None):
    payload = {
        "module_code": module,
        "operation_type_code": op_code,
        "movement_role": role,
        "status": "Active",
    }
    payload.update(extra or {})
    return client.post(
        "/tracking-module-configs",
        json=payload,
        headers=headers,
    )


def _configure_barge(client, admin_headers):
    res = _config(client, admin_headers, "BARGE", "BARGE_LOAD", "SENDER")
    assert res.status_code == 200, res.text
    res = _config(client, admin_headers, "BARGE", "BARGE_UNLOAD", "RECEIVER")
    assert res.status_code == 200, res.text


# ---------------------------------------------------------------------------
# Configuration module
# ---------------------------------------------------------------------------

def test_config_catalog_and_validation(client, db):
    _seed(db)
    admin_headers, _ = _make_user(db, client, "cfg_admin", CONFIG_PERMS, all_locations=True)

    catalog = client.get("/tracking-module-configs/catalog", headers=admin_headers)
    assert catalog.status_code == 200, catalog.text
    body = catalog.text
    assert "BARGE_LOAD" in body and "BARGE_UNLOAD" in body

    catalog_body = catalog.json()
    # The barge stage is not configured here any more: the stage belongs to the
    # ticket (barge_event_type value) so one operation type serves both sides.
    assert "stages" not in catalog_body
    assert [role["code"] for role in catalog_body["roles"]] == ["SENDER", "RECEIVER"]

    ok = _config(client, admin_headers, "BARGE", "BARGE_LOAD", "SENDER")
    assert ok.status_code == 200, ok.text
    assert ok.json()["module_label"]
    assert ok.json()["operation_type_name"] == "Barge Loading"
    assert "tracking_stage" not in ok.json()

    dup = _config(client, admin_headers, "BARGE", "BARGE_LOAD", "SENDER")
    assert dup.status_code == 400, dup.text

    unknown_op = _config(client, admin_headers, "BARGE", "NOPE", "SENDER")
    assert unknown_op.status_code == 400, unknown_op.text

    listed = client.get("/tracking-module-configs", headers=admin_headers)
    assert listed.status_code == 200, listed.text
    assert len(listed.json()) == 1

    config_id = ok.json()["id"]
    updated = client.put(
        f"/tracking-module-configs/{config_id}",
        json={"module_code": "BARGE", "operation_type_code": "BARGE_LOAD",
              "movement_role": "SENDER", "status": "Inactive",
              "tracking_stage": "LOAD_1"},  # legacy field sent by old clients is ignored
        headers=admin_headers,
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["status"] == "Inactive"
    assert "tracking_stage" not in updated.json()

    deleted = client.delete(f"/tracking-module-configs/{config_id}", headers=admin_headers)
    assert deleted.status_code in (200, 204), deleted.text


def test_config_requires_permission(client, db):
    _seed(db)
    headers, _ = _make_user(db, client, "cfg_viewer_none", ["View Barge Tracking"], all_locations=True)
    res = _config(client, headers, "BARGE", "BARGE_LOAD", "SENDER")
    assert res.status_code == 403, res.text


# ---------------------------------------------------------------------------
# Full sender -> receiver -> comparison flow
# ---------------------------------------------------------------------------

def test_sender_receiver_linked_ticket_flow(client, db):
    templates = _seed(db)
    admin_headers, _ = _make_user(db, client, "flow_admin", CONFIG_PERMS + APPROVER_PERMS, all_locations=True)
    _configure_barge(client, admin_headers)

    sender_headers, _ = _make_user(db, client, "flow_sender", SENDER_PERMS,
                                   all_locations=False, locations=["AGGE"])
    receiver_headers, _ = _make_user(db, client, "flow_receiver", RECEIVER_PERMS,
                                     all_locations=False, locations=["UTP"])
    approver_headers, _ = _make_user(db, client, "flow_approver", APPROVER_PERMS, all_locations=True)

    # 1. sender approves a LOAD ticket
    sender_tx_id = _create_and_approve_sender(
        client, templates["BARGE_LOAD"], sender_headers, approver_headers
    )

    # 2. receiver sees it under Open Voyages (destination UTP in scope)
    assert CONVOY in _open_voyage_convoys(client, receiver_headers)

    tracker = client.get(f"/barge-trip/convoy-tracker?convoy_number={CONVOY}", headers=receiver_headers)
    assert tracker.status_code == 200, tracker.text
    ticket = tracker.json()["assets"][0]["tickets"][0]
    assert ticket["transaction_id"] == sender_tx_id
    assert ticket["movement_role"] == "SENDER"
    assert ticket["receiver_transaction_id"] is None

    # 3. the entry form loads the sender ticket and the receiving op types
    info = client.get(f"/operation-entries/linked-sender/{sender_tx_id}", headers=receiver_headers)
    assert info.status_code == 200, info.text
    info_json = info.json()
    # receiving terminal (sender's destination) becomes the receiver ticket origin
    assert info_json["origin_location_code"] == "UTP"
    assert info_json["destination_location_code"] == "UTP"
    assert info_json["sender_location_code"] == "AGGE"
    # Barge Tracking uses one operation type per movement side, so every Active
    # mapping of the module may be used by the receiver (the link decides the
    # receiving side). No stage is part of the mapping.
    assert sorted(
        op["operation_type_code"] for op in info_json["receiver_operation_types"]
    ) == ["BARGE_LOAD", "BARGE_UNLOAD"]
    assert all("tracking_stage" not in op for op in info_json["receiver_operation_types"])

    # 4. receiver must acknowledge receipt before creating the linked ticket
    early = client.post(
        "/operation-entries",
        json=_entry_payload(templates["BARGE_UNLOAD"].id, "BARGE_UNLOAD", origin="UTP",
                            destination="UTP", linked_ticket_id=sender_tx_id, event_type="UNLOAD"),
        headers=receiver_headers,
    )
    assert early.status_code == 400, early.text
    assert "Acknowledge receipt" in early.text

    _acknowledge(client, receiver_headers)

    # 5. linked receiver ticket: the client sends wrong locations and the server inherits them
    created = client.post(
        "/operation-entries",
        json=_entry_payload(templates["BARGE_UNLOAD"].id, "BARGE_UNLOAD", origin="AGGE",
                            destination="AGGE", sender="UTP", receiver="AGGE",
                            linked_ticket_id=sender_tx_id, event_type="UNLOAD"),
        headers=receiver_headers,
    )
    assert created.status_code == 200, created.text
    recv = created.json()
    recv_tx = recv["transaction"]
    assert recv["linked_ticket_id"] == sender_tx_id
    assert recv_tx["origin_location_code"] == "UTP"
    assert recv_tx["destination_location_code"] == "UTP"
    assert recv_tx["sender_location_code"] == "AGGE"
    assert recv_tx["receiver_location_code"] == "UTP"
    assert recv_tx["convoy_number"] == CONVOY
    assert recv_tx["primary_asset_code"] == "BARGE_01"
    assert "linked_ticket_id" not in [v["field_code"] for v in recv["values"]]
    recv_tx_id = recv_tx["id"]

    # a second receiver ticket for the same sender is refused
    dup = client.post(
        "/operation-entries",
        json=_entry_payload(templates["BARGE_UNLOAD"].id, "BARGE_UNLOAD", linked_ticket_id=sender_tx_id,
                            event_type="UNLOAD"),
        headers=receiver_headers,
    )
    assert dup.status_code == 400, dup.text

    # 6. receiver submits and approver approves -> comparison is created
    _advance(client, recv_tx_id, receiver_headers, "Submitted")
    _advance(client, recv_tx_id, approver_headers, "Approved")

    tracker = client.get(f"/barge-trip/convoy-tracker?convoy_number={CONVOY}", headers=receiver_headers)
    assert tracker.status_code == 200, tracker.text
    tickets = {t["transaction_id"]: t for t in tracker.json()["assets"][0]["tickets"]}
    assert tickets[sender_tx_id]["receiver_transaction_id"] == recv_tx_id
    assert tickets[recv_tx_id]["linked_sender_transaction_id"] == sender_tx_id
    assert tickets[recv_tx_id]["movement_role"] == "RECEIVER"

    trip = db.query(Trip).filter(Trip.convoy_number == CONVOY).first()
    assert trip is not None
    comparisons = db.query(TripComparison).filter(TripComparison.trip_id == trip.id).all()
    assert comparisons, "comparison should be created after the linked receiver ticket is approved"

    # 7. timeline by convoy shows the receiver's stage
    timeline = client.get(f"/barge-trip/trips/by-convoy/{CONVOY}", headers=approver_headers)
    assert timeline.status_code == 200, timeline.text
    event_types = [e["event_type"] for e in timeline.json()["events"]]
    assert "UNLOAD" in event_types

    # 8. the trip can be closed now that both sides are approved and compared
    closed = client.post(
        f"/barge-trip/trips/{trip.id}/close",
        json={"remarks": "done"},
        headers=approver_headers,
    )
    assert closed.status_code == 200, closed.text


def test_receiver_draft_edit_keeps_link_and_locations(client, db):
    templates = _seed(db)
    admin_headers, _ = _make_user(db, client, "edit_admin", CONFIG_PERMS + APPROVER_PERMS, all_locations=True)
    _configure_barge(client, admin_headers)
    sender_headers, _ = _make_user(db, client, "edit_sender", SENDER_PERMS, all_locations=False, locations=["AGGE"])
    receiver_headers, _ = _make_user(db, client, "edit_receiver", RECEIVER_PERMS, all_locations=False, locations=["UTP"])
    approver_headers, _ = _make_user(db, client, "edit_approver", APPROVER_PERMS, all_locations=True)

    sender_tx_id = _create_and_approve_sender(client, templates["BARGE_LOAD"], sender_headers, approver_headers)
    _acknowledge(client, receiver_headers)

    created = client.post(
        "/operation-entries",
        json=_entry_payload(templates["BARGE_UNLOAD"].id, "BARGE_UNLOAD", linked_ticket_id=sender_tx_id,
                            event_type="UNLOAD"),
        headers=receiver_headers,
    )
    assert created.status_code == 200, created.text
    recv_tx_id = created.json()["transaction"]["id"]

    # the edit form does not resend linked_ticket_id; the link must survive
    edited = client.put(
        f"/operation-entries/{recv_tx_id}",
        json=_entry_payload(templates["BARGE_UNLOAD"].id, "BARGE_UNLOAD", origin="AGGE",
                            destination="AGGE", sender="UTP", receiver="UTP",
                            event_type="UNLOAD"),
        headers=receiver_headers,
    )
    assert edited.status_code == 200, edited.text
    body = edited.json()
    assert body["linked_ticket_id"] == sender_tx_id
    assert body["transaction"]["origin_location_code"] == "UTP"
    assert body["transaction"]["sender_location_code"] == "AGGE"


def test_link_rejects_unapproved_and_wrong_sender(client, db):
    templates = _seed(db)
    admin_headers, _ = _make_user(db, client, "rej_admin", CONFIG_PERMS + APPROVER_PERMS, all_locations=True)
    _configure_barge(client, admin_headers)
    sender_headers, _ = _make_user(db, client, "rej_sender", SENDER_PERMS, all_locations=False, locations=["AGGE"])
    receiver_headers, _ = _make_user(db, client, "rej_receiver", RECEIVER_PERMS, all_locations=False, locations=["UTP"])
    approver_headers, _ = _make_user(db, client, "rej_approver", APPROVER_PERMS, all_locations=True)

    draft = client.post(
        "/operation-entries",
        json=_entry_payload(templates["BARGE_LOAD"].id, "BARGE_LOAD", sender="AGGE"),
        headers=sender_headers,
    )
    assert draft.status_code == 200, draft.text
    draft_id = draft.json()["transaction"]["id"]

    _acknowledge(client, receiver_headers)
    not_approved = client.post(
        "/operation-entries",
        json=_entry_payload(templates["BARGE_UNLOAD"].id, "BARGE_UNLOAD", linked_ticket_id=draft_id,
                            event_type="UNLOAD"),
        headers=receiver_headers,
    )
    assert not_approved.status_code == 400, not_approved.text

    sender_tx_id = _create_and_approve_sender(client, templates["BARGE_LOAD"], sender_headers, approver_headers)
    wrong_convoy = client.post(
        "/operation-entries",
        json=_entry_payload(templates["BARGE_UNLOAD"].id, "BARGE_UNLOAD", convoy="CNV-OTHER",
                            linked_ticket_id=sender_tx_id, event_type="UNLOAD"),
        headers=receiver_headers,
    )
    assert wrong_convoy.status_code == 400, wrong_convoy.text

    # a receiver ticket cannot itself be linked as a sender
    _advance_ok = client.post(
        "/operation-entries",
        json=_entry_payload(templates["BARGE_UNLOAD"].id, "BARGE_UNLOAD", linked_ticket_id=sender_tx_id,
                            event_type="UNLOAD"),
        headers=receiver_headers,
    )
    assert _advance_ok.status_code == 200, _advance_ok.text
    recv_id = _advance_ok.json()["transaction"]["id"]
    chained = client.post(
        "/operation-entries",
        json=_entry_payload(templates["BARGE_UNLOAD"].id, "BARGE_UNLOAD", linked_ticket_id=recv_id,
                            event_type="UNLOAD"),
        headers=receiver_headers,
    )
    assert chained.status_code == 400, chained.text


def test_unconfigured_operation_type_is_not_captured(client, db):
    templates = _seed(db)
    admin_headers, _ = _make_user(db, client, "cap_admin", CONFIG_PERMS + APPROVER_PERMS, all_locations=True)
    _configure_barge(client, admin_headers)  # BARGE_TRANSFER is not configured
    sender_headers, _ = _make_user(db, client, "cap_sender", SENDER_PERMS, all_locations=False, locations=["AGGE"])
    approver_headers, _ = _make_user(db, client, "cap_approver", APPROVER_PERMS, all_locations=True)

    created = client.post(
        "/operation-entries",
        json=_entry_payload(templates["BARGE_TRANSFER"].id, "BARGE_TRANSFER", convoy="CNV-NOT-TRACKED",
                            sender="AGGE", event_type="OTHER"),
        headers=sender_headers,
    )
    assert created.status_code == 200, created.text
    tx_id = created.json()["transaction"]["id"]
    _advance(client, tx_id, sender_headers, "Submitted")
    _advance(client, tx_id, approver_headers, "Approved")

    assert "CNV-NOT-TRACKED" not in _open_voyage_convoys(client, approver_headers)


def test_without_configuration_legacy_barge_rule_applies(client, db):
    templates = _seed(db)
    sender_headers, _ = _make_user(db, client, "leg_sender", SENDER_PERMS, all_locations=False, locations=["AGGE"])
    approver_headers, _ = _make_user(db, client, "leg_approver", APPROVER_PERMS, all_locations=True)

    created = client.post(
        "/operation-entries",
        json=_entry_payload(templates["BARGE_LOAD"].id, "BARGE_LOAD", convoy="CNV-LEGACY", sender="AGGE"),
        headers=sender_headers,
    )
    assert created.status_code == 200, created.text
    tx_id = created.json()["transaction"]["id"]
    _advance(client, tx_id, sender_headers, "Submitted")
    _advance(client, tx_id, approver_headers, "Approved")

    assert "CNV-LEGACY" in _open_voyage_convoys(client, approver_headers)
