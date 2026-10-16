import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import {
  createTripEvent,
  getBargeTracking,
  getBargeVoyages,
  getTripTimelineByConvoy,
  closeTrip,
  reopenTrip,
} from '../api/bargeTrackingApi'
import { useCompanyPrintProfile } from '../hooks/useCompanyPrintProfile'
import { useDataFilters } from '../hooks/useDataFilters'
import useActionFeedback from '../hooks/useActionFeedback'
import PaginationControls, { paginateRows, usePageSize } from '../components/common/PaginationControls'
import DataTableToolbar from '../components/common/DataTableToolbar'
import AlertMessage from '../components/common/AlertMessage'
import Modal from '../components/common/Modal'
import CompanyPrintHeader from '../components/reports/CompanyPrintHeader'
import CompanyPrintFooter from '../components/reports/CompanyPrintFooter'
import { logUiAction } from '../utils/actionLogger'

const VOYAGE_TABS = [
  { value: 'OPEN', label: 'Open Voyages' },
  { value: 'CLOSED', label: 'Closed Voyages' },
]

const voyageColumns = [
  { key: 'convoyNumber', label: 'Convoy No' },
  { key: 'status', label: 'Status' },
  { key: 'bargeText', label: 'Barge(s)' },
  { key: 'bargeCount', label: 'Barges', type: 'number' },
  { key: 'ticketCount', label: 'Tickets', type: 'number' },
  { key: 'originText', label: 'Origin' },
  { key: 'destinationText', label: 'Destination' },
  { key: 'firstOperationDate', label: 'First Operation Date', type: 'date' },
  { key: 'lastOperationDate', label: 'Last Operation Date', type: 'date' },
  { key: 'tripCreatedBy', label: 'Created By' },
  { key: 'tripRemarks', label: 'Remarks' },
]

function BargeTracking({ loggedInUser, assets = [], locations = [] }) {
  const profile = useCompanyPrintProfile()

  const [convoyNumber, setConvoyNumber] = useState('')
  const [loading, setLoading] = useState(false)
  const [tracker, setTracker] = useState(null)
  const [timeline, setTimeline] = useState(null)

  // Action feedback: little pop-up (toast) + inline message rendered next to
  // the action buttons inside the voyage detail (owner rule 8).
  const feedback = useActionFeedback()
  const { notifySuccess, notifyError, clearSuccess, clearError } = feedback
  const [timelineWarning, setTimelineWarning] = useState('')

  // Voyage list (Open / Closed tabs)
  const [voyageTab, setVoyageTab] = useState('OPEN')
  const [voyages, setVoyages] = useState([])
  const [voyageCounts, setVoyageCounts] = useState({ open: 0, closed: 0 })
  const [voyagesLoading, setVoyagesLoading] = useState(true)
  const [voyageError, setVoyageError] = useState('')
  const [voyagePage, setVoyagePage] = useState(1)
  const [selectedVoyage, setSelectedVoyage] = useState('')
  const [detailOpen, setDetailOpen] = useState(false)
  const voyagePageSize = usePageSize()
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


  const BARGE_SEAL_STATUS_LABELS = {
    MATCH: 'Matched',
    MISMATCH: 'Mismatch',
    MISSING_BOTH: 'Not Entered',
    MISSING_SENDER: 'Sender Missing',
    MISSING_RECEIVER: 'Receiver Missing',
  }

  const getBargeSealStatusLabel = (status) => {
    const value = String(status || '').toUpperCase()

    return (
      BARGE_SEAL_STATUS_LABELS[value] ||
      (value ? value.replace(/_/g, ' ') : '-')
    )
  }

  const isBargeSealProblem = (status) => {
    return ['MISMATCH', 'MISSING_SENDER', 'MISSING_RECEIVER'].includes(
      String(status || '').toUpperCase()
    )
  }


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
  const location = useLocation()

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

  // Re-fetch the voyage list after a convoy action (close / reopen / movement).
  const refreshVoyages = async () => {
    setVoyagesLoading(true)
    setVoyageError('')
    try {
      const data = await getBargeVoyages(voyageTab)
      setVoyages(data.rows)
      setVoyageCounts({ open: data.openCount, closed: data.closedCount })
    } catch (e) {
      setVoyageError(e.message || 'Unable to load barge voyages')
    } finally {
      setVoyagesLoading(false)
    }
  }

  // Load the list whenever the active tab changes. Stale responses are ignored.
  useEffect(() => {
    let active = true
    getBargeVoyages(voyageTab)
      .then((data) => {
        if (!active) return
        setVoyages(data.rows)
        setVoyageCounts({ open: data.openCount, closed: data.closedCount })
        setVoyageError('')
      })
      .catch((e) => {
        if (!active) return
        setVoyages([])
        setVoyageError(e.message || 'Unable to load barge voyages')
      })
      .finally(() => {
        if (active) setVoyagesLoading(false)
      })
    return () => {
      active = false
    }
  }, [voyageTab])

  const switchVoyageTab = (tab) => {
    if (tab === voyageTab) return
    logUiAction('Barge Tracking', 'Switch Voyage Tab', { tab })
    setVoyagesLoading(true)
    setVoyageError('')
    setVoyageTab(tab)
  }

  const voyageRows = useMemo(() => {
    return voyages.map((voyage) => ({
      convoyNumber: voyage.convoyNumber,
      status: voyage.status === 'CLOSED' ? 'Closed' : 'Open',
      bargeText: voyage.barges
        .map((barge) => (barge.assetName ? `${barge.assetName} (${barge.assetCode})` : barge.assetCode))
        .join(', '),
      bargeCount: voyage.bargeCount,
      ticketCount: voyage.ticketCount,
      originText: voyage.originLocationCodes.join(', '),
      destinationText: voyage.destinationLocationCodes.join(', '),
      firstOperationDate: voyage.firstOperationDate,
      lastOperationDate: voyage.lastOperationDate,
      tripCreatedBy: voyage.tripCreatedBy,
      tripRemarks: voyage.tripRemarks,
    }))
  }, [voyages])

  const voyageFilters = useDataFilters(voyageRows, voyageColumns, { module: 'Barge Tracking' })
  const filteredVoyageCount = voyageFilters.filteredRows.length
  const visibleVoyageRows = paginateRows(voyageFilters.filteredRows, voyagePage, voyagePageSize)

  // Go back to page 1 when the tab or the filtered result set changes.
  const pageResetKey = `${voyageTab}|${filteredVoyageCount}`
  const [appliedPageResetKey, setAppliedPageResetKey] = useState(pageResetKey)
  if (appliedPageResetKey !== pageResetKey) {
    setAppliedPageResetKey(pageResetKey)
    setVoyagePage(1)
  }

  const openVoyage = (convoy) => {
    logUiAction('Barge Tracking', 'Open Voyage', { convoyNumber: convoy })
    setSelectedVoyage(convoy)
    setConvoyNumber(convoy)
    setDetailOpen(true)
    loadAll(convoy)
  }

  const closeVoyageDetail = () => {
    setDetailOpen(false)
    setTracker(null)
    setTimeline(null)
    setTimelineWarning('')
    feedback.clear()
  }

  const loadAll = async (cn) => {
    const clean = String(cn || '').trim()
    if (!clean) {
      notifyError('Convoy Number is required')
      return
    }

    setLoading(true)

    try {
      const trackerData = await getBargeTracking(clean)
      setTracker(trackerData)
    } catch (e) {
      setTracker(null)
      setTimeline(null)
      notifyError(e.message || 'Failed to load convoy')
      setLoading(false)
      return
    }

    try {
      // Approved tickets stay visible even if the trip timeline cannot be
      // read - never blank the whole page because of the timeline call.
      const timelineData = await getTripTimelineByConvoy(clean)
      setTimeline(timelineData)

      if (Array.isArray(timelineData?.warnings) && timelineData.warnings.length > 0) {
        setTimelineWarning(timelineData.warnings.join(' '))
      } else {
        setTimelineWarning('')
      }
    } catch (e) {
      setTimeline(null)
      notifyError(
        e.message ||
          'Trip timeline could not be loaded. Approved tickets are still shown below.'
      )
    } finally {
      setLoading(false)
      // Keep the Open / Closed lists in step with any movement change.
      refreshVoyages()
    }
  }

  const handleSearch = async (e) => {
    e.preventDefault()
    setDetailOpen(true)
    await loadAll(convoyNumber)
  }

  // Auto-open the voyage detail when arriving with ?convoy_number=... (the
  // Operation Entry page navigates back here after saving a barge ticket).
  // Derived during render - same pattern as the page-reset above - so a URL
  // change while mounted opens the new convoy without an extra effect.
  const convoyFromUrl = useMemo(() => {
    const params = new URLSearchParams(location.search)
    return String(params.get('convoy_number') || '').trim()
  }, [location.search])
  const [autoOpenedConvoy, setAutoOpenedConvoy] = useState('')
  if (convoyFromUrl && autoOpenedConvoy !== convoyFromUrl) {
    setAutoOpenedConvoy(convoyFromUrl)
    openVoyage(convoyFromUrl)
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
    if (!canManage) {
      notifyError('You do not have permission to acknowledge receipt')
      return
    }
    if (isTripClosed) {
      notifyError('Barge Movement is CLOSED. Reopen it to continue.')
      return
    }
    if (!tracker?.convoy_number) return

    const assetKey = String(assetCode || '').trim()
    if (!assetKey) return

    if (isAcknowledged(assetKey)) {
      notifyError('Already acknowledged for this asset.')
      return
    }

    const lastLoadId = getLastLoadTicketId(assetKey)
    const lastLoadTicket = lastLoadId ? ticketById[String(lastLoadId)] : null
    const receiptLocation =
      lastLoadTicket?.destination_location_code ||
      lastLoadTicket?.origin_location_code ||
      ''

    if (!receiptLocation) {
      notifyError('Could not determine receipt location (destination). Please ensure the load ticket has destination.')
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
      notifySuccess('Receipt acknowledged.')
      await loadAll(tracker.convoy_number)
    } catch (e) {
      notifyError(e.message || 'Failed to acknowledge receipt')
    } finally {
      setLoading(false)
    }
  }

  const revokeReceipt = async (assetCode) => {
    if (!canManage) {
      notifyError('You do not have permission to revoke receipt')
      return
    }
    if (isTripClosed) {
      notifyError('Barge Movement is CLOSED. Reopen it to continue.')
      return
    }
    if (!tracker?.convoy_number) return

    const assetKey = String(assetCode || '').trim()
    if (!assetKey) return

    if (!isAcknowledged(assetKey)) {
      notifyError('This barge is not acknowledged yet.')
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
      notifySuccess('Receipt acknowledgement revoked.')
      await loadAll(tracker.convoy_number)
    } catch (e) {
      notifyError(e.message || 'Failed to revoke receipt acknowledgement')
    } finally {
      setLoading(false)
    }
  }

  const handleCloseBargeMovement = async () => {
    if (!canManage) {
      notifyError('You do not have permission to close barge movement')
      return
    }
    if (!timeline?.trip?.id) return

    if (!hasApprovedBargeComparison()) {
      notifyError(
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
      notifySuccess('Barge movement closed.')
      await loadAll(timeline.trip.convoy_number)
      switchVoyageTab('CLOSED')
    } catch (e) {
      notifyError(e.message || 'Failed to close barge movement')
    } finally {
      setLoading(false)
    }
  }

  const handleReopenBargeMovement = async () => {
    if (!canManage) {
      notifyError('You do not have permission to reopen barge movement')
      return
    }
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
      notifySuccess('Barge movement reopened.')
      await loadAll(timeline.trip.convoy_number)
      switchVoyageTab('OPEN')
    } catch (e) {
      notifyError(e.message || 'Failed to reopen barge movement')
    } finally {
      setLoading(false)
    }
  }

  const openFixPanel = (assetCode) => {
    if (isTripClosed) {
      notifyError('Barge Movement is CLOSED. Reopen it to continue.')
      return
    }
    const convoy = tracker?.convoy_number || String(convoyNumber || '').trim()
    if (!convoy) {
      notifyError('Please search convoy first.')
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
      notifyError('Barge Movement is CLOSED. Reopen it to continue.')
      return
    }

    const convoy = String(fixPanel.convoyNumber || '').trim()
    const assetCode = String(fixPanel.assetCode || '').trim()
    const txIdRaw = String(fixPanel.transactionId || '').trim()

    if (!convoy || !assetCode || !txIdRaw) {
      notifyError('Please select a ticket to add to timeline.')
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
      notifySuccess('Timeline updated.')
      await loadAll(convoy)
    } catch (e) {
      notifyError(e.message || 'Failed to tag ticket')
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
    logUiAction('Barge Tracking', 'Print Comparison Report', { comparisonId: cmp.id, convoyNumber: convoy, assetCode })

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
      } catch {
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
      <div className="screen-only">
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
      </div>

      {/* Compact Barge MTR / Reconciliation Report */}
      {printReport.open && printReport.comparison && (
        <div className="printable-report barge-mtr-report">
          <CompanyPrintHeader profile={profile} defaultSubtitle="Barge MTR / Reconciliation Report" />
          {(() => {
            const cmp = printReport.comparison
            const summary = cmp.summary_json || {}
            const left = summary.left || {}
            const right = summary.right || {}
            const sealChecks = Array.isArray(summary.seal_checks)
              ? summary.seal_checks
              : []
            const permanentSealChecks = Array.isArray(summary.permanent_seal_checks)
              ? summary.permanent_seal_checks : []
            const sealProblemCount = [...sealChecks, ...permanentSealChecks].filter((s) =>
              isBargeSealProblem(s.status)
            ).length
            const sealMismatch = sealProblemCount > 0
            const sealSummary =
              sealChecks.length + permanentSealChecks.length === 0
                ? 'Not Captured'
                : sealMismatch
                  ? `Mismatch (${sealProblemCount} of ${sealChecks.length + permanentSealChecks.length})`
                  : 'Matched'

            const leftTotals = left.totals || {}
            const rightTotals = right.totals || {}
            const deltaTotals = (summary.delta || {}).totals || {}

            const tanks =
              cmp.per_tank_json && Array.isArray(cmp.per_tank_json.tanks)
                ? cmp.per_tank_json.tanks
                : []

            const shownTanks = tanks

            const events = Array.isArray(printReport.events)
              ? printReport.events
              : []

            const quantityKeys = ['GOV', 'GSV', 'BSW', 'NSV', 'TOV', 'FW', 'LT', 'MT']

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
                    <span>Seal Result</span>
                    <strong style={{ color: sealMismatch ? 'red' : 'inherit' }}>
                      {sealSummary}
                    </strong>
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
                    {sealChecks.length === 0 ? (
                      <span>(Not Captured)</span>
                    ) : sealMismatch ? (
                      <span style={{ color: 'var(--danger-text)' }}>(Mismatch)</span>
                    ) : (
                      <span style={{ color: 'green' }}>(Matched)</span>
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
                            No seal data recorded in this comparison. Enter the
                            temporary seals on the load and unload tickets to
                            print the seal match / mismatch result.
                          </td>
                        </tr>
                      ) : (
                        sealChecks.map((s) => (
                          <tr key={s.seal_name}>
                            <td>
                              <strong>{s.seal_name}</strong>
                            </td>
                            <td>{s.sender || s.sender_value || '-'}</td>
                            <td>{s.receiver || s.receiver_value || '-'}</td>
                            <td
                              style={{
                                color: isBargeSealProblem(s.status)
                                  ? 'red'
                                  : 'inherit',
                                fontWeight: 'bold',
                              }}
                            >
                              {getBargeSealStatusLabel(s.status)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {permanentSealChecks.length > 0 && (
                  <div className="barge-mtr-section">
                    <h2>Permanent Tank Seals</h2>
                    <table className="barge-mtr-table">
                      <thead><tr><th>Tank</th><th>Position</th><th>Master</th><th>Sender</th><th>Receiver</th><th>Status</th></tr></thead>
                      <tbody>{permanentSealChecks.map((seal) => (
                        <tr key={`${seal.tank_id}-${seal.seal_name}`}>
                          <td>{seal.tank_id}</td><td>{seal.seal_name}</td><td>{seal.master || '-'}</td>
                          <td>{seal.sender || '-'}</td><td>{seal.receiver || '-'}</td>
                          <td>{getBargeSealStatusLabel(seal.status)}</td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                )}

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
                          <th>S T.Dip</th>
                          <th>S W.Dip</th>
                          <th>S TOV</th>
                          <th>S FW</th>
                          <th>R T.Dip</th>
                          <th>R W.Dip</th>
                          <th>R TOV</th>
                          <th>R FW</th>
                          <th>Δ TOV</th>
                          <th>Δ FW</th>
                        </tr>
                      </thead>

                      <tbody>
                        {shownTanks.length === 0 ? (
                          <tr>
                            <td colSpan="11">No per-tank rows saved.</td>
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
                                <td>{formatNumber(senderTank.water_dip, 1)}</td>
                                <td>{formatNumber(senderTank.tov)}</td>
                                <td>{formatNumber(senderTank.fw)}</td>
                                <td>{formatNumber(receiverTank.total_dip, 1)}</td>
                                <td>{formatNumber(receiverTank.water_dip, 1)}</td>
                                <td>{formatNumber(receiverTank.tov)}</td>
                                <td>{formatNumber(receiverTank.fw)}</td>
                                <td>{formatNumber(deltaTank.tov)}</td>
                                <td>{formatNumber(deltaTank.fw)}</td>
                              </tr>
                            )
                          })
                        )}
                      </tbody>
                    </table>


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

                <CompanyPrintFooter profile={profile} />
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

      <div className="screen-only">
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

      {!canManage && (
        <div className="info-box no-print">
          You have view-only access. Assign <strong>Create Operation Entry</strong> to
          acknowledge/revoke receipts, close/reopen barge movements, or use Fix Timeline.
        </div>
      )}

      {/* Voyage list: Open / Closed tabs with the standard filter bar */}
      <div className="section-title">
        <h3>Barge Voyages</h3>
        <p>
          Approved barge voyages grouped by convoy number. Open a voyage to view its
          timeline, comparisons and actions.
        </p>
      </div>

      <div className="list-tabs" role="tablist" aria-label="Barge voyage status">
        {VOYAGE_TABS.map((tab) => {
          const count = tab.value === 'CLOSED' ? voyageCounts.closed : voyageCounts.open
          const selected = voyageTab === tab.value

          return (
            <button
              key={tab.value}
              type="button"
              role="tab"
              aria-selected={selected}
              className="list-tab"
              onClick={() => switchVoyageTab(tab.value)}
            >
              {tab.label}
              <span className="list-tab-count">{count}</span>
            </button>
          )
        })}
      </div>

      <AlertMessage
        tone="error"
        message={voyageError}
        onDismiss={() => setVoyageError('')}
      />

      <DataTableToolbar
        filters={voyageFilters}
        columns={voyageFilters.columns}
        exportFileName={`barge-voyages-${voyageTab.toLowerCase()}`}
        exportTitle={`Barge Voyages - ${voyageTab === 'CLOSED' ? 'Closed' : 'Open'}`}
        module="Barge Tracking"
      />

      <table>
        <thead>
          <tr>
            <th>Convoy No</th>
            <th>Status</th>
            <th>Barge(s)</th>
            <th>Tickets</th>
            <th>Origin</th>
            <th>Destination</th>
            <th>First Date</th>
            <th>Last Date</th>
            <th className="no-print">Action</th>
          </tr>
        </thead>
        <tbody>
          {voyagesLoading ? (
            <tr>
              <td colSpan="9" className="empty-table">Loading voyages...</td>
            </tr>
          ) : visibleVoyageRows.length === 0 ? (
            <tr>
              <td colSpan="9" className="empty-table">
                {voyageRows.length === 0
                  ? `No ${voyageTab === 'CLOSED' ? 'closed' : 'open'} barge voyages.`
                  : 'No voyages match the current filters.'}
              </td>
            </tr>
          ) : (
            visibleVoyageRows.map((row) => (
              <tr
                key={row.convoyNumber}
                className={row.convoyNumber === selectedVoyage ? 'is-selected' : ''}
              >
                <td><strong>{row.convoyNumber}</strong></td>
                <td>
                  <span className={`status-badge ${row.status === 'Closed' ? 'active' : 'draft'}`}>
                    {row.status}
                  </span>
                </td>
                <td>{row.bargeText || '-'}</td>
                <td>{row.ticketCount}</td>
                <td>{row.originText || '-'}</td>
                <td>{row.destinationText || '-'}</td>
                <td>{row.firstOperationDate || '-'}</td>
                <td>{row.lastOperationDate || '-'}</td>
                <td className="no-print">
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => openVoyage(row.convoyNumber)}
                  >
                    View
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <PaginationControls
        currentPage={voyagePage}
        totalRows={filteredVoyageCount}
        onPageChange={setVoyagePage}
      />

      <Modal
        open={detailOpen}
        title="Voyage Detail"
        description="Search a convoy number, or open a voyage from the list above."
        onClose={closeVoyageDetail}
        size="xl"
      >
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

            {!loading && timelineWarning && (
              <div className="info-box no-print" style={{ marginBottom: '0.75rem' }}>
                {timelineWarning}
              </div>
            )}

            {/* Action feedback for voyage actions (close / reopen /
                acknowledge / fix timeline) lives right next to the action
                buttons, and also pops up as a toast (owner rule 8). */}
            <AlertMessage
              tone="success"
              message={feedback.successMsg}
              onDismiss={clearSuccess}
            />
            <AlertMessage
              tone="error"
              message={feedback.errorMsg}
              onDismiss={clearError}
            />

            {timeline?.trip?.id && (
              <div className="form-actions" style={{ marginTop: 10 }}>
                <button
                  type="button"
                  disabled={loading || !canManage || !canCloseBargeMovement()}
                  onClick={handleCloseBargeMovement}
                  title={
                    !canManage
                      ? 'You do not have permission to close barge movement'
                      : !hasApprovedBargeComparison()
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
                  disabled={loading || !canManage || !isTripClosed}
                  onClick={handleReopenBargeMovement}
                  title={!canManage ? 'You do not have permission to reopen barge movement' : ''}
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

            // Approved sender ticket of this barge that has no receiving ticket yet
            const pendingSender = (g.tickets || [])
              .filter((t) => t.movement_role === 'SENDER' && !t.receiver_transaction_id)
              .slice(-1)[0]
            const receivingTickets = (g.tickets || []).filter(
              (t) => t.movement_role === 'RECEIVER' && t.linked_sender_transaction_id
            )

            return (
              <div key={assetCode} className="full-width-field">
                <div className="section-title">
                  <h3>{assetName ? `${assetName} (${assetCode})` : assetCode}</h3>
                  <p>
                    Tickets: <strong>{(g.tickets || []).length}</strong> | Receipt:{' '}
                    <strong>{acked ? `Acknowledged (${receiptLoc || '-'})` : 'Not Acknowledged'}</strong>
                  </p>

                  <p>
                    {pendingSender
                      ? `Waiting for receipt: ${pendingSender.ticket_number} (${pendingSender.operation_type_name || pendingSender.operation_type_code})`
                      : 'No approved sender ticket is waiting for receipt.'}
                    {receivingTickets.length > 0 && (
                      <span> | Receiving tickets: {receivingTickets.map((t) => t.ticket_number).join(', ')}</span>
                    )}
                  </p>

                  <div className="form-actions" style={{ marginTop: 8 }}>
                    <button
                      type="button"
                      disabled={loading || !canManage || isTripClosed || acked}
                      onClick={() => acknowledgeReceipt(assetCode)}
                      title={!canManage ? 'You do not have permission to acknowledge receipt' : ''}
                    >
                      Acknowledge Receipt
                    </button>

                    {acked && (
                      <button
                        type="button"
                        disabled={loading || !canManage || isTripClosed}
                        onClick={() => revokeReceipt(assetCode)}
                        title={!canManage ? 'You do not have permission to revoke receipt' : ''}
                      >
                        Revoke Receipt
                      </button>
                    )}

                    <button
                      type="button"
                      disabled={loading || !canManage || isTripClosed || !acked || !pendingSender}
                      title={
                        !canManage
                          ? 'You do not have permission to create a receiving ticket'
                          : !acked
                            ? 'Acknowledge receipt of this barge first'
                            : !pendingSender
                              ? 'No approved sender ticket is waiting for receipt'
                              : ''
                      }
                      onClick={() => {
                        const url =
                          `/operation-entry?` +
                          `source=barge-tracking` +
                          `&linked_ticket_id=${encodeURIComponent(pendingSender.transaction_id)}` +
                          `&convoy_number=${encodeURIComponent(tracker?.convoy_number || '')}` +
                          `&primary_asset_code=${encodeURIComponent(assetCode)}`
                        navigate(url)
                      }}
                    >
                      Create Receiving Ticket
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
      </Modal>
      </div>
    </div>
  )
}

export default BargeTracking
