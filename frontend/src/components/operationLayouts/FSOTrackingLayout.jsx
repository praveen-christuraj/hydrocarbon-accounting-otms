import { useEffect, useMemo, useState } from 'react'
import { getVesselOperations } from '../../api/vesselOperationApi'
import { getShuttleTracking } from '../../api/shuttleTrackingApi'

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

function FSOTrackingLayout({ entry, selectedAsset, handleValueChange, setEntryField }) {
  const [ops, setOps] = useState([])
  const [loadingOps, setLoadingOps] = useState(false)
  const [fetching, setFetching] = useState(false)

  const [form, setForm] = useState({
    operation_code: '', // vessel operation code (soft-coded)
    event_time: '',
    shuttle_number: '', // ✅ payload field (manual)
    vessel_name: '',
    vessel_quantity_bbl: '',
    opening_stock_bbl: '',
    opening_water_bbl: '',
    closing_stock_bbl: '',
    closing_water_bbl: '',
    remarks: '',
  })

  const currentPayload = useMemo(() => {
    const row = (entry.values || []).find((v) => v.fieldCode === 'fso_payload')
    return parseObject(row?.fieldValue)
  }, [entry.values])

  useEffect(() => {
    if (!currentPayload) return

    const meta = currentPayload.meta || {}
    const inputs = currentPayload.inputs || {}

    setForm({
      operation_code: meta.operation_code || '',
      event_time: inputs.event_time || '',
      shuttle_number: inputs.shuttle_number || meta.shuttle_number || '',
      vessel_name: inputs.vessel_name || '',
      vessel_quantity_bbl: inputs.vessel_quantity_bbl ?? '',
      opening_stock_bbl: inputs.opening_stock_bbl ?? '',
      opening_water_bbl: inputs.opening_water_bbl ?? '',
      closing_stock_bbl: inputs.closing_stock_bbl ?? '',
      closing_water_bbl: inputs.closing_water_bbl ?? '',
      remarks: inputs.remarks || '',
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Load vessel operations (soft-coded) for FSO asset type
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
          show_in: 'Entry', // ✅ entry-side operations; change to 'Both' if needed
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
    return ops.find((o) => o.operation_code === form.operation_code)
  }, [ops, form.operation_code])

  const isReceiptLike = useMemo(() => {
    // Business rule: shuttle number mandatory for "loading/receipt from shuttle" type operations.
    // Use operation_sign IN as the strict system rule.
    const sign = String(selectedOp?.operation_sign || '').trim().toUpperCase()
    return sign === 'IN'
  }, [selectedOp])

  const computed = useMemo(() => {
    const openingStock = safeNumber(form.opening_stock_bbl)
    const openingWater = safeNumber(form.opening_water_bbl)
    const closingStock = safeNumber(form.closing_stock_bbl)
    const closingWater = safeNumber(form.closing_water_bbl)
    const vesselQty = safeNumber(form.vessel_quantity_bbl)

    const netStock = closingStock - openingStock
    const netWater = closingWater - openingWater
    const variance = Math.abs(netStock + netWater) - vesselQty

    return {
      openingStock,
      openingWater,
      closingStock,
      closingWater,
      vesselQty,
      netStock,
      netWater,
      variance,
    }
  }, [
    form.opening_stock_bbl,
    form.opening_water_bbl,
    form.closing_stock_bbl,
    form.closing_water_bbl,
    form.vessel_quantity_bbl,
  ])

  const updatePayload = (nextForm, extraMeta = {}) => {
    const locationCode = String(entry.originLocationCode || '').trim()
    const fsoAssetCode = String(entry.primaryAssetCode || '').trim()
    const operationCode = String(nextForm.operation_code || '').trim()
    const shuttleNumber = String(nextForm.shuttle_number || '').trim()

    const openingStock = safeNumber(nextForm.opening_stock_bbl)
    const openingWater = safeNumber(nextForm.opening_water_bbl)
    const closingStock = safeNumber(nextForm.closing_stock_bbl)
    const closingWater = safeNumber(nextForm.closing_water_bbl)
    const vesselQty = safeNumber(nextForm.vessel_quantity_bbl)

    const netStock = closingStock - openingStock
    const netWater = closingWater - openingWater
    const variance = Math.abs(netStock + netWater) - vesselQty

    const payload = {
      meta: {
        schema: 'fso_payload_v2',
        location_code: locationCode,
        fso_asset_code: fsoAssetCode,

        operation_code: operationCode,
        operation_label: selectedOp?.operation_label || '',
        operation_category: selectedOp?.operation_category || '',
        operation_sign: selectedOp?.operation_sign || '',

        // ✅ store shuttle reference in payload meta too
        shuttle_number: shuttleNumber || null,

        ...extraMeta
      },
      inputs: {
        operation_date: String(entry.operationDate || '').trim() || null,
        event_time: String(nextForm.event_time || '').trim() || null,

        // ✅ shuttle number is payload field (manual)
        shuttle_number: shuttleNumber || null,

        vessel_name: String(nextForm.vessel_name || '').trim() || null,
        vessel_quantity_bbl: vesselQty,

        opening_stock_bbl: openingStock,
        opening_water_bbl: openingWater,
        closing_stock_bbl: closingStock,
        closing_water_bbl: closingWater,

        remarks: String(nextForm.remarks || '').trim() || null,
      },
      calculated: {
        net: {
          net_stock_bbl: netStock,
          net_water_bbl: netWater,
          variance_bbl: variance,
        },
      },
    }

    handleValueChange('fso_payload', payload)
  }

  const onChange = (e) => {
    const { name, value } = e.target
    const next = { ...form, [name]: value }
    setForm(next)
    if (name === 'shuttle_number' && typeof setEntryField === 'function') {
      setEntryField('convoyNumber', value)
    }
    updatePayload(next)
  }

  // ✅ Fetch shuttle discharge from CLOSED shuttle voyage
  const fetchShuttleDischarge = async () => {
    const shuttleNo = String(form.shuttle_number || '').trim()
    if (!shuttleNo) {
      alert('Enter Shuttle Number first.')
      return
    }

    try {
      setFetching(true)

      // 1) Find the voyage under CLOSED tab
      const list = await getShuttleTracking({
        tab: 'CLOSED',
        shuttle_number: shuttleNo,
        page: 1,
        page_size: 50,
        include_tickets: false,
      })

      const match = (list.rows || []).find(
        (r) => String(r.shuttleNumber || '').trim() === shuttleNo
      )

      if (!match) {
        alert('No CLOSED shuttle voyage found for this Shuttle Number.')
        return
      }

      const vesselQty = Number(match.netDischargeBbl || 0)

      const next = {
        ...form,
        vessel_name: match.shuttleAssetName || form.vessel_name,
        vessel_quantity_bbl: String(vesselQty.toFixed(3)),
      }

      const sourceShuttleDischargeBbl = vesselQty

      setForm(next)
      if (typeof setEntryField === 'function') {
        setEntryField('convoyNumber', shuttleNo)
      }
      updatePayload(
        {
          ...next,
        },
        {
          source_shuttle_discharge_bbl: sourceShuttleDischargeBbl,
        }
      )

      alert('Shuttle discharge captured successfully.')
    } catch (e) {
      alert(e.message || 'Unable to fetch shuttle discharge')
    } finally {
      setFetching(false)
    }
  }

  return (
    <div className="info-box" style={{ marginBottom: 14 }}>
      <strong>FSO Tracking Entry (Payload)</strong>

      <div className="create-2col-grid" style={{ marginTop: 10 }}>
        <div>
          <label>Operation (Vessel Operation Master) *</label>
          <select
            name="operation_code"
            value={form.operation_code}
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
          <input name="event_time" type="time" value={form.event_time} onChange={onChange} />
        </div>

        {/* Row 1: Shuttle Number + Fetch */}
        <div className="full-width" style={{ display: 'grid', gridTemplateColumns: '1fr 220px', gap: 10, alignItems: 'end' }}>
          <div>
            <label>
              Shuttle Number {isReceiptLike ? '*' : ''}
            </label>
            <input
              name="shuttle_number"
              value={form.shuttle_number}
              onChange={onChange}
              placeholder="Manual entry (e.g., SH100)"
            />
          </div>

          <div>
            <button
              type="button"
              onClick={fetchShuttleDischarge}
              disabled={fetching || (isReceiptLike && !String(form.shuttle_number || '').trim())}
              style={{ width: '100%', height: 44 }}
            >
              {fetching ? 'Fetching...' : 'Fetch Shuttle'}
            </button>
          </div>
        </div>

        {/* Row 2: Vessel Name + Vessel Quantity */}
        <div className="full-width" style={{ display: 'grid', gridTemplateColumns: '1fr 240px', gap: 10, alignItems: 'end' }}>
          <div>
            <label>Vessel Name</label>
            <input
              name="vessel_name"
              value={form.vessel_name}
              onChange={onChange}
              placeholder="Auto-filled (editable)"
            />
          </div>

          <div>
            <label>Vessel Quantity (BBL)</label>
            <input
              name="vessel_quantity_bbl"
              type="number"
              value={form.vessel_quantity_bbl}
              onChange={onChange}
            />
          </div>
        </div>

        {/* ✅ Parallel arrangement: Opening pair */}
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

        {/* ✅ Parallel arrangement: Closing pair */}
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

        {/* ✅ Parallel arrangement: Net pair */}
        <div>
          <label>Net Stock</label>
          <input value={computed.netStock.toFixed(3)} disabled />
        </div>

        <div>
          <label>Net Water</label>
          <input value={computed.netWater.toFixed(3)} disabled />
        </div>

        <div>
          <label>Variance</label>
          <input value={computed.variance.toFixed(3)} disabled />
        </div>

        <div className="full-width">
          <label>Remarks</label>
          <textarea
            name="remarks"
            rows="2"
            value={form.remarks}
            onChange={onChange}
            placeholder="Any notes..."
          />
        </div>

        {/* ✅ simple hard enforcement warning (no assumptions) */}
        {isReceiptLike && !String(form.shuttle_number || '').trim() && (
          <div className="full-width warning-text">
            Shuttle Number is mandatory for IN/Receipt operations.
          </div>
        )}
      </div>
    </div>
  )
}

export default FSOTrackingLayout
