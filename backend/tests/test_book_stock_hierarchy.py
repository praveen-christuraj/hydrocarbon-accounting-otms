from datetime import date

from app.models import BookStockDailyEntry, BookStockFieldProduction, BookStockSubField
from app.routers.book_stock_hierarchy import backfill_legacy_subfields
from tests.test_book_stock import _seed_export_config, _login, _product, _field


def setup(client, db):
    _seed_export_config(db)
    db.commit()
    headers, _ = _login(client, db)
    _product(client, headers, "OIL", "Oil")
    _product(client, headers, "GAS", "Gas")
    f1 = _field(
        client,
        headers,
        "F1",
        "Field One",
        products=("OIL", "GAS"),
        create_default=False,
    )
    f2 = _field(
        client, headers, "F2", "Field Two", products=("OIL",), create_default=False
    )

    def sub(f, c):
        r = client.post(
            "/book-stock/sub-fields",
            headers=headers,
            json={"field_id": f["id"], "sub_field_code": c, "sub_field_name": c},
        )
        assert r.status_code == 200, r.text
        return r.json()

    return headers, f1, f2, sub(f1, "S1"), sub(f1, "S2"), sub(f2, "S3")


def payload(f1, f2, s1, s2, s3, day="2026-01-01"):
    return {
        "entry_date": day,
        "entity_code": "ENT1",
        "block_code": "B1",
        "product_code": "OIL",
        "field_stocks": [
            {
                "field_id": f1["id"],
                "opening_stock": 100,
                "dispatch": 30,
                "adjustment": -5,
                "sub_field_productions": [
                    {"sub_field_id": s1["id"], "production_qty": 10},
                    {"sub_field_id": s2["id"], "production_qty": 20},
                ],
            },
            {
                "field_id": f2["id"],
                "opening_stock": 200,
                "dispatch": 40,
                "adjustment": 5,
                "sub_field_productions": [
                    {"sub_field_id": s3["id"], "production_qty": 50}
                ],
            },
        ],
    }


def test_hierarchy_rollup_carry_edit_delete_and_products(client, db):
    h, f1, f2, s1, s2, s3 = setup(client, db)
    body = payload(f1, f2, s1, s2, s3)
    r = client.post("/book-stock/daily-entries", headers=h, json=body)
    assert r.status_code == 200, r.text
    first = r.json()
    assert [
        first[k]
        for k in (
            "opening_stock",
            "production",
            "dispatch",
            "adjustment",
            "closing_stock",
        )
    ] == [300, 80, 70, 0, 310]
    assert [(s["production"], s["closing_stock"]) for s in first["field_stocks"]] == [
        (30, 95),
        (50, 215),
    ]
    body2 = payload(f1, f2, s1, s2, s3, "2026-01-02")
    for s in body2["field_stocks"]:
        s["opening_stock"] = None
    r = client.post("/book-stock/daily-entries", headers=h, json=body2)
    assert r.status_code == 200, r.text
    second = r.json()
    assert [s["opening_stock"] for s in second["field_stocks"]] == [95, 215]
    suggestion = client.get(
        "/book-stock/daily-entries/opening",
        headers=h,
        params={
            "entry_date": "2026-01-03",
            "entity_code": "ENT1",
            "block_code": "B1",
            "product_code": "OIL",
            "field_id": f1["id"],
        },
    )
    assert (
        suggestion.json()["opening_stock"] == second["field_stocks"][0]["closing_stock"]
    )
    body["field_stocks"][0]["opening_stock"] = 150
    r = client.put(f"/book-stock/daily-entries/{first['id']}", headers=h, json=body)
    assert r.status_code == 200, r.text
    r = client.get(f"/book-stock/daily-entries/{second['id']}", headers=h)
    assert [s["opening_stock"] for s in r.json()["field_stocks"]] == [145, 215]
    assert r.json()["opening_stock"] == 360
    summary = client.get("/book-stock/entity-summary", headers=h).json()
    assert summary["latest"][0]["closing_stock"] == r.json()["closing_stock"]
    gas = {
        "entry_date": "2026-01-02",
        "entity_code": "ENT1",
        "block_code": "B1",
        "product_code": "GAS",
        "field_stocks": [
            {
                "field_id": f1["id"],
                "opening_stock": 7,
                "sub_field_productions": [
                    {"sub_field_id": s1["id"], "production_qty": 3},
                    {"sub_field_id": s2["id"], "production_qty": 2},
                ],
            }
        ],
    }
    r = client.post("/book-stock/daily-entries", headers=h, json=gas)
    assert r.status_code == 200, r.text
    assert r.json()["closing_stock"] == 12
    r = client.delete(f"/book-stock/daily-entries/{first['id']}", headers=h)
    assert r.status_code == 200, r.text
    r = client.get(f"/book-stock/daily-entries/{second['id']}", headers=h)
    assert [s["opening_stock"] for s in r.json()["field_stocks"]] == [0, 0]


def test_hierarchy_validation_scope_and_bulk(client, db):
    h, f1, f2, s1, s2, s3 = setup(client, db)
    p = payload(f1, f2, s1, s2, s3)
    bad = payload(f1, f2, s1, s2, s3)
    bad["field_stocks"][0]["sub_field_productions"][0]["sub_field_id"] = s3["id"]
    assert (
        client.post("/book-stock/daily-entries", headers=h, json=bad).status_code == 400
    )
    bad = payload(f1, f2, s1, s2, s3)
    bad["field_stocks"].pop()
    assert (
        client.post("/book-stock/daily-entries", headers=h, json=bad).status_code == 400
    )
    bad = payload(f1, f2, s1, s2, s3)
    bad["field_stocks"][0]["dispatch"] = -1
    assert (
        client.post("/book-stock/daily-entries", headers=h, json=bad).status_code == 422
    )
    r = client.post(
        "/book-stock/daily-entries/bulk-upload", headers=h, json={"items": [p, p]}
    )
    assert r.status_code == 200, r.text
    assert (r.json()["imported"], r.json()["failed"]) == (1, 1)
    assert client.delete(f"/book-stock/fields/{f1['id']}", headers=h).status_code == 400
    scope, _ = _login(
        client,
        db,
        username="scoped",
        permissions=["View Book Stock Field"],
        locations=["OTHER"],
    )
    assert client.get("/book-stock/sub-fields", headers=scope).json() == []
    assert (
        client.post(
            "/book-stock/sub-fields",
            headers=scope,
            json={"field_id": f1["id"], "sub_field_code": "X", "sub_field_name": "X"},
        ).status_code
        == 403
    )


def test_legacy_preserved_and_default_source_idempotent(client, db):
    _seed_export_config(db)
    db.commit()
    h, _ = _login(client, db)
    _product(client, h, "OIL", "Oil")
    f = _field(client, h, "F1", "Field One", create_default=False)
    entry = BookStockDailyEntry(
        entry_date=date(2025, 1, 1),
        entity_code="ENT1",
        block_code="B1",
        product_code="OIL",
        opening_stock=100,
        production=20,
        dispatch=5,
        adjustment=0,
        closing_stock=115,
        opening_carried="No",
    )
    db.add(entry)
    db.flush()
    db.add(
        BookStockFieldProduction(
            entry_id=entry.id,
            field_id=f["id"],
            field_code="F1",
            field_name="Field One",
            entity_code="ENT1",
            block_code="B1",
            product_code="OIL",
            production_qty=20,
        )
    )
    db.flush()
    backfill_legacy_subfields(db)
    backfill_legacy_subfields(db)
    db.commit()
    assert db.query(BookStockSubField).count() == 1
    r = client.get(f"/book-stock/daily-entries/{entry.id}", headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["closing_stock"] == 115 and r.json()["legacy_block_entry"]
    assert (
        r.json()["field_productions"][0]["sub_field_productions"][0]["production_qty"]
        == 20
    )
    r = client.put(
        f"/book-stock/daily-entries/{entry.id}", headers=h, json={"dispatch": 1}
    )
    assert r.status_code == 400
    db.refresh(entry)
    assert entry.closing_stock == 115 and entry.dispatch == 5


def test_rounding_manual_anchor_and_failed_rollforward_rolls_back(client, db):
    h, f1, f2, s1, s2, s3 = setup(client, db)
    p1 = payload(f1, f2, s1, s2, s3)
    # Quantities are rounded before production totals are computed.
    p1["field_stocks"][0]["sub_field_productions"][0]["production_qty"] = 0.0000004
    p1["field_stocks"][0]["sub_field_productions"][1]["production_qty"] = 0.0000004
    first = client.post("/book-stock/daily-entries", headers=h, json=p1).json()
    assert first["field_stocks"][0]["production"] == 0
    assert (
        sum(
            x["production_qty"]
            for x in first["field_stocks"][0]["sub_field_productions"]
        )
        == 0
    )
    p2 = payload(f1, f2, s1, s2, s3, "2026-01-02")
    p2["field_stocks"][0].update(opening_stock=None, dispatch=60)
    p2["field_stocks"][0]["sub_field_productions"][0]["production_qty"] = 0
    p2["field_stocks"][0]["sub_field_productions"][1]["production_qty"] = 0
    p2["field_stocks"][0]["adjustment"] = 0
    p2["field_stocks"][1]["opening_stock"] = 500  # manual anchor
    second = client.post("/book-stock/daily-entries", headers=h, json=p2).json()
    assert second["field_stocks"][0]["closing_stock"] == 5
    r = client.put(
        "/book-stock/settings",
        headers=h,
        json={
            "settings": [{"config_key": "allow_negative_closing", "config_value": "No"}]
        },
    )
    assert r.status_code == 200
    p1["field_stocks"][0][
        "opening_stock"
    ] = 90  # first closes 55, but day 2 would close -5
    r = client.put(f"/book-stock/daily-entries/{first['id']}", headers=h, json=p1)
    assert r.status_code == 400, r.text
    assert (
        client.get(f"/book-stock/daily-entries/{first['id']}", headers=h).json()[
            "field_stocks"
        ][0]["opening_stock"]
        == 100
    )
    assert (
        client.get(f"/book-stock/daily-entries/{second['id']}", headers=h).json()[
            "field_stocks"
        ][1]["opening_stock"]
        == 500
    )
    # Deleting the first sheet would also make day 2 negative; it must be rolled back.
    r = client.delete(f"/book-stock/daily-entries/{first['id']}", headers=h)
    assert r.status_code == 400
    assert (
        client.get(f"/book-stock/daily-entries/{first['id']}", headers=h).status_code
        == 200
    )


def test_deactivated_subfield_history_can_be_edited_without_losing_production(
    client, db
):
    h, f1, f2, s1, s2, s3 = setup(client, db)
    p = payload(f1, f2, s1, s2, s3)
    first = client.post("/book-stock/daily-entries", headers=h, json=p).json()
    assert (
        client.delete(f"/book-stock/sub-fields/{s2['id']}", headers=h).status_code
        == 200
    )
    p["field_stocks"][0]["dispatch"] = 40
    r = client.put(f"/book-stock/daily-entries/{first['id']}", headers=h, json=p)
    assert r.status_code == 200, r.text
    assert r.json()["field_stocks"][0]["production"] == 30
    # A client cannot silently omit the old inactive production line.
    p["field_stocks"][0]["sub_field_productions"].pop()
    r = client.put(f"/book-stock/daily-entries/{first['id']}", headers=h, json=p)
    assert r.status_code == 400
    assert (
        client.get(f"/book-stock/daily-entries/{first['id']}", headers=h).json()[
            "production"
        ]
        == 80
    )


def test_legacy_cutover_requires_explicit_field_openings(client, db):
    h, f1, f2, s1, s2, s3 = setup(client, db)
    legacy = BookStockDailyEntry(
        entry_date=date(2025, 1, 1),
        entity_code="ENT1",
        block_code="B1",
        product_code="OIL",
        opening_stock=100,
        production=20,
        dispatch=5,
        adjustment=0,
        closing_stock=115,
        opening_carried="No",
    )
    db.add(legacy)
    db.commit()
    p = payload(f1, f2, s1, s2, s3)
    p["field_stocks"][0]["opening_stock"] = None
    r = client.post("/book-stock/daily-entries", headers=h, json=p)
    assert r.status_code == 400 and "explicit opening" in r.json()["detail"]
    suggestion = client.get(
        "/book-stock/daily-entries/opening",
        headers=h,
        params={
            "field_id": f1["id"],
            "entity_code": "ENT1",
            "block_code": "B1",
            "product_code": "OIL",
            "entry_date": "2026-01-01",
        },
    )
    assert suggestion.json()["legacy_block_previous"] is True
    p["field_stocks"][0]["opening_stock"] = 70
    r = client.post("/book-stock/daily-entries", headers=h, json=p)
    assert r.status_code == 200, r.text
    db.refresh(legacy)
    assert legacy.closing_stock == 115
    p["entry_date"] = "2024-12-31"
    assert (
        client.post("/book-stock/daily-entries", headers=h, json=p).status_code == 400
    )


def test_hierarchy_report_tables_respect_entity_scope(client, db):
    h, f1, f2, s1, s2, s3 = setup(client, db)
    _seed_export_config(db, location_code="LOC2", entity_code="ENT2", block_code="B2")
    db.commit()
    f3 = _field(
        client, h, "F3", "Other field", entity="ENT2", block="B2", create_default=False
    )
    sub3 = client.post(
        "/book-stock/sub-fields",
        headers=h,
        json={"field_id": f3["id"], "sub_field_code": "S3", "sub_field_name": "Other"},
    ).json()
    p = payload(f1, f2, s1, s2, s3)
    assert (
        client.post("/book-stock/daily-entries", headers=h, json=p).status_code == 200
    )
    other = {
        "entry_date": "2026-01-01",
        "entity_code": "ENT2",
        "block_code": "B2",
        "product_code": "OIL",
        "field_stocks": [
            {
                "field_id": f3["id"],
                "opening_stock": 9,
                "sub_field_productions": [
                    {"sub_field_id": sub3["id"], "production_qty": 8}
                ],
            }
        ],
    }
    assert (
        client.post("/book-stock/daily-entries", headers=h, json=other).status_code
        == 200
    )
    viewer, _ = _login(
        client,
        db,
        username="reportviewer",
        permissions=["Create Report Definition"],
        locations=["LOC1"],
    )
    for table in (
        "book_stock_sub_fields",
        "book_stock_field_stocks",
        "book_stock_sub_field_productions",
    ):
        definition = {
            "schema_version": 1,
            "report_type": "TABULAR",
            "source": {"kind": "table", "table": table},
            "date_basis": "NONE",
            "columns": [
                {
                    "key": "entity",
                    "label": "Entity",
                    "kind": "data",
                    "source": {"type": "column", "column": "entity_code"},
                    "data_type": "text",
                }
            ],
        }
        r = client.post(
            "/report-builder/run-preview",
            headers=viewer,
            json={"definition": definition},
        )
        assert r.status_code == 200, r.text
        assert r.json()["rows"] and {row["entity"] for row in r.json()["rows"]} == {
            "ENT1"
        }


def test_related_book_data_columns_obey_scope(client, db):
    h, _, _, _, _, _ = setup(client, db)
    _seed_export_config(db, location_code="LOC2", entity_code="ENT2", block_code="B2")
    db.commit()
    _field(
        client,
        h,
        "F3",
        "Other confidential field",
        entity="ENT2",
        block="B2",
        create_default=False,
    )
    viewer, _ = _login(
        client,
        db,
        username="joinviewer",
        permissions=["Create Report Definition"],
        locations=["LOC1"],
    )
    definition = {
        "schema_version": 1,
        "report_type": "TABULAR",
        "source": {"kind": "table", "table": "book_stock_field_products"},
        "date_basis": "NONE",
        "columns": [
            {
                "key": "field_id",
                "label": "ID",
                "kind": "data",
                "source": {"type": "column", "column": "field_id"},
                "data_type": "number",
            },
            {
                "key": "field_name",
                "label": "Name",
                "kind": "data",
                "source": {
                    "type": "related_column",
                    "table": "book_stock_fields",
                    "local_column": "field_id",
                    "remote_column": "id",
                    "column": "field_name",
                },
                "data_type": "text",
            },
        ],
    }
    r = client.post(
        "/report-builder/run-preview", headers=viewer, json={"definition": definition}
    )
    assert r.status_code == 200, r.text
    assert "Other confidential field" not in [
        row["field_name"] for row in r.json()["rows"]
    ]


def test_existing_carried_opening_survives_setting_change(client, db):
    h, f1, f2, s1, s2, s3 = setup(client, db)
    p1 = payload(f1, f2, s1, s2, s3)
    first = client.post("/book-stock/daily-entries", headers=h, json=p1).json()
    p2 = payload(f1, f2, s1, s2, s3, "2026-01-02")
    for stock in p2["field_stocks"]:
        stock["opening_stock"] = None
    second = client.post("/book-stock/daily-entries", headers=h, json=p2).json()
    assert (
        client.put(
            "/book-stock/settings",
            headers=h,
            json={
                "settings": [{"config_key": "auto_carry_opening", "config_value": "No"}]
            },
        ).status_code
        == 200
    )
    r = client.put(f"/book-stock/daily-entries/{second['id']}", headers=h, json=p2)
    assert r.status_code == 200, r.text
    assert [s["opening_carried"] for s in r.json()["field_stocks"]] == ["Yes", "Yes"]
    assert [s["opening_stock"] for s in r.json()["field_stocks"]] == [95, 215]
    p1["field_stocks"][0]["opening_stock"] = 120
    assert (
        client.put(
            f"/book-stock/daily-entries/{first['id']}", headers=h, json=p1
        ).status_code
        == 200
    )
    assert (
        client.get(f"/book-stock/daily-entries/{second['id']}", headers=h).json()[
            "field_stocks"
        ][0]["opening_stock"]
        == 115
    )


def test_existing_negative_history_does_not_block_unrelated_later_entry(client, db):
    h, f1, f2, s1, s2, s3 = setup(client, db)
    p1 = payload(f1, f2, s1, s2, s3)
    p1["field_stocks"][0]["opening_stock"] = 0
    p1["field_stocks"][0]["dispatch"] = 50
    first = client.post("/book-stock/daily-entries", headers=h, json=p1)
    assert (
        first.status_code == 200
        and first.json()["field_stocks"][0]["closing_stock"] < 0
    )
    assert (
        client.put(
            "/book-stock/settings",
            headers=h,
            json={
                "settings": [
                    {"config_key": "allow_negative_closing", "config_value": "No"}
                ]
            },
        ).status_code
        == 200
    )
    p2 = payload(f1, f2, s1, s2, s3, "2026-01-02")
    r = client.post("/book-stock/daily-entries", headers=h, json=p2)
    assert r.status_code == 200, r.text


def test_cannot_delete_manual_cutover_and_silently_erase_legacy_opening(client, db):
    h, f1, f2, s1, s2, s3 = setup(client, db)
    legacy = BookStockDailyEntry(
        entry_date=date(2025, 1, 1),
        entity_code="ENT1",
        block_code="B1",
        product_code="OIL",
        opening_stock=100,
        production=20,
        dispatch=5,
        adjustment=0,
        closing_stock=115,
        opening_carried="No",
    )
    db.add(legacy)
    db.commit()
    p1 = payload(f1, f2, s1, s2, s3)
    first = client.post("/book-stock/daily-entries", headers=h, json=p1).json()
    p2 = payload(f1, f2, s1, s2, s3, "2026-01-02")
    for stock in p2["field_stocks"]:
        stock["opening_stock"] = None
    second = client.post("/book-stock/daily-entries", headers=h, json=p2).json()
    result = client.delete(f"/book-stock/daily-entries/{first['id']}", headers=h)
    assert result.status_code == 400
    assert "explicit opening" in result.json()["detail"]
    assert (
        client.get(f"/book-stock/daily-entries/{first['id']}", headers=h).status_code
        == 200
    )
    assert (
        client.get(f"/book-stock/daily-entries/{second['id']}", headers=h).json()[
            "opening_stock"
        ]
        == 310
    )


def test_backfill_does_not_create_legacy_sources_for_new_entries(client, db):
    h, f1, f2, s1, s2, s3 = setup(client, db)
    assert (
        client.post(
            "/book-stock/daily-entries", headers=h, json=payload(f1, f2, s1, s2, s3)
        ).status_code
        == 200
    )
    backfill_legacy_subfields(db)
    backfill_legacy_subfields(db)
    db.commit()
    assert (
        db.query(BookStockSubField).filter_by(sub_field_code="__LEGACY__").count() == 0
    )


def test_additive_upgrade_retains_old_tables_and_rows(tmp_path):
    from sqlalchemy import create_engine, text
    from sqlalchemy.orm import Session
    from app.database import Base

    engine = create_engine(f"sqlite:///{tmp_path}/upgrade.db")
    # Simulate a deployment containing only the original Book Stock tables.
    for table in (
        "book_stock_fields",
        "book_stock_daily_entries",
        "book_stock_field_productions",
    ):
        Base.metadata.tables[table].create(engine)
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO book_stock_fields (id, field_code, field_name, entity_code, block_code, status) VALUES (1,'F1','Old field','ENT1','B1','Active')"
            )
        )
        conn.execute(
            text(
                "INSERT INTO book_stock_daily_entries (id, entry_date, entity_code, block_code, product_code, opening_stock, production, dispatch, adjustment, closing_stock, opening_carried) VALUES (1,'2025-01-01','ENT1','B1','OIL',100,20,5,0,115,'No')"
            )
        )
        conn.execute(
            text(
                "INSERT INTO book_stock_field_productions (id, entry_id, field_id, field_code, field_name, entity_code, block_code, product_code, production_qty) VALUES (1,1,1,'F1','Old field','ENT1','B1','OIL',20)"
            )
        )
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        backfill_legacy_subfields(db)
        backfill_legacy_subfields(db)
        db.commit()
        assert db.execute(
            text(
                "SELECT opening_stock, production, dispatch, closing_stock FROM book_stock_daily_entries"
            )
        ).one() == (100, 20, 5, 115)
        assert db.execute(
            text("SELECT field_code, production_qty FROM book_stock_field_productions")
        ).one() == ("F1", 20)
        assert db.query(BookStockSubField).count() == 1
    engine.dispose()


def test_block_totals_reject_overflow_atomically(client, db):
    h, f1, f2, s1, s2, s3 = setup(client, db)
    p = payload(f1, f2, s1, s2, s3)
    for stock in p["field_stocks"]:
        stock["opening_stock"] = 1e308
    r = client.post("/book-stock/daily-entries", headers=h, json=p)
    assert r.status_code == 400
    assert db.query(BookStockDailyEntry).count() == 0
