# RBAC Hardening Checklist

**Reviewed:** 2026-10-14

Use this checklist for reviewing page/API changes. A checked frontend control is not a substitute for backend enforcement.

## Authentication and shared authorization

- [x] Access tokens are distinguished from refresh tokens; revoked tokens are rejected.
- [x] Active roles and active permissions are re-read from the database on requests.
- [x] Permission checks aggregate every active role.
- [x] Reserved Admin role/account assignment, editing, and deletion are protected.
- [x] Role assignment and role-permission updates reject unheld capabilities and shared-role cross-location mutation.
- [x] Location helpers distinguish unrestricted (`None`), no assigned locations (empty set), and assigned locations.
- [x] The legacy `is_super_admin()` compatibility helper exists and aliases `is_admin_user()`.

## Route/page review checklist

For each frontend page and its API routes, verify:

- [ ] The React route is wrapped in `PermissionGuard` with canonical permission name(s).
- [ ] The API read endpoints check the corresponding view permission.
- [ ] The API mutation endpoints check the corresponding create/manage/action permission.
- [ ] Location-scoped list queries use `apply_location_filter()` with the correct model column.
- [ ] Caller-supplied locations are checked with `ensure_location_in_user_scope()`.
- [ ] Detail, export, download, report, and action endpoints validate the underlying record and linked-record scopes.
- [ ] Bulk payloads validate every row and reject out-of-scope operations before changes are committed.
- [ ] Global asset and cross-location tracking semantics are explicit, tested, and not inferred from UI filtering.
- [ ] UI affordances are hidden/disabled where appropriate, without being treated as an authorization boundary.
- [ ] Negative tests cover denied permission and denied cross-scope cases.

## Data compatibility

- [x] Legacy one-role `user_roles` data is preserved by the multi-role startup migration; the old uniqueness constraint is replaced by unique user/role pairs.
- [x] Admin seeding does not discard prior role assignments and does not reactivate a disabled administrator.
- [x] Existing token signing and user records remain compatible; refresh rotation/revocation is additive.
- [ ] Before deployment, back up the production database and run the migration against a representative database copy.

## Current backend test locations

- `backend/tests/test_rbac_hardening.py`
- `backend/tests/test_location_scope_smoke.py`

The earlier `backend/tests/test_rbac_regression.py` file was stale and removed. See `RBAC_HARDENING_GUIDE.md` for current helper names, semantics, and patterns.
