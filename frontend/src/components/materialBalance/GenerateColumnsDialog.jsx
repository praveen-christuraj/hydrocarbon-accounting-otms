import { useMemo, useState } from 'react'
import Modal from '../common/Modal'
import AlertMessage from '../common/AlertMessage'
import {
  COLUMN_TYPE_INFO,
  TREATMENTS,
  TREATMENT_INFO,
  classifyTreatment,
  flagsForTreatment,
  normalizeOperationCode,
  proposeColumns,
} from '../../utils/materialBalanceTemplate'

/**
 * Build a template's columns from the location's Tank Operations in one step.
 *
 * Every proposal is reviewable: include / exclude it, rename the label and
 * choose the Book Closing treatment of each movement column. Columns that the
 * template already has (same type, or an operation that is already mapped)
 * are listed but cannot be added twice. Mounted with a `key` per opening.
 *
 * `preselectCodes` (optional) limits the initial selection to those
 * operations, e.g. when opened from the "not shown in any column" check.
 * onSubmit(columns) receives the column payloads in report order.
 */
function GenerateColumnsDialog({
  open,
  template,
  columns,
  operations,
  operationsLoading,
  operationsError,
  preselectCodes,
  busy,
  busyLabel,
  error,
  onDismissError,
  onSubmit,
  onCancel,
}) {
  const proposals = useMemo(
    () => proposeColumns({ operations: operations || [], columns: columns || [] }),
    [operations, columns]
  )

  const [overrides, setOverrides] = useState({})

  const preselected = useMemo(
    () => (Array.isArray(preselectCodes) ? new Set(preselectCodes.map(normalizeOperationCode)) : null),
    [preselectCodes]
  )

  const rows = proposals.map((proposal) => {
    const override = overrides[proposal.id] || {}
    let include = proposal.include
    if (preselected) {
      include =
        proposal.kind === 'movement' &&
        !proposal.disabled &&
        preselected.has(normalizeOperationCode(proposal.operation?.operationCode))
    }
    if (override.include !== undefined) include = override.include
    return {
      ...proposal,
      include: !proposal.disabled && include,
      column: {
        ...proposal.column,
        ...(override.columnLabel !== undefined ? { columnLabel: override.columnLabel } : {}),
        ...(override.treatment ? flagsForTreatment(override.treatment) : {}),
      },
    }
  })

  const selected = rows.filter((row) => row.include)
  const blankLabel = selected.some((row) => !String(row.column.columnLabel || '').trim())
  const selectable = rows.filter((row) => !row.disabled)
  const allSelected = selectable.length > 0 && selectable.every((row) => row.include)

  const setOverride = (id, patch) =>
    setOverrides((current) => ({ ...current, [id]: { ...(current[id] || {}), ...patch } }))

  const toggleAll = (checked) => {
    setOverrides((current) => {
      const next = { ...current }
      selectable.forEach((row) => {
        next[row.id] = { ...(next[row.id] || {}), include: checked }
      })
      return next
    })
  }

  const operationsUnavailable = !operationsLoading && !Array.isArray(operations)
  const noOperations = !operationsLoading && Array.isArray(operations) && rows.every((row) => row.kind !== 'movement')

  const handleSubmit = () => {
    if (selected.length === 0 || blankLabel) return
    onSubmit(selected.map((row) => ({ ...row.column, columnLabel: row.column.columnLabel.trim() })))
  }

  return (
    <Modal
      open={open}
      title="Columns from Tank Operations"
      description={`${template?.templateName || ''} (${template?.locationCode || ''})`}
      onClose={onCancel}
      size="xl"
      footer={
        <>
          <span className="form-dialog-footer-start">
            {selected.length} column{selected.length === 1 ? '' : 's'} will be added
          </span>
          <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={handleSubmit}
            disabled={busy || operationsLoading || selected.length === 0 || blankLabel}
          >
            {busy ? busyLabel || 'Adding columns…' : `Add ${selected.length} Column${selected.length === 1 ? '' : 's'}`}
          </button>
        </>
      }
    >
      <AlertMessage tone="error" message={error} onDismiss={onDismissError} className="form-dialog-alert" />
      <p className="mb-dialog-intro">
        One movement column is proposed for every active IN, OUT and NEUTRAL Tank Operation of{' '}
        {template?.locationCode}, plus the standard stock columns. Operations whose code or name mentions ITT or
        internal transfer are pre-set as internal transfers. Adjust anything before adding.
      </p>

      {operationsLoading && <p className="field-hint">Loading Tank Operations of {template?.locationCode}…</p>}
      {operationsUnavailable && (
        <AlertMessage
          tone="warning"
          message={`Tank Operations could not be loaded${operationsError ? ` (${operationsError})` : ''}. Only the standard columns can be added here.`}
        />
      )}
      {noOperations && (
        <AlertMessage
          tone="info"
          message={`${template?.locationCode} has no active IN / OUT / NEUTRAL Tank Operations. Create them in Tank Operation Master to get movement columns.`}
        />
      )}
      {blankLabel && <AlertMessage tone="warning" message="Every column that will be added needs a label." />}

      <div className="table-scroll">
        <table className="mb-generate-table">
          <thead>
            <tr>
              <th className="mb-check-col">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={(event) => toggleAll(event.target.checked)}
                  disabled={busy || selectable.length === 0}
                  aria-label="Select every column that can be added"
                  title="Select every column that can be added"
                />
              </th>
              <th>Column label</th>
              <th>Type</th>
              <th>Tank Operation</th>
              <th>Book Closing</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isMovement = row.kind === 'movement'
              return (
                <tr key={row.id} className={`${row.include ? 'is-selected' : ''} ${row.disabled ? 'is-disabled' : ''}`.trim()}>
                  <td className="mb-check-col">
                    <input
                      type="checkbox"
                      checked={row.include}
                      onChange={(event) => setOverride(row.id, { include: event.target.checked })}
                      disabled={busy || row.disabled}
                      aria-label={`Add ${row.column.columnLabel || 'column'}`}
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      className="mb-inline-input"
                      value={row.column.columnLabel}
                      onChange={(event) => setOverride(row.id, { columnLabel: event.target.value })}
                      disabled={busy || row.disabled}
                      aria-label="Column label"
                    />
                    <div className="muted-table-text">{row.column.columnKey}</div>
                  </td>
                  <td>
                    {COLUMN_TYPE_INFO[row.column.columnType]?.label || row.column.columnType}
                    {isMovement && <div className="muted-table-text">{row.column.movementDirection}</div>}
                  </td>
                  <td>
                    {isMovement ? (
                      <>
                        <span className="cell-strong">{row.operation.operationLabel}</span>
                        <div className="muted-table-text">{row.operation.operationCode}</div>
                      </>
                    ) : (
                      <span className="cell-muted">Calculated by the report</span>
                    )}
                  </td>
                  <td>
                    {isMovement ? (
                      <select
                        className="mb-inline-select"
                        value={classifyTreatment(row.column)}
                        onChange={(event) => setOverride(row.id, { treatment: event.target.value })}
                        disabled={busy || row.disabled}
                        aria-label={`Book Closing treatment of ${row.column.columnLabel}`}
                      >
                        {TREATMENTS.map((value) => (
                          <option key={value} value={value}>
                            {TREATMENT_INFO[value].label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="cell-muted">–</span>
                    )}
                  </td>
                  <td className="cell-wrap">
                    {row.reason ||
                      (isMovement && row.column.movementDirection === 'NEUTRAL'
                        ? 'NEUTRAL – no stock effect'
                        : '')}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Modal>
  )
}

export default GenerateColumnsDialog
