# Testing & Verification Guide for RBAC Fixes

## Quick Test Workflow

### Setup: Create Test Users & Roles

```bash
# 1. Start the application
cd backend
python main.py

# 2. In another terminal, access the database setup or login as Super Admin to create test data
```

### Test Scenario 1: Global Asset Visibility (Vessel Operations)

**Scenario:** Operator at location "AGGE" should see Global shuttle asset in Vessel Operation dropdown

1. **Setup in Admin Panel:**
   - Create Location: "AGGE"
   - Create Asset: "SHUTTLE_001" (scope=Global, type=SHUTTLE)
   - Create Operation Type: "Shuttle Operations" (asset_type=SHUTTLE)
   - Add Operation Type availability to AGGE location
   - Create Role "Operator" with permissions:
     - "View Operation Assets"
     - "View Vessel Operations"
     - "Create Vessel Operations"
   - Create User "operator_agge" with Role "Operator"
   - Assign User to Location: AGGE

2. **Test Frontend:**
   - Login as `operator_agge` / `password`
   - Navigate to "Vessel Operations" → "Create New"
   - In Asset dropdown, you should see "SHUTTLE_001" (Global asset)
   - ✅ **Pass:** Asset appears
   - ❌ **Fail:** Asset does not appear (indicates global asset filter is still broken)

3. **Debug if Failed:**
   ```bash
   # Call diagnostics endpoint
   curl -H "Authorization: Bearer <token>" \
     http://localhost:8000/auth/me/rbac-diagnostics
   
   # Check:
   # - is_super_admin: false
   # - granted_permission_count > 0
   # - assigned_location_codes: ["agge"]
   ```

---

### Test Scenario 2: Tank Operation Summary (Multi-Role User)

**Scenario:** Multi-role user should see approved Operation Entry in Tank Operation Summary

1. **Setup in Admin Panel:**
   - Create Roles:
     - "Entry Operator" with permission "Create Operation Entries"
     - "Approver" with permission "Approve Operation Transactions"
   - Create User "multi_role_op" with BOTH roles
   - Assign User to Location: AGGE
   - Create Tank asset at AGGE
   - Configure Tank Operations availability at AGGE

2. **Test Workflow:**
   - Login as `multi_role_op`
   - Create Operation Entry (Tank Gauging) → Save as Draft
   - Go to Operation Transaction Register
   - Find your draft entry
   - Click "Approve"
   - Navigate to "Tank Operation Summary"
   - Filter by location AGGE
   - ✅ **Pass:** Your approved entry appears in summary
   - ❌ **Fail:** Entry does not appear (indicates Tank Summary query issue)

3. **Debug if Failed:**
   ```bash
   # Check if entry actually got approved
   SELECT * FROM operation_transaction 
   WHERE operation_entry_id = <entry_id> AND status = 'Approved';
   
   # Check if Tank Summary query includes the template
   SELECT * FROM operation_template 
   WHERE entry_layout_type LIKE '%Tank%' AND status = 'Active';
   ```

---

### Test Scenario 3: Case-Insensitive Location Filtering

**Scenario:** Location codes with different cases ("AGGE" vs "agge") should match

1. **Setup in Admin Panel:**
   - Create Location with code "AGGE" (uppercase)
   - Manually edit DB to add Operation Transaction with origin_location_code = "agge" (lowercase)
   - Create User at location "AGGE"

2. **Test Endpoint (via curl or Postman):**
   ```bash
   # Login to get token
   TOKEN=$(curl -X POST http://localhost:8000/auth/login \
     -H "Content-Type: application/json" \
     -d '{"username":"operator_agge","password":"password"}' \
     | jq -r .access_token)
   
   # Call paged endpoint
   curl -H "Authorization: Bearer $TOKEN" \
     "http://localhost:8000/operation-transactions/paged?skip=0&limit=10"
   
   # ✅ **Pass:** Both "AGGE" and "agge" entries appear
   # ❌ **Fail:** Only uppercase or only lowercase entries appear
   ```

3. **Check SQL Log:**
   ```sql
   -- Verify query uses func.lower()
   -- Should see: LOWER(operation_transaction.origin_location_code) IN (...)
   ```

---

### Test Scenario 4: Multi-Role Permission Aggregation

**Scenario:** User with 2 active roles should have permissions from both

1. **Setup:**
   - Create Role "Reader" with permission "View Users"
   - Create Role "Writer" with permission "Edit Users"
   - Create User "multi_role_user" with both roles
   - Login as this user

2. **Test Diagnostics Endpoint:**
   ```bash
   TOKEN=$(curl -X POST http://localhost:8000/auth/login \
     -H "Content-Type: application/json" \
     -d '{"username":"multi_role_user","password":"password"}' \
     | jq -r .access_token)
   
   curl -H "Authorization: Bearer $TOKEN" \
     http://localhost:8000/auth/me/rbac-diagnostics | jq .
   ```

3. **Verify in Response:**
   ```json
   {
     "assigned_roles": [
       {"role_name": "Reader", "status": "Active"},
       {"role_name": "Writer", "status": "Active"}
     ],
     "active_role_count": 2,
     "granted_permission_count": 2,
     "granted_permissions": ["View Users", "Edit Users"]
   }
   ```
   - ✅ **Pass:** Both permissions listed, active_role_count = 2
   - ❌ **Fail:** Only 1 permission or active_role_count = 1

---

### Test Scenario 5: Inactive Role Bypass Prevention

**Scenario:** Inactive role should NOT grant permissions

1. **Setup:**
   - Create Role "OldRole" with permission "View Reports"
   - Create User "test_user" with this role
   - Deactivate/delete "OldRole" (set status = "Inactive")
   - Login as `test_user`

2. **Test Diagnostics:**
   ```bash
   curl -H "Authorization: Bearer $TOKEN" \
     http://localhost:8000/auth/me/rbac-diagnostics | jq .
   ```

3. **Verify:**
   ```json
   {
     "assigned_roles": [
       {"role_name": "OldRole", "status": "Inactive"}
     ],
     "granted_permissions": []  // Empty!
   }
   ```
   - ✅ **Pass:** Inactive role shows but no permissions granted
   - ❌ **Fail:** "View Reports" still in granted_permissions

---

### Test Scenario 6: Run Regression Test Suite

**Scenario:** All regression tests should pass

```bash
# Navigate to project root
cd backend

# Run all RBAC regression tests
pytest tests/test_rbac_regression.py -v

# Expected output:
# test_global_asset_visible_for_location_user_with_operation_type PASSED
# test_local_asset_hidden_for_different_location_user PASSED
# test_multi_role_user_has_all_permissions PASSED
# test_inactive_role_permissions_not_granted PASSED
# test_paged_register_case_insensitive_location_filter PASSED
# test_approved_entry_visible_in_tank_summary PASSED
# ===================== 6 passed in X.XXs =====================
```

---

## Troubleshooting Checklist

If any test fails, follow this sequence:

### Step 1: Check Diagnostics
```bash
# Always start here
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8000/auth/me/rbac-diagnostics
```

**Look for:**
- `is_super_admin`: Should be `false` for non-admin tests
- `granted_permission_count`: Should be > 0 if user has roles
- `assigned_location_codes`: Should list your assigned location(s)
- `active_role_count`: Should match number of non-inactive roles

### Step 2: Check Role Status
```sql
-- Verify role is Active, not Inactive/Deleted
SELECT id, role_name, status FROM role WHERE role_name = 'Operator';
```

### Step 3: Check User-Role Assignment
```sql
-- Verify user is assigned to the role
SELECT ur.id, u.username, r.role_name, r.status
FROM user_role ur
JOIN user u ON ur.user_id = u.id
JOIN role r ON ur.role_id = r.id
WHERE u.username = 'operator_agge';
```

### Step 4: Check User-Location Assignment
```sql
-- Verify user is assigned to location
SELECT ul.id, u.username, l.location_code
FROM user_location ul
JOIN user u ON ul.user_id = u.id
JOIN location l ON ul.location_id = l.id
WHERE u.username = 'operator_agge';
```

### Step 5: Check Permission Seeding
```sql
-- Verify permission exists in system
SELECT id, permission_name, status FROM permission 
WHERE permission_name = 'View Operation Assets';
```

### Step 6: Check Role-Permission Assignment
```sql
-- Verify role has the permission
SELECT rp.id, r.role_name, p.permission_name
FROM role_permission rp
JOIN role r ON rp.role_id = r.id
JOIN permission p ON rp.permission_id = p.id
WHERE r.role_name = 'Operator' AND p.permission_name = 'View Operation Assets';
```

### Step 7: Enable Debug Logging
In `backend/app/routers/operation_transactions.py`, add:

```python
import logging
logger = logging.getLogger(__name__)

# In the paged endpoint:
allowed_locs = get_user_location_codes(current_user, db)
logger.info(f"User {current_user.username} allowed locations: {allowed_locs}")
logger.info(f"User is super admin: {is_super_admin(current_user, db)}")
logger.info(f"SQL will filter on: func.lower(origin_location_code).in_({allowed_locs})")
```

---

## Common Errors & Solutions

| Error | Likely Cause | Solution |
|-------|--------------|----------|
| User sees 0 rows in register | Case-mismatch in location code | Check `assigned_location_codes` in diagnostics — should be lowercase |
| Global asset missing from dropdown | Global filter not applied | Verify `scope == "Global" OR location_code...` logic in assets.py |
| Multi-role user missing permission | Only first role evaluated | Check permissions list in `/auth/me` — should include both |
| Inactive role still grants access | Role status not filtered | Run diagnostic — inactive role should have empty permissions |
| Tank summary missing entries | Case-sensitive layout match | Check `func.lower(func.trim(entry_layout_type))` in tank_summary.py |

---

## Success Criteria

All 6 scenarios passing = ✅ RBAC fixes fully working

- [x] Scenario 1: Global asset visible
- [x] Scenario 2: Tank summary shows approved entries
- [x] Scenario 3: Case-insensitive location matching
- [x] Scenario 4: Multi-role permissions aggregated
- [x] Scenario 5: Inactive roles don't grant access
- [x] Scenario 6: Regression tests pass

Once all pass, RBAC hardening is complete and stable.

---

## Next Audit (Recommended)

**After 2 weeks or 10+ new pages added:**

1. Run regression suite again
2. Spot-check 5 random pages for RBAC alignment
3. Check git log for any new location/role filters added
4. Verify no hardcoded role checks (e.g., `if role.name == "Admin"`)
5. Update this guide with any new patterns discovered
