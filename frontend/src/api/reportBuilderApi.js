import { apiDelete, apiGet, apiPost, apiPut, API_BASE_URL } from './apiClient'
import { clearAccessToken, getStoredAccessToken } from './authToken'
import { refreshAccessToken } from './authApi'

/** Report Builder (Configurations) + Custom Reports (Reporting) API. */

export const getReportCatalog = () => apiGet('/report-builder/catalog')

export const getReportLookups = () => apiGet('/report-builder/lookups')

export const getOperationFields = (operationTypeCodes = []) => {
  const query = operationTypeCodes.length
    ? `?operation_type_codes=${encodeURIComponent(operationTypeCodes.join(','))}`
    : ''
  return apiGet(`/report-builder/operation-fields${query}`)
}

export const discoverJsonPaths = (request) => apiPost('/report-builder/json-paths', request)

export const validateReportFormula = (formula, columnKeys = []) =>
  apiPost('/report-builder/formula/validate', { formula, column_keys: columnKeys })

export const getStarterTemplates = () => apiGet('/report-builder/starter-templates')

export const createFromStarter = (starterId, reportName) =>
  apiPost('/report-builder/definitions/from-starter', {
    starter_id: starterId,
    report_name: reportName || null,
  })

export const getReportDefinitions = () => apiGet('/report-builder/definitions')

export const getReportDefinition = (reportId) => apiGet(`/report-builder/definitions/${reportId}`)

export const createReportDefinition = (payload) => apiPost('/report-builder/definitions', payload)

export const updateReportDefinition = (reportId, payload) =>
  apiPut(`/report-builder/definitions/${reportId}`, payload)

export const deleteReportDefinition = (reportId) => apiDelete(`/report-builder/definitions/${reportId}`)

export const duplicateReportDefinition = (reportId) =>
  apiPost(`/report-builder/definitions/${reportId}/duplicate`, {})

export const publishReportDefinition = (reportId, published) =>
  apiPost(`/report-builder/definitions/${reportId}/publish`, { published })

export const getReportVersions = (reportId) => apiGet(`/report-builder/definitions/${reportId}/versions`)

export const runReportPreview = (definition, run = {}) =>
  apiPost('/report-builder/run-preview', { definition, ...run })

export const runSavedReport = (reportId, run = {}) =>
  apiPost(`/report-builder/definitions/${reportId}/run`, run)

export const getMyReports = () => apiGet('/report-builder/my-reports')

export const getMyReport = (reportId) => apiGet(`/report-builder/my-reports/${reportId}`)

export const runMyReport = (reportId, run = {}) => apiPost(`/report-builder/my-reports/${reportId}/run`, run)

/** POST download (server export of the full result set), with token refresh. */
export const exportMyReport = async (reportId, run = {}, format = 'xlsx') => {
  const endpoint = `/report-builder/my-reports/${reportId}/export`
  const doFetch = () => {
    const token = getStoredAccessToken()
    return fetch(`${API_BASE_URL}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ ...run, format }),
    })
  }

  let response = await doFetch()
  if (response.status === 401) {
    const refreshed = await refreshAccessToken()
    if (!refreshed) {
      clearAccessToken()
      throw new Error('Session expired. Please login again.')
    }
    response = await doFetch()
  }
  if (!response.ok) {
    let message = 'Export failed'
    try {
      const data = await response.json()
      message = data?.detail || message
    } catch {
      // keep generic message
    }
    throw new Error(message)
  }
  const blob = await response.blob()
  const disposition = response.headers.get('content-disposition') || ''
  const match = disposition.match(/filename="?([^";]+)"?/i)
  const fileName = match?.[1] || `report.${format}`
  const url = window.URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  window.setTimeout(() => window.URL.revokeObjectURL(url), 1000)
  return fileName
}
