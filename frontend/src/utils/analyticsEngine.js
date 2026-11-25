/**
 * Analytics Engine Registry, Canonical GridStack Layout Normalizer,
 * Starter Templates, and Perspective-Style Pivot/Aggregation Engine.
 */

export const VISUAL_GROUPS = [
  { id: 'kpi', label: 'KPI & Terminal' },
  { id: 'perspective', label: 'Perspective Grid & Pivot' },
  { id: 'echarts', label: 'Apache ECharts BI' },
  { id: 'plotly', label: 'Plotly Statistical' },
  { id: 'notes', label: 'Notes & Callouts' },
]

export const VISUAL_CATALOG = [
  // KPI & Terminal
  {
    type: 'KPI_CARD', label: 'KPI Metric Card', shortLabel: 'KPI', group: 'kpi', engine: 'kpi',
    icon: 'activity', defaultW: 3, defaultH: 4, minW: 3, minH: 3,
    description: 'Headline metric with comparison delta, sparkline trend and target progress.',
  },
  {
    type: 'GAUGE', label: 'Capacity / Target Gauge', shortLabel: 'Gauge', group: 'kpi', engine: 'echarts',
    icon: 'gauge', defaultW: 3, defaultH: 4, minW: 3, minH: 3,
    description: 'Industrial 200-degree ECharts gauge with warning and critical zones.',
  },
  {
    type: 'INDICATOR_BULLET', label: 'Bullet Target Indicator', shortLabel: 'Bullet', group: 'kpi', engine: 'plotly',
    icon: 'sliders', defaultW: 4, defaultH: 4, minW: 3, minH: 3,
    description: 'Plotly horizontal bullet indicator comparing actual vs target and delta.',
  },
  {
    type: 'TANK_VISUAL', label: 'Shore Tank Farm Levels', shortLabel: 'Tank Levels', group: 'kpi', engine: 'tank',
    icon: 'droplet', defaultW: 6, defaultH: 6, minW: 4, minH: 5,
    description: 'Live cylindrical tank fill levels, NSV/GSV stock, calibration capacity & ullage.',
  },

  // Perspective Grid & Pivot
  {
    type: 'PIVOT_GRID', label: 'Perspective Pivot & DataGrid', shortLabel: 'Pivot Grid', group: 'perspective', engine: 'perspective',
    icon: 'grid', defaultW: 12, defaultH: 7, minW: 6, minH: 5,
    description: 'Interactive Group-By tree, Split-By cross-tab, inline Data Bars, Heatmaps & summary bar.',
  },
  {
    type: 'TABLE', label: 'Interactive Data Table', shortLabel: 'Data Table', group: 'perspective', engine: 'perspective',
    icon: 'table', defaultW: 12, defaultH: 7, minW: 6, minH: 5,
    description: 'Sortable, searchable tabular grid with conditional formatting, sticky headers & totals.',
  },
  {
    type: 'MATRIX', label: 'Cross-Tab Matrix', shortLabel: 'Matrix', group: 'perspective', engine: 'perspective',
    icon: 'columns', defaultW: 12, defaultH: 7, minW: 6, minH: 5,
    description: 'Row × Column cross-tabulation pivot matrix with row and column totals.',
  },

  // Apache ECharts BI Suite
  {
    type: 'COLUMN', label: 'Vertical Column Chart', shortLabel: 'Column', group: 'echarts', engine: 'echarts',
    icon: 'barChart', defaultW: 6, defaultH: 6, minW: 4, minH: 5,
    description: 'Clustered, stacked or 100% stacked vertical columns with zoom and brush.',
  },
  {
    type: 'BAR', label: 'Horizontal Bar Chart', shortLabel: 'Horiz. Bar', group: 'echarts', engine: 'echarts',
    icon: 'list', defaultW: 6, defaultH: 6, minW: 4, minH: 5,
    description: 'Ranked horizontal bars ideal for comparing locations, tanks and operations.',
  },
  {
    type: 'LINE', label: 'Time-Series Line Chart', shortLabel: 'Line', group: 'echarts', engine: 'echarts',
    icon: 'trendingUp', defaultW: 6, defaultH: 6, minW: 4, minH: 5,
    description: 'Multi-series trend lines with crosshair, smooth curve option and dataZoom.',
  },
  {
    type: 'AREA', label: 'Stacked Area Trend', shortLabel: 'Area', group: 'echarts', engine: 'echarts',
    icon: 'layers', defaultW: 6, defaultH: 6, minW: 4, minH: 5,
    description: 'Filled cumulative or multi-series volume trend over time.',
  },
  {
    type: 'COMBO', label: 'Dual-Axis Combo (Bar + Line)', shortLabel: 'Combo', group: 'echarts', engine: 'echarts',
    icon: 'activity', defaultW: 6, defaultH: 6, minW: 4, minH: 5,
    description: 'Primary bars on left Y-axis paired with secondary line on right Y-axis.',
  },
  {
    type: 'WATERFALL', label: 'Material Balance Waterfall', shortLabel: 'Waterfall', group: 'echarts', engine: 'echarts',
    icon: 'workflow', defaultW: 6, defaultH: 6, minW: 4, minH: 5,
    description: 'Step-by-step positive/negative volume bridge with running cumulative balance.',
  },
  {
    type: 'PIE', label: 'Pie Composition', shortLabel: 'Pie', group: 'echarts', engine: 'echarts',
    icon: 'compass', defaultW: 4, defaultH: 6, minW: 4, minH: 5,
    description: 'Proportional share breakdown with percentage callouts.',
  },
  {
    type: 'DONUT', label: 'Donut Ring Chart', shortLabel: 'Donut', group: 'echarts', engine: 'echarts',
    icon: 'compass', defaultW: 4, defaultH: 6, minW: 4, minH: 5,
    description: 'Donut breakdown displaying grand total metric inside the center ring.',
  },
  {
    type: 'TREEMAP', label: 'Hierarchical Treemap', shortLabel: 'Treemap', group: 'echarts', engine: 'echarts',
    icon: 'grid', defaultW: 6, defaultH: 6, minW: 4, minH: 5,
    description: 'Nested proportional rectangles with breadcrumb drill-down.',
  },
  {
    type: 'SUNBURST', label: 'Multi-Ring Sunburst', shortLabel: 'Sunburst', group: 'echarts', engine: 'echarts',
    icon: 'compass', defaultW: 5, defaultH: 6, minW: 4, minH: 5,
    description: 'Radial multi-level hierarchy breakdown (e.g. Location → Product → Tank).',
  },
  {
    type: 'SANKEY', label: 'Movement Sankey Flow', shortLabel: 'Sankey', group: 'echarts', engine: 'echarts',
    icon: 'repeat', defaultW: 6, defaultH: 6, minW: 5, minH: 5,
    description: 'Directed flow diagram showing volume transfers from source to destination.',
  },
  {
    type: 'HEATMAP', label: '2D Intensity Heatmap', shortLabel: 'Heatmap', group: 'echarts', engine: 'echarts',
    icon: 'grid', defaultW: 6, defaultH: 6, minW: 4, minH: 5,
    description: 'Matrix color intensity map across two categorical/date dimensions.',
  },
  {
    type: 'FUNNEL', label: 'Workflow Stage Funnel', shortLabel: 'Funnel', group: 'echarts', engine: 'echarts',
    icon: 'filter', defaultW: 5, defaultH: 6, minW: 4, minH: 5,
    description: 'Ordered conversion or ticket lifecycle funnel across stages.',
  },
  {
    type: 'RADAR', label: 'Multi-Metric Radar', shortLabel: 'Radar', group: 'echarts', engine: 'echarts',
    icon: 'compass', defaultW: 5, defaultH: 6, minW: 4, minH: 5,
    description: 'Spider profile comparing multiple metrics across categories.',
  },

  // Plotly Statistical & Scientific Suite
  {
    type: 'BOX_PLOT', label: 'Statistical Box & Outlier Plot', shortLabel: 'Box Plot', group: 'plotly', engine: 'plotly',
    icon: 'sliders', defaultW: 6, defaultH: 6, minW: 4, minH: 5,
    description: 'Plotly quartiles, median, whiskers, mean diamond and outlier points by group.',
  },
  {
    type: 'VIOLIN_PLOT', label: 'Density Violin Distribution', shortLabel: 'Violin', group: 'plotly', engine: 'plotly',
    icon: 'activity', defaultW: 6, defaultH: 6, minW: 4, minH: 5,
    description: 'Plotly kernel density curve with embedded IQR box and sample points.',
  },
  {
    type: 'SCATTER', label: 'Scatter / Bubble + OLS Trend', shortLabel: 'Scatter', group: 'plotly', engine: 'plotly',
    icon: 'trendingUp', defaultW: 6, defaultH: 6, minW: 4, minH: 5,
    description: 'Plotly X-Y correlation plot with optional bubble size and linear regression R².',
  },
  {
    type: 'HISTOGRAM', label: 'Frequency Histogram', shortLabel: 'Histogram', group: 'plotly', engine: 'plotly',
    icon: 'barChart', defaultW: 6, defaultH: 6, minW: 4, minH: 5,
    description: 'Plotly binned distribution histogram with mean and median markers.',
  },
  {
    type: 'PLOTLY_WATERFALL', label: 'Accounting Variance Bridge', shortLabel: 'Variance Bridge', group: 'plotly', engine: 'plotly',
    icon: 'calculator', defaultW: 6, defaultH: 6, minW: 4, minH: 5,
    description: 'Plotly waterfall with connector lines, relative deltas and closing total bar.',
  },
  {
    type: 'CONTOUR_2D', label: '2D Density Contour', shortLabel: '2D Contour', group: 'plotly', engine: 'plotly',
    icon: 'layers', defaultW: 6, defaultH: 6, minW: 4, minH: 5,
    description: 'Plotly 2D density contour heatmap across two variables.',
  },
  {
    type: 'SURFACE_3D', label: '3D Surface / Calibration', shortLabel: '3D Surface', group: 'plotly', engine: 'plotly',
    icon: 'globe', defaultW: 6, defaultH: 7, minW: 5, minH: 5,
    description: 'Interactive rotatable 3D Plotly surface across X, Y and Z axes.',
  },

  // Text / Markdown Card
  {
    type: 'TEXT', label: 'Executive Note / Callout', shortLabel: 'Note', group: 'notes', engine: 'text',
    icon: 'fileText', defaultW: 4, defaultH: 3, minW: 3, minH: 2,
    description: 'Structured narrative notes, reconciliation commentary or SOP instructions.',
  },
]

export const VISUAL_BY_TYPE = new Map(VISUAL_CATALOG.map((item) => [item.type, item]))

export const ECHARTS_VISUAL_TYPES = new Set(
  VISUAL_CATALOG.filter((v) => v.engine === 'echarts').map((v) => v.type)
)
export const PLOTLY_VISUAL_TYPES = new Set(
  VISUAL_CATALOG.filter((v) => v.engine === 'plotly').map((v) => v.type)
)
export const PERSPECTIVE_VISUAL_TYPES = new Set(['PIVOT_GRID', 'TABLE', 'MATRIX'])

export const RUNTIME_SWITCHABLE_TYPES = [
  { type: 'PIVOT_GRID', label: 'Pivot / DataGrid' },
  { type: 'COLUMN', label: 'Vertical Column' },
  { type: 'BAR', label: 'Horizontal Bar' },
  { type: 'LINE', label: 'Line Trend' },
  { type: 'AREA', label: 'Area Trend' },
  { type: 'COMBO', label: 'Dual-Axis Combo' },
  { type: 'WATERFALL', label: 'Waterfall Bridge' },
  { type: 'DONUT', label: 'Donut Ring' },
  { type: 'TREEMAP', label: 'Treemap' },
  { type: 'BOX_PLOT', label: 'Plotly Box Plot' },
  { type: 'VIOLIN_PLOT', label: 'Plotly Violin' },
  { type: 'SCATTER', label: 'Plotly Scatter' },
  { type: 'HISTOGRAM', label: 'Plotly Histogram' },
]

export const AGGREGATE_OPTIONS = [
  { value: 'SUM', label: 'Sum' },
  { value: 'AVG', label: 'Average' },
  { value: 'COUNT', label: 'Count' },
  { value: 'DISTINCT_COUNT', label: 'Distinct Count' },
  { value: 'MIN', label: 'Minimum' },
  { value: 'MAX', label: 'Maximum' },
  { value: 'MEDIAN', label: 'Median' },
  { value: 'STDDEV', label: 'Std Dev' },
  { value: 'PCT_TOTAL', label: '% of Total' },
  { value: 'FIRST', label: 'First' },
  { value: 'LAST', label: 'Last' },
]

export const REPORT_ENGINE_AGGREGATES = new Set([
  'SUM', 'AVG', 'COUNT', 'MIN', 'MAX', 'PRODUCT', 'FIRST', 'LAST',
])

export const BUCKET_OPTIONS = [
  { value: 'VALUE', label: 'Exact Value' },
  { value: 'DAY', label: 'Day' },
  { value: 'WEEK', label: 'Week' },
  { value: 'MONTH', label: 'Month' },
  { value: 'QUARTER', label: 'Quarter' },
  { value: 'YEAR', label: 'Year' },
]

export const NAVY_CHART_PALETTE = [
  '#12315f', '#2f63b3', '#1f7a4d', '#0e7490', '#b36b00', '#6d28d9', '#b42318', '#475569',
]

export const DARK_CHART_PALETTE = [
  '#5b8def', '#38bdf8', '#3fbf7f', '#f59e0b', '#a78bfa', '#f87171', '#2dd4bf', '#94a3b8',
]

export function makeSafeKey(value) {
  const key = String(value || 'column')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 44) || 'column'
  return /^[a-z]/.test(key) ? key : `field_${key}`
}

export function getVisualMeta(type) {
  return VISUAL_BY_TYPE.get(String(type || 'TABLE').toUpperCase()) || VISUAL_BY_TYPE.get('TABLE')
}

export function defaultLayoutForVisualType(type) {
  const meta = getVisualMeta(type)
  return {
    w: meta.defaultW,
    h: meta.defaultH,
    minW: meta.minW,
    minH: meta.minH,
  }
}

/**
 * Canonical 12-column GridStack layout normalizer.
 * Never allows narrow responsive measurements to corrupt desktop widths.
 */
export function normalizeLayoutForGridStack(rawLayout, visuals = []) {
  const sourceItems = Array.isArray(rawLayout)
    ? rawLayout
    : (Array.isArray(rawLayout?.lg) ? rawLayout.lg : [])

  const byId = new Map()
  for (const item of sourceItems) {
    const id = String(item?.i || item?.id || '')
    if (id && !byId.has(id)) byId.set(id, item)
  }

  const normalized = []
  let cursorX = 0
  let cursorY = 0

  for (const existing of sourceItems) {
    const id = String(existing?.i || existing?.id || '')
    const visual = visuals.find((v) => String(v.id) === id)
    if (!visual) continue
    const defaults = defaultLayoutForVisualType(visual.type)
    const minW = Math.min(12, Math.max(defaults.minW, Number(existing.minW) || defaults.minW))
    const minH = Math.max(defaults.minH, Number(existing.minH) || defaults.minH)
    const w = Math.min(12, Math.max(minW, Number(existing.w) || defaults.w))
    const h = Math.max(minH, Number(existing.h) || defaults.h)
    const x = Math.max(0, Math.min(12 - w, Number.isFinite(Number(existing.x)) ? Number(existing.x) : 0))
    const y = Number.isFinite(Number(existing.y)) && Number(existing.y) < 1500 ? Math.max(0, Number(existing.y)) : cursorY
    cursorY = Math.max(cursorY, y + h)
    normalized.push({
      i: id,
      id,
      x,
      y,
      w,
      h,
      minW,
      minH,
      locked: Boolean(existing.locked),
      noMove: Boolean(existing.noMove),
      noResize: Boolean(existing.noResize),
    })
  }

  const placed = new Set(normalized.map((item) => item.i))
  for (const visual of visuals) {
    const id = String(visual.id)
    if (placed.has(id)) continue
    const defaults = defaultLayoutForVisualType(visual.type)
    if (cursorX + defaults.w > 12) {
      cursorX = 0
      cursorY += defaults.h
    }
    normalized.push({
      i: id,
      id,
      x: cursorX,
      y: cursorY,
      w: defaults.w,
      h: defaults.h,
      minW: defaults.minW,
      minH: defaults.minH,
      locked: false,
      noMove: false,
      noResize: false,
    })
    cursorX += defaults.w
    if (cursorX >= 12) {
      cursorX = 0
      cursorY += defaults.h
    }
  }

  return normalized
}

export function formatMetricValue(value, column, style = {}) {
  if (value === null || value === undefined || value === '') return '—'
  const isNumCol = column?.data_type === 'number' || typeof value === 'number'
  if (isNumCol) {
    const num = Number(value)
    if (!Number.isFinite(num)) return String(value)
    const decimals = style?.decimals != null
      ? Number(style.decimals)
      : (column?.format?.decimals != null ? Number(column.format.decimals) : (Number.isInteger(num) ? 0 : 2))
    const prefix = style?.prefix ?? column?.format?.prefix ?? ''
    const suffix = style?.suffix ?? column?.format?.suffix ?? ''
    if (style?.compact && Math.abs(num) >= 1000) {
      const compactStr = new Intl.NumberFormat(undefined, {
        notation: 'compact',
        maximumFractionDigits: Math.max(1, Math.min(2, decimals)),
      }).format(num)
      return `${prefix}${compactStr}${suffix}`
    }
    const formatted = num.toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: Math.max(0, Math.min(6, decimals)),
    })
    return `${prefix}${formatted}${suffix}`
  }
  return String(value)
}

export function computeDatePreset(presetKey) {
  const now = new Date()
  const toIso = (d) => d.toISOString().slice(0, 10)
  const end = toIso(now)
  if (presetKey === '7D') {
    const d = new Date(now)
    d.setDate(d.getDate() - 6)
    return { from: toIso(d), to: end }
  }
  if (presetKey === '30D') {
    const d = new Date(now)
    d.setDate(d.getDate() - 29)
    return { from: toIso(d), to: end }
  }
  if (presetKey === 'MTD') {
    return { from: toIso(new Date(now.getFullYear(), now.getMonth(), 1)), to: end }
  }
  if (presetKey === 'QTD') {
    const qStartMonth = Math.floor(now.getMonth() / 3) * 3
    return { from: toIso(new Date(now.getFullYear(), qStartMonth, 1)), to: end }
  }
  if (presetKey === 'YTD') {
    return { from: toIso(new Date(now.getFullYear(), 0, 1)), to: end }
  }
  if (presetKey === 'PREV_MONTH') {
    const firstPrev = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const lastPrev = new Date(now.getFullYear(), now.getMonth(), 0)
    return { from: toIso(firstPrev), to: toIso(lastPrev) }
  }
  return { from: '', to: '' }
}

/* ==========================================================================
   Perspective-Style Client Pivot, Aggregation, Filter & Formatting Engine
   ========================================================================== */

function toFiniteNumber(val) {
  if (val === null || val === undefined || val === '') return null
  const n = Number(val)
  return Number.isFinite(n) ? n : null
}

function aggregateValues(values, aggType = 'SUM', grandTotalForPct = null) {
  const mode = String(aggType || 'SUM').toUpperCase()
  const nonNull = values.filter((v) => v !== null && v !== undefined && v !== '')
  if (mode === 'COUNT') return nonNull.length
  if (mode === 'DISTINCT_COUNT') return new Set(nonNull.map((v) => String(v))).size
  if (mode === 'FIRST') return nonNull.length ? nonNull[0] : null
  if (mode === 'LAST') return nonNull.length ? nonNull[nonNull.length - 1] : null

  const nums = nonNull.map(toFiniteNumber).filter((v) => v !== null)
  if (!nums.length) return 0
  const total = nums.reduce((acc, n) => acc + n, 0)
  if (mode === 'SUM') return total
  if (mode === 'PCT_TOTAL') {
    if (!grandTotalForPct || Math.abs(grandTotalForPct) < 1e-12) return 0
    return (total / grandTotalForPct) * 100
  }
  if (mode === 'AVG') return total / nums.length
  if (mode === 'MIN') return Math.min(...nums)
  if (mode === 'MAX') return Math.max(...nums)
  if (mode === 'MEDIAN') {
    const sorted = [...nums].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
  }
  if (mode === 'VARIANCE' || mode === 'STDDEV') {
    if (nums.length < 2) return 0
    const mean = total / nums.length
    const variance = nums.reduce((acc, n) => acc + (n - mean) ** 2, 0) / (nums.length - 1)
    return mode === 'VARIANCE' ? variance : Math.sqrt(variance)
  }
  return total
}

export function matchesFilterRule(rowValue, operator = 'eq', target, target2) {
  const op = String(operator || 'eq').toLowerCase()
  const isBlank = rowValue === null || rowValue === undefined || String(rowValue).trim() === ''
  if (op === 'is_blank') return isBlank
  if (op === 'is_not_blank') return !isBlank
  if (isBlank) return false

  const numRow = toFiniteNumber(rowValue)
  const numTarget = toFiniteNumber(target)

  if (op === 'in' || op === 'not_in') {
    const list = Array.isArray(target)
      ? target.map((x) => String(x).trim().toLowerCase())
      : String(target || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean)
    const hit = list.includes(String(rowValue).trim().toLowerCase())
    return op === 'in' ? hit : !hit
  }
  if (op === 'contains') return String(rowValue).toLowerCase().includes(String(target ?? '').toLowerCase())
  if (op === 'not_contains') return !String(rowValue).toLowerCase().includes(String(target ?? '').toLowerCase())
  if (op === 'starts_with') return String(rowValue).toLowerCase().startsWith(String(target ?? '').toLowerCase())
  if (op === 'ends_with') return String(rowValue).toLowerCase().endsWith(String(target ?? '').toLowerCase())

  if (numRow !== null && numTarget !== null) {
    if (op === 'eq') return numRow === numTarget
    if (op === 'ne') return numRow !== numTarget
    if (op === 'gt') return numRow > numTarget
    if (op === 'gte') return numRow >= numTarget
    if (op === 'lt') return numRow < numTarget
    if (op === 'lte') return numRow <= numTarget
    if (op === 'between') {
      const numTarget2 = toFiniteNumber(target2)
      return numTarget2 !== null ? numRow >= Math.min(numTarget, numTarget2) && numRow <= Math.max(numTarget, numTarget2) : numRow >= numTarget
    }
  }

  const sRow = String(rowValue).trim().toLowerCase()
  const sTarget = String(target ?? '').trim().toLowerCase()
  if (op === 'eq') return sRow === sTarget
  if (op === 'ne') return sRow !== sTarget
  if (op === 'gt') return sRow > sTarget
  if (op === 'gte') return sRow >= sTarget
  if (op === 'lt') return sRow < sTarget
  if (op === 'lte') return sRow <= sTarget
  if (op === 'between') {
    const sTarget2 = String(target2 ?? '').trim().toLowerCase()
    return sTarget2 ? sRow >= sTarget && sRow <= sTarget2 : sRow >= sTarget
  }
  return true
}

export function evaluateConditionalRules(value, columnKey, rules = []) {
  if (!Array.isArray(rules) || !rules.length) return null
  for (const rule of rules) {
    if (rule.columnKey && rule.columnKey !== columnKey) continue
    if (matchesFilterRule(value, rule.operator, rule.value, rule.value2)) {
      if (rule.tone === 'success') return { color: 'var(--success-text)', backgroundColor: 'var(--success-soft)', fontWeight: 600 }
      if (rule.tone === 'warning') return { color: 'var(--warning-text)', backgroundColor: 'var(--warning-soft)', fontWeight: 600 }
      if (rule.tone === 'danger') return { color: 'var(--danger-text)', backgroundColor: 'var(--danger-soft)', fontWeight: 600 }
      if (rule.tone === 'info') return { color: 'var(--info-text)', backgroundColor: 'var(--info-soft)', fontWeight: 600 }
      return {
        ...(rule.textColor ? { color: rule.textColor, fontWeight: 600 } : {}),
        ...(rule.bgColor ? { backgroundColor: rule.bgColor } : {}),
      }
    }
  }
  return null
}

function sortRowsBySpecs(rows, sortSpecs = []) {
  if (!Array.isArray(sortSpecs) || !sortSpecs.length) return rows
  const copy = [...rows]
  copy.sort((a, b) => {
    for (const spec of sortSpecs) {
      const key = spec.key
      const dir = String(spec.direction || 'DESC').toUpperCase()
      const va = a?.[key]
      const vb = b?.[key]
      const na = toFiniteNumber(va)
      const nb = toFiniteNumber(vb)
      let cmp
      if (dir === 'ABS_DESC' && na !== null && nb !== null) {
        cmp = Math.abs(nb) - Math.abs(na)
      } else if (na !== null && nb !== null) {
        cmp = na - nb
      } else {
        cmp = String(va ?? '').localeCompare(String(vb ?? ''), undefined, { numeric: true, sensitivity: 'base' })
      }
      if (cmp !== 0) {
        if (dir === 'ABS_DESC') return cmp
        return dir === 'ASC' ? cmp : -cmp
      }
    }
    return 0
  })
  return copy
}

function computeColumnStats(rows, columns) {
  const stats = {}
  for (const col of columns) {
    if (col.data_type !== 'number') continue
    let min = Infinity
    let max = -Infinity
    let sum = 0
    let count = 0
    for (const row of rows) {
      if (row?.__isGroup && row.__depth >= 0) continue
      const n = toFiniteNumber(row?.[col.key])
      if (n === null) continue
      if (n < min) min = n
      if (n > max) max = n
      sum += n
      count += 1
    }
    if (count > 0) {
      stats[col.key] = {
        min,
        max,
        maxAbs: Math.max(Math.abs(min), Math.abs(max), 1e-9),
        sum,
        avg: sum / count,
        count,
      }
    }
  }
  return stats
}

/**
 * Perspective-inspired view computation:
 * Supports hierarchical Group By (expandable tree), Split By (cross-tab columns),
 * 10+ aggregations, Where filter rules, quick search, multi-sort, and summary metrics.
 */
export function computePerspectiveView({
  rows = [],
  columns = [],
  totals = {},
  explorer = {},
  searchQuery = '',
}) {
  const colByKey = new Map(columns.map((c) => [c.key, c]))
  const whereRules = Array.isArray(explorer?.whereRules) ? explorer.whereRules : []
  const groupByKeys = (Array.isArray(explorer?.groupByKeys) ? explorer.groupByKeys : []).filter((k) => colByKey.has(k))
  const splitByKeys = (Array.isArray(explorer?.splitByKeys) ? explorer.splitByKeys : []).filter((k) => colByKey.has(k) && !groupByKeys.includes(k))
  const sortSpecs = Array.isArray(explorer?.sortSpecs) ? explorer.sortSpecs : []
  const q = String(searchQuery || '').trim().toLowerCase()

  // 1. Filter base rows
  const filteredBaseRows = rows.filter((row) => {
    for (const rule of whereRules) {
      if (!rule?.key) continue
      if (!matchesFilterRule(row?.[rule.key], rule.operator, rule.value, rule.value2)) return false
    }
    if (q) {
      const hit = columns.some((c) => {
        const v = row?.[c.key]
        return v !== null && v !== undefined && String(v).toLowerCase().includes(q)
      })
      if (!hit) return false
    }
    return true
  })

  // 2. Flat mode (no client-side Group By or Split By)
  if (!groupByKeys.length && !splitByKeys.length) {
    const sortedRows = sortRowsBySpecs(filteredBaseRows, sortSpecs)
    const columnStats = computeColumnStats(sortedRows, columns)
    const computedTotals = { ...totals }
    for (const col of columns) {
      if (col.data_type === 'number' && computedTotals[col.key] === undefined && columnStats[col.key]) {
        computedTotals[col.key] = columnStats[col.key].sum
      }
    }
    return {
      isPivoted: false,
      columns,
      rows: sortedRows,
      flatLeafCount: filteredBaseRows.length,
      groupCount: 0,
      totals: computedTotals,
      columnStats,
    }
  }

  // 3. Determine active measures for Pivot / Split-By
  const rawMeasureSpecs = Array.isArray(explorer?.measureSpecs) && explorer.measureSpecs.length
    ? explorer.measureSpecs.filter((m) => colByKey.has(m.key))
    : columns
      .filter((c) => !groupByKeys.includes(c.key) && !splitByKeys.includes(c.key) && c.data_type === 'number')
      .map((c) => ({ key: c.key, aggregate: c.aggregate || 'SUM', label: c.label || c.key }))

  const measureSpecs = rawMeasureSpecs.length
    ? rawMeasureSpecs
    : [{
      key: columns[0]?.key || '_count',
      aggregate: 'COUNT',
      label: 'Row Count',
    }]

  // Distinct split combinations (cap at 24 to keep UI fast and legible)
  const splitCombos = []
  const seenSplits = new Set()
  if (splitByKeys.length) {
    for (const row of filteredBaseRows) {
      const parts = splitByKeys.map((k) => String(row?.[k] ?? '—'))
      const splitId = parts.join(' / ')
      if (!seenSplits.has(splitId) && splitCombos.length < 24) {
        seenSplits.add(splitId)
        splitCombos.push({ id: splitId, label: splitId })
      }
    }
  }

  // Precompute grand totals for PCT_TOTAL
  const grandSums = {}
  for (const ms of measureSpecs) {
    grandSums[ms.key] = aggregateValues(filteredBaseRows.map((r) => r?.[ms.key]), 'SUM')
  }

  // Build output columns
  const hierarchyCol = {
    key: '__hierarchy',
    label: groupByKeys.length
      ? groupByKeys.map((k) => colByKey.get(k)?.label || k).join(' › ')
      : 'All Records',
    data_type: 'text',
    isHierarchy: true,
  }

  const valueColumns = []
  if (splitCombos.length) {
    for (const split of splitCombos) {
      for (const ms of measureSpecs) {
        const baseCol = colByKey.get(ms.key)
        const measureLabel = ms.label || baseCol?.label || ms.key
        valueColumns.push({
          key: `${split.id}::${ms.key}::${ms.aggregate}`,
          label: measureSpecs.length > 1 ? `${split.label} · ${measureLabel}` : split.label,
          splitGroup: split.label,
          measureKey: ms.key,
          aggregate: ms.aggregate,
          data_type: 'number',
          format: {
            ...(baseCol?.format || {}),
            decimals: ms.aggregate === 'COUNT' || ms.aggregate === 'DISTINCT_COUNT' ? 0 : (ms.aggregate === 'PCT_TOTAL' ? 1 : (baseCol?.format?.decimals ?? 2)),
            suffix: ms.aggregate === 'PCT_TOTAL' ? '%' : (baseCol?.format?.suffix || ''),
          },
        })
      }
    }
  }
  for (const ms of measureSpecs) {
    const baseCol = colByKey.get(ms.key)
    const aggLabel = ms.aggregate === 'SUM' ? '' : ` (${ms.aggregate})`
    valueColumns.push({
      key: `total::${ms.key}::${ms.aggregate}`,
      label: splitCombos.length
        ? `Total · ${ms.label || baseCol?.label || ms.key}`
        : `${ms.label || baseCol?.label || ms.key}${aggLabel}`,
      measureKey: ms.key,
      aggregate: ms.aggregate,
      isRowTotal: splitCombos.length > 0,
      data_type: 'number',
      format: {
        ...(baseCol?.format || {}),
        decimals: ms.aggregate === 'COUNT' || ms.aggregate === 'DISTINCT_COUNT' ? 0 : (ms.aggregate === 'PCT_TOTAL' ? 1 : (baseCol?.format?.decimals ?? 2)),
        suffix: ms.aggregate === 'PCT_TOTAL' ? '%' : (baseCol?.format?.suffix || ''),
      },
    })
  }

  const computeBucketMetrics = (bucketRows) => {
    const out = {}
    if (splitCombos.length) {
      const bySplit = new Map()
      for (const r of bucketRows) {
        const sid = splitByKeys.map((k) => String(r?.[k] ?? '—')).join(' / ')
        if (!bySplit.has(sid)) bySplit.set(sid, [])
        bySplit.get(sid).push(r)
      }
      for (const split of splitCombos) {
        const subRows = bySplit.get(split.id) || []
        for (const ms of measureSpecs) {
          out[`${split.id}::${ms.key}::${ms.aggregate}`] = subRows.length
            ? aggregateValues(subRows.map((r) => r?.[ms.key]), ms.aggregate, grandSums[ms.key])
            : 0
        }
      }
    }
    for (const ms of measureSpecs) {
      out[`total::${ms.key}::${ms.aggregate}`] = aggregateValues(
        bucketRows.map((r) => r?.[ms.key]),
        ms.aggregate,
        grandSums[ms.key]
      )
    }
    return out
  }

  // Build hierarchical tree recursively
  const treeRows = []
  let topGroupCount = 0

  function buildLevel(subsetRows, depth, parentKey) {
    if (depth >= groupByKeys.length) return
    const gKey = groupByKeys[depth]
    const groups = new Map()
    for (const r of subsetRows) {
      const gVal = String(r?.[gKey] ?? '—')
      if (!groups.has(gVal)) groups.set(gVal, [])
      groups.get(gVal).push(r)
    }

    let entries = [...groups.entries()].map(([gVal, gRows]) => {
      const treeKey = parentKey ? `${parentKey}||${gKey}=${gVal}` : `${gKey}=${gVal}`
      const metrics = computeBucketMetrics(gRows)
      return {
        __treeKey: treeKey,
        __parentKey: parentKey || null,
        __depth: depth,
        __isGroup: depth < groupByKeys.length - 1,
        __hasChildren: depth < groupByKeys.length - 1,
        __groupColumnKey: gKey,
        __groupValue: gVal,
        __childCount: gRows.length,
        __hierarchy: gVal,
        [gKey]: gVal,
        ...metrics,
        __subsetRows: gRows,
      }
    })

    entries = sortRowsBySpecs(entries, sortSpecs)
    if (depth === 0) topGroupCount = entries.length

    for (const node of entries) {
      const { __subsetRows, ...cleanNode } = node
      treeRows.push(cleanNode)
      if (depth < groupByKeys.length - 1) {
        buildLevel(__subsetRows, depth + 1, node.__treeKey)
      }
    }
  }

  if (groupByKeys.length) {
    buildLevel(filteredBaseRows, 0, '')
  } else {
    treeRows.push({
      __treeKey: 'all',
      __parentKey: null,
      __depth: 0,
      __isGroup: false,
      __hasChildren: false,
      __childCount: filteredBaseRows.length,
      __hierarchy: 'Total',
      ...computeBucketMetrics(filteredBaseRows),
    })
    topGroupCount = 1
  }

  const pivotColumns = [hierarchyCol, ...valueColumns]
  const grandTotals = {
    __hierarchy: 'Grand Total',
    ...computeBucketMetrics(filteredBaseRows),
  }

  const leafOnly = treeRows.filter((r) => !r.__hasChildren)
  const columnStats = computeColumnStats(leafOnly.length ? leafOnly : treeRows, pivotColumns)

  return {
    isPivoted: true,
    columns: pivotColumns,
    rows: treeRows,
    flatLeafCount: filteredBaseRows.length,
    groupCount: topGroupCount,
    totals: grandTotals,
    columnStats,
  }
}

/* ==========================================================================
   One-Click Hydrocarbon Starter Templates for Analytics Studio
   ========================================================================== */

export function buildStarterTemplates() {
  return [
    {
      id: 'terminal_executive',
      name: 'Terminal Stock & Movement Executive Overview',
      description: 'KPI cards, Shore Tank capacity gauge & live levels, ECharts movement column/waterfall, and Perspective tank pivot grid.',
      buildDefinition: () => ({
        schema_version: 2,
        canvas: { floatMode: false, cellHeight: 64, margin: 14 },
        slicers: [
          {
            id: 'slicer_product',
            key: 's_product_name',
            label: 'Product',
            type: 'SELECT',
            column_key: 'product_name',
            field: 'product_name',
            visual_ids: ['v_kpi_stock', 'v_kpi_in', 'v_col_tank', 'v_box_mov', 'v_pivot_ledger'],
            config: { multi: true, allowAll: true },
          },
        ],
        visuals: [
          {
            id: 'v_kpi_stock',
            title: 'Total Ledger Stock (NSV BBL)',
            type: 'KPI_CARD',
            query: {
              schema_version: 1,
              report_type: 'TABULAR',
              source: { kind: 'tank_stock_ledger' },
              date_basis: 'ACCOUNTING_DATE',
              columns: [
                { key: 'stock_nsv_bbl', label: 'Stock NSV (BBL)', kind: 'data', source: { type: 'column', column: 'stock_nsv_bbl' }, data_type: 'number', aggregate: 'MAX', show_total: true, format: { decimals: 2 } },
                { key: 'product_name', label: 'Product', kind: 'data', source: { type: 'column', column: 'product_name' }, data_type: 'text', aggregate: 'FIRST', hidden: true },
              ],
              filters: [],
              filter_logic: 'AND',
              runtime_filters: [],
              group_by: [{ key: 'product_name', bucket: 'VALUE' }],
              sort: [],
              options: { show_totals: true, page_size: 200 },
              metric_key: 'stock_nsv_bbl',
            },
            style: { kpi: { suffix: ' BBL', decimals: 0, showSparkline: true } },
            interactions: { crossFilter: true, drillThrough: { enabled: true, mode: 'RECORDS' } },
          },
          {
            id: 'v_kpi_in',
            title: 'Net Movement Volume (NSV BBL)',
            type: 'KPI_CARD',
            query: {
              schema_version: 1,
              report_type: 'TABULAR',
              source: { kind: 'tank_stock_ledger' },
              date_basis: 'ACCOUNTING_DATE',
              columns: [
                { key: 'accounting_date', label: 'Accounting Date', kind: 'data', source: { type: 'column', column: 'accounting_date' }, data_type: 'date' },
                { key: 'movement_nsv_bbl', label: 'Movement NSV (BBL)', kind: 'data', source: { type: 'column', column: 'movement_nsv_bbl' }, data_type: 'number', aggregate: 'SUM', show_total: true, format: { decimals: 2 } },
                { key: 'product_name', label: 'Product', kind: 'data', source: { type: 'column', column: 'product_name' }, data_type: 'text', aggregate: 'FIRST', hidden: true },
              ],
              filters: [],
              filter_logic: 'AND',
              runtime_filters: [],
              group_by: [{ key: 'accounting_date', bucket: 'DAY' }],
              sort: [{ key: 'accounting_date', direction: 'ASC' }],
              options: { show_totals: true, page_size: 200 },
              metric_key: 'movement_nsv_bbl',
            },
            style: { kpi: { suffix: ' BBL', decimals: 0, showSparkline: true } },
            interactions: { crossFilter: true, drillThrough: { enabled: true, mode: 'RECORDS' } },
          },
          {
            id: 'v_tank_snap',
            title: 'Shore Tank Capacity & Live Fill Levels',
            type: 'TANK_VISUAL',
            query: { source: { kind: 'tank_snapshot' }, unit: 'nsv' },
            style: {},
            interactions: { crossFilter: true, drillThrough: { enabled: true, mode: 'RECORDS' } },
          },
          {
            id: 'v_col_tank',
            title: 'Movement Volume by Tank & Operation',
            type: 'COLUMN',
            query: {
              schema_version: 1,
              report_type: 'TABULAR',
              source: { kind: 'tank_stock_ledger' },
              date_basis: 'ACCOUNTING_DATE',
              columns: [
                { key: 'tank_asset_code', label: 'Tank', kind: 'data', source: { type: 'column', column: 'tank_asset_code' }, data_type: 'text' },
                { key: 'movement_nsv_bbl', label: 'NSV (BBL)', kind: 'data', source: { type: 'column', column: 'movement_nsv_bbl' }, data_type: 'number', aggregate: 'SUM', format: { decimals: 2 } },
                { key: 'movement_gsv_bbl', label: 'GSV (BBL)', kind: 'data', source: { type: 'column', column: 'movement_gsv_bbl' }, data_type: 'number', aggregate: 'SUM', format: { decimals: 2 } },
                { key: 'product_name', label: 'Product', kind: 'data', source: { type: 'column', column: 'product_name' }, data_type: 'text', aggregate: 'FIRST', hidden: true },
              ],
              filters: [],
              filter_logic: 'AND',
              runtime_filters: [],
              group_by: [{ key: 'tank_asset_code', bucket: 'VALUE' }],
              sort: [{ key: 'movement_nsv_bbl', direction: 'DESC' }],
              options: { show_totals: true, page_size: 200 },
              dimension_key: 'tank_asset_code',
              measure_key: 'movement_nsv_bbl',
              measure_keys: ['movement_nsv_bbl', 'movement_gsv_bbl'],
            },
            style: { chart: { showLegend: true, showToolbox: true, dataZoom: false } },
            interactions: { crossFilter: true, drillThrough: { enabled: true, mode: 'RECORDS' } },
          },
          {
            id: 'v_box_mov',
            title: 'Movement Volume Statistical Distribution by Tank (Plotly)',
            type: 'BOX_PLOT',
            query: {
              schema_version: 1,
              report_type: 'TABULAR',
              source: { kind: 'tank_stock_ledger' },
              date_basis: 'ACCOUNTING_DATE',
              columns: [
                { key: 'tank_asset_code', label: 'Tank', kind: 'data', source: { type: 'column', column: 'tank_asset_code' }, data_type: 'text' },
                { key: 'movement_nsv_bbl', label: 'Movement NSV (BBL)', kind: 'data', source: { type: 'column', column: 'movement_nsv_bbl' }, data_type: 'number', format: { decimals: 2 } },
                { key: 'product_name', label: 'Product', kind: 'data', source: { type: 'column', column: 'product_name' }, data_type: 'text', hidden: true },
              ],
              filters: [],
              filter_logic: 'AND',
              runtime_filters: [],
              group_by: [],
              sort: [],
              options: { show_totals: false, page_size: 500 },
              dimension_key: 'tank_asset_code',
              measure_key: 'movement_nsv_bbl',
            },
            style: { plotly: { showModeBar: true, boxMean: true, showOutliers: true } },
            interactions: { crossFilter: true, drillThrough: { enabled: true, mode: 'RECORDS' } },
          },
          {
            id: 'v_pivot_ledger',
            title: 'Tank Stock & Movement Perspective Pivot Matrix',
            type: 'PIVOT_GRID',
            query: {
              schema_version: 1,
              report_type: 'TABULAR',
              source: { kind: 'tank_stock_ledger' },
              date_basis: 'ACCOUNTING_DATE',
              columns: [
                { key: 'tank_asset_code', label: 'Tank', kind: 'data', source: { type: 'column', column: 'tank_asset_code' }, data_type: 'text' },
                { key: 'product_name', label: 'Product', kind: 'data', source: { type: 'column', column: 'product_name' }, data_type: 'text' },
                { key: 'tank_operation_code', label: 'Operation', kind: 'data', source: { type: 'column', column: 'tank_operation_code' }, data_type: 'text' },
                { key: 'accounting_date', label: 'Accounting Date', kind: 'data', source: { type: 'column', column: 'accounting_date' }, data_type: 'date' },
                { key: 'movement_nsv_bbl', label: 'Movement NSV (BBL)', kind: 'data', source: { type: 'column', column: 'movement_nsv_bbl' }, data_type: 'number', format: { decimals: 2 } },
                { key: 'stock_nsv_bbl', label: 'Closing Stock NSV (BBL)', kind: 'data', source: { type: 'column', column: 'stock_nsv_bbl' }, data_type: 'number', format: { decimals: 2 } },
              ],
              filters: [],
              filter_logic: 'AND',
              runtime_filters: [],
              group_by: [],
              sort: [{ key: 'accounting_date', direction: 'DESC' }],
              options: { show_totals: true, page_size: 500 },
            },
            explorer: {
              groupByKeys: ['tank_asset_code', 'product_name'],
              splitByKeys: [],
              measureSpecs: [
                { key: 'movement_nsv_bbl', aggregate: 'SUM', label: 'Net Movement NSV' },
                { key: 'stock_nsv_bbl', aggregate: 'LAST', label: 'Closing Stock NSV' },
                { key: 'movement_nsv_bbl', aggregate: 'COUNT', label: 'Entries' },
              ],
              sortSpecs: [],
              whereRules: [],
              allowViewSwitch: true,
              showShelfByDefault: true,
            },
            style: { table: { dataBars: true, colorScale: 'diverging', showSummaryBar: true, stickyHeader: true, striped: true } },
            interactions: { crossFilter: true, drillThrough: { enabled: true, mode: 'RECORDS' } },
          },
        ],
        layout: [
          { i: 'v_kpi_stock', x: 0, y: 0, w: 3, h: 4, minW: 3, minH: 3 },
          { i: 'v_kpi_in', x: 3, y: 0, w: 3, h: 4, minW: 3, minH: 3 },
          { i: 'v_tank_snap', x: 6, y: 0, w: 6, h: 6, minW: 4, minH: 5 },
          { i: 'v_col_tank', x: 0, y: 4, w: 6, h: 6, minW: 4, minH: 5 },
          { i: 'v_box_mov', x: 6, y: 6, w: 6, h: 6, minW: 4, minH: 5 },
          { i: 'v_pivot_ledger', x: 0, y: 12, w: 12, h: 8, minW: 6, minH: 5 },
        ],
      }),
    },
    {
      id: 'operations_pipeline',
      name: 'Operation Tickets & Reconciliation Analytics',
      description: 'Ticket pipeline funnel, daily activity trend, operation breakdown donut, and interactive ticket explorer.',
      buildDefinition: () => ({
        schema_version: 2,
        canvas: { floatMode: false, cellHeight: 64, margin: 14 },
        slicers: [
          {
            id: 'slicer_op_type',
            key: 's_operation_type',
            label: 'Operation Type',
            type: 'SELECT',
            column_key: 'operation_type_code',
            field: 'operation_type_code',
            visual_ids: ['v_tk_kpi', 'v_tk_trend', 'v_tk_donut', 'v_tk_grid'],
            config: { multi: true, allowAll: true },
          },
        ],
        visuals: [
          {
            id: 'v_tk_kpi',
            title: 'Approved Operation Tickets',
            type: 'KPI_CARD',
            query: {
              schema_version: 1,
              report_type: 'TABULAR',
              source: { kind: 'operation_tickets', operation_type_codes: [], template_ids: [], statuses: ['Approved'] },
              date_basis: 'ACCOUNTING_DATE',
              columns: [
                { key: 'id', label: 'Ticket Count', kind: 'data', source: { type: 'column', column: 'id' }, data_type: 'number', aggregate: 'COUNT', show_total: true, format: { decimals: 0 } },
                { key: 'operation_type_code', label: 'Operation Type', kind: 'data', source: { type: 'column', column: 'operation_type_code' }, data_type: 'text', aggregate: 'FIRST', hidden: true },
              ],
              filters: [],
              filter_logic: 'AND',
              runtime_filters: [],
              group_by: [{ key: 'operation_type_code', bucket: 'VALUE' }],
              sort: [],
              options: { show_totals: true, page_size: 200 },
              metric_key: 'id',
            },
            style: { kpi: { suffix: ' tickets', decimals: 0, showSparkline: true } },
            interactions: { crossFilter: true, drillThrough: { enabled: true, mode: 'RECORDS' } },
          },
          {
            id: 'v_tk_donut',
            title: 'Tickets by Operation Type',
            type: 'DONUT',
            query: {
              schema_version: 1,
              report_type: 'TABULAR',
              source: { kind: 'operation_tickets', operation_type_codes: [], template_ids: [], statuses: ['Approved'] },
              date_basis: 'ACCOUNTING_DATE',
              columns: [
                { key: 'operation_type_code', label: 'Operation Type', kind: 'data', source: { type: 'column', column: 'operation_type_code' }, data_type: 'text' },
                { key: 'id', label: 'Tickets', kind: 'data', source: { type: 'column', column: 'id' }, data_type: 'number', aggregate: 'COUNT', format: { decimals: 0 } },
              ],
              filters: [],
              filter_logic: 'AND',
              runtime_filters: [],
              group_by: [{ key: 'operation_type_code', bucket: 'VALUE' }],
              sort: [{ key: 'id', direction: 'DESC' }],
              options: { show_totals: true, page_size: 200 },
              dimension_key: 'operation_type_code',
              measure_key: 'id',
            },
            style: { chart: { showLegend: true, showLabels: true } },
            interactions: { crossFilter: true, drillThrough: { enabled: true, mode: 'RECORDS' } },
          },
          {
            id: 'v_tk_trend',
            title: 'Daily Ticket Throughput Trend',
            type: 'AREA',
            query: {
              schema_version: 1,
              report_type: 'TABULAR',
              source: { kind: 'operation_tickets', operation_type_codes: [], template_ids: [], statuses: ['Approved'] },
              date_basis: 'ACCOUNTING_DATE',
              columns: [
                { key: 'operation_date', label: 'Operation Date', kind: 'data', source: { type: 'column', column: 'operation_date' }, data_type: 'date' },
                { key: 'id', label: 'Tickets', kind: 'data', source: { type: 'column', column: 'id' }, data_type: 'number', aggregate: 'COUNT', format: { decimals: 0 } },
                { key: 'operation_type_code', label: 'Operation Type', kind: 'data', source: { type: 'column', column: 'operation_type_code' }, data_type: 'text', aggregate: 'FIRST', hidden: true },
              ],
              filters: [],
              filter_logic: 'AND',
              runtime_filters: [],
              group_by: [{ key: 'operation_date', bucket: 'DAY' }],
              sort: [{ key: 'operation_date', direction: 'ASC' }],
              options: { show_totals: true, page_size: 200 },
              dimension_key: 'operation_date',
              measure_key: 'id',
            },
            style: { chart: { smooth: true, areaFill: true, dataZoom: true, showToolbox: true } },
            interactions: { crossFilter: true, drillThrough: { enabled: true, mode: 'RECORDS' } },
          },
          {
            id: 'v_tk_grid',
            title: 'Operation Tickets Interactive Pivot & Register',
            type: 'PIVOT_GRID',
            query: {
              schema_version: 1,
              report_type: 'TABULAR',
              source: { kind: 'operation_tickets', operation_type_codes: [], template_ids: [], statuses: ['Approved'] },
              date_basis: 'ACCOUNTING_DATE',
              columns: [
                { key: 'operation_ticket_number', label: 'Ticket Number', kind: 'data', source: { type: 'column', column: 'operation_ticket_number' }, data_type: 'text' },
                { key: 'operation_type_code', label: 'Operation Type', kind: 'data', source: { type: 'column', column: 'operation_type_code' }, data_type: 'text' },
                { key: 'origin_location_code', label: 'Origin Location', kind: 'data', source: { type: 'column', column: 'origin_location_code' }, data_type: 'text' },
                { key: 'primary_asset_code', label: 'Asset', kind: 'data', source: { type: 'column', column: 'primary_asset_code' }, data_type: 'text' },
                { key: 'operation_date', label: 'Operation Date', kind: 'data', source: { type: 'column', column: 'operation_date' }, data_type: 'date' },
                { key: 'status', label: 'Status', kind: 'data', source: { type: 'column', column: 'status' }, data_type: 'text' },
              ],
              filters: [],
              filter_logic: 'AND',
              runtime_filters: [],
              group_by: [],
              sort: [{ key: 'operation_date', direction: 'DESC' }],
              options: { show_totals: false, page_size: 500 },
            },
            explorer: {
              groupByKeys: ['operation_type_code'],
              splitByKeys: [],
              measureSpecs: [{ key: 'operation_ticket_number', aggregate: 'COUNT', label: 'Tickets' }],
              sortSpecs: [],
              whereRules: [],
              allowViewSwitch: true,
              showShelfByDefault: true,
            },
            style: { table: { dataBars: true, showSummaryBar: true, stickyHeader: true, striped: true } },
            interactions: { crossFilter: true, drillThrough: { enabled: true, mode: 'TRANSACTION_DETAIL' } },
          },
        ],
        layout: [
          { i: 'v_tk_kpi', x: 0, y: 0, w: 3, h: 4, minW: 3, minH: 3 },
          { i: 'v_tk_donut', x: 3, y: 0, w: 4, h: 6, minW: 4, minH: 5 },
          { i: 'v_tk_trend', x: 7, y: 0, w: 5, h: 6, minW: 4, minH: 5 },
          { i: 'v_tk_grid', x: 0, y: 6, w: 12, h: 7, minW: 6, minH: 5 },
        ],
      }),
    },
  ]
}
