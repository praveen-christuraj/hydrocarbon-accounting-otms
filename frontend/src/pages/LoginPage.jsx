import { useState, useMemo, useEffect } from 'react'
import { loginUser, requestPasswordReset, verifyLogin2FA } from '../api/authApi'
import Icon from '../components/common/Icon'

// =====================================================================
// Simple password strength calculator (preserved from original)
// =====================================================================
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

// =====================================================================
// Brand mark
// =====================================================================
function BrandMark({ size = 48 }) {
  return (
    <div className="login-brand-mark" style={{ width: size, height: size }} aria-hidden="true">
      <svg width={size * 0.56} height={size * 0.56} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2L2 7l10 5 10-5-10-5z" />
        <path d="M2 17l10 5 10-5" />
        <path d="M2 12l10 5 10-5" />
      </svg>
    </div>
  )
}

// =====================================================================
// Main Login Component
// =====================================================================
function LoginPage({ onLogin }) {
  const [unseeded, setUnseeded] = useState(false)
  useEffect(() => {
    fetch('/api/health').then(r => r.json()).then(d => setUnseeded(d.admin_seeded === false)).catch(() => undefined)
  }, [])
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [twoFACode, setTwoFACode] = useState('')
  const [challenge, setChallenge] = useState(null)
  const [resetUsername, setResetUsername] = useState('')
  const [resetReason, setResetReason] = useState('')
  const [reset2FA, setReset2FA] = useState(false)
  const [showReset, setShowReset] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  const pwStrength = useMemo(() => calcPasswordStrength(password), [password])

  const clearError = () => setError('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    clearError()

    if (username.trim() === '') {
      setError('Username is required')
      return
    }
    if (password.trim() === '') {
      setError('Password is required')
      return
    }

    try {
      setLoading(true)
      const loggedInUser = await loginUser(username, password)

      if (loggedInUser?.requires2FA) {
        setChallenge(loggedInUser)
        setTwoFACode('')
        return
      }

      onLogin(loggedInUser)
    } catch (error) {
      setError(error.message || 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  const handleVerify2FA = async (e) => {
    e.preventDefault()
    clearError()

    if (!challenge?.challengeId) {
      setError('2FA challenge is missing. Please login again.')
      setChallenge(null)
      return
    }
    if (twoFACode.trim() === '') {
      setError('Authentication code is required')
      return
    }

    try {
      setLoading(true)
      const loggedInUser = await verifyLogin2FA(challenge.challengeId, twoFACode)
      onLogin(loggedInUser)
    } catch (error) {
      setError(error.message || '2FA verification failed')
    } finally {
      setLoading(false)
    }
  }

  const handlePasswordResetRequest = async (e) => {
    e.preventDefault()
    clearError()

    const targetUsername = (resetUsername || username || '').trim()
    if (!targetUsername) {
      setError('Username is required')
      return
    }

    try {
      setLoading(true)
      const response = await requestPasswordReset(targetUsername, resetReason, reset2FA)
      setError('')
      setSuccessMsg(response.message || 'Password reset request submitted. Check your email or contact administrator.')
      setShowReset(false)
      setResetUsername('')
      setResetReason('')
      setReset2FA(false)
    } catch (error) {
      setError(error.message || 'Password reset request failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page-new" aria-label="Hydrocarbon Accounting System login">
      {/* ===================================================================== */}
      {/* LEFT PANEL — System identity and operational access                 */}
      {/* ===================================================================== */}
      <aside className="login-left" aria-label="Hydrocarbon Accounting System">
        <div className="login-left-inner">
          <header className="login-brand">
            <BrandMark />
            <div className="login-brand-copy">
              <h1 className="login-brand-title">
                <span>HYDROCARBON</span>{' '}
                <span>ACCOUNTING SYSTEM</span>
              </h1>
              <p className="login-brand-subtitle">
                Integrated Hydrocarbon Operations &amp; Inventory Management
              </p>
            </div>
          </header>

          <div className="login-story">
            <div className="login-story-accent" aria-hidden="true" />
            <h2 className="login-story-headline">
              <span>Precision. Integrity.</span>{' '}
              <span>Operational Excellence.</span>
            </h2>
            <p className="login-story-copy">
              Secure access to your operational data, inventory records, measurement workflows, and reporting systems.
            </p>
          </div>

          <div className="login-values">
            ACCURACY · TRACEABILITY · SECURITY · INTELLIGENCE
          </div>
        </div>
      </aside>

      {/* ===================================================================== */}
      {/* RIGHT LIGHT PANEL — Login Form                                    */}
      {/* ===================================================================== */}
      <main className="login-right" aria-label="Sign in form">
        <div className="login-card-new">
          {/* Icon */}
          <div className="login-card-icon" aria-hidden="true">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="10" rx="2" ry="2" />
              <circle cx="12" cy="5" r="2" />
              <path d="M12 7v4" />
            </svg>
          </div>

          <h2 className="login-card-title">Sign in</h2>

          {/* Unseeded warning */}
          {unseeded && (
            <div className="login-alert login-alert-warning" role="alert">
              <strong>This deployment has no administrator yet.</strong>{' '}
              On the API host run{' '}
              <code className="login-code">python -m app.seed</code>{' '}
              to create the first workspace owner, then reload this page.
            </div>
          )}

          {/* Success */}
          {successMsg && (
            <div className="login-alert login-alert-success" role="status">
              {successMsg}
              <button type="button" className="login-alert-close" onClick={() => setSuccessMsg('')} aria-label="Dismiss message">×</button>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="login-alert login-alert-error" role="alert">
              {error}
              <button type="button" className="login-alert-close" onClick={() => setError('')} aria-label="Dismiss error">×</button>
            </div>
          )}

          {/* 2FA Challenge */}
          {challenge ? (
            <form onSubmit={handleVerify2FA} className="login-form" aria-label="Two-factor authentication">
              <div className="login-info-box">
                Enter the authentication code for{' '}
                <strong>{challenge.userHint?.full_name || challenge.userHint?.username || username}</strong>.
              </div>

              <div>
                <label htmlFor="login-2fa" className="login-label">Authentication Code</label>
                <input
                  id="login-2fa"
                  type="text"
                  value={twoFACode}
                  onChange={(e) => setTwoFACode(e.target.value)}
                  placeholder="6-digit code or backup code"
                  autoFocus
                  className="login-input"
                  aria-required="true"
                  aria-label="Authentication code"
                />
              </div>

              <div className="login-form-actions">
                <button type="submit" disabled={loading} className="login-btn-primary" aria-label="Verify code">
                  {loading ? 'Verifying…' : 'Verify'}
                </button>
                <button type="button" onClick={() => { setChallenge(null); clearError() }} disabled={loading} className="login-btn-secondary" aria-label="Cancel">
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <>
              {/* Main form */}
              <form onSubmit={handleSubmit} className="login-form" aria-label="Workspace sign in">
                {/* Username field */}
                <div>
                  <label htmlFor="login-username" className="login-label">USERNAME</label>
                  <input
                    id="login-username"
                    name="username"
                    type="text"
                    required
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Enter your username"
                    autoComplete="username"
                    className="login-input"
                    aria-required="true"
                    autoFocus
                  />
                </div>

                <div>
                  <label htmlFor="login-password" className="login-label">PASSWORD</label>
                  <div className="password-input-wrapper">
                    <input
                      id="login-password"
                      name="password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter your password"
                      autoComplete="current-password"
                      className="login-input"
                      aria-required="true"
                    />
                    <button
                      type="button"
                      className="password-toggle"
                      onClick={() => setShowPassword(!showPassword)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      <Icon name={showPassword ? 'eyeOff' : 'eye'} size={18} />
                    </button>
                  </div>
                  {/* Password strength indicator */}
                  {password && (
                    <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ flex: 1, height: 4, background: '#e3e9f0', borderRadius: 2, overflow: 'hidden' }}>
                        <div style={{ width: `${pwStrength.pct}%`, height: '100%', background: pwStrength.color, borderRadius: 2, transition: 'width .2s ease' }} />
                      </div>
                      <span style={{ fontSize: 11, fontWeight: 600, color: pwStrength.color }}>{pwStrength.label}</span>
                    </div>
                  )}
                </div>

                <button type="submit" disabled={loading} className="login-btn-primary" aria-label="Sign in to workspace" style={{ marginTop: 4 }}>
                  {loading ? (
                    <>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="10" strokeDasharray="60" strokeDashoffset="20" style={{ animation: 'spin 1s linear infinite' }} /><style>{'@keyframes spin{to{transform:rotate(360deg)}}'}</style></svg>
                      Signing in…
                    </>
                  ) : (
                    <>Sign in to workspace <span style={{ fontSize: 18, marginLeft: 4 }}>→</span></>
                  )}
                </button>
              </form>

              {/* Reset section */}
              <div className="login-reset-area">
                {!showReset ? (
                  <button type="button" onClick={() => setShowReset(true)} className="login-link-btn" aria-expanded={showReset} aria-controls="login-reset-form">
                    Reset password
                  </button>
                ) : (
                  <form onSubmit={handlePasswordResetRequest} id="login-reset-form" className="login-form" aria-label="Password reset request" style={{ marginTop: 8 }}>
                    <div>
                      <label htmlFor="login-reset-user" className="login-label">Username</label>
                      <input
                        id="login-reset-user"
                        type="text"
                        value={resetUsername}
                        onChange={(e) => setResetUsername(e.target.value)}
                        placeholder={username || 'Enter username'}
                        autoFocus
                        className="login-input"
                      />
                    </div>
                    <div>
                      <label htmlFor="login-reset-reason" className="login-label">Reason (optional)</label>
                      <input
                        id="login-reset-reason"
                        type="text"
                        value={resetReason}
                        onChange={(e) => setResetReason(e.target.value)}
                        placeholder="Why you need a reset"
                        className="login-input"
                      />
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <label className="login-checkbox-label" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#5b6b7f', fontWeight: 500 }}>
                        <input type="checkbox" checked={reset2FA} onChange={(e) => setReset2FA(e.target.checked)} style={{ accentColor: '#12315f', width: 16, height: 16 }} />
                        Require 2FA verification
                      </label>
                      <div style={{ flex: 1 }} />
                      <button type="button" onClick={() => setShowReset(false)} className="login-btn-secondary" style={{ padding: '8px 14px', fontSize: 13 }}>Cancel</button>
                      <button type="submit" disabled={loading} className="login-btn-primary" style={{ padding: '8px 14px', fontSize: 13 }}>{loading ? 'Sending…' : 'Submit request'}</button>
                    </div>
                  </form>
                )}
              </div>

            </>
          )}
        </div>
      </main>
    </div>
  )
}

export default LoginPage
