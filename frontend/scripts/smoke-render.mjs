/*
 * Headless smoke test: renders the React app in happy-dom with a mocked API
 * and walks through the shell + a few pages, reporting runtime errors.
 * No backend or browser is required.
 *
 * Usage: npm run smoke -- [/pathname ...]      (default: /locations /users /audit-logs)
 *        DUMP=4000 npm run smoke -- /users     (print the first 4000 chars of page HTML)
 */
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

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
// happy-dom swaps the timer globals for its own; Vite needs Node's (unref etc.)
Object.assign(globalThis, nodeTimers)

// happy-dom lacks a few APIs
if (!window.matchMedia) {
  window.matchMedia = () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  })
}
if (!window.scrollTo) window.scrollTo = () => {}
window.URL.createObjectURL = () => 'blob:http://localhost:5173/mock-download'
window.URL.revokeObjectURL = () => {}
// Downloads: do not navigate the happy-dom window
const nativeAnchorClick = window.HTMLAnchorElement.prototype.click
window.HTMLAnchorElement.prototype.click = function click() {
  if (this.hasAttribute('download') || String(this.href).startsWith('blob:')) {
    downloads.push(this.getAttribute('download') || this.href)
    return undefined
  }
  return nativeAnchorClick.call(this)
}
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

const errors = []
const downloads = []
const printCalls = []
// happy-dom has no window.print; record the calls so the print-profile flow
// can prove that the browser print dialog is opened only after a profile is
// chosen.
window.print = () => {
  printCalls.push(new Date().toISOString())
}

// jspdf's node build writes `doc.save(name)` straight to disk via fs; record
// those exports as downloads instead of leaving PDF files in the repo.
const nativeWriteFileSync = fs.writeFileSync
fs.writeFileSync = function writeFileSync(file, ...rest) {
  if (typeof file === 'string' && /\.pdf$/i.test(file) && !path.isAbsolute(file)) {
    downloads.push(path.basename(file))
    return undefined
  }
  return nativeWriteFileSync.call(this, file, ...rest)
}
const origError = console.error
console.error = (...args) => {
  const text = args.map((a) => (a && a.stack) || String(a)).join(' ')
  errors.push(text)
  origError('[console.error]', text.slice(0, 600))
}
process.on('unhandledRejection', (reason) => {
  errors.push('unhandledRejection: ' + ((reason && reason.stack) || reason))
  origError('[unhandledRejection]', (reason && reason.stack) || reason)
})
window.addEventListener('error', (event) => {
  errors.push('window.error: ' + (event.error?.stack || event.message))
})

/* ------------------------------------------------------------- fixtures */
const now = new Date().toISOString()
const permissionNames = [
  'View User', 'Create User', 'Update User', 'Delete User',
  'View Role', 'View Permission', 'View Role Permission Assignment',
  'View User Role Assignment', 'View User Location Assignment', 'View Role Location Assignment', 'View Access Summary',
  'View Own Security Settings', 'View Location', 'Create Location', 'Update Location', 'Delete Location',
  'View Location Accounting Day Setting', 'View Material Balance Template', 'View Asset Type', 'View Asset',
  'View Calibration Template', 'View Asset Calibration', 'View Asset Assignment', 'View Flowmeter Config',
  'View Company Report Profile', 'View Database Browser', 'View Audit Log', 'View System Notification',
  'View Backup', 'View Export Operations', 'View Barge Seal Master', 'View Operation Type', 'View Tank Operation',
  'View Vessel Operation', 'View Movement Mapping', 'View Operation Template', 'View Operation Workflow Policy',
  'Create Operation Entry', 'View My Tasks', 'View Operation Transaction', 'View Shuttle Tracking', 'View FSO Tracking',
  'View Dashboard', 'Manage Dashboard', 'View Location Operation Availability', 'View Flowmeter Record',
  'View Tank Stock Ledger', 'View Tank Operation Summary', 'View Out-Turn Summary', 'View Out-Turn Report',
  'View Material Balance Report', 'Review Operation Transaction', 'Approve Operation Transaction',
  'Reject Operation Transaction', 'Cancel Operation Transaction', 'Submit Operation Transaction',
  'View Report Definition', 'Create Report Definition', 'Edit Report Definition',
  'Delete Report Definition', 'Publish Report Definition', 'View Custom Report',
  'Export Custom Report',
]
const me = {
  id: 1,
  full_name: 'System Administrator',
  username: 'admin',
  email: 'admin@example.com',
  status: 'Active',
  roles: [{ id: 1, role_name: 'Admin', description: 'Administrator', status: 'Active' }],
  permissions: permissionNames.map((name, i) => ({ id: i + 1, permission_name: name, module_name: 'Core', status: 'Active' })),
  assigned_location_codes: [],
  all_locations_access: 'Yes',
}
const users = Array.from({ length: 57 }, (_, i) => ({
  id: i + 1,
  full_name: `User ${i + 1}`,
  username: `user${i + 1}`,
  email: `user${i + 1}@example.com`,
  phone: '',
  department: i % 2 ? 'Operations' : 'Finance',
  designation: 'Officer',
  status: i % 5 === 0 ? 'Inactive' : 'Active',
  created_at: now,
  updated_at: now,
}))
const locations = Array.from({ length: 43 }, (_, i) => ({
  id: i + 1,
  location_name: `Terminal ${i + 1}`,
  location_code: `LOC${String(i + 1).padStart(3, '0')}`,
  location_type: i % 3 === 0 ? 'Terminal' : i % 3 === 1 ? 'Depot' : 'Refinery',
  parent_location_code: i > 2 ? 'LOC001' : null,
  description: `Location number ${i + 1}`,
  status: i % 7 === 0 ? 'Inactive' : 'Active',
  created_at: now,
  updated_at: now,
}))
const reportProfiles = [
  {
    id: 1,
    profile_name: 'Default Report Profile',
    company_name: 'Acme Petroleum Ltd',
    system_name: 'Hydrocarbon Accounting System',
    report_subtitle: 'Tank Gauging Quantity Report',
    logo_data_url: '',
    logo_text: 'LOGO',
    footer_formula: 'Formula: GOV = TOV - Free Water',
    footer_note: 'This report is system-generated.',
    status: 'Active',
    created_at: now,
    updated_at: now,
  },
  {
    id: 2,
    profile_name: 'Second Company Profile',
    company_name: 'Beta Energy Ltd',
    system_name: 'Hydrocarbon Accounting System',
    report_subtitle: 'Marine Terminal Report',
    logo_data_url: '',
    logo_text: 'BEL',
    footer_formula: 'Formula: GSV = GOV x VCF',
    footer_note: 'Beta Energy printed report.',
    status: 'Active',
    created_at: now,
    updated_at: now,
  },
]

const customReportDefinition = {
  schema_version: 1,
  report_type: 'TABULAR',
  source: { kind: 'operation_tickets', operation_type_codes: [], statuses: [] },
  date_basis: 'ACCOUNTING_DATE',
  columns: [
    { key: 'ticket_number', label: 'Ticket No', kind: 'data', data_type: 'text', source: { type: 'column', column: 'operation_ticket_number' }, format: {} },
    { key: 'nsv_bbl', label: 'NSV (BBL)', kind: 'data', data_type: 'number', source: { type: 'payload_path', field_code: 'tank_gauging_payload', path: 'calculated.nsvBbl' }, format: { decimals: 3 } },
  ],
  filters: [],
  filter_logic: 'AND',
  runtime_filters: [],
  group_by: [],
  sort: [],
  options: { page_size: 50 },
}
const customReport = {
  id: 1,
  report_code: 'RPT-0001',
  report_name: 'Published Tank Quantities',
  description: 'Published report regression fixture',
  report_type: 'TABULAR',
  source_kind: 'operation_tickets',
  source_table: null,
  definition: customReportDefinition,
  visibility: 'INTERNAL',
  is_published: true,
  status: 'Active',
  version: 2,
  owner_user_id: 1,
  owner_name: 'System Administrator',
  created_by: 'admin',
  updated_by: 'admin',
  created_at: now,
  updated_at: now,
  grants: [],
  my_access: 'OWNER',
  column_count: 2,
}
const customReportSummary = Object.fromEntries(
  Object.entries(customReport).filter(([key]) => !['definition', 'grants', 'source_table', 'owner_user_id', 'updated_by', 'created_at'].includes(key))
)
let reportPreviewAttempts = 0

const auditLogs = Array.from({ length: 30 }, (_, i) => ({
  id: i + 1,
  module_name: 'Location Master',
  action: i % 2 ? 'Create' : 'Update',
  entity_type: 'Location',
  entity_id: i + 1,
  record_identifier: `LOC${String(i + 1).padStart(3, '0')}`,
  performed_by: 'admin',
  performed_by_user_id: 1,
  performed_at: now,
  remarks: 'test',
  old_values: null,
  new_values: null,
}))

const assets = [
  {
    id: 1, asset_name: 'Agge Tank 1', asset_code: 'AGGE-TANK-1', asset_scope: 'Local',
    asset_type_code: 'TANK', location_code: 'LOC001', status: 'Active', created_at: now, updated_at: now,
  },
  {
    id: 2, asset_name: 'Barge Ada', asset_code: 'BRG-001', asset_scope: 'Local',
    asset_type_code: 'BARGE', location_code: 'LOC001', status: 'Active', created_at: now, updated_at: now,
  },
]

const calibrationTemplates = [
  {
    id: 1, template_name: 'Tank Strapping', asset_type_code: 'TANK', calibration_type: 'Tank Chart',
    description: '', status: 'Active', created_at: now, updated_at: now,
    columns: [
      { id: 1, column_name: 'Ullage', data_type: 'Number', unit: 'mm', is_required: 'Yes', interpolation_role: 'Input X', sort_order: 1 },
      { id: 2, column_name: 'Volume', data_type: 'Number', unit: 'bbl', is_required: 'Yes', interpolation_role: 'Output', sort_order: 2 },
    ],
  },
]

// The list endpoint is lean (no data rows); the rows live behind the
// per-table endpoints, exactly like the real API.
const calibrationTableRows = [
  { id: 1, row_number: 1, row_data: { Ullage: 0, Volume: 0 } },
  { id: 2, row_number: 2, row_data: { Ullage: 1000, Volume: 850 } },
  { id: 3, row_number: 3, row_data: { Ullage: 2000, Volume: 1720 } },
]
const calibrationTables = [
  {
    id: 1, calibration_name: 'Agge Tank 1 Strapping 2026', asset_code: 'AGGE-TANK-1',
    asset_name: 'Agge Tank 1', template_id: 1, template_name: 'Tank Strapping',
    effective_date: '2026-01-01', remarks: '', status: 'Active',
    created_at: now, updated_at: now,
  },
]

// A non-tank (shuttle) ticket in Submitted status: the review / approve screen
// must show the saved sample values, not only the structured payload modules.
const operationTransactions = [
  {
    id: 1,
    ticket_number: 'SHU-2026-0001',
    operation_ticket_number: 'SHU-2026-0001',
    operation_date: '2026-10-15',
    operation_type_id: 5,
    operation_type_code: 'SHUTTLE',
    operation_type_name: 'Shuttle Operation',
    operation_template_id: 3,
    location_id: 1,
    location_name: 'Agge Terminal',
    location_code: 'LOC001',
    primary_asset_id: 2,
    primary_asset_name: 'Barge Ada',
    primary_asset_code: 'BRG-001',
    primary_asset_type_code: 'BARGE',
    convoy_number: '',
    status: 'Submitted',
    created_by: 'operator1',
    created_at: now,
    updated_at: now,
    field_values: [
      {
        id: 1, field_code: 'obs_api', field_name: 'Observed API', field_label: 'Observed API',
        field_group: 'Sample Parameters', data_type: 'Number', unit: 'API', sort_order: 1,
        field_value: '34.5',
      },
      {
        id: 2, field_code: 'obs_density', field_name: 'Observed Density', field_label: 'Observed Density',
        field_group: 'Sample Parameters', data_type: 'Number', unit: 'kg/m3', sort_order: 2,
        field_value: '825.4',
      },
      {
        id: 3, field_code: 'sample_temp', field_name: 'Sample Temperature', field_label: 'Sample Temperature',
        field_group: 'Sample Parameters', data_type: 'Number', unit: 'C', sort_order: 3,
        field_value: '32.5',
      },
      {
        id: 4, field_code: 'shuttle_payload', field_name: 'Shuttle Payload', field_label: 'Shuttle Payload',
        field_group: 'System', data_type: 'JSON', unit: '', sort_order: 4,
        field_value: JSON.stringify({
          meta: { vessel_operation_label: 'Opening Stock' },
          inputs: {
            event_time: '2026-10-15 08:00',
            opening_stock_bbl: 1000,
            opening_water_bbl: 5,
            closing_stock_bbl: 1200,
            closing_water_bbl: 6,
            barge_reference: 'BRG-001',
            remarks: 'Sample values captured',
          },
          calculated: { net: { net_stock_bbl: 200, net_water_bbl: 1 } },
        }),
      },
    ],
  },
]

const trackingModuleConfigs = [
  {
    id: 1, module_code: 'BARGE', module_label: 'Barge Tracking',
    operation_type_code: 'BARGE_MOVE', operation_type_name: 'Barge Move',
    applicable_asset_type_code: 'BARGE', movement_role: 'SENDER',
    status: 'Active', remarks: 'Barge movement ticket',
    created_by: 'admin', updated_by: 'admin', created_at: now, updated_at: now,
  },
  {
    id: 2, module_code: 'TANKER', module_label: 'Tanker Tracking',
    operation_type_code: 'TANKER_RECEIPT', operation_type_name: 'Tanker Receipt',
    applicable_asset_type_code: 'TANKER', movement_role: 'RECEIVER',
    status: 'Active', remarks: 'Tanker receiving side',
    created_by: 'admin', updated_by: 'admin', created_at: now, updated_at: now,
  },
]

const paged = (items, url) => {
  const u = new URL(url, 'http://x')
  const skip = Number(u.searchParams.get('skip') || 0)
  const limit = Number(u.searchParams.get('limit') || 50)
  return { items: items.slice(skip, skip + limit), total: items.length, skip, limit, has_more: skip + limit < items.length }
}

const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const apiCalls = []
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url
  const method = (init.method || 'GET').toUpperCase()
  const path = url.replace(/^https?:\/\/[^/]+/, '')
  apiCalls.push(`${method} ${path}`)
  if (path.startsWith('/auth/me')) return jsonResponse(me)
  if (path.startsWith('/auth/logout')) return jsonResponse({ ok: true })
  if (path === '/report-builder/catalog' && method === 'GET') {
    return jsonResponse({ datasets: [], tables: [], date_bases: [], formula_help: {}, operator_help: {} })
  }
  if (path === '/report-builder/lookups' && method === 'GET') {
    return jsonResponse({ locations: [], operation_types: [], statuses: [], assets: [], users: [], roles: [] })
  }
  if (path === '/report-builder/operation-fields' && method === 'GET') {
    return jsonResponse({ templates: [], saved_fields: [] })
  }
  if (path === '/report-builder/starter-templates' && method === 'GET') return jsonResponse([])
  if (path === '/report-builder/definitions' && method === 'GET') return jsonResponse([customReportSummary])
  if (path === '/report-builder/definitions/1' && method === 'GET') return jsonResponse(customReport)
  if (path === '/report-builder/run-preview' && method === 'POST') {
    reportPreviewAttempts += 1
    if (reportPreviewAttempts === 1) {
      return jsonResponse({ detail: 'A selected field is temporarily unavailable.' }, 400)
    }
    return jsonResponse({
      columns: customReportDefinition.columns,
      rows: [{ ticket_number: 'TKT-0001', nsv_bbl: 5152.1 }],
      totals: {},
      meta: { total_rows: 1, page: 1, page_size: 25, scanned_rows: 1, filtered_rows: 1, warnings: [], generated_in_ms: 2, date_basis_label: 'Accounting Date', grouped: false },
    })
  }
  if (path === '/report-builder/my-reports' && method === 'GET') return jsonResponse({ data: { reports: [customReportSummary] } })
  if (path === '/report-builder/my-reports/1' && method === 'GET') return jsonResponse({ data: { report: customReport } })
  if (path === '/report-builder/my-reports/1/run' && method === 'POST') {
    // Older/custom deployments can omit `meta`; the viewer must still render
    // the returned columns and rows instead of crashing to a blank route.
    return jsonResponse({
      data: {
        result: {
          columns: customReportDefinition.columns,
          rows: [{ ticket_number: 'TKT-0001', nsv_bbl: 5152.1 }],
          totals: {},
        },
      },
    })
  }
  if (path.startsWith('/users')) {
    if (method === 'POST') {
      const body = JSON.parse(init.body)
      const created = { ...body, id: users.length + 1, created_at: now, updated_at: now }
      users.push(created)
      return jsonResponse(created, 201)
    }
    return jsonResponse(paged(users, path))
  }
  if (path.startsWith('/locations')) {
    if (method === 'POST') {
      const body = JSON.parse(init.body)
      const created = { ...body, id: locations.length + 1, created_at: now, updated_at: now }
      locations.push(created)
      return jsonResponse(created, 201)
    }
    return jsonResponse(paged(locations, path))
  }
  if (path === '/tracking-module-configs/catalog') {
    // No `stages`: the barge stage belongs to the ticket, not to the mapping.
    return jsonResponse({
      modules: [
        { code: 'BARGE', label: 'Barge Tracking' },
        { code: 'TANKER', label: 'Tanker Tracking' },
      ],
      roles: [
        { code: 'SENDER', label: 'Sender (creates the approved ticket that is tracked)' },
        { code: 'RECEIVER', label: 'Receiver (creates a ticket against an approved sender ticket)' },
      ],
      statuses: ['Active', 'Inactive'],
      operation_types: [
        { operation_type_code: 'BARGE_MOVE', operation_type_name: 'Barge Move', applicable_asset_type_code: 'BARGE', status: 'Active', mappings: [{ id: 1, module_code: 'BARGE', movement_role: 'SENDER', status: 'Active' }] },
        { operation_type_code: 'BARGE_UNUSED', operation_type_name: 'Barge Unused', applicable_asset_type_code: 'BARGE', status: 'Active', mappings: [] },
      ],
    })
  }
  if (path.startsWith('/company-report-profiles')) {
    return jsonResponse(reportProfiles)
  }
  if (path.startsWith('/tracking-module-configs')) {
    const idMatch = path.match(/^\/tracking-module-configs\/(\d+)/)
    if (method === 'POST') {
      const body = JSON.parse(init.body)
      const created = { ...body, id: trackingModuleConfigs.length + 1, created_at: now, updated_at: now }
      trackingModuleConfigs.push(created)
      return jsonResponse(created, 201)
    }
    if ((method === 'PUT' || method === 'PATCH') && idMatch) {
      const body = JSON.parse(init.body)
      const index = trackingModuleConfigs.findIndex((row) => String(row.id) === idMatch[1])
      trackingModuleConfigs[index] = { ...trackingModuleConfigs[index], ...body, updated_at: now }
      return jsonResponse(trackingModuleConfigs[index])
    }
    if (method === 'DELETE' && idMatch) {
      return jsonResponse({ message: 'deleted' })
    }
    return jsonResponse(trackingModuleConfigs)
  }
  if (path.startsWith('/assets')) return jsonResponse(paged(assets, path))
  if (path.startsWith('/calibration-templates')) return jsonResponse(calibrationTemplates)
  if (path.startsWith('/asset-calibration-tables')) {
    const rowsMatch = path.match(/^\/asset-calibration-tables\/(\d+)\/rows/)
    if (rowsMatch) {
      const table = calibrationTables.find((t) => String(t.id) === rowsMatch[1])
      return table
        ? jsonResponse({ table_id: table.id, rows: calibrationTableRows })
        : jsonResponse({ detail: 'Asset calibration table not found' }, 404)
    }
    const idMatch = path.match(/^\/asset-calibration-tables\/(\d+)/)
    if (idMatch) {
      const table = calibrationTables.find((t) => String(t.id) === idMatch[1])
      return table
        ? jsonResponse({ ...table, rows: calibrationTableRows })
        : jsonResponse({ detail: 'Asset calibration table not found' }, 404)
    }
    return jsonResponse(
      calibrationTables.map(({ ...table }) => ({ ...table, row_count: calibrationTableRows.length }))
    )
  }
  if (path.startsWith('/role-locations')) {
    const detailMatch = path.match(/^\/role-locations\/(\d+)/)
    const roleLocations = [
      { role_id: 1, role_name: 'Admin', status: 'Active', location_codes: [] },
      { role_id: 2, role_name: 'Operator', status: 'Active', location_codes: ['LOC002'] },
    ]
    if (detailMatch) {
      const match = roleLocations.find((r) => String(r.role_id) === detailMatch[1])
      return match ? jsonResponse(match) : jsonResponse({ detail: 'Role not found' }, 404)
    }
    if (method === 'PUT') {
      const roleId = Number(path.split('/').pop())
      const body = JSON.parse(init.body || '{}')
      const target = roleLocations.find((r) => r.role_id === roleId)
      const updated = {
        role_id: roleId,
        role_name: target?.role_name || 'Role',
        status: 'Active',
        location_codes: body.location_codes || [],
      }
      if (target) Object.assign(target, updated)
      return jsonResponse(updated)
    }
    return jsonResponse(roleLocations)
  }
  /* Tanker Tracking + FSO Tracking: one shared convoy fixture each, so the
     convoy list / trip tabs and the FSO summary tab render with real rows. */
  if (path.startsWith('/tanker-tracking')) {
    const ticket = (extra = {}) => ({
      transaction_id: 1, ticket_number: 'TKT-0001', operation_number: 'OP-0001',
      movement_role: 'SENDER', operation_date: '2026-10-10',
      operation_type_code: 'TANKER_LOADING', operation_type_name: 'Tanker Loading',
      origin_location_code: 'LOC001', origin_location_name: 'Terminal 1',
      destination_location_code: 'LOC002', destination_location_name: 'Terminal 2',
      sender_location_code: 'LOC001', sender_location_name: 'Terminal 1',
      receiver_location_code: 'LOC002', receiver_location_name: 'Terminal 2',
      sender_code: 'LOC001', sender_name: 'Terminal 1',
      receiver_code: 'LOC002', receiver_name: 'Terminal 2',
      primary_asset_code: 'TNK-001', primary_asset_name: 'Tanker Alpha',
      primary_asset_type_code: 'TANKER',
      prime_mover_asset_code: 'PM-001', prime_mover_asset_name: 'Prime Mover 1',
      tanker_asset_code: 'TNK-001', tanker_asset_name: 'Tanker Alpha',
      tanker_chassis_number: 'CHS-001', convoy_number: 'CNV-2026-001',
      product_name: 'Crude Oil', total_dip_cm: 210.5, water_dip_cm: 2.1,
      bsw_percent: 0.5, observed_api: 34.2, api60: 34.5, vcf: 0.9987,
      tov_bbl: 5200, free_water_bbl: 12, gov_bbl: 5188, gsv_bbl: 5178,
      bsw_bbl: 25.9, nsv_bbl: 5152.1, lt: 650, mt: 660,
      seal_c1: 'C1-1001', seal_c2: 'C2-1001', seal_m1: 'M1-1001', seal_m2: 'M2-1001',
      remarks: '', status: 'Approved', created_by: 'admin',
      created_at: now, updated_at: now, ...extra,
    })
    const receiver = ticket({
      transaction_id: 2, ticket_number: 'TKT-0002', operation_number: 'OP-0002',
      movement_role: 'RECEIVER', operation_type_code: 'TANKER_RECEIPT',
      operation_type_name: 'Tanker Receipt', total_dip_cm: 209.8,
      gov_bbl: 5184.2, gsv_bbl: 5174.1, nsv_bbl: 5148.6,
      lt: 649.5, mt: 659.4,
    })
    const groups = [
      {
        group_key: 'CNV-2026-001::TNK-001', convoy_number: 'CNV-2026-001',
        tanker_asset_code: 'TNK-001', tanker_asset_name: 'Tanker Alpha',
        tanker_chassis_number: 'CHS-001', prime_mover_asset_code: 'PM-001',
        prime_mover_asset_name: 'Prime Mover 1', product_name: 'Crude Oil',
        sender_ticket: ticket(), receiver_tickets: [receiver],
        latest_receiver_ticket: receiver,
        acknowledgement_id: 11, acknowledged_by: 'admin', acknowledged_at: now,
        acknowledgement_remarks: 'Arrived', closed_by: null, closed_at: null,
        closure_remarks: null,
        seal_checks: [
          { seal_name: 'C1', sender_value: 'C1-1001', receiver_value: 'C1-1001', status: 'MATCHED' },
          { seal_name: 'C2', sender_value: 'C2-1001', receiver_value: 'C2-1001', status: 'MATCHED' },
        ],
        quantity_comparison: {
          sender_transaction_id: 1, receiver_transaction_id: 2,
          sender_gov_bbl: 5188, receiver_gov_bbl: 5184.2, gov_variance_bbl: -3.8,
          sender_gsv_bbl: 5178, receiver_gsv_bbl: 5174.1, gsv_variance_bbl: -3.9,
          sender_nsv_bbl: 5152.1, receiver_nsv_bbl: 5148.6, nsv_variance_bbl: -3.5,
          nsv_variance_percent: -0.0679, sender_lt: 650, receiver_lt: 649.5,
          lt_variance: -0.5, sender_mt: 660, receiver_mt: 659.4, mt_variance: -0.6,
        },
        tracking_status: 'MATCHED', warning_messages: [],
      },
      {
        group_key: 'CNV-2026-002::TNK-002', convoy_number: 'CNV-2026-002',
        tanker_asset_code: 'TNK-002', tanker_asset_name: 'Tanker Bravo',
        tanker_chassis_number: 'CHS-002', prime_mover_asset_code: 'PM-002',
        prime_mover_asset_name: 'Prime Mover 2', product_name: 'Crude Oil',
        sender_ticket: ticket({ transaction_id: 3, ticket_number: 'TKT-0003', convoy_number: 'CNV-2026-002', tanker_asset_code: 'TNK-002', tanker_asset_name: 'Tanker Bravo' }),
        receiver_tickets: [], latest_receiver_ticket: null,
        acknowledgement_id: 12, acknowledged_by: 'admin', acknowledged_at: now,
        acknowledgement_remarks: '', closed_by: 'admin', closed_at: now,
        closure_remarks: 'Settled', seal_checks: [], quantity_comparison: null,
        tracking_status: 'CLOSED', warning_messages: [],
      },
    ]
    return jsonResponse({
      rows: groups,
      total_groups: groups.length,
      pending_receipts: 0,
      received_groups: 0,
      compared_groups: 1,
      seal_mismatch_groups: 0,
      quantity_variance_groups: 0,
    })
  }

  if (path.startsWith('/shuttle-fso/fso-tracking')) {
    const tab = new URL(url, 'http://x').searchParams.get('tab') || 'OPEN'
    const fsoTicket = (extra = {}) => ({
      transaction_id: 101, ticket_number: 'FSO-2026-0101', operation_number: 'OP-0101',
      location_code: 'LOC001', location_name: 'Terminal 1', shuttle_number: 'SH100',
      fso_asset_code: 'FSO-001', fso_asset_name: 'FSO Unity', product_name: 'Crude Oil',
      operation_date: '2026-10-12', event_time: '06:30', operation_label: 'Receipt',
      vessel_name: 'Shuttle Delta', vessel_quantity_bbl: 12000,
      opening_stock_bbl: 150000, opening_water_bbl: 400,
      closing_stock_bbl: 162000, closing_water_bbl: 400,
      net_stock_bbl: 12000, net_water_bbl: 0, variance_bbl: 0,
      remarks: '', status: 'Approved', created_by: 'admin',
      created_at: now, updated_at: now, ...extra,
    })
    const base = {
      location_code: 'LOC001', location_name: 'Terminal 1', shuttle_number: 'SH100',
      fso_asset_code: 'FSO-001', fso_asset_name: 'FSO Unity',
      total_receipts_bbl: 12000, total_exports_bbl: 9500, total_water_in_bbl: 0,
      total_water_out_bbl: 0, net_water_bbl: 0, loss_gain_bbl: 0,
      total_variance_bbl: 0, shuttle_discharge_bbl: 12000, fso_receipt_bbl: 12000,
      variance_bbl: 0,
    }
    const openGroup = {
      ...base,
      group_key: 'LOC001|SH100|FSO-001', voyage_status: 'OPEN',
      closed_by: null, closed_at: null, closure_remarks: null,
      tickets: [
        fsoTicket(),
        fsoTicket({
          transaction_id: 102, ticket_number: 'FSO-2026-0102', operation_number: 'OP-0102',
          operation_date: '2026-10-13', operation_label: 'Export', vessel_name: 'MT Bonny',
          vessel_quantity_bbl: 0, opening_stock_bbl: 162000, closing_stock_bbl: 152500,
          net_stock_bbl: -9500,
        }),
      ],
    }
    const closedGroup = {
      ...base,
      group_key: 'LOC001|SH099|FSO-001', shuttle_number: 'SH099', voyage_status: 'CLOSED',
      closed_by: 'admin', closed_at: now, closure_remarks: 'Settled',
      tickets: [fsoTicket({ transaction_id: 103, ticket_number: 'FSO-2026-0099', shuttle_number: 'SH099', operation_date: '2026-09-29' })],
    }
    const rows = tab.toUpperCase() === 'CLOSED' ? [closedGroup] : [openGroup]
    return jsonResponse({ rows, total_groups: rows.length, page: 1, page_size: 200, has_more: false })
  }

  if (path.startsWith('/operation-transactions')) {
    const historyMatch = path.match(/^\/operation-transactions\/(\d+)\/status-history/)
    if (historyMatch) return jsonResponse([])
    const correctionMatch = path.match(/^\/operation-transactions\/(\d+)\/correction-requests/)
    if (correctionMatch) return jsonResponse([])
    const statusMatch = path.match(/^\/operation-transactions\/(\d+)\/status$/)
    if (statusMatch) {
      const target = operationTransactions.find((t) => String(t.id) === statusMatch[1])
      const body = JSON.parse(init.body || '{}')
      if (target) target.status = body.status || target.status
      return jsonResponse(target || {})
    }
    const detailMatch = path.match(/^\/operation-transactions\/(\d+)$/)
    if (detailMatch) {
      const target = operationTransactions.find((t) => String(t.id) === detailMatch[1])
      return target ? jsonResponse(target) : jsonResponse({ detail: 'Operation transaction not found' }, 404)
    }
    return jsonResponse(paged(operationTransactions, path))
  }
  if (path.startsWith('/operation-workflow-policies')) return jsonResponse({ allowed: true, reason: '', matched_policy_name: '' })
  if (path.startsWith('/audit-logs')) return jsonResponse(paged(auditLogs, path))
  if (path.startsWith('/system-notifications/active')) return jsonResponse([])
  if (path.startsWith('/system-notifications/my')) return jsonResponse([])
  if (path.startsWith('/user-locations')) {
    // User 2 holds two locations, User 3 one and has All Locations Access.
    const allAccessMatch = path.match(/^\/user-locations\/(\d+)\/all-locations-access$/)
    if (allAccessMatch && method === 'PUT') {
      return jsonResponse({
        user_id: Number(allAccessMatch[1]),
        full_name: 'User 2',
        username: 'user2',
        all_locations_access: JSON.parse(init.body || '{}').all_locations_access || 'No',
        location_codes: ['LOC002', 'LOC003'],
      })
    }
    const userMatch = path.match(/^\/user-locations\/(\d+)$/)
    if (userMatch && method === 'PUT') {
      return jsonResponse({
        user_id: Number(userMatch[1]),
        full_name: 'User 2',
        username: 'user2',
        all_locations_access: 'No',
        location_codes: JSON.parse(init.body || '{}').location_codes || [],
      })
    }
    if (path === '/user-locations/users') {
      return jsonResponse([
        { user_id: 2, full_name: 'User 2', username: 'user2', all_locations_access: 'No', location_codes: ['LOC002', 'LOC003'] },
        { user_id: 3, full_name: 'User 3', username: 'user3', all_locations_access: 'Yes', location_codes: ['LOC004'] },
      ])
    }
    return jsonResponse([
      { id: 1, user_id: 2, full_name: 'User 2', username: 'user2', location_code: 'LOC002', location_name: 'Terminal 2', created_at: now },
      { id: 2, user_id: 2, full_name: 'User 2', username: 'user2', location_code: 'LOC003', location_name: 'Terminal 3', created_at: now },
      { id: 3, user_id: 3, full_name: 'User 3', username: 'user3', location_code: 'LOC004', location_name: 'Terminal 4', created_at: now },
    ])
  }
  if (path.startsWith('/roles')) return jsonResponse(paged([{ id: 1, role_name: 'Admin', description: 'Administrator', status: 'Active', created_at: now, updated_at: now }], path))
  if (path.startsWith('/permissions')) return jsonResponse(paged(me.permissions.map((p) => ({ ...p, description: '', created_at: now, updated_at: now })), path))
  // generic fallbacks
  if (method === 'GET') {
    return jsonResponse(path.includes('summary') || path.includes('config') ? {} : [])
  }
  return jsonResponse({})
}

/* --------------------------------------------------------------- render */
const { createServer } = await import('vite')
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

const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '')
const q = (sel) => document.querySelector(sel)
const qa = (sel) => Array.from(document.querySelectorAll(sel))
const click = (el) => {
  if (!el) throw new Error('click target missing')
  el.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }))
  el.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }))
  el.click()
}
const setValue = (el, value) => {
  const proto = el.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
  setter.call(el, value)
  el.dispatchEvent(new window.Event('input', { bubbles: true }))
  el.dispatchEvent(new window.Event('change', { bubbles: true }))
}

const checks = []
const check = (name, ok, extra = '') => {
  checks.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`)
}

try {
  window.localStorage.setItem('hydrocarbonAccessToken', 'smoke-token')
  const root = document.createElement('div')
  root.id = 'root'
  document.body.appendChild(root)

  const React = (await import('react')).default
  const { createRoot } = await import('react-dom/client')
  const { default: App } = await server.ssrLoadModule('/src/App.jsx')
  const { ThemeProvider } = await server.ssrLoadModule('/src/theme/ThemeProvider.jsx')
  const { ToastProvider } = await server.ssrLoadModule('/src/components/common/Toast.jsx')
  const { ConfirmProvider } = await server.ssrLoadModule('/src/components/common/ConfirmProvider.jsx')

  const reactRoot = createRoot(root)
  reactRoot.render(
    React.createElement(
      ThemeProvider,
      null,
      React.createElement(ToastProvider, null, React.createElement(ConfirmProvider, null, React.createElement(App)))
    )
  )
  await flush(150)

  check('app shell rendered', Boolean(q('.app-shell')))
  check('top navigation rendered', qa('.top-nav-button').length > 3, `(${qa('.top-nav-button').length} groups)`)
  check('user menu rendered', Boolean(q('.user-menu-button')), text(q('.user-menu-button')))
  check('legacy navbar gone', !q('.navbar'))
  check('home tiles rendered', qa('.dashboard-tile').length > 5, `(${qa('.dashboard-tile').length} tiles)`)

  // Open a nav dropdown
  const navButton = qa('.top-nav-button')[0]
  click(navButton)
  await flush()
  check('dropdown opens on click', Boolean(q('.top-nav-menu')), text(q('.top-nav-menu')).slice(0, 80))
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await flush()
  check('dropdown closes on Escape', !q('.top-nav-menu'))

  // Theme switching
  click(q('.user-menu-button'))
  await flush()
  check('user menu opens', Boolean(q('.user-menu-popover')))
  const darkOption = qa('.theme-switcher-option').find((b) => text(b) === 'Dark')
  click(darkOption)
  await flush()
  check('dark theme applied', document.documentElement.getAttribute('data-theme') === 'dark')
  const lightOption = qa('.theme-switcher-option').find((b) => text(b) === 'Light')
  click(lightOption)
  await flush()
  check('light theme applied', document.documentElement.getAttribute('data-theme') === 'light')
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await flush()

  // Navigate to pages requested on the CLI (default set)
  const pages = process.argv.slice(2).length ? process.argv.slice(2) : ['/locations', '/users', '/role-locations', '/audit-logs', '/operation-transactions/1', '/tracking-module-configuration', '/operation-entry']
  for (const path of pages) {
    const before = errors.length
    const link = qa('a[href]').find((a) => a.getAttribute('href') === path)
    if (link) {
      click(link)
    } else {
      // open the dropdown containing it
      let found = false
      for (const button of qa('.top-nav-button')) {
        click(button)
        await flush(30)
        const item = qa('.top-nav-menu a').find((a) => a.getAttribute('href') === path)
        if (item) {
          click(item)
          found = true
          break
        }
      }
      if (!found) {
        window.history.pushState({}, '', path)
        window.dispatchEvent(new window.PopStateEvent('popstate'))
      }
    }
    await flush(200)
    const title = text(q('.main-content h2'))
    check(`page ${path} renders`, window.location.pathname === path && Boolean(title), `title="${title}" errors=${errors.length - before}`)
    if (q('.pagination-controls')) {
      console.log('      pagination:', text(q('.pagination-summary')))
    }
    if (q('.data-filter-bar')) {
      console.log('      filter bar present; records:', text(q('.data-filter-summary')))
    }
    if (process.env.DUMP) {
      console.log(document.querySelector('.main-content').innerHTML.slice(0, Number(process.env.DUMP)))
    }

    if (path === '/report-builder') {
      const designButton = qa('.main-content button').find((button) => text(button).includes('Design'))
      check('report builder lists the published report', Boolean(designButton), text(q('.main-content')).slice(0, 140))
      if (designButton) {
        click(designButton)
        await flush(150)
        const previewTab = qa('[role="tab"]').find((button) => text(button).includes('Preview & Save'))
        click(previewTab)
        await flush(80)
        const previewButton = qa('.main-content button').find((button) => text(button).includes('Run preview'))
        click(previewButton)
        await flush(150)
        check(
          'report preview shows a failed-run message',
          text(q('.alert-message')).includes('Preview could not run')
        )
        click(q('.alert-message-dismiss'))
        await flush(60)
        check(
          'report preview error closes completely',
          !text(q('.main-content')).includes('Preview could not run')
        )
        click(previewButton)
        await flush(150)
        check(
          'successful report preview keeps the old error cleared',
          !text(q('.main-content')).includes('Preview could not run')
            && text(q('.main-content')).includes('TKT-0001')
        )
      }
    }

    if (path === '/reporting/custom-reports') {
      check(
        'custom reports list renders reports from a wrapped API response',
        text(q('.main-content')).includes('Published Tank Quantities')
          && text(q('.main-content')).includes('Open report'),
        text(q('.main-content')).slice(0, 220)
      )
    }

    if (path === '/reporting/custom-reports/1') {
      const customReportPage = q('.custom-report-page')
      check(
        'published custom report uses a visible screen container',
        Boolean(customReportPage)
          && !customReportPage.classList.contains('printable-report')
          && Boolean(q('.custom-report-page > .custom-report-print.printable-report')),
        customReportPage ? customReportPage.className : 'page missing'
      )
      check(
        'published custom report renders rows without result metadata',
        text(q('.main-content')).includes('Published Tank Quantities')
          && text(q('.main-content')).includes('TKT-0001')
          && text(q('.main-content')).includes('5,152.100'),
        text(q('.main-content')).slice(0, 220)
      )
    }

    if (path === '/locations') {
      // Filter bar interactions
      const search = q('.data-filter-search input')
      setValue(search, 'Depot')
      await flush(120)
      check('quick search filters rows', text(q('.data-filter-summary')).startsWith('Showing'), text(q('.data-filter-summary')))
      console.log('      pagination after search:', text(q('.pagination-summary')))
      setValue(search, '')
      await flush(120)

      click(qa('.filter-toggle').find((b) => text(b).includes('Advanced')))
      await flush()
      click(qa('.data-filter-panel-footer button')[0])
      await flush()
      const condition = q('.filter-condition')
      check('advanced condition row added', Boolean(condition))
      const [fieldSel, opSel] = condition.querySelectorAll('select')
      setValue(fieldSel, 'status')
      await flush()
      const valueControl = condition.querySelector('.filter-condition-value select, .filter-condition-value input')
      setValue(valueControl, 'Inactive')
      await flush(120)
      check('advanced filter applied', text(q('.data-filter-summary')).includes('1 filter'), text(q('.data-filter-summary')))
      click(q('.filter-clear'))
      await flush(120)
      check('clear all resets filters', !text(q('.data-filter-summary')).includes('filter'), text(q('.data-filter-summary')))

      click(qa('.filter-toggle').find((b) => text(b).includes('Date')))
      await flush()
      check('date filter panel has separate date and range groups', qa('.date-filter-group').length === 2)

      // Page size change
      const sizeSelect = q('.pagination-page-size select')
      setValue(sizeSelect, '50')
      await flush(120)
      check('page size 50 applied', text(q('.pagination-summary')).includes('1–43') || text(q('.pagination-summary')).includes('of 43'), text(q('.pagination-summary')))
      console.log('      table rows rendered:', qa('.main-content tbody tr').length)
      setValue(sizeSelect, '20')
      await flush(120)

      // Export menu
      click(q('.export-menu-button'))
      await flush()
      check('export menu lists xlsx/csv/pdf', qa('.export-menu-item').length === 3)
      let before = errors.length
      click(qa('.export-menu-item').find((b) => text(b).includes('CSV')))
      await flush(300)
      check('csv export runs without error', errors.length === before, text(q('.toast')))
      click(q('.export-menu-button'))
      await flush()
      click(qa('.export-menu-item').find((b) => text(b).includes('Excel')))
      await flush(600)
      check('xlsx export runs without error', errors.length === before, text(q('.toast')))
      click(q('.export-menu-button'))
      await flush()
      click(qa('.export-menu-item').find((b) => text(b).includes('PDF')))
      await flush(800)
      for (let i = 0; i < 20 && !qa('.toast').some((el) => text(el).includes('PDF')); i += 1) await flush(200)
      check('pdf export runs without error', errors.length === before && !q('.toast.tone-error'), qa('.toast').map(text).join(' | '))

      // Import dialog: opens from the toolbar, ignores backdrop clicks, closes on Cancel only.
      const importButton = qa('.data-filter-bar button, .data-filter-actions button').find((b) => text(b).trim() === 'Bulk Upload')
      check('bulk upload button present', Boolean(importButton))
      if (importButton) {
        click(importButton)
        await flush()
        check('import dialog opens', Boolean(q('.import-dialog')), text(q('.import-dialog .app-modal-title, .import-dialog h2')).slice(0, 60))
        check('import dialog lists required fields', qa('.import-dialog .import-fields em').length >= 1, `${qa('.import-dialog .import-fields em').length} required`)
        click(q('.app-modal-backdrop'))
        await flush()
        check('import dialog ignores backdrop click', Boolean(q('.import-dialog')))
        check('import dialog shows the layered template picker', Boolean(q('.import-dialog .import-template-bar select')), text(q('.import-dialog .import-template-select')).slice(0, 60))
        const templateButtons = qa('.import-dialog .import-template-downloads button')
        check('import dialog offers xlsx and csv templates', templateButtons.length === 2, templateButtons.map(text).join(' | '))

        before = errors.length
        click(templateButtons.find((b) => text(b).includes('XLSX')))
        await flush(600)
        check('xlsx template download runs without error', errors.length === before, downloads.slice(-1).join(''))

        before = errors.length
        click(templateButtons.find((b) => text(b).includes('CSV')))
        await flush(400)
        check('csv template download runs without error', errors.length === before, downloads.slice(-1).join(''))
        click(qa('.import-dialog button').find((b) => text(b).trim() === 'Cancel'))
        await flush()
        check('import dialog closes on Cancel', !q('.import-dialog'))
      }
    }

    if (path === '/operation-entry') {
      // Clubbed Sender / Receiver dropdowns: two location selects replace the
      // old Origin / Sender / Destination / Receiver quartet, and the
      // operation date is no longer typed in the metadata (it is derived from
      // the date captured inside the data-entry payload).
      check('sender dropdown rendered', Boolean(q('.main-content select[name="senderLocationCode"]')))
      check('receiver dropdown rendered', Boolean(q('.main-content select[name="receiverLocationCode"]')))
      check(
        'separate origin / destination dropdowns are gone',
        !q('.main-content select[name="originLocationCode"]') &&
          !q('.main-content select[name="destinationLocationCode"]'),
      )
      check(
        'operation date / start / end inputs are gone from the metadata',
        !q('.main-content input[name="operationDate"]') &&
          !q('.main-content input[name="operationStartDatetime"]') &&
          !q('.main-content input[name="operationEndDatetime"]'),
      )

      const senderSelect = q('.main-content select[name="senderLocationCode"]')
      const firstCode = Array.from(senderSelect.options)
        .map((o) => o.value)
        .find((v) => v !== '')
      setValue(senderSelect, firstCode || '')
      await flush(120)
      check(
        'sender dropdown holds the chosen location',
        q('.main-content select[name="senderLocationCode"]').value === (firstCode || ''),
        firstCode || '(no locations in the mock)',
      )
    }

    if (path === '/user-locations') {
      // The location scope panel is shared with /role-locations: dense rows of
      // [checkbox · name · code], sorted by name, with a live selection count.
      const scope = q('.main-content .location-scope')
      check('location scope panel rendered', Boolean(scope))

      const optionRows = qa('.main-content .location-option')
      const countText = text(q('.main-content .location-scope-count'))
      const totalShown = Number((countText.match(/of\s+(\d+)/) || [])[1] || 0)
      check(
        'location scope lists every active location',
        optionRows.length > 0 && optionRows.length === totalShown,
        `${optionRows.length} rows, count "${countText}"`
      )

      const names = optionRows.map((row) => text(row.querySelector('.location-option-name')))
      const sortedNames = [...names].sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
      )
      check('location rows are sorted by name', names.join('|') === sortedNames.join('|'), names.slice(0, 3).join(', '))
      check(
        'every location row has checkbox, name and code columns',
        optionRows.length > 0 &&
          optionRows.every(
            (row) =>
              row.children.length === 3 &&
              row.querySelector("input[type='checkbox']") &&
              text(row.querySelector('.location-option-name')) !== '' &&
              text(row.querySelector('.location-option-code')) !== ''
          )
      )

      const firstBox = optionRows[0]?.querySelector("input[type='checkbox']")
      if (firstBox) {
        click(firstBox)
        await flush(120)
        check(
          'selecting a location updates the count',
          text(q('.main-content .location-scope-count')).startsWith('1 of '),
          text(q('.main-content .location-scope-count'))
        )
        const clearButton = qa('.main-content .location-scope-clear')[0]
        click(clearButton)
        await flush(120)
        check(
          'clear all resets the selection',
          text(q('.main-content .location-scope-count')).startsWith('0 of '),
          text(q('.main-content .location-scope-count'))
        )
      }

      // One-to-many table: a user's rows share one merged User / All Locations cell.
      const assignmentRows = qa('.main-content table tbody tr')
      check('user location rows are listed', assignmentRows.length === 3, `${assignmentRows.length} rows`)
      const firstUserCell = assignmentRows[0]?.querySelector('td')
      check(
        'user cell is merged across that user’s location rows',
        firstUserCell?.getAttribute('rowspan') === '2' && text(firstUserCell).includes('User 2'),
        `rowspan=${firstUserCell?.getAttribute('rowspan')} cell="${text(firstUserCell)}"`
      )
      check(
        'continuation row does not repeat the user cell',
        assignmentRows[1]?.querySelectorAll('td').length === 2,
        `${assignmentRows[1]?.querySelectorAll('td').length} cells`
      )
      check(
        'all-locations access renders as a status chip',
        Boolean(assignmentRows[2]?.querySelector('.status-badge.approved')),
        text(assignmentRows[2]).slice(0, 60)
      )

      // Edit prefill + save round trip from the new panel.
      setValue(q('.main-content #user-location-user'), '2')
      await flush(150)
      const prefilled = qa('.main-content .location-option input').filter((input) => input.checked)
      check('selecting a user prefills the saved scope', prefilled.length === 2, `${prefilled.length} checked`)

      const boxes = qa('.main-content .location-option input')
      click(boxes[2])
      await flush(120)
      check(
        'checkbox clicks update the live count',
        text(q('.main-content .location-scope-count')).startsWith('3 of '),
        text(q('.main-content .location-scope-count'))
      )

      const saveAssignment = qa('.main-content button').find((b) => text(b).includes('Save Assignment'))
      check('save assignment button present', Boolean(saveAssignment))
      if (saveAssignment) {
        const beforeSave = errors.length
        click(saveAssignment)
        await flush(300)
        check(
          'save calls the user-location endpoints',
          apiCalls.includes('PUT /user-locations/2') && apiCalls.includes('PUT /user-locations/2/all-locations-access'),
          apiCalls.filter((call) => call.includes('/user-locations')).join(', ')
        )
        check(
          'save reports success without a runtime error',
          errors.length === beforeSave && !q('.toast.tone-error'),
          qa('.toast').map(text).join(' | ')
        )
        check(
          'the panel resets after a successful save',
          text(q('.main-content .location-scope-count')).startsWith('0 of '),
          text(q('.main-content .location-scope-count'))
        )
      }
    }

    if (path === '/role-locations') {
      const roleTable = qa('.main-content table').find((t) =>
        text(t.querySelector('thead')).includes('Locations')
      )
      const rows = roleTable ? Array.from(roleTable.querySelectorAll('tbody tr')) : []
      check('role location scopes listed', rows.length >= 2, rows.length ? text(rows[0]).slice(0, 80) : 'no table found')
      check(
        'role locations shown per role',
        rows.some((row) => text(row).includes('Operator') && text(row).includes('LOC002')),
        rows.map(text).join(' | ').slice(0, 140)
      )

      const operatorRow = rows.find((row) => text(row).includes('Operator'))
      const editButton = operatorRow
        ? Array.from(operatorRow.querySelectorAll('button')).find((b) => text(b).trim() === 'Edit')
        : null
      check('role location row has an Edit button', Boolean(editButton))

      if (editButton) {
        click(editButton)
        await flush(120)
        const checkedBoxes = qa('.main-content .location-option input').filter((input) => input.checked)
        check('edit prefills the role locations', checkedBoxes.length === 1, `${checkedBoxes.length} checked`)

        const saveButton = qa('.main-content button').find((b) => text(b).includes('Save Role Locations'))
        check('role location save button present', Boolean(saveButton))

        if (saveButton) {
          const before = errors.length
          click(saveButton)
          await flush(200)
          check('role location save calls the API', apiCalls.includes('PUT /role-locations/2'), apiCalls.filter((c) => c.includes('role-locations')).join(', '))
          check('role location save runs without error', errors.length === before && !q('.toast.tone-error'), qa('.toast').map(text).join(' | '))
        }
      }
    }

    if (path === '/operation-transactions/1') {
      // Owner change 2026-10-16: review / approve must show the saved values for
      // EVERY operation module - this ticket is a shuttle (non-tank) module.
      const reviewGrid = q('.saved-values-review')
      check('review screen shows the saved values grid', Boolean(reviewGrid), text(q('.main-content h3')).slice(0, 60))
      check(
        'review screen lists the saved sample values',
        text(reviewGrid).includes('Observed API') && text(reviewGrid).includes('34.5') && text(reviewGrid).includes('Observed Density') && text(reviewGrid).includes('825.4'),
        text(reviewGrid).slice(0, 160)
      )
      check(
        'review screen hides the raw payload field',
        !text(reviewGrid).includes('shuttle_payload') && !text(reviewGrid).includes('Structured payload'),
        text(reviewGrid).slice(0, 160)
      )

      const approveButton = qa('.main-content button').find((b) => text(b).includes('Review & Approve'))
      check('review & approve button present for a submitted ticket', Boolean(approveButton))

      if (approveButton) {
        const before = errors.length
        click(approveButton)
        await flush(150)
        const modal = q('.review-modal-backdrop')
        check('approve confirmation modal opens', Boolean(modal), text(q('.review-modal-backdrop h3, .review-modal-backdrop h2')).slice(0, 80))
        if (modal) {
          check(
            'approve confirmation shows the saved values',
            text(modal).includes('Observed API') && text(modal).includes('34.5'),
            text(modal).slice(0, 200)
          )
          check(
            'approve confirmation hides the raw payload field',
            !text(modal).includes('shuttle_payload') && !text(modal).includes('Structured payload')
          )
        }
        check('opening the confirmation modal does not error', errors.length === before)
      }
    }

    if (path === '/tracking-module-configuration') {
      // Regression guard (owner change 2026-10-16): Barge Tracking maps the
      // operation type only - the barge stage lives on the ticket, so the
      // configuration form must not ask for a stage any more.
      const mappingsTable = qa('.main-content table').find((t) =>
        text(t.querySelector('thead')).includes('Movement Role')
      )
      const mappingRows = mappingsTable ? Array.from(mappingsTable.querySelectorAll('tbody tr')) : []
      check(
        'tracking module configuration lists the barge mapping',
        mappingRows.length >= 1 && text(mappingRows[0]).includes('BARGE_MOVE'),
        mappingRows.length ? text(mappingRows[0]).slice(0, 90) : 'no mappings table'
      )
      check('tracking module table has no Stage column', Boolean(mappingsTable) && !text(mappingsTable.querySelector('thead')).includes('Stage'))

      const newMappingButton = qa('.main-content button').find((b) => text(b).includes('New Mapping'))
      check('tracking module configuration has a New Mapping button', Boolean(newMappingButton))
      if (newMappingButton) {
        click(newMappingButton)
        await flush(150)
        const dialog = q('.app-modal')
        check('tracking mapping dialog opens', Boolean(dialog))
        if (dialog) {
          const labels = qa('.app-modal-body label').map((l) => text(l))
          check('tracking mapping dialog has no Barge Stage field', !labels.some((l) => l.includes('Stage')), labels.join(' | '))
          check(
            'tracking mapping dialog offers the operation type and the role',
            labels.includes('Operation Type') && labels.includes('Movement Role'),
            labels.join(' | ')
          )
          click(q('.app-modal-close') || qa('.app-modal-footer button')[0])
          await flush(120)
        }
      }
    }

    if (path === '/tanker-tracking') {
      // Open / Closed trip tabs, convoy list, then the convoy detail.
      const tabs = qa('.list-tab').map((b) => text(b))
      check('tanker tracking has open/closed trip tabs', tabs.length === 2, tabs.join(' | '))

      const rows = qa('.main-content tbody tr')
      check('tanker tracking lists convoys', rows.length >= 1, `${rows.length} row(s)`)
      check(
        'tanker convoy row shows the convoy number',
        text(q('.main-content tbody tr')).includes('CNV-2026-001'),
        text(q('.main-content tbody tr')).slice(0, 90)
      )

      // Closed tab holds the closed convoy.
      const closedTab = qa('.list-tab').find((b) => text(b).includes('Closed'))
      click(closedTab)
      await flush(150)
      check(
        'closed tab lists the closed convoy only',
        text(q('.main-content tbody')).includes('CNV-2026-002')
          && !text(q('.main-content tbody')).includes('CNV-2026-001'),
        text(q('.main-content tbody tr')).slice(0, 90)
      )

      const openTab = qa('.list-tab').find((b) => text(b).includes('Open'))
      click(openTab)
      await flush(150)

      // Open the convoy detail (print comparison lives there).
      const viewButton = qa('.main-content tbody button').find((b) => text(b) === 'View')
      click(viewButton)
      await flush(200)
      check('convoy detail opens', Boolean(q('.modal, .modal-dialog, [role="dialog"]')))
      const convoyDetail = q('.app-modal-body')
      check(
        'convoy detail keeps each tanker compact',
        Boolean(convoyDetail)
          && text(convoyDetail).includes('Sender Ticket')
          && text(convoyDetail).includes('Latest Receiver Ticket')
          && !text(convoyDetail).includes('Seal Cross-check')
          && !text(convoyDetail).includes('Total Dip'),
        convoyDetail ? text(convoyDetail).slice(0, 180) : ''
      )
      const printButton = qa('button').find((b) => text(b) === 'Print Convoy Comparison')
      check('convoy comparison print action is present', Boolean(printButton))

      if (printButton) {
        const printCallsBefore = printCalls.length
        click(printButton)
        await flush(100)

        // Every Print button must first ask for the company report profile.
        // Nothing may be sent to the printer before a profile is confirmed.
        const profileDialog = q('.print-profile-dialog')
        check('print action prompts for a company report profile', Boolean(profileDialog))
        check(
          'no print job starts before a profile is chosen',
          printCalls.length === printCallsBefore,
          `${printCalls.length - printCallsBefore} print call(s)`
        )

        const profileSelect = q('#print-profile-select')
        const profileOptions = qa('#print-profile-select option')
        check(
          'print dialog lists every company report profile from the master',
          Boolean(profileSelect)
            && profileOptions.length === reportProfiles.length
            && text(profileSelect).includes('Default Report Profile')
            && text(profileSelect).includes('Second Company Profile'),
          profileOptions.map(text).join(' | ')
        )

        // Choose the second profile: the printed header must use it, not the
        // first/default one.
        if (profileSelect) setValue(profileSelect, '2')
        await flush(60)
        check(
          'selected profile is previewed in the print dialog',
          text(q('.print-profile-preview')).includes('Beta Energy Ltd'),
          text(q('.print-profile-preview')).slice(0, 90)
        )

        const confirmPrint = qa('.print-profile-dialog button').find((b) => text(b) === 'Print Report')
        check('print dialog has a Print Report action', Boolean(confirmPrint))
        if (confirmPrint) click(confirmPrint)
        await flush(150)

        check(
          'print starts only after the profile is confirmed',
          printCalls.length === printCallsBefore + 1,
          `${printCalls.length - printCallsBefore} print call(s)`
        )

        const report = q('.tanker-convoy-mtr-report')
        check('convoy comparison report renders', Boolean(report))
        check(
          'printed report carries the selected company report profile',
          Boolean(report)
            && text(report).includes('Beta Energy Ltd')
            && !text(report).includes('Acme Petroleum Ltd'),
          report ? text(report).slice(0, 120) : ''
        )
        check(
          'convoy comparison report names the tanker and its tickets',
          Boolean(report)
            && text(report).includes('Tanker Alpha (TNK-001)')
            && text(report).includes('TKT-0001')
            && text(report).includes('TKT-0002'),
          report ? text(report).slice(0, 140) : ''
        )
        check(
          'convoy comparison report has quantity totals',
          Boolean(report) && text(report).includes('Convoy Quantity Totals')
        )
        check(
          'convoy comparison report prints sender and receiver quantities',
          Boolean(report)
            && text(report).includes('5,188.000')
            && text(report).includes('5,184.200'),
          report ? text(report).slice(0, 260) : ''
        )
        const closeReport = qa('button').find((b) => text(b).includes('Close Report'))
        if (closeReport) click(closeReport)
        await flush(100)
      }
    }

    if (path === '/fso-tracking') {
      // Summary is the landing tab: every FSO ticket with its status.
      const heading = text(q('.main-content h3'))
      check('fso tracking opens on the summary tab', heading.includes('Summary'), heading)

      check(
        'fso summary loads open and closed voyages',
        apiCalls.some((c) => c.includes('/shuttle-fso/fso-tracking?tab=OPEN'))
          && apiCalls.some((c) => c.includes('/shuttle-fso/fso-tracking?tab=CLOSED'))
      )

      const bodyText = text(q('.main-content'))
      check('fso summary lists tickets', bodyText.includes('FSO-2026-0101'), bodyText.slice(0, 90))
      check('fso summary shows ticket status', bodyText.includes('Approved'))
      check('fso summary shows voyage status', /Open|Closed/.test(bodyText))
      check('fso summary has pagination and filters', Boolean(q('.data-filter-bar')) && Boolean(q('.main-content table')))

      // Owner rule: every Print button asks for the company report profile
      // first. The FSO Print button only renders on the OTR / MB / OUTTURN
      // report tabs, never on the Summary tab.
      const summaryPrint = qa('.main-content button').find((b) => text(b) === 'Print')
      check('fso summary tab has no Print button', !summaryPrint)

      const otrTab = qa('.main-content button').find((b) => text(b) === 'OTR')
      check('fso report tabs include OTR', Boolean(otrTab))

      if (otrTab) {
        click(otrTab)
        await flush(150)

        const printButton = qa('.main-content button').find((b) => text(b) === 'Print')
        check('fso OTR tab has a Print button', Boolean(printButton))

        if (printButton) {
          const printCallsBefore = printCalls.length
          click(printButton)
          await flush(100)

          check(
            'fso print action prompts for a company report profile',
            Boolean(q('.print-profile-dialog'))
          )
          check(
            'fso print does not start before a profile is chosen',
            printCalls.length === printCallsBefore,
            `${printCalls.length - printCallsBefore} print call(s)`
          )
          check(
            'fso print dialog lists every company report profile from the master',
            qa('#print-profile-select option').length === reportProfiles.length,
            `${qa('#print-profile-select option').length} option(s)`
          )

          const profileSelect = q('#print-profile-select')
          if (profileSelect) setValue(profileSelect, '2')
          await flush(60)
          check(
            'fso print dialog previews the selected profile',
            text(q('.print-profile-preview')).includes('Beta Energy Ltd'),
            text(q('.print-profile-preview')).slice(0, 90)
          )

          const confirmPrint = qa('.print-profile-dialog button').find((b) => text(b) === 'Print Report')
          if (confirmPrint) click(confirmPrint)
          await flush(200)

          check(
            'fso print starts only after the profile is confirmed',
            printCalls.length === printCallsBefore + 1,
            `${printCalls.length - printCallsBefore} print call(s)`
          )

          const printedReport = q('.mtr-page')
          check(
            'fso printed report carries the selected company report profile',
            Boolean(printedReport)
              && text(printedReport).includes('Beta Energy Ltd')
              && !text(printedReport).includes('Acme Petroleum Ltd'),
            printedReport ? text(printedReport).slice(0, 120) : ''
          )
        }
      }
    }

    if (path === '/barge-seal-master') {
      // The tank list is derived from calibration, which is fetched per table.
      const assetSelect = q('.main-content select')
      check('barge seal master has an asset selector', Boolean(assetSelect))
      if (assetSelect) {
        setValue(assetSelect, 'AGGE-TANK-1')
        await flush(250)
        check(
          'selecting an asset loads its calibration rows on demand',
          apiCalls.includes('GET /asset-calibration-tables/1/rows'),
          apiCalls.filter((c) => c.startsWith('GET /asset-calibration-tables')).join(', ')
        )
        const tankSource = qa('.main-content input[disabled]').map((i) => i.value).find((v) => /Calibration|Manual/.test(v))
        check('barge seal master shows the tank source', Boolean(tankSource), tankSource || 'not found')
      }
    }

    if (path === '/asset-calibrations') {
      // Regression guard: the calibration list is lean (no data rows) and the
      // rows are fetched per table when the user opens one for editing.
      const listCalls = apiCalls.filter((c) => c === 'GET /asset-calibration-tables')
      check('calibration list requested once', listCalls.length === 1, `${listCalls.length} calls`)
      check('calibration list has no row payload calls before edit', !apiCalls.some((c) => /^GET \/asset-calibration-tables\/\d+/.test(c)))

      const masterTable = qa('.main-content table').find((t) =>
        text(t.querySelector('thead')).includes('Calibration Name')
      )
      const rows = masterTable ? Array.from(masterTable.querySelectorAll('tbody tr')) : []
      check('calibration master lists the seeded table', rows.length >= 1 && text(rows[0]).includes('Agge Tank 1 Strapping 2026'), rows.length ? text(rows[0]).slice(0, 80) : 'no master table found')
      check('calibration master shows the row count from the lean list', rows.length >= 1 && text(rows[0]).includes(String(calibrationTableRows.length)), rows.length ? text(rows[0]).slice(0, 80) : '')

      const editButton = rows.flatMap((row) => Array.from(row.querySelectorAll('button'))).find((b) => text(b).trim() === 'Edit')
      check('calibration row has an Edit button', Boolean(editButton))
      if (editButton) {
        const errorsBefore = errors.length
        click(editButton)
        await flush(200)
        check('editing a table loads its rows on demand', apiCalls.includes('GET /asset-calibration-tables/1'), apiCalls.filter((c) => c.startsWith('GET /asset-calibration-tables')).join(', '))
        check('editing a table does not error', errors.length === errorsBefore && !q('.toast.tone-error'), qa('.toast').map(text).join(' | '))
        const nameInput = qa('.main-content input').find((i) => i.value === 'Agge Tank 1 Strapping 2026')
        check('edit form is prefilled from the fetched table', Boolean(nameInput))
      }
    }
  }

  // Activity log
  click(q('.user-menu-button'))
  await flush()
  click(qa('.user-menu-item').find((b) => text(b).includes('Session activity')))
  await flush()
  check('activity panel opens', Boolean(q('.activity-panel')), `${qa('.activity-item').length} entries`)
  console.log('      first entries:', qa('.activity-item').slice(0, 4).map((e) => text(e)).join(' | ').slice(0, 300))

  // ---- barge MTR print content (owner change 2026-10-16) ----------------
  // "Barge operation MTR report does not show API and other sample parameters":
  // every captured sample parameter and the calculated API @ 60F must reach the
  // printed report. The rows come from utils/bargeMtrReport.js, which is what
  // the printable MTR block renders.
  const { buildBargeMtrSampleRows } = await server.ssrLoadModule('/src/utils/bargeMtrReport.js')
  const bargeSampleRows = buildBargeMtrSampleRows({
    summary_json: {
      left: {
        inputs: { obsMode: 'Observed API', obsApi: 34.5, sampleTemp: 32.5, sampleTempUnit: 'C', bswPct: 0.5 },
        totals: { API60: 34.2, VCF: 0.99123 },
      },
      right: {
        inputs: { obsMode: 'Observed Density', obsDensity: 825.4, sampleTemp: 33.1, sampleTempUnit: 'C' },
        totals: { API60: 33.9, VCF: 0.9918 },
      },
    },
  })
  const sampleRow = (label) => bargeSampleRows.find((row) => row.label === label)

  check(
    'barge MTR names the captured sample parameter on each side',
    sampleRow('Observed Input Mode')?.sender === 'Observed API' && sampleRow('Observed Input Mode')?.receiver === 'Observed Density',
    JSON.stringify(sampleRow('Observed Input Mode'))
  )
  check(
    'barge MTR prints observed API and observed density',
    sampleRow('Observed API')?.sender === '34.50' && sampleRow('Observed Density (kg/m3)')?.receiver === '825.4000',
    `${sampleRow('Observed API')?.sender} / ${sampleRow('Observed Density (kg/m3)')?.receiver}`
  )
  check(
    'barge MTR prints API @ 60F for both sides',
    sampleRow('API @ 60F')?.sender === '34.20' && sampleRow('API @ 60F')?.receiver === '33.90',
    `${sampleRow('API @ 60F')?.sender} / ${sampleRow('API @ 60F')?.receiver}`
  )
  check(
    'barge MTR prints the sample temperature with its unit',
    sampleRow('Sample Temperature')?.sender === '32.50 C' && sampleRow('Sample Temperature')?.receiver === '33.10 C',
    `${sampleRow('Sample Temperature')?.sender} / ${sampleRow('Sample Temperature')?.receiver}`
  )
  check(
    'barge MTR never turns a missing sample value into zero',
    sampleRow('Tank Temperature')?.sender === '-' && sampleRow('CCF')?.receiver === '-',
    `${sampleRow('Tank Temperature')?.sender} / ${sampleRow('CCF')?.receiver}`
  )
  check(
    'barge MTR shows the receiver-vs-sender difference',
    sampleRow('API @ 60F')?.delta === '-0.30',
    sampleRow('API @ 60F')?.delta
  )

  console.log('\nDownloads:', downloads.join(', ') || 'none')
  console.log('API calls:', [...new Set(apiCalls)].slice(0, 40).join('\n  '))
} catch (error) {
  errors.push('harness: ' + (error.stack || error))
  console.error(error)
}

console.log('\n==== runtime errors:', errors.length)
errors.slice(0, 10).forEach((e, i) => console.log(`#${i + 1}`, e.slice(0, 800)))
console.log('==== checks failed:', checks.filter((c) => !c.ok).length, '/', checks.length)
await server.close()
process.exit(errors.length || checks.some((c) => !c.ok) ? 1 : 0)
