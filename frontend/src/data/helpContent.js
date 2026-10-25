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
      'In Assign Permissions, "Apply a preset" replaces or adds to the selection in one step; review it and select Save Permissions.',
      '"Save selection as preset" stores the ticked permissions as a reusable preset (see Permission Presets).',
    ],
  },

  '/permission-presets': {
    title: 'Permission Presets Help',
    description:
      'A permission preset is a named, reusable set of permissions. Build it once and apply it to one role or many instead of ticking permissions one by one.',
    points: [
      'Standard presets (read only, and view only / full access per menu) are built from the permission catalog and are always available.',
      'Saved presets: up to 20, each with a unique name and at least one permission. Load permissions from a role or another preset to start quickly.',
      'Apply in Replace mode to give the roles exactly the preset, or in Add mode to keep what they already have.',
      'Every applied change goes through Role Permission Assignment and is recorded in the audit log.',
      'The Admin role, inactive roles and roles holding permissions you do not have cannot receive a preset.',
      'Saved presets are kept in this browser; use Export and Bulk Upload to copy them to another computer.',
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
      'Every Print button in every module first asks which company report profile to use for that print-out.',
      'Profiles are global: once saved here, any user can select them when printing.',
      'Active profiles are listed first; Inactive or Blocked profiles stay selectable but are clearly marked.',
      'Footer formula and footer note appear in every printed report.',
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
      'This legacy page is disabled in the frontend. Use Tank Operation Summary and Out-Turn Summary instead.',
    points: [
      'Tank Operation Summary is the active page for chronological approved tank entries.',
      'Out-Turn Summary is the active page for previous-vs-current subtraction workflow.',
      'The legacy Tank Stock Ledger code is still retained in the project.',
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
      'This legacy page is disabled in the frontend. Use Out-Turn Summary instead.',
    points: [
      'Out-Turn Summary is the active page for approved entries and previous-value subtraction logic.',
      'The legacy Out-Turn Report code is still retained in the project.',
    ],
  },

  '/material-balance-template-master': {
    title: 'Material Balance Template Help',
    description:
      'Material Balance Template allows users to configure location-wise Material Balance columns from Tank Operations without hardcoding location-specific report layouts.',
    points: [
      'The Material Balance Report uses the newest Active template of each location – the list shows which template is "Used by report". Use "Use for report" to switch.',
      'New Template can build the columns from the Tank Operations of the location in one step, copy another template, or start empty.',
      'Keep a new template Inactive while you configure it, so the report keeps using the current template.',
      'OPENING columns show the previous day\'s closing stock, or the day\'s Opening Stock entry.',
      'MOVEMENT columns add up the Tank Operations ticked under Count. IN columns hold receipts / production, OUT columns dispatches / draining.',
      'Mark Internal Tank Transfer (ITT) columns as internal transfer so they never count in Book Closing.',
      'Book Closing, Actual Closing and Loss/Gain columns are calculated by the report engine.',
      'The checks under the report preview list Tank Operations that are not in any column, unknown codes and missing standard columns.',
    ],
  },

  '/user-locations': {
    title: 'User Location Assignment Help',
    description:
      'Assign locations to users for location-based access control. Users bound to locations can only access data from those locations.',
    points: [
      'Only Active users are available for location assignment.',
      'Only Active locations are available for selection.',
      'Users can have multiple locations assigned.',
      '"All Locations Access" overrides individual assignments — the user can access every location.',
      'If "All Locations Access" is set to "No", the user is restricted to their individually assigned locations.',
      'Use the Edit button to update a user\'s location assignments and access flag.',
    ],
  },

  '/role-locations': {
    title: 'Role Location Assignment Help',
    description:
      'Give every user of a role the same locations in one place. The role scope is additive with the locations assigned to the user directly.',
    points: [
      'Effective location scope = user locations (User Location Assignment) UNION role locations of every active role the user holds.',
      'A role can only widen a user\'s scope — it never removes a location that was assigned directly to the user.',
      'Only Active roles and Active locations are available for selection.',
      'The reserved Admin role always has unrestricted access and cannot be scoped.',
      'A location-restricted administrator can only hand out locations inside their own scope.',
      'Saving a role replaces its whole location list; remove the checkboxes and save to clear it.',
      'The change is audited (Role Location Assignment module) like every other master-data update.',
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
  '/export-operations': {
    title: 'Export Operations Help',
    description:
      'Export Operations page manages all export-related activities across locations, entities, and oil blocks.',
    points: [
      'Dashboard tab shows KPIs, permit statuses, and recent export transactions.',
      'Export Data tab is for entering and managing export volumes with BL date, location, entity, block, volume, consignee, destination, and country.',
      'The system automatically calculates the quarter from the BL date.',
      'Bulk Upload feature allows uploading CSV files or entering multiple rows for back-data entry.',
      'Reports tab generates export reports with filters and supports CSV export and print/PDF.',
      'Configuration tab allows managing soft-coded locations, entities, blocks, permits, and system settings.',
      'Permits are tracked per quarter. When usage exceeds the configured threshold, a warning is shown on the Dashboard.',
      'All actions are audited in the Audit Log.',
    ],
  },
  '/report-builder': {
    title: 'Report Builder Help',
    description:
      'Report Builder lets you design your own tabular and matrix (cross-tab) reports from any saved data, in plain English — no SQL and no IT help. Published reports appear in the Reporting menu for exactly the people you choose.',
    points: [
      'Step 1: choose where the data comes from. “Operation Tickets” includes every answer typed on tickets; the Tank Stock Ledger covers stock movements; any other table can also be reported. Pick which date the From–To filter should use — Accounting Date is recommended for stock accounting.',
      'Step 2: add columns. Values saved inside JSON payloads (Tank Gauging, Tanker, Multi-Tank/Barge, Flowmeter, FSO, Shuttle) are split into separate columns with “Split into columns”, including one-row-per-tank splits for per-tank dips.',
      'Calculated columns do +, −, ×, ÷ and % (percent of) across two or more columns, plus IF, IFS, AND, OR, NOT and helpers like IFERROR and COALESCE. Build them by clicking or with the IF/Bands composers; the formula is checked as you type.',
      'Step 3: choose detail rows or a grouped summary (Total/Average/Count per group), or lay out a matrix (rows × columns × values). Fixed conditions here always apply and cannot be changed by report users.',
      'Step 4: add the questions report users answer at run time (location, operation type, status, asset, or a filter on any column).',
      'Step 5: give access to named users, roles, or everyone at chosen locations (View = run/export/print, Edit = also redesign), or open the report to all report users. Publishing needs the Publish Report Definition permission.',
      'Data is always limited to the runner’s own locations, passwords/secrets can never be reported, and every save keeps a design version for audit.',
    ],
  },
  '/reporting/custom-reports': {
    title: 'Custom Reports Help',
    description:
      'Custom Reports are built in Configurations → Report Builder and shared with specific users, roles or locations. Each shared report also appears by name in this Reporting menu.',
    points: [
      'Choose the date range and answer the report’s filter questions, then Run Report. Dates follow the date basis chosen by the designer (usually the Accounting Date).',
      'You only ever see data for your own locations, even when a report is shared company-wide.',
      'Excel/CSV buttons download all matching rows from the server; “Export this page / PDF” exports what is on screen; Print asks for a Company Report Profile and prints the full result with company branding.',
      '“About this report” explains every calculated column in words, so figures can be verified without seeing the design.',
      'Cells that could not be calculated (for example a division by zero) show blank with a ⚠ marker and are counted in the warnings above the table.',
    ],
  },
}
