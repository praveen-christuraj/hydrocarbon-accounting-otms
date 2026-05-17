import { apiDelete, apiGet, apiPost, apiPut } from './apiClient'

const convertValueByDataType = (value, dataType) => {
  if (value === undefined || value === null) {
    return null
  }

  // IMPORTANT:
  // JSON values such as tank_gauging_payload must remain as real objects.
  // Do not convert them using String(value), otherwise they become "[object Object]".
  if (dataType === 'JSON') {
    if (typeof value === 'object') {
      return value
    }

    const cleanedJsonValue = String(value).trim()

    if (cleanedJsonValue === '') {
      return null
    }

    try {
      return JSON.parse(cleanedJsonValue)
    } catch {
      return cleanedJsonValue
    }
  }

  const cleanedValue = String(value).trim()

  if (cleanedValue === '') {
    return null
  }

  if (dataType === 'Number') {
    const numericValue = Number(cleanedValue)

    if (Number.isNaN(numericValue)) {
      return cleanedValue
    }

    return numericValue
  }

  if (dataType === 'Boolean') {
    if (cleanedValue.toLowerCase() === 'true') {
      return true
    }

    if (cleanedValue.toLowerCase() === 'false') {
      return false
    }

    if (cleanedValue.toLowerCase() === 'yes') {
      return true
    }

    if (cleanedValue.toLowerCase() === 'no') {
      return false
    }
  }

  return cleanedValue
}

const convertOperationEntryFromApi = (entry) => {
  const transaction = entry.transaction || {}

  return {
    id: transaction.id,
    operationNumber:
      transaction.operation_ticket_number ||
      transaction.ticket_number ||
      transaction.operation_number ||
      '',
    operationTicketNumber:
      transaction.operation_ticket_number ||
      transaction.ticket_number ||
      transaction.operation_number ||
      '',
    operationTypeCode: transaction.operation_type_code || '',
    operationTypeName: transaction.operation_type_name || '',
    operationTemplateId: entry.operation_template_id || '',
    operationTemplateName: entry.operation_template_name || '',
    primaryAssetCode: transaction.primary_asset_code || '',
    primaryAssetName: transaction.primary_asset_name || '',
    primaryAssetTypeCode: transaction.primary_asset_type_code || '',
    convoyNumber: transaction.convoy_number || '',
    originLocationCode: transaction.origin_location_code || '',
    originLocationName: transaction.origin_location_name || '',
    destinationLocationCode: transaction.destination_location_code || '',
    destinationLocationName: transaction.destination_location_name || '',
    senderLocationCode: transaction.sender_location_code || '',
    senderLocationName: transaction.sender_location_name || '',
    receiverLocationCode: transaction.receiver_location_code || '',
    receiverLocationName: transaction.receiver_location_name || '',
    operationDate: transaction.operation_date || '',
    operationStartDatetime: transaction.operation_start_datetime || '',
    operationEndDatetime: transaction.operation_end_datetime || '',
    productName: transaction.product_name || '',
    createdBy: transaction.created_by || '',
    remarks: transaction.remarks || '',
    status: transaction.status || 'Draft',
    createdAt: transaction.created_at,
    updatedAt: transaction.updated_at,
    values: (entry.values || []).map((value) => ({
      id: value.id,
      fieldCode: value.field_code,
      fieldName: value.field_name,
      fieldGroup: value.field_group,
      dataType: value.data_type,
      unit: value.unit || '',
      inputMode: value.input_mode,
      calculationRole: value.calculation_role,
      fieldValue: value.field_value ?? '',
      sortOrder: value.sort_order,
    })),
  }
}

const convertOperationEntryToApi = (entry) => {
  return {
    operation_template_id: Number(entry.operationTemplateId),
    transaction: {
      operation_type_code: entry.operationTypeCode,
      primary_asset_code: entry.primaryAssetCode,
      convoy_number: entry.convoyNumber || null,
      origin_location_code: entry.originLocationCode,
      destination_location_code: entry.destinationLocationCode || null,
      sender_location_code: entry.senderLocationCode || null,
      receiver_location_code: entry.receiverLocationCode || null,
      operation_date: entry.operationDate,
      operation_start_datetime: entry.operationStartDatetime || null,
      operation_end_datetime: entry.operationEndDatetime || null,
      product_name: entry.productName || null,
      created_by: entry.createdBy || null,
      remarks: entry.remarks || null,
      status: entry.status || 'Draft',
    },
    values: (entry.values || []).map((value) => ({
      field_code: value.fieldCode,
      field_value: convertValueByDataType(value.fieldValue, value.dataType),
    })),
  }
}

export const getOperationEntries = async () => {
  const data = await apiGet('/operation-entries')
  return data.map(convertOperationEntryFromApi)
}

export const createOperationEntry = async (entry) => {
  const data = await apiPost('/operation-entries', convertOperationEntryToApi(entry))
  return convertOperationEntryFromApi(data)
}

export const updateOperationEntry = async (entryId, entry) => {
  const data = await apiPut(
    `/operation-entries/${entryId}`,
    convertOperationEntryToApi(entry)
  )

  return convertOperationEntryFromApi(data)
}

export const deleteOperationEntry = async (entryId) => {
  return apiDelete(`/operation-entries/${entryId}`)
}