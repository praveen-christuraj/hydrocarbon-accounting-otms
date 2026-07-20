import { apiGet } from './apiClient'

const convertLedgerRowFromApi = (row) => {
  return {
    id: row.id,
    transactionId: row.transaction_id,
    ticketNumber: row.ticket_number || '',
    operationNumber: row.operation_number || '',

    locationCode: row.location_code || '',
    locationName: row.location_name || '',

    tankAssetCode: row.tank_asset_code || '',
    tankAssetName: row.tank_asset_name || '',

    operationDate: row.operation_date || '',
    productName: row.product_name || '',

    tankOperationCode: row.tank_operation_code || '',
    tankOperationLabel: row.tank_operation_label || '',
    tankOperationCategory: row.tank_operation_category || '',
    tankOperationSign: row.tank_operation_sign || '',

    movementGsvBbl: Number(row.movement_gsv_bbl || 0),
    movementNsvBbl: Number(row.movement_nsv_bbl || 0),
    movementLt: Number(row.movement_lt || 0),
    movementMt: Number(row.movement_mt || 0),

    runningBalanceGsvBbl: Number(row.running_balance_gsv_bbl || 0),
    runningBalanceNsvBbl: Number(row.running_balance_nsv_bbl || 0),
    runningBalanceLt: Number(row.running_balance_lt || 0),
    runningBalanceMt: Number(row.running_balance_mt || 0),

    status: row.status || '',
    createdBy: row.created_by || '',
    remarks: row.remarks || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const convertLedgerSummaryFromApi = (row) => {
  return {
    locationCode: row.location_code || '',
    locationName: row.location_name || '',
    tankAssetCode: row.tank_asset_code || '',
    tankAssetName: row.tank_asset_name || '',
    productName: row.product_name || '',

    openingNsvBbl: Number(row.opening_nsv_bbl || 0),
    totalInNsvBbl: Number(row.total_in_nsv_bbl || 0),
    totalOutNsvBbl: Number(row.total_out_nsv_bbl || 0),
    closingNsvBbl: Number(row.closing_nsv_bbl || 0),

    openingLt: Number(row.opening_lt || 0),
    totalInLt: Number(row.total_in_lt || 0),
    totalOutLt: Number(row.total_out_lt || 0),
    closingLt: Number(row.closing_lt || 0),

    openingMt: Number(row.opening_mt || 0),
    totalInMt: Number(row.total_in_mt || 0),
    totalOutMt: Number(row.total_out_mt || 0),
    closingMt: Number(row.closing_mt || 0),
  }
}

const convertDailySummaryFromApi = (row) => {
  return {
    accountingDate: row.accounting_date || '',

    locationCode: row.location_code || '',
    locationName: row.location_name || '',

    tankAssetCode: row.tank_asset_code || '',
    tankAssetName: row.tank_asset_name || '',

    productName: row.product_name || '',

    openingGsvBbl: Number(row.opening_gsv_bbl || 0),
    openingNsvBbl: Number(row.opening_nsv_bbl || 0),
    openingLt: Number(row.opening_lt || 0),
    openingMt: Number(row.opening_mt || 0),

    totalInGsvBbl: Number(row.total_in_gsv_bbl || 0),
    totalInNsvBbl: Number(row.total_in_nsv_bbl || 0),
    totalInLt: Number(row.total_in_lt || 0),
    totalInMt: Number(row.total_in_mt || 0),

    totalOutGsvBbl: Number(row.total_out_gsv_bbl || 0),
    totalOutNsvBbl: Number(row.total_out_nsv_bbl || 0),
    totalOutLt: Number(row.total_out_lt || 0),
    totalOutMt: Number(row.total_out_mt || 0),

    bookClosingGsvBbl: Number(row.book_closing_gsv_bbl || 0),
    bookClosingNsvBbl: Number(row.book_closing_nsv_bbl || 0),
    bookClosingLt: Number(row.book_closing_lt || 0),
    bookClosingMt: Number(row.book_closing_mt || 0),

    actualClosingGsvBbl: Number(row.actual_closing_gsv_bbl || 0),
    actualClosingNsvBbl: Number(row.actual_closing_nsv_bbl || 0),
    actualClosingLt: Number(row.actual_closing_lt || 0),
    actualClosingMt: Number(row.actual_closing_mt || 0),

    lossGainGsvBbl: Number(row.loss_gain_gsv_bbl || 0),
    lossGainNsvBbl: Number(row.loss_gain_nsv_bbl || 0),
    lossGainLt: Number(row.loss_gain_lt || 0),
    lossGainMt: Number(row.loss_gain_mt || 0),

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

  if (filters.status) {
    params.append('status', filters.status)
  }

  return params.toString()
}

export const getTankStockLedger = async (filters = {}) => {
  const queryString = buildQueryString(filters)
  const path = queryString
    ? `/tank-stock-ledger?${queryString}`
    : '/tank-stock-ledger'

  const data = await apiGet(path)

  return (data || []).map(convertLedgerRowFromApi)
}

export const getTankStockLedgerSummary = async (filters = {}) => {
  const queryString = buildQueryString(filters)
  const path = queryString
    ? `/tank-stock-ledger/summary?${queryString}`
    : '/tank-stock-ledger/summary'

  const data = await apiGet(path)

  return (data || []).map(convertLedgerSummaryFromApi)
}

export const getTankStockLedgerDailySummary = async (filters = {}) => {
  const queryString = buildQueryString(filters)
  const path = queryString
    ? `/tank-stock-ledger/daily-summary?${queryString}`
    : '/tank-stock-ledger/daily-summary'

  const data = await apiGet(path)

  return (data || []).map(convertDailySummaryFromApi)
}