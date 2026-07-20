import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  acknowledgeTankerReceipt,
  closeTankerMovement,
  getTankerTracking,
  revokeTankerAcknowledgement,
} from '../api/tankerTrackingApi'
import TankerMtrComparisonReport from '../components/reports/TankerMtrComparisonReport'

const today = new Date().toISOString().slice(0, 10)

const defaultFilters = {
  date_from: '',
  date_to: '',
  convoy_number: '',
  location_code: '',
  tanker_asset_code: '',
  search: '',
}

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

const escapeCsvValue = (value) => {
  const text = String(value ?? '')

  if (text.includes(',') || text.includes('"') || text.includes('\n')) {
    return `"${text.replace(/"/g, '""')}"`
  }

  return text
}

function TankerTracking({
  locations = [],
  assets = [],
  operationTypes = [],
  operationTemplates = [],
}) {
  const navigate = useNavigate()
  const [filters, setFilters] = useState(defaultFilters)
  const [report, setReport] = useState({
    rows: [],
    totalGroups: 0,
    pendingReceipts: 0,
    receivedGroups: 0,
    comparedGroups: 0,
    sealMismatchGroups: 0,
    quantityVarianceGroups: 0,
  })
  const [trackingStatusFilter, setTrackingStatusFilter] = useState('ALL')
  const [selectedGroup, setSelectedGroup] = useState(null)
  const [printGroup, setPrintGroup] = useState(null)
  const [ackGroup, setAckGroup] = useState(null)
  const [ackForm, setAckForm] = useState({
    receiverLocationCode: '',
    remarks: '',
  })
  const [revokeGroup, setRevokeGroup] = useState(null)
  const [revokeRemarks, setRevokeRemarks] = useState('')
  const [loading, setLoading] = useState(false)
  const [closeGroup, setCloseGroup] = useState(null)
  const [closureRemarks, setClosureRemarks] = useState('')
  const [successMsg, setSuccessMsg] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [confirmRevokeGroup, setConfirmRevokeGroup] = useState(null)
  const [confirmCloseGroup, setConfirmCloseGroup] = useState(null)
  
  const trackingExceptionSummary = useMemo(() => {
    const rows = report.rows || []

    return {
      all: rows.length,
      pendingReceipt: rows.filter((row) => row.trackingStatus === 'PENDING_RECEIPT')
        .length,
      acknowledged: rows.filter((row) => row.trackingStatus === 'ACKNOWLEDGED')
        .length,
      sealMismatch: rows.filter((row) => row.trackingStatus === 'SEAL_MISMATCH')
        .length,
      quantityVariance: rows.filter(
        (row) => row.trackingStatus === 'QUANTITY_VARIANCE'
      ).length,
      matched: rows.filter((row) => row.trackingStatus === 'MATCHED').length,
      closed: rows.filter((row) => row.trackingStatus === 'CLOSED').length,
      noSender: rows.filter((row) => row.trackingStatus === 'NO_SENDER').length,
    }
  }, [report.rows])

  const filteredTrackingRows = useMemo(() => {
    if (trackingStatusFilter === 'ALL') {
      return report.rows || []
    }

    return (report.rows || []).filter((row) => {
      return row.trackingStatus === trackingStatusFilter
    })
  }, [report.rows, trackingStatusFilter])

  const tankerAssets = useMemo(() => {
    return assets.filter((asset) => {
      const typeCode = String(asset.assetTypeCode || '').toUpperCase()
      const name = String(asset.assetName || '').toUpperCase()

      return (
        typeCode.includes('TANKER') ||
        typeCode.includes('TRAILER') ||
        typeCode.includes('TRUCK') ||
        name.includes('TANKER') ||
        name.includes('TRAILER')
      )
    })
  }, [assets])

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
        operationType.applicableAssetTypeCode || ''
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

      const data = await getTankerTracking(filters)

      setReport(data)

      if (selectedGroup) {
        const refreshedSelectedGroup = data.rows.find((row) => {
          return row.groupKey === selectedGroup.groupKey
        })

        setSelectedGroup(refreshedSelectedGroup || null)
      }
    } catch (error) {
      setErrorMsg(error.message || 'Unable to load Tanker Tracking')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadTracking()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleFilterChange = (e) => {
    const { name, value } = e.target

    setFilters((current) => ({
      ...current,
      [name]: value,
    }))
  }

  const handleClearFilters = () => {
    setFilters(defaultFilters)
  }

  const openAcknowledgePanel = (row) => {
    if (!row.senderTicket?.transactionId) {
      setErrorMsg('Sender ticket is missing. Cannot acknowledge this tanker.')
      return
    }

    setAckGroup(row)
    setAckForm({
      receiverLocationCode:
        row.senderTicket.receiverLocationCode ||
        row.senderTicket.destinationLocationCode ||
        '',
      remarks: '',
    })
  }

  const closeAcknowledgePanel = () => {
    setAckGroup(null)
    setAckForm({
      receiverLocationCode: '',
      remarks: '',
    })
  }

  const handleAckFormChange = (e) => {
    const { name, value } = e.target

    setAckForm((current) => ({
      ...current,
      [name]: value,
    }))
  }

  const handleAcknowledge = async () => {
    if (!ackGroup?.senderTicket?.transactionId) {
      setErrorMsg('Sender transaction is missing')
      return
    }

    if (ackForm.receiverLocationCode.trim() === '') {
      setErrorMsg('Receiver Location is required for acknowledgement')
      return
    }

    try {
      setLoading(true)

      await acknowledgeTankerReceipt({
        senderTransactionId: ackGroup.senderTicket.transactionId,
        receiverLocationCode: ackForm.receiverLocationCode,
        remarks: ackForm.remarks,
      })

      setSuccessMsg('Tanker receipt acknowledged successfully')

      closeAcknowledgePanel()
      await loadTracking()
    } catch (error) {
      setErrorMsg(error.message || 'Unable to acknowledge tanker receipt')
    } finally {
      setLoading(false)
    }
  }

  const openRevokePanel = (row) => {
    if (!row.acknowledgementId) {
      setErrorMsg('Acknowledgement ID is missing.')
      return
    }

    setRevokeGroup(row)
    setRevokeRemarks('')
  }

  const closeRevokePanel = () => {
    setRevokeGroup(null)
    setRevokeRemarks('')
  }

  const handleRevokeAcknowledgement = async () => {
    if (!revokeGroup?.acknowledgementId) {
      setErrorMsg('Acknowledgement ID is missing.')
      return
    }

    setConfirmRevokeGroup(revokeGroup)
  }

  const confirmRevokeAction = async () => {
    const group = confirmRevokeGroup
    setConfirmRevokeGroup(null)
    if (!group?.acknowledgementId) return

    try {
      setLoading(true)

      await revokeTankerAcknowledgement({
        acknowledgementId: group.acknowledgementId,
        remarks: revokeRemarks,
      })

      setSuccessMsg('Acknowledgement revoked successfully')

      closeRevokePanel()
      await loadTracking()
    } catch (error) {
      setErrorMsg(error.message || 'Unable to revoke acknowledgement')
    } finally {
      setLoading(false)
    }
  }

  const openClosePanel = (row) => {
    if (!row.acknowledgementId) {
      setErrorMsg('Acknowledgement ID is missing. Cannot close this movement.')
      return
    }

    if (!row.latestReceiverTicket || !row.quantityComparison) {
      setErrorMsg(
        'Movement can be closed only after receiver ticket is Approved and comparison is available.'
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

  const handleCloseMovement = async () => {
    if (!closeGroup?.acknowledgementId) {
      setErrorMsg('Acknowledgement ID is missing.')
      return
    }

    setConfirmCloseGroup(closeGroup)
  }

  const confirmCloseAction = async () => {
    const group = confirmCloseGroup
    setConfirmCloseGroup(null)
    if (!group?.acknowledgementId) return

    try {
      setLoading(true)

      await closeTankerMovement({
        acknowledgementId: group.acknowledgementId,
        closureRemarks,
      })

      setSuccessMsg('Tanker movement closed successfully')

      closeClosePanel()
      await loadTracking()
    } catch (error) {
      setErrorMsg(error.message || 'Unable to close tanker movement')
    } finally {
      setLoading(false)
    }
  }

  const handleCreateReceiverEntry = (row) => {
    if (!row.senderTicket) {
      setErrorMsg('Sender ticket is missing. Cannot create receiver entry.')
      return
    }

    const receiverOperationTypeCode = getDefaultReceiverOperationTypeCode()

    if (!receiverOperationTypeCode) {
      setErrorMsg(
        'No active Tanker Receipt/Unloading operation type found. Please create an operation type such as TANKER_RECEIPT or TANKER_UNLOADING first.'
      )
      return
    }

    const receiverTemplateId = getDefaultReceiverTemplateId(
      receiverOperationTypeCode
    )

    if (!receiverTemplateId) {
      setErrorMsg(
        'No active Tanker Receiver template found for the selected receipt operation type. Please create an Operation Template with Entry Layout Type = Tanker Loading and Calculation Engine = Tanker Quantity.'
      )
      return
    }

    const params = new URLSearchParams()

    params.set('mode', 'tanker-receiver')
    params.set('source', 'tanker-tracking')
    params.set('sender_transaction_id', String(row.senderTicket.transactionId))
    params.set('operation_type_code', receiverOperationTypeCode)
    params.set('operation_template_id', receiverTemplateId)

    params.set('convoy_number', row.convoyNumber || '')
    params.set(
      'primary_asset_code',
      row.tankerAssetCode || row.primeMoverAssetCode || ''
    )

    params.set(
      'origin_location_code',
      row.senderTicket.receiverLocationCode ||
        row.senderTicket.destinationLocationCode ||
        row.senderTicket.originLocationCode ||
        ''
    )

    params.set(
      'sender_location_code',
      row.senderTicket.originLocationCode ||
        row.senderTicket.senderLocationCode ||
        ''
    )

    params.set(
      'receiver_location_code',
      row.senderTicket.receiverLocationCode ||
        row.senderTicket.destinationLocationCode ||
        ''
    )

    params.set(
      'destination_location_code',
      row.senderTicket.receiverLocationCode ||
        row.senderTicket.destinationLocationCode ||
        ''
    )

    params.set('product_name', row.productName || row.senderTicket.productName || '')

    params.set(
      'remarks',
      `Receiver entry against sender ticket ${
        row.senderTicket.ticketNumber || row.senderTicket.operationNumber
      }`
    )

    navigate(`/operation-entry?${params.toString()}`)
  }

  const openOperationTicket = (transactionId) => {
    if (!transactionId) {
      setErrorMsg('Transaction ID is missing.')
      return
    }

    navigate(`/operation-transactions/${transactionId}`)
  }

  const handlePrintMtrReport = (row) => {
    if (!row.senderTicket) {
      setErrorMsg('Sender ticket is missing. Cannot print report.')
      return
    }

    if (!row.latestReceiverTicket || !row.quantityComparison) {
      setErrorMsg(
        'MTR comparison report is available only after the receiver ticket is Approved and compared.'
      )
      return
    }

    setPrintGroup(row)

    window.setTimeout(() => {
      window.print()
    }, 100)
  }

  const exportCsv = () => {
    const headers = [
      'Convoy Number',
      'Tracking Status',
      'Prime Mover',
      'Tanker',
      'Chassis',
      'Product',
      'Sender Ticket',
      'Receiver Ticket',
      'Sender NSV',
      'Receiver NSV',
      'NSV Variance',
      'NSV Variance %',
      'Seal C1',
      'Seal C2',
      'Seal M1',
      'Seal M2',
    ]

    const rows = filteredTrackingRows.map((row) => {
      const comparison = row.quantityComparison
      const sender = row.senderTicket
      const receiver = row.latestReceiverTicket

      const sealStatus = {}
      row.sealChecks.forEach((seal) => {
        sealStatus[seal.sealName] = seal.status
      })

      return [
        row.convoyNumber,
        getTrackingStatusLabel(row.trackingStatus),
        `${row.primeMoverAssetName || ''} (${row.primeMoverAssetCode || ''})`,
        `${row.tankerAssetName || ''} (${row.tankerAssetCode || ''})`,
        row.tankerChassisNumber,
        row.productName,
        sender?.ticketNumber || '',
        receiver?.ticketNumber || '',
        comparison?.senderNsvBbl ?? '',
        comparison?.receiverNsvBbl ?? '',
        comparison?.nsvVarianceBbl ?? '',
        comparison?.nsvVariancePercent ?? '',
        sealStatus.C1 || '',
        sealStatus.C2 || '',
        sealStatus.M1 || '',
        sealStatus.M2 || '',
      ]
    })

    const csv = [headers, ...rows]
      .map((row) => row.map(escapeCsvValue).join(','))
      .join('\n')

    const blob = new Blob([csv], {
      type: 'text/csv;charset=utf-8;',
    })

    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')

    link.href = url
    link.download = `tanker-tracking-${today}.csv`
    link.click()

    URL.revokeObjectURL(url)
  }

  const exportExcel = () => {
    const rowsHtml = filteredTrackingRows
      .map((row) => {
        const comparison = row.quantityComparison
        const sender = row.senderTicket
        const receiver = row.latestReceiverTicket

        return `
          <tr>
            <td>${row.convoyNumber || ''}</td>
            <td>${getTrackingStatusLabel(row.trackingStatus)}</td>
            <td>${row.primeMoverAssetName || ''} (${row.primeMoverAssetCode || ''})</td>
            <td>${row.tankerAssetName || ''} (${row.tankerAssetCode || ''})</td>
            <td>${row.tankerChassisNumber || ''}</td>
            <td>${row.productName || ''}</td>
            <td>${sender?.ticketNumber || ''}</td>
            <td>${receiver?.ticketNumber || ''}</td>
            <td>${comparison?.senderNsvBbl ?? ''}</td>
            <td>${comparison?.receiverNsvBbl ?? ''}</td>
            <td>${comparison?.nsvVarianceBbl ?? ''}</td>
            <td>${comparison?.nsvVariancePercent ?? ''}</td>
          </tr>
        `
      })
      .join('')

    const html = `
      <table border="1">
        <thead>
          <tr>
            <th>Convoy Number</th>
            <th>Status</th>
            <th>Prime Mover</th>
            <th>Tanker</th>
            <th>Chassis</th>
            <th>Product</th>
            <th>Sender Ticket</th>
            <th>Receiver Ticket</th>
            <th>Sender NSV</th>
            <th>Receiver NSV</th>
            <th>NSV Variance</th>
            <th>Variance %</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    `

    const blob = new Blob([html], {
      type: 'application/vnd.ms-excel',
    })

    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')

    link.href = url
    link.download = `tanker-tracking-${today}.xls`
    link.click()

    URL.revokeObjectURL(url)
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
            <button
              type="button"
              onClick={() => openOperationTicket(ticket.transactionId)}
            >
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
            {ticket.originLocationName || ticket.originLocationCode || '-'}
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
      {confirmRevokeGroup && (
        <div className="confirm-overlay">
          <div className="confirm-dialog">
            <p>Revoke acknowledgement for convoy {confirmRevokeGroup.convoyNumber}?</p>
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
            <p>Close tanker movement for convoy {confirmCloseGroup.convoyNumber}?</p>
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
            quantity variance and seal cross-check.
          </p>
        </div>

        <span className="record-count">{report.totalGroups} Groups</span>
      </div>

      <div className="report-summary-grid no-print">
        <div className="report-summary-card">
          <span>Total Groups</span>
          <strong>{report.totalGroups}</strong>
        </div>

        <div className="report-summary-card">
          <span>Pending Receipt</span>
          <strong>{report.pendingReceipts}</strong>
        </div>

        <div className="report-summary-card">
          <span>Received</span>
          <strong>{report.receivedGroups}</strong>
        </div>

        <div className="report-summary-card">
          <span>Compared</span>
          <strong>{report.comparedGroups}</strong>
        </div>

        <div className="report-summary-card">
          <span>Seal Mismatch</span>
          <strong>{report.sealMismatchGroups}</strong>
        </div>

        <div className="report-summary-card">
          <span>Quantity Variance</span>
          <strong>{report.quantityVarianceGroups}</strong>
        </div>
      </div>

      <div className="tanker-exception-dashboard no-print">
        <button
          type="button"
          className={`exception-card ${
            trackingStatusFilter === 'ALL' ? 'selected' : ''
          }`}
          onClick={() => setTrackingStatusFilter('ALL')}
        >
          <span>All</span>
          <strong>{trackingExceptionSummary.all}</strong>
        </button>

        <button
          type="button"
          className={`exception-card pending ${
            trackingStatusFilter === 'PENDING_RECEIPT' ? 'selected' : ''
          }`}
          onClick={() => setTrackingStatusFilter('PENDING_RECEIPT')}
        >
          <span>Pending Receipt</span>
          <strong>{trackingExceptionSummary.pendingReceipt}</strong>
        </button>

        <button
          type="button"
          className={`exception-card acknowledged ${
            trackingStatusFilter === 'ACKNOWLEDGED' ? 'selected' : ''
          }`}
          onClick={() => setTrackingStatusFilter('ACKNOWLEDGED')}
        >
          <span>Acknowledged</span>
          <strong>{trackingExceptionSummary.acknowledged}</strong>
        </button>

        <button
          type="button"
          className={`exception-card danger ${
            trackingStatusFilter === 'SEAL_MISMATCH' ? 'selected' : ''
          }`}
          onClick={() => setTrackingStatusFilter('SEAL_MISMATCH')}
        >
          <span>Seal Mismatch</span>
          <strong>{trackingExceptionSummary.sealMismatch}</strong>
        </button>

        <button
          type="button"
          className={`exception-card warning ${
            trackingStatusFilter === 'QUANTITY_VARIANCE' ? 'selected' : ''
          }`}
          onClick={() => setTrackingStatusFilter('QUANTITY_VARIANCE')}
        >
          <span>Quantity Variance</span>
          <strong>{trackingExceptionSummary.quantityVariance}</strong>
        </button>

        <button
          type="button"
          className={`exception-card success ${
            trackingStatusFilter === 'MATCHED' ? 'selected' : ''
          }`}
          onClick={() => setTrackingStatusFilter('MATCHED')}
        >
          <span>Matched</span>
          <strong>{trackingExceptionSummary.matched}</strong>
        </button>

        <button
          type="button"
          className={`exception-card success ${
            trackingStatusFilter === 'CLOSED' ? 'selected' : ''
          }`}
          onClick={() => setTrackingStatusFilter('CLOSED')}
        >
          <span>Closed</span>
          <strong>{trackingExceptionSummary.closed}</strong>
        </button>
      </div>

      {trackingStatusFilter !== 'ALL' && (
        <div className="info-box no-print">
          Showing tanker tracking rows with status:{' '}
          <strong>{getTrackingStatusLabel(trackingStatusFilter)}</strong>.
          <button
            type="button"
            className="inline-action-btn"
            onClick={() => setTrackingStatusFilter('ALL')}
          >
            Show All
          </button>
        </div>
      )}

      <div className="info-box no-print">
        Tanker Tracking uses only <strong>Approved</strong> sender and receiver
        transactions. Draft or Submitted tickets will not move to receiver
        acknowledgement or comparison.
      </div>

      <div className="report-filter-panel no-print">
        <div>
          <label>Date From</label>
          <input
            type="date"
            name="date_from"
            value={filters.date_from}
            onChange={handleFilterChange}
          />
        </div>

        <div>
          <label>Date To</label>
          <input
            type="date"
            name="date_to"
            value={filters.date_to}
            onChange={handleFilterChange}
          />
        </div>

        <div>
          <label>Convoy Number</label>
          <input
            name="convoy_number"
            value={filters.convoy_number}
            onChange={handleFilterChange}
            placeholder="CNV..."
          />
        </div>

        <div>
          <label>Location</label>
          <select
            name="location_code"
            value={filters.location_code}
            onChange={handleFilterChange}
          >
            <option value="">All Locations</option>
            {locations.map((location) => (
              <option key={location.id} value={location.locationCode}>
                {location.locationName} ({location.locationCode})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label>Tanker</label>
          <select
            name="tanker_asset_code"
            value={filters.tanker_asset_code}
            onChange={handleFilterChange}
          >
            <option value="">All Tankers</option>
            {tankerAssets.map((asset) => (
              <option key={asset.id} value={asset.assetCode}>
                {asset.assetName} ({asset.assetCode})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label>Search</label>
          <input
            name="search"
            value={filters.search}
            onChange={handleFilterChange}
            placeholder="Ticket / convoy / tanker"
          />
        </div>

        <div className="report-filter-actions">
          <button type="button" onClick={loadTracking} disabled={loading}>
            {loading ? 'Loading...' : 'Load'}
          </button>

          <button type="button" onClick={handleClearFilters} disabled={loading}>
            Clear
          </button>
        </div>
      </div>

      {tankerReceiverOperationTypes.length === 0 && (
        <div className="info-box no-print">
          No active Tanker Receipt / Unloading operation type was detected.
          Create one in Operation Type Master before using Create Receiver
          Entry. Recommended code: <strong>TANKER_RECEIPT</strong>.
        </div>
      )}

      <div className="report-actions no-print">
        <button type="button" onClick={exportCsv} disabled={loading}>
          Export CSV
        </button>

        <button type="button" onClick={exportExcel} disabled={loading}>
          Export Excel
        </button>

        <button type="button" onClick={() => window.print()}>
          Print
        </button>
      </div>

      <table>
        <thead>
          <tr>
            <th>Convoy</th>
            <th>Status</th>
            <th>Prime Mover</th>
            <th>Tanker / Chassis</th>
            <th>Sender Ticket</th>
            <th>Receiver Ticket</th>
            <th>Sender NSV</th>
            <th>Receiver NSV</th>
            <th>Variance</th>
            <th>Seal</th>
            <th>Action</th>
          </tr>
        </thead>

        <tbody>
          {filteredTrackingRows.length === 0 ? (
            <tr>
              <td colSpan="11" className="empty-table">
                No tanker tracking records found.
              </td>
            </tr>
          ) : (
            filteredTrackingRows.map((row) => {
              const comparison = row.quantityComparison
              const sealMismatch = row.sealChecks.some((seal) => {
                return (
                  seal.status === 'MISMATCH' ||
                  seal.status === 'RECEIVER_MISSING' ||
                  seal.status === 'SENDER_MISSING'
                )
              })

              return (
                <tr key={row.groupKey}>
                  <td>
                    <strong>{row.convoyNumber}</strong>
                    <br />
                    <small>{row.productName || '-'}</small>
                  </td>

                  <td>
                    <span
                      className={`status-badge ${getTrackingStatusClass(
                        row.trackingStatus
                      )}`}
                    >
                      {getTrackingStatusLabel(row.trackingStatus)}
                    </span>
                  </td>

                  <td>
                    <strong>{row.primeMoverAssetName || '-'}</strong>
                    <br />
                    <small>{row.primeMoverAssetCode || '-'}</small>
                  </td>

                  <td>
                    <strong>{row.tankerAssetName || '-'}</strong>
                    <br />
                    <small>
                      {row.tankerAssetCode || '-'} /{' '}
                      {row.tankerChassisNumber || '-'}
                    </small>
                  </td>

                  <td>
                    {row.senderTicket?.ticketNumber ||
                      row.senderTicket?.operationNumber ||
                      '-'}
                  </td>

                  <td>
                    {row.latestReceiverTicket?.ticketNumber ||
                      row.latestReceiverTicket?.operationNumber ||
                      '-'}
                  </td>

                  <td className="number-cell">
                    {comparison
                      ? formatNumber(comparison.senderNsvBbl)
                      : row.senderTicket
                        ? formatNumber(row.senderTicket.nsvBbl)
                        : '-'}
                  </td>

                  <td className="number-cell">
                    {comparison
                      ? formatNumber(comparison.receiverNsvBbl)
                      : row.latestReceiverTicket
                        ? formatNumber(row.latestReceiverTicket.nsvBbl)
                        : '-'}
                  </td>

                  <td className="number-cell">
                    {comparison ? (
                      <>
                        {formatNumber(comparison.nsvVarianceBbl)} bbl
                        <br />
                        <small>
                          {formatPercent(comparison.nsvVariancePercent)}
                        </small>
                      </>
                    ) : (
                      '-'
                    )}
                  </td>

                  <td>
                    <span
                      className={`status-badge ${
                        sealMismatch ? 'rejected' : 'active'
                      }`}
                    >
                      {sealMismatch ? 'Mismatch' : 'OK'}
                    </span>
                  </td>

                  <td>
                    <div className="table-actions">
                      <button
                        type="button"
                        onClick={() => setSelectedGroup(row)}
                      >
                        View
                      </button>

                      {row.senderTicket?.transactionId && (
                        <button
                          type="button"
                          onClick={() =>
                            openOperationTicket(row.senderTicket.transactionId)
                          }
                          disabled={loading}
                        >
                          Sender
                        </button>
                      )}

                      {row.latestReceiverTicket?.transactionId && (
                        <button
                          type="button"
                          onClick={() =>
                            openOperationTicket(
                              row.latestReceiverTicket.transactionId
                            )
                          }
                          disabled={loading}
                        >
                          Receiver
                        </button>
                      )}

                      {row.quantityComparison && (
                        <button
                          type="button"
                          onClick={() => handlePrintMtrReport(row)}
                          disabled={loading}
                        >
                          Print MTR
                        </button>
                      )}

                      {row.quantityComparison &&
                        row.acknowledgementId &&
                        row.trackingStatus !== 'CLOSED' && (
                          <button
                            type="button"
                            onClick={() => openClosePanel(row)}
                            disabled={loading}
                          >
                            Close
                          </button>
                        )}

                      {row.trackingStatus === 'PENDING_RECEIPT' &&
                        row.senderTicket && (
                          <button
                            type="button"
                            onClick={() => openAcknowledgePanel(row)}
                            disabled={loading}
                          >
                            Acknowledge
                          </button>
                        )}

                      {row.trackingStatus === 'ACKNOWLEDGED' && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleCreateReceiverEntry(row)}
                            disabled={loading}
                          >
                            Create Receiver Entry
                          </button>

                          <button
                            type="button"
                            onClick={() => openRevokePanel(row)}
                            disabled={loading}
                          >
                            Revoke Ack
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })
          )}
        </tbody>
      </table>

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
                      <option
                        key={location.id}
                        value={location.locationCode}
                      >
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
              onClick={handleRevokeAcknowledgement}
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
                  <td className="number-cell">
                    {formatPercent(closeGroup.quantityComparison.nsvVariancePercent)}
                  </td>
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
              onClick={handleCloseMovement}
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

      {selectedGroup && (
        <div className="report-detail-panel no-print">
          <div className="report-detail-header">
            <div>
              <h3>Convoy {selectedGroup.convoyNumber}</h3>
              <p>
                {selectedGroup.tankerAssetName} (
                {selectedGroup.tankerAssetCode}) / Chassis{' '}
                {selectedGroup.tankerChassisNumber || '-'}
              </p>
            </div>

            <div className="table-actions">
              {selectedGroup.senderTicket?.transactionId && (
                <button
                  type="button"
                  onClick={() =>
                    openOperationTicket(selectedGroup.senderTicket.transactionId)
                  }
                  disabled={loading}
                >
                  Open Sender Ticket
                </button>
              )}

              {selectedGroup.latestReceiverTicket?.transactionId && (
                <button
                  type="button"
                  onClick={() =>
                    openOperationTicket(
                      selectedGroup.latestReceiverTicket.transactionId
                    )
                  }
                  disabled={loading}
                >
                  Open Receiver Ticket
                </button>
              )}

              {selectedGroup.quantityComparison && (
                <button
                  type="button"
                  onClick={() => handlePrintMtrReport(selectedGroup)}
                  disabled={loading}
                >
                  Print MTR
                </button>
              )}

              {selectedGroup.quantityComparison &&
                selectedGroup.acknowledgementId &&
                selectedGroup.trackingStatus !== 'CLOSED' && (
                  <button
                    type="button"
                    onClick={() => openClosePanel(selectedGroup)}
                    disabled={loading}
                  >
                    Close Movement
                  </button>
                )}

              <button type="button" onClick={() => setSelectedGroup(null)}>
                Close
              </button>
            </div>
          </div>

          {selectedGroup.warningMessages.length > 0 && (
            <div className="info-box">
              {selectedGroup.warningMessages.map((message) => (
                <div key={message}>{message}</div>
              ))}
            </div>
          )}

          {selectedGroup.trackingStatus === 'CLOSED' && (
            <div className="info-box">
              <strong>Movement Closed</strong>
              <div>Closed By: {selectedGroup.closedBy || '-'}</div>
              <div>Closed At: {selectedGroup.closedAt || '-'}</div>
              <div>Closure Remarks: {selectedGroup.closureRemarks || '-'}</div>
            </div>
          )}

          <div className="tracking-detail-grid">
            {renderTicketCard('Sender Ticket', selectedGroup.senderTicket)}
            {renderTicketCard(
              'Latest Receiver Ticket',
              selectedGroup.latestReceiverTicket
            )}
          </div>

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
              {selectedGroup.sealChecks.map((seal) => (
                <tr key={seal.sealName}>
                  <td>{seal.sealName}</td>
                  <td>{seal.senderValue || '-'}</td>
                  <td>{seal.receiverValue || '-'}</td>
                  <td>
                    <span
                      className={`status-badge ${getSealStatusClass(
                        seal.status
                      )}`}
                    >
                      {seal.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="info-box">
            Sender and receiver comparison is based only on Approved tickets. Approvers
            can verify tanker dips, quality, seals and calculated quantity in the Tanker
            Approval Preview before approving.
          </div>

          <div className="section-title compact-section-title">
            <h3>Quantity Comparison</h3>
          </div>

          {selectedGroup.quantityComparison ? (
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
                    {formatNumber(selectedGroup.quantityComparison.senderGovBbl)} bbl
                  </td>
                  <td className="number-cell">
                    {formatNumber(selectedGroup.quantityComparison.receiverGovBbl)} bbl
                  </td>
                  <td className="number-cell">
                    {formatNumber(selectedGroup.quantityComparison.govVarianceBbl)} bbl
                  </td>
                  <td className="number-cell">-</td>
                </tr>

                <tr>
                  <td>GSV</td>
                  <td className="number-cell">
                    {formatNumber(selectedGroup.quantityComparison.senderGsvBbl)} bbl
                  </td>
                  <td className="number-cell">
                    {formatNumber(selectedGroup.quantityComparison.receiverGsvBbl)} bbl
                  </td>
                  <td className="number-cell">
                    {formatNumber(selectedGroup.quantityComparison.gsvVarianceBbl)} bbl
                  </td>
                  <td className="number-cell">-</td>
                </tr>

                <tr>
                  <td>NSV</td>
                  <td className="number-cell">
                    {formatNumber(selectedGroup.quantityComparison.senderNsvBbl)} bbl
                  </td>
                  <td className="number-cell">
                    {formatNumber(selectedGroup.quantityComparison.receiverNsvBbl)} bbl
                  </td>
                  <td className="number-cell">
                    {formatNumber(selectedGroup.quantityComparison.nsvVarianceBbl)} bbl
                  </td>
                  <td className="number-cell">
                    {formatPercent(selectedGroup.quantityComparison.nsvVariancePercent)}
                  </td>
                </tr>

                <tr>
                  <td>LT</td>
                  <td className="number-cell">
                    {formatNumber(selectedGroup.quantityComparison.senderLt)}
                  </td>
                  <td className="number-cell">
                    {formatNumber(selectedGroup.quantityComparison.receiverLt)}
                  </td>
                  <td className="number-cell">
                    {formatNumber(selectedGroup.quantityComparison.ltVariance)}
                  </td>
                  <td className="number-cell">-</td>
                </tr>

                <tr>
                  <td>MT</td>
                  <td className="number-cell">
                    {formatNumber(selectedGroup.quantityComparison.senderMt)}
                  </td>
                  <td className="number-cell">
                    {formatNumber(selectedGroup.quantityComparison.receiverMt)}
                  </td>
                  <td className="number-cell">
                    {formatNumber(selectedGroup.quantityComparison.mtVariance)}
                  </td>
                  <td className="number-cell">-</td>
                </tr>
              </tbody>
            </table>
          ) : (
            <div className="info-box">
              No receiver ticket is available yet. Quantity comparison will
              appear after receiver tanker entry is saved with the same convoy
              and tanker.
            </div>
          )}
        </div>
      )}

      {printGroup && (
        <div className="print-only">
          <TankerMtrComparisonReport group={printGroup} />
        </div>
      )}
    </div>
  )
}

export default TankerTracking
