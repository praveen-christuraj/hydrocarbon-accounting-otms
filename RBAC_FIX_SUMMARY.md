# RBAC Hardening Summary

**Updated:** 2026-10-14

## Implemented hardening

- Backend authorization resolves permissions from all active user roles and active permission records on each request.
- Location scope has shared normalization/filter/validation helpers, with explicit checks on list, detail, report, export, and mutation paths.
- Role and user administration is protected against reserved-Admin changes, capability escalation, and out-of-scope user/role changes.
- The `user_roles` association now supports multiple roles per user. Its startup migration preserves assignment IDs and data while replacing the legacy one-role uniqueness constraint.
- Asset, export, tracking, operation-task, workflow-policy, ledger, and notification routes received additional record/location checks.
- User-facing notification responses no longer disclose recipient IDs, targeting locations/roles, creator identity, or aggregate delivery counts; scoped delivery reports omit recipients whose location assignments extend outside the caller's scope.
- Access-token type is checked, refresh tokens rotate and are revoked after use, and unique JWT IDs prevent same-second token collisions.
- Frontend route guards and reusable permission helpers cover the page layer; backend checks remain authoritative.

## Verified facts

- `is_super_admin(user, db)` exists in `backend/app/dependencies/permissions.py` as a compatibility alias for `is_admin_user(user, db)`.
- The current RBAC regression suite is `backend/tests/test_rbac_hardening.py`; the stale `backend/tests/test_rbac_regression.py` file is removed.
- The application does not implement a tenant/organization model; no tenant-specific rules from reference repositories were copied.

## Validation

Verified from `backend/`:

```bash
./.venv/bin/python -m pytest -q
# 76 passed
```

Verified from `frontend/`:

```bash
npm run build  # passed
npm run smoke  # 30/30 checks passed, zero runtime errors
npm run lint:src
```

`npm run lint:src` currently fails on existing frontend lint findings across the codebase (156 errors, 73 warnings). A changed-file ESLint scan found no errors on added or modified lines. Startup migration compatibility should also be checked against a production-like database backup before deployment.

See `RBAC_HARDENING_GUIDE.md` for authorization semantics and `RBAC_COMPLETION_CHECKLIST.md` for page/API review requirements.
