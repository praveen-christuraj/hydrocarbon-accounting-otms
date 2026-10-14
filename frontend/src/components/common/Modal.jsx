import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import Icon from './Icon'

/**
 * Standard application dialog.
 *
 * Owner rule 10: a pop-up is closed ONLY by its Cancel / Close buttons.
 * Clicking the backdrop or pressing Escape does nothing on purpose – do not
 * "fix" this. The backdrop intentionally has no click handler.
 *
 * Props
 *  - open            boolean
 *  - title           string | node
 *  - description     optional helper text under the title
 *  - onClose         called by the header close button (and Cancel buttons you render)
 *  - footer          node rendered in the footer (usually buttons)
 *  - size            'sm' | 'md' | 'lg' | 'xl'  (default 'md')
 *  - hideCloseButton hide the header close button (when the footer has Cancel)
 *  - closeLabel      aria-label for the header close button
 */
function Modal({
  open,
  title,
  description,
  onClose,
  footer,
  size = 'md',
  hideCloseButton = false,
  closeLabel = 'Close dialog',
  className = '',
  children,
}) {
  const titleId = useId()
  const descriptionId = useId()
  const cardRef = useRef(null)
  const previousFocusRef = useRef(null)

  // Lock body scroll + restore focus when closing.
  useEffect(() => {
    if (!open) return undefined
    previousFocusRef.current = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    // Move focus into the dialog.
    const focusTimer = window.setTimeout(() => {
      const card = cardRef.current
      if (!card) return
      const first = card.querySelector(
        'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]):not([data-modal-close])'
      )
      ;(first || card).focus()
    }, 0)

    return () => {
      window.clearTimeout(focusTimer)
      document.body.style.overflow = previousOverflow
      const previous = previousFocusRef.current
      if (previous && typeof previous.focus === 'function') {
        previous.focus()
      }
    }
  }, [open])

  // Keep keyboard focus inside the dialog (Tab / Shift+Tab). Escape is ignored by design.
  const handleKeyDown = (event) => {
    if (event.key !== 'Tab') return
    const card = cardRef.current
    if (!card) return
    const focusable = Array.from(
      card.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    )
    if (focusable.length === 0) {
      event.preventDefault()
      return
    }
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  if (!open) return null

  return createPortal(
    <div className="app-modal-backdrop" data-no-outside-close="true">
      <div
        ref={cardRef}
        className={`app-modal app-modal-${size} ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        {(title || !hideCloseButton) && (
          <div className="app-modal-header">
            <div className="app-modal-heading">
              {title && (
                <h3 id={titleId} className="app-modal-title">
                  {title}
                </h3>
              )}
              {description && (
                <p id={descriptionId} className="app-modal-description">
                  {description}
                </p>
              )}
            </div>
            {!hideCloseButton && (
              <button
                type="button"
                className="app-modal-close"
                onClick={onClose}
                aria-label={closeLabel}
                data-modal-close="true"
              >
                <Icon name="close" size={18} />
              </button>
            )}
          </div>
        )}

        <div className="app-modal-body">{children}</div>

        {footer && <div className="app-modal-footer">{footer}</div>}
      </div>
    </div>,
    document.body
  )
}

export default Modal
