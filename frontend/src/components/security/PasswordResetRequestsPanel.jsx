import { useCallback, useEffect, useMemo, useState } from 'react'
import AlertMessage from '../common/AlertMessage'
import DataTableToolbar from '../common/DataTableToolbar'
import Modal from '../common/Modal'
import PaginationControls, { paginateRows, usePageSize } from '../common/PaginationControls'
import Icon from '../common/Icon'
import useActionFeedback from '../../hooks/useActionFeedback'
import usePermissions from '../../hooks/usePermissions'
import { useDataFilters } from '../../hooks/useDataFilters'
import { logUiAction } from '../../utils/actionLogger'
import {
  approvePasswordResetRequest,
  getPasswordResetRequests,
  rejectPasswordResetRequest,
} from '../../api/securityApi'
import {
  CopyableSecret,
  PasswordInput,
  PasswordPolicyChecklist,
  SecurityMetric,
  SecurityPill,
  buildPasswordChecks,
  formatSecurityDateTime,
} from './SecurityPrimitives'

const STATUS_TONE = {
  pending: 'pending',
  approved: 'approved',
  completed: 'approved',
  rejected: 'rejected',
  cancelled: 'inactive',
}

const STATUS_OPTIONS = [
  { value: 'all', label: 'All requests' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'cancelled', label: 'Cancelled' },
]

function ApproveRequestDialog({ open, request, loggedInUser, onClose, onApproved }) {
  const { hasPermission } = usePermissions(loggedInUser)
  const canReset2FA = hasPermission('Reset User 2FA')
  const [mode, setMode] = useState('generate')
  const [form, setForm] = useState({
    newPassword: '',
    forcePasswordChange: true,
    reset2FA: false,
    remarks: '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)

  useEffect(() => {
    if (!open || !request) return
    setMode('generate')
    setForm({
      newPassword: '',
      forcePasswordChange: true,
      reset2FA: Boolean(request.reset2FA),
      remarks: '',
    })
    setBusy(false)
    setError('')
    setResult(null)
  }, [open, request?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const passwordChecks = useMemo(
    () => buildPasswordChecks(form.newPassword, { user: request ? { username: request.username, fullName: request.fullName } : null }),
    [form.newPassword, request]
  )
  const manualPasswordValid = passwordChecks.every((check) => check.met)

  if (!request) return null

  const submit = async (event) => {
    event.preventDefault()
    setError('')
    if (mode === 'manual' && !manualPasswordValid) {
      setError('The new password does not meet the password policy.')
      return
    }
    setBusy(true)
    try {
      const response = await approvePasswordResetRequest(request.id, {
        generatePassword: mode === 'generate',
        newPassword: form.newPassword,
        forcePasswordChange: form.forcePasswordChange,
        reset2FA: canReset2FA ? form.reset2FA : false,
        remarks: form.remarks || `Approved request ${request.requestNumber}`,
      })
      setResult(response)
      logUiAction('Profile & Security', 'Approve Password Reset Request', {
        requestNumber: request.requestNumber,
        username: request.username,
      })
      await onApproved?.()
    } catch (submitError) {
      setError(submitError.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={`Approve password reset — ${request.requestNumber}`}
      description={`${request.fullName || request.username} (${request.username}) requested ${formatSecurityDateTime(request.requestedAt)}`}
      footer={
        <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
          Close
        </button>
      }
    >
      <AlertMessage tone="error" message={error} onDismiss={() => setError('')} />
      {request.reset2FA && !canReset2FA && (
        <AlertMessage
          tone="warning"
          message="The user asked for a two-factor reset, but you do not hold the Reset User 2FA permission. Approving will reset the password only."
        />
      )}

      <div className="security-dialog-facts security-dialog-facts-inline">
        <div>
          <span>User</span>
          <strong>{request.fullName || request.username}</strong>
        </div>
        <div>
          <span>Reason</span>
          <strong>{request.reason || 'No reason provided'}</strong>
        </div>
        <div>
          <span>Task</span>
          <strong>{request.taskNumber || '—'}</strong>
        </div>
        <div>
          <span>2FA reset requested</span>
          <strong>{request.reset2FA ? 'Yes' : 'No'}</strong>
        </div>
      </div>

      {result ? (
        <div className="security-approval-result">
          <div className="security-recovery-heading">
            <Icon name="checkCircle" size={18} />
            <strong>Password reset approved</strong>
          </div>
          <p>
            All sessions for this user have been revoked. The request and its Task Manager task are
            closed.
          </p>
          {result.temporaryPassword && (
            <CopyableSecret
              value={result.temporaryPassword}
              label="Temporary password (shown once)"
              hint="Share it through a secure channel. It will not be shown again."
            />
          )}
          {result.request && (
            <p className="security-muted-text">
              Request status: <strong>{result.request.status}</strong>
            </p>
          )}
        </div>
      ) : (
        <form className="security-form" onSubmit={submit}>
          <div className="security-radio-row security-form-wide">
            <label>
              <input
                type="radio"
                name="approve-password-mode"
                checked={mode === 'generate'}
                onChange={() => setMode('generate')}
              />
              Generate a secure temporary password
            </label>
            <label>
              <input
                type="radio"
                name="approve-password-mode"
                checked={mode === 'manual'}
                onChange={() => setMode('manual')}
              />
              Enter a password manually
            </label>
          </div>

          {mode === 'manual' && (
            <>
              <PasswordInput
                id="approve-new-password"
                label="New password"
                value={form.newPassword}
                onChange={(value) => setForm((current) => ({ ...current, newPassword: value }))}
                autoComplete="new-password"
              />
              <div className="security-form-wide">
                <PasswordPolicyChecklist
                  password={form.newPassword}
                  user={{ username: request.username, fullName: request.fullName }}
                />
              </div>
            </>
          )}

          <div className="security-checkbox-stack security-form-wide">
            <label>
              <input
                type="checkbox"
                checked={form.forcePasswordChange}
                onChange={(event) =>
                  setForm((current) => ({ ...current, forcePasswordChange: event.target.checked }))
                }
              />
              Force a password change at next sign-in
            </label>
            {canReset2FA && (
              <label>
                <input
                  type="checkbox"
                  checked={form.reset2FA}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, reset2FA: event.target.checked }))
                  }
                />
                Reset two-factor authentication for this user
              </label>
            )}
          </div>

          <div className="security-field security-form-wide">
            <label htmlFor="approve-remarks">Approval notes</label>
            <textarea
              id="approve-remarks"
              rows="2"
              value={form.remarks}
              onChange={(event) => setForm((current) => ({ ...current, remarks: event.target.value }))}
              placeholder="Identity verification, ticket reference or other notes"
            />
          </div>

          <div className="security-form-actions security-form-wide">
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? 'Approving…' : 'Approve and reset password'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  )
}

function RejectRequestDialog({ open, request, onClose, onRejected }) {
  const [remarks, setRemarks] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setRemarks('')
    setBusy(false)
    setError('')
  }, [open, request?.id])

  if (!request) return null

  const submit = async (event) => {
    event.preventDefault()
    setError('')
    if (remarks.trim().length < 3) {
      setError('A rejection reason is required (at least 3 characters).')
      return
    }
    setBusy(true)
    try {
      await rejectPasswordResetRequest(request.id, remarks.trim())
      logUiAction('Profile & Security', 'Reject Password Reset Request', {
        requestNumber: request.requestNumber,
      })
      await onRejected?.()
      onClose()
    } catch (submitError) {
      setError(submitError.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title={`Reject password reset — ${request.requestNumber}`}
      description={`${request.fullName || request.username} (${request.username})`}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" form="reject-reset-form" className="btn-danger" disabled={busy}>
            {busy ? 'Rejecting…' : 'Reject request'}
          </button>
        </>
      }
    >
      <AlertMessage tone="error" message={error} onDismiss={() => setError('')} />
      <form id="reject-reset-form" className="security-form" onSubmit={submit}>
        <div className="security-field security-form-wide">
          <label htmlFor="reject-remarks">Rejection reason</label>
          <textarea
            id="reject-remarks"
            rows="3"
            value={remarks}
            onChange={(event) => setRemarks(event.target.value)}
            placeholder="Why is this request being rejected?"
            required
          />
          <small className="security-field-hint">
            The user sees this note on their Profile &amp; Security page.
          </small>
        </div>
      </form>
    </Modal>
  )
}

function PasswordResetRequestsPanel({ loggedInUser, onSecurityChanged }) {
  const feedback = useActionFeedback()
  const { hasPermission } = usePermissions(loggedInUser)
  const pageSize = usePageSize()

  const canView = hasPermission('View User Security')
  const canReview = hasPermission('Approve Password Reset Requests')
  const canApprove = canReview && hasPermission('Reset User Password')

  const [items, setItems] = useState([])
  const [statusFilter, setStatusFilter] = useState('pending')
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [approveRequest, setApproveRequest] = useState(null)
  const [rejectRequest, setRejectRequest] = useState(null)

  const loadRequests = useCallback(async () => {
    if (!canView) return
    setLoading(true)
    try {
      const result = await getPasswordResetRequests({ limit: 2000, status: 'all' })
      setItems(result.items)
    } catch (error) {
      feedback.notifyError(error.message)
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [canView, feedback])

  useEffect(() => {
    loadRequests()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView])

  const counts = useMemo(() => {
    const result = { pending: 0, approved: 0, rejected: 0, cancelled: 0 }
    items.forEach((item) => {
      const key = String(item.status || '').toLowerCase()
      if (key in result) result[key] += 1
    })
    return result
  }, [items])

  const baseRows = useMemo(
    () =>
      items.filter((item) => {
        if (statusFilter === 'all') return true
        const status = String(item.status || '').toLowerCase()
        return status === statusFilter || (statusFilter === 'approved' && status === 'completed')
      }),
    [items, statusFilter]
  )

  const filterColumns = useMemo(
    () => [
      { key: 'requestNumber', label: 'Request' },
      { key: 'username', label: 'Username' },
      { key: 'fullName', label: 'User' },
      { key: 'status', label: 'Status', type: 'select' },
      { key: 'reason', label: 'Reason' },
      { key: 'requestedAt', label: 'Requested', type: 'date' },
      { key: 'taskNumber', label: 'Task' },
      { key: 'actionNotes', label: 'Notes' },
    ],
    []
  )

  const filters = useDataFilters(baseRows, filterColumns, { module: 'Password Reset Requests' })
  const visibleRows = paginateRows(filters.filteredRows, page, pageSize)

  const handleChanged = async () => {
    await loadRequests()
    await onSecurityChanged?.()
  }

  if (!canView) {
    return (
      <AlertMessage
        tone="warning"
        title="View User Security permission required"
        message="The password reset queue is available to administrators with View User Security."
      />
    )
  }

  return (
    <div className="security-panel">
      <AlertMessage tone="success" message={feedback.successMsg} onDismiss={feedback.clearSuccess} />
      <AlertMessage tone="error" message={feedback.errorMsg} onDismiss={feedback.clearError} />

      <div className="security-metric-grid security-metric-grid-4">
        <SecurityMetric
          label="Pending"
          value={counts.pending}
          hint="Awaiting administrator action"
          tone={counts.pending > 0 ? 'warning' : 'active'}
          icon="history"
        />
        <SecurityMetric label="Approved" value={counts.approved} tone="active" icon="checkCircle" />
        <SecurityMetric label="Rejected" value={counts.rejected} tone="neutral" icon="alertCircle" />
        <SecurityMetric label="Cancelled" value={counts.cancelled} tone="neutral" icon="close" />
      </div>

      <div className="security-toolbar-note">
        <Icon name="info" size={15} />
        Approving a request resets the password (generated or manual), unlocks the account, revokes
        all sessions and closes the linked Task Manager task. Users who requested a 2FA reset also
        lose their authenticator and recovery codes.
      </div>

      <DataTableToolbar
        filters={filters}
        columns={filterColumns}
        exportFileName="password-reset-requests"
        exportTitle="Password Reset Requests"
        exportSubtitle="Self-service password reset workflow"
        module="Password Reset Requests"
        searchPlaceholder="Search request number, user or reason…"
        extraActions={
          <>
            <label className="security-toolbar-select">
              <span className="visually-hidden">Filter by status</span>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                    {option.value !== 'all' && counts[option.value] !== undefined
                      ? ` (${counts[option.value]})`
                      : ''}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="btn-secondary" onClick={loadRequests} disabled={loading}>
              <Icon name="refresh" size={15} />
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
          </>
        }
      />

      <div className="table-scroll">
        <table className="security-table">
          <thead>
            <tr>
              <th>Request</th>
              <th>User</th>
              <th>Requested</th>
              <th>Reason</th>
              <th>2FA</th>
              <th>Status</th>
              <th>Task</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && items.length === 0 ? (
              <tr>
                <td colSpan={8} className="empty-table">Loading reset requests…</td>
              </tr>
            ) : filters.filteredRows.length === 0 ? (
              <tr>
                <td colSpan={8} className="empty-table">
                  No password reset requests in this view.
                </td>
              </tr>
            ) : (
              visibleRows.map((request) => {
                const statusKey = String(request.status || '').toLowerCase()
                const pending = statusKey === 'pending'
                return (
                  <tr key={request.id}>
                    <td>
                      <strong className="security-mono">{request.requestNumber}</strong>
                    </td>
                    <td>
                      <div className="security-user-cell">
                        <strong>{request.fullName || request.username}</strong>
                        <span>{request.username}</span>
                        {request.userLocked && (
                          <SecurityPill tone="locked" icon="lock">Account locked</SecurityPill>
                        )}
                      </div>
                    </td>
                    <td>{formatSecurityDateTime(request.requestedAt)}</td>
                    <td>
                      <span className="security-wrap-text">{request.reason || '—'}</span>
                    </td>
                    <td>
                      {request.reset2FA ? (
                        <SecurityPill tone="info" icon="shieldCheck">Reset requested</SecurityPill>
                      ) : (
                        <span className="security-muted-text">No</span>
                      )}
                    </td>
                    <td>
                      <SecurityPill tone={STATUS_TONE[statusKey] || 'neutral'}>
                        {request.status}
                      </SecurityPill>
                      {request.actionNotes && (
                        <span className="security-cell-meta security-wrap-text">
                          {request.actionNotes}
                        </span>
                      )}
                    </td>
                    <td>
                      {request.taskNumber ? (
                        <div className="security-cell-stack">
                          <span className="security-mono">{request.taskNumber}</span>
                          <span className="security-cell-meta">{request.taskStatus || '—'}</span>
                        </div>
                      ) : (
                        <span className="security-muted-text">—</span>
                      )}
                    </td>
                    <td>
                      {pending ? (
                        <div className="security-row-actions">
                          {canReview ? (
                            <>
                              {canApprove && (
                                <button
                                  type="button"
                                  className="btn-primary btn-compact"
                                  onClick={() => setApproveRequest(request)}
                                >
                                  <Icon name="checkCircle" size={14} />
                                  Approve
                                </button>
                              )}
                              <button
                                type="button"
                                className="btn-danger-outline btn-compact"
                                onClick={() => setRejectRequest(request)}
                              >
                                Reject
                              </button>
                            </>
                          ) : (
                            <span className="security-muted-text">No review permission</span>
                          )}
                        </div>
                      ) : (
                        <span className="security-muted-text">Closed</span>
                      )}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      <PaginationControls
        currentPage={page}
        totalRows={filters.filteredRows.length}
        onPageChange={setPage}
      />

      <ApproveRequestDialog
        open={Boolean(approveRequest)}
        request={approveRequest}
        loggedInUser={loggedInUser}
        onClose={() => setApproveRequest(null)}
        onApproved={handleChanged}
      />
      <RejectRequestDialog
        open={Boolean(rejectRequest)}
        request={rejectRequest}
        onClose={() => setRejectRequest(null)}
        onRejected={handleChanged}
      />
    </div>
  )
}

export default PasswordResetRequestsPanel
