# RBAC Hardening Guide

## Overview
This guide documents RBAC best practices implemented in the Hydrocarbon Accounting System to prevent future access-control vulnerabilities and ensure consistent permission/location-scope filtering across all 57+ pages and endpoints.

---

## Critical Issues Fixed (2026-08-11)

### 1. **Global Asset Visibility Bug**
**Problem:** Global-scope assets were hidden from location-scoped users, even when the operation type was available at their location.
**Root Cause:** Asset filter used `AND location_code IN (user_locations)`, which excluded Global assets.
**Fix:** Changed to `asset_scope == 'Global' OR location_code IN (user_locations)`.
**Files:** `backend/app/routers/assets.py`, `operation_entries.py`

### 2. **Case-Insensitive Location Filter**
**Problem:** Location code comparisons were case-sensitive, causing "AGGE" and "agge" to be treated as different.
**Root Cause:** Direct string comparison in SQL: `.origin_location_code.in_(allowed)` where `allowed` was normalized lowercase.
**Fix:** Normalized DB comparison: `func.lower(OperationTransaction.origin_location_code).in_(allowed)`.
**Files:** `backend/app/routers/operation_transactions.py`, `tank_operations.py`, `vessel_operations.py`

### 3. **Multi-Role Permission Aggregation**
**Problem:** Users with multiple active roles only got permissions from the first role.
**Root Cause:** Permissions loop was not aggregating from all active roles.
**Fix:** Updated `get_user_permissions()` to iterate through all UserRole entries and aggregate permissions, filtering by `Role.status == "Active"`.
**Files:** `backend/app/dependencies/permissions.py`

### 4. **Inactive Role Permissions Bypass**
**Problem:** Inactive (deleted/deactivated) roles were still granting permissions.
**Root Cause:** Role status not checked during permission evaluation.
**Fix:** Added `.filter(Role.status == "Active")` to all role-permission queries.
**Files:** `backend/app/dependencies/permissions.py`, `auth.py`, all routers

### 5. **Tank Operation Summary Missing Approved Entries**
**Problem:** Approved Operation Entry tickets weren't appearing in Tank Operation Summary.
**Root Cause:** Query over-restricting with hard-coded asset-type and layout-type matches.
**Fix:** Made layout match case/whitespace-safe: `func.lower(func.trim(OperationTemplate.entry_layout_type))`.
**Files:** `backend/app/routers/tank_operation_summary.py`

### 6. **Register Visibility (Operation Transaction Register)**
**Problem:** Non-admin users saw 0 rows in paged Operation Transaction Register.
**Root Cause:** Location filter was case-sensitive and didn't account for multi-role users.
**Fix:** Applied normalized location filtering + multi-role permission aggregation.
**Files:** `backend/app/routers/operation_transactions.py`

---

## Best Practices for Future Development

### 1. **Centralize Location Filtering**
Always use the `apply_location_filter()` helper for list/paged queries instead of inline `.filter()`.

```python
# GOOD
from app.utils.helpers import apply_location_filter
query = db.query(OperationTransaction)
query = apply_location_filter(query, current_user, db, "origin_location_code")

# BAD
allowed = get_user_location_codes(current_user, db)
query = query.filter(OperationTransaction.origin_location_code.in_(allowed))
```

### 2. **Normalize at Boundaries**
Any user-provided or DB-sourced location/asset/scope code must be normalized before comparison.

```python
from app.utils.helpers import normalize_location_code, normalize_code

# GOOD
user_loc = normalize_location_code(payload.location_code)
db_loc = func.lower(OperationTransaction.origin_location_code)
query = query.filter(db_loc == user_loc)

# BAD
query = query.filter(OperationTransaction.origin_location_code == payload.location_code)
```

### 3. **Aggregate Multi-Role Permissions**
Never assume a user has one role. Always use `get_user_permissions()` which automatically aggregates all active roles.

```python
# GOOD
user_perms = get_user_permissions(current_user, db)
if "View Assets" in user_perms and "Edit Assets" in user_perms:
    can_edit = True

# BAD
user_role = current_user.roles[0]  # Assumes one role!
can_edit = user_role.has_permission("Edit Assets")
```

### 4. **Filter by Role Status**
Always include `.filter(Role.status == "Active")` in role queries.

```python
# GOOD
roles = (
    db.query(Role)
    .join(UserRole, UserRole.role_id == Role.id)
    .filter(
        UserRole.user_id == user_id,
        Role.status == "Active",  # Always filter active roles
    )
    .all()
)

# BAD
roles = db.query(Role).join(UserRole).filter(UserRole.user_id == user_id).all()
```

### 5. **Global vs. Local Asset Scoping**
Use OR logic to include Global assets when location-scoped.

```python
from sqlalchemy import or_

# GOOD
assets = (
    db.query(Asset)
    .filter(
        or_(
            Asset.scope == "Global",
            and_(
                Asset.scope == "Local",
                Asset.location_id.in_(user_location_ids),
            ),
        ),
        Asset.status == "Active",
    )
    .all()
)

# BAD
assets = db.query(Asset).filter(
    Asset.location_id.in_(user_location_ids),  # Excludes Global!
    Asset.status == "Active",
).all()
```

### 6. **Test Permission Paths, Not Just Happy Path**
Add regression tests for each of these scenarios:
- Non-admin user with location scope
- Multi-role user (ensure all permissions visible)
- Case-mismatched location codes
- Global-scope assets
- Inactive roles should not grant access

See `backend/tests/test_rbac_regression.py` for examples.

### 7. **Use RBAC Diagnostics Endpoint for Troubleshooting**
New endpoint: `GET /auth/me/rbac-diagnostics`

Shows:
- All assigned roles (active/inactive)
- All granted permissions (multi-role aggregated)
- All assigned location codes (normalized)
- Super-admin flag

This is your first stop when debugging "user can't see data."

```bash
curl -H "Authorization: Bearer <token>" http://localhost:8000/auth/me/rbac-diagnostics
```

---

## Checklist for 57+ Pages (Implement & Verify)

Each page should follow this checklist:

- [ ] **Permission Required**
  - [ ] Page name matches a seeded permission in `backend/app/utils/default_permissions.py`
  - [ ] Frontend `<PermissionGuard requiredPermission="...">` uses canonical name
  - [ ] Backend `require_user_permission(current_user, "...", db)` uses canonical name

- [ ] **Location Scope (if applicable)**
  - [ ] List endpoint applies `apply_location_filter()`
  - [ ] Create/update/delete validates user's assigned location(s)
  - [ ] Case-insensitive location code comparison used throughout

- [ ] **Asset Visibility**
  - [ ] Global assets included if applicable
  - [ ] Local assets filtered to user's location(s)
  - [ ] Asset type matches operation type availability

- [ ] **Multi-Role Support**
  - [ ] Permissions aggregated from all active roles
  - [ ] No hardcoded role name checks (e.g., `if role.name == "Admin"`)
  - [ ] Uses `get_user_permissions()` helper

- [ ] **Status Filters**
  - [ ] Role queries filtered: `.filter(Role.status == "Active")`
  - [ ] User queries filtered: `.filter(User.status == "Active")`
  - [ ] Other model status filters applied appropriately

- [ ] **Regression Tests**
  - [ ] Test with non-admin location-scoped user
  - [ ] Test with multi-role user
  - [ ] Test with global vs. local assets
  - [ ] Test with case-mismatched location codes

---

## Centralized Helpers

### `app/utils/helpers.py`
- `normalize_location_code(code: str) -> str` — Convert to lowercase, trim
- `normalize_code(code: str) -> str` — Generic code normalization
- `apply_location_filter(query, user, db, column_name)` — Applies normalized location filter

### `app/dependencies/permissions.py`
- `get_user_permissions(user, db) -> Set[str]` — All active-role permissions, multi-role aggregated
- `get_user_location_codes(user, db) -> List[str]` — All assigned location codes, normalized
- `is_super_admin(user, db) -> bool` — Super-admin check
- `require_user_permission(user, permission, db)` — Enforce permission or raise 403
- `build_logged_in_user_response(user, db)` — Full auth response with roles/permissions/locations

### `app/dependencies/auth.py`
- `get_current_user_from_token(token)` — Extract user from JWT
- `is_token_blacklisted(token, db)` — Check logout blacklist

---

## Common Patterns

### List Endpoint with Location Scope
```python
@router.get("/operation-transactions/paged")
def get_operation_transactions_paged(
    skip: int = 0,
    limit: int = 100,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "View Operation Transactions", db)
    
    query = db.query(OperationTransaction)
    # Use centralized filter, not inline .filter()
    query = apply_location_filter(query, current_user, db, "origin_location_code")
    
    # Status filter
    query = query.filter(OperationTransaction.status.in_(["Draft", "Approved"]))
    
    total = query.count()
    items = query.offset(skip).limit(limit).all()
    
    return {"total": total, "items": items}
```

### Create/Update with Scope Validation
```python
@router.post("/operation-transactions")
def create_operation_transaction(
    payload: OperationTransactionCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Create Operation Transactions", db)
    
    # Validate user's assigned location(s)
    allowed_locations = get_user_location_codes(current_user, db)
    origin_normalized = normalize_location_code(payload.origin_location_code)
    
    if origin_normalized not in allowed_locations and not is_super_admin(current_user, db):
        raise HTTPException(status_code=403, detail="Not assigned to this location")
    
    ot = OperationTransaction(
        origin_location_code=origin_normalized,
        ...
    )
    db.add(ot)
    db.commit()
    return ot
```

### Global Asset Visibility
```python
@router.get("/assets")
def list_assets(
    asset_type: str = None,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "View Operation Assets", db)
    
    query = db.query(Asset).filter(Asset.status == "Active")
    
    if asset_type:
        query = query.filter(func.lower(Asset.asset_type) == func.lower(asset_type))
    
    if not is_super_admin(current_user, db):
        # Include Global + location-scoped Local assets
        user_locs = get_user_location_codes(current_user, db)
        user_loc_ids = (
            db.query(Location.id)
            .filter(func.lower(Location.location_code).in_(user_locs))
            .all()
        )
        user_loc_ids = [loc_id[0] for loc_id in user_loc_ids]
        
        query = query.filter(
            or_(
                Asset.scope == "Global",
                and_(
                    Asset.scope == "Local",
                    Asset.location_id.in_(user_loc_ids),
                ),
            )
        )
    
    return query.all()
```

---

## Migration Path for Existing Code

1. **Phase 1: Audit**
   - Run `graphify query "RBAC access pattern"` to find all permission checks
   - Grep for `.filter(.*location` to find location checks
   - Grep for role name checks (e.g., `== "Admin"`)

2. **Phase 2: Centralize**
   - Replace inline location filters with `apply_location_filter()`
   - Replace role name checks with `require_user_permission()`
   - Update normalization to use shared helpers

3. **Phase 3: Test**
   - Add regression test for each endpoint
   - Test with non-admin, multi-role, case-mismatch scenarios
   - Use `/auth/me/rbac-diagnostics` to verify output

4. **Phase 4: Document**
   - Add inline comments when RBAC logic deviates from standard patterns
   - Link to this guide in PR descriptions

---

## Debugging Workflow

**User reports: "I can't see my data on page X"**

1. **First:** Call `/auth/me/rbac-diagnostics` as that user
   - Check `granted_permission_count` > 0
   - Check `assigned_location_codes` are populated
   - Check `active_role_count` > 0

2. **Second:** Check the page's frontend permission guard
   - `<PermissionGuard requiredPermission="...">` should match a seeded permission

3. **Third:** Check the backend list endpoint
   - Is it calling `apply_location_filter()`?
   - Is location code normalized?
   - Is it filtering by status (e.g., `== "Active"`)?

4. **Fourth:** If still blocked, add logging
   ```python
   import logging
   logger = logging.getLogger(__name__)
   
   allowed_locs = get_user_location_codes(current_user, db)
   logger.info(f"User {current_user.username} allowed locations: {allowed_locs}")
   logger.info(f"Query filters origin_location_code: {origin_normalized}")
   ```

5. **Finally:** Run regression test on exact scenario
   ```bash
   pytest backend/tests/test_rbac_regression.py::TestOperationTransactionRegisterCaseInsensitiveLocationFilter -v
   ```

---

## Summary

RBAC hardening reduces future bugs by:
1. **Centralizing** permission/location checks
2. **Normalizing** all code comparisons
3. **Aggregating** multi-role permissions consistently
4. **Testing** non-happy-path scenarios
5. **Documenting** deviations with inline comments

Follow these patterns, use the helpers, and add regression tests. Questions? Use `/auth/me/rbac-diagnostics` to diagnose.
