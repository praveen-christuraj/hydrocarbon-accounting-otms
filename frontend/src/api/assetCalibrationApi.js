import { apiDelete, apiGet, apiPost, apiPut } from './apiClient'

const convertAssetCalibrationTableFromApi = (table) => {
  return {
    id: table.id,
    calibrationName: table.calibration_name,
    assetCode: table.asset_code,
    assetName: table.asset_name || '',
    templateId: table.template_id,
    templateName: table.template_name || '',
    effectiveDate: table.effective_date || '',
    remarks: table.remarks || '',
    status: table.status,
    createdAt: table.created_at,
    updatedAt: table.updated_at,
    rows: (table.rows || []).map((row) => ({
      id: row.id,
      rowNumber: row.row_number,
      rowData: row.row_data || {},
    })),
  }
}

const convertAssetCalibrationTableToApi = (table) => {
  const safeNumber = (v) => {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }

  return {
    calibration_name: table.calibrationName ?? table.calibration_name ?? '',
    asset_code: table.assetCode ?? table.asset_code ?? '',
    template_id: safeNumber(table.templateId ?? table.template_id) ?? 0,
    effective_date: table.effectiveDate ?? table.effective_date ?? null,
    remarks: table.remarks ?? null,
    status: table.status || 'Active',
    rows: (table.rows || []).map((row, index) => {
      const rowNumber =
        safeNumber(row.rowNumber ?? row.row_number) ?? index + 1

      const rowData =
        row.rowData ??
        row.row_data ??
        (row && typeof row === 'object' ? row : {})

      return {
        row_number: rowNumber,
        row_data: rowData,
      }
    }),
  }
}

export const getAssetCalibrationTables = async () => {
  const data = await apiGet('/asset-calibration-tables')
  return data.map(convertAssetCalibrationTableFromApi)
}

export const createAssetCalibrationTable = async (table) => {
  const data = await apiPost(
    '/asset-calibration-tables',
    convertAssetCalibrationTableToApi(table)
  )

  return convertAssetCalibrationTableFromApi(data)
}

export const updateAssetCalibrationTable = async (tableId, table) => {
  const data = await apiPut(
    `/asset-calibration-tables/${tableId}`,
    convertAssetCalibrationTableToApi(table)
  )

  return convertAssetCalibrationTableFromApi(data)
}

export const deleteAssetCalibrationTable = async (tableId) => {
  return apiDelete(`/asset-calibration-tables/${tableId}`)
}