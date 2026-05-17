import { useState } from 'react'
import {
  createAssetAssignment,
  deleteAssetAssignment,
  updateAssetAssignment,
} from '../api/assetAssignmentApi'

function AssetAssignment({
  assets,
  locations,
  users,
  assetAssignments,
  reloadAssetAssignments,
}) {
  const emptyAssignment = {
    assetCode: '',
    assetScope: '',
    assignmentLocationCode: '',
    assignedToType: '',
    assignedTo: '',
    assignmentDate: '',
    returnDate: '',
    remarks: '',
    status: 'Active',
  }

  const [assignment, setAssignment] = useState(emptyAssignment)
  const [editId, setEditId] = useState(null)
  const [loading, setLoading] = useState(false)

  const activeAssets = assets.filter((asset) => asset.status === 'Active')
  const activeLocations = locations.filter((location) => location.status === 'Active')
  const activeUsers = users.filter((user) => user.status === 'Active')

  const selectedAsset = assets.find(
    (asset) => asset.assetCode === assignment.assetCode
  )

  const handleAssetChange = (e) => {
    const selectedAssetCode = e.target.value
    const asset = assets.find((item) => item.assetCode === selectedAssetCode)

    if (!asset) {
      setAssignment(emptyAssignment)
      return
    }

    setAssignment({
      ...assignment,
      assetCode: asset.assetCode,
      assetScope: asset.assetScope,
      assignmentLocationCode:
        asset.assetScope === 'Local' ? asset.locationCode : '',
    })
  }

  const handleAssignedToTypeChange = (e) => {
    setAssignment({
      ...assignment,
      assignedToType: e.target.value,
      assignedTo: '',
    })
  }

  const handleChange = (e) => {
    setAssignment({
      ...assignment,
      [e.target.name]: e.target.value,
    })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()

    if (assignment.assetCode.trim() === '') {
      alert('Asset is required')
      return
    }

    if (assignment.assignmentLocationCode.trim() === '') {
      alert('Assignment Location is required')
      return
    }

    if (assignment.assignedToType.trim() === '') {
      alert('Assigned To Type is required')
      return
    }

    if (assignment.assignedTo.trim() === '') {
      alert('Assigned To is required')
      return
    }

    if (assignment.assignmentDate.trim() === '') {
      alert('Assignment Date is required')
      return
    }

    try {
      setLoading(true)

      if (editId === null) {
        await createAssetAssignment(assignment)
        alert('Asset Assignment saved successfully')
      } else {
        await updateAssetAssignment(editId, assignment)
        alert('Asset Assignment updated successfully')
      }

      await reloadAssetAssignments()
      setAssignment(emptyAssignment)
      setEditId(null)
    } catch (error) {
      alert(error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleEdit = (assignmentToEdit) => {
    setAssignment({
      assetCode: assignmentToEdit.assetCode,
      assetScope: assignmentToEdit.assetScope,
      assignmentLocationCode: assignmentToEdit.assignmentLocationCode,
      assignedToType: assignmentToEdit.assignedToType,
      assignedTo: assignmentToEdit.assignedTo,
      assignmentDate: assignmentToEdit.assignmentDate,
      returnDate: assignmentToEdit.returnDate,
      remarks: assignmentToEdit.remarks,
      status: assignmentToEdit.status,
    })

    setEditId(assignmentToEdit.id)
  }

  const handleDelete = async (assignmentId) => {
    const confirmDelete = window.confirm(
      'Are you sure you want to delete this asset assignment record?'
    )

    if (confirmDelete === false) {
      return
    }

    try {
      setLoading(true)

      await deleteAssetAssignment(assignmentId)
      await reloadAssetAssignments()

      if (editId === assignmentId) {
        setAssignment(emptyAssignment)
        setEditId(null)
      }

      alert('Asset Assignment deleted successfully')
    } catch (error) {
      alert(error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleCancelEdit = () => {
    setAssignment(emptyAssignment)
    setEditId(null)
  }

  const activeAssignments = assetAssignments.filter(
    (item) => item.status === 'Active'
  )

  return (
    <div>
      <div className="page-title">
        <div>
          <h2>Asset Assignment</h2>
          <p>
            Assign assets to users, departments, vendors, or operational
            locations.
          </p>
        </div>

        <span className="record-count">
          {assetAssignments.length} Assignment Records
        </span>
      </div>

      {activeAssets.length === 0 && (
        <div className="info-box">
          Please create at least one active asset before creating assignments.
        </div>
      )}

      {activeLocations.length === 0 && (
        <div className="info-box">
          Please create at least one active location before creating assignments.
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div>
          <label>Asset</label>
          <select
            name="assetCode"
            value={assignment.assetCode}
            onChange={handleAssetChange}
          >
            <option value="">Select Asset</option>

            {activeAssets.map((asset) => (
              <option key={asset.id} value={asset.assetCode}>
                {asset.assetName} ({asset.assetCode}) - {asset.assetScope}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label>Asset Scope</label>
          <input
            type="text"
            value={assignment.assetScope}
            placeholder="Auto-filled from selected asset"
            disabled
          />
        </div>

        <div>
          <label>
            Assignment Location{' '}
            {selectedAsset?.assetScope === 'Local'
              ? '(Fixed for Local Asset)'
              : ''}
          </label>
          <select
            name="assignmentLocationCode"
            value={assignment.assignmentLocationCode}
            onChange={handleChange}
            disabled={selectedAsset?.assetScope === 'Local'}
          >
            <option value="">Select Location</option>

            {activeLocations.map((location) => (
              <option key={location.id} value={location.locationCode}>
                {location.locationName} ({location.locationCode})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label>Assigned To Type</label>
          <select
            name="assignedToType"
            value={assignment.assignedToType}
            onChange={handleAssignedToTypeChange}
          >
            <option value="">Select Assigned To Type</option>
            <option>User</option>
            <option>Department</option>
            <option>Location</option>
            <option>Vendor</option>
            <option>Other</option>
          </select>
        </div>

        <div>
          <label>Assigned To</label>

          {assignment.assignedToType === 'User' ? (
            <select
              name="assignedTo"
              value={assignment.assignedTo}
              onChange={handleChange}
            >
              <option value="">Select User</option>

              {activeUsers.map((user) => (
                <option key={user.id} value={user.username}>
                  {user.fullName} ({user.username})
                </option>
              ))}
            </select>
          ) : assignment.assignedToType === 'Location' ? (
            <select
              name="assignedTo"
              value={assignment.assignedTo}
              onChange={handleChange}
            >
              <option value="">Select Location</option>

              {activeLocations.map((location) => (
                <option key={location.id} value={location.locationCode}>
                  {location.locationName} ({location.locationCode})
                </option>
              ))}
            </select>
          ) : (
            <input
              name="assignedTo"
              type="text"
              value={assignment.assignedTo}
              onChange={handleChange}
              placeholder="Example: Operations Department / Vendor Name"
              disabled={assignment.assignedToType === ''}
            />
          )}
        </div>

        <div>
          <label>Assignment Date</label>
          <input
            name="assignmentDate"
            type="date"
            value={assignment.assignmentDate}
            onChange={handleChange}
          />
        </div>

        <div>
          <label>Return Date</label>
          <input
            name="returnDate"
            type="date"
            value={assignment.returnDate}
            onChange={handleChange}
          />
        </div>

        <div>
          <label>Status</label>
          <select name="status" value={assignment.status} onChange={handleChange}>
            <option>Active</option>
            <option>Returned</option>
            <option>Inactive</option>
            <option>Blocked</option>
          </select>
        </div>

        <div className="full-width-field">
          <label>Remarks</label>
          <textarea
            name="remarks"
            value={assignment.remarks}
            onChange={handleChange}
            placeholder="Enter assignment remarks"
            rows="3"
          />
        </div>

        <div className="form-actions">
          <button type="submit" disabled={loading}>
            {loading
              ? 'Please wait...'
              : editId === null
                ? 'Save Assignment'
                : 'Update Assignment'}
          </button>

          {editId !== null && (
            <button type="button" onClick={handleCancelEdit} disabled={loading}>
              Cancel Edit
            </button>
          )}
        </div>
      </form>

      <div className="section-title">
        <h3>Current Active Assignments</h3>
        <p>
          Local assets can appear only once here. Global assets can appear in
          multiple locations.
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
          {activeAssignments.length === 0 ? (
            <tr>
              <td colSpan="7" className="empty-table">
                No active assignments found.
              </td>
            </tr>
          ) : (
            activeAssignments.map((item) => (
              <tr key={item.id}>
                <td>
                  {item.assetName} ({item.assetCode})
                </td>
                <td>
                  <span
                    className={
                      item.assetScope === 'Global'
                        ? 'scope-badge global'
                        : 'scope-badge local'
                    }
                  >
                    {item.assetScope}
                  </span>
                </td>
                <td>
                  {item.assignmentLocationName} ({item.assignmentLocationCode})
                </td>
                <td>{item.assignedToType}</td>
                <td>{item.assignedToDisplay}</td>
                <td>{item.assignmentDate}</td>
                <td>
                  <span className={`status-badge ${item.status.toLowerCase()}`}>
                    {item.status}
                  </span>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <div className="section-title">
        <h3>Assignment History</h3>
        <p>All assignment records are shown here for audit and tracking.</p>
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
            <th>Return Date</th>
            <th>Remarks</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>

        <tbody>
          {assetAssignments.length === 0 ? (
            <tr>
              <td colSpan="10" className="empty-table">
                No asset assignment history yet.
              </td>
            </tr>
          ) : (
            assetAssignments.map((item) => (
              <tr key={item.id}>
                <td>
                  {item.assetName} ({item.assetCode})
                </td>
                <td>
                  <span
                    className={
                      item.assetScope === 'Global'
                        ? 'scope-badge global'
                        : 'scope-badge local'
                    }
                  >
                    {item.assetScope}
                  </span>
                </td>
                <td>
                  {item.assignmentLocationName} ({item.assignmentLocationCode})
                </td>
                <td>{item.assignedToType}</td>
                <td>{item.assignedToDisplay}</td>
                <td>{item.assignmentDate}</td>
                <td>{item.returnDate}</td>
                <td>{item.remarks}</td>
                <td>
                  <span className={`status-badge ${item.status.toLowerCase()}`}>
                    {item.status}
                  </span>
                </td>
                <td>
                  <button type="button" onClick={() => handleEdit(item)}>
                    Edit
                  </button>

                  <button type="button" onClick={() => handleDelete(item.id)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <div className="info-box">
        Rule: Local assets can have only one active assignment. Global assets can
        have multiple active assignments, but not duplicate active assignments at
        the same location.
      </div>
    </div>
  )
}

export default AssetAssignment