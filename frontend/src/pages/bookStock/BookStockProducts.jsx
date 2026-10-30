import { useCallback, useEffect, useState } from 'react'
import {
  createBookStockProduct,
  deleteBookStockProduct,
  getBookStockProducts,
  updateBookStockProduct,
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
import { BOOK_STOCK_MODULE, useBookStockPermissions } from './bookStockShared'

const MODULE = BOOK_STOCK_MODULE
const COLUMNS = [
  { key: 'product_code', label: 'Product Code' },
  { key: 'product_name', label: 'Product Name' },
  { key: 'unit', label: 'Unit', type: 'select' },
  { key: 'display_order', label: 'Order', type: 'number' },
  { key: 'description', label: 'Description' },
  { key: 'status', label: 'Status', type: 'select' },
  { key: 'updated_by', label: 'Updated By' },
]

const emptyForm = {
  product_code: '',
  product_name: '',
  unit: 'BBL',
  description: '',
  display_order: 0,
  status: 'Active',
}

function BookStockProducts({ loggedInUser }) {
  const confirm = useConfirm()
  const { canCreate, canEdit, canDelete } = useBookStockPermissions(loggedInUser, 'Book Stock Product')
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [page, setPage] = useState(1)
  const pageSize = usePageSize()

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const payload = await getBookStockProducts({ include_inactive: 'true' })
      setItems(Array.isArray(payload) ? payload : [])
    } catch (err) {
      setError(err.message || 'Unable to load Book Stock products.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load])

  const filters = useDataFilters(items, COLUMNS, { module: MODULE })
  const visibleRows = paginateRows(filters.filteredRows, page, pageSize)
  const activeCount = items.filter((item) => String(item.status).toLowerCase() === 'active').length

  const openCreate = () => {
    setError('')
    setSuccess('')
    setEditing(null)
    setForm(emptyForm)
    setFormError('')
    setFormOpen(true)
    logUiAction(MODULE, 'Open Create Product Dialog')
  }

  const openEdit = (item) => {
    setError('')
    setSuccess('')
    setEditing(item)
    setForm({
      product_code: item.product_code || '',
      product_name: item.product_name || '',
      unit: item.unit || 'BBL',
      description: item.description || '',
      display_order: item.display_order || 0,
      status: item.status || 'Active',
    })
    setFormError('')
    setFormOpen(true)
    logUiAction(MODULE, 'Open Edit Product Dialog', { id: item.id })
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

  const handleSubmit = async () => {
    if (!(editing ? canEdit : canCreate)) {
      setFormError(`You do not have permission to ${editing ? 'edit' : 'create'} Book Stock products.`)
      return
    }
    if (!form.product_code.trim() || !form.product_name.trim()) {
      setFormError('Product code and product name are required.')
      return
    }
    const payload = {
      product_code: form.product_code.trim().toUpperCase(),
      product_name: form.product_name.trim(),
      unit: form.unit.trim() || 'BBL',
      description: form.description.trim() || null,
      display_order: Number(form.display_order || 0),
      status: form.status,
    }
    try {
      setSaving(true)
      if (editing) await updateBookStockProduct(editing.id, payload)
      else await createBookStockProduct(payload)
      setSuccess(editing ? 'Product updated.' : 'Product created.')
      logUiAction(MODULE, editing ? 'Update Product' : 'Create Product', payload)
      closeForm()
      await load()
    } catch (err) {
      setFormError(err.message || 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (item) => {
    if (!canDelete) {
      setError('You do not have permission to delete Book Stock products.')
      return
    }
    setError('')
    setSuccess('')
    const confirmed = await confirm({
      title: 'Delete book stock product',
      message: `Deactivate ${item.product_name} (${item.product_code})? Historical stock entries are kept and stay reportable.`,
      tone: 'danger',
      confirmLabel: 'Delete',
      module: MODULE,
    })
    if (!confirmed) return
    try {
      await deleteBookStockProduct(item.id)
      setSuccess('Product deleted (deactivated).')
      logUiAction(MODULE, 'Delete Product', { id: item.id, product_code: item.product_code })
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  const importConfig = {
    templateKey: 'book-stock-products',
    title: 'Bulk upload Book Stock products',
    description: 'Create the module products from Excel or CSV. Only two products can be active at a time.',
    fields: [
      { key: 'product_code', label: 'Product Code', required: true, example: 'OIL' },
      { key: 'product_name', label: 'Product Name', required: true, example: 'Crude Oil' },
      { key: 'unit', label: 'Unit', example: 'BBL' },
      { key: 'display_order', label: 'Display Order', example: '1' },
      { key: 'description', label: 'Description', example: '' },
      { key: 'status', label: 'Status (Active / Inactive)', example: 'Active' },
    ],
    validateRow: (record) => {
      const code = String(record.product_code || '').trim().toLowerCase()
      if (!code) return 'Product code is required'
      if (items.some((item) => String(item.product_code).toLowerCase() === code)) return 'Product code already exists'
      return null
    },
    onImportRow: async (record) => {
      await createBookStockProduct({
        product_code: String(record.product_code).trim().toUpperCase(),
        product_name: String(record.product_name || '').trim(),
        unit: String(record.unit || 'BBL').trim(),
        description: String(record.description || '').trim() || null,
        display_order: Number(record.display_order || 0),
        status: String(record.status || 'Active').trim() || 'Active',
      })
    },
    onComplete: async () => {
      await load()
    },
  }

  const showActions = canEdit || canDelete
  const columnCount = showActions ? 8 : 7

  return (
    <div className="book-stock-page">
      <PageHeader
        title="Book Stock Products"
        description="The two products produced and transported in the Government Data Book Stock stream. Every stock entry, calculation and report is product-specific."
        count={`${activeCount} Active / ${items.length} Products`}
        actions={
          canCreate && (
            <button type="button" className="btn-primary" onClick={openCreate}>
              <Icon name="plus" size={15} />
              New Product
            </button>
          )
        }
      />

      <AlertMessage tone="success" message={success} onDismiss={() => setSuccess('')} />
      <AlertMessage tone="error" message={error} onDismiss={() => setError('')} />
      {activeCount >= 2 && <div className="info-box">Two products are already active. Deactivate one before activating another.</div>}

      <DataTableToolbar
        filters={filters}
        columns={COLUMNS}
        exportFileName="book-stock-products"
        exportTitle="Book Stock Products"
        module={MODULE}
        importConfig={importConfig}
        canImport={canCreate}
        canExport
        searchPlaceholder="Search product code, name, unit…"
      />

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Product Code</th>
              <th>Product Name</th>
              <th>Unit</th>
              <th className="numeric">Order</th>
              <th>Description</th>
              <th>Status</th>
              <th>Updated</th>
              {showActions && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 ? (
              <tr>
                <td colSpan={columnCount} className="empty-table">
                  {loading ? 'Loading…' : 'No Book Stock products configured yet.'}
                </td>
              </tr>
            ) : (
              visibleRows.map((item) => (
                <tr key={item.id}>
                  <td>{item.product_code}</td>
                  <td>{item.product_name}</td>
                  <td>{item.unit}</td>
                  <td className="numeric">{item.display_order}</td>
                  <td className="cell-wrap">{item.description || '—'}</td>
                  <td>
                    <span className={`status-badge ${String(item.status).toLowerCase() === 'active' ? 'approved' : 'inactive'}`}>
                      {item.status}
                    </span>
                  </td>
                  <td>
                    {item.updated_by || '—'}
                    <div className="muted-table-text">{String(item.updated_at || '').slice(0, 16).replace('T', ' ')}</div>
                  </td>
                  {showActions && (
                    <td className="row-actions">
                      {canEdit && (
                        <button type="button" onClick={() => openEdit(item)}>
                          Edit
                        </button>
                      )}
                      {canDelete && String(item.status).toLowerCase() === 'active' && (
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
      </div>

      <PaginationControls currentPage={page} totalRows={filters.filteredRows.length} onPageChange={setPage} />

      <FormDialog
        open={formOpen}
        title={editing ? 'Edit Book Stock Product' : 'New Book Stock Product'}
        description="The module supports two active products; each production, dispatch and closing stock value is kept per product."
        size="md"
        columns={2}
        submitLabel={editing ? 'Update Product' : 'Save Product'}
        busy={saving}
        error={formError}
        onDismissError={() => setFormError('')}
        onSubmit={handleSubmit}
        onCancel={closeForm}
      >
        <div>
          <label htmlFor="bs-product-code">Product Code *</label>
          <input
            id="bs-product-code"
            value={form.product_code}
            onChange={(event) => setField('product_code', event.target.value.toUpperCase())}
            maxLength={50}
            disabled={Boolean(editing)}
          />
          {editing && <span className="field-hint">The product code identifies historical stock entries and cannot be changed.</span>}
        </div>
        <div>
          <label htmlFor="bs-product-name">Product Name *</label>
          <input id="bs-product-name" value={form.product_name} onChange={(event) => setField('product_name', event.target.value)} maxLength={150} />
        </div>
        <div>
          <label htmlFor="bs-product-unit">Unit</label>
          <input id="bs-product-unit" value={form.unit} onChange={(event) => setField('unit', event.target.value)} maxLength={30} />
        </div>
        <div>
          <label htmlFor="bs-product-order">Display Order</label>
          <input id="bs-product-order" type="number" value={form.display_order} onChange={(event) => setField('display_order', event.target.value)} />
        </div>
        <div>
          <label htmlFor="bs-product-status">Status</label>
          <select id="bs-product-status" value={form.status} onChange={(event) => setField('status', event.target.value)}>
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
          </select>
        </div>
        <div className="bs-form-wide">
          <label htmlFor="bs-product-description">Description</label>
          <textarea id="bs-product-description" rows={2} value={form.description} onChange={(event) => setField('description', event.target.value)} />
        </div>
      </FormDialog>
    </div>
  )
}

export default BookStockProducts
