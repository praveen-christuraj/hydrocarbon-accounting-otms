"""Standard permission catalog.

Permissions are arranged module-wise, following the application's navigation
menu. Every module exposes the CRUD actions that apply to it:

    View <Entity> / Create <Entity> / Edit <Entity> / Delete <Entity>

plus named workflow actions (Submit, Approve, Close, Reopen, ...) where a
plain CRUD verb would be ambiguous.

The catalog is the single source of truth for:
  * startup seeding (``seed_default_permissions``),
  * the one-time migration from the legacy "Manage <Entity>" permissions
    (``LEGACY_PERMISSION_REPLACEMENTS`` / ``DERIVED_PERMISSION_GRANTS``),
  * ``GET /permissions/catalog`` which the Role Permission Assignment matrix
    and the Permission Master use to group permissions.

This module must stay free of database/application imports so that
standalone scripts (``seed_admin.py``) can import it.
"""

VIEW = "View"
CREATE = "Create"
EDIT = "Edit"
DELETE = "Delete"
OTHER = "Other"

ACTION_ORDER = [VIEW, CREATE, EDIT, DELETE, OTHER]


def _perm(permission_name, action, description):
    return {
        "permission_name": permission_name,
        "action": action,
        "description": description,
    }


def _crud(entity, label=None, actions=(VIEW, CREATE, EDIT, DELETE)):
    """Build the standard CRUD permissions for an entity.

    ``label`` is the plural/human wording used in descriptions.
    """
    noun = label or f"{entity.lower()} records"
    templates = {
        VIEW: f"Can view {noun}",
        CREATE: f"Can create {noun}",
        EDIT: f"Can edit {noun}",
        DELETE: f"Can delete {noun}",
    }
    return [_perm(f"{action} {entity}", action, templates[action]) for action in actions]


PERMISSION_CATALOG = [
    {
        "category": "User Management",
        "modules": [
            {
                "module_name": "User Master",
                "permissions": _crud("User", "users"),
            },
            {
                "module_name": "Role Master",
                "permissions": _crud("Role", "roles"),
            },
            {
                "module_name": "Permission Master",
                "permissions": _crud("Permission", "permissions"),
            },
            {
                "module_name": "Role Permission Assignment",
                "permissions": [
                    _perm("View Role Permission Assignment", VIEW, "Can view role permission assignments"),
                    _perm("Edit Role Permission Assignment", EDIT, "Can assign and remove permissions for roles"),
                ],
            },
            {
                "module_name": "User Role Assignment",
                "permissions": [
                    _perm("View User Role Assignment", VIEW, "Can view user role assignments"),
                    _perm("Edit User Role Assignment", EDIT, "Can assign and change roles for users"),
                    _perm("Delete User Role Assignment", DELETE, "Can remove a role assignment from a user"),
                ],
            },
            {
                "module_name": "User Location Assignment",
                "permissions": [
                    _perm("View User Location Assignment", VIEW, "Can view user location assignments"),
                    _perm("Edit User Location Assignment", EDIT, "Can assign locations and all-locations access to users"),
                    _perm("Delete User Location Assignment", DELETE, "Can remove a location assignment from a user"),
                ],
            },
            {
                "module_name": "Role Location Assignment",
                "permissions": [
                    _perm("View Role Location Assignment", VIEW, "Can view per-role location scopes"),
                    _perm("Edit Role Location Assignment", EDIT, "Can assign locations to roles (additive with the user's own locations)"),
                ],
            },
            {
                "module_name": "Profile & Security",
                "permissions": [
                    _perm("View Own Security Settings", VIEW, "Can view own password and 2FA security settings"),
                    _perm("Edit Own Security Settings", EDIT, "Can change own password and manage own 2FA settings"),
                    _perm("Reset User Password", OTHER, "Can hard reset another user's password"),
                    _perm("Reset User 2FA", OTHER, "Can reset another user's 2FA during an administrator password reset"),
                ],
            },
            {
                "module_name": "Access Summary",
                "permissions": [
                    _perm("View Access Summary", VIEW, "Can view the effective RBAC access summary"),
                ],
            },
        ],
    },
    {
        "category": "Master Data Management",
        "modules": [
            {
                "module_name": "Location Master",
                "permissions": _crud("Location", "locations"),
            },
            {
                "module_name": "Asset Type Master",
                "permissions": _crud("Asset Type", "asset types"),
            },
            {
                "module_name": "Asset Master",
                "permissions": _crud("Asset", "assets"),
            },
            {
                "module_name": "Prime Mover - Tanker Link",
                "permissions": [
                    _perm("View Prime Mover Tanker Link", VIEW, "Can view prime mover to tanker links"),
                    _perm("Create Prime Mover Tanker Link", CREATE, "Can link a prime mover to a tanker"),
                    _perm("Edit Prime Mover Tanker Link", EDIT, "Can edit and close prime mover to tanker links"),
                    _perm("Delete Prime Mover Tanker Link", DELETE, "Can delete prime mover to tanker links"),
                ],
            },
            {
                "module_name": "Calibration Template Master",
                "permissions": _crud("Calibration Template", "calibration templates"),
            },
            {
                "module_name": "Asset Calibration Table",
                "permissions": [
                    _perm("View Asset Calibration", VIEW, "Can view asset calibration tables"),
                    _perm("Create Asset Calibration", CREATE, "Can create and upload asset calibration tables"),
                    _perm("Edit Asset Calibration", EDIT, "Can edit asset calibration tables and data"),
                    _perm("Delete Asset Calibration", DELETE, "Can delete asset calibration tables"),
                ],
            },
            {
                "module_name": "Asset Assignment",
                "permissions": _crud("Asset Assignment", "asset assignments"),
            },
            {
                "module_name": "Asset Assignment Summary",
                "permissions": [
                    _perm("View Asset Assignment Summary", VIEW, "Can view the asset assignment summary"),
                ],
            },
        ],
    },
    {
        "category": "Configurations",
        "modules": [
            {
                "module_name": "Operation Type Master",
                "permissions": _crud("Operation Type", "operation types"),
            },
            {
                "module_name": "Tank Operation Master",
                "permissions": _crud("Tank Operation", "location-wise tank operations"),
            },
            {
                "module_name": "Vessel Operation Master",
                "permissions": _crud("Vessel Operation", "vessel operations (Loading, Unloading, STS, Decanting, ...)"),
            },
            {
                "module_name": "Operation Template Master",
                "permissions": [
                    _perm("View Operation Template", VIEW, "Can view operation templates and layouts"),
                    _perm("Create Operation Template", CREATE, "Can create operation templates"),
                    _perm("Edit Operation Template", EDIT, "Can edit operation templates, layouts and ticket numbering"),
                    _perm("Delete Operation Template", DELETE, "Can delete operation templates"),
                ],
            },
            {
                "module_name": "Operation Workflow Policy",
                "permissions": [
                    _perm("View Operation Workflow Policy", VIEW, "Can view operation workflow authorization policies"),
                    _perm("Create Operation Workflow Policy", CREATE, "Can create operation workflow authorization policies"),
                    _perm("Edit Operation Workflow Policy", EDIT, "Can edit workflow policies and their role/user lists"),
                    _perm("Delete Operation Workflow Policy", DELETE, "Can delete operation workflow authorization policies"),
                ],
            },
            {
                "module_name": "Location Operation Availability",
                "permissions": _crud("Location Operation Availability", "operation availability by location"),
            },
            {
                "module_name": "Table 11 Factor Master",
                "permissions": [
                    _perm("View Table 11 Factor", VIEW, "Can view and look up Table 11 factors"),
                    _perm("Edit Table 11 Factor", EDIT, "Can upload and replace the Table 11 factor table"),
                    _perm("Delete Table 11 Factor", DELETE, "Can clear the Table 11 factor table"),
                ],
            },
            {
                "module_name": "Company Report Profile Master",
                "permissions": _crud("Company Report Profile", "company report profiles used for printable reports"),
            },
            {
                "module_name": "Barge Seal Master",
                "permissions": [
                    _perm("View Barge Seal Master", VIEW, "Can view barge seal master"),
                    _perm("Edit Barge Seal Master", EDIT, "Can create and update barge seal master rows"),
                ],
            },
            {
                "module_name": "Tracking Module Configuration",
                "permissions": [
                    _perm("View Tracking Module Configuration", VIEW, "Can view which operation types feed Barge / Tanker tracking"),
                    _perm("Create Tracking Module Configuration", CREATE, "Can map an operation type to a tracking module and role"),
                    _perm("Edit Tracking Module Configuration", EDIT, "Can change the tracking module, role, stage or status of a mapping"),
                    _perm("Delete Tracking Module Configuration", DELETE, "Can remove an operation type mapping from a tracking module"),
                ],
            },
            {
                "module_name": "Location Accounting Day Settings",
                "permissions": _crud("Location Accounting Day Setting", "location-wise accounting day settings"),
            },
            {
                "module_name": "Material Balance Template",
                "permissions": [
                    _perm("View Material Balance Template", VIEW, "Can view Material Balance templates"),
                    _perm("Create Material Balance Template", CREATE, "Can create Material Balance templates"),
                    _perm("Edit Material Balance Template", EDIT, "Can edit Material Balance templates and their columns"),
                    _perm("Delete Material Balance Template", DELETE, "Can delete Material Balance templates"),
                ],
            },
            {
                "module_name": "Flowmeter Config",
                "permissions": _crud("Flowmeter Config", "flowmeter configuration by location and asset"),
            },
            {
                "module_name": "Report Builder",
                "permissions": [
                    _perm("View Report Definition", VIEW, "Can view custom report designs in the Report Builder"),
                    _perm("Create Report Definition", CREATE, "Can design new custom reports (tabular and matrix) in the Report Builder"),
                    _perm("Edit Report Definition", EDIT, "Can edit custom report designs and their access grants"),
                    _perm("Delete Report Definition", DELETE, "Can delete custom report designs"),
                    _perm("Publish Report Definition", OTHER, "Can publish custom reports into the Reporting module (and unpublish them)"),
                ],
            },
        ],
    },
    {
        "category": "Operations",
        "modules": [
            {
                "module_name": "Operation Entry",
                "permissions": [
                    _perm("Create Operation Entry", CREATE, "Can create new operation tickets from Operation Entry"),
                    _perm("Edit Operation Entry", EDIT, "Can edit Draft and Rejected operation tickets"),
                ],
            },
            {
                "module_name": "Operation Transaction Register",
                "permissions": [
                    _perm("View Operation Transaction", VIEW, "Can view the operation transaction register and ticket detail"),
                    _perm("Submit Operation Transaction", OTHER, "Can submit (and recall) draft operation tickets"),
                    _perm("Review Operation Transaction", OTHER, "Can review operation tickets before submit/approve confirmation"),
                    _perm("Approve Operation Transaction", OTHER, "Can approve submitted operation tickets"),
                    _perm("Reject Operation Transaction", OTHER, "Can reject submitted operation tickets"),
                    _perm("Cancel Operation Transaction", OTHER, "Can cancel Draft or Rejected operation tickets"),
                    _perm("Request Approved Transaction Correction", OTHER, "Can request an admin revoke for approved tickets that need correction"),
                    _perm("Admin Revoke Approved Transaction", OTHER, "Can revoke approval and push approved tickets back to review"),
                ],
            },
            {
                "module_name": "Movement Mapping",
                "permissions": [
                    _perm("View Movement Mapping", VIEW, "Can view movement mappings and reconciliation comparisons"),
                    _perm("Create Movement Mapping", CREATE, "Can create movement mappings"),
                    _perm("Edit Movement Mapping", EDIT, "Can attach and detach approved tickets on a movement mapping"),
                    _perm("Close Movement Mapping", OTHER, "Can close movement mappings"),
                ],
            },
            {
                "module_name": "Flowmeter Records",
                "permissions": [
                    _perm("View Flowmeter Record", VIEW, "Can view flowmeter records"),
                    _perm("Create Flowmeter Record", CREATE, "Can create flowmeter records"),
                ],
            },
            {
                "module_name": "Task Manager",
                "permissions": [
                    _perm("View My Tasks", VIEW, "Can view own operation approval tasks"),
                    _perm("Act On Operation Task", OTHER, "Can take, release, approve or reject assigned operation tasks"),
                    _perm("Supervise Operation Tasks", OTHER, "Can view and release every operation approval task"),
                ],
            },
        ],
    },
    {
        "category": "Operation Tracking",
        "modules": [
            {
                "module_name": "Barge Tracking",
                "permissions": [
                    _perm("View Barge Tracking", VIEW, "Can view barge convoy tracking and trip timelines"),
                    _perm("Edit Barge Tracking", EDIT, "Can acknowledge or revoke barge receipts and record loading corrections"),
                    _perm("Close Barge Movement", OTHER, "Can close barge movements"),
                    _perm("Reopen Barge Movement", OTHER, "Can reopen closed barge movements"),
                ],
            },
            {
                "module_name": "Tanker Tracking",
                "permissions": [
                    _perm("View Tanker Tracking", VIEW, "Can view tanker movement tracking and acknowledgements"),
                    _perm("Edit Tanker Tracking", EDIT, "Can acknowledge tanker receipts and revoke acknowledgements"),
                    _perm("Close Tanker Movement", OTHER, "Can close tanker movements"),
                ],
            },
            {
                "module_name": "Shuttle Tracking",
                "permissions": [
                    _perm("View Shuttle Tracking", VIEW, "Can view shuttle voyage tracking (approved tickets only)"),
                    _perm("Close Shuttle Voyage", OTHER, "Can close shuttle voyages"),
                    _perm("Reopen Shuttle Voyage", OTHER, "Can reopen closed shuttle voyages"),
                ],
            },
            {
                "module_name": "FSO Tracking",
                "permissions": [
                    _perm("View FSO Tracking", VIEW, "Can view FSO tracking and FSO reports (approved tickets only)"),
                    _perm("Close FSO Voyage", OTHER, "Can close FSO voyages"),
                    _perm("Reopen FSO Voyage", OTHER, "Can reopen closed FSO voyages"),
                ],
            },
            {
                # Cross-location receiving side of a movement (see
                # PERMISSION_CRITERIA_MODEL.md, section 7). A receiving
                # terminal can be granted "acknowledge the movement and create
                # the receiving ticket" without the general entry / tracking
                # edit rights of the sending terminal. Every endpoint that
                # enforces these permissions also still accepts the general
                # permission, so existing roles keep working unchanged.
                "module_name": "Shipment Receipt",
                "permissions": [
                    _perm(
                        "Acknowledge Shipment Receipt",
                        OTHER,
                        "Can acknowledge or revoke the receipt of a barge / tanker movement addressed to the user's location",
                    ),
                    _perm(
                        "Create Receiving Ticket",
                        CREATE,
                        "Can create and edit the receiving ticket of an approved sender ticket (barge / tanker movement)",
                    ),
                ],
            },
        ],
    },
    {
        "category": "Export Operations",
        "modules": [
            {
                "module_name": "Export Dashboard",
                "permissions": [
                    _perm("View Export Dashboard", VIEW, "Can view the Export Operations dashboard"),
                ],
            },
            {
                "module_name": "Export Transactions",
                "permissions": [
                    _perm("View Export Transaction", VIEW, "Can view export transactions"),
                    _perm("Create Export Transaction", CREATE, "Can create and bulk upload export transactions"),
                    _perm("Edit Export Transaction", EDIT, "Can edit export transactions"),
                    _perm("Delete Export Transaction", DELETE, "Can delete export transactions"),
                ],
            },
            {
                "module_name": "Export Reports",
                "permissions": [
                    _perm("View Export Report", VIEW, "Can view Export Operations reports"),
                ],
            },
            {
                "module_name": "Export Locations",
                "permissions": _crud("Export Location", "export locations"),
            },
            {
                "module_name": "Export Entities",
                "permissions": [
                    _perm("View Export Entity", VIEW, "Can view export entities"),
                    _perm("Create Export Entity", CREATE, "Can create export entities"),
                    _perm("Edit Export Entity", EDIT, "Can edit export entities and their location links"),
                    _perm("Delete Export Entity", DELETE, "Can delete export entities"),
                ],
            },
            {
                "module_name": "Export Blocks",
                "permissions": [
                    _perm("View Export Block", VIEW, "Can view export blocks"),
                    _perm("Create Export Block", CREATE, "Can create export blocks"),
                    _perm("Edit Export Block", EDIT, "Can edit export blocks and their entity links"),
                    _perm("Delete Export Block", DELETE, "Can delete export blocks"),
                ],
            },
            {
                "module_name": "Export Permits",
                "permissions": [
                    _perm("View Export Permit", VIEW, "Can view export permits"),
                    _perm("Create Export Permit", CREATE, "Can create and bulk upload export permits"),
                    _perm("Edit Export Permit", EDIT, "Can edit export permits"),
                    _perm("Delete Export Permit", DELETE, "Can delete export permits"),
                ],
            },
            {
                "module_name": "Export Consignees",
                "permissions": _crud("Export Consignee", "export consignees"),
            },
            {
                "module_name": "Export Settings",
                "permissions": [
                    _perm("View Export Settings", VIEW, "Can view Export Operations settings"),
                    _perm("Edit Export Settings", EDIT, "Can change Export Operations settings"),
                ],
            },
        ],
    },
    {
        "category": "Reporting",
        "modules": [
            {
                "module_name": "Tank Operation Summary",
                "permissions": [
                    _perm("View Tank Operation Summary", VIEW, "Can view the Tank Operation Summary report"),
                ],
            },
            {
                "module_name": "Out-Turn Summary",
                "permissions": [
                    _perm("View Out-Turn Summary", VIEW, "Can view the Out-Turn Summary report"),
                    _perm("Edit Out-Turn Summary", EDIT, "Can configure Out-Turn Summary columns applied to all users"),
                ],
            },
            {
                "module_name": "Material Balance Report",
                "permissions": [
                    _perm("View Material Balance Report", VIEW, "Can view the Material Balance report"),
                ],
            },
            {
                "module_name": "Tanker Transaction Report",
                "permissions": [
                    _perm("View Tanker Transaction Report", VIEW, "Can view the Tanker Transaction report"),
                ],
            },
            {
                "module_name": "Vessel Stock Ledger",
                "permissions": [
                    _perm("View Vessel Stock Ledger", VIEW, "Can view the vessel stock ledger API (approved Shuttle/FSO tickets)"),
                ],
            },
            {
                "module_name": "Tank Stock Ledger (Legacy)",
                "permissions": [
                    _perm("View Tank Stock Ledger", VIEW, "Can view the legacy tank stock ledger"),
                    _perm("Rebuild Tank Stock Ledger", OTHER, "Can rebuild the legacy tank stock ledger"),
                ],
            },
            {
                "module_name": "Out-Turn Report (Legacy)",
                "permissions": [
                    _perm("View Out-Turn Report", VIEW, "Can view the legacy Out-Turn report"),
                ],
            },
            {
                "module_name": "Custom Reports",
                "permissions": [
                    _perm("View Custom Report", VIEW, "Can run published custom reports shared with the user, their roles or their locations"),
                    _perm("Export Custom Report", OTHER, "Can download custom report results as Excel/CSV files"),
                ],
            },
        ],
    },
    {
        "category": "Administration",
        "modules": [
            {
                "module_name": "System Notifications",
                "permissions": [
                    _perm("View System Notification", VIEW, "Can view system notifications"),
                    _perm("Create System Notification", CREATE, "Can create draft system notifications"),
                    _perm("Edit System Notification", EDIT, "Can edit draft system notifications"),
                    _perm("Publish System Notification", OTHER, "Can publish system notifications to users"),
                    _perm("Deactivate System Notification", OTHER, "Can deactivate published system notifications"),
                    _perm("View System Notification Delivery Report", OTHER, "Can view delivery, seen, dismissed and acknowledgement reports"),
                ],
            },
            {
                "module_name": "Backup Recovery",
                "permissions": [
                    _perm("View Backup", VIEW, "Can view backup settings and backup job history"),
                    _perm("Create Manual Backup", CREATE, "Can create a manual database backup"),
                    _perm("Edit Backup Settings", EDIT, "Can configure the automatic backup schedule and retention"),
                    _perm("Delete Backup", DELETE, "Can delete backup files while preserving job history"),
                    _perm("Download Backup", OTHER, "Can download completed backup files"),
                    _perm("Verify Backup Checksum", OTHER, "Can verify backup file checksum integrity"),
                    _perm("Run Backup Cleanup", OTHER, "Can run retention cleanup for old backup files"),
                    _perm("Request Backup Restore", OTHER, "Can request restore approval for a completed backup"),
                    _perm("Approve Backup Restore", OTHER, "Can approve backup restore requests"),
                    _perm("Reject Backup Restore", OTHER, "Can reject backup restore requests"),
                    _perm("Validate Backup Restore", OTHER, "Can validate an approved restore against a separate validation database"),
                    _perm("Execute Backup Restore", OTHER, "Can execute a validated restore into the production database"),
                ],
            },
            {
                "module_name": "Database Browser",
                "permissions": [
                    _perm("View Database Browser", VIEW, "Can open the read-only database browser (administrators only)"),
                ],
            },
            {
                "module_name": "Audit Logs",
                "permissions": [
                    _perm("View Audit Log", VIEW, "Can view system audit logs"),
                ],
            },
            {
                "module_name": "System Settings",
                "permissions": [
                    _perm("Edit System Settings", EDIT, "Can run system maintenance such as expired token cleanup"),
                ],
            },
            {
                "module_name": "Dashboard",
                "permissions": [
                    _perm("View Dashboard", VIEW, "Can view dashboards"),
                    _perm("Create Dashboard", CREATE, "Can create dashboards and dashboard data sources"),
                    _perm("Edit Dashboard", EDIT, "Can edit dashboards and dashboard data sources"),
                    _perm("Delete Dashboard", DELETE, "Can delete dashboard data sources"),
                    _perm("Publish Dashboard", OTHER, "Can publish and revert dashboard versions"),
                ],
            },
        ],
    },
]


def _flatten_catalog():
    rows = []
    for category in PERMISSION_CATALOG:
        for module in category["modules"]:
            for permission in module["permissions"]:
                rows.append({
                    "permission_name": permission["permission_name"],
                    "module_name": module["module_name"],
                    "description": permission["description"],
                    "category": category["category"],
                    "action": permission["action"],
                })
    return rows


# Flat list used by the seeders. Keys ``permission_name``, ``module_name`` and
# ``description`` are persisted; ``category`` and ``action`` are catalog-only.
STANDARD_PERMISSIONS = _flatten_catalog()


def _names(module_name):
    for category in PERMISSION_CATALOG:
        for module in category["modules"]:
            if module["module_name"] == module_name:
                return [permission["permission_name"] for permission in module["permissions"]]
    raise KeyError(module_name)


def _names_by_action(module_names, actions):
    selected = []
    for module_name in module_names:
        for category in PERMISSION_CATALOG:
            for module in category["modules"]:
                if module["module_name"] != module_name:
                    continue
                selected.extend(
                    permission["permission_name"]
                    for permission in module["permissions"]
                    if permission["action"] in actions
                )
    return selected


_EXPORT_MODULES = [
    "Export Dashboard",
    "Export Transactions",
    "Export Reports",
    "Export Locations",
    "Export Entities",
    "Export Blocks",
    "Export Permits",
    "Export Consignees",
    "Export Settings",
]

# Every "View" permission of the Export Operations modules. Reference data
# lookups (locations, entities, blocks, permits, consignees, settings) accept
# any of them so data-entry users can fill dropdowns without being granted the
# configuration screens.
EXPORT_VIEW_PERMISSIONS = _names_by_action(_EXPORT_MODULES, {VIEW})


# Legacy permission -> catalog permissions that replace it. On the first
# startup after the upgrade every role that holds a legacy permission is
# granted all of its replacements, then the legacy permission is removed.
# An empty list retires a permission that was never enforced.
LEGACY_PERMISSION_REPLACEMENTS = {
    "Manage User": ["Create User", "Edit User", "Delete User"],
    "Manage Role": ["Create Role", "Edit Role", "Delete Role"],
    "Manage Permission": ["Create Permission", "Edit Permission", "Delete Permission"],
    "Manage Role Permission Assignment": ["Edit Role Permission Assignment"],
    "Manage User Role Assignment": ["Edit User Role Assignment", "Delete User Role Assignment"],
    "Manage User Location Assignment": ["Edit User Location Assignment", "Delete User Location Assignment"],
    "Manage Role Location Assignment": ["Edit Role Location Assignment"],
    "Manage Own Security Settings": ["Edit Own Security Settings"],
    "Manage Location": ["Create Location", "Edit Location", "Delete Location"],
    "Manage Asset Type": ["Create Asset Type", "Edit Asset Type", "Delete Asset Type"],
    "Manage Asset": [
        "Create Asset", "Edit Asset", "Delete Asset",
        "Create Prime Mover Tanker Link", "Edit Prime Mover Tanker Link", "Delete Prime Mover Tanker Link",
    ],
    "Manage Calibration Template": ["Create Calibration Template", "Edit Calibration Template", "Delete Calibration Template"],
    "Manage Asset Calibration": [
        "Create Asset Calibration", "Edit Asset Calibration", "Delete Asset Calibration",
        "Edit Table 11 Factor", "Delete Table 11 Factor",
    ],
    "Manage Asset Assignment": ["Create Asset Assignment", "Edit Asset Assignment", "Delete Asset Assignment"],
    "Manage Operation Type": ["Create Operation Type", "Edit Operation Type", "Delete Operation Type"],
    "Manage Tank Operation": ["Create Tank Operation", "Edit Tank Operation", "Delete Tank Operation"],
    "Manage Vessel Operation": ["Create Vessel Operation", "Edit Vessel Operation", "Delete Vessel Operation"],
    "Manage Operation Template": ["Create Operation Template", "Edit Operation Template", "Delete Operation Template"],
    "Manage Operation Workflow Policy": [
        "Create Operation Workflow Policy", "Edit Operation Workflow Policy", "Delete Operation Workflow Policy",
    ],
    "Manage Location Operation Availability": [
        "Create Location Operation Availability", "Edit Location Operation Availability",
        "Delete Location Operation Availability",
    ],
    "Manage Company Report Profile": [
        "Create Company Report Profile", "Edit Company Report Profile", "Delete Company Report Profile",
    ],
    "Manage Barge Seal Master": ["Edit Barge Seal Master"],
    "Manage Location Accounting Day Setting": [
        "Create Location Accounting Day Setting", "Edit Location Accounting Day Setting",
        "Delete Location Accounting Day Setting",
    ],
    "Manage Material Balance Template": [
        "Create Material Balance Template", "Edit Material Balance Template", "Delete Material Balance Template",
    ],
    "Manage Flowmeter Config": ["Create Flowmeter Config", "Edit Flowmeter Config", "Delete Flowmeter Config"],
    "Manage Movement Mapping": ["Create Movement Mapping", "Edit Movement Mapping", "Close Movement Mapping"],
    "Manage Operation Tasks": ["Supervise Operation Tasks"],
    "Manage Shuttle Tracking": ["Close Shuttle Voyage", "Reopen Shuttle Voyage"],
    "Manage FSO Tracking": ["Close FSO Voyage", "Reopen FSO Voyage"],
    "View Export Operations": EXPORT_VIEW_PERMISSIONS,
    "Manage Export Operations": _names_by_action(_EXPORT_MODULES, {CREATE, EDIT, DELETE}),
    "Manage Out-Turn Summary": ["Edit Out-Turn Summary"],
    "Manage Tank Stock Ledger": ["Rebuild Tank Stock Ledger"],
    "Manage System Notification": ["Create System Notification", "Edit System Notification"],
    "Manage Backup Settings": ["Edit Backup Settings"],
    "Manage System Settings": ["Edit System Settings"],
    "Manage Dashboard": ["Create Dashboard", "Edit Dashboard", "Delete Dashboard", "Publish Dashboard"],
    # Retired: never enforced by the API and their menu entries were removed.
    "View Reports": [],
    "Export Reports": [],
    "View Admin Settings": [],
    "Manage Admin Settings": [],
    "Request Password Reset": [],
    "Acknowledge System Notification": [],
    "View Approved Transaction Correction Requests": [],
}


# New catalog permission -> existing (retained) permissions whose holders were
# implicitly allowed the same capability before the split. Applied once, in the
# same run that converts the legacy permissions above.
DERIVED_PERMISSION_GRANTS = {
    "View Prime Mover Tanker Link": ["View Asset"],
    "View Table 11 Factor": ["View Asset Calibration"],
    "Edit Operation Entry": ["Create Operation Entry"],
    "View Barge Tracking": ["View Operation Transaction"],
    "Edit Barge Tracking": ["Create Operation Entry"],
    "Close Barge Movement": ["Create Operation Entry"],
    "Reopen Barge Movement": ["Create Operation Entry"],
    "View Tanker Tracking": ["View Operation Transaction"],
    "Edit Tanker Tracking": ["Create Operation Entry"],
    "Close Tanker Movement": ["Create Operation Entry"],
    "View Tanker Transaction Report": ["View Operation Transaction"],
    "View Vessel Stock Ledger": ["View Operation Transaction"],
}


def get_permission_catalog():
    """Return a JSON-serialisable copy of the catalog for the API."""
    return [
        {
            "category": category["category"],
            "modules": [
                {
                    "module_name": module["module_name"],
                    "permissions": [dict(permission) for permission in module["permissions"]],
                }
                for module in category["modules"]
            ],
        }
        for category in PERMISSION_CATALOG
    ]


def _validate_catalog():
    seen = set()
    for row in STANDARD_PERMISSIONS:
        key = row["permission_name"].casefold()
        if key in seen:
            raise ValueError(f"Duplicate permission in catalog: {row['permission_name']}")
        if row["action"] not in ACTION_ORDER:
            raise ValueError(f"Unknown action for {row['permission_name']}: {row['action']}")
        seen.add(key)
    for legacy, replacements in LEGACY_PERMISSION_REPLACEMENTS.items():
        if legacy.casefold() in seen:
            raise ValueError(f"Legacy permission is still in the catalog: {legacy}")
        for name in replacements:
            if name.casefold() not in seen:
                raise ValueError(f"Replacement for {legacy} is not in the catalog: {name}")
    for name, sources in DERIVED_PERMISSION_GRANTS.items():
        if name.casefold() not in seen:
            raise ValueError(f"Derived permission is not in the catalog: {name}")
        for source in sources:
            if source.casefold() not in seen:
                raise ValueError(f"Derived source permission is not in the catalog: {source}")


_validate_catalog()
