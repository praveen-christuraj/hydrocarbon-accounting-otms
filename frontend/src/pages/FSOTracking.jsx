import { useMemo, useState } from 'react'
import {
  getFSOOTRReport,
  getFSOMaterialBalanceReport,
  getFSOOutturnReport,
  downloadFSOOTRXlsx,
  downloadFSOMaterialBalanceXlsx,
  downloadFSOOutturnXlsx,
} from '../api/fsoReportApi'

const downloadCsv = (filename, headers, rows) => {
  const escape = (v) => {
    const s = String(v ?? '')
    if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`
    return s
  }
  const lines = [headers.map(escape).join(',')]
  rows.forEach((r) => lines.push(headers.map((h) => escape(r[h])).join(',')))
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function FSOTracking({ locations = [], assets = [] }) {
  const [tab, setTab] = useState('OTR') // OTR | MB | OUTTURN
  const [loading, setLoading] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [validationErrors, setValidationErrors] = useState({})

  const [filters, setFilters] = useState({
    locationCode: '',
    fsoAssetCode: '',
    dateFrom: '',
    dateTo: '',
    shuttleNumber: '',
  })

  const [otr, setOtr] = useState(null)
  const [mb, setMb] = useState(null)
  const [outturn, setOutturn] = useState(null)

  const fsoAssets = useMemo(() => {
    return (assets || []).filter(
      (a) => String(a.assetTypeCode || '').toUpperCase() === 'FSO' && a.status === 'Active'
    )
  }, [assets])

  const requireBaseFilters = () => {
    const errors = {}
    if (!filters.locationCode) errors.locationCode = 'Location is required'
    if (!filters.fsoAssetCode) errors.fsoAssetCode = 'FSO Asset is required'
    if (!filters.dateFrom) errors.dateFrom = 'Date From is required'
    if (!filters.dateTo) errors.dateTo = 'Date To is required'
    setValidationErrors(errors)
    if (Object.keys(errors).length) return false
    return true
  }

  const runOTR = async () => {
    if (!requireBaseFilters()) return
    try {
      setLoading(true)
      const data = await getFSOOTRReport({
        location_code: filters.locationCode,
        fso_asset_code: filters.fsoAssetCode,
        date_from: filters.dateFrom,
        date_to: filters.dateTo,
        shuttle_number: filters.shuttleNumber || '',
      })
      setOtr(data)
    } catch (e) {
      setErrorMsg(e.message || 'Unable to load FSO OTR report')
    } finally {
      setLoading(false)
    }
  }

  const runMB = async () => {
    if (!requireBaseFilters()) return
    try {
      setLoading(true)
      const data = await getFSOMaterialBalanceReport({
        location_code: filters.locationCode,
        fso_asset_code: filters.fsoAssetCode,
        date_from: filters.dateFrom,
        date_to: filters.dateTo,
      })
      setMb(data)
    } catch (e) {
      setErrorMsg(e.message || 'Unable to load FSO Material Balance report')
    } finally {
      setLoading(false)
    }
  }

  const runOutturn = async () => {
    if (!requireBaseFilters()) return
    try {
      setLoading(true)
      const data = await getFSOOutturnReport({
        location_code: filters.locationCode,
        fso_asset_code: filters.fsoAssetCode,
        date_from: filters.dateFrom,
        date_to: filters.dateTo,
      })
      setOutturn(data)
    } catch (e) {
      setErrorMsg(e.message || 'Unable to load FSO Outturn report')
    } finally {
      setLoading(false)
    }
  }

  const exportOTRcsv = () => {
    if (!otr?.rows?.length) {
      setErrorMsg('No rows to export')
      return
    }
    const headers = [
      'ticket_number','accounting_date','operation_date','event_time',
      'operation_label','operation_sign','shuttle_number',
      'vessel_name','vessel_quantity_bbl',
      'opening_stock_bbl','opening_water_bbl','closing_stock_bbl','closing_water_bbl',
      'net_stock_bbl','net_water_bbl','movement_qty_bbl','variance_bbl',
      'source_shuttle_discharge_bbl','compare_variance_bbl','remarks',
    ]
    downloadCsv('fso_otr.csv', headers, otr.rows)
  }

  const exportMBcsv = () => {
    if (!mb?.rows?.length) {
      setErrorMsg('No rows to export')
      return
    }
    const headers = [
      'accounting_date','opening_stock_bbl','receipt_bbl','export_bbl',
      'book_closing_bbl','physical_closing_bbl','physical_closing_water_bbl','loss_gain_bbl',
    ]
    downloadCsv('fso_material_balance.csv', headers, mb.rows)
  }

  const exportOutturnCsv = () => {
    if (!outturn?.rows?.length) {
      setErrorMsg('No rows to export')
      return
    }
    const headers = [
      'accounting_date','shuttle_number',
      'shuttle_discharge_bbl','fso_receipt_bbl','variance_bbl','variance_pct',
    ]
    downloadCsv('fso_outturn.csv', headers, outturn.rows)
  }

  const printReport = () => window.print()

  const downloadOTRxlsx = async () => {
    if (!requireBaseFilters()) return
    try {
      setLoading(true)
      await downloadFSOOTRXlsx({
        location_code: filters.locationCode,
        fso_asset_code: filters.fsoAssetCode,
        date_from: filters.dateFrom,
        date_to: filters.dateTo,
        shuttle_number: filters.shuttleNumber || '',
      })
    } catch (e) {
      setErrorMsg(e.message || 'Unable to download excel')
    } finally {
      setLoading(false)
    }
  }

  const downloadMBxlsx = async () => {
    if (!requireBaseFilters()) return
    try {
      setLoading(true)
      await downloadFSOMaterialBalanceXlsx({
        location_code: filters.locationCode,
        fso_asset_code: filters.fsoAssetCode,
        date_from: filters.dateFrom,
        date_to: filters.dateTo,
      })
    } catch (e) {
      setErrorMsg(e.message || 'Unable to download excel')
    } finally {
      setLoading(false)
    }
  }

  const downloadOutturnXlsx = async () => {
    if (!requireBaseFilters()) return
    try {
      setLoading(true)
      await downloadFSOOutturnXlsx({
        location_code: filters.locationCode,
        fso_asset_code: filters.fsoAssetCode,
        date_from: filters.dateFrom,
        date_to: filters.dateTo,
      })
    } catch (e) {
      setErrorMsg(e.message || 'Unable to download excel')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
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
      <div className="print-only mtr-page">
        <div className="mtr-header">
          <h1>FSO MTR REPORT</h1>
          <div className="mtr-sub">
            <div><strong>Location:</strong> {filters.locationCode || '-'}</div>
            <div><strong>FSO Asset:</strong> {filters.fsoAssetCode || '-'}</div>
            <div><strong>Date From:</strong> {filters.dateFrom || '-'}</div>
            <div><strong>Date To:</strong> {filters.dateTo || '-'}</div>
            <div><strong>Printed:</strong> {new Date().toLocaleString()}</div>
            <div><strong>Report:</strong> {tab}</div>
          </div>
        </div>

        {tab === 'OTR' ? (
          <>
            <div className="mtr-kv">
              <div className="mtr-kv-grid">
                <div><strong>Total Receipt:</strong> {Number(otr?.total_receipt_bbl || 0).toFixed(3)}</div>
                <div><strong>Total Export:</strong> {Number(otr?.total_export_bbl || 0).toFixed(3)}</div>
                <div><strong>Total Variance:</strong> {Number(otr?.total_variance_bbl || 0).toFixed(3)}</div>
                <div><strong>Total Compare Var:</strong> {Number(otr?.total_compare_variance_bbl || 0).toFixed(3)}</div>
              </div>
            </div>

            <table className="mtr-table">
              <thead>
                <tr>
                  <th>Ticket</th><th>Acc Date</th><th>Op</th><th>Sign</th>
                  <th>Shuttle</th><th>Vessel</th><th>Vessel Qty</th>
                  <th>Move Qty</th><th>Var</th><th>Disch</th><th>Cmp Var</th>
                </tr>
              </thead>
              <tbody>
                {(otr?.rows || []).map((r) => (
                  <tr key={`otr-${r.transaction_id}`}>
                    <td>{r.ticket_number}</td>
                    <td>{r.accounting_date}</td>
                    <td>{r.operation_label}</td>
                    <td>{r.operation_sign}</td>
                    <td>{r.shuttle_number || '-'}</td>
                    <td>{r.vessel_name || '-'}</td>
                    <td>{Number(r.vessel_quantity_bbl || 0).toFixed(3)}</td>
                    <td>{Number(r.movement_qty_bbl || 0).toFixed(3)}</td>
                    <td>{Number(r.variance_bbl || 0).toFixed(3)}</td>
                    <td>{Number(r.source_shuttle_discharge_bbl || 0).toFixed(3)}</td>
                    <td>{Number(r.compare_variance_bbl || 0).toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : tab === 'MB' ? (
          <>
            <table className="mtr-table">
              <thead>
                <tr>
                  <th>Acc Date</th><th>Opening</th><th>Receipt</th><th>Export</th>
                  <th>Book Close</th><th>Phys Close</th><th>Close Water</th><th>Loss/Gain</th>
                </tr>
              </thead>
              <tbody>
                {(mb?.rows || []).map((r) => (
                  <tr key={`mb-${r.accounting_date}`}>
                    <td>{r.accounting_date}</td>
                    <td>{Number(r.opening_stock_bbl || 0).toFixed(3)}</td>
                    <td>{Number(r.receipt_bbl || 0).toFixed(3)}</td>
                    <td>{Number(r.export_bbl || 0).toFixed(3)}</td>
                    <td>{Number(r.book_closing_bbl || 0).toFixed(3)}</td>
                    <td>{Number(r.physical_closing_bbl || 0).toFixed(3)}</td>
                    <td>{Number(r.physical_closing_water_bbl || 0).toFixed(3)}</td>
                    <td>{Number(r.loss_gain_bbl || 0).toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (
          <>
            <div className="mtr-kv">
              <div className="mtr-kv-grid">
                <div><strong>Total Discharge:</strong> {Number(outturn?.total_shuttle_discharge_bbl || 0).toFixed(3)}</div>
                <div><strong>Total Receipt:</strong> {Number(outturn?.total_fso_receipt_bbl || 0).toFixed(3)}</div>
                <div><strong>Total Variance:</strong> {Number(outturn?.total_variance_bbl || 0).toFixed(3)}</div>
                <div><strong>Total %:</strong> {Number(outturn?.total_variance_pct || 0).toFixed(3)}</div>
              </div>
            </div>

            <table className="mtr-table">
              <thead>
                <tr>
                  <th>Acc Date</th><th>Shuttle</th><th>Discharge</th><th>Receipt</th><th>Variance</th><th>%</th>
                </tr>
              </thead>
              <tbody>
                {(outturn?.rows || []).map((r, idx) => (
                  <tr key={`ot-${r.accounting_date}-${r.shuttle_number}-${idx}`}>
                    <td>{r.accounting_date}</td>
                    <td>{r.shuttle_number}</td>
                    <td>{Number(r.shuttle_discharge_bbl || 0).toFixed(3)}</td>
                    <td>{Number(r.fso_receipt_bbl || 0).toFixed(3)}</td>
                    <td>{Number(r.variance_bbl || 0).toFixed(3)}</td>
                    <td>{Number(r.variance_pct || 0).toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        <div className="mtr-footer">
          <div>System: Hydrocarbon Accounting</div>
          <div>Module: FSO Reports</div>
        </div>
      </div>

      <div className="screen-only">
        <div>
          <div className="page-title no-print">
            <div>
              <h2>FSO Reports</h2>
              <p>
                FSO OTR (transaction-wise), Material Balance (date-wise), and Outturn (Shuttle Discharge vs FSO Receipt).
                Day boundary is taken from Location Accounting Day Setting (frontend configurable).
              </p>
            </div>
          </div>

          {/* Filters */}
          <div className="info-box no-print">
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'end' }}>
              <div style={{ minWidth: 220 }}>
                <label>Location</label>
                <select value={filters.locationCode} onChange={(e) => setFilters((c) => ({ ...c, locationCode: e.target.value }))}>
                  <option value="">Select</option>
                  {locations.filter((l) => l.status === 'Active').map((l) => (
                    <option key={l.id} value={l.locationCode}>
                      {l.locationName} ({l.locationCode})
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ minWidth: 240 }}>
                <label>FSO Asset</label>
                <select value={filters.fsoAssetCode} onChange={(e) => setFilters((c) => ({ ...c, fsoAssetCode: e.target.value }))}>
                  <option value="">Select</option>
                  {fsoAssets.map((a) => (
                    <option key={a.id} value={a.assetCode}>
                      {a.assetName} ({a.assetCode})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label>Date From</label>
                <input type="date" value={filters.dateFrom} onChange={(e) => setFilters((c) => ({ ...c, dateFrom: e.target.value }))} />
              </div>

              <div>
                <label>Date To</label>
                <input type="date" value={filters.dateTo} onChange={(e) => setFilters((c) => ({ ...c, dateTo: e.target.value }))} />
              </div>

              {tab === 'OTR' ? (
                <div style={{ minWidth: 200 }}>
                  <label>Shuttle Number (optional)</label>
                  <input value={filters.shuttleNumber} onChange={(e) => setFilters((c) => ({ ...c, shuttleNumber: e.target.value }))} />
                </div>
              ) : null}

              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" onClick={() => setTab('OTR')} disabled={tab === 'OTR'}>OTR</button>
                <button type="button" onClick={() => setTab('MB')} disabled={tab === 'MB'}>Material Balance</button>
                <button type="button" onClick={() => setTab('OUTTURN')} disabled={tab === 'OUTTURN'}>Outturn</button>
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                {tab === 'OTR' ? (
                  <>
                    <button type="button" onClick={runOTR} disabled={loading}>{loading ? 'Loading...' : 'Run OTR'}</button>
                    <button type="button" onClick={exportOTRcsv} disabled={loading}>CSV</button>
                    <button type="button" onClick={downloadOTRxlsx} disabled={loading}>Excel</button>
                  </>
                ) : tab === 'MB' ? (
                  <>
                    <button type="button" onClick={runMB} disabled={loading}>{loading ? 'Loading...' : 'Run MB'}</button>
                    <button type="button" onClick={exportMBcsv} disabled={loading}>CSV</button>
                    <button type="button" onClick={downloadMBxlsx} disabled={loading}>Excel</button>
                  </>
                ) : (
                  <>
                    <button type="button" onClick={runOutturn} disabled={loading}>{loading ? 'Loading...' : 'Run Outturn'}</button>
                    <button type="button" onClick={exportOutturnCsv} disabled={loading}>CSV</button>
                    <button type="button" onClick={downloadOutturnXlsx} disabled={loading}>Excel</button>
                  </>
                )}
                <button type="button" onClick={printReport} disabled={loading}>Print</button>
              </div>
            </div>
          </div>

      {tab === 'OTR' ? (
        <>
          <div className="section-title">
            <h3>FSO OTR</h3>
            <p>Transaction-wise daily record: receipts, exports, shuttle comparisons, variances.</p>
          </div>

          <table className="dense-table">
            <thead>
              <tr>
                <th>Ticket</th>
                <th>Acc Date</th>
                <th>Op</th>
                <th>Sign</th>
                <th>Shuttle</th>
                <th>Vessel</th>
                <th>Vessel Qty</th>
                <th>Move Qty</th>
                <th>Var</th>
                <th>Shuttle Disch</th>
                <th>Cmp Var</th>
              </tr>
            </thead>
            <tbody>
              {!otr?.rows?.length ? (
                <tr><td colSpan="11" className="empty-table">No data. Run OTR.</td></tr>
              ) : (
                otr.rows.map((r) => (
                  <tr key={r.transaction_id}>
                    <td>{r.ticket_number}</td>
                    <td>{r.accounting_date}</td>
                    <td>{r.operation_label}</td>
                    <td>{r.operation_sign}</td>
                    <td>{r.shuttle_number || '-'}</td>
                    <td>{r.vessel_name || '-'}</td>
                    <td>{Number(r.vessel_quantity_bbl || 0).toFixed(3)}</td>
                    <td>{Number(r.movement_qty_bbl || 0).toFixed(3)}</td>
                    <td>{Number(r.variance_bbl || 0).toFixed(3)}</td>
                    <td>{Number(r.source_shuttle_discharge_bbl || 0).toFixed(3)}</td>
                    <td>{Number(r.compare_variance_bbl || 0).toFixed(3)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          {otr ? (
            <div className="info-box">
              <strong>Totals:</strong>{' '}
              Receipt {Number(otr.total_receipt_bbl || 0).toFixed(3)} | Export {Number(otr.total_export_bbl || 0).toFixed(3)} | Variance {Number(otr.total_variance_bbl || 0).toFixed(3)}
            </div>
          ) : null}
        </>
      ) : tab === 'MB' ? (
        <>
          <div className="section-title">
            <h3>FSO Material Balance</h3>
            <p>Date-wise record using Location Accounting Day Setting boundaries.</p>
          </div>

          <table className="dense-table">
            <thead>
              <tr>
                <th>Acc Date</th>
                <th>Opening</th>
                <th>Receipt</th>
                <th>Export</th>
                <th>Book Close</th>
                <th>Phys Close</th>
                <th>Close Water</th>
                <th>Loss/Gain</th>
              </tr>
            </thead>
            <tbody>
              {!mb?.rows?.length ? (
                <tr><td colSpan="8" className="empty-table">No data. Run MB.</td></tr>
              ) : (
                mb.rows.map((r) => (
                  <tr key={r.accounting_date}>
                    <td>{r.accounting_date}</td>
                    <td>{Number(r.opening_stock_bbl || 0).toFixed(3)}</td>
                    <td>{Number(r.receipt_bbl || 0).toFixed(3)}</td>
                    <td>{Number(r.export_bbl || 0).toFixed(3)}</td>
                    <td>{Number(r.book_closing_bbl || 0).toFixed(3)}</td>
                    <td>{Number(r.physical_closing_bbl || 0).toFixed(3)}</td>
                    <td>{Number(r.physical_closing_water_bbl || 0).toFixed(3)}</td>
                    <td>{Number(r.loss_gain_bbl || 0).toFixed(3)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </>
      ) : (
        <>
          <div className="section-title">
            <h3>FSO Outturn</h3>
            <p>Daily shuttle discharge vs FSO receipt comparison (A4 print-ready).</p>
          </div>

          <table className="dense-table">
            <thead>
              <tr>
                <th>Acc Date</th>
                <th>Shuttle</th>
                <th>Shuttle Discharge</th>
                <th>FSO Receipt</th>
                <th>Variance</th>
                <th>%</th>
              </tr>
            </thead>
            <tbody>
              {!outturn?.rows?.length ? (
                <tr><td colSpan="6" className="empty-table">No data. Run Outturn.</td></tr>
              ) : (
                outturn.rows.map((r, idx) => (
                  <tr key={`${r.accounting_date}-${r.shuttle_number}-${idx}`}>
                    <td>{r.accounting_date}</td>
                    <td>{r.shuttle_number}</td>
                    <td>{Number(r.shuttle_discharge_bbl || 0).toFixed(3)}</td>
                    <td>{Number(r.fso_receipt_bbl || 0).toFixed(3)}</td>
                    <td>{Number(r.variance_bbl || 0).toFixed(3)}</td>
                    <td>{Number(r.variance_pct || 0).toFixed(3)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          {outturn ? (
            <div className="info-box">
              <strong>Totals:</strong>{' '}
              Discharge {Number(outturn.total_shuttle_discharge_bbl || 0).toFixed(3)} | Receipt {Number(outturn.total_fso_receipt_bbl || 0).toFixed(3)} | Var {Number(outturn.total_variance_bbl || 0).toFixed(3)} | % {Number(outturn.total_variance_pct || 0).toFixed(3)}
            </div>
          ) : null}
        </>
          )}
        </div>
      </div>
    </>
  )
}

export default FSOTracking
