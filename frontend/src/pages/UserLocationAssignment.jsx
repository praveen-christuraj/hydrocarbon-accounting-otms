import { useId, useState } from 'react'
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
import AlertMessage from '../components/common/AlertMessage'
import PageHeader from '../components/common/PageHeader'
import LocationScopeSelector from '../components/common/LocationScopeSelector'
import { useConfirm } from '../components/common/ConfirmProvider'
import useActionFeedback from '../hooks/useActionFeedback'
import { logUiAction } from '../utils/actionLogger'

const MODULE = 'User Location Assignment'

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
  // Action feedback: little pop-up (toast) + inline message near the action
  // area (owner rule 8). Aliased to the page's existing variable names.
  const feedback = useActionFeedback()
  const {
    successMsg: success,
    errorMsg: error,
    notifySuccess: setSuccess,
    notifyError: setError,
    clearSuccess,
    clearError,
  } = feedback
  const [fieldErrors, setFieldErrors] = useState({})
  const [page, setPage] = useState(1)

  const pageSize = usePageSize()
  const confirm = useConfirm()
  const allAccessLabelId = useId()
  const locationsLabelId = useId()
  const panelTitleId = useId()

  const activeUsers = users.filter((user) => user.status === 'Active')
  const activeLocations = locations.filter((loc) => loc.status === 'Active')

  const { hasPermission } = usePermissions(loggedInUser)
  const canView = hasPermission('View User Location Assignment')
  const canEdit = hasPermission('Edit User Location Assignment')
  const canDelete = hasPermission('Delete User Location Assignment')
  const userLocationAssignmentsFilters = useDataFilters(userLocationAssignments, useAutoColumns(userLocationAssignments), { module: MODULE })
  const visibleAssignments = paginateRows(userLocationAssignmentsFilters.filteredRows, page, pageSize)

  // One user owns several location rows: the User and All Locations columns are
  // merged across the user's contiguous rows (rowSpan) so the table reads as a
  // one-to-many assignment list without repeating the user on every line.
  // A group continuing from the previous page simply repeats its header cell.
  const groupSpans = visibleAssignments.map((assignment, index) => {
    const sameUser = (a, b) => String(a?.userId) === String(b?.userId)
    if (index > 0 && sameUser(visibleAssignments[index - 1], assignment)) return 0
    let span = 1
    while (index + span < visibleAssignments.length && sameUser(visibleAssignments[index + span], assignment)) {
      span += 1
    }
    return span
  })

  // The page number is clamped by paginateRows()/PaginationControls, so a
  // shorter list (after a delete or a filter change) never leaves the table on
  // an empty page.

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

  // "Select all" in the scope panel: add or remove the codes it currently shows
  // (the whole list, or only the rows that match the filter).
  const handleSelectLocations = (codes, checked) => {
    setSelectedLocationCodes((previous) => {
      if (checked) {
        const next = new Set(previous)
        codes.forEach((code) => next.add(code))
        return [...next]
      }
      const removing = new Set(codes)
      return previous.filter((code) => !removing.has(code))
    })
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

    const selectedUser = activeUsers.find((user) => String(user.id) === selectedUserId)

    try {
      setLoading(true)

      await saveUserLocations(Number(selectedUserId), selectedLocationCodes)
      await updateUserAllLocationsAccess(Number(selectedUserId), allLocationsAccess)

      await Promise.all([
        reloadUserLocationSummaries(),
        reloadUserLocationAssignments(),
      ])

      logUiAction(MODULE, 'Save User Locations', {
        userId: Number(selectedUserId),
        username: selectedUser?.username || '',
        locationCount: selectedLocationCodes.length,
        allLocationsAccess,
      })

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
    setFieldErrors({})

    if (!canEdit) {
      setError('You do not have permission to save user location assignments.')
      return
    }

    setSelectedUserId(String(summary.userId))
    setSelectedLocationCodes(summary.locationCodes || [])
    setAllLocationsAccess(summary.allLocationsAccess || 'No')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleDelete = async (assignment) => {
    clearError()
    clearSuccess()

    if (!canDelete) {
      setError('You do not have permission to delete user location assignments.')
      return
    }

    const confirmed = await confirm({
      title: 'Remove location assignment',
      message: `Remove "${assignment.locationName}" from ${assignment.fullName}?`,
      details:
        'The user loses access to this location immediately, unless a role they hold still grants it. This action is recorded in the audit log.',
      tone: 'danger',
      confirmLabel: 'Remove assignment',
      module: MODULE,
    })
    if (!confirmed) return

    try {
      setLoading(true)

      await deleteUserLocation(assignment.id)
      await Promise.all([
        reloadUserLocationSummaries(),
        reloadUserLocationAssignments(),
      ])

      logUiAction(MODULE, 'Remove User Location', {
        userId: assignment.userId,
        username: assignment.username,
        locationCode: assignment.locationCode,
      })

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

  const actionsVisible = canEdit || canDelete

  return (
    <div>
      <PageHeader
        title="User Location Assignment"
        description="Assign locations to users for location-based access control. Users with All Locations Access can access every location regardless of individual assignments."
        count={`${userLocationAssignments.length} Assignments`}
      />

      <AlertMessage tone="success" message={success} onDismiss={clearSuccess} />
      <AlertMessage tone="error" message={error} onDismiss={clearError} />

      {!canEdit && !canDelete && canView && (
        <AlertMessage
          tone="info"
          message="You have View User Location Assignment permission only. Edit and delete actions are disabled."
        />
      )}

      {canEdit && (
        <section className="assignment-panel" aria-labelledby={panelTitleId}>
          <header className="assignment-panel-head">
            <div>
              <h3 id={panelTitleId}>Assign Locations to a User</h3>
              <p>
                Pick the user, then tick every location they may work in. Saving
                replaces the locations that user currently has.
              </p>
            </div>
            {selectedUserId !== '' && (
              <div className="assignment-panel-meta">
                <span className="record-count">{selectedLocationCodes.length} Selected</span>
              </div>
            )}
          </header>

          <div className="assignment-panel-body">
            <form onSubmit={handleSubmit}>
              <div>
                <label htmlFor="user-location-user">User</label>
                <select
                  id="user-location-user"
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

              <div>
                <span className="field-label" id={allAccessLabelId}>
                  All Locations Access
                </span>
                <div className="choice-row" role="radiogroup" aria-labelledby={allAccessLabelId}>
                  <label className={`choice-option ${allLocationsAccess === 'Yes' ? 'is-selected' : ''}`.trim()}>
                    <input
                      type="radio"
                      name="allLocationsAccess"
                      value="Yes"
                      checked={allLocationsAccess === 'Yes'}
                      onChange={() => setAllLocationsAccess('Yes')}
                    />
                    <span className="choice-option-text">
                      <strong>Yes</strong>
                      <span>Every active location, including ones created later</span>
                    </span>
                  </label>
                  <label className={`choice-option ${allLocationsAccess === 'No' ? 'is-selected' : ''}`.trim()}>
                    <input
                      type="radio"
                      name="allLocationsAccess"
                      value="No"
                      checked={allLocationsAccess === 'No'}
                      onChange={() => setAllLocationsAccess('No')}
                    />
                    <span className="choice-option-text">
                      <strong>No</strong>
                      <span>Only the locations ticked below</span>
                    </span>
                  </label>
                </div>
              </div>

              <div className="full-width-field" role="group" aria-labelledby={locationsLabelId}>
                <span className="field-label" id={locationsLabelId}>
                  Assigned Locations
                </span>
                <LocationScopeSelector
                  locations={activeLocations}
                  selectedCodes={selectedLocationCodes}
                  onToggle={handleLocationToggle}
                  onSelectCodes={handleSelectLocations}
                  onClear={() => setSelectedLocationCodes([])}
                  disabled={loading}
                  emptyMessage="Please create at least one active location in Location Master before assigning locations."
                  footnote={
                    selectedUserId === ''
                      ? 'Select a user to load their current scope.'
                      : 'Saving replaces the locations listed above.'
                  }
                />
              </div>

              <div className="form-actions">
                <button type="submit" className="btn-primary" disabled={loading}>
                  {loading ? 'Saving…' : 'Save Assignment'}
                </button>

                {(selectedUserId !== '' || selectedLocationCodes.length > 0) && (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={handleCancelEdit}
                    disabled={loading}
                  >
                    Clear
                  </button>
                )}
              </div>
            </form>
          </div>
        </section>
      )}

      <div className="section-title">
        <h3>Assigned Locations</h3>
        <p>
          One row per user and assigned location. A user with multiple locations
          is listed once, with each location on its own row. Use &quot;All
          Locations Access&quot; to grant universal access.
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
            <th>All Locations</th>
            <th>Assigned Location</th>
            {actionsVisible && <th className="row-actions">Actions</th>}
          </tr>
        </thead>

        <tbody>
          {userLocationAssignments.length === 0 ? (
            <tr>
              <td colSpan={actionsVisible ? 4 : 3} className="empty-table">
                No location assignments yet.
              </td>
            </tr>
          ) : (
            visibleAssignments.map((assignment, index) => {
              const summary = summaryByUserId[assignment.userId]
              const span = groupSpans[index]
              const hasAllLocationsAccess = summary?.allLocationsAccess === 'Yes'

              return (
                <tr key={assignment.id}>
                  {span > 0 && (
                    <td rowSpan={span} className="assignment-group-cell">
                      <span className="assignment-group-name">{assignment.fullName}</span>
                      <span className="assignment-group-sub">{assignment.username}</span>
                    </td>
                  )}

                  {span > 0 && (
                    <td rowSpan={span} className="assignment-group-cell">
                      {hasAllLocationsAccess ? (
                        <span
                          className="status-badge approved"
                          title="This user can access every active location"
                        >
                          Yes
                        </span>
                      ) : (
                        <span
                          className="assignment-group-sub"
                          title="This user is restricted to the locations listed in the next column"
                        >
                          No
                        </span>
                      )}
                    </td>
                  )}

                  <td>
                    <span className="permission-badge">{assignment.locationName}</span>{' '}
                    <span className="cell-code">{assignment.locationCode}</span>
                  </td>

                  {actionsVisible && (
                    <td className="row-actions">
                      {canEdit && span > 0 && (
                        <button
                          type="button"
                          className="btn-secondary btn-sm"
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
                          disabled={loading}
                        >
                          Edit
                        </button>
                      )}

                      {canDelete && (
                        <button
                          type="button"
                          className="btn-danger btn-sm"
                          onClick={() => handleDelete(assignment)}
                          disabled={loading}
                          title={`Remove ${assignment.locationName} from ${assignment.fullName}`}
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

      <PaginationControls
        currentPage={page}
        totalRows={userLocationAssignmentsFilters.filteredRows.length}
        onPageChange={setPage}
      />
    </div>
  )
}

export default UserLocationAssignment
