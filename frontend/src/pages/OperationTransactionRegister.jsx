import { Link } from 'react-router-dom'
import { useEffect, useMemo, useState } from 'react'
import {
  getOperationTransactionsPaged,
  exportOperationTransactionsCsv,
} from '../api/operationTransactionApi'

function OperationTransactionRegister({
  operationTypes = [],
  locations = [],
  assets = [],
}) {
  const [rows, setRows] = useState([])
  const [statusCounts, setStatusCounts] = useState([])
  const [totalRows, setTotalRows] = useState(0)

  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [hasMore, setHasMore] = useState(false)

  const [loading, setLoading] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')
  const [errorMsg, setErrorMsg] = useState('')

  const [filters, setFilters] = useState({
    searchText: '',
    dateFrom: '',
    dateTo: '',
    operationTypeId: '',
    locationId: '',
    assetId: '',
    status: '',
  })

  const activeOperationTypes = operationTypes.filter((item) => item.status === 'Active')
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

  const statusCountMap = useMemo(() => {
    const map = {}
    ;(statusCounts || []).forEach((r) => {
      const key = String(r.status || '')
      map[key] = Number(r.count || 0)
    })
    return map
  }, [statusCounts])

  const allStatusTotal = useMemo(() => {
    return Object.values(statusCountMap).reduce((sum, v) => sum + Number(v || 0), 0)
  }, [statusCountMap])

  const loadPaged = async () => {
    try {
      setLoading(true)
      const data = await getOperationTransactionsPaged({
        ...filters,
        page,
        pageSize,
      })

      setRows(Array.isArray(data?.rows) ? data.rows : [])
      setTotalRows(Number(data?.total_rows || 0))
      setHasMore(Boolean(data?.has_more))
      setStatusCounts(Array.isArray(data?.status_counts) ? data.status_counts : [])
    } catch (error) {
      setErrorMsg(error.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const delay = setTimeout(() => {
      loadPaged()
    }, 300)

    return () => clearTimeout(delay)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, page, pageSize])

  const handleFilterChange = (e) => {
    const { name, value } = e.target

    if (name === 'locationId') {
      setPage(1)
      setFilters((c) => ({
        ...c,
        locationId: value,
        assetId: '',
      }))
      return
    }

    setPage(1)
    setFilters((c) => ({
      ...c,
      [name]: value,
    }))
  }

  const setStatusTab = (status) => {
    setPage(1)
    setFilters((c) => ({ ...c, status }))
  }

  const clearFilters = () => {
    setPage(1)
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
      setErrorMsg(error.message)
    } finally {
      setLoading(false)
    }
  }

  const handlePrintRegister = () => {
    window.print()
  }

  const totalPages = useMemo(() => {
    return Math.max(1, Math.ceil(totalRows / pageSize))
  }, [totalRows, pageSize])

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
            {totalRows} Transactions
          </span>

          <button type="button" onClick={handlePrintRegister}>
            Print Register
          </button>

          <button type="button" onClick={handleBackendExportCsv} disabled={loading}>
            Export CSV
          </button>
        </div>
      </div>

      <div className="info-box no-print">
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            type="button"
            className={!filters.status ? 'active-tab-btn' : ''}
            onClick={() => setStatusTab('')}
          >
            All ({allStatusTotal})
          </button>
          <button
            type="button"
            className={filters.status === 'Draft' ? 'active-tab-btn' : ''}
            onClick={() => setStatusTab('Draft')}
          >
            Draft ({statusCountMap.Draft || 0})
          </button>
          <button
            type="button"
            className={filters.status === 'Submitted' ? 'active-tab-btn' : ''}
            onClick={() => setStatusTab('Submitted')}
          >
            Submitted ({statusCountMap.Submitted || 0})
          </button>
          <button
            type="button"
            className={filters.status === 'Approved' ? 'active-tab-btn' : ''}
            onClick={() => setStatusTab('Approved')}
          >
            Approved ({statusCountMap.Approved || 0})
          </button>
          <button
            type="button"
            className={filters.status === 'Rejected' ? 'active-tab-btn' : ''}
            onClick={() => setStatusTab('Rejected')}
          >
            Rejected ({statusCountMap.Rejected || 0})
          </button>
          <button
            type="button"
            className={filters.status === 'Cancelled' ? 'active-tab-btn' : ''}
            onClick={() => setStatusTab('Cancelled')}
          >
            Cancelled ({statusCountMap.Cancelled || 0})
          </button>
        </div>
      </div>

      <form className="no-print">
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
          <label>Page Size</label>
          <select
            value={String(pageSize)}
            onChange={(e) => {
              const next = Number(e.target.value || 20)
              setPage(1)
              setPageSize(next)
            }}
          >
            <option value="10">10</option>
            <option value="20">20</option>
            <option value="50">50</option>
            <option value="100">100</option>
          </select>
        </div>

        <div className="form-actions">
          <button type="button" onClick={loadPaged} disabled={loading}>
            {loading ? 'Loading...' : 'Refresh'}
          </button>

          <button type="button" onClick={clearFilters} disabled={loading}>
            Clear Filters
          </button>
        </div>
      </form>

      <div className="section-title no-print">
        <h3>Saved Operation Tickets</h3>
        <p>
          Filters are live. The list updates automatically when you change search, date range, operation type, location, asset, or status.
        </p>
      </div>

      <div className="info-box no-print">
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" disabled={loading || page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            Prev
          </button>
          <span>
            Page {page} / {totalPages}
          </span>
          <button type="button" disabled={loading || !hasMore} onClick={() => setPage((p) => p + 1)}>
            Next
          </button>
        </div>
        <div style={{ marginTop: 6, fontSize: 12, opacity: 0.8 }}>
          Showing {rows.length} of {totalRows} rows
        </div>
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
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan="10" className="empty-table">
                No operation transactions found.
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <strong>{r.ticket_number || r.operation_number || 'Ticket number not found'}</strong>
                </td>
                <td>{r.convoy_number || '-'}</td>
                <td>{r.operation_date || '-'}</td>
                <td>{r.operation_type_name || r.operation_type_code || '-'}</td>
                <td>
                  {r.location_name ? `${r.location_name} (${r.location_code || r.origin_location_code || ''})` : (r.location_code || r.origin_location_code || '-')}
                </td>
                <td>
                  {r.primary_asset_name ? `${r.primary_asset_name} (${r.primary_asset_code || ''})` : (r.primary_asset_code || '-')}
                </td>
                <td>
                  <span className="permission-badge">{Number(r.field_count || 0)} Fields</span>
                </td>
                <td>
                  <span className={`status-badge ${String(r.status || '').toLowerCase()}`}>
                    {r.status || '-'}
                  </span>
                </td>
                <td>{r.created_at || '-'}</td>
                <td>
                  <Link to={`/operation-transactions/${r.id}`}>
                    <button type="button">View</button>
                  </Link>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <div className="info-box no-print">
        This register uses server-side paging and status counts. Export CSV downloads directly from the backend using the selected filters.
      </div>
    </div>
  )
}

export default OperationTransactionRegister
