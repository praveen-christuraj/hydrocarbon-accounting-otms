import { apiDelete, apiGet, apiPost, apiPut } from './apiClient'

const buildQuery = (filters = {}) => {
  const params = new URLSearchParams()
  Object.entries(filters).forEach(([k, v]) => {
    const val = String(v ?? '').trim()
    if (val) params.append(k, val)
  })
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

export const getVesselOperations = async (filters = {}) => {
  return apiGet(`/vessel-operations${buildQuery(filters)}`)
}

export const createVesselOperation = async (payload) => {
  return apiPost('/vessel-operations', payload)
}

export const updateVesselOperation = async (id, payload) => {
  return apiPut(`/vessel-operations/${id}`, payload)
}

export const deleteVesselOperation = async (id) => {
  return apiDelete(`/vessel-operations/${id}`)
}