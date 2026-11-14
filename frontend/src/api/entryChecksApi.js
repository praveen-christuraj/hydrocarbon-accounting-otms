import { apiGet, apiPost } from './apiClient'

export const previewEntryChecks = (payload) =>
  apiPost('/entry-checks/preview', payload)

export const bulkPreviewEntryChecks = (payload) =>
  apiPost('/entry-checks/bulk-preview', payload)

export const getTransactionEntryChecks = (transactionId) =>
  apiGet(`/entry-checks/transactions/${transactionId}`)

export const keepEntryCheckAsEntered = (payload) =>
  apiPost('/entry-checks/reviews', payload)

export const reopenEntryCheck = (payload) =>
  apiPost('/entry-checks/reviews/reopen', payload)

export const getOpenTicketAbnormalities = (locationCode = '', limit = 40) => {
  const params = new URLSearchParams()
  if (locationCode) params.set('location_code', locationCode)
  params.set('limit', String(limit))
  return apiGet(`/entry-checks/open-summary?${params.toString()}`)
}
