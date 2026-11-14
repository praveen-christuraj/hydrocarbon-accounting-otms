import { apiDelete, apiGet, apiPost, apiPut } from './apiClient'

export const getAssistantOverview = (route = '') => {
  const qs = route ? `?route=${encodeURIComponent(route)}` : ''
  return apiGet(`/assistant/overview${qs}`)
}

export const askAssistant = ({ question, route = '', locationCode = '' }) =>
  apiPost('/assistant/ask', {
    question,
    route,
    location_code: locationCode || null,
  })

export const getAssistantHistory = (limit = 30) =>
  apiGet(`/assistant/history?limit=${encodeURIComponent(limit)}`)

export const listAssistantMemory = (includeInactive = false) =>
  apiGet(`/assistant/memory?include_inactive=${includeInactive ? 'true' : 'false'}`)

export const createAssistantMemory = (payload) =>
  apiPost('/assistant/memory', payload)

export const updateAssistantMemory = (memoryId, payload) =>
  apiPut(`/assistant/memory/${memoryId}`, payload)

export const deleteAssistantMemory = (memoryId) =>
  apiDelete(`/assistant/memory/${memoryId}`)
