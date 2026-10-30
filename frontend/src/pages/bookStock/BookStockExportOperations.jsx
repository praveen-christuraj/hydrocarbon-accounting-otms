import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { getBookStockExportOperations } from '../../api/bookStockApi'
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
import { usePermissions } from '../../hooks/usePermissions'
import { BOOK_STOCK_MODULE } from './bookStockShared'

const COLUMNS = [
  { key: 'entity_name', label: 'Entity', type: 'select' },
  { key: 'locations_label', label: 'Locations', type: 'select' },
  { key: 'block_count', label: 'Blocks', type: 'number' },
  { key: 'field_count', label: 'Producing Fields', type: 'number' },
  { key: 'stock_entry_count', label: 'Stock Entries', type: 'number' },
  { key: 'latest_entry_date', label: 'Latest Stock Date', type: 'date' },
]

function BookStockExportOperations({ loggedInUser }) {
  const { hasPermission } = usePermissions(loggedInUser)
  const canOpenEntries = hasPermission('View Book Stock Entry')
  const canOpenExportTransactions = hasPermission('View Export Transaction')
  const profile = useCompanyPrintProfile()
  const { requestPrint } = usePrintDialog()
  const [data, setData] = useState({ entities: [], total: 0 })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState('')
  const [page, setPage] = useState(1)
  const pageSize = usePageSize()

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const payload = await getBookStockExportOperations()
      setData({ entities: Array.isArray(payload?.entities) ? payload.entities : [], total: payload?.total || 0 })
    } catch (err) {
      setError(err.message || 'Unable to load Export Operations configuration.')
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
      (data.entities || []).map((entity) => ({
        ...entity,
        entity_label: entity.entity_name || entity.entity_code,
        locations_label: (entity.location_names || []).join(', ') || '—',
      })),
    [data]
  )
  const filtersState = useDataFilters(rows, COLUMNS, { module: `${BOOK_STOCK_MODULE} — Export Operations` })
  const visibleRows = paginateRows(filtersState.filteredRows, page, pageSize)

  const handlePrint = () => {
    requestPrint({
      module: BOOK_STOCK_MODULE,
      reportName: 'Book Stock Export Operations',
      onBeforePrint: () => logUiAction(BOOK_STOCK_MODULE, 'Print Book Stock Export Operations'),
    })
  }

  return (
    <div className="book-stock-page">
      <PageHeader
        title="Export Operations"
        description="Entity, block and location criteria shared with Export Operations. Book Stock consumes these configurations as its scope and never duplicates or overrides them."
        count={`${data.total} Entities`}
        actions={
          <>
            {canOpenExportTransactions && (
              <Link className="button-link" to="/export-operations/transactions">
                Open Export Transactions
              </Link>
            )}
            <button type="button" className="btn-secondary" onClick={handlePrint}>
              <Icon name="print" size={15} />
              Print
            </button>
          </>
        }
      />

      <div className="print-only">
        <CompanyPrintHeader profile={profile} defaultSubtitle="Book Stock — Export Operations Criteria" />
      </div>

      <AlertMessage tone="error" message={error} onDismiss={() => setError('')} />
      <div className="info-box">
        Entity → Block → Field is the Book Stock hierarchy. An entity and block become available for stock entry once Export
        Operations has created and mapped them and a field has been registered against that block on the Book Stock Fields page.
      </div>

      <DataTableToolbar
        filters={filtersState}
        columns={COLUMNS}
        exportFileName="book-stock-export-operations"
        exportTitle="Book Stock — Export Operations Criteria"
        module={BOOK_STOCK_MODULE}
        searchPlaceholder="Search entity, location…"
      />

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th />
              <th>Entity</th>
              <th>Locations</th>
              <th className="numeric">Blocks</th>
              <th className="numeric">Producing Fields</th>
              <th className="numeric">Stock Entries</th>
              <th>Latest Stock Date</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 ? (
              <tr>
                <td colSpan={7} className="empty-table">
                  {loading ? 'Loading…' : 'No active Export Operations entities are visible to your scope.'}
                </td>
              </tr>
            ) : (
              visibleRows.map((entity) => {
                const isOpen = expanded === entity.entity_code
                return (
                  <Fragment key={entity.entity_code}>
                    <tr>
                      <td>
                        <button
                          type="button"
                          className="icon-button"
                          aria-expanded={isOpen}
                          aria-label={`${isOpen ? 'Hide' : 'Show'} blocks for ${entity.entity_name}`}
                          onClick={() => setExpanded(isOpen ? '' : entity.entity_code)}
                        >
                          <Icon name={isOpen ? 'chevronDown' : 'chevronRight'} size={15} />
                        </button>
                      </td>
                      <td>{entity.entity_name || entity.entity_code}</td>
                      <td className="cell-wrap">{entity.locations_label}</td>
                      <td className="numeric">{entity.block_count}</td>
                      <td className="numeric">{entity.field_count}</td>
                      <td className="numeric">{entity.stock_entry_count}</td>
                      <td>{entity.latest_entry_date || '—'}</td>
                    </tr>
                    {isOpen && (
                      <tr className="bs-expanded-row">
                        <td colSpan={7}>
                          <div className="bs-block-detail">
                            <h4>Blocks of {entity.entity_name}</h4>
                            {(entity.blocks || []).length === 0 ? (
                              <p className="muted-table-text">No active blocks are mapped to this entity.</p>
                            ) : (
                              <table>
                                <thead>
                                  <tr>
                                    <th>Block Code</th>
                                    <th>Block Name</th>
                                    <th className="numeric">Producing Fields</th>
                                    <th className="numeric">Stock Entries</th>
                                    <th>Latest Stock Date</th>
                                    <th>Stock Entry</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {entity.blocks.map((block) => (
                                    <tr key={block.block_code}>
                                      <td>{block.block_code}</td>
                                      <td>{block.block_name}</td>
                                      <td className="numeric">{block.field_count}</td>
                                      <td className="numeric">{block.stock_entry_count}</td>
                                      <td>{block.latest_entry_date || '—'}</td>
                                      <td>
                                        {canOpenEntries ? (
                                          <Link
                                            className="button-link"
                                            to={`/book-stock/daily-entries?entity=${encodeURIComponent(entity.entity_code)}&block=${encodeURIComponent(block.block_code)}`}
                                          >
                                            Open entries
                                          </Link>
                                        ) : (
                                          '—'
                                        )}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })
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

export default BookStockExportOperations
