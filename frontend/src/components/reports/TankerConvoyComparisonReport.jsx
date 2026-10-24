import { useCompanyPrintProfile } from '../../hooks/useCompanyPrintProfile'
import CompanyPrintHeader from './CompanyPrintHeader'
import CompanyPrintFooter from './CompanyPrintFooter'
import {
  resolveReceiverCode,
  resolveReceiverName,
  resolveSenderCode,
  resolveSenderName,
} from '../../utils/senderReceiver'

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
 * Printable Tanker Convoy Consolidated Comparison: one row per tanker in the
 * convoy, comparing its latest Approved sender ticket against its Approved
 * receiver ticket (dips, quantities and seals), plus convoy-level quantity
 * totals. Rendered inside a print-only container by Tanker Tracking.
 */
const QUANTITY_ROWS = [
  { key: 'GOV', label: 'GOV (bbl)', sumKey: 'senderGovBbl', recvKey: 'receiverGovBbl', varKey: 'govVarianceBbl' },
  { key: 'GSV', label: 'GSV (bbl)', sumKey: 'senderGsvBbl', recvKey: 'receiverGsvBbl', varKey: 'gsvVarianceBbl' },
  { key: 'NSV', label: 'NSV (bbl)', sumKey: 'senderNsvBbl', recvKey: 'receiverNsvBbl', varKey: 'nsvVarianceBbl' },
  { key: 'LT', label: 'LT', sumKey: 'senderLt', recvKey: 'receiverLt', varKey: 'ltVariance' },
  { key: 'MT', label: 'MT', sumKey: 'senderMt', recvKey: 'receiverMt', varKey: 'mtVariance' },
]

function tankerLabel(group) {
  const name = group.tankerAssetName || ''
  const code = group.tankerAssetCode || '-'
  return name ? `${name} (${code})` : code
}

function groupSenderLocation(group) {
  const ticket = group.senderTicket || group.latestReceiverTicket || null
  return locationLabel(
    resolveSenderCode(ticket) || resolveSenderCode(group.senderTicket),
    resolveSenderName(ticket) || resolveSenderName(group.senderTicket),
  )
}

function groupReceiverLocation(group) {
  const ticket = group.latestReceiverTicket || group.senderTicket || null
  return locationLabel(
    resolveReceiverCode(ticket) || resolveReceiverCode(group.senderTicket),
    resolveReceiverName(ticket) || resolveReceiverName(group.senderTicket),
  )
}

function TankerConvoyComparisonReport({
  convoyNumber,
  groups = [],
  generatedBy = '',
}) {
  const profile = useCompanyPrintProfile()

  const comparedGroups = (groups || []).filter(
    (group) => Boolean(group.quantityComparison),
  )
  const tankerCount = new Set(
    (groups || []).map((group) => String(group.tankerAssetCode || '')).filter(Boolean),
  ).size

  const senderLocations = new Set()
  const receiverLocations = new Set()
  ;(groups || []).forEach((group) => {
    senderLocations.add(groupSenderLocation(group))
    receiverLocations.add(groupReceiverLocation(group))
  })

  const convoyTotals = QUANTITY_ROWS.map(({ key, label }) => {
    let senderTotal = 0
    let receiverTotal = 0
    let differenceTotal = 0
    let senderCount = 0
    let receiverCount = 0
    let differenceCount = 0

    comparedGroups.forEach((group) => {
      const comparison = group.quantityComparison
      const senderValue = Number(comparison[`sender${key}Bbl`] || 0)
      const receiverValue = Number(comparison[`receiver${key}Bbl`] || 0)

      senderTotal += senderValue
      senderCount += 1
      receiverTotal += receiverValue
      receiverCount += 1
      differenceTotal += senderValue - receiverValue
      differenceCount += 1
    })

    return {
      key,
      label,
      sender: senderCount ? senderTotal : null,
      receiver: receiverCount ? receiverTotal : null,
      difference: differenceCount ? differenceTotal : null,
    }
  })

  const quantityRows = comparedGroups.flatMap((group) => {
    const comparison = group.quantityComparison
    const tanker = tankerLabel(group)
    return QUANTITY_ROWS.map(({ key, label }) => ({
      key: `${group.groupKey}-${key}`,
      tanker,
      group,
      label,
      sender: comparison[`sender${key}Bbl`],
      receiver: comparison[`receiver${key}Bbl`],
      variance: comparison[`${key === 'GOV' ? 'gov' : key === 'GSV' ? 'gsv' : key === 'NSV' ? 'nsv' : key.toLowerCase()}VarianceBbl`],
    }))
  })

  const sealRows = (groups || []).flatMap((group) => {
    const tanker = tankerLabel(group)
    return (group.sealChecks || []).map((seal) => ({
      tanker,
      sealName: text(seal.sealName),
      sender: text(seal.senderValue),
      receiver: text(seal.receiverValue),
      status: seal.status,
    }))
  })

  const printLocationList = (codes) => {
    const list = Array.from(codes).filter((c) => c && c !== '-')
    return list.length ? list.join(', ') : '-'
  }

  return (
    <div className="printable-report tanker-convoy-mtr-report">
      <CompanyPrintHeader
        profile={profile}
        defaultSubtitle="Tanker Convoy Consolidated Comparison"
      />
      <div className="tanker-convoy-header">
        <div>
          <h1>TANKER CONVOY CONSOLIDATED COMPARISON</h1>
          <p>
            Convoy: <strong>{text(convoyNumber)}</strong> | Tankers compared:{' '}
            <strong>{comparedGroups.length} of {tankerCount || comparedGroups.length}</strong>
          </p>
        </div>
        <div className="tanker-convoy-meta">
          <span>Sender location</span>
          <strong>{printLocationList(senderLocations)}</strong>
          <span>Receiver location</span>
          <strong>{printLocationList(receiverLocations)}</strong>
          <span>Tankers in convoy</span>
          <strong>{tankerCount || comparedGroups.length}</strong>
          <span>Comparisons</span>
          <strong>{comparedGroups.length}</strong>
          <span>Printed</span>
          <strong>{new Date().toLocaleString()}</strong>
          <span>Prepared by</span>
          <strong>{text(generatedBy)}</strong>
        </div>
      </div>

      {comparedGroups.length === 0 ? (
        <div className="tanker-convoy-note">
          No approved sender/receiver comparison data is available for this
          convoy yet.
        </div>
      ) : (
        <>
          <section className="tanker-convoy-section">
            <h2>Convoy Quantity Totals</h2>
            <table className="tanker-convoy-table tanker-convoy-number-table">
              <thead>
                <tr>
                  <th>Measurement</th>
                  <th>Sender Total</th>
                  <th>Receiver Total</th>
                  <th>Difference (Sender − Receiver)</th>
                </tr>
              </thead>
              <tbody>
                {convoyTotals.map((row) => (
                  <tr key={row.key}>
                    <td><strong>{row.label}</strong></td>
                    <td>{formatNumber(row.sender)}</td>
                    <td>{formatNumber(row.receiver)}</td>
                    <td>{formatNumber(row.difference)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="tanker-convoy-section">
            <h2>Per-Tanker Quantity Comparison</h2>
            <table className="tanker-convoy-table tanker-convoy-number-table">
              <thead>
                <tr>
                  <th>Tanker / Asset</th>
                  <th>Sender Ticket</th>
                  <th>Receiver Ticket</th>
                  <th>Measurement</th>
                  <th>Sender</th>
                  <th>Receiver</th>
                  <th>Difference</th>
                </tr>
              </thead>
              <tbody>
                {quantityRows.map((row) => (
                  <tr key={row.key}>
                    <td>
                      <strong>{row.tanker}</strong>
                    </td>
                    <td>
                      {text(
                        row.group.senderTicket
                          ? row.group.senderTicket.ticketNumber ||
                              row.group.senderTicket.operationNumber
                          : '',
                      )}
                    </td>
                    <td>
                      {text(
                        row.group.latestReceiverTicket
                          ? row.group.latestReceiverTicket.ticketNumber ||
                              row.group.latestReceiverTicket.operationNumber
                          : '',
                      )}
                    </td>
                    <td>{row.label}</td>
                    <td>{formatNumber(row.sender)}</td>
                    <td>{formatNumber(row.receiver)}</td>
                    <td>{formatNumber(row.variance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="tanker-convoy-section">
            <h2>Seal Cross-check by Tanker</h2>
            <table className="tanker-convoy-table">
              <thead>
                <tr>
                  <th>Tanker / Asset</th>
                  <th>Seal</th>
                  <th>Sender</th>
                  <th>Receiver</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {sealRows.length === 0 ? (
                  <tr>
                    <td colSpan="5">No seal data recorded in this convoy.</td>
                  </tr>
                ) : (
                  sealRows.map((row) => (
                    <tr key={`${row.tanker}-${row.sealName}`}>
                      <td><strong>{row.tanker}</strong></td>
                      <td>{row.sealName}</td>
                      <td>{row.sender}</td>
                      <td>{row.receiver}</td>
                      <td>
                        <span className={sealStatusClass(row.status)}>
                          {sealStatusLabel(row.status)}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </section>

          <section className="tanker-convoy-section">
            <h2>Remarks / Review</h2>
            <div className="tanker-convoy-remarks-grid">
              <div>
                <span>Convoy</span>
                <strong>{text(convoyNumber)}</strong>
              </div>
              <div>
                <span>Generated By</span>
                <strong>{text(generatedBy)}</strong>
              </div>
              <div>
                <span>System Note</span>
                <strong>Approved sender/receiver comparison only</strong>
              </div>
            </div>
          </section>

          <div className="tanker-convoy-signature-grid">
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
        </>
      )}

      <CompanyPrintFooter profile={profile} />
      <div className="tanker-convoy-footer">
        Printed from Hydrocarbon Accounting System | Tanker Tracking
      </div>
    </div>
  )
}

export default TankerConvoyComparisonReport
