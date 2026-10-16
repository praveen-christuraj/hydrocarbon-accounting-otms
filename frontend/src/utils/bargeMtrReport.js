/**
 * Barge MTR (comparison) print helpers.
 *
 * Owner change 2026-10-16: the printed barge MTR must show **every** sample
 * parameter that was captured - observed API or observed density, whichever the
 * operator used - together with the calculated **API @ 60F** and the sample /
 * tank temperatures that go with them.
 *
 * The rows are built here (instead of inline in `BargeTracking.jsx`) so the same
 * numbers feed the screen view and the print report, and so the printed content
 * can be asserted without a browser (`scripts/smoke-render.mjs`).
 */

const isBlank = (value) =>
  value === null || value === undefined || String(value).trim() === ''

/** Blank-safe number formatting: a missing value stays blank, never 0. */
export const formatSampleNumber = (value, decimals = 3) => {
  if (isBlank(value)) {
    return ''
  }

  const number = Number(value)
  return Number.isFinite(number) ? number.toFixed(decimals) : ''
}

const unitSuffix = (inputs, key) => {
  const unit = String(inputs?.[`${key}Unit`] || '').trim()
  return unit ? ` ${unit}` : ''
}

/** Which sample input the operator captured on this side of the comparison. */
export const observedInputMode = (inputs = {}) => {
  const mode = String(inputs?.obsMode || '').trim()

  if (mode) {
    return mode
  }

  if (formatSampleNumber(inputs?.obsApi) !== '') {
    return 'Observed API'
  }

  if (formatSampleNumber(inputs?.obsDensity) !== '') {
    return 'Observed Density'
  }

  return '-'
}

/** Resolve one row value for display (blank -> '-'). */
export const showSampleValue = (row, key) => {
  const shown = row?.raw
    ? String(row?.[key] ?? '').trim()
    : formatSampleNumber(row?.[key], row?.dp)

  return shown === '' ? '-' : shown
}

/** Receiver minus sender; '-' for raw/text rows and for missing values. */
export const sampleDelta = (row) => {
  if (row?.raw) {
    return '-'
  }

  if (row?.sender === '' || row?.receiver === '') {
    return '-'
  }

  const senderNumber = Number(row?.sender)
  const receiverNumber = Number(row?.receiver)

  if (!Number.isFinite(senderNumber) || !Number.isFinite(receiverNumber)) {
    return '-'
  }

  return (receiverNumber - senderNumber).toFixed(row?.dp ?? 3)
}

/**
 * Sample / product parameters of one barge comparison, ready for the MTR print
 * report: `[{ label, sender, receiver, delta }]`.
 */
export const buildBargeMtrSampleRows = (comparison) => {
  const summary = comparison?.summary_json || {}
  const left = summary.left || {}
  const right = summary.right || {}

  const leftInputs = left.inputs || {}
  const rightInputs = right.inputs || {}
  const leftTotals = left.totals || {}
  const rightTotals = right.totals || {}

  const rows = [
    {
      label: 'Observed Input Mode',
      sender: observedInputMode(leftInputs),
      receiver: observedInputMode(rightInputs),
      raw: true,
    },
    {
      label: 'Observed API',
      sender: formatSampleNumber(leftInputs.obsApi, 2),
      receiver: formatSampleNumber(rightInputs.obsApi, 2),
      dp: 2,
    },
    {
      label: 'Observed Density (kg/m3)',
      sender: formatSampleNumber(leftInputs.obsDensity, 4),
      receiver: formatSampleNumber(rightInputs.obsDensity, 4),
      dp: 4,
    },
    {
      label: 'API @ 60F',
      sender: formatSampleNumber(leftTotals.API60, 2),
      receiver: formatSampleNumber(rightTotals.API60, 2),
      dp: 2,
    },
    {
      label: 'VCF',
      sender: formatSampleNumber(leftTotals.VCF, 5),
      receiver: formatSampleNumber(rightTotals.VCF, 5),
      dp: 5,
    },
    {
      label: 'Sample Temperature',
      sender: `${formatSampleNumber(leftInputs.sampleTemp, 2)}${unitSuffix(leftInputs, 'sampleTemp')}`.trim(),
      receiver: `${formatSampleNumber(rightInputs.sampleTemp, 2)}${unitSuffix(rightInputs, 'sampleTemp')}`.trim(),
      raw: true,
    },
    {
      label: 'Tank Temperature',
      sender: `${formatSampleNumber(leftInputs.tankTemp, 2)}${unitSuffix(leftInputs, 'tankTemp')}`.trim(),
      receiver: `${formatSampleNumber(rightInputs.tankTemp, 2)}${unitSuffix(rightInputs, 'tankTemp')}`.trim(),
      raw: true,
    },
    {
      label: 'BS&W %',
      sender: formatSampleNumber(leftInputs.bswPct, 3),
      receiver: formatSampleNumber(rightInputs.bswPct, 3),
      dp: 3,
    },
    {
      label: 'CCF',
      sender: formatSampleNumber(leftInputs.ccf, 4),
      receiver: formatSampleNumber(rightInputs.ccf, 4),
      dp: 4,
    },
    {
      label: 'Table 11 LT Factor',
      sender: formatSampleNumber(leftTotals.ltFactor, 8),
      receiver: formatSampleNumber(rightTotals.ltFactor, 8),
      dp: 8,
    },
    {
      label: 'Table 11 Method',
      sender: String(leftTotals.table11Method || '-').trim() || '-',
      receiver: String(rightTotals.table11Method || '-').trim() || '-',
      raw: true,
    },
  ]

  return rows.map((row) => ({
    label: row.label,
    sender: showSampleValue(row, 'sender'),
    receiver: showSampleValue(row, 'receiver'),
    delta: sampleDelta(row),
  }))
}

export default buildBargeMtrSampleRows
