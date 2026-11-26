import { useEffect, useMemo, useRef, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import AlertMessage from '../common/AlertMessage'
import ExportMenu from '../common/ExportMenu'
import Icon from '../common/Icon'
import Modal from '../common/Modal'
import EChartsRenderer from './EChartsRenderer'
import PerspectiveGrid from './PerspectiveGrid'
import PlotlyRenderer from './PlotlyRenderer'
import TankVisualRenderer from './TankVisualRenderer'
import {
  ECHARTS_VISUAL_TYPES,
  PERSPECTIVE_VISUAL_TYPES,
  PLOTLY_VISUAL_TYPES,
  RUNTIME_SWITCHABLE_TYPES,
  formatMetricValue,
  getVisualMeta,
} from '../../utils/analyticsEngine'

function KpiCardRenderer({ visual, columns = [], rows = [], totals = {}, onInspectRecords }) {
  const kpiStyle = useMemo(() => visual?.style?.kpi || {}, [visual?.style?.kpi])
  const metricKey = visual?.query?.metric_key || visual?.query?.measure_key || columns.find((c) => c.data_type === 'number')?.key || columns[0]?.key
  const metricColumn = columns.find((c) => c.key === metricKey) || columns[0]

  const headlineValue = useMemo(() => {
    if (metricColumn && Object.prototype.hasOwnProperty.call(totals || {}, metricColumn.key)) {
      return totals[metricColumn.key]
    }
    if (rows.length === 1 && metricColumn) {
      return rows[0]?.[metricColumn.key]
    }
    if (rows.length > 1 && metricColumn?.data_type === 'number') {
      return rows.reduce((acc, r) => acc + (Number(r?.[metricColumn.key]) || 0), 0)
    }
    return rows[0]?.[metricColumn?.key] ?? 0
  }, [metricColumn, rows, totals])

  const seriesPoints = useMemo(() => {
    if (!metricColumn || rows.length < 2) return []
    return rows
      .slice(-24)
      .map((r) => Number(r?.[metricColumn.key]))
      .filter((n) => Number.isFinite(n))
  }, [metricColumn, rows])

  const numHeadline = Number(headlineValue)
  const targetVal = kpiStyle.targetValue != null && kpiStyle.targetValue !== '' ? Number(kpiStyle.targetValue) : null

  const deltaInfo = useMemo(() => {
    if (kpiStyle.showDelta === false) return null
    if (targetVal !== null && Number.isFinite(targetVal) && Math.abs(targetVal) > 1e-9 && Number.isFinite(numHeadline)) {
      const pct = ((numHeadline - targetVal) / Math.abs(targetVal)) * 100
      return {
        pct,
        label: `vs target ${formatMetricValue(targetVal, metricColumn, kpiStyle)}`,
      }
    }
    if (seriesPoints.length >= 2) {
      const first = seriesPoints[0]
      const last = seriesPoints[seriesPoints.length - 1]
      if (Math.abs(first) > 1e-9) {
        const pct = ((last - first) / Math.abs(first)) * 100
        return { pct, label: 'period trend' }
      }
    }
    return null
  }, [kpiStyle, metricColumn, numHeadline, seriesPoints, targetVal])

  const progressPct = targetVal && targetVal > 0 && Number.isFinite(numHeadline)
    ? Math.max(0, Math.min(100, (numHeadline / targetVal) * 100))
    : null

  const sparkOption = useMemo(() => {
    if (kpiStyle.showSparkline === false || seriesPoints.length < 2) return null
    const isUp = seriesPoints[seriesPoints.length - 1] >= seriesPoints[0]
    const lineCol = isUp ? '#2f63b3' : '#b36b00'
    return {
      animation: false,
      grid: { left: 2, right: 2, top: 4, bottom: 2 },
      xAxis: { type: 'category', show: false, data: seriesPoints.map((_, i) => i) },
      yAxis: { type: 'value', show: false, min: 'dataMin', max: 'dataMax' },
      series: [{
        type: 'line',
        data: seriesPoints,
        smooth: true,
        showSymbol: false,
        lineStyle: { width: 2, color: lineCol },
        areaStyle: { color: lineCol, opacity: 0.14 },
      }],
    }
  }, [kpiStyle.showSparkline, seriesPoints])

  const formattedHeadline = formatMetricValue(headlineValue, metricColumn, kpiStyle)

  return (
    <div
      className={`analytics-kpi-card ${onInspectRecords ? 'is-clickable' : ''}`}
      onClick={() => onInspectRecords && onInspectRecords(visual)}
    >
      <div className="analytics-kpi-top">
        <div className="analytics-kpi-value" title={String(formattedHeadline)}>
          {formattedHeadline}
        </div>
        {deltaInfo && Number.isFinite(deltaInfo.pct) && (
          <span className={`analytics-kpi-delta ${deltaInfo.pct >= 0 ? 'is-pos' : 'is-neg'}`}>
            {deltaInfo.pct >= 0 ? '▲' : '▼'} {Math.abs(deltaInfo.pct).toFixed(1)}%
            <small>{deltaInfo.label}</small>
          </span>
        )}
      </div>

      <div className="analytics-kpi-subrow">
        <span className="analytics-kpi-caption">
          {kpiStyle.comparisonLabel || metricColumn?.label || 'Aggregated Metric'}
        </span>
        {rows.length > 0 && (
          <span className="analytics-kpi-sample">{rows.length.toLocaleString()} {rows.length === 1 ? 'group' : 'groups'}</span>
        )}
      </div>

      {progressPct !== null && (
        <div className="analytics-kpi-progress" title={`${progressPct.toFixed(1)}% of target`}>
          <div className="analytics-kpi-progress-bar" style={{ width: `${progressPct}%` }} />
        </div>
      )}

      {sparkOption && (
        <div className="analytics-kpi-sparkline" aria-hidden="true">
          <ReactECharts
            option={sparkOption}
            notMerge
            lazyUpdate
            style={{ width: '100%', height: 42 }}
            opts={{ renderer: 'canvas' }}
          />
        </div>
      )}
    </div>
  )
}

function AnalyticsVisual({
  visual,
  result,
  loading = false,
  editable = false,
  isLocked = false,
  activeSelection = null,
  onCrossFilter = null,
  onInspectRecords = null,
  onExport = null,
  onEditVisual = null,
  onDuplicateVisual = null,
  onDeleteVisual = null,
  onToggleLock = null,
  onExplorerChange = null,
  printMode = false,
}) {
  const [expanded, setExpanded] = useState(false)
  const [viewOverridesByKey, setViewOverridesByKey] = useState({})
  const [shelfTogglesByKey, setShelfTogglesByKey] = useState({})
  const bodyRef = useRef(null)
  const [bodyRect, setBodyRect] = useState({ width: 640, height: 280 })

  const savedType = String(visual?.type || 'TABLE').toUpperCase()
  const visualStateKey = `${visual?.id || 'vis'}:${savedType}`
  const viewOverride = viewOverridesByKey[visualStateKey] || ''
  const shelfOpen = shelfTogglesByKey[visualStateKey] !== undefined
    ? shelfTogglesByKey[visualStateKey]
    : Boolean(visual?.explorer?.showShelfByDefault)
  const effectiveType = (viewOverride || savedType).toUpperCase()
  const visualMeta = getVisualMeta(effectiveType)

  const rowCount = Array.isArray(result?.rows) ? result.rows.length : null
  const totalRows = result?.meta?.total_rows != null ? Number(result.meta.total_rows) : null
  const warnings = [
    ...(Array.isArray(result?.meta?.warnings) ? result.meta.warnings : []),
    ...(result?.error ? [String(result.error)] : []),
  ].filter(Boolean)

  const setViewOverride = (val) => {
    setViewOverridesByKey((prev) => ({ ...prev, [visualStateKey]: val }))
  }
  const setShelfOpen = (updater) => {
    const nextVal = typeof updater === 'function' ? updater(shelfOpen) : Boolean(updater)
    setShelfTogglesByKey((prev) => ({ ...prev, [visualStateKey]: nextVal }))
  }

  useEffect(() => {
    const el = bodyRef.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const updateSize = () => {
      if (!bodyRef.current) return
      setBodyRect({
        width: Math.max(180, Math.floor(bodyRef.current.clientWidth)),
        height: Math.max(120, Math.floor(bodyRef.current.clientHeight)),
      })
    }
    updateSize()
    const observer = new ResizeObserver(updateSize)
    observer.observe(el)
    return () => observer.disconnect()
  }, [result, loading, effectiveType, shelfOpen])

  const columns = useMemo(
    () => (result?.columns || []).filter((c) => !c.hidden),
    [result]
  )
  const allColumns = useMemo(
    () => result?.columns || [],
    [result]
  )
  const rows = useMemo(() => result?.rows || [], [result])
  const totals = useMemo(() => result?.totals || {}, [result])

  const isPerspective = PERSPECTIVE_VISUAL_TYPES.has(effectiveType)
  const isECharts = ECHARTS_VISUAL_TYPES.has(effectiveType)
  const isPlotly = PLOTLY_VISUAL_TYPES.has(effectiveType)
  const canSwitchRuntimeView = savedType !== 'TEXT' && savedType !== 'KPI_CARD' && visual?.explorer?.allowViewSwitch !== false

  const renderContent = (isModal = false) => {
    if (effectiveType === 'TEXT') {
      return (
        <div className="analytics-text-visual">
          {visual?.text || visual?.description || 'Add narrative commentary or operating notes in Studio.'}
        </div>
      )
    }

    if (loading && !result) {
      return <div className="analytics-visual-loading">Executing query…</div>
    }
    if (result?.error) {
      return <AlertMessage tone="error" compact message={result.error} />
    }
    if (!result) {
      return <div className="analytics-visual-loading">Waiting for query execution…</div>
    }

    if (effectiveType === 'KPI_CARD') {
      return (
        <KpiCardRenderer
          visual={visual}
          columns={allColumns.length ? allColumns : columns}
          rows={rows}
          totals={totals}
          onInspectRecords={onInspectRecords}
        />
      )
    }

    if (effectiveType === 'TANK_VISUAL') {
      return (
        <TankVisualRenderer
          visual={visual}
          rows={rows}
          totals={totals}
          meta={result?.meta || {}}
          activeSelection={activeSelection}
          onCrossFilter={visual?.interactions?.crossFilter !== false ? onCrossFilter : null}
        />
      )
    }

    if (isPerspective) {
      return (
        <PerspectiveGrid
          visual={visual}
          columns={columns}
          rows={rows}
          totals={totals}
          expanded={isModal || printMode}
          shelfOpen={printMode ? false : (isModal ? true : shelfOpen)}
          activeSelection={activeSelection}
          onCrossFilter={visual?.interactions?.crossFilter !== false ? onCrossFilter : null}
          onExplorerChange={onExplorerChange}
          containerWidth={isModal ? 1100 : bodyRect.width}
        />
      )
    }

    if (isPlotly) {
      return (
        <PlotlyRenderer
          visual={visual}
          effectiveType={effectiveType}
          columns={allColumns.length ? allColumns : columns}
          rows={rows}
          totals={totals}
          expanded={isModal}
          chartHeight={isModal ? 480 : Math.max(190, bodyRect.height - 14)}
          onCrossFilter={visual?.interactions?.crossFilter !== false ? onCrossFilter : null}
        />
      )
    }

    if (isECharts) {
      return (
        <EChartsRenderer
          visual={visual}
          effectiveType={effectiveType}
          columns={allColumns.length ? allColumns : columns}
          rows={rows}
          totals={totals}
          expanded={isModal}
          chartHeight={isModal ? 480 : Math.max(190, bodyRect.height - 14)}
          activeSelection={activeSelection}
          onCrossFilter={visual?.interactions?.crossFilter !== false ? onCrossFilter : null}
        />
      )
    }

    return null
  }

  return (
    <>
      <article className={`analytics-visual-card type-${effectiveType.toLowerCase()} ${loading ? 'is-refreshing' : ''}`}>
        <header className="analytics-visual-header">
          <div className="analytics-visual-title-wrap">
            {editable && !isLocked && (
              <span
                className="analytics-card-drag-handle"
                title="Drag to reposition visual"
                aria-label="Drag handle"
              >
                <Icon name="grid" size={14} />
              </span>
            )}
            <div className="analytics-visual-title-texts">
              <h4 title={visual?.title || visualMeta.label}>
                {visual?.title || visualMeta.label}
              </h4>
              {visual?.subtitle && (
                <small className="analytics-visual-subtitle" title={visual.subtitle}>
                  {visual.subtitle}
                </small>
              )}
            </div>
          </div>

          <div
            className="analytics-visual-actions"
            onMouseDown={(e) => e.stopPropagation()}
          >
            {isPerspective && (
              <button
                type="button"
                className={`analytics-icon-btn ${shelfOpen ? 'is-active' : ''}`}
                title={shelfOpen ? 'Hide Perspective Pivot & Filter Shelf' : 'Open Perspective Pivot & Filter Shelf'}
                aria-label="Toggle Perspective Pivot Shelf"
                onClick={() => setShelfOpen((s) => !s)}
              >
                <Icon name="sliders" size={14} />
              </button>
            )}

            {canSwitchRuntimeView && bodyRect.width >= 340 && (
              <select
                className="analytics-runtime-view-select"
                aria-label={`Switch display type for ${visual?.title || 'visual'}`}
                value={effectiveType}
                onChange={(e) => {
                  const val = e.target.value
                  setViewOverride(val === savedType ? '' : val)
                }}
              >
                {!RUNTIME_SWITCHABLE_TYPES.some((rt) => rt.type === savedType) && (
                  <option value={savedType}>{visualMeta.shortLabel}</option>
                )}
                {RUNTIME_SWITCHABLE_TYPES.map((rt) => (
                  <option key={rt.type} value={rt.type}>{rt.label}</option>
                ))}
              </select>
            )}

            {onInspectRecords && savedType !== 'TEXT' && (
              <button
                type="button"
                className="analytics-icon-btn"
                title="Inspect underlying source records"
                aria-label={`Inspect records for ${visual?.title || 'visual'}`}
                onClick={() => onInspectRecords(visual)}
              >
                <Icon name="database" size={14} />
              </button>
            )}

            {editable && onToggleLock && (
              <button
                type="button"
                className={`analytics-icon-btn ${isLocked ? 'is-active' : ''}`}
                title={isLocked ? 'Unlock position & size' : 'Lock position & size'}
                aria-label={isLocked ? 'Unlock visual' : 'Lock visual'}
                onClick={() => onToggleLock(visual.id)}
              >
                <Icon name="lock" size={14} />
              </button>
            )}

            {editable && onEditVisual && (
              <button
                type="button"
                className="analytics-icon-btn"
                title="Configure visual in inspector"
                aria-label={`Edit ${visual?.title || 'visual'}`}
                onClick={() => onEditVisual(visual.id)}
              >
                <Icon name="settings" size={14} />
              </button>
            )}

            {editable && onDuplicateVisual && (
              <button
                type="button"
                className="analytics-icon-btn"
                title="Duplicate visual"
                aria-label={`Duplicate ${visual?.title || 'visual'}`}
                onClick={() => onDuplicateVisual(visual.id)}
              >
                <Icon name="copy" size={14} />
              </button>
            )}

            {editable && onDeleteVisual && (
              <button
                type="button"
                className="analytics-icon-btn is-danger"
                title="Remove visual"
                aria-label={`Remove ${visual?.title || 'visual'}`}
                onClick={() => onDeleteVisual(visual.id)}
              >
                <Icon name="trash" size={14} />
              </button>
            )}

            {!editable && onExport && savedType !== 'TEXT' && bodyRect.width >= 380 && (
              <ExportMenu
                label="Export"
                title={visual?.title || 'Analytics Visual'}
                fileName={(visual?.title || 'analytics_visual').toLowerCase().replace(/[^a-z0-9]+/g, '_')}
                columns={columns.map((c) => ({ key: c.key, label: c.label || c.key }))}
                rows={rows}
                disabled={!rows.length}
              />
            )}

            {savedType !== 'TEXT' && (
              <button
                type="button"
                className="analytics-icon-btn"
                title="Expand full screen"
                aria-label={`Expand ${visual?.title || 'visual'}`}
                onClick={() => setExpanded(true)}
              >
                <Icon name="externalLink" size={14} />
              </button>
            )}
          </div>
        </header>

        <div ref={bodyRef} className="analytics-visual-body">
          {renderContent(false)}
        </div>

        {/* Footer: row count + engine warnings, so a visual that renders "empty"
            says how many rows it actually received and why (parity with the
            Report Builder result footer). */}
        {(rowCount !== null || warnings.length > 0) && (
          <footer className="analytics-visual-footer" title={warnings.join(' ')}>
            {rowCount !== null && (
              <span className="analytics-visual-rowcount">
                {rowCount === 0 ? 'No rows' : `${rowCount}${rowCount >= 500 ? '+' : ''} row${rowCount === 1 ? '' : 's'}`}
                {totalRows != null && totalRows !== rowCount ? ` of ${totalRows}` : ''}
              </span>
            )}
            {warnings.length > 0 && (
              <span className="analytics-visual-warning" title={warnings.join(' ')}>
                <Icon name="alertTriangle" size={12} /> {warnings[0]}
                {warnings.length > 1 ? ` (+${warnings.length - 1} more)` : ''}
              </span>
            )}
          </footer>
        )}
      </article>

      <Modal
        open={expanded}
        onClose={() => setExpanded(false)}
        title={visual?.title || visualMeta.label}
        size="xl"
        footer={(
          <div className="analytics-modal-footer-bar">
            <div className="analytics-modal-footer-left">
              {canSwitchRuntimeView && (
                <label className="analytics-inline-field">
                  <span>View As</span>
                  <select
                    value={effectiveType}
                    onChange={(e) => setViewOverride(e.target.value === savedType ? '' : e.target.value)}
                  >
                    {!RUNTIME_SWITCHABLE_TYPES.some((rt) => rt.type === savedType) && (
                      <option value={savedType}>{visualMeta.label}</option>
                    )}
                    {RUNTIME_SWITCHABLE_TYPES.map((rt) => (
                      <option key={rt.type} value={rt.type}>{rt.label}</option>
                    ))}
                  </select>
                </label>
              )}
              {onExport && (
                <>
                  <button type="button" className="btn-secondary btn-sm" onClick={() => onExport(visual, 'xlsx')}>
                    <Icon name="fileSpreadsheet" size={14} /> Server XLSX
                  </button>
                  <button type="button" className="btn-secondary btn-sm" onClick={() => onExport(visual, 'csv')}>
                    <Icon name="fileText" size={14} /> Server CSV
                  </button>
                </>
              )}
              {onInspectRecords && (
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={() => {
                    setExpanded(false)
                    onInspectRecords(visual)
                  }}
                >
                  <Icon name="database" size={14} /> Underlying Records
                </button>
              )}
            </div>
            <button type="button" className="btn-primary" onClick={() => setExpanded(false)}>
              Close
            </button>
          </div>
        )}
      >
        <div className="analytics-expanded-modal-body">
          {renderContent(true)}
        </div>
      </Modal>
    </>
  )
}

export default AnalyticsVisual
