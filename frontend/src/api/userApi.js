import { apiDelete, apiGet, apiPost, apiPut } from './apiClient'

const convertUserFromApi = (user) => {
  return {
    id: user.id,
    fullName: user.full_name,
    username: user.username,
    email: user.email,
    phone: user.phone || '',
    department: user.department || '',
    designation: user.designation || '',
    password: '',
    status: user.status,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
    failedLoginCount: Number(user.failed_login_count || 0),
    lockedUntil: user.locked_until || null,
    lastLoginAt: user.last_login_at || null,
    lastLoginIp: user.last_login_ip || '',
    totpEnabled: String(user.totp_enabled || '').trim().toLowerCase() === 'yes',
    force2FA: String(user.force_2fa || '').trim().toLowerCase() === 'yes',
    forcePasswordChange: String(user.force_password_change || '').trim().toLowerCase() === 'yes',
    passwordNeverExpires: String(user.password_never_expires || '').trim().toLowerCase() === 'yes',
    passwordExpiryDays: Number(user.password_expiry_days || 0),
    passwordChangedAt: user.password_changed_at || null,
    passwordExpired: user.password_expired === true,
    isLocked: user.is_locked === true,
    lockState: user.lock_state || 'Unlocked',
  }
}

const convertUserToApi = (user) => {
  return {
    full_name: user.fullName,
    username: user.username,
    email: user.email,
    phone: user.phone || null,
    department: user.department || null,
    designation: user.designation || null,
    password: user.password || '',
    status: user.status || 'Active',
  }
}

export const getUsers = async (params = {}) => {
  const { skip = 0, limit = 50, search = '' } = params
  let endpoint = `/users?skip=${skip}&limit=${limit}`
  if (search) endpoint += `&search=${encodeURIComponent(search)}`
  const data = await apiGet(endpoint)
  return {
    items: (data.items || []).map(convertUserFromApi),
    total: data.total || 0,
    skip: data.skip || 0,
    limit: data.limit || limit,
    has_more: data.has_more || false,
  }
}

export const createUser = async (user) => {
  const data = await apiPost('/users', convertUserToApi(user))
  return convertUserFromApi(data)
}

export const updateUser = async (userId, user) => {
  const data = await apiPut(`/users/${userId}`, convertUserToApi(user))
  return convertUserFromApi(data)
}

export const deleteUser = async (userId) => {
  return apiDelete(`/users/${userId}`)
}