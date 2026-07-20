import { apiGet, apiPost } from './apiClient'

const buildQueryString = (filters = {}) => {
  const params = new URLSearchParams()

  Object.entries(filters).forEach(([key, value]) => {
    const cleanedValue = String(value ?? '').trim()

    if (cleanedValue !== '') {
      params.append(key, cleanedValue)
    }
  })

  const queryString = params.toString()

  return queryString ? `?${queryString}` : ''
}

const convertSealCheckFromApi = (seal) => ({
  sealName: seal.seal_name || '',
  senderValue: seal.sender_value || '',
  receiverValue: seal.receiver_value || '',
  status: seal.status || '',
})

const convertQuantityComparisonFromApi = (comparison) => {
  if (!comparison) {
    return null
  }

  return {
    senderTransactionId: comparison.sender_transaction_id,
    receiverTransactionId: comparison.receiver_transaction_id,

    senderGovBbl: Number(comparison.sender_gov_bbl || 0),
    receiverGovBbl: Number(comparison.receiver_gov_bbl || 0),
    govVarianceBbl: Number(comparison.gov_variance_bbl || 0),

    senderGsvBbl: Number(comparison.sender_gsv_bbl || 0),
    receiverGsvBbl: Number(comparison.receiver_gsv_bbl || 0),
    gsvVarianceBbl: Number(comparison.gsv_variance_bbl || 0),

    senderNsvBbl: Number(comparison.sender_nsv_bbl || 0),
    receiverNsvBbl: Number(comparison.receiver_nsv_bbl || 0),
    nsvVarianceBbl: Number(comparison.nsv_variance_bbl || 0),
    nsvVariancePercent: Number(comparison.nsv_variance_percent || 0),

    senderLt: Number(comparison.sender_lt || 0),
    receiverLt: Number(comparison.receiver_lt || 0),
    ltVariance: Number(comparison.lt_variance || 0),

    senderMt: Number(comparison.sender_mt || 0),
    receiverMt: Number(comparison.receiver_mt || 0),
    mtVariance: Number(comparison.mt_variance || 0),
  }
}

const convertTicketFromApi = (ticket) => {
  if (!ticket) {
    return null
  }

  return {
    transactionId: ticket.transaction_id,
    ticketNumber: ticket.ticket_number || '',
    operationNumber: ticket.operation_number || '',
    movementRole: ticket.movement_role || '',

    operationDate: ticket.operation_date || '',
    operationTypeCode: ticket.operation_type_code || '',
    operationTypeName: ticket.operation_type_name || '',

    originLocationCode: ticket.origin_location_code || '',
    originLocationName: ticket.origin_location_name || '',
    destinationLocationCode: ticket.destination_location_code || '',
    destinationLocationName: ticket.destination_location_name || '',
    senderLocationCode: ticket.sender_location_code || '',
    senderLocationName: ticket.sender_location_name || '',
    receiverLocationCode: ticket.receiver_location_code || '',
    receiverLocationName: ticket.receiver_location_name || '',

    primaryAssetCode: ticket.primary_asset_code || '',
    primaryAssetName: ticket.primary_asset_name || '',
    primaryAssetTypeCode: ticket.primary_asset_type_code || '',

    primeMoverAssetCode: ticket.prime_mover_asset_code || '',
    primeMoverAssetName: ticket.prime_mover_asset_name || '',

    tankerAssetCode: ticket.tanker_asset_code || '',
    tankerAssetName: ticket.tanker_asset_name || '',
    tankerChassisNumber: ticket.tanker_chassis_number || '',

    convoyNumber: ticket.convoy_number || '',
    productName: ticket.product_name || '',

    compartment: ticket.compartment || '',
    totalDipCm: Number(ticket.total_dip_cm || 0),
    waterDipCm: Number(ticket.water_dip_cm || 0),
    bswPercent: Number(ticket.bsw_percent || 0),

    tankTemperature: ticket.tank_temperature,
    tankTemperatureUnit: ticket.tank_temperature_unit || '',
    sampleTemperature: ticket.sample_temperature,
    sampleTemperatureUnit: ticket.sample_temperature_unit || '',

    observedInputType: ticket.observed_input_type || '',
    observedApi: ticket.observed_api,
    observedDensity: ticket.observed_density,
    api60: ticket.api60,
    vcf: ticket.vcf,

    tovBbl: Number(ticket.tov_bbl || 0),
    freeWaterBbl: Number(ticket.free_water_bbl || 0),
    govBbl: Number(ticket.gov_bbl || 0),
    gsvBbl: Number(ticket.gsv_bbl || 0),
    bswBbl: Number(ticket.bsw_bbl || 0),
    nsvBbl: Number(ticket.nsv_bbl || 0),
    lt: Number(ticket.lt || 0),
    mt: Number(ticket.mt || 0),

    sealC1: ticket.seal_c1 || '',
    sealC2: ticket.seal_c2 || '',
    sealM1: ticket.seal_m1 || '',
    sealM2: ticket.seal_m2 || '',

    remarks: ticket.remarks || '',
    status: ticket.status || '',
    createdBy: ticket.created_by || '',
    createdAt: ticket.created_at || '',
    updatedAt: ticket.updated_at || '',
  }
}

const convertGroupFromApi = (group) => ({
  groupKey: group.group_key || '',
  convoyNumber: group.convoy_number || '',

  tankerAssetCode: group.tanker_asset_code || '',
  tankerAssetName: group.tanker_asset_name || '',
  tankerChassisNumber: group.tanker_chassis_number || '',

  primeMoverAssetCode: group.prime_mover_asset_code || '',
  primeMoverAssetName: group.prime_mover_asset_name || '',

  productName: group.product_name || '',

  senderTicket: convertTicketFromApi(group.sender_ticket),
  receiverTickets: (group.receiver_tickets || []).map(convertTicketFromApi),
  latestReceiverTicket: convertTicketFromApi(group.latest_receiver_ticket),

  sealChecks: (group.seal_checks || []).map(convertSealCheckFromApi),
  quantityComparison: convertQuantityComparisonFromApi(
    group.quantity_comparison
  ),

  acknowledgementId: group.acknowledgement_id || null,
  acknowledgedBy: group.acknowledged_by || '',
  acknowledgedAt: group.acknowledged_at || '',
  acknowledgementRemarks: group.acknowledgement_remarks || '',
  closedBy: group.closed_by || '',
  closedAt: group.closed_at || '',
  closureRemarks: group.closure_remarks || '',

  trackingStatus: group.tracking_status || '',
  warningMessages: group.warning_messages || [],
})

export const getTankerTracking = async (filters = {}) => {
  const data = await apiGet(`/tanker-tracking${buildQueryString(filters)}`)

  return {
    rows: (data.rows || []).map(convertGroupFromApi),
    totalGroups: Number(data.total_groups || 0),
    pendingReceipts: Number(data.pending_receipts || 0),
    receivedGroups: Number(data.received_groups || 0),
    comparedGroups: Number(data.compared_groups || 0),
    sealMismatchGroups: Number(data.seal_mismatch_groups || 0),
    quantityVarianceGroups: Number(data.quantity_variance_groups || 0),
  }
}

export const getTankerTrackingByConvoy = async (convoyNumber) => {
  const data = await apiGet(
    `/tanker-tracking/by-convoy/${encodeURIComponent(convoyNumber)}`
  )

  return {
    rows: (data.rows || []).map(convertGroupFromApi),
    totalGroups: Number(data.total_groups || 0),
    pendingReceipts: Number(data.pending_receipts || 0),
    receivedGroups: Number(data.received_groups || 0),
    comparedGroups: Number(data.compared_groups || 0),
    sealMismatchGroups: Number(data.seal_mismatch_groups || 0),
    quantityVarianceGroups: Number(data.quantity_variance_groups || 0),
  }
}

export const acknowledgeTankerReceipt = async ({
  senderTransactionId,
  receiverLocationCode,
  remarks,
}) => {
  return apiPost('/tanker-tracking/acknowledge', {
    sender_transaction_id: Number(senderTransactionId),
    receiver_location_code:
      receiverLocationCode && String(receiverLocationCode).trim() !== ''
        ? String(receiverLocationCode).trim()
        : null,
    remarks:
      remarks && String(remarks).trim() !== ''
        ? String(remarks).trim()
        : null,
  })
}

export const revokeTankerAcknowledgement = async ({
  acknowledgementId,
  remarks,
}) => {
  const params = new URLSearchParams()

  if (remarks && String(remarks).trim() !== '') {
    params.append('remarks', String(remarks).trim())
  }

  const queryString = params.toString()

  const url = queryString
    ? `/tanker-tracking/acknowledgements/${acknowledgementId}/revoke?${queryString}`
    : `/tanker-tracking/acknowledgements/${acknowledgementId}/revoke`

  return apiPost(url, {})
}

export const getTankerSenderReference = async (senderTransactionId) => {
  const data = await apiGet(
    `/tanker-tracking/sender-reference/${encodeURIComponent(
      senderTransactionId
    )}`
  )

  return convertTicketFromApi(data)
}

export const closeTankerMovement = async ({
  acknowledgementId,
  closureRemarks,
}) => {
  return apiPost('/tanker-tracking/close', {
    acknowledgement_id: Number(acknowledgementId),
    closure_remarks:
      closureRemarks && String(closureRemarks).trim() !== ''
        ? String(closureRemarks).trim()
        : null,
  })
}
