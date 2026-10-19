import { useMemo, useState } from 'react'
import AlertMessage from '../components/common/AlertMessage'
import Icon from '../components/common/Icon'
import { changeOwnPassword } from '../api/securityApi'
import { buildPolicyChecks, calcPasswordStrength } from '../utils/passwordPolicy'
import { logUiAction } from '../utils/actionLogger'

/**
 * Full-screen gate shown after sign-in when the account is flagged
 * `force_password_change` (new account / administrator reset) or the password
 * has expired. The rest of the application is unreachable until a new
 * password is set, which is how the server-side flag becomes an enforced
 * policy instead of a dormant column.
 */
function ForcePasswordChange({ loggedInUser, onComplete, onLogout }) {
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' })
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const security = loggedInUser?.security || {}
  const reason = security.password_expired
    ? 'Your password has expired and must be replaced before you can continue.'
    : 'An administrator requires you to set a new password before you can continue.'

  const checks = useMemo(
    () =>
      buildPolicyChecks(form.newPassword, {
        currentPassword: form.currentPassword,
        username: loggedInUser?.username || '',
      }),
    [form.newPassword, form.currentPassword, loggedInUser?.username]
  )
  const strength = useMemo(() => calcPasswordStrength(form.newPassword), [form.newPassword])

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')
    if (!form.currentPassword.trim()) {
      setError('Current password is required')
      return
    }
    if (checks.some((check) => !check.ok)) {
      setError('The new password does not meet the password policy')
      return
    }
    if (form.newPassword !== form.confirmPassword) {
      setError('New password and confirmation do not match')
      return
    }
    setBusy(true)
    try {
      await changeOwnPassword(form)
      logUiAction('Session', 'Forced Password Change Completed', {
        username: loggedInUser?.username,
      })
      onComplete?.()
    } catch (submitError) {
      setError(submitError.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="force-change-page">
      <div className="force-change-card">
        <h1>Set a New Password</h1>
        <p>
          Signed in as <strong>{loggedInUser?.fullName || loggedInUser?.username}</strong>. {reason}
        </p>

        <AlertMessage tone="error" message={error} onDismiss={() => setError('')} />

        <form onSubmit={handleSubmit}>
          <div>
            <label>Current Password</label>
            <div className="password-input-wrapper">
              <input
                type={showPassword ? 'text' : 'password'}
                value={form.currentPassword}
                onChange={(event) => setForm({ ...form, currentPassword: event.target.value })}
                autoComplete="current-password"
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPassword((previous) => !previous)}
                tabIndex={-1}
                aria-label={showPassword ? 'Hide passwords' : 'Show passwords'}
              >
                <Icon name={showPassword ? 'eyeOff' : 'eye'} size={16} />
              </button>
            </div>
          </div>
          <div>
            <label>New Password</label>
            <input
              type={showPassword ? 'text' : 'password'}
              value={form.newPassword}
              onChange={(event) => setForm({ ...form, newPassword: event.target.value })}
              autoComplete="new-password"
            />
            {form.newPassword.length > 0 && (
              <div className="password-strength">
                <div
                  className="password-strength-bar"
                  style={{ width: `${strength.pct}%`, background: strength.color }}
                />
                <div className={`password-strength-text ${strength.level}`}>{strength.label}</div>
              </div>
            )}
          </div>
          <ul className="password-policy-checklist">
            {checks.map((check) => (
              <li key={check.id} className={check.ok ? 'met' : 'unmet'}>
                <Icon name={check.ok ? 'checkCircle' : 'minus'} size={13} />
                <span>{check.label}</span>
              </li>
            ))}
          </ul>
          <div>
            <label>Confirm New Password</label>
            <input
              type={showPassword ? 'text' : 'password'}
              value={form.confirmPassword}
              onChange={(event) => setForm({ ...form, confirmPassword: event.target.value })}
              autoComplete="new-password"
            />
          </div>

          <div className="force-change-footer">
            <button type="button" className="btn-secondary" onClick={onLogout} disabled={busy}>
              Sign out
            </button>
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Set New Password'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default ForcePasswordChange
