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

  const hasPermission = (permissionName) => {
    if (!loggedInUser || !loggedInUser.permissions) {
      return false
    }

    return loggedInUser.permissions.some((item) => {
      return item.permissionName === permissionName
    })
  }

  const canManagePermission = hasPermission('Manage Permission')

  const handleChange = (e) => {
    setPermission({
      ...permission,
      [e.target.name]: e.target.value,
    })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()

    if (!canManagePermission) {
      alert('You do not have permission to manage permissions.')
      return
    }

    if (permission.permissionName.trim() === '') {
      alert('Permission Name is required')
      return
    }

    if (permission.moduleName.trim() === '') {
      alert('Module Name is required')
      return
    }

    try {
      setLoading(true)

      if (editId === null) {
        await createPermission(permission)
        alert('Permission saved successfully')
      } else {
        await updatePermission(editId, permission)
        alert('Permission updated successfully')
      }

      await reloadPermissions()
      setPermission(emptyPermission)
      setEditId(null)
    } catch (error) {
      alert(error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleEdit = (permissionToEdit) => {
    if (!canManagePermission) {
      alert('You do not have permission to manage permissions.')
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

  const handleDelete = async (permissionId) => {
    if (!canManagePermission) {
      alert('You do not have permission to manage permissions.')
      return
    }

    const confirmDelete = window.confirm(
      'Are you sure you want to delete this permission?'
    )

    if (confirmDelete === false) {
      return
    }

    try {
      setLoading(true)

      await deletePermission(permissionId)
      await reloadPermissions()

      if (editId === permissionId) {
        setPermission(emptyPermission)
        setEditId(null)
      }

      alert('Permission deleted successfully')
    } catch (error) {
      alert(error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleCancelEdit = () => {
    setPermission(emptyPermission)
    setEditId(null)
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
            />
          </div>

          <div>
            <label>Module Name</label>
            <select
              name="moduleName"
              value={permission.moduleName}
              onChange={handleChange}
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

                    <button type="button" onClick={() => handleDelete(item.id)}>
                      Delete
                    </button>
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