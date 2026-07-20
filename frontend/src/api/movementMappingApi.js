import { apiDelete, apiGet, apiPost } from './apiClient'

const buildQuery = (filters = {}) => {
  const params = new URLSearchParams()
  Object.entries(filters).forEach(([k, v]) => {
    const val = String(v ?? '').trim()
    if (val) params.append(k, val)
  })
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

export const getMovementMappings = async (filters = {}) => {
  return apiGet(`/movement-mappings${buildQuery(filters)}`)
}

export const getMovementMapping = async (id) => {
  return apiGet(`/movement-mappings/${id}`)
}

export const createMovementMapping = async (payload) => {
  return apiPost('/movement-mappings', payload)
}

export const addMovementMappingItems = async (mappingId, payload) => {
  return apiPost(`/movement-mappings/${mappingId}/items`, payload)
}

export const removeMovementMappingItem = async (mappingId, itemId) => {
  return apiDelete(`/movement-mappings/${mappingId}/items/${itemId}`)
}

export const closeMovementMapping = async (mappingId) => {
  return apiPost(`/movement-mappings/${mappingId}/close`, {})
}