import { useEffect, useMemo, useRef, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import AlertMessage from '../common/AlertMessage'
import Modal from '../common/Modal'
import PaginationControls, { paginateRows, usePageSize } from '../common/PaginationControls'

const EMPTY_ARRAY = []

const formatValue = (value, column, style) => {
  if (value === null || value === undefined || value === '') return '—'
  if (column?.data_type === 'number' || typeof value === 'number') {
    const decimals = Number(style?.decimals ?? column?.format?.decimals ?? 2)
    const num = Number(value)
    if (!Number.isFinite(num)) return '—'
    if (style?.compact) {
      return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: Math.max(0, decimals) }).format(num)
    }
    return num.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: decimals })
  }
  return String(value)
}

const sum = (rows, key) => rows.reduce((total, row) => total + (Number(row?.[key]) || 0), 0)

function useContainerSize(ref) {
  const [size, setSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    const node = ref.current
    if (!node || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const { width, height } = entry.contentRect
      setSize((current) => (Math.abs(current.width - width) < 2 && Math.abs(current.height - height) < 2 ? current : { width, height }))
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [ref])
  return size
}

function VisualBody({ visual, result, expanded, chartHeight }) {
  const allColumns = result?.columns || EMPTY_ARRAY
  const hiddenKeys = useMemo(() => new Set((visual?.query?.columns || []).filter((col) => col?.hidden).map((col) => col.key)), [visual])
  const columns = useMemo(() => allColumns.filter((col) => !hiddenKeys.has(col.key)), [allColumns, hiddenKeys])
  const rows = result?.rows || EMPTY_ARRAY
  const [page, setPage] = useState(1)
  const pageSize = usePageSize()
  useEffect(() => { setPage(1) }, [visual?.id, result?.meta?.total_rows, rows.length])
  const visibleRows = paginateRows(rows, page, pageSize)
  const numericColumn = columns.find((column) => column.data_type === 'number')
  const metricKey = visual?.query?.metric_key || visual?.query?.measure_key || numericColumn?.key
  const metricColumn = columns.find((column) => column.key === metricKey) || numericColumn
  const dimensionKey = visual?.query?.dimension_key || columns.find((column) => column.key !== metricColumn?.key)?.key
  const style = visual?.style || {}
  const kpiStyle = style.kpi || {}
  const tableStyle = style.table || {}
  const chartStyle = style.chart || {}

  const chartOption = useMemo(() => {
    const css = getComputedStyle(document.documentElement)
    const textColor = css.getPropertyValue('--text').trim() || 'currentColor'
    const muted = css.getPropertyValue('--text-muted').trim() || textColor
    const primary = css.getPropertyValue('--primary').trim() || 'var(--primary)'
    const palette = Array.isArray(chartStyle.palette) && chartStyle.palette.length ? chartStyle.palette : [primary, '#2ea3f2', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6']
    const labelByKey = new Map(columns.map((column) => [column.key, column.label || column.key]))
    const type = String(visual?.type || '').toUpperCase()
    const category = rows.map((row) => String(row?.[dimensionKey] ?? '—'))
    const values = rows.map((row) => Number(row?.[metricColumn?.key]) || 0)
    const rotate = chartStyle.xLabelRotation != null ? Number(chartStyle.xLabelRotation) : (category.length > 8 ? 25 : 0)
    const common = {
      animation: false,
      color: palette,
      tooltip: { trigger: 'axis' },
      legend: chartStyle.showLegend === false ? { show: false } : { top: 0, textStyle: { color: muted } },
      grid: { left: 54, right: 20, top: chartStyle.showLegend === false ? 24 : 44, bottom: 58, containLabel: true },
      xAxis: { type: 'category', data: category, axisLabel: { color: muted, rotate } },
      yAxis: { type: 'value', axisLabel: { color: muted }, splitLine: { show: chartStyle.showGrid !== false, lineStyle: { color: 'var(--divider)' } } },
      series: [{
        name: labelByKey.get(metricColumn?.key) || 'Value',
        type: 'bar',
        data: values,
        barMaxWidth: 44,
        label: { show: chartStyle.showLabels === true, position: 'top', color: textColor },
      }],
      textStyle: { color: textColor, fontFamily: 'Inter, sans-serif' },
    }
    if (type === 'LINE' || type === 'AREA') {
      common.series[0].type = 'line'
      common.series[0].smooth = chartStyle.smooth === true
      common.series[0].showSymbol = true
      if (type === 'AREA' || chartStyle.areaFill) common.series[0].areaStyle = { opacity: 0.2 }
      if (chartStyle.stacked) common.series[0].stack = 'total'
    }
    if (type === 'BAR' || type === 'COLUMN') {
      common.series[0].type = 'bar'
      if (chartStyle.stacked) common.series[0].stack = 'total'
    }
    if (type === 'COLUMN') {
      // ECharts column is bar with vertical categories - keep default vertical bars
    }
    if (type === 'PIE' || type === 'DONUT') {
      common.tooltip = { trigger: 'item' }
      common.grid = undefined
      common.xAxis = undefined
      common.yAxis = undefined
      common.legend = chartStyle.showLegend === false ? { show: false } : { orient: 'vertical', right: 8, top: 'middle', textStyle: { color: muted } }
      common.series = [{
        name: labelByKey.get(metricColumn?.key) || 'Value',
        type: 'pie',
        radius: type === 'DONUT' ? ['42%', '72%'] : '72%',
        center: ['38%', '50%'],
        data: rows.map((row, index) => ({ name: category[index], value: values[index] })),
        label: { color: textColor, show: chartStyle.showLabels !== false },
      }]
    }
    return common
  }, [columns, dimensionKey, metricColumn, rows, visual?.type, chartStyle])

  const type = String(visual?.type || '').toUpperCase()

  if (type === 'TEXT') {
    return <p className="analytics-text-visual">{visual.text || 'Add dashboard notes in the builder.'}</p>
  }
  if (type === 'TANK_VISUAL') {
    return <AlertMessage tone="info" compact message="Tank visual is reserved for a future analytics release." />
  }
  if (type === 'TABLE' || type === 'MATRIX') {
    const density = tableStyle.density || 'comfortable'
    return (
      <>
        <div className={`analytics-table-scroll ${expanded ? 'is-expanded' : ''} density-${density} ${tableStyle.striped ? 'is-striped' : ''} ${tableStyle.wrapText ? 'wrap-text' : ''}`}>
          <table className="analytics-result-table">
            <thead><tr>{columns.map((column) => <th scope="col" key={column.key} className={tableStyle.stickyHeader === false ? '' : 'is-sticky'}>{column.label || column.key}</th>)}</tr></thead>
            <tbody>
              {visibleRows.map((row, index) => (
                <tr key={`${row.id ?? row.accounting_date ?? 'row'}-${index}`}>
                  {columns.map((column) => <td key={column.key}>{formatValue(row[column.key], column)}</td>)}
                </tr>
              ))}
              {!visibleRows.length && <tr><td colSpan={Math.max(columns.length, 1)}>No rows matched the selected filters.</td></tr>}
            </tbody>
          </table>
        </div>
        <PaginationControls currentPage={page} totalRows={rows.length} onPageChange={setPage} />
      </>
    )
  }
  if (type === 'KPI_CARD' || type === 'GAUGE') {
    const value = result?.totals?.[metricColumn?.key] ?? sum(rows, metricColumn?.key)
    const decimals = kpiStyle.decimals != null ? Number(kpiStyle.decimals) : (Number(metricColumn?.format?.decimals ?? 2))
    const display = formatValue(value, metricColumn, { compact: kpiStyle.compact, decimals })
    return (
      <div className={`analytics-kpi-value align-${kpiStyle.align || 'left'}`} style={{ minHeight: expanded ? 220 : 150 }}>
        <strong style={{ color: kpiStyle.valueColor || undefined, fontSize: kpiStyle.valueFontSize ? `${kpiStyle.valueFontSize}px` : undefined }}>
          {kpiStyle.prefix || ''}{display}{kpiStyle.suffix || ''}
        </strong>
        <span style={{ color: kpiStyle.labelColor || undefined, fontSize: kpiStyle.labelFontSize ? `${kpiStyle.labelFontSize}px` : undefined }}>
          {metricColumn?.label || visual?.query?.metric_label || 'Value'}
        </span>
      </div>
    )
  }
  if (metricColumn && dimensionKey && rows.length) {
    return <ReactECharts option={chartOption} notMerge lazyUpdate style={{ minHeight: expanded ? 420 : 260, height: chartHeight || (expanded ? '60vh' : 320) }} opts={{ renderer: 'canvas' }} />
  }
  return <AlertMessage tone="info" compact message="Choose a category and numeric measure in the visual definition to render this chart." />
}

function AnalyticsVisual({ visual, result, onExport, busy, expanded = false, expandable = true, expandedControls = null }) {
  const [isExpanded, setIsExpanded] = useState(false)
  const bodyRef = useRef(null)
  const { height: bodyHeight } = useContainerSize(bodyRef)
  const warnings = result?.meta?.warnings || []
  const type = String(visual?.type || '').toUpperCase()
  const style = visual?.style || {}
  const canExpand = expandable && !expanded && type !== 'TEXT' && type !== 'TANK_VISUAL'
  const chartHeight = !expanded && bodyHeight > 120 ? Math.max(220, bodyHeight - 8) : undefined

  const card = (
    <article className={`analytics-visual-card ${expanded ? 'is-expanded' : ''}`} style={{ background: style.cardBackground || undefined, borderColor: style.cardBorder === false ? 'transparent' : undefined }}>
      <header className="analytics-visual-head">
        <div className="analytics-visual-title-wrap">
          <h3 style={{ color: style.titleColor || undefined }}>{visual?.title || 'Untitled visual'}</h3>
          {visual?.description && <p>{visual.description}</p>}
        </div>
        <div className="analytics-visual-head-actions">
          {canExpand && <button type="button" className="btn-secondary btn-sm" onClick={() => setIsExpanded(true)} aria-haspopup="dialog" aria-label={`Expand ${visual?.title || 'visual'}`}>Expand</button>}
          {onExport && type !== 'TEXT' && type !== 'TANK_VISUAL' && (
            <div className="analytics-export-actions">
              <button type="button" className="btn-secondary btn-sm" onClick={() => onExport('xlsx')} disabled={busy}>Excel</button>
              <button type="button" className="btn-secondary btn-sm" onClick={() => onExport('csv')} disabled={busy}>CSV</button>
            </div>
          )}
        </div>
      </header>
      {warnings.map((warning, index) => <AlertMessage key={`warning-${index}`} tone="warning" compact message={warning} />)}
      <div className={`analytics-visual-body ${expanded ? 'is-expanded' : ''}`} ref={bodyRef}>
        <VisualBody visual={visual} result={result} expanded={expanded} chartHeight={chartHeight} />
      </div>
    </article>
  )

  return (
    <>
      {card}
      {isExpanded && (
        <Modal
          open
          title={visual?.title || 'Visual'}
          description={visual?.description || undefined}
          onClose={() => setIsExpanded(false)}
          size="full"
          className="analytics-expand-modal"
        >
          <div className="analytics-expand-layout">
            {expandedControls ? <div className="analytics-expand-controls">{expandedControls}</div> : null}
            <div className="analytics-expand-visual">
              <AnalyticsVisual
                visual={visual}
                result={result}
                onExport={onExport}
                busy={busy}
                expanded
                expandable={false}
              />
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}

export default AnalyticsVisual
