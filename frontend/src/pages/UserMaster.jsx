import { useEffect, useState, useMemo, useCallback } from 'react'
import { createUser, deleteUser, getUsers, updateUser } from '../api/userApi'

const PAGE_SIZE = 50

const calcPasswordStrength = (pw) => {
  let score = 0
  if (pw.length >= 8) score += 1
  if (pw.length >= 12) score += 1
  if (/[a-z]/.test(pw)) score += 1
  if (/[A-Z]/.test(pw)) score += 1
  if (/[0-9]/.test(pw)) score += 1
  if (/[^a-zA-Z0-9]/.test(pw)) score += 1
  if (score <= 2) return { level: 'weak', label: 'Weak', pct: 25, color: '#dc2626' }
  if (score <= 3) return { level: 'fair', label: 'Fair', pct: 50, color: '#ea580c' }
  if (score <= 5) return { level: 'good', label: 'Good', pct: 75, color: '#ca8a04' }
  return { level: 'strong', label: 'Strong', pct: 100, color: '#16a34a' }
}

function UserMaster({ loggedInUser }) {
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

  const [users, setUsers] = useState([])
  const [user, setUser] = useState(emptyUser)
  const [editId, setEditId] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [search, setSearch] = useState('')
  const [skip, setSkip] = useState(0)
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [confirmPassword, setConfirmPassword] = useState('')
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

  const canManageUser = hasPermission('Manage User')
  const isSelfEdit = editId !== null && editId === loggedInUser?.id

  const pwStrength = useMemo(() => calcPasswordStrength(user.password), [user.password])

  const clearError = () => setError('')
  const clearSuccess = () => setSuccess('')

  const reloadUsers = useCallback(async (searchTerm = search, offset = skip) => {
    try {
      const result = await getUsers({ skip: offset, limit: PAGE_SIZE, search: searchTerm })
      setUsers(result.items)
      setTotal(result.total)
      setSkip(result.skip)
      setHasMore(result.has_more)
    } catch (err) {
      setError(err.message)
      setUsers([])
      setTotal(0)
      setHasMore(false)
    }
  }, [search, skip])

  useEffect(() => {
    reloadUsers()
  }, [])

  const handleSearchChange = (e) => {
    const val = e.target.value
    setSearch(val)
    reloadUsers(val, 0)
  }

  const handleChange = (e) => {
    setUser({ ...user, [e.target.name]: e.target.value })
    setFieldErrors({ ...fieldErrors, [e.target.name]: '' })
  }

  const handleConfirmPasswordChange = (e) => {
    setConfirmPassword(e.target.value)
  }

  const validateUser = () => {
    const errors = {}

    if (user.fullName.trim() === '') errors.fullName = 'Full Name is required'
    if (user.username.trim() === '') errors.username = 'Username is required'
    if (user.email.trim() === '') errors.email = 'Email is required'

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (user.email.trim() && !emailRegex.test(user.email.trim())) {
      errors.email = 'Invalid email format'
    }

    if (editId === null && user.password.trim() === '') {
      errors.password = 'Password is required for new user'
    }

    if (user.password) {
      if (user.password.length < 12 && editId === null) {
        errors.password = 'Password must be at least 12 characters'
      } else if (user.password.length < 12 && editId !== null) {
        errors.password = 'Password must be at least 12 characters'
      }
      if (confirmPassword !== user.password) {
        errors.confirmPassword = 'Passwords do not match'
      }
    }

    if (editId !== null && user.password && editId === loggedInUser?.id) {
      errors.password = 'You are changing your own password. Make sure you remember the new one.'
    }

    const usernameAlreadyExists = users.some((item) => {
      return (
        item.username.toLowerCase() === user.username.toLowerCase() &&
        item.id !== editId
      )
    })

    if (usernameAlreadyExists) {
      errors.username = 'Username already exists. Please choose another username.'
    }

    setFieldErrors(errors)
    return Object.keys(errors).length === 0
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    clearError()
    clearSuccess()

    if (!canManageUser) {
      setError('You do not have permission to manage users.')
      return
    }

    if (!validateUser()) return

    try {
      setLoading(true)

      if (editId === null) {
        await createUser(user)
        setSuccess('User created successfully')
      } else {
        await updateUser(editId, user)
        setSuccess('User updated successfully')
      }

      setConfirmPassword('')
      setFieldErrors({})
      await reloadUsers(search, 0)
      setUser(emptyUser)
      setEditId(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleEdit = (u) => {
    clearError()
    clearSuccess()
    setConfirmDelete(null)
    setFieldErrors({})
    setUser({
      fullName: u.fullName,
      username: u.username,
      email: u.email,
      phone: u.phone || '',
      department: u.department || '',
      designation: u.designation || '',
      password: '',
      status: u.status,
    })
    setConfirmPassword('')
    setEditId(u.id)
  }

  const handleDeleteRequest = (id) => {
    clearError()
    clearSuccess()
    setConfirmDelete(id)
  }

  const handleDeleteConfirm = async (id) => {
    if (!canManageUser) {
      setError('You do not have permission to manage users.')
      return
    }

    try {
      setLoading(true)
      await deleteUser(id)
      setConfirmDelete(null)
      setSuccess('User deleted successfully')
      await reloadUsers(search, 0)

      if (editId === id) {
        setUser(emptyUser)
        setEditId(null)
        setConfirmPassword('')
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleCancelEdit = () => {
    setUser(emptyUser)
    setEditId(null)
    setConfirmPassword('')
    setFieldErrors({})
    clearError()
    clearSuccess()
    setConfirmDelete(null)
  }

  const handlePrevPage = () => {
    const newSkip = Math.max(0, skip - PAGE_SIZE)
    reloadUsers(search, newSkip)
  }

  const handleNextPage = () => {
    if (hasMore) {
      reloadUsers(search, skip + PAGE_SIZE)
    }
  }

  const currentPage = Math.floor(skip / PAGE_SIZE) + 1
  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div>
      <div className="page-title">
        <div>
          <h2>User Master</h2>
          <p>Create, update, and manage application users.</p>
        </div>
        <span className="record-count">{total} Users</span>
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

      {!canManageUser && (
        <div className="info-box">
          You are in view-only mode. Admin can manage users.
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div>
          <label>Full Name</label>
          <input
            name="fullName"
            type="text"
            value={user.fullName}
            onChange={handleChange}
            placeholder="Enter full name"
            style={fieldErrors.fullName ? { borderColor: '#dc2626' } : {}}
          />
          {fieldErrors.fullName && (
            <small style={{ color: '#dc2626', marginTop: 4 }}>{fieldErrors.fullName}</small>
          )}
        </div>

        <div>
          <label>Username</label>
          <input
            name="username"
            type="text"
            value={user.username}
            onChange={handleChange}
            placeholder="Enter username"
            disabled={editId !== null}
            style={fieldErrors.username ? { borderColor: '#dc2626' } : {}}
          />
          {fieldErrors.username && (
            <small style={{ color: '#dc2626', marginTop: 4 }}>{fieldErrors.username}</small>
          )}
        </div>

        <div>
          <label>Email</label>
          <input
            name="email"
            type="email"
            value={user.email}
            onChange={handleChange}
            placeholder="Enter email address"
            style={fieldErrors.email ? { borderColor: '#dc2626' } : {}}
          />
          {fieldErrors.email && (
            <small style={{ color: '#dc2626', marginTop: 4 }}>{fieldErrors.email}</small>
          )}
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
          <label>Password {editId !== null ? '(leave blank to keep same)' : ''}</label>
          <div className="password-input-wrapper">
            <input
              name="password"
              type="password"
              value={user.password}
              onChange={handleChange}
              placeholder={editId !== null ? 'New password (optional)' : 'Enter password'}
              style={fieldErrors.password ? { borderColor: '#dc2626' } : {}}
            />
          </div>
          {fieldErrors.password && (
            <small style={{ color: '#dc2626', marginTop: 4 }}>{fieldErrors.password}</small>
          )}
          {user.password.length > 0 && (
            <div className="password-strength">
              <div
                className="password-strength-bar"
                style={{ width: `${pwStrength.pct}%`, background: pwStrength.color }}
              />
              <div className={`password-strength-text ${pwStrength.level}`}>
                {pwStrength.label}
              </div>
            </div>
          )}
          {user.password.length > 0 && !fieldErrors.password && (
            <small style={{ color: '#64748b', marginTop: 4 }}>
              Minimum 12 characters with uppercase, lowercase, number &amp; special character
            </small>
          )}
        </div>

        {user.password.length > 0 && (
          <div>
            <label>Confirm Password</label>
            <input
              name="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={handleConfirmPasswordChange}
              placeholder="Re-enter password"
              style={fieldErrors.confirmPassword ? { borderColor: '#dc2626' } : {}}
            />
            {fieldErrors.confirmPassword && (
              <small style={{ color: '#dc2626', marginTop: 4 }}>{fieldErrors.confirmPassword}</small>
            )}
          </div>
        )}

        {isSelfEdit && (user.status === 'Inactive' || user.status === 'Blocked') && (
          <div className="info-box" style={{ background: '#fef2f2', borderColor: '#fecaca', color: '#b91c1c', gridColumn: '1 / -1' }}>
            Warning: You are changing your own account status to &quot;{user.status}&quot;. This may lock you out of the system.
          </div>
        )}

        <div>
          <label>Status</label>
          <select name="status" value={user.status} onChange={handleChange}>
            <option>Active</option>
            <option>Inactive</option>
            <option>Blocked</option>
          </select>
        </div>

        <div className="form-actions">
          <button type="submit" disabled={loading || !canManageUser}>
            {loading
              ? 'Please wait...'
              : editId === null
                ? 'Save User'
                : 'Update User'}
          </button>

          {editId !== null && (
            <button type="button" onClick={handleCancelEdit} disabled={loading}>
              Cancel Edit
            </button>
          )}
        </div>
      </form>

      <div className="section-title">
        <h3>Saved Users</h3>
        <p>Users are loaded from the live database.</p>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 14, alignItems: 'end' }}>
        <div style={{ flex: 1, maxWidth: 320 }}>
          <label htmlFor="search-input" style={{ fontSize: 13 }}>Search</label>
          <input
            id="search-input"
            type="text"
            value={search}
            onChange={handleSearchChange}
            placeholder="Search by name, username or email"
            style={{ width: '100%' }}
          />
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th>Full Name</th>
            <th>Username</th>
            <th>Email</th>
            <th>Department</th>
            <th>Designation</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>

        <tbody>
          {loading && users.length === 0 ? (
            <tr>
              <td colSpan="7" className="empty-table">
                Loading users...
              </td>
            </tr>
          ) : users.length === 0 ? (
            <tr>
              <td colSpan="7" className="empty-table">
                {search ? 'No users match your search.' : 'No users found.'}
              </td>
            </tr>
          ) : (
            users.map((item) => (
              <tr key={item.id}>
                <td>{item.fullName}</td>
                <td>{item.username}</td>
                <td>{item.email}</td>
                <td>{item.department}</td>
                <td>{item.designation}</td>
                <td>
                  <span className={`status-badge ${item.status.toLowerCase()}`}>
                    {item.status}
                  </span>
                </td>
                <td>
                  <button
                    type="button"
                    onClick={() => handleEdit(item)}
                    disabled={!canManageUser || loading}
                  >
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
                    <button
                      type="button"
                      onClick={() => handleDeleteRequest(item.id)}
                      disabled={!canManageUser || loading}
                    >
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      {total > PAGE_SIZE && (
        <div className="pagination-controls">
          <div className="pagination-summary">
            Showing {users.length > 0 ? skip + 1 : 0}–
            {Math.min(skip + users.length, total)} of {total} users
          </div>
          <div className="pagination-actions">
            <button type="button" onClick={handlePrevPage} disabled={skip === 0 || loading}>
              &laquo; Prev
            </button>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#475569' }}>
              Page {currentPage} of {totalPages}
            </span>
            <button type="button" onClick={handleNextPage} disabled={!hasMore || loading}>
              Next &raquo;
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default UserMaster