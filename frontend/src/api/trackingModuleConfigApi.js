import { apiDelete, apiGet, apiPost, apiPut } from './apiClient'

const convertConfigFromApi = (item) => ({
  id: item.id,
  moduleCode: item.module_code,
  moduleLabel: item.module_label || '',
  operationTypeCode: item.operation_type_code,
  operationTypeName: item.operation_type_name || '',
  movementRole: item.movement_role,
  trackingStage: item.tracking_stage || '',
  status: item.status,
  remarks: item.remarks || '',
  createdBy: item.created_by || '',
  updatedBy: item.updated_by || '',
  createdAt: item.created_at,
  updatedAt: item.updated_at,
})

const convertConfigToApi = (item) => ({
  module_code: item.moduleCode,
  operation_type_code: item.operationTypeCode,
  movement_role: item.movementRole,
  tracking_stage: item.trackingStage || null,
  status: item.status || 'Active',
  remarks: item.remarks || null,
})

export const getTrackingModuleCatalog = async () => {
  return apiGet('/tracking-module-configs/catalog')
}

export const getTrackingModuleConfigs = async () => {
  const data = await apiGet('/tracking-module-configs')
  return data.map(convertConfigFromApi)
}

export const createTrackingModuleConfig = async (config) => {
  const data = await apiPost('/tracking-module-configs', convertConfigToApi(config))
  return convertConfigFromApi(data)
}

export const updateTrackingModuleConfig = async (configId, config) => {
  const data = await apiPut(`/tracking-module-configs/${configId}`, convertConfigToApi(config))
  return convertConfigFromApi(data)
}

export const deleteTrackingModuleConfig = async (configId) => {
  return apiDelete(`/tracking-module-configs/${configId}`)
}
