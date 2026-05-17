import { apiGet, apiPatch } from './apiClient'
import { getStoredAccessToken } from './authApi'

const convertOperationTransactionFromApi = (item) => {
  return {
    id: item.id,
    ticketNumber:
      item.ticket_number ||
      item.operation_ticket_number ||
      item.operation_number ||
      '',
    operationDate: item.operation_date,
    operationTypeId: item.operation_type_id,
    operationTypeCode: item.operation_type_code || '',
    operationTypeName: item.operation_type_name || '',
    locationId: item.location_id,
    locationName: item.location_name || '',
    locationCode: item.location_code || '',
    primaryAssetId: item.primary_asset_id,
    primaryAssetName: item.primary_asset_name || '',
    primaryAssetCode: item.primary_asset_code || '',
    convoyNumber: item.convoy_number || '',
    status: item.status || '',
    fieldCount: item.field_count || 0,
    createdAt: item.created_at,
  }
}

const convertOperationTransactionDetailFromApi = (item) => {
  return {
    id: item.id,
    ticketNumber:
      item.ticket_number ||
      item.operation_ticket_number ||
      item.operation_number ||
      '',
    operationDate: item.operation_date,
    operationTypeId: item.operation_type_id,
    operationTypeCode: item.operation_type_code || '',
    operationTypeName: item.operation_type_name || '',
    locationId: item.location_id,
    locationName: item.location_name || '',
    locationCode: item.location_code || '',
    primaryAssetId: item.primary_asset_id,
    primaryAssetName: item.primary_asset_name || '',
    primaryAssetCode: item.primary_asset_code || '',
    convoyNumber: item.convoy_number || '',
    status: item.status || '',
    createdBy: item.created_by || '',
    createdAt: item.created_at,
    updatedAt: item.updated_at,
    fieldValues: (item.field_values || []).map((field) => ({
      id: field.id,
      templateFieldId: field.template_field_id,
      fieldCode: field.field_code || '',
      fieldName: field.field_name || '',
      fieldLabel: field.field_label || field.field_name || '',
      fieldGroup: field.field_group || '',
      fieldType: field.field_type || field.data_type || '',
      dataType: field.data_type || field.field_type || '',
      fieldUnit: field.field_unit || field.unit || '',
      unit: field.unit || field.field_unit || '',
      inputMode: field.input_mode || '',
      calculationRole: field.calculation_role || '',
      sortOrder: field.sort_order || 0,
      fieldValue:
        field.field_value === null || field.field_value === undefined
          ? ''
          : field.field_value,
    })),
  }
}

const convertStatusHistoryFromApi = (item) => {
  return {
    id: item.id,
    transactionId: item.transaction_id,
    oldStatus: item.old_status || '',
    newStatus: item.new_status || '',
    changedBy: item.changed_by || '',
    remarks: item.remarks || '',
    changedAt: item.changed_at || '',
  }
}

export const getOperationTransactions = async (filters = {}) => {
  const queryParams = new URLSearchParams()

  if (filters.dateFrom) queryParams.append('date_from', filters.dateFrom)
  if (filters.dateTo) queryParams.append('date_to', filters.dateTo)
  if (filters.operationTypeId) queryParams.append('operation_type_id', filters.operationTypeId)
  if (filters.operationTypeCode) queryParams.append('operation_type_code', filters.operationTypeCode)
  if (filters.locationId) queryParams.append('location_id', filters.locationId)
  if (filters.locationCode) queryParams.append('location_code', filters.locationCode)
  if (filters.assetId) queryParams.append('asset_id', filters.assetId)
  if (filters.assetCode) queryParams.append('asset_code', filters.assetCode)
  if (filters.status) queryParams.append('status', filters.status)
  if (filters.searchText) queryParams.append('search', filters.searchText)

  const queryString = queryParams.toString()
  const path = queryString ? `/operation-transactions?${queryString}` : '/operation-transactions'

  const data = await apiGet(path)
  return data.map(convertOperationTransactionFromApi)
}

export const getOperationTransactionDetail = async (transactionId) => {
  const data = await apiGet(`/operation-transactions/${transactionId}`)
  return convertOperationTransactionDetailFromApi(data)
}

export const updateOperationTransactionStatus = async (
  transactionId,
  status,
  remarks = ''
) => {
  return apiPatch(`/operation-transactions/${transactionId}/status`, {
    status,
    remarks,
  })
}

export const getOperationTransactionStatusHistory = async (transactionId) => {
  const data = await apiGet(`/operation-transactions/${transactionId}/status-history`)
  return data.map(convertStatusHistoryFromApi)
}

export const exportOperationTransactionsCsv = async (filters = {}) => {
  const params = new URLSearchParams()

  if (filters.searchText) {
    params.append('search', filters.searchText)
  }

  if (filters.dateFrom) {
    params.append('date_from', filters.dateFrom)
  }

  if (filters.dateTo) {
    params.append('date_to', filters.dateTo)
  }

  if (filters.operationTypeId) {
    params.append('operation_type_id', filters.operationTypeId)
  }

  if (filters.locationId) {
    params.append('location_id', filters.locationId)
  }

  if (filters.assetId) {
    params.append('asset_id', filters.assetId)
  }

  if (filters.status) {
    params.append('status', filters.status)
  }

  const queryString = params.toString()
  const path = queryString
    ? `/operation-transactions/export/csv?${queryString}`
    : '/operation-transactions/export/csv'

  const token = getStoredAccessToken()

  if (!token) {
    throw new Error('Login token missing. Please logout and login again.')
  }

  const response = await fetch(`http://127.0.0.1:8000${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(errorText || 'Failed to export operation transactions')
  }

  const blob = await response.blob()

  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')

  link.href = url
  link.download = `operation-transaction-register-${new Date()
    .toISOString()
    .slice(0, 10)}.csv`

  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)

  URL.revokeObjectURL(url)
}