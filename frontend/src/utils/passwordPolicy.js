// Client-side mirror of backend/app/utils/password_policy.py so users get
// instant feedback; the backend remains the authority. Keep the rules in sync
// with GET /auth/password-policy (the API publishes them at runtime).

const COMMON_PASSWORDS = new Set([
  'password', 'passw0rd', 'pass1234', 'password1', 'password12', 'password123',
  'password1234', 'p@ssword', 'p@ssw0rd', 'letmein', 'welcome', 'welcome1',
  'admin', 'admin123', 'administrator', 'root', 'toor', 'qwerty', 'qwerty123',
  'abc123', 'iloveyou', 'monkey', 'dragon', 'sunshine', 'football', 'baseball',
  'master', 'shadow', 'superman', 'batman', 'trustno1', 'hello123', 'changeme',
  'change-me', 'default', 'secret', 'secret123', 'terminal', 'hydrocarbon',
  'hydrocarbon1', 'oilgas', 'petroleum', 'refinery', 'tanker', 'shuttle',
  'qwertyuiop', '1q2w3e4r', '1qaz2wsx', 'zaq12wsx', 'asdfghjkl', 'zxcvbnm',
])

const SEQUENCES = ['abcdefghijklmnopqrstuvwxyz', '0123456789', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm']

const canonical = (value) =>
  String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .trim()
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '')

const isCommonPassword = (password) => {
  const base = canonical(password)
  const leet = base.replace(/0/g, 'o').replace(/1/g, 'i').replace(/3/g, 'e').replace(/4/g, 'a').replace(/5/g, 's').replace(/7/g, 't').replace(/@/g, 'a').replace(/\$/g, 's').replace(/!/g, 'i')
  return COMMON_PASSWORDS.has(base) || COMMON_PASSWORDS.has(leet)
}

const hasRepeatedRun = (password, length = 4) => {
  const lowered = password.toLowerCase()
  for (let index = 0; index <= lowered.length - length; index += 1) {
    const chunk = lowered.slice(index, index + length)
    if (new Set(chunk).size === 1) return true
  }
  return false
}

const hasSequence = (password, length = 4) => {
  const lowered = password.toLowerCase()
  return SEQUENCES.some((sequence) => {
    for (let index = 0; index <= sequence.length - length; index += 1) {
      const forward = sequence.slice(index, index + length)
      const reverse = forward.split('').reverse().join('')
      if (lowered.includes(forward) || lowered.includes(reverse)) return true
    }
    return false
  })
}

const containsIdentity = (password, identity) => {
  const cleaned = String(identity || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
  if (cleaned.length < 3) return false
  return password.toLowerCase().replace(/[^a-z0-9]/g, '').includes(cleaned)
}

export const buildPolicyChecks = (
  password,
  { currentPassword = '', username = '', fullName = '', email = '' } = {}
) => [
  { id: 'length', label: 'At least 12 characters', ok: password.length >= 12 },
  { id: 'maxLength', label: 'At most 128 characters', ok: password.length <= 128 },
  { id: 'upper', label: 'One uppercase letter', ok: /[A-Z]/.test(password) },
  { id: 'lower', label: 'One lowercase letter', ok: /[a-z]/.test(password) },
  { id: 'digit', label: 'One number', ok: /[0-9]/.test(password) },
  { id: 'special', label: 'One special character', ok: /[^a-zA-Z0-9]/.test(password) },
  {
    id: 'identity',
    label: 'Does not contain your name, username or email',
    ok: !(
      containsIdentity(password, username) ||
      containsIdentity(password, fullName) ||
      containsIdentity(password, email)
    ),
  },
  { id: 'common', label: 'Not a common or easily guessed password', ok: !isCommonPassword(password) },
  { id: 'repeat', label: 'No 4 repeated characters', ok: !hasRepeatedRun(password) },
  { id: 'sequence', label: 'No 4-character keyboard/number sequence', ok: !hasSequence(password) },
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
