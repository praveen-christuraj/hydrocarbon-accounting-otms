import { apiDelete, apiGet, apiPost, apiPut } from './apiClient'

const normalizeTimeForInput = (value) => {
  if (!value) {
    return ''
  }

  return String(value).slice(0, 5)
}

const normalizeTimeForApi = (value) => {
  if (!value) {
    return ''
  }

  const text = String(value).trim()

  if (text.length === 5) {
    return `${text}:00`
  }

  return text
}

const convertSettingFromApi = (item) => {
  return {
    id: item.id,
    locationCode: item.location_code || '',
    locationName: item.location_name || '',
    dayStartTime: normalizeTimeForInput(item.day_start_time),
    dayEndTime: normalizeTimeForInput(item.day_end_time),
    effectiveFrom: item.effective_from || '',
    effectiveTo: item.effective_to || '',
    timezoneName: item.timezone_name || 'Africa/Lagos',
    description: item.description || '',
    status: item.status || 'Active',
    createdAt: item.created_at,
    updatedAt: item.updated_at,
  }
}

const convertSettingToApi = (setting) => {
  return {
    location_code: String(setting.locationCode || '').trim(),
    day_start_time: normalizeTimeForApi(setting.dayStartTime),
    day_end_time: normalizeTimeForApi(setting.dayEndTime),
    effective_from: setting.effectiveFrom,
    effective_to:
      setting.effectiveTo && String(setting.effectiveTo).trim() !== ''
        ? setting.effectiveTo
        : null,
    timezone_name: setting.timezoneName || 'Africa/Lagos',
    description:
      setting.description && String(setting.description).trim() !== ''
        ? String(setting.description).trim()
        : null,
    status: setting.status || 'Active',
  }
}

export const getLocationAccountingDaySettings = async (filters = {}) => {
  const params = new URLSearchParams()

  if (filters.locationCode) {
    params.append('location_code', filters.locationCode)
  }

  if (filters.status) {
    params.append('status', filters.status)
  }

  const queryString = params.toString()

  const path = queryString
    ? `/location-accounting-day-settings?${queryString}`
    : '/location-accounting-day-settings'

  const data = await apiGet(path)

  return (data || []).map(convertSettingFromApi)
}

export const createLocationAccountingDaySetting = async (setting) => {
  const data = await apiPost(
    '/location-accounting-day-settings',
    convertSettingToApi(setting)
  )

  return convertSettingFromApi(data)
}

export const updateLocationAccountingDaySetting = async (settingId, setting) => {
  const data = await apiPut(
    `/location-accounting-day-settings/${settingId}`,
    convertSettingToApi(setting)
  )

  return convertSettingFromApi(data)
}

export const deleteLocationAccountingDaySetting = async (settingId) => {
  return apiDelete(`/location-accounting-day-settings/${settingId}`)
}