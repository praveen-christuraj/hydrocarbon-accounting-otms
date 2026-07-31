import { useCallback, useEffect, useState } from 'react'
import { getDbTables, getDbTableData } from '../api/adminDbBrowserApi'

const REDACTED_PLACEHOLDER = '*** REDACTED ***'

function tryParseJson(raw) {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']')))) return null
  try { return JSON.parse(trimmed) } catch { return null }
}

function JsonDisplay({ value }) {
  const [expanded, setExpanded] = useState(false)

  if (value === null || value === undefined) return <span className="null-value">NULL</span>
  if (value === REDACTED_PLACEHOLDER) return <span className="redacted-value">{REDACTED_PLACEHOLDER}</span>

  const parsed = typeof value === 'object' ? value : tryParseJson(value)
  const isBool = typeof value === 'boolean'

  if (parsed !== null && typeof parsed === 'object') {
    const str = JSON.stringify(parsed)
    if (str.length <= 80) {
      return <code className="json-inline">{str}</code>
    }
    return (
      <div className="json-cell">
        <button type="button" className="json-toggle" onClick={() => setExpanded(!expanded)}>
          {expanded ? '▼' : '▶'} JSON
        </button>
        {expanded && <pre className="json-expanded">{JSON.stringify(parsed, null, 2)}</pre>}
      </div>
    )
  }

  if (isBool) return <span>{value ? 'true' : 'false'}</span>
  return <span>{String(value)}</span>
}

function DatabaseBrowser() {
  const [tables, setTables] = useState([])
  const [selectedTable, setSelectedTable] = useState('')
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  // Table data
  const [tableData, setTableData] = useState(null)
  const [dataLoading, setDataLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [jumpInput, setJumpInput] = useState('')
  const perPage = 50

  // Load table list on mount
  useEffect(() => {
    ;(async () => {
      try {
        setLoading(true)
        const result = await getDbTables()
        setTables(result)
      } catch (err) {
        setErrorMsg(err.message)
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  const loadTableData = useCallback(async (tableName, pageNum) => {
    try {
      setDataLoading(true)
      setErrorMsg('')
      const result = await getDbTableData(tableName, pageNum, perPage)
      setTableData(result)
    } catch (err) {
      setErrorMsg(err.message)
      setTableData(null)
    } finally {
      setDataLoading(false)
    }
  }, [])

  const handleTableChange = (e) => {
    const name = e.target.value
    setSelectedTable(name)
    setPage(1)
    if (name) {
      loadTableData(name, 1)
    } else {
      setTableData(null)
    }
  }

  const handlePageChange = (newPage) => {
    setPage(newPage)
    loadTableData(selectedTable, newPage)
  }

  const totalPages = tableData?.total_pages || 1

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>Database Browser</h1>
      </div>

      {errorMsg && (
        <div className="error-message">
          {errorMsg}
          <button type="button" onClick={() => setErrorMsg('')}>×</button>
        </div>
      )}

      <div className="db-browser-controls">
        <label htmlFor="table-select">Select Table:</label>
        <select id="table-select" value={selectedTable} onChange={handleTableChange} disabled={loading}>
          <option value="">-- Choose a table --</option>
          {tables.map((t) => (
            <option key={t.table_name} value={t.table_name}>
              {t.table_name} ({t.row_count} rows, {t.columns.length} cols)
            </option>
          ))}
        </select>
      </div>

      {selectedTable && (
        <div className="table-info">
          <strong>{selectedTable}</strong>
          {tableData && (
            <span className="table-info-detail">
              {' '}— Page {tableData.page} of {totalPages} ({(tableData.total || 0).toLocaleString()} rows total)
            </span>
          )}
        </div>
      )}

      {dataLoading && <div className="loading-spinner">Loading data...</div>}

      {tableData && !dataLoading && (
        <>
          <div className="table-responsive" style={{ overflowX: 'auto' }}>
            <table className="data-table db-browser-table">
              <thead>
                <tr>
                  <th className="row-num">#</th>
                  {tableData.columns.map((col) => (
                    <th key={col}>{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tableData.data.length === 0 ? (
                  <tr>
                    <td colSpan={tableData.columns.length + 1} className="empty-state">
                      No rows found.
                    </td>
                  </tr>
                ) : (
                  tableData.data.map((row, rowIdx) => (
                    <tr key={rowIdx}>
                      <td className="row-num">{(page - 1) * perPage + rowIdx + 1}</td>
                      {tableData.columns.map((col) => (
                        <td key={col}>
                          <JsonDisplay value={row[col]} />
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="pagination-controls">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => { setPage(1); loadTableData(selectedTable, 1); setJumpInput(''); }}
                title="First page"
              >
                ««
              </button>
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => { const np = page - 1; setPage(np); loadTableData(selectedTable, np); setJumpInput(''); }}
                title="Previous page"
              >
                « Prev
              </button>
              <span className="pagination-info">
                Page <strong>{page}</strong> of <strong>{totalPages}</strong>
              </span>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => { const np = page + 1; setPage(np); loadTableData(selectedTable, np); setJumpInput(''); }}
                title="Next page"
              >
                Next »
              </button>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => { setPage(totalPages); loadTableData(selectedTable, totalPages); setJumpInput(''); }}
                title="Last page"
              >
                »»
              </button>
              <span className="jump-separator">|</span>
              <label htmlFor="jump-page" className="jump-label">Jump to:</label>
              <input
                id="jump-page"
                type="number"
                className="jump-input"
                min={1}
                max={totalPages}
                value={jumpInput}
                onChange={(e) => setJumpInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const np = parseInt(jumpInput, 10)
                    if (np >= 1 && np <= totalPages) {
                      setPage(np)
                      loadTableData(selectedTable, np)
                      setJumpInput('')
                    }
                  }
                }}
                placeholder={`1-${totalPages}`}
              />
              <button
                type="button"
                className="jump-go-button"
                disabled={!jumpInput}
                onClick={() => {
                  const np = parseInt(jumpInput, 10)
                  if (np >= 1 && np <= totalPages) {
                    setPage(np)
                    loadTableData(selectedTable, np)
                    setJumpInput('')
                  }
                }}
              >
                Go
              </button>
            </div>
          )}
        </>
      )}

      {!selectedTable && !dataLoading && !loading && (
        <div className="empty-state" style={{ marginTop: '2rem' }}>
          Select a table above to browse its contents.
        </div>
      )}

      <style>{`
        .db-browser-controls {
          margin-bottom: 1rem;
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }
        .db-browser-controls select {
          min-width: 400px;
          padding: 0.4rem 0.6rem;
          border: 1px solid #ccc;
          border-radius: 4px;
          font-size: 0.95rem;
        }
        .table-info {
          margin-bottom: 0.75rem;
          font-size: 0.95rem;
          color: #555;
        }
        .table-info-detail {
          color: #888;
        }
        .db-browser-table {
          font-size: 0.8rem;
          white-space: nowrap;
        }
        .db-browser-table th {
          position: sticky;
          top: 0;
          background: #cbd5e1;
          color: #1e293b;
          border-bottom: 2px solid #94a3b8;
          z-index: 1;
          max-width: 250px;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .db-browser-table td {
          max-width: 300px;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .row-num {
          width: 40px;
          min-width: 40px;
          text-align: center;
          color: #999;
          font-size: 0.75rem;
        }
        .null-value {
          color: #ccc;
          font-style: italic;
        }
        .redacted-value {
          color: #e74c3c;
          font-weight: 600;
          background: #fdecea;
          padding: 0 4px;
          border-radius: 2px;
        }
        .json-cell {
          position: relative;
        }
        .json-toggle {
          background: #eef;
          border: 1px solid #ccd;
          border-radius: 3px;
          padding: 1px 6px;
          cursor: pointer;
          font-size: 0.75rem;
          color: #446;
        }
        .json-toggle:hover {
          background: #dde;
        }
        .json-expanded {
          position: absolute;
          left: 0;
          top: 100%;
          z-index: 10;
          background: #1e1e2e;
          color: #cdd6f4;
          padding: 0.75rem;
          border-radius: 6px;
          font-size: 0.75rem;
          line-height: 1.4;
          max-height: 400px;
          overflow: auto;
          min-width: 300px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.3);
          white-space: pre;
        }
        .json-inline {
          background: #f5f5f5;
          padding: 1px 4px;
          border-radius: 3px;
          font-size: 0.78rem;
        }
        .pagination-controls {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.25rem;
          margin-top: 1rem;
          padding: 0.5rem 0;
        }
        .pagination-controls button {
          padding: 0.35rem 0.65rem;
          border: 1px solid #ccc;
          background: #fff;
          border-radius: 4px;
          cursor: pointer;
          font-size: 0.85rem;
        }
        .pagination-controls button:disabled {
          opacity: 0.4;
          cursor: default;
        }
        .pagination-controls button:not(:disabled):hover {
          background: #eef;
        }
        .pagination-info {
          padding: 0 0.5rem;
          font-size: 0.85rem;
          color: #666;
        }
        .jump-separator {
          color: #ccc;
          margin: 0 0.25rem;
        }
        .jump-label {
          font-size: 0.8rem;
          color: #666;
          margin-right: 0.25rem;
        }
        .jump-input {
          width: 60px;
          padding: 0.3rem 0.4rem;
          border: 1px solid #ccc;
          border-radius: 4px;
          font-size: 0.85rem;
          text-align: center;
        }
        .jump-input:focus {
          outline: none;
          border-color: #64748b;
          box-shadow: 0 0 0 2px rgba(100,116,139,0.2);
        }
        .jump-go-button {
          padding: 0.3rem 0.6rem !important;
          font-size: 0.8rem !important;
        }
        .loading-spinner {
          padding: 2rem;
          text-align: center;
          color: #888;
        }
      `}</style>
    </div>
  )
}

export default DatabaseBrowser
