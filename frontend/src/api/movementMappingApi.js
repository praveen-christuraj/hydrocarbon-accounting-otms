import { apiDelete, apiGet, apiPatch, apiPost } from './apiClient'

const buildQuery = (filters = {}) => {
  const params = new URLSearchParams()
  Object.entries(filters).forEach(([key, value]) => {
    if (value === null || value === undefined || String(value).trim() === '') return
    params.append(key, String(value).trim())
  })
  const query = params.toString()
  return query ? `?${query}` : ''
}

export const getMovementMappings = async (filters = {}) =>
  apiGet(`/movement-mappings${buildQuery(filters)}`)

export const getMovementMapping = async (id) =>
  apiGet(`/movement-mappings/${id}`)

export const createMovementMapping = async (payload) =>
  apiPost('/movement-mappings', payload)

export const updateMovementMapping = async (mappingId, payload) =>
  apiPatch(`/movement-mappings/${mappingId}`, payload)

export const addMovementMappingItems = async (mappingId, payload) =>
  apiPost(`/movement-mappings/${mappingId}/items`, payload)

export const removeMovementMappingItem = async (mappingId, itemId) =>
  apiDelete(`/movement-mappings/${mappingId}/items/${itemId}`)

export const closeMovementMapping = async (mappingId) =>
  apiPost(`/movement-mappings/${mappingId}/close`, {})

// The API preserves deleted mapping history by archiving it (soft delete).
export const deleteMovementMapping = async (mappingId) =>
  apiDelete(`/movement-mappings/${mappingId}`)

export const restoreMovementMapping = async (mappingId) =>
  apiPost(`/movement-mappings/${mappingId}/restore`, {})
