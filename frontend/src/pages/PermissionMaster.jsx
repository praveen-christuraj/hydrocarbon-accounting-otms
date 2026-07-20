import { useState } from 'react'
import {
  createPermission,
  deletePermission,
  updatePermission,
} from '../api/permissionApi'

function PermissionMaster({ permissions, reloadPermissions, loggedInUser }) {
  const emptyPermission = {
    permissionName: '',
    moduleName: '',
    description: '',
    status: 'Active',
  }

  const [permission, setPermission] = useState(emptyPermission)
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

  const canManagePermission = hasPermission('Manage Permission')

  const clearError = () => setError('')
  const clearSuccess = () => setSuccess('')

  const handleChange = (e) => {
    setPermission({ ...permission, [e.target.name]: e.target.value })
    setFieldErrors({ ...fieldErrors, [e.target.name]: '' })
  }

  const validatePermission = () => {
    const errors = {}
    if (permission.permissionName.trim() === '') errors.permissionName = 'Permission Name is required'
    if (permission.moduleName.trim() === '') errors.moduleName = 'Module Name is required'
    setFieldErrors(errors)
    return Object.keys(errors).length === 0
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    clearError()
    clearSuccess()

    if (!canManagePermission) {
      setError('You do not have permission to manage permissions.')
      return
    }

    if (!validatePermission()) return

    try {
      setLoading(true)

      if (editId === null) {
        await createPermission(permission)
        setSuccess('Permission saved successfully')
      } else {
        await updatePermission(editId, permission)
        setSuccess('Permission updated successfully')
      }

      setFieldErrors({})
      await reloadPermissions()
      setPermission(emptyPermission)
      setEditId(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleEdit = (permissionToEdit) => {
    clearError()
    clearSuccess()
    setConfirmDelete(null)
    setFieldErrors({})

    if (!canManagePermission) {
      setError('You do not have permission to manage permissions.')
      return
    }

    setPermission({
      permissionName: permissionToEdit.permissionName,
      moduleName: permissionToEdit.moduleName,
      description: permissionToEdit.description,
      status: permissionToEdit.status,
    })

    setEditId(permissionToEdit.id)
  }

  const handleDeleteRequest = (id) => {
    clearError()
    clearSuccess()
    setConfirmDelete(id)
  }

  const handleDeleteConfirm = async (permissionId) => {
    if (!canManagePermission) {
      setError('You do not have permission to manage permissions.')
      return
    }

    try {
      setLoading(true)
      await deletePermission(permissionId)
      setConfirmDelete(null)
      setSuccess('Permission deleted successfully')
      await reloadPermissions()

      if (editId === permissionId) {
        setPermission(emptyPermission)
        setEditId(null)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleCancelEdit = () => {
    setPermission(emptyPermission)
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
          <h2>Permission Master</h2>
          <p>Create and manage system permissions for RBAC.</p>
        </div>

        <span className="record-count">{permissions.length} Permissions</span>
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

      {!canManagePermission && (
        <div className="info-box">
          You have View Permission permission only. Create, edit, and delete
          actions are disabled.
        </div>
      )}

      {canManagePermission && (
        <form onSubmit={handleSubmit}>
          <div>
            <label>Permission Name</label>
            <input
              name="permissionName"
              type="text"
              value={permission.permissionName}
              onChange={handleChange}
              placeholder="Example: View Asset"
              style={fieldErrors.permissionName ? { borderColor: '#dc2626' } : {}}
            />
            {fieldErrors.permissionName && (
              <small style={{ color: '#dc2626', marginTop: 4 }}>{fieldErrors.permissionName}</small>
            )}
          </div>

          <div>
            <label>Module Name</label>
            <select
              name="moduleName"
              value={permission.moduleName}
              onChange={handleChange}
              style={fieldErrors.moduleName ? { borderColor: '#dc2626' } : {}}
            >
              <option value="">Select Module</option>
              <option>User Master</option>
              <option>Role Master</option>
              <option>Permission Master</option>
              <option>Role Permission Assignment</option>
              <option>User Role Assignment</option>
              <option>Access Summary</option>
              <option>Location Master</option>
              <option>Asset Type Master</option>
              <option>Asset Master</option>
              <option>Calibration Template Master</option>
              <option>Asset Calibration Table</option>
              <option>Asset Assignment</option>
              <option>Asset Assignment Summary</option>
              <option>Operations</option>
              <option>Barge Seal Master</option>
              <option>Company Report Profile</option>
              <option>Reports</option>
              <option>Admin</option>
            </select>
            {fieldErrors.moduleName && (
              <small style={{ color: '#dc2626', marginTop: 4 }}>{fieldErrors.moduleName}</small>
            )}
          </div>

          <div>
            <label>Status</label>
            <select
              name="status"
              value={permission.status}
              onChange={handleChange}
            >
              <option>Active</option>
              <option>Inactive</option>
              <option>Blocked</option>
            </select>
          </div>

          <div className="full-width-field">
            <label>Description</label>
            <textarea
              name="description"
              value={permission.description}
              onChange={handleChange}
              placeholder="Enter permission description"
              rows="3"
            />
          </div>

          <div className="form-actions">
            <button type="submit" disabled={loading}>
              {loading
                ? 'Please wait...'
                : editId === null
                  ? 'Save Permission'
                  : 'Update Permission'}
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
        <h3>Saved Permissions</h3>
        <p>Permissions are now saved permanently in PostgreSQL.</p>
      </div>

      <table>
        <thead>
          <tr>
            <th>Permission Name</th>
            <th>Module</th>
            <th>Description</th>
            <th>Status</th>
            {canManagePermission && <th>Actions</th>}
          </tr>
        </thead>

        <tbody>
          {permissions.length === 0 ? (
            <tr>
              <td
                colSpan={canManagePermission ? 5 : 4}
                className="empty-table"
              >
                No permissions added yet.
              </td>
            </tr>
          ) : (
            permissions.map((item) => (
              <tr key={item.id}>
                <td>{item.permissionName}</td>
                <td>{item.moduleName}</td>
                <td>{item.description}</td>
                <td>
                  <span className={`status-badge ${item.status.toLowerCase()}`}>
                    {item.status}
                  </span>
                </td>

                {canManagePermission && (
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

export default PermissionMaster