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
