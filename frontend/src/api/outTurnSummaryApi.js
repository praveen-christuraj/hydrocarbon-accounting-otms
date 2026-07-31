import { apiGet, apiPut } from './apiClient'

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

export const getOutTurnSummary = async (filters = {}) => {
  const queryString = buildQueryString(filters)
  const path = queryString
    ? `/out-turn-summary?${queryString}`
    : '/out-turn-summary'

  const data = await apiGet(path)

  return {
    rows: data.rows || [],
    columns: data.columns || [],
    availableColumns: data.available_columns || [],
    totalRows: data.total_rows || 0,
  }
}

export const getOutTurnSummaryColumns = async (filters = {}) => {
  const queryString = buildQueryString(filters)
  const path = queryString
    ? `/out-turn-summary/columns?${queryString}`
    : '/out-turn-summary/columns'

  const data = await apiGet(path)

  return {
    columns: data.columns || [],
    availableColumns: data.available_columns || [],
  }
}

export const getOutTurnSummaryConfig = async () => {
  const data = await apiGet('/out-turn-summary/config')
  return data.columns || []
}

export const saveOutTurnSummaryConfig = async (columns) => {
  const data = await apiPut('/out-turn-summary/config', {
    columns,
  })

  return data.columns || []
}
