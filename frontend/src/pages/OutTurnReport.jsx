import { useEffect, useMemo, useState } from 'react'
import { getOutTurnReport } from '../api/outTurnReportApi'
import PaginationControls, {
  paginateRows,
} from '../components/common/PaginationControls'

function OutTurnReport({ locations, assets }) {
  const emptyFilters = {
    locationCode: '',
    tankAssetCode: '',
    productName: '',
    dateFrom: '',
    dateTo: '',
    status: 'Active',
  }

  const [filters, setFilters] = useState(emptyFilters)
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [successMsg, setSuccessMsg] = useState('')
  const [errorMsg, setErrorMsg] = useState('')

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

  const totals = useMemo(() => {
    return rows.reduce(
      (accumulator, row) => {
        accumulator.totalReceiptNsvBbl += row.netReceiptNsvBbl
        accumulator.totalDispatchNsvBbl += row.netDispatchNsvBbl
        accumulator.netMovementNsvBbl += row.signedNetMovementNsvBbl

        accumulator.totalReceiptLt += row.netReceiptLt
        accumulator.totalDispatchLt += row.netDispatchLt
        accumulator.netMovementLt += row.signedNetMovementLt

        accumulator.totalReceiptMt += row.netReceiptMt
        accumulator.totalDispatchMt += row.netDispatchMt
        accumulator.netMovementMt += row.signedNetMovementMt

        accumulator.lastStockNsvBbl = row.stockAfterNsvBbl
        accumulator.lastStockLt = row.stockAfterLt
        accumulator.lastStockMt = row.stockAfterMt

        return accumulator
      },
      {
        totalReceiptNsvBbl: 0,
        totalDispatchNsvBbl: 0,
        netMovementNsvBbl: 0,
        totalReceiptLt: 0,
        totalDispatchLt: 0,
        netMovementLt: 0,
        totalReceiptMt: 0,
        totalDispatchMt: 0,
        netMovementMt: 0,
        lastStockNsvBbl: 0,
        lastStockLt: 0,
        lastStockMt: 0,
      }
    )
  }, [rows])

  const loadReport = async (activeFilters = filters) => {
    try {
      setLoading(true)

      const data = await getOutTurnReport(activeFilters)
      setRows(data)
      setCurrentPage(1)
    } catch (error) {
      setErrorMsg(error.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadReport(emptyFilters)
  }, [])

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

  const formatNumber = (value, decimals = 3) => {
    return Number(value || 0).toLocaleString(undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })
  }

  const formatDateTime = (value) => {
    if (!value) {
      return '-'
    }

    const dateValue = new Date(value)

    if (Number.isNaN(dateValue.getTime())) {
      return value
    }

    return dateValue.toLocaleString()
  }

  const getMovementClass = (value) => {
    if (Number(value || 0) > 0) {
      return 'positive-number'
    }

    if (Number(value || 0) < 0) {
      return 'negative-number'
    }

    return ''
  }

  const visibleRows = paginateRows(rows, currentPage)

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
      setErrorMsg('No OTR rows available to export')
      return
    }

    const headers = [
      'Accounting Date',
      'Operation Date/Time',
      'Ticket Number',
      'Operation Number',
      'Location Code',
      'Location Name',
      'Tank Asset Code',
      'Tank Asset Name',
      'Product',
      'Operation Label',
      'Operation Category',
      'Operation Sign',
      'Previous NSV',
      'Stock After NSV',
      'Net Receipt NSV',
      'Net Dispatch NSV',
      'Signed Net NSV',
      'Stock After LT',
      'Stock After MT',
      'Status',
    ]

    const dataRows = rows.map((row) => [
      row.accountingDate,
      formatDateTime(row.operationDatetime),
      row.ticketNumber,
      row.operationNumber,
      row.locationCode,
      row.locationName,
      row.tankAssetCode,
      row.tankAssetName,
      row.productName || '',
      row.tankOperationLabel,
      row.tankOperationCategory,
      row.tankOperationSign,
      formatNumber(row.previousStockNsvBbl),
      formatNumber(row.stockAfterNsvBbl),
      formatNumber(row.netReceiptNsvBbl),
      formatNumber(row.netDispatchNsvBbl),
      formatNumber(row.signedNetMovementNsvBbl),
      formatNumber(row.stockAfterLt),
      formatNumber(row.stockAfterMt),
      row.status,
    ])

    downloadCsv('out-turn-report.csv', headers, dataRows)
  }

  const handlePrintReport = () => {
    if (rows.length === 0) {
      setErrorMsg('No OTR rows available to print')
      return
    }

    window.print()
  }

  return (
    <div className="out-turn-report-page">
      {successMsg && (
        <div className="success-box" onClick={() => setSuccessMsg('')}>
          {successMsg}
        </div>
      )}
      {errorMsg && (
        <div className="error-box" onClick={() => setErrorMsg('')}>
          {errorMsg}
        </div>
      )}
      <div className="page-title">
        <div>
          <h2>Out-Turn Report</h2>
          <p>
            Chronological approved tank tickets with previous stock, stock after
            operation, and net receipt/dispatch values.
          </p>
        </div>

        <span className="record-count">{rows.length} OTR Rows</span>
      </div>

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
      <div className="summary-card-grid">
        <div className="summary-card">
          <span>Total Receipt NSV</span>
          <strong>{formatNumber(totals.totalReceiptNsvBbl)}</strong>
        </div>

        <div className="summary-card">
          <span>Total Dispatch NSV</span>
          <strong>{formatNumber(totals.totalDispatchNsvBbl)}</strong>
        </div>

        <div className="summary-card">
          <span>Net Movement NSV</span>
          <strong className={getMovementClass(totals.netMovementNsvBbl)}>
            {formatNumber(totals.netMovementNsvBbl)}
          </strong>
        </div>

        <div className="summary-card">
          <span>Latest Stock NSV</span>
          <strong>{formatNumber(totals.lastStockNsvBbl)}</strong>
        </div>

        <div className="summary-card">
          <span>Latest Stock MT</span>
          <strong>{formatNumber(totals.lastStockMt)}</strong>
        </div>
      </div>

      <div className="print-report-header">
        <h2>Out-Turn Report</h2>

        <div className="print-report-meta">
          <span>
            <strong>Location:</strong>{' '}
            {filters.locationCode || 'All Locations'}
          </span>

          <span>
            <strong>Tank:</strong> {filters.tankAssetCode || 'All Tanks'}
          </span>

          <span>
            <strong>Product:</strong> {filters.productName || 'All Products'}
          </span>

          <span>
            <strong>Accounting Date:</strong> {filters.dateFrom || '-'} to{' '}
            {filters.dateTo || '-'}
          </span>

          <span>
            <strong>Status:</strong> {filters.status || 'All Statuses'}
          </span>

          <span>
            <strong>Printed:</strong> {new Date().toLocaleString()}
          </span>
        </div>

        <div className="print-summary-grid">
          <div>
            <span>Total Receipt NSV</span>
            <strong>{formatNumber(totals.totalReceiptNsvBbl)}</strong>
          </div>

          <div>
            <span>Total Dispatch NSV</span>
            <strong>{formatNumber(totals.totalDispatchNsvBbl)}</strong>
          </div>

          <div>
            <span>Net Movement NSV</span>
            <strong>{formatNumber(totals.netMovementNsvBbl)}</strong>
          </div>

          <div>
            <span>Latest Stock NSV</span>
            <strong>{formatNumber(totals.lastStockNsvBbl)}</strong>
          </div>

          <div>
            <span>Latest Stock MT</span>
            <strong>{formatNumber(totals.lastStockMt)}</strong>
          </div>
        </div>
      </div>

      <div className="section-title">
        <h3>OTR Details</h3>
        <p>
          Net values are calculated from the difference between previous stock
          and stock after operation for the same tank/product sequence.
        </p>
      </div>

      <table>
        <thead>
          <tr>
            <th>Accounting Date</th>
            <th>Operation Date/Time</th>
            <th>Ticket</th>
            <th>Location</th>
            <th>Tank</th>
            <th>Product</th>
            <th>Operation</th>
            <th>Previous NSV</th>
            <th>Stock After NSV</th>
            <th>Net Receipt NSV</th>
            <th>Net Dispatch NSV</th>
            <th>Signed Net NSV</th>
            <th>Stock After LT</th>
            <th>Stock After MT</th>
            <th>Status</th>
          </tr>
        </thead>

        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan="15" className="empty-table">
                No Out-Turn Report rows found.
              </td>
            </tr>
          ) : (
            visibleRows.map((row) => (
              <tr key={row.ledgerId}>
                <td>{row.accountingDate || '-'}</td>
                <td>{formatDateTime(row.operationDatetime)}</td>
                <td>
                  <strong>{row.ticketNumber}</strong>
                  <div className="muted-table-text">{row.operationNumber}</div>
                </td>
                <td>
                  {row.locationName} ({row.locationCode})
                </td>
                <td>
                  {row.tankAssetName} ({row.tankAssetCode})
                </td>
                <td>{row.productName || '-'}</td>
                <td>
                  {row.tankOperationLabel}
                  <div className="muted-table-text">
                    {row.tankOperationCategory} / {row.tankOperationSign}
                  </div>
                </td>
                <td>{formatNumber(row.previousStockNsvBbl)}</td>
                <td>{formatNumber(row.stockAfterNsvBbl)}</td>
                <td>{formatNumber(row.netReceiptNsvBbl)}</td>
                <td>{formatNumber(row.netDispatchNsvBbl)}</td>
                <td className={getMovementClass(row.signedNetMovementNsvBbl)}>
                  {formatNumber(row.signedNetMovementNsvBbl)}
                </td>
                <td>{formatNumber(row.stockAfterLt)}</td>
                <td>{formatNumber(row.stockAfterMt)}</td>
                <td>
                  <span className={`status-badge ${row.status.toLowerCase()}`}>
                    {row.status}
                  </span>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <PaginationControls
        currentPage={currentPage}
        totalRows={rows.length}
        onPageChange={setCurrentPage}
      />

      <div className="info-box">
        OTR rule: Tank Gauging values are stock snapshots after the operation.
        Receipt and dispatch quantities are calculated by comparing the current
        stock snapshot with the previous chronological stock snapshot for the
        same tank/product.
      </div>
    </div>
  )
}

export default OutTurnReport
