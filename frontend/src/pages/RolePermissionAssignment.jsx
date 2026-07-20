import { useState } from 'react'
import { saveRolePermissions } from '../api/rolePermissionApi'

function RolePermissionAssignment({
  roles,
  permissions,
  rolePermissionAssignments,
  reloadRolePermissions,
  loggedInUser,
}) {
  const [selectedRoleId, setSelectedRoleId] = useState('')
  const [selectedPermissions, setSelectedPermissions] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const isAdminBootstrap =
    String(loggedInUser?.username || '').toLowerCase() === 'admin'

  const activeRoles = roles.filter((role) => role.status === 'Active')
  const activePermissions = permissions.filter(
    (permission) => permission.status === 'Active'
  )

  const hasPermission = (permissionName) => {
    if (isAdminBootstrap) return true
    if (!loggedInUser || !Array.isArray(loggedInUser.permissions)) return false
    return loggedInUser.permissions.some(
      (p) => p.permissionName === permissionName
    )
  }

  const canManageRolePermission = hasPermission(
    'Manage Role Permission Assignment'
  )

  const clearError = () => setError('')
  const clearSuccess = () => setSuccess('')

  const handleRoleChange = (e) => {
    const roleId = e.target.value
    setSelectedRoleId(roleId)
    clearError()
    clearSuccess()

    const existingAssignment = rolePermissionAssignments.find(
      (item) => String(item.roleId) === String(roleId)
    )

    if (existingAssignment) {
      setSelectedPermissions(
        existingAssignment.permissions.map((permission) => permission.id)
      )
    } else {
      setSelectedPermissions([])
    }
  }

  const handlePermissionChange = (permissionId) => {
    if (selectedPermissions.includes(permissionId)) {
      setSelectedPermissions(selectedPermissions.filter((id) => id !== permissionId))
    } else {
      setSelectedPermissions([...selectedPermissions, permissionId])
    }
  }

  const handleSelectAll = () => {
    setSelectedPermissions(activePermissions.map((p) => p.id))
  }

  const handleDeselectAll = () => {
    setSelectedPermissions([])
  }

  const handleSave = async (e) => {
    e.preventDefault()
    clearError()
    clearSuccess()

    if (!canManageRolePermission) {
      setError('You do not have permission to manage role permission assignments.')
      return
    }

    if (selectedRoleId === '') {
      setError('Please select a role')
      return
    }

    try {
      setLoading(true)
      await saveRolePermissions(Number(selectedRoleId), selectedPermissions)
      await reloadRolePermissions()
      setSuccess('Permissions assigned successfully')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <div className="page-title">
        <div>
          <h2>Role Permission Assignment</h2>
          <p>Assign permissions to roles for RBAC control.</p>
        </div>

        <span className="record-count">
          {rolePermissionAssignments.length} Assignments
        </span>
      </div>

      {success && (
        <div className="error-box" style={{ background: '#f0fdf4', color: '#166534', borderColor: '#bbf7d0' }}>
          {success}
          <button className="error-close" onClick={clearSuccess} type="button">&times;</button>
        </div>
      )}

      {error && (
        <div className="error-box">
          {error}
          <button className="error-close" onClick={clearError} type="button">&times;</button>
        </div>
      )}

      {!canManageRolePermission && (
        <div className="info-box">
          You have View Role Permission Assignment permission only. Create, edit,
          and delete actions are disabled.
        </div>
      )}

      {canManageRolePermission && (
      <form onSubmit={handleSave}>
        <div>
          <label>Select Role</label>
          <select value={selectedRoleId} onChange={handleRoleChange}>
            <option value="">Select Role</option>

            {activeRoles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.roleName}
              </option>
            ))}
          </select>
        </div>

        <div className="full-width-field">
          <label>Permissions</label>

          {activePermissions.length > 0 && selectedRoleId && (
            <div style={{ marginBottom: 10, display: 'flex', gap: 8 }}>
              <button type="button" onClick={handleSelectAll} style={{ background: '#2563eb', color: '#fff', padding: '4px 10px', fontSize: 12 }}>
                Select All
              </button>
              <button type="button" onClick={handleDeselectAll} style={{ background: '#64748b', color: '#fff', padding: '4px 10px', fontSize: 12 }}>
                Deselect All
              </button>
            </div>
          )}

          <div className="permission-grid">
            {activePermissions.length === 0 ? (
              <div className="info-box">
                Please create active permissions first.
              </div>
            ) : !selectedRoleId ? (
              <div className="info-box">
                Select a role to view permissions.
              </div>
            ) : (
              activePermissions.map((permission) => {
                return (
                  <label key={permission.id} className="permission-card">
                    <input
                      type="checkbox"
                      checked={selectedPermissions.includes(permission.id)}
                      onChange={() => handlePermissionChange(permission.id)}
                    />

                    <div>
                      <strong>{permission.permissionName}</strong>
                      <span>{permission.moduleName}</span>
                    </div>
                  </label>
                )
              })
            )}
          </div>
        </div>

        <div className="form-actions">
          <button type="submit" disabled={loading || !selectedRoleId}>
            {loading ? 'Please wait...' : 'Save Assignment'}
          </button>
        </div>
      </form>
      )}

      <div className="section-title">
        <h3>Assigned Role Permissions</h3>
        <p>View which permissions are assigned to each role.</p>
      </div>

      <table>
        <thead>
          <tr>
            <th>Role</th>
            <th>Permissions</th>
          </tr>
        </thead>

        <tbody>
          {rolePermissionAssignments.length === 0 ? (
            <tr>
              <td colSpan="2" className="empty-table">
                No role permissions assigned yet.
              </td>
            </tr>
          ) : (
            rolePermissionAssignments.map((item) => (
              <tr key={item.roleId}>
                <td>{item.roleName}</td>
                <td>
                  {item.permissions.length === 0 ? (
                    <span>No permissions selected</span>
                  ) : (
                    <div className="permission-list">
                      {item.permissions.map((permission) => (
                        <span key={permission.id} className="permission-badge">
                          {permission.moduleName} - {permission.permissionName}
                        </span>
                      ))}
                    </div>
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

export default RolePermissionAssignment