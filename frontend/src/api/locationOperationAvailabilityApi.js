import { apiDelete, apiGet, apiPost, apiPut } from './apiClient'

const convertAvailabilityFromApi = (item) => {
  return {
    id: item.id,
    locationCode: item.location_code,
    locationName: item.location_name || '',
    operationTypeCode: item.operation_type_code,
    operationTypeName: item.operation_type_name || '',
    status: item.status,
    remarks: item.remarks || '',
    createdAt: item.created_at,
    updatedAt: item.updated_at,
  }
}

const convertAvailabilityToApi = (item) => {
  return {
    location_code: item.locationCode,
    operation_type_code: item.operationTypeCode,
    status: item.status || 'Active',
    remarks: item.remarks || null,
  }
}

export const getLocationOperationAvailability = async () => {
  const data = await apiGet('/location-operation-availability')
  return data.map(convertAvailabilityFromApi)
}

export const createLocationOperationAvailability = async (availability) => {
  const data = await apiPost(
    '/location-operation-availability',
    convertAvailabilityToApi(availability)
  )

  return convertAvailabilityFromApi(data)
}

export const updateLocationOperationAvailability = async (
  availabilityId,
  availability
) => {
  const data = await apiPut(
    `/location-operation-availability/${availabilityId}`,
    convertAvailabilityToApi(availability)
  )

  return convertAvailabilityFromApi(data)
}

export const deleteLocationOperationAvailability = async (availabilityId) => {
  return apiDelete(`/location-operation-availability/${availabilityId}`)
}