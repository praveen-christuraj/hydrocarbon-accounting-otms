import { useCompanyPrintProfile } from '../../hooks/useCompanyPrintProfile'
import CompanyPrintHeader from './CompanyPrintHeader'
import CompanyPrintFooter from './CompanyPrintFooter'

const SEAL_STATUS_LABELS = {
  MATCHED: 'Matched',
  MISMATCH: 'Mismatch',
  NOT_ENTERED: 'Not Entered',
  SENDER_MISSING: 'Sender Missing',
  RECEIVER_MISSING: 'Receiver Missing',
}

const sealStatusClass = (status) => {
  const value = String(status || '').toUpperCase()

  if (value === 'MATCHED') return 'mtr-seal-status ok'
  if (value === 'NOT_ENTERED') return 'mtr-seal-status'

  return 'mtr-seal-status bad'
}

const sealStatusLabel = (status) => {
  const value = String(status || '').toUpperCase()
  return SEAL_STATUS_LABELS[value] || value.replace(/_/g, ' ') || '-'
}

const formatNumber = (value, decimals = 3) => {
  const number = Number(value)

  if (!Number.isFinite(number)) return '-'

  return number.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

const text = (value) => {
  const cleaned = String(value ?? '').trim()
  return cleaned === '' ? '-' : cleaned
}

const locationLabel = (code, name) => {
  if (code && name) return `${name} (${code})`
  return text(code || name)
}

/**
 * Printable Tanker MTR comparison report: sender vs receiver dips,
 * temperatures, seals and quantities. Rendered inside a print-only container
 * by Tanker Tracking.
 */
function TankerMtrComparisonReport({ group }) {
  const profile = useCompanyPrintProfile()

  if (!group) return null

  const sender = group.senderTicket || null
  const receiver = group.latestReceiverTicket || null

  const sealChecks = Array.isArray(group.sealChecks) ? group.sealChecks : []
  const quantity = group.quantityComparison || null

  const mismatchCount = sealChecks.filter((check) => {
    const status = String(check?.status || '').toUpperCase()
    return status && status !== 'MATCHED' && status !== 'NOT_ENTERED'
  }).length

  const dipRows = [
    { label: 'Total Dip (cm)', sender: sender?.totalDipCm, receiver: receiver?.totalDipCm, decimals: 1 },
    { label: 'Water Dip (cm)', sender: sender?.waterDipCm, receiver: receiver?.waterDipCm, decimals: 1 },
    {
      label: 'Tank Temperature',
      sender: sender?.tankTemperature,
      receiver: receiver?.tankTemperature,
      decimals: 2,
      suffix: (ticket) => (ticket?.tankTemperatureUnit ? ` ${ticket.tankTemperatureUnit}` : ''),
    },
    {
      label: 'Sample Temperature',
      sender: sender?.sampleTemperature,
      receiver: receiver?.sampleTemperature,
      decimals: 2,
      suffix: (ticket) => (ticket?.sampleTemperatureUnit ? ` ${ticket.sampleTemperatureUnit}` : ''),
    },
    { label: 'Observed API', sender: sender?.observedApi, receiver: receiver?.observedApi, decimals: 2 },
    { label: 'API @ 60°F', sender: sender?.api60, receiver: receiver?.api60, decimals: 2 },
    { label: 'VCF', sender: sender?.vcf, receiver: receiver?.vcf, decimals: 5 },
    { label: 'BS&W %', sender: sender?.bswPercent, receiver: receiver?.bswPercent, decimals: 3 },
    { label: 'TOV (bbl)', sender: sender?.tovBbl, receiver: receiver?.tovBbl },
    { label: 'Free Water (bbl)', sender: sender?.freeWaterBbl, receiver: receiver?.freeWaterBbl },
    { label: 'GOV (bbl)', sender: sender?.govBbl, receiver: receiver?.govBbl },
    { label: 'GSV (bbl)', sender: sender?.gsvBbl, receiver: receiver?.gsvBbl },
    { label: 'BS&W (bbl)', sender: sender?.bswBbl, receiver: receiver?.bswBbl },
    { label: 'NSV (bbl)', sender: sender?.nsvBbl, receiver: receiver?.nsvBbl },
    { label: 'LT', sender: sender?.lt, receiver: receiver?.lt },
    { label: 'MT', sender: sender?.mt, receiver: receiver?.mt },
  ]

  const quantityRows = [
    { label: 'GOV (bbl)', senderValue: quantity?.senderGovBbl, receiverValue: quantity?.receiverGovBbl, variance: quantity?.govVarianceBbl },
    { label: 'GSV (bbl)', senderValue: quantity?.senderGsvBbl, receiverValue: quantity?.receiverGsvBbl, variance: quantity?.gsvVarianceBbl },
    { label: 'NSV (bbl)', senderValue: quantity?.senderNsvBbl, receiverValue: quantity?.receiverNsvBbl, variance: quantity?.nsvVarianceBbl },
    { label: 'LT', senderValue: quantity?.senderLt, receiverValue: quantity?.receiverLt, variance: quantity?.ltVariance },
    { label: 'MT', senderValue: quantity?.senderMt, receiverValue: quantity?.receiverMt, variance: quantity?.mtVariance },
  ]

  return (
    <div className="tanker-mtr-report">
      <CompanyPrintHeader
        profile={profile}
        defaultSubtitle="Tanker MTR / Comparison Report"
      />

      <div className="mtr-report-header">
        <div>
          <h1>TANKER MTR / COMPARISON REPORT</h1>
          <p>
            Convoy: <strong>{text(group.convoyNumber)}</strong> | Tanker:{' '}
            <strong>
              {group.tankerAssetName
                ? `${group.tankerAssetName} (${group.tankerAssetCode || '-'})`
                : text(group.tankerAssetCode)}
            </strong>
          </p>
        </div>

        <div className="mtr-report-meta">
          <span>Tracking Status</span>
          <strong>{text(group.trackingStatus)}</strong>
          <span>Prime Mover</span>
          <strong>{text(group.primeMoverAssetName || group.primeMoverAssetCode)}</strong>
          <span>Product</span>
          <strong>{text(group.productName)}</strong>
          <span>Printed</span>
          <strong>{new Date().toLocaleString()}</strong>
        </div>
      </div>

      <div className="mtr-status-strip">
        <div>
          <span>Sender Ticket</span>
          <strong>{text(sender?.ticketNumber)}</strong>
        </div>
        <div>
          <span>Receiver Ticket</span>
          <strong>{text(receiver?.ticketNumber)}</strong>
        </div>
        <div>
          <span>Seal Result</span>
          <strong>
            {mismatchCount > 0
              ? `Mismatch (${mismatchCount} of ${sealChecks.length})`
              : sealChecks.length > 0
                ? 'Matched'
                : 'Not Captured'}
          </strong>
        </div>
      </div>

      <div className="mtr-section">
        <h2>Compared Tickets</h2>

        <table className="mtr-table">
          <thead>
            <tr>
              <th>Side</th>
              <th>Ticket</th>
              <th>Date</th>
              <th>Operation Type</th>
              <th>Sender Location</th>
              <th>Receiver Location</th>
              <th>Status</th>
            </tr>
          </thead>

          <tbody>
            <tr>
              <td>Sender</td>
              <td>{text(sender?.ticketNumber || sender?.operationNumber)}</td>
              <td>{text(sender?.operationDate)}</td>
              <td>{text(sender?.operationTypeName || sender?.operationTypeCode)}</td>
              <td>{locationLabel(sender?.senderLocationCode, sender?.senderLocationName)}</td>
              <td>{locationLabel(sender?.receiverLocationCode, sender?.receiverLocationName)}</td>
              <td>{text(sender?.status)}</td>
            </tr>

            <tr>
              <td>Receiver</td>
              <td>{text(receiver?.ticketNumber || receiver?.operationNumber)}</td>
              <td>{text(receiver?.operationDate)}</td>
              <td>{text(receiver?.operationTypeName || receiver?.operationTypeCode)}</td>
              <td>{locationLabel(receiver?.senderLocationCode, receiver?.senderLocationName)}</td>
              <td>{locationLabel(receiver?.receiverLocationCode, receiver?.receiverLocationName)}</td>
              <td>{text(receiver?.status)}</td>
            </tr>
          </tbody>
        </table>

        {!receiver ? (
          <p className="mtr-report-note">
            No receiver ticket is approved yet. The comparison report is completed
            after the receiver tanker entry is approved and compared.
          </p>
        ) : null}
      </div>

      <div className="mtr-section">
        <h2>Seal Check</h2>

        <table className="mtr-table">
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
                <td colSpan="4">No seal data recorded for this comparison.</td>
              </tr>
            ) : (
              sealChecks.map((check) => (
                <tr key={check.sealName}>
                  <td>{text(check.sealName)}</td>
                  <td>{text(check.senderValue)}</td>
                  <td>{text(check.receiverValue)}</td>
                  <td>
                    <span className={sealStatusClass(check.status)}>
                      {sealStatusLabel(check.status)}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mtr-section">
        <h2>Dips, Temperatures and Quantities (Sender vs Receiver)</h2>

        <table className="mtr-table mtr-quantity-table">
          <thead>
            <tr>
              <th>Parameter</th>
              <th>Sender</th>
              <th>Receiver</th>
              <th>Variance</th>
            </tr>
          </thead>

          <tbody>
            {dipRows.map((row) => {
              const senderNumber = Number(row.sender)
              const receiverNumber = Number(row.receiver)

              const variance =
                Number.isFinite(senderNumber) && Number.isFinite(receiverNumber)
                  ? receiverNumber - senderNumber
                  : null

              const suffixSender = row.suffix ? row.suffix(sender) : ''
              const suffixReceiver = row.suffix ? row.suffix(receiver) : ''

              return (
                <tr key={row.label}>
                  <td>{row.label}</td>
                  <td>
                    {row.sender === null || row.sender === undefined
                      ? '-'
                      : `${formatNumber(row.sender, row.decimals ?? 3)}${suffixSender}`}
                  </td>
                  <td>
                    {row.receiver === null || row.receiver === undefined
                      ? '-'
                      : `${formatNumber(row.receiver, row.decimals ?? 3)}${suffixReceiver}`}
                  </td>
                  <td>{variance === null ? '-' : formatNumber(variance, row.decimals ?? 3)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="mtr-section">
        <h2>Quantity Comparison</h2>

        <table className="mtr-table mtr-quantity-table">
          <thead>
            <tr>
              <th>Quantity</th>
              <th>Sender</th>
              <th>Receiver</th>
              <th>Variance</th>
            </tr>
          </thead>

          <tbody>
            {!quantity ? (
              <tr>
                <td colSpan="4">
                  Quantity comparison is available after both tickets are approved.
                </td>
              </tr>
            ) : (
              quantityRows.map((row) => (
                <tr key={row.label}>
                  <td>{row.label}</td>
                  <td>{formatNumber(row.senderValue)}</td>
                  <td>{formatNumber(row.receiverValue)}</td>
                  <td>{formatNumber(row.variance)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {quantity ? (
          <p className="mtr-report-note">
            NSV variance: <strong>{formatNumber(quantity.nsvVarianceBbl)} bbl</strong> (
            {formatNumber(quantity.nsvVariancePercent, 4)}%)
          </p>
        ) : null}
      </div>

      <div className="mtr-section">
        <h2>Remarks / Review</h2>

        <div className="mtr-remarks-grid">
          <div>
            <span>Acknowledgement Remarks</span>
            <p>{text(group.acknowledgementRemarks)}</p>
          </div>

          <div>
            <span>Closure Remarks</span>
            <p>{text(group.closureRemarks)}</p>
          </div>

          <div>
            <span>System Notes</span>
            <p>
              {Array.isArray(group.warningMessages) && group.warningMessages.length > 0
                ? group.warningMessages.join(' ')
                : 'Approved sender/receiver comparison only'}
            </p>
          </div>
        </div>
      </div>

      <div className="mtr-signature-grid">
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
    </div>
  )
}

export default TankerMtrComparisonReport
