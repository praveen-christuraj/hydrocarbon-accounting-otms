const API_BASE_URL = 'http://127.0.0.1:8000'

const TOKEN_STORAGE_KEYS = [
  'hydrocarbonAccessToken',
  'hydrocarbon_access_token',
  'access_token',
  'accessToken',
]

const getStoredAuthToken = () => {
  for (const key of TOKEN_STORAGE_KEYS) {
    const token = localStorage.getItem(key)

    if (token && token.trim() !== '') {
      return token.trim()
    }
  }

  return ''
}

const clearStoredAuthToken = () => {
  TOKEN_STORAGE_KEYS.forEach((key) => {
    localStorage.removeItem(key)
  })
}

const buildHeaders = (customHeaders = {}) => {
  const token = getStoredAuthToken()

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

export const apiRequest = async (endpoint, options = {}) => {
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers: buildHeaders(options.headers || {}),
  })

  const data = await readResponseData(response)

  if (!response.ok) {
    if (response.status === 401) {
      clearStoredAuthToken()
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