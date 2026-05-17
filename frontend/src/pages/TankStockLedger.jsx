import { useEffect, useMemo, useState } from 'react'
import {
  getTankStockLedger,
  getTankStockLedgerSummary,
} from '../api/tankStockLedgerApi'

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
  const [loading, setLoading] = useState(false)

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

  const loadLedger = async (activeFilters = filters) => {
    try {
      setLoading(true)

      const [ledgerData, summaryData] = await Promise.all([
        getTankStockLedger(activeFilters),
        getTankStockLedgerSummary(activeFilters),
      ])

      setLedgerRows(ledgerData)
      setSummaryRows(summaryData)
    } catch (error) {
      alert(error.message)
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

  return (
    <div>
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
          <label>Date From</label>
          <input
            name="dateFrom"
            type="date"
            value={filters.dateFrom}
            onChange={handleFilterChange}
            disabled={loading}
          />
        </div>

        <div>
          <label>Date To</label>
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
          <span>Opening NSV</span>
          <strong>{formatNumber(totals.openingNsvBbl)}</strong>
        </div>

        <div className="summary-card">
          <span>Total In NSV</span>
          <strong>{formatNumber(totals.totalInNsvBbl)}</strong>
        </div>

        <div className="summary-card">
          <span>Total Out NSV</span>
          <strong>{formatNumber(totals.totalOutNsvBbl)}</strong>
        </div>

        <div className="summary-card">
          <span>Closing NSV</span>
          <strong>{formatNumber(totals.closingNsvBbl)}</strong>
        </div>

        <div className="summary-card">
          <span>Closing MT</span>
          <strong>{formatNumber(totals.closingMt)}</strong>
        </div>
      </div>

      <div className="section-title">
        <h3>Stock Summary</h3>
        <p>
          Grouped by Location, Tank Asset, and Product. Closing values come from
          the latest running balance in the selected period.
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
            summaryRows.map((row, index) => (
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
            <th>Date</th>
            <th>Ticket</th>
            <th>Location</th>
            <th>Tank</th>
            <th>Product</th>
            <th>Operation</th>
            <th>Sign</th>
            <th>Movement NSV</th>
            <th>Running NSV</th>
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
              <td colSpan="14" className="empty-table">
                No Tank Stock Ledger rows found.
              </td>
            </tr>
          ) : (
            ledgerRows.map((row) => (
              <tr key={row.id}>
                <td>{row.operationDate}</td>
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
                  <span className={`status-badge ${row.status.toLowerCase()}`}>
                    {row.status}
                  </span>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <div className="info-box">
        Ledger rule: SET declares the balance, IN increases stock, OUT decreases
        stock, and NEUTRAL keeps the balance unchanged.
      </div>
    </div>
  )
}

export default TankStockLedger