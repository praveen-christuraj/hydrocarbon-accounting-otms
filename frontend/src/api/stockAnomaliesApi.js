import { apiGet, apiPost } from './apiClient'

export const getStockAnomaliesOverview = ({
  locationCode = '',
  dateFrom = '',
  dateTo = '',
} = {}) => {
  const params = new URLSearchParams()
  if (locationCode) params.set('location_code', locationCode)
  if (dateFrom) params.set('date_from', dateFrom)
  if (dateTo) params.set('date_to', dateTo)
  const qs = params.toString()
  return apiGet(`/analytics/stock-anomalies/overview${qs ? `?${qs}` : ''}`)
}

export const refreshAssetMetricProfiles = (locationCode = '') => {
  const qs = locationCode ? `?location_code=${encodeURIComponent(locationCode)}` : ''
  return apiPost(`/analytics/stock-anomalies/refresh-profiles${qs}`, {})
}
