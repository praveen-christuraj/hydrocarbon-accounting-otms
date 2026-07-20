import { apiGet } from './apiClient'

const convertOutTurnRowFromApi = (row) => {
  return {
    ledgerId: row.ledger_id,
    transactionId: row.transaction_id,

    ticketNumber: row.ticket_number || '',
    operationNumber: row.operation_number || '',

    accountingDate: row.accounting_date || '',
    operationDatetime: row.operation_datetime || '',

    locationCode: row.location_code || '',
    locationName: row.location_name || '',

    tankAssetCode: row.tank_asset_code || '',
    tankAssetName: row.tank_asset_name || '',

    productName: row.product_name || '',

    tankOperationCode: row.tank_operation_code || '',
    tankOperationLabel: row.tank_operation_label || '',
    tankOperationCategory: row.tank_operation_category || '',
    tankOperationSign: row.tank_operation_sign || '',

    previousStockGsvBbl: Number(row.previous_stock_gsv_bbl || 0),
    previousStockNsvBbl: Number(row.previous_stock_nsv_bbl || 0),
    previousStockLt: Number(row.previous_stock_lt || 0),
    previousStockMt: Number(row.previous_stock_mt || 0),

    stockAfterGsvBbl: Number(row.stock_after_gsv_bbl || 0),
    stockAfterNsvBbl: Number(row.stock_after_nsv_bbl || 0),
    stockAfterLt: Number(row.stock_after_lt || 0),
    stockAfterMt: Number(row.stock_after_mt || 0),

    netReceiptGsvBbl: Number(row.net_receipt_gsv_bbl || 0),
    netReceiptNsvBbl: Number(row.net_receipt_nsv_bbl || 0),
    netReceiptLt: Number(row.net_receipt_lt || 0),
    netReceiptMt: Number(row.net_receipt_mt || 0),

    netDispatchGsvBbl: Number(row.net_dispatch_gsv_bbl || 0),
    netDispatchNsvBbl: Number(row.net_dispatch_nsv_bbl || 0),
    netDispatchLt: Number(row.net_dispatch_lt || 0),
    netDispatchMt: Number(row.net_dispatch_mt || 0),

    signedNetMovementGsvBbl: Number(row.signed_net_movement_gsv_bbl || 0),
    signedNetMovementNsvBbl: Number(row.signed_net_movement_nsv_bbl || 0),
    signedNetMovementLt: Number(row.signed_net_movement_lt || 0),
    signedNetMovementMt: Number(row.signed_net_movement_mt || 0),

    status: row.status || '',
    remarks: row.remarks || '',
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

export const getOutTurnReport = async (filters = {}) => {
  const queryString = buildQueryString(filters)
  const path = queryString ? `/out-turn-report?${queryString}` : '/out-turn-report'

  const data = await apiGet(path)

  return (data || []).map(convertOutTurnRowFromApi)
}