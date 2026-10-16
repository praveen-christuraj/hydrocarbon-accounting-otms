"""
Access decision diagnostic (PERMISSION_CRITERIA_MODEL.md, section 7.3).

The endpoint is read-only: it composes the four criteria (permission, location
scope, operation availability, workflow policy) for one user and one ticket so
the Access Summary panel can explain an access decision without second-guessing
the enforcement path.
"""

from datetime import date

from app.models import (
    Location,
    LocationOperationAvailability,
    OperationTransaction,
    UserLocation,
    UserRole,
)
from tests.test_barge_voyages_and_fso_variance import _make_user


def _seed(db):
    db.add_all(
        [
            Location(location_code="AGGE", location_name="Agge", location_type="Terminal", status="Active"),
            Location(location_code="LEKKI", location_name="Lekki", location_type="Terminal", status="Active"),
            Location(location_code="PHC", location_name="Port Harcourt", location_type="Terminal", status="Active"),
            LocationOperationAvailability(
                location_code="AGGE", operation_type_code="BARGE_LOAD", status="Active"
            ),
        ]
    )
    db.flush()
    tx = OperationTransaction(
        operation_number="DIAG-1",
        operation_ticket_number="TKT-DIAG-1",
        operation_type_code="BARGE_LOAD",
        primary_asset_code="BARGE_01",
        primary_asset_type_code="BARGE",
        origin_location_code="AGGE",
        destination_location_code="LEKKI",
        sender_location_code="AGGE",
        receiver_location_code="LEKKI",
        operation_date=date(2026, 10, 12),
        status="Approved",
        created_by="tester",
    )
    db.add(tx)
    db.commit()
    return tx


def test_diagnostic_requires_view_access_summary(client, db):
    tx = _seed(db)
    headers, _ = _make_user(db, client, "diag_noperm", ["View Barge Tracking"], all_locations=True)

    response = client.get(
        f"/permissions/access-diagnostic?user_id=1&transaction_id={tx.id}", headers=headers
    )
    assert response.status_code == 403, response.text


def test_diagnostic_explains_party_scope_for_receiver(client, db):
    tx = _seed(db)
    viewer_headers, _ = _make_user(db, client, "diag_viewer", ["View Access Summary"], all_locations=True)
    _, receiver = _make_user(db, client, "diag_receiver", ["View Barge Tracking"], all_locations=False)
    db.add(UserLocation(user_id=receiver.id, location_code="LEKKI"))
    db.commit()

    response = client.get(
        f"/permissions/access-diagnostic?user_id={receiver.id}&transaction_id={tx.id}",
        headers=viewer_headers,
    )
    assert response.status_code == 200, response.text
    body = response.json()

    assert body["user"]["username"] == "diag_receiver"
    assert body["record"]["visible"] is True
    assert body["record"]["ticket_number"] == "TKT-DIAG-1"
    in_scope = {
        row["field"]: row["in_scope"] for row in body["record"]["party_locations"]
    }
    assert in_scope == {
        "origin_location_code": False,
        "destination_location_code": True,
        "sender_location_code": False,
        "receiver_location_code": True,
    }
    assert "party location" in body["record"]["reason"].lower()
    assert body["criteria"]["location_scope"]["assigned_location_codes"] == ["LEKKI"]
    assert body["criteria"]["operation_availability"] == {
        "location_code": "AGGE",
        "operation_type_code": "BARGE_LOAD",
        "available": True,
    }
    assert body["criteria"]["permission"]["is_admin"] is False
    assert "View Barge Tracking" in body["criteria"]["permission"]["permissions"]


def test_diagnostic_reports_invisible_third_party(client, db):
    tx = _seed(db)
    viewer_headers, _ = _make_user(db, client, "diag_viewer2", ["View Access Summary"], all_locations=True)
    _, stranger = _make_user(db, client, "diag_stranger", ["View Barge Tracking"], all_locations=False)
    db.add(UserLocation(user_id=stranger.id, location_code="PHC"))
    db.commit()

    response = client.get(
        f"/permissions/access-diagnostic?user_id={stranger.id}&transaction_id={tx.id}",
        headers=viewer_headers,
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["record"]["visible"] is False
    assert all(
        row["in_scope"] is False for row in body["record"]["party_locations"]
    )


def test_diagnostic_without_ticket_returns_scope_only(client, db):
    _seed(db)
    viewer_headers, _ = _make_user(db, client, "diag_viewer3", ["View Access Summary"], all_locations=True)
    _, all_access_user = _make_user(db, client, "diag_all_locations", ["View Barge Tracking"], all_locations=True)

    response = client.get(
        f"/permissions/access-diagnostic?user_id={all_access_user.id}", headers=viewer_headers
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["record"] is None
    assert body["criteria"]["location_scope"]["unrestricted"] is True


def test_diagnostic_unknown_user_and_ticket(client, db):
    _seed(db)
    viewer_headers, _ = _make_user(db, client, "diag_viewer4", ["View Access Summary"], all_locations=True)

    missing_user = client.get(
        "/permissions/access-diagnostic?user_id=9999", headers=viewer_headers
    )
    assert missing_user.status_code == 404

    missing_ticket = client.get(
        "/permissions/access-diagnostic?user_id=9999&transaction_id=9999", headers=viewer_headers
    )
    assert missing_ticket.status_code == 404


def test_diagnostic_evaluates_the_workflow_policy(client, db):
    """The optional workflow action uses the same policy evaluator as the API."""
    tx = _seed(db)
    viewer_headers, _ = _make_user(db, client, "diag_viewer5", ["View Access Summary"], all_locations=True)
    _, approver = _make_user(db, client, "diag_approver", ["Approve Operation Transaction"], all_locations=True)
    _, operator = _make_user(db, client, "diag_operator", ["Submit Operation Transaction"], all_locations=True)

    # No Active policy -> allowed is None: the write paths treat anything other
    # than an explicit False as "not restricted", so the diagnostic mirrors that.
    allowed_body = client.get(
        f"/permissions/access-diagnostic?user_id={operator.id}"
        f"&transaction_id={tx.id}&action_code=APPROVE",
        headers=viewer_headers,
    ).json()
    policy = allowed_body["criteria"]["workflow_policy"]
    assert policy["action_code"] == "APPROVE"
    assert policy["allowed"] is None
    assert "No active workflow policy" in policy["reason"]
    assert policy["policy_id"] is None

    # A policy restricted to a role the operator does not hold blocks it.
    from app.models import OperationWorkflowPolicy, OperationWorkflowPolicyRole, Role

    approver_role = (
        db.query(Role)
        .join(UserRole, UserRole.role_id == Role.id)
        .filter(UserRole.user_id == approver.id)
        .first()
    )
    policy_row = OperationWorkflowPolicy(
        policy_name="Approve only by approvers",
        action_code="APPROVE",
        status="Active",
        priority=1,
    )
    db.add(policy_row)
    db.flush()
    db.add(OperationWorkflowPolicyRole(policy_id=policy_row.id, role_id=approver_role.id))
    db.commit()

    denied_body = client.get(
        f"/permissions/access-diagnostic?user_id={operator.id}"
        f"&transaction_id={tx.id}&action_code=APPROVE",
        headers=viewer_headers,
    ).json()
    denied_policy = denied_body["criteria"]["workflow_policy"]
    assert denied_policy["allowed"] is False
    assert denied_policy["policy_id"] == policy_row.id
    assert "Approve only by approvers" in denied_policy["reason"]

    approver_body = client.get(
        f"/permissions/access-diagnostic?user_id={approver.id}"
        f"&transaction_id={tx.id}&action_code=APPROVE",
        headers=viewer_headers,
    ).json()
    assert approver_body["criteria"]["workflow_policy"]["allowed"] is True
