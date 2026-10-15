import { useEffect, useMemo, useState } from 'react'
import {
  createSystemNotification,
  deactivateSystemNotification,
  getSystemNotificationDeliveryReport,
  getSystemNotifications,
  publishSystemNotification,
  updateSystemNotification,
} from '../api/systemNotificationApi'
import PaginationControls, { paginateRows, usePageSize } from '../components/common/PaginationControls'
import DataTableToolbar from '../components/common/DataTableToolbar'
import { useDataFilters } from '../hooks/useDataFilters'
import { useAutoColumns } from '../hooks/useAutoColumns'

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
  const [page, setPage] = useState(1)
  const pageSize = usePageSize()
  const [deliveryPage, setDeliveryPage] = useState(1)

  const notificationsFilters = useDataFilters(notifications, useAutoColumns(notifications), { module: 'System Notifications' })
  const deliveryRowsFilters = useDataFilters(deliveryRows, useAutoColumns(deliveryRows), { module: 'System Notifications' })
  const visibleNotifications = paginateRows(notificationsFilters.filteredRows, page, pageSize)
  const visibleDeliveryRows = paginateRows(deliveryRowsFilters.filteredRows, deliveryPage, pageSize)

  const activeRoles = useMemo(() => roles.filter((role) => role.status === 'Active'), [roles])
  const activeUsers = useMemo(() => users.filter((user) => user.status === 'Active'), [users])
  const activeLocations = useMemo(
    () => locations.filter((location) => location.status === 'Active'),
    [locations]
  )

  const isAdminBootstrap =
    loggedInUser?.isAdmin === true ||
    String(loggedInUser?.username || '').trim().toLowerCase() === 'admin' ||
    (Array.isArray(loggedInUser?.roles) && loggedInUser.roles.some((role) =>
      String(role?.role_name || role?.roleName || '').trim().toLowerCase() === 'admin'
    ))
  const hasPermission = (permissionName) => {
    if (isAdminBootstrap) return true
    if (!loggedInUser || !Array.isArray(loggedInUser.permissions)) return false
    return loggedInUser.permissions.some(
      (p) => p.permissionName === permissionName
    )
  }
  const canCreateSystemNotification = hasPermission('Create System Notification')
  const canEditSystemNotification = hasPermission('Edit System Notification')
  const canWriteSystemNotification =
    canCreateSystemNotification || canEditSystemNotification
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

  useEffect(() => {
    setPage(1)
  }, [notifications.length])

  useEffect(() => {
    setDeliveryPage(1)
  }, [deliveryRows.length])

  /* bulk upload */
  const splitList = (value) =>
    String(value ?? '')
      .split(/[,;]/)
      .map((item) => String(item).trim())
      .filter(Boolean)

  const resolveTargets = (values, rows, keys, idKey) => {
    const found = []
    const missing = []
    values.forEach((value) => {
      const needle = String(value).trim().toLowerCase()
      const match = rows.find((row) => keys.some((key) => String(row?.[key] ?? '').trim().toLowerCase() === needle))
      if (match) {
        found.push(idKey === 'code' ? match.location_code || match.locationCode || match.code : match.id)
      } else {
        missing.push(value)
      }
    })
    return { found, missing }
  }

  const parseFlag = (value, fallback) => {
    const token = String(value ?? '').trim().toLowerCase()
    if (!token) return fallback
    return ['yes', 'y', 'true', '1'].includes(token)
  }

  const buildNotificationPayload = (row) => {
    const roles = resolveTargets(splitList(row.targetRoles), activeRoles, ['role_name', 'roleName', 'name'], 'id')
    const users = resolveTargets(
      splitList(row.targetUsers),
      activeUsers,
      ['username', 'user_name', 'userName', 'email', 'full_name', 'fullName'],
      'id'
    )
    const locationList = resolveTargets(
      splitList(row.targetLocations),
      activeLocations,
      ['location_code', 'locationCode', 'code', 'location_name', 'locationName', 'name'],
      'code'
    )

    return {
      payload: {
        title: String(row.title ?? '').trim(),
        message: String(row.message ?? '').trim(),
        notificationType: String(row.notificationType ?? '').trim() || 'Info',
        priority: String(row.priority ?? '').trim() || 'Normal',
        deliveryMode: String(row.deliveryMode ?? '').trim() || 'Banner + Inbox',
        targetScope: String(row.targetScope ?? '').trim() || 'All Users',
        targetRoleIds: roles.found,
        targetUserIds: users.found,
        targetLocationCodes: locationList.found,
        displayFrom: String(row.displayFrom ?? '').trim(),
        displayUntil: String(row.displayUntil ?? '').trim(),
        requiresAcknowledgement: parseFlag(row.requiresAcknowledgement, false),
        popupEnabled: parseFlag(row.popupEnabled, false),
        bannerEnabled: parseFlag(row.bannerEnabled, true),
        autoDismissSeconds: String(row.autoDismissSeconds ?? '').trim(),
        status: String(row.status ?? '').trim() || 'Draft',
      },
      missing: {
        Roles: roles.missing,
        Users: users.missing,
        Locations: locationList.missing,
      },
    }
  }

  const importConfig = {
    title: 'Bulk upload system notifications',
    description:
      'Upload an Excel (.xlsx) or CSV file of notifications. Title and Message are required. Target Roles, Target Users and Target Locations accept comma-separated names or codes.',
    templateFileName: 'system-notifications-upload-template',
    fields: [
      { key: 'title', label: 'Title', required: true, example: 'Server maintenance scheduled', aliases: ['Notification Title', 'Subject'] },
      { key: 'message', label: 'Message', required: true, example: 'The application will be offline from 22:00.', aliases: ['Body', 'Text'] },
      { key: 'notificationType', label: 'Type', required: false, example: 'Info', options: ['Info', 'Warning', 'Critical', 'Success', 'Maintenance', 'Circular'], defaultValue: 'Info' },
      { key: 'priority', label: 'Priority', required: false, example: 'Normal', options: ['Low', 'Normal', 'High', 'Critical'], defaultValue: 'Normal' },
      { key: 'deliveryMode', label: 'Delivery Mode', required: false, example: 'Banner + Inbox', options: ['Banner', 'Popup', 'Inbox', 'Banner + Inbox', 'Popup + Inbox'], defaultValue: 'Banner + Inbox' },
      { key: 'targetScope', label: 'Target Scope', required: false, example: 'All Users', options: ['All Users', 'Roles', 'Specific Users', 'Locations', 'Roles + Locations'], defaultValue: 'All Users' },
      { key: 'targetRoles', label: 'Target Roles', required: false, example: 'Operations, Admin', hint: 'Comma-separated role names', aliases: ['Roles'] },
      { key: 'targetUsers', label: 'Target Users', required: false, example: 'jdoe, asmith', hint: 'Comma-separated usernames', aliases: ['Users'] },
      { key: 'targetLocations', label: 'Target Locations', required: false, example: 'LOC-001, LOC-002', hint: 'Comma-separated location codes', aliases: ['Locations'] },
      { key: 'displayFrom', label: 'Display From', required: false, example: '2026-01-15T08:00' },
      { key: 'displayUntil', label: 'Display Until', required: false, example: '2026-01-16T08:00' },
      { key: 'requiresAcknowledgement', label: 'Requires Acknowledgement', required: false, example: 'No', options: ['Yes', 'No'], defaultValue: 'No' },
      { key: 'popupEnabled', label: 'Popup Enabled', required: false, example: 'No', options: ['Yes', 'No'], defaultValue: 'No' },
      { key: 'bannerEnabled', label: 'Banner Enabled', required: false, example: 'Yes', options: ['Yes', 'No'], defaultValue: 'Yes' },
      { key: 'autoDismissSeconds', label: 'Auto Dismiss Seconds', required: false, example: '10' },
      { key: 'status', label: 'Status', required: false, example: 'Draft', options: ['Draft', 'Scheduled'], defaultValue: 'Draft' },
    ],
    validateRow: (row) => {
      if (String(row.title ?? '').trim() === '') return 'Title is required'
      if (String(row.message ?? '').trim() === '') return 'Message is required'
      if (row.displayFrom && row.displayUntil && String(row.displayFrom) > String(row.displayUntil)) {
        return 'Display From cannot be later than Display Until'
      }
      const { missing } = buildNotificationPayload(row)
      const problems = Object.entries(missing)
        .filter(([, values]) => values.length > 0)
        .map(([label, values]) => `unknown ${label.toLowerCase()}: ${values.join(', ')}`)
      if (problems.length > 0) return problems.join('; ')
      return null
    },
    onImportRow: async (row) => {
      if (!canCreateSystemNotification) {
        throw new Error('You do not have permission to create system notifications.')
      }
      const { payload } = buildNotificationPayload(row)
      await createSystemNotification(payload)
    },
    onComplete: async () => {
      await loadNotifications()
    },
  }

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

    if (!(editId ? canEditSystemNotification : canCreateSystemNotification)) {
      setErrorMsg(
        `You do not have permission to ${editId ? 'edit' : 'create'} system notifications.`
      )
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
    if (!canEditSystemNotification) {
      setErrorMsg('You do not have permission to edit system notifications.')
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

      {!canWriteSystemNotification && (
        <div className="info-box">
          You have view-only access. Creating a notification needs Create System
          Notification and editing one needs Edit System Notification.
        </div>
      )}

      {canWriteSystemNotification && (
      <>
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
          <button
            type="submit"
            disabled={
              loading ||
              !(editId ? canEditSystemNotification : canCreateSystemNotification)
            }
          >
            {editId ? 'Update Notification' : 'Create Draft'}
          </button>
          <button type="button" onClick={resetForm} disabled={loading}>
            Reset
          </button>
        </div>
      </form>

      {successMsg && (
        <div className="success-box">{successMsg}</div>
      )}
      {errorMsg && (
        <div className="error-box">{errorMsg}</div>
      )}
      </>
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

      <DataTableToolbar
        filters={notificationsFilters}
        columns={notificationsFilters.columns}
        exportFileName="system-notifications-notifications"
        exportTitle="System Notifications"
        module="system-notifications"
        importConfig={importConfig}
        canImport={canCreateSystemNotification}
      />

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
          {visibleNotifications.length === 0 ? (
            <tr>
              <td colSpan="8" className="empty-table">No system notifications found.</td>
            </tr>
          ) : (
            visibleNotifications.map((notification) => (
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
                    {canEditSystemNotification && (
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

      <PaginationControls currentPage={page} totalRows={notificationsFilters.filteredRows.length} onPageChange={setPage} />

      {selectedNotification && (
        <div className="info-box">
          <div className="section-title compact-section-title">
            <h3>Delivery Report - {selectedNotification.notificationNumber}</h3>
            <p>{selectedNotification.title}</p>
          </div>
          <DataTableToolbar
            filters={deliveryRowsFilters}
            columns={deliveryRowsFilters.columns}
            exportFileName="system-notifications-delivery-rows"
            exportTitle="System Notifications"
          />

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
                visibleDeliveryRows.map((receipt) => (
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

          <PaginationControls currentPage={deliveryPage} totalRows={deliveryRowsFilters.filteredRows.length} onPageChange={setDeliveryPage} />
        </div>
      )}
    </div>
  )
}

export default SystemNotificationMaster
