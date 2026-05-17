import { apiGet, apiPost } from './apiClient'

const normalizeRowFromApi = (row) => {
  return {
    id: row.id,
    assetCode: row.asset_code,
    tankId: row.tank_id,
    sealPosition: row.seal_position,
    sealNumber: row.seal_number,
    remarks: row.remarks || '',
    status: row.status,
    effectiveDate: row.effective_date || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export const getBargeSealMaster = async (assetCode, effectiveDate = null) => {
  const asset = String(assetCode || '').trim()
  if (!asset) throw new Error('assetCode is required')

  const params = new URLSearchParams()
  params.set('asset_code', asset)

  // If you later want date-based versions, pass YYYY-MM-DD here
  if (effectiveDate) {
    params.set('effective_date', effectiveDate)
  }

  const data = await apiGet(`/barge-seal-master?${params.toString()}`)
  return (data || []).map(normalizeRowFromApi)
}

export const bulkSaveBargeSealMaster = async ({
  assetCode,
  effectiveDate = null,
  rows,
}) => {
  const asset = String(assetCode || '').trim()
  if (!asset) throw new Error('assetCode is required')

  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('At least one seal row is required')
  }

  const payload = {
    asset_code: asset,
    effective_date: effectiveDate || null,
    rows: rows.map((r) => ({
      tank_id: String(r.tankId || '').trim(),
      seal_position: String(r.sealPosition || '').trim().toUpperCase(),
      seal_number: String(r.sealNumber || '').trim(),
      remarks: r.remarks && String(r.remarks).trim() !== '' ? String(r.remarks).trim() : null,
      status: r.status || 'Active',
    })),
  }

  const data = await apiPost('/barge-seal-master/bulk', payload)
  return (data || []).map(normalizeRowFromApi)
}