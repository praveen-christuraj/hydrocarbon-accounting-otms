import { useEffect, useMemo, useState } from 'react'
import { getFlowmeterConfigs } from '../../api/flowmeterApi'
import {
  calculateVcfFromApi60AndTankTemperature,
  getApi60FromObservedInput,
  getTemperatureLimits,
  OBSERVED_API_LIMITS,
  OBSERVED_DENSITY_LIMITS,
  BSW_LIMITS,
  parseNumber,
  roundTo,
} from '../../utils/tankQuantityEngine'

const M3_TO_BBLS_FACTOR = 6.289811

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

const safeNumber = (value, fallback = 0) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

const findValueByFieldCode = (entryValues, code) => {
  return (entryValues || []).find((v) => v.fieldCode === code)
}

function FlowmeterReadingLayout({
  entry,
  selectedAsset,
  handleValueChange,
  setEntryField,
}) {
  const [configs, setConfigs] = useState([])
  const [configLoading, setConfigLoading] = useState(false)

  const [form, setForm] = useState({
    stream_name: '',
    reading_date: '',
    event_time: '',
    tank_temperature_unit: 'C',
    tank_temperature: '',
    observed_input_type: 'Observed API',
    observed_api: '',
    observed_density: '',
    sample_temperature_unit: 'F',
    sample_temperature: '',
    bsw_percent: '',
    remarks: '',
  })
  const [meterInputs, setMeterInputs] = useState({})

  const existingPayload = useMemo(() => {
    const payloadField = findValueByFieldCode(entry.values, 'flowmeter_payload')
    return parseObject(payloadField?.fieldValue)
  }, [entry.values])

  useEffect(() => {
    if (!existingPayload) return
    const inputs = existingPayload.inputs || {}

    const existingMeters = Array.isArray(inputs.meters) ? inputs.meters : []
    const nextMeterInputs = {}
    existingMeters.forEach((m) => {
      const key = String(m.config_id ?? m.id ?? m.meter_label ?? '')
      if (!key) return
      nextMeterInputs[key] = {
        opening_reading: m.opening_reading ?? '',
        closing_reading: m.closing_reading ?? '',
      }
    })

    setMeterInputs(nextMeterInputs)

    setForm((prev) => ({
      ...prev,
      stream_name: inputs.stream_name || inputs.streamName || '',
      reading_date: inputs.reading_date || String(entry.operationDate || '').trim() || '',
      event_time: inputs.event_time || '',
      tank_temperature_unit: inputs.tank_temperature_unit || 'C',
      tank_temperature: inputs.tank_temperature ?? '',
      observed_input_type: inputs.observed_input_type || 'Observed API',
      observed_api: inputs.observed_api ?? '',
      observed_density: inputs.observed_density ?? '',
      sample_temperature_unit: inputs.sample_temperature_unit || 'F',
      sample_temperature: inputs.sample_temperature ?? '',
      bsw_percent: inputs.bsw_percent ?? '',
      remarks: inputs.remarks || '',
    }))
  }, [existingPayload, entry.operationDate])

  useEffect(() => {
    let cancelled = false
    const loadConfigs = async () => {
      const assetCode = String(entry.primaryAssetCode || '').trim()
      const locationCode = String(entry.originLocationCode || '').trim()
      if (!assetCode || !locationCode) {
        setConfigs([])
        return
      }
      try {
        setConfigLoading(true)
        const rows = await getFlowmeterConfigs({ locationCode, assetCode })
        if (!cancelled) {
          setConfigs(Array.isArray(rows) ? rows.filter((r) => r.status === 'Active') : [])
        }
      } catch {
        if (!cancelled) setConfigs([])
      } finally {
        if (!cancelled) setConfigLoading(false)
      }
    }
    loadConfigs()
    return () => {
      cancelled = true
    }
  }, [entry.primaryAssetCode, entry.originLocationCode])

  const selectedStream = useMemo(() => {
    const code = String(entry.primaryAssetCode || '').trim()
    if (code) return code
    return String(selectedAsset?.assetCode || '').trim()
  }, [entry.primaryAssetCode, selectedAsset?.assetCode])

  const streamMeters = useMemo(() => {
    return configs || []
  }, [configs])

  useEffect(() => {
    if (!form.stream_name && selectedStream) {
      setForm((prev) => ({ ...prev, stream_name: selectedStream }))
    }
  }, [form.stream_name, selectedStream])

  const computed = useMemo(() => {
    const meterRows = streamMeters.map((m) => {
      const key = String(m.id)
      const input = meterInputs[key] || {}
      const opening = safeNumber(input.opening_reading)
      const closing = safeNumber(input.closing_reading)
      const factor = safeNumber(m.meterFactor, 0)
      const unit = String(m.meterUnit || 'bbls').toLowerCase() === 'm3' ? 'm3' : 'bbls'
      const delta = closing - opening
      const grossObserved = delta * factor
      const grossObservedBbl = unit === 'bbls' ? grossObserved : grossObserved * M3_TO_BBLS_FACTOR
      return {
        config_id: m.id,
        meter_asset_code: m.meterAssetCode || null,
        meter_asset_name: m.meterAssetName || null,
        meter_label: m.meterLabel,
        meter_factor: factor,
        meter_unit: unit,
        opening_reading: opening,
        closing_reading: closing,
        delta,
        gross_observed: grossObserved,
        gross_observed_bbl: grossObservedBbl,
      }
    })

    const streamGrossObserved = meterRows.reduce((sum, r) => sum + safeNumber(r.gross_observed), 0)
    const grossObservedBbl = meterRows.reduce((sum, r) => sum + safeNumber(r.gross_observed_bbl), 0)
    const streamUnit = meterRows.length > 0 ? meterRows[0].meter_unit : 'bbls'

    const apiResult = getApi60FromObservedInput({
      observedInputType: form.observed_input_type,
      observedApi: form.observed_api,
      observedDensity: form.observed_density,
      sampleTemperature: form.sample_temperature,
      sampleTemperatureUnit: form.sample_temperature_unit,
    })

    const vcf = calculateVcfFromApi60AndTankTemperature({
      api60: apiResult.api60,
      tankTemperature: form.tank_temperature,
      tankTemperatureUnit: form.tank_temperature_unit,
    })

    const gsvBbl = grossObservedBbl * vcf
    const bswPercent = parseNumber(form.bsw_percent, 0)
    const bswBbl = gsvBbl * (bswPercent / 100)
    const nsvBbl = gsvBbl - bswBbl

    return {
      unit: streamUnit,
      streamGrossObserved,
      grossObservedBbl,
      meterRows,
      api60: apiResult.api60,
      vcf,
      gsvBbl,
      bswBbl,
      nsvBbl,
    }
  }, [
    meterInputs,
    streamMeters,
    form.observed_input_type,
    form.observed_api,
    form.observed_density,
    form.sample_temperature,
    form.sample_temperature_unit,
    form.tank_temperature,
    form.tank_temperature_unit,
    form.bsw_percent,
  ])

  const pushPayload = (nextForm, nextMeterInputs = meterInputs) => {
    const meterRows = streamMeters.map((m) => {
      const key = String(m.id)
      const input = nextMeterInputs[key] || {}
      const opening = safeNumber(input.opening_reading)
      const closing = safeNumber(input.closing_reading)
      const factor = safeNumber(m.meterFactor, 0)
      const unit = String(m.meterUnit || 'bbls').toLowerCase() === 'm3' ? 'm3' : 'bbls'
      const delta = closing - opening
      const grossObserved = delta * factor
      const grossObservedBbl = unit === 'bbls' ? grossObserved : grossObserved * M3_TO_BBLS_FACTOR
      return {
        config_id: m.id,
        meter_asset_code: m.meterAssetCode || null,
        meter_asset_name: m.meterAssetName || null,
        meter_label: m.meterLabel,
        meter_factor: factor,
        meter_unit: unit,
        opening_reading: opening,
        closing_reading: closing,
        delta,
        gross_observed: grossObserved,
        gross_observed_bbl: grossObservedBbl,
      }
    })

    const streamGrossObserved = meterRows.reduce((sum, r) => sum + safeNumber(r.gross_observed), 0)
    const streamGrossObservedBbl = meterRows.reduce((sum, r) => sum + safeNumber(r.gross_observed_bbl), 0)

    const apiResult = getApi60FromObservedInput({
      observedInputType: nextForm.observed_input_type,
      observedApi: nextForm.observed_api,
      observedDensity: nextForm.observed_density,
      sampleTemperature: nextForm.sample_temperature,
      sampleTemperatureUnit: nextForm.sample_temperature_unit,
    })
    const vcf = calculateVcfFromApi60AndTankTemperature({
      api60: apiResult.api60,
      tankTemperature: nextForm.tank_temperature,
      tankTemperatureUnit: nextForm.tank_temperature_unit,
    })
    const bswPercent = parseNumber(nextForm.bsw_percent, 0)
    const gsvBbl = streamGrossObservedBbl * vcf
    const bswBbl = gsvBbl * (bswPercent / 100)
    const nsvBbl = gsvBbl - bswBbl

    const payload = {
      meta: {
        schema: 'flowmeter_payload_v2',
        location_code: String(entry.originLocationCode || '').trim(),
        asset_code: String(entry.primaryAssetCode || '').trim(),
        asset_type_code: String(selectedAsset?.assetTypeCode || '').trim(),
      },
      inputs: {
        stream_name: String(nextForm.stream_name || '').trim() || null,
        operation_date: String(entry.operationDate || '').trim() || null,
        reading_date: String(nextForm.reading_date || '').trim() || null,
        event_time: String(nextForm.event_time || '').trim() || null,
        meter_label: String(nextForm.stream_name || '').trim() || null,
        meters: meterRows,
        tank_temperature_unit: String(nextForm.tank_temperature_unit || 'C').toUpperCase(),
        tank_temperature: parseNumber(nextForm.tank_temperature, 0),
        observed_input_type: nextForm.observed_input_type,
        observed_api: parseNumber(nextForm.observed_api, 0),
        observed_density: parseNumber(nextForm.observed_density, 0),
        sample_temperature_unit: String(nextForm.sample_temperature_unit || 'F').toUpperCase(),
        sample_temperature: parseNumber(nextForm.sample_temperature, 0),
        bsw_percent: parseNumber(nextForm.bsw_percent, 0),
        remarks: String(nextForm.remarks || '').trim() || null,
      },
      calculated: {
        stream_gross_observed: streamGrossObserved,
        stream_gross_observed_bbl: streamGrossObservedBbl,
        gross_observed_bbl: streamGrossObservedBbl,
        api60: apiResult.api60,
        vcf,
        gsv_bbl: gsvBbl,
        bsw_bbl: bswBbl,
        nsv_bbl: nsvBbl,
      },
    }

    handleValueChange('flowmeter_payload', payload)
  }

  const onChange = (e) => {
    const { name, value } = e.target
    const next = { ...form, [name]: value }
    if (name === 'reading_date' && typeof setEntryField === 'function') {
      setEntryField('operationDate', value)
    }
    setForm(next)
    pushPayload(next)
  }

  const onMeterChange = (configId, field, value) => {
    const nextMeterInputs = {
      ...meterInputs,
      [String(configId)]: {
        ...(meterInputs[String(configId)] || {}),
        [field]: value,
      },
    }
    setMeterInputs(nextMeterInputs)
    pushPayload(form, nextMeterInputs)
  }

  useEffect(() => {
    pushPayload(form, meterInputs)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStream, streamMeters.length])

  const tankTempLimits = getTemperatureLimits(form.tank_temperature_unit, 'tank')
  const sampleTempLimits = getTemperatureLimits(form.sample_temperature_unit, 'sample')

  return (
    <div className="info-box" style={{ marginBottom: 14 }}>
      <strong>Flowmeter Entry (Payload)</strong>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(220px, 1fr))', gap: 12, marginTop: 10 }}>
        <div>
          <label>Flowmeter Asset</label>
          <input value={`${selectedAsset?.assetName || ''} (${selectedAsset?.assetCode || ''})`} disabled />
        </div>
        <div>
          <label>Configured Meters</label>
          <input
            value={
              selectedStream
                ? `${streamMeters.length} meter(s) in ${selectedStream}`
                : configLoading
                  ? 'Loading configuration...'
                  : 'No active stream config'
            }
            disabled
          />
        </div>
        <div>
          <label>Selected Stream</label>
          <input
            value={`${selectedAsset?.assetName || ''} (${selectedStream || '-'})`}
            disabled
          />
        </div>
      </div>

      {!configLoading && streamMeters.length === 0 ? (
        <div className="info-box" style={{ marginTop: 10 }}>
          No active Flowmeter Config found for this stream/location/asset. Configure it first.
        </div>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(220px, 1fr))', gap: 12, marginTop: 12 }}>
        <div>
          <label>Date *</label>
          <input name="reading_date" type="date" value={form.reading_date} onChange={onChange} />
        </div>
        <div>
          <label>Time (HH:MM)</label>
          <input name="event_time" type="time" value={form.event_time} onChange={onChange} />
        </div>
        <div>
          <label>Meter Unit *</label>
          <input value={streamMeters.length > 0 ? 'Per configured meter' : '-'} disabled />
        </div>

        <div>
          <label>Tank Temp Unit *</label>
          <select name="tank_temperature_unit" value={form.tank_temperature_unit} onChange={onChange}>
            <option value="C">C</option>
            <option value="F">F</option>
          </select>
        </div>
        <div>
          <label>Tank Temperature *</label>
          <input
            name="tank_temperature"
            type="number"
            min={tankTempLimits.min}
            max={tankTempLimits.max}
            step="0.1"
            value={form.tank_temperature}
            onChange={onChange}
          />
        </div>
        <div>
          <label>Observed Input Type *</label>
          <select name="observed_input_type" value={form.observed_input_type} onChange={onChange}>
            <option>Observed API</option>
            <option>Observed Density</option>
          </select>
        </div>

        {form.observed_input_type === 'Observed API' ? (
          <div>
            <label>Observed API *</label>
            <input
              name="observed_api"
              type="number"
              min={OBSERVED_API_LIMITS.min}
              max={OBSERVED_API_LIMITS.max}
              step="0.01"
              value={form.observed_api}
              onChange={onChange}
            />
          </div>
        ) : (
          <div>
            <label>Observed Density (kg/m3) *</label>
            <input
              name="observed_density"
              type="number"
              min={OBSERVED_DENSITY_LIMITS.min}
              max={OBSERVED_DENSITY_LIMITS.max}
              step="0.1"
              value={form.observed_density}
              onChange={onChange}
            />
          </div>
        )}

        <div>
          <label>Sample Temp Unit *</label>
          <select name="sample_temperature_unit" value={form.sample_temperature_unit} onChange={onChange}>
            <option value="F">F</option>
            <option value="C">C</option>
          </select>
        </div>
        <div>
          <label>Sample Temperature *</label>
          <input
            name="sample_temperature"
            type="number"
            min={sampleTempLimits.min}
            max={sampleTempLimits.max}
            step="0.1"
            value={form.sample_temperature}
            onChange={onChange}
          />
        </div>
        <div>
          <label>BS & W (%) *</label>
          <input
            name="bsw_percent"
            type="number"
            min={BSW_LIMITS.min}
            max={BSW_LIMITS.max}
            step="0.01"
            value={form.bsw_percent}
            onChange={onChange}
          />
        </div>
      </div>

      <div className="section-title compact-section-title" style={{ marginTop: 12 }}>
        <h3>Meter Readings ({selectedAsset?.assetName || selectedStream || '-'})</h3>
      </div>

      <table>
        <thead>
          <tr>
            <th>Meter</th>
            <th>Factor</th>
            <th>Unit</th>
            <th>Opening</th>
            <th>Closing</th>
            <th>Gross Obs</th>
            <th>Gross (BBL)</th>
          </tr>
        </thead>
        <tbody>
          {streamMeters.length === 0 ? (
            <tr>
              <td colSpan="7">No meters configured for selected stream.</td>
            </tr>
          ) : streamMeters.map((m) => {
            const key = String(m.id)
            const meter = computed.meterRows.find((x) => String(x.config_id) === key) || {}
            return (
              <tr key={m.id}>
                <td>{m.meterAssetName ? `${m.meterAssetName} (${m.meterAssetCode})` : m.meterLabel}</td>
                <td>{m.meterFactor}</td>
                <td>{m.meterUnit}</td>
                <td>
                  <input type="number" step="0.001" value={(meterInputs[key] || {}).opening_reading ?? ''} onChange={(e) => onMeterChange(m.id, 'opening_reading', e.target.value)} />
                </td>
                <td>
                  <input type="number" step="0.001" value={(meterInputs[key] || {}).closing_reading ?? ''} onChange={(e) => onMeterChange(m.id, 'closing_reading', e.target.value)} />
                </td>
                <td>{roundTo(meter.gross_observed, 3)}</td>
                <td>{roundTo(meter.gross_observed_bbl, 3)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <div style={{ marginTop: 12 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Live Calculations</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(160px, 1fr))', gap: 10 }}>
          {[
            ['Meters', `${computed.meterRows.length}`],
            ['Stream Gross Obs', `${roundTo(computed.streamGrossObserved, 3)} ${computed.unit}`],
            ['Gross (BBL)', `${roundTo(computed.grossObservedBbl, 3)}`],
            ['API @ 60', `${roundTo(computed.api60, 3)}`],
            ['VCF', `${roundTo(computed.vcf, 5)}`],
            ['GSV (BBL)', `${roundTo(computed.gsvBbl, 3)}`],
            ['BSW Vol (BBL)', `${roundTo(computed.bswBbl, 3)}`],
            ['Net NSV (BBL)', `${roundTo(computed.nsvBbl, 3)}`],
          ].map(([label, value]) => (
            <div
              key={label}
              style={{
                border: '1px solid #d1d5db',
                borderRadius: 10,
                padding: '10px 12px',
                background: '#fff',
              }}
            >
              <div style={{ fontSize: 12, color: '#6b7280' }}>{label}</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#111827' }}>{value}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
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
  )
}

export default FlowmeterReadingLayout
