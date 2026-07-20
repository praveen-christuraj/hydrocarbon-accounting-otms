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

// Track whether a refresh is in flight to avoid duplicate calls
let refreshPromise = null

const tryRefreshAndRetry = async (endpoint, options) => {
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
  const retryResponse = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers: buildHeaders(options.headers || {}),
  })

  const retryData = await readResponseData(retryResponse)
  if (!retryResponse.ok) {
    throw new Error(retryData?.detail || 'API request failed')
  }
  return retryData
}

export const apiRequest = async (endpoint, options = {}) => {
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers: buildHeaders(options.headers || {}),
  })

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
        return tryRefreshAndRetry(endpoint, options)
      }
      clearAccessToken()
    }

    throw new Error(data?.detail || 'API request failed')
  }

  return data
}

export const apiGet = async (endpoint) => {
  return apiRequest(endpoint)
}

export const apiPost = async (endpoint, body) => {
  return apiRequest(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
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
