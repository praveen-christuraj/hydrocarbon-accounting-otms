/**
 * Phase 0 — Instant Client-Side Deterministic Pre-Save Guardrails (< 1 ms).
 *
 * Runs synchronously in the browser as operators enter readings, catching
 * immediate physics impossibilities, °C↔°F unit swaps, API↔Density swaps,
 * sign-vs-direction conflicts, totalizer inversions, and seal mismatches
 * before the debounced server statistical + Tier 2 ML preview even returns.
 *
 * Findings use the exact same schema as backend EntryFinding objects so
 * EntryChecksPanel merges and deduplicates them cleanly without flicker.
 */

const toNum = (value) => {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

const isF = (unit) => String(unit || 'C').replace('°', '').trim().toUpperCase().startsWith('F')

const makeFinding = (overrides) => ({
  key: overrides.key,
  code: overrides.code,
  severity: overrides.severity || 'warning',
  category: overrides.category || 'physics',
  title: overrides.title,
  message: overrides.message,
  basis: overrides.basis || 'Instant local guardrail',
  field: overrides.field || '',
  subject_label: overrides.subject_label || '',
  current_value: overrides.current_value ?? null,
  current_display: overrides.current_display || '',
  suggested_value: overrides.suggested_value ?? null,
  suggested_display: overrides.suggested_display || '',
  suggested_unit: overrides.suggested_unit ?? null,
  usual_display: overrides.usual_display || '',
  history_count: 0,
  fingerprint: `local:${overrides.key}:${overrides.current_value ?? ''}`,
  ml_score: null,
  ml_drivers: [],
  reviewed: false,
  reviewed_by: '',
  reviewed_at: null,
  review_note: '',
  localOnly: true,
})

function checkTempUnitSwap(tempRaw, unitRaw, fieldKey, fieldLabel, subject) {
  const t = toNum(tempRaw)
  if (t === null) return null
  const fahrenheit = isF(unitRaw)
  if (!fahrenheit && t >= 62 && t <= 145) {
    const cEquiv = ((t - 32) / 1.8).toFixed(1)
    return makeFinding({
      key: `${fieldKey}:temp-c-looks-f`,
      code: 'temp-unit-swap',
      category: 'typo',
      field: fieldKey,
      subject_label: subject,
      title: `${fieldLabel} looks like °F entered in °C`,
      message: `${t} °C is unusually hot for ambient crude storage — ${t} °F equals ${cEquiv} °C.`,
      current_value: String(t),
      current_display: `${t} °C`,
      suggested_value: String(t),
      suggested_display: `${t} °F`,
      suggested_unit: 'F',
    })
  }
  if (fahrenheit && t >= 15 && t <= 48) {
    const fEquiv = (t * 1.8 + 32).toFixed(1)
    return makeFinding({
      key: `${fieldKey}:temp-f-looks-c`,
      code: 'temp-unit-swap',
      category: 'typo',
      field: fieldKey,
      subject_label: subject,
      title: `${fieldLabel} looks like °C entered in °F`,
      message: `${t} °F is below freezing/near-ambient — ${t} °C equals ${fEquiv} °F.`,
      current_value: String(t),
      current_display: `${t} °F`,
      suggested_value: String(t),
      suggested_display: `${t} °C`,
      suggested_unit: 'C',
    })
  }
  return null
}

function checkTankGauging(assetCode, payload) {
  const inputs = payload?.inputs || payload || {}
  const calc = payload?.calculated || {}
  const subject = assetCode || 'Tank'
  const out = []

  const dip = toNum(inputs.dipCm)
  const water = toNum(inputs.waterLevelCm)
  if (dip !== null && water !== null && water > dip) {
    out.push(makeFinding({
      key: `tank:${subject}:water-exceeds-dip`,
      code: 'water-exceeds-dip',
      field: 'waterLevelCm',
      subject_label: subject,
      title: 'Water dip exceeds total dip',
      message: `Water level (${water} cm) is higher than Total Dip (${dip} cm). Verify if Total Dip and Water Level were swapped.`,
      current_value: String(water),
      current_display: `${water} cm`,
    }))
  }

  const tankTempFinding = checkTempUnitSwap(
    inputs.tankTemperature,
    inputs.tankTemperatureUnit,
    'tankTemperature',
    'Tank temperature',
    subject
  )
  if (tankTempFinding) out.push(tankTempFinding)

  const sampleTempFinding = checkTempUnitSwap(
    inputs.sampleTemperature,
    inputs.sampleTemperatureUnit,
    'sampleTemperature',
    'Sample temperature',
    subject
  )
  if (sampleTempFinding) out.push(sampleTempFinding)

  const obsApi = toNum(inputs.observedApi)
  if (obsApi !== null && obsApi >= 600 && obsApi <= 1100) {
    const sg = obsApi / 1000
    const apiApprox = (141.5 / sg - 131.5).toFixed(2)
    out.push(makeFinding({
      key: `tank:${subject}:api-looks-density`,
      code: 'api-density-swap',
      category: 'typo',
      field: 'observedApi',
      subject_label: subject,
      title: 'Observed API looks like Density (kg/m³)',
      message: `Observed API is ${obsApi}, which falls in the kg/m³ density range (~${apiApprox} °API).`,
      current_value: String(obsApi),
      current_display: `${obsApi} °API`,
      suggested_value: apiApprox,
      suggested_display: `${apiApprox} °API`,
    }))
  } else if (obsApi !== null && (obsApi < 5 || obsApi > 95)) {
    out.push(makeFinding({
      key: `tank:${subject}:api-out-of-range`,
      code: 'api-out-of-range',
      field: 'observedApi',
      subject_label: subject,
      title: 'Observed API outside hydrocarbon bounds',
      message: `Observed API ${obsApi} is outside the 5–95 °API hydrocarbon measurement range.`,
      current_value: String(obsApi),
      current_display: `${obsApi} °API`,
    }))
  }

  const obsDen = toNum(inputs.observedDensity)
  if (obsDen !== null && obsDen >= 10 && obsDen <= 85) {
    out.push(makeFinding({
      key: `tank:${subject}:density-looks-api`,
      code: 'api-density-swap',
      category: 'typo',
      field: 'observedDensity',
      subject_label: subject,
      title: 'Observed Density looks like °API',
      message: `Observed Density is ${obsDen}, which looks like an API gravity rather than kg/m³ (650–1050) or SG (0.65–1.05).`,
      current_value: String(obsDen),
      current_display: String(obsDen),
    }))
  }

  const bsw = toNum(inputs.bswPercent)
  if (bsw !== null && (bsw < 0 || bsw > 100)) {
    out.push(makeFinding({
      key: `tank:${subject}:bsw-impossible`,
      code: 'bsw-out-of-range',
      field: 'bswPercent',
      subject_label: subject,
      title: 'BS&W% must be between 0% and 100%',
      message: `Entered BS&W% is ${bsw}%.`,
      current_value: String(bsw),
      current_display: `${bsw}%`,
    }))
  } else if (bsw !== null && bsw > 15) {
    out.push(makeFinding({
      key: `tank:${subject}:bsw-high`,
      code: 'bsw-high',
      severity: 'warning',
      field: 'bswPercent',
      subject_label: subject,
      title: `Unusually high BS&W (${bsw}%)`,
      message: `BS&W of ${bsw}% is abnormally high for crude oil — check for a missing decimal point (e.g., ${(bsw / 10).toFixed(2)}%).`,
      current_value: String(bsw),
      current_display: `${bsw}%`,
      suggested_value: bsw >= 15 ? (bsw / 10).toFixed(2) : null,
      suggested_display: bsw >= 15 ? `${(bsw / 10).toFixed(2)}%` : '',
    }))
  }

  const vcf = toNum(calc.vcf)
  if (vcf !== null && vcf > 0 && (vcf < 0.85 || vcf > 1.06)) {
    out.push(makeFinding({
      key: `tank:${subject}:vcf-bounds`,
      code: 'vcf-out-of-range',
      field: 'tankTemperature',
      subject_label: subject,
      title: `Calculated VCF (${vcf.toFixed(5)}) outside expected ASTM range`,
      message: 'Check Tank Temperature unit (°C/°F) and Observed API / Density.',
      current_value: String(vcf),
      current_display: vcf.toFixed(5),
    }))
  }

  return out
}

function checkMultiTank(assetCode, payload) {
  const subject = assetCode || 'Barge'
  const out = []
  const before = payload?.before || {}
  const after = payload?.after || {}

  if (before.date && before.time && after.date && after.time) {
    const bTs = Date.parse(`${before.date}T${before.time}`)
    const aTs = Date.parse(`${after.date}T${after.time}`)
    if (Number.isFinite(bTs) && Number.isFinite(aTs) && aTs < bTs) {
      out.push(makeFinding({
        key: `multi:${subject}:time-inverted`,
        code: 'time-inverted',
        category: 'continuity',
        field: 'after.time',
        subject_label: subject,
        title: 'After gauging timestamp is earlier than Before timestamp',
        message: `After (${after.date} ${after.time}) precedes Before (${before.date} ${before.time}).`,
        current_value: `${after.date} ${after.time}`,
        current_display: `${after.date} ${after.time}`,
      }))
    }
  }

  for (const [sideName, side] of [['Before', before], ['After', after]]) {
    const ccf = toNum(side.ccf)
    if (ccf !== null && (ccf < 0.9 || ccf > 1.1)) {
      out.push(makeFinding({
        key: `multi:${subject}:${sideName}:ccf`,
        code: 'ccf-out-of-range',
        field: `${sideName.toLowerCase()}.ccf`,
        subject_label: `${subject} (${sideName})`,
        title: `${sideName} CCF / VEF (${ccf}) outside 0.90–1.10`,
        message: 'Verify vessel/barge correction factor.',
        current_value: String(ccf),
        current_display: String(ccf),
      }))
    }
    const tf = checkTempUnitSwap(
      side.tankTemp,
      side.tankTempUnit,
      `${sideName.toLowerCase()}.tankTemp`,
      `${sideName} tank temperature`,
      `${subject} (${sideName})`
    )
    if (tf) out.push(tf)

    for (const row of side.rows || []) {
      const d = toNum(row?.dip)
      const w = toNum(row?.waterDip)
      if (d !== null && w !== null && w > d) {
        out.push(makeFinding({
          key: `multi:${subject}:${sideName}:${row.tankCode || 'row'}:water`,
          code: 'water-exceeds-dip',
          field: `${sideName.toLowerCase()}.rows`,
          subject_label: `${subject} · ${row.tankCode || 'Compartment'} (${sideName})`,
          title: `Water dip exceeds total dip in ${row.tankCode || 'compartment'}`,
          message: `Water dip (${w}) is greater than Total dip (${d}).`,
          current_value: String(w),
          current_display: String(w),
        }))
      }
    }
  }
  return out
}

function checkTanker(assetCode, payload) {
  const inputs = payload?.inputs || payload || {}
  const subject = assetCode || inputs.tankerName || 'Tanker'
  const out = []

  const dip = toNum(inputs.totalDipCm)
  const water = toNum(inputs.waterDipCm)
  if (dip !== null && water !== null && water > dip) {
    out.push(makeFinding({
      key: `tanker:${subject}:water-exceeds-dip`,
      code: 'water-exceeds-dip',
      field: 'waterDipCm',
      subject_label: subject,
      title: 'Tanker water dip exceeds total dip',
      message: `Water dip (${water} cm) exceeds Total dip (${dip} cm).`,
      current_value: String(water),
      current_display: `${water} cm`,
    }))
  }
  const tf = checkTempUnitSwap(
    inputs.tankTemperature,
    inputs.tankTemperatureUnit,
    'tankTemperature',
    'Tanker temperature',
    subject
  )
  if (tf) out.push(tf)

  const bsw = toNum(inputs.bswPercent)
  if (bsw !== null && bsw > 15) {
    out.push(makeFinding({
      key: `tanker:${subject}:bsw-high`,
      code: 'bsw-high',
      field: 'bswPercent',
      subject_label: subject,
      title: `High tanker BS&W (${bsw}%)`,
      message: `BS&W of ${bsw}% is abnormally high — verify decimal placement.`,
      current_value: String(bsw),
      current_display: `${bsw}%`,
      suggested_value: bsw <= 100 ? (bsw / 10).toFixed(2) : null,
      suggested_display: bsw <= 100 ? `${(bsw / 10).toFixed(2)}%` : '',
    }))
  }
  return out
}

function checkFlowmeter(assetCode, payload) {
  const inputs = payload?.inputs || payload || {}
  const meters = Array.isArray(inputs.meters)
    ? inputs.meters
    : inputs.opening_reading !== undefined
      ? [inputs]
      : []
  const out = []

  meters.forEach((m, idx) => {
    const label = m.meter_label || `Meter ${idx + 1}`
    const open = toNum(m.opening_reading)
    const close = toNum(m.closing_reading)
    const mf = toNum(m.meter_factor)
    if (open !== null && close !== null && close < open) {
      out.push(makeFinding({
        key: `fm:${assetCode || 'stream'}:${label}:neg-delta`,
        code: 'negative-totalizer-delta',
        category: 'continuity',
        field: `meters.${idx}.closing_reading`,
        subject_label: `${assetCode || 'Flowmeter'} · ${label}`,
        title: `Closing totalizer (${close}) is less than Opening (${open})`,
        message: 'Verify if Opening and Closing readings were swapped or if the totalizer rolled over.',
        current_value: String(close),
        current_display: String(close),
      }))
    }
    if (mf !== null && (mf < 0.85 || mf > 1.15)) {
      out.push(makeFinding({
        key: `fm:${assetCode || 'stream'}:${label}:mf`,
        code: 'meter-factor-out-of-range',
        field: `meters.${idx}.meter_factor`,
        subject_label: `${assetCode || 'Flowmeter'} · ${label}`,
        title: `Meter factor (${mf}) outside normal 0.85–1.15 bounds`,
        message: 'Confirm calibrated proving meter factor.',
        current_value: String(mf),
        current_display: String(mf),
      }))
    }
  })
  return out
}

function checkVessel(mode, assetCode, payload) {
  const inputs = payload?.inputs || payload || {}
  const subject = assetCode || mode.toUpperCase()
  const out = []
  const openStock = toNum(inputs.opening_stock_bbl)
  const closeStock = toNum(inputs.closing_stock_bbl)
  const openWater = toNum(inputs.opening_water_bbl)
  const closeWater = toNum(inputs.closing_water_bbl)
  const vesselQty = toNum(inputs.vessel_quantity_bbl)

  for (const [k, label, val] of [
    ['opening_stock_bbl', 'Opening Stock', openStock],
    ['closing_stock_bbl', 'Closing Stock', closeStock],
    ['opening_water_bbl', 'Opening Water', openWater],
    ['closing_water_bbl', 'Closing Water', closeWater],
  ]) {
    if (val !== null && val < 0) {
      out.push(makeFinding({
        key: `${mode}:${subject}:${k}:neg`,
        code: 'negative-stock',
        field: k,
        subject_label: subject,
        title: `${label} cannot be negative`,
        message: `${label} is entered as ${val} BBL.`,
        current_value: String(val),
        current_display: `${val} BBL`,
      }))
    }
  }

  if (mode === 'fso' && openStock !== null && closeStock !== null && vesselQty !== null && vesselQty > 0) {
    const netStock = closeStock - openStock
    const netWater = (closeWater ?? 0) - (openWater ?? 0)
    const variance = Math.abs(netStock + netWater) - vesselQty
    const pct = (variance / vesselQty) * 100
    if (Math.abs(pct) >= 0.5) {
      out.push(makeFinding({
        key: `fso:${subject}:variance`,
        code: 'fso-variance-high',
        category: 'accounting',
        field: 'vessel_quantity_bbl',
        subject_label: subject,
        title: `FSO variance ${variance >= 0 ? '+' : ''}${variance.toFixed(1)} BBL (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%)`,
        message: `|Net Stock + Net Water| differs from Vessel Quantity (${vesselQty.toLocaleString()} BBL) by more than 0.50%.`,
        current_value: String(vesselQty),
        current_display: `${variance.toFixed(1)} BBL`,
      }))
    }
  }
  return out
}

function checkBookStock(payload) {
  const open = toNum(payload?.opening_stock) ?? 0
  const prod = toNum(payload?.production) ?? 0
  const disp = toNum(payload?.dispatch) ?? 0
  const adj = toNum(payload?.adjustment) ?? 0
  const closing = open + prod - disp + adj
  const subject = `${payload?.block_code || 'Block'} (${payload?.product_code || 'Product'})`
  const out = []

  if (closing < 0) {
    out.push(makeFinding({
      key: `book:${subject}:negative-closing`,
      code: 'negative-closing-stock',
      category: 'accounting',
      field: 'dispatch',
      subject_label: subject,
      title: `Closing Stock would become negative (${closing.toLocaleString()})`,
      message: `Opening (${open.toLocaleString()}) + Production (${prod.toLocaleString()}) − Dispatch (${disp.toLocaleString()}) + Adjustment (${adj.toLocaleString()}) = ${closing.toLocaleString()}.`,
      current_value: String(disp),
      current_display: closing.toLocaleString(),
    }))
  }
  if (prod < 0) {
    out.push(makeFinding({
      key: `book:${subject}:neg-prod`,
      code: 'negative-production',
      field: 'production',
      subject_label: subject,
      title: 'Production quantity cannot be negative',
      message: `Entered production is ${prod}.`,
      current_value: String(prod),
      current_display: String(prod),
    }))
  }
  if (disp < 0) {
    out.push(makeFinding({
      key: `book:${subject}:neg-disp`,
      code: 'negative-dispatch',
      field: 'dispatch',
      subject_label: subject,
      title: 'Dispatch quantity cannot be negative',
      message: `Entered dispatch is ${disp}.`,
      current_value: String(disp),
      current_display: String(disp),
    }))
  }
  return out
}

/**
 * Evaluate instant client-side rules for any OTMS operational entry layout.
 */
export function runLocalEntryGuardrails({ layout, assetCode = '', payload = {} }) {
  const mode = String(layout || '').trim().toLowerCase()
  if (mode === 'tank_gauging') return checkTankGauging(assetCode, payload)
  if (mode === 'multi_tank') return checkMultiTank(assetCode, payload)
  if (mode === 'tanker') return checkTanker(assetCode, payload)
  if (mode === 'flowmeter') return checkFlowmeter(assetCode, payload)
  if (mode === 'fso' || mode === 'shuttle') return checkVessel(mode, assetCode, payload)
  if (mode === 'book_stock') return checkBookStock(payload)
  return []
}

/**
 * Merge local instant guardrails with backend statistical + Tier 2 ML findings
 * without showing duplicate items for the same (code, field).
 */
export function mergeEntryFindings(localFindings = [], serverFindings = []) {
  const merged = [...serverFindings]
  const seen = new Set(serverFindings.map((f) => `${f.code}::${f.field}`))
  for (const lf of localFindings) {
    const sig = `${lf.code}::${lf.field}`
    if (!seen.has(sig)) {
      merged.unshift(lf)
      seen.add(sig)
    }
  }
  return merged
}
