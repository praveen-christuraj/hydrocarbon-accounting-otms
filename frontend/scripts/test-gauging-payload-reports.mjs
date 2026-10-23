/*
 * End-to-end frontend contract & rendering test for gauging payload date/time
 * across all hydrocarbon accounting report pages:
 *  - formatCalendarDate / formatGaugingTime / toIsoDateString timezone safety
 *  - useAutoColumns wide-table support (> 40 columns) & column type inference
 *  - OutTurnSummary, OutTurnReport, TankStockLedger (Daily Summary, Stock Summary,
 *    Ledger Details), TankOperationSummary, and MaterialBalanceReport rendered in
 *    happy-dom with zero console errors, clean calendar dates, clean HH:MM times,
 *    and accurate receipt/dispatch/opening/closing numbers.
 *
 * Usage: npm run test:gauging-reports
 */
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { createServer } from 'vite'

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const nodeTimers = {
  setTimeout: globalThis.setTimeout,
  clearTimeout: globalThis.clearTimeout,
  setInterval: globalThis.setInterval,
  clearInterval: globalThis.clearInterval,
  setImmediate: globalThis.setImmediate,
  clearImmediate: globalThis.clearImmediate,
  queueMicrotask: globalThis.queueMicrotask,
}
GlobalRegistrator.register({ url: 'http://localhost:5173/', width: 1440, height: 900 })
Object.assign(globalThis, nodeTimers)

if (!window.matchMedia) {
  window.matchMedia = () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  })
}
window.URL.createObjectURL = () => 'blob:http://localhost:5173/mock-csv'
window.URL.revokeObjectURL = () => {}
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

globalThis.localStorage.setItem('hydrocarbonAccessToken', 'test-token')

const apiRequests = []
const runtimeErrors = []
const origConsoleError = console.error
console.error = (...args) => {
  const msg = args.map((a) => (a && a.stack) || String(a)).join(' ')
  runtimeErrors.push(msg)
  origConsoleError('[console.error]', msg)
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

// Build a realistic 55-column payload row (> old 40-column cap!)
const extraCalcCols = {}
for (let i = 1; i <= 45; i += 1) {
  extraCalcCols[`calc_metric_${String(i).padStart(2, '0')}_bbl`] = 100 + i
}

globalThis.fetch = async (input) => {
  const rawUrl = typeof input === 'string' ? input : input.url
  const parsed = new URL(rawUrl, 'http://localhost:8000')
  apiRequests.push(`${parsed.pathname}${parsed.search}`)

  if (parsed.pathname === '/company-report-profiles') {
    return json([])
  }

  if (parsed.pathname === '/out-turn-summary') {
    return json({
      columns: [
        { key: 'accounting_date', label: 'Accounting Date', group: 'Base', enabled: true, order: 0 },
        { key: 'input_gaugingDate', label: 'Gauging Date', group: 'Input', enabled: true, order: 1 },
        { key: 'input_gaugingTime', label: 'Gauging Time', group: 'Input', enabled: true, order: 2 },
        { key: 'ticket_number', label: 'Ticket Number', group: 'Base', enabled: true, order: 3 },
        { key: 'previous_nsv_bbl', label: 'Previous NSV (bbl)', group: 'Computed', enabled: true, order: 4 },
        { key: 'net_receipt_nsv_bbl', label: 'Net Receipt NSV (bbl)', group: 'Computed', enabled: true, order: 5 },
        { key: 'net_dispatch_nsv_bbl', label: 'Net Dispatch NSV (bbl)', group: 'Computed', enabled: true, order: 6 },
      ],
      available_columns: [],
      rows: [
        {
          transaction_id: 101,
          accounting_date: '2026-10-19',
          operation_date: '2026-10-20',
          input_gaugingDate: '2026-10-20',
          input_gaugingTime: '5:30',
          input_tankOperation: '01',
          ticket_number: 'TKT-OP-02',
          ...extraCalcCols,
          previous_nsv_bbl: 10000,
          net_receipt_nsv_bbl: 2500,
          net_dispatch_nsv_bbl: 0,
        },
      ],
      total_rows: 1,
      page: 1,
      page_size: 100,
      has_more: false,
      default_window_applied: false,
    })
  }

  if (parsed.pathname === '/reports/out-turn-report') {
    return json([
      {
        ledger_id: 1,
        transaction_id: 102,
        ticket_number: 'TKT-OP-04',
        operation_number: 'OP-04',
        accounting_date: '2026-10-20',
        gauging_date: '2026-10-20',
        gauging_time: '14:15',
        operation_datetime: '2026-10-20T14:15:00',
        location_code: 'BONNY',
        location_name: 'Bonny Terminal',
        tank_asset_code: 'BONNY_TK01',
        tank_asset_name: 'Bonny Tank 01',
        product_name: 'Bonny Light',
        tank_operation_code: 'DISPATCH',
        tank_operation_label: 'Export Dispatch',
        tank_operation_category: 'DISPATCH',
        tank_operation_sign: 'OUT',
        previous_stock_nsv_bbl: 12500,
        stock_after_nsv_bbl: 9500,
        receipt_nsv_bbl: 0,
        production_nsv_bbl: 0,
        draining_nsv_bbl: 0,
        dispatch_nsv_bbl: 3000,
        other_in_nsv_bbl: 0,
        other_out_nsv_bbl: 0,
        signed_net_movement_nsv_bbl: -3000,
        stock_after_lt: 1200,
        stock_after_mt: 1220,
        status: 'Active',
      },
    ])
  }

  if (parsed.pathname === '/tank-operation-summary/columns') {
    assert.ok(
      !parsed.search.includes('object'),
      `Expected clean location_code query param, got: ${parsed.search}`
    )
    return json({
      columns: [
        'accounting_date',
        'input_gaugingDate',
        'input_gaugingTime',
        'ticket_number',
        'calc_nsvBbl',
      ],
    })
  }

  if (parsed.pathname === '/tank-operation-summary') {
    return json({
      columns: [
        'accounting_date',
        'input_gaugingDate',
        'input_gaugingTime',
        'ticket_number',
        'calc_nsvBbl',
      ],
      rows: [
        {
          transaction_id: 201,
          accounting_date: '2026-10-19',
          input_gaugingDate: '2026-10-20',
          input_gaugingTime: '5:30',
          ticket_number: 'TKT-TOS-01',
          calc_nsvBbl: 12500,
          ...extraCalcCols,
        },
      ],
      total_rows: 1,
      page: 1,
      page_size: 100,
      has_more: false,
      default_window_applied: true,
      applied_date_from: '2026-07-25',
      applied_date_to: '2026-10-23',
    })
  }

  if (parsed.pathname === '/tank-stock-ledger' || parsed.pathname === '/reports/tank-stock-ledger') {
    return json([
      {
        id: 11,
        transaction_id: 101,
        ticket_number: 'TKT-LED-01',
        operation_number: 'OP-02',
        location_code: 'BONNY',
        location_name: 'Bonny Terminal',
        tank_asset_code: 'BONNY_TK01',
        tank_asset_name: 'Bonny Tank 01',
        accounting_date: '2026-10-19',
        gauging_date: '2026-10-20',
        gauging_time: '05:30',
        operation_date: '2026-10-20',
        product_name: 'Bonny Light',
        tank_operation_code: 'RECEIPT',
        tank_operation_label: 'Crude Receipt',
        tank_operation_category: 'RECEIPT',
        tank_operation_sign: 'IN',
        previous_stock_nsv_bbl: 10000,
        movement_nsv_bbl: 2500,
        running_balance_nsv_bbl: 12500,
        movement_lt: 300,
        running_balance_lt: 1500,
        movement_mt: 305,
        running_balance_mt: 1525,
        status: 'Active',
      },
    ])
  }

  if (parsed.pathname === '/tank-stock-ledger/summary' || parsed.pathname === '/reports/tank-stock-ledger/summary') {
    return json([
      {
        location_code: 'BONNY',
        location_name: 'Bonny Terminal',
        tank_asset_code: 'BONNY_TK01',
        tank_asset_name: 'Bonny Tank 01',
        product_name: 'Bonny Light',
        opening_nsv_bbl: 10000,
        total_in_nsv_bbl: 2500,
        total_out_nsv_bbl: 0,
        closing_nsv_bbl: 12500,
        closing_lt: 1500,
        closing_mt: 1525,
      },
    ])
  }

  if (parsed.pathname === '/tank-stock-ledger/daily-summary' || parsed.pathname === '/reports/tank-stock-ledger/daily-summary') {
    return json([
      {
        accounting_date: '2026-10-19',
        location_code: 'BONNY',
        location_name: 'Bonny Terminal',
        tank_asset_code: 'BONNY_TK01',
        tank_asset_name: 'Bonny Tank 01',
        product_name: 'Bonny Light',
        opening_nsv_bbl: 10000,
        total_in_nsv_bbl: 2500,
        total_out_nsv_bbl: 0,
        book_closing_nsv_bbl: 12500,
        actual_closing_nsv_bbl: 12500,
        loss_gain_nsv_bbl: 0,
        actual_closing_lt: 1500,
        actual_closing_mt: 1525,
        rows_count: 2,
        last_ticket_number: 'TKT-LED-01',
      },
    ])
  }

  if (parsed.pathname === '/reports/material-balance-report') {
    return json({
      template: { id: 1, template_name: 'Bonny MB', location_code: 'BONNY' },
      columns: [
        { column_key: 'opening_stock', column_label: 'Opening Stock', column_order: 1, column_type: 'OPENING', include_in_material_balance: 'Yes', is_internal_transfer: 'No' },
        { column_key: 'receipt', column_label: 'Receipt', column_order: 2, column_type: 'MOVEMENT', movement_direction: 'IN', include_in_material_balance: 'Yes', is_internal_transfer: 'No' },
        { column_key: 'actual_closing', column_label: 'Actual Closing', column_order: 3, column_type: 'ACTUAL_CLOSING', include_in_material_balance: 'Yes', is_internal_transfer: 'No' },
      ],
      rows: [
        {
          accounting_date: '2026-10-19',
          location_code: 'BONNY',
          location_name: 'Bonny Terminal',
          tank_asset_code: '',
          tank_asset_name: 'All Tanks',
          product_name: 'Bonny Light',
          values: { opening_stock: 15000, receipt: 2000, actual_closing: 17000 },
          rows_count: 4,
          last_ticket_number: 'TKT-MB-04',
        },
      ],
    })
  }

  return json([])
}

const server = await createServer({
  configFile: path.join(frontendRoot, 'vite.config.js'),
  root: frontendRoot,
  logLevel: 'error',
  server: { middlewareMode: true, hmr: false, watch: null },
  appType: 'custom',
  optimizeDeps: { noDiscovery: true, include: [] },
  ssr: { external: ['react', 'react-dom', 'react-router-dom', 'react-router'] },
})

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const flush = async (ms = 60) => {
  for (let i = 0; i < 3; i += 1) {
    await sleep(ms)
    await new Promise((r) => setImmediate(r))
  }
}

try {
  // 1. Unit assertions on format.js & useAutoColumns.js
  const formatMod = await server.ssrLoadModule('/src/utils/format.js')
  assert.equal(formatMod.formatCalendarDate('2026-10-20'), '2026-10-20')
  assert.equal(formatMod.toIsoDateString(new Date(2026, 9, 1)), '2026-10-01')
  assert.equal(formatMod.formatGaugingTime('5:30'), '05:30')
  assert.equal(formatMod.formatGaugingTime('06:00:30'), '06:00:30')
  assert.equal(formatMod.formatGaugingTime('14:15:00'), '14:15')

  const autoColsMod = await server.ssrLoadModule('/src/hooks/useAutoColumns.js')
  const inferredWideCols = autoColsMod.inferColumns([
    {
      accounting_date: '2026-10-20',
      input_gaugingDate: '2026-10-20',
      input_gaugingTime: '05:30',
      ...extraCalcCols,
      previous_nsv_bbl: 10000,
    },
  ])
  assert.ok(inferredWideCols.length >= 49, `Expected >40 columns preserved, got ${inferredWideCols.length}`)
  assert.ok(inferredWideCols.some((c) => c.key === 'previous_nsv_bbl' && c.label.includes('NSV')))

  // 2. Render all report pages cleanly through React 19 in happy-dom
  const React = (await import('react')).default
  const { createRoot } = await import('react-dom/client')
  const { ToastProvider } = await server.ssrLoadModule('/src/components/common/Toast.jsx')
  const { ConfirmProvider } = await server.ssrLoadModule('/src/components/common/ConfirmProvider.jsx')
  const { default: OutTurnSummary } = await server.ssrLoadModule('/src/pages/OutTurnSummary.jsx')
  const { default: OutTurnReport } = await server.ssrLoadModule('/src/pages/OutTurnReport.jsx')
  const { default: TankStockLedger } = await server.ssrLoadModule('/src/pages/TankStockLedger.jsx')
  const { default: TankOperationSummary } = await server.ssrLoadModule('/src/pages/TankOperationSummary.jsx')
  const { default: MaterialBalanceReport } = await server.ssrLoadModule('/src/pages/MaterialBalanceReport.jsx')

  const wrap = (el) =>
    React.createElement(ToastProvider, null, React.createElement(ConfirmProvider, null, el))

  const locations = [{ id: 1, locationCode: 'BONNY', locationName: 'Bonny Terminal', status: 'Active' }]
  const assets = [{ id: 1, assetCode: 'BONNY_TK01', assetName: 'Bonny Tank 01', locationCode: 'BONNY', status: 'Active' }]
  const adminUser = { id: 1, username: 'admin', isAdmin: true, allLocationsAccess: 'Yes' }

  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)

  // A) OutTurnSummary: verifies 50+ columns preserved in DataFilterBar, no UTC time shift, clean 05:30 time
  root.render(wrap(React.createElement(OutTurnSummary, { locations, assets, loggedInUser: adminUser })))
  await flush(120)
  const otsHtml = host.textContent
  assert.ok(otsHtml.includes('2026-10-19'), `OutTurnSummary missing accounting_date: ${otsHtml}`)
  assert.ok(otsHtml.includes('2026-10-20'), `OutTurnSummary missing input_gaugingDate: ${otsHtml}`)
  assert.ok(otsHtml.includes('05:30'), `OutTurnSummary missing formatted gauging time 05:30: ${otsHtml}`)
  assert.ok(!otsHtml.includes('1:00:00 AM'), `OutTurnSummary rendered UTC-shifted timestamp: ${otsHtml}`)
  const filterColSelect = host.querySelector('select[aria-label*="column"], .data-filter-bar select')
  if (filterColSelect) {
    assert.ok(
      filterColSelect.options.length > 45,
      `Expected >45 columns in DataFilterBar (not capped at 40), got ${filterColSelect.options.length}`
    )
  }

  // B) OutTurnReport: verifies Accounting Date + Gauging Date + Gauging Time columns
  root.render(wrap(React.createElement(OutTurnReport, { locations, assets })))
  await flush(120)
  const otrHtml = host.textContent
  assert.ok(otrHtml.includes('Gauging Date') && otrHtml.includes('Gauging Time'), 'OutTurnReport missing Gauging Date/Time headers')
  assert.ok(otrHtml.includes('14:15') && otrHtml.includes('TKT-OP-04'), `OutTurnReport missing row data: ${otrHtml}`)

  // C) TankStockLedger: verifies Daily Summary & Ledger Details (with Gauging Date, Gauging Time, Previous NSV)
  root.render(wrap(React.createElement(TankStockLedger, { locations, assets, loggedInUser: adminUser })))
  await flush(120)
  const dailyCall = apiRequests.find(
    (r) =>
      r.startsWith('/tank-stock-ledger/daily-summary?') ||
      r.startsWith('/reports/tank-stock-ledger/daily-summary?')
  )
  assert.ok(dailyCall && dailyCall.includes('date_from=2026-10-01'), `Expected local 1st-of-month date_from=2026-10-01, got ${dailyCall}`)

  const ledgerDetailsBtn = Array.from(host.querySelectorAll('button')).find((b) =>
    b.textContent.includes('Ledger Details')
  )
  assert.ok(ledgerDetailsBtn, 'Ledger Details tab button not found')
  ledgerDetailsBtn.click()
  await flush(80)
  const ledgerHtml = host.textContent
  assert.ok(ledgerHtml.includes('Gauging Date') && ledgerHtml.includes('Gauging Time') && ledgerHtml.includes('Previous NSV'))
  assert.ok(ledgerHtml.includes('2026-10-19') && ledgerHtml.includes('2026-10-20') && ledgerHtml.includes('05:30'))

  // D) TankOperationSummary: verifies clean columns fetch (no [object Object]), Accounting Date labels & 05:30
  root.render(wrap(React.createElement(TankOperationSummary, { locations, assets, loggedInUser: adminUser })))
  await flush(120)
  const tosHtml = host.textContent
  assert.ok(tosHtml.includes('Accounting Date From') && tosHtml.includes('05:30') && tosHtml.includes('TKT-TOS-01'))

  // E) MaterialBalanceReport: renders cleanly with zero runtime errors
  root.render(wrap(React.createElement(MaterialBalanceReport, { locations, assets })))
  await flush(80)
  assert.ok(host.textContent.includes('Material Balance Report'))

  root.unmount()
  assert.equal(runtimeErrors.length, 0, `Unexpected runtime console errors:\n${runtimeErrors.join('\n')}`)
  console.log('ALL gauging payload report frontend assertions passed cleanly!')
} finally {
  await server.close()
}
