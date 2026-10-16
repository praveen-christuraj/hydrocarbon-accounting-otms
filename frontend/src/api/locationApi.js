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
  const { skip = 0, limit = 200, search = '', all_locations = false, allLocations = false } = params
  let endpoint = `/locations?skip=${skip}&limit=${limit}`
  if (search) endpoint += `&search=${encodeURIComponent(search)}`
  if (all_locations || allLocations) endpoint += `&all_locations=true`
  const data = await apiGet(endpoint)
  return {
    items: (data.items || []).map(convertLocationFromApi),
    total: data.total || 0,
    skip: data.skip || 0,
    limit: data.limit || limit,
    has_more: data.has_more || false,
  }
}

/**
 * Load the whole location master (every location in the system, not only the
 * ones the signed-in user is assigned to), paged.
 *
 * The API caps a single page at 200 rows. Operation Entry needs the complete
 * list to populate the Destination / Receiver dropdowns, because a ticket can
 * be addressed to any terminal. Asking for a bigger page in one call used to
 * be rejected with a 422 - and because the caller swallowed the error, the
 * dropdowns silently fell back to the user's own location only. Pages are
 * therefore fetched until `has_more` is false.
 */
export const getAllLocations = async () => {
  const pageSize = 200
  const items = []
  let skip = 0
  // Hard stop protects against a misbehaving API returning has_more forever.
  for (let page = 0; page < 50; page += 1) {
    const result = await getLocations({
      skip,
      limit: pageSize,
      all_locations: true,
    })
    items.push(...result.items)
    if (!result.has_more || result.items.length === 0) {
      return { items, total: result.total || items.length }
    }
    skip += result.items.length
  }
  return { items, total: items.length }
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