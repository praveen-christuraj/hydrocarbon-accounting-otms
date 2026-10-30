import { formatCellValue, isNumericValue } from '../../utils/reportBuilder'

/**
 * Renders one run result (tabular, grouped or matrix) exactly as the engine
 * returned it: formatted cells, totals footer, per-cell calculation
 * warnings and a frozen first column for wide matrix reports.
 */
function ReportDataTable({ result, emptyText = '—', compact = false, drillColumn, onDrill }) {
  const columns = result?.columns || []
  const rows = result?.rows || []
  const totals = result?.totals || {}
  const hasTotals = columns.some((column) => Object.prototype.hasOwnProperty.call(totals, column.key))

  if (!columns.length) {
    return <div className="empty-table">This report has no columns yet.</div>
  }
  if (!rows.length) {
    return (
      <div className="empty-table">
        No rows match these filters. Try a wider date range or fewer filters.
      </div>
    )
  }

  const alignClass = (column, value) => {
    if ((column.format?.align || column.align) === 'center') return 'rb-align-center'
    if ((column.format?.align || column.align) === 'left') return ''
    return column.data_type === 'number' || isNumericValue(value) ? 'rb-align-right' : ''
  }

  return (
    <div className={`rb-table-wrap ${compact ? 'rb-table-compact' : ''}`}>
      <table className="rb-table">
        <thead>
          <tr>
            {columns.map((column, index) => (
              <th key={column.key} className={`${alignClass(column)} ${index === 0 ? 'rb-sticky-col' : ''}`}>
                {column.label}
                {column.unit ? <span className="rb-th-unit"> ({column.unit})</span> : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {columns.map((column, colIndex) => {
                const error = row._errors?.[column.key]
                return (
                  <td
                    key={column.key}
                    className={`${alignClass(column, row[column.key])} ${colIndex === 0 ? 'rb-sticky-col' : ''} ${error ? 'rb-cell-error' : ''}`}
                    title={error ? `Could not be calculated: ${error}` : undefined}
                  >
                    {error ? '⚠ ' : ''}
                    {onDrill && column.key === drillColumn && typeof row[column.key] === 'string' && row[column.key] ? (
                      <button type="button" className="btn-secondary btn-sm" title="Drill into this date period" onClick={() => onDrill(row[column.key])}>{formatCellValue(row[column.key], column, emptyText)} ↓</button>
                    ) : formatCellValue(row[column.key], column, emptyText)}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
        {hasTotals && (
          <tfoot>
            <tr className="rb-total-row">
              {columns.map((column, index) => (
                <td key={column.key} className={`${alignClass(column, totals[column.key])} ${index === 0 ? 'rb-sticky-col' : ''}`}>
                  {Object.prototype.hasOwnProperty.call(totals, column.key)
                    ? formatCellValue(totals[column.key], column, emptyText)
                    : index === 0
                      ? 'TOTAL'
                      : ''}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}

export default ReportDataTable
