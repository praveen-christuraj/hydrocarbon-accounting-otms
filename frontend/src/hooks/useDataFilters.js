import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toDate, toIsoDateString } from '../utils/format'
import { logUiAction } from '../utils/actionLogger'

/*
 * useDataFilters – client-side "easy" + "advanced" filtering for list pages
 * (owner rule 5). Date and date-range filters are kept as separate controls.
 *
 *   const columns = [
 *     { key: 'locationName', label: 'Location Name' },           // type auto-detected
 *     { key: 'status', label: 'Status', type: 'select' },
 *     { key: 'createdAt', label: 'Created', type: 'date' },
 *     { key: 'parent', label: 'Parent', accessor: (row) => parentName(row) },
 *   ]
 *   const filters = useDataFilters(rows, columns, { module: 'Location Master' })
 *   <DataFilterBar {...filters.barProps} />
 *   filters.filteredRows  → rows to paginate / export
 */

export const TEXT_OPERATORS = [
  { value: 'contains', label: 'contains' },
  { value: 'not_contains', label: 'does not contain' },
  { value: 'equals', label: 'equals' },
  { value: 'not_equals', label: 'does not equal' },
  { value: 'starts_with', label: 'starts with' },
  { value: 'ends_with', label: 'ends with' },
  { value: 'is_empty', label: 'is empty' },
  { value: 'is_not_empty', label: 'is not empty' },
]

export const NUMBER_OPERATORS = [
  { value: 'equals', label: '=' },
  { value: 'not_equals', label: '≠' },
  { value: 'gt', label: '>' },
  { value: 'gte', label: '≥' },
  { value: 'lt', label: '<' },
  { value: 'lte', label: '≤' },
  { value: 'between', label: 'between' },
  { value: 'is_empty', label: 'is empty' },
  { value: 'is_not_empty', label: 'is not empty' },
]

export const DATE_OPERATORS = [
  { value: 'on', label: 'on' },
  { value: 'before', label: 'before' },
  { value: 'after', label: 'after' },
  { value: 'between', label: 'between' },
  { value: 'is_empty', label: 'is empty' },
  { value: 'is_not_empty', label: 'is not empty' },
]

export const SELECT_OPERATORS = [
  { value: 'equals', label: 'is' },
  { value: 'not_equals', label: 'is not' },
  { value: 'is_empty', label: 'is empty' },
  { value: 'is_not_empty', label: 'is not empty' },
]

export const operatorsForType = (type) => {
  if (type === 'number') return NUMBER_OPERATORS
  if (type === 'date') return DATE_OPERATORS
  if (type === 'select' || type === 'boolean') return SELECT_OPERATORS
  return TEXT_OPERATORS
}

const VALUELESS = new Set(['is_empty', 'is_not_empty'])

export const operatorNeedsValue = (operator) => !VALUELESS.has(operator)
export const operatorNeedsSecondValue = (operator) => operator === 'between'

const isBlank = (value) =>
  value === null ||
  value === undefined ||
  value === '' ||
  (Array.isArray(value) && value.length === 0)

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}([T\s]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/

const looksLikeDate = (value) => {
  if (value instanceof Date) return true
  if (typeof value !== 'string') return false
  return ISO_DATE_RE.test(value.trim()) && toDate(value) !== null
}

const looksLikeNumber = (value) => {
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  return trimmed !== '' && !Number.isNaN(Number(trimmed)) && /^-?\d*(\.\d+)?$/.test(trimmed)
}

const getRawValue = (row, column) => {
  if (!row) return undefined
  if (typeof column.accessor === 'function') return column.accessor(row)
  if (column.key && column.key.includes('.')) {
    return column.key.split('.').reduce((acc, part) => (acc == null ? acc : acc[part]), row)
  }
  return row[column.key]
}

const toText = (value) => {
  if (isBlank(value)) return ''
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (value instanceof Date) return toIsoDateString(value)
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  return String(value)
}

const detectType = (rows, column) => {
  if (column.type) return column.type
  const sample = []
  for (let i = 0; i < rows.length && sample.length < 60; i += 1) {
    const value = getRawValue(rows[i], column)
    if (!isBlank(value)) sample.push(value)
  }
  if (sample.length === 0) return 'text'
  if (sample.every((value) => typeof value === 'boolean')) return 'boolean'
  if (sample.every(looksLikeNumber)) return 'number'
  if (sample.every(looksLikeDate)) return 'date'
  const distinct = new Set(sample.map(toText))
  if (rows.length >= 6 && distinct.size <= Math.min(12, Math.max(2, rows.length / 2))) {
    return 'select'
  }
  return 'text'
}

const compareText = (haystack, operator, needle) => {
  const a = haystack.toLowerCase()
  const b = String(needle ?? '').toLowerCase()
  switch (operator) {
    case 'contains':
      return a.includes(b)
    case 'not_contains':
      return !a.includes(b)
    case 'equals':
      return a === b
    case 'not_equals':
      return a !== b
    case 'starts_with':
      return a.startsWith(b)
    case 'ends_with':
      return a.endsWith(b)
    default:
      return true
  }
}

const compareNumber = (value, operator, needle, needle2) => {
  const a = Number(value)
  const b = Number(needle)
  if (Number.isNaN(a)) return false
  switch (operator) {
    case 'equals':
      return a === b
    case 'not_equals':
      return a !== b
    case 'gt':
      return a > b
    case 'gte':
      return a >= b
    case 'lt':
      return a < b
    case 'lte':
      return a <= b
    case 'between': {
      const hi = Number(needle2)
      const low = Math.min(b, hi)
      const high = Math.max(b, hi)
      return a >= low && a <= high
    }
    default:
      return true
  }
}

const compareDate = (value, operator, needle, needle2) => {
  const iso = toIsoDateString(value)
  if (!iso) return false
  switch (operator) {
    case 'on':
      return iso === needle
    case 'before':
      return iso < needle
    case 'after':
      return iso > needle
    case 'between': {
      const from = needle && needle2 ? (needle < needle2 ? needle : needle2) : needle || needle2
      const to = needle && needle2 ? (needle < needle2 ? needle2 : needle) : needle || needle2
      if (from && iso < from) return false
      if (to && iso > to) return false
      return true
    }
    default:
      return true
  }
}

const evaluateCondition = (row, condition, columnMap) => {
  const column = columnMap.get(condition.field)
  if (!column) return true
  const operator = condition.operator
  const raw = getRawValue(row, column)

  if (operator === 'is_empty') return isBlank(raw)
  if (operator === 'is_not_empty') return !isBlank(raw)

  if (isBlank(condition.value) && !(operator === 'between' && !isBlank(condition.value2))) {
    return true // incomplete condition – ignore
  }

  if (column.resolvedType === 'number') {
    return compareNumber(raw, operator, condition.value, condition.value2)
  }
  if (column.resolvedType === 'date') {
    return compareDate(raw, operator, condition.value, condition.value2)
  }
  return compareText(toText(raw), operator, condition.value)
}

let conditionCounter = 0
export const createCondition = (field = '', operator = 'contains') => {
  conditionCounter += 1
  return { id: `c${conditionCounter}`, field, operator, value: '', value2: '' }
}

const EMPTY_DATE = { field: '', date: '' }
const EMPTY_RANGE = { field: '', from: '', to: '' }

export function useDataFilters(rows, columns, options = {}) {
  const { module = 'List', initialQuick = '' } = options
  const safeRows = useMemo(() => (Array.isArray(rows) ? rows : []), [rows])

  const resolvedColumns = useMemo(() => {
    return (columns || [])
      .filter((column) => column && (column.key || column.accessor))
      .map((column) => {
        const resolvedType = detectType(safeRows, column)
        let optionsList = column.options
        if (!optionsList && (resolvedType === 'select' || resolvedType === 'boolean')) {
          const set = new Set()
          safeRows.forEach((row) => {
            const text = toText(getRawValue(row, column))
            if (text !== '') set.add(text)
          })
          optionsList = Array.from(set).sort((a, b) => a.localeCompare(b))
        }
        return {
          ...column,
          id: column.key || column.label,
          label: column.label || column.key,
          resolvedType,
          options: optionsList,
        }
      })
  }, [columns, safeRows])

  const columnMap = useMemo(() => {
    const map = new Map()
    resolvedColumns.forEach((column) => map.set(column.id, column))
    return map
  }, [resolvedColumns])

  const dateColumns = useMemo(
    () => resolvedColumns.filter((column) => column.resolvedType === 'date'),
    [resolvedColumns]
  )

  const [quick, setQuick] = useState(initialQuick)
  const [conditions, setConditions] = useState([])
  const [match, setMatch] = useState('all')
  const [dateFilter, setDateFilter] = useState(EMPTY_DATE)
  const [dateRange, setDateRange] = useState(EMPTY_RANGE)

  const filteredRows = useMemo(() => {
    const terms = quick
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)

    const activeConditions = conditions.filter(
      (condition) =>
        condition.field &&
        condition.operator &&
        (!operatorNeedsValue(condition.operator) ||
          !isBlank(condition.value) ||
          (condition.operator === 'between' && !isBlank(condition.value2)))
    )

    const singleDateActive = dateFilter.field && dateFilter.date && columnMap.has(dateFilter.field)
    const rangeActive =
      dateRange.field && (dateRange.from || dateRange.to) && columnMap.has(dateRange.field)

    if (
      terms.length === 0 &&
      activeConditions.length === 0 &&
      !singleDateActive &&
      !rangeActive
    ) {
      return safeRows
    }

    return safeRows.filter((row) => {
      if (terms.length > 0) {
        const haystack = resolvedColumns
          .map((column) => toText(getRawValue(row, column)).toLowerCase())
          .join(' \u0000 ')
        if (!terms.every((term) => haystack.includes(term))) return false
      }

      if (activeConditions.length > 0) {
        const results = activeConditions.map((condition) =>
          evaluateCondition(row, condition, columnMap)
        )
        const ok = match === 'any' ? results.some(Boolean) : results.every(Boolean)
        if (!ok) return false
      }

      if (singleDateActive) {
        const column = columnMap.get(dateFilter.field)
        const iso = toIsoDateString(getRawValue(row, column))
        if (iso !== dateFilter.date) return false
      }

      if (rangeActive) {
        const column = columnMap.get(dateRange.field)
        const iso = toIsoDateString(getRawValue(row, column))
        if (!iso) return false
        if (dateRange.from && iso < dateRange.from) return false
        if (dateRange.to && iso > dateRange.to) return false
      }

      return true
    })
  }, [safeRows, quick, conditions, match, dateFilter, dateRange, resolvedColumns, columnMap])

  const activeFilterCount = useMemo(() => {
    let count = 0
    if (quick.trim()) count += 1
    count += conditions.filter(
      (condition) =>
        condition.field &&
        (!operatorNeedsValue(condition.operator) || !isBlank(condition.value))
    ).length
    if (dateFilter.field && dateFilter.date) count += 1
    if (dateRange.field && (dateRange.from || dateRange.to)) count += 1
    return count
  }, [quick, conditions, dateFilter, dateRange])

  // Log filter usage (debounced) so UI actions are traceable (owner rule 1).
  const logTimer = useRef(null)
  const firstRender = useRef(true)
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return undefined
    }
    if (logTimer.current) window.clearTimeout(logTimer.current)
    logTimer.current = window.setTimeout(() => {
      logUiAction(module, 'Apply Filters', {
        quick: quick ? quick.slice(0, 80) : undefined,
        conditions: conditions
          .filter((condition) => condition.field)
          .map((condition) => ({
            field: condition.field,
            operator: condition.operator,
            value: condition.value,
            value2: condition.value2 || undefined,
          })),
        match,
        date: dateFilter.date ? dateFilter : undefined,
        dateRange: dateRange.from || dateRange.to ? dateRange : undefined,
        matched: filteredRows.length,
        total: safeRows.length,
      })
    }, 800)
    return () => {
      if (logTimer.current) window.clearTimeout(logTimer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quick, conditions, match, dateFilter, dateRange])

  const addCondition = useCallback(() => {
    setConditions((current) => {
      const firstColumn = resolvedColumns[0]
      const defaultOperator = firstColumn
        ? operatorsForType(firstColumn.resolvedType)[0].value
        : 'contains'
      return [...current, createCondition(firstColumn ? firstColumn.id : '', defaultOperator)]
    })
  }, [resolvedColumns])

  const updateCondition = useCallback((id, patch) => {
    setConditions((current) =>
      current.map((condition) => (condition.id === id ? { ...condition, ...patch } : condition))
    )
  }, [])

  const removeCondition = useCallback((id) => {
    setConditions((current) => current.filter((condition) => condition.id !== id))
  }, [])

  const resetFilters = useCallback(() => {
    setQuick('')
    setConditions([])
    setMatch('all')
    setDateFilter(EMPTY_DATE)
    setDateRange(EMPTY_RANGE)
  }, [])

  const barProps = {
    columns: resolvedColumns,
    dateColumns,
    quick,
    setQuick,
    conditions,
    addCondition,
    updateCondition,
    removeCondition,
    match,
    setMatch,
    dateFilter,
    setDateFilter,
    dateRange,
    setDateRange,
    activeFilterCount,
    resetFilters,
    totalRows: safeRows.length,
    filteredCount: filteredRows.length,
  }

  return {
    filteredRows,
    columns: resolvedColumns,
    activeFilterCount,
    resetFilters,
    quick,
    setQuick,
    barProps,
  }
}

export default useDataFilters
