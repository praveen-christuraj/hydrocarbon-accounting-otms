import { useEffect, useMemo, useState } from 'react'
import {
  getOutTurnSummary,
  getOutTurnSummaryConfig,
  saveOutTurnSummaryConfig,
} from '../api/outTurnSummaryApi'
import { getCompanyReportProfiles } from '../api/companyReportProfileApi'
import PaginationControls, {
  paginateRows,
} from '../components/common/PaginationControls'

const COLUMN_GROUPS = ['Base', 'Input', 'Calculated', 'Computed']

function OutTurnSummary({ locations, assets, loggedInUser }) {
  const emptyFilters = {
    locationCode: '',
    tankAssetCode: '',
    productName: '',
    dateFrom: '',
    dateTo: '',
  }

  const isAdminBootstrap =
    String(loggedInUser?.username || '').toLowerCase() === 'admin'

  const hasPermission = (permissionName) => {
    if (isAdminBootstrap) return true
    if (!loggedInUser || !Array.isArray(loggedInUser.permissions)) return false
    return loggedInUser.permissions.some(
      (p) => p.permissionName === permissionName
    )
  }

  const canManageColumns = hasPermission('Manage Out-Turn Summary')

  const [filters, setFilters] = useState(emptyFilters)
  const [rows, setRows] = useState([])
  const [configuredColumns, setConfiguredColumns] = useState([])
  const [availableColumns, setAvailableColumns] = useState([])
  const [loading, setLoading] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [successMsg, setSuccessMsg] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [profile, setProfile] = useState(null)

  const [showConfigModal, setShowConfigModal] = useState(false)
  const [configDraft, setConfigDraft] = useState([])
  const [savingConfig, setSavingConfig] = useState(false)

  const activeLocations = useMemo(() => {
    return (locations || []).filter((location) => location.status === 'Active')
  }, [locations])

  const activeTankAssets = useMemo(() => {
    return (assets || []).filter((asset) => {
      if (asset.status !== 'Active') {
        return false
      }

      if (filters.locationCode && asset.locationCode) {
        return asset.locationCode === filters.locationCode
      }

      return true
    })
  }, [assets, filters.locationCode])

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

      const [reportData, profiles] = await Promise.all([
        getOutTurnSummary(activeFilters),
        getCompanyReportProfiles(),
      ])

      const activeProfile = profiles.find((p) => p.status === 'Active') || profiles[0]
      setProfile(activeProfile)

      setRows(reportData.rows || [])
      setConfiguredColumns(reportData.columns || [])
      setAvailableColumns(reportData.availableColumns || [])
      setCurrentPage(1)
    } catch (error) {
      setErrorMsg(error.message)
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
      setErrorMsg(error.message)
    }
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
      setSuccessMsg('Out-Turn Summary column configuration saved for all users.')
    } catch (error) {
      setErrorMsg(error.message)
    } finally {
      setSavingConfig(false)
    }
  }

  const formatDateTime = (value) => {
    if (!value) {
      return '-'
    }

    const dateValue = new Date(value)

    if (Number.isNaN(dateValue.getTime())) {
      return value
    }

    return dateValue.toLocaleString()
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

  const isDateColumn = (col) => {
    return (
      col.includes('date') ||
      col.includes('datetime') ||
      col === 'created_at' ||
      col === 'operation_date' ||
      col === 'accounting_date'
    )
  }

  const renderCellValue = (col, value) => {
    if (value === null || value === undefined || value === '') {
      return '-'
    }

    if (
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

    if (isDateColumn(col)) {
      return formatDateTime(value)
    }

    return value
  }

  const visibleRows = paginateRows(rows, currentPage)

  const escapeCsvValue = (value) => {
    if (value === null || value === undefined) {
      return ''
    }

    const text = String(value)

    if (
      text.includes(',') ||
      text.includes('"') ||
      text.includes('\n') ||
      text.includes('\r')
    ) {
      return `"${text.replace(/"/g, '""')}"`
    }

    return text
  }

  const downloadCsv = (filename, headers, dataRows) => {
    const csvLines = [
      headers.map(escapeCsvValue).join(','),
      ...dataRows.map((row) => row.map(escapeCsvValue).join(',')),
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
      setErrorMsg('No Out-Turn Summary rows available to export')
      return
    }

    if (enabledColumns.length === 0) {
      setErrorMsg('No columns are enabled for export. Enable at least one column.')
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
      setErrorMsg('No Out-Turn Summary rows available to print')
      return
    }

    window.print()
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
            operation, and net receipt/dispatch values computed per tank/product.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span className="record-count">{rows.length} Summary Rows</span>
          {canManageColumns && (
            <button type="button" onClick={openConfigModal} disabled={loading}>
              Configure Columns
            </button>
          )}
        </div>
      </div>

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
          <label>Operation Date From</label>
          <input
            name="dateFrom"
            type="date"
            value={filters.dateFrom}
            onChange={handleFilterChange}
            disabled={loading}
          />
        </div>

        <div>
          <label>Operation Date To</label>
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

      <div className="section-title">
        <h3>Out-Turn Summary</h3>
        <p>
          Rows are ordered chronologically. Previous stock is the prior ticket of
          the same location/tank/product; net receipt and net dispatch are derived
          from the difference between consecutive stock snapshots.
        </p>
      </div>

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
        totalRows={rows.length}
        onPageChange={setCurrentPage}
      />

      <div className="info-box">
        Out-Turn Summary shows approved Tank Gauging tickets in chronological
        order. Receipt and dispatch quantities are calculated by comparing the
        current stock snapshot with the previous chronological stock snapshot for
        the same location/tank/product.
      </div>

      {profile && (
        <div className="print-only" style={{ marginTop: 20, fontSize: 11, color: '#555' }}>
          <p>{profile.footerFormula}</p>
          <p>{profile.footerNote}</p>
        </div>
      )}

      {successMsg && (
        <div className="success-box" onClick={() => setSuccessMsg('')}>
          {successMsg}
        </div>
      )}
      {errorMsg && (
        <div className="error-box" onClick={() => setErrorMsg('')}>{
          errorMsg
        }</div>
      )}

      {showConfigModal && (
        <div className="modal-overlay" onClick={() => setShowConfigModal(false)}>
          <div
            className="column-config-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h3>Configure Out-Turn Summary Columns</h3>
              <button
                type="button"
                className="modal-close"
                onClick={() => setShowConfigModal(false)}
              >
                &times;
              </button>
            </div>

            <p className="modal-description">
              These columns are applied to the Out-Turn Summary report for all
              users. Toggle visibility and reorder columns within each group.
            </p>

            <div className="column-config-groups">
              {COLUMN_GROUPS.map((group) => {
                const groupColumns = columnsByGroup[group] || []

                if (groupColumns.length === 0) {
                  return null
                }

                return (
                  <div key={group} className="column-config-group">
                    <h4>{group} Columns</h4>

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
                          >
                            &uarr;
                          </button>
                          <button
                            type="button"
                            onClick={() => moveColumn(group, index, 1)}
                            disabled={index === groupColumns.length - 1}
                          >
                            &darr;
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>

            <div className="modal-actions">
              <button
                type="button"
                onClick={() => setShowConfigModal(false)}
                disabled={savingConfig}
              >
                Cancel
              </button>
              <button
                type="button"
                className="primary-action"
                onClick={handleSaveConfig}
                disabled={savingConfig}
              >
                {savingConfig ? 'Saving...' : 'Save Configuration'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default OutTurnSummary
