from datetime import date
from types import SimpleNamespace

from sqlalchemy import create_engine, inspect, text

from app.utils import db_migrations
from app.models import (
    MovementMapping,
    OperationTask,
    OperationTransaction,
    OperationTransactionValue,
    Permission,
    Role,
    RolePermission,
    User,
    UserLocation,
    UserRole,
)
from app.routers.movement_mappings import (
    archive_movement_mapping,
    create_movement_mapping,
    extract_transaction_quantities,
    list_movement_mappings,
    restore_movement_mapping,
    sum_optional,
    update_movement_mapping,
)
from app.routers.operation_tasks import (
    close_operation_approval_tasks_for_transaction,
    create_operation_approval_task_for_transaction,
    get_my_operation_tasks,
    get_my_operation_tasks_paged,
    reject_operation_task,
    resolve_effective_operation_task_status,
)
from app.schemas import (
    MovementMappingCreate,
    MovementMappingUpdate,
    OperationTaskActionRequest,
    OperationTaskPageResponse,
)


def _admin(db):
    role = Role(role_name="Admin", status="Active")
    db.add(role)
    db.flush()
    user = User(
        full_name="Test Administrator",
        username="admin",
        email="admin@example.test",
        password_hash="test-only",
        status="Active",
        all_locations_access="Yes",
    )
    db.add(user)
    db.flush()
    db.add(UserRole(user_id=user.id, role_id=role.id))
    db.flush()
    return user


def test_legacy_open_task_status_follows_approved_transaction(db):
    task_state = SimpleNamespace(task_type="OPERATION_APPROVAL", status="Pending")
    approved_state = SimpleNamespace(status="Approved")
    submitted_state = SimpleNamespace(status="Submitted")

    assert resolve_effective_operation_task_status(task_state, approved_state) == "Approved"
    assert resolve_effective_operation_task_status(task_state, submitted_state) == "Pending"
    assert resolve_effective_operation_task_status(
        SimpleNamespace(task_type="OPERATION_APPROVAL", status="Rejected"), approved_state
    ) == "Rejected"
    assert resolve_effective_operation_task_status(
        SimpleNamespace(task_type="PASSWORD_RESET_REQUEST", status="Pending"), approved_state
    ) == "Pending"

    admin = _admin(db)
    transaction = OperationTransaction(
        operation_number="TASK-APPROVED-001",
        operation_type_code="SHUTTLE_MOVE",
        primary_asset_code="SHUTTLE_01",
        primary_asset_type_code="SHUTTLE",
        origin_location_code="AGGE",
        operation_date=date(2026, 10, 1),
        status="Approved",
    )
    db.add(transaction)
    db.flush()
    task = OperationTask(
        task_number="TASK-LEGACY-001",
        task_type="OPERATION_APPROVAL",
        transaction_id=transaction.id,
        status="Pending",
        priority="Normal",
        assigned_user_ids_json=[],
        assigned_role_ids_json=[],
    )
    db.add(task)
    db.flush()

    approved_rows = get_my_operation_tasks(status="Approved", current_user=admin, db=db)
    pending_rows = get_my_operation_tasks(status="Pending", current_user=admin, db=db)
    assert [row["id"] for row in approved_rows] == [task.id]
    assert approved_rows[0]["status"] == "Approved"
    assert pending_rows == []


def test_task_manager_paged_endpoint_limits_rows_and_counts_effective_status(db):
    admin = _admin(db)
    for index in range(25):
        db.add(
            OperationTask(
                task_number=f"TASK-PAGE-{index:03d}",
                task_type="PASSWORD_RESET_REQUEST",
                status="Pending",
                priority="Normal",
                location_code="AGGE",
                assigned_user_ids_json=[],
                assigned_role_ids_json=[],
            )
        )

    transaction = OperationTransaction(
        operation_number="TASK-PAGE-APPROVED",
        operation_type_code="SHUTTLE_MOVE",
        primary_asset_code="SHUTTLE_01",
        primary_asset_type_code="SHUTTLE",
        origin_location_code="AGGE",
        operation_date=date(2026, 10, 1),
        status="Approved",
    )
    db.add(transaction)
    db.flush()
    db.add(
        OperationTask(
            task_number="TASK-PAGE-LEGACY-APPROVED",
            task_type="OPERATION_APPROVAL",
            transaction_id=transaction.id,
            status="Pending",
            priority="Normal",
            location_code="AGGE",
            assigned_user_ids_json=[],
            assigned_role_ids_json=[],
        )
    )
    db.flush()

    first_page = get_my_operation_tasks_paged(
        status="Pending", page=1, page_size=20, current_user=admin, db=db
    )
    assert len(first_page["rows"]) == 20
    assert first_page["total_rows"] == 25
    assert first_page["has_more"] is True
    assert first_page["status_counts"] == {"Pending": 25, "Approved": 1, "ALL": 26}
    OperationTaskPageResponse.model_validate(first_page)

    second_page = get_my_operation_tasks_paged(
        status="Pending", page=2, page_size=20, current_user=admin, db=db
    )
    assert len(second_page["rows"]) == 5
    assert second_page["has_more"] is False

    approved_page = get_my_operation_tasks_paged(
        status="Approved", page=1, page_size=20, current_user=admin, db=db
    )
    assert approved_page["total_rows"] == 1
    assert approved_page["rows"][0]["status"] == "Approved"
    assert approved_page["rows"][0]["transaction"] == {"status": "Approved"}


def test_task_manager_paged_query_filters_by_user_and_role_assignments(db):
    role = Role(role_name="Task Reviewer", status="Active")
    permission = Permission(
        permission_name="View My Tasks",
        module_name="Operations",
        status="Active",
    )
    db.add_all([role, permission])
    db.flush()
    db.add(RolePermission(role_id=role.id, permission_id=permission.id))
    user = User(
        full_name="Task Reviewer",
        username="task-reviewer",
        email="task-reviewer@example.test",
        password_hash="test-only",
        status="Active",
        all_locations_access="Yes",
    )
    db.add(user)
    db.flush()
    db.add(UserRole(user_id=user.id, role_id=role.id))

    for task_number, user_ids, role_ids in (
        ("TASK-ASSIGNED-ROLE", [], [role.id]),
        ("TASK-ASSIGNED-USER", [user.id], []),
        ("TASK-UNASSIGNED", [], []),
    ):
        db.add(
            OperationTask(
                task_number=task_number,
                task_type="PASSWORD_RESET_REQUEST",
                status="Pending",
                priority="Normal",
                location_code="AGGE",
                assigned_user_ids_json=user_ids,
                assigned_role_ids_json=role_ids,
            )
        )
    db.flush()

    page = get_my_operation_tasks_paged(current_user=user, db=db)
    assert {task["task_number"] for task in page["rows"]} == {
        "TASK-ASSIGNED-ROLE",
        "TASK-ASSIGNED-USER",
    }
    assert page["total_rows"] == 2


def test_approver_can_open_task_manager_without_view_permission_or_destination_scope(db):
    role = Role(role_name="Origin Approver", status="Active")
    permission = Permission(
        permission_name="Approve Operation Transaction",
        module_name="Operations",
        status="Active",
    )
    db.add_all([role, permission])
    db.flush()
    db.add(RolePermission(role_id=role.id, permission_id=permission.id))
    user = User(
        full_name="Origin Approver",
        username="origin-approver",
        email="origin-approver@example.test",
        password_hash="test-only",
        status="Active",
        all_locations_access="No",
    )
    db.add(user)
    db.flush()
    db.add_all([
        UserRole(user_id=user.id, role_id=role.id),
        UserLocation(user_id=user.id, location_code="AGGE"),
    ])

    transaction = OperationTransaction(
        operation_number="TASK-ORIGIN-SCOPE-001",
        operation_type_code="BARGE_LOADING",
        primary_asset_code="BARGE_01",
        primary_asset_type_code="BARGE",
        origin_location_code="AGGE",
        destination_location_code="BONNY",
        operation_date=date(2026, 10, 1),
        status="Submitted",
    )
    db.add(transaction)
    db.flush()
    task = OperationTask(
        task_number="TASK-ORIGIN-SCOPE-001",
        task_type="OPERATION_APPROVAL",
        transaction_id=transaction.id,
        location_code="AGGE",
        status="Pending",
        priority="Normal",
        assigned_user_ids_json=[],
        assigned_role_ids_json=[],
    )
    db.add(task)
    db.flush()

    page = get_my_operation_tasks_paged(current_user=user, db=db)

    assert [row["id"] for row in page["rows"]] == [task.id]
    assert page["status_counts"] == {"Pending": 1, "ALL": 1}


def test_approval_task_assigns_all_operation_decision_roles(db):
    role_ids = set()
    for index, permission_name in enumerate((
        "Approve Operation Transaction",
        "Reject Operation Transaction",
        "Cancel Operation Transaction",
        "Request Approved Transaction Correction",
    )):
        role = Role(role_name=f"Decision Role {index}", status="Active")
        permission = Permission(
            permission_name=permission_name,
            module_name="Operations",
            status="Active",
        )
        db.add_all([role, permission])
        db.flush()
        db.add(RolePermission(role_id=role.id, permission_id=permission.id))
        role_ids.add(role.id)

    submitter = User(
        full_name="Submitter",
        username="task-submitter",
        email="task-submitter@example.test",
        password_hash="test-only",
        status="Active",
    )
    transaction = OperationTransaction(
        operation_number="TASK-ASSIGN-DECISIONS",
        operation_type_code="BARGE_LOADING",
        primary_asset_code="BARGE_02",
        primary_asset_type_code="BARGE",
        origin_location_code="AGGE",
        operation_date=date(2026, 10, 1),
        status="Submitted",
    )
    db.add_all([submitter, transaction])
    db.flush()

    task = create_operation_approval_task_for_transaction(db, transaction, submitter)

    assert set(task.assigned_role_ids_json) == role_ids


def test_cancelling_rejected_ticket_moves_task_to_cancelled_tab(db):
    admin = _admin(db)
    transaction = OperationTransaction(
        operation_number="TASK-CANCEL-REJECTED",
        operation_type_code="BARGE_LOADING",
        primary_asset_code="BARGE_03",
        primary_asset_type_code="BARGE",
        origin_location_code="AGGE",
        operation_date=date(2026, 10, 1),
        status="Cancelled",
    )
    db.add(transaction)
    db.flush()
    task = OperationTask(
        task_number="TASK-CANCEL-REJECTED",
        task_type="OPERATION_APPROVAL",
        transaction_id=transaction.id,
        location_code="AGGE",
        status="Rejected",
        priority="Normal",
        assigned_user_ids_json=[],
        assigned_role_ids_json=[],
    )
    db.add(task)
    db.flush()

    close_operation_approval_tasks_for_transaction(
        db=db,
        transaction=transaction,
        current_user=admin,
        task_status="Cancelled",
        action_taken="Cancelled",
        notes="Cancelled after rejection",
    )

    assert task.status == "Cancelled"
    assert task.action_taken == "Cancelled"


def test_reject_permission_can_act_without_unrelated_task_action_permission(db):
    role = Role(role_name="Transaction Rejector", status="Active")
    permission = Permission(
        permission_name="Reject Operation Transaction",
        module_name="Operations",
        status="Active",
    )
    user = User(
        full_name="Transaction Rejector",
        username="transaction-rejector",
        email="transaction-rejector@example.test",
        password_hash="test-only",
        status="Active",
        all_locations_access="Yes",
    )
    db.add_all([role, permission, user])
    db.flush()
    db.add_all([
        RolePermission(role_id=role.id, permission_id=permission.id),
        UserRole(user_id=user.id, role_id=role.id),
    ])
    transaction = OperationTransaction(
        operation_number="TASK-REJECT-PERMISSION",
        operation_type_code="TANK_TRANSFER",
        primary_asset_code="TANK_01",
        primary_asset_type_code="TANK",
        origin_location_code="AGGE",
        operation_date=date(2026, 10, 1),
        status="Submitted",
    )
    db.add(transaction)
    db.flush()
    task = OperationTask(
        task_number="TASK-REJECT-PERMISSION",
        task_type="OPERATION_APPROVAL",
        transaction_id=transaction.id,
        location_code="AGGE",
        status="Pending",
        priority="Normal",
        assigned_user_ids_json=[],
        assigned_role_ids_json=[],
    )
    db.add(task)
    db.flush()

    reject_operation_task(
        task_id=task.id,
        payload=OperationTaskActionRequest(remarks="Rejected from Task Manager"),
        current_user=user,
        db=db,
    )

    db.refresh(task)
    assert transaction.status == "Rejected"
    assert task.status == "Rejected"
    rejected_page = get_my_operation_tasks_paged(
        status="Rejected", current_user=user, db=db
    )
    assert [row["id"] for row in rejected_page["rows"]] == [task.id]


def test_movement_mapping_edit_archive_and_restore_preserve_record(db):
    admin = _admin(db)
    mapping = create_movement_mapping(
        MovementMappingCreate(
            mapping_type="BARGE_TO_SHUTTLE",
            location_code="AGGE",
            reference_number="CONVOY-01",
            product_name="Crude",
        ),
        current_user=admin,
        db=db,
    )

    updated = update_movement_mapping(
        mapping["id"],
        MovementMappingUpdate(product_name="Export crude", remarks="Reconciled"),
        current_user=admin,
        db=db,
    )
    assert updated["product_name"] == "Export crude"
    assert updated["remarks"] == "Reconciled"

    archived = archive_movement_mapping(mapping["id"], current_user=admin, db=db)
    assert archived["archived_at"] is not None
    assert db.query(MovementMapping).filter_by(id=mapping["id"]).one().reference_number == "CONVOY-01"
    assert list_movement_mappings(current_user=admin, db=db) == []
    assert [row["id"] for row in list_movement_mappings(archived=True, current_user=admin, db=db)] == [mapping["id"]]

    restored = restore_movement_mapping(mapping["id"], current_user=admin, db=db)
    assert restored["archived_at"] is None
    assert restored["product_name"] == "Export crude"
    assert [row["id"] for row in list_movement_mappings(current_user=admin, db=db)] == [mapping["id"]]


def test_movement_mapping_gsv_is_kept_separate_and_incomplete_aggregate_is_null(db):
    transaction = OperationTransaction(
        operation_number="MM-GSV-001",
        operation_type_code="SHUTTLE_MOVE",
        primary_asset_code="SHUTTLE_01",
        primary_asset_type_code="SHUTTLE",
        origin_location_code="AGGE",
        operation_date=date(2026, 10, 1),
        status="Approved",
    )
    db.add(transaction)
    db.flush()
    db.add(OperationTransactionValue(
        transaction_id=transaction.id,
        field_code="shuttle_payload",
        field_name="Shuttle payload",
        data_type="JSON",
        input_mode="System",
        calculation_role="Input",
        field_value={"calculated": {"net": {"TOV": 120, "FW": 8, "GSV": 112, "NSV": 104}}},
    ))
    db.flush()

    assert extract_transaction_quantities(db, transaction) == (120, 8, 112, 104)
    assert sum_optional([SimpleNamespace(gsv_bbl=112), SimpleNamespace(gsv_bbl=None)], "gsv_bbl") is None
    assert sum_optional([SimpleNamespace(gsv_bbl=112), SimpleNamespace(gsv_bbl=108)], "gsv_bbl") == 220


def test_movement_mapping_management_migration_is_additive_and_repeatable(monkeypatch):
    migration_engine = create_engine("sqlite:///:memory:")
    with migration_engine.begin() as connection:
        connection.execute(text("CREATE TABLE movement_mappings (id INTEGER PRIMARY KEY, status VARCHAR(30))"))
        connection.execute(text("CREATE TABLE movement_mapping_items (id INTEGER PRIMARY KEY, quantity_bbl FLOAT)"))
        connection.execute(text("CREATE TABLE movement_mapping_comparisons (id INTEGER PRIMARY KEY, difference_bbl FLOAT)"))
        connection.execute(text("INSERT INTO movement_mappings (id, status) VALUES (1, 'Open')"))
        connection.execute(text("INSERT INTO movement_mapping_items (id, quantity_bbl) VALUES (1, 125.5)"))

    monkeypatch.setattr(db_migrations, "engine", migration_engine)
    db_migrations.ensure_movement_mapping_management_columns()
    db_migrations.ensure_movement_mapping_management_columns()

    inspector = inspect(migration_engine)
    assert {"archived_at", "archived_by"}.issubset(
        {column["name"] for column in inspector.get_columns("movement_mappings")}
    )
    assert "gsv_bbl" in {column["name"] for column in inspector.get_columns("movement_mapping_items")}
    assert {"source_gsv_bbl", "target_gsv_bbl"}.issubset(
        {column["name"] for column in inspector.get_columns("movement_mapping_comparisons")}
    )
    with migration_engine.connect() as connection:
        assert connection.execute(text("SELECT status FROM movement_mappings WHERE id = 1")).scalar_one() == "Open"
        assert connection.execute(text("SELECT quantity_bbl FROM movement_mapping_items WHERE id = 1")).scalar_one() == 125.5
    migration_engine.dispose()
