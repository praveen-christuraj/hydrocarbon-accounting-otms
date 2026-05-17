import { useState } from 'react'
import { createUser, deleteUser, updateUser } from '../api/userApi'

function UserMaster({ users, reloadUsers, loggedInUser }) {
  const emptyUser = {
    fullName: '',
    username: '',
    email: '',
    phone: '',
    department: '',
    designation: '',
    password: '',
    status: 'Active',
  }

  const [user, setUser] = useState(emptyUser)
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

  const canManageUser = hasPermission('Manage User')

  const handleChange = (e) => {
    setUser({
      ...user,
      [e.target.name]: e.target.value,
    })
  }

  const validateUser = () => {
    if (user.fullName.trim() === '') {
      alert('Full Name is required')
      return false
    }

    if (user.username.trim() === '') {
      alert('Username is required')
      return false
    }

    if (user.email.trim() === '') {
      alert('Email is required')
      return false
    }

    if (editId === null && user.password.trim() === '') {
      alert('Password is required for new user')
      return false
    }

    const usernameAlreadyExists = users.some((item) => {
      return (
        item.username.toLowerCase() === user.username.toLowerCase() &&
        item.id !== editId
      )
    })

    if (usernameAlreadyExists) {
      alert('Username already exists. Please choose another username.')
      return false
    }

    return true
  }

  const handleSubmit = async (e) => {
    e.preventDefault()

    if (!canManageUser) {
      alert('You do not have permission to manage users.')
      return
    }

    if (!validateUser()) {
      return
    }

    try {
      setLoading(true)

      if (editId === null) {
        await createUser(user)
        alert('User saved successfully')
      } else {
        await updateUser(editId, user)
        alert('User updated successfully')
      }

      await reloadUsers()

      setUser(emptyUser)
      setEditId(null)
    } catch (error) {
      alert(error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleEdit = (userToEdit) => {
    if (!canManageUser) {
      alert('You do not have permission to manage users.')
      return
    }

    setUser({
      fullName: userToEdit.fullName,
      username: userToEdit.username,
      email: userToEdit.email,
      phone: userToEdit.phone || '',
      department: userToEdit.department || '',
      designation: userToEdit.designation || '',
      password: '',
      status: userToEdit.status,
    })

    setEditId(userToEdit.id)
  }

  const handleDelete = async (userToDelete) => {
    if (!canManageUser) {
      alert('You do not have permission to manage users.')
      return
    }

    if (loggedInUser && loggedInUser.id === userToDelete.id) {
      alert('You cannot delete your own logged-in user account.')
      return
    }

    const confirmDelete = window.confirm(
      'Are you sure you want to delete this user?'
    )

    if (confirmDelete === false) {
      return
    }

    try {
      setLoading(true)

      await deleteUser(userToDelete.id)
      await reloadUsers()

      if (editId === userToDelete.id) {
        setUser(emptyUser)
        setEditId(null)
      }

      alert('User deleted successfully')
    } catch (error) {
      alert(error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleCancelEdit = () => {
    setUser(emptyUser)
    setEditId(null)
  }

  return (
    <div>
      <div className="page-title">
        <div>
          <h2>User Master</h2>
          <p>Create, update, and manage application users.</p>
        </div>

        <span className="record-count">{users.length} Users</span>
      </div>

      {!canManageUser && (
        <div className="info-box">
          You have View User permission only. Create, edit, and delete actions
          are disabled.
        </div>
      )}

      {canManageUser && (
        <form onSubmit={handleSubmit}>
          <div>
            <label>Full Name</label>
            <input
              name="fullName"
              type="text"
              value={user.fullName}
              onChange={handleChange}
              placeholder="Enter full name"
            />
          </div>

          <div>
            <label>Username</label>
            <input
              name="username"
              type="text"
              value={user.username}
              onChange={handleChange}
              placeholder="Enter username"
            />
          </div>

          <div>
            <label>Email</label>
            <input
              name="email"
              type="email"
              value={user.email}
              onChange={handleChange}
              placeholder="Enter email address"
            />
          </div>

          <div>
            <label>Phone</label>
            <input
              name="phone"
              type="text"
              value={user.phone}
              onChange={handleChange}
              placeholder="Enter phone number"
            />
          </div>

          <div>
            <label>Department</label>
            <input
              name="department"
              type="text"
              value={user.department}
              onChange={handleChange}
              placeholder="Enter department"
            />
          </div>

          <div>
            <label>Designation</label>
            <input
              name="designation"
              type="text"
              value={user.designation}
              onChange={handleChange}
              placeholder="Enter designation"
            />
          </div>

          <div>
            <label>
              Password{' '}
              {editId !== null ? '(leave blank to keep existing password)' : ''}
            </label>
            <input
              name="password"
              type="password"
              value={user.password}
              onChange={handleChange}
              placeholder={
                editId === null
                  ? 'Enter password'
                  : 'Leave blank to keep existing password'
              }
            />
          </div>

          <div>
            <label>Status</label>
            <select name="status" value={user.status} onChange={handleChange}>
              <option>Active</option>
              <option>Inactive</option>
              <option>Blocked</option>
            </select>
          </div>

          <div className="form-actions">
            <button type="submit" disabled={loading}>
              {loading
                ? 'Please wait...'
                : editId === null
                  ? 'Save User'
                  : 'Update User'}
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
        <h3>Saved Users</h3>
        <p>Users are now saved permanently in PostgreSQL.</p>
      </div>

      <table>
        <thead>
          <tr>
            <th>Full Name</th>
            <th>Username</th>
            <th>Email</th>
            <th>Phone</th>
            <th>Department</th>
            <th>Designation</th>
            <th>Status</th>
            {canManageUser && <th>Actions</th>}
          </tr>
        </thead>

        <tbody>
          {users.length === 0 ? (
            <tr>
              <td colSpan={canManageUser ? 8 : 7} className="empty-table">
                No users added yet.
              </td>
            </tr>
          ) : (
            users.map((item) => (
              <tr key={item.id}>
                <td>{item.fullName}</td>
                <td>{item.username}</td>
                <td>{item.email}</td>
                <td>{item.phone}</td>
                <td>{item.department}</td>
                <td>{item.designation}</td>
                <td>
                  <span className={`status-badge ${item.status.toLowerCase()}`}>
                    {item.status}
                  </span>
                </td>

                {canManageUser && (
                  <td>
                    <button type="button" onClick={() => handleEdit(item)}>
                      Edit
                    </button>

                    <button type="button" onClick={() => handleDelete(item)}>
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

export default UserMaster