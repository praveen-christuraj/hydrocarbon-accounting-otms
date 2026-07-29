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

    receiptGsvBbl: Number(row.receipt_gsv_bbl || 0),
    receiptNsvBbl: Number(row.receipt_nsv_bbl || 0),
    receiptLt: Number(row.receipt_lt || 0),
    receiptMt: Number(row.receipt_mt || 0),

    productionGsvBbl: Number(row.production_gsv_bbl || 0),
    productionNsvBbl: Number(row.production_nsv_bbl || 0),
    productionLt: Number(row.production_lt || 0),
    productionMt: Number(row.production_mt || 0),

    drainingGsvBbl: Number(row.draining_gsv_bbl || 0),
    drainingNsvBbl: Number(row.draining_nsv_bbl || 0),
    drainingLt: Number(row.draining_lt || 0),
    drainingMt: Number(row.draining_mt || 0),

    dispatchGsvBbl: Number(row.dispatch_gsv_bbl || 0),
    dispatchNsvBbl: Number(row.dispatch_nsv_bbl || 0),
    dispatchLt: Number(row.dispatch_lt || 0),
    dispatchMt: Number(row.dispatch_mt || 0),

    otherInGsvBbl: Number(row.other_in_gsv_bbl || 0),
    otherInNsvBbl: Number(row.other_in_nsv_bbl || 0),
    otherInLt: Number(row.other_in_lt || 0),
    otherInMt: Number(row.other_in_mt || 0),

    otherOutGsvBbl: Number(row.other_out_gsv_bbl || 0),
    otherOutNsvBbl: Number(row.other_out_nsv_bbl || 0),
    otherOutLt: Number(row.other_out_lt || 0),
    otherOutMt: Number(row.other_out_mt || 0),

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

  return params.toString()
}

export const getOutTurnReport = async (filters = {}) => {
  const queryString = buildQueryString(filters)
  const path = queryString
    ? `/reports/out-turn-report?${queryString}`
    : '/reports/out-turn-report'

  const data = await apiGet(path)

  return (Array.isArray(data) ? data : []).map(convertOutTurnRowFromApi)
}