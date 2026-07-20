import { useMemo, useState } from 'react'
import {
  adminResetUserPassword,
  changeOwnPassword,
  disableOwn2FA,
  regenerate2FABackupCodes,
  start2FASetup,
  verify2FASetup,
} from '../api/securityApi'

const calcPasswordStrength = (pw) => {
  let score = 0
  if (pw.length >= 8) score += 1
  if (pw.length >= 12) score += 1
  if (/[a-z]/.test(pw)) score += 1
  if (/[A-Z]/.test(pw)) score += 1
  if (/[0-9]/.test(pw)) score += 1
  if (/[^a-zA-Z0-9]/.test(pw)) score += 1
  if (score <= 2) return { level: 'weak', label: 'Weak', pct: 25, color: '#dc2626' }
  if (score <= 3) return { level: 'fair', label: 'Fair', pct: 50, color: '#ea580c' }
  if (score <= 5) return { level: 'good', label: 'Good', pct: 75, color: '#ca8a04' }
  return { level: 'strong', label: 'Strong', pct: 100, color: '#16a34a' }
}

function ProfileSecurity({ loggedInUser, users = [] }) {
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  })
  const [setupData, setSetupData] = useState(null)
  const [setupCode, setSetupCode] = useState('')
  const [backupCodes, setBackupCodes] = useState([])
  const [disableForm, setDisableForm] = useState({ currentPassword: '', code: '' })
  const [adminForm, setAdminForm] = useState({
    userId: '',
    newPassword: '',
    forcePasswordChange: true,
    reset2FA: false,
    remarks: '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [confirmAction, setConfirmAction] = useState(null)
  const [showPassword, setShowPassword] = useState({})
  const [fieldErrors, setFieldErrors] = useState({})

  const isAdminBootstrap =
    String(loggedInUser?.username || '').toLowerCase() === 'admin'

  const hasPermission = (permissionName) => {
    if (isAdminBootstrap) return true
    return (loggedInUser?.permissions || []).some(
      (permission) => permission.permissionName === permissionName
    )
  }

  const security = loggedInUser?.security || {}
  const pwStrength = useMemo(() => calcPasswordStrength(passwordForm.newPassword), [passwordForm.newPassword])

  const clearMessages = () => { setError(''); setSuccess('') }
  const clearConfirm = () => setConfirmAction(null)

  const submitPasswordChange = async (e) => {
    e.preventDefault()
    clearMessages()
    setFieldErrors({})

    const errors = {}
    if (!passwordForm.currentPassword.trim()) errors.currentPassword = 'Current password is required'
    if (!passwordForm.newPassword.trim()) errors.newPassword = 'New password is required'
    if (passwordForm.newPassword !== passwordForm.confirmPassword) errors.confirmPassword = 'Passwords do not match'
    if (Object.keys(errors).length) { setFieldErrors(errors); return }

    setLoading(true)
    try {
      const res = await changeOwnPassword(passwordForm)
      setSuccess(res.message || 'Password changed successfully')
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const begin2FASetup = async () => {
    clearMessages()
    setLoading(true)
    try {
      const data = await start2FASetup()
      setSetupData(data)
      setSetupCode('')
      setBackupCodes([])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const submit2FASetup = async (e) => {
    e.preventDefault()
    clearMessages()
    if (!setupCode.trim()) { setError('Authentication code is required'); return }

    setLoading(true)
    try {
      const data = await verify2FASetup(setupCode)
      setBackupCodes(data.backup_codes || [])
      setSetupData(null)
      setSetupCode('')
      setSuccess(data.message || '2FA enabled')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleRegenerateCodes = async () => {
    clearMessages()
    setLoading(true)
    try {
      const data = await regenerate2FABackupCodes()
      setBackupCodes(data.backup_codes || [])
      setSuccess(data.message || 'Backup codes regenerated')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const submitDisable2FA = async (e) => {
    e.preventDefault()
    clearMessages()
    setFieldErrors({})

    const errors = {}
    if (!disableForm.currentPassword.trim()) errors.currentPassword = 'Current password is required'
    if (!disableForm.code.trim()) errors.code = '2FA code is required'
    if (Object.keys(errors).length) { setFieldErrors(errors); return }

    setLoading(true)
    try {
      const data = await disableOwn2FA(disableForm.currentPassword, disableForm.code)
      setSuccess(data.message || '2FA disabled')
      setDisableForm({ currentPassword: '', code: '' })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const submitAdminReset = async (e) => {
    e.preventDefault()
    clearMessages()

    if (!adminForm.userId) { setError('Select a user'); return }

    setLoading(true)
    try {
      const data = await adminResetUserPassword(Number(adminForm.userId), adminForm)
      setSuccess(data.message || 'Password reset successfully')
      setAdminForm({
        userId: '',
        newPassword: '',
        forcePasswordChange: true,
        reset2FA: false,
        remarks: '',
      })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const toggleShowPassword = (field) => {
    setShowPassword({ ...showPassword, [field]: !showPassword[field] })
  }

  return (
    <div>
      <div className="page-title">
        <div>
          <h2>Profile & Security</h2>
          <p>Manage your password, 2FA, and account recovery controls.</p>
        </div>
      </div>

      {success && (
        <div className="error-box" style={{ background: '#f0fdf4', color: '#166534', borderColor: '#bbf7d0' }}>
          {success}
          <button className="error-close" onClick={() => setSuccess('')} type="button">&times;</button>
        </div>
      )}

      {error && (
        <div className="error-box">
          {error}
          <button className="error-close" onClick={() => setError('')} type="button">&times;</button>
        </div>
      )}

      <div className="info-box">
        User: {loggedInUser?.fullName} ({loggedInUser?.username}) | 2FA:{' '}
        {security.totp_enabled ? 'Enabled' : 'Disabled'}
      </div>

      <div className="section-title">
        <h3>Change Password</h3>
      </div>
      <form onSubmit={submitPasswordChange}>
        <div>
          <label>Current Password</label>
          <div className="password-input-wrapper">
            <input
              type={showPassword.currentPassword ? 'text' : 'password'}
              value={passwordForm.currentPassword}
              onChange={(e) => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })}
              style={fieldErrors.currentPassword ? { borderColor: '#dc2626' } : {}}
            />
            <button type="button" className="password-toggle" onClick={() => toggleShowPassword('currentPassword')} tabIndex={-1}>
              {showPassword.currentPassword ? '🙈' : '👁'}
            </button>
          </div>
          {fieldErrors.currentPassword && <small style={{ color: '#dc2626', marginTop: 4 }}>{fieldErrors.currentPassword}</small>}
        </div>
        <div>
          <label>New Password</label>
          <div className="password-input-wrapper">
            <input
              type={showPassword.newPassword ? 'text' : 'password'}
              value={passwordForm.newPassword}
              onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
              style={fieldErrors.newPassword ? { borderColor: '#dc2626' } : {}}
            />
            <button type="button" className="password-toggle" onClick={() => toggleShowPassword('newPassword')} tabIndex={-1}>
              {showPassword.newPassword ? '🙈' : '👁'}
            </button>
          </div>
          {fieldErrors.newPassword && <small style={{ color: '#dc2626', marginTop: 4 }}>{fieldErrors.newPassword}</small>}
          {passwordForm.newPassword.length > 0 && (
            <div className="password-strength">
              <div className="password-strength-bar" style={{ width: `${pwStrength.pct}%`, background: pwStrength.color }} />
              <div className={`password-strength-text ${pwStrength.level}`}>{pwStrength.label}</div>
            </div>
          )}
        </div>
        <div>
          <label>Confirm Password</label>
          <div className="password-input-wrapper">
            <input
              type={showPassword.confirmPassword ? 'text' : 'password'}
              value={passwordForm.confirmPassword}
              onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })}
              style={fieldErrors.confirmPassword ? { borderColor: '#dc2626' } : {}}
            />
            <button type="button" className="password-toggle" onClick={() => toggleShowPassword('confirmPassword')} tabIndex={-1}>
              {showPassword.confirmPassword ? '🙈' : '👁'}
            </button>
          </div>
          {fieldErrors.confirmPassword && <small style={{ color: '#dc2626', marginTop: 4 }}>{fieldErrors.confirmPassword}</small>}
        </div>
        <div className="form-actions">
          <button type="submit" disabled={loading}>Change Password</button>
        </div>
      </form>

      <div className="section-title">
        <h3>Two-Factor Authentication</h3>
      </div>
      {!security.totp_enabled && (
        <div className="form-actions">
          <button type="button" onClick={begin2FASetup} disabled={loading}>Start 2FA Setup</button>
        </div>
      )}

      {setupData && (
        <form onSubmit={submit2FASetup}>
          <div className="full-width-field">
            <label>Scan QR Code</label>
            <img src={setupData.qr_code_data_url} alt="2FA QR Code" width="220" />
            <small>Manual code: {setupData.secret}</small>
          </div>
          <div>
            <label>Authentication Code</label>
            <input value={setupCode} onChange={(e) => setSetupCode(e.target.value)} placeholder="6-digit code" />
          </div>
          <div className="form-actions">
            <button type="submit" disabled={loading}>Verify & Enable</button>
          </div>
        </form>
      )}

      {security.totp_enabled && (
        <>
          <div className="form-actions">
            {confirmAction === 'regenerateCodes' ? (
              <span>
                <button type="button" onClick={() => { clearConfirm(); handleRegenerateCodes() }} disabled={loading} style={{ background: '#f59e0b', color: '#fff' }}>
                  {loading ? 'Working...' : 'Confirm Regenerate'}
                </button>
                <button type="button" onClick={clearConfirm} disabled={loading} style={{ background: '#64748b', color: '#fff' }}>Cancel</button>
              </span>
            ) : (
              <button type="button" onClick={() => setConfirmAction('regenerateCodes')} disabled={loading}>Regenerate Backup Codes</button>
            )}
          </div>
          <form onSubmit={submitDisable2FA}>
            <div>
              <label>Current Password</label>
              <div className="password-input-wrapper">
                <input
                  type={showPassword.disablePassword ? 'text' : 'password'}
                  value={disableForm.currentPassword}
                  onChange={(e) => setDisableForm({ ...disableForm, currentPassword: e.target.value })}
                  style={fieldErrors.currentPassword ? { borderColor: '#dc2626' } : {}}
                />
                <button type="button" className="password-toggle" onClick={() => toggleShowPassword('disablePassword')} tabIndex={-1}>
                  {showPassword.disablePassword ? '🙈' : '👁'}
                </button>
              </div>
              {fieldErrors.currentPassword && <small style={{ color: '#dc2626', marginTop: 4 }}>{fieldErrors.currentPassword}</small>}
            </div>
            <div>
              <label>2FA Code or Backup Code</label>
              <input value={disableForm.code} onChange={(e) => setDisableForm({ ...disableForm, code: e.target.value })} style={fieldErrors.code ? { borderColor: '#dc2626' } : {}} />
              {fieldErrors.code && <small style={{ color: '#dc2626', marginTop: 4 }}>{fieldErrors.code}</small>}
            </div>
            <div className="form-actions">
              {confirmAction === 'disable2FA' ? (
                <span>
                  <button type="submit" disabled={loading} style={{ background: '#dc2626', color: '#fff' }}>{loading ? 'Working...' : 'Confirm Disable'}</button>
                  <button type="button" onClick={clearConfirm} disabled={loading} style={{ background: '#64748b', color: '#fff' }}>Cancel</button>
                </span>
              ) : (
                <button type="button" onClick={() => setConfirmAction('disable2FA')} disabled={loading}>Disable 2FA</button>
              )}
            </div>
          </form>
        </>
      )}

      {backupCodes.length > 0 && (
        <div className="info-box">
          <strong>Backup Codes</strong>
          <p>Store these now. They are shown only after generation.</p>
          <pre>{backupCodes.join('\n')}</pre>
        </div>
      )}

      {hasPermission('Reset User Password') && (
        <>
          <div className="section-title">
            <h3>Admin Password Reset</h3>
          </div>
          {error && (
            <div className="error-box">
              {error}
              <button className="error-close" onClick={() => setError('')} type="button">&times;</button>
            </div>
          )}
          <form onSubmit={submitAdminReset}>
            <div>
              <label>User</label>
              <select value={adminForm.userId} onChange={(e) => setAdminForm({ ...adminForm, userId: e.target.value })}>
                <option value="">Select User</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.fullName || user.full_name} ({user.username})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label>New Password</label>
              <div className="password-input-wrapper">
                <input
                  type={showPassword.adminPassword ? 'text' : 'password'}
                  value={adminForm.newPassword}
                  onChange={(e) => setAdminForm({ ...adminForm, newPassword: e.target.value })}
                />
                <button type="button" className="password-toggle" onClick={() => toggleShowPassword('adminPassword')} tabIndex={-1}>
                  {showPassword.adminPassword ? '🙈' : '👁'}
                </button>
              </div>
            </div>
            <label>
              <input type="checkbox" checked={adminForm.forcePasswordChange} onChange={(e) => setAdminForm({ ...adminForm, forcePasswordChange: e.target.checked })} />{' '}
              Force password change on next login
            </label>
            {hasPermission('Reset User 2FA') && (
              <label>
                <input type="checkbox" checked={adminForm.reset2FA} onChange={(e) => setAdminForm({ ...adminForm, reset2FA: e.target.checked })} />{' '}
                Reset 2FA
              </label>
            )}
            <div className="full-width-field">
              <label>Remarks</label>
              <textarea value={adminForm.remarks} onChange={(e) => setAdminForm({ ...adminForm, remarks: e.target.value })} rows="3" />
            </div>
            <div className="form-actions">
              {confirmAction === 'adminReset' ? (
                <span>
                  <button type="submit" disabled={loading} style={{ background: '#f59e0b', color: '#fff' }}>{loading ? 'Working...' : 'Confirm Reset'}</button>
                  <button type="button" onClick={clearConfirm} disabled={loading} style={{ background: '#64748b', color: '#fff' }}>Cancel</button>
                </span>
              ) : (
                <button type="button" onClick={() => setConfirmAction('adminReset')} disabled={loading}>Reset Password</button>
              )}
            </div>
          </form>
        </>
      )}
    </div>
  )
}

export default ProfileSecurity