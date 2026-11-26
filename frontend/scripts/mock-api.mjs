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
    { id: 3, operation_type_name: 'Barge Move', operation_type_code: 'BARGE_MOVE', applicable_asset_type_code: 'BARGE', operation_category: 'Movement', requires_sender_location: 'Yes', requires_receiver_location: 'Yes', requires_comparison: 'Yes', requires_approval: 'Yes', description: 'Barge movement used by the sender and the receiver', status: 'Active' },
  ].map(make),

  // Tracking Module Configuration keeps no barge stage: one operation type
  // serves both sides of a barge movement (the link decides the side).
  tracking_module_configs: [
    { id: 1, module_code: 'BARGE', operation_type_code: 'BARGE_MOVE', movement_role: 'SENDER', status: 'Active', remarks: 'Barge movement ticket' },
    { id: 2, module_code: 'TANKER', operation_type_code: 'TANKER_LOAD', movement_role: 'SENDER', status: 'Active', remarks: 'Tanker loading side' },
    { id: 3, module_code: 'TANKER', operation_type_code: 'TANKER_RECEIPT', movement_role: 'RECEIVER', status: 'Active', remarks: 'Tanker receiving side' },
  ].map(make),

  operation_templates: [
    {
      id: 1, template_name: 'Tank Gauging', operation_type_code: 'TANK_GAUGING',
      entry_layout_type: 'Tank Gauging', calculation_engine: 'Tank Quantity',
      description: 'Standard tank gauging ticket', status: 'Active',
      fields: [
        { id: 1, field_name: 'Tank Gauging', field_code: 'tank_gauging_payload', field_group: 'Payload', data_type: 'JSON', unit: null, is_required: 'No', input_mode: 'System', calculation_role: 'Input', sort_order: 1, status: 'Active' },
        { id: 2, field_name: 'Sample Reference', field_code: 'sample_reference', field_group: 'General', data_type: 'Text', unit: null, is_required: 'No', input_mode: 'Manual', calculation_role: 'Input', sort_order: 2, status: 'Active' },
      ],
    },
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

  /* Location scope (User / Role Location Assignment). Rows hold user ids and
     location codes only – full names are resolved when the request is served,
     so renaming a user or location never leaves stale text behind. */
  user_locations: [
    { id: 1, user_id: 2, location_code: 'UTP' },
    { id: 2, user_id: 2, location_code: 'BNY' },
    { id: 3, user_id: 3, location_code: 'UTP' },
    { id: 4, user_id: 5, location_code: 'WRR' },
  ],
  user_location_access: { 5: 'Yes' },
  role_locations: [
    { id: 1, role_id: 2, location_code: 'UTP' },
    { id: 2, role_id: 2, location_code: 'BNY' },
    { id: 3, role_id: 3, location_code: 'WRR' },
  ],
  operation_entries: [],
  // Register fixtures: one ticket per workflow state so the bulk selection and
  // the bulk status actions can be tried out in the browser.
  operation_transactions: [
    { id: 1, operation_number: 'OP-0001', operation_ticket_number: 'TKT-0001', convoy_number: '', operation_date: '2026-10-20', operation_type_code: 'TANK_GAUGING', operation_type_name: 'Tank Gauging', origin_location_code: 'UTP', primary_asset_code: 'TK-101', status: 'Draft' },
    { id: 2, operation_number: 'OP-0002', operation_ticket_number: 'TKT-0002', convoy_number: '', operation_date: '2026-10-19', operation_type_code: 'TANK_GAUGING', operation_type_name: 'Tank Gauging', origin_location_code: 'UTP', primary_asset_code: 'TK-102', status: 'Submitted' },
    { id: 3, operation_number: 'OP-0003', operation_ticket_number: 'TKT-0003', convoy_number: 'CNV-2026-001', operation_date: '2026-10-18', operation_type_code: 'BARGE_MOVE', operation_type_name: 'Barge Move', origin_location_code: 'UTP', primary_asset_code: 'BRG-001', status: 'Approved' },
  ].map(make),
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
  { pattern: '/role-locations', store: 'role_locations' },
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

/* The single mock account: full administrator, so every page is reachable. */
const mockUser = {
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
}

/* ------------------------------------------------------------------
 * Tracking modules (tanker + FSO) – read-only fixtures.
 *
 * These pages have no CRUD surface in the mock; the fixtures exist so the
 * convoy list / trip tabs (tanker) and the summary tab (FSO) can be opened
 * in the browser without PostgreSQL.
 * ------------------------------------------------------------------ */
const trackingTicket = (overrides) => ({
  transaction_id: 1,
  ticket_number: 'TKT-0001',
  operation_number: 'OP-0001',
  movement_role: 'SENDER',
  operation_date: '2026-10-10',
  operation_type_code: 'TANKER_LOADING',
  operation_type_name: 'Tanker Loading',
  origin_location_code: 'UTP',
  origin_location_name: 'Utapate Terminal',
  destination_location_code: 'BNY',
  destination_location_name: 'Bonny Depot',
  sender_location_code: 'UTP',
  sender_location_name: 'Utapate Terminal',
  receiver_location_code: 'BNY',
  receiver_location_name: 'Bonny Depot',
  sender_code: 'UTP',
  sender_name: 'Utapate Terminal',
  receiver_code: 'BNY',
  receiver_name: 'Bonny Depot',
  primary_asset_code: 'TNK-001',
  primary_asset_name: 'Tanker Alpha',
  primary_asset_type_code: 'TANKER',
  prime_mover_asset_code: 'PM-001',
  prime_mover_asset_name: 'Prime Mover 1',
  tanker_asset_code: 'TNK-001',
  tanker_asset_name: 'Tanker Alpha',
  tanker_chassis_number: 'CHS-001',
  convoy_number: 'CNV-2026-001',
  product_name: 'Crude Oil',
  total_dip_cm: 210.5,
  water_dip_cm: 2.1,
  bsw_percent: 0.5,
  observed_api: 34.2,
  api60: 34.5,
  vcf: 0.9987,
  tov_bbl: 5200.0,
  free_water_bbl: 12.0,
  gov_bbl: 5188.0,
  gsv_bbl: 5178.0,
  bsw_bbl: 25.9,
  nsv_bbl: 5152.1,
  lt: 650.0,
  mt: 660.0,
  seal_c1: 'C1-1001',
  seal_c2: 'C2-1001',
  seal_m1: 'M1-1001',
  seal_m2: 'M2-1001',
  remarks: '',
  status: 'Approved',
  created_by: 'admin',
  created_at: '2026-10-10T08:00:00Z',
  updated_at: '2026-10-10T08:00:00Z',
  ...overrides,
})

const mockTankerGroups = () => [
  {
    group_key: 'CNV-2026-001::TNK-001',
    convoy_number: 'CNV-2026-001',
    tanker_asset_code: 'TNK-001',
    tanker_asset_name: 'Tanker Alpha',
    tanker_chassis_number: 'CHS-001',
    prime_mover_asset_code: 'PM-001',
    prime_mover_asset_name: 'Prime Mover 1',
    product_name: 'Crude Oil',
    sender_ticket: trackingTicket({}),
    receiver_tickets: [
      trackingTicket({
        transaction_id: 2,
        ticket_number: 'TKT-0002',
        operation_number: 'OP-0002',
        movement_role: 'RECEIVER',
        operation_type_code: 'TANKER_RECEIPT',
        operation_type_name: 'Tanker Receipt',
        origin_location_code: 'BNY',
        origin_location_name: 'Bonny Depot',
        destination_location_code: 'WRR',
        destination_location_name: 'Warri Refinery',
        sender_code: 'UTP',
        sender_name: 'Utapate Terminal',
        receiver_code: 'BNY',
        receiver_name: 'Bonny Depot',
        total_dip_cm: 209.8,
        nsv_bbl: 5148.6,
      }),
    ],
    latest_receiver_ticket: trackingTicket({
      transaction_id: 2,
      ticket_number: 'TKT-0002',
      operation_number: 'OP-0002',
      movement_role: 'RECEIVER',
      operation_type_code: 'TANKER_RECEIPT',
      operation_type_name: 'Tanker Receipt',
      origin_location_code: 'BNY',
      origin_location_name: 'Bonny Depot',
      destination_location_code: 'WRR',
      destination_location_name: 'Warri Refinery',
      total_dip_cm: 209.8,
      nsv_bbl: 5148.6,
    }),
    acknowledgement_id: 11,
    acknowledged_by: 'admin',
    acknowledged_at: '2026-10-11T09:00:00Z',
    acknowledgement_remarks: 'Arrived at Bonny Depot',
    closed_by: null,
    closed_at: null,
    closure_remarks: null,
    seal_checks: [
      { seal_name: 'C1', sender_value: 'C1-1001', receiver_value: 'C1-1001', status: 'MATCHED' },
      { seal_name: 'C2', sender_value: 'C2-1001', receiver_value: 'C2-1001', status: 'MATCHED' },
      { seal_name: 'M1', sender_value: 'M1-1001', receiver_value: 'M1-1001', status: 'MATCHED' },
      { seal_name: 'M2', sender_value: 'M2-1001', receiver_value: 'M2-1001', status: 'MATCHED' },
    ],
    quantity_comparison: {
      sender_transaction_id: 1,
      receiver_transaction_id: 2,
      sender_gov_bbl: 5188.0,
      receiver_gov_bbl: 5184.2,
      gov_variance_bbl: -3.8,
      sender_gsv_bbl: 5178.0,
      receiver_gsv_bbl: 5174.1,
      gsv_variance_bbl: -3.9,
      sender_nsv_bbl: 5152.1,
      receiver_nsv_bbl: 5148.6,
      nsv_variance_bbl: -3.5,
      nsv_variance_percent: -0.0679,
      sender_lt: 650.0,
      receiver_lt: 649.5,
      lt_variance: -0.5,
      sender_mt: 660.0,
      receiver_mt: 659.4,
      mt_variance: -0.6,
    },
    tracking_status: 'MATCHED',
    warning_messages: [],
  },
  {
    group_key: 'CNV-2026-001::TNK-002',
    convoy_number: 'CNV-2026-001',
    tanker_asset_code: 'TNK-002',
    tanker_asset_name: 'Tanker Bravo',
    tanker_chassis_number: 'CHS-002',
    prime_mover_asset_code: 'PM-002',
    prime_mover_asset_name: 'Prime Mover 2',
    product_name: 'Crude Oil',
    sender_ticket: trackingTicket({
      transaction_id: 3,
      ticket_number: 'TKT-0003',
      tanker_asset_code: 'TNK-002',
      tanker_asset_name: 'Tanker Bravo',
      tanker_chassis_number: 'CHS-002',
      prime_mover_asset_code: 'PM-002',
      prime_mover_asset_name: 'Prime Mover 2',
      nsv_bbl: 4980.4,
    }),
    receiver_tickets: [],
    latest_receiver_ticket: null,
    acknowledgement_id: null,
    acknowledged_by: null,
    acknowledged_at: null,
    acknowledgement_remarks: null,
    closed_by: null,
    closed_at: null,
    closure_remarks: null,
    seal_checks: [],
    quantity_comparison: null,
    tracking_status: 'PENDING_RECEIPT',
    warning_messages: [],
  },
  {
    group_key: 'CNV-2026-002::TNK-003',
    convoy_number: 'CNV-2026-002',
    tanker_asset_code: 'TNK-003',
    tanker_asset_name: 'Tanker Charlie',
    tanker_chassis_number: 'CHS-003',
    prime_mover_asset_code: 'PM-003',
    prime_mover_asset_name: 'Prime Mover 3',
    product_name: 'Crude Oil',
    sender_ticket: trackingTicket({
      transaction_id: 4,
      ticket_number: 'TKT-0004',
      convoy_number: 'CNV-2026-002',
      tanker_asset_code: 'TNK-003',
      tanker_asset_name: 'Tanker Charlie',
      tanker_chassis_number: 'CHS-003',
      prime_mover_asset_code: 'PM-003',
      prime_mover_asset_name: 'Prime Mover 3',
      operation_date: '2026-09-28',
    }),
    receiver_tickets: [],
    latest_receiver_ticket: null,
    acknowledgement_id: 12,
    acknowledged_by: 'admin',
    acknowledged_at: '2026-09-29T09:00:00Z',
    acknowledgement_remarks: '',
    closed_by: 'admin',
    closed_at: '2026-09-30T17:00:00Z',
    closure_remarks: 'Settled',
    seal_checks: [],
    quantity_comparison: null,
    tracking_status: 'CLOSED',
    warning_messages: [],
  },
]

const fsoTicket = (overrides) => ({
  transaction_id: 101,
  ticket_number: 'FSO-2026-0101',
  operation_number: 'OP-0101',
  location_code: 'UTP',
  location_name: 'Utapate Terminal',
  shuttle_number: 'SH100',
  fso_asset_code: 'FSO-001',
  fso_asset_name: 'FSO Unity',
  product_name: 'Crude Oil',
  operation_date: '2026-10-12',
  event_time: '06:30',
  operation_label: 'Receipt',
  vessel_name: 'Shuttle Delta',
  vessel_quantity_bbl: 12000.0,
  opening_stock_bbl: 150000.0,
  opening_water_bbl: 400.0,
  closing_stock_bbl: 162000.0,
  closing_water_bbl: 400.0,
  net_stock_bbl: 12000.0,
  net_water_bbl: 0.0,
  variance_bbl: 0.0,
  remarks: '',
  status: 'Approved',
  created_by: 'admin',
  created_at: '2026-10-12T06:30:00Z',
  updated_at: '2026-10-12T06:30:00Z',
  ...overrides,
})

const mockFsoGroups = (tab) => {
  const openGroup = {
    group_key: 'UTP|SH100|FSO-001',
    location_code: 'UTP',
    location_name: 'Utapate Terminal',
    shuttle_number: 'SH100',
    fso_asset_code: 'FSO-001',
    fso_asset_name: 'FSO Unity',
    voyage_status: 'OPEN',
    closed_by: null,
    closed_at: null,
    closure_remarks: null,
    total_receipts_bbl: 12000.0,
    total_exports_bbl: 9500.0,
    total_water_in_bbl: 0.0,
    total_water_out_bbl: 0.0,
    net_water_bbl: 0.0,
    loss_gain_bbl: 0.0,
    total_variance_bbl: 0.0,
    shuttle_discharge_bbl: 12000.0,
    fso_receipt_bbl: 12000.0,
    variance_bbl: 0.0,
    tickets: [
      fsoTicket({}),
      fsoTicket({
        transaction_id: 102,
        ticket_number: 'FSO-2026-0102',
        operation_number: 'OP-0102',
        operation_date: '2026-10-13',
        operation_label: 'Export',
        vessel_name: 'MT Bonny',
        vessel_quantity_bbl: 0.0,
        opening_stock_bbl: 162000.0,
        closing_stock_bbl: 152500.0,
        net_stock_bbl: -9500.0,
        variance_bbl: 0.0,
      }),
    ],
  }

  const closedGroup = {
    ...openGroup,
    group_key: 'UTP|SH099|FSO-001',
    shuttle_number: 'SH099',
    voyage_status: 'CLOSED',
    closed_by: 'admin',
    closed_at: '2026-09-30T18:00:00Z',
    closure_remarks: 'Voyage settled',
    tickets: [
      fsoTicket({
        transaction_id: 103,
        ticket_number: 'FSO-2026-0099',
        operation_number: 'OP-0099',
        shuttle_number: 'SH099',
        operation_date: '2026-09-29',
        vessel_name: 'Shuttle Echo',
      }),
    ],
  }

  return tab === 'CLOSED' ? [closedGroup] : [openGroup]
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
  if (pathname === '/auth/me') {
    sendJson(res, 200, { user: mockUser })
    return
  }

  if (pathname === '/auth/refresh' || pathname === '/auth/session') {
    sendJson(res, 200, {
      authenticated: true,
      access_token: 'mock-token',
      token_type: 'bearer',
      user: mockUser,
    })
    return
  }

  // The real API returns the signed-in user together with the tokens, and the
  // login page hands that straight to the app – so the mock has to send it too,
  // otherwise the shell would render as an unprivileged user.
  if (pathname === '/auth/login' || pathname === '/auth/2fa/verify') {
    sendJson(res, 200, {
      access_token: 'mock-token',
      refresh_token: 'mock-refresh-token',
      user: mockUser,
    })
    return
  }

  if (pathname === '/auth/logout') {
    sendJson(res, 200, { ok: true })
    return
  }

  /* ------------------------------------ profile & security module */
  if (pathname === '/auth/users/security-overview') {
    const items = db.users.map((user) => ({
      id: user.id,
      full_name: user.full_name,
      username: user.username,
      email: user.email,
      department: user.department || null,
      designation: user.designation || null,
      status: user.status,
      is_locked: false,
      locked_until: null,
      failed_login_count: 0,
      totp_enabled: false,
      force_2fa: false,
      force_password_change: false,
      password_expired: false,
      password_changed_at: null,
      password_never_expires: false,
      password_expiry_days: 30,
      last_login_at: null,
      last_login_ip: null,
      pending_reset_requests: 0,
    }))
    sendJson(res, 200, {
      items,
      total: items.length,
      locked_count: 0,
      pending_reset_requests: 0,
      two_fa_enabled_count: 0,
    })
    return
  }

  if (pathname === '/auth/password-reset-requests') {
    sendJson(res, 200, { items: [], total: 0, pending_count: 0 })
    return
  }

  if (pathname === '/auth/change-password') {
    sendJson(res, 200, {
      message: 'Password changed successfully',
      access_token: 'mock-token',
      refresh_token: 'mock-refresh-token',
    })
    return
  }

  if (pathname.match(/^\/auth\/users\/\d+\/security\/(reset-password|unlock|reset-2fa|require-password-change)$/)) {
    sendJson(res, 200, { message: 'Done (mock)' })
    return
  }

  if (pathname.startsWith('/auth/2fa/')) {
    sendJson(res, 400, { detail: '2FA is not available in the mock API - run the real backend.' })
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

  /* -------------------------------------- tracking module configuration */
  if (pathname === '/tracking-module-configs/catalog') {
    const mappingsByCode = {}
    for (const row of db.tracking_module_configs) {
      const key = String(row.operation_type_code || '').toLowerCase()
      mappingsByCode[key] = mappingsByCode[key] || []
      mappingsByCode[key].push({
        id: row.id,
        module_code: row.module_code,
        movement_role: row.movement_role,
        status: row.status,
      })
    }
    sendJson(res, 200, {
      modules: [
        { code: 'BARGE', label: 'Barge Tracking' },
        { code: 'TANKER', label: 'Tanker Tracking' },
      ],
      roles: [
        { code: 'SENDER', label: 'Sender (creates the approved ticket that is tracked)' },
        { code: 'RECEIVER', label: 'Receiver (creates a ticket against an approved sender ticket)' },
      ],
      statuses: ['Active', 'Inactive'],
      operation_types: db.operation_types.map((op) => ({
        operation_type_code: op.operation_type_code,
        operation_type_name: op.operation_type_name,
        applicable_asset_type_code: op.applicable_asset_type_code,
        status: op.status,
        mappings: mappingsByCode[String(op.operation_type_code || '').toLowerCase()] || [],
      })),
    })
    return
  }

  if (pathname === '/tracking-module-configs' || pathname.match(/^\/tracking-module-configs\/\d+$/)) {
    const idMatch = pathname.match(/^\/tracking-module-configs\/(\d+)$/)
    const modules = { BARGE: 'Barge Tracking', TANKER: 'Tanker Tracking' }
    const serialize = (row) => {
      const opType = db.operation_types.find(
        (op) => String(op.operation_type_code).toLowerCase() === String(row.operation_type_code).toLowerCase()
      )
      return {
        id: row.id,
        module_code: row.module_code,
        module_label: modules[row.module_code] || row.module_code,
        operation_type_code: row.operation_type_code,
        operation_type_name: opType ? opType.operation_type_name : row.operation_type_code,
        applicable_asset_type_code: opType ? opType.applicable_asset_type_code : null,
        movement_role: row.movement_role,
        status: row.status,
        remarks: row.remarks || null,
        created_by: row.created_by || 'System Administrator',
        updated_by: row.updated_by || 'System Administrator',
        created_at: row.created_at,
        updated_at: row.updated_at,
      }
    }

    if (method === 'GET') {
      const rows = idMatch
        ? db.tracking_module_configs.filter((row) => String(row.id) === idMatch[1])
        : db.tracking_module_configs
      sendJson(res, 200, idMatch ? (rows[0] ? serialize(rows[0]) : null) : rows.map(serialize))
      return
    }

    if (method === 'POST') {
      const body = await readBody(req)
      const created = make({ ...body, id: nextId() })
      db.tracking_module_configs.push(created)
      sendJson(res, 201, serialize(created))
      return
    }

    if ((method === 'PUT' || method === 'PATCH') && idMatch) {
      const body = await readBody(req)
      const index = db.tracking_module_configs.findIndex((row) => String(row.id) === idMatch[1])
      if (index < 0) {
        sendJson(res, 404, { detail: 'Tracking module configuration not found' })
        return
      }
      db.tracking_module_configs[index] = {
        ...db.tracking_module_configs[index],
        ...body,
        id: Number(idMatch[1]),
        updated_at: now(),
      }
      sendJson(res, 200, serialize(db.tracking_module_configs[index]))
      return
    }

    if (method === 'DELETE' && idMatch) {
      const index = db.tracking_module_configs.findIndex((row) => String(row.id) === idMatch[1])
      if (index >= 0) db.tracking_module_configs.splice(index, 1)
      sendJson(res, 200, { message: 'Tracking module configuration deleted', id: Number(idMatch[1]) })
      return
    }
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

  /* -------------------------------------------- asset calibration tables */
  // Mirrors the real API: the list is lean (no data rows) and the rows for a
  // single table come from /asset-calibration-tables/{id}/rows or /{id}.
  if (pathname === '/asset-calibration-tables' && method === 'GET') {
    sendJson(
      res,
      200,
      db.asset_calibration_tables.map(({ rows, ...table }) => ({
        ...table,
        row_count: (rows || []).length,
      }))
    )
    return
  }

  const calibrationRowsMatch = pathname.match(/^\/asset-calibration-tables\/(\d+)\/rows$/)
  if (calibrationRowsMatch && method === 'GET') {
    const table = db.asset_calibration_tables.find(
      (item) => String(item.id) === calibrationRowsMatch[1]
    )
    if (!table) {
      sendJson(res, 404, { detail: 'Asset calibration table not found' })
      return
    }
    sendJson(res, 200, { table_id: table.id, rows: table.rows || [] })
    return
  }

  /* --------------------------------- user / role location assignments */
  // The front end reads both scopes as full lists:
  //   GET /user-locations        -> one row per user + assigned location
  //   GET /user-locations/users  -> per-user summary (codes + all-access flag)
  //   GET /role-locations        -> per-role summary
  // Writes replace the whole list for one user / role, exactly like the API.
  const locationByCode = (code) =>
    db.locations.find((item) => String(item.location_code).toLowerCase() === String(code).toLowerCase())
  const userById = (id) => db.users.find((item) => String(item.id) === String(id))
  const roleById = (id) => db.roles.find((item) => String(item.id) === String(id))

  const serializeUserLocation = (row) => {
    const user = userById(row.user_id)
    const location = locationByCode(row.location_code)
    return {
      id: row.id,
      user_id: row.user_id,
      full_name: user ? user.full_name : '',
      username: user ? user.username : '',
      location_code: row.location_code,
      location_name: location ? location.location_name : row.location_code,
      created_at: row.created_at,
    }
  }

  if (pathname === '/user-locations' && method === 'GET') {
    sendJson(res, 200, db.user_locations.map(serializeUserLocation))
    return
  }

  if (pathname === '/user-locations/users' && method === 'GET') {
    sendJson(
      res,
      200,
      db.users
        .map((user) => ({
          user_id: user.id,
          full_name: user.full_name,
          username: user.username,
          all_locations_access: db.user_location_access[user.id] || 'No',
          location_codes: db.user_locations
            .filter((row) => String(row.user_id) === String(user.id))
            .map((row) => row.location_code),
        }))
        .filter((summary) => summary.location_codes.length > 0 || summary.all_locations_access === 'Yes')
    )
    return
  }

  const userLocationMatch = pathname.match(/^\/user-locations\/(\d+)$/)
  if (userLocationMatch && method === 'PUT') {
    const userId = Number(userLocationMatch[1])
    const body = await readBody(req)
    const codes = Array.isArray(body.location_codes) ? body.location_codes : []
    db.user_locations = db.user_locations.filter((row) => String(row.user_id) !== String(userId))
    for (const code of codes) {
      db.user_locations.push(make({ id: nextId(), user_id: userId, location_code: code }))
    }
    const user = userById(userId)
    sendJson(res, 200, {
      user_id: userId,
      full_name: user ? user.full_name : '',
      username: user ? user.username : '',
      all_locations_access: db.user_location_access[userId] || 'No',
      location_codes: codes,
    })
    return
  }

  const userAllAccessMatch = pathname.match(/^\/user-locations\/(\d+)\/all-locations-access$/)
  if (userAllAccessMatch && method === 'PUT') {
    const userId = Number(userAllAccessMatch[1])
    const body = await readBody(req)
    db.user_location_access[userId] = body.all_locations_access === 'Yes' ? 'Yes' : 'No'
    const user = userById(userId)
    sendJson(res, 200, {
      user_id: userId,
      full_name: user ? user.full_name : '',
      username: user ? user.username : '',
      all_locations_access: db.user_location_access[userId],
      location_codes: db.user_locations
        .filter((row) => String(row.user_id) === String(userId))
        .map((row) => row.location_code),
    })
    return
  }

  if (userLocationMatch && method === 'DELETE') {
    const index = db.user_locations.findIndex((row) => String(row.id) === userLocationMatch[1])
    if (index >= 0) db.user_locations.splice(index, 1)
    sendJson(res, 200, { deleted: true })
    return
  }

  if (pathname === '/role-locations' && method === 'GET') {
    sendJson(
      res,
      200,
      db.roles.map((role) => ({
        role_id: role.id,
        role_name: role.role_name,
        status: role.status,
        location_codes: db.role_locations
          .filter((row) => String(row.role_id) === String(role.id))
          .map((row) => row.location_code),
      }))
    )
    return
  }

  const roleLocationMatch = pathname.match(/^\/role-locations\/(\d+)$/)
  if (roleLocationMatch && method === 'PUT') {
    const roleId = Number(roleLocationMatch[1])
    const body = await readBody(req)
    const codes = Array.isArray(body.location_codes) ? body.location_codes : []
    db.role_locations = db.role_locations.filter((row) => String(row.role_id) !== String(roleId))
    for (const code of codes) {
      db.role_locations.push(make({ id: nextId(), role_id: roleId, location_code: code }))
    }
    const role = roleById(roleId)
    sendJson(res, 200, {
      role_id: roleId,
      role_name: role ? role.role_name : '',
      status: role ? role.status : 'Active',
      location_codes: codes,
    })
    return
  }

  /* ------------------------------------------------- tracking (read) */
  if (pathname === '/tanker-tracking' && method === 'GET') {
    const rows = mockTankerGroups()
    sendJson(res, 200, {
      rows,
      total_groups: rows.length,
      pending_receipts: rows.filter((row) => row.tracking_status === 'PENDING_RECEIPT').length,
      received_groups: rows.filter((row) => row.tracking_status === 'RECEIVED').length,
      compared_groups: rows.filter((row) => Boolean(row.quantity_comparison)).length,
      seal_mismatch_groups: rows.filter((row) => row.tracking_status === 'SEAL_MISMATCH').length,
      quantity_variance_groups: rows.filter((row) => row.tracking_status === 'QUANTITY_VARIANCE').length,
    })
    return
  }

  if (pathname === '/shuttle-fso/fso-tracking' && method === 'GET') {
    const tab = String(url.searchParams.get('tab') || 'OPEN').toUpperCase()
    const page = Math.max(Number(url.searchParams.get('page') || 1), 1)
    const pageSize = Math.min(Math.max(Number(url.searchParams.get('page_size') || 20), 1), 200)
    const all = mockFsoGroups(tab)
    const rows = all.slice((page - 1) * pageSize, page * pageSize)
    sendJson(res, 200, {
      rows,
      total_groups: all.length,
      page,
      page_size: pageSize,
      has_more: page * pageSize < all.length,
    })
    return
  }

  /* --------------------------------------------------- analytics (mock) */
  // Enough of the Analytics Studio + gallery surface for `npm run dev:mock`.
  // The real engine lives in backend/app/services/analytics_engine.py; this
  // mirror exists so the UI is usable without PostgreSQL and so a genuinely
  // unimplemented endpoint answers 404 instead of pretending to succeed.
  if (pathname.startsWith('/analytics') && !pathname.startsWith('/analytics/stock-anomalies')) {
    const titleCase = (value) => String(value || '')
      .replace(/_/g, ' ')
      .replace(/\b[a-z]/g, (c) => c.toUpperCase())
    const analyticsCol = (column, label, data_type = 'text') => ({
      column, label: label || titleCase(column), data_type,
      is_json: data_type === 'json',
      is_location: column === 'location_code' || column.endsWith('_location_code'),
      is_date: data_type === 'date' || data_type === 'datetime',
      nullable: true,
    })

    const analyticsTicketCols = [
      analyticsCol('operation_ticket_number', 'Operation Ticket Number'),
      analyticsCol('operation_number', 'Operation Number'),
      analyticsCol('operation_type_code', 'Operation Type Code'),
      analyticsCol('operation_type_name', 'Operation Type Name'),
      analyticsCol('origin_location_code', 'Origin Location Code'),
      analyticsCol('destination_location_code', 'Destination Location Code'),
      analyticsCol('primary_asset_code', 'Asset Code'),
      analyticsCol('product_name', 'Product'),
      analyticsCol('status', 'Status'),
      analyticsCol('operation_date', 'Operation Date', 'date'),
      analyticsCol('accounting_date', 'Accounting Date', 'date'),
      analyticsCol('created_at', 'Created At', 'datetime'),
      analyticsCol('created_by', 'Created By'),
      analyticsCol('remarks', 'Remarks'),
    ]
    const analyticsLedgerCols = [
      analyticsCol('location_code', 'Location Code'),
      analyticsCol('tank_asset_code', 'Tank Code'),
      analyticsCol('tank_asset_name', 'Tank Name'),
      analyticsCol('product_name', 'Product'),
      analyticsCol('tank_operation_code', 'Tank Operation Code'),
      analyticsCol('tank_operation_label', 'Tank Operation Label'),
      analyticsCol('tank_operation_category', 'Tank Operation Category'),
      analyticsCol('opening_stock_nsv_bbl', 'Opening Stock NSV BBL', 'number'),
      analyticsCol('movement_nsv_bbl', 'Movement NSV BBL', 'number'),
      analyticsCol('movement_gsv_bbl', 'Movement GSV BBL', 'number'),
      analyticsCol('closing_stock_nsv_bbl', 'Closing Stock NSV BBL', 'number'),
      analyticsCol('stock_nsv_bbl', 'Closing Stock NSV BBL', 'number'),
      analyticsCol('stock_gsv_bbl', 'Closing Stock GSV BBL', 'number'),
      analyticsCol('accounting_date', 'Accounting Date', 'date'),
      analyticsCol('source_payload', 'Ticket Answers Payload (JSON)', 'json'),
    ]
    const analyticsTicketVirtuals = [
      { field: 'payload_operation_date', label: 'Operation / Gauging Date (from ticket answers)', data_type: 'date', group: 'Dates (from ticket answers)', help: '' },
      { field: 'accounting_date', label: 'Accounting Date (location accounting day)', data_type: 'date', group: 'Dates (from ticket answers)', help: '' },
      { field: 'operation_type_name', label: 'Operation Type Name', data_type: 'text', group: 'Names (looked up)', help: '' },
      { field: 'operation_category', label: 'Operation Category (of the type)', data_type: 'text', group: 'Names (looked up)', help: '' },
      { field: 'template_name', label: 'Entry Form (Template) Name', data_type: 'text', group: 'Names (looked up)', help: '' },
      { field: 'origin_location_name', label: 'Origin Location Name', data_type: 'text', group: 'Names (looked up)', help: '' },
      { field: 'destination_location_name', label: 'Destination Location Name', data_type: 'text', group: 'Names (looked up)', help: '' },
      { field: 'primary_asset_name', label: 'Asset Name', data_type: 'text', group: 'Names (looked up)', help: '' },
    ]
    const analyticsTankCols = [
      analyticsCol('tank_asset_code', 'Tank Code'),
      analyticsCol('tank_asset_name', 'Tank Name'),
      analyticsCol('asset_type_code', 'Asset Type'),
      analyticsCol('location_code', 'Location'),
      analyticsCol('product_name', 'Product'),
      analyticsCol('current_stock', 'Current Stock', 'number'),
      analyticsCol('capacity', 'Max Capacity', 'number'),
      analyticsCol('ullage', 'Available Ullage', 'number'),
      analyticsCol('fill_pct', 'Fill %', 'number'),
      analyticsCol('accounting_date', 'Last Accounting Date', 'date'),
    ]
    const analyticsTrackingCols = [
      analyticsCol('tracking_module', 'Tracking Module'),
      analyticsCol('tracking_ref', 'Tracking Ref / Convoy'),
      analyticsCol('asset_code', 'Asset Code'),
      analyticsCol('asset_name', 'Asset Name'),
      analyticsCol('location_code', 'Location'),
      analyticsCol('current_status', 'Current Status'),
      analyticsCol('voyage_status', 'Voyage Status'),
      analyticsCol('last_event_type', 'Last Event Type'),
      analyticsCol('last_event_at', 'Last Event Date/Time', 'datetime'),
      analyticsCol('ticket_number', 'Last Ticket Number'),
      analyticsCol('product_name', 'Product'),
      analyticsCol('quantity_gsv_bbl', 'Last Qty GSV (BBL)', 'number'),
      analyticsCol('quantity_nsv_bbl', 'Last Qty NSV (BBL)', 'number'),
      analyticsCol('movement_count', 'Movements', 'number'),
      analyticsCol('remarks', 'Remarks / Status Detail'),
    ]
    const analyticsPayloadNote = 'Engine dataset — rows are computed from the ledger and calibration masters, so payload/JSON splitting applies to Operation Tickets and Tank Stock Ledger.'

    const analyticsDatasets = [
      {
        id: 'operation_tickets', kind: 'operation_tickets',
        name: 'Operation Tickets — with all form answers & payloads split into columns',
        description: 'Every ticket with its header, every answered field and every value inside its saved JSON payloads as separate columns.',
        icon: 'clipboardList', columns: analyticsTicketCols,
        virtual_fields: analyticsTicketVirtuals,
        supports_template_fields: true, supports_payload_json: true,
        payload_source: { field_code: 'tank_gauging_payload' },
        default_date_basis: 'ACCOUNTING_DATE',
      },
      {
        id: 'tank_stock_ledger', kind: 'tank_stock_ledger',
        name: 'Tank Stock Ledger — movements, stock snapshots & running balances',
        description: 'Approved-ticket stock ledger rows per tank with accounting dates. The ticket answers stored with each row can be split into columns.',
        icon: 'database', columns: analyticsLedgerCols,
        virtual_fields: [
          { field: 'tank_asset_name_lookup', label: 'Tank Name (looked up)', data_type: 'text', group: 'Names (looked up)', help: '' },
          { field: 'location_name_lookup', label: 'Location Name (looked up)', data_type: 'text', group: 'Names (looked up)', help: '' },
        ],
        supports_template_fields: false, supports_payload_json: true,
        payload_source: { json_column: 'source_payload', label: 'Ticket answers stored with the ledger row' },
        default_date_basis: 'ACCOUNTING_DATE',
      },
      {
        id: 'tank_snapshot', kind: 'tank_snapshot',
        name: 'Shore Tank Capacity & Stock Snapshot — live ledger + calibration',
        description: 'Live closing stock, active strapping capacity, ullage and fill % across active shore tanks in scope.',
        icon: 'droplet', columns: analyticsTankCols,
        virtual_fields: [], supports_template_fields: false, supports_payload_json: false,
        payload_note: analyticsPayloadNote, default_date_basis: 'ACCOUNTING_DATE',
      },
      {
        id: 'material_balance', kind: 'material_balance',
        name: 'Material Balance Report — active location template',
        description: 'Reads the location\'s active Material Balance Template and continuity-aware Tank Stock Ledger.',
        icon: 'database',
        columns: [
          analyticsCol('accounting_date', 'Accounting Date', 'date'),
          analyticsCol('tank_asset_code', 'Tank'),
          analyticsCol('product_name', 'Product'),
          { column: 'values', label: 'Template-defined columns', data_type: 'number', is_dynamic: true },
        ],
        virtual_fields: [], supports_template_fields: false, supports_payload_json: false,
        payload_note: analyticsPayloadNote, default_date_basis: 'ACCOUNTING_DATE',
      },
      {
        id: 'tracking_status', kind: 'tracking_status',
        name: 'Vessel & Barge Tracking Status — live movement status',
        description: 'Live tracking status for barge, shuttle, FSO and tanker movements across locations.',
        icon: 'mapPin', columns: analyticsTrackingCols,
        virtual_fields: [], supports_template_fields: false, supports_payload_json: false,
        payload_note: analyticsPayloadNote, default_date_basis: 'ACCOUNTING_DATE',
      },
    ]

    const analyticsTables = [
      {
        table: 'locations', label: 'Locations', group: 'Masters — Locations & Assets',
        columns: [analyticsCol('location_code', 'Location Code'), analyticsCol('location_name', 'Location Name'), analyticsCol('location_type', 'Location Type'), analyticsCol('status', 'Status')],
        json_columns: [], location_columns: ['location_code'], date_columns: [], relationships: [],
      },
      {
        table: 'assets', label: 'Assets', group: 'Masters — Locations & Assets',
        columns: [analyticsCol('asset_code', 'Asset Code'), analyticsCol('asset_name', 'Asset Name'), analyticsCol('asset_type_code', 'Asset Type Code'), analyticsCol('location_code', 'Location Code'), analyticsCol('status', 'Status')],
        json_columns: [], location_columns: ['location_code'], date_columns: [], relationships: [],
      },
      {
        table: 'operation_transactions', label: 'Operation Transactions', group: 'Operations',
        columns: analyticsTicketCols,
        json_columns: [], location_columns: ['origin_location_code', 'destination_location_code'],
        date_columns: ['operation_date', 'accounting_date', 'created_at'], relationships: [],
      },
    ]

    const analyticsCatalog = () => ({
      datasets: analyticsDatasets.map((ds) => ({ ...ds })),
      tables: analyticsTables.map((tb) => ({ ...tb })),
      locations: db.locations.map((l) => ({ location_code: l.location_code, location_name: l.location_name })),
      is_admin: true,
      formula_help: [
        { name: 'SUM', syntax: 'SUM(a, b, …)', help: 'Adds the values.' },
        { name: 'AVG', syntax: 'AVG(a, b, …)', help: 'Average of the values.' },
        { name: 'IF', syntax: 'IF(condition, whenTrue, whenFalse)', help: 'Chooses one of two values.' },
      ],
      operator_help: [
        { symbol: '+', help: 'Add' }, { symbol: '-', help: 'Subtract' },
        { symbol: '*', help: 'Multiply' }, { symbol: '/', help: 'Divide' },
      ],
      date_bases: [
        { value: 'ACCOUNTING_DATE', label: 'Accounting Date (location accounting day)', help: 'Recommended for stock accounting.' },
        { value: 'PAYLOAD_OPERATION_DATE', label: 'Operation / Gauging Date (from ticket answers)', help: 'The date typed inside the ticket.' },
        { value: 'OPERATION_DATE', label: 'Operation Date (ticket header)', help: 'The header operation date on the ticket.' },
        { value: 'CREATED_AT', label: 'Created Date', help: 'When the record was created.' },
        { value: 'COLUMN', label: 'A date column I choose', help: 'Pick any date column of the table.' },
        { value: 'NONE', label: 'No date filtering', help: 'For master-data style visuals.' },
      ],
    })

    const analyticsLookups = () => ({
      users: db.users.map((u) => ({ id: u.id, username: u.username, full_name: u.full_name })),
      roles: (db.roles || []).map((r) => ({ id: r.id, role_name: r.role_name })),
      locations: db.locations.map((l) => ({ location_code: l.location_code, location_name: l.location_name })),
      asset_types: db.asset_types.map((at) => ({ asset_type_code: at.asset_type_code, asset_type_name: at.asset_type_name })),
      operation_types: (db.operation_types || []).map((o) => ({
        operation_type_code: o.operation_type_code,
        operation_type_name: o.operation_type_name,
        operation_category: o.operation_category || '',
        applicable_asset_type_code: o.applicable_asset_type_code || '',
      })),
      templates: (db.operation_templates || []).map((t) => ({
        id: t.id, template_name: t.template_name,
        operation_type_code: t.operation_type_code || '', entry_layout_type: t.entry_layout_type || '',
      })),
      statuses: ['Draft', 'Submitted', 'Approved', 'Rejected', 'Cancelled'],
      products: ['Bonny Light'],
    })

    const analyticsOperationFields = () => ({
      templates: [],
      saved_fields: [
        { field_code: 'tank_gauging_payload', field_name: 'Tank Gauging Payload', label: 'Tank Gauging Payload', data_type: 'json', unit: null, saved_count: 12, is_payload: true },
        { field_code: 'tank_operation', field_name: 'Tank Operation', label: 'Tank Operation', data_type: 'text', unit: null, saved_count: 12, is_payload: false },
        { field_code: 'gsv_bbl', field_name: 'GSV (BBL)', label: 'GSV (BBL)', data_type: 'number', unit: 'BBL', saved_count: 12, is_payload: false },
        { field_code: 'nsv_bbl', field_name: 'NSV (BBL)', label: 'NSV (BBL)', data_type: 'number', unit: 'BBL', saved_count: 12, is_payload: false },
      ],
    })

    const analyticsJsonPathResult = (body) => ({
      sampled_rows: 5, rows_with_json: 5,
      field_code: body.field_code || null,
      json_column: body.json_column || null,
      paths: [
        { path: 'calculated.gsvBbl', label: 'Calculated › GSV BBL', short_label: 'GSV BBL', data_type: 'number', present_in: 5, examples: ['5200.5'], is_array_item: false },
        { path: 'calculated.nsvBbl', label: 'Calculated › NSV BBL', short_label: 'NSV BBL', data_type: 'number', present_in: 5, examples: ['5178'], is_array_item: false },
        { path: 'calculated.lt', label: 'Calculated › LT', short_label: 'LT', data_type: 'number', present_in: 5, examples: ['512.4'], is_array_item: false },
        { path: 'calculated.mt', label: 'Calculated › MT', short_label: 'MT', data_type: 'number', present_in: 5, examples: ['520.1'], is_array_item: false },
        { path: 'inputs.gaugingDate', label: 'Inputs › Gauging Date', short_label: 'Gauging Date', data_type: 'date', present_in: 5, examples: ['2026-10-10'], is_array_item: false },
        { path: 'inputs.tankOperationLabel', label: 'Inputs › Tank Operation Label', short_label: 'Tank Operation Label', data_type: 'text', present_in: 5, examples: ['RECEIPT'], is_array_item: false },
      ],
      wildcard_paths: [
        { path: 'tanks[].@key', label: 'Tanks › Item name / Tank ID', short_label: 'Item / Tank ID', data_type: 'text', present_in: 5, examples: ['TK-101'], is_array_item: true },
        { path: 'tanks[].*', label: 'Tanks › Each item', short_label: 'Each item', data_type: 'text', present_in: 5, examples: ['{}'], is_array_item: true },
      ],
    })

    const analyticsMockRows = (definition, body = {}) => {
      const query = definition?.query || {}
      const sourceKind = String((query.source || {}).kind || 'operation_tickets')
      // Engine datasets (tank snapshot, tracking, material balance) are computed
      // server-side and carry no designer columns. Return their governed column
      // set so drill-through and tables render offline too.
      const governedColumns = () => {
        if (sourceKind === 'tank_snapshot') return analyticsTankCols
        if (sourceKind === 'material_balance') return analyticsDatasets.find((ds) => ds.kind === 'material_balance').columns
        if (sourceKind !== 'operation_tickets' && sourceKind !== 'tank_stock_ledger' && sourceKind !== 'table') return analyticsTrackingCols
        return []
      }
      const rawColumns = (query.columns || []).filter((c) => !c.hidden)
      const columns = (rawColumns.length
        ? rawColumns
        : governedColumns().map((col) => ({ key: col.column, label: col.label, source: { type: 'column', column: col.column }, data_type: col.data_type, aggregate: col.data_type === 'number' ? 'SUM' : 'FIRST', show_total: col.data_type === 'number', format: {} }))
      ).map((c) => ({
        key: c.key,
        label: c.label,
        kind: c.kind || 'data',
        data_type: c.data_type || 'text',
        format: c.format || {},
        aggregate: c.aggregate || null,
        show_total: Boolean(c.show_total),
        formula: c.formula || null,
        unit: c.unit || null,
        hidden: false,
      }))
      const sample = (column, index) => {
        const source = column.source || {}
        const path = String(source.path || '')
        if (column.data_type === 'number' || path.endsWith('Bbl') || path.endsWith('lt') || path.endsWith('mt')) {
          return Math.round((1200 + index * 137 + path.length * 41) * 100) / 100
        }
        if (column.data_type === 'date' || path.toLowerCase().includes('date')) return `2026-10-${String(5 + index).padStart(2, '0')}`
        const key = String(column.key || '')
        if (key.includes('ticket')) return `TKT-100${index}`
        if (key.includes('tank')) return `TK-10${(index % 3) + 1}`
        if (key.includes('location') || source.column === 'location_code') return 'UTP'
        if (key.includes('status')) return 'Approved'
        if (key.includes('product')) return 'Bonny Light'
        return `Value ${index + 1}`
      }
      let rows
      if (sourceKind === 'tank_snapshot') {
        const tanks = [
          { tank_asset_code: 'TK-101', tank_asset_name: 'Tank 101', asset_type_code: 'TANK', location_code: 'UTP', product_name: 'Bonny Light', current_stock: 3210.5, capacity: 5200, ullage: 1989.5, fill_pct: 61.74, accounting_date: '2026-10-20' },
          { tank_asset_code: 'TK-102', tank_asset_name: 'Tank 102', asset_type_code: 'TANK', location_code: 'UTP', product_name: 'Bonny Light', current_stock: 4780.25, capacity: 5000, ullage: 219.75, fill_pct: 95.61, accounting_date: '2026-10-20' },
        ]
        rows = tanks.map((tank) => ({ ...tank, stock_nsv_bbl: tank.current_stock, stock_gsv_bbl: tank.current_stock, stock_lt: 0, stock_mt: 0, capacity_nsv_bbl: tank.capacity, capacity_gsv_bbl: tank.capacity }))
      } else if (sourceKind === 'tracking_status') {
        rows = [{
          tracking_module: 'BARGE', tracking_ref: 'CNV-OPEN-1', asset_code: 'BRG-001', asset_name: 'Barge Ada',
          location_code: 'UTP', from_location_code: 'UTP', to_location_code: 'BNY', current_status: 'IN_TRANSIT',
          voyage_status: 'OPEN', last_event_type: 'BARGE_LOADING', last_event_at: '2026-10-02T08:15:00',
          ticket_number: 'TKT-0003', product_name: 'Bonny Light', quantity_gsv_bbl: 5200, quantity_nsv_bbl: 5178,
          movement_count: 1, remarks: 'Mock tracking row',
        }]
      } else if (sourceKind === 'material_balance') {
        rows = [{
          accounting_date: '2026-10-20', tank_asset_code: 'TK-101', product_name: 'Bonny Light',
          values: 3210.5, opening: 3100, production: 210, dispatch: 99.5, closing: 3210.5,
        }]
      } else {
        rows = Array.from({ length: 8 }, (_, index) => {
          const row = {}
          const list = columns.length
            ? columns
            : [{ key: 'operation_ticket_number', label: 'Ticket', data_type: 'text', source: { type: 'column', column: 'operation_ticket_number' } }]
          list.forEach((column) => {
            row[column.key] = sample(column, index)
          })
          return row
        })
      }
      const totals = {}
      columns.filter((c) => c.show_total).forEach((c) => {
        totals[c.key] = rows.reduce((sum, row) => sum + (Number(row[c.key]) || 0), 0)
      })
      const pageSize = Number(body.page_size) || 500
      return {
        columns,
        rows: rows.slice(0, pageSize),
        totals,
        meta: {
          total_rows: rows.length, scanned_rows: rows.length, filtered_rows: rows.length,
          page: 1, page_size: pageSize, total_pages: 1,
          warnings: ['Mock API: sample rows only. Run against the real backend for live data.'],
          generated_at: now(), generated_in_ms: 2,
          date_basis: query.date_basis || 'ACCOUNTING_DATE',
          date_basis_label: query.date_basis === 'NONE' ? 'No date filtering' : 'Accounting Date',
          source_kind: sourceKind, source_table: sourceKind === 'table' ? (query.source || {}).table : sourceKind,
          report_type: query.report_type || 'TABULAR', grouped: Boolean((query.group_by || []).length),
          scope: body.location_codes || [],
          filter_breakdown: sourceKind === 'tank_snapshot'
            ? { candidates: rows.length, with_stock_evidence: rows.length, after_type_filter: rows.length, after_slicer_filters: rows.length, after_fixed_filters: rows.length, shown: rows.length }
            : undefined,
        },
      }
    }

    const analyticsVisuals = (definition) => (definition?.visuals || []).filter((v) => v && v.id)

    const analyticsRunDefinition = (definition, params = {}, visualIds = null) => {
      const wanted = Array.isArray(visualIds) && visualIds.length ? new Set(visualIds.map(String)) : null
      const results = {}
      analyticsVisuals(definition).forEach((visual) => {
        if (wanted && !wanted.has(String(visual.id))) return
        if (String(visual.type || '').toUpperCase() === 'TEXT') {
          results[visual.id] = { columns: [], rows: [], totals: {}, meta: { warnings: [], total_rows: 0 } }
          return
        }
        try {
          results[visual.id] = analyticsMockRows(visual, params)
        } catch (error) {
          results[visual.id] = { columns: [], rows: [], totals: {}, error: String(error?.message || error), meta: { warnings: [], total_rows: 0 } }
        }
      })
      return { results }
    }

    const blankVisual = (id, type, query = {}) => ({
      id, title: `${titleCase(type)} visual`, type,
      query: { schema_version: 1, report_type: 'TABULAR', source: { kind: 'tank_stock_ledger' }, date_basis: 'ACCOUNTING_DATE', columns: [], filters: [], filter_logic: 'AND', runtime_filters: [], group_by: [], sort: [], options: { show_totals: true, page_size: 200 }, ...query },
      style: {}, explorer: {}, interactions: { crossFilter: true, drillThrough: { enabled: true, mode: 'RECORDS' } },
    })

    if (!db.analytics_dashboards) {
      const seedVisuals = [
        blankVisual('vis_mwxilfyg_x4e', 'TANK_VISUAL', { source: { kind: 'tank_snapshot' }, unit: 'nsv', filters: [], filter_logic: 'AND', date_basis: 'NONE' }),
        blankVisual('vis_mock_kpi', 'KPI_CARD', {
          columns: [
            { key: 'tank_asset_code', label: 'Tank', kind: 'data', source: { type: 'column', column: 'tank_asset_code' }, data_type: 'text', aggregate: 'FIRST' },
            { key: 'movement_nsv_bbl', label: 'Movement NSV (BBL)', kind: 'data', source: { type: 'column', column: 'movement_nsv_bbl' }, data_type: 'number', aggregate: 'SUM', show_total: true, format: { decimals: 2 } },
          ],
          group_by: [{ key: 'tank_asset_code', bucket: 'VALUE' }],
          metric_key: 'movement_nsv_bbl', measure_key: 'movement_nsv_bbl', dimension_key: 'tank_asset_code',
        }),
      ]
      db.analytics_dashboards = [{
        id: 1, dashboard_code: 'mock-terminal-overview', dashboard_name: 'Mock Terminal Stock Overview',
        description: 'Sample analytics dashboard served by the mock API.',
        scope_type: 'LOCATION', location_code: 'UTP', visibility: 'PRIVATE',
        is_published: true, status: 'Active', version: 1,
        owner_user_id: 1, owner_name: 'System Administrator',
        created_by: 'System Administrator', updated_by: 'System Administrator',
        created_at: now(), updated_at: now(), my_access: 'OWNER',
        definition: {
          schema_version: 2, canvas: { floatMode: false, cellHeight: 64, margin: 14 },
          slicers: [{ id: 'slicer_product', key: 's_product_name', label: 'Product', type: 'SELECT', column_key: 'product_name', field: 'product_name', visual_ids: ['vis_mwxilfyg_x4e', 'vis_mock_kpi'] }],
          visuals: seedVisuals,
          layout: [
            { i: 'vis_mwxilfyg_x4e', x: 0, y: 0, w: 6, h: 6, minW: 4, minH: 5, locked: false },
            { i: 'vis_mock_kpi', x: 6, y: 0, w: 3, h: 4, minW: 3, minH: 3, locked: false },
          ],
        },
      }, {
        id: 2, dashboard_code: 'mock-global-overview', dashboard_name: 'Mock Global Movements Overview',
        description: 'Global sample dashboard (no fixed location).',
        scope_type: 'GLOBAL', location_code: null, visibility: 'PRIVATE',
        is_published: true, status: 'Active', version: 1,
        owner_user_id: 1, owner_name: 'System Administrator',
        created_by: 'System Administrator', updated_by: 'System Administrator',
        created_at: now(), updated_at: now(), my_access: 'OWNER',
        definition: {
          schema_version: 2, canvas: { floatMode: false, cellHeight: 64, margin: 14 },
          slicers: [],
          visuals: [blankVisual('vis_mwxilfyg_x4e', 'TANK_VISUAL', { source: { kind: 'tank_snapshot' }, unit: 'nsv', filters: [], filter_logic: 'AND', date_basis: 'NONE' })],
          layout: [{ i: 'vis_mwxilfyg_x4e', x: 0, y: 0, w: 6, h: 6, minW: 4, minH: 5, locked: false }],
        },
      }]
    }

    const analyticsSummary = (dash, includeDefinition = false) => {
      const out = {
        id: dash.id, dashboard_code: dash.dashboard_code, dashboard_name: dash.dashboard_name,
        description: dash.description, scope_type: dash.scope_type, location_code: dash.location_code,
        visibility: dash.visibility, is_published: Boolean(dash.is_published), status: dash.status,
        version: dash.version, owner_user_id: dash.owner_user_id, owner_name: dash.owner_name,
        created_by: dash.created_by, updated_by: dash.updated_by,
        created_at: dash.created_at, updated_at: dash.updated_at,
        my_access: dash.my_access || 'OWNER',
        visual_count: (dash.definition?.visuals || []).length,
      }
      if (includeDefinition) {
        out.definition = JSON.parse(JSON.stringify(dash.definition || {}))
        out.grants = []
      }
      return out
    }

    const findDashboard = (identifier) => db.analytics_dashboards.find((dash) => (
      String(dash.id) === String(identifier)
      || String(dash.dashboard_code) === String(identifier)
      || String(dash.dashboard_name) === String(identifier)
    ))

    if (pathname === '/analytics/catalog' && method === 'GET') {
      sendJson(res, 200, analyticsCatalog())
      return
    }
    if (pathname === '/analytics/lookups' && method === 'GET') {
      sendJson(res, 200, analyticsLookups())
      return
    }
    if (pathname === '/analytics/operation-fields' && method === 'GET') {
      sendJson(res, 200, analyticsOperationFields())
      return
    }
    if (pathname === '/analytics/json-paths' && method === 'POST') {
      const body = await readBody(req)
      sendJson(res, 200, analyticsJsonPathResult(body))
      return
    }
    if (pathname === '/analytics/formula/validate' && method === 'POST') {
      const body = await readBody(req)
      const formula = String(body.formula || '').trim()
      sendJson(res, 200, { valid: Boolean(formula), error: formula ? null : 'The formula is empty.', code: null, position: null, referenced_columns: [] })
      return
    }
    if (pathname === '/analytics/run-preview' && method === 'POST') {
      const body = await readBody(req)
      const definition = body.definition || {}
      if (!analyticsVisuals(definition).length) {
        sendJson(res, 400, { detail: 'Add at least one visual to the dashboard.' })
        return
      }
      sendJson(res, 200, analyticsRunDefinition(definition, body.params || {}, body.visual_ids))
      return
    }
    const analyticsPreviewRecordsMatch = pathname.match(/^\/analytics\/run-preview\/visual\/([^/]+)\/records$/)
    if (analyticsPreviewRecordsMatch && method === 'POST') {
      const body = await readBody(req)
      const visualId = decodeURIComponent(analyticsPreviewRecordsMatch[1])
      const visual = analyticsVisuals(body.definition || {}).find((item) => String(item.id) === visualId)
      if (!visual) {
        sendJson(res, 404, { detail: "Visual '" + visualId + "' is not part of this dashboard design." })
        return
      }
      const run = analyticsMockRows(visual, body.params || {})
      sendJson(res, 200, {
        columns: run.columns,
        rows: run.rows,
        totals: {},
        meta: { ...run.meta, applied_filters: [], warnings: [...(run.meta.warnings || []), 'Mock API: drill-through returns sample rows.'] },
      })
      return
    }
    if (pathname === '/analytics/definitions' && method === 'GET') {
      sendJson(res, 200, db.analytics_dashboards.map((dash) => analyticsSummary(dash)))
      return
    }
    if (pathname === '/analytics/definitions' && method === 'POST') {
      const body = await readBody(req)
      const created = {
        id: nextId(), dashboard_code: `mock-dashboard-${nextId()}`,
        dashboard_name: body.dashboard_name, description: body.description || null,
        scope_type: body.scope_type || 'LOCATION', location_code: body.location_code || null,
        visibility: 'PRIVATE', is_published: Boolean(body.is_published), status: body.status || 'Active',
        version: 1, owner_user_id: 1, owner_name: 'System Administrator',
        created_by: 'System Administrator', updated_by: 'System Administrator',
        created_at: now(), updated_at: now(), my_access: 'OWNER',
        definition: body.definition || {},
      }
      db.analytics_dashboards.push(created)
      sendJson(res, 200, analyticsSummary(created, true))
      return
    }
    const analyticsDefinitionMatch = pathname.match(/^\/analytics\/definitions\/([^/]+)(\/(publish|versions|duplicate|revert|slicer-values))?$/)
    if (analyticsDefinitionMatch) {
      const dashboard = findDashboard(decodeURIComponent(analyticsDefinitionMatch[1]))
      if (!dashboard) {
        sendJson(res, 404, { detail: 'Dashboard not found' })
        return
      }
      const action = analyticsDefinitionMatch[3]
      if (method === 'GET' && !action) { sendJson(res, 200, analyticsSummary(dashboard, true)); return }
      if (method === 'PUT' && !action) {
        const body = await readBody(req)
        Object.assign(dashboard, {
          dashboard_name: body.dashboard_name ?? dashboard.dashboard_name,
          description: body.description ?? dashboard.description,
          scope_type: body.scope_type ?? dashboard.scope_type,
          location_code: body.location_code ?? dashboard.location_code,
          definition: body.definition ?? dashboard.definition,
          is_published: Boolean(body.is_published),
          status: body.status ?? dashboard.status,
          version: (dashboard.version || 1) + 1,
          updated_at: now(),
        })
        sendJson(res, 200, analyticsSummary(dashboard, true))
        return
      }
      if (method === 'DELETE' && !action) {
        db.analytics_dashboards = db.analytics_dashboards.filter((item) => item !== dashboard)
        sendJson(res, 200, { message: 'Dashboard deleted successfully' })
        return
      }
      if (action === 'publish' && method === 'POST') {
        const body = await readBody(req)
        dashboard.is_published = Boolean(body.published)
        dashboard.version = (dashboard.version || 1) + 1
        sendJson(res, 200, analyticsSummary(dashboard, true))
        return
      }
      if (action === 'versions' && method === 'GET') {
        sendJson(res, 200, [{
          id: 1, version_number: dashboard.version, definition: dashboard.definition,
          change_note: 'Mock snapshot', created_by: 'System Administrator', created_at: dashboard.updated_at,
        }])
        return
      }
      if (action === 'duplicate' && method === 'POST') {
        const copy = { ...dashboard, id: nextId(), dashboard_code: `mock-dashboard-${nextId()}`, dashboard_name: `${dashboard.dashboard_name} (Copy)`, is_published: false, version: 1, definition: JSON.parse(JSON.stringify(dashboard.definition || {})), created_at: now(), updated_at: now() }
        db.analytics_dashboards.push(copy)
        sendJson(res, 200, analyticsSummary(copy, true))
        return
      }
      if (action === 'revert' && method === 'POST') {
        dashboard.version = (dashboard.version || 1) + 1
        dashboard.updated_at = now()
        sendJson(res, 200, analyticsSummary(dashboard, true))
        return
      }
      if (action === 'slicer-values' && method === 'POST') {
        sendJson(res, 200, { slicer_key: (await readBody(req)).slicer_key || '', values: ['Bonny Light', 'UTP', 'Approved'] })
        return
      }
    }
    if (pathname === '/analytics/my-dashboards' && method === 'GET') {
      sendJson(res, 200, db.analytics_dashboards.filter((dash) => dash.is_published).map((dash) => analyticsSummary(dash)))
      return
    }
    const analyticsDashMatch = pathname.match(/^\/analytics\/my-dashboards\/([^/]+)(?:\/(.+))?$/)
    if (analyticsDashMatch) {
      const dashboard = findDashboard(decodeURIComponent(analyticsDashMatch[1]))
      if (!dashboard) {
        sendJson(res, 404, { detail: 'Dashboard not found' })
        return
      }
      const rest = analyticsDashMatch[2] || ''
      if (!rest && method === 'GET') {
        sendJson(res, 200, {
          ...analyticsSummary(dashboard, true),
          available_locations: db.locations.map((l) => ({ location_code: l.location_code, location_name: l.location_name })),
        })
        return
      }
      if (rest === 'run-batch' && method === 'POST') {
        const body = await readBody(req)
        const batch = analyticsRunDefinition(dashboard.definition, body, body.visual_ids)
        sendJson(res, 200, {
          dashboard: { id: dashboard.id, dashboard_name: dashboard.dashboard_name, version: dashboard.version },
          slicer_state: body.runtime_values || {},
          results: batch.results,
          applied_scope: { scope_type: dashboard.scope_type, location_code: dashboard.location_code },
        })
        return
      }
      if (rest === 'slicer-values' && method === 'POST') {
        sendJson(res, 200, { slicer_key: (await readBody(req)).slicer_key || '', values: ['Bonny Light', 'UTP', 'Approved'] })
        return
      }
      const visualMatch = rest.match(/^visual\/([^/]+)\/(records|export)$/)
      if (visualMatch) {
        const visualId = decodeURIComponent(visualMatch[1])
        const visual = (dashboard.definition?.visuals || []).find((item) => String(item.id) === visualId)
        if (!visual) {
          sendJson(res, 404, { detail: 'Dashboard visual not found' })
          return
        }
        const body = await readBody(req)
        if (visualMatch[2] === 'records' && method === 'POST') {
          const run = analyticsMockRows(visual, body)
          sendJson(res, 200, {
            columns: run.columns,
            rows: run.rows,
            totals: {},
            meta: { ...run.meta, applied_filters: [], warnings: [...(run.meta.warnings || []), 'Mock API: drill-through returns sample rows.'] },
          })
          return
        }
        if (visualMatch[2] === 'export' && method === 'POST') {
          res.writeHead(200, { 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="mock-${visualId}.csv"`, 'Access-Control-Allow-Origin': '*' })
          res.end('Ticket No,GSV (BBL),NSV (BBL)\nTKT-1000,5200,5178\n')
          return
        }
      }
      if (rest === 'export-workbook' && method === 'POST') {
        await readBody(req)
        res.writeHead(200, { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="mock-analytics-workbook.csv"', 'Access-Control-Allow-Origin': '*' })
        res.end('Visual,Rows\nMock,8\n')
        return
      }
    }

    sendJson(res, 404, { detail: `Not implemented in the mock API: ${method} ${pathname}` })
    return
  }

  /* ------------------------------------------------ report builder (mock) */
  if (pathname.startsWith('/report-builder')) {
    const mockCols = (cols) => cols.map(([column, label, data_type = 'text', is_json = false]) => ({ column, label, data_type, is_json, is_location: column.endsWith('_location_code') || column === 'location_code', is_date: data_type === 'date' || data_type === 'datetime', nullable: true }))
    const ticketCols = mockCols([
      ['operation_ticket_number', 'Operation Ticket Number'], ['operation_number', 'Operation Number'],
      ['operation_type_code', 'Operation Type Code'], ['origin_location_code', 'Origin Location Code'],
      ['primary_asset_code', 'Asset Code'], ['product_name', 'Product'], ['status', 'Status'],
      ['operation_date', 'Operation Date', 'date'], ['created_at', 'Created At', 'datetime'], ['created_by', 'Created By'],
    ])
    const mockRun = (definition, body = {}) => {
      const columns = (definition?.columns || []).filter((c) => !c.hidden).map((c) => ({
        key: c.key, label: c.label, kind: c.kind || 'data', data_type: c.data_type || 'text', format: c.format || {},
        aggregate: c.aggregate || null, show_total: Boolean(c.show_total), formula: c.formula || null, unit: c.unit || null,
      }))
      const rows = Array.from({ length: 8 }, (_, i) => {
        const row = {}
        columns.forEach((c, ci) => {
          row[c.key] = c.data_type === 'number' || (c.kind === 'calculated') ? Math.round((1000 + i * 137 + ci * 41) * 100) / 100 : c.data_type === 'date' ? `2026-10-${String(5 + i).padStart(2, '0')}` : c.key.includes('ticket') ? `TKT-100${i}` : c.key.includes('location') ? 'UTP' : c.key.includes('status') ? 'Approved' : `Value ${i + 1}`
        })
        return row
      })
      const totals = {}
      columns.filter((c) => c.show_total).forEach((c) => { totals[c.key] = rows.reduce((s, r) => s + (Number(r[c.key]) || 0), 0) })
      const pageSize = body.page_size || 50
      return { columns, rows: rows.slice(0, pageSize), totals, meta: { total_rows: rows.length, page: 1, page_size: pageSize, total_pages: 1, scanned_rows: rows.length, filtered_rows: rows.length, warnings: ['Mock API: sample rows only. Run against the real backend for live data.'], generated_at: now(), generated_in_ms: 3, date_basis: definition?.date_basis || 'ACCOUNTING_DATE', date_basis_label: 'Accounting Date', source_kind: definition?.source?.kind || 'operation_tickets', source_table: 'operation_transactions', report_type: definition?.report_type || 'TABULAR', grouped: false } }
    }
    db.report_definitions = db.report_definitions || [{
      id: 1, report_code: 'mock-gauging', report_name: 'Mock Gauging Quantities', description: 'Sample report (mock API)',
      report_type: 'TABULAR', source_kind: 'operation_tickets', definition: {
        schema_version: 1, report_type: 'TABULAR', source: { kind: 'operation_tickets', statuses: ['Approved'] }, date_basis: 'ACCOUNTING_DATE',
        columns: [
          { key: 'ticket', label: 'Ticket No', kind: 'data', source: { type: 'column', column: 'operation_ticket_number' }, data_type: 'text' },
          { key: 'gsv', label: 'GSV (BBL)', kind: 'data', source: { type: 'payload_path', field_code: 'tank_gauging_payload', path: 'calculated.gsvBbl' }, data_type: 'number', show_total: true, format: { decimals: 3 } },
          { key: 'nsv', label: 'NSV (BBL)', kind: 'data', source: { type: 'payload_path', field_code: 'tank_gauging_payload', path: 'calculated.nsvBbl' }, data_type: 'number', show_total: true, format: { decimals: 3 } },
        ],
        runtime_filters: [{ key: 'location', label: 'Location', type: 'location' }],
      },
      visibility: 'INTERNAL', is_published: true, status: 'Active', version: 1, owner_name: 'System Administrator',
      owner_user_id: 1, created_by: 'System Administrator', updated_by: 'System Administrator',
      grants: [], my_access: 'OWNER', column_count: 3, created_at: now(), updated_at: now(),
    }]
    const mockSummary = (r) => ({ id: r.id, report_code: r.report_code, report_name: r.report_name, description: r.description, report_type: r.report_type, source_kind: r.source_kind, visibility: r.visibility, is_published: Boolean(r.is_published), status: r.status, version: r.version, owner_name: r.owner_name, created_by: r.created_by, updated_at: r.updated_at, my_access: 'OWNER', column_count: (r.definition?.columns || []).length })

    if (pathname === '/report-builder/catalog' && method === 'GET') {
      sendJson(res, 200, {
        datasets: [
          { id: 'operation_tickets', kind: 'operation_tickets', name: 'Operation Tickets — with all form answers & payloads split into columns', description: 'Mock catalog', icon: 'clipboardList', columns: ticketCols, virtual_fields: [{ field: 'accounting_date', label: 'Accounting Date (location accounting day)', data_type: 'date', group: 'Dates (from ticket answers)', help: '' }, { field: 'payload_operation_date', label: 'Operation / Gauging Date (from ticket answers)', data_type: 'date', group: 'Dates (from ticket answers)', help: '' }], default_date_basis: 'ACCOUNTING_DATE' },
          { id: 'tank_stock_ledger', kind: 'tank_stock_ledger', name: 'Tank Stock Ledger', description: 'Mock catalog', icon: 'database', columns: mockCols([['location_code', 'Location Code'], ['tank_asset_code', 'Tank Code'], ['tank_operation_code', 'Tank Operation Code'], ['tank_operation_label', 'Tank Operation Label'], ['tank_operation_category', 'Tank Operation Category'], ['movement_nsv_bbl', 'Movement NSV BBL', 'number'], ['movement_gsv_bbl', 'Movement GSV BBL', 'number'], ['accounting_date', 'Accounting Date', 'date']]), virtual_fields: [], default_date_basis: 'ACCOUNTING_DATE' },
        ],
        tables: [{ table: 'locations', label: 'Locations', group: 'Masters — Locations & Assets', columns: mockCols([['location_code', 'Location Code'], ['location_name', 'Location Name'], ['status', 'Status']]), json_columns: [], location_columns: [], date_columns: [] }],
        formula_help: [], operator_help: [],
        date_bases: [
          { value: 'ACCOUNTING_DATE', label: 'Accounting Date (location accounting day)', help: '' },
          { value: 'PAYLOAD_OPERATION_DATE', label: 'Operation / Gauging Date (from ticket answers)', help: '' },
          { value: 'NONE', label: 'No date filtering', help: '' },
        ],
      })
      return
    }
    if (pathname === '/report-builder/lookups' && method === 'GET') {
      sendJson(res, 200, {
        locations: db.locations.map((l) => ({ location_code: l.location_code, location_name: l.location_name, location_type: l.location_type })),
        operation_types: (db.operation_types || []).map((o) => ({ operation_type_code: o.operation_type_code, operation_type_name: o.operation_type_name, operation_category: o.operation_category || '', applicable_asset_type_code: o.applicable_asset_type_code || '' })),
        templates: [], statuses: ['Draft', 'Submitted', 'Approved', 'Rejected', 'Cancelled'],
        assets: db.assets.map((a) => ({ asset_code: a.asset_code, asset_name: a.asset_name, asset_type_code: a.asset_type_code, location_code: a.location_code })),
        products: ['Bonny Light'], users: [{ id: 1, full_name: 'System Administrator', username: 'admin' }], roles: (db.roles || []).map((r) => ({ id: r.id, role_name: r.role_name })),
      })
      return
    }
    if (pathname === '/report-builder/operation-fields' && method === 'GET') {
      sendJson(res, 200, { templates: [], saved_fields: [{ field_code: 'tank_gauging_payload', field_name: 'Tank Gauging Payload', label: 'Tank Gauging Payload', data_type: 'json', unit: null, saved_count: 12, is_payload: true }] })
      return
    }
    if (pathname === '/report-builder/json-paths' && method === 'POST') {
      await readBody(req)
      sendJson(res, 200, { sampled_rows: 5, rows_with_json: 5, paths: [
        { path: 'calculated.gsvBbl', label: 'Calculated › GSV BBL', short_label: 'GSV BBL', data_type: 'number', present_in: 5, examples: ['5200.5'], is_array_item: false },
        { path: 'calculated.nsvBbl', label: 'Calculated › NSV BBL', short_label: 'NSV BBL', data_type: 'number', present_in: 5, examples: ['5178'], is_array_item: false },
        { path: 'inputs.gaugingDate', label: 'Inputs › Gauging Date', short_label: 'Gauging Date', data_type: 'date', present_in: 5, examples: ['2026-10-10'], is_array_item: false },
      ], wildcard_paths: [], field_code: 'tank_gauging_payload', json_column: null })
      return
    }
    if (pathname === '/report-builder/formula/validate' && method === 'POST') {
      const body = await readBody(req)
      sendJson(res, 200, { valid: Boolean(String(body.formula || '').trim()), error: String(body.formula || '').trim() ? null : 'The formula is empty.', code: null, position: null, referenced_columns: [] })
      return
    }
    if (pathname === '/report-builder/starter-templates' && method === 'GET') { sendJson(res, 200, []); return }
    if (pathname === '/report-builder/definitions' && method === 'GET') { sendJson(res, 200, db.report_definitions.map(mockSummary)); return }
    if (pathname === '/report-builder/definitions' && method === 'POST') {
      const body = await readBody(req)
      const created = { id: nextId(), report_code: `mock-${nextId()}`, report_name: body.report_name, description: body.description || null, report_type: body.definition?.report_type || 'TABULAR', source_kind: body.definition?.source?.kind || 'operation_tickets', definition: body.definition || {}, visibility: body.visibility || 'PRIVATE', is_published: Boolean(body.is_published), status: 'Active', version: 1, owner_name: 'System Administrator', owner_user_id: 1, created_by: 'System Administrator', updated_by: 'System Administrator', grants: body.grants || [], my_access: 'OWNER', column_count: (body.definition?.columns || []).length, created_at: now(), updated_at: now() }
      db.report_definitions.push(created)
      sendJson(res, 200, created)
      return
    }
    if (pathname === '/report-builder/run-preview' && method === 'POST') {
      const body = await readBody(req)
      sendJson(res, 200, mockRun(body.definition, body))
      return
    }
    if (pathname === '/report-builder/my-reports' && method === 'GET') {
      sendJson(res, 200, db.report_definitions.filter((r) => r.is_published).map(mockSummary))
      return
    }
    const defMatch = pathname.match(/^\/report-builder\/(?:definitions|my-reports)\/(\d+)(\/(run|publish|duplicate|versions|export))?$/)
    if (defMatch) {
      const found = db.report_definitions.find((r) => String(r.id) === defMatch[1])
      if (!found) { sendJson(res, 404, { detail: 'Report not found' }); return }
      const action = defMatch[3]
      if (method === 'GET' && !action) { sendJson(res, 200, found); return }
      if (method === 'PUT' && !action) {
        const body = await readBody(req)
        Object.assign(found, { report_name: body.report_name, description: body.description, definition: body.definition, visibility: body.visibility, is_published: Boolean(body.is_published), grants: body.grants || [], version: (found.version || 1) + 1, updated_at: now() })
        sendJson(res, 200, found)
        return
      }
      if (method === 'DELETE' && !action) {
        db.report_definitions = db.report_definitions.filter((r) => r !== found)
        sendJson(res, 200, { message: 'Report deleted successfully' })
        return
      }
      if (action === 'run' && method === 'POST') { const body = await readBody(req); sendJson(res, 200, mockRun(found.definition, body)); return }
      if (action === 'publish' && method === 'POST') { const body = await readBody(req); found.is_published = Boolean(body.published); sendJson(res, 200, found); return }
      if (action === 'duplicate' && method === 'POST') {
        const copy = { ...found, id: nextId(), report_name: `${found.report_name} (Copy)`, is_published: false }
        db.report_definitions.push(copy)
        sendJson(res, 200, copy)
        return
      }
      if (action === 'versions' && method === 'GET') { sendJson(res, 200, []); return }
      if (action === 'export' && method === 'POST') {
        await readBody(req)
        res.writeHead(200, { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="mock-report.csv"', 'Access-Control-Allow-Origin': '*' })
        res.end('Ticket No,GSV (BBL),NSV (BBL)\nTKT-1000,5200,5178\n')
        return
      }
    }
    sendJson(res, 404, { detail: 'Not found in mock API' })
    return
  }

  /* ----------------------------------- operation transaction register (mock) */
  if (pathname.startsWith('/operation-transactions/paged') && method === 'GET') {
    const status = url.searchParams.get('status') || ''
    const search = (url.searchParams.get('search') || '').toLowerCase()
    const matches = db.operation_transactions.filter((row) => {
      if (status && row.status !== status) return false
      if (!search) return true
      return [row.operation_ticket_number, row.operation_number, row.operation_type_name, row.primary_asset_code, row.origin_location_code, row.status]
        .join(' ')
        .toLowerCase()
        .includes(search)
    })
    const counts = db.operation_transactions.reduce((acc, row) => {
      acc[row.status] = (acc[row.status] || 0) + 1
      return acc
    }, {})
    sendJson(res, 200, {
      rows: matches.map((row) => ({
        id: row.id,
        ticket_number: row.operation_ticket_number || row.operation_number || '',
        operation_number: row.operation_number || '',
        convoy_number: row.convoy_number || '',
        operation_date: row.operation_date || '',
        operation_type_name: row.operation_type_name || '',
        operation_type_code: row.operation_type_code || '',
        location_name: (db.locations.find((item) => item.location_code === row.origin_location_code) || {}).location_name || '',
        location_code: row.origin_location_code || '',
        primary_asset_name: (db.assets.find((item) => item.asset_code === row.primary_asset_code) || {}).asset_name || '',
        primary_asset_code: row.primary_asset_code || '',
        field_count: 0,
        status: row.status || '',
        created_at: row.created_at || null,
      })),
      total_rows: matches.length,
      page: Number(url.searchParams.get('page') || 1),
      page_size: Number(url.searchParams.get('page_size') || 20),
      has_more: false,
      status_counts: Object.entries(counts).map(([key, count]) => ({ status: key, count })),
    })
    return
  }

  const statusMatch = pathname.match(/^\/operation-transactions\/(\d+)\/status$/)
  if (statusMatch && method === 'PATCH') {
    const body = await readBody(req)
    const row = db.operation_transactions.find((item) => String(item.id) === statusMatch[1])
    if (!row) {
      sendJson(res, 404, { detail: 'Operation transaction not found' })
      return
    }
    row.status = body.status || row.status
    row.updated_at = now()
    sendJson(res, 200, { message: `Transaction status changed to ${row.status}`, id: row.id, status: row.status })
    return
  }

  /* --------------------------------------------------- generic CRUD */
  const route = findRoute(pathname)
  if (!route) {
    // Answer honestly. Returning 200 [] / {} for an unimplemented path made
    // the UI look healthy while every mutation silently vanished, and made a
    // missing backend route indistinguishable from an empty result set.
    sendJson(res, 404, { detail: `Not implemented in the mock API: ${method} ${pathname}` })
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
              sender_location_code: 'UTP',
              receiver_location_code: 'BNY',
              // Clubbed Sender / Receiver pairing resolved by the server.
              sender_code: 'UTP',
              sender_name: 'Utapate Terminal',
              receiver_code: 'BNY',
              receiver_name: 'Bonny Depot',
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

  sendJson(res, 404, { detail: `Not implemented in the mock API: ${method} ${pathname}` })
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[mock-api] listening on http://127.0.0.1:${PORT}`)
})
