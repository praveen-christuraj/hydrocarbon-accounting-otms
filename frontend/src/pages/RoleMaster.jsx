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

  const hasPermission = (permissionName) => {
    if (!loggedInUser || !loggedInUser.permissions) {
      return false
    }

    return loggedInUser.permissions.some((permission) => {
      return permission.permissionName === permissionName
    })
  }

  const canManageRole = hasPermission('Manage Role')

  const handleChange = (e) => {
    setRole({
      ...role,
      [e.target.name]: e.target.value,
    })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()

    if (!canManageRole) {
      alert('You do not have permission to manage roles.')
      return
    }

    if (role.roleName.trim() === '') {
      alert('Role Name is required')
      return
    }

    try {
      setLoading(true)

      if (editId === null) {
        await createRole(role)
        alert('Role saved successfully')
      } else {
        await updateRole(editId, role)
        alert('Role updated successfully')
      }

      await reloadRoles()
      setRole(emptyRole)
      setEditId(null)
    } catch (error) {
      alert(error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleEdit = (roleToEdit) => {
    if (!canManageRole) {
      alert('You do not have permission to manage roles.')
      return
    }

    setRole({
      roleName: roleToEdit.roleName,
      description: roleToEdit.description,
      status: roleToEdit.status,
    })

    setEditId(roleToEdit.id)
  }

  const handleDelete = async (roleId) => {
    if (!canManageRole) {
      alert('You do not have permission to manage roles.')
      return
    }

    const confirmDelete = window.confirm(
      'Are you sure you want to delete this role?'
    )

    if (confirmDelete === false) {
      return
    }

    try {
      setLoading(true)

      await deleteRole(roleId)
      await reloadRoles()

      if (editId === roleId) {
        setRole(emptyRole)
        setEditId(null)
      }

      alert('Role deleted successfully')
    } catch (error) {
      alert(error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleCancelEdit = () => {
    setRole(emptyRole)
    setEditId(null)
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
            />
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

export default RoleMaster