import { useMemo, useState } from 'react'
import { getMaterialBalanceReport } from '../api/materialBalanceReportApi'
import { useCompanyPrintProfile } from '../hooks/useCompanyPrintProfile'
import { usePrintDialog } from '../components/print/printProfileContext'
import { logUiAction } from '../utils/actionLogger'
import PaginationControls, { paginateRows, usePageSize } from '../components/common/PaginationControls'
import DataTableToolbar from '../components/common/DataTableToolbar'
import { useDataFilters } from '../hooks/useDataFilters'
import { useAutoColumns } from '../hooks/useAutoColumns'
import AlertMessage from '../components/common/AlertMessage'
import useActionFeedback from '../hooks/useActionFeedback'
import { formatCalendarDate } from '../utils/format'
import { escapeCsvCell } from '../utils/exportUtils'

function MaterialBalanceReport({ locations, assets }) {
  const profile = useCompanyPrintProfile()
  const { requestPrint } = usePrintDialog()

  const emptyFilters = {
    locationCode: '',
    tankAssetCode: '',
    dateFrom: '',
    dateTo: '',
    status: 'Active',
    unit: 'nsv',
  }

  const [filters, setFilters] = useState(emptyFilters)
  const [template, setTemplate] = useState(null)
  const [columns, setColumns] = useState([])
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const pageSize = usePageSize()
  // Action feedback: little pop-up (toast) + inline message near the
  // action area (owner rule 8) - never at the bottom of the page.
  const feedback = useActionFeedback()
  const { notifySuccess, notifyError, clearSuccess, clearError } = feedback

  const activeLocations = useMemo(() => {
    return (locations || []).filter((location) => location.status === 'Active')
  }, [locations])

  const activeTankAssets = useMemo(() => {
    return (assets || []).filter((asset) => {
      if (asset.status !== 'Active') {
        return false
      }

      if (filters.locationCode && asset.locationCode) {
        return asset.locationCode === filters.locationCode
      }

      return true
    })
  }, [assets, filters.locationCode])

  const sortedColumns = useMemo(() => {
    return [...columns].sort((a, b) => {
      if (a.columnOrder !== b.columnOrder) {
        return a.columnOrder - b.columnOrder
      }

      return a.columnLabel.localeCompare(b.columnLabel)
    })
  }, [columns])

  const totals = useMemo(() => {
    const columnTotals = {}

    sortedColumns.forEach((column) => {
      columnTotals[column.columnKey] = 0
    })

    rows.forEach((row) => {
      sortedColumns.forEach((column) => {
        columnTotals[column.columnKey] += Number(
          row.values?.[column.columnKey] || 0
        )
      })
    })

    const movementInTotal = sortedColumns
      .filter(
        (column) =>
          column.columnType === 'MOVEMENT' &&
          column.movementDirection === 'IN' &&
          column.includeInMaterialBalance === 'Yes' &&
          column.isInternalTransfer !== 'Yes'
      )
      .reduce((sum, column) => sum + Number(columnTotals[column.columnKey] || 0), 0)

    const movementOutTotal = sortedColumns
      .filter(
        (column) =>
          column.columnType === 'MOVEMENT' &&
          column.movementDirection === 'OUT' &&
          column.includeInMaterialBalance === 'Yes' &&
          column.isInternalTransfer !== 'Yes'
      )
      .reduce((sum, column) => sum + Number(columnTotals[column.columnKey] || 0), 0)

    const closingColumn = sortedColumns.find(
      (column) => column.columnType === 'ACTUAL_CLOSING'
    )

    const lossGainColumn = sortedColumns.find(
      (column) => column.columnType === 'LOSS_GAIN'
    )

    const finalClosing = closingColumn
      ? rows.length > 0
        ? Number(rows[rows.length - 1]?.values?.[closingColumn.columnKey] || 0)
        : 0
      : 0

    const lossGainTotal = lossGainColumn
      ? Number(columnTotals[lossGainColumn.columnKey] || 0)
      : 0

    return {
      columnTotals,
      movementInTotal,
      movementOutTotal,
      finalClosing,
      lossGainTotal,
      closingColumnLabel: closingColumn?.columnLabel || 'Closing Stock',
      lossGainColumnLabel: lossGainColumn?.columnLabel || 'Loss / Gain',
    }
  }, [rows, sortedColumns])


  const loadReport = async (activeFilters = filters) => {
    if (!activeFilters.locationCode) {
      notifyError('Location is required')
      return
    }

    if (!activeFilters.dateFrom || !activeFilters.dateTo) {
      notifyError('Date From and Date To are required')
      return
    }

    try {
      setLoading(true)

      const data = await getMaterialBalanceReport(activeFilters)

      setTemplate(data.template)
      setColumns(data.columns)
      setRows(data.rows)
      setCurrentPage(1)
    } catch (error) {
      notifyError(error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleFilterChange = (e) => {
    const { name, value } = e.target

    if (name === 'locationCode') {
      setFilters({
        ...filters,
        locationCode: value,
        tankAssetCode: '',
      })
      setTemplate(null)
      setColumns([])
      setRows([])
      clearError()
      setCurrentPage(1)
      return
    }

    setFilters({
      ...filters,
      [name]: value,
    })
    clearError()
    setCurrentPage(1)
  }

  const handleApplyFilters = async (e) => {
    e.preventDefault()
    await loadReport(filters)
  }

  const handleClearFilters = () => {
    setFilters(emptyFilters)
    setTemplate(null)
    setColumns([])
    setRows([])
    setCurrentPage(1)
  }

  const formatNumber = (value, decimals = 3) => {
    return Number(value || 0).toLocaleString(undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })
  }

  const getNumberClass = (value) => {
    if (Number(value || 0) > 0) {
      return 'positive-number'
    }

    if (Number(value || 0) < 0) {
      return 'negative-number'
    }

    return ''
  }

  const getUnitLabel = () => {
    if (filters.unit === 'gsv') {
      return 'GSV'
    }

    if (filters.unit === 'lt') {
      return 'LT'
    }

    if (filters.unit === 'mt') {
      return 'MT'
    }

    return 'NSV'
  }

  const rowsFilters = useDataFilters(rows, useAutoColumns(rows), { module: 'Material Balance Report' })
  const visibleRows = paginateRows(rowsFilters.filteredRows, currentPage, pageSize)

  const downloadCsv = (filename, headers, dataRows) => {
    const csvLines = [
      headers.map(escapeCsvCell).join(','),
      ...dataRows.map((row) => row.map(escapeCsvCell).join(',')),
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

  const getExportHeaders = () => {
    return [
      'Accounting Date',
      'Location Code',
      'Location Name',
      'Tank Asset Code',
      'Tank Asset Name',
      'Product',
      ...sortedColumns.map((column) => `${column.columnLabel} ${getUnitLabel()}`),
      'Rows Count',
      'Last Ticket',
    ]
  }

  const getExportDataRows = () => {
    return rows.map((row) => [
      formatCalendarDate(row.accountingDate, ''),
      row.locationCode,
      row.locationName,
      row.tankAssetCode || '',
      row.tankAssetName || '',
      row.productName || '',
      ...sortedColumns.map((column) =>
        formatNumber(row.values?.[column.columnKey] || 0)
      ),
      row.rowsCount,
      row.lastTicketNumber || '',
    ])
  }

  const handleExportCsv = () => {
    if (rows.length === 0) {
      notifyError('No Material Balance rows available to export')
      return
    }

    downloadCsv(
      'material-balance-report.csv',
      getExportHeaders(),
      getExportDataRows()
    )
  }

  const handlePrintReport = () => {
    if (rows.length === 0) {
      notifyError('No Material Balance rows available to print')
      return
    }

    requestPrint({
      module: 'Material Balance Report',
      reportName: 'Material Balance Report',
      onBeforePrint: () => {
        logUiAction('Material Balance Report', 'Print Report', filters)
      },
    })
  }

  return (
    <div className="material-balance-report-page">
      <div className="page-title">
        <div>
          <h2>Material Balance Report</h2>
          <p>
            Dynamic date-wise material balance from user-configured template
            columns.
          </p>
        </div>

        <span className="record-count">{rows.length} Rows</span>
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
            <option value="">Select Location</option>

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
          <label>Status</label>
          <select
            name="status"
            value={filters.status}
            onChange={handleFilterChange}
            disabled={loading}
          >
            <option value="Active">Active</option>
            <option value="">All Statuses</option>
            <option value="Reversed">Reversed</option>
            <option value="Cancelled">Cancelled</option>
          </select>
        </div>

        <div>
          <label>Unit</label>
          <select
            name="unit"
            value={filters.unit}
            onChange={handleFilterChange}
            disabled={loading}
          >
            <option value="nsv">NSV</option>
            <option value="gsv">GSV</option>
            <option value="lt">LT</option>
            <option value="mt">MT</option>
          </select>
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

        <div className="filter-actions">
          <button type="button" onClick={handlePrintReport} disabled={loading}>
            Print Report
          </button>
        </div>
      </form>

      {template && (
        <div className="info-box">
          Active Template: {template.templateName} ({template.locationCode}).
          Columns shown below are loaded from Material Balance Template
          Configuration.
        </div>
      )}

      <div className="summary-card-grid">
        <div className="summary-card">
          <span>Total IN {getUnitLabel()}</span>
          <strong>{formatNumber(totals.movementInTotal)}</strong>
        </div>

        <div className="summary-card">
          <span>Total OUT {getUnitLabel()}</span>
          <strong>{formatNumber(totals.movementOutTotal)}</strong>
        </div>

        <div className="summary-card">
          <span>{totals.closingColumnLabel}</span>
          <strong>{formatNumber(totals.finalClosing)}</strong>
        </div>

        <div className="summary-card">
          <span>{totals.lossGainColumnLabel}</span>
          <strong className={getNumberClass(totals.lossGainTotal)}>
            {formatNumber(totals.lossGainTotal)}
          </strong>
        </div>

        <div className="summary-card">
          <span>Unit</span>
          <strong>{getUnitLabel()}</strong>
        </div>
      </div>

      <div className="print-report-header">
        {profile && (
          <div className="print-company-block">
            {profile.logoUrl ? (
              <img src={profile.logoUrl} alt={`${profile.companyName} Logo`} className="print-company-logo" />
            ) : (
              <div className="print-logo-placeholder">{profile.logoText || 'LOGO'}</div>
            )}
            <div>
              <h1>{profile.companyName}</h1>
              <p>{profile.systemName}</p>
              <p>{profile.reportSubtitle || 'Material Balance Report'}</p>
            </div>
          </div>
        )}

        <h2>Material Balance Report</h2>

        <div className="print-report-meta">
          <span>
            <strong>Template:</strong> {template?.templateName || '-'}
          </span>

          <span>
            <strong>Location:</strong> {filters.locationCode || '-'}
          </span>

          <span>
            <strong>Tank:</strong> {filters.tankAssetCode || 'All Tanks'}
          </span>

          <span>
            <strong>Status:</strong> {filters.status === '' ? 'All Statuses' : filters.status || '-'}
          </span>

          <span>
            <strong>Unit:</strong> {getUnitLabel()}
          </span>

          <span>
            <strong>Accounting Date:</strong> {filters.dateFrom || '-'} to{' '}
            {filters.dateTo || '-'}
          </span>

          <span>
            <strong>Printed:</strong> {new Date().toLocaleString()}
          </span>
        </div>

        <div className="print-summary-grid">
          <div>
            <span>Total IN {getUnitLabel()}</span>
            <strong>{formatNumber(totals.movementInTotal)}</strong>
          </div>

          <div>
            <span>Total OUT {getUnitLabel()}</span>
            <strong>{formatNumber(totals.movementOutTotal)}</strong>
          </div>

          <div>
            <span>{totals.closingColumnLabel}</span>
            <strong>{formatNumber(totals.finalClosing)}</strong>
          </div>

          <div>
            <span>{totals.lossGainColumnLabel}</span>
            <strong>{formatNumber(totals.lossGainTotal)}</strong>
          </div>
        </div>
      </div>

      <div className="section-title">
        <h3>Material Balance Details</h3>
        <p>
          Columns are generated from the active Material Balance Template.
          Internal Transfer / ITT columns can be shown but excluded from Book
          Closing based on configuration.
        </p>
      </div>

      <DataTableToolbar
        filters={rowsFilters}
        columns={rowsFilters.columns}
        exportFileName="material-balance-report"
        exportTitle="Material Balance Report"
      />

      <table>
        <thead>
          <tr>
            <th>Accounting Date</th>
            <th>Location</th>
            <th>Tank</th>
            <th>Product</th>

            {sortedColumns.map((column) => (
              <th key={column.columnKey}>
                {column.columnLabel}
                <div className="muted-table-text">{getUnitLabel()}</div>
              </th>
            ))}

            <th>Rows</th>
            <th>Last Ticket</th>
          </tr>
        </thead>

        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={6 + sortedColumns.length}
                className="empty-table"
              >
                No Material Balance rows found.
              </td>
            </tr>
          ) : (
            visibleRows.map((row, index) => (
              <tr
                key={`${row.accountingDate}-${row.tankAssetCode || 'ALL'}-${index}`}
              >
                <td>{formatCalendarDate(row.accountingDate)}</td>
                <td>
                  {row.locationName} ({row.locationCode})
                </td>
                <td>
                  {row.tankAssetName || 'All Tanks'}
                  {row.tankAssetCode ? ` (${row.tankAssetCode})` : ''}
                </td>
                <td>{row.productName || '-'}</td>

                {sortedColumns.map((column) => {
                  const value = Number(row.values?.[column.columnKey] || 0)

                  return (
                    <td
                      key={column.columnKey}
                      className={
                        column.columnType === 'LOSS_GAIN'
                          ? getNumberClass(value)
                          : ''
                      }
                    >
                      {formatNumber(value)}
                    </td>
                  )
                })}

                <td>{row.rowsCount}</td>
                <td>{row.lastTicketNumber || '-'}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <PaginationControls
        currentPage={currentPage}
        totalRows={rowsFilters.filteredRows.length}
        onPageChange={setCurrentPage}
      />

      <div className="info-box">
        Material Balance is calculated from approved Tank Stock Ledger rows and
        the active Material Balance Template for the selected location.
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

export default MaterialBalanceReport
