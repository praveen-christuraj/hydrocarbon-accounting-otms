import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  createEntityBlock,
  createExportBlock,
  createExportConsignee,
  createExportEntity,
  createExportLocation,
  deleteEntityBlock,
  deleteExportBlock,
  deleteExportConsignee,
  deleteExportEntity,
  deleteExportLocation,
  getEntityBlocks,
  getExportBlocks,
  getExportConfigs,
  getExportConsignees,
  getExportEntities,
  getExportLocations,
  saveExportConfig,
  updateExportBlock,
  updateExportConsignee,
  updateExportEntity,
  updateExportLocation,
} from '../../api/exportOperationsApi'
import PaginationControls, { paginateRows, usePageSize } from '../../components/common/PaginationControls'
import DataTableToolbar from '../../components/common/DataTableToolbar'
import PageHeader from '../../components/common/PageHeader'
import AlertMessage from '../../components/common/AlertMessage'
import FormDialog from '../../components/common/FormDialog'
import Icon from '../../components/common/Icon'
import { useConfirm } from '../../components/common/ConfirmProvider'
import { useDataFilters } from '../../hooks/useDataFilters'
import { usePermissions } from '../../hooks/usePermissions'
import { logUiAction } from '../../utils/actionLogger'
import { EXPORT_MODULE, codeOptions, useExportPermissions } from './exportShared'

const statusColumn = { key: 'status', label: 'Status', type: 'select' }

/**
 * Generic list + dialog page for the simple export reference masters.
 * config: { title, description, entity, singular, load, create, update, remove,
 *           fields: [{ key, label, required, unique, wide }], extraColumns, label(item) }
 */
function ExportCodeMaster({ loggedInUser, config, onChanged, children }) {
  const confirm = useConfirm()
  const { canCreate, canEdit, canDelete } = useExportPermissions(loggedInUser, config.entity)
  const emptyForm = useMemo(() => Object.fromEntries(config.fields.map((field) => [field.key, ''])), [config])

  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [form, setForm] = useState(emptyForm)
  const [editing, setEditing] = useState(null)
  const [formOpen, setFormOpen] = useState(false)
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [page, setPage] = useState(1)
  const pageSize = usePageSize()

  const { load } = config
  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const data = await load()
      setItems(Array.isArray(data) ? data : [])
    } catch (err) {
      setError(err.message || `Unable to load ${config.title.toLowerCase()}.`)
    } finally {
      setLoading(false)
    }
  }, [load, config.title])

  useEffect(() => {
    let cancelled = false
    load()
      .then((data) => {
        if (!cancelled) setItems(Array.isArray(data) ? data : [])
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Unable to load data.')
      })
    return () => {
      cancelled = true
    }
  }, [load])

  const columns = useMemo(
    () => [
      ...config.fields.map((field) => ({ key: field.key, label: field.label })),
      ...(config.extraColumns || []).map(({ key, label, type }) => ({ key, label, type })),
      ...(config.hideStatus ? [] : [statusColumn]),
    ],
    [config]
  )
  const rows = useMemo(() => (config.mapRow ? items.map(config.mapRow) : items), [items, config])
  const filters = useDataFilters(rows, columns, { module: config.title })
  const visibleItems = paginateRows(filters.filteredRows, page, pageSize)

  const openCreate = () => {
    setError('')
    setSuccess('')
    setEditing(null)
    setForm(emptyForm)
    setFormError('')
    setFormOpen(true)
    logUiAction(config.title, 'Open Create Dialog')
  }

  const openEdit = (item) => {
    setError('')
    setSuccess('')
    setEditing(item)
    setForm(Object.fromEntries(config.fields.map((field) => [field.key, item[field.key] ?? ''])))
    setFormError('')
    setFormOpen(true)
    logUiAction(config.title, 'Open Edit Dialog', { id: item.id })
  }

  const closeForm = () => {
    setFormOpen(false)
    setEditing(null)
    setFormError('')
  }

  const handleSubmit = async () => {
    if (!(editing ? canEdit : canCreate)) {
      setFormError(`You do not have permission to ${editing ? 'edit' : 'create'} ${config.title.toLowerCase()}.`)
      return
    }
    const missing = config.fields.filter((field) => field.required && !String(form[field.key] || '').trim())
    if (missing.length) {
      setFormError(`Required: ${missing.map((field) => field.label).join(', ')}.`)
      return
    }
    for (const field of config.fields.filter((item) => item.unique)) {
      const value = String(form[field.key] || '').trim().toLowerCase()
      if (items.some((item) => item.id !== editing?.id && String(item[field.key] || '').trim().toLowerCase() === value)) {
        setFormError(`${field.label} "${form[field.key]}" already exists.`)
        return
      }
    }
    const payload = Object.fromEntries(
      config.fields.map((field) => [field.key, String(form[field.key] || '').trim() || (field.required ? '' : null)])
    )
    try {
      setSaving(true)
      if (editing) await config.update(editing.id, payload)
      else await config.create(payload)
      setSuccess(`${config.singular} ${editing ? 'updated' : 'created'}.`)
      closeForm()
      await reload()
      onChanged?.()
    } catch (err) {
      setFormError(err.message || 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (item) => {
    setError('')
    setSuccess('')
    const confirmed = await confirm({
      title: `Delete ${config.singular.toLowerCase()}`,
      message: `Delete ${config.label(item)}?`,
      tone: 'danger',
      confirmLabel: 'Delete',
      module: EXPORT_MODULE,
    })
    if (!confirmed) return
    try {
      await config.remove(item.id)
      setSuccess(`${config.singular} deleted.`)
      await reload()
      onChanged?.()
    } catch (err) {
      setError(err.message)
    }
  }

  const importConfig = {
    title: `Import ${config.title.toLowerCase()}`,
    description: 'Create records from an Excel or CSV file. Existing codes are skipped.',
    fields: config.fields.map((field) => ({ key: field.key, label: field.label, required: field.required, example: field.example || '' })),
    validateRow: (record) => {
      for (const field of config.fields.filter((item) => item.unique)) {
        const value = String(record[field.key] || '').trim().toLowerCase()
        if (items.some((item) => String(item[field.key] || '').trim().toLowerCase() === value)) {
          return `${field.label} already exists`
        }
      }
      return null
    },
    onImportRow: async (record) => {
      await config.create(
        Object.fromEntries(config.fields.map((field) => [field.key, String(record[field.key] || '').trim() || (field.required ? '' : null)]))
      )
    },
    onComplete: async () => {
      await reload()
      onChanged?.()
    },
  }

  const showActions = canEdit || canDelete
  const columnCount = columns.length + (showActions ? 1 : 0)

  return (
    <div className="export-operations-page">
      <PageHeader
        title={config.title}
        description={config.description}
        count={`${items.length} ${config.countLabel || config.title.replace(/^Export /, '')}`}
        actions={
          canCreate && (
            <button type="button" className="btn-primary" onClick={openCreate}>
              <Icon name="plus" size={15} />
              New {config.singular}
            </button>
          )
        }
      />

      <AlertMessage tone="success" message={success} onDismiss={() => setSuccess('')} />
      <AlertMessage tone="error" message={error} onDismiss={() => setError('')} />
      {!canCreate && !canEdit && !canDelete && (
        <div className="info-box">You have view-only access to {config.title.toLowerCase()}.</div>
      )}

      <DataTableToolbar
        filters={filters}
        columns={columns}
        exportFileName={config.title.toLowerCase().replace(/\s+/g, '-')}
        exportTitle={config.title}
        module={config.title}
        importConfig={importConfig}
        canImport={canCreate}
      />

      <table>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key}>{column.label}</th>
            ))}
            {showActions && <th>Actions</th>}
          </tr>
        </thead>
        <tbody>
          {visibleItems.length === 0 ? (
            <tr>
              <td colSpan={columnCount} className="empty-table">
                {loading ? 'Loading…' : items.length === 0 ? `No ${config.title.toLowerCase()} yet.` : 'No records match the filters.'}
              </td>
            </tr>
          ) : (
            visibleItems.map((item) => (
              <tr key={item.id}>
                {config.fields.map((field, index) => (
                  <td key={field.key} className={field.wide ? 'cell-wrap' : undefined}>
                    {index === 0 ? <strong className="cell-strong">{item[field.key]}</strong> : item[field.key] || '—'}
                  </td>
                ))}
                {(config.extraColumns || []).map((column) => (
                  <td key={column.key}>{column.render ? column.render(item) : item[column.key] || '—'}</td>
                ))}
                {!config.hideStatus && (
                  <td>
                    <span className={`status-badge ${String(item.status || '').toLowerCase()}`}>{item.status}</span>
                  </td>
                )}
                {showActions && (
                  <td className="row-actions">
                    {canEdit && (
                      <button type="button" onClick={() => openEdit(item)}>
                        Edit
                      </button>
                    )}
                    {canDelete && (
                      <button type="button" onClick={() => handleDelete(item)}>
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

      <PaginationControls currentPage={page} totalRows={filters.filteredRows.length} onPageChange={setPage} />

      {children}

      <FormDialog
        open={formOpen}
        title={editing ? `Edit ${config.singular}` : `New ${config.singular}`}
        description={config.dialogDescription}
        submitLabel={editing ? `Update ${config.singular}` : `Save ${config.singular}`}
        busy={saving}
        error={formError}
        onDismissError={() => setFormError('')}
        onSubmit={handleSubmit}
        onCancel={closeForm}
      >
        {config.fields.map((field) => (
          <div key={field.key} className={field.wide ? 'full-width-field' : undefined}>
            <label htmlFor={`xm-${field.key}`}>
              {field.label}
              {field.required ? ' *' : ''}
            </label>
            {field.wide ? (
              <textarea
                id={`xm-${field.key}`}
                rows="2"
                value={form[field.key]}
                onChange={(e) => setForm((current) => ({ ...current, [field.key]: e.target.value }))}
              />
            ) : (
              <input
                id={`xm-${field.key}`}
                value={form[field.key]}
                placeholder={field.example ? `Example: ${field.example}` : undefined}
                onChange={(e) => setForm((current) => ({ ...current, [field.key]: e.target.value }))}
              />
            )}
          </div>
        ))}
      </FormDialog>
    </div>
  )
}

const LOCATION_CONFIG = {
  title: 'Export Locations',
  description: 'Terminals and loading points used for export liftings.',
  entity: 'Export Location',
  singular: 'Location',
  countLabel: 'Locations',
  load: getExportLocations,
  create: createExportLocation,
  update: updateExportLocation,
  remove: deleteExportLocation,
  fields: [
    { key: 'location_name', label: 'Name', required: true, example: 'Utapate Terminal' },
    { key: 'location_code', label: 'Code', required: true, unique: true, example: 'UTP' },
    { key: 'description', label: 'Description', wide: true },
  ],
  label: (item) => `${item.location_name} (${item.location_code})`,
}

const ENTITY_CONFIG = {
  title: 'Export Entities',
  description: 'Companies or joint ventures that own export volumes.',
  entity: 'Export Entity',
  singular: 'Entity',
  countLabel: 'Entities',
  load: getExportEntities,
  create: createExportEntity,
  update: updateExportEntity,
  remove: deleteExportEntity,
  fields: [
    { key: 'entity_name', label: 'Name', required: true },
    { key: 'entity_code', label: 'Code', required: true, unique: true },
    { key: 'description', label: 'Description', wide: true },
  ],
  label: (item) => `${item.entity_name} (${item.entity_code})`,
}

const CONSIGNEE_CONFIG = {
  title: 'Export Consignees',
  description: 'Consignees offered in the export transaction form.',
  entity: 'Export Consignee',
  singular: 'Consignee',
  countLabel: 'Consignees',
  hideStatus: true,
  load: getExportConsignees,
  create: createExportConsignee,
  update: updateExportConsignee,
  remove: deleteExportConsignee,
  fields: [
    { key: 'consignee_name', label: 'Consignee Name', required: true, unique: true },
    { key: 'description', label: 'Description', wide: true },
  ],
  label: (item) => `consignee "${item.consignee_name}"`,
}

const BLOCK_CONFIG = {
  title: 'Export Blocks',
  description: 'Production blocks, and which entities each block is mapped to.',
  entity: 'Export Block',
  singular: 'Block',
  countLabel: 'Blocks',
  load: getExportBlocks,
  create: createExportBlock,
  update: updateExportBlock,
  remove: deleteExportBlock,
  fields: [
    { key: 'block_name', label: 'Name', required: true },
    { key: 'block_code', label: 'Code', required: true, unique: true },
    { key: 'description', label: 'Description', wide: true },
  ],
  mapRow: (item) => ({ ...item, entity_list: (item.entity_names || []).join(', ') }),
  extraColumns: [{ key: 'entity_list', label: 'Entities' }],
  label: (item) => `${item.block_name} (${item.block_code})`,
}

export function ExportLocations({ loggedInUser }) {
  return <ExportCodeMaster loggedInUser={loggedInUser} config={LOCATION_CONFIG} />
}

export function ExportEntities({ loggedInUser }) {
  return <ExportCodeMaster loggedInUser={loggedInUser} config={ENTITY_CONFIG} />
}

export function ExportConsignees({ loggedInUser }) {
  return <ExportCodeMaster loggedInUser={loggedInUser} config={CONSIGNEE_CONFIG} />
}

const MAPPING_COLUMNS = [
  { key: 'entity_label', label: 'Entity', type: 'select' },
  { key: 'block_label', label: 'Block', type: 'select' },
]

function EntityBlockMappings({ loggedInUser, refreshKey }) {
  const confirm = useConfirm()
  const { hasPermission } = usePermissions(loggedInUser)
  // Linking entities and blocks is part of maintaining a block.
  const canMap = hasPermission('Edit Export Block')
  const [mappings, setMappings] = useState([])
  const [entities, setEntities] = useState([])
  const [blocks, setBlocks] = useState([])
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState({ entity_code: '', block_code: '' })
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [page, setPage] = useState(1)
  const pageSize = usePageSize()

  const reload = useCallback(async () => {
    try {
      const [links, entityRows, blockRows] = await Promise.all([getEntityBlocks(), getExportEntities(), getExportBlocks()])
      setMappings(Array.isArray(links) ? links : [])
      setEntities(Array.isArray(entityRows) ? entityRows : [])
      setBlocks(Array.isArray(blockRows) ? blockRows : [])
    } catch (err) {
      setError(err.message || 'Unable to load entity-block mappings.')
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    Promise.all([getEntityBlocks(), getExportEntities(), getExportBlocks()])
      .then(([links, entityRows, blockRows]) => {
        if (cancelled) return
        setMappings(Array.isArray(links) ? links : [])
        setEntities(Array.isArray(entityRows) ? entityRows : [])
        setBlocks(Array.isArray(blockRows) ? blockRows : [])
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Unable to load entity-block mappings.')
      })
    return () => {
      cancelled = true
    }
  }, [refreshKey])

  const rows = useMemo(
    () =>
      mappings.map((link) => ({
        ...link,
        entity_label: `${link.entity_name} (${link.entity_code})`,
        block_label: `${link.block_name} (${link.block_code})`,
      })),
    [mappings]
  )
  const filters = useDataFilters(rows, MAPPING_COLUMNS, { module: 'Export Entity-Block Mappings' })
  const visibleRows = paginateRows(filters.filteredRows, page, pageSize)

  const handleSubmit = async () => {
    if (!form.entity_code || !form.block_code) {
      setFormError('Select both an entity and a block.')
      return
    }
    if (mappings.some((link) => link.entity_code === form.entity_code && link.block_code === form.block_code)) {
      setFormError('This entity is already mapped to the block.')
      return
    }
    try {
      setSaving(true)
      await createEntityBlock(form.entity_code, form.block_code)
      setSuccess('Mapping added.')
      setFormOpen(false)
      await reload()
    } catch (err) {
      setFormError(err.message || 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (link) => {
    setError('')
    setSuccess('')
    const confirmed = await confirm({
      title: 'Remove mapping',
      message: `Remove the mapping ${link.entity_name} – ${link.block_name}?`,
      tone: 'danger',
      confirmLabel: 'Remove',
      module: EXPORT_MODULE,
    })
    if (!confirmed) return
    try {
      await deleteEntityBlock(link.id)
      setSuccess('Mapping removed.')
      await reload()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <section className="page-subsection">
      <div className="section-title section-title-with-actions">
        <div>
          <h3>Entity-Block Mappings</h3>
          <p>Only mapped blocks are offered for an entity in permits and export transactions.</p>
        </div>
        {canMap && (
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              setForm({ entity_code: '', block_code: '' })
              setFormError('')
              setFormOpen(true)
              logUiAction('Export Blocks', 'Open Mapping Dialog')
            }}
          >
            <Icon name="plus" size={15} />
            New Mapping
          </button>
        )}
      </div>

      <AlertMessage tone="success" message={success} onDismiss={() => setSuccess('')} />
      <AlertMessage tone="error" message={error} onDismiss={() => setError('')} />

      <DataTableToolbar
        filters={filters}
        columns={MAPPING_COLUMNS}
        exportFileName="export-entity-block-mappings"
        exportTitle="Export Entity-Block Mappings"
        module="Export Blocks"
      />

      <table>
        <thead>
          <tr>
            <th>Entity</th>
            <th>Block</th>
            {canMap && <th>Actions</th>}
          </tr>
        </thead>
        <tbody>
          {visibleRows.length === 0 ? (
            <tr>
              <td colSpan={canMap ? 3 : 2} className="empty-table">
                No entity-block mappings.
              </td>
            </tr>
          ) : (
            visibleRows.map((link) => (
              <tr key={link.id}>
                <td>{link.entity_label}</td>
                <td>{link.block_label}</td>
                {canMap && (
                  <td className="row-actions">
                    <button type="button" className="btn-danger" onClick={() => handleDelete(link)}>
                      Remove
                    </button>
                  </td>
                )}
              </tr>
            ))
          )}
        </tbody>
      </table>

      <PaginationControls currentPage={page} totalRows={filters.filteredRows.length} onPageChange={setPage} />

      <FormDialog
        open={formOpen}
        title="New Entity-Block Mapping"
        size="sm"
        columns={1}
        submitLabel="Add Mapping"
        busy={saving}
        error={formError}
        onDismissError={() => setFormError('')}
        onSubmit={handleSubmit}
        onCancel={() => setFormOpen(false)}
      >
        <div>
          <label htmlFor="xb-entity">Entity *</label>
          <select id="xb-entity" value={form.entity_code} onChange={(e) => setForm((c) => ({ ...c, entity_code: e.target.value }))}>
            <option value="">Select entity</option>
            {codeOptions(entities, 'entity_name', 'entity_code')}
          </select>
        </div>
        <div>
          <label htmlFor="xb-block">Block *</label>
          <select id="xb-block" value={form.block_code} onChange={(e) => setForm((c) => ({ ...c, block_code: e.target.value }))}>
            <option value="">Select block</option>
            {codeOptions(blocks, 'block_name', 'block_code')}
          </select>
        </div>
      </FormDialog>
    </section>
  )
}

export function ExportBlocks({ loggedInUser }) {
  const [refreshKey, setRefreshKey] = useState(0)
  return (
    <ExportCodeMaster loggedInUser={loggedInUser} config={BLOCK_CONFIG} onChanged={() => setRefreshKey((key) => key + 1)}>
      <EntityBlockMappings loggedInUser={loggedInUser} refreshKey={refreshKey} />
    </ExportCodeMaster>
  )
}

const SETTING_DEFAULTS = [
  { key: 'permit_insufficiency_threshold_pct', description: 'Permit insufficiency alert threshold (%)', value: '90' },
  { key: 'default_export_uom', description: 'Default unit of measure for volumes', value: 'bbls' },
]

const SETTING_COLUMNS = [
  { key: 'config_key', label: 'Key' },
  { key: 'config_value', label: 'Value' },
  { key: 'description', label: 'Description' },
  statusColumn,
]

export function ExportSettings({ loggedInUser }) {
  const { hasPermission } = usePermissions(loggedInUser)
  const canEdit = hasPermission('Edit Export Settings')
  const [configs, setConfigs] = useState([])
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [form, setForm] = useState({ config_key: '', config_value: '', description: '' })
  const [editingExisting, setEditingExisting] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [page, setPage] = useState(1)
  const pageSize = usePageSize()

  const reload = useCallback(async () => {
    try {
      const data = await getExportConfigs()
      setConfigs(Array.isArray(data) ? data : [])
    } catch (err) {
      setError(err.message || 'Unable to load export settings.')
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    getExportConfigs()
      .then((data) => {
        if (!cancelled) setConfigs(Array.isArray(data) ? data : [])
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Unable to load export settings.')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const filters = useDataFilters(configs, SETTING_COLUMNS, { module: 'Export Settings' })
  const visibleRows = paginateRows(filters.filteredRows, page, pageSize)

  const openDialog = (config) => {
    setError('')
    setSuccess('')
    setFormError('')
    setEditingExisting(Boolean(config))
    setForm(
      config
        ? { config_key: config.config_key, config_value: config.config_value || '', description: config.description || '' }
        : { config_key: '', config_value: '', description: '' }
    )
    setFormOpen(true)
    logUiAction('Export Settings', config ? 'Open Edit Dialog' : 'Open Create Dialog')
  }

  const handleKeyChange = (key) => {
    const preset = SETTING_DEFAULTS.find((item) => item.key === key)
    const existing = configs.find((item) => item.config_key === key)
    setForm({
      config_key: key,
      config_value: existing?.config_value ?? preset?.value ?? '',
      description: existing?.description ?? preset?.description ?? '',
    })
    setFormError('')
  }

  const handleSubmit = async () => {
    if (!canEdit) {
      setFormError('You do not have permission to edit export settings.')
      return
    }
    if (!form.config_key || !String(form.config_value).trim()) {
      setFormError('Key and value are required.')
      return
    }
    try {
      setSaving(true)
      await saveExportConfig({ ...form, config_value: String(form.config_value).trim() })
      setSuccess(`Setting ${form.config_key} saved.`)
      setFormOpen(false)
      await reload()
    } catch (err) {
      setFormError(err.message || 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="export-operations-page">
      <PageHeader
        title="Export Settings"
        description="Key-value settings used by export dashboards and permit checks."
        count={`${configs.length} Settings`}
        actions={
          canEdit && (
            <button type="button" className="btn-primary" onClick={() => openDialog(null)}>
              <Icon name="sliders" size={15} />
              Configure Setting
            </button>
          )
        }
      />

      <AlertMessage tone="success" message={success} onDismiss={() => setSuccess('')} />
      <AlertMessage tone="error" message={error} onDismiss={() => setError('')} />
      {!canEdit && <div className="info-box">You have view-only access to export settings.</div>}

      <DataTableToolbar
        filters={filters}
        columns={SETTING_COLUMNS}
        exportFileName="export-settings"
        exportTitle="Export Settings"
        module="Export Settings"
      />

      <table>
        <thead>
          <tr>
            <th>Key</th>
            <th>Value</th>
            <th>Description</th>
            <th>Status</th>
            {canEdit && <th>Actions</th>}
          </tr>
        </thead>
        <tbody>
          {visibleRows.length === 0 ? (
            <tr>
              <td colSpan={canEdit ? 5 : 4} className="empty-table">
                No settings saved yet. Defaults apply.
              </td>
            </tr>
          ) : (
            visibleRows.map((config) => (
              <tr key={config.id}>
                <td><code>{config.config_key}</code></td>
                <td><strong className="cell-strong">{config.config_value}</strong></td>
                <td className="cell-wrap">{config.description || '—'}</td>
                <td>
                  <span className={`status-badge ${String(config.status || '').toLowerCase()}`}>{config.status}</span>
                </td>
                {canEdit && (
                  <td className="row-actions">
                    <button type="button" onClick={() => openDialog(config)}>
                      Edit
                    </button>
                  </td>
                )}
              </tr>
            ))
          )}
        </tbody>
      </table>

      <PaginationControls currentPage={page} totalRows={filters.filteredRows.length} onPageChange={setPage} />

      <FormDialog
        open={formOpen}
        title={editingExisting ? `Edit ${form.config_key}` : 'Configure Setting'}
        columns={1}
        size="sm"
        submitLabel="Save Setting"
        busy={saving}
        error={formError}
        onDismissError={() => setFormError('')}
        onSubmit={handleSubmit}
        onCancel={() => setFormOpen(false)}
      >
        <div>
          <label htmlFor="xs-key">Key *</label>
          <select id="xs-key" value={form.config_key} onChange={(e) => handleKeyChange(e.target.value)} disabled={editingExisting}>
            <option value="">Select a setting</option>
            {[...new Set([...SETTING_DEFAULTS.map((item) => item.key), ...configs.map((item) => item.config_key)])].map((key) => (
              <option key={key} value={key}>
                {key}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="xs-value">Value *</label>
          <input id="xs-value" value={form.config_value} onChange={(e) => setForm((c) => ({ ...c, config_value: e.target.value }))} />
        </div>
        <div>
          <label htmlFor="xs-description">Description</label>
          <input id="xs-description" value={form.description} onChange={(e) => setForm((c) => ({ ...c, description: e.target.value }))} />
        </div>
      </FormDialog>
    </div>
  )
}
