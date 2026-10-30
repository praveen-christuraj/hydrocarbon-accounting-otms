import { useCallback, useEffect, useMemo, useState } from 'react'
import { getBookStockBlockSummary, getBookStockEntitySummary } from '../../api/bookStockApi'
import PageHeader from '../../components/common/PageHeader'
import AlertMessage from '../../components/common/AlertMessage'
import Icon from '../../components/common/Icon'
import DataTableToolbar from '../../components/common/DataTableToolbar'
import PaginationControls, { paginateRows, usePageSize } from '../../components/common/PaginationControls'
import CompanyPrintHeader from '../../components/reports/CompanyPrintHeader'
import CompanyPrintFooter from '../../components/reports/CompanyPrintFooter'
import { useCompanyPrintProfile } from '../../hooks/useCompanyPrintProfile'
import { usePrintDialog } from '../../components/print/printProfileContext'
import { useDataFilters } from '../../hooks/useDataFilters'
import { logUiAction } from '../../utils/actionLogger'
import { closingBars } from '../../utils/bookStockUtils'
import {
  BOOK_STOCK_EMPTY_FILTERS,
  BOOK_STOCK_MODULE,
  BookStockFilterPanel,
  ClosingStockBars,
  ProductKpiCards,
  fmt,
  signed,
  useBookStockReferenceData,
} from './bookStockShared'

const MODE_CONFIG = {
  block: {
    title: 'Block Stock Summary',
    description: 'Product-wise block closing stock. Closing = Opening + Field Production − Dispatch + Adjustment; movements are summed over the period and closing is the last day of the period.',
    loader: getBookStockBlockSummary,
    exportFileName: 'book-stock-block-summary',
    columns: [
      { key: 'entity_name', label: 'Entity', type: 'select' },
      { key: 'block_name', label: 'Block', type: 'select' },
      { key: 'product_name', label: 'Product', type: 'select' },
      { key: 'entry_count', label: 'Days', type: 'number' },
      { key: 'first_date', label: 'First Date', type: 'date' },
      { key: 'last_date', label: 'Last Date', type: 'date' },
      { key: 'opening_stock', label: 'Opening Stock', type: 'number' },
      { key: 'production', label: 'Production', type: 'number' },
      { key: 'dispatch', label: 'Dispatch', type: 'number' },
      { key: 'adjustment', label: 'Adjustment', type: 'number' },
      { key: 'closing_stock', label: 'Closing Stock', type: 'number' },
    ],
  },
  entity: {
    title: 'Entity Stock Summary',
    description: 'Entity closing stock per product and date: all blocks of the entity are added together. Products are never combined.',
    loader: getBookStockEntitySummary,
    exportFileName: 'book-stock-entity-summary',
    columns: [
      { key: 'entry_date', label: 'Stock Date', type: 'date' },
      { key: 'entity_name', label: 'Entity', type: 'select' },
      { key: 'product_name', label: 'Product', type: 'select' },
      { key: 'block_count', label: 'Blocks', type: 'number' },
      { key: 'opening_stock', label: 'Opening Stock', type: 'number' },
      { key: 'production', label: 'Production', type: 'number' },
      { key: 'dispatch', label: 'Dispatch', type: 'number' },
      { key: 'adjustment', label: 'Adjustment', type: 'number' },
      { key: 'closing_stock', label: 'Closing Stock', type: 'number' },
    ],
  },
}

function BookStockSummary({ mode = 'block' }) {
  const config = MODE_CONFIG[mode] || MODE_CONFIG.block
  const reference = useBookStockReferenceData()
  const { entities, blocks, entity_blocks: entityBlocks, products } = reference.data
  const profile = useCompanyPrintProfile()
  const { requestPrint } = usePrintDialog()

  const [filters, setFilters] = useState(BOOK_STOCK_EMPTY_FILTERS)
  const [appliedFilters, setAppliedFilters] = useState(BOOK_STOCK_EMPTY_FILTERS)
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const pageSize = usePageSize()

  const load = useCallback(async (activeFilters = appliedFilters) => {
    setLoading(true)
    setError('')
    try {
      setSummary(await config.loader(activeFilters))
    } catch (err) {
      setError(err.message || `Unable to load the ${config.title}.`)
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appliedFilters, config.loader])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load(BOOK_STOCK_EMPTY_FILTERS)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const rows = useMemo(() => {
    const items = Array.isArray(summary?.items) ? summary.items : []
    const blockTotals = Array.isArray(summary?.block_totals) ? summary.block_totals : []
    return (mode === 'block' ? blockTotals : items).map((row) => ({
      ...row,
      entity_label: row.entity_name || row.entity_code,
      block_label: row.block_name || row.block_code,
      product_label: row.product_name || row.product_code,
    }))
  }, [summary, mode])

  const filtersState = useDataFilters(rows, config.columns, { module: `${BOOK_STOCK_MODULE} — ${config.title}` })
  const visibleRows = paginateRows(filtersState.filteredRows, page, pageSize)
  const totals = Array.isArray(summary?.totals_by_product) ? summary.totals_by_product : []
  const bars = useMemo(
    () => closingBars(summary?.block_totals || [], { productCode: appliedFilters.product_code }),
    [summary, appliedFilters.product_code]
  )

  const applyFilters = () => {
    setAppliedFilters(filters)
    setPage(1)
    logUiAction(BOOK_STOCK_MODULE, `Apply ${config.title} Filters`, filters)
    load(filters)
  }
  const clearFilters = () => {
    setFilters(BOOK_STOCK_EMPTY_FILTERS)
    setAppliedFilters(BOOK_STOCK_EMPTY_FILTERS)
    setPage(1)
    load(BOOK_STOCK_EMPTY_FILTERS)
  }

  const handlePrint = () => {
    requestPrint({
      module: BOOK_STOCK_MODULE,
      reportName: config.title,
      onBeforePrint: () => logUiAction(BOOK_STOCK_MODULE, `Print ${config.title}`, appliedFilters),
    })
  }

  const showBlockColumn = mode === 'block'

  return (
    <div className="book-stock-page book-stock-summary-page">
      <PageHeader
        title={config.title}
        description={config.description}
        count={`${rows.length} Rows`}
        actions={
          <button type="button" className="btn-secondary" onClick={handlePrint}>
            <Icon name="print" size={15} />
            Print
          </button>
        }
      />

      <div className="print-only">
        <CompanyPrintHeader profile={profile} defaultSubtitle={config.title} />
      </div>

      <AlertMessage tone="error" message={error || reference.error} onDismiss={() => setError('')} />

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
        idPrefix={`bs-summary-${mode}`}
      />

      <ProductKpiCards totals={totals} products={products} />
      <ClosingStockBars rows={bars} title={mode === 'block' ? 'Closing stock by block' : 'Closing stock by block (entity roll-up)'} />

      <DataTableToolbar
        filters={filtersState}
        columns={config.columns}
        exportFileName={config.exportFileName}
        exportTitle={config.title}
        module={BOOK_STOCK_MODULE}
        exportSubtitle={[
          appliedFilters.entity_code ? `Entity ${appliedFilters.entity_code}` : '',
          appliedFilters.block_code ? `Block ${appliedFilters.block_code}` : '',
          appliedFilters.product_code ? `Product ${appliedFilters.product_code}` : 'All products (kept separate)',
          appliedFilters.date_from || appliedFilters.date_to
            ? `${appliedFilters.date_from || 'start'} to ${appliedFilters.date_to || 'latest'}`
            : '',
        ].filter(Boolean).join(' · ')}
        searchPlaceholder="Search entity, block, product…"
      />

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {config.columns.map((column) => (
                <th key={column.key} className={column.type === 'number' ? 'numeric' : undefined}>
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 ? (
              <tr>
                <td colSpan={config.columns.length} className="empty-table">
                  {loading ? 'Loading…' : 'No Book Stock values match the filters.'}
                </td>
              </tr>
            ) : (
              visibleRows.map((row) => (
                <tr key={mode === 'block'
                  ? `${row.entity_code}-${row.block_code}-${row.product_code}`
                  : `${row.entry_date}-${row.entity_code}-${row.product_code}`}>
                  {config.columns.map((column) => {
                    if (column.key === 'entity_name') return <td key={column.key}>{row.entity_name || row.entity_code}</td>
                    if (column.key === 'block_name') return <td key={column.key}>{row.block_name || row.block_code}</td>
                    if (column.key === 'product_name') return <td key={column.key}>{row.product_name || row.product_code}</td>
                    if (column.key === 'entry_date') return <td key={column.key}>{row.entry_date}</td>
                    if (column.key === 'first_date') return <td key={column.key}>{row.first_date || '—'}</td>
                    if (column.key === 'last_date') return <td key={column.key}>{row.last_date || '—'}</td>
                    if (column.key === 'entry_count') return <td key={column.key} className="numeric">{row.entry_count ?? 0}</td>
                    if (column.key === 'block_count') return <td key={column.key} className="numeric">{row.block_count ?? 0}</td>
                    if (column.key === 'adjustment') {
                      return (
                        <td key={column.key} className={`numeric ${Number(row.adjustment) < 0 ? 'value-negative' : Number(row.adjustment) > 0 ? 'value-positive' : ''}`}>
                          {signed(row.adjustment)}
                        </td>
                      )
                    }
                    if (column.key === 'closing_stock') {
                      return (
                        <td key={column.key} className={`numeric strong-cell ${Number(row.closing_stock) < 0 ? 'value-negative' : ''}`}>
                          {fmt(row.closing_stock)}
                        </td>
                      )
                    }
                    return <td key={column.key} className="numeric">{fmt(row[column.key])}</td>
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <PaginationControls currentPage={page} totalRows={filtersState.filteredRows.length} onPageChange={setPage} />

      {summary && (
        <div className="print-only">
          <CompanyPrintFooter profile={profile} />
        </div>
      )}
      {showBlockColumn && summary?.entry_count > 0 && (
        <p className="muted-table-text">
          {summary.entry_count} daily stock row{summary.entry_count === 1 ? '' : 's'} from{' '}
          {summary.date_from || '—'} to {summary.date_to || '—'}. Each product is reported separately.
        </p>
      )}
    </div>
  )
}

export default BookStockSummary
