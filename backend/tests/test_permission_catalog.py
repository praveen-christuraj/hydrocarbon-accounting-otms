"""Module-wise CRUD permission catalog, legacy migration and enforcement."""

import ast
import pathlib

import pytest
from fastapi import HTTPException

from app.models import Location, Permission, Role, RolePermission, User
from app.routers.export_operations import list_export_locations, list_export_transactions
from app.routers.locations import create_location, delete_location, update_location
from app.routers.permissions import get_standard_permission_catalog
from app.schemas import LocationCreate
from app.services.permission_catalog import (
    apply_permission_catalog,
    migrate_legacy_permissions,
    sync_standard_permissions,
)
from app.utils.default_permissions import (
    ACTION_ORDER,
    DERIVED_PERMISSION_GRANTS,
    EXPORT_VIEW_PERMISSIONS,
    LEGACY_PERMISSION_REPLACEMENTS,
    PERMISSION_CATALOG,
    STANDARD_PERMISSIONS,
)
from tests.conftest import create_role_with_permission, create_user

APP_DIR = pathlib.Path(__file__).resolve().parents[1] / "app"
CATALOG_NAMES = {row["permission_name"] for row in STANDARD_PERMISSIONS}
CHECK_FUNCTIONS = {
    "require_user_permission",
    "user_has_permission",
    "get_role_ids_with_permission",
    "require_any_user_permission",
    "user_has_any_permission",
}


def _role_permission_names(db, role):
    return {
        name
        for (name,) in db.query(Permission.permission_name)
        .join(RolePermission, RolePermission.permission_id == Permission.id)
        .filter(RolePermission.role_id == role.id)
        .all()
    }


def _legacy_permission(db, name, module_name="Legacy", status="Active"):
    permission = Permission(permission_name=name, module_name=module_name, status=status)
    db.add(permission)
    db.flush()
    return permission


def _grant(db, role, permission):
    db.add(RolePermission(role_id=role.id, permission_id=permission.id))
    db.flush()


def _new_role(db, name):
    role = Role(role_name=name, status="Active")
    db.add(role)
    db.flush()
    return role


# ---------------------------------------------------------------------------
# Catalog structure
# ---------------------------------------------------------------------------

def test_catalog_is_module_wise_with_crud_actions():
    assert [category["category"] for category in PERMISSION_CATALOG] == [
        "User Management",
        "Master Data Management",
        "Configurations",
        "Operations",
        "Operation Tracking",
        "Export Operations",
        "Reporting",
        "Administration",
    ]
    assert len(CATALOG_NAMES) == len(STANDARD_PERMISSIONS), "permission names must be unique"
    for row in STANDARD_PERMISSIONS:
        assert row["action"] in ACTION_ORDER
        if row["action"] != "Other":
            assert row["permission_name"].startswith(f"{row['action']} "), row
        assert not row["permission_name"].startswith("Manage "), row

    location = next(
        module
        for category in PERMISSION_CATALOG
        for module in category["modules"]
        if module["module_name"] == "Location Master"
    )
    assert [p["permission_name"] for p in location["permissions"]] == [
        "View Location", "Create Location", "Edit Location", "Delete Location",
    ]


def test_every_permission_checked_by_the_api_exists_in_the_catalog():
    """Static guard: a permission literal in a router must be seedable."""
    unknown = []
    for path in sorted(APP_DIR.rglob("*.py")):
        tree = ast.parse(path.read_text())
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            func = node.func
            name = func.id if isinstance(func, ast.Name) else getattr(func, "attr", None)
            if name not in CHECK_FUNCTIONS and name != "require_workflow_policy_admin":
                continue
            literals = []
            for arg in node.args:
                if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
                    literals.append(arg.value)
                elif isinstance(arg, ast.List):
                    literals.extend(
                        item.value for item in arg.elts
                        if isinstance(item, ast.Constant) and isinstance(item.value, str)
                    )
            for literal in literals:
                if literal not in CATALOG_NAMES:
                    unknown.append(f"{path.relative_to(APP_DIR)}:{node.lineno} {literal}")
    assert unknown == []


def test_export_operations_has_its_own_permissions():
    export_category = next(c for c in PERMISSION_CATALOG if c["category"] == "Export Operations")
    names = {p["permission_name"] for m in export_category["modules"] for p in m["permissions"]}
    assert "View Export Transaction" in names
    assert "Create Export Permit" in names
    assert set(EXPORT_VIEW_PERMISSIONS) <= names
    assert all("Export" in name for name in names)


def test_catalog_endpoint_returns_categories_and_actions(db):
    user = create_user(db, "catalog_reader")
    db.commit()
    response = get_standard_permission_catalog(current_user=user)
    assert response["actions"] == ACTION_ORDER
    assert response["total_standard_permissions"] == len(STANDARD_PERMISSIONS)
    assert response["categories"][0]["modules"][0]["module_name"] == "User Master"


# ---------------------------------------------------------------------------
# Seeding
# ---------------------------------------------------------------------------

def test_sync_creates_catalog_and_moves_modules_without_duplicates(db):
    old = Permission(
        permission_name="View Operation Type",
        module_name="Operations",
        description="old",
        status="Inactive",
    )
    custom = Permission(permission_name="Approve Fuel Voucher", module_name="Custom", status="Active")
    db.add_all([old, custom])
    db.commit()

    result = sync_standard_permissions(db)
    db.commit()

    assert result["created_count"] == len(STANDARD_PERMISSIONS) - 1
    assert result["updated_count"] == 1
    rows = db.query(Permission).filter(Permission.permission_name == "View Operation Type").all()
    assert len(rows) == 1
    assert rows[0].module_name == "Operation Type Master"
    assert rows[0].status == "Inactive", "an administrator's deactivation is preserved"
    db.refresh(custom)
    assert (custom.module_name, custom.status) == ("Custom", "Active")

    second = sync_standard_permissions(db)
    assert second["created_count"] == 0
    assert second["updated_count"] == 0
    assert db.query(Permission).count() == len(STANDARD_PERMISSIONS) + 1


# ---------------------------------------------------------------------------
# Legacy migration
# ---------------------------------------------------------------------------

def test_manage_permission_is_split_into_create_edit_delete_for_existing_roles(db):
    operator = _new_role(db, "Operator")
    viewer = _new_role(db, "Viewer")
    manage_location = _legacy_permission(db, "Manage Location", "Location Master")
    view_location = _legacy_permission(db, "View Location", "Location Master")
    manage_export = _legacy_permission(db, "Manage Export Operations", "Export Operations")
    _grant(db, operator, manage_location)
    _grant(db, operator, view_location)
    _grant(db, operator, manage_export)
    _grant(db, viewer, view_location)
    db.commit()

    result = apply_permission_catalog(db)
    db.commit()

    assert result["migration"]["migrated"] is True
    operator_names = _role_permission_names(db, operator)
    assert {"View Location", "Create Location", "Edit Location", "Delete Location"} <= operator_names
    assert set(LEGACY_PERMISSION_REPLACEMENTS["Manage Export Operations"]) <= operator_names
    assert "View Export Transaction" not in operator_names, "Manage never implied View"
    assert _role_permission_names(db, viewer) == {"View Location"}
    assert db.query(Permission).filter(Permission.permission_name.in_(
        ["Manage Location", "Manage Export Operations"]
    )).count() == 0

    # Idempotent: a second run changes nothing.
    again = apply_permission_catalog(db)
    db.commit()
    assert again["migration"]["migrated"] is False
    assert _role_permission_names(db, operator) == operator_names


def test_capabilities_that_rode_on_other_permissions_get_their_own_permission(db):
    operator = _new_role(db, "Field Operator")
    _grant(db, operator, _legacy_permission(db, "View Operation Transaction", "Operations"))
    _grant(db, operator, _legacy_permission(db, "Create Operation Entry", "Operations"))
    _grant(db, operator, _legacy_permission(db, "View Asset", "Asset Master"))
    _grant(db, operator, _legacy_permission(db, "Manage Shuttle Tracking", "Operations"))
    db.commit()

    apply_permission_catalog(db)
    db.commit()

    names = _role_permission_names(db, operator)
    for target, sources in DERIVED_PERMISSION_GRANTS.items():
        if set(sources) & {"View Operation Transaction", "Create Operation Entry", "View Asset"}:
            assert target in names, target
    assert {"Close Shuttle Voyage", "Reopen Shuttle Voyage"} <= names
    assert "View Table 11 Factor" not in names, "role never had View Asset Calibration"


def test_derived_grants_are_not_reapplied_after_an_admin_removes_them(db):
    reader = _new_role(db, "Reader")
    _grant(db, reader, _legacy_permission(db, "View Operation Transaction", "Operations"))
    _legacy_permission(db, "Manage Location", "Location Master")
    db.commit()
    apply_permission_catalog(db)
    db.commit()

    barge = db.query(Permission).filter(Permission.permission_name == "View Barge Tracking").one()
    db.query(RolePermission).filter(
        RolePermission.role_id == reader.id, RolePermission.permission_id == barge.id
    ).delete()
    db.commit()

    apply_permission_catalog(db)
    db.commit()
    assert "View Barge Tracking" not in _role_permission_names(db, reader)


def test_inactive_legacy_permission_grants_nothing(db):
    role = _new_role(db, "Dormant")
    _grant(db, role, _legacy_permission(db, "Manage User", "User Master", status="Inactive"))
    db.commit()

    apply_permission_catalog(db)
    db.commit()

    assert _role_permission_names(db, role) == set()


def test_migration_without_legacy_rows_is_a_no_op(db):
    sync_standard_permissions(db)
    db.commit()
    assert migrate_legacy_permissions(db)["migrated"] is False


# ---------------------------------------------------------------------------
# Enforcement
# ---------------------------------------------------------------------------

def _scoped_user(db, username, permission_names):
    role = _new_role(db, f"{username} role")
    for name in permission_names:
        permission = db.query(Permission).filter(Permission.permission_name == name).first()
        if permission is None:
            permission = Permission(permission_name=name, module_name="Test", status="Active")
            db.add(permission)
            db.flush()
        _grant(db, role, permission)
    user = create_user(db, username, roles=[role])
    user.all_locations_access = "Yes"
    db.commit()
    return user


def test_location_master_enforces_each_crud_action(db):
    creator = _scoped_user(db, "location_creator", ["View Location", "Create Location"])
    editor = _scoped_user(db, "location_editor", ["View Location", "Edit Location"])
    deleter = _scoped_user(db, "location_deleter", ["View Location", "Delete Location"])
    payload = LocationCreate(location_name="Agge", location_code="AGGE", location_type="Terminal")

    created = create_location(payload, current_user=creator, db=db)
    location_id = created.id

    with pytest.raises(HTTPException) as exc:
        create_location(
            LocationCreate(location_name="Lekki", location_code="LEKKI", location_type="Terminal"),
            current_user=editor,
            db=db,
        )
    assert exc.value.status_code == 403
    assert exc.value.detail == "Permission required: Create Location"

    renamed = LocationCreate(location_name="Agge Terminal", location_code="AGGE", location_type="Terminal")
    with pytest.raises(HTTPException) as exc:
        update_location(location_id, renamed, current_user=creator, db=db)
    assert exc.value.status_code == 403
    update_location(location_id, renamed, current_user=editor, db=db)
    assert db.query(Location).filter(Location.id == location_id).one().location_name == "Agge Terminal"

    for actor in (creator, editor):
        with pytest.raises(HTTPException) as exc:
            delete_location(location_id, current_user=actor, db=db)
        assert exc.value.status_code == 403
    delete_location(location_id, current_user=deleter, db=db)
    assert db.query(Location).filter(Location.id == location_id).count() == 0


def test_export_reference_lookups_accept_any_export_view_permission(db):
    clerk = _scoped_user(db, "export_clerk", ["View Export Transaction"])
    configurator = _scoped_user(db, "export_configurator", ["View Export Location"])
    outsider = _scoped_user(db, "export_outsider", ["View Location"])

    assert list_export_locations(db=db, current_user=clerk) == []
    assert list_export_locations(db=db, current_user=configurator) == []
    with pytest.raises(HTTPException) as exc:
        list_export_locations(db=db, current_user=outsider)
    assert exc.value.status_code == 403

    with pytest.raises(HTTPException) as exc:
        list_export_transactions(
            location_code=None, entity_code=None, quarter=None, db=db, current_user=configurator
        )
    assert exc.value.status_code == 403
    assert list_export_transactions(
        location_code=None, entity_code=None, quarter=None, db=db, current_user=clerk
    ) == []


def test_admin_role_bypasses_granular_checks(db):
    admin_role = _new_role(db, "Admin")
    admin = create_user(db, "catalog_admin", roles=[admin_role])
    db.commit()
    created = create_location(
        LocationCreate(location_name="Admin Site", location_code="ADM", location_type="Terminal"),
        current_user=admin,
        db=db,
    )
    assert created.location_code == "ADM"
    assert isinstance(admin, User)


def test_legacy_role_keeps_access_end_to_end(db):
    """A role that only had "Manage Location" can still create after migration."""
    role = _new_role(db, "Legacy Location Admin")
    _grant(db, role, _legacy_permission(db, "Manage Location", "Location Master"))
    user = create_user(db, "legacy_location_admin", roles=[role])
    user.all_locations_access = "Yes"
    db.commit()

    with pytest.raises(HTTPException):
        create_location(
            LocationCreate(location_name="Before", location_code="BEFORE", location_type="Terminal"),
            current_user=user,
            db=db,
        )

    apply_permission_catalog(db)
    db.commit()

    created = create_location(
        LocationCreate(location_name="After", location_code="AFTER", location_type="Terminal"),
        current_user=user,
        db=db,
    )
    assert created.location_code == "AFTER"
