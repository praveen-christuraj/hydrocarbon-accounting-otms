import { apiDelete, apiGet, apiPut } from './apiClient'

const convertUserLocationFromApi = (item) => {
  return {
    id: item.id,
    userId: item.user_id,
    fullName: item.full_name,
    username: item.username,
    locationCode: item.location_code,
    locationName: item.location_name,
    createdAt: item.created_at,
  }
}

const convertUserLocationSummaryFromApi = (item) => {
  return {
    userId: item.user_id,
    fullName: item.full_name,
    username: item.username,
    allLocationsAccess: item.all_locations_access,
    locationCodes: item.location_codes || [],
  }
}

export const getUserLocationAssignments = async () => {
  const data = await apiGet('/user-locations')
  return data.map(convertUserLocationFromApi)
}

export const getUserLocationSummaries = async () => {
  const data = await apiGet('/user-locations/users')
  return data.map(convertUserLocationSummaryFromApi)
}

export const getUserLocationDetail = async (userId) => {
  const data = await apiGet(`/user-locations/${userId}`)
  return convertUserLocationSummaryFromApi(data)
}

export const saveUserLocations = async (userId, locationCodes) => {
  const data = await apiPut(`/user-locations/${userId}`, {
    location_codes: locationCodes,
  })
  return convertUserLocationSummaryFromApi(data)
}

export const updateUserAllLocationsAccess = async (userId, allLocationsAccess) => {
  const data = await apiPut(`/user-locations/${userId}/all-locations-access`, {
    all_locations_access: allLocationsAccess,
  })
  return convertUserLocationSummaryFromApi(data)
}

export const deleteUserLocation = async (assignmentId) => {
  return apiDelete(`/user-locations/${assignmentId}`)
}
