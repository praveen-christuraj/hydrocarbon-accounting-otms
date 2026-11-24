import { useMemo, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import AlertMessage from '../common/AlertMessage'
import PaginationControls, { paginateRows, usePageSize } from '../common/PaginationControls'

const EMPTY_ARRAY = []

const formatValue = (value, column) => {
  if (value === null || value === undefined || value === '') return '—'
  if (column?.data_type === 'number' || typeof value === 'number') {
    const decimals = Number(column?.format?.decimals ?? 2)
    return Number(value).toLocaleString(undefined, { maximumFractionDigits: decimals })
  }
  return String(value)
}

const sum = (rows, key) => rows.reduce((total, row) => total + (Number(row?.[key]) || 0), 0)

function AnalyticsVisual({ visual, result, onExport, busy }) {
  const columns = result?.columns || EMPTY_ARRAY
  const rows = result?.rows || EMPTY_ARRAY
  const [page, setPage] = useState(1)
  const pageSize = usePageSize()
  const visibleRows = paginateRows(rows, page, pageSize)
  const numericColumn = columns.find((column) => column.data_type === 'number')
  const metricKey = visual?.query?.metric_key || numericColumn?.key
  const metricColumn = columns.find((column) => column.key === metricKey) || numericColumn
  const dimensionKey = visual?.query?.dimension_key || columns.find((column) => column.key !== metricColumn?.key)?.key
  const warnings = result?.meta?.warnings || []
  const chartOption = useMemo(() => {
    const textColor = getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || 'currentColor'
    const muted = getComputedStyle(document.documentElement).getPropertyValue('--text-muted').trim() || textColor
    const primary = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() || 'var(--primary)'
    const labelByKey = new Map(columns.map((column) => [column.key, column.label || column.key]))
    const type = String(visual?.type || '').toUpperCase()
    const category = rows.map((row) => String(row?.[dimensionKey] ?? '—'))
    const values = rows.map((row) => Number(row?.[metricColumn?.key]) || 0)
    const common = {
      animation: false,
      color: [primary],
      tooltip: { trigger: 'axis' },
      grid: { left: 54, right: 20, top: 28, bottom: 58, containLabel: true },
      xAxis: { type: 'category', data: category, axisLabel: { color: muted, rotate: category.length > 8 ? 25 : 0 } },
      yAxis: { type: 'value', axisLabel: { color: muted }, splitLine: { lineStyle: { color: 'var(--divider)' } } },
      series: [{ name: labelByKey.get(metricColumn?.key) || 'Value', type: 'bar', data: values, barMaxWidth: 44 }],
      textStyle: { color: textColor, fontFamily: 'Inter, sans-serif' },
    }
    if (type === 'LINE' || type === 'AREA') {
      common.series[0].type = 'line'
      common.series[0].smooth = false
      common.series[0].showSymbol = true
      if (type === 'AREA') common.series[0].areaStyle = { opacity: 0.2 }
    }
    if (type === 'PIE' || type === 'DONUT') {
      common.tooltip = { trigger: 'item' }
      common.grid = undefined
      common.xAxis = undefined
      common.yAxis = undefined
      common.series = [{
        name: labelByKey.get(metricColumn?.key) || 'Value',
        type: 'pie',
        radius: type === 'DONUT' ? ['42%', '72%'] : '72%',
        data: rows.map((row, index) => ({ name: category[index], value: values[index] })),
        label: { color: textColor },
      }]
    }
    return common
  }, [columns, dimensionKey, metricColumn, rows, visual?.type])

  const renderTable = () => (
    <>
      <div className="analytics-table-scroll">
        <table className="analytics-result-table">
          <thead><tr>{columns.map((column) => <th scope="col" key={column.key}>{column.label || column.key}</th>)}</tr></thead>
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

  const type = String(visual?.type || '').toUpperCase()
  let body
  if (type === 'TEXT') {
    body = <p className="analytics-text-visual">{visual.text || 'Add dashboard notes in the builder.'}</p>
  } else if (type === 'TANK_VISUAL') {
    body = <AlertMessage tone="info" compact message="Tank visual is reserved for a future analytics release." />
  } else if (type === 'TABLE' || type === 'MATRIX') {
    body = renderTable()
  } else if (type === 'KPI_CARD' || type === 'GAUGE') {
    const value = result?.totals?.[metricColumn?.key] ?? sum(rows, metricColumn?.key)
    body = (
      <div className="analytics-kpi-value">
        <strong>{formatValue(value, metricColumn)}</strong>
        <span>{metricColumn?.label || visual?.query?.metric_label || 'Value'}</span>
      </div>
    )
  } else if (metricColumn && dimensionKey && rows.length) {
    body = <ReactECharts option={chartOption} notMerge lazyUpdate style={{ minHeight: 300, height: 320 }} opts={{ renderer: 'canvas' }} />
  } else {
    body = <AlertMessage tone="info" compact message="Choose a category and numeric measure in the visual definition to render this chart." />
  }

  return (
    <article className="analytics-visual-card">
      <header className="analytics-visual-head">
        <div><h3>{visual?.title || 'Untitled visual'}</h3>{visual?.description && <p>{visual.description}</p>}</div>
        {onExport && type !== 'TEXT' && type !== 'TANK_VISUAL' && (
          <div className="analytics-export-actions">
            <button type="button" className="btn-secondary btn-sm" onClick={() => onExport('xlsx')} disabled={busy}>Excel</button>
            <button type="button" className="btn-secondary btn-sm" onClick={() => onExport('csv')} disabled={busy}>CSV</button>
          </div>
        )}
      </header>
      {warnings.map((warning, index) => <AlertMessage key={`warning-${index}`} tone="warning" compact message={warning} />)}
      {body}
    </article>
  )
}

export default AnalyticsVisual
