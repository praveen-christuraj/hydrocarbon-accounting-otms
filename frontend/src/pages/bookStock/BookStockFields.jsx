import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  createBookStockField,
  deleteBookStockField,
  getBookStockFields,
  updateBookStockField,
} from '../../api/bookStockApi'
import PageHeader from '../../components/common/PageHeader'
import AlertMessage from '../../components/common/AlertMessage'
import FormDialog from '../../components/common/FormDialog'
import Icon from '../../components/common/Icon'
import DataTableToolbar from '../../components/common/DataTableToolbar'
import PaginationControls, { paginateRows, usePageSize } from '../../components/common/PaginationControls'
import { useConfirm } from '../../components/common/ConfirmProvider'
import { useDataFilters } from '../../hooks/useDataFilters'
import { logUiAction } from '../../utils/actionLogger'
import { blocksForEntity } from '../../utils/bookStockUtils'
import {
  BOOK_STOCK_MODULE,
  blockOptions,
  entityOptions,
  useBookStockPermissions,
  useBookStockReferenceData,
} from './bookStockShared'

const MODULE = BOOK_STOCK_MODULE
const COLUMNS = [
  { key: 'field_code', label: 'Field Code' },
  { key: 'field_name', label: 'Field Name' },
  { key: 'entity_name', label: 'Entity', type: 'select' },
  { key: 'block_name', label: 'Block', type: 'select' },
  { key: 'products_label', label: 'Products Produced', type: 'select' },
  { key: 'description', label: 'Description' },
  { key: 'status', label: 'Status', type: 'select' },
]

const emptyForm = {
  field_code: '',
  field_name: '',
  entity_code: '',
  block_code: '',
  product_codes: [],
  description: '',
  status: 'Active',
}

function BookStockFields({ loggedInUser }) {
  const confirm = useConfirm()
  const reference = useBookStockReferenceData()
  const { entities, blocks, entity_blocks: entityBlocks, active_products: activeProducts } = reference.data
  const { canCreate, canEdit, canDelete } = useBookStockPermissions(loggedInUser, 'Book Stock Field')

  const [fields, setFields] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [filterEntity, setFilterEntity] = useState('')
  const [filterBlock, setFilterBlock] = useState('')
  const [page, setPage] = useState(1)
  const pageSize = usePageSize()

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const payload = await getBookStockFields({ include_inactive: 'true' })
      setFields(Array.isArray(payload) ? payload : [])
    } catch (err) {
      setError(err.message || 'Unable to load Book Stock fields.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load])

  const rows = useMemo(
    () =>
      fields
        .filter((field) => !filterEntity || String(field.entity_code).toLowerCase() === filterEntity.toLowerCase())
        .filter((field) => !filterBlock || String(field.block_code).toLowerCase() === filterBlock.toLowerCase())
        .map((field) => ({
          ...field,
          entity_label: field.entity_name || field.entity_code,
          block_label: field.block_name || field.block_code,
          products_label: (field.product_names || []).join(', ') || (field.product_codes || []).join(', '),
        })),
    [fields, filterEntity, filterBlock]
  )
  const filters = useDataFilters(rows, COLUMNS, { module: MODULE })
  const visibleRows = paginateRows(filters.filteredRows, page, pageSize)
  const formBlocks = useMemo(
    () => blocksForEntity(blocks, entityBlocks, form.entity_code),
    [blocks, entityBlocks, form.entity_code]
  )

  const openCreate = () => {
    setError('')
    setSuccess('')
    setEditing(null)
    setForm({ ...emptyForm, entity_code: entities[0]?.entity_code || '', product_codes: [] })
    setFormError('')
    setFormOpen(true)
    logUiAction(MODULE, 'Open Create Field Dialog')
  }

  const openEdit = (field) => {
    setError('')
    setSuccess('')
    setEditing(field)
    setForm({
      field_code: field.field_code || '',
      field_name: field.field_name || '',
      entity_code: field.entity_code || '',
      block_code: field.block_code || '',
      product_codes: [...(field.product_codes || [])],
      description: field.description || '',
      status: field.status || 'Active',
    })
    setFormError('')
    setFormOpen(true)
    logUiAction(MODULE, 'Open Edit Field Dialog', { id: field.id })
  }

  const closeForm = () => {
    setFormOpen(false)
    setEditing(null)
    setFormError('')
  }

  const setField = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }))
    setFormError('')
  }

  const toggleProduct = (productCode) => {
    setForm((current) => {
      const selected = current.product_codes.includes(productCode)
      const next = selected
        ? current.product_codes.filter((code) => code !== productCode)
        : [...current.product_codes, productCode]
      return { ...current, product_codes: next }
    })
    setFormError('')
  }

  const handleEntityChange = (entityCode) => {
    setForm((current) => ({ ...current, entity_code: entityCode, block_code: '' }))
    setFormError('')
  }

  const handleSubmit = async () => {
    if (!(editing ? canEdit : canCreate)) {
      setFormError(`You do not have permission to ${editing ? 'edit' : 'create'} Book Stock fields.`)
      return
    }
    const missing = []
    if (!form.field_code.trim()) missing.push('Field code')
    if (!form.field_name.trim()) missing.push('Field name')
    if (!form.entity_code) missing.push('Entity')
    if (!form.block_code) missing.push('Block')
    if (form.product_codes.length === 0) missing.push('at least one product')
    if (missing.length) {
      setFormError(`Required: ${missing.join(', ')}.`)
      return
    }
    const payload = {
      field_code: form.field_code.trim().toUpperCase(),
      field_name: form.field_name.trim(),
      entity_code: form.entity_code,
      block_code: form.block_code,
      product_codes: form.product_codes,
      description: form.description.trim() || null,
      status: form.status,
    }
    try {
      setSaving(true)
      if (editing) await updateBookStockField(editing.id, payload)
      else await createBookStockField(payload)
      setSuccess(editing ? 'Field updated.' : 'Field created.')
      logUiAction(MODULE, editing ? 'Update Field' : 'Create Field', payload)
      closeForm()
      await Promise.all([load(), reference.reload()])
    } catch (err) {
      setFormError(err.message || 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (field) => {
    if (!canDelete) {
      setError('You do not have permission to delete Book Stock fields.')
      return
    }
    setError('')
    setSuccess('')
    const confirmed = await confirm({
      title: 'Delete book stock field',
      message: `Deactivate ${field.field_name} (${field.field_code})? Historical production lines are kept.`,
      tone: 'danger',
      confirmLabel: 'Delete',
      module: MODULE,
    })
    if (!confirmed) return
    try {
      await deleteBookStockField(field.id)
      setSuccess('Field deleted (deactivated).')
      logUiAction(MODULE, 'Delete Field', { id: field.id, field_code: field.field_code })
      await Promise.all([load(), reference.reload()])
    } catch (err) {
      setError(err.message)
    }
  }

  const importConfig = {
    templateKey: 'book-stock-fields',
    title: 'Bulk upload Book Stock fields',
    description: 'One row per producing field. Product codes are separated by commas (OIL,GAS).',
    fields: [
      { key: 'entity_code', label: 'Entity Code', required: true, example: entities[0]?.entity_code || 'ENT001' },
      { key: 'block_code', label: 'Block Code', required: true, example: blocks[0]?.block_code || 'BLK001' },
      { key: 'field_code', label: 'Field Code', required: true, example: 'F1' },
      { key: 'field_name', label: 'Field Name', required: true, example: 'Field One' },
      { key: 'product_codes', label: 'Product Codes (comma separated)', required: true, example: 'OIL,GAS' },
      { key: 'description', label: 'Description', example: '' },
      { key: 'status', label: 'Status (Active / Inactive)', example: 'Active' },
    ],
    validateRow: (record) => {
      if (!record.entity_code || !record.block_code) return 'Entity and block are required'
      if (!blocksForEntity(blocks, entityBlocks, record.entity_code).some((block) => String(block.block_code).toLowerCase() === String(record.block_code).toLowerCase())) {
        return `Block ${record.block_code} is not mapped to entity ${record.entity_code}`
      }
      const codes = String(record.product_codes || '').split(',').map((code) => code.trim().toUpperCase()).filter(Boolean)
      if (!codes.length) return 'At least one product code is required'
      const active = new Set(activeProducts.map((product) => String(product.product_code).toUpperCase()))
      const unknown = codes.filter((code) => !active.has(code))
      if (unknown.length) return `Unknown or inactive product code(s): ${unknown.join(', ')}`
      if (fields.some((field) => String(field.field_code).toLowerCase() === String(record.field_code).toLowerCase())) return 'Field code already exists'
      return null
    },
    onImportRow: async (record) => {
      await createBookStockField({
        entity_code: record.entity_code,
        block_code: record.block_code,
        field_code: String(record.field_code).trim().toUpperCase(),
        field_name: String(record.field_name).trim(),
        product_codes: String(record.product_codes).split(',').map((code) => code.trim().toUpperCase()).filter(Boolean),
        description: String(record.description || '').trim() || null,
        status: String(record.status || 'Active').trim() || 'Active',
      })
    },
    onComplete: async () => {
      await Promise.all([load(), reference.reload()])
    },
  }

  const showActions = canEdit || canDelete
  const columnCount = showActions ? 8 : 7

  return (
    <div className="book-stock-page">
      <PageHeader
        title="Book Stock Fields"
        description="Producing fields inside each Export Operations block. Field production is entered daily; each field can produce one or both Book Stock products."
        count={`${fields.length} Fields`}
        actions={
          canCreate && (
            <button type="button" className="btn-primary" onClick={openCreate}>
              <Icon name="plus" size={15} />
              New Field
            </button>
          )
        }
      />

      <AlertMessage tone="success" message={success} onDismiss={() => setSuccess('')} />
      <AlertMessage tone="error" message={error || reference.error} onDismiss={() => setError('')} />

      <div className="report-filter-panel compact-filter-panel no-print">
        <div>
          <label htmlFor="bs-field-entity">Entity</label>
          <select
            id="bs-field-entity"
            value={filterEntity}
            onChange={(event) => {
              setFilterEntity(event.target.value)
              setFilterBlock('')
              setPage(1)
            }}
          >
            <option value="">All entities</option>
            {entityOptions(entities)}
          </select>
        </div>
        <div>
          <label htmlFor="bs-field-block">Block</label>
          <select id="bs-field-block" value={filterBlock} onChange={(event) => { setFilterBlock(event.target.value); setPage(1) }}>
            <option value="">All blocks</option>
            {blockOptions(blocksForEntity(blocks, entityBlocks, filterEntity))}
          </select>
        </div>
      </div>

      <DataTableToolbar
        filters={filters}
        columns={COLUMNS}
        exportFileName="book-stock-fields"
        exportTitle="Book Stock Fields"
        module={MODULE}
        importConfig={importConfig}
        canImport={canCreate}
        canExport
        searchPlaceholder="Search field code, name, product…"
      />

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Field Code</th>
              <th>Field Name</th>
              <th>Entity</th>
              <th>Block</th>
              <th>Products Produced</th>
              <th>Description</th>
              <th>Status</th>
              {showActions && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 ? (
              <tr>
                <td colSpan={columnCount} className="empty-table">
                  {loading ? 'Loading…' : 'No producing fields configured yet.'}
                </td>
              </tr>
            ) : (
              visibleRows.map((field) => (
                <tr key={field.id}>
                  <td>{field.field_code}</td>
                  <td>{field.field_name}</td>
                  <td>{field.entity_name || field.entity_code}</td>
                  <td>{field.block_name || field.block_code}</td>
                  <td className="cell-wrap">{(field.product_names || []).join(', ') || (field.product_codes || []).join(', ')}</td>
                  <td className="cell-wrap">{field.description || '—'}</td>
                  <td>
                    <span className={`status-badge ${String(field.status).toLowerCase() === 'active' ? 'approved' : 'inactive'}`}>
                      {field.status}
                    </span>
                  </td>
                  {showActions && (
                    <td className="row-actions">
                      {canEdit && (
                        <button type="button" onClick={() => openEdit(field)}>
                          Edit
                        </button>
                      )}
                      {canDelete && String(field.status).toLowerCase() === 'active' && (
                        <button type="button" onClick={() => handleDelete(field)}>
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
      </div>

      <PaginationControls currentPage={page} totalRows={filters.filteredRows.length} onPageChange={setPage} />

      <FormDialog
        open={formOpen}
        title={editing ? 'Edit Book Stock Field' : 'New Book Stock Field'}
        description="A field belongs to one Export Operations entity and block. Its production is captured per product, date-wise."
        size="lg"
        columns={2}
        submitLabel={editing ? 'Update Field' : 'Save Field'}
        busy={saving}
        error={formError}
        onDismissError={() => setFormError('')}
        onSubmit={handleSubmit}
        onCancel={closeForm}
      >
        <div>
          <label htmlFor="bs-field-entity-form">Entity *</label>
          <select id="bs-field-entity-form" value={form.entity_code} onChange={(event) => handleEntityChange(event.target.value)}>
            <option value="">Select entity</option>
            {entityOptions(entities)}
          </select>
        </div>
        <div>
          <label htmlFor="bs-field-block-form">Block *</label>
          <select id="bs-field-block-form" value={form.block_code} onChange={(event) => setField('block_code', event.target.value)} disabled={!form.entity_code}>
            <option value="">Select block</option>
            {blockOptions(formBlocks)}
          </select>
        </div>
        <div>
          <label htmlFor="bs-field-code">Field Code *</label>
          <input id="bs-field-code" value={form.field_code} onChange={(event) => setField('field_code', event.target.value.toUpperCase())} maxLength={50} />
        </div>
        <div>
          <label htmlFor="bs-field-name">Field Name *</label>
          <input id="bs-field-name" value={form.field_name} onChange={(event) => setField('field_name', event.target.value)} maxLength={200} />
        </div>
        <div className="bs-form-wide">
          <label>Products Produced *</label>
          <div className="bs-product-checks">
            {activeProducts.map((product) => (
              <label key={product.product_code} className="bs-check">
                <input
                  type="checkbox"
                  checked={form.product_codes.includes(product.product_code)}
                  onChange={() => toggleProduct(product.product_code)}
                />
                <span>{product.product_name} ({product.product_code})</span>
              </label>
            ))}
          </div>
          {activeProducts.length === 0 && <div className="info-box">Configure Book Stock products first.</div>}
          <span className="field-hint">One field can produce both products; stock is always kept separate per product.</span>
        </div>
        <div>
          <label htmlFor="bs-field-status">Status</label>
          <select id="bs-field-status" value={form.status} onChange={(event) => setField('status', event.target.value)}>
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
          </select>
        </div>
        <div className="bs-form-wide">
          <label htmlFor="bs-field-description">Description</label>
          <textarea id="bs-field-description" rows={2} value={form.description} onChange={(event) => setField('description', event.target.value)} />
        </div>
      </FormDialog>
    </div>
  )
}

export default BookStockFields
