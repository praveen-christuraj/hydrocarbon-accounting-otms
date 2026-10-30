import { useCallback, useEffect, useState } from 'react'
import { getBookStockReferenceData } from '../../api/bookStockApi'
import { usePermissions } from '../../hooks/usePermissions'
import { blocksForEntity } from '../../utils/bookStockUtils'

export const BOOK_STOCK_MODULE = 'Book Stock Management'

export const BOOK_STOCK_EMPTY_FILTERS = {
  entity_code: '',
  block_code: '',
  product_code: '',
  date_from: '',
  date_to: '',
}

export const fmt = (value, digits = 2) => {
  const number = Number(value || 0)
  return number.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

export const signed = (value, digits = 2) => {
  const number = Number(value || 0)
  if (number > 0) return `+${fmt(number, digits)}`
  return fmt(number, digits)
}

export const todayIso = () => {
  const now = new Date()
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset())
  return now.toISOString().slice(0, 10)
}

export const entityOptions = (entities = []) =>
  [...entities]
    .sort((a, b) => String(a.entity_name || '').localeCompare(String(b.entity_name || '')))
    .map((entity) => (
      <option key={entity.entity_code} value={entity.entity_code}>
        {entity.entity_name} ({entity.entity_code})
      </option>
    ))

export const blockOptions = (blocks = []) =>
  [...blocks]
    .sort((a, b) => String(a.block_name || '').localeCompare(String(b.block_name || '')))
    .map((block) => (
      <option key={block.block_code} value={block.block_code}>
        {block.block_name} ({block.block_code})
      </option>
    ))

export const productOptions = (products = []) =>
  [...products]
    .sort((a, b) => Number(a.display_order || 0) - Number(b.display_order || 0))
    .map((product) => (
      <option key={product.product_code} value={product.product_code}>
        {product.product_name} ({product.product_code}){product.unit ? ` · ${product.unit}` : ''}
      </option>
    ))

/** CRUD flags for one Book Stock entity, e.g. 'Book Stock Entry'. */
export function useBookStockPermissions(loggedInUser, entity = 'Book Stock Entry') {
  const { hasPermission } = usePermissions(loggedInUser)
  return {
    canView: hasPermission(`View ${entity}`),
    canCreate: hasPermission(`Create ${entity}`),
    canEdit: hasPermission(`Edit ${entity}`),
    canDelete: hasPermission(`Delete ${entity}`),
  }
}

/**
 * Shared reference data: the module's products, fields, settings and the
 * Export Operations entities / blocks the module reads. Everything is already
 * restricted to the caller's entity scope by the API.
 */
export function useBookStockReferenceData() {
  const [data, setData] = useState({
    products: [],
    active_products: [],
    fields: [],
    entities: [],
    blocks: [],
    entity_blocks: [],
    locations: [],
    settings: {},
    settings_list: [],
    product_limit: 2,
    active_product_count: 0,
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const reload = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const payload = await getBookStockReferenceData()
      const source = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}
      setData({
        products: Array.isArray(source.products) ? source.products : [],
        active_products: Array.isArray(source.active_products) ? source.active_products : [],
        fields: Array.isArray(source.fields) ? source.fields : [],
        entities: Array.isArray(source.entities) ? source.entities : [],
        blocks: Array.isArray(source.blocks) ? source.blocks : [],
        entity_blocks: Array.isArray(source.entity_blocks) ? source.entity_blocks : [],
        locations: Array.isArray(source.locations) ? source.locations : [],
        settings: source.settings || {},
        settings_list: Array.isArray(source.settings_list) ? source.settings_list : [],
        product_limit: Number(source.product_limit || 2),
        active_product_count: Number(source.active_product_count || 0),
      })
    } catch (err) {
      setError(err.message || 'Unable to load Book Stock reference data.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    getBookStockReferenceData()
      .then((payload) => {
        if (!cancelled) {
          const source = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}
          setData((current) => ({
            ...current,
            products: Array.isArray(source.products) ? source.products : [],
            active_products: Array.isArray(source.active_products) ? source.active_products : [],
            fields: Array.isArray(source.fields) ? source.fields : [],
            entities: Array.isArray(source.entities) ? source.entities : [],
            blocks: Array.isArray(source.blocks) ? source.blocks : [],
            entity_blocks: Array.isArray(source.entity_blocks) ? source.entity_blocks : [],
            locations: Array.isArray(source.locations) ? source.locations : [],
            settings: source.settings || {},
            settings_list: Array.isArray(source.settings_list) ? source.settings_list : [],
            product_limit: Number(source.product_limit || 2),
            active_product_count: Number(source.active_product_count || 0),
          }))
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Unable to load Book Stock reference data.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return { data, loading, error, reload }
}

/** Entity / block / product / date-range panel shared by entries and summaries. */
export function BookStockFilterPanel({
  filters,
  setFilters,
  entities = [],
  blocks = [],
  entityBlocks = [],
  products = [],
  onApply,
  onClear,
  loading = false,
  showProducts = true,
  idPrefix = 'bs',
}) {
  const update = (key, value) => setFilters((current) => ({ ...current, [key]: value }))
  const updateEntity = (value) =>
    setFilters((current) => ({ ...current, entity_code: value, block_code: '' }))
  const visibleBlocks = blocksForEntity(blocks, entityBlocks, filters.entity_code)
  return (
    <div className="report-filter-panel compact-filter-panel no-print">
      <div>
        <label htmlFor={`${idPrefix}-entity`}>Entity</label>
        <select id={`${idPrefix}-entity`} value={filters.entity_code} onChange={(event) => updateEntity(event.target.value)} disabled={loading}>
          <option value="">All entities</option>
          {entityOptions(entities)}
        </select>
      </div>
      <div>
        <label htmlFor={`${idPrefix}-block`}>Block</label>
        <select id={`${idPrefix}-block`} value={filters.block_code} onChange={(event) => update('block_code', event.target.value)} disabled={loading}>
          <option value="">All blocks</option>
          {blockOptions(visibleBlocks)}
        </select>
      </div>
      {showProducts && (
        <div>
          <label htmlFor={`${idPrefix}-product`}>Product</label>
          <select id={`${idPrefix}-product`} value={filters.product_code} onChange={(event) => update('product_code', event.target.value)} disabled={loading}>
            <option value="">All products (kept separate)</option>
            {productOptions(products)}
          </select>
        </div>
      )}
      <div>
        <label htmlFor={`${idPrefix}-from`}>Date from</label>
        <input id={`${idPrefix}-from`} type="date" value={filters.date_from} onChange={(event) => update('date_from', event.target.value)} disabled={loading} />
      </div>
      <div>
        <label htmlFor={`${idPrefix}-to`}>Date to</label>
        <input id={`${idPrefix}-to`} type="date" value={filters.date_to} onChange={(event) => update('date_to', event.target.value)} disabled={loading} />
      </div>
      <div className="filter-panel-actions">
        <button type="button" className="btn-primary" onClick={onApply} disabled={loading}>
          {loading ? 'Loading…' : 'Apply'}
        </button>
        <button type="button" className="btn-secondary" onClick={onClear} disabled={loading}>
          Clear
        </button>
      </div>
    </div>
  )
}

/** KPI card set: one card per product, never a combined product total. */
export function ProductKpiCards({ totals = [], products = [], metric = 'closing_stock' }) {
  const productByCode = new Map((products || []).map((product) => [String(product.product_code).toLowerCase(), product]))
  if (!totals.length) {
    return <div className="info-box">No stock values for the selected filters.</div>
  }
  return (
    <div className="kpi-grid">
      {totals.map((total) => {
        const product = productByCode.get(String(total.product_code).toLowerCase())
        return (
          <div className="kpi-card" key={total.product_code}>
            <span className="kpi-label">
              {product?.product_name || total.product_name || total.product_code}
              <small>{total.unit || product?.unit || ''}</small>
            </span>
            <strong className="kpi-value">{fmt(total[metric])}</strong>
            <span className="kpi-footnote">
              Opening {fmt(total.opening_stock)} · Production {fmt(total.production)} · Dispatch {fmt(total.dispatch)} · Adjustment {signed(total.adjustment)}
            </span>
            <span className="kpi-footnote">
              {total.block_count || 0} block{(total.block_count || 0) === 1 ? '' : 's'}
              {total.closing_date ? ` · closing as of ${total.closing_date}` : ''}
            </span>
          </div>
        )
      })}
    </div>
  )
}

/** Simple, theme-token bar visualisation (no chart dependency). */
export function ClosingStockBars({ rows = [], title = 'Closing stock by block' }) {
  if (!rows.length) return null
  return (
    <section className="bs-bars" aria-label={title}>
      <h3>{title}</h3>
      <div className="bs-bar-list">
        {rows.slice(0, 12).map((row) => (
          <div className="bs-bar-row" key={`${row.entity_code}-${row.block_code}-${row.product_code}`}>
            <span className="bs-bar-label">
              {row.block_name || row.block_code}
              <small>{row.entity_code} · {row.product_code}</small>
            </span>
            <span className="bs-bar-track">
              <span
                className={`bs-bar-fill ${Number(row.value) < 0 ? 'negative' : ''}`}
                style={{ width: `${row.percent}%` }}
              />
            </span>
            <span className="bs-bar-value">{fmt(row.value)}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
