const API_BASE_URL = 'http://127.0.0.1:8000'

const AUTH_TOKEN_KEY = 'hydrocarbonAccessToken'

const convertLoggedInUserFromApi = (data) => {
  const user = data.user

  return {
    id: user.id,
    fullName: user.full_name,
    username: user.username,
    email: user.email,
    phone: user.phone || '',
    department: user.department || '',
    designation: user.designation || '',
    status: user.status,
    role: user.role
      ? {
          id: user.role.id,
          roleName: user.role.role_name,
          description: user.role.description || '',
          status: user.role.status,
        }
      : null,
    permissions: (user.permissions || []).map((permission) => ({
      id: permission.id,
      permissionName: permission.permission_name,
      moduleName: permission.module_name,
      description: permission.description || '',
      status: permission.status,
    })),
  }
}

export const getStoredAccessToken = () => {
  return localStorage.getItem(AUTH_TOKEN_KEY)
}

export const saveAccessToken = (token) => {
  localStorage.setItem(AUTH_TOKEN_KEY, token)
}

export const clearAccessToken = () => {
  localStorage.removeItem(AUTH_TOKEN_KEY)
}

export const loginUser = async (username, password) => {
  const response = await fetch(`${API_BASE_URL}/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      username,
      password,
    }),
  })

  const data = await response.json()

  if (!response.ok) {
    throw new Error(data.detail || 'Login failed')
  }

  if (!data.access_token) {
    throw new Error('Login token missing from backend response')
  }

  saveAccessToken(data.access_token)

  return convertLoggedInUserFromApi(data)
}

export const getCurrentUser = async () => {
  const token = getStoredAccessToken()

  if (!token) {
    return null
  }

  const response = await fetch(`${API_BASE_URL}/auth/me`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })

  const data = await response.json()

  if (!response.ok) {
    clearAccessToken()
    throw new Error(data.detail || 'Session expired. Please login again.')
  }

  return convertLoggedInUserFromApi(data)
}

export const logoutUser = () => {
  clearAccessToken()
}