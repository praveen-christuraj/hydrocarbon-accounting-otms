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

  const activeUsers = users.filter((user) => user.status === 'Active')
  const activeRoles = roles.filter((role) => role.status === 'Active')

  const hasPermission = (permissionName) => {
    if (!loggedInUser || !loggedInUser.permissions) {
      return false
    }

    return loggedInUser.permissions.some((permission) => {
      return permission.permissionName === permissionName
    })
  }

  const canManageUserRoleAssignment = hasPermission(
    'Manage User Role Assignment'
  )

  const handleSubmit = async (e) => {
    e.preventDefault()

    if (!canManageUserRoleAssignment) {
      alert('You do not have permission to manage user role assignments.')
      return
    }

    if (selectedUserId === '') {
      alert('Please select a user')
      return
    }

    if (selectedRoleId === '') {
      alert('Please select a role')
      return
    }

    try {
      setLoading(true)

      await saveUserRole(selectedUserId, selectedRoleId)
      await reloadUserRoleAssignments()

      setSelectedUserId('')
      setSelectedRoleId('')

      alert('User role assigned successfully')
    } catch (error) {
      alert(error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleEdit = (assignment) => {
    if (!canManageUserRoleAssignment) {
      alert('You do not have permission to manage user role assignments.')
      return
    }

    setSelectedUserId(String(assignment.userId))
    setSelectedRoleId(String(assignment.roleId))
  }

  const handleDelete = async (assignment) => {
    if (!canManageUserRoleAssignment) {
      alert('You do not have permission to manage user role assignments.')
      return
    }

    const confirmDelete = window.confirm(
      'Are you sure you want to remove this user role assignment?'
    )

    if (confirmDelete === false) {
      return
    }

    try {
      setLoading(true)

      await deleteUserRole(assignment.id)
      await reloadUserRoleAssignments()

      if (selectedUserId === String(assignment.userId)) {
        setSelectedUserId('')
        setSelectedRoleId('')
      }

      alert('User role assignment removed successfully')
    } catch (error) {
      alert(error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleCancelEdit = () => {
    setSelectedUserId('')
    setSelectedRoleId('')
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
              onChange={(e) => setSelectedUserId(e.target.value)}
            >
              <option value="">Select User</option>

              {activeUsers.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.fullName} ({user.username})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label>Select Role</label>
            <select
              value={selectedRoleId}
              onChange={(e) => setSelectedRoleId(e.target.value)}
            >
              <option value="">Select Role</option>

              {activeRoles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.roleName}
                </option>
              ))}
            </select>
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

                    <button
                      type="button"
                      onClick={() => handleDelete(assignment)}
                    >
                      Delete
                    </button>
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