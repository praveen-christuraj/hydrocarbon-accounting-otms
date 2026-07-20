import { useEffect, useMemo, useState } from 'react'
import {
  createSystemNotification,
  deactivateSystemNotification,
  getSystemNotificationDeliveryReport,
  getSystemNotifications,
  publishSystemNotification,
  updateSystemNotification,
} from '../api/systemNotificationApi'

const emptyForm = {
  title: '',
  message: '',
  notificationType: 'Info',
  priority: 'Normal',
  deliveryMode: 'Banner + Inbox',
  targetScope: 'All Users',
  targetRoleIds: [],
  targetUserIds: [],
  targetLocationCodes: [],
  displayFrom: '',
  displayUntil: '',
  requiresAcknowledgement: false,
  popupEnabled: false,
  bannerEnabled: true,
  autoDismissSeconds: '',
  status: 'Draft',
}

const toLocalDateTimeInput = (value) => {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString().slice(0, 16)
}

function SystemNotificationMaster({ roles = [], users = [], locations = [], loggedInUser }) {
  const [form, setForm] = useState(emptyForm)
  const [editId, setEditId] = useState(null)
  const [notifications, setNotifications] = useState([])
  const [deliveryRows, setDeliveryRows] = useState([])
  const [selectedNotification, setSelectedNotification] = useState(null)
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [loading, setLoading] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [validationErrors, setValidationErrors] = useState({})
  const [confirmPublishItem, setConfirmPublishItem] = useState(null)
  const [deactivateItem, setDeactivateItem] = useState(null)
  const [deactivateReason, setDeactivateReason] = useState('')

  const activeRoles = useMemo(() => roles.filter((role) => role.status === 'Active'), [roles])
  const activeUsers = useMemo(() => users.filter((user) => user.status === 'Active'), [users])
  const activeLocations = useMemo(
    () => locations.filter((location) => location.status === 'Active'),
    [locations]
  )

  const isAdminBootstrap =
    String(loggedInUser?.username || '').toLowerCase() === 'admin'
  const hasPermission = (permissionName) => {
    if (isAdminBootstrap) return true
    if (!loggedInUser || !Array.isArray(loggedInUser.permissions)) return false
    return loggedInUser.permissions.some(
      (p) => p.permissionName === permissionName
    )
  }
  const canManageSystemNotification = hasPermission('Manage System Notification')
  const canPublishSystemNotification = hasPermission('Publish System Notification')
  const canDeactivateSystemNotification = hasPermission('Deactivate System Notification')
  const canViewDeliveryReport = hasPermission('View System Notification Delivery Report')

  const loadNotifications = async (status = statusFilter) => {
    try {
      setLoading(true)
      const data = await getSystemNotifications({
        status: status === 'ALL' ? '' : status,
      })
      setNotifications(data)
    } catch (error) {
      setErrorMsg(error.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadNotifications()
  }, [statusFilter])

  const updateField = (fieldName, value) => {
    setForm((current) => ({
      ...current,
      [fieldName]: value,
    }))
  }

  const toggleArrayValue = (fieldName, value) => {
    setForm((current) => {
      const currentValues = current[fieldName] || []
      return {
        ...current,
        [fieldName]: currentValues.includes(value)
          ? currentValues.filter((item) => item !== value)
          : [...currentValues, value],
      }
    })
  }

  const resetForm = () => {
    setForm(emptyForm)
    setEditId(null)
  }

  const handleSave = async (event) => {
    event.preventDefault()

    if (!canManageSystemNotification) {
      setErrorMsg('You do not have permission to manage system notifications.')
      return
    }

    setSuccessMsg('')
    setErrorMsg('')
    setValidationErrors({})

    const errors = {}
    if (form.title.trim() === '') {
      errors.title = 'Title is required'
    }
    if (form.message.trim() === '') {
      errors.message = 'Message is required'
    }
    if (form.displayFrom && form.displayUntil && form.displayFrom > form.displayUntil) {
      errors.displayUntil = 'Display From cannot be later than Display Until'
    }

    setValidationErrors(errors)
    if (Object.keys(errors).length > 0) return

    try {
      setLoading(true)
      if (editId) {
        await updateSystemNotification(editId, form)
        setSuccessMsg('Notification updated')
      } else {
        await createSystemNotification(form)
        setSuccessMsg('Notification created')
      }
      resetForm()
      await loadNotifications()
    } catch (error) {
      setErrorMsg(error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleEdit = (notification) => {
    setSuccessMsg('')
    setErrorMsg('')
    if (!canManageSystemNotification) {
      setErrorMsg('You do not have permission to manage system notifications.')
      return
    }
    if (notification.status === 'Published') {
      setErrorMsg('Published notifications cannot be edited. Deactivate and create a new circular if needed.')
      return
    }
    setEditId(notification.id)
    setForm({
      title: notification.title,
      message: notification.message,
      notificationType: notification.notificationType,
      priority: notification.priority,
      deliveryMode: notification.deliveryMode,
      targetScope: notification.targetScope,
      targetRoleIds: notification.targetRoleIds || [],
      targetUserIds: notification.targetUserIds || [],
      targetLocationCodes: notification.targetLocationCodes || [],
      displayFrom: toLocalDateTimeInput(notification.displayFrom),
      displayUntil: toLocalDateTimeInput(notification.displayUntil),
      requiresAcknowledgement: notification.requiresAcknowledgement,
      popupEnabled: notification.popupEnabled,
      bannerEnabled: notification.bannerEnabled,
      autoDismissSeconds: notification.autoDismissSeconds || '',
      status: notification.status === 'Scheduled' ? 'Scheduled' : 'Draft',
    })
  }

  const handlePublish = async () => {
    setSuccessMsg('')
    setErrorMsg('')
    if (!canPublishSystemNotification) {
      setErrorMsg('You do not have permission to publish system notifications.')
      return
    }
    try {
      setLoading(true)
      await publishSystemNotification(confirmPublishItem.id, 'Published from System Notification Manager')
      setConfirmPublishItem(null)
      await loadNotifications()
      setSuccessMsg('Notification published')
    } catch (error) {
      setErrorMsg(error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleDeactivate = async () => {
    setSuccessMsg('')
    setErrorMsg('')
    if (!canDeactivateSystemNotification) {
      setErrorMsg('You do not have permission to deactivate system notifications.')
      return
    }
    const reason = deactivateReason || 'Notification deactivated by admin'
    try {
      setLoading(true)
      await deactivateSystemNotification(deactivateItem.id, reason)
      setDeactivateItem(null)
      setDeactivateReason('')
      await loadNotifications()
      setSuccessMsg('Notification deactivated')
    } catch (error) {
      setErrorMsg(error.message)
    } finally {
      setLoading(false)
    }
  }

  const loadDeliveryReport = async (notification) => {
    try {
      setSelectedNotification(notification)
      const data = await getSystemNotificationDeliveryReport(notification.id)
      setDeliveryRows(data || [])
    } catch (error) {
      setErrorMsg(error.message)
    }
  }

  const showRoleTargets = ['Roles', 'Roles + Locations'].includes(form.targetScope)
  const showUserTargets = form.targetScope === 'Specific Users'
  const showLocationTargets = ['Locations', 'Roles + Locations'].includes(form.targetScope)

  return (
    <div>
      <div className="page-title">
        <div>
          <h2>System Notifications</h2>
          <p>Create application maintenance notices, circulars, and critical user announcements.</p>
        </div>
        <span className="record-count">{notifications.length} Notifications</span>
      </div>

      {successMsg && (
        <div className="success-box">{successMsg}</div>
      )}

      {errorMsg && (
        <div className="error-box">{errorMsg}</div>
      )}

      {confirmPublishItem && (
        <div className="confirm-overlay">
          <div className="confirm-box">
            <p>Publish <strong>{confirmPublishItem.notificationNumber}</strong>?</p>
            <div className="confirm-actions">
              <button onClick={handlePublish} disabled={loading}>
                {loading ? 'Publishing...' : 'Yes, Publish'}
              </button>
              <button onClick={() => setConfirmPublishItem(null)} disabled={loading}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {deactivateItem && (
        <div className="confirm-overlay">
          <div className="confirm-box">
            <p>Deactivate <strong>{deactivateItem.notificationNumber}</strong></p>
            <label>Deactivation reason</label>
            <input
              type="text"
              value={deactivateReason}
              onChange={(e) => setDeactivateReason(e.target.value)}
              placeholder="Notification deactivated by admin"
            />
            <div className="confirm-actions">
              <button onClick={handleDeactivate} disabled={loading}>
                {loading ? 'Deactivating...' : 'Deactivate'}
              </button>
              <button onClick={() => { setDeactivateItem(null); setDeactivateReason('') }} disabled={loading}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {!canManageSystemNotification && (
        <div className="info-box">
          You have view-only access. Contact an administrator to create, edit, or
          manage system notifications.
        </div>
      )}

      {canManageSystemNotification && (
      <form onSubmit={handleSave} className="notification-admin-form">
        <div>
          <label>Title</label>
          <input
            value={form.title}
            onChange={(event) => { updateField('title', event.target.value); setValidationErrors({ ...validationErrors, title: '' }) }}
            placeholder="Server maintenance scheduled"
            disabled={loading}
            className={validationErrors.title ? 'input-error' : ''}
          />
          {validationErrors.title && (
            <span className="field-error">{validationErrors.title}</span>
          )}
        </div>

        <div className="full-width-field">
          <label>Message</label>
          <textarea
            rows="4"
            value={form.message}
            onChange={(event) => { updateField('message', event.target.value); setValidationErrors({ ...validationErrors, message: '' }) }}
            placeholder="Write the notification users should see."
            disabled={loading}
            className={validationErrors.message ? 'input-error' : ''}
          />
          {validationErrors.message && (
            <span className="field-error">{validationErrors.message}</span>
          )}
        </div>

        <div>
          <label>Type</label>
          <select value={form.notificationType} onChange={(event) => updateField('notificationType', event.target.value)}>
            <option>Info</option>
            <option>Warning</option>
            <option>Critical</option>
            <option>Success</option>
            <option>Maintenance</option>
            <option>Circular</option>
          </select>
        </div>

        <div>
          <label>Priority</label>
          <select value={form.priority} onChange={(event) => updateField('priority', event.target.value)}>
            <option>Low</option>
            <option>Normal</option>
            <option>High</option>
            <option>Critical</option>
          </select>
        </div>

        <div>
          <label>Delivery Mode</label>
          <select value={form.deliveryMode} onChange={(event) => updateField('deliveryMode', event.target.value)}>
            <option>Banner</option>
            <option>Popup</option>
            <option>Inbox</option>
            <option>Banner + Inbox</option>
            <option>Popup + Inbox</option>
          </select>
        </div>

        <div>
          <label>Target Scope</label>
          <select value={form.targetScope} onChange={(event) => updateField('targetScope', event.target.value)}>
            <option>All Users</option>
            <option>Roles</option>
            <option>Specific Users</option>
            <option>Locations</option>
            <option>Roles + Locations</option>
          </select>
        </div>

        <div>
          <label>Display From</label>
          <input type="datetime-local" value={form.displayFrom} onChange={(event) => updateField('displayFrom', event.target.value)} />
        </div>

        <div>
          <label>Display Until</label>
          <input type="datetime-local" value={form.displayUntil} onChange={(event) => { updateField('displayUntil', event.target.value); setValidationErrors({ ...validationErrors, displayUntil: '' }) }} className={validationErrors.displayUntil ? 'input-error' : ''} />
          {validationErrors.displayUntil && (
            <span className="field-error">{validationErrors.displayUntil}</span>
          )}
        </div>

        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={form.requiresAcknowledgement}
            onChange={(event) => updateField('requiresAcknowledgement', event.target.checked)}
          />
          Requires acknowledgement
        </label>

        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={form.popupEnabled}
            onChange={(event) => updateField('popupEnabled', event.target.checked)}
          />
          Popup enabled
        </label>

        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={form.bannerEnabled}
            onChange={(event) => updateField('bannerEnabled', event.target.checked)}
          />
          Banner enabled
        </label>

        <div>
          <label>Auto Dismiss Seconds</label>
          <input
            type="number"
            min="0"
            value={form.autoDismissSeconds}
            onChange={(event) => updateField('autoDismissSeconds', event.target.value)}
            placeholder="0 / blank = manual"
          />
        </div>

        {showRoleTargets && (
          <div className="full-width-field notification-target-box">
            <label>Target Roles</label>
            {activeRoles.map((role) => (
              <label key={role.id} className="checkbox-label">
                <input
                  type="checkbox"
                  checked={form.targetRoleIds.includes(role.id)}
                  onChange={() => toggleArrayValue('targetRoleIds', role.id)}
                />
                {role.roleName}
              </label>
            ))}
          </div>
        )}

        {showUserTargets && (
          <div className="full-width-field notification-target-box">
            <label>Target Users</label>
            {activeUsers.map((user) => (
              <label key={user.id} className="checkbox-label">
                <input
                  type="checkbox"
                  checked={form.targetUserIds.includes(user.id)}
                  onChange={() => toggleArrayValue('targetUserIds', user.id)}
                />
                {user.fullName} ({user.username})
              </label>
            ))}
          </div>
        )}

        {showLocationTargets && (
          <div className="full-width-field notification-target-box">
            <label>Target Locations</label>
            {activeLocations.map((location) => (
              <label key={location.id} className="checkbox-label">
                <input
                  type="checkbox"
                  checked={form.targetLocationCodes.includes(location.locationCode)}
                  onChange={() => toggleArrayValue('targetLocationCodes', location.locationCode)}
                />
                {location.locationName} ({location.locationCode})
              </label>
            ))}
            <small>
              Location targeting uses active user asset assignments where assigned_to matches username or full name.
            </small>
          </div>
        )}

        <div className="form-actions">
          <button type="submit" disabled={loading}>
            {editId ? 'Update Notification' : 'Create Draft'}
          </button>
          <button type="button" onClick={resetForm} disabled={loading}>
            Reset
          </button>
        </div>
      </form>
      )}

      <div className="section-title">
        <h3>Notifications</h3>
        <p>Draft, scheduled, published, and inactive circulars.</p>
      </div>

      <div className="filter-panel">
        <div>
          <label>Status</label>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="ALL">All</option>
            <option>Draft</option>
            <option>Scheduled</option>
            <option>Published</option>
            <option>Deactivated</option>
            <option>Expired</option>
          </select>
        </div>
        <div className="filter-actions">
          <button type="button" onClick={() => loadNotifications()} disabled={loading}>
            Refresh
          </button>
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th>No.</th>
            <th>Title</th>
            <th>Type / Priority</th>
            <th>Target</th>
            <th>Window</th>
            <th>Status</th>
            <th>Delivery</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {notifications.length === 0 ? (
            <tr>
              <td colSpan="8" className="empty-table">No system notifications found.</td>
            </tr>
          ) : (
            notifications.map((notification) => (
              <tr key={notification.id}>
                <td>{notification.notificationNumber}</td>
                <td>
                  <strong>{notification.title}</strong>
                  <div className="muted-table-text">{notification.createdByDisplay || '-'}</div>
                </td>
                <td>{notification.notificationType} / {notification.priority}</td>
                <td>{notification.targetScope}</td>
                <td>
                  {notification.displayFrom ? new Date(notification.displayFrom).toLocaleString() : 'Immediate'}
                  <div className="muted-table-text">
                    Until: {notification.displayUntil ? new Date(notification.displayUntil).toLocaleString() : 'No end'}
                  </div>
                </td>
                <td><span className={`status-badge ${notification.status.toLowerCase()}`}>{notification.status}</span></td>
                <td>
                  {notification.deliveryCount} delivered
                  <div className="muted-table-text">
                    Seen {notification.seenCount} | Ack {notification.acknowledgedCount}
                  </div>
                </td>
                <td>
                  <div className="table-actions">
                    {canManageSystemNotification && (
                      <button type="button" onClick={() => handleEdit(notification)} disabled={loading || notification.status === 'Published'}>
                        Edit
                      </button>
                    )}
                    {canPublishSystemNotification && (
                      <button type="button" onClick={() => { setSuccessMsg(''); setErrorMsg(''); setConfirmPublishItem(notification) }} disabled={loading || ['Published', 'Deactivated'].includes(notification.status)}>
                        Publish
                      </button>
                    )}
                    {canDeactivateSystemNotification && (
                      <button type="button" onClick={() => { setSuccessMsg(''); setErrorMsg(''); setDeactivateItem(notification); setDeactivateReason('Notification deactivated by admin') }} disabled={loading || notification.status === 'Deactivated'}>
                        Deactivate
                      </button>
                    )}
                    {canViewDeliveryReport && (
                      <button type="button" onClick={() => loadDeliveryReport(notification)} disabled={loading}>
                        Delivery
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      {selectedNotification && (
        <div className="info-box">
          <div className="section-title compact-section-title">
            <h3>Delivery Report - {selectedNotification.notificationNumber}</h3>
            <p>{selectedNotification.title}</p>
          </div>
          <table>
            <thead>
              <tr>
                <th>User</th>
                <th>Status</th>
                <th>Delivered</th>
                <th>Seen</th>
                <th>Dismissed</th>
                <th>Acknowledged</th>
                <th>Remarks</th>
              </tr>
            </thead>
            <tbody>
              {deliveryRows.length === 0 ? (
                <tr>
                  <td colSpan="7" className="empty-table">No delivery receipts found.</td>
                </tr>
              ) : (
                deliveryRows.map((receipt) => (
                  <tr key={receipt.id}>
                    <td>{receipt.username || receipt.user_id}</td>
                    <td>{receipt.status}</td>
                    <td>{receipt.delivered_at ? new Date(receipt.delivered_at).toLocaleString() : '-'}</td>
                    <td>{receipt.first_seen_at ? new Date(receipt.first_seen_at).toLocaleString() : '-'}</td>
                    <td>{receipt.dismissed_at ? new Date(receipt.dismissed_at).toLocaleString() : '-'}</td>
                    <td>{receipt.acknowledged_at ? new Date(receipt.acknowledged_at).toLocaleString() : '-'}</td>
                    <td>{receipt.acknowledgement_remarks || '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default SystemNotificationMaster
