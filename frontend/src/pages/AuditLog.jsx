import { Fragment, useEffect, useState } from 'react'
import { getAuditLogs } from '../api/auditLogApi'

function AuditLog() {
  const [auditLogs, setAuditLogs] = useState([])
  const [loading, setLoading] = useState(false)
  const [expandedLogId, setExpandedLogId] = useState(null)

  const [filters, setFilters] = useState({
    moduleName: '',
    action: '',
    entityType: '',
    ticketNumber: '',
    operationNumber: '',
    performedBy: '',
    dateFrom: '',
    dateTo: '',
    limit: '200',
  })

  const loadAuditLogs = async (activeFilters = filters) => {
    try {
      setLoading(true)
      const logsFromApi = await getAuditLogs(activeFilters)
      setAuditLogs(logsFromApi)
    } catch (error) {
      alert(error.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAuditLogs()
  }, [])

  const handleFilterChange = (e) => {
    setFilters({
      ...filters,
      [e.target.name]: e.target.value,
    })
  }

  const handleApplyFilters = (e) => {
    e.preventDefault()
    loadAuditLogs(filters)
  }

  const clearFilters = () => {
    const emptyFilters = {
      moduleName: '',
      action: '',
      entityType: '',
      ticketNumber: '',
      operationNumber: '',
      performedBy: '',
      dateFrom: '',
      dateTo: '',
      limit: '200',
    }

    setFilters(emptyFilters)
    loadAuditLogs(emptyFilters)
  }

  const formatDateTime = (value) => {
    if (!value) {
      return '-'
    }

    return new Date(value).toLocaleString()
  }

  const toggleDetails = (logId) => {
    if (expandedLogId === logId) {
      setExpandedLogId(null)
      return
    }

    setExpandedLogId(logId)
  }

  return (
    <div>
      <div className="page-title">
        <div>
          <h2>Audit Log</h2>
          <p>
            View system audit trail for operation transactions, approvals,
            cancellations, exports, profiles, and future modules.
          </p>
        </div>

        <span className="record-count">{auditLogs.length} Logs</span>
      </div>

      <form onSubmit={handleApplyFilters}>
        <div>
          <label>Module</label>
          <input
            name="moduleName"
            type="text"
            value={filters.moduleName}
            onChange={handleFilterChange}
            placeholder="Example: Operation Transaction"
          />
        </div>

        <div>
          <label>Action</label>
          <input
            name="action"
            type="text"
            value={filters.action}
            onChange={handleFilterChange}
            placeholder="Example: Approve"
          />
        </div>

        <div>
          <label>Entity Type</label>
          <input
            name="entityType"
            type="text"
            value={filters.entityType}
            onChange={handleFilterChange}
            placeholder="Example: OperationTransaction"
          />
        </div>

        <div>
          <label>Ticket Number</label>
          <input
            name="ticketNumber"
            type="text"
            value={filters.ticketNumber}
            onChange={handleFilterChange}
            placeholder="Example: UTP-TNK101"
          />
        </div>

        <div>
          <label>Operation Number</label>
          <input
            name="operationNumber"
            type="text"
            value={filters.operationNumber}
            onChange={handleFilterChange}
            placeholder="Example: OP-20260513"
          />
        </div>

        <div>
          <label>Performed By</label>
          <input
            name="performedBy"
            type="text"
            value={filters.performedBy}
            onChange={handleFilterChange}
            placeholder="Username or full name"
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
          <label>Limit</label>
          <select
            name="limit"
            value={filters.limit}
            onChange={handleFilterChange}
          >
            <option value="50">50</option>
            <option value="100">100</option>
            <option value="200">200</option>
            <option value="500">500</option>
            <option value="1000">1000</option>
          </select>
        </div>

        <div className="form-actions">
          <button type="submit" disabled={loading}>
            {loading ? 'Loading...' : 'Apply Filters'}
          </button>

          <button type="button" onClick={clearFilters} disabled={loading}>
            Clear Filters
          </button>

          <button
            type="button"
            onClick={() => loadAuditLogs(filters)}
            disabled={loading}
          >
            Refresh
          </button>
        </div>
      </form>

      <div className="section-title">
        <h3>Audit Trail</h3>
        <p>
          Latest audit records are shown first. Use filters to narrow by module,
          action, ticket, user, or date.
        </p>
      </div>

      <table>
        <thead>
          <tr>
            <th>Date / Time</th>
            <th>Module</th>
            <th>Action</th>
            <th>Ticket</th>
            <th>Operation No.</th>
            <th>Status Change</th>
            <th>Performed By</th>
            <th>Remarks</th>
            <th>Details</th>
          </tr>
        </thead>

        <tbody>
          {auditLogs.length === 0 ? (
            <tr>
              <td colSpan="9" className="empty-table">
                No audit logs found.
              </td>
            </tr>
          ) : (
            auditLogs.map((log) => (
              <Fragment key={log.id}>
                <tr>
                  <td>{formatDateTime(log.createdAt)}</td>
                  <td>{log.moduleName}</td>
                  <td>
                    <span className="permission-badge">{log.action}</span>
                  </td>
                  <td>{log.ticketNumber || '-'}</td>
                  <td>{log.operationNumber || '-'}</td>
                  <td>
                    {log.oldStatus || log.newStatus ? (
                      <span>
                        {log.oldStatus || '-'} → {log.newStatus || '-'}
                      </span>
                    ) : (
                      '-'
                    )}
                  </td>
                  <td>{log.performedBy || '-'}</td>
                  <td>{log.remarks || '-'}</td>
                  <td>
                    <button type="button" onClick={() => toggleDetails(log.id)}>
                      {expandedLogId === log.id ? 'Hide' : 'View'}
                    </button>
                  </td>
                </tr>

                {expandedLogId === log.id && (
                  <tr>
                    <td colSpan="9">
                      <div className="audit-details-box">
                        <p>
                          <strong>Entity:</strong>{' '}
                          {log.entityType || '-'} #{log.entityId || '-'}
                        </p>

                        <p>
                          <strong>Entity Label:</strong>{' '}
                          {log.entityLabel || '-'}
                        </p>

                        <p>
                          <strong>Request Path:</strong>{' '}
                          {log.requestPath || '-'}
                        </p>

                        <pre>
                          {log.details
                            ? JSON.stringify(log.details, null, 2)
                            : 'No extra details'}
                        </pre>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))
          )}
        </tbody>
      </table>

      <div className="info-box">
        Audit Log is read-only. It records important system actions such as
        operation entry creation, submit, approve, reject, recall, and cancel.
      </div>
    </div>
  )
}

export default AuditLog