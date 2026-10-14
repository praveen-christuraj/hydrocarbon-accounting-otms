import Icon from './Icon'

const ICONS = {
  error: 'alertCircle',
  success: 'checkCircle',
  warning: 'alertTriangle',
  info: 'info',
}

/**
 * Inline alert, rendered right next to the data-entry section or table it
 * concerns (owner rule 8). Use `tone` = error | success | warning | info.
 *
 * Renders nothing when `message` is empty so it can be left in the tree:
 *   <AlertMessage tone="error" message={error} onDismiss={() => setError('')} />
 */
function AlertMessage({
  tone = 'info',
  title,
  message,
  onDismiss,
  className = '',
  children,
  compact = false,
}) {
  if (!message && !children && !title) return null

  const live = tone === 'error' ? 'assertive' : 'polite'

  return (
    <div
      className={`alert-message tone-${tone} ${compact ? 'compact' : ''} ${className}`.trim()}
      role={tone === 'error' ? 'alert' : 'status'}
      aria-live={live}
    >
      <span className="alert-message-icon">
        <Icon name={ICONS[tone] || ICONS.info} size={18} />
      </span>
      <div className="alert-message-body">
        {title && <strong className="alert-message-title">{title}</strong>}
        {message && <div className="alert-message-text">{message}</div>}
        {children}
      </div>
      {onDismiss && (
        <button
          type="button"
          className="alert-message-dismiss"
          onClick={onDismiss}
          aria-label="Dismiss message"
        >
          <Icon name="close" size={16} />
        </button>
      )}
    </div>
  )
}

export default AlertMessage
