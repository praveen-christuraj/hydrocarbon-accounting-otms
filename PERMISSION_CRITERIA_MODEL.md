# Permission Criteria Model – Location × Operation Availability × Permissions

> Owner request (2026-10-16): *"most of these things are related with permissions and location
> assignments. Now we need to plan multiple criteria in permissions in which the criteria include
> Location, Operation availability, permissions etc. How can we achieve this without affecting the
> functionalities but in an effective manner."* This document is that plan. It also formalises the
> fix for the tracking visibility blunder ("*Location B may not have access to location A but he
> should see the ticket assigned to his location – this should be applied for all the tracking
> modules*").

---

## 1. The problem in one picture

A ticket is created and approved at **location A** (sender) with **location B** in the receiver
dropdown. Location B's users had no assigned access to location A, so every list endpoint that
filtered on `origin_location_code` alone hid the ticket from the receiver – on Tanker, Shuttle and
FSO Tracking and in the Operation Transaction Register. The acknowledgement workflow was blocked
the same way (`ensure_tanker_transaction_location_scope` required **every** populated location of a
ticket to be inside the user's scope, so the receiver could never acknowledge the sender's ticket).

Barge Tracking had already been corrected earlier ("*A ticket is shown when one of its four
locations is in the user's scope – the receiver sees the sender's approved ticket even though the
sender side is another terminal*", `backend/tests/test_barge_end_to_end_approval.py`). The same rule
is now the single standard for **all** tracking modules.

## 2. The four criteria – what exists today

Access in this application is the intersection of **four independent criteria**. All four already
exist in the backend; the work below unifies how they are evaluated, it does not add a fifth
database concept.

| # | Criterion | Question it answers | Source of truth | Where enforced |
|---|-----------|--------------------|-----------------|----------------|
| 1 | **Permission** (RBAC) | *What action* may this user perform? (`View Tanker Tracking`, `Create Operation Entry`, `Close Shuttle Voyage`, …) | `default_permissions.py` catalog → `permissions` / `roles` / `role_permissions` / `user_roles` | `require_user_permission`, `require_any_user_permission`, frontend `PermissionGuard` + `usePermissions` |
| 2 | **Location scope** | *Where* may this user see / act? | `user_locations` + `users.all_locations_access` | `get_user_location_codes`, `apply_location_filter` (own-side records), **`apply_transaction_party_scope_filter` (cross-location records)** |
| 3 | **Operation availability** | *Which operation types* are enabled at a location? | `location_operation_availability` | `ensure_operation_type_available_for_location` on entry create/update |
| 4 | **Workflow policy** | *Who* may make a status transition, for which operation type / location / asset? | `operation_workflow_policies` (+ role/user rows) | `evaluate_operation_workflow_policy` on create / submit / approve |

## 3. The missing rule that caused the blunder – *party (involvement) scope*

Location scope has **two modes**, and the mode depends on the record, not on the user:

1. **Own-side records** (locations, tanks, assets, templates, user assignments, entries the user
   works on): a record is visible only when its single `location_code` is inside the user's
   assigned locations – the classic `apply_location_filter`. Unchanged.
2. **Cross-location records** (operation tickets with a sender/receiver pair, tanker receipt
   acknowledgements, shuttle / FSO voyages, barge trips): a location-scoped user may **see and act
   on** the record when **any party location** – `origin`, `destination`, `sender` or `receiver` –
   is inside their assigned locations. None of them in scope ⇒ invisible / 403. All-locations and
   Admin users keep unrestricted access. Records with no populated location stay visible (legacy
   rows).

This mirrors what the create-side rule already does: *"Origin and sender are the user's own side…
Destination and receiver may be any location registered in the system (cross-location movement)"*
(`ensure_operation_entry_locations_in_scope`). Creation was cross-location capable; visibility is
now consistent with it.

### Single source of truth

`backend/app/dependencies/permissions.py` now owns the rule:

| Helper | Purpose |
|--------|---------|
| `TRANSACTION_PARTY_LOCATION_FIELDS` | the four party columns |
| `user_is_party_to_location_codes` / `user_is_party_to_transaction` | boolean party check |
| `ensure_user_is_party_to_location_codes` / `ensure_transaction_in_user_party_scope` | 403 guard for detail/action endpoints |
| `apply_transaction_party_scope_filter` | SQL "ANY-of-four columns in scope" filter for lists |

Barge Tracking's `barge_transaction_in_user_scope`, Tanker Tracking's
`ensure_tanker_transaction_location_scope`, Shuttle/FSO `ensure_voyage_in_user_scope` and the
register filters all delegate to these helpers.

### What stays origin-scoped on purpose (unchanged behaviour)

* **Create / edit / delete an entry** at a location (origin + sender must be in scope).
* **Submit / approve / reject** a ticket (status workflow runs on the ticket's own side; workflow
  policies still gate it).
* **Acknowledge receipt at a location**: the acknowledgement's own `receiver_location_code` must be
  in the acknowledging user's scope.
* Explicit **filter dropdowns** stay limited to the user's assigned locations (you filter *by* what
  you hold; the default "All" already returns every ticket you are party to).

## 4. Effective access-decision pipeline

Every endpoint answers the criteria in this fixed order – cheap and global first, expensive and
record-specific last. Nothing in the middle may be skipped "because the caller is trusted"; the UI
hides what the API will refuse, and the API is the authority.

```
1. Authentication          (JWT – get_current_user_from_token)
2. Permission (Criterion 1) require_user_permission / require_any_user_permission
3. Location scope (2)       own-side:  ensure_location_in_user_scope / apply_location_filter
                            cross-location: ensure_*_party_scope / apply_transaction_party_scope_filter
4. Operation availability (3) ensure_operation_type_available_for_location   [create/update only]
5. Workflow policy (4)      evaluate_operation_workflow_policy               [status transitions]
6. Audit                    create_audit_log for every mutation              [always]
```

### Decision table (who can do what)

| Action | Permission | Location rule | Availability | Workflow |
|--------|-----------|---------------|--------------|----------|
| View tracking list / register / ticket detail | `View …` | **party (any-of-4)** | – | – |
| Acknowledge receipt / create receiver entry | `Edit Tanker Tracking` / `Create Operation Entry` | party to the sender ticket + own receiver location | enabled at receiving origin | `CREATE_ENTRY` |
| Create / edit entry | `Create/Edit Operation Entry` | origin + sender in scope (receiver/destination free) | enabled at origin | `CREATE_ENTRY` / `EDIT_ENTRY` |
| Submit / approve ticket | named workflow permission | origin in scope | – | status policy |
| Close / reopen voyage (shuttle/FSO/trip) | `Close/Reopen … Voyage` | **party to the voyage's tickets** (fallback: voyage key location when empty) | – | – |
| Masters CRUD | `Create/Edit/Delete …` | own-side `location_code` | – | – |

## 5. What changed in this pass (no DB / schema changes)

**Backend (behavioural fix + shared helpers):**

* `app/dependencies/permissions.py` – party-scope helpers (above).
* `app/routers/tanker_tracking.py` – ticket list, tanker transaction report and acknowledgement
  list now use the party filter; `ensure_tanker_transaction_location_scope` /
  `ensure_tanker_acknowledgement_scope` switched from *all-of-four* to *any-of-four*, so the
  receiver can open the sender reference and acknowledge; the acknowledgement list ORs the
  acknowledgement's own receiver location with the ticket's party locations.
* `app/routers/shuttle_fso_voyages.py` – shuttle & FSO tracking lists use the party filter;
  voyage detail (`group_key`), XLSX export and close/reopen use `ensure_voyage_in_user_scope`
  (party rule, falls back to the voyage's own location when the voyage has no tickets).
* `app/routers/operation_transactions.py` – register (`/paged`, list, CSV export) and ticket
  detail / status-history views use the party rule so "the tickets he has received" are visible
  end-to-end; create/update/delete/status transitions stay origin-scoped.
* `app/routers/barge_trip_tracking.py` – `barge_transaction_in_user_scope` delegates to the shared
  helper (behaviour identical).

**Frontend:**

* `pages/ShuttleTracking.jsx` – voyage detail opens in a pop-up window (`Modal`, Close button +
  header close) instead of expanding under the voyage list.

**Tests:** `backend/tests/test_tracking_party_visibility.py` – receiver/sender/stranger scenario
for the tanker list, sender reference, acknowledgements, register and detail, plus voyage party
scope and helper units. Full suite: **133 passed**.

## 6. Why this does not disturb existing functionality

* **Additive visibility only.** Nobody loses rows; receivers (and senders of cross-location
  acknowledgements) gain the rows that were wrongly hidden. Unrestricted / Admin users see the same
  data as before.
* **No schema or migration.** Only query filters and guard functions changed; every table, route
  and permission name is untouched (`test_permission_catalog.py` still passes).
* **Mutations keep their stricter gates** – creation, edition, approval and per-location filters
  behave exactly as before (table in §3).
* **One rule, one implementation** – future modules reuse `apply_transaction_party_scope_filter` /
  `ensure_transaction_in_user_party_scope` instead of re-inventing per-router filters, which is how
  the barge/tanker divergence appeared in the first place.

## 7. Next steps (optional, for a later pass)

1. **Explicit cross-location role capabilities** – e.g. a `Receive Shipment` permission family so an
   admin can grant "acknowledge + create receiver entries" without granting `Create Operation Entry`
   in general. Requires catalog additions (`default_permissions.py`) and matching frontend gates.
2. **Per-role location scope** – today location scope is per *user* (`user_locations`). For large
   teams, scope per *role×location* would reduce admin work; it needs one new table and an
   evaluation change inside `get_user_location_codes` only – the criteria pipeline stays the same.
3. **Criteria composition UI** – a read-only "Why can this user see this?" panel on Access Summary,
   showing the four criteria' outcomes for a sample record (purely diagnostic; the backend already
   exposes `/permissions/catalog` and the scope helpers can power it).
4. **Extend the party rule to remaining origin-only reports** (out-turn, tank operation summary,
   flowmeter records) if the owner wants received tickets to appear there as well – each is a
   one-line swap to `apply_transaction_party_scope_filter`.
