import { useEffect, useMemo, useState } from 'react'
import {
  getTankStockLedger,
  getTankStockLedgerDailySummary,
  getTankStockLedgerSummary,
} from '../api/tankStockLedgerApi'
import PaginationControls, {
  paginateRows,
} from '../components/common/PaginationControls'

function TankStockLedger({ locations, assets }) {
  const emptyFilters = {
    locationCode: '',
    tankAssetCode: '',
    productName: '',
    dateFrom: '',
    dateTo: '',
    status: 'Active',
  }

  const [filters, setFilters] = useState(emptyFilters)

  const [ledgerRows, setLedgerRows] = useState([])
  const [summaryRows, setSummaryRows] = useState([])
  const [dailySummaryRows, setDailySummaryRows] = useState([])
  const [activeView, setActiveView] = useState('daily-summary')
  const [loading, setLoading] = useState(false)
  const [dailySummaryPage, setDailySummaryPage] = useState(1)
  const [stockSummaryPage, setStockSummaryPage] = useState(1)
  const [ledgerDetailsPage, setLedgerDetailsPage] = useState(1)
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
    return summaryRows.reduce(
      (accumulator, row) => {
        accumulator.openingNsvBbl += row.openingNsvBbl
        accumulator.totalInNsvBbl += row.totalInNsvBbl
        accumulator.totalOutNsvBbl += row.totalOutNsvBbl
        accumulator.closingNsvBbl += row.closingNsvBbl

        accumulator.openingLt += row.openingLt
        accumulator.totalInLt += row.totalInLt
        accumulator.totalOutLt += row.totalOutLt
        accumulator.closingLt += row.closingLt

        accumulator.openingMt += row.openingMt
        accumulator.totalInMt += row.totalInMt
        accumulator.totalOutMt += row.totalOutMt
        accumulator.closingMt += row.closingMt

        return accumulator
      },
      {
        openingNsvBbl: 0,
        totalInNsvBbl: 0,
        totalOutNsvBbl: 0,
        closingNsvBbl: 0,
        openingLt: 0,
        totalInLt: 0,
        totalOutLt: 0,
        closingLt: 0,
        openingMt: 0,
        totalInMt: 0,
        totalOutMt: 0,
        closingMt: 0,
      }
    )
  }, [summaryRows])

  const dailyTotals = useMemo(() => {
    return dailySummaryRows.reduce(
      (accumulator, row) => {
        accumulator.totalInNsvBbl += row.totalInNsvBbl
        accumulator.totalOutNsvBbl += row.totalOutNsvBbl
        accumulator.lossGainNsvBbl += row.lossGainNsvBbl

        accumulator.totalInLt += row.totalInLt
        accumulator.totalOutLt += row.totalOutLt
        accumulator.lossGainLt += row.lossGainLt

        accumulator.totalInMt += row.totalInMt
        accumulator.totalOutMt += row.totalOutMt
        accumulator.lossGainMt += row.lossGainMt

        accumulator.finalClosingNsvBbl = row.actualClosingNsvBbl
        accumulator.finalClosingLt = row.actualClosingLt
        accumulator.finalClosingMt = row.actualClosingMt

        return accumulator
      },
      {
        totalInNsvBbl: 0,
        totalOutNsvBbl: 0,
        lossGainNsvBbl: 0,
        totalInLt: 0,
        totalOutLt: 0,
        lossGainLt: 0,
        totalInMt: 0,
        totalOutMt: 0,
        lossGainMt: 0,
        finalClosingNsvBbl: 0,
        finalClosingLt: 0,
        finalClosingMt: 0,
      }
    )
  }, [dailySummaryRows])

  const loadLedger = async (activeFilters = filters) => {
    try {
      setLoading(true)

      const dailyFilters = {
        ...activeFilters,
      }

      if (!dailyFilters.dateFrom || !dailyFilters.dateTo) {
        const today = new Date()
        const firstDay = new Date(today.getFullYear(), today.getMonth(), 1)

        dailyFilters.dateFrom = firstDay.toISOString().slice(0, 10)
        dailyFilters.dateTo = today.toISOString().slice(0, 10)
      }

      const [ledgerData, summaryData, dailySummaryData] = await Promise.all([
        getTankStockLedger(activeFilters),
        getTankStockLedgerSummary(activeFilters),
        getTankStockLedgerDailySummary(dailyFilters),
      ])

      setLedgerRows(ledgerData)
      setSummaryRows(summaryData)
      setDailySummaryRows(dailySummaryData)
      setDailySummaryPage(1)
      setStockSummaryPage(1)
      setLedgerDetailsPage(1)
    } catch (error) {
      setErrorMsg(error.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadLedger(emptyFilters)
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
    await loadLedger(filters)
  }

  const handleClearFilters = async () => {
    setFilters(emptyFilters)
    await loadLedger(emptyFilters)
  }

  const formatNumber = (value, decimals = 3) => {
    return Number(value || 0).toLocaleString(undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })
  }

  const getMovementDisplay = (row) => {
    if (row.tankOperationSign === 'IN') {
      return `+${formatNumber(row.movementNsvBbl)}`
    }

    if (row.tankOperationSign === 'OUT') {
      return `-${formatNumber(row.movementNsvBbl)}`
    }

    return formatNumber(row.movementNsvBbl)
  }

  const visibleDailySummaryRows = paginateRows(
    dailySummaryRows,
    dailySummaryPage
  )
  const visibleSummaryRows = paginateRows(summaryRows, stockSummaryPage)
  const visibleLedgerRows = paginateRows(ledgerRows, ledgerDetailsPage)

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

  const handleExportDailySummaryCsv = () => {
    if (dailySummaryRows.length === 0) {
      setErrorMsg('No Daily Summary rows available to export')
      return
    }

    const headers = [
      'Accounting Date',
      'Location Code',
      'Location Name',
      'Tank Asset Code',
      'Tank Asset Name',
      'Product',
      'Opening NSV',
      'Total In NSV',
      'Total Out NSV',
      'Book Closing NSV',
      'Actual Closing NSV',
      'Loss Gain NSV',
      'Closing LT',
      'Closing MT',
      'Rows Count',
      'Last Ticket',
    ]

    const dataRows = dailySummaryRows.map((row) => [
      row.accountingDate,
      row.locationCode,
      row.locationName,
      row.tankAssetCode,
      row.tankAssetName,
      row.productName || '',
      formatNumber(row.openingNsvBbl),
      formatNumber(row.totalInNsvBbl),
      formatNumber(row.totalOutNsvBbl),
      formatNumber(row.bookClosingNsvBbl),
      formatNumber(row.actualClosingNsvBbl),
      formatNumber(row.lossGainNsvBbl),
      formatNumber(row.actualClosingLt),
      formatNumber(row.actualClosingMt),
      row.rowsCount,
      row.lastTicketNumber || '',
    ])

    downloadCsv('tank-stock-ledger-daily-summary.csv', headers, dataRows)
  }

  const handleExportStockSummaryCsv = () => {
    if (summaryRows.length === 0) {
      setErrorMsg('No Stock Summary rows available to export')
      return
    }

    const headers = [
      'Location Code',
      'Location Name',
      'Tank Asset Code',
      'Tank Asset Name',
      'Product',
      'Opening NSV',
      'Total In NSV',
      'Total Out NSV',
      'Closing NSV',
      'Closing LT',
      'Closing MT',
    ]

    const dataRows = summaryRows.map((row) => [
      row.locationCode,
      row.locationName,
      row.tankAssetCode,
      row.tankAssetName,
      row.productName || '',
      formatNumber(row.openingNsvBbl),
      formatNumber(row.totalInNsvBbl),
      formatNumber(row.totalOutNsvBbl),
      formatNumber(row.closingNsvBbl),
      formatNumber(row.closingLt),
      formatNumber(row.closingMt),
    ])

    downloadCsv('tank-stock-ledger-stock-summary.csv', headers, dataRows)
  }

  const handleExportLedgerDetailsCsv = () => {
    if (ledgerRows.length === 0) {
      setErrorMsg('No Ledger Detail rows available to export')
      return
    }

    const headers = [
      'Accounting Date',
      'Operation Date',
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
      'Movement NSV',
      'Running Balance NSV',
      'Movement LT',
      'Running Balance LT',
      'Movement MT',
      'Running Balance MT',
      'Status',
    ]

    const dataRows = ledgerRows.map((row) => [
      row.accountingDate || '',
      row.operationDate,
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
      formatNumber(row.movementNsvBbl),
      formatNumber(row.runningBalanceNsvBbl),
      formatNumber(row.movementLt),
      formatNumber(row.runningBalanceLt),
      formatNumber(row.movementMt),
      formatNumber(row.runningBalanceMt),
      row.status,
    ])

    downloadCsv('tank-stock-ledger-details.csv', headers, dataRows)
  }

  const handleExportCurrentViewCsv = () => {
    if (activeView === 'daily-summary') {
      handleExportDailySummaryCsv()
      return
    }

    if (activeView === 'stock-summary') {
      handleExportStockSummaryCsv()
      return
    }

    if (activeView === 'ledger-details') {
      handleExportLedgerDetailsCsv()
    }
  }

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
          <h2>Tank Stock Ledger</h2>
          <p>
            View approved Tank Gauging stock movements, running balances, and
            stock summary.
          </p>
        </div>

        <span className="record-count">{ledgerRows.length} Ledger Rows</span>
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
      </form>

      <div className="summary-card-grid">
        <div className="summary-card">
          <span>Total In NSV</span>
          <strong>{formatNumber(dailyTotals.totalInNsvBbl)}</strong>
        </div>

        <div className="summary-card">
          <span>Total Out NSV</span>
          <strong>{formatNumber(dailyTotals.totalOutNsvBbl)}</strong>
        </div>

        <div className="summary-card">
          <span>Final Closing NSV</span>
          <strong>{formatNumber(dailyTotals.finalClosingNsvBbl)}</strong>
        </div>

        <div className="summary-card">
          <span>Loss / Gain NSV</span>
          <strong
            className={
              dailyTotals.lossGainNsvBbl >= 0
                ? 'positive-number'
                : 'negative-number'
            }
          >
            {formatNumber(dailyTotals.lossGainNsvBbl)}
          </strong>
        </div>

        <div className="summary-card">
          <span>Final Closing MT</span>
          <strong>{formatNumber(dailyTotals.finalClosingMt)}</strong>
        </div>
      </div>

      <div className="view-switcher">
        <button
          type="button"
          className={activeView === 'daily-summary' ? 'active-view-button' : ''}
          onClick={() => setActiveView('daily-summary')}
        >
          Daily Summary
        </button>

        <button
          type="button"
          className={activeView === 'stock-summary' ? 'active-view-button' : ''}
          onClick={() => setActiveView('stock-summary')}
        >
          Stock Summary
        </button>

        <button
          type="button"
          className={activeView === 'ledger-details' ? 'active-view-button' : ''}
          onClick={() => setActiveView('ledger-details')}
        >
          Ledger Details
        </button>

        <button
          type="button"
          className="export-view-button"
          onClick={handleExportCurrentViewCsv}
          disabled={loading}
        >
          Export Current View CSV
        </button>
      </div>

      {activeView === 'daily-summary' && (
        <>
          <div className="section-title">
            <h3>Daily Summary</h3>
            <p>
              Date-wise accounting summary. Closing stock is automatically taken
              from the latest approved tank entry of the accounting day. If no
              entry exists, previous closing is carried forward.
            </p>
          </div>

          <table>
            <thead>
              <tr>
                <th>Accounting Date</th>
                <th>Location</th>
                <th>Tank</th>
                <th>Product</th>
                <th>Opening NSV</th>
                <th>Total In NSV</th>
                <th>Total Out NSV</th>
                <th>Book Closing NSV</th>
                <th>Actual Closing NSV</th>
                <th>Loss / Gain NSV</th>
                <th>Closing LT</th>
                <th>Closing MT</th>
                <th>Rows</th>
                <th>Last Ticket</th>
              </tr>
            </thead>

            <tbody>
              {dailySummaryRows.length === 0 ? (
                <tr>
                  <td colSpan="14" className="empty-table">
                    No daily summary rows found.
                  </td>
                </tr>
              ) : (
                visibleDailySummaryRows.map((row, index) => (
                  <tr
                    key={`${row.accountingDate}-${row.tankAssetCode}-${index}`}
                  >
                    <td>{row.accountingDate}</td>
                    <td>
                      {row.locationName} ({row.locationCode})
                    </td>
                    <td>
                      {row.tankAssetName} ({row.tankAssetCode})
                    </td>
                    <td>{row.productName || '-'}</td>
                    <td>{formatNumber(row.openingNsvBbl)}</td>
                    <td>{formatNumber(row.totalInNsvBbl)}</td>
                    <td>{formatNumber(row.totalOutNsvBbl)}</td>
                    <td>{formatNumber(row.bookClosingNsvBbl)}</td>
                    <td>{formatNumber(row.actualClosingNsvBbl)}</td>
                    <td
                      className={
                        row.lossGainNsvBbl >= 0
                          ? 'positive-number'
                          : 'negative-number'
                      }
                    >
                      {formatNumber(row.lossGainNsvBbl)}
                    </td>
                    <td>{formatNumber(row.actualClosingLt)}</td>
                    <td>{formatNumber(row.actualClosingMt)}</td>
                    <td>{row.rowsCount}</td>
                    <td>{row.lastTicketNumber || '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          <PaginationControls
            currentPage={dailySummaryPage}
            totalRows={dailySummaryRows.length}
            onPageChange={setDailySummaryPage}
          />

          <div className="info-box">
            Daily Summary uses Accounting Date, not calendar midnight. It
            respects the configured location accounting day window, such as
            06:01 to 06:00 or 08:01 to 08:00.
          </div>
        </>
      )}

      {activeView === 'stock-summary' && (
        <>
          <div className="section-title">
            <h3>Stock Summary</h3>
            <p>
              Grouped by Location, Tank Asset, and Product. Closing values come
              from the latest running balance in the selected period.
            </p>
          </div>

          <table>
            <thead>
              <tr>
                <th>Location</th>
                <th>Tank</th>
                <th>Product</th>
                <th>Opening NSV</th>
                <th>Total In NSV</th>
                <th>Total Out NSV</th>
                <th>Closing NSV</th>
                <th>Closing LT</th>
                <th>Closing MT</th>
              </tr>
            </thead>

            <tbody>
              {summaryRows.length === 0 ? (
                <tr>
                  <td colSpan="9" className="empty-table">
                    No stock summary found.
                  </td>
                </tr>
              ) : (
                visibleSummaryRows.map((row, index) => (
                  <tr key={index}>
                    <td>
                      {row.locationName} ({row.locationCode})
                    </td>
                    <td>
                      {row.tankAssetName} ({row.tankAssetCode})
                    </td>
                    <td>{row.productName || '-'}</td>
                    <td>{formatNumber(row.openingNsvBbl)}</td>
                    <td>{formatNumber(row.totalInNsvBbl)}</td>
                    <td>{formatNumber(row.totalOutNsvBbl)}</td>
                    <td>{formatNumber(row.closingNsvBbl)}</td>
                    <td>{formatNumber(row.closingLt)}</td>
                    <td>{formatNumber(row.closingMt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          <PaginationControls
            currentPage={stockSummaryPage}
            totalRows={summaryRows.length}
            onPageChange={setStockSummaryPage}
          />

          <div className="info-box">
            Stock Summary groups the selected ledger period by location, tank,
            and product.
          </div>
        </>
      )}

      {activeView === 'ledger-details' && (
        <>
          <div className="section-title">
            <h3>Ledger Details</h3>
            <p>
              Each row is created automatically when a Tank Gauging ticket is
              approved.
            </p>
          </div>

          <table>
            <thead>
              <tr>
                <th>Accounting Date</th>
                <th>Operation Date</th>
                <th>Ticket</th>
                <th>Location</th>
                <th>Tank</th>
                <th>Product</th>
                <th>Operation</th>
                <th>Sign</th>
                <th>Movement NSV</th>
                <th>Stock / Running NSV</th>
                <th>Movement LT</th>
                <th>Running LT</th>
                <th>Movement MT</th>
                <th>Running MT</th>
                <th>Status</th>
              </tr>
            </thead>

            <tbody>
              {ledgerRows.length === 0 ? (
                <tr>
                  <td colSpan="15" className="empty-table">
                    No Tank Stock Ledger rows found.
                  </td>
                </tr>
              ) : (
                visibleLedgerRows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.accountingDate || '-'}</td>
                    <td>{row.operationDate}</td>
                    <td>
                      <strong>{row.ticketNumber}</strong>
                      <div className="muted-table-text">
                        {row.operationNumber}
                      </div>
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
                        {row.tankOperationCategory}
                      </div>
                    </td>
                    <td>
                      <span className="permission-badge">
                        {row.tankOperationSign}
                      </span>
                    </td>
                    <td>{getMovementDisplay(row)}</td>
                    <td>{formatNumber(row.runningBalanceNsvBbl)}</td>
                    <td>{formatNumber(row.movementLt)}</td>
                    <td>{formatNumber(row.runningBalanceLt)}</td>
                    <td>{formatNumber(row.movementMt)}</td>
                    <td>{formatNumber(row.runningBalanceMt)}</td>
                    <td>
                      <span
                        className={`status-badge ${row.status.toLowerCase()}`}
                      >
                        {row.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          <PaginationControls
            currentPage={ledgerDetailsPage}
            totalRows={ledgerRows.length}
            onPageChange={setLedgerDetailsPage}
          />

          <div className="info-box">
            Ledger rule: Tank Gauging calculated quantities are stock snapshots.
            Movement is calculated from previous stock and current stock for the
            same tank/product sequence.
          </div>
        </>
      )}
    </div>
  )
}

export default TankStockLedger
