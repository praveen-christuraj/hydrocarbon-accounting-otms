import { apiDelete, apiGet, apiPost, apiPut } from './apiClient'

const convertOperationTypeFromApi = (operationType) => {
  return {
    id: operationType.id,
    operationTypeName: operationType.operation_type_name,
    operationTypeCode: operationType.operation_type_code,
    operationCategory: operationType.operation_category,
    applicableAssetTypeCode: operationType.applicable_asset_type_code,
    requiresSenderLocation: operationType.requires_sender_location,
    requiresReceiverLocation: operationType.requires_receiver_location,
    requiresComparison: operationType.requires_comparison,

    // ✅ new field (backend uses this)
    // fallback keeps UI stable even if an older API response is encountered
    requiresApproval:
      operationType.requires_approval ??
      operationType.requires_destination_location ??
      'No',

    description: operationType.description || '',
    status: operationType.status,
    createdAt: operationType.created_at,
    updatedAt: operationType.updated_at,
  }
}

const convertOperationTypeToApi = (operationType) => {
  return {
    operation_type_name: operationType.operationTypeName,
    operation_type_code: operationType.operationTypeCode,
    operation_category: operationType.operationCategory,
    applicable_asset_type_code: operationType.applicableAssetTypeCode,
    requires_sender_location: operationType.requiresSenderLocation,
    requires_receiver_location: operationType.requiresReceiverLocation,
    requires_comparison: operationType.requiresComparison,

    // ✅ send correct field to backend
    requires_approval: operationType.requiresApproval,

    description: operationType.description || null,
    status: operationType.status || 'Active',
  }
}

export const getOperationTypes = async () => {
  const data = await apiGet('/operation-types')
  return data.map(convertOperationTypeFromApi)
}

export const createOperationType = async (operationType) => {
  const data = await apiPost(
    '/operation-types',
    convertOperationTypeToApi(operationType)
  )

  return convertOperationTypeFromApi(data)
}

export const updateOperationType = async (operationTypeId, operationType) => {
  const data = await apiPut(
    `/operation-types/${operationTypeId}`,
    convertOperationTypeToApi(operationType)
  )

  return convertOperationTypeFromApi(data)
}

export const deleteOperationType = async (operationTypeId) => {
  return apiDelete(`/operation-types/${operationTypeId}`)
}