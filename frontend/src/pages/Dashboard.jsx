import { useEffect, useMemo, useRef, useState } from 'react'
import GridLayout, { WidthProvider } from 'react-grid-layout'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'

import ReactECharts from 'echarts-for-react'

import { getDashboardConfigs, getDashboardVersion } from '../api/dashboardApi'
import { listDashboardDataSources, fetchDashboardData } from '../api/dashboardDataApi'

const AutoWidthGridLayout = WidthProvider(GridLayout)

const safeString = (value) => {
  if (value === undefined || value === null) return ''
  return String(value)
}

const formatNumber = (value) => {
  const num = Number(value)
  if (Number.isNaN(num)) return safeString(value) || '-'
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(num)
}

const buildCacheKey = (dataSourceCode, params) => {
  const code = safeString(dataSourceCode).trim().toUpperCase()
  let serialized = ''
  try {
    serialized = JSON.stringify(params || {})
  } catch {
    serialized = ''
  }
  return `${code}::${serialized}`
}

const resolveWidgetParams = (params, selectedLocationCode) => {
  const out = { ...(params || {}) }

  Object.entries(out).forEach(([key, value]) => {
    if (
      value === '$location_code' ||
      value === '{{location_code}}' ||
      value === '{{ location_code }}'
    ) {
      out[key] = selectedLocationCode || ''
    }
  })

  if (
    Object.prototype.hasOwnProperty.call(out, 'location_code') &&
    (out.location_code === null || String(out.location_code).trim() === '')
  ) {
    out.location_code = selectedLocationCode || ''
  }

  return out
}

const validateParams = (allowedSpec, params) => {
  const allowed = allowedSpec && Array.isArray(allowedSpec.allowed) ? allowedSpec.allowed : null
  if (!allowed) return { ok: false, error: 'Data source parameter schema not loaded.' }

  const allowedKeys = allowed
    .map((item) => safeString(item?.key).trim())
    .filter((k) => k !== '')

  const allowedKeySet = new Set(allowedKeys)

  const extraKeys = Object.keys(params || {}).filter((k) => !allowedKeySet.has(k))
  if (extraKeys.length > 0) {
    return { ok: false, error: `Unexpected params: ${extraKeys.sort().join(', ')}` }
  }

  const missing = allowed
    .filter((item) => Boolean(item?.required))
    .map((item) => safeString(item?.key).trim())
    .filter((k) => k !== '')
    .filter(
      (k) =>
        params?.[k] === undefined ||
        params?.[k] === null ||
        String(params?.[k]).trim() === ''
    )

  if (missing.length > 0) {
    return { ok: false, error: `Missing required params: ${missing.join(', ')}` }
  }

  return { ok: true, error: '' }
}

const getWidgetDefinition = (widgets, widgetId) => {
  if (!widgets || typeof widgets !== 'object') return null
  return widgets[widgetId] || widgets[String(widgetId)] || null
}

const getWidgetType = (widget) => {
  const raw = widget?.type || widget?.widget_type || widget?.widgetType
  return safeString(raw).trim().toUpperCase()
}

const getWidgetTitle = (widget) => {
  const raw = widget?.title || widget?.name || widget?.label
  const title = safeString(raw).trim()
  return title || 'Widget'
}

const getValueFromPath = (obj, path) => {
  const p = safeString(path).trim()
  if (p === '') return undefined

  const parts = p.split('.').filter(Boolean)
  let cur = obj
  for (const part of parts) {
    if (!cur || typeof cur !== 'object') return undefined
    cur = cur[part]
  }
  return cur
}

const WidgetShell = ({ title, children }) => {
  return (
    <div
      style={{
        height: '100%',
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        background: '#fff',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          padding: '10px 12px',
          borderBottom: '1px solid #e5e7eb',
          fontWeight: 600,
          fontSize: 14,
        }}
      >
        {title}
      </div>
      <div style={{ padding: 12, overflow: 'auto', flex: 1 }}>{children}</div>
    </div>
  )
}

const KPIWidget = ({ title, data, meta, mapping }) => {
  const valueFrom = mapping?.valueFrom || mapping?.value_from || mapping?.valuePath || ''
  const labelFrom = mapping?.labelFrom || mapping?.label_from || ''

  let value = undefined
  let label = ''

  if (safeString(valueFrom).startsWith('meta.')) {
    value = getValueFromPath({ meta }, valueFrom)
  } else if (safeString(valueFrom).startsWith('rows.')) {
    value = getValueFromPath({ rows: data || [] }, valueFrom)
  } else {
    const first = Array.isArray(data) ? data[0] : null
    value = valueFrom ? first?.[valueFrom] : undefined
  }

  if (labelFrom) {
    if (safeString(labelFrom).startsWith('meta.')) {
      label = safeString(getValueFromPath({ meta }, labelFrom))
    } else if (safeString(labelFrom).startsWith('rows.')) {
      label = safeString(getValueFromPath({ rows: data || [] }, labelFrom))
    } else {
      const first = Array.isArray(data) ? data[0] : null
      label = safeString(first?.[labelFrom] ?? '')
    }
  }

  return (
    <WidgetShell title={title}>
      {label ? <div style={{ color: '#6b7280', fontSize: 12 }}>{label}</div> : null}
      <div style={{ fontSize: 34, fontWeight: 700, marginTop: 6 }}>{formatNumber(value)}</div>
    </WidgetShell>
  )
}

const TableWidget = ({ title, data, columns, limit }) => {
  const rows = Array.isArray(data) ? data.slice(0, limit) : []

  return (
    <WidgetShell title={title}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {(columns || []).map((col, idx) => (
              <th
                key={`${idx}-${safeString(col?.header)}`}
                style={{
                  textAlign: 'left',
                  fontSize: 12,
                  color: '#374151',
                  borderBottom: '1px solid #e5e7eb',
                  padding: '6px 4px',
                }}
              >
                {col?.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={(columns || []).length || 1} style={{ padding: '8px 4px' }}>
                No rows.
              </td>
            </tr>
          ) : (
            rows.map((row, idx) => (
              <tr key={idx}>
                {(columns || []).map((col, j) => (
                  <td
                    key={`${idx}-${j}-${safeString(col?.field)}`}
                    style={{
                      borderBottom: '1px solid #f3f4f6',
                      padding: '6px 4px',
                      fontSize: 12,
                    }}
                  >
                    {safeString(row?.[col?.field] ?? '-')}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </WidgetShell>
  )
}

const TankVisualWidget = ({ title, rows, config }) => {
  const cols = Math.min(Math.max(Number(config?.columns ?? 4), 1), 8)
  const cardHeight = Math.min(Math.max(Number(config?.cardHeight ?? 220), 160), 520)

  const showPercent = Boolean(config?.showPercent ?? true)
  const showStock = Boolean(config?.showStock ?? true)
  const showEmpty = Boolean(config?.showEmpty ?? true)
  const showCapacity = Boolean(config?.showCapacity ?? true)

  const low = Number(config?.thresholds?.low ?? 20)
  const high = Number(config?.thresholds?.high ?? 80)
  const unit = safeString(config?.unit ?? 'bbl')

  const items = Array.isArray(rows) ? rows : []

  const pctColor = (p) => {
    const v = Number(p || 0)
    if (v <= low) return '#b91c1c' // low
    if (v >= high) return '#065f46' // high
    return '#1d4ed8' // normal
  }

  const fmt = (n) => {
    const v = Number(n || 0)
    if (!Number.isFinite(v)) return '0'
    return v.toLocaleString(undefined, { maximumFractionDigits: 2 })
  }

  const TankSvg = ({ percent, color }) => {
    const p = Math.min(Math.max(Number(percent || 0), 0), 100)

    const cx = 60
    const topY = 28
    const bodyX = 25
    const bodyY = topY
    const bodyW = 70
    const bodyH = 128
    const rx = bodyW / 2
    const ry = 12
    const bottomY = bodyY + bodyH

    const liquidH = bodyH * (p / 100)
    const liquidTopY = bodyY + bodyH - liquidH

    return (
      <svg width="92" height="182" viewBox="0 0 120 190">
        <defs>
          {/* Metallic cylindrical body */}
          <linearGradient id="tankBodyGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#c7ced8" />
            <stop offset="14%" stopColor="#edf1f5" />
            <stop offset="34%" stopColor="#cfd6df" />
            <stop offset="55%" stopColor="#b8c0cb" />
            <stop offset="78%" stopColor="#dfe5eb" />
            <stop offset="100%" stopColor="#bcc4cf" />
          </linearGradient>

          {/* Soft glass highlight */}
          <linearGradient id="tankGlossGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="rgba(255,255,255,0)" />
            <stop offset="30%" stopColor="rgba(255,255,255,0.34)" />
            <stop offset="52%" stopColor="rgba(255,255,255,0.10)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0)" />
          </linearGradient>

          {/* Liquid */}
          <linearGradient id="liquidGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor={color} stopOpacity="0.72" />
            <stop offset="100%" stopColor={color} stopOpacity="1" />
          </linearGradient>

          {/* Liquid side depth shading */}
          <linearGradient id="liquidSideGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="rgba(255,255,255,0.18)" />
            <stop offset="35%" stopColor="rgba(255,255,255,0.02)" />
            <stop offset="70%" stopColor="rgba(0,0,0,0.10)" />
            <stop offset="100%" stopColor="rgba(0,0,0,0.18)" />
          </linearGradient>

          {/* Liquid top surface gradient (looks like curved surface) */}
          <radialGradient id="liquidTopGrad" cx="50%" cy="35%" r="75%">
            <stop offset="0%" stopColor="rgba(255,255,255,0.35)" />
            <stop offset="45%" stopColor="rgba(255,255,255,0.10)" />
            <stop offset="100%" stopColor="rgba(0,0,0,0.12)" />
          </radialGradient>

          {/* Clip everything to inside the cylindrical body */}
          <clipPath id="tankClip">
            <rect x={bodyX} y={bodyY} width={bodyW} height={bodyH} />
          </clipPath>
        </defs>

        {/* Floor shadow */}
        <ellipse cx={cx} cy={171} rx={37} ry={11} fill="rgba(0,0,0,0.10)" />

        {/* BACK TOP HALF (rear rim) */}
        <path
          d={`M ${cx - rx} ${topY} A ${rx} ${ry} 0 0 1 ${cx + rx} ${topY}`}
          fill="none"
          stroke="#aeb7c3"
          strokeWidth="2"
        />

        {/* Cylinder body */}
        <rect
          x={bodyX}
          y={bodyY}
          width={bodyW}
          height={bodyH}
          fill="url(#tankBodyGrad)"
          stroke="#b8c0cb"
          strokeWidth="1.5"
        />

        {/* Side gloss */}
        <rect
          x={bodyX + 8}
          y={bodyY + 2}
          width="16"
          height={bodyH - 4}
          fill="url(#tankGlossGrad)"
          opacity="0.95"
        />

        {/* Liquid inside body (3D) */}
        <g clipPath="url(#tankClip)">
          {/* Liquid volume (matches cylinder + curved bottom) */}
          {p > 0 ? (
            <>
              {/* Main liquid body */}
              <path
                d={[
                  `M ${bodyX} ${liquidTopY}`,
                  `L ${bodyX + bodyW} ${liquidTopY}`,
                  `L ${bodyX + bodyW} ${bottomY}`,
                  `A ${rx} ${ry} 0 0 1 ${bodyX} ${bottomY}`,
                  `Z`,
                ].join(' ')}
                fill="url(#liquidGrad)"
              />

              {/* Liquid side shading (gives cylinder depth) */}
              <path
                d={[
                  `M ${bodyX} ${liquidTopY}`,
                  `L ${bodyX + bodyW} ${liquidTopY}`,
                  `L ${bodyX + bodyW} ${bottomY}`,
                  `A ${rx} ${ry} 0 0 1 ${bodyX} ${bottomY}`,
                  `Z`,
                ].join(' ')}
                fill="url(#liquidSideGrad)"
                opacity="0.55"
              />

              {/* Curved liquid top surface (meniscus) */}
              <ellipse
                cx={cx}
                cy={liquidTopY}
                rx={rx}
                ry={ry}
                fill="url(#liquidTopGrad)"
                opacity="0.95"
              />

              {/* Front rim highlight on liquid top */}
              <path
                d={`M ${cx - rx} ${liquidTopY} A ${rx} ${ry} 0 0 0 ${cx + rx} ${liquidTopY}`}
                fill="none"
                stroke="rgba(255,255,255,0.35)"
                strokeWidth="2"
              />

              {/* Back rim shadow on liquid top */}
              <path
                d={`M ${cx - rx} ${liquidTopY} A ${rx} ${ry} 0 0 1 ${cx + rx} ${liquidTopY}`}
                fill="none"
                stroke="rgba(0,0,0,0.10)"
                strokeWidth="2"
              />
            </>
          ) : null}

          {/* subtle internal base shadow for depth */}
          <ellipse
            cx={cx}
            cy={bottomY - 1}
            rx={rx}
            ry={ry}
            fill="rgba(0,0,0,0.06)"
          />
        </g>

        {/* TOP ELLIPSE SURFACE */}
        <ellipse
          cx={cx}
          cy={topY}
          rx={rx}
          ry={ry}
          fill="rgba(210,218,226,0.45)"
        />

        {/* FRONT TOP HALF (front rim) */}
        <path
          d={`M ${cx - rx} ${topY} A ${rx} ${ry} 0 0 0 ${cx + rx} ${topY}`}
          fill="none"
          stroke="#b8c0cb"
          strokeWidth="2"
        />

        {/* Optional inner top lip */}
        <path
          d={`M ${cx - rx + 6} ${topY + 1} A ${rx - 6} ${ry - 5} 0 0 0 ${cx + rx - 6} ${topY + 1}`}
          fill="none"
          stroke="rgba(120,130,145,0.22)"
          strokeWidth="1.3"
        />

        {/* BOTTOM FRONT HALF ONLY — no opaque fill */}
        <path
          d={`M ${cx - rx} ${bottomY} A ${rx} ${ry} 0 0 0 ${cx + rx} ${bottomY}`}
          fill="none"
          stroke="#b8c0cb"
          strokeWidth="2.2"
        />

        {/* Very subtle back/base hint */}
        <path
          d={`M ${cx - rx} ${bottomY} A ${rx} ${ry} 0 0 1 ${cx + rx} ${bottomY}`}
          fill="none"
          stroke="rgba(150,160,175,0.18)"
          strokeWidth="1.2"
        />
      </svg>
    )
  }

  return (
    <WidgetShell title={title}>
      {items.length === 0 ? (
        <div style={{ fontSize: 12, opacity: 0.8 }}>No tanks returned for this selection.</div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${cols}, minmax(220px, 1fr))`,
            gap: 12,
          }}
        >
          {items.map((r) => {
            const name = r?.tank_asset_name || r?.tank_asset_code || 'Tank'
            const code = r?.tank_asset_code || ''
            const percent = Number(r?.fill_percent || 0)
            const color = pctColor(percent)

            return (
              <div
                key={code || name}
                style={{
                  border: '1px solid #e5e7eb',
                  borderRadius: 12,
                  padding: 12,
                  height: cardHeight,
                  display: 'flex',
                  gap: 12,
                  alignItems: 'center',
                }}
              >
                <TankSvg percent={percent} color={color} />

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 800, fontSize: 13, color: '#111827' }}>
                    {name}
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.75, marginTop: 2 }}>
                    {code}
                  </div>

                  {showPercent ? (
                    <div style={{ marginTop: 10, fontSize: 14, fontWeight: 800, color }}>
                      {percent.toFixed(1)}%
                    </div>
                  ) : null}

                  <div style={{ marginTop: 8, fontSize: 12, lineHeight: 1.6 }}>
                    {showStock ? (
                      <div>
                        <strong>Stock:</strong> {fmt(r?.stock_value)} {unit}
                      </div>
                    ) : null}

                    {showCapacity ? (
                      <div>
                        <strong>Capacity:</strong> {fmt(r?.capacity_value)} {unit}
                      </div>
                    ) : null}

                    {showEmpty ? (
                      <div>
                        <strong>Empty:</strong> {fmt(r?.empty_value)} {unit}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </WidgetShell>
  )
}

const TextWidget = ({ title, body }) => {
  const text = safeString(body)
  return (
    <WidgetShell title={title}>
      <div style={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>{text}</div>
    </WidgetShell>
  )
}

const renderEChart = ({ chartType, rows, xField, yField }) => {
  const data = Array.isArray(rows) ? rows : []
  if (!xField || !yField) {
    return <div style={{ fontSize: 12, opacity: 0.8 }}>Configure xField and yField.</div>
  }
  if (data.length === 0) {
    return <div style={{ fontSize: 12, opacity: 0.8 }}>No rows returned.</div>
  }

  const x = data.map((r) => r?.[xField])
  const y = data.map((r) => {
    const n = Number(r?.[yField])
    return Number.isFinite(n) ? n : null
  })

  const type = String(chartType || 'LINE').toUpperCase() === 'BAR' ? 'bar' : 'line'

  const option = {
    grid: { left: 45, right: 15, top: 20, bottom: 40 },
    tooltip: { trigger: 'axis' },
    xAxis: {
      type: 'category',
      data: x,
      axisLabel: { rotate: 30 },
    },
    yAxis: { type: 'value' },
    series: [
      {
        name: yField,
        type,
        data: y,
        smooth: type === 'line',
        showSymbol: false,
      },
    ],
  }

  return <ReactECharts option={option} style={{ height: 260, width: '100%' }} />
}

const DataWidget = ({ widgetId, widget, selectedLocationCode, allowedParamsByCode, cacheRef }) => {
  const [state, setState] = useState({ loading: false, error: '', rows: [], meta: {} })

  const type = getWidgetType(widget)
  const title = getWidgetTitle(widget)

  const dataSourceCode = safeString(widget?.data?.data_source_code || widget?.data?.dataSourceCode).trim()
  const rawParams =
    widget?.data?.params && typeof widget.data.params === 'object' ? widget.data.params : {}
  const params = useMemo(
    () => resolveWidgetParams(rawParams, selectedLocationCode),
    [rawParams, selectedLocationCode]
  )

  const cacheKey = useMemo(() => buildCacheKey(dataSourceCode, params), [dataSourceCode, params])

  useEffect(() => {
    if (type === 'TEXT') return

    const codeUpper = safeString(dataSourceCode).trim().toUpperCase()
    if (!codeUpper) {
      setState({ loading: false, error: 'Data source not configured.', rows: [], meta: {} })
      return
    }

    const allowedSpec = allowedParamsByCode.get(codeUpper)
    const validation = validateParams(allowedSpec, params)
    if (!validation.ok) {
      setState({ loading: false, error: validation.error, rows: [], meta: {} })
      return
    }

    const cached = cacheRef.current.get(cacheKey)
    if (cached && cached.status === 'done') {
      setState({ loading: false, error: '', rows: cached.rows || [], meta: cached.meta || {} })
      return
    }
    if (cached && cached.status === 'error') {
      setState({
        loading: false,
        error: cached.error || 'Unable to load widget data',
        rows: [],
        meta: {},
      })
      return
    }
    if (cached && cached.status === 'loading') {
      setState((prev) => ({ ...prev, loading: true, error: '' }))
      return
    }

    cacheRef.current.set(cacheKey, { status: 'loading' })
    setState((prev) => ({ ...prev, loading: true, error: '' }))

    fetchDashboardData({
      data_source_code: codeUpper,
      params,
    })
      .then((res) => {
        const rows = Array.isArray(res?.rows) ? res.rows : []
        const meta = res?.meta && typeof res.meta === 'object' ? res.meta : {}
        cacheRef.current.set(cacheKey, { status: 'done', rows, meta })
        setState({ loading: false, error: '', rows, meta })
      })
      .catch((e) => {
        const msg = safeString(e?.message) || 'Unable to load widget data'
        cacheRef.current.set(cacheKey, { status: 'error', error: msg })
        setState({ loading: false, error: msg, rows: [], meta: {} })
      })
  }, [allowedParamsByCode, cacheKey, cacheRef, dataSourceCode, params, type])

  if (type === 'TEXT') {
    const body = widget?.config?.body || widget?.config?.text || ''
    return <TextWidget title={title} body={body} />
  }

  if (type === 'CHART') {
    const cfg = widget?.config || {}
    const chartType = cfg.chartType || 'LINE'
    const xField = cfg.xField || ''
    const yField = cfg.yField || ''
    return (
      <WidgetShell title={title}>
        {state.loading ? (
          <div style={{ fontSize: 12, opacity: 0.8 }}>Loading…</div>
        ) : state.error ? (
          <div style={{ color: 'red', fontSize: 12 }}>{state.error}</div>
        ) : (
          renderEChart({ chartType, rows: state.rows, xField, yField })
        )}
      </WidgetShell>
    )
  }

  if (type === 'TANK_VISUAL') {
    return (
      <WidgetShell title={title}>
        {state.loading ? (
          <div style={{ fontSize: 12, opacity: 0.8 }}>Loading…</div>
        ) : state.error ? (
          <div style={{ color: 'red', fontSize: 12 }}>{state.error}</div>
        ) : (
          <TankVisualWidget title={title} rows={state.rows} config={widget?.config || {}} />
        )}
      </WidgetShell>
    )
  }

  if (state.loading) {
    return (
      <WidgetShell title={title}>
        <div>Loading...</div>
      </WidgetShell>
    )
  }

  if (state.error) {
    return (
      <WidgetShell title={title}>
        <div style={{ color: '#b91c1c' }}>{state.error}</div>
      </WidgetShell>
    )
  }

  if (type === 'KPI') {
    const mapping = widget?.mapping && typeof widget.mapping === 'object' ? widget.mapping : {}
    return <KPIWidget title={title} data={state.rows} meta={state.meta} mapping={mapping} />
  }

  if (type === 'TABLE') {
    const cfg = widget?.config || {}
    const limit = Number(cfg.limit || 10)
    const columns = Array.isArray(cfg.columns) ? cfg.columns : []
    return (
      <TableWidget
        title={title}
        data={state.rows}
        columns={columns}
        limit={Number.isFinite(limit) ? limit : 10}
      />
    )
  }

  return (
    <WidgetShell title={title}>
      <div>Unsupported widget type: {type || '-'}</div>
    </WidgetShell>
  )
}

export default function Dashboard({ locations }) {
  const [selectedLocationCode, setSelectedLocationCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [activeConfig, setActiveConfig] = useState(null)
  const [activeVersion, setActiveVersion] = useState(null)

  const [dataSourcesLoading, setDataSourcesLoading] = useState(false)
  const [dataSourcesError, setDataSourcesError] = useState('')
  const allowedParamsByCode = useRef(new Map())

  const cacheRef = useRef(new Map())
  const locationOptions = Array.isArray(locations) ? locations : []

  useEffect(() => {
    if (selectedLocationCode) return
    const first = locationOptions[0]
    const code = first?.locationCode || first?.location_code || ''
    if (code) setSelectedLocationCode(code)
  }, [locationOptions, selectedLocationCode])

  const loadDataSources = async () => {
    setDataSourcesLoading(true)
    setDataSourcesError('')
    try {
      const list = await listDashboardDataSources({ status: 'Active' })
      const next = new Map()
      ;(Array.isArray(list) ? list : []).forEach((ds) => {
        const code = safeString(ds?.data_source_code || ds?.dataSourceCode).trim().toUpperCase()
        if (!code) return
        next.set(code, ds?.allowed_params_json || ds?.allowedParamsJson || null)
      })
      allowedParamsByCode.current = next
    } catch (e) {
      setDataSourcesError(safeString(e?.message) || 'Unable to load data sources')
      allowedParamsByCode.current = new Map()
    } finally {
      setDataSourcesLoading(false)
    }
  }

  const loadActiveDashboard = async (locationCode) => {
    setLoading(true)
    setError('')
    setActiveConfig(null)
    setActiveVersion(null)

    try {
      const loc = safeString(locationCode).trim()

      const pickUsable = (configs) => {
        const list = Array.isArray(configs) ? configs : []
        return list.find((c) => c?.status === 'Published' && c?.active_version_id) || null
      }

      let config = null

      if (loc) {
        const locationConfigs = await getDashboardConfigs({
          scope_type: 'LOCATION',
          location_code: loc,
          status: 'Published',
        })
        config = pickUsable(locationConfigs)
      }

      if (!config) {
        const globalConfigs = await getDashboardConfigs({
          scope_type: 'GLOBAL',
          status: 'Published',
        })
        config = pickUsable(globalConfigs)
      }

      if (!config) {
        setError('No published dashboard config found (with active_version_id).')
        return
      }

      const versionId = config.active_version_id
      const version = await getDashboardVersion(versionId)
      const configJson = version?.config_json

      if (!configJson || typeof configJson !== 'object') {
        setError('Dashboard version config_json is missing or invalid.')
        return
      }

      setActiveConfig(config)
      setActiveVersion(version)
      cacheRef.current = new Map()
    } catch (e) {
      setError(safeString(e?.message) || 'Unable to load dashboard.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadDataSources()
  }, [])

  useEffect(() => {
    loadActiveDashboard(selectedLocationCode)
  }, [selectedLocationCode])

  const versionConfigJson =
    activeVersion?.config_json && typeof activeVersion.config_json === 'object'
      ? activeVersion.config_json
      : null

  const layout = Array.isArray(versionConfigJson?.layout) ? versionConfigJson.layout : []
  const widgets =
    versionConfigJson?.widgets && typeof versionConfigJson.widgets === 'object'
      ? versionConfigJson.widgets
      : {}

  return (
    <div>
      <div className="page-title">
        <div>
          <h2>Dashboard</h2>
          <p>Read-only dashboard viewer (published configuration)</p>
        </div>
      </div>

      <div
        className="info-box no-print"
        style={{
          display: 'flex',
          gap: 12,
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <strong>Location</strong>

          {locationOptions.length > 0 ? (
            <select value={selectedLocationCode} onChange={(e) => setSelectedLocationCode(e.target.value)}>
              {locationOptions.map((loc) => {
                const code = loc?.locationCode || loc?.location_code
                const name = loc?.locationName || loc?.location_name || code
                return (
                  <option key={code} value={code}>
                    {name} ({code})
                  </option>
                )
              })}
            </select>
          ) : (
            <input
              value={selectedLocationCode}
              onChange={(e) => setSelectedLocationCode(e.target.value)}
              placeholder="Location Code"
            />
          )}

          <button type="button" onClick={() => loadActiveDashboard(selectedLocationCode)} disabled={loading}>
            Refresh
          </button>
        </div>

        <div style={{ color: '#6b7280', fontSize: 12 }}>
          {activeConfig ? (
            <span>
              Using: <strong>{safeString(activeConfig?.name)}</strong> ({safeString(activeConfig?.scope_type)})
            </span>
          ) : (
            <span />
          )}
        </div>
      </div>

      {dataSourcesLoading ? <div style={{ padding: 12 }}>Loading data sources...</div> : null}
      {dataSourcesError ? <div style={{ padding: 12, color: '#b91c1c' }}>{dataSourcesError}</div> : null}

      {loading ? <div style={{ padding: 12 }}>Loading dashboard...</div> : null}
      {error ? <div style={{ padding: 12, color: '#b91c1c' }}>{error}</div> : null}

      {!loading && !error && versionConfigJson ? (
        <div style={{ padding: 12 }}>
          <AutoWidthGridLayout
            layout={layout}
            rowHeight={30}
            cols={12}
            margin={[12, 12]}
            isDraggable={false}
            isResizable={false}
            compactType="vertical"
            preventCollision={true}
          >
            {layout.map((item) => {
              const widgetId = item?.i
              const widget = getWidgetDefinition(widgets, widgetId)

              if (!widget) {
                return (
                  <div key={widgetId}>
                    <WidgetShell title="Missing Widget">
                      <div>Widget not found: {safeString(widgetId)}</div>
                    </WidgetShell>
                  </div>
                )
              }

              return (
                <div key={widgetId}>
                  <DataWidget
                    widgetId={widgetId}
                    widget={widget}
                    selectedLocationCode={selectedLocationCode}
                    allowedParamsByCode={allowedParamsByCode.current}
                    cacheRef={cacheRef}
                  />
                </div>
              )
            })}
          </AutoWidthGridLayout>
        </div>
      ) : null}
    </div>
  )
}
