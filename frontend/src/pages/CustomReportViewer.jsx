import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import PageHeader from '../components/common/PageHeader'
import AlertMessage from '../components/common/AlertMessage'
import Icon from '../components/common/Icon'
import PaginationControls from '../components/common/PaginationControls'
import ExportMenu from '../components/common/ExportMenu'
import CompanyPrintHeader from '../components/reports/CompanyPrintHeader'
import CompanyPrintFooter from '../components/reports/CompanyPrintFooter'
import ReportDataTable from '../components/reportBuilder/ReportDataTable'
import { useToast } from '../components/common/Toast'
import { usePermissions } from '../hooks/usePermissions'
import { useCompanyPrintProfile } from '../hooks/useCompanyPrintProfile'
import { usePrintDialog } from '../components/print/printProfileContext'
import {
  exportMyReport,
  getMyReport,
  getMyReports,
  getReportLookups,
  runMyReport,
} from '../api/reportBuilderApi'
import { dateRangeDefaults, formatCellValue, formulaInWords } from '../utils/reportBuilder'
import { logUiAction } from '../utils/actionLogger'

const comparisonOperatorLabels = {
  eq: 'is', ne: 'is not', gt: 'is greater than', gte: 'is at least', lt: 'is less than', lte: 'is at most',
  contains: 'contains', not_contains: 'does not contain', starts_with: 'starts with', ends_with: 'ends with',
  in: 'is one of', not_in: 'is none of', between: 'is between', is_blank: 'is blank', is_not_blank: 'is not blank',
}

const comparisonRuleText = (rule) => {
  const field = rule.label || rule.source?.column || rule.source?.field || rule.source?.field_code || rule.source?.path || 'a field'
  const operator = comparisonOperatorLabels[rule.operator] || rule.operator || 'is'
  if (rule.operator === 'is_blank' || rule.operator === 'is_not_blank') return `${field} ${operator}`
  const value = Array.isArray(rule.value) ? rule.value.join(', ') : rule.value ?? '…'
  return rule.operator === 'between' ? `${field} ${operator} ${value} and ${rule.value2 ?? '…'}` : `${field} ${operator} ${value}`
}

const normalizeRunResult = (data) => {
  // Defend against wrapped responses, arrays, primitives and empty envelopes.
  const source = data && typeof data === 'object' && !Array.isArray(data) ? data : {}
  const columns = Array.isArray(source.columns) ? source.columns : []
  const rows = Array.isArray(source.rows) ? source.rows : []
  const rawMeta = source.meta && typeof source.meta === 'object' ? source.meta : {}
  const numberOr = (value, fallback) => {
    if (value === null || value === undefined || value === '') return fallback
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : fallback
  }

  return {
    ...source,
    columns,
    rows,
    totals: source.totals && typeof source.totals === 'object' ? source.totals : {},
    meta: {
      ...rawMeta,
      total_rows: numberOr(rawMeta.total_rows, rows.length),
      page: numberOr(rawMeta.page, 1),
      page_size: numberOr(rawMeta.page_size, rows.length || 1),
      scanned_rows: numberOr(rawMeta.scanned_rows, rows.length),
      filtered_rows: numberOr(rawMeta.filtered_rows, rows.length),
      generated_in_ms: numberOr(rawMeta.generated_in_ms, 0),
      warnings: Array.isArray(rawMeta.warnings) ? rawMeta.warnings : [],
      grouped: Boolean(rawMeta.grouped),
    },
  }
}

/**
 * Reporting-module home for Report Builder reports: pick a shared report,
 * answer its filters, then view / export (full result, server-side) / print
 * (Company Report Profile branding via the global print dialog).
 */
function CustomReportViewer({ loggedInUser }) {
  const { reportId } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const profile = useCompanyPrintProfile()
  const { requestPrint } = usePrintDialog()
  const { hasPermission } = usePermissions(loggedInUser)
  const canExport = hasPermission('Export Custom Report')
  const canDesign = hasPermission('Edit Report Definition') || hasPermission('View Report Definition')

  const [reports, setReports] = useState([])
  const [report, setReport] = useState(null)
  const [lookups, setLookups] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const defaults = useMemo(() => dateRangeDefaults(), [])
  const [dateFrom, setDateFrom] = useState(defaults.dateFrom)
  const [dateTo, setDateTo] = useState(defaults.dateTo)
  const [locationCodes, setLocationCodes] = useState([])
  const [runtimeValues, setRuntimeValues] = useState({})
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [result, setResult] = useState(null)
  const [running, setRunning] = useState(false)
  const [exporting, setExporting] = useState('')
  const [printResult, setPrintResult] = useState(null)
  const [showAbout, setShowAbout] = useState(false)
  const autoRanFor = useRef(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
  // eslint-disable-next-line react-hooks/set-state-in-effect
    Promise.all([getMyReports(), getReportLookups()])
      .then(([list, look]) => {
        if (cancelled) return
        setReports(Array.isArray(list) ? list : [])
        setLookups(look)
      })
      .catch((err) => { if (!cancelled) setError(err.message || 'Could not load your reports.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!reportId) {
      setReport(null)
      setResult(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError('')
    setResult(null)
    setPage(1)
  // eslint-disable-next-line react-hooks/set-state-in-effect
    getMyReport(reportId)
      .then((data) => {
        if (cancelled) return
        if (!data || typeof data !== 'object' || Array.isArray(data) || !data.id) {
          throw new Error('The server returned an invalid report. Return to Custom Reports and try opening it again.')
        }
        setReport(data)
        setPageSize(data.definition?.options?.page_size || 50)
        const initial = {}
        ;(data.definition?.runtime_filters || []).forEach((entry) => {
          if (entry.default !== undefined) initial[entry.key] = entry.default
        })
        setRuntimeValues(initial)
        autoRanFor.current = null
      })
      .catch((err) => { if (!cancelled) setError(err.message || 'This report is not available to you.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [reportId])

  const buildRun = useCallback((overrides = {}) => ({
    date_from: dateFrom || null,
    date_to: dateTo || null,
    location_codes: locationCodes,
    runtime_values: runtimeValues,
    search: search || '',
    page,
    page_size: pageSize,
    ...overrides,
  }), [dateFrom, dateTo, locationCodes, runtimeValues, search, page, pageSize])

  const handleRun = useCallback(async (overrides = {}) => {
    if (!report) return null
    setRunning(true)
    setError('')
    try {
      const data = await runMyReport(report.id, buildRun(overrides))
      const normalized = normalizeRunResult(data)
      setResult(normalized)
      logUiAction('Custom Reports', 'Run Report', { report: report.report_name })
      return normalized
    } catch (err) {
      setError(err.message || 'The report could not be run.')
      return null
    } finally {
      setRunning(false)
    }
  }, [report, buildRun])

  // Run once when a report opens (with its default filters).
  useEffect(() => {
    if (report && autoRanFor.current !== report.id) {
      autoRanFor.current = report.id
      handleRun({ page: 1 })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report])

  const handlePageChange = (nextPage) => {
    setPage(nextPage)
    handleRun({ page: nextPage })
  }

  const handleExport = async (format) => {
    if (!report) return
    setExporting(format)
    try {
      const fileName = await exportMyReport(report.id, buildRun({ page: 1 }), format)
      toast.success(`Downloaded ${fileName} (all matching rows).`, { title: report.report_name })
      logUiAction('Custom Reports', `Export ${format.toUpperCase()}`, { report: report.report_name })
    } catch (err) {
      toast.error(err.message || 'Export failed.', { title: report.report_name })
    } finally {
      setExporting('')
    }
  }

  const handlePrint = () => {
    if (!report) return
    requestPrint({
      module: 'Custom Reports',
      reportName: report.report_name,
      onBeforePrint: async () => {
        // Print the full result (up to 500 rows), not just the screen page.
        try {
          const full = await runMyReport(report.id, buildRun({ page: 1, page_size: 500 }))
          setPrintResult(normalizeRunResult(full))
        } catch {
          setPrintResult(null)
        }
      },
    })
  }

  const runtimeFilters = report?.definition?.runtime_filters || []
  const calculatedColumns = (report?.definition?.columns || []).filter((c) => (c.kind || 'data') === 'calculated')
  const comparisonColumns = (report?.definition?.columns || []).filter((c) => (
    (c.kind || 'data') === 'data' && Array.isArray(c.value_conditions) && c.value_conditions.length > 0
  ))
  const exportColumns = useMemo(
    () => (result?.columns || []).map((column) => ({
      key: column.key, label: column.label,
      format: (value) => formatCellValue(value, column, ''),
    })),
    [result]
  )

  const renderRuntimeFilter = (entry) => {
    const value = runtimeValues[entry.key] ?? ''
    const set = (next) => { setRuntimeValues((current) => ({ ...current, [entry.key]: next })); setPage(1) }
    const multiSelect = (options, getValue, getLabel) => (
      <select
        multiple
        size={Math.min(5, Math.max(2, options.length))}
        value={Array.isArray(value) ? value : value ? [value] : []}
        onChange={(e) => set([...e.target.selectedOptions].map((o) => o.value))}
      >
        {options.map((option) => <option key={getValue(option)} value={getValue(option)}>{getLabel(option)}</option>)}
      </select>
    )
    let control
    if (entry.type === 'location') control = multiSelect(lookups?.locations || [], (l) => l.location_code, (l) => `${l.location_code} — ${l.location_name}`)
    else if (entry.type === 'operation_type') control = multiSelect(lookups?.operation_types || [], (t) => t.operation_type_code, (t) => t.operation_type_name)
    else if (entry.type === 'status') control = multiSelect(lookups?.statuses || [], (s) => s, (s) => s)
    else if (entry.type === 'asset') control = multiSelect(lookups?.assets || [], (a) => a.asset_code, (a) => `${a.asset_code} — ${a.asset_name}`)
    else if (entry.type === 'select') {
      const options = entry.options || []
      control = options.length ? (
        <select multiple size={Math.min(5, options.length)} value={Array.isArray(value) ? value : value ? [value] : []} onChange={(e) => set([...e.target.selectedOptions].map((o) => o.value))}>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <input type="text" value={value} onChange={(e) => set(e.target.value)} />
      )
    } else if (entry.type === 'number') control = <input type="number" value={value} onChange={(e) => set(e.target.value === '' ? '' : Number(e.target.value))} />
    else if (entry.type === 'date') control = <input type="date" value={value} onChange={(e) => set(e.target.value)} />
    else control = <input type="text" value={value} onChange={(e) => set(e.target.value)} placeholder="Type to filter…" />
    return (
      <div className="rb-field" key={entry.key}>
        <label>{entry.label || entry.key}{entry.required ? ' *' : ''}</label>
        {control}
        {entry.type === 'location' || entry.type === 'asset' ? <span className="rb-muted">Ctrl/Cmd-click for several. Empty = all of yours.</span> : null}
      </div>
    )
  }

  if (!reportId) {
    return (
      <div>
        <PageHeader
          title="Custom Reports"
          description="Reports designed in the Report Builder and shared with you (directly, through your roles, or through your locations)."
          count={`${reports.length} Report${reports.length === 1 ? '' : 's'}`}
          actions={canDesign ? (
            <button type="button" className="btn-secondary" onClick={() => navigate('/report-builder')}>
              <Icon name="settings" size={15} /> Open Report Builder
            </button>
          ) : null}
        />
        <AlertMessage tone="error" message={error} onDismiss={() => setError('')} />
        {loading && <AlertMessage tone="info" message="Loading your reports…" />}
        {!loading && reports.length === 0 && !error && (
          <div className="empty-table">
            No custom reports have been shared with you yet.
            {canDesign ? ' Design one in Configurations → Report Builder, publish it, and it will appear here.' : ' Ask a report designer to share one with you, your role, or your location.'}
          </div>
        )}
        <div className="rb-starter-grid">
          {reports.map((item) => (
            <div key={item.id} className="rb-starter-card">
              <span className={`status-badge ${item.report_type === 'MATRIX' ? 'submitted' : 'active'}`}>{item.report_type === 'MATRIX' ? 'Matrix' : 'Tabular'}</span>
              <h4>{item.report_name}</h4>
              <p>{item.description || 'No description.'}</p>
              <p className="rb-muted">{item.column_count} columns · by {item.owner_name || item.created_by || '—'} · v{item.version}</p>
              <Link className="btn-primary btn-sm rb-link-btn" to={`/reporting/custom-reports/${item.id}`}>
                <Icon name="eye" size={14} /> Open report
              </Link>
            </div>
          ))}
        </div>
      </div>
    )
  }

  const printedResult = printResult || result
  const filterSummary = [
    dateFrom || dateTo ? `Dates (${printedResult?.meta?.date_basis_label || 'Accounting Date'}): ${dateFrom || '…'} to ${dateTo || '…'}` : null,
    locationCodes.length ? `Locations: ${locationCodes.join(', ')}` : 'Locations: all of mine',
    search ? `Search: “${search}”` : null,
  ].filter(Boolean).join(' · ')

  return (
    <div className="custom-report-page">
      <div className="no-print">
        <PageHeader
          title={report?.report_name || 'Custom Report'}
          description={report?.description || ''}
          count={result ? `${result.meta.total_rows.toLocaleString()} Rows` : ''}
          actions={(
            <>
              <button type="button" className="btn-secondary" onClick={() => navigate('/reporting/custom-reports')}>
                <Icon name="chevronLeft" size={15} /> All custom reports
              </button>
              {canDesign && report && (report.my_access === 'OWNER' || report.my_access === 'EDIT') && (
                <button type="button" className="btn-secondary" onClick={() => navigate('/report-builder')}>
                  <Icon name="edit" size={15} /> Design
                </button>
              )}
            </>
          )}
        />
      </div>

      {loading && <AlertMessage tone="info" message="Loading the report…" />}
      <div className="no-print"><AlertMessage tone="error" message={error} onDismiss={() => setError('')} /></div>

      {report && (
        <>
          <form
            className="filter-panel no-print"
            onSubmit={(e) => { e.preventDefault(); setPage(1); handleRun({ page: 1 }) }}
          >
            <div className="rb-field">
              <label htmlFor="rbv-from">Date from</label>
              <input id="rbv-from" type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1) }} />
            </div>
            <div className="rb-field">
              <label htmlFor="rbv-to">Date to</label>
              <input id="rbv-to" type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1) }} />
            </div>
            {runtimeFilters.map(renderRuntimeFilter)}
            <div className="rb-field">
              <label htmlFor="rbv-search">Quick search in results</label>
              <input id="rbv-search" type="search" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} placeholder="Ticket, tank, product…" />
            </div>
            <div className="filter-actions rb-viewer-actions">
              <button type="submit" className="btn-primary" disabled={running}>
                <Icon name="refresh" size={15} /> {running ? 'Running…' : 'Run Report'}
              </button>
              <button type="button" className="btn-secondary" onClick={() => {
                const fresh = dateRangeDefaults()
                setDateFrom(fresh.dateFrom); setDateTo(fresh.dateTo)
                setLocationCodes([]); setRuntimeValues({}); setSearch(''); setPage(1)
              }}>Clear</button>
            </div>
          </form>

          <div className="rb-viewer-toolbar no-print">
            <button type="button" className="btn-secondary" onClick={() => setShowAbout((v) => !v)}>
              <Icon name="info" size={15} /> About this report
            </button>
            <span className="rb-toolbar-spacer" />
            {canExport && (
              <>
                <button type="button" className="btn-secondary" disabled={!result || exporting === 'xlsx'} onClick={() => handleExport('xlsx')}>
                  <Icon name="fileSpreadsheet" size={15} /> Excel (all rows)
                </button>
                <button type="button" className="btn-secondary" disabled={!result || exporting === 'csv'} onClick={() => handleExport('csv')}>
                  <Icon name="fileText" size={15} /> CSV (all rows)
                </button>
                <ExportMenu
                  rows={result?.rows || []}
                  columns={exportColumns}
                  fileName={report.report_name}
                  title={report.report_name}
                  subtitle={filterSummary}
                  module="Custom Reports"
                  label="Export this page / PDF"
                  disabled={!result?.rows?.length}
                />
              </>
            )}
            <button type="button" className="btn-primary" disabled={!result} onClick={handlePrint}>
              <Icon name="print" size={15} /> Print
            </button>
          </div>

          {showAbout && (
            <div className="info-box no-print">
              <strong>About “{report.report_name}”</strong> (design v{report.version}, by {report.owner_name || report.created_by || '—'}).
              Dates use <em>{result?.meta?.date_basis_label || 'the report’s chosen date'}</em>.
              Data is always limited to your own locations.
              {comparisonColumns.length > 0 && (
                <>
                  <br />Comparison columns:
                  <ul>
                    {comparisonColumns.map((column) => (
                      <li key={column.key}>
                        <strong>{column.label}</strong> includes a value only when {(column.value_conditions || []).map(comparisonRuleText).join((column.value_condition_logic || 'AND') === 'OR' ? ' OR ' : ' AND ')}.
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {calculatedColumns.length > 0 && (
                <>
                  <br />Calculated columns:
                  <ul>
                    {calculatedColumns.map((c) => (
                      <li key={c.key}><strong>{c.label}</strong> = {formulaInWords(c.formula, report.definition.columns)}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}

          {(result?.meta?.warnings || []).map((warning) => (
            <div className="no-print" key={warning}><AlertMessage tone="warning" message={warning} /></div>
          ))}

          <div className="rb-screen-table no-print">
            {result ? (
              <ReportDataTable result={result} emptyText={report.definition?.options?.empty_text || '—'} />
            ) : running ? (
              <div className="empty-table">Running the report…</div>
            ) : (
              <div className="empty-table">Choose filters and Run Report.</div>
            )}
          </div>
          {result && (
            <div className="no-print">
              <PaginationControls
                currentPage={page}
                totalRows={result.meta.total_rows}
                pageSize={pageSize}
                onPageChange={handlePageChange}
                onPageSizeChange={(size) => { setPageSize(size); setPage(1); handleRun({ page: 1, page_size: size }) }}
                alwaysShow
              />
              <p className="rb-muted">Made in {result.meta.generated_in_ms} ms · read {result.meta.scanned_rows.toLocaleString()} record(s) · {result.meta.filtered_rows.toLocaleString()} after filters{result.meta.grouped ? ' · grouped summary' : ''}.</p>
            </div>
          )}
          {printedResult && (
            <div className="printable-report custom-report-print">
              <CompanyPrintHeader profile={profile} defaultSubtitle={report.report_name} />
              <div className="rb-print-meta">
                <h2>{report.report_name}</h2>
                <p>{filterSummary}</p>
                <p>Generated {printedResult.meta?.generated_at ? new Date(printedResult.meta.generated_at).toLocaleString() : ''} by {loggedInUser?.fullName || loggedInUser?.full_name || loggedInUser?.username || ''} · {printedResult.meta?.total_rows?.toLocaleString() || 0} row(s){(printedResult.meta?.total_rows || 0) > 500 ? ' (first 500 printed)' : ''}</p>
              </div>
              <ReportDataTable result={printedResult} emptyText={report.definition?.options?.empty_text || '—'} compact />
              <CompanyPrintFooter profile={profile} />
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default CustomReportViewer
