import { logUiAction } from '../utils/actionLogger'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  getFSOOTRReport,
  getFSOMaterialBalanceReport,
  getFSOOutturnReport,
  downloadFSOOTRXlsx,
  downloadFSOMaterialBalanceXlsx,
  downloadFSOOutturnXlsx,
} from '../api/fsoReportApi'
import { getFSOTracking } from '../api/fsoTrackingApi'
import { useCompanyPrintProfile } from '../hooks/useCompanyPrintProfile'
import { usePrintDialog } from '../components/print/printProfileContext'
import { useDataFilters } from '../hooks/useDataFilters'
import CompanyPrintHeader from '../components/reports/CompanyPrintHeader'
import CompanyPrintFooter from '../components/reports/CompanyPrintFooter'
import AlertMessage from '../components/common/AlertMessage'
import useActionFeedback from '../hooks/useActionFeedback'
import PaginationControls, { paginateRows, usePageSize } from '../components/common/PaginationControls'
import DataTableToolbar from '../components/common/DataTableToolbar'

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
  const profile = useCompanyPrintProfile()
  const { requestPrint } = usePrintDialog()

  const [tab, setTab] = useState('SUMMARY') // SUMMARY | OTR | MB | OUTTURN
  const [loading, setLoading] = useState(false)
  // Action feedback: little pop-up (toast) + inline message near the
  // action area (owner rule 8) - never at the bottom of the page.
  const feedback = useActionFeedback()
  const { notifyError, clearSuccess, clearError } = feedback

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

  // ----- Summary tab: all FSO tracking transactions (tickets) -----
  const [fsoTickets, setFsoTickets] = useState([])
  const [fsoLoading, setFsoLoading] = useState(false)
  const [fsoPage, setFsoPage] = useState(1)
  const fsoPageSize = usePageSize()

  const fsoColumns = [
    { key: 'ticketNumber', label: 'Ticket' },
    { key: 'operationNumber', label: 'Operation No' },
    { key: 'operationLabel', label: 'Operation' },
    { key: 'operationDate', label: 'Date', type: 'date' },
    {
      key: 'locationName',
      label: 'Location',
      accessor: (ticket) => {
        const name = ticket.locationName || ticket.locationCode || ''
        const code = ticket.locationCode || ''
        return name && code ? `${name} (${code})` : name || code || '-'
      },
    },
    { key: 'shuttleNumber', label: 'Shuttle' },
    {
      key: 'fsoAssetName',
      label: 'FSO Asset',
      accessor: (ticket) => {
        const name = ticket.fsoAssetName || ticket.fsoAssetCode || ''
        const code = ticket.fsoAssetCode || ''
        return name && code ? `${name} (${code})` : name || code || '-'
      },
    },
    { key: 'productName', label: 'Product' },
    { key: 'vesselQuantityBbl', label: 'Vessel Qty (bbl)', type: 'number' },
    { key: 'movementQtyBbl', label: 'Movement Qty (bbl)', type: 'number' },
    { key: 'varianceBbl', label: 'Variance (bbl)', type: 'number' },
    { key: 'status', label: 'Ticket Status' },
    { key: 'voyageStatus', label: 'Voyage Status' },
  ]

  const fetchFsoGroups = async (tabValue) => {
    const allGroups = []
    let page = 1
    let hasMore = true
    while (hasMore) {
      const data = await getFSOTracking({
        tab: tabValue,
        include_tickets: true,
        page,
        page_size: 200,
      })
      const rows = data.rows || []
      allGroups.push(...rows)
      hasMore = Boolean(data.has_more)
      page += 1
    }
    return allGroups
  }

  const loadFsoTickets = async () => {
    try {
      setFsoLoading(true)
      // Both OPEN and CLOSED voyages are needed for the "all transactions"
      // summary. A voyage is either open or closed, so the two sets are
      // disjoint and can be merged safely.
      const allGroups = await Promise.all([
        fetchFsoGroups('OPEN'),
        fetchFsoGroups('CLOSED'),
      ]).then((results) => results.flat())

      const tickets = []
      for (const group of allGroups) {
        const voyageStatus = group.voyage_status || 'OPEN'
        for (const ticket of group.tickets || []) {
          // The ticket payload carries net stock / net water only; the
          // movement quantity is the same |net stock| + |net water| rule the
          // OTR report uses on the server.
          const movementQtyBbl =
            Math.abs(Number(ticket.netStockBbl || 0)) +
            Math.abs(Number(ticket.netWaterBbl || 0))
          tickets.push({ ...ticket, voyageStatus, movementQtyBbl })
        }
      }
      setFsoTickets(tickets)
    } catch (e) {
      notifyError(e.message || 'Unable to load FSO tracking summary')
    } finally {
      setFsoLoading(false)
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadFsoTickets()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const fsoFilters = useDataFilters(fsoTickets, fsoColumns, {
    module: 'FSO Tracking',
  })
  const filteredFsoCount = fsoFilters.filteredRows.length
  const visibleFsoRows = paginateRows(fsoFilters.filteredRows, fsoPage, fsoPageSize)

  const fsoNumber = (value) => {
    const n = Number(value || 0)
    return n.toLocaleString(undefined, {
      minimumFractionDigits: 3,
      maximumFractionDigits: 3,
    })
  }

  const requireBaseFilters = () => {
    const errors = {}
    if (!filters.locationCode) errors.locationCode = 'Location is required'
    if (!filters.fsoAssetCode) errors.fsoAssetCode = 'FSO Asset is required'
    if (!filters.dateFrom) errors.dateFrom = 'Date From is required'
    if (!filters.dateTo) errors.dateTo = 'Date To is required'
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
      notifyError(e.message || 'Unable to load FSO OTR report')
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
      notifyError(e.message || 'Unable to load FSO Material Balance report')
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
      notifyError(e.message || 'Unable to load FSO Outturn report')
    } finally {
      setLoading(false)
    }
  }

  const exportOTRcsv = () => {
    if (!otr?.rows?.length) {
      notifyError('No rows to export')
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
      notifyError('No rows to export')
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
      notifyError('No rows to export')
      return
    }
    const headers = [
      'accounting_date','shuttle_number',
      'shuttle_discharge_bbl','fso_receipt_bbl','variance_bbl','variance_pct',
    ]
    downloadCsv('fso_outturn.csv', headers, outturn.rows)
  }

  const printReport = () => {
    requestPrint({
      module: 'FSO Reports',
      reportName: `FSO ${tab} Report`,
      onBeforePrint: () => {
        logUiAction('FSO Reports', 'Print Report', { tab })
      },
    })
  }

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
      notifyError(e.message || 'Unable to download excel')
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
      notifyError(e.message || 'Unable to download excel')
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
      notifyError(e.message || 'Unable to download excel')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <div className="print-only mtr-page">
        <CompanyPrintHeader profile={profile} defaultSubtitle="FSO MTR Report" />
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

        <CompanyPrintFooter profile={profile} />
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
                FSO OTR (transaction-wise), Material Balance (date-wise), and Outturn (Shuttle Discharge vs FSO Receipt).\n                Day boundary is taken from Location Accounting Day Setting (frontend configurable).
              </p>
            </div>
          </div>

          {/* Action feedback: right next to the page actions + a little pop-up
              toast - never at the bottom of the page (owner rule 8). */}
          <AlertMessage tone="success" message={feedback.successMsg} onDismiss={clearSuccess} />
          <AlertMessage tone="error" message={feedback.errorMsg} onDismiss={clearError} />

          {/* Filters for OTR / Material Balance / Outturn */}
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
                  {(assets || []).filter((a) => String(a.assetTypeCode || '').toUpperCase() === 'FSO' && a.status === 'Active').map((a) => (
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
                <button type="button" onClick={() => setTab('SUMMARY')} disabled={tab === 'SUMMARY'}>Summary</button>
                <button type="button" onClick={() => setTab('OTR')} disabled={tab === 'OTR'}>OTR</button>
                <button type="button" onClick={() => setTab('MB')} disabled={tab === 'MB'}>Material Balance</button>
                <button type="button" onClick={() => setTab('OUTTURN')} disabled={tab === 'OUTTURN'}>Outturn</button>
              </div>

              {(tab === 'OTR' || tab === 'MB' || tab === 'OUTTURN') && (
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
              )}
            </div>
          </div>

        {tab === 'SUMMARY' ? (
          <>
            <div className="section-title">
              <h3>FSO Tracking Summary</h3>
              <p>
                Summary of all FSO tracking transactions (tickets), with their
                status and voyage status. Use the filter bar above to search or
                filter the list, and the export buttons to download the result.
              </p>
            </div>

            <DataTableToolbar
              filters={fsoFilters}
              columns={fsoFilters.columns}
              exportFileName="fso-tracking-summary"
              exportTitle="FSO Tracking Summary"
              module="FSO Tracking"
            />

            <table>
              <thead>
                <tr>
                  <th>Ticket</th>
                  <th>Operation No</th>
                  <th>Operation</th>
                  <th>Date</th>
                  <th>Location</th>
                  <th>Shuttle</th>
                  <th>FSO Asset</th>
                  <th>Product</th>
                  <th className="number-cell">Vessel Qty</th>
                  <th className="number-cell">Movement Qty</th>
                  <th className="number-cell">Variance</th>
                  <th>Ticket Status</th>
                  <th>Voyage Status</th>
                  <th className="no-print">Action</th>
                </tr>
              </thead>
              <tbody>
                {fsoLoading ? (
                  <tr>
                    <td colSpan="14" className="empty-table">Loading FSO tracking summary...</td>
                  </tr>
                ) : visibleFsoRows.length === 0 ? (
                  <tr>
                    <td colSpan="14" className="empty-table">
                      {fsoTickets.length === 0
                        ? 'No FSO tracking transactions found.'
                        : 'No transactions match the current filters.'}
                    </td>
                  </tr>
                ) : (
                  visibleFsoRows.map((ticket) => (
                    <tr key={ticket.transactionId}>
                      <td>{ticket.ticketNumber || ticket.operationNumber || '-'}</td>
                      <td>{ticket.operationNumber || '-'}</td>
                      <td>{ticket.operationLabel || '-'}</td>
                      <td>{ticket.operationDate || '-'}</td>
                      <td>{ticket.locationName || ticket.locationCode || '-'}</td>
                      <td>{ticket.shuttleNumber || '-'}</td>
                      <td>{ticket.fsoAssetName || ticket.fsoAssetCode || '-'}</td>
                      <td>{ticket.productName || '-'}</td>
                      <td className="number-cell">{fsoNumber(ticket.vesselQuantityBbl)}</td>
                      <td className="number-cell">{fsoNumber(ticket.movementQtyBbl)}</td>
                      <td className="number-cell">{fsoNumber(ticket.varianceBbl)}</td>
                      <td>
                        <span className={`status-badge ${String(ticket.status || '').toLowerCase()}`}>
                          {ticket.status || '-'}
                        </span>
                      </td>
                      <td>
                        <span className={`status-badge ${ticket.voyageStatus === 'CLOSED' ? 'active' : 'draft'}`}>
                          {ticket.voyageStatus === 'CLOSED' ? 'Closed' : 'Open'}
                        </span>
                      </td>
                      <td className="no-print">
                        {ticket.transactionId && (
                          <Link to={`/operation-transactions/${ticket.transactionId}`}>
                            <button type="button">View</button>
                          </Link>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>

            <PaginationControls
              currentPage={fsoPage}
              totalRows={filteredFsoCount}
              onPageChange={setFsoPage}
            />
          </>
        ) : tab === 'OTR' ? (
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
