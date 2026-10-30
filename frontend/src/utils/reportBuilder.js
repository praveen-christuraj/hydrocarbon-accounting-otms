/**
 * Shared Report Builder helpers: column keys, plain-English formulas,
 * click-to-build formula composition and result cell formatting.
 */
import { formatCalendarDate, formatDateTime, formatNumber } from './format'

export const slugColumnKey = (label, existingKeys = []) => {
  let base = String(label || 'column')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^([0-9])/, 'c_$1')
  if (!base) base = 'column'
  base = base.slice(0, 48)
  const taken = new Set(existingKeys)
  let candidate = base
  let suffix = 2
  while (taken.has(candidate)) {
    candidate = `${base}_${suffix}`
    suffix += 1
  }
  return candidate
}

export const OPERATORS = [
  { symbol: '+', label: '＋ Add' },
  { symbol: '-', label: '− Subtract' },
  { symbol: '*', label: '× Multiply' },
  { symbol: '/', label: '÷ Divide' },
  { symbol: '%', label: '% Percent of' },
]

export const COMPARISONS = [
  { value: '=', label: 'is equal to' },
  { value: '<>', label: 'is not equal to' },
  { value: '>', label: 'is greater than' },
  { value: '>=', label: 'is greater than or equal to' },
  { value: '<', label: 'is less than' },
  { value: '<=', label: 'is less than or equal to' },
]

export const FILTER_OPERATORS = [
  { value: 'eq', label: 'is equal to' },
  { value: 'ne', label: 'is not equal to' },
  { value: 'gt', label: 'is greater than' },
  { value: 'gte', label: 'is greater than or equal to' },
  { value: 'lt', label: 'is less than' },
  { value: 'lte', label: 'is less than or equal to' },
  { value: 'contains', label: 'contains' },
  { value: 'not_contains', label: 'does not contain' },
  { value: 'starts_with', label: 'starts with' },
  { value: 'ends_with', label: 'ends with' },
  { value: 'in', label: 'is one of (comma separated)' },
  { value: 'not_in', label: 'is none of (comma separated)' },
  { value: 'between', label: 'is between' },
  { value: 'is_blank', label: 'is blank' },
  { value: 'is_not_blank', label: 'is not blank' },
]

export const AGGREGATES = [
  { value: 'SUM', label: 'Total (sum)' },
  { value: 'PRODUCT', label: 'Product (multiply)' },
  { value: 'AVG', label: 'Average' },
  { value: 'COUNT', label: 'Count of values' },
  { value: 'MIN', label: 'Smallest' },
  { value: 'MAX', label: 'Largest' },
  { value: 'FIRST', label: 'First value' },
  { value: 'LAST', label: 'Last value' },
]

export const BUCKETS = [
  { value: 'VALUE', label: 'Exact value' },
  { value: 'DAY', label: 'Day' },
  { value: 'WEEK', label: 'Week (starting Monday)' },
  { value: 'MONTH', label: 'Month' },
  { value: 'QUARTER', label: 'Quarter' },
  { value: 'YEAR', label: 'Year' },
]

const quoteOperand = (operand) => {
  if (!operand) return '0'
  if (operand.kind === 'column') return `[${operand.key}]`
  const raw = String(operand.value ?? '').trim()
  if (raw === '') return '0'
  if (operand.valueType === 'number' || (!Number.isNaN(Number(raw)) && operand.valueType !== 'text')) return raw
  return `"${raw.replace(/"/g, '\\"')}"`
}

/** Build `IF(left cmp right, then, else)` text from the condition builder. */
export const buildIfFormula = ({ conditions = [], joiner = 'AND', thenValue, elseValue }) => {
  const parts = conditions
    .filter((c) => c.left)
    .map((c) => `${quoteOperand(c.left)} ${c.comparison || '='} ${quoteOperand(c.right)}`)
  if (!parts.length) return ''
  const condition = parts.length === 1 ? parts[0] : `${joiner}(${parts.join(', ')})`
  return `IF(${condition}, ${quoteOperand(thenValue)}, ${quoteOperand(elseValue)})`
}

/** Build `IFS(c1, v1, c2, v2, …, default)` from ordered bands. */
export const buildIfsFormula = ({ bands = [], defaultValue }) => {
  const args = []
  bands.forEach((band) => {
    if (!band.left) return
    args.push(`${quoteOperand(band.left)} ${band.comparison || '>='} ${quoteOperand(band.right)}`)
    args.push(quoteOperand(band.result))
  })
  if (!args.length) return ''
  if (defaultValue) args.push(quoteOperand(defaultValue))
  return `IFS(${args.join(', ')})`
}

/** Render a formula in words: column headings instead of [keys]. */
export const formulaInWords = (formula, columns = []) => {
  if (!formula) return ''
  const labels = new Map((columns || []).map((c) => [c.key, c.label || c.key]))
  return String(formula)
    .replace(/\[([A-Za-z_][A-Za-z0-9_]*)\]/g, (_, key) => `“${labels.get(key) || key}”`)
    .replace(/\s%\s/g, ' as % of ')
    .replace(/\s\*\s/g, ' × ')
    .replace(/\s\/\s/g, ' ÷ ')
}

export const isNumericValue = (value) =>
  value !== null && value !== undefined && value !== '' && !Number.isNaN(Number(value)) && typeof value !== 'boolean'

/** Format one result cell for display (screen, print and client exports). */
export const formatCellValue = (value, column = {}, emptyText = '—') => {
  if (value === null || value === undefined || value === '') return emptyText
  const format = column.format || {}
  const type = format.number_format || column.data_type
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'string' && /^\d{4}(-Q[1-4]|-\d{2})?$/.test(value) && (type === 'date' || type === 'datetime')) return value
  if (type === 'date') return formatCalendarDate(value, String(value))
  if (type === 'datetime') return formatDateTime(value, String(value))
  if (type === 'number' || (isNumericValue(value) && type !== 'text')) {
    const decimals = Number.isInteger(format.decimals) ? format.decimals : 3
    const text = formatNumber(value, decimals)
    return `${format.prefix || ''}${text}${format.suffix || ''}`
  }
  return String(value)
}

export const emptyDefinition = () => ({
  schema_version: 1,
  report_type: 'TABULAR',
  source: { kind: 'operation_tickets', operation_type_codes: [], template_ids: [], statuses: ['Approved'] },
  date_basis: 'ACCOUNTING_DATE',
  date_column: '',
  columns: [],
  filters: [],
  filter_logic: 'AND',
  runtime_filters: [{ key: 'location', label: 'Location', type: 'location' }],
  group_by: [],
  matrix: { row_keys: [], column_key: '', column_bucket: 'VALUE', value_key: '', aggregate: 'SUM', show_row_totals: true, show_column_totals: true },
  sort: [],
  options: { show_totals: true, page_size: 50, empty_text: '—' },
})

export const sourceKindLabel = (kind, table) => {
  if (kind === 'operation_tickets') return 'Operation Tickets'
  if (kind === 'tank_stock_ledger') return 'Tank Stock Ledger'
  return table ? `Table: ${table}` : 'Table'
}

export const dateRangeDefaults = () => {
  const now = new Date()
  const from = new Date(now.getFullYear(), now.getMonth(), 1)
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return { dateFrom: iso(from), dateTo: iso(now) }
}

/** Human summary of a column's origin, for the designer column list. */
export const columnOriginLabel = (column) => {
  if (!column) return ''
  if ((column.kind || 'data') === 'calculated') return 'Calculated'
  const source = column.source || {}
  if (source.type === 'column') return source.column
  if (source.type === 'virtual') return 'System field'
  if (source.type === 'ticket_field') return `Ticket answer · ${source.field_code}`
  if (source.type === 'payload_path') return `${source.field_code || source.json_column} › ${source.path}`
  if (source.type === 'json_path') return `${source.json_column} › ${source.path}`
  return ''
}
