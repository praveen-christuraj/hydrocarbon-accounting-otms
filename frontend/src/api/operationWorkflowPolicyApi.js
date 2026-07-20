import { apiDelete, apiGet, apiPost, apiPut } from './apiClient'

const fromApi = (item) => ({
  id: item.id,
  policyName: item.policy_name || '',
  actionCode: item.action_code || '',
  operationTypeCode: item.operation_type_code || '',
  operationTemplateId: item.operation_template_id || '',
  assetTypeCode: item.asset_type_code || '',
  locationCode: item.location_code || '',
  priority: item.priority ?? 100,
  status: item.status || 'Active',
  roles: item.roles || [],
  users: item.users || [],
})

export const getOperationWorkflowPolicies = async () => {
  const data = await apiGet('/operation-workflow-policies')
  return (data || []).map(fromApi)
}

export const createOperationWorkflowPolicy = async (payload) => {
  const data = await apiPost('/operation-workflow-policies', payload)
  return fromApi(data)
}

export const updateOperationWorkflowPolicy = async (policyId, payload) => {
  const data = await apiPut(`/operation-workflow-policies/${policyId}`, payload)
  return fromApi(data)
}

export const deleteOperationWorkflowPolicy = async (policyId) => {
  return apiDelete(`/operation-workflow-policies/${policyId}`)
}

export const saveOperationWorkflowPolicyRoles = async (policyId, roleIds) => {
  const data = await apiPost(`/operation-workflow-policies/${policyId}/roles`, {
    role_ids: roleIds,
  })
  return fromApi(data)
}

export const saveOperationWorkflowPolicyUsers = async (policyId, users) => {
  const data = await apiPost(`/operation-workflow-policies/${policyId}/users`, {
    users,
  })
  return fromApi(data)
}

export const checkOperationWorkflowPolicy = async (payload) => {
  return apiPost('/operation-workflow-policies/check', payload)
}
