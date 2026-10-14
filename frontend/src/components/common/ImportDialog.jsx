import { useMemo, useRef, useState } from 'react'
import Modal from './Modal'
import Icon from './Icon'
import AlertMessage from './AlertMessage'
import { autoMapColumns, parseImportFile } from '../../utils/importUtils'
import { exportRows } from '../../utils/exportUtils'
import { logUiAction } from '../../utils/actionLogger'

/**
 * Import wizard for master data (owner rule 6).
 *
 * Props
 *  - open, onClose
 *  - title            e.g. "Import Locations"
 *  - module           audit module name
 *  - fields           [{ key, label, required?, aliases?, options?, defaultValue?, type? }]
 *  - onImportRow      async (record, rowNumber) => void   – throws to mark the row failed
 *  - onComplete       (summary) => void  – called after the run (reload lists here)
 *  - validateRow      optional (record) => string | null  – return an error message to skip the row
 *  - templateFileName optional, defaults to module slug
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
  onComplete,
  validateRow,
  templateFileName,
  maxRows = 2000,
  description,
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

  const runImport = async () => {
    if (!parsed || typeof onImportRow !== 'function') return
    setRunning(true)
    setError('')
    const total = parsed.rows.length
    setProgress({ done: 0, total })
    const outcome = []
    logUiAction(module, 'Import Started', { fileName: file?.name, rows: total })

    for (let index = 0; index < parsed.rows.length; index += 1) {
      const row = parsed.rows[index]
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

      if (status === 'success') {
        try {
          await onImportRow(record, rowNumber)
        } catch (err) {
          status = 'failed'
          message = err?.message || 'Import failed'
        }
      }

      outcome.push({ rowNumber, status, message, record })
      setProgress({ done: index + 1, total })
      if (status === 'failed' && stopOnError) {
        break
      }
    }

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

  const downloadTemplate = async () => {
    try {
      await exportRows({
        format: 'xlsx',
        rows: [
          fields.reduce((acc, field) => {
            acc[field.key] = field.example ?? ''
            return acc
          }, {}),
        ],
        columns: fields.map((field) => ({ key: field.key, label: field.label })),
        fileName: `${templateFileName || module}-import-template`,
        title: `${title} template`,
        module,
      })
    } catch (err) {
      setError(err.message || 'Unable to build the template file.')
    }
  }

  const downloadResults = async () => {
    try {
      await exportRows({
        format: 'xlsx',
        rows: results,
        columns: [
          { key: 'rowNumber', label: 'Row' },
          { key: 'status', label: 'Status' },
          { key: 'message', label: 'Message' },
          ...fields.map((field) => ({
            key: `record.${field.key}`,
            label: field.label,
            accessor: (row) => row.record?.[field.key],
          })),
        ],
        fileName: `${templateFileName || module}-import-results`,
        title: `${title} results`,
        module,
      })
    } catch (err) {
      setError(err.message || 'Unable to export the results.')
    }
  }

  const summary = useMemo(
    () => ({
      success: results.filter((item) => item.status === 'success').length,
      failed: results.filter((item) => item.status === 'failed').length,
      skipped: results.filter((item) => item.status === 'skipped').length,
    }),
    [results]
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
          <button type="button" className="btn-secondary" onClick={downloadResults}>
            <Icon name="download" size={14} />
            Download results
          </button>
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
      description={description || 'Import rows from an Excel (.xlsx) or CSV file.'}
      onClose={handleClose}
      size="lg"
      footer={footer}
      className="import-dialog"
    >
      <AlertMessage tone="error" message={error} onDismiss={() => setError('')} />

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
              accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
              onChange={handleFileChange}
              disabled={parsing}
              aria-label="Import file"
            />
            {parsing && <span className="field-hint">Reading file…</span>}
          </div>

          <div className="import-fields">
            <div className="import-fields-header">
              <strong>Expected columns</strong>
              <button type="button" className="btn-ghost btn-sm" onClick={downloadTemplate}>
                <Icon name="fileSpreadsheet" size={14} />
                Download template
              </button>
            </div>
            <ul>
              {fields.map((field) => (
                <li key={field.key}>
                  <span>{field.label}</span>
                  {field.required && <em>required</em>}
                  {field.options && (
                    <small>Allowed: {field.options.join(', ')}</small>
                  )}
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
