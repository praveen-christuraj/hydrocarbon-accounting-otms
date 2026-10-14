import { useEffect, useState, useMemo, useCallback } from 'react'
import { createUser, deleteUser, getUsers, updateUser } from '../api/userApi'
import PaginationControls, { paginateRows, usePageSize } from '../components/common/PaginationControls'
import DataTableToolbar from '../components/common/DataTableToolbar'
import AlertMessage from '../components/common/AlertMessage'
import { useConfirm } from '../components/common/ConfirmProvider'
import { usePermissions } from '../hooks/usePermissions'
import { useDataFilters } from '../hooks/useDataFilters'
import { useAutoColumns } from '../hooks/useAutoColumns'
import { logUiAction } from '../utils/actionLogger'

const FETCH_CHUNK = 200
const MAX_USERS = 10000
const USER_STATUSES = ['Active', 'Inactive', 'Blocked']

const calcPasswordStrength = (pw) => {
  let score = 0
  if (pw.length >= 8) score += 1
  if (pw.length >= 12) score += 1
  if (/[a-z]/.test(pw)) score += 1
  if (/[A-Z]/.test(pw)) score += 1
  if (/[0-9]/.test(pw)) score += 1
  if (/[^a-zA-Z0-9]/.test(pw)) score += 1
  if (score <= 2) return { level: 'weak', label: 'Weak', pct: 25, color: 'var(--danger)' }
  if (score <= 3) return { level: 'fair', label: 'Fair', pct: 50, color: 'var(--warning)' }
  if (score <= 5) return { level: 'good', label: 'Good', pct: 75, color: 'var(--info)' }
  return { level: 'strong', label: 'Strong', pct: 100, color: 'var(--success)' }
}

function UserMaster({ reloadUsers: appReloadUsers, loggedInUser }) {
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
  const [listLoading, setListLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const [page, setPage] = useState(1)
  const pageSize = usePageSize()
  const confirm = useConfirm()

  const columns = useAutoColumns(users, {
    exclude: ['password'],
    labels: { fullName: 'Full Name', username: 'Username', createdAt: 'Created', updatedAt: 'Updated' },
    types: { createdAt: 'date', updatedAt: 'date' },
  })
  const filters = useDataFilters(users, columns, { module: 'User Master' })
  const visibleUsers = paginateRows(filters.filteredRows, page, pageSize)
  const total = users.length

  const { hasPermission } = usePermissions(loggedInUser)
  const canCreate = hasPermission('Create User')
  const canEdit = hasPermission('Edit User')
  const canDelete = hasPermission('Delete User')
  const canWriteUser = canCreate || canEdit
  const isSelfEdit = editId !== null && editId === loggedInUser?.id

  const pwStrength = useMemo(() => calcPasswordStrength(user.password), [user.password])

  const clearError = () => setError('')
  const clearSuccess = () => setSuccess('')

  // Load the complete user list in chunks (the API serves at most 200 per
  // call) so filtering, paging and export work on the full data set.
  const reloadUsers = useCallback(async () => {
    try {
      await Promise.resolve()
      setListLoading(true)
      const all = []
      let offset = 0
      let more = true
      while (more && offset < MAX_USERS) {
        const result = await getUsers({ skip: offset, limit: FETCH_CHUNK })
        all.push(...result.items)
        more = result.has_more && result.items.length > 0
        offset += FETCH_CHUNK
      }
      setUsers(all)
    } catch (err) {
      setError(err.message)
      setUsers([])
    } finally {
      setListLoading(false)
    }
  }, [])

  useEffect(() => {
    reloadUsers()
  }, [reloadUsers])

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

    if (!(editId === null ? canCreate : canEdit)) {
      setError(
        `You do not have permission to ${editId === null ? 'create' : 'edit'} users.`
      )
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
      await reloadUsers()
      if (appReloadUsers) await appReloadUsers()
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
    setFieldErrors({})
    logUiAction('User Master', 'Start Edit', { username: u.username })
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

  const handleDelete = async (item) => {
    clearError()
    clearSuccess()

    if (!canDelete) {
      setError('You do not have permission to delete users.')
      return
    }

    const confirmed = await confirm({
      title: 'Delete user',
      message: `Delete user "${item.fullName}" (${item.username})?`,
      details: 'The user loses access immediately. This action is recorded in the audit log.',
      tone: 'danger',
      confirmLabel: 'Delete user',
      module: 'User Master',
    })
    if (!confirmed) return

    try {
      setLoading(true)
      await deleteUser(item.id)
      setSuccess('User deleted successfully')
      await reloadUsers()
      if (appReloadUsers) await appReloadUsers()

      if (editId === item.id) {
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
  }

  const importFields = [
    { key: 'fullName', label: 'Full Name', required: true, example: 'Jane Doe' },
    { key: 'username', label: 'Username', required: true, example: 'jdoe' },
    { key: 'email', label: 'Email', required: true, example: 'jane.doe@example.com' },
    { key: 'password', label: 'Password', required: true, hint: 'Minimum 12 characters', example: 'ChangeMe!2026xyz' },
    { key: 'phone', label: 'Phone', example: '+234 800 000 0000' },
    { key: 'department', label: 'Department', example: 'Operations' },
    { key: 'designation', label: 'Designation', example: 'Officer' },
    { key: 'status', label: 'Status', options: USER_STATUSES, defaultValue: 'Active', example: 'Active' },
  ]

  const validateImportRow = (record) => {
    if (String(record.password || '').length < 12) return 'Password must be at least 12 characters'
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(record.email || '').trim())) return 'Invalid email format'
    if (record.status && !USER_STATUSES.includes(record.status)) return `Status must be one of ${USER_STATUSES.join(', ')}`
    if (users.some((item) => item.username.toLowerCase() === String(record.username).toLowerCase())) {
      return 'Username already exists'
    }
    return null
  }

  const importConfig = {
    title: 'Import users',
    description: 'Create users from an Excel or CSV file. Existing usernames are skipped.',
    fields: importFields,
    validateRow: validateImportRow,
    onImportRow: async (record) => {
      await createUser({ ...emptyUser, ...record, status: record.status || 'Active' })
    },
    onComplete: async (summary) => {
      await reloadUsers()
      if (appReloadUsers) await appReloadUsers()
      if (summary.success > 0) setSuccess(`${summary.success} user${summary.success === 1 ? '' : 's'} imported`)
    },
  }

  return (
    <div>
      <div className="page-title">
        <div>
          <h2>User Master</h2>
          <p>Create, update, and manage application users.</p>
        </div>
        <span className="record-count">{total} Users</span>
      </div>

      <AlertMessage tone="success" message={success} onDismiss={clearSuccess} />
      <AlertMessage tone="error" message={error} onDismiss={clearError} />

      {!canCreate && !canEdit && !canDelete && (
        <div className="info-box">
          You are in view-only mode. Creating, editing and deleting users each
          need their own permission (Create User, Edit User, Delete User).
        </div>
      )}

      {canWriteUser && (
        <form onSubmit={handleSubmit}>
          <div>
            <label>Full Name</label>
            <input
              name="fullName"
              type="text"
              value={user.fullName}
              onChange={handleChange}
              placeholder="Enter full name"
              aria-invalid={fieldErrors.fullName ? 'true' : undefined}
            />
            {fieldErrors.fullName && (
              <small className="field-error">{fieldErrors.fullName}</small>
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
            aria-invalid={fieldErrors.username ? 'true' : undefined}
          />
          {fieldErrors.username && (
            <small className="field-error">{fieldErrors.username}</small>
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
            aria-invalid={fieldErrors.email ? 'true' : undefined}
          />
          {fieldErrors.email && (
            <small className="field-error">{fieldErrors.email}</small>
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
              aria-invalid={fieldErrors.password ? 'true' : undefined}
            />
          </div>
          {fieldErrors.password && (
            <small className="field-error">{fieldErrors.password}</small>
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
            <small style={{ color: 'var(--text-muted)', marginTop: 4 }}>
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
              aria-invalid={fieldErrors.confirmPassword ? 'true' : undefined}
            />
            {fieldErrors.confirmPassword && (
              <small className="field-error">{fieldErrors.confirmPassword}</small>
            )}
          </div>
        )}

        {isSelfEdit && (user.status === 'Inactive' || user.status === 'Blocked') && (
          <div className="info-box" style={{ background: 'var(--danger-soft)', borderColor: 'var(--danger-border)', color: 'var(--danger-text)', gridColumn: '1 / -1' }}>
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
          <button
            type="submit"
            disabled={loading || !(editId === null ? canCreate : canEdit)}
          >
            {loading
              ? 'Please wait…'
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
      )}

      <div className="section-title">
        <h3>Saved Users</h3>
        <p>All users are loaded from the live database. Use the filters to narrow the list.</p>
      </div>

      <DataTableToolbar
        filters={filters}
        columns={columns}
        exportFileName="users"
        exportTitle="User Master"
        module="User Master"
        importConfig={importConfig}
        canImport={canCreate}
        searchPlaceholder="Search by name, username, email, department…"
      />

      <table>
        <thead>
          <tr>
            <th>Full Name</th>
            <th>Username</th>
            <th>Email</th>
            <th>Department</th>
            <th>Designation</th>
            <th>Status</th>
            {(canEdit || canDelete) && <th>Actions</th>}
          </tr>
        </thead>

        <tbody>
          {listLoading && users.length === 0 ? (
            <tr>
              <td colSpan={canEdit || canDelete ? 7 : 6} className="empty-table">
                Loading users…
              </td>
            </tr>
          ) : filters.filteredRows.length === 0 ? (
            <tr>
              <td colSpan={canEdit || canDelete ? 7 : 6} className="empty-table">
                {users.length > 0 ? 'No users match the current filters.' : 'No users found.'}
              </td>
            </tr>
          ) : (
            visibleUsers.map((item) => (
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
                {(canEdit || canDelete) && (
                  <td>
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => handleEdit(item)}
                        disabled={loading}
                      >
                        Edit
                      </button>
                    )}

                    {canDelete && (
                      <button
                        type="button"
                        onClick={() => handleDelete(item)}
                        disabled={loading}
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

      <PaginationControls
        currentPage={page}
        totalRows={filters.filteredRows.length}
        onPageChange={setPage}
      />
    </div>
  )
}

export default UserMaster