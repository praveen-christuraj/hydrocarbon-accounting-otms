import { useCallback, useEffect, useMemo, useState } from 'react'
import Icon from '../components/common/Icon'
import AlertMessage from '../components/common/AlertMessage'
import PageHeader from '../components/common/PageHeader'
import Modal from '../components/common/Modal'
import FormDialog from '../components/common/FormDialog'
import DataTableToolbar from '../components/common/DataTableToolbar'
import PaginationControls, { paginateRows, usePageSize } from '../components/common/PaginationControls'
import { useConfirm } from '../components/common/ConfirmProvider'
import { useDataFilters } from '../hooks/useDataFilters'
import { usePermissions } from '../hooks/usePermissions'
import useActionFeedback from '../hooks/useActionFeedback'
import { logUiAction } from '../utils/actionLogger'
import {
  adminRequirePasswordChange,
  adminResetUser2FA,
  adminResetUserPassword,
  adminUnlockUserAccount,
  changeOwnPassword,
  declinePasswordResetRequest,
  disableOwn2FA,
  getPasswordResetRequests,
  getUsersSecurityOverview,
  regenerate2FABackupCodes,
  start2FASetup,
  verify2FASetup,
} from '../api/securityApi'

import {
  buildPolicyChecks,
  calcPasswordStrength,
  generateStrongPassword,
} from '../utils/passwordPolicy'

const formatDateTime = (value) => {
  if (!value) return '—'
  const date = new Date(value.endsWith('Z') || value.includes('+') ? value : `${value}Z`)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

const passwordStateLabel = (row) => {
  if (row.force_password_change) return 'Change required'
  if (row.password_expired) return 'Expired'
  return 'Current'
}

const accountStateLabel = (row) => {
  if (row.status !== 'Active') return row.status
  if (row.is_locked) return 'Locked'
  return 'Active'
}

// ---------------------------------------------------------------------------
// Password input with visibility toggle
// ---------------------------------------------------------------------------

function PasswordField({ label, value, onChange, error, autoComplete = 'new-password', hint }) {
  const [visible, setVisible] = useState(false)
  return (
    <div>
      <label>{label}</label>
      <div className="password-input-wrapper">
        <input
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={onChange}
          autoComplete={autoComplete}
          aria-invalid={error ? 'true' : undefined}
        />
        <button
          type="button"
          className="password-toggle"
          onClick={() => setVisible((previous) => !previous)}
          tabIndex={-1}
          aria-label={visible ? 'Hide password' : 'Show password'}
        >
          <Icon name={visible ? 'eyeOff' : 'eye'} size={16} />
        </button>
      </div>
      {error && <small className="field-error">{error}</small>}
      {!error && hint && <small className="field-hint">{hint}</small>}
    </div>
  )
}

function PolicyChecklist({ checks }) {
  return (
    <ul className="password-policy-checklist">
      {checks.map((check) => (
        <li key={check.id} className={check.ok ? 'met' : 'unmet'}>
          <Icon name={check.ok ? 'checkCircle' : 'minus'} size={13} />
          <span>{check.label}</span>
        </li>
      ))}
    </ul>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

function ProfileSecurity({ loggedInUser, onLoggedInUserRefresh }) {
  const { hasPermission } = usePermissions(loggedInUser)
  const confirm = useConfirm()
  const pageSize = usePageSize()

  const canEditOwnSecurity = hasPermission('Edit Own Security Settings')
  const canResetPassword = hasPermission('Reset User Password')
  const canReset2FA = hasPermission('Reset User 2FA')
  const isSecurityAdmin = canResetPassword || canReset2FA

  const security = loggedInUser?.security || {}
  // Local override so the card flips immediately after enabling/disabling 2FA;
  // the server state (security.totp_enabled) wins once the user is refreshed.
  const [twoFAOverride, setTwoFAOverride] = useState(null)
  const twoFAEnabled = twoFAOverride ?? Boolean(security.totp_enabled)
  const setTwoFAEnabled = setTwoFAOverride

  // Feedback stays next to the section it concerns (owner rule 8).
  const ownFeedback = useActionFeedback()
  const adminFeedback = useActionFeedback()

  // ------------------------------------------------------------------
  // Change own password
  // ------------------------------------------------------------------
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  })
  const [passwordErrors, setPasswordErrors] = useState({})
  const [passwordBusy, setPasswordBusy] = useState(false)

  const policyChecks = useMemo(
    () =>
      buildPolicyChecks(passwordForm.newPassword, {
        currentPassword: passwordForm.currentPassword,
        username: loggedInUser?.username || '',
      }),
    [passwordForm.newPassword, passwordForm.currentPassword, loggedInUser?.username]
  )
  const pwStrength = useMemo(
    () => calcPasswordStrength(passwordForm.newPassword),
    [passwordForm.newPassword]
  )

  const submitPasswordChange = async (event) => {
    event.preventDefault()
    setPasswordErrors({})

    const errors = {}
    if (!passwordForm.currentPassword.trim()) errors.currentPassword = 'Current password is required'
    if (!passwordForm.newPassword.trim()) errors.newPassword = 'New password is required'
    else if (policyChecks.some((check) => !check.ok)) {
      errors.newPassword = 'New password does not meet the password policy'
    }
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      errors.confirmPassword = 'Passwords do not match'
    }
    if (Object.keys(errors).length) {
      setPasswordErrors(errors)
      return
    }

    setPasswordBusy(true)
    try {
      const response = await changeOwnPassword(passwordForm)
      ownFeedback.notifySuccess(response.message || 'Password changed successfully')
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' })
      logUiAction('Profile & Security', 'Change Own Password', { username: loggedInUser?.username })
      onLoggedInUserRefresh?.()
    } catch (error) {
      ownFeedback.notifyError(error.message)
    } finally {
      setPasswordBusy(false)
    }
  }

  // ------------------------------------------------------------------
  // Two-factor authentication
  // ------------------------------------------------------------------
  const [setupData, setSetupData] = useState(null)
  const [setupCode, setSetupCode] = useState('')
  const [setupError, setSetupError] = useState('')
  const [setupBusy, setSetupBusy] = useState(false)
  const [backupCodes, setBackupCodes] = useState([])
  const [backupCodesOpen, setBackupCodesOpen] = useState(false)
  const [codesCopied, setCodesCopied] = useState(false)
  const [disableOpen, setDisableOpen] = useState(false)
  const [disableForm, setDisableForm] = useState({ currentPassword: '', code: '' })
  const [disableError, setDisableError] = useState('')
  const [disableBusy, setDisableBusy] = useState(false)

  const begin2FASetup = async () => {
    setSetupError('')
    setSetupBusy(true)
    try {
      const data = await start2FASetup()
      setSetupData(data)
      setSetupCode('')
      logUiAction('Profile & Security', 'Start 2FA Setup', { username: loggedInUser?.username })
    } catch (error) {
      ownFeedback.notifyError(error.message)
    } finally {
      setSetupBusy(false)
    }
  }

  const submit2FASetup = async (event) => {
    event.preventDefault()
    setSetupError('')
    if (!setupCode.trim()) {
      setSetupError('Enter the 6-digit code from your authenticator app')
      return
    }
    setSetupBusy(true)
    try {
      const data = await verify2FASetup(setupCode)
      setSetupData(null)
      setSetupCode('')
      setTwoFAEnabled(true)
      setBackupCodes(data.backup_codes || [])
      setCodesCopied(false)
      setBackupCodesOpen(true)
      ownFeedback.notifySuccess(data.message || 'Two-factor authentication enabled')
      logUiAction('Profile & Security', 'Enable 2FA', { username: loggedInUser?.username })
      onLoggedInUserRefresh?.()
    } catch (error) {
      setSetupError(error.message)
    } finally {
      setSetupBusy(false)
    }
  }

  const handleRegenerateCodes = async () => {
    const confirmed = await confirm({
      title: 'Regenerate backup codes',
      message:
        'Your existing backup codes stop working immediately and a new set is issued. Continue?',
      confirmLabel: 'Regenerate',
      tone: 'warning',
    })
    if (!confirmed) return
    try {
      const data = await regenerate2FABackupCodes()
      setBackupCodes(data.backup_codes || [])
      setCodesCopied(false)
      setBackupCodesOpen(true)
      ownFeedback.notifySuccess(data.message || 'Backup codes regenerated')
      logUiAction('Profile & Security', 'Regenerate 2FA Backup Codes', { username: loggedInUser?.username })
    } catch (error) {
      ownFeedback.notifyError(error.message)
    }
  }

  const submitDisable2FA = async (event) => {
    event.preventDefault()
    setDisableError('')
    if (!disableForm.currentPassword.trim() || !disableForm.code.trim()) {
      setDisableError('Current password and an authentication code are both required')
      return
    }
    setDisableBusy(true)
    try {
      const data = await disableOwn2FA(disableForm.currentPassword, disableForm.code)
      setDisableOpen(false)
      setDisableForm({ currentPassword: '', code: '' })
      setTwoFAEnabled(false)
      ownFeedback.notifySuccess(data.message || 'Two-factor authentication disabled')
      logUiAction('Profile & Security', 'Disable 2FA', { username: loggedInUser?.username })
      onLoggedInUserRefresh?.()
    } catch (error) {
      setDisableError(error.message)
    } finally {
      setDisableBusy(false)
    }
  }

  const copyBackupCodes = async () => {
    try {
      await navigator.clipboard.writeText(backupCodes.join('\n'))
      setCodesCopied(true)
    } catch {
      setCodesCopied(false)
    }
  }

  const downloadBackupCodes = () => {
    const content = [
      'Hydrocarbon Accounting System - 2FA backup codes',
      `Account: ${loggedInUser?.username || ''}`,
      `Generated: ${new Date().toISOString()}`,
      '',
      ...backupCodes,
      '',
      'Each code can be used once in place of an authenticator code.',
    ].join('\n')
    const blob = new Blob([content], { type: 'text/plain' })
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `backup-codes-${loggedInUser?.username || 'account'}.txt`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.URL.revokeObjectURL(url)
    logUiAction('Profile & Security', 'Download 2FA Backup Codes', { username: loggedInUser?.username })
  }

  // ------------------------------------------------------------------
  // Administrator console state
  // ------------------------------------------------------------------
  const [overview, setOverview] = useState({ items: [], locked_count: 0, pending_reset_requests: 0, two_fa_enabled_count: 0, total: 0 })
  const [overviewLoading, setOverviewLoading] = useState(false)
  const [requests, setRequests] = useState([])
  const [requestStatusFilter, setRequestStatusFilter] = useState('Pending')
  const [requestsLoading, setRequestsLoading] = useState(false)
  const [overviewPage, setOverviewPage] = useState(1)
  const [requestsPage, setRequestsPage] = useState(1)

  const loadOverview = useCallback(async () => {
    if (!isSecurityAdmin) return
    setOverviewLoading(true)
    try {
      const data = await getUsersSecurityOverview()
      setOverview({
        items: data.items || [],
        total: data.total || 0,
        locked_count: data.locked_count || 0,
        pending_reset_requests: data.pending_reset_requests || 0,
        two_fa_enabled_count: data.two_fa_enabled_count || 0,
      })
    } catch (error) {
      adminFeedback.notifyError(error.message)
    } finally {
      setOverviewLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSecurityAdmin])

  const loadRequests = useCallback(
    async (statusFilter = requestStatusFilter) => {
      if (!canResetPassword) return
      setRequestsLoading(true)
      try {
        const data = await getPasswordResetRequests(statusFilter)
        setRequests(data.items || [])
      } catch (error) {
        adminFeedback.notifyError(error.message)
      } finally {
        setRequestsLoading(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canResetPassword, requestStatusFilter]
  )

  useEffect(() => {
    loadOverview()
  }, [loadOverview])

  useEffect(() => {
    loadRequests(requestStatusFilter)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestStatusFilter, canResetPassword])

  // Overview table rows (flattened for filtering/export)
  const overviewRows = useMemo(
    () =>
      (overview.items || []).map((row) => ({
        ...row,
        accountState: accountStateLabel(row),
        twoFA: row.totp_enabled ? 'Enabled' : 'Disabled',
        passwordState: passwordStateLabel(row),
        lockedUntilText: row.is_locked ? formatDateTime(row.locked_until) : '',
        lastLoginText: formatDateTime(row.last_login_at),
        passwordChangedText: formatDateTime(row.password_changed_at),
      })),
    [overview.items]
  )

  const overviewColumns = useMemo(
    () => [
      { key: 'full_name', label: 'Full Name' },
      { key: 'username', label: 'Username' },
      { key: 'email', label: 'Email' },
      { key: 'accountState', label: 'Account', type: 'select' },
      { key: 'twoFA', label: '2FA', type: 'select' },
      { key: 'failed_login_count', label: 'Failed Attempts', type: 'number' },
      { key: 'lockedUntilText', label: 'Locked Until' },
      { key: 'passwordState', label: 'Password', type: 'select' },
      { key: 'passwordChangedText', label: 'Password Changed' },
      { key: 'lastLoginText', label: 'Last Sign-in' },
      { key: 'last_login_ip', label: 'Last Sign-in IP' },
      { key: 'pending_reset_requests', label: 'Pending Requests', type: 'number' },
    ],
    []
  )
  const overviewFilters = useDataFilters(overviewRows, overviewColumns, { module: 'User Security' })
  const visibleOverviewRows = paginateRows(overviewFilters.filteredRows, overviewPage, pageSize)

  const requestRows = useMemo(
    () =>
      (requests || []).map((row) => ({
        ...row,
        requestedAtText: formatDateTime(row.requested_at),
        actedAtText: formatDateTime(row.acted_at),
        reset2FAText: row.reset_2fa ? 'Yes' : 'No',
      })),
    [requests]
  )
  const requestColumns = useMemo(
    () => [
      { key: 'request_number', label: 'Request No.' },
      { key: 'full_name', label: 'Full Name' },
      { key: 'username', label: 'Username' },
      { key: 'reason', label: 'Reason' },
      { key: 'reset2FAText', label: 'Reset 2FA', type: 'select' },
      { key: 'requestedAtText', label: 'Requested At' },
      { key: 'requested_by_ip', label: 'Requested From IP' },
      { key: 'status', label: 'Status', type: 'select' },
      { key: 'actedAtText', label: 'Acted At' },
      { key: 'action_notes', label: 'Action Notes' },
    ],
    []
  )
  const requestFilters = useDataFilters(requestRows, requestColumns, { module: 'Password Reset Requests' })
  const visibleRequestRows = paginateRows(requestFilters.filteredRows, requestsPage, pageSize)

  // ------------------------------------------------------------------
  // Administrator actions
  // ------------------------------------------------------------------
  const [resetDialog, setResetDialog] = useState(null) // { target, fromRequest }
  const [resetForm, setResetForm] = useState({
    newPassword: '',
    confirmPassword: '',
    forcePasswordChange: true,
    reset2FA: false,
    remarks: '',
  })
  const [resetError, setResetError] = useState('')
  const [resetBusy, setResetBusy] = useState(false)
  const [declineDialog, setDeclineDialog] = useState(null) // request row
  const [declineNotes, setDeclineNotes] = useState('')
  const [declineError, setDeclineError] = useState('')
  const [declineBusy, setDeclineBusy] = useState(false)

  const openResetDialog = (target, fromRequest = null) => {
    setResetForm({
      newPassword: '',
      confirmPassword: '',
      forcePasswordChange: true,
      reset2FA: Boolean(fromRequest?.reset_2fa) && canReset2FA,
      remarks: fromRequest ? `Approved password reset request ${fromRequest.request_number}` : '',
    })
    setResetError('')
    setResetDialog({ target, fromRequest })
  }

  const resetPolicyChecks = useMemo(
    () =>
      buildPolicyChecks(resetForm.newPassword, {
        username: resetDialog?.target?.username || '',
      }),
    [resetForm.newPassword, resetDialog?.target?.username]
  )

  const submitAdminReset = async (event) => {
    event.preventDefault()
    setResetError('')
    if (!resetDialog?.target) return
    if (!resetForm.newPassword.trim()) {
      setResetError('A new password is required')
      return
    }
    if (resetPolicyChecks.some((check) => !check.ok)) {
      setResetError('The new password does not meet the password policy')
      return
    }
    if (resetForm.newPassword !== resetForm.confirmPassword) {
      setResetError('Passwords do not match')
      return
    }
    setResetBusy(true)
    try {
      const data = await adminResetUserPassword(resetDialog.target.id, resetForm)
      adminFeedback.notifySuccess(
        data.message || `Password reset for ${resetDialog.target.username}`
      )
      logUiAction('Profile & Security', 'Admin Reset User Password', {
        target: resetDialog.target.username,
        fromRequest: resetDialog.fromRequest?.request_number || null,
      })
      setResetDialog(null)
      await Promise.all([loadOverview(), loadRequests()])
    } catch (error) {
      setResetError(error.message)
    } finally {
      setResetBusy(false)
    }
  }

  const handleUnlock = async (row) => {
    const confirmed = await confirm({
      title: 'Unlock account',
      message: `Unlock ${row.full_name} (${row.username}) and reset the failed sign-in counter?`,
      confirmLabel: 'Unlock',
    })
    if (!confirmed) return
    try {
      const data = await adminUnlockUserAccount(row.id)
      adminFeedback.notifySuccess(data.message || `Account ${row.username} unlocked`)
      logUiAction('Profile & Security', 'Unlock User Account', { target: row.username })
      await loadOverview()
    } catch (error) {
      adminFeedback.notifyError(error.message)
    }
  }

  const handleReset2FA = async (row) => {
    const confirmed = await confirm({
      title: 'Reset 2FA',
      message: `Remove the 2FA enrolment for ${row.full_name} (${row.username})? They will sign in with password only until they enrol again.`,
      confirmLabel: 'Reset 2FA',
      tone: 'warning',
    })
    if (!confirmed) return
    try {
      const data = await adminResetUser2FA(row.id)
      adminFeedback.notifySuccess(data.message || `2FA reset for ${row.username}`)
      logUiAction('Profile & Security', 'Admin Reset User 2FA', { target: row.username })
      await loadOverview()
    } catch (error) {
      adminFeedback.notifyError(error.message)
    }
  }

  const handleRequireChange = async (row) => {
    const confirmed = await confirm({
      title: 'Require password change',
      message: `${row.full_name} (${row.username}) will be required to set a new password at their next sign-in. Continue?`,
      confirmLabel: 'Require change',
    })
    if (!confirmed) return
    try {
      const data = await adminRequirePasswordChange(row.id)
      adminFeedback.notifySuccess(data.message || `${row.username} must change their password`)
      logUiAction('Profile & Security', 'Require Password Change', { target: row.username })
      await loadOverview()
    } catch (error) {
      adminFeedback.notifyError(error.message)
    }
  }

  const submitDecline = async (event) => {
    event.preventDefault()
    if (!declineDialog) return
    setDeclineError('')
    setDeclineBusy(true)
    try {
      const data = await declinePasswordResetRequest(declineDialog.id, declineNotes)
      adminFeedback.notifySuccess(data.message || 'Request declined')
      logUiAction('Profile & Security', 'Decline Password Reset Request', {
        request: declineDialog.request_number,
      })
      setDeclineDialog(null)
      setDeclineNotes('')
      await Promise.all([loadRequests(), loadOverview()])
    } catch (error) {
      setDeclineError(error.message)
    } finally {
      setDeclineBusy(false)
    }
  }

  const approveFromRequest = (requestRow) => {
    const target = overview.items.find((item) => item.id === requestRow.user_id) || {
      id: requestRow.user_id,
      username: requestRow.username,
      full_name: requestRow.full_name || requestRow.username,
    }
    openResetDialog(target, requestRow)
  }

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------
  const roleNames = (loggedInUser?.roles || []).map((role) => role.roleName).filter(Boolean)

  return (
    <div className="profile-security-page">
      <PageHeader
        title="Profile & Security"
        description="Manage your password and two-factor authentication, and administer account security across the system."
      />

      {/* ------------------------------------------------------------ */}
      {/* Own account                                                   */}
      {/* ------------------------------------------------------------ */}
      <div className="security-grid">
        <section className="security-card" aria-labelledby="account-overview-title">
          <div className="security-card-header">
            <Icon name="user" size={16} />
            <h3 id="account-overview-title">Account Overview</h3>
          </div>
          <dl className="security-summary">
            <div>
              <dt>Name</dt>
              <dd>{loggedInUser?.fullName || '—'}</dd>
            </div>
            <div>
              <dt>Username</dt>
              <dd>{loggedInUser?.username || '—'}</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>{loggedInUser?.email || '—'}</dd>
            </div>
            <div>
              <dt>Department</dt>
              <dd>{loggedInUser?.department || '—'}</dd>
            </div>
            <div>
              <dt>Roles</dt>
              <dd>{roleNames.length ? roleNames.join(', ') : '—'}</dd>
            </div>
            <div>
              <dt>Two-factor authentication</dt>
              <dd>
                <span className={`status-badge ${twoFAEnabled ? 'active' : 'inactive'}`}>
                  {twoFAEnabled ? 'Enabled' : 'Disabled'}
                </span>
              </dd>
            </div>
            <div>
              <dt>Password status</dt>
              <dd>
                <span
                  className={`status-badge ${
                    security.force_password_change || security.password_expired ? 'blocked' : 'active'
                  }`}
                >
                  {security.force_password_change
                    ? 'Change required'
                    : security.password_expired
                      ? 'Expired'
                      : 'Current'}
                </span>
              </dd>
            </div>
          </dl>
        </section>

        <section className="security-card" aria-labelledby="change-password-title">
          <div className="security-card-header">
            <Icon name="key" size={16} />
            <h3 id="change-password-title">Change Password</h3>
          </div>
          <AlertMessage tone="success" message={ownFeedback.successMsg} onDismiss={ownFeedback.clearSuccess} />
          <AlertMessage tone="error" message={ownFeedback.errorMsg} onDismiss={ownFeedback.clearError} />
          {/* Changing your own password is an inherent right (identity is
              re-verified with the current password) – never permission-gated. */}
          {(
            <form onSubmit={submitPasswordChange} className="security-form">
              <PasswordField
                label="Current Password"
                value={passwordForm.currentPassword}
                onChange={(event) =>
                  setPasswordForm({ ...passwordForm, currentPassword: event.target.value })
                }
                error={passwordErrors.currentPassword}
                autoComplete="current-password"
              />
              <PasswordField
                label="New Password"
                value={passwordForm.newPassword}
                onChange={(event) =>
                  setPasswordForm({ ...passwordForm, newPassword: event.target.value })
                }
                error={passwordErrors.newPassword}
              />
              {passwordForm.newPassword.length > 0 && (
                <div className="password-strength">
                  <div
                    className="password-strength-bar"
                    style={{ width: `${pwStrength.pct}%`, background: pwStrength.color }}
                  />
                  <div className={`password-strength-text ${pwStrength.level}`}>{pwStrength.label}</div>
                </div>
              )}
              <PolicyChecklist checks={policyChecks} />
              <PasswordField
                label="Confirm New Password"
                value={passwordForm.confirmPassword}
                onChange={(event) =>
                  setPasswordForm({ ...passwordForm, confirmPassword: event.target.value })
                }
                error={passwordErrors.confirmPassword}
              />
              <div className="form-actions">
                <button type="submit" className="btn-primary" disabled={passwordBusy}>
                  {passwordBusy ? 'Changing…' : 'Change Password'}
                </button>
              </div>
            </form>
          )}
        </section>

        <section className="security-card" aria-labelledby="two-factor-title">
          <div className="security-card-header">
            <Icon name="shieldCheck" size={16} />
            <h3 id="two-factor-title">Two-Factor Authentication</h3>
          </div>
          {!canEditOwnSecurity ? (
            <p className="security-muted">
              You do not have permission to manage your own 2FA. Contact an administrator.
            </p>
          ) : twoFAEnabled ? (
            <>
              <p className="security-muted">
                Your account is protected with an authenticator app. Signing in requires a 6-digit
                code or one of your single-use backup codes.
              </p>
              <div className="form-actions security-actions-wrap">
                <button type="button" className="btn-secondary" onClick={handleRegenerateCodes}>
                  <Icon name="refresh" size={14} /> Regenerate Backup Codes
                </button>
                <button
                  type="button"
                  className="btn-danger"
                  onClick={() => {
                    setDisableForm({ currentPassword: '', code: '' })
                    setDisableError('')
                    setDisableOpen(true)
                  }}
                >
                  Disable 2FA
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="security-muted">
                Add a second sign-in step with an authenticator app (Google Authenticator,
                Microsoft Authenticator, 1Password, …). Strongly recommended for every account.
              </p>
              <div className="form-actions">
                <button type="button" className="btn-primary" onClick={begin2FASetup} disabled={setupBusy}>
                  {setupBusy ? 'Preparing…' : 'Enable Two-Factor Authentication'}
                </button>
              </div>
            </>
          )}
        </section>
      </div>

      {/* ------------------------------------------------------------ */}
      {/* Administrator console                                         */}
      {/* ------------------------------------------------------------ */}
      {isSecurityAdmin && (
        <>
          <div className="section-title security-admin-title">
            <h3>Security Administration</h3>
            <p>
              Locked accounts, failed sign-ins, 2FA enrolment and password reset requests for every
              user in your scope.
            </p>
          </div>

          <AlertMessage tone="success" message={adminFeedback.successMsg} onDismiss={adminFeedback.clearSuccess} />
          <AlertMessage tone="error" message={adminFeedback.errorMsg} onDismiss={adminFeedback.clearError} />

          <div className="security-kpi-row">
            <div className="security-kpi">
              <span className="security-kpi-value">{overview.total}</span>
              <span className="security-kpi-label">Accounts</span>
            </div>
            <div className={`security-kpi ${overview.locked_count > 0 ? 'alert' : ''}`}>
              <span className="security-kpi-value">{overview.locked_count}</span>
              <span className="security-kpi-label">Locked</span>
            </div>
            <div className={`security-kpi ${overview.pending_reset_requests > 0 ? 'alert' : ''}`}>
              <span className="security-kpi-value">{overview.pending_reset_requests}</span>
              <span className="security-kpi-label">Pending Reset Requests</span>
            </div>
            <div className="security-kpi">
              <span className="security-kpi-value">{overview.two_fa_enabled_count}</span>
              <span className="security-kpi-label">2FA Enabled</span>
            </div>
          </div>

          {canResetPassword && (
            <section aria-labelledby="reset-requests-title" className="security-admin-section">
              <div className="section-title">
                <h3 id="reset-requests-title">Password Reset Requests</h3>
              </div>
              <DataTableToolbar
                filters={requestFilters}
                columns={requestColumns}
                exportFileName="password-reset-requests"
                exportTitle="Password Reset Requests"
                module="Password Reset Requests"
                canImport={false}
                generatedBy={loggedInUser?.username}
                extraActions={
                  <>
                    <select
                      value={requestStatusFilter}
                      onChange={(event) => {
                        setRequestStatusFilter(event.target.value)
                        setRequestsPage(1)
                        logUiAction('Profile & Security', 'Filter Reset Requests', {
                          status: event.target.value,
                        })
                      }}
                      aria-label="Request status filter"
                    >
                      <option value="Pending">Pending</option>
                      <option value="Completed">Completed</option>
                      <option value="Declined">Declined</option>
                      <option value="All">All statuses</option>
                    </select>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => loadRequests()}
                      disabled={requestsLoading}
                    >
                      <Icon name="refresh" size={14} /> Refresh
                    </button>
                  </>
                }
              />
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Request No.</th>
                      <th>User</th>
                      <th>Reason</th>
                      <th>Reset 2FA</th>
                      <th>Requested</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRequestRows.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="empty-table">
                          {requestsLoading
                            ? 'Loading password reset requests…'
                            : 'No password reset requests found.'}
                        </td>
                      </tr>
                    ) : (
                      visibleRequestRows.map((row) => (
                        <tr key={row.id}>
                          <td>{row.request_number}</td>
                          <td>
                            <div className="security-user-cell">
                              <span>{row.full_name || row.username}</span>
                              <small>
                                {row.username}
                                {row.user_is_locked ? ' · locked' : ''}
                              </small>
                            </div>
                          </td>
                          <td>{row.reason || '—'}</td>
                          <td>{row.reset2FAText}</td>
                          <td>{row.requestedAtText}</td>
                          <td>
                            <span
                              className={`status-badge ${
                                row.status === 'Pending'
                                  ? 'draft'
                                  : row.status === 'Completed'
                                    ? 'active'
                                    : 'rejected'
                              }`}
                            >
                              {row.status}
                            </span>
                          </td>
                          <td>
                            {row.status === 'Pending' ? (
                              <div className="security-row-actions">
                                <button
                                  type="button"
                                  className="btn-primary btn-compact"
                                  onClick={() => approveFromRequest(row)}
                                >
                                  Reset Password
                                </button>
                                <button
                                  type="button"
                                  className="btn-secondary btn-compact"
                                  onClick={() => {
                                    setDeclineNotes('')
                                    setDeclineError('')
                                    setDeclineDialog(row)
                                  }}
                                >
                                  Decline
                                </button>
                              </div>
                            ) : (
                              <span className="security-muted">{row.action_notes || '—'}</span>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              <PaginationControls
                currentPage={requestsPage}
                totalRows={requestFilters.filteredRows.length}
                onPageChange={setRequestsPage}
              />
            </section>
          )}

          <section aria-labelledby="user-security-title" className="security-admin-section">
            <div className="section-title">
              <h3 id="user-security-title">User Security Administration</h3>
            </div>
            <DataTableToolbar
              filters={overviewFilters}
              columns={overviewColumns}
              exportFileName="user-security-overview"
              exportTitle="User Security Overview"
              module="User Security"
              canImport={false}
              generatedBy={loggedInUser?.username}
              extraActions={
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => loadOverview()}
                  disabled={overviewLoading}
                >
                  <Icon name="refresh" size={14} /> Refresh
                </button>
              }
            />
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Account</th>
                    <th>2FA</th>
                    <th>Failed Attempts</th>
                    <th>Password</th>
                    <th>Last Sign-in</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleOverviewRows.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="empty-table">
                        {overviewLoading ? 'Loading user security overview…' : 'No users found.'}
                      </td>
                    </tr>
                  ) : (
                    visibleOverviewRows.map((row) => (
                      <tr key={row.id} className={row.is_locked ? 'security-row-locked' : undefined}>
                        <td>
                          <div className="security-user-cell">
                            <span>{row.full_name}</span>
                            <small>{row.username}</small>
                          </div>
                        </td>
                        <td>
                          <span
                            className={`status-badge ${
                              row.is_locked
                                ? 'blocked'
                                : row.status === 'Active'
                                  ? 'active'
                                  : 'inactive'
                            }`}
                          >
                            {row.accountState}
                          </span>
                          {row.is_locked && (
                            <small className="security-locked-until">until {row.lockedUntilText}</small>
                          )}
                        </td>
                        <td>
                          <span className={`status-badge ${row.totp_enabled ? 'active' : 'inactive'}`}>
                            {row.twoFA}
                          </span>
                        </td>
                        <td>{row.failed_login_count}</td>
                        <td>
                          <span
                            className={`status-badge ${
                              row.passwordState === 'Current' ? 'active' : 'draft'
                            }`}
                          >
                            {row.passwordState}
                          </span>
                        </td>
                        <td>
                          <div className="security-user-cell">
                            <span>{row.lastLoginText}</span>
                            {row.last_login_ip && <small>{row.last_login_ip}</small>}
                          </div>
                        </td>
                        <td>
                          <div className="security-row-actions">
                            {row.is_locked && canResetPassword && (
                              <button
                                type="button"
                                className="btn-primary btn-compact"
                                onClick={() => handleUnlock(row)}
                              >
                                Unlock
                              </button>
                            )}
                            {canResetPassword && (
                              <button
                                type="button"
                                className="btn-secondary btn-compact"
                                onClick={() => openResetDialog(row)}
                              >
                                Reset Password
                              </button>
                            )}
                            {canReset2FA && row.totp_enabled && (
                              <button
                                type="button"
                                className="btn-secondary btn-compact"
                                onClick={() => handleReset2FA(row)}
                              >
                                Reset 2FA
                              </button>
                            )}
                            {canResetPassword &&
                              !row.force_password_change &&
                              row.id !== loggedInUser?.id && (
                                <button
                                  type="button"
                                  className="btn-secondary btn-compact"
                                  onClick={() => handleRequireChange(row)}
                                >
                                  Require Change
                                </button>
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
              currentPage={overviewPage}
              totalRows={overviewFilters.filteredRows.length}
              onPageChange={setOverviewPage}
            />
          </section>
        </>
      )}

      {/* ------------------------------------------------------------ */}
      {/* Dialogs                                                       */}
      {/* ------------------------------------------------------------ */}

      {/* 2FA setup wizard */}
      <FormDialog
        open={Boolean(setupData)}
        title="Enable Two-Factor Authentication"
        description="Scan the QR code with your authenticator app, then enter the 6-digit code it shows to confirm."
        submitLabel="Verify & Enable"
        busy={setupBusy}
        error={setupError}
        onDismissError={() => setSetupError('')}
        onSubmit={submit2FASetup}
        onCancel={() => {
          setSetupData(null)
          setSetupCode('')
          setSetupError('')
        }}
        columns={1}
      >
        {setupData && (
          <>
            <div className="security-qr-block">
              <img src={setupData.qr_code_data_url} alt="2FA QR code" width="200" height="200" />
              {setupData.secret && (
                <div className="security-manual-secret">
                  <label>Can't scan? Enter this key manually</label>
                  <code>{setupData.secret}</code>
                </div>
              )}
            </div>
            <div>
              <label>Authentication Code</label>
              <input
                value={setupCode}
                onChange={(event) => setSetupCode(event.target.value)}
                placeholder="6-digit code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={10}
              />
            </div>
          </>
        )}
      </FormDialog>

      {/* Backup codes */}
      <Modal
        open={backupCodesOpen}
        title="Your 2FA Backup Codes"
        description="Store these codes somewhere safe. Each code can be used once if you lose access to your authenticator app. They are shown only now."
        onClose={() => setBackupCodesOpen(false)}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={copyBackupCodes}>
              <Icon name="copy" size={14} /> {codesCopied ? 'Copied' : 'Copy'}
            </button>
            <button type="button" className="btn-secondary" onClick={downloadBackupCodes}>
              <Icon name="download" size={14} /> Download
            </button>
            <button type="button" className="btn-primary" onClick={() => setBackupCodesOpen(false)}>
              I have saved these codes
            </button>
          </>
        }
      >
        <div className="security-backup-codes">
          {backupCodes.map((code) => (
            <code key={code}>{code}</code>
          ))}
        </div>
      </Modal>

      {/* Disable 2FA */}
      <FormDialog
        open={disableOpen}
        title="Disable Two-Factor Authentication"
        description="Confirm your identity with your current password and a valid authenticator or backup code."
        submitLabel="Disable 2FA"
        busy={disableBusy}
        error={disableError}
        onDismissError={() => setDisableError('')}
        onSubmit={submitDisable2FA}
        onCancel={() => setDisableOpen(false)}
        columns={1}
      >
        <PasswordField
          label="Current Password"
          value={disableForm.currentPassword}
          onChange={(event) => setDisableForm({ ...disableForm, currentPassword: event.target.value })}
          autoComplete="current-password"
        />
        <div>
          <label>Authenticator Code or Backup Code</label>
          <input
            value={disableForm.code}
            onChange={(event) => setDisableForm({ ...disableForm, code: event.target.value })}
            autoComplete="one-time-code"
          />
        </div>
      </FormDialog>

      {/* Admin password reset */}
      <FormDialog
        open={Boolean(resetDialog)}
        title={`Reset Password — ${resetDialog?.target?.full_name || resetDialog?.target?.username || ''}`}
        description={
          resetDialog?.fromRequest
            ? `Approving request ${resetDialog.fromRequest.request_number}. The user's open sessions end immediately after the reset.`
            : "Set a new password for this account. The user's open sessions end immediately after the reset."
        }
        submitLabel="Reset Password"
        busy={resetBusy}
        error={resetError}
        onDismissError={() => setResetError('')}
        onSubmit={submitAdminReset}
        onCancel={() => setResetDialog(null)}
        columns={1}
      >
        <div>
          <label>Account</label>
          <input
            value={`${resetDialog?.target?.full_name || ''} (${resetDialog?.target?.username || ''})`}
            readOnly
            disabled
          />
        </div>
        <PasswordField
          label="New Password"
          value={resetForm.newPassword}
          onChange={(event) =>
            setResetForm({ ...resetForm, newPassword: event.target.value })
          }
        />
        <div className="form-actions security-generate-row">
          <button
            type="button"
            className="btn-secondary btn-compact"
            onClick={() => {
              const generated = generateStrongPassword()
              setResetForm({ ...resetForm, newPassword: generated, confirmPassword: generated })
            }}
          >
            <Icon name="refresh" size={14} /> Generate Strong Password
          </button>
        </div>
        <PolicyChecklist checks={resetPolicyChecks} />
        <PasswordField
          label="Confirm New Password"
          value={resetForm.confirmPassword}
          onChange={(event) =>
            setResetForm({ ...resetForm, confirmPassword: event.target.value })
          }
        />
        <label className="security-checkbox">
          <input
            type="checkbox"
            checked={resetForm.forcePasswordChange}
            onChange={(event) =>
              setResetForm({ ...resetForm, forcePasswordChange: event.target.checked })
            }
          />
          Require the user to change this password at next sign-in
        </label>
        {canReset2FA && (
          <label className="security-checkbox">
            <input
              type="checkbox"
              checked={resetForm.reset2FA}
              onChange={(event) => setResetForm({ ...resetForm, reset2FA: event.target.checked })}
            />
            Also reset two-factor authentication (lost device)
          </label>
        )}
        <div>
          <label>Remarks</label>
          <textarea
            rows="3"
            value={resetForm.remarks}
            onChange={(event) => setResetForm({ ...resetForm, remarks: event.target.value })}
            placeholder="Reason for the reset (kept in the audit trail)"
          />
        </div>
      </FormDialog>

      {/* Decline reset request */}
      <FormDialog
        open={Boolean(declineDialog)}
        title={`Decline Request — ${declineDialog?.request_number || ''}`}
        description="The request is closed without changing the user's password. The note below is stored in the audit trail."
        submitLabel="Decline Request"
        busy={declineBusy}
        error={declineError}
        onDismissError={() => setDeclineError('')}
        onSubmit={submitDecline}
        onCancel={() => setDeclineDialog(null)}
        columns={1}
      >
        <div>
          <label>Requested By</label>
          <input
            value={`${declineDialog?.full_name || declineDialog?.username || ''} (${declineDialog?.username || ''})`}
            readOnly
            disabled
          />
        </div>
        <div>
          <label>Notes</label>
          <textarea
            rows="3"
            value={declineNotes}
            onChange={(event) => setDeclineNotes(event.target.value)}
            placeholder="Why is this request being declined?"
          />
        </div>
      </FormDialog>
    </div>
  )
}

export default ProfileSecurity
