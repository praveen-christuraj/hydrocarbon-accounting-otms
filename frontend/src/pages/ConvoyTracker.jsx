import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  createTripEvent,
  getConvoyTracker,
  getTripTimelineByConvoy,
  closeTrip,
  reopenTrip,
} from '../api/convoyTrackerApi'

function ConvoyTracker({ loggedInUser, assets = [], locations = [] }) {
  const [convoyNumber, setConvoyNumber] = useState('')
  const [loading, setLoading] = useState(false)
  const [tracker, setTracker] = useState(null)
  const [timeline, setTimeline] = useState(null)

  const [fixPanel, setFixPanel] = useState({
    open: false,
    assetCode: '',
    convoyNumber: '',
    transactionId: '',
    eventType: 'LOAD_1',
    locationCode: '',
    remarks: '',
  })


  // Printable MTR-style Comparison Report
  const [printReport, setPrintReport] = useState({
    open: false,
    convoyNumber: '',
    assetCode: '',
    assetName: '',
    comparison: null,
    events: [],
  })

  const navigate = useNavigate()

  const canManage = (loggedInUser?.permissions || []).some(
    (p) => p.permissionName === 'Create Operation Entry'
  )

  const tripStatus = String(timeline?.trip?.status || 'OPEN').toUpperCase()
  const isTripClosed = tripStatus === 'CLOSED'

  const getAssetName = (assetCode) => {
    const a = (assets || []).find((x) => String(x.assetCode) === String(assetCode))
    return a ? a.assetName : ''
  }

  const getLocationLabel = (code) => {
    const loc = (locations || []).find((l) => String(l.locationCode) === String(code))
    return loc ? `${loc.locationName} (${loc.locationCode})` : (code || '')
  }

  const loadAll = async (cn) => {
    const clean = String(cn || '').trim()
    if (!clean) {
      alert('Convoy Number is required')
      return
    }

    setLoading(true)
    try {
      const trackerData = await getConvoyTracker(clean)
      setTracker(trackerData)

      const timelineData = await getTripTimelineByConvoy(clean)
      setTimeline(timelineData)
    } catch (e) {
      setTracker(null)
      setTimeline(null)
      alert(e.message || 'Failed to load convoy')
    } finally {
      setLoading(false)
    }
  }

  const handleSearch = async (e) => {
    e.preventDefault()
    await loadAll(convoyNumber)
  }

  // Group events & comparisons per barge
  const grouped = useMemo(() => {
    const events = timeline?.events || []
    const comparisons = timeline?.comparisons || []

    const eventsByAsset = {}
    for (const ev of events) {
      const ac = String(ev.asset_code || '').trim() || 'UNKNOWN'
      if (!eventsByAsset[ac]) eventsByAsset[ac] = []
      eventsByAsset[ac].push(ev)
    }

    const comparisonsByAsset = {}
    for (const c of comparisons) {
      const ac =
        String(c.asset_code || c.assetCode || '').trim() ||
        String(c.summary_json?.asset_code || '').trim() ||
        'UNKNOWN'
      if (!comparisonsByAsset[ac]) comparisonsByAsset[ac] = []
      comparisonsByAsset[ac].push(c)
    }

    return { eventsByAsset, comparisonsByAsset }
  }, [timeline])

  // Ticket lookup by id (for choosing last load)
  const ticketById = useMemo(() => {
    const map = {}
    for (const g of tracker?.assets || []) {
      for (const t of g.tickets || []) {
        map[String(t.transaction_id)] = t
      }
    }
    return map
  }, [tracker])

  // Receipt state per barge
  const receiptStateByAsset = useMemo(() => {
    const map = {}
    const events = timeline?.events || []
    for (const ev of events) {
      const assetCode = String(ev.asset_code || '').trim()
      if (!assetCode) continue
      const type = String(ev.event_type || '').trim().toUpperCase()
      if (type !== 'RECEIVED' && type !== 'RECEIPT_REVOKED') continue
      const seq = Number(ev.sequence_no || 0)
      const existing = map[assetCode]
      if (!existing || seq >= existing.sequence_no) {
        map[assetCode] = {
          event_type: type,
          sequence_no: seq,
          location_code: ev.location_code || '',
        }
      }
    }
    return map
  }, [timeline])

  const isAcknowledged = (assetCode) => {
    const key = String(assetCode || '').trim()
    if (!key) return false
    return receiptStateByAsset?.[key]?.event_type === 'RECEIVED'
  }

  const getLastLoadTicketId = (assetCode) => {
    const evs = grouped.eventsByAsset[String(assetCode)] || []
    const loadEvents = evs
      .filter((e) => String(e.event_type || '').toUpperCase().startsWith('LOAD'))
      .slice()
      .sort((a, b) => Number(b.sequence_no || 0) - Number(a.sequence_no || 0))

    const lastLoad = loadEvents[0]
    if (lastLoad?.operation_transaction_id) return lastLoad.operation_transaction_id

    const group = (tracker?.assets || []).find((g) => String(g.asset_code) === String(assetCode))
    if (!group) return null
    const tickets = (group.tickets || []).slice().sort((a, b) => {
      const da = String(a.operation_date || '')
      const db = String(b.operation_date || '')
      if (da < db) return 1
      if (da > db) return -1
      return Number(b.transaction_id || 0) - Number(a.transaction_id || 0)
    })
    return tickets[0]?.transaction_id || null
  }

  const acknowledgeReceipt = async (assetCode) => {
    if (isTripClosed) {
      alert('Trip is CLOSED. Reopen the trip to continue.')
      return
    }
    if (!tracker?.convoy_number) return

    const assetKey = String(assetCode || '').trim()
    if (!assetKey) return

    if (isAcknowledged(assetKey)) {
      alert('Already acknowledged for this asset.')
      return
    }

    const lastLoadId = getLastLoadTicketId(assetKey)
    const lastLoadTicket = lastLoadId ? ticketById[String(lastLoadId)] : null
    const receiptLocation =
      lastLoadTicket?.destination_location_code ||
      lastLoadTicket?.origin_location_code ||
      ''

    if (!receiptLocation) {
      alert('Could not determine receipt location (destination). Please ensure the load ticket has destination.')
      return
    }

    const ok = window.confirm(
      `Confirm Acknowledge Receipt?\n\nConvoy: ${tracker.convoy_number}\nBarge: ${assetKey}\nLocation: ${receiptLocation}\n\nThis confirms arrival only (no dips).`
    )
    if (!ok) return

    setLoading(true)
    try {
      await createTripEvent({
        convoyNumber: tracker.convoy_number,
        eventType: 'RECEIVED',
        locationCode: receiptLocation,
        assetCode: assetKey,
        operationTransactionId: null,
        remarks: 'Receiver acknowledged receipt',
      })
      await loadAll(tracker.convoy_number)
    } catch (e) {
      alert(e.message || 'Failed to acknowledge receipt')
    } finally {
      setLoading(false)
    }
  }

  const revokeReceipt = async (assetCode) => {
    if (isTripClosed) {
      alert('Trip is CLOSED. Reopen the trip to continue.')
      return
    }
    if (!tracker?.convoy_number) return

    const assetKey = String(assetCode || '').trim()
    if (!assetKey) return

    if (!isAcknowledged(assetKey)) {
      alert('This barge is not acknowledged yet.')
      return
    }

    const ok = window.confirm(
      `Confirm Revoke Receipt?\n\nConvoy: ${tracker.convoy_number}\nBarge: ${assetKey}`
    )
    if (!ok) return

    const lastLoc = receiptStateByAsset?.[assetKey]?.location_code || null

    setLoading(true)
    try {
      await createTripEvent({
        convoyNumber: tracker.convoy_number,
        eventType: 'RECEIPT_REVOKED',
        locationCode: lastLoc,
        assetCode: assetKey,
        operationTransactionId: null,
        remarks: 'Receipt acknowledgement revoked',
      })
      await loadAll(tracker.convoy_number)
    } catch (e) {
      alert(e.message || 'Failed to revoke receipt acknowledgement')
    } finally {
      setLoading(false)
    }
  }

  const handleCloseTrip = async () => {
    if (!timeline?.trip?.id) return
    const ok = window.confirm(
      `Close Trip?\n\nConvoy: ${timeline.trip.convoy_number}\n\nAfter closing, no further entries/events are allowed until reopened.`
    )
    if (!ok) return

    setLoading(true)
    try {
      await closeTrip(timeline.trip.id, 'Closed from Convoy Tracker')
      await loadAll(timeline.trip.convoy_number)
    } catch (e) {
      alert(e.message || 'Failed to close trip')
    } finally {
      setLoading(false)
    }
  }

  const handleReopenTrip = async () => {
    if (!timeline?.trip?.id) return
    const ok = window.confirm(
      `Reopen Trip?\n\nConvoy: ${timeline.trip.convoy_number}\n\nThis will allow entries/events again.`
    )
    if (!ok) return

    setLoading(true)
    try {
      await reopenTrip(timeline.trip.id, 'Reopened from Convoy Tracker')
      await loadAll(timeline.trip.convoy_number)
    } catch (e) {
      alert(e.message || 'Failed to reopen trip')
    } finally {
      setLoading(false)
    }
  }

  const openFixPanel = (assetCode) => {
    if (isTripClosed) {
      alert('Trip is CLOSED. Reopen the trip to continue.')
      return
    }
    const convoy = tracker?.convoy_number || String(convoyNumber || '').trim()
    if (!convoy) {
      alert('Please search convoy first.')
      return
    }

    setFixPanel({
      open: true,
      assetCode: String(assetCode),
      convoyNumber: convoy,
      transactionId: '',
      eventType: 'LOAD_2_TOPUP',
      locationCode: '',
      remarks: '',
    })
  }

  const closeFixPanel = () => {
    setFixPanel({
      open: false,
      assetCode: '',
      convoyNumber: '',
      transactionId: '',
      eventType: 'LOAD_2_TOPUP',
      locationCode: '',
      remarks: '',
    })
  }

  const saveFixPanel = async () => {
    if (isTripClosed) {
      alert('Trip is CLOSED. Reopen the trip to continue.')
      return
    }

    const convoy = String(fixPanel.convoyNumber || '').trim()
    const assetCode = String(fixPanel.assetCode || '').trim()
    const txIdRaw = String(fixPanel.transactionId || '').trim()

    if (!convoy || !assetCode || !txIdRaw) {
      alert('Please select a ticket to add to timeline.')
      return
    }

    const ok = window.confirm(
      `Fix Timeline (Admin)\n\nConvoy: ${convoy}\nBarge: ${assetCode}\nTicket ID: ${txIdRaw}\nEvent: ${fixPanel.eventType}\n\nUse this only if a ticket is missing in timeline or needs correction.`
    )
    if (!ok) return

    setLoading(true)
    try {
      await createTripEvent({
        convoyNumber: convoy,
        eventType: fixPanel.eventType,
        locationCode: fixPanel.locationCode || null,
        assetCode: assetCode,
        operationTransactionId: Number(txIdRaw),
        remarks: fixPanel.remarks || 'Manual timeline fix',
      })
      closeFixPanel()
      await loadAll(convoy)
    } catch (e) {
      alert(e.message || 'Failed to tag ticket')
    } finally {
      setLoading(false)
    }
  }

  const formatNumber = (value, decimals = 3) => {
    const n = Number(value)
    if (!Number.isFinite(n)) return ''
    return n.toFixed(decimals)
  }

  const openComparisonReport = (cmp, bargeEvents, assetCode, assetNameValue) => {
    const convoy = String(tracker?.convoy_number || convoyNumber || '').trim()
    if (!cmp) return

    setPrintReport({
      open: true,
      convoyNumber: convoy,
      assetCode: String(assetCode || ''),
      assetName: String(assetNameValue || ''),
      comparison: cmp,
      events: Array.isArray(bargeEvents) ? bargeEvents : [],
    })

    // Print after React renders the printable section
    setTimeout(() => {
      try {
        window.print()
      } catch (e) {
        // ignore
      }
    }, 250)
  }

  const closeComparisonReport = () => {
    setPrintReport({
      open: false,
      convoyNumber: '',
      assetCode: '',
      assetName: '',
      comparison: null,
      events: [],
    })
  }
return (
    <div>

      {/* Printable MTR-style Comparison Report (A4 Portrait, single-page optimized) */}
      {printReport.open && printReport.comparison && (
        <div className="printable-report comparison-mtr-report">
          <div className="print-report-header">
            <div className="print-company-block">
              <div className="print-logo-placeholder">LOGO</div>
              <div>
                <h1 style={{ margin: 0 }}>MTR Comparison Report</h1>
                <p style={{ margin: '4px 0 0' }}>
                  Convoy: <strong>{printReport.convoyNumber}</strong> | Barge:{' '}
                  <strong>
                    {printReport.assetName
                      ? `${printReport.assetName} (${printReport.assetCode})`
                      : printReport.assetCode}
                  </strong>
                </p>
              </div>
            </div>

            <div className="print-report-ticket">
              <strong>{printReport.comparison?.comparison_type}</strong>
              <span>Report Date</span>
              <small>{new Date().toLocaleString()}</small>
            </div>
          </div>

          <div className="print-report-section">
            <h2>Compared Tickets</h2>
            {(() => {
              const cmp = printReport.comparison
              const s = cmp.summary_json || {}
              const left = s.left || {}
              const right = s.right || {}
              return (
                <table className="mtr-table">
                  <thead>
                    <tr>
                      <th></th>
                      <th>Ticket</th>
                      <th>Stage</th>
                      <th>Date</th>
                      <th>Location</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td><strong>LEFT</strong></td>
                      <td>{left.ticket_number || cmp.left_ticket_number || cmp.left_transaction_id}</td>
                      <td>{left.stage || ''}</td>
                      <td>{left.operation_date || ''}</td>
                      <td>{left.location_code || ''}</td>
                    </tr>
                    <tr>
                      <td><strong>RIGHT</strong></td>
                      <td>{right.ticket_number || cmp.right_ticket_number || cmp.right_transaction_id}</td>
                      <td>{right.stage || ''}</td>
                      <td>{right.operation_date || ''}</td>
                      <td>{right.location_code || ''}</td>
                    </tr>
                  </tbody>
                </table>
              )
            })()}
          </div>

          <div className="print-report-section">
            <h2>Totals</h2>
            {(() => {
              const cmp = printReport.comparison
              const s = cmp.summary_json || {}
              const leftTotals = (s.left || {}).totals || {}
              const rightTotals = (s.right || {}).totals || {}
              const deltaTotals = ((s.delta || {}).totals) || {}
              const keys = ['GOV', 'GSV', 'NSV', 'TOV', 'FW', 'LT', 'MT', 'BSW']

              return (
                <table className="mtr-table mtr-compact-table">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Left</th>
                      <th>Right</th>
                      <th>Diff</th>
                    </tr>
                  </thead>
                  <tbody>
                    {keys.map((k) => (
                      <tr key={k}>
                        <td><strong>{k}</strong></td>
                        <td>{formatNumber(leftTotals[k])}</td>
                        <td>{formatNumber(rightTotals[k])}</td>
                        <td>{formatNumber(deltaTotals[k])}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            })()}
          </div>

          <div className="print-report-section">
            <h2>Per Tank (Dips & Volumes)</h2>
            {(() => {
              const cmp = printReport.comparison
              const tanks = (cmp.per_tank_json && cmp.per_tank_json.tanks) ? cmp.per_tank_json.tanks : []
              const maxRows = 10
              const shown = tanks.slice(0, maxRows)
              const more = tanks.length > maxRows

              return (
                <>
                  <table className="mtr-table mtr-compact-table">
                    <thead>
                      <tr>
                        <th>Tank</th>
                        <th>L Dip</th>
                        <th>L TOV</th>
                        <th>L FW</th>
                        <th>R Dip</th>
                        <th>R TOV</th>
                        <th>R FW</th>
                        <th>Δ TOV</th>
                        <th>Δ FW</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shown.length === 0 ? (
                        <tr><td colSpan="9">No per-tank rows saved.</td></tr>
                      ) : (
                        shown.map((r) => {
                          const l = r.left || {}
                          const rr = r.right || {}
                          const d = r.delta || {}
                          return (
                            <tr key={String(r.tank_id)}>
                              <td><strong>{r.tank_id}</strong></td>
                              <td>{formatNumber(l.total_dip, 1)}</td>
                              <td>{formatNumber(l.tov)}</td>
                              <td>{formatNumber(l.fw)}</td>
                              <td>{formatNumber(rr.total_dip, 1)}</td>
                              <td>{formatNumber(rr.tov)}</td>
                              <td>{formatNumber(rr.fw)}</td>
                              <td>{formatNumber(d.tov)}</td>
                              <td>{formatNumber(d.fw)}</td>
                            </tr>
                          )
                        })
                      )}
                    </tbody>
                  </table>

                  {more && (
                    <p style={{ marginTop: 6, fontSize: 10 }}>
                      Note: Only first {maxRows} tanks are shown to keep the report on one page.
                    </p>
                  )}
                </>
              )
            })()}
          </div>

          <div className="print-report-section">
            <h2>Trip Timeline (This Barge)</h2>
            <table className="mtr-table mtr-compact-table">
              <thead>
                <tr>
                  <th>Seq</th>
                  <th>Event</th>
                  <th>Date/Time</th>
                  <th>Location</th>
                  <th>Ticket</th>
                </tr>
              </thead>
              <tbody>
                {(printReport.events || []).length === 0 ? (
                  <tr><td colSpan="5">No timeline events.</td></tr>
                ) : (
                  printReport.events.map((ev) => (
                    <tr key={ev.id}>
                      <td>{ev.sequence_no}</td>
                      <td>{ev.event_type}</td>
                      <td>{ev.event_datetime || ''}</td>
                      <td>{ev.location_name ? `${ev.location_name} (${ev.location_code})` : (ev.location_code || '')}</td>
                      <td>{ev.ticket_number || ''}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="print-report-footer">
            Printed from Hydrocarbon Accounting System | Comparison Report
          </div>

          {/* This closes the hidden report after printing when user navigates back */}
          <div className="no-print" style={{ marginTop: 10 }}>
            <button type="button" onClick={closeComparisonReport}>
              Close Report
            </button>
          </div>
        </div>
      )}

      <div className="page-title">
        <div>
          <h2>Convoy Tracker</h2>
          <p>Search by Convoy Number. Each barge shows its own timeline and comparisons.</p>
        </div>
      </div>

      <form onSubmit={handleSearch}>
        <div>
          <label>Convoy Number</label>
          <input
            type="text"
            value={convoyNumber}
            onChange={(e) => setConvoyNumber(e.target.value)}
            placeholder="Example: CNV-2026-001"
          />
        </div>

        <div className="form-actions">
          <button type="submit" disabled={loading}>
            {loading ? 'Loading...' : 'Search'}
          </button>
        </div>
      </form>

      {!tracker ? (
        <div className="info-box">Enter Convoy Number and click Search.</div>
      ) : (
        <>
          <div className="section-title">
            <h3>Convoy: {tracker.convoy_number}</h3>
            <p>
              Tickets: <strong>{tracker.total_tickets}</strong> | Trip Status:{' '}
              <strong>{tripStatus}</strong>
            </p>

            {timeline?.trip?.id && (
              <div className="form-actions" style={{ marginTop: 10 }}>
                <button type="button" disabled={loading || isTripClosed} onClick={handleCloseTrip}>
                  Close Trip
                </button>
                <button type="button" disabled={loading || !isTripClosed} onClick={handleReopenTrip}>
                  Reopen Trip
                </button>
              </div>
            )}

            {isTripClosed && (
              <div className="info-box">
                Trip is CLOSED. All entry actions are locked until reopened.
              </div>
            )}
          </div>

          {(tracker.assets || []).map((g) => {
            const assetName = g.asset_name || getAssetName(g.asset_code) || ''
            const assetCode = g.asset_code
            const acked = isAcknowledged(assetCode)

            const bargeEvents = grouped.eventsByAsset[String(assetCode)] || []
            const bargeComparisons = grouped.comparisonsByAsset[String(assetCode)] || []

            const receiptLoc = receiptStateByAsset?.[String(assetCode)]?.location_code || ''

            return (
              <div key={assetCode} className="full-width-field">
                <div className="section-title">
                  <h3>{assetName ? `${assetName} (${assetCode})` : assetCode}</h3>
                  <p>
                    Tickets: <strong>{(g.tickets || []).length}</strong> | Receipt:{' '}
                    <strong>{acked ? `Acknowledged (${receiptLoc || '-'})` : 'Not Acknowledged'}</strong>
                  </p>

                  <div className="form-actions" style={{ marginTop: 8 }}>
                    <button
                      type="button"
                      disabled={loading || isTripClosed || acked}
                      onClick={() => acknowledgeReceipt(assetCode)}
                    >
                      Acknowledge Receipt
                    </button>

                    {acked && (
                      <button
                        type="button"
                        disabled={loading || isTripClosed}
                        onClick={() => revokeReceipt(assetCode)}
                      >
                        Revoke Receipt
                      </button>
                    )}

                    <button
                      type="button"
                      disabled={loading || isTripClosed}
                      onClick={() => {
                        const convoy = tracker?.convoy_number || ''
                        const leftId = getLastLoadTicketId(assetCode)
                        const leftTicket = leftId ? ticketById[String(leftId)] : null
                        const origin =
                          leftTicket?.destination_location_code ||
                          leftTicket?.origin_location_code ||
                          ''

                        const url =
                          `/operation-entry?` +
                          `convoy_number=${encodeURIComponent(convoy)}` +
                          `&primary_asset_code=${encodeURIComponent(assetCode)}` +
                          `&origin_location_code=${encodeURIComponent(origin)}` +
                          `&auto_event_type=UNLOAD` +
                          (leftId ? `&left_ticket_id=${encodeURIComponent(leftId)}` : '')

                        navigate(url)
                      }}
                    >
                      Create UNLOAD Ticket
                    </button>

                    {canManage && (
                      <button
                        type="button"
                        disabled={loading || isTripClosed}
                        onClick={() => openFixPanel(assetCode)}
                      >
                        Fix Timeline (Admin)
                      </button>
                    )}
                  </div>
                </div>

                {/* Tickets */}
                <table>
                  <thead>
                    <tr>
                      <th>Ticket</th>
                      <th>Operation</th>
                      <th>Date</th>
                      <th>Origin</th>
                      <th>Destination</th>
                      <th>Status</th>
                      <th>Open</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(g.tickets || []).length === 0 ? (
                      <tr>
                        <td colSpan="7" className="empty-table">No tickets.</td>
                      </tr>
                    ) : (
                      g.tickets.map((t) => (
                        <tr key={t.transaction_id}>
                          <td><strong>{t.ticket_number}</strong></td>
                          <td>{t.operation_type_name}</td>
                          <td>{t.operation_date}</td>
                          <td>{t.origin_location_name ? `${t.origin_location_name} (${t.origin_location_code})` : t.origin_location_code}</td>
                          <td>{t.destination_location_code ? (t.destination_location_name ? `${t.destination_location_name} (${t.destination_location_code})` : t.destination_location_code) : '-'}</td>
                          <td><span className={`status-badge ${String(t.status || '').toLowerCase()}`}>{t.status}</span></td>
                          <td>
                            <Link to={`/operation-transactions/${t.transaction_id}`}>
                              <button type="button">View</button>
                            </Link>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>

                {/* Barge Timeline */}
                <div className="section-title">
                  <h3>Barge Timeline</h3>
                  <p>Timeline events for this barge only.</p>
                </div>

                <table>
                  <thead>
                    <tr>
                      <th>Seq</th>
                      <th>Event</th>
                      <th>Date/Time</th>
                      <th>Location</th>
                      <th>Ticket</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bargeEvents.length === 0 ? (
                      <tr><td colSpan="6" className="empty-table">No events for this barge yet.</td></tr>
                    ) : (
                      bargeEvents.map((ev) => (
                        <tr key={ev.id}>
                          <td>{ev.sequence_no}</td>
                          <td><span className="permission-badge">{ev.event_type}</span></td>
                          <td>{ev.event_datetime || '-'}</td>
                          <td>{ev.location_name ? `${ev.location_name} (${ev.location_code})` : getLocationLabel(ev.location_code)}</td>
                          <td>
                            {ev.operation_transaction_id ? (
                              <Link to={`/operation-transactions/${ev.operation_transaction_id}`}>
                                {ev.ticket_number || 'View'}
                              </Link>
                            ) : '-'}
                          </td>
                          <td>{ev.ticket_status || '-'}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>

                {/* Barge Comparisons */}
                <div className="section-title">
                  <h3>Barge Comparisons</h3>
                  <p>Comparisons for this barge only.</p>
                </div>

                {bargeComparisons.length === 0 ? (
                  <div className="info-box">
                    No comparisons for this barge yet. (They are created on UNLOAD save or manual compare.)
                  </div>
                ) : (
                  <table>
                    <thead>
                      <tr>
                        <th>Type</th>
                        <th>Left Ticket</th>
                        <th>Right Ticket</th>
                        <th>Created By</th>
                        <th>Remarks</th>
                        <th>Report</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bargeComparisons.map((c) => (
                        <tr key={c.id}>
                          <td>{c.comparison_type}</td>
                          <td>
                            <Link to={`/operation-transactions/${c.left_transaction_id}`}>
                              {c.left_ticket_number || c.left_transaction_id}
                            </Link>
                          </td>
                          <td>
                            <Link to={`/operation-transactions/${c.right_transaction_id}`}>
                              {c.right_ticket_number || c.right_transaction_id}
                            </Link>
                          </td>
                          <td>{c.created_by || '-'}</td>
                          <td>{c.remarks || '-'}</td>
                          <td>
                            <button type="button" onClick={() => openComparisonReport(c, bargeEvents, assetCode, assetName)}>
                              Comparison Report
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )
          })}

          {/* Fix Timeline (Admin) Panel */}
          {fixPanel.open && (
            <div className="full-width-field">
              <div className="section-title">
                <h3>Fix Timeline (Admin)</h3>
                <p>
                  Use this only if a ticket is missing in the barge timeline or needs correction.
                  Normal flow auto-creates LOAD events on Submit and creates RECEIVED/UNLOAD via buttons.
                </p>
              </div>

              <form onSubmit={(e) => e.preventDefault()}>
                <div>
                  <label>Barge</label>
                  <input type="text" value={fixPanel.assetCode} disabled />
                </div>

                <div>
                  <label>Ticket</label>
                  <select
                    value={fixPanel.transactionId}
                    onChange={(e) => setFixPanel({ ...fixPanel, transactionId: e.target.value })}
                  >
                    <option value="">Select Ticket</option>
                    {(tracker?.assets || [])
                      .find((g) => String(g.asset_code) === String(fixPanel.assetCode))
                      ?.tickets?.map((t) => (
                        <option key={t.transaction_id} value={t.transaction_id}>
                          {t.ticket_number} ({t.operation_type_name})
                        </option>
                      )) || null}
                  </select>
                </div>

                <div>
                  <label>Event Type</label>
                  <select
                    value={fixPanel.eventType}
                    onChange={(e) => setFixPanel({ ...fixPanel, eventType: e.target.value })}
                  >
                    <option>LOAD_1</option>
                    <option>LOAD_2_TOPUP</option>
                    <option>UNLOAD</option>
                    <option>STS_OUT</option>
                    <option>STS_IN</option>
                    <option>SHUTTLE_RECEIPT</option>
                    <option>OTHER</option>
                  </select>
                </div>

                <div>
                  <label>Location Code (Optional)</label>
                  <input
                    type="text"
                    value={fixPanel.locationCode}
                    onChange={(e) => setFixPanel({ ...fixPanel, locationCode: e.target.value })}
                    placeholder="Example: UTP"
                  />
                </div>

                <div className="full-width-field">
                  <label>Remarks</label>
                  <textarea
                    rows="2"
                    value={fixPanel.remarks}
                    onChange={(e) => setFixPanel({ ...fixPanel, remarks: e.target.value })}
                    placeholder="Optional"
                  />
                </div>

                <div className="form-actions">
                  <button type="button" disabled={loading} onClick={saveFixPanel}>
                    {loading ? 'Saving...' : 'Save to Timeline'}
                  </button>
                  <button type="button" disabled={loading} onClick={closeFixPanel}>
                    Close
                  </button>
                </div>
              </form>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default ConvoyTracker