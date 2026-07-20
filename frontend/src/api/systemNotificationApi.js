import { apiGet, apiPost, apiPut } from './apiClient'

const fromApi = (row) => ({
  id: row.id,
  notificationNumber: row.notification_number || '',
  title: row.title || '',
  message: row.message || '',
  notificationType: row.notification_type || 'Info',
  priority: row.priority || 'Normal',
  deliveryMode: row.delivery_mode || 'Banner + Inbox',
  targetScope: row.target_scope || 'All Users',
  targetRoleIds: row.target_role_ids || [],
  targetUserIds: row.target_user_ids || [],
  targetLocationCodes: row.target_location_codes || [],
  displayFrom: row.display_from || '',
  displayUntil: row.display_until || '',
  requiresAcknowledgement: Boolean(row.requires_acknowledgement),
  popupEnabled: Boolean(row.popup_enabled),
  bannerEnabled: Boolean(row.banner_enabled),
  autoDismissSeconds: row.auto_dismiss_seconds || '',
  status: row.status || '',
  createdByUserId: row.created_by_user_id || null,
  createdByDisplay: row.created_by_display || '',
  publishedAt: row.published_at || '',
  deactivatedAt: row.deactivated_at || '',
  deactivationReason: row.deactivation_reason || '',
  createdAt: row.created_at || '',
  updatedAt: row.updated_at || '',
  receiptStatus: row.receipt_status || '',
  firstSeenAt: row.first_seen_at || '',
  dismissedAt: row.dismissed_at || '',
  acknowledgedAt: row.acknowledged_at || '',
  deliveryCount: row.delivery_count || 0,
  seenCount: row.seen_count || 0,
  acknowledgedCount: row.acknowledged_count || 0,
  dismissedCount: row.dismissed_count || 0,
})

const toApi = (row) => ({
  title: row.title,
  message: row.message,
  notification_type: row.notificationType,
  priority: row.priority,
  delivery_mode: row.deliveryMode,
  target_scope: row.targetScope,
  target_role_ids: row.targetRoleIds || [],
  target_user_ids: row.targetUserIds || [],
  target_location_codes: row.targetLocationCodes || [],
  display_from: row.displayFrom || null,
  display_until: row.displayUntil || null,
  requires_acknowledgement: Boolean(row.requiresAcknowledgement),
  popup_enabled: Boolean(row.popupEnabled),
  banner_enabled: Boolean(row.bannerEnabled),
  auto_dismiss_seconds: row.autoDismissSeconds
    ? Number(row.autoDismissSeconds)
    : null,
  status: row.status || 'Draft',
})

export const getSystemNotifications = async (filters = {}) => {
  const params = new URLSearchParams()
  if (filters.status) params.append('status', filters.status)
  const path = params.toString()
    ? `/system-notifications?${params.toString()}`
    : '/system-notifications'
  const data = await apiGet(path)
  return (data || []).map(fromApi)
}

export const getActiveSystemNotifications = async () => {
  const data = await apiGet('/system-notifications/active')
  return (data || []).map(fromApi)
}

export const getMySystemNotifications = async () => {
  const data = await apiGet('/system-notifications/my')
  return (data || []).map(fromApi)
}

export const createSystemNotification = async (payload) => {
  const data = await apiPost('/system-notifications', toApi(payload))
  return fromApi(data)
}

export const updateSystemNotification = async (notificationId, payload) => {
  const data = await apiPut(`/system-notifications/${notificationId}`, toApi(payload))
  return fromApi(data)
}

export const publishSystemNotification = async (notificationId, remarks = '') => {
  const data = await apiPost(`/system-notifications/${notificationId}/publish`, {
    remarks,
  })
  return fromApi(data)
}

export const deactivateSystemNotification = async (
  notificationId,
  remarks = ''
) => {
  const data = await apiPost(`/system-notifications/${notificationId}/deactivate`, {
    remarks,
  })
  return fromApi(data)
}

export const dismissSystemNotification = async (notificationId) => {
  const data = await apiPost(`/system-notifications/${notificationId}/dismiss`, {})
  return fromApi(data)
}

export const acknowledgeSystemNotification = async (
  notificationId,
  remarks = ''
) => {
  const data = await apiPost(`/system-notifications/${notificationId}/acknowledge`, {
    remarks,
  })
  return fromApi(data)
}

export const getSystemNotificationDeliveryReport = async (notificationId) => {
  return apiGet(`/system-notifications/${notificationId}/delivery-report`)
}
