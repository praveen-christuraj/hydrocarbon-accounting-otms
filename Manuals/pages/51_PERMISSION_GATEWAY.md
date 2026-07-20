# Permission Gateway: How `require_user_permission()` Protects Every Domain

## Overview

`require_user_permission()` is the **second most connected node in the system** with **237 edges** — second only to the `User` model itself (292 edges). It is the single function that enforces RBAC across every protected endpoint. Every mutation, every status change, every sensitive read goes through this gate.

## File Location
**Source:** `backend/app/dependencies/permissions.py` (lines 39-65)

## How It Works

```python
def require_user_permission(user: User, permission_name: str, db: Session):
    # Step 1: Get all role names for this user
    user_role_names = get_role_names(db, user)
    
    # Step 2: Admin role bypasses all permission checks
    if user_role_names.intersection({"admin"}):
        return user  # Admin sees everything
    
    # Step 3: Check if user's role has the required permission
    if not user_has_permission(user, permission_name, db):
        raise HTTPException(403, f"Permission required: {permission_name}")
    
    return user
```

### The Chain: User → Role → Permission

```
JWT Token → extract user_id → load User → 
  → UserRole table → get role_ids → 
    → RolePermission table → get permission_ids →
      → Permission table → check permission_name → 
        → ALLOW or 403 FORBIDDEN
```

## Communities Bridged (22+)

| Community # | Community Name | Router Files Protected |
|-------------|---------------|----------------------|
| 1 | Backup & Restore Endpoints | `backup_restore.py` |
| 2 | FSO & Tanker Endpoints | `reports.py` |
| 3 | CRUD Endpoints (main.py) | `system_notifications.py` |
| 10 | Audit Snapshot Builders | `permissions.py` itself |
| 16 | Operation Task & Admin Actions | `operation_tasks.py` |
| 17 | Out-Turn Report & Material Balance | `material_balance_templates.py` |
| 28 | Auth & Login | `auth.py` |
| 32 | Operation Transactions | `operation_transactions.py` |
| 41 | Tanker Tracking API | `tanker_tracking.py` |
| 43 | Tank Stock Ledger API | `tank_stock_ledger.py` |
| 44 | Barge Tracking API | `barge_trip_tracking.py` |
| 46 | Shuttle FSO Tracking | `shuttle_fso_voyages.py` |
| 88 | Operation Templates | `operation_templates.py` |
| 228 | RBAC | `roles.py`, `permissions.py` |
| 292 | Asset Management | `assets.py`, `flowmeter_configs_records.py` |
| 309 | Correction Requests | `correction_requests.py` |
| 310 | Database Core | `models.py`, `database.py` |
| 313 | Movement Mappings | `movement_mappings.py` |

## Key Functions in permissions.py

| Function | Purpose |
|----------|---------|
| `require_user_permission()` | Main RBAC gate — checks user has a specific permission |
| `user_has_permission()` | Boolean check — does user's role have this permission? |
| `get_user_role_ids()` | Get all role IDs for a user from UserRole table |
| `get_role_ids_with_permission()` | Find which roles have a specific permission |
| `get_required_permission_for_status_change()` | Map status → required permission name |
| `get_action_code_for_status_change()` | Map status → action code (SUBMIT, APPROVE, REJECT, etc.) |
| `evaluate_operation_workflow_policy()` | Fine-grained workflow policy check |
| `find_matching_operation_workflow_policy()` | Find applicable policy for action+context |
| `user_can_act_on_operation_task()` | Check if user can act on a specific task |
| `build_logged_in_user_response()` | Build the user+role+permissions login response |

## Status Transition Permissions

| To Status | Permission Required | Action Code |
|-----------|-------------------|-------------|
| Draft | Submit Operation Transaction | RECALL |
| Submitted | Submit Operation Transaction | SUBMIT |
| Approved | Approve Operation Transaction | APPROVE |
| Rejected | Reject Operation Transaction | REJECT |
| Cancelled | Cancel Operation Transaction | CANCEL |

## Workflow Policy Engine

For finer-grained control, `evaluate_operation_workflow_policy()` checks:
1. Active policies matching the **action_code**
2. Filters by **operation_type_code**, **operation_template_id**, **asset_type_code**, **location_code**
3. Checks for **user-level overrides** (ALLOW/DENY per user)
4. Checks for **role-based allowances**
5. Returns (allowed, reason, matched_policy)

This means the permission system supports:
- **Role-based access** (default)
- **User-specific overrides** (certain users can/cannot do things regardless of role)
- **Context-aware policies** (who can approve depends on operation type, location, etc.)

## The 150-Edge Cousin: `create_audit_log()`

Every time `require_user_permission()` allows an action, `create_audit_log()` (150 edges) records it. Together they form the **security backbone**:
- `require_user_permission()` → decides if action is allowed
- `create_audit_log()` → records that the action happened, by whom

## How Endpoints Use It

```python
@router.post("/operation-transactions/{id}/status")
def update_status(
    id: int,
    request: StatusUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(oauth2_scheme),  # Get user from JWT
):
    # Permission check
    required_perm = get_required_permission_for_status_change(request.status)
    require_user_permission(current_user, required_perm, db)
    
    # Business logic
    result = update_operation_transaction_status(db, id, request, current_user)
    
    # Audit trail
    create_audit_log(db, "Operations", "Status Change", current_user, ...)
    
    return result
```

This pattern repeats across ALL protected endpoints — making `require_user_permission()` and `create_audit_log()` the two most cross-cutting functions in the entire system.
