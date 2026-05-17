import { apiDelete, apiGet, apiPost, apiPut } from './apiClient'

const convertAssetFromApi = (asset) => {
  return {
    id: asset.id,
    assetName: asset.asset_name,
    assetCode: asset.asset_code,
    assetScope: asset.asset_scope,
    assetTypeCode: asset.asset_type_code,
    locationCode: asset.location_code || '',
    serialNumber: asset.serial_number || '',
    manufacturer: asset.manufacturer || '',
    model: asset.model || '',
    commissionDate: asset.commission_date || '',
    description: asset.description || '',
    status: asset.status,
    createdAt: asset.created_at,
    updatedAt: asset.updated_at,
  }
}

const convertAssetToApi = (asset) => {
  return {
    asset_name: asset.assetName,
    asset_code: asset.assetCode,
    asset_scope: asset.assetScope,
    asset_type_code: asset.assetTypeCode,
    location_code:
      asset.locationCode && asset.locationCode.trim() !== ''
        ? asset.locationCode
        : null,
    serial_number: asset.serialNumber,
    manufacturer: asset.manufacturer,
    model: asset.model,
    commission_date:
      asset.commissionDate && asset.commissionDate.trim() !== ''
        ? asset.commissionDate
        : null,
    description: asset.description,
    status: asset.status,
  }
}

export const getAssets = async () => {
  const data = await apiGet('/assets')
  return data.map(convertAssetFromApi)
}

export const createAsset = async (asset) => {
  const data = await apiPost('/assets', convertAssetToApi(asset))
  return convertAssetFromApi(data)
}

export const updateAsset = async (assetId, asset) => {
  const data = await apiPut(`/assets/${assetId}`, convertAssetToApi(asset))
  return convertAssetFromApi(data)
}

export const deleteAsset = async (assetId) => {
  return apiDelete(`/assets/${assetId}`)
}