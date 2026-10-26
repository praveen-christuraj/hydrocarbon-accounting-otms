import { useMemo, useRef, useState } from 'react'
import Modal from '../common/Modal'
import Icon from '../common/Icon'
import AlertMessage from '../common/AlertMessage'
import ExportMenu from '../common/ExportMenu'
import { autoMapColumns, parseImportFile } from '../../utils/importUtils'
import { exportRows } from '../../utils/exportUtils'
import { logUiAction } from '../../utils/actionLogger'
import { useBulkTemplates } from '../../hooks/useBulkTemplates'
import { createOperationEntry } from '../../api/operationEntryApi'
import {
  PAYLOAD_FIELD_CODES,
  activeTemplateFields,
  buildOperationEntryImportFields,
  canCalculateOnImport,
  describeImportBehaviour,
  getPayloadProfile,
  prepareOperationEntryImportRow,
  enrichTankGaugingEntry,
} from '../../utils/operationEntryBulkImport'

const MODULE = 'Operation Entry'
const MAX_ROWS = 500

const trim = (value) => (value === null || value === undefined ? '' : String(value).trim())

const isPayColumn = (header) =>
  /^payload\.[a-zA-Z0-9_]+\..+/.test(header) ||
  PAYLOAD_FIELD_CODES.some((code) => header.startsWith(`${code}.`))

const normalisePayloadHeader = (header) =>
  header.startsWith('payload.') ? header : `payload.${header}`

const groupLabel = (field) => {
  if (field.kind === 'metadata') return 'Ticket metadata'
  if (field.kind === 'payload-json') return 'Payload (whole JSON document)'
  if (field.kind === 'payload' || field.kind === 'payload-extra') return 'Payload values'
  return 'Template fields'
}

/**
 * Bulk upload of Operation Entry tickets.
 *
 * One spreadsheet row = one complete ticket (metadata + template values +
 * asset-specific payload), saved as its own Draft ticket. The wizard is:
 *
 *   setup (choose operation type / template / defaults, download the template)
 *     → map (column mapping, row validation, preview)
 *     → done (per-row result, retry file for rejected rows)
 *
 * The heavy lifting lives in utils/operationEntryBulkImport.js so it can be
 * unit tested without rendering this dialog.
 */
function OperationEntryBulkImportDialog({
  open,
  onClose,
  operationTypes = [],
  operationTemplates = [],
  locations = [],
  assets = [],
  operationEntries = [],
  assetCalibrationTables = [],
  calibrationTemplates = [],
  loggedInUser = null,
  allowedOperationTypeCodes = null,
  onComplete,
}) {
  const fileInputRef = useRef(null)

  const [operationTypeCode, setOperationTypeCode] = useState('')
  const [templateId, setTemplateId] = useState('')
  const [defaults, setDefaults] = useState({
    senderLocationCode: '',
    receiverLocationCode: '',
    productName: '',
    createdBy: trim(loggedInUser?.fullName || loggedInUser?.full_name || loggedInUser?.username),
  })
  const [computeQuantities, setComputeQuantities] = useState(true)
  const [includeExample, setIncludeExample] = useState(true)
  const [showColumns, setShowColumns] = useState(false)
  const [savingTemplate, setSavingTemplate] = useState(false)
  const [newTemplateName, setNewTemplateName] = useState('')

  const [step, setStep] = useState('setup')
  const [file, setFile] = useState(null)
  const [parsed, setParsed] = useState(null)
  const [mapping, setMapping] = useState({})
  const [error, setError] = useState('')
  const [parsing, setParsing] = useState(false)
  const [running, setRunning] = useState(false)
  const [stopOnError, setStopOnError] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [results, setResults] = useState([])

  const activeOperationTypes = useMemo(
    () =>
      (operationTypes || []).filter(
        (item) =>
          String(item.status || '').trim().toLowerCase() === 'active' &&
          (allowedOperationTypeCodes === null ||
            allowedOperationTypeCodes.has(trim(item.operationTypeCode).toLowerCase()))
      ),
    [operationTypes, allowedOperationTypeCodes]
  )

  const templatesForType = useMemo(
    () =>
      (operationTemplates || []).filter(
        (template) =>
          String(template.status || '').trim().toLowerCase() === 'active' &&
          trim(template.operationTypeCode).toLowerCase() ===
            trim(operationTypeCode).toLowerCase()
      ),
    [operationTemplates, operationTypeCode]
  )

  const template = useMemo(
    () => templatesForType.find((item) => String(item.id) === String(templateId)) || null,
    [templatesForType, templateId]
  )

  const layoutType = useMemo(
    () => trim(template?.entryLayoutType) || 'Standard Form',
    [template]
  )

  const payloadProfile = useMemo(() => getPayloadProfile(layoutType), [layoutType])

  const baseFields = useMemo(
    () => (template ? buildOperationEntryImportFields({ template, layoutType }) : []),
    [template, layoutType]
  )

  const bulkTemplates = useBulkTemplates(`${MODULE} · ${template?.templateName || 'template'}`, baseFields)
  const fields = bulkTemplates.fields

  /* ---------------------------------------------------------- file reading */

  const resetFile = () => {
    setFile(null)
    setParsed(null)
    setMapping({})
    setStep('setup')
    setResults([])
    setProgress({ done: 0, total: 0 })
    setError('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const resetAll = () => {
    resetFile()
    setOperationTypeCode('')
    setTemplateId('')
    setStopOnError(false)
  }

  const handleClose = () => {
    if (running) return
    resetAll()
    onClose()
  }

  /** Payload columns the client added themselves (e.g. per-tank dips). */
  const detectedColumns = useMemo(() => {
    if (!parsed) return []
    return parsed.headers
      .filter(isPayColumn)
      .map((header) => ({
        key: normalisePayloadHeader(header),
        header,
        kind: 'payload-extra',
        label: header,
        required: false,
        aliases: [header],
        example: '',
        hint: 'Detected payload column · used as-is',
        dataType: 'Text',
      }))
  }, [parsed])

  const mappingFields = useMemo(() => [...fields, ...detectedColumns], [fields, detectedColumns])

  const ignoredHeaders = useMemo(() => {
    if (!parsed) return []
    const mappedHeaders = new Set(Object.values(mapping).filter(Boolean))
    return parsed.headers.filter((header) => !mappedHeaders.has(header))
  }, [parsed, mapping])

  const buildRecord = (row) => {
    const record = {}
    mappingFields.forEach((field) => {
      const header = mapping[field.key]
      const value = header ? row[header] : undefined
      record[field.key] = value === undefined ? '' : value
    })
    record.__rowNumber = row.__rowNumber
    return record
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
      if (data.rows.length > MAX_ROWS) {
        setError(
          `The file has ${data.rows.length} rows. Import at most ${MAX_ROWS} tickets at a time so each ticket is created reliably.`
        )
        return
      }

      const nextMapping = autoMapColumns(data.headers, fields)
      let detected = 0
      data.headers.forEach((header) => {
        if (!isPayColumn(header)) return
        const key = normalisePayloadHeader(header)
        if (!nextMapping[key]) {
          nextMapping[key] = header
          detected += 1
        }
      })

      setFile(chosen)
      setParsed(data)
      setMapping(nextMapping)
      setStep('map')
      logUiAction(MODULE, 'Bulk Import File Selected', {
        fileName: chosen.name,
        rows: data.rows.length,
        columns: data.headers.length,
        detectedPayloadColumns: detected,
        template: template?.templateName,
        layout: layoutType,
      })
    } catch (err) {
      setError(err.message || 'Unable to read the file.')
    } finally {
      setParsing(false)
    }
  }

  /* -------------------------------------------------------- row preparation */

  const preparedRows = useMemo(() => {
    if (!parsed || !template) return []
    const seenShuttleNumbers = new Set()
    const seenSignatures = new Set()
    return parsed.rows.map((row) => {
      const record = buildRecord(row)
      const prepared = prepareOperationEntryImportRow({
        record,
        rowNumber: row.__rowNumber,
        template,
        layoutType,
        operationTypes,
        locations,
        assets,
        existingEntries: operationEntries,
        defaults: {
          ...defaults,
          operationTypeCode,
          primaryAssetCode: defaults.primaryAssetCode || '',
        },
        allowedOperationTypeCodes,
        seenShuttleNumbers,
        seenSignatures,
      })
      return { ...prepared, record }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    parsed,
    mapping,
    detectedColumns,
    template,
    layoutType,
    operationTypes,
    locations,
    assets,
    operationEntries,
    defaults,
    operationTypeCode,
    allowedOperationTypeCodes,
  ])

  const validRows = useMemo(
    () => preparedRows.filter((row) => row.status === 'success'),
    [preparedRows]
  )
  const skippedRows = useMemo(
    () => preparedRows.filter((row) => row.status !== 'success'),
    [preparedRows]
  )

  const missingRequired = useMemo(
    () => fields.filter((field) => field.required && !mapping[field.key]),
    [fields, mapping]
  )

  /* ------------------------------------------------------------- templates */

  const exampleRow = useMemo(() => {
    const assetTypeCode = trim(
      activeOperationTypes.find(
        (item) => trim(item.operationTypeCode).toLowerCase() === operationTypeCode.toLowerCase()
      )?.applicableAssetTypeCode
    )
    const sampleAsset = (assets || []).find(
      (item) =>
        String(item.status || '').trim().toLowerCase() === 'active' &&
        (!assetTypeCode ||
          trim(item.assetTypeCode).toLowerCase() === assetTypeCode.toLowerCase())
    )
    const sampleLocation = (locations || []).find(
      (item) => String(item.status || '').trim().toLowerCase() === 'active'
    )

    const row = {}
    fields.forEach((field) => {
      if (field.key === 'metadata.operationTypeCode') {
        row[field.key] = trim(operationTypeCode)
        return
      }
      if (field.key === 'metadata.operationTemplateName') {
        row[field.key] = trim(template?.templateName)
        return
      }
      if (field.key === 'metadata.primaryAssetCode') {
        row[field.key] = trim(sampleAsset?.assetCode)
        return
      }
      if (field.key === 'metadata.senderLocationCode') {
        row[field.key] = defaults.senderLocationCode || trim(sampleLocation?.locationCode)
        return
      }
      if (field.key === 'metadata.receiverLocationCode') {
        row[field.key] = defaults.receiverLocationCode || ''
        return
      }
      if (field.key === 'metadata.productName') {
        row[field.key] = defaults.productName || ''
        return
      }
      if (field.key === 'metadata.createdBy') {
        row[field.key] = defaults.createdBy || ''
        return
      }
      if (field.key === 'metadata.convoyNumber') {
        row[field.key] = descriptionConvoyExample(layoutType)
        return
      }
      row[field.key] = field.example ?? ''
    })
    return row
  }, [
    fields,
    operationTypeCode,
    template,
    assets,
    locations,
    defaults,
    activeOperationTypes,
    layoutType,
  ])

  const downloadTemplate = async (format) => {
    try {
      await exportRows({
        format,
        rows: includeExample ? [exampleRow] : [],
        columns: fields.map((field) => ({ key: field.key, label: field.label })),
        fileName: `operation-entry-${template?.templateName || 'upload'}-template`,
        title: `${MODULE} upload template${template ? ` · ${template.templateName}` : ''}`,
        subtitle: [operationTypeCode, layoutType].filter(Boolean).join(' · '),
        module: MODULE,
      })
      logUiAction(MODULE, 'Bulk Import Template Downloaded', {
        format,
        operationType: operationTypeCode,
        template: template?.templateName,
        columns: fields.length,
      })
    } catch (err) {
      setError(err.message || 'Unable to build the template file.')
    }
  }

  /* --------------------------------------------------------------- running */

  const runImport = async () => {
    if (validRows.length === 0) {
      setError('No row is ready to import. Correct the file and upload it again.')
      return
    }

    setRunning(true)
    setError('')
    setStep('running')
    setProgress({ done: 0, total: validRows.length })
    logUiAction(MODULE, 'Bulk Import Started', {
      rows: validRows.length,
      skipped: skippedRows.length,
      template: template?.templateName,
      layout: layoutType,
      computeQuantities,
    })

    const outcome = skippedRows.map((row) => ({ ...row, entry: null }))
    let done = 0
    let stopped = false

    for (const prepared of validRows) {
      let message
      let status = 'success'
      let notes = [...(prepared.warnings || [])]

      try {
        let entry = prepared.entry
        if (computeQuantities && canCalculateOnImport(layoutType)) {
          const enriched = await enrichTankGaugingEntry({
            entry,
            assetCalibrationTables,
            calibrationTemplates,
          })
          entry = enriched.entry
          notes = [...notes, ...(enriched.warnings || [])]
        }

        const saved = await createOperationEntry({ ...entry, status: 'Draft' })
        const ticketNumber = trim(saved?.operationNumber || saved?.operationTicketNumber)
        message = ticketNumber
          ? `Draft ticket ${ticketNumber} created`
          : 'Draft ticket created'
      } catch (err) {
        status = 'failed'
        message = err?.message || 'Unable to save this ticket'
        stopped = Boolean(stopOnError)
      }

      outcome.push({ ...prepared, entry: null, status, message, warnings: notes })
      done += 1
      setProgress({ done, total: validRows.length })
      setResults([...outcome])
      if (stopped) break
    }

    if (stopped) {
      const notAttempted = validRows.length - done
      if (notAttempted > 0) {
        setError(
          `Import stopped at the first failed row. ${notAttempted} row${notAttempted === 1 ? '' : 's'} were not attempted.`
        )
      }
    }

    outcome.sort((a, b) => Number(a.rowNumber || 0) - Number(b.rowNumber || 0))
    setResults(outcome)
    setRunning(false)
    setStep('done')

    const summary = {
      total: preparedRows.length,
      success: outcome.filter((row) => row.status === 'success').length,
      failed: outcome.filter((row) => row.status === 'failed').length,
      skipped: outcome.filter((row) => row.status === 'skipped').length,
      fileName: file?.name,
      template: template?.templateName,
    }
    logUiAction(MODULE, 'Bulk Import Completed', summary)
    if (typeof onComplete === 'function') await onComplete(summary, outcome)
  }

  const summary = useMemo(
    () => ({
      success: results.filter((row) => row.status === 'success').length,
      failed: results.filter((row) => row.status === 'failed').length,
      skipped: results.filter((row) => row.status === 'skipped').length,
    }),
    [results]
  )

  const rowsToFix = useMemo(
    () =>
      results
        .filter((row) => row.status !== 'success')
        .map((row) => ({ ...(row.record || {}), message: row.message })),
    [results]
  )

  const rowsToFixColumns = useMemo(
    () => [
      ...mappingFields.map((field) => ({ key: field.key, label: field.label })),
      { key: 'message', label: 'Import message' },
    ],
    [mappingFields]
  )

  const resultsColumns = [
    { key: 'rowNumber', label: 'Row' },
    { key: 'status', label: 'Status' },
    { key: 'ticketNumber', label: 'Ticket' },
    { key: 'message', label: 'Message' },
  ]

  const resultRows = useMemo(
    () =>
      results.map((row) => ({
        rowNumber: row.rowNumber,
        status: row.status,
        ticketNumber: trim(row.message).startsWith('Draft ticket ')
          ? trim(row.message).split(' ')[2]
          : '',
        message: [row.message, ...(row.warnings || [])].filter(Boolean).join(' · '),
      })),
    [results]
  )

  /* ---------------------------------------------------------------- footer */

  const footer = (
    <>
      {step === 'setup' && (
        <button type="button" className="btn-secondary" onClick={handleClose}>
          Cancel
        </button>
      )}
      {step === 'map' && (
        <>
          <button type="button" className="btn-secondary" onClick={resetFile} disabled={running}>
            Choose another file
          </button>
          <button type="button" className="btn-secondary" onClick={handleClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={runImport}
            disabled={missingRequired.length > 0 || validRows.length === 0}
          >
            {`Import ${validRows.length} valid row${validRows.length === 1 ? '' : 's'} as Draft`}
          </button>
        </>
      )}
      {step === 'running' && (
        <button type="button" className="btn-secondary" disabled>
          Importing {progress.done} of {progress.total}…
        </button>
      )}
      {step === 'done' && (
        <>
          <ExportMenu
            rows={rowsToFix}
            columns={rowsToFixColumns}
            fileName="operation-entry-rows-to-fix"
            title="Operation Entry upload – rows to fix"
            module={MODULE}
            label="Download rows to fix"
            disabled={rowsToFix.length === 0}
          />
          <ExportMenu
            rows={resultRows}
            columns={resultsColumns}
            fileName="operation-entry-import-results"
            title="Operation Entry upload results"
            module={MODULE}
            label="Download results"
          />
          <button type="button" className="btn-secondary" onClick={resetFile}>
            Import another file
          </button>
          <button type="button" className="btn-primary" onClick={handleClose}>
            Close
          </button>
        </>
      )}
    </>
  )

  const templateGroups = useMemo(() => {
    const groups = new Map()
    fields.forEach((field) => {
      const label = groupLabel(field)
      if (!groups.has(label)) groups.set(label, [])
      groups.get(label).push(field)
    })
    return [...groups.entries()]
  }, [fields])

  return (
    <Modal
      open={open}
      title="Bulk upload operation entries"
      description="Upload complete tickets from an Excel (.xlsx) or CSV (.csv) file. Every row becomes its own Draft ticket, so you can review and submit them from the Operation Transaction Register."
      onClose={handleClose}
      size="xl"
      footer={footer}
      className="import-dialog operation-entry-import-dialog"
    >
      <AlertMessage tone="error" message={error} onDismiss={() => setError('')} />

      {step === 'setup' && (
        <div className="import-step">
          <div className="section-title compact-section-title">
            <h3>1 · Choose the ticket type</h3>
            <p>
              The upload layout is built from the selected Operation Template, so the file always
              matches the ticket you are about to create.
            </p>
          </div>

          <div className="operation-entry-import-scope">
            <div>
              <label htmlFor="bulk-operation-type">Operation Type</label>
              <select
                id="bulk-operation-type"
                value={operationTypeCode}
                onChange={(event) => {
                  setOperationTypeCode(event.target.value)
                  setTemplateId('')
                  resetFile()
                }}
              >
                <option value="">Select Operation Type</option>
                {activeOperationTypes.map((item) => (
                  <option key={item.id} value={item.operationTypeCode}>
                    {item.operationTypeName} ({item.operationTypeCode})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="bulk-operation-template">Operation Template</label>
              <select
                id="bulk-operation-template"
                value={templateId}
                onChange={(event) => {
                  setTemplateId(event.target.value)
                  resetFile()
                }}
                disabled={!operationTypeCode}
              >
                <option value="">
                  {operationTypeCode ? 'Select Operation Template' : 'Select Operation Type first'}
                </option>
                {templatesForType.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.templateName} - {item.entryLayoutType || 'Standard Form'}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {operationTypeCode && templatesForType.length === 0 && (
            <AlertMessage
              tone="warning"
              compact
              message="This operation type has no Active operation template. Create one in Operation Template Master first."
            />
          )}

          {template && (
            <>
              <div className="operation-layout-banner">
                <div>
                  <span>Entry Layout</span>
                  <strong>{layoutType}</strong>
                </div>
                <div>
                  <span>Template fields</span>
                  <strong>{activeTemplateFields(template).length}</strong>
                </div>
                <div>
                  <span>Payload columns</span>
                  <strong>{fields.filter((field) => field.kind === 'payload').length}</strong>
                </div>
              </div>

              <AlertMessage tone="info" compact message={describeImportBehaviour(layoutType)} />

              <div className="section-title compact-section-title">
                <h3>2 · Defaults for rows that leave a column blank</h3>
                <p>These values fill the matching metadata column before a row is validated.</p>
              </div>

              <div className="operation-entry-import-defaults">
                <div>
                  <label htmlFor="bulk-default-sender">Sender Location</label>
                  <select
                    id="bulk-default-sender"
                    value={defaults.senderLocationCode}
                    onChange={(event) =>
                      setDefaults((current) => ({
                        ...current,
                        senderLocationCode: event.target.value,
                      }))
                    }
                  >
                    <option value="">Blank (from the file)</option>
                    {(locations || [])
                      .filter((item) => String(item.status || '').trim().toLowerCase() === 'active')
                      .map((item) => (
                        <option key={item.id} value={item.locationCode}>
                          {item.locationName} ({item.locationCode})
                        </option>
                      ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="bulk-default-receiver">Receiver Location</label>
                  <select
                    id="bulk-default-receiver"
                    value={defaults.receiverLocationCode}
                    onChange={(event) =>
                      setDefaults((current) => ({
                        ...current,
                        receiverLocationCode: event.target.value,
                      }))
                    }
                  >
                    <option value="">Blank (from the file)</option>
                    {(locations || [])
                      .filter((item) => String(item.status || '').trim().toLowerCase() === 'active')
                      .map((item) => (
                        <option key={item.id} value={item.locationCode}>
                          {item.locationName} ({item.locationCode})
                        </option>
                      ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="bulk-default-product">Product</label>
                  <input
                    id="bulk-default-product"
                    type="text"
                    value={defaults.productName}
                    onChange={(event) =>
                      setDefaults((current) => ({ ...current, productName: event.target.value }))
                    }
                    placeholder="Example: Crude Oil"
                  />
                </div>

                <div>
                  <label htmlFor="bulk-default-created-by">Created By</label>
                  <input
                    id="bulk-default-created-by"
                    type="text"
                    value={defaults.createdBy}
                    onChange={(event) =>
                      setDefaults((current) => ({ ...current, createdBy: event.target.value }))
                    }
                    placeholder="Signed-in user"
                  />
                </div>
              </div>

              {canCalculateOnImport(layoutType) && (
                <label className="import-option">
                  <input
                    type="checkbox"
                    checked={computeQuantities}
                    onChange={(event) => setComputeQuantities(event.target.checked)}
                  />
                  <span>
                    Calculate tank quantities from the asset&apos;s active calibration table
                    (TOV / GOV / GSV / NSV / LT / MT) while importing
                  </span>
                </label>
              )}

              <div className="section-title compact-section-title">
                <h3>3 · Download the template, fill it in and upload it</h3>
                <p>
                  One row per ticket. Payload columns are named
                  <code> payload.&lt;payload_field&gt;.&lt;path&gt;</code> (for example
                  <code> payload.tank_gauging_payload.inputs.dipCm</code>).
                </p>
              </div>

              <div className="import-template-bar">
                <div className="import-template-select">
                  <label htmlFor="operation-entry-template-picker">Template</label>
                  <select
                    id="operation-entry-template-picker"
                    value={bulkTemplates.activeTemplateId}
                    onChange={(event) => bulkTemplates.select(event.target.value)}
                  >
                    {bulkTemplates.templates.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                        {item.system ? ' (built-in)' : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="import-template-actions">
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    onClick={() => setShowColumns((value) => !value)}
                    aria-expanded={showColumns}
                  >
                    <Icon name="columns" size={14} />
                    {showColumns ? 'Hide columns' : 'Configure columns'}
                  </button>
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    onClick={() => setSavingTemplate((value) => !value)}
                  >
                    <Icon name="filePlus" size={14} />
                    Save as…
                  </button>
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    onClick={bulkTemplates.reset}
                  >
                    <Icon name="refresh" size={14} />
                    Reset to default
                  </button>
                </div>
              </div>

              {savingTemplate && (
                <div className="import-template-save">
                  <label htmlFor="operation-entry-template-name">
                    Save the current column set as a template
                  </label>
                  <div className="import-template-save-row">
                    <input
                      id="operation-entry-template-name"
                      type="text"
                      value={newTemplateName}
                      placeholder="e.g. Night shift tank gauging"
                      onChange={(event) => setNewTemplateName(event.target.value)}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const name = newTemplateName.trim()
                        if (!name) {
                          setError('Enter a name for the template.')
                          return
                        }
                        bulkTemplates.saveAs(name)
                        setNewTemplateName('')
                        setSavingTemplate(false)
                        setError('')
                      }}
                    >
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
                    Required columns are always kept, even if they are switched off in a template.
                  </span>
                </div>
              )}

              {showColumns && (
                <div className="import-column-config">
                  <div className="import-column-config-head">
                    <strong>Columns in this template</strong>
                    <span className="field-hint">
                      This drives the downloaded template, the column mapping and the expected
                      columns list.
                    </span>
                  </div>
                  <ul>
                    {bulkTemplates.columns.map((column, index) => {
                      const resolved = fields.find((item) => item.key === column.key)
                      const locked = Boolean(resolved?.required)
                      return (
                        <li key={column.key}>
                          <label className="import-column-toggle">
                            <input
                              type="checkbox"
                              checked={locked || column.included !== false}
                              disabled={locked}
                              onChange={() => bulkTemplates.toggleColumn(column.key)}
                            />
                            <span>{column.label || column.key}</span>
                            {locked && <em>required</em>}
                          </label>
                          <div className="import-column-move">
                            <button
                              type="button"
                              className="btn-ghost btn-sm"
                              onClick={() => bulkTemplates.moveColumn(column.key, -1)}
                              disabled={index === 0}
                              aria-label={`Move ${column.label} up`}
                            >
                              <Icon name="chevronUp" size={13} />
                            </button>
                            <button
                              type="button"
                              className="btn-ghost btn-sm"
                              onClick={() => bulkTemplates.moveColumn(column.key, 1)}
                              disabled={index === bulkTemplates.columns.length - 1}
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

              <label className="import-option">
                <input
                  type="checkbox"
                  checked={includeExample}
                  onChange={(event) => setIncludeExample(event.target.checked)}
                />
                <span>Include an example row in the downloaded template</span>
              </label>

              <div className="import-fields">
                <div className="import-fields-header">
                  <strong>Expected columns ({fields.length})</strong>
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

                {templateGroups.map(([label, groupFields]) => (
                  <div key={label} className="operation-entry-import-field-group">
                    <strong>{label}</strong>
                    <ul>
                      {groupFields.map((field) => (
                        <li key={field.key}>
                          <span>{field.label}</span>
                          {field.required && <em>required</em>}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>

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
                  aria-label="Operation entry import file"
                />
                {parsing && <span className="field-hint">Reading file…</span>}
              </div>
            </>
          )}
        </div>
      )}

      {step === 'map' && parsed && template && (
        <div className="import-step">
          <AlertMessage
            tone="info"
            compact
            message={`${file?.name} · ${parsed.rows.length} data rows · ${parsed.headers.length} columns${
              parsed.sheetName ? ` · sheet "${parsed.sheetName}"` : ''
            } · ${layoutType}`}
          />

          <div className="info-box">
            <strong>
              {validRows.length} of {preparedRows.length} rows are ready to import as Draft tickets
            </strong>
            {skippedRows.length > 0 && (
              <div>{skippedRows.length} row(s) need correcting before they can be created.</div>
            )}
          </div>

          {skippedRows.length > 0 && (
            <div className="import-preview-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Row</th>
                    <th>Status</th>
                    <th>Why it cannot be imported</th>
                  </tr>
                </thead>
                <tbody>
                  {skippedRows.slice(0, 12).map((row) => (
                    <tr key={row.rowNumber}>
                      <td>{row.rowNumber}</td>
                      <td>
                        <span className="status-badge rejected">{row.status}</span>
                      </td>
                      <td>{row.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {skippedRows.length > 12 && (
                <div className="field-hint">
                  Showing the first 12 problems. Use “Download rows to fix” after the run for the
                  complete list.
                </div>
              )}
            </div>
          )}

          <div className="section-title compact-section-title">
            <h3>Column mapping</h3>
            <p>Columns were matched by their headings. Change any mapping that is wrong.</p>
          </div>

          <table className="import-mapping-table">
            <thead>
              <tr>
                <th>Target field</th>
                <th>File column</th>
                <th>Sample value</th>
              </tr>
            </thead>
            <tbody>
              {mappingFields.map((field) => {
                const header = mapping[field.key] || ''
                const sample = header ? parsed.rows[0]?.[header] : ''
                const isDetected = field.kind === 'payload-extra'
                return (
                  <tr key={field.key}>
                    <td>
                      {field.label}
                      {field.required && <span className="import-required"> *</span>}
                      {isDetected && <span className="import-detected"> detected</span>}
                    </td>
                    <td>
                      {isDetected ? (
                        <span>{header || field.header}</span>
                      ) : (
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
                      )}
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

          {ignoredHeaders.length > 0 && (
            <AlertMessage
              tone="info"
              compact
              message={`${ignoredHeaders.length} column(s) are not part of this template and will be ignored: ${ignoredHeaders
                .slice(0, 8)
                .join(', ')}${ignoredHeaders.length > 8 ? ' …' : ''}`}
            />
          )}

          <div className="import-preview">
            <strong>Preview – first {Math.min(validRows.length, 5)} ticket(s)</strong>
            <div className="import-preview-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Row</th>
                    <th>Ticket</th>
                    <th>Asset</th>
                    <th>Sender → Receiver</th>
                    <th>Convoy / Shuttle</th>
                    <th>Date</th>
                    <th>Values</th>
                  </tr>
                </thead>
                <tbody>
                  {validRows.slice(0, 5).map((row) => (
                    <tr key={row.rowNumber}>
                      <td>{row.rowNumber}</td>
                      <td>
                        {row.entry.operationTypeCode}
                        <br />
                        <small>{template.templateName}</small>
                      </td>
                      <td>{row.entry.primaryAssetCode}</td>
                      <td>
                        {row.entry.senderLocationCode}
                        {row.entry.receiverLocationCode
                          ? ` → ${row.entry.receiverLocationCode}`
                          : ''}
                      </td>
                      <td>{row.entry.convoyNumber || '-'}</td>
                      <td>{row.entry.operationDate || '-'}</td>
                      <td>{row.entry.values.filter((value) => value.fieldValue !== '').length}</td>
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
            <span>Stop at the first failed ticket</span>
          </label>

          <AlertMessage
            tone="info"
            compact
            message="Each valid row is created as its own Draft ticket. Nothing is submitted or approved by this upload; submit the tickets from the Operation Transaction Register."
          />
        </div>
      )}

      {step === 'running' && (
        <div className="import-step">
          <div className="import-progress" aria-live="polite">
            <div
              className="import-progress-bar"
              style={{
                width: `${
                  progress.total ? Math.round((progress.done / progress.total) * 100) : 0
                }%`,
              }}
            />
            <span>
              Creating ticket {Math.min(progress.done + 1, progress.total)} of {progress.total}…
            </span>
          </div>

          {results.length > 0 && (
            <div className="import-preview-scroll import-results">
              <table>
                <thead>
                  <tr>
                    <th>Row</th>
                    <th>Status</th>
                    <th>Message</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((row) => (
                    <tr key={row.rowNumber}>
                      <td>{row.rowNumber}</td>
                      <td>
                        <span
                          className={`status-badge ${
                            row.status === 'success'
                              ? 'approved'
                              : row.status === 'failed'
                                ? 'rejected'
                                : 'submitted'
                          }`}
                        >
                          {row.status}
                        </span>
                      </td>
                      <td>{row.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {step === 'done' && (
        <div className="import-step">
          <div className="import-summary">
            <div className="import-summary-item tone-success">
              <strong>{summary.success}</strong>
              <span>draft tickets created</span>
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
              message="Correct the rows below and upload the file again, or use “Download rows to fix” to get a file that contains only the rejected rows in the upload layout."
            />
          )}

          {summary.success > 0 && (
            <AlertMessage
              tone="success"
              compact
              message="The tickets were saved as Draft. Review and submit them from the Operation Transaction Register."
            />
          )}

          <div className="import-preview-scroll import-results">
            <table>
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Status</th>
                  <th>Message</th>
                  <th>Asset</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {results.map((row) => (
                  <tr key={row.rowNumber}>
                    <td>{row.rowNumber}</td>
                    <td>
                      <span
                        className={`status-badge ${
                          row.status === 'success'
                            ? 'approved'
                            : row.status === 'failed'
                              ? 'rejected'
                              : 'submitted'
                        }`}
                      >
                        {row.status}
                      </span>
                    </td>
                    <td>
                      {row.message}
                      {(row.warnings || []).length > 0 && (
                        <small> · {row.warnings.join(' · ')}</small>
                      )}
                    </td>
                    <td>{row.entry?.primaryAssetCode || ''}</td>
                    <td>{row.entry?.operationDate || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {payloadProfile && (
            <div className="field-hint">{payloadProfile.note}</div>
          )}
        </div>
      )}
    </Modal>
  )
}

/** A short, layout-aware example for the Convoy / Shuttle Number column. */
function descriptionConvoyExample(layoutType) {
  const layout = String(layoutType || '').toLowerCase()
  if (layout.includes('shuttle')) return 'SH-2026-001'
  if (layout.includes('tanker')) return 'CNV-2026-001'
  if (layout.includes('multi-tank')) return 'CNV-2026-002'
  return ''
}

export default OperationEntryBulkImportDialog
