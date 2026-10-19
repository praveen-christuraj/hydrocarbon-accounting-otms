// Client-side mirror of backend/app/utils/password_policy.py so users get
// instant feedback; the backend remains the authority.

export const buildPolicyChecks = (password, { currentPassword = '', username = '' } = {}) => [
  { id: 'length', label: 'At least 12 characters', ok: password.length >= 12 },
  { id: 'upper', label: 'One uppercase letter', ok: /[A-Z]/.test(password) },
  { id: 'lower', label: 'One lowercase letter', ok: /[a-z]/.test(password) },
  { id: 'digit', label: 'One number', ok: /[0-9]/.test(password) },
  { id: 'special', label: 'One special character', ok: /[^a-zA-Z0-9]/.test(password) },
  {
    id: 'username',
    label: 'Does not contain your username',
    ok:
      !username ||
      username.length < 3 ||
      !password.toLowerCase().includes(username.toLowerCase()),
  },
  ...(currentPassword
    ? [{ id: 'different', label: 'Different from current password', ok: password !== currentPassword }]
    : []),
]

export const calcPasswordStrength = (pw) => {
  let score = 0
  if (pw.length >= 8) score += 1
  if (pw.length >= 12) score += 1
  if (/[a-z]/.test(pw)) score += 1
  if (/[A-Z]/.test(pw)) score += 1
  if (/[0-9]/.test(pw)) score += 1
  if (/[^a-zA-Z0-9]/.test(pw)) score += 1
  if (score <= 2) return { level: 'weak', label: 'Weak', pct: 25, color: 'var(--danger-text)' }
  if (score <= 3) return { level: 'fair', label: 'Fair', pct: 50, color: 'var(--warning)' }
  if (score <= 5) return { level: 'good', label: 'Good', pct: 75, color: 'var(--warning)' }
  return { level: 'strong', label: 'Strong', pct: 100, color: 'var(--success-text)' }
}

/** Cryptographically random password satisfying every policy rule. */
export const generateStrongPassword = (length = 16) => {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const lower = 'abcdefghijkmnopqrstuvwxyz'
  const digits = '23456789'
  const special = '!@#$%^&*-_=+?'
  const all = upper + lower + digits + special
  const pick = (charset, count) => {
    const values = new Uint32Array(count)
    window.crypto.getRandomValues(values)
    return Array.from(values, (value) => charset[value % charset.length])
  }
  const required = [...pick(upper, 2), ...pick(lower, 2), ...pick(digits, 2), ...pick(special, 2)]
  const rest = pick(all, Math.max(length - required.length, 0))
  const combined = [...required, ...rest]
  const swaps = new Uint32Array(combined.length)
  window.crypto.getRandomValues(swaps)
  for (let i = combined.length - 1; i > 0; i -= 1) {
    const j = swaps[i] % (i + 1)
    ;[combined[i], combined[j]] = [combined[j], combined[i]]
  }
  return combined.join('')
}
