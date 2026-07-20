import { apiGet, apiPost } from './apiClient'

const buildQueryString = (filters = {}) => {
  const params = new URLSearchParams()
  Object.entries(filters).forEach(([key, value]) => {
    const cleaned = String(value ?? '').trim()
    if (cleaned) params.append(key, cleaned)
  })
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

const convertTicketFromApi = (t) => {
  if (!t) return null
  return {
    transactionId: t.transaction_id,
    ticketNumber: t.ticket_number || '',
    operationNumber: t.operation_number || '',
    locationCode: t.location_code || '',
    locationName: t.location_name || '',
    shuttleNumber: t.shuttle_number || '',
    fsoAssetCode: t.fso_asset_code || '',
    fsoAssetName: t.fso_asset_name || '',
    productName: t.product_name || '',
    operationDate: t.operation_date || '',
    eventTime: t.event_time || '',
    operationLabel: t.operation_label || '',
    vesselName: t.vessel_name || '',
    vesselQuantityBbl: Number(t.vessel_quantity_bbl || 0),
    openingStockBbl: Number(t.opening_stock_bbl || 0),
    openingWaterBbl: Number(t.opening_water_bbl || 0),
    closingStockBbl: Number(t.closing_stock_bbl || 0),
    closingWaterBbl: Number(t.closing_water_bbl || 0),
    netStockBbl: Number(t.net_stock_bbl || 0),
    netWaterBbl: Number(t.net_water_bbl || 0),
    varianceBbl: Number(t.variance_bbl || 0),
    remarks: t.remarks || '',
    status: t.status || '',
    createdBy: t.created_by || '',
    createdAt: t.created_at || '',
    updatedAt: t.updated_at || '',
  }
}

const convertGroupFromApi = (g) => ({
  groupKey: g.group_key || '',
  locationCode: g.location_code || '',
  locationName: g.location_name || '',
  shuttleNumber: g.shuttle_number || '',
  fsoAssetCode: g.fso_asset_code || '',
  fsoAssetName: g.fso_asset_name || '',
  voyageStatus: g.voyage_status || 'OPEN',
  closedBy: g.closed_by || '',
  closedAt: g.closed_at || '',
  closureRemarks: g.closure_remarks || '',
  totalReceiptsBbl: Number(g.total_receipts_bbl || 0),
  totalExportsBbl: Number(g.total_exports_bbl || 0),
  totalWaterInBbl: Number(g.total_water_in_bbl || 0),
  totalWaterOutBbl: Number(g.total_water_out_bbl || 0),
  netWaterBbl: Number(g.net_water_bbl || 0),
  lossGainBbl: Number(g.loss_gain_bbl || 0),
  totalVarianceBbl: Number(g.total_variance_bbl || 0),
  shuttleDischargeBbl: Number(g.shuttle_discharge_bbl || 0),
  fsoReceiptBbl: Number(g.fso_receipt_bbl || 0),
  varianceBbl: Number(g.variance_bbl || 0),
  tickets: (g.tickets || []).map(convertTicketFromApi).filter(Boolean),
})

export const getFSOTracking = async (filters = {}) => {
  const data = await apiGet(`/fso-tracking${buildQueryString(filters)}`)
  return {
    rows: (data.rows || []).map(convertGroupFromApi),
    totalGroups: Number(data.total_groups || 0),
    page: Number(data.page || 1),
    pageSize: Number(data.page_size || 20),
    hasMore: Boolean(data.has_more),
  }
}

export const closeFSOVoyage = async ({
  locationCode,
  shuttleNumber,
  fsoAssetCode,
  closureRemarks,
}) => {
  return apiPost('/fso-voyages/close', {
    location_code: locationCode,
    shuttle_number: shuttleNumber,
    fso_asset_code: fsoAssetCode,
    closure_remarks:
      closureRemarks && String(closureRemarks).trim() !== ''
        ? String(closureRemarks).trim()
        : null,
  })
}

export const reopenFSOVoyage = async ({
  locationCode,
  shuttleNumber,
  fsoAssetCode,
  remarks,
}) => {
  return apiPost('/fso-voyages/reopen', {
    location_code: locationCode,
    shuttle_number: shuttleNumber,
    fso_asset_code: fsoAssetCode,
    remarks: remarks && String(remarks).trim() !== '' ? String(remarks).trim() : null,
  })
}
