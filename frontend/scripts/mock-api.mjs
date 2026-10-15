/*
 * Development-only mock API.
 *
 * The real backend needs PostgreSQL, which is not available in every
 * workspace. This tiny in-memory server implements just enough of the REST
 * surface for the front end to run end to end so that bulk upload / bulk
 * export can be tried out in the browser.
 *
 * It is NOT part of the application build. Start it with:
 *
 *     npm run mock-api                     # http://127.0.0.1:8000
 *     npm run dev:mock                     # mock api + vite dev server
 *
 * Data lives in memory only – restarting the process resets it.
 */
import http from 'node:http'

const now = () => new Date().toISOString()
const PORT = Number(process.env.MOCK_API_PORT || 8000)

let sequence = 1000
const nextId = () => (sequence += 1)

const make = (store) => ({
  ...store,
  created_at: now(),
  updated_at: now(),
})

/* ------------------------------------------------------------- fixtures */

const db = {
  locations: [
    { id: 1, location_name: 'Utapate Terminal', location_code: 'UTP', location_type: 'Terminal', parent_location_code: null, description: 'Main export terminal', status: 'Active' },
    { id: 2, location_name: 'Bonny Depot', location_code: 'BNY', location_type: 'Depot', parent_location_code: 'UTP', description: 'Coastal depot', status: 'Active' },
    { id: 3, location_name: 'Warri Refinery', location_code: 'WRR', location_type: 'Refinery', parent_location_code: null, description: 'Refinery', status: 'Active' },
  ].map(make),

  asset_types: [
    { id: 1, asset_type_name: 'Storage Tank', asset_type_code: 'TANK', description: 'Fixed storage tank', status: 'Active' },
    { id: 2, asset_type_name: 'Barge', asset_type_code: 'BARGE', description: 'Inland barge', status: 'Active' },
    { id: 3, asset_type_name: 'Shuttle Vessel', asset_type_code: 'VESSEL', description: 'Shuttle / FSO vessel', status: 'Active' },
    { id: 4, asset_type_name: 'Metering Stream', asset_type_code: 'STREAM', description: 'Metering skid / stream', status: 'Active' },
    { id: 5, asset_type_name: 'Prime Mover', asset_type_code: 'PM', description: 'Prime mover truck', status: 'Active' },
    { id: 6, asset_type_name: 'Tanker Trailer', asset_type_code: 'TRL', description: 'Tanker trailer', status: 'Active' },
  ].map(make),

  assets: [
    { id: 1, asset_name: 'Tank 101', asset_code: 'TK-101', asset_scope: 'Local', asset_type_code: 'TANK', location_code: 'UTP', serial_number: 'SN-101', manufacturer: 'Acme', model: 'TK-1000', commission_date: '2020-01-15', description: 'Crude storage tank 101', status: 'Active' },
    { id: 2, asset_name: 'Tank 102', asset_code: 'TK-102', asset_scope: 'Local', asset_type_code: 'TANK', location_code: 'UTP', serial_number: 'SN-102', manufacturer: 'Acme', model: 'TK-1000', commission_date: '2020-01-15', description: 'Crude storage tank 102', status: 'Active' },
    { id: 3, asset_name: 'Barge Ada', asset_code: 'BRG-001', asset_scope: 'Global', asset_type_code: 'BARGE', location_code: '', serial_number: 'SN-B1', manufacturer: 'Delta Marine', model: 'BRG-5000', commission_date: '2021-06-01', description: 'Inland lifting barge', status: 'Active' },
    { id: 4, asset_name: 'MT Kainji', asset_code: 'VES-001', asset_scope: 'Global', asset_type_code: 'VESSEL', location_code: '', serial_number: 'SN-V1', manufacturer: 'Ocean Works', model: 'SH-900', commission_date: '2019-03-10', description: 'Shuttle vessel', status: 'Active' },
    { id: 5, asset_name: 'Utapate Metering Skid', asset_code: 'UTP-MSKID-001', asset_scope: 'Local', asset_type_code: 'STREAM', location_code: 'UTP', serial_number: 'SN-M1', manufacturer: 'Endress', model: 'Promass', commission_date: '2022-02-20', description: 'Fiscal metering skid', status: 'Active' },
    { id: 6, asset_name: 'Prime Mover 01', asset_code: 'PM-001', asset_scope: 'Global', asset_type_code: 'PM', location_code: '', serial_number: 'SN-P1', manufacturer: 'Scania', model: 'R500', commission_date: '2021-11-05', description: 'Prime mover', status: 'Active' },
    { id: 7, asset_name: 'Tanker Trailer 01', asset_code: 'TK-TRL-001', asset_scope: 'Global', asset_type_code: 'TRL', location_code: '', serial_number: 'SN-T1', manufacturer: 'Feldbinder', model: 'Tank 30', commission_date: '2021-11-05', description: 'Tanker trailer', status: 'Active' },
  ].map(make),

  calibration_templates: [
    {
      id: 1,
      template_name: 'Barge Tank Strapping',
      asset_type_code: 'BARGE',
      calibration_type: 'Tank Capacity Table',
      description: 'Cargo tank strapping table for barges',
      status: 'Active',
      columns: [
        { id: 1, column_name: 'Tank', data_type: 'Text', unit: '', is_required: 'Yes', interpolation_role: 'Reference', sort_order: 1 },
        { id: 2, column_name: 'Ullage', data_type: 'Number', unit: 'mm', is_required: 'Yes', interpolation_role: 'Input', sort_order: 2 },
        { id: 3, column_name: 'Volume', data_type: 'Number', unit: 'bbls', is_required: 'Yes', interpolation_role: 'Output', sort_order: 3 },
      ],
    },
    {
      id: 2,
      template_name: 'Tank Strapping',
      asset_type_code: 'TANK',
      calibration_type: 'Tank Capacity Table',
      description: 'Storage tank strapping table',
      status: 'Active',
      columns: [
        { id: 4, column_name: 'Ullage', data_type: 'Number', unit: 'mm', is_required: 'Yes', interpolation_role: 'Input', sort_order: 1 },
        { id: 5, column_name: 'Volume', data_type: 'Number', unit: 'bbls', is_required: 'Yes', interpolation_role: 'Output', sort_order: 2 },
      ],
    },
  ].map(make),

  asset_calibration_tables: [
    {
      id: 1,
      calibration_name: 'BRG-001 Strapping 2026',
      asset_code: 'BRG-001',
      asset_name: 'Barge Ada',
      template_id: 1,
      template_name: 'Barge Tank Strapping',
      effective_date: '2026-01-01',
      remarks: 'Annual re-strapping',
      status: 'Active',
      rows: [
        { id: 1, row_number: 1, row_data: { Tank: 'C1', Ullage: 0, Volume: 5200 } },
        { id: 2, row_number: 2, row_data: { Tank: 'C1', Ullage: 500, Volume: 4800 } },
        { id: 3, row_number: 3, row_data: { Tank: 'C1', Ullage: 1000, Volume: 4300 } },
        { id: 4, row_number: 4, row_data: { Tank: 'C2', Ullage: 0, Volume: 5300 } },
        { id: 5, row_number: 5, row_data: { Tank: 'C2', Ullage: 500, Volume: 4900 } },
        { id: 6, row_number: 6, row_data: { Tank: 'C2', Ullage: 1000, Volume: 4400 } },
        { id: 7, row_number: 7, row_data: { Tank: 'P1', Ullage: 0, Volume: 2600 } },
        { id: 8, row_number: 8, row_data: { Tank: 'P1', Ullage: 500, Volume: 2400 } },
      ],
    },
  ].map(make),

  asset_assignments: [
    { id: 1, asset_code: 'UTP-MSKID-001', asset_name: 'Utapate Metering Skid', asset_scope: 'Local', assignment_location_code: 'UTP', assignment_location_name: 'Utapate Terminal', assigned_to_type: 'Location', assigned_to: 'UTP', assigned_to_display: 'Utapate Terminal (UTP)', assignment_date: '2026-01-01', return_date: '', remarks: '', status: 'Active' },
    { id: 2, asset_code: 'BRG-001', asset_name: 'Barge Ada', asset_scope: 'Global', assignment_location_code: 'UTP', assignment_location_name: 'Utapate Terminal', assigned_to_type: 'Vendor', assigned_to: 'Delta Marine', assigned_to_display: 'Delta Marine', assignment_date: '2026-02-01', return_date: '', remarks: '', status: 'Active' },
  ].map(make),

  barge_seal_master: [
    { id: 1, asset_code: 'BRG-001', tank_id: 'C1', seal_position: 'MH1', seal_number: 'SL-1001', effective_date: null, remarks: '', status: 'Active' },
    { id: 2, asset_code: 'BRG-001', tank_id: 'C1', seal_position: 'MH2', seal_number: 'SL-1002', effective_date: null, remarks: '', status: 'Active' },
    { id: 3, asset_code: 'BRG-001', tank_id: 'C1', seal_position: 'LOCK', seal_number: 'SL-1003', effective_date: null, remarks: '', status: 'Active' },
    { id: 4, asset_code: 'BRG-001', tank_id: 'C1', seal_position: 'DIPHATCH', seal_number: 'SL-1004', effective_date: null, remarks: '', status: 'Active' },
  ].map(make),

  table11_factors: Array.from({ length: 20 }, (_, i) => ({
    id: i + 1,
    api60: 30 + i * 0.5,
    lt_factor: Number((0.976 - i * 0.0025).toFixed(4)),
  })).map(make),

  operation_types: [
    { id: 1, operation_type_name: 'Tank Gauging', operation_type_code: 'TANK_GAUGING', applicable_asset_type_code: 'TANK', operation_category: 'Metering', requires_sender_location: 'No', requires_receiver_location: 'No', requires_comparison: 'No', requires_approval: 'Yes', description: 'Daily tank gauging', status: 'Active' },
    { id: 2, operation_type_name: 'Barge Loading', operation_type_code: 'BARGE_LOADING', applicable_asset_type_code: 'BARGE', operation_category: 'Loading', requires_sender_location: 'Yes', requires_receiver_location: 'Yes', requires_comparison: 'Yes', requires_approval: 'Yes', description: 'Barge loading operation', status: 'Active' },
  ].map(make),

  operation_templates: [
    { id: 1, template_name: 'Tank Gauging', operation_type_code: 'TANK_GAUGING', entry_layout_type: 'Tank Gauging', calculation_engine: 'Tank Quantity', description: 'Standard tank gauging ticket', status: 'Active', fields: [] },
  ].map(make),

  operation_workflow_policies: [
    { id: 1, policy_name: 'Tank gauging approval', action_code: 'APPROVE', operation_type_code: 'TANK_GAUGING', operation_template_id: null, asset_type_code: null, location_code: null, priority: 100, status: 'Active', role_ids: [1, 2] },
  ].map(make),

  location_operation_availability: [
    { id: 1, location_code: 'UTP', location_name: 'Utapate Terminal', operation_type_code: 'TANK_GAUGING', operation_type_name: 'Tank Gauging', status: 'Active', remarks: '' },
  ].map(make),

  company_report_profiles: [
    { id: 1, profile_name: 'Default Report Profile', company_name: 'Acme Petroleum Ltd', system_name: 'Hydrocarbon Accounting System', report_subtitle: 'Tank Gauging Quantity Report', logo_data_url: '', logo_text: 'LOGO', footer_formula: 'Formula: GOV = TOV - Free Water', footer_note: 'This report is system-generated.', status: 'Active' },
  ].map(make),

  accounting_day_settings: [
    { id: 1, location_code: 'UTP', location_name: 'Utapate Terminal', day_start_time: '06:01', day_end_time: '06:00', effective_from: '2026-01-01', effective_to: '', timezone_name: 'Africa/Lagos', description: 'Standard accounting day', status: 'Active' },
  ].map(make),

  material_balance_templates: [
    { id: 1, location_code: 'UTP', template_name: 'Daily Tank Balance', description: 'Daily material balance', status: 'Active', columns: [] },
  ].map(make),

  flowmeter_configs: [
    { id: 1, location_code: 'UTP', location_name: 'Utapate Terminal', asset_code: 'UTP-MSKID-001', asset_name: 'Utapate Metering Skid', stream_name: 'Default', meter_label: 'Meter 1', meter_factor: 1, meter_unit: 'bbls', calibration_date: '2026-01-10', remarks: '', status: 'Active' },
  ].map(make),

  flowmeter_config_history: [
    { id: 1, location_code: 'UTP', asset_code: 'UTP-MSKID-001', stream_name: 'Default', meter_label: 'Meter 1', meter_factor: 0.9998, meter_unit: 'bbls', changed_at: now(), changed_by: 'admin', remarks: 'Initial calibration' },
  ].map(make),

  tank_operations: [
    { id: 1, location_code: 'UTP', location_name: 'Utapate Terminal', operation_code: 'OPENING', operation_label: 'Opening Stock', operation_category: 'OPENING', operation_sign: 'SET', sort_order: 1, description: '', status: 'Active' },
    { id: 2, location_code: 'UTP', location_name: 'Utapate Terminal', operation_code: 'RECEIPT', operation_label: 'Receipt', operation_category: 'RECEIPT', operation_sign: 'IN', sort_order: 2, description: '', status: 'Active' },
    { id: 3, location_code: 'UTP', location_name: 'Utapate Terminal', operation_code: 'DISPATCH', operation_label: 'Dispatch', operation_category: 'DISPATCH', operation_sign: 'OUT', sort_order: 3, description: '', status: 'Active' },
    { id: 4, location_code: 'UTP', location_name: 'Utapate Terminal', operation_code: 'CLOSING', operation_label: 'Closing Stock', operation_category: 'CLOSING', operation_sign: 'SET', sort_order: 4, description: '', status: 'Active' },
  ].map(make),

  vessel_operations: [
    { id: 1, location_code: 'UTP', applicable_asset_type_code: 'VESSEL', operation_code: 'LOADING', operation_label: 'Vessel Loading', operation_category: 'LOADING', operation_sign: 'OUT', show_in: 'Both', sort_order: 1, description: '', status: 'Active' },
  ].map(make),

  prime_mover_tanker_links: [
    { id: 1, prime_mover_asset_code: 'PM-001', prime_mover_asset_name: 'Prime Mover 01', prime_mover_asset_type_code: 'PM', tanker_asset_code: 'TK-TRL-001', tanker_asset_name: 'Tanker Trailer 01', tanker_asset_type_code: 'TRL', tanker_chassis_number: 'CH-0099', linked_from: '2026-01-01', linked_to: '', remarks: '', status: 'Active' },
  ].map(make),

  users: Array.from({ length: 12 }, (_, i) => ({
    id: i + 1,
    full_name: `User ${i + 1}`,
    username: `user${i + 1}`,
    email: `user${i + 1}@example.com`,
    phone: '',
    department: i % 2 ? 'Operations' : 'Finance',
    designation: 'Officer',
    status: i % 7 === 6 ? 'Inactive' : 'Active',
  })).map(make),

  roles: [
    { id: 1, role_name: 'Admin', description: 'Administrator', status: 'Active' },
    { id: 2, role_name: 'Operator', description: 'Terminal operator', status: 'Active' },
    { id: 3, role_name: 'Supervisor', description: 'Shift supervisor', status: 'Active' },
  ].map(make),

  permissions: [],
  role_permissions: [],
  user_roles: [{ id: 1, user_id: 1, role_id: 1, role_name: 'Admin', status: 'Active' }],
  user_locations: [],
  operation_entries: [],
  operation_transactions: [],
  audit_logs: [],
  system_notifications: [],
}

/* ------------------------------------------------------------- routing */

const ROUTES = [
  { pattern: '/locations/accounting-day-settings', store: 'accounting_day_settings' },
  { pattern: '/locations', store: 'locations', paged: true },
  { pattern: '/asset-types', store: 'asset_types', paged: true },
  { pattern: '/assets', store: 'assets', paged: true },
  { pattern: '/asset-assignments', store: 'asset_assignments' },
  { pattern: '/asset-calibration-tables', store: 'asset_calibration_tables' },
  { pattern: '/calibration-templates', store: 'calibration_templates' },
  { pattern: '/prime-mover-tanker-links', store: 'prime_mover_tanker_links' },
  { pattern: '/table11-factors', store: 'table11_factors' },
  { pattern: '/operation-types', store: 'operation_types' },
  { pattern: '/operation-templates', store: 'operation_templates' },
  { pattern: '/operation-workflow-policies', store: 'operation_workflow_policies' },
  { pattern: '/location-operation-availability', store: 'location_operation_availability' },
  { pattern: '/company-report-profiles', store: 'company_report_profiles' },
  { pattern: '/material-balance-templates', store: 'material_balance_templates' },
  { pattern: '/flowmeter/configs', store: 'flowmeter_configs' },
  { pattern: '/flowmeter/history', store: 'flowmeter_config_history' },
  { pattern: '/tank-operations', store: 'tank_operations' },
  { pattern: '/vessel-operations', store: 'vessel_operations' },
  { pattern: '/users', store: 'users', paged: true },
  { pattern: '/roles', store: 'roles', paged: true },
  { pattern: '/permissions', store: 'permissions', paged: true },
  { pattern: '/role-permissions', store: 'role_permissions' },
  { pattern: '/user-roles', store: 'user_roles' },
  { pattern: '/user-locations', store: 'user_locations' },
  { pattern: '/operation-entries', store: 'operation_entries' },
  { pattern: '/operation-transactions', store: 'operation_transactions' },
  { pattern: '/audit-logs', store: 'audit_logs' },
  { pattern: '/system-notifications', store: 'system_notifications' },
]

const findRoute = (pathname) => {
  let best = null
  for (const route of ROUTES) {
    if (pathname === route.pattern || pathname.startsWith(`${route.pattern}/`)) {
      if (!best || route.pattern.length > best.pattern.length) best = route
    }
  }
  return best
}

const sendJson = (res, status, body) => {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  })
  res.end(payload)
}

const readBody = (req) =>
  new Promise((resolve) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
    })
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {})
      } catch {
        resolve({})
      }
    })
  })

const pagedResponse = (items, url) => {
  const params = new URL(url, 'http://x').searchParams
  const skip = Number(params.get('skip') || 0)
  const limit = Number(params.get('limit') || 200)
  const slice = items.slice(skip, skip + limit)
  return {
    items: slice,
    total: items.length,
    skip,
    limit,
    has_more: skip + limit < items.length,
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')
  const pathname = url.pathname
  const method = req.method.toUpperCase()

  if (method === 'OPTIONS') {
    sendJson(res, 204, {})
    return
  }

  /* ------------------------------------------------------------ auth */
  if (pathname === '/auth/me' || pathname === '/auth/refresh') {
    sendJson(res, 200, {
      user: {
        id: 1,
        full_name: 'System Administrator',
        username: 'admin',
        email: 'admin@example.com',
        phone: '',
        department: 'IT',
        designation: 'Administrator',
        status: 'Active',
        is_admin: true,
        security: {},
        roles: [{ id: 1, role_name: 'Admin', description: 'Administrator', status: 'Active' }],
        permissions: [],
        assigned_location_codes: [],
        all_locations_access: 'Yes',
      },
    })
    return
  }

  if (pathname === '/auth/login') {
    sendJson(res, 200, { access_token: 'mock-token', refresh_token: 'mock-refresh-token' })
    return
  }

  if (pathname === '/permissions/catalog') {
    sendJson(res, 200, { categories: [] })
    return
  }

  if (pathname.startsWith('/system-notifications')) {
    sendJson(res, 200, [])
    return
  }

  /* -------------------------------------------------- barge seal master */
  if (pathname === '/barge-seal-master') {
    const assetCode = (url.searchParams.get('asset_code') || '').toLowerCase()
    sendJson(
      res,
      200,
      db.barge_seal_master.filter(
        (row) => !assetCode || String(row.asset_code).toLowerCase() === assetCode
      )
    )
    return
  }

  if (pathname === '/barge-seal-master/bulk' && method === 'POST') {
    const body = await readBody(req)
    const assetCode = String(body.asset_code || '').trim()
    const effectiveDate = body.effective_date || null
    if (!assetCode) {
      sendJson(res, 400, { detail: 'asset_code is required' })
      return
    }
    db.barge_seal_master = db.barge_seal_master.filter(
      (row) => !(String(row.asset_code).toLowerCase() === assetCode.toLowerCase())
    )
    const saved = (body.rows || []).map((row) => ({
      id: nextId(),
      asset_code: assetCode,
      tank_id: row.tank_id,
      seal_position: String(row.seal_position || '').toUpperCase(),
      seal_number: row.seal_number,
      effective_date: effectiveDate,
      remarks: row.remarks || '',
      status: row.status || 'Active',
      created_at: now(),
      updated_at: now(),
    }))
    db.barge_seal_master.push(...saved)
    sendJson(res, 200, saved)
    return
  }

  /* ------------------------------------------------------- table 11 bulk */
  if (pathname === '/table11-factors/bulk' && method === 'POST') {
    const body = await readBody(req)
    db.table11_factors = (body.rows || []).map((row, index) => ({
      id: index + 1,
      api60: Number(row.api60),
      lt_factor: Number(row.lt_factor),
      created_at: now(),
      updated_at: now(),
    }))
    sendJson(res, 200, db.table11_factors)
    return
  }

  /* --------------------------------------------------- generic CRUD */
  const route = findRoute(pathname)
  if (!route) {
    sendJson(res, 200, method === 'GET' ? [] : {})
    return
  }

  const store = db[route.store]
  const idMatch = pathname.match(new RegExp(`^${route.pattern}/(\\d+)$`))

  if (method === 'GET') {
    const items = idMatch
      ? store.find((item) => String(item.id) === idMatch[1]) || null
      : route.paged
        ? pagedResponse(store, req.url)
        : store
    sendJson(res, 200, items)
    return
  }

  if (method === 'POST') {
    const body = await readBody(req)
    const created = { ...make(body), id: nextId() }
    store.push(created)
    sendJson(res, 201, created)
    return
  }

  if ((method === 'PUT' || method === 'PATCH') && idMatch) {
    const body = await readBody(req)
    const index = store.findIndex((item) => String(item.id) === idMatch[1])
    if (index < 0) {
      sendJson(res, 404, { detail: 'Not found' })
      return
    }
    store[index] = { ...store[index], ...body, id: Number(idMatch[1]), updated_at: now() }
    sendJson(res, 200, store[index])
    return
  }

  if (method === 'DELETE' && idMatch) {
    const index = store.findIndex((item) => String(item.id) === idMatch[1])
    if (index >= 0) store.splice(index, 1)
    sendJson(res, 200, { deleted: true })
    return
  }

  /* ---------------------------------------------------- barge trip tracking (mock) */
  if (pathname === '/barge-trip/voyages') {
    const tab = (url.searchParams.get('tab') || 'OPEN').toUpperCase()
    const openRows = [
      {
        trip_id: 1,
        convoy_number: 'CNV-OPEN-1',
        status: 'OPEN',
        barge_asset_codes: ['BRG-001'],
        barges: [{ asset_code: 'BRG-001', asset_name: 'Barge Ada' }],
        barge_count: 1,
        ticket_count: 2,
        first_operation_date: '2026-10-02',
        last_operation_date: '2026-10-05',
        origin_location_codes: ['UTP'],
        destination_location_codes: ['BNY'],
        trip_created_by: 'admin',
        trip_remarks: null,
        trip_updated_at: now(),
      },
    ]
    const closedRows = [
      {
        trip_id: 2,
        convoy_number: 'CNV-CLOSED-1',
        status: 'CLOSED',
        barge_asset_codes: ['BRG-001'],
        barges: [{ asset_code: 'BRG-001', asset_name: 'Barge Ada' }],
        barge_count: 1,
        ticket_count: 1,
        first_operation_date: '2026-09-20',
        last_operation_date: '2026-09-21',
        origin_location_codes: ['UTP'],
        destination_location_codes: ['BNY'],
        trip_created_by: 'admin',
        trip_remarks: 'settled',
        trip_updated_at: now(),
      },
    ]
    const open_count = openRows.length
    const closed_count = closedRows.length
    const rows = tab === 'CLOSED' ? closedRows : openRows
    sendJson(res, 200, { tab, open_count, closed_count, rows })
    return
  }

  if (pathname === '/barge-trip/convoy-tracker' || pathname === '/barge-trip/barge-tracking') {
    const convoy = url.searchParams.get('convoy_number') || 'CNV-OPEN-1'
    sendJson(res, 200, {
      convoy_number: convoy,
      total_tickets: 2,
      assets: [
        {
          asset_code: 'BRG-001',
          asset_name: 'Barge Ada',
          tickets: [
            {
              transaction_id: 1,
              ticket_number: 'TKT-001',
              operation_type_code: 'BARGE_LOADING',
              operation_type_name: 'Barge Loading',
              operation_date: '2026-10-02',
              origin_location_code: 'UTP',
              origin_location_name: 'Utapate Terminal',
              destination_location_code: 'BNY',
              destination_location_name: 'Bonny Depot',
              status: 'Approved',
            },
          ],
        },
      ],
    })
    return
  }

  if (pathname.startsWith('/barge-trip/trips/by-convoy/')) {
    const convoy = decodeURIComponent(pathname.split('/').pop())
    sendJson(res, 200, {
      trip: {
        id: 1,
        convoy_number: convoy,
        primary_barge_asset_code: 'BRG-001',
        status: 'OPEN',
        created_by: 'admin',
        remarks: null,
        created_at: now(),
        updated_at: now(),
      },
      events: [],
      comparisons: [],
      timeline_rebuilt: false,
      warnings: [],
    })
    return
  }

  if (pathname.match(/^\/barge-trip\/trips\/\d+\/(close|reopen)$/) && method === 'POST') {
    const id = Number(pathname.split('/')[4])
    const status = pathname.endsWith('/close') ? 'CLOSED' : 'OPEN'
    sendJson(res, 200, { message: 'ok', trip_id: id, status })
    return
  }

  sendJson(res, 200, {})
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[mock-api] listening on http://127.0.0.1:${PORT}`)
})
