"""Task Manager HTTP flows (frontend page → backend endpoints).

OperationTaskManager.jsx drives these endpoints on load, on task selection and
after every action. The Task Manager password-reset task lifecycle is covered
end to end here: a PASSWORD_RESET_REQUEST task (created by
POST /auth/forgot-password) is listed, opened and then completed by the
admin password reset, which closes the task.
"""
from datetime import date

from app.models import (
    OperationTask,
    OperationTransaction,
    User,
)
from app.utils.security import hash_password


def _login_headers(client, db, username="admin"):
    user = db.query(User).filter(User.username == username).first()
    if not user:
        user = User(
            full_name="System Administrator",
            username=username,
            email="admin@example.com",
            password_hash=hash_password("AdminPass123!"),
            status="Active",
            all_locations_access="Yes",
        )
        db.add(user)
        db.commit()
    resp = client.post(
        "/auth/login",
        json={"username": username, "password": "AdminPass123!"},
    )
    assert resp.status_code == 200, f"login failed: {resp.status_code} {resp.text}"
    body = resp.json()
    assert "access_token" in body, f"unexpected login body: {body}"
    return {"Authorization": f"Bearer {body['access_token']}"}, user


def _seed_approval_task(db, user):
    tx = OperationTransaction(
        operation_number="OP-TASKFLOW-001",
        operation_type_code="SHUTTLE_MOVE",
        primary_asset_code="SHUTTLE_01",
        primary_asset_type_code="SHUTTLE",
        origin_location_code="AGGE",
        operation_date=date(2026, 10, 1),
        status="Submitted",
    )
    db.add(tx)
    db.flush()
    task = OperationTask(
        task_number="TASK-FLOW-001",
        task_type="OPERATION_APPROVAL",
        transaction_id=tx.id,
        ticket_number="TKT-TASKFLOW-001",
        operation_number="OP-TASKFLOW-001",
        status="Pending",
        priority="Normal",
        assigned_user_ids_json=[],
        assigned_role_ids_json=[],
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


def test_task_manager_page_load_select_and_approval_flow(client, db):
    headers, user = _login_headers(client, db)
    task = _seed_approval_task(db, user)

    # 1. Page load: GET /operation-tasks/my/paged (list + status counts)
    r = client.get("/operation-tasks/my/paged?status=Pending&page=1&page_size=20", headers=headers)
    assert r.status_code == 200, r.text
    payload = r.json()
    assert payload["total_rows"] >= 1
    assert any(row["id"] == task.id for row in payload["rows"])
    assert payload["status_counts"].get("Pending", 0) >= 1

    # 2. Select task: events panel
    r = client.get(f"/operation-tasks/{task.id}/events", headers=headers)
    assert r.status_code == 200, r.text

    # 3. Take ownership → release → take again → approve
    r = client.post(f"/operation-tasks/{task.id}/take-ownership", headers=headers, json={"remarks": ""})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "In Progress"

    r = client.post(f"/operation-tasks/{task.id}/release", headers=headers, json={"remarks": ""})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "Pending"

    r = client.post(f"/operation-tasks/{task.id}/take-ownership", headers=headers, json={"remarks": ""})
    assert r.status_code == 200, r.text

    r = client.post(
        f"/operation-tasks/{task.id}/approve",
        headers=headers,
        json={"remarks": "Approved from Task Manager"},
    )
    assert r.status_code == 200, r.text

    # 4. Post-action refresh: single task + events
    r = client.get(f"/operation-tasks/{task.id}", headers=headers)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "Approved"

    r = client.get(f"/operation-tasks/{task.id}/events", headers=headers)
    assert r.status_code == 200, r.text
    assert len(r.json()) >= 3


def test_password_reset_task_created_and_closed_through_admin_reset(client, db):
    """LoginPage forgot-password → Task Manager task → admin reset closes it."""
    headers, admin = _login_headers(client, db)

    target = User(
        full_name="Locked Out User",
        username="locked-out",
        email="locked-out@example.com",
        password_hash=hash_password("OldPass12345!"),
        status="Active",
        all_locations_access="No",
    )
    db.add(target)
    db.commit()

    # 1. User requests a reset from the LoginPage; this creates the request and
    #    the PASSWORD_RESET_REQUEST task shown in the Task Manager.
    r = client.post(
        "/auth/forgot-password",
        json={"username": "locked-out", "reason": "Forgot password", "reset_2fa": False},
    )
    assert r.status_code == 200, r.text

    task = (
        db.query(OperationTask)
        .filter(OperationTask.task_type == "PASSWORD_RESET_REQUEST")
        .order_by(OperationTask.id.desc())
        .first()
    )
    assert task is not None, "forgot-password must create a Task Manager task"
    assert task.status == "Pending"

    # 2. The task is visible in the Task Manager and can be opened.
    r = client.get("/operation-tasks/my/paged?page=1&page_size=20", headers=headers)
    assert r.status_code == 200, r.text
    assert any(row["id"] == task.id for row in r.json()["rows"])

    r = client.get(f"/operation-tasks/{task.id}/events", headers=headers)
    assert r.status_code == 200, r.text

    # 3. Profile & Security "Admin Password Reset" completes the workflow and
    #    closes the task. (This endpoint previously returned 404 "Not Found"
    #    because the frontend called it without the /auth router prefix.)
    r = client.post(
        f"/auth/users/{target.id}/security/reset-password",
        headers=headers,
        json={
            "new_password": "ResetPass12345!",
            "force_password_change": True,
            "reset_2fa": False,
            "remarks": "Reset per password-reset task",
        },
    )
    assert r.status_code == 200, r.text

    db.refresh(task)
    assert task.status == "Closed"
    assert task.action_taken == "Password Reset Completed"

    # The target can log in with the new password.
    r = client.post(
        "/auth/login",
        json={"username": "locked-out", "password": "ResetPass12345!"},
    )
    assert r.status_code == 200, r.text
