"""One calibration chart per asset (case-insensitive asset code).

Business rule: an asset may hold at most one calibration chart. A second
upload for the same asset (any casing) is rejected with 409 naming the
existing chart; the supported flows are edit-replace or full delete followed
by a fresh upload. Repointing a chart at an asset that already has one is
rejected the same way. Deleting a chart frees the asset for a new upload.
"""

from app.models import (
    Asset,
    AssetCalibrationData,
    AssetCalibrationTable,
    CalibrationTemplate,
    Location,
    UserLocation,
)
from tests.conftest import create_role_with_permission, create_user


PASSWORD = "StrongPass123!"


def _headers(client, username):
    response = client.post(
        "/auth/login",
        json={"username": username, "password": PASSWORD},
    )
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def _seed_assets(db):
    db.add(
        Location(
            location_name="Agge Terminal",
            location_code="AGGE",
            location_type="Terminal",
            status="Active",
        )
    )
    db.add_all(
        [
            Asset(
                asset_name="One Per Asset Tank One",
                asset_code="AGGE-OPA-1",
                asset_scope="Local",
                asset_type_code="TANK",
                location_code="AGGE",
                status="Active",
            ),
            Asset(
                asset_name="One Per Asset Tank Two",
                asset_code="AGGE-OPA-2",
                asset_scope="Local",
                asset_type_code="TANK",
                location_code="AGGE",
                status="Active",
            ),
        ]
    )
    template = CalibrationTemplate(
        template_name="One Per Asset Template",
        asset_type_code="TANK",
        calibration_type="Tank Chart",
        status="Active",
    )
    db.add(template)
    db.commit()
    return template


def _make_user_with_full_calibration_access(db, username):
    permissions = [
        "View Asset Calibration",
        "Create Asset Calibration",
        "Edit Asset Calibration",
        "Delete Asset Calibration",
    ]
    roles = [
        create_role_with_permission(db, f"One Per Asset {perm} {username}", perm)[0]
        for perm in permissions
    ]
    user = create_user(db, username, PASSWORD, roles=roles)
    db.add(UserLocation(user_id=user.id, location_code="AGGE"))
    db.commit()
    return user


def _payload(template_id, name, asset_code):
    return {
        "calibration_name": name,
        "asset_code": asset_code,
        "template_id": template_id,
        "status": "Active",
        "rows": [
            {"row_number": 1, "row_data": {"Dip": 10, "Volume": 100}},
            {"row_number": 2, "row_data": {"Dip": 20, "Volume": 400}},
        ],
    }


def test_duplicate_chart_for_same_asset_is_rejected_regardless_of_casing(client, db):
    template = _seed_assets(db)
    _make_user_with_full_calibration_access(db, "one_per_asset_create")
    headers = _headers(client, "one_per_asset_create")

    created = client.post(
        "/asset-calibration-tables?compact=true",
        headers=headers,
        json=_payload(template.id, "First Chart", "AGGE-OPA-1"),
    )
    assert created.status_code == 200, created.text

    for candidate in ("AGGE-OPA-1", "agge-opa-1", "Agge-Opa-1"):
        duplicate = client.post(
            "/asset-calibration-tables?compact=true",
            headers=headers,
            json=_payload(template.id, "Second Chart", candidate),
        )
        assert duplicate.status_code == 409
        detail = duplicate.json()["detail"]
        assert "First Chart" in detail
        assert "one calibration chart" in detail.lower()


def test_update_cannot_repoint_a_chart_onto_an_occupied_asset(client, db):
    template = _seed_assets(db)
    _make_user_with_full_calibration_access(db, "one_per_asset_update")
    headers = _headers(client, "one_per_asset_update")

    for name, asset in (("First Chart", "AGGE-OPA-1"), ("Second Chart", "AGGE-OPA-2")):
        response = client.post(
            "/asset-calibration-tables?compact=true",
            headers=headers,
            json=_payload(template.id, name, asset),
        )
        assert response.status_code == 200, response.text

    chart_two = next(
        table
        for table in client.get("/asset-calibration-tables", headers=headers).json()
        if table["asset_code"] == "AGGE-OPA-2"
    )

    repoint = client.put(
        f"/asset-calibration-tables/{chart_two['id']}?compact=true",
        headers=headers,
        json=_payload(template.id, "Second Chart", "AGGE-OPA-1"),
    )
    assert repoint.status_code == 409
    assert "First Chart" in repoint.json()["detail"]

    # The blocked repoint must not have disturbed either chart.
    charts = client.get("/asset-calibration-tables", headers=headers).json()
    ownership = {chart["calibration_name"]: chart["asset_code"] for chart in charts}
    assert ownership["First Chart"] == "AGGE-OPA-1"
    assert ownership["Second Chart"] == "AGGE-OPA-2"


def test_update_same_chart_is_allowed_and_replaces_rows(client, db):
    template = _seed_assets(db)
    _make_user_with_full_calibration_access(db, "one_per_asset_edit")
    headers = _headers(client, "one_per_asset_edit")

    created = client.post(
        "/asset-calibration-tables?compact=true",
        headers=headers,
        json=_payload(template.id, "First Chart", "AGGE-OPA-1"),
    )
    assert created.status_code == 200, created.text
    chart_id = created.json()["id"]

    replacement = _payload(template.id, "First Chart v2", "AGGE-OPA-1")
    replacement["rows"] = [
        {"row_number": 1, "row_data": {"Dip": 15, "Volume": 150}},
    ]
    updated = client.put(
        f"/asset-calibration-tables/{chart_id}?compact=true",
        headers=headers,
        json=replacement,
    )
    assert updated.status_code == 200, updated.text

    detail = client.get(f"/asset-calibration-tables/{chart_id}", headers=headers).json()
    assert detail["calibration_name"] == "First Chart v2"
    assert len(detail["rows"]) == 1
    assert detail["rows"][0]["row_data"] == {"Dip": 15, "Volume": 150}


def test_delete_then_recreate_is_allowed(client, db):
    template = _seed_assets(db)
    _make_user_with_full_calibration_access(db, "one_per_asset_delete")
    headers = _headers(client, "one_per_asset_delete")

    created = client.post(
        "/asset-calibration-tables?compact=true",
        headers=headers,
        json=_payload(template.id, "First Chart", "AGGE-OPA-1"),
    )
    assert created.status_code == 200, created.text
    chart_id = created.json()["id"]

    deleted = client.delete(f"/asset-calibration-tables/{chart_id}", headers=headers)
    assert deleted.status_code == 200

    recreated = client.post(
        "/asset-calibration-tables?compact=true",
        headers=headers,
        json=_payload(template.id, "First Chart replacement", "AGGE-OPA-1"),
    )
    assert recreated.status_code == 200, recreated.text


def test_blocked_duplicate_leaves_existing_rows_untouched(client, db):
    template = _seed_assets(db)
    user = _make_user_with_full_calibration_access(db, "one_per_asset_rows")
    headers = _headers(client, "one_per_asset_rows")

    created = client.post(
        "/asset-calibration-tables?compact=true",
        headers=headers,
        json=_payload(template.id, "First Chart", "AGGE-OPA-1"),
    )
    assert created.status_code == 200, created.text
    chart_id = created.json()["id"]

    duplicate = client.post(
        "/asset-calibration-tables?compact=true",
        headers=headers,
        json=_payload(template.id, "Intruder Chart", "AGGE-OPA-1"),
    )
    assert duplicate.status_code == 409

    rows = db.query(AssetCalibrationData).filter_by(calibration_table_id=chart_id).count()
    assert rows == 2
    tables = db.query(AssetCalibrationTable).filter_by(asset_code="AGGE-OPA-1").all()
    assert [table.calibration_name for table in tables] == ["First Chart"]
