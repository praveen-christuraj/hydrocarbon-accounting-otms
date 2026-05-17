import { useState } from 'react'
import { saveRolePermissions } from '../api/rolePermissionApi'

function RolePermissionAssignment({
  roles,
  permissions,
  rolePermissionAssignments,
  reloadRolePermissions,
}) {
  const [selectedRoleId, setSelectedRoleId] = useState('')
  const [selectedPermissions, setSelectedPermissions] = useState([])
  const [loading, setLoading] = useState(false)

  const activeRoles = roles.filter((role) => role.status === 'Active')
  const activePermissions = permissions.filter(
    (permission) => permission.status === 'Active'
  )

  const handleRoleChange = (e) => {
    const roleId = e.target.value
    setSelectedRoleId(roleId)

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
      const updatedPermissions = selectedPermissions.filter(
        (item) => item !== permissionId
      )

      setSelectedPermissions(updatedPermissions)
    } else {
      setSelectedPermissions([...selectedPermissions, permissionId])
    }
  }

  const handleSave = async (e) => {
    e.preventDefault()

    if (selectedRoleId === '') {
      alert('Please select a role')
      return
    }

    try {
      setLoading(true)

      await saveRolePermissions(Number(selectedRoleId), selectedPermissions)
      await reloadRolePermissions()

      alert('Permissions assigned successfully')
    } catch (error) {
      alert(error.message)
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

          <div className="permission-grid">
            {activePermissions.length === 0 ? (
              <div className="info-box">
                Please create active permissions first.
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
          <button type="submit" disabled={loading}>
            {loading ? 'Please wait...' : 'Save Assignment'}
          </button>
        </div>
      </form>

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