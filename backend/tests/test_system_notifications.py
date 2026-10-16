"""Regression tests for system notification flag typing.

The UI sends JSON booleans for ``requires_acknowledgement`` / ``popup_enabled`` /
``banner_enabled`` (bulk upload and older clients use 'Yes'/'No' strings). The
API used to declare those fields as ``str``, so every create/update failed with
Pydantic's "Input should be a valid string", and returning Python booleans from
the response builder failed response validation with the same error. Both input
shapes must be accepted and responses must return real JSON booleans.
"""

from app.models import Permission, Role, RolePermission
from tests.conftest import create_user

FLAG_PERMISSIONS = [
    "Create System Notification",
    "View System Notification",
    "Edit System Notification",
]

BASE_PAYLOAD = {
    "title": "Maintenance window",
    "message": "Systems will be offline from 22:00 to 23:00.",
    "notification_type": "Maintenance",
    "priority": "High",
    "delivery_mode": "Banner + Inbox",
    "target_scope": "All Users",
    "status": "Draft",
}


def get_auth_header(client, db, permissions=None, username="notifadmin"):
    """Create an Admin-role user with the requested permissions and log in."""
    role = Role(role_name="Admin", status="Active")
    db.add(role)
    db.flush()
    for permission_name in permissions or FLAG_PERMISSIONS:
        perm = Permission(
            permission_name=permission_name,
            module_name="System Notification",
            status="Active",
        )
        db.add(perm)
        db.flush()
        db.add(RolePermission(role_id=role.id, permission_id=perm.id))
    db.flush()

    create_user(db, username=username, roles=[role])
    db.commit()

    login_resp = client.post(
        "/auth/login",
        json={"username": username, "password": "TestPass123!"},
    )
    assert login_resp.status_code == 200, login_resp.text
    return {"Authorization": f"Bearer {login_resp.json()['access_token']}"}


def test_create_notification_with_boolean_flags(client, db):
    """The exact shape the frontend sends: flags as JSON booleans."""
    headers = get_auth_header(client, db)
    payload = {
        **BASE_PAYLOAD,
        "requires_acknowledgement": True,
        "popup_enabled": False,
        "banner_enabled": True,
    }
    response = client.post("/system-notifications", headers=headers, json=payload)
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["requires_acknowledgement"] is True
    assert data["popup_enabled"] is False
    assert data["banner_enabled"] is True


def test_create_notification_with_legacy_yes_no_flags(client, db):
    """Older clients/bulk uploads send 'Yes'/'No' strings - still accepted."""
    headers = get_auth_header(client, db)
    payload = {
        **BASE_PAYLOAD,
        "requires_acknowledgement": "Yes",
        "popup_enabled": "No",
        "banner_enabled": "No",
    }
    response = client.post("/system-notifications", headers=headers, json=payload)
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["requires_acknowledgement"] is True
    assert data["popup_enabled"] is False
    assert data["banner_enabled"] is False


def test_create_notification_with_null_flags_uses_defaults(client, db):
    """Explicit nulls fall back to the schema defaults (No / No / Yes)."""
    headers = get_auth_header(client, db)
    payload = {
        **BASE_PAYLOAD,
        "requires_acknowledgement": None,
        "popup_enabled": None,
        "banner_enabled": None,
    }
    response = client.post("/system-notifications", headers=headers, json=payload)
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["requires_acknowledgement"] is False
    assert data["popup_enabled"] is False
    assert data["banner_enabled"] is True


def test_update_notification_with_boolean_flags(client, db):
    headers = get_auth_header(client, db)
    create_resp = client.post(
        "/system-notifications",
        headers=headers,
        json={**BASE_PAYLOAD, "banner_enabled": True},
    )
    assert create_resp.status_code == 200, create_resp.text
    notification_id = create_resp.json()["id"]

    response = client.put(
        f"/system-notifications/{notification_id}",
        headers=headers,
        json={
            **BASE_PAYLOAD,
            "requires_acknowledgement": True,
            "popup_enabled": True,
            "banner_enabled": False,
        },
    )
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["requires_acknowledgement"] is True
    assert data["popup_enabled"] is True
    assert data["banner_enabled"] is False


def test_list_notifications_response_flags_are_booleans(client, db):
    headers = get_auth_header(client, db)
    create_resp = client.post(
        "/system-notifications",
        headers=headers,
        json={**BASE_PAYLOAD, "requires_acknowledgement": True},
    )
    assert create_resp.status_code == 200, create_resp.text

    response = client.get("/system-notifications", headers=headers)
    assert response.status_code == 200, response.text
    rows = response.json()
    assert len(rows) == 1
    assert rows[0]["requires_acknowledgement"] is True
    assert rows[0]["popup_enabled"] is False
    assert rows[0]["banner_enabled"] is True
