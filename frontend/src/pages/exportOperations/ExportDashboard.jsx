import { useCallback, useEffect, useMemo, useState } from 'react'
import { getExportDashboard } from '../../api/exportOperationsApi'
import PageHeader from '../../components/common/PageHeader'
import AlertMessage from '../../components/common/AlertMessage'
import Icon from '../../components/common/Icon'
import { logUiAction } from '../../utils/actionLogger'
import { EXPORT_MODULE, codeOptions, fmt, useExportReferenceData } from './exportShared'

const EMPTY_FILTERS = { location_code: '', entity_code: '', block_code: '', quarter: '', from_date: '', to_date: '' }

function ExportDashboard() {
  const reference = useExportReferenceData(['locations', 'entities', 'blocks'])
  const { locations, entities, blocks } = reference.data
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [dashboard, setDashboard] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async (activeFilters) => {
    setLoading(true)
    setError('')
    try {
      const params = Object.fromEntries(Object.entries(activeFilters).filter(([, value]) => value))
      setDashboard(await getExportDashboard(params))
    } catch (err) {
      setError(err.message || 'Unable to load the export dashboard.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    getExportDashboard({})
      .then((data) => {
        if (!cancelled) setDashboard(data)
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Unable to load the export dashboard.')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const quarters = useMemo(
    () => [...new Set((dashboard?.blocks_summary || []).map((row) => row.quarter).filter(Boolean))].sort().reverse(),
    [dashboard]
  )

  const blockColumns = useMemo(
    () => [...new Set((dashboard?.blocks_summary || []).map((row) => row.block_code))].sort(),
    [dashboard]
  )

  const groupedRows = useMemo(() => {
    const groups = {}
    for (const row of dashboard?.blocks_summary || []) {
      const key = `${row.location_code}|${row.entity_code}|${row.quarter}`
      if (!groups[key]) {
        groups[key] = {
          key,
          location_name: row.location_name,
          entity_name: row.entity_name,
          quarter: row.quarter,
          permit_count: 0,
          total_export: 0,
          total_permit: 0,
          blocks: {},
        }
      }
      groups[key].blocks[row.block_code] = row
      groups[key].permit_count += row.permit_count
      groups[key].total_export += row.export_volume
      groups[key].total_permit += row.permit_volume
    }
    return Object.values(groups)
  }, [dashboard])

  const threshold = dashboard?.insufficient_threshold_pct || 90
  const totals = groupedRows.reduce(
    (acc, row) => ({ export: acc.export + row.total_export, permit: acc.permit + row.total_permit }),
    { export: 0, permit: 0 }
  )

  const setFilter = (key, value) => setFilters((current) => ({ ...current, [key]: value }))
  const applyFilters = () => {
    logUiAction(EXPORT_MODULE, 'Refresh Export Dashboard', filters)
    load(filters)
  }
  const clearFilters = () => {
    setFilters(EMPTY_FILTERS)
    load(EMPTY_FILTERS)
  }

  return (
    <div className="export-operations-page">
      <PageHeader
        title="Export Dashboard"
        description="Export volumes against permits by location, entity, block and quarter."
        actions={
          <button type="button" className="btn-secondary" onClick={applyFilters} disabled={loading}>
            <Icon name="refresh" size={15} />
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        }
      />

      <AlertMessage tone="error" message={error || reference.error} onDismiss={() => setError('')} />

      <div className="report-filter-panel compact-filter-panel no-print">
        <div>
          <label htmlFor="xd-location">Location</label>
          <select id="xd-location" value={filters.location_code} onChange={(e) => setFilter('location_code', e.target.value)}>
            <option value="">All</option>
            {codeOptions(locations, 'location_name', 'location_code')}
          </select>
        </div>
        <div>
          <label htmlFor="xd-entity">Entity</label>
          <select id="xd-entity" value={filters.entity_code} onChange={(e) => setFilter('entity_code', e.target.value)}>
            <option value="">All</option>
            {codeOptions(entities, 'entity_name', 'entity_code')}
          </select>
        </div>
        <div>
          <label htmlFor="xd-block">Block</label>
          <select id="xd-block" value={filters.block_code} onChange={(e) => setFilter('block_code', e.target.value)}>
            <option value="">All</option>
            {codeOptions(blocks, 'block_name', 'block_code')}
          </select>
        </div>
        <div>
          <label htmlFor="xd-quarter">Quarter</label>
          <select id="xd-quarter" value={filters.quarter} onChange={(e) => setFilter('quarter', e.target.value)}>
            <option value="">All</option>
            {quarters.map((quarter) => (
              <option key={quarter} value={quarter}>
                {quarter}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="xd-from">BL Date From</label>
          <input id="xd-from" type="date" value={filters.from_date} onChange={(e) => setFilter('from_date', e.target.value)} />
        </div>
        <div>
          <label htmlFor="xd-to">BL Date To</label>
          <input id="xd-to" type="date" value={filters.to_date} onChange={(e) => setFilter('to_date', e.target.value)} />
        </div>
        <div className="report-filter-actions">
          <button type="button" className="btn-primary" onClick={applyFilters} disabled={loading}>
            Apply
          </button>
          <button type="button" className="btn-secondary" onClick={clearFilters} disabled={loading}>
            Clear
          </button>
        </div>
      </div>

      {dashboard && (
        <>
          {dashboard.permit_insufficient_count > 0 && (
            <AlertMessage
              tone="warning"
              title="Permit insufficiency"
              message={`${dashboard.permit_insufficient_count} permit(s) exceed ${threshold}% usage. Supplementary permits may be required.`}
            />
          )}

          <div className="summary-card-grid compact-summary-grid">
            <div className="summary-card">
              <span>Export Volume</span>
              <strong>{fmt(totals.export)}</strong>
            </div>
            <div className="summary-card">
              <span>Permit Volume</span>
              <strong>{fmt(totals.permit)}</strong>
            </div>
            <div className="summary-card">
              <span>Usage</span>
              <strong>{totals.permit ? `${fmt((totals.export / totals.permit) * 100, 1)}%` : '—'}</strong>
            </div>
            <div className="summary-card warning-summary-card">
              <span>Permits Above {threshold}%</span>
              <strong>{dashboard.permit_insufficient_count || 0}</strong>
            </div>
          </div>

          <div className="section-title">
            <h3>Blocks Summary</h3>
            <p>Export / permit volume per block. Highlighted cells are at or above the {threshold}% threshold.</p>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Location</th>
                  <th>Entity</th>
                  <th>Quarter</th>
                  <th>Permits</th>
                  {blockColumns.map((code) => (
                    <th key={code} colSpan={2}>
                      {code}
                      <span className="th-subtitle">Export / Permit</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groupedRows.length === 0 ? (
                  <tr>
                    <td colSpan={4 + blockColumns.length * 2} className="empty-table">
                      No export data for the selected filters.
                    </td>
                  </tr>
                ) : (
                  groupedRows.map((row) => (
                    <tr key={row.key}>
                      <td>{row.location_name}</td>
                      <td>{row.entity_name || '—'}</td>
                      <td>{row.quarter || '—'}</td>
                      <td>{row.permit_count}</td>
                      {blockColumns.flatMap((code) => {
                        const block = row.blocks[code]
                        const high = block && block.usage_pct >= threshold
                        return [
                          <td key={`${code}-export`} className={high ? 'cell-warning' : undefined}>
                            {block ? fmt(block.export_volume) : '—'}
                          </td>,
                          <td key={`${code}-permit`} className="cell-muted">
                            {block ? fmt(block.permit_volume) : '—'}
                          </td>,
                        ]
                      })}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="section-title">
            <h3>Recent Exports</h3>
            <p>Last 10 export transactions.</p>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>BL Date</th>
                  <th>Vessel</th>
                  <th>Location</th>
                  <th>Entity</th>
                  <th>Block</th>
                  <th>Volume</th>
                  <th>Consignee</th>
                  <th>Quarter</th>
                </tr>
              </thead>
              <tbody>
                {(dashboard.recent_exports || []).length === 0 ? (
                  <tr>
                    <td colSpan={8} className="empty-table">
                      No recent exports.
                    </td>
                  </tr>
                ) : (
                  dashboard.recent_exports.map((tx) => (
                    <tr key={tx.id}>
                      <td>{tx.bl_date}</td>
                      <td>{tx.vessel_name || '—'}</td>
                      <td>{tx.location_name || tx.location_code}</td>
                      <td>{tx.entity_name || tx.entity_code}</td>
                      <td>{tx.block_name || tx.block_code}</td>
                      <td>{fmt(tx.volume)}</td>
                      <td>{tx.consignee}</td>
                      <td>{tx.quarter}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

export default ExportDashboard
