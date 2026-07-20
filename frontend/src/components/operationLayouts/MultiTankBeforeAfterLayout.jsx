import { useEffect, useMemo, useRef, useState } from 'react'
import { lookupTable11Factor } from '../../api/table11Api'
import { getBargeSealMaster } from '../../api/bargeSealApi'

const WAT60 = 999.012

const PERMANENT_TANK_SEAL_POSITIONS = ['MH1', 'MH2', 'LOCK', 'DIPHATCH']

const buildDefaultAfterTemporarySeals = () => ({
  portManifoldSeal: '',
  stbdManifoldSeal: '',
  pumproomSeal: '',
  otherSeal: '',
  otherRemarks: '',
})

const toNum = (v) => {
  if (v === null || v === undefined) return 0
  const s = String(v).trim()
  if (s === '') return 0
  const n = Number(s)
  return Number.isFinite(n) ? n : 0
}

const round = (v, dp = 2) => {
  const n = Number(v)
  if (!Number.isFinite(n)) return 0
  const p = 10 ** dp
  return Math.round(n * p) / p
}

const normalizeTempUnit = (unit) => {
  const u = String(unit || '')
    .trim()
    .toUpperCase()
    .replace('°', '')
  return u.startsWith('F') ? 'F' : 'C'
}

const cToF = (c) => Number(c) * 1.8 + 32
const fToC = (f) => (Number(f) - 32) / 1.8

const apiObservedToApi60 = (apiObs, tempObsF) => {
  const api = toNum(apiObs)
  const tf = toNum(tempObsF) || 60
  const dt = tf - 60.0

  const rhoObs =
    ((141.5 * WAT60) / (131.5 + api)) *
    ((1.0 - 0.00001278 * dt) - 0.0000000062 * dt * dt)

  let RH = rhoObs
  for (let i = 0; i < 10; i += 1) {
    const alfa = 341.0957 / (RH * RH)
    const vcf = Math.exp(-alfa * dt - 0.8 * alfa * alfa * dt * dt)
    RH = rhoObs / vcf
  }

  return (141.5 * WAT60) / RH - 131.5
}

const densityObsToApi60 = (densityObs, sampleTempC) => {
  const dens = toNum(densityObs)
  const tc = toNum(sampleTempC) || 15.0
  const dt = tc - 15.0

  const hyc = (1.0 - 0.00001278 * dt) - 0.0000000062 * dt * dt
  const rhoObsCorr = dens * hyc

  let rho15 = rhoObsCorr
  for (let i = 0; i < 17; i += 1) {
    const K = 613.9723 / (rho15 * rho15)
    const vcf = Math.exp(-K * dt * (1.0 + 0.8 * K * dt))
    rho15 = rhoObsCorr / vcf
  }

  const density15 = rho15
  const sg60 = density15 / WAT60
  const api60 = sg60 > 0 ? 141.5 / sg60 - 131.5 : 0
  return { api60, density15 }
}

const api60FromObserved = ({
  mode,
  apiObserved,
  densityObserved,
  sampleTemp,
  sampleTempUnit,
}) => {
  const m = String(mode || 'Observed API')
  const unit = normalizeTempUnit(sampleTempUnit)

  if (m.toLowerCase().includes('api')) {
    const tempF = unit === 'F' ? toNum(sampleTemp) : cToF(toNum(sampleTemp))
    return round(apiObservedToApi60(toNum(apiObserved), tempF), 2)
  }

  const tempC = unit === 'C' ? toNum(sampleTemp) : fToC(toNum(sampleTemp))
  const out = densityObsToApi60(toNum(densityObserved), tempC)
  return round(out.api60, 2)
}

const vcfFromApi60AndTankTemp = (api60, tankTemp, tankTempUnit) => {
  const a = toNum(api60)
  if (a <= 0) return 0
  const unit = normalizeTempUnit(tankTempUnit)
  const tempF = unit === 'F' ? toNum(tankTemp) : cToF(toNum(tankTemp))
  const dt = tempF - 60.0
  const rho60 = (141.5 * WAT60) / (a + 131.5)
  const alpha = 341.0957 / (rho60 * rho60)
  const vcf = Math.exp(-alpha * dt - 0.8 * alpha * alpha * dt * dt)
  return round(vcf, 5)
}

const interpolate1D = (points, x) => {
  const v = toNum(x)
  if (!points || points.length === 0) return 0
  if (v <= points[0].x) return toNum(points[0].y)
  if (v >= points[points.length - 1].x) return toNum(points[points.length - 1].y)

  for (let i = 1; i < points.length; i += 1) {
    const p0 = points[i - 1]
    const p1 = points[i]
    if (v <= p1.x) {
      if (p1.x === p0.x) return toNum(p0.y)
      const ratio = (v - p0.x) / (p1.x - p0.x)
      return toNum(p0.y) + ratio * (toNum(p1.y) - toNum(p0.y))
    }
  }

  return toNum(points[points.length - 1].y)
}

const buildDefaultStage = () => ({
  date: '',
  time: '',
  ccf: 1.0,
  obsMode: 'Observed API',
  obsApi: '',
  obsDensity: '',
  sampleTempUnit: '°F',
  sampleTemp: '',
  tankTempUnit: '°F',
  tankTemp: '',
  bswPct: '',
  dips: {},
})

const format = (v, dp = 2) => {
  const n = Number(v)
  if (!Number.isFinite(n)) return '-'
  return n.toLocaleString(undefined, { maximumFractionDigits: dp })
}

function SummaryRow({ label, before, after, net, unit = '', dp = 2 }) {
  return (
    <tr>
      <td>
        <strong>{label}</strong>
      </td>
      <td>{format(before, dp)} {unit}</td>
      <td>{format(after, dp)} {unit}</td>
      <td>
        <strong>{format(net, dp)}</strong> {unit}
      </td>
    </tr>
  )
}

export default function MultiTankBeforeAfterLayout({
  entry,
  editId,
  selectedAsset,
  assetCalibrationTables,
  calibrationTemplates,
  handleValueChange,
}) {
  const payloadFieldCode = 'multi_tank_payload'

  const stageFieldCode = 'barge_event_type'

  const stageValue = useMemo(() => {
    const v = entry.values.find((x) => x.fieldCode === stageFieldCode)?.fieldValue
    return String(v || '').trim()
  }, [entry.values])

  const setStageValue = (value) => {
    handleValueChange(stageFieldCode, value)
  }

  const payloadFieldExists = useMemo(() => {
    return entry.values.some((x) => x.fieldCode === payloadFieldCode)
  }, [entry.values])

  const payloadValue = useMemo(() => {
    const v = entry.values.find((x) => x.fieldCode === payloadFieldCode)?.fieldValue
    if (!v) return null
    if (typeof v === 'object') return v
    try {
      return JSON.parse(String(v))
    } catch {
      return null
    }
  }, [entry.values])

  const activeCalibrationTable = useMemo(() => {
    if (!selectedAsset) return null
    const tables = (assetCalibrationTables || [])
      .filter((t) => t.assetCode === selectedAsset.assetCode && t.status === 'Active')
      .sort((a, b) => String(b.effectiveDate || '').localeCompare(String(a.effectiveDate || '')))
    return tables[0] || null
  }, [assetCalibrationTables, selectedAsset])

  const template = useMemo(() => {
    if (!activeCalibrationTable) return null
    return (calibrationTemplates || []).find(
      (t) => Number(t.id) === Number(activeCalibrationTable.templateId)
    )
  }, [activeCalibrationTable, calibrationTemplates])

  const { referenceCol, inputXCol, outputCol, inputXUnit, outputUnit } = useMemo(() => {
    if (!template) {
      return { referenceCol: null, inputXCol: null, outputCol: null, inputXUnit: '', outputUnit: '' }
    }
    const cols = template.columns || []
    const ref = cols.find((c) => c.interpolationRole === 'Reference')
    const ix = cols.find((c) => c.interpolationRole === 'Input X')
    const out = cols.find((c) => c.interpolationRole === 'Output')

    return {
      referenceCol: ref?.columnName || null,
      inputXCol: ix?.columnName || null,
      outputCol: out?.columnName || null,
      inputXUnit: ix?.unit || '',
      outputUnit: out?.unit || '',
    }
  }, [template])

  const tankPoints = useMemo(() => {
    if (!activeCalibrationTable || !inputXCol || !outputCol) return {}
    const rows = activeCalibrationTable.rows || []
    const buckets = {}

    for (const r of rows) {
      const d = r.rowData || r.row_data || {}
      const tankIdRaw = referenceCol ? d[referenceCol] : 'MAIN'
      const tankId = String(tankIdRaw ?? 'MAIN').trim() || 'MAIN'
      const x = toNum(d[inputXCol])
      const y = toNum(d[outputCol])
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue
      if (!buckets[tankId]) buckets[tankId] = []
      buckets[tankId].push({ x, y })
    }

    Object.keys(buckets).forEach((k) => {
      buckets[k].sort((a, b) => a.x - b.x)
    })

    return buckets
  }, [activeCalibrationTable, inputXCol, outputCol, referenceCol])

  const tankIds = useMemo(() => {
    const ids = Object.keys(tankPoints || {})
    return ids.length > 0 ? ids : []
  }, [tankPoints])

  // ✅ max dip per tank (shown beside tank name)
  const maxDipByTank = useMemo(() => {
    const out = {}
    Object.keys(tankPoints || {}).forEach((tid) => {
      const pts = tankPoints[tid] || []
      out[tid] = pts.length ? pts[pts.length - 1].x : 0
    })
    return out
  }, [tankPoints])

  const [before, setBefore] = useState(buildDefaultStage)
  const [after, setAfter] = useState(buildDefaultStage)
  const [dipErrors, setDipErrors] = useState({})
  const [showSeals, setShowSeals] = useState(false)

  // Permanent tank seals (master vs observed after)
  const [afterTankSeals, setAfterTankSeals] = useState({})

  // Temporary seals (entered per ticket AFTER only)
  const [afterTemporarySeals, setAfterTemporarySeals] = useState(buildDefaultAfterTemporarySeals)

  // For info / errors
  const [sealLoadError, setSealLoadError] = useState('')
  const tankIdsKey = useMemo(() => tankIds.join('|'), [tankIds])
  const sealInitRef = useRef({ key: '', done: false })

  const loadedOnceRef = useRef(false)
  useEffect(() => {
    if (loadedOnceRef.current) return
    if (!payloadValue) return
    const inp = payloadValue.inputs || {}
    if (inp.before) setBefore((s) => ({ ...s, ...inp.before }))
    if (inp.after) setAfter((s) => ({ ...s, ...inp.after }))
    loadedOnceRef.current = true
  }, [payloadValue])
  
  useEffect(() => {
    if (!selectedAsset?.assetCode) return
    if (tankIds.length === 0) return

    // Unique per ticket + asset + tank-set
    const key = `${String(editId ?? 'new')}|${selectedAsset.assetCode}|${tankIdsKey}`

    // When switching ticket/asset/tanks => allow init again
    if (sealInitRef.current.key !== key) {
      sealInitRef.current = { key, done: false }
      setSealLoadError('')
      setAfterTankSeals({})
      setAfterTemporarySeals(buildDefaultAfterTemporarySeals())
    }

    // Already initialized for this key => do nothing
    if (sealInitRef.current.done) return

    const existing = payloadValue?.seals?.after || null
    const existingTankSeals = existing?.tankSeals || null
    const existingTemporary = existing?.temporary || null

    // Initialize temporary seals only once (do not overwrite while typing)
    if (existingTemporary && typeof existingTemporary === 'object') {
      setAfterTemporarySeals({
        ...buildDefaultAfterTemporarySeals(),
        ...existingTemporary,
      })
    }

    const hasExistingTankSeals =
      existingTankSeals &&
      typeof existingTankSeals === 'object' &&
      Object.keys(existingTankSeals).length > 0

    // If ticket already has seals saved, load once and stop
    if (hasExistingTankSeals) {
      setAfterTankSeals(existingTankSeals)
      sealInitRef.current.done = true
      return
    }

    // Otherwise, fetch master ONCE and stop (prevents blinking + StrictMode double runs)
    sealInitRef.current.done = true

    ;(async () => {
      try {
        setSealLoadError('')
        const masterRows = await getBargeSealMaster(selectedAsset.assetCode)

        const masterMap = {}
        for (const r of masterRows || []) {
          const tid = String(r.tankId || r.tank_id || '').trim()
          const pos = String(r.sealPosition || r.seal_position || '')
            .trim()
            .toUpperCase()
          const seal = String(r.sealNumber || r.seal_number || '').trim()
          if (!tid || !pos) continue
          if (!PERMANENT_TANK_SEAL_POSITIONS.includes(pos)) continue

          if (!masterMap[tid]) masterMap[tid] = {}
          masterMap[tid][pos] = seal
        }

        const next = {}
        for (const tid of tankIds) {
          next[tid] = {}
          for (const pos of PERMANENT_TANK_SEAL_POSITIONS) {
            const master = masterMap?.[tid]?.[pos] || ''
            next[tid][pos] = { master, observed: master }
          }
        }

        setAfterTankSeals(next)
      } catch (e) {
        setSealLoadError(String(e?.message || 'Failed to load Barge Seal Master'))
        const next = {}
        for (const tid of tankIds) {
          next[tid] = {}
          for (const pos of PERMANENT_TANK_SEAL_POSITIONS) {
            next[tid][pos] = { master: '', observed: '' }
          }
        }
        setAfterTankSeals(next)
      }
    })()
  }, [editId, selectedAsset?.assetCode, tankIdsKey, payloadValue])

  useEffect(() => {
    if (tankIds.length === 0) return
    setBefore((s) => {
      const next = { ...s, dips: { ...(s.dips || {}) } }
      tankIds.forEach((id) => {
        if (!next.dips[id]) next.dips[id] = { total: '', water: '' }
      })
      return next
    })
    setAfter((s) => {
      const next = { ...s, dips: { ...(s.dips || {}) } }
      tankIds.forEach((id) => {
        if (!next.dips[id]) next.dips[id] = { total: '', water: '' }
      })
      return next
    })
  }, [tankIds])

  const [beforeLtLookup, setBeforeLtLookup] = useState(null)
  const [afterLtLookup, setAfterLtLookup] = useState(null)
  const [lookupError, setLookupError] = useState('')

  const normalizeSealPos = (s) => String(s || '').trim().toUpperCase()
  const normalizeTankId = (s) => String(s || '').trim()

  const buildTankSealStateFromMaster = (tankIdsList, masterRows) => {
    const masterMap = {}

    for (const r of masterRows || []) {
      const tankId = normalizeTankId(r.tankId || r.tank_id)
      const pos = normalizeSealPos(r.sealPosition || r.seal_position)
      const seal = String(r.sealNumber || r.seal_number || '').trim()

      if (!tankId || !pos) continue
      if (!PERMANENT_TANK_SEAL_POSITIONS.includes(pos)) continue

      if (!masterMap[tankId]) masterMap[tankId] = {}
      masterMap[tankId][pos] = seal
    }

    const out = {}
    for (const tid of tankIdsList || []) {
      out[tid] = {}
      for (const pos of PERMANENT_TANK_SEAL_POSITIONS) {
        const master = masterMap?.[tid]?.[pos] || ''
        out[tid][pos] = {
          master,
          observed: master, // prefill observed = master (seal intact assumption)
        }
      }
    }

    return out
  }
  const computeStage = (stage, ltLookup) => {
    const perTank = {}
    const ccf = toNum(stage.ccf || 1.0) || 1.0

    let totalTov = 0
    let totalFw = 0

    for (const tid of tankIds) {
      const d = (stage.dips || {})[tid] || {}
      const totalDip = d.total
      const waterDip = d.water

      const tov = interpolate1D(tankPoints[tid], totalDip)
      const fw = toNum(waterDip) > 0 ? interpolate1D(tankPoints[tid], waterDip) : 0

      const tovC = tov * ccf
      const fwC = fw * ccf

      totalTov += tovC
      totalFw += fwC

      perTank[tid] = {
        totalDip: toNum(totalDip),
        waterDip: toNum(waterDip),
        tovCorrected: round(tovC, 2),
        fwCorrected: round(fwC, 2),
      }
    }

    const gov = totalTov - totalFw

    const api60 = api60FromObserved({
      mode: stage.obsMode,
      apiObserved: stage.obsApi,
      densityObserved: stage.obsDensity,
      sampleTemp: stage.sampleTemp,
      sampleTempUnit: stage.sampleTempUnit,
    })

    const vcf = vcfFromApi60AndTankTemp(api60, stage.tankTemp, stage.tankTempUnit)
    const gsv = Math.round(gov * vcf)
    const bsw = Math.round(gsv * (toNum(stage.bswPct) / 100.0))
    const nsv = Math.round(gsv - bsw)

    const ltFactor = toNum(ltLookup?.ltFactor || 0)
    const lt = Math.round(nsv * ltFactor)
    const mt = Math.round(lt * 1.01605)

    return {
      perTank,
      totals: {
        TOV: round(totalTov, 2),
        FW: round(totalFw, 2),
        GOV: round(gov, 2),
        API60: api60,
        VCF: vcf,
        GSV: gsv,
        BSW: bsw,
        NSV: nsv,
        ltFactor: ltFactor,
        LT: lt,
        MT: mt,
        table11Method: ltLookup?.lookupMethod || '',
      },
    }
  }

  const beforeComputed = useMemo(() => computeStage(before, beforeLtLookup), [before, beforeLtLookup, tankIds, tankPoints])
  const afterComputed = useMemo(() => computeStage(after, afterLtLookup), [after, afterLtLookup, tankIds, tankPoints])

  useEffect(() => {
    const api60 = beforeComputed.totals.API60
    if (!api60 || api60 <= 0) {
      setBeforeLtLookup(null)
      return
    }
    ;(async () => {
      try {
        const res = await lookupTable11Factor(api60)
        setBeforeLtLookup(res)
        setLookupError('')
      } catch (e) {
        setBeforeLtLookup(null)
        setLookupError(String(e?.message || 'Table 11 lookup failed'))
      }
    })()
  }, [beforeComputed.totals.API60])

  useEffect(() => {
    const api60 = afterComputed.totals.API60
    if (!api60 || api60 <= 0) {
      setAfterLtLookup(null)
      return
    }
    ;(async () => {
      try {
        const res = await lookupTable11Factor(api60)
        setAfterLtLookup(res)
        setLookupError('')
      } catch (e) {
        setAfterLtLookup(null)
        setLookupError(String(e?.message || 'Table 11 lookup failed'))
      }
    })()
  }, [afterComputed.totals.API60])

  const netTotals = useMemo(() => {
    const b = beforeComputed.totals
    const a = afterComputed.totals
    return {
      TOV: round(a.TOV - b.TOV, 2),
      FW: round(a.FW - b.FW, 2),
      GOV: round(a.GOV - b.GOV, 2),
      GSV: a.GSV - b.GSV,
      BSW: a.BSW - b.BSW,
      NSV: a.NSV - b.NSV,
      LT: a.LT - b.LT,
      MT: a.MT - b.MT,
    }
  }, [beforeComputed, afterComputed])

  // Persist payload
  const lastSavedStrRef = useRef('')
  useEffect(() => {
    if (!payloadFieldExists) return

    const payload = {
      meta: {
        layout: 'Multi-Tank Before/After',
        assetCode: selectedAsset?.assetCode || '',
        assetName: selectedAsset?.assetName || '',
        calibrationTableId: activeCalibrationTable?.id || null,
        templateId: template?.id || null,
        referenceCol,
        inputXCol,
        outputCol,
        inputXUnit,
        outputUnit,
        tankIds,
      },
      inputs: { before, after },
      calculated: {
        before: { ...beforeComputed.totals, table11: beforeLtLookup || null },
        after: { ...afterComputed.totals, table11: afterLtLookup || null },
        net: netTotals,
      },
      perTank: {
        before: beforeComputed.perTank,
        after: afterComputed.perTank,
      },
      seals: {
        after: {
          tankSeals: afterTankSeals,
          temporary: afterTemporarySeals,
        },
      },
    }

    const s = JSON.stringify(payload)
    if (s === lastSavedStrRef.current) return
    lastSavedStrRef.current = s
    handleValueChange(payloadFieldCode, payload)
  }, [
    payloadFieldExists,
    selectedAsset,
    activeCalibrationTable,
    template,
    referenceCol,
    inputXCol,
    outputCol,
    inputXUnit,
    outputUnit,
    tankIds,
    before,
    after,
    beforeComputed,
    afterComputed,
    beforeLtLookup,
    afterLtLookup,
    netTotals,
    handleValueChange,
    afterTankSeals,
    afterTemporarySeals,
  ])

  const copyBeforeToAfter = () => {
    setAfter((s) => ({
      ...s,
      ccf: before.ccf,
      obsMode: before.obsMode,
      obsApi: before.obsApi,
      obsDensity: before.obsDensity,
      sampleTempUnit: before.sampleTempUnit,
      sampleTemp: before.sampleTemp,
      tankTempUnit: before.tankTempUnit,
      tankTemp: before.tankTemp,
      bswPct: before.bswPct,
    }))
  }

  const copyBeforeDipsToAfter = () => {
    setAfter((s) => {
      const nextDips = { ...(s.dips || {}) }
      const src = before.dips || {}

      Object.keys(src).forEach((tid) => {
        nextDips[tid] = {
          ...(nextDips[tid] || {}),
          total: src[tid]?.total ?? '',
          water: src[tid]?.water ?? '',
        }
      })

      return { ...s, dips: nextDips }
    })
  }

  const clearWaterDipsBoth = () => {
    setBefore((s) => {
      const nextDips = { ...(s.dips || {}) }
      Object.keys(nextDips).forEach((tid) => {
        nextDips[tid] = { ...(nextDips[tid] || {}), water: '' }
      })
      return { ...s, dips: nextDips }
    })

    setAfter((s) => {
      const nextDips = { ...(s.dips || {}) }
      Object.keys(nextDips).forEach((tid) => {
        nextDips[tid] = { ...(nextDips[tid] || {}), water: '' }
      })
      return { ...s, dips: nextDips }
    })
  }
  const updateTankSealObserved = (tankId, pos, value) => {
    setAfterTankSeals((prev) => ({
      ...prev,
      [tankId]: {
        ...(prev[tankId] || {}),
        [pos]: {
          ...((prev[tankId] || {})[pos] || { master: '', observed: '' }),
          observed: String(value || '').trim(),
        },
      },
    }))
  }

  const updateTemporarySeal = (key, value) => {
    setAfterTemporarySeals((prev) => ({
      ...prev,
      [key]: value,
    }))
  }

  const sealStats = useMemo(() => {
    let mismatch = 0
    let missing = 0

    for (const tid of Object.keys(afterTankSeals || {})) {
      for (const pos of PERMANENT_TANK_SEAL_POSITIONS) {
        const cell = afterTankSeals?.[tid]?.[pos]
        if (!cell) continue
        const master = String(cell.master || '').trim()
        const obs = String(cell.observed || '').trim()

        if (!obs) missing += 1
        if (master && obs && master !== obs) mismatch += 1
      }
    }

    // temporary required? (we keep optional for now; can enforce later at submit)
    return { mismatch, missing }
  }, [afterTankSeals])

  const setNowBoth = () => {
    const pad2 = (n) => String(n).padStart(2, '0')
    const now = new Date()
    const date = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`
    const time = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`

    setBefore((s) => ({ ...s, date, time }))
    setAfter((s) => ({ ...s, date, time }))
  }

  if (!selectedAsset) {
    return (
      <div className="full-width-field">
        <div className="info-box">Select a Primary Asset to use this layout.</div>
      </div>
    )
  }

  if (!payloadFieldExists) {
    return (
      <div className="full-width-field">
        <div className="info-box">
          Template setup required: Add a System field with field code{' '}
          <strong>{payloadFieldCode}</strong>
        </div>
      </div>
    )
  }

  if (!activeCalibrationTable || !template || !inputXCol || !outputCol) {
    return (
      <div className="full-width-field">
        <div className="info-box">
          No active calibration/template found for this asset, or template is missing
          Reference/Input X/Output roles.
        </div>
      </div>
    )
  }

  if (tankIds.length === 0) {
    return (
      <div className="full-width-field">
        <div className="info-box">
          Calibration table has no usable rows. Ensure numeric values exist in{' '}
          <strong>{inputXCol}</strong> (Input X) and <strong>{outputCol}</strong> (Output),
          and tank IDs exist in <strong>{referenceCol || 'Reference column'}</strong>.
        </div>
      </div>
    )
  }

  const renderStage = (label, stage, setStage, computed) => {
    return (
      <div className="multi-tank-card">
        <div className="multi-tank-card-header">
          <h4>{label}</h4>
        </div>

        {/* Compact, uniform parameter grid */}
        <div className="multi-tank-form-grid compact-grid">
          <div>
            <label>Date</label>
            <input
              type="date"
              value={stage.date || ''}
              onChange={(e) => setStage((s) => ({ ...s, date: e.target.value }))}
            />
          </div>

          <div>
            <label>Time</label>
            <input
              type="text"
              value={stage.time || ''}
              onChange={(e) => setStage((s) => ({ ...s, time: e.target.value }))}
              placeholder="HH:MM"
            />
          </div>

          <div>
            <label>CCF</label>
            <input
              type="number"
              step="0.0001"
              value={stage.ccf}
              onChange={(e) => setStage((s) => ({ ...s, ccf: e.target.value }))}
            />
          </div>

          <div>
            <label>BS&W (%)</label>
            <input
              type="number"
              step="0.01"
              value={stage.bswPct}
              onChange={(e) => setStage((s) => ({ ...s, bswPct: e.target.value }))}
            />
          </div>

          <div>
            <label>Observed</label>
            <select
              value={stage.obsMode}
              onChange={(e) => setStage((s) => ({ ...s, obsMode: e.target.value }))}
            >
              <option>Observed API</option>
              <option>Observed Density</option>
            </select>
          </div>

          <div>
            <label>Sample Unit</label>
            <select
              value={stage.sampleTempUnit}
              onChange={(e) => setStage((s) => ({ ...s, sampleTempUnit: e.target.value }))}
            >
              <option>°F</option>
              <option>°C</option>
            </select>
          </div>

          {String(stage.obsMode || '').toLowerCase().includes('api') ? (
            <div>
              <label>Obs API</label>
              <input
                type="number"
                step="0.01"
                value={stage.obsApi}
                onChange={(e) => setStage((s) => ({ ...s, obsApi: e.target.value }))}
              />
            </div>
          ) : (
            <div>
              <label>Obs Density</label>
              <input
                type="number"
                step="0.1"
                value={stage.obsDensity}
                onChange={(e) => setStage((s) => ({ ...s, obsDensity: e.target.value }))}
              />
            </div>
          )}

          <div>
            <label>Sample Temp</label>
            <input
              type="number"
              step="0.1"
              value={stage.sampleTemp}
              onChange={(e) => setStage((s) => ({ ...s, sampleTemp: e.target.value }))}
            />
          </div>

          <div>
            <label>Tank Unit</label>
            <select
              value={stage.tankTempUnit}
              onChange={(e) => setStage((s) => ({ ...s, tankTempUnit: e.target.value }))}
            >
              <option>°F</option>
              <option>°C</option>
            </select>
          </div>

          <div>
            <label>Tank Temp</label>
            <input
              type="number"
              step="0.1"
              value={stage.tankTemp}
              onChange={(e) => setStage((s) => ({ ...s, tankTemp: e.target.value }))}
            />
          </div>
        </div>

        <div className="section-title compact-section-title">
          <h3>Dips ({inputXUnit || 'unit'})</h3>
          <p>Per tank max shown beside tank ID.</p>
        </div>

        <table className="multi-tank-table">
          <thead>
            <tr>
              <th style={{ width: 170 }}>Tank</th>
              <th>Total</th>
              <th>Water</th>
              <th>TOV</th>
              <th>FW</th>
            </tr>
          </thead>
          <tbody>
            {tankIds.map((tid) => {
              const d = (stage.dips || {})[tid] || {}
              const per = computed.perTank[tid] || {}
              const tMax = maxDipByTank[tid] || 0
              const errorKey = `${label}-${tid}`
              const currentOverMax = tMax > 0 && toNum(d.total) > tMax
              const errorMsg =
                dipErrors[errorKey] ||
                (currentOverMax ? `Saved value exceeds Max ${tMax} ${inputXUnit || ''}. Please reduce.` : '')
              return (
                <tr key={`${label}-${tid}`}>
                  <td>
                    <div className="tank-id-cell">
                      <div className="tank-id">{tid}</div>
                      <div className="tank-sub">
                        Max: {format(tMax, 2)} {inputXUnit || ''}
                      </div>
                    </div>
                  </td>
                  <td>
                    <input
                      className={`table-input ${errorMsg ? 'danger-input' : ''}`}
                      type="number"
                      step="0.01"
                      max={tMax || undefined}
                      value={d.total ?? ''}
                      onChange={(e) => {
                        const nextVal = e.target.value

                        // allow clearing
                        if (String(nextVal).trim() === '') {
                          setDipErrors((prev) => {
                            const copy = { ...prev }
                            delete copy[errorKey]
                            return copy
                          })

                          setStage((s) => ({
                            ...s,
                            dips: {
                              ...(s.dips || {}),
                              [tid]: { ...(s.dips?.[tid] || {}), total: '' },
                            },
                          }))
                          return
                        }

                        const num = toNum(nextVal)

                        // block if above max
                        if (tMax > 0 && num > tMax) {
                          setDipErrors((prev) => ({
                            ...prev,
                            [errorKey]: `Value cannot exceed Max ${tMax} ${inputXUnit || ''}. Please reduce.`,
                          }))
                          return
                        }

                        // valid -> clear error + save
                        setDipErrors((prev) => {
                          const copy = { ...prev }
                          delete copy[errorKey]
                          return copy
                        })

                        setStage((s) => ({
                          ...s,
                          dips: {
                            ...(s.dips || {}),
                            [tid]: { ...(s.dips?.[tid] || {}), total: nextVal },
                          },
                        }))
                      }}
                      placeholder="Total"
                    />

                    {errorMsg ? <div className="danger-hint">{errorMsg}</div> : null}
                  </td>
                  <td>
                    <input
                      className="table-input"
                      type="number"
                      step="0.01"
                      value={d.water ?? ''}
                      onChange={(e) =>
                        setStage((s) => ({
                          ...s,
                          dips: {
                            ...(s.dips || {}),
                            [tid]: { ...(s.dips?.[tid] || {}), water: e.target.value },
                          },
                        }))
                      }
                      placeholder="Water"
                    />
                  </td>
                  <td>{format(per.tovCorrected, 2)}</td>
                  <td>{format(per.fwCorrected, 2)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>

        <div className="section-title compact-section-title">
          <h3>Stage Totals</h3>
          <p>Table 11 Method: {computed.totals.table11Method || '-'}</p>
        </div>

        <div className="multi-tank-kpi-grid compact-kpis">
          <div className="kpi">
            <span>TOV</span>
            <strong>{format(computed.totals.TOV, 2)} bbl</strong>
          </div>
          <div className="kpi">
            <span>GOV</span>
            <strong>{format(computed.totals.GOV, 2)} bbl</strong>
          </div>
          <div className="kpi">
            <span>API60</span>
            <strong>{format(computed.totals.API60, 2)}</strong>
          </div>
          <div className="kpi">
            <span>VCF</span>
            <strong>{format(computed.totals.VCF, 5)}</strong>
          </div>
          <div className="kpi">
            <span>NSV</span>
            <strong>{format(computed.totals.NSV, 0)} bbl</strong>
          </div>
          <div className="kpi">
            <span>LT</span>
            <strong>{format(computed.totals.LT, 0)}</strong>
          </div>
          <div className="kpi">
            <span>MT</span>
            <strong>{format(computed.totals.MT, 0)}</strong>
          </div>
          <div className="kpi">
            <span>LT Factor</span>
            <strong>{format(computed.totals.ltFactor, 8)}</strong>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="full-width-field">
      <div className="operation-special-layout multi-tank-layout">
        <div className="operation-special-layout-header">
          <h3>Multi-Tank Before/After (Barge / YADE)</h3>
          <p>
            Compact, uniform BEFORE/AFTER entry. Net card stays visible. Per-tank maximum dip shown beside tank ID.
          </p>
        </div>

        <div className="multi-tank-meta">
          <span className="meta-chip">
            <strong>Asset:</strong> {selectedAsset.assetName} ({selectedAsset.assetCode})
          </span>
          <span className="meta-chip">
            <strong>Calibration:</strong> {activeCalibrationTable.calibrationName || 'Active Table'}
          </span>
          <span className="meta-chip">
            <strong>Interpolation:</strong> {inputXCol} → {outputCol}
          </span>
          <span className="meta-chip">
            <strong>Tank count:</strong> {tankIds.length}
          </span>
        </div>

        <div className="multi-tank-actions">
          <div className="actions-left">
            <span className="actions-title">Quick Actions</span>
            <span className="actions-sub">Applies to this ticket only</span>
          </div>

          <div className="actions-right">
            <div className="actions-btn-row">
              <button type="button" className="mini-btn" onClick={copyBeforeToAfter}>
                Copy BEFORE Params → AFTER
              </button>

              <button type="button" className="mini-btn secondary-btn" onClick={copyBeforeDipsToAfter}>
                Copy BEFORE Dips → AFTER
              </button>

              <button type="button" className="mini-btn secondary-btn" onClick={clearWaterDipsBoth}>
                Clear Water (Both)
              </button>

              <button type="button" className="mini-btn secondary-btn" onClick={setNowBoth}>
                Set Date/Time Now (Both)
              </button>
              <button
                type="button"
                className="mini-btn secondary-btn"
                onClick={() => setShowSeals((v) => !v)}
              >
                {showSeals ? 'Hide Seals' : 'Show Seals'}
              </button>
            </div>
          </div>
        </div>

        <div className="full-width-field">
          <div className="info-box">
            <strong>Barge Movement Stage</strong>
            <div
              style={{
                marginTop: 8,
                display: 'flex',
                gap: 10,
                flexWrap: 'wrap',
                alignItems: 'center',
              }}
            >
              <select
                value={stageValue}
                onChange={(e) => setStageValue(e.target.value)}
              >
                <option value="">Select Stage</option>
                <option value="LOAD_1">LOAD 1</option>
                <option value="LOAD_2_TOPUP">LOAD 2 TOP-UP</option>
                <option value="UNLOAD">UNLOAD</option>
                <option value="STS">STS</option>
              </select>

              <span style={{ color: '#64748b', fontSize: 13 }}>
                This stage controls how the ticket is tracked in Barge Tracking and how
                comparisons are generated.
              </span>
            </div>
          </div>
        </div>
        <div className="multi-tank-card">
          
          <div className="info-box" style={{ marginTop: 8 }}>
            Permanent tank seals are prefetched from Barge Seal Master and should match after movement.
            Temporary seals (manifold / pumproom / others) are entered per ticket.
            {sealStats.mismatch > 0 ? (
              <div style={{ marginTop: 6 }}>
                <strong style={{ color: '#b91c1c' }}>
                  Mismatch Count: {sealStats.mismatch}
                </strong>
              </div>
            ) : (
              <div style={{ marginTop: 6 }}>
                <strong>Mismatch Count: 0</strong>
              </div>
            )}
            {sealLoadError ? (
              <div style={{ marginTop: 6, color: '#b91c1c', fontWeight: 800 }}>
                {sealLoadError}
              </div>
            ) : null}
          </div>

          {showSeals ? (
            <div className="multi-tank-card">
              <div className="multi-tank-card-header">
                <h4>Seal Details — After</h4>
              </div>

              {sealLoadError ? <div className="info-box">{sealLoadError}</div> : null}

              <div className="section-title compact-section-title">
                <h3>Permanent Tank Seals (Master vs Observed After)</h3>
                <p>Master comes from Barge Seal Master (read-only). Change Observed only if mismatch.</p>
              </div>

              <table className="multi-tank-table">
                <thead>
                  <tr>
                    <th>Tank</th>
                    {PERMANENT_TANK_SEAL_POSITIONS.map((pos) => (
                      <th key={pos}>{pos}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tankIds.map((tid) => (
                    <tr key={`seal-${tid}`}>
                      <td><strong>{tid}</strong></td>
                      {PERMANENT_TANK_SEAL_POSITIONS.map((pos) => {
                        const cell = afterTankSeals?.[tid]?.[pos] || { master: '', observed: '' }
                        const mismatch = cell.master && cell.observed && cell.master !== cell.observed
                        return (
                          <td key={`${tid}-${pos}`}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                              <div style={{ fontSize: 11, fontWeight: 800, color: '#64748b' }}>
                                Master: {cell.master || '-'}
                              </div>
                              <input
                                type="text"
                                className={`table-input ${mismatch ? 'danger-input' : ''}`}
                                value={cell.observed || ''}
                                onChange={(e) => {
                                  const v = String(e.target.value || '').trim()
                                  setAfterTankSeals((prev) => ({
                                    ...prev,
                                    [tid]: {
                                      ...(prev[tid] || {}),
                                      [pos]: { ...(prev?.[tid]?.[pos] || {}), observed: v },
                                    },
                                  }))
                                }}
                                placeholder="Observed After"
                              />
                              {mismatch ? <div className="danger-hint">Mismatch</div> : null}
                            </div>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="section-title compact-section-title" style={{ marginTop: 14 }}>
                <h3>Temporary Seals (After)</h3>
                <p>Entered for every movement ticket (not stored in master).</p>
              </div>

              <div className="multi-tank-form-grid compact-grid">
                <div>
                  <label>Port Manifold Seal</label>
                  <input
                    type="text"
                    value={afterTemporarySeals.portManifoldSeal}
                    onChange={(e) => setAfterTemporarySeals((s) => ({ ...s, portManifoldSeal: e.target.value }))}
                    placeholder="Seal No"
                  />
                </div>

                <div>
                  <label>Starboard Manifold Seal</label>
                  <input
                    type="text"
                    value={afterTemporarySeals.stbdManifoldSeal}
                    onChange={(e) => setAfterTemporarySeals((s) => ({ ...s, stbdManifoldSeal: e.target.value }))}
                    placeholder="Seal No"
                  />
                </div>

                <div>
                  <label>Pumproom Seal</label>
                  <input
                    type="text"
                    value={afterTemporarySeals.pumproomSeal}
                    onChange={(e) => setAfterTemporarySeals((s) => ({ ...s, pumproomSeal: e.target.value }))}
                    placeholder="Seal No"
                  />
                </div>

                <div>
                  <label>Other Seal</label>
                  <input
                    type="text"
                    value={afterTemporarySeals.otherSeal}
                    onChange={(e) => setAfterTemporarySeals((s) => ({ ...s, otherSeal: e.target.value }))}
                    placeholder="Seal No"
                  />
                </div>

                <div className="full-width-field">
                  <label>Other Seal Remarks (optional)</label>
                  <textarea
                    rows="2"
                    value={afterTemporarySeals.otherRemarks}
                    onChange={(e) => setAfterTemporarySeals((s) => ({ ...s, otherRemarks: e.target.value }))}
                    placeholder="Where applied / remarks"
                  />
                </div>
              </div>
            </div>
          ) : null}
        </div>
        {lookupError ? <div className="info-box">{lookupError}</div> : null}

        <div className="multi-tank-grid">
          {renderStage('BEFORE', before, setBefore, beforeComputed)}
          {renderStage('AFTER', after, setAfter, afterComputed)}

          {/* ✅ keep Net card design as you said */}
          <div className="multi-tank-card sticky-card">
            <div className="multi-tank-card-header">
              <h4>Net Movement (After − Before)</h4>
            </div>

            <table className="multi-tank-table">
              <thead>
                <tr>
                  <th>Metric</th>
                  <th>Before</th>
                  <th>After</th>
                  <th>Net</th>
                </tr>
              </thead>
              <tbody>
                <SummaryRow label="TOV" before={beforeComputed.totals.TOV} after={afterComputed.totals.TOV} net={netTotals.TOV} unit="bbl" dp={2} />
                <SummaryRow label="FW" before={beforeComputed.totals.FW} after={afterComputed.totals.FW} net={netTotals.FW} unit="bbl" dp={2} />
                <SummaryRow label="GOV" before={beforeComputed.totals.GOV} after={afterComputed.totals.GOV} net={netTotals.GOV} unit="bbl" dp={2} />
                <SummaryRow label="GSV" before={beforeComputed.totals.GSV} after={afterComputed.totals.GSV} net={netTotals.GSV} unit="bbl" dp={0} />
                <SummaryRow label="NSV" before={beforeComputed.totals.NSV} after={afterComputed.totals.NSV} net={netTotals.NSV} unit="bbl" dp={0} />
                <SummaryRow label="LT" before={beforeComputed.totals.LT} after={afterComputed.totals.LT} net={netTotals.LT} unit="" dp={0} />
                <SummaryRow label="MT" before={beforeComputed.totals.MT} after={afterComputed.totals.MT} net={netTotals.MT} unit="" dp={0} />
              </tbody>
            </table>

            <div className="info-box" style={{ marginTop: 10 }}>
              <strong>Table 11 LT Factor</strong>
              <div>Before: {format(beforeComputed.totals.ltFactor, 8)} ({beforeComputed.totals.table11Method || '-'})</div>
              <div>After: {format(afterComputed.totals.ltFactor, 8)} ({afterComputed.totals.table11Method || '-'})</div>
            </div>

            <div className="info-box" style={{ marginTop: 10 }}>
              Payload saved into <strong>{payloadFieldCode}</strong> (system JSON).
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
