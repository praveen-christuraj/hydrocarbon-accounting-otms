"""Asset calibration payload tests.

The calibration table list used to return every data row of every table,
which made the endpoint slow enough to hit the client request timeout as
history grew ("Unable to load asset calibration tables from the server").

These tests pin the contract that replaced it:

* ``GET /asset-calibration-tables`` is a lean list (no rows, row counts only);
* ``GET /asset-calibration-tables/{id}`` returns the table with its rows;
* ``GET /asset-calibration-tables/{id}/rows`` returns rows for one table;
* both detail endpoints respect the same location scope as the list.
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


def build_calibration_fixture(db):
    """Two locations, one tank each, with a calibration table and rows."""
    db.add_all(
        [
            Location(
                location_name="Agge Terminal",
                location_code="AGGE",
                location_type="Terminal",
                status="Active",
            ),
            Location(
                location_name="Lekki Terminal",
                location_code="LEKKI",
                location_type="Terminal",
                status="Active",
            ),
            Asset(
                asset_name="Agge Tank",
                asset_code="AGGE-CAL-TANK",
                asset_scope="Local",
                asset_type_code="TANK",
                location_code="AGGE",
                status="Active",
            ),
            Asset(
                asset_name="Lekki Tank",
                asset_code="LEKKI-CAL-TANK",
                asset_scope="Local",
                asset_type_code="TANK",
                location_code="LEKKI",
                status="Active",
            ),
        ]
    )
    template = CalibrationTemplate(
        template_name="Payload Calibration Template",
        asset_type_code="TANK",
        calibration_type="Tank Chart",
        status="Active",
    )
    db.add(template)
    db.flush()

    agge_table = AssetCalibrationTable(
        calibration_name="Agge Chart",
        asset_code="AGGE-CAL-TANK",
        template_id=template.id,
        status="Active",
    )
    lekki_table = AssetCalibrationTable(
        calibration_name="Lekki Chart",
        asset_code="LEKKI-CAL-TANK",
        template_id=template.id,
        status="Active",
    )
    db.add_all([agge_table, lekki_table])
    db.flush()

    db.add_all(
        [
            AssetCalibrationData(
                calibration_table_id=agge_table.id,
                row_number=row,
                row_data={"Dip (cm)": row, "Volume (bbl)": row * 10},
            )
            for row in range(1, 6)
        ]
    )
    db.flush()

    return agge_table, lekki_table


PASSWORD = "StrongPass123!"


def get_auth_header(client, username, password=PASSWORD):
    login_resp = client.post(
        "/auth/login",
        json={"username": username, "password": password},
    )
    assert login_resp.status_code == 200
    token = login_resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_calibration_list_is_lean_and_rows_come_from_the_dedicated_endpoints(client, db):
    role, _ = create_role_with_permission(db, "Calibration Payload Viewer", "View Asset Calibration")
    user = create_user(db, "calibration_payload_viewer", PASSWORD, roles=[role])
    db.add(UserLocation(user_id=user.id, location_code="AGGE"))
    tables = build_calibration_fixture(db)
    db.commit()

    headers = get_auth_header(client, "calibration_payload_viewer")

    list_resp = client.get("/asset-calibration-tables", headers=headers)
    assert list_resp.status_code == 200
    listed = list_resp.json()

    agge_row = next(row for row in listed if row["asset_code"] == "AGGE-CAL-TANK")
    # The lean list must not ship calibration data rows, but it still has to
    # tell the UI how many rows each table holds.
    assert "rows" not in agge_row
    assert agge_row["row_count"] == 5

    agge_table_id = agge_row["id"]

    detail_resp = client.get(f"/asset-calibration-tables/{agge_table_id}", headers=headers)
    assert detail_resp.status_code == 200
    detail = detail_resp.json()
    assert len(detail["rows"]) == 5
    assert detail["rows"][0]["row_data"] == {"Dip (cm)": 1, "Volume (bbl)": 10}

    rows_resp = client.get(f"/asset-calibration-tables/{agge_table_id}/rows", headers=headers)
    assert rows_resp.status_code == 200
    rows_payload = rows_resp.json()
    assert rows_payload["table_id"] == agge_table_id
    assert [row["row_number"] for row in rows_payload["rows"]] == [1, 2, 3, 4, 5]


def test_calibration_detail_endpoints_respect_location_scope(client, db):
    role, _ = create_role_with_permission(db, "Calibration Scope Viewer", "View Asset Calibration")
    user = create_user(db, "calibration_payload_scoper", PASSWORD, roles=[role])
    db.add(UserLocation(user_id=user.id, location_code="AGGE"))
    agge_table, lekki_table = build_calibration_fixture(db)
    db.commit()

    headers = get_auth_header(client, "calibration_payload_scoper")

    visible_list = client.get("/asset-calibration-tables", headers=headers).json()
    assert {row["asset_code"] for row in visible_list} == {"AGGE-CAL-TANK"}

    assert client.get(f"/asset-calibration-tables/{agge_table.id}", headers=headers).status_code == 200
    # Out-of-scope tables must look missing, not forbidden, so the endpoints
    # cannot be used to enumerate other locations' calibration data.
    assert client.get(f"/asset-calibration-tables/{lekki_table.id}", headers=headers).status_code == 404
    assert client.get(f"/asset-calibration-tables/{lekki_table.id}/rows", headers=headers).status_code == 404
