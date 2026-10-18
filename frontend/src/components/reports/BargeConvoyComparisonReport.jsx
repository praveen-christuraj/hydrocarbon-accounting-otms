import CompanyPrintFooter from './CompanyPrintFooter'
import CompanyPrintHeader from './CompanyPrintHeader'
import { useCompanyPrintProfile } from '../../hooks/useCompanyPrintProfile'

const QUANTITY_ROWS = [
  { key: 'TOV', label: 'TOV / Volume (bbl)' },
  { key: 'FW', label: 'Free Water (bbl)' },
  { key: 'GOV', label: 'GOV (bbl)' },
  { key: 'GSV', label: 'GSV (bbl)' },
  { key: 'NSV', label: 'NSV (bbl)' },
]

const isEntered = (value) =>
  value !== null && value !== undefined && String(value).trim() !== ''

const numericValue = (value) => {
  if (!isEntered(value)) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

const formatQuantity = (value, decimals = 3) => {
  const number = numericValue(value)
  return number === null
    ? '-'
    : number.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

const formatDip = (value) => formatQuantity(value, 1)
const text = (value) => String(value ?? '').trim() || '-'

const comparisonAssetCode = (comparison) =>
  String(
    comparison?.asset_code ||
      comparison?.summary_json?.asset_code ||
      comparison?.summary_json?.left?.asset_code ||
      comparison?.summary_json?.right?.asset_code ||
      ''
  ).trim()

const uniqueValues = (values) => [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))]

const getSingleAssetComparisonRows = (comparisons = []) => {
  const byAsset = new Map()
  comparisons.forEach((comparison) => {
    const assetCode = comparisonAssetCode(comparison)
    if (!assetCode) return
    if (!byAsset.has(assetCode)) byAsset.set(assetCode, [])
    byAsset.get(assetCode).push(comparison)
  })

  return [...byAsset.entries()]
    .map(([assetCode, rows]) => {
      const ordered = [...rows].sort((left, right) => Number(left.id || 0) - Number(right.id || 0))
      const standardRows = ordered.filter((row) =>
        String(row.comparison_type || '').toUpperCase() === 'LOAD_AFTER_VS_UNLOAD_BEFORE'
      )
      // Prefer the canonical load-after vs unload-before comparison when it
      // exists. If older/manual data used another comparison type, retain the
      // latest comparison for that barge instead of silently dropping it.
      const comparison = standardRows.at(-1) || ordered.at(-1)
      return { assetCode, comparison }
    })
    .sort((left, right) => left.assetCode.localeCompare(right.assetCode))
}

const hasEnteredDip = (inputs, field) => {
  const dips = inputs?.dips && typeof inputs.dips === 'object' ? inputs.dips : {}
  return Object.values(dips).some((dip) => dip && isEntered(dip[field]))
}

const buildDipRows = (bargeRows, assetNameByCode) => {
  const rows = []
  for (const { assetCode, comparison } of bargeRows) {
    const summary = comparison.summary_json || {}
    const senderDips = summary.left?.inputs?.dips || {}
    const receiverDips = summary.right?.inputs?.dips || {}
    const tankIds = uniqueValues([...Object.keys(senderDips), ...Object.keys(receiverDips)]).sort()

    for (const tankId of tankIds) {
      const sender = senderDips[tankId] || {}
      const receiver = receiverDips[tankId] || {}
      const senderTotal = sender.total
      const senderWater = sender.water
      const receiverTotal = receiver.total
      const receiverWater = receiver.water
      if (![senderTotal, senderWater, receiverTotal, receiverWater].some(isEntered)) continue

      const senderTotalNumber = numericValue(senderTotal)
      const receiverTotalNumber = numericValue(receiverTotal)
      const senderWaterNumber = numericValue(senderWater)
      const receiverWaterNumber = numericValue(receiverWater)

      rows.push({
        key: `${assetCode}-${tankId}`,
        assetCode,
        assetName: assetNameByCode.get(assetCode) || '',
        tankId,
        senderTotal,
        senderWater,
        receiverTotal,
        receiverWater,
        totalDelta: senderTotalNumber === null || receiverTotalNumber === null ? null : senderTotalNumber - receiverTotalNumber,
        waterDelta: senderWaterNumber === null || receiverWaterNumber === null ? null : senderWaterNumber - receiverWaterNumber,
      })
    }
  }
  return rows
}

function BargeConvoyComparisonReport({
  convoyNumber,
  comparisons = [],
  bargeAssets = [],
  locations = [],
  generatedBy = '',
}) {
  const profile = useCompanyPrintProfile()
  const bargeRows = getSingleAssetComparisonRows(comparisons)
  const assetNameByCode = new Map(
    bargeAssets.map((asset) => [String(asset.asset_code || '').trim(), asset.asset_name || ''])
  )
  const convoyAssetCodes = uniqueValues([
    ...bargeAssets.map((asset) => asset.asset_code),
    ...bargeRows.map(({ assetCode }) => assetCode),
  ])
  const comparedAssetCodes = new Set(bargeRows.map(({ assetCode }) => assetCode))
  const assetsWithoutComparison = convoyAssetCodes.filter((assetCode) => !comparedAssetCodes.has(assetCode))
  const locationNameByCode = new Map(
    locations.map((location) => [String(location.locationCode || location.location_code || '').trim(), location.locationName || location.location_name || ''])
  )

  const dipRows = buildDipRows(bargeRows, assetNameByCode)
  const senderLocations = uniqueValues(bargeRows.map(({ comparison }) => comparison.summary_json?.left?.location_code))
  const receiverLocations = uniqueValues(bargeRows.map(({ comparison }) => comparison.summary_json?.right?.location_code))
  const dipUnits = uniqueValues(bargeRows.map(({ comparison }) => comparison.summary_json?.units?.dip))
  const printLocationList = (codes) => codes.length
    ? codes.map((code) => locationNameByCode.get(code) ? `${locationNameByCode.get(code)} (${code})` : code).join(', ')
    : '-'
  const assetLabel = (assetCode) => assetNameByCode.get(assetCode)
    ? `${assetNameByCode.get(assetCode)} (${assetCode})`
    : assetCode

  const quantityRows = bargeRows.flatMap(({ assetCode, comparison }) => {
    const summary = comparison.summary_json || {}
    const senderTotals = summary.left?.totals || {}
    const receiverTotals = summary.right?.totals || {}
    const assetName = assetNameByCode.get(assetCode) || comparison.asset_name || ''
    return QUANTITY_ROWS.map((quantity) => {
      const sender = hasEnteredDip(summary.left?.inputs, quantity.key === 'FW' ? 'water' : 'total')
        ? senderTotals[quantity.key]
        : null
      const receiver = hasEnteredDip(summary.right?.inputs, quantity.key === 'FW' ? 'water' : 'total')
        ? receiverTotals[quantity.key]
        : null
      const senderNumber = numericValue(sender)
      const receiverNumber = numericValue(receiver)
      return {
        key: `${assetCode}-${quantity.key}`,
        assetCode,
        assetName,
        comparison,
        label: quantity.label,
        sender,
        receiver,
        delta: senderNumber === null || receiverNumber === null ? null : senderNumber - receiverNumber,
      }
    })
  })

  const convoyTotals = QUANTITY_ROWS.map(({ key, label }) => {
    let senderTotal = 0
    let receiverTotal = 0
    let differenceTotal = 0
    let senderCount = 0
    let receiverCount = 0
    let differenceCount = 0

    bargeRows.forEach(({ comparison }) => {
      const summary = comparison.summary_json || {}
      const senderHasInput = hasEnteredDip(summary.left?.inputs, key === 'FW' ? 'water' : 'total')
      const receiverHasInput = hasEnteredDip(summary.right?.inputs, key === 'FW' ? 'water' : 'total')
      const senderValue = senderHasInput ? numericValue(summary.left?.totals?.[key]) : null
      const receiverValue = receiverHasInput ? numericValue(summary.right?.totals?.[key]) : null
      if (senderValue !== null) { senderTotal += senderValue; senderCount += 1 }
      if (receiverValue !== null) { receiverTotal += receiverValue; receiverCount += 1 }
      if (senderValue !== null && receiverValue !== null) {
        differenceTotal += senderValue - receiverValue
        differenceCount += 1
      }
    })

    return {
      key,
      label,
      sender: senderCount ? senderTotal : null,
      receiver: receiverCount ? receiverTotal : null,
      difference: differenceCount ? differenceTotal : null,
      partial: senderCount < bargeRows.length || receiverCount < bargeRows.length,
    }
  })

  return (
    <div className="printable-report barge-mtr-report barge-convoy-mtr-report">
      <CompanyPrintHeader profile={profile} defaultSubtitle="Barge Convoy Consolidated Comparison" />
      <div className="barge-mtr-header">
        <div>
          <h1>BARGE CONVOY CONSOLIDATED COMPARISON</h1>
          <p>Convoy: <strong>{text(convoyNumber)}</strong> | Barges compared: <strong>{bargeRows.length} of {convoyAssetCodes.length || bargeRows.length}</strong></p>
        </div>
        <div className="barge-mtr-meta">
          <span>Sender location</span><strong>{printLocationList(senderLocations)}</strong>
          <span>Receiver location</span><strong>{printLocationList(receiverLocations)}</strong>
          <span>Barges in convoy</span><strong>{convoyAssetCodes.length || bargeRows.length}</strong>
          <span>Comparisons</span><strong>{bargeRows.length}</strong>
          <span>Dip units</span><strong>{dipUnits.length ? dipUnits.join(', ') : '-'}</strong>
          <span>Printed</span><strong>{new Date().toLocaleString()}</strong>
          <span>Prepared by</span><strong>{text(generatedBy)}</strong>
        </div>
      </div>

      {assetsWithoutComparison.length > 0 && (
        <div className="barge-mtr-note">
          No saved comparison is available for: {assetsWithoutComparison.map(assetLabel).join(', ')}.
          These barges are not included in the totals below.
        </div>
      )}

      {bargeRows.length === 0 ? (
        <div className="barge-mtr-note">No approved barge comparison data is available for this convoy yet.</div>
      ) : (
        <>
          <section className="barge-mtr-section">
            <h2>Convoy Quantity Totals</h2>
            <table className="barge-mtr-table barge-mtr-number-table">
              <thead><tr><th>Measurement</th><th>Sender Total</th><th>Receiver Total</th><th>Difference (Sender − Receiver)</th><th>Coverage</th></tr></thead>
              <tbody>
                {convoyTotals.map((row) => (
                  <tr key={row.key}>
                    <td><strong>{row.label}</strong></td>
                    <td>{formatQuantity(row.sender)}</td>
                    <td>{formatQuantity(row.receiver)}</td>
                    <td>{formatQuantity(row.difference)}</td>
                    <td>{row.partial ? 'Partial — entered values only' : 'All compared barges'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="barge-mtr-section">
            <h2>Per-Barge Quantity Comparison</h2>
            <table className="barge-mtr-table barge-mtr-number-table">
              <thead><tr><th>Barge / Asset</th><th>Sender Ticket</th><th>Receiver Ticket</th><th>Measurement</th><th>Sender</th><th>Receiver</th><th>Difference</th></tr></thead>
              <tbody>
                {quantityRows.map((row) => (
                  <tr key={row.key}>
                    <td><strong>{row.assetName ? `${row.assetName} (${row.assetCode})` : row.assetCode}</strong></td>
                    <td>{text(row.comparison.summary_json?.left?.ticket_number || row.comparison.left_ticket_number)}</td>
                    <td>{text(row.comparison.summary_json?.right?.ticket_number || row.comparison.right_ticket_number)}</td>
                    <td>{row.label}</td>
                    <td>{formatQuantity(row.sender)}</td>
                    <td>{formatQuantity(row.receiver)}</td>
                    <td>{formatQuantity(row.delta)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="barge-mtr-section">
            <h2>Recorded Dips by Tank (entered values only)</h2>
            <table className="barge-mtr-table barge-mtr-number-table">
              <thead><tr><th>Barge / Asset</th><th>Tank</th><th>Sender Total Dip</th><th>Sender Water Dip</th><th>Receiver Total Dip</th><th>Receiver Water Dip</th><th>Δ Total Dip (S − R)</th><th>Δ Water Dip (S − R)</th></tr></thead>
              <tbody>
                {dipRows.length === 0 ? (
                  <tr><td colSpan="8">No dip values were entered on the saved comparisons.</td></tr>
                ) : dipRows.map((row) => (
                  <tr key={row.key}>
                    <td><strong>{row.assetName ? `${row.assetName} (${row.assetCode})` : row.assetCode}</strong></td>
                    <td>{row.tankId}</td>
                    <td>{formatDip(row.senderTotal)}</td>
                    <td>{formatDip(row.senderWater)}</td>
                    <td>{formatDip(row.receiverTotal)}</td>
                    <td>{formatDip(row.receiverWater)}</td>
                    <td>{formatDip(row.totalDelta)}</td>
                    <td>{formatDip(row.waterDelta)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="barge-mtr-note">Dip values are shown per tank and are not added across barges. Blank inputs are not treated as zero. Quantity totals sum the available saved comparison values; the coverage column flags any incomplete measurement.</p>
          </section>
        </>
      )}

      <CompanyPrintFooter profile={profile} />
      <div className="barge-mtr-footer">Printed from Hydrocarbon Accounting System | Barge Tracking</div>
    </div>
  )
}

export default BargeConvoyComparisonReport
