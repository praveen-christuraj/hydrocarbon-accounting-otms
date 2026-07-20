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
