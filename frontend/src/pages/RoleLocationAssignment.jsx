import { useEffect, useId, useMemo, useState } from 'react'
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
import LocationScopeSelector from '../components/common/LocationScopeSelector'
import { useDataFilters } from '../hooks/useDataFilters'
import { useAutoColumns } from '../hooks/useAutoColumns'
import { usePermissions } from '../hooks/usePermissions'
import useActionFeedback from '../hooks/useActionFeedback'
import { logUiAction } from '../utils/actionLogger'

const MODULE = 'Role Location Assignment'
const MAX_VISIBLE_CODES = 6

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
  const currentScopeLabelId = useId()
  const locationsLabelId = useId()
  const panelTitleId = useId()

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

  const selectedRole = summaries.find(
    (summary) => String(summary.roleId) === String(selectedRoleId)
  )
  const currentScopeCodes = selectedRole?.locationCodes || []
  const visibleScopeCodes = currentScopeCodes.slice(0, MAX_VISIBLE_CODES)
  const hiddenScopeCodes = currentScopeCodes.length - visibleScopeCodes.length

  return (
    <div>
      <PageHeader
        title="Role Location Assignment"
        description="Give every user of a role the same locations in one place. The scope is additive: a role adds locations to a user, and the user's own User Location Assignment rows still apply."
        count={`${assignmentRows.length} Roles`}
      />

      <AlertMessage tone="success" message={successMsg} onDismiss={clearSuccess} />
      <AlertMessage tone="error" message={errorMsg} onDismiss={clearError} />

      <AlertMessage tone="info">
        Location scope is the <strong>union</strong> of a user&apos;s own assigned
        locations (<strong>User Location Assignment</strong>) and the locations of
        every active role they hold. Removing a role&apos;s locations never removes
        a location that was assigned directly to the user.
      </AlertMessage>

      {!canEdit && (
        <AlertMessage
          tone="info"
          message="You have View Role Location Assignment permission only. Edit actions are disabled."
        />
      )}

      {canEdit && (
        <section className="assignment-panel" aria-labelledby={panelTitleId}>
          <header className="assignment-panel-head">
            <div>
              <h3 id={panelTitleId}>Assign Locations to a Role</h3>
              <p>
                Pick the role, then tick every location its users may work in.
                Saving replaces the locations the role currently grants.
              </p>
            </div>
            {selectedRoleId !== '' && (
              <div className="assignment-panel-meta">
                <span className="record-count">{selectedLocationCodes.length} Selected</span>
              </div>
            )}
          </header>

          <div className="assignment-panel-body">
            <form onSubmit={handleSubmit}>
              <div>
                <label htmlFor="role-location-role">Role</label>
                <select
                  id="role-location-role"
                  value={selectedRoleId}
                  onChange={(event) => handleRoleChange(event.target.value)}
                  aria-invalid={activeRoles.length === 0 ? 'true' : undefined}
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

              <div>
                <span className="field-label" id={currentScopeLabelId}>
                  Current Scope
                </span>
                <div className="assignment-readout" aria-labelledby={currentScopeLabelId}>
                  {selectedRoleId === '' ? (
                    <span>Select a role to review the locations it grants today.</span>
                  ) : currentScopeCodes.length === 0 ? (
                    <span>This role grants no location yet — its users keep their own assignments.</span>
                  ) : (
                    <>
                      <span className="code-chip-list">
                        {visibleScopeCodes.map((code) => (
                          <span className="code-chip" key={code}>
                            {code}
                          </span>
                        ))}
                        {hiddenScopeCodes > 0 && (
                          <span
                            className="code-chip is-more"
                            title={currentScopeCodes.join(', ')}
                          >
                            +{hiddenScopeCodes} more
                          </span>
                        )}
                      </span>
                      <span className="assignment-readout-note">
                        Saving replaces this list.
                      </span>
                    </>
                  )}
                </div>
              </div>

              <div className="full-width-field" role="group" aria-labelledby={locationsLabelId}>
                <span className="field-label" id={locationsLabelId}>
                  Role Locations
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
                    selectedRoleId === ''
                      ? 'Select a role to load its current scope.'
                      : 'Saving replaces the locations granted by this role.'
                  }
                />
              </div>

              <div className="form-actions">
                <button type="submit" className="btn-primary" disabled={loading || selectedRoleId === ''}>
                  {loading ? 'Saving…' : 'Save Role Locations'}
                </button>

                {(selectedRoleId !== '' || selectedLocationCodes.length > 0) && (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={handleClear}
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
            <th className="num">Count</th>
            {canEdit && <th className="row-actions">Actions</th>}
          </tr>
        </thead>

        <tbody>
          {listLoading ? (
            <tr>
              <td colSpan={canEdit ? 5 : 4} className="empty-table">
                Loading role location scopes…
              </td>
            </tr>
          ) : assignmentFilters.filteredRows.length === 0 ? (
            <tr>
              <td colSpan={canEdit ? 5 : 4} className="empty-table">
                No role location scope has been configured yet.
              </td>
            </tr>
          ) : (
            visibleAssignments.map((row) => {
              const codes = row.locationCodes || []
              const visibleCodes = codes.slice(0, MAX_VISIBLE_CODES)
              const hiddenCodes = codes.length - visibleCodes.length

              return (
                <tr key={row.roleId}>
                  <td className="cell-strong">{row.roleName}</td>
                  <td>
                    <span className={`status-badge ${String(row.status || '').toLowerCase()}`}>
                      {row.status}
                    </span>
                  </td>
                  <td>
                    {codes.length === 0 ? (
                      <span
                        className="cell-muted"
                        title="Users keep their own User Location Assignment rows"
                      >
                        No role scope — users keep their own assignments
                      </span>
                    ) : (
                      <span className="code-chip-list">
                        {visibleCodes.map((code) => (
                          <span className="code-chip" key={code}>
                            {code}
                          </span>
                        ))}
                        {hiddenCodes > 0 && (
                          <span className="code-chip is-more" title={codes.join(', ')}>
                            +{hiddenCodes} more
                          </span>
                        )}
                      </span>
                    )}
                  </td>
                  <td className="num">{row.locationCount}</td>
                  {canEdit && (
                    <td className="row-actions">
                      <button
                        type="button"
                        className="btn-secondary btn-sm"
                        onClick={() => handleEdit(row)}
                      >
                        Edit
                      </button>
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
        totalRows={assignmentFilters.filteredRows.length}
        onPageChange={setPage}
      />
    </div>
  )
}

export default RoleLocationAssignment
