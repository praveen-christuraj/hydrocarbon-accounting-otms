/**
 * Operation date resolution for Operation Entry.
 *
 * The Operation Date / Start Date-Time / End Date-Time inputs were removed
 * from the metadata part of the entry form, because the operation date is
 * captured inside the data-entry payload itself (gauging date, tanker
 * transaction date, reading date, multi-tank before/after dates, ...).
 *
 * `operation_date` is still a mandatory column on the transaction, so the
 * ticket date is now derived from the payload. Records that carry no date
 * anywhere (for example FSO / Shuttle entries) fall back to the date already
 * stored on the ticket and finally to today.
 */

const DATE_PREFIX = /^\d{4}-\d{2}-\d{2}/

const isDateLike = (value) =>
  typeof value === 'string' && DATE_PREFIX.test(value.trim())

const toDateOnly = (value) => String(value).trim().slice(0, 10)

/**
 * How strongly a payload key identifies "the" operation date.
 * -1 means "not a date key at all".
 */
const scoreKey = (key) => {
  const normalized = String(key ?? '').toLowerCase()

  if (!normalized.includes('date')) return -1
  // `event_time` / `gaugingTime` style keys are time-of-day values; they are
  // only used when nothing better exists and never match a date string.
  if (normalized.includes('datetime') || normalized.endsWith('time')) return 0

  // Keys that carry the date the operator actually typed rank above the
  // mirrored `operation_date` some payloads keep for reporting (the
  // Flowmeter layout writes both, and the typed reading date must win).
  if (normalized.includes('reading')) return 6
  if (normalized.includes('gauging')) return 6
  if (normalized.includes('transaction')) return 6
  if (normalized.includes('operation')) return 5
  if (normalized.includes('event')) return 3
  return 2
}

const MAX_DEPTH = 6

/**
 * Walk a payload (object or JSON string) and return the best date candidate
 * as `{ date, score }`. Nested payloads (inputs / meta / before / after ...)
 * are searched too, so new layouts work without touching this file.
 */
const findBestDate = (node, depth = 0) => {
  if (depth > MAX_DEPTH || node === null || node === undefined) {
    return { date: '', score: -1 }
  }

  if (typeof node === 'string') {
    const trimmed = node.trim()
    if (!trimmed) return { date: '', score: -1 }
    if (isDateLike(trimmed)) return { date: toDateOnly(trimmed), score: 1 }
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return findBestDate(JSON.parse(trimmed), depth + 1)
      } catch {
        return { date: '', score: -1 }
      }
    }
    return { date: '', score: -1 }
  }

  if (Array.isArray(node)) {
    let best = { date: '', score: -1 }
    for (const item of node) {
      const candidate = findBestDate(item, depth + 1)
      if (candidate.score > best.score) best = candidate
    }
    return best
  }

  if (typeof node !== 'object') {
    return { date: '', score: -1 }
  }

  let best = { date: '', score: -1 }

  for (const [key, value] of Object.entries(node)) {
    const keyScore = scoreKey(key)

    if (keyScore >= 0 && isDateLike(value)) {
      if (keyScore > best.score) {
        best = { date: toDateOnly(value), score: keyScore }
      }
      continue
    }

    // Nested payloads (`inputs`, `meta`, `before`, `after`, ...) are searched
    // with the same scoring, so `before.date` and `after.date` are found
    // without this file knowing the layout.
    const nested = findBestDate(value, depth + 1)
    if (nested.date && nested.score > best.score) {
      best = nested
    }
  }

  return best
}

export const todayDateOnly = () => {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

/**
 * Best operation date found in the entry's data-entry values.
 * Returns '' when no payload carries a date.
 */
export const resolveOperationDateFromValues = (values) => {
  let best = { date: '', score: -1 }

  for (const value of values || []) {
    const candidate = findBestDate(value?.fieldValue)
    if (candidate.date && candidate.score > best.score) {
      best = candidate
    }
  }

  return best.date
}

/**
 * Operation date used for a ticket:
 *   1. the date captured inside the data-entry payload,
 *   2. the date already stored on the ticket (edited drafts keep theirs),
 *   3. today.
 */
export const resolveOperationDate = (entry) =>
  resolveOperationDateFromValues(entry?.values) ||
  String(entry?.operationDate ?? '').trim().slice(0, 10) ||
  todayDateOnly()
