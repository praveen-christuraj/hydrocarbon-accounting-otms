import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react'
import Icon from './Icon'

/**
 * Non-blocking pop-up notices (top-right). Replacement for window.alert.
 *
 *   const toast = useToast()
 *   toast.error('Unable to load users from backend')
 *   toast.success('User saved')
 *   toast.info('Export started', { title: 'Locations' })
 *
 * Errors stay until dismissed; other tones auto-dismiss after 5 s.
 */

const ToastContext = createContext(null)

const ICONS = {
  error: 'alertCircle',
  success: 'checkCircle',
  warning: 'alertTriangle',
  info: 'info',
}

let counter = 0

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const timers = useRef(new Map())

  const dismiss = useCallback((id) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
    const timer = timers.current.get(id)
    if (timer) {
      window.clearTimeout(timer)
      timers.current.delete(id)
    }
  }, [])

  const push = useCallback(
    (tone, message, options = {}) => {
      if (!message) return null
      counter += 1
      const id = `toast-${counter}`
      const duration =
        options.duration !== undefined
          ? options.duration
          : tone === 'error'
            ? 0
            : 5000
      setToasts((current) => [
        ...current.slice(-4),
        { id, tone, message: String(message), title: options.title },
      ])
      if (duration > 0) {
        timers.current.set(
          id,
          window.setTimeout(() => dismiss(id), duration)
        )
      }
      return id
    },
    [dismiss]
  )

  const api = useMemo(
    () => ({
      show: push,
      error: (message, options) => push('error', message, options),
      success: (message, options) => push('success', message, options),
      warning: (message, options) => push('warning', message, options),
      info: (message, options) => push('info', message, options),
      dismiss,
    }),
    [push, dismiss]
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-viewport" aria-live="polite" aria-atomic="false">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`toast tone-${toast.tone}`}
            role={toast.tone === 'error' ? 'alert' : 'status'}
          >
            <span className="toast-icon">
              <Icon name={ICONS[toast.tone] || 'info'} size={18} />
            </span>
            <div className="toast-body">
              {toast.title && <strong className="toast-title">{toast.title}</strong>}
              <div className="toast-text">{toast.message}</div>
            </div>
            <button
              type="button"
              className="toast-dismiss"
              onClick={() => dismiss(toast.id)}
              aria-label="Dismiss notification"
            >
              <Icon name="close" size={16} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

const fallbackToast = {
  show: (tone, message) => console.warn(`[toast:${tone}]`, message),
  error: (message) => console.error('[toast:error]', message),
  success: (message) => console.info('[toast:success]', message),
  warning: (message) => console.warn('[toast:warning]', message),
  info: (message) => console.info('[toast:info]', message),
  dismiss: () => {},
}

export const useToast = () => useContext(ToastContext) || fallbackToast
