import { apiGet } from './apiClient'

const convertTankOperationSummaryRowFromApi = (row) => {
  const parsedRow = { ...row }

  if (row.created_at) {
    parsedRow.createdAt = new Date(row.created_at)
  }

  if (row.operation_date) {
    parsedRow.operationDate = new Date(row.operation_date)
  }

  if (row.accounting_date) {
    parsedRow.accountingDate = new Date(row.accounting_date)
  }

  return parsedRow
}

const buildQueryString = (filters = {}) => {
  const params = new URLSearchParams()

  if (filters.locationCode) {
    params.append('location_code', filters.locationCode)
  }

  if (filters.tankAssetCode) {
    params.append('tank_asset_code', filters.tankAssetCode)
  }

  if (filters.productName) {
    params.append('product_name', filters.productName)
  }

  if (filters.dateFrom) {
    params.append('date_from', filters.dateFrom)
  }

  if (filters.dateTo) {
    params.append('date_to', filters.dateTo)
  }

  return params.toString()
}

export const getTankOperationSummary = async (filters = {}) => {
  const queryString = buildQueryString(filters)
  const path = queryString
    ? `/tank-operation-summary?${queryString}`
    : '/tank-operation-summary'

  const data = await apiGet(path)

  return {
    rows: (data.rows || []).map(convertTankOperationSummaryRowFromApi),
    columns: data.columns || [],
    totalRows: data.total_rows || 0,
  }
}

export const getTankOperationSummaryColumns = async (filters = {}) => {
  const queryString = buildQueryString(filters)
  const path = queryString
    ? `/tank-operation-summary/columns?${queryString}`
    : '/tank-operation-summary/columns'

  const data = await apiGet(path)

  return data.columns || []
}

export const exportTankOperationSummaryCsv = async (filters = {}) => {
  const queryString = buildQueryString(filters)
  const path = `/tank-operation-summary/export/csv${queryString ? `?${queryString}` : ''}`

  const blob = await apiGet(path, { responseType: 'blob' })

  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')

  link.href = url
  link.setAttribute('download', `tank-operation-summary-${new Date().toISOString().split('T')[0]}.csv`)
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)

  URL.revokeObjectURL(url)
}