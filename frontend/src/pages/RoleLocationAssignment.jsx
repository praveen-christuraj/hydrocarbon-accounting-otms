import { useEffect, useMemo, useState } from 'react'
import {
  getRoleLocationSummaries,
  saveRoleLocations,
} from '../api/roleLocationApi'
import { getRoles } from '../api/roleApi'
import { getLocations } from '../api/locationApi'
import PaginationControls, { paginateRows, usePageSize } from '../components/common/PaginationControls'
import DataTableToolbar from '../components/common/DataTableToolbar'
import PageHeader from '../components/common/PageHeader'
import AlertMessage from '../components/common/AlertMessage'
import { useDataFilters } from '../hooks/useDataFilters'
import { useAutoColumns } from '../hooks/useAutoColumns'
import { usePermissions } from '../hooks/usePermissions'
import useActionFeedback from '../hooks/useActionFeedback'
import { logUiAction } from '../utils/actionLogger'

const MODULE = 'Role Location Assignment'

/**
 * Per-role location scope (PERMISSION_CRITERIA_MODEL.md section 7.2).
 *
 * Assigning locations to a role is an admin shortcut for large teams: every user
 * holding the role gets the role's locations **in addition to** their own
 * user-level assignments (additive union - a role can never remove a location
 * the user was given directly).
 */
function RoleLocationAssignment({ loggedInUser }) {
  const [roles, setRoles] = useState([])
  const [locations, setLocations] = useState([])
  const [summaries, setSummaries] = useState([])
  const [selectedRoleId, setSelectedRoleId] = useState('')
  const [selectedLocationCodes, setSelectedLocationCodes] = useState([])
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [listLoading, setListLoading] = useState(true)

  const feedback = useActionFeedback()
  const { successMsg, errorMsg, notifySuccess, notifyError, clearSuccess, clearError } = feedback

  const pageSize = usePageSize()
  const { hasPermission } = usePermissions(loggedInUser)
  const canView = hasPermission('View Role Location Assignment')
  const canEdit = hasPermission('Edit Role Location Assignment')

  const activeRoles = useMemo(
    () => roles.filter((role) => String(role.status || 'Active') === 'Active'),
    [roles]
  )
  const activeLocations = useMemo(
    () => locations.filter((loc) => loc.status === 'Active'),
    [locations]
  )

  const assignmentRows = useMemo(() => {
    return (summaries || []).map((summary) => ({
      ...summary,
      locationList: (summary.locationCodes || []).join(', '),
      locationCount: (summary.locationCodes || []).length,
    }))
  }, [summaries])

  const assignmentFilters = useDataFilters(
    assignmentRows,
    useAutoColumns(assignmentRows),
    { module: MODULE }
  )
  const visibleAssignments = paginateRows(assignmentFilters.filteredRows, page, pageSize)

  const loadSummaries = async () => {
    try {
      setListLoading(true)
      const data = await getRoleLocationSummaries()
      setSummaries(data)
    } catch (error) {
      notifyError(error.message)
    } finally {
      setListLoading(false)
    }
  }

  // First load: the assignments are fetched straight into state. No state is
  // set before the first await so the effect never triggers a cascading render
  // (react-hooks/set-state-in-effect).
  useEffect(() => {
    let cancelled = false

    ;(async () => {
      try {
        const data = await getRoleLocationSummaries()
        if (!cancelled) setSummaries(data)
      } catch (error) {
        if (!cancelled) notifyError(error.message)
      } finally {
        if (!cancelled) setListLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    let cancelled = false

    ;(async () => {
      try {
        const [rolesResponse, locationsResponse] = await Promise.all([
          getRoles({ limit: 200 }),
          getLocations({ limit: 200 }),
        ])
        if (cancelled) return
        setRoles(rolesResponse.items || [])
        setLocations(locationsResponse.items || [])
      } catch (error) {
        if (!cancelled) notifyError(error.message)
      }
    })()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleRoleChange = (roleId) => {
    clearError()
    clearSuccess()
    setSelectedRoleId(roleId)

    const existing = summaries.find((summary) => String(summary.roleId) === String(roleId))
    setSelectedLocationCodes(existing?.locationCodes || [])
  }

  const handleLocationToggle = (locationCode) => {
    setSelectedLocationCodes((previous) =>
      previous.includes(locationCode)
        ? previous.filter((code) => code !== locationCode)
        : [...previous, locationCode]
    )
  }

  const handleSelectAll = () => {
    const allCodes = activeLocations.map((loc) => loc.locationCode)
    const allSelected =
      allCodes.length > 0 && selectedLocationCodes.length === allCodes.length
    setSelectedLocationCodes(allSelected ? [] : allCodes)
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    clearError()
    clearSuccess()

    if (!canEdit) {
      notifyError('You do not have permission to edit role location scopes.')
      return
    }

    if (selectedRoleId === '') {
      notifyError('Please select a role.')
      return
    }

    const role = activeRoles.find((item) => String(item.id) === String(selectedRoleId))

    try {
      setLoading(true)
      await saveRoleLocations(Number(selectedRoleId), selectedLocationCodes)
      await loadSummaries()
      setSelectedRoleId('')
      setSelectedLocationCodes([])
      logUiAction(MODULE, 'Save Role Locations', {
        roleId: Number(selectedRoleId),
        roleName: role?.roleName || '',
        locationCount: selectedLocationCodes.length,
      })
      notifySuccess('Role location scope saved successfully.')
    } catch (error) {
      notifyError(error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleEdit = (summary) => {
    clearError()
    clearSuccess()
    setSelectedRoleId(String(summary.roleId))
    setSelectedLocationCodes(summary.locationCodes || [])
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleClear = () => {
    setSelectedRoleId('')
    setSelectedLocationCodes([])
    clearError()
    clearSuccess()
  }

  if (!canView && !canEdit) {
    return (
      <div>
        <PageHeader
          title="Role Location Assignment"
          description="Assign locations to roles for location-based access control."
        />
        <div className="info-box">
          You do not have permission to view role location assignments.
        </div>
      </div>
    )
  }

  const allCodes = activeLocations.map((loc) => loc.locationCode)
  const allSelected =
    allCodes.length > 0 && selectedLocationCodes.length === allCodes.length
  const selectedRole = summaries.find(
    (summary) => String(summary.roleId) === String(selectedRoleId)
  )

  return (
    <div>
      <PageHeader
        title="Role Location Assignment"
        description="Give every user of a role the same locations in one place. The scope is additive: a role adds locations to a user, and the user's own User Location Assignment rows still apply."
        count={`${assignmentRows.length} Roles`}
      />

      <AlertMessage tone="success" message={successMsg} onDismiss={clearSuccess} />
      <AlertMessage tone="error" message={errorMsg} onDismiss={clearError} />

      <div className="info-box">
        Location scope is the <strong>union</strong> of a user's own assigned
        locations (<strong>User Location Assignment</strong>) and the locations
        of every active role they hold. Removing a role's locations never removes
        a location that was assigned directly to the user.
      </div>

      {!canEdit && (
        <div className="info-box">
          You have View Role Location Assignment permission only. Edit actions
          are disabled.
        </div>
      )}

      {canEdit && (
        <form onSubmit={handleSubmit}>
          <div>
            <label>Select Role</label>
            <select
              value={selectedRoleId}
              onChange={(event) => handleRoleChange(event.target.value)}
            >
              <option value="">Select Role</option>
              {activeRoles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.roleName}
                </option>
              ))}
            </select>
            {activeRoles.length === 0 && (
              <small className="field-error">
                No active role is available. Create one in Role Master first.
              </small>
            )}
          </div>

          <div className="full-width-field">
            <label>Role Locations</label>

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
                    onClick={handleSelectAll}
                    style={{
                      background: 'var(--primary)',
                      color: 'var(--text-inverse)',
                      padding: '4px 10px',
                      fontSize: 12,
                    }}
                  >
                    {allSelected ? 'Deselect All' : `Select All (${activeLocations.length})`}
                  </button>
                  <span
                    style={{
                      fontSize: 12,
                      color: 'var(--text-muted)',
                      alignSelf: 'center',
                    }}
                  >
                    {selectedLocationCodes.length} of {activeLocations.length} selected
                  </span>
                </div>

                <div className="permission-grid">
                  {activeLocations.map((loc) => (
                    <label
                      key={loc.locationCode}
                      className="permission-card"
                      style={{
                        cursor: 'pointer',
                        opacity: selectedLocationCodes.includes(loc.locationCode) ? 1 : 0.75,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedLocationCodes.includes(loc.locationCode)}
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

          {selectedRole && (selectedRole.locationCodes || []).length > 0 && (
            <div className="info-box">
              This role currently grants: <strong>{selectedRole.locationCodes.join(', ')}</strong>.
              Saving replaces that list.
            </div>
          )}

          <div className="form-actions">
            <button type="submit" disabled={loading || selectedRoleId === ''}>
              {loading ? 'Please wait...' : 'Save Role Locations'}
            </button>

            {selectedRoleId !== '' && (
              <button type="button" onClick={handleClear} disabled={loading}>
                Clear
              </button>
            )}
          </div>
        </form>
      )}

      <div className="section-title">
        <h3>Role Location Scopes</h3>
        <p>
          One row per role with the locations it grants to its users. Location
          codes are matched case-insensitively.
        </p>
      </div>

      <DataTableToolbar
        filters={assignmentFilters}
        columns={assignmentFilters.columns}
        exportFileName="role-location-assignment"
        exportTitle="Role Location Assignment"
        module="role-location-assignment"
      />

      <table>
        <thead>
          <tr>
            <th>Role</th>
            <th>Status</th>
            <th>Locations</th>
            <th>Count</th>
            {canEdit && <th>Actions</th>}
          </tr>
        </thead>

        <tbody>
          {listLoading ? (
            <tr>
              <td colSpan={canEdit ? 5 : 4} className="empty-table">
                Loading role location scopes...
              </td>
            </tr>
          ) : assignmentFilters.filteredRows.length === 0 ? (
            <tr>
              <td colSpan={canEdit ? 5 : 4} className="empty-table">
                No role location scope has been configured yet.
              </td>
            </tr>
          ) : (
            visibleAssignments.map((row) => (
              <tr key={row.roleId}>
                <td>
                  <strong>{row.roleName}</strong>
                </td>
                <td>
                  <span className={`status-badge ${String(row.status || '').toLowerCase()}`}>
                    {row.status}
                  </span>
                </td>
                <td>
                  {(row.locationCodes || []).length === 0 ? (
                    <span style={{ color: 'var(--text-faint)', fontSize: 13 }}>
                      No role locations (users keep their own assignments)
                    </span>
                  ) : (
                    <span className="permission-badge">{row.locationList}</span>
                  )}
                </td>
                <td>{row.locationCount}</td>
                {canEdit && (
                  <td>
                    <button type="button" onClick={() => handleEdit(row)}>
                      Edit
                    </button>
                  </td>
                )}
              </tr>
            ))
          )}
        </tbody>
      </table>

      <PaginationControls
        currentPage={page}
        totalRows={assignmentFilters.filteredRows.length}
        onPageChange={setPage}
      />
    </div>
  )
}

export default RoleLocationAssignment
