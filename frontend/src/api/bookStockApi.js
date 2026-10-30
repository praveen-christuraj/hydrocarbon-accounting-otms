import { apiDelete, apiGet, apiPost, apiPut } from './apiClient'

const buildQuery = (filters = {}) => {
  const params = new URLSearchParams()
  Object.entries(filters).forEach(([key, value]) => {
    const text = String(value ?? '').trim()
    if (text) params.append(key, text)
  })
  const query = params.toString()
  return query ? `?${query}` : ''
}

// Government Data — Book Stock Management

// Products
export const getBookStockProducts = async (filters = {}) =>
  apiGet(`/book-stock/products${buildQuery(filters)}`)
export const createBookStockProduct = async (payload) => apiPost('/book-stock/products', payload)
export const updateBookStockProduct = async (id, payload) => apiPut(`/book-stock/products/${id}`, payload)
export const deleteBookStockProduct = async (id) => apiDelete(`/book-stock/products/${id}`)

// Producing fields
export const getBookStockFields = async (filters = {}) =>
  apiGet(`/book-stock/fields${buildQuery(filters)}`)
export const createBookStockField = async (payload) => apiPost('/book-stock/fields', payload)
export const updateBookStockField = async (id, payload) => apiPut(`/book-stock/fields/${id}`, payload)
export const deleteBookStockField = async (id) => apiDelete(`/book-stock/fields/${id}`)

// General settings
// The API stores settings as key/value rows; the UI works with a flat map.
const settingsMap = (payload) => {
  if (!Array.isArray(payload)) return payload || {}
  return Object.fromEntries(payload.map((row) => [row.config_key, row.config_value]))
}

export const getBookStockSettings = async () => settingsMap(await apiGet('/book-stock/settings'))

export const updateBookStockSettings = async (settings) => {
  const rows = Object.entries(settings || {})
    .filter(([key]) => key !== 'updated_at')
    .map(([key, value]) => ({ config_key: key, config_value: value === null || value === undefined ? '' : String(value) }))
  return settingsMap(await apiPut('/book-stock/settings', { settings: rows }))
}

// Shared reference data (products, fields + the Export Operations configuration)
export const getBookStockReferenceData = async () => apiGet('/book-stock/reference-data')

// Export Operations configuration used by this module
export const getBookStockExportOperations = async () => apiGet('/book-stock/export-operations')

// Daily stock entries
export const getBookStockDailyEntries = async (filters = {}) =>
  apiGet(`/book-stock/daily-entries${buildQuery(filters)}`)
export const getBookStockDailyEntry = async (id) => apiGet(`/book-stock/daily-entries/${id}`)
export const createBookStockDailyEntry = async (payload) =>
  apiPost('/book-stock/daily-entries', payload)
export const updateBookStockDailyEntry = async (id, payload) =>
  apiPut(`/book-stock/daily-entries/${id}`, payload)
export const deleteBookStockDailyEntry = async (id) => apiDelete(`/book-stock/daily-entries/${id}`)
export const bulkUploadBookStockEntries = async (items) =>
  apiPost('/book-stock/daily-entries/bulk-upload', { items })
export const getBookStockOpeningSuggestion = async (params) =>
  apiGet(`/book-stock/daily-entries/opening${buildQuery(params)}`)

// Summaries & visualisations
export const getBookStockBlockSummary = async (filters = {}) =>
  apiGet(`/book-stock/block-summary${buildQuery(filters)}`)
export const getBookStockEntitySummary = async (filters = {}) =>
  apiGet(`/book-stock/entity-summary${buildQuery(filters)}`)
export const getBookStockDashboard = async (filters = {}) =>
  apiGet(`/book-stock/dashboard${buildQuery(filters)}`)
