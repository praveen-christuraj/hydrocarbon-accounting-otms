import { useCallback, useEffect, useMemo, useState } from 'react'
import Modal from '../common/Modal'
import AlertMessage from '../common/AlertMessage'
import Icon from '../common/Icon'
import { useConfirm } from '../common/ConfirmProvider'
import usePermissions from '../../hooks/usePermissions'
import { logUiAction } from '../../utils/actionLogger'
import {
  adminResetUserPassword,
  getSecurityUserHistory,
  lockUserAccount,
  requirePasswordChange,
  resetUser2FA,
  revokeUserSessions,
  unlockUserAccount,
  updateTwoFactorPolicy,
} from '../../api/securityApi'
import {
  CopyableSecret,
  PasswordInput,
  PasswordPolicyChecklist,
  SecurityPill,
  buildPasswordChecks,
  formatLockUntil,
  formatSecurityDateTime,
} from './SecurityPrimitives'

const defaultResetForm = {
  newPassword: '',
  forcePasswordChange: true,
  reset2FA: false,
  unlockAccount: true,
  remarks: '',
}

function UserSecurityDialog({ open, user, loggedInUser, onClose, onChanged }) {
  const { hasPermission } = usePermissions(loggedInUser)
  const confirm = useConfirm()

  const canResetPassword = hasPermission('Reset User Password')
  const canReset2FA = hasPermission('Reset User 2FA')
  const canLock = hasPermission('Lock User Account')
  const canUnlock = hasPermission('Unlock User Account')
  const canRevoke = hasPermission('Revoke User Sessions')

  // The dialog is mounted with a `key` per user, so initial state can read the
  // selected account directly instead of resetting every field in an effect.
  const [mode, setMode] = useState('generate')
  const [resetForm, setResetForm] = useState(() => ({
    ...defaultResetForm,
    reset2FA: Boolean(user?.totpEnabled),
  }))
  const [lockForm, setLockForm] = useState({ reason: '', duration: '60' })
  const [actionReason, setActionReason] = useState('')
  const [busyAction, setBusyAction] = useState('')
  const [success, setSuccess] = useState('')
  const [error, setError] = useState('')
  const [temporaryPassword, setTemporaryPassword] = useState('')
  const [history, setHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)

  const loadHistory = useCallback(async () => {
    if (!user?.id) return
    setHistoryLoading(true)
    try {
      setHistory(await getSecurityUserHistory(user.id, 25))
    } catch (historyError) {
      setError(historyError.message)
    } finally {
      setHistoryLoading(false)
    }
  }, [user])

  useEffect(() => {
    if (!open || !user) return
    loadHistory()
  }, [open, user, loadHistory])

  const passwordChecks = useMemo(
    () => buildPasswordChecks(resetForm.newPassword, { user }),
    [resetForm.newPassword, user]
  )
  const manualPasswordValid = passwordChecks.every((check) => check.met)

  if (!user) return null

  const runAction = async (key, action, successMessage, { confirmOptions } = {}) => {
    setError('')
    setSuccess('')
    if (confirmOptions) {
      const approved = await confirm({
        module: 'Profile & Security',
        ...confirmOptions,
      })
      if (!approved) return null
    }
    setBusyAction(key)
    try {
      const result = await action()
      setSuccess(result?.message || successMessage)
      logUiAction('Profile & Security', successMessage, { username: user.username })
      await onChanged?.()
      await loadHistory()
      return result
    } catch (actionError) {
      setError(actionError.message)
      return null
    } finally {
      setBusyAction('')
    }
  }

  const submitPasswordReset = async (event) => {
    event.preventDefault()
    setError('')
    setSuccess('')
    setTemporaryPassword('')
    if (mode === 'manual' && !manualPasswordValid) {
      setError('The new password does not meet the password policy.')
      return
    }
    const approved = await confirm({
      title: 'Reset password',
      message: `Reset the password for ${user.fullName || user.username}?`,
      details:
        'All of this user’s sessions are signed out immediately. Share the temporary password through a secure channel.',
      tone: 'danger',
      confirmLabel: 'Reset password',
      module: 'Profile & Security',
    })
    if (!approved) return

    setBusyAction('password')
    try {
      const result = await adminResetUserPassword(user.id, {
        generatePassword: mode === 'generate',
        newPassword: resetForm.newPassword,
        forcePasswordChange: resetForm.forcePasswordChange,
        reset2FA: canReset2FA && resetForm.reset2FA,
        unlockAccount: resetForm.unlockAccount,
        remarks: resetForm.remarks,
      })
      setTemporaryPassword(result.temporaryPassword)
      setSuccess(
        result.temporaryPassword
          ? 'Password reset. Copy the temporary password now — it is shown only once.'
          : 'Password reset successfully.'
      )
      setResetForm({ ...defaultResetForm, reset2FA: false })
      logUiAction('Profile & Security', 'Admin Reset User Password', { username: user.username })
      await onChanged?.()
      await loadHistory()
    } catch (resetError) {
      setError(resetError.message)
    } finally {
      setBusyAction('')
    }
  }

  const submitLock = async (event) => {
    event.preventDefault()
    const result = await runAction(
      'lock',
      () =>
        lockUserAccount(user.id, {
          reason: lockForm.reason,
          durationMinutes: lockForm.duration === 'indefinite' ? null : Number(lockForm.duration),
        }),
      'User account locked',
      {
        confirmOptions: {
          title: 'Lock user account',
          message: `Lock ${user.fullName || user.username} out of the system?`,
          details: 'The user cannot sign in until an administrator unlocks the account.',
          tone: 'danger',
          confirmLabel: 'Lock account',
        },
      }
    )
    if (result) setLockForm({ reason: '', duration: '60' })
  }

  const unlock = async () =>
    runAction(
      'unlock',
      () => unlockUserAccount(user.id, { reason: actionReason }),
      'User account unlocked',
      {
        confirmOptions: {
          title: 'Unlock user account',
          message: `Unlock ${user.fullName || user.username}?`,
          details: 'The failed sign-in counter is cleared and the temporary lock is removed.',
          tone: 'warning',
          confirmLabel: 'Unlock account',
        },
      }
    )

  const resetTwoFactor = async () =>
    runAction(
      'reset2fa',
      () => resetUser2FA(user.id, { reason: actionReason }),
      'Two-factor authentication reset',
      {
        confirmOptions: {
          title: 'Reset two-factor authentication',
          message: `Remove the authenticator for ${user.fullName || user.username}?`,
          details:
            'Recovery codes are invalidated and all sessions are signed out. The user must enrol a new authenticator when 2FA is mandatory.',
          tone: 'danger',
          confirmLabel: 'Reset 2FA',
        },
      }
    )

  const revokeSessions = async () =>
    runAction(
      'revoke',
      () => revokeUserSessions(user.id, { reason: actionReason }),
      'Sessions revoked',
      {
        confirmOptions: {
          title: 'Revoke sessions',
          message: `Sign ${user.fullName || user.username} out everywhere?`,
          details: 'Every access and refresh token issued before now stops working.',
          tone: 'danger',
          confirmLabel: 'Revoke sessions',
        },
      }
    )

  const forcePasswordChange = async () =>
    runAction(
      'require-change',
      () => requirePasswordChange(user.id, { reason: actionReason }),
      'Password change required at next sign-in',
      {
        confirmOptions: {
          title: 'Require password change',
          message: `Require ${user.fullName || user.username} to change their password at next sign-in?`,
          tone: 'warning',
          confirmLabel: 'Require change',
        },
      }
    )

  const toggle2FAPolicy = async () => {
    const nextRequired = !user.force2FA
    await runAction(
      '2fa-policy',
      () => updateTwoFactorPolicy(user.id, nextRequired, actionReason),
      nextRequired ? '2FA is now mandatory' : '2FA is no longer mandatory',
      {
        confirmOptions: {
          title: nextRequired ? 'Make 2FA mandatory' : 'Remove mandatory 2FA',
          message: `${nextRequired ? 'Require' : 'Stop requiring'} two-factor authentication for ${
            user.fullName || user.username
          }?`,
          details: nextRequired
            ? 'If the user has not enrolled an authenticator, business pages are blocked until they do.'
            : 'The user can disable 2FA from their Profile & Security page.',
          tone: 'warning',
          confirmLabel: nextRequired ? 'Require 2FA' : 'Remove requirement',
        },
      }
    )
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title={`Security — ${user.fullName || user.username}`}
      description={`${user.username} · ${user.email || 'no email'} · Account ${String(user.status).toLowerCase()}`}
      footer={
        <button type="button" className="btn-secondary" onClick={onClose} disabled={Boolean(busyAction)}>
          Close
        </button>
      }
    >
      <div className="security-dialog">
        <AlertMessage tone="success" message={success} onDismiss={() => setSuccess('')} />
        <AlertMessage tone="error" message={error} onDismiss={() => setError('')} />

        <div className="security-dialog-badges">
          <SecurityPill tone={user.isLocked ? 'locked' : user.status === 'Active' ? 'active' : 'inactive'}>
            {user.isLocked ? 'Locked' : user.status}
          </SecurityPill>
          <SecurityPill tone={user.totpEnabled ? 'enabled' : 'disabled'} icon="shieldCheck">
            {user.totpEnabled ? '2FA enabled' : '2FA not enabled'}
          </SecurityPill>
          {user.force2FA && <SecurityPill tone="warning" icon="lock">2FA mandatory</SecurityPill>}
          {user.passwordChangeRequired && (
            <SecurityPill tone="warning" icon="key">
              Password change required
            </SecurityPill>
          )}
          {user.roles.map((role) => (
            <SecurityPill key={role.id} tone="info" icon="users">
              {role.role_name}
            </SecurityPill>
          ))}
        </div>

        <div className="security-dialog-grid">
          <div className="security-dialog-facts">
            <div>
              <span>Last sign-in</span>
              <strong>{formatSecurityDateTime(user.lastLoginAt)}</strong>
            </div>
            <div>
              <span>Last sign-in IP</span>
              <strong>{user.lastLoginIp || '—'}</strong>
            </div>
            <div>
              <span>Failed attempts</span>
              <strong>{user.failedLoginCount}</strong>
            </div>
            <div>
              <span>Password changed</span>
              <strong>{formatSecurityDateTime(user.passwordChangedAt)}</strong>
            </div>
            <div>
              <span>Recovery codes</span>
              <strong>{user.backupCodesRemaining}</strong>
            </div>
            <div>
              <span>Lock reason</span>
              <strong>{user.lockedReason || '—'}</strong>
            </div>
          </div>

          <div className="security-dialog-actions">
            <div className="security-field">
              <label htmlFor="security-action-reason">Reason for this action</label>
              <input
                id="security-action-reason"
                value={actionReason}
                onChange={(event) => setActionReason(event.target.value)}
                placeholder="Ticket reference or reason (recorded in the audit trail)"
              />
            </div>
            {user.isLocked && canUnlock && (
              <div className="security-action-block tone-warning">
                <div>
                  <strong>Account is locked</strong>
                  <p>
                    {user.lockedReason || 'Locked by an administrator'}
                    {user.lockedUntil ? ` · until ${formatLockUntil(user.lockedUntil)}` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={unlock}
                  disabled={Boolean(busyAction)}
                >
                  {busyAction === 'unlock' ? 'Unlocking…' : 'Unlock account'}
                </button>
              </div>
            )}

            {!user.isLocked && user.status === 'Active' && canLock && (
              <form className="security-action-block" onSubmit={submitLock}>
                <div>
                  <strong>Lock account</strong>
                  <p>Temporarily or indefinitely prevent sign-in.</p>
                </div>
                <div className="security-inline-form">
                  <input
                    value={lockForm.reason}
                    onChange={(event) => setLockForm((current) => ({ ...current, reason: event.target.value }))}
                    placeholder="Reason (optional)"
                    aria-label="Lock reason"
                  />
                  <select
                    value={lockForm.duration}
                    onChange={(event) => setLockForm((current) => ({ ...current, duration: event.target.value }))}
                    aria-label="Lock duration"
                  >
                    <option value="15">15 minutes</option>
                    <option value="60">1 hour</option>
                    <option value="1440">24 hours</option>
                    <option value="indefinite">Until unlocked</option>
                  </select>
                  <button type="submit" className="btn-danger" disabled={Boolean(busyAction)}>
                    {busyAction === 'lock' ? 'Locking…' : 'Lock account'}
                  </button>
                </div>
              </form>
            )}

            {canRevoke && (
              <div className="security-action-block">
                <div>
                  <strong>Revoke sessions</strong>
                  <p>Sign the user out of every browser and device immediately.</p>
                </div>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={revokeSessions}
                  disabled={Boolean(busyAction)}
                >
                  <Icon name="logout" size={15} />
                  {busyAction === 'revoke' ? 'Revoking…' : 'Revoke sessions'}
                </button>
              </div>
            )}

            {canResetPassword && (
              <div className="security-action-block">
                <div>
                  <strong>Require password change</strong>
                  <p>Keep the current password but force a change at the next sign-in.</p>
                </div>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={forcePasswordChange}
                  disabled={Boolean(busyAction)}
                >
                  <Icon name="key" size={15} />
                  {busyAction === 'require-change' ? 'Updating…' : 'Require change'}
                </button>
              </div>
            )}

            {canReset2FA && (
              <div className="security-action-block">
                <div>
                  <strong>Two-factor policy</strong>
                  <p>
                    {user.force2FA
                      ? '2FA is mandatory for this account.'
                      : '2FA is optional for this account.'}
                  </p>
                </div>
                <div className="security-inline-actions">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={toggle2FAPolicy}
                    disabled={Boolean(busyAction)}
                  >
                    {busyAction === '2fa-policy'
                      ? 'Updating…'
                      : user.force2FA
                        ? 'Make optional'
                        : 'Make mandatory'}
                  </button>
                  {user.totpEnabled && (
                    <button
                      type="button"
                      className="btn-danger-outline"
                      onClick={resetTwoFactor}
                      disabled={Boolean(busyAction)}
                    >
                      {busyAction === 'reset2fa' ? 'Resetting…' : 'Reset authenticator'}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {canResetPassword && (
          <section className="security-dialog-section">
            <h3>Reset password</h3>
            <p className="security-muted-text">
              Delivered passwords are shown once. Users with “force change” enabled must choose a
              new password before they can use the system.
            </p>
            <form className="security-form" onSubmit={submitPasswordReset}>
              <div className="security-radio-row security-form-wide">
                <label>
                  <input
                    type="radio"
                    name="password-mode"
                    checked={mode === 'generate'}
                    onChange={() => setMode('generate')}
                  />
                  Generate a secure temporary password
                </label>
                <label>
                  <input
                    type="radio"
                    name="password-mode"
                    checked={mode === 'manual'}
                    onChange={() => setMode('manual')}
                  />
                  Enter a password manually
                </label>
              </div>

              {mode === 'manual' && (
                <>
                  <PasswordInput
                    id="admin-new-password"
                    label="New password"
                    value={resetForm.newPassword}
                    onChange={(value) => setResetForm((current) => ({ ...current, newPassword: value }))}
                    autoComplete="new-password"
                  />
                  <div className="security-form-wide">
                    <PasswordPolicyChecklist password={resetForm.newPassword} user={user} />
                  </div>
                </>
              )}

              <div className="security-checkbox-stack security-form-wide">
                <label>
                  <input
                    type="checkbox"
                    checked={resetForm.forcePasswordChange}
                    onChange={(event) =>
                      setResetForm((current) => ({ ...current, forcePasswordChange: event.target.checked }))
                    }
                  />
                  Force a password change at next sign-in
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={resetForm.unlockAccount}
                    onChange={(event) =>
                      setResetForm((current) => ({ ...current, unlockAccount: event.target.checked }))
                    }
                  />
                  Clear any account lock and failed sign-in counter
                </label>
                {canReset2FA && (
                  <label>
                    <input
                      type="checkbox"
                      checked={resetForm.reset2FA}
                      onChange={(event) =>
                        setResetForm((current) => ({ ...current, reset2FA: event.target.checked }))
                      }
                    />
                    Also reset two-factor authentication
                  </label>
                )}
              </div>
              <div className="security-field security-form-wide">
                <label htmlFor="reset-remarks">Reason / remarks</label>
                <textarea
                  id="reset-remarks"
                  rows="2"
                  value={resetForm.remarks}
                  onChange={(event) => setResetForm((current) => ({ ...current, remarks: event.target.value }))}
                  placeholder="Reference the ticket, identity check or reason for the reset"
                />
              </div>
              <div className="security-form-actions security-form-wide">
                <button type="submit" className="btn-danger" disabled={Boolean(busyAction)}>
                  {busyAction === 'password' ? 'Resetting…' : 'Reset password'}
                </button>
              </div>
            </form>

            {temporaryPassword && (
              <CopyableSecret
                value={temporaryPassword}
                label="Temporary password (shown once)"
                hint="Share it through a secure channel. The user must change it at next sign-in."
              />
            )}
          </section>
        )}

        <section className="security-dialog-section">
          <h3>Security history</h3>
          {historyLoading ? (
            <p className="security-muted-text">Loading…</p>
          ) : history.length === 0 ? (
            <p className="security-muted-text">No security events recorded for this account yet.</p>
          ) : (
            <ul className="security-activity-list compact">
              {history.map((event) => (
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
        </section>
      </div>
    </Modal>
  )
}

export default UserSecurityDialog
