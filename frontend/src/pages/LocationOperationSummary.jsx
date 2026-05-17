function LocationOperationSummary({
  locations,
  assets,
  assetAssignments,
  operationTypes,
}) {
  const activeLocations = locations.filter(
    (location) => location.status === 'Active'
  )

  const activeAssignments = assetAssignments.filter(
    (assignment) => assignment.status === 'Active'
  )

  const activeOperationTypes = operationTypes.filter(
    (operationType) => operationType.status === 'Active'
  )

  const getAssetsForLocation = (locationCode) => {
    const assignedAssetCodes = activeAssignments
      .filter((assignment) => {
        return assignment.assignmentLocationCode === locationCode
      })
      .map((assignment) => assignment.assetCode)

    const uniqueAssignedAssetCodes = [...new Set(assignedAssetCodes)]

    return uniqueAssignedAssetCodes
      .map((assetCode) => {
        return assets.find((asset) => asset.assetCode === assetCode)
      })
      .filter(Boolean)
  }

  const getAssetTypesForLocation = (locationCode) => {
    const locationAssets = getAssetsForLocation(locationCode)

    const assetTypeCodes = locationAssets.map((asset) => asset.assetTypeCode)

    return [...new Set(assetTypeCodes)]
  }

  const getOperationsForLocation = (locationCode) => {
    const assetTypeCodes = getAssetTypesForLocation(locationCode)

    return activeOperationTypes.filter((operationType) => {
      return assetTypeCodes.includes(operationType.applicableAssetTypeCode)
    })
  }

  const getLocationsWithOperations = () => {
    return activeLocations.map((location) => {
      const locationAssets = getAssetsForLocation(location.locationCode)
      const assetTypeCodes = getAssetTypesForLocation(location.locationCode)
      const availableOperations = getOperationsForLocation(location.locationCode)

      return {
        location,
        locationAssets,
        assetTypeCodes,
        availableOperations,
      }
    })
  }

  const summaryRows = getLocationsWithOperations()

  const totalAvailableOperations = summaryRows.reduce((total, row) => {
    return total + row.availableOperations.length
  }, 0)

  const locationsWithOperations = summaryRows.filter((row) => {
    return row.availableOperations.length > 0
  })

  const locationsWithoutOperations = summaryRows.filter((row) => {
    return row.availableOperations.length === 0
  })

  return (
    <div>
      <div className="page-title">
        <div>
          <h2>Location Operation Availability Summary</h2>
          <p>
            View which operations are available at each location based on active
            asset assignments.
          </p>
        </div>

        <span className="record-count">
          {locationsWithOperations.length} Locations Ready
        </span>
      </div>

      <div className="dashboard-grid">
        <div className="dashboard-card">
          <h3>Active Locations</h3>
          <p>{activeLocations.length}</p>
        </div>

        <div className="dashboard-card">
          <h3>Active Assignments</h3>
          <p>{activeAssignments.length}</p>
        </div>

        <div className="dashboard-card">
          <h3>Active Operation Types</h3>
          <p>{activeOperationTypes.length}</p>
        </div>

        <div className="dashboard-card">
          <h3>Locations With Operations</h3>
          <p>{locationsWithOperations.length}</p>
        </div>

        <div className="dashboard-card">
          <h3>Locations Without Operations</h3>
          <p>{locationsWithoutOperations.length}</p>
        </div>

        <div className="dashboard-card">
          <h3>Total Available Operations</h3>
          <p>{totalAvailableOperations}</p>
        </div>
      </div>

      <div className="section-title">
        <h3>Location Wise Operation Availability</h3>
        <p>
          A location receives operation access when an active asset is assigned
          to it and that asset type has active operation types configured.
        </p>
      </div>

      <table>
        <thead>
          <tr>
            <th>Location</th>
            <th>Assigned Assets</th>
            <th>Asset Types Present</th>
            <th>Available Operations</th>
            <th>Status</th>
          </tr>
        </thead>

        <tbody>
          {summaryRows.length === 0 ? (
            <tr>
              <td colSpan="5" className="empty-table">
                No active locations found.
              </td>
            </tr>
          ) : (
            summaryRows.map((row) => (
              <tr key={row.location.id || row.location.locationCode}>
                <td>
                  {row.location.locationName} ({row.location.locationCode})
                </td>

                <td>
                  {row.locationAssets.length === 0 ? (
                    <span className="warning-text">
                      No active assigned assets
                    </span>
                  ) : (
                    <div className="permission-list">
                      {row.locationAssets.map((asset) => (
                        <span
                          key={asset.id || asset.assetCode}
                          className="permission-badge"
                        >
                          {asset.assetName} ({asset.assetCode})
                        </span>
                      ))}
                    </div>
                  )}
                </td>

                <td>
                  {row.assetTypeCodes.length === 0 ? (
                    <span className="warning-text">No asset type</span>
                  ) : (
                    <div className="permission-list">
                      {row.assetTypeCodes.map((assetTypeCode) => (
                        <span key={assetTypeCode} className="scope-badge local">
                          {assetTypeCode}
                        </span>
                      ))}
                    </div>
                  )}
                </td>

                <td>
                  {row.availableOperations.length === 0 ? (
                    <span className="warning-text">
                      No operation available
                    </span>
                  ) : (
                    <div className="permission-list">
                      {row.availableOperations.map((operationType) => (
                        <span
                          key={operationType.id}
                          className="permission-badge"
                        >
                          {operationType.operationTypeName}
                        </span>
                      ))}
                    </div>
                  )}
                </td>

                <td>
                  {row.availableOperations.length === 0 ? (
                    <span className="status-badge inactive">Not Ready</span>
                  ) : (
                    <span className="status-badge active">Ready</span>
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <div className="section-title">
        <h3>Detailed Available Operations</h3>
        <p>
          This shows operation behavior such as sender, receiver, comparison,
          and approval requirements.
        </p>
      </div>

      <table>
        <thead>
          <tr>
            <th>Location</th>
            <th>Operation Type</th>
            <th>Asset Type</th>
            <th>Category</th>
            <th>Sender</th>
            <th>Receiver</th>
            <th>Comparison</th>
            <th>Approval</th>
          </tr>
        </thead>

        <tbody>
          {summaryRows.every((row) => row.availableOperations.length === 0) ? (
            <tr>
              <td colSpan="8" className="empty-table">
                No location has available operations yet.
              </td>
            </tr>
          ) : (
            summaryRows.flatMap((row) => {
              return row.availableOperations.map((operationType) => (
                <tr
                  key={`${row.location.locationCode}-${operationType.operationTypeCode}`}
                >
                  <td>
                    {row.location.locationName} ({row.location.locationCode})
                  </td>
                  <td>{operationType.operationTypeName}</td>
                  <td>{operationType.applicableAssetTypeCode}</td>
                  <td>{operationType.operationCategory}</td>
                  <td>{operationType.requiresSenderLocation}</td>
                  <td>{operationType.requiresReceiverLocation}</td>
                  <td>{operationType.requiresComparison}</td>
                  <td>{operationType.requiresApproval}</td>
                </tr>
              ))
            })
          )}
        </tbody>
      </table>

      <div className="section-title">
        <h3>Locations Without Available Operations</h3>
        <p>
          These locations either have no active assigned assets or their assigned
          asset types do not have active operation types.
        </p>
      </div>

      <table>
        <thead>
          <tr>
            <th>Location</th>
            <th>Reason</th>
          </tr>
        </thead>

        <tbody>
          {locationsWithoutOperations.length === 0 ? (
            <tr>
              <td colSpan="2" className="empty-table">
                All active locations have available operations.
              </td>
            </tr>
          ) : (
            locationsWithoutOperations.map((row) => (
              <tr key={row.location.id || row.location.locationCode}>
                <td>
                  {row.location.locationName} ({row.location.locationCode})
                </td>
                <td>
                  {row.locationAssets.length === 0
                    ? 'No active asset assignment found for this location'
                    : 'Assigned asset type has no active operation type configured'}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <div className="info-box">
        Rule: available operations are derived from active asset assignments and
        Operation Type Master. Example: if a location has an active Tank asset
        and TANK has Tank Operations configured, then Tank Operations becomes
        available for that location.
      </div>
    </div>
  )
}

export default LocationOperationSummary