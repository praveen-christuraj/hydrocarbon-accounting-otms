import { useCallback, useState } from 'react'
import { useToast } from '../components/common/Toast'

/**
 * Action feedback for pages with action buttons (owner rule 8: alerts live
 * next to the section they concern, or as pop-ups - never at the far bottom
 * of a page).
 *
 * `notifySuccess` / `notifyError`
 *   - show the message as a little pop-up (toast, top-right, above dialogs),
 *   - and keep it in state so the page can ALSO render it right next to the
 *     action button with <AlertMessage>.
 *
 * Success toasts auto-dismiss after a few seconds; error toasts stay until
 * the user closes them, so system-validation messages are never missed.
 *
 *   const feedback = useActionFeedback()
 *   ...
 *   feedback.notifySuccess('Operation Entry saved successfully')
 *   feedback.notifyError(error.message)
 *
 *   <AlertMessage tone="error" message={feedback.errorMsg} onDismiss={feedback.clearError} />
 */
export default function useActionFeedback(options = {}) {
  const { successToast = true, errorToast = true } = options
  const toast = useToast()

  const [successMsg, setSuccessMsg] = useState('')
  const [errorMsg, setErrorMsg] = useState('')

  const notifySuccess = useCallback(
    (message, notifyOptions = {}) => {
      const text = String(message ?? '').trim()
      if (!text) return

      setSuccessMsg(text)
      setErrorMsg('')

      const showToast = notifyOptions.toast !== undefined ? notifyOptions.toast : successToast
      if (showToast) {
        toast.success(text, notifyOptions.title ? { title: notifyOptions.title } : undefined)
      }
    },
    [toast, successToast]
  )

  const notifyError = useCallback(
    (message, notifyOptions = {}) => {
      const text = String(message ?? '').trim()
      if (!text) return

      setErrorMsg(text)
      setSuccessMsg('')

      const showToast = notifyOptions.toast !== undefined ? notifyOptions.toast : errorToast
      if (showToast) {
        toast.error(text, notifyOptions.title ? { title: notifyOptions.title } : undefined)
      }
    },
    [toast, errorToast]
  )

  const clearSuccess = useCallback(() => setSuccessMsg(''), [])
  const clearError = useCallback(() => setErrorMsg(''), [])
  const clear = useCallback(() => {
    setSuccessMsg('')
    setErrorMsg('')
  }, [])

  return {
    successMsg,
    errorMsg,
    notifySuccess,
    notifyError,
    clearSuccess,
    clearError,
    clear,
  }
}
