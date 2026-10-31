import { apiGet, apiPost } from './apiClient'
import { saveAccessToken } from './authToken'

export const changeOwnPassword = async (payload) => {
  const data = await apiPost('/auth/change-password', {
    current_password: payload.currentPassword,
    new_password: payload.newPassword,
    confirm_password: payload.confirmPassword,
  })
  // The backend rotates the session tokens when the password changes (all
  // tokens issued before the change are revoked server-side). Persist the
  // fresh pair so the current session continues seamlessly.
  if (data.access_token) saveAccessToken(data.access_token)
  return data
}

export const start2FASetup = async () => {
  return apiPost('/auth/2fa/setup/start', {})
}

export const verify2FASetup = async (code) => {
  return apiPost('/auth/2fa/setup/verify', { code })
}

export const regenerate2FABackupCodes = async () => {
  return apiPost('/auth/2fa/backup-codes/regenerate', {})
}

export const disableOwn2FA = async (currentPassword, code) => {
  return apiPost('/auth/2fa/disable', {
    current_password: currentPassword,
    code,
  })
}

// ---------------------------------------------------------------------------
// Administrator security console
// ---------------------------------------------------------------------------

export const getUsersSecurityOverview = async () => {
  return apiGet('/auth/users/security-overview')
}

export const adminResetUserPassword = async (userId, payload) => {
  // Backend router is mounted at /auth (app/routers/auth.py → APIRouter(prefix="/auth")).
  return apiPost(`/auth/users/${userId}/security/reset-password`, {
    new_password: payload.newPassword,
    force_password_change: Boolean(payload.forcePasswordChange),
    reset_2fa: Boolean(payload.reset2FA),
    remarks: payload.remarks || null,
  })
}

export const adminUnlockUserAccount = async (userId) => {
  return apiPost(`/auth/users/${userId}/security/unlock`, {})
}

export const adminResetUser2FA = async (userId) => {
  return apiPost(`/auth/users/${userId}/security/reset-2fa`, {})
}

export const adminRequirePasswordChange = async (userId) => {
  return apiPost(`/auth/users/${userId}/security/require-password-change`, {})
}

export const getPasswordResetRequests = async (status = 'Pending') => {
  const query = status && status !== 'All' ? `?status=${encodeURIComponent(status)}` : '?status=All'
  return apiGet(`/auth/password-reset-requests${query}`)
}

export const declinePasswordResetRequest = async (requestId, notes) => {
  return apiPost(`/auth/password-reset-requests/${requestId}/decline`, {
    notes: notes || null,
  })
}
