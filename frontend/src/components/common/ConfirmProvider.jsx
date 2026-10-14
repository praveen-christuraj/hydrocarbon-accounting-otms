import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import ConfirmDialog from './ConfirmDialog'
import { logUiAction } from '../../utils/actionLogger'

const ConfirmContext = createContext(null)

/**
 * Promise-based confirmation dialog (replaces window.confirm – owner rule 8).
 *
 *   const confirm = useConfirm()
 *   if (!(await confirm({ title: 'Delete location', message: 'Delete LOC001?', tone: 'danger', confirmLabel: 'Delete' }))) return
 *
 * The dialog closes only through its buttons (owner rule 10).
 */
export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null)
  const resolverRef = useRef(null)

  const confirm = useCallback((options) => {
    const normalised =
      typeof options === 'string' ? { message: options } : { ...(options || {}) }
    return new Promise((resolve) => {
      // Settle any pending dialog as cancelled.
      if (resolverRef.current) resolverRef.current(false)
      resolverRef.current = resolve
      setState({
        title: normalised.title || 'Please confirm',
        message: normalised.message || 'Are you sure?',
        details: normalised.details,
        confirmLabel: normalised.confirmLabel || 'Confirm',
        cancelLabel: normalised.cancelLabel || 'Cancel',
        tone: normalised.tone || 'primary',
        module: normalised.module,
      })
    })
  }, [])

  const settle = (result) => {
    if (state && state.module) {
      logUiAction(state.module, result ? 'Confirm' : 'Cancel Confirmation', {
        title: state.title,
      })
    }
    const resolve = resolverRef.current
    resolverRef.current = null
    setState(null)
    if (resolve) resolve(result)
  }

  const value = useMemo(() => confirm, [confirm])

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <ConfirmDialog
        open={Boolean(state)}
        title={state?.title}
        message={state?.message}
        details={state?.details}
        confirmLabel={state?.confirmLabel}
        cancelLabel={state?.cancelLabel}
        tone={state?.tone}
        onConfirm={() => settle(true)}
        onCancel={() => settle(false)}
      />
    </ConfirmContext.Provider>
  )
}

const fallbackConfirm = async () => {
  console.warn('useConfirm used outside ConfirmProvider – resolving false')
  return false
}

export const useConfirm = () => useContext(ConfirmContext) || fallbackConfirm
