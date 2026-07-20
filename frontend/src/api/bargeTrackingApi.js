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
  return apiGet(`/barge-tracking?convoy_number=${encodeURIComponent(convoy)}`)
}

export const getTripTimelineByConvoy = async (convoyNumber) => {
  const convoy = String(convoyNumber || '').trim()
  if (!convoy) throw new Error('Convoy Number is required')
  return apiGet(`/trips/by-convoy/${encodeURIComponent(convoy)}`)
}

export const createTripEvent = async (payload) => {
  return apiPost('/trip-events', toTripEventPayload(payload))
}

export const createTripComparison = async (payload) => {
  return apiPost('/trip-comparisons', payload)
}

export const closeTrip = async (tripId, remarks = null) => {
  return apiPost(`/trips/${Number(tripId)}/close`, { remarks })
}

export const reopenTrip = async (tripId, remarks = null) => {
  return apiPost(`/trips/${Number(tripId)}/reopen`, { remarks })
}