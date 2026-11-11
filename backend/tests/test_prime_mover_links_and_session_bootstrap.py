"""Regression tests for Prime Mover ↔ Tanker Trailer linking and SPA session bootstrap."""
from app.config import AUTH_COOKIE_NAME
from app.models import Asset, AssetType, Permission, Role, RolePermission
from tests.conftest import create_user


PASSWORD = "LinkAndSessionPass123!$Ok"


def _role_with_permissions(db, role_name: str, permission_names: list[str]) -> Role:
    role = Role(role_name=role_name, status="Active")
    db.add(role)
    db.flush()
    for name in permission_names:
        perm = db.query(Permission).filter(Permission.permission_name == name).first()
        if not perm:
            perm = Permission(permission_name=name, module_name="General", status="Active")
            db.add(perm)
            db.flush()
        db.add(RolePermission(role_id=role.id, permission_id=perm.id))
    db.flush()
    return role


def _login_headers(client, username: str) -> dict[str, str]:
    resp = client.post("/auth/login", json={"username": username, "password": PASSWORD})
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


def test_prime_mover_tanker_link_full_lifecycle_and_audit_filter(client, db):
    """Unlinked prime movers and tanker trailers can be linked, queried, updated, closed, and audited."""
    role = _role_with_permissions(
        db,
        "FleetLinkManager",
        [
            "View Prime Mover Tanker Link",
            "Create Prime Mover Tanker Link",
            "Edit Prime Mover Tanker Link",
            "Delete Prime Mover Tanker Link",
            "Edit Global Prime Mover Tanker Link",
            "View Audit Log",
        ],
    )
    create_user(db, "fleet_mgr", PASSWORD, roles=[role])

    db.add_all(
        [
            AssetType(
                asset_type_code="PRIME_MOVER",
                asset_type_name="Prime Mover",
                status="Active",
            ),
            AssetType(
                asset_type_code="TANKER_TRAILER",
                asset_type_name="Tanker Trailer",
                status="Active",
            ),
            AssetType(
                asset_type_code="STORAGE_TANK",
                asset_type_name="Vertical Tank",
                status="Active",
            ),
            Asset(
                asset_code="TRK-HEAD-01",
                asset_name="Scania Fleet Head 01",
                asset_type_code="PRIME_MOVER",
                asset_scope="Global",
                status="Active",
            ),
            Asset(
                asset_code="TRL-01",
                asset_name="45KL Road Tanker Trailer 01",
                asset_type_code="TANKER_TRAILER",
                asset_scope="Global",
                serial_number="CHS-9001",
                status="Active",
            ),
            Asset(
                asset_code="TK-101",
                asset_name="Crude Tank 101",
                asset_type_code="STORAGE_TANK",
                asset_scope="Global",
                status="Active",
            ),
        ]
    )
    db.commit()

    headers = _login_headers(client, "fleet_mgr")

    # Non-prime-mover asset must return a clean 400 validation error, never a 500 NameError.
    invalid = client.post(
        "/prime-mover-tanker-links",
        headers=headers,
        json={
            "prime_mover_asset_code": "TK-101",
            "tanker_asset_code": "TRL-01",
            "linked_from": "2026-11-11",
            "status": "Active",
        },
    )
    assert invalid.status_code == 400, invalid.text
    assert "does not look like a Prime Mover" in invalid.json()["detail"]

    # Valid unlinked prime mover (note code does not start with PM, exercising type check) + tanker trailer.
    created = client.post(
        "/prime-mover-tanker-links",
        headers=headers,
        json={
            "prime_mover_asset_code": "TRK-HEAD-01",
            "tanker_asset_code": "TRL-01",
            "linked_from": "2026-11-11",
            "remarks": "Initial pairing",
            "status": "Active",
        },
    )
    assert created.status_code == 200, created.text
    body = created.json()
    link_id = body["id"]
    assert body["prime_mover_asset_code"] == "TRK-HEAD-01"
    assert body["tanker_asset_code"] == "TRL-01"
    assert body["tanker_chassis_number"] == "CHS-9001"
    assert body["status"] == "Active"

    # Lookup active link by prime mover code.
    current = client.get(
        "/prime-mover-tanker-links/current-by-prime-mover/TRK-HEAD-01",
        headers=headers,
    )
    assert current.status_code == 200, current.text
    assert current.json()["has_active_link"] is True
    assert current.json()["link"]["id"] == link_id

    # Update link remarks.
    updated = client.put(
        f"/prime-mover-tanker-links/{link_id}",
        headers=headers,
        json={
            "prime_mover_asset_code": "TRK-HEAD-01",
            "tanker_asset_code": "TRL-01",
            "linked_from": "2026-11-11",
            "remarks": "Updated pairing remarks",
            "status": "Active",
        },
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["remarks"] == "Updated pairing remarks"

    # Close link.
    closed = client.post(
        f"/prime-mover-tanker-links/{link_id}/close?linked_to=2026-11-12&remarks=Trip+complete",
        headers=headers,
        json={},
    )
    assert closed.status_code == 200, closed.text
    assert closed.json()["status"] == "Inactive"
    assert closed.json()["linked_to"] == "2026-11-12"

    # Filtering audit logs by module_name exercises escape_like in audit_logs.py.
    audits = client.get(
        "/audit-logs?module_name=Prime+Mover+Tanker+Link",
        headers=headers,
    )
    assert audits.status_code == 200, audits.text
    assert len(audits.json()) >= 3

    # Delete link.
    deleted = client.delete(f"/prime-mover-tanker-links/{link_id}", headers=headers)
    assert deleted.status_code == 200, deleted.text


def test_session_bootstrap_endpoint_handles_anonymous_active_and_reused_cookies(client, db):
    """POST /auth/session avoids cold-load 400/401s while preserving rotation and reuse defenses."""
    role = _role_with_permissions(db, "SessionBootRole", ["View User"])
    create_user(db, "boot_user", PASSWORD, roles=[role])
    db.commit()

    # 1) Cold load with no refresh cookie returns 200 {authenticated: false}.
    cold = client.post("/auth/session", json={})
    assert cold.status_code == 200, cold.text
    assert cold.json() == {"authenticated": False}

    # 2) Login sets the HttpOnly refresh cookie; /auth/session rotates it and returns token + user.
    login = client.post("/auth/login", json={"username": "boot_user", "password": PASSWORD})
    assert login.status_code == 200, login.text
    initial_cookie = client.cookies.get(AUTH_COOKIE_NAME)
    assert initial_cookie

    restored = client.post("/auth/session", json={})
    assert restored.status_code == 200, restored.text
    restored_body = restored.json()
    assert restored_body["authenticated"] is True
    assert restored_body["access_token"]
    assert restored_body["user"]["username"] == "boot_user"

    rotated_cookie = client.cookies.get(AUTH_COOKIE_NAME)
    assert rotated_cookie and rotated_cookie != initial_cookie

    # The restored access token immediately authorizes protected endpoints.
    users_resp = client.get(
        "/users?skip=0&limit=5",
        headers={"Authorization": f"Bearer {restored_body['access_token']}"},
    )
    assert users_resp.status_code == 200, users_resp.text

    # 3) Cross-site origin is still rejected with 403 when cookie is present.
    cross_site = client.post(
        "/auth/session",
        json={},
        headers={"Origin": "https://attacker.example"},
    )
    assert cross_site.status_code == 403

    # 4) Replaying the rotated-away refresh cookie revokes all sessions for the user.
    client.cookies.set(AUTH_COOKIE_NAME, initial_cookie)
    replayed = client.post("/auth/session", json={})
    assert replayed.status_code == 200
    assert replayed.json() == {"authenticated": False}
    assert "max-age=0" in replayed.headers.get("set-cookie", "").lower()

    # Even the previously minted access token is now rejected because the session epoch advanced.
    me_after_reuse = client.get(
        "/auth/me",
        headers={"Authorization": f"Bearer {restored_body['access_token']}"},
    )
    assert me_after_reuse.status_code == 401
