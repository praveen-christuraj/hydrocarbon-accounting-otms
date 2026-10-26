import { Link } from 'react-router-dom'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  getOperationTransactionsPaged,
  exportOperationTransactionsCsv,
  updateOperationTransactionStatus,
} from '../api/operationTransactionApi'
import { useCompanyPrintProfile } from '../hooks/useCompanyPrintProfile'
import { usePrintDialog } from '../components/print/printProfileContext'
import { usePermissions } from '../hooks/usePermissions'
import { logUiAction } from '../utils/actionLogger'
import AlertMessage from '../components/common/AlertMessage'
import Modal from '../components/common/Modal'
import ExportMenu from '../components/common/ExportMenu'
import useActionFeedback from '../hooks/useActionFeedback'

/*
 * Bulk workflow actions available from the register.
 *
 * Each entry mirrors the server rules (backend/app/routers/operation_transactions.py):
 *  - `from` is the set of statuses the server allows for that transition,
 *  - `permissions` are every permission the status endpoint enforces (Submit and
 *    Approve also require "Review Operation Transaction" because the request
 *    carries `review_confirmed`),
 *  - `reviewConfirmation` marks the actions that must be explicitly reviewed,
 *  - `remarksRequired` marks the actions that must be justified for the audit
 *    trail (the server records the remarks in the status history).
 */
const BULK_ACTIONS = {
  submit: {
    label: 'Submit',
    pastTense: 'submitted',
    nextStatus: 'Submitted',
    from: ['Draft', 'Rejected'],
    permissions: ['Submit Operation Transaction', 'Review Operation Transaction'],
    reviewConfirmation: true,
    defaultRemarks: 'Submitted from Operation Transaction Register (bulk)',
    confirmLabel: 'Submit selected',
    tone: 'primary',
  },
  approve: {
    label: 'Approve',
    pastTense: 'approved',
    nextStatus: 'Approved',
    from: ['Submitted'],
    permissions: ['Approve Operation Transaction', 'Review Operation Transaction'],
    reviewConfirmation: true,
    defaultRemarks: 'Approved from Operation Transaction Register (bulk)',
    confirmLabel: 'Approve selected',
    tone: 'primary',
  },
  reject: {
    label: 'Reject',
    pastTense: 'rejected',
    nextStatus: 'Rejected',
    from: ['Submitted'],
    permissions: ['Reject Operation Transaction'],
    reviewConfirmation: false,
    remarksRequired: true,
    defaultRemarks: '',
    confirmLabel: 'Reject selected',
    tone: 'danger',
  },
  recall: {
    label: 'Recall to Draft',
    pastTense: 'recalled to Draft',
    nextStatus: 'Draft',
    from: ['Submitted'],
    permissions: ['Submit Operation Transaction'],
    reviewConfirmation: false,
    defaultRemarks: 'Recalled to Draft from Operation Transaction Register (bulk)',
    confirmLabel: 'Recall selected',
    tone: 'secondary',
  },
  cancel: {
    label: 'Cancel',
    pastTense: 'cancelled',
    nextStatus: 'Cancelled',
    from: ['Draft', 'Rejected'],
    permissions: ['Cancel Operation Transaction'],
    reviewConfirmation: false,
    remarksRequired: true,
    defaultRemarks: '',
    confirmLabel: 'Cancel selected',
    tone: 'danger',
  },
}

const BULK_ACTION_ORDER = ['submit', 'approve', 'reject', 'recall', 'cancel']

/** Hard cap for "select all matching filter" so a huge history never blocks the UI. */
const SELECT_ALL_LIMIT = 1000
const SELECT_ALL_PAGE_SIZE = 200

const SELECTION_ELIGIBLE_STATUSES = new Set(['Draft', 'Submitted', 'Rejected'])

const EXPORT_COLUMNS = [
  { key: 'ticket_number', label: 'Ticket Number' },
  { key: 'convoy_number', label: 'Convoy Number' },
  { key: 'operation_date', label: 'Date' },
  { key: 'operation_type_name', label: 'Operation Type' },
  { key: 'location_code', label: 'Location' },
  { key: 'primary_asset_code', label: 'Primary Asset' },
  { key: 'status', label: 'Status' },
  { key: 'created_at', label: 'Created At' },
]

function OperationTransactionRegister({
  operationTypes = [],
  locations = [],
  assets = [],
  loggedInUser = null,
}) {
  const profile = useCompanyPrintProfile()
  const { requestPrint } = usePrintDialog()
  const { hasPermission } = usePermissions(loggedInUser)

  const [rows, setRows] = useState([])
  const [statusCounts, setStatusCounts] = useState([])
  const [totalRows, setTotalRows] = useState(0)

  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [hasMore, setHasMore] = useState(false)

  const [loading, setLoading] = useState(false)
  // Action feedback: little pop-up (toast) + inline message near the
  // action area (owner rule 8) - never at the bottom of the page.
  const feedback = useActionFeedback()
  const { notifySuccess, notifyError, clearSuccess, clearError } = feedback

  const [filters, setFilters] = useState({
    searchText: '',
    dateFrom: '',
    dateTo: '',
    operationTypeId: '',
    locationId: '',
    assetId: '',
    status: '',
  })

  /* ------------------------------------------------------------- selection */
  // Selected tickets are kept by id together with the row that was on screen,
  // so a selection survives paging until the user clears it or changes filters.
  const [selectedRows, setSelectedRows] = useState({})
  const [selectingAll, setSelectingAll] = useState(false)
  const [bulkActionKey, setBulkActionKey] = useState('')
  const [bulkRemarks, setBulkRemarks] = useState('')
  const [bulkReviewConfirmed, setBulkReviewConfirmed] = useState(false)
  const [bulkRunning, setBulkRunning] = useState(false)
  const [bulkProgress, setBulkProgress] = useState({ done: 0, total: 0 })
  const [bulkResults, setBulkResults] = useState([])
  const headerCheckboxRef = useRef(null)

  const bulkPermissions = useMemo(() => {
    const permissions = {}
    BULK_ACTION_ORDER.forEach((key) => {
      permissions[key] = BULK_ACTIONS[key].permissions.every((name) => hasPermission(name))
    })
    return permissions
  }, [hasPermission])

  const allowedBulkActions = useMemo(
    () => BULK_ACTION_ORDER.filter((key) => bulkPermissions[key]),
    [bulkPermissions]
  )
  const canBulkAct = allowedBulkActions.length > 0

  const selectedList = useMemo(() => Object.values(selectedRows), [selectedRows])
  const selectedCount = selectedList.length
  const selectedIds = useMemo(
    () => new Set(selectedList.map((row) => Number(row.id))),
    [selectedList]
  )

  const activeOperationTypes = operationTypes.filter((item) => item.status === 'Active')
  const activeLocations = locations.filter((item) => item.status === 'Active')
  const activeAssets = assets.filter((item) => item.status === 'Active')

  const selectedLocation = activeLocations.find(
    (location) => String(location.id) === String(filters.locationId)
  )

  const filteredAssetsForLocation = useMemo(() => {
    if (!filters.locationId || !selectedLocation) {
      return activeAssets
    }

    return activeAssets.filter((asset) => {
      return (
        String(asset.locationId) === String(filters.locationId) ||
        asset.locationCode === selectedLocation.locationCode ||
        asset.assetScope === 'Global'
      )
    })
  }, [activeAssets, filters.locationId, selectedLocation])

  const statusCountMap = useMemo(() => {
    const map = {}
    ;(statusCounts || []).forEach((r) => {
      const key = String(r.status || '')
      map[key] = Number(r.count || 0)
    })
    return map
  }, [statusCounts])

  const allStatusTotal = useMemo(() => {
    return Object.values(statusCountMap).reduce((sum, v) => sum + Number(v || 0), 0)
  }, [statusCountMap])

  const loadPaged = async () => {
    try {
      setLoading(true)
      const data = await getOperationTransactionsPaged({
        ...filters,
        page,
        pageSize,
      })

      setRows(Array.isArray(data?.rows) ? data.rows : [])
      setTotalRows(Number(data?.total_rows || 0))
      setHasMore(Boolean(data?.has_more))
      setStatusCounts(Array.isArray(data?.status_counts) ? data.status_counts : [])
      clearError()
    } catch (error) {
      notifyError(error.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const delay = setTimeout(() => {
      loadPaged()
    }, 300)

    return () => clearTimeout(delay)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, page, pageSize])

  const handleFilterChange = (e) => {
    const { name, value } = e.target

    if (name === 'locationId') {
      setPage(1)
      setSelectedRows({})
      setFilters((c) => ({
        ...c,
        locationId: value,
        assetId: '',
      }))
      return
    }

    setPage(1)
    setSelectedRows({})
    setFilters((c) => ({
      ...c,
      [name]: value,
    }))
  }

  const setStatusTab = (status) => {
    setPage(1)
    setSelectedRows({})
    setFilters((c) => ({ ...c, status }))
  }

  const clearFilters = () => {
    setPage(1)
    setSelectedRows({})
    setFilters({
      searchText: '',
      dateFrom: '',
      dateTo: '',
      operationTypeId: '',
      locationId: '',
      assetId: '',
      status: '',
    })
  }

  /* ------------------------------------------------------ selection helpers */

  const isSelectable = (row) => SELECTION_ELIGIBLE_STATUSES.has(String(row?.status || ''))

  const toggleRowSelection = (row, checked) => {
    setSelectedRows((current) => {
      const next = { ...current }
      if (checked) next[Number(row.id)] = row
      else delete next[Number(row.id)]
      return next
    })
  }

  const pageSelectableRows = useMemo(() => rows.filter(isSelectable), [rows])
  const pageSelectedCount = pageSelectableRows.filter((row) =>
    selectedIds.has(Number(row.id))
  ).length
  const allPageSelected =
    pageSelectableRows.length > 0 && pageSelectedCount === pageSelectableRows.length
  const somePageSelected = pageSelectedCount > 0 && !allPageSelected

  useEffect(() => {
    if (headerCheckboxRef.current) {
      headerCheckboxRef.current.indeterminate = somePageSelected
    }
  }, [somePageSelected])

  const toggleSelectAllOnPage = (checked) => {
    setSelectedRows((current) => {
      const next = { ...current }
      pageSelectableRows.forEach((row) => {
        if (checked) next[Number(row.id)] = row
        else delete next[Number(row.id)]
      })
      return next
    })
  }

  const clearSelection = () => setSelectedRows({})

  /** Pull every ticket that matches the current filters (bounded). */
  const selectAllMatchingFilters = async () => {
    if (selectingAll) return
    try {
      setSelectingAll(true)
      clearError()
      const collected = []
      let pageNumber = 1
      let total = 0
      let truncated = false

      // Always fetch unfiltered-by-status minus the tab filter: the tab is a
      // filter the user can see, so it is honoured exactly as shown.
      while (collected.length < SELECT_ALL_LIMIT) {
        const data = await getOperationTransactionsPaged({
          ...filters,
          page: pageNumber,
          pageSize: SELECT_ALL_PAGE_SIZE,
        })
        const pageRows = Array.isArray(data?.rows) ? data.rows : []
        total = Number(data?.total_rows || 0)
        collected.push(...pageRows)
        if (!data?.has_more || pageRows.length === 0) break
        pageNumber += 1
      }

      if (collected.length > SELECT_ALL_LIMIT) {
        collected.length = SELECT_ALL_LIMIT
        truncated = true
      }

      const selectable = collected.filter(isSelectable)
      setSelectedRows((current) => {
        const next = { ...current }
        selectable.forEach((row) => {
          next[Number(row.id)] = row
        })
        return next
      })
      logUiAction('Operation Transaction Register', 'Select All Matching Filters', {
        total,
        selected: selectable.length,
        truncated,
      })
      if (truncated) {
        notifyError(
          `${total} tickets match the filters; only the first ${SELECT_ALL_LIMIT} were selected. Narrow the filters to reach the rest.`
        )
      } else if (selectable.length === 0) {
        notifyError('No ticket in the current filter can be submitted, approved or cancelled.')
      }
    } catch (error) {
      notifyError(error.message)
    } finally {
      setSelectingAll(false)
    }
  }

  /* ------------------------------------------------------ bulk workflow run */

  const bulkAction = bulkActionKey ? BULK_ACTIONS[bulkActionKey] : null

  const eligibleSelected = useMemo(() => {
    if (!bulkAction) return []
    return selectedList.filter((row) => bulkAction.from.includes(String(row.status || '')))
  }, [bulkAction, selectedList])

  const ineligibleSelected = useMemo(() => {
    if (!bulkAction) return []
    return selectedList.filter((row) => !bulkAction.from.includes(String(row.status || '')))
  }, [bulkAction, selectedList])

  const openBulkAction = (key) => {
    if (!BULK_ACTIONS[key] || !bulkPermissions[key]) {
      notifyError(
        `You do not have permission to ${BULK_ACTIONS[key]?.label?.toLowerCase() || 'perform this action'} operation transactions in bulk.`
      )
      return
    }
    setBulkActionKey(key)
    setBulkRemarks('')
    setBulkReviewConfirmed(false)
    setBulkResults([])
    setBulkProgress({ done: 0, total: 0 })
    logUiAction('Operation Transaction Register', `Open Bulk ${BULK_ACTIONS[key].label}`, {
      selected: selectedCount,
    })
  }

  const closeBulkDialog = () => {
    if (bulkRunning) return
    setBulkActionKey('')
    setBulkRemarks('')
    setBulkReviewConfirmed(false)
    setBulkResults([])
    setBulkProgress({ done: 0, total: 0 })
  }

  const bulkRemarksValue = bulkRemarks.trim()
  const bulkConfirmDisabled =
    bulkRunning ||
    eligibleSelected.length === 0 ||
    (bulkAction?.remarksRequired && bulkRemarksValue === '') ||
    (bulkAction?.reviewConfirmation && !bulkReviewConfirmed)

  const runBulkAction = async () => {
    if (!bulkAction) return
    if (eligibleSelected.length === 0) {
      notifyError('No selected ticket can move to that status.')
      return
    }
    if (bulkAction.remarksRequired && bulkRemarksValue === '') {
      notifyError(`Enter remarks for the ${bulkAction.label.toLowerCase()} action.`)
      return
    }
    if (bulkAction.reviewConfirmation && !bulkReviewConfirmed) {
      notifyError('Confirm that you reviewed the selected tickets before continuing.')
      return
    }

    const remarks = bulkRemarksValue || bulkAction.defaultRemarks
    const batch = [...eligibleSelected]
    const outcome = []
    setBulkRunning(true)
    setBulkProgress({ done: 0, total: batch.length })
    clearError()
    logUiAction('Operation Transaction Register', `Bulk ${bulkAction.label} Started`, {
      requested: batch.length,
      nextStatus: bulkAction.nextStatus,
    })

    for (let index = 0; index < batch.length; index += 1) {
      const row = batch[index]
      try {
        await updateOperationTransactionStatus(
          row.id,
          bulkAction.nextStatus,
          remarks,
          Boolean(bulkAction.reviewConfirmation)
        )
        outcome.push({
          id: row.id,
          ticketNumber: row.ticket_number || row.operation_number || `#${row.id}`,
          status: 'success',
          message: `${bulkAction.nextStatus} applied`,
        })
      } catch (error) {
        outcome.push({
          id: row.id,
          ticketNumber: row.ticket_number || row.operation_number || `#${row.id}`,
          status: 'failed',
          message: error.message || `${bulkAction.label} failed`,
        })
      }
      setBulkProgress({ done: index + 1, total: batch.length })
      setBulkResults([...outcome])
    }

    setBulkResults(outcome)
    setBulkRunning(false)

    const succeeded = outcome.filter((item) => item.status === 'success')
    const failed = outcome.filter((item) => item.status === 'failed')

    // Drop the tickets that reached the new status from the selection; keep
    // failed ones so the user can retry them without re-selecting.
    setSelectedRows((current) => {
      const next = { ...current }
      succeeded.forEach((item) => {
        delete next[Number(item.id)]
      })
      return next
    })

    await loadPaged()
    logUiAction('Operation Transaction Register', `Bulk ${bulkAction.label} Completed`, {
      succeeded: succeeded.length,
      failed: failed.length,
      nextStatus: bulkAction.nextStatus,
    })

    if (failed.length === 0) {
      notifySuccess(
        `${succeeded.length} ticket${succeeded.length === 1 ? '' : 's'} ${bulkAction.pastTense}.`
      )
    } else {
      const summary = `${succeeded.length} ${bulkAction.pastTense}; ${failed.length} failed. ${failed
        .map((item) => `${item.ticketNumber}: ${item.message}`)
        .join(' | ')}`
      if (succeeded.length > 0) notifyError(summary)
      else notifyError(`No ticket was ${bulkAction.pastTense}. ${summary}`)
    }
  }

  /* ------------------------------------------------------------- export/print */

  const handleBackendExportCsv = async () => {
    try {
      setLoading(true)
      await exportOperationTransactionsCsv(filters)
    } catch (error) {
      notifyError(error.message)
    } finally {
      setLoading(false)
    }
  }

  const handlePrintRegister = () => {
    requestPrint({
      module: 'Operation Transaction Register',
      reportName: 'Operation Transaction Register',
      onBeforePrint: () => {
        logUiAction('Operation Transaction Register', 'Print Register', filters)
      },
    })
  }

  const totalPages = useMemo(() => {
    return Math.max(1, Math.ceil(totalRows / pageSize))
  }, [totalRows, pageSize])

  return (
    <div className="op-transaction-register-page">
      {profile && (
        <div className="print-report-header">
          <div className="print-company-block">
            {profile.logoUrl ? (
              <img src={profile.logoUrl} alt={`${profile.companyName} Logo`} className="print-company-logo" />
            ) : (
              <div className="print-logo-placeholder">{profile.logoText || 'LOGO'}</div>
            )}
            <div>
              <h1>{profile.companyName}</h1>
              <p>{profile.systemName}</p>
              <p>{profile.reportSubtitle || 'Operation Transaction Register'}</p>
            </div>
          </div>

          <div className="print-report-meta">
            <span>
              <strong>Date From:</strong> {filters.dateFrom || '-'}
            </span>
            <span>
              <strong>Date To:</strong> {filters.dateTo || '-'}
            </span>
            <span>
              <strong>Status:</strong> {filters.status || 'All'}
            </span>
            <span>
              <strong>Printed:</strong> {new Date().toLocaleString()}
            </span>
          </div>
        </div>
      )}

      <div className="page-title no-print">
        <div>
          <h2>Operation Transaction Register</h2>
          <p>
            View, filter, print, and export saved operation tickets by date,
            operation, location, asset, and status. Select tickets to submit,
            approve, reject, recall or cancel them in bulk.
          </p>
        </div>

        <div className="register-title-actions">
          <span className="record-count">
            {totalRows} Transactions
          </span>

          <button type="button" onClick={handlePrintRegister}>
            Print Register
          </button>

          <button type="button" onClick={handleBackendExportCsv} disabled={loading}>
            Export CSV
          </button>
        </div>
      </div>
      {/* Action feedback: right next to the page actions + a little pop-up
          toast - never at the bottom of the page (owner rule 8). */}
      <AlertMessage tone="success" message={feedback.successMsg} onDismiss={clearSuccess} />
      <AlertMessage tone="error" message={feedback.errorMsg} onDismiss={clearError} />

      <div className="info-box no-print">
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            type="button"
            className={!filters.status ? 'active-tab-btn' : ''}
            onClick={() => setStatusTab('')}
          >
            All ({allStatusTotal})
          </button>
          <button
            type="button"
            className={filters.status === 'Draft' ? 'active-tab-btn' : ''}
            onClick={() => setStatusTab('Draft')}
          >
            Draft ({statusCountMap.Draft || 0})
          </button>
          <button
            type="button"
            className={filters.status === 'Submitted' ? 'active-tab-btn' : ''}
            onClick={() => setStatusTab('Submitted')}
          >
            Submitted ({statusCountMap.Submitted || 0})
          </button>
          <button
            type="button"
            className={filters.status === 'Approved' ? 'active-tab-btn' : ''}
            onClick={() => setStatusTab('Approved')}
          >
            Approved ({statusCountMap.Approved || 0})
          </button>
          <button
            type="button"
            className={filters.status === 'Rejected' ? 'active-tab-btn' : ''}
            onClick={() => setStatusTab('Rejected')}
          >
            Rejected ({statusCountMap.Rejected || 0})
          </button>
          <button
            type="button"
            className={filters.status === 'Cancelled' ? 'active-tab-btn' : ''}
            onClick={() => setStatusTab('Cancelled')}
          >
            Cancelled ({statusCountMap.Cancelled || 0})
          </button>
        </div>
      </div>

      <form className="no-print">
        <div>
          <label>Search</label>
          <input
            name="searchText"
            type="text"
            value={filters.searchText}
            onChange={handleFilterChange}
            placeholder="Ticket, operation, location, asset, status"
          />
        </div>

        <div>
          <label>Date From</label>
          <input
            name="dateFrom"
            type="date"
            value={filters.dateFrom}
            onChange={handleFilterChange}
          />
        </div>

        <div>
          <label>Date To</label>
          <input
            name="dateTo"
            type="date"
            value={filters.dateTo}
            onChange={handleFilterChange}
          />
        </div>

        <div>
          <label>Operation Type</label>
          <select
            name="operationTypeId"
            value={filters.operationTypeId}
            onChange={handleFilterChange}
          >
            <option value="">All Operation Types</option>
            {activeOperationTypes.map((operationType) => (
              <option key={operationType.id} value={operationType.id}>
                {operationType.operationTypeName}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label>Location</label>
          <select
            name="locationId"
            value={filters.locationId}
            onChange={handleFilterChange}
          >
            <option value="">All Locations</option>
            {activeLocations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.locationName} ({location.locationCode})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label>Asset</label>
          <select
            name="assetId"
            value={filters.assetId}
            onChange={handleFilterChange}
          >
            <option value="">All Assets</option>
            {filteredAssetsForLocation.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.assetName} ({asset.assetCode})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label>Page Size</label>
          <select
            value={String(pageSize)}
            onChange={(e) => {
              const next = Number(e.target.value || 20)
              setPage(1)
              setPageSize(next)
            }}
          >
            <option value="10">10</option>
            <option value="20">20</option>
            <option value="50">50</option>
            <option value="100">100</option>
          </select>
        </div>

        <div className="form-actions">
          <button type="button" onClick={loadPaged} disabled={loading}>
            {loading ? 'Loading...' : 'Refresh'}
          </button>

          <button type="button" onClick={clearFilters} disabled={loading}>
            Clear Filters
          </button>
        </div>
      </form>

      <div className="section-title no-print">
        <h3>Saved Operation Tickets</h3>
        <p>
          Filters are live. The list updates automatically when you change search, date range, operation type, location, asset, or status.
        </p>
      </div>

      {/* ------------------------------------------------- bulk action toolbar */}
      {canBulkAct && (
        <div className="task-bulk-toolbar no-print">
          <div>
            <strong>
              {selectedCount === 0
                ? 'Select tickets to act on several at once'
                : `${selectedCount} ticket${selectedCount === 1 ? '' : 's'} selected`}
            </strong>
            <span>
              {selectedCount === 0
                ? 'Use the checkboxes in the table. A selection is kept while you change pages.'
                : 'Each ticket is processed separately and keeps its own audit trail.'}
            </span>
          </div>
          <div className="form-actions">
            {BULK_ACTION_ORDER.filter((key) => bulkPermissions[key]).map((key) => (
              <button
                key={key}
                type="button"
                className={key === 'reject' || key === 'cancel' ? 'btn-secondary' : undefined}
                onClick={() => openBulkAction(key)}
                disabled={selectedCount === 0 || loading || bulkRunning}
              >
                {BULK_ACTIONS[key].label} selected
              </button>
            ))}
            {selectedCount > 0 && (
              <>
                <ExportMenu
                  rows={selectedList}
                  columns={EXPORT_COLUMNS}
                  fileName="operation-transactions-selected"
                  title="Operation Transaction Register – selected tickets"
                  module="Operation Transaction Register"
                  label={`Export selected (${selectedCount})`}
                />
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={clearSelection}
                  disabled={bulkRunning}
                >
                  Clear selection
                </button>
              </>
            )}
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={selectAllMatchingFilters}
              disabled={selectingAll || loading || bulkRunning}
            >
              {selectingAll ? 'Selecting…' : 'Select all matching filters'}
            </button>
          </div>
        </div>
      )}

      <div className="info-box no-print">
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" disabled={loading || page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            Prev
          </button>
          <span>
            Page {page} / {totalPages}
          </span>
          <button type="button" disabled={loading || !hasMore} onClick={() => setPage((p) => p + 1)}>
            Next
          </button>
        </div>
        <div className="register-selection-summary">
          Showing {rows.length} of {totalRows} rows
          {selectedCount > 0 ? ` · ${selectedCount} selected across pages` : ''}
        </div>
      </div>

      <table>
        <thead>
          <tr>
            {canBulkAct && (
              <th className="task-select-col no-print">
                <input
                  ref={headerCheckboxRef}
                  type="checkbox"
                  aria-label="Select every actionable ticket on this page"
                  checked={allPageSelected}
                  disabled={pageSelectableRows.length === 0 || loading || bulkRunning}
                  onChange={(event) => toggleSelectAllOnPage(event.target.checked)}
                />
              </th>
            )}
            <th>Ticket Number</th>
            <th>Convoy Number</th>
            <th>Date</th>
            <th>Operation Type</th>
            <th>Location</th>
            <th>Primary Asset</th>
            <th>Field Count</th>
            <th>Status</th>
            <th>Created At</th>
            <th>Actions</th>
          </tr>
        </thead>

        <tbody>
          {loading ? (
            <tr>
              <td colSpan={canBulkAct ? 11 : 10} className="empty-table">
                Loading operation transactions...
              </td>
            </tr>
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={canBulkAct ? 11 : 10} className="empty-table">
                No operation transactions found.
              </td>
            </tr>
          ) : (
            rows.map((r) => {
              const selectable = isSelectable(r)
              return (
                <tr
                  key={r.id}
                  className={selectedIds.has(Number(r.id)) ? 'row-selected' : undefined}
                >
                  {canBulkAct && (
                    <td className="task-select-col no-print">
                      <input
                        type="checkbox"
                        aria-label={`Select ticket ${r.ticket_number || r.operation_number || r.id}`}
                        checked={selectedIds.has(Number(r.id))}
                        disabled={!selectable || bulkRunning}
                        onChange={(event) => toggleRowSelection(r, event.target.checked)}
                        title={
                          selectable
                            ? undefined
                            : `${r.status || 'This'} tickets cannot be submitted, approved or cancelled.`
                        }
                      />
                    </td>
                  )}
                  <td>
                    <strong>{r.ticket_number || r.operation_number || 'Ticket number not found'}</strong>
                  </td>
                  <td>{r.convoy_number || '-'}</td>
                  <td>{r.operation_date || '-'}</td>
                  <td>{r.operation_type_name || r.operation_type_code || '-'}</td>
                  <td>
                    {r.location_name ? `${r.location_name} (${r.location_code || r.origin_location_code || ''})` : (r.location_code || r.origin_location_code || '-')}
                  </td>
                  <td>
                    {r.primary_asset_name ? `${r.primary_asset_name} (${r.primary_asset_code || ''})` : (r.primary_asset_code || '-')}
                  </td>
                  <td>
                    <span className="permission-badge">{Number(r.field_count || 0)} Fields</span>
                  </td>
                  <td>
                    <span className={`status-badge ${String(r.status || '').toLowerCase()}`}>
                      {r.status || '-'}
                    </span>
                  </td>
                  <td>{r.created_at || '-'}</td>
                  <td>
                    <Link to={`/operation-transactions/${r.id}`}>
                      <button type="button">View</button>
                    </Link>
                  </td>
                </tr>
              )
            })
          )}
        </tbody>
      </table>

      <div className="info-box no-print">
        This register uses server-side paging and status counts. Export CSV downloads directly from the backend using the selected filters.
      </div>

      {/* ------------------------------------------------------- bulk dialog */}
      <Modal
        open={Boolean(bulkAction)}
        title={bulkAction ? `${bulkAction.label} selected tickets` : 'Bulk action'}
        description={
          bulkAction
            ? `${selectedCount} ticket${selectedCount === 1 ? '' : 's'} selected · each ticket keeps its own status history and audit entry.`
            : ''
        }
        onClose={closeBulkDialog}
        size="lg"
        className="bulk-approval-dialog-modal"
        footer={
          <>
            <button
              type="button"
              className="btn-secondary"
              onClick={closeBulkDialog}
              disabled={bulkRunning}
            >
              {bulkResults.length > 0 ? 'Close' : 'Cancel'}
            </button>
            <button
              type="button"
              className={bulkAction?.tone === 'danger' ? 'btn-danger' : 'btn-primary'}
              onClick={runBulkAction}
              disabled={bulkConfirmDisabled}
            >
              {bulkRunning
                ? `Processing ${bulkProgress.done} of ${bulkProgress.total}…`
                : `${bulkAction?.confirmLabel || 'Confirm'}${eligibleSelected.length > 0 ? ` (${eligibleSelected.length})` : ''}`}
            </button>
          </>
        }
      >
        {bulkAction && (
          <div className="bulk-approval-dialog">
            <div className="info-box">
              Every ticket is {bulkAction.pastTense} separately through the workflow API, so the
              server still checks permissions, workflow policy and the allowed status transition
              for each one. If a ticket fails, the remaining tickets are still processed and the
              result of every ticket is listed below.
            </div>

            {ineligibleSelected.length > 0 && (
              <AlertMessage
                tone="warning"
                compact
                message={`${ineligibleSelected.length} selected ticket(s) cannot be ${bulkAction.pastTense} because of their current status: ${ineligibleSelected
                  .map((row) => `${row.ticket_number || row.operation_number || row.id} (${row.status})`)
                  .slice(0, 6)
                  .join(', ')}${ineligibleSelected.length > 6 ? ' …' : ''}. They will be left untouched.`}
              />
            )}

            <label htmlFor="bulk-register-remarks">
              {bulkAction.remarksRequired ? 'Remarks (required)' : 'Shared remarks'}
            </label>
            <textarea
              id="bulk-register-remarks"
              rows="4"
              value={bulkRemarks}
              onChange={(event) => setBulkRemarks(event.target.value)}
              placeholder={
                bulkAction.remarksRequired
                  ? `Explain why these tickets are being ${bulkAction.pastTense}`
                  : `For example: reviewed and ${bulkAction.pastTense} for the shift`
              }
              disabled={bulkRunning}
            />
            {!bulkAction.remarksRequired && (
              <p className="muted-table-text">
                If left blank, “{bulkAction.defaultRemarks}” will be recorded against every ticket.
              </p>
            )}

            {bulkAction.reviewConfirmation && (
              <label className="import-option">
                <input
                  type="checkbox"
                  checked={bulkReviewConfirmed}
                  onChange={(event) => setBulkReviewConfirmed(event.target.checked)}
                  disabled={bulkRunning}
                />
                <span>
                  I have reviewed the entered data of every selected ticket and understand that
                  they will all be {bulkAction.pastTense} together.
                </span>
              </label>
            )}

            <div className="bulk-approval-list">
              {eligibleSelected.map((row) => (
                <div key={row.id}>
                  <strong>{row.ticket_number || row.operation_number || `#${row.id}`}</strong>
                  <span>
                    {row.primary_asset_code || '-'} · {row.location_code || '-'} · {row.status}
                  </span>
                </div>
              ))}
            </div>

            {bulkRunning && (
              <div className="import-progress" aria-live="polite">
                <div
                  className="import-progress-bar"
                  style={{
                    width: `${
                      bulkProgress.total
                        ? Math.round((bulkProgress.done / bulkProgress.total) * 100)
                        : 0
                    }%`,
                  }}
                />
                <span>
                  Processing {bulkProgress.done} of {bulkProgress.total}…
                </span>
              </div>
            )}

            {bulkResults.length > 0 && (
              <div className="import-preview-scroll import-results">
                <table>
                  <thead>
                    <tr>
                      <th>Ticket</th>
                      <th>Result</th>
                      <th>Message</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bulkResults.map((item) => (
                      <tr key={item.id}>
                        <td>{item.ticketNumber}</td>
                        <td>
                          <span
                            className={`status-badge ${
                              item.status === 'success' ? 'approved' : 'rejected'
                            }`}
                          >
                            {item.status === 'success' ? bulkAction.nextStatus : 'Failed'}
                          </span>
                        </td>
                        <td>{item.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {bulkResults.length > 0 && (
              <AlertMessage
                tone="info"
                compact
                message="Tickets that succeeded have left the selection. Failed tickets stay selected so they can be retried or opened individually."
              />
            )}
          </div>
        )}
      </Modal>

      {profile && (
        <div className="print-only print-footnote">
          <p>{profile.footerFormula}</p>
          <p>{profile.footerNote}</p>
        </div>
      )}
    </div>
  )
}

export default OperationTransactionRegister
