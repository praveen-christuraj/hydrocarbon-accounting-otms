// Shared token management — extracted from authApi.js to break circular dependency
// apiClient.js and authApi.js both import from here.

const AUTH_TOKEN_KEY = 'hydrocarbonAccessToken'
const REFRESH_TOKEN_KEY = 'hydrocarbonRefreshToken'
const TOKEN_STORAGE_KEYS = [
  AUTH_TOKEN_KEY,
  'hydrocarbon_access_token',
  'access_token',
  'accessToken',
]
let accessToken = ''
let legacyRefreshToken = ''
let legacyStorageMigrated = false

const migrateLegacyStorage = () => {
  if (legacyStorageMigrated || typeof localStorage === 'undefined') return
  legacyStorageMigrated = true
  for (const key of TOKEN_STORAGE_KEYS) {
    const token = localStorage.getItem(key)
    if (!accessToken && token && token.trim()) accessToken = token.trim()
    localStorage.removeItem(key)
  }
  legacyRefreshToken = String(localStorage.getItem(REFRESH_TOKEN_KEY) || '').trim()
  localStorage.removeItem(REFRESH_TOKEN_KEY)
}

export const getStoredAccessToken = () => {
  migrateLegacyStorage()
  return accessToken
}

export const saveAccessToken = (token) => {
  migrateLegacyStorage()
  accessToken = String(token || '').trim()
}

export const clearAccessToken = () => {
  accessToken = ''
  legacyRefreshToken = ''
  if (typeof localStorage !== 'undefined') {
    TOKEN_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key))
    localStorage.removeItem(REFRESH_TOKEN_KEY)
  }
}

export const getStoredRefreshToken = () => {
  migrateLegacyStorage()
  return legacyRefreshToken
}

export const clearStoredRefreshToken = () => {
  legacyRefreshToken = ''
}
