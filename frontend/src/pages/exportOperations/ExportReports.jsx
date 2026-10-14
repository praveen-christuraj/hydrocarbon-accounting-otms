import { useCallback, useEffect, useMemo, useState } from 'react'
import { getExportReport } from '../../api/exportOperationsApi'
import PaginationControls, { paginateRows, usePageSize } from '../../components/common/PaginationControls'
import DataTableToolbar from '../../components/common/DataTableToolbar'
import PageHeader from '../../components/common/PageHeader'
import AlertMessage from '../../components/common/AlertMessage'
import Icon from '../../components/common/Icon'
import CompanyPrintHeader from '../../components/reports/CompanyPrintHeader'
import CompanyPrintFooter from '../../components/reports/CompanyPrintFooter'
import { useCompanyPrintProfile } from '../../hooks/useCompanyPrintProfile'
import { useDataFilters } from '../../hooks/useDataFilters'
import { logUiAction } from '../../utils/actionLogger'
import { COUNTRIES, codeOptions, fmt, useExportReferenceData } from './exportShared'

const MODULE = 'Export Reports'
const EMPTY_FILTERS = { location_code: '', quarter: '', from_date: '', to_date: '', country: '' }

const COLUMNS = [
  { key: 'bl_date', label: 'BL Date', type: 'date' },
  { key: 'vessel_name', label: 'Vessel' },
  { key: 'quarter', label: 'Quarter', type: 'select' },
  { key: 'location_label', label: 'Location', type: 'select' },
  { key: 'entity_label', label: 'Entity', type: 'select' },
  { key: 'block_label', label: 'Block', type: 'select' },
  { key: 'volume', label: 'Volume', type: 'number' },
  { key: 'consignee', label: 'Consignee', type: 'select' },
  { key: 'destination', label: 'Destination' },
  { key: 'country', label: 'Country', type: 'select' },
  { key: 'permit_number', label: 'Permit #' },
  { key: 'remarks', label: 'Remarks' },
]

function ExportReports() {
  const profile = useCompanyPrintProfile()
  const reference = useExportReferenceData(['locations'])
  const { locations } = reference.data
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [report, setReport] = useState(null)
  const [quarters, setQuarters] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const pageSize = usePageSize()

  const applyReport = (data) => {
    setReport(data)
    if (data?.rows) {
      setQuarters((current) => [...new Set([...current, ...data.rows.map((row) => row.quarter).filter(Boolean)])].sort().reverse())
    }
  }

  const generate = useCallback(async (activeFilters) => {
    setLoading(true)
    setError('')
    try {
      const params = Object.fromEntries(Object.entries(activeFilters).filter(([, value]) => value))
      applyReport(await getExportReport(params))
      setPage(1)
    } catch (err) {
      setError(err.message || 'Unable to generate the export report.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    getExportReport({})
      .then((data) => {
        if (!cancelled) applyReport(data)
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Unable to generate the export report.')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const rows = useMemo(
    () =>
      (report?.rows || []).map((row) => ({
        ...row,
        location_label: row.location_name || row.location_code,
        entity_label: row.entity_name || row.entity_code,
        block_label: row.block_name || row.block_code,
      })),
    [report]
  )
  const tableFilters = useDataFilters(rows, COLUMNS, { module: MODULE })
  const visibleRows = paginateRows(tableFilters.filteredRows, page, pageSize)
  const filteredVolume = tableFilters.filteredRows.reduce((sum, row) => sum + Number(row.volume || 0), 0)

  const setFilter = (key, value) => setFilters((current) => ({ ...current, [key]: value }))

  const handleGenerate = () => {
    logUiAction(MODULE, 'Generate Export Report', filters)
    generate(filters)
  }

  const handlePrint = () => {
    logUiAction(MODULE, 'Print Export Report')
    window.print()
  }

  return (
    <div className="export-operations-page">
      <CompanyPrintHeader profile={profile} defaultSubtitle="Export Report" />
      <PageHeader
        className="no-print"
        title="Export Reports"
        description="Export transactions for a period, location or destination country. Print or export to Excel, CSV or PDF."
        count={report ? `${tableFilters.filteredRows.length} Records` : undefined}
        actions={
          <button type="button" className="btn-secondary" onClick={handlePrint} disabled={!rows.length}>
            <Icon name="print" size={15} />
            Print
          </button>
        }
      />

      <AlertMessage tone="error" message={error || reference.error} onDismiss={() => setError('')} />

      <div className="report-filter-panel compact-filter-panel no-print">
        <div>
          <label htmlFor="xr-location">Location</label>
          <select id="xr-location" value={filters.location_code} onChange={(e) => setFilter('location_code', e.target.value)}>
            <option value="">All</option>
            {codeOptions(locations, 'location_name', 'location_code')}
          </select>
        </div>
        <div>
          <label htmlFor="xr-quarter">Quarter</label>
          <select id="xr-quarter" value={filters.quarter} onChange={(e) => setFilter('quarter', e.target.value)}>
            <option value="">All</option>
            {quarters.map((quarter) => (
              <option key={quarter} value={quarter}>
                {quarter}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="xr-from">BL Date From</label>
          <input id="xr-from" type="date" value={filters.from_date} onChange={(e) => setFilter('from_date', e.target.value)} />
        </div>
        <div>
          <label htmlFor="xr-to">BL Date To</label>
          <input id="xr-to" type="date" value={filters.to_date} onChange={(e) => setFilter('to_date', e.target.value)} />
        </div>
        <div>
          <label htmlFor="xr-country">Country</label>
          <select id="xr-country" value={filters.country} onChange={(e) => setFilter('country', e.target.value)}>
            <option value="">All</option>
            {COUNTRIES.map((country) => (
              <option key={country} value={country}>
                {country}
              </option>
            ))}
          </select>
        </div>
        <div className="report-filter-actions">
          <button type="button" className="btn-primary" onClick={handleGenerate} disabled={loading}>
            {loading ? 'Generating…' : 'Generate'}
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setFilters(EMPTY_FILTERS)
              generate(EMPTY_FILTERS)
            }}
            disabled={loading}
          >
            Clear
          </button>
        </div>
      </div>

      {report && (
        <>
          <div className="summary-card-grid compact-summary-grid">
            <div className="summary-card">
              <span>Records</span>
              <strong>{report.total_rows}</strong>
            </div>
            <div className="summary-card">
              <span>Total Volume</span>
              <strong>{fmt(report.total_volume)}</strong>
            </div>
            <div className="summary-card">
              <span>Filtered Volume</span>
              <strong>{fmt(filteredVolume)}</strong>
            </div>
          </div>

          <div className="no-print">
            <DataTableToolbar
              filters={tableFilters}
              columns={COLUMNS}
              exportFileName="export-report"
              exportTitle="Export Report"
              module={MODULE}
              searchPlaceholder="Search vessel, consignee, permit…"
            />
          </div>

          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>BL Date</th>
                  <th>Vessel</th>
                  <th>Quarter</th>
                  <th>Location</th>
                  <th>Entity</th>
                  <th>Block</th>
                  <th className="numeric">Volume</th>
                  <th>Consignee</th>
                  <th>Destination</th>
                  <th>Country</th>
                  <th>Permit #</th>
                  <th>Remarks</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="empty-table">
                      No export transactions for the selected filters.
                    </td>
                  </tr>
                ) : (
                  visibleRows.map((row) => (
                    <tr key={row.id}>
                      <td>{row.bl_date}</td>
                      <td>{row.vessel_name || '—'}</td>
                      <td>{row.quarter}</td>
                      <td>{row.location_label}</td>
                      <td>{row.entity_label}</td>
                      <td>{row.block_label}</td>
                      <td className="numeric">{fmt(row.volume)}</td>
                      <td>{row.consignee}</td>
                      <td>{row.destination}</td>
                      <td>{row.country}</td>
                      <td>{row.permit_number || '—'}</td>
                      <td className="cell-wrap">{row.remarks || '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="no-print">
            <PaginationControls currentPage={page} totalRows={tableFilters.filteredRows.length} onPageChange={setPage} />
          </div>
        </>
      )}
      <CompanyPrintFooter profile={profile} />
    </div>
  )
}

export default ExportReports
