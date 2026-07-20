import { apiGet, apiPost, apiPut } from './apiClient'

const buildQueryString = (params = {}) => {
  const sp = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => {
    const s = String(v ?? '').trim()
    if (s !== '') sp.append(k, s)
  })
  const qs = sp.toString()
  return qs ? `?${qs}` : ''
}

// --------------------
// Dashboard Configs
// --------------------
export const getDashboardConfigs = async (filters = {}) => {
  return apiGet(`/dashboard-configs${buildQueryString(filters)}`)
}

export const getDashboardConfig = async (configId) => {
  return apiGet(`/dashboard-configs/${configId}`)
}

export const createDashboardConfig = async (payload) => {
  return apiPost('/dashboard-configs', payload)
}

export const updateDashboardConfig = async (configId, payload) => {
  return apiPut(`/dashboard-configs/${configId}`, payload)
}

// --------------------
// Dashboard Versions
// --------------------
export const getDashboardVersions = async (configId) => {
  return apiGet(`/dashboard-configs/${configId}/versions`)
}

export const getDashboardVersion = async (versionId) => {
  return apiGet(`/dashboard-versions/${versionId}`)
}

// --------------------
// Publish / Revert
// --------------------
export const publishDashboard = async (configId, payload) => {
  // payload: { change_note, config_json }
  return apiPost(`/dashboard-configs/${configId}/publish`, payload)
}

export const revertDashboard = async (configId, payload) => {
  // payload: { version_id, change_note }
  return apiPost(`/dashboard-configs/${configId}/revert`, payload)
}