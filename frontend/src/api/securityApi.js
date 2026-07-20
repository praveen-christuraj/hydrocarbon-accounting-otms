import { apiPost } from './apiClient'

export const changeOwnPassword = async (payload) => {
  return apiPost('/auth/change-password', {
    current_password: payload.currentPassword,
    new_password: payload.newPassword,
    confirm_password: payload.confirmPassword,
  })
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

export const adminResetUserPassword = async (userId, payload) => {
  return apiPost(`/users/${userId}/security/reset-password`, {
    new_password: payload.newPassword,
    force_password_change: Boolean(payload.forcePasswordChange),
    reset_2fa: Boolean(payload.reset2FA),
    remarks: payload.remarks || null,
  })
}
