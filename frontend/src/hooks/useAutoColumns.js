import { useMemo } from 'react'

/*
 * Derive filter / export column definitions from the rows themselves so that
 * every list page can be filtered "on any criteria from the available content"
 * (owner rule 5) without hand-maintaining a column list per page.
 *
 *   const columns = useAutoColumns(rows, { exclude: ['password'], labels: { nsvBbl: 'NSV (bbl)' } })
 */

const DEFAULT_EXCLUDE = new Set(['id', 'password', 'passwordHash', '__rowNumber'])

const ACRONYMS = {
  id: 'ID',
  api: 'API',
  nsv: 'NSV',
  gsv: 'GSV',
  tov: 'TOV',
  gov: 'GOV',
  bbl: 'bbl',
  m3: 'm³',
  mt: 'MT',
  vcf: 'VCF',
  wcf: 'WCF',
  fso: 'FSO',
  csv: 'CSV',
  pdf: 'PDF',
  url: 'URL',
  uom: 'UOM',
  bl: 'BL',
  ullage: 'Ullage',
}

export const humanizeKey = (key) => {
  if (!key) return ''
  const words = String(key)
    .replace(/[_\-.]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim()
    .split(/\s+/)
  return words
    .map((word) => {
      const lower = word.toLowerCase()
      if (ACRONYMS[lower]) return ACRONYMS[lower]
      return word.charAt(0).toUpperCase() + word.slice(1)
    })
    .join(' ')
}

const isScalar = (value) =>
  value === null ||
  value === undefined ||
  typeof value === 'string' ||
  typeof value === 'number' ||
  typeof value === 'boolean' ||
  value instanceof Date

export const inferColumns = (rows, options = {}) => {
  const { exclude = [], include, labels = {}, types = {}, sample = 100, maxColumns = 200 } = options
  const safeRows = Array.isArray(rows) ? rows : []
  const excluded = new Set([...DEFAULT_EXCLUDE, ...exclude])
  const order = []
  const seen = new Map()

  safeRows.slice(0, sample).forEach((row) => {
    if (!row || typeof row !== 'object') return
    Object.keys(row).forEach((key) => {
      if (excluded.has(key) || key.startsWith('_')) return
      if (include && !include.includes(key)) return
      const value = row[key]
      if (!seen.has(key)) {
        seen.set(key, { scalar: isScalar(value), hasValue: value !== null && value !== undefined && value !== '' })
        order.push(key)
      } else if (!isScalar(value)) {
        seen.get(key).scalar = false
      } else if (value !== null && value !== undefined && value !== '') {
        seen.get(key).hasValue = true
      }
    })
  })

  const keys = include ? include.filter((key) => seen.has(key) || labels[key]) : order
  return keys
    .filter((key) => {
      const info = seen.get(key)
      return info ? info.scalar : true
    })
    .slice(0, maxColumns)
    .map((key) => ({
      key,
      label: labels[key] || humanizeKey(key),
      ...(types[key] ? { type: types[key] } : {}),
    }))
}

export function useAutoColumns(rows, options) {
  // Options objects are usually inline literals; serialise for a stable dep.
  const optionsKey = JSON.stringify(options || {})
  return useMemo(
    () => inferColumns(rows, options),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, optionsKey]
  )
}

export default useAutoColumns
