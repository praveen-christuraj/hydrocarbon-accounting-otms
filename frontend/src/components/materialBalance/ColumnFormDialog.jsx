import { useEffect, useId, useMemo, useRef, useState } from 'react'
import FormDialog from '../common/FormDialog'
import AlertMessage from '../common/AlertMessage'
import Icon from '../common/Icon'
import {
  COLUMN_TYPES,
  COLUMN_TYPE_INFO,
  DIRECTION_INFO,
  MOVEMENT_DIRECTIONS,
  TREATMENTS,
  TREATMENT_INFO,
  classifyTreatment,
  currentInsertIndex,
  describeColumnRole,
  emptyColumn,
  flagsForTreatment,
  normalizeColumnKey,
  normalizeOperationCode,
  sortColumns,
  suggestColumnKey,
  suggestInsertIndex,
} from '../../utils/materialBalanceTemplate'

const splitCodes = (value) =>
  String(value || '')
    .split(/[,;]/)
    .map((code) => code.trim())
    .filter(Boolean)

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
 * Add / edit one column of a Material Balance Template.
 *
 * Fields follow the order in which the user decides: what the column is
 * called, what it shows, which Tank Operations feed it and how it treats
 * Book Closing, then where it sits in the report. Validation mirrors the
 * backend (material_balance_templates.py). Mounted with a `key` per opening.
 *
 * onSubmit({ column, targetIndex, positionChanged })
 */
function ColumnFormDialog({
  open,
  column,
  template,
  columns,
  operations,
  operationsLoading,
  operationsError,
  busy,
  error,
  onDismissError,
  onSubmit,
  onCancel,
}) {
  const typeGroupId = useId()
  const directionGroupId = useId()
  const treatmentGroupId = useId()
  const operationsLabelId = useId()
  const isNew = column?.id == null

  const others = useMemo(
    () => sortColumns((columns || []).filter((item) => isNew || item.id !== column.id)),
    [columns, column, isNew]
  )

  const [form, setForm] = useState(() => ({
    ...emptyColumn(),
    ...(column || {}),
    movementDirection: column?.movementDirection || (column?.columnType && column.columnType !== 'MOVEMENT' ? '' : 'IN'),
    mappedOperationCodes: [...(column?.mappedOperationCodes || [])],
    excludedOperationCodes: [...(column?.excludedOperationCodes || [])],
  }))
  // New columns derive their key from the label; saved keys are kept unless reset.
  const [keyMode, setKeyMode] = useState(() => (isNew && !column?.columnKey ? 'auto' : 'manual'))
  // Position = index among the other columns ("after the n-th column").
  const [initialIndex] = useState(() =>
    isNew
      ? suggestInsertIndex(others, { ...emptyColumn(), ...(column || {}) })
      : currentInsertIndex(columns || [], column)
  )
  const [position, setPosition] = useState(initialIndex)
  const [positionTouched, setPositionTouched] = useState(false)
  const [errors, setErrors] = useState({})
  const [manualCodes, setManualCodes] = useState(() => ({
    mapped: (column?.mappedOperationCodes || []).join(', '),
    excluded: (column?.excludedOperationCodes || []).join(', '),
  }))

  const isMovement = form.columnType === 'MOVEMENT'
  const direction = String(form.movementDirection || '').toUpperCase()
  const treatment = classifyTreatment(form)
  const storedKey = normalizeColumnKey(form.columnKey || form.columnLabel)

  const directionOperations = useMemo(
    () =>
      (operations || []).filter(
        (operation) => String(operation.operationSign || '').toUpperCase() === direction
      ),
    [operations, direction]
  )
  const listedCodes = useMemo(
    () => new Set(directionOperations.map((operation) => normalizeOperationCode(operation.operationCode))),
    [directionOperations]
  )
  const useManualCodes = !operationsLoading && (!Array.isArray(operations) || operations.length === 0)

  const has = (list, code) => list.some((item) => normalizeOperationCode(item) === normalizeOperationCode(code))
  const orphanCodes = useMemo(() => {
    if (useManualCodes) return []
    const codes = new Set()
    ;[...form.mappedOperationCodes, ...form.excludedOperationCodes].forEach((code) => {
      if (!listedCodes.has(normalizeOperationCode(code))) codes.add(code)
    })
    return [...codes]
  }, [form.mappedOperationCodes, form.excludedOperationCodes, listedCodes, useManualCodes])

  const clearError = (name) => {
    if (errors[name]) setErrors((current) => ({ ...current, [name]: '' }))
  }

  const update = (patch) => {
    const next = { ...form, ...patch }
    setForm(next)
    // Until the user picks a position, a new column follows its type / direction.
    if (!positionTouched && isNew && ('columnType' in patch || 'movementDirection' in patch)) {
      setPosition(suggestInsertIndex(others, next))
    }
  }

  const handleLabelChange = (value) => {
    update({ columnLabel: value, ...(keyMode === 'auto' ? { columnKey: suggestColumnKey(value) } : {}) })
    clearError('columnLabel')
    if (keyMode === 'auto') clearError('columnKey')
  }

  const handleKeyChange = (value) => {
    setKeyMode('manual')
    update({ columnKey: value })
    clearError('columnKey')
  }

  const resetKey = () => {
    setKeyMode('auto')
    update({ columnKey: suggestColumnKey(form.columnLabel) })
    clearError('columnKey')
  }

  const handleTypeChange = (type) => {
    const patch = { columnType: type }
    if (type === 'MOVEMENT' && !form.movementDirection) patch.movementDirection = 'IN'
    update(patch)
    clearError('mappedOperationCodes')
  }

  const handleDirectionChange = (value) => {
    // Operations are listed by sign, so codes of the previous direction no longer apply.
    const keep = (code) => !(operations || []).some(
      (operation) =>
        normalizeOperationCode(operation.operationCode) === normalizeOperationCode(code) &&
        String(operation.operationSign || '').toUpperCase() !== value
    )
    update({
      movementDirection: value,
      mappedOperationCodes: form.mappedOperationCodes.filter(keep),
      excludedOperationCodes: form.excludedOperationCodes.filter(keep),
    })
    clearError('mappedOperationCodes')
  }

  const toggleCode = (listName, code, checked) => {
    const list = form[listName]
    const next = checked
      ? has(list, code)
        ? list
        : [...list, code]
      : list.filter((item) => normalizeOperationCode(item) !== normalizeOperationCode(code))
    update({ [listName]: next })
    if (listName === 'mappedOperationCodes') clearError('mappedOperationCodes')
  }

  const setAllMapped = (checked) => {
    const codes = directionOperations.map((operation) => operation.operationCode)
    const kept = form.mappedOperationCodes.filter((code) => !listedCodes.has(normalizeOperationCode(code)))
    update({ mappedOperationCodes: checked ? [...kept, ...codes] : kept })
    clearError('mappedOperationCodes')
  }

  const removeOrphan = (code) => {
    update({
      mappedOperationCodes: form.mappedOperationCodes.filter((item) => item !== code),
      excludedOperationCodes: form.excludedOperationCodes.filter((item) => item !== code),
    })
  }

  const mappedListed = directionOperations.filter((operation) => has(form.mappedOperationCodes, operation.operationCode))

  const validate = (candidate) => {
    const next = {}
    if (!candidate.columnLabel.trim()) next.columnLabel = 'Column Label is required'
    const key = normalizeColumnKey(candidate.columnKey || candidate.columnLabel)
    if (!key) next.columnKey = 'Column Key is required'
    else if (others.some((item) => normalizeColumnKey(item.columnKey) === key)) {
      next.columnKey = 'Column Key already exists in this template'
    }
    if (candidate.columnType === 'MOVEMENT') {
      if (!candidate.movementDirection) next.movementDirection = 'Movement Direction is required'
      if (candidate.mappedOperationCodes.length === 0) {
        next.mappedOperationCodes = 'Select at least one Tank Operation for a movement column'
      }
    }
    setErrors(next)
    return Object.keys(next).length === 0
  }

  const handleSubmit = () => {
    const mapped = useManualCodes ? splitCodes(manualCodes.mapped) : form.mappedOperationCodes
    const excluded = useManualCodes ? splitCodes(manualCodes.excluded) : form.excludedOperationCodes
    const candidate = {
      ...form,
      columnLabel: form.columnLabel.trim(),
      columnKey: normalizeColumnKey(form.columnKey || form.columnLabel),
      movementDirection: isMovement ? form.movementDirection : '',
      mappedOperationCodes: isMovement ? mapped : [],
      excludedOperationCodes: isMovement ? excluded : [],
    }
    if (!validate(candidate)) return
    onSubmit({ column: candidate, targetIndex: Number(position), positionChanged: Number(position) !== initialIndex })
  }

  const role = describeColumnRole(form)

  return (
    <FormDialog
      open={open}
      title={isNew ? 'Add Column' : `Edit Column – ${column.columnLabel}`}
      description={`${template?.templateName || ''} (${template?.locationCode || ''})`}
      size="lg"
      columns={2}
      submitLabel={isNew ? 'Add Column' : 'Update Column'}
      busy={busy}
      error={error}
      onDismissError={onDismissError}
      onSubmit={handleSubmit}
      onCancel={onCancel}
      footerStart={<span>In the report: {role.label}</span>}
    >
      <h4 className="dialog-section-title">Column</h4>

      <div>
        <label htmlFor="mb-column-label">Column Label</label>
        <input
          id="mb-column-label"
          type="text"
          value={form.columnLabel}
          onChange={(event) => handleLabelChange(event.target.value)}
          placeholder="Example: Receipt from X"
          disabled={busy}
          aria-invalid={errors.columnLabel ? 'true' : undefined}
          className={errors.columnLabel ? 'input-error' : ''}
        />
        {errors.columnLabel && <span className="field-error">{errors.columnLabel}</span>}
      </div>

      <div>
        <label htmlFor="mb-column-key">Column Key</label>
        <input
          id="mb-column-key"
          type="text"
          value={form.columnKey}
          onChange={(event) => handleKeyChange(event.target.value)}
          placeholder="Created from the label"
          disabled={busy}
          aria-invalid={errors.columnKey ? 'true' : undefined}
          className={errors.columnKey ? 'input-error' : ''}
        />
        {errors.columnKey ? (
          <span className="field-error">{errors.columnKey}</span>
        ) : (
          <span className="field-hint mb-key-hint">
            {keyMode === 'auto' ? 'Follows the label. ' : ''}
            {storedKey ? `Saved as ${storedKey}.` : 'Unique identifier of the column in the report.'}
            {keyMode === 'manual' && form.columnLabel.trim() && (
              <button type="button" className="mb-link-button" onClick={resetKey} disabled={busy}>
                Create from label
              </button>
            )}
          </span>
        )}
      </div>

      <h4 className="dialog-section-title" id={typeGroupId}>
        What the column shows
      </h4>
      <div className="full-width-field">
        <div className="choice-row mb-choice-grid" role="radiogroup" aria-labelledby={typeGroupId}>
          {COLUMN_TYPES.map((type) => (
            <label key={type} className={`choice-option ${form.columnType === type ? 'is-selected' : ''}`}>
              <input
                type="radio"
                name="mb-column-type"
                value={type}
                checked={form.columnType === type}
                onChange={() => handleTypeChange(type)}
                disabled={busy}
              />
              <span className="choice-option-text">
                <strong>{COLUMN_TYPE_INFO[type].label}</strong>
                <span>{COLUMN_TYPE_INFO[type].description}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      {isMovement && (
        <>
          <h4 className="dialog-section-title" id={directionGroupId}>
            Movement direction
          </h4>
          <div className="full-width-field">
            <div className="choice-row" role="radiogroup" aria-labelledby={directionGroupId}>
              {MOVEMENT_DIRECTIONS.map((value) => (
                <label key={value} className={`choice-option ${direction === value ? 'is-selected' : ''}`}>
                  <input
                    type="radio"
                    name="mb-column-direction"
                    value={value}
                    checked={direction === value}
                    onChange={() => handleDirectionChange(value)}
                    disabled={busy}
                  />
                  <span className="choice-option-text">
                    <strong>{DIRECTION_INFO[value].label}</strong>
                    <span>{DIRECTION_INFO[value].description}</span>
                  </span>
                </label>
              ))}
            </div>
            {errors.movementDirection && <span className="field-error">{errors.movementDirection}</span>}
          </div>

          <h4 className="dialog-section-title" id={operationsLabelId}>
            Tank Operations added up in this column
          </h4>
          <div className="full-width-field" role="group" aria-labelledby={operationsLabelId}>
            {operationsLoading ? (
              <p className="field-hint">Loading Tank Operations of {template?.locationCode}…</p>
            ) : useManualCodes ? (
              <>
                <AlertMessage
                  tone="warning"
                  compact
                  message={
                    operationsError
                      ? `Tank Operations could not be loaded (${operationsError}). Enter the operation codes instead.`
                      : `No active Tank Operations exist for ${template?.locationCode}. Create them in Tank Operation Master, or enter the codes here.`
                  }
                />
                <div className="mb-manual-codes">
                  <div>
                    <label htmlFor="mb-column-mapped">Operation codes counted</label>
                    <input
                      id="mb-column-mapped"
                      type="text"
                      value={manualCodes.mapped}
                      onChange={(event) => {
                        setManualCodes((current) => ({ ...current, mapped: event.target.value }))
                        update({ mappedOperationCodes: splitCodes(event.target.value) })
                        clearError('mappedOperationCodes')
                      }}
                      placeholder="Example: RECEIPT, PRODUCTION"
                      disabled={busy}
                    />
                  </div>
                  <div>
                    <label htmlFor="mb-column-excluded">Operation codes excluded</label>
                    <input
                      id="mb-column-excluded"
                      type="text"
                      value={manualCodes.excluded}
                      onChange={(event) => {
                        setManualCodes((current) => ({ ...current, excluded: event.target.value }))
                        update({ excludedOperationCodes: splitCodes(event.target.value) })
                      }}
                      placeholder="Optional"
                      disabled={busy}
                    />
                  </div>
                </div>
              </>
            ) : (
              <>
                <p className="field-hint mb-field-intro">
                  Tick <strong>Count</strong> for every {direction} operation whose quantity belongs in this column.
                  <strong> Exclude</strong> keeps an operation out of this column even when it is counted.
                </p>
                <div className="table-scroll">
                  <table className="mb-operation-table">
                    <thead>
                      <tr>
                        <th className="mb-check-col">
                          <span className="mb-check-head">
                            <TriStateCheckbox
                              checked={directionOperations.length > 0 && mappedListed.length === directionOperations.length}
                              indeterminate={mappedListed.length > 0}
                              disabled={busy || directionOperations.length === 0}
                              onChange={setAllMapped}
                              label={`Count every ${direction} operation`}
                            />
                            Count
                          </span>
                        </th>
                        <th className="mb-check-col">Exclude</th>
                        <th>Operation</th>
                        <th>Code</th>
                        <th>Category</th>
                      </tr>
                    </thead>
                    <tbody>
                      {directionOperations.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="empty-table">
                            No active {direction} Tank Operations for {template?.locationCode}.
                          </td>
                        </tr>
                      ) : (
                        directionOperations.map((operation) => {
                          const counted = has(form.mappedOperationCodes, operation.operationCode)
                          const excluded = has(form.excludedOperationCodes, operation.operationCode)
                          return (
                            <tr key={operation.id} className={counted && !excluded ? 'is-selected' : ''}>
                              <td className="mb-check-col">
                                <input
                                  type="checkbox"
                                  checked={counted}
                                  onChange={(event) =>
                                    toggleCode('mappedOperationCodes', operation.operationCode, event.target.checked)
                                  }
                                  disabled={busy}
                                  aria-label={`Count ${operation.operationLabel}`}
                                />
                              </td>
                              <td className="mb-check-col">
                                <input
                                  type="checkbox"
                                  checked={excluded}
                                  onChange={(event) =>
                                    toggleCode('excludedOperationCodes', operation.operationCode, event.target.checked)
                                  }
                                  disabled={busy}
                                  aria-label={`Exclude ${operation.operationLabel}`}
                                />
                              </td>
                              <td className="cell-strong">{operation.operationLabel}</td>
                              <td>
                                <span className="cell-code">{operation.operationCode}</span>
                              </td>
                              <td>{operation.operationCategory || '–'}</td>
                            </tr>
                          )
                        })
                      )}
                    </tbody>
                  </table>
                </div>
                {orphanCodes.length > 0 && (
                  <div className="mb-orphan-codes">
                    <span>
                      Saved codes that are not active {direction} operations of {template?.locationCode}:
                    </span>
                    <span className="code-chip-list">
                      {orphanCodes.map((code) => (
                        <span key={code} className="code-chip mb-removable-chip">
                          {code}
                          <button
                            type="button"
                            className="mb-chip-remove"
                            onClick={() => removeOrphan(code)}
                            disabled={busy}
                            aria-label={`Remove ${code}`}
                          >
                            <Icon name="close" size={12} />
                          </button>
                        </span>
                      ))}
                    </span>
                  </div>
                )}
              </>
            )}
            {errors.mappedOperationCodes && <span className="field-error">{errors.mappedOperationCodes}</span>}
          </div>

          <h4 className="dialog-section-title" id={treatmentGroupId}>
            Book Closing
          </h4>
          <div className="full-width-field">
            <div className="choice-row" role="radiogroup" aria-labelledby={treatmentGroupId}>
              {TREATMENTS.map((value) => (
                <label key={value} className={`choice-option ${treatment === value ? 'is-selected' : ''}`}>
                  <input
                    type="radio"
                    name="mb-column-treatment"
                    value={value}
                    checked={treatment === value}
                    onChange={() => update(flagsForTreatment(value))}
                    disabled={busy}
                  />
                  <span className="choice-option-text">
                    <strong>{TREATMENT_INFO[value].label}</strong>
                    <span>{TREATMENT_INFO[value].description}</span>
                  </span>
                </label>
              ))}
            </div>
            {direction === 'NEUTRAL' && treatment === 'counted' && (
              <span className="field-hint">NEUTRAL movements never change Book Closing, even when counted.</span>
            )}
          </div>
        </>
      )}

      <h4 className="dialog-section-title">Placement and status</h4>

      <div>
        <label htmlFor="mb-column-position">Position in the report</label>
        <select
          id="mb-column-position"
          value={position}
          onChange={(event) => {
            setPositionTouched(true)
            setPosition(Number(event.target.value))
          }}
          disabled={busy}
        >
          <option value={0}>First column</option>
          {others.map((item, index) => (
            <option key={item.id} value={index + 1}>
              After “{item.columnLabel}”{item.status !== 'Active' ? ' (inactive)' : ''}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="mb-column-status">Status</label>
        <select
          id="mb-column-status"
          value={form.status}
          onChange={(event) => update({ status: event.target.value })}
          disabled={busy}
        >
          <option value="Active">Active</option>
          <option value="Inactive">Inactive</option>
        </select>
        <span className="field-hint">Inactive columns are kept but not shown in the report.</span>
      </div>

      <div className="full-width-field">
        <label htmlFor="mb-column-remarks">Remarks</label>
        <textarea
          id="mb-column-remarks"
          rows="2"
          value={form.remarks}
          onChange={(event) => update({ remarks: event.target.value })}
          placeholder="Optional remarks"
          disabled={busy}
        />
      </div>
    </FormDialog>
  )
}

export default ColumnFormDialog
