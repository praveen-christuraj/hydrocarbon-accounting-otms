import { useEffect, useMemo, useState } from 'react'
import GridLayout, { WidthProvider } from 'react-grid-layout'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'

import ReactECharts from 'echarts-for-react'

import {
  getDashboardConfigs,
  getDashboardConfig,
  createDashboardConfig,
  updateDashboardConfig,
  publishDashboard,
  getDashboardVersion,
} from '../api/dashboardApi'

import { listDashboardDataSources, fetchDashboardData } from '../api/dashboardDataApi'

const ResponsiveGridLayout = WidthProvider(GridLayout)
const DEFAULT_GRID_COLS = 12

const newId = () => `w_${Math.random().toString(16).slice(2)}_${Date.now()}`

const safeParse = (s, fallback) => {
  try {
    return JSON.parse(s)
  } catch {
    return fallback
  }
}

const normalizeAllowedParams = (allowedParamsJson) => {
  const allowed = allowedParamsJson?.allowed || []
  const byKey = {}
  allowed.forEach((a) => {
    if (a?.key) byKey[a.key] = a
  })
  return { allowed, byKey }
}

const pickValueFrom = (payload, path) => {
  if (!path) return null
  const parts = String(path).split('.')
  let cur = payload
  for (const p of parts) {
    if (cur == null) return null
    cur = cur[p]
  }
  return cur
}

const defaultConfigJson = () => ({
  layout: [],
  widgets: {},
})

const buildWidgetDefaults = (type) => {
  const t = String(type || '').toUpperCase()

  if (t === 'KPI') {
    return {
      type: 'KPI',
      title: 'New KPI',
      data: { data_source_code: '', params: {} },
      mapping: { valueFrom: 'meta.total_rows' },
      style: { decimals: 3 },
    }
  }

  if (t === 'TABLE') {
    return {
      type: 'TABLE',
      title: 'New Table',
      data: { data_source_code: '', params: {} },
      config: { limit: 10, columns: [{ header: 'Field', field: '' }] },
    }
  }

  if (t === 'CHART') {
    return {
      type: 'CHART',
      title: 'New Chart',
      data: { data_source_code: '', params: {} },
      config: { chartType: 'LINE', xField: '', yField: '' },
    }
  }

  if (t === 'TANK_VISUAL') {
    return {
      type: 'TANK_VISUAL',
      title: 'Tank Levels',
      data: {
        data_source_code: 'TANK_STOCK_SNAPSHOT',
        params: {
          // auto-fill will set location_code from dashboard filters
          value_field: 'NSV_BBL',
          capacity_source: 'CALIBRATION_MAX',
          sort_by: 'NAME',
          limit: 50,
          // optional multi-type selection (comma-separated)
          // asset_type_codes: 'TANK'
        },
      },
      config: {
        columns: 4,
        cardHeight: 220,
        showPercent: true,
        showStock: true,
        showEmpty: true,
        showCapacity: true,
        thresholds: {
          low: 20,
          high: 80,
        },
        unit: 'bbl',
      },
    }
  }

  return {
    type: 'TEXT',
    title: 'Notes',
    config: { body: 'Edit this text...' },
  }
}

const renderEChartPreview = ({ chartType, rows, xField, yField }) => {
  const data = Array.isArray(rows) ? rows : []
  if (!xField || !yField) return <div style={{ fontSize: 12, opacity: 0.8 }}>Set xField and yField.</div>
  if (data.length === 0) return <div style={{ fontSize: 12, opacity: 0.8 }}>No rows returned.</div>

  const x = data.map((r) => r?.[xField])
  const y = data.map((r) => {
    const n = Number(r?.[yField])
    return Number.isFinite(n) ? n : null
  })
  const type = String(chartType || 'LINE').toUpperCase() === 'BAR' ? 'bar' : 'line'

  const option = {
    grid: { left: 45, right: 15, top: 20, bottom: 40 },
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: x, axisLabel: { rotate: 30 } },
    yAxis: { type: 'value' },
    series: [{ name: yField, type, data: y, smooth: type === 'line', showSymbol: false }],
  }

  return <ReactECharts option={option} style={{ height: 260, width: '100%' }} />
}

function DashboardBuilder({
  locations = [],
  assets = [],
  operationTypes = [],
  locationOperationAvailability = [],
}) {
  const [loading, setLoading] = useState(false)
  const [sourcesLoading, setSourcesLoading] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [confirmRemoveWidget, setConfirmRemoveWidget] = useState(false)

  const [configs, setConfigs] = useState([])
  const [selectedConfigId, setSelectedConfigId] = useState('')
  const [selectedConfig, setSelectedConfig] = useState(null)

  const [scopeType, setScopeType] = useState('GLOBAL')
  const [locationCode, setLocationCode] = useState('')

  const [name, setName] = useState('')
  const [remarks, setRemarks] = useState('')

  // ✅ Universal Dashboard Filters (not FSO-only)
  const [dashFilters, setDashFilters] = useState({
    location_code: '',
    asset_type_code: '',
    asset_code: '',
    operation_type_code: '',
    date_from: '',
    date_to: '',
  })

  const [configJson, setConfigJson] = useState(defaultConfigJson())
  const [dirty, setDirty] = useState(false)

  const [selectedWidgetId, setSelectedWidgetId] = useState('')
  const selectedWidget = useMemo(
    () => (selectedWidgetId ? configJson.widgets?.[selectedWidgetId] : null),
    [configJson.widgets, selectedWidgetId]
  )

  const [dataSources, setDataSources] = useState([])
  const sourcesByCode = useMemo(() => {
    const m = {}
    dataSources.forEach((s) => (m[s.data_source_code] = s))
    return m
  }, [dataSources])

  const [widgetPreview, setWidgetPreview] = useState({})

  const localDraftKey = useMemo(() => {
    const base = selectedConfigId ? `cfg_${selectedConfigId}` : `new_${scopeType}_${locationCode || 'NA'}`
    return `dashboard_builder_draft_${base}`
  }, [selectedConfigId, scopeType, locationCode])

  const activeLocations = useMemo(
    () => (locations || []).filter((l) => l.status === 'Active'),
    [locations]
  )

  const activeAssets = useMemo(
    () => (assets || []).filter((a) => a.status === 'Active'),
    [assets]
  )

  const activeOperationTypes = (operationTypes || []).filter((o) => o.status === 'Active')

  const activeLocationOpAvailability = (locationOperationAvailability || []).filter(
    (x) => x.status === 'Active'
  )

  // For selected dashboard filter location:
  const selectedLoc = dashFilters.location_code

  const availableAssetsAtLocation = useMemo(() => {
    if (!selectedLoc) return activeAssets
    return activeAssets.filter((a) => String(a.locationCode || '') === String(selectedLoc))
  }, [activeAssets, selectedLoc])

  const availableAssetTypeCodesAtLocation = useMemo(() => {
    const set = new Set()
    availableAssetsAtLocation.forEach((a) => {
      const code = String(a.assetTypeCode || '').trim()
      if (code) set.add(code)
    })
    return Array.from(set).sort()
  }, [availableAssetsAtLocation])

  const availableOperationTypeCodesAtLocation = useMemo(() => {
    if (!selectedLoc) {
      // If no location selected, allow all active operation types
      return new Set(activeOperationTypes.map((o) => o.operationTypeCode))
    }
    const set = new Set()
    activeLocationOpAvailability
      .filter((x) => String(x.locationCode || '') === String(selectedLoc))
      .forEach((x) => set.add(x.operationTypeCode))
    return set
  }, [activeLocationOpAvailability, activeOperationTypes, selectedLoc])

  const availableOperationTypesAtLocation = useMemo(() => {
    const codeSet = availableOperationTypeCodesAtLocation
    return activeOperationTypes.filter((o) => codeSet.has(o.operationTypeCode))
  }, [activeOperationTypes, availableOperationTypeCodesAtLocation])

  const hasFSOAtLocation = useMemo(() => {
    return availableAssetsAtLocation.some(
      (a) => String(a.assetTypeCode || '').toUpperCase() === 'FSO'
    )
  }, [availableAssetsAtLocation])

  const filteredAssetsForDash = useMemo(() => {
    return activeAssets.filter((a) => {
      if (dashFilters.location_code && String(a.locationCode || '') !== dashFilters.location_code) return false
      if (dashFilters.asset_type_code && String(a.assetTypeCode || '') !== dashFilters.asset_type_code) return false
      return true
    })
  }, [activeAssets, dashFilters.location_code, dashFilters.asset_type_code])

  const loadConfigs = async () => {
    const data = await getDashboardConfigs({})
    setConfigs(Array.isArray(data) ? data : [])
  }

  const loadDataSources = async () => {
    setSourcesLoading(true)
    try {
      const data = await listDashboardDataSources({ status: 'Active' })
      const rows = Array.isArray(data) ? data : Array.isArray(data?.rows) ? data.rows : []
      setDataSources(rows)
    } catch (e) {
      setErrorMsg(e.message || 'Unable to load dashboard data sources')
      setDataSources([])
    } finally {
      setSourcesLoading(false)
    }
  }

  const hydrateFromActiveVersion = async (cfg) => {
    if (!cfg?.active_version_id) {
      setConfigJson(defaultConfigJson())
      return
    }
    const ver = await getDashboardVersion(cfg.active_version_id)
    const cj = ver?.config_json || defaultConfigJson()
    setConfigJson({
      layout: Array.isArray(cj.layout) ? cj.layout : [],
      widgets: cj.widgets && typeof cj.widgets === 'object' ? cj.widgets : {},
    })
  }

  const loadDraftFromLocalStorage = () => {
    const raw = localStorage.getItem(localDraftKey)
    if (!raw) return false
    const parsed = safeParse(raw, null)
    if (!parsed || typeof parsed !== 'object') return false
    if (!parsed.layout || !parsed.widgets) return false
    setConfigJson(parsed)
    setDirty(true)
    return true
  }

  const saveDraftToLocalStorage = () => {
    localStorage.setItem(localDraftKey, JSON.stringify(configJson))
    setSuccessMsg('Draft saved locally (browser).')
  }

  const clearLocalDraft = () => {
    localStorage.removeItem(localDraftKey)
    setSuccessMsg('Local draft cleared.')
  }

  useEffect(() => {
    ;(async () => {
      try {
        setLoading(true)
        await loadConfigs()
        await loadDataSources()
      } catch (e) {
        setErrorMsg(e.message || 'Unable to initialize builder')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  useEffect(() => {
    ;(async () => {
      if (!selectedConfigId) {
        setSelectedConfig(null)
        setName('')
        setRemarks('')
        setConfigJson(defaultConfigJson())
        setSelectedWidgetId('')
        setDirty(false)
        return
      }

      try {
        setLoading(true)
        const cfg = await getDashboardConfig(selectedConfigId)
        setSelectedConfig(cfg)
        setName(cfg.name || '')
        setRemarks(cfg.remarks || '')
        setScopeType(cfg.scope_type || 'GLOBAL')
        setLocationCode(cfg.location_code || '')
        setSelectedWidgetId('')
        setDirty(false)

        // auto-set dashboard location filter if config is LOCATION scoped
        setDashFilters((prev) => ({
          ...prev,
          location_code: cfg.location_code || prev.location_code || '',
        }))

        const loadedLocal = loadDraftFromLocalStorage()
        if (!loadedLocal) await hydrateFromActiveVersion(cfg)
      } catch (e) {
        setErrorMsg(e.message || 'Unable to load dashboard config')
      } finally {
        setLoading(false)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedConfigId])

  const onLayoutChange = (layout) => {
    setConfigJson((prev) => ({ ...prev, layout }))
    setDirty(true)
  }

  const addWidget = (type) => {
    const id = newId()
    const widget = { id, ...buildWidgetDefaults(type) }
    const t = String(type).toUpperCase()

    const layoutItem = {
      i: id,
      x: 0,
      y: Infinity,
      w: t === 'TABLE' || t === 'TANK_VISUAL' ? 12 : 4,
      h: t === 'TABLE' ? 8 : t === 'TANK_VISUAL' ? 10 : 4,
    }

    setConfigJson((prev) => ({
      layout: [...prev.layout, layoutItem],
      widgets: { ...prev.widgets, [id]: widget },
    }))
    setSelectedWidgetId(id)
    setDirty(true)
  }

  const removeWidget = () => {
    if (!selectedWidgetId) return
    setConfirmRemoveWidget(true)
  }

  const confirmRemoveWidgetAction = () => {
    setConfirmRemoveWidget(false)
    setConfigJson((prev) => {
      const nextWidgets = { ...prev.widgets }
      delete nextWidgets[selectedWidgetId]
      const nextLayout = (prev.layout || []).filter((l) => l.i !== selectedWidgetId)
      return { layout: nextLayout, widgets: nextWidgets }
    })
    setSelectedWidgetId('')
    setDirty(true)
  }

  const updateWidget = (patch) => {
    if (!selectedWidgetId) return
    setConfigJson((prev) => ({
      ...prev,
      widgets: { ...prev.widgets, [selectedWidgetId]: { ...prev.widgets[selectedWidgetId], ...patch } },
    }))
    setDirty(true)
  }

  const updateWidgetData = (patch) => {
    if (!selectedWidgetId) return
    const current = configJson.widgets[selectedWidgetId]
    updateWidget({ data: { ...(current.data || {}), ...patch } })
  }

  const updateWidgetConfig = (patch) => {
    if (!selectedWidgetId) return
    const current = configJson.widgets[selectedWidgetId]
    updateWidget({ config: { ...(current.config || {}), ...patch } })
  }

  const updateWidgetParams = (key, value) => {
    if (!selectedWidgetId) return
    const current = configJson.widgets[selectedWidgetId]
    const params = { ...((current.data || {}).params || {}) }
    params[key] = value
    updateWidgetData({ params })
  }

  // ✅ Apply universal dashboard filters to widget params (only if empty)
  const applyDashboardFiltersToWidgetParams = (widget) => {
    if (!widget?.data?.data_source_code) return
    const src = sourcesByCode[widget.data.data_source_code]
    if (!src) return

    const { allowed } = normalizeAllowedParams(src.allowed_params_json || {})
    const allowedKeys = new Set(allowed.map((a) => a.key))

    const params = { ...(widget.data.params || {}) }

    const fillIfEmpty = (key, value) => {
      const cur = params[key]
      if (cur === undefined || cur === null || String(cur).trim() === '') {
        if (value !== undefined && value !== null && String(value).trim() !== '') params[key] = value
      }
    }

    fillIfEmpty('location_code', dashFilters.location_code)
    fillIfEmpty('asset_type_code', dashFilters.asset_type_code)
    fillIfEmpty('asset_code', dashFilters.asset_code)
    fillIfEmpty('operation_type_code', dashFilters.operation_type_code)
    fillIfEmpty('date_from', dashFilters.date_from)
    fillIfEmpty('date_to', dashFilters.date_to)

    // Backward compat: if widget expects fso_asset_code, fill it using selected asset_code when asset type is FSO
    if (allowedKeys.has('fso_asset_code') && dashFilters.asset_type_code === 'FSO') {
      fillIfEmpty('fso_asset_code', dashFilters.asset_code)
    }

    // Remove any keys not allowed for this data source
    Object.keys(params).forEach((k) => {
      if (!allowedKeys.has(k)) delete params[k]
    })

    updateWidgetData({ params })
  }

  const validateWidgetParams = (widget) => {
    if (!widget?.data?.data_source_code) return { ok: false, msg: 'Select a data source' }
    const src = sourcesByCode[widget.data.data_source_code]
    if (!src) return { ok: false, msg: 'Unknown data source' }

    const { allowed } = normalizeAllowedParams(src.allowed_params_json || {})
    const params = widget.data.params || {}

    const allowedKeys = new Set(allowed.map((a) => a.key))
    for (const k of Object.keys(params)) {
      if (!allowedKeys.has(k)) return { ok: false, msg: `Param not allowed: ${k}` }
    }

    for (const a of allowed) {
      if (a.required && (params[a.key] == null || String(params[a.key]).trim() === '')) {
        return { ok: false, msg: `Missing required: ${a.key}` }
      }
    }

    return { ok: true }
  }

  const previewWidget = async () => {
    if (!selectedWidgetId) return
    const widget = configJson.widgets[selectedWidgetId]
    if (!widget) return

    applyDashboardFiltersToWidgetParams(widget)

    const v = validateWidgetParams(widget)
    if (!v.ok) { setErrorMsg(v.msg); return }

    setWidgetPreview((p) => ({ ...p, [selectedWidgetId]: { loading: true } }))
    try {
      const resp = await fetchDashboardData({
        data_source_code: widget.data.data_source_code,
        params: widget.data.params || {},
      })
      setWidgetPreview((p) => ({
        ...p,
        [selectedWidgetId]: {
          loading: false,
          rows: resp.rows || [],
          meta: resp.meta || {},
          error: null,
        },
      }))
    } catch (e) {
      setWidgetPreview((p) => ({
        ...p,
        [selectedWidgetId]: { loading: false, error: e.message || 'Preview failed' },
      }))
    }
  }

  const createNewConfigHandler = async () => {
    if (!name.trim()) { setErrorMsg('Name is required'); return }
    if (scopeType === 'LOCATION' && !locationCode.trim()) { setErrorMsg('Location is required for LOCATION scope'); return }

    try {
      setLoading(true)
      const payload = {
        name: name.trim(),
        scope_type: scopeType,
        location_code: scopeType === 'LOCATION' ? locationCode.trim() : null,
        remarks: remarks ? remarks.trim() : null,
      }
      const cfg = await createDashboardConfig(payload)
      await loadConfigs()
      setSelectedConfigId(String(cfg.id))
      setSuccessMsg('Dashboard config created. Now add widgets and Publish.')
    } catch (e) {
      setErrorMsg(e.message || 'Unable to create dashboard config')
    } finally {
      setLoading(false)
    }
  }

  const updateConfigMetaHandler = async () => {
    if (!selectedConfigId) { setErrorMsg('Select a dashboard config first'); return }
    try {
      setLoading(true)
      await updateDashboardConfig(selectedConfigId, {
        name: name.trim(),
        scope_type: scopeType,
        location_code: scopeType === 'LOCATION' ? locationCode.trim() : null,
        remarks: remarks ? remarks.trim() : null,
      })
      await loadConfigs()
      setSuccessMsg('Config info updated.')
    } catch (e) {
      setErrorMsg(e.message || 'Unable to update config')
    } finally {
      setLoading(false)
    }
  }

  const publishHandler = async () => {
    if (!selectedConfigId) { setErrorMsg('Select a dashboard config first'); return }

    const widgetIds = Object.keys(configJson.widgets || {})
    for (const wid of widgetIds) {
      const found = (configJson.layout || []).some((l) => l.i === wid)
      if (!found) { setErrorMsg(`Widget ${wid} missing layout item`); return }
    }

    for (const wid of widgetIds) {
      const w = configJson.widgets[wid]
      if (w.type === 'TEXT') continue
      const v = validateWidgetParams(w)
      if (!v.ok) { setErrorMsg(`Widget "${w.title || wid}": ${v.msg}`); return }
    }

    for (const wid of widgetIds) {
      const w = configJson.widgets[wid]
      if (w.type === 'CHART') {
        const xField = String(w.config?.xField || '').trim()
        const yField = String(w.config?.yField || '').trim()
        if (!xField || !yField) { setErrorMsg(`Chart "${w.title || wid}" must have xField and yField`); return }
      }
    }

    try {
      setLoading(true)
      await publishDashboard(selectedConfigId, { change_note: 'Published from Builder', config_json: configJson })
      setDirty(false)
      clearLocalDraft()
      await loadConfigs()
      setSuccessMsg('Published successfully. Open /dashboard to view.')
    } catch (e) {
      setErrorMsg(e.message || 'Publish failed')
    } finally {
      setLoading(false)
    }
  }

  const layoutForGrid = useMemo(() => configJson.layout || [], [configJson.layout])

  // Friendly param input renderer
  const renderParamInput = (paramSpec, value, onChange, currentWidgetParams) => {
    const key = String(paramSpec?.key || '')
    const required = Boolean(paramSpec?.required)

    if (key === 'location_code') {
      return (
        <select value={value || ''} onChange={(e) => onChange(e.target.value)}>
          <option value="">{required ? 'Select (required)' : 'Select (optional)'}</option>
          {activeLocations.map((l) => (
            <option key={l.id} value={l.locationCode}>
              {l.locationName} ({l.locationCode})
            </option>
          ))}
        </select>
      )
    }

    if (key === 'asset_type_code') {
      return (
        <select value={value || ''} onChange={(e) => onChange(e.target.value)}>
          <option value="">{required ? 'Select (required)' : 'Select (optional)'}</option>
          {availableAssetTypeCodesAtLocation.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>
      )
    }

    if (key === 'asset_code' || key === 'fso_asset_code') {
      const loc = currentWidgetParams?.location_code || dashFilters.location_code
      const type = currentWidgetParams?.asset_type_code || dashFilters.asset_type_code

      const candidates = activeAssets.filter((a) => {
        if (loc && String(a.locationCode || '') !== String(loc)) return false
        if (type && String(a.assetTypeCode || '') !== String(type)) return false
        return true
      })

      return (
        <select value={value || ''} onChange={(e) => onChange(e.target.value)}>
          <option value="">{required ? 'Select (required)' : 'Select (optional)'}</option>
          {candidates.map((a) => (
            <option key={a.id} value={a.assetCode}>
              {a.assetName} ({a.assetCode})
            </option>
          ))}
        </select>
      )
    }

    if (key === 'date_from' || key === 'date_to') {
      return <input type="date" value={value || ''} onChange={(e) => onChange(e.target.value)} />
    }

    if (key === 'limit') {
      return <input type="number" value={value || ''} onChange={(e) => onChange(e.target.value)} />
    }

    return <input value={value || ''} onChange={(e) => onChange(e.target.value)} />
  }

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
      {confirmRemoveWidget && (
        <div className="confirm-overlay">
          <div className="confirm-dialog">
            <p>Remove this widget?</p>
            <div className="confirm-actions">
              <button onClick={confirmRemoveWidgetAction}>Yes</button>
              <button onClick={() => setConfirmRemoveWidget(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
      <div className="page-title">
        <div>
          <h2>Dashboard Builder</h2>
          <p>Universal dashboard: any asset, any data source, user-friendly filters.</p>
        </div>
        <span className="record-count">{dirty ? 'Draft (unsaved)' : 'Saved'}</span>
      </div>

      {/* Universal Dashboard Filters */}
      <div className="info-box">
        <strong>Dashboard Filters (Auto-fill)</strong>
        <div className="create-2col-grid" style={{ marginTop: 10 }}>
          <div>
            <label>Location</label>
            <select
              value={dashFilters.location_code}
              onChange={(e) => setDashFilters((p) => ({ ...p, location_code: e.target.value, asset_code: '' }))}
            >
              <option value="">Select</option>
              {activeLocations.map((l) => (
                <option key={l.id} value={l.locationCode}>
                  {l.locationName} ({l.locationCode})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label>Asset Type</label>
            <select
              value={dashFilters.asset_type_code}
              onChange={(e) => setDashFilters((p) => ({ ...p, asset_type_code: e.target.value, asset_code: '' }))}
            >
              <option value="">Select</option>
              {availableAssetTypeCodesAtLocation.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label>Asset</label>
            <select
              value={dashFilters.asset_code}
              onChange={(e) => setDashFilters((p) => ({ ...p, asset_code: e.target.value }))}
            >
              <option value="">Select</option>
              {filteredAssetsForDash.map((a) => (
                <option key={a.id} value={a.assetCode}>
                  {a.assetName} ({a.assetCode})
                </option>
              ))}
            </select>
          </div>

          {availableOperationTypesAtLocation.length > 0 ? (
            <div>
              <label>Operation Type (optional)</label>
              <select
                value={dashFilters.operation_type_code}
                onChange={(e) =>
                  setDashFilters((p) => ({ ...p, operation_type_code: e.target.value }))
                }
                disabled={availableOperationTypesAtLocation.length === 0}
              >
                <option value="">Select</option>
                {availableOperationTypesAtLocation.map((o) => (
                  <option key={o.id || o.operationTypeCode} value={o.operationTypeCode}>
                    {o.operationTypeName} ({o.operationTypeCode})
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <div>
            <label>Date From</label>
            <input
              type="date"
              value={dashFilters.date_from}
              onChange={(e) => setDashFilters((p) => ({ ...p, date_from: e.target.value }))}
            />
          </div>

          <div>
            <label>Date To</label>
            <input
              type="date"
              value={dashFilters.date_to}
              onChange={(e) => setDashFilters((p) => ({ ...p, date_to: e.target.value }))}
            />
          </div>
        </div>

        <div style={{ marginTop: 8, fontSize: 12, opacity: 0.8 }}>
          Tip: Widgets auto-fill required parameters from these filters.
        </div>
      </div>

      {/* Config Meta */}
      <div className="info-box">
        <strong>Dashboard Config</strong>

        <div className="create-2col-grid" style={{ marginTop: 10 }}>
          <div>
            <label>Select Existing</label>
            <select value={selectedConfigId} onChange={(e) => setSelectedConfigId(e.target.value)}>
              <option value="">-- New / None --</option>
              {configs.map((c) => (
                <option key={c.id} value={c.id}>
                  [{c.scope_type}] {c.name} {c.location_code ? `(${c.location_code})` : ''} - {c.status}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label>Scope Type *</label>
            <select value={scopeType} onChange={(e) => setScopeType(e.target.value)}>
              <option value="GLOBAL">GLOBAL</option>
              <option value="LOCATION">LOCATION</option>
            </select>
          </div>

          <div>
            <label>Location (for LOCATION scope)</label>
            <select value={locationCode} onChange={(e) => setLocationCode(e.target.value)} disabled={scopeType !== 'LOCATION'}>
              <option value="">Select</option>
              {activeLocations.map((l) => (
                <option key={l.id} value={l.locationCode}>
                  {l.locationName} ({l.locationCode})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label>Name *</label>
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="full-width">
            <label>Remarks</label>
            <textarea rows="2" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </div>
        </div>

        <div className="form-actions" style={{ marginTop: 10 }}>
          {!selectedConfigId ? (
            <button type="button" onClick={createNewConfigHandler} disabled={loading}>
              {loading ? 'Working...' : 'Create Config'}
            </button>
          ) : (
            <>
              <button type="button" onClick={updateConfigMetaHandler} disabled={loading}>
                {loading ? 'Working...' : 'Update Info'}
              </button>
              <button type="button" onClick={publishHandler} disabled={loading}>
                {loading ? 'Publishing...' : 'Publish'}
              </button>
            </>
          )}

          <button type="button" onClick={saveDraftToLocalStorage} disabled={!dirty}>
            Save Draft Locally
          </button>
          <button type="button" onClick={clearLocalDraft}>
            Clear Local Draft
          </button>
        </div>
      </div>

      {/* Builder Layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr 360px', gap: 12, alignItems: 'start' }}>
        {/* Palette */}
        <div className="info-box">
          <strong>Widgets</strong>
          <div className="form-actions" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8, marginTop: 10 }}>
            <button type="button" onClick={() => addWidget('KPI')}>Add KPI</button>
            <button type="button" onClick={() => addWidget('TABLE')}>Add Table</button>
            <button type="button" onClick={() => addWidget('CHART')}>Add Chart</button>
            <button type="button" onClick={() => addWidget('TANK_VISUAL')}>Add Tank Visual</button>
            <button type="button" onClick={() => addWidget('TEXT')}>Add Text</button>
          </div>

          <div style={{ marginTop: 12, fontSize: 12, opacity: 0.8 }}>
            Data sources loaded: {sourcesLoading ? 'Loading...' : dataSources.length}
          </div>
        </div>

        {/* Canvas */}
        <div className="info-box">
          <strong>Layout</strong>
          <div style={{ marginTop: 10 }}>
            <ResponsiveGridLayout
              className="layout"
              layout={layoutForGrid}
              cols={DEFAULT_GRID_COLS}
              rowHeight={30}
              width={900}
              onLayoutChange={onLayoutChange}
              isDraggable={true}
              isResizable={true}
              compactType="vertical"
            >
              {Object.keys(configJson.widgets || {}).map((wid) => {
                const w = configJson.widgets[wid]
                const isSelected = wid === selectedWidgetId
                return (
                  <div
                    key={wid}
                    onClick={() => setSelectedWidgetId(wid)}
                    style={{
                      border: isSelected ? '2px solid #1976d2' : '1px solid #ccc',
                      borderRadius: 8,
                      padding: 8,
                      background: '#fff',
                      cursor: 'pointer',
                      overflow: 'hidden',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <strong style={{ fontSize: 12 }}>{w.title || wid}</strong>
                      <span style={{ fontSize: 11, opacity: 0.7 }}>{w.type}</span>
                    </div>

                    {w.type === 'TEXT' ? (
                      <div style={{ marginTop: 6, fontSize: 12, opacity: 0.9 }}>
                        {(w.config?.body || '').slice(0, 90)}
                        {(w.config?.body || '').length > 90 ? '…' : ''}
                      </div>
                    ) : (
                      <div style={{ marginTop: 6, fontSize: 12, opacity: 0.85 }}>
                        Source: {w.data?.data_source_code || '-'}
                      </div>
                    )}
                  </div>
                )
              })}
            </ResponsiveGridLayout>
          </div>
        </div>

        {/* Properties */}
        <div className="info-box">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
            <strong>Properties</strong>
            <button type="button" onClick={removeWidget} disabled={!selectedWidgetId}>
              Remove
            </button>
          </div>

          {!selectedWidget ? (
            <div style={{ marginTop: 10, fontSize: 13, opacity: 0.8 }}>Select a widget to edit.</div>
          ) : (
            <>
              <div style={{ marginTop: 10 }}>
                <label>Title</label>
                <input value={selectedWidget.title || ''} onChange={(e) => updateWidget({ title: e.target.value })} />
              </div>

              {selectedWidget.type === 'TEXT' ? (
                <div style={{ marginTop: 10 }}>
                  <label>Body</label>
                  <textarea
                    rows="8"
                    value={selectedWidget.config?.body || ''}
                    onChange={(e) => updateWidgetConfig({ body: e.target.value })}
                  />
                </div>
              ) : (
                <>
                  <div style={{ marginTop: 10 }}>
                    <label>Data Source *</label>
                    <select
                      value={selectedWidget.data?.data_source_code || ''}
                      onChange={(e) => updateWidgetData({ data_source_code: e.target.value, params: {} })}
                    >
                      <option value="">Select</option>
                      {dataSources.map((s) => {
                        const allowed = s.allowed_params_json?.allowed || []
                        const requiredKeys = new Set(
                          allowed.filter((a) => a.required).map((a) => a.key)
                        )

                        // Determine if this data source is valid for current location
                        let disabled = false
                        let reason = ''

                        if (selectedLoc) {
                          if (requiredKeys.has('fso_asset_code') && !hasFSOAtLocation) {
                            disabled = true
                            reason = 'No FSO assets in this location'
                          }
                          if (
                            requiredKeys.has('operation_type_code') &&
                            availableOperationTypesAtLocation.length === 0
                          ) {
                            disabled = true
                            reason = 'No operation types configured for this location'
                          }
                          if (
                            requiredKeys.has('asset_code') &&
                            availableAssetsAtLocation.length === 0
                          ) {
                            disabled = true
                            reason = 'No assets available in this location'
                          }
                        }

                        return (
                          <option
                            key={s.id}
                            value={s.data_source_code}
                            disabled={disabled}
                          >
                            {s.data_source_name}
                            {disabled ? ` — (${reason})` : ''}
                          </option>
                        )
                      })}
                    </select>
                  </div>

                  {/* Params */}
                  {selectedWidget.data?.data_source_code ? (
                    (() => {
                      const src = sourcesByCode[selectedWidget.data.data_source_code]
                      const { allowed } = normalizeAllowedParams(src?.allowed_params_json || {})
                      const params = selectedWidget.data.params || {}

                      return (
                        <div style={{ marginTop: 10 }}>
                          <label>Parameters</label>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                            {allowed.length === 0 ? (
                              <div style={{ fontSize: 12, opacity: 0.75 }}>No params required.</div>
                            ) : (
                              allowed.map((a) => (
                                <div key={a.key}>
                                  <div style={{ fontSize: 12, opacity: 0.85 }}>
                                    {a.key} {a.required ? '*' : ''} ({a.type})
                                  </div>
                                  {renderParamInput(a, params[a.key], (val) => updateWidgetParams(a.key, val), params)}
                                </div>
                              ))
                            )}
                          </div>

                          <div className="form-actions" style={{ marginTop: 10 }}>
                            <button type="button" onClick={() => applyDashboardFiltersToWidgetParams(selectedWidget)}>
                              Auto-fill from Dashboard Filters
                            </button>
                          </div>
                        </div>
                      )
                    })()
                  ) : null}

                  {/* KPI mapping */}
                  {selectedWidget.type === 'KPI' ? (
                    <div style={{ marginTop: 10 }}>
                      <label>KPI Mapping</label>
                      <div style={{ fontSize: 12, opacity: 0.8 }}>
                        valueFrom example: <code>meta.total_rows</code> or <code>meta.totals.total_receipt_bbl</code>
                      </div>
                      <input
                        value={selectedWidget.mapping?.valueFrom || ''}
                        onChange={(e) =>
                          updateWidget({ mapping: { ...(selectedWidget.mapping || {}), valueFrom: e.target.value } })
                        }
                      />
                    </div>
                  ) : null}

                  {/* CHART */}
                  {selectedWidget.type === 'CHART' ? (
                    <>
                      <div style={{ marginTop: 10 }}>
                        <label>Chart Type</label>
                        <select value={selectedWidget.config?.chartType || 'LINE'} onChange={(e) => updateWidgetConfig({ chartType: e.target.value })}>
                          <option value="LINE">LINE</option>
                          <option value="BAR">BAR</option>
                        </select>
                      </div>
                      <div style={{ marginTop: 10 }}>
                        <label>X Field</label>
                        <input value={selectedWidget.config?.xField || ''} onChange={(e) => updateWidgetConfig({ xField: e.target.value })} />
                      </div>
                      <div style={{ marginTop: 10 }}>
                        <label>Y Field</label>
                        <input value={selectedWidget.config?.yField || ''} onChange={(e) => updateWidgetConfig({ yField: e.target.value })} />
                      </div>
                    </>
                  ) : null}

                  {selectedWidget.type === 'TANK_VISUAL' ? (
                    <>
                      <div style={{ marginTop: 10 }}>
                        <label>Cards Per Row</label>
                        <input
                          type="number"
                          min="1"
                          max="8"
                          value={selectedWidget.config?.columns ?? 4}
                          onChange={(e) =>
                            updateWidgetConfig({ columns: Number(e.target.value || 4) })
                          }
                        />
                      </div>

                      <div style={{ marginTop: 10 }}>
                        <label>Card Height (px)</label>
                        <input
                          type="number"
                          min="160"
                          max="500"
                          value={selectedWidget.config?.cardHeight ?? 220}
                          onChange={(e) =>
                            updateWidgetConfig({ cardHeight: Number(e.target.value || 220) })
                          }
                        />
                      </div>

                      <div style={{ marginTop: 10, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <input
                            type="checkbox"
                            checked={Boolean(selectedWidget.config?.showPercent ?? true)}
                            onChange={(e) => updateWidgetConfig({ showPercent: e.target.checked })}
                          />
                          Show %
                        </label>

                        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <input
                            type="checkbox"
                            checked={Boolean(selectedWidget.config?.showStock ?? true)}
                            onChange={(e) => updateWidgetConfig({ showStock: e.target.checked })}
                          />
                          Show Stock
                        </label>

                        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <input
                            type="checkbox"
                            checked={Boolean(selectedWidget.config?.showEmpty ?? true)}
                            onChange={(e) => updateWidgetConfig({ showEmpty: e.target.checked })}
                          />
                          Show Empty
                        </label>

                        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <input
                            type="checkbox"
                            checked={Boolean(selectedWidget.config?.showCapacity ?? true)}
                            onChange={(e) => updateWidgetConfig({ showCapacity: e.target.checked })}
                          />
                          Show Capacity
                        </label>
                      </div>

                      <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                        <div>
                          <label>Low Threshold (%)</label>
                          <input
                            type="number"
                            min="0"
                            max="100"
                            value={selectedWidget.config?.thresholds?.low ?? 20}
                            onChange={(e) =>
                              updateWidgetConfig({
                                thresholds: {
                                  ...(selectedWidget.config?.thresholds || {}),
                                  low: Number(e.target.value || 0),
                                },
                              })
                            }
                          />
                        </div>

                        <div>
                          <label>High Threshold (%)</label>
                          <input
                            type="number"
                            min="0"
                            max="100"
                            value={selectedWidget.config?.thresholds?.high ?? 80}
                            onChange={(e) =>
                              updateWidgetConfig({
                                thresholds: {
                                  ...(selectedWidget.config?.thresholds || {}),
                                  high: Number(e.target.value || 0),
                                },
                              })
                            }
                          />
                        </div>
                      </div>

                      <div style={{ marginTop: 10 }}>
                        <label>Unit Label</label>
                        <input
                          value={selectedWidget.config?.unit ?? 'bbl'}
                          onChange={(e) => updateWidgetConfig({ unit: e.target.value })}
                        />
                      </div>
                    </>
                  ) : null}

                  <div className="form-actions" style={{ marginTop: 12 }}>
                    <button type="button" onClick={previewWidget} disabled={widgetPreview[selectedWidgetId]?.loading}>
                      {widgetPreview[selectedWidgetId]?.loading ? 'Previewing...' : 'Preview'}
                    </button>
                  </div>

                  {selectedWidgetId && widgetPreview[selectedWidgetId] ? (
                    <div style={{ marginTop: 10 }}>
                      <strong>Preview</strong>
                      {widgetPreview[selectedWidgetId].error ? (
                        <div style={{ color: 'red', marginTop: 6 }}>{widgetPreview[selectedWidgetId].error}</div>
                      ) : (
                        <>
                          <div style={{ fontSize: 12, opacity: 0.8, marginTop: 6 }}>
                            Rows: {(widgetPreview[selectedWidgetId].rows || []).length}
                          </div>

                          {selectedWidget.type === 'KPI' ? (
                            <div style={{ marginTop: 6, fontSize: 22, fontWeight: 800 }}>
                              {(() => {
                                const resp = widgetPreview[selectedWidgetId]
                                const val = pickValueFrom(resp, selectedWidget.mapping?.valueFrom)
                                return val == null ? '-' : String(val)
                              })()}
                            </div>
                          ) : null}

                          {selectedWidget.type === 'CHART' ? (
                            <div style={{ marginTop: 8, border: '1px solid #ddd' }}>
                              {renderEChartPreview({
                                chartType: selectedWidget.config?.chartType,
                                rows: widgetPreview[selectedWidgetId].rows || [],
                                xField: selectedWidget.config?.xField,
                                yField: selectedWidget.config?.yField,
                              })}
                            </div>
                          ) : null}
                        </>
                      )}
                    </div>
                  ) : null}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default DashboardBuilder
