/*
 * Locale-aware formatting helpers (Intl based).
 * Use these instead of hard-coded date / number formats in pages.
 */

const ISO_DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const TIME_ONLY_RE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/

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
  const str = String(value).trim()
  const match = ISO_DATE_ONLY_RE.exec(str)
  if (match) {
    const year = Number(match[1])
    const month = Number(match[2])
    const day = Number(match[3])
    const localDate = new Date(year, month - 1, day)
    if (
      localDate.getFullYear() === year &&
      localDate.getMonth() === month - 1 &&
      localDate.getDate() === day
    ) {
      return localDate
    }
    return null
  }
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export const formatCalendarDate = (value, fallback = '-') => {
  if (value === null || value === undefined || value === '') return fallback
  const str = String(value).trim()
  if (ISO_DATE_ONLY_RE.test(str)) {
    return str
  }
  const date = toDate(value)
  return date ? dateFormatter().format(date) : str || fallback
}

export const formatGaugingTime = (value, fallback = '-') => {
  if (value === null || value === undefined || value === '') return fallback
  const str = String(value).trim()
  const match = TIME_ONLY_RE.exec(str)
  if (match) {
    const hh = match[1].padStart(2, '0')
    const mm = match[2]
    const ss = match[3]
    return ss && ss !== '00' ? `${hh}:${mm}:${ss}` : `${hh}:${mm}`
  }
  return str || fallback
}

export const formatDateTime = (value, fallback = '-') => {
  if (value === null || value === undefined || value === '') return fallback
  const str = String(value).trim()
  if (ISO_DATE_ONLY_RE.test(str)) {
    return formatDate(str, fallback)
  }
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
  const resolvedOptions =
    typeof options === 'number'
      ? { minimumFractionDigits: options, maximumFractionDigits: options }
      : { maximumFractionDigits: 3, ...options }
  return new Intl.NumberFormat(resolveLocale(), resolvedOptions).format(number)
}

/** YYYY-MM-DD in local time (for <input type="date"> comparisons). */
export const toIsoDateString = (value) => {
  if (!value) return ''
  const str = String(value).trim()
  if (ISO_DATE_ONLY_RE.test(str)) {
    return str
  }
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
