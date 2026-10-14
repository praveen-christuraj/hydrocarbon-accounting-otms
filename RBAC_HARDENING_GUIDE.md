# RBAC Hardening Guide

**Reviewed:** 2026-10-14
**Scope:** Backend authorization, location-level data access, frontend route/action guards, and backward-compatible RBAC data handling.

This guide describes the behavior implemented in the current code. It replaces earlier notes that referred to removed test files and to location helpers in the wrong module.

## Authorization model

### Permissions and roles

- `app.dependencies.permissions.require_user_permission()` is the backend permission gate used by API routes. It reads active roles and active permissions from the database; JWT permission claims and browser state are not authoritative.
- `get_user_role_ids()` and `get_user_permissions()` include all of a user's active roles and union their active permissions. Deactivating a role or permission takes effect on the next request.
- Non-administrators cannot assign a role containing permissions they do not hold, grant a permission they do not hold, or change a shared role that has assignees outside their location scope.
- The reserved `Admin` role and administrator account are protected from ordinary role/user administration.

**Clarification:** `is_super_admin(user, db)` does exist in `backend/app/dependencies/permissions.py`. It is a compatibility alias for `is_admin_user(user, db)`, and the self-service RBAC diagnostics endpoint still reports `is_super_admin`. The backend recognizes an active reserved Admin role or the legacy `admin` username. The legacy username fallback preserves existing installations; the username is reserved against ordinary user creation/update.

### Location scope

- `get_user_location_codes(user, db)` returns normalized assigned location codes, an empty set for no assigned locations, or `None` for unrestricted access (reserved Admin and existing `all_locations_access` truthy values).
- `apply_location_filter(query, model, user, db, column_name=...)` is in `backend/app/dependencies/permissions.py`. It trims and case-normalizes stored location codes, returns no rows for an empty scope, and leaves unrestricted queries unchanged.
- `ensure_location_in_user_scope()` validates explicit location inputs on reads and writes. Use it in addition to list filtering whenever a caller can supply a location code or a mutation affects an existing record.
- User/role/location administration uses `user_is_within_actor_location_scope()` so a restricted actor cannot inspect or mutate users whose assigned locations extend beyond the actor's scope. Users with no locations remain provisionable; unrestricted and administrator accounts are outside a restricted actor's scope.
- Export, workflow, task, tracking, ledger, and report routes have additional domain-specific checks where a record is associated with multiple locations or related records.

### Frontend

- `PermissionGuard` and `usePermissions` centralize route-level permission checks and recognize the server-provided `is_admin`/`isAdmin` state while retaining legacy role/username formats.
- Page-level controls are usability only. The API must independently enforce every permission and scope restriction; never rely on hidden buttons or client-side filtering for security.

## Data and login compatibility

- Existing `user_roles` rows are retained by `ensure_user_role_multi_role_constraint()`. The startup migration replaces the old one-role-per-user uniqueness rule with a unique `(user_id, role_id)` pair, allowing multiple roles without changing existing IDs or assignments. The SQLite migration path is covered by a preservation test; PostgreSQL uses an additive constraint migration.
- Admin seeding adds the reserved Admin role assignment without replacing other role rows and no longer reactivates a disabled administrator account.
- Access tokens must have `token_type=access`; refresh tokens are rejected as bearer access credentials. Refresh tokens rotate, are blacklisted after use, and have unique token IDs. Previously issued access/refresh tokens remain decodable under the existing signing configuration.
- No tenant/organization model is present in this application. Do not transplant tenant-specific authorization assumptions from reference projects.

## Route implementation checklist

For every new or changed API route:

1. Require the canonical permission name with `require_user_permission()` unless the endpoint is an intentionally self-scoped auth/notification action.
2. Apply `apply_location_filter()` to location-scoped list queries, using the actual location column (for example `origin_location_code` or `assignment_location_code`).
3. Validate explicit location filters with `ensure_location_in_user_scope()`; do not let a filtered query silently substitute for an explicit authorization check.
4. On detail/action routes, load the record first, then authorize its location and any linked records before returning or mutating data.
5. For bulk actions, validate every item before committing. Do not allow a partially successful request to change out-of-scope records.
6. Protect role/permission changes from escalation and protect reserved administrator records.
7. Add negative tests for missing permissions, out-of-scope locations, cross-location relationships, inactive roles, and reserved Admin mutations.

Example:

```python
require_user_permission(current_user, "View Operation Transaction", db)
query = apply_location_filter(
    db.query(OperationTransaction),
    OperationTransaction,
    current_user,
    db,
    column_name="origin_location_code",
)
if location_code:
    ensure_location_in_user_scope(current_user, db, location_code, "Origin location")
    query = query.filter(OperationTransaction.origin_location_code.ilike(location_code))
```

## Tests and reference material

- RBAC regression and route-scope tests: `backend/tests/test_rbac_hardening.py` and `backend/tests/test_location_scope_smoke.py`.
- `backend/tests/test_rbac_regression.py` was an obsolete test file and is no longer present; do not use it as a current test reference.
- The implementation was informed by the least-privilege, scope-check, privilege-escalation, and negative-testing patterns in [WellCostingPro](https://github.com/praveen-christuraj/WellCostingPro). Its organization/tenant model was not copied because this application does not have that model.

Run the backend suite from `backend/` with `./.venv/bin/python -m pytest -q`. Run frontend checks from `frontend/` using the scripts in `package.json`.
