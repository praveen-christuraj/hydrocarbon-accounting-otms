import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Responsive, WidthProvider } from 'react-grid-layout'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'
import PageHeader from '../components/common/PageHeader'
import AlertMessage from '../components/common/AlertMessage'
import AnalyticsVisual from '../components/analytics/AnalyticsVisual'
import { exportAnalyticsVisual, getAnalyticsSlicerValues, getMyAnalyticsDashboard, runAnalyticsDashboard } from '../api/analyticsApi'
import { usePermissions } from '../hooks/usePermissions'
import { usePrintDialog } from '../components/print/printProfileContext'
import { logUiAction } from '../utils/actionLogger'

const ResponsiveGridLayout = WidthProvider(Responsive)
const isoDate = (value) => value.toISOString().slice(0, 10)
const startOfMonth = () => { const now = new Date(); return isoDate(new Date(now.getFullYear(), now.getMonth(), 1)) }
const today = () => isoDate(new Date())

const normalizeLayouts = (layout, visuals) => {
  const visualIds = (visuals || []).map((v) => v.id)
  if (layout && !Array.isArray(layout) && typeof layout === 'object') {
    const out = {}
    for (const bp of ['lg', 'md', 'sm', 'xs']) {
      const items = Array.isArray(layout[bp]) ? layout[bp] : []
      out[bp] = items.filter((item) => visualIds.includes(item.i))
    }
    return out
  }
  const base = Array.isArray(layout) ? layout.filter((item) => visualIds.includes(item.i)) : []
  const ensure = (items, cols) => {
    const seen = new Set(items.map((i) => i.i))
    const filled = [...items.map((item) => ({ ...item, w: Math.min(cols, Math.max(1, Number(item.w) || cols)), x: Math.max(0, Math.min(cols - Math.min(cols, Math.max(1, Number(item.w) || cols)), Number(item.x) || 0)), h: Math.max(2, Number(item.h) || 6) }))]
    visuals.forEach((visual, index) => {
      if (seen.has(visual.id)) return
      filled.push({ i: visual.id, x: 0, y: 1000 + index * 6, w: cols, h: 6 })
    })
    return filled
  }
  return {
    lg: ensure(base, 12),
    md: ensure(base.map((i) => ({ ...i, w: Math.min(10, i.w || 10) })), 10),
    sm: ensure(base.map((i) => ({ ...i, w: Math.min(6, i.w || 6), x: 0 })), 6),
    xs: ensure(base.map((i) => ({ ...i, w: 2, x: 0 })), 2),
  }
}

function SlicerControl({ slicer, value, onChange, options, loading }) {
  const type = String(slicer?.type || 'SELECT').toUpperCase()
  const label = slicer?.label || slicer?.key
  if (type === 'DATE_RANGE') {
    const range = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
    return (
      <div className="analytics-slicer-control analytics-slicer-range">
        <span className="analytics-slicer-label">{label}</span>
        <div className="analytics-slicer-range-inputs">
          <input type="date" aria-label={`${label} from`} value={range.from || ''} onChange={(e) => onChange({ ...range, from: e.target.value })} />
          <input type="date" aria-label={`${label} to`} value={range.to || ''} onChange={(e) => onChange({ ...range, to: e.target.value })} />
        </div>
      </div>
    )
  }
  if (type === 'DATE') {
    return <label className="analytics-slicer-control"><span className="analytics-slicer-label">{label}</span><input type="date" value={value || ''} onChange={(e) => onChange(e.target.value)} /></label>
  }
  if (type === 'NUMBER_RANGE') {
    const range = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
    return (
      <div className="analytics-slicer-control analytics-slicer-range">
        <span className="analytics-slicer-label">{label}</span>
        <div className="analytics-slicer-range-inputs">
          <input type="number" placeholder="Min" aria-label={`${label} min`} value={range.min ?? ''} onChange={(e) => onChange({ ...range, min: e.target.value })} />
          <input type="number" placeholder="Max" aria-label={`${label} max`} value={range.max ?? ''} onChange={(e) => onChange({ ...range, max: e.target.value })} />
        </div>
      </div>
    )
  }
  if (type === 'NUMBER') {
    return <label className="analytics-slicer-control"><span className="analytics-slicer-label">{label}</span><input type="number" value={value ?? ''} onChange={(e) => onChange(e.target.value)} placeholder="Any value" /></label>
  }
  if (type === 'TEXT') {
    return <label className="analytics-slicer-control"><span className="analytics-slicer-label">{label}</span><input type="text" value={value || ''} onChange={(e) => onChange(e.target.value)} placeholder={slicer?.config?.placeholder || 'Contains...'} /></label>
  }

  // SELECT
  const multi = slicer?.config?.multi !== false
  const selected = Array.isArray(value) ? value.map(String) : (value ? [String(value)] : [])
  return (
    <label className="analytics-slicer-control">
      <span className="analytics-slicer-label">{label}{loading ? ' …' : ''}</span>
      <select
        multiple={multi}
        value={multi ? selected : (selected[0] || '')}
        onChange={(e) => {
          if (multi) {
            const next = Array.from(e.target.selectedOptions).map((opt) => opt.value)
            onChange(next)
          } else {
            onChange(e.target.value)
          }
        }}
        size={multi ? Math.min(6, Math.max(3, (options?.length || 0) + 1)) : undefined}
      >
        {!multi && <option value="">All</option>}
        {(options || []).map((opt) => <option key={String(opt.value)} value={String(opt.value)}>{opt.label ?? String(opt.value)}</option>)}
      </select>
    </label>
  )
}

function AnalyticsViewer({ loggedInUser }) {
  const { dashboardId } = useParams()
  const { hasPermission } = usePermissions(loggedInUser)
  const { requestPrint } = usePrintDialog()
  const [dashboard, setDashboard] = useState(null)
  const [results, setResults] = useState({})
  const [locations, setLocations] = useState([])
  const [locationCodes, setLocationCodes] = useState([])
  const [slicerValues, setSlicerValues] = useState({})
  const [slicerOptions, setSlicerOptions] = useState({})
  const [slicerLoading, setSlicerLoading] = useState({})
  const [dateFrom, setDateFrom] = useState(startOfMonth)
  const [dateTo, setDateTo] = useState(today)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const canEdit = hasPermission('Edit Analytics Definition')
  const canExport = hasPermission('Export Analytics Dashboard')

  const hasMaterialBalance = useMemo(
    () => (dashboard?.definition?.visuals || []).some((visual) => visual.query?.source?.kind === 'material_balance'),
    [dashboard]
  )
  const visuals = useMemo(() => dashboard?.definition?.visuals || [], [dashboard])
  const layouts = useMemo(() => normalizeLayouts(dashboard?.definition?.layout, visuals), [dashboard, visuals])

  useEffect(() => {
    let cancelled = false
    getMyAnalyticsDashboard(dashboardId)
      .then((item) => {
        if (cancelled) return
        setDashboard(item)
        setLocations(item.available_locations || [])
        const nextSlicerValues = {}
        for (const slicer of (item.definition?.slicers || [])) {
          const type = String(slicer.type || 'SELECT').toUpperCase()
          if (type === 'DATE_RANGE' || type === 'NUMBER_RANGE') nextSlicerValues[slicer.key] = slicer.default && typeof slicer.default === 'object' ? slicer.default : {}
          else if (type === 'SELECT' && slicer.config?.multi !== false) nextSlicerValues[slicer.key] = Array.isArray(slicer.default) ? slicer.default : []
          else nextSlicerValues[slicer.key] = slicer.default ?? ''
        }
        setSlicerValues(nextSlicerValues)
        if (item.scope_type === 'LOCATION' && item.location_code) setLocationCodes([item.location_code])
        else if ((item.available_locations || []).length === 1) setLocationCodes([item.available_locations[0].location_code])
      })
      .catch((loadError) => { if (!cancelled) setError(loadError.message || 'Unable to open this dashboard.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [dashboardId])

  const loadSlicerOptions = useCallback(async (dash, currentFilters) => {
    if (!dash) return
    const selectSlicers = (dash.definition?.slicers || []).filter((s) => String(s.type || 'SELECT').toUpperCase() === 'SELECT')
    if (!selectSlicers.length) return
    setSlicerLoading((prev) => ({ ...prev, ...Object.fromEntries(selectSlicers.map((s) => [s.key, true])) }))
    await Promise.all(selectSlicers.map(async (slicer) => {
      try {
        const res = await getAnalyticsSlicerValues(dash.id, {
          slicer_key: slicer.key,
          date_from: currentFilters.dateFrom || null,
          date_to: currentFilters.dateTo || null,
          location_codes: currentFilters.locationCodes || [],
          runtime_values: currentFilters.slicerValues || {},
        })
        setSlicerOptions((prev) => ({ ...prev, [slicer.key]: res.values || [] }))
      } catch {
        setSlicerOptions((prev) => ({ ...prev, [slicer.key]: prev[slicer.key] || [] }))
      } finally {
        setSlicerLoading((prev) => ({ ...prev, [slicer.key]: false }))
      }
    }))
  }, [])

  useEffect(() => {
    if (!dashboard) return
    loadSlicerOptions(dashboard, { dateFrom, dateTo, locationCodes, slicerValues: {} })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashboard?.id])

  const run = async (event) => {
    event?.preventDefault()
    if (!dashboard) return
    if (dateFrom && dateTo && dateFrom > dateTo) {
      setError('Date From cannot be after Date To.')
      return
    }
    if (hasMaterialBalance && (!dateFrom || !dateTo || locationCodes.length !== 1)) {
      setError('Material Balance visuals require a date range and exactly one selected location.')
      return
    }
    setRunning(true)
    setError('')
    setSuccess('')
    try {
      const payload = {
        date_from: dateFrom || null,
        date_to: dateTo || null,
        location_codes: locationCodes,
        runtime_values: slicerValues,
      }
      const result = await runAnalyticsDashboard(dashboard.id, payload)
      setResults(result.results || {})
      setSuccess(`Dashboard refreshed${result.dashboard?.version ? ` · version ${result.dashboard.version}` : ''}.`)
      logUiAction('Analytics', 'Run Dashboard', { dashboardId: dashboard.id, dateFrom, dateTo, locationCodes })
      loadSlicerOptions(dashboard, { dateFrom, dateTo, locationCodes, slicerValues })
    } catch (runError) {
      setError(runError.message || 'Dashboard run failed.')
    } finally {
      setRunning(false)
    }
  }

  const exportVisual = async (visual, format) => {
    if (!canExport) return
    setRunning(true)
    try {
      await exportAnalyticsVisual(dashboard.id, visual.id, {
        date_from: dateFrom || null,
        date_to: dateTo || null,
        location_codes: locationCodes,
        runtime_values: slicerValues,
      }, format)
      logUiAction('Analytics', 'Export Visual', { dashboardId: dashboard.id, visualId: visual.id, format })
    } catch (exportError) {
      setError(exportError.message || 'Unable to export this visual.')
    } finally {
      setRunning(false)
    }
  }

  const print = () => {
    requestPrint({
      module: 'Analytics',
      reportName: dashboard?.dashboard_name || 'Analytics Dashboard',
      onBeforePrint: () => logUiAction('Analytics', 'Print Dashboard', { dashboardId: dashboard?.id }),
    })
  }

  const slicerControls = (dashboard?.definition?.slicers || []).map((slicer) => (
    <SlicerControl
      key={slicer.id || slicer.key}
      slicer={slicer}
      value={slicerValues[slicer.key]}
      options={slicerOptions[slicer.key] || []}
      loading={Boolean(slicerLoading[slicer.key])}
      onChange={(value) => setSlicerValues((current) => ({ ...current, [slicer.key]: value }))}
    />
  ))

  const expandedControls = (
    <div className="analytics-expand-filters">
      <div className="analytics-filter-bar">
        <label>Date from<input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label>
        <label>Date to<input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label>
        {dashboard?.scope_type !== 'LOCATION' && (
          <label>Location
            <select value={locationCodes[0] || ''} onChange={(event) => setLocationCodes(event.target.value ? [event.target.value] : [])}>
              <option value="">All locations in my reporting scope</option>
              {locations.map((location) => <option key={location.location_code} value={location.location_code}>{location.location_name} ({location.location_code})</option>)}
            </select>
          </label>
        )}
        {slicerControls}
        <button type="button" className="btn-primary" onClick={run} disabled={running}>{running ? 'Refreshing…' : 'Apply filters'}</button>
      </div>
    </div>
  )

  if (loading) return <div className="page-container"><p>Loading dashboard…</p></div>
  if (!dashboard) return <div className="page-container"><PageHeader title="Analytics Dashboard" /><AlertMessage tone="error" message={error || 'Dashboard not found.'} /><Link to="/analytics">Back to Analytics</Link></div>

  return (
    <div className="page-container analytics-page analytics-viewer">
      <PageHeader
        title={dashboard.dashboard_name}
        description={dashboard.description || `Version ${dashboard.version} · ${dashboard.scope_type === 'LOCATION' ? dashboard.location_code : 'Global'}`}
        actions={<div className="analytics-header-actions"><Link className="btn-secondary" to="/analytics">All dashboards</Link>{canEdit && dashboard.my_access !== 'VIEW' && <Link className="btn-secondary" to={`/analytics/builder/${dashboard.id}`}>Edit dashboard</Link>}<button type="button" className="btn-secondary" onClick={print}>Print</button></div>}
      />
      <AlertMessage tone="error" message={error} onDismiss={() => setError('')} />
      <AlertMessage tone="success" message={success} onDismiss={() => setSuccess('')} />
      <form className="analytics-filter-bar" onSubmit={run}>
        <label>Date from<input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label>
        <label>Date to<input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label>
        {dashboard.scope_type === 'LOCATION' ? (
          <label>Location<input value={`${dashboard.location_code || ''}`} readOnly /></label>
        ) : (
          <label>Location
            <select value={locationCodes[0] || ''} onChange={(event) => setLocationCodes(event.target.value ? [event.target.value] : [])}>
              <option value="">All locations in my reporting scope</option>
              {locations.map((location) => <option key={location.location_code} value={location.location_code}>{location.location_name} ({location.location_code})</option>)}
            </select>
          </label>
        )}
        {slicerControls}
        <button type="submit" className="btn-primary" disabled={running}>{running ? 'Refreshing…' : 'Apply filters'}</button>
      </form>
      {hasMaterialBalance && <AlertMessage tone="info" compact message="Material Balance visuals use the active location template and require exactly one location and a date range." />}
      <section className="analytics-viewer-canvas" aria-label="Dashboard visuals">
        <ResponsiveGridLayout
          className="analytics-grid-layout analytics-grid-layout-viewer"
          layouts={layouts}
          breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480 }}
          cols={{ lg: 12, md: 10, sm: 6, xs: 2 }}
          rowHeight={56}
          isDraggable={false}
          isResizable={false}
          compactType="vertical"
          margin={[16, 16]}
          measureBeforeMount
        >
          {visuals.map((visual) => (
            <div key={visual.id} className="analytics-viewer-grid-item">
              <AnalyticsVisual
                visual={visual}
                result={results[visual.id]}
                onExport={canExport ? (format) => exportVisual(visual, format) : null}
                busy={running}
                expandedControls={expandedControls}
              />
            </div>
          ))}
        </ResponsiveGridLayout>
      </section>
      {!Object.keys(results).length && <div className="analytics-empty-state">Select the date and location filters, then apply them to run this dashboard.</div>}
    </div>
  )
}

export default AnalyticsViewer
