import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import PageHeader from '../components/common/PageHeader'
import AlertMessage from '../components/common/AlertMessage'
import Icon from '../components/common/Icon'
import { useToast } from '../components/common/Toast'
import { useConfirm } from '../components/common/ConfirmProvider'
import { usePermissions } from '../hooks/usePermissions'
import FormulaBuilder from '../components/reportBuilder/FormulaBuilder'
import JsonColumnPicker from '../components/reportBuilder/JsonColumnPicker'
import ReportDataTable from '../components/reportBuilder/ReportDataTable'
import {
  createFromStarter,
  createReportDefinition,
  deleteReportDefinition,
  duplicateReportDefinition,
  getOperationFields,
  getReportCatalog,
  getReportDefinition,
  getReportDefinitions,
  getReportLookups,
  getStarterTemplates,
  publishReportDefinition,
  runReportPreview,
  updateReportDefinition,
} from '../api/reportBuilderApi'
import {
  AGGREGATES,
  BUCKETS,
  FILTER_OPERATORS,
  columnOriginLabel,
  dateRangeDefaults,
  emptyDefinition,
  formulaInWords,
  slugColumnKey,
  sourceKindLabel,
} from '../utils/reportBuilder'
import { logUiAction } from '../utils/actionLogger'

const STEPS = [
  { id: 'details', label: '1 · Report & Data', icon: 'settings' },
  { id: 'columns', label: '2 · Columns', icon: 'columns' },
  { id: 'rows', label: '3 · Rows & Layout', icon: 'list' },
  { id: 'filters', label: '4 · Filters for Users', icon: 'filter' },
  { id: 'access', label: '5 · Who Can Use It', icon: 'users' },
  { id: 'preview', label: '6 · Preview & Save', icon: 'eye' },
]

const DATA_TYPES = ['text', 'number', 'date', 'datetime', 'time', 'boolean']
const sourceSignature = (source) => JSON.stringify(source || {})

function ReportBuilder({ loggedInUser }) {
  const navigate = useNavigate()
  const toast = useToast()
  const confirm = useConfirm()
  const { hasPermission } = usePermissions(loggedInUser)
  const canCreate = hasPermission('Create Report Definition')
  const canEdit = hasPermission('Edit Report Definition')
  const canDelete = hasPermission('Delete Report Definition')
  const canPublish = hasPermission('Publish Report Definition')
  const canRunCustom = hasPermission('View Custom Report')

  const [view, setView] = useState('list')
  const [busy, setBusy] = useState(false)
  const [listError, setListError] = useState('')
  const [reports, setReports] = useState([])
  const [starters, setStarters] = useState([])
  const [catalog, setCatalog] = useState(null)
  const [lookups, setLookups] = useState(null)
  const [operationFields, setOperationFields] = useState({ templates: [], saved_fields: [] })

  // Designer state
  const [step, setStep] = useState(0)
  const [editingId, setEditingId] = useState(null)
  const [reportName, setReportName] = useState('')
  const [description, setDescription] = useState('')
  const [definition, setDefinition] = useState(emptyDefinition())
  const [visibility, setVisibility] = useState('PRIVATE')
  const [isPublished, setIsPublished] = useState(false)
  const [status, setStatus] = useState('Active')
  const [grants, setGrants] = useState([])
  const [saveError, setSaveError] = useState('')
  const [formulaTarget, setFormulaTarget] = useState(null) // column key or 'new'
  const [jsonRequest, setJsonRequest] = useState(null)
  const [jsonTitle, setJsonTitle] = useState('')
  const [jsonSpecBase, setJsonSpecBase] = useState(null)
  const [fieldSearch, setFieldSearch] = useState('')
  const [expandedColumn, setExpandedColumn] = useState(null)

  // Preview state
  const defaults = useMemo(() => dateRangeDefaults(), [])
  const [previewDates, setPreviewDates] = useState(defaults)
  const [previewResult, setPreviewResult] = useState(null)
  const [previewError, setPreviewError] = useState('')
  const [previewBusy, setPreviewBusy] = useState(false)

  const loadAll = useCallback(async () => {
    setBusy(true)
    setListError('')
    try {
      const [list, starterList, cat, look, fields] = await Promise.all([
        getReportDefinitions(),
        getStarterTemplates(),
        getReportCatalog(),
        getReportLookups(),
        getOperationFields(),
      ])
      setReports(list)
      setStarters(starterList)
      setCatalog(cat)
      setLookups(look)
      setOperationFields(fields)
    } catch (error) {
      setListError(error.message || 'Could not load the Report Builder.')
    } finally {
      setBusy(false)
    }
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadAll() }, [loadAll])

  const dataset = useMemo(() => {
    if (!catalog) return null
    return (catalog.datasets || []).find((d) => d.kind === definition.source.kind) || null
  }, [catalog, definition.source.kind])

  const activeTable = useMemo(() => {
    if (!catalog || definition.source.kind !== 'table') return null
    return catalog.tables.find((t) => t.table === definition.source.table) || null
  }, [catalog, definition.source])

  const tableGroups = useMemo(() => {
    const groups = new Map()
    ;(catalog?.tables || []).forEach((t) => {
      if (!groups.has(t.group)) groups.set(t.group, [])
      groups.get(t.group).push(t)
    })
    return [...groups.entries()]
  }, [catalog])

  const existingSignatures = useMemo(
    () => new Set((definition.columns || []).filter((c) => (c.kind || 'data') === 'data').map((c) => sourceSignature(c.source))),
    [definition.columns]
  )
  const existingJsonPaths = useMemo(
    () => new Set((definition.columns || []).map((c) => c.source?.path).filter(Boolean)),
    [definition.columns]
  )

  const patchDefinition = (patch) => setDefinition((current) => ({ ...current, ...patch }))
  const patchSource = (patch) => setDefinition((current) => ({ ...current, source: { ...current.source, ...patch } }))

  const switchDataset = async (kind, extra = {}) => {
    if (definition.source.kind === kind && kind !== 'table') return
    if ((definition.columns || []).length > 0) {
      const confirmed = await confirm({
        title: 'Change where the data comes from?',
        message: 'Columns, conditions and layout belong to the current data source and will be cleared. The report name, user filters and access choices are kept.',
        confirmLabel: 'Change data source', tone: 'danger', module: 'Report Builder',
      })
      if (!confirmed) return
      setDefinition((current) => ({
        ...current, columns: [], filters: [], group_by: [], sort: [],
        matrix: { row_keys: [], column_key: '', column_bucket: 'VALUE', value_key: '', aggregate: 'SUM', show_row_totals: true, show_column_totals: true },
        source: { ...current.source, kind, ...extra },
      }))
      setPreviewResult(null)
      return
    }
    patchSource({ kind, ...extra })
  }

  const startNew = () => {
    setEditingId(null)
    setReportName('')
    setDescription('')
    setDefinition(emptyDefinition())
    setVisibility('PRIVATE')
    setIsPublished(false)
    setStatus('Active')
    setGrants([])
    setSaveError('')
    setPreviewResult(null)
    setStep(0)
    setView('designer')
  }

  const startEdit = async (reportId, goToStep = 0) => {
    setBusy(true)
    try {
      const report = await getReportDefinition(reportId)
      setEditingId(report.id)
      setReportName(report.report_name)
      setDescription(report.description || '')
      setDefinition({ ...emptyDefinition(), ...report.definition })
      setVisibility(report.visibility || 'PRIVATE')
      setIsPublished(Boolean(report.is_published))
      setStatus(report.status || 'Active')
      setGrants((report.grants || []).map((g) => ({
        grant_type: g.grant_type, user_id: g.user_id, role_id: g.role_id,
        location_code: g.location_code, access_level: g.access_level, label: g.label,
      })))
      setSaveError('')
      setPreviewResult(null)
      setStep(goToStep)
      setView('designer')
    } catch (error) {
      toast.error(error.message || 'Could not open that report.', { title: 'Report Builder' })
    } finally {
      setBusy(false)
    }
  }

  const handleStarter = async (starter) => {
    try {
      setBusy(true)
      const created = await createFromStarter(starter.id)
      toast.success(`“${created.report_name}” created — adjust it and Save.`, { title: 'Report Builder' })
      await loadAll()
      await startEdit(created.id)
    } catch (error) {
      toast.error(error.message || 'Could not create from the starter.', { title: 'Report Builder' })
    } finally {
      setBusy(false)
    }
  }

  const handleDuplicate = async (report) => {
    try {
      setBusy(true)
      await duplicateReportDefinition(report.id)
      toast.success(`Copied “${report.report_name}”.`, { title: 'Report Builder' })
      await loadAll()
    } catch (error) {
      toast.error(error.message, { title: 'Report Builder' })
    } finally { setBusy(false) }
  }

  const handleTogglePublish = async (report) => {
    try {
      setBusy(true)
      await publishReportDefinition(report.id, !report.is_published)
      toast.success(report.is_published ? 'Report removed from Reporting.' : 'Report published to Reporting.', { title: 'Report Builder' })
      await loadAll()
    } catch (error) {
      toast.error(error.message, { title: 'Report Builder' })
    } finally { setBusy(false) }
  }

  const handleDelete = async (report) => {
    const confirmed = await confirm({
      title: 'Delete this report?',
      message: `“${report.report_name}” and its design history will be deleted. Report users will no longer see it.`,
      confirmLabel: 'Delete report', tone: 'danger', module: 'Report Builder',
    })
    if (!confirmed) return
    try {
      setBusy(true)
      await deleteReportDefinition(report.id)
      toast.success('Report deleted.', { title: 'Report Builder' })
      await loadAll()
    } catch (error) {
      toast.error(error.message, { title: 'Report Builder' })
    } finally { setBusy(false) }
  }

  // ---- columns -----------------------------------------------------------
  const addDataColumns = (items) => {
    setDefinition((current) => {
      const columns = [...(current.columns || [])]
      const keys = columns.map((c) => c.key)
      const signatures = new Set(columns.map((c) => sourceSignature(c.source)))
      items.forEach((item) => {
        if (signatures.has(sourceSignature(item.source))) return
        const key = slugColumnKey(item.label, keys)
        keys.push(key)
        columns.push({
          key, label: item.label, kind: 'data', source: item.source,
          data_type: item.data_type || 'text', unit: item.unit || undefined,
          format: item.data_type === 'number' ? { decimals: 3 } : {},
          show_total: false, aggregate: null, hidden: false,
        })
      })
      return { ...current, columns }
    })
  }

  const updateColumn = (key, patch) =>
    setDefinition((current) => ({ ...current, columns: current.columns.map((c) => (c.key === key ? { ...c, ...patch } : c)) }))

  const removeColumn = (key) =>
    setDefinition((current) => ({
      ...current,
      columns: current.columns.filter((c) => c.key !== key),
      group_by: (current.group_by || []).filter((g) => (g.key || g) !== key),
      sort: (current.sort || []).filter((s) => s.key !== key),
    }))

  const moveColumn = (key, delta) => {
    setDefinition((current) => {
      const columns = [...current.columns]
      const index = columns.findIndex((c) => c.key === key)
      const target = index + delta
      if (index < 0 || target < 0 || target >= columns.length) return current
      ;[columns[index], columns[target]] = [columns[target], columns[index]]
      return { ...current, columns }
    })
  }

  const handleFormulaSave = ({ label, formula }) => {
    if (formulaTarget && formulaTarget !== 'new') {
      updateColumn(formulaTarget, { label, formula })
    } else {
      setDefinition((current) => {
        const key = slugColumnKey(label, current.columns.map((c) => c.key))
        return {
          ...current,
          columns: [...current.columns, { key, label, kind: 'calculated', formula, data_type: 'number', format: { decimals: 3 }, show_total: false, aggregate: null }],
        }
      })
    }
    setFormulaTarget(null)
  }

  const openJsonPicker = (requestBody, title, specBase) => {
    setJsonRequest(requestBody)
    setJsonTitle(title)
    setJsonSpecBase(specBase)
  }

  const handleJsonAdd = (paths) => {
    if (!jsonSpecBase) return
    addDataColumns(paths.map((entry) => ({
      label: entry.short_label || entry.path,
      data_type: entry.data_type === 'number' ? 'number' : entry.data_type === 'date' ? 'date' : 'text',
      source: { ...jsonSpecBase, path: entry.path },
    })))
  }

  // ---- available fields (step 2 left panel) ------------------------------
  const fieldSections = useMemo(() => {
    const needle = fieldSearch.trim().toLowerCase()
    const matches = (label) => !needle || String(label).toLowerCase().includes(needle)
    const sections = []
    const kind = definition.source.kind
    if (kind === 'operation_tickets' || kind === 'tank_stock_ledger') {
      const virtuals = (dataset?.virtual_fields || []).filter((f) => matches(f.label))
      if (virtuals.length) {
        const groups = new Map()
        virtuals.forEach((f) => {
          if (!groups.has(f.group)) groups.set(f.group, [])
          groups.get(f.group).push({ label: f.label, data_type: f.data_type, help: f.help, source: { type: 'virtual', field: f.field } })
        })
        groups.forEach((items, group) => sections.push({ title: group, items }))
      }
      const header = (dataset?.columns || [])
        .filter((c) => matches(c.label) && !(kind === 'tank_stock_ledger' && c.is_json))
        .map((c) => ({ label: c.label, data_type: c.data_type, tech: c.column, source: { type: 'column', column: c.column } }))
      if (header.length) sections.push({ title: kind === 'operation_tickets' ? 'Ticket header' : 'Ledger columns', items: header })
    }
    if (kind === 'operation_tickets') {
      const singles = (operationFields.saved_fields || [])
        .filter((f) => !f.is_payload && matches(f.label))
        .map((f) => ({
          label: f.label, data_type: f.data_type, unit: f.unit, tech: f.field_code,
          source: { type: 'ticket_field', field_code: f.field_code },
        }))
      if (singles.length) sections.push({ title: 'Answers typed on tickets (single values)', items: singles })
    }
    if (kind === 'table' && activeTable) {
      const items = activeTable.columns
        .filter((c) => matches(c.label))
        .map((c) => ({
          label: c.label, data_type: c.data_type, tech: c.column,
          isJson: c.is_json,
          source: { type: 'column', column: c.column },
          jsonColumn: c.is_json ? c.column : null,
        }))
      if (items.length) sections.push({ title: `${activeTable.label} columns`, items })
    }
    return sections
  }, [dataset, activeTable, definition.source.kind, operationFields, fieldSearch])

  const payloadChoices = useMemo(() => {
    if (definition.source.kind === 'operation_tickets') {
      const fromSaved = (operationFields.saved_fields || []).filter((f) => f.is_payload)
      const known = new Map(fromSaved.map((f) => [f.field_code, f]))
      ;(operationFields.templates || []).forEach((t) => {
        ;(t.fields || []).filter((f) => f.is_payload).forEach((f) => {
          if (!known.has(f.field_code)) known.set(f.field_code, { ...f, label: `${f.label} (${t.template_name})` })
        })
      })
      return [...known.values()].map((f) => ({
        label: f.label || f.field_code,
        tech: f.field_code,
        request: { source_kind: 'operation_tickets', field_code: f.field_code, operation_type_codes: definition.source.operation_type_codes || [] },
        specBase: { type: 'payload_path', field_code: f.field_code },
      }))
    }
    if (definition.source.kind === 'tank_stock_ledger') {
      return [{
        label: 'Ticket answers stored with the ledger row',
        tech: 'source_payload',
        request: { source_kind: 'tank_stock_ledger', json_column: 'source_payload' },
        specBase: { type: 'payload_path', json_column: 'source_payload' },
      }]
    }
    if (definition.source.kind === 'table' && activeTable) {
      return (activeTable.json_columns || []).map((column) => ({
        label: activeTable.columns.find((c) => c.column === column)?.label || column,
        tech: column,
        request: { source_kind: 'table', table: activeTable.table, json_column: column },
        specBase: { type: 'json_path', json_column: column },
      }))
    }
    return []
  }, [definition.source, operationFields, activeTable])

  // ---- save ---------------------------------------------------------------
  const normalisedDefinition = useCallback(() => {
    const copy = JSON.parse(JSON.stringify(definition))
    copy.columns = (copy.columns || []).map((c) => ({ ...c, aggregate: c.aggregate || undefined }))
    copy.filters = (copy.filters || []).map((entry) => {
      const out = { ...entry }
      const column = (definition.columns || []).find((c) => c.key === entry.column_key)
      const numeric = column?.data_type === 'number'
      const coerce = (value) => {
        if (value === '' || value === undefined) return value
        if (numeric && !Number.isNaN(Number(value))) return Number(value)
        return value
      }
      if (entry.operator === 'in' || entry.operator === 'not_in') {
        out.value = String(entry.value ?? '').split(',').map((v) => coerce(v.trim())).filter((v) => v !== '')
      } else {
        out.value = coerce(entry.value)
        if (entry.operator === 'between') out.value2 = coerce(entry.value2)
      }
      return out
    })
    copy.runtime_filters = (copy.runtime_filters || []).map((entry) => {
      const out = { ...entry }
      if (typeof out.options_text === 'string') {
        out.options = out.options_text.split('\n').map((v) => v.trim()).filter(Boolean)
        delete out.options_text
      }
      return out
    })
    if (copy.report_type !== 'MATRIX') delete copy.matrix
    else copy.group_by = []
    return copy
  }, [definition])

  const handleSave = async (publish) => {
    setSaveError('')
    if (!reportName.trim()) { setSaveError('Give the report a name (Step 1).'); setStep(0); return }
    if (!(definition.columns || []).length) { setSaveError('Add at least one column (Step 2).'); setStep(1); return }
    const payload = {
      report_name: reportName.trim(),
      description: description || null,
      definition: normalisedDefinition(),
      visibility,
      is_published: publish,
      status,
      grants: grants.map((grant) => {
        const rest = { ...grant }
        delete rest.label
        return rest
      }),
    }
    try {
      setBusy(true)
      const saved = editingId
        ? await updateReportDefinition(editingId, payload)
        : await createReportDefinition(payload)
      setEditingId(saved.id)
      setIsPublished(Boolean(saved.is_published))
      logUiAction('Report Builder', editingId ? 'Update Report' : 'Create Report', { report: saved.report_name })
      toast.success(publish ? 'Saved and published to Reporting.' : 'Report saved.', { title: 'Report Builder' })
      await loadAll()
    } catch (error) {
      setSaveError(error.message || 'The report could not be saved.')
    } finally { setBusy(false) }
  }

  const handlePreview = async () => {
    setPreviewError('')
    setPreviewResult(null)
    setPreviewBusy(true)
    try {
      const result = await runReportPreview(normalisedDefinition(), {
        date_from: previewDates.dateFrom || null,
        date_to: previewDates.dateTo || null,
        page: 1, page_size: 25,
      })
      setPreviewResult(result)
    } catch (error) {
      setPreviewError(error.message || 'Preview failed.')
    } finally { setPreviewBusy(false) }
  }

  // ---- list view ------------------------------------------------------------
  if (view === 'list') {
    return (
      <div>
        <PageHeader
          title="Report Builder"
          description="Design your own tabular and matrix reports from any saved data — no IT help needed. Published reports appear in the Reporting menu for the people you choose."
          count={`${reports.length} Report${reports.length === 1 ? '' : 's'}`}
          actions={canCreate ? (
            <button type="button" className="btn-primary" onClick={startNew}>
              <Icon name="plus" size={15} /> New Report
            </button>
          ) : null}
        />
        <AlertMessage tone="error" message={listError} onDismiss={() => setListError('')} />
        {busy && <AlertMessage tone="info" message="Loading…" />}

        {canCreate && starters.length > 0 && (
          <section className="rb-section">
            <h3>Start from a ready-made report</h3>
            <p className="rb-muted">One click creates the report as your own draft — then adjust columns, calculations and access.</p>
            <div className="rb-starter-grid">
              {starters.map((starter) => (
                <div key={starter.id} className="rb-starter-card">
                  <span className={`status-badge ${starter.report_type === 'MATRIX' ? 'submitted' : 'active'}`}>{starter.report_type === 'MATRIX' ? 'Matrix' : 'Tabular'}</span>
                  <h4>{starter.name}</h4>
                  <p>{starter.description}</p>
                  <button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={() => handleStarter(starter)}>
                    <Icon name="copy" size={14} /> Use this starter
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="rb-section">
          <h3>Reports you can manage</h3>
          {reports.length === 0 ? (
            <div className="empty-table">No custom reports yet. {canCreate ? 'Create one with “New Report” or a starter above.' : 'Ask a user with the Create Report Definition permission to design one and share it with you.'}</div>
          ) : (
            <div className="rb-table-wrap">
              <table className="rb-table">
                <thead>
                  <tr><th>Report</th><th>Type</th><th>Data</th><th>Columns</th><th>In Reporting?</th><th>Who can use it</th><th>Your access</th><th>Updated</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {reports.map((report) => (
                    <tr key={report.id}>
                      <td><strong>{report.report_name}</strong>{report.description ? <div className="rb-muted">{report.description}</div> : null}</td>
                      <td>{report.report_type === 'MATRIX' ? 'Matrix' : 'Tabular'}</td>
                      <td>{sourceKindLabel(report.source_kind)}</td>
                      <td>{report.column_count}</td>
                      <td><span className={`status-badge ${report.is_published ? 'active' : 'draft'}`}>{report.is_published ? 'Published' : 'Draft'}</span></td>
                      <td>{report.visibility === 'INTERNAL' ? 'All report users' : 'Named people / roles / locations'}</td>
                      <td>{report.my_access === 'OWNER' ? 'Owner' : report.my_access === 'EDIT' ? 'Can edit' : 'Can view'}</td>
                      <td>{report.updated_at ? new Date(report.updated_at).toLocaleDateString() : ''} · v{report.version}</td>
                      <td>
                        <div className="rb-row-actions">
                          {(canEdit && report.my_access !== 'VIEW') && (
                            <button type="button" className="btn-secondary btn-sm" onClick={() => startEdit(report.id)}><Icon name="edit" size={14} /> Design</button>
                          )}
                          {report.is_published && canRunCustom ? (
                            <button type="button" className="btn-secondary btn-sm" onClick={() => navigate(`/reporting/custom-reports/${report.id}`)}><Icon name="eye" size={14} /> Run</button>
                          ) : (
                            <button type="button" className="btn-secondary btn-sm" onClick={() => startEdit(report.id, 5)}><Icon name="eye" size={14} /> Preview</button>
                          )}
                          {canCreate && (
                            <button type="button" className="btn-secondary btn-sm" onClick={() => handleDuplicate(report)} title="Duplicate"><Icon name="copy" size={14} /></button>
                          )}
                          {canPublish && report.my_access !== 'VIEW' && (
                            <button type="button" className="btn-secondary btn-sm" onClick={() => handleTogglePublish(report)}>{report.is_published ? 'Unpublish' : 'Publish'}</button>
                          )}
                          {canDelete && report.my_access === 'OWNER' && (
                            <button type="button" className="btn-secondary btn-sm" onClick={() => handleDelete(report)} title="Delete"><Icon name="trash" size={14} /></button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    )
  }

  // ---- designer -------------------------------------------------------------
  const groupedMode = definition.report_type === 'TABULAR' && (definition.group_by || []).length > 0
  const groupKeys = (definition.group_by || []).map((g) => g.key || g)

  return (
    <div>
      <PageHeader
        title={editingId ? 'Design Report' : 'New Report'}
        description="Follow the steps left to right. You can preview with real data before saving."
        actions={(
          <button type="button" className="btn-secondary" onClick={() => setView('list')}>
            <Icon name="chevronLeft" size={15} /> All reports
          </button>
        )}
      />
      <AlertMessage tone="error" message={saveError} onDismiss={() => setSaveError('')} />

      <div className="rb-steps" role="tablist" aria-label="Report design steps">
        {STEPS.map((item, index) => (
          <button key={item.id} type="button" role="tab" aria-selected={step === index} className={step === index ? 'active' : ''} onClick={() => setStep(index)}>
            <Icon name={item.icon} size={15} /> {item.label}
          </button>
        ))}
      </div>

      {step === 0 && (
        <section className="rb-panel">
          <div className="rb-grid-2">
            <div className="rb-field">
              <label htmlFor="rb-name">Report name *</label>
              <input id="rb-name" type="text" value={reportName} onChange={(e) => setReportName(e.target.value)} placeholder="e.g. Daily Receipts vs Dispatch by Tank" />
            </div>
            <div className="rb-field">
              <label htmlFor="rb-desc">What is this report for?</label>
              <input id="rb-desc" type="text" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Shown to report users in the Reporting menu" />
            </div>
          </div>

          <div className="rb-field">
            <label>Report shape</label>
            <div className="rb-choice-row">
              <label className={`rb-choice ${definition.report_type === 'TABULAR' ? 'active' : ''}`}>
                <input type="radio" name="rb-type" checked={definition.report_type === 'TABULAR'} onChange={() => patchDefinition({ report_type: 'TABULAR' })} />
                <strong>Tabular</strong><span>Rows of records, or grouped totals — like a register or daily summary.</span>
              </label>
              <label className={`rb-choice ${definition.report_type === 'MATRIX' ? 'active' : ''}`}>
                <input type="radio" name="rb-type" checked={definition.report_type === 'MATRIX'} onChange={() => patchDefinition({ report_type: 'MATRIX' })} />
                <strong>Matrix (cross-tab)</strong><span>Values spread across columns — e.g. tanks down the side, operations or months across the top.</span>
              </label>
            </div>
          </div>

          <div className="rb-field">
            <label>Where should the data come from?</label>
            <div className="rb-dataset-grid">
              {(catalog?.datasets || []).map((item) => (
                <button
                  key={item.id} type="button"
                  className={`rb-dataset-card ${definition.source.kind === item.kind ? 'active' : ''}`}
                  onClick={async () => {
                    await switchDataset(item.kind)
                    if (item.default_date_basis) patchDefinition({ date_basis: item.default_date_basis })
                  }}
                >
                  <Icon name={item.icon || 'database'} size={20} />
                  <strong>{item.name}</strong>
                  <span>{item.description}</span>
                </button>
              ))}
              <button
                type="button"
                className={`rb-dataset-card ${definition.source.kind === 'table' ? 'active' : ''}`}
                onClick={() => switchDataset('table', { table: definition.source.table || catalog?.tables?.[0]?.table || '' })}
              >
                <Icon name="grid" size={20} />
                <strong>Any other saved table</strong>
                <span>Every master and transaction table in the system (passwords and secrets are always hidden).</span>
              </button>
            </div>
          </div>

          {definition.source.kind === 'table' && (
            <div className="rb-field">
              <label htmlFor="rb-table">Table</label>
              <select id="rb-table" value={definition.source.table || ''} onChange={async (e) => {
                const nextTable = e.target.value
                if (nextTable === definition.source.table) return
                if ((definition.columns || []).length > 0) {
                  const confirmed = await confirm({
                    title: 'Change table?',
                    message: 'Columns and layout belong to the current table and will be cleared.',
                    confirmLabel: 'Change table', tone: 'danger', module: 'Report Builder',
                  })
                  if (!confirmed) return
                  setDefinition((current) => ({
                    ...current, columns: [], filters: [], group_by: [], sort: [],
                    matrix: { row_keys: [], column_key: '', column_bucket: 'VALUE', value_key: '', aggregate: 'SUM', show_row_totals: true, show_column_totals: true },
                    source: { ...current.source, table: nextTable },
                  }))
                  setPreviewResult(null)
                  return
                }
                patchSource({ table: nextTable })
              }}>
                {tableGroups.map(([group, tables]) => (
                  <optgroup key={group} label={group}>
                    {tables.map((t) => <option key={t.table} value={t.table}>{t.label}</option>)}
                  </optgroup>
                ))}
              </select>
              {activeTable && (activeTable.location_columns || []).length === 0 && (
                <AlertMessage tone="warning" message="This table has no location column, so report users will see rows for all locations. Only share such reports with people who may see company-wide data." />
              )}
            </div>
          )}

          {definition.source.kind === 'operation_tickets' && (
            <div className="rb-grid-2">
              <div className="rb-field">
                <label>Operation types to include (leave all unticked = every type)</label>
                <div className="rb-check-list">
                  {(lookups?.operation_types || []).map((type) => {
                    const checked = (definition.source.operation_type_codes || []).includes(type.operation_type_code)
                    return (
                      <label key={type.operation_type_code}>
                        <input type="checkbox" checked={checked} onChange={(e) => {
                          const current = new Set(definition.source.operation_type_codes || [])
                          if (e.target.checked) current.add(type.operation_type_code); else current.delete(type.operation_type_code)
                          patchSource({ operation_type_codes: [...current] })
                        }} />
                        {type.operation_type_name} <span className="rb-muted">({type.operation_type_code})</span>
                      </label>
                    )
                  })}
                </div>
              </div>
              <div className="rb-field">
                <label>Ticket statuses to include</label>
                <div className="rb-check-list">
                  {(lookups?.statuses || []).map((statusValue) => {
                    const checked = (definition.source.statuses || []).includes(statusValue)
                    return (
                      <label key={statusValue}>
                        <input type="checkbox" checked={checked} onChange={(e) => {
                          const current = new Set(definition.source.statuses || [])
                          if (e.target.checked) current.add(statusValue); else current.delete(statusValue)
                          patchSource({ statuses: [...current] })
                        }} />
                        {statusValue}
                      </label>
                    )
                  })}
                </div>
                <p className="rb-muted">Accounting reports normally use Approved tickets only.</p>
              </div>
            </div>
          )}

          <div className="rb-grid-2">
            <div className="rb-field">
              <label htmlFor="rb-date-basis">Which date should the From–To filter use?</label>
              <select id="rb-date-basis" value={definition.date_basis} onChange={(e) => patchDefinition({ date_basis: e.target.value })}>
                {(catalog?.date_bases || []).map((basis) => <option key={basis.value} value={basis.value}>{basis.label}</option>)}
              </select>
              <p className="rb-muted">{(catalog?.date_bases || []).find((b) => b.value === definition.date_basis)?.help}</p>
            </div>
            {definition.date_basis === 'COLUMN' && (
              <div className="rb-field">
                <label htmlFor="rb-date-column">Date column</label>
                <select id="rb-date-column" value={definition.date_column || ''} onChange={(e) => patchDefinition({ date_column: e.target.value })}>
                  <option value="">Choose…</option>
                  {((definition.source.kind === 'table' ? activeTable?.columns : dataset?.columns) || [])
                    .filter((c) => c.is_date)
                    .map((c) => <option key={c.column} value={c.column}>{c.label}</option>)}
                </select>
              </div>
            )}
          </div>
        </section>
      )}

      {step === 1 && (
        <section className="rb-panel">
          <div className="rb-columns-layout">
            <div className="rb-available">
              <div className="rb-field">
                <label htmlFor="rb-field-search">Available values — click ＋ to add as a column</label>
                <input id="rb-field-search" type="search" value={fieldSearch} onChange={(e) => setFieldSearch(e.target.value)} placeholder="Search values… e.g. NSV, ticket, date" />
              </div>

              {payloadChoices.length > 0 && (
                <div className="rb-available-group rb-json-callout">
                  <h4><Icon name="layers" size={15} /> Split saved JSON into columns</h4>
                  <p className="rb-muted">Payloads save many values in one JSON block. Open one to turn each inner value (GSV, NSV, dips per tank…) into its own column.</p>
                  {payloadChoices.map((choice) => (
                    <div key={choice.tech} className="rb-available-row">
                      <span><strong>{choice.label}</strong><span className="rb-json-tech">{choice.tech}</span></span>
                      <button type="button" className="btn-secondary btn-sm" onClick={() => openJsonPicker(choice.request, `Split “${choice.label}” into columns`, choice.specBase)}>
                        Split into columns
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {fieldSections.map((section) => (
                <div key={section.title} className="rb-available-group">
                  <h4>{section.title}</h4>
                  {section.items.map((item) => {
                    const added = existingSignatures.has(sourceSignature(item.source))
                    return (
                      <div key={`${section.title}-${item.tech || item.label}`} className="rb-available-row">
                        <span>
                          <strong>{item.label}</strong>
                          {item.unit ? <span className="rb-muted"> ({item.unit})</span> : null}
                          {item.tech ? <span className="rb-json-tech">{item.tech}</span> : null}
                          {item.help ? <span className="rb-muted rb-block">{item.help}</span> : null}
                        </span>
                        {item.isJson ? (
                          <button type="button" className="btn-secondary btn-sm" onClick={() => openJsonPicker(
                            { source_kind: 'table', table: definition.source.table, json_column: item.jsonColumn },
                            `Split “${item.label}” into columns`,
                            { type: 'json_path', json_column: item.jsonColumn }
                          )}>Split JSON</button>
                        ) : (
                          <button type="button" className="btn-secondary btn-sm" disabled={added} onClick={() => addDataColumns([item])}>
                            {added ? 'Added' : '+ Add'}
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              ))}
              {fieldSections.length === 0 && <p className="rb-muted">No values match — clear the search or choose data in Step 1.</p>}
            </div>

            <div className="rb-chosen">
              <div className="rb-chosen-head">
                <h4>Report columns ({(definition.columns || []).length})</h4>
                <button type="button" className="btn-primary btn-sm" onClick={() => setFormulaTarget('new')}>
                  <Icon name="calculator" size={14} /> Add calculated column
                </button>
              </div>
              {(definition.columns || []).length === 0 && (
                <div className="empty-table">No columns yet — add values from the left, split a JSON payload, or add a calculated column.</div>
              )}
              {(definition.columns || []).map((column, index) => (
                <div key={column.key} className="rb-column-card">
                  <div className="rb-column-head">
                    <span className="rb-col-order">{index + 1}</span>
                    <input type="text" value={column.label} onChange={(e) => updateColumn(column.key, { label: e.target.value })} aria-label="Column heading" />
                    <span className={`rb-badge ${(column.kind || 'data') === 'calculated' ? 'rb-badge-calc' : ''}`}>{(column.kind || 'data') === 'calculated' ? 'Calculated' : 'Data'}</span>
                    <div className="rb-row-actions">
                      <button type="button" className="btn-secondary btn-sm" onClick={() => moveColumn(column.key, -1)} disabled={index === 0} aria-label="Move left">↑</button>
                      <button type="button" className="btn-secondary btn-sm" onClick={() => moveColumn(column.key, 1)} disabled={index === definition.columns.length - 1} aria-label="Move right">↓</button>
                      <button type="button" className="btn-secondary btn-sm" onClick={() => setExpandedColumn(expandedColumn === column.key ? null : column.key)}><Icon name="sliders" size={14} /></button>
                      <button type="button" className="btn-secondary btn-sm" onClick={() => removeColumn(column.key)} aria-label="Remove column"><Icon name="trash" size={14} /></button>
                    </div>
                  </div>
                  <div className="rb-muted rb-col-origin">
                    {(column.kind || 'data') === 'calculated' ? formulaInWords(column.formula, definition.columns) : columnOriginLabel(column)}
                    {(column.kind || 'data') === 'calculated' && (
                      <button type="button" className="btn-secondary btn-sm" onClick={() => setFormulaTarget(column.key)}><Icon name="edit" size={13} /> Edit calculation</button>
                    )}
                  </div>
                  {expandedColumn === column.key && (
                    <div className="rb-column-settings">
                      <div className="rb-field">
                        <label>Show as</label>
                        <select value={column.data_type || 'text'} onChange={(e) => updateColumn(column.key, { data_type: e.target.value })}>
                          {DATA_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </div>
                      <div className="rb-field">
                        <label>Decimal places (numbers)</label>
                        <input type="number" min="0" max="6" value={column.format?.decimals ?? 3} onChange={(e) => updateColumn(column.key, { format: { ...(column.format || {}), decimals: Number(e.target.value) } })} />
                      </div>
                      <div className="rb-field">
                        <label>Text after number (e.g. % or BBL)</label>
                        <input type="text" value={column.format?.suffix || ''} onChange={(e) => updateColumn(column.key, { format: { ...(column.format || {}), suffix: e.target.value } })} placeholder=" %" />
                      </div>
                      <div className="rb-field">
                        <label>When grouped / in matrix, summarise as</label>
                        <select value={column.aggregate || ''} onChange={(e) => updateColumn(column.key, { aggregate: e.target.value || null })}>
                          <option value="">—</option>
                          {AGGREGATES.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                        </select>
                      </div>
                      <label className="rb-check"><input type="checkbox" checked={Boolean(column.show_total)} onChange={(e) => updateColumn(column.key, { show_total: e.target.checked })} /> Show in TOTAL row</label>
                      <label className="rb-check"><input type="checkbox" checked={Boolean(column.hidden)} onChange={(e) => updateColumn(column.key, { hidden: e.target.checked })} /> Hide (use only inside calculations/filters)</label>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="rb-panel">
          {definition.report_type === 'TABULAR' && (
            <>
              <div className="rb-field">
                <label>How should rows appear?</label>
                <div className="rb-choice-row">
                  <label className={`rb-choice ${!groupedMode ? 'active' : ''}`}>
                    <input type="radio" name="rb-rows" checked={!groupedMode} onChange={() => patchDefinition({ group_by: [] })} />
                    <strong>One row per record (detail)</strong><span>Every ticket / row appears on its own line.</span>
                  </label>
                  <label className={`rb-choice ${groupedMode ? 'active' : ''}`}>
                    <input type="radio" name="rb-rows" checked={groupedMode} onChange={() => {
                      const firstText = (definition.columns || []).find((c) => c.data_type !== 'number') || definition.columns?.[0]
                      patchDefinition({ group_by: firstText ? [{ key: firstText.key, bucket: 'VALUE' }] : [] })
                    }} />
                    <strong>Grouped summary</strong><span>Combine rows with the same values and total/average the numbers.</span>
                  </label>
                </div>
              </div>
              {groupedMode && (
                <div className="rb-field">
                  <label>Group rows by (tick in the order you want)</label>
                  <div className="rb-group-list">
                    {(definition.columns || []).map((column) => {
                      const entry = (definition.group_by || []).find((g) => (g.key || g) === column.key)
                      const checked = Boolean(entry)
                      return (
                        <div key={column.key} className="rb-group-row">
                          <label className="rb-check">
                            <input type="checkbox" checked={checked} onChange={(e) => {
                              const current = (definition.group_by || []).map((g) => (typeof g === 'string' ? { key: g, bucket: 'VALUE' } : g))
                              patchDefinition({ group_by: e.target.checked ? [...current, { key: column.key, bucket: 'VALUE' }] : current.filter((g) => g.key !== column.key) })
                            }} />
                            {column.label}
                          </label>
                          {checked && (column.data_type === 'date' || column.data_type === 'datetime') && (
                            <select value={entry.bucket || 'VALUE'} onChange={(e) => patchDefinition({ group_by: definition.group_by.map((g) => ((g.key || g) === column.key ? { key: column.key, bucket: e.target.value } : g)) })} aria-label="Date grouping period">
                              {BUCKETS.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
                            </select>
                          )}
                          {checked && <span className="rb-muted">#{groupKeys.indexOf(column.key) + 1}</span>}
                        </div>
                      )
                    })}
                  </div>
                  <button type="button" className="btn-secondary btn-sm" onClick={() => setDefinition((current) => ({
                    ...current,
                    columns: current.columns.map((c) => (groupKeys.includes(c.key) || c.aggregate ? c : { ...c, aggregate: c.data_type === 'number' || (c.kind || 'data') === 'calculated' ? 'SUM' : 'FIRST' })),
                  }))}>
                    Auto-fill summaries (numbers = Total)
                  </button>
                  <p className="rb-muted">Every column that is not a grouping needs a summary — set it under the column’s ⚙ settings in Step 2, or use the button above.</p>
                </div>
              )}
            </>
          )}

          {definition.report_type === 'MATRIX' && (
            <div className="rb-grid-2">
              <div className="rb-field">
                <label>Rows down the side (up to 3)</label>
                {[0, 1, 2].map((slot) => {
                  const current = (definition.matrix?.row_keys || [])[slot]
                  const currentKey = typeof current === 'string' ? current : current?.key || ''
                  return (
                    <select key={slot} value={currentKey} onChange={(e) => {
                      const rowKeys = [...((definition.matrix?.row_keys || []).map((r) => (typeof r === 'string' ? { key: r, bucket: 'VALUE' } : r)))]
                      if (e.target.value) rowKeys[slot] = { key: e.target.value, bucket: 'VALUE' }
                      else rowKeys.splice(slot, 1)
                      patchDefinition({ matrix: { ...definition.matrix, row_keys: rowKeys.filter(Boolean) } })
                    }}>
                      <option value="">{slot === 0 ? 'Choose…' : '(none)'}</option>
                      {(definition.columns || []).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                    </select>
                  )
                })}
              </div>
              <div>
                <div className="rb-field">
                  <label>Columns across the top</label>
                  <select value={definition.matrix?.column_key || ''} onChange={(e) => patchDefinition({ matrix: { ...definition.matrix, column_key: e.target.value } })}>
                    <option value="">Choose…</option>
                    {(definition.columns || []).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </select>
                </div>
                <div className="rb-field">
                  <label>If that is a date, make one column per</label>
                  <select value={definition.matrix?.column_bucket || 'VALUE'} onChange={(e) => patchDefinition({ matrix: { ...definition.matrix, column_bucket: e.target.value } })}>
                    {BUCKETS.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
                  </select>
                </div>
                <div className="rb-field">
                  <label>Values inside the matrix</label>
                  <select value={definition.matrix?.value_key || ''} onChange={(e) => patchDefinition({ matrix: { ...definition.matrix, value_key: e.target.value } })}>
                    <option value="">Choose…</option>
                    {(definition.columns || []).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </select>
                </div>
                <div className="rb-field">
                  <label>Combine values as</label>
                  <select value={definition.matrix?.aggregate || 'SUM'} onChange={(e) => patchDefinition({ matrix: { ...definition.matrix, aggregate: e.target.value } })}>
                    {AGGREGATES.filter((a) => ['SUM', 'AVG', 'COUNT', 'MIN', 'MAX'].includes(a.value)).map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                  </select>
                </div>
                <label className="rb-check"><input type="checkbox" checked={definition.matrix?.show_row_totals !== false} onChange={(e) => patchDefinition({ matrix: { ...definition.matrix, show_row_totals: e.target.checked } })} /> Total at the end of each row</label>
              </div>
            </div>
          )}

          <div className="rb-field">
            <label>Fixed conditions (always applied — report users cannot change these)</label>
            <div className="rb-composer-actions">
              <select value={definition.filter_logic || 'AND'} onChange={(e) => patchDefinition({ filter_logic: e.target.value })} aria-label="Combine fixed conditions">
                <option value="AND">Rows must match ALL conditions (AND)</option>
                <option value="OR">Rows must match ANY condition (OR)</option>
              </select>
              <button type="button" className="btn-secondary btn-sm" onClick={() => patchDefinition({ filters: [...(definition.filters || []), { column_key: definition.columns?.[0]?.key || '', operator: 'eq', value: '' }] })}>
                <Icon name="plus" size={14} /> Add condition
              </button>
            </div>
            {(definition.filters || []).map((entry, index) => (
              <div key={index} className="rb-filter-row">
                <select value={entry.column_key || ''} onChange={(e) => patchDefinition({ filters: definition.filters.map((f, i) => (i === index ? { ...f, column_key: e.target.value } : f)) })} aria-label="Filter column">
                  {(definition.columns || []).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
                <select value={entry.operator} onChange={(e) => patchDefinition({ filters: definition.filters.map((f, i) => (i === index ? { ...f, operator: e.target.value } : f)) })} aria-label="Filter condition">
                  {FILTER_OPERATORS.map((op) => <option key={op.value} value={op.value}>{op.label}</option>)}
                </select>
                {!['is_blank', 'is_not_blank'].includes(entry.operator) && (
                  <input type="text" value={Array.isArray(entry.value) ? entry.value.join(', ') : entry.value ?? ''} onChange={(e) => patchDefinition({ filters: definition.filters.map((f, i) => (i === index ? { ...f, value: e.target.value } : f)) })} placeholder={entry.operator === 'in' || entry.operator === 'not_in' ? 'A, B, C' : 'Value'} />
                )}
                {entry.operator === 'between' && (
                  <input type="text" value={entry.value2 ?? ''} onChange={(e) => patchDefinition({ filters: definition.filters.map((f, i) => (i === index ? { ...f, value2: e.target.value } : f)) })} placeholder="And value" />
                )}
                <button type="button" className="btn-secondary btn-sm" onClick={() => patchDefinition({ filters: definition.filters.filter((_, i) => i !== index) })} aria-label="Remove condition"><Icon name="trash" size={14} /></button>
              </div>
            ))}
          </div>

          <div className="rb-field">
            <label>Sort order</label>
            {(definition.sort || []).map((entry, index) => (
              <div key={index} className="rb-filter-row">
                <select value={entry.key} onChange={(e) => patchDefinition({ sort: definition.sort.map((s, i) => (i === index ? { ...s, key: e.target.value } : s)) })} aria-label="Sort column">
                  {(definition.columns || []).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
                <select value={entry.direction || 'asc'} onChange={(e) => patchDefinition({ sort: definition.sort.map((s, i) => (i === index ? { ...s, direction: e.target.value } : s)) })} aria-label="Sort direction">
                  <option value="asc">Smallest / A–Z first</option>
                  <option value="desc">Largest / Z–A first</option>
                </select>
                <button type="button" className="btn-secondary btn-sm" onClick={() => patchDefinition({ sort: definition.sort.filter((_, i) => i !== index) })} aria-label="Remove sort"><Icon name="trash" size={14} /></button>
              </div>
            ))}
            <button type="button" className="btn-secondary btn-sm" onClick={() => patchDefinition({ sort: [...(definition.sort || []), { key: definition.columns?.[0]?.key || '', direction: 'asc' }] })}>
              <Icon name="plus" size={14} /> Add sort
            </button>
            <label className="rb-check"><input type="checkbox" checked={definition.options?.show_totals !== false} onChange={(e) => patchDefinition({ options: { ...(definition.options || {}), show_totals: e.target.checked } })} /> Show a TOTAL row (for columns ticked “Show in TOTAL row”)</label>
          </div>
        </section>
      )}

      {step === 3 && (
        <section className="rb-panel">
          <p className="rb-muted">Every report already asks for a date range. Add any other questions the report user should answer when running it — their choices are always limited to their own locations.</p>
          <div className="rb-composer-actions">
            {[
              ['location', 'Location'], ['operation_type', 'Operation Type'], ['status', 'Status'], ['asset', 'Asset / Tank'],
            ].map(([type, label]) => (
              <button key={type} type="button" className="btn-secondary btn-sm" onClick={() => patchDefinition({
                runtime_filters: [...(definition.runtime_filters || []), { key: slugColumnKey(label, (definition.runtime_filters || []).map((f) => f.key)), label, type }],
              })}>+ {label}</button>
            ))}
            <button type="button" className="btn-secondary btn-sm" onClick={() => patchDefinition({
              runtime_filters: [...(definition.runtime_filters || []), { key: slugColumnKey('filter', (definition.runtime_filters || []).map((f) => f.key)), label: 'Custom filter', type: 'text', column_key: definition.columns?.[0]?.key || '', operator: 'contains' }],
            })}>+ Custom column filter</button>
          </div>
          {(definition.runtime_filters || []).map((entry, index) => {
            const builtin = ['location', 'operation_type', 'status', 'asset'].includes(entry.type)
            const patch = (change) => patchDefinition({ runtime_filters: definition.runtime_filters.map((f, i) => (i === index ? { ...f, ...change } : f)) })
            return (
              <div key={index} className="rb-filter-card">
                <div className="rb-filter-row">
                  <div className="rb-field"><label>Question shown to the user</label><input type="text" value={entry.label || ''} onChange={(e) => patch({ label: e.target.value })} /></div>
                  <div className="rb-field"><label>Type</label>
                    <select value={entry.type} onChange={(e) => patch({ type: e.target.value })}>
                      <option value="location">Location picker</option>
                      <option value="operation_type">Operation Type picker</option>
                      <option value="status">Status picker</option>
                      <option value="asset">Asset picker</option>
                      <option value="text">Text search on a column</option>
                      <option value="number">Number on a column</option>
                      <option value="date">Date on a column</option>
                      <option value="select">Choice list on a column</option>
                    </select>
                  </div>
                  {!builtin && (
                    <div className="rb-field"><label>Column</label>
                      <select value={entry.column_key || ''} onChange={(e) => patch({ column_key: e.target.value })}>
                        {(definition.columns || []).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                      </select>
                    </div>
                  )}
                  {!builtin && entry.type !== 'select' && (
                    <div className="rb-field"><label>Match</label>
                      <select value={entry.operator || (entry.type === 'text' ? 'contains' : 'eq')} onChange={(e) => patch({ operator: e.target.value })}>
                        {FILTER_OPERATORS.map((op) => <option key={op.value} value={op.value}>{op.label}</option>)}
                      </select>
                    </div>
                  )}
                  <button type="button" className="btn-secondary btn-sm" onClick={() => patchDefinition({ runtime_filters: definition.runtime_filters.filter((_, i) => i !== index) })} aria-label="Remove filter"><Icon name="trash" size={14} /></button>
                </div>
                {entry.type === 'select' && (
                  <div className="rb-field"><label>Choices (one per line — leave empty to accept typed values)</label>
                    <textarea rows={3} value={entry.options_text ?? (entry.options || []).join('\n')} onChange={(e) => patch({ options_text: e.target.value })} />
                  </div>
                )}
                <label className="rb-check"><input type="checkbox" checked={Boolean(entry.required)} onChange={(e) => patch({ required: e.target.checked })} /> The user must answer this</label>
              </div>
            )
          })}
          {(definition.runtime_filters || []).length === 0 && <div className="empty-table">Only the date range will be asked.</div>}
        </section>
      )}

      {step === 4 && (
        <section className="rb-panel">
          <div className="rb-field">
            <label>Who can run this report in Reporting?</label>
            <div className="rb-choice-row">
              <label className={`rb-choice ${visibility === 'PRIVATE' ? 'active' : ''}`}>
                <input type="radio" name="rb-vis" checked={visibility === 'PRIVATE'} onChange={() => setVisibility('PRIVATE')} />
                <strong>Only the people below</strong><span>Named users, roles, or everyone working at chosen locations. You (the owner) always keep access.</span>
              </label>
              <label className={`rb-choice ${visibility === 'INTERNAL' ? 'active' : ''}`}>
                <input type="radio" name="rb-vis" checked={visibility === 'INTERNAL'} onChange={() => setVisibility('INTERNAL')} />
                <strong>All report users</strong><span>Anyone holding the “View Custom Report” permission. They still only see their own locations’ data. Use the list below only to give editing rights.</span>
              </label>
            </div>
          </div>

          <GrantEditor grants={grants} setGrants={setGrants} lookups={lookups} />

          <div className="rb-grid-2">
            <div className="rb-field">
              <label htmlFor="rb-status">Status</label>
              <select id="rb-status" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="Active">Active</option>
                <option value="Inactive">Inactive (hidden everywhere)</option>
              </select>
            </div>
            <div className="rb-field">
              <label>Publishing</label>
              <label className="rb-check">
                <input type="checkbox" checked={isPublished} disabled={!canPublish} onChange={(e) => setIsPublished(e.target.checked)} />
                Show in the Reporting menu after saving
              </label>
              {!canPublish && <p className="rb-muted">You can save the design, but publishing needs the “Publish Report Definition” permission — ask an approver to publish it from the report list.</p>}
            </div>
          </div>
        </section>
      )}

      {step === 5 && (
        <section className="rb-panel">
          <form className="rb-preview-controls" onSubmit={(e) => { e.preventDefault(); handlePreview() }}>
            <div className="rb-field"><label htmlFor="rb-from">Date from</label><input id="rb-from" type="date" value={previewDates.dateFrom} onChange={(e) => setPreviewDates({ ...previewDates, dateFrom: e.target.value })} /></div>
            <div className="rb-field"><label htmlFor="rb-to">Date to</label><input id="rb-to" type="date" value={previewDates.dateTo} onChange={(e) => setPreviewDates({ ...previewDates, dateTo: e.target.value })} /></div>
            <button type="submit" className="btn-secondary" disabled={previewBusy}><Icon name="refresh" size={15} /> {previewBusy ? 'Running…' : 'Run preview (first 25 rows)'}</button>
          </form>
          {previewError && (
            <AlertMessage
              tone="error"
              title="Preview could not run"
              message={previewError}
              onDismiss={() => setPreviewError('')}
            />
          )}
          {(previewResult?.meta?.warnings || []).map((warning) => (
            <AlertMessage key={warning} tone="warning" message={warning} />
          ))}
          {previewResult && (
            <>
              <p className="rb-muted">
                {previewResult.meta.total_rows.toLocaleString()} row(s) · dates use “{previewResult.meta.date_basis_label}” · made in {previewResult.meta.generated_in_ms} ms
              </p>
              <ReportDataTable result={previewResult} compact />
            </>
          )}
          {!previewResult && !previewError && <div className="empty-table">Run the preview to see this report with real data before saving.</div>}

          <div className="rb-save-bar">
            <span className="rb-muted">{editingId ? 'Saving creates a new design version (history is kept).' : 'The report is yours — only people you chose in Step 5 can use it.'}</span>
            <button type="button" className="btn-secondary" disabled={busy || !(editingId ? canEdit : canCreate)} onClick={() => handleSave(false)}>Save as draft</button>
            <button type="button" className="btn-primary" disabled={busy || !canPublish || !(editingId ? canEdit : canCreate)} onClick={() => handleSave(true)}>
              <Icon name="check" size={15} /> Save & publish to Reporting
            </button>
          </div>
        </section>
      )}

      <div className="rb-step-nav">
        <button type="button" className="btn-secondary" disabled={step === 0} onClick={() => setStep(step - 1)}><Icon name="chevronLeft" size={15} /> Back</button>
        <span className="rb-muted">Step {step + 1} of {STEPS.length} — {STEPS[step].label.replace(/^\d+ · /, '')}</span>
        {step < STEPS.length - 1 ? (
          <button type="button" className="btn-primary" onClick={() => setStep(step + 1)}>Next <Icon name="chevronRight" size={15} /></button>
        ) : (
          <button type="button" className="btn-secondary" onClick={() => setView('list')}>Finish later</button>
        )}
      </div>

      <FormulaBuilder
        open={formulaTarget !== null}
        initial={formulaTarget && formulaTarget !== 'new' ? (definition.columns || []).find((c) => c.key === formulaTarget) : null}
        columns={(definition.columns || []).filter((c) => c.key !== formulaTarget)}
        onClose={() => setFormulaTarget(null)}
        onSave={handleFormulaSave}
      />
      <JsonColumnPicker
        open={jsonRequest !== null}
        title={jsonTitle}
        request={jsonRequest}
        existingPaths={existingJsonPaths}
        onClose={() => setJsonRequest(null)}
        onAdd={handleJsonAdd}
      />
    </div>
  )
}

function GrantEditor({ grants, setGrants, lookups }) {
  const [draft, setDraft] = useState({ grant_type: 'USER', target: '', access_level: 'VIEW' })
  const options = useMemo(() => {
    if (draft.grant_type === 'USER') return (lookups?.users || []).map((u) => ({ value: String(u.id), label: `${u.full_name} (${u.username})` }))
    if (draft.grant_type === 'ROLE') return (lookups?.roles || []).map((r) => ({ value: String(r.id), label: r.role_name }))
    return (lookups?.locations || []).map((l) => ({ value: l.location_code, label: `${l.location_code} — ${l.location_name}` }))
  }, [draft.grant_type, lookups])

  const addGrant = () => {
    if (!draft.target) return
    const option = options.find((o) => o.value === draft.target)
    const grant = {
      grant_type: draft.grant_type,
      user_id: draft.grant_type === 'USER' ? Number(draft.target) : null,
      role_id: draft.grant_type === 'ROLE' ? Number(draft.target) : null,
      location_code: draft.grant_type === 'LOCATION' ? draft.target : null,
      access_level: draft.grant_type === 'LOCATION' ? 'VIEW' : draft.access_level,
      label: option?.label || draft.target,
    }
    setGrants((current) => [...current, grant])
    setDraft({ ...draft, target: '' })
  }

  return (
    <div className="rb-field">
      <label>Give access to…</label>
      <div className="rb-filter-row">
        <select value={draft.grant_type} onChange={(e) => setDraft({ grant_type: e.target.value, target: '', access_level: 'VIEW' })} aria-label="Give access to a">
          <option value="USER">A user</option>
          <option value="ROLE">A role</option>
          <option value="LOCATION">Everyone at a location</option>
        </select>
        <select value={draft.target} onChange={(e) => setDraft({ ...draft, target: e.target.value })} aria-label="Choose who">
          <option value="">Choose…</option>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {draft.grant_type !== 'LOCATION' && (
          <select value={draft.access_level} onChange={(e) => setDraft({ ...draft, access_level: e.target.value })} aria-label="Access level">
            <option value="VIEW">Can run / export / print</option>
            <option value="EDIT">Can also redesign</option>
          </select>
        )}
        <button type="button" className="btn-secondary" onClick={addGrant} disabled={!draft.target}><Icon name="plus" size={14} /> Add</button>
      </div>
      {draft.grant_type === 'LOCATION' && <p className="rb-muted">Location access is “can run” only — redesign rights are given to named users or roles.</p>}
      <div className="rb-grant-chips">
        {grants.length === 0 && <span className="rb-muted">Nobody added yet — with “Only the people below”, only you can use this report.</span>}
        {grants.map((grant, index) => (
          <span key={index} className="rb-grant-chip">
            <Icon name={grant.grant_type === 'LOCATION' ? 'mapPin' : grant.grant_type === 'ROLE' ? 'shield' : 'user'} size={13} />
            {grant.label || grant.location_code || grant.user_id || grant.role_id}
            <em>{grant.access_level === 'EDIT' ? 'Run + Redesign' : 'Run'}</em>
            <button type="button" onClick={() => setGrants((current) => current.filter((_, i) => i !== index))} aria-label="Remove access">×</button>
          </span>
        ))}
      </div>
    </div>
  )
}

export default ReportBuilder
