import { apiGet, apiPost } from './apiClient'
import { saveAccessToken, saveRefreshToken } from './authToken'

/**
 * Profile & Security API.
 *
 * The self-service routes live under /auth (unchanged contract); the
 * administrator console lives under /security. Responses are normalised to
 * camelCase here so the pages never deal with snake_case.
 */

const applySessionTokens = (data) => {
  if (data?.access_token) saveAccessToken(data.access_token)
  if (data?.refresh_token) saveRefreshToken(data.refresh_token)
  return data
}

const yesNoToBool = (value) => String(value || '').trim().toLowerCase() === 'yes'

export const convertSecurityUser = (row = {}) => ({
  id: row.id,
  fullName: row.full_name || '',
  username: row.username || '',
  email: row.email || '',
  phone: row.phone || '',
  department: row.department || '',
  designation: row.designation || '',
  status: row.status || 'Active',
  roles: Array.isArray(row.roles) ? row.roles : [],
  failedLoginCount: Number(row.failed_login_count || 0),
  lockedUntil: row.locked_until || null,
  lockedReason: row.locked_reason || '',
  lockedByUsername: row.locked_by_username || '',
  isLocked: row.is_locked === true,
  lockState: row.lock_state || 'Unlocked',
  totpEnabled: row.totp_enabled === true || yesNoToBool(row.totp_enabled),
  force2FA: row.force_2fa === true || yesNoToBool(row.force_2fa),
  twoFactorEnrollmentRequired: row.two_factor_enrollment_required === true,
  twoFactorConfirmedAt: row.two_factor_confirmed_at || null,
  backupCodesRemaining: Number(row.backup_codes_remaining || 0),
  forcePasswordChange: row.force_password_change === true || yesNoToBool(row.force_password_change),
  passwordExpired: row.password_expired === true,
  passwordChangeRequired: row.password_change_required === true,
  passwordChangedAt: row.password_changed_at || null,
  passwordExpiresAt: row.password_expires_at || null,
  passwordNeverExpires: row.password_never_expires === true || yesNoToBool(row.password_never_expires),
  passwordExpiryDays: Number(row.password_expiry_days || 0),
  lastLoginAt: row.last_login_at || null,
  lastLoginIp: row.last_login_ip || '',
  pendingResetRequestCount: Number(row.pending_reset_request_count || 0),
  latestResetRequest: row.latest_reset_request || null,
  createdAt: row.created_at || null,
  updatedAt: row.updated_at || null,
})

export const convertResetRequest = (row = {}) => ({
  id: row.id,
  requestNumber: row.request_number || '',
  userId: row.user_id,
  username: row.username || '',
  fullName: row.full_name || '',
  userStatus: row.user_status || '',
  userLocked: row.user_locked === true,
  userTotpEnabled: row.user_totp_enabled === true,
  status: row.status || 'Pending',
  reason: row.reason || '',
  reset2FA: row.reset_2fa === true || yesNoToBool(row.reset_2fa),
  requestedAt: row.requested_at || null,
  requestedByIp: row.requested_by_ip || '',
  taskId: row.task_id || null,
  taskNumber: row.task_number || '',
  taskStatus: row.task_status || '',
  actedByUserId: row.acted_by_user_id || null,
  actedAt: row.acted_at || null,
  actionNotes: row.action_notes || '',
})

const convertAuditEvent = (row = {}) => ({
  id: row.id,
  action: row.action || '',
  moduleName: row.module_name || '',
  remarks: row.remarks || '',
  performedBy: row.performed_by || '',
  createdAt: row.created_at || null,
  requestPath: row.request_path || '',
  details: row.details || null,
})

// ---------------------------------------------------------------------------
// Self service
// ---------------------------------------------------------------------------

export const changeOwnPassword = async (payload) => {
  const data = await apiPost('/auth/change-password', {
    current_password: payload.currentPassword,
    new_password: payload.newPassword,
    confirm_password: payload.confirmPassword,
  })
  return applySessionTokens(data)
}

export const getPasswordPolicy = async () => apiGet('/auth/password-policy')

export const start2FASetup = async (payload = {}) => {
  const data = await apiPost('/auth/2fa/setup/start', {
    current_password: payload.currentPassword || null,
    code: payload.code || null,
  })
  return {
    qrCodeDataUrl: data.qr_code_data_url,
    manualEntryCode: data.manual_entry_code,
    issuer: data.issuer || '',
    accountName: data.account_name || '',
    expiresInMinutes: data.expires_in_minutes,
    isReconfiguration: data.is_reconfiguration === true,
    message: data.message,
  }
}

export const verify2FASetup = async (code) => {
  const data = await apiPost('/auth/2fa/setup/verify', { code })
  return {
    backupCodes: data.backup_codes || [],
    backupCodesRemaining: data.backup_codes_remaining,
    security: data.security || null,
    message: data.message,
  }
}

export const regenerate2FABackupCodes = async (currentPassword, code) => {
  const data = await apiPost('/auth/2fa/backup-codes/regenerate', {
    current_password: currentPassword,
    code,
  })
  return {
    backupCodes: data.backup_codes || [],
    backupCodesRemaining: data.backup_codes_remaining,
    message: data.message,
  }
}

export const disableOwn2FA = async (currentPassword, code) => {
  const data = await apiPost('/auth/2fa/disable', {
    current_password: currentPassword,
    code,
  })
  return applySessionTokens(data)
}

export const getMyResetRequests = async () => {
  const data = await apiGet('/auth/my/reset-requests')
  return (data.items || []).map(convertResetRequest)
}

export const cancelMyResetRequest = async (requestId) => {
  return apiPost(`/auth/my/reset-requests/${requestId}/cancel`, {})
}

export const getMySecurityActivity = async () => {
  const data = await apiGet('/auth/my/security-activity')
  return (data.items || []).map(convertAuditEvent)
}

// ---------------------------------------------------------------------------
// Administrator console
// ---------------------------------------------------------------------------

export const getSecurityOverview = async () => {
  const data = await apiGet('/security/overview')
  return {
    generatedAt: data.generated_at,
    totalUsers: Number(data.total_users || 0),
    activeUsers: Number(data.active_users || 0),
    inactiveUsers: Number(data.inactive_users || 0),
    lockedUsers: Number(data.locked_users || 0),
    automaticLockedUsers: Number(data.automatic_locked_users || 0),
    administrativelyLockedUsers: Number(data.administratively_locked_users || 0),
    twoFactorEnabledUsers: Number(data.two_factor_enabled_users || 0),
    twoFactorRequiredUsers: Number(data.two_factor_required_users || 0),
    passwordChangeRequiredUsers: Number(data.password_change_required_users || 0),
    passwordExpiredUsers: Number(data.password_expired_users || 0),
    usersWithoutTwoFactor: Number(data.users_without_two_factor || 0),
    pendingPasswordResetRequests: Number(data.pending_password_reset_requests || 0),
    pendingPasswordResetTasks: Number(data.pending_password_reset_tasks || 0),
    accountLockEventsLast7Days: Number(data.account_lock_events_last_7_days || 0),
  }
}

export const getSecurityUsers = async (params = {}) => {
  const { skip = 0, limit = 200, search = '', status = 'all' } = params
  let endpoint = `/security/users?skip=${skip}&limit=${limit}&status=${encodeURIComponent(status)}`
  if (search) endpoint += `&search=${encodeURIComponent(search)}`
  const data = await apiGet(endpoint)
  return {
    items: (data.items || []).map(convertSecurityUser),
    total: Number(data.total || 0),
    skip: Number(data.skip || 0),
    limit: Number(data.limit || limit),
    hasMore: data.has_more === true,
  }
}

export const getSecurityUser = async (userId) => {
  return convertSecurityUser(await apiGet(`/security/users/${userId}`))
}

export const getSecurityUserHistory = async (userId, limit = 30) => {
  const data = await apiGet(`/security/users/${userId}/history?limit=${limit}`)
  return (data.items || []).map(convertAuditEvent)
}

export const lockUserAccount = async (userId, payload = {}) =>
  apiPost(`/security/users/${userId}/lock`, {
    reason: payload.reason || null,
    duration_minutes: payload.durationMinutes ? Number(payload.durationMinutes) : null,
  })

export const unlockUserAccount = async (userId, payload = {}) =>
  apiPost(`/security/users/${userId}/unlock`, { reason: payload.reason || null })

export const resetUser2FA = async (userId, payload = {}) =>
  apiPost(`/security/users/${userId}/reset-2fa`, { reason: payload.reason || null })

export const revokeUserSessions = async (userId, payload = {}) =>
  apiPost(`/security/users/${userId}/revoke-sessions`, { reason: payload.reason || null })

export const requirePasswordChange = async (userId, payload = {}) =>
  apiPost(`/security/users/${userId}/require-password-change`, { reason: payload.reason || null })

export const updateTwoFactorPolicy = async (userId, required, reason = null) =>
  apiPost(`/security/users/${userId}/two-factor-policy`, {
    required: Boolean(required),
    reason: reason || null,
  })

export const adminResetUserPassword = async (userId, payload) => {
  const body = {
    force_password_change: Boolean(payload.forcePasswordChange),
    reset_2fa: Boolean(payload.reset2FA),
    unlock_account: payload.unlockAccount !== false,
    remarks: payload.remarks || null,
    generate_password: Boolean(payload.generatePassword),
  }
  // Sending an empty string would fail the min-length validator; omit it and
  // let the backend generate a password instead.
  if (!payload.generatePassword && payload.newPassword) {
    body.new_password = payload.newPassword
  }
  const data = await apiPost(`/auth/users/${userId}/security/reset-password`, body)
  return {
    message: data.message,
    temporaryPassword: data.temporary_password || '',
    mustChangePassword: data.must_change_password === true,
    twoFactorReset: data.two_factor_reset === true,
    sessionsRevoked: data.sessions_revoked === true,
  }
}

export const getPasswordResetRequests = async (params = {}) => {
  const { skip = 0, limit = 200, status = 'all', search = '' } = params
  let endpoint = `/security/password-reset-requests?skip=${skip}&limit=${limit}&status=${encodeURIComponent(status)}`
  if (search) endpoint += `&search=${encodeURIComponent(search)}`
  const data = await apiGet(endpoint)
  return {
    items: (data.items || []).map(convertResetRequest),
    total: Number(data.total || 0),
    counts: data.counts || {},
    hasMore: data.has_more === true,
  }
}

export const approvePasswordResetRequest = async (requestId, payload = {}) => {
  const body = {
    generate_password: Boolean(payload.generatePassword),
    force_password_change: payload.forcePasswordChange !== false,
    reset_2fa: payload.reset2FA === undefined ? null : Boolean(payload.reset2FA),
    remarks: payload.remarks || null,
  }
  if (!payload.generatePassword && payload.newPassword) {
    body.new_password = payload.newPassword
  }
  const data = await apiPost(`/security/password-reset-requests/${requestId}/approve`, body)
  return {
    message: data.message,
    temporaryPassword: data.temporary_password || '',
    mustChangePassword: data.must_change_password === true,
    twoFactorReset: data.two_factor_reset === true,
    sessionsRevoked: data.sessions_revoked === true,
    request: data.request ? convertResetRequest(data.request) : null,
  }
}

export const rejectPasswordResetRequest = async (requestId, remarks) => {
  const data = await apiPost(`/security/password-reset-requests/${requestId}/reject`, {
    remarks,
  })
  return {
    message: data.message,
    request: data.request ? convertResetRequest(data.request) : null,
  }
}
