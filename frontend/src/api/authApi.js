import { apiPost, apiGet } from './apiClient'
import {
  clearAccessToken,
  getStoredAccessToken,
  getStoredRefreshToken,
  saveAccessToken,
  saveRefreshToken,
} from './authToken'

const convertLoggedInUserFromApi = (data) => {
  const user = data.user

  return {
    id: user.id,
    fullName: user.full_name,
    username: user.username,
    userCode: user.username,
    email: user.email,
    phone: user.phone || '',
    department: user.department || '',
    designation: user.designation || '',
    status: user.status,
    security: user.security || {},
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

const saveLoginTokens = (data) => {
  if (data.access_token) {
    saveAccessToken(data.access_token)
  }
  if (data.refresh_token) {
    saveRefreshToken(data.refresh_token)
  }
}

export const loginUser = async (username, password) => {
  const data = await apiPost('/auth/login', { username, password })

  if (data.requires_2fa) {
    return {
      requires2FA: true,
      challengeId: data.challenge_id,
      userHint: data.user_hint || null,
    }
  }

  if (!data.access_token) {
    throw new Error('Login token missing from backend response')
  }

  saveLoginTokens(data)
  return convertLoggedInUserFromApi(data)
}

export const verifyLogin2FA = async (challengeId, code) => {
  const data = await apiPost('/auth/2fa/verify', {
    challenge_id: challengeId,
    code,
  })

  saveLoginTokens(data)
  return convertLoggedInUserFromApi(data)
}

export const requestPasswordReset = async (username, reason = '', reset2FA = false) => {
  const data = await apiPost('/auth/forgot-password', {
    username,
    reason,
    reset_2fa: Boolean(reset2FA),
  })
  return data
}

export const getCurrentUser = async () => {
  const token = getStoredAccessToken()
  if (!token) {
    return null
  }

  try {
    const data = await apiGet('/auth/me')
    return convertLoggedInUserFromApi(data)
  } catch {
    clearAccessToken()
    return null
  }
}

export const refreshAccessToken = async () => {
  const refreshToken = getStoredRefreshToken()
  if (!refreshToken) {
    return false
  }

  try {
    const data = await apiPost('/auth/refresh', { refresh_token: refreshToken })
    if (data.access_token) {
      saveAccessToken(data.access_token)
    }
    if (data.refresh_token) {
      saveRefreshToken(data.refresh_token)
    }
    return true
  } catch {
    clearAccessToken()
    return false
  }
}

export const logoutUser = async () => {
  try {
    await apiPost('/auth/logout', {})
  } catch {
    // Best-effort: clear locally even if server call fails
  }
  clearAccessToken()
}
