import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import Icon from './Icon'
import { logUiAction } from '../../utils/actionLogger'

/*
 * Pagination (owner rule 4): every list is paginated with 20 / 50 / 100 rows
 * per page. The selected page size is a global user preference persisted in
 * localStorage, so it follows the user from page to page.
 *
 * Usage in a page:
 *   const pageSize = usePageSize()
 *   const visibleRows = paginateRows(rows, page, pageSize)
 *   <PaginationControls currentPage={page} totalRows={rows.length} onPageChange={setPage} />
 */

export const PAGE_SIZE_OPTIONS = [20, 50, 100]
export const DEFAULT_PAGE_SIZE = 20
/** @deprecated use usePageSize(); kept for backwards compatibility */
export const ROWS_PER_PAGE = DEFAULT_PAGE_SIZE

const STORAGE_KEY = 'hca.pageSize'
const listeners = new Set()

const readStoredPageSize = () => {
  try {
    const stored = Number(window.localStorage.getItem(STORAGE_KEY))
    if (PAGE_SIZE_OPTIONS.includes(stored)) return stored
  } catch {
    // ignore
  }
  return DEFAULT_PAGE_SIZE
}

let currentPageSize = readStoredPageSize()

export const getPageSize = () => currentPageSize

export const setPageSize = (size) => {
  const next = Number(size)
  if (!PAGE_SIZE_OPTIONS.includes(next) || next === currentPageSize) return
  currentPageSize = next
  try {
    window.localStorage.setItem(STORAGE_KEY, String(next))
  } catch {
    // ignore
  }
  listeners.forEach((listener) => listener())
  logUiAction('Pagination', 'Change Page Size', { pageSize: next })
}

const subscribe = (listener) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const usePageSize = () =>
  useSyncExternalStore(subscribe, getPageSize, () => DEFAULT_PAGE_SIZE)

export const paginateRows = (rows, currentPage, pageSize = currentPageSize) => {
  const safeRows = Array.isArray(rows) ? rows : []
  const safeSize = Math.max(1, Number(pageSize) || DEFAULT_PAGE_SIZE)
  const totalPages = Math.max(1, Math.ceil(safeRows.length / safeSize))
  const safePage = Math.min(Math.max(1, Number(currentPage) || 1), totalPages)
  const startIndex = (safePage - 1) * safeSize
  return safeRows.slice(startIndex, startIndex + safeSize)
}

function PaginationControls({
  currentPage,
  totalRows,
  onPageChange,
  pageSize: explicitPageSize,
  onPageSizeChange,
  showPageSize = true,
  alwaysShow = false,
}) {
  const globalPageSize = usePageSize()
  const pageSize = explicitPageSize || globalPageSize
  const totalPages = useMemo(() => {
    return Math.max(1, Math.ceil(Number(totalRows || 0) / pageSize))
  }, [pageSize, totalRows])

  const normalizedPage = Math.min(Math.max(1, Number(currentPage) || 1), totalPages)

  // The "go to page" input mirrors the current page until the user edits it.
  const [jumpState, setJumpState] = useState({
    forPage: normalizedPage,
    value: String(normalizedPage),
  })
  let jumpPage = jumpState.value
  if (jumpState.forPage !== normalizedPage) {
    jumpPage = String(normalizedPage)
    setJumpState({ forPage: normalizedPage, value: jumpPage })
  }
  const setJumpPage = (value) => setJumpState({ forPage: normalizedPage, value })

  // Keep the parent's page in range when the data or page size shrinks.
  useEffect(() => {
    if (Number(currentPage) > totalPages && typeof onPageChange === 'function') {
      onPageChange(totalPages)
    }
  }, [currentPage, totalPages, onPageChange])

  const total = Number(totalRows || 0)

  if (!alwaysShow && total <= PAGE_SIZE_OPTIONS[0] && total <= pageSize) {
    return null
  }

  const startRow = total === 0 ? 0 : (normalizedPage - 1) * pageSize + 1
  const endRow = Math.min(normalizedPage * pageSize, total)

  const goToPage = (page) => {
    const nextPage = Math.min(Math.max(1, Number(page) || 1), totalPages)
    onPageChange(nextPage)
  }

  const handleJumpSubmit = (event) => {
    event.preventDefault()
    goToPage(jumpPage)
  }

  const handlePageSizeChange = (event) => {
    const next = Number(event.target.value)
    if (typeof onPageSizeChange === 'function') {
      onPageSizeChange(next)
    } else {
      setPageSize(next)
    }
    goToPage(1)
  }

  return (
    <nav className="pagination-controls no-print" aria-label="Pagination">
      <div className="pagination-summary">
        {total === 0 ? (
          'No rows'
        ) : (
          <>
            Showing <strong>{startRow}–{endRow}</strong> of <strong>{total}</strong>
            {' '}· Page {normalizedPage} of {totalPages}
          </>
        )}
      </div>

      <div className="pagination-actions">
        {showPageSize && (
          <label className="pagination-page-size">
            <span>Rows per page</span>
            <select value={pageSize} onChange={handlePageSizeChange}>
              {PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="pagination-buttons">
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => goToPage(1)}
            disabled={normalizedPage === 1}
            aria-label="First page"
            title="First page"
          >
            <Icon name="chevronsLeft" size={16} />
          </button>

          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => goToPage(normalizedPage - 1)}
            disabled={normalizedPage === 1}
            aria-label="Previous page"
            title="Previous page"
          >
            <Icon name="chevronLeft" size={16} />
          </button>

          <form onSubmit={handleJumpSubmit} className="pagination-jump-form">
            <label>
              <span>Page</span>
              <input
                type="number" onWheel={(e) => e.target.blur()}
                min="1"
                max={totalPages}
                value={jumpPage}
                onChange={(event) => setJumpPage(event.target.value)}
                aria-label="Go to page"
              />
            </label>
            <button type="submit" className="btn-secondary btn-sm">
              Go
            </button>
          </form>

          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => goToPage(normalizedPage + 1)}
            disabled={normalizedPage === totalPages}
            aria-label="Next page"
            title="Next page"
          >
            <Icon name="chevronRight" size={16} />
          </button>

          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => goToPage(totalPages)}
            disabled={normalizedPage === totalPages}
            aria-label="Last page"
            title="Last page"
          >
            <Icon name="chevronsRight" size={16} />
          </button>
        </div>
      </div>
    </nav>
  )
}

export default PaginationControls
