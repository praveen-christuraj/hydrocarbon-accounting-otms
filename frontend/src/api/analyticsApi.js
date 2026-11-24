import { apiDelete, apiGet, apiPost, apiPut, API_BASE_URL, formatApiError } from './apiClient'
import {
  SESSION_EXPIRED_MESSAGE,
  clearAccessToken,
  getStoredAccessToken,
  isAccessTokenExpiringSoon,
} from './authToken'
import { refreshAccessToken, waitForPendingTokenRefresh } from './authApi'

export const getAnalyticsCatalog = () => apiGet('/analytics/catalog')
export const validateAnalyticsFormula = (formula, columnKeys = []) =>
  apiPost('/analytics/formula/validate', { formula, column_keys: columnKeys })
export const getAnalyticsDefinitions = () => apiGet('/analytics/definitions')
export const getAnalyticsDefinition = (id) => apiGet(`/analytics/definitions/${id}`)
export const createAnalyticsDefinition = (payload) => apiPost('/analytics/definitions', payload)
export const updateAnalyticsDefinition = (id, payload) => apiPut(`/analytics/definitions/${id}`, payload)
export const deleteAnalyticsDefinition = (id) => apiDelete(`/analytics/definitions/${id}`)
export const publishAnalyticsDefinition = (id, published) =>
  apiPost(`/analytics/definitions/${id}/publish`, { published })
export const getAnalyticsVersions = (id) => apiGet(`/analytics/definitions/${id}/versions`)
export const getMyAnalyticsDashboards = () => apiGet('/analytics/my-dashboards')
export const getMyAnalyticsDashboard = (id) => apiGet(`/analytics/my-dashboards/${id}`)
export const runAnalyticsPreview = (definition, params = {}) =>
  apiPost('/analytics/run-preview', { definition, params })
export const runAnalyticsDashboard = (id, params = {}) =>
  apiPost(`/analytics/my-dashboards/${id}/run-batch`, params)

export const exportAnalyticsVisual = async (id, visualId, params = {}, format = 'xlsx') => {
  const endpoint = `/analytics/my-dashboards/${id}/visual/${encodeURIComponent(visualId)}/export`
  await waitForPendingTokenRefresh()
  if (getStoredAccessToken() && isAccessTokenExpiringSoon()) {
    const refreshed = await refreshAccessToken()
    if (!refreshed) throw new Error(SESSION_EXPIRED_MESSAGE)
  }
  const doFetch = () => {
    const token = getStoredAccessToken()
    return fetch(`${API_BASE_URL}${endpoint}`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ ...params, format }),
    })
  }
  let response = await doFetch()
  if (response.status === 401) {
    const refreshed = await refreshAccessToken()
    if (!refreshed) {
      clearAccessToken()
      throw new Error(SESSION_EXPIRED_MESSAGE)
    }
    response = await doFetch()
  }
  if (!response.ok) {
    let message = 'Analytics export failed'
    try {
      message = formatApiError(await response.json()) || message
    } catch {
      // Keep the generic message when the server does not return JSON.
    }
    throw new Error(message)
  }
  const blob = await response.blob()
  const disposition = response.headers.get('content-disposition') || ''
  const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || `analytics.${format}`
  const url = window.URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => window.URL.revokeObjectURL(url), 1000)
  return filename
}
