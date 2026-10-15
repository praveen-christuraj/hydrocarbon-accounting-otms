"""Regression tests for bounded loading / performance fixes.

Covers:
- No 307 Temporary Redirect on the canonical (no trailing slash) URLs for
  Location Operation Availability, Audit Logs and Operation Entries --
  those routers used to register "/" while the frontend calls "".
- ``GET /operation-transactions`` is capped by ``limit`` and returns
  register rows (batched lookups) instead of streaming full history.
- Tank Operation Summary only loads the most recent 90 days when no date
  range is given, reports the full ``total_rows``, and loads older data
  when an explicit date range is supplied.
- Out-Turn Summary keeps previous-stock continuity across the default
  window (chain seeded from the preceding snapshot).
"""

from datetime import date, timedelta

from app.models import (
    OperationTemplate,
    OperationTransaction,
    OperationTransactionValue,
    OperationType,
    Permission,
    RolePermission,
)
from tests.conftest import create_role_with_permission, create_user


def _auth_headers(client, db, *permission_names, username="perfadmin"):
    role, _perm = create_role_with_permission(
        db, "Admin", permission_names[0], module_name="Operations"
    )
    for name in permission_names[1:]:
        perm = Permission(permission_name=name, module_name="Operations", status="Active")
        db.add(perm)
        db.flush()
        db.add(RolePermission(role_id=role.id, permission_id=perm.id))
    create_user(db, username, "TestPass123!", roles=[role])
    db.commit()

    login = client.post(
        "/auth/login", json={"username": username, "password": "TestPass123!"}
    )
    assert login.status_code == 200, login.text
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def _seed_template(db):
    db.add(
        OperationType(
            operation_type_name="Tank Operations",
            operation_type_code="TANK_OPS",
            applicable_asset_type_code="TANK",
            operation_category="Stock",
            status="Active",
        )
    )
    template = OperationTemplate(
        template_name="Tank Gauging Template",
        operation_type_code="TANK_OPS",
        entry_layout_type="Tank Gauging",
        calculation_engine="Tank Quantity",
        status="Active",
    )
    db.add(template)
    db.flush()
    return template


def _seed_gauging(db, template, number, op_date, nsv=1000.0):
    tx = OperationTransaction(
        operation_number=number,
        operation_type_code="TANK_OPS",
        operation_template_id=template.id,
        primary_asset_code="AGGE_TANK_01",
        primary_asset_type_code="TANK",
        origin_location_code="AGGE",
        product_name="Crude",
        operation_date=op_date,
        status="Approved",
    )
    db.add(tx)
    db.flush()
    db.add(
        OperationTransactionValue(
            transaction_id=tx.id,
            field_code="tank_gauging_payload",
            field_name="Tank Gauging Payload",
            data_type="JSON",
            input_mode="System",
            calculation_role="Payload",
            field_value={
                "inputs": {"tankOperationCode": "RECEIPT"},
                "calculated": {
                    "gsvBbl": nsv + 10,
                    "nsvBbl": nsv,
                    "lt": 130.0,
                    "mt": 132.0,
                },
            },
        )
    )
    db.flush()
    return tx


# ---------------------------------------------------------------------------
# Trailing-slash redirects
# ---------------------------------------------------------------------------


def test_canonical_urls_do_not_redirect(client):
    # Unauthenticated on purpose: a route mismatch answers 307 here, while a
    # matched route reaches the auth dependency and answers 401.
    for path in (
        "/location-operation-availability",
        "/audit-logs",
        "/operation-entries",
    ):
        response = client.get(path, follow_redirects=False)
        assert response.status_code == 401, (path, response.status_code)


# ---------------------------------------------------------------------------
# Operation transaction list cap
# ---------------------------------------------------------------------------


def test_operation_transactions_list_is_bounded(client, db):
    headers = _auth_headers(client, db, "View Operation Transaction")
    template = _seed_template(db)
    for index in range(5):
        _seed_gauging(db, template, f"OP-L-{index}", date(2026, 8, 10) + timedelta(days=index))
    db.commit()

    capped = client.get("/operation-transactions?limit=2", headers=headers)
    assert capped.status_code == 200, capped.text
    assert len(capped.json()) == 2
    # Register-row shape with batched name/field-count lookups.
    assert capped.json()[0]["field_count"] == 1

    default = client.get("/operation-transactions", headers=headers)
    assert default.status_code == 200, default.text
    assert len(default.json()) == 5


def test_operation_transactions_paged_still_works(client, db):
    headers = _auth_headers(client, db, "View Operation Transaction")
    template = _seed_template(db)
    for index in range(3):
        _seed_gauging(db, template, f"OP-P-{index}", date(2026, 8, 10) + timedelta(days=index))
    db.commit()

    response = client.get(
        "/operation-transactions/paged?page=1&page_size=2", headers=headers
    )
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["total_rows"] == 3
    assert len(data["rows"]) == 2
    assert data["rows"][0]["field_count"] == 1
    assert data["has_more"] is True


# ---------------------------------------------------------------------------
# Tank Operation Summary default window
# ---------------------------------------------------------------------------


def test_tank_summary_default_window_and_older_data(client, db):
    headers = _auth_headers(client, db, "View Tank Operation Summary")
    template = _seed_template(db)
    _seed_gauging(db, template, "OP-OLD", date(2025, 1, 1), nsv=500.0)
    _seed_gauging(db, template, "OP-RECENT", date(2026, 8, 12), nsv=990.0)
    db.commit()

    # No date filter: only the recent (90-day window) row is loaded.
    default = client.get("/tank-operation-summary", headers=headers)
    assert default.status_code == 200, default.text
    data = default.json()
    assert data["default_window_applied"] is True
    assert data["total_rows"] == 1
    assert [row["operation_number"] for row in data["rows"]] == ["OP-RECENT"]

    # Explicit older range loads the older data.
    older = client.get(
        "/tank-operation-summary?date_from=2024-12-01&date_to=2025-02-01",
        headers=headers,
    )
    assert older.status_code == 200, older.text
    older_data = older.json()
    assert older_data["default_window_applied"] is False
    assert [row["operation_number"] for row in older_data["rows"]] == ["OP-OLD"]


# ---------------------------------------------------------------------------
# Out-Turn Summary window + previous-stock continuity
# ---------------------------------------------------------------------------


def test_out_turn_summary_window_keeps_previous_stock(client, db):
    headers = _auth_headers(client, db, "View Out-Turn Summary")
    template = _seed_template(db)
    # Pre-window snapshot, then two tickets inside the default window.
    base = date(2026, 8, 12)
    _seed_gauging(db, template, "OP-BASE", base - timedelta(days=200), nsv=900.0)
    _seed_gauging(db, template, "OP-W1", base - timedelta(days=10), nsv=990.0)
    _seed_gauging(db, template, "OP-W2", base, nsv=950.0)
    db.commit()

    response = client.get("/out-turn-summary", headers=headers)
    assert response.status_code == 200, response.text
    data = response.json()

    assert data["default_window_applied"] is True
    numbers = [row["operation_number"] for row in data["rows"]]
    assert numbers == ["OP-W1", "OP-W2"]

    # First window row continues from the pre-window snapshot (900), and
    # the second from the first -- identical to a full-history run.
    assert data["rows"][0]["previous_nsv"] == 900
    assert data["rows"][0]["net_receipt_nsv"] == 90
    assert data["rows"][1]["previous_nsv"] == 990
    assert data["rows"][1]["net_dispatch_nsv"] == 40


def test_out_turn_summary_explicit_range_loads_older(client, db):
    headers = _auth_headers(client, db, "View Out-Turn Summary")
    template = _seed_template(db)
    base = date(2026, 8, 12)
    _seed_gauging(db, template, "OP-BASE", base - timedelta(days=200), nsv=900.0)
    _seed_gauging(db, template, "OP-W1", base, nsv=990.0)
    db.commit()

    older_from = (base - timedelta(days=210)).isoformat()
    older_to = (base - timedelta(days=190)).isoformat()
    response = client.get(
        f"/out-turn-summary?date_from={older_from}&date_to={older_to}",
        headers=headers,
    )
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["default_window_applied"] is False
    assert [row["operation_number"] for row in data["rows"]] == ["OP-BASE"]
    assert data["rows"][0]["previous_nsv"] == 0
