import { Link } from 'react-router-dom'
import { useEffect, useMemo, useState } from 'react'
import {
  getOperationTransactions,
  exportOperationTransactionsCsv,
} from '../api/operationTransactionApi'

function OperationTransactionRegister({
  operationTypes = [],
  locations = [],
  assets = [],
}) {
  const [transactions, setTransactions] = useState([])
  const [loading, setLoading] = useState(false)

  const [filters, setFilters] = useState({
    searchText: '',
    dateFrom: '',
    dateTo: '',
    operationTypeId: '',
    locationId: '',
    assetId: '',
    status: '',
  })

  const activeOperationTypes = operationTypes.filter(
    (item) => item.status === 'Active'
  )

  const activeLocations = locations.filter((item) => item.status === 'Active')
  const activeAssets = assets.filter((item) => item.status === 'Active')

  const selectedLocation = activeLocations.find(
    (location) => String(location.id) === String(filters.locationId)
  )

  const filteredAssetsForLocation = useMemo(() => {
    if (!filters.locationId || !selectedLocation) {
      return activeAssets
    }

    return activeAssets.filter((asset) => {
      return (
        String(asset.locationId) === String(filters.locationId) ||
        asset.locationCode === selectedLocation.locationCode ||
        asset.assetScope === 'Global'
      )
    })
  }, [activeAssets, filters.locationId, selectedLocation])

  const loadTransactions = async (activeFilters = filters) => {
    try {
      setLoading(true)
      const data = await getOperationTransactions(activeFilters)
      setTransactions(data)
    } catch (error) {
      alert(error.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const delay = setTimeout(() => {
      loadTransactions(filters)
    }, 300)

    return () => clearTimeout(delay)
  }, [filters])

  const handleFilterChange = (e) => {
    const { name, value } = e.target

    if (name === 'locationId') {
      setFilters({
        ...filters,
        locationId: value,
        assetId: '',
      })
      return
    }

    setFilters({
      ...filters,
      [name]: value,
    })
  }

   const clearFilters = () => {
    setFilters({
      searchText: '',
      dateFrom: '',
      dateTo: '',
      operationTypeId: '',
      locationId: '',
      assetId: '',
      status: '',
    })
  }

  const handleBackendExportCsv = async () => {
    try {
      setLoading(true)
      await exportOperationTransactionsCsv(filters)
    } catch (error) {
      alert(error.message)
    } finally {
      setLoading(false)
    }
  }

  const formatCsvValue = (value) => {
    if (value === null || value === undefined) {
      return ''
    }

    const text = String(value).replace(/"/g, '""')
    return `"${text}"`
  }

  const getRegisterExportRows = () => {
    return transactions.map((transaction) => {
      return {
        ticketNumber: transaction.ticketNumber || '',
        convoyNumber: transaction.convoyNumber || '',
        operationDate: transaction.operationDate || '',
        operationType: transaction.operationTypeName || '',
        location:
          transaction.locationName && transaction.locationCode
            ? `${transaction.locationName} (${transaction.locationCode})`
            : '',
        primaryAsset:
          transaction.primaryAssetName && transaction.primaryAssetCode
            ? `${transaction.primaryAssetName} (${transaction.primaryAssetCode})`
            : '',
        fieldCount: transaction.fieldCount || 0,
        status: transaction.status || '',
        createdAt: transaction.createdAt || '',
      }
    })
  }

  const handleExportRegisterCsv = () => {
    const rows = getRegisterExportRows()

    if (rows.length === 0) {
      alert('No transactions available to export for the current filter selection.')
      return
    }

    const headers = [
      'Ticket Number',
      'Convoy Number',
      'Operation Date',
      'Operation Type',
      'Location',
      'Primary Asset',
      'Field Count',
      'Status',
      'Created At',
    ]

    const filterSummary = getPrintableFilterSummary()

    const csvRows = [
      [formatCsvValue('Operation Transaction Register')].join(','),
      [
        formatCsvValue('Generated At'),
        formatCsvValue(new Date().toLocaleString()),
      ].join(','),
      [
        formatCsvValue('Record Count'),
        formatCsvValue(rows.length),
      ].join(','),
      ''.trim(),

      [formatCsvValue('Applied Filters')].join(','),
      ...filterSummary.map((filterItem) => {
        return [
          formatCsvValue(filterItem.label),
          formatCsvValue(filterItem.value),
        ].join(',')
      }),
      ''.trim(),

      headers.map(formatCsvValue).join(','),
      ...rows.map((row) => {
        return [
          row.ticketNumber,
          row.convoyNumber,
          row.operationDate,
          row.operationType,
          row.location,
          row.primaryAsset,
          row.fieldCount,
          row.status,
          row.createdAt,
        ]
          .map(formatCsvValue)
          .join(',')
      }),
    ]

    const csvContent = csvRows.join('\n')
    const blob = new Blob([csvContent], {
      type: 'text/csv;charset=utf-8;',
    })

    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')

    link.href = url
    link.download = `operation-transaction-register-${new Date()
      .toISOString()
      .slice(0, 10)}.csv`

    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }
  const getPrintableFilterSummary = () => {
    const summary = []

    if (filters.searchText) {
      summary.push({
        label: 'Search',
        value: filters.searchText,
      })
    }

    if (filters.dateFrom) {
      summary.push({
        label: 'Date From',
        value: filters.dateFrom,
      })
    }

    if (filters.dateTo) {
      summary.push({
        label: 'Date To',
        value: filters.dateTo,
      })
    }

    if (filters.operationTypeId) {
      const operationType = operationTypes.find((item) => {
        return String(item.id) === String(filters.operationTypeId)
      })

      summary.push({
        label: 'Operation Type',
        value: operationType
          ? operationType.operationTypeName
          : filters.operationTypeId,
      })
    }

    if (filters.locationId) {
      const location = locations.find((item) => {
        return String(item.id) === String(filters.locationId)
      })

      summary.push({
        label: 'Location',
        value: location
          ? `${location.locationName} (${location.locationCode})`
          : filters.locationId,
      })
    }

    if (filters.assetId) {
      const asset = assets.find((item) => {
        return String(item.id) === String(filters.assetId)
      })

      summary.push({
        label: 'Asset',
        value: asset
          ? `${asset.assetName} (${asset.assetCode})`
          : filters.assetId,
      })
    }

    if (filters.status) {
      summary.push({
        label: 'Status',
        value: filters.status,
      })
    }

    if (summary.length === 0) {
      summary.push({
        label: 'Filters',
        value: 'No filters applied - showing all loaded records',
      })
    }

    return summary
  }
  const handlePrintRegister = () => {
    window.print()
  }

  return (
    <div>
      <div className="printable-register-report">
        <div className="print-report-header">
          <div>
            <h1>Operation Transaction Register</h1>
            <p>Hydrocarbon Accounting System</p>
            <p>Generated At: {new Date().toLocaleString()}</p>
            <p>Record Count: {getRegisterExportRows().length}</p>
          </div>
        </div>

        <div className="print-report-section">
          <h2>Applied Filters</h2>

          <table className="print-filter-summary-table">
            <tbody>
              {getPrintableFilterSummary().map((filterItem, index) => (
                <tr key={index}>
                  <th>{filterItem.label}</th>
                  <td>{filterItem.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="print-report-section">
          <h2>Transaction Register</h2>

          <table>
            <thead>
              <tr>
                <th>Ticket Number</th>
                <th>Convoy Number</th>
                <th>Operation Date</th>
                <th>Operation Type</th>
                <th>Location</th>
                <th>Primary Asset</th>
                <th>Field Count</th>
                <th>Status</th>
                <th>Created At</th>
              </tr>
            </thead>

            <tbody>
              {getRegisterExportRows().length === 0 ? (
                <tr>
                  <td colSpan="9">No transactions available.</td>
                </tr>
              ) : (
                getRegisterExportRows().map((row, index) => (
                  <tr key={index}>
                    <td>{row.ticketNumber}</td>
                    <td>{row.convoyNumber || '-'}</td>
                    <td>{row.operationDate}</td>
                    <td>{row.operationType}</td>
                    <td>{row.location}</td>
                    <td>{row.primaryAsset}</td>
                    <td>{row.fieldCount}</td>
                    <td>{row.status}</td>
                    <td>{row.createdAt}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="page-title no-print">
        <div>
          <h2>Operation Transaction Register</h2>
          <p>
            View, filter, print, and export saved operation tickets by date,
            operation, location, asset, and status.
          </p>
        </div>

        <div className="register-title-actions">
          <span className="record-count">
            {transactions.length} Transactions
          </span>

          <button type="button" onClick={handlePrintRegister}>
            Print Register
          </button>

          <button type="button" onClick={handleExportRegisterCsv}>
            Export CSV
          </button>
        </div>
      </div>

      <form>
        <div>
          <label>Search</label>
          <input
            name="searchText"
            type="text"
            value={filters.searchText}
            onChange={handleFilterChange}
            placeholder="Ticket, operation, location, asset, status"
          />
        </div>

        <div>
          <label>Date From</label>
          <input
            name="dateFrom"
            type="date"
            value={filters.dateFrom}
            onChange={handleFilterChange}
          />
        </div>

        <div>
          <label>Date To</label>
          <input
            name="dateTo"
            type="date"
            value={filters.dateTo}
            onChange={handleFilterChange}
          />
        </div>

        <div>
          <label>Operation Type</label>
          <select
            name="operationTypeId"
            value={filters.operationTypeId}
            onChange={handleFilterChange}
          >
            <option value="">All Operation Types</option>

            {activeOperationTypes.map((operationType) => (
              <option key={operationType.id} value={operationType.id}>
                {operationType.operationTypeName}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label>Location</label>
          <select
            name="locationId"
            value={filters.locationId}
            onChange={handleFilterChange}
          >
            <option value="">All Locations</option>

            {activeLocations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.locationName} ({location.locationCode})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label>Asset</label>
          <select
            name="assetId"
            value={filters.assetId}
            onChange={handleFilterChange}
          >
            <option value="">All Assets</option>

            {filteredAssetsForLocation.map((asset) => (
              <option key={asset.id} value={asset.id}>
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
          >
            <option value="">All Statuses</option>
            <option>Draft</option>
            <option>Submitted</option>
            <option>Approved</option>
            <option>Rejected</option>
            <option>Cancelled</option>
          </select>
        </div>

        <div className="form-actions">
          <button type="button" onClick={() => loadTransactions(filters)} disabled={loading}>
            {loading ? 'Loading...' : 'Refresh'}
          </button>

          <button type="button" onClick={clearFilters} disabled={loading}>
            Clear Filters
          </button>

          <button type="button" onClick={handleBackendExportCsv} disabled={loading}>
            Export CSV
          </button>
        </div>
      </form>

      <div className="section-title">
        <h3>Saved Operation Tickets</h3>
        <p>
          Filters are live. The list updates automatically when you change
          search, date range, operation type, location, asset, or status.
        </p>
      </div>

      <table>
        <thead>
          <tr>
            <th>Ticket Number</th>
            <th>Convoy Number</th>
            <th>Date</th>
            <th>Operation Type</th>
            <th>Location</th>
            <th>Primary Asset</th>
            <th>Field Count</th>
            <th>Status</th>
            <th>Created At</th>
            <th>Actions</th>
          </tr>
        </thead>

        <tbody>
          {loading ? (
            <tr>
              <td colSpan="10" className="empty-table">
                Loading operation transactions...
              </td>
            </tr>
          ) : transactions.length === 0 ? (
            <tr>
              <td colSpan="10" className="empty-table">
                No operation transactions found.
              </td>
            </tr>
          ) : (
            transactions.map((transaction) => (
              <tr key={transaction.id}>
                <td>
                  <strong>
                    {transaction.ticketNumber || 'Ticket number not found'}
                  </strong>
                </td>
                <td>{transaction.convoyNumber || '-'}</td>
                <td>{transaction.operationDate}</td>

                <td>{transaction.operationTypeName}</td>

                <td>
                  {transaction.locationName} ({transaction.locationCode})
                </td>

                <td>
                  {transaction.primaryAssetName} (
                  {transaction.primaryAssetCode})
                </td>

                <td>
                  <span className="permission-badge">
                    {transaction.fieldCount} Fields
                  </span>
                </td>

                <td>
                  <span
                    className={`status-badge ${transaction.status.toLowerCase()}`}
                  >
                    {transaction.status}
                  </span>
                </td>

                <td>{transaction.createdAt}</td>

                <td>
                  <Link to={`/operation-transactions/${transaction.id}`}>
                    <button type="button">View</button>
                  </Link>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <div className="info-box">
        This register uses server-side filters. Export CSV now downloads directly from
        the backend using the selected filters, so it is suitable for larger transaction
        volumes and future operation modules.
      </div>
    </div>
  )
}

export default OperationTransactionRegister