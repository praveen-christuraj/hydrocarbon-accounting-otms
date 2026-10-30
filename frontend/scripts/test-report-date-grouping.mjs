import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error', optimizeDeps: { noDiscovery: true, include: [] } })
try {
  const { AGGREGATES, BUCKETS, formatCellValue } = await server.ssrLoadModule('/src/utils/reportBuilder.js')
  const { default: ReportDataTable } = await server.ssrLoadModule('/src/components/reportBuilder/ReportDataTable.jsx')
  assert.ok(AGGREGATES.some((item) => item.value === 'PRODUCT'))
  assert.ok(BUCKETS.some((item) => item.value === 'QUARTER'))
  for (const value of ['2026', '2026-Q4', '2026-10']) {
    assert.equal(formatCellValue(value, { data_type: 'date' }), value)
    assert.equal(formatCellValue(value, { data_type: 'datetime' }), value)
  }
  const result = { columns: [{ key: 'date', label: 'Date', data_type: 'date' }, { key: 'value', label: 'Value', data_type: 'number' }], rows: [{ date: '2026-Q4', value: 12 }], totals: {} }
  const withDrill = renderToStaticMarkup(React.createElement(ReportDataTable, { result, drillColumn: 'date', onDrill: () => {} }))
  assert.match(withDrill, /<button[^>]*title="Drill into this date period"[^>]*>2026-Q4/)
  const withoutDrill = renderToStaticMarkup(React.createElement(ReportDataTable, { result }))
  assert.doesNotMatch(withoutDrill, /<button/)
  console.log('Report date grouping UI tests passed')
} finally {
  await server.close()
}
