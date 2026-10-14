import { useMemo, useState } from 'react'
import { deleteUserRole, replaceUserRoles } from '../api/userRoleApi'
import PaginationControls, { paginateRows, usePageSize } from '../components/common/PaginationControls'
import DataTableToolbar from '../components/common/DataTableToolbar'
import { useDataFilters } from '../hooks/useDataFilters'
import { useAutoColumns } from '../hooks/useAutoColumns'
import { isAdminUser, usePermissions } from '../hooks/usePermissions'

function UserRoleAssignment({
  users,
  roles,
  userRoleAssignments,
  reloadUserRoleAssignments,
  loggedInUser,
}) {
  const [selectedUserId, setSelectedUserId] = useState('')
  const [selectedRoleIds, setSelectedRoleIds] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [page, setPage] = useState(1)

  const pageSize = usePageSize()
  const filters = useDataFilters(userRoleAssignments, useAutoColumns(userRoleAssignments), { module: 'User Role Assignment' })
  const visibleItems = paginateRows(filters.filteredRows, page, pageSize)
  const { hasPermission } = usePermissions(loggedInUser)

  const activeUsers = users.filter((user) => user.status === 'Active' && !isAdminUser(user))
  // The reserved bootstrap role is provisioned by the server and must not be
  // granted interactively, even by users who can manage ordinary assignments.
  const activeRoles = roles.filter(
    (role) => role.status === 'Active' && String(role.roleName || '').trim().toLowerCase() !== 'admin'
  )
  const canEdit = hasPermission('Edit User Role Assignment')
  const canDelete = hasPermission('Delete User Role Assignment')
  const canWrite = canEdit || canDelete

  const selectedUserAssignments = useMemo(
    () => userRoleAssignments.filter((item) => String(item.userId) === String(selectedUserId)),
    [userRoleAssignments, selectedUserId]
  )

  const clearMessages = () => {
    setError('')
    setSuccess('')
  }

  const handleUserChange = (userId) => {
    setSelectedUserId(userId)
    setSelectedRoleIds(
      userRoleAssignments
        .filter((assignment) => String(assignment.userId) === String(userId))
        .map((assignment) => Number(assignment.roleId))
    )
    setConfirmDelete(null)
    clearMessages()
  }

  const handleRoleToggle = (roleId) => {
    setSelectedRoleIds((current) =>
      current.includes(roleId)
        ? current.filter((id) => id !== roleId)
        : [...current, roleId]
    )
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    clearMessages()
    if (!canEdit) {
      setError('You do not have permission to edit user role assignments.')
      return
    }
    if (selectedUserId === '') {
      setError('Select an active user before assigning roles.')
      return
    }

    try {
      setLoading(true)
      await replaceUserRoles(selectedUserId, selectedRoleIds)
      await reloadUserRoleAssignments()
      setSuccess('User roles saved successfully.')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteConfirm = async (assignment) => {
    if (!canDelete) {
      setError('You do not have permission to delete user role assignments.')
      return
    }
    try {
      setLoading(true)
      await deleteUserRole(assignment.id)
      await reloadUserRoleAssignments()
      setSelectedRoleIds((current) => current.filter((id) => id !== Number(assignment.roleId)))
      setConfirmDelete(null)
      setSuccess('User role assignment removed successfully.')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleReset = () => {
    setSelectedUserId('')
    setSelectedRoleIds([])
    setConfirmDelete(null)
    clearMessages()
  }

  return (
    <div>
      <div className="page-title">
        <div>
          <h2>User Role Assignment</h2>
          <p>Assign one or more roles to users. The server prevents assignments that would exceed your own active permissions.</p>
        </div>
        <span className="record-count">{userRoleAssignments.length} Assignments</span>
      </div>

      {success && (
        <div className="success-box">
          {success}
          <button className="error-close" onClick={() => setSuccess('')} type="button">&times;</button>
        </div>
      )}
      {error && (
        <div className="error-box">
          {error}
          <button className="error-close" onClick={() => setError('')} type="button">&times;</button>
        </div>
      )}

      {!canWrite && (
        <div className="info-box">
          You have View User Role Assignment permission only. Edit and delete actions are disabled.
        </div>
      )}

      {canEdit && (
        <form onSubmit={handleSubmit}>
          <div>
            <label htmlFor="user-role-user">Select User</label>
            <select
              id="user-role-user"
              value={selectedUserId}
              onChange={(event) => handleUserChange(event.target.value)}
            >
              <option value="">Select User</option>
              {activeUsers.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.fullName} ({user.username})
                </option>
              ))}
            </select>
          </div>

          {selectedUserId && (
            <fieldset className="full-width-field">
              <legend>Roles for selected user</legend>
              {activeRoles.length === 0 ? (
                <div className="info-box">There are no active roles available for assignment.</div>
              ) : (
                <div className="permission-grid">
                  {activeRoles.map((role) => {
                    const roleId = Number(role.id)
                    return (
                      <label key={role.id} className="permission-card">
                        <input
                          type="checkbox"
                          checked={selectedRoleIds.includes(roleId)}
                          onChange={() => handleRoleToggle(roleId)}
                        />
                        <div>
                          <strong>{role.roleName}</strong>
                          <span>{role.description || 'No description'}</span>
                        </div>
                      </label>
                    )
                  })}
                </div>
              )}
              <p className="field-hint">
                {selectedRoleIds.length === 0
                  ? 'No roles selected. Saving will remove this user’s ordinary role assignments.'
                  : `${selectedRoleIds.length} role${selectedRoleIds.length === 1 ? '' : 's'} selected.`}
              </p>
            </fieldset>
          )}

          <div className="form-actions">
            <button type="submit" disabled={loading || !selectedUserId}>
              {loading ? 'Please wait...' : 'Save Roles'}
            </button>
            {(selectedUserId || selectedRoleIds.length > 0) && (
              <button type="button" onClick={handleReset} disabled={loading} className="btn-secondary">
                Clear
              </button>
            )}
          </div>
        </form>
      )}

      <div className="section-title">
        <h3>Assigned User Roles</h3>
        <p>Each row is one role assignment. The reserved Admin assignment is managed by system provisioning.</p>
      </div>

      <DataTableToolbar
        filters={filters}
        columns={filters.columns}
        exportFileName="user-role-assignment"
        exportTitle="User Role Assignment"
      />

      <table>
        <thead>
          <tr>
            <th>Full Name</th>
            <th>Username</th>
            <th>Assigned Role</th>
            {canWrite && <th>Actions</th>}
          </tr>
        </thead>
        <tbody>
          {userRoleAssignments.length === 0 ? (
            <tr>
              <td colSpan={canWrite ? 4 : 3} className="empty-table">
                No user roles assigned yet.
              </td>
            </tr>
          ) : (
            visibleItems.map((assignment) => (
              <tr key={assignment.id}>
                <td>{assignment.fullName}</td>
                <td>{assignment.username}</td>
                <td><span className="permission-badge">{assignment.roleName}</span></td>
                {canWrite && (
                  <td>
                    {String(assignment.roleName || '').toLowerCase() !== 'admin' && (
                      <>
                        {canEdit && (
                          <button type="button" onClick={() => handleUserChange(String(assignment.userId))}>
                            Manage User Roles
                          </button>
                        )}
                        {canDelete && confirmDelete === assignment.id ? (
                          <span>
                            <button
                              type="button"
                              onClick={() => handleDeleteConfirm(assignment)}
                              disabled={loading}
                              className="btn-danger"
                            >
                              {loading ? 'Deleting...' : 'Confirm'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDelete(null)}
                              disabled={loading}
                              className="btn-secondary"
                            >
                              Cancel
                            </button>
                          </span>
                        ) : canDelete ? (
                          <button type="button" onClick={() => setConfirmDelete(assignment.id)}>
                            Delete
                          </button>
                        ) : null}
                      </>
                    )}
                  </td>
                )}
              </tr>
            ))
          )}
        </tbody>
      </table>

      {selectedUserId && selectedUserAssignments.length === 0 && (
        <p className="field-hint">This user currently has no roles assigned.</p>
      )}
      <PaginationControls
        currentPage={page}
        totalRows={filters.filteredRows.length}
        onPageChange={setPage}
      />
    </div>
  )
}

export default UserRoleAssignment
