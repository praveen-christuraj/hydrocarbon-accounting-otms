import { useEffect, useMemo, useState } from 'react'
import {
  getTankOperationSummary,
  getTankOperationSummaryColumns,
} from '../api/tankOperationSummaryApi'
import { useCompanyPrintProfile } from '../hooks/useCompanyPrintProfile'
import { usePrintDialog } from '../components/print/printProfileContext'
import { logUiAction } from '../utils/actionLogger'
import PaginationControls, { paginateRows, usePageSize } from '../components/common/PaginationControls'
import DataTableToolbar from '../components/common/DataTableToolbar'
import { useDataFilters } from '../hooks/useDataFilters'
import { useAutoColumns } from '../hooks/useAutoColumns'
import AlertMessage from '../components/common/AlertMessage'
import useActionFeedback from '../hooks/useActionFeedback'
import {
  formatCalendarDate,
  formatDateTime as formatSafeDateTime,
  formatGaugingTime,
} from '../utils/format'

function TankOperationSummary({ locations, assets, loggedInUser }) {
  const profile = useCompanyPrintProfile()
  const { requestPrint } = usePrintDialog()

  const emptyFilters = {
    locationCode: '',
    tankAssetCode: '',
    productName: '',
    dateFrom: '',
    dateTo: '',
  }

  const [filters, setFilters] = useState(emptyFilters)
  const [rows, setRows] = useState([])
  const [columns, setColumns] = useState([])
  const [reportMeta, setReportMeta] = useState(null)
  const [loading, setLoading] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const pageSize = usePageSize()
  // Action feedback: little pop-up (toast) + inline message near the
  // action area (owner rule 8) - never at the bottom of the page.
  const feedback = useActionFeedback()
  const { notifySuccess, notifyError, clearSuccess, clearError } = feedback

  const isAdminBootstrap =
    loggedInUser?.isAdmin === true ||
    String(loggedInUser?.username || '').trim().toLowerCase() === 'admin' ||
    (Array.isArray(loggedInUser?.roles) && loggedInUser.roles.some((role) =>
      String(role?.role_name || role?.roleName || '').trim().toLowerCase() === 'admin'
    ))
  const hasAllLocationsAccess = loggedInUser?.allLocationsAccess === 'Yes'
  const normalizeCode = (value) => String(value ?? '').trim().toLowerCase()
  const scopedLocationCodeSet = useMemo(() => {
    return new Set(
      (loggedInUser?.assignedLocationCodes || [])
        .map(normalizeCode)
        .filter(Boolean)
    )
  }, [loggedInUser])

  const activeLocations = useMemo(() => {
    const statusFiltered = (locations || []).filter(
      (location) => location.status === 'Active'
    )
    if (isAdminBootstrap || hasAllLocationsAccess) {
      return statusFiltered
    }
    return statusFiltered.filter((location) =>
      scopedLocationCodeSet.has(normalizeCode(location.locationCode))
    )
  }, [
    locations,
    isAdminBootstrap,
    hasAllLocationsAccess,
    scopedLocationCodeSet,
  ])

  const activeTankAssets = useMemo(() => {
    return (assets || []).filter((asset) => {
      if (asset.status !== 'Active') {
        return false
      }

      if (
        !isAdminBootstrap &&
        !hasAllLocationsAccess &&
        asset.locationCode &&
        !scopedLocationCodeSet.has(normalizeCode(asset.locationCode))
      ) {
        return false
      }

      if (filters.locationCode && asset.locationCode) {
        return asset.locationCode === filters.locationCode
      }

      return true
    })
  }, [
    assets,
    filters.locationCode,
    isAdminBootstrap,
    hasAllLocationsAccess,
    scopedLocationCodeSet,
  ])

  const loadReport = async (activeFilters = filters) => {
    try {
      setLoading(true)

      const [reportData, reportColumns] = await Promise.all([
        getTankOperationSummary(activeFilters),
        getTankOperationSummaryColumns(activeFilters.locationCode),
      ])

      setRows(reportData.rows || [])
      setColumns(reportData.columns || reportColumns)
      setReportMeta(reportData)
      setCurrentPage(1)
    } catch (error) {
      notifyError(error.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadReport(emptyFilters)
  }, [])

  const formatDateTime = (value) => {
    return formatSafeDateTime(value, '-')
  }

  const formatNumber = (value, decimals = 3) => {
    return Number(value || 0).toLocaleString(undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })
  }

  const isNumericValue = (value) => {
    if (typeof value === 'number') {
      return true
    }

    if (typeof value === 'string' && value.trim() === '') {
      return false
    }

    return !isNaN(Number(value))
  }

  const isCalendarDateColumn = (col) => {
    return (
      col === 'accounting_date' ||
      col === 'operation_date' ||
      col === 'gauging_date' ||
      col === 'input_gaugingDate' ||
      col === 'input_gauging_date' ||
      col.endsWith('Date')
    )
  }

  const isTimeOnlyColumn = (col) => {
    return (
      col === 'gauging_time' ||
      col === 'input_gaugingTime' ||
      col === 'input_gauging_time' ||
      col.endsWith('Time')
    )
  }

  const isDateTimeColumn = (col) => {
    return col.includes('datetime') || col === 'created_at' || col === 'updated_at'
  }

  const NON_NUMERIC_INPUT_COLS = new Set([
    'input_tankOperation',
    'input_ticketNumber',
    'input_operationNumber',
    'input_gaugingDate',
    'input_gaugingTime',
    'input_gauging_date',
    'input_gauging_time',
    'input_productName',
    'input_remarks',
    'input_tankTemperatureUnit',
    'input_observedDensityUnit',
  ])

  const renderCellValue = (col, value) => {
    if (value === null || value === undefined || value === '') {
      return '-'
    }

    if (isCalendarDateColumn(col)) {
      return formatCalendarDate(value)
    }

    if (isTimeOnlyColumn(col)) {
      return formatGaugingTime(value)
    }

    if (isDateTimeColumn(col)) {
      return formatDateTime(value)
    }

    if (
      !NON_NUMERIC_INPUT_COLS.has(col) &&
      isNumericValue(value) &&
      (col.startsWith('calc_') ||
        col.startsWith('input_') ||
        col.includes('_nsv') ||
        col.includes('_gsv') ||
        col.includes('_lt') ||
        col.includes('_mt') ||
        col.includes('_bbl'))
    ) {
      return formatNumber(value)
    }

    return value
  }

  const rowsFilters = useDataFilters(rows, useAutoColumns(rows), { module: 'Tank Operation Summary' })
  const visibleRows = paginateRows(rowsFilters.filteredRows, currentPage, pageSize)

  const escapeCsvValue = (value) => {
    if (value === null || value === undefined) {
      return ''
    }

    const text = String(value)

    if (
      text.includes(',') ||
      text.includes('"') ||
      text.includes('\n') ||
      text.includes('\r')
    ) {
      return `"${text.replace(/"/g, '""')}"`
    }

    return text
  }

  const downloadCsv = (filename, headers, dataRows) => {
    const csvLines = [
      headers.map(escapeCsvValue).join(','),
      ...dataRows.map((row) => row.map(escapeCsvValue).join(',')),
    ]

    const csvContent = csvLines.join('\n')
    const blob = new Blob([csvContent], {
      type: 'text/csv;charset=utf-8;',
    })

    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')

    link.href = url
    link.setAttribute('download', filename)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)

    URL.revokeObjectURL(url)
  }

  const handleExportCsv = () => {
    if (rows.length === 0) {
      notifyError('No Tank Operation Summary rows available to export')
      return
    }

    const headers = columns
    const dataRows = rows.map((row) => columns.map((col) => row[col] || ''))

    downloadCsv('tank-operation-summary.csv', headers, dataRows)
  }

  const handleFilterChange = (e) => {
    const { name, value } = e.target

    if (name === 'locationCode') {
      setFilters({
        ...filters,
        locationCode: value,
        tankAssetCode: '',
      })
      return
    }

    setFilters({
      ...filters,
      [name]: value,
    })
  }

  const handleApplyFilters = async (e) => {
    e.preventDefault()
    await loadReport(filters)
  }

  const handleClearFilters = async () => {
    setFilters(emptyFilters)
    await loadReport(emptyFilters)
  }

  return (
    <div className="tank-operation-summary-page">
      {profile && (
        <div className="print-report-header">
          <div className="print-company-block">
            {profile.logoUrl ? (
              <img src={profile.logoUrl} alt={`${profile.companyName} Logo`} className="print-company-logo" />
            ) : (
              <div className="print-logo-placeholder">{profile.logoText || 'LOGO'}</div>
            )}
            <div>
              <h1>{profile.companyName}</h1>
              <p>{profile.systemName}</p>
              <p>{profile.reportSubtitle || 'Tank Operation Summary'}</p>
            </div>
          </div>

          <div className="print-report-meta">
            <span>
              <strong>Location:</strong> {filters.locationCode || 'All Locations'}
            </span>
            <span>
              <strong>Tank:</strong> {filters.tankAssetCode || 'All Tanks'}
            </span>
            <span>
              <strong>Product:</strong> {filters.productName || 'All Products'}
            </span>
            <span>
              <strong>Date:</strong> {filters.dateFrom || '-'} to{' '}
              {filters.dateTo || '-'}
            </span>
            <span>
              <strong>Printed:</strong> {new Date().toLocaleString()}
            </span>
          </div>
        </div>
      )}

      <div className="page-title">
        <div>
          <h2>Tank Operation Summary</h2>
          <p>
            Detailed tank operation data from approved Tank Gauging transactions.
            Shows all extracted input and calculated columns from JSON payloads.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span className="record-count">
            {reportMeta && reportMeta.totalRows !== rows.length
              ? `${rows.length} of ${reportMeta.totalRows} Ledger Rows`
              : `${rows.length} Ledger Rows`}
          </span>
          <button
            type="button"
            onClick={() =>
              requestPrint({
                module: 'Tank Operation Summary',
                reportName: 'Tank Operation Summary',
                onBeforePrint: () => {
                  logUiAction('Tank Operation Summary', 'Print Report', filters)
                },
              })
            }
          >
            Print
          </button>
        </div>
      </div>
      {/* Action feedback: right next to the page actions + a little pop-up
          toast - never at the bottom of the page (owner rule 8). */}
      <AlertMessage tone="success" message={feedback.successMsg} onDismiss={clearSuccess} />
      <AlertMessage tone="error" message={feedback.errorMsg} onDismiss={clearError} />

      <form onSubmit={handleApplyFilters} className="filter-panel">
        <div>
          <label>Location</label>
          <select
            name="locationCode"
            value={filters.locationCode}
            onChange={handleFilterChange}
            disabled={loading}
          >
            <option value="">All Locations</option>

            {activeLocations.map((location) => (
              <option key={location.id} value={location.locationCode}>
                {location.locationName} ({location.locationCode})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label>Tank Asset</label>
          <select
            name="tankAssetCode"
            value={filters.tankAssetCode}
            onChange={handleFilterChange}
            disabled={loading}
          >
            <option value="">All Tanks</option>

            {activeTankAssets.map((asset) => (
              <option key={asset.id} value={asset.assetCode}>
                {asset.assetName} ({asset.assetCode})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label>Product</label>
          <input
            name="productName"
            type="text"
            value={filters.productName}
            onChange={handleFilterChange}
            placeholder="Example: Crude Oil"
            disabled={loading}
          />
        </div>

        <div>
          <label>Accounting Date From</label>
          <input
            name="dateFrom"
            type="date"
            value={filters.dateFrom}
            onChange={handleFilterChange}
            disabled={loading}
          />
        </div>

        <div>
          <label>Accounting Date To</label>
          <input
            name="dateTo"
            type="date"
            value={filters.dateTo}
            onChange={handleFilterChange}
            disabled={loading}
          />
        </div>

        <div className="filter-actions">
          <button type="submit" disabled={loading}>
            {loading ? 'Loading...' : 'Apply'}
          </button>
        </div>

        <div className="filter-actions">
          <button type="button" onClick={handleClearFilters} disabled={loading}>
            Clear
          </button>
        </div>

        <div className="filter-actions">
          <button type="button" onClick={handleExportCsv} disabled={loading}>
            Export CSV
          </button>
        </div>
      </form>

      {reportMeta?.defaultWindowApplied && (
        <div className="info-box">
          Showing the most recent 90 days of data
          {reportMeta.appliedDateFrom
            ? ` (${reportMeta.appliedDateFrom} to ${reportMeta.appliedDateTo || 'latest'})`
            : ''}
          . To load older records, set Accounting Date From / To above and
          click Apply.
        </div>
      )}

      {reportMeta?.hasMore && (
        <div className="info-box">
          Only the first {rows.length} of {reportMeta.totalRows} matching
          rows were loaded. Narrow the location, tank or date range to see
          the rest.
        </div>
      )}

      <div className="section-title">
        <h3>Tank Operation Summary</h3>
        <p>
          Shows all tank gauging operation data extracted from JSON payloads.
          All JSON input and calculated fields are flattened as columns.
        </p>
      </div>

      <DataTableToolbar
        filters={rowsFilters}
        columns={rowsFilters.columns}
        exportFileName="tank-operation-summary"
        exportTitle="Tank Operation Summary"
      />

      <div className="tank-operation-summary-table-wrap">
        <table>
          <thead>
            <tr>
              {columns.map((col, index) => (
                <th key={index}>{col}</th>
              ))}
            </tr>
          </thead>

          <tbody>
            {visibleRows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="empty-table">
                  No Tank Operation Summary rows found.
                </td>
              </tr>
            ) : (
              visibleRows.map((row, index) => (
                <tr key={row.transaction_id || index}>
                  {columns.map((col) => (
                    <td key={col}>{renderCellValue(col, row[col])}</td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <PaginationControls
        currentPage={currentPage}
        totalRows={rowsFilters.filteredRows.length}
        onPageChange={setCurrentPage}
      />

      <div className="info-box">
        Tank Operation Summary displays all extracted fields from tank gauging payloads.
        Columns dynamically change based on available data in the JSON payloads.
        Only Approved transactions with Tank Gauging layout are included.
      </div>

      {profile && (
        <div className="print-only print-footnote">
          <p>{profile.footerFormula}</p>
          <p>{profile.footerNote}</p>
        </div>
      )}

    </div>
  )
}

export default TankOperationSummary