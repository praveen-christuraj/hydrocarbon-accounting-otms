STANDARD_PERMISSIONS = [
    # User Management
    {
        "permission_name": "View User",
        "module_name": "User Master",
        "description": "Can view users",
    },
    {
        "permission_name": "Manage User",
        "module_name": "User Master",
        "description": "Can create, update, and delete users",
    },
    {
        "permission_name": "View Role",
        "module_name": "Role Master",
        "description": "Can view roles",
    },
    {
        "permission_name": "Manage Role",
        "module_name": "Role Master",
        "description": "Can create, update, and delete roles",
    },
    {
        "permission_name": "View Permission",
        "module_name": "Permission Master",
        "description": "Can view permissions",
    },
    {
        "permission_name": "Manage Permission",
        "module_name": "Permission Master",
        "description": "Can create, update, and delete permissions",
    },
    {
        "permission_name": "View Role Permission Assignment",
        "module_name": "Role Permission Assignment",
        "description": "Can view role permission assignments",
    },
    {
        "permission_name": "Manage Role Permission Assignment",
        "module_name": "Role Permission Assignment",
        "description": "Can assign permissions to roles",
    },
    {
        "permission_name": "View User Role Assignment",
        "module_name": "User Role Assignment",
        "description": "Can view user role assignments",
    },
    {
        "permission_name": "Manage User Role Assignment",
        "module_name": "User Role Assignment",
        "description": "Can assign roles to users",
    },
    {
        "permission_name": "View Access Summary",
        "module_name": "Access Summary",
        "description": "Can view final RBAC access summary",
    },
    {
        "permission_name": "View Dashboard",
        "module_name": "Dashboard",
        "description": "Can view dashboard configurations",
    },
    {
        "permission_name": "Manage Dashboard",
        "module_name": "Dashboard",
        "description": "Can create, update, publish, and revert dashboards",
    },
    # Master Data
    {
        "permission_name": "View Location",
        "module_name": "Location Master",
        "description": "Can view locations",
    },
    {
        "permission_name": "Manage Location",
        "module_name": "Location Master",
        "description": "Can create, update, and delete locations",
    },
    {
        "permission_name": "View Location Accounting Day Setting",
        "module_name": "Location Accounting Day Setting",
        "description": "Can view location-wise accounting day settings",
    },
    {
        "permission_name": "Manage Location Accounting Day Setting",
        "module_name": "Location Accounting Day Setting",
        "description": "Can create, update, and delete location-wise accounting day settings",
    },
    {
        "permission_name": "View Asset Type",
        "module_name": "Asset Type Master",
        "description": "Can view asset types",
    },
    {
        "permission_name": "Manage Asset Type",
        "module_name": "Asset Type Master",
        "description": "Can create, update, and delete asset types",
    },
    {
        "permission_name": "View Asset",
        "module_name": "Asset Master",
        "description": "Can view assets",
    },
    {
        "permission_name": "Manage Asset",
        "module_name": "Asset Master",
        "description": "Can create, update, and delete assets",
    },
    {
        "permission_name": "View Calibration Template",
        "module_name": "Calibration Template Master",
        "description": "Can view calibration templates",
    },
    {
        "permission_name": "Manage Calibration Template",
        "module_name": "Calibration Template Master",
        "description": "Can create, update, and delete calibration templates",
    },
    {
        "permission_name": "View Asset Calibration",
        "module_name": "Asset Calibration Table",
        "description": "Can view asset calibration tables",
    },
    {
        "permission_name": "Manage Asset Calibration",
        "module_name": "Asset Calibration Table",
        "description": "Can create, upload, update, and delete calibration data",
    },
    {
        "permission_name": "View Asset Assignment",
        "module_name": "Asset Assignment",
        "description": "Can view asset assignments",
    },
    {
        "permission_name": "Manage Asset Assignment",
        "module_name": "Asset Assignment",
        "description": "Can create, update, and delete asset assignments",
    },
    {
        "permission_name": "View Asset Assignment Summary",
        "module_name": "Asset Assignment Summary",
        "description": "Can view asset assignment summary",
    },
    # Operations
    {
        "permission_name": "View Operation Type",
        "module_name": "Operations",
        "description": "Can view operation type master",
    },
    {
        "permission_name": "Manage Operation Type",
        "module_name": "Operations",
        "description": "Can create, update, and delete operation types",
    },
    {
        "permission_name": "View Tank Operation",
        "module_name": "Operations",
        "description": "Can view location-wise tank operation master",
    },
    {
        "permission_name": "Manage Tank Operation",
        "module_name": "Operations",
        "description": "Can create, update, and delete location-wise tank operations",
    },
    {
        "permission_name": "View Vessel Operation",
        "module_name": "Operations",
        "description": "Can view Vessel Operation Master (soft-coded Loading/Unloading/STS/Decanting etc.)",
    },
    {
        "permission_name": "Manage Vessel Operation",
        "module_name": "Operations",
        "description": "Can create, update, and delete Vessel Operation Master entries",
    },
    {
        "permission_name": "View Vessel Stock Ledger",
        "module_name": "Operations",
        "description": "Can view Vessel Stock Ledger (approved-only derived ledger for Shuttle/FSO)",
    },
    {
        "permission_name": "View Movement Mapping",
        "module_name": "Operations",
        "description": "Can view Movement Mapping and reconciliation comparisons",
    },
    {
        "permission_name": "Manage Movement Mapping",
        "module_name": "Operations",
        "description": "Can create/update/close Movement Mapping and attach approved tickets for reconciliation",
    },
    {
        "permission_name": "View Shuttle Tracking",
        "module_name": "Operations",
        "description": "Can view Shuttle Tracking (Approved-only voyage tracking within location)",
    },
    {
        "permission_name": "Manage Shuttle Tracking",
        "module_name": "Operations",
        "description": "Can close/reopen Shuttle voyages",
    },
    {
        "permission_name": "View FSO Tracking",
        "module_name": "Operations",
        "description": "Can view FSO Tracking (Approved-only, shuttle-number based)",
    },
    {
        "permission_name": "Manage FSO Tracking",
        "module_name": "Operations",
        "description": "Can close/reopen FSO voyages",
    },
    {
        "permission_name": "View Tank Stock Ledger",
        "module_name": "Operations",
        "description": "Can view tank stock ledger and stock movement summary",
    },
    {
        "permission_name": "Manage Tank Stock Ledger",
        "module_name": "Operations",
        "description": "Can rebuild or manage tank stock ledger entries",
    },
    {
        "permission_name": "View Location Operation Availability",
        "module_name": "Operations",
        "description": "Can view location operation availability",
    },
    {
        "permission_name": "Manage Location Operation Availability",
        "module_name": "Operations",
        "description": "Can configure operation availability by location",
    },
    {
        "permission_name": "View Operation Template",
        "module_name": "Operations",
        "description": "Can view operation templates",
    },
    {
        "permission_name": "Manage Operation Template",
        "module_name": "Operations",
        "description": "Can create, update, and delete operation templates",
    },
    {
        "permission_name": "Create Operation Entry",
        "module_name": "Operations",
        "description": "Can create new operation tickets from Operation Entry",
    },
    {
        "permission_name": "View Operation Transaction",
        "module_name": "Operations",
        "description": "Can view operation transaction register and detail",
    },
    {
        "permission_name": "Submit Operation Transaction",
        "module_name": "Operations",
        "description": "Can submit draft operation tickets",
    },
    {
        "permission_name": "Review Operation Transaction",
        "module_name": "Operations",
        "description": "Can review operation tickets before submit/approve confirmation",
    },
    {
        "permission_name": "Approve Operation Transaction",
        "module_name": "Operations",
        "description": "Can approve submitted operation tickets",
    },
    {
        "permission_name": "Reject Operation Transaction",
        "module_name": "Operations",
        "description": "Can reject submitted operation tickets",
    },
    {
        "permission_name": "Cancel Operation Transaction",
        "module_name": "Operations",
        "description": "Can cancel draft or rejected operation tickets",
    },
    {
        "permission_name": "Request Approved Transaction Correction",
        "module_name": "Operations",
        "description": "Can request admin revoke for approved operation tickets that need correction",
    },
    {
        "permission_name": "View Approved Transaction Correction Requests",
        "module_name": "Operations",
        "description": "Can view approved transaction correction and revoke requests",
    },
    {
        "permission_name": "Admin Revoke Approved Transaction",
        "module_name": "Operations",
        "description": "Can revoke approval and push approved tickets back to submitted review",
    },
    # Barge Seal Master
    {
        "permission_name": "View Barge Seal Master",
        "module_name": "Barge Seal Master",
        "description": "Can view barge seal master",
    },
    {
        "permission_name": "Manage Barge Seal Master",
        "module_name": "Barge Seal Master",
        "description": "Can create/update barge seal master",
    },
    # Flowmeter Configuration / Records
    {
        "permission_name": "View Flowmeter Config",
        "module_name": "Flowmeter Config",
        "description": "Can view flowmeter meter configuration by location and asset",
    },
    {
        "permission_name": "Manage Flowmeter Config",
        "module_name": "Flowmeter Config",
        "description": "Can create, update, and delete flowmeter meter configuration",
    },
    {
        "permission_name": "View Flowmeter Record",
        "module_name": "Flowmeter Record",
        "description": "Can view flowmeter meter records",
    },
    {
        "permission_name": "Create Flowmeter Record",
        "module_name": "Flowmeter Record",
        "description": "Can create flowmeter meter records",
    },
    # Company / Report Profiles
    {
        "permission_name": "View Company Report Profile",
        "module_name": "Company Report Profile",
        "description": "Can view company report profiles used for printable reports",
    },
    {
        "permission_name": "Manage Company Report Profile",
        "module_name": "Company Report Profile",
        "description": "Can create, update, and delete company report profiles",
    },
    # Audit Logs
    {
        "permission_name": "View Audit Log",
        "module_name": "Audit Log",
        "description": "Can view system audit logs",
    },
    # System Notifications
    {
        "permission_name": "View System Notification",
        "module_name": "System Notification",
        "description": "Can view system notifications and user notification inbox",
    },
    {
        "permission_name": "Manage System Notification",
        "module_name": "System Notification",
        "description": "Can create and update system notifications",
    },
    {
        "permission_name": "Publish System Notification",
        "module_name": "System Notification",
        "description": "Can publish system notifications to users",
    },
    {
        "permission_name": "Deactivate System Notification",
        "module_name": "System Notification",
        "description": "Can deactivate published system notifications",
    },
    {
        "permission_name": "Acknowledge System Notification",
        "module_name": "System Notification",
        "description": "Can acknowledge or dismiss assigned system notifications",
    },
    {
        "permission_name": "View System Notification Delivery Report",
        "module_name": "System Notification",
        "description": "Can view delivery, seen, dismissed, and acknowledgement reports",
    },
    # Backup Recovery
    {
        "permission_name": "View Backup",
        "module_name": "Backup Recovery",
        "description": "Can view backup settings and backup job history",
    },
    {
        "permission_name": "Create Manual Backup",
        "module_name": "Backup Recovery",
        "description": "Can create a manual database backup",
    },
    {
        "permission_name": "Manage Backup Settings",
        "module_name": "Backup Recovery",
        "description": "Can configure automatic backup schedule and retention settings",
    },
    {
        "permission_name": "Download Backup",
        "module_name": "Backup Recovery",
        "description": "Can download completed backup files",
    },
    {
        "permission_name": "Verify Backup Checksum",
        "module_name": "Backup Recovery",
        "description": "Can verify backup file checksum integrity",
    },
    {
        "permission_name": "Delete Backup",
        "module_name": "Backup Recovery",
        "description": "Can delete backup files while preserving backup job history",
    },
    {
        "permission_name": "Run Backup Cleanup",
        "module_name": "Backup Recovery",
        "description": "Can run retention cleanup for old backup files",
    },
    {
        "permission_name": "Request Backup Restore",
        "module_name": "Backup Recovery",
        "description": "Can request restore approval for a completed backup",
    },
    {
        "permission_name": "Approve Backup Restore",
        "module_name": "Backup Recovery",
        "description": "Can approve backup restore requests without executing restore",
    },
    {
        "permission_name": "Reject Backup Restore",
        "module_name": "Backup Recovery",
        "description": "Can reject backup restore requests",
    },
    {
        "permission_name": "Validate Backup Restore",
        "module_name": "Backup Recovery",
        "description": "Can validate an approved backup restore request against a separate validation database",
    },
    {
        "permission_name": "Execute Backup Restore",
        "module_name": "Backup Recovery",
        "description": "Can execute a validated backup restore into the production database",
    },
    # Reports / Admin
    {
        "permission_name": "View Reports",
        "module_name": "Reports",
        "description": "Can view reports",
    },
    {
        "permission_name": "Export Reports",
        "module_name": "Reports",
        "description": "Can export reports",
    },
    {
        "permission_name": "View Admin Settings",
        "module_name": "Admin",
        "description": "Can view admin settings",
    },
    {
        "permission_name": "Manage Admin Settings",
        "module_name": "Admin",
        "description": "Can manage admin settings",
    },
    {
        "permission_name": "View Out-Turn Report",
        "module_name": "Reports",
        "description": "Can view Out-Turn Report from approved tank stock ledger rows",
    },
    {
        "permission_name": "View Material Balance Report",
        "module_name": "Reports",
        "description": "Can view Material Balance Report from tank stock ledger",
    },
    {
        "permission_name": "View Material Balance Template",
        "module_name": "Configuration",
        "description": "Can view Material Balance template configuration",
    },
    {
        "permission_name": "Manage Material Balance Template",
        "module_name": "Configuration",
        "description": "Can create, edit, and delete Material Balance template configuration",
    },
    {
        "permission_name": "View Operation Workflow Policy",
        "module_name": "Operations",
        "description": "Can view operation workflow authorization policies",
    },
    {
        "permission_name": "Manage Operation Workflow Policy",
        "module_name": "Operations",
        "description": "Can create, update, and delete operation workflow authorization policies",
    },
    {
        "permission_name": "View My Tasks",
        "module_name": "Operations",
        "description": "Can view assigned operation approval tasks",
    },
    {
        "permission_name": "Act On Operation Task",
        "module_name": "Operations",
        "description": "Can take, release, approve, or reject assigned operation tasks",
    },
    {
        "permission_name": "Manage Operation Tasks",
        "module_name": "Operations",
        "description": "Can view and manage all operation approval tasks",
    },
    {
        "permission_name": "View Own Security Settings",
        "module_name": "User Security",
        "description": "Can view own password and 2FA security settings",
    },
    {
        "permission_name": "Manage Own Security Settings",
        "module_name": "User Security",
        "description": "Can change own password and manage own 2FA settings",
    },
    {
        "permission_name": "Request Password Reset",
        "module_name": "User Security",
        "description": "Can request administrator password reset",
    },
    {
        "permission_name": "Reset User Password",
        "module_name": "User Security",
        "description": "Can hard reset user passwords",
    },
    {
        "permission_name": "Reset User 2FA",
        "module_name": "User Security",
        "description": "Can reset user 2FA during administrator password reset",
    },
]
