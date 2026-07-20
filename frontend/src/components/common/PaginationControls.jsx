import { useEffect, useMemo, useState } from 'react'

export const ROWS_PER_PAGE = 20

export const paginateRows = (rows, currentPage, pageSize = ROWS_PER_PAGE) => {
  const safeRows = Array.isArray(rows) ? rows : []
  const safePage = Math.max(1, Number(currentPage) || 1)
  const startIndex = (safePage - 1) * pageSize

  return safeRows.slice(startIndex, startIndex + pageSize)
}

function PaginationControls({
  currentPage,
  totalRows,
  onPageChange,
  pageSize = ROWS_PER_PAGE,
}) {
  const [jumpPage, setJumpPage] = useState(String(currentPage || 1))

  const totalPages = useMemo(() => {
    return Math.max(1, Math.ceil(Number(totalRows || 0) / pageSize))
  }, [pageSize, totalRows])

  const normalizedPage = Math.min(
    Math.max(1, Number(currentPage) || 1),
    totalPages
  )

  useEffect(() => {
    setJumpPage(String(normalizedPage))
  }, [normalizedPage])

  if (!totalRows || totalRows <= pageSize) {
    return null
  }

  const startRow = (normalizedPage - 1) * pageSize + 1
  const endRow = Math.min(normalizedPage * pageSize, totalRows)

  const goToPage = (page) => {
    const nextPage = Math.min(Math.max(1, Number(page) || 1), totalPages)
    onPageChange(nextPage)
  }

  const handleJumpSubmit = (event) => {
    event.preventDefault()
    goToPage(jumpPage)
  }

  return (
    <div className="pagination-controls no-print">
      <div className="pagination-summary">
        Showing {startRow}-{endRow} of {totalRows} rows | Page{' '}
        {normalizedPage} of {totalPages}
      </div>

      <div className="pagination-actions">
        <button
          type="button"
          onClick={() => goToPage(1)}
          disabled={normalizedPage === 1}
        >
          First
        </button>

        <button
          type="button"
          onClick={() => goToPage(normalizedPage - 1)}
          disabled={normalizedPage === 1}
        >
          Previous
        </button>

        <form onSubmit={handleJumpSubmit} className="pagination-jump-form">
          <label>Jump to</label>
          <input
            type="number"
            min="1"
            max={totalPages}
            value={jumpPage}
            onChange={(event) => setJumpPage(event.target.value)}
          />
          <button type="submit">Go</button>
        </form>

        <button
          type="button"
          onClick={() => goToPage(normalizedPage + 1)}
          disabled={normalizedPage === totalPages}
        >
          Next
        </button>

        <button
          type="button"
          onClick={() => goToPage(totalPages)}
          disabled={normalizedPage === totalPages}
        >
          Last
        </button>
      </div>
    </div>
  )
}

export default PaginationControls
