import { useState } from 'react'
import { createRole, deleteRole, updateRole } from '../api/roleApi'

function RoleMaster({ roles, reloadRoles, loggedInUser }) {
  const emptyRole = {
    roleName: '',
    description: '',
    status: 'Active',
  }

  const [role, setRole] = useState(emptyRole)
  const [editId, setEditId] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [fieldErrors, setFieldErrors] = useState({})

  const isAdminBootstrap =
    String(loggedInUser?.username || '').toLowerCase() === 'admin'

  const hasPermission = (permissionName) => {
    if (isAdminBootstrap) return true
    if (!loggedInUser || !Array.isArray(loggedInUser.permissions)) return false
    return loggedInUser.permissions.some(
      (p) => p.permissionName === permissionName
    )
  }

  const canManageRole = hasPermission('Manage Role')

  const clearError = () => setError('')
  const clearSuccess = () => setSuccess('')

  const handleChange = (e) => {
    setRole({ ...role, [e.target.name]: e.target.value })
    setFieldErrors({ ...fieldErrors, [e.target.name]: '' })
  }

  const validateRole = () => {
    const errors = {}
    if (role.roleName.trim() === '') errors.roleName = 'Role Name is required'
    setFieldErrors(errors)
    return Object.keys(errors).length === 0
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    clearError()
    clearSuccess()

    if (!canManageRole) {
      setError('You do not have permission to manage roles.')
      return
    }

    if (!validateRole()) return

    try {
      setLoading(true)

      if (editId === null) {
        await createRole(role)
        setSuccess('Role saved successfully')
      } else {
        await updateRole(editId, role)
        setSuccess('Role updated successfully')
      }

      setFieldErrors({})
      await reloadRoles()
      setRole(emptyRole)
      setEditId(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleEdit = (roleToEdit) => {
    clearError()
    clearSuccess()
    setConfirmDelete(null)
    setFieldErrors({})

    if (!canManageRole) {
      setError('You do not have permission to manage roles.')
      return
    }

    setRole({
      roleName: roleToEdit.roleName,
      description: roleToEdit.description,
      status: roleToEdit.status,
    })

    setEditId(roleToEdit.id)
  }

  const handleDeleteRequest = (id) => {
    clearError()
    clearSuccess()
    setConfirmDelete(id)
  }

  const handleDeleteConfirm = async (roleId) => {
    if (!canManageRole) {
      setError('You do not have permission to manage roles.')
      return
    }

    try {
      setLoading(true)
      await deleteRole(roleId)
      setConfirmDelete(null)
      setSuccess('Role deleted successfully')
      await reloadRoles()

      if (editId === roleId) {
        setRole(emptyRole)
        setEditId(null)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleCancelEdit = () => {
    setRole(emptyRole)
    setEditId(null)
    setFieldErrors({})
    clearError()
    clearSuccess()
    setConfirmDelete(null)
  }

  return (
    <div>
      <div className="page-title">
        <div>
          <h2>Role Master</h2>
          <p>Create, update, and manage application roles.</p>
        </div>

        <span className="record-count">{roles.length} Roles</span>
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

      {!canManageRole && (
        <div className="info-box">
          You have View Role permission only. Create, edit, and delete actions
          are disabled.
        </div>
      )}

      {canManageRole && (
        <form onSubmit={handleSubmit}>
          <div>
            <label>Role Name</label>
            <input
              name="roleName"
              type="text"
              value={role.roleName}
              onChange={handleChange}
              placeholder="Enter role name"
              style={fieldErrors.roleName ? { borderColor: '#dc2626' } : {}}
            />
            {fieldErrors.roleName && (
              <small style={{ color: '#dc2626', marginTop: 4 }}>{fieldErrors.roleName}</small>
            )}
          </div>

          <div>
            <label>Status</label>
            <select name="status" value={role.status} onChange={handleChange}>
              <option>Active</option>
              <option>Inactive</option>
              <option>Blocked</option>
            </select>
          </div>

          <div className="full-width-field">
            <label>Description</label>
            <textarea
              name="description"
              value={role.description}
              onChange={handleChange}
              placeholder="Enter role description"
              rows="3"
            />
          </div>

          <div className="form-actions">
            <button type="submit" disabled={loading}>
              {loading
                ? 'Please wait...'
                : editId === null
                  ? 'Save Role'
                  : 'Update Role'}
            </button>

            {editId !== null && (
              <button
                type="button"
                onClick={handleCancelEdit}
                disabled={loading}
              >
                Cancel Edit
              </button>
            )}
          </div>
        </form>
      )}

      <div className="section-title">
        <h3>Saved Roles</h3>
        <p>Roles are now saved permanently in PostgreSQL.</p>
      </div>

      <table>
        <thead>
          <tr>
            <th>Role Name</th>
            <th>Description</th>
            <th>Status</th>
            {canManageRole && <th>Actions</th>}
          </tr>
        </thead>

        <tbody>
          {roles.length === 0 ? (
            <tr>
              <td colSpan={canManageRole ? 4 : 3} className="empty-table">
                No roles added yet.
              </td>
            </tr>
          ) : (
            roles.map((item) => (
              <tr key={item.id}>
                <td>{item.roleName}</td>
                <td>{item.description}</td>
                <td>
                  <span className={`status-badge ${item.status.toLowerCase()}`}>
                    {item.status}
                  </span>
                </td>

                {canManageRole && (
                  <td>
                    <button type="button" onClick={() => handleEdit(item)}>
                      Edit
                    </button>

                    {confirmDelete === item.id ? (
                      <span>
                        <button
                          type="button"
                          onClick={() => handleDeleteConfirm(item.id)}
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
                      <button type="button" onClick={() => handleDeleteRequest(item.id)}>
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
    </div>
  )
}

export default RoleMaster