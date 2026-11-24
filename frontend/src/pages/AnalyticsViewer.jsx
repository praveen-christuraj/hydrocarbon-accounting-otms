import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import PageHeader from '../components/common/PageHeader'
import AlertMessage from '../components/common/AlertMessage'
import AnalyticsVisual from '../components/analytics/AnalyticsVisual'
import { exportAnalyticsVisual, getMyAnalyticsDashboard, runAnalyticsDashboard } from '../api/analyticsApi'
import { usePermissions } from '../hooks/usePermissions'
import { usePrintDialog } from '../components/print/printProfileContext'
import { logUiAction } from '../utils/actionLogger'

const isoDate = (value) => value.toISOString().slice(0, 10)
const startOfMonth = () => { const now = new Date(); return isoDate(new Date(now.getFullYear(), now.getMonth(), 1)) }
const today = () => isoDate(new Date())

function AnalyticsViewer({ loggedInUser }) {
  const { dashboardId } = useParams()
  const { hasPermission } = usePermissions(loggedInUser)
  const { requestPrint } = usePrintDialog()
  const [dashboard, setDashboard] = useState(null)
  const [results, setResults] = useState({})
  const [locations, setLocations] = useState([])
  const [locationCodes, setLocationCodes] = useState([])
  const [slicerValues, setSlicerValues] = useState({})
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
  const layoutById = useMemo(
    () => new Map((dashboard?.definition?.layout || []).map((item) => [item.i, item])),
    [dashboard]
  )
  const orderedVisuals = useMemo(() => [...(dashboard?.definition?.visuals || [])].sort((left, right) => {
    const a = layoutById.get(left.id) || {}
    const b = layoutById.get(right.id) || {}
    return (Number(a.y) || 0) - (Number(b.y) || 0) || (Number(a.x) || 0) - (Number(b.x) || 0)
  }), [dashboard, layoutById])

  useEffect(() => {
    let cancelled = false
    getMyAnalyticsDashboard(dashboardId)
      .then((item) => {
        if (cancelled) return
        setDashboard(item)
        setLocations(item.available_locations || [])
        setSlicerValues(Object.fromEntries((item.definition?.slicers || []).map((slicer) => [slicer.key, ''])))
        if (item.scope_type === 'LOCATION' && item.location_code) setLocationCodes([item.location_code])
        else if ((item.available_locations || []).length === 1) setLocationCodes([item.available_locations[0].location_code])
      })
      .catch((loadError) => { if (!cancelled) setError(loadError.message || 'Unable to open this dashboard.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [dashboardId])

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
      const result = await runAnalyticsDashboard(dashboard.id, {
        date_from: dateFrom || null,
        date_to: dateTo || null,
        location_codes: locationCodes,
        runtime_values: slicerValues,
      })
      setResults(result.results || {})
      setSuccess(`Dashboard refreshed${result.dashboard?.version ? ` · version ${result.dashboard.version}` : ''}.`)
      logUiAction('Analytics', 'Run Dashboard', { dashboardId: dashboard.id, dateFrom, dateTo, locationCodes })
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
        {(dashboard.definition?.slicers || []).map((slicer) => (
          <label key={slicer.id || slicer.key}>{slicer.label}
            <input
              type="text"
              value={slicerValues[slicer.key] || ''}
              onChange={(event) => setSlicerValues((current) => ({ ...current, [slicer.key]: event.target.value }))}
              placeholder="Any value"
            />
          </label>
        ))}
        <button type="submit" className="btn-primary" disabled={running}>{running ? 'Refreshing…' : 'Apply filters'}</button>
      </form>
      {hasMaterialBalance && <AlertMessage tone="info" compact message="Material Balance visuals use the active location template and require exactly one location and a date range." />}
      <section className="analytics-visual-grid">
        {orderedVisuals.map((visual) => {
          const layout = layoutById.get(visual.id) || {}
          const width = Math.max(1, Math.min(Number(layout.w) || 12, 12))
          return (
            <div key={visual.id} className="analytics-viewer-grid-item" style={{ gridColumn: `span ${width}` }}>
              <AnalyticsVisual
                visual={visual}
                result={results[visual.id]}
                onExport={canExport ? (format) => exportVisual(visual, format) : null}
                busy={running}
              />
            </div>
          )
        })}
      </section>
      {!Object.keys(results).length && <div className="analytics-empty-state">Select the date and location filters, then apply them to run this dashboard.</div>}
    </div>
  )
}

export default AnalyticsViewer
