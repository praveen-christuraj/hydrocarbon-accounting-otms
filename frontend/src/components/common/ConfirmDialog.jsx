import Modal from './Modal'
import Icon from './Icon'

/**
 * Confirmation dialog for destructive or irreversible actions.
 * Built on Modal, so it never closes on outside click (owner rule 10).
 *
 * Props
 *  - open, title, message (string | node), details (optional node)
 *  - confirmLabel (default "Confirm"), cancelLabel (default "Cancel")
 *  - tone: 'danger' | 'primary' | 'warning'  (default 'danger')
 *  - busy: disables buttons and shows busyLabel on the confirm button
 *  - onConfirm, onCancel
 */
function ConfirmDialog({
  open,
  title = 'Please confirm',
  message,
  details,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  busyLabel = 'Please wait…',
  tone = 'danger',
  busy = false,
  onConfirm,
  onCancel,
  children,
}) {
  const iconName =
    tone === 'danger' ? 'alertTriangle' : tone === 'warning' ? 'alertCircle' : 'info'

  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      size="sm"
      hideCloseButton
      className={`confirm-dialog-modal tone-${tone}`}
      footer={
        <>
          <button
            type="button"
            className="btn-secondary"
            onClick={onCancel}
            disabled={busy}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={tone === 'danger' ? 'btn-danger' : 'btn-primary'}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? busyLabel : confirmLabel}
          </button>
        </>
      }
    >
      <div className="confirm-dialog-content">
        <span className={`confirm-dialog-icon tone-${tone}`}>
          <Icon name={iconName} size={20} />
        </span>
        <div>
          {message && <p className="confirm-dialog-message">{message}</p>}
          {details && <div className="confirm-dialog-details">{details}</div>}
          {children}
        </div>
      </div>
    </Modal>
  )
}

export default ConfirmDialog
