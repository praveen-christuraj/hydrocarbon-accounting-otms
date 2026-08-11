from app.models import Asset, Location, UserLocation
from tests.conftest import create_role_with_permission, create_user


def get_auth_header(client, db, username="assetuser", password="StrongPass123!"):
    role, _ = create_role_with_permission(db, "Asset Viewer", "View Asset")
    user = create_user(db, username, password, roles=[role])
    db.commit()

    login_resp = client.post(
        "/auth/login",
        json={"username": username, "password": password},
    )
    assert login_resp.status_code == 200
    token = login_resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}, user


def test_get_assets_includes_global_assets_for_assigned_location(client, db):
    headers, user = get_auth_header(client, db)

    db.add(
        Location(
            location_name="Agge",
            location_code="AGGE",
            location_type="Plant",
            status="Active",
        )
    )
    db.add(
        Location(
            location_name="Lagos",
            location_code="LAGOS",
            location_type="Plant",
            status="Active",
        )
    )
    db.add(UserLocation(user_id=user.id, location_code="AGGE"))
    db.add(
        Asset(
            asset_name="Global Shuttle",
            asset_code="GLOBAL-SHUTTLE",
            asset_scope="Global",
            asset_type_code="SHUTTLE",
            location_code=None,
            status="Active",
        )
    )
    db.add(
        Asset(
            asset_name="Local Shuttle",
            asset_code="LOCAL-SHUTTLE",
            asset_scope="Local",
            asset_type_code="SHUTTLE",
            location_code="LAGOS",
            status="Active",
        )
    )
    db.commit()

    response = client.get("/assets", headers=headers)

    assert response.status_code == 200
    items = response.json()["items"]
    asset_codes = [item["asset_code"] for item in items]

    assert "GLOBAL-SHUTTLE" in asset_codes
    assert "LOCAL-SHUTTLE" not in asset_codes
