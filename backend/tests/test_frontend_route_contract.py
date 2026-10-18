"""Frontend ↔ backend route contract.

The Task Manager's password-reset workflow (LoginPage → PasswordResetRequest →
OperationTask in the Task Manager → Admin Password Reset in Profile & Security)
broke with a bare "Not Found" because `frontend/src/api/securityApi.js` called
``/users/{id}/security/reset-password`` while the auth router serves the action
under its ``/auth`` prefix. The same class of mismatch (frontend API modules
hardcoding paths without the backend router prefix, see
Manuals/pages/52_ROUTING_VERIFICATION.md) also affected the Dashboard and
Backup & Recovery modules.

Each tuple below is the route template a frontend API module effectively calls
(concrete ids rendered as ``{param}``). If a router is renamed or re-mounted,
this test fails instead of the UI failing with a 404 "Not Found".
"""
from app.main import app


def _route_templates():
    templates = set()
    for route in app.routes:
        path = getattr(route, "path", None)
        if not path:
            continue
        methods = getattr(route, "methods", None) or set()
        for method in methods:
            templates.add((method, path))
    return templates


def _assert_route(method, template):
    assert (method, template) in _route_templates(), (
        f"{method} {template} is not served by the backend "
        f"(frontend API modules call this path)"
    )


def test_task_manager_password_reset_workflow_routes():
    """Routes backing the Task Manager's password-reset task lifecycle."""
    # LoginPage "forgot password" → creates the PasswordResetRequest + task
    _assert_route("POST", "/auth/forgot-password")
    # Profile & Security "Admin Password Reset" closes the request and its task
    _assert_route("POST", "/auth/users/{user_id}/security/reset-password")
    # Task Manager list/detail/actions used by OperationTaskManager.jsx
    _assert_route("GET", "/operation-tasks/my/paged")
    _assert_route("GET", "/operation-tasks/my")
    _assert_route("GET", "/operation-tasks")
    _assert_route("GET", "/operation-tasks/{task_id}")
    _assert_route("GET", "/operation-tasks/{task_id}/events")
    _assert_route("POST", "/operation-tasks/{task_id}/take-ownership")
    _assert_route("POST", "/operation-tasks/{task_id}/release")
    _assert_route("POST", "/operation-tasks/{task_id}/approve")
    _assert_route("POST", "/operation-tasks/{task_id}/reject")
    _assert_route("POST", "/operation-tasks/{task_id}/admin-revoke-approved-transaction")
    _assert_route("POST", "/operation-tasks/{task_id}/admin-reject-approved-revoke")
    # Ticket link inside the task detail modal
    _assert_route("GET", "/operation-transactions/{transaction_id}")
    _assert_route("GET", "/operation-transactions/{transaction_id}/status-history")
    _assert_route("GET", "/operation-transactions/{transaction_id}/correction-requests")


def test_dashboard_module_routes():
    """frontend/src/api/dashboardApi.js + dashboardDataApi.js paths."""
    _assert_route("GET", "/dashboard/configs")
    _assert_route("POST", "/dashboard/configs")
    _assert_route("GET", "/dashboard/configs/{config_id}")
    _assert_route("PUT", "/dashboard/configs/{config_id}")
    _assert_route("GET", "/dashboard/configs/{config_id}/versions")
    _assert_route("GET", "/dashboard/versions/{version_id}")
    _assert_route("POST", "/dashboard/configs/{config_id}/publish")
    _assert_route("POST", "/dashboard/configs/{config_id}/revert")
    _assert_route("GET", "/dashboard/data-sources")
    _assert_route("POST", "/dashboard/data")


def test_backup_module_routes():
    """frontend/src/api/backupApi.js paths."""
    _assert_route("GET", "/backup/settings")
    _assert_route("PUT", "/backup/settings")
    _assert_route("GET", "/backup")
    _assert_route("POST", "/backup/manual")
    _assert_route("POST", "/backup/cleanup")
    _assert_route("DELETE", "/backup/{backup_id}")
    _assert_route("GET", "/backup/{backup_id}/download")
    _assert_route("POST", "/backup/{backup_id}/verify-checksum")
    _assert_route("GET", "/backup/restore-requests")
    _assert_route("POST", "/backup/restore-requests")
    _assert_route("POST", "/backup/restore-requests/{request_id}/approve")
    _assert_route("POST", "/backup/restore-requests/{request_id}/reject")
    _assert_route("POST", "/backup/restore-requests/{request_id}/cancel")
    _assert_route("POST", "/backup/restore-requests/{request_id}/validate")
    _assert_route("POST", "/backup/restore-requests/{request_id}/execute")
    _assert_route("GET", "/backup/restore-requests/{request_id}/validations")
