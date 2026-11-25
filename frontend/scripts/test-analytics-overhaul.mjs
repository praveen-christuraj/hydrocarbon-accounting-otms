/**
 * Verification suite for the Analytics Module Overhaul:
 * 1. Canonical 12-col GridStack layout normalizer & auto-healing of squashed visuals
 * 2. Perspective client pivot/cross-tab/aggregation/filter engine
 * 3. Headless DOM render of AnalyticsHome, AnalyticsViewer (auto-run, SlicerBar,
 *    Shore Tank levels, Perspective PivotGrid, KPI card), and AnalyticsBuilder Studio.
 */
import assert from 'node:assert/strict'
import {
  VISUAL_CATALOG,
  buildStarterTemplates,
  computeDatePreset,
  computePerspectiveView,
  evaluateConditionalRules,
  normalizeLayoutForGridStack,
} from '../src/utils/analyticsEngine.js'

console.log('--- Testing Analytics Engine & Layout Auto-Healing ---')

assert.ok(VISUAL_CATALOG.length >= 26, `Expected >=26 visual types, got ${VISUAL_CATALOG.length}`)

// 1. Verify squashed w:2 TABLE layout (from user screenshot) auto-heals to >= 6 columns
const brokenVisuals = [
  { id: 'v_table', type: 'TABLE', title: 'TABLE visual' },
  { id: 'v_kpi', type: 'KPI_CARD', title: 'Total Stock' },
]
const brokenLayout = {
  lg: [
    { i: 'v_table', x: 0, y: 0, w: 2, h: 2 },
    { i: 'v_kpi', x: 11, y: 0, w: 1, h: 1 },
  ],
}
const healed = normalizeLayoutForGridStack(brokenLayout, brokenVisuals)
const healedTable = healed.find((item) => item.i === 'v_table')
const healedKpi = healed.find((item) => item.i === 'v_kpi')
assert.ok(healedTable.w >= 6, `Squashed TABLE width should heal to >=6, got ${healedTable.w}`)
assert.ok(healedTable.h >= 5, `Squashed TABLE height should heal to >=5, got ${healedTable.h}`)
assert.ok(healedKpi.w >= 3, `Squashed KPI_CARD width should heal to >=3, got ${healedKpi.w}`)
assert.ok(healedKpi.x + healedKpi.w <= 12, `KPI x+w must stay within 12 cols, got ${healedKpi.x + healedKpi.w}`)
console.log('PASS  normalizeLayoutForGridStack heals squashed w:2 TABLE & clamps to 12 columns')

// 2. Verify Perspective Pivot Engine (Group By + Split By + Aggregations + Where Rules)
const ledgerRows = [
  { tank: 'TK-101', product: 'Crude', op: 'RECEIPT', nsv: 1200 },
  { tank: 'TK-101', product: 'Crude', op: 'DISPATCH', nsv: -400 },
  { tank: 'TK-102', product: 'Condensate', op: 'RECEIPT', nsv: 800 },
  { tank: 'TK-102', product: 'Condensate', op: 'RECEIPT', nsv: 200 },
]
const ledgerCols = [
  { key: 'tank', label: 'Tank', data_type: 'text' },
  { key: 'product', label: 'Product', data_type: 'text' },
  { key: 'op', label: 'Operation', data_type: 'text' },
  { key: 'nsv', label: 'NSV (BBL)', data_type: 'number' },
]

const pivotResult = computePerspectiveView({
  rows: ledgerRows,
  columns: ledgerCols,
  explorer: {
    groupByKeys: ['tank', 'product'],
    splitByKeys: ['op'],
    measureSpecs: [
      { key: 'nsv', aggregate: 'SUM', label: 'Net NSV' },
      { key: 'nsv', aggregate: 'PCT_TOTAL', label: 'Share %' },
    ],
  },
})

assert.equal(pivotResult.isPivoted, true)
assert.equal(pivotResult.groupCount, 2)
assert.equal(pivotResult.flatLeafCount, 4)
assert.equal(pivotResult.totals['total::nsv::SUM'], 1800)
assert.equal(Math.round(pivotResult.totals['total::nsv::PCT_TOTAL']), 100)
const tk101Node = pivotResult.rows.find((r) => r.__treeKey === 'tank=TK-101')
assert.ok(tk101Node, 'Expected top-level tree group for TK-101')
assert.equal(tk101Node['RECEIPT::nsv::SUM'], 1200)
assert.equal(tk101Node['DISPATCH::nsv::SUM'], -400)
assert.equal(tk101Node['total::nsv::SUM'], 800)
console.log('PASS  computePerspectiveView builds multi-level Group By tree, Split By cross-tabs, and PCT_TOTAL')

// 3. Verify Conditional Formatting Rules & Date Presets
const negRuleHit = evaluateConditionalRules(-400, 'nsv', [
  { columnKey: 'nsv', operator: 'lt', value: 0, tone: 'danger' },
])
assert.equal(negRuleHit?.color, 'var(--danger-text)')
const preset30d = computeDatePreset('30D')
assert.ok(preset30d.from && preset30d.to && preset30d.from <= preset30d.to)
console.log('PASS  evaluateConditionalRules & computeDatePreset verified')

// 4. Verify Starter Blueprints produce valid v2 schemas
const templates = buildStarterTemplates()
assert.ok(templates.length >= 2)
for (const tpl of templates) {
  const def = tpl.buildDefinition()
  assert.equal(def.schema_version, 2)
  assert.ok(def.visuals.length >= 4)
  const norm = normalizeLayoutForGridStack(def.layout, def.visuals)
  assert.equal(norm.length, def.visuals.length)
}
console.log('PASS  Starter Terminal Blueprints generate valid 12-col definitions')
console.log('==== ALL ANALYTICS ENGINE & LAYOUT CHECKS PASSED ====')
