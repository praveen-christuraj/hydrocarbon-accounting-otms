import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  adminRejectApprovedRevokeTask,
  adminRevokeApprovedTransactionTask,
  approveOperationTask,
  getMyOperationTasks,
  getOperationTaskEvents,
  rejectOperationTask,
  releaseOperationTask,
  takeOperationTaskOwnership,
} from '../api/operationTaskApi'

function OperationTaskManager({ reloadOperationTransactions, loggedInUser }) {
  const isAdminBootstrap =
    String(loggedInUser?.username || '').toLowerCase() === 'admin'

  const hasPermission = (permissionName) =>
    Boolean(
      loggedInUser?.permissions?.some(
        (p) => p.permissionName === permissionName
      )
    )

  const canActOnOperationTask = useMemo(() => {
    if (isAdminBootstrap) return true
    return hasPermission('Act On Operation Task')
  }, [loggedInUser])

  const canAdminRevokeApprovedTransaction = useMemo(() => {
    if (isAdminBootstrap) return true
    return hasPermission('Admin Revoke Approved Transaction')
  }, [loggedInUser])
  const [tasks, setTasks] = useState([])
  const [events, setEvents] = useState([])
  const [selectedTask, setSelectedTask] = useState(null)
  const [statusFilter, setStatusFilter] = useState('Pending')
  const [taskTypeFilter, setTaskTypeFilter] = useState('ALL')
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [remarks, setRemarks] = useState('')
  const [loading, setLoading] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [confirmAction, setConfirmAction] = useState(null)

  const counts = useMemo(() => {
    return tasks.reduce(
      (acc, task) => {
        acc[task.status] = (acc[task.status] || 0) + 1
        acc.ALL += 1
        return acc
      },
      { ALL: 0 }
    )
  }, [tasks])

  const invalidDateRange = dateFrom && dateTo && dateFrom > dateTo

  const loadTasks = async () => {
    if (invalidDateRange) {
      setTasks([])
      setSelectedTask(null)
      setEvents([])
      return
    }

    setLoading(true)
    try {
      const data = await getMyOperationTasks({
        status: statusFilter === 'ALL' ? '' : statusFilter,
        taskType: taskTypeFilter === 'ALL' ? '' : taskTypeFilter,
        search: search.trim(),
        createdFrom: dateFrom,
        createdTo: dateTo,
      })
      setTasks(data)
      if (selectedTask) {
        const refreshed = data.find((task) => task.id === selectedTask.id)
        setSelectedTask(refreshed || null)
      }
    } catch (error) {
      setErrorMsg(error.message)
    } finally {
      setLoading(false)
    }
  }

  const loadEvents = async (taskId) => {
    try {
      const data = await getOperationTaskEvents(taskId)
      setEvents(data)
    } catch (error) {
      setEvents([])
      setErrorMsg(error.message)
    }
  }

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      loadTasks()
    }, 300)

    return () => window.clearTimeout(timeoutId)
  }, [statusFilter, taskTypeFilter, search, dateFrom, dateTo])

  const clearFilters = () => {
    setStatusFilter('Pending')
    setTaskTypeFilter('ALL')
    setSearch('')
    setDateFrom('')
    setDateTo('')
    setSelectedTask(null)
    setEvents([])
  }

  const selectTask = async (task) => {
    setSelectedTask(task)
    setRemarks('')
    await loadEvents(task.id)
  }

  const getConfirmMessage = (action) => {
    switch (action) {
      case 'approve': return 'Approve the linked operation ticket?'
      case 'reject': return 'Reject the linked operation ticket?'
      case 'admin-revoke-approved': return 'Admin revoke will move the approved ticket back to Submitted and reverse derived ledger rows. Continue?'
      case 'admin-reject-revoke': return 'Reject this approved transaction revoke request?'
      default: return ''
    }
  }

  const runAction = async (action) => {
    if (!selectedTask) return
    const confirmMsg = getConfirmMessage(action)
    if (confirmMsg) {
      setConfirmAction({ action, message: confirmMsg })
      return
    }
    await executeAction(action)
  }

  const confirmRunAction = async () => {
    if (!confirmAction) return
    setConfirmAction(null)
    await executeAction(confirmAction.action)
  }

  const executeAction = async (action) => {
    if (!selectedTask) return

    if (['take', 'release', 'approve', 'reject'].includes(action) && !canActOnOperationTask) {
      setErrorMsg('You do not have permission to act on operation tasks')
      return
    }
    if (['admin-revoke-approved', 'admin-reject-revoke'].includes(action) && !canAdminRevokeApprovedTransaction) {
      setErrorMsg('You do not have permission to admin revoke approved transactions')
      return
    }

    setLoading(true)
    try {
      if (action === 'take') {
        await takeOperationTaskOwnership(selectedTask.id, remarks)
      } else if (action === 'release') {
        await releaseOperationTask(selectedTask.id, remarks)
      } else if (action === 'approve') {
        await approveOperationTask(selectedTask.id, remarks || 'Approved from Task Manager')
        setSuccessMsg('Operation ticket approved.')
      } else if (action === 'reject') {
        await rejectOperationTask(selectedTask.id, remarks || 'Rejected from Task Manager')
        setSuccessMsg('Operation ticket rejected.')
      } else if (action === 'admin-revoke-approved') {
        await adminRevokeApprovedTransactionTask(
          selectedTask.id,
          remarks || 'Admin revoked approved transaction for correction'
        )
        setSuccessMsg('Approved transaction revoked.')
      } else if (action === 'admin-reject-revoke') {
        await adminRejectApprovedRevokeTask(
          selectedTask.id,
          remarks || 'Admin rejected approved transaction revoke request'
        )
        setSuccessMsg('Revoke request rejected.')
      }

      await loadTasks()
      if (typeof reloadOperationTransactions === 'function') {
        await reloadOperationTransactions()
      }
      if (selectedTask) {
        await loadEvents(selectedTask.id)
      }
      setRemarks('')
    } catch (error) {
      setErrorMsg(error.message)
    } finally {
      setLoading(false)
    }
  }

  const canAct =
    canActOnOperationTask &&
    selectedTask &&
    selectedTask.taskType === 'OPERATION_APPROVAL' &&
    ['Pending', 'In Progress'].includes(selectedTask.status)

  const canActOnApprovedRevoke =
    canAdminRevokeApprovedTransaction &&
    selectedTask &&
    selectedTask.taskType === 'APPROVED_TRANSACTION_REVOKE_REQUEST' &&
    ['Pending', 'In Progress'].includes(selectedTask.status)

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
      {confirmAction && (
        <div className="confirm-overlay">
          <div className="confirm-dialog">
            <p>{confirmAction.message}</p>
            <div className="confirm-actions">
              <button onClick={confirmRunAction}>Yes</button>
              <button onClick={() => setConfirmAction(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
      <div className="page-title">
        <div>
          <h2>Task Manager</h2>
          <p>
            Assigned approval and security tasks. Pending tasks are loaded by
            default for immediate review.
          </p>
        </div>
        <span className="record-count">{counts.ALL || 0} Tasks</span>
      </div>

      {!canActOnOperationTask && !canAdminRevokeApprovedTransaction && (
        <div className="info-box">
          You have view-only access. Assign <strong>Act On Operation Task</strong> to approve/reject tickets, or <strong>Admin Revoke Approved Transaction</strong> to manage approved-transaction revoke requests.
        </div>
      )}

      <div className="filter-panel">
        <button
          type="button"
          className={statusFilter === 'Pending' ? 'active-tab-btn' : ''}
          onClick={() => setStatusFilter('Pending')}
        >
          Pending
        </button>
        <button
          type="button"
          className={statusFilter === 'In Progress' ? 'active-tab-btn' : ''}
          onClick={() => setStatusFilter('In Progress')}
        >
          In Progress
        </button>
        <button
          type="button"
          className={statusFilter === 'Approved' ? 'active-tab-btn' : ''}
          onClick={() => setStatusFilter('Approved')}
        >
          Approved
        </button>
        <button
          type="button"
          className={statusFilter === 'Rejected' ? 'active-tab-btn' : ''}
          onClick={() => setStatusFilter('Rejected')}
        >
          Rejected
        </button>
        <button
          type="button"
          className={statusFilter === 'ALL' ? 'active-tab-btn' : ''}
          onClick={() => setStatusFilter('ALL')}
        >
          All
        </button>
      </div>

      <div className="filter-panel">
        <div>
          <label>Task Type</label>
          <select
            value={taskTypeFilter}
            onChange={(e) => setTaskTypeFilter(e.target.value)}
            disabled={loading}
          >
            <option value="ALL">All Task Types</option>
            <option value="OPERATION_APPROVAL">Operation Approval</option>
            <option value="APPROVED_TRANSACTION_REVOKE_REQUEST">
              Approved Transaction Revoke
            </option>
            <option value="PASSWORD_RESET_REQUEST">Password Reset Request</option>
          </select>
        </div>

        <div>
          <label>Search</label>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Task, ticket, operation, asset, location"
            disabled={loading}
          />
        </div>

        <div>
          <label>Submitted From</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            disabled={loading}
          />
        </div>

        <div>
          <label>Submitted To</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            disabled={loading}
          />
        </div>

        <div className="filter-actions">
          <button
            type="button"
            onClick={loadTasks}
            disabled={loading || invalidDateRange}
          >
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>

        <div className="filter-actions">
          <button type="button" onClick={clearFilters} disabled={loading}>
            Clear
          </button>
        </div>
      </div>

      {invalidDateRange && (
        <div className="info-box">
          Submitted From cannot be later than Submitted To. Correct the date
          range to continue live filtering.
        </div>
      )}

      <table>
        <thead>
          <tr>
            <th>Task</th>
            <th>Ticket</th>
            <th>Operation</th>
            <th>Asset</th>
            <th>Location</th>
            <th>Priority</th>
            <th>Status</th>
            <th>Submitted</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {tasks.length === 0 ? (
            <tr>
              <td colSpan="9" className="empty-table">
                No tasks found for this filter.
              </td>
            </tr>
          ) : (
            tasks.map((task) => (
              <tr key={task.id}>
                <td>{task.taskNumber}</td>
                <td>{task.ticketNumber}</td>
                <td>{task.operationTypeCode}</td>
                <td>
                  {task.primaryAssetCode}
                  {task.assetTypeCode ? ` (${task.assetTypeCode})` : ''}
                </td>
                <td>{task.locationCode}</td>
                <td>{task.priority}</td>
                <td>
                  <span className={`status-badge ${String(task.status).toLowerCase().replace(/\s+/g, '-')}`}>
                    {task.status}
                  </span>
                </td>
                <td>{task.createdAt ? new Date(task.createdAt).toLocaleString() : '-'}</td>
                <td>
                  <button type="button" onClick={() => selectTask(task)}>
                    Review
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      {selectedTask && (
        <div className="info-box">
          <strong>{selectedTask.taskNumber}</strong>
          <div>Reference: {selectedTask.ticketNumber || selectedTask.operationNumber || '-'}</div>
          <div>Operation: {selectedTask.operationTypeCode}</div>
          <div>Asset: {selectedTask.primaryAssetCode}</div>
          <div>Location: {selectedTask.locationCode}</div>
          <div>Status: {selectedTask.status}</div>
          {selectedTask.remarks && <div>Task Notes: {selectedTask.remarks}</div>}

          {selectedTask.transactionId ? (
            <div className="form-actions">
              <Link to={`/operation-transactions/${selectedTask.transactionId}`}>
                Open Ticket
              </Link>
            </div>
          ) : (
            <div className="info-box">
              This task is not linked to an operation ticket. Use the relevant admin
              screen to complete the request, then close it through backend workflow.
            </div>
          )}

          {canAct && (
            <>
              <label>Action Remarks</label>
              <textarea
                rows="3"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="Enter review/approval remarks"
              />
              <div className="form-actions">
                <button type="button" onClick={() => runAction('take')} disabled={loading}>
                  Take Ownership
                </button>
                <button type="button" onClick={() => runAction('release')} disabled={loading}>
                  Release
                </button>
                <button type="button" onClick={() => runAction('approve')} disabled={loading}>
                  Approve
                </button>
                <button type="button" onClick={() => runAction('reject')} disabled={loading}>
                  Reject
                </button>
              </div>
            </>
          )}

          {canActOnApprovedRevoke && (
            <>
              <label>Admin Action Remarks</label>
              <textarea
                rows="3"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="Enter admin revoke/reject remarks"
              />
              <div className="form-actions">
                <button
                  type="button"
                  onClick={() => runAction('admin-revoke-approved')}
                  disabled={loading}
                >
                  Admin Revoke Approval
                </button>
                <button
                  type="button"
                  onClick={() => runAction('admin-reject-revoke')}
                  disabled={loading}
                >
                  Reject Revoke Request
                </button>
              </div>
            </>
          )}

          <div className="section-title compact-section-title">
            <h3>Task History</h3>
          </div>
          <table>
            <thead>
              <tr>
                <th>Event</th>
                <th>Status</th>
                <th>Actor</th>
                <th>Notes</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {events.length === 0 ? (
                <tr>
                  <td colSpan="5" className="empty-table">
                    No task history available.
                  </td>
                </tr>
              ) : (
                events.map((event) => (
                  <tr key={event.id}>
                    <td>{event.eventType}</td>
                    <td>
                      {event.oldStatus || '-'} {'->'} {event.newStatus || '-'}
                    </td>
                    <td>{event.actorDisplay || '-'}</td>
                    <td>{event.notes || '-'}</td>
                    <td>{event.createdAt ? new Date(event.createdAt).toLocaleString() : '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default OperationTaskManager
