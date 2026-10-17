/*
 * Material Balance Template – pure helpers for the configuration page.
 *
 * Everything here mirrors the (frozen) backend so the page can explain and
 * pre-validate a template before anything is saved:
 *   - backend/app/routers/material_balance_templates.py  (validation, key normalisation)
 *   - backend/app/services/material_balance_helpers.py   (which template / columns the
 *     Material Balance Report uses and how Book Closing is calculated)
 *   - backend/app/routers/reports.py                     (value of each column type)
 *
 * No React and no API calls in this module.
 */

export const COLUMN_TYPES = [
  'OPENING',
  'MOVEMENT',
  'BOOK_CLOSING',
  'ACTUAL_CLOSING',
  'LOSS_GAIN',
  'FORMULA',
  'INFO',
]

export const COLUMN_TYPE_INFO = {
  OPENING: {
    label: 'Opening Stock',
    description: "Previous day's closing stock, or the day's Opening Stock entry when there is one.",
  },
  MOVEMENT: {
    label: 'Movement',
    description: 'Daily total of the Tank Operations mapped to this column.',
  },
  BOOK_CLOSING: {
    label: 'Book Closing',
    description: 'Calculated: opening + counted receipts − counted dispatches.',
  },
  ACTUAL_CLOSING: {
    label: 'Actual Closing',
    description: "Physical stock from the day's Closing Stock entry (or its last tank entry).",
  },
  LOSS_GAIN: {
    label: 'Loss / Gain',
    description: 'Calculated: actual closing − book closing.',
  },
  FORMULA: {
    label: 'Formula',
    description: 'Reserved for formulas. The report currently shows 0.',
  },
  INFO: {
    label: 'Information',
    description: 'Placeholder column. The report shows 0.',
  },
}

export const MOVEMENT_DIRECTIONS = ['IN', 'OUT', 'NEUTRAL']

export const DIRECTION_INFO = {
  IN: { label: 'IN – receipts', description: 'Adds stock: Receipt, Production, Receipt from X …' },
  OUT: { label: 'OUT – dispatches', description: 'Reduces stock: Dispatch, Draining, Dispatch to X …' },
  NEUTRAL: { label: 'NEUTRAL', description: 'Shown in the report, never part of Book Closing.' },
}

/* Book Closing treatment of a MOVEMENT column. The backend stores three
 * Yes/No flags; only three behaviours exist (material_balance_helpers.py):
 *   counted  – MB = Yes, Book = Yes, ITT = No: the movements add to / reduce Book Closing
 *   shown    – ITT = No and only one of MB / Book is Yes: displayed, not counted
 *   internal – ITT = Yes, or MB = No and Book = No: displayed, and the mapped
 *              operations are left out of Book Closing everywhere in the template. */
export const TREATMENTS = ['counted', 'shown', 'internal']

export const TREATMENT_INFO = {
  counted: {
    label: 'Counted in Book Closing',
    description: 'External receipts and dispatches. IN adds to and OUT reduces Book Closing.',
  },
  shown: {
    label: 'Shown only',
    description: 'Displayed in the report but not counted in Book Closing.',
  },
  internal: {
    label: 'Internal transfer (ITT)',
    description: 'Tracked for information. These operations never count in Book Closing.',
  },
}

const yes = (value) => String(value || '').trim().toUpperCase() === 'YES'

export const classifyTreatment = (column) => {
  if (yes(column?.isInternalTransfer)) return 'internal'
  const mb = yes(column?.includeInMaterialBalance)
  const book = yes(column?.includeInBookClosing)
  if (mb && book) return 'counted'
  if (!mb && !book) return 'internal'
  return 'shown'
}

export const flagsForTreatment = (treatment) => {
  if (treatment === 'internal') {
    return { includeInMaterialBalance: 'No', includeInBookClosing: 'No', isInternalTransfer: 'Yes' }
  }
  if (treatment === 'shown') {
    return { includeInMaterialBalance: 'Yes', includeInBookClosing: 'No', isInternalTransfer: 'No' }
  }
  return { includeInMaterialBalance: 'Yes', includeInBookClosing: 'Yes', isInternalTransfer: 'No' }
}

/* ------------------------------------------------------------- column keys */

/** Exactly what the backend stores (normalize_column_key). */
export const normalizeColumnKey = (value) => {
  let normalized = String(value ?? '').trim().toLowerCase()
  if (!normalized) return ''
  normalized = normalized.replaceAll(' ', '_').replaceAll('-', '_').replaceAll('/', '_')
  while (normalized.includes('__')) normalized = normalized.replaceAll('__', '_')
  return normalized.toUpperCase()
}

/** Clean key proposed from a label: letters, digits and single underscores. */
export const suggestColumnKey = (label) =>
  String(label ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')

export const normalizeOperationCode = (value) => normalizeColumnKey(value)

/* ----------------------------------------------------------------- columns */

export const emptyColumn = () => ({
  id: null,
  columnLabel: '',
  columnKey: '',
  columnOrder: 1,
  columnType: 'MOVEMENT',
  movementDirection: 'IN',
  mappedOperationCodes: [],
  excludedOperationCodes: [],
  includeInMaterialBalance: 'Yes',
  includeInBookClosing: 'Yes',
  isInternalTransfer: 'No',
  formulaJson: null,
  remarks: '',
  status: 'Active',
})

export const isActive = (item) => String(item?.status || 'Active') === 'Active'

export const sortColumns = (columns = []) =>
  [...columns].sort(
    (a, b) => Number(a.columnOrder || 0) - Number(b.columnOrder || 0) || Number(a.id || 0) - Number(b.id || 0)
  )

/* Report position of a column type, used to propose where a new column goes:
 * opening first, receipts, dispatches, neutral, placeholders, then the
 * calculated stock columns. */
export const columnRank = (column) => {
  const type = String(column?.columnType || '').toUpperCase()
  if (type === 'OPENING') return 0
  if (type === 'MOVEMENT') {
    const direction = String(column?.movementDirection || '').toUpperCase()
    if (direction === 'IN') return 1
    if (direction === 'OUT') return 2
    return 3
  }
  if (type === 'BOOK_CLOSING') return 5
  if (type === 'ACTUAL_CLOSING') return 6
  if (type === 'LOSS_GAIN') return 7
  return 4
}

/** Index in `sequence` (sorted columns) at which a new column naturally goes. */
export const suggestInsertIndex = (sequence, column) => {
  const rank = columnRank(column)
  let index = 0
  sequence.forEach((item, position) => {
    if (columnRank(item) <= rank) index = position + 1
  })
  return index
}

/**
 * Assign `column_order` values for a desired sequence.
 *
 * `sequence` = [{ key, order, fixed }] in the wanted report order. Items with
 * `fixed: true` keep their current order when possible; the others need a new
 * order. When the free numbers between two fixed neighbours are not enough,
 * every item is renumbered 10, 20, 30 … (the backend sorts by order, then id).
 *
 * Returns { orders: Map(key → order), renumbered: boolean }.
 */
export const planColumnOrders = (sequence) => {
  const orders = new Map()
  const STEP = 10
  let feasible = true
  let index = 0
  let previous = null

  while (index < sequence.length && feasible) {
    const item = sequence[index]
    if (item.fixed) {
      const order = Number(item.order)
      if (!Number.isFinite(order) || (previous !== null && order <= previous)) {
        feasible = false
        break
      }
      orders.set(item.key, order)
      previous = order
      index += 1
      continue
    }

    // A run of items that need an order.
    let end = index
    while (end < sequence.length && !sequence[end].fixed) end += 1
    const count = end - index
    const next = end < sequence.length ? Number(sequence[end].order) : null

    if (next === null) {
      const start = previous === null ? 0 : previous
      for (let offset = 0; offset < count; offset += 1) {
        orders.set(sequence[index + offset].key, start + STEP * (offset + 1))
      }
      previous = start + STEP * count
    } else {
      const low = previous === null ? 0 : previous
      const room = next - low - 1
      if (!Number.isFinite(next) || room < count) {
        feasible = false
        break
      }
      const step = Math.floor((next - low) / (count + 1))
      for (let offset = 0; offset < count; offset += 1) {
        orders.set(sequence[index + offset].key, low + step * (offset + 1))
      }
      previous = low + step * count
    }
    index = end
  }

  if (feasible) return { orders, renumbered: false }

  const renumbered = new Map()
  sequence.forEach((item, position) => renumbered.set(item.key, STEP * (position + 1)))
  return { orders: renumbered, renumbered: true }
}

/**
 * Plan the writes needed to place `column` (new or existing) at `targetIndex`
 * of the other columns' order. Returns { order, updates: [{ column, order }] }
 * where `updates` are the OTHER columns whose order must change.
 */
export const planColumnPlacement = (columns, column, targetIndex) => {
  const others = sortColumns(columns.filter((item) => column.id == null || item.id !== column.id))
  const index = Math.max(0, Math.min(targetIndex, others.length))

  // Keep the current order when it already sits between the new neighbours.
  const current = Number(column.columnOrder)
  const before = index > 0 ? Number(others[index - 1].columnOrder) : null
  const after = index < others.length ? Number(others[index].columnOrder) : null
  if (
    Number.isFinite(current) &&
    current >= 1 &&
    (before === null || before < current) &&
    (after === null || current < after)
  ) {
    return { order: current, updates: [] }
  }

  const sequence = others.map((item) => ({ key: `c${item.id}`, order: item.columnOrder, fixed: true }))
  sequence.splice(index, 0, { key: 'target', order: column.columnOrder, fixed: false })
  const { orders } = planColumnOrders(sequence)
  const updates = others
    .filter((item) => orders.get(`c${item.id}`) !== Number(item.columnOrder))
    .map((item) => ({ column: item, order: orders.get(`c${item.id}`) }))
  return { order: orders.get('target'), updates }
}

/** Current position of an existing column among the others (for the position select). */
export const currentInsertIndex = (columns, column) => {
  const sorted = sortColumns(columns)
  const position = sorted.findIndex((item) => item.id === column.id)
  return position < 0 ? sorted.length : position
}

/* -------------------------------------------------------- report usage */

/**
 * The Material Balance Report picks, per location, the newest (highest id)
 * Active template (get_active_material_balance_template_for_location).
 * Returns Map(templateId → { state, reportTemplate }) where state is
 * 'in-use' | 'shadowed' | 'inactive'.
 */
export const computeReportUsage = (templates = []) => {
  const newestActive = new Map()
  templates.forEach((template) => {
    if (!isActive(template)) return
    const location = String(template.locationCode || '').toUpperCase()
    const current = newestActive.get(location)
    if (!current || Number(template.id) > Number(current.id)) newestActive.set(location, template)
  })

  const usage = new Map()
  templates.forEach((template) => {
    const reportTemplate = newestActive.get(String(template.locationCode || '').toUpperCase()) || null
    let state = 'inactive'
    if (isActive(template)) state = reportTemplate && reportTemplate.id === template.id ? 'in-use' : 'shadowed'
    usage.set(template.id, { state, reportTemplate })
  })
  return usage
}

/** Templates that must be deactivated so that `template` becomes the report template. */
export const templatesBlockingReportUse = (templates, template) =>
  templates.filter(
    (item) =>
      item.id !== template.id &&
      isActive(item) &&
      String(item.locationCode || '').toUpperCase() === String(template.locationCode || '').toUpperCase() &&
      Number(item.id) > Number(template.id)
  )

/* -------------------------------------------------------- book closing */

/** Plain-language role of a column in the report (shown in the columns table). */
export const describeColumnRole = (column) => {
  const type = String(column?.columnType || '').toUpperCase()
  if (type === 'MOVEMENT') {
    const treatment = classifyTreatment(column)
    const direction = String(column?.movementDirection || '').toUpperCase()
    if (treatment === 'internal') return { tone: 'muted', label: 'Internal transfer – not in Book Closing' }
    if (treatment === 'shown') return { tone: 'muted', label: 'Shown only – not in Book Closing' }
    if (direction === 'IN') return { tone: 'positive', label: 'Added to Book Closing' }
    if (direction === 'OUT') return { tone: 'negative', label: 'Subtracted from Book Closing' }
    return { tone: 'muted', label: 'No stock effect (NEUTRAL)' }
  }
  if (type === 'OPENING') return { tone: 'info', label: 'Start of Book Closing' }
  if (type === 'BOOK_CLOSING' || type === 'LOSS_GAIN' || type === 'ACTUAL_CLOSING') {
    return { tone: 'info', label: 'Calculated by the report' }
  }
  return { tone: 'muted', label: 'Shows 0 (placeholder)' }
}

/** Book Closing formula in words, from the active columns. */
export const summariseBookClosing = (columns = []) => {
  const active = sortColumns(columns.filter(isActive))
  const movement = active.filter((column) => String(column.columnType).toUpperCase() === 'MOVEMENT')
  const counted = movement.filter((column) => classifyTreatment(column) === 'counted')
  return {
    opening: active.find((column) => column.columnType === 'OPENING') || null,
    added: counted.filter((column) => column.movementDirection === 'IN'),
    subtracted: counted.filter((column) => column.movementDirection === 'OUT'),
    notCounted: movement.filter(
      (column) => classifyTreatment(column) !== 'counted' || column.movementDirection === 'NEUTRAL'
    ),
    bookClosing: active.find((column) => column.columnType === 'BOOK_CLOSING') || null,
    actualClosing: active.find((column) => column.columnType === 'ACTUAL_CLOSING') || null,
    lossGain: active.find((column) => column.columnType === 'LOSS_GAIN') || null,
  }
}

/* ------------------------------------------------------- standard columns */

export const STANDARD_COLUMNS = [
  { columnLabel: 'Opening Stock', columnKey: 'OPENING_STOCK', columnType: 'OPENING' },
  { columnLabel: 'Book Closing Stock', columnKey: 'BOOK_CLOSING_STOCK', columnType: 'BOOK_CLOSING' },
  { columnLabel: 'Closing Stock', columnKey: 'CLOSING_STOCK', columnType: 'ACTUAL_CLOSING' },
  { columnLabel: 'Loss/Gain', columnKey: 'LOSS_GAIN', columnType: 'LOSS_GAIN' },
]

const buildColumn = (fields) => ({
  ...emptyColumn(),
  movementDirection: fields.columnType === 'MOVEMENT' ? fields.movementDirection || 'IN' : '',
  ...fields,
})

/** Standard columns that the template does not have yet (by type or key). */
export const missingStandardColumns = (columns = []) => {
  const types = new Set(columns.map((column) => String(column.columnType).toUpperCase()))
  const keys = new Set(columns.map((column) => normalizeColumnKey(column.columnKey)))
  return STANDARD_COLUMNS.filter((column) => !types.has(column.columnType) && !keys.has(column.columnKey)).map(
    (column) => buildColumn(column)
  )
}

/* ------------------------------------------------ build from tank operations */

const INTERNAL_PATTERN = /(^|[^A-Z0-9])(ITT|INTERNAL|INTER[_\s-]?TANK)([^A-Z0-9]|$)/i

/** Heuristic: operations that look like internal tank transfers (pre-ticks ITT). */
export const looksInternalTransfer = (operation) =>
  INTERNAL_PATTERN.test(String(operation?.operationCode || '')) ||
  INTERNAL_PATTERN.test(String(operation?.operationLabel || ''))

const SIGN_RANK = { IN: 1, OUT: 2, NEUTRAL: 3 }

export const movementOperations = (operations = []) =>
  operations
    .filter((operation) => isActive(operation) && SIGN_RANK[String(operation.operationSign).toUpperCase()])
    .sort(
      (a, b) =>
        SIGN_RANK[String(a.operationSign).toUpperCase()] - SIGN_RANK[String(b.operationSign).toUpperCase()] ||
        Number(a.sortOrder || 0) - Number(b.sortOrder || 0) ||
        String(a.operationLabel || '').localeCompare(String(b.operationLabel || ''))
    )

const uniqueKey = (base, used) => {
  const root = base || 'COLUMN'
  let candidate = root
  let counter = 2
  while (used.has(candidate)) {
    candidate = `${root}_${counter}`
    counter += 1
  }
  used.add(candidate)
  return candidate
}

/**
 * Proposed columns for a template, built from the location's Tank Operations:
 * the standard stock columns plus one MOVEMENT column per IN / OUT / NEUTRAL
 * operation. Operations already mapped in the template are listed but
 * disabled. Each proposal: { id, kind, column, include, disabled, reason, operation }.
 */
export const proposeColumns = ({ operations = [], columns = [] }) => {
  const usedKeys = new Set(columns.map((column) => normalizeColumnKey(column.columnKey)))
  const mappedBy = new Map()
  columns
    .filter((column) => isActive(column) && String(column.columnType).toUpperCase() === 'MOVEMENT')
    .forEach((column) => {
      ;(column.mappedOperationCodes || []).forEach((code) => {
        const normalized = normalizeOperationCode(code)
        if (!mappedBy.has(normalized)) mappedBy.set(normalized, column)
      })
    })

  const proposals = []
  const missing = missingStandardColumns(columns)
  STANDARD_COLUMNS.forEach((standard) => {
    const column = missing.find((item) => item.columnType === standard.columnType)
    proposals.push({
      id: `standard-${standard.columnType}`,
      kind: 'standard',
      column: column ? { ...column, columnKey: uniqueKey(column.columnKey, usedKeys) } : buildColumn(standard),
      include: Boolean(column),
      disabled: !column,
      reason: column ? '' : 'Already in the template',
      operation: null,
    })
  })

  movementOperations(operations).forEach((operation) => {
    const code = normalizeOperationCode(operation.operationCode)
    const sign = String(operation.operationSign).toUpperCase()
    const existing = mappedBy.get(code)
    const internal = looksInternalTransfer(operation)
    const treatment = sign === 'NEUTRAL' ? 'shown' : internal ? 'internal' : 'counted'
    proposals.push({
      id: `operation-${operation.id ?? code}`,
      kind: 'movement',
      column: buildColumn({
        columnLabel: operation.operationLabel || code,
        columnKey: existing ? suggestColumnKey(code) : uniqueKey(suggestColumnKey(code), usedKeys),
        columnType: 'MOVEMENT',
        movementDirection: sign,
        mappedOperationCodes: [code],
        ...flagsForTreatment(treatment),
      }),
      include: !existing && sign !== 'NEUTRAL',
      disabled: Boolean(existing),
      reason: existing ? `Already mapped in “${existing.columnLabel}”` : '',
      operation,
    })
  })

  return proposals
}

/**
 * Plan the creation of several new columns: each one is inserted at its
 * natural position (suggestInsertIndex), keeping the given relative order.
 * Returns { creates: [{ column, order }], updates: [{ column, order }] }.
 */
export const planNewColumns = (existingColumns, newColumns) => {
  const sequence = sortColumns(existingColumns).map((column) => ({
    key: `c${column.id}`,
    column,
    order: column.columnOrder,
    fixed: true,
  }))
  newColumns.forEach((column, index) => {
    const position = suggestInsertIndex(
      sequence.map((item) => item.column),
      column
    )
    sequence.splice(position, 0, { key: `n${index}`, column, order: null, fixed: false })
  })
  const { orders } = planColumnOrders(sequence)
  return {
    creates: sequence
      .filter((item) => !item.fixed)
      .map((item) => ({ column: item.column, order: orders.get(item.key) })),
    updates: sequence
      .filter((item) => item.fixed && orders.get(item.key) !== Number(item.column.columnOrder))
      .map((item) => ({ column: item.column, order: orders.get(item.key) })),
  }
}

/* ------------------------------------------------------------ health checks */

const labelOf = (column) => column?.columnLabel || column?.columnKey || 'Column'

/**
 * Checks that explain what the report will do with a template.
 * Returns [{ level: 'error'|'warning'|'info', code, message, operations? }].
 * `operations` = active Tank Operations of the template's location, or null
 * when they could not be loaded (operation checks are skipped then).
 */
export const analyzeTemplate = ({ columns = [], operations = null }) => {
  const checks = []
  const active = columns.filter(isActive)

  if (active.length === 0) {
    checks.push({
      level: 'error',
      code: 'no-columns',
      message: 'No active columns. The Material Balance Report cannot run with this template.',
    })
    return checks
  }

  const activeTypes = new Set(active.map((column) => String(column.columnType).toUpperCase()))
  const allTypes = new Set(columns.map((column) => String(column.columnType).toUpperCase()))
  const missing = STANDARD_COLUMNS.filter((column) => !activeTypes.has(column.columnType))
  if (missing.length > 0) {
    checks.push({
      level: 'warning',
      code: 'missing-standard',
      message: `Missing standard column${missing.length === 1 ? '' : 's'}: ${missing
        .map((column) => `${column.columnLabel}${allTypes.has(column.columnType) ? ' (inactive)' : ''}`)
        .join(', ')}.`,
      canAdd: missingStandardColumns(columns).length > 0,
    })
  }

  const movement = active.filter((column) => String(column.columnType).toUpperCase() === 'MOVEMENT')

  movement
    .filter((column) => (column.mappedOperationCodes || []).length === 0)
    .forEach((column) => {
      checks.push({
        level: 'error',
        code: 'unmapped-column',
        message: `“${labelOf(column)}” has no Tank Operation mapped, so it always shows 0.`,
      })
    })

  if (Array.isArray(operations)) {
    const byCode = new Map(operations.map((operation) => [normalizeOperationCode(operation.operationCode), operation]))

    movement.forEach((column) => {
      const direction = String(column.movementDirection || '').toUpperCase()
      const unknown = []
      const wrongSign = []
      ;(column.mappedOperationCodes || []).forEach((code) => {
        const operation = byCode.get(normalizeOperationCode(code))
        if (!operation) unknown.push(code)
        else if (String(operation.operationSign).toUpperCase() !== direction) {
          wrongSign.push(`${code} (${operation.operationSign})`)
        }
      })
      if (unknown.length > 0) {
        checks.push({
          level: 'warning',
          code: 'unknown-operation',
          message: `“${labelOf(column)}” maps ${unknown.join(', ')}, which ${
            unknown.length === 1 ? 'is' : 'are'
          } not an active Tank Operation of this location.`,
        })
      }
      if (wrongSign.length > 0) {
        checks.push({
          level: 'warning',
          code: 'wrong-sign',
          message: `“${labelOf(column)}” is an ${direction} column but maps ${wrongSign.join(
            ', '
          )}; those movements never match it.`,
        })
      }
    })

    const mapped = new Set()
    movement.forEach((column) => {
      const direction = String(column.movementDirection || '').toUpperCase()
      ;(column.mappedOperationCodes || []).forEach((code) => {
        const normalized = normalizeOperationCode(code)
        const excluded = (column.excludedOperationCodes || []).map(normalizeOperationCode)
        if (!excluded.includes(normalized)) mapped.add(`${normalized}|${direction}`)
      })
    })
    const notInReport = operations.filter((operation) => {
      const sign = String(operation.operationSign).toUpperCase()
      if (sign !== 'IN' && sign !== 'OUT') return false
      return !mapped.has(`${normalizeOperationCode(operation.operationCode)}|${sign}`)
    })
    if (notInReport.length > 0) {
      checks.push({
        level: 'warning',
        code: 'operations-not-in-report',
        message: `Tank Operations not shown in any column (left out of the report and of Book Closing): ${notInReport
          .map((operation) => `${operation.operationLabel || operation.operationCode} (${operation.operationSign})`)
          .join(', ')}.`,
        operations: notInReport,
      })
    }
  }

  // Internal-transfer codes are removed from Book Closing for the whole template.
  const internalCodes = new Map()
  movement
    .filter((column) => classifyTreatment(column) === 'internal')
    .forEach((column) => {
      ;(column.mappedOperationCodes || []).forEach((code) => {
        internalCodes.set(normalizeOperationCode(code), column)
      })
    })
  const counted = movement.filter((column) => classifyTreatment(column) === 'counted')
  counted.forEach((column) => {
    const clashes = (column.mappedOperationCodes || []).filter((code) =>
      internalCodes.has(normalizeOperationCode(code))
    )
    if (clashes.length > 0) {
      const internalColumn = internalCodes.get(normalizeOperationCode(clashes[0]))
      checks.push({
        level: 'warning',
        code: 'internal-clash',
        message: `${clashes.join(', ')} ${clashes.length === 1 ? 'is' : 'are'} counted in “${labelOf(
          column
        )}” but marked internal in “${labelOf(internalColumn)}”, so ${
          clashes.length === 1 ? 'it is' : 'they are'
        } left out of Book Closing.`,
      })
    }
  })

  const countedIn = new Map()
  counted.forEach((column) => {
    ;(column.mappedOperationCodes || []).forEach((code) => {
      const normalized = normalizeOperationCode(code)
      countedIn.set(normalized, [...(countedIn.get(normalized) || []), labelOf(column)])
    })
  })
  countedIn.forEach((labels, code) => {
    if (labels.length > 1) {
      checks.push({
        level: 'info',
        code: 'double-mapped',
        message: `${code} appears in ${labels.length} columns (${labels.join(', ')}). Book Closing counts it once.`,
      })
    }
  })

  return checks
}
