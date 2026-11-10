import { useCallback, useEffect, useMemo, useState } from 'react'
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
import DataTableToolbar from '../../components/common/DataTableToolbar'
import PaginationControls, {
  paginateRows,
  usePageSize,
} from '../../components/common/PaginationControls'
import { useConfirm } from '../../components/common/ConfirmProvider'
import { useDataFilters } from '../../hooks/useDataFilters'
import {
  blocksForEntity,
  fieldsForBlock,
  roundQty,
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

const COLUMNS = [
  { key: 'entry_date', label: 'Stock Date', type: 'date' },
  { key: 'entity_name', label: 'Entity', type: 'select' },
  { key: 'block_name', label: 'Block', type: 'select' },
  { key: 'product_name', label: 'Product', type: 'select' },
  { key: 'opening_stock', label: 'Block Opening', type: 'number' },
  { key: 'production', label: 'Production', type: 'number' },
  { key: 'dispatch', label: 'Dispatch', type: 'number' },
  { key: 'adjustment', label: 'Adjustment', type: 'number' },
  { key: 'closing_stock', label: 'Block Closing', type: 'number' },
  { key: 'remarks', label: 'Remarks' },
]
const empty = () => ({
  entry_date: todayIso(),
  entity_code: '',
  block_code: '',
  product_code: '',
  remarks: '',
  stocks: {},
})

export default function BookStockDailyEntry({ loggedInUser }) {
  const reference = useBookStockReferenceData()
  const {
    products,
    active_products: activeProducts,
    fields,
    sub_fields: subFields,
    entities,
    blocks,
    entity_blocks: entityBlocks,
    settings,
  } = reference.data
  const { canCreate, canEdit, canDelete } = useBookStockPermissions(
    loggedInUser,
    'Book Stock Entry',
  )
  const [searchParams] = useSearchParams()
  const [filters, setFilters] = useState(BOOK_STOCK_EMPTY_FILTERS)
  const [applied, setApplied] = useState(BOOK_STOCK_EMPTY_FILTERS)
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [page, setPage] = useState(1)
  const pageSize = usePageSize()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(empty)
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [suggestions, setSuggestions] = useState({})
  const [suggestionsLoading, setSuggestionsLoading] = useState(false)
  const [suggestionsFailed, setSuggestionsFailed] = useState(false)
  const confirm = useConfirm()

  const load = useCallback(
    async (filter = applied) => {
      setLoading(true)
      setError('')
      try {
        const data = await getBookStockDailyEntries({ ...filter, limit: 20000 })
        setEntries(data.items || [])
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    },
    [applied],
  )
  useEffect(() => {
    const next = {
      ...BOOK_STOCK_EMPTY_FILTERS,
      entity_code: searchParams.get('entity') || '',
      block_code: searchParams.get('block') || '',
    }
    // Synchronize the form with deep-link query parameters.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFilters(next)
    setApplied(next)
    load(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  const available = useMemo(
    () =>
      form.entity_code && form.block_code && form.product_code
        ? fieldsForBlock(fields, {
            entityCode: form.entity_code,
            blockCode: form.block_code,
            productCode: form.product_code,
          })
        : [],
    [fields, form.entity_code, form.block_code, form.product_code],
  )
  const formBlocks = useMemo(
    () => blocksForEntity(blocks, entityBlocks, form.entity_code),
    [blocks, entityBlocks, form.entity_code],
  )
  const sources = (field) => {
    const active = subFields.filter((s) => s.field_id === field.id)
    const old =
      editing?.field_stocks?.find((s) => s.field_id === field.id)
        ?.sub_field_productions || []
    return [
      ...active,
      ...old
        .filter((s) => !active.some((a) => a.id === s.sub_field_id))
        .map((s) => ({ ...s, id: s.sub_field_id, status: 'Inactive' })),
    ]
  }
  useEffect(() => {
    if (
      !open ||
      !form.entry_date ||
      !form.entity_code ||
      !form.block_code ||
      !form.product_code ||
      !available.length
    ) {
      // A changed selection cancels any pending opening lookup.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSuggestionsLoading(false)
      return undefined
    }
    let cancelled = false
    setSuggestionsLoading(true)
    setSuggestionsFailed(false)
    setSuggestions({})
    Promise.all(
      available.map(async (field) => {
        const suggestion = await getBookStockOpeningSuggestion({
          field_id: field.id,
          entity_code: form.entity_code,
          block_code: form.block_code,
          product_code: form.product_code,
          entry_date: form.entry_date,
        })
        return [field.id, suggestion]
      }),
    )
      .then((data) => {
        if (!cancelled) setSuggestions(Object.fromEntries(data))
      })
      .catch((err) => {
        if (!cancelled) {
          setSuggestionsFailed(true)
          setFormError(
            `Could not load field opening suggestions: ${err.message}`,
          )
        }
      })
      .finally(() => {
        if (!cancelled) setSuggestionsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [
    open,
    form.entry_date,
    form.entity_code,
    form.block_code,
    form.product_code,
    available,
  ])
  const set = (key, value) => {
    setForm((f) => ({ ...f, [key]: value }))
    setFormError('')
  }
  const setStock = (id, patch) =>
    setForm((f) => ({
      ...f,
      stocks: { ...f.stocks, [id]: { ...(f.stocks[id] || {}), ...patch } },
    }))
  const setProduction = (fieldId, subId, value) =>
    setForm((f) => ({
      ...f,
      stocks: {
        ...f.stocks,
        [fieldId]: {
          ...(f.stocks[fieldId] || {}),
          production: {
            ...(f.stocks[fieldId]?.production || {}),
            [subId]: value,
          },
        },
      },
    }))
  const stockValues = (field) => {
    const stock = form.stocks[field.id] || {}
    const carried =
      stock.carry_opening ??
      (!suggestions[field.id]?.legacy_block_previous &&
        String(settings?.auto_carry_opening || 'Yes').toLowerCase() === 'yes')
    const opening = carried
      ? (suggestions[field.id]?.opening_stock ?? stock.opening_stock ?? 0)
      : stock.opening_stock || 0
    const production = roundQty(
      sources(field).reduce(
        (sum, sub) => sum + roundQty(stock.production?.[sub.id] || 0),
        0,
      ),
    )
    const closing = roundQty(
      roundQty(opening) +
        production -
        roundQty(stock.dispatch || 0) +
        roundQty(stock.adjustment || 0),
    )
    return { stock, carried, opening, production, closing }
  }
  const openCreate = () => {
    setEditing(null)
    setForm({
      ...empty(),
      entity_code: entities[0]?.entity_code || '',
      product_code: activeProducts[0]?.product_code || '',
    })
    setSuggestions({})
    setFormError('')
    setOpen(true)
  }
  const openEdit = (entry) => {
    const stocks = Object.fromEntries(
      (entry.field_stocks || []).map((s) => [
        s.field_id,
        {
          opening_stock: String(s.opening_stock),
          carry_opening: s.opening_carried === 'Yes',
          dispatch: String(s.dispatch),
          adjustment: String(s.adjustment),
          production: Object.fromEntries(
            s.sub_field_productions.map((p) => [
              p.sub_field_id,
              String(p.production_qty),
            ]),
          ),
        },
      ]),
    )
    setEditing(entry)
    setForm({
      entry_date: entry.entry_date,
      entity_code: entry.entity_code,
      block_code: entry.block_code,
      product_code: entry.product_code,
      remarks: entry.remarks || '',
      stocks,
    })
    setSuggestions({})
    setFormError('')
    setOpen(true)
  }
  const save = async () => {
    if (
      !form.entry_date ||
      !form.entity_code ||
      !form.block_code ||
      !form.product_code ||
      !available.length
    ) {
      setFormError(
        'Choose a date, entity, block and product with configured main fields.',
      )
      return
    }
    if (suggestionsLoading) {
      setFormError('Wait for field opening suggestions to load.')
      return
    }
    if (suggestionsFailed && available.some((f) => stockValues(f).carried)) {
      setFormError(
        'Opening suggestions could not be loaded. Reopen the form or enter manual openings.',
      )
      return
    }
    if (
      available.some(
        (f) =>
          !stockValues(f).carried &&
          (stockValues(f).stock.opening_stock === '' ||
            stockValues(f).stock.opening_stock == null),
      )
    ) {
      setFormError('Enter a manual opening stock for each main field.')
      return
    }
    if (available.some((f) => !sources(f).length)) {
      setFormError(
        'Configure at least one active sub-field for every main field.',
      )
      return
    }
    const field_stocks = available.map((f) => {
      const v = stockValues(f)
      return {
        field_id: f.id,
        opening_stock: v.carried ? null : Number(v.stock.opening_stock || 0),
        carry_opening: v.carried,
        dispatch: Number(v.stock.dispatch || 0),
        adjustment: Number(v.stock.adjustment || 0),
        sub_field_productions: sources(f).map((s) => ({
          sub_field_id: s.id,
          production_qty: Number(v.stock.production?.[s.id] || 0),
        })),
      }
    })
    const payload = {
      entry_date: form.entry_date,
      entity_code: form.entity_code,
      block_code: form.block_code,
      product_code: form.product_code,
      remarks: form.remarks || null,
      field_stocks,
    }
    setSaving(true)
    setFormError('')
    try {
      if (editing) await updateBookStockDailyEntry(editing.id, payload)
      else await createBookStockDailyEntry(payload)
      setOpen(false)
      setSuccess('Book stock entry saved.')
      await load()
    } catch (err) {
      setFormError(err.message || 'Save failed.')
    } finally {
      setSaving(false)
    }
  }
  const remove = async (entry) => {
    if (
      !(await confirm({
        title: 'Permanently delete entry',
        message: `Delete ${entry.entry_date} / ${entry.block_code} / ${entry.product_code}? Later carried field openings will be recalculated.`,
        tone: 'danger',
        confirmLabel: 'Delete',
        module: BOOK_STOCK_MODULE,
      }))
    )
      return
    try {
      await deleteBookStockDailyEntry(entry.id)
      setSuccess('Entry deleted.')
      await load()
    } catch (err) {
      setError(err.message)
    }
  }
  const filtered = useDataFilters(entries, COLUMNS, {
    module: BOOK_STOCK_MODULE,
  })
  const rows = paginateRows(filtered.filteredRows, page, pageSize)
  const sampleEntity = entities[0]?.entity_code || ''
  const sampleBlock =
    blocksForEntity(blocks, entityBlocks, sampleEntity)[0]?.block_code || ''
  const sampleProduct = activeProducts[0]?.product_code || ''
  const sampleFields = fieldsForBlock(fields, {
    entityCode: sampleEntity,
    blockCode: sampleBlock,
    productCode: sampleProduct,
  })
  const example = JSON.stringify(
    sampleFields.map((f) => ({
      field_id: f.id,
      opening_stock: 1000,
      dispatch: 100,
      adjustment: 0,
      sub_field_productions: subFields
        .filter((s) => s.field_id === f.id)
        .map((s) => ({ sub_field_id: s.id, production_qty: 0 })),
    })),
  )
  const importConfig = {
    templateKey: 'book-stock-field-daily-entries',
    title: 'Bulk upload Book Data entries',
    description:
      'One row per date, entity, block and product. Field Stocks is a JSON array with every main field and each sub-field ID. Find IDs in the Main Fields / Sub-Fields screen. Opening may be null for auto-carry.',
    fields: [
      {
        key: 'entry_date',
        label: 'Stock Date (YYYY-MM-DD)',
        required: true,
        example: todayIso(),
      },
      {
        key: 'entity_code',
        label: 'Entity Code',
        required: true,
        example: sampleEntity || 'ENT1',
      },
      {
        key: 'block_code',
        label: 'Block Code',
        required: true,
        example: sampleBlock || 'B1',
      },
      {
        key: 'product_code',
        label: 'Product Code',
        required: true,
        example: sampleProduct || 'OIL',
      },
      {
        key: 'field_stocks',
        label: 'Field Stocks JSON',
        required: true,
        example,
      },
      { key: 'remarks', label: 'Remarks', example: '' },
    ],
    validateRow: (record) => {
      try {
        if (!Array.isArray(JSON.parse(record.field_stocks)))
          return 'Field Stocks must be a JSON array.'
      } catch {
        return 'Field Stocks must be valid JSON.'
      }
      return null
    },
    onImportBatch: async (rows) => {
      const result = await bulkUploadBookStockEntries(
        rows.map(({ record }) => ({
          ...record,
          field_stocks: JSON.parse(record.field_stocks),
        })),
      )
      return rows.map(({ rowNumber }, i) => ({
        rowNumber,
        status:
          result.results?.[i]?.status === 'imported' ? 'success' : 'failed',
        message: result.results?.[i]?.message || 'No result returned.',
      }))
    },
    onComplete: async () => {
      await load()
    },
  }
  return (
    <div className="book-stock-page">
      <PageHeader
        title="Book Stock Daily Entry"
        description="Stock is entered per main field and production per sub-field. Block totals are calculated from main fields."
        count={`${entries.length} Entries`}
        actions={
          canCreate && (
            <button type="button" className="btn-primary" onClick={openCreate}>
              New Entry
            </button>
          )
        }
      />
      <AlertMessage
        tone="success"
        message={success}
        onDismiss={() => setSuccess('')}
      />
      <AlertMessage
        tone="error"
        message={error || reference.error}
        onDismiss={() => setError('')}
      />
      <BookStockFilterPanel
        filters={filters}
        setFilters={setFilters}
        entities={entities}
        blocks={blocks}
        entityBlocks={entityBlocks}
        products={products}
        loading={loading}
        onApply={() => {
          setApplied(filters)
          setPage(1)
          load(filters)
        }}
        onClear={() => {
          setFilters(BOOK_STOCK_EMPTY_FILTERS)
          setApplied(BOOK_STOCK_EMPTY_FILTERS)
          setPage(1)
          load(BOOK_STOCK_EMPTY_FILTERS)
        }}
      />
      <DataTableToolbar
        filters={filtered}
        columns={COLUMNS}
        exportFileName="book-stock-daily-entries"
        exportTitle="Book Stock Daily Entries"
        module={BOOK_STOCK_MODULE}
        importConfig={importConfig}
        canImport={canCreate}
        canExport
        searchPlaceholder="Search entries…"
      />
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Entity</th>
              <th>Block</th>
              <th>Product</th>
              <th>Opening</th>
              <th>Production</th>
              <th>Dispatch</th>
              <th>Adjustment</th>
              <th>Closing</th>
              <th>Field details</th>
              <th>Remarks</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {!rows.length ? (
              <tr>
                <td colSpan={12}>No entries found.</td>
              </tr>
            ) : (
              rows.map((entry) => (
                <tr key={entry.id}>
                  <td>{entry.entry_date}</td>
                  <td>{entry.entity_name || entry.entity_code}</td>
                  <td>{entry.block_name || entry.block_code}</td>
                  <td>
                    {entry.product_name || entry.product_code} {entry.unit}
                  </td>
                  <td>{fmt(entry.opening_stock)}</td>
                  <td>{fmt(entry.production)}</td>
                  <td>{fmt(entry.dispatch)}</td>
                  <td>{signed(entry.adjustment)}</td>
                  <td>{fmt(entry.closing_stock)}</td>
                  <td>
                    {entry.legacy_block_entry ? (
                      <details>
                        <summary>Historical block-level entry</summary>
                        {entry.field_productions?.map((f) => (
                          <div key={f.id}>
                            {f.field_name} / Historical production:{' '}
                            {fmt(f.production_qty)}
                          </div>
                        ))}
                      </details>
                    ) : (
                      <details>
                        <summary>
                          {entry.field_stocks?.length} main fields
                        </summary>
                        {entry.field_stocks?.map((f) => (
                          <div key={f.field_id}>
                            <strong>{f.field_name}</strong>: Opening{' '}
                            {fmt(f.opening_stock)} · Production{' '}
                            {fmt(f.production)} · Dispatch {fmt(f.dispatch)} ·
                            Adjustment {signed(f.adjustment)} · Closing{' '}
                            {fmt(f.closing_stock)}
                            <div>
                              {f.sub_field_productions
                                .map(
                                  (s) =>
                                    `${s.sub_field_name}: ${fmt(s.production_qty)}`,
                                )
                                .join(' · ')}
                            </div>
                          </div>
                        ))}
                      </details>
                    )}
                  </td>
                  <td>{entry.remarks || '—'}</td>
                  <td className="row-actions">
                    {canEdit && !entry.legacy_block_entry && (
                      <button type="button" onClick={() => openEdit(entry)}>
                        Edit
                      </button>
                    )}
                    {canDelete && (
                      <button type="button" onClick={() => remove(entry)}>
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <PaginationControls
        currentPage={page}
        totalRows={filtered.filteredRows.length}
        onPageChange={setPage}
      />
      <FormDialog
        open={open}
        title={editing ? 'Edit Book Stock Entry' : 'New Book Stock Entry'}
        description="Enter each main field's stock and its sub-fields' production. Block totals are calculated automatically."
        size="xl"
        columns={3}
        submitLabel="Save Entry"
        busy={saving}
        error={formError}
        onDismissError={() => setFormError('')}
        onSubmit={save}
        onCancel={() => setOpen(false)}
      >
        <div>
          <label htmlFor="entry-date">Stock Date *</label>
          <input
            id="entry-date"
            type="date"
            value={form.entry_date}
            disabled={!!editing}
            onChange={(e) => set('entry_date', e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="entry-entity">Entity *</label>
          <select
            id="entry-entity"
            value={form.entity_code}
            disabled={!!editing}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                entity_code: e.target.value,
                block_code: '',
                stocks: {},
              }))
            }
          >
            <option value="">Select entity</option>
            {entityOptions(entities)}
          </select>
        </div>
        <div>
          <label htmlFor="entry-block">Block *</label>
          <select
            id="entry-block"
            value={form.block_code}
            disabled={!!editing || !form.entity_code}
            onChange={(e) =>
              setForm((f) => ({ ...f, block_code: e.target.value, stocks: {} }))
            }
          >
            <option value="">Select block</option>
            {blockOptions(formBlocks)}
          </select>
        </div>
        <div>
          <label htmlFor="entry-product">Product *</label>
          <select
            id="entry-product"
            value={form.product_code}
            disabled={!!editing}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                product_code: e.target.value,
                stocks: {},
              }))
            }
          >
            <option value="">Select product</option>
            {productOptions(activeProducts)}
          </select>
        </div>
        <div className="bs-form-wide">
          <label htmlFor="entry-remarks">Remarks</label>
          <textarea
            id="entry-remarks"
            value={form.remarks}
            onChange={(e) => set('remarks', e.target.value)}
          />
        </div>
        <div className="bs-field-production">
          <h4>Main Fields and Sub-Field Production</h4>
          {!available.length && (
            <div className="info-box">
              Select an entity, block and product with configured main fields.
            </div>
          )}
          {available.map((field) => {
            const v = stockValues(field)
            return (
              <section key={field.id} className="bs-field-production">
                <h4>
                  {field.field_name} ({field.field_code})
                </h4>
                <div className="bs-field-grid">
                  <div>
                    <label htmlFor={`opening-${field.id}`}>Opening Stock</label>
                    <input
                      id={`opening-${field.id}`}
                      type="number"
                      step="any"
                      value={
                        v.carried ? v.opening : (v.stock.opening_stock ?? '')
                      }
                      disabled={v.carried}
                      onChange={(e) =>
                        setStock(field.id, { opening_stock: e.target.value })
                      }
                    />
                    <label>
                      <input
                        type="checkbox"
                        checked={v.carried}
                        disabled={
                          String(
                            settings?.auto_carry_opening || 'Yes',
                          ).toLowerCase() !== 'yes' && !v.carried
                        }
                        onChange={(e) =>
                          setStock(field.id, {
                            carry_opening: e.target.checked,
                            opening_stock: String(v.opening),
                          })
                        }
                      />{' '}
                      Auto-carry previous closing
                    </label>
                    <span className="field-hint">
                      {suggestions[field.id]?.legacy_block_previous
                        ? 'Historical stock exists only at block level. Enter this main field’s opening manually.'
                        : suggestions[field.id]?.previous_entry_date
                          ? `Previous closing ${fmt(suggestions[field.id].previous_closing_stock)} on ${suggestions[field.id].previous_entry_date}`
                          : 'No previous field balance'}
                    </span>
                  </div>
                  <div>
                    <label htmlFor={`dispatch-${field.id}`}>Dispatch</label>
                    <input
                      id={`dispatch-${field.id}`}
                      type="number"
                      min="0"
                      step="any"
                      value={v.stock.dispatch ?? ''}
                      onChange={(e) =>
                        setStock(field.id, { dispatch: e.target.value })
                      }
                    />
                  </div>
                  <div>
                    <label htmlFor={`adjust-${field.id}`}>
                      Adjustment (+ / −)
                    </label>
                    <input
                      id={`adjust-${field.id}`}
                      type="number"
                      step="any"
                      value={v.stock.adjustment ?? ''}
                      onChange={(e) =>
                        setStock(field.id, { adjustment: e.target.value })
                      }
                    />
                  </div>
                </div>
                <h5>Sub-field production</h5>
                <div className="bs-field-grid">
                  {sources(field).length ? (
                    sources(field).map((sub) => (
                      <div key={sub.id}>
                        <label htmlFor={`production-${field.id}-${sub.id}`}>
                          {sub.sub_field_name} ({sub.sub_field_code}){' '}
                          {sub.status === 'Inactive' ? '— inactive' : ''}
                        </label>
                        <input
                          id={`production-${field.id}-${sub.id}`}
                          type="number"
                          min="0"
                          step="any"
                          value={v.stock.production?.[sub.id] ?? ''}
                          onChange={(e) =>
                            setProduction(field.id, sub.id, e.target.value)
                          }
                        />
                      </div>
                    ))
                  ) : (
                    <div className="info-box">
                      Configure a sub-field before entering stock.
                    </div>
                  )}
                </div>
                <div className="bs-calculation-preview">
                  Production <strong>{fmt(v.production)}</strong> · Closing{' '}
                  <strong>{fmt(v.closing)}</strong>
                </div>
              </section>
            )
          })}
          {available.length > 0 && (
            <div className="bs-calculation-preview">
              Block totals: Opening{' '}
              {fmt(
                available.reduce(
                  (n, f) => n + Number(stockValues(f).opening),
                  0,
                ),
              )}{' '}
              · Production{' '}
              {fmt(
                available.reduce((n, f) => n + stockValues(f).production, 0),
              )}{' '}
              · Dispatch{' '}
              {fmt(
                available.reduce(
                  (n, f) => n + Number(stockValues(f).stock.dispatch || 0),
                  0,
                ),
              )}{' '}
              · Adjustment{' '}
              {signed(
                available.reduce(
                  (n, f) => n + Number(stockValues(f).stock.adjustment || 0),
                  0,
                ),
              )}{' '}
              · Closing{' '}
              {fmt(available.reduce((n, f) => n + stockValues(f).closing, 0))}
            </div>
          )}
        </div>
      </FormDialog>
    </div>
  )
}
