import { useCallback, useEffect, useMemo, useState } from 'react'
import AlertMessage from '../common/AlertMessage'
import Icon from '../common/Icon'
import {
  changeOwnPassword,
  start2FASetup,
  verify2FASetup,
} from '../../api/securityApi'
import { logUiAction } from '../../utils/actionLogger'
import {
  CopyableSecret,
  PasswordInput,
  PasswordPolicyChecklist,
  buildPasswordChecks,
} from './SecurityPrimitives'

/**
 * Blocking security screen.
 *
 * The API refuses every business endpoint while a password change or a
 * mandatory 2FA enrolment is outstanding, so the UI must not merely toast a
 * warning: it renders this screen in place of the application until the
 * prerequisite is satisfied.
 *
 * mode = 'password' | '2fa'
 */
function SecurityGate({ mode, loggedInUser, onRefresh, onLogout }) {
  const security = loggedInUser?.security || {}

  return (
    <div className="security-gate-page">
      <div className="security-gate-card">
        <div className="security-gate-brand">
          <span className="security-gate-logo" aria-hidden="true">
            <Icon name="shieldCheck" size={26} />
          </span>
          <div>
            <strong>Hydrocarbon Accounting System</strong>
            <span>Account security</span>
          </div>
        </div>

        {mode === 'password' ? (
          <PasswordGateForm
            loggedInUser={loggedInUser}
            security={security}
            onRefresh={onRefresh}
            onLogout={onLogout}
          />
        ) : (
          <TwoFactorGateForm onRefresh={onRefresh} onLogout={onLogout} />
        )}
      </div>
    </div>
  )
}

function PasswordGateForm({ loggedInUser, security, onRefresh, onLogout }) {
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' })
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const checks = useMemo(
    () =>
      buildPasswordChecks(form.newPassword, {
        user: loggedInUser,
        currentPassword: form.currentPassword,
      }),
    [form.newPassword, form.currentPassword, loggedInUser]
  )

  const submit = async (event) => {
    event.preventDefault()
    setError('')
    const nextErrors = {}
    if (!form.currentPassword) nextErrors.currentPassword = 'Current password is required'
    if (!form.newPassword) nextErrors.newPassword = 'New password is required'
    if (form.newPassword !== form.confirmPassword) {
      nextErrors.confirmPassword = 'Passwords do not match'
    }
    if (!checks.every((check) => check.met)) {
      nextErrors.newPassword =
        nextErrors.newPassword || 'The new password does not meet every policy rule below'
    }
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    setBusy(true)
    try {
      await changeOwnPassword(form)
      logUiAction('Profile & Security', 'Forced Password Change')
      await onRefresh()
    } catch (submitError) {
      setError(submitError.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="security-gate-heading">
        <h1>Set a new password</h1>
        <p>
          {security.passwordExpired
            ? 'Your password has expired. Choose a new password to continue.'
            : 'Your administrator requires a new password before you can use the system.'}
        </p>
      </div>

      <AlertMessage tone="error" message={error} onDismiss={() => setError('')} />

      <form className="security-gate-form" onSubmit={submit}>
        <PasswordInput
          id="gate-current-password"
          label="Current password"
          value={form.currentPassword}
          onChange={(value) => {
            setForm((current) => ({ ...current, currentPassword: value }))
            setErrors((current) => ({ ...current, currentPassword: '' }))
          }}
          error={errors.currentPassword}
          autoComplete="current-password"
        />
        <PasswordInput
          id="gate-new-password"
          label="New password"
          value={form.newPassword}
          onChange={(value) => {
            setForm((current) => ({ ...current, newPassword: value }))
            setErrors((current) => ({ ...current, newPassword: '' }))
          }}
          error={errors.newPassword}
          autoComplete="new-password"
        />
        <PasswordInput
          id="gate-confirm-password"
          label="Confirm new password"
          value={form.confirmPassword}
          onChange={(value) => {
            setForm((current) => ({ ...current, confirmPassword: value }))
            setErrors((current) => ({ ...current, confirmPassword: '' }))
          }}
          error={errors.confirmPassword}
          autoComplete="new-password"
        />
        <PasswordPolicyChecklist
          password={form.newPassword}
          user={loggedInUser}
          currentPassword={form.currentPassword}
        />
        <div className="security-gate-actions">
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Change password and continue'}
          </button>
          <button type="button" className="btn-secondary" onClick={onLogout} disabled={busy}>
            Sign out
          </button>
        </div>
      </form>
    </>
  )
}

function TwoFactorGateForm({ onRefresh, onLogout }) {
  const [setupData, setSetupData] = useState(null)
  const [code, setCode] = useState('')
  const [backupCodes, setBackupCodes] = useState([])
  const [busy, setBusy] = useState(false)
  const [starting, setStarting] = useState(true)
  const [error, setError] = useState('')

  const begin = useCallback(async () => {
    setStarting(true)
    setError('')
    try {
      const data = await start2FASetup({})
      setSetupData(data)
      logUiAction('Profile & Security', 'Forced 2FA Setup Started')
    } catch (startError) {
      setError(startError.message)
    } finally {
      setStarting(false)
    }
  }, [])

  useEffect(() => {
    begin()
  }, [begin])

  const submit = async (event) => {
    event.preventDefault()
    setError('')
    if (!code.trim()) {
      setError('Enter the 6-digit code shown by your authenticator app')
      return
    }
    setBusy(true)
    try {
      const result = await verify2FASetup(code.trim())
      setBackupCodes(result.backupCodes || [])
      setSetupData(null)
      setCode('')
      logUiAction('Profile & Security', 'Forced 2FA Enrolment Completed')
    } catch (verifyError) {
      setError(verifyError.message)
    } finally {
      setBusy(false)
    }
  }

  if (backupCodes.length > 0) {
    return (
      <>
        <div className="security-gate-heading">
          <h1>Two-factor authentication enabled</h1>
          <p>Store these recovery codes somewhere safe. They are shown only once.</p>
        </div>
        <div className="security-recovery-panel">
          <pre className="security-recovery-codes">{backupCodes.join('\n')}</pre>
          <CopyableSecret value={backupCodes.join('\n')} label="All recovery codes" />
        </div>
        <div className="security-gate-actions">
          <button type="button" className="btn-primary" onClick={onRefresh}>
            I have saved the codes — continue
          </button>
        </div>
      </>
    )
  }

  return (
    <>
      <div className="security-gate-heading">
        <h1>Set up two-factor authentication</h1>
        <p>
          Your administrator requires a second factor. Scan the QR code with an authenticator app,
          then enter the 6-digit code it shows.
        </p>
      </div>

      <AlertMessage tone="error" message={error} onDismiss={() => setError('')} />

      {starting ? (
        <p className="security-muted-text">Preparing your authenticator setup…</p>
      ) : setupData ? (
        <div className="security-setup">
          <div className="security-setup-qr">
            <img src={setupData.qrCodeDataUrl} alt="Two-factor authentication QR code" />
            {setupData.manualEntryCode && (
              <CopyableSecret value={setupData.manualEntryCode} label="Manual setup code" />
            )}
          </div>
          <form className="security-setup-form" onSubmit={submit}>
            <div className="security-field">
              <label htmlFor="gate-2fa-code">Authenticator code</label>
              <input
                id="gate-2fa-code"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
                autoFocus
              />
            </div>
            <div className="security-gate-actions">
              <button type="submit" className="btn-primary" disabled={busy}>
                {busy ? 'Verifying…' : 'Verify and continue'}
              </button>
              <button type="button" className="btn-secondary" onClick={onLogout} disabled={busy}>
                Sign out
              </button>
            </div>
          </form>
        </div>
      ) : (
        <div className="security-gate-actions">
          <button type="button" className="btn-primary" onClick={begin}>
            Retry setup
          </button>
          <button type="button" className="btn-secondary" onClick={onLogout}>
            Sign out
          </button>
        </div>
      )}
    </>
  )
}

export default SecurityGate
