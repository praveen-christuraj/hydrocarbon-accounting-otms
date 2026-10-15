import { useEffect, useMemo, useState } from 'react'
import { saveRolePermissions } from '../api/rolePermissionApi'
import { getPermissionCatalog } from '../api/permissionApi'
import PaginationControls, { paginateRows, usePageSize } from '../components/common/PaginationControls'
import DataTableToolbar from '../components/common/DataTableToolbar'
import PageHeader from '../components/common/PageHeader'
import AlertMessage from '../components/common/AlertMessage'
import Modal from '../components/common/Modal'
import { useConfirm } from '../components/common/ConfirmProvider'
import PermissionMatrix from '../components/rbac/PermissionMatrix'
import { useDataFilters } from '../hooks/useDataFilters'
import { usePermissions } from '../hooks/usePermissions'
import { logUiAction } from '../utils/actionLogger'
import { buildPermissionGroups } from '../utils/permissionCatalog'

const MODULE = 'Role Permission Assignment'
const nameKey = (name) => String(name || '').trim().toLowerCase()
const isAdminRoleName = (name) => nameKey(name) === 'admin'

const COLUMNS = [
  { key: 'roleName', label: 'Role' },
  { key: 'status', label: 'Status', type: 'select' },
  { key: 'moduleCount', label: 'Modules', type: 'number' },
  { key: 'permissionCount', label: 'Permissions', type: 'number' },
  { key: 'description', label: 'Description' },
]

const sameSet = (a, b) => a.size === b.size && [...a].every((value) => b.has(value))

function RolePermissionAssignment({
  roles,
  permissions,
  rolePermissionAssignments,
  reloadRolePermissions,
  loggedInUser,
}) {
  const confirm = useConfirm()
  const { hasPermission, isAdmin } = usePermissions(loggedInUser)
  const canEdit = hasPermission('Edit Role Permission Assignment')

  const [catalog, setCatalog] = useState(null)
  const [catalogError, setCatalogError] = useState('')
  const [matrixRole, setMatrixRole] = useState(null)
  const [matrixEditable, setMatrixEditable] = useState(false)
  const [selection, setSelection] = useState(() => new Set())
  const [initialSelection, setInitialSelection] = useState(() => new Set())
  const [saving, setSaving] = useState(false)
  const [matrixError, setMatrixError] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [page, setPage] = useState(1)
  const pageSize = usePageSize()

  useEffect(() => {
    let cancelled = false
    getPermissionCatalog()
      .then((data) => {
        if (!cancelled) setCatalog(data)
      })
      .catch((err) => {
        if (!cancelled) setCatalogError(err.message || 'Unable to load the permission catalog.')
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Permission rows: the full list when the user can view Permission Master,
  // plus everything already assigned to a role.
  const knownPermissions = useMemo(() => {
    const byId = new Map()
    for (const permission of permissions || []) byId.set(permission.id, permission)
    for (const assignment of rolePermissionAssignments || []) {
      for (const permission of assignment.permissions || []) {
        if (!byId.has(permission.id)) byId.set(permission.id, permission)
      }
    }
    return [...byId.values()]
  }, [permissions, rolePermissionAssignments])

  const groups = useMemo(() => buildPermissionGroups(catalog, knownPermissions), [catalog, knownPermissions])

  const actorPermissionNames = useMemo(
    () =>
      new Set(
        (loggedInUser?.permissions || []).map((permission) =>
          nameKey(permission.permissionName || permission.permission_name)
        )
      ),
    [loggedInUser]
  )

  const roleRows = useMemo(
    () =>
      roles.map((role) => {
        const assignment = rolePermissionAssignments.find((item) => String(item.roleId) === String(role.id))
        const assigned = assignment?.permissions || []
        const modules = new Set(
          assigned.map((permission) => groups.infoByName.get(nameKey(permission.permissionName))?.moduleName || permission.moduleName)
        )
        const adminRole = isAdminRoleName(role.roleName)
        const withinScope =
          isAdmin || assigned.every((permission) => actorPermissionNames.has(nameKey(permission.permissionName)))
        let lockReason = ''
        if (adminRole) lockReason = 'The Admin role always has every permission (system managed).'
        else if (role.status !== 'Active') lockReason = 'Only active roles can be changed.'
        else if (!withinScope) lockReason = 'This role holds permissions you do not have.'
        return {
          id: role.id,
          roleName: role.roleName,
          description: role.description || '',
          status: role.status,
          moduleCount: modules.size,
          permissionCount: assigned.length,
          assigned,
          adminRole,
          lockReason,
        }
      }),
    [roles, rolePermissionAssignments, groups, isAdmin, actorPermissionNames]
  )

  const filters = useDataFilters(roleRows, COLUMNS, { module: MODULE })
  const visibleRows = paginateRows(filters.filteredRows, page, pageSize)

  const openMatrix = (row, editable) => {
    setError('')
    setSuccess('')
    setMatrixError('')
    const names = new Set(row.assigned.map((permission) => nameKey(permission.permissionName)))
    setSelection(names)
    setInitialSelection(new Set(names))
    setMatrixRole(row)
    setMatrixEditable(editable)
    logUiAction(MODULE, editable ? 'Open Assign Permissions' : 'View Role Permissions', { roleName: row.roleName })
  }

  const closeMatrix = async () => {
    if (matrixEditable && !sameSet(selection, initialSelection)) {
      const discard = await confirm({
        title: 'Discard changes',
        message: `Discard the unsaved permission changes for ${matrixRole?.roleName}?`,
        tone: 'warning',
        confirmLabel: 'Discard',
        cancelLabel: 'Keep editing',
        module: MODULE,
      })
      if (!discard) return
    }
    setMatrixRole(null)
    setMatrixError('')
  }

  const canAssignEntry = (entry) => isAdmin || actorPermissionNames.has(nameKey(entry.permissionName))

  // Inactive permissions cannot be (re)assigned by the API, so they are dropped on save.
  const selectedEntries = groups.entries.filter((entry) => selection.has(nameKey(entry.permissionName)))
  const savableIds = selectedEntries
    .filter((entry) => entry.permission && String(entry.permission.status || 'Active') === 'Active')
    .map((entry) => entry.permission.id)
  const droppedCount = selection.size - savableIds.length

  const handleSave = async () => {
    if (!matrixRole || !canEdit || matrixRole.lockReason) return
    setMatrixError('')
    try {
      setSaving(true)
      await saveRolePermissions(matrixRole.id, savableIds)
      await reloadRolePermissions()
      setSuccess(`Saved ${savableIds.length} permission(s) for role ${matrixRole.roleName}.`)
      setMatrixRole(null)
    } catch (err) {
      setMatrixError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const dirty = matrixEditable && !sameSet(selection, initialSelection)

  /* bulk upload */
  const assignableEntries = groups.entries.filter(
    (entry) => entry.permission && String(entry.permission.status || 'Active') === 'Active' && canAssignEntry(entry)
  )

  const importConfig = {
    title: 'Bulk upload role permission assignments',
    description:
      'Upload an Excel (.xlsx) or CSV file with one row per role. The Permissions column holds a comma-separated list of permission names and replaces the permissions that role already has.',
    templateFileName: 'role-permission-assignment-upload-template',
    fields: [
      { key: 'roleName', label: 'Role', required: true, example: 'Operations', aliases: ['Role Name', 'Roles'] },
      {
        key: 'permissions',
        label: 'Permissions',
        required: true,
        example: 'View Location, Create Location',
        aliases: ['Permission', 'Permission Names'],
        hint: 'Comma-separated permission names from the Permission Master',
      },
    ],
    validateRow: (row) => {
      const roleName = String(row.roleName ?? '').trim()
      if (roleName === '') return 'Role is required'
      const role = roleRows.find((item) => nameKey(item.roleName) === nameKey(roleName))
      if (!role) return `Unknown role "${roleName}"`
      if (role.lockReason) return role.lockReason

      const names = String(row.permissions ?? '')
        .split(/[,;]/)
        .map((item) => String(item).trim())
        .filter(Boolean)
      if (names.length === 0) return 'At least one permission is required'
      const unknown = names.filter(
        (name) => !assignableEntries.some((entry) => nameKey(entry.permissionName) === nameKey(name))
      )
      if (unknown.length > 0) return `Unknown, inactive or out-of-scope permission(s): ${unknown.join(', ')}`
      return null
    },
    onImportRow: async (row) => {
      if (!canEdit) {
        throw new Error('You do not have permission to edit role permission assignments.')
      }
      const role = roleRows.find((item) => nameKey(item.roleName) === nameKey(row.roleName))
      const names = String(row.permissions ?? '')
        .split(/[,;]/)
        .map((item) => nameKey(item))
        .filter(Boolean)
      const permissionIds = assignableEntries
        .filter((entry) => names.includes(nameKey(entry.permissionName)))
        .map((entry) => entry.permission.id)
      await saveRolePermissions(role.id, permissionIds)
    },
    onComplete: async () => {
      await reloadRolePermissions()
    },
  }

  return (
    <div>
      <PageHeader
        title="Role Permission Assignment"
        description="Grant module-wise View / Create / Edit / Delete permissions to each role."
        count={`${roles.length} Roles`}
      />

      <AlertMessage tone="success" message={success} onDismiss={() => setSuccess('')} />
      <AlertMessage tone="error" message={error} onDismiss={() => setError('')} />
      <AlertMessage tone="warning" message={catalogError} onDismiss={() => setCatalogError('')} />
      {canEdit && permissions.length === 0 && (
        <AlertMessage
          tone="info"
          message="Only permissions already assigned to a role are listed. Granting other permissions also requires View Permission."
        />
      )}
      {!canEdit && (
        <div className="info-box">You have view-only access. Use View Access to review a role's permissions.</div>
      )}

      <DataTableToolbar
        filters={filters}
        columns={COLUMNS}
        exportFileName="role-permission-assignment"
        exportTitle="Role Permission Assignment"
        module={MODULE}
        searchPlaceholder="Search roles…"
        importConfig={importConfig}
        canImport={canEdit}
      />

      <table>
        <thead>
          <tr>
            <th>Role</th>
            <th>Status</th>
            <th>Modules</th>
            <th>Permissions</th>
            <th>Description</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {visibleRows.length === 0 ? (
            <tr>
              <td colSpan={6} className="empty-table">
                {roles.length === 0 ? 'No roles found.' : 'No roles match the filters.'}
              </td>
            </tr>
          ) : (
            visibleRows.map((row) => (
              <tr key={row.id}>
                <td><strong className="cell-strong">{row.roleName}</strong></td>
                <td>
                  <span className={`status-badge ${String(row.status || '').toLowerCase()}`}>{row.status}</span>
                </td>
                <td>{row.adminRole ? 'All' : row.moduleCount}</td>
                <td>{row.adminRole ? 'All (system managed)' : row.permissionCount}</td>
                <td className="cell-wrap">{row.description}</td>
                <td className="row-actions">
                  <button type="button" onClick={() => openMatrix(row, false)}>
                    View Access
                  </button>
                  {canEdit && (
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => openMatrix(row, true)}
                      disabled={Boolean(row.lockReason)}
                      title={row.lockReason || undefined}
                    >
                      Assign Permissions
                    </button>
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <PaginationControls currentPage={page} totalRows={filters.filteredRows.length} onPageChange={setPage} />

      <Modal
        open={Boolean(matrixRole)}
        onClose={closeMatrix}
        size="xl"
        title={matrixRole ? `${matrixEditable ? 'Assign Permissions' : 'Permissions'} – ${matrixRole.roleName}` : ''}
        description={
          matrixRole
            ? `${selection.size} permission(s) selected${dirty ? ' · unsaved changes' : ''}`
            : undefined
        }
        footer={
          matrixEditable ? (
            <>
              {droppedCount > 0 && (
                <span className="modal-footer-note">
                  {droppedCount} inactive permission(s) will be removed on save.
                </span>
              )}
              <button type="button" className="btn-secondary" onClick={closeMatrix} disabled={saving}>
                Cancel
              </button>
              <button type="button" className="btn-primary" onClick={handleSave} disabled={saving || !dirty}>
                {saving ? 'Saving…' : 'Save Permissions'}
              </button>
            </>
          ) : (
            <button type="button" className="btn-secondary" onClick={closeMatrix}>
              Close
            </button>
          )
        }
      >
        {matrixError && <AlertMessage tone="error" message={matrixError} onDismiss={() => setMatrixError('')} />}
        {matrixRole && (
          <PermissionMatrix
            groups={groups}
            selected={selection}
            onChange={setSelection}
            editable={matrixEditable}
            canAssign={canAssignEntry}
          />
        )}
      </Modal>
    </div>
  )
}

export default RolePermissionAssignment
