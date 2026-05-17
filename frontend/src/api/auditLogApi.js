import { apiGet } from './apiClient'

const convertAuditLogFromApi = (item) => {
  return {
    id: item.id,
    moduleName: item.module_name,
    action: item.action,
    entityType: item.entity_type || '',
    entityId: item.entity_id || '',
    entityLabel: item.entity_label || '',
    ticketNumber: item.ticket_number || '',
    operationNumber: item.operation_number || '',
    oldStatus: item.old_status || '',
    newStatus: item.new_status || '',
    performedBy: item.performed_by || '',
    remarks: item.remarks || '',
    requestPath: item.request_path || '',
    details: item.details || null,
    createdAt: item.created_at,
  }
}

export const getAuditLogs = async (filters = {}) => {
  const params = new URLSearchParams()

  if (filters.moduleName) {
    params.append('module_name', filters.moduleName)
  }

  if (filters.action) {
    params.append('action', filters.action)
  }

  if (filters.entityType) {
    params.append('entity_type', filters.entityType)
  }

  if (filters.ticketNumber) {
    params.append('ticket_number', filters.ticketNumber)
  }

  if (filters.operationNumber) {
    params.append('operation_number', filters.operationNumber)
  }

  if (filters.performedBy) {
    params.append('performed_by', filters.performedBy)
  }

  if (filters.dateFrom) {
    params.append('date_from', filters.dateFrom)
  }

  if (filters.dateTo) {
    params.append('date_to', filters.dateTo)
  }

  if (filters.limit) {
    params.append('limit', filters.limit)
  }

  const queryString = params.toString()
  const path = queryString ? `/audit-logs?${queryString}` : '/audit-logs'

  const data = await apiGet(path)
  return data.map(convertAuditLogFromApi)
}