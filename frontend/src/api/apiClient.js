import { clearAccessToken, getStoredAccessToken } from './authToken'
import { refreshAccessToken } from './authApi'

export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'

const buildHeaders = (customHeaders = {}) => {
  const token = getStoredAccessToken()

  const headers = {
    ...customHeaders,
  }

  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  return headers
}

const readResponseData = async (response) => {
  const contentType = response.headers.get('content-type')

  if (contentType && contentType.includes('application/json')) {
    return response.json()
  }

  return null
}

const formatApiError = (data) => {
  if (!data) return 'API request failed'
  if (typeof data.detail === 'string') return data.detail
  if (Array.isArray(data.detail)) return data.detail.map(d => d.msg).join('; ')
  if (typeof data.detail === 'object') return JSON.stringify(data.detail)
  return 'API request failed'
}

// Track whether a refresh is in flight to avoid duplicate calls
let refreshPromise = null

// Bound every request so a slow/overloaded backend surfaces as a clear,
// actionable error instead of an indefinitely spinning page. Generous
// enough for report queries on a healthy server; downloads are untimed.
const REQUEST_TIMEOUT_MS = 60000

const fetchWithTimeout = async (url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) => {
  if (typeof AbortController === 'undefined') {
    return fetch(url, options)
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(
        'The server took too long to respond. Check the operation status before retrying, particularly for backups and restores.',
        { cause: error }
      )
    }
    if (error instanceof TypeError) {
      throw new Error('Unable to reach the server. Check your connection and API configuration; for backup or restore operations, check the operation status before retrying.', { cause: error })
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

const tryRefreshAndRetry = async (endpoint, options, timeoutMs) => {
  // Only one concurrent refresh attempt
  if (!refreshPromise) {
    refreshPromise = refreshAccessToken().finally(() => {
      refreshPromise = null
    })
  }

  const refreshed = await refreshPromise
  if (!refreshed) {
    clearAccessToken()
    throw new Error('Session expired. Please login again.')
  }

  // Retry original request with new token
  const retryResponse = await fetchWithTimeout(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers: buildHeaders(options.headers || {}),
  }, timeoutMs)

  const retryData = await readResponseData(retryResponse)
  if (!retryResponse.ok) {
    throw new Error(formatApiError(retryData))
  }
  return retryData
}

export const apiRequest = async (endpoint, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) => {
  const response = await fetchWithTimeout(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers: buildHeaders(options.headers || {}),
  }, timeoutMs)

  const data = await readResponseData(response)

  if (!response.ok) {
    // On 401, try to silently refresh the token and retry once
    if (response.status === 401) {
      // Don't try refresh for auth endpoints themselves (prevent loops)
      const isAuthEndpoint =
        endpoint.startsWith('/auth/login') ||
        endpoint.startsWith('/auth/2fa/verify') ||
        endpoint.startsWith('/auth/refresh')
      if (!isAuthEndpoint) {
        return tryRefreshAndRetry(endpoint, options, timeoutMs)
      }
      clearAccessToken()
    }

    throw new Error(formatApiError(data))
  }

  return data
}

export const apiGet = async (endpoint) => {
  return apiRequest(endpoint)
}

export const apiPost = async (endpoint, body, timeoutMs) => {
  return apiRequest(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  }, timeoutMs)
}

export const apiPut = async (endpoint, body) => {
  return apiRequest(endpoint, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

export const apiPatch = async (endpoint, body) => {
  return apiRequest(endpoint, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

export const apiDelete = async (endpoint) => {
  return apiRequest(endpoint, {
    method: 'DELETE',
  })
}

export const apiDownload = async (endpoint, filename) => {
  const token = getStoredAccessToken()
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })

  if (!response.ok) {
    // Auto-refresh for downloads too
    if (response.status === 401) {
      const refreshed = await refreshAccessToken()
      if (refreshed) {
        const newToken = getStoredAccessToken()
        const retryResponse = await fetch(`${API_BASE_URL}${endpoint}`, {
          headers: newToken ? { Authorization: `Bearer ${newToken}` } : {},
        })
        if (retryResponse.ok) {
          return handleDownloadBlob(retryResponse, filename)
        }
      }
      clearAccessToken()
      throw new Error('Session expired. Please login again.')
    }

    let message = 'Download failed'
    try {
      const errorData = await response.json()
      message = errorData?.detail || message
    } catch {
      // Keep generic message for non-JSON errors.
    }
    throw new Error(message)
  }

  return handleDownloadBlob(response, filename)
}

const handleDownloadBlob = async (response, filename) => {
  const blob = await response.blob()
  const disposition = response.headers.get('content-disposition') || ''
  const match = disposition.match(/filename="?([^";]+)"?/i)
  const fileName = match?.[1] || filename
  const url = window.URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  window.URL.revokeObjectURL(url)
}
