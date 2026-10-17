import { useMemo } from 'react'
import AlertMessage from '../common/AlertMessage'
import ExportMenu from '../common/ExportMenu'
import Icon from '../common/Icon'
import {
  COLUMN_TYPE_INFO,
  analyzeTemplate,
  describeColumnRole,
  isActive,
  missingStandardColumns,
  sortColumns,
  summariseBookClosing,
} from '../../utils/materialBalanceTemplate'

const CHECK_TONE = { error: 'error', warning: 'warning', info: 'info' }

/** Rows in the layout of the page's bulk upload, so an export can be edited and re-uploaded. */
const exportColumns = [
  { key: 'locationCode', label: 'Location Code' },
  { key: 'templateName', label: 'Template Name' },
  { key: 'description', label: 'Template Description' },
  { key: 'columnLabel', label: 'Column Label' },
  { key: 'columnKey', label: 'Column Key' },
  { key: 'columnOrder', label: 'Column Order', type: 'number' },
  { key: 'columnType', label: 'Column Type' },
  { key: 'movementDirection', label: 'Movement Direction' },
  { key: 'mappedOperationCodes', label: 'Mapped Operation Codes' },
  { key: 'excludedOperationCodes', label: 'Excluded Operation Codes' },
  { key: 'includeInMaterialBalance', label: 'Include In Material Balance' },
  { key: 'includeInBookClosing', label: 'Include In Book Closing' },
  { key: 'isInternalTransfer', label: 'Is Internal Transfer' },
  { key: 'remarks', label: 'Column Remarks' },
  { key: 'status', label: 'Status' },
]

const names = (columns) => columns.map((column) => column.columnLabel).join(' + ')

function UsageBadge({ state }) {
  if (state === 'in-use') return <span className="status-badge active">Used by report</span>
  if (state === 'shadowed') return <span className="status-badge inactive">Not used – newer template</span>
  return <span className="status-badge cancelled">Not used – inactive</span>
}

export { UsageBadge }

/**
 * Column designer of one Material Balance Template: report preview, Book
 * Closing formula in words, configuration checks and the ordered column list.
 */
function TemplateDesigner({
  template,
  locationLabel,
  usage,
  operations,
  operationsLoading,
  operationsError,
  canEdit,
  busy,
  onClose,
  onAddColumn,
  onEditColumn,
  onDeleteColumn,
  onMoveColumn,
  onGenerate,
  onAddStandard,
  onUseForReport,
  onEditTemplate,
}) {
  const columns = useMemo(() => sortColumns(template.columns || []), [template.columns])
  const activeColumns = columns.filter(isActive)
  const checks = useMemo(
    () => analyzeTemplate({ columns, operations: Array.isArray(operations) ? operations : null }),
    [columns, operations]
  )
  const formula = useMemo(() => summariseBookClosing(columns), [columns])
  const missingStandard = missingStandardColumns(columns)
  const state = usage?.state || 'inactive'
  const reportTemplate = usage?.reportTemplate || null

  const exportRows = columns.map((column) => ({
    locationCode: template.locationCode,
    templateName: template.templateName,
    description: template.description,
    ...column,
    movementDirection: column.columnType === 'MOVEMENT' ? column.movementDirection : '',
    // Commas: the CSV export quotes such a cell, so the file can be re-uploaded as is.
    mappedOperationCodes: (column.mappedOperationCodes || []).join(', '),
    excludedOperationCodes: (column.excludedOperationCodes || []).join(', '),
  }))

  return (
    <section className="assignment-panel mb-designer" aria-labelledby="mb-designer-title">
      <div className="assignment-panel-head">
        <div>
          <h3 id="mb-designer-title">Columns – {template.templateName}</h3>
          <p>
            {locationLabel} · {activeColumns.length} active column{activeColumns.length === 1 ? '' : 's'}
            {columns.length !== activeColumns.length ? ` (${columns.length - activeColumns.length} inactive)` : ''}
            {template.description ? ` · ${template.description}` : ''}
          </p>
        </div>
        <div className="assignment-panel-meta">
          <span className={`status-badge ${String(template.status || '').toLowerCase()}`}>{template.status}</span>
          <UsageBadge state={state} />
          {canEdit && (
            <button type="button" className="btn-secondary btn-sm" onClick={onEditTemplate} disabled={busy}>
              <Icon name="edit" size={14} />
              Edit Template
            </button>
          )}
          <button type="button" className="btn-secondary btn-sm" onClick={onClose}>
            <Icon name="close" size={14} />
            Close
          </button>
        </div>
      </div>

      <div className="assignment-panel-body">
        {state === 'shadowed' && (
          <AlertMessage tone="warning">
            <span>
              Not used by the Material Balance Report: “{reportTemplate?.templateName}” is the newest active template
              of {template.locationCode}.
            </span>
            {canEdit && (
              <button type="button" className="btn-secondary btn-sm mb-inline-action" onClick={onUseForReport} disabled={busy}>
                Use for report
              </button>
            )}
          </AlertMessage>
        )}
        {state === 'inactive' && (
          <AlertMessage tone="info">
            <span>
              Inactive – the report ignores this template
              {reportTemplate ? ` and uses “${reportTemplate.templateName}”` : ''}.
            </span>
            {canEdit && (
              <button type="button" className="btn-secondary btn-sm mb-inline-action" onClick={onUseForReport} disabled={busy}>
                Use for report
              </button>
            )}
          </AlertMessage>
        )}
        {template.columnsError && (
          <AlertMessage tone="error" message={`Columns could not be loaded: ${template.columnsError}`} />
        )}

        <div className="mb-designer-toolbar">
          {canEdit && (
            <>
              <button type="button" className="btn-primary" onClick={() => onAddColumn()} disabled={busy}>
                <Icon name="plus" size={15} />
                Add Column
              </button>
              <button type="button" className="btn-secondary" onClick={() => onGenerate()} disabled={busy}>
                <Icon name="layers" size={15} />
                Columns from Tank Operations
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={onAddStandard}
                disabled={busy || missingStandard.length === 0}
                title={
                  missingStandard.length === 0
                    ? 'Opening, Book Closing, Closing and Loss/Gain columns already exist'
                    : `Adds ${missingStandard.map((column) => column.columnLabel).join(', ')}`
                }
              >
                <Icon name="columns" size={15} />
                Add Standard Columns
              </button>
            </>
          )}
          <span className="mb-toolbar-spacer" />
          <ExportMenu
            rows={exportRows}
            columns={exportColumns}
            fileName={`material-balance-template-${template.locationCode}-${template.templateName}`
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')}
            title={`Material Balance Template – ${template.templateName} (${template.locationCode})`}
            module="Material Balance Template"
            label="Export Columns"
            disabled={columns.length === 0}
          />
        </div>

        {columns.length === 0 ? (
          <div className="mb-empty-designer">
            <strong>This template has no columns yet.</strong>
            <span>
              {canEdit
                ? 'Build them from the Tank Operations of the location in one step, start from the standard stock columns, or add them one by one.'
                : 'A user with the Edit Material Balance Template permission can configure the columns.'}
            </span>
            {canEdit && (
              <div className="mb-empty-actions">
                <button type="button" className="btn-primary" onClick={() => onGenerate()} disabled={busy}>
                  <Icon name="layers" size={15} />
                  Columns from Tank Operations
                </button>
                <button type="button" className="btn-secondary" onClick={onAddStandard} disabled={busy}>
                  <Icon name="columns" size={15} />
                  Add Standard Columns
                </button>
                <button type="button" className="btn-secondary" onClick={() => onAddColumn()} disabled={busy}>
                  <Icon name="plus" size={15} />
                  Add Column
                </button>
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="mb-preview" aria-label="Report preview">
              <div className="mb-preview-head">
                <span className="field-label">Report columns (left to right)</span>
                <span className="mb-preview-note">Date, tank and product columns come first in the report.</span>
              </div>
              <div className="mb-preview-strip">
                {activeColumns.length === 0 ? (
                  <span className="cell-muted">No active columns.</span>
                ) : (
                  activeColumns.map((column) => (
                    <span key={column.id} className={`mb-preview-cell type-${String(column.columnType).toLowerCase()}`}>
                      <strong>{column.columnLabel}</strong>
                      <small>
                        {column.columnType === 'MOVEMENT'
                          ? `${column.movementDirection} · ${(column.mappedOperationCodes || []).join(', ') || 'no operation'}`
                          : COLUMN_TYPE_INFO[column.columnType]?.label || column.columnType}
                      </small>
                    </span>
                  ))
                )}
              </div>
              <dl className="mb-formula">
                <div>
                  <dt>Book Closing</dt>
                  <dd>
                    {formula.opening ? formula.opening.columnLabel : 'Opening'}
                    {formula.added.length > 0 && <> + ({names(formula.added)})</>}
                    {formula.subtracted.length > 0 && <> − ({names(formula.subtracted)})</>}
                    {formula.added.length === 0 && formula.subtracted.length === 0 && ' (no counted movement)'}
                  </dd>
                </div>
                <div>
                  <dt>Loss / Gain</dt>
                  <dd>
                    {formula.actualClosing ? formula.actualClosing.columnLabel : 'Actual closing'} −{' '}
                    {formula.bookClosing ? formula.bookClosing.columnLabel : 'Book closing'}
                  </dd>
                </div>
                {formula.notCounted.length > 0 && (
                  <div>
                    <dt>Not in Book Closing</dt>
                    <dd>{formula.notCounted.map((column) => column.columnLabel).join(', ')}</dd>
                  </div>
                )}
              </dl>
            </div>

            <div className="mb-checks">
              {operationsLoading && <p className="field-hint">Checking against the Tank Operations of {template.locationCode}…</p>}
              {!operationsLoading && operationsError && (
                <p className="field-hint">
                  Tank Operation checks are not available: {operationsError}
                </p>
              )}
              {checks.length === 0 && !operationsLoading ? (
                <AlertMessage
                  tone="success"
                  compact
                  message={
                    Array.isArray(operations)
                      ? 'Configuration check passed: every IN / OUT Tank Operation is shown and the standard stock columns are present.'
                      : 'Configuration check passed for the columns.'
                  }
                />
              ) : (
                checks.map((check, index) => (
                  <AlertMessage key={`${check.code}-${index}`} tone={CHECK_TONE[check.level]} compact>
                    <span>{check.message}</span>
                    {canEdit && check.code === 'operations-not-in-report' && (
                      <button
                        type="button"
                        className="btn-secondary btn-sm mb-inline-action"
                        onClick={() => onGenerate(check.operations.map((operation) => operation.operationCode))}
                        disabled={busy}
                      >
                        Add columns
                      </button>
                    )}
                    {canEdit && check.code === 'missing-standard' && check.canAdd && (
                      <button
                        type="button"
                        className="btn-secondary btn-sm mb-inline-action"
                        onClick={onAddStandard}
                        disabled={busy}
                      >
                        Add standard columns
                      </button>
                    )}
                  </AlertMessage>
                ))
              )}
            </div>

            <div className="table-scroll">
              <table className="mb-column-table">
                <thead>
                  <tr>
                    <th className="num">#</th>
                    <th>Column</th>
                    <th>Type</th>
                    <th>Tank Operations</th>
                    <th>In the report</th>
                    <th>Status</th>
                    {canEdit && <th>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {columns.map((column, index) => {
                    const role = describeColumnRole(column)
                    const isMovement = column.columnType === 'MOVEMENT'
                    return (
                      <tr key={column.id} className={isActive(column) ? '' : 'is-inactive'}>
                        <td className="num">
                          {index + 1}
                          <div className="muted-table-text" title="Column order saved in the template">
                            {column.columnOrder}
                          </div>
                        </td>
                        <td>
                          <strong className="cell-strong">{column.columnLabel}</strong>
                          <div className="muted-table-text">{column.columnKey}</div>
                        </td>
                        <td>
                          {COLUMN_TYPE_INFO[column.columnType]?.label || column.columnType}
                          {isMovement && <div className="muted-table-text">{column.movementDirection}</div>}
                        </td>
                        <td>
                          {isMovement ? (
                            <span className="code-chip-list">
                              {(column.mappedOperationCodes || []).map((code) => (
                                <span key={`m-${code}`} className="code-chip">
                                  {code}
                                </span>
                              ))}
                              {(column.excludedOperationCodes || []).map((code) => (
                                <span key={`x-${code}`} className="code-chip mb-excluded-chip" title="Excluded from this column">
                                  excl. {code}
                                </span>
                              ))}
                              {(column.mappedOperationCodes || []).length === 0 && (
                                <span className="cell-muted">None mapped</span>
                              )}
                            </span>
                          ) : (
                            <span className="cell-muted">–</span>
                          )}
                        </td>
                        <td>
                          <span className={`mb-role tone-${role.tone}`}>{role.label}</span>
                        </td>
                        <td>
                          <span className={`status-badge ${String(column.status || '').toLowerCase()}`}>
                            {column.status}
                          </span>
                        </td>
                        {canEdit && (
                          <td className="row-actions">
                            <button
                              type="button"
                              className="btn-secondary btn-sm mb-icon-button"
                              onClick={() => onMoveColumn(column, -1)}
                              disabled={busy || index === 0}
                              aria-label={`Move ${column.columnLabel} left in the report`}
                              title="Move earlier in the report"
                            >
                              <Icon name="chevronUp" size={14} />
                            </button>
                            <button
                              type="button"
                              className="btn-secondary btn-sm mb-icon-button"
                              onClick={() => onMoveColumn(column, 1)}
                              disabled={busy || index === columns.length - 1}
                              aria-label={`Move ${column.columnLabel} right in the report`}
                              title="Move later in the report"
                            >
                              <Icon name="chevronDown" size={14} />
                            </button>
                            <button type="button" onClick={() => onEditColumn(column)} disabled={busy}>
                              Edit
                            </button>
                            <button
                              type="button"
                              className="btn-danger"
                              onClick={() => onDeleteColumn(column)}
                              disabled={busy}
                            >
                              Delete
                            </button>
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </section>
  )
}

export default TemplateDesigner
