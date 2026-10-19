import { apiPost, apiGet } from './apiClient'
import {
  clearAccessToken,
  getStoredAccessToken,
  getStoredRefreshToken,
  saveAccessToken,
  saveRefreshToken,
} from './authToken'

const yesNo = (value) => String(value || '').trim().toLowerCase() === 'yes'

const convertSecurityFlags = (security = {}) => ({
  forcePasswordChange: security.force_password_change === true,
  passwordExpired: security.password_expired === true,
  passwordChangeRequired: security.password_change_required === true,
  passwordChangedAt: security.password_changed_at || null,
  passwordExpiresAt: security.password_expires_at || null,
  passwordDaysRemaining: security.password_days_remaining ?? null,
  passwordNeverExpires: security.password_never_expires === true || yesNo(security.password_never_expires),
  totpEnabled: security.totp_enabled === true || yesNo(security.totp_enabled),
  force2FA: security.force_2fa === true || yesNo(security.force_2fa),
  twoFactorEnrollmentRequired: security.two_factor_enrollment_required === true,
  twoFactorConfirmedAt: security.two_factor_confirmed_at || null,
  backupCodesRemaining: Number(security.backup_codes_remaining || 0),
  failedLoginCount: Number(security.failed_login_count || 0),
  lockedUntil: security.locked_until || null,
  isLocked: security.is_locked === true,
  lastLoginAt: security.last_login_at || null,
})

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
    security: convertSecurityFlags(data.security || user.security || {}),
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
    await apiPost('/auth/logout', { refresh_token: getStoredRefreshToken() || null })
  } catch {
    // Best-effort: clear locally even if server call fails
  }
  clearAccessToken()
}
