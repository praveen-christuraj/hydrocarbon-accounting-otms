import { useMemo, useState } from 'react'

function AccessSummary({
  users,
  roles = [],
  permissions = [],
  userRoleAssignments,
  rolePermissionAssignments,
}) {
  const [searchText, setSearchText] = useState('')
  const [selectedRole, setSelectedRole] = useState('')
  const [selectedStatus, setSelectedStatus] = useState('')

  const getUserRole = (user) => {
    const assignment = userRoleAssignments.find((item) => {
      return (
        item.username === user.username ||
        String(item.userId) === String(user.id)
      )
    })

    if (!assignment) {
      return null
    }

    return assignment
  }

  const getRolePermissions = (roleName) => {
    const assignment = rolePermissionAssignments.find((item) => {
      return item.roleName === roleName
    })

    if (!assignment) {
      return []
    }

    return assignment.permissions || []
  }

  const normalizePermissionName = (permission) => {
    if (typeof permission === 'string') {
      return permission
    }

    return permission.permissionName || permission.permission_name || ''
  }

  const normalizePermissionModule = (permission) => {
    if (typeof permission === 'string') {
      const matchedPermission = permissions.find((item) => {
        return item.permissionName === permission
      })

      return matchedPermission ? matchedPermission.moduleName : 'Other'
    }

    return permission.moduleName || permission.module_name || 'Other'
  }

  const groupPermissionsByModule = (rolePermissions) => {
    return rolePermissions.reduce((groups, permission) => {
      const moduleName = normalizePermissionModule(permission)
      const permissionName = normalizePermissionName(permission)

      if (!groups[moduleName]) {
        groups[moduleName] = []
      }

      if (permissionName) {
        groups[moduleName].push(permissionName)
      }

      return groups
    }, {})
  }

  const usersWithAccess = useMemo(() => {
    return users.map((user) => {
      const roleAssignment = getUserRole(user)
      const roleName = roleAssignment ? roleAssignment.roleName : ''
      const rolePermissions = roleName ? getRolePermissions(roleName) : []
      const groupedPermissions = groupPermissionsByModule(rolePermissions)

      return {
        ...user,
        assignedRole: roleName,
        rolePermissionCount: rolePermissions.length,
        groupedPermissions,
        hasRole: roleName !== '',
        hasPermissions: rolePermissions.length > 0,
      }
    })
  }, [users, userRoleAssignments, rolePermissionAssignments, permissions])

  const filteredUsers = usersWithAccess.filter((user) => {
    const combinedText = `${user.fullName} ${user.username} ${user.email || ''} ${user.department || ''} ${user.designation || ''}`.toLowerCase()
    const searchMatches = combinedText.includes(searchText.toLowerCase())

    const roleMatches =
      selectedRole === '' || user.assignedRole === selectedRole

    const statusMatches =
      selectedStatus === '' || user.status === selectedStatus

    return searchMatches && roleMatches && statusMatches
  })

  const activeUsers = users.filter((user) => user.status === 'Active')
  const usersWithoutRole = usersWithAccess.filter((user) => !user.hasRole)
  const activeUsersWithoutRole = usersWithAccess.filter((user) => {
    return user.status === 'Active' && !user.hasRole
  })

  const rolesWithoutPermissions = roles.filter((role) => {
    const rolePermissions = getRolePermissions(role.roleName)
    return role.status === 'Active' && rolePermissions.length === 0
  })

  const totalAssignedPermissions = usersWithAccess.reduce((total, user) => {
    return total + user.rolePermissionCount
  }, 0)

  const clearFilters = () => {
    setSearchText('')
    setSelectedRole('')
    setSelectedStatus('')
  }

  return (
    <div>
      <div className="page-title">
        <div>
          <h2>Access Summary</h2>
          <p>Verify final user access based on User → Role → Permissions.</p>
        </div>

        <span className="record-count">{filteredUsers.length} Visible Users</span>
      </div>

      <div className="summary-card-grid">
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
          <strong>{activeUsersWithoutRole.length}</strong>
        </div>

        <div className="summary-card warning-summary-card">
          <span>Active Roles Without Permissions</span>
          <strong>{rolesWithoutPermissions.length}</strong>
        </div>

        <div className="summary-card">
          <span>Total Assigned Permission Links</span>
          <strong>{totalAssignedPermissions}</strong>
        </div>
      </div>

      <div className="filter-panel">
        <div>
          <label>Search User</label>
          <input
            type="text"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Search by name, username, email, department..."
          />
        </div>

        <div>
          <label>Role Filter</label>
          <select
            value={selectedRole}
            onChange={(e) => setSelectedRole(e.target.value)}
          >
            <option value="">All Roles</option>

            {roles.map((role) => (
              <option key={role.id} value={role.roleName}>
                {role.roleName}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label>Status Filter</label>
          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
          >
            <option value="">All Status</option>
            <option>Active</option>
            <option>Inactive</option>
            <option>Blocked</option>
          </select>
        </div>

        <div className="filter-actions">
          <button type="button" onClick={clearFilters}>
            Clear Filters
          </button>
        </div>
      </div>

      {usersWithoutRole.length > 0 && (
        <div className="info-box">
          {usersWithoutRole.length} user(s) do not have a role assigned. Active
          users without roles cannot access protected modules properly.
        </div>
      )}

      {rolesWithoutPermissions.length > 0 && (
        <div className="info-box">
          {rolesWithoutPermissions.length} active role(s) do not have permissions
          assigned. Assign permissions in Role Permission Assignment.
        </div>
      )}

      <div className="section-title">
        <h3>User Access Overview</h3>
        <p>
          This screen confirms what each user can access after backend RBAC
          enforcement.
        </p>
      </div>

      <table>
        <thead>
          <tr>
            <th>Full Name</th>
            <th>Username</th>
            <th>Status</th>
            <th>Assigned Role</th>
            <th>Permission Summary</th>
            <th>Access Health</th>
          </tr>
        </thead>

        <tbody>
          {filteredUsers.length === 0 ? (
            <tr>
              <td colSpan="6" className="empty-table">
                No users match the selected filters.
              </td>
            </tr>
          ) : (
            filteredUsers.map((user) => {
              const moduleEntries = Object.entries(user.groupedPermissions)

              return (
                <tr key={user.id || user.username}>
                  <td>
                    <strong>{user.fullName}</strong>
                    <div className="muted-table-text">
                      {user.department || 'No department'} /{' '}
                      {user.designation || 'No designation'}
                    </div>
                  </td>

                  <td>{user.username}</td>

                  <td>
                    <span className={`status-badge ${user.status.toLowerCase()}`}>
                      {user.status}
                    </span>
                  </td>

                  <td>
                    {!user.hasRole ? (
                      <span className="warning-text">No role assigned</span>
                    ) : (
                      <span className="permission-badge">
                        {user.assignedRole}
                      </span>
                    )}
                  </td>

                  <td>
                    {!user.hasRole ? (
                      <span className="warning-text">
                        Assign a role in User Role Assignment
                      </span>
                    ) : !user.hasPermissions ? (
                      <span className="warning-text">
                        Assigned role has no permissions
                      </span>
                    ) : (
                      <div className="module-permission-list">
                        {moduleEntries.map(([moduleName, modulePermissions]) => (
                          <div key={moduleName} className="module-permission-group">
                            <strong>{moduleName}</strong>

                            <div className="permission-list">
                              {modulePermissions.map((permissionName) => (
                                <span
                                  key={permissionName}
                                  className="permission-badge"
                                >
                                  {permissionName}
                                </span>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </td>

                  <td>
                    {user.status !== 'Active' ? (
                      <span className="status-badge inactive">
                        User inactive/blocked
                      </span>
                    ) : !user.hasRole ? (
                      <span className="status-badge blocked">
                        Missing role
                      </span>
                    ) : !user.hasPermissions ? (
                      <span className="status-badge blocked">
                        Missing permissions
                      </span>
                    ) : (
                      <span className="status-badge active">
                        Access ready
                      </span>
                    )}
                  </td>
                </tr>
              )
            })
          )}
        </tbody>
      </table>

      <div className="section-title">
        <h3>Role Permission Health</h3>
        <p>
          Review active roles and confirm that each role has at least one
          permission assigned.
        </p>
      </div>

      <table>
        <thead>
          <tr>
            <th>Role</th>
            <th>Status</th>
            <th>Permission Count</th>
            <th>Health</th>
          </tr>
        </thead>

        <tbody>
          {roles.length === 0 ? (
            <tr>
              <td colSpan="4" className="empty-table">
                No roles found.
              </td>
            </tr>
          ) : (
            roles.map((role) => {
              const rolePermissions = getRolePermissions(role.roleName)

              return (
                <tr key={role.id || role.roleName}>
                  <td>{role.roleName}</td>
                  <td>
                    <span className={`status-badge ${role.status.toLowerCase()}`}>
                      {role.status}
                    </span>
                  </td>
                  <td>{rolePermissions.length}</td>
                  <td>
                    {role.status !== 'Active' ? (
                      <span className="status-badge inactive">
                        Not active
                      </span>
                    ) : rolePermissions.length === 0 ? (
                      <span className="status-badge blocked">
                        No permissions
                      </span>
                    ) : (
                      <span className="status-badge active">
                        Configured
                      </span>
                    )}
                  </td>
                </tr>
              )
            })
          )}
        </tbody>
      </table>
    </div>
  )
}

export default AccessSummary