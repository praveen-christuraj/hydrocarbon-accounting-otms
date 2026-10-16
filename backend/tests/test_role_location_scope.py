"""
Per-role location scope (PERMISSION_CRITERIA_MODEL.md section 7.2).

Location scope must be the **additive union** of

* the locations assigned directly to the user (``user_locations``), and
* the locations of every active role the user holds (``role_locations``).

A role can only widen a user's scope - it never removes a user-specific
assignment. The admin endpoints (``GET/PUT /role-locations/{role_id}``) are
permission-gated, location-scoped and audited, and the reserved Admin role can
never be scoped.
"""

from sqlalchemy import inspect

from app.utils import db_migrations
from app.utils.db_migrations import ROLE_LOCATIONS_DDL, ensure_role_location_table

from app.dependencies.permissions import (
    get_user_location_codes,
    user_is_within_actor_location_scope,
)
from app.models import (
    AuditLog,
    Location,
    Permission,
    Role,
    RoleLocation,
    RolePermission,
    UserLocation,
)
from tests.conftest import create_user

PASSWORD = "StrongPass123!"


def _permission(db, name, module="Test"):
    permission = (
        db.query(Permission).filter(Permission.permission_name == name).first()
    )
    if permission is None:
        permission = Permission(
            permission_name=name, module_name=module, status="Active"
        )
        db.add(permission)
        db.flush()
    return permission


def _role(db, role_name, permissions=()):
    role = Role(role_name=role_name, status="Active")
    db.add(role)
    db.flush()
    for name in permissions:
        db.add(
            RolePermission(role_id=role.id, permission_id=_permission(db, name).id)
        )
    db.flush()
    return role


def _login(client, username):
    response = client.post(
        "/auth/login", json={"username": username, "password": PASSWORD}
    )
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def _seed_locations(db):
    db.add_all(
        [
            Location(
                location_code="AGGE",
                location_name="Agge",
                location_type="Terminal",
                status="Active",
            ),
            Location(
                location_code="UTP",
                location_name="Utapate",
                location_type="Terminal",
                status="Active",
            ),
            Location(
                location_code="OTHER",
                location_name="Other",
                location_type="Terminal",
                status="Active",
            ),
            Location(
                location_code="CLOSED",
                location_name="Closed Site",
                location_type="Terminal",
                status="Inactive",
            ),
        ]
    )
    db.flush()


# ---------------------------------------------------------------------------
# Scope evaluation
# ---------------------------------------------------------------------------

class TestAdditiveScope:
    def test_role_locations_widen_the_user_scope(self, db):
        _seed_locations(db)
        role = _role(db, "Operator")
        db.add(RoleLocation(role_id=role.id, location_code="UTP"))
        user = create_user(db, "operator_user", PASSWORD, roles=[role])
        user.all_locations_access = "No"
        db.add(UserLocation(user_id=user.id, location_code="AGGE"))
        db.commit()

        codes = get_user_location_codes(user, db)

        # union: own assignment + role location
        assert codes == {"agge", "utp"}

    def test_role_can_never_remove_a_user_assignment(self, db):
        _seed_locations(db)
        role = _role(db, "UtpOnly")
        db.add(RoleLocation(role_id=role.id, location_code="UTP"))
        user = create_user(db, "utp_user", PASSWORD, roles=[role])
        user.all_locations_access = "No"
        db.add(UserLocation(user_id=user.id, location_code="AGGE"))
        db.commit()

        assert "agge" in get_user_location_codes(user, db)

    def test_multiple_roles_union_their_locations(self, db):
        _seed_locations(db)
        first = _role(db, "RoleOne")
        second = _role(db, "RoleTwo")
        db.add_all(
            [
                RoleLocation(role_id=first.id, location_code="AGGE"),
                RoleLocation(role_id=second.id, location_code="UTP"),
            ]
        )
        user = create_user(db, "multi_role", PASSWORD, roles=[first, second])
        user.all_locations_access = "No"
        db.commit()

        assert get_user_location_codes(user, db) == {"agge", "utp"}

    def test_legacy_duplicate_code_style_is_normalised(self, db):
        _seed_locations(db)
        role = _role(db, "CaseRole")
        db.add(RoleLocation(role_id=role.id, location_code=" utp "))
        user = create_user(db, "case_user", PASSWORD, roles=[role])
        db.commit()

        assert get_user_location_codes(user, db) == {"utp"}

    def test_role_location_makes_actor_scope_cover_target_user(self, db):
        """A manager holding a role location may manage users inside that scope."""
        _seed_locations(db)
        manager_role = _role(db, "Terminal Manager")
        db.add(RoleLocation(role_id=manager_role.id, location_code="UTP"))
        manager = create_user(db, "manager", PASSWORD, roles=[manager_role])
        manager.all_locations_access = "No"

        operator_role = _role(db, "Operator")
        operator = create_user(db, "operator", PASSWORD, roles=[operator_role])
        operator.all_locations_access = "No"
        db.add(UserLocation(user_id=operator.id, location_code="UTP"))
        db.commit()

        assert user_is_within_actor_location_scope(manager, operator, db) is True

    def test_restricted_scope_is_still_restricted_without_assignments(self, db):
        _seed_locations(db)
        role = _role(db, "EmptyRole")
        user = create_user(db, "empty_user", PASSWORD, roles=[role])
        db.commit()

        # no own locations and no role locations -> sees nothing
        assert get_user_location_codes(user, db) == set()

    def test_inactive_role_does_not_grant_locations(self, db):
        _seed_locations(db)
        role = _role(db, "Inactive Role")
        role.status = "Inactive"
        db.add(RoleLocation(role_id=role.id, location_code="UTP"))
        user = create_user(db, "inactive_role_user", PASSWORD, roles=[role])
        db.commit()

        assert get_user_location_codes(user, db) == set()


# ---------------------------------------------------------------------------
# Admin endpoints
# ---------------------------------------------------------------------------

class TestRoleLocationEndpoints:
    def _actor(self, db, client, permissions, locations=(), all_access="No"):
        role = _role(db, f"actor_{'-'.join(locations) or 'all'}", permissions)
        user = create_user(db, f"actor_{len(permissions)}_{len(locations)}", PASSWORD, roles=[role])
        user.all_locations_access = all_access
        for code in locations:
            db.add(UserLocation(user_id=user.id, location_code=code))
        db.commit()
        return _login(client, user.username), user

    def test_view_requires_permission(self, db, client):
        _seed_locations(db)
        target = _role(db, "Operator")
        headers, _ = self._actor(db, client, permissions=[], locations=["AGGE"])

        response = client.get("/role-locations", headers=headers)

        assert response.status_code == 403
        assert "View Role Location Assignment" in response.json()["detail"]
        assert target.id

    def test_unrestricted_admin_lists_every_role(self, db, client):
        _seed_locations(db)
        operator = _role(db, "Operator")
        db.add(RoleLocation(role_id=operator.id, location_code="UTP"))
        db.commit()

        headers, _ = self._actor(
            db,
            client,
            permissions=["View Role Location Assignment", "Edit Role Location Assignment"],
            all_access="Yes",
        )

        response = client.get("/role-locations", headers=headers)

        assert response.status_code == 200
        payload = {row["role_name"]: row for row in response.json()}
        assert "Operator" in payload
        assert payload["Operator"]["location_codes"] == ["UTP"]

    def test_save_replaces_role_locations_and_audits(self, db, client):
        _seed_locations(db)
        operator = _role(db, "Operator")
        db.add(RoleLocation(role_id=operator.id, location_code="OTHER"))
        db.commit()

        headers, _ = self._actor(
            db,
            client,
            permissions=["View Role Location Assignment", "Edit Role Location Assignment"],
            all_access="Yes",
        )

        response = client.put(
            f"/role-locations/{operator.id}",
            headers=headers,
            json={"location_codes": ["agge", "UTP"]},
        )

        assert response.status_code == 200, response.text
        # canonical DB spelling is preserved
        assert response.json()["location_codes"] == ["AGGE", "UTP"]
        stored = {
            row.location_code
            for row in db.query(RoleLocation)
            .filter(RoleLocation.role_id == operator.id)
            .all()
        }
        assert stored == {"AGGE", "UTP"}

        audit = (
            db.query(AuditLog)
            .filter(AuditLog.module_name == "Role Location Assignment")
            .order_by(AuditLog.id.desc())
            .first()
        )
        assert audit is not None
        assert audit.action == "Update Role Location Assignment"
        assert audit.details["after_location_codes"] == ["AGGE", "UTP"]
        assert audit.details["before_location_codes"] == ["OTHER"]

    def test_save_requires_edit_permission(self, db, client):
        _seed_locations(db)
        operator = _role(db, "Operator")
        db.commit()
        headers, _ = self._actor(
            db, client, permissions=["View Role Location Assignment"], all_access="Yes"
        )

        response = client.put(
            f"/role-locations/{operator.id}",
            headers=headers,
            json={"location_codes": ["AGGE"]},
        )

        assert response.status_code == 403
        assert "Edit Role Location Assignment" in response.json()["detail"]

    def test_restricted_actor_cannot_assign_outside_own_scope(self, db, client):
        _seed_locations(db)
        operator = _role(db, "Operator")
        db.commit()
        headers, _ = self._actor(
            db,
            client,
            permissions=["View Role Location Assignment", "Edit Role Location Assignment"],
            locations=["AGGE"],
        )

        response = client.put(
            f"/role-locations/{operator.id}",
            headers=headers,
            json={"location_codes": ["UTP"]},
        )

        assert response.status_code == 403
        assert "outside your own scope" in response.json()["detail"]

    def test_restricted_actor_cannot_modify_role_outside_own_scope(self, db, client):
        _seed_locations(db)
        operator = _role(db, "Operator")
        db.add(RoleLocation(role_id=operator.id, location_code="UTP"))
        db.commit()
        headers, _ = self._actor(
            db,
            client,
            permissions=["View Role Location Assignment", "Edit Role Location Assignment"],
            locations=["AGGE"],
        )

        response = client.put(
            f"/role-locations/{operator.id}",
            headers=headers,
            json={"location_codes": ["AGGE"]},
        )

        assert response.status_code == 403

    def test_admin_role_cannot_be_scoped(self, db, client):
        _seed_locations(db)
        admin_role = _role(db, "Admin")
        db.commit()
        headers, _ = self._actor(
            db,
            client,
            permissions=["View Role Location Assignment", "Edit Role Location Assignment"],
            all_access="Yes",
        )

        response = client.put(
            f"/role-locations/{admin_role.id}",
            headers=headers,
            json={"location_codes": ["AGGE"]},
        )

        assert response.status_code == 403
        assert "Admin role" in response.json()["detail"]

    def test_unknown_and_inactive_location_are_rejected(self, db, client):
        _seed_locations(db)
        operator = _role(db, "Operator")
        db.commit()
        headers, _ = self._actor(
            db,
            client,
            permissions=["View Role Location Assignment", "Edit Role Location Assignment"],
            all_access="Yes",
        )

        missing = client.put(
            f"/role-locations/{operator.id}",
            headers=headers,
            json={"location_codes": ["NOPE"]},
        )
        assert missing.status_code == 400
        assert "not found" in missing.json()["detail"]

        inactive = client.put(
            f"/role-locations/{operator.id}",
            headers=headers,
            json={"location_codes": ["CLOSED"]},
        )
        assert inactive.status_code == 400
        assert "not Active" in inactive.json()["detail"]

    def test_duplicate_and_blank_codes_are_rejected(self, db, client):
        _seed_locations(db)
        operator = _role(db, "Operator")
        db.commit()
        headers, _ = self._actor(
            db,
            client,
            permissions=["View Role Location Assignment", "Edit Role Location Assignment"],
            all_access="Yes",
        )

        duplicate = client.put(
            f"/role-locations/{operator.id}",
            headers=headers,
            json={"location_codes": ["AGGE", "agge"]},
        )
        assert duplicate.status_code == 422

        blank = client.put(
            f"/role-locations/{operator.id}",
            headers=headers,
            json={"location_codes": ["  "]},
        )
        assert blank.status_code == 422

    def test_role_detail_returns_codes(self, db, client):
        _seed_locations(db)
        operator = _role(db, "Operator")
        db.add(RoleLocation(role_id=operator.id, location_code="UTP"))
        db.commit()
        headers, _ = self._actor(
            db,
            client,
            permissions=["View Role Location Assignment"],
            all_access="Yes",
        )

        response = client.get(f"/role-locations/{operator.id}", headers=headers)

        assert response.status_code == 200
        assert response.json()["location_codes"] == ["UTP"]

        missing = client.get("/role-locations/9999", headers=headers)
        assert missing.status_code == 404


class TestRoleLocationMigration:
    """``ensure_role_location_table`` creates the table on databases that were
    initialised before this feature existed, and is safe to run on every start.
    The DDL is PostgreSQL syntax (see the other ``ensure_*`` helpers), so the
    create path is exercised against a recording stub engine."""

    def test_ddl_matches_the_orm_model(self):
        ddl = "\n".join(ROLE_LOCATIONS_DDL)

        for column in ("id", "role_id", "location_code", "created_at"):
            assert column in ddl

        assert "CREATE TABLE IF NOT EXISTS role_locations" in ddl
        assert "REFERENCES roles(id) ON DELETE CASCADE" in ddl
        assert "CONSTRAINT unique_role_location UNIQUE (role_id, location_code)" in ddl

        # role-level scope only: no per-user override / deny list
        assert "user_id" not in ddl

    def test_creates_the_table_when_missing(self, monkeypatch):
        class _RecordingConnection:
            def __init__(self, sink):
                self.sink = sink

            def execute(self, statement):
                self.sink.append(str(statement))

            def __enter__(self):
                return self

            def __exit__(self, *_exc):
                return False

        class _RecordingEngine:
            def __init__(self):
                self.statements = []

            def begin(self):
                return _RecordingConnection(self.statements)

        engine_stub = _RecordingEngine()
        monkeypatch.setattr(db_migrations, "engine", engine_stub)
        monkeypatch.setattr(
            db_migrations, "_role_location_table_is_missing", lambda: True
        )

        ensure_role_location_table()

        assert len(engine_stub.statements) == len(ROLE_LOCATIONS_DDL)
        assert "CREATE TABLE IF NOT EXISTS role_locations" in engine_stub.statements[0]

    def test_existing_table_is_left_alone(self, db, monkeypatch):
        """Runs on the sqlite test database, where create_all already made the
        table: the guard must report it as present and no DDL may be replayed."""
        assert "role_locations" in inspect(db_migrations.engine).get_table_names()
        assert db_migrations._role_location_table_is_missing() is False

        class _ExplodingEngine:
            def begin(self):  # pragma: no cover - must never be reached
                raise AssertionError("ensure_role_location_table replayed its DDL")

        monkeypatch.setattr(db_migrations, "engine", _ExplodingEngine())
        monkeypatch.setattr(
            db_migrations, "_role_location_table_is_missing", lambda: False
        )

        # must return early and never touch the engine
        ensure_role_location_table()
