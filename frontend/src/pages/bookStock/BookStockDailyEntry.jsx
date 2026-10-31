import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  bulkUploadBookStockEntries,
  createBookStockDailyEntry,
  deleteBookStockDailyEntry,
  getBookStockDailyEntries,
  getBookStockOpeningSuggestion,
  updateBookStockDailyEntry,
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
import {
  computeClosingStock,
  fieldsForBlock,
  parseFieldProductionText,
  roundQty,
  sumProduction,
} from '../../utils/bookStockUtils'
import {
  BOOK_STOCK_EMPTY_FILTERS,
  BOOK_STOCK_MODULE,
  BookStockFilterPanel,
  blockOptions,
  entityOptions,
  fmt,
  productOptions,
  signed,
  todayIso,
  useBookStockPermissions,
  useBookStockReferenceData,
} from './bookStockShared'
import { blocksForEntity } from '../../utils/bookStockUtils'

const MODULE = BOOK_STOCK_MODULE
const LOAD_LIMIT = 20000

const COLUMNS = [
  { key: 'entry_date', label: 'Stock Date', type: 'date' },
  { key: 'entity_name', label: 'Entity', type: 'select' },
  { key: 'block_name', label: 'Block', type: 'select' },
  { key: 'product_name', label: 'Product', type: 'select' },
  { key: 'opening_stock', label: 'Opening Stock', type: 'number' },
  { key: 'production', label: 'Field Production', type: 'number' },
  { key: 'dispatch', label: 'Dispatch', type: 'number' },
  { key: 'adjustment', label: 'Adjustment', type: 'number' },
  { key: 'closing_stock', label: 'Closing Stock', type: 'number' },
  { key: 'opening_carried', label: 'Opening Carried', type: 'select' },
  { key: 'remarks', label: 'Remarks' },
]

const emptyForm = () => ({
  entry_date: todayIso(),
  entity_code: '',
  block_code: '',
  product_code: '',
  opening_stock: '',
  dispatch: '',
  adjustment: '',
  remarks: '',
  fieldValues: {},
})

function BookStockDailyEntry({ loggedInUser }) {
  const confirm = useConfirm()
  const [searchParams] = useSearchParams()
  const reference = useBookStockReferenceData()
  const { products, active_products: activeProducts, fields, entities, blocks, entity_blocks: entityBlocks, settings } = reference.data
  const { canCreate, canEdit, canDelete } = useBookStockPermissions(loggedInUser, 'Book Stock Entry')

  const [entries, setEntries] = useState([])
  const [filters, setFilters] = useState(BOOK_STOCK_EMPTY_FILTERS)
  const [appliedFilters, setAppliedFilters] = useState(BOOK_STOCK_EMPTY_FILTERS)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [page, setPage] = useState(1)
  const pageSize = usePageSize()

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [openingTouched, setOpeningTouched] = useState(false)
  const [suggestion, setSuggestion] = useState(null)
  const [suggestionLoading, setSuggestionLoading] = useState(false)
  const suggestionRequest = useRef(0)

  const loadEntries = useCallback(async (activeFilters = appliedFilters) => {
    setLoading(true)
    setError('')
    try {
      const payload = await getBookStockDailyEntries({ ...activeFilters, limit: LOAD_LIMIT })
      const items = Array.isArray(payload?.items) ? payload.items : Array.isArray(payload) ? payload : []
      setEntries(items)
    } catch (err) {
      setError(err.message || 'Unable to load Book Stock daily entries.')
    } finally {
      setLoading(false)
    }
  }, [appliedFilters])

  // Deep link from the Book Stock Export Operations page:
  // /book-stock/daily-entries?entity=…&block=…
  useEffect(() => {
    const next = {
      ...BOOK_STOCK_EMPTY_FILTERS,
      entity_code: searchParams.get('entity') || '',
      block_code: searchParams.get('block') || '',
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFilters(next)
    setAppliedFilters(next)
    setPage(1)
    loadEntries(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  const rows = useMemo(
    () =>
      [...entries]
        .sort((a, b) => String(b.entry_date || '').localeCompare(String(a.entry_date || '')) || b.id - a.id)
        .map((entry) => ({
          ...entry,
          entity_label: entry.entity_name || entry.entity_code,
          block_label: entry.block_name || entry.block_code,
          product_label: entry.product_name || entry.product_code,
        })),
    [entries]
  )
  const filtersState = useDataFilters(rows, COLUMNS, { module: MODULE })
  const visibleRows = paginateRows(filtersState.filteredRows, page, pageSize)

  const showActions = canEdit || canDelete
  const columnCount = showActions ? 12 : 11

  const applyFilters = () => {
    setAppliedFilters(filters)
    setPage(1)
    logUiAction(MODULE, 'Apply Entry Filters', filters)
    loadEntries(filters)
  }
  const clearFilters = () => {
    setFilters(BOOK_STOCK_EMPTY_FILTERS)
    setAppliedFilters(BOOK_STOCK_EMPTY_FILTERS)
    setPage(1)
    loadEntries(BOOK_STOCK_EMPTY_FILTERS)
  }

  const formBlocks = useMemo(
    () => blocksForEntity(blocks, entityBlocks, form.entity_code),
    [blocks, entityBlocks, form.entity_code]
  )
  const formFields = useMemo(
    () =>
      fieldsForBlock(fields, {
        entityCode: form.entity_code,
        blockCode: form.block_code,
        productCode: form.product_code,
      }),
    [fields, form.entity_code, form.block_code, form.product_code]
  )

  const productionPreview = useMemo(
    () =>
      sumProduction(
        formFields.map((field) => ({ production_qty: form.fieldValues[field.field_code] }))
      ),
    [formFields, form.fieldValues]
  )
  const closingPreview = useMemo(
    () =>
      computeClosingStock({
        openingStock: form.opening_stock,
        production: productionPreview,
        dispatch: form.dispatch,
        adjustment: form.adjustment,
      }),
    [form.opening_stock, productionPreview, form.dispatch, form.adjustment]
  )
  const negativeClosingBlocked = useMemo(
    () => String(settings?.allow_negative_closing || 'Yes').toLowerCase() !== 'yes' && closingPreview < 0,
    [settings, closingPreview]
  )

  const resetForm = useCallback(() => {
    setForm(emptyForm())
    setEditing(null)
    setFormError('')
    setOpeningTouched(false)
    setSuggestion(null)
  }, [])

  const openCreate = () => {
    setError('')
    setSuccess('')
    setEditing(null)
    setFormError('')
    setOpeningTouched(false)
    setSuggestion(null)
    setForm({
      ...emptyForm(),
      entity_code: entities[0]?.entity_code || '',
      product_code: activeProducts[0]?.product_code || '',
    })
    setFormOpen(true)
    logUiAction(MODULE, 'Open New Daily Stock Entry')
  }

  const openEdit = (entry) => {
    setError('')
    setSuccess('')
    const values = {}
    for (const line of entry.field_productions || []) {
      values[line.field_code] = String(line.production_qty ?? '')
    }
    setEditing(entry)
    setForm({
      entry_date: entry.entry_date || todayIso(),
      entity_code: entry.entity_code || '',
      block_code: entry.block_code || '',
      product_code: entry.product_code || '',
      opening_stock: String(entry.opening_stock ?? ''),
      dispatch: String(entry.dispatch ?? ''),
      adjustment: String(entry.adjustment ?? ''),
      remarks: entry.remarks || '',
      fieldValues: values,
    })
    setOpeningTouched(true)
    setSuggestion(null)
    setFormError('')
    setFormOpen(true)
    logUiAction(MODULE, 'Open Edit Daily Stock Entry', { id: entry.id })
  }

  const closeForm = () => {
    setFormOpen(false)
    resetForm()
  }

  const setField = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }))
    setFormError('')
  }

  const resetSelection = (patch) => {
    setForm((current) => ({ ...current, opening_stock: '', ...patch }))
    setFormError('')
    setOpeningTouched(false)
    setSuggestion(null)
  }

  const handleEntityChange = (entityCode) => {
    resetSelection({ entity_code: entityCode, block_code: '', product_code: form.product_code, fieldValues: {} })
  }
  const handleBlockChange = (blockCode) => {
    resetSelection({ block_code: blockCode, fieldValues: {} })
  }
  const handleProductChange = (productCode) => {
    resetSelection({ product_code: productCode, fieldValues: {} })
  }
  const handleDateChange = (value) => {
    setForm((current) => ({ ...current, entry_date: value, opening_stock: '' }))
    setFormError('')
    setOpeningTouched(false)
    setSuggestion(null)
  }

  // Opening stock suggestion: previous day's closing for the same
  // entity + block + product. Only fills the field while it is untouched.
  useEffect(() => {
    if (!formOpen) return undefined
    if (!form.entry_date || !form.entity_code || !form.block_code || !form.product_code) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSuggestion(null)
      return undefined
    }
    const requestId = suggestionRequest.current + 1
    suggestionRequest.current = requestId
    setSuggestionLoading(true)
    getBookStockOpeningSuggestion({
      entity_code: form.entity_code,
      block_code: form.block_code,
      product_code: form.product_code,
      entry_date: form.entry_date,
    })
      .then((data) => {
        if (suggestionRequest.current !== requestId) return
        setSuggestion(data)
        // Auto-carry can be switched off in settings: in that case the opening
        // stock is a deliberate manual entry, so only prefill when enabled.
        if (!openingTouched && data?.auto_carry_enabled) {
          setForm((current) => ({ ...current, opening_stock: String(data?.opening_stock ?? 0) }))
        }
      })
      .catch(() => {
        if (suggestionRequest.current === requestId) setSuggestion(null)
      })
      .finally(() => {
        if (suggestionRequest.current === requestId) setSuggestionLoading(false)
      })
    return undefined
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formOpen, form.entry_date, form.entity_code, form.block_code, form.product_code])

  const usePreviousClosing = () => {
    setForm((current) => ({ ...current, opening_stock: String(suggestion?.opening_stock ?? 0) }))
    setOpeningTouched(true)
    logUiAction(MODULE, 'Use Previous Closing As Opening', {
      previous_entry_date: suggestion?.previous_entry_date,
      opening_stock: suggestion?.opening_stock,
    })
  }

  const updateFieldValue = (fieldCode, value) => {
    setForm((current) => ({
      ...current,
      fieldValues: { ...current.fieldValues, [fieldCode]: value },
    }))
    setFormError('')
  }

  const validate = () => {
    const missing = []
    if (!form.entry_date) missing.push('Stock date')
    if (!form.entity_code) missing.push('Entity')
    if (!form.block_code) missing.push('Block')
    if (!form.product_code) missing.push('Product')
    if (missing.length) return `Required: ${missing.join(', ')}.`
    if (!formFields.length) {
      return 'This block has no producing field configured for the selected product. Configure a field first (Book Stock Fields).'
    }
    const negative = []
    if (Number(form.opening_stock) < 0) negative.push('Opening stock')
    if (Number(form.dispatch) < 0) negative.push('Dispatch')
    for (const field of formFields) {
      if (Number(form.fieldValues[field.field_code] || 0) < 0) negative.push(`${field.field_name} production`)
    }
    if (negative.length) return `${negative.join(', ')} cannot be negative.`
    if (Number(form.adjustment) < 0 && String(settings?.allow_negative_adjustment || 'Yes').toLowerCase() !== 'yes') {
      return 'Negative adjustments are disabled in Book Stock settings.'
    }
    if (negativeClosingBlocked) {
      return 'The closing stock would be negative and negative closing stock is disabled in Book Stock settings.'
    }
    if (!editing) {
      const duplicate = entries.find(
        (entry) =>
          entry.entry_date === form.entry_date &&
          String(entry.entity_code).toLowerCase() === form.entity_code.toLowerCase() &&
          String(entry.block_code).toLowerCase() === form.block_code.toLowerCase() &&
          String(entry.product_code).toLowerCase() === form.product_code.toLowerCase()
      )
      if (duplicate) {
        return 'This entity, block, product and date already has a stock entry. Edit the existing row instead.'
      }
    }
    return ''
  }

  const handleSubmit = async () => {
    if (!(editing ? canEdit : canCreate)) {
      setFormError(`You do not have permission to ${editing ? 'edit' : 'create'} Book Stock entries.`)
      return
    }
    const problem = validate()
    if (problem) {
      setFormError(problem)
      return
    }
    const fieldProductions = formFields.map((field) => ({
      field_code: field.field_code,
      production_qty: roundQty(form.fieldValues[field.field_code] || 0),
    }))
    const payload = {
      entry_date: form.entry_date,
      entity_code: form.entity_code,
      block_code: form.block_code,
      product_code: form.product_code,
      opening_stock: openingTouched ? roundQty(form.opening_stock || 0) : null,
      dispatch: roundQty(form.dispatch || 0),
      adjustment: roundQty(form.adjustment || 0),
      carry_opening: true,
      remarks: form.remarks.trim() || null,
      field_productions: fieldProductions,
    }
    try {
      setSaving(true)
      if (editing) await updateBookStockDailyEntry(editing.id, payload)
      else await createBookStockDailyEntry(payload)
      setSuccess(editing ? 'Book stock entry updated.' : 'Book stock entry saved.')
      logUiAction(MODULE, editing ? 'Update Daily Stock Entry' : 'Create Daily Stock Entry', {
        id: editing?.id,
        ...payload,
      })
      closeForm()
      await loadEntries()
    } catch (err) {
      setFormError(err.message || 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (entry) => {
    if (!canDelete) {
      setError('You do not have permission to delete Book Stock entries.')
      return
    }
    setError('')
    setSuccess('')
    const confirmed = await confirm({
      title: 'Permanently delete Book Stock entry',
      message: `Permanently delete the ${entry.product_name || entry.product_code} entry for ${entry.block_name || entry.block_code} on ${entry.entry_date}? This cannot be undone. The audit trail keeps a copy of the values.`,
      tone: 'danger',
      confirmLabel: 'Permanently delete',
      module: MODULE,
    })
    if (!confirmed) return
    try {
      await deleteBookStockDailyEntry(entry.id)
      setSuccess('Book Stock entry permanently deleted.')
      logUiAction(MODULE, 'Permanently Delete Daily Stock Entry', { id: entry.id, entry_date: entry.entry_date })
      await loadEntries()
    } catch (err) {
      setError(err.message)
    }
  }

  const codes = (items, key) => new Set(items.map((item) => String(item[key]).toLowerCase()))
  const importConfig = {
    templateKey: 'book-stock-daily-entries',
    title: 'Bulk upload Book Stock daily entries',
    description: 'One row per stock date + entity + block + product. Field production uses FIELD_CODE=QTY; start a new field with a semicolon (F1=120; F2=80).',
    fields: [
      { key: 'entry_date', label: 'Stock Date (YYYY-MM-DD)', required: true, example: todayIso() },
      { key: 'entity_code', label: 'Entity Code', required: true, example: entities[0]?.entity_code || 'ENT001' },
      { key: 'block_code', label: 'Block Code', required: true, example: blocks[0]?.block_code || 'BLK001' },
      { key: 'product_code', label: 'Product Code', required: true, example: activeProducts[0]?.product_code || 'OIL' },
      { key: 'opening_stock', label: 'Opening Stock (blank = carry previous closing)', example: '1000' },
      { key: 'dispatch', label: 'Dispatch', example: '150' },
      { key: 'adjustment', label: 'Adjustment (+ / -)', example: '-25' },
      { key: 'field_productions', label: 'Field Production (F1=120; F2=80)', example: "F1=120; F2=80" },
      { key: 'remarks', label: 'Remarks', example: '' },
    ],
    validateRow: (record) => {
      if (!record.entry_date || Number.isNaN(Date.parse(record.entry_date))) return 'Stock date must be a valid date (YYYY-MM-DD)'
      if (!codes(entities, 'entity_code').has(String(record.entity_code || '').toLowerCase())) return `Unknown entity code ${record.entity_code}`
      if (!codes(blocks, 'block_code').has(String(record.block_code || '').toLowerCase())) return `Unknown block code ${record.block_code}`
      if (!codes(activeProducts, 'product_code').has(String(record.product_code || '').toLowerCase())) return `Unknown or inactive product code ${record.product_code}`
      const linked = blocksForEntity(blocks, entityBlocks, record.entity_code)
      if (!linked.some((block) => String(block.block_code).toLowerCase() === String(record.block_code).toLowerCase())) {
        return `Block ${record.block_code} is not mapped to entity ${record.entity_code}`
      }
      try {
        const lines = parseFieldProductionText(record.field_productions)
        const available = fieldsForBlock(fields, {
          entityCode: record.entity_code,
          blockCode: record.block_code,
          productCode: record.product_code,
        })
        const availableCodes = new Set(available.map((field) => String(field.field_code).toLowerCase()))
        for (const line of lines) {
          if (!availableCodes.has(String(line.field_code).toLowerCase())) {
            return `Field ${line.field_code} does not produce ${record.product_code} in this block`
          }
        }
        if (!available.length) return 'This block has no field configured for the selected product'
      } catch (err) {
        return err.message
      }
      if (Number(record.opening_stock || 0) < 0) return 'Opening stock cannot be negative'
      if (Number(record.dispatch || 0) < 0) return 'Dispatch cannot be negative'
      const duplicate = entries.find(
        (entry) =>
          entry.entry_date === record.entry_date &&
          String(entry.entity_code).toLowerCase() === String(record.entity_code).toLowerCase() &&
          String(entry.block_code).toLowerCase() === String(record.block_code).toLowerCase() &&
          String(entry.product_code).toLowerCase() === String(record.product_code).toLowerCase()
      )
      if (duplicate) return 'A stock entry already exists for this date, entity, block and product'
      return null
    },
    onImportBatch: async (rows) => {
      const items = rows.map(({ record }) => ({
        entry_date: record.entry_date,
        entity_code: record.entity_code,
        block_code: record.block_code,
        product_code: record.product_code,
        opening_stock:
          record.opening_stock === '' || record.opening_stock === undefined || record.opening_stock === null
            ? null
            : Number(record.opening_stock),
        dispatch: Number(record.dispatch || 0),
        adjustment: Number(record.adjustment || 0),
        remarks: record.remarks || null,
        field_productions: parseFieldProductionText(record.field_productions),
      }))
      const result = await bulkUploadBookStockEntries(items)
      const results = Array.isArray(result?.results) ? result.results : []
      return rows.map(({ rowNumber }, index) => {
        const row = results[index]
        if (!row) return { rowNumber, status: 'failed', message: 'The server did not return a result for this row.' }
        return {
          rowNumber,
          status: row.status === 'imported' ? 'success' : 'failed',
          message: row.message || (row.status === 'imported' ? 'Imported' : 'Import failed'),
        }
      })
    },
    onComplete: async () => {
      setSuccess('Bulk upload finished. Review the results below.')
      await loadEntries()
    },
  }

  return (
    <div className="book-stock-page">
      <PageHeader
        title="Book Stock Daily Entry"
        description="Government Data — date-wise field production, block dispatch and signed adjustments per product. Closing stock = Opening + Production − Dispatch + Adjustment."
        count={`${entries.length} Entries`}
        actions={
          canCreate && (
            <button type="button" className="btn-primary" onClick={openCreate}>
              <Icon name="plus" size={15} />
              New Stock Entry
            </button>
          )
        }
      />

      <AlertMessage tone="success" message={success} onDismiss={() => setSuccess('')} />
      <AlertMessage tone="error" message={error || reference.error} onDismiss={() => setError('')} />
      {!canCreate && !canEdit && !canDelete && (
        <div className="info-box">You have view-only access to Book Stock entries.</div>
      )}

      <BookStockFilterPanel
        filters={filters}
        setFilters={setFilters}
        entities={entities}
        blocks={blocks}
        entityBlocks={entityBlocks}
        products={products}
        onApply={applyFilters}
        onClear={clearFilters}
        loading={loading}
        idPrefix="bs-entry"
      />

      <DataTableToolbar
        filters={filtersState}
        columns={COLUMNS}
        exportFileName="book-stock-daily-entries"
        exportTitle="Book Stock Daily Entries"
        module={MODULE}
        importConfig={importConfig}
        canImport={canCreate}
        canExport
        searchPlaceholder="Search entity, block, product, remarks…"
      />

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Stock Date</th>
              <th>Entity</th>
              <th>Block</th>
              <th>Product</th>
              <th className="numeric">Opening</th>
              <th className="numeric">Field Production</th>
              <th className="numeric">Dispatch</th>
              <th className="numeric">Adjustment</th>
              <th className="numeric">Closing</th>
              <th>Opening Carried</th>
              <th>Remarks</th>
              {showActions && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 ? (
              <tr>
                <td colSpan={columnCount} className="empty-table">
                  {loading
                    ? 'Loading…'
                    : entries.length === 0
                      ? 'No Book Stock entries yet.'
                      : 'No entries match the filters.'}
                </td>
              </tr>
            ) : (
              visibleRows.map((entry) => (
                <tr key={entry.id}>
                  <td>{entry.entry_date}</td>
                  <td>{entry.entity_name || entry.entity_code}</td>
                  <td>{entry.block_name || entry.block_code}</td>
                  <td>
                    {entry.product_name || entry.product_code}
                    <div className="muted-table-text">{entry.unit || ''}</div>
                  </td>
                  <td className="numeric">{fmt(entry.opening_stock)}</td>
                  <td className="numeric">
                    {fmt(entry.production)}
                    {entry.field_productions?.length > 0 && (
                      <div className="muted-table-text">
                        {entry.field_productions.map((line) => `${line.field_code}: ${fmt(line.production_qty)}`).join(' · ')}
                      </div>
                    )}
                  </td>
                  <td className="numeric">{fmt(entry.dispatch)}</td>
                  <td className={`numeric ${Number(entry.adjustment) < 0 ? 'value-negative' : Number(entry.adjustment) > 0 ? 'value-positive' : ''}`}>
                    {signed(entry.adjustment)}
                  </td>
                  <td className={`numeric strong-cell ${Number(entry.closing_stock) < 0 ? 'value-negative' : ''}`}>
                    {fmt(entry.closing_stock)}
                  </td>
                  <td>{entry.opening_carried === 'Yes' ? 'Auto from previous day' : 'Entered'}</td>
                  <td className="cell-wrap">{entry.remarks || '—'}</td>
                  {showActions && (
                    <td className="row-actions">
                      {canEdit && (
                        <button type="button" onClick={() => openEdit(entry)}>
                          Edit
                        </button>
                      )}
                      {canDelete && (
                        <button type="button" onClick={() => handleDelete(entry)}>
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

      <PaginationControls currentPage={page} totalRows={filtersState.filteredRows.length} onPageChange={setPage} />

      <FormDialog
        open={formOpen}
        title={editing ? 'Edit Book Stock Entry' : 'New Book Stock Entry'}
        description="One product per entry. Field production is entered date-wise; dispatch and adjustments are at block level."
        size="xl"
        columns={3}
        submitLabel={editing ? 'Update Entry' : 'Save Entry'}
        busy={saving}
        error={formError}
        onDismissError={() => setFormError('')}
        onSubmit={handleSubmit}
        onCancel={closeForm}
      >
        <div>
          <label htmlFor="bs-entry-date">Stock Date *</label>
          <input id="bs-entry-date" type="date" value={form.entry_date} onChange={(event) => handleDateChange(event.target.value)} />
        </div>
        <div>
          <label htmlFor="bs-entry-entity">Entity *</label>
          <select id="bs-entry-entity" value={form.entity_code} onChange={(event) => handleEntityChange(event.target.value)}>
            <option value="">Select entity</option>
            {entityOptions(entities)}
          </select>
        </div>
        <div>
          <label htmlFor="bs-entry-block">Block *</label>
          <select id="bs-entry-block" value={form.block_code} onChange={(event) => handleBlockChange(event.target.value)} disabled={!form.entity_code}>
            <option value="">Select block</option>
            {blockOptions(formBlocks)}
          </select>
        </div>
        <div>
          <label htmlFor="bs-entry-product">Product *</label>
          <select id="bs-entry-product" value={form.product_code} onChange={(event) => handleProductChange(event.target.value)}>
            <option value="">Select product</option>
            {productOptions(activeProducts)}
          </select>
        </div>
        <div>
          <label htmlFor="bs-entry-opening">Opening Stock *</label>
          <input
            id="bs-entry-opening"
            type="number"
            step="any"
            value={form.opening_stock}
            onChange={(event) => {
              setOpeningTouched(true)
              setField('opening_stock', event.target.value)
            }}
          />
          <span className="field-hint">
            {suggestionLoading
              ? 'Checking previous day closing…'
              : suggestion?.auto_carry_enabled === false
                ? 'Auto-carry opening stock is switched off in settings; enter the opening stock or use the previous closing.'
                : suggestion?.previous_entry_date
                  ? `Previous closing ${fmt(suggestion.previous_closing_stock)} on ${suggestion.previous_entry_date}.`
                  : 'No earlier stock entry for this entity, block and product.'}
          </span>
          {suggestion?.previous_entry_date && (
            <button type="button" className="btn-secondary btn-sm" onClick={usePreviousClosing}>
              Use previous closing
            </button>
          )}
        </div>
        <div>
          <label htmlFor="bs-entry-dispatch">Dispatch</label>
          <input id="bs-entry-dispatch" type="number" step="any" min="0" value={form.dispatch} onChange={(event) => setField('dispatch', event.target.value)} />
        </div>
        <div>
          <label htmlFor="bs-entry-adjustment">Adjustment (+ / −)</label>
          <input id="bs-entry-adjustment" type="number" step="any" value={form.adjustment} onChange={(event) => setField('adjustment', event.target.value)} />
          <span className="field-hint">Negative is deducted; positive is added.</span>
        </div>

        <div className="bs-field-production">
          <h4>Field production — {form.product_code || 'select a product'}</h4>
          {!form.entity_code || !form.block_code || !form.product_code ? (
            <div className="info-box">Select an entity, block and product to list its producing fields.</div>
          ) : formFields.length === 0 ? (
            <div className="info-box">
              No producing field is configured for this product in the block. Configure one in Book Stock Fields first.
            </div>
          ) : (
            <div className="bs-field-grid">
              {formFields.map((field) => (
                <div key={field.id}>
                  <label htmlFor={`bs-production-${field.id}`}>
                    {field.field_name}
                    <small>{field.field_code}</small>
                  </label>
                  <input
                    id={`bs-production-${field.id}`}
                    type="number"
                    min="0"
                    step="any"
                    value={form.fieldValues[field.field_code] ?? ''}
                    onChange={(event) => updateFieldValue(field.field_code, event.target.value)}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bs-calculation-preview">
          <span>Opening <strong>{fmt(form.opening_stock)}</strong></span>
          <span>+ Production <strong>{fmt(productionPreview)}</strong></span>
          <span>− Dispatch <strong>{fmt(form.dispatch)}</strong></span>
          <span>+ Adjustment <strong>{signed(form.adjustment)}</strong></span>
          <span className="bs-preview-closing">
            = Closing <strong className={closingPreview < 0 ? 'value-negative' : ''}>{fmt(closingPreview)}</strong>
          </span>
          {negativeClosingBlocked && (
            <AlertMessage
              tone="warning"
              message="Negative closing stock is disabled in Book Stock settings; this entry cannot be saved as it stands."
            />
          )}
        </div>

        <div className="bs-form-wide">
          <label htmlFor="bs-entry-remarks">Remarks</label>
          <textarea id="bs-entry-remarks" rows={2} value={form.remarks} onChange={(event) => setField('remarks', event.target.value)} />
        </div>
      </FormDialog>
    </div>
  )
}

export default BookStockDailyEntry
