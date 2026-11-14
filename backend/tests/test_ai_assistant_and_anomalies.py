"""Tests for Local Semantic Index, AI Guide Assistant, Memory CRUD & Stock Anomaly Analytics."""

from __future__ import annotations

from datetime import date, timedelta

from app.models import (
    AssetMetricProfile,
    AuditLog,
    Location,
    Permission,
    Role,
    RolePermission,
    TankStockLedger,
    User,
    UserLocation,
    UserRole,
)
from app.services.local_semantic_index import (
    IndexedDoc,
    LocalSemanticIndex,
    load_repository_manual_docs,
)
from app.utils.security import hash_password


def _seed_admin(db, username: str = "admin", password: str = "Admin@123456") -> User:
    role = Role(role_name="Admin", description="Administrator", status="Active")
    db.add(role)
    db.flush()
    user = User(
        full_name="System Admin",
        username=username,
        email="admin@example.com",
        password_hash=hash_password(password),
        force_password_change="No",
        all_locations_access="Yes",
        status="Active",
    )
    db.add(user)
    db.flush()
    db.add(UserRole(user_id=user.id, role_id=role.id))
    db.commit()
    return user


def _auth_headers(client, username: str, password: str) -> dict[str, str]:
    resp = client.post("/auth/login", json={"username": username, "password": password})
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


def _create_user_with_permissions(
    db,
    username: str,
    password: str,
    permission_names: list[str],
    location_codes: list[str] | None = None,
) -> User:
    role = Role(role_name=f"Role_{username}", description="Test role", status="Active")
    db.add(role)
    db.flush()
    for pname in permission_names:
        perm = db.query(Permission).filter(Permission.permission_name == pname).first()
        if perm is None:
            perm = Permission(permission_name=pname, module_name="Test", description=pname, status="Active")
            db.add(perm)
            db.flush()
        db.add(RolePermission(role_id=role.id, permission_id=perm.id))

    user = User(
        full_name=f"User {username}",
        username=username,
        email=f"{username}@example.com",
        password_hash=hash_password(password),
        force_password_change="No",
        status="Active",
        all_locations_access="No" if location_codes is not None else "Yes",
    )
    db.add(user)
    db.flush()
    db.add(UserRole(user_id=user.id, role_id=role.id))
    for loc in (location_codes or []):
        db.add(UserLocation(user_id=user.id, location_code=loc))
    db.commit()
    return user


# ---------------------------------------------------------------------------
# 1. Local Semantic Index (Synonyms, Typo Tolerance, Guardrail, Manual Indexing)
# ---------------------------------------------------------------------------


def test_local_semantic_index_synonyms_typos_and_manuals():
    docs = [
        IndexedDoc(
            doc_id="memory:calc-mb",
            title="Material Balance Book Closing and Loss/Gain",
            keywords="material balance book closing actual closing loss gain bsw gsv nsv",
            body="Book Closing equals Opening plus IN minus OUT. Compare GSV and NSV to isolate BS&W water errors.",
            route="/material-balance-report",
            permission="",
            category="calculation",
            source_kind="memory",
        ),
        IndexedDoc(
            doc_id="memory:calc-calib",
            title="Tank Strapping and Calibration Tables",
            keywords="calibration table strapping chart dip interpolation tov free water",
            body="Upload active tank calibration charts to interpolate Total Observed Volume from Total Dip.",
            route="/asset-calibrations",
            permission="",
            category="calculation",
            source_kind="memory",
        ),
    ]
    idx = LocalSemanticIndex(svd_dim=16).fit(docs)

    # Typo tolerant query ("materal balnce water cut") -> matches Material Balance
    hits = idx.search("materal balnce water cut", top_k=2)
    assert len(hits) >= 1
    assert hits[0].doc.doc_id == "memory:calc-mb"

    # Synonym query ("strapping chart") -> matches Calibration Tables
    calib_hits = idx.search("strapping chart dip volume", top_k=2)
    assert len(calib_hits) >= 1
    assert calib_hits[0].doc.doc_id == "memory:calc-calib"

    # Gibberish query returns empty (zero hallucination guardrail)
    nonsense = idx.search("xyzzy purple flamingo 998877", top_k=2)
    assert nonsense == []

    # Repository Manuals/pages/*.md loader indexes page manuals
    manual_docs = load_repository_manual_docs()
    assert len(manual_docs) >= 30


# ---------------------------------------------------------------------------
# 2. Assistant Memory CRUD (409 on Shipped System Memory) & Live Q&A + RBAC
# ---------------------------------------------------------------------------


def test_assistant_memory_crud_and_rbaced_qa(client, db):
    admin = _seed_admin(db)
    admin_headers = _auth_headers(client, admin.username, "Admin@123456")

    # Overview seeds system memory and reports engine info
    ov = client.get("/assistant/overview?route=/material-balance-report", headers=admin_headers)
    assert ov.status_code == 200, ov.text
    ov_data = ov.json()
    assert ov_data["memory_count"] >= 15
    assert ov_data["manual_guides_indexed"] >= 30
    assert ov_data["ai_engine"]["local_only"] is True

    # Shipped system memory cannot be edited or deleted (HTTP 409)
    mem_list = client.get("/assistant/memory?include_inactive=true", headers=admin_headers)
    assert mem_list.status_code == 200
    system_row = next(m for m in mem_list.json()["items"] if m["is_system"])
    edit_sys = client.put(
        f"/assistant/memory/{system_row['id']}",
        headers=admin_headers,
        json={"title": "Attempted Overwrite"},
    )
    assert edit_sys.status_code == 409
    del_sys = client.delete(f"/assistant/memory/{system_row['id']}", headers=admin_headers)
    assert del_sys.status_code == 409

    # Create custom company SOP memory -> immediately searchable via /assistant/ask
    created = client.post(
        "/assistant/memory",
        headers=admin_headers,
        json={
            "title": "Bonny Terminal Night Shift Sampling Protocol",
            "category": "policy",
            "keywords": "bonny night shift sampling protocol bsw witness",
            "body": "At Bonny Terminal, all night-shift crude loadings require dual-witness BS&W lab sampling before departure.",
            "steps": ["Draw composite sample.", "Co-sign lab certificate with jetty supervisor."],
            "route": "/operation-entry",
        },
    )
    assert created.status_code == 201, created.text
    custom_id = created.json()["id"]

    ask_custom = client.post(
        "/assistant/ask",
        headers=admin_headers,
        json={"question": "What is the Bonny Terminal night shift sampling protocol?", "route": "/operation-entry"},
    )
    assert ask_custom.status_code == 200
    ans = ask_custom.json()
    assert "dual-witness" in ans["answer"].lower()
    assert len(ans["steps"]) == 2

    # History recorded the turn
    hist = client.get("/assistant/history", headers=admin_headers)
    assert hist.status_code == 200
    assert any("Bonny Terminal" in h["question"] for h in hist.json()["items"])

    # Update & delete custom memory cleanly + AuditLog exists
    upd = client.put(
        f"/assistant/memory/{custom_id}",
        headers=admin_headers,
        json={"body": "Updated Bonny protocol: triple-witness verification required."},
    )
    assert upd.status_code == 200
    assert "triple-witness" in upd.json()["body"]

    deleted = client.delete(f"/assistant/memory/{custom_id}", headers=admin_headers)
    assert deleted.status_code == 204
    assert (
        db.query(AuditLog)
        .filter(AuditLog.module_name == "Assistant Memory")
        .count()
        >= 3
    )

    # RBAC refusal: user with ONLY View AI Assistant asks for losses/gains -> refused cleanly without leaking numbers
    _create_user_with_permissions(
        db,
        "guide_only_user",
        "User@123456",
        permission_names=["View AI Assistant"],
    )
    guide_headers = _auth_headers(client, "guide_only_user", "User@123456")
    refused = client.post(
        "/assistant/ask",
        headers=guide_headers,
        json={"question": "Show losses and gains at LOC01"},
    )
    assert refused.status_code == 200
    assert refused.json()["intent"] == "permission"
    assert "View Stock Anomaly Analytics" in refused.json()["answer"]


# ---------------------------------------------------------------------------
# 3. Stock Anomaly Analytics: GSV/NSV Root-Cause, CUSUM Creeping Loss, Sequence Breaks & Location Scope
# ---------------------------------------------------------------------------


def test_stock_anomaly_analytics_loss_gain_cusum_sequence_and_location_scope(client, db):
    admin = _seed_admin(db)
    admin_headers = _auth_headers(client, admin.username, "Admin@123456")

    db.add(Location(location_name="Agge Terminal", location_code="AGGE", location_type="Terminal", status="Active"))
    db.add(Location(location_name="Forcados Terminal", location_code="FORC", location_type="Terminal", status="Active"))
    db.flush()

    base_date = date.today() - timedelta(days=15)
    running_nsv = 10000.0
    running_gsv = 10050.0
    for day_idx in range(14):
        d = base_date + timedelta(days=day_idx)
        prev_nsv = running_nsv
        prev_gsv = running_gsv
        if day_idx == 12:
            new_gsv = prev_gsv - 5.0
            new_nsv = prev_nsv - 140.0
        else:
            new_gsv = prev_gsv - 30.0
            new_nsv = prev_nsv - 30.0

        recorded_prev_nsv = prev_nsv + 50.0 if day_idx == 13 else prev_nsv

        db.add(
            TankStockLedger(
                transaction_id=1000 + day_idx,
                ticket_number=f"AGGE-TKT-{day_idx:03d}",
                operation_number=f"OP-{day_idx:03d}",
                location_code="AGGE",
                tank_asset_code="TK-101",
                tank_asset_name="Agge Tank 101",
                operation_date=d,
                accounting_date=d,
                product_name="Crude Oil",
                tank_operation_code="CLOSE",
                tank_operation_label="Closing Gauge",
                tank_operation_category="CLOSING",
                tank_operation_sign="SET",
                movement_gsv_bbl=0.0,
                movement_nsv_bbl=0.0,
                stock_gsv_bbl=new_gsv,
                stock_nsv_bbl=new_nsv,
                previous_stock_gsv_bbl=prev_gsv,
                previous_stock_nsv_bbl=recorded_prev_nsv,
                running_balance_gsv_bbl=new_gsv,
                running_balance_nsv_bbl=new_nsv,
                source_payload={
                    "inputs": {"dipCm": 250.0, "bswPercent": 0.5, "tankTemperature": 32.0, "tankTemperatureUnit": "C"},
                    "calculated": {"api60": 34.2, "freeWaterBbl": 10.0},
                },
                status="Active",
                created_by="admin",
            )
        )
        running_nsv = new_nsv
        running_gsv = new_gsv

    db.add(
        TankStockLedger(
            transaction_id=2001,
            ticket_number="FORC-TKT-001",
            operation_number="OP-F-001",
            location_code="FORC",
            tank_asset_code="TK-999",
            tank_asset_name="Forcados Tank 999",
            operation_date=date.today() - timedelta(days=1),
            accounting_date=date.today() - timedelta(days=1),
            product_name="Crude Oil",
            tank_operation_code="CLOSE",
            tank_operation_label="Closing Gauge",
            tank_operation_category="CLOSING",
            tank_operation_sign="SET",
            stock_gsv_bbl=9500.0,
            stock_nsv_bbl=9000.0,
            previous_stock_gsv_bbl=10000.0,
            previous_stock_nsv_bbl=10000.0,
            running_balance_gsv_bbl=9500.0,
            running_balance_nsv_bbl=9000.0,
            status="Active",
            created_by="admin",
        )
    )
    db.commit()

    # Admin sees AGGE loss/gain with BS&W separation, CUSUM creeping loss, and sequence break
    resp = client.get("/analytics/stock-anomalies/overview?location_code=AGGE", headers=admin_headers)
    assert resp.status_code == 200, resp.text
    ov = resp.json()
    assert ov["kpis"]["loss_gain_events"] >= 1
    assert any("BS&W" in ev["root_cause"] for ev in ov["loss_gain_events"])
    assert ov["kpis"]["cusum_drift_alerts"] >= 1
    assert any(c["direction"] == "Creeping Loss" and c["tank_asset_code"] == "TK-101" for c in ov["cusum_alerts"])
    assert ov["kpis"]["sequence_breaks"] >= 1
    assert any(abs(b["gap_bbl"] - 50.0) < 0.1 for b in ov["sequence_breaks"])

    # Refresh asset metric profiles persists cached rows in asset_metric_profiles
    ref = client.post("/analytics/stock-anomalies/refresh-profiles?location_code=AGGE", headers=admin_headers)
    assert ref.status_code == 200
    assert ref.json()["profiles_updated"] >= 3
    assert (
        db.query(AssetMetricProfile)
        .filter(AssetMetricProfile.location_code == "AGGE", AssetMetricProfile.asset_code == "TK-101")
        .count()
        >= 3
    )

    # Location-scoped user (FORC only) cannot query AGGE (403) and overview never leaks AGGE rows
    _create_user_with_permissions(
        db,
        "forc_analyst",
        "User@123456",
        permission_names=["View Stock Anomaly Analytics", "View AI Assistant"],
        location_codes=["FORC"],
    )
    forc_headers = _auth_headers(client, "forc_analyst", "User@123456")

    forbidden = client.get("/analytics/stock-anomalies/overview?location_code=AGGE", headers=forc_headers)
    assert forbidden.status_code == 403

    scoped = client.get("/analytics/stock-anomalies/overview", headers=forc_headers)
    assert scoped.status_code == 200
    scoped_locs = {ev["location_code"] for ev in scoped.json()["loss_gain_events"]}
    assert "AGGE" not in scoped_locs
