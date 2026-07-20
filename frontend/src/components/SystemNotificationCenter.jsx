import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  acknowledgeSystemNotification,
  dismissSystemNotification,
  getActiveSystemNotifications,
  getMySystemNotifications,
} from '../api/systemNotificationApi'

function SystemNotificationCenter({ loggedInUser }) {
  const [activeNotifications, setActiveNotifications] = useState([])
  const [inboxNotifications, setInboxNotifications] = useState([])
  const [showInbox, setShowInbox] = useState(false)
  const [ackRemarksById, setAckRemarksById] = useState({})
  const [loading, setLoading] = useState(false)

  const loadNotifications = async () => {
    if (!loggedInUser) return
    try {
      setLoading(true)
      const [active, inbox] = await Promise.all([
        getActiveSystemNotifications(),
        getMySystemNotifications(),
      ])
      setActiveNotifications(active)
      setInboxNotifications(inbox)
    } catch (error) {
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadNotifications()
    const intervalId = window.setInterval(loadNotifications, 60000)
    return () => window.clearInterval(intervalId)
  }, [loggedInUser?.id])

  const unreadCount = useMemo(() => {
    return inboxNotifications.filter((item) => {
      return !['Dismissed', 'Acknowledged'].includes(item.receiptStatus)
    }).length
  }, [inboxNotifications])

  const canViewTaskManager = useMemo(() => {
    const username = String(loggedInUser?.username || '').toLowerCase()
    const isAdmin =
      username === 'admin' ||
      (loggedInUser?.roles || []).some(
        (role) =>
          String(role?.role_name || role?.roleName || '').toLowerCase() ===
          'admin'
      ) ||
      String(loggedInUser?.role_name || loggedInUser?.roleName || '').toLowerCase() ===
        'admin'

    if (isAdmin) return true

    return (loggedInUser?.permissions || []).some((permission) => {
      return permission.permissionName === 'View My Tasks'
    })
  }, [loggedInUser])

  const visibleBanners = activeNotifications.filter((item) => {
    return item.bannerEnabled && item.deliveryMode.includes('Banner')
  })

  const popupNotification = activeNotifications.find((item) => {
    return item.popupEnabled && item.deliveryMode.includes('Popup')
  })

  const runDismiss = async (notificationId) => {
    try {
      await dismissSystemNotification(notificationId)
      await loadNotifications()
    } catch (error) {
      alert(error.message)
    }
  }

  const runAcknowledge = async (notificationId) => {
    try {
      await acknowledgeSystemNotification(
        notificationId,
        ackRemarksById[notificationId] || ''
      )
      setAckRemarksById((current) => ({
        ...current,
        [notificationId]: '',
      }))
      await loadNotifications()
    } catch (error) {
      alert(error.message)
    }
  }

  const renderNotificationActions = (notification) => {
    if (notification.acknowledgedAt) {
      return <span className="muted-table-text">Acknowledged</span>
    }

    if (notification.requiresAcknowledgement) {
      return (
        <div className="notification-action-row">
          <input
            value={ackRemarksById[notification.id] || ''}
            onChange={(event) =>
              setAckRemarksById((current) => ({
                ...current,
                [notification.id]: event.target.value,
              }))
            }
            placeholder="Acknowledgement remarks (optional)"
          />
          <button type="button" onClick={() => runAcknowledge(notification.id)}>
            Acknowledge
          </button>
        </div>
      )
    }

    return (
      <div className="notification-action-row">
        <button type="button" onClick={() => runDismiss(notification.id)}>
          Dismiss
        </button>
      </div>
    )
  }

  return (
    <div className="system-notification-shell">
      <div className="notification-topline no-print">
        {canViewTaskManager && (
          <Link className="notification-task-button" to="/operation-tasks">
            Task Manager
          </Link>
        )}
        <button
          type="button"
          className="notification-bell-button"
          onClick={() => setShowInbox((current) => !current)}
          disabled={loading}
        >
          Notifications
          {unreadCount > 0 && <span>{unreadCount}</span>}
        </button>
      </div>

      {visibleBanners.map((notification) => (
        <div
          key={notification.id}
          className={`system-notification-banner ${notification.notificationType.toLowerCase()} ${notification.priority.toLowerCase()}`}
        >
          <div>
            <strong>{notification.title}</strong>
            <p>{notification.message}</p>
            <small>
              {notification.notificationNumber} | {notification.priority}
            </small>
          </div>
          {renderNotificationActions(notification)}
        </div>
      ))}

      {popupNotification && (
        <div className="notification-popup-backdrop no-print">
          <div className="notification-popup-card">
            <div className="section-title compact-section-title">
              <h3>{popupNotification.title}</h3>
              <p>{popupNotification.notificationType} notification</p>
            </div>
            <p>{popupNotification.message}</p>
            {renderNotificationActions(popupNotification)}
          </div>
        </div>
      )}

      {showInbox && (
        <div className="notification-inbox-panel no-print">
          <div className="notification-inbox-header">
            <h3>Notification Inbox</h3>
            <div className="notification-inbox-header-actions">
              {canViewTaskManager && (
                <Link to="/operation-tasks" onClick={() => setShowInbox(false)}>
                  Task Manager
                </Link>
              )}
              <button type="button" onClick={() => setShowInbox(false)}>
                Close
              </button>
            </div>
          </div>

          {inboxNotifications.length === 0 ? (
            <div className="empty-table">No notifications available.</div>
          ) : (
            inboxNotifications.map((notification) => (
              <div key={notification.id} className="notification-inbox-item">
                <div>
                  <strong>{notification.title}</strong>
                  <p>{notification.message}</p>
                  <small>
                    {notification.notificationNumber} | {notification.priority} |{' '}
                    {notification.receiptStatus || notification.status}
                  </small>
                </div>
                {renderNotificationActions(notification)}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

export default SystemNotificationCenter
