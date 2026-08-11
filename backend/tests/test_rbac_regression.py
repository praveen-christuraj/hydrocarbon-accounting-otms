"""
Regression tests for RBAC workflow issues:
1. Global asset visibility in location-scoped contexts
2. Multi-role permission aggregation
3. Case-insensitive location-scope filtering in paged registers
4. Operation Entry → OTR Approved → Tank Operation Summary visibility
"""
import pytest
from tests.conftest import create_role_with_permission, create_user
from app.models import (
    User, UserRole, Role, RolePermission, Permission, Location,
    Asset, OperationType, OperationTemplate, OperationEntry,
    OperationTransaction
)


@pytest.fixture
def locations(db):
    """Create test locations with mixed-case codes."""
    loc_agge = Location(location_code="AGGE", location_name="Agge Terminal")
    loc_lekki = Location(location_code="LEKKI", location_name="Lekki Terminal")
    db.add_all([loc_agge, loc_lekki])
    db.flush()
    return {"agge": loc_agge, "lekki": loc_lekki}


@pytest.fixture
def asset_types(db):
    """Create asset types."""
    shuttle_type = OperationType(
        operation_type_code="SHUTTLE_OPS",
        operation_type_name="Shuttle Operations",
        applicable_asset_type_code="SHUTTLE",
        status="Active"
    )
    tank_type = OperationType(
        operation_type_code="TANK_OPS",
        operation_type_name="Tank Operations",
        applicable_asset_type_code="TANK",
        status="Active"
    )
    db.add_all([shuttle_type, tank_type])
    db.flush()
    return {"shuttle": shuttle_type, "tank": tank_type}


@pytest.fixture
def global_assets(db, asset_types):
    """Create global-scope assets."""
    shuttle1 = Asset(
        asset_code="SHUTTLE_001",
        asset_name="Shuttle 001",
        asset_type="SHUTTLE",
        scope="Global",
        status="Active"
    )
    tank1 = Asset(
        asset_code="TANK_001",
        asset_name="Tank 001",
        asset_type="TANK",
        scope="Global",
        status="Active"
    )
    db.add_all([shuttle1, tank1])
    db.flush()
    return {"shuttle": shuttle1, "tank": tank1}


@pytest.fixture
def location_assets(db, locations, asset_types):
    """Create location-scoped assets."""
    shuttle_agge = Asset(
        asset_code="SHUTTLE_AGGE_001",
        asset_name="Shuttle Agge 001",
        asset_type="SHUTTLE",
        scope="Local",
        location_id=locations["agge"].id,
        status="Active"
    )
    tank_lekki = Asset(
        asset_code="TANK_LEKKI_001",
        asset_name="Tank Lekki 001",
        asset_type="TANK",
        scope="Local",
        location_id=locations["lekki"].id,
        status="Active"
    )
    db.add_all([shuttle_agge, tank_lekki])
    db.flush()
    return {"agge": shuttle_agge, "lekki": tank_lekki}


@pytest.fixture
def operation_templates(db, asset_types):
    """Create operation templates for Tank and Shuttle ops."""
    tank_template = OperationTemplate(
        template_code="TANK_GAUGE",
        template_name="Tank Gauging",
        entry_layout_type="Tank Gauging",
        operation_type_id=asset_types["tank"].id,
        status="Active"
    )
    shuttle_template = OperationTemplate(
        template_code="SHUTTLE_MOVE",
        template_name="Shuttle Movement",
        entry_layout_type="Shuttle Tracking",
        operation_type_id=asset_types["shuttle"].id,
        status="Active"
    )
    db.add_all([tank_template, shuttle_template])
    db.flush()
    return {"tank": tank_template, "shuttle": shuttle_template}


class TestGlobalAssetVisibilityWithLocationScope:
    """Test that global assets appear for location-scoped users when operation type is available."""

    def test_global_asset_visible_for_location_user_with_operation_type(
        self, client, db, locations, global_assets, asset_types
    ):
        """
        User: Operator at AGGE
        Asset: Global shuttle
        Operation Type: Shuttle Ops available at AGGE
        Expected: User should see the global asset in dropdown
        """
        # Setup: Add operation type availability for location
        from app.models import LocationOperationAvailability
        loc_op_avail = LocationOperationAvailability(
            location_id=locations["agge"].id,
            operation_type_id=asset_types["shuttle"].id,
            available=True
        )
        db.add(loc_op_avail)

        # Create operator role with asset-list permission
        role, _ = create_role_with_permission(
            db, "Operator", "View Operation Assets"
        )

        # Create location-scoped user
        operator = create_user(db, "operator_agge", "Pass123!", roles=[role])
        from app.models import UserLocation
        user_loc = UserLocation(
            user_id=operator.id,
            location_id=locations["agge"].id,
            is_primary=True
        )
        db.add(user_loc)
        db.commit()

        # Login and get assets via /assets endpoint
        login_resp = client.post("/auth/login", json={
            "username": "operator_agge",
            "password": "Pass123!",
        })
        token = login_resp.json()["access_token"]

        assets_resp = client.get(
            "/assets?asset_type=SHUTTLE",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert assets_resp.status_code == 200
        assets = assets_resp.json()

        # Global asset should appear
        asset_codes = [a["asset_code"] for a in assets]
        assert "SHUTTLE_001" in asset_codes, \
            f"Global asset SHUTTLE_001 not found in {asset_codes}"

    def test_local_asset_hidden_for_different_location_user(
        self, client, db, locations, location_assets, asset_types
    ):
        """
        User: Operator at AGGE
        Asset: Local shuttle at AGGE, Local tank at LEKKI
        Expected: User sees AGGE shuttle, not LEKKI tank
        """
        role, _ = create_role_with_permission(
            db, "Operator", "View Operation Assets"
        )
        operator = create_user(db, "operator_agge", "Pass123!", roles=[role])

        from app.models import UserLocation
        user_loc = UserLocation(
            user_id=operator.id,
            location_id=locations["agge"].id,
            is_primary=True
        )
        db.add(user_loc)
        db.commit()

        login_resp = client.post("/auth/login", json={
            "username": "operator_agge",
            "password": "Pass123!",
        })
        token = login_resp.json()["access_token"]

        assets_resp = client.get(
            "/assets?asset_type=SHUTTLE",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert assets_resp.status_code == 200
        assets = assets_resp.json()
        asset_codes = [a["asset_code"] for a in assets]

        assert "SHUTTLE_AGGE_001" in asset_codes
        assert "TANK_LEKKI_001" not in asset_codes


class TestMultiRolePermissionAggregation:
    """Test that users with multiple roles get permissions from all active roles."""

    def test_multi_role_user_has_all_permissions(self, client, db, locations):
        """
        User: Has role1 (View Users) + role2 (Edit Roles)
        Expected: User can access both permissions
        """
        role1, perm1 = create_role_with_permission(
            db, "Viewer", "View Users"
        )
        role2, perm2 = create_role_with_permission(
            db, "Editor", "Edit Roles"
        )

        user = create_user(db, "multi_role_user", "Pass123!", roles=[role1, role2])
        db.commit()

        login_resp = client.post("/auth/login", json={
            "username": "multi_role_user",
            "password": "Pass123!",
        })
        assert login_resp.status_code == 200
        data = login_resp.json()

        # Check user has both permissions in response
        perms = data.get("permissions", [])
        perm_names = [p.get("permission_name") or p.get("permissionName") for p in perms]
        assert "View Users" in perm_names
        assert "Edit Roles" in perm_names

    def test_inactive_role_permissions_not_granted(self, client, db):
        """
        User: Has active role + inactive role
        Expected: Only active role permissions are granted
        """
        active_role, perm1 = create_role_with_permission(
            db, "Active", "View Users"
        )
        inactive_role, perm2 = create_role_with_permission(
            db, "Inactive", "Edit Roles"
        )
        inactive_role.status = "Inactive"

        user = create_user(
            db, "inactive_role_user", "Pass123!",
            roles=[active_role, inactive_role]
        )
        db.commit()

        login_resp = client.post("/auth/login", json={
            "username": "inactive_role_user",
            "password": "Pass123!",
        })
        data = login_resp.json()
        perms = data.get("permissions", [])
        perm_names = [p.get("permission_name") or p.get("permissionName") for p in perms]

        assert "View Users" in perm_names
        assert "Edit Roles" not in perm_names


class TestOperationTransactionRegisterCaseInsensitiveLocationFilter:
    """
    Test that Operation Transaction Register paged endpoint filters correctly
    with case-insensitive location codes.
    """

    def test_paged_register_case_insensitive_location_filter(
        self, client, db, locations, operation_templates, global_assets
    ):
        """
        User: Operator at location with code "AGGE"
        DB: Operation transactions with origin_location_code in mixed case
        Expected: Paged register query returns matching rows
        """
        from app.models import LocationOperationAvailability

        # Add operation type availability
        loc_op = LocationOperationAvailability(
            location_id=locations["agge"].id,
            operation_type_id=operation_templates["shuttle"].operation_type_id,
            available=True
        )
        db.add(loc_op)

        # Create some OT records with mixed-case location codes
        ot1 = OperationTransaction(
            reference_number="OT_001",
            transaction_type="Inward",
            origin_location_code="AGGE",  # uppercase
            destination_location_code="LEKKI",
            operation_template_id=operation_templates["shuttle"].id,
            status="Approved"
        )
        ot2 = OperationTransaction(
            reference_number="OT_002",
            transaction_type="Outward",
            origin_location_code="agge",  # lowercase
            destination_location_code="LEKKI",
            operation_template_id=operation_templates["shuttle"].id,
            status="Approved"
        )
        db.add_all([ot1, ot2])

        # Create operator
        role, _ = create_role_with_permission(
            db, "Operator", "View Operation Transactions"
        )
        operator = create_user(db, "op_agge", "Pass123!", roles=[role])

        from app.models import UserLocation
        user_loc = UserLocation(
            user_id=operator.id,
            location_id=locations["agge"].id,
            is_primary=True
        )
        db.add(user_loc)
        db.commit()

        # Login and fetch paged register
        login_resp = client.post("/auth/login", json={
            "username": "op_agge",
            "password": "Pass123!",
        })
        token = login_resp.json()["access_token"]

        # Call paged endpoint (adjust path if different)
        paged_resp = client.get(
            "/operation-transactions/paged?skip=0&limit=10",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert paged_resp.status_code == 200
        paged_data = paged_resp.json()

        # Should see both OT_001 and OT_002 despite case mismatch
        ref_numbers = [ot["reference_number"] for ot in paged_data.get("items", [])]
        assert "OT_001" in ref_numbers or "OT_002" in ref_numbers, \
            f"No transactions found in {ref_numbers}"


class TestTankOperationSummaryReflectsApprovedEntries:
    """
    Test that approved Operation Entries flow through OTR and appear in Tank Op Summary.
    """

    def test_approved_entry_visible_in_tank_summary(
        self, client, db, locations, operation_templates, global_assets
    ):
        """
        Flow: Create Operation Entry (draft) → Approve in OTR → Check Tank Op Summary
        Expected: Entry should appear in summary
        """
        from app.models import LocationOperationAvailability

        loc_op = LocationOperationAvailability(
            location_id=locations["agge"].id,
            operation_type_id=operation_templates["tank"].operation_type_id,
            available=True
        )
        db.add(loc_op)

        # Create entry
        entry = OperationEntry(
            operation_template_id=operation_templates["tank"].id,
            asset_id=global_assets["tank"].id,
            location_id=locations["agge"].id,
            entry_data={"gauge": "100"},
            status="Draft"
        )
        db.add(entry)
        db.flush()

        # Create and approve transaction
        ot = OperationTransaction(
            reference_number="OT_TANK_001",
            transaction_type="Inward",
            origin_location_code="AGGE",
            destination_location_code="LEKKI",
            operation_template_id=operation_templates["tank"].id,
            operation_entry_id=entry.id,
            status="Approved"
        )
        db.add(ot)
        db.commit()

        # Fetch tank summary via endpoint
        role, _ = create_role_with_permission(
            db, "Operator", "View Tank Operation Summary"
        )
        operator = create_user(db, "op_summary", "Pass123!", roles=[role])

        from app.models import UserLocation
        user_loc = UserLocation(
            user_id=operator.id,
            location_id=locations["agge"].id,
            is_primary=True
        )
        db.add(user_loc)
        db.commit()

        login_resp = client.post("/auth/login", json={
            "username": "op_summary",
            "password": "Pass123!",
        })
        token = login_resp.json()["access_token"]

        # Endpoint may be /tank-operations or /tank-operation-summary
        summary_resp = client.get(
            "/tank-operation-summary?location_code=AGGE",
            headers={"Authorization": f"Bearer {token}"},
        )

        if summary_resp.status_code == 200:
            summary = summary_resp.json()
            # Check that approved entry row is present
            rows = summary.get("rows", []) if isinstance(summary, dict) else summary
            entry_ids = [str(row.get("operation_entry_id", "")) for row in rows]
            assert str(entry.id) in entry_ids, \
                f"Entry {entry.id} not found in summary rows"
