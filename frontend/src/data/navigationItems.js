/**
 * Top navigation (owner rule 3). Each item is shown only when the user holds
 * its `permission` (the module's View permission from the backend catalog in
 * backend/app/utils/default_permissions.py). `anyPermission` shows the item when
 * the user holds at least one of the listed permissions.
 *
 * Group order and labels mirror the permission categories so that
 * Role Permission Assignment reads exactly like this menu.
 */
export const navigationItems = [
  {
    label: 'Home',
    path: '/',
    type: 'link',
    permission: null,
  },
  {
    label: 'User Management',
    type: 'dropdown',
    items: [
      { label: 'User Master', path: '/users', permission: 'View User' },
      { label: 'Role Master', path: '/roles', permission: 'View Role' },
      { label: 'Permission Master', path: '/permissions', permission: 'View Permission' },
      {
        label: 'Permission Presets',
        path: '/permission-presets',
        permission: 'View Role Permission Assignment',
      },
      {
        label: 'Role Permission Assignment',
        path: '/role-permissions',
        permission: 'View Role Permission Assignment',
      },
      {
        label: 'User Role Assignment',
        path: '/user-roles',
        permission: 'View User Role Assignment',
      },
      {
        label: 'User Location Assignment',
        path: '/user-locations',
        permission: 'View User Location Assignment',
      },
      {
        label: 'Role Location Assignment',
        path: '/role-locations',
        permission: 'View Role Location Assignment',
      },
      {
        label: 'Profile & Security',
        path: '/profile-security',
        permission: 'View Own Security Settings',
      },
      { label: 'Access Summary', path: '/access-summary', permission: 'View Access Summary' },
    ],
  },
  {
    label: 'Master Data Management',
    type: 'dropdown',
    items: [
      { label: 'Location Master', path: '/locations', permission: 'View Location' },
      { label: 'Asset Type Master', path: '/asset-types', permission: 'View Asset Type' },
      { label: 'Asset Master', path: '/assets', permission: 'View Asset' },
      {
        label: 'Prime Mover - Tanker Link',
        path: '/prime-mover-tanker-links',
        permission: 'View Prime Mover Tanker Link',
      },
      {
        label: 'Calibration Template Master',
        path: '/calibration-templates',
        permission: 'View Calibration Template',
      },
      {
        label: 'Asset Calibration Table',
        path: '/asset-calibrations',
        permission: 'View Asset Calibration',
      },
      { label: 'Asset Assignment', path: '/asset-assignments', permission: 'View Asset Assignment' },
      {
        label: 'Asset Assignment Summary',
        path: '/asset-assignment-summary',
        permission: 'View Asset Assignment Summary',
      },
    ],
  },
  {
    label: 'Configurations',
    type: 'dropdown',
    items: [
      { label: 'Operation Type Master', path: '/operation-types', permission: 'View Operation Type' },
      { label: 'Tank Operation Master', path: '/tank-operations', permission: 'View Tank Operation' },
      {
        label: 'Vessel Operation Master',
        path: '/vessel-operations',
        permission: 'View Vessel Operation',
      },
      {
        label: 'Operation Template Master',
        path: '/operation-templates',
        permission: 'View Operation Template',
      },
      {
        label: 'Operation Workflow Policy',
        path: '/operation-workflow-policies',
        permission: 'View Operation Workflow Policy',
      },
      {
        label: 'Location Operation Availability',
        path: '/location-operation-availability',
        permission: 'View Location Operation Availability',
      },
      {
        label: 'Tracking Module Configuration',
        path: '/tracking-module-configuration',
        permission: 'View Tracking Module Configuration',
      },
      { label: 'Table 11 Factor Master', path: '/table11-factors', permission: 'View Table 11 Factor' },
      {
        label: 'Company Report Profile Master',
        path: '/company-report-profiles',
        permission: 'View Company Report Profile',
      },
      { label: 'Barge Seal Master', path: '/barge-seal-master', permission: 'View Barge Seal Master' },
      {
        label: 'Location Accounting Day Settings',
        path: '/location-accounting-day-settings',
        permission: 'View Location Accounting Day Setting',
      },
      {
        label: 'Material Balance Template',
        path: '/material-balance-template-master',
        permission: 'View Material Balance Template',
      },
      { label: 'Flowmeter Config', path: '/flowmeter-configs', permission: 'View Flowmeter Config' },
      { label: 'Report Builder', path: '/report-builder', permission: 'View Report Definition' },
    ],
  },
  {
    label: 'Operations',
    type: 'dropdown',
    items: [
      {
        label: 'Operation Entry',
        path: '/operation-entry',
        // A receiving terminal may hold only the shipment-receipt capability.
        anyPermission: ['Create Operation Entry', 'Create Receiving Ticket'],
      },
      {
        label: 'Operation Transaction Register',
        path: '/operation-transactions',
        permission: 'View Operation Transaction',
      },
      { label: 'Movement Mapping', path: '/movement-mappings', permission: 'View Movement Mapping' },
      { label: 'Flowmeter Records', path: '/flowmeter-records', permission: 'View Flowmeter Record' },
    ],
  },
  {
    label: 'Operation Tracking',
    type: 'dropdown',
    items: [
      { label: 'Barge Tracking', path: '/barge-tracking', permission: 'View Barge Tracking' },
      { label: 'Tanker Tracking', path: '/tanker-tracking', permission: 'View Tanker Tracking' },
      { label: 'Shuttle Tracking', path: '/shuttle-tracking', permission: 'View Shuttle Tracking' },
      { label: 'FSO Tracking', path: '/fso-tracking', permission: 'View FSO Tracking' },
    ],
  },
  {
    label: 'Export Operations',
    type: 'dropdown',
    items: [
      { label: 'Export Dashboard', path: '/export-operations', permission: 'View Export Dashboard' },
      {
        label: 'Export Transactions',
        path: '/export-operations/transactions',
        permission: 'View Export Transaction',
      },
      {
        label: 'Export Reports',
        path: '/export-operations/reports',
        permission: 'View Export Report',
      },
      {
        label: 'Export Permits',
        path: '/export-operations/permits',
        permission: 'View Export Permit',
      },
      {
        label: 'Export Locations',
        path: '/export-operations/locations',
        permission: 'View Export Location',
      },
      {
        label: 'Export Entities',
        path: '/export-operations/entities',
        permission: 'View Export Entity',
      },
      {
        label: 'Export Blocks',
        path: '/export-operations/blocks',
        permission: 'View Export Block',
      },
      {
        label: 'Export Consignees',
        path: '/export-operations/consignees',
        permission: 'View Export Consignee',
      },
      {
        label: 'Export Settings',
        path: '/export-operations/settings',
        permission: 'View Export Settings',
      },
    ],
  },
  {
    label: 'Government Data',
    type: 'dropdown',
    items: [
      { label: 'Book Stock Dashboard', path: '/book-stock/dashboard', permission: 'View Book Stock Dashboard' },
      { label: 'Daily Stock Entry', path: '/book-stock/daily-entries', permission: 'View Book Stock Entry' },
      { label: 'Block Stock Summary', path: '/book-stock/block-summary', permission: 'View Book Stock Report' },
      { label: 'Entity Stock Summary', path: '/book-stock/entity-summary', permission: 'View Book Stock Report' },
      { label: 'Book Stock Products', path: '/book-stock/products', permission: 'View Book Stock Product' },
      { label: 'Book Stock Fields', path: '/book-stock/fields', permission: 'View Book Stock Field' },
      { label: 'Export Operations', path: '/book-stock/export-operations', permission: 'View Book Stock Export Operations' },
      { label: 'Book Stock Settings', path: '/book-stock/settings', permission: 'View Book Stock Settings' },
    ],
  },
  {
    label: 'Reporting',
    type: 'dropdown',
    items: [
      {
        label: 'Tank Operation Summary',
        path: '/tank-operation-summary',
        permission: 'View Tank Operation Summary',
      },
      { label: 'Out-Turn Summary', path: '/out-turn-summary', permission: 'View Out-Turn Summary' },
      {
        label: 'Material Balance Report',
        path: '/material-balance-report',
        permission: 'View Material Balance Report',
      },
      {
        label: 'Tanker Transaction Report',
        path: '/tanker-transaction-report',
        permission: 'View Tanker Transaction Report',
      },
      {
        label: 'Barge Tracking Report',
        path: '/barge-tracking',
        permission: 'View Barge Tracking',
      },
      {
        label: 'Tanker Tracking Report',
        path: '/tanker-tracking',
        permission: 'View Tanker Tracking',
      },
      {
        label: 'Shuttle Tracking Report',
        path: '/shuttle-tracking',
        permission: 'View Shuttle Tracking',
      },
      {
        label: 'FSO Tracking Report',
        path: '/fso-tracking',
        permission: 'View FSO Tracking',
      },
      {
        // Published Report Builder reports are appended dynamically below
        // this entry by TopNavigation (one menu item per shared report).
        label: 'Custom Reports',
        path: '/reporting/custom-reports',
        permission: 'View Custom Report',
      },
    ],
  },
  {
    label: 'Administration',
    type: 'dropdown',
    items: [
      {
        label: 'System Notifications',
        path: '/system-notifications',
        permission: 'View System Notification',
      },
      { label: 'Backup Recovery', path: '/backup-recovery', permission: 'View Backup' },
      { label: 'Database Browser', path: '/database-browser', permission: 'View Database Browser' },
      { label: 'Audit Logs', path: '/audit-logs', permission: 'View Audit Log' },
    ],
  },
]

/**
 * Routes that exist but are intentionally not in the menu (reached from the
 * top bar or from other pages). Used for page labels in the audit trail.
 */
export const hiddenRouteLabels = {
  '/operation-tasks': 'Task Manager',
  '/location-operation-summary': 'Location Operation Summary',
  '/tank-stock-ledger': 'Tank Stock Ledger (Legacy)',
  '/out-turn-report': 'Out-Turn Report (Legacy)',
}

/** Find the menu item that best matches a pathname (longest path wins). */
export const findNavigationItem = (pathname) => {
  let best = null
  for (const group of navigationItems) {
    const candidates = group.type === 'link' ? [group] : group.items || []
    for (const item of candidates) {
      if (!item.path) continue
      const exact = item.path === pathname
      const nested = item.path !== '/' && pathname.startsWith(`${item.path}/`)
      if ((exact || nested) && (!best || item.path.length > best.item.path.length)) {
        best = { item, group }
      }
    }
  }
  return best
}
