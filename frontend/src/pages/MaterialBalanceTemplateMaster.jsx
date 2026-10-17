import { useEffect, useMemo, useRef, useState } from 'react'
import {
  createMaterialBalanceTemplate,
  createMaterialBalanceTemplateColumn,
  deleteMaterialBalanceTemplate,
  deleteMaterialBalanceTemplateColumn,
  getMaterialBalanceTemplateDetail,
  getMaterialBalanceTemplatesWithColumns,
  getTankOperationsForMaterialBalance,
  updateMaterialBalanceTemplate,
  updateMaterialBalanceTemplateColumn,
} from '../api/materialBalanceTemplateApi'
import PaginationControls, { paginateRows, usePageSize } from '../components/common/PaginationControls'
import DataTableToolbar from '../components/common/DataTableToolbar'
import PageHeader from '../components/common/PageHeader'
import AlertMessage from '../components/common/AlertMessage'
import Icon from '../components/common/Icon'
import { useConfirm } from '../components/common/ConfirmProvider'
import TemplateFormDialog from '../components/materialBalance/TemplateFormDialog'
import ColumnFormDialog from '../components/materialBalance/ColumnFormDialog'
import GenerateColumnsDialog from '../components/materialBalance/GenerateColumnsDialog'
import TemplateDesigner, { UsageBadge } from '../components/materialBalance/TemplateDesigner'
import { useDataFilters } from '../hooks/useDataFilters'
import { usePermissions } from '../hooks/usePermissions'
import useActionFeedback from '../hooks/useActionFeedback'
import { logUiAction } from '../utils/actionLogger'
import {
  COLUMN_TYPES,
  MOVEMENT_DIRECTIONS,
  computeReportUsage,
  isActive,
  missingStandardColumns,
  normalizeColumnKey,
  planColumnPlacement,
  planNewColumns,
  sortColumns,
  templatesBlockingReportUse,
} from '../utils/materialBalanceTemplate'

const MODULE = 'Material Balance Template'
const TEMPLATE_STATUSES = ['Active', 'Inactive', 'Blocked']
const YES_NO = ['Yes', 'No']
const USAGE_LABEL = {
  'in-use': 'Used by report',
  shadowed: 'Not used – newer template',
  inactive: 'Not used – inactive',
}

const TABLE_COLUMNS = [
  { key: 'locationLabel', label: 'Location' },
  { key: 'templateName', label: 'Template Name' },
  { key: 'description', label: 'Description' },
  { key: 'activeColumnCount', label: 'Active Columns', type: 'number' },
  { key: 'reportUsage', label: 'Report Usage', type: 'select' },
  { key: 'status', label: 'Status', type: 'select' },
  { key: 'updatedAt', label: 'Updated At', type: 'date' },
]

const sameLocation = (a, b) => String(a || '').toUpperCase() === String(b || '').toUpperCase()

const splitCodes = (value) =>
  String(value || '')
    .split(/[;,]/)
    .map((part) => part.trim())
    .filter(Boolean)

function MaterialBalanceTemplateMaster({ locations, loggedInUser }) {
  const confirm = useConfirm()
  const { hasPermission } = usePermissions(loggedInUser)
  const canCreate = hasPermission('Create Material Balance Template')
  const canEdit = hasPermission('Edit Material Balance Template')
  const canDelete = hasPermission('Delete Material Balance Template')
  const canViewOperations = hasPermission('View Tank Operation')

  // Inline message next to the page actions + toast (owner rule 8).
  const feedback = useActionFeedback()
  const { notifySuccess, notifyError, clearSuccess, clearError } = feedback

  const [templates, setTemplates] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [reloadToken, setReloadToken] = useState(0)
  const [selectedId, setSelectedId] = useState(null)
  const [operationsCache, setOperationsCache] = useState({})
  const [rowBusy, setRowBusy] = useState(false)
  const [designerBusy, setDesignerBusy] = useState(false)

  const [templateDialog, setTemplateDialog] = useState(null)
  const [templateBusy, setTemplateBusy] = useState(false)
  const [templateBusyLabel, setTemplateBusyLabel] = useState('')
  const [templateError, setTemplateError] = useState('')

  const [columnDialog, setColumnDialog] = useState(null)
  const [columnBusy, setColumnBusy] = useState(false)
  const [columnError, setColumnError] = useState('')

  const [generateDialog, setGenerateDialog] = useState(null)
  const [generateBusy, setGenerateBusy] = useState(false)
  const [generateBusyLabel, setGenerateBusyLabel] = useState('')
  const [generateError, setGenerateError] = useState('')

  const [page, setPage] = useState(1)
  const pageSize = usePageSize()
  const designerRef = useRef(null)
  const dialogKey = useRef(0)
  const nextKey = () => {
    dialogKey.current += 1
    return dialogKey.current
  }

  /* -------------------------------------------------------------- loading */

  useEffect(() => {
    let cancelled = false
    getMaterialBalanceTemplatesWithColumns()
      .then((rows) => {
        if (cancelled) return
        setTemplates(rows)
        setLoadError('')
      })
      .catch((error) => {
        if (!cancelled) setLoadError(error.message || 'Unable to load Material Balance templates.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [reloadToken])

  const reload = () => {
    setLoading(true)
    setOperationsCache({})
    setReloadToken((value) => value + 1)
  }

  const mergeTemplate = (template) => {
    setTemplates((current) => {
      const exists = current.some((item) => item.id === template.id)
      if (!exists) return [...current, template]
      return current.map((item) =>
        item.id === template.id
          ? template.columnsLoaded
            ? template
            : { ...item, ...template, columns: item.columns, columnsLoaded: item.columnsLoaded, columnsError: item.columnsError }
          : item
      )
    })
  }

  const refreshTemplate = async (templateId) => {
    const detail = await getMaterialBalanceTemplateDetail(templateId)
    mergeTemplate(detail)
    return detail
  }

  const selectedTemplate = templates.find((template) => template.id === selectedId) || null
  const selectedLocation = selectedTemplate ? String(selectedTemplate.locationCode || '').toUpperCase() : ''

  // Tank Operations of the opened template's location (cached per location).
  useEffect(() => {
    if (!selectedLocation || !canViewOperations || operationsCache[selectedLocation]) return undefined
    let cancelled = false
    getTankOperationsForMaterialBalance({ locationCode: selectedLocation, status: 'Active' })
      .then((items) => {
        if (cancelled) return
        setOperationsCache((current) => ({
          ...current,
          [selectedLocation]: { items: items.filter(isActive), error: '' },
        }))
      })
      .catch((error) => {
        if (cancelled) return
        setOperationsCache((current) => ({
          ...current,
          [selectedLocation]: { items: null, error: error.message || 'Unable to load Tank Operations' },
        }))
      })
    return () => {
      cancelled = true
    }
  }, [selectedLocation, canViewOperations, operationsCache])

  const operationsEntry = selectedLocation ? operationsCache[selectedLocation] : null
  const operations = canViewOperations ? (operationsEntry?.items ?? null) : null
  const operationsLoading = Boolean(selectedLocation) && canViewOperations && !operationsEntry
  const operationsError = !canViewOperations
    ? 'viewing Tank Operations requires the View Tank Operation permission'
    : operationsEntry?.error || ''

  useEffect(() => {
    if (selectedId && designerRef.current && typeof designerRef.current.scrollIntoView === 'function') {
      designerRef.current.scrollIntoView({ block: 'start' })
    }
  }, [selectedId])

  /* --------------------------------------------------------------- derived */

  const activeLocations = useMemo(
    () => (locations || []).filter((location) => location.status === 'Active'),
    [locations]
  )

  const locationLabel = useMemo(() => {
    const byCode = new Map()
    ;(locations || []).forEach((location) => byCode.set(String(location.locationCode).toUpperCase(), location))
    return (code) => {
      const location = byCode.get(String(code || '').toUpperCase())
      return location ? `${location.locationName} (${location.locationCode})` : code
    }
  }, [locations])

  const usage = useMemo(() => computeReportUsage(templates), [templates])

  const rows = useMemo(
    () =>
      [...templates]
        .sort(
          (a, b) =>
            String(a.locationCode).localeCompare(String(b.locationCode)) ||
            String(a.templateName).localeCompare(String(b.templateName))
        )
        .map((template) => ({
          ...template,
          locationLabel: locationLabel(template.locationCode),
          activeColumnCount: (template.columns || []).filter(isActive).length,
          reportUsage: USAGE_LABEL[usage.get(template.id)?.state || 'inactive'],
        })),
    [templates, usage, locationLabel]
  )

  const filters = useDataFilters(rows, TABLE_COLUMNS, { module: MODULE })
  const visibleRows = paginateRows(filters.filteredRows, page, pageSize)
  const anyDialogOpen = Boolean(templateDialog || columnDialog || generateDialog)

  /* ------------------------------------------------------------- templates */

  const clearMessages = () => {
    clearSuccess()
    clearError()
  }

  const openTemplate = (template) => {
    clearMessages()
    // Already open: the effect below does not run again, so scroll here.
    if (template.id === selectedId && designerRef.current && typeof designerRef.current.scrollIntoView === 'function') {
      designerRef.current.scrollIntoView({ block: 'start' })
    }
    setSelectedId(template.id)
    logUiAction(MODULE, 'Open Template Columns', { templateId: template.id, templateName: template.templateName })
  }

  const openNewTemplate = () => {
    if (!canCreate) return
    clearMessages()
    setTemplateError('')
    setTemplateDialog({ mode: 'create', initial: null, key: nextKey() })
    logUiAction(MODULE, 'Open New Template')
  }

  const openEditTemplate = (template) => {
    if (!canEdit) return
    clearMessages()
    setTemplateError('')
    setTemplateDialog({ mode: 'edit', initial: template, key: nextKey() })
    logUiAction(MODULE, 'Open Edit Template', { templateId: template.id })
  }

  const openDuplicateTemplate = (template) => {
    if (!canCreate) return
    clearMessages()
    setTemplateError('')
    const taken = new Set(
      templates
        .filter((item) => sameLocation(item.locationCode, template.locationCode))
        .map((item) => String(item.templateName).trim().toLowerCase())
    )
    let name = `${template.templateName} (copy)`
    let counter = 2
    while (taken.has(name.toLowerCase())) {
      name = `${template.templateName} (copy ${counter})`
      counter += 1
    }
    // Copying columns needs Edit (column endpoints) and a template that has columns.
    const canCopy = canEdit && (template.columns || []).length > 0
    setTemplateDialog({
      mode: 'duplicate',
      initial: {
        locationCode: template.locationCode,
        templateName: name,
        description: template.description,
        start: canCopy ? 'copy' : 'empty',
        copyFromId: canCopy ? template.id : null,
      },
      key: nextKey(),
    })
    logUiAction(MODULE, 'Open Duplicate Template', { templateId: template.id })
  }

  const closeTemplateDialog = () => {
    setTemplateDialog(null)
    setTemplateError('')
  }

  const handleTemplateSubmit = async (values) => {
    const mode = templateDialog?.mode
    if (mode === 'edit' ? !canEdit : !canCreate) return
    setTemplateBusy(true)
    setTemplateError('')

    try {
      if (mode === 'edit') {
        const updated = await updateMaterialBalanceTemplate(templateDialog.initial.id, values)
        mergeTemplate(updated)
        setTemplateDialog(null)
        notifySuccess(`Template “${updated.templateName}” updated.`)
        return
      }

      setTemplateBusyLabel('Creating template…')
      const created = await createMaterialBalanceTemplate(values)
      let message = `Template “${created.templateName}” created.`
      const failures = []

      if (values.start === 'copy' && values.copyFromId && canEdit) {
        const source = templates.find((template) => template.id === values.copyFromId)
        const sourceColumns = sortColumns(source?.columns || [])
        let copied = 0
        for (const column of sourceColumns) {
          setTemplateBusyLabel(`Copying column ${copied + failures.length + 1} of ${sourceColumns.length}…`)
          try {
            await createMaterialBalanceTemplateColumn(created.id, { ...column, id: null })
            copied += 1
          } catch (error) {
            failures.push(`${column.columnLabel}: ${error.message}`)
          }
        }
        message = `Template “${created.templateName}” created with ${copied} of ${sourceColumns.length} columns copied from “${source?.templateName}”.`
      }

      try {
        await refreshTemplate(created.id)
      } catch {
        mergeTemplate({ ...created, columns: [], columnsLoaded: true })
      }
      setTemplateDialog(null)
      setSelectedId(created.id)

      if (failures.length > 0) notifyError(`${message} Not copied – ${failures.join('; ')}`)
      else notifySuccess(message)

      if (values.start === 'generate' && canEdit) {
        setGenerateError('')
        setGenerateDialog({ preselectCodes: null, key: nextKey() })
      }
    } catch (error) {
      setTemplateError(error.message || 'Unable to save the template')
    } finally {
      setTemplateBusy(false)
      setTemplateBusyLabel('')
    }
  }

  const handleDeleteTemplate = async (template) => {
    if (!canDelete) return
    clearMessages()
    const state = usage.get(template.id)?.state
    const fallback =
      state === 'in-use'
        ? templates
            .filter(
              (item) => item.id !== template.id && sameLocation(item.locationCode, template.locationCode) && isActive(item)
            )
            .sort((a, b) => Number(b.id) - Number(a.id))[0]
        : null
    const details = [`Its ${(template.columns || []).length} column(s) are deleted with it. This cannot be undone.`]
    if (state === 'in-use') {
      details.push(
        fallback
          ? `The Material Balance Report for ${template.locationCode} will use “${fallback.templateName}”.`
          : `${template.locationCode} will have no active template, so its Material Balance Report cannot run.`
      )
    }
    const confirmed = await confirm({
      title: 'Delete template',
      message: `Delete “${template.templateName}” (${template.locationCode})?`,
      details: details.join(' '),
      tone: 'danger',
      confirmLabel: 'Delete',
      module: MODULE,
    })
    if (!confirmed) return

    setRowBusy(true)
    try {
      await deleteMaterialBalanceTemplate(template.id)
      setTemplates((current) => current.filter((item) => item.id !== template.id))
      if (selectedId === template.id) setSelectedId(null)
      notifySuccess(`Template “${template.templateName}” deleted.`)
    } catch (error) {
      notifyError(error.message)
    } finally {
      setRowBusy(false)
    }
  }

  const handleUseForReport = async (template) => {
    if (!canEdit) return
    clearMessages()
    const blocking = templatesBlockingReportUse(templates, template)
    const changes = blocking.map((item) => `“${item.templateName}” will be set to Inactive.`)
    if (!isActive(template)) changes.push(`“${template.templateName}” will be set to Active.`)
    const activeColumns = (template.columns || []).filter(isActive).length
    if (activeColumns === 0) changes.push('This template has no active columns yet – the report cannot run until you add them.')

    const confirmed = await confirm({
      title: 'Use for Material Balance Report',
      message: `Make “${template.templateName}” the template of the Material Balance Report for ${template.locationCode}?`,
      details: changes.join(' '),
      tone: 'warning',
      confirmLabel: 'Use for Report',
      module: MODULE,
    })
    if (!confirmed) return

    setRowBusy(true)
    setDesignerBusy(true)
    try {
      for (const item of blocking) {
        mergeTemplate(await updateMaterialBalanceTemplate(item.id, { ...item, status: 'Inactive' }))
      }
      if (!isActive(template)) {
        mergeTemplate(await updateMaterialBalanceTemplate(template.id, { ...template, status: 'Active' }))
      }
      notifySuccess(`“${template.templateName}” is now used by the Material Balance Report for ${template.locationCode}.`)
    } catch (error) {
      notifyError(error.message)
      reload()
    } finally {
      setRowBusy(false)
      setDesignerBusy(false)
    }
  }

  /* --------------------------------------------------------------- columns */

  const openColumnDialog = (column = null) => {
    if (!canEdit || !selectedTemplate) return
    clearMessages()
    setColumnError('')
    setColumnDialog({ column, key: nextKey() })
    logUiAction(MODULE, column?.id ? 'Open Edit Column' : 'Open Add Column', { templateId: selectedTemplate.id })
  }

  const handleColumnSubmit = async ({ column, targetIndex, positionChanged }) => {
    const template = selectedTemplate
    if (!template || !canEdit) return
    setColumnBusy(true)
    setColumnError('')
    try {
      let order = column.columnOrder
      let updates = []
      if (column.id == null || positionChanged) {
        const plan = planColumnPlacement(template.columns || [], column, targetIndex)
        order = plan.order
        updates = plan.updates
      }
      for (const update of updates) {
        await updateMaterialBalanceTemplateColumn(update.column.id, { ...update.column, columnOrder: update.order })
      }
      const payload = { ...column, columnOrder: order }
      if (column.id == null) await createMaterialBalanceTemplateColumn(template.id, payload)
      else await updateMaterialBalanceTemplateColumn(column.id, payload)

      await refreshTemplate(template.id)
      setColumnDialog(null)
      notifySuccess(
        column.id == null ? `Column “${column.columnLabel}” added.` : `Column “${column.columnLabel}” updated.`
      )
    } catch (error) {
      setColumnError(error.message || 'Unable to save the column')
      refreshTemplate(template.id).catch(() => {})
    } finally {
      setColumnBusy(false)
    }
  }

  const handleDeleteColumn = async (column) => {
    const template = selectedTemplate
    if (!canEdit || !template) return
    clearMessages()
    const confirmed = await confirm({
      title: 'Delete column',
      message: `Delete column “${column.columnLabel}” from “${template.templateName}”?`,
      details: 'The column disappears from the Material Balance Report. This cannot be undone.',
      tone: 'danger',
      confirmLabel: 'Delete',
      module: MODULE,
    })
    if (!confirmed) return

    setDesignerBusy(true)
    try {
      await deleteMaterialBalanceTemplateColumn(column.id)
      await refreshTemplate(template.id)
      notifySuccess(`Column “${column.columnLabel}” deleted.`)
    } catch (error) {
      notifyError(error.message)
    } finally {
      setDesignerBusy(false)
    }
  }

  const handleMoveColumn = async (column, delta) => {
    const template = selectedTemplate
    if (!canEdit || !template) return
    const sorted = sortColumns(template.columns || [])
    const index = sorted.findIndex((item) => item.id === column.id)
    if (index < 0 || index + delta < 0 || index + delta >= sorted.length) return
    clearMessages()

    setDesignerBusy(true)
    try {
      const { order, updates } = planColumnPlacement(sorted, column, delta < 0 ? index - 1 : index + 1)
      for (const update of updates) {
        await updateMaterialBalanceTemplateColumn(update.column.id, { ...update.column, columnOrder: update.order })
      }
      if (order !== Number(column.columnOrder)) {
        await updateMaterialBalanceTemplateColumn(column.id, { ...column, columnOrder: order })
      }
      await refreshTemplate(template.id)
      logUiAction(MODULE, 'Move Column', { templateId: template.id, column: column.columnKey, direction: delta < 0 ? 'earlier' : 'later' })
    } catch (error) {
      notifyError(error.message)
      refreshTemplate(template.id).catch(() => {})
    } finally {
      setDesignerBusy(false)
    }
  }

  /** Create several columns at their natural positions; failures do not stop the rest. */
  const addColumns = async (template, newColumns, setLabel) => {
    const plan = planNewColumns(template.columns || [], newColumns)
    let step = 0
    for (const update of plan.updates) {
      step += 1
      setLabel?.(`Re-ordering columns (${step} of ${plan.updates.length})…`)
      await updateMaterialBalanceTemplateColumn(update.column.id, { ...update.column, columnOrder: update.order })
    }
    let created = 0
    const failures = []
    for (const item of plan.creates) {
      setLabel?.(`Adding column ${created + failures.length + 1} of ${plan.creates.length}…`)
      try {
        await createMaterialBalanceTemplateColumn(template.id, { ...item.column, columnOrder: item.order })
        created += 1
      } catch (error) {
        failures.push(`${item.column.columnLabel}: ${error.message}`)
      }
    }
    return { created, failures }
  }

  const handleAddStandard = async () => {
    const template = selectedTemplate
    if (!canEdit || !template) return
    clearMessages()
    const missing = missingStandardColumns(template.columns || [])
    if (missing.length === 0) return
    const confirmed = await confirm({
      title: 'Add standard columns',
      message: `Add ${missing.map((column) => column.columnLabel).join(', ')} to “${template.templateName}”?`,
      details:
        'Columns the template already has are skipped. Opening Stock goes first and the calculated stock columns go last.',
      tone: 'primary',
      confirmLabel: 'Add Columns',
      module: MODULE,
    })
    if (!confirmed) return

    setDesignerBusy(true)
    try {
      const { created, failures } = await addColumns(template, missing)
      await refreshTemplate(template.id)
      if (failures.length > 0) notifyError(`${created} column(s) added. Not added – ${failures.join('; ')}`)
      else notifySuccess(`${created} standard column(s) added to “${template.templateName}”.`)
    } catch (error) {
      notifyError(error.message)
      refreshTemplate(template.id).catch(() => {})
    } finally {
      setDesignerBusy(false)
    }
  }

  const openGenerateDialog = (preselectCodes = null) => {
    if (!canEdit || !selectedTemplate) return
    clearMessages()
    setGenerateError('')
    setGenerateDialog({ preselectCodes, key: nextKey() })
    logUiAction(MODULE, 'Open Columns From Tank Operations', { templateId: selectedTemplate.id })
  }

  const handleGenerateSubmit = async (newColumns) => {
    const template = selectedTemplate
    if (!canEdit || !template) return
    setGenerateBusy(true)
    setGenerateError('')
    try {
      const { created, failures } = await addColumns(template, newColumns, setGenerateBusyLabel)
      await refreshTemplate(template.id)
      if (failures.length > 0) {
        setGenerateError(`${created} column(s) added. Not added – ${failures.join('; ')}`)
        return
      }
      setGenerateDialog(null)
      notifySuccess(`${created} column(s) added to “${template.templateName}”. Review the checks below.`)
    } catch (error) {
      setGenerateError(error.message || 'Unable to add the columns')
      refreshTemplate(template.id).catch(() => {})
    } finally {
      setGenerateBusy(false)
      setGenerateBusyLabel('')
    }
  }

  /* ----------------------------------------------------------- bulk upload */

  const importConfig = {
    title: 'Bulk upload material balance templates',
    description:
      'Upload an Excel (.xlsx) or CSV file with ONE ROW PER TEMPLATE COLUMN (the layout of Export Columns). Rows that share the same Location + Template Name are grouped into one template; the template columns only need a value on the first row of each group. A column whose key already exists in the template is updated. Operation codes accept a comma separated list.',
    templateFileName: 'material-balance-template',
    fields: [
      { key: 'locationCode', label: 'Location Code', required: true, example: 'UTP', aliases: ['Location'] },
      { key: 'templateName', label: 'Template Name', required: true, example: 'Daily Tank Balance', aliases: ['Template'] },
      { key: 'description', label: 'Template Description', example: '' },
      { key: 'columnLabel', label: 'Column Label', required: true, example: 'Receipts' },
      { key: 'columnKey', label: 'Column Key', required: true, example: 'RECEIPTS', aliases: ['Key'] },
      { key: 'columnOrder', label: 'Column Order', example: '10', hint: 'Whole number' },
      { key: 'columnType', label: 'Column Type', required: true, options: COLUMN_TYPES, defaultValue: 'MOVEMENT', example: 'MOVEMENT' },
      { key: 'movementDirection', label: 'Movement Direction', options: MOVEMENT_DIRECTIONS, defaultValue: 'IN', example: 'IN' },
      { key: 'mappedOperationCodes', label: 'Mapped Operation Codes', example: 'RECEIPT, PRODUCTION', hint: 'Comma separated' },
      { key: 'excludedOperationCodes', label: 'Excluded Operation Codes', example: '', hint: 'Comma separated' },
      { key: 'includeInMaterialBalance', label: 'Include In Material Balance', options: YES_NO, defaultValue: 'Yes', example: 'Yes' },
      { key: 'includeInBookClosing', label: 'Include In Book Closing', options: YES_NO, defaultValue: 'Yes', example: 'Yes' },
      { key: 'isInternalTransfer', label: 'Is Internal Transfer', options: YES_NO, defaultValue: 'No', example: 'No' },
      { key: 'remarks', label: 'Column Remarks', example: '' },
      { key: 'status', label: 'Status', options: TEMPLATE_STATUSES, defaultValue: 'Active', example: 'Active' },
    ],
    validateRow: (record) => {
      const location = activeLocations.find((item) => sameLocation(item.locationCode, String(record.locationCode).trim()))
      if (!location) return `Unknown or inactive location code "${record.locationCode}"`
      const columnType = String(record.columnType).trim().toUpperCase()
      if (!COLUMN_TYPES.includes(columnType)) return `Column Type must be one of ${COLUMN_TYPES.join(', ')}`
      if (!normalizeColumnKey(record.columnKey)) return 'Column Key is required'
      if (columnType === 'MOVEMENT') {
        if (!MOVEMENT_DIRECTIONS.includes(String(record.movementDirection || 'IN').trim().toUpperCase())) {
          return `Movement Direction must be one of ${MOVEMENT_DIRECTIONS.join(', ')}`
        }
        if (splitCodes(record.mappedOperationCodes).length === 0) {
          return 'Mapped Operation Codes are required for a MOVEMENT column'
        }
      }
      const badFlag = ['includeInMaterialBalance', 'includeInBookClosing', 'isInternalTransfer'].find(
        (fieldName) => record[fieldName] && !YES_NO.includes(String(record[fieldName]).trim())
      )
      if (badFlag) return `${badFlag} must be Yes or No`
      if (record.columnOrder && !Number.isFinite(Number(record.columnOrder))) return 'Column Order must be a number'
      if (record.status && !TEMPLATE_STATUSES.includes(record.status)) {
        return `Status must be one of ${TEMPLATE_STATUSES.join(', ')}`
      }
      return null
    },
    onImportBatch: async (items) => {
      const overrides = []
      const groups = new Map()

      items.forEach(({ rowNumber, record }) => {
        const locationCode = String(record.locationCode || '').trim().toUpperCase()
        const templateName = String(record.templateName || '').trim()
        const key = `${locationCode}|${templateName.toLowerCase()}`
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

        const columnKey = normalizeColumnKey(record.columnKey)
        if (group.columns.some((item) => item.columnKey === columnKey)) {
          overrides.push({
            rowNumber,
            status: 'skipped',
            message: `Duplicate column key "${columnKey}" in template "${templateName}"`,
          })
          return
        }

        const columnType = String(record.columnType || 'MOVEMENT').trim().toUpperCase()
        group.columns.push({
          rowNumber,
          columnLabel: String(record.columnLabel || '').trim(),
          columnKey,
          columnOrder:
            record.columnOrder === '' || record.columnOrder === undefined
              ? (group.columns.length + 1) * 10
              : Number(record.columnOrder),
          columnType,
          movementDirection: columnType === 'MOVEMENT' ? String(record.movementDirection || 'IN').trim().toUpperCase() : '',
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

      const skipGroup = (group, message) =>
        overrides.push(...group.rowNumbers.map((rowNumber) => ({ rowNumber, status: 'skipped', message })))

      for (const group of groups.values()) {
        if (!canEdit) {
          skipGroup(group, 'Adding or updating template columns requires Edit Material Balance Template')
          continue
        }
        try {
          // `templates` carries the columns, so existing keys are updated instead of rejected.
          let template = templates.find(
            (item) =>
              sameLocation(item.locationCode, group.locationCode) &&
              String(item.templateName).trim().toLowerCase() === group.templateName.toLowerCase()
          )
          if (!template) {
            if (!canCreate) {
              skipGroup(group, 'You do not have Create Material Balance Template')
              continue
            }
            template = await createMaterialBalanceTemplate({
              locationCode: group.locationCode,
              templateName: group.templateName,
              description: group.description,
              status: group.status,
            })
          }

          const existingColumns = template.columns || []
          for (const { rowNumber, ...column } of group.columns) {
            try {
              const existing = existingColumns.find((item) => normalizeColumnKey(item.columnKey) === column.columnKey)
              if (existing) {
                await updateMaterialBalanceTemplateColumn(existing.id, { ...column, id: existing.id })
              } else {
                await createMaterialBalanceTemplateColumn(template.id, column)
              }
            } catch (error) {
              overrides.push({ rowNumber, status: 'failed', message: error?.message || 'Save failed' })
            }
          }
        } catch (error) {
          const message = error?.message || 'Save failed'
          overrides.push(...group.rowNumbers.map((rowNumber) => ({ rowNumber, status: 'failed', message })))
        }
      }

      return overrides
    },
    onComplete: () => {
      reload()
    },
  }

  /* --------------------------------------------------------------- render */

  return (
    <div>
      <PageHeader
        title="Material Balance Template Configuration"
        description="Design the location-wise columns of the Material Balance Report from Tank Operations."
        count={`${templates.length} Templates`}
        actions={
          <>
            <button type="button" className="btn-secondary" onClick={reload} disabled={loading}>
              <Icon name="refresh" size={15} />
              {loading ? 'Loading…' : 'Refresh'}
            </button>
            {canCreate && (
              <button type="button" className="btn-primary" onClick={openNewTemplate}>
                <Icon name="plus" size={15} />
                New Template
              </button>
            )}
          </>
        }
      />

      {!anyDialogOpen && <AlertMessage tone="success" message={feedback.successMsg} onDismiss={clearSuccess} />}
      {!anyDialogOpen && <AlertMessage tone="error" message={feedback.errorMsg} onDismiss={clearError} />}
      <AlertMessage tone="error" message={loadError} onDismiss={() => setLoadError('')} />

      {!canCreate && !canEdit && !canDelete && (
        <div className="info-box">You have view-only access to Material Balance Template Configuration.</div>
      )}
      {activeLocations.length === 0 && (
        <div className="info-box">Create at least one Active Location before configuring a template.</div>
      )}

      <div className="info-box mb-how-it-works">
        <strong>How the report uses a template:</strong> for each location the Material Balance Report uses the newest{' '}
        <strong>Active</strong> template. Movement columns add up the Tank Operations mapped to them. Book Closing =
        Opening + counted receipts − counted dispatches, and Loss/Gain = Actual Closing − Book Closing. Internal
        transfers (ITT) can be shown without affecting Book Closing.
      </div>

      <div className="section-title">
        <h3>Templates</h3>
        <p>Open a template to configure its columns.</p>
      </div>

      <DataTableToolbar
        filters={filters}
        columns={TABLE_COLUMNS}
        exportFileName="material-balance-template-configuration"
        exportTitle="Material Balance Template Configuration"
        module={MODULE}
        importConfig={importConfig}
        canImport={canCreate || canEdit}
        searchPlaceholder="Search templates…"
      />

      <table>
        <thead>
          <tr>
            <th>Location</th>
            <th>Template</th>
            <th className="num">Columns</th>
            <th>Report Usage</th>
            <th>Status</th>
            {/* Always shown: every user with View can open a template's columns. */}
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {loading && templates.length === 0 ? (
            <tr>
              <td colSpan={6} className="empty-table">
                Loading templates…
              </td>
            </tr>
          ) : filters.filteredRows.length === 0 ? (
            <tr>
              <td colSpan={6} className="empty-table">
                {templates.length === 0
                  ? canCreate
                    ? 'No Material Balance templates yet. Use New Template to create the first one.'
                    : 'No Material Balance templates found.'
                  : 'No templates match the filters.'}
              </td>
            </tr>
          ) : (
            visibleRows.map((template) => {
              const state = usage.get(template.id)?.state || 'inactive'
              const inactiveCount = (template.columns || []).length - template.activeColumnCount
              return (
                <tr key={template.id} className={template.id === selectedId ? 'is-selected' : ''}>
                  <td>{template.locationLabel}</td>
                  <td>
                    <strong className="cell-strong">{template.templateName}</strong>
                    {template.description && <div className="muted-table-text">{template.description}</div>}
                  </td>
                  <td className="num">
                    {template.columnsError ? (
                      <span className="cell-muted" title={template.columnsError}>
                        Not loaded
                      </span>
                    ) : (
                      <>
                        {template.activeColumnCount}
                        {inactiveCount > 0 && <div className="muted-table-text">+{inactiveCount} inactive</div>}
                      </>
                    )}
                  </td>
                  <td>
                    <UsageBadge state={state} />
                    {state === 'in-use' && template.activeColumnCount === 0 && !template.columnsError && (
                      <div className="mb-usage-warning">No active columns – the report cannot run</div>
                    )}
                    {state !== 'in-use' && canEdit && (
                      <div>
                        <button
                          type="button"
                          className="mb-link-button"
                          onClick={() => handleUseForReport(template)}
                          disabled={rowBusy}
                        >
                          Use for report
                        </button>
                      </div>
                    )}
                  </td>
                  <td>
                    <span className={`status-badge ${String(template.status || '').toLowerCase()}`}>
                      {template.status}
                    </span>
                  </td>
                  <td className="row-actions">
                    <button
                      type="button"
                      className={template.id === selectedId ? 'btn-primary' : ''}
                      onClick={() => openTemplate(template)}
                    >
                      {canEdit ? 'Configure' : 'View Columns'}
                    </button>
                    {canEdit && (
                      <button type="button" onClick={() => openEditTemplate(template)} disabled={rowBusy}>
                        Edit
                      </button>
                    )}
                    {canCreate && (
                      <button type="button" onClick={() => openDuplicateTemplate(template)} disabled={rowBusy}>
                        Duplicate
                      </button>
                    )}
                    {canDelete && (
                      <button
                        type="button"
                        className="btn-danger"
                        onClick={() => handleDeleteTemplate(template)}
                        disabled={rowBusy}
                      >
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              )
            })
          )}
        </tbody>
      </table>

      <PaginationControls currentPage={page} totalRows={filters.filteredRows.length} onPageChange={setPage} />

      {selectedTemplate && (
        <div ref={designerRef} className="mb-designer-anchor">
          <TemplateDesigner
            template={selectedTemplate}
            locationLabel={locationLabel(selectedTemplate.locationCode)}
            usage={usage.get(selectedTemplate.id)}
            operations={operations}
            operationsLoading={operationsLoading}
            operationsError={operationsError}
            canEdit={canEdit}
            busy={designerBusy || rowBusy}
            onClose={() => setSelectedId(null)}
            onAddColumn={() => openColumnDialog(null)}
            onEditColumn={(column) => openColumnDialog(column)}
            onDeleteColumn={handleDeleteColumn}
            onMoveColumn={handleMoveColumn}
            onGenerate={openGenerateDialog}
            onAddStandard={handleAddStandard}
            onUseForReport={() => handleUseForReport(selectedTemplate)}
            onEditTemplate={() => openEditTemplate(selectedTemplate)}
          />
        </div>
      )}

      {templateDialog && (
        <TemplateFormDialog
          key={templateDialog.key}
          open
          mode={templateDialog.mode}
          initial={templateDialog.initial}
          locations={locations}
          templates={templates}
          canAddColumns={canEdit}
          busy={templateBusy}
          busyLabel={templateBusyLabel}
          error={templateError}
          onDismissError={() => setTemplateError('')}
          onSubmit={handleTemplateSubmit}
          onCancel={closeTemplateDialog}
        />
      )}

      {columnDialog && selectedTemplate && (
        <ColumnFormDialog
          key={columnDialog.key}
          open
          column={columnDialog.column}
          template={selectedTemplate}
          columns={selectedTemplate.columns || []}
          operations={operations}
          operationsLoading={operationsLoading}
          operationsError={operationsError}
          busy={columnBusy}
          error={columnError}
          onDismissError={() => setColumnError('')}
          onSubmit={handleColumnSubmit}
          onCancel={() => {
            setColumnDialog(null)
            setColumnError('')
          }}
        />
      )}

      {generateDialog && selectedTemplate && (
        <GenerateColumnsDialog
          key={generateDialog.key}
          open
          template={selectedTemplate}
          columns={selectedTemplate.columns || []}
          operations={operations}
          operationsLoading={operationsLoading}
          operationsError={operationsError}
          preselectCodes={generateDialog.preselectCodes}
          busy={generateBusy}
          busyLabel={generateBusyLabel}
          error={generateError}
          onDismissError={() => setGenerateError('')}
          onSubmit={handleGenerateSubmit}
          onCancel={() => {
            setGenerateDialog(null)
            setGenerateError('')
          }}
        />
      )}
    </div>
  )
}

export default MaterialBalanceTemplateMaster
