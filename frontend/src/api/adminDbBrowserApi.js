import { apiGet } from './apiClient'

export const getDbTables = () => apiGet('/admin/db/tables')

export const getDbTableData = (tableName, page = 1, perPage = 50) =>
  apiGet(`/admin/db/tables/${encodeURIComponent(tableName)}?page=${page}&per_page=${perPage}`)
