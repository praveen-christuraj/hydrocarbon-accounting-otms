from datetime import date

from app.models import (
    AuditLog,
    ExportBlock,
    ExportEntity,
    ExportLocation,
    ExportTransaction,
    UserLocation,
)
from app.services.report_engine import run_report
from tests.conftest import create_role_with_permission, create_user


def _seed_export_references(db):
    db.add_all([
        ExportLocation(location_name="Terminal One", location_code="LOC1", status="Active"),
        ExportLocation(location_name="Terminal Two", location_code="LOC2", status="Active"),
        ExportEntity(entity_name="Entity One", entity_code="ENT1", status="Active"),
        ExportBlock(block_name="Block One", block_code="BLK1", status="Active"),
    ])
    db.flush()


def _transaction(db, *, status="Active", location_code="LOC1", volume=100, bl_date=date(2026, 1, 5)):
    row = ExportTransaction(
        bl_date=bl_date,
        location_code=location_code,
        entity_code="ENT1",
        block_code="BLK1",
        volume=volume,
        consignee="Buyer",
        destination="Rotterdam",
        country="Netherlands",
        quarter="Q1_2026",
        status=status,
        vessel_name="MV Example",
    )
    db.add(row)
    db.flush()
    return row


def _admin_headers(client, db):
    from app.models import Role

    role = Role(role_name="Admin", status="Active")
    db.add(role)
    db.flush()
    user = create_user(db, "export_delete_admin", "AdminPass123!", roles=[role])
    user.all_locations_access = "Yes"
    db.commit()
    login = client.post("/auth/login", json={"username": user.username, "password": "AdminPass123!"})
    assert login.status_code == 200, login.text
    return {"Authorization": f"Bearer {login.json()['access_token']}"}, user


def test_legacy_inactive_export_rows_are_listed_but_hidden_from_reports(client, db):
    _seed_export_references(db)
    active = _transaction(db, status="Active", volume=100)
    inactive = _transaction(db, status="Inactive", volume=250, bl_date=date(2026, 1, 6))
    lowercase_inactive = _transaction(db, status="inactive", volume=30, bl_date=date(2026, 1, 7))
    headers, user = _admin_headers(client, db)

    active_rows = client.get("/export-operations/transactions", headers=headers)
    assert active_rows.status_code == 200, active_rows.text
    assert [row["id"] for row in active_rows.json()] == [active.id]

    deleted_rows = client.get("/export-operations/transactions/deleted", headers=headers)
    assert deleted_rows.status_code == 200, deleted_rows.text
    assert {row["id"] for row in deleted_rows.json()} == {inactive.id, lowercase_inactive.id}

    direct_report = client.get("/export-operations/report", headers=headers)
    assert direct_report.status_code == 200, direct_report.text
    assert direct_report.json()["total_rows"] == 1
    assert direct_report.json()["total_volume"] == 100
    assert [row["id"] for row in direct_report.json()["rows"]] == [active.id]

    dashboard = client.get("/export-operations/dashboard", headers=headers)
    assert dashboard.status_code == 200, dashboard.text
    assert dashboard.json()["total_export_volume"] == 100
    assert [row["id"] for row in dashboard.json()["recent_exports"]] == [active.id]

    # The generic Report Builder table source must apply the same active-only
    # rule, even when the report explicitly asks to show the status field.
    definition = {
        "schema_version": 1,
        "report_type": "TABULAR",
        "source": {"kind": "table", "table": "export_transactions"},
        "date_basis": "NONE",
        "columns": [
            {"key": "id", "label": "Transaction ID", "kind": "data", "source": {"type": "column", "column": "id"}, "data_type": "number"},
            {"key": "status", "label": "Status", "kind": "data", "source": {"type": "column", "column": "status"}, "data_type": "text"},
            {"key": "volume", "label": "Volume", "kind": "data", "source": {"type": "column", "column": "volume"}, "data_type": "number", "show_total": True},
        ],
        "options": {"show_totals": True},
    }
    custom_report = run_report(db, user, definition, {})
    assert custom_report["meta"]["total_rows"] == 1
    assert custom_report["rows"] == [{"id": active.id, "status": "Active", "volume": 100.0}]


def test_export_transaction_delete_is_permanent_and_keeps_audit_snapshot(client, db):
    _seed_export_references(db)
    active = _transaction(db, status="Active", volume=125)
    headers, _ = _admin_headers(client, db)

    response = client.delete(f"/export-operations/transactions/{active.id}", headers=headers)
    assert response.status_code == 200, response.text
    assert "permanently" in response.json()["detail"].lower()
    assert db.query(ExportTransaction).filter(ExportTransaction.id == active.id).count() == 0

    audit = db.query(AuditLog).filter(
        AuditLog.action == "Permanently Delete Export Transaction",
        AuditLog.entity_id == active.id,
    ).one()
    assert audit.details["deletion_type"] == "permanent"
    assert audit.details["before"]["status"] == "Active"
    assert audit.details["before"]["volume"] == 125
    assert audit.details["before"]["location_code"] == "LOC1"


def test_bulk_delete_is_atomic_and_removes_legacy_inactive_entries(client, db):
    _seed_export_references(db)
    first = _transaction(db, status="Inactive", volume=15)
    second = _transaction(db, status="Inactive", volume=25, bl_date=date(2026, 1, 6))
    headers, _ = _admin_headers(client, db)

    partial = client.post(
        "/export-operations/transactions/bulk-delete",
        headers=headers,
        json={"transaction_ids": [first.id, 999999]},
    )
    assert partial.status_code == 404
    assert db.query(ExportTransaction).filter(ExportTransaction.id.in_([first.id, second.id])).count() == 2
    assert db.query(AuditLog).filter(AuditLog.action == "Permanently Delete Export Transaction").count() == 0

    deleted = client.post(
        "/export-operations/transactions/bulk-delete",
        headers=headers,
        json={"transaction_ids": [first.id, second.id, first.id]},
    )
    assert deleted.status_code == 200, deleted.text
    assert deleted.json()["deleted"] == 2
    assert deleted.json()["transaction_ids"] == [first.id, second.id]
    assert db.query(ExportTransaction).filter(ExportTransaction.id.in_([first.id, second.id])).count() == 0
    assert db.query(AuditLog).filter(AuditLog.action == "Permanently Delete Export Transaction").count() == 2

    deleted_page = client.get("/export-operations/transactions/deleted", headers=headers)
    assert deleted_page.status_code == 200
    assert deleted_page.json() == []


def test_bulk_delete_checks_every_location_before_deleting_any_row(client, db):
    _seed_export_references(db)
    in_scope = _transaction(db, status="Inactive", location_code="LOC1")
    out_of_scope = _transaction(db, status="Inactive", location_code="LOC2", bl_date=date(2026, 1, 6))
    view_role, _ = create_role_with_permission(db, "Scoped Export Viewer", "View Export Transaction")
    delete_role, _ = create_role_with_permission(db, "Scoped Export Deleter", "Delete Export Transaction")
    user = create_user(db, "scoped_export_deleter", "ScopedPass123!", roles=[view_role, delete_role])
    user.all_locations_access = "No"
    db.add(UserLocation(user_id=user.id, location_code="LOC1"))
    db.commit()
    login = client.post("/auth/login", json={"username": user.username, "password": "ScopedPass123!"})
    assert login.status_code == 200, login.text
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    visible = client.get("/export-operations/transactions/deleted", headers=headers)
    assert visible.status_code == 200
    assert [row["id"] for row in visible.json()] == [in_scope.id]

    forbidden = client.post(
        "/export-operations/transactions/bulk-delete",
        headers=headers,
        json={"transaction_ids": [in_scope.id, out_of_scope.id]},
    )
    assert forbidden.status_code == 403
    assert db.query(ExportTransaction).filter(ExportTransaction.id.in_([in_scope.id, out_of_scope.id])).count() == 2
    assert db.query(AuditLog).filter(AuditLog.action == "Permanently Delete Export Transaction").count() == 0

    allowed = client.post(
        "/export-operations/transactions/bulk-delete",
        headers=headers,
        json={"transaction_ids": [in_scope.id]},
    )
    assert allowed.status_code == 200, allowed.text
    assert db.query(ExportTransaction).filter(ExportTransaction.id == in_scope.id).count() == 0
    assert db.query(ExportTransaction).filter(ExportTransaction.id == out_of_scope.id).count() == 1
