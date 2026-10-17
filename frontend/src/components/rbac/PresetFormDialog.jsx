import { useId, useMemo, useState } from 'react'
import Modal from '../common/Modal'
import AlertMessage from '../common/AlertMessage'
import PermissionMatrix from './PermissionMatrix'
import {
  PRESET_DESCRIPTION_MAX_LENGTH,
  PRESET_NAME_MAX_LENGTH,
  PRESET_NAME_MIN_LENGTH,
} from '../../utils/permissionPresetStore'
import { namesFromSelection, resolvePreset } from '../../utils/permissionPresets'

const key = (value) => String(value || '').trim().toLowerCase()

/**
 * Create / edit a saved permission preset: name, status, description and the
 * permissions, picked in the same module × action matrix as Role Permission
 * Assignment. "Load permissions from" copies a role's current grants or
 * another preset into the picker. The matrix stays outside the <form> (the
 * global `form div` rule would stack its toolbar), so the footer button
 * submits the form through its `form` attribute.
 *
 * Mounted with a `key` per opening. onSubmit(values) may throw – the message
 * is shown inside the dialog, which only closes through Cancel or a save.
 */
function PresetFormDialog({
  open,
  preset,
  initialNames,
  groups,
  roleRows,
  sources,
  canAssign,
  busy,
  error,
  onDismissError,
  onSubmit,
  onCancel,
}) {
  const formId = useId()
  const isEdit = Boolean(preset)
  const [form, setForm] = useState(() => ({
    presetName: preset?.presetName || '',
    description: preset?.description || '',
    status: preset?.status || 'Active',
  }))
  const [selection, setSelection] = useState(
    () => new Set((preset?.permissionNames || initialNames || []).map(key).filter(Boolean))
  )
  const [source, setSource] = useState('')
  const [notice, setNotice] = useState('')
  const [errors, setErrors] = useState({})

  const unavailable = useMemo(() => {
    const resolution = resolvePreset({ permissionNames: [...selection] }, groups, canAssign)
    return [...resolution.inactive, ...resolution.unknown, ...resolution.outOfScope]
  }, [selection, groups, canAssign])

  const setField = (name, value) => {
    setForm((current) => ({ ...current, [name]: value }))
    if (errors[name]) setErrors((current) => ({ ...current, [name]: '' }))
  }

  const loadFrom = (value) => {
    setSource(value)
    setNotice('')
    if (!value) return
    const [kind, id] = value.split('|')
    const role = kind === 'role' ? roleRows.find((row) => String(row.id) === id) : null
    const item = kind === 'role' ? null : sources.find((candidate) => candidate.id === id)
    const label = role ? `role ${role.roleName}` : item ? `preset “${item.presetName}”` : 'the selection'
    const names = role
      ? role.assigned.map((permission) => permission.permissionName)
      : item?.permissionNames || []
    const resolution = resolvePreset({ permissionNames: names }, groups, canAssign)
    setSelection(new Set(resolution.assignable.map((entry) => key(entry.permissionName))))
    if (errors.permissions) setErrors((current) => ({ ...current, permissions: '' }))
    const skipped = resolution.inactive.length + resolution.unknown.length + resolution.outOfScope.length
    setNotice(
      `Loaded ${resolution.assignable.length} permission(s) from ${label}.` +
        (skipped > 0 ? ` ${skipped} could not be added (inactive, unknown or not held by you).` : '')
    )
  }

  const removeUnavailable = () => {
    const drop = new Set(unavailable.map(key))
    setSelection((current) => new Set([...current].filter((name) => !drop.has(name))))
  }

  const handleSubmit = (event) => {
    event.preventDefault()
    if (busy) return
    const next = {}
    const name = form.presetName.trim()
    if (name.length < PRESET_NAME_MIN_LENGTH) next.presetName = `Enter at least ${PRESET_NAME_MIN_LENGTH} characters`
    if (selection.size === 0) {
      next.permissions = 'Select at least one permission – an empty preset could remove every permission of a role.'
    }
    setErrors(next)
    if (Object.keys(next).length > 0) return
    onSubmit({
      presetName: name,
      description: form.description.trim(),
      status: form.status,
      permissionNames: namesFromSelection(selection, groups),
    })
  }

  const savedSources = sources.filter((item) => item.type !== 'Standard' && item.id !== preset?.id)
  const standardSources = sources.filter((item) => item.type === 'Standard')
  const roleSources = roleRows.filter((row) => row.assigned.length > 0)

  return (
    <Modal
      open={open}
      title={isEdit ? `Edit Preset – ${preset.presetName}` : 'New Permission Preset'}
      description="Name a reusable set of permissions, then apply it to any number of roles instead of ticking permissions one by one."
      onClose={onCancel}
      size="xl"
      footer={
        <>
          <span className="form-dialog-footer-start">{selection.size} permission(s) selected</span>
          <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="submit" form={formId} className="btn-primary" disabled={busy}>
            {busy ? 'Saving…' : isEdit ? 'Update Preset' : 'Save Preset'}
          </button>
        </>
      }
    >
      <AlertMessage tone="error" message={error} onDismiss={onDismissError} className="form-dialog-alert" />
      <AlertMessage tone="success" message={notice} onDismiss={() => setNotice('')} />

      <form id={formId} className="dialog-form dialog-form-cols-2" onSubmit={handleSubmit}>
        <div>
          <label htmlFor="preset-name">Preset Name</label>
          <input
            id="preset-name"
            type="text"
            value={form.presetName}
            onChange={(event) => setField('presetName', event.target.value)}
            maxLength={PRESET_NAME_MAX_LENGTH}
            placeholder="Example: Terminal Operator"
            disabled={busy}
            aria-invalid={errors.presetName ? 'true' : undefined}
            className={errors.presetName ? 'input-error' : ''}
          />
          {errors.presetName ? (
            <span className="field-error">{errors.presetName}</span>
          ) : (
            <span className="field-hint">Shown in the preset lists of both pages.</span>
          )}
        </div>

        <div>
          <label htmlFor="preset-status">Status</label>
          <select
            id="preset-status"
            value={form.status}
            onChange={(event) => setField('status', event.target.value)}
            disabled={busy}
          >
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
          </select>
          <span className="field-hint">Only active presets can be applied to roles.</span>
        </div>

        <div className="full-width-field">
          <label htmlFor="preset-description">Description</label>
          <textarea
            id="preset-description"
            rows="2"
            maxLength={PRESET_DESCRIPTION_MAX_LENGTH}
            value={form.description}
            onChange={(event) => setField('description', event.target.value)}
            placeholder="What this preset is for and which roles usually receive it"
            disabled={busy}
          />
        </div>

        <div className="full-width-field">
          <label htmlFor="preset-source">Load permissions from</label>
          <select id="preset-source" value={source} onChange={(event) => loadFrom(event.target.value)} disabled={busy}>
            <option value="">Keep the current selection</option>
            {roleSources.length > 0 && (
              <optgroup label="Roles (current permissions)">
                {roleSources.map((row) => (
                  <option key={`role-${row.id}`} value={`role|${row.id}`}>
                    {row.roleName} – {row.assigned.length} permission(s)
                  </option>
                ))}
              </optgroup>
            )}
            {savedSources.length > 0 && (
              <optgroup label="Saved presets">
                {savedSources.map((item) => (
                  <option key={item.id} value={`preset|${item.id}`}>
                    {item.presetName} – {item.permissionNames.length} permission(s)
                  </option>
                ))}
              </optgroup>
            )}
            {standardSources.length > 0 && (
              <optgroup label="Standard presets">
                {standardSources.map((item) => (
                  <option key={item.id} value={`preset|${item.id}`}>
                    {item.presetName} – {item.permissionNames.length} permission(s)
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          <span className="field-hint">Replaces the selection below with that role&apos;s or preset&apos;s permissions.</span>
        </div>
      </form>

      {errors.permissions && (
        <p className="field-error preset-field-error" role="alert">
          {errors.permissions}
        </p>
      )}
      {unavailable.length > 0 && (
        <AlertMessage tone="warning">
          <span>
            {unavailable.length} permission(s) in this preset cannot be granted at the moment (inactive, unknown or
            not held by you): {unavailable.slice(0, 6).join(', ')}
            {unavailable.length > 6 ? ` and ${unavailable.length - 6} more` : ''}. They are skipped when the preset is
            applied.
          </span>
          <button type="button" className="btn-secondary btn-sm preset-inline-action" onClick={removeUnavailable} disabled={busy}>
            Remove them
          </button>
        </AlertMessage>
      )}

      <PermissionMatrix
        groups={groups}
        selected={selection}
        onChange={(next) => {
          setSelection(next)
          if (errors.permissions) setErrors((current) => ({ ...current, permissions: '' }))
        }}
        editable
        canAssign={canAssign}
      />
    </Modal>
  )
}

export default PresetFormDialog
