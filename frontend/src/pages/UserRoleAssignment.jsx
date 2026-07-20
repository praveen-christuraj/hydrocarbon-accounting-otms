import { useState } from 'react'
import { deleteUserRole, saveUserRole } from '../api/userRoleApi'

function UserRoleAssignment({
  users,
  roles,
  userRoleAssignments,
  reloadUserRoleAssignments,
  loggedInUser,
}) {
  const [selectedUserId, setSelectedUserId] = useState('')
  const [selectedRoleId, setSelectedRoleId] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [fieldErrors, setFieldErrors] = useState({})

  const activeUsers = users.filter((user) => user.status === 'Active')
  const activeRoles = roles.filter((role) => role.status === 'Active')

  const isAdminBootstrap =
    String(loggedInUser?.username || '').toLowerCase() === 'admin'

  const hasPermission = (permissionName) => {
    if (isAdminBootstrap) return true
    if (!loggedInUser || !Array.isArray(loggedInUser.permissions)) return false
    return loggedInUser.permissions.some(
      (p) => p.permissionName === permissionName
    )
  }

  const canManageUserRoleAssignment = hasPermission(
    'Manage User Role Assignment'
  )

  const clearError = () => setError('')
  const clearSuccess = () => setSuccess('')

  const validateAssignment = () => {
    const errors = {}
    if (selectedUserId === '') errors.userId = 'Please select a user'
    if (selectedRoleId === '') errors.roleId = 'Please select a role'
    setFieldErrors(errors)
    return Object.keys(errors).length === 0
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    clearError()
    clearSuccess()

    if (!canManageUserRoleAssignment) {
      setError('You do not have permission to manage user role assignments.')
      return
    }

    if (!validateAssignment()) return

    try {
      setLoading(true)

      await saveUserRole(selectedUserId, selectedRoleId)
      await reloadUserRoleAssignments()

      setSelectedUserId('')
      setSelectedRoleId('')
      setFieldErrors({})
      setSuccess('User role assigned successfully')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleEdit = (assignment) => {
    clearError()
    clearSuccess()
    setConfirmDelete(null)
    setFieldErrors({})

    if (!canManageUserRoleAssignment) {
      setError('You do not have permission to manage user role assignments.')
      return
    }

    setSelectedUserId(String(assignment.userId))
    setSelectedRoleId(String(assignment.roleId))
  }

  const handleDeleteRequest = (assignment) => {
    clearError()
    clearSuccess()
    setConfirmDelete(assignment.id)
  }

  const handleDeleteConfirm = async (assignment) => {
    if (!canManageUserRoleAssignment) {
      setError('You do not have permission to manage user role assignments.')
      return
    }

    try {
      setLoading(true)

      await deleteUserRole(assignment.id)
      await reloadUserRoleAssignments()
      setConfirmDelete(null)
      setSuccess('User role assignment removed successfully')

      if (selectedUserId === String(assignment.userId)) {
        setSelectedUserId('')
        setSelectedRoleId('')
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleCancelEdit = () => {
    setSelectedUserId('')
    setSelectedRoleId('')
    setFieldErrors({})
    clearError()
    clearSuccess()
    setConfirmDelete(null)
  }

  return (
    <div>
      <div className="page-title">
        <div>
          <h2>User Role Assignment</h2>
          <p>Assign roles to users for access control.</p>
        </div>

        <span className="record-count">
          {userRoleAssignments.length} Assignments
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

      {!canManageUserRoleAssignment && (
        <div className="info-box">
          You have View User Role Assignment permission only. Create, edit, and
          delete actions are disabled.
        </div>
      )}

      {canManageUserRoleAssignment && (
        <form onSubmit={handleSubmit}>
          <div>
            <label>Select User</label>
            <select
              value={selectedUserId}
              onChange={(e) => { setSelectedUserId(e.target.value); setFieldErrors({ ...fieldErrors, userId: '' }) }}
              style={fieldErrors.userId ? { borderColor: '#dc2626' } : {}}
            >
              <option value="">Select User</option>

              {activeUsers.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.fullName} ({user.username})
                </option>
              ))}
            </select>
            {fieldErrors.userId && (
              <small style={{ color: '#dc2626', marginTop: 4 }}>{fieldErrors.userId}</small>
            )}
          </div>

          <div>
            <label>Select Role</label>
            <select
              value={selectedRoleId}
              onChange={(e) => { setSelectedRoleId(e.target.value); setFieldErrors({ ...fieldErrors, roleId: '' }) }}
              style={fieldErrors.roleId ? { borderColor: '#dc2626' } : {}}
            >
              <option value="">Select Role</option>

              {activeRoles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.roleName}
                </option>
              ))}
            </select>
            {fieldErrors.roleId && (
              <small style={{ color: '#dc2626', marginTop: 4 }}>{fieldErrors.roleId}</small>
            )}
          </div>

          <div className="form-actions">
            <button type="submit" disabled={loading}>
              {loading ? 'Please wait...' : 'Save Assignment'}
            </button>

            {(selectedUserId !== '' || selectedRoleId !== '') && (
              <button
                type="button"
                onClick={handleCancelEdit}
                disabled={loading}
              >
                Clear
              </button>
            )}
          </div>
        </form>
      )}

      <div className="section-title">
        <h3>Assigned User Roles</h3>
        <p>
          Each user can currently have one role. Saving again will update the
          selected user&apos;s role.
        </p>
      </div>

      <table>
        <thead>
          <tr>
            <th>Full Name</th>
            <th>Username</th>
            <th>Assigned Role</th>
            {canManageUserRoleAssignment && <th>Actions</th>}
          </tr>
        </thead>

        <tbody>
          {userRoleAssignments.length === 0 ? (
            <tr>
              <td
                colSpan={canManageUserRoleAssignment ? 4 : 3}
                className="empty-table"
              >
                No user roles assigned yet.
              </td>
            </tr>
          ) : (
            userRoleAssignments.map((assignment) => (
              <tr key={assignment.id}>
                <td>{assignment.fullName}</td>
                <td>{assignment.username}</td>
                <td>
                  <span className="permission-badge">
                    {assignment.roleName}
                  </span>
                </td>

                {canManageUserRoleAssignment && (
                  <td>
                    <button
                      type="button"
                      onClick={() => handleEdit(assignment)}
                    >
                      Edit
                    </button>

                    {confirmDelete === assignment.id ? (
                      <span>
                        <button
                          type="button"
                          onClick={() => handleDeleteConfirm(assignment)}
                          disabled={loading}
                          style={{ background: '#dc2626', color: '#fff' }}
                        >
                          {loading ? 'Deleting...' : 'Confirm'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDelete(null)}
                          disabled={loading}
                          style={{ background: '#64748b', color: '#fff' }}
                        >
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleDeleteRequest(assignment)}
                      >
                        Delete
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))
          )}
        </tbody>
      </table>

      {activeUsers.length === 0 && (
        <div className="info-box">
          Please create at least one active user in User Master before assigning
          roles.
        </div>
      )}
    </div>
  )
}

export default UserRoleAssignment