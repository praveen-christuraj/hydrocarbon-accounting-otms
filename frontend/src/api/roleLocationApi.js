import { apiGet, apiPut } from './apiClient'

/**
 * Per-role location scope (PERMISSION_CRITERIA_MODEL.md section 7.2).
 *
 * Location scope is additive: a user's effective scope is the union of the
 * locations assigned to the user and the locations of every active role the
 * user holds.
 */
const convertRoleLocationFromApi = (item) => {
  return {
    roleId: item.role_id,
    roleName: item.role_name,
    status: item.status || 'Active',
    locationCodes: item.location_codes || [],
  }
}

export const getRoleLocationSummaries = async () => {
  const data = await apiGet('/role-locations')
  return (data || []).map(convertRoleLocationFromApi)
}

export const getRoleLocationDetail = async (roleId) => {
  const data = await apiGet(`/role-locations/${roleId}`)
  return convertRoleLocationFromApi(data)
}

export const saveRoleLocations = async (roleId, locationCodes) => {
  const data = await apiPut(`/role-locations/${roleId}`, {
    location_codes: locationCodes,
  })
  return convertRoleLocationFromApi(data)
}
