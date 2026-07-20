import { apiGet } from './apiClient'

const convertMaterialBalanceColumnFromApi = (row) => {
  return {
    columnKey: row.column_key || '',
    columnLabel: row.column_label || '',
    columnOrder: Number(row.column_order || 1),
    columnType: row.column_type || '',
    movementDirection: row.movement_direction || '',
    includeInMaterialBalance: row.include_in_material_balance || 'Yes',
    includeInBookClosing: row.include_in_book_closing || 'Yes',
    isInternalTransfer: row.is_internal_transfer || 'No',
  }
}

const convertMaterialBalanceRowFromApi = (row) => {
  return {
    accountingDate: row.accounting_date || '',

    locationCode: row.location_code || '',
    locationName: row.location_name || '',

    tankAssetCode: row.tank_asset_code || '',
    tankAssetName: row.tank_asset_name || '',

    productName: row.product_name || '',

    values: row.values || {},

    rowsCount: Number(row.rows_count || 0),
    lastTicketNumber: row.last_ticket_number || '',
  }
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

  if (filters.unit) {
    params.append('unit', filters.unit)
  }

  return params.toString()
}

export const getMaterialBalanceReport = async (filters = {}) => {
  const queryString = buildQueryString(filters)

  const path = queryString
    ? `/material-balance-report?${queryString}`
    : '/material-balance-report'

  const data = await apiGet(path)

  return {
    template: {
      id: data?.template?.id || null,
      locationCode: data?.template?.location_code || '',
      templateName: data?.template?.template_name || '',
    },
    columns: (data?.columns || []).map(convertMaterialBalanceColumnFromApi),
    rows: (data?.rows || []).map(convertMaterialBalanceRowFromApi),
  }
}