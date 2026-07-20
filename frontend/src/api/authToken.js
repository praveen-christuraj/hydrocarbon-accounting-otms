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

export const getStoredAccessToken = () => {
  for (const key of TOKEN_STORAGE_KEYS) {
    const token = localStorage.getItem(key)
    if (token && token.trim() !== '') {
      return token.trim()
    }
  }
  return ''
}

export const saveAccessToken = (token) => {
  clearAccessToken()
  localStorage.setItem(AUTH_TOKEN_KEY, token)
}

export const clearAccessToken = () => {
  TOKEN_STORAGE_KEYS.forEach((key) => {
    localStorage.removeItem(key)
  })
  localStorage.removeItem(REFRESH_TOKEN_KEY)
}

export const getStoredRefreshToken = () => {
  return localStorage.getItem(REFRESH_TOKEN_KEY) || ''
}

export const saveRefreshToken = (token) => {
  if (token) {
    localStorage.setItem(REFRESH_TOKEN_KEY, token)
  }
}
