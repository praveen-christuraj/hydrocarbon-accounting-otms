# OperationWorkflowPolicyMaster

## Purpose
Configure workflow policies that control operation transaction status transitions. Policies define which roles/users can transition transactions between statuses (e.g., Pending → Approved → Closed).

## File Locations
- **Frontend:** `frontend/src/pages/OperationWorkflowPolicyMaster.jsx`
- **API Module:** `frontend/src/api/operationWorkflowPolicyApi.js`
- **Backend Router:** `backend/app/routers/workflow_policies.py` (prefix: `/operation-workflow-policies`)
- **Models:** `OperationWorkflowPolicy`, `OperationWorkflowPolicyRole`, `OperationWorkflowPolicyUser`

## API Endpoints
| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/operation-workflow-policies` | List policies |
| `POST` | `/operation-workflow-policies` | Create policy |
| `PUT` | `/operation-workflow-policies/{id}` | Update policy |
| `DELETE` | `/operation-workflow-policies/{id}` | Delete policy |
| `GET` | `/operation-workflow-policies/check` | Check allowed transitions |

## Key Features
- Define which status transitions are allowed
- Restrict transitions by role (which roles can approve)
- Restrict transitions by individual user
- `checkOperationWorkflowPolicy()` is called by OperationTransactionDetail to determine available actions

## Props
| Prop | Source |
|------|--------|
| `loggedInUser` | App.jsx |

## Permissions
- **View:** View Operation Workflow Policy
- **Manage:** Manage Operation Workflow Policy

---

## Full-Stack Architecture Diagram — OperationWorkflowPolicyMaster

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ FRONTEND                          BACKEND                             DATA                                   │
│                                                                                                              │
│ OpWorkflowPolicyMaster  wfPolicyApi  workflow_policies.py            OperationWorkflowPolicy                │
│ ─────────────────────── ───────────  ──────────────────────           ───────────────────────                │
│ Props: loggedInUser      getPolicies() GET /operation-workflow-      id (PK) | Integer                      │
│                          createPolicy()  policies                      policy_name | String(150)            │
│ Policy form: name,       updatePolicy() POST /operation-workflow-     description | Text?                   │
│ action code (SUBMIT/     deletePolicy()  policies                      action_code | String(50)             │
│ APPROVE/REJECT/CANCEL/   checkPolicy() PUT /operation-workflow-        (SUBMIT/APPROVE/REJECT/CANCEL/      │
│ RECALL), criteria         ───────────   policies/{id}                   RECALL/REVIEW)                      │
│ (op_type, template,      conv:        DELETE /operation-workflow-     operation_type_code | String?          │
│ asset_type, location),   getPolicies↔  policies/{id}                   operation_template_id | Int?         │
│ assignment (roles/       GET /policies ──────────────                  asset_type_code | String?             │
│ users)                   createPolicy↔ Perm: ('View/Mng WF Policy')   location_code | String?               │
│                          POST /policies Audit: module='WF Policy'     priority | Integer                    │
│                          checkPolicy↔ ──────────────                   status (Active/Inactive)             │
│                          GET /policies                                  ───────────────────────               │
│                           /check?action_code=                         ───────────────────────               │
│                          &op_type_code=&template_id=                                                        │
│                          &asset_type_code=&location_code=             OperationWorkflowPolicyRole           │
│                          Returns: {allowed, reason}                    ────────────────────────              │
│                                                                        policy_id (FK→WorkflowPolicy)        │
│  CALLED BY:                                                             role_id (FK→Role)                   │
│  OperationTransactionDetail checks workflow policies                                                     │
│  before enabling Submit/Approve/Reject buttons                      OperationWorkflowPolicyUser           │
│  (via canSubmit/canApprove flags)                                      ────────────────────────              │
│                                                                        policy_id (FK)                       │
│  EVALUATION CHAIN:                                                     user_id (FK→User)                    │
│  User Action → find matching policy → check user has                                                 │
│    required role (or is assigned user) → allow/deny                                                     │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```
