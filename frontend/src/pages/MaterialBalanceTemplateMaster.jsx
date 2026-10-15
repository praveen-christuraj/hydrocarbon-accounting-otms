import { useEffect, useMemo, useState } from 'react'
import {
  createMaterialBalanceTemplate,
  createMaterialBalanceTemplateColumn,
  deleteMaterialBalanceTemplate,
  deleteMaterialBalanceTemplateColumn,
  getMaterialBalanceTemplateDetail,
  getMaterialBalanceTemplates,
  getTankOperationsForMaterialBalance,
  updateMaterialBalanceTemplate,
  updateMaterialBalanceTemplateColumn,
} from '../api/materialBalanceTemplateApi'
import PaginationControls, { paginateRows, usePageSize } from '../components/common/PaginationControls'
import DataTableToolbar from '../components/common/DataTableToolbar'
import { useDataFilters } from '../hooks/useDataFilters'
import { useAutoColumns } from '../hooks/useAutoColumns'
import { usePermissions } from '../hooks/usePermissions'

const columnTypes = [
  'OPENING',
  'MOVEMENT',
  'BOOK_CLOSING',
  'ACTUAL_CLOSING',
  'LOSS_GAIN',
  'FORMULA',
  'INFO',
]

const movementDirections = ['IN', 'OUT', 'NEUTRAL']

function MaterialBalanceTemplateMaster({ locations, loggedInUser }) {
  const { hasPermission } = usePermissions(loggedInUser)
  const canCreate = hasPermission('Create Material Balance Template')
  const canEdit = hasPermission('Edit Material Balance Template')

  const emptyTemplateForm = {
    id: null,
    locationCode: '',
    templateName: '',
    description: '',
    status: 'Active',
  }

  const emptyColumnForm = {
    id: null,
    columnLabel: '',
    columnKey: '',
    columnOrder: 1,
    columnType: 'MOVEMENT',
    movementDirection: 'IN',
    mappedOperationCodes: [],
    excludedOperationCodes: [],
    includeInMaterialBalance: 'Yes',
    includeInBookClosing: 'Yes',
    isInternalTransfer: 'No',
    formulaJson: null,
    remarks: '',
    status: 'Active',
  }

  const [templates, setTemplates] = useState([])
  const [selectedTemplate, setSelectedTemplate] = useState(null)
  const [templateForm, setTemplateForm] = useState(emptyTemplateForm)
  const [columnForm, setColumnForm] = useState(emptyColumnForm)
  const [tankOperations, setTankOperations] = useState([])
  const [loading, setLoading] = useState(false)
  const [savingTemplate, setSavingTemplate] = useState(false)
  const [savingColumn, setSavingColumn] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [validationErrors, setValidationErrors] = useState({})
  const [confirmDeleteTemplateItem, setConfirmDeleteTemplateItem] = useState(null)
  const [confirmDeleteColumnItem, setConfirmDeleteColumnItem] = useState(null)
  const [confirmAddStandard, setConfirmAddStandard] = useState(false)
  const [page, setPage] = useState(1)

  const pageSize = usePageSize()
  const templatesFilters = useDataFilters(templates, useAutoColumns(templates), { module: 'Material Balance Template Configuration' })
  const visibleTemplates = paginateRows(templatesFilters.filteredRows, page, pageSize)

  const activeLocations = useMemo(() => {
    return (locations || []).filter((location) => location.status === 'Active')
  }, [locations])

  const filteredTankOperations = useMemo(() => {
    return (tankOperations || []).filter((operation) => {
      if (operation.status !== 'Active') {
        return false
      }

      if (columnForm.columnType === 'MOVEMENT' && columnForm.movementDirection) {
        return operation.operationSign === columnForm.movementDirection
      }

      return true
    })
  }, [tankOperations, columnForm.columnType, columnForm.movementDirection])

  const selectedColumns = useMemo(() => {
    return [...(selectedTemplate?.columns || [])].sort((a, b) => {
      if (a.columnOrder !== b.columnOrder) {
        return a.columnOrder - b.columnOrder
      }

      return a.id - b.id
    })
  }, [selectedTemplate])

  const loadTemplates = async (locationCode = templateForm.locationCode) => {
    try {
      setLoading(true)
      setSuccessMsg('')
      setErrorMsg('')

      const data = await getMaterialBalanceTemplates({
        locationCode,
      })

      setTemplates(data)
    } catch (error) {
      setErrorMsg(error.message)
    } finally {
      setLoading(false)
    }
  }

  const loadTankOperations = async (locationCode) => {
    if (!locationCode) {
      setTankOperations([])
      return
    }

    try {
      const data = await getTankOperationsForMaterialBalance({
        locationCode,
        status: 'Active',
      })

      setTankOperations(data)
    } catch (error) {
      setErrorMsg(error.message)
    }
  }

  const loadTemplateDetail = async (templateId) => {
    try {
      setLoading(true)
      setSuccessMsg('')
      setErrorMsg('')

      const data = await getMaterialBalanceTemplateDetail(templateId)
      setSelectedTemplate(data)
      setTemplateForm({
        id: data.id,
        locationCode: data.locationCode,
        templateName: data.templateName,
        description: data.description,
        status: data.status,
      })
      setColumnForm(emptyColumnForm)
      await loadTankOperations(data.locationCode)
    } catch (error) {
      setErrorMsg(error.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadTemplates('')
  }, [])

  const generateColumnKey = (label) => {
    return String(label || '')
      .trim()
      .toLowerCase()
      .replaceAll(' ', '_')
      .replaceAll('-', '_')
      .replaceAll('/', '_')
      .replace(/_+/g, '_')
      .toUpperCase()
  }

  const handleTemplateChange = async (e) => {
    const { name, value } = e.target

    if (name === 'locationCode') {
      setTemplateForm({
        ...templateForm,
        locationCode: value,
      })
      setSelectedTemplate(null)
      setColumnForm(emptyColumnForm)
      await loadTemplates(value)
      await loadTankOperations(value)
      return
    }

    setTemplateForm({
      ...templateForm,
      [name]: value,
    })
  }

  const handleColumnChange = (e) => {
    const { name, value } = e.target

    if (name === 'columnLabel') {
      setColumnForm({
        ...columnForm,
        columnLabel: value,
        columnKey: columnForm.columnKey || generateColumnKey(value),
      })
      return
    }

    if (name === 'columnType') {
      const nextForm = {
        ...columnForm,
        columnType: value,
      }

      if (value !== 'MOVEMENT') {
        nextForm.movementDirection = ''
        nextForm.mappedOperationCodes = []
        nextForm.excludedOperationCodes = []
      } else {
        nextForm.movementDirection = nextForm.movementDirection || 'IN'
      }

      setColumnForm(nextForm)
      return
    }

    if (name === 'movementDirection') {
      setColumnForm({
        ...columnForm,
        movementDirection: value,
        mappedOperationCodes: [],
        excludedOperationCodes: [],
      })
      return
    }

    if (name === 'isInternalTransfer') {
      if (value === 'Yes') {
        setColumnForm({
          ...columnForm,
          isInternalTransfer: 'Yes',
          includeInMaterialBalance: 'No',
          includeInBookClosing: 'No',
        })
        return
      }

      setColumnForm({
        ...columnForm,
        isInternalTransfer: 'No',
      })
      return
    }

    setColumnForm({
      ...columnForm,
      [name]: value,
    })
  }

  const handleMappedOperationToggle = (operationCode) => {
    const exists = columnForm.mappedOperationCodes.includes(operationCode)

    setColumnForm({
      ...columnForm,
      mappedOperationCodes: exists
        ? columnForm.mappedOperationCodes.filter((code) => code !== operationCode)
        : [...columnForm.mappedOperationCodes, operationCode],
    })
  }

  const handleExcludedOperationToggle = (operationCode) => {
    const exists = columnForm.excludedOperationCodes.includes(operationCode)

    setColumnForm({
      ...columnForm,
      excludedOperationCodes: exists
        ? columnForm.excludedOperationCodes.filter((code) => code !== operationCode)
        : [...columnForm.excludedOperationCodes, operationCode],
    })
  }

  /* -------------------------------------------------------- bulk upload */

  const TEMPLATE_STATUSES = ['Active', 'Inactive', 'Blocked']
  const YES_NO = ['Yes', 'No']

  const importConfig = {
    title: 'Bulk upload material balance templates',
    description:
      'Upload an Excel (.xlsx) or CSV file with ONE ROW PER TEMPLATE COLUMN. Rows that share the same Location + Template Name are grouped into one template; the template columns only need a value on the first row of each group. Operation codes accept a semicolon separated list.',
    templateFileName: 'material-balance-template',
    fields: [
      { key: 'locationCode', label: 'Location Code', required: true, example: 'UTP', aliases: ['Location'] },
      { key: 'templateName', label: 'Template Name', required: true, example: 'Daily Tank Balance', aliases: ['Template'] },
      { key: 'description', label: 'Template Description', example: '' },
      { key: 'columnLabel', label: 'Column Label', required: true, example: 'Receipts' },
      { key: 'columnKey', label: 'Column Key', required: true, example: 'receipts', aliases: ['Key'] },
      { key: 'columnOrder', label: 'Column Order', example: '1', hint: 'Whole number' },
      { key: 'columnType', label: 'Column Type', required: true, options: columnTypes, defaultValue: 'MOVEMENT', example: 'MOVEMENT' },
      { key: 'movementDirection', label: 'Movement Direction', options: movementDirections, defaultValue: 'IN', example: 'IN' },
      { key: 'mappedOperationCodes', label: 'Mapped Operation Codes', example: 'RECEIPT', hint: 'Semicolon separated' },
      { key: 'excludedOperationCodes', label: 'Excluded Operation Codes', example: '', hint: 'Semicolon separated' },
      { key: 'includeInMaterialBalance', label: 'Include In Material Balance', options: YES_NO, defaultValue: 'Yes', example: 'Yes' },
      { key: 'includeInBookClosing', label: 'Include In Book Closing', options: YES_NO, defaultValue: 'Yes', example: 'Yes' },
      { key: 'isInternalTransfer', label: 'Is Internal Transfer', options: YES_NO, defaultValue: 'No', example: 'No' },
      { key: 'remarks', label: 'Column Remarks', example: '' },
      { key: 'status', label: 'Status', options: TEMPLATE_STATUSES, defaultValue: 'Active', example: 'Active' },
    ],
    validateRow: (record) => {
      const location = activeLocations.find(
        (item) => String(item.locationCode).toLowerCase() === String(record.locationCode).trim().toLowerCase()
      )
      if (!location) return `Unknown or inactive location code "${record.locationCode}"`
      if (!columnTypes.includes(String(record.columnType).trim().toUpperCase())) {
        return `Column Type must be one of ${columnTypes.join(', ')}`
      }
      if (record.columnType === 'MOVEMENT' && !movementDirections.includes(String(record.movementDirection || 'IN').trim().toUpperCase())) {
        return `Movement Direction must be one of ${movementDirections.join(', ')}`
      }
      const yesNoFields = ['includeInMaterialBalance', 'includeInBookClosing', 'isInternalTransfer']
      const badFlag = yesNoFields.find(
        (fieldName) => record[fieldName] && !YES_NO.includes(String(record[fieldName]).trim())
      )
      if (badFlag) return `${badFlag} must be Yes or No`
      if (record.columnOrder && !Number.isFinite(Number(record.columnOrder))) {
        return 'Column Order must be a number'
      }
      if (record.status && !TEMPLATE_STATUSES.includes(record.status)) {
        return `Status must be one of ${TEMPLATE_STATUSES.join(', ')}`
      }
      return null
    },
    onImportBatch: async (items) => {
      const overrides = []
      const groups = new Map()
      const splitCodes = (value) =>
        String(value || '')
          .split(';')
          .map((part) => part.trim())
          .filter(Boolean)

      items.forEach(({ rowNumber, record }) => {
        const locationCode = String(record.locationCode || '').trim()
        const templateName = String(record.templateName || '').trim()
        const key = `${locationCode.toLowerCase()}|${templateName.toLowerCase()}`
        if (!groups.has(key)) {
          groups.set(key, {
            locationCode,
            templateName,
            description: String(record.description || '').trim(),
            status: record.status || 'Active',
            columns: [],
            rowNumbers: [],
          })
        }
        const group = groups.get(key)
        if (!group.description) group.description = String(record.description || '').trim()

        const columnKey = String(record.columnKey || '').trim()
        if (group.columns.some((item) => String(item.columnKey).toLowerCase() === columnKey.toLowerCase())) {
          overrides.push({
            rowNumber,
            status: 'skipped',
            message: `Duplicate column key "${columnKey}" in template "${templateName}"`,
          })
          return
        }

        group.columns.push({
          columnLabel: String(record.columnLabel || '').trim(),
          columnKey,
          columnOrder:
            record.columnOrder === '' || record.columnOrder === undefined
              ? group.columns.length + 1
              : Number(record.columnOrder),
          columnType: String(record.columnType || 'MOVEMENT').trim().toUpperCase(),
          movementDirection: String(record.movementDirection || 'IN').trim().toUpperCase(),
          mappedOperationCodes: splitCodes(record.mappedOperationCodes),
          excludedOperationCodes: splitCodes(record.excludedOperationCodes),
          includeInMaterialBalance: String(record.includeInMaterialBalance || 'Yes').trim(),
          includeInBookClosing: String(record.includeInBookClosing || 'Yes').trim(),
          isInternalTransfer: String(record.isInternalTransfer || 'No').trim(),
          formulaJson: null,
          remarks: String(record.remarks || '').trim(),
          status: 'Active',
        })
        group.rowNumbers.push(rowNumber)
      })

      for (const group of groups.values()) {
        try {
          let template = templates.find(
            (item) =>
              String(item.locationCode).toLowerCase() === group.locationCode.toLowerCase() &&
              String(item.templateName).toLowerCase() === group.templateName.toLowerCase()
          )

          if (!template) {
            if (!canCreate) {
              overrides.push(
                ...group.rowNumbers.map((rowNumber) => ({
                  rowNumber,
                  status: 'skipped',
                  message: 'You do not have Create Material Balance Template',
                }))
              )
              continue
            }
            template = await createMaterialBalanceTemplate({
              locationCode: group.locationCode,
              templateName: group.templateName,
              description: group.description,
              status: group.status,
            })
          } else if (!canEdit) {
            overrides.push(
              ...group.rowNumbers.map((rowNumber) => ({
                rowNumber,
                status: 'skipped',
                message: `"${group.templateName}" already exists and you do not have Edit Material Balance Template`,
              }))
            )
            continue
          }

          const existingColumns = template.columns || []
          for (const column of group.columns) {
            const existing = existingColumns.find(
              (item) => String(item.columnKey).toLowerCase() === column.columnKey.toLowerCase()
            )
            if (existing) {
              await updateMaterialBalanceTemplateColumn(existing.id, { ...column, id: existing.id })
            } else {
              await createMaterialBalanceTemplateColumn(template.id, column)
            }
          }
        } catch (error) {
          const message = error?.message || 'Save failed'
          overrides.push(
            ...group.rowNumbers.map((rowNumber) => ({ rowNumber, status: 'failed', message }))
          )
        }
      }

      await loadTemplates('')
      return overrides
    },
    onComplete: async () => {
      await loadTemplates('')
      if (selectedTemplate?.id) await loadTemplateDetail(selectedTemplate.id)
    },
  }

  const handleSaveTemplate = async (e) => {
    e.preventDefault()
    setSuccessMsg('')
    setErrorMsg('')
    setValidationErrors({})

    const errors = {}

    if (!templateForm.locationCode) {
      errors.locationCode = 'Location is required'
    }

    if (!templateForm.templateName.trim()) {
      errors.templateName = 'Template Name is required'
    }

    setValidationErrors(errors)

    if (Object.keys(errors).length > 0) {
      return
    }

    try {
      setSavingTemplate(true)

      let savedTemplate

      if (templateForm.id) {
        savedTemplate = await updateMaterialBalanceTemplate(
          templateForm.id,
          templateForm
        )
      } else {
        savedTemplate = await createMaterialBalanceTemplate(templateForm)
      }

      await loadTemplates(templateForm.locationCode)
      await loadTemplateDetail(savedTemplate.id)
      setSuccessMsg('Material Balance Template saved successfully')
    } catch (error) {
      setErrorMsg(error.message)
    } finally {
      setSavingTemplate(false)
    }
  }

  const handleNewTemplate = () => {
    setSelectedTemplate(null)
    setTemplateForm({
      ...emptyTemplateForm,
      locationCode: templateForm.locationCode,
    })
    setColumnForm(emptyColumnForm)
  }

  const confirmDeleteTemplate = async () => {
    setSuccessMsg('')
    setErrorMsg('')

    try {
      await deleteMaterialBalanceTemplate(confirmDeleteTemplateItem.id)
      setSelectedTemplate(null)
      setTemplateForm({
        ...emptyTemplateForm,
        locationCode: templateForm.locationCode,
      })
      setColumnForm(emptyColumnForm)
      setConfirmDeleteTemplateItem(null)
      await loadTemplates(confirmDeleteTemplateItem.locationCode)
      setSuccessMsg('Material Balance Template deleted successfully')
    } catch (error) {
      setErrorMsg(error.message)
    }
  }

  const validateColumnBeforeSave = () => {
    const errors = {}

    if (!selectedTemplate?.id) {
      setErrorMsg('Please select or save a template first')
      return false
    }

    if (!columnForm.columnLabel.trim()) {
      errors.columnLabel = 'Column Label is required'
    }

    if (!columnForm.columnKey.trim()) {
      errors.columnKey = 'Column Key is required'
    }

    if (columnForm.columnType === 'MOVEMENT') {
      if (!columnForm.movementDirection) {
        errors.movementDirection = 'Movement Direction is required for MOVEMENT columns'
      }

      if (columnForm.mappedOperationCodes.length === 0) {
        errors.mappedOperationCodes = 'Select at least one mapped Tank Operation'
      }
    }

    setValidationErrors(errors)
    return Object.keys(errors).length === 0
  }

  const handleSaveColumn = async (e) => {
    e.preventDefault()
    setSuccessMsg('')
    setErrorMsg('')
    setValidationErrors({})

    if (!validateColumnBeforeSave()) {
      return
    }

    try {
      setSavingColumn(true)

      if (columnForm.id) {
        await updateMaterialBalanceTemplateColumn(columnForm.id, columnForm)
      } else {
        await createMaterialBalanceTemplateColumn(
          selectedTemplate.id,
          columnForm
        )
      }

      await loadTemplateDetail(selectedTemplate.id)
      setColumnForm(emptyColumnForm)
      setSuccessMsg('Material Balance column saved successfully')
    } catch (error) {
      setErrorMsg(error.message)
    } finally {
      setSavingColumn(false)
    }
  }

  const handleEditColumn = (column) => {
    setColumnForm({
      ...emptyColumnForm,
      ...column,
      mappedOperationCodes: column.mappedOperationCodes || [],
      excludedOperationCodes: column.excludedOperationCodes || [],
    })
  }

  const confirmDeleteColumn = async () => {
    setSuccessMsg('')
    setErrorMsg('')

    try {
      await deleteMaterialBalanceTemplateColumn(confirmDeleteColumnItem.id)
      setConfirmDeleteColumnItem(null)
      await loadTemplateDetail(selectedTemplate.id)
      setSuccessMsg('Material Balance column deleted successfully')
    } catch (error) {
      setErrorMsg(error.message)
    }
  }

  const executeAddStandardColumns = async () => {
    setSuccessMsg('')
    setErrorMsg('')

    const standardColumns = [
      {
        columnLabel: 'Opening Stock',
        columnKey: 'OPENING_STOCK',
        columnOrder: 1,
        columnType: 'OPENING',
        movementDirection: '',
        mappedOperationCodes: [],
        excludedOperationCodes: [],
        includeInMaterialBalance: 'Yes',
        includeInBookClosing: 'Yes',
        isInternalTransfer: 'No',
        formulaJson: null,
        remarks: '',
        status: 'Active',
      },
      {
        columnLabel: 'Book Closing Stock',
        columnKey: 'BOOK_CLOSING_STOCK',
        columnOrder: 90,
        columnType: 'BOOK_CLOSING',
        movementDirection: '',
        mappedOperationCodes: [],
        excludedOperationCodes: [],
        includeInMaterialBalance: 'Yes',
        includeInBookClosing: 'Yes',
        isInternalTransfer: 'No',
        formulaJson: null,
        remarks: '',
        status: 'Active',
      },
      {
        columnLabel: 'Closing Stock',
        columnKey: 'CLOSING_STOCK',
        columnOrder: 91,
        columnType: 'ACTUAL_CLOSING',
        movementDirection: '',
        mappedOperationCodes: [],
        excludedOperationCodes: [],
        includeInMaterialBalance: 'Yes',
        includeInBookClosing: 'Yes',
        isInternalTransfer: 'No',
        formulaJson: null,
        remarks: '',
        status: 'Active',
      },
      {
        columnLabel: 'Loss/Gain',
        columnKey: 'LOSS_GAIN',
        columnOrder: 92,
        columnType: 'LOSS_GAIN',
        movementDirection: '',
        mappedOperationCodes: [],
        excludedOperationCodes: [],
        includeInMaterialBalance: 'Yes',
        includeInBookClosing: 'Yes',
        isInternalTransfer: 'No',
        formulaJson: null,
        remarks: '',
        status: 'Active',
      },
    ]

    try {
      for (const column of standardColumns) {
        await createMaterialBalanceTemplateColumn(selectedTemplate.id, column)
      }

      setConfirmAddStandard(false)
      await loadTemplateDetail(selectedTemplate.id)
      setSuccessMsg('Standard columns added successfully')
    } catch (error) {
      setErrorMsg(error.message)
    }
  }

  const renderOperationCheckboxes = () => {
    if (columnForm.columnType !== 'MOVEMENT') {
      return null
    }

    return (
      <>
        <div className="full-width-field">
          <label>Mapped Tank Operations</label>
          <div className="operation-checkbox-grid">
            {filteredTankOperations.length === 0 ? (
              <div className="empty-table">
                No active Tank Operations found for this direction/location.
              </div>
            ) : (
              filteredTankOperations.map((operation) => (
                <label key={operation.id} className="operation-checkbox-card">
                  <input
                    type="checkbox"
                    checked={columnForm.mappedOperationCodes.includes(
                      operation.operationCode
                    )}
                    onChange={() =>
                      handleMappedOperationToggle(operation.operationCode)
                    }
                  />

                  <div>
                    <strong>{operation.operationLabel}</strong>
                    <span>
                      {operation.operationCode} / {operation.operationSign} /{' '}
                      {operation.operationCategory}
                    </span>
                  </div>
                </label>
              ))
            )}
          </div>
        </div>

        <div className="full-width-field">
          <label>Excluded Operations from this Column</label>
          <p className="field-help-text">
            Use this for exemptions like ITT IN / ITT OUT / Internal Tank
            Transfers. Excluded operations will not be counted in this Material
            Balance column.
          </p>

          <div className="operation-checkbox-grid">
            {filteredTankOperations.length === 0 ? (
              <div className="empty-table">
                No active Tank Operations found for exclusion.
              </div>
            ) : (
              filteredTankOperations.map((operation) => (
                <label
                  key={`excluded-${operation.id}`}
                  className="operation-checkbox-card"
                >
                  <input
                    type="checkbox"
                    checked={columnForm.excludedOperationCodes.includes(
                      operation.operationCode
                    )}
                    onChange={() =>
                      handleExcludedOperationToggle(operation.operationCode)
                    }
                  />

                  <div>
                    <strong>{operation.operationLabel}</strong>
                    <span>
                      {operation.operationCode} / {operation.operationSign} /{' '}
                      {operation.operationCategory}
                    </span>
                  </div>
                </label>
              ))
            )}
          </div>
        </div>
      </>
    )
  }

  return (
    <div>
      <div className="page-title">
        <div>
          <h2>Material Balance Template Configuration</h2>
          <p>
            Configure location-wise Material Balance columns from Tank
            Operations. No report columns are hardcoded.
          </p>
        </div>

        <span className="record-count">{templates.length} Templates</span>
      </div>

      <div className="info-box">
        Material Balance columns are configured from Tank Operations. IN
        operations like Receipt / Production / Receipt from X can be mapped to
        receipt columns. OUT operations like Dispatch / Draining can be mapped
        to dispatch columns. ITT/Internal Tank Transfers can be tracked but
        excluded from Material Balance and Book Closing.
      </div>

      {confirmDeleteTemplateItem && (
        <div className="confirm-overlay">
          <div className="confirm-box">
            <p>Delete Material Balance Template "<strong>{confirmDeleteTemplateItem.templateName}</strong>"?</p>
            <div className="confirm-actions">
              <button onClick={confirmDeleteTemplate}>Yes, Delete</button>
              <button onClick={() => setConfirmDeleteTemplateItem(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {confirmDeleteColumnItem && (
        <div className="confirm-overlay">
          <div className="confirm-box">
            <p>Delete column "<strong>{confirmDeleteColumnItem.columnLabel}</strong>" from this template?</p>
            <div className="confirm-actions">
              <button onClick={confirmDeleteColumn}>Yes, Delete</button>
              <button onClick={() => setConfirmDeleteColumnItem(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {confirmAddStandard && (
        <div className="confirm-overlay">
          <div className="confirm-box">
            <p>Add standard columns: Opening Stock, Book Closing Stock, Closing Stock, Loss/Gain?</p>
            <div className="confirm-actions">
              <button onClick={executeAddStandardColumns}>Yes, Add</button>
              <button onClick={() => setConfirmAddStandard(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      <form onSubmit={handleSaveTemplate}>
        <div>
          <label>Location</label>
          <select
            name="locationCode"
            value={templateForm.locationCode}
            onChange={handleTemplateChange}
            disabled={savingTemplate || loading}
            className={validationErrors.locationCode ? 'input-error' : ''}
          >
            <option value="">Select Location</option>

            {activeLocations.map((location) => (
              <option key={location.id} value={location.locationCode}>
                {location.locationName} ({location.locationCode})
              </option>
            ))}
          </select>
          {validationErrors.locationCode && (
            <span className="field-error">{validationErrors.locationCode}</span>
          )}
        </div>

        <div>
          <label>Template Name</label>
          <input
            name="templateName"
            type="text"
            value={templateForm.templateName}
            onChange={(e) => { handleTemplateChange(e); setValidationErrors({ ...validationErrors, templateName: '' }) }}
            placeholder="Example: UTP Daily Material Balance"
            disabled={savingTemplate}
            className={validationErrors.templateName ? 'input-error' : ''}
          />
          {validationErrors.templateName && (
            <span className="field-error">{validationErrors.templateName}</span>
          )}
        </div>

        <div>
          <label>Status</label>
          <select
            name="status"
            value={templateForm.status}
            onChange={handleTemplateChange}
            disabled={savingTemplate}
          >
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
          </select>
        </div>

        <div className="full-width-field">
          <label>Description</label>
          <textarea
            name="description"
            rows="2"
            value={templateForm.description}
            onChange={handleTemplateChange}
            placeholder="Optional description"
            disabled={savingTemplate}
          />
        </div>

        <div className="form-actions">
          <button type="submit" disabled={savingTemplate || loading}>
            {savingTemplate ? 'Saving...' : 'Save Template'}
          </button>

          <button type="button" onClick={handleNewTemplate} disabled={loading}>
            New Template
          </button>
        </div>
      </form>

      <div className="section-title">
        <h3>Existing Templates</h3>
        <p>Select a template to configure its report columns.</p>
      </div>

      <DataTableToolbar
        filters={templatesFilters}
        columns={templatesFilters.columns}
        exportFileName="material-balance-template-configuration"
        exportTitle="Material Balance Template Configuration"
        module="Material Balance Template"
        importConfig={importConfig}
        canImport={canCreate || canEdit}
      />

      <table>
        <thead>
          <tr>
            <th>Location</th>
            <th>Template Name</th>
            <th>Description</th>
            <th>Status</th>
            <th>Columns</th>
            <th>Actions</th>
          </tr>
        </thead>

        <tbody>
          {templates.length === 0 ? (
            <tr>
              <td colSpan="6" className="empty-table">
                No Material Balance templates found.
              </td>
            </tr>
          ) : (
            visibleTemplates.map((template) => (
              <tr key={template.id}>
                <td>{template.locationCode}</td>
                <td>{template.templateName}</td>
                <td>{template.description || '-'}</td>
                <td>
                  <span className={`status-badge ${template.status.toLowerCase()}`}>
                    {template.status}
                  </span>
                </td>
                <td>{template.columns?.length || 0}</td>
                <td>
                  <button
                    type="button"
                    onClick={() => loadTemplateDetail(template.id)}
                  >
                    Open
                  </button>

                  <button
                    type="button"
                    onClick={() => { setSuccessMsg(''); setErrorMsg(''); setConfirmDeleteTemplateItem(template) }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))
          )}
          </tbody>
      </table>

      <PaginationControls currentPage={page} totalRows={templatesFilters.filteredRows.length} onPageChange={setPage} />

      {selectedTemplate && (
        <>
          <div className="section-title">
            <h3>Template Columns</h3>
            <p>
              Configure the visible report columns and map movement columns to
              Tank Operation codes.
            </p>
          </div>

          <div className="template-action-bar">
            <strong>
              Selected Template: {selectedTemplate.templateName} (
              {selectedTemplate.locationCode})
            </strong>

            <button type="button" onClick={() => { setSuccessMsg(''); setErrorMsg(''); setConfirmAddStandard(true) }}>
              Add Standard Columns
            </button>
          </div>

          <form onSubmit={handleSaveColumn}>
            <div>
              <label>Column Order</label>
              <input
                name="columnOrder"
                type="number"
                value={columnForm.columnOrder}
                onChange={handleColumnChange}
                disabled={savingColumn}
              />
            </div>

            <div>
              <label>Column Type</label>
              <select
                name="columnType"
                value={columnForm.columnType}
                onChange={handleColumnChange}
                disabled={savingColumn}
              >
                {columnTypes.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </div>

            {columnForm.columnType === 'MOVEMENT' && (
              <div>
                <label>Movement Direction</label>
                <select
                  name="movementDirection"
                  value={columnForm.movementDirection}
                  onChange={handleColumnChange}
                  disabled={savingColumn}
                >
                  {movementDirections.map((direction) => (
                    <option key={direction} value={direction}>
                      {direction}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label>Include in Material Balance</label>
              <select
                name="includeInMaterialBalance"
                value={columnForm.includeInMaterialBalance}
                onChange={handleColumnChange}
                disabled={
                  savingColumn || columnForm.isInternalTransfer === 'Yes'
                }
              >
                <option value="Yes">Yes</option>
                <option value="No">No</option>
              </select>
            </div>

            <div>
              <label>Include in Book Closing</label>
              <select
                name="includeInBookClosing"
                value={columnForm.includeInBookClosing}
                onChange={handleColumnChange}
                disabled={
                  savingColumn || columnForm.isInternalTransfer === 'Yes'
                }
              >
                <option value="Yes">Yes</option>
                <option value="No">No</option>
              </select>
            </div>

            <div>
              <label>Internal Transfer / ITT</label>
              <select
                name="isInternalTransfer"
                value={columnForm.isInternalTransfer}
                onChange={handleColumnChange}
                disabled={savingColumn}
              >
                <option value="No">No</option>
                <option value="Yes">Yes</option>
              </select>
            </div>

            <div>
              <label>Status</label>
              <select
                name="status"
                value={columnForm.status}
                onChange={handleColumnChange}
                disabled={savingColumn}
              >
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </select>
            </div>

            <div className="full-width-field">
              <label>Remarks</label>
              <textarea
                name="remarks"
                rows="2"
                value={columnForm.remarks}
                onChange={handleColumnChange}
                placeholder="Optional remarks"
                disabled={savingColumn}
              />
            </div>

            {renderOperationCheckboxes()}

            <div>
              <label>Column Label</label>
              <input
                name="columnLabel"
                type="text"
                value={columnForm.columnLabel}
                onChange={(e) => { handleColumnChange(e); setValidationErrors({ ...validationErrors, columnLabel: '' }) }}
                placeholder="Example: Receipt from X"
                disabled={savingColumn}
                className={validationErrors.columnLabel ? 'input-error' : ''}
              />
              {validationErrors.columnLabel && (
                <span className="field-error">{validationErrors.columnLabel}</span>
              )}
            </div>

            <div>
              <label>Column Key</label>
              <input
                name="columnKey"
                type="text"
                value={columnForm.columnKey}
                onChange={(e) => { handleColumnChange(e); setValidationErrors({ ...validationErrors, columnKey: '' }) }}
                placeholder="Example: RECEIPT_FROM_X"
                disabled={savingColumn}
                className={validationErrors.columnKey ? 'input-error' : ''}
              />
              {validationErrors.columnKey && (
                <span className="field-error">{validationErrors.columnKey}</span>
              )}
            </div>

            {validationErrors.mappedOperationCodes && (
              <div className="full-width-field">
                <span className="field-error">{validationErrors.mappedOperationCodes}</span>
              </div>
            )}

            <div className="form-actions">
              <button type="submit" disabled={savingColumn}>
                {savingColumn
                  ? 'Saving...'
                  : columnForm.id
                    ? 'Update Column'
                    : 'Add Column'}
              </button>

              <button
                type="button"
                onClick={() => setColumnForm(emptyColumnForm)}
                disabled={savingColumn}
              >
                Clear Column
              </button>
            </div>
          </form>

          <table>
            <thead>
              <tr>
                <th>Order</th>
                <th>Column Label</th>
                <th>Type</th>
                <th>Direction</th>
                <th>Mapped Operations</th>
                <th>Excluded Operations</th>
                <th>MB</th>
                <th>Book</th>
                <th>ITT</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>

            <tbody>
              {selectedColumns.length === 0 ? (
                <tr>
                  <td colSpan="11" className="empty-table">
                    No columns configured for this template.
                  </td>
                </tr>
              ) : (
                selectedColumns.map((column) => (
                  <tr key={column.id}>
                    <td>{column.columnOrder}</td>
                    <td>
                      <strong>{column.columnLabel}</strong>
                      <div className="muted-table-text">{column.columnKey}</div>
                    </td>
                    <td>{column.columnType}</td>
                    <td>{column.movementDirection || '-'}</td>
                    <td>
                      {(column.mappedOperationCodes || []).length === 0
                        ? '-'
                        : column.mappedOperationCodes.join(', ')}
                    </td>
                    <td>
                      {(column.excludedOperationCodes || []).length === 0
                        ? '-'
                        : column.excludedOperationCodes.join(', ')}
                    </td>
                    <td>{column.includeInMaterialBalance}</td>
                    <td>{column.includeInBookClosing}</td>
                    <td>{column.isInternalTransfer}</td>
                    <td>
                      <span
                        className={`status-badge ${column.status.toLowerCase()}`}
                      >
                        {column.status}
                      </span>
                    </td>
                    <td>
                      <button type="button" onClick={() => handleEditColumn(column)}>
                        Edit
                      </button>

                      <button
                        type="button"
                        onClick={() => { setSuccessMsg(''); setErrorMsg(''); setConfirmDeleteColumnItem(column) }}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          <div className="info-box">
            For robust Material Balance: configure external receipts and
            dispatches as included columns. Configure ITT/Internal Tank Transfer
            columns as internal transfer so they are excluded from Material
            Balance and Book Closing.
          </div>
        </>
      )}

      {successMsg && (
        <div className="success-box">{successMsg}</div>
      )}
      {errorMsg && (
        <div className="error-box">{errorMsg}</div>
      )}
    </div>
  )
}

export default MaterialBalanceTemplateMaster