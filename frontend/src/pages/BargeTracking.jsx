import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  createTripEvent,
  getBargeTracking,
  getTripTimelineByConvoy,
  closeTrip,
  reopenTrip,
} from '../api/bargeTrackingApi'

function BargeTracking({ loggedInUser, assets = [], locations = [] }) {
  const [convoyNumber, setConvoyNumber] = useState('')
  const [loading, setLoading] = useState(false)
  const [tracker, setTracker] = useState(null)
  const [timeline, setTimeline] = useState(null)

  const [successMsg, setSuccessMsg] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [confirmAction, setConfirmAction] = useState(null) // { type, message, data }
  const [promptModal, setPromptModal] = useState(null) // { type, message, default, value }

  const [fixPanel, setFixPanel] = useState({
    open: false,
    assetCode: '',
    convoyNumber: '',
    transactionId: '',
    eventType: 'LOAD_1',
    locationCode: '',
    remarks: '',
  })

  const [nextStageByAsset, setNextStageByAsset] = useState({})


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

  const getComparisonAssetCode = (comparison) => {
    return (
      String(comparison.asset_code || '').trim() ||
      String(comparison.summary_json?.asset_code || '').trim() ||
      String(comparison.summary_json?.left?.asset_code || '').trim() ||
      String(comparison.summary_json?.right?.asset_code || '').trim()
    )
  }

  const getPendingComparisonAssetCodes = () => {
    const assetCodes = (tracker?.assets || [])
      .map((g) => String(g.asset_code || '').trim())
      .filter(Boolean)

    const compared = new Set(
      (timeline?.comparisons || []).map(getComparisonAssetCode).filter(Boolean)
    )

    return assetCodes.filter((ac) => !compared.has(ac))
  }

  const hasApprovedBargeComparison = () => {
    return (
      (tracker?.assets || []).length > 0 && getPendingComparisonAssetCodes().length === 0
    )
  }

  const canCloseBargeMovement = () => {
    return (
      Boolean(timeline?.trip?.id) &&
      !isTripClosed &&
      (tracker?.assets || []).length > 0 &&
      hasApprovedBargeComparison()
    )
  }

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
      setErrorMsg('Convoy Number is required')
      return
    }

    setLoading(true)
    try {
      const trackerData = await getBargeTracking(clean)
      setTracker(trackerData)

      const timelineData = await getTripTimelineByConvoy(clean)
      setTimeline(timelineData)
    } catch (e) {
      setTracker(null)
      setTimeline(null)
      setErrorMsg(e.message || 'Failed to load convoy')
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
      setErrorMsg('Barge Movement is CLOSED. Reopen it to continue.')
      return
    }
    if (!tracker?.convoy_number) return

    const assetKey = String(assetCode || '').trim()
    if (!assetKey) return

    if (isAcknowledged(assetKey)) {
      setErrorMsg('Already acknowledged for this asset.')
      return
    }

    const lastLoadId = getLastLoadTicketId(assetKey)
    const lastLoadTicket = lastLoadId ? ticketById[String(lastLoadId)] : null
    const receiptLocation =
      lastLoadTicket?.destination_location_code ||
      lastLoadTicket?.origin_location_code ||
      ''

    if (!receiptLocation) {
      setErrorMsg('Could not determine receipt location (destination). Please ensure the load ticket has destination.')
      return
    }

    setConfirmAction({
      type: 'acknowledge',
      message: `Confirm Acknowledge Receipt?\n\nConvoy: ${tracker.convoy_number}\nBarge: ${assetKey}\nLocation: ${receiptLocation}\n\nThis confirms arrival only (no dips).`,
      data: { assetKey, receiptLocation },
    })
  }

  const confirmAcknowledge = async () => {
    if (!confirmAction || !tracker?.convoy_number) return
    const { assetKey, receiptLocation } = confirmAction.data
    setConfirmAction(null)
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
      setSuccessMsg('Receipt acknowledged.')
      await loadAll(tracker.convoy_number)
    } catch (e) {
      setErrorMsg(e.message || 'Failed to acknowledge receipt')
    } finally {
      setLoading(false)
    }
  }

  const revokeReceipt = async (assetCode) => {
    if (isTripClosed) {
      setErrorMsg('Barge Movement is CLOSED. Reopen it to continue.')
      return
    }
    if (!tracker?.convoy_number) return

    const assetKey = String(assetCode || '').trim()
    if (!assetKey) return

    if (!isAcknowledged(assetKey)) {
      setErrorMsg('This barge is not acknowledged yet.')
      return
    }

    setConfirmAction({
      type: 'revoke',
      message: `Confirm Revoke Receipt?\n\nConvoy: ${tracker.convoy_number}\nBarge: ${assetKey}`,
      data: { assetKey },
    })
  }

  const confirmRevoke = async () => {
    if (!confirmAction || !tracker?.convoy_number) return
    const { assetKey } = confirmAction.data
    const lastLoc = receiptStateByAsset?.[assetKey]?.location_code || null
    setConfirmAction(null)
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
      setSuccessMsg('Receipt acknowledgement revoked.')
      await loadAll(tracker.convoy_number)
    } catch (e) {
      setErrorMsg(e.message || 'Failed to revoke receipt acknowledgement')
    } finally {
      setLoading(false)
    }
  }

  const handleCloseBargeMovement = async () => {
    if (!timeline?.trip?.id) return

    if (!hasApprovedBargeComparison()) {
      setErrorMsg(
        'Barge movement can be closed only after comparison is available for every barge in this convoy.\n\n' +
          `Pending barge(s): ${getPendingComparisonAssetCodes().join(', ')}`
      )
      return
    }

    setPromptModal({
      type: 'close',
      title: `Close Barge Movement?\n\nConvoy: ${timeline.trip.convoy_number}\n\nEnter closure / settlement remarks:`,
      default: 'Reviewed and closed from Barge Tracking',
      value: 'Reviewed and closed from Barge Tracking',
    })
  }

  const confirmCloseBarge = async () => {
    if (!timeline?.trip?.id || !promptModal) return
    const remarks = promptModal.value || 'Reviewed and closed from Barge Tracking'
    setPromptModal(null)
    setLoading(true)
    try {
      await closeTrip(timeline.trip.id, remarks)
      setSuccessMsg('Barge movement closed.')
      await loadAll(timeline.trip.convoy_number)
    } catch (e) {
      setErrorMsg(e.message || 'Failed to close barge movement')
    } finally {
      setLoading(false)
    }
  }

  const handleReopenBargeMovement = async () => {
    if (!timeline?.trip?.id) return

    setPromptModal({
      type: 'reopen',
      title: `Reopen Barge Movement?\n\nConvoy: ${timeline.trip.convoy_number}\n\nEnter reopen remarks:`,
      default: 'Reopened from Barge Tracking',
      value: 'Reopened from Barge Tracking',
    })
  }

  const confirmReopenBarge = async () => {
    if (!timeline?.trip?.id || !promptModal) return
    const remarks = promptModal.value || 'Reopened from Barge Tracking'
    setPromptModal(null)
    setLoading(true)
    try {
      await reopenTrip(timeline.trip.id, remarks)
      setSuccessMsg('Barge movement reopened.')
      await loadAll(timeline.trip.convoy_number)
    } catch (e) {
      setErrorMsg(e.message || 'Failed to reopen barge movement')
    } finally {
      setLoading(false)
    }
  }

  const openFixPanel = (assetCode) => {
    if (isTripClosed) {
      setErrorMsg('Barge Movement is CLOSED. Reopen it to continue.')
      return
    }
    const convoy = tracker?.convoy_number || String(convoyNumber || '').trim()
    if (!convoy) {
      setErrorMsg('Please search convoy first.')
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
      setErrorMsg('Barge Movement is CLOSED. Reopen it to continue.')
      return
    }

    const convoy = String(fixPanel.convoyNumber || '').trim()
    const assetCode = String(fixPanel.assetCode || '').trim()
    const txIdRaw = String(fixPanel.transactionId || '').trim()

    if (!convoy || !assetCode || !txIdRaw) {
      setErrorMsg('Please select a ticket to add to timeline.')
      return
    }

    setConfirmAction({
      type: 'fix-timeline',
      message: `Fix Timeline (Admin)\n\nConvoy: ${convoy}\nBarge: ${assetCode}\nTicket ID: ${txIdRaw}\nEvent: ${fixPanel.eventType}\n\nUse this only if a ticket is missing in timeline or needs correction.`,
    })
  }

  const confirmFixTimeline = async () => {
    if (!confirmAction || confirmAction.type !== 'fix-timeline') return
    setConfirmAction(null)
    const convoy = String(fixPanel.convoyNumber || '').trim()
    const assetCode = String(fixPanel.assetCode || '').trim()
    const txIdRaw = String(fixPanel.transactionId || '').trim()
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
      setSuccessMsg('Timeline updated.')
      await loadAll(convoy)
    } catch (e) {
      setErrorMsg(e.message || 'Failed to tag ticket')
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
      {confirmAction && (
        <div className="confirm-overlay">
          <div className="confirm-dialog">
            <p>{confirmAction.message}</p>
            <div className="confirm-actions">
              <button onClick={confirmAction.type === 'acknowledge' ? confirmAcknowledge : confirmAction.type === 'revoke' ? confirmRevoke : confirmFixTimeline}>Yes</button>
              <button onClick={() => setConfirmAction(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
      {promptModal && (
        <div className="confirm-overlay">
          <div className="confirm-dialog">
            <p>{promptModal.title}</p>
            <textarea
              rows="3"
              value={promptModal.value}
              onChange={(e) => setPromptModal({ ...promptModal, value: e.target.value })}
            />
            <div className="confirm-actions">
              <button onClick={promptModal.type === 'close' ? confirmCloseBarge : confirmReopenBarge}>Confirm</button>
              <button onClick={() => setPromptModal(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Compact Barge MTR / Reconciliation Report */}
      {printReport.open && printReport.comparison && (
        <div className="printable-report barge-mtr-report">
          {(() => {
            const cmp = printReport.comparison
            const summary = cmp.summary_json || {}
            const left = summary.left || {}
            const right = summary.right || {}
            const sealChecks = Array.isArray(summary.seal_checks)
              ? summary.seal_checks
              : []
            const sealMismatch = Boolean(summary.seal_mismatch)

            const leftTotals = left.totals || {}
            const rightTotals = right.totals || {}
            const deltaTotals = (summary.delta || {}).totals || {}

            const tanks =
              cmp.per_tank_json && Array.isArray(cmp.per_tank_json.tanks)
                ? cmp.per_tank_json.tanks
                : []

            const maxTankRows = 8
            const shownTanks = tanks.slice(0, maxTankRows)
            const moreTanks = tanks.length > maxTankRows

            const events = Array.isArray(printReport.events)
              ? printReport.events.slice(0, 6)
              : []

            const quantityKeys = ['GOV', 'GSV', 'NSV', 'TOV', 'FW', 'LT', 'MT']

            return (
              <>
                <div className="barge-mtr-header">
                  <div>
                    <h1>BARGE MTR / RECONCILIATION REPORT</h1>
                    <p>
                      Convoy: <strong>{printReport.convoyNumber}</strong> | Barge:{' '}
                      <strong>
                        {printReport.assetName
                          ? `${printReport.assetName} (${printReport.assetCode})`
                          : printReport.assetCode}
                      </strong>
                    </p>
                  </div>

                  <div className="barge-mtr-meta">
                    <span>Comparison Type</span>
                    <strong>{cmp.comparison_type || '-'}</strong>
                    <span>Report Date</span>
                    <strong>{new Date().toLocaleString()}</strong>
                  </div>
                </div>

                <div className="barge-mtr-two-column">
                  <div className="barge-mtr-section">
                    <h2>Compared Tickets</h2>

                    <table className="barge-mtr-table">
                      <thead>
                        <tr>
                          <th>Side</th>
                          <th>Ticket</th>
                          <th>Stage</th>
                          <th>Date</th>
                          <th>Location</th>
                        </tr>
                      </thead>

                      <tbody>
                        <tr>
                          <td><strong>Sender</strong></td>
                          <td>
                            {left.ticket_number ||
                              cmp.left_ticket_number ||
                              cmp.left_transaction_id ||
                              '-'}
                          </td>
                          <td>{left.stage || '-'}</td>
                          <td>{left.operation_date || '-'}</td>
                          <td>{left.location_code || '-'}</td>
                        </tr>

                        <tr>
                          <td><strong>Receiver</strong></td>
                          <td>
                            {right.ticket_number ||
                              cmp.right_ticket_number ||
                              cmp.right_transaction_id ||
                              '-'}
                          </td>
                          <td>{right.stage || '-'}</td>
                          <td>{right.operation_date || '-'}</td>
                          <td>{right.location_code || '-'}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  <div className="barge-mtr-section">
                    <h2>Trip Timeline</h2>

                    <table className="barge-mtr-table">
                      <thead>
                        <tr>
                          <th>Seq</th>
                          <th>Event</th>
                          <th>Date/Time</th>
                          <th>Loc.</th>
                        </tr>
                      </thead>

                      <tbody>
                        {events.length === 0 ? (
                          <tr>
                            <td colSpan="4">No timeline events.</td>
                          </tr>
                        ) : (
                          events.map((ev) => (
                            <tr key={ev.id}>
                              <td>{ev.sequence_no || '-'}</td>
                              <td>{ev.event_type || '-'}</td>
                              <td>{ev.event_datetime || '-'}</td>
                              <td>{ev.location_code || '-'}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="barge-mtr-section">
                  <h2>
                    Seal Check{' '}
                    {sealMismatch ? (
                      <span style={{ color: 'red' }}>(Mismatch)</span>
                    ) : (
                      <span>(OK)</span>
                    )}
                  </h2>

                  <table className="barge-mtr-table">
                    <thead>
                      <tr>
                        <th>Seal</th>
                        <th>Sender</th>
                        <th>Receiver</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sealChecks.length === 0 ? (
                        <tr>
                          <td colSpan="4">
                            No seal data recorded in this comparison.
                          </td>
                        </tr>
                      ) : (
                        sealChecks.map((s) => (
                          <tr key={s.seal_name}>
                            <td>
                              <strong>{s.seal_name}</strong>
                            </td>
                            <td>{s.sender || '-'}</td>
                            <td>{s.receiver || '-'}</td>
                            <td>{s.status}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="barge-mtr-two-column">
                  <div className="barge-mtr-section">
                    <h2>Quantity Summary</h2>

                    <table className="barge-mtr-table barge-mtr-number-table">
                      <thead>
                        <tr>
                          <th>Qty</th>
                          <th>Sender</th>
                          <th>Receiver</th>
                          <th>Diff.</th>
                        </tr>
                      </thead>

                      <tbody>
                        {quantityKeys.map((key) => (
                          <tr key={key}>
                            <td><strong>{key}</strong></td>
                            <td>{formatNumber(leftTotals[key])}</td>
                            <td>{formatNumber(rightTotals[key])}</td>
                            <td>{formatNumber(deltaTotals[key])}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="barge-mtr-section">
                    <h2>Per Tank Summary</h2>

                    <table className="barge-mtr-table barge-mtr-number-table">
                      <thead>
                        <tr>
                          <th>Tank</th>
                          <th>S Dip</th>
                          <th>S TOV</th>
                          <th>R Dip</th>
                          <th>R TOV</th>
                          <th>Δ TOV</th>
                        </tr>
                      </thead>

                      <tbody>
                        {shownTanks.length === 0 ? (
                          <tr>
                            <td colSpan="6">No per-tank rows saved.</td>
                          </tr>
                        ) : (
                          shownTanks.map((row) => {
                            const senderTank = row.left || {}
                            const receiverTank = row.right || {}
                            const deltaTank = row.delta || {}

                            return (
                              <tr key={String(row.tank_id)}>
                                <td><strong>{row.tank_id}</strong></td>
                                <td>{formatNumber(senderTank.total_dip, 1)}</td>
                                <td>{formatNumber(senderTank.tov)}</td>
                                <td>{formatNumber(receiverTank.total_dip, 1)}</td>
                                <td>{formatNumber(receiverTank.tov)}</td>
                                <td>{formatNumber(deltaTank.tov)}</td>
                              </tr>
                            )
                          })
                        )}
                      </tbody>
                    </table>

                    {moreTanks && (
                      <p className="barge-mtr-note">
                        Note: Only first {maxTankRows} tanks are shown to keep the
                        report on one A4 page.
                      </p>
                    )}
                  </div>
                </div>

                <div className="barge-mtr-section">
                  <h2>Remarks / Review</h2>

                  <div className="barge-mtr-remarks-grid">
                    <div>
                      <span>Comparison Remarks</span>
                      <strong>{cmp.remarks || '-'}</strong>
                    </div>

                    <div>
                      <span>Generated By</span>
                      <strong>{loggedInUser?.fullName || loggedInUser?.username || '-'}</strong>
                    </div>

                    <div>
                      <span>System Note</span>
                      <strong>Approved sender/receiver comparison only</strong>
                    </div>
                  </div>
                </div>

                <div className="barge-mtr-signature-grid">
                  <div>
                    <strong>Prepared By</strong>
                    <span>Name / Signature / Date</span>
                  </div>

                  <div>
                    <strong>Sender Representative</strong>
                    <span>Name / Signature / Date</span>
                  </div>

                  <div>
                    <strong>Receiver Representative</strong>
                    <span>Name / Signature / Date</span>
                  </div>

                  <div>
                    <strong>Approved By</strong>
                    <span>Name / Signature / Date</span>
                  </div>
                </div>

                <div className="barge-mtr-footer">
                  Printed from Hydrocarbon Accounting System | Barge Tracking
                </div>
              </>
            )
          })()}

          <div className="no-print" style={{ marginTop: 10 }}>
            <button type="button" onClick={closeComparisonReport}>
              Close Report
            </button>
          </div>
        </div>
      )}

      <div className="page-title">
        <div>
          <h2>Barge Tracking</h2>
          <p>
            Track approved barge sender and receiver movements by convoy number,
            compare quantities, and review transit variance.
          </p>
        </div>
      </div>

      <div className="info-box no-print">
        Barge Tracking uses only <strong>Approved</strong> sender and receiver
        transactions. Draft or Submitted tickets will not move to receiver tracking or
        comparison.
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
                <button
                  type="button"
                  disabled={loading || !canCloseBargeMovement()}
                  onClick={handleCloseBargeMovement}
                  title={
                    !hasApprovedBargeComparison()
                      ? `Pending comparison for: ${getPendingComparisonAssetCodes().join(
                          ', '
                        )}`
                      : ''
                  }
                >
                  Close Barge Movement
                </button>

                <button
                  type="button"
                  disabled={loading || !isTripClosed}
                  onClick={handleReopenBargeMovement}
                >
                  Reopen Barge Movement
                </button>
              </div>
            )}

            {isTripClosed && (
              <div className="info-box">
                <strong>Barge Movement Closed.</strong> All entry actions are locked until
                reopened.
                {timeline?.trip?.remarks && (
                  <div style={{ marginTop: 6 }}>
                    <strong>Remarks:</strong> {timeline.trip.remarks}
                  </div>
                )}
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

                    <select
                      value={nextStageByAsset[String(assetCode)] || 'UNLOAD'}
                      onChange={(e) =>
                        setNextStageByAsset((cur) => ({
                          ...cur,
                          [String(assetCode)]: e.target.value,
                        }))
                      }
                      disabled={loading || isTripClosed}
                    >
                      <option value="UNLOAD">UNLOAD</option>
                      <option value="LOAD_2_TOPUP">LOAD 2 TOP-UP</option>
                      <option value="STS">STS</option>
                    </select>

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

                        const stage = nextStageByAsset[String(assetCode)] || 'UNLOAD'

                        const url =
                          `/operation-entry?` +
                          `convoy_number=${encodeURIComponent(convoy)}` +
                          `&primary_asset_code=${encodeURIComponent(assetCode)}` +
                          `&origin_location_code=${encodeURIComponent(origin)}` +
                          `&barge_event_type=${encodeURIComponent(stage)}` +
                          (leftId ? `&left_ticket_id=${encodeURIComponent(leftId)}` : '')

                        navigate(url)
                      }}
                    >
                      Create Ticket
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
                            <button
                              type="button"
                              onClick={() => openComparisonReport(c, bargeEvents, assetCode, assetName)}
                            >
                              Print MTR
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

export default BargeTracking
