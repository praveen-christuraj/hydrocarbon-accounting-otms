import { useMemo, useRef, useState } from 'react'
import Modal from './Modal'
import Icon from './Icon'
import AlertMessage from './AlertMessage'
import ExportMenu from './ExportMenu'
import { autoMapColumns, parseImportFile } from '../../utils/importUtils'
import { exportRows } from '../../utils/exportUtils'
import { logUiAction } from '../../utils/actionLogger'

/**
 * Bulk upload wizard for master data (owner rule 6).
 *
 * Accepts Excel (.xlsx) *and* CSV (.csv) files everywhere – both are parsed in
 * the browser, mapped to the module columns, previewed, imported row by row and
 * reported on. Rows the server rejects are listed with the server's own message
 * and can be exported (xlsx / csv / pdf) so the user can correct them and
 * re-upload the same file.
 *
 * Props
 *  - open, onClose
 *  - title            e.g. "Import Locations"
 *  - module           audit module name
 *  - fields           [{ key, label, required?, aliases?, options?, defaultValue?, type?, example?, hint? }]
 *  - onImportRow      async (record, rowNumber) => void   – throws to mark the row failed
 *  - onImportBatch    async ([{ rowNumber, record }]) => [{ rowNumber, status, message }] | void
 *                     – for modules whose API saves the whole set in one call
 *                       (barge seals, Table 11 factors …). Throwing marks every
 *                       submitted row as failed with the server's message.
 *  - onComplete       (summary) => void  – called after the run (reload lists here)
 *  - validateRow      optional (record, rowNumber) => string | null
 *  - templateFileName optional, defaults to module slug
 *  - templates        optional [{ id, name, system? }] – template picker (layered templates)
 *  - activeTemplateId / onSelectTemplate / onSaveTemplate / onDeleteTemplate
 *  - columns, onToggleColumn, onMoveColumn, onRenameColumn, onResetTemplate,
 *    canConfigure  – optional column configuration of the active template
 *
 * Steps: choose file → map columns → review & run → results.
 * The dialog never closes on outside click (Modal rule).
 */
function ImportDialog({
  open,
  onClose,
  title = 'Import data',
  module = 'Import',
  fields = [],
  onImportRow,
  onImportBatch,
  onComplete,
  validateRow,
  templateFileName,
  maxRows = 2000,
  description,
  templates,
  activeTemplateId,
  onSelectTemplate,
  onSaveTemplate,
  onDeleteTemplate,
  columns,
  onToggleColumn,
  onMoveColumn,
  onResetTemplate,
  canConfigure = false,
}) {
  const fileInputRef = useRef(null)
  const [step, setStep] = useState('file')
  const [file, setFile] = useState(null)
  const [parsed, setParsed] = useState(null)
  const [mapping, setMapping] = useState({})
  const [error, setError] = useState('')
  const [parsing, setParsing] = useState(false)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [results, setResults] = useState([])
  const [stopOnError, setStopOnError] = useState(false)
  const [includeExample, setIncludeExample] = useState(true)
  const [showColumns, setShowColumns] = useState(false)
  const [savingTemplate, setSavingTemplate] = useState(false)
  const [newTemplateName, setNewTemplateName] = useState('')

  const hasTemplatePicker = Array.isArray(templates) && templates.length > 0

  const reset = () => {
    setStep('file')
    setFile(null)
    setParsed(null)
    setMapping({})
    setError('')
    setParsing(false)
    setRunning(false)
    setProgress({ done: 0, total: 0 })
    setResults([])
    setShowColumns(false)
    setSavingTemplate(false)
    setNewTemplateName('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleClose = () => {
    if (running) return
    reset()
    onClose()
  }

  const handleFileChange = async (event) => {
    const chosen = event.target.files && event.target.files[0]
    setError('')
    if (!chosen) return
    try {
      setParsing(true)
      const data = await parseImportFile(chosen)
      if (data.rows.length === 0) {
        setError('The file has no data rows below the header line.')
        return
      }
      if (data.rows.length > maxRows) {
        setError(`The file has ${data.rows.length} rows. Import at most ${maxRows} rows at a time.`)
        return
      }
      setFile(chosen)
      setParsed(data)
      setMapping(autoMapColumns(data.headers, fields))
      setStep('map')
      logUiAction(module, 'Import File Selected', {
        fileName: chosen.name,
        rows: data.rows.length,
        columns: data.headers.length,
        format: data.format,
        template: activeTemplateId,
      })
    } catch (err) {
      setError(err.message || 'Unable to read the file.')
    } finally {
      setParsing(false)
    }
  }

  const missingRequired = useMemo(
    () => fields.filter((field) => field.required && !mapping[field.key]),
    [fields, mapping]
  )

  const buildRecord = (row) => {
    const record = {}
    fields.forEach((field) => {
      const header = mapping[field.key]
      let value = header ? row[header] : undefined
      if ((value === undefined || value === '') && field.defaultValue !== undefined) {
        value = field.defaultValue
      }
      if (typeof field.transform === 'function') value = field.transform(value, row)
      record[field.key] = value === undefined ? '' : value
    })
    return record
  }

  const previewRows = useMemo(() => {
    if (!parsed) return []
    return parsed.rows.slice(0, 5).map((row) => buildRecord(row))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed, mapping, fields])

  const prepareRow = (row, index) => {
    const record = buildRecord(row)
    const rowNumber = row.__rowNumber || index + 2
    let status = 'success'
    let message = 'Imported'

    const requiredMissing = fields
      .filter((field) => field.required)
      .filter((field) => record[field.key] === undefined || String(record[field.key]).trim() === '')
    if (requiredMissing.length > 0) {
      status = 'skipped'
      message = `Missing required: ${requiredMissing.map((field) => field.label).join(', ')}`
    } else if (typeof validateRow === 'function') {
      const validationError = validateRow(record, rowNumber)
      if (validationError) {
        status = 'skipped'
        message = validationError
      }
    }

    return { rowNumber, status, message, record }
  }

  const runImport = async () => {
    if (!parsed) return
    if (typeof onImportBatch !== 'function' && typeof onImportRow !== 'function') return
    setRunning(true)
    setError('')
    const total = parsed.rows.length
    setProgress({ done: 0, total })
    const outcome = []
    logUiAction(module, 'Import Started', { fileName: file?.name, rows: total })

    if (typeof onImportBatch === 'function') {
      // Modules whose API replaces the whole set (barge seals, Table 11 …)
      // validate every row first, then send the accepted rows in one call.
      const prepared = parsed.rows.map(prepareRow)
      outcome.push(...prepared.filter((item) => item.status !== 'success'))
      const valid = prepared.filter((item) => item.status === 'success')

      if (valid.length > 0) {
        try {
          const batchResult = await onImportBatch(
            valid.map(({ rowNumber, record }) => ({ rowNumber, record }))
          )
          if (Array.isArray(batchResult)) {
            valid.forEach((item) => {
              const override = batchResult.find((entry) => entry.rowNumber === item.rowNumber)
              outcome.push(override ? { ...item, ...override } : item)
            })
          } else {
            outcome.push(...valid)
          }
        } catch (err) {
          const message = err?.message || 'Import failed'
          valid.forEach((item) => outcome.push({ ...item, status: 'failed', message }))
          setError(
            `${message} – no row from this file was saved. Correct the file and upload it again.`
          )
        }
      }
      setProgress({ done: total, total })
    } else {
      for (let index = 0; index < parsed.rows.length; index += 1) {
        const row = parsed.rows[index]
        const entry = prepareRow(row, index)

        if (entry.status === 'success') {
          try {
            await onImportRow(entry.record, entry.rowNumber)
          } catch (err) {
            entry.status = 'failed'
            entry.message = err?.message || 'Import failed'
          }
        }

        outcome.push(entry)
        setProgress({ done: index + 1, total })
        if (entry.status === 'failed' && stopOnError) {
          break
        }
      }
    }

    outcome.sort((a, b) => a.rowNumber - b.rowNumber)
    setResults(outcome)
    setRunning(false)
    setStep('done')

    const summary = {
      total,
      success: outcome.filter((item) => item.status === 'success').length,
      failed: outcome.filter((item) => item.status === 'failed').length,
      skipped: outcome.filter((item) => item.status === 'skipped').length,
      fileName: file?.name,
    }
    logUiAction(module, 'Import Completed', summary)
    if (typeof onComplete === 'function') onComplete(summary, outcome)
  }

  /* ------------------------------------------------------------ templates */

  const templateRows = useMemo(() => {
    if (!includeExample) return []
    const example = fields.reduce((acc, field) => {
      acc[field.key] = field.example ?? ''
      return acc
    }, {})
    return [example]
  }, [fields, includeExample])

  const templateColumns = fields.map((field) => ({ key: field.key, label: field.label }))

  const downloadTemplate = async (format) => {
    try {
      await exportRows({
        format,
        rows: templateRows,
        columns: templateColumns,
        fileName: `${templateFileName || module}-upload-template`,
        title: `${title} template`,
        subtitle: hasTemplatePicker
          ? `Template: ${templates.find((item) => item.id === activeTemplateId)?.name || 'System default'}`
          : undefined,
        module,
      })
      logUiAction(module, 'Import Template Downloaded', { format, template: activeTemplateId })
    } catch (err) {
      setError(err.message || 'Unable to build the template file.')
    }
  }

  const handleSaveTemplate = () => {
    const name = String(newTemplateName || '').trim()
    if (!name) {
      setError('Enter a name for the template.')
      return
    }
    if (typeof onSaveTemplate === 'function') onSaveTemplate(name)
    setSavingTemplate(false)
    setNewTemplateName('')
    setError('')
  }

  /* -------------------------------------------------------------- results */

  const summary = useMemo(
    () => ({
      success: results.filter((item) => item.status === 'success').length,
      failed: results.filter((item) => item.status === 'failed').length,
      skipped: results.filter((item) => item.status === 'skipped').length,
    }),
    [results]
  )

  const resultsColumns = useMemo(
    () => [
      { key: 'rowNumber', label: 'Row' },
      { key: 'status', label: 'Status' },
      { key: 'message', label: 'Message' },
      ...fields.map((field) => ({ key: `record.${field.key}`, label: field.label })),
    ],
    [fields]
  )

  /** Rows the user has to correct, in the upload layout so they can re-upload. */
  const rowsToFix = useMemo(
    () =>
      results
        .filter((item) => item.status !== 'success')
        .map((item) => ({ ...(item.record || {}), message: item.message })),
    [results]
  )

  const fixColumns = useMemo(
    () => [...templateColumns, { key: 'message', label: 'Import Error' }],
    [templateColumns]
  )

  const footer = (
    <>
      {step === 'file' && (
        <button type="button" className="btn-secondary" onClick={handleClose}>
          Cancel
        </button>
      )}
      {step === 'map' && (
        <>
          <button type="button" className="btn-secondary" onClick={reset}>
            Choose another file
          </button>
          <button type="button" className="btn-secondary" onClick={handleClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={runImport}
            disabled={missingRequired.length > 0 || running}
          >
            {running
              ? `Importing ${progress.done} of ${progress.total}…`
              : `Import ${parsed ? parsed.rows.length : 0} rows`}
          </button>
        </>
      )}
      {step === 'done' && (
        <>
          <ExportMenu
            rows={rowsToFix}
            columns={fixColumns}
            fileName={`${templateFileName || module}-rows-to-fix`}
            title={`${title} – rows to fix`}
            module={module}
            label="Download rows to fix"
          />
          <ExportMenu
            rows={results}
            columns={resultsColumns}
            fileName={`${templateFileName || module}-import-results`}
            title={`${title} results`}
            module={module}
            label="Download results"
          />
          <button type="button" className="btn-primary" onClick={handleClose}>
            Close
          </button>
        </>
      )}
    </>
  )

  return (
    <Modal
      open={open}
      title={title}
      description={
        description ||
        'Bulk upload from an Excel (.xlsx) or CSV (.csv) file. Download the template, fill it in and upload it back.'
      }
      onClose={handleClose}
      size="lg"
      footer={footer}
      className="import-dialog"
    >
      <AlertMessage tone="error" message={error} onDismiss={() => setError('')} />

      {hasTemplatePicker && (
        <div className="import-template-bar">
          <div className="import-template-select">
            <label htmlFor="import-template-picker">Template</label>
            <select
              id="import-template-picker"
              value={activeTemplateId || ''}
              onChange={(event) =>
                typeof onSelectTemplate === 'function' && onSelectTemplate(event.target.value)
              }
            >
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                  {template.system ? ' (built-in)' : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="import-template-actions">
            {canConfigure && (
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() => setShowColumns((value) => !value)}
                aria-expanded={showColumns}
              >
                <Icon name="columns" size={14} />
                {showColumns ? 'Hide columns' : 'Configure columns'}
              </button>
            )}
            {typeof onResetTemplate === 'function' && (
              <button type="button" className="btn-ghost btn-sm" onClick={onResetTemplate}>
                <Icon name="refresh" size={14} />
                Reset to default
              </button>
            )}
            {typeof onDeleteTemplate === 'function' && (
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() => onDeleteTemplate(activeTemplateId)}
                disabled={!activeTemplateId || activeTemplateId === 'system-default'}
              >
                <Icon name="trash" size={14} />
                Delete
              </button>
            )}
            {typeof onSaveTemplate === 'function' && (
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() => setSavingTemplate((value) => !value)}
              >
                <Icon name="filePlus" size={14} />
                Save as…
              </button>
            )}
          </div>
        </div>
      )}

      {savingTemplate && (
        <div className="import-template-save">
          <label htmlFor="import-template-name">Save current column set as</label>
          <div className="import-template-save-row">
            <input
              id="import-template-name"
              type="text"
              value={newTemplateName}
              placeholder="e.g. Monthly tanker upload"
              onChange={(event) => setNewTemplateName(event.target.value)}
            />
            <button type="button" onClick={handleSaveTemplate}>
              Save
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setSavingTemplate(false)
                setNewTemplateName('')
              }}
            >
              Cancel
            </button>
          </div>
          <span className="field-hint">
            Required columns are always kept, even if they are switched off in this template.
          </span>
        </div>
      )}

      {showColumns && canConfigure && (
        <div className="import-column-config">
          <div className="import-column-config-head">
            <strong>Columns in this template</strong>
            <span className="field-hint">
              Switch optional columns off or reorder them. This drives both the downloaded
              template and the column mapping.
            </span>
          </div>
          <ul>
            {(columns || []).map((column, index) => {
              const field = fields.find((item) => item.key === column.key)
              const locked = Boolean(field?.required)
              return (
                <li key={column.key}>
                  <label className="import-column-toggle">
                    <input
                      type="checkbox"
                      checked={locked || column.included !== false}
                      disabled={locked}
                      onChange={() =>
                        typeof onToggleColumn === 'function' && onToggleColumn(column.key)
                      }
                    />
                    <span>{column.label || column.key}</span>
                    {locked && <em>required</em>}
                  </label>
                  <div className="import-column-move">
                    <button
                      type="button"
                      className="btn-ghost btn-sm"
                      onClick={() => typeof onMoveColumn === 'function' && onMoveColumn(column.key, -1)}
                      disabled={index === 0}
                      aria-label={`Move ${column.label} up`}
                    >
                      <Icon name="chevronUp" size={13} />
                    </button>
                    <button
                      type="button"
                      className="btn-ghost btn-sm"
                      onClick={() => typeof onMoveColumn === 'function' && onMoveColumn(column.key, 1)}
                      disabled={index === (columns || []).length - 1}
                      aria-label={`Move ${column.label} down`}
                    >
                      <Icon name="chevronDown" size={13} />
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {step === 'file' && (
        <div className="import-step">
          <div className="import-dropzone">
            <Icon name="upload" size={28} />
            <p>
              <strong>Choose an .xlsx or .csv file.</strong>
              <br />
              The first row must contain the column headings.
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xlsm,.csv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
              onChange={handleFileChange}
              disabled={parsing}
              aria-label="Import file"
            />
            {parsing && <span className="field-hint">Reading file…</span>}
          </div>

          <div className="import-fields">
            <div className="import-fields-header">
              <strong>Expected columns</strong>
              <div className="import-template-downloads">
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  onClick={() => downloadTemplate('xlsx')}
                >
                  <Icon name="fileSpreadsheet" size={14} />
                  Download XLSX template
                </button>
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  onClick={() => downloadTemplate('csv')}
                >
                  <Icon name="fileText" size={14} />
                  Download CSV template
                </button>
              </div>
            </div>
            <label className="import-option">
              <input
                type="checkbox"
                checked={includeExample}
                onChange={(event) => setIncludeExample(event.target.checked)}
              />
              <span>Include an example row in the downloaded template</span>
            </label>
            <ul>
              {fields.map((field) => (
                <li key={field.key}>
                  <span>{field.label}</span>
                  {field.required && <em>required</em>}
                  {field.options && <small>Allowed: {field.options.join(', ')}</small>}
                  {field.hint && <small>{field.hint}</small>}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {step === 'map' && parsed && (
        <div className="import-step">
          <AlertMessage
            tone="info"
            compact
            message={`${file?.name} · ${parsed.rows.length} data rows · ${parsed.headers.length} columns${parsed.sheetName ? ` · sheet "${parsed.sheetName}"` : ''}`}
          />

          <table className="import-mapping-table">
            <thead>
              <tr>
                <th>Target field</th>
                <th>File column</th>
                <th>Sample value</th>
              </tr>
            </thead>
            <tbody>
              {fields.map((field) => {
                const header = mapping[field.key] || ''
                const sample = header ? parsed.rows[0]?.[header] : ''
                return (
                  <tr key={field.key}>
                    <td>
                      {field.label}
                      {field.required && <span className="import-required"> *</span>}
                    </td>
                    <td>
                      <select
                        value={header}
                        onChange={(event) =>
                          setMapping({ ...mapping, [field.key]: event.target.value })
                        }
                        aria-label={`Column for ${field.label}`}
                        aria-invalid={field.required && !header ? 'true' : undefined}
                      >
                        <option value="">— not imported —</option>
                        {parsed.headers.map((candidate) => (
                          <option key={candidate} value={candidate}>
                            {candidate}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="import-sample">{String(sample ?? '')}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {missingRequired.length > 0 && (
            <AlertMessage
              tone="warning"
              compact
              message={`Map the required field${missingRequired.length === 1 ? '' : 's'}: ${missingRequired
                .map((field) => field.label)
                .join(', ')}.`}
            />
          )}

          <div className="import-preview">
            <strong>Preview (first {previewRows.length} rows as they will be imported)</strong>
            <div className="import-preview-scroll">
              <table>
                <thead>
                  <tr>
                    {fields.map((field) => (
                      <th key={field.key}>{field.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((record, index) => (
                    <tr key={index}>
                      {fields.map((field) => (
                        <td key={field.key}>{String(record[field.key] ?? '')}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <label className="import-option">
            <input
              type="checkbox"
              checked={stopOnError}
              onChange={(event) => setStopOnError(event.target.checked)}
            />
            <span>Stop at the first failed row</span>
          </label>

          {running && (
            <div className="import-progress" aria-live="polite">
              <div
                className="import-progress-bar"
                style={{
                  width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%`,
                }}
              />
              <span>
                Importing row {progress.done} of {progress.total}…
              </span>
            </div>
          )}
        </div>
      )}

      {step === 'done' && (
        <div className="import-step">
          <div className="import-summary">
            <div className="import-summary-item tone-success">
              <strong>{summary.success}</strong>
              <span>imported</span>
            </div>
            <div className="import-summary-item tone-warning">
              <strong>{summary.skipped}</strong>
              <span>skipped</span>
            </div>
            <div className="import-summary-item tone-danger">
              <strong>{summary.failed}</strong>
              <span>failed</span>
            </div>
          </div>

          {summary.failed + summary.skipped > 0 && (
            <AlertMessage
              tone="warning"
              compact
              message="Fix the rows below and upload the file again, or use “Download rows to fix” to get a file that contains only the rejected rows in the upload layout."
            />
          )}

          <div className="import-preview-scroll import-results">
            <table>
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Status</th>
                  <th>Message</th>
                  {fields.slice(0, 3).map((field) => (
                    <th key={field.key}>{field.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {results.map((item) => (
                  <tr key={item.rowNumber}>
                    <td>{item.rowNumber}</td>
                    <td>
                      <span
                        className={`status-badge ${
                          item.status === 'success'
                            ? 'approved'
                            : item.status === 'failed'
                              ? 'rejected'
                              : 'submitted'
                        }`}
                      >
                        {item.status}
                      </span>
                    </td>
                    <td>{item.message}</td>
                    {fields.slice(0, 3).map((field) => (
                      <td key={field.key}>{String(item.record[field.key] ?? '')}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  )
}

export default ImportDialog
