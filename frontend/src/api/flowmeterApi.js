import { apiDelete, apiGet, apiPost, apiPut } from './apiClient'

const convertConfigFromApi = (row) => ({
  id: row.id,
  locationCode: row.location_code,
  locationName: row.location_name || '',
  assetCode: row.asset_code,
  assetName: row.asset_name || '',
  streamName: row.stream_name || 'Default',
  meterAssetCode: row.meter_asset_code || '',
  meterAssetName: row.meter_asset_name || '',
  meterLabel: row.meter_label,
  meterFactor: Number(row.meter_factor || 0),
  meterUnit: row.meter_unit || 'bbls',
  calibrationDate: row.calibration_date || '',
  remarks: row.remarks || '',
  status: row.status || 'Active',
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

const convertRecordFromApi = (row) => ({
  id: row.id,
  locationCode: row.location_code,
  locationName: row.location_name || '',
  assetCode: row.asset_code,
  assetName: row.asset_name || '',
  streamName: row.stream_name || 'Default',
  meterLabel: row.meter_label,
  readingDate: row.reading_date,
  openingReading: Number(row.opening_reading || 0),
  closingReading: Number(row.closing_reading || 0),
  grossObserved: Number(row.gross_observed || 0),
  meterFactor: Number(row.meter_factor || 0),
  meterUnit: row.meter_unit || 'bbls',
  netStandard: Number(row.net_standard || 0),
  netStandardBbl: Number(row.net_standard_bbl || 0),
  remarks: row.remarks || '',
  status: row.status || 'Active',
  createdBy: row.created_by || '',
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

export const getFlowmeterConfigs = async ({ locationCode = '', assetCode = '', streamName = '' } = {}) => {
  const params = new URLSearchParams()
  if (String(locationCode || '').trim()) params.set('location_code', String(locationCode).trim())
  if (String(assetCode || '').trim()) params.set('asset_code', String(assetCode).trim())
  if (String(streamName || '').trim()) params.set('stream_name', String(streamName).trim())
  const data = await apiGet(`/flowmeter/configs${params.toString() ? `?${params.toString()}` : ''}`)
  return (data || []).map(convertConfigFromApi)
}

export const createFlowmeterConfig = async (payload) => {
  const data = await apiPost('/flowmeter/configs', {
    location_code: payload.locationCode,
    asset_code: payload.assetCode,
    stream_name: payload.streamName || 'Default',
    meter_asset_code: payload.meterAssetCode || null,
    meter_label: payload.meterLabel,
    meter_factor: Number(payload.meterFactor || 0),
    meter_unit: payload.meterUnit,
    calibration_date: payload.calibrationDate || null,
    remarks: payload.remarks && String(payload.remarks).trim() ? String(payload.remarks).trim() : null,
    status: payload.status || 'Active',
  })
  return convertConfigFromApi(data)
}

export const updateFlowmeterConfig = async (id, payload) => {
  const data = await apiPut(`/flowmeter/configs/${id}`, {
    location_code: payload.locationCode,
    asset_code: payload.assetCode,
    stream_name: payload.streamName || 'Default',
    meter_asset_code: payload.meterAssetCode || null,
    meter_label: payload.meterLabel,
    meter_factor: Number(payload.meterFactor || 0),
    meter_unit: payload.meterUnit,
    calibration_date: payload.calibrationDate || null,
    remarks: payload.remarks && String(payload.remarks).trim() ? String(payload.remarks).trim() : null,
    status: payload.status || 'Active',
  })
  return convertConfigFromApi(data)
}

export const deleteFlowmeterConfig = async (id) => apiDelete(`/flowmeter/configs/${id}`)

export const getFlowmeterRecords = async (filters = {}) => {
  const params = new URLSearchParams()
  if (String(filters.locationCode || '').trim()) params.set('location_code', String(filters.locationCode).trim())
  if (String(filters.assetCode || '').trim()) params.set('asset_code', String(filters.assetCode).trim())
  if (String(filters.streamName || '').trim()) params.set('stream_name', String(filters.streamName).trim())
  if (String(filters.meterLabel || '').trim()) params.set('meter_label', String(filters.meterLabel).trim())
  if (String(filters.dateFrom || '').trim()) params.set('date_from', String(filters.dateFrom).trim())
  if (String(filters.dateTo || '').trim()) params.set('date_to', String(filters.dateTo).trim())
  const data = await apiGet(`/flowmeter/records${params.toString() ? `?${params.toString()}` : ''}`)
  return (data || []).map(convertRecordFromApi)
}

export const createFlowmeterRecord = async (payload) => {
  const data = await apiPost('/flowmeter/records', {
    location_code: payload.locationCode,
    asset_code: payload.assetCode,
    meter_label: payload.meterLabel,
    reading_date: payload.readingDate,
    opening_reading: Number(payload.openingReading || 0),
    closing_reading: Number(payload.closingReading || 0),
    meter_factor: Number(payload.meterFactor || 0),
    meter_unit: payload.meterUnit,
    remarks: payload.remarks && String(payload.remarks).trim() ? String(payload.remarks).trim() : null,
    status: payload.status || 'Active',
  })
  return convertRecordFromApi(data)
}

export const getFlowmeterConfigHistory = async ({ assetCode = '', streamName = '', meterLabel = '' } = {}) => {
  const params = new URLSearchParams()
  if (String(assetCode || '').trim()) params.set('asset_code', String(assetCode).trim())
  if (String(streamName || '').trim()) params.set('stream_name', String(streamName).trim())
  if (String(meterLabel || '').trim()) params.set('meter_label', String(meterLabel).trim())
  const data = await apiGet(`/flowmeter/configs/history${params.toString() ? `?${params.toString()}` : ''}`)
  return (data || []).map((row) => ({
    id: row.id,
    configId: row.config_id,
    locationCode: row.location_code,
    assetCode: row.asset_code,
    streamName: row.stream_name || 'Default',
    meterAssetCode: row.meter_asset_code || '',
    meterLabel: row.meter_label,
    oldMeterFactor: row.old_meter_factor,
    newMeterFactor: row.new_meter_factor,
    oldMeterUnit: row.old_meter_unit,
    newMeterUnit: row.new_meter_unit,
    oldCalibrationDate: row.old_calibration_date || null,
    newCalibrationDate: row.new_calibration_date || null,
    oldStatus: row.old_status,
    newStatus: row.new_status,
    changeAction: row.change_action,
    changedBy: row.changed_by || '',
    remarks: row.remarks || '',
    changedAt: row.changed_at,
  }))
}
