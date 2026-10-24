import { logUiAction } from '../utils/actionLogger'
import { resolveReceiverCode, resolveSenderCode } from '../utils/senderReceiver'
import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import {
  acknowledgeTankerReceipt,
  closeTankerMovement,
  getTankerTracking,
  revokeTankerAcknowledgement,
} from '../api/tankerTrackingApi'
import TankerConvoyComparisonReport from '../components/reports/TankerConvoyComparisonReport'
import TankerMtrComparisonReport from '../components/reports/TankerMtrComparisonReport'
import { useDataFilters } from '../hooks/useDataFilters'
import useActionFeedback from '../hooks/useActionFeedback'
import PaginationControls, { paginateRows, usePageSize } from '../components/common/PaginationControls'
import DataTableToolbar from '../components/common/DataTableToolbar'
import AlertMessage from '../components/common/AlertMessage'
import Modal from '../components/common/Modal'

const TRIP_TABS = [
  { value: 'OPEN', label: 'Open Trips' },
  { value: 'CLOSED', label: 'Closed Trips' },
]

const NO_CONVOY_LABEL = '—'

const formatNumber = (value, decimals = 3) => {
  const numberValue = Number(value || 0)

  return numberValue.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

const formatPercent = (value) => {
  return `${formatNumber(value, 4)}%`
}

const statusLabelMap = {
  PENDING_RECEIPT: 'Pending Receipt',
  ACKNOWLEDGED: 'Acknowledged',
  RECEIVED: 'Received',
  MATCHED: 'Matched',
  SEAL_MISMATCH: 'Seal Mismatch',
  QUANTITY_VARIANCE: 'Quantity Variance',
  CLOSED: 'Closed',
  NO_SENDER: 'No Sender',
}

const getTrackingStatusLabel = (status) => {
  return statusLabelMap[status] || status || '-'
}

const getTrackingStatusClass = (status) => {
  if (status === 'MATCHED') {
    return 'active'
  }

  if (status === 'PENDING_RECEIPT') {
    return 'draft'
  }

  if (status === 'ACKNOWLEDGED') {
    return 'submitted'
  }

  if (status === 'SEAL_MISMATCH' || status === 'QUANTITY_VARIANCE') {
    return 'rejected'
  }

  if (status === 'CLOSED') {
    return 'active'
  }
  return 'submitted'
}

const getSealStatusClass = (status) => {
  if (status === 'MATCHED') {
    return 'active'
  }

  if (status === 'NOT_ENTERED') {
    return 'draft'
  }

  if (
    status === 'MISMATCH' ||
    status === 'RECEIVER_MISSING' ||
    status === 'SENDER_MISSING'
  ) {
    return 'rejected'
  }

  return 'submitted'
}

function tankerLabel(group) {
  const name = group.tankerAssetName || ''
  const code = group.tankerAssetCode || '-'
  return name ? `${name} (${code})` : code
}

function tankerChassisLabel(group) {
  return group.tankerChassisNumber ? group.tankerChassisNumber : '-'
}

/**
 * Build convoy summaries from tanker tracking groups. A convoy is CLOSED only
 * when every tanker group in it is closed; otherwise it is OPEN.
 */
function buildTankerConvoys(rows = []) {
  const byConvoy = new Map()

  for (const group of rows) {
    const convoyNumber = String(group.convoyNumber || '').trim() || NO_CONVOY_LABEL
    if (!byConvoy.has(convoyNumber)) {
      byConvoy.set(convoyNumber, [])
    }
    byConvoy.get(convoyNumber).push(group)
  }

  return Array.from(byConvoy.entries()).map(([convoyNumber, convoyGroups]) => {
    const status =
      convoyGroups.every((g) => g.trackingStatus === 'CLOSED')
        ? 'CLOSED'
        : 'OPEN'

    const tankers = new Map()
    let firstDate = null
    let lastDate = null
    let ticketCount = 0

    for (const g of convoyGroups) {
      tankers.set(g.tankerAssetCode || 'UNKNOWN_TANKER', g)
      ticketCount += (g.senderTicket ? 1 : 0) + g.receiverTickets.length

      for (const t of [g.senderTicket, ...g.receiverTickets].filter(Boolean)) {
        const d = t.operationDate
        if (d && (!firstDate || d < firstDate)) firstDate = d
        if (d && (!lastDate || d > lastDate)) lastDate = d
      }
    }

    const sender = convoyGroups.find((g) => g.senderTicket)?.senderTicket
    const receiver = convoyGroups.find(
      (g) => g.latestReceiverTicket,
    )?.latestReceiverTicket

    const senderText = sender
      ? sender.senderName ||
          sender.originLocationName ||
          sender.senderCode ||
          sender.originLocationCode ||
          '-'
      : '-'
    const receiverText = receiver
      ? receiver.receiverName ||
          receiver.destinationLocationName ||
          receiver.receiverCode ||
          receiver.destinationLocationCode ||
          '-'
      : '-'

    return {
      convoyNumber,
      status,
      tankers: Array.from(tankers.values()),
      tankerCount: tankers.size,
      ticketCount,
      senderText,
      receiverText,
      firstOperationDate: firstDate || '-',
      lastOperationDate: lastDate || '-',
      groups: convoyGroups,
    }
  })
}

function TankerTracking({
  locations = [],
  operationTypes = [],
  operationTemplates = [],
  loggedInUser,
}) {
  const navigate = useNavigate()
  const location = useLocation()

  const isAdminBootstrap =
    loggedInUser?.isAdmin === true ||
    String(loggedInUser?.username || '').trim().toLowerCase() === 'admin' ||
    (Array.isArray(loggedInUser?.roles) &&
      loggedInUser.roles.some((role) =>
        String(role?.role_name || role?.roleName || '').trim().toLowerCase() ===
          'admin',
      ))

  const hasPermission = (permissionName) =>
    Boolean(
      loggedInUser?.permissions?.some(
        (p) => p.permissionName === permissionName,
      ),
    )

  const canManage = useMemo(() => {
    if (isAdminBootstrap) return true
    return hasPermission('Create Operation Entry')
  }, [loggedInUser])

  const canAcknowledgeReceipt =
    isAdminBootstrap ||
    canManage ||
    hasPermission('Acknowledge Shipment Receipt') ||
    hasPermission('Edit Tanker Tracking')

  const canCreateReceivingTicket =
    isAdminBootstrap || canManage || hasPermission('Create Receiving Ticket')

  const [report, setReport] = useState({
    rows: [],
    totalGroups: 0,
    pendingReceipts: 0,
    receivedGroups: 0,
    comparedGroups: 0,
    sealMismatchGroups: 0,
    quantityVarianceGroups: 0,
  })
  const [tripTab, setTripTab] = useState('OPEN')
  const [loading, setLoading] = useState(false)

  // Convoy list pagination
  const [convoyPage, setConvoyPage] = useState(1)
  const convoyPageSize = usePageSize()

  // Convoy detail (opened from the convoy list or via ?convoy_number=)
  const [convoyNumber, setConvoyNumber] = useState('')
  const [convoyDetailOpen, setConvoyDetailOpen] = useState(false)
  const [selectedConvoy, setSelectedConvoy] = useState(null)

  // Convoy comparison print
  const [convoyPrintOpen, setConvoyPrintOpen] = useState(false)

  // Action panels (acknowledge / revoke / close), opened from the convoy
  // detail, one tanker at a time - same state shape as before.
  const [ackGroup, setAckGroup] = useState(null)
  const [ackForm, setAckForm] = useState({
    receiverLocationCode: '',
    remarks: '',
  })
  const [revokeGroup, setRevokeGroup] = useState(null)
  const [revokeRemarks, setRevokeRemarks] = useState('')
  const [closeGroup, setCloseGroup] = useState(null)
  const [closureRemarks, setClosureRemarks] = useState('')

  // Action feedback: little pop-up (toast) + inline message near the action
  // area (owner rule 8).
  const feedback = useActionFeedback()
  const { notifySuccess, notifyError, clearSuccess, clearError } = feedback
  const [confirmRevokeGroup, setConfirmRevokeGroup] = useState(null)
  const [confirmCloseGroup, setConfirmCloseGroup] = useState(null)

  // Print MTR for a single tanker group
  const [printGroup, setPrintGroup] = useState(null)

  const tankerReceiverOperationTypes = useMemo(() => {
    return operationTypes.filter((operationType) => {
      if (operationType.status !== 'Active') {
        return false
      }

      const code = String(operationType.operationTypeCode || '').toUpperCase()
      const name = String(operationType.operationTypeName || '').toUpperCase()

      const looksLikeReceiver =
        code.includes('RECEIPT') ||
        code.includes('RECEIVE') ||
        code.includes('UNLOAD') ||
        code.includes('DISCHARGE') ||
        name.includes('RECEIPT') ||
        name.includes('RECEIVE') ||
        name.includes('UNLOAD') ||
        name.includes('DISCHARGE')

      const applicableAssetTypeCode = String(
        operationType.applicableAssetTypeCode || '',
      ).toUpperCase()

      const looksLikeTanker =
        code.includes('TANKER') ||
        name.includes('TANKER') ||
        applicableAssetTypeCode.includes('TANKER') ||
        applicableAssetTypeCode.includes('TRAILER') ||
        applicableAssetTypeCode.includes('TRUCK')

      return looksLikeReceiver && looksLikeTanker
    })
  }, [operationTypes])

  const getDefaultReceiverOperationTypeCode = () => {
    if (tankerReceiverOperationTypes.length === 0) {
      return ''
    }

    return tankerReceiverOperationTypes[0].operationTypeCode
  }

  const getDefaultReceiverTemplateId = (operationTypeCode) => {
    const matchingTemplates = operationTemplates.filter((template) => {
      const layout = String(template.entryLayoutType || '').toLowerCase()
      const engine = String(template.calculationEngine || '').toLowerCase()

      return (
        template.status === 'Active' &&
        template.operationTypeCode === operationTypeCode &&
        (layout.includes('tanker') || engine.includes('tanker'))
      )
    })

    if (matchingTemplates.length === 0) {
      return ''
    }

    return String(matchingTemplates[0].id)
  }

  const loadTracking = async () => {
    try {
      setLoading(true)

      const data = await getTankerTracking({})
      setReport(data)
      return data
    } catch (error) {
      notifyError(error.message || 'Unable to load Tanker Tracking')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadTracking()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const convoys = useMemo(
    () => buildTankerConvoys(report.rows || []),
    [report.rows],
  )

  const tabConvoys = convoys.filter(
    (convoy) =>
      tripTab === 'CLOSED' ? convoy.status === 'CLOSED' : convoy.status !== 'CLOSED',
  )

  const convoyCounts = useMemo(
    () => ({
      open: convoys.filter((c) => c.status !== 'CLOSED').length,
      closed: convoys.filter((c) => c.status === 'CLOSED').length,
    }),
    [convoys],
  )

  const convoyColumns = [
    { key: 'convoyNumber', label: 'Convoy No' },
    { key: 'status', label: 'Status' },
    { key: 'tankers', label: 'Tanker(s)', accessor: (row) =>
      row.tankers.map(tankerLabel).join(', ') },
    { key: 'ticketCount', label: 'Tickets', type: 'number' },
    { key: 'senderText', label: 'Sender' },
    { key: 'receiverText', label: 'Receiver' },
    { key: 'firstOperationDate', label: 'First Date', type: 'date' },
    { key: 'lastOperationDate', label: 'Last Date', type: 'date' },
  ]

  const convoyFilters = useDataFilters(tabConvoys, convoyColumns, {
    module: 'Tanker Tracking',
  })
  const filteredConvoyCount = convoyFilters.filteredRows.length
  const visibleConvoyRows = paginateRows(
    convoyFilters.filteredRows,
    convoyPage,
    convoyPageSize,
  )

  // Go back to page 1 when the tab or the filtered result set changes.
  const pageResetKey = `${tripTab}|${filteredConvoyCount}`
  const [appliedPageResetKey, setAppliedPageResetKey] = useState(pageResetKey)
  if (appliedPageResetKey !== pageResetKey) {
    setAppliedPageResetKey(pageResetKey)
    setConvoyPage(1)
  }

  const switchTripTab = (tab) => {
    if (tab === tripTab) return
    logUiAction('Tanker Tracking', 'Switch Trip Tab', { tab })
    setConvoyPage(1)
    setConvoyError('')
    setTripTab(tab)
  }

  const [convoyError, setConvoyError] = useState('')

  const openConvoy = async (convoyNo, reload = true) => {
    const clean = String(convoyNo || '').trim()
    if (!clean) return

    logUiAction('Tanker Tracking', 'Open Convoy', { convoyNumber: clean })
    setConvoyNumber(clean)
    setConvoyError('')

    const data = reload ? await loadTracking() : null
    const rows = (data ? data.rows : report.rows) || []

    const found = buildTankerConvoys(rows).find(
      (c) => c.convoyNumber === clean,
    )
    setSelectedConvoy(found || null)
    setConvoyDetailOpen(true)
    if (!found) {
      notifyError(`Convoy ${clean} not found`)
    }
  }

  const closeConvoyDetail = () => {
    setConvoyDetailOpen(false)
    setSelectedConvoy(null)
    setConvoyNumber('')
    setConvoyPrintOpen(false)
    feedback.clear()
  }

  const handleSearchConvoy = async (e) => {
    e.preventDefault()
    setConvoyDetailOpen(true)
    await openConvoy(convoyNumber, true)
  }

  // Auto-open the convoy detail when arriving with ?convoy_number=...
  const convoyFromUrl = useMemo(() => {
    const params = new URLSearchParams(location.search)
    return String(params.get('convoy_number') || '').trim()
  }, [location.search])
  const [autoOpenedConvoy, setAutoOpenedConvoy] = useState('')
  if (convoyFromUrl && autoOpenedConvoy !== convoyFromUrl) {
    setAutoOpenedConvoy(convoyFromUrl)
    openConvoy(convoyFromUrl, true)
  }

  const openConvoyComparisonReport = () => {
    const comparisons =
      (selectedConvoy?.groups || []).filter(
        (g) => Boolean(g.quantityComparison),
      ) || []
    if (comparisons.length === 0) {
      notifyError(
        'No approved tanker comparisons are available for this convoy yet.',
      )
      return
    }

    logUiAction('Tanker Tracking', 'Print Convoy Comparison Report', {
      convoyNumber: selectedConvoy.convoyNumber,
      comparisonCount: comparisons.length,
      tankerCount: selectedConvoy.tankerCount,
    })
    setConvoyPrintOpen(true)
    setTimeout(() => {
      try {
        window.print()
      } catch {
        // ignore
      }
    }, 250)
  }

  const closeConvoyComparisonReport = () => {
    setConvoyPrintOpen(false)
  }

  // -------------------------------------------------------------------------
  // Tanker group actions (acknowledge / revoke / close / receiver entry).
  // These panels are rendered at page level and opened from the convoy detail.
  // -------------------------------------------------------------------------

  const openAcknowledgePanel = (row) => {
    if (!row.senderTicket?.transactionId) {
      notifyError('Sender ticket is missing. Cannot acknowledge this tanker.')
      return
    }

    setAckGroup(row)
    setAckForm({
      // Clubbed Sender / Receiver: the tanker is received at the Receiver of
      // the sender ticket (receiver, else destination).
      receiverLocationCode: resolveReceiverCode(row.senderTicket) || '',
      remarks: '',
    })
  }

  const closeAcknowledgePanel = () => {
    setAckGroup(null)
    setAckForm({ receiverLocationCode: '', remarks: '' })
  }

  const handleAckFormChange = (e) => {
    const { name, value } = e.target

    setAckForm((current) => ({
      ...current,
      [name]: value,
    }))
  }

  const handleAcknowledge = async () => {
    if (!canManage) {
      notifyError('You do not have permission to acknowledge tanker receipt')
      return
    }
    if (!ackGroup?.senderTicket?.transactionId) {
      notifyError('Sender transaction is missing')
      return
    }

    if (ackForm.receiverLocationCode.trim() === '') {
      notifyError('Receiver Location is required for acknowledgement')
      return
    }

    try {
      setLoading(true)

      await acknowledgeTankerReceipt({
        senderTransactionId: ackGroup.senderTicket.transactionId,
        receiverLocationCode: ackForm.receiverLocationCode,
        remarks: ackForm.remarks,
      })

      notifySuccess('Tanker receipt acknowledged successfully')

      closeAcknowledgePanel()
      await loadTracking()
    } catch (error) {
      notifyError(error.message || 'Unable to acknowledge tanker receipt')
    } finally {
      setLoading(false)
    }
  }

  const openRevokePanel = (row) => {
    if (!row.acknowledgementId) {
      notifyError('Acknowledgement ID is missing.')
      return
    }

    setRevokeGroup(row)
    setRevokeRemarks('')
  }

  const closeRevokePanel = () => {
    setRevokeGroup(null)
    setRevokeRemarks('')
  }

  const confirmRevokeAction = async () => {
    const group = confirmRevokeGroup
    setConfirmRevokeGroup(null)
    if (!canManage) {
      notifyError('You do not have permission to revoke acknowledgement')
      return
    }
    if (!group?.acknowledgementId) return

    try {
      setLoading(true)

      await revokeTankerAcknowledgement({
        acknowledgementId: group.acknowledgementId,
        remarks: revokeRemarks,
      })

      notifySuccess('Acknowledgement revoked successfully')

      closeRevokePanel()
      await loadTracking()
    } catch (error) {
      notifyError(error.message || 'Unable to revoke acknowledgement')
    } finally {
      setLoading(false)
    }
  }

  const openClosePanel = (row) => {
    if (!row.acknowledgementId) {
      notifyError('Acknowledgement ID is missing. Cannot close this movement.')
      return
    }

    if (!row.latestReceiverTicket || !row.quantityComparison) {
      notifyError(
        'Movement can be closed only after receiver ticket is Approved and comparison is available.',
      )
      return
    }

    setCloseGroup(row)
    setClosureRemarks('')
  }

  const closeClosePanel = () => {
    setCloseGroup(null)
    setClosureRemarks('')
  }

  const confirmCloseAction = async () => {
    const group = confirmCloseGroup
    setConfirmCloseGroup(null)
    if (!canManage) {
      notifyError('You do not have permission to close tanker movement')
      return
    }
    if (!group?.acknowledgementId) return

    try {
      setLoading(true)

      await closeTankerMovement({
        acknowledgementId: group.acknowledgementId,
        closureRemarks,
      })

      notifySuccess('Tanker movement closed successfully')

      closeClosePanel()
      await loadTracking()
    } catch (error) {
      notifyError(error.message || 'Unable to close tanker movement')
    } finally {
      setLoading(false)
    }
  }

  const handleCreateReceiverEntry = (row) => {
    if (!row.senderTicket) {
      notifyError('Sender ticket is missing. Cannot create receiver entry.')
      return
    }

    const receiverOperationTypeCode = getDefaultReceiverOperationTypeCode()

    if (!receiverOperationTypeCode) {
      notifyError(
        'No active Tanker Receipt/Unloading operation type found. Please create an operation type such as TANKER_RECEIPT or TANKER_UNLOADING first.',
      )
      return
    }

    const receiverTemplateId = getDefaultReceiverTemplateId(
      receiverOperationTypeCode,
    )

    if (!receiverTemplateId) {
      notifyError(
        'No active Tanker Receiver template found for the selected receipt operation type. Please create an Operation Template with Entry Layout Type = Tanker Loading and Calculation Engine = Tanker Quantity.',
      )
      return
    }

    const params = new URLSearchParams()

    params.set('mode', 'tanker-receiver')
    params.set('source', 'tanker-tracking')
    params.set('sender_transaction_id', String(row.senderTicket.transactionId))
    // Server-side link: the receiver ticket inherits route and convoy from the sender ticket.
    params.set('linked_ticket_id', String(row.senderTicket.transactionId))
    params.set('operation_type_code', receiverOperationTypeCode)
    params.set('operation_template_id', receiverTemplateId)

    params.set('convoy_number', row.convoyNumber || '')
    params.set(
      'primary_asset_code',
      row.tankerAssetCode || row.primeMoverAssetCode || '',
    )

    // Clubbed Sender / Receiver pairing.
    const senderCode = resolveSenderCode(row.senderTicket)
    const receiverCode = resolveReceiverCode(row.senderTicket)
    const receivingTerminal = receiverCode || senderCode || ''

    params.set('origin_location_code', receivingTerminal)

    params.set('sender_location_code', senderCode)

    params.set('receiver_location_code', receiverCode)

    params.set('destination_location_code', receiverCode)

    params.set('product_name', row.productName || row.senderTicket.productName || '')

    params.set(
      'remarks',
      `Receiver entry against sender ticket ${
        row.senderTicket.ticketNumber || row.senderTicket.operationNumber
      }`,
    )

    navigate(`/operation-entry?${params.toString()}`)
  }

  const openOperationTicket = (transactionId) => {
    if (!transactionId) {
      notifyError('Transaction ID is missing.')
      return
    }

    navigate(`/operation-transactions/${transactionId}`)
  }

  const handlePrintMtrReport = (row) => {
    if (!row.senderTicket) {
      notifyError('Sender ticket is missing. Cannot print report.')
      return
    }

    if (!row.latestReceiverTicket || !row.quantityComparison) {
      notifyError(
        'MTR comparison report is available only after the receiver ticket is Approved and compared.',
      )
      return
    }

    logUiAction('Tanker Tracking', 'Print Comparison Report', {
      groupKey: row.groupKey,
    })
    setPrintGroup(row)

    window.setTimeout(() => {
      window.print()
    }, 100)
  }

  const renderTicketCard = (title, ticket) => {
    if (!ticket) {
      return (
        <div className="tracking-ticket-card empty">
          <h4>{title}</h4>
          <p>No ticket available.</p>
        </div>
      )
    }

    return (
      <div className="tracking-ticket-card">
        <div className="tracking-ticket-card-header">
          <h4>{title}</h4>

          {ticket.transactionId && (
            <button type="button" onClick={() => openOperationTicket(ticket.transactionId)}>
              Open Ticket
            </button>
          )}
        </div>

        <div className="tracking-ticket-grid">
          <span>Ticket</span>
          <strong>{ticket.ticketNumber || ticket.operationNumber}</strong>

          <span>Operation</span>
          <strong>{ticket.operationTypeName || ticket.operationTypeCode}</strong>

          <span>Date</span>
          <strong>{ticket.operationDate}</strong>

          <span>Location</span>
          <strong>
            {ticket.senderName ||
              ticket.originLocationName ||
              ticket.senderCode ||
              ticket.originLocationCode ||
              '-'}
          </strong>

          <span>Total Dip</span>
          <strong>{formatNumber(ticket.totalDipCm, 1)} cm</strong>

          <span>Water Dip</span>
          <strong>{formatNumber(ticket.waterDipCm, 1)} cm</strong>

          <span>GOV</span>
          <strong>{formatNumber(ticket.govBbl)} bbl</strong>

          <span>GSV</span>
          <strong>{formatNumber(ticket.gsvBbl)} bbl</strong>

          <span>NSV</span>
          <strong>{formatNumber(ticket.nsvBbl)} bbl</strong>

          <span>LT / MT</span>
          <strong>
            {formatNumber(ticket.lt)} / {formatNumber(ticket.mt)}
          </strong>
        </div>
      </div>
    )
  }

  const getRoleLabel = (movementRole) => {
    const value = String(movementRole || '').toUpperCase()
    return value === 'RECEIVER' ? 'Receiver' : value === 'SENDER' ? 'Sender' : 'Ticket'
  }

  return (
    <div>
      <div className="screen-only">
      {confirmRevokeGroup && (
        <div className="confirm-overlay">
          <div className="confirm-dialog">
            <p>
              Revoke acknowledgement for convoy {confirmRevokeGroup.convoyNumber}?
            </p>
            <div className="confirm-actions">
              <button onClick={confirmRevokeAction}>Yes</button>
              <button onClick={() => setConfirmRevokeGroup(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
      {confirmCloseGroup && (
        <div className="confirm-overlay">
          <div className="confirm-dialog">
            <p>
              Close tanker movement for convoy {confirmCloseGroup.convoyNumber}?
            </p>
            <div className="confirm-actions">
              <button onClick={confirmCloseAction}>Yes</button>
              <button onClick={() => setConfirmCloseGroup(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      <div className="page-title">
        <div>
          <h2>Tanker Tracking</h2>
          <p>
            Track road tanker dispatch, pending receipt, receiver entry,
            quantity variance and seal cross-check, grouped by convoy.
          </p>
        </div>
      </div>

      {/* Action feedback: right next to the page actions + a little pop-up
          toast - never at the bottom of the page (owner rule 8). */}
      <AlertMessage tone="success" message={feedback.successMsg} onDismiss={clearSuccess} />
      <AlertMessage tone="error" message={feedback.errorMsg} onDismiss={clearError} />

      <div className="info-box no-print">
        Tanker Tracking uses only <strong>Approved</strong> sender and receiver
        transactions. Draft or Submitted tickets will not move to receiver
        acknowledgement or comparison.
      </div>

      {!canManage && (
        <div className="info-box no-print">
          You have view-only access. Assign <strong>Create Operation Entry</strong> to
          acknowledge receipts, revoke acknowledgements, create receiver entries, or
          close tanker movements.
        </div>
      )}

      {/* Tanker trips: Open / Closed tabs with the standard filter bar */}
      <div className="section-title">
        <h3>Tanker Trips</h3>
        <p>
          Approved tanker trips grouped by convoy number. Open a convoy to view its
          tankers, comparisons and actions.
        </p>
      </div>

      <div className="list-tabs" role="tablist" aria-label="Tanker trip status">
        {TRIP_TABS.map((tab) => {
          const count = tab.value === 'CLOSED' ? convoyCounts.closed : convoyCounts.open
          const selected = tripTab === tab.value

          return (
            <button
              key={tab.value}
              type="button"
              role="tab"
              aria-selected={selected}
              className={`list-tab ${selected ? 'selected' : ''}`}
              onClick={() => switchTripTab(tab.value)}
            >
              {tab.label}
              <span className="list-tab-count">{count}</span>
            </button>
          )
        })}
      </div>

      <AlertMessage
        tone="error"
        message={convoyError}
        onDismiss={() => setConvoyError('')}
      />

      <DataTableToolbar
        filters={convoyFilters}
        columns={convoyFilters.columns}
        exportFileName={`tanker-convoys-${tripTab.toLowerCase()}`}
        exportTitle={`Tanker Convoys - ${tripTab === 'CLOSED' ? 'Closed' : 'Open'}`}
        module="Tanker Tracking"
      />

      <table>
        <thead>
          <tr>
            <th>Convoy No</th>
            <th>Status</th>
            <th>Tanker(s)</th>
            <th>Tickets</th>
            <th>Sender</th>
            <th>Receiver</th>
            <th>First Date</th>
            <th>Last Date</th>
            <th className="no-print">Action</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan="9" className="empty-table">Loading convoys...</td>
            </tr>
          ) : visibleConvoyRows.length === 0 ? (
            <tr>
              <td colSpan="9" className="empty-table">
                {tabConvoys.length === 0
                  ? `No ${tripTab === 'CLOSED' ? 'closed' : 'open'} tanker trips.`
                  : 'No convoys match the current filters.'}
              </td>
            </tr>
          ) : (
            visibleConvoyRows.map((row) => (
              <tr
                key={row.convoyNumber}
                className={row.convoyNumber === selectedConvoy?.convoyNumber ? 'is-selected' : ''}
              >
                <td><strong>{row.convoyNumber}</strong></td>
                <td>
                  <span
                    className={`status-badge ${
                      row.status === 'CLOSED' ? 'active' : 'draft'
                    }`}
                  >
                    {row.status === 'CLOSED' ? 'Closed' : 'Open'}
                  </span>
                </td>
                <td>{row.tankers.map(tankerLabel).join(', ') || '-'}</td>
                <td>{row.ticketCount}</td>
                <td>{row.senderText || '-'}</td>
                <td>{row.receiverText || '-'}</td>
                <td>{row.firstOperationDate || '-'}</td>
                <td>{row.lastOperationDate || '-'}</td>
                <td className="no-print">
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => openConvoy(row.convoyNumber, false)}
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
        currentPage={convoyPage}
        totalRows={filteredConvoyCount}
        onPageChange={setConvoyPage}
      />

      {/* Convoy Detail */}
      <Modal
        open={convoyDetailOpen}
        title="Convoy Detail"
        description="Search a convoy number, or open a convoy from the list above."
        onClose={closeConvoyDetail}
        size="xl"
      >
      <form onSubmit={handleSearchConvoy}>
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

      {!selectedConvoy ? (
        <div className="info-box">Enter Convoy Number and click Search.</div>
      ) : (
        <>
          <div className="section-title">
            <h3>Convoy: {selectedConvoy.convoyNumber}</h3>
            <p>
              Tankers: <strong>{selectedConvoy.tankerCount}</strong> | Tickets:{' '}
              <strong>{selectedConvoy.ticketCount}</strong> | Trip Status:{' '}
              <strong>
                {selectedConvoy.status === 'CLOSED' ? 'Closed' : 'Open'}
              </strong>
            </p>

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

            <div className="form-actions" style={{ marginTop: 10 }}>
              <button
                type="button"
                className="btn-secondary"
                disabled={
                  loading ||
                  !selectedConvoy.groups.some((g) => Boolean(g.quantityComparison))
                }
                onClick={openConvoyComparisonReport}
                title={
                  !selectedConvoy.groups.some((g) => Boolean(g.quantityComparison))
                    ? 'No approved comparisons are available for this convoy yet'
                    : 'Print dips and quantity comparisons for all tankers in this convoy'
                }
              >
                Print Convoy Comparison
              </button>

              {selectedConvoy.status === 'CLOSED' && (
                <button
                  type="button"
                  disabled={loading}
                  onClick={closeConvoyDetail}
                >
                  Close Detail
                </button>
              )}
            </div>

            {selectedConvoy.status === 'CLOSED' && (
              <div className="info-box">
                <strong>Trip Closed.</strong> All tanker movements in this
                convoy are closed.
              </div>
            )}
          </div>

          {selectedConvoy.groups.map((g) => {
            const acked = g.trackingStatus === 'ACKNOWLEDGED'
            const closed = g.trackingStatus === 'CLOSED'
            const pending = g.trackingStatus === 'PENDING_RECEIPT'

            return (
              <div key={g.groupKey} className="full-width-field">
                <div className="section-title">
                  <h3>{tankerLabel(g)}</h3>
                  <p>
                    Chassis: <strong>{tankerChassisLabel(g)}</strong> | Product:{' '}
                    <strong>{g.productName || '-'}</strong> |{' '}
                    Tracking Status:{' '}
                    <span
                      className={`status-badge ${getTrackingStatusClass(
                        g.trackingStatus,
                      )}`}
                    >
                      {getTrackingStatusLabel(g.trackingStatus)}
                    </span>
                  </p>

                  <div className="form-actions" style={{ marginTop: 8 }}>
                    {renderTicketCard('Sender Ticket', g.senderTicket)}
                    {renderTicketCard('Latest Receiver Ticket', g.latestReceiverTicket)}

                    {g.quantityComparison && (
                      <button
                        type="button"
                        onClick={() => handlePrintMtrReport(g)}
                        disabled={loading}
                      >
                        Print MTR
                      </button>
                    )}

                    {g.quantityComparison &&
                      g.acknowledgementId &&
                      g.trackingStatus !== 'CLOSED' && (
                        <button
                          type="button"
                          onClick={() => openClosePanel(g)}
                          disabled={loading || !canManage}
                          title={
                            !canManage
                              ? 'You do not have permission to close tanker movement'
                              : ''
                          }
                        >
                          Close Movement
                        </button>
                      )}

                    {pending && g.senderTicket && (
                      <button
                        type="button"
                        onClick={() => openAcknowledgePanel(g)}
                        disabled={loading || !canAcknowledgeReceipt}
                        title={
                          !canAcknowledgeReceipt
                            ? 'You do not have permission to acknowledge tanker receipt'
                            : ''
                        }
                      >
                        Acknowledge
                      </button>
                    )}

                    {acked && (
                      <>
                        <button
                          type="button"
                          onClick={() => handleCreateReceiverEntry(g)}
                          disabled={loading || !canCreateReceivingTicket}
                          title={
                            !canCreateReceivingTicket
                              ? 'You do not have permission to create receiver entry'
                              : ''
                          }
                        >
                          Create Receiver Entry
                        </button>

                        <button
                          type="button"
                          onClick={() => openRevokePanel(g)}
                          disabled={loading || !canAcknowledgeReceipt}
                          title={
                            !canAcknowledgeReceipt
                              ? 'You do not have permission to revoke acknowledgement'
                              : ''
                          }
                        >
                          Revoke Ack
                        </button>
                      </>
                    )}
                  </div>

                  {g.warningMessages.length > 0 && (
                    <div className="info-box">
                      {g.warningMessages.map((message) => (
                        <div key={message}>{message}</div>
                      ))}
                    </div>
                  )}

                  {closed && (
                    <div className="info-box">
                      <strong>Movement Closed</strong>
                      <div>Closed By: {g.closedBy || '-'}</div>
                      <div>Closed At: {g.closedAt || '-'}</div>
                      <div>Closure Remarks: {g.closureRemarks || '-'}</div>
                    </div>
                  )}
                </div>

                {/* Tickets */}
                <table>
                  <thead>
                    <tr>
                      <th>Ticket</th>
                      <th>Role</th>
                      <th>Operation</th>
                      <th>Date</th>
                      <th>Location</th>
                      <th>NSV</th>
                      <th>Status</th>
                      <th>Open</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { ticket: g.senderTicket, role: 'SENDER' },
                      ...(g.receiverTickets || []).map((ticket) => ({
                        ticket,
                        role: 'RECEIVER',
                      })),
                    ].length === 0 ? (
                      <tr>
                        <td colSpan="8" className="empty-table">
                          No tickets.
                        </td>
                      </tr>
                    ) : (
                      [
                        { ticket: g.senderTicket, role: 'SENDER' },
                        ...(g.receiverTickets || []).map((ticket) => ({
                          ticket,
                          role: 'RECEIVER',
                        })),
                      ].map((entry) => {
                        const t = entry.ticket
                        return (
                          <tr key={t?.transactionId}>
                            <td>
                              <strong>{t?.ticketNumber || t?.operationNumber}</strong>
                            </td>
                            <td>{getRoleLabel(entry.role)}</td>
                            <td>{t?.operationTypeName}</td>
                            <td>{t?.operationDate}</td>
                            <td>
                              {t?.senderName ||
                                t?.originLocationName ||
                                t?.senderCode ||
                                t?.originLocationCode ||
                                '-'}
                            </td>
                            <td className="number-cell">
                              {formatNumber(t?.nsvBbl)} bbl
                            </td>
                            <td>
                              <span
                                className={`status-badge ${
                                  String(t?.status || '').toLowerCase()
                                }`}
                              >
                                {t?.status}
                              </span>
                            </td>
                            <td>
                              <Link to={`/operation-transactions/${t.transactionId}`}>
                                <button type="button">View</button>
                              </Link>
                            </td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>

                {/* Seal Cross-check */}
                <div className="section-title compact-section-title">
                  <h3>Seal Cross-check</h3>
                </div>

                <table>
                  <thead>
                    <tr>
                      <th>Seal</th>
                      <th>Sender</th>
                      <th>Receiver</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.sealChecks.map((seal) => (
                      <tr key={seal.sealName}>
                        <td>{seal.sealName}</td>
                        <td>{seal.senderValue || '-'}</td>
                        <td>{seal.receiverValue || '-'}</td>
                        <td>
                          <span
                            className={`status-badge ${getSealStatusClass(
                              seal.status,
                            )}`}
                          >
                            {seal.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {g.sealChecks.length === 0 && (
                      <tr>
                        <td colSpan="4" className="empty-table">
                          No seal data recorded.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>

                {/* Quantity Comparison */}
                <div className="section-title compact-section-title">
                  <h3>Quantity Comparison</h3>
                </div>

                {g.quantityComparison ? (
                  <table className="comparison-table">
                    <thead>
                      <tr>
                        <th>Parameter</th>
                        <th className="number-cell">Sender</th>
                        <th className="number-cell">Receiver</th>
                        <th className="number-cell">Variance</th>
                        <th className="number-cell">Variance %</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>GOV</td>
                        <td className="number-cell">
                          {formatNumber(g.quantityComparison.senderGovBbl)} bbl
                        </td>
                        <td className="number-cell">
                          {formatNumber(g.quantityComparison.receiverGovBbl)} bbl
                        </td>
                        <td className="number-cell">
                          {formatNumber(g.quantityComparison.govVarianceBbl)} bbl
                        </td>
                        <td className="number-cell">-</td>
                      </tr>
                      <tr>
                        <td>GSV</td>
                        <td className="number-cell">
                          {formatNumber(g.quantityComparison.senderGsvBbl)} bbl
                        </td>
                        <td className="number-cell">
                          {formatNumber(g.quantityComparison.receiverGsvBbl)} bbl
                        </td>
                        <td className="number-cell">
                          {formatNumber(g.quantityComparison.gsvVarianceBbl)} bbl
                        </td>
                        <td className="number-cell">-</td>
                      </tr>
                      <tr>
                        <td>NSV</td>
                        <td className="number-cell">
                          {formatNumber(g.quantityComparison.senderNsvBbl)} bbl
                        </td>
                        <td className="number-cell">
                          {formatNumber(g.quantityComparison.receiverNsvBbl)} bbl
                        </td>
                        <td className="number-cell">
                          {formatNumber(g.quantityComparison.nsvVarianceBbl)} bbl
                        </td>
                        <td className="number-cell">
                          {formatPercent(g.quantityComparison.nsvVariancePercent)}
                        </td>
                      </tr>
                      <tr>
                        <td>LT</td>
                        <td className="number-cell">
                          {formatNumber(g.quantityComparison.senderLt)}
                        </td>
                        <td className="number-cell">
                          {formatNumber(g.quantityComparison.receiverLt)}
                        </td>
                        <td className="number-cell">
                          {formatNumber(g.quantityComparison.ltVariance)}
                        </td>
                        <td className="number-cell">-</td>
                      </tr>
                      <tr>
                        <td>MT</td>
                        <td className="number-cell">
                          {formatNumber(g.quantityComparison.senderMt)}
                        </td>
                        <td className="number-cell">
                          {formatNumber(g.quantityComparison.receiverMt)}
                        </td>
                        <td className="number-cell">
                          {formatNumber(g.quantityComparison.mtVariance)}
                        </td>
                        <td className="number-cell">-</td>
                      </tr>
                    </tbody>
                  </table>
                ) : (
                  <div className="info-box">
                    No receiver ticket is available yet. Quantity comparison will
                    appear after receiver tanker entry is saved with the same
                    convoy and tanker.
                  </div>
                )}
              </div>
            )
          })}
        </>)}
      </Modal>
      </div>

      {printGroup && (
        <div className="print-only">
          <TankerMtrComparisonReport group={printGroup} />
        </div>
      )}

      {convoyPrintOpen && (
        <div className="print-only">
          <TankerConvoyComparisonReport
            convoyNumber={selectedConvoy?.convoyNumber || convoyNumber}
            groups={selectedConvoy?.groups || []}
            generatedBy={loggedInUser?.fullName || loggedInUser?.username || ''}
          />
          <div className="no-print" style={{ marginTop: 10 }}>
            <button type="button" onClick={closeConvoyComparisonReport}>
              Close Report
            </button>
          </div>
        </div>
      )}

      {ackGroup && (
        <div className="report-detail-panel no-print">
          <div className="report-detail-header">
            <div>
              <h3>Acknowledge Tanker Receipt</h3>
              <p>
                Convoy {ackGroup.convoyNumber} /{' '}
                {ackGroup.tankerAssetName || ackGroup.tankerAssetCode}
              </p>
            </div>

            <button type="button" onClick={closeAcknowledgePanel}>
              Close
            </button>
          </div>

          <div className="tracking-detail-grid">
            <div className="tracking-ticket-card">
              <h4>Sender Reference</h4>

              <div className="tracking-ticket-grid">
                <span>Sender Ticket</span>
                <strong>
                  {ackGroup.senderTicket?.ticketNumber ||
                    ackGroup.senderTicket?.operationNumber ||
                    '-'}
                </strong>

                <span>Convoy</span>
                <strong>{ackGroup.convoyNumber}</strong>

                <span>Prime Mover</span>
                <strong>
                  {ackGroup.primeMoverAssetName || '-'} (
                  {ackGroup.primeMoverAssetCode || '-'})
                </strong>

                <span>Tanker</span>
                <strong>
                  {ackGroup.tankerAssetName || '-'} (
                  {ackGroup.tankerAssetCode || '-'})
                </strong>

                <span>Chassis</span>
                <strong>{ackGroup.tankerChassisNumber || '-'}</strong>

                <span>Sender NSV</span>
                <strong>
                  {ackGroup.senderTicket
                    ? `${formatNumber(ackGroup.senderTicket.nsvBbl)} bbl`
                    : '-'}
                </strong>

                <span>Sender Seals</span>
                <strong>
                  C1: {ackGroup.senderTicket?.sealC1 || '-'} / C2:{' '}
                  {ackGroup.senderTicket?.sealC2 || '-'} / M1:{' '}
                  {ackGroup.senderTicket?.sealM1 || '-'} / M2:{' '}
                  {ackGroup.senderTicket?.sealM2 || '-'}
                </strong>
              </div>
            </div>

            <div className="tracking-ticket-card">
              <h4>Receiver Acknowledgement</h4>

              <div className="operation-entry-subgrid">
                <div>
                  <label>Receiver Location *</label>
                  <select
                    name="receiverLocationCode"
                    value={ackForm.receiverLocationCode}
                    onChange={handleAckFormChange}
                  >
                    <option value="">Select Receiver Location</option>

                    {locations.map((location) => (
                      <option key={location.id} value={location.locationCode}>
                        {location.locationName} ({location.locationCode})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="full-width-field">
                  <label>Acknowledgement Remarks</label>
                  <textarea
                    name="remarks"
                    rows="3"
                    value={ackForm.remarks}
                    onChange={handleAckFormChange}
                    placeholder="Example: Tanker arrived at receiving location"
                  />
                </div>
              </div>

              <div className="form-actions">
                <button
                  type="button"
                  onClick={handleAcknowledge}
                  disabled={loading}
                >
                  {loading ? 'Acknowledging...' : 'Confirm Acknowledge'}
                </button>

                <button
                  type="button"
                  onClick={closeAcknowledgePanel}
                  disabled={loading}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {revokeGroup && (
        <div className="report-detail-panel no-print">
          <div className="report-detail-header">
            <div>
              <h3>Revoke Tanker Acknowledgement</h3>
              <p>
                Convoy {revokeGroup.convoyNumber} /{' '}
                {revokeGroup.tankerAssetName || revokeGroup.tankerAssetCode}
              </p>
            </div>

            <button type="button" onClick={closeRevokePanel}>
              Close
            </button>
          </div>

          <div className="info-box">
            This will revoke the receiver acknowledgement and return the tanker
            tracking row to Pending Receipt, unless receiver entry already
            exists.
          </div>

          <div className="operation-entry-subgrid">
            <div className="full-width-field">
              <label>Revoke Remarks</label>
              <textarea
                rows="3"
                value={revokeRemarks}
                onChange={(e) => setRevokeRemarks(e.target.value)}
                placeholder="Example: Wrong tanker acknowledged / duplicate acknowledgement"
              />
            </div>
          </div>

          <div className="form-actions">
            <button
              type="button"
              onClick={confirmRevokeAction}
              disabled={loading}
            >
              {loading ? 'Revoking...' : 'Confirm Revoke'}
            </button>

            <button
              type="button"
              onClick={closeRevokePanel}
              disabled={loading}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {closeGroup && (
        <div className="report-detail-panel no-print">
          <div className="report-detail-header">
            <div>
              <h3>Close Tanker Movement</h3>
              <p>
                Convoy {closeGroup.convoyNumber} /{' '}
                {closeGroup.tankerAssetName || closeGroup.tankerAssetCode}
              </p>
            </div>

            <button type="button" onClick={closeClosePanel}>
              Close
            </button>
          </div>

          <div className="info-box">
            Closing confirms that sender and receiver comparison has been
            reviewed. This does not modify sender or receiver tickets.
          </div>

          {closeGroup.quantityComparison && (
            <table className="comparison-table">
              <thead>
                <tr>
                  <th>Parameter</th>
                  <th className="number-cell">Sender</th>
                  <th className="number-cell">Receiver</th>
                  <th className="number-cell">Variance</th>
                  <th className="number-cell">Variance %</th>
                </tr>
              </thead>

              <tbody>
                <tr>
                  <td>NSV</td>
                  <td className="number-cell">
                    {formatNumber(closeGroup.quantityComparison.senderNsvBbl)} bbl
                  </td>
                  <td className="number-cell">
                    {formatNumber(closeGroup.quantityComparison.receiverNsvBbl)} bbl
                  </td>
                  <td className="number-cell">
                    {formatNumber(closeGroup.quantityComparison.nsvVarianceBbl)} bbl
                  </td>
                  <td className="number-cell">-</td>
                </tr>

                <tr>
                  <td>LT</td>
                  <td className="number-cell">
                    {formatNumber(closeGroup.quantityComparison.senderLt)}
                  </td>
                  <td className="number-cell">
                    {formatNumber(closeGroup.quantityComparison.receiverLt)}
                  </td>
                  <td className="number-cell">
                    {formatNumber(closeGroup.quantityComparison.ltVariance)}
                  </td>
                  <td className="number-cell">-</td>
                </tr>

                <tr>
                  <td>MT</td>
                  <td className="number-cell">
                    {formatNumber(closeGroup.quantityComparison.senderMt)}
                  </td>
                  <td className="number-cell">
                    {formatNumber(closeGroup.quantityComparison.receiverMt)}
                  </td>
                  <td className="number-cell">
                    {formatNumber(closeGroup.quantityComparison.mtVariance)}
                  </td>
                  <td className="number-cell">-</td>
                </tr>
              </tbody>
            </table>
          )}

          <div className="operation-entry-subgrid">
            <div className="full-width-field">
              <label>Closure / Settlement Remarks</label>
              <textarea
                rows="4"
                value={closureRemarks}
                onChange={(e) => setClosureRemarks(e.target.value)}
                placeholder="Example: Variance reviewed and accepted within operational tolerance."
              />
            </div>
          </div>

          <div className="form-actions">
            <button
              type="button"
              onClick={confirmCloseAction}
              disabled={loading}
            >
              {loading ? 'Closing...' : 'Confirm Close Movement'}
            </button>

            <button type="button" onClick={closeClosePanel} disabled={loading}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default TankerTracking
