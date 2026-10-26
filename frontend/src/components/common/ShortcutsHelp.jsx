import { useEffect } from 'react'
import Modal from './Modal'
import Icon from './Icon'
import { logUiAction } from '../../utils/actionLogger'

/**
 * Page-scoped keyboard-shortcuts help.
 *
 * A fully controlled modal listing the shortcuts that are active on the
 * current page. Triggered by the `?` key (registered by each page through
 * `useKeyboardShortcuts`) or by a "Shortcuts" hint next to the page actions.
 *
 * Per the shared Modal convention (owner rule 10) the dialog is closed only
 * through its Close button - never via Escape or a backdrop click.
 */
export default function ShortcutsHelp({ open, onClose, module, shortcuts = [] }) {
  useEffect(() => {
    if (open) logUiAction(module, 'Open Shortcuts Help')
  }, [open, module])

  if (!open) return null

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title="Keyboard shortcuts"
      description="Press the keys shown below to act without reaching for the mouse. Shortcuts only work on this page."
      footer={
        <button
          type="button"
          className="btn-primary"
          onClick={onClose}
          autoFocus
        >
          Close
        </button>
      }
      className="shortcuts-help-dialog"
    >
      <table>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', width: 170 }}>Shortcut</th>
            <th style={{ textAlign: 'left' }}>Action</th>
          </tr>
        </thead>
        <tbody>
          {shortcuts.map((item) => (
            <tr key={item.key}>
              <td>
                <span className="shortcut-key">{item.label}</span>
              </td>
              <td>{item.action}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="field-hint">
        <Icon name="help" size={13} />{' '}
        &quot;mod&quot; is Ctrl on Windows/Linux and Cmd on macOS. Shortcuts are
        ignored while you are typing inside a field, except shortcuts that use a
        modifier key such as mod+s.
      </p>
    </Modal>
  )
}
