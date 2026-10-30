"""Report Builder: formula engine, catalog safety, JSON-to-columns,
tabular / grouped / matrix execution, access grants and location scoping."""

from datetime import date, time
from decimal import Decimal

import pytest

from app.models import (
    Asset,
    AssetType,
    Location,
    LocationAccountingDaySetting,
    OperationTemplate,
    OperationTemplateField,
    OperationTransaction,
    OperationTransactionValue,
    OperationType,
    Permission,
    Role,
    RolePermission,
    TankStockLedger,
    UserLocation,
)
from app.services.report_engine import ReportDefinitionError, starter_templates, validate_definition
from app.services.report_formula import FormulaError, evaluate, parse_formula, validate_formula
from tests.conftest import create_user

PASSWORD = "[SECURITY_DATA]"

BUILDER_PERMS = [
    "View Report Definition",
    "Create Report Definition",
    "Edit Report Definition",
    "Delete Report Definition",
    "Publish Report Definition",
    "View Custom Report",
    "Export Custom Report",
]


def _make_user(db, client, username, permissions, *, locations=None, all_locations=False):
    role = Role(role_name=f"{username}_role", status="Active")
    db.add(role)
    db.flush()
    for name in permissions:
        perm = db.query(Permission).filter(Permission.permission_name == name).first()
        if perm is None:
            perm = Permission(permission_name=name, module_name="Test", status="Active")
            db.add(perm)
            db.flush()
        db.add(RolePermission(role_id=role.id, permission_id=perm.id))
    user = create_user(db, username, PASSWORD, roles=[role])
    user.all_locations_access = "Yes" if all_locations else "No"
    for code in locations or []:
        db.add(UserLocation(user_id=user.id, location_code=code))
    db.commit()
    login = client.post("/auth/login", json={"username": username, "password": PASSWORD})
    assert login.status_code == 200, login.text
    return {"Authorization": f"Bearer {login.json()['access_token']}"}, user, role


def _seed(db):
    db.add_all([
        Location(location_code="BONNY", location_name="Bonny Terminal", location_type="Terminal", status="Active"),
        Location(location_code="ESC", location_name="Escravos Terminal", location_type="Terminal", status="Active"),
        AssetType(asset_type_code="TANK", asset_type_name="Tank", status="Active"),
        LocationAccountingDaySetting(
            location_code="BONNY", day_start_time=time(6, 1), day_end_time=time(6, 0),
            effective_from=date(2026, 1, 1), timezone_name="Africa/Lagos", status="Active",
        ),
    ])
    db.flush()
    db.add_all([
        Asset(asset_code="TK101", asset_name="Tank 101", asset_type_code="TANK", asset_scope="Location", location_code="BONNY", status="Active"),
        Asset(asset_code="TK201", asset_name="Tank 201", asset_type_code="TANK", asset_scope="Location", location_code="ESC", status="Active"),
        OperationType(
            operation_type_code="TANK_GAUGE", operation_type_name="Tank Gauging",
            applicable_asset_type_code="TANK", operation_category="Stock", status="Active",
        ),
    ])
    db.flush()
    template = OperationTemplate(
        template_name="Tank Gauging Form", operation_type_code="TANK_GAUGE",
        entry_layout_type="Tank Gauging", calculation_engine="TankQuantity", status="Active",
    )
    db.add(template)
    db.flush()
    db.add(OperationTemplateField(
        template_id=template.id, field_name="Tank Gauging Payload", field_code="tank_gauging_payload",
        data_type="JSON", field_group="Payload",
    ))
    db.flush()

    def gauging_tx(number, loc, tank, gauging_date, gauging_time, gsv, nsv):
        tx = OperationTransaction(
            operation_number=number, operation_ticket_number=f"TKT-{number}",
            operation_type_code="TANK_GAUGE", operation_template_id=template.id,
            origin_location_code=loc, primary_asset_type_code="TANK", primary_asset_code=tank,
            product_name="Bonny Light", operation_date=date(2026, 1, 1),  # stale header date on purpose
            status="Approved", created_by="Tester",
        )
        db.add(tx)
        db.flush()
        db.add(OperationTransactionValue(
            transaction_id=tx.id, field_code="tank_gauging_payload", field_name="Tank Gauging Payload",
            data_type="JSON",
            field_value={
                "inputs": {
                    "tankOperationCode": "OPENING", "tankOperationLabel": "Opening Stock",
                    "gaugingDate": gauging_date, "gaugingTime": gauging_time,
                },
                "calculated": {"gsvBbl": gsv, "nsvBbl": nsv, "lt": 10.0, "mt": 10.2},
            },
        ))
        db.flush()
        return tx

    # 05:30 gauging at BONNY (day starts 06:01) -> accounting date is the previous day
    tx1 = gauging_tx("OP-1", "BONNY", "TK101", "2026-10-20", "05:30", 1000.0, 990.0)
    tx2 = gauging_tx("OP-2", "BONNY", "TK101", "2026-10-20", "18:00", 2000.0, 1980.0)
    tx3 = gauging_tx("OP-3", "ESC", "TK201", "2026-10-20", "18:00", 500.0, 495.0)

    multi = OperationTransaction(
        operation_number="OP-MULTI", operation_ticket_number="TKT-OP-MULTI",
        operation_type_code="TANK_GAUGE", operation_template_id=template.id,
        origin_location_code="BONNY", primary_asset_type_code="TANK", primary_asset_code="TK101",
        product_name="Bonny Light", operation_date=date(2026, 10, 20), status="Approved", created_by="Tester",
    )
    db.add(multi)
    db.flush()
    db.add(OperationTransactionValue(
        transaction_id=multi.id, field_code="multi_tank_payload", field_name="Multi Tank Payload",
        data_type="JSON",
        field_value={
            "meta": {"assetCode": "TK101"},
            "inputs": {
                "before": {"date": "2026-10-20", "time": "07:00", "dips": {"T1": {"total": "100", "water": "5"}, "T2": {"total": "200", "water": "10"}}},
                "after": {"date": "2026-10-20", "time": "19:00", "dips": {"T1": {"total": "300", "water": "5"}, "T2": {"total": "260", "water": "12"}}},
            },
        },
    ))
    db.flush()

    for tx, category, movement in ((tx1, "OPENING", 990.0), (tx2, "RECEIPT", 990.0), (tx3, "OPENING", 495.0)):
        db.add(TankStockLedger(
            transaction_id=tx.id, ticket_number=tx.operation_ticket_number, operation_number=tx.operation_number,
            location_code=tx.origin_location_code, tank_asset_code=tx.primary_asset_code,
            operation_date=date(2026, 10, 20), accounting_date=date(2026, 10, 19) if tx is tx1 else date(2026, 10, 20),
            tank_operation_code=category, tank_operation_label=category.title(),
            tank_operation_category=category, tank_operation_sign="IN",
            movement_nsv_bbl=movement, movement_gsv_bbl=movement, movement_mt=10.0,
            running_balance_nsv_bbl=movement, status="Active",
            source_payload={"inputs": {"note": "ledger snap"}, "calculated": {"nsvBbl": movement}},
        ))
    db.commit()
    return template


def _gauging_definition(**overrides):
    definition = {
        "schema_version": 1,
        "report_type": "TABULAR",
        "source": {"kind": "operation_tickets", "operation_type_codes": ["TANK_GAUGE"], "statuses": ["Approved"]},
        "date_basis": "ACCOUNTING_DATE",
        "columns": [
            {"key": "ticket", "label": "Ticket", "kind": "data", "source": {"type": "column", "column": "operation_ticket_number"}, "data_type": "text"},
            {"key": "acct_date", "label": "Accounting Date", "kind": "data", "source": {"type": "virtual", "field": "accounting_date"}, "data_type": "date"},
            {"key": "location", "label": "Location", "kind": "data", "source": {"type": "column", "column": "origin_location_code"}, "data_type": "text"},
            {"key": "gsv", "label": "GSV", "kind": "data", "source": {"type": "payload_path", "field_code": "tank_gauging_payload", "path": "calculated.gsvBbl"}, "data_type": "number", "show_total": True},
            {"key": "nsv", "label": "NSV", "kind": "data", "source": {"type": "payload_path", "field_code": "tank_gauging_payload", "path": "calculated.nsvBbl"}, "data_type": "number", "show_total": True},
            {"key": "diff", "label": "GSV-NSV", "kind": "calculated", "formula": "[gsv] - [nsv]", "data_type": "number"},
            {"key": "diff_pct", "label": "Diff %", "kind": "calculated", "formula": "IFERROR([diff] % [gsv], 0)", "data_type": "number"},
            {"key": "size_band", "label": "Size", "kind": "calculated", "formula": 'IFS([nsv] >= 1500, "Large", [nsv] >= 900, "Medium", "Small")', "data_type": "text"},
        ],
        "filters": [],
        "runtime_filters": [{"key": "location", "label": "Location", "type": "location"}],
        "group_by": [],
        "sort": [{"key": "ticket", "direction": "asc"}],
        "options": {"show_totals": True},
    }
    definition.update(overrides)
    return definition


# ---------------------------------------------------------------------------
# Formula engine
# ---------------------------------------------------------------------------

def test_formula_arithmetic_percent_and_conditions():
    assert evaluate(parse_formula("[a] + [b] * 2"), {"a": 1, "b": 3}) == Decimal(7)
    assert evaluate(parse_formula("[a] % [b]"), {"a": 25, "b": 200}) == Decimal("12.5")
    assert evaluate(parse_formula("0.1 + 0.2"), {}) == Decimal("0.3")  # Decimal, no float noise
    assert evaluate(parse_formula('IF(AND([a] > 0, [b] <= 0.5), "OK", "Check")'), {"a": 5, "b": "0.4"}) == "OK"
    assert evaluate(parse_formula('IFS([a] >= 10, "L", [a] >= 5, "M", "S")'), {"a": 7}) == "M"
    assert evaluate(parse_formula('IF(NOT([s] = "Draft"), 1, 0)'), {"s": "Approved"}) == Decimal(1)
    assert evaluate(parse_formula("[a] - [b]"), {"a": 10, "b": None}) is None  # blank stays blank
    assert evaluate(parse_formula("SUM([a], [b], 5)"), {"a": None, "b": 2}) == Decimal(7)
    assert evaluate(parse_formula("COALESCE([a], 0) + 5"), {"a": None}) == Decimal(5)
    assert evaluate(parse_formula('CONCAT([loc], "-", [tank])'), {"loc": "BONNY", "tank": "TK101"}) == "BONNY-TK101"


def test_formula_divide_by_zero_and_iferror():
    with pytest.raises(FormulaError):
        evaluate(parse_formula("[a] / [b]"), {"a": 1, "b": 0})
    assert evaluate(parse_formula("IFERROR([a] / [b], 0)"), {"a": 1, "b": 0}) == Decimal(0)


def test_formula_validation_rejects_bad_input_and_injection():
    assert validate_formula("[a] + [zzz]", {"a"})["valid"] is False
    assert validate_formula("__import__('os')", set())["valid"] is False
    assert validate_formula("[a]; DROP TABLE users", {"a"})["valid"] is False
    assert validate_formula("NOSUCHFN([a])", {"a"})["valid"] is False


def test_definition_rejects_circular_calculated_columns():
    definition = _gauging_definition()
    definition["columns"] = [
        {"key": "a", "label": "A", "kind": "calculated", "formula": "[b] + 1"},
        {"key": "b", "label": "B", "kind": "calculated", "formula": "[a] + 1"},
    ]
    with pytest.raises(ReportDefinitionError):
        validate_definition(definition)


def test_definition_rejects_sensitive_and_unknown_sources():
    bad = {
        "schema_version": 1, "report_type": "TABULAR",
        "source": {"kind": "table", "table": "users"}, "date_basis": "NONE",
        "columns": [{"key": "pw", "label": "PW", "kind": "data", "source": {"type": "column", "column": "password_hash"}}],
    }
    with pytest.raises(ReportDefinitionError):
        validate_definition(bad)
    bad["columns"][0]["source"]["column"] = "username"
    bad["source"]["table"] = "token_blacklist"
    with pytest.raises(ReportDefinitionError):
        validate_definition(bad)


def test_starter_templates_are_valid():
    starters = starter_templates()
    assert len(starters) >= 4
    for starter in starters:
        validate_definition(starter["definition"])


# ---------------------------------------------------------------------------
# API behaviour
# ---------------------------------------------------------------------------

def test_catalog_excludes_secrets_but_covers_tables_and_json(client, db):
    _seed(db)
    headers, _, _ = _make_user(db, client, "designer", BUILDER_PERMS, all_locations=True)
    res = client.get("/report-builder/catalog", headers=headers)
    assert res.status_code == 200, res.text
    catalog = res.json()
    table_names = {t["table"] for t in catalog["tables"]}
    assert "operation_transactions" in table_names and "tank_stock_ledger" in table_names
    assert "token_blacklist" not in table_names and "auth_login_challenges" not in table_names
    users = next(t for t in catalog["tables"] if t["table"] == "users")
    user_columns = {c["column"] for c in users["columns"]}
    assert "username" in user_columns
    assert "password_hash" not in user_columns and "totp_secret_encrypted" not in user_columns
    ledger = next(t for t in catalog["tables"] if t["table"] == "tank_stock_ledger")
    assert "source_payload" in ledger["json_columns"]
    assert catalog["datasets"][0]["kind"] == "operation_tickets"


def test_catalog_requires_builder_permission(client, db):
    _seed(db)
    headers, _, _ = _make_user(db, client, "plainuser", ["View Custom Report"], all_locations=True)
    assert client.get("/report-builder/catalog", headers=headers).status_code == 403
    assert client.get("/report-builder/definitions", headers=headers).status_code == 403


def test_json_path_discovery_and_wildcards(client, db):
    _seed(db)
    headers, _, _ = _make_user(db, client, "designer2", BUILDER_PERMS, all_locations=True)
    res = client.post(
        "/report-builder/json-paths",
        json={"source_kind": "operation_tickets", "field_code": "tank_gauging_payload", "operation_type_codes": ["TANK_GAUGE"]},
        headers=headers,
    )
    assert res.status_code == 200, res.text
    paths = {p["path"] for p in res.json()["paths"]}
    assert "calculated.nsvBbl" in paths and "inputs.gaugingDate" in paths

    res = client.post(
        "/report-builder/json-paths",
        json={"source_kind": "operation_tickets", "field_code": "multi_tank_payload"},
        headers=headers,
    )
    assert res.status_code == 200, res.text
    wildcards = {p["path"] for p in res.json()["wildcard_paths"]}
    assert "inputs.before.dips.*.total" in wildcards
    assert "inputs.before.dips.@key" in wildcards


def test_run_tickets_report_payload_dates_and_calcs(client, db):
    _seed(db)
    headers, _, _ = _make_user(db, client, "designer3", BUILDER_PERMS, all_locations=True)
    res = client.post(
        "/report-builder/run-preview",
        json={"definition": _gauging_definition(), "date_from": "2026-10-19", "date_to": "2026-10-20"},
        headers=headers,
    )
    assert res.status_code == 200, res.text
    result = res.json()
    rows = {row["ticket"]: row for row in result["rows"]}
    # TKT-OP-MULTI also matches the type filter; its gauging quantities are blank.
    assert set(rows) == {"TKT-OP-1", "TKT-OP-2", "TKT-OP-3", "TKT-OP-MULTI"}
    assert rows["TKT-OP-MULTI"]["gsv"] is None
    # 05:30 gauging with 06:01 day start -> previous accounting day
    assert rows["TKT-OP-1"]["acct_date"] == "2026-10-19"
    assert rows["TKT-OP-2"]["acct_date"] == "2026-10-20"
    assert rows["TKT-OP-1"]["diff"] == 10.0
    assert rows["TKT-OP-1"]["diff_pct"] == 1.0
    assert rows["TKT-OP-2"]["size_band"] == "Large"
    assert rows["TKT-OP-3"]["size_band"] == "Small"
    assert result["totals"]["nsv"] == 3465.0

    res = client.post(
        "/report-builder/run-preview",
        json={"definition": _gauging_definition(), "date_from": "2026-10-20", "date_to": "2026-10-20"},
        headers=headers,
    )
    tickets = {row["ticket"] for row in res.json()["rows"]}
    assert tickets == {"TKT-OP-2", "TKT-OP-3", "TKT-OP-MULTI"}  # OP-1 belongs to 19th accounting day


def test_explode_per_tank_dips(client, db):
    _seed(db)
    headers, _, _ = _make_user(db, client, "designer4", BUILDER_PERMS, all_locations=True)
    definition = {
        "schema_version": 1, "report_type": "TABULAR",
        "source": {"kind": "operation_tickets", "statuses": ["Approved"]},
        "date_basis": "NONE",
        "columns": [
            {"key": "ticket", "label": "Ticket", "kind": "data", "source": {"type": "column", "column": "operation_ticket_number"}, "data_type": "text"},
            {"key": "tank_id", "label": "Tank", "kind": "data", "source": {"type": "payload_path", "field_code": "multi_tank_payload", "path": "inputs.before.dips.@key"}, "data_type": "text"},
            {"key": "dip_before", "label": "Dip Before", "kind": "data", "source": {"type": "payload_path", "field_code": "multi_tank_payload", "path": "inputs.before.dips.*.total"}, "data_type": "number"},
        ],
        "sort": [{"key": "tank_id", "direction": "asc"}],
    }
    res = client.post("/report-builder/run-preview", json={"definition": definition}, headers=headers)
    assert res.status_code == 200, res.text
    rows = res.json()["rows"]
    assert [(r["tank_id"], float(r["dip_before"])) for r in rows] == [("T1", 100.0), ("T2", 200.0)]


def test_grouped_and_matrix_ledger_reports(client, db):
    _seed(db)
    headers, _, _ = _make_user(db, client, "designer5", BUILDER_PERMS, all_locations=True)
    grouped = {
        "schema_version": 1, "report_type": "TABULAR",
        "source": {"kind": "tank_stock_ledger"}, "date_basis": "ACCOUNTING_DATE",
        "columns": [
            {"key": "location", "label": "Location", "kind": "data", "source": {"type": "column", "column": "location_code"}, "data_type": "text"},
            {"key": "movement", "label": "Movement NSV", "kind": "data", "source": {"type": "column", "column": "movement_nsv_bbl"}, "data_type": "number", "aggregate": "SUM", "show_total": True},
        ],
        "group_by": [{"key": "location"}],
        "sort": [{"key": "location", "direction": "asc"}],
        "options": {"show_totals": True},
    }
    res = client.post("/report-builder/run-preview", json={"definition": grouped}, headers=headers)
    assert res.status_code == 200, res.text
    rows = {r["location"]: r["movement"] for r in res.json()["rows"]}
    assert rows == {"BONNY": 1980.0, "ESC": 495.0}
    assert res.json()["totals"]["movement"] == 2475.0

    matrix = {
        "schema_version": 1, "report_type": "MATRIX",
        "source": {"kind": "tank_stock_ledger"}, "date_basis": "ACCOUNTING_DATE",
        "columns": [
            {"key": "location", "label": "Location", "kind": "data", "source": {"type": "column", "column": "location_code"}, "data_type": "text"},
            {"key": "category", "label": "Category", "kind": "data", "source": {"type": "column", "column": "tank_operation_category"}, "data_type": "text"},
            {"key": "movement", "label": "Movement NSV", "kind": "data", "source": {"type": "column", "column": "movement_nsv_bbl"}, "data_type": "number"},
        ],
        "matrix": {"row_keys": ["location"], "column_key": "category", "value_key": "movement", "aggregate": "SUM", "show_row_totals": True},
        "options": {"show_totals": True},
    }
    res = client.post("/report-builder/run-preview", json={"definition": matrix}, headers=headers)
    assert res.status_code == 200, res.text
    result = res.json()
    labels = [c["label"] for c in result["columns"]]
    assert labels == ["Location", "OPENING", "RECEIPT", "Total"]
    bonny = next(r for r in result["rows"] if r["location"] == "BONNY")
    opening_key = result["columns"][1]["key"]
    receipt_key = result["columns"][2]["key"]
    assert bonny[opening_key] == 990.0 and bonny[receipt_key] == 990.0 and bonny["__row_total"] == 1980.0


def test_grouped_comparison_columns_reuse_one_quantity_with_private_rules(client, db):
    """One DB quantity can become Dispatch and Receipt columns independently."""
    template = _seed(db)
    headers, _, _ = _make_user(db, client, "comparison_designer", BUILDER_PERMS, all_locations=True)

    dispatch_ticket = OperationTransaction(
        operation_number="OP-DISPATCH-COMP", operation_ticket_number="TKT-DISPATCH-COMP",
        operation_type_code="TANK_GAUGE", operation_template_id=template.id,
        origin_location_code="BONNY", primary_asset_type_code="TANK", primary_asset_code="TK101",
        product_name="Bonny Light", operation_date=date(2026, 10, 21), status="Approved", created_by="Tester",
    )
    receipt_ticket = OperationTransaction(
        operation_number="OP-RECEIPT-COMP", operation_ticket_number="TKT-RECEIPT-COMP",
        operation_type_code="TANK_GAUGE", operation_template_id=template.id,
        origin_location_code="ESC", primary_asset_type_code="TANK", primary_asset_code="TK201",
        product_name="Bonny Light", operation_date=date(2026, 10, 21), status="Approved", created_by="Tester",
    )
    db.add_all([dispatch_ticket, receipt_ticket])
    db.flush()
    db.add_all([
        TankStockLedger(
            transaction_id=dispatch_ticket.id, ticket_number=dispatch_ticket.operation_ticket_number,
            operation_number=dispatch_ticket.operation_number, location_code="BONNY", tank_asset_code="TK101",
            operation_date=date(2026, 10, 21), accounting_date=date(2026, 10, 21),
            tank_operation_code="DISPATCH", tank_operation_label="Dispatch",
            tank_operation_category="DISPATCH", tank_operation_sign="OUT",
            movement_nsv_bbl=100.0, movement_gsv_bbl=100.0, movement_mt=10.0, status="Active",
        ),
        TankStockLedger(
            transaction_id=receipt_ticket.id, ticket_number=receipt_ticket.operation_ticket_number,
            operation_number=receipt_ticket.operation_number, location_code="ESC", tank_asset_code="TK201",
            operation_date=date(2026, 10, 21), accounting_date=date(2026, 10, 21),
            tank_operation_code="RECEIPT", tank_operation_label="Receipt",
            tank_operation_category="RECEIPT", tank_operation_sign="IN",
            movement_nsv_bbl=97.0, movement_gsv_bbl=97.0, movement_mt=9.7, status="Active",
        ),
    ])
    db.commit()

    # The condition fields (location + operation category) are deliberately
    # not report columns. The engine must load them privately for each measure.
    definition = {
        "schema_version": 1, "report_type": "TABULAR",
        "source": {"kind": "tank_stock_ledger"}, "date_basis": "ACCOUNTING_DATE",
        "columns": [
            {"key": "accounting_date", "label": "Accounting Date", "kind": "data", "source": {"type": "column", "column": "accounting_date"}, "data_type": "date"},
            {
                "key": "bonny_dispatch", "label": "Bonny Dispatch NSV", "kind": "data",
                "source": {"type": "column", "column": "movement_nsv_bbl"}, "data_type": "number",
                "aggregate": "SUM", "show_total": True,
                "value_conditions": [
                    {"source": {"type": "column", "column": "location_code"}, "operator": "eq", "value": "BONNY"},
                    {"source": {"type": "column", "column": "tank_operation_category"}, "operator": "eq", "value": "DISPATCH"},
                ],
                "value_condition_logic": "AND",
            },
            {
                "key": "esc_receipt", "label": "Escravos Receipt NSV", "kind": "data",
                "source": {"type": "column", "column": "movement_nsv_bbl"}, "data_type": "number",
                "aggregate": "SUM", "show_total": True,
                "value_conditions": [
                    {"source": {"type": "column", "column": "location_code"}, "operator": "eq", "value": "ESC"},
                    {"source": {"type": "column", "column": "tank_operation_category"}, "operator": "eq", "value": "RECEIPT"},
                ],
                "value_condition_logic": "AND",
            },
            {
                "key": "variance", "label": "Dispatch − Receipt", "kind": "calculated",
                "formula": "COALESCE([bonny_dispatch], 0) - COALESCE([esc_receipt], 0)", "data_type": "number",
                "aggregate": "SUM", "show_total": True,
            },
        ],
        "group_by": [{"key": "accounting_date", "bucket": "DAY"}],
        "sort": [{"key": "accounting_date", "direction": "asc"}],
        "options": {"show_totals": True},
    }
    res = client.post(
        "/report-builder/run-preview",
        json={"definition": definition, "date_from": "2026-10-21", "date_to": "2026-10-21"},
        headers=headers,
    )
    assert res.status_code == 200, res.text
    result = res.json()
    assert result["rows"] == [{
        "accounting_date": "2026-10-21", "bonny_dispatch": 100.0,
        "esc_receipt": 97.0, "variance": 3.0,
    }]
    assert result["totals"] == {"bonny_dispatch": 100.0, "esc_receipt": 97.0, "variance": 3.0}
    assert [column["key"] for column in result["columns"]] == [
        "accounting_date", "bonny_dispatch", "esc_receipt", "variance",
    ]

    bad = {**definition, "columns": [*definition["columns"]]}
    bad["columns"][1] = {
        **definition["columns"][1],
        "value_conditions": [{"source": {"type": "column", "column": "password_hash"}, "operator": "eq", "value": "x"}],
    }
    with pytest.raises(ReportDefinitionError):
        validate_definition(bad)


def _create_report(client, headers, name="Gauging NSV Report", **kwargs):
    payload = {
        "report_name": name,
        "description": "Test report",
        "definition": _gauging_definition(),
        "visibility": kwargs.get("visibility", "PRIVATE"),
        "is_published": kwargs.get("is_published", False),
        "grants": kwargs.get("grants", []),
    }
    res = client.post("/report-builder/definitions", json=payload, headers=headers)
    assert res.status_code == 200, res.text
    return res.json()


def test_create_publish_and_run_with_role_grant(client, db):
    _seed(db)
    owner_headers, _, _ = _make_user(db, client, "owner1", BUILDER_PERMS, all_locations=True)
    viewer_headers, _, viewer_role = _make_user(db, client, "viewer1", ["View Custom Report", "Export Custom Report"], all_locations=True)
    outsider_headers, _, _ = _make_user(db, client, "outsider1", ["View Custom Report"], all_locations=True)

    report = _create_report(client, owner_headers, grants=[{"grant_type": "ROLE", "role_id": viewer_role.id, "access_level": "VIEW"}])
    assert report["is_published"] is False
    # Unpublished: invisible in Reporting even to grantees
    assert client.get("/report-builder/my-reports", headers=viewer_headers).json() == []

    res = client.post(f"/report-builder/definitions/{report['id']}/publish", json={"published": True}, headers=owner_headers)
    assert res.status_code == 200, res.text
    assert [r["id"] for r in client.get("/report-builder/my-reports", headers=viewer_headers).json()] == [report["id"]]
    assert client.get("/report-builder/my-reports", headers=outsider_headers).json() == []
    assert client.post(f"/report-builder/my-reports/{report['id']}/run", json={}, headers=outsider_headers).status_code == 404

    run = client.post(f"/report-builder/my-reports/{report['id']}/run", json={"date_from": "2026-10-19", "date_to": "2026-10-20"}, headers=viewer_headers)
    assert run.status_code == 200, run.text
    assert run.json()["meta"]["total_rows"] == 4

    export = client.post(f"/report-builder/my-reports/{report['id']}/export", json={"format": "csv", "date_from": "2026-10-19", "date_to": "2026-10-20"}, headers=viewer_headers)
    assert export.status_code == 200
    assert "TKT-OP-1" in export.text
    export_xlsx = client.post(f"/report-builder/my-reports/{report['id']}/export", json={"format": "xlsx"}, headers=viewer_headers)
    assert export_xlsx.status_code == 200
    assert export_xlsx.content[:2] == b"PK"


def test_location_grant_and_runner_location_scope(client, db):
    _seed(db)
    owner_headers, _, _ = _make_user(db, client, "owner2", BUILDER_PERMS, all_locations=True)
    esc_headers, _, _ = _make_user(db, client, "escuser", ["View Custom Report"], locations=["ESC"])
    report = _create_report(
        client, owner_headers, name="Shared By Location", is_published=True,
        grants=[{"grant_type": "LOCATION", "location_code": "ESC", "access_level": "VIEW"}],
    )
    assert [r["id"] for r in client.get("/report-builder/my-reports", headers=esc_headers).json()] == [report["id"]]
    run = client.post(f"/report-builder/my-reports/{report['id']}/run", json={"date_from": "2026-10-01", "date_to": "2026-10-31"}, headers=esc_headers)
    assert run.status_code == 200, run.text
    locations = {row["location"] for row in run.json()["rows"]}
    assert locations == {"ESC"}  # BONNY rows hidden by the runner's own scope


def test_publish_requires_publish_permission_and_bad_definition_rejected(client, db):
    _seed(db)
    headers, _, _ = _make_user(
        db, client, "nopublish",
        ["View Report Definition", "Create Report Definition", "Edit Report Definition"],
        all_locations=True,
    )
    report = _create_report(client, headers, name="Draft Only")
    res = client.post(f"/report-builder/definitions/{report['id']}/publish", json={"published": True}, headers=headers)
    assert res.status_code == 403

    bad = {
        "report_name": "Broken", "definition": _gauging_definition(),
    }
    bad["definition"]["columns"][5]["formula"] = "[gsv] + [nope]"
    res = client.post("/report-builder/definitions", json=bad, headers=headers)
    assert res.status_code == 400


def test_from_starter_creates_runnable_report(client, db):
    _seed(db)
    headers, _, _ = _make_user(db, client, "starteruser", BUILDER_PERMS, all_locations=True)
    starters = client.get("/report-builder/starter-templates", headers=headers).json()
    assert any(s["id"] == "ticket-register" for s in starters)
    res = client.post("/report-builder/definitions/from-starter", json={"starter_id": "ticket-register"}, headers=headers)
    assert res.status_code == 200, res.text
    report_id = res.json()["id"]
    run = client.post(
        f"/report-builder/definitions/{report_id}/run",
        json={"date_from": "2026-10-19", "date_to": "2026-10-20"},
        headers=headers,
    )
    assert run.status_code == 200, run.text
    assert run.json()["meta"]["total_rows"] >= 3


def test_update_creates_version_and_owner_only_delete(client, db):
    _seed(db)
    owner_headers, _, _ = _make_user(db, client, "owner3", BUILDER_PERMS, all_locations=True)
    editor_headers, editor_user, _ = _make_user(db, client, "editor1", BUILDER_PERMS, all_locations=True)
    report = _create_report(
        client, owner_headers, name="Versioned",
        grants=[{"grant_type": "USER", "user_id": editor_user.id, "access_level": "EDIT"}],
    )
    update = {
        "report_name": "Versioned v2", "description": "x", "definition": report["definition"],
        "visibility": "PRIVATE", "is_published": False,
        "grants": [{"grant_type": "USER", "user_id": editor_user.id, "access_level": "EDIT"}],
    }
    res = client.put(f"/report-builder/definitions/{report['id']}", json=update, headers=editor_headers)
    assert res.status_code == 200, res.text
    assert res.json()["version"] == 2
    versions = client.get(f"/report-builder/definitions/{report['id']}/versions", headers=owner_headers).json()
    assert [v["version_number"] for v in versions] == [2, 1]
    # Editor (not owner) cannot delete
    assert client.delete(f"/report-builder/definitions/{report['id']}", headers=editor_headers).status_code == 404
    assert client.delete(f"/report-builder/definitions/{report['id']}", headers=owner_headers).status_code == 200


def test_related_table_columns_and_calculation(client, db):
    _seed(db)
    headers, _, _ = _make_user(db, client, "joined_designer", BUILDER_PERMS, locations=["BONNY"])
    relation = {"type": "related_column", "table": "operation_transactions", "local_column": "transaction_id", "remote_column": "id"}
    definition = {
        "schema_version": 1, "report_type": "TABULAR",
        "source": {"kind": "table", "table": "tank_stock_ledger"}, "date_basis": "NONE",
        "columns": [
            {"key": "ledger_id", "label": "Ledger ID", "kind": "data", "source": {"type": "column", "column": "id"}, "data_type": "number"},
            {"key": "ticket_id", "label": "Ticket ID", "kind": "data", "source": {**relation, "column": "id"}, "data_type": "number"},
            {"key": "total", "label": "Total", "kind": "calculated", "formula": "[ledger_id] + [ticket_id]", "data_type": "number"},
        ],
    }
    response = client.post('/report-builder/run-preview', json={"definition": definition}, headers=headers)
    assert response.status_code == 200, response.text
    rows = response.json()["rows"]
    assert len(rows) == 2
    assert all(float(r["total"]) == r["ledger_id"] + r["ticket_id"] for r in rows)
    definition["columns"][1]["source"]["column"] = "password_hash"
    response = client.post('/report-builder/run-preview', json={"definition": definition}, headers=headers)
    assert response.status_code == 400
    definition["columns"][1]["source"].update(column="id", local_column="id")
    response = client.post('/report-builder/run-preview', json={"definition": definition}, headers=headers)
    assert response.status_code == 400


def _date_group_definition(aggregate="SUM", period="YEAR"):
    return {
        "schema_version": 1, "report_type": "TABULAR",
        "source": {"kind": "tank_stock_ledger"}, "date_basis": "ACCOUNTING_DATE",
        "columns": [
            {"key": "date", "label": "Accounting Date", "source": {"type": "column", "column": "accounting_date"}, "data_type": "date"},
            {"key": "movement", "label": "Movement", "source": {"type": "column", "column": "movement_nsv_bbl"}, "data_type": "number", "aggregate": aggregate, "show_total": True},
        ],
        "group_by": [{"key": "date", "bucket": period}],
        "sort": [{"key": "date", "direction": "asc"}],
        "options": {"show_totals": True},
    }


def test_date_periods_products_and_group_totals(client, db):
    from app.services.report_engine import _aggregate, _bucket_value

    assert [_bucket_value(date(2026, m, 1), "QUARTER") for m in (1, 3, 4, 6, 7, 9, 10, 12)] == ["2026-Q1"] * 2 + ["2026-Q2"] * 2 + ["2026-Q3"] * 2 + ["2026-Q4"] * 2
    assert _bucket_value(date(2025, 12, 31), "QUARTER") == "2025-Q4"
    assert _aggregate([None, "", 2, 0, 4], "PRODUCT") == 0
    assert _aggregate([None, ""], "PRODUCT") is None
    assert _aggregate([Decimal("1e300")] * 3 + [0], "PRODUCT") == 0
    with pytest.raises(ReportDefinitionError, match="too large"):
        _aggregate([Decimal("1e300")] * 3, "PRODUCT")
    _seed(db)
    headers, _, _ = _make_user(db, client, "date_period_designer", BUILDER_PERMS, all_locations=True)
    ledgers = db.query(TankStockLedger).order_by(TankStockLedger.id).all()
    ledgers[0].accounting_date = date(2025, 12, 31)
    ledgers[0].movement_nsv_bbl = 2
    ledgers[1].accounting_date = date(2026, 1, 1)
    ledgers[1].movement_nsv_bbl = 3
    ledgers[2].accounting_date = date(2026, 2, 1)
    ledgers[2].movement_nsv_bbl = 4
    db.commit()
    expected = {"SUM": (7, 9), "PRODUCT": (12, 24), "MIN": (3, 2), "MAX": (4, 4), "AVG": (3.5, 3), "COUNT": (2, 3)}
    for aggregate, (second, total) in expected.items():
        definition = _date_group_definition(aggregate, "YEAR")
        response = client.post("/report-builder/run-preview", json={"definition": definition}, headers=headers)
        assert response.status_code == 200, response.text
        assert response.json()["rows"][1]["movement"] == second
        assert response.json()["totals"]["movement"] == total
    definition = _date_group_definition("PRODUCT", "QUARTER")
    response = client.post("/report-builder/run-preview", json={"definition": definition}, headers=headers)
    assert response.status_code == 200, response.text
    assert response.json()["rows"] == [{"date": "2025-Q4", "movement": 2.0}, {"date": "2026-Q1", "movement": 12.0}]
    matrix = {**definition, "report_type": "MATRIX", "group_by": [], "matrix": {"row_keys": ["movement"], "column_key": "date", "column_bucket": "QUARTER", "value_key": "movement", "aggregate": "PRODUCT"}}
    response = client.post("/report-builder/run-preview", json={"definition": matrix}, headers=headers)
    assert response.status_code == 200, response.text
    assert [c["label"] for c in response.json()["columns"]] == ["Movement", "2025-Q4", "2026-Q1", "Total"]
    assert response.json()["totals"]["__row_total"] == 24


def test_saved_date_drill_and_export_preserve_filters_and_access(client, db):
    _seed(db)
    owner_headers, _, _ = _make_user(db, client, "drill_owner", BUILDER_PERMS, all_locations=True)
    viewer_headers, _, role = _make_user(db, client, "drill_viewer", ["View Custom Report", "Export Custom Report"], locations=["BONNY"])
    definition = _date_group_definition("SUM", "YEAR")
    create = client.post("/report-builder/definitions", json={"report_name": "Drill Dates", "definition": definition, "is_published": True, "grants": [{"grant_type": "ROLE", "role_id": role.id, "access_level": "VIEW"}]}, headers=owner_headers)
    assert create.status_code == 200, create.text
    report_id = create.json()["id"]
    base = f"/report-builder/my-reports/{report_id}"
    path = [{"bucket": "YEAR", "value": "2026"}, {"bucket": "QUARTER", "value": "2026-Q4"}]
    drill = {"key": "date", "bucket": "MONTH", "path": path}
    run = client.post(base + "/run", json={"date_drill": drill}, headers=viewer_headers)
    assert run.status_code == 200, run.text
    assert run.json()["rows"] == [{"date": "2026-10", "movement": 1980.0}]
    drill.update(bucket="DAY", path=path + [{"bucket": "MONTH", "value": "2026-10"}])
    run = client.post(base + "/run", json={"date_drill": drill, "date_from": "2026-10-20"}, headers=viewer_headers)
    assert run.status_code == 200, run.text
    assert run.json()["rows"] == [{"date": "2026-10-20", "movement": 990.0}]
    drill.update(bucket="DETAIL", path=drill["path"] + [{"bucket": "DAY", "value": "2026-10-20"}])
    run = client.post(base + "/run", json={"date_drill": drill}, headers=viewer_headers)
    assert run.status_code == 200, run.text
    assert run.json()["rows"] == [{"date": "2026-10-20", "movement": 990.0}]
    export = client.post(base + "/export", json={"date_drill": drill, "format": "csv"}, headers=viewer_headers)
    assert export.status_code == 200
    assert "2026-10-20" in export.text and "2026-10-19" not in export.text
    assert client.get(f"/report-builder/definitions/{report_id}", headers=owner_headers).json()["definition"]["group_by"] == [{"key": "date", "bucket": "YEAR"}]
    invalid = client.post(base + "/run", json={"date_drill": {"key": "movement", "bucket": "DAY", "path": []}}, headers=viewer_headers)
    assert invalid.status_code == 400
