// Shared token management.
//
// Security model: the access token lives ONLY in JavaScript memory (never in
// localStorage/sessionStorage, never in a cookie readable by scripts). The
// refresh token is delivered by the API as an HttpOnly, SameSite=Strict cookie
// and is never readable or storable from JavaScript.

const LEGACY_STORAGE_KEYS = [
  'hydrocarbonAccessToken',
  'hydrocarbon_access_token',
  'access_token',
  'accessToken',
  'hydrocarbonRefreshToken',
]

let accessToken = ''
let legacyStorageMigrated = false

const purgeLegacyStorage = () => {
  if (legacyStorageMigrated || typeof localStorage === 'undefined') return
  legacyStorageMigrated = true
  for (const key of LEGACY_STORAGE_KEYS) {
    try {
      localStorage.removeItem(key)
    } catch {
      // Storage can be blocked (private mode / policy). Nothing to purge.
    }
  }
}

export const getStoredAccessToken = () => {
  purgeLegacyStorage()
  return accessToken
}

export const saveAccessToken = (token) => {
  purgeLegacyStorage()
  accessToken = String(token || '').trim()
}

export const clearAccessToken = () => {
  accessToken = ''
  purgeLegacyStorage()
}

const decodeJwtPayload = (token) => {
  const parts = String(token || '').split('.')
  if (parts.length !== 3 || !parts[1]) return null
  try {
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
    const json =
      typeof atob === 'function'
        ? atob(padded)
        : globalThis.Buffer
          ? globalThis.Buffer.from(padded, 'base64').toString('utf8')
          : ''
    return json ? JSON.parse(json) : null
  } catch {
    return null
  }
}

export const isAccessTokenExpiringSoon = (skewSeconds = 15) => {
  const payload = decodeJwtPayload(accessToken)
  if (!payload || typeof payload.exp !== 'number') {
    // Non-JWT test/mock tokens have no exp claim; let the server decide.
    return false
  }
  return payload.exp * 1000 <= Date.now() + skewSeconds * 1000
}

// Fired (once per failure) when the refresh token is dead and the session
// cannot be renewed. App listens for this and returns to the login screen
// instead of keeping the authenticated shell mounted with a dead session
// (which would otherwise keep firing 401s for every loader + poller).
export const SESSION_EXPIRED_EVENT = 'hydrocarbon:session-expired'

export const SESSION_EXPIRED_MESSAGE = 'Session expired. Please login again.'

export const notifySessionExpired = () => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT))
  }
}

export const isSessionExpiredError = (error) => {
  return Boolean(error) && String(error.message || error) === SESSION_EXPIRED_MESSAGE
}
