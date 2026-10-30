/**
 * Book Stock Management — shared UI arithmetic (Government Data).
 *
 * Mirrors the server rules so the data-entry dialog can preview the closing
 * stock before saving:
 *   closing = opening + production - dispatch + adjustment
 * Products are never added together; every helper keeps product_code in its key.
 */

export const roundQty = (value, digits = 3) => {
  const number = Number(value)
  if (!Number.isFinite(number)) return 0
  const factor = 10 ** digits
  return Math.round(number * factor) / factor
}

export const computeClosingStock = ({ openingStock = 0, production = 0, dispatch = 0, adjustment = 0 } = {}) =>
  roundQty(Number(openingStock || 0) + Number(production || 0) - Number(dispatch || 0) + Number(adjustment || 0))

export const sumProduction = (lines = []) =>
  roundQty(lines.reduce((total, line) => total + Number(line?.production_qty || 0), 0))

/** Fields of one entity/block that produce the given product. */
export const fieldsForBlock = (fields, { entityCode, blockCode, productCode } = {}) =>
  (fields || []).filter(
    (field) =>
      String(field.status || 'Active').toLowerCase() === 'active' &&
      (!entityCode || String(field.entity_code).toLowerCase() === String(entityCode).toLowerCase()) &&
      (!blockCode || String(field.block_code).toLowerCase() === String(blockCode).toLowerCase()) &&
      (!productCode ||
        (field.product_codes || []).some(
          (code) => String(code).toLowerCase() === String(productCode).toLowerCase()
        ))
  )

/** Blocks mapped to an entity through the Export Operations entity-block link. */
export const blocksForEntity = (blocks, links, entityCode) => {
  if (!entityCode) return blocks || []
  const linked = new Set(
    (links || [])
      .filter((link) => String(link.entity_code).toLowerCase() === String(entityCode).toLowerCase())
      .map((link) => String(link.block_code).toLowerCase())
  )
  return (blocks || []).filter((block) => linked.has(String(block.block_code).toLowerCase()))
}

/**
 * Parse the compact bulk-upload production text:
 *   "F1=120; F2=80"  ->  [{ field_code: 'F1', production_qty: 120 }, …]
 * Throws a readable Error so ImportDialog shows it against the row.
 */
export const parseFieldProductionText = (text) => {
  const raw = String(text || '').trim()
  if (!raw) return []
  return raw
    .split(/[;\n]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      if (!part.includes('=')) throw new Error(`Production "${part}" must use FIELD_CODE=QTY`)
      const [fieldCode, qtyText] = part.split('=')
      const qty = Number(qtyText)
      if (!String(fieldCode).trim()) throw new Error('A field code is missing in the production list')
      if (!Number.isFinite(qty) || qty < 0) throw new Error(`Production for ${fieldCode} must be zero or more`)
      return { field_code: String(fieldCode).trim(), production_qty: roundQty(qty) }
    })
}

export const fieldProductionText = (lines = []) =>
  lines
    .filter((line) => Number(line.production_qty))
    .map((line) => `${line.field_code}=${line.production_qty}`)
    .join('; ')

/** Closing-stock bars per block (one bar set per product, never mixed). */
export const closingBars = (blockRows, { entityCode, productCode } = {}) => {
  const rows = (blockRows || []).filter(
    (row) =>
      (!entityCode || String(row.entity_code).toLowerCase() === String(entityCode).toLowerCase()) &&
      (!productCode || String(row.product_code).toLowerCase() === String(productCode).toLowerCase())
  )
  const max = Math.max(...rows.map((row) => Math.abs(Number(row.closing_stock || 0))), 0)
  return rows
    .map((row) => ({
      ...row,
      value: Number(row.closing_stock || 0),
      percent: max > 0 ? Math.max(2, Math.round((Math.abs(Number(row.closing_stock || 0)) / max) * 100)) : 0,
    }))
    .sort((a, b) => b.value - a.value)
}

/** "2026-01-02" minus one day, local-date safe. */
export const previousIsoDate = (isoDate) => {
  if (!isoDate) return ''
  const date = new Date(`${isoDate}T00:00:00`)
  if (Number.isNaN(date.getTime())) return ''
  date.setDate(date.getDate() - 1)
  return date.toISOString().slice(0, 10)
}
