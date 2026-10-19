import { useMemo, useState } from 'react'
import Icon from '../common/Icon'
import { formatDateTime } from '../../utils/format'

/**
 * Shared building blocks for the Profile & Security module. Kept in one file
 * so the self-service panel, the administrator console, the reset-request
 * queue and the blocking gate all render the same status language.
 */

const NAIVE_ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/

/** Backend timestamps are naive UTC; append Z so the browser converts them. */
export const parseSecurityDate = (value) => {
  if (!value) return null
  let text = String(value)
  if (NAIVE_ISO_RE.test(text)) text += 'Z'
  const date = new Date(text)
  return Number.isNaN(date.getTime()) ? null : date
}

export const formatSecurityDateTime = (value) => {
  const date = parseSecurityDate(value)
  return date ? formatDateTime(date) : '—'
}

// Administrative locks store 9999-12-31 to mean "until unlocked".
export const formatLockUntil = (value) => {
  const date = parseSecurityDate(value)
  if (date && date.getUTCFullYear() >= 9000) return 'Indefinite'
  return formatSecurityDateTime(value)
}

export const describeRelativeTime = (value) => {
  const date = parseSecurityDate(value)
  if (!date) return ''
  const diffMs = date.getTime() - Date.now()
  const absMinutes = Math.round(Math.abs(diffMs) / 60000)
  const suffix = diffMs >= 0 ? 'from now' : 'ago'
  if (absMinutes < 1) return 'just now'
  if (absMinutes < 60) return `${absMinutes} min ${suffix}`
  const hours = Math.round(absMinutes / 60)
  if (hours < 48) return `${hours} hr ${suffix}`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ${suffix}`
}

// Canonical visual tones (see .security-pill in index.css). Labels such as
// "enabled" / "pending" are normalised so every screen uses the same palette.
const TONE_MAP = {
  active: { className: 'active', icon: 'checkCircle' },
  unlocked: { className: 'active', icon: 'checkCircle' },
  enabled: { className: 'active', icon: 'shieldCheck' },
  approved: { className: 'active', icon: 'checkCircle' },
  locked: { className: 'locked', icon: 'lock' },
  rejected: { className: 'danger', icon: 'alertCircle' },
  expired: { className: 'danger', icon: 'alertCircle' },
  danger: { className: 'danger', icon: 'alertCircle' },
  warning: { className: 'warning', icon: 'alertTriangle' },
  pending: { className: 'warning', icon: 'history' },
  info: { className: 'info', icon: 'info' },
  disabled: { className: 'inactive', icon: 'shield' },
  inactive: { className: 'inactive', icon: 'minus' },
  neutral: { className: 'neutral', icon: 'info' },
}

export function SecurityPill({ tone = 'neutral', children, icon }) {
  const config = TONE_MAP[tone] || TONE_MAP.neutral
  return (
    <span className={`security-pill tone-${config.className}`}>
      <Icon name={icon || config.icon} size={12} />
      {children}
    </span>
  )
}

export function SecurityMetric({ label, value, hint, tone = 'neutral', icon = 'shield' }) {
  return (
    <div className={`security-metric tone-${tone}`}>
      <span className="security-metric-icon" aria-hidden="true">
        <Icon name={icon} size={18} />
      </span>
      <div className="security-metric-copy">
        <span className="security-metric-value">{value}</span>
        <span className="security-metric-label">{label}</span>
        {hint && <span className="security-metric-hint">{hint}</span>}
      </div>
    </div>
  )
}

export function SecurityCard({ title, description, icon = 'shield', actions, children, tone = 'default' }) {
  return (
    <section className={`security-card tone-${tone}`}>
      <header className="security-card-header">
        <span className="security-card-icon" aria-hidden="true">
          <Icon name={icon} size={18} />
        </span>
        <div className="security-card-heading">
          <h3>{title}</h3>
          {description && <p>{description}</p>}
        </div>
        {actions && <div className="security-card-actions">{actions}</div>}
      </header>
      <div className="security-card-body">{children}</div>
    </section>
  )
}

export function PasswordInput({
  id,
  label,
  value,
  onChange,
  autoComplete = 'current-password',
  error,
  hint,
  disabled = false,
}) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="security-field">
      <label htmlFor={id}>{label}</label>
      <div className="password-input-wrapper">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          disabled={disabled}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
        />
        <button
          type="button"
          className="password-toggle"
          onClick={() => setVisible((current) => !current)}
          tabIndex={-1}
          aria-label={visible ? 'Hide password' : 'Show password'}
          disabled={disabled}
        >
          <Icon name={visible ? 'eyeOff' : 'eye'} size={16} />
        </button>
      </div>
      {hint && !error && <small className="security-field-hint">{hint}</small>}
      {error && (
        <small className="field-error" id={`${id}-error`}>
          {error}
        </small>
      )}
    </div>
  )
}

const identityFragments = (user) => {
  if (!user) return []
  const values = new Set()
  const username = String(user.username || '').trim().toLowerCase()
  const email = String(user.email || '').trim().toLowerCase()
  const fullName = String(user.fullName || user.full_name || '').trim().toLowerCase()
  if (username.length >= 3) values.add(username)
  if (email.includes('@')) {
    const local = email.split('@')[0]
    if (local.length >= 3) values.add(local)
  }
  fullName
    .replace(/[.-]/g, ' ')
    .split(/\s+/)
    .filter((part) => part.length >= 4)
    .forEach((part) => values.add(part))
  return [...values]
}

export const buildPasswordChecks = (password, { user, currentPassword } = {}) => {
  const value = String(password || '')
  const lowered = value.toLowerCase()
  const fragments = identityFragments(user)
  return [
    { id: 'length', label: 'At least 12 characters', met: value.length >= 12 },
    { id: 'upper', label: 'One uppercase letter', met: /[A-Z]/.test(value) },
    { id: 'lower', label: 'One lowercase letter', met: /[a-z]/.test(value) },
    { id: 'number', label: 'One number', met: /[0-9]/.test(value) },
    { id: 'special', label: 'One special character', met: /[^a-zA-Z0-9]/.test(value) },
    {
      id: 'identity',
      label: 'Does not contain your username or name',
      met: !fragments.some((fragment) => lowered.includes(fragment)),
    },
    {
      id: 'current',
      label: 'Different from the current password',
      met: !currentPassword || value !== currentPassword,
    },
  ]
}

export function PasswordPolicyChecklist({ password, user, currentPassword }) {
  const checks = useMemo(
    () => buildPasswordChecks(password, { user, currentPassword }),
    [password, user, currentPassword]
  )
  const met = checks.filter((check) => check.met).length
  const tone = met === checks.length ? 'strong' : met >= 5 ? 'good' : met >= 3 ? 'fair' : 'weak'
  return (
    <div className="security-policy">
      <div className="security-policy-meter" aria-hidden="true">
        <span className={`seg ${met >= 1 ? 'on' : ''}`} />
        <span className={`seg ${met >= 2 ? 'on' : ''}`} />
        <span className={`seg ${met >= 3 ? 'on' : ''}`} />
        <span className={`seg ${met >= 4 ? 'on' : ''}`} />
        <span className={`seg ${met >= 5 ? 'on' : ''}`} />
        <span className={`seg ${met >= 6 ? 'on' : ''}`} />
        <span className={`seg ${met >= 7 ? 'on' : ''}`} />
      </div>
      <ul className="security-policy-list">
        {checks.map((check) => (
          <li key={check.id} className={check.met ? 'met' : 'unmet'}>
            <Icon name={check.met ? 'checkCircle' : 'alertCircle'} size={13} />
            {check.label}
          </li>
        ))}
      </ul>
      <span className={`security-policy-strength ${tone}`}>
        {tone === 'strong' ? 'Meets the policy' : `${met} of ${checks.length} rules met`}
      </span>
    </div>
  )
}

export function CopyableSecret({ value, label = 'Secret', hint }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(String(value || ''))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }
  return (
    <div className="security-secret">
      <div className="security-secret-heading">
        <span>{label}</span>
        <button type="button" className="btn-secondary security-copy-btn" onClick={copy}>
          <Icon name={copied ? 'checkCircle' : 'copy'} size={14} />
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <code className="security-secret-value">{value}</code>
      {hint && <small>{hint}</small>}
    </div>
  )
}

export function SecurityEmpty({ icon = 'shieldCheck', title, description }) {
  return (
    <div className="security-empty">
      <span className="security-empty-icon" aria-hidden="true">
        <Icon name={icon} size={26} />
      </span>
      <strong>{title}</strong>
      {description && <p>{description}</p>}
    </div>
  )
}
