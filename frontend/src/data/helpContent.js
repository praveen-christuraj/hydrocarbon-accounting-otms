export const helpContent = {
  '/': {
    title: 'Dashboard Help',
    description:
      'The dashboard is the starting point of the application. It gives quick access to all configuration and management modules.',
    points: [
      'Use User Management for users, roles, permissions, and RBAC setup.',
      'Use Master Data for locations, assets, asset types, calibration templates, and calibration uploads.',
      'Use Operations later for daily operational activities such as loading, transfer, vessel operations, and calculations.',
      'Reports and Admin modules will be expanded later.',
    ],
  },

  '/users': {
    title: 'User Master Help',
    description:
      'User Master is used to create and manage application users who will log in to the system.',
    points: [
      'Username must be unique. Duplicate usernames are not allowed.',
      'Password is captured now only for frontend testing. Later, backend will store only hashed passwords.',
      'Status controls whether the user is available for role assignment.',
      'Only Active users can be assigned roles.',
    ],
  },

  '/roles': {
    title: 'Role Master Help',
    description:
      'Role Master is used to create access groups such as Admin, Manager, Supervisor, Operator, and Viewer.',
    points: [
      'Role names must be unique.',
      'Roles do not directly give access until permissions are assigned to them.',
      'Inactive roles will not be available for assignment to users.',
      'Example: Admin can later receive all permissions, while Viewer may receive only view permissions.',
    ],
  },

  '/permissions': {
    title: 'Permission Master Help',
    description:
      'Permission Master defines the individual actions that can be allowed or restricted in the system.',
    points: [
      'Examples: View User, Create User, Edit User, Delete User.',
      'Permissions are linked to modules such as User Master or Asset Master.',
      'Duplicate permission names are not allowed within the same module.',
      'Permissions are later assigned to roles in Role Permission Assignment.',
    ],
  },

  '/role-permissions': {
    title: 'Role Permission Assignment Help',
    description:
      'This page connects roles with permissions. This is the main RBAC control page.',
    points: [
      'Select a role and tick the permissions that role should have.',
      'Example: Viewer may get only View permissions.',
      'Example: Admin may get View, Create, Edit, and Delete permissions.',
      'These permissions are later inherited by users assigned to that role.',
    ],
  },

  '/user-roles': {
    title: 'User Role Assignment Help',
    description:
      'This page assigns a role to a user. After this, the user receives the permissions of that role.',
    points: [
      'Only Active users are available for role assignment.',
      'Only Active roles are available for selection.',
      'Currently, one user can have one role.',
      'Later, we can allow multiple roles per user if required.',
    ],
  },

  '/access-summary': {
    title: 'Access Summary Help',
    description:
      'Access Summary shows the final RBAC chain: User → Role → Permissions.',
    points: [
      'Use this page to verify whether the RBAC setup is correct.',
      'If a user has no role, assign one in User Role Assignment.',
      'If a role has no permissions, assign them in Role Permission Assignment.',
      'Later, the backend will enforce these permissions securely.',
    ],
  },

  '/locations': {
    title: 'Location Master Help',
    description:
      'Location Master is used to create operational locations such as terminals, tank farms, jetties, offices, and warehouses.',
    points: [
      'Location Code must be unique.',
      'Parent Location can be used to create hierarchy.',
      'Example: Region → Terminal → Tank Farm → Jetty.',
      'Only Active locations are available for assets and assignments.',
    ],
  },

  '/asset-types': {
    title: 'Asset Type Master Help',
    description:
      'Asset Type Master is used to soft-code asset categories. Asset types should not be hardcoded in the program.',
    points: [
      'Examples: Storage Tank, Metering Skid, Barge, Shuttle Vessel, Pump, Valve.',
      'Asset Type Code must be unique.',
      'Asset Master will use the asset types created here.',
      'Calibration templates can also be linked to asset types.',
    ],
  },

  '/assets': {
    title: 'Asset Master Help',
    description:
      'Asset Master is the centralized asset registry. It stores basic identity and technical details of each asset.',
    points: [
      'Asset Code must be unique.',
      'Asset Scope can be Local or Global.',
      'Local Asset requires a primary location.',
      'Global Asset can be available for multiple locations and does not require a fixed location.',
      'Calibration tables and assignments are managed separately from Asset Master.',
    ],
  },

  '/calibration-templates': {
    title: 'Calibration Template Master Help',
    description:
      'Calibration Template Master defines the expected XLSX/CSV structure for calibration uploads.',
    points: [
      'This avoids hardcoding calibration table columns in the code.',
      'Admin defines expected columns such as Dip, Volume, Trim, Correction, or Meter Factor.',
      'Input X means the main input column used for interpolation.',
      'Input Y is used for two-dimensional interpolation such as Ullage + Trim.',
      'Output is the calculated result such as Volume or Meter Factor.',
      'Correction is used for adjustment values such as Trim Correction or Heel Correction.',
      'Reference is only identification information such as Tank Name.',
    ],
  },

  '/asset-calibrations': {
    title: 'Asset Calibration Table Help',
    description:
      'Asset Calibration Table is used to upload XLSX/CSV calibration files for assets.',
    points: [
      'Only Active assets can receive calibration tables.',
      'Only XLSX and CSV files are allowed.',
      'Select a calibration template before uploading the file.',
      'Only one Active calibration table of the same type is allowed for one asset.',
      'Later, the uploaded file will be validated against the selected calibration template.',
      'The backend will use the uploaded data for interpolation and volume/correction calculations.',
    ],
  },

  '/asset-assignments': {
    title: 'Asset Assignment Help',
    description:
      'Asset Assignment tracks asset responsibility, deployment location, and assignment history.',
    points: [
      'Only Active assets can be assigned.',
      'Only Active locations can be selected as assignment locations.',
      'Local assets can have only one Active assignment at a time.',
      'Global assets can have multiple Active assignments across different locations.',
      'Global assets cannot have duplicate Active assignments for the same asset and same location.',
      'Assignment History keeps all active, returned, inactive, and blocked records.',
    ],
  },

  '/asset-assignment-summary': {
    title: 'Asset Assignment Summary Help',
    description:
      'Asset Assignment Summary gives a read-only view of current asset deployment and responsibility.',
    points: [
      'Local assets normally show one current active assignment.',
      'Global assets may show multiple active assignment locations.',
      'Unassigned assets are shown clearly for follow-up.',
      'Use Asset Assignment page to create, update, return, or close assignments.',
      'This page will later become useful for asset reports and operational dashboards.',
    ],
  },

  '/company-report-profiles': {
    title: 'Company Report Profile Master Help',
    description:
      'Company Report Profile Master is used to create and manage company names, logos, report subtitles, and footer notes used in printable reports.',
    points: [
      'Create one profile for each allied company or reporting entity.',
      'Company logo can be uploaded as PNG, JPG, or JPEG.',
      'If no logo is uploaded, the report will show the logo placeholder text.',
      'Only Active profiles should normally be used for new printable reports.',
      'Footer formula and footer note appear in Tank Gauging report output.',
      'Profiles are saved in the backend database and are no longer browser-only local settings.',
    ],
  },

  '/audit-logs': {
    title: 'Audit Log Help',
    description:
      'Audit Log is a read-only system trail showing important actions performed by users across operation transactions and future modules.',
    points: [
      'Use this page to review who created, submitted, approved, rejected, recalled, or cancelled an operation transaction.',
      'Filter by module, action, ticket number, operation number, performed by, and date range.',
      'Status Change shows the old status and new status for workflow actions.',
      'Details shows extra technical information such as operation type, asset, location, and operation date.',
      'Audit logs are read-only and should not be manually edited by users.',
      'Future modules can reuse this same audit pattern.',
    ],
  },

  '/tank-operations': {
    title: 'Tank Operation Master Help',
    description:
      'Tank Operation Master is used to configure location-wise tank operation terminology for Tank Gauging and future inventory calculations.',
    points: [
      'Operations are configured per location so each site can use its own terminology.',
      'Operation Code must be unique within the same location.',
      'Operation Label must be unique within the same location.',
      'Operation Category is the standard system category used for future stock calculations.',
      'Operation Sign controls stock behavior: SET declares balance, IN increases stock, OUT decreases stock, and NEUTRAL has no stock effect.',
      'Only Active Tank Operations will later be shown in the Tank Gauging Entry dropdown.',
    ],
  },

  '/tank-stock-ledger': {
    title: 'Tank Stock Ledger Help',
    description:
      'Tank Stock Ledger shows approved Tank Gauging stock movements and running balances.',
    points: [
      'Ledger rows are created automatically when a Tank Gauging ticket is approved.',
      'SET operations declare the running balance, usually Opening Stock or Closing Stock.',
      'IN operations increase stock, such as Receipt or Production.',
      'OUT operations decrease stock, such as Dispatch or Draining.',
      'Use filters to view ledger rows by location, tank, product, status, and date range.',
      'Stock Summary groups movements by Location, Tank, and Product.',
    ],
  },

  '/location-accounting-day-settings': {
    title: 'Location Accounting Day Settings Help',
    description:
      'This page configures the operational accounting day window for each location. Tank Stock Ledger and daily closing reports use this setting instead of assuming midnight-to-midnight.',
    points: [
      'Each location can have its own accounting day start and end time.',
      'Example: 06:01 to 06:00 means the accounting day starts at 06:01 and closes at 06:00 the next calendar day.',
      'Example: 08:01 to 08:00 means the accounting day starts at 08:01 and closes at 08:00 the next calendar day.',
      'Only one Active setting is allowed for the same location within an overlapping effective period.',
      'Use Effective From and Effective To to change accounting windows historically without breaking previous ledger records.',
      'These settings will be used when approved Tank Gauging tickets are converted into Tank Stock Ledger rows.',
    ],
  },
  '/convoy-tracker': {
    title: 'Convoy Tracker Help',
    description:
      'Convoy Tracker groups all tickets under a Convoy Number and builds the trip timeline using Trip Events (LOAD/UNLOAD/STS).',
    points: [
      'Search by Convoy Number to list all related tickets grouped by barge/asset.',
      'Use “Link Event” to tag a ticket as LOAD_1, UNLOAD, STS_OUT, STS_IN, etc.',
      'After at least one event is linked, the Trip timeline becomes available.',
      'Comparisons will be auto-generated in the next step (Load After vs Unload Before).',
    ],
  },
  '/shuttle-tracking': {
    title: 'Shuttle Tracking Help',
    description:
      'Track Shuttle vessel voyages within a single location using Approved tickets only. Create loading/top-up/STS/unloading actions from this page using soft-coded Vessel Operations.',
    points: [
      'Tracking key = Location + Shuttle Number + Shuttle Asset.',
      'Only Approved tickets appear in tracking and reconciliation.',
      'Stages are soft-coded in Vessel Operation Master (use Show In = Tracking for STS IN/OUT).',
      'Close Voyage locks new approvals until reopened.',
      'Use Movement Mapping (BARGE → SHUTTLE) to reconcile Barge unload totals to Shuttle loading totals.',
    ],
  },
  '/out-turn-report': {
    title: 'Out-Turn Report Help',
    description:
      'Out-Turn Report shows approved Tank Gauging tickets in chronological order and calculates net receipt or dispatch values from previous and current tank stock.',
    points: [
      'Tank Gauging quantity is treated as the stock available in the tank after the operation.',
      'Receipt volume is calculated as current stock after receipt minus previous stock.',
      'Dispatch volume is calculated as previous stock minus current stock after dispatch.',
      'Opening and Closing Stock entries are stock declarations and are not treated as receipt or dispatch movement.',
      'The report uses accounting date, so it respects the location-wise accounting day window such as 06:01 to 06:00 or 08:01 to 08:00.',
      'The first entry for each tank/product should normally be Opening Stock so previous stock is known.',
    ],
  },

  '/material-balance-template-master': {
    title: 'Material Balance Template Help',
    description:
      'Material Balance Template allows users to configure location-wise Material Balance columns from Tank Operations without hardcoding location-specific report layouts.',
    points: [
      'Create one active template per location for daily Material Balance reporting.',
      'OPENING columns use configured SET operations like Opening Stock.',
      'MOVEMENT columns must be mapped to Tank Operation codes.',
      'IN movement columns can represent Receipt, Production, Receipt from X/Y, or similar terms configured by the user.',
      'OUT movement columns can represent Dispatch, Dispatch to X/Y, Draining, or similar terms configured by the user.',
      'Internal Tank Transfer / ITT columns should be marked as internal transfer so they are excluded from Material Balance and Book Closing.',
      'Book Closing, Actual Closing, and Loss/Gain columns are calculated by the report engine.',
      'This configuration removes hardcoded location-specific Material Balance columns.',
    ],
  },

  '/material-balance-report': {
    title: 'Material Balance Report Help',
    description:
      'Material Balance Report gives date-wise opening, receipt, production, dispatch, draining, closing, and loss/gain values from approved Tank Stock Ledger rows.',
    points: [
      'Opening stock is taken from the previous accounting day closing stock.',
      'Receipt and production are treated as IN movements.',
      'Dispatch and draining are treated as OUT movements.',
      'Closing stock is automatically taken from the latest approved tank stock entry of the accounting day.',
      'If no entry exists on an accounting day, previous closing is carried forward.',
      'The report respects the location-wise accounting day window such as 06:01 to 06:00 or 08:01 to 08:00.',
      'CSV export, Excel export, and browser print are standard features for this report.',
    ],
  },
}
