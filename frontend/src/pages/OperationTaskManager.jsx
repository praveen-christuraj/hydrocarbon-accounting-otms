import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  adminRejectApprovedRevokeTask,
  adminRevokeApprovedTransactionTask,
  approveOperationTask,
  getMyOperationTasks,
  getOperationTask,
  getOperationTaskEvents,
  rejectOperationTask,
  releaseOperationTask,
  takeOperationTaskOwnership,
} from '../api/operationTaskApi'
import AlertMessage from '../components/common/AlertMessage'
import Modal from '../components/common/Modal'
import useActionFeedback from '../hooks/useActionFeedback'

const STATUS_TABS = ['Pending', 'In Progress', 'Approved', 'Rejected', 'ALL']

const TASK_TYPE_LABELS = {
  OPERATION_APPROVAL: 'Operation approval',
  APPROVED_TRANSACTION_REVOKE_REQUEST: 'Approved transaction revoke',
  PASSWORD_RESET_REQUEST: 'Password reset request',
}

const formatDateTime = (value) => {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString()
}

function OperationTaskManager({ reloadOperationTransactions, loggedInUser }) {
  const permissionSet = useMemo(
    () => new Set((loggedInUser?.permissions || []).map((permission) => permission.permissionName)),
    [loggedInUser]
  )
  const isAdminBootstrap =
    loggedInUser?.isAdmin === true ||
    String(loggedInUser?.username || '').trim().toLowerCase() === 'admin' ||
    (Array.isArray(loggedInUser?.roles) && loggedInUser.roles.some((role) =>
      String(role?.role_name || role?.roleName || '').trim().toLowerCase() === 'admin'
    ))
  const hasPermission = (permissionName) => isAdminBootstrap || permissionSet.has(permissionName)

  const canActOnOperationTask = hasPermission('Act On Operation Task')
  const canAdminRevokeApprovedTransaction = hasPermission('Admin Revoke Approved Transaction')
  // The task API delegates to the transaction workflow. Match those checks in
  // the UI so an approval/rejection button is never offered to an account that
  // the transaction route will reject for missing permissions.
  const canApproveTransaction =
    canActOnOperationTask &&
    hasPermission('Approve Operation Transaction') &&
    hasPermission('Review Operation Transaction')
  const canRejectTransaction =
    canActOnOperationTask && hasPermission('Reject Operation Transaction')
  const canSupervise = hasPermission('Supervise Operation Tasks')
  const canViewOperationTransaction = hasPermission('View Operation Transaction')

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
  const [confirmAction, setConfirmAction] = useState(null)
  const [selectedTaskIds, setSelectedTaskIds] = useState([])
  const [bulkModal, setBulkModal] = useState(null)
  const [bulkProcessing, setBulkProcessing] = useState(false)
  const eventsRequestId = useRef(0)
  const feedback = useActionFeedback()
  const { notifySuccess, notifyError, clearSuccess, clearError } = feedback

  const invalidDateRange = Boolean(dateFrom && dateTo && dateFrom > dateTo)

  const loadTasks = useCallback(async () => {
    if (invalidDateRange) {
      setTasks([])
      return
    }

    setLoading(true)
    try {
      // Load all task statuses for the active search/date/type filters. Status
      // tabs are filtered locally so stale legacy tasks (linked ticket already
      // approved) appear under the correct tab rather than Pending.
      const data = await getMyOperationTasks({
        status: '',
        taskType: taskTypeFilter === 'ALL' ? '' : taskTypeFilter,
        search: search.trim(),
        createdFrom: dateFrom,
        createdTo: dateTo,
      })
      setTasks(data)
      setSelectedTask((current) => {
        if (!current) return current
        return data.find((task) => task.id === current.id) || current
      })
    } catch (error) {
      notifyError(error.message || 'Unable to load assigned tasks')
    } finally {
      setLoading(false)
    }
  }, [dateFrom, dateTo, invalidDateRange, notifyError, search, taskTypeFilter])

  const loadEvents = useCallback(async (taskId) => {
    const requestId = ++eventsRequestId.current
    try {
      const data = await getOperationTaskEvents(taskId)
      if (requestId === eventsRequestId.current) setEvents(data)
    } catch (error) {
      if (requestId === eventsRequestId.current) {
        setEvents([])
        notifyError(error.message || 'Unable to load task history')
      }
    }
  }, [notifyError])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      loadTasks()
    }, 250)
    return () => window.clearTimeout(timeoutId)
  }, [loadTasks])

  const counts = useMemo(() => tasks.reduce((result, task) => {
    result.ALL += 1
    result[task.status] = (result[task.status] || 0) + 1
    return result
  }, { ALL: 0 }), [tasks])

  const visibleTasks = useMemo(
    () => tasks.filter((task) => statusFilter === 'ALL' || task.status === statusFilter),
    [statusFilter, tasks]
  )

  const isOpenTask = (task) => ['Pending', 'In Progress'].includes(task?.status)
  const canBulkApprove = (task) =>
    canApproveTransaction &&
    task?.taskType === 'OPERATION_APPROVAL' &&
    isOpenTask(task)

  const bulkEligibleTasks = visibleTasks.filter(canBulkApprove)
  const selectedIds = new Set(selectedTaskIds)
  const selectedBulkTasks = bulkEligibleTasks.filter((task) => selectedIds.has(task.id))
  const allEligibleSelected =
    bulkEligibleTasks.length > 0 && selectedBulkTasks.length === bulkEligibleTasks.length

  const clearFilters = () => {
    setStatusFilter('Pending')
    setTaskTypeFilter('ALL')
    setSearch('')
    setDateFrom('')
    setDateTo('')
    setSelectedTaskIds([])
  }

  const selectTask = async (task) => {
    eventsRequestId.current += 1
    setSelectedTask(task)
    setEvents([])
    setRemarks('')
    clearError()
    await loadEvents(task.id)
  }

  const closeTaskDetails = () => {
    eventsRequestId.current += 1
    setSelectedTask(null)
    setEvents([])
    setRemarks('')
    setConfirmAction(null)
  }

  const getConfirmMessage = (action) => {
    switch (action) {
      case 'approve': return 'Approve the linked operation ticket?'
      case 'reject': return 'Reject the linked operation ticket?'
      case 'admin-revoke-approved': return 'Admin revoke will move the approved ticket back to Submitted and reverse derived ledger rows. Continue?'
      case 'admin-reject-revoke': return 'Reject this approved-transaction revoke request?'
      default: return ''
    }
  }

  const runAction = (action) => {
    if (!selectedTask) return
    const message = getConfirmMessage(action)
    if (message) {
      setConfirmAction({ action, message })
      return
    }
    executeAction(action)
  }

  const confirmRunAction = async () => {
    if (!confirmAction) return
    const { action } = confirmAction
    setConfirmAction(null)
    await executeAction(action)
  }

  const executeAction = async (action) => {
    if (!selectedTask) return
    const taskId = selectedTask.id

    if (['take', 'release'].includes(action) && !canActOnOperationTask) {
      notifyError('You do not have permission to act on operation tasks')
      return
    }
    if (action === 'approve' && !canApproveTransaction) {
      notifyError('Approval requires Act On Operation Task, Approve Operation Transaction and Review Operation Transaction permissions')
      return
    }
    if (action === 'reject' && !canRejectTransaction) {
      notifyError('Rejection requires Act On Operation Task and Reject Operation Transaction permissions')
      return
    }
    if (['admin-revoke-approved', 'admin-reject-revoke'].includes(action) && !canAdminRevokeApprovedTransaction) {
      notifyError('You do not have permission to manage approved-transaction revoke requests')
      return
    }

    setLoading(true)
    try {
      if (action === 'take') {
        await takeOperationTaskOwnership(taskId, remarks)
        notifySuccess('Task ownership taken.')
      } else if (action === 'release') {
        await releaseOperationTask(taskId, remarks)
        notifySuccess('Task released back to the queue.')
      } else if (action === 'approve') {
        await approveOperationTask(taskId, remarks || 'Approved from Task Manager')
        notifySuccess('Operation ticket approved.')
      } else if (action === 'reject') {
        await rejectOperationTask(taskId, remarks || 'Rejected from Task Manager')
        notifySuccess('Operation ticket rejected.')
      } else if (action === 'admin-revoke-approved') {
        await adminRevokeApprovedTransactionTask(
          taskId,
          remarks || 'Admin revoked approved transaction for correction'
        )
        notifySuccess('Approved transaction revoked.')
      } else if (action === 'admin-reject-revoke') {
        await adminRejectApprovedRevokeTask(
          taskId,
          remarks || 'Admin rejected approved transaction revoke request'
        )
        notifySuccess('Revoke request rejected.')
      }

      await loadTasks()
      if (typeof reloadOperationTransactions === 'function') {
        await reloadOperationTransactions()
      }
      const refreshedTask = await getOperationTask(taskId)
      setSelectedTask(refreshedTask)
      await loadEvents(taskId)
      setRemarks('')
    } catch (error) {
      notifyError(error.message || 'Task action could not be completed')
    } finally {
      setLoading(false)
    }
  }

  const toggleTaskSelection = (task, checked) => {
    if (!canBulkApprove(task)) return
    setSelectedTaskIds((current) => checked
      ? (current.includes(task.id) ? current : [...current, task.id])
      : current.filter((id) => id !== task.id)
    )
  }

  const toggleSelectAll = (checked) => {
    setSelectedTaskIds(checked ? bulkEligibleTasks.map((task) => task.id) : [])
  }

  const startBulkApproval = () => {
    if (selectedBulkTasks.length === 0) {
      notifyError('Select at least one pending or in-progress operation approval task')
      return
    }
    setBulkModal({ remarks: '' })
  }

  const executeBulkApproval = async () => {
    if (!bulkModal || selectedBulkTasks.length === 0) return
    if (!canApproveTransaction) {
      notifyError('Bulk approval requires the same task and transaction approval permissions as single-ticket approval')
      return
    }

    const sharedRemarks = bulkModal.remarks.trim() || 'Bulk approved from Task Manager'
    const taskBatch = [...selectedBulkTasks]
    const succeeded = []
    const failed = []
    setBulkProcessing(true)
    setLoading(true)
    clearError()

    try {
      for (const task of taskBatch) {
        try {
          await approveOperationTask(task.id, sharedRemarks)
          succeeded.push(task)
        } catch (error) {
          failed.push({ task, message: error.message || 'Approval failed' })
        }
      }

      setSelectedTaskIds([])
      setBulkModal(null)
      await loadTasks()
      if (typeof reloadOperationTransactions === 'function') {
        await reloadOperationTransactions()
      }

      if (failed.length === 0) {
        notifySuccess(`${succeeded.length} ticket${succeeded.length === 1 ? '' : 's'} approved with the shared remarks.`)
      } else {
        const failureDetails = failed
          .map(({ task, message }) => `${task.ticketNumber || task.taskNumber}: ${message}`)
          .join(' | ')
        const summary = `${succeeded.length} approved; ${failed.length} failed. ${failureDetails}`
        if (succeeded.length > 0) {
          notifyError(summary)
        } else {
          notifyError(`No tickets were approved. ${summary}`)
        }
      }
    } finally {
      setBulkProcessing(false)
      setLoading(false)
    }
  }

  const selectedTaskOpen = isOpenTask(selectedTask)
  const canActOnSelectedApproval =
    canActOnOperationTask && selectedTask?.taskType === 'OPERATION_APPROVAL' && selectedTaskOpen
  const canActOnSelectedRevoke =
    canAdminRevokeApprovedTransaction &&
    selectedTask?.taskType === 'APPROVED_TRANSACTION_REVOKE_REQUEST' &&
    selectedTaskOpen
  const isTaskOwner = Number(selectedTask?.takenByUserId) === Number(loggedInUser?.id)
  const canReleaseSelectedTask =
    canActOnSelectedApproval &&
    selectedTask?.status === 'In Progress' &&
    (isTaskOwner || canSupervise)

  return (
    <div className="operation-task-manager-page">
      <div className="page-title">
        <div>
          <h2>Task Manager</h2>
          <p>Review assigned tickets, track each decision and approve multiple tickets using one shared remark.</p>
        </div>
        <span className="record-count">{counts.ALL || 0} Tasks</span>
      </div>

      <AlertMessage tone="success" message={feedback.successMsg} onDismiss={clearSuccess} />
      <AlertMessage tone="error" message={feedback.errorMsg} onDismiss={clearError} />

      {!canActOnOperationTask && !canAdminRevokeApprovedTransaction && (
        <div className="info-box">
          You have view-only access. Assign <strong>Act On Operation Task</strong> to take/release and approve/reject assigned tickets, or <strong>Admin Revoke Approved Transaction</strong> to manage approved-ticket correction requests.
        </div>
      )}
      {canActOnOperationTask && !canApproveTransaction && (
        <div className="info-box">
          You can manage task ownership, but approval requires <strong>Approve Operation Transaction</strong> and <strong>Review Operation Transaction</strong>. Rejection requires <strong>Reject Operation Transaction</strong>.
        </div>
      )}

      <div className="list-tabs task-status-tabs" role="tablist" aria-label="Task status">
        {STATUS_TABS.map((status) => (
          <button
            key={status}
            type="button"
            role="tab"
            aria-selected={statusFilter === status}
            className="list-tab"
            onClick={() => { setSelectedTaskIds([]); setStatusFilter(status) }}
          >
            {status === 'ALL' ? 'All tasks' : status}
            <span className="list-tab-count">{counts[status] || 0}</span>
          </button>
        ))}
      </div>

      <div className="filter-panel task-manager-filter-panel">
        <div>
          <label htmlFor="task-type-filter">Task Type</label>
          <select
            id="task-type-filter"
            value={taskTypeFilter}
            onChange={(event) => { setSelectedTaskIds([]); setTaskTypeFilter(event.target.value) }}
            disabled={loading}
          >
            <option value="ALL">All Task Types</option>
            <option value="OPERATION_APPROVAL">Operation Approval</option>
            <option value="APPROVED_TRANSACTION_REVOKE_REQUEST">Approved Transaction Revoke</option>
            <option value="PASSWORD_RESET_REQUEST">Password Reset Request</option>
          </select>
        </div>
        <div>
          <label htmlFor="task-search">Search</label>
          <input
            id="task-search"
            value={search}
            onChange={(event) => { setSelectedTaskIds([]); setSearch(event.target.value) }}
            placeholder="Task, ticket, operation, asset, location"
            disabled={loading}
          />
        </div>
        <div>
          <label htmlFor="task-date-from">Submitted From</label>
          <input id="task-date-from" type="date" value={dateFrom} onChange={(event) => { setSelectedTaskIds([]); setDateFrom(event.target.value) }} disabled={loading} />
        </div>
        <div>
          <label htmlFor="task-date-to">Submitted To</label>
          <input id="task-date-to" type="date" value={dateTo} onChange={(event) => { setSelectedTaskIds([]); setDateTo(event.target.value) }} disabled={loading} />
        </div>
        <div className="filter-actions task-filter-actions">
          <button type="button" onClick={loadTasks} disabled={loading || invalidDateRange}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
          <button type="button" onClick={clearFilters} disabled={loading} className="btn-secondary">
            Clear
          </button>
        </div>
      </div>

      {invalidDateRange && (
        <div className="info-box task-date-warning">
          Submitted From cannot be later than Submitted To. Correct the date range to continue.
        </div>
      )}

      {canApproveTransaction && selectedBulkTasks.length > 0 && (
        <div className="task-bulk-toolbar">
          <div>
            <strong>{selectedBulkTasks.length} selected</strong>
            <span>One remark will be applied to every selected approval.</span>
          </div>
          <div className="form-actions">
            <button type="button" onClick={startBulkApproval} disabled={loading || bulkProcessing}>
              Approve Selected
            </button>
            <button type="button" className="btn-secondary" onClick={() => setSelectedTaskIds([])} disabled={loading || bulkProcessing}>
              Clear Selection
            </button>
          </div>
        </div>
      )}

      <div className="task-table-scroll">
        <table className="task-manager-table">
          <thead>
            <tr>
              <th className="task-select-col">
                <input
                  type="checkbox"
                  aria-label="Select all approvable tasks shown"
                  checked={allEligibleSelected}
                  disabled={!canApproveTransaction || bulkEligibleTasks.length === 0 || loading}
                  onChange={(event) => toggleSelectAll(event.target.checked)}
                />
              </th>
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
            {loading ? (
              <tr><td colSpan="10" className="empty-table">Loading tasks…</td></tr>
            ) : visibleTasks.length === 0 ? (
              <tr><td colSpan="10" className="empty-table">No tasks found for this filter.</td></tr>
            ) : visibleTasks.map((task) => {
              const approvable = canBulkApprove(task)
              return (
                <tr key={task.id}>
                  <td className="task-select-col">
                    <input
                      type="checkbox"
                      aria-label={`Select ${task.ticketNumber || task.taskNumber} for bulk approval`}
                      checked={selectedTaskIds.includes(task.id)}
                      disabled={!approvable || loading}
                      onChange={(event) => toggleTaskSelection(task, event.target.checked)}
                    />
                  </td>
                  <td>
                    <strong>{task.taskNumber}</strong>
                    <span className="task-type-subtitle">{TASK_TYPE_LABELS[task.taskType] || task.taskType}</span>
                  </td>
                  <td>{task.ticketNumber || task.operationNumber || '-'}</td>
                  <td>{task.operationTypeCode || '-'}</td>
                  <td>{task.primaryAssetCode || '-'}{task.assetTypeCode ? ` (${task.assetTypeCode})` : ''}</td>
                  <td>{task.locationCode || '-'}</td>
                  <td>{task.priority || 'Normal'}</td>
                  <td><span className={`status-badge ${String(task.status || '').toLowerCase().replace(/\s+/g, '-')}`}>{task.status}</span></td>
                  <td>{formatDateTime(task.createdAt)}</td>
                  <td><button type="button" className="btn-secondary" onClick={() => selectTask(task)}>View</button></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <Modal
        open={Boolean(selectedTask)}
        title={selectedTask ? `${selectedTask.taskNumber} · ${selectedTask.ticketNumber || selectedTask.operationNumber || 'Task details'}` : 'Task details'}
        description={selectedTask ? (TASK_TYPE_LABELS[selectedTask.taskType] || selectedTask.taskType) : ''}
        onClose={closeTaskDetails}
        size="xl"
        className="task-manager-detail-modal"
        footer={<button type="button" className="btn-secondary" onClick={closeTaskDetails}>Close</button>}
      >
        {selectedTask && (
          <div className="task-details-layout">
            <div className="task-details-main">
              <div className="task-detail-summary-grid">
                <div><span>Status</span><strong><span className={`status-badge ${String(selectedTask.status || '').toLowerCase().replace(/\s+/g, '-')}`}>{selectedTask.status}</span></strong></div>
                <div><span>Operation</span><strong>{selectedTask.operationTypeCode || '-'}</strong></div>
                <div><span>Asset</span><strong>{selectedTask.primaryAssetCode || '-'}</strong></div>
                <div><span>Location</span><strong>{selectedTask.locationCode || '-'}</strong></div>
                <div><span>Priority</span><strong>{selectedTask.priority || 'Normal'}</strong></div>
                <div><span>Submitted</span><strong>{formatDateTime(selectedTask.createdAt)}</strong></div>
              </div>

              {selectedTask.remarks && (
                <div className="task-note-panel">
                  <span>Task / previous action notes</span>
                  <p>{selectedTask.remarks}</p>
                </div>
              )}

              {selectedTask.transactionId ? (
                canViewOperationTransaction ? (
                  <div className="task-ticket-link">
                    <Link to={`/operation-transactions/${selectedTask.transactionId}`} onClick={closeTaskDetails}>
                      Open full operation ticket
                    </Link>
                    {selectedTask.transaction?.status && <span>Ticket status: {selectedTask.transaction.status}</span>}
                  </div>
                ) : (
                  <div className="task-ticket-link"><span>Ticket status: {selectedTask.transaction?.status || '-'}</span></div>
                )
              ) : (
                <div className="info-box">This task is not linked to an operation ticket. Use its relevant admin workflow to complete the request.</div>
              )}

              {(canActOnSelectedApproval || canActOnSelectedRevoke) && (
                <section className="task-action-panel">
                  <div className="section-title compact-section-title">
                    <h3>{canActOnSelectedRevoke ? 'Admin review' : 'Review action'}</h3>
                    <p>{selectedTask.takenByUserId ? `Owned by user #${selectedTask.takenByUserId}` : 'Not currently owned'}</p>
                  </div>
                  <label htmlFor="task-action-remarks">Action remarks</label>
                  <textarea
                    id="task-action-remarks"
                    rows="3"
                    value={remarks}
                    onChange={(event) => setRemarks(event.target.value)}
                    placeholder="Add a review note (optional for approval)"
                    disabled={loading}
                  />
                  <div className="form-actions task-action-buttons">
                    {canActOnSelectedApproval && (
                      <>
                        <button type="button" className="btn-secondary" onClick={() => runAction('take')} disabled={loading || !canActOnOperationTask}>Take Ownership</button>
                        <button type="button" className="btn-secondary" onClick={() => runAction('release')} disabled={loading || !canReleaseSelectedTask}>Release</button>
                        <button type="button" onClick={() => runAction('approve')} disabled={loading || !canApproveTransaction}>Approve</button>
                        <button type="button" className="btn-danger" onClick={() => runAction('reject')} disabled={loading || !canRejectTransaction}>Reject</button>
                      </>
                    )}
                    {canActOnSelectedRevoke && (
                      <>
                        <button type="button" className="btn-danger" onClick={() => runAction('admin-revoke-approved')} disabled={loading}>Admin Revoke Approval</button>
                        <button type="button" className="btn-secondary" onClick={() => runAction('admin-reject-revoke')} disabled={loading}>Reject Revoke Request</button>
                      </>
                    )}
                  </div>
                  {canActOnSelectedApproval && !canReleaseSelectedTask && selectedTask.status === 'In Progress' && (
                    <p className="task-action-hint">Only the current owner or a task supervisor can release this task.</p>
                  )}
                </section>
              )}

              {selectedTask.taskType === 'OPERATION_APPROVAL' && selectedTaskOpen && !canActOnOperationTask && (
                <div className="info-box">This approval task is assigned to you for viewing, but your role does not include <strong>Act On Operation Task</strong>.</div>
              )}
            </div>

            <aside className="task-history-panel">
              <div className="section-title compact-section-title"><h3>Task history</h3></div>
              <div className="task-history-table-scroll">
                <table>
                  <thead><tr><th>Event</th><th>Status</th><th>Actor / Notes</th><th>Time</th></tr></thead>
                  <tbody>
                    {events.length === 0 ? (
                      <tr><td colSpan="4" className="empty-table">No task history available.</td></tr>
                    ) : events.map((event) => (
                      <tr key={event.id}>
                        <td><strong>{event.eventType}</strong></td>
                        <td>{event.oldStatus || '-'} → {event.newStatus || '-'}</td>
                        <td>{event.actorDisplay || '-'}{event.notes ? <p className="task-event-note">{event.notes}</p> : null}</td>
                        <td>{formatDateTime(event.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </aside>
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(confirmAction)}
        title="Confirm task action"
        description={confirmAction?.message || ''}
        onClose={() => setConfirmAction(null)}
        size="sm"
        footer={(
          <>
            <button type="button" className="btn-secondary" onClick={() => setConfirmAction(null)}>Cancel</button>
            <button type="button" onClick={confirmRunAction} disabled={loading}>Confirm</button>
          </>
        )}
      >
        <p className="task-confirm-note">This action will be recorded in the ticket and task history.</p>
      </Modal>

      <Modal
        open={Boolean(bulkModal)}
        title={`Approve ${selectedBulkTasks.length} selected ticket${selectedBulkTasks.length === 1 ? '' : 's'}`}
        description="One shared remark will be sent with every selected approval."
        onClose={() => !bulkProcessing && setBulkModal(null)}
        size="md"
        footer={(
          <>
            <button type="button" className="btn-secondary" onClick={() => setBulkModal(null)} disabled={bulkProcessing}>Cancel</button>
            <button type="button" onClick={executeBulkApproval} disabled={bulkProcessing || selectedBulkTasks.length === 0}>
              {bulkProcessing ? 'Approving…' : `Approve ${selectedBulkTasks.length} ticket${selectedBulkTasks.length === 1 ? '' : 's'}`}
            </button>
          </>
        )}
      >
        {bulkModal && (
          <div className="bulk-approval-dialog">
            <div className="info-box">
              Each ticket is approved separately. If one ticket fails validation, the remaining tickets will still be processed and the results will be summarized.
            </div>
            <label htmlFor="bulk-approval-remarks">Shared approval remarks</label>
            <textarea
              id="bulk-approval-remarks"
              rows="4"
              value={bulkModal.remarks}
              onChange={(event) => setBulkModal((current) => ({ ...current, remarks: event.target.value }))}
              placeholder="For example: Reviewed and approved for the convoy"
              disabled={bulkProcessing}
            />
            <p className="muted-table-text">If left blank, “Bulk approved from Task Manager” will be used for all selected tickets.</p>
            <div className="bulk-approval-list">
              {selectedBulkTasks.map((task) => (
                <div key={task.id}><strong>{task.ticketNumber || task.taskNumber}</strong><span>{task.primaryAssetCode || '-'} · {task.locationCode || '-'}</span></div>
              ))}
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

export default OperationTaskManager
