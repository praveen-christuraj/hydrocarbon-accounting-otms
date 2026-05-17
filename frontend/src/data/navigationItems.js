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
      {
        label: 'User Master',
        path: '/users',
        disabled: false,
        permission: 'View User',
      },
      {
        label: 'Role Master',
        path: '/roles',
        disabled: false,
        permission: 'View Role',
      },
      {
        label: 'Permission Master',
        path: '/permissions',
        disabled: false,
        permission: 'View Permission',
      },
      {
        label: 'Role Permission Assignment',
        path: '/role-permissions',
        disabled: false,
        permission: 'View Role Permission Assignment',
      },
      {
        label: 'User Role Assignment',
        path: '/user-roles',
        disabled: false,
        permission: 'View User Role Assignment',
      },
      {
        label: 'Access Summary',
        path: '/access-summary',
        disabled: false,
        permission: 'View Access Summary',
      },
    ],
  },
  {
    label: 'Master Data',
    type: 'dropdown',
    items: [
      {
        label: 'Location Master',
        path: '/locations',
        disabled: false,
        permission: 'View Location',
      },
      {
        label: 'Asset Type Master',
        path: '/asset-types',
        disabled: false,
        permission: 'View Asset Type',
      },
      {
        label: 'Asset Master',
        path: '/assets',
        disabled: false,
        permission: 'View Asset',
      },
      {
        label: 'Calibration Template Master',
        path: '/calibration-templates',
        disabled: false,
        permission: 'View Calibration Template',
      },
      {
        label: 'Asset Calibration Table',
        path: '/asset-calibrations',
        disabled: false,
        permission: 'View Asset Calibration',
      },
      {
        label: 'Table 11 Factor Master',
        path: '/table11-factors',
        requiredPermission: 'View Asset Calibration',
        disabled: false,
      },
      {
        label: 'Asset Assignment',
        path: '/asset-assignments',
        disabled: false,
        permission: 'View Asset Assignment',
      },
      {
        label: 'Asset Assignment Summary',
        path: '/asset-assignment-summary',
        disabled: false,
        permission: 'View Asset Assignment Summary',
      },
    ],
  },
  {
    label: 'Operations',
    type: 'dropdown',
    items: [
      {
        label: 'Operation Type Master',
        path: '/operation-types',
        disabled: false,
        permission: 'View Operation Type',
      },
      {
        label: 'Tank Operation Master',
        path: '/tank-operations',
        disabled: false,
        permission: 'View Tank Operation',
      },
      {
        label: 'Location Operation Availability',
        path: '/location-operation-availability',
        disabled: false,
        permission: 'View Location Operation Availability',
      },
      {
        label: 'Operation Template Master',
        path: '/operation-templates',
        disabled: false,
        permission: 'View Operation Template',
      },
      {
        label: 'Operation Entry',
        path: '/operation-entry',
        disabled: false,
        permission: 'Create Operation Entry',
      },
      {
        label: 'Convoy Tracker',
        path: '/convoy-tracker',
        disabled: false,
      },
      {
        label: 'Operation Transaction Register',
        path: '/operation-transactions',
        disabled: false,
        permission: 'View Operation Transaction',
      },
    ],
  },
  {
    label: 'Reports',
    type: 'dropdown',
    items: [
      {
        label: 'Tank Stock Ledger',
        path: '/tank-stock-ledger',
        disabled: false,
        permission: 'View Tank Stock Ledger',
      },
      {
        label: 'User Access Report - Coming Soon',
        path: '',
        disabled: true,
        permission: 'View Reports',
      },
      {
        label: 'Asset Report - Coming Soon',
        path: '',
        disabled: true,
        permission: 'View Reports',
      },
      {
        label: 'Calibration Report - Coming Soon',
        path: '',
        disabled: true,
        permission: 'View Reports',
      },
      {
        label: 'Operation Report - Coming Soon',
        path: '',
        disabled: true,
        permission: 'View Reports',
      },
    ],
  },
  {
    label: 'Admin',
    type: 'dropdown',
    items: [
      {
        label: 'Company Report Profile Master',
        path: '/company-report-profiles',
        disabled: false,
      },
      {
        label: 'Barge Seal Master',
        path: '/barge-seal-master',
        requiredPermission: 'View Barge Seal Master',
      },
      {
        label: 'System Settings - Coming Soon',
        path: '',
        disabled: true,
        permission: 'View Admin Settings',
      },
      {
        label: 'Location Accounting Day Settings',
        path: '/location-accounting-day-settings',
        disabled: false,
        permission: 'View Location Accounting Day Setting',
      },
      {
        label: 'Audit Logs',
        path: '/audit-logs',
        requiredPermission: 'View Audit Log',
      },
    ],
  },
]
