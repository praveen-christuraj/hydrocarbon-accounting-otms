import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  bulkDeleteExportTransactions,
  getDeletedExportTransactions,
} from '../../api/exportOperationsApi'
import AlertMessage from '../../components/common/AlertMessage'
import { useConfirm } from '../../components/common/ConfirmProvider'
import DataTableToolbar from '../../components/common/DataTableToolbar'
import Icon from '../../components/common/Icon'
import PageHeader from '../../components/common/PageHeader'
import PaginationControls, { paginateRows, usePageSize } from '../../components/common/PaginationControls'
import { useDataFilters } from '../../hooks/useDataFilters'
import { logUiAction } from '../../utils/actionLogger'
import { fmt, useExportPermissions } from './exportShared'

const MODULE = 'Deleted Export Entries'
const MAX_BULK_DELETE = 500

const COLUMNS = [
  { key: 'bl_date', label: 'BL Date', type: 'date' },
  { key: 'vessel_name', label: 'Vessel' },
  { key: 'quarter', label: 'Quarter', type: 'select' },
  { key: 'location_label', label: 'Location', type: 'select' },
  { key: 'entity_label', label: 'Entity', type: 'select' },
  { key: 'block_label', label: 'Block', type: 'select' },
  { key: 'volume', label: 'Volume', type: 'number' },
  { key: 'consignee', label: 'Consignee', type: 'select' },
  { key: 'destination', label: 'Destination' },
  { key: 'country', label: 'Country', type: 'select' },
  { key: 'permit_number', label: 'Permit #' },
  { key: 'remarks', label: 'Remarks' },
  { key: 'status', label: 'Status', type: 'select' },
]

function ExportDeletedEntries({ loggedInUser }) {
  const confirm = useConfirm()
  const { canDelete } = useExportPermissions(loggedInUser, 'Export Transaction')
  const [transactions, setTransactions] = useState([])
  const [selectedIds, setSelectedIds] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [page, setPage] = useState(1)
  const pageSize = usePageSize()

  const loadTransactions = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await getDeletedExportTransactions()
      setTransactions(Array.isArray(data) ? data : [])
    } catch (err) {
      setError(err.message || 'Unable to load deleted export entries.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    getDeletedExportTransactions()
      .then((data) => {
        if (!cancelled) setTransactions(Array.isArray(data) ? data : [])
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Unable to load deleted export entries.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const rows = useMemo(
    () =>
      [...transactions]
        .sort((a, b) => String(b.bl_date || '').localeCompare(String(a.bl_date || '')) || b.id - a.id)
        .map((tx) => ({
          ...tx,
          location_label: tx.location_name || tx.location_code,
          entity_label: tx.entity_name || tx.entity_code,
          block_label: tx.block_name || tx.block_code,
        })),
    [transactions]
  )
  const filters = useDataFilters(rows, COLUMNS, { module: MODULE })
  const visibleRows = paginateRows(filters.filteredRows, page, pageSize)
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const allVisibleSelected = visibleRows.length > 0 && visibleRows.every((row) => selectedIdSet.has(row.id))
  const columnCount = 12 + (canDelete ? 1 : 0)

  const toggleTransactionSelection = (id, checked) => {
    if (!checked) {
      setSelectedIds((current) => current.filter((selectedId) => selectedId !== id))
      return
    }
    if (selectedIdSet.has(id)) return
    if (selectedIds.length >= MAX_BULK_DELETE) {
      setError(`Select no more than ${MAX_BULK_DELETE} entries per permanent-delete batch.`)
      return
    }
    setError('')
    setSelectedIds((current) => [...new Set([...current, id])])
  }

  const toggleVisibleSelection = (checked) => {
    const visibleIds = visibleRows.map((row) => row.id)
    if (!checked) {
      setSelectedIds((current) => current.filter((id) => !visibleIds.includes(id)))
      return
    }
    const additions = visibleIds.filter((id) => !selectedIdSet.has(id))
    if (selectedIds.length + additions.length > MAX_BULK_DELETE) {
      setError(`Select no more than ${MAX_BULK_DELETE} entries per permanent-delete batch.`)
      return
    }
    setError('')
    setSelectedIds((current) => [...new Set([...current, ...visibleIds])])
  }

  const handlePermanentDelete = async () => {
    if (!canDelete || selectedIds.length === 0 || loading) return
    const transactionIds = [...new Set(selectedIds)]
    const count = transactionIds.length
    const confirmed = await confirm({
      title: 'Permanently delete selected entries',
      message: `Permanently delete ${count} selected inactive export entr${count === 1 ? 'y' : 'ies'}? This cannot be undone.`,
      details: 'The selected records will be removed from the database. An audit snapshot will be retained for each entry.',
      tone: 'danger',
      confirmLabel: `Permanently delete ${count}`,
      module: MODULE,
    })
    if (!confirmed) return

    setError('')
    setSuccess('')
    try {
      setLoading(true)
      const result = await bulkDeleteExportTransactions(transactionIds)
      const deletedCount = Number(result?.deleted ?? count)
      setSelectedIds([])
      setSuccess(`${deletedCount} deleted export entr${deletedCount === 1 ? 'y' : 'ies'} permanently removed.`)
      logUiAction(MODULE, 'Permanently Delete Entries', { transaction_ids: transactionIds, deleted: deletedCount })
      await loadTransactions()
    } catch (err) {
      setError(err.message || 'Unable to permanently delete the selected entries.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="export-operations-page">
      <PageHeader
        title="Deleted Export Entries"
        description="Review legacy inactive export transactions and permanently remove selected records."
        count={`${transactions.length} Inactive`}
        actions={
          <Link to="/export-operations/transactions" className="btn-secondary">
            <Icon name="chevronLeft" size={15} />
            Back to Export Transactions
          </Link>
        }
      />

      <AlertMessage tone="success" message={success} onDismiss={() => setSuccess('')} />
      <AlertMessage tone="error" message={error} onDismiss={() => setError('')} />
      <div className="warning-box">
        <strong>Legacy inactive transactions</strong> are hidden from active export reports. Permanent deletion cannot be undone; an audit snapshot is retained. Select entries below and choose “Permanently delete selected”.
      </div>
      {!canDelete && (
        <div className="info-box">You have view-only access. A user with Delete Export Transaction permission must permanently remove these entries.</div>
      )}

      <DataTableToolbar
        filters={filters}
        columns={COLUMNS}
        exportFileName="deleted-export-entries"
        exportTitle="Deleted Export Entries"
        module={MODULE}
        canImport={false}
        searchPlaceholder="Search vessel, consignee, permit…"
        extraActions={
          canDelete && (
            <>
              <span className="toolbar-total">Selected: <strong>{selectedIds.length}</strong> / {MAX_BULK_DELETE}</span>
              <button
                type="button"
                className="btn-danger btn-sm"
                onClick={handlePermanentDelete}
                disabled={loading || selectedIds.length === 0}
              >
                <Icon name="trash" size={15} />
                Permanently delete selected
              </button>
              {selectedIds.length > 0 && (
                <button type="button" className="btn-secondary btn-sm" onClick={() => setSelectedIds([])} disabled={loading}>
                  Clear selection
                </button>
              )}
            </>
          )
        }
      />

      <div className="table-scroll">
        <table className="export-transaction-table">
          <thead>
            <tr>
              {canDelete && (
                <th className="task-select-col">
                  <input
                    type="checkbox"
                    aria-label="Select all deleted export entries on this page"
                    checked={allVisibleSelected}
                    onChange={(event) => toggleVisibleSelection(event.target.checked)}
                    disabled={loading || visibleRows.length === 0}
                  />
                </th>
              )}
              <th>BL Date</th>
              <th>Vessel</th>
              <th>Quarter</th>
              <th>Location</th>
              <th>Entity</th>
              <th>Block</th>
              <th className="numeric">Volume</th>
              <th>Consignee</th>
              <th>Destination / Country</th>
              <th>Permit #</th>
              <th>Remarks</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 ? (
              <tr>
                <td colSpan={columnCount} className="empty-table">
                  {loading
                    ? 'Loading…'
                    : transactions.length === 0
                      ? 'No inactive export transactions are waiting for permanent deletion.'
                      : 'No entries match the filters.'}
                </td>
              </tr>
            ) : (
              visibleRows.map((tx) => (
                <tr key={tx.id} className={selectedIdSet.has(tx.id) ? 'row-selected' : ''}>
                  {canDelete && (
                    <td className="task-select-col">
                      <input
                        type="checkbox"
                        aria-label={`Select deleted export entry ${tx.id}`}
                        checked={selectedIdSet.has(tx.id)}
                        onChange={(event) => toggleTransactionSelection(tx.id, event.target.checked)}
                        disabled={loading || (!selectedIdSet.has(tx.id) && selectedIds.length >= MAX_BULK_DELETE)}
                      />
                    </td>
                  )}
                  <td>{tx.bl_date}</td>
                  <td>{tx.vessel_name || '—'}</td>
                  <td>{tx.quarter}</td>
                  <td>{tx.location_label}</td>
                  <td>{tx.entity_label}</td>
                  <td>{tx.block_label}</td>
                  <td className="numeric">{fmt(tx.volume)}</td>
                  <td>{tx.consignee}</td>
                  <td>
                    {tx.destination}
                    <div className="muted-table-text">{tx.country}</div>
                  </td>
                  <td>{tx.permit_number || '—'}</td>
                  <td className="cell-wrap">{tx.remarks || '—'}</td>
                  <td><span className="status-badge inactive">Inactive</span></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <PaginationControls currentPage={page} totalRows={filters.filteredRows.length} onPageChange={setPage} />
    </div>
  )
}

export default ExportDeletedEntries
