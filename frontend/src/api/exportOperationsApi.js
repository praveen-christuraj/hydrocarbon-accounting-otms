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

// Locations
export const getExportLocations = async () => apiGet('/export-operations/locations')
export const createExportLocation = async (payload) => apiPost('/export-operations/locations', payload)
export const updateExportLocation = async (id, payload) => apiPut(`/export-operations/locations/${id}`, payload)
export const deleteExportLocation = async (id) => apiDelete(`/export-operations/locations/${id}`)

// Entities
export const getExportEntities = async (filters = {}) => apiGet(`/export-operations/entities${buildQuery(filters)}`)
export const createExportEntity = async (payload) => apiPost('/export-operations/entities', payload)
export const updateExportEntity = async (id, payload) => apiPut(`/export-operations/entities/${id}`, payload)
export const deleteExportEntity = async (id) => apiDelete(`/export-operations/entities/${id}`)

// Location-Entity mappings
export const getLocationEntities = async (filters = {}) => apiGet(`/export-operations/location-entities${buildQuery(filters)}`)
export const createLocationEntity = async (locationCode, entityCode) => apiPost(`/export-operations/location-entities?location_code=${encodeURIComponent(locationCode)}&entity_code=${encodeURIComponent(entityCode)}`)
export const deleteLocationEntity = async (id) => apiDelete(`/export-operations/location-entities/${id}`)

// Blocks
export const getExportBlocks = async (filters = {}) => apiGet(`/export-operations/blocks${buildQuery(filters)}`)
export const createExportBlock = async (payload) => apiPost('/export-operations/blocks', payload)
export const updateExportBlock = async (id, payload) => apiPut(`/export-operations/blocks/${id}`, payload)
export const deleteExportBlock = async (id) => apiDelete(`/export-operations/blocks/${id}`)

// Entity-Block mappings
export const getEntityBlocks = async (filters = {}) => apiGet(`/export-operations/entity-blocks${buildQuery(filters)}`)
export const createEntityBlock = async (entityCode, blockCode) => apiPost(`/export-operations/entity-blocks?entity_code=${encodeURIComponent(entityCode)}&block_code=${encodeURIComponent(blockCode)}`)
export const deleteEntityBlock = async (id) => apiDelete(`/export-operations/entity-blocks/${id}`)

// Permits
export const getExportPermits = async (filters = {}) => apiGet(`/export-operations/permits${buildQuery(filters)}`)
export const createExportPermit = async (payload) => apiPost('/export-operations/permits', payload)
export const updateExportPermit = async (id, payload) => apiPut(`/export-operations/permits/${id}`, payload)
export const deleteExportPermit = async (id) => apiDelete(`/export-operations/permits/${id}`)

// Transactions
export const getExportTransactions = async (filters = {}) => apiGet(`/export-operations/transactions${buildQuery(filters)}`)
export const createExportTransaction = async (payload) => apiPost('/export-operations/transactions', payload)
export const updateExportTransaction = async (id, payload) => apiPut(`/export-operations/transactions/${id}`, payload)
export const deleteExportTransaction = async (id) => apiDelete(`/export-operations/transactions/${id}`)

// Bulk Upload
export const bulkUploadExport = async (items) => apiPost('/export-operations/bulk-upload', { items })
export const bulkUploadPermits = async (items) => apiPost('/export-operations/permits/bulk-upload', { items })

// Consignees
export const getExportConsignees = async () => apiGet('/export-operations/consignees')
export const createExportConsignee = async (payload) => apiPost('/export-operations/consignees', payload)
export const updateExportConsignee = async (id, payload) => apiPut(`/export-operations/consignees/${id}`, payload)
export const deleteExportConsignee = async (id) => apiDelete(`/export-operations/consignees/${id}`)

// Configs
export const getExportConfigs = async () => apiGet('/export-operations/configs')
export const saveExportConfig = async (payload) => apiPost('/export-operations/configs', payload)

// Dashboard
export const getExportDashboard = async (filters = {}) => apiGet(`/export-operations/dashboard${buildQuery(filters)}`)

// Report
export const getExportReport = async (filters = {}) => apiGet(`/export-operations/report${buildQuery(filters)}`)
