import { useEffect, useMemo, useState } from 'react'
import { getTankerTransactionReport } from '../api/tankerTransactionReportApi'
import PaginationControls, {
  paginateRows,
} from '../components/common/PaginationControls'

const formatNumber = (value, decimals = 3) => {
  const numericValue = Number(value || 0)

  if (Number.isNaN(numericValue)) {
    return Number(0).toFixed(decimals)
  }

  return numericValue.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

const formatOptionalNumber = (value, decimals = 3) => {
  if (value === null || value === undefined || value === '') {
    return ''
  }

  return formatNumber(value, decimals)
}

const escapeCsvValue = (value) => {
  const text = String(value ?? '')

  if (text.includes(',') || text.includes('"') || text.includes('\n')) {
    return `"${text.replaceAll('"', '""')}"`
  }

  return text
}

const reportColumns = [
  { key: 'operationDate', label: 'Date' },
  { key: 'ticketNumber', label: 'Ticket No' },
  { key: 'operationNumber', label: 'Operation No' },
  { key: 'locationCode', label: 'Location' },
  { key: 'assetName', label: 'Tanker' },
  { key: 'convoyNumber', label: 'Convoy No' },
  { key: 'primeMoverNumber', label: 'Prime Mover' },
  { key: 'chassisNumber', label: 'Chassis No' },
  { key: 'cargo', label: 'Cargo' },
  { key: 'destination', label: 'Destination' },
  { key: 'loadingBay', label: 'Loading Bay' },
  { key: 'compartment', label: 'Compartment' },
  { key: 'totalDipCm', label: 'Total Dip cm', decimals: 2 },
  { key: 'waterDipCm', label: 'Water Dip cm', decimals: 2 },
  { key: 'bswPercent', label: 'BS&W %', decimals: 3 },
  { key: 'govBbl', label: 'GOV bbl', decimals: 3 },
  { key: 'gsvBbl', label: 'GSV bbl', decimals: 3 },
  { key: 'nsvBbl', label: 'NSV bbl', decimals: 3 },
  { key: 'lt', label: 'LT', decimals: 3 },
  { key: 'mt', label: 'MT', decimals: 3 },
  { key: 'status', label: 'Status' },
  { key: 'createdBy', label: 'Created By' },
]

const getCellValue = (row, column) => {
  const value = row[column.key]

  if (column.decimals !== undefined) {
    return formatNumber(value, column.decimals)
  }

  return value ?? ''
}

function TankerTransactionReport({ locations = [], assets = [] }) {
  const today = new Date().toISOString().slice(0, 10)

  const [filters, setFilters] = useState({
    date_from: today,
    date_to: today,
    location_code: '',
    asset_code: '',
    convoy_number: '',
    status: '',
    search: '',
  })

  const [rows, setRows] = useState([])
  const [totals, setTotals] = useState(null)
  const [selectedRow, setSelectedRow] = useState(null)
  const [loading, setLoading] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [successMsg, setSuccessMsg] = useState('')
  const [errorMsg, setErrorMsg] = useState('')

  const activeLocations = locations.filter((item) => item.status === 'Active')
  const activeAssets = assets.filter((item) => item.status === 'Active')

  const tankerAssets = useMemo(() => {
    return activeAssets.filter((asset) => {
      const assetTypeText = String(asset.assetTypeCode || '').toLowerCase()
      const assetNameText = String(asset.assetName || '').toLowerCase()

      return (
        assetTypeText.includes('tanker') ||
        assetTypeText.includes('truck') ||
        assetNameText.includes('tanker') ||
        assetNameText.includes('truck')
      )
    })
  }, [activeAssets])

  const loadReport = async () => {
    try {
      setLoading(true)

      const report = await getTankerTransactionReport(filters)

      setRows(report.rows)
      setTotals(report.totals)
      setSelectedRow(null)
      setCurrentPage(1)
    } catch (error) {
      console.error(error)
      setErrorMsg(error.message || 'Unable to load Tanker Transaction Report')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadReport()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleFilterChange = (e) => {
    const { name, value } = e.target

    setFilters((current) => ({
      ...current,
      [name]: value,
    }))
  }

  const handleClearFilters = () => {
    setFilters({
      date_from: '',
      date_to: '',
      location_code: '',
      asset_code: '',
      convoy_number: '',
      status: '',
      search: '',
    })
    setCurrentPage(1)
    setSelectedRow(null)
  }

  const exportRows = rows.map((row) => {
    const output = {}

    reportColumns.forEach((column) => {
      output[column.label] = getCellValue(row, column)
    })

    return output
  })

  const handleExportCsv = () => {
    const headers = reportColumns.map((column) => column.label)

    const csvLines = [
      headers.map(escapeCsvValue).join(','),
      ...exportRows.map((row) =>
        headers.map((header) => escapeCsvValue(row[header])).join(',')
      ),
    ]

    const blob = new Blob([csvLines.join('\n')], {
      type: 'text/csv;charset=utf-8;',
    })

    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')

    link.href = url
    link.download = 'tanker_transaction_report.csv'
    link.click()

    URL.revokeObjectURL(url)
  }

  const handleExportExcel = () => {
    const headers = reportColumns.map((column) => column.label)

    const tableRows = [
      `<tr>${headers.map((header) => `<th>${header}</th>`).join('')}</tr>`,
      ...exportRows.map((row) => {
        return `<tr>${headers
          .map((header) => `<td>${String(row[header] ?? '')}</td>`)
          .join('')}</tr>`
      }),
    ]

    const html = `
      <html>
        <head>
          <meta charset="UTF-8" />
        </head>
        <body>
          <h2>Tanker Transaction Report</h2>
          <table border="1">
            ${tableRows.join('')}
          </table>
        </body>
      </html>
    `

    const blob = new Blob([html], {
      type: 'application/vnd.ms-excel;charset=utf-8;',
    })

    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')

    link.href = url
    link.download = 'tanker_transaction_report.xls'
    link.click()

    URL.revokeObjectURL(url)
  }

  const handlePrint = () => {
    window.print()
  }

  const visibleRows = paginateRows(rows, currentPage)

  return (
    <div>
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
          <h2>Tanker Transaction Report</h2>
          <p>
            View road tanker loading / receipt entries saved through Operation
            Entry tanker payload.
          </p>
        </div>

        <span className="record-count">
          {totals ? totals.rowsCount : rows.length} Rows
        </span>
      </div>

      <div className="report-filter-panel no-print">
        <div>
          <label>Date From</label>
          <input
            name="date_from"
            type="date"
            value={filters.date_from}
            onChange={handleFilterChange}
          />
        </div>

        <div>
          <label>Date To</label>
          <input
            name="date_to"
            type="date"
            value={filters.date_to}
            onChange={handleFilterChange}
          />
        </div>

        <div>
          <label>Location</label>
          <select
            name="location_code"
            value={filters.location_code}
            onChange={handleFilterChange}
          >
            <option value="">All Locations</option>

            {activeLocations.map((location) => (
              <option key={location.locationCode} value={location.locationCode}>
                {location.locationName} ({location.locationCode})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label>Tanker Asset</label>
          <select
            name="asset_code"
            value={filters.asset_code}
            onChange={handleFilterChange}
          >
            <option value="">All Tankers</option>

            {(tankerAssets.length > 0 ? tankerAssets : activeAssets).map(
              (asset) => (
                <option key={asset.assetCode} value={asset.assetCode}>
                  {asset.assetName} ({asset.assetCode})
                </option>
              )
            )}
          </select>
        </div>

        <div>
          <label>Convoy Number</label>
          <input
            name="convoy_number"
            type="text"
            value={filters.convoy_number}
            onChange={handleFilterChange}
            placeholder="Search convoy"
          />
        </div>

        <div>
          <label>Status</label>
          <select
            name="status"
            value={filters.status}
            onChange={handleFilterChange}
          >
            <option value="">All</option>
            <option>Draft</option>
            <option>Submitted</option>
            <option>Approved</option>
            <option>Rejected</option>
            <option>Cancelled</option>
          </select>
        </div>

        <div className="full-width-field">
          <label>Search</label>
          <input
            name="search"
            type="text"
            value={filters.search}
            onChange={handleFilterChange}
            placeholder="Ticket, tanker, destination, cargo, prime mover, chassis..."
          />
        </div>

        <div className="report-filter-actions">
          <button type="button" onClick={loadReport} disabled={loading}>
            {loading ? 'Loading...' : 'Load Report'}
          </button>

          <button type="button" onClick={handleClearFilters}>
            Clear
          </button>
        </div>
      </div>

      <div className="report-actions no-print">
        <button type="button" onClick={handleExportCsv} disabled={rows.length === 0}>
          Export CSV
        </button>

        <button
          type="button"
          onClick={handleExportExcel}
          disabled={rows.length === 0}
        >
          Export Excel
        </button>

        <button type="button" onClick={handlePrint} disabled={rows.length === 0}>
          Print
        </button>
      </div>

      {totals && (
        <div className="report-summary-grid">
          <div className="report-summary-card">
            <span>Total GOV</span>
            <strong>{formatNumber(totals.totalGovBbl, 3)} bbl</strong>
          </div>

          <div className="report-summary-card">
            <span>Total GSV</span>
            <strong>{formatNumber(totals.totalGsvBbl, 3)} bbl</strong>
          </div>

          <div className="report-summary-card">
            <span>Total NSV</span>
            <strong>{formatNumber(totals.totalNsvBbl, 3)} bbl</strong>
          </div>

          <div className="report-summary-card">
            <span>Total LT</span>
            <strong>{formatNumber(totals.totalLt, 3)}</strong>
          </div>

          <div className="report-summary-card">
            <span>Total MT</span>
            <strong>{formatNumber(totals.totalMt, 3)}</strong>
          </div>
        </div>
      )}

      <div className="section-title">
        <h3>Saved Tanker Transactions</h3>
        <p>
          Click View to inspect dip, quality, seal and calculated quantity
          details.
        </p>
      </div>

      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Ticket</th>
            <th>Location</th>
            <th>Tanker</th>
            <th>Convoy</th>
            <th>Cargo</th>
            <th>Destination</th>
            <th>GOV</th>
            <th>GSV</th>
            <th>NSV</th>
            <th>LT</th>
            <th>MT</th>
            <th>Status</th>
            <th className="no-print">Action</th>
          </tr>
        </thead>

        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan="14" className="empty-table">
                No tanker transactions found for the selected filters.
              </td>
            </tr>
          ) : (
            visibleRows.map((row) => (
              <tr key={row.transactionId}>
                <td>{row.operationDate}</td>
                <td>{row.ticketNumber || row.operationNumber}</td>
                <td>{row.locationName || row.locationCode}</td>
                <td>{row.tankerName || row.assetName}</td>
                <td>{row.convoyNumber}</td>
                <td>{row.cargo}</td>
                <td>{row.destination}</td>
                <td className="number-cell">{formatNumber(row.govBbl, 3)}</td>
                <td className="number-cell">{formatNumber(row.gsvBbl, 3)}</td>
                <td className="number-cell">{formatNumber(row.nsvBbl, 3)}</td>
                <td className="number-cell">{formatNumber(row.lt, 3)}</td>
                <td className="number-cell">{formatNumber(row.mt, 3)}</td>
                <td>
                  <span
                    className={`status-badge ${String(row.status || '').toLowerCase()}`}
                  >
                    {row.status}
                  </span>
                </td>
                <td className="no-print">
                  <button type="button" onClick={() => setSelectedRow(row)}>
                    View
                  </button>
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

      {selectedRow && (
        <div className="report-detail-panel no-print">
          <div className="report-detail-header">
            <div>
              <h3>
                Tanker Detail —{' '}
                {selectedRow.ticketNumber || selectedRow.operationNumber}
              </h3>
              <p>
                {selectedRow.tankerName || selectedRow.assetName} / Convoy{' '}
                {selectedRow.convoyNumber || 'N/A'}
              </p>
            </div>

            <button type="button" onClick={() => setSelectedRow(null)}>
              Close
            </button>
          </div>

          <div className="operation-layout-section-grid">
            <div className="operation-layout-section-card">
              <h4>Tanker Details</h4>
              <p>Tanker: {selectedRow.tankerName || selectedRow.assetName}</p>
              <p>Prime Mover: {selectedRow.primeMoverNumber || 'N/A'}</p>
              <p>Chassis: {selectedRow.chassisNumber || 'N/A'}</p>
              <p>Compartment: {selectedRow.compartment || 'N/A'}</p>
            </div>

            <div className="operation-layout-section-card">
              <h4>Dip / Water</h4>
              <p>Total Dip: {formatNumber(selectedRow.totalDipCm, 2)} cm</p>
              <p>Water Dip: {formatNumber(selectedRow.waterDipCm, 2)} cm</p>
              <p>BS&W: {formatNumber(selectedRow.bswPercent, 3)} %</p>
            </div>

            <div className="operation-layout-section-card">
              <h4>Quality</h4>
              <p>
                Tank Temp: {formatOptionalNumber(selectedRow.tankTemperature, 2)}{' '}
                {selectedRow.tankTemperatureUnit}
              </p>
              <p>
                Sample Temp:{' '}
                {formatOptionalNumber(selectedRow.sampleTemperature, 2)}{' '}
                {selectedRow.sampleTemperatureUnit}
              </p>
              <p>Observed API: {formatOptionalNumber(selectedRow.observedApi, 3)}</p>
              <p>
                Observed Density:{' '}
                {formatOptionalNumber(selectedRow.observedDensity, 3)}
              </p>
              <p>API @60: {formatOptionalNumber(selectedRow.api60, 3)}</p>
              <p>VCF: {formatOptionalNumber(selectedRow.vcf, 5)}</p>
            </div>

            <div className="operation-layout-section-card">
              <h4>Quantity</h4>
              <p>TOV: {formatNumber(selectedRow.tovBbl, 3)} bbl</p>
              <p>Free Water: {formatNumber(selectedRow.freeWaterBbl, 3)} bbl</p>
              <p>GOV: {formatNumber(selectedRow.govBbl, 3)} bbl</p>
              <p>GSV: {formatNumber(selectedRow.gsvBbl, 3)} bbl</p>
              <p>NSV: {formatNumber(selectedRow.nsvBbl, 3)} bbl</p>
              <p>LT: {formatNumber(selectedRow.lt, 3)}</p>
              <p>MT: {formatNumber(selectedRow.mt, 3)}</p>
            </div>

            <div className="operation-layout-section-card">
              <h4>Seal Details</h4>
              <p>C1: {selectedRow.sealC1 || 'N/A'}</p>
              <p>C2: {selectedRow.sealC2 || 'N/A'}</p>
              <p>M1: {selectedRow.sealM1 || 'N/A'}</p>
              <p>M2: {selectedRow.sealM2 || 'N/A'}</p>
            </div>

            <div className="operation-layout-section-card">
              <h4>Other Details</h4>
              <p>Destination: {selectedRow.destination || 'N/A'}</p>
              <p>Loading Bay: {selectedRow.loadingBay || 'N/A'}</p>
              <p>Created By: {selectedRow.createdBy || 'N/A'}</p>
              <p>Remarks: {selectedRow.remarks || 'N/A'}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default TankerTransactionReport
