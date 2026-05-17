import { apiDelete, apiGet, apiPost, apiPut } from './apiClient'

const convertAssetTypeFromApi = (assetType) => {
  return {
    id: assetType.id,
    assetTypeName: assetType.asset_type_name,
    assetTypeCode: assetType.asset_type_code,
    description: assetType.description || '',
    status: assetType.status,
    createdAt: assetType.created_at,
    updatedAt: assetType.updated_at,
  }
}

const convertAssetTypeToApi = (assetType) => {
  return {
    asset_type_name: assetType.assetTypeName,
    asset_type_code: assetType.assetTypeCode,
    description: assetType.description,
    status: assetType.status,
  }
}

export const getAssetTypes = async () => {
  const data = await apiGet('/asset-types')
  return data.map(convertAssetTypeFromApi)
}

export const createAssetType = async (assetType) => {
  const data = await apiPost('/asset-types', convertAssetTypeToApi(assetType))
  return convertAssetTypeFromApi(data)
}

export const updateAssetType = async (assetTypeId, assetType) => {
  const data = await apiPut(
    `/asset-types/${assetTypeId}`,
    convertAssetTypeToApi(assetType)
  )

  return convertAssetTypeFromApi(data)
}

export const deleteAssetType = async (assetTypeId) => {
  return apiDelete(`/asset-types/${assetTypeId}`)
}