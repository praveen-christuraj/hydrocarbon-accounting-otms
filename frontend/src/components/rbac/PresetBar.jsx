import { useMemo, useState } from 'react'
import FormDialog from '../common/FormDialog'
import Icon from '../common/Icon'
import { usePermissionPresets } from '../../hooks/usePermissionPresets'
import { logUiAction } from '../../utils/actionLogger'
import {
  PRESET_DESCRIPTION_MAX_LENGTH,
  PRESET_NAME_MAX_LENGTH,
  createPreset,
  presetSlots,
} from '../../utils/permissionPresetStore'
import {
  buildStandardPresets,
  namesFromSelection,
  resolvePreset,
  selectionDelta,
  stageSelection,
} from '../../utils/permissionPresets'

const MODULE = 'Role Permission Assignment'

/** Name the current selection so it becomes a reusable preset. */
function SavePresetDialog({ open, count, remaining, onSave, onCancel }) {
  const [form, setForm] = useState({ presetName: '', description: '' })
  const [error, setError] = useState('')

  const handleSubmit = () => {
    try {
      onSave(form)
    } catch (saveError) {
      setError(saveError.message || 'Unable to save the preset')
    }
  }

  return (
    <FormDialog
      open={open}
      title="Save Selection as Preset"
      description={`The ${count} selected permission(s) are saved as a named preset that can be applied to any role. ${remaining} of the preset slots are free.`}
      size="md"
      columns={1}
      submitLabel="Save Preset"
      error={error}
      onDismissError={() => setError('')}
      onSubmit={handleSubmit}
      onCancel={onCancel}
    >
      <div>
        <label htmlFor="save-preset-name">Preset Name</label>
        <input
          id="save-preset-name"
          type="text"
          value={form.presetName}
          onChange={(event) => setForm((current) => ({ ...current, presetName: event.target.value }))}
          maxLength={PRESET_NAME_MAX_LENGTH}
          placeholder="Example: Terminal Operator"
          required
          minLength={2}
        />
      </div>
      <div>
        <label htmlFor="save-preset-description">Description</label>
        <textarea
          id="save-preset-description"
          rows="2"
          maxLength={PRESET_DESCRIPTION_MAX_LENGTH}
          value={form.description}
          onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
          placeholder="Which roles this preset is meant for"
        />
      </div>
    </FormDialog>
  )
}

/**
 * Preset bar of the Assign Permissions pop-up: pick a saved or standard
 * preset, see what it changes, then replace or add to the selection. Nothing
 * is written here – the role is saved with the pop-up's Save Permissions
 * button (audited endpoint). Also stores the current selection as a preset.
 */
function PresetBar({ groups, selection, canAssign, roleName, actorName, onStage, onSaved }) {
  const savedPresets = usePermissionPresets()
  const standardPresets = useMemo(() => buildStandardPresets(groups), [groups])
  const activeSaved = useMemo(
    () =>
      savedPresets
        .filter((preset) => preset.status === 'Active')
        .sort((a, b) => a.presetName.localeCompare(b.presetName)),
    [savedPresets]
  )
  const [presetId, setPresetId] = useState('')
  const [saveOpen, setSaveOpen] = useState(false)
  const [saveKey, setSaveKey] = useState(0)

  const preset = [...activeSaved, ...standardPresets].find((item) => item.id === presetId) || null
  const resolution = useMemo(
    () => (preset ? resolvePreset(preset, groups, canAssign) : null),
    [preset, groups, canAssign]
  )
  const delta = resolution ? selectionDelta(selection, resolution.assignable) : null
  const skipped = resolution
    ? resolution.inactive.length + resolution.unknown.length + resolution.outOfScope.length
    : 0
  const slots = presetSlots()
  const canStage = Boolean(resolution && resolution.assignable.length > 0)

  const stage = (mode) => {
    if (!canStage) return
    onStage(stageSelection(selection, resolution.assignable, mode), {
      message: `Preset “${preset.presetName}” ${mode === 'replace' ? 'replaced' : 'was added to'} the selection for ${roleName}${
        skipped > 0 ? ` (${skipped} permission(s) skipped: inactive, unknown or not held by you)` : ''
      }. Review it, then select Save Permissions.`,
    })
    logUiAction(MODULE, 'Stage Permission Preset', { preset: preset.presetName, roleName, mode })
  }

  const saveSelection = (values) => {
    const created = createPreset(
      {
        presetName: values.presetName,
        description: values.description,
        status: 'Active',
        permissionNames: namesFromSelection(selection, groups),
      },
      actorName
    )
    logUiAction(MODULE, 'Save Selection As Preset', { preset: created.presetName, permissions: created.permissionNames.length })
    setSaveOpen(false)
    setPresetId(created.id)
    onSaved?.(`Preset “${created.presetName}” saved with ${created.permissionNames.length} permission(s).`)
  }

  return (
    <div className="preset-bar">
      <span className="preset-bar-label">
        <Icon name="layers" size={15} />
        Apply a preset
      </span>
      <select
        value={presetId}
        onChange={(event) => setPresetId(event.target.value)}
        aria-label="Permission preset"
        className="preset-bar-select"
      >
        <option value="">Choose a preset…</option>
        {activeSaved.length > 0 && (
          <optgroup label="Saved presets">
            {activeSaved.map((item) => (
              <option key={item.id} value={item.id}>
                {item.presetName} – {item.permissionNames.length} permission(s)
              </option>
            ))}
          </optgroup>
        )}
        {standardPresets.length > 0 && (
          <optgroup label="Standard presets">
            {standardPresets.map((item) => (
              <option key={item.id} value={item.id}>
                {item.presetName} – {item.permissionNames.length} permission(s)
              </option>
            ))}
          </optgroup>
        )}
      </select>
      <button
        type="button"
        className="btn-secondary btn-sm"
        onClick={() => stage('replace')}
        disabled={!canStage}
        title="The selection becomes exactly the preset"
      >
        <Icon name="copy" size={14} />
        Replace selection
      </button>
      <button
        type="button"
        className="btn-secondary btn-sm"
        onClick={() => stage('add')}
        disabled={!canStage}
        title="The preset is added to the selection"
      >
        <Icon name="plus" size={14} />
        Add to selection
      </button>
      <span className="preset-bar-spacer" />
      <button
        type="button"
        className="btn-ghost btn-sm"
        onClick={() => {
          setSaveKey((value) => value + 1)
          setSaveOpen(true)
        }}
        disabled={selection.size === 0 || slots.remaining <= 0}
        title={
          slots.remaining <= 0
            ? `The preset limit of ${slots.limit} is reached – delete a preset in Permission Presets first`
            : 'Save the current selection as a new preset'
        }
      >
        <Icon name="layers" size={14} />
        Save selection as preset
      </button>
      {preset && resolution && (
        <span className="preset-bar-meta" aria-live="polite">
          {resolution.assignable.length} permission(s) · replace adds {delta.adds} and removes {delta.removes} · add
          grants {delta.adds}
          {skipped > 0 ? ` · ${skipped} not available` : ''}
        </span>
      )}

      {saveOpen && (
        <SavePresetDialog
          key={saveKey}
          open
          count={selection.size}
          remaining={slots.remaining}
          onSave={saveSelection}
          onCancel={() => setSaveOpen(false)}
        />
      )}
    </div>
  )
}

export default PresetBar
