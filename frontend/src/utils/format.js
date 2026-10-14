/*
 * Locale-aware formatting helpers (Intl based).
 * Use these instead of hard-coded date / number formats in pages.
 */

const resolveLocale = () => {
  if (typeof navigator !== 'undefined' && navigator.language) {
    return navigator.language
  }
  return 'en-GB'
}

const dateTimeFormatter = () =>
  new Intl.DateTimeFormat(resolveLocale(), {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })

const dateFormatter = () =>
  new Intl.DateTimeFormat(resolveLocale(), {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })

export const toDate = (value) => {
  if (value === null || value === undefined || value === '') return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export const formatDateTime = (value, fallback = '-') => {
  const date = toDate(value)
  return date ? dateTimeFormatter().format(date) : fallback
}

export const formatDate = (value, fallback = '-') => {
  const date = toDate(value)
  return date ? dateFormatter().format(date) : fallback
}

export const formatNumber = (value, options = {}) => {
  if (value === null || value === undefined || value === '') return '-'
  const number = Number(value)
  if (Number.isNaN(number)) return String(value)
  return new Intl.NumberFormat(resolveLocale(), {
    maximumFractionDigits: 3,
    ...options,
  }).format(number)
}

/** YYYY-MM-DD in local time (for <input type="date"> comparisons). */
export const toIsoDateString = (value) => {
  const date = toDate(value)
  if (!date) return ''
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export const todayIsoDate = () => toIsoDateString(new Date())

/** File-name friendly timestamp, e.g. 20261014-153045 */
export const fileTimestamp = (date = new Date()) => {
  const pad = (n) => String(n).padStart(2, '0')
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  )
}

export const slugify = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'export'
