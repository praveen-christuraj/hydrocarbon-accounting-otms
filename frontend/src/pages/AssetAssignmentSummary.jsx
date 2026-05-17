function AssetAssignmentSummary({
  assets,
  assetTypes,
  locations,
  users,
  assetAssignments,
}) {
  const getAssetTypeName = (assetTypeCode) => {
    const assetType = assetTypes.find(
      (item) => item.assetTypeCode === assetTypeCode
    )

    if (!assetType) {
      return ''
    }

    return assetType.assetTypeName
  }

  const getLocationName = (locationCode) => {
    const location = locations.find((item) => item.locationCode === locationCode)

    if (!location) {
      return ''
    }

    return location.locationName
  }

  const getActiveAssignmentsForAsset = (assetCode) => {
    return assetAssignments.filter((assignment) => {
      return assignment.assetCode === assetCode && assignment.status === 'Active'
    })
  }

  const getAssignmentLocationDisplay = (assignment) => {
    if (assignment.assignmentLocationName) {
      return `${assignment.assignmentLocationName} (${assignment.assignmentLocationCode})`
    }

    const locationName = getLocationName(assignment.assignmentLocationCode)

    if (locationName) {
      return `${locationName} (${assignment.assignmentLocationCode})`
    }

    return assignment.assignmentLocationCode
  }

  const getAssignedToDisplay = (assignment) => {
    if (assignment.assignedToDisplay) {
      return assignment.assignedToDisplay
    }

    if (assignment.assignedToType === 'User') {
      const user = users.find((item) => item.username === assignment.assignedTo)

      if (user) {
        return `${user.fullName} (${user.username})`
      }
    }

    if (assignment.assignedToType === 'Location') {
      const location = locations.find(
        (item) => item.locationCode === assignment.assignedTo
      )

      if (location) {
        return `${location.locationName} (${location.locationCode})`
      }
    }

    return assignment.assignedTo
  }

  const activeAssignedAssets = assets.filter((asset) => {
    return getActiveAssignmentsForAsset(asset.assetCode).length > 0
  })

  const unassignedAssets = assets.filter((asset) => {
    return getActiveAssignmentsForAsset(asset.assetCode).length === 0
  })

  const localAssets = assets.filter((asset) => asset.assetScope === 'Local')
  const globalAssets = assets.filter((asset) => asset.assetScope === 'Global')

  return (
    <div>
      <div className="page-title">
        <div>
          <h2>Asset Assignment Summary</h2>
          <p>
            View current asset deployment and responsibility across all
            locations.
          </p>
        </div>

        <span className="record-count">{assets.length} Assets</span>
      </div>

      <div className="dashboard-grid">
        <div className="dashboard-card">
          <h3>Total Assets</h3>
          <p>{assets.length}</p>
        </div>

        <div className="dashboard-card">
          <h3>Assigned Assets</h3>
          <p>{activeAssignedAssets.length}</p>
        </div>

        <div className="dashboard-card">
          <h3>Unassigned Assets</h3>
          <p>{unassignedAssets.length}</p>
        </div>

        <div className="dashboard-card">
          <h3>Local Assets</h3>
          <p>{localAssets.length}</p>
        </div>

        <div className="dashboard-card">
          <h3>Global Assets</h3>
          <p>{globalAssets.length}</p>
        </div>

        <div className="dashboard-card">
          <h3>Active Assignments</h3>
          <p>
            {
              assetAssignments.filter(
                (assignment) => assignment.status === 'Active'
              ).length
            }
          </p>
        </div>
      </div>

      <div className="section-title">
        <h3>Current Asset Assignment Overview</h3>
        <p>
          Local assets normally show one active assignment. Global assets may
          show multiple active location assignments.
        </p>
      </div>

      <table>
        <thead>
          <tr>
            <th>Asset Name</th>
            <th>Asset Code</th>
            <th>Scope</th>
            <th>Asset Type</th>
            <th>Primary Location</th>
            <th>Current Assignment Location(s)</th>
            <th>Assigned To</th>
            <th>Status</th>
          </tr>
        </thead>

        <tbody>
          {assets.length === 0 ? (
            <tr>
              <td colSpan="8" className="empty-table">
                No assets found. Please create assets first.
              </td>
            </tr>
          ) : (
            assets.map((asset) => {
              const activeAssignments = getActiveAssignmentsForAsset(
                asset.assetCode
              )

              return (
                <tr key={asset.id || asset.assetCode}>
                  <td>{asset.assetName}</td>
                  <td>{asset.assetCode}</td>
                  <td>
                    <span
                      className={
                        asset.assetScope === 'Global'
                          ? 'scope-badge global'
                          : 'scope-badge local'
                      }
                    >
                      {asset.assetScope}
                    </span>
                  </td>
                  <td>
                    {getAssetTypeName(asset.assetTypeCode)} ({asset.assetTypeCode})
                  </td>
                  <td>
                    {asset.assetScope === 'Global'
                      ? 'Global / Multiple Locations'
                      : `${getLocationName(asset.locationCode)} (${
                          asset.locationCode
                        })`}
                  </td>
                  <td>
                    {activeAssignments.length === 0 ? (
                      <span className="warning-text">No active assignment</span>
                    ) : (
                      <div className="assignment-summary-list">
                        {activeAssignments.map((assignment) => (
                          <span
                            key={assignment.id}
                            className="assignment-location-badge"
                          >
                            {getAssignmentLocationDisplay(assignment)}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td>
                    {activeAssignments.length === 0 ? (
                      <span className="warning-text">Not assigned</span>
                    ) : (
                      <div className="assignment-summary-list">
                        {activeAssignments.map((assignment) => (
                          <span key={assignment.id} className="permission-badge">
                            {assignment.assignedToType}:{' '}
                            {getAssignedToDisplay(assignment)}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td>
                    {activeAssignments.length === 0 ? (
                      <span className="status-badge inactive">Unassigned</span>
                    ) : (
                      <span className="status-badge active">Assigned</span>
                    )}
                  </td>
                </tr>
              )
            })
          )}
        </tbody>
      </table>

      <div className="section-title">
        <h3>Active Assignment Details</h3>
        <p>
          This section shows each active assignment as a separate row. Global
          assets may appear more than once.
        </p>
      </div>

      <table>
        <thead>
          <tr>
            <th>Asset</th>
            <th>Scope</th>
            <th>Assignment Location</th>
            <th>Assigned To Type</th>
            <th>Assigned To</th>
            <th>Assignment Date</th>
            <th>Status</th>
          </tr>
        </thead>

        <tbody>
          {assetAssignments.filter((item) => item.status === 'Active').length ===
          0 ? (
            <tr>
              <td colSpan="7" className="empty-table">
                No active assignments found.
              </td>
            </tr>
          ) : (
            assetAssignments
              .filter((item) => item.status === 'Active')
              .map((assignment) => (
                <tr key={assignment.id}>
                  <td>
                    {assignment.assetName} ({assignment.assetCode})
                  </td>
                  <td>
                    <span
                      className={
                        assignment.assetScope === 'Global'
                          ? 'scope-badge global'
                          : 'scope-badge local'
                      }
                    >
                      {assignment.assetScope}
                    </span>
                  </td>
                  <td>{getAssignmentLocationDisplay(assignment)}</td>
                  <td>{assignment.assignedToType}</td>
                  <td>{getAssignedToDisplay(assignment)}</td>
                  <td>{assignment.assignmentDate}</td>
                  <td>
                    <span
                      className={`status-badge ${assignment.status.toLowerCase()}`}
                    >
                      {assignment.status}
                    </span>
                  </td>
                </tr>
              ))
          )}
        </tbody>
      </table>

      <div className="section-title">
        <h3>Unassigned Assets</h3>
        <p>
          These assets currently have no active assignment and may need follow-up.
        </p>
      </div>

      <table>
        <thead>
          <tr>
            <th>Asset Name</th>
            <th>Asset Code</th>
            <th>Scope</th>
            <th>Asset Type</th>
            <th>Primary Location</th>
            <th>Status</th>
          </tr>
        </thead>

        <tbody>
          {unassignedAssets.length === 0 ? (
            <tr>
              <td colSpan="6" className="empty-table">
                No unassigned assets. All assets have active assignments.
              </td>
            </tr>
          ) : (
            unassignedAssets.map((asset) => (
              <tr key={asset.id || asset.assetCode}>
                <td>{asset.assetName}</td>
                <td>{asset.assetCode}</td>
                <td>
                  <span
                    className={
                      asset.assetScope === 'Global'
                        ? 'scope-badge global'
                        : 'scope-badge local'
                    }
                  >
                    {asset.assetScope}
                  </span>
                </td>
                <td>
                  {getAssetTypeName(asset.assetTypeCode)} ({asset.assetTypeCode})
                </td>
                <td>
                  {asset.assetScope === 'Global'
                    ? 'Global / Multiple Locations'
                    : `${getLocationName(asset.locationCode)} (${
                        asset.locationCode
                      })`}
                </td>
                <td>
                  <span className="status-badge inactive">Unassigned</span>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <div className="info-box">
        This summary is read-only. To create, return, or update assignments, use
        Asset Assignment.
      </div>
    </div>
  )
}

export default AssetAssignmentSummary