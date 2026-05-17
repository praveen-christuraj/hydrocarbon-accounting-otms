import { apiDelete, apiGet, apiPost } from './apiClient'

const convertTable11FactorFromApi = (row) => {
  return {
    id: row.id,
    api60: row.api60,
    ltFactor: row.lt_factor,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const convertLookupFromApi = (row) => {
  return {
    api60: row.api60,
    lowerApi60: row.lower_api60,
    upperApi60: row.upper_api60,
    ltFactor: row.lt_factor,
    lookupMethod: row.lookup_method,
  }
}

export const getTable11Factors = async () => {
  const data = await apiGet('/table11-factors')
  return data.map(convertTable11FactorFromApi)
}

export const bulkSaveTable11Factors = async (rows) => {
  const payload = {
    rows: rows.map((row) => ({
      api60: Number(row.api60),
      lt_factor: Number(row.ltFactor),
    })),
  }

  const data = await apiPost('/table11-factors/bulk', payload)
  return data.map(convertTable11FactorFromApi)
}

export const clearTable11Factors = async () => {
  return apiDelete('/table11-factors')
}

export const lookupTable11Factor = async (api60) => {
  const data = await apiGet(`/table11-factors/lookup?api60=${Number(api60)}`)
  return convertLookupFromApi(data)
}