import { useEffect, useMemo, useState } from 'react'
import {
  getOutTurnSummary,
  getOutTurnSummaryConfig,
  saveOutTurnSummaryConfig,
} from '../api/outTurnSummaryApi'
import { useCompanyPrintProfile } from '../hooks/useCompanyPrintProfile'
import { usePrintDialog } from '../components/print/printProfileContext'
import { logUiAction } from '../utils/actionLogger'
import PaginationControls, { paginateRows, usePageSize } from '../components/common/PaginationControls'
import DataTableToolbar from '../components/common/DataTableToolbar'
import { useDataFilters } from '../hooks/useDataFilters'
import { useAutoColumns } from '../hooks/useAutoColumns'
import Modal from '../components/common/Modal'
import AlertMessage from '../components/common/AlertMessage'
import useActionFeedback from '../hooks/useActionFeedback'
import { escapeCsvCell } from '../utils/exportUtils'
import {
  formatCalendarDate,
  formatDateTime as formatSafeDateTime,
  formatGaugingTime,
} from '../utils/format'

const COLUMN_GROUPS = ['Base', 'Input', 'Calculated', 'Computed']

function OutTurnSummary({ locations, assets, loggedInUser }) {
  const profile = useCompanyPrintProfile()
  const { requestPrint } = usePrintDialog()

  const emptyFilters = {
    locationCode: '',
    tankAssetCode: '',
    productName: '',
    dateFrom: '',
    dateTo: '',
  }

  const isAdminBootstrap =
    loggedInUser?.isAdmin === true ||
    (Array.isArray(loggedInUser?.roles) && loggedInUser.roles.some((role) =>
      String(role?.role_name || role?.roleName || '').trim().toLowerCase() === 'admin'
    ))

  const hasPermission = (permissionName) => {
    if (isAdminBootstrap) return true
    if (!loggedInUser || !Array.isArray(loggedInUser.permissions)) return false
    return loggedInUser.permissions.some(
      (p) => p.permissionName === permissionName
    )
  }

  const canManageColumns = hasPermission('Edit Out-Turn Summary')

  const [filters, setFilters] = useState(emptyFilters)
  const [rows, setRows] = useState([])
  const [reportMeta, setReportMeta] = useState(null)
  const [configuredColumns, setConfiguredColumns] = useState([])
  const [availableColumns, setAvailableColumns] = useState([])
  const [loading, setLoading] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const pageSize = usePageSize()
  // Action feedback: little pop-up (toast) + inline message near the
  // action area (owner rule 8) - never at the bottom of the page.
  const feedback = useActionFeedback()
  const { notifySuccess, notifyError, clearSuccess, clearError } = feedback
  const [showConfigModal, setShowConfigModal] = useState(false)
  const [configDraft, setConfigDraft] = useState([])
  const [savingConfig, setSavingConfig] = useState(false)
  const hasAllLocationsAccess = loggedInUser?.allLocationsAccess === 'Yes'
  const normalizeCode = (value) => String(value ?? '').trim().toLowerCase()
  const scopedLocationCodeSet = useMemo(() => {
    return new Set(
      (loggedInUser?.assignedLocationCodes || [])
        .map(normalizeCode)
        .filter(Boolean)
    )
  }, [loggedInUser])

  const activeLocations = useMemo(() => {
    const statusFiltered = (locations || []).filter(
      (location) => location.status === 'Active'
    )
    if (isAdminBootstrap || hasAllLocationsAccess) {
      return statusFiltered
    }
    return statusFiltered.filter((location) =>
      scopedLocationCodeSet.has(normalizeCode(location.locationCode))
    )
  }, [
    locations,
    isAdminBootstrap,
    hasAllLocationsAccess,
    scopedLocationCodeSet,
  ])

  const activeTankAssets = useMemo(() => {
    return (assets || []).filter((asset) => {
      if (asset.status !== 'Active') {
        return false
      }

      if (
        !isAdminBootstrap &&
        !hasAllLocationsAccess &&
        asset.locationCode &&
        !scopedLocationCodeSet.has(normalizeCode(asset.locationCode))
      ) {
        return false
      }

      if (filters.locationCode && asset.locationCode) {
        return asset.locationCode === filters.locationCode
      }

      return true
    })
  }, [
    assets,
    filters.locationCode,
    isAdminBootstrap,
    hasAllLocationsAccess,
    scopedLocationCodeSet,
  ])

  const enabledColumns = useMemo(() => {
    return (configuredColumns || []).filter((col) => col.enabled)
  }, [configuredColumns])

  const columnsByGroup = useMemo(() => {
    const grouped = {}

    for (const group of COLUMN_GROUPS) {
      grouped[group] = []
    }

    for (const col of configDraft) {
      const group = COLUMN_GROUPS.includes(col.group) ? col.group : 'Base'

      if (!grouped[group]) {
        grouped[group] = []
      }

      grouped[group].push(col)
    }

    for (const group of COLUMN_GROUPS) {
      grouped[group].sort((a, b) => (a.order || 0) - (b.order || 0))
    }

    return grouped
  }, [configDraft])

  const loadReport = async (activeFilters = filters) => {
    try {
      setLoading(true)

      const reportData = await getOutTurnSummary(activeFilters)

      setRows(reportData.rows || [])
      setConfiguredColumns(reportData.columns || [])
      setAvailableColumns(reportData.availableColumns || [])
      setReportMeta(reportData)
      setCurrentPage(1)
    } catch (error) {
      notifyError(error.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadReport(emptyFilters)
  }, [])

  const openConfigModal = async () => {
    try {
      let savedConfig = []

      try {
        savedConfig = await getOutTurnSummaryConfig()
      } catch {
        savedConfig = []
      }

      const sourceList = savedConfig.length > 0 ? savedConfig : availableColumns

      const draft = sourceList.map((col, index) => ({
        key: col.key,
        label: col.label,
        group: col.group,
        enabled: col.enabled !== undefined ? col.enabled : true,
        order: col.order !== undefined ? col.order : index,
      }))

      setConfigDraft(draft)
      setShowConfigModal(true)
    } catch (error) {
      notifyError(error.message)
    }
  }

  const closeConfigModal = () => {
    if (savingConfig) return
    setShowConfigModal(false)
  }

  const toggleColumn = (key) => {
    setConfigDraft((prev) =>
      prev.map((col) =>
        col.key === key ? { ...col, enabled: !col.enabled } : col
      )
    )
  }

  const moveColumn = (group, index, direction) => {
    setConfigDraft((prev) => {
      const groupKeys = columnsByGroup[group].map((col) => col.key)
      const targetIndex = index + direction

      if (targetIndex < 0 || targetIndex >= groupKeys.length) {
        return prev
      }

      const reordered = [...groupKeys]
      const [moved] = reordered.splice(index, 1)
      reordered.splice(targetIndex, 0, moved)

      const orderByKey = {}
      reordered.forEach((key, order) => {
        orderByKey[key] = order
      })

      return prev.map((col) => ({
        ...col,
        order: orderByKey[col.key] !== undefined ? orderByKey[col.key] : col.order,
      }))
    })
  }

  const handleSaveConfig = async () => {
    try {
      setSavingConfig(true)

      const sorted = [...configDraft].sort(
        (a, b) => (a.order || 0) - (b.order || 0)
      )

      const saved = await saveOutTurnSummaryConfig(sorted)

      setConfiguredColumns(saved)

      setShowConfigModal(false)
      notifySuccess('Out-Turn Summary column configuration saved for all users.')
    } catch (error) {
      notifyError(error.message)
    } finally {
      setSavingConfig(false)
    }
  }

  const formatDateTime = (value) => {
    return formatSafeDateTime(value, '-')
  }

  const formatNumber = (value, decimals = 3) => {
    return Number(value || 0).toLocaleString(undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })
  }

  const isNumericValue = (value) => {
    if (typeof value === 'number') {
      return true
    }

    if (typeof value === 'string' && value.trim() === '') {
      return false
    }

    return !isNaN(Number(value))
  }

  const isCalendarDateColumn = (col) => {
    return (
      col === 'accounting_date' ||
      col === 'operation_date' ||
      col === 'gauging_date' ||
      col === 'input_gaugingDate' ||
      col === 'input_gauging_date' ||
      col.endsWith('Date')
    )
  }

  const isTimeOnlyColumn = (col) => {
    return (
      col === 'gauging_time' ||
      col === 'input_gaugingTime' ||
      col === 'input_gauging_time' ||
      col.endsWith('Time')
    )
  }

  const isDateTimeColumn = (col) => {
    return col.includes('datetime') || col === 'created_at' || col === 'updated_at'
  }

  const NON_NUMERIC_INPUT_COLS = new Set([
    'input_tankOperation',
    'input_ticketNumber',
    'input_operationNumber',
    'input_gaugingDate',
    'input_gaugingTime',
    'input_gauging_date',
    'input_gauging_time',
    'input_productName',
    'input_remarks',
    'input_tankTemperatureUnit',
    'input_observedDensityUnit',
  ])

  const renderCellValue = (col, value) => {
    if (value === null || value === undefined || value === '') {
      return '-'
    }

    if (isCalendarDateColumn(col)) {
      return formatCalendarDate(value)
    }

    if (isTimeOnlyColumn(col)) {
      return formatGaugingTime(value)
    }

    if (isDateTimeColumn(col)) {
      return formatDateTime(value)
    }

    if (
      !NON_NUMERIC_INPUT_COLS.has(col) &&
      isNumericValue(value) &&
      (col.startsWith('calc_') ||
        col.startsWith('input_') ||
        col.includes('_nsv') ||
        col.includes('_gsv') ||
        col.includes('_lt') ||
        col.includes('_mt') ||
        col.includes('_bbl'))
    ) {
      return formatNumber(value)
    }

    return value
  }

  const rowsFilters = useDataFilters(rows, useAutoColumns(rows), { module: 'Out-Turn Summary' })
  const visibleRows = paginateRows(rowsFilters.filteredRows, currentPage, pageSize)

  const downloadCsv = (filename, headers, dataRows) => {
    const csvLines = [
      headers.map(escapeCsvCell).join(','),
      ...dataRows.map((row) => row.map(escapeCsvCell).join(',')),
    ]

    const csvContent = csvLines.join('\n')
    const blob = new Blob([csvContent], {
      type: 'text/csv;charset=utf-8;',
    })

    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')

    link.href = url
    link.setAttribute('download', filename)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)

    URL.revokeObjectURL(url)
  }

  const handleExportCsv = () => {
    if (rows.length === 0) {
      notifyError('No Out-Turn Summary rows available to export')
      return
    }

    if (enabledColumns.length === 0) {
      notifyError('No columns are enabled for export. Enable at least one column.')
      return
    }

    const headers = enabledColumns.map((col) => col.label)
    const dataRows = rows.map((row) =>
      enabledColumns.map((col) => row[col.key])
    )

    downloadCsv('out-turn-summary.csv', headers, dataRows)
  }

  const handlePrintReport = () => {
    if (rows.length === 0) {
      notifyError('No Out-Turn Summary rows available to print')
      return
    }

    requestPrint({
      module: 'Out-Turn Summary',
      reportName: 'Out-Turn Summary',
      onBeforePrint: () => {
        logUiAction('Out-Turn Summary', 'Print Report', filters)
      },
    })
  }

  const handleFilterChange = (e) => {
    const { name, value } = e.target

    if (name === 'locationCode') {
      setFilters({
        ...filters,
        locationCode: value,
        tankAssetCode: '',
      })
      return
    }

    setFilters({
      ...filters,
      [name]: value,
    })
  }

  const handleApplyFilters = async (e) => {
    e.preventDefault()
    await loadReport(filters)
  }

  const handleClearFilters = async () => {
    setFilters(emptyFilters)
    await loadReport(emptyFilters)
  }

  return (
    <div className="out-turn-summary-page">
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
              <p>{profile.reportSubtitle || 'Out-Turn Summary'}</p>
            </div>
          </div>

          <div className="print-report-meta">
            <span>
              <strong>Location:</strong> {filters.locationCode || 'All Locations'}
            </span>
            <span>
              <strong>Tank:</strong> {filters.tankAssetCode || 'All Tanks'}
            </span>
            <span>
              <strong>Product:</strong> {filters.productName || 'All Products'}
            </span>
            <span>
              <strong>Date:</strong> {filters.dateFrom || '-'} to{' '}
              {filters.dateTo || '-'}
            </span>
            <span>
              <strong>Printed:</strong> {new Date().toLocaleString()}
            </span>
          </div>
        </div>
      )}

      <div className="page-title">
        <div>
          <h2>Out-Turn Summary</h2>
          <p>
            Chronological tank gauging tickets with previous stock, stock after
            operation, and net receipt/dispatch values computed per location/tank.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span className="record-count">
            {reportMeta && reportMeta.totalRows !== rows.length
              ? `${rows.length} of ${reportMeta.totalRows} Summary Rows`
              : `${rows.length} Summary Rows`}
          </span>
          {canManageColumns && (
            <button type="button" onClick={openConfigModal} disabled={loading}>
              Configure Columns
            </button>
          )}
        </div>
      </div>
      {/* Action feedback: right next to the page actions + a little pop-up
          toast - never at the bottom of the page (owner rule 8). */}
      <AlertMessage tone="success" message={feedback.successMsg} onDismiss={clearSuccess} />
      <AlertMessage tone="error" message={feedback.errorMsg} onDismiss={clearError} />

      <form onSubmit={handleApplyFilters} className="filter-panel">
        <div>
          <label>Location</label>
          <select
            name="locationCode"
            value={filters.locationCode}
            onChange={handleFilterChange}
            disabled={loading}
          >
            <option value="">All Locations</option>

            {activeLocations.map((location) => (
              <option key={location.id} value={location.locationCode}>
                {location.locationName} ({location.locationCode})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label>Tank Asset</label>
          <select
            name="tankAssetCode"
            value={filters.tankAssetCode}
            onChange={handleFilterChange}
            disabled={loading}
          >
            <option value="">All Tanks</option>

            {activeTankAssets.map((asset) => (
              <option key={asset.id} value={asset.assetCode}>
                {asset.assetName} ({asset.assetCode})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label>Product</label>
          <input
            name="productName"
            type="text"
            value={filters.productName}
            onChange={handleFilterChange}
            placeholder="Example: Crude Oil"
            disabled={loading}
          />
        </div>

        <div>
          <label>Accounting Date From</label>
          <input
            name="dateFrom"
            type="date"
            value={filters.dateFrom}
            onChange={handleFilterChange}
            disabled={loading}
          />
        </div>

        <div>
          <label>Accounting Date To</label>
          <input
            name="dateTo"
            type="date"
            value={filters.dateTo}
            onChange={handleFilterChange}
            disabled={loading}
          />
        </div>

        <div className="filter-actions">
          <button type="submit" disabled={loading}>
            {loading ? 'Loading...' : 'Apply'}
          </button>
        </div>

        <div className="filter-actions">
          <button type="button" onClick={handleClearFilters} disabled={loading}>
            Clear
          </button>
        </div>

        <div className="filter-actions">
          <button type="button" onClick={handleExportCsv} disabled={loading}>
            Export CSV
          </button>
        </div>

        <div className="filter-actions">
          <button type="button" onClick={handlePrintReport} disabled={loading}>
            Print Report
          </button>
        </div>
      </form>

      {reportMeta?.defaultWindowApplied && (
        <div className="info-box">
          Showing the most recent 90 days of data
          {reportMeta.appliedDateFrom
            ? ` (${reportMeta.appliedDateFrom} to ${reportMeta.appliedDateTo || 'latest'})`
            : ''}
          . To load older records, set Accounting Date From / To above and
          click Apply.
        </div>
      )}

      {reportMeta?.hasMore && (
        <div className="info-box">
          Only the first {rows.length} of {reportMeta.totalRows} matching
          rows were loaded. Narrow the location, tank or date range to see
          the rest.
        </div>
      )}

      <div className="section-title">
        <h3>Out-Turn Summary</h3>
        <p>
          Rows are ordered chronologically. Previous stock is the prior ticket of
          the same location/tank; net receipt and net dispatch are derived
          from the difference between consecutive stock snapshots. Product and
          date filters select displayed rows without changing the prior snapshot.
        </p>
      </div>

      <DataTableToolbar
        filters={rowsFilters}
        columns={rowsFilters.columns}
        exportFileName="out-turn-summary"
        exportTitle="Out-Turn Summary"
      />

      <div className="out-turn-summary-table-wrap">
        <table>
          <thead>
            <tr>
              {enabledColumns.map((col) => (
                <th key={col.key}>{col.label}</th>
              ))}
            </tr>
          </thead>

          <tbody>
            {visibleRows.length === 0 ? (
              <tr>
                <td colSpan={enabledColumns.length} className="empty-table">
                  No Out-Turn Summary rows found.
                </td>
              </tr>
            ) : (
              visibleRows.map((row, index) => (
                <tr key={row.transaction_id || index}>
                  {enabledColumns.map((col) => (
                    <td key={col.key}>{renderCellValue(col.key, row[col.key])}</td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <PaginationControls
        currentPage={currentPage}
        totalRows={rowsFilters.filteredRows.length}
        onPageChange={setCurrentPage}
      />

      <div className="info-box">
        Out-Turn Summary shows approved Tank Gauging tickets in chronological
        order. Receipt and dispatch quantities are calculated by comparing the
        current stock snapshot with the previous chronological stock snapshot for
        the same location/tank.
      </div>

      {profile && (
        <div className="print-only print-footnote">
          <p>{profile.footerFormula}</p>
          <p>{profile.footerNote}</p>
        </div>
      )}


      <Modal
        open={showConfigModal}
        title="Configure Out-Turn Summary Columns"
        description="These columns are applied to the Out-Turn Summary report for all users. Toggle visibility and reorder columns within each group."
        size="lg"
        onClose={closeConfigModal}
        footer={
          <>
            <button
              type="button"
              className="btn-secondary"
              onClick={closeConfigModal}
              disabled={savingConfig}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={handleSaveConfig}
              disabled={savingConfig}
            >
              {savingConfig ? 'Saving...' : 'Save Configuration'}
            </button>
          </>
        }
      >
        <div className="column-config-groups">
          {COLUMN_GROUPS.map((group) => {
            const groupColumns = columnsByGroup[group] || []

            if (groupColumns.length === 0) {
              return null
            }

            return (
              <section key={group} className="column-config-group">
                <h4 className="column-config-group-title">{group} Columns</h4>

                {groupColumns.map((col, index) => (
                  <div key={col.key} className="column-config-row">
                    <label className="column-config-check">
                      <input
                        type="checkbox"
                        checked={col.enabled}
                        onChange={() => toggleColumn(col.key)}
                      />
                      <span>{col.label}</span>
                      <code>{col.key}</code>
                    </label>

                    <div className="column-config-move">
                      <button
                        type="button"
                        onClick={() => moveColumn(group, index, -1)}
                        disabled={index === 0}
                        aria-label={`Move ${col.label} up`}
                      >
                        &uarr;
                      </button>
                      <button
                        type="button"
                        onClick={() => moveColumn(group, index, 1)}
                        disabled={index === groupColumns.length - 1}
                        aria-label={`Move ${col.label} down`}
                      >
                        &darr;
                      </button>
                    </div>
                  </div>
                ))}
              </section>
            )
          })}
        </div>
      </Modal>
    </div>
  )
}

export default OutTurnSummary
