import { apiPost, apiGet } from './apiClient'
import { clearAccessToken, getStoredAccessToken, saveAccessToken } from './authToken'

const convertLoggedInUserFromApi = (data) => {
  const user = data.user || data
  const backendRoles = Array.isArray(user.roles) ? user.roles : []
  const fallbackRole = user.role ? [user.role] : []
  const mappedRoles = [...backendRoles, ...fallbackRole]
    .filter(Boolean)
    .map((role) => ({
      id: role.id,
      roleName: role.role_name || role.roleName || role.name || '',
      description: role.description || '',
      status: role.status,
    }))
    .filter((role) => role.roleName)

  const primaryRole = mappedRoles[0]
    ? {
        id: mappedRoles[0].id,
        roleName: mappedRoles[0].roleName,
        description: mappedRoles[0].description,
        status: mappedRoles[0].status,
      }
    : null

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
    isAdmin: user.is_admin === true,
    security: user.security || {},
    role: primaryRole,
    roles: mappedRoles,
    roleName: primaryRole?.roleName || '',
    role_name: primaryRole?.roleName || '',
    permissions: (user.permissions || []).map((permission) => ({
      id: permission.id,
      permissionName: permission.permission_name || permission.permissionName,
      moduleName: permission.module_name || permission.moduleName,
      description: permission.description || '',
      status: permission.status,
    })),
    assignedLocationCodes: user.assigned_location_codes || [],
    allLocationsAccess: user.all_locations_access || 'No',
  }
}

const saveLoginTokens = (data) => {
  if (data.access_token) {
    saveAccessToken(data.access_token)
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
  let token = getStoredAccessToken()
  if (!token) {
    const refreshed = await refreshAccessToken()
    if (refreshed) token = getStoredAccessToken()
  }
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
  try {
    // The refresh token travels only in the HttpOnly cookie.
    const data = await apiPost('/auth/refresh', {})
    if (data.access_token) {
      saveAccessToken(data.access_token)
    }
    return Boolean(data.access_token)
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

/** Revoke every session for the signed-in account (all devices). */
export const logoutAllDevices = async () => {
  try {
    await apiPost('/auth/logout-all', {})
  } finally {
    clearAccessToken()
  }
}
