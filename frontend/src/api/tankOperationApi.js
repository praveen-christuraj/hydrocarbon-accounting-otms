import { apiDelete, apiGet, apiPost, apiPut } from './apiClient'

const convertTankOperationFromApi = (item) => {
  return {
    id: item.id,
    locationCode: item.location_code || '',
    locationName: item.location_name || '',
    operationCode: item.operation_code || '',
    operationLabel: item.operation_label || '',
    operationCategory: item.operation_category || '',
    operationSign: item.operation_sign || '',
    sortOrder: item.sort_order || 1,
    description: item.description || '',
    status: item.status || 'Active',
    createdAt: item.created_at,
    updatedAt: item.updated_at,
  }
}

const convertTankOperationToApi = (item) => {
  return {
    location_code: String(item.locationCode || '').trim(),
    operation_code: String(item.operationCode || '').trim().toUpperCase(),
    operation_label: String(item.operationLabel || '').trim(),
    operation_category: String(item.operationCategory || '').trim().toUpperCase(),
    operation_sign: String(item.operationSign || '').trim().toUpperCase(),
    sort_order: Number(item.sortOrder || 1),
    description:
      item.description && String(item.description).trim() !== ''
        ? String(item.description).trim()
        : null,
    status: item.status || 'Active',
  }
}

export const getTankOperations = async (filters = {}) => {
  const params = new URLSearchParams()

  if (filters.locationCode) {
    params.append('location_code', filters.locationCode)
  }

  if (filters.status) {
    params.append('status', filters.status)
  }

  const queryString = params.toString()
  const path = queryString ? `/tank-operations?${queryString}` : '/tank-operations'

  const data = await apiGet(path)

  return (data || []).map(convertTankOperationFromApi)
}

export const createTankOperation = async (tankOperation) => {
  const data = await apiPost(
    '/tank-operations',
    convertTankOperationToApi(tankOperation)
  )

  return convertTankOperationFromApi(data)
}

export const updateTankOperation = async (tankOperationId, tankOperation) => {
  const data = await apiPut(
    `/tank-operations/${tankOperationId}`,
    convertTankOperationToApi(tankOperation)
  )

  return convertTankOperationFromApi(data)
}

export const deleteTankOperation = async (tankOperationId) => {
  return apiDelete(`/tank-operations/${tankOperationId}`)
}