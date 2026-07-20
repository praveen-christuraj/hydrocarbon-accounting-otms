import { useEffect, useMemo, useState } from 'react'
import {
  getFlowmeterRecords,
} from '../api/flowmeterApi'

function FlowmeterRecordEntry({ locations = [], assets = [] }) {
  const [rows, setRows] = useState([])
  const [filters, setFilters] = useState({
    locationCode: '',
    assetCode: '',
    streamName: '',
    meterLabel: '',
    dateFrom: '',
    dateTo: '',
  })
  const [loading, setLoading] = useState(false)
  const [lastAppliedAt, setLastAppliedAt] = useState('')
  const [printedAt] = useState(() => new Date().toLocaleString())
  const [successMsg, setSuccessMsg] = useState('')
  const [errorMsg, setErrorMsg] = useState('')

  const flowmeterAssets = useMemo(() => {
    return (assets || []).filter((a) => String(a.status || '').toLowerCase() === 'active')
  }, [assets])

  const loadRecords = async (appliedFilters = filters) => {
    try {
      setLoading(true)
      const recordRows = await getFlowmeterRecords(appliedFilters)
      setRows(recordRows)
      setLastAppliedAt(new Date().toLocaleString())
    } catch (error) {
      setErrorMsg(error?.message || 'Failed to load flowmeter records')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadRecords()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      loadRecords(filters)
    }, 250)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters])

  const exportCsv = () => {
    if (!rows.length) {
      setErrorMsg('No rows available to export.')
      return
    }

    const headers = [
      'Date',
      'Location',
      'Asset',
      'Stream',
      'Meter',
      'Opening',
      'Closing',
      'Gross',
      'Factor',
      'Unit',
      'Net Std',
      'Net Std (bbl)',
    ]

    const escapeCell = (value) => {
      const raw = String(value ?? '')
      return /[",\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw
    }

    const lines = [
      headers.join(','),
      ...rows.map((r) =>
        [
          r.readingDate,
          r.locationName || r.locationCode,
          r.assetName || r.assetCode,
          r.streamName || 'Default',
          r.meterLabel,
          r.openingReading,
          r.closingReading,
          r.grossObserved,
          r.meterFactor,
          r.meterUnit,
          r.netStandard,
          r.netStandardBbl,
        ]
          .map(escapeCell)
          .join(',')
      ),
    ]

    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `flowmeter-records-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <div className="print-only mtr-page">
        <div className="mtr-header">
          <h1>FLOWMETER RECORDS REPORT</h1>
          <div className="mtr-sub">
            <div><strong>Location:</strong> {filters.locationCode || 'All'}</div>
            <div><strong>Flowmeter Asset:</strong> {filters.assetCode || 'All'}</div>
            <div><strong>Stream:</strong> {filters.streamName || 'All'}</div>
            <div><strong>Meter Label:</strong> {filters.meterLabel || 'All'}</div>
            <div><strong>Date From:</strong> {filters.dateFrom || '-'}</div>
            <div><strong>Date To:</strong> {filters.dateTo || '-'}</div>
            <div><strong>Printed:</strong> {printedAt}</div>
          </div>
        </div>

        <table className="mtr-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Location</th>
              <th>Asset</th>
              <th>Stream</th>
              <th>Meter</th>
              <th>Opening</th>
              <th>Closing</th>
              <th>Gross</th>
              <th>Factor</th>
              <th>Unit</th>
              <th>Net Std</th>
              <th>Net Std (bbl)</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan="12">No records found.</td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={`print-${r.id}`}>
                  <td>{r.readingDate}</td>
                  <td>{r.locationName || r.locationCode}</td>
                  <td>{r.assetName || r.assetCode}</td>
                  <td>{r.streamName || 'Default'}</td>
                  <td>{r.meterLabel}</td>
                  <td>{r.openingReading}</td>
                  <td>{r.closingReading}</td>
                  <td>{r.grossObserved}</td>
                  <td>{r.meterFactor}</td>
                  <td>{r.meterUnit}</td>
                  <td>{r.netStandard}</td>
                  <td>{r.netStandardBbl}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div>
      {successMsg && (
        <div className="success-box" onClick={() => setSuccessMsg('')}>
          {successMsg}
        </div>
      )}
      {errorMsg && (
        <div className="error-box" onClick={() => setErrorMsg('')}>
          {errorMsg}
        </div>
      )}
      <div className="page-title">
        <div>
          <h2>Flowmeter Records</h2>
          <p>Approved records only, reflected from saved Operation Entry tickets (Meter Reading layout).</p>
        </div>
      </div>

      <div className="report-filter-panel no-print">
        <div>
          <label>Location</label>
          <select value={filters.locationCode} onChange={(e) => setFilters((p) => ({ ...p, locationCode: e.target.value }))}>
            <option value="">All Locations</option>
            {locations.map((l) => (
              <option key={l.locationCode} value={l.locationCode}>{l.locationName} ({l.locationCode})</option>
            ))}
          </select>
        </div>

        <div>
          <label>Flowmeter Asset</label>
          <select value={filters.assetCode} onChange={(e) => setFilters((p) => ({ ...p, assetCode: e.target.value }))}>
            <option value="">All Flowmeter Assets</option>
            {flowmeterAssets.map((a) => (
              <option key={a.assetCode} value={a.assetCode}>{a.assetName} ({a.assetCode})</option>
            ))}
          </select>
        </div>

        <div>
          <label>Stream</label>
          <input
            value={filters.streamName}
            onChange={(e) => setFilters((p) => ({ ...p, streamName: e.target.value }))}
            placeholder="All streams"
          />
        </div>

        <div>
          <label>Meter Label</label>
          <input
            value={filters.meterLabel}
            onChange={(e) => setFilters((p) => ({ ...p, meterLabel: e.target.value }))}
            placeholder="Optional meter label filter"
          />
        </div>

        <div>
          <label>Date From</label>
          <input type="date" value={filters.dateFrom} onChange={(e) => setFilters((p) => ({ ...p, dateFrom: e.target.value }))} />
        </div>

        <div>
          <label>Date To</label>
          <input type="date" value={filters.dateTo} onChange={(e) => setFilters((p) => ({ ...p, dateTo: e.target.value }))} />
        </div>
      </div>

      <div className="report-actions no-print">
        <button type="button" onClick={() => loadRecords(filters)}>Refresh</button>
        <button
          type="button"
          onClick={() => {
            const clear = { locationCode: '', assetCode: '', meterLabel: '', dateFrom: '', dateTo: '' }
            clear.streamName = ''
            setFilters(clear)
            loadRecords(clear)
          }}
        >
          Clear Filters
        </button>
        <button type="button" onClick={exportCsv} disabled={loading || rows.length === 0}>Export CSV</button>
        <button type="button" onClick={() => window.print()} disabled={loading}>Print</button>
      </div>

      <div className="info-box no-print">
        Live filters are enabled. Last refresh: {lastAppliedAt || '-'}.
      </div>

      <div className="section-title">
        <h3>Recent Records</h3>
      </div>

      {loading ? (
        <div className="info-box">Loading...</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Location</th>
              <th>Asset</th>
              <th>Stream</th>
              <th>Meter</th>
              <th>Opening</th>
              <th>Closing</th>
              <th>Gross</th>
              <th>Factor</th>
              <th>Unit</th>
              <th>Net Std</th>
              <th>Net Std (bbl)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.readingDate}</td>
                <td>{r.locationName || r.locationCode}</td>
                <td>{r.assetName || r.assetCode}</td>
                <td>{r.streamName || 'Default'}</td>
                <td>{r.meterLabel}</td>
                <td>{r.openingReading}</td>
                <td>{r.closingReading}</td>
                <td>{r.grossObserved}</td>
                <td>{r.meterFactor}</td>
                <td>{r.meterUnit}</td>
                <td>{r.netStandard}</td>
                <td>{r.netStandardBbl}</td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={12}>No records found.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      )}
      </div>
    </>
  )
}

export default FlowmeterRecordEntry
