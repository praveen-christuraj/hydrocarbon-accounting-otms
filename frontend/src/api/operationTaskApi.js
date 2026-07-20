import { apiGet, apiPost } from './apiClient'

const fromApi = (task) => ({
  id: task.id,
  taskNumber: task.task_number || '',
  taskType: task.task_type || '',
  transactionId: task.transaction_id,
  ticketNumber: task.ticket_number || '',
  operationNumber: task.operation_number || '',
  operationTypeCode: task.operation_type_code || '',
  operationTemplateId: task.operation_template_id || null,
  assetTypeCode: task.asset_type_code || '',
  primaryAssetCode: task.primary_asset_code || '',
  locationCode: task.location_code || '',
  status: task.status || '',
  priority: task.priority || 'Normal',
  takenByUserId: task.taken_by_user_id || null,
  takenAt: task.taken_at || '',
  actedByUserId: task.acted_by_user_id || null,
  actedAt: task.acted_at || '',
  actionTaken: task.action_taken || '',
  remarks: task.remarks || '',
  createdAt: task.created_at || '',
  updatedAt: task.updated_at || '',
  transaction: task.transaction || null,
})

const eventFromApi = (event) => ({
  id: event.id,
  taskId: event.task_id,
  eventType: event.event_type || '',
  oldStatus: event.old_status || '',
  newStatus: event.new_status || '',
  actorUserId: event.actor_user_id || null,
  actorDisplay: event.actor_display || '',
  notes: event.notes || '',
  details: event.details || null,
  createdAt: event.created_at || '',
})

const buildQuery = (filters = {}) => {
  const params = new URLSearchParams()
  if (filters.status) params.append('status', filters.status)
  if (filters.taskType) params.append('task_type', filters.taskType)
  if (filters.search) params.append('search', filters.search)
  if (filters.createdFrom) params.append('created_from', filters.createdFrom)
  if (filters.createdTo) params.append('created_to', filters.createdTo)
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

export const getMyOperationTasks = async (filters = {}) => {
  const data = await apiGet(`/operation-tasks/my${buildQuery(filters)}`)
  return (data || []).map(fromApi)
}

export const getOperationTasks = async (filters = {}) => {
  const data = await apiGet(`/operation-tasks${buildQuery(filters)}`)
  return (data || []).map(fromApi)
}

export const getOperationTask = async (taskId) => {
  const data = await apiGet(`/operation-tasks/${taskId}`)
  return fromApi(data)
}

export const getOperationTaskEvents = async (taskId) => {
  const data = await apiGet(`/operation-tasks/${taskId}/events`)
  return (data || []).map(eventFromApi)
}

export const takeOperationTaskOwnership = async (taskId, remarks = '') => {
  const data = await apiPost(`/operation-tasks/${taskId}/take-ownership`, {
    remarks,
  })
  return fromApi(data)
}

export const releaseOperationTask = async (taskId, remarks = '') => {
  const data = await apiPost(`/operation-tasks/${taskId}/release`, {
    remarks,
  })
  return fromApi(data)
}

export const approveOperationTask = async (taskId, remarks = '') => {
  return apiPost(`/operation-tasks/${taskId}/approve`, { remarks })
}

export const rejectOperationTask = async (taskId, remarks = '') => {
  return apiPost(`/operation-tasks/${taskId}/reject`, { remarks })
}

export const adminRevokeApprovedTransactionTask = async (taskId, remarks = '') => {
  return apiPost(`/operation-tasks/${taskId}/admin-revoke-approved-transaction`, {
    remarks,
  })
}

export const adminRejectApprovedRevokeTask = async (taskId, remarks = '') => {
  return apiPost(`/operation-tasks/${taskId}/admin-reject-approved-revoke`, {
    remarks,
  })
}
