import { useState, useMemo } from 'react'
import { loginUser, requestPasswordReset, verifyLogin2FA } from '../api/authApi'

// Simple password strength calculator
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

function LoginPage({ onLogin }) {
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
  const clearSuccess = () => setSuccessMsg('')

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
      setError('') // Clear any prior error
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
    <div className="login-page">
      <div className="login-card">
        <h1>Hydrocarbon Accounting System</h1>
        <p>Login to continue</p>

        {successMsg && (
          <div className="success-box">
            {successMsg}
            <button className="error-close" onClick={() => setSuccessMsg('')} type="button">&times;</button>
          </div>
        )}

        {error && (
          <div className="error-box">
            {error}
            <button className="error-close" onClick={() => setError('')} type="button">&times;</button>
          </div>
        )}

        {challenge ? (
          <form onSubmit={handleVerify2FA} className="login-form">
            <div className="info-box">
              Enter the authentication code for{' '}
              {challenge.userHint?.full_name || challenge.userHint?.username || username}.
            </div>

            <div>
              <label>Authentication Code</label>
              <input
                type="text"
                value={twoFACode}
                onChange={(e) => setTwoFACode(e.target.value)}
                placeholder="6-digit code or backup code"
                autoFocus
              />
            </div>

            <div className="form-actions">
              <button type="submit" disabled={loading}>
                {loading ? 'Verifying...' : 'Verify'}
              </button>
              <button type="button" onClick={() => { setChallenge(null); clearError() }} disabled={loading}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleSubmit} className="login-form">
            <div>
              <label>Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter username"
                autoFocus
              />
            </div>

            <div>
              <label>Password</label>
              <div className="password-input-wrapper">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter password"
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword(!showPassword)}
                  tabIndex={-1}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? '🙈' : '👁'}
                </button>
              </div>
              {password.length > 0 && (
                <div className="password-strength">
                  <div
                    className="password-strength-bar"
                    style={{ width: `${pwStrength.pct}%`, background: pwStrength.color }}
                  />
                  <div className={`password-strength-text ${pwStrength.level}`}>
                    {pwStrength.label}
                  </div>
                </div>
              )}
            </div>

            <div className="form-actions">
              <button type="submit" disabled={loading}>
                {loading ? 'Logging in...' : 'Login'}
              </button>
            </div>
          </form>
        )}

        <div className="form-actions">
          <button type="button" onClick={() => { setShowReset(!showReset); clearError() }} disabled={loading}>
            Need Password Reset?
          </button>
        </div>

        {showReset && (
          <form onSubmit={handlePasswordResetRequest} className="login-form">
            <div>
              <label>Username</label>
              <input
                type="text"
                value={resetUsername}
                onChange={(e) => setResetUsername(e.target.value)}
                placeholder="Enter username"
              />
            </div>
            <div>
              <label>Reason</label>
              <textarea
                value={resetReason}
                onChange={(e) => setResetReason(e.target.value)}
                placeholder="Optional reason for administrator"
                rows="3"
              />
            </div>
            <label>
              <input
                type="checkbox"
                checked={reset2FA}
                onChange={(e) => setReset2FA(e.target.checked)}
              />{' '}
              Also request 2FA reset
            </label>
            <div className="form-actions">
              <button type="submit" disabled={loading}>
                Submit Request
              </button>
            </div>
          </form>
        )}

        <div className="info-box">
          Use your User Master username and password. Role and permissions are
          loaded automatically after login.
        </div>
      </div>
    </div>
  )
}

export default LoginPage
