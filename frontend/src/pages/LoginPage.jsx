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
// Brand mark (inline SVG — matches WellCostingPro-style geometric mark)
// =====================================================================
function BrandMark({ size = 40 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: 10,
      background: '#12315f', position: 'relative', overflow: 'hidden',
      display: 'grid', placeItems: 'center', flexShrink: 0,
      boxShadow: '0 2px 8px rgba(18,49,95,0.25)',
      border: '1.5px solid rgba(255,255,255,0.12)'
    }}>
      <svg width={size * 0.55} height={size * 0.55} viewBox="0 0 24 24" fill="none" stroke="#8fb8e4" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2L2 7l10 5 10-5-10-5z" />
        <path d="M2 17l10 5 10-5" />
        <path d="M2 12l10 5 10-5" />
      </svg>
    </div>
  )
}

// =====================================================================
// Benefit card for left panel
// =====================================================================
function BenefitCard({ icon, title, desc }) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.045)',
      border: '1px solid rgba(255,255,255,0.09)',
      borderRadius: 10, padding: '13px 14px',
      backdropFilter: 'blur(3px)',
      transition: 'background 0.2s ease, border-color 0.2s ease'
    }} className="benefit-card-hover">
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{
          width: 28, height: 28, borderRadius: 7,
          background: 'rgba(143,184,228,0.12)',
          display: 'grid', placeItems: 'center', flexShrink: 0,
          border: '1px solid rgba(143,184,228,0.2)'
        }}>{icon}</div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 12.5, color: '#fff', lineHeight: 1.2 }}>{title}</div>
          <div style={{ fontSize: 11, color: '#a7b8cb', lineHeight: 1.35, marginTop: 2 }}>{desc}</div>
        </div>
      </div>
    </div>
  )
}

// =====================================================================
// Main Login Component — redesigned split-screen layout
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

  // =====================================================================
  // Icons for benefit cards (simple inline SVG — no external dependencies)
  // =====================================================================
  const calcIcon = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8fb8e4" strokeWidth="2.2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
  const dataIcon = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8fb8e4" strokeWidth="2.2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>
  const reduceIcon = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8fb8e4" strokeWidth="2.2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
  const closeIcon = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8fb8e4" strokeWidth="2.2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
  const hrsIcon = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8fb8e4" strokeWidth="2.2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
  const workflowIcon = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8fb8e4" strokeWidth="2.2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
  const reportIcon = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8fb8e4" strokeWidth="2.2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
  const accountabilityIcon = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8fb8e4" strokeWidth="2.2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
  const continuityIcon = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8fb8e4" strokeWidth="2.2"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>

  return (
    <div className="login-page-new" aria-label="Hydrocarbon Accounting System login">
      {/* ===================================================================== */}
      {/* LEFT DARK PANEL — Brand + Benefits                                */}
      {/* ===================================================================== */}
      <aside className="login-left" aria-label="System overview">
        <div className="login-left-inner">
          {/* Brand */}
          <a href="#" className="login-brand" aria-label="Hydrocarbon Accounting System home">
            <BrandMark size={42} />
            <div className="login-brand-text">
              <div className="login-brand-title">Hydrocarbon Accounting</div>
              <div className="login-brand-subtitle">System</div>
            </div>
          </a>

          {/* Headline */}
          <div className="login-story">
            <div className="login-story-eyebrow">BUILT FOR THE WAY YOU WORK</div>
            <h1 className="login-story-headline">
              Clarity at<br />
              every <em>depth.</em>
            </h1>
            <p className="login-story-copy">
              A more intelligent way to manage hydrocarbon accounting, your people, and the decisions that move operations forward.
            </p>
          </div>

          {/* Stats strip */}
          <div className="login-stats-strip">
            <div className="login-stat">
              <div className="login-stat-value">45–70%</div>
              <div className="login-stat-label">Administrative &amp; reporting effort reduced</div>
            </div>
            <div className="login-stat">
              <div className="login-stat-value">2–3 hrs</div>
              <div className="login-stat-label">Month-end closing vs 1–2 working days</div>
            </div>
            <div className="login-stat">
              <div className="login-stat-value">80–180</div>
              <div className="login-stat-label">Man-hours saved / month</div>
            </div>
          </div>

          {/* Benefits grid */}
          <div className="login-benefits">
            <div className="login-benefits-label">KEY BENEFITS</div>
            <div className="login-benefits-grid">
              <BenefitCard icon={calcIcon} title="Automated Calculations" desc="Workflows &amp; approval control with accurate traceability" />
              <BenefitCard icon={dataIcon} title="Centralized Data" desc="Cross-site data management from one platform" />
              <BenefitCard icon={reduceIcon} title="Effort Reduction" desc="Approx. 45% to 70% less recurring admin work" />
              <BenefitCard icon={closeIcon} title="Month-End Speed" desc="Closing reduced from 1–2 days to 2–3 hours" />
              <BenefitCard icon={hrsIcon} title="Time Savings" desc="~80 to 180 team man-hours saved monthly" />
              <BenefitCard icon={workflowIcon} title="Digital Approvals" desc="Eliminate email &amp; wait cycles entirely" />
              <BenefitCard icon={reportIcon} title="Real-Time Reporting" desc="Live reporting instead of month-end reconstruction" />
              <BenefitCard icon={accountabilityIcon} title="Accountability" desc="Faster loss/gain investigation, less dependency" />
              <BenefitCard icon={continuityIcon} title="Continuity" desc="Better continuity during leave or staff transfer" />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="login-left-footer">
          <div className="login-left-footer-left">© {new Date().getFullYear()} Hydrocarbon Accounting System</div>
          <div className="login-left-footer-right">
            <span className="login-left-dot" />
            Built for connected teams
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

          <h2 className="login-card-title">Welcome back</h2>
          <p className="login-card-subtitle">Sign in to your workspace to continue.</p>

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
                {/* Workspace field (preserved from WellCostingPro design) */}
                <div>
                  <label htmlFor="login-username" className="login-label">USERNAME</label>
                  <input
                    id="login-username"
                    name="username"
                    type="text"
                    fullWidth
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
                  <div className="password-input-wrapper" style={{ position: 'relative' }}>
                    <input
                      id="login-password"
                      name="password"
                      type={showPassword ? 'text' : 'password'}
                      fullWidth
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter your password"
                      autoComplete="current-password"
                      className="login-input"
                      aria-required="true"
                      style={{ paddingRight: 44 }}
                    />
                    <button
                      type="button"
                      className="password-toggle"
                      onClick={() => setShowPassword(!showPassword)}
                      tabIndex={-1}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      style={{
                        position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                        background: 'transparent', border: 'none', cursor: 'pointer', padding: 4,
                        color: '#6b7a8d', display: 'grid', placeItems: 'center'
                      }}
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

              {/* Trust strip */}
              <div className="login-trust-strip">
                <div className="login-trust-icon" aria-hidden="true">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#12315f" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13, color: '#16283F' }}>Your workspace is protected with secure access controls.</div>
                  <div style={{ fontSize: 12, color: '#6b7a8d', marginTop: 2 }}>Contact your administrator for access if needed.</div>
                </div>
              </div>
            </>
          )}

          {/* Mobile-only help */}
          <div className="login-help-mobile">Need help? Reach out to your workspace administrator.</div>
        </div>
      </main>
    </div>
  )
}

// =====================================================================
// We need the unseeded state from the original — but it was in useEffect.
// For simplicity / compatibility with the existing auth context flow,
// we'll expose the component without the unseeded check; the original
// page handled it via an effect that fetched /api/health. We'll keep
// the JSX conditional but set unseeded = false by default so it renders.
// Callers that need it can inject via props if required.
// =====================================================================
export default LoginPage
