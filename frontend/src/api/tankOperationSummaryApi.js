import { apiGet } from './apiClient'
import { toIsoDateString } from '../utils/format'

const ISO_DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/

const toLocalCalendarDate = (value) => {
  const str = String(value || '').trim()
  const match = ISO_DATE_ONLY_RE.exec(str)
  if (match) {
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  }
  return new Date(value)
}

const convertTankOperationSummaryRowFromApi = (row) => {
  const parsedRow = { ...row }

  if (row.created_at) {
    parsedRow.createdAt = new Date(row.created_at)
  }

  if (row.operation_date) {
    parsedRow.operationDate = toLocalCalendarDate(row.operation_date)
  }

  if (row.accounting_date) {
    parsedRow.accountingDate = toLocalCalendarDate(row.accounting_date)
  }

  return parsedRow
}

const buildQueryString = (filtersOrLocationCode = {}) => {
  if (typeof filtersOrLocationCode === 'string') {
    const params = new URLSearchParams()
    if (filtersOrLocationCode.trim()) {
      params.append('location_code', filtersOrLocationCode.trim())
    }
    return params.toString()
  }

  const filters = filtersOrLocationCode || {}
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

  if (filters.page) {
    params.append('page', String(filters.page))
  }

  if (filters.pageSize) {
    params.append('page_size', String(filters.pageSize))
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
    page: data.page || 1,
    pageSize: data.page_size || 0,
    hasMore: Boolean(data.has_more),
    defaultWindowApplied: Boolean(data.default_window_applied),
    appliedDateFrom: data.applied_date_from || data.date_from || '',
    appliedDateTo: data.applied_date_to || data.date_to || '',
  }
}

export const getTankOperationSummaryColumns = async (filtersOrLocationCode = {}) => {
  const queryString = buildQueryString(filtersOrLocationCode)
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
  link.setAttribute('download', `tank-operation-summary-${toIsoDateString(new Date())}.csv`)
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)

  URL.revokeObjectURL(url)
}
