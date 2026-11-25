import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import AlertMessage from '../components/common/AlertMessage'
import ExportMenu from '../components/common/ExportMenu'
import Icon from '../components/common/Icon'
import Modal from '../components/common/Modal'
import { useToast } from '../components/common/Toast'
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
import { normalizeLayoutForGridStack } from '../utils/analyticsEngine'
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

  // Separate Date Range vs Single Date + Locations + Slicers + Cross-Filters
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [singleDate, setSingleDate] = useState('')
  const [activePreset, setActivePreset] = useState('')
  const [selectedLocations, setSelectedLocations] = useState([])
  const [runtimeValues, setRuntimeValues] = useState({})
  const [slicerOptions, setSlicerOptions] = useState({})
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

  const buildRunnerPayload = useCallback((overrides = {}) => {
    const locs = overrides.location_codes !== undefined ? overrides.location_codes : selectedLocations
    return {
      date_from: overrides.date_from !== undefined ? overrides.date_from : effectiveDateWindow.from,
      date_to: overrides.date_to !== undefined ? overrides.date_to : effectiveDateWindow.to,
      location_codes: Array.isArray(locs) ? locs : [],
      runtime_values: overrides.runtime_values ?? runtimeValues,
      selection_filters: overrides.selection_filters ?? selectionFiltersRef.current,
    }
  }, [effectiveDateWindow.from, effectiveDateWindow.to, runtimeValues, selectedLocations])

  const runBatch = useCallback(async (targetId, payload) => {
    setRunning(true)
    setError('')
    try {
      const response = await runAnalyticsDashboard(targetId, payload)
      setResults(response?.results || {})
      const nowStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      setLastExecutedAt(nowStr)
    } catch (err) {
      setError(err.message || 'Unable to execute analytics queries.')
    } finally {
      setRunning(false)
    }
  }, [])

  const fetchSlicerOptions = useCallback(async (targetId, defSlicers, locationCodes = []) => {
    const selectSlicers = (defSlicers || []).filter((s) => String(s.type || 'SELECT').toUpperCase() === 'SELECT')
    if (!selectSlicers.length) return {}
    const entries = await Promise.all(
      selectSlicers.map(async (slicer) => {
        const sKey = slicer.key || slicer.id
        try {
          const res = await getAnalyticsSlicerValues(targetId, {
            slicer_key: sKey,
            location_codes: Array.isArray(locationCodes) ? locationCodes : [],
          })
          return [sKey, res?.values || []]
        } catch {
          return [sKey, []]
        }
      })
    )
    return Object.fromEntries(entries)
  }, [])

  // Load dashboard definition, slicer options, and auto-execute queries immediately
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
        setSelectedLocations(initLocations)
        setSelectionFilters([])
        selectionFiltersRef.current = []
        setRuntimeValues({})
        setDateFrom('')
        setDateTo('')
        setSingleDate('')
        setActivePreset('')

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

        // Auto-execute initial batch run immediately
        const initialPayload = {
          date_from: null,
          date_to: null,
          location_codes: initLocations,
          runtime_values: {},
          selection_filters: [],
        }
        runBatch(item.id, initialPayload)

        // Load distinct options for SELECT slicers in parallel
        const defObj = item.definition || item.definition_json || {}
        const opts = await fetchSlicerOptions(item.id, defObj.slicers || [], initLocations)
        if (active) setSlicerOptions(opts)
      } catch (err) {
        if (active) setError(err.message || 'Unable to load analytics dashboard.')
      } finally {
        if (active) setLoading(false)
      }
    }
    loadDashboard()
    return () => { active = false }
  }, [dashboardId, fetchSlicerOptions, runBatch])

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
  const canEdit = canEditDefinition && (dashboard?.my_access === 'OWNER' || dashboard?.my_access === 'EDIT')

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
    setSelectedLocations(nextLocations)
    if (dashboard?.id && slicers.some((s) => String(s.type || 'SELECT').toUpperCase() === 'SELECT')) {
      fetchSlicerOptions(dashboard.id, slicers, nextLocations).then((opts) => setSlicerOptions(opts))
    }
  }

  const handleClearAllFilters = () => {
    const defaultLocs = dashboard?.location_code ? [dashboard.location_code] : []
    setDateFrom('')
    setDateTo('')
    setSingleDate('')
    setActivePreset('')
    setSelectedLocations(defaultLocs)
    setRuntimeValues({})
    selectionFiltersRef.current = []
    setSelectionFilters([])
    if (dashboard?.id) {
      runBatch(dashboard.id, {
        date_from: null,
        date_to: null,
        location_codes: defaultLocs,
        runtime_values: {},
        selection_filters: [],
      })
      if (slicers.some((s) => String(s.type || 'SELECT').toUpperCase() === 'SELECT')) {
        fetchSlicerOptions(dashboard.id, slicers, defaultLocs).then((opts) => setSlicerOptions(opts))
      }
    }
  }

  const handleInspectRecords = async (visual) => {
    if (!dashboard?.id || !visual?.id) return
    setRecordsModalVisual(visual)
    setRecordsLoading(true)
    setRecordsPayload(null)
    try {
      const data = await getAnalyticsVisualRecords(dashboard.id, visual.id, buildRunnerPayload())
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
      await exportAnalyticsVisual(dashboard.id, visual.id, buildRunnerPayload(), format)
      toast.success(`Exported "${visual.title}" (${format.toUpperCase()}).`)
    } catch (err) {
      toast.error(err.message || 'Unable to export visual.')
    }
  }

  const handleExportWorkbook = async () => {
    if (!dashboard?.id) return
    setExportingWorkbook(true)
    try {
      await exportAnalyticsWorkbook(dashboard.id, buildRunnerPayload())
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
      <div className="printable-report">
        <CompanyPrintHeader
          profile={profile}
          defaultSubtitle={[
            dashboardName,
            dashboard.location_code ? `Location: ${dashboard.location_code}` : 'All Scoped Locations',
            effectiveDateWindow.from || effectiveDateWindow.to
              ? `Period: ${effectiveDateWindow.from || 'Start'} to ${effectiveDateWindow.to || 'Latest'}`
              : 'Period: All Dates',
          ].join(' · ')}
        />
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
            onClick={() => requestPrint({ module: 'Analytics', reportName: dashboardName })}
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
            setSingleDate('')
            setActivePreset(presetKey)
            setDateFrom(range.from)
            setDateTo(range.to)
            runBatch(dashboard.id, buildRunnerPayload({ date_from: range.from, date_to: range.to }))
          }}
          availableLocations={availableLocations}
          selectedLocations={selectedLocations}
          onLocationsChange={handleLocationsChange}
          slicers={slicers}
          slicerOptions={slicerOptions}
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
          renderVisual={(visual, layoutItem) => {
            const activeSelForOthers = selectionFilters.find((sf) => sf.source_visual_id === visual.id) || selectionFilters[0] || null
            return (
              <AnalyticsVisual
                visual={visual}
                result={results[visual.id]}
                loading={running}
                editable={arrangeMode}
                isLocked={Boolean(layoutItem?.locked)}
                activeSelection={activeSelForOthers}
                onCrossFilter={(filterSpec) => handleToggleCrossFilter(visual.id, filterSpec)}
                onInspectRecords={handleInspectRecords}
                onExport={canExport ? handleExportVisual : null}
              />
            )
          }}
        />
      )}

      {/* Print Footer */}
      <div className="printable-report">
        <CompanyPrintFooter profile={profile} />
      </div>

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
          ) : (
            <AlertMessage tone="info" message="No underlying records available." />
          )}
        </div>
      </Modal>
    </div>
  )
}

export default AnalyticsViewer
