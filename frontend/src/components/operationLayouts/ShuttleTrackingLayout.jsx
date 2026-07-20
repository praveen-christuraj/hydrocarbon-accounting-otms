import { useEffect, useMemo, useState } from 'react'
import { getVesselOperations } from '../../api/vesselOperationApi'

const parseObject = (value) => {
  if (!value) return null
  if (typeof value === 'object') return value
  if (typeof value === 'string') {
    try {
      return JSON.parse(value)
    } catch {
      return null
    }
  }
  return null
}

const safeNumber = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function ShuttleTrackingLayout({ entry, selectedAsset, handleValueChange }) {
  const [ops, setOps] = useState([])
  const [loadingOps, setLoadingOps] = useState(false)

  const [form, setForm] = useState({
    vessel_operation_code: '',
    event_time: '',
    opening_stock_bbl: '',
    opening_water_bbl: '',
    closing_stock_bbl: '',
    closing_water_bbl: '',
    barge_reference: '',
    remarks: '',
  })

  const currentPayload = useMemo(() => {
    const row = (entry.values || []).find(
      (v) => v.fieldCode === 'shuttle_payload'
    )
    return parseObject(row?.fieldValue)
  }, [entry.values])

  useEffect(() => {
    if (!currentPayload) return

    const meta = currentPayload.meta || {}
    const inputs = currentPayload.inputs || {}

    setForm({
      vessel_operation_code: meta.vessel_operation_code || '',
      event_time: inputs.event_time || '',
      opening_stock_bbl: inputs.opening_stock_bbl ?? '',
      opening_water_bbl: inputs.opening_water_bbl ?? '',
      closing_stock_bbl: inputs.closing_stock_bbl ?? '',
      closing_water_bbl: inputs.closing_water_bbl ?? '',
      barge_reference: inputs.barge_reference || '',
      remarks: inputs.remarks || '',
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const locationCode = String(entry.originLocationCode || '').trim()
    const assetTypeCode = String(selectedAsset?.assetTypeCode || '').trim()

    if (!locationCode || !assetTypeCode) {
      setOps([])
      return
    }

    const load = async () => {
      try {
        setLoadingOps(true)
        const data = await getVesselOperations({
          location_code: locationCode,
          applicable_asset_type_code: assetTypeCode,
          status: 'Active',
          show_in: 'Tracking',
        })
        setOps(Array.isArray(data) ? data : [])
      } catch (e) {
        alert(e.message || 'Unable to load Vessel Operations')
      } finally {
        setLoadingOps(false)
      }
    }

    load()
  }, [entry.originLocationCode, selectedAsset?.assetTypeCode])

  const selectedOp = useMemo(() => {
    return ops.find((o) => o.operation_code === form.vessel_operation_code)
  }, [ops, form.vessel_operation_code])

  const computed = useMemo(() => {
    const openingStock = safeNumber(form.opening_stock_bbl)
    const openingWater = safeNumber(form.opening_water_bbl)
    const closingStock = safeNumber(form.closing_stock_bbl)
    const closingWater = safeNumber(form.closing_water_bbl)

    const netStock = closingStock - openingStock // ✅ Net Stock is NSV (your rule)
    const netWater = closingWater - openingWater

    return {
      openingStock,
      openingWater,
      closingStock,
      closingWater,
      netStock,
      netWater,
    }
  }, [
    form.opening_stock_bbl,
    form.opening_water_bbl,
    form.closing_stock_bbl,
    form.closing_water_bbl,
  ])

  const updatePayload = (nextForm) => {
    const locationCode = String(entry.originLocationCode || '').trim()
    const shuttleNumber = String(entry.convoyNumber || '').trim() // shown as Shuttle Number in UI
    const shuttleAssetCode = String(entry.primaryAssetCode || '').trim()

    const openingStock = safeNumber(nextForm.opening_stock_bbl)
    const openingWater = safeNumber(nextForm.opening_water_bbl)
    const closingStock = safeNumber(nextForm.closing_stock_bbl)
    const closingWater = safeNumber(nextForm.closing_water_bbl)

    const netStock = closingStock - openingStock
    const netWater = closingWater - openingWater

    const payload = {
      meta: {
        schema: 'shuttle_payload_v2',
        location_code: locationCode,
        shuttle_number: shuttleNumber,
        shuttle_asset_code: shuttleAssetCode,

        vessel_operation_code: nextForm.vessel_operation_code || '',
        vessel_operation_label: selectedOp?.operation_label || '',
        vessel_operation_category: selectedOp?.operation_category || '',
        vessel_operation_sign: selectedOp?.operation_sign || '',
      },
      inputs: {
        operation_date: String(entry.operationDate || '').trim() || null,
        event_time: String(nextForm.event_time || '').trim() || null,

        opening_stock_bbl: openingStock,
        opening_water_bbl: openingWater,
        closing_stock_bbl: closingStock,
        closing_water_bbl: closingWater,

        barge_reference: String(nextForm.barge_reference || '').trim() || null,
        remarks: String(nextForm.remarks || '').trim() || null,
      },
      calculated: {
        net: {
          net_stock_bbl: netStock,
          net_water_bbl: netWater,

          // Compatibility keys for Movement Mapping / totals:
          TOV: netStock,
          FW: netWater,
          NSV: netStock,
        },
      },
    }

    handleValueChange('shuttle_payload', payload)
  }

  const onChange = (e) => {
    const { name, value } = e.target
    const next = { ...form, [name]: value }
    setForm(next)
    updatePayload(next)
  }

  return (
    <div className="info-box" style={{ marginBottom: 14 }}>
      <strong>Shuttle Tracking Entry</strong>

      <div className="operation-entry-subgrid" style={{ marginTop: 10 }}>
        <div>
          <label>Operation (Vessel Operation Master) *</label>
          <select
            name="vessel_operation_code"
            value={form.vessel_operation_code}
            onChange={onChange}
            disabled={loadingOps}
          >
            <option value="">
              {loadingOps ? 'Loading operations...' : 'Select Operation'}
            </option>
            {ops.map((o) => (
              <option key={o.id} value={o.operation_code}>
                {o.operation_label} ({o.operation_code}) [{o.operation_sign}]
              </option>
            ))}
          </select>
        </div>

        <div>
          <label>Time (HH:MM)</label>
          <input
            name="event_time"
            type="time"
            value={form.event_time}
            onChange={onChange}
          />
        </div>

        <div>
          <label>Opening Stock (BBL)</label>
          <input
            name="opening_stock_bbl"
            type="number"
            value={form.opening_stock_bbl}
            onChange={onChange}
          />
        </div>

        <div>
          <label>Opening Water (BBL)</label>
          <input
            name="opening_water_bbl"
            type="number"
            value={form.opening_water_bbl}
            onChange={onChange}
          />
        </div>

        <div>
          <label>Closing Stock (BBL)</label>
          <input
            name="closing_stock_bbl"
            type="number"
            value={form.closing_stock_bbl}
            onChange={onChange}
          />
        </div>

        <div>
          <label>Closing Water (BBL)</label>
          <input
            name="closing_water_bbl"
            type="number"
            value={form.closing_water_bbl}
            onChange={onChange}
          />
        </div>

        <div>
          <label>Net Stock (Closing − Opening)</label>
          <input value={computed.netStock.toFixed(3)} disabled />
        </div>

        <div>
          <label>Net Water (Closing − Opening)</label>
          <input value={computed.netWater.toFixed(3)} disabled />
        </div>

        <div className="full-width-field">
          <label>Barge Reference (optional)</label>
          <input
            name="barge_reference"
            value={form.barge_reference}
            onChange={onChange}
            placeholder="Optional: barge convoy/reference for reconciliation"
          />
        </div>

        <div className="full-width-field">
          <label>Remarks</label>
          <textarea
            name="remarks"
            rows="2"
            value={form.remarks}
            onChange={onChange}
            placeholder="Any notes..."
          />
        </div>
      </div>
    </div>
  )
}

export default ShuttleTrackingLayout