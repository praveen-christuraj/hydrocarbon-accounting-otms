import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import AlertMessage from '../components/common/AlertMessage'
import ExportMenu from '../components/common/ExportMenu'
import Icon from '../components/common/Icon'
import Modal from '../components/common/Modal'
import { useToast } from '../components/common/Toast'
import AnalyticsPrintCanvas from '../components/analytics/AnalyticsPrintCanvas'
import AnalyticsVisual from '../components/analytics/AnalyticsVisual'
import GridStackCanvas from '../components/analytics/GridStackCanvas'
import PerspectiveGrid from '../components/analytics/PerspectiveGrid'
import SlicerBar from '../components/analytics/SlicerBar'
import CompanyPrintHeader from '../components/reports/CompanyPrintHeader'
import CompanyPrintFooter from '../components/reports/CompanyPrintFooter'
import { useCompanyPrintProfile } from '../hooks/useCompanyPrintProfile'
import { usePrintDialog } from '../components/print/printProfileContext'
import usePermissions from '../hooks/usePermissions'
import {
  exportAnalyticsVisual,
  exportAnalyticsWorkbook,
  getAnalyticsSlicerValues,
  getAnalyticsVisualRecords,
  getMyAnalyticsDashboard,
  runAnalyticsDashboard,
} from '../api/analyticsApi'
import { logUiAction } from '../utils/actionLogger'
import { getPreviousDayIso, normalizeLayoutForGridStack } from '../utils/analyticsEngine'
import '../styles/analytics.css'

function getSessionLayoutKey(dashboardId) {
  return `otms_analytics_layout_v2_${dashboardId}`
}

function AnalyticsViewer({ loggedInUser }) {
  const { dashboardId } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const profile = useCompanyPrintProfile()
  const { requestPrint } = usePrintDialog()
  const { hasAny } = usePermissions(loggedInUser)

  const canEditDefinition = hasAny(['Edit Analytics Definition'])
  const canExport = hasAny(['Export Analytics Dashboard'])

  const [dashboard, setDashboard] = useState(null)
  const [availableLocations, setAvailableLocations] = useState([])
  const [results, setResults] = useState({})
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [exportingWorkbook, setExportingWorkbook] = useState(false)
  const [error, setError] = useState('')
  const [lastExecutedAt, setLastExecutedAt] = useState('')
  const [appliedPayload, setAppliedPayload] = useState(null)
  const appliedRunnerPayloadRef = useRef(null)
  // "Did the user pick locations?" — survives the server clamping an ALL request
  // to every granted code, so the toolbar label stays honest.
  const locationIntentRef = useRef('ALL')
  const [printMode, setPrintMode] = useState(false)

  // Separate Date Range vs Single Date + Locations + Slicers + Cross-Filters
  // Both default to the previous calendar day; data loads only when the user queries.
  const [dateFrom, setDateFrom] = useState(() => getPreviousDayIso())
  const [dateTo, setDateTo] = useState(() => getPreviousDayIso())
  const [singleDate, setSingleDate] = useState(() => getPreviousDayIso())
  const [activePreset, setActivePreset] = useState('')
  const [selectedLocations, setSelectedLocations] = useState([])
  const [runtimeValues, setRuntimeValues] = useState({})
  const [slicerOptions, setSlicerOptions] = useState({})
  const [slicerLoading, setSlicerLoading] = useState({})
  const slicerCacheSigRef = useRef({})
  const [selectionFilters, setSelectionFilters] = useState([])
  const selectionFiltersRef = useRef([])
  useEffect(() => { selectionFiltersRef.current = selectionFilters }, [selectionFilters])

  // Session GridStack Arrange Mode
  const [arrangeMode, setArrangeMode] = useState(false)
  const [sessionLayout, setSessionLayout] = useState(null)

  // Underlying Source Records Drill-Through Modal
  const [recordsModalVisual, setRecordsModalVisual] = useState(null)
  const [recordsLoading, setRecordsLoading] = useState(false)
  const [recordsPayload, setRecordsPayload] = useState(null)

  const effectiveDateWindow = useMemo(() => {
    if (singleDate) {
      return { from: singleDate, to: singleDate }
    }
    return { from: dateFrom || null, to: dateTo || null }
  }, [dateFrom, dateTo, singleDate])

  // A GLOBAL dashboard with no explicit selection means "every location in my
  // reporting scope" — say so explicitly rather than sending an empty list that
  // the backend has to guess about (the tank engine used to guess "nothing").
  const dashboardScopeMode = useCallback((locs) => (
    Array.isArray(locs) && locs.length ? 'SELECTED' : 'ALL'
  ), [])

  const buildRunnerPayload = useCallback((overrides = {}) => {
    const locs = overrides.location_codes !== undefined ? overrides.location_codes : selectedLocations
    const codes = Array.isArray(locs) ? locs : []
    if (codes.length) locationIntentRef.current = 'SELECTED'
    else if (overrides.location_codes !== undefined) locationIntentRef.current = 'ALL'
    return {
      date_from: overrides.date_from !== undefined ? overrides.date_from : effectiveDateWindow.from,
      date_to: overrides.date_to !== undefined ? overrides.date_to : effectiveDateWindow.to,
      location_codes: codes,
      scope_mode: overrides.scope_mode || dashboardScopeMode(codes),
      runtime_values: overrides.runtime_values ?? runtimeValues,
      selection_filters: overrides.selection_filters ?? selectionFiltersRef.current,
    }
  }, [effectiveDateWindow.from, effectiveDateWindow.to, runtimeValues, selectedLocations, dashboardScopeMode])

  const runBatch = useCallback(async (targetId, payload) => {
    setRunning(true)
    setError('')
    try {
      const response = await runAnalyticsDashboard(targetId, payload)
      setResults(response?.results || {})
      // Freeze the exact payload that produced these results. Drill-through,
      // exports and print must use this, never unsaved slicer state.
      const applied = {
        ...payload,
        location_codes: Array.isArray(payload.location_codes) ? [...payload.location_codes] : [],
        // Keep the intent captured when this payload was built; scope clamping in
        // the API (and the drill-through payload) never changes what was asked for.
        scope_mode: payload.scope_mode || locationIntentRef.current,
        runtime_values: { ...(payload.runtime_values || {}) },
        selection_filters: Array.isArray(payload.selection_filters)
          ? payload.selection_filters.map((item) => ({ ...item }))
          : [],
      }
      appliedRunnerPayloadRef.current = applied
      setAppliedPayload(applied)
      const nowStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      setLastExecutedAt(nowStr)
    } catch (err) {
      setError(err.message || 'Unable to execute analytics queries.')
    } finally {
      setRunning(false)
    }
  }, [])

  // Lazy-load distinct options for a SELECT slicer only when the user opens its dropdown.
  const handleSlicerOpen = useCallback(async (slicer) => {
    if (!dashboard?.id || !slicer) return
    const sKey = slicer.key || slicer.id
    if (!sKey) return
    const codes = Array.isArray(selectedLocations) ? selectedLocations : []
    const sig = `${dashboard.id}|${sKey}|${effectiveDateWindow.from || ''}|${effectiveDateWindow.to || ''}|${codes.join(',')}`
    if (slicerCacheSigRef.current[sKey] === sig) return
    setSlicerLoading((prev) => ({ ...prev, [sKey]: true }))
    try {
      const res = await getAnalyticsSlicerValues(dashboard.id, {
        slicer_key: sKey,
        date_from: effectiveDateWindow.from,
        date_to: effectiveDateWindow.to,
        location_codes: codes,
        scope_mode: dashboardScopeMode(codes),
      })
      slicerCacheSigRef.current[sKey] = sig
      setSlicerOptions((prev) => ({ ...prev, [sKey]: res?.values || [] }))
    } catch {
      setSlicerOptions((prev) => ({ ...prev, [sKey]: prev[sKey] || [] }))
    } finally {
      setSlicerLoading((prev) => ({ ...prev, [sKey]: false }))
    }
  }, [dashboard?.id, dashboardScopeMode, effectiveDateWindow.from, effectiveDateWindow.to, selectedLocations])

  // Load dashboard definition only (no automatic heavy data queries on initial page open).
  useEffect(() => {
    if (!dashboardId) {
      setLoading(false)
      setError('Invalid analytics dashboard link.')
      return undefined
    }
    let active = true
    const loadDashboard = async () => {
      setLoading(true)
      setError('')
      try {
        const item = await getMyAnalyticsDashboard(dashboardId)
        if (!active) return
        setDashboard(item)

        const locs = Array.isArray(item.available_locations) ? item.available_locations : []
        setAvailableLocations(locs)

        const initLocations = item.location_code ? [item.location_code] : []
        const prevDay = getPreviousDayIso()
        locationIntentRef.current = initLocations.length ? 'SELECTED' : 'ALL'
        setSelectedLocations(initLocations)
        setSelectionFilters([])
        selectionFiltersRef.current = []
        setRuntimeValues({})
        setDateFrom(prevDay)
        setDateTo(prevDay)
        setSingleDate(prevDay)
        setActivePreset('')
        setResults({})
        setLastExecutedAt('')
        setSlicerOptions({})
        setSlicerLoading({})
        slicerCacheSigRef.current = {}
        appliedRunnerPayloadRef.current = null
        setAppliedPayload(null)

        // Restore optional browser-session custom arrangement if valid
        try {
          const savedStr = window.localStorage.getItem(getSessionLayoutKey(item.id))
          if (savedStr) {
            const parsed = JSON.parse(savedStr)
            if (Array.isArray(parsed) && parsed.length) {
              setSessionLayout(parsed)
            } else {
              setSessionLayout(null)
            }
          } else {
            setSessionLayout(null)
          }
        } catch {
          setSessionLayout(null)
        }
      } catch (err) {
        if (active) setError(err.message || 'Unable to load analytics dashboard.')
      } finally {
        if (active) setLoading(false)
      }
    }
    loadDashboard()
    return () => { active = false }
  }, [dashboardId])

  const definition = useMemo(
    () => dashboard?.definition || dashboard?.definition_json || {},
    [dashboard]
  )
  const visuals = useMemo(() => definition.visuals || [], [definition])
  const slicers = useMemo(() => definition.slicers || [], [definition])

  const activeLayout = useMemo(
    () => normalizeLayoutForGridStack(sessionLayout || definition.layout || [], visuals),
    [definition.layout, sessionLayout, visuals]
  )

  const dashboardName = dashboard?.dashboard_name || dashboard?.name || 'Analytics Dashboard'
  const scopeLabel = dashboard?.scope_type || 'LOCATION'
  const locationLocked = String(scopeLabel).toUpperCase() === 'LOCATION'
  const canEdit = canEditDefinition && (dashboard?.my_access === 'OWNER' || dashboard?.my_access === 'EDIT')

  // Compare the live slicer state with the payload behind the visible results.
  // This prevents drill-through/export/print from silently using unapplied filters.
  const currentPayloadSignature = useMemo(() => JSON.stringify(buildRunnerPayload()), [buildRunnerPayload])
  const appliedPayloadSignature = useMemo(() => JSON.stringify(appliedPayload || {}), [appliedPayload])
  const pendingFilters = Boolean(appliedPayload) && currentPayloadSignature !== appliedPayloadSignature

  const appliedDateWindow = useMemo(() => {
    if (!appliedPayload) return effectiveDateWindow
    return { from: appliedPayload.date_from || null, to: appliedPayload.date_to || null }
  }, [appliedPayload, effectiveDateWindow])

  const appliedLocationLabel = useMemo(() => {
    if (locationLocked && dashboard?.location_code) return `Location: ${dashboard.location_code}`
    const codes = appliedPayload?.location_codes || []
    // An empty selection is an explicit "whole reporting scope" request
    // (scope_mode: ALL), never "nothing selected". A restricted user's scope is
    // clamped server-side, so trust the intent captured with the payload.
    if (String(appliedPayload?.scope_mode || '').toUpperCase() === 'ALL') return 'All Locations in Your Scope'
    if (!codes.length) return 'All Locations in Your Scope'
    return `Location${codes.length > 1 ? 's' : ''}: ${codes.slice(0, 3).join(', ')}${codes.length > 3 ? ` +${codes.length - 3}` : ''}`
  }, [appliedPayload, dashboard?.location_code, locationLocked])

  const getRunnerPayload = useCallback(
    () => appliedRunnerPayloadRef.current || buildRunnerPayload(),
    [buildRunnerPayload]
  )

  const handleToggleCrossFilter = useCallback((sourceVisualId, filterItem) => {
    const prev = selectionFiltersRef.current
    const exists = prev.some(
      (sf) => sf.column_key === filterItem.column_key && String(sf.value) === String(filterItem.value)
    )
    const next = exists
      ? prev.filter((sf) => !(sf.column_key === filterItem.column_key && String(sf.value) === String(filterItem.value)))
      : [
        ...prev.filter((sf) => sf.column_key !== filterItem.column_key),
        {
          source_visual_id: sourceVisualId,
          column_key: filterItem.column_key,
          operator: 'eq',
          value: filterItem.value,
          label: filterItem.label || `${filterItem.column_key}: ${filterItem.value}`,
        },
      ]
    selectionFiltersRef.current = next
    setSelectionFilters(next)
    if (dashboard?.id) {
      runBatch(dashboard.id, buildRunnerPayload({ selection_filters: next }))
    }
  }, [buildRunnerPayload, dashboard, runBatch])

  const handleRemoveSelectionFilter = useCallback((targetSf) => {
    const prev = selectionFiltersRef.current
    const next = prev.filter(
      (sf) => !(sf.column_key === targetSf.column_key && String(sf.value) === String(targetSf.value))
    )
    selectionFiltersRef.current = next
    setSelectionFilters(next)
    if (dashboard?.id) {
      runBatch(dashboard.id, buildRunnerPayload({ selection_filters: next }))
    }
  }, [buildRunnerPayload, dashboard, runBatch])

  const handleLocationsChange = (nextLocations) => {
    if (locationLocked) return
    const codes = Array.isArray(nextLocations) ? nextLocations : []
    locationIntentRef.current = codes.length ? 'SELECTED' : 'ALL'
    setSelectedLocations(codes)
  }

  const handleClearAllFilters = () => {
    const defaultLocs = dashboard?.location_code ? [dashboard.location_code] : []
    const prevDay = getPreviousDayIso()
    locationIntentRef.current = defaultLocs.length ? 'SELECTED' : 'ALL'
    setDateFrom(prevDay)
    setDateTo(prevDay)
    setSingleDate(prevDay)
    setActivePreset('')
    setSelectedLocations(defaultLocs)
    setRuntimeValues({})
    selectionFiltersRef.current = []
    setSelectionFilters([])
    setResults({})
    setLastExecutedAt('')
    setSlicerOptions({})
    setSlicerLoading({})
    slicerCacheSigRef.current = {}
    appliedRunnerPayloadRef.current = null
    setAppliedPayload(null)
  }

  const handleInspectRecords = async (visual) => {
    if (!dashboard?.id || !visual?.id) return
    setRecordsModalVisual(visual)
    setRecordsLoading(true)
    setRecordsPayload(null)
    try {
      const data = await getAnalyticsVisualRecords(dashboard.id, visual.id, getRunnerPayload())
      setRecordsPayload(data)
      logUiAction('Analytics', 'Inspect Visual Underlying Records', {
        dashboardId: dashboard.id,
        visualId: visual.id,
        visualTitle: visual.title,
      })
    } catch (err) {
      toast.error(err.message || 'Unable to load underlying source records.')
    } finally {
      setRecordsLoading(false)
    }
  }

  const handleExportVisual = async (visual, format = 'xlsx') => {
    if (!dashboard?.id) return
    try {
      await exportAnalyticsVisual(dashboard.id, visual.id, getRunnerPayload(), format)
      toast.success(`Exported "${visual.title}" (${format.toUpperCase()}).`)
    } catch (err) {
      toast.error(err.message || 'Unable to export visual.')
    }
  }

  const handleExportWorkbook = async () => {
    if (!dashboard?.id) return
    setExportingWorkbook(true)
    try {
      await exportAnalyticsWorkbook(dashboard.id, getRunnerPayload())
      logUiAction('Analytics', 'Export Dashboard Workbook', {
        dashboardId: dashboard.id,
        dashboardName,
      })
      toast.success('Exported multi-sheet Analytics Excel workbook.')
    } catch (err) {
      toast.error(err.message || 'Unable to export dashboard workbook.')
    } finally {
      setExportingWorkbook(false)
    }
  }

  const handleClearDrillThroughFilters = async () => {
    if (!dashboard?.id || !recordsModalVisual?.id) return
    const payload = { ...getRunnerPayload(), selection_filters: [] }
    selectionFiltersRef.current = []
    setSelectionFilters([])
    setRecordsLoading(true)
    try {
      const data = await getAnalyticsVisualRecords(dashboard.id, recordsModalVisual.id, payload)
      setRecordsPayload(data)
      runBatch(dashboard.id, payload)
    } catch (err) {
      toast.error(err.message || 'Unable to reload records.')
    } finally {
      setRecordsLoading(false)
    }
  }

  const handleSessionLayoutChange = (nextLayout) => {
    setSessionLayout(nextLayout)
    if (dashboard?.id) {
      try {
        window.localStorage.setItem(getSessionLayoutKey(dashboard.id), JSON.stringify(nextLayout))
      } catch {
        // Ignore storage quota
      }
    }
  }

  const resetSessionLayout = () => {
    setSessionLayout(null)
    if (dashboard?.id) {
      try {
        window.localStorage.removeItem(getSessionLayoutKey(dashboard.id))
      } catch {
        // Ignore
      }
    }
    toast.info('Restored canonical published layout.')
  }

  const renderVisualForCanvas = useCallback((visual, layoutItem, options = {}) => {
    const activeSelForOthers = selectionFilters.find((sf) => sf.source_visual_id === visual.id) || selectionFilters[0] || null
    return (
      <AnalyticsVisual
        visual={visual}
        result={results[visual.id]}
        loading={running}
        placeholderMessage="Apply filters above and click Apply & Refresh to load data."
        editable={arrangeMode && !options.printMode}
        isLocked={Boolean(layoutItem?.locked)}
        activeSelection={activeSelForOthers}
        onCrossFilter={options.printMode ? null : (filterSpec) => handleToggleCrossFilter(visual.id, filterSpec)}
        onInspectRecords={options.printMode ? null : handleInspectRecords}
        onExport={options.printMode ? null : (canExport ? handleExportVisual : null)}
        printMode={Boolean(options.printMode)}
      />
    )
  }, [arrangeMode, canExport, handleExportVisual, handleInspectRecords, handleToggleCrossFilter, results, running, selectionFilters])

  if (loading) {
    return (
      <div className="page-shell analytics-page">
        <div className="card">Loading executive analytics dashboard…</div>
      </div>
    )
  }

  if (!dashboard) {
    return (
      <div className="page-shell analytics-page">
        <AlertMessage tone="error" message={error || 'Analytics dashboard not found or access denied.'} />
      </div>
    )
  }

  return (
    <div className="page-shell analytics-page analytics-viewer-page">
      {/* Single printable surface: header + same visual arrangement + footer. */}
      <div className="printable-report analytics-print-report">
        <CompanyPrintHeader
          profile={profile}
          defaultSubtitle={[
            dashboardName,
            appliedLocationLabel,
            appliedDateWindow.from || appliedDateWindow.to
              ? `Period: ${appliedDateWindow.from || 'Start'} to ${appliedDateWindow.to || 'Latest'}`
              : 'Period: All Dates',
          ].join(' · ')}
        />
        {printMode && visuals.length > 0 && (
          <AnalyticsPrintCanvas
            visuals={visuals}
            results={results}
            layout={activeLayout}
            canvas={definition.canvas || {}}
            renderVisual={renderVisualForCanvas}
          />
        )}
        <CompanyPrintFooter profile={profile} />
      </div>

      <div className="page-header analytics-header no-print">
        <div>
          <p className="eyebrow">
            Analytics Dashboard · {scopeLabel} · v{dashboard.version}
          </p>
          <h1>{dashboardName}</h1>
          {dashboard.description && <p className="page-subtitle">{dashboard.description}</p>}
        </div>

        <div className="analytics-header-actions">
          <button
            type="button"
            className={`btn-secondary ${arrangeMode ? 'is-active-toggle' : ''}`}
            onClick={() => setArrangeMode((m) => !m)}
            title="Temporarily rearrange or resize visual cards in your browser session"
          >
            <Icon name="grid" size={15} /> {arrangeMode ? 'Lock Layout' : 'Arrange Layout'}
          </button>

          {sessionLayout && (
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={resetSessionLayout}
            >
              Reset Layout
            </button>
          )}

          {canExport && (
            <button
              type="button"
              className="btn-secondary"
              onClick={handleExportWorkbook}
              disabled={exportingWorkbook || !visuals.length}
            >
              <Icon name="fileSpreadsheet" size={15} />
              <span>{exportingWorkbook ? 'Exporting…' : 'Export Workbook'}</span>
            </button>
          )}

          <button
            type="button"
            className="btn-secondary"
            onClick={() => requestPrint({
              module: 'Analytics',
              reportName: dashboardName,
              onBeforePrint: async () => {
                setPrintMode(true)
                // Let the print canvas (and its charts) size before print().
                // The timer keeps a backgrounded tab from hanging the dialog.
                await new Promise((resolve) => {
                  let settled = false
                  const finish = () => {
                    if (settled) return
                    settled = true
                    resolve()
                  }
                  window.setTimeout(finish, 350)
                  window.requestAnimationFrame(() => window.requestAnimationFrame(finish))
                })
              },
              onAfterPrint: () => setPrintMode(false),
            })}
          >
            <Icon name="print" size={15} /> Print
          </button>

          {canEdit && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => navigate(`/analytics/builder/${dashboard.id}`)}
            >
              <Icon name="edit" size={15} /> Edit in Studio
            </button>
          )}

          <button
            type="button"
            className="btn-secondary"
            onClick={() => navigate('/analytics')}
          >
            Back
          </button>
        </div>
      </div>

      <div className="no-print">
        <SlicerBar
          dateFrom={dateFrom}
          dateTo={dateTo}
          singleDate={singleDate}
          activePreset={activePreset}
          onDateRangeChange={(from, to) => {
            setSingleDate('')
            setActivePreset('')
            setDateFrom(from)
            setDateTo(to)
          }}
          onSingleDateChange={(exact) => {
            setSingleDate(exact)
            if (exact) {
              setDateFrom('')
              setDateTo('')
              setActivePreset('')
            }
          }}
          onApplyPreset={(presetKey, range) => {
            setSingleDate(presetKey === 'PREV_DAY' ? range.from : '')
            setActivePreset(presetKey)
            setDateFrom(range.from)
            setDateTo(range.to)
          }}
          availableLocations={availableLocations}
          selectedLocations={selectedLocations}
          locationLocked={locationLocked}
          fixedLocationCode={dashboard.location_code || ''}
          pendingFilters={pendingFilters}
          hasQueried={Boolean(appliedPayload)}
          onLocationsChange={handleLocationsChange}
          slicers={slicers}
          slicerOptions={slicerOptions}
          slicerLoading={slicerLoading}
          onSlicerOpen={handleSlicerOpen}
          runtimeValues={runtimeValues}
          onRuntimeValueChange={(key, val) => setRuntimeValues((prev) => ({ ...prev, [key]: val }))}
          selectionFilters={selectionFilters}
          onRemoveSelectionFilter={handleRemoveSelectionFilter}
          onClearAllFilters={handleClearAllFilters}
          onApply={() => runBatch(dashboard.id, buildRunnerPayload())}
          running={running}
          lastExecutedAt={lastExecutedAt}
        />
      </div>

      {error && <AlertMessage tone="error" message={error} />}

      {visuals.length === 0 ? (
        <div className="card analytics-empty-canvas">
          <Icon name="barChart" size={28} />
          <h3>No visuals configured on this dashboard</h3>
          {canEdit && (
            <button type="button" className="btn-primary" onClick={() => navigate(`/analytics/builder/${dashboard.id}`)}>
              Configure Visuals in Studio
            </button>
          )}
        </div>
      ) : (
        <GridStackCanvas
          visuals={visuals}
          layout={activeLayout}
          editable={arrangeMode}
          floatMode={Boolean(definition.canvas?.floatMode)}
          cellHeight={Number(definition.canvas?.cellHeight) || 64}
          margin={Number(definition.canvas?.margin) || 14}
          onLayoutChange={arrangeMode ? handleSessionLayoutChange : null}
          renderVisual={renderVisualForCanvas}
        />
      )}

      {/* Underlying Source Records Modal */}
      <Modal
        open={Boolean(recordsModalVisual)}
        onClose={() => {
          setRecordsModalVisual(null)
          setRecordsPayload(null)
        }}
        title={recordsModalVisual ? `Underlying Records — ${recordsModalVisual.title}` : 'Underlying Source Records'}
        size="xl"
        footer={(
          <div className="analytics-modal-footer-bar">
            <div className="analytics-modal-footer-left">
              {selectionFilters.length > 0 && (
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={handleClearDrillThroughFilters}
                >
                  Clear drill-through filters <Icon name="close" size={13} />
                </button>
              )}
              {recordsPayload?.rows?.length > 0 && (
                <ExportMenu
                  label="Export Records"
                  title={`${recordsModalVisual?.title || 'Visual'} — Underlying Records`}
                  fileName="analytics_underlying_records"
                  columns={(recordsPayload.columns || []).map((c) => ({ key: c.key, label: c.label || c.key }))}
                  rows={recordsPayload.rows}
                />
              )}
              {recordsModalVisual?.query?.source?.kind === 'tank_stock_ledger' && (
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={() => navigate('/tank-stock-ledger')}
                >
                  Open Tank Stock Ledger <Icon name="externalLink" size={13} />
                </button>
              )}
              {recordsModalVisual?.query?.source?.kind === 'operation_tickets' && (
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={() => navigate('/operation-transactions')}
                >
                  Open Transactions Register <Icon name="externalLink" size={13} />
                </button>
              )}
            </div>
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                setRecordsModalVisual(null)
                setRecordsPayload(null)
              }}
            >
              Close
            </button>
          </div>
        )}
      >
        <div className="analytics-expanded-modal-body">
          {recordsLoading ? (
            <div className="analytics-visual-loading">Fetching ungrouped underlying source records…</div>
          ) : recordsPayload ? (
            <>
              {(recordsPayload.meta?.warnings || []).map((warning, idx) => (
                <AlertMessage key={`records-warning-${idx}`} tone="warning" compact message={warning} />
              ))}
              {recordsPayload.meta?.applied_filters?.length > 0 && (
                <div className="analytics-records-applied-filters">
                  Applied filters: {recordsPayload.meta.applied_filters.join(' · ')}
                </div>
              )}
              {!recordsPayload.rows?.length && recordsPayload.meta?.filter_breakdown && (
                <div className="analytics-records-applied-filters">
                  Candidates: {recordsPayload.meta.filter_breakdown.candidates ?? 0} · with stock evidence:{' '}
                  {recordsPayload.meta.filter_breakdown.with_stock_evidence ?? 0} · after type filter:{' '}
                  {recordsPayload.meta.filter_breakdown.after_type_filter ?? 0} · after slicers:{' '}
                  {recordsPayload.meta.filter_breakdown.after_slicer_filters ?? 0} · after fixed filters:{' '}
                  {recordsPayload.meta.filter_breakdown.after_fixed_filters ?? 0}
                </div>
              )}
              <PerspectiveGrid
                visual={{
                  id: `records_${recordsModalVisual?.id}`,
                  type: 'TABLE',
                  explorer: { showShelfByDefault: true },
                  style: { table: { dataBars: true, showSummaryBar: true, stickyHeader: true, striped: true } },
                }}
                columns={(recordsPayload.columns || []).filter((c) => !c.hidden)}
                rows={recordsPayload.rows || []}
                totals={recordsPayload.totals || {}}
                expanded
                shelfOpen
                containerWidth={1100}
              />
            </>
          ) : (
            <AlertMessage tone="info" message="No underlying records available." />
          )}
        </div>
      </Modal>
    </div>
  )
}

export default AnalyticsViewer
