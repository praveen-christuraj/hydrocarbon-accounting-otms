import { useEffect, useId, useMemo, useRef, useState } from 'react'
import Modal from '../common/Modal'
import AlertMessage from '../common/AlertMessage'
import { planRoleApplication } from '../../utils/permissionPresets'

const MODES = [
  {
    value: 'replace',
    label: 'Replace',
    description: "Each selected role ends up with exactly this preset's permissions.",
  },
  {
    value: 'add',
    label: 'Add',
    description: "The preset's permissions are added; nothing the role already has is removed.",
  },
]

function TriStateCheckbox({ checked, indeterminate, disabled, onChange, label }) {
  const ref = useRef(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = Boolean(indeterminate) && !checked
  }, [indeterminate, checked])
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={(event) => onChange(event.target.checked)}
      aria-label={label}
      title={label}
    />
  )
}

/**
 * Apply one preset to one or many roles in replace or add mode.
 *
 * Every role is written through the existing, audited endpoint
 * (POST /role-permissions/{role_id}) by `onApply`, which returns one result
 * per role: { roleId, roleName, ok, added, removed, total, message }.
 * Mounted with a `key` per opening.
 */
function ApplyPresetDialog({ open, preset, resolution, moduleCount, roleRows, rolesAvailable, onApply, onClose }) {
  const modeGroupId = useId()
  const [mode, setMode] = useState('replace')
  const [search, setSearch] = useState('')
  const [selectedIds, setSelectedIds] = useState([])
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState('')
  const [results, setResults] = useState(null)
  const [error, setError] = useState('')
  const [fieldError, setFieldError] = useState('')

  const entries = resolution.assignable
  const blocked = resolution.outOfScope.length > 0
  const skipped = resolution.inactive.length + resolution.unknown.length

  const eligible = useMemo(() => roleRows.filter((row) => !row.lockReason), [roleRows])
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return eligible
    return eligible.filter(
      (row) =>
        String(row.roleName || '').toLowerCase().includes(term) ||
        String(row.description || '').toLowerCase().includes(term)
    )
  }, [eligible, search])

  const listedIds = filtered.map((row) => row.id)
  const listedSelected = listedIds.filter((id) => selectedIds.includes(id)).length

  const toggleRole = (roleId, checked) => {
    setFieldError('')
    setSelectedIds((current) =>
      checked ? (current.includes(roleId) ? current : [...current, roleId]) : current.filter((id) => id !== roleId)
    )
  }

  const toggleListed = (checked) => {
    setFieldError('')
    setSelectedIds((current) =>
      checked ? [...new Set([...current, ...listedIds])] : current.filter((id) => !listedIds.includes(id))
    )
  }

  const submit = async () => {
    if (running || results) return
    if (selectedIds.length === 0) {
      setFieldError('Select at least one role to receive this preset.')
      return
    }
    setRunning(true)
    setError('')
    try {
      const roles = eligible.filter((row) => selectedIds.includes(row.id))
      setResults(await onApply({ mode, roles, onProgress: setProgress }))
    } catch (applyError) {
      setError(applyError.message || 'Unable to apply the preset')
    } finally {
      setRunning(false)
      setProgress('')
    }
  }

  const succeeded = results ? results.filter((item) => item.ok) : []
  const failed = results ? results.filter((item) => !item.ok) : []

  return (
    <Modal
      open={open}
      title={`Apply “${preset.presetName}” to roles`}
      description={`${entries.length} permission(s) across ${moduleCount} module(s). Each role is updated through Role Permission Assignment and recorded in the audit log.`}
      onClose={onClose}
      size="lg"
      footer={
        results ? (
          <button type="button" className="btn-primary" onClick={onClose}>
            Close
          </button>
        ) : (
          <>
            <span className="form-dialog-footer-start">
              {selectedIds.length} role(s) selected
            </span>
            <button type="button" className="btn-secondary" onClick={onClose} disabled={running}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={submit}
              disabled={running || blocked || entries.length === 0 || selectedIds.length === 0}
            >
              {running ? progress || 'Applying…' : `Apply to ${selectedIds.length} Role${selectedIds.length === 1 ? '' : 's'}`}
            </button>
          </>
        )
      }
    >
      <AlertMessage tone="error" message={error} onDismiss={() => setError('')} className="form-dialog-alert" />

      {results ? (
        <>
          {succeeded.length > 0 && (
            <AlertMessage
              tone="success"
              message={`Applied to ${succeeded.length} role(s) in ${mode} mode: +${succeeded.reduce(
                (sum, item) => sum + item.added,
                0
              )} / −${succeeded.reduce((sum, item) => sum + item.removed, 0)} permission grant(s).`}
            />
          )}
          {failed.length > 0 && (
            <AlertMessage tone="error" message={`${failed.length} role(s) could not be updated – see the table below.`} />
          )}
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Role</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {results.map((item) => (
                  <tr key={item.roleId}>
                    <td className="cell-strong">{item.roleName}</td>
                    <td className={item.ok ? '' : 'preset-result-error'}>
                      {item.ok
                        ? `+${item.added} / −${item.removed} – ${item.total} permission(s) now`
                        : item.message}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <>
          {blocked && (
            <AlertMessage
              tone="error"
              message={`This preset contains ${resolution.outOfScope.length} permission(s) you do not hold (${resolution.outOfScope
                .slice(0, 5)
                .join(', ')}${resolution.outOfScope.length > 5 ? ' …' : ''}). You can only grant permissions you have yourself.`}
            />
          )}
          {!blocked && entries.length === 0 && (
            <AlertMessage tone="error" message="None of the permissions of this preset can be granted at the moment." />
          )}
          {skipped > 0 && (
            <AlertMessage
              tone="warning"
              message={`${skipped} permission(s) of this preset are inactive or unknown and will be skipped.`}
            />
          )}
          {mode === 'replace' && (
            <AlertMessage
              tone="warning"
              message="Replace removes every permission of the selected roles that is not in this preset."
            />
          )}

          <span className="field-label" id={modeGroupId}>
            Apply mode
          </span>
          <div className="choice-row preset-mode-row" role="radiogroup" aria-labelledby={modeGroupId}>
            {MODES.map((option) => (
              <label key={option.value} className={`choice-option ${mode === option.value ? 'is-selected' : ''}`}>
                <input
                  type="radio"
                  name="preset-apply-mode"
                  value={option.value}
                  checked={mode === option.value}
                  onChange={() => setMode(option.value)}
                  disabled={running}
                />
                <span className="choice-option-text">
                  <strong>{option.label}</strong>
                  <span>{option.description}</span>
                </span>
              </label>
            ))}
          </div>

          <div className="preset-role-toolbar">
            <span className="field-label">Roles</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search roles"
              aria-label="Search roles"
              disabled={running}
            />
            <span className="preset-role-count">
              {eligible.length} eligible
              {roleRows.length > eligible.length ? ` · ${roleRows.length - eligible.length} locked` : ''}
            </span>
          </div>
          {fieldError && (
            <p className="field-error" role="alert">
              {fieldError}
            </p>
          )}

          {!rolesAvailable ? (
            <AlertMessage tone="info" message="Roles are not available: listing roles requires the View Role permission." />
          ) : eligible.length === 0 ? (
            <AlertMessage
              tone="info"
              message="No role can receive this preset. The Admin role always has every permission; inactive roles and roles holding permissions you do not have are locked."
            />
          ) : (
            <div className="table-scroll preset-role-scroll">
              <table>
                <thead>
                  <tr>
                    <th className="preset-check-col">
                      <TriStateCheckbox
                        checked={listedIds.length > 0 && listedSelected === listedIds.length}
                        indeterminate={listedSelected > 0}
                        disabled={running || listedIds.length === 0}
                        onChange={toggleListed}
                        label="Select every listed role"
                      />
                    </th>
                    <th>Role</th>
                    <th className="num">Permissions now</th>
                    <th className="num">After applying</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="empty-table">
                        No role matches the search.
                      </td>
                    </tr>
                  ) : (
                    filtered.map((row) => {
                      const plan = planRoleApplication({ assigned: row.assigned, entries, mode })
                      const checked = selectedIds.includes(row.id)
                      return (
                        <tr key={row.id} className={checked ? 'is-selected' : ''}>
                          <td className="preset-check-col">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(event) => toggleRole(row.id, event.target.checked)}
                              disabled={running}
                              aria-label={`Apply to ${row.roleName}`}
                            />
                          </td>
                          <td>
                            <strong className="cell-strong">{row.roleName}</strong>
                            {row.description && <div className="muted-table-text">{row.description}</div>}
                          </td>
                          <td className="num">{row.assigned.length}</td>
                          <td className="num">
                            {plan.total}
                            <div className="muted-table-text">
                              +{plan.added} / −{plan.removed}
                            </div>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Modal>
  )
}

export default ApplyPresetDialog
