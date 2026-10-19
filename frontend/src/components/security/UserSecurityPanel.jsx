import { useCallback, useEffect, useMemo, useState } from 'react'
import AlertMessage from '../common/AlertMessage'
import DataTableToolbar from '../common/DataTableToolbar'
import PaginationControls, { paginateRows, usePageSize } from '../common/PaginationControls'
import Icon from '../common/Icon'
import useActionFeedback from '../../hooks/useActionFeedback'
import usePermissions from '../../hooks/usePermissions'
import { useDataFilters } from '../../hooks/useDataFilters'
import { logUiAction } from '../../utils/actionLogger'
import { getSecurityUsers } from '../../api/securityApi'
import UserSecurityDialog from './UserSecurityDialog'
import { SecurityPill, formatLockUntil, formatSecurityDateTime } from './SecurityPrimitives'

const FETCH_CHUNK = 2000
const STATUS_OPTIONS = [
  { value: 'all', label: 'All accounts' },
  { value: 'locked', label: 'Locked accounts' },
  { value: 'active', label: 'Active accounts' },
  { value: 'inactive', label: 'Inactive accounts' },
  { value: 'blocked', label: 'Blocked accounts' },
  { value: '2fa_enabled', label: '2FA enabled' },
  { value: '2fa_disabled', label: '2FA not enabled' },
  { value: 'password_change_required', label: 'Password change required' },
  { value: 'password_expired', label: 'Password expired' },
  { value: 'no_2fa', label: 'Active without 2FA' },
]

const matchesStatus = (user, status) => {
  switch (status) {
    case 'locked':
      return user.isLocked
    case 'active':
      return user.status === 'Active' && !user.isLocked
    case 'inactive':
      return user.status === 'Inactive'
    case 'blocked':
      return user.status === 'Blocked'
    case '2fa_enabled':
      return user.totpEnabled
    case '2fa_disabled':
      return !user.totpEnabled
    case 'password_change_required':
      return user.passwordChangeRequired
    case 'password_expired':
      return user.passwordExpired
    case 'no_2fa':
      return user.status === 'Active' && !user.totpEnabled
    default:
      return true
  }
}

const passwordLabel = (user) => {
  if (user.passwordExpired) return 'Expired'
  if (user.forcePasswordChange) return 'Change required'
  if (user.passwordNeverExpires) return 'Never expires'
  if (user.passwordChangedAt) return 'Active'
  return 'Not recorded'
}

const twoFactorLabel = (user) => {
  if (user.totpEnabled) return 'Enabled'
  if (user.force2FA) return 'Required — not enrolled'
  return 'Not enabled'
}

function UserSecurityPanel({ loggedInUser, onSecurityChanged, initialUserId }) {
  const feedback = useActionFeedback()
  const { hasPermission } = usePermissions(loggedInUser)
  const pageSize = usePageSize()

  const [users, setUsers] = useState([])
  const [listLoading, setListLoading] = useState(false)
  const [statusFilter, setStatusFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [selectedUserId, setSelectedUserId] = useState(initialUserId || null)
  const [dialogOpen, setDialogOpen] = useState(Boolean(initialUserId))

  const canViewSecurity = hasPermission('View User Security')

  const loadAll = useCallback(async () => {
    if (!canViewSecurity) return
    setListLoading(true)
    try {
      await Promise.resolve()
      const collected = []
      let skip = 0
      let more = true
      while (more) {
        const result = await getSecurityUsers({ skip, limit: FETCH_CHUNK, status: 'all' })
        collected.push(...result.items)
        more = result.hasMore && result.items.length > 0
        skip += FETCH_CHUNK
        if (collected.length >= 20000) break
      }
      setUsers(collected)
    } catch (error) {
      feedback.notifyError(error.message)
      setUsers([])
    } finally {
      setListLoading(false)
    }
  }, [canViewSecurity, feedback])

  useEffect(() => {
    loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canViewSecurity])

  const decoratedUsers = useMemo(
    () =>
      users.map((user) => ({
        ...user,
        rolesLabel: user.roles.map((role) => role.role_name).join(', '),
        lockLabel: user.isLocked ? 'Locked' : 'Unlocked',
        twoFactorLabel: twoFactorLabel(user),
        passwordLabel: passwordLabel(user),
      })),
    [users]
  )

  const baseRows = useMemo(
    () => decoratedUsers.filter((user) => matchesStatus(user, statusFilter)),
    [decoratedUsers, statusFilter]
  )

  const filterColumns = useMemo(
    () => [
      { key: 'fullName', label: 'User' },
      { key: 'username', label: 'Username' },
      { key: 'email', label: 'Email' },
      { key: 'department', label: 'Department' },
      { key: 'rolesLabel', label: 'Roles' },
      { key: 'status', label: 'Account status', type: 'select' },
      { key: 'lockLabel', label: 'Lock state', type: 'select' },
      { key: 'twoFactorLabel', label: 'Two-factor', type: 'select' },
      { key: 'passwordLabel', label: 'Password', type: 'select' },
      { key: 'failedLoginCount', label: 'Failed attempts', type: 'number' },
      { key: 'lastLoginAt', label: 'Last sign-in', type: 'date' },
    ],
    []
  )

  const filters = useDataFilters(baseRows, filterColumns, { module: 'User Security' })
  const visibleRows = paginateRows(filters.filteredRows, page, pageSize)

  const selectedUser = useMemo(
    () => users.find((user) => user.id === selectedUserId) || null,
    [users, selectedUserId]
  )

  const openUser = (user) => {
    if (!canViewSecurity) return
    setSelectedUserId(user.id)
    setDialogOpen(true)
    logUiAction('Profile & Security', 'Open User Security', { username: user.username })
  }

  const handleChanged = async () => {
    await loadAll()
    await onSecurityChanged?.()
  }

  if (!canViewSecurity) {
    return (
      <AlertMessage
        tone="warning"
        title="View User Security permission required"
        message="Ask an administrator to grant View User Security to inspect or manage other accounts."
      />
    )
  }

  return (
    <div className="security-panel">
      <AlertMessage tone="success" message={feedback.successMsg} onDismiss={feedback.clearSuccess} />
      <AlertMessage tone="error" message={feedback.errorMsg} onDismiss={feedback.clearError} />

      <div className="security-toolbar-note">
        <Icon name="info" size={15} />
        Locked accounts include automatic lockouts after repeated failed sign-ins and accounts locked
        by an administrator. Unlocking clears the failed-attempt counter.
      </div>

      <DataTableToolbar
        filters={filters}
        columns={filterColumns}
        exportFileName="user-security"
        exportTitle="User Security Registry"
        exportSubtitle="Account lock state, 2FA coverage and password status"
        module="User Security"
        searchPlaceholder="Search name, username, email, department, role…"
        extraActions={
          <>
            <label className="security-toolbar-select">
              <span className="visually-hidden">Filter by security status</span>
              <select
                value={statusFilter}
                onChange={(event) => {
                  setStatusFilter(event.target.value)
                  logUiAction('Profile & Security', 'Filter User Security', {
                    status: event.target.value,
                  })
                }}
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="btn-secondary"
              onClick={loadAll}
              disabled={listLoading}
            >
              <Icon name="refresh" size={15} />
              {listLoading ? 'Refreshing…' : 'Refresh'}
            </button>
          </>
        }
      />

      <div className="table-scroll">
        <table className="security-table">
          <thead>
            <tr>
              <th>User</th>
              <th>Account</th>
              <th>Lock state</th>
              <th>Two-factor</th>
              <th>Password</th>
              <th>Last sign-in</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {listLoading && users.length === 0 ? (
              <tr>
                <td colSpan={7} className="empty-table">Loading security registry…</td>
              </tr>
            ) : filters.filteredRows.length === 0 ? (
              <tr>
                <td colSpan={7} className="empty-table">
                  {users.length === 0
                    ? 'No accounts found.'
                    : 'No accounts match the current filters.'}
                </td>
              </tr>
            ) : (
              visibleRows.map((user) => (
                <tr key={user.id}>
                  <td>
                    <div className="security-user-cell">
                      <strong>{user.fullName}</strong>
                      <span>{user.username}</span>
                      {user.roles.length > 0 && (
                        <span className="security-role-chips">
                          {user.roles.map((role) => (
                            <span key={role.id} className="security-role-chip">
                              {role.role_name}
                            </span>
                          ))}
                        </span>
                      )}
                    </div>
                  </td>
                  <td>
                    <SecurityPill
                      tone={
                        user.status === 'Active'
                          ? user.isLocked
                            ? 'locked'
                            : 'active'
                          : 'inactive'
                      }
                    >
                      {user.status === 'Active' && user.isLocked ? 'Locked' : user.status}
                    </SecurityPill>
                  </td>
                  <td>
                    {user.isLocked ? (
                      <div className="security-cell-stack">
                        <SecurityPill tone="locked" icon="lock">
                          Locked
                        </SecurityPill>
                        <span className="security-cell-meta">
                          {user.lockedReason || 'Administrative lock'}
                        </span>
                        {user.lockedUntil && (
                          <span className="security-cell-meta">
                            Until {formatLockUntil(user.lockedUntil)}
                          </span>
                        )}
                        {user.lockedByUsername && (
                          <span className="security-cell-meta">By {user.lockedByUsername}</span>
                        )}
                      </div>
                    ) : (
                      <div className="security-cell-stack">
                        <SecurityPill tone="active">Unlocked</SecurityPill>
                        {user.failedLoginCount > 0 && (
                          <span className="security-cell-meta">
                            {user.failedLoginCount} failed attempt
                            {user.failedLoginCount === 1 ? '' : 's'}
                          </span>
                        )}
                      </div>
                    )}
                  </td>
                  <td>
                    <div className="security-cell-stack">
                      <SecurityPill tone={user.totpEnabled ? 'enabled' : user.force2FA ? 'warning' : 'disabled'}>
                        {user.totpEnabled ? 'Enabled' : user.force2FA ? 'Required' : 'Not enabled'}
                      </SecurityPill>
                      {user.totpEnabled && (
                        <span className="security-cell-meta">
                          {user.backupCodesRemaining} recovery code
                          {user.backupCodesRemaining === 1 ? '' : 's'}
                        </span>
                      )}
                    </div>
                  </td>
                  <td>
                    <div className="security-cell-stack">
                      <SecurityPill
                        tone={
                          user.passwordExpired || user.forcePasswordChange
                            ? 'warning'
                            : user.passwordChangedAt
                              ? 'active'
                              : 'neutral'
                        }
                      >
                        {passwordLabel(user)}
                      </SecurityPill>
                      <span className="security-cell-meta">
                        Changed {formatSecurityDateTime(user.passwordChangedAt)}
                      </span>
                      {user.passwordExpiresAt && (
                        <span className="security-cell-meta">
                          Expires {formatSecurityDateTime(user.passwordExpiresAt)}
                        </span>
                      )}
                    </div>
                  </td>
                  <td>
                    <div className="security-cell-stack">
                      <span>{formatSecurityDateTime(user.lastLoginAt)}</span>
                      {user.lastLoginIp && (
                        <span className="security-cell-meta">{user.lastLoginIp}</span>
                      )}
                    </div>
                  </td>
                  <td>
                    <div className="security-row-actions">
                      <button
                        type="button"
                        className="btn-secondary btn-compact"
                        onClick={() => openUser(user)}
                      >
                        <Icon name="shield" size={14} />
                        Manage
                      </button>
                      {user.pendingResetRequestCount > 0 && (
                        <SecurityPill tone="pending" icon="history">
                          {user.pendingResetRequestCount} request
                          {user.pendingResetRequestCount === 1 ? '' : 's'}
                        </SecurityPill>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <PaginationControls
        currentPage={page}
        totalRows={filters.filteredRows.length}
        onPageChange={setPage}
      />

      <UserSecurityDialog
        key={`${selectedUser?.id || 'none'}-${dialogOpen ? 'open' : 'closed'}`}
        open={dialogOpen}
        user={selectedUser}
        loggedInUser={loggedInUser}
        onClose={() => setDialogOpen(false)}
        onChanged={handleChanged}
      />
    </div>
  )
}

export default UserSecurityPanel
