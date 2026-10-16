import { useMemo, useState } from 'react'
import {
  createAssetCalibrationTable,
  deleteAssetCalibrationTable,
  getAssetCalibrationTable,
  updateAssetCalibrationTable,
} from '../api/assetCalibrationApi'
import { invalidateCalibrationRows } from '../hooks/useActiveCalibrationTable'
import PaginationControls, { paginateRows, usePageSize } from '../components/common/PaginationControls'
import DataTableToolbar from '../components/common/DataTableToolbar'
import ExportMenu from '../components/common/ExportMenu'
import Icon from '../components/common/Icon'
import { useDataFilters } from '../hooks/useDataFilters'
import { useAutoColumns } from '../hooks/useAutoColumns'
import { usePermissions } from '../hooks/usePermissions'
import { useBulkTemplates } from '../hooks/useBulkTemplates'
import { parseImportFile } from '../utils/importUtils'
import { exportRows } from '../utils/exportUtils'
import { logUiAction } from '../utils/actionLogger'
import AlertMessage from '../components/common/AlertMessage'
import useActionFeedback from '../hooks/useActionFeedback'

const UPLOAD_EXTENSIONS = ['xlsx', 'xlsm', 'csv', 'txt']
const MAX_UPLOAD_ERRORS = 100
const CALIBRATION_STATUSES = ['Active', 'Inactive', 'Blocked']

/** Prefix that keeps dynamic template columns apart from the fixed ones. */
const DYNAMIC_PREFIX = 'col_'

function AssetCalibrationTable({
  assets,
  calibrationTemplates,
  calibrationTables,
  reloadAssetCalibrationTables,
  loggedInUser,
}) {
  const emptyForm = {
    calibrationName: '',
    assetCode: '',
    templateId: '',
    effectiveDate: '',
    remarks: '',
    status: 'Active',
    rows: [],
  }

  const [formData, setFormData] = useState(emptyForm)
  const [rowData, setRowData] = useState({})
  const [editId, setEditId] = useState(null)
  const [loading, setLoading] = useState(false)

  const [uploadFileName, setUploadFileName] = useState('')
  const [uploadFileFormat, setUploadFileFormat] = useState('')
  const [uploadedRows, setUploadedRows] = useState([])
  const [uploadValidationErrors, setUploadValidationErrors] = useState([])
  const [showUploadHelp, setShowUploadHelp] = useState(false)
  // Action feedback: little pop-up (toast) + inline message near the
  // action area (owner rule 8) - never at the bottom of the page.
  const feedback = useActionFeedback()
  const { notifySuccess, notifyError, clearSuccess, clearError } = feedback
  const [validationErrors, setValidationErrors] = useState({})
  const [confirmRemoveRowIndex, setConfirmRemoveRowIndex] = useState(null)
  const [confirmClearRows, setConfirmClearRows] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [page, setPage] = useState(1)

  const pageSize = usePageSize()
  const calibrationTablesFilters = useDataFilters(calibrationTables, useAutoColumns(calibrationTables), { module: 'Asset Calibration Table' })
  const visibleTables = paginateRows(calibrationTablesFilters.filteredRows, page, pageSize)

  const visibleRowLimit = 10

  const { hasPermission } = usePermissions(loggedInUser)
  const canCreate = hasPermission('Create Asset Calibration')
  const canEdit = hasPermission('Edit Asset Calibration')
  const canDelete = hasPermission('Delete Asset Calibration')
  const canWrite = canCreate || canEdit

  const activeAssets = assets.filter((asset) => asset.status === 'Active')
  const activeTemplates = calibrationTemplates.filter(
    (template) => template.status === 'Active'
  )

  const selectedAsset = activeAssets.find(
    (asset) => asset.assetCode === formData.assetCode
  )

  const availableTemplates = useMemo(() => {
    if (!selectedAsset) {
      return []
    }

    return activeTemplates.filter((template) => {
      return template.assetTypeCode === selectedAsset.assetTypeCode
    })
  }, [activeTemplates, selectedAsset])

  const selectedTemplate = activeTemplates.find((template) => {
    return template.id === Number(formData.templateId)
  })

  const sortedTemplateColumns = selectedTemplate
    ? [...selectedTemplate.columns].sort(
        (a, b) => Number(a.sortOrder) - Number(b.sortOrder)
      )
    : []

  const resetUploadState = () => {
    setUploadFileName('')
    setUploadFileFormat('')
    setUploadedRows([])
    setUploadValidationErrors([])
  }

  const handleFormChange = (e) => {
    const { name, value } = e.target

    if (name === 'assetCode') {
      setFormData({
        ...formData,
        assetCode: value,
        templateId: '',
        rows: [],
      })
      setRowData({})
      resetUploadState()
      return
    }

    if (name === 'templateId') {
      setFormData({
        ...formData,
        templateId: value,
        rows: [],
      })
      setRowData({})
      resetUploadState()
      return
    }

    setFormData({
      ...formData,
      [name]: value,
    })
  }

  const handleRowChange = (columnName, value) => {
    setRowData({
      ...rowData,
      [columnName]: value,
    })
  }

  const convertValueByDataType = (value, dataType) => {
    if (value === undefined || value === null) {
      return ''
    }

    const cleanedValue = String(value).trim()

    if (cleanedValue === '') {
      return ''
    }

    if (dataType === 'Number') {
      const numericValue = Number(cleanedValue)

      if (Number.isNaN(numericValue)) {
        return cleanedValue
      }

      return numericValue
    }

    if (dataType === 'Boolean') {
      if (cleanedValue.toLowerCase() === 'true') {
        return true
      }

      if (cleanedValue.toLowerCase() === 'false') {
        return false
      }

      if (cleanedValue.toLowerCase() === 'yes') {
        return true
      }

      if (cleanedValue.toLowerCase() === 'no') {
        return false
      }

      return cleanedValue
    }

    return cleanedValue
  }

  const handleAddRow = () => {
    clearSuccess()
    clearError()

    if (!selectedTemplate) {
      notifyError('Please select a calibration template first')
      return
    }

    for (const column of sortedTemplateColumns) {
      if (column.isRequired === 'Yes') {
        const value = rowData[column.columnName]

        if (value === undefined || String(value).trim() === '') {
          notifyError(`${column.columnName} is required`)
          return
        }
      }
    }

    const newRow = {}

    sortedTemplateColumns.forEach((column) => {
      newRow[column.columnName] = convertValueByDataType(
        rowData[column.columnName],
        column.dataType
      )
    })

    setFormData({
      ...formData,
      rows: [...formData.rows, newRow],
    })

    setRowData({})
  }

  const confirmRemoveRow = () => {
    setFormData({
      ...formData,
      rows: formData.rows.filter((row, index) => index !== confirmRemoveRowIndex),
    })
    setConfirmRemoveRowIndex(null)
  }

  const validateAndNormalizeUploadedRows = (rawRows) => {
    const errors = []

    if (!selectedTemplate) {
      errors.push('Please select a calibration template before uploading.')
      return {
        rows: [],
        errors,
      }
    }

    if (rawRows.length === 0) {
      errors.push('Uploaded file does not contain any data rows.')
      return {
        rows: [],
        errors,
      }
    }

    const fileColumns = Object.keys(rawRows[0] || {}).map((columnName) =>
      String(columnName).trim()
    )

    if (fileColumns.length === 0) {
      errors.push('Uploaded file does not contain a valid header row.')
      return {
        rows: [],
        errors,
      }
    }

    const lowerCaseFileColumnMap = {}

    fileColumns.forEach((columnName) => {
      lowerCaseFileColumnMap[columnName.toLowerCase()] = columnName
    })

    sortedTemplateColumns.forEach((templateColumn) => {
      const matchingFileColumn =
        lowerCaseFileColumnMap[templateColumn.columnName.toLowerCase()]

      if (!matchingFileColumn) {
        errors.push(
          `Missing template column in uploaded file: ${templateColumn.columnName}`
        )
      }
    })

    if (errors.length > 0) {
      return {
        rows: [],
        errors,
      }
    }

    const normalizedRows = rawRows.map((rawRow) => {
      const normalizedRow = {}

      sortedTemplateColumns.forEach((templateColumn) => {
        const matchingFileColumn =
          lowerCaseFileColumnMap[templateColumn.columnName.toLowerCase()]

        normalizedRow[templateColumn.columnName] = convertValueByDataType(
          rawRow[matchingFileColumn],
          templateColumn.dataType
        )
      })

      return normalizedRow
    })

    normalizedRows.forEach((normalizedRow, rowIndex) => {
      sortedTemplateColumns.forEach((templateColumn) => {
        if (templateColumn.isRequired === 'Yes') {
          const value = normalizedRow[templateColumn.columnName]

          if (
            value === undefined ||
            value === null ||
            String(value).trim() === ''
          ) {
            errors.push(
              `Row ${rowIndex + 1}: ${templateColumn.columnName} is required`
            )
          }
        }

        if (
          templateColumn.dataType === 'Number' &&
          normalizedRow[templateColumn.columnName] !== '' &&
          typeof normalizedRow[templateColumn.columnName] !== 'number'
        ) {
          errors.push(
            `Row ${rowIndex + 1}: ${templateColumn.columnName} must be a number`
          )
        }
      })
    })

    const visibleErrors =
      errors.length > MAX_UPLOAD_ERRORS
        ? [...errors.slice(0, MAX_UPLOAD_ERRORS), `… and ${errors.length - MAX_UPLOAD_ERRORS} more error(s)`]
        : errors

    return {
      rows: errors.length === 0 ? normalizedRows : [],
      errors: visibleErrors,
      errorCount: errors.length,
    }
  }

  const handleFileUpload = async (e) => {
    const selectedFile = e.target.files[0]
    clearSuccess()
    clearError()

    resetUploadState()

    if (!selectedTemplate) {
      notifyError('Please select Asset and Calibration Template before uploading file')
      e.target.value = ''
      return
    }

    if (!selectedFile) {
      return
    }

    const fileName = selectedFile.name
    const fileExtension = fileName.split('.').pop().toLowerCase()

    if (!UPLOAD_EXTENSIONS.includes(fileExtension)) {
      notifyError('Unsupported file type. Upload an Excel (.xlsx) or CSV (.csv) file.')
      e.target.value = ''
      return
    }

    try {
      const parsed = await parseImportFile(selectedFile)
      const validationResult = validateAndNormalizeUploadedRows(parsed.rows)

      setUploadFileName(fileName)
      setUploadFileFormat(fileExtension === 'csv' || fileExtension === 'txt' ? 'CSV' : 'XLSX')
      setUploadedRows(validationResult.rows)
      setUploadValidationErrors(validationResult.errors)

      if (validationResult.errorCount > 0) {
        notifyError(
          `Uploaded file has ${validationResult.errorCount} validation error(s). Correct the file and upload it again – nothing has been saved yet.`
        )
      } else {
        notifySuccess(
          `${validationResult.rows.length} rows parsed successfully from ${fileName}. Review them, then use Replace Rows or Append Rows.`
        )
        logUiAction('Asset Calibration Table', 'Calibration Data File Parsed', {
          fileName,
          rows: validationResult.rows.length,
          template: selectedTemplate.templateName,
        })
      }
    } catch (error) {
      setUploadValidationErrors([error.message])
      notifyError(error.message)
    } finally {
      e.target.value = ''
    }
  }

  /** Blank upload file generated from the selected Calibration Template Master. */
  const downloadCalibrationTemplate = async (format) => {
    if (!selectedTemplate) {
      notifyError('Please select Asset and Calibration Template before downloading the template')
      return
    }
    try {
      await exportRows({
        format,
        rows: [],
        columns: sortedTemplateColumns.map((column) => ({
          key: column.columnName,
          label: column.columnName,
        })),
        fileName: `asset-calibration-${String(selectedTemplate.templateName || 'template').replace(/\s+/g, '-').toLowerCase()}`,
        title: `Calibration data template – ${selectedTemplate.templateName}`,
        subtitle: 'Fill one row per calibration point. Column names must stay unchanged.',
        module: 'Asset Calibration Table',
      })
      notifySuccess(`Calibration template (${format.toUpperCase()}) downloaded.`)
    } catch (error) {
      notifyError(error.message || 'Unable to build the template file.')
    }
  }

  const handleUseUploadedRows = () => {
    clearSuccess()
    clearError()

    if (uploadedRows.length === 0) {
      notifyError('No valid uploaded rows available')
      return
    }

    setFormData({
      ...formData,
      rows: uploadedRows,
    })

    notifySuccess('Uploaded rows added to calibration table')
  }

  const handleAppendUploadedRows = () => {
    clearSuccess()
    clearError()

    if (uploadedRows.length === 0) {
      notifyError('No valid uploaded rows available')
      return
    }

    setFormData({
      ...formData,
      rows: [...formData.rows, ...uploadedRows],
    })

    notifySuccess('Uploaded rows appended to calibration table')
  }

  const confirmClearAllRows = () => {
    setFormData({
      ...formData,
      rows: [],
    })
    setConfirmClearRows(false)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()

    if (!(editId === null ? canCreate : canEdit)) {
      notifyError(
        `You do not have permission to ${editId === null ? 'create' : 'edit'} asset calibration tables.`
      )
      return
    }

    clearSuccess()
    clearError()
    setValidationErrors({})

    const errors = {}

    if (formData.calibrationName.trim() === '') {
      errors.calibrationName = 'Calibration Name is required'
    }

    if (formData.assetCode.trim() === '') {
      errors.assetCode = 'Asset is required'
    }

    if (String(formData.templateId).trim() === '') {
      errors.templateId = 'Calibration Template is required'
    }

    if (formData.rows.length === 0) {
      errors.rows = 'Please add or upload at least one calibration data row'
    }

    setValidationErrors(errors)

    if (Object.keys(errors).length > 0) {
      return
    }

    try {
      setLoading(true)

      if (editId === null) {
        await createAssetCalibrationTable(formData)
        notifySuccess('Asset Calibration Table saved successfully')
      } else {
        await updateAssetCalibrationTable(editId, formData)
        notifySuccess('Asset Calibration Table updated successfully')
      }

      // Charts are cached per table for the operation layouts; drop the
      // edited one so they pick up the new data.
      invalidateCalibrationRows(editId)
      await reloadAssetCalibrationTables()
      setFormData(emptyForm)
      setRowData({})
      setEditId(null)
      resetUploadState()
    } catch (error) {
      notifyError(error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleEdit = async (table) => {
    if (!canEdit) {
      notifyError('You do not have permission to edit asset calibration tables.')
      return
    }

    clearSuccess()
    clearError()

    // The list is lean (no calibration data rows), so the rows for the table
    // being edited are fetched here rather than shipped with the list.
    let rows = table.rows
    if (!table.rowsLoaded) {
      try {
        setLoading(true)
        const fullTable = await getAssetCalibrationTable(table.id)
        rows = fullTable.rows
      } catch (error) {
        notifyError(error.message)
        return
      } finally {
        setLoading(false)
      }
    }

    setFormData({
      calibrationName: table.calibrationName,
      assetCode: table.assetCode,
      templateId: String(table.templateId),
      effectiveDate: table.effectiveDate,
      remarks: table.remarks,
      status: table.status,
      rows: (rows || []).map((row) => row.rowData),
    })

    setRowData({})
    resetUploadState()
    setEditId(table.id)
  }

  const handleDelete = async () => {
    if (!canDelete) {
      notifyError('You do not have permission to delete asset calibration tables.')
      return
    }

    clearSuccess()
    clearError()

    try {
      setLoading(true)
      await deleteAssetCalibrationTable(confirmDeleteId)
      invalidateCalibrationRows(confirmDeleteId)
      await reloadAssetCalibrationTables()

      if (editId === confirmDeleteId) {
        setFormData(emptyForm)
        setRowData({})
        setEditId(null)
        resetUploadState()
      }

      setConfirmDeleteId(null)
      notifySuccess('Asset Calibration Table deleted successfully')
    } catch (error) {
      notifyError(error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleCancelEdit = () => {
    setFormData(emptyForm)
    setRowData({})
    setEditId(null)
    resetUploadState()
  }

  /* ------------------------------------------------ bulk upload of tables */

  const today = useMemo(() => new Date().toISOString().slice(0, 10), [])

  const CALIBRATION_STATIC_FIELDS = useMemo(
    () => [
      {
        key: 'calibrationName',
        label: 'Calibration Name',
        required: true,
        example: 'Tank 1 Strapping 2026',
        aliases: ['Name', 'Table Name'],
        hint: 'Rows with the same name, asset and template go into one table',
      },
      {
        key: 'assetCode',
        label: 'Asset Code',
        required: true,
        example: 'TK-101',
        aliases: ['Asset'],
      },
      {
        key: 'templateName',
        label: 'Calibration Template',
        required: false,
        example: '',
        aliases: ['Template', 'Template Name'],
        hint: 'Leave blank to use the template selected above',
        defaultValue: activeTemplates[0]?.templateName || '',
      },
      {
        key: 'effectiveDate',
        label: 'Effective Date',
        required: false,
        example: today,
        hint: 'YYYY-MM-DD',
      },
      {
        key: 'status',
        label: 'Status',
        required: false,
        options: CALIBRATION_STATUSES,
        defaultValue: 'Active',
        example: 'Active',
      },
      { key: 'remarks', label: 'Remarks', required: false, example: '' },
    ],
    [activeTemplates, today]
  )

  const sortTemplateColumns = (template) =>
    [...(template?.columns || [])].sort(
      (a, b) => Number(a.sortOrder) - Number(b.sortOrder)
    )

  /** One entry per Calibration Template Master record – the template master. */
  const bulkTemplateOptions = useMemo(
    () =>
      activeTemplates.map((template) => ({
        id: String(template.id),
        name: `${template.templateName} (${template.assetTypeCode || 'any type'})`,
        system: false,
        columns: [
          ...CALIBRATION_STATIC_FIELDS.map((field) => ({
            key: field.key,
            label: field.label,
            included: true,
            aliases: field.aliases || [],
          })),
          ...sortTemplateColumns(template).map((column) => ({
            key: `${DYNAMIC_PREFIX}${column.columnName}`,
            label: column.columnName,
            included: true,
            aliases: [column.columnName],
          })),
        ],
      })),
    [activeTemplates, CALIBRATION_STATIC_FIELDS]
  )

  const [activeBulkTemplateId, setActiveBulkTemplateId] = useState('')

  const activeBulkTemplateRecord = useMemo(() => {
    const match = activeTemplates.find((item) => String(item.id) === String(activeBulkTemplateId))
    return match || activeTemplates[0] || null
  }, [activeTemplates, activeBulkTemplateId])

  const bulkBaseFields = useMemo(() => {
    const dynamic = sortTemplateColumns(activeBulkTemplateRecord).map((column) => ({
      key: `${DYNAMIC_PREFIX}${column.columnName}`,
      label: column.columnName,
      required: false,
      example: '',
      hint: `${column.dataType || 'Text'}${column.unit ? ` (${column.unit})` : ''}${
        column.isRequired === 'Yes' ? ' – required' : ''
      }`,
      aliases: [column.columnName],
    }))
    return [...CALIBRATION_STATIC_FIELDS, ...dynamic]
  }, [activeBulkTemplateRecord, CALIBRATION_STATIC_FIELDS])

  const bulkTemplates = useBulkTemplates('Asset Calibration Table', bulkBaseFields, {
    templates: bulkTemplateOptions,
    activeTemplateId: activeBulkTemplateRecord ? String(activeBulkTemplateRecord.id) : '',
    onSelectTemplate: setActiveBulkTemplateId,
  })

  const resolveTemplateForRow = (record) => {
    const requested = String(record.templateName || '').trim()
    if (requested) {
      const byName = activeTemplates.find(
        (item) => String(item.templateName).toLowerCase() === requested.toLowerCase()
      )
      if (byName) return byName
      return null
    }
    return activeBulkTemplateRecord
  }

  const handleCalibrationImportBatch = async (items) => {
    const overrides = []
    const groups = new Map()

    items.forEach(({ rowNumber, record }) => {
      const calibrationName = String(record.calibrationName || '').trim()
      const assetCode = String(record.assetCode || '').trim()
      const template = resolveTemplateForRow(record)

      if (!template) {
        overrides.push({
          rowNumber,
          status: 'skipped',
          message: `Unknown calibration template "${record.templateName}". Create it in Calibration Template Master first.`,
        })
        return
      }

      if (!activeAssets.some((asset) => String(asset.assetCode) === assetCode)) {
        overrides.push({
          rowNumber,
          status: 'skipped',
          message: `Unknown or inactive asset code "${assetCode}"`,
        })
        return
      }

      const rowData = {}
      let rowError = null

      for (const column of sortTemplateColumns(template)) {
        const rawValue = record[`${DYNAMIC_PREFIX}${column.columnName}`]
        const value = convertValueByDataType(rawValue, column.dataType)

        if (column.isRequired === 'Yes' && String(value ?? '').trim() === '') {
          rowError = `${column.columnName} is required`
          break
        }

        if (
          column.dataType === 'Number' &&
          String(value ?? '').trim() !== '' &&
          typeof value !== 'number'
        ) {
          rowError = `${column.columnName} must be a number (received "${rawValue}")`
          break
        }

        rowData[column.columnName] = value
      }

      if (rowError) {
        overrides.push({ rowNumber, status: 'skipped', message: rowError })
        return
      }

      const key = `${calibrationName.toLowerCase()}|${assetCode.toLowerCase()}|${template.id}`
      if (!groups.has(key)) {
        groups.set(key, {
          calibrationName,
          assetCode,
          template,
          effectiveDate: String(record.effectiveDate || '').trim(),
          status: record.status || 'Active',
          remarks: String(record.remarks || '').trim(),
          rows: [],
          rowNumbers: [],
        })
      }
      const group = groups.get(key)
      group.rows.push(rowData)
      group.rowNumbers.push(rowNumber)

      // First non-empty value for the header fields wins.
      if (!group.effectiveDate) group.effectiveDate = String(record.effectiveDate || '').trim()
      if (!group.remarks) group.remarks = String(record.remarks || '').trim()
    })

    for (const group of groups.values()) {
      const existing = (calibrationTables || []).find(
        (table) =>
          String(table.calibrationName).toLowerCase() === group.calibrationName.toLowerCase() &&
          String(table.assetCode).toLowerCase() === group.assetCode.toLowerCase()
      )

      const payload = {
        calibrationName: group.calibrationName,
        assetCode: group.assetCode,
        templateId: group.template.id,
        effectiveDate: group.effectiveDate || existing?.effectiveDate || '',
        remarks: group.remarks,
        status: group.status,
        rows: group.rows,
      }

      try {
        if (existing) {
          if (!canEdit) {
            overrides.push(
              ...group.rowNumbers.map((rowNumber) => ({
                rowNumber,
                status: 'skipped',
                message: `"${group.calibrationName}" already exists and you do not have Edit Asset Calibration`,
              }))
            )
            continue
          }
          await updateAssetCalibrationTable(existing.id, payload)
        } else {
          if (!canCreate) {
            overrides.push(
              ...group.rowNumbers.map((rowNumber) => ({
                rowNumber,
                status: 'skipped',
                message: 'You do not have Create Asset Calibration',
              }))
            )
            continue
          }
          await createAssetCalibrationTable(payload)
        }
      } catch (error) {
        const message = error?.message || 'Save failed'
        overrides.push(
          ...group.rowNumbers.map((rowNumber) => ({ rowNumber, status: 'failed', message }))
        )
      }
    }

    await reloadAssetCalibrationTables()
    return overrides
  }

  const calibrationImportConfig = {
    title: 'Bulk upload calibration data',
    description:
      'Upload an Excel (.xlsx) or CSV file. The column names must match the Calibration Template Master you configured. Rows are grouped by Calibration Name + Asset Code into one calibration table.',
    templateFileName: 'asset-calibration-table',
    fields: bulkTemplates.fields,
    templates: bulkTemplates.templates,
    activeTemplateId: bulkTemplates.activeTemplateId,
    onSelectTemplate: bulkTemplates.select,
    validateRow: (record) => {
      const template = resolveTemplateForRow(record)
      if (!template) {
        return `Unknown calibration template "${record.templateName}". Create it in Calibration Template Master first.`
      }
      return null
    },
    onImportBatch: handleCalibrationImportBatch,
    onComplete: async (summary) => {
      await reloadAssetCalibrationTables()
      if (summary.failed === 0 && summary.skipped === 0) {
        notifySuccess(`${summary.success} calibration row(s) uploaded successfully.`)
      } else {
        notifyError(
          `Upload finished: ${summary.success} imported, ${summary.skipped} skipped, ${summary.failed} failed.`
        )
      }
    },
  }

  return (
    <div>
      <div className="page-title">
        <div>
          <h2>Asset Calibration Table</h2>
          <p>
            Enter or upload calibration data for each asset based on its
            calibration template.
          </p>
        </div>

        <span className="record-count">
          {calibrationTables.length} Calibration Tables
        </span>
      </div>
      {/* Action feedback: right next to the page actions + a little pop-up
          toast - never at the bottom of the page (owner rule 8). */}
      <AlertMessage tone="success" message={feedback.successMsg} onDismiss={clearSuccess} />
      <AlertMessage tone="error" message={feedback.errorMsg} onDismiss={clearError} />

      {showUploadHelp && (
        <div className="help-modal-overlay">
          <div className="help-modal">
            <div className="help-modal-header">
              <h3>Calibration Data Upload Help</h3>

              <button
                type="button"
                className="help-close-button"
                onClick={() => setShowUploadHelp(false)}
              >
                ×
              </button>
            </div>

            <div className="help-modal-body">
              <p>
                The uploaded file must follow the column structure defined in the
                selected Calibration Template.
              </p>

              <div className="help-section">
                <h4>Column Header Rule</h4>
                <p>
                  The first row of your CSV file must contain column names.
                  These names must match the template column names.
                </p>

                <table>
                  <thead>
                    <tr>
                      <th>Template Column</th>
                      <th>CSV Header</th>
                      <th>Allowed?</th>
                    </tr>
                  </thead>

                  <tbody>
                    <tr>
                      <td>Ullage</td>
                      <td>Ullage</td>
                      <td>Yes</td>
                    </tr>
                    <tr>
                      <td>Volume</td>
                      <td>Volume</td>
                      <td>Yes</td>
                    </tr>
                    <tr>
                      <td>Ullage</td>
                      <td>ullage</td>
                      <td>Yes, case-insensitive</td>
                    </tr>
                    <tr>
                      <td>Volume</td>
                      <td>Tank Volume</td>
                      <td>No</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="help-section">
                <h4>Example file</h4>

                <pre>
{`Ullage,Volume
1,1000
2,2000
3,3000`}
                </pre>

                <p>
                  The same layout works as an Excel workbook (.xlsx) – put the
                  column names in the first row of the first sheet.
                </p>
              </div>

              <div className="help-section">
                <h4>Validations Applied</h4>

                <ul>
                  <li>Excel (.xlsx) and CSV (.csv) files are both accepted.</li>
                  <li>Asset and Calibration Template must be selected first.</li>
                  <li>All template columns must exist in the uploaded file.</li>
                  <li>Required columns cannot be blank.</li>
                  <li>Number columns must contain valid numeric values.</li>
                  <li>Extra uploaded columns are ignored if not in template.</li>
                  <li>
                    Uploaded rows are previewed first. They are not saved until
                    you click Replace Rows or Append Rows and then save the
                    calibration table.
                  </li>
                </ul>
              </div>

              {selectedTemplate && (
                <div className="help-section">
                  <h4>Expected Columns for Selected Template</h4>

                  <table>
                    <thead>
                      <tr>
                        <th>Column Name</th>
                        <th>Data Type</th>
                        <th>Unit</th>
                        <th>Required</th>
                      </tr>
                    </thead>

                    <tbody>
                      {sortedTemplateColumns.map((column) => (
                        <tr key={column.id || column.columnName}>
                          <td>{column.columnName}</td>
                          <td>{column.dataType}</td>
                          <td>{column.unit}</td>
                          <td>{column.isRequired}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {confirmRemoveRowIndex !== null && (
        <div className="confirm-overlay">
          <div className="confirm-box">
            <p>Are you sure you want to remove this row?</p>
            <div className="confirm-actions">
              <button onClick={confirmRemoveRow}>Yes, Remove</button>
              <button onClick={() => setConfirmRemoveRowIndex(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {confirmClearRows && (
        <div className="confirm-overlay">
          <div className="confirm-box">
            <p>Are you sure you want to clear all calibration rows?</p>
            <div className="confirm-actions">
              <button onClick={confirmClearAllRows}>Yes, Clear</button>
              <button onClick={() => setConfirmClearRows(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {confirmDeleteId && (
        <div className="confirm-overlay">
          <div className="confirm-box">
            <p>Are you sure you want to delete this calibration table?</p>
            <div className="confirm-actions">
              <button onClick={handleDelete} disabled={loading}>
                {loading ? 'Deleting...' : 'Yes, Delete'}
              </button>
              <button onClick={() => setConfirmDeleteId(null)} disabled={loading}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {validationErrors.rows && (
        <div className="error-box">{validationErrors.rows}</div>
      )}

      {!canCreate && !canEdit && !canDelete && (
        <div className="info-box">
          You are in view-only mode. Creating, editing and deleting calibration
          tables each need their own permission (Create Asset Calibration, Edit
          Asset Calibration, Delete Asset Calibration).
        </div>
      )}

      {canWrite && (
      <>
      <form onSubmit={handleSubmit}>
        <div>
          <label>Calibration Name</label>
          <input
            name="calibrationName"
            type="text"
            value={formData.calibrationName}
            onChange={(e) => { handleFormChange(e); setValidationErrors({ ...validationErrors, calibrationName: '' }) }}
            placeholder="Example: Tank 101 Dip Table 2026"
            className={validationErrors.calibrationName ? 'input-error' : ''}
          />
          {validationErrors.calibrationName && (
            <span className="field-error">{validationErrors.calibrationName}</span>
          )}
        </div>

        <div>
          <label>Asset</label>
          <select
            name="assetCode"
            value={formData.assetCode}
            onChange={(e) => { handleFormChange(e); setValidationErrors({ ...validationErrors, assetCode: '' }) }}
            className={validationErrors.assetCode ? 'input-error' : ''}
          >
            <option value="">Select Asset</option>

            {activeAssets.map((asset) => (
              <option key={asset.id} value={asset.assetCode}>
                {asset.assetName} ({asset.assetCode})
              </option>
            ))}
          </select>
          {validationErrors.assetCode && (
            <span className="field-error">{validationErrors.assetCode}</span>
          )}
        </div>

        <div>
          <label>Calibration Template</label>
          <select
            name="templateId"
            value={formData.templateId}
            onChange={(e) => { handleFormChange(e); setValidationErrors({ ...validationErrors, templateId: '' }) }}
            disabled={!selectedAsset}
            className={validationErrors.templateId ? 'input-error' : ''}
          >
            <option value="">
              {selectedAsset
                ? 'Select Calibration Template'
                : 'Select Asset First'}
            </option>

            {availableTemplates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.templateName}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label>Effective Date</label>
          <input
            name="effectiveDate"
            type="date"
            value={formData.effectiveDate}
            onChange={handleFormChange}
          />
        </div>

        <div>
          <label>Status</label>
          <select
            name="status"
            value={formData.status}
            onChange={handleFormChange}
          >
            <option>Active</option>
            <option>Inactive</option>
            <option>Blocked</option>
          </select>
        </div>

        <div className="full-width-field">
          <label>Remarks</label>
          <textarea
            name="remarks"
            value={formData.remarks}
            onChange={handleFormChange}
            placeholder="Enter remarks"
            rows="3"
          />
        </div>

        {selectedTemplate && (
          <>
            <div className="full-width-field">
              <div className="section-title compact-section-title">
                <div className="title-with-help">
                  <h3>Upload Calibration Data</h3>

                  <button
                    type="button"
                    className="small-help-icon-button"
                    onClick={() => setShowUploadHelp(true)}
                    title="Upload Help"
                  >
                    ?
                  </button>
                </div>

                <p>
                  Upload an Excel (.xlsx) or CSV file. Its headers must match the
                  columns of the selected Calibration Template. Click ? to view the
                  required structure.
                </p>

                <div className="upload-template-downloads">
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    onClick={() => downloadCalibrationTemplate('xlsx')}
                    disabled={loading}
                  >
                    <Icon name="fileSpreadsheet" size={14} />
                    Download XLSX template
                  </button>
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    onClick={() => downloadCalibrationTemplate('csv')}
                    disabled={loading}
                  >
                    <Icon name="fileText" size={14} />
                    Download CSV template
                  </button>
                </div>
              </div>
            </div>

            <div>
              <label>Upload Calibration File (.xlsx or .csv)</label>
              <input
                type="file"
                accept=".xlsx,.xlsm,.csv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                onChange={handleFileUpload}
                disabled={loading}
              />
            </div>

            <div>
              <label>Uploaded File</label>
              <input
                type="text"
                value={
                  uploadFileName
                    ? `${uploadFileName} (${uploadFileFormat})`
                    : ''
                }
                placeholder="No file uploaded"
                disabled
              />
            </div>

            {uploadValidationErrors.length > 0 && (
              <div className="full-width-field">
                <div className="info-box">
                  <strong>Upload validation errors:</strong>
                  <ul>
                    {uploadValidationErrors.map((error, index) => (
                      <li key={index}>{error}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {uploadedRows.length > 0 && (
              <>
                <div className="full-width-field">
                  <div className="section-title compact-section-title">
                    <h3>Uploaded Rows Preview</h3>
                    <p>
                      {uploadedRows.length} rows parsed successfully. Review and
                      add them to the calibration table.
                    </p>
                  </div>

                  <table>
                    <thead>
                      <tr>
                        <th>#</th>
                        {sortedTemplateColumns.map((column) => (
                          <th key={column.id || column.columnName}>
                            {column.columnName}
                          </th>
                        ))}
                      </tr>
                    </thead>

                    <tbody>
                      {uploadedRows.slice(0, 10).map((row, rowIndex) => (
                        <tr key={rowIndex}>
                          <td>{rowIndex + 1}</td>
                          {sortedTemplateColumns.map((column) => (
                            <td key={column.id || column.columnName}>
                              {String(row[column.columnName] ?? '')}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {uploadedRows.length > 10 && (
                    <div className="info-box">
                      Showing first 10 rows only. Total parsed rows:{' '}
                      {uploadedRows.length}
                    </div>
                  )}
                </div>

                <div className="form-actions">
                  <button
                    type="button"
                    onClick={handleUseUploadedRows}
                    disabled={loading}
                  >
                    Replace Rows
                  </button>

                  <button
                    type="button"
                    onClick={handleAppendUploadedRows}
                    disabled={loading}
                  >
                    Append Rows
                  </button>
                </div>
              </>
            )}

            <div className="full-width-field">
              <div className="section-title compact-section-title">
                <h3>Manual Row Entry</h3>
                <p>
                  You can also manually add rows. Fields are generated from the
                  selected calibration template.
                </p>
              </div>
            </div>

            {sortedTemplateColumns.map((column) => (
              <div key={column.id || column.columnName}>
                <label>
                  {column.columnName}
                  {column.unit ? ` (${column.unit})` : ''}
                  {column.isRequired === 'Yes' ? ' *' : ''}
                </label>
                <input
                  type={column.dataType === 'Number' ? 'number' : 'text'}
                  onWheel={(e) => e.target.blur()}
                  value={rowData[column.columnName] || ''}
                  onChange={(e) =>
                    handleRowChange(column.columnName, e.target.value)
                  }
                  placeholder={`Enter ${column.columnName}`}
                />
              </div>
            ))}

            <div className="form-actions">
              <button type="button" onClick={handleAddRow} disabled={loading}>
                Add Manual Row
              </button>

              {formData.rows.length > 0 && (
                <button type="button" onClick={() => { clearSuccess(); clearError(); setConfirmClearRows(true) }} disabled={loading}>
                  Clear Rows
                </button>
              )}
            </div>
          </>
        )}

        <div className="full-width-field">
          <table>
            <thead>
              <tr>
                <th>#</th>
                {sortedTemplateColumns.map((column) => (
                  <th key={column.id || column.columnName}>
                    {column.columnName}
                  </th>
                ))}
                <th>Action</th>
              </tr>
            </thead>

            <tbody>
              {formData.rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={sortedTemplateColumns.length + 2}
                    className="empty-table"
                  >
                    No calibration rows added yet.
                  </td>
                </tr>
              ) : (
                formData.rows.slice(0, visibleRowLimit).map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    <td>{rowIndex + 1}</td>
                    {sortedTemplateColumns.map((column) => (
                      <td key={column.id || column.columnName}>
                        {String(row[column.columnName] ?? '')}
                      </td>
                    ))}
                    <td>
                      <button
                        type="button"
                        onClick={() => { clearSuccess(); clearError(); setConfirmRemoveRowIndex(rowIndex) }}
                        disabled={loading}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          {formData.rows.length > visibleRowLimit && (
            <div className="info-box">
              Showing first {visibleRowLimit} rows only. Total rows added:{' '}
              {formData.rows.length}. All rows will be saved.
            </div>
          )}
        </div>

        <div className="form-actions">
          <ExportMenu
            rows={formData.rows}
            columns={sortedTemplateColumns.map((column) => ({
              key: column.columnName,
              label: column.columnName,
              type: column.dataType === 'Number' ? 'number' : undefined,
            }))}
            fileName={`asset-calibration-${String(formData.calibrationName || 'rows').replace(/\s+/g, '-').toLowerCase()}`}
            title={
              formData.calibrationName
                ? `Calibration rows – ${formData.calibrationName}`
                : 'Calibration rows'
            }
            module="Asset Calibration Table"
          />

          <button type="submit" disabled={loading}>
            {loading
              ? 'Please wait...'
              : editId === null
                ? 'Save Calibration Table'
                : 'Update Calibration Table'}
          </button>

          {editId !== null && (
            <button type="button" onClick={handleCancelEdit} disabled={loading}>
              Cancel Edit
            </button>
          )}
        </div>
      </form>

      </>
      )}

      <div className="section-title">
        <h3>Saved Asset Calibration Tables</h3>
        <p>Calibration rows are stored as JSONB in PostgreSQL.</p>
      </div>

      <DataTableToolbar
        filters={calibrationTablesFilters}
        columns={calibrationTablesFilters.columns}
        exportFileName="asset-calibration-table"
        exportTitle="Asset Calibration Table"
        importConfig={calibrationImportConfig}
        canImport={canWrite}
      />

      <table>
        <thead>
          <tr>
            <th>Calibration Name</th>
            <th>Asset</th>
            <th>Template</th>
            <th>Effective Date</th>
            <th>Rows</th>
            <th>Status</th>
            {(canEdit || canDelete) && <th>Actions</th>}
          </tr>
        </thead>

        <tbody>
          {calibrationTables.length === 0 ? (
            <tr>
              <td colSpan={canEdit || canDelete ? 7 : 6} className="empty-table">
                No asset calibration tables added yet.
              </td>
            </tr>
          ) : (
            visibleTables.map((table) => (
              <tr key={table.id}>
                <td>{table.calibrationName}</td>
                <td>
                  {table.assetName} ({table.assetCode})
                </td>
                <td>{table.templateName}</td>
                <td>{table.effectiveDate}</td>
                <td>{table.rowCount ?? table.rows.length}</td>
                <td>
                  <span className={`status-badge ${table.status.toLowerCase()}`}>
                    {table.status}
                  </span>
                </td>
                {(canEdit || canDelete) && (
                  <td>
                    {canEdit && (
                      <button type="button" onClick={() => handleEdit(table)}>
                        Edit
                      </button>
                    )}

                    {canDelete && (
                      <button type="button" onClick={() => { clearSuccess(); clearError(); setConfirmDeleteId(table.id) }}>
                        Delete
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))
          )}
        </tbody>
      </table>

      <PaginationControls currentPage={page} totalRows={calibrationTablesFilters.filteredRows.length} onPageChange={setPage} />

      <div className="info-box">
        CSV headers must match the selected calibration template columns.
        Parsed rows are saved into PostgreSQL JSONB.
      </div>
    </div>
  )
}

export default AssetCalibrationTable
