import { useEffect, useState } from 'react'
import {
  saveUserLocations,
  updateUserAllLocationsAccess,
  deleteUserLocation,
} from '../api/userLocationApi'
import PaginationControls, { paginateRows, usePageSize } from '../components/common/PaginationControls'
import DataTableToolbar from '../components/common/DataTableToolbar'
import { useDataFilters } from '../hooks/useDataFilters'
import { useAutoColumns } from '../hooks/useAutoColumns'
import { usePermissions } from '../hooks/usePermissions'

function UserLocationAssignment({
  users,
  locations,
  userLocationSummaries,
  userLocationAssignments,
  reloadUserLocationSummaries,
  reloadUserLocationAssignments,
  loggedInUser,
}) {
  const [selectedUserId, setSelectedUserId] = useState('')
  const [selectedLocationCodes, setSelectedLocationCodes] = useState([])
  const [allLocationsAccess, setAllLocationsAccess] = useState('No')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [fieldErrors, setFieldErrors] = useState({})
  const [page, setPage] = useState(1)

  const pageSize = usePageSize()
  const activeUsers = users.filter((user) => user.status === 'Active')
  const activeLocations = locations.filter((loc) => loc.status === 'Active')

  const { hasPermission } = usePermissions(loggedInUser)
  const canView = hasPermission('View User Location Assignment')
  const canEdit = hasPermission('Edit User Location Assignment')
  const canDelete = hasPermission('Delete User Location Assignment')
  const userLocationAssignmentsFilters = useDataFilters(userLocationAssignments, useAutoColumns(userLocationAssignments), { module: 'User Location Assignment' })
  const visibleAssignments = paginateRows(userLocationAssignmentsFilters.filteredRows, page, pageSize)

  useEffect(() => {
    setPage(1)
  }, [userLocationAssignments.length])

  const clearError = () => setError('')
  const clearSuccess = () => setSuccess('')

  const validateAssignment = () => {
    const errors = {}
    if (selectedUserId === '') errors.userId = 'Please select a user'
    setFieldErrors(errors)
    return Object.keys(errors).length === 0
  }

  const handleUserChange = (userId) => {
    setSelectedUserId(userId)
    setFieldErrors({ ...fieldErrors, userId: '' })

    const existing = userLocationSummaries.find(
      (s) => String(s.userId) === userId
    )
    if (existing) {
      setSelectedLocationCodes(existing.locationCodes || [])
      setAllLocationsAccess(existing.allLocationsAccess || 'No')
    } else {
      setSelectedLocationCodes([])
      setAllLocationsAccess('No')
    }
  }

  const handleLocationToggle = (locationCode) => {
    setSelectedLocationCodes((prev) =>
      prev.includes(locationCode)
        ? prev.filter((c) => c !== locationCode)
        : [...prev, locationCode]
    )
  }

  const handleSelectAllLocations = () => {
    const allCodes = activeLocations.map((l) => l.locationCode)
    setSelectedLocationCodes(
      selectedLocationCodes.length === allCodes.length && allCodes.length > 0
        ? []
        : allCodes
    )
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    clearError()
    clearSuccess()

    if (!canEdit) {
      setError('You do not have permission to save user location assignments.')
      return
    }

    if (!validateAssignment()) return

    try {
      setLoading(true)

      await saveUserLocations(Number(selectedUserId), selectedLocationCodes)
      await updateUserAllLocationsAccess(Number(selectedUserId), allLocationsAccess)

      await Promise.all([
        reloadUserLocationSummaries(),
        reloadUserLocationAssignments(),
      ])

      setSelectedUserId('')
      setSelectedLocationCodes([])
      setAllLocationsAccess('No')
      setFieldErrors({})
      setSuccess('User location assignment saved successfully')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleEdit = (summary) => {
    clearError()
    clearSuccess()
    setConfirmDeleteId(null)
    setFieldErrors({})

    if (!canEdit) {
      setError('You do not have permission to save user location assignments.')
      return
    }

    setSelectedUserId(String(summary.userId))
    setSelectedLocationCodes(summary.locationCodes || [])
    setAllLocationsAccess(summary.allLocationsAccess || 'No')
  }

  const handleDeleteRequest = (assignmentId) => {
    clearError()
    clearSuccess()
    setConfirmDeleteId(assignmentId)
  }

  const handleDeleteConfirm = async (assignmentId) => {
    if (!canDelete) {
      setError('You do not have permission to delete user location assignments.')
      return
    }

    try {
      setLoading(true)

      await deleteUserLocation(assignmentId)
      await Promise.all([
        reloadUserLocationSummaries(),
        reloadUserLocationAssignments(),
      ])

      setConfirmDeleteId(null)
      setSuccess('User location assignment removed successfully')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  /* bulk upload */
  const importConfig = {
    title: 'Bulk upload user location assignments',
    description:
      'Upload an Excel (.xlsx) or CSV file with one row per user. The Locations column holds a comma-separated list of location codes and replaces the locations that user already has.',
    templateFileName: 'user-location-assignment-upload-template',
    fields: [
      { key: 'username', label: 'Username', required: true, example: 'jdoe', aliases: ['User', 'Login', 'User Name'] },
      {
        key: 'locations',
        label: 'Locations',
        required: false,
        example: 'LOC-001, LOC-002',
        aliases: ['Location', 'Location Codes', 'Assigned Location'],
        hint: 'Comma-separated location codes',
      },
      {
        key: 'allLocationsAccess',
        label: 'All Locations Access',
        required: false,
        example: 'No',
        options: ['Yes', 'No'],
        defaultValue: 'No',
        aliases: ['All Locations'],
      },
    ],
    validateRow: (row) => {
      const username = String(row.username ?? '').trim()
      if (username === '') return 'Username is required'
      const user = activeUsers.find(
        (item) => String(item.username ?? '').trim().toLowerCase() === username.toLowerCase()
      )
      if (!user) return `Unknown or inactive user "${username}"`

      const flag = String(row.allLocationsAccess ?? '').trim().toLowerCase()
      if (!['', 'yes', 'y', 'true', '1'].includes(flag)) {
        const codes = String(row.locations ?? '')
          .split(/[,;]/)
          .map((item) => item.trim())
          .filter(Boolean)
        if (codes.length === 0) return 'Provide at least one location, or set All Locations Access to Yes'
        const known = activeLocations.map((loc) => String(loc.locationCode ?? '').trim().toLowerCase())
        const unknown = codes.filter((code) => !known.includes(code.toLowerCase()))
        if (unknown.length > 0) return `Unknown or inactive location(s): ${unknown.join(', ')}`
      }
      return null
    },
    onImportRow: async (row) => {
      if (!canEdit) {
        throw new Error('You do not have permission to save user location assignments.')
      }
      const username = String(row.username ?? '').trim().toLowerCase()
      const user = activeUsers.find((item) => String(item.username ?? '').trim().toLowerCase() === username)

      const flag = String(row.allLocationsAccess ?? '').trim().toLowerCase()
      const allAccess = ['yes', 'y', 'true', '1'].includes(flag)

      const codes = String(row.locations ?? '')
        .split(/[,;]/)
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean)
      const locationCodes = allAccess
        ? activeLocations.map((loc) => loc.locationCode)
        : activeLocations
            .filter((loc) => codes.includes(String(loc.locationCode ?? '').trim().toLowerCase()))
            .map((loc) => loc.locationCode)

      await saveUserLocations(Number(user.id), locationCodes)
      await updateUserAllLocationsAccess(Number(user.id), allAccess ? 'Yes' : 'No')
    },
    onComplete: async () => {
      await Promise.all([reloadUserLocationSummaries(), reloadUserLocationAssignments()])
    },
  }

  // Build a lookup from userId to summary for quick access
  const summaryByUserId = {}
  userLocationSummaries.forEach((s) => {
    summaryByUserId[s.userId] = s
  })

  const handleCancelEdit = () => {
    setSelectedUserId('')
    setSelectedLocationCodes([])
    setAllLocationsAccess('No')
    setFieldErrors({})
    clearError()
    clearSuccess()
    setConfirmDeleteId(null)
  }

  if (!canView && !canEdit && !canDelete) {
    return (
      <div>
        <div className="page-title">
          <h2>User Location Assignment</h2>
          <p>Assign locations to users for location-based access control.</p>
        </div>
        <div className="info-box">
          You do not have permission to view user location assignments.
        </div>
      </div>
    )
  }

  const allLocationCodes = activeLocations.map((l) => l.locationCode)
  const allSelected =
    selectedLocationCodes.length === allLocationCodes.length &&
    allLocationCodes.length > 0

  return (
    <div>
      <div className="page-title">
        <div>
          <h2>User Location Assignment</h2>
          <p>
            Assign locations to users for location-based access control. Users
            with "All Locations Access" can access every location regardless of
            individual assignments.
          </p>
        </div>

        <span className="record-count">
          {userLocationAssignments.length} Assignments
        </span>
      </div>

      {success && (
        <div
          className="error-box"
          style={{
            background: 'var(--success-soft)',
            color: 'var(--success-text)',
            borderColor: 'var(--success-border)',
          }}
        >
          {success}
          <button className="error-close" onClick={clearSuccess} type="button">
            &times;
          </button>
        </div>
      )}

      {error && (
        <div className="error-box">
          {error}
          <button className="error-close" onClick={clearError} type="button">
            &times;
          </button>
        </div>
      )}

      {!canEdit && !canDelete && canView && (
        <div className="info-box">
          You have View User Location Assignment permission only. Edit and
          delete actions are disabled.
        </div>
      )}

      {canEdit && (
        <form onSubmit={handleSubmit}>
          <div>
            <label>Select User</label>
            <select
              value={selectedUserId}
              onChange={(e) => handleUserChange(e.target.value)}
              aria-invalid={fieldErrors.userId ? 'true' : undefined}
            >
              <option value="">Select User</option>
              {activeUsers.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.fullName} ({user.username})
                </option>
              ))}
            </select>
            {fieldErrors.userId && (
              <small className="field-error">
                {fieldErrors.userId}
              </small>
            )}
          </div>

          <div className="full-width-field">
            <label>Assigned Locations</label>
            {activeLocations.length === 0 ? (
              <div className="info-box">
                Please create at least one active location in Location Master
                before assigning locations.
              </div>
            ) : (
              <>
                <div style={{ marginBottom: 10, display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    onClick={handleSelectAllLocations}
                    style={{
                      background: 'var(--primary)',
                      color: 'var(--text-inverse)',
                      padding: '4px 10px',
                      fontSize: 12,
                    }}
                  >
                    {allSelected
                      ? 'Deselect All'
                      : `Select All (${activeLocations.length})`}
                  </button>
                  <span
                    style={{
                      fontSize: 12,
                      color: 'var(--text-muted)',
                      alignSelf: 'center',
                    }}
                  >
                    {selectedLocationCodes.length} of {activeLocations.length}{' '}
                    selected
                  </span>
                </div>

                <div className="permission-grid">
                  {activeLocations.map((loc) => (
                    <label
                      key={loc.locationCode}
                      className="permission-card"
                      style={{
                        cursor: 'pointer',
                        opacity: selectedLocationCodes.includes(
                          loc.locationCode
                        )
                          ? 1
                          : 0.75,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedLocationCodes.includes(
                          loc.locationCode
                        )}
                        onChange={() => handleLocationToggle(loc.locationCode)}
                      />
                      <div>
                        <strong>{loc.locationName}</strong>
                        <span>{loc.locationCode}</span>
                      </div>
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>

          <div>
            <label>All Locations Access</label>
            <div
              style={{
                display: 'flex',
                gap: 24,
                marginTop: 8,
              }}
            >
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  cursor: 'pointer',
                  padding: '10px 16px',
                  border: '1px solid var(--border-strong)',
                  borderRadius: 6,
                  background:
                    allLocationsAccess === 'Yes' ? '#eff6ff' : '#fff',
                  borderColor:
                    allLocationsAccess === 'Yes' ? '#2563eb' : '#d1d5db',
                  flex: 1,
                  maxWidth: 320,
                }}
              >
                <input
                  type="radio"
                  name="allLocationsAccess"
                  value="Yes"
                  checked={allLocationsAccess === 'Yes'}
                  onChange={() => setAllLocationsAccess('Yes')}
                />
                <div>
                  <strong style={{ fontSize: 14 }}>Yes</strong>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    — User can access all locations
                  </span>
                </div>
              </label>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  cursor: 'pointer',
                  padding: '10px 16px',
                  border: '1px solid var(--border-strong)',
                  borderRadius: 6,
                  background:
                    allLocationsAccess === 'No' ? '#f8fafc' : '#fff',
                  borderColor:
                    allLocationsAccess === 'No' ? '#64748b' : '#d1d5db',
                  flex: 1,
                  maxWidth: 380,
                }}
              >
                <input
                  type="radio"
                  name="allLocationsAccess"
                  value="No"
                  checked={allLocationsAccess === 'No'}
                  onChange={() => setAllLocationsAccess('No')}
                />
                <div>
                  <strong style={{ fontSize: 14 }}>No</strong>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    — User is restricted to assigned locations only
                  </span>
                </div>
              </label>
            </div>
          </div>

          <div className="form-actions">
            <button type="submit" disabled={loading}>
              {loading ? 'Please wait...' : 'Save Assignment'}
            </button>

            {selectedUserId !== '' && (
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
        <h3>Assigned Locations</h3>
        <p>
          Each row represents one user-location assignment. A user can have
          multiple locations. Use "All Locations Access" to grant universal
          access.
        </p>
      </div>

      <DataTableToolbar
        filters={userLocationAssignmentsFilters}
        columns={userLocationAssignmentsFilters.columns}
        exportFileName="user-location-assignment"
        exportTitle="User Location Assignment"
        module="user-location-assignment"
        importConfig={importConfig}
        canImport={canEdit}
      />

      <table>
        <thead>
          <tr>
            <th>User</th>
            <th>Assigned Location</th>
            <th>All Locations</th>
            {(canEdit || canDelete) && <th>Actions</th>}
          </tr>
        </thead>

        <tbody>
          {userLocationAssignments.length === 0 ? (
            <tr>
              <td colSpan={canEdit || canDelete ? 4 : 3} className="empty-table">
                No location assignments yet.
              </td>
            </tr>
          ) : (
            visibleAssignments.map((assignment) => {
              const summary = summaryByUserId[assignment.userId]
              const isFirstRowForUser =
                userLocationAssignments.findIndex(
                  (a) => a.userId === assignment.userId
                ) ===
                userLocationAssignments.indexOf(assignment)

              return (
                <tr key={assignment.id}>
                  <td>
                    {isFirstRowForUser ? (
                      <>
                        <strong>{assignment.fullName}</strong>
                        <br />
                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                          {assignment.username}
                        </span>
                      </>
                    ) : null}
                  </td>
                  <td>
                    <span className="permission-badge">
                      {assignment.locationName}
                    </span>
                  </td>
                  <td>
                    {summary &&
                    summary.allLocationsAccess === 'Yes' ? (
                      <span
                        className="permission-badge"
                        style={{
                          background: 'var(--info-soft)',
                          color: 'var(--primary)',
                        }}
                      >
                        Yes
                      </span>
                    ) : (
                      <span style={{ color: 'var(--text-faint)', fontSize: 13 }}>
                        No
                      </span>
                    )}
                  </td>

                  {(canEdit || canDelete) && (
                    <td>
                      {canEdit && isFirstRowForUser && (
                        <button
                          type="button"
                          onClick={() =>
                            handleEdit(
                              summary || {
                                userId: assignment.userId,
                                fullName: assignment.fullName,
                                username: assignment.username,
                                locationCodes: [],
                                allLocationsAccess: 'No',
                              }
                            )
                          }
                          style={{ marginRight: 6 }}
                        >
                          Edit
                        </button>
                      )}

                      {canDelete && confirmDeleteId === assignment.id ? (
                        <span>
                          <button
                            type="button"
                            onClick={() =>
                              handleDeleteConfirm(assignment.id)
                            }
                            disabled={loading}
                            style={{
                              background: 'var(--danger)',
                              color: 'var(--text-inverse)',
                              marginRight: 4,
                            }}
                          >
                            {loading ? 'Deleting...' : 'Confirm'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            disabled={loading}
                            style={{
                              background: 'var(--btn-secondary)',
                              color: 'var(--text-inverse)',
                            }}
                          >
                            Cancel
                          </button>
                        </span>
                      ) : canDelete ? (
                        <button
                          type="button"
                          onClick={() => handleDeleteRequest(assignment.id)}
                        >
                          Delete
                        </button>
                      ) : null}
                    </td>
                  )}
                </tr>
              )
            })
          )}
        </tbody>
      </table>

      <PaginationControls
        currentPage={page}
        totalRows={userLocationAssignmentsFilters.filteredRows.length}
        onPageChange={setPage}
      />
    </div>
  )
}

export default UserLocationAssignment
