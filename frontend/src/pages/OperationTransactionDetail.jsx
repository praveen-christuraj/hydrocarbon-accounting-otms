import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  createOperationTransactionCorrectionRequest,
  getOperationTransactionCorrectionRequests,
  getOperationTransactionDetail,
  updateOperationTransactionStatus,
  getOperationTransactionStatusHistory,
} from '../api/operationTransactionApi'

import { checkOperationWorkflowPolicy } from '../api/operationWorkflowPolicyApi'

import { getCompanyReportProfiles } from '../api/companyReportProfileApi'
import TankerPayloadPreview from '../components/operationLayouts/TankerPayloadPreview'

const SELECTED_REPORT_PROFILE_KEY = 'tank_gauging_selected_report_profile'

const defaultReportSettings = {
  id: null,
  profileName: 'Default Profile',
  companyName: 'Your Company Name',
  systemName: 'Hydrocarbon Accounting System',
  reportSubtitle: 'Tank Gauging Quantity Report',
  logoUrl: '',
  logoText: 'LOGO',
  footerFormula:
    'Formula: GOV = TOV - Free Water | GSV = GOV × VCF | NSV = GSV - BS&W Volume | LT = NSV × Table 11 LT Factor | MT = LT × 1.01605',
  footerNote:
    'This report is system-generated from saved operation transaction data. Verify all measurements, calibration references, and approval status before operational or commercial use.',
  status: 'Active',
}

const loadSelectedReportProfileName = () => {
  return (
    localStorage.getItem(SELECTED_REPORT_PROFILE_KEY) ||
    defaultReportSettings.profileName
  )
}

const saveSelectedReportProfileName = (profileName) => {
  localStorage.setItem(SELECTED_REPORT_PROFILE_KEY, profileName)
}
const formatValue = (value, decimals = 3) => {
  if (value === null || value === undefined || value === '') {
    return '-'
  }

  if (typeof value === 'number') {
    return value.toLocaleString(undefined, {
      maximumFractionDigits: decimals,
    })
  }

  const numericValue = Number(value)

  if (!Number.isNaN(numericValue) && String(value).trim() !== '') {
    return numericValue.toLocaleString(undefined, {
      maximumFractionDigits: decimals,
    })
  }

  return String(value)
}

const getMultiTankSubmitSealCheck = (multiTankPayload) => {
  const after = multiTankPayload?.seals?.after || {}
  const temp = after?.temporary || {}

  const missingTemp = []
  if (!String(temp.portManifoldSeal || '').trim()) missingTemp.push('Port Manifold Seal')
  if (!String(temp.stbdManifoldSeal || '').trim()) missingTemp.push('Starboard Manifold Seal')
  if (!String(temp.pumproomSeal || '').trim()) missingTemp.push('Pumproom Seal')

  let mismatchCount = 0
  const tankSeals = after?.tankSeals || {}

  if (tankSeals && typeof tankSeals === 'object') {
    for (const tid of Object.keys(tankSeals)) {
      const positions = tankSeals[tid]
      if (!positions || typeof positions !== 'object') continue

      for (const pos of Object.keys(positions)) {
        const cell = positions[pos]
        if (!cell || typeof cell !== 'object') continue
        const master = String(cell.master || '').trim()
        const observed = String(cell.observed || '').trim()
        if (master && observed && master !== observed) mismatchCount += 1
      }
    }
  }

  return { missingTemp, mismatchCount }
}

const isBlank = (v) => String(v ?? '').trim() === ''

  const getTankGaugingMandatoryMissing = (tankPayload) => {
    const inputs = tankPayload?.inputs || {}
    const missing = []

    if (isBlank(inputs.gaugingDate)) missing.push('Gauging Date')
    if (isBlank(inputs.gaugingTime)) missing.push('Gauging Time')
    if (isBlank(inputs.dipCm)) missing.push('Dip')
    if (isBlank(inputs.waterLevelCm)) missing.push('Water Level')
    if (isBlank(inputs.tankTemperature)) missing.push('Tank Temperature')
    if (isBlank(inputs.sampleTemperature)) missing.push('Sample Temperature')
    if (isBlank(inputs.bswPercent)) missing.push('BS&W %')

    const mode = String(inputs.observedInputType || '').toLowerCase()
    if (mode.includes('api')) {
      if (isBlank(inputs.observedApi)) missing.push('Observed API')
    } else {
      if (isBlank(inputs.observedDensity)) missing.push('Observed Density')
    }

    return missing
  }

  const getMultiTankMandatoryMissing = (multiTankPayload) => {
    const meta = multiTankPayload?.meta || {}
    const inputs = multiTankPayload?.inputs || {}
    const tankIds = Array.isArray(meta.tankIds) ? meta.tankIds : []

    const stageMissing = (label, stage) => {
      const miss = []
      if (isBlank(stage?.tankTemp)) miss.push(`${label}: Tank Temp`)
      if (isBlank(stage?.sampleTemp)) miss.push(`${label}: Sample Temp`)
      if (isBlank(stage?.bswPct)) miss.push(`${label}: BS&W`)

      const mode = String(stage?.obsMode || '').toLowerCase()
      if (mode.includes('api')) {
        if (isBlank(stage?.obsApi)) miss.push(`${label}: Observed API`)
      } else {
        if (isBlank(stage?.obsDensity)) miss.push(`${label}: Observed Density`)
      }

      for (const tid of tankIds) {
        const d = (stage?.dips || {})[tid] || {}
        if (isBlank(d.total)) miss.push(`${label}: ${tid} Total Dip`)
        if (isBlank(d.water)) miss.push(`${label}: ${tid} Water Dip`)
      }

      return miss
    }

    return [
      ...stageMissing('Before', inputs.before || {}),
      ...stageMissing('After', inputs.after || {}),
    ]
  }

const getTankPayloadFromTransaction = (transaction) => {
  if (!transaction || !Array.isArray(transaction.fieldValues)) {
    return null
  }

  const payloadField = transaction.fieldValues.find((field) => {
    return field.fieldCode === 'tank_gauging_payload'
  })

  if (!payloadField || !payloadField.fieldValue) {
    return null
  }

  if (typeof payloadField.fieldValue === 'object') {
    return payloadField.fieldValue
  }

  const rawValue = String(payloadField.fieldValue || '').trim()

  if (rawValue === '' || rawValue === '[object Object]') {
    return null
  }

  try {
    return JSON.parse(rawValue)
  } catch {
    return null
  }
}

const isTankPayloadField = (field) => {
  return field.fieldCode === 'tank_gauging_payload'
}

const getMultiTankPayloadFromTransaction = (transaction) => {
  if (!transaction || !Array.isArray(transaction.fieldValues)) {
    return null
  }

  const payloadField = transaction.fieldValues.find((field) => {
    return field.fieldCode === 'multi_tank_payload'
  })

  if (!payloadField || payloadField.fieldValue === null || payloadField.fieldValue === undefined) {
    return null
  }

  if (typeof payloadField.fieldValue === 'object') {
    return payloadField.fieldValue
  }

  const rawValue = String(payloadField.fieldValue || '').trim()

  if (rawValue === '' || rawValue === '[object Object]') {
    return null
  }

  try {
    return JSON.parse(rawValue)
  } catch {
    return null
  }
}

const isMultiTankPayloadField = (field) => {
  return field.fieldCode === 'multi_tank_payload'
}

const getShuttlePayloadFromTransaction = (transaction) => {
  if (!transaction || !Array.isArray(transaction.fieldValues)) {
    return null
  }

  const payloadField = transaction.fieldValues.find((field) => {
    return field.fieldCode === 'shuttle_payload'
  })

  if (!payloadField || !payloadField.fieldValue) {
    return null
  }

  if (typeof payloadField.fieldValue === 'object') {
    return payloadField.fieldValue
  }

  const rawValue = String(payloadField.fieldValue || '').trim()

  if (rawValue === '' || rawValue === '[object Object]') {
    return null
  }

  try {
    return JSON.parse(rawValue)
  } catch {
    return null
  }
}

const isShuttlePayloadField = (field) => {
  return field.fieldCode === 'shuttle_payload'
}

const getFlowmeterPayloadFromTransaction = (transaction) => {
  if (!transaction || !Array.isArray(transaction.fieldValues)) {
    return null
  }

  const payloadField = transaction.fieldValues.find((field) => {
    return field.fieldCode === 'flowmeter_payload'
  })

  if (!payloadField || !payloadField.fieldValue) {
    return null
  }

  if (typeof payloadField.fieldValue === 'object') {
    return payloadField.fieldValue
  }

  const rawValue = String(payloadField.fieldValue || '').trim()

  if (rawValue === '' || rawValue === '[object Object]') {
    return null
  }

  try {
    return JSON.parse(rawValue)
  } catch {
    return null
  }
}

const isFlowmeterPayloadField = (field) => {
  return field.fieldCode === 'flowmeter_payload'
}

function FlowmeterCalculatedSummary({ payload }) {
  if (!payload) return null

  const inputs = payload.inputs || {}
  const calculated = payload.calculated || {}
  const meters = Array.isArray(inputs.meters) ? inputs.meters : []
  const isStreamPayload = meters.length > 0

  const Row = ({ label, value, unit = '' }) => (
    <div className="live-calculation-card">
      <span>{label}</span>
      <strong>{formatValue(value)}{unit ? ` ${unit}` : ''}</strong>
    </div>
  )

  return (
    <>
      <div className="section-title compact-section-title">
        <h3>Flowmeter Input Review</h3>
      </div>

      <div className="approval-review-grid">
        <div><span>Date</span><strong>{inputs.reading_date || '-'}</strong></div>
        <div><span>Time</span><strong>{inputs.event_time || '-'}</strong></div>
        <div><span>{isStreamPayload ? 'Stream' : 'Meter'}</span><strong>{inputs.stream_name || inputs.meter_label || '-'}</strong></div>
        <div><span>{isStreamPayload ? 'Meters' : 'Opening'}</span><strong>{isStreamPayload ? meters.length : formatValue(inputs.opening_reading)}</strong></div>
        <div><span>{isStreamPayload ? 'Opening Sum' : 'Closing'}</span><strong>{isStreamPayload ? formatValue(meters.reduce((s, m) => s + Number(m.opening_reading || 0), 0)) : formatValue(inputs.closing_reading)}</strong></div>
        <div><span>{isStreamPayload ? 'Closing Sum' : 'Meter Factor'}</span><strong>{isStreamPayload ? formatValue(meters.reduce((s, m) => s + Number(m.closing_reading || 0), 0)) : formatValue(inputs.meter_factor)}</strong></div>
        <div><span>Meter Unit</span><strong>{isStreamPayload ? 'Mixed/Configured' : (inputs.meter_unit || '-')}</strong></div>
        <div><span>Observed Type</span><strong>{inputs.observed_input_type || '-'}</strong></div>
        <div><span>Observed API</span><strong>{formatValue(inputs.observed_api)}</strong></div>
        <div><span>Observed Density</span><strong>{formatValue(inputs.observed_density)} kg/m³</strong></div>
        <div><span>Tank Temperature</span><strong>{formatValue(inputs.tank_temperature)} °{inputs.tank_temperature_unit || ''}</strong></div>
        <div><span>Sample Temperature</span><strong>{formatValue(inputs.sample_temperature)} °{inputs.sample_temperature_unit || ''}</strong></div>
        <div><span>BS&W</span><strong>{formatValue(inputs.bsw_percent)}%</strong></div>
        <div><span>Remarks</span><strong>{inputs.remarks || '-'}</strong></div>
      </div>

      {isStreamPayload ? (
        <table style={{ marginTop: 10 }}>
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
            {meters.map((m, idx) => (
              <tr key={`${m.config_id || m.meter_label || 'm'}-${idx}`}>
                <td>{m.meter_label || '-'}</td>
                <td>{formatValue(m.meter_factor)}</td>
                <td>{m.meter_unit || '-'}</td>
                <td>{formatValue(m.opening_reading)}</td>
                <td>{formatValue(m.closing_reading)}</td>
                <td>{formatValue(m.gross_observed)}</td>
                <td>{formatValue(m.gross_observed_bbl)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      <div className="section-title compact-section-title">
        <h3>Flowmeter Calculated Values</h3>
      </div>

      <div className="live-calculation-grid tank-live-grid">
        <Row label={isStreamPayload ? 'Stream Gross Observed' : 'Delta'} value={isStreamPayload ? calculated.stream_gross_observed : calculated.delta} unit={isStreamPayload ? '' : undefined} />
        <Row label="Gross Observed" value={calculated.gross_observed} unit={inputs.meter_unit || ''} />
        <Row label="Gross (BBL)" value={calculated.gross_observed_bbl} unit="bbl" />
        <Row label="API @ 60°F" value={calculated.api60} />
        <Row label="VCF" value={calculated.vcf} />
        <Row label="GSV (BBL)" value={calculated.gsv_bbl} unit="bbl" />
        <Row label="BSW Vol (BBL)" value={calculated.bsw_bbl} unit="bbl" />
        <Row label="NSV (BBL)" value={calculated.nsv_bbl} unit="bbl" />
      </div>
    </>
  )
}

function TankCalculatedSummary({ calculated }) {
  return (
    <div className="live-calculation-grid tank-live-grid">
      <div className="live-calculation-card">
        <span>TOV</span>
        <strong>{formatValue(calculated.tovBbl)} bbl</strong>
      </div>

      <div className="live-calculation-card">
        <span>Free Water</span>
        <strong>{formatValue(calculated.freeWaterBbl)} bbl</strong>
      </div>

      <div className="live-calculation-card">
        <span>GOV</span>
        <strong>{formatValue(calculated.govBbl)} bbl</strong>
      </div>

      <div className="live-calculation-card">
        <span>Observed API</span>
        <strong>{formatValue(calculated.observedApi)}</strong>
      </div>

      <div className="live-calculation-card">
        <span>Observed Density</span>
        <strong>{formatValue(calculated.observedDensity)} kg/m³</strong>
      </div>

      <div className="live-calculation-card">
        <span>API @ 60°F</span>
        <strong>{formatValue(calculated.api60)}</strong>
      </div>

      <div className="live-calculation-card">
        <span>Density @ 15°C</span>
        <strong>{formatValue(calculated.density15)} kg/m³</strong>
      </div>

      <div className="live-calculation-card">
        <span>VCF</span>
        <strong>{formatValue(calculated.vcf, 5)}</strong>
      </div>

      <div className="live-calculation-card">
        <span>GSV</span>
        <strong>{formatValue(calculated.gsvBbl, 0)} bbl</strong>
      </div>

      <div className="live-calculation-card">
        <span>BS&W Volume</span>
        <strong>{formatValue(calculated.bswBbl, 0)} bbl</strong>
      </div>

      <div className="live-calculation-card">
        <span>NSV</span>
        <strong>{formatValue(calculated.nsvBbl, 0)} bbl</strong>
      </div>

      <div className="live-calculation-card">
        <span>LT Factor</span>
        <strong>{formatValue(calculated.ltFactor, 8)}</strong>
      </div>

      <div className="live-calculation-card">
        <span>Table 11 Method</span>
        <strong>{calculated.table11LookupMethod || '-'}</strong>
      </div>

      <div className="live-calculation-card">
        <span>Lower API @ 60°F</span>
        <strong>{formatValue(calculated.table11LowerApi60)}</strong>
      </div>

      <div className="live-calculation-card">
        <span>Upper API @ 60°F</span>
        <strong>{formatValue(calculated.table11UpperApi60)}</strong>
      </div>

      <div className="live-calculation-card">
        <span>LT</span>
        <strong>{formatValue(calculated.lt, 0)}</strong>
      </div>

      <div className="live-calculation-card">
        <span>MT</span>
        <strong>{formatValue(calculated.mt, 0)}</strong>
      </div>

      <div className="live-calculation-card">
        <span>Mass Method</span>
        <strong>{calculated.massMethod || '-'}</strong>
      </div>
    </div>
  )
}

function MultiTankBeforeAfterSummary({ payload }) {
  if (!payload) return null

  const calculated = payload.calculated || {}
  const before = calculated.before || {}
  const after = calculated.after || {}
  const net = calculated.net || {}

  const rows = [
    { label: 'TOV', before: before.TOV, after: after.TOV, net: net.TOV, unit: 'bbl', dp: 2 },
    { label: 'FW', before: before.FW, after: after.FW, net: net.FW, unit: 'bbl', dp: 2 },
    { label: 'GOV', before: before.GOV, after: after.GOV, net: net.GOV, unit: 'bbl', dp: 2 },
    { label: 'GSV', before: before.GSV, after: after.GSV, net: net.GSV, unit: 'bbl', dp: 0 },
    { label: 'NSV', before: before.NSV, after: after.NSV, net: net.NSV, unit: 'bbl', dp: 0 },
    { label: 'LT', before: before.LT, after: after.LT, net: net.LT, unit: '', dp: 0 },
    { label: 'MT', before: before.MT, after: after.MT, net: net.MT, unit: '', dp: 0 },
  ]

  return (
    <div>
      <div className="section-title compact-section-title">
        <h3>Multi-Tank Before/After Summary</h3>
      </div>

      <table>
        <thead>
          <tr>
            <th>Metric</th>
            <th>Before</th>
            <th>After</th>
            <th>Net (After - Before)</th>
          </tr>
        </thead>

        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td><strong>{r.label}</strong></td>
              <td>{formatValue(r.before, r.dp)} {r.unit}</td>
              <td>{formatValue(r.after, r.dp)} {r.unit}</td>
              <td><strong>{formatValue(r.net, r.dp)}</strong> {r.unit}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="info-box" style={{ marginTop: 10 }}>
        Table 11 LT Factor (Before): {formatValue(before.ltFactor, 8)} | (After): {formatValue(after.ltFactor, 8)}
      </div>
    </div>
  )
}

function MultiTankCalculatedSummary({ payload }) {
  if (!payload) return null

  const calculated = payload.calculated || {}
  const before = calculated.before || {}
  const after = calculated.after || {}
  const net = calculated.net || {}

  const Row = ({ label, b, a, n, unit = '', dp = 2 }) => (
    <tr>
      <td><strong>{label}</strong></td>
      <td>{formatValue(b, dp)} {unit}</td>
      <td>{formatValue(a, dp)} {unit}</td>
      <td><strong>{formatValue(n, dp)}</strong> {unit}</td>
    </tr>
  )

  return (
    <div className="full-width-field">
      <table>
        <thead>
          <tr>
            <th>Parameter</th>
            <th>Before</th>
            <th>After</th>
            <th>Net</th>
          </tr>
        </thead>
        <tbody>
          <Row label="TOV" b={before.TOV} a={after.TOV} n={net.TOV} unit="bbl" dp={2} />
          <Row label="Free Water" b={before.FW} a={after.FW} n={net.FW} unit="bbl" dp={2} />
          <Row label="GOV" b={before.GOV} a={after.GOV} n={net.GOV} unit="bbl" dp={2} />
          <Row label="GSV" b={before.GSV} a={after.GSV} n={net.GSV} unit="bbl" dp={0} />
          <Row label="NSV" b={before.NSV} a={after.NSV} n={net.NSV} unit="bbl" dp={0} />
          <Row label="LT" b={before.LT} a={after.LT} n={net.LT} unit="" dp={0} />
          <Row label="MT" b={before.MT} a={after.MT} n={net.MT} unit="" dp={0} />
        </tbody>
      </table>

      <div className="info-box">
        <div><strong>Table 11 LT Factor</strong></div>
        <div>Before: {formatValue(before.ltFactor, 8)} ({before.table11Method || '-'})</div>
        <div>After: {formatValue(after.ltFactor, 8)} ({after.table11Method || '-'})</div>
      </div>
    </div>
  )
}

function ShuttleCalculatedSummary({ payload }) {
  if (!payload) return null

  const meta = payload.meta || {}
  const inputs = payload.inputs || {}
  const net = (payload.calculated || {}).net || {}

  const opLabel =
    meta.vessel_operation_label ||
    meta.vessel_operation_code ||
    'Shuttle Operation'

  const time = inputs.event_time || '-'

  const openingStock = Number(inputs.opening_stock_bbl || 0)
  const openingWater = Number(inputs.opening_water_bbl || 0)
  const closingStock = Number(inputs.closing_stock_bbl || 0)
  const closingWater = Number(inputs.closing_water_bbl || 0)

  // Net Stock is NSV rule already applied in payload
  const netStock = Number(net.net_stock_bbl ?? net.NSV ?? 0)
  const netWater = Number(net.net_water_bbl ?? net.FW ?? 0)

  const bargeRef = inputs.barge_reference || '-'
  const remarks = inputs.remarks || '-'

  const Row = ({ label, value }) => (
    <div className="live-calculation-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )

  return (
    <>
      <div className="section-title compact-section-title">
        <h3>Shuttle Ticket Summary</h3>
      </div>

      <div className="info-box">
        <strong>Operation:</strong> {opLabel} &nbsp; | &nbsp; <strong>Time:</strong> {time}
      </div>

      <div className="live-calculation-grid tank-live-grid">
        <Row label="Opening Stock" value={openingStock.toFixed(3)} />
        <Row label="Opening Water" value={openingWater.toFixed(3)} />
        <Row label="Closing Stock" value={closingStock.toFixed(3)} />
        <Row label="Closing Water" value={closingWater.toFixed(3)} />
        <Row label="Net Stock" value={netStock.toFixed(3)} />
        <Row label="Net Water" value={netWater.toFixed(3)} />
      </div>

      <div className="info-box" style={{ marginTop: 10 }}>
        <div><strong>Barge Reference:</strong> {bargeRef}</div>
        <div style={{ marginTop: 6 }}><strong>Remarks:</strong> {remarks}</div>
      </div>
    </>
  )
}

function ReviewConfirmationModal({
  transaction,
  tankPayload,
  multiTankPayload,
  shuttlePayload,
  flowmeterPayload,
  nextStatus,
  remarks,
  onRemarksChange,
  onClose,
  onConfirm,
  statusLoading,
  pendingReviewConfirmed,
  setPendingReviewConfirmed,
}) {
  if (!transaction || !nextStatus) {
    return null
  }

  const calculated = tankPayload?.calculated || {}
  const inputs = tankPayload?.inputs || {}

  const isReasonRequired =
    nextStatus === 'Rejected' ||
    nextStatus === 'Cancelled' ||
    nextStatus === 'Draft'

  const isSubmitting = nextStatus === 'Submitted'
  const multiTankSealCheck =
    isSubmitting && multiTankPayload ? getMultiTankSubmitSealCheck(multiTankPayload) : null

  const submitHasMissingTemp = Boolean(multiTankSealCheck?.missingTemp?.length)
  const submitMismatchCount = multiTankSealCheck?.mismatchCount || 0
  const submitNeedsRemarks = isSubmitting && submitMismatchCount > 0

  const remarksRequired = isReasonRequired || submitNeedsRemarks
  const remarksEmpty = !String(remarks || '').trim()

  const mandatoryMissing =
    isSubmitting && tankPayload
      ? getTankGaugingMandatoryMissing(tankPayload)
      : isSubmitting && multiTankPayload
        ? getMultiTankMandatoryMissing(multiTankPayload)
        : []

  const hasMandatoryMissing = mandatoryMissing.length > 0

  const requiresReviewTick = nextStatus === 'Submitted' || nextStatus === 'Approved'

  const canConfirm =
    !submitHasMissingTemp &&
    !hasMandatoryMissing &&
    (!remarksRequired || !remarksEmpty) &&
    (!requiresReviewTick || pendingReviewConfirmed)

  return (
    <div className="review-modal-backdrop">
      <div className="review-modal-card">
        <div className="review-modal-header">
          <div>
            <h3>Review Before {nextStatus}</h3>
            <p>
              Verify the entered data and calculated quantities before
              confirming this status action.
            </p>
          </div>

          <button type="button" onClick={onClose} disabled={statusLoading}>
            ×
          </button>
        </div>

        <div className="approval-review-grid">
          <div>
            <span>Ticket</span>
            <strong>{transaction.ticketNumber}</strong>
          </div>
          <div>
            <span>Convoy</span>
            <strong>{transaction.convoyNumber || '-'}</strong>
          </div>
          <div>
            <span>Current Status</span>
            <strong>{transaction.status}</strong>
          </div>

          <div>
            <span>Next Status</span>
            <strong>{nextStatus}</strong>
          </div>

          <div>
            <span>Operation</span>
            <strong>{transaction.operationTypeName}</strong>
          </div>

          <div>
            <span>Asset</span>
            <strong>
              {transaction.primaryAssetName} ({transaction.primaryAssetCode})
            </strong>
          </div>

          <div>
            <span>Location</span>
            <strong>
              {transaction.locationName} ({transaction.locationCode})
            </strong>
          </div>
        </div>

        {multiTankSealCheck ? (
          <div className="info-box">
            <div><strong>Seal Validation (Submit)</strong></div>

            {submitHasMissingTemp ? (
              <div style={{ marginTop: 6, color: '#b91c1c', fontWeight: 800 }}>
                Missing temporary AFTER seals: {multiTankSealCheck.missingTemp.join(', ')}.
                Please go back to Operation Entry, edit the Draft ticket, and enter them.
              </div>
            ) : (
              <div style={{ marginTop: 6 }}>
                Temporary seals: <strong>OK</strong>
              </div>
            )}

            <div style={{ marginTop: 6 }}>
              Mismatch count (Master vs Observed): <strong>{submitMismatchCount}</strong>
              {submitMismatchCount > 0 ? (
                <span style={{ marginLeft: 8, color: '#b91c1c', fontWeight: 800 }}>
                  Remarks required
                </span>
              ) : null}
            </div>
          </div>
        ) : null}

        {isSubmitting && hasMandatoryMissing ? (
          <div className="info-box">
            <div><strong>Mandatory Sections Missing</strong></div>
            <div style={{ marginTop: 6, color: '#b91c1c', fontWeight: 800 }}>
              {mandatoryMissing.slice(0, 12).join(', ')}
              {mandatoryMissing.length > 12 ? ' ...' : ''}
            </div>
            <div style={{ marginTop: 6 }}>
              Go back to Operation Entry, edit the Draft ticket, complete the missing fields, and retry Submit.
            </div>
          </div>
        ) : null}
        
        {tankPayload ? (
          <>
            <div className="section-title compact-section-title">
              <h3>Tank Gauging Summary</h3>
            </div>

            <TankCalculatedSummary calculated={calculated} />
          </>
        ) : multiTankPayload ? (
          <>
            <div className="section-title compact-section-title">
              <h3>Multi-Tank Before / After Summary</h3>
            </div>

            <MultiTankCalculatedSummary payload={multiTankPayload} />
          </>
        ) : shuttlePayload ? (
          <ShuttleCalculatedSummary payload={shuttlePayload} />
        ) : flowmeterPayload ? (
          <FlowmeterCalculatedSummary payload={flowmeterPayload} />
        ) : (
          <div className="info-box">
            No asset-specific payload found. Please review the saved field values below before confirming.
          </div>
        )}

        {isReasonRequired && (
          <div className="full-width-field">
            <label>
              Reason / Remarks <span className="warning-text">*</span>
            </label>
            <textarea
              value={remarks}
              onChange={(e) => onRemarksChange(e.target.value)}
              rows="3"
              placeholder={`Enter reason for ${nextStatus}`}
            />
          </div>
        )}

        {!isReasonRequired && (
          <div className="full-width-field">
            <label>Approval / Submission Remarks</label>
            <textarea
              value={remarks}
              onChange={(e) => onRemarksChange(e.target.value)}
              rows="3"
              placeholder="Optional remarks"
            />
          </div>
        )}

        {requiresReviewTick ? (
          <div className="info-box" style={{ marginTop: 10 }}>
            <label style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={pendingReviewConfirmed}
                onChange={(e) => setPendingReviewConfirmed(e.target.checked)}
              />
              <strong>I have reviewed the entered data and calculated quantities</strong>
            </label>
            <div style={{ marginTop: 6, opacity: 0.85, fontSize: 12 }}>
              Mandatory for Submit/Approve.
            </div>
          </div>
        ) : null}

        <div className="form-actions">
          <button type="button" onClick={onConfirm} disabled={statusLoading || !canConfirm}>
            {statusLoading ? 'Processing...' : `Confirm ${nextStatus}`}
          </button>

          <button type="button" onClick={onClose} disabled={statusLoading}>
            Go Back and Review
          </button>
        </div>
      </div>
    </div>
  )
}

function PrintableTankGaugingReport({
  transaction,
  tankPayload,
  statusHistory,
  loggedInUser,
  reportSettings,
}) {
  if (!transaction || !tankPayload) {
    return null
  }

  const inputs = tankPayload.inputs || {}
  const calculated = tankPayload.calculated || {}

  const generatedAt = new Date().toLocaleString()

  const printedBy = loggedInUser
    ? `${loggedInUser.fullName} (${loggedInUser.username})`
    : 'Unknown User'

  const reportReference = `TGR-${transaction.ticketNumber}`

  const latestStatus = statusHistory && statusHistory.length > 0
    ? statusHistory[statusHistory.length - 1]
    : null

  return (
    <div className="printable-report">
      <div className="print-report-header">
        <div className="print-company-block">
          {reportSettings.logoUrl ? (
            <img
              src={reportSettings.logoUrl}
              alt={`${reportSettings.companyName} Logo`}
              className="print-company-logo"
            />
          ) : (
            <div className="print-logo-placeholder">
              {reportSettings.logoText || 'LOGO'}
            </div>
          )}

          <div>
            <h1>{reportSettings.companyName}</h1>
            <p>{reportSettings.systemName}</p>
            <p>{reportSettings.reportSubtitle}</p>
          </div>
        </div>

        <div className="print-report-ticket">
          <strong>{reportReference}</strong>
          <span>{transaction.status}</span>
          <small>Ticket: {transaction.ticketNumber}</small>
        </div>
      </div>

      <div className="print-report-section">
        <h2>Ticket Information</h2>

        <table>
          <tbody>
            <tr>
              <th>Ticket Number</th>
              <td>{transaction.ticketNumber}</td>
              <th>Status</th>
              <td>{transaction.status}</td>
            </tr>
            <tr>
              <th>Convoy Number</th>
              <td colSpan="3">{transaction.convoyNumber || '-'}</td>
            </tr>
            <tr>
              <th>Operation Date</th>
              <td>{transaction.operationDate}</td>
              <th>Operation Type</th>
              <td>{transaction.operationTypeName}</td>
            </tr>

            <tr>
              <th>Location</th>
              <td>
                {transaction.locationName} ({transaction.locationCode})
              </td>
              <th>Primary Asset</th>
              <td>
                {transaction.primaryAssetName} ({transaction.primaryAssetCode})
              </td>
            </tr>

            <tr>
              <th>Created By</th>
              <td>{transaction.createdBy || '-'}</td>
              <th>Created At</th>
              <td>{transaction.createdAt || '-'}</td>
            </tr>
            <tr>
              <th>Report Reference</th>
              <td>{reportReference}</td>
              <th>Generated At</th>
              <td>{generatedAt}</td>
            </tr>

            <tr>
              <th>Printed By</th>
              <td colSpan="3">{printedBy}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="print-report-section">
        <h2>Tank Gauging Input</h2>

        <table>
          <tbody>
            <tr>
              <th>Gauging Date</th>
              <td>{inputs.gaugingDate || '-'}</td>
              <th>Gauging Time</th>
              <td>{inputs.gaugingTime || '-'}</td>
            </tr>

            <tr>
              <th>Dip</th>
              <td>{formatValue(inputs.dipCm)} cm</td>
              <th>Water Level</th>
              <td>{formatValue(inputs.waterLevelCm)} cm</td>
            </tr>

            <tr>
              <th>Tank Temperature</th>
              <td>
                {formatValue(inputs.tankTemperature)} °
                {inputs.tankTemperatureUnit || ''}
              </td>
              <th>Sample Temperature</th>
              <td>
                {formatValue(inputs.sampleTemperature)} °
                {inputs.sampleTemperatureUnit || ''}
              </td>
            </tr>

            <tr>
              <th>Observed Input Type</th>
              <td>{inputs.observedInputType || '-'}</td>
              <th>BS&W</th>
              <td>{formatValue(inputs.bswPercent)}%</td>
            </tr>

            <tr>
              <th>Observed API</th>
              <td>{formatValue(inputs.observedApi)}</td>
              <th>Observed Density</th>
              <td>{formatValue(inputs.observedDensity)} kg/m³</td>
            </tr>

            <tr>
              <th>Remarks</th>
              <td colSpan="3">{inputs.remarks || '-'}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="print-report-section">
        <h2>Calculated Quantity Summary</h2>

        <table>
          <tbody>
            <tr>
              <th>TOV</th>
              <td>{formatValue(calculated.tovBbl)} bbl</td>
              <th>Free Water</th>
              <td>{formatValue(calculated.freeWaterBbl)} bbl</td>
            </tr>

            <tr>
              <th>GOV</th>
              <td>{formatValue(calculated.govBbl)} bbl</td>
              <th>VCF</th>
              <td>{formatValue(calculated.vcf, 5)}</td>
            </tr>

            <tr>
              <th>GSV</th>
              <td>{formatValue(calculated.gsvBbl, 0)} bbl</td>
              <th>BS&W Volume</th>
              <td>{formatValue(calculated.bswBbl, 0)} bbl</td>
            </tr>

            <tr>
              <th>NSV</th>
              <td>{formatValue(calculated.nsvBbl, 0)} bbl</td>
              <th>Density @ 15°C</th>
              <td>{formatValue(calculated.density15)} kg/m³</td>
            </tr>

            <tr>
              <th>API @ 60°F</th>
              <td>{formatValue(calculated.api60)}</td>
              <th>LT Factor</th>
              <td>{formatValue(calculated.ltFactor, 8)}</td>
            </tr>

            <tr>
              <th>Table 11 Method</th>
              <td>{calculated.table11LookupMethod || '-'}</td>
              <th>Mass Method</th>
              <td>{calculated.massMethod || '-'}</td>
            </tr>

            <tr>
              <th>Lower API @ 60°F</th>
              <td>{formatValue(calculated.table11LowerApi60)}</td>
              <th>Upper API @ 60°F</th>
              <td>{formatValue(calculated.table11UpperApi60)}</td>
            </tr>

            <tr>
              <th>LT</th>
              <td>{formatValue(calculated.lt, 0)}</td>
              <th>MT</th>
              <td>{formatValue(calculated.mt, 0)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="print-report-section">
        <h2>Status / Approval Information</h2>

        <table>
          <tbody>
            <tr>
              <th>Current Status</th>
              <td>{transaction.status}</td>
              <th>Latest Changed By</th>
              <td>{latestStatus?.changedBy || '-'}</td>
            </tr>

            <tr>
              <th>Latest Changed At</th>
              <td>{latestStatus?.changedAt || '-'}</td>
              <th>Latest Remarks</th>
              <td>{latestStatus?.remarks || '-'}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="print-report-section signature-report-section">
        <h2>Verification / Approval</h2>

        <div className="print-signature-section">
          <div>
            <span>Prepared By</span>
            <p>Name:</p>
            <p>Signature:</p>
            <p>Date:</p>
          </div>

          <div>
            <span>Checked By</span>
            <p>Name:</p>
            <p>Signature:</p>
            <p>Date:</p>
          </div>

          <div>
            <span>Approved By</span>
            <p>Name:</p>
            <p>Signature:</p>
            <p>Date:</p>
          </div>
        </div>
      </div>

      <div className="print-report-footer">
        <p>{reportSettings.footerFormula}</p>
        <p>{reportSettings.footerNote}</p>
      </div>
    </div>
  )
}

function PrintableMultiTankReport({
  transaction,
  multiTankPayload,
  statusHistory,
  loggedInUser,
  reportSettings,
}) {
  if (!transaction || !multiTankPayload) {
    return null
  }

  const inputs = multiTankPayload.inputs || {}
  const beforeInputs = inputs.before || {}
  const afterInputs = inputs.after || {}

  const computed = multiTankPayload.calculated || {}
  const before = computed.before || {}
  const after = computed.after || {}
  const net = computed.net || {}

  const perTank = multiTankPayload.perTank || {}
  const perBefore = perTank.before || {}
  const perAfter = perTank.after || {}

  const tankIds =
    Array.isArray(multiTankPayload.meta?.tankIds) && multiTankPayload.meta.tankIds.length > 0
      ? multiTankPayload.meta.tankIds
      : Object.keys(perBefore || {}).length > 0
        ? Object.keys(perBefore || {})
        : Object.keys(beforeInputs.dips || {})

  const generatedAt = new Date().toLocaleString()

  const printedBy = loggedInUser
    ? `${loggedInUser.fullName} (${loggedInUser.username})`
    : 'Unknown User'

  const reportReference = `MTR-${transaction.ticketNumber}`

  const latestStatus =
    statusHistory && statusHistory.length > 0
      ? statusHistory[statusHistory.length - 1]
      : null

  return (
    <div className="printable-report">
      <div className="print-report-header">
        <div className="print-company-block">
          {reportSettings.logoUrl ? (
            <img
              src={reportSettings.logoUrl}
              alt={`${reportSettings.companyName} Logo`}
              className="print-company-logo"
            />
          ) : (
            <div className="print-logo-placeholder">
              {reportSettings.logoText || 'LOGO'}
            </div>
          )}

          <div>
            <h1>{reportSettings.companyName}</h1>
            <p>{reportSettings.systemName}</p>
            <p>{reportSettings.reportSubtitle || 'Multi-Tank Quantity Report'}</p>
          </div>
        </div>

        <div className="print-report-ticket">
          <strong>{reportReference}</strong>
          <span>{transaction.status}</span>
          <small>Ticket: {transaction.ticketNumber}</small>
        </div>
      </div>

      <div className="print-report-section">
        <h2>Ticket Information</h2>

        <table>
          <tbody>
            <tr>
              <th>Ticket Number</th>
              <td>{transaction.ticketNumber}</td>
              <th>Status</th>
              <td>{transaction.status}</td>
            </tr>
            <tr>
              <th>Convoy Number</th>
              <td colSpan="3">{transaction.convoyNumber || '-'}</td>
            </tr>
            <tr>
              <th>Operation Date</th>
              <td>{transaction.operationDate}</td>
              <th>Operation Type</th>
              <td>{transaction.operationTypeName}</td>
            </tr>

            <tr>
              <th>Location</th>
              <td>
                {transaction.locationName} ({transaction.locationCode})
              </td>
              <th>Primary Asset</th>
              <td>
                {transaction.primaryAssetName} ({transaction.primaryAssetCode})
              </td>
            </tr>

            <tr>
              <th>Created By</th>
              <td>{transaction.createdBy || '-'}</td>
              <th>Created At</th>
              <td>{transaction.createdAt || '-'}</td>
            </tr>

            <tr>
              <th>Report Reference</th>
              <td>{reportReference}</td>
              <th>Generated At</th>
              <td>{generatedAt}</td>
            </tr>

            <tr>
              <th>Printed By</th>
              <td colSpan="3">{printedBy}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="print-report-section">
        <h2>Multi-Tank Parameters</h2>

        <table>
          <tbody>
            <tr>
              <th>Before Date/Time</th>
              <td>
                {beforeInputs.date || '-'} {beforeInputs.time || ''}
              </td>
              <th>After Date/Time</th>
              <td>
                {afterInputs.date || '-'} {afterInputs.time || ''}
              </td>
            </tr>

            <tr>
              <th>CCF (Before)</th>
              <td>{formatValue(beforeInputs.ccf, 4)}</td>
              <th>CCF (After)</th>
              <td>{formatValue(afterInputs.ccf, 4)}</td>
            </tr>

            <tr>
              <th>Observed Mode (Before)</th>
              <td>{beforeInputs.obsMode || '-'}</td>
              <th>Observed Mode (After)</th>
              <td>{afterInputs.obsMode || '-'}</td>
            </tr>

            <tr>
              <th>Tank Temp (Before)</th>
              <td>
                {formatValue(beforeInputs.tankTemp)} {beforeInputs.tankTempUnit || ''}
              </td>
              <th>Tank Temp (After)</th>
              <td>
                {formatValue(afterInputs.tankTemp)} {afterInputs.tankTempUnit || ''}
              </td>
            </tr>

            <tr>
              <th>Sample Temp (Before)</th>
              <td>
                {formatValue(beforeInputs.sampleTemp)} {beforeInputs.sampleTempUnit || ''}
              </td>
              <th>Sample Temp (After)</th>
              <td>
                {formatValue(afterInputs.sampleTemp)} {afterInputs.sampleTempUnit || ''}
              </td>
            </tr>

            <tr>
              <th>BS&W % (Before)</th>
              <td>{formatValue(beforeInputs.bswPct)}%</td>
              <th>BS&W % (After)</th>
              <td>{formatValue(afterInputs.bswPct)}%</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="print-report-section">
        <h2>Tank Dip Summary</h2>

        <table>
          <thead>
            <tr>
              <th>Tank</th>
              <th>Before Total</th>
              <th>Before Water</th>
              <th>After Total</th>
              <th>After Water</th>
              <th>Net TOV</th>
              <th>Net FW</th>
            </tr>
          </thead>
          <tbody>
            {tankIds.map((tid) => {
              const bDip = beforeInputs.dips?.[tid] || {}
              const aDip = afterInputs.dips?.[tid] || {}

              const bCalc = perBefore[tid] || {}
              const aCalc = perAfter[tid] || {}

              const netTov = (aCalc.tovCorrected || 0) - (bCalc.tovCorrected || 0)
              const netFw = (aCalc.fwCorrected || 0) - (bCalc.fwCorrected || 0)

              return (
                <tr key={tid}>
                  <td><strong>{tid}</strong></td>
                  <td>{formatValue(bDip.total, 2)}</td>
                  <td>{formatValue(bDip.water, 2)}</td>
                  <td>{formatValue(aDip.total, 2)}</td>
                  <td>{formatValue(aDip.water, 2)}</td>
                  <td><strong>{formatValue(netTov, 2)}</strong></td>
                  <td><strong>{formatValue(netFw, 2)}</strong></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="print-report-section">
        <h2>Seal Details — After</h2>

        {multiTankPayload?.seals?.after ? (
          <>
            <h3 style={{ marginTop: 8 }}>Permanent Tank Seals (Master vs Observed)</h3>
            <table>
              <thead>
                <tr>
                  <th>Tank</th>
                  <th>MH1</th>
                  <th>MH2</th>
                  <th>LOCK</th>
                  <th>DIPHATCH</th>
                </tr>
              </thead>
              <tbody>
                {(tankIds || []).map((tid) => {
                  const t = multiTankPayload.seals.after.tankSeals?.[tid] || {}
                  const cell = (pos) => t?.[pos] || { master: '', observed: '' }
                  const fmt = (x) => (String(x || '').trim() === '' ? '-' : String(x).trim())

                  return (
                    <tr key={`mtr-seal-${tid}`}>
                      <td><strong>{tid}</strong></td>
                      {['MH1','MH2','LOCK','DIPHATCH'].map((pos) => {
                        const c = cell(pos)
                        const mismatch = c.master && c.observed && c.master !== c.observed
                        return (
                          <td key={`${tid}-${pos}`}>
                            <div><strong>M:</strong> {fmt(c.master)}</div>
                            <div style={{ color: mismatch ? '#b91c1c' : 'inherit', fontWeight: mismatch ? 900 : 700 }}>
                              <strong>O:</strong> {fmt(c.observed)}
                            </div>
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>

            <h3 style={{ marginTop: 14 }}>Temporary Seals (Per Ticket)</h3>
            <table>
              <tbody>
                <tr>
                  <th>Port Manifold</th>
                  <td>{multiTankPayload.seals.after.temporary?.portManifoldSeal || '-'}</td>
                  <th>Starboard Manifold</th>
                  <td>{multiTankPayload.seals.after.temporary?.stbdManifoldSeal || '-'}</td>
                </tr>
                <tr>
                  <th>Pumproom</th>
                  <td>{multiTankPayload.seals.after.temporary?.pumproomSeal || '-'}</td>
                  <th>Other</th>
                  <td>{multiTankPayload.seals.after.temporary?.otherSeal || '-'}</td>
                </tr>
                <tr>
                  <th>Other Remarks</th>
                  <td colSpan="3">{multiTankPayload.seals.after.temporary?.otherRemarks || '-'}</td>
                </tr>
              </tbody>
            </table>
          </>
        ) : (
          <div className="info-box">
            No seal details were captured for this ticket.
          </div>
        )}
      </div>
      <div className="print-report-section">
        <h2>Calculated Quantity Summary</h2>

        <table>
          <tbody>
            <tr>
              <th>TOV</th>
              <td>{formatValue(before.TOV, 2)} bbl</td>
              <th>TOV</th>
              <td>{formatValue(after.TOV, 2)} bbl</td>
            </tr>

            <tr>
              <th>FW</th>
              <td>{formatValue(before.FW, 2)} bbl</td>
              <th>FW</th>
              <td>{formatValue(after.FW, 2)} bbl</td>
            </tr>

            <tr>
              <th>GOV</th>
              <td>{formatValue(before.GOV, 2)} bbl</td>
              <th>GOV</th>
              <td>{formatValue(after.GOV, 2)} bbl</td>
            </tr>

            <tr>
              <th>NSV</th>
              <td>{formatValue(before.NSV, 0)} bbl</td>
              <th>NSV</th>
              <td>{formatValue(after.NSV, 0)} bbl</td>
            </tr>

            <tr>
              <th>LT</th>
              <td>{formatValue(before.LT, 0)}</td>
              <th>LT</th>
              <td>{formatValue(after.LT, 0)}</td>
            </tr>

            <tr>
              <th>MT</th>
              <td>{formatValue(before.MT, 0)}</td>
              <th>MT</th>
              <td>{formatValue(after.MT, 0)}</td>
            </tr>

            <tr>
              <th>Net NSV</th>
              <td colSpan="3"><strong>{formatValue(net.NSV, 0)}</strong> bbl</td>
            </tr>

            <tr>
              <th>Net LT</th>
              <td>{formatValue(net.LT, 0)}</td>
              <th>Net MT</th>
              <td>{formatValue(net.MT, 0)}</td>
            </tr>

            <tr>
              <th>LT Factor (Before)</th>
              <td>{formatValue(before.ltFactor, 8)}</td>
              <th>LT Factor (After)</th>
              <td>{formatValue(after.ltFactor, 8)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="print-report-section">
        <h2>Status / Approval Information</h2>

        <table>
          <tbody>
            <tr>
              <th>Current Status</th>
              <td>{transaction.status}</td>
              <th>Latest Changed By</th>
              <td>{latestStatus?.changedBy || '-'}</td>
            </tr>

            <tr>
              <th>Latest Changed At</th>
              <td>{latestStatus?.changedAt || '-'}</td>
              <th>Latest Remarks</th>
              <td>{latestStatus?.remarks || '-'}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="print-report-section signature-report-section">
        <h2>Verification / Approval</h2>

        <div className="print-signature-section">
          <div>
            <span>Prepared By</span>
            <p>Name:</p>
            <p>Signature:</p>
            <p>Date:</p>
          </div>

          <div>
            <span>Checked By</span>
            <p>Name:</p>
            <p>Signature:</p>
            <p>Date:</p>
          </div>

          <div>
            <span>Approved By</span>
            <p>Name:</p>
            <p>Signature:</p>
            <p>Date:</p>
          </div>
        </div>
      </div>

      <div className="print-report-footer">
        <p>{reportSettings.footerFormula}</p>
        <p>{reportSettings.footerNote}</p>
      </div>
    </div>
  )
}

function OperationTransactionDetail({ loggedInUser }) {
  const { transactionId } = useParams()
  const navigate = useNavigate()

  const [transaction, setTransaction] = useState(null)
  const [statusHistory, setStatusHistory] = useState([])
  const [correctionRequests, setCorrectionRequests] = useState([])
  const [loading, setLoading] = useState(false)
  const [statusLoading, setStatusLoading] = useState(false)
  const [correctionLoading, setCorrectionLoading] = useState(false)
  const [showCorrectionForm, setShowCorrectionForm] = useState(false)
  const [correctionForm, setCorrectionForm] = useState({
    requestType: 'Data Correction',
    suggestedAction: 'Reopen for Edit',
    reason: '',
  })

  const [pendingStatus, setPendingStatus] = useState('')
  const [pendingRemarks, setPendingRemarks] = useState('')
  const [pendingReviewConfirmed, setPendingReviewConfirmed] = useState(false)
  const [workflowActionAllow, setWorkflowActionAllow] = useState({})
  const [reportProfiles, setReportProfiles] = useState([])
  const [selectedReportProfileName, setSelectedReportProfileName] = useState(
    loadSelectedReportProfileName
  )
  const [reportSettings, setReportSettings] = useState(defaultReportSettings)
  const [reportProfilesLoading, setReportProfilesLoading] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const reloadReportProfiles = async (preferredProfileName = '') => {
    try {
      setReportProfilesLoading(true)

      const profilesFromApi = await getCompanyReportProfiles()

      const activeProfiles = profilesFromApi.filter((profile) => {
        return profile.status === 'Active'
      })

      setReportProfiles(activeProfiles)

      const savedSelectedName =
        preferredProfileName ||
        loadSelectedReportProfileName() ||
        defaultReportSettings.profileName

      const selectedProfile =
        activeProfiles.find((profile) => {
          return profile.profileName === savedSelectedName
        }) ||
        activeProfiles[0] ||
        defaultReportSettings

      saveSelectedReportProfileName(selectedProfile.profileName)
      setSelectedReportProfileName(selectedProfile.profileName)
      setReportSettings(selectedProfile)

      return activeProfiles
    } catch (error) {
      setErrorMsg(error.message)
      setReportProfiles([])
      setSelectedReportProfileName(defaultReportSettings.profileName)
      setReportSettings(defaultReportSettings)

      return []
    } finally {
      setReportProfilesLoading(false)
    }
  }

  const handleReportProfileChange = (profileName) => {
    const selectedProfile = reportProfiles.find((profile) => {
      return profile.profileName === profileName
    })

    if (!selectedProfile) {
      return
    }

    saveSelectedReportProfileName(profileName)
    setSelectedReportProfileName(profileName)
    setReportSettings(selectedProfile)
  }
  const isAdminBootstrap =
    String(loggedInUser?.username || '').toLowerCase() === 'admin'

  const hasPermission = (permissionName) => {
    if (isAdminBootstrap) return true
    if (!loggedInUser || !Array.isArray(loggedInUser.permissions)) return false
    return loggedInUser.permissions.some(
      (p) => p.permissionName === permissionName
    )
  }

  const canViewTransaction = hasPermission('View Operation Transaction')
  const canSubmitTransactionBase = hasPermission('Submit Operation Transaction')
  const canApproveTransactionBase = hasPermission('Approve Operation Transaction')
  const canRejectTransactionBase = hasPermission('Reject Operation Transaction')
  const canCancelTransactionBase = hasPermission('Cancel Operation Transaction')
  const canRequestApprovedCorrection =
    hasPermission('Request Approved Transaction Correction') ||
    canApproveTransactionBase

  const canSubmitTransaction =
    canSubmitTransactionBase && (workflowActionAllow.SUBMIT ?? true)
  const canApproveTransaction =
    canApproveTransactionBase && (workflowActionAllow.APPROVE ?? true)
  const canRejectTransaction =
    canRejectTransactionBase && (workflowActionAllow.REJECT ?? true)
  const canCancelTransaction =
    canCancelTransactionBase && (workflowActionAllow.CANCEL ?? true)
  const canRecallTransaction =
    canSubmitTransactionBase && (workflowActionAllow.RECALL ?? true)

  const tankPayload = useMemo(() => {
    return getTankPayloadFromTransaction(transaction)
  }, [transaction])
  
  const multiTankPayload = useMemo(() => {
    return getMultiTankPayloadFromTransaction(transaction)
  }, [transaction])

  const shuttlePayload = useMemo(() => {
    return getShuttlePayloadFromTransaction(transaction)
  }, [transaction])

  const flowmeterPayload = useMemo(() => {
    return getFlowmeterPayloadFromTransaction(transaction)
  }, [transaction])

  const hasTankerPayload = (transaction?.fieldValues || []).some((value) => {
    return value.fieldCode === 'tanker_payload'
  })

  const hasPrintablePayload = Boolean(tankPayload || multiTankPayload)
  
  const loadTransactionDetail = async () => {
    try {
      setLoading(true)
      const data = await getOperationTransactionDetail(transactionId)
      setTransaction(data)
    } catch (error) {
      setErrorMsg(error.message)
    } finally {
      setLoading(false)
    }
  }

  const loadStatusHistory = async () => {
    try {
      const data = await getOperationTransactionStatusHistory(transactionId)
      setStatusHistory(data)
    } catch (error) {
      setErrorMsg(error.message)
    }
  }

  const loadCorrectionRequests = async () => {
    try {
      const data = await getOperationTransactionCorrectionRequests(transactionId)
      setCorrectionRequests(data || [])
    } catch (error) {
      setCorrectionRequests([])
    }
  }

  useEffect(() => {
    loadTransactionDetail()
    loadStatusHistory()
    loadCorrectionRequests()
    reloadReportProfiles()
  }, [transactionId])

  useEffect(() => {
    const loadWorkflowChecks = async () => {
      if (!transaction?.id) return
      const payloadBase = {
        operation_type_code: transaction.operationTypeCode || null,
        operation_template_id: transaction.operationTemplateId || null,
        asset_type_code: transaction.primaryAssetTypeCode || null,
        location_code: transaction.locationCode || null,
      }
      const actions = ['SUBMIT', 'APPROVE', 'REJECT', 'CANCEL', 'RECALL']
      const out = {}
      for (const action of actions) {
        try {
          const res = await checkOperationWorkflowPolicy({
            action_code: action,
            ...payloadBase,
          })
          out[action] = Boolean(res?.allowed)
        } catch {
          out[action] = true
        }
      }
      setWorkflowActionAllow(out)
    }
    loadWorkflowChecks()
  }, [transaction?.id, transaction?.operationTypeCode, transaction?.operationTemplateId, transaction?.primaryAssetTypeCode, transaction?.locationCode])

  const getChangedByDisplay = () => {
    if (!loggedInUser) {
      return 'Unknown User'
    }

    return `${loggedInUser.fullName} (${loggedInUser.username})`
  }

  const openReviewModal = (nextStatus) => {
    if (!loggedInUser) {
      setErrorMsg('Please login before changing status.')
      return
    }

    if (
      (nextStatus === 'Submitted' || nextStatus === 'Draft') &&
      !((nextStatus === 'Draft' ? canRecallTransaction : canSubmitTransaction))
    ) {
      setErrorMsg('You do not have permission to submit or recall operation transactions.')
      return
    }

    if (nextStatus === 'Approved' && !canApproveTransaction) {
      setErrorMsg('You do not have permission to approve operation transactions.')
      return
    }

    if (nextStatus === 'Rejected' && !canRejectTransaction) {
      setErrorMsg('You do not have permission to reject operation transactions.')
      return
    }

    if (nextStatus === 'Cancelled' && !canCancelTransaction) {
      setErrorMsg('You do not have permission to cancel operation transactions.')
      return
    }

    let defaultRemarks = ''

    if (nextStatus === 'Submitted') {
      defaultRemarks = 'Submitted for approval after review'
    }

    if (nextStatus === 'Approved') {
      defaultRemarks = 'Approved after data review'
    }

    setPendingStatus(nextStatus)
    setPendingRemarks(defaultRemarks)
    setPendingReviewConfirmed(false)
  }

  const closeReviewModal = () => {
    setPendingStatus('')
    setPendingRemarks('')
    setPendingReviewConfirmed(false)
  }

  const formatCsvValue = (value) => {
    if (value === null || value === undefined) {
      return ''
    }

    const text = String(value).replace(/"/g, '""')
    return `"${text}"`
  }

  const handleExportTankGaugingCsv = () => {
    if (!transaction || !tankPayload) {
      setErrorMsg('No Tank Gauging data available to export.')
      return
    }

    const inputs = tankPayload.inputs || {}
    const calculated = tankPayload.calculated || {}

    const latestStatus =
      statusHistory && statusHistory.length > 0
        ? statusHistory[statusHistory.length - 1]
        : null

    const csvRows = [
      [formatCsvValue('Tank Gauging Transaction Report')].join(','),
      [
        formatCsvValue('Generated At'),
        formatCsvValue(new Date().toLocaleString()),
      ].join(','),
      ''.trim(),

      [formatCsvValue('Ticket Information')].join(','),
      [formatCsvValue('Ticket Number'), formatCsvValue(transaction.ticketNumber)].join(','),
      [formatCsvValue('Status'), formatCsvValue(transaction.status)].join(','),
      [formatCsvValue('Operation Date'), formatCsvValue(transaction.operationDate)].join(','),
      [formatCsvValue('Operation Type'), formatCsvValue(transaction.operationTypeName)].join(','),
      [
        formatCsvValue('Location'),
        formatCsvValue(`${transaction.locationName} (${transaction.locationCode})`),
      ].join(','),
      [
        formatCsvValue('Primary Asset'),
        formatCsvValue(
          `${transaction.primaryAssetName} (${transaction.primaryAssetCode})`
        ),
      ].join(','),
      [formatCsvValue('Created By'), formatCsvValue(transaction.createdBy || '-')].join(','),
      [formatCsvValue('Created At'), formatCsvValue(transaction.createdAt || '-')].join(','),
      ''.trim(),

      [formatCsvValue('Tank Gauging Inputs')].join(','),
      [formatCsvValue('Gauging Date'), formatCsvValue(inputs.gaugingDate || '-')].join(','),
      [formatCsvValue('Gauging Time'), formatCsvValue(inputs.gaugingTime || '-')].join(','),
      [formatCsvValue('Dip cm'), formatCsvValue(inputs.dipCm)].join(','),
      [formatCsvValue('Water Level cm'), formatCsvValue(inputs.waterLevelCm)].join(','),
      [
        formatCsvValue('Tank Temperature'),
        formatCsvValue(
          `${formatValue(inputs.tankTemperature)} °${inputs.tankTemperatureUnit || ''}`
        ),
      ].join(','),
      [formatCsvValue('Observed Input Type'), formatCsvValue(inputs.observedInputType || '-')].join(','),
      [formatCsvValue('Observed API'), formatCsvValue(inputs.observedApi)].join(','),
      [
        formatCsvValue('Observed Density kg/m3'),
        formatCsvValue(inputs.observedDensity),
      ].join(','),
      [
        formatCsvValue('Sample Temperature'),
        formatCsvValue(
          `${formatValue(inputs.sampleTemperature)} °${inputs.sampleTemperatureUnit || ''}`
        ),
      ].join(','),
      [formatCsvValue('BS&W %'), formatCsvValue(inputs.bswPercent)].join(','),
      [formatCsvValue('Remarks'), formatCsvValue(inputs.remarks || '-')].join(','),
      ''.trim(),

      [formatCsvValue('Calculated Quantity Summary')].join(','),
      [formatCsvValue('TOV bbl'), formatCsvValue(calculated.tovBbl)].join(','),
      [formatCsvValue('Free Water bbl'), formatCsvValue(calculated.freeWaterBbl)].join(','),
      [formatCsvValue('GOV bbl'), formatCsvValue(calculated.govBbl)].join(','),
      [formatCsvValue('Observed API'), formatCsvValue(calculated.observedApi)].join(','),
      [
        formatCsvValue('Observed Density kg/m3'),
        formatCsvValue(calculated.observedDensity),
      ].join(','),
      [formatCsvValue('API @ 60F'), formatCsvValue(calculated.api60)].join(','),
      [
        formatCsvValue('Density @ 15C kg/m3'),
        formatCsvValue(calculated.density15),
      ].join(','),
      [formatCsvValue('VCF'), formatCsvValue(calculated.vcf)].join(','),
      [formatCsvValue('GSV bbl'), formatCsvValue(calculated.gsvBbl)].join(','),
      [formatCsvValue('BS&W Volume bbl'), formatCsvValue(calculated.bswBbl)].join(','),
      [formatCsvValue('NSV bbl'), formatCsvValue(calculated.nsvBbl)].join(','),
      [formatCsvValue('LT Factor'), formatCsvValue(calculated.ltFactor)].join(','),
      [
        formatCsvValue('Table 11 Method'),
        formatCsvValue(calculated.table11LookupMethod || '-'),
      ].join(','),
      [
        formatCsvValue('Lower API @ 60F'),
        formatCsvValue(calculated.table11LowerApi60),
      ].join(','),
      [
        formatCsvValue('Upper API @ 60F'),
        formatCsvValue(calculated.table11UpperApi60),
      ].join(','),
      [formatCsvValue('LT'), formatCsvValue(calculated.lt)].join(','),
      [formatCsvValue('MT'), formatCsvValue(calculated.mt)].join(','),
      [
        formatCsvValue('Mass Method'),
        formatCsvValue(calculated.massMethod || '-'),
      ].join(','),
      ''.trim(),

      [formatCsvValue('Status / Approval Information')].join(','),
      [formatCsvValue('Current Status'), formatCsvValue(transaction.status)].join(','),
      [
        formatCsvValue('Latest Changed By'),
        formatCsvValue(latestStatus?.changedBy || '-'),
      ].join(','),
      [
        formatCsvValue('Latest Changed At'),
        formatCsvValue(latestStatus?.changedAt || '-'),
      ].join(','),
      [
        formatCsvValue('Latest Remarks'),
        formatCsvValue(latestStatus?.remarks || '-'),
      ].join(','),
    ]

    const csvContent = csvRows.join('\n')
    const blob = new Blob([csvContent], {
      type: 'text/csv;charset=utf-8;',
    })

    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')

    link.href = url
    link.download = `tank-gauging-${transaction.ticketNumber}.csv`

    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const confirmStatusChange = async () => {
    if (!pendingStatus) {
      return
    }

    const hasTankerPayload = (transaction?.fieldValues || []).some((value) => {
      return value.fieldCode === 'tanker_payload' && value.fieldValue
    })

    const isTankerTicket =
      String(transaction?.entryLayoutType || '')
        .toLowerCase()
        .includes('tanker') ||
      String(transaction?.calculationEngine || '')
        .toLowerCase()
        .includes('tanker') ||
      (transaction?.fieldValues || []).some((value) => {
        return value.fieldCode === 'tanker_payload'
      })

    if (pendingStatus === 'Approved' && isTankerTicket && !hasTankerPayload) {
      setErrorMsg(
        'Cannot approve this tanker ticket because tanker_payload is missing. Please return it to Draft and complete the tanker entry.'
      )
      return
    }

    const reasonRequired =
      pendingStatus === 'Rejected' ||
      pendingStatus === 'Cancelled' ||
      pendingStatus === 'Draft'

    if (reasonRequired && pendingRemarks.trim() === '') {
      setErrorMsg('Reason / remarks is required for this action.')
      return
    }

    try {
      setStatusLoading(true)

      await updateOperationTransactionStatus(
        transaction.id,
        pendingStatus,
        pendingRemarks,
        pendingReviewConfirmed
      )

      await loadTransactionDetail()
      await loadStatusHistory()

      setSuccessMsg(`Transaction status changed to ${pendingStatus}`)
      closeReviewModal()
    } catch (error) {
      setErrorMsg(error.message)
    } finally {
      setStatusLoading(false)
    }
  }

  const pendingCorrectionRequest = correctionRequests.find((request) => {
    return request.status === 'Pending Admin Review'
  })

  const latestApprovalTime = statusHistory
    .filter((item) => item.newStatus === 'Approved' && item.changedAt)
    .map((item) => new Date(item.changedAt))
    .filter((item) => !Number.isNaN(item.getTime()))
    .sort((left, right) => right.getTime() - left.getTime())[0]

  const approvedCorrectionDeadline = latestApprovalTime
    ? new Date(latestApprovalTime.getTime() + 24 * 60 * 60 * 1000)
    : null

  const approvedCorrectionExpired =
    transaction?.status === 'Approved' &&
    approvedCorrectionDeadline &&
    new Date() > approvedCorrectionDeadline

  const handleCorrectionFormChange = (fieldName, value) => {
    setCorrectionForm((current) => ({
      ...current,
      [fieldName]: value,
    }))
    if (errorMsg) setErrorMsg('')
  }

  const submitCorrectionRequest = async () => {
    if (!transaction || transaction.status !== 'Approved') {
      setErrorMsg('Only approved tickets can be marked for correction.')
      return
    }

    if (!canRequestApprovedCorrection) {
      setErrorMsg('You need approval access to request approved transaction correction.')
      return
    }

    if (approvedCorrectionExpired) {
      setErrorMsg('Approved transaction correction window expired after 24 hours.')
      return
    }

    if (correctionForm.reason.trim() === '') {
      setErrorMsg('Reason / justification is required.')
      return
    }

    try {
      setCorrectionLoading(true)
      await createOperationTransactionCorrectionRequest(transaction.id, correctionForm)
      await loadCorrectionRequests()
      setShowCorrectionForm(false)
      setCorrectionForm({
        requestType: 'Data Correction',
        suggestedAction: 'Reopen for Edit',
        reason: '',
      })
      setSuccessMsg('Approved transaction correction request sent to admin.')
    } catch (error) {
      setErrorMsg(error.message)
    } finally {
      setCorrectionLoading(false)
    }
  }

  const renderDisabledMessage = (message) => {
    return <span className="warning-text">{message}</span>
  }

  const renderStatusActions = () => {
    if (!transaction) {
      return null
    }

    if (!loggedInUser) {
      return renderDisabledMessage('Please login to perform status actions.')
    }

    if (!loggedInUser.role) {
      return renderDisabledMessage(
        'Logged-in user has no role assigned. Assign a role in User Role Assignment.'
      )
    }

    if (transaction.status === 'Draft') {
      return (
        <>
          {canSubmitTransaction ? (
            <button
              type="button"
              onClick={() => openReviewModal('Submitted')}
              disabled={statusLoading}
            >
              Review & Submit
            </button>
          ) : (
            renderDisabledMessage('No Submit permission.')
          )}

          {canCancelTransaction && (
            <button
              type="button"
              onClick={() => openReviewModal('Cancelled')}
              disabled={statusLoading}
            >
              Review & Cancel
            </button>
          )}
        </>
      )
    }

    if (transaction.status === 'Submitted') {
      return (
        <>
          {canApproveTransaction ? (
            <button
              type="button"
              onClick={() => openReviewModal('Approved')}
              disabled={statusLoading}
            >
              Review & Approve
            </button>
          ) : (
            renderDisabledMessage('No Approve permission.')
          )}

          {canRejectTransaction ? (
            <button
              type="button"
              onClick={() => openReviewModal('Rejected')}
              disabled={statusLoading}
            >
              Review & Reject
            </button>
          ) : (
            renderDisabledMessage('No Reject permission.')
          )}

          {canSubmitTransaction ? (
            <button
              type="button"
              onClick={() => openReviewModal('Draft')}
              disabled={statusLoading}
            >
              Review & Recall to Draft
            </button>
          ) : (
            renderDisabledMessage('No Recall permission.')
          )}
        </>
      )
    }

    if (transaction.status === 'Rejected') {
      return (
        <>
          {canSubmitTransaction ? (
            <button
              type="button"
              onClick={() => openReviewModal('Submitted')}
              disabled={statusLoading}
            >
              Review & Re-submit
            </button>
          ) : (
            renderDisabledMessage('No Submit permission.')
          )}

          {canCancelTransaction && (
            <button
              type="button"
              onClick={() => openReviewModal('Cancelled')}
              disabled={statusLoading}
            >
              Review & Cancel
            </button>
          )}
        </>
      )
    }

    if (transaction.status === 'Approved') {
      if (approvedCorrectionExpired) {
        return renderDisabledMessage(
          'Approved ticket correction window expired after 24 hours. No further correction action allowed.'
        )
      }

      if (!canRequestApprovedCorrection) {
        return renderDisabledMessage(
          'Approved ticket is locked. Approval access is required to request correction.'
        )
      }

      if (pendingCorrectionRequest) {
        return renderDisabledMessage(
          `Correction request ${pendingCorrectionRequest.request_number} is pending admin review.`
        )
      }

      return (
        <button
          type="button"
          onClick={() => setShowCorrectionForm((current) => !current)}
          disabled={statusLoading || correctionLoading}
        >
          Mark Approved Ticket for Correction
        </button>
      )
    }

    return (
      <span className="warning-text">
        No further action allowed for {transaction.status} transaction.
      </span>
    )
  }

  const renderSavedFieldValue = (field) => {
    if (isTankPayloadField(field)) {
      return <small>Hidden - Tank Gauging payload is shown above.</small>
    }

    if (isMultiTankPayloadField(field)) {
      return <small>Hidden - Multi-Tank payload is shown above.</small>
    }

    if (isShuttlePayloadField(field)) {
      return <small>Hidden - Shuttle payload is shown above.</small>
    }

    if (isFlowmeterPayloadField(field)) {
      return <small>Hidden - Flowmeter payload is shown above.</small>
    }

    if (typeof field.fieldValue === 'object') {
      return <small>Structured JSON payload</small>
    }

    const rawValue = String(field.fieldValue || '')

    if (rawValue.trim().startsWith('{') || rawValue.trim().startsWith('[')) {
      return <small>Structured payload hidden from normal view</small>
    }

    return <strong>{rawValue || '-'}</strong>
  }

  if (loading) {
    return (
      <div>
        <div className="page-title">
          <div>
            <h2>Operation Transaction Detail</h2>
            <p>Loading ticket details...</p>
          </div>
        </div>
      </div>
    )
  }

  if (!transaction) {
    return (
      <div>
        <div className="page-title">
          <div>
            <h2>Operation Transaction Detail</h2>
            <p>No transaction found.</p>
          </div>
        </div>

        <Link to="/operation-transactions">
          Back to Operation Transaction Register
        </Link>
      </div>
    )
  }

  if (!canViewTransaction) {
    return (
      <div>
        <div className="page-title">
          <div>
            <h2>Access Denied</h2>
            <p>You do not have permission to view operation transaction details.</p>
          </div>
        </div>

        <div className="info-box">
          Required permission: View Operation Transaction
        </div>

        <div className="form-actions">
          <Link to="/operation-transactions">
            <button type="button">Back to Register</button>
          </Link>
        </div>
      </div>
    )
  }

  const calculated = tankPayload?.calculated || {}
  const inputs = tankPayload?.inputs || {}

  return (
    <div>
      {successMsg && (
        <div className="success-box" onClick={() => setSuccessMsg('')}>
          {successMsg}
        </div>
      )}
      {errorMsg && (
        <div className="error-box" onClick={() => setErrorMsg('')}>
          {errorMsg}
        </div>
      )}
      <PrintableTankGaugingReport
        transaction={transaction}
        tankPayload={tankPayload}
        statusHistory={statusHistory}
        loggedInUser={loggedInUser}
        reportSettings={reportSettings}
      />
      <PrintableMultiTankReport
        transaction={transaction}
        multiTankPayload={multiTankPayload}
        statusHistory={statusHistory}
        loggedInUser={loggedInUser}
        reportSettings={reportSettings}
      />
      <ReviewConfirmationModal
        transaction={transaction}
        tankPayload={tankPayload}
        multiTankPayload={multiTankPayload}
        shuttlePayload={shuttlePayload}
        flowmeterPayload={flowmeterPayload}
        nextStatus={pendingStatus}
        remarks={pendingRemarks}
        onRemarksChange={setPendingRemarks}
        onClose={closeReviewModal}
        onConfirm={confirmStatusChange}
        statusLoading={statusLoading}
        pendingReviewConfirmed={pendingReviewConfirmed}
        setPendingReviewConfirmed={setPendingReviewConfirmed}
      />

      <div className="page-title">
        <div>
          <h2>Operation Transaction Detail</h2>
          <p>
            Review saved ticket data, calculated values, status, and approval
            trail before taking action.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="no-print"
            onClick={() => navigate(-1)}
            title="Close and go back"
          >
            Close
          </button>

          <span className={`status-badge ${transaction.status.toLowerCase()}`}>
            {transaction.status}
          </span>
        </div>
      </div>

      <div className="info-box">
        Logged-in User: {getChangedByDisplay()} | Role:{' '}
        {loggedInUser.role ? loggedInUser.role.roleName : 'No role'}
      </div>

      <div className="section-title">
        <h3>Ticket Header</h3>
        <p>Basic transaction information saved from Operation Entry.</p>
      </div>

      <table>
        <tbody>
          <tr>
            <th>Ticket Number</th>
            <td>
              <strong>{transaction.ticketNumber}</strong>
            </td>
          </tr>
          <tr>
            <th>Convoy Number</th>
            <td>{transaction.convoyNumber || '-'}</td>
          </tr>
          <tr>
            <th>Operation Date</th>
            <td>{transaction.operationDate}</td>
          </tr>

          <tr>
            <th>Operation Type</th>
            <td>{transaction.operationTypeName}</td>
          </tr>

          <tr>
            <th>Location</th>
            <td>
              {transaction.locationName} ({transaction.locationCode})
            </td>
          </tr>

          <tr>
            <th>Primary Asset</th>
            <td>
              {transaction.primaryAssetName} ({transaction.primaryAssetCode})
            </td>
          </tr>

          <tr>
            <th>Status</th>
            <td>
              <span
                className={`status-badge ${transaction.status.toLowerCase()}`}
              >
                {transaction.status}
              </span>
            </td>
          </tr>

          <tr>
            <th>Created By</th>
            <td>{transaction.createdBy || '-'}</td>
          </tr>

          <tr>
            <th>Created At</th>
            <td>{transaction.createdAt}</td>
          </tr>
        </tbody>
      </table>

      <div className="section-title">
        <h3>Entered Data Review</h3>
        <p>
          Review these values before submitting, approving, rejecting, recalling,
          or cancelling this ticket.
        </p>
      </div>

      {tankPayload ? (
        <div className="operation-special-layout tank-gauging-layout">
          <div className="operation-special-layout-header">
            <h3>Tank Gauging Data</h3>
            <p>Saved input values and calculated quantities for this ticket.</p>
          </div>

          <div className="section-title compact-section-title">
            <h3>Input Values</h3>
          </div>

          <div className="approval-review-grid">
            <div>
              <span>Gauging Date</span>
              <strong>{inputs.gaugingDate || '-'}</strong>
            </div>

            <div>
              <span>Gauging Time</span>
              <strong>{inputs.gaugingTime || '-'}</strong>
            </div>

            <div>
              <span>Dip</span>
              <strong>{formatValue(inputs.dipCm)} cm</strong>
            </div>

            <div>
              <span>Water Level</span>
              <strong>{formatValue(inputs.waterLevelCm)} cm</strong>
            </div>

            <div>
              <span>Tank Temperature</span>
              <strong>
                {formatValue(inputs.tankTemperature)} °{inputs.tankTemperatureUnit || ''}
              </strong>
            </div>

            <div>
              <span>Observed Type</span>
              <strong>{inputs.observedInputType || '-'}</strong>
            </div>

            <div>
              <span>Observed API</span>
              <strong>{formatValue(inputs.observedApi)}</strong>
            </div>

            <div>
              <span>Observed Density</span>
              <strong>{formatValue(inputs.observedDensity)} kg/m³</strong>
            </div>

            <div>
              <span>Sample Temperature</span>
              <strong>
                {formatValue(inputs.sampleTemperature)} °{inputs.sampleTemperatureUnit || ''}
              </strong>
            </div>

            <div>
              <span>BS&W</span>
              <strong>{formatValue(inputs.bswPercent)}%</strong>
            </div>

            <div>
              <span>Remarks</span>
              <strong>{inputs.remarks || '-'}</strong>
            </div>
          </div>

          <div className="section-title compact-section-title">
            <h3>Calculated Values</h3>
          </div>

          <TankCalculatedSummary calculated={calculated} />
        </div>
      ) : multiTankPayload ? (
        <div className="operation-special-layout multi-tank-layout">
          <div className="operation-special-layout-header">
            <h3>Multi-Tank Before / After Data</h3>
            <p>Saved before/after values and net movement summary for this ticket.</p>
          </div>

          <MultiTankCalculatedSummary payload={multiTankPayload} />
        </div>
      ) : flowmeterPayload ? (
        <div className="operation-special-layout tank-gauging-layout">
          <div className="operation-special-layout-header">
            <h3>Flowmeter Reading Data</h3>
            <p>Saved flowmeter input values and calculated quantities for this ticket.</p>
          </div>
          <FlowmeterCalculatedSummary payload={flowmeterPayload} />
        </div>
      ) : (
        <div className="info-box">
          No asset-specific payload found. Review the saved template field values below before taking action.
        </div>
      )}

      {hasTankerPayload && (
        <TankerPayloadPreview
          entry={transaction}
          values={transaction.fieldValues}
          title="Tanker Approval Preview"
        />
      )}

      <div className="section-title">
        <h3>Status Actions</h3>
        <p>
          Change the ticket status using the actions below.
        </p>
      </div>

      <div className="info-box">
        <div className="form-actions" style={{ marginTop: 0 }}>
          {renderStatusActions()}
          {statusLoading && <span className="warning-text">Updating...</span>}
        </div>
        {transaction.status === 'Approved' && (
          <div className="muted-table-text" style={{ marginTop: 8 }}>
            Correction window:{' '}
            {approvedCorrectionDeadline
              ? `open until ${approvedCorrectionDeadline.toLocaleString()}`
              : 'approval time not available'}
          </div>
        )}
      </div>

      {showCorrectionForm && transaction.status === 'Approved' && (
        <div className="info-box">
          <strong>Approved Transaction Correction Request</strong>
          <p>
            This does not edit the approved ticket. It creates an admin revoke
            task so approval can be safely revoked and the ticket can return to
            the normal submitted review flow.
          </p>

          <div className="filter-panel">
            <div>
              <label>Correction Type</label>
              <select
                value={correctionForm.requestType}
                onChange={(e) =>
                  handleCorrectionFormChange('requestType', e.target.value)
                }
                disabled={correctionLoading}
              >
                <option>Data Correction</option>
                <option>Quantity Correction</option>
                <option>Wrong Asset / Location</option>
                <option>Wrong Date / Time</option>
                <option>Duplicate / Soft Delete Required</option>
                <option>Other</option>
              </select>
            </div>

            <div>
              <label>Suggested Action</label>
              <select
                value={correctionForm.suggestedAction}
                onChange={(e) =>
                  handleCorrectionFormChange('suggestedAction', e.target.value)
                }
                disabled={correctionLoading}
              >
                <option>Reopen for Edit</option>
                <option>Reopen for Cancellation</option>
                <option>Reopen for Re-approval</option>
                <option>Operational Review Required</option>
              </select>
            </div>

            <div className="full-width-field">
              <label>Reason / Justification</label>
              <textarea
                rows="4"
                value={correctionForm.reason}
                onChange={(e) =>
                  handleCorrectionFormChange('reason', e.target.value)
                }
                placeholder="Explain why this approved ticket needs attention."
                disabled={correctionLoading}
              />
            </div>
          </div>

          <div className="form-actions">
            <button
              type="button"
              onClick={submitCorrectionRequest}
              disabled={correctionLoading}
            >
              {correctionLoading ? 'Sending...' : 'Send to Admin'}
            </button>
            <button
              type="button"
              onClick={() => setShowCorrectionForm(false)}
              disabled={correctionLoading}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="section-title">
        <h3>Correction / Revoke Requests</h3>
        <p>
          Approved-ticket correction requests and admin revoke decisions for
          this transaction.
        </p>
      </div>

      <table>
        <thead>
          <tr>
            <th>Request No.</th>
            <th>Type</th>
            <th>Suggested Action</th>
            <th>Status</th>
            <th>Requested By</th>
            <th>Requested At</th>
            <th>Admin Action</th>
            <th>Reason / Remarks</th>
          </tr>
        </thead>
        <tbody>
          {correctionRequests.length === 0 ? (
            <tr>
              <td colSpan="8" className="empty-table">
                No correction requests found for this transaction.
              </td>
            </tr>
          ) : (
            correctionRequests.map((request) => (
              <tr key={request.id}>
                <td>{request.request_number}</td>
                <td>{request.request_type}</td>
                <td>{request.suggested_action}</td>
                <td>
                  <span
                    className={`status-badge ${String(request.status || '')
                      .toLowerCase()
                      .replace(/\s+/g, '-')}`}
                  >
                    {request.status}
                  </span>
                </td>
                <td>{request.requested_by_display || '-'}</td>
                <td>
                  {request.requested_at
                    ? new Date(request.requested_at).toLocaleString()
                    : '-'}
                </td>
                <td>{request.admin_action || '-'}</td>
                <td>
                  <strong>{request.reason}</strong>
                  {request.admin_remarks && (
                    <div className="muted-table-text">
                      Admin: {request.admin_remarks}
                    </div>
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <div className="section-title">
        <h3>Saved Field Values</h3>
        <p>
          Operation template values saved under this ticket. Large structured
          payloads are hidden from normal user view.
        </p>
      </div>

      <table>
        <thead>
          <tr>
            <th>Field Code</th>
            <th>Field Name</th>
            <th>Group</th>
            <th>Type</th>
            <th>Unit</th>
            <th>Value</th>
          </tr>
        </thead>

        <tbody>
          {transaction.fieldValues.length === 0 ? (
            <tr>
              <td colSpan="6" className="empty-table">
                No field values saved for this transaction.
              </td>
            </tr>
          ) : (
            transaction.fieldValues.map((field) => (
              <tr key={field.id}>
                <td>{field.fieldCode}</td>
                <td>{field.fieldName || field.fieldLabel}</td>
                <td>{field.fieldGroup}</td>
                <td>
                  <span className="permission-badge">
                    {field.dataType || field.fieldType}
                  </span>
                </td>
                <td>{field.unit || field.fieldUnit}</td>
                <td>{renderSavedFieldValue(field)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <div className="section-title">
        <h3>Status History</h3>
        <p>Audit trail of all status movements for this ticket.</p>
      </div>

      <table>
        <thead>
          <tr>
            <th>Old Status</th>
            <th>New Status</th>
            <th>Changed By</th>
            <th>Changed At</th>
            <th>Remarks</th>
          </tr>
        </thead>

        <tbody>
          {statusHistory.length === 0 ? (
            <tr>
              <td colSpan="5" className="empty-table">
                No status history found for this transaction.
              </td>
            </tr>
          ) : (
            statusHistory.map((history) => (
              <tr key={history.id}>
                <td>
                  {history.oldStatus ? (
                    <span
                      className={`status-badge ${history.oldStatus.toLowerCase()}`}
                    >
                      {history.oldStatus}
                    </span>
                  ) : (
                    '-'
                  )}
                </td>

                <td>
                  <span
                    className={`status-badge ${history.newStatus.toLowerCase()}`}
                  >
                    {history.newStatus}
                  </span>
                </td>

                <td>{history.changedBy}</td>
                <td>{history.changedAt}</td>
                <td>{history.remarks}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <div className="form-actions no-print">
        <Link to="/operation-transactions">
          <button type="button">Back to Register</button>
        </Link>

        {hasPrintablePayload && (
          <>
            <div className="report-profile-selector">
              <label>Report Profile</label>
              <select
                value={selectedReportProfileName}
                onChange={(e) => handleReportProfileChange(e.target.value)}
                disabled={reportProfilesLoading}
              >
                {reportProfiles.length === 0 ? (
                  <option value={defaultReportSettings.profileName}>
                    No Active Profile - Using Default
                  </option>
                ) : (
                  reportProfiles.map((profile) => (
                    <option key={profile.id || profile.profileName} value={profile.profileName}>
                      {profile.profileName}
                    </option>
                  ))
                )}
              </select>
            </div>

            {reportProfiles.length === 0 ? (
              <div className="info-box">
                No active company report profile found. Please create one from Admin →
                Company Report Profile Master. The report will use default placeholder
                settings until an active profile is available.
              </div>
            ) : (
              <div className="info-box">
                Report profiles are managed from Admin → Company Report Profile Master.
                Only Active profiles are available here for printing.
              </div>
            )}

            <button
              type="button"
              onClick={() => reloadReportProfiles(selectedReportProfileName)}
              disabled={reportProfilesLoading}
            >
              {reportProfilesLoading ? 'Loading Profiles...' : 'Refresh Profiles'}
            </button>

            <button type="button" onClick={() => window.print()}>
              {tankPayload ? 'Print Tank Gauging Report' : 'Print Multi-Tank Report'}
            </button>

            {tankPayload && (
              <button type="button" onClick={handleExportTankGaugingCsv}>
                Export Tank Gauging CSV
              </button>
            )}
          </>
        )}

        <button
          type="button"
          onClick={() => {
            loadTransactionDetail()
            loadStatusHistory()
          }}
        >
          Refresh
        </button>
      </div>

      <div className="info-box">
        Status actions are protected by JWT, role permissions, backend workflow
        validation, and visible data review before confirmation.
      </div>
    </div>
  )
}

export default OperationTransactionDetail
