import { apiGet, apiPost } from './apiClient'

const clean = (v) => {
  const s = String(v ?? '').trim()
  return s === '' ? null : s
}

const toTripEventPayload = (payload = {}) => ({
  convoy_number: clean(payload.convoyNumber || payload.convoy_number),
  event_type: clean(payload.eventType || payload.event_type),
  location_code: clean(payload.locationCode || payload.location_code),
  asset_code: clean(payload.assetCode || payload.asset_code),
  operation_transaction_id:
    payload.operationTransactionId !== undefined &&
    payload.operationTransactionId !== null &&
    String(payload.operationTransactionId).trim() !== ''
      ? Number(payload.operationTransactionId)
      : payload.operation_transaction_id !== undefined &&
          payload.operation_transaction_id !== null &&
          String(payload.operation_transaction_id).trim() !== ''
        ? Number(payload.operation_transaction_id)
        : null,
  sequence_no:
    payload.sequenceNo !== undefined &&
    payload.sequenceNo !== null &&
    String(payload.sequenceNo).trim() !== ''
      ? Number(payload.sequenceNo)
      : payload.sequence_no !== undefined &&
          payload.sequence_no !== null &&
          String(payload.sequence_no).trim() !== ''
        ? Number(payload.sequence_no)
        : null,
  event_datetime: clean(payload.eventDatetime || payload.event_datetime),
  remarks: clean(payload.remarks),
})

export const getBargeTracking = async (convoyNumber) => {
  const convoy = String(convoyNumber || '').trim()
  if (!convoy) throw new Error('Convoy Number is required')
  return apiGet(`/barge-trip/barge-tracking?convoy_number=${encodeURIComponent(convoy)}`)
}

const toVoyageRow = (row = {}) => ({
  tripId: row.trip_id ?? null,
  convoyNumber: row.convoy_number || '',
  status: String(row.status || 'OPEN').toUpperCase(),
  barges: (row.barges || []).map((barge) => ({
    assetCode: barge.asset_code || '',
    assetName: barge.asset_name || '',
  })),
  bargeCount: Number(row.barge_count || 0),
  ticketCount: Number(row.ticket_count || 0),
  firstOperationDate: row.first_operation_date || '',
  lastOperationDate: row.last_operation_date || '',
  originLocationCodes: row.origin_location_codes || [],
  destinationLocationCodes: row.destination_location_codes || [],
  tripCreatedBy: row.trip_created_by || '',
  tripRemarks: row.trip_remarks || '',
  tripUpdatedAt: row.trip_updated_at || '',
})

/**
 * Barge voyages for the Open / Closed tabs. `tab` is OPEN or CLOSED; the
 * response also carries both tab counts so the tab labels stay accurate.
 */
export const getBargeVoyages = async (tab = 'OPEN') => {
  const normalizedTab = String(tab || 'OPEN').toUpperCase() === 'CLOSED' ? 'CLOSED' : 'OPEN'
  const data = await apiGet(`/barge-trip/voyages?tab=${normalizedTab}`)

  return {
    tab: data.tab || normalizedTab,
    openCount: Number(data.open_count || 0),
    closedCount: Number(data.closed_count || 0),
    rows: (data.rows || []).map(toVoyageRow),
  }
}

export const getTripTimelineByConvoy = async (convoyNumber) => {
  const convoy = String(convoyNumber || '').trim()
  if (!convoy) throw new Error('Convoy Number is required')
  return apiGet(`/barge-trip/trips/by-convoy/${encodeURIComponent(convoy)}`)
}

export const createTripEvent = async (payload) => {
  return apiPost('/barge-trip/trip-events', toTripEventPayload(payload))
}

export const createTripComparison = async (payload) => {
  return apiPost('/barge-trip/trip-comparisons', payload)
}

export const closeTrip = async (tripId, remarks = null) => {
  return apiPost(`/barge-trip/trips/${Number(tripId)}/close`, { remarks })
}

export const reopenTrip = async (tripId, remarks = null) => {
  return apiPost(`/barge-trip/trips/${Number(tripId)}/reopen`, { remarks })
}