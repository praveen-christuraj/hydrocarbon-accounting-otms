import { apiDelete, apiGet, apiPost, apiPut, API_BASE_URL, formatApiError } from './apiClient'
import {
  SESSION_EXPIRED_MESSAGE,
  clearAccessToken,
  getStoredAccessToken,
  isAccessTokenExpiringSoon,
} from './authToken'
import { refreshAccessToken, waitForPendingTokenRefresh } from './authApi'

export const getAnalyticsCatalog = () => apiGet('/analytics/catalog')
export const getAnalyticsLookups = () => apiGet('/analytics/lookups')
export const validateAnalyticsFormula = (formula, columnKeys = []) =>
  apiPost('/analytics/formula/validate', { formula, column_keys: columnKeys })
export const getAnalyticsDefinitions = () => apiGet('/analytics/definitions')
export const getAnalyticsDefinition = (id) => apiGet(`/analytics/definitions/${id}`)
export const createAnalyticsDefinition = (payload) => apiPost('/analytics/definitions', payload)
export const updateAnalyticsDefinition = (id, payload) => apiPut(`/analytics/definitions/${id}`, payload)
export const deleteAnalyticsDefinition = (id) => apiDelete(`/analytics/definitions/${id}`)
export const duplicateAnalyticsDefinition = (id) => apiPost(`/analytics/definitions/${id}/duplicate`, {})
export const publishAnalyticsDefinition = (id, published) =>
  apiPost(`/analytics/definitions/${id}/publish`, { published })
export const revertAnalyticsDefinition = (id, payload) =>
  apiPost(`/analytics/definitions/${id}/revert`, payload)
export const getAnalyticsVersions = (id) => apiGet(`/analytics/definitions/${id}/versions`)
export const getMyAnalyticsDashboards = () => apiGet('/analytics/my-dashboards')
export const getMyAnalyticsDashboard = (id) => apiGet(`/analytics/my-dashboards/${id}`)
export const runAnalyticsPreview = (definition, params = {}, visualIds = null) =>
  apiPost('/analytics/run-preview', {
    definition,
    params,
    ...(Array.isArray(visualIds) ? { visual_ids: visualIds } : {}),
  })
export const runAnalyticsDashboard = (id, params = {}) =>
  apiPost(`/analytics/my-dashboards/${id}/run-batch`, params)
export const getAnalyticsSlicerValues = (id, payload = {}) =>
  apiPost(`/analytics/my-dashboards/${id}/slicer-values`, payload)
export const getAnalyticsDefinitionSlicerValues = (id, payload = {}) =>
  apiPost(`/analytics/definitions/${id}/slicer-values`, payload)
export const getAnalyticsVisualRecords = (id, visualId, payload = {}) =>
  apiPost(`/analytics/my-dashboards/${id}/visual/${encodeURIComponent(visualId)}/records`, payload)

async function downloadAnalyticsBlob(endpoint, bodyPayload, fallbackFilename) {
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
      body: JSON.stringify(bodyPayload),
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
      // Keep generic message when response is not JSON.
    }
    throw new Error(message)
  }
  const blob = await response.blob()
  const disposition = response.headers.get('content-disposition') || ''
  const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || fallbackFilename
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

export const exportAnalyticsVisual = (id, visualId, params = {}, format = 'xlsx') =>
  downloadAnalyticsBlob(
    `/analytics/my-dashboards/${id}/visual/${encodeURIComponent(visualId)}/export`,
    { ...params, format },
    `analytics_visual.${format}`
  )

export const exportAnalyticsWorkbook = (id, params = {}) =>
  downloadAnalyticsBlob(
    `/analytics/my-dashboards/${id}/export-workbook`,
    { ...params, format: 'xlsx' },
    `analytics_dashboard_${id}.xlsx`
  )
