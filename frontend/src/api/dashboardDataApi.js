import { apiGet, apiPost } from './apiClient'

const buildQuery = (filters = {}) => {
  const params = new URLSearchParams()

  Object.entries(filters || {}).forEach(([key, value]) => {
    if (value === undefined || value === null) {
      return
    }

    const cleaned = String(value).trim()
    if (cleaned === '') {
      return
    }

    params.set(key, cleaned)
  })

  const queryString = params.toString()
  return queryString ? `?${queryString}` : ''
}

export const listDashboardDataSources = async (filters = {}) => {
  return apiGet(`/dashboard-data-sources${buildQuery(filters)}`)
}

export const fetchDashboardData = async (body) => {
  return apiPost('/dashboard/data', body)
}
