from datetime import date

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker

from app.dependencies.auth import get_current_user_from_token
from app.dependencies.permissions import (
    apply_location_filter,
    ensure_role_assignable_to_user,
    ensure_role_permissions_within_actor_scope,
    get_user_location_codes,
    get_user_permissions,
    is_admin_user,
    is_super_admin,
    user_has_permission,
)
from app.models import (
    Asset,
    AssetCalibrationData,
    AssetCalibrationTable,
    AssetType,
    CalibrationTemplate,
    ExportLocation,
    ExportTransaction,
    Location,
    MaterialBalanceTemplate,
    MovementMapping,
    Permission,
    Role,
    RolePermission,
    SystemNotification,
    SystemNotificationReceipt,
    UserLocation,
    UserRole,
)
from app.routers.assets import create_asset, get_assets
from app.routers.asset_calibration_tables import (
    create_asset_calibration_table,
    get_asset_calibration_tables,
)
from app.routers.material_balance_templates import (
    create_material_balance_template,
    get_material_balance_template_detail,
    get_material_balance_templates,
)
from app.routers.movement_mappings import (
    create_movement_mapping,
    get_movement_mapping,
    list_movement_mappings,
)
from app.routers.tank_operation_summary import get_tank_operation_summary_columns
from app.routers.export_operations import (
    apply_export_location_scope,
    ensure_export_location_scope,
    list_export_transactions,
)
from app.routers.role_permissions import save_role_permissions
from app.routers.user_roles import get_user_roles, replace_user_roles
from app.routers.users import get_user_by_id, get_users
from app.routers.auth import refresh_access_token
from app.routers.system_notifications import (
    get_my_system_notifications,
    get_system_notification_delivery_report,
    notification_is_within_actor_scope,
    notification_targets_user,
)
from app.routers.operation_transactions import create_operation_transaction
from app.schemas import (
    AssetCalibrationDataRowCreate,
    AssetCalibrationTableCreate,
    AssetCreate,
    MaterialBalanceTemplateCreate,
    MovementMappingCreate,
    OperationTransactionCreate,
    RefreshTokenRequest,
    RolePermissionSaveRequest,
    UserRolesReplaceRequest,
)
from app.utils.jwt import create_access_token, create_refresh_token
from app.utils import db_migrations
from app.database import engine as app_engine
from app.utils.db_migrations import ensure_user_role_multi_role_constraint
from tests.conftest import create_role_with_permission, create_user


def test_user_permission_union_uses_all_active_roles_and_is_revoked_immediately(db):
    view_role, view_permission = create_role_with_permission(db, "Reader", "View Operation Transaction")
    report_role, report_permission = create_role_with_permission(db, "Reporter", "Export Reports")
    user = create_user(db, "multi_role", roles=[view_role, report_role])
    db.commit()

    assert user_has_permission(user, "View Operation Transaction", db)
    assert user_has_permission(user, "Export Reports", db)
    assert get_user_permissions(user, db) == {"View Operation Transaction", "Export Reports"}

    report_role.status = "Inactive"
    db.flush()
    assert not user_has_permission(user, "Export Reports", db)
    assert "Export Reports" not in get_user_permissions(user, db)


def test_admin_role_is_detected_and_has_unrestricted_location_scope(db):
    admin_role = Role(role_name="  AdMiN  ", status="Active")
    db.add(admin_role)
    admin = create_user(db, "rbac_admin", roles=[admin_role])
    db.add(UserLocation(user_id=admin.id, location_code="AGGE"))
    db.commit()

    assert is_admin_user(admin, db)
    assert is_super_admin(admin, db)
    assert get_user_location_codes(admin, db) is None


def test_admin_alias_and_legacy_username_are_backward_compatible(db):
    legacy_admin = create_user(db, " ADMIN ")
    db.commit()
    assert is_admin_user(legacy_admin, db)
    assert is_super_admin(legacy_admin, db)


def test_notification_recipient_matching_uses_all_roles_and_assigned_locations(db):
    first_role = Role(role_name="First Notification Role", status="Active")
    second_role = Role(role_name="Second Notification Role", status="Active")
    db.add_all([first_role, second_role])
    db.flush()
    user = create_user(db, "notification_multi_role", roles=[first_role, second_role])
    db.add(UserLocation(user_id=user.id, location_code=" AGGE "))
    db.commit()

    role_notification = SystemNotification(
        target_scope="Roles",
        target_role_ids_json=[second_role.id],
        target_user_ids_json=[],
        target_location_codes_json=[],
    )
    location_notification = SystemNotification(
        target_scope="Locations",
        target_role_ids_json=[],
        target_user_ids_json=[],
        target_location_codes_json=["agge"],
    )

    assert notification_targets_user(db, role_notification, user)
    assert notification_targets_user(db, location_notification, user)


def test_notification_target_scope_is_limited_to_actor_locations(db):
    role, _ = create_role_with_permission(db, "Scoped Notification Manager", "Manage System Notification")
    actor = create_user(db, "scoped_notification_manager", roles=[role])
    db.add(UserLocation(user_id=actor.id, location_code="AGGE"))
    db.commit()

    assert notification_is_within_actor_scope(actor, "Locations", [], ["agge"], db)
    assert not notification_is_within_actor_scope(actor, "Locations", [], ["LEKKI"], db)
    assert not notification_is_within_actor_scope(actor, "All Users", [], [], db)
    assert not notification_is_within_actor_scope(actor, "Roles", [], [], db)


def test_recipient_notification_response_redacts_audience_and_delivery_metrics(db):
    user = create_user(db, "notification_recipient")
    db.flush()
    notification = SystemNotification(
        notification_number="NTF-TEST-001",
        title="Scoped notice",
        message="A notice for a specific user.",
        notification_type="Info",
        priority="Normal",
        delivery_mode="Inbox",
        target_scope="Specific Users",
        target_role_ids_json=[],
        target_user_ids_json=[user.id],
        target_location_codes_json=[],
        status="Published",
        created_by_user_id=user.id,
        created_by_display=user.username,
    )
    db.add(notification)
    db.commit()

    responses = get_my_system_notifications(current_user=user, db=db)
    assert len(responses) == 1
    response = responses[0]
    assert response["target_scope"] == "Targeted"
    assert response["target_role_ids"] == []
    assert response["target_user_ids"] == []
    assert response["target_location_codes"] == []
    assert response["created_by_user_id"] is None
    assert response["created_by_display"] is None
    assert response["delivery_count"] == 0
    assert response["seen_count"] == 0


def test_delivery_report_hides_recipients_with_out_of_scope_locations(db):
    report_role, _ = create_role_with_permission(
        db, "Scoped Delivery Report Viewer", "View System Notification Delivery Report"
    )
    actor = create_user(db, "delivery_report_viewer", roles=[report_role])
    in_scope_user = create_user(db, "delivery_recipient_in_scope")
    cross_scope_user = create_user(db, "delivery_recipient_cross_scope")
    db.add_all([
        UserLocation(user_id=actor.id, location_code="AGGE"),
        UserLocation(user_id=in_scope_user.id, location_code="AGGE"),
        UserLocation(user_id=cross_scope_user.id, location_code="AGGE"),
        UserLocation(user_id=cross_scope_user.id, location_code="LEKKI"),
    ])
    db.flush()
    notification = SystemNotification(
        notification_number="NTF-TEST-002",
        title="Location notice",
        message="A notice for a location.",
        notification_type="Info",
        priority="Normal",
        delivery_mode="Inbox",
        target_scope="Locations",
        target_role_ids_json=[],
        target_user_ids_json=[],
        target_location_codes_json=["AGGE"],
        status="Published",
    )
    db.add(notification)
    db.flush()
    db.add_all([
        SystemNotificationReceipt(
            notification_id=notification.id,
            user_id=in_scope_user.id,
            username=in_scope_user.username,
            status="Unread",
        ),
        SystemNotificationReceipt(
            notification_id=notification.id,
            user_id=cross_scope_user.id,
            username=cross_scope_user.username,
            status="Unread",
        ),
    ])
    db.commit()

    receipts = get_system_notification_delivery_report(
        notification.id,
        current_user=actor,
        db=db,
    )
    assert [receipt.username for receipt in receipts] == [in_scope_user.username]


def test_location_scopes_normalize_case_and_whitespace(db):
    role, _ = create_role_with_permission(db, "Location Reader", "View Export Operations")
    user = create_user(db, "agge_reader", roles=[role])
    db.add(UserLocation(user_id=user.id, location_code=" AGGE "))
    db.add_all([
        ExportLocation(location_name="Agge", location_code="AGGE", status="Active"),
        ExportLocation(location_name="Lekki", location_code="LEKKI", status="Active"),
    ])
    db.add_all([
        ExportTransaction(
            bl_date=date(2026, 1, 5), location_code="agge", entity_code="E1",
            block_code="B1", volume=10, consignee="C", destination="D",
            country="X", quarter="Q1_2026", status="Active",
        ),
        ExportTransaction(
            bl_date=date(2026, 1, 6), location_code="LEKKI", entity_code="E2",
            block_code="B2", volume=20, consignee="C", destination="D",
            country="X", quarter="Q1_2026", status="Active",
        ),
    ])
    db.commit()

    assert get_user_location_codes(user, db) == {"agge"}
    query = apply_export_location_scope(db.query(ExportTransaction), ExportTransaction.location_code, user, db)
    assert {tx.location_code for tx in query.all()} == {"agge"}
    ensure_export_location_scope(user, db, " AGGE ")
    with pytest.raises(HTTPException) as exc:
        ensure_export_location_scope(user, db, "LEKKI")
    assert exc.value.status_code == 403


def test_general_location_filter_trims_case_variants(db):
    # The application helper is shared by real ORM models; exercise its SQL
    # normalization against an existing table/column without changing records.
    from app.models import Location
    db.add_all([
        Location(location_name="Agge", location_code="AGGE", location_type="Terminal", status="Active"),
        Location(location_name="Lekki", location_code="LEKKI", location_type="Terminal", status="Active"),
    ])
    role, _ = create_role_with_permission(db, "Location Viewer", "View Location")
    user = create_user(db, "location_viewer", roles=[role])
    db.add(UserLocation(user_id=user.id, location_code="AGGE"))
    db.commit()
    query = apply_location_filter(db.query(Location), Location, user, db, column_name="location_code")
    assert [row.location_code for row in query.all()] == ["AGGE"]


def test_non_admin_cannot_assign_a_role_with_unheld_permissions(db):
    manager_role, _ = create_role_with_permission(db, "Assignment Manager", "Manage User Role Assignment")
    actor = create_user(db, "role_manager", roles=[manager_role])
    elevated_role, _ = create_role_with_permission(db, "Elevated", "Manage User")
    db.commit()

    with pytest.raises(HTTPException) as exc:
        ensure_role_assignable_to_user(actor, elevated_role, db)
    assert exc.value.status_code == 403


def test_scoped_role_admin_cannot_change_role_shared_outside_their_scope(db):
    manager_role, shared_permission = create_role_with_permission(
        db, "Local Role Manager", "View User"
    )
    shared_role = Role(role_name="Shared Across Locations", status="Active")
    db.add(shared_role)
    db.flush()
    db.add(RolePermission(role_id=shared_role.id, permission_id=shared_permission.id))
    actor = create_user(db, "local_role_manager", roles=[manager_role])
    out_of_scope_user = create_user(db, "outside_role_user", roles=[shared_role])
    db.add(UserLocation(user_id=actor.id, location_code="AGGE"))
    db.add(UserLocation(user_id=out_of_scope_user.id, location_code="LEKKI"))
    db.commit()

    with pytest.raises(HTTPException) as exc:
        ensure_role_assignable_to_user(actor, shared_role, db)
    assert exc.value.status_code == 403


def test_non_admin_cannot_grant_unheld_role_permissions(db):
    role, _ = create_role_with_permission(db, "Assignment Manager", "Manage Role Permission Assignment")
    actor = create_user(db, "permission_manager", roles=[role])
    db.commit()

    with pytest.raises(HTTPException) as exc:
        ensure_role_permissions_within_actor_scope(actor, {"Manage User"}, db)
    assert exc.value.status_code == 403


def test_role_assignment_endpoint_blocks_privilege_escalation_and_admin_role(db):
    manager_role, _ = create_role_with_permission(db, "Assignment Manager", "Manage User Role Assignment")
    actor = create_user(db, "role_api_manager", roles=[manager_role])
    target = create_user(db, "role_api_target")
    elevated_role, _ = create_role_with_permission(db, "Elevated Role", "Manage User")
    admin_role = Role(role_name="Admin", status="Active")
    db.add(admin_role)
    db.commit()

    with pytest.raises(HTTPException) as exc:
        replace_user_roles(
            target.id,
            UserRolesReplaceRequest(role_ids=[elevated_role.id]),
            current_user=actor,
            db=db,
        )
    assert exc.value.status_code == 403

    with pytest.raises(HTTPException) as exc:
        replace_user_roles(
            target.id,
            UserRolesReplaceRequest(role_ids=[admin_role.id]),
            current_user=actor,
            db=db,
        )
    assert exc.value.status_code == 403
    assert db.query(UserRole).filter(UserRole.user_id == target.id).count() == 0


def test_user_and_role_administration_respects_actor_location_scope(db):
    view_role, _ = create_role_with_permission(
        db, "Scoped User Viewer", "View User Role Assignment"
    )
    manage_role, _ = create_role_with_permission(
        db, "Scoped User Manager", "Manage User Role Assignment"
    )
    user_view_role, _ = create_role_with_permission(db, "Scoped User Master Viewer", "View User")
    actor = create_user(db, "scoped_user_manager", roles=[view_role, manage_role, user_view_role])
    target_role = Role(role_name="Other Location Role", status="Active")
    db.add(target_role)
    db.flush()
    target = create_user(db, "other_location_user", roles=[target_role])
    db.add_all([
        UserLocation(user_id=actor.id, location_code="AGGE"),
        UserLocation(user_id=target.id, location_code="LEKKI"),
    ])
    db.commit()

    visible_assignments = get_user_roles(current_user=actor, db=db)
    assert all(item["username"] != target.username for item in visible_assignments)

    with pytest.raises(HTTPException) as exc:
        replace_user_roles(
            target.id,
            UserRolesReplaceRequest(role_ids=[]),
            current_user=actor,
            db=db,
        )
    assert exc.value.status_code == 404

    with pytest.raises(HTTPException) as exc:
        get_user_by_id(target.id, current_user=actor, db=db)
    assert exc.value.status_code == 404

    visible_users = get_users(
        skip=0,
        limit=50,
        search=None,
        current_user=actor,
        db=db,
    )
    assert target.username not in {item.username for item in visible_users["items"]}


def test_role_permission_endpoint_blocks_granting_unheld_capability(db):
    manager_role, _ = create_role_with_permission(
        db, "Permission API Manager", "Manage Role Permission Assignment"
    )
    actor = create_user(db, "permission_api_manager", roles=[manager_role])
    target_role = Role(role_name="Target Role", status="Active")
    db.add(target_role)
    elevated_permission = Permission(
        permission_name="Manage User",
        module_name="Users",
        status="Active",
    )
    db.add(elevated_permission)
    db.commit()

    with pytest.raises(HTTPException) as exc:
        save_role_permissions(
            target_role.id,
            RolePermissionSaveRequest(permission_ids=[elevated_permission.id]),
            current_user=actor,
            db=db,
        )
    assert exc.value.status_code == 403
    assert db.query(RolePermission).filter(RolePermission.role_id == target_role.id).count() == 0


def test_export_transaction_endpoint_requires_permission_and_applies_location_scope(db):
    view_role, _ = create_role_with_permission(db, "Export Viewer", "View Export Operations")
    viewer = create_user(db, "scoped_export_viewer", roles=[view_role])
    unprivileged = create_user(db, "unprivileged_export_viewer")
    db.add(UserLocation(user_id=viewer.id, location_code=" AGGE "))
    db.add_all([
        ExportTransaction(
            bl_date=date(2026, 1, 5), location_code="agge", entity_code="E1",
            block_code="B1", volume=10, consignee="C", destination="D",
            country="X", quarter="Q1_2026", status="Active",
        ),
        ExportTransaction(
            bl_date=date(2026, 1, 6), location_code="LEKKI", entity_code="E2",
            block_code="B2", volume=20, consignee="C", destination="D",
            country="X", quarter="Q1_2026", status="Active",
        ),
    ])
    db.commit()

    rows = list_export_transactions(
        location_code=None,
        entity_code=None,
        quarter=None,
        db=db,
        current_user=viewer,
    )
    assert [row["location_code"] for row in rows] == ["agge"]

    with pytest.raises(HTTPException) as exc:
        list_export_transactions(
            location_code=None,
            entity_code=None,
            quarter=None,
            db=db,
            current_user=unprivileged,
        )
    assert exc.value.status_code == 403


def test_asset_list_keeps_global_assets_and_hides_other_locations(db):
    location_role, _ = create_role_with_permission(db, "Asset Viewer", "View Asset")
    viewer = create_user(db, "asset_scope_viewer", roles=[location_role])
    db.add_all([
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
    ])
    db.add(UserLocation(user_id=viewer.id, location_code=" AGGE "))
    db.add_all([
        Asset(
            asset_name="Shared Shuttle",
            asset_code="SHARED-1",
            asset_scope="Global",
            asset_type_code="SHUTTLE",
            status="Active",
        ),
        Asset(
            asset_name="Agge Tank",
            asset_code="AGGE-TANK-1",
            asset_scope="Local",
            asset_type_code="TANK",
            location_code="AGGE",
            status="Active",
        ),
        Asset(
            asset_name="Lekki Tank",
            asset_code="LEKKI-TANK-1",
            asset_scope="Local",
            asset_type_code="TANK",
            location_code="LEKKI",
            status="Active",
        ),
    ])
    db.commit()

    result = get_assets(
        skip=0,
        limit=50,
        search=None,
        asset_type_code=None,
        location_code=None,
        db=db,
        current_user=viewer,
    )
    visible_codes = {asset.asset_code for asset in result["items"]}
    assert visible_codes == {"SHARED-1", "AGGE-TANK-1"}


def test_non_admin_cannot_create_global_asset(db):
    role, _ = create_role_with_permission(db, "Asset Manager", "Manage Asset")
    actor = create_user(db, "asset_manager", roles=[role])
    db.add(AssetType(asset_type_name="Shuttle", asset_type_code="SHUTTLE", status="Active"))
    db.commit()

    with pytest.raises(HTTPException) as exc:
        create_asset(
            AssetCreate(
                asset_name="New Shared Shuttle",
                asset_code="SHARED-NEW",
                asset_scope="Global",
                asset_type_code="SHUTTLE",
                status="Active",
            ),
            current_user=actor,
            db=db,
        )
    assert exc.value.status_code == 403


def test_asset_calibration_tables_are_location_scoped_and_global_tables_are_read_only(db):
    view_role, _ = create_role_with_permission(db, "Calibration Viewer", "View Asset Calibration")
    manage_role, _ = create_role_with_permission(db, "Calibration Manager", "Manage Asset Calibration")
    viewer = create_user(db, "calibration_scope_viewer", roles=[view_role, manage_role])
    db.add(UserLocation(user_id=viewer.id, location_code="AGGE"))
    db.add_all([
        Location(location_name="Agge Terminal", location_code="AGGE", location_type="Terminal", status="Active"),
        Location(location_name="Lekki Terminal", location_code="LEKKI", location_type="Terminal", status="Active"),
        Asset(asset_name="Agge Tank", asset_code="AGGE-CAL-TANK", asset_scope="Local", asset_type_code="TANK", location_code="AGGE", status="Active"),
        Asset(asset_name="Lekki Tank", asset_code="LEKKI-CAL-TANK", asset_scope="Local", asset_type_code="TANK", location_code="LEKKI", status="Active"),
        Asset(asset_name="Shared Tanker", asset_code="GLOBAL-CAL-TANK", asset_scope="Global", asset_type_code="TANK", status="Active"),
    ])
    template = CalibrationTemplate(
        template_name="RBAC Calibration Template",
        asset_type_code="TANK",
        calibration_type="Tank Chart",
        status="Active",
    )
    db.add(template)
    db.flush()
    calibration_tables = [
        AssetCalibrationTable(calibration_name="Agge Chart", asset_code="AGGE-CAL-TANK", template_id=template.id, status="Active"),
        AssetCalibrationTable(calibration_name="Lekki Chart", asset_code="LEKKI-CAL-TANK", template_id=template.id, status="Active"),
        AssetCalibrationTable(calibration_name="Shared Chart", asset_code="GLOBAL-CAL-TANK", template_id=template.id, status="Active"),
    ]
    db.add_all(calibration_tables)
    db.flush()
    db.add_all([
        AssetCalibrationData(calibration_table_id=table.id, row_number=1, row_data={"capacity": 100})
        for table in calibration_tables
    ])
    db.commit()

    visible = get_asset_calibration_tables(current_user=viewer, db=db)
    assert {row["asset_code"] for row in visible} == {"AGGE-CAL-TANK", "GLOBAL-CAL-TANK"}

    with pytest.raises(HTTPException) as exc:
        create_asset_calibration_table(
            AssetCalibrationTableCreate(
                calibration_name="Unauthorized Shared Chart",
                asset_code="GLOBAL-CAL-TANK",
                template_id=template.id,
                rows=[AssetCalibrationDataRowCreate(row_number=1, row_data={"capacity": 50})],
            ),
            current_user=viewer,
            db=db,
        )
    assert exc.value.status_code == 403


def test_material_balance_template_list_and_mutations_enforce_location_scope(db):
    view_role, _ = create_role_with_permission(
        db, "Material Balance Viewer", "View Material Balance Template"
    )
    manage_role, _ = create_role_with_permission(
        db, "Material Balance Manager", "Manage Material Balance Template"
    )
    actor = create_user(db, "material_balance_scoped", roles=[view_role, manage_role])
    db.add(UserLocation(user_id=actor.id, location_code="AGGE"))
    db.add_all([
        Location(location_name="Agge Terminal", location_code="AGGE", location_type="Terminal", status="Active"),
        Location(location_name="Lekki Terminal", location_code="LEKKI", location_type="Terminal", status="Active"),
        MaterialBalanceTemplate(location_code="AGGE", template_name="Agge Template", status="Active"),
        MaterialBalanceTemplate(location_code="LEKKI", template_name="Lekki Template", status="Active"),
    ])
    db.commit()

    templates = get_material_balance_templates(
        location_code=None, status=None, current_user=actor, db=db
    )
    assert [row["location_code"] for row in templates] == ["AGGE"]

    other_template = db.query(MaterialBalanceTemplate).filter(
        MaterialBalanceTemplate.location_code == "LEKKI"
    ).one()
    with pytest.raises(HTTPException) as exc:
        get_material_balance_template_detail(
            other_template.id, current_user=actor, db=db
        )
    assert exc.value.status_code == 403

    with pytest.raises(HTTPException) as exc:
        create_material_balance_template(
            MaterialBalanceTemplateCreate(
                location_code="LEKKI",
                template_name="Unauthorized Template",
            ),
            current_user=actor,
            db=db,
        )
    assert exc.value.status_code == 403


def test_movement_mapping_list_and_details_enforce_location_scope(db):
    view_role, _ = create_role_with_permission(
        db, "Movement Mapping Viewer", "View Movement Mapping"
    )
    manage_role, _ = create_role_with_permission(
        db, "Movement Mapping Manager", "Manage Movement Mapping"
    )
    actor = create_user(db, "movement_mapping_scoped", roles=[view_role, manage_role])
    db.add(UserLocation(user_id=actor.id, location_code="AGGE"))
    mappings = [
        MovementMapping(mapping_type="BARGE_TO_SHUTTLE", location_code="AGGE", reference_number="AGGE-001", status="OPEN"),
        MovementMapping(mapping_type="BARGE_TO_SHUTTLE", location_code="LEKKI", reference_number="LEKKI-001", status="OPEN"),
    ]
    db.add_all(mappings)
    db.commit()

    visible = list_movement_mappings(current_user=actor, db=db)
    assert [row["location_code"] for row in visible] == ["AGGE"]

    with pytest.raises(HTTPException) as exc:
        get_movement_mapping(mappings[1].id, current_user=actor, db=db)
    assert exc.value.status_code == 403

    with pytest.raises(HTTPException) as exc:
        create_movement_mapping(
            MovementMappingCreate(
                mapping_type="BARGE_TO_SHUTTLE",
                location_code="LEKKI",
                reference_number="FORBIDDEN",
            ),
            current_user=actor,
            db=db,
        )
    assert exc.value.status_code == 403


def test_tank_operation_summary_columns_reject_out_of_scope_location(db):
    role, _ = create_role_with_permission(
        db, "Tank Summary Viewer", "View Tank Operation Summary"
    )
    actor = create_user(db, "tank_summary_scoped", roles=[role])
    db.add(UserLocation(user_id=actor.id, location_code="AGGE"))
    db.commit()

    with pytest.raises(HTTPException) as exc:
        get_tank_operation_summary_columns(
            location_code="LEKKI",
            current_user=actor,
            db=db,
        )
    assert exc.value.status_code == 403


def test_multi_role_migration_preserves_existing_assignment_rows(monkeypatch):
    migration_engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    with migration_engine.begin() as connection:
        connection.exec_driver_sql("CREATE TABLE users (id INTEGER PRIMARY KEY)")
        connection.exec_driver_sql("CREATE TABLE roles (id INTEGER PRIMARY KEY)")
        connection.exec_driver_sql("""
            CREATE TABLE user_roles (
                id INTEGER NOT NULL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT unique_user_role UNIQUE (user_id)
            )
        """)
        connection.exec_driver_sql("INSERT INTO users (id) VALUES (1)")
        connection.exec_driver_sql("INSERT INTO roles (id) VALUES (1), (2)")
        connection.exec_driver_sql("INSERT INTO user_roles (id, user_id, role_id) VALUES (9, 1, 1)")

    monkeypatch.setattr(db_migrations, "engine", migration_engine)
    db_migrations.ensure_user_role_multi_role_constraint()

    constraints = inspect(migration_engine).get_unique_constraints("user_roles")
    assert any(set(item["column_names"]) == {"user_id", "role_id"} for item in constraints)
    with migration_engine.begin() as connection:
        row = connection.exec_driver_sql("SELECT id, user_id, role_id FROM user_roles").one()
        assert tuple(row) == (9, 1, 1)
        connection.exec_driver_sql("INSERT INTO user_roles (id, user_id, role_id) VALUES (10, 1, 2)")
    migration_engine.dispose()


def test_user_role_schema_allows_multiple_distinct_roles_but_not_duplicate_pairs(db):
    role_one = Role(role_name="First", status="Active")
    role_two = Role(role_name="Second", status="Active")
    db.add_all([role_one, role_two])
    db.flush()
    user = create_user(db, "two_roles")
    db.add_all([
        UserRole(user_id=user.id, role_id=role_one.id),
        UserRole(user_id=user.id, role_id=role_two.id),
    ])
    db.commit()
    assert db.query(UserRole).filter(UserRole.user_id == user.id).count() == 2

    db.add(UserRole(user_id=user.id, role_id=role_one.id))
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()


def test_refresh_token_cannot_be_used_as_an_access_token(db):
    user = create_user(db, "token_user")
    db.commit()
    refresh = create_refresh_token({"user_id": user.id, "username": user.username})

    with pytest.raises(HTTPException) as exc:
        get_current_user_from_token(authorization=f"Bearer {refresh}", db=db)
    assert exc.value.status_code == 401
    assert exc.value.detail == "Invalid token type"

    access = create_access_token({"user_id": user.id, "username": user.username})
    assert get_current_user_from_token(authorization=f"Bearer {access}", db=db).id == user.id


def test_legacy_user_role_migration_preserves_rows_and_enables_multiple_roles(db):
    first_role = Role(role_name="Migration Role One", status="Active")
    second_role = Role(role_name="Migration Role Two", status="Active")
    third_role = Role(role_name="Migration Role Three", status="Active")
    db.add_all([first_role, second_role, third_role])
    db.flush()
    first_user = create_user(db, "migration_user_one", roles=[first_role])
    second_user = create_user(db, "migration_user_two", roles=[second_role])
    db.commit()
    old_rows = [
        (row.id, row.user_id, row.role_id, row.created_at)
        for row in db.query(UserRole).order_by(UserRole.id).all()
    ]

    # Recreate the pre-hardening one-role schema and assignments, then run the
    # production startup migration against that legacy shape.
    with app_engine.begin() as connection:
        connection.execute(text("""
            CREATE TABLE user_roles__legacy_test (
                id INTEGER NOT NULL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT unique_user_role UNIQUE (user_id)
            )
        """))
        connection.execute(text("""
            INSERT INTO user_roles__legacy_test (id, user_id, role_id, created_at)
            SELECT id, user_id, role_id, created_at FROM user_roles
        """))
        connection.execute(text("DROP TABLE user_roles"))
        connection.execute(text("ALTER TABLE user_roles__legacy_test RENAME TO user_roles"))

    ensure_user_role_multi_role_constraint()
    constraints = inspect(app_engine).get_unique_constraints("user_roles")
    assert any(set(item["column_names"]) == {"user_id", "role_id"} for item in constraints)
    assert not any(set(item["column_names"]) == {"user_id"} for item in constraints)
    new_rows = [
        (row.id, row.user_id, row.role_id, row.created_at)
        for row in db.query(UserRole).order_by(UserRole.id).all()
    ]
    assert new_rows == old_rows

    db.add(UserRole(user_id=first_user.id, role_id=third_role.id))
    db.commit()
    assert db.query(UserRole).filter(UserRole.user_id == first_user.id).count() == 2
    assert db.query(UserRole).filter(UserRole.user_id == second_user.id).count() == 1


def test_refresh_tokens_rotate_and_old_refresh_token_is_revoked(db):
    user = create_user(db, "refresh_rotation_user")
    db.commit()
    refresh = create_refresh_token({"user_id": user.id, "username": user.username})

    refreshed = refresh_access_token(
        RefreshTokenRequest(refresh_token=refresh),
        db=db,
    )
    assert refreshed["access_token"]
    assert refreshed["refresh_token"] != refresh

    with pytest.raises(HTTPException) as exc:
        refresh_access_token(
            RefreshTokenRequest(refresh_token=refresh),
            db=db,
        )
    assert exc.value.status_code == 401
    assert exc.value.detail == "Refresh token has been revoked"


def test_legacy_transaction_endpoint_cannot_create_approved_records(db):
    role, _ = create_role_with_permission(db, "Operator", "Create Operation Entry")
    actor = create_user(db, "operator", roles=[role])
    db.commit()
    payload = OperationTransactionCreate(
        operation_type_code="MOVE",
        primary_asset_code="TRUCK-1",
        origin_location_code="AGGE",
        operation_date=date(2026, 1, 1),
        status="Approved",
    )

    with pytest.raises(HTTPException) as exc:
        create_operation_transaction(payload, current_user=actor, db=db)
    assert exc.value.status_code == 400
    assert "start in Draft" in exc.value.detail
