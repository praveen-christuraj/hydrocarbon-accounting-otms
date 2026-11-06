"""Large calibration uploads stay supported without changing other scopes."""

from app.config import MAX_CALIBRATION_ROWS
from sqlalchemy import func

from app.models import Asset, AssetCalibrationData, CalibrationTemplate, Location, UserLocation
from tests.conftest import create_role_with_permission, create_user


PASSWORD = "StrongPass123!"


def _headers(client, username):
    response = client.post(
        "/auth/login",
        json={"username": username, "password": PASSWORD},
    )
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def test_create_accepts_and_persists_fifty_thousand_calibration_rows(client, db):
    assert MAX_CALIBRATION_ROWS >= 50_000

    role, _ = create_role_with_permission(
        db,
        "Large Calibration Uploader",
        "Create Asset Calibration",
    )
    user = create_user(db, "large_calibration_uploader", PASSWORD, roles=[role])
    db.add(UserLocation(user_id=user.id, location_code="AGGE"))
    db.add(
        Location(
            location_name="Agge Terminal",
            location_code="AGGE",
            location_type="Terminal",
            status="Active",
        )
    )
    db.add(
        Asset(
            asset_name="Large Chart Tank",
            asset_code="AGGE-LARGE-CHART",
            asset_scope="Local",
            asset_type_code="TANK",
            location_code="AGGE",
            status="Active",
        )
    )
    template = CalibrationTemplate(
        template_name="Large Chart Template",
        asset_type_code="TANK",
        calibration_type="Tank Chart",
        status="Active",
    )
    db.add(template)
    db.commit()

    rows = [
        {"row_number": number, "row_data": {"Dip": number, "Volume": number * 10}}
        for number in range(1, 50_001)
    ]
    response = client.post(
        "/asset-calibration-tables?compact=true",
        headers=_headers(client, user.username),
        json={
            "calibration_name": "50K Point Chart",
            "asset_code": "AGGE-LARGE-CHART",
            "template_id": template.id,
            "status": "Active",
            "rows": rows,
        },
    )

    assert response.status_code == 200, response.text
    assert response.json()["row_count"] == 50_000
    assert "rows" not in response.json()

    saved_count = (
        db.query(func.count(AssetCalibrationData.id))
        .filter(AssetCalibrationData.calibration_table_id == response.json()["id"])
        .scalar()
    )
    last_row = (
        db.query(AssetCalibrationData)
        .filter(AssetCalibrationData.calibration_table_id == response.json()["id"])
        .order_by(AssetCalibrationData.row_number.desc())
        .first()
    )
    assert saved_count == 50_000
    assert last_row.row_number == 50_000
