"""Government Data — Book Stock Management tests.

Covers the pure stock arithmetic, product separation, opening auto-carry,
CRUD + audit, RBAC, entity scope, bulk upload and the Report Builder hook-up.
"""

from datetime import date

import pytest

from app.models import (
    AuditLog,
    BookStockDailyEntry,
    BookStockFieldProduction,
    ExportBlock,
    ExportEntity,
    ExportEntityBlock,
    ExportLocation,
    ExportLocationEntity,
)
from app.services.book_stock_calculations import (
    aggregate_block_rows,
    aggregate_entity_day_rows,
    build_dashboard,
    compute_closing_stock,
    sum_field_productions,
    totals_by_product,
)
from app.services.report_catalog import TABLE_GROUPS, TABLE_LABELS
from app.services.report_engine import starter_templates, validate_definition
from tests.conftest import create_role_with_permission, create_user


# ---------------------------------------------------------------------------
# Pure arithmetic
# ---------------------------------------------------------------------------

def test_closing_stock_formula_with_signed_adjustment():
    assert compute_closing_stock(1000, 200, 150, 25) == 1075
    # A negative adjustment is deducted, a positive one is added.
    assert compute_closing_stock(1000, 200, 150, -25) == 1025
    assert compute_closing_stock(0, 0, 0, -10) == -10


def test_field_production_is_summed_into_the_block():
    lines = [
        {"production_qty": 125.5},
        {"production_qty": 74.5},
        {"production_qty": 0},
    ]
    assert sum_field_productions(lines) == 200


def test_products_are_never_mixed_in_totals():
    rows = [
        {"entry_date": date(2026, 1, 1), "entity_code": "ENT1", "block_code": "B1", "product_code": "OIL",
         "opening_stock": 100, "production": 50, "dispatch": 20, "adjustment": 0, "closing_stock": 130},
        {"entry_date": date(2026, 1, 2), "entity_code": "ENT1", "block_code": "B1", "product_code": "OIL",
         "opening_stock": 130, "production": 40, "dispatch": 10, "adjustment": -5, "closing_stock": 155},
        {"entry_date": date(2026, 1, 2), "entity_code": "ENT1", "block_code": "B1", "product_code": "GAS",
         "opening_stock": 900, "production": 30, "dispatch": 30, "adjustment": 0, "closing_stock": 900},
    ]
    totals = {row["product_code"]: row for row in totals_by_product(rows)}
    assert totals["OIL"]["production"] == 90
    assert totals["OIL"]["opening_stock"] == 100
    assert totals["OIL"]["closing_stock"] == 155
    assert totals["OIL"]["closing_date"] == "2026-01-02"
    assert totals["GAS"]["production"] == 30
    assert totals["GAS"]["opening_stock"] == 900
    assert totals["GAS"]["closing_stock"] == 900


def test_block_and_entity_closing_rolls_up_per_date():
    rows = [
        {"entry_date": date(2026, 2, 1), "entity_code": "ENT1", "block_code": "B1", "product_code": "OIL",
         "opening_stock": 10, "production": 100, "dispatch": 20, "adjustment": 0, "closing_stock": 90},
        {"entry_date": date(2026, 2, 1), "entity_code": "ENT1", "block_code": "B2", "product_code": "OIL",
         "opening_stock": 5, "production": 60, "dispatch": 25, "adjustment": 10, "closing_stock": 50},
    ]
    entity = aggregate_entity_day_rows(rows)
    assert len(entity) == 1
    assert entity[0]["closing_stock"] == 140
    assert entity[0]["production"] == 160
    assert entity[0]["block_count"] == 2

    blocks = {row["block_code"]: row for row in aggregate_block_rows(rows)}
    assert blocks["B1"]["closing_stock"] == 90
    assert blocks["B2"]["closing_stock"] == 50


# ---------------------------------------------------------------------------
# Fixtures / helpers
# ---------------------------------------------------------------------------

def _seed_export_config(db, location_code="LOC1", entity_code="ENT1", block_code="B1"):
    db.add(ExportLocation(location_name="Terminal One", location_code=location_code, status="Active"))
    db.add(ExportEntity(entity_name="Entity One", entity_code=entity_code, status="Active"))
    db.add(ExportBlock(block_name="Block One", block_code=block_code, status="Active"))
    db.flush()
    db.add(ExportLocationEntity(location_code=location_code, entity_code=entity_code, status="Active"))
    db.add(ExportEntityBlock(entity_code=entity_code, block_code=block_code, status="Active"))
    db.flush()


def _login(client, db, username="admin", password="AdminPass123!", permissions=None, locations=None):
    role = None
    if permissions:
        role = None
        for permission in permissions:
            role, _ = create_role_with_permission(db, f"Role {permission}", permission)
            break
        for extra in permissions[1:]:
            from app.models import RolePermission
            from app.utils.default_permissions import STANDARD_PERMISSIONS
            from app.models import Permission
            row = next(item for item in STANDARD_PERMISSIONS if item["permission_name"] == extra)
            perm = Permission(permission_name=row["permission_name"], module_name=row["module_name"], status="Active")
            db.add(perm)
            db.flush()
            db.add(RolePermission(role_id=role.id, permission_id=perm.id))
    elif str(username).strip().casefold() == "admin":
        from app.models import Role
        role = Role(role_name="Admin", status="Active")
        db.add(role)
        db.flush()
    user = create_user(db, username, password, roles=[role] if role else None)
    if locations is None:
        user.all_locations_access = "Yes"
    else:
        from app.models import UserLocation
        for code in locations:
            db.add(UserLocation(user_id=user.id, location_code=code))
    db.commit()
    response = client.post("/auth/login", json={"username": username, "password": password})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}, user


def _product(client, headers, code, name, unit="BBL", status="Active"):
    response = client.post(
        "/book-stock/products",
        headers=headers,
        json={"product_code": code, "product_name": name, "unit": unit, "status": status},
    )
    assert response.status_code == 200, response.text
    return response.json()


def _field(client, headers, code, name, entity="ENT1", block="B1", products=("OIL",)):
    response = client.post(
        "/book-stock/fields",
        headers=headers,
        json={
            "field_code": code,
            "field_name": name,
            "entity_code": entity,
            "block_code": block,
            "product_codes": list(products),
            "status": "Active",
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def _entry(client, headers, **overrides):
    payload = {
        "entry_date": "2026-01-01",
        "entity_code": "ENT1",
        "block_code": "B1",
        "product_code": "OIL",
        "opening_stock": 1000,
        "dispatch": 100,
        "adjustment": 0,
        "field_productions": [{"field_code": "F1", "production_qty": 300}],
    }
    payload.update(overrides)
    return client.post("/book-stock/daily-entries", headers=headers, json=payload)


# ---------------------------------------------------------------------------
# API behaviour
# ---------------------------------------------------------------------------

def test_book_stock_end_to_end_flow(client, db):
    _seed_export_config(db)
    db.commit()
    headers, _ = _login(client, db)

    oil = _product(client, headers, "OIL", "Crude Oil")
    gas = _product(client, headers, "GAS", "Associated Gas")
    assert oil["product_code"] == "OIL"
    assert gas["status"] == "Active"
    # The module is limited to the two configured products.
    third = client.post(
        "/book-stock/products",
        headers=headers,
        json={"product_code": "COND", "product_name": "Condensate", "unit": "BBL", "status": "Active"},
    )
    assert third.status_code == 400

    field = _field(client, headers, "F1", "Field One", products=("OIL", "GAS"))
    assert field["product_names"] == ["Crude Oil", "Associated Gas"]

    # Day 1: opening entered, production 300 from the field, dispatch 100.
    day1 = _entry(client, headers)
    assert day1.status_code == 200, day1.text
    day1 = day1.json()
    assert day1["production"] == 300
    assert day1["closing_stock"] == 1200  # 1000 + 300 - 100 + 0
    assert day1["field_productions"][0]["field_name"] == "Field One"

    # Day 2: no opening supplied -> carried from day 1 closing.
    day2 = _entry(
        client, headers,
        entry_date="2026-01-02", opening_stock=None,
        dispatch=50, adjustment=-25,
        field_productions=[{"field_code": "F1", "production_qty": 100}],
    )
    assert day2.status_code == 200, day2.text
    day2 = day2.json()
    assert day2["opening_stock"] == 1200
    assert day2["opening_carried"] == "Yes"
    assert day2["closing_stock"] == 1225  # 1200 + 100 - 50 - 25

    # The opening suggestion endpoint matches the previous closing.
    suggestion = client.get(
        "/book-stock/daily-entries/opening",
        headers=headers,
        params={"entity_code": "ENT1", "block_code": "B1", "product_code": "OIL", "entry_date": "2026-01-03"},
    )
    assert suggestion.status_code == 200
    assert suggestion.json()["opening_stock"] == 1225
    assert suggestion.json()["previous_entry_date"] == "2026-01-02"

    # Same date + block + product is a duplicate; the other product is separate.
    duplicate = _entry(client, headers, entry_date="2026-01-02", opening_stock=1)
    assert duplicate.status_code == 400
    gas_entry = _entry(
        client, headers, entry_date="2026-01-01", product_code="GAS",
        opening_stock=500, dispatch=20, field_productions=[{"field_code": "F1", "production_qty": 70}],
    )
    assert gas_entry.status_code == 200, gas_entry.text
    gas_entry = gas_entry.json()
    assert gas_entry["closing_stock"] == 550
    assert gas_entry["production"] == 70

    # A field that does not produce the product is rejected (no mixing).
    wrong_product = _entry(
        client, headers, entry_date="2026-01-05", product_code="GAS",
        field_productions=[{"field_code": "F2", "production_qty": 10}],
    )
    assert wrong_product.status_code == 400

    # Opening stays editable; the closing is recalculated server-side.
    edited = client.put(
        f"/book-stock/daily-entries/{day1['id']}",
        headers=headers,
        json={"opening_stock": 900, "dispatch": 100,
              "field_productions": [{"field_code": "F1", "production_qty": 350}]},
    )
    assert edited.status_code == 200, edited.text
    assert edited.json()["closing_stock"] == 1150

    # The following auto-carried day re-flows from the corrected closing; its
    # closing becomes 1150 + 100 - 50 - 25 = 1175.
    day2_after = client.get(f"/book-stock/daily-entries/{day2['id']}", headers=headers)
    assert day2_after.status_code == 200
    assert day2_after.json()["opening_stock"] == 1150
    assert day2_after.json()["opening_carried"] == "Yes"
    assert day2_after.json()["closing_stock"] == 1175

    # Block / entity summaries keep the products separate.
    block_summary = client.get("/book-stock/block-summary", headers=headers)
    assert block_summary.status_code == 200
    block_totals = {row["product_code"]: row for row in block_summary.json()["block_totals"]}
    assert block_totals["OIL"]["production"] == 450
    assert block_totals["GAS"]["production"] == 70

    entity_summary = client.get("/book-stock/entity-summary", headers=headers)
    assert entity_summary.status_code == 200
    assert {row["product_code"] for row in entity_summary.json()["items"]} == {"OIL", "GAS"}

    dashboard = client.get("/book-stock/dashboard", headers=headers)
    assert dashboard.status_code == 200
    dash = dashboard.json()
    totals = {row["product_code"]: row for row in dash["totals_by_product"]}
    assert totals["OIL"]["opening_stock"] == 900
    assert totals["OIL"]["closing_stock"] == 1175
    assert totals["GAS"]["opening_stock"] == 500
    assert totals["GAS"]["closing_stock"] == 550

    # Every mutation is audited.
    actions = {row.action for row in db.query(AuditLog).all()}
    assert "Create Book Stock Product" in actions
    assert "Create Book Stock Field" in actions
    assert "Create Book Stock Entry" in actions
    assert "Edit Book Stock Entry" in actions
    assert "Recalculate Book Stock Entry" in actions

    # Delete is audited too.
    deleted = client.delete(f"/book-stock/daily-entries/{gas_entry['id']}", headers=headers)
    assert deleted.status_code == 200
    assert "permanently" in deleted.json()["detail"].lower()
    assert db.query(BookStockDailyEntry).filter(BookStockDailyEntry.product_code == "GAS").count() == 0
    assert db.query(BookStockFieldProduction).filter(BookStockFieldProduction.product_code == "GAS").count() == 0
    assert db.query(AuditLog).filter(AuditLog.action == "Delete Book Stock Entry").count() == 1


def test_opening_auto_carry_can_be_switched_off(client, db):
    _seed_export_config(db)
    db.commit()
    headers, _ = _login(client, db)
    _product(client, headers, "OIL", "Crude Oil")
    _product(client, headers, "GAS", "Associated Gas")
    _field(client, headers, "F1", "Field One", products=("OIL",))

    settings = client.put(
        "/book-stock/settings",
        headers=headers,
        json={"settings": [{"config_key": "auto_carry_opening", "config_value": "No"}]},
    )
    assert settings.status_code == 200, settings.text
    _entry(client, headers, opening_stock=1000)
    second = _entry(client, headers, entry_date="2026-01-02", opening_stock=None,
                    field_productions=[])
    assert second.status_code == 200, second.text
    assert second.json()["opening_stock"] == 0
    assert second.json()["opening_carried"] == "No"

    # Negative closing can be blocked from the settings.
    client.put(
        "/book-stock/settings",
        headers=headers,
        json={"settings": [{"config_key": "allow_negative_closing", "config_value": "No"}]},
    )
    negative = _entry(
        client, headers, entry_date="2026-01-03", opening_stock=10, dispatch=100,
        field_productions=[],
    )
    assert negative.status_code == 400


def test_rbac_and_entity_scope(client, db):
    _seed_export_config(db, location_code="LOC1", entity_code="ENT1", block_code="B1")
    _seed_export_config(db, location_code="LOC2", entity_code="ENT2", block_code="B2")
    db.commit()

    admin_headers, _ = _login(client, db, username="admin")
    _product(client, admin_headers, "OIL", "Crude Oil")
    _product(client, admin_headers, "GAS", "Associated Gas")
    _field(client, admin_headers, "F1", "Field One", entity="ENT1", block="B1", products=("OIL",))
    _field(client, admin_headers, "F2", "Field Two", entity="ENT2", block="B2", products=("OIL",))
    _entry(client, admin_headers, entity_code="ENT1", block_code="B1",
           field_productions=[{"field_code": "F1", "production_qty": 10}])

    # A user with only View cannot create, edit or delete.
    viewer_headers, _ = _login(
        client, db, username="viewer", password="ViewerPass123!",
        permissions=["View Book Stock Entry"], locations=["LOC1"],
    )
    listed = client.get("/book-stock/daily-entries", headers=viewer_headers)
    assert listed.status_code == 200
    assert listed.json()["total"] == 1  # LOC1 -> ENT1 only
    assert all(item["entity_code"] == "ENT1" for item in listed.json()["items"])

    forbidden = client.post(
        "/book-stock/daily-entries",
        headers=viewer_headers,
        json={
            "entry_date": "2026-01-02", "entity_code": "ENT1", "block_code": "B1",
            "product_code": "OIL", "opening_stock": 0, "field_productions": [],
        },
    )
    assert forbidden.status_code == 403
    assert client.delete("/book-stock/daily-entries/1", headers=viewer_headers).status_code == 403

    # A restricted operator cannot write to an entity outside their locations.
    operator_headers, _ = _login(
        client, db, username="operator", password="OperatorPass123!",
        permissions=["Create Book Stock Entry", "View Book Stock Entry"], locations=["LOC1"],
    )
    outside = client.post(
        "/book-stock/daily-entries",
        headers=operator_headers,
        json={
            "entry_date": "2026-01-02", "entity_code": "ENT2", "block_code": "B2",
            "product_code": "OIL", "opening_stock": 0, "field_productions": [],
        },
    )
    assert outside.status_code == 403

    inside = client.post(
        "/book-stock/daily-entries",
        headers=operator_headers,
        json={
            "entry_date": "2026-01-02", "entity_code": "ENT1", "block_code": "B1",
            "product_code": "OIL", "opening_stock": None,
            "field_productions": [{"field_code": "F1", "production_qty": 5}],
        },
    )
    assert inside.status_code == 200, inside.text


def test_bulk_upload_is_partial_and_reports_each_row(client, db):
    _seed_export_config(db)
    db.commit()
    headers, _ = _login(client, db)
    _product(client, headers, "OIL", "Crude Oil")
    _product(client, headers, "GAS", "Associated Gas")
    _field(client, headers, "F1", "Field One", products=("OIL",))

    response = client.post(
        "/book-stock/daily-entries/bulk-upload",
        headers=headers,
        json={
            "items": [
                {"entry_date": "2026-03-01", "entity_code": "ENT1", "block_code": "B1",
                 "product_code": "OIL", "opening_stock": 100, "dispatch": 10, "adjustment": 5,
                 "field_productions": "F1=50"},
                {"entry_date": "2026-03-01", "entity_code": "ENT1", "block_code": "B1",
                 "product_code": "OIL", "opening_stock": 100, "field_productions": "F1=20"},
                {"entry_date": "2026-03-02", "entity_code": "ENT1", "block_code": "B1",
                 "product_code": "GAS", "opening_stock": 1, "field_productions": "F1=20"},
            ]
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["imported"] == 1
    assert body["failed"] == 2
    messages = [row["message"] for row in body["results"]]
    assert any("already exists" in message for message in messages)
    assert any("does not produce" in message for message in messages)

    saved = db.query(BookStockDailyEntry).one()
    assert saved.production == 50
    assert saved.closing_stock == 145  # 100 + 50 - 10 + 5


def test_reference_data_exposes_only_the_export_configuration_used(client, db):
    _seed_export_config(db)
    db.commit()
    headers, _ = _login(client, db)
    _product(client, headers, "OIL", "Crude Oil")
    _product(client, headers, "GAS", "Associated Gas")
    _field(client, headers, "F1", "Field One", products=("OIL", "GAS"))

    reference = client.get("/book-stock/reference-data", headers=headers)
    assert reference.status_code == 200
    body = reference.json()
    assert [row["entity_code"] for row in body["entities"]] == ["ENT1"]
    assert [row["block_code"] for row in body["blocks"]] == ["B1"]
    assert body["fields"][0]["product_codes"] == ["OIL", "GAS"]
    assert body["product_limit"] == 2

    export_config = client.get("/book-stock/export-operations", headers=headers)
    assert export_config.status_code == 200
    assert export_config.json()["entities"][0]["block_count"] == 1


def test_report_builder_lists_book_stock_tables_and_starter():
    assert TABLE_LABELS["book_stock_daily_entries"] == "Book Stock — Daily Stock Entries"
    group = dict(TABLE_GROUPS)["Government Data — Book Stock"]
    assert "book_stock_daily_entries" in group
    assert "book_stock_field_productions" in group

    starter = next(item for item in starter_templates() if item["id"] == "book-stock-daily")
    validated = validate_definition(starter["definition"])
    assert validated["source"]["kind"] == "table"
    assert validated["source"]["table"] == "book_stock_daily_entries"
    assert validated["date_column"] == "entry_date"
    assert {column["key"] for column in validated["columns"]} >= {
        "opening", "production", "dispatch", "adjustment", "closing",
    }


def test_earlier_edit_rolls_forward_only_auto_carried_days(client, db):
    """A correction must keep later carried openings truthful without overriding manual ones."""
    _seed_export_config(db)
    db.commit()
    headers, _ = _login(client, db)
    _product(client, headers, "OIL", "Crude Oil")
    _field(client, headers, "F1", "Field One", products=("OIL",))

    first = _entry(
        client, headers, entry_date="2026-03-01", opening_stock=1000,
        dispatch=100, field_productions=[{"field_code": "F1", "production_qty": 300}],
    ).json()
    second = _entry(
        client, headers, entry_date="2026-03-02", opening_stock=None,
        dispatch=50, field_productions=[{"field_code": "F1", "production_qty": 100}],
    ).json()
    third = _entry(
        client, headers, entry_date="2026-03-03", opening_stock=500,
        dispatch=25, field_productions=[{"field_code": "F1", "production_qty": 50}],
    ).json()
    assert second["opening_carried"] == "Yes"
    assert third["opening_carried"] == "No"

    edited = client.put(
        f"/book-stock/daily-entries/{first['id']}",
        headers=headers,
        json={"opening_stock": 900},
    )
    assert edited.status_code == 200, edited.text
    assert edited.json()["closing_stock"] == 1100

    second_after = client.get(f"/book-stock/daily-entries/{second['id']}", headers=headers).json()
    assert second_after["opening_stock"] == 1100
    assert second_after["closing_stock"] == 1150

    # Manual opening stays exactly as entered and therefore absorbs the change.
    third_after = client.get(f"/book-stock/daily-entries/{third['id']}", headers=headers).json()
    assert third_after["opening_stock"] == 500
    assert third_after["closing_stock"] == 525

    roll_forwards = db.query(AuditLog).filter(AuditLog.action == "Recalculate Book Stock Entry").all()
    assert len(roll_forwards) == 1
    assert roll_forwards[0].details["before"]["opening_stock"] == 1200
    assert roll_forwards[0].details["after"]["opening_stock"] == 1100
