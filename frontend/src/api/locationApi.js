import { apiDelete, apiGet, apiPost, apiPut } from './apiClient'

const convertLocationFromApi = (location) => {
  return {
    id: location.id,
    locationName: location.location_name,
    locationCode: location.location_code,
    locationType: location.location_type,
    parentLocation: location.parent_location_code || '',
    description: location.description || '',
    status: location.status,
    createdAt: location.created_at,
    updatedAt: location.updated_at,
  }
}

const convertLocationToApi = (location) => {
  return {
    location_name: location.locationName,
    location_code: location.locationCode,
    location_type: location.locationType,
    parent_location_code:
      location.parentLocation && location.parentLocation.trim() !== ''
        ? location.parentLocation
        : null,
    description: location.description,
    status: location.status,
  }
}

export const getLocations = async (params = {}) => {
  const { skip = 0, limit = 200, search = '' } = params
  let endpoint = `/locations?skip=${skip}&limit=${limit}`
  if (search) endpoint += `&search=${encodeURIComponent(search)}`
  const data = await apiGet(endpoint)
  return {
    items: (data.items || []).map(convertLocationFromApi),
    total: data.total || 0,
    skip: data.skip || 0,
    limit: data.limit || limit,
    has_more: data.has_more || false,
  }
}

export const createLocation = async (location) => {
  const data = await apiPost('/locations', convertLocationToApi(location))
  return convertLocationFromApi(data)
}

export const updateLocation = async (locationId, location) => {
  const data = await apiPut(
    `/locations/${locationId}`,
    convertLocationToApi(location)
  )

  return convertLocationFromApi(data)
}

export const deleteLocation = async (locationId) => {
  return apiDelete(`/locations/${locationId}`)
}