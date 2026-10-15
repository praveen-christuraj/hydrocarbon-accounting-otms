import { useMemo, useState } from 'react'
import PaginationControls, { paginateRows, usePageSize } from '../components/common/PaginationControls'
import DataTableToolbar from '../components/common/DataTableToolbar'
import { useDataFilters } from '../hooks/useDataFilters'

/*
 * Read-only deployment overview.
 *
 * Owner rules 4 / 5 / 6: every list on the page is paginated (20 / 50 / 100),
 * carries the easy + advanced filter bar and can be exported to XLSX, CSV or
 * PDF. There is no bulk upload here – the page has no create API; assignments
 * are maintained on the Asset Assignment page.
 */
function AssetAssignmentSummary({ assets, assetTypes, locations, users, assetAssignments }) {
  const getAssetTypeName = (assetTypeCode) => {
    const assetType = assetTypes.find((item) => item.assetTypeCode === assetTypeCode)

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
      const location = locations.find((item) => item.locationCode === assignment.assignedTo)

      if (location) {
        return `${location.locationName} (${location.locationCode})`
      }
    }

    return assignment.assignedTo
  }

  const getPrimaryLocationDisplay = (asset) => {
    if (asset.assetScope === 'Global') return 'Global / Multiple Locations'
    const name = getLocationName(asset.locationCode)
    return name ? `${name} (${asset.locationCode})` : asset.locationCode
  }

  /* ---------------------------------------------------------- row models */

  const overviewRows = useMemo(
    () =>
      assets.map((asset) => {
        const activeAssignments = getActiveAssignmentsForAsset(asset.assetCode)
        return {
          id: asset.id || asset.assetCode,
          assetName: asset.assetName,
          assetCode: asset.assetCode,
          assetScope: asset.assetScope,
          assetType: getAssetTypeName(asset.assetTypeCode)
            ? `${getAssetTypeName(asset.assetTypeCode)} (${asset.assetTypeCode})`
            : asset.assetTypeCode,
          primaryLocation: getPrimaryLocationDisplay(asset),
          assignmentLocations: activeAssignments.length
            ? activeAssignments.map((item) => getAssignmentLocationDisplay(item)).join('; ')
            : 'No active assignment',
          assignedTo: activeAssignments.length
            ? activeAssignments
                .map((item) => `${item.assignedToType}: ${getAssignedToDisplay(item)}`)
                .join('; ')
            : 'Not assigned',
          status: activeAssignments.length ? 'Assigned' : 'Unassigned',
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [assets, assetAssignments, assetTypes, locations, users]
  )

  const overviewColumns = [
    { key: 'assetName', label: 'Asset Name' },
    { key: 'assetCode', label: 'Asset Code' },
    { key: 'assetScope', label: 'Scope', type: 'select' },
    { key: 'assetType', label: 'Asset Type' },
    { key: 'primaryLocation', label: 'Primary Location' },
    { key: 'assignmentLocations', label: 'Current Assignment Location(s)' },
    { key: 'assignedTo', label: 'Assigned To' },
    { key: 'status', label: 'Status', type: 'select' },
  ]

  const detailRows = useMemo(
    () =>
      assetAssignments
        .filter((item) => item.status === 'Active')
        .map((assignment) => ({
          id: assignment.id,
          asset: `${assignment.assetName} (${assignment.assetCode})`,
          assetScope: assignment.assetScope,
          assignmentLocation: getAssignmentLocationDisplay(assignment),
          assignedToType: assignment.assignedToType,
          assignedTo: getAssignedToDisplay(assignment),
          assignmentDate: assignment.assignmentDate,
          status: assignment.status,
        })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [assetAssignments, locations, users]
  )

  const detailColumns = [
    { key: 'asset', label: 'Asset' },
    { key: 'assetScope', label: 'Scope', type: 'select' },
    { key: 'assignmentLocation', label: 'Assignment Location' },
    { key: 'assignedToType', label: 'Assigned To Type', type: 'select' },
    { key: 'assignedTo', label: 'Assigned To' },
    { key: 'assignmentDate', label: 'Assignment Date', type: 'date' },
    { key: 'status', label: 'Status', type: 'select' },
  ]

  const unassignedRows = useMemo(
    () =>
      assets
        .filter((asset) => getActiveAssignmentsForAsset(asset.assetCode).length === 0)
        .map((asset) => ({
          id: asset.id || asset.assetCode,
          assetName: asset.assetName,
          assetCode: asset.assetCode,
          assetScope: asset.assetScope,
          assetType: getAssetTypeName(asset.assetTypeCode)
            ? `${getAssetTypeName(asset.assetTypeCode)} (${asset.assetTypeCode})`
            : asset.assetTypeCode,
          primaryLocation: getPrimaryLocationDisplay(asset),
          status: 'Unassigned',
        })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [assets, assetAssignments, assetTypes, locations]
  )

  const unassignedColumns = [
    { key: 'assetName', label: 'Asset Name' },
    { key: 'assetCode', label: 'Asset Code' },
    { key: 'assetScope', label: 'Scope', type: 'select' },
    { key: 'assetType', label: 'Asset Type' },
    { key: 'primaryLocation', label: 'Primary Location' },
    { key: 'status', label: 'Status', type: 'select' },
  ]

  const pageSize = usePageSize()
  const [overviewPage, setOverviewPage] = useState(1)
  const [detailPage, setDetailPage] = useState(1)
  const [unassignedPage, setUnassignedPage] = useState(1)

  const overviewFilters = useDataFilters(overviewRows, overviewColumns, {
    module: 'Asset Assignment Summary',
  })
  const detailFilters = useDataFilters(detailRows, detailColumns, {
    module: 'Asset Assignment Summary',
  })
  const unassignedFilters = useDataFilters(unassignedRows, unassignedColumns, {
    module: 'Asset Assignment Summary',
  })

  const visibleOverview = paginateRows(overviewFilters.filteredRows, overviewPage, pageSize)
  const visibleDetails = paginateRows(detailFilters.filteredRows, detailPage, pageSize)
  const visibleUnassigned = paginateRows(unassignedFilters.filteredRows, unassignedPage, pageSize)

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

      <DataTableToolbar
        filters={overviewFilters}
        columns={overviewColumns}
        exportFileName="asset-assignment-summary-overview"
        exportTitle="Asset Assignment Overview"
        module="Asset Assignment Summary"
      />

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
          {overviewRows.length === 0 ? (
            <tr>
              <td colSpan="8" className="empty-table">
                No assets found. Please create assets first.
              </td>
            </tr>
          ) : visibleOverview.length === 0 ? (
            <tr>
              <td colSpan="8" className="empty-table">
                No assets match the current filters.
              </td>
            </tr>
          ) : (
            visibleOverview.map((row) => (
              <tr key={row.id}>
                <td>{row.assetName}</td>
                <td>{row.assetCode}</td>
                <td>
                  <span
                    className={
                      row.assetScope === 'Global' ? 'scope-badge global' : 'scope-badge local'
                    }
                  >
                    {row.assetScope}
                  </span>
                </td>
                <td>{row.assetType}</td>
                <td>{row.primaryLocation}</td>
                <td>{row.assignmentLocations}</td>
                <td>{row.assignedTo}</td>
                <td>
                  <span
                    className={`status-badge ${
                      row.status === 'Assigned' ? 'active' : 'inactive'
                    }`}
                  >
                    {row.status}
                  </span>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <PaginationControls
        currentPage={overviewPage}
        totalRows={overviewFilters.filteredRows.length}
        onPageChange={setOverviewPage}
      />

      <div className="section-title">
        <h3>Active Assignment Details</h3>
        <p>
          This section shows each active assignment as a separate row. Global
          assets may appear more than once.
        </p>
      </div>

      <DataTableToolbar
        filters={detailFilters}
        columns={detailColumns}
        exportFileName="asset-assignment-summary-details"
        exportTitle="Active Assignment Details"
        module="Asset Assignment Summary"
      />

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
          {detailRows.length === 0 ? (
            <tr>
              <td colSpan="7" className="empty-table">
                No active assignments found.
              </td>
            </tr>
          ) : (
            visibleDetails.map((row) => (
              <tr key={row.id}>
                <td>{row.asset}</td>
                <td>
                  <span
                    className={
                      row.assetScope === 'Global' ? 'scope-badge global' : 'scope-badge local'
                    }
                  >
                    {row.assetScope}
                  </span>
                </td>
                <td>{row.assignmentLocation}</td>
                <td>{row.assignedToType}</td>
                <td>{row.assignedTo}</td>
                <td>{row.assignmentDate}</td>
                <td>
                  <span className={`status-badge ${String(row.status).toLowerCase()}`}>
                    {row.status}
                  </span>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <PaginationControls
        currentPage={detailPage}
        totalRows={detailFilters.filteredRows.length}
        onPageChange={setDetailPage}
      />

      <div className="section-title">
        <h3>Unassigned Assets</h3>
        <p>
          These assets currently have no active assignment and may need follow-up.
        </p>
      </div>

      <DataTableToolbar
        filters={unassignedFilters}
        columns={unassignedColumns}
        exportFileName="asset-assignment-summary-unassigned"
        exportTitle="Unassigned Assets"
        module="Asset Assignment Summary"
      />

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
          {unassignedRows.length === 0 ? (
            <tr>
              <td colSpan="6" className="empty-table">
                No unassigned assets. All assets have active assignments.
              </td>
            </tr>
          ) : (
            visibleUnassigned.map((row) => (
              <tr key={row.id}>
                <td>{row.assetName}</td>
                <td>{row.assetCode}</td>
                <td>
                  <span
                    className={
                      row.assetScope === 'Global' ? 'scope-badge global' : 'scope-badge local'
                    }
                  >
                    {row.assetScope}
                  </span>
                </td>
                <td>{row.assetType}</td>
                <td>{row.primaryLocation}</td>
                <td>
                  <span className="status-badge inactive">Unassigned</span>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <PaginationControls
        currentPage={unassignedPage}
        totalRows={unassignedFilters.filteredRows.length}
        onPageChange={setUnassignedPage}
      />

      <div className="info-box">
        This summary is read-only. To create, return, or update assignments, use
        Asset Assignment.
      </div>
    </div>
  )
}

export default AssetAssignmentSummary
