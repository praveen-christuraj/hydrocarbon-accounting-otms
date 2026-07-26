import { useState } from 'react'
import {
  getUserLocationSummaries,
  saveUserLocations,
  updateUserAllLocationsAccess,
  deleteUserLocation,
} from '../api/userLocationApi'

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

  const activeUsers = users.filter((user) => user.status === 'Active')
  const activeLocations = locations.filter((loc) => loc.status === 'Active')

  const isAdminBootstrap =
    String(loggedInUser?.username || '').toLowerCase() === 'admin'

  const hasPermission = (permissionName) => {
    if (isAdminBootstrap) return true
    if (!loggedInUser || !Array.isArray(loggedInUser.permissions)) return false
    return loggedInUser.permissions.some(
      (p) => p.permissionName === permissionName
    )
  }

  const canManage = hasPermission('Manage User Location Assignment')
  const canView = hasPermission('View User Location Assignment')

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

    if (!canManage) {
      setError('You do not have permission to manage user location assignments.')
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

    if (!canManage) {
      setError('You do not have permission to manage user location assignments.')
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
    if (!canManage) {
      setError('You do not have permission to manage user location assignments.')
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

  if (!canView && !canManage) {
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
            background: '#f0fdf4',
            color: '#166534',
            borderColor: '#bbf7d0',
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

      {!canManage && canView && (
        <div className="info-box">
          You have View User Location Assignment permission only. Create, edit,
          and delete actions are disabled.
        </div>
      )}

      {canManage && (
        <form onSubmit={handleSubmit}>
          <div>
            <label>Select User</label>
            <select
              value={selectedUserId}
              onChange={(e) => handleUserChange(e.target.value)}
              style={fieldErrors.userId ? { borderColor: '#dc2626' } : {}}
            >
              <option value="">Select User</option>
              {activeUsers.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.fullName} ({user.username})
                </option>
              ))}
            </select>
            {fieldErrors.userId && (
              <small style={{ color: '#dc2626', marginTop: 4 }}>
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
                      background: '#2563eb',
                      color: '#fff',
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
                      color: '#64748b',
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
                  border: '1px solid #d1d5db',
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
                  <span style={{ fontSize: 12, color: '#64748b' }}>
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
                  border: '1px solid #d1d5db',
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
                  <span style={{ fontSize: 12, color: '#64748b' }}>
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

      <table>
        <thead>
          <tr>
            <th>User</th>
            <th>Assigned Location</th>
            <th>All Locations</th>
            {canManage && <th>Actions</th>}
          </tr>
        </thead>

        <tbody>
          {userLocationAssignments.length === 0 ? (
            <tr>
              <td colSpan={canManage ? 4 : 3} className="empty-table">
                No location assignments yet.
              </td>
            </tr>
          ) : (
            userLocationAssignments.map((assignment) => {
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
                        <span style={{ fontSize: 12, color: '#64748b' }}>
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
                          background: '#dbeafe',
                          color: '#1e40af',
                        }}
                      >
                        Yes
                      </span>
                    ) : (
                      <span style={{ color: '#9ca3af', fontSize: 13 }}>
                        No
                      </span>
                    )}
                  </td>

                  {canManage && (
                    <td>
                      {isFirstRowForUser && (
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

                      {confirmDeleteId === assignment.id ? (
                        <span>
                          <button
                            type="button"
                            onClick={() =>
                              handleDeleteConfirm(assignment.id)
                            }
                            disabled={loading}
                            style={{
                              background: '#dc2626',
                              color: '#fff',
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
                              background: '#64748b',
                              color: '#fff',
                            }}
                          >
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleDeleteRequest(assignment.id)}
                        >
                          Delete
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              )
            })
          )}
        </tbody>
      </table>
    </div>
  )
}

export default UserLocationAssignment
