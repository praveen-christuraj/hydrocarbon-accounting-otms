import { useCallback, useEffect, useMemo, useState } from 'react'
import AlertMessage from '../common/AlertMessage'
import Icon from '../common/Icon'
import { useConfirm } from '../common/ConfirmProvider'
import useActionFeedback from '../../hooks/useActionFeedback'
import usePermissions from '../../hooks/usePermissions'
import { logUiAction } from '../../utils/actionLogger'
import {
  cancelMyResetRequest,
  changeOwnPassword,
  disableOwn2FA,
  getMyResetRequests,
  getMySecurityActivity,
  regenerate2FABackupCodes,
  start2FASetup,
  verify2FASetup,
} from '../../api/securityApi'
import {
  CopyableSecret,
  PasswordInput,
  PasswordPolicyChecklist,
  SecurityCard,
  SecurityEmpty,
  SecurityMetric,
  SecurityPill,
  describeRelativeTime,
  formatSecurityDateTime,
} from './SecurityPrimitives'

const emptyPasswordForm = {
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
}

const STATUS_TONE = {
  pending: 'pending',
  approved: 'approved',
  completed: 'approved',
  rejected: 'rejected',
  cancelled: 'inactive',
}

function MySecurityPanel({ loggedInUser, onUserRefresh }) {
  const feedback = useActionFeedback()
  const { hasPermission } = usePermissions(loggedInUser)
  const confirm = useConfirm()
  const [passwordForm, setPasswordForm] = useState(emptyPasswordForm)
  const [passwordErrors, setPasswordErrors] = useState({})
  const [passwordBusy, setPasswordBusy] = useState(false)

  const [setupData, setSetupData] = useState(null)
  const [setupCode, setSetupCode] = useState('')
  const [setupBusy, setSetupBusy] = useState(false)
  const [reconfigureOpen, setReconfigureOpen] = useState(false)
  const [reconfigureForm, setReconfigureForm] = useState({ currentPassword: '', code: '' })

  const [backupCodes, setBackupCodes] = useState([])
  const [showRegenerate, setShowRegenerate] = useState(false)
  const [regenerateForm, setRegenerateForm] = useState({ currentPassword: '', code: '' })
  const [regenerateBusy, setRegenerateBusy] = useState(false)
  const [showDisable, setShowDisable] = useState(false)
  const [disableForm, setDisableForm] = useState({ currentPassword: '', code: '' })
  const [disableBusy, setDisableBusy] = useState(false)

  const [resetRequests, setResetRequests] = useState([])
  const [activity, setActivity] = useState([])
  const [requestsLoading, setRequestsLoading] = useState(false)

  const security = useMemo(() => loggedInUser?.security || {}, [loggedInUser])
  const totpEnabled = Boolean(security.totpEnabled)
  // Forced remediation always remains available, even when the role does not
  // carry the self-service permission (otherwise the account could be stranded).
  const canEditOwn =
    hasPermission('Edit Own Security Settings') ||
    Boolean(security.passwordChangeRequired) ||
    Boolean(security.twoFactorEnrollmentRequired)

  const passwordStatus = useMemo(() => {
    if (security.passwordExpired) return { label: 'Expired', tone: 'expired' }
    if (security.forcePasswordChange) return { label: 'Change required', tone: 'warning' }
    if (security.passwordNeverExpires) return { label: 'Never expires', tone: 'active' }
    if (security.passwordDaysRemaining !== null && security.passwordDaysRemaining !== undefined) {
      return {
        label: `${security.passwordDaysRemaining} day${security.passwordDaysRemaining === 1 ? '' : 's'} left`,
        tone: security.passwordDaysRemaining <= 7 ? 'warning' : 'active',
      }
    }
    return { label: 'Active', tone: 'active' }
  }, [security])

  const loadSelfServiceData = useCallback(async () => {
    setRequestsLoading(true)
    try {
      const [requests, events] = await Promise.all([
        getMyResetRequests(),
        getMySecurityActivity(),
      ])
      setResetRequests(requests)
      setActivity(events)
    } catch (error) {
      feedback.notifyError(error.message)
    } finally {
      setRequestsLoading(false)
    }
  }, [feedback])

  useEffect(() => {
    loadSelfServiceData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const submitPasswordChange = async (event) => {
    event.preventDefault()
    feedback.clear()
    const errors = {}
    if (!passwordForm.currentPassword) errors.currentPassword = 'Current password is required'
    if (!passwordForm.newPassword) errors.newPassword = 'New password is required'
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      errors.confirmPassword = 'Passwords do not match'
    }
    setPasswordErrors(errors)
    if (Object.keys(errors).length > 0) return

    setPasswordBusy(true)
    try {
      const result = await changeOwnPassword(passwordForm)
      feedback.notifySuccess(result.message || 'Password changed successfully')
      setPasswordForm(emptyPasswordForm)
      setPasswordErrors({})
      logUiAction('Profile & Security', 'Change Own Password', { username: loggedInUser?.username })
      await onUserRefresh?.()
      await loadSelfServiceData()
    } catch (error) {
      feedback.notifyError(error.message)
    } finally {
      setPasswordBusy(false)
    }
  }

  const beginSetup = async () => {
    feedback.clear()
    if (totpEnabled) {
      setReconfigureOpen(true)
      setReconfigureForm({ currentPassword: '', code: '' })
      return
    }
    setSetupBusy(true)
    try {
      const data = await start2FASetup({})
      setSetupData(data)
      setSetupCode('')
      setBackupCodes([])
      logUiAction('Profile & Security', 'Start 2FA Setup')
    } catch (error) {
      feedback.notifyError(error.message)
    } finally {
      setSetupBusy(false)
    }
  }

  const submitReconfigure = async (event) => {
    event.preventDefault()
    feedback.clear()
    if (!reconfigureForm.currentPassword || !reconfigureForm.code) {
      feedback.notifyError('Current password and authentication code are required')
      return
    }
    setSetupBusy(true)
    try {
      const data = await start2FASetup(reconfigureForm)
      setSetupData(data)
      setSetupCode('')
      setBackupCodes([])
      setReconfigureOpen(false)
    } catch (error) {
      feedback.notifyError(error.message)
    } finally {
      setSetupBusy(false)
    }
  }

  const submitSetup = async (event) => {
    event.preventDefault()
    feedback.clear()
    if (!setupCode.trim()) {
      feedback.notifyError('Authentication code is required')
      return
    }
    setSetupBusy(true)
    try {
      const result = await verify2FASetup(setupCode.trim())
      setBackupCodes(result.backupCodes)
      setSetupData(null)
      setSetupCode('')
      feedback.notifySuccess(result.message || 'Two-factor authentication enabled')
      logUiAction('Profile & Security', 'Enable 2FA')
      await onUserRefresh?.()
    } catch (error) {
      feedback.notifyError(error.message)
    } finally {
      setSetupBusy(false)
    }
  }

  const regenerateCodes = async (event) => {
    event.preventDefault()
    feedback.clear()
    if (!regenerateForm.currentPassword || !regenerateForm.code) {
      feedback.notifyError('Current password and authentication code are required')
      return
    }
    setRegenerateBusy(true)
    try {
      const result = await regenerate2FABackupCodes(
        regenerateForm.currentPassword,
        regenerateForm.code
      )
      setBackupCodes(result.backupCodes)
      setRegenerateForm({ currentPassword: '', code: '' })
      setShowRegenerate(false)
      feedback.notifySuccess(result.message || 'Backup codes regenerated')
      logUiAction('Profile & Security', 'Regenerate 2FA Backup Codes')
      await onUserRefresh?.()
    } catch (error) {
      feedback.notifyError(error.message)
    } finally {
      setRegenerateBusy(false)
    }
  }

  const disable2FA = async (event) => {
    event.preventDefault()
    feedback.clear()
    if (!disableForm.currentPassword || !disableForm.code) {
      feedback.notifyError('Current password and authentication code are required')
      return
    }
    const approved = await confirm({
      title: 'Disable two-factor authentication',
      message: 'This removes the authenticator and all recovery codes from your account.',
      details: 'Anyone who knows your password will be able to sign in until you enable 2FA again.',
      tone: 'danger',
      confirmLabel: 'Disable 2FA',
      module: 'Profile & Security',
    })
    if (!approved) return

    setDisableBusy(true)
    try {
      const result = await disableOwn2FA(disableForm.currentPassword, disableForm.code)
      feedback.notifySuccess(result.message || 'Two-factor authentication disabled')
      setDisableForm({ currentPassword: '', code: '' })
      setShowDisable(false)
      logUiAction('Profile & Security', 'Disable 2FA')
      await onUserRefresh?.()
    } catch (error) {
      feedback.notifyError(error.message)
    } finally {
      setDisableBusy(false)
    }
  }

  const cancelRequest = async (request) => {
    const approved = await confirm({
      title: 'Cancel password reset request',
      message: `Cancel request ${request.requestNumber}?`,
      details: 'You can submit a new request later if you still need help.',
      tone: 'warning',
      confirmLabel: 'Cancel request',
      module: 'Profile & Security',
    })
    if (!approved) return
    try {
      await cancelMyResetRequest(request.id)
      feedback.notifySuccess('Password reset request cancelled')
      await loadSelfServiceData()
    } catch (error) {
      feedback.notifyError(error.message)
    }
  }

  return (
    <div className="security-panel">
      <AlertMessage tone="success" message={feedback.successMsg} onDismiss={feedback.clearSuccess} />
      <AlertMessage tone="error" message={feedback.errorMsg} onDismiss={feedback.clearError} />
      {!canEditOwn && (
        <AlertMessage
          tone="info"
          title="View-only security access"
          message="Your role can view account security but not change it. Ask an administrator for the Edit Own Security Settings permission."
        />
      )}

      <div className="security-metric-grid">
        <SecurityMetric
          label="Account status"
          value={loggedInUser?.status || '—'}
          hint={loggedInUser?.username}
          tone={loggedInUser?.status === 'Active' ? 'active' : 'inactive'}
          icon="user"
        />
        <SecurityMetric
          label="Password"
          value={passwordStatus.label}
          hint={
            security.passwordChangedAt
              ? `Changed ${describeRelativeTime(security.passwordChangedAt)}`
              : 'No password change recorded'
          }
          tone={passwordStatus.tone}
          icon="key"
        />
        <SecurityMetric
          label="Two-factor authentication"
          value={totpEnabled ? 'Enabled' : security.twoFactorEnrollmentRequired ? 'Required' : 'Disabled'}
          hint={
            totpEnabled
              ? `${security.backupCodesRemaining} recovery code${security.backupCodesRemaining === 1 ? '' : 's'} remaining`
              : 'Add a second factor to protect your account'
          }
          tone={totpEnabled ? 'active' : security.twoFactorEnrollmentRequired ? 'warning' : 'neutral'}
          icon="shieldCheck"
        />
        <SecurityMetric
          label="Last sign-in"
          value={security.lastLoginAt ? describeRelativeTime(security.lastLoginAt) : '—'}
          hint={security.lastLoginAt ? formatSecurityDateTime(security.lastLoginAt) : 'No sign-in recorded'}
          tone="neutral"
          icon="history"
        />
      </div>

      <SecurityCard
        title="Change password"
        description="Your password must meet the policy below. A successful change signs out every other session."
        icon="key"
      >
        {!canEditOwn ? (
          <p className="security-muted-text">
            Password changes are not available for your role.
          </p>
        ) : (
        <form className="security-form" onSubmit={submitPasswordChange}>
          <PasswordInput
            id="self-current-password"
            label="Current password"
            value={passwordForm.currentPassword}
            onChange={(value) => {
              setPasswordForm((current) => ({ ...current, currentPassword: value }))
              setPasswordErrors((current) => ({ ...current, currentPassword: '' }))
            }}
            error={passwordErrors.currentPassword}
            autoComplete="current-password"
          />
          <PasswordInput
            id="self-new-password"
            label="New password"
            value={passwordForm.newPassword}
            onChange={(value) => {
              setPasswordForm((current) => ({ ...current, newPassword: value }))
              setPasswordErrors((current) => ({ ...current, newPassword: '' }))
            }}
            error={passwordErrors.newPassword}
            autoComplete="new-password"
          />
          <PasswordInput
            id="self-confirm-password"
            label="Confirm new password"
            value={passwordForm.confirmPassword}
            onChange={(value) => {
              setPasswordForm((current) => ({ ...current, confirmPassword: value }))
              setPasswordErrors((current) => ({ ...current, confirmPassword: '' }))
            }}
            error={passwordErrors.confirmPassword}
            autoComplete="new-password"
          />
          <div className="security-form-wide">
            <PasswordPolicyChecklist
              password={passwordForm.newPassword}
              user={loggedInUser}
              currentPassword={passwordForm.currentPassword}
            />
          </div>
          <div className="security-form-actions security-form-wide">
            <button type="submit" className="btn-primary" disabled={passwordBusy}>
              {passwordBusy ? 'Saving…' : 'Change password'}
            </button>
          </div>
        </form>
        )}
      </SecurityCard>

      <SecurityCard
        title="Two-factor authentication"
        description="Use an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…) for a time-based code."
        icon="shieldCheck"
        actions={
          canEditOwn && !totpEnabled ? (
            <button type="button" className="btn-primary" onClick={beginSetup} disabled={setupBusy}>
              <Icon name="plus" size={15} />
              {setupBusy ? 'Starting…' : 'Enable 2FA'}
            </button>
          ) : null
        }
      >
        {totpEnabled && (
          <div className="security-status-row">
            <SecurityPill tone="enabled" icon="shieldCheck">
              2FA enabled
            </SecurityPill>
            <span className="security-muted-text">
              Confirmed {formatSecurityDateTime(security.twoFactorConfirmedAt)}
            </span>
            <SecurityPill tone={security.backupCodesRemaining > 0 ? 'info' : 'warning'} icon="key">
              {security.backupCodesRemaining} recovery code
              {security.backupCodesRemaining === 1 ? '' : 's'}
            </SecurityPill>
            {security.force2FA && (
              <SecurityPill tone="warning" icon="lock">
                Mandatory by policy
              </SecurityPill>
            )}
          </div>
        )}

        {!totpEnabled && !setupData && (
          <p className="security-muted-text">
            Two-factor authentication is not enabled. Your account is protected by your password only.
          </p>
        )}

        {reconfigureOpen && (
          <form className="security-form security-subsection" onSubmit={submitReconfigure}>
            <p className="security-form-wide security-muted-text">
              Reconfiguring requires your current password and a working authenticator code. Your
              existing authenticator stays active until the new one is verified.
            </p>
            <PasswordInput
              id="reconfigure-password"
              label="Current password"
              value={reconfigureForm.currentPassword}
              onChange={(value) => setReconfigureForm((current) => ({ ...current, currentPassword: value }))}
            />
            <div className="security-field">
              <label htmlFor="reconfigure-code">Current authenticator code</label>
              <input
                id="reconfigure-code"
                value={reconfigureForm.code}
                onChange={(event) =>
                  setReconfigureForm((current) => ({ ...current, code: event.target.value }))
                }
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
              />
            </div>
            <div className="security-form-actions security-form-wide">
              <button type="submit" className="btn-primary" disabled={setupBusy}>
                {setupBusy ? 'Verifying…' : 'Verify and continue'}
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setReconfigureOpen(false)}
                disabled={setupBusy}
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {setupData && (
          <div className="security-setup">
            <div className="security-setup-qr">
              <img src={setupData.qrCodeDataUrl} alt="Two-factor authentication QR code" />
              <p>
                Scan the code with your authenticator app, then enter the 6-digit code it shows.
              </p>
              {setupData.manualEntryCode && (
                <CopyableSecret
                  value={setupData.manualEntryCode}
                  label="Manual setup code"
                  hint={`Account: ${setupData.accountName || loggedInUser?.username} · ${setupData.issuer}`}
                />
              )}
            </div>
            <form className="security-setup-form" onSubmit={submitSetup}>
              <div className="security-field">
                <label htmlFor="setup-code">Authenticator code</label>
                <input
                  id="setup-code"
                  value={setupCode}
                  onChange={(event) => setSetupCode(event.target.value)}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="123456"
                  autoFocus
                />
                <small className="security-field-hint">
                  Codes rotate every 30 seconds. Setup expires in {setupData.expiresInMinutes || 15} minutes.
                </small>
              </div>
              <div className="security-form-actions">
                <button type="submit" className="btn-primary" disabled={setupBusy}>
                  {setupBusy ? 'Verifying…' : 'Verify and enable'}
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setSetupData(null)
                    setSetupCode('')
                  }}
                  disabled={setupBusy}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {backupCodes.length > 0 && (
          <div className="security-recovery-panel">
            <div className="security-recovery-heading">
              <Icon name="shieldCheck" size={16} />
              <strong>Save your recovery codes</strong>
            </div>
            <p>
              Each code can be used once if you lose access to your authenticator. They are shown
              only now and cannot be retrieved later.
            </p>
            <pre className="security-recovery-codes">{backupCodes.join('\n')}</pre>
            <div className="security-form-actions">
              <CopyableSecret value={backupCodes.join('\n')} label="All recovery codes" />
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setBackupCodes([])}
              >
                I have saved them
              </button>
            </div>
          </div>
        )}

        {canEditOwn && totpEnabled && (
          <div className="security-actions">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setReconfigureForm({ currentPassword: '', code: '' })
                setReconfigureOpen(true)
                setSetupData(null)
              }}
              disabled={setupBusy || disableBusy || regenerateBusy}
            >
              <Icon name="refresh" size={15} />
              Reconfigure authenticator
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setShowRegenerate((current) => !current)
                setShowDisable(false)
              }}
              disabled={setupBusy || disableBusy || regenerateBusy}
            >
              <Icon name="key" size={15} />
              Regenerate recovery codes
            </button>
            {!security.force2FA && (
              <button
                type="button"
                className="btn-danger-outline"
                onClick={() => {
                  setShowDisable((current) => !current)
                  setShowRegenerate(false)
                }}
                disabled={setupBusy || disableBusy || regenerateBusy}
              >
                Disable 2FA
              </button>
            )}
          </div>
        )}

        {showRegenerate && (
          <form className="security-form security-subsection" onSubmit={regenerateCodes}>
            <p className="security-form-wide security-muted-text">
              Confirm with your current password and a 6-digit code or one unused recovery code.
            </p>
            <PasswordInput
              id="regenerate-password"
              label="Current password"
              value={regenerateForm.currentPassword}
              onChange={(value) => setRegenerateForm((current) => ({ ...current, currentPassword: value }))}
            />
            <div className="security-field">
              <label htmlFor="regenerate-code">Authenticator or recovery code</label>
              <input
                id="regenerate-code"
                value={regenerateForm.code}
                onChange={(event) =>
                  setRegenerateForm((current) => ({ ...current, code: event.target.value }))
                }
                autoComplete="one-time-code"
                placeholder="123456 or ABCDE-FGHIJ"
              />
            </div>
            <div className="security-form-actions security-form-wide">
              <button type="submit" className="btn-primary" disabled={regenerateBusy}>
                {regenerateBusy ? 'Working…' : 'Regenerate codes'}
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setShowRegenerate(false)}
                disabled={regenerateBusy}
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {showDisable && (
          <form className="security-form security-subsection" onSubmit={disable2FA}>
            <p className="security-form-wide security-muted-text">
              Disabling 2FA requires your current password and a valid second factor.
            </p>
            <PasswordInput
              id="disable-password"
              label="Current password"
              value={disableForm.currentPassword}
              onChange={(value) => setDisableForm((current) => ({ ...current, currentPassword: value }))}
            />
            <div className="security-field">
              <label htmlFor="disable-code">Authenticator or recovery code</label>
              <input
                id="disable-code"
                value={disableForm.code}
                onChange={(event) => setDisableForm((current) => ({ ...current, code: event.target.value }))}
                autoComplete="one-time-code"
                placeholder="123456 or ABCDE-FGHIJ"
              />
            </div>
            <div className="security-form-actions security-form-wide">
              <button type="submit" className="btn-danger" disabled={disableBusy}>
                {disableBusy ? 'Disabling…' : 'Disable 2FA'}
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setShowDisable(false)}
                disabled={disableBusy}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </SecurityCard>

      <SecurityCard
        title="Password reset requests"
        description="Requests you submitted from the sign-in page and their current status."
        icon="history"
      >
        {requestsLoading ? (
          <p className="security-muted-text">Loading requests…</p>
        ) : resetRequests.length === 0 ? (
          <SecurityEmpty
            icon="checkCircle"
            title="No password reset requests"
            description="If you ever lose access, use “Reset password” on the sign-in page to notify an administrator."
          />
        ) : (
          <div className="security-request-list">
            {resetRequests.map((request) => (
              <div key={request.id} className="security-request-row">
                <div className="security-request-main">
                  <strong>{request.requestNumber}</strong>
                  <span className="security-muted-text">
                    {formatSecurityDateTime(request.requestedAt)}
                    {request.reason ? ` · ${request.reason}` : ''}
                  </span>
                  {request.actionNotes && (
                    <span className="security-request-note">Administrator: {request.actionNotes}</span>
                  )}
                </div>
                <SecurityPill tone={STATUS_TONE[String(request.status).toLowerCase()] || 'neutral'}>
                  {request.status}
                </SecurityPill>
                {request.reset2FA && <SecurityPill tone="info" icon="shieldCheck">2FA reset requested</SecurityPill>}
                {String(request.status).toLowerCase() === 'pending' && (
                  <button
                    type="button"
                    className="btn-secondary btn-compact"
                    onClick={() => cancelRequest(request)}
                  >
                    Cancel request
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </SecurityCard>

      <SecurityCard
        title="Recent security activity"
        description="Sign-ins, password changes and 2FA events recorded on your account."
        icon="activity"
      >
        {activity.length === 0 ? (
          <SecurityEmpty icon="activity" title="No security events yet" />
        ) : (
          <ul className="security-activity-list">
            {activity.map((event) => (
              <li key={event.id}>
                <span className="security-activity-dot" aria-hidden="true" />
                <div>
                  <strong>{event.action}</strong>
                  {event.remarks && <span className="security-muted-text"> · {event.remarks}</span>}
                  <div className="security-activity-meta">
                    {formatSecurityDateTime(event.createdAt)}
                    {event.performedBy ? ` · ${event.performedBy}` : ''}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SecurityCard>
    </div>
  )
}

export default MySecurityPanel
