# PermissionPresets

## Purpose
Named, reusable permission sets for roles (same functionality as the Permission Preset module of HCA-System).
A preset is built once and applied to one role or many – replacing or adding to their permissions – instead of
ticking every permission for every role.

## File Locations
- **Frontend page:** `frontend/src/pages/PermissionPresets.jsx` (route `/permission-presets`)
- **Dialogs:** `frontend/src/components/rbac/PresetFormDialog.jsx`, `frontend/src/components/rbac/ApplyPresetDialog.jsx`
- **Preset bar (Role Permission Assignment):** `frontend/src/components/rbac/PresetBar.jsx`
- **Store:** `frontend/src/utils/permissionPresetStore.js`; hook `frontend/src/hooks/usePermissionPresets.js`
- **Helpers:** `frontend/src/utils/permissionPresets.js` (standard presets, resolution, apply plan, role locks)
- **API used:** `frontend/src/api/rolePermissionApi.js` (`GET /role-permissions/{role_id}`, `POST /role-permissions/{role_id}`),
  `frontend/src/api/permissionApi.js` (`GET /permissions/catalog`)

## Storage (no database change)
The backend and database are frozen, so there is no preset table. Saved presets are kept in the browser
(`localStorage`, key `hca.permissionPresets.v1`) behind `permissionPresetStore.js`; moving them to a server API later
is a change to that file only. Export / Bulk Upload copy presets to another computer. Standard presets are built
from the live permission catalog and are available everywhere.

## Key Features
- **Standard presets**: "Read only – all modules" and, per menu category, "view only" and "full access".
- **Saved presets**: at most 20 (active and inactive count), unique names of 2–120 characters, at least one
  permission, Active / Inactive, applied counter and last applied date. Create / edit with the module × action
  permission matrix; "Load permissions from" copies a role's permissions or another preset.
- **Apply** to many roles in **Replace** (role ends with exactly the preset) or **Add** (nothing removed) mode, with a
  per-role +added / −removed preview and a per-role result. Each role is saved through
  `POST /role-permissions/{role_id}`, so the backend audits every change.
- The Admin role, inactive roles and roles holding permissions the user does not hold cannot receive a preset; a
  non-administrator cannot apply a preset that contains permissions they do not hold.
- **Role Permission Assignment** pop-up: preset bar to replace / add to the selection (reviewed, then saved with Save
  Permissions) and **Save selection as preset**.
- List with quick / advanced filters (type, status, modules, permission names, dates), pagination, CSV / XLSX / PDF
  export and CSV / XLSX bulk upload (permission names comma-separated).

## Permissions
- **View:** View Role Permission Assignment (route guard, menu, View)
- **Create / change / apply / delete presets:** Edit Role Permission Assignment (the catalog has no separate preset
  permissions and the backend is frozen)
- Listing roles in the Apply dialog needs View Role; granting permissions not yet assigned to any role needs View
  Permission.
