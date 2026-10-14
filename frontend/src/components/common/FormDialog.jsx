import { useId } from 'react'
import Modal from './Modal'
import AlertMessage from './AlertMessage'

/**
 * Create / edit form shown as a pop-up dialog (owner rule 10).
 *
 * Built on Modal, so it closes only through Cancel or the header close button –
 * never on backdrop click or Escape. The submit button lives in the dialog
 * footer and is wired to the form with the HTML `form` attribute, so Enter in
 * a field and the footer button both submit.
 *
 *   <FormDialog
 *     open={formOpen}
 *     title={editId ? 'Edit Location' : 'New Location'}
 *     submitLabel={editId ? 'Update Location' : 'Save Location'}
 *     busy={loading}
 *     error={error}
 *     onDismissError={() => setError('')}
 *     onSubmit={handleSubmit}
 *     onCancel={closeForm}
 *   >
 *     <div><label>Location Name</label><input … /></div>
 *   </FormDialog>
 *
 * Props
 *  - size            'sm' | 'md' | 'lg' | 'xl' (default 'md')
 *  - columns         1 | 2 | 3 – field grid columns (default 2)
 *  - submitDisabled  disable the submit button (in addition to busy)
 *  - hideSubmit      read-only dialogs (only the Close button is shown)
 *  - footerStart     extra node rendered at the left of the footer
 *  - formClassName   extra class names for the <form>
 */
function FormDialog({
  open,
  title,
  description,
  size = 'md',
  columns = 2,
  onCancel,
  onSubmit,
  submitLabel = 'Save',
  busy = false,
  busyLabel = 'Saving…',
  submitDisabled = false,
  hideSubmit = false,
  cancelLabel,
  error,
  onDismissError,
  footerStart,
  formClassName = '',
  children,
}) {
  const formId = useId()

  const handleSubmit = (event) => {
    event.preventDefault()
    if (busy || submitDisabled || hideSubmit) return
    onSubmit?.(event)
  }

  return (
    <Modal
      open={open}
      title={title}
      description={description}
      onClose={onCancel}
      size={size}
      className="form-dialog"
      footer={
        <>
          {footerStart && <div className="form-dialog-footer-start">{footerStart}</div>}
          <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>
            {cancelLabel || (hideSubmit ? 'Close' : 'Cancel')}
          </button>
          {!hideSubmit && (
            <button
              type="submit"
              form={formId}
              className="btn-primary"
              disabled={busy || submitDisabled}
            >
              {busy ? busyLabel : submitLabel}
            </button>
          )}
        </>
      }
    >
      <AlertMessage tone="error" message={error} onDismiss={onDismissError} className="form-dialog-alert" />
      <form
        id={formId}
        onSubmit={handleSubmit}
        className={`dialog-form dialog-form-cols-${columns} ${formClassName}`.trim()}
        noValidate={false}
      >
        {children}
      </form>
    </Modal>
  )
}

export default FormDialog
