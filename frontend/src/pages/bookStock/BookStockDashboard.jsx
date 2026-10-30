import { useCallback, useEffect, useMemo, useState } from 'react'
import { getBookStockDashboard } from '../../api/bookStockApi'
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

const COLUMNS = [
  { key: 'entity_name', label: 'Entity', type: 'select' },
  { key: 'product_name', label: 'Product', type: 'select' },
  { key: 'entry_date', label: 'Latest Stock Date', type: 'date' },
  { key: 'block_count', label: 'Blocks', type: 'number' },
  { key: 'opening_stock', label: 'Opening Stock', type: 'number' },
  { key: 'production', label: 'Production', type: 'number' },
  { key: 'dispatch', label: 'Dispatch', type: 'number' },
  { key: 'adjustment', label: 'Adjustment', type: 'number' },
  { key: 'closing_stock', label: 'Closing Stock', type: 'number' },
]

function BookStockDashboard() {
  const reference = useBookStockReferenceData()
  const { entities, blocks, entity_blocks: entityBlocks, products } = reference.data
  const profile = useCompanyPrintProfile()
  const { requestPrint } = usePrintDialog()

  const [filters, setFilters] = useState(BOOK_STOCK_EMPTY_FILTERS)
  const [appliedFilters, setAppliedFilters] = useState(BOOK_STOCK_EMPTY_FILTERS)
  const [dashboard, setDashboard] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const pageSize = usePageSize()

  const load = useCallback(async (activeFilters = appliedFilters) => {
    setLoading(true)
    setError('')
    try {
      setDashboard(await getBookStockDashboard(activeFilters))
    } catch (err) {
      setError(err.message || 'Unable to load the Book Stock dashboard.')
    } finally {
      setLoading(false)
    }
  }, [appliedFilters])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load(BOOK_STOCK_EMPTY_FILTERS)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const entityRows = useMemo(
    () =>
      (Array.isArray(dashboard?.entity_totals) ? dashboard.entity_totals : []).map((row) => ({
        ...row,
        entity_label: row.entity_name || row.entity_code,
        product_label: row.product_name || row.product_code,
      })),
    [dashboard]
  )
  const filtersState = useDataFilters(entityRows, COLUMNS, { module: `${BOOK_STOCK_MODULE} — Dashboard` })
  const visibleRows = paginateRows(filtersState.filteredRows, page, pageSize)
  const totals = Array.isArray(dashboard?.totals_by_product) ? dashboard.totals_by_product : []
  const bars = useMemo(
    () => closingBars(dashboard?.block_totals || [], { productCode: appliedFilters.product_code }),
    [dashboard, appliedFilters.product_code]
  )
  const trend = useMemo(() => {
    const rows = Array.isArray(dashboard?.daily_trend) ? dashboard.daily_trend : []
    const latestByDate = new Map()
    for (const row of rows) {
      if (!latestByDate.has(row.entry_date)) latestByDate.set(row.entry_date, [])
      latestByDate.get(row.entry_date).push(row)
    }
    return [...latestByDate.entries()].slice(-14)
  }, [dashboard])

  const applyFilters = () => {
    setAppliedFilters(filters)
    setPage(1)
    logUiAction(BOOK_STOCK_MODULE, 'Apply Dashboard Filters', filters)
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
      reportName: 'Book Stock Dashboard',
      onBeforePrint: () => logUiAction(BOOK_STOCK_MODULE, 'Print Book Stock Dashboard', appliedFilters),
    })
  }

  return (
    <div className="book-stock-page book-stock-dashboard-page">
      <PageHeader
        title="Book Stock Dashboard"
        description="Government Data stock position per product: field production, block dispatch, signed adjustments and closing stock rolled up to the entity."
        count={dashboard?.entry_count ? `${dashboard.entry_count} Stock Rows` : undefined}
        actions={
          <>
            <button type="button" className="btn-secondary" onClick={handlePrint}>
              <Icon name="print" size={15} />
              Print
            </button>
            <button type="button" className="btn-secondary" onClick={() => load(appliedFilters)} disabled={loading}>
              <Icon name="refresh" size={15} />
              {loading ? 'Loading…' : 'Refresh'}
            </button>
          </>
        }
      />

      <div className="print-only">
        <CompanyPrintHeader profile={profile} defaultSubtitle="Book Stock Dashboard" />
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
        idPrefix="bs-dashboard"
      />

      <ProductKpiCards totals={totals} products={products} />
      <ClosingStockBars rows={bars} title="Closing stock by block (latest in period)" />

      {trend.length > 0 && (
        <section className="bs-trend" aria-label="Daily closing stock trend">
          <h3>Closing stock trend by product</h3>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Product</th>
                  <th className="numeric">Production</th>
                  <th className="numeric">Dispatch</th>
                  <th className="numeric">Adjustment</th>
                  <th className="numeric">Closing</th>
                </tr>
              </thead>
              <tbody>
                {trend.flatMap(([date, rows]) =>
                  rows.map((row) => (
                    <tr key={`${date}-${row.product_code}`}>
                      <td>{date}</td>
                      <td>{row.product_name || row.product_code}</td>
                      <td className="numeric">{fmt(row.production)}</td>
                      <td className="numeric">{fmt(row.dispatch)}</td>
                      <td className="numeric">{signed(row.adjustment)}</td>
                      <td className="numeric strong-cell">{fmt(row.closing_stock)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <h3 className="bs-section-title">Entity closing stock (latest date in the period)</h3>
      <DataTableToolbar
        filters={filtersState}
        columns={COLUMNS}
        exportFileName="book-stock-dashboard"
        exportTitle="Book Stock Dashboard — Entity Closing Stock"
        module={BOOK_STOCK_MODULE}
        searchPlaceholder="Search entity, product…"
      />

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Entity</th>
              <th>Product</th>
              <th>Latest Stock Date</th>
              <th className="numeric">Blocks</th>
              <th className="numeric">Opening</th>
              <th className="numeric">Production</th>
              <th className="numeric">Dispatch</th>
              <th className="numeric">Adjustment</th>
              <th className="numeric">Closing</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 ? (
              <tr>
                <td colSpan={9} className="empty-table">
                  {loading ? 'Loading…' : 'No Book Stock values for the selected filters.'}
                </td>
              </tr>
            ) : (
              visibleRows.map((row) => (
                <tr key={`${row.entry_date}-${row.entity_code}-${row.product_code}`}>
                  <td>{row.entity_name || row.entity_code}</td>
                  <td>{row.product_name || row.product_code}</td>
                  <td>{row.entry_date}</td>
                  <td className="numeric">{row.block_count}</td>
                  <td className="numeric">{fmt(row.opening_stock)}</td>
                  <td className="numeric">{fmt(row.production)}</td>
                  <td className="numeric">{fmt(row.dispatch)}</td>
                  <td className={`numeric ${Number(row.adjustment) < 0 ? 'value-negative' : Number(row.adjustment) > 0 ? 'value-positive' : ''}`}>
                    {signed(row.adjustment)}
                  </td>
                  <td className={`numeric strong-cell ${Number(row.closing_stock) < 0 ? 'value-negative' : ''}`}>
                    {fmt(row.closing_stock)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <PaginationControls currentPage={page} totalRows={filtersState.filteredRows.length} onPageChange={setPage} />

      <div className="print-only">
        <CompanyPrintFooter profile={profile} />
      </div>
    </div>
  )
}

export default BookStockDashboard
