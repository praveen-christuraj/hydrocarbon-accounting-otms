import { useEffect, useMemo, useState } from 'react'
import {
  getTankOperationSummary,
  getTankOperationSummaryColumns,
} from '../api/tankOperationSummaryApi'
import { getCompanyReportProfiles } from '../api/companyReportProfileApi'
import PaginationControls, {
  paginateRows,
} from '../components/common/PaginationControls'

function TankOperationSummary({ locations, assets }) {
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
  const [loading, setLoading] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [successMsg, setSuccessMsg] = useState('')
  const [errorMsg, setErrorMsg] = useState('')

  const [profile, setProfile] = useState(null)

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

  const loadReport = async (activeFilters = filters) => {
    try {
      setLoading(true)

      const [reportData, reportColumns, profiles] = await Promise.all([
        getTankOperationSummary(activeFilters),
        getTankOperationSummaryColumns(activeFilters),
        getCompanyReportProfiles(),
      ])

      const activeProfile = profiles.find((p) => p.status === 'Active') || profiles[0]
      setProfile(activeProfile)

      setRows(reportData.rows || [])
      setColumns(reportData.columns || reportColumns)
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

  const isDateColumn = (col) => {
    return (
      col.includes('date') ||
      col.includes('datetime') ||
      col === 'created_at' ||
      col === 'operation_date' ||
      col === 'accounting_date'
    )
  }

  const renderCellValue = (col, value) => {
    if (value === null || value === undefined || value === '') {
      return '-'
    }

    if (
      isNumericValue(value) &&
      (col.startsWith('calc_') || col.startsWith('input_') || col.includes('_nsv') || col.includes('_lt') || col.includes('_mt') || col.includes('_bbl'))
    ) {
      return formatNumber(value)
    }

    if (isDateColumn(col)) {
      return formatDateTime(value)
    }

    return value
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
      setErrorMsg('No Tank Operation Summary rows available to export')
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
          <span className="record-count">{rows.length} Ledger Rows</span>
          <button type="button" onClick={() => window.print()}>
            Print
          </button>
        </div>
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
          <label>Operation Date From</label>
          <input
            name="dateFrom"
            type="date"
            value={filters.dateFrom}
            onChange={handleFilterChange}
            disabled={loading}
          />
        </div>

        <div>
          <label>Operation Date To</label>
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

      <div className="section-title">
        <h3>Tank Operation Summary</h3>
        <p>
          Shows all tank gauging operation data extracted from JSON payloads.
          All JSON input and calculated fields are flattened as columns.
        </p>
      </div>

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
        totalRows={rows.length}
        onPageChange={setCurrentPage}
      />

      <div className="info-box">
        Tank Operation Summary displays all extracted fields from tank gauging payloads.
        Columns dynamically change based on available data in the JSON payloads.
        Only Approved transactions with Tank Gauging layout are included.
      </div>

      {profile && (
        <div className="print-only" style={{ marginTop: 20, fontSize: 11, color: '#555' }}>
          <p>{profile.footerFormula}</p>
          <p>{profile.footerNote}</p>
        </div>
      )}

      {successMsg && (
        <div className="success-box" onClick={() => setSuccessMsg('')}>
          {successMsg}
        </div>
      )}
      {errorMsg && (
        <div className="error-box" onClick={() => setErrorMsg('')}>{
          errorMsg
        }</div>
      )}
    </div>
  )
}

export default TankOperationSummary