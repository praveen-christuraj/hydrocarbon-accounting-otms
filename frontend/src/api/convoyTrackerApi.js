import { apiGet, apiPost } from './apiClient'

export const getConvoyTracker = async (convoyNumber) => {
  const convoy = String(convoyNumber || '').trim()
  if (!convoy) throw new Error('Convoy Number is required')

  const params = new URLSearchParams()
  params.set('convoy_number', convoy)

  return apiGet(`/convoy-tracker?${params.toString()}`)
}

export const getTripTimelineByConvoy = async (convoyNumber) => {
  const convoy = String(convoyNumber || '').trim()
  if (!convoy) throw new Error('Convoy Number is required')

  return apiGet(`/trips/by-convoy/${encodeURIComponent(convoy)}`)
}

export const createTripEvent = async ({
  convoyNumber,
  eventType,
  locationCode = null,
  assetCode,
  operationTransactionId = null,
  remarks = null,
}) => {
  const payload = {
    convoy_number: String(convoyNumber || '').trim(),
    event_type: String(eventType || '').trim(),
    location_code: locationCode ? String(locationCode).trim() : null,
    asset_code: String(assetCode || '').trim(),
    operation_transaction_id:
      operationTransactionId === null || operationTransactionId === undefined
        ? null
        : Number(operationTransactionId),
    remarks: remarks ? String(remarks).trim() : null,
  }

  return apiPost('/trip-events', payload)
}

export const createTripComparison = async ({
  convoyNumber,
  comparisonType,
  leftTransactionId,
  rightTransactionId,
  summaryJson = null,
  perTankJson = null,
  remarks = null,
}) => {
  const payload = {
    convoy_number: String(convoyNumber || '').trim(),
    comparison_type: String(comparisonType || '').trim(),
    left_transaction_id: Number(leftTransactionId),
    right_transaction_id: Number(rightTransactionId),
    summary_json: summaryJson,
    per_tank_json: perTankJson,
    remarks: remarks ? String(remarks).trim() : null,
  }

  return apiPost('/trip-comparisons', payload)
}
export const closeTrip = async (tripId, remarks = null) => {
  return apiPost(`/trips/${Number(tripId)}/close`, { remarks })
}

export const reopenTrip = async (tripId, remarks = null) => {
  return apiPost(`/trips/${Number(tripId)}/reopen`, { remarks })
}