import { useCallback, useEffect, useMemo, useState } from 'react'
import { getPermissionCatalog } from '../api/permissionApi'
import PaginationControls, { paginateRows, usePageSize } from '../components/common/PaginationControls'
import DataTableToolbar from '../components/common/DataTableToolbar'
import PageHeader from '../components/common/PageHeader'
import AlertMessage from '../components/common/AlertMessage'
import Modal from '../components/common/Modal'
import PermissionMatrix from '../components/rbac/PermissionMatrix'
import { useDataFilters } from '../hooks/useDataFilters'
import { logUiAction } from '../utils/actionLogger'
import { buildPermissionGroups } from '../utils/permissionCatalog'

const MODULE = 'Access Summary'
const nameKey = (name) => String(name || '').trim().toLowerCase()

const USER_COLUMNS = [
  { key: 'fullName', label: 'Full Name' },
  { key: 'username', label: 'Username' },
  { key: 'status', label: 'Status', type: 'select' },
  { key: 'roleList', label: 'Roles' },
  { key: 'moduleCount', label: 'Modules', type: 'number' },
  { key: 'permissionCount', label: 'Permissions', type: 'number' },
  { key: 'health', label: 'Access Health', type: 'select' },
]

const ROLE_COLUMNS = [
  { key: 'roleName', label: 'Role' },
  { key: 'status', label: 'Status', type: 'select' },
  { key: 'userCount', label: 'Users', type: 'number' },
  { key: 'moduleCount', label: 'Modules', type: 'number' },
  { key: 'permissionCount', label: 'Permissions', type: 'number' },
  { key: 'health', label: 'Health', type: 'select' },
]

const healthTone = (health) => {
  if (health === 'Access ready' || health === 'Configured') return 'active'
  if (health === 'User inactive' || health === 'Not active') return 'inactive'
  return 'blocked'
}

function AccessSummary({
  users = [],
  roles = [],
  permissions = [],
  userRoleAssignments = [],
  rolePermissionAssignments = [],
}) {
  const [catalog, setCatalog] = useState(null)
  const [catalogError, setCatalogError] = useState('')
  const [detailUser, setDetailUser] = useState(null)
  const [userPage, setUserPage] = useState(1)
  const [rolePage, setRolePage] = useState(1)
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

  const knownPermissions = useMemo(() => {
    const byId = new Map()
    for (const permission of permissions) byId.set(permission.id, permission)
    for (const assignment of rolePermissionAssignments) {
      for (const permission of assignment.permissions || []) {
        if (!byId.has(permission.id)) byId.set(permission.id, permission)
      }
    }
    return [...byId.values()]
  }, [permissions, rolePermissionAssignments])

  const groups = useMemo(() => buildPermissionGroups(catalog, knownPermissions), [catalog, knownPermissions])

  const moduleOf = useCallback(
    (permission) =>
      groups.infoByName.get(nameKey(permission.permissionName))?.moduleName || permission.moduleName || 'Other',
    [groups]
  )

  const permissionsByRole = useMemo(() => {
    const map = new Map()
    for (const assignment of rolePermissionAssignments) {
      map.set(String(assignment.roleId), assignment.permissions || [])
    }
    return map
  }, [rolePermissionAssignments])

  const roleNameById = useMemo(() => {
    const map = new Map()
    for (const role of roles) map.set(String(role.id), role)
    return map
  }, [roles])

  const userRows = useMemo(
    () =>
      users.map((user) => {
        const assignments = userRoleAssignments.filter(
          (item) => String(item.userId) === String(user.id) || item.username === user.username
        )
        const roleNames = [...new Set(assignments.map((item) => item.roleName).filter(Boolean))]
        const activeRoleIds = assignments
          .filter((item) => (roleNameById.get(String(item.roleId))?.status || 'Active') === 'Active')
          .map((item) => String(item.roleId))
        const effective = new Map()
        for (const roleId of activeRoleIds) {
          for (const permission of permissionsByRole.get(roleId) || []) {
            if (String(permission.status || 'Active') !== 'Active') continue
            effective.set(nameKey(permission.permissionName), permission)
          }
        }
        const modules = new Set([...effective.values()].map(moduleOf))
        let health = 'Access ready'
        if (user.status !== 'Active') health = 'User inactive'
        else if (roleNames.length === 0) health = 'Missing role'
        else if (effective.size === 0) health = 'Missing permissions'
        return {
          ...user,
          roleNames,
          roleList: roleNames.join(', '),
          effectiveNames: new Set(effective.keys()),
          permissionCount: effective.size,
          moduleCount: modules.size,
          health,
        }
      }),
    [users, userRoleAssignments, permissionsByRole, roleNameById, moduleOf]
  )

  const roleRows = useMemo(
    () =>
      roles.map((role) => {
        const rolePermissions = permissionsByRole.get(String(role.id)) || []
        const userCount = new Set(
          userRoleAssignments.filter((item) => String(item.roleId) === String(role.id)).map((item) => item.userId)
        ).size
        let health = 'Configured'
        if (role.status !== 'Active') health = 'Not active'
        else if (rolePermissions.length === 0) health = 'No permissions'
        return {
          id: role.id,
          roleName: role.roleName,
          status: role.status,
          userCount,
          moduleCount: new Set(rolePermissions.map(moduleOf)).size,
          permissionCount: rolePermissions.length,
          health,
        }
      }),
    [roles, permissionsByRole, userRoleAssignments, moduleOf]
  )

  const userFilters = useDataFilters(userRows, USER_COLUMNS, { module: MODULE })
  const roleFilters = useDataFilters(roleRows, ROLE_COLUMNS, { module: `${MODULE} - Roles` })
  const visibleUsers = paginateRows(userFilters.filteredRows, userPage, pageSize)
  const visibleRoles = paginateRows(roleFilters.filteredRows, rolePage, pageSize)

  const activeUsers = userRows.filter((user) => user.status === 'Active')
  const activeWithoutRole = activeUsers.filter((user) => user.roleNames.length === 0)
  const rolesWithoutPermissions = roleRows.filter((role) => role.health === 'No permissions')

  const openDetail = (user) => {
    setDetailUser(user)
    logUiAction(MODULE, 'View User Access', { username: user.username })
  }

  return (
    <div>
      <PageHeader
        title="Access Summary"
        description="Effective access per user: User → Roles → module-wise permissions."
        count={`${userFilters.filteredRows.length} Users`}
      />

      <AlertMessage tone="warning" message={catalogError} onDismiss={() => setCatalogError('')} />

      <div className="summary-card-grid compact-summary-grid">
        <div className="summary-card">
          <span>Total Users</span>
          <strong>{users.length}</strong>
        </div>
        <div className="summary-card">
          <span>Active Users</span>
          <strong>{activeUsers.length}</strong>
        </div>
        <div className="summary-card warning-summary-card">
          <span>Active Users Without Role</span>
          <strong>{activeWithoutRole.length}</strong>
        </div>
        <div className="summary-card">
          <span>Roles</span>
          <strong>{roles.length}</strong>
        </div>
        <div className="summary-card warning-summary-card">
          <span>Active Roles Without Permissions</span>
          <strong>{rolesWithoutPermissions.length}</strong>
        </div>
      </div>

      {activeWithoutRole.length > 0 && (
        <AlertMessage
          tone="warning"
          message={`${activeWithoutRole.length} active user(s) have no role and cannot open protected modules. Assign a role in User Role Assignment.`}
        />
      )}

      <div className="section-title">
        <h3>User Access</h3>
      </div>

      <DataTableToolbar
        filters={userFilters}
        columns={USER_COLUMNS}
        exportFileName="access-summary-users"
        exportTitle="Access Summary - Users"
        module={MODULE}
        searchPlaceholder="Search users, roles…"
      />

      <table>
        <thead>
          <tr>
            <th>Full Name</th>
            <th>Username</th>
            <th>Status</th>
            <th>Roles</th>
            <th>Access</th>
            <th>Access Health</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {visibleUsers.length === 0 ? (
            <tr>
              <td colSpan={7} className="empty-table">
                No users match the selected filters.
              </td>
            </tr>
          ) : (
            visibleUsers.map((user) => (
              <tr key={user.id || user.username}>
                <td>
                  <strong className="cell-strong">{user.fullName}</strong>
                  <div className="muted-table-text">
                    {[user.department, user.designation].filter(Boolean).join(' / ') || '—'}
                  </div>
                </td>
                <td>{user.username}</td>
                <td>
                  <span className={`status-badge ${String(user.status || '').toLowerCase()}`}>{user.status}</span>
                </td>
                <td>
                  {user.roleNames.length === 0 ? (
                    <span className="warning-text">No role</span>
                  ) : (
                    <div className="permission-list">
                      {user.roleNames.map((roleName) => (
                        <span key={roleName} className="permission-badge">
                          {roleName}
                        </span>
                      ))}
                    </div>
                  )}
                </td>
                <td>
                  {user.permissionCount} permissions · {user.moduleCount} modules
                </td>
                <td>
                  <span className={`status-badge ${healthTone(user.health)}`}>{user.health}</span>
                </td>
                <td className="row-actions">
                  <button type="button" onClick={() => openDetail(user)} disabled={user.permissionCount === 0}>
                    View Access
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <PaginationControls currentPage={userPage} totalRows={userFilters.filteredRows.length} onPageChange={setUserPage} />

      <div className="section-title">
        <h3>Role Permission Health</h3>
      </div>

      <DataTableToolbar
        filters={roleFilters}
        columns={ROLE_COLUMNS}
        exportFileName="access-summary-roles"
        exportTitle="Access Summary - Roles"
        module={`${MODULE} - Roles`}
        searchPlaceholder="Search roles…"
      />

      <table>
        <thead>
          <tr>
            <th>Role</th>
            <th>Status</th>
            <th>Users</th>
            <th>Modules</th>
            <th>Permissions</th>
            <th>Health</th>
          </tr>
        </thead>
        <tbody>
          {visibleRoles.length === 0 ? (
            <tr>
              <td colSpan={6} className="empty-table">
                No roles found.
              </td>
            </tr>
          ) : (
            visibleRoles.map((role) => (
              <tr key={role.id}>
                <td><strong className="cell-strong">{role.roleName}</strong></td>
                <td>
                  <span className={`status-badge ${String(role.status || '').toLowerCase()}`}>{role.status}</span>
                </td>
                <td>{role.userCount}</td>
                <td>{role.moduleCount}</td>
                <td>{role.permissionCount}</td>
                <td>
                  <span className={`status-badge ${healthTone(role.health)}`}>{role.health}</span>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <PaginationControls currentPage={rolePage} totalRows={roleFilters.filteredRows.length} onPageChange={setRolePage} />

      <Modal
        open={Boolean(detailUser)}
        onClose={() => setDetailUser(null)}
        size="xl"
        title={detailUser ? `Access – ${detailUser.fullName}` : ''}
        description={
          detailUser
            ? `Roles: ${detailUser.roleList || 'none'} · ${detailUser.permissionCount} permission(s) across ${detailUser.moduleCount} module(s)`
            : undefined
        }
        footer={
          <button type="button" className="btn-secondary" onClick={() => setDetailUser(null)}>
            Close
          </button>
        }
      >
        {detailUser && <PermissionMatrix groups={groups} selected={detailUser.effectiveNames} />}
      </Modal>
    </div>
  )
}

export default AccessSummary
