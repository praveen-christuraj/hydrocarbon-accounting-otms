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
  loggedInUser,
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
  const [successMsg, setSuccessMsg] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [validationErrors, setValidationErrors] = useState({})
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)

  const isAdminBootstrap =
    String(loggedInUser?.username || '').toLowerCase() === 'admin'
  const hasPermission = (permissionName) => {
    if (isAdminBootstrap) return true
    if (!loggedInUser || !Array.isArray(loggedInUser.permissions)) return false
    return loggedInUser.permissions.some(
      (p) => p.permissionName === permissionName
    )
  }
  const canManageAssetAssignment = hasPermission('Manage Asset Assignment')

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
    setValidationErrors({ ...validationErrors, [e.target.name]: '' })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()

    if (!canManageAssetAssignment) {
      setErrorMsg('You do not have permission to manage asset assignments.')
      return
    }

    setSuccessMsg('')
    setErrorMsg('')
    setValidationErrors({})

    const errors = {}

    if (assignment.assetCode.trim() === '') {
      errors.assetCode = 'Asset is required'
    }

    if (assignment.assignmentLocationCode.trim() === '') {
      errors.assignmentLocationCode = 'Assignment Location is required'
    }

    if (assignment.assignedToType.trim() === '') {
      errors.assignedToType = 'Assigned To Type is required'
    }

    if (assignment.assignedTo.trim() === '') {
      errors.assignedTo = 'Assigned To is required'
    }

    if (assignment.assignmentDate.trim() === '') {
      errors.assignmentDate = 'Assignment Date is required'
    }

    setValidationErrors(errors)

    if (Object.keys(errors).length > 0) {
      return
    }

    try {
      setLoading(true)

      if (editId === null) {
        await createAssetAssignment(assignment)
        setSuccessMsg('Asset Assignment saved successfully')
      } else {
        await updateAssetAssignment(editId, assignment)
        setSuccessMsg('Asset Assignment updated successfully')
      }

      await reloadAssetAssignments()
      setAssignment(emptyAssignment)
      setEditId(null)
    } catch (error) {
      setErrorMsg(error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleEdit = (assignmentToEdit) => {
    if (!canManageAssetAssignment) {
      setErrorMsg('You do not have permission to manage asset assignments.')
      return
    }

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

  const handleDelete = async () => {
    if (!canManageAssetAssignment) {
      setErrorMsg('You do not have permission to manage asset assignments.')
      return
    }

    setSuccessMsg('')
    setErrorMsg('')

    try {
      setLoading(true)

      await deleteAssetAssignment(confirmDeleteId)
      await reloadAssetAssignments()

      if (editId === confirmDeleteId) {
        setAssignment(emptyAssignment)
        setEditId(null)
      }

      setConfirmDeleteId(null)
      setSuccessMsg('Asset Assignment deleted successfully')
    } catch (error) {
      setErrorMsg(error.message)
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

      {successMsg && (
        <div className="success-box">{successMsg}</div>
      )}

      {errorMsg && (
        <div className="error-box">{errorMsg}</div>
      )}

      {confirmDeleteId && (
        <div className="confirm-overlay">
          <div className="confirm-box">
            <p>Are you sure you want to delete this asset assignment record?</p>
            <div className="confirm-actions">
              <button onClick={handleDelete} disabled={loading}>
                {loading ? 'Deleting...' : 'Yes, Delete'}
              </button>
              <button onClick={() => setConfirmDeleteId(null)} disabled={loading}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {!canManageAssetAssignment && (
        <div className="info-box">
          You are in view-only mode. Contact an administrator to create or edit
          asset assignments.
        </div>
      )}

      {canManageAssetAssignment && (
      <form onSubmit={handleSubmit}>
        <div>
          <label>Asset</label>
          <select
            name="assetCode"
            value={assignment.assetCode}
            onChange={(e) => { handleAssetChange(e); setValidationErrors({ ...validationErrors, assetCode: '' }) }}
            className={validationErrors.assetCode ? 'input-error' : ''}
          >
            <option value="">Select Asset</option>

            {activeAssets.map((asset) => (
              <option key={asset.id} value={asset.assetCode}>
                {asset.assetName} ({asset.assetCode}) - {asset.assetScope}
              </option>
            ))}
          </select>
          {validationErrors.assetCode && (
            <span className="field-error">{validationErrors.assetCode}</span>
          )}
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
            onChange={(e) => { handleChange(e); setValidationErrors({ ...validationErrors, assignmentLocationCode: '' }) }}
            disabled={selectedAsset?.assetScope === 'Local'}
            className={validationErrors.assignmentLocationCode ? 'input-error' : ''}
          >
            <option value="">Select Location</option>

            {activeLocations.map((location) => (
              <option key={location.id} value={location.locationCode}>
                {location.locationName} ({location.locationCode})
              </option>
            ))}
          </select>
          {validationErrors.assignmentLocationCode && (
            <span className="field-error">{validationErrors.assignmentLocationCode}</span>
          )}
        </div>

        <div>
          <label>Assigned To Type</label>
          <select
            name="assignedToType"
            value={assignment.assignedToType}
            onChange={(e) => { handleAssignedToTypeChange(e); setValidationErrors({ ...validationErrors, assignedToType: '' }) }}
            className={validationErrors.assignedToType ? 'input-error' : ''}
          >
            <option value="">Select Assigned To Type</option>
            <option>User</option>
            <option>Department</option>
            <option>Location</option>
            <option>Vendor</option>
            <option>Other</option>
          </select>
          {validationErrors.assignedToType && (
            <span className="field-error">{validationErrors.assignedToType}</span>
          )}
        </div>

        <div>
          <label>Assigned To</label>

          {assignment.assignedToType === 'User' ? (
            <select
              name="assignedTo"
              value={assignment.assignedTo}
              onChange={(e) => { handleChange(e); setValidationErrors({ ...validationErrors, assignedTo: '' }) }}
              className={validationErrors.assignedTo ? 'input-error' : ''}
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
              onChange={(e) => { handleChange(e); setValidationErrors({ ...validationErrors, assignedTo: '' }) }}
              className={validationErrors.assignedTo ? 'input-error' : ''}
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
              onChange={(e) => { handleChange(e); setValidationErrors({ ...validationErrors, assignedTo: '' }) }}
              placeholder="Example: Operations Department / Vendor Name"
              disabled={assignment.assignedToType === ''}
              className={validationErrors.assignedTo ? 'input-error' : ''}
            />
          )}
          {validationErrors.assignedTo && (
            <span className="field-error">{validationErrors.assignedTo}</span>
          )}
        </div>

        <div>
          <label>Assignment Date</label>
          <input
            name="assignmentDate"
            type="date"
            value={assignment.assignmentDate}
            onChange={(e) => { handleChange(e); setValidationErrors({ ...validationErrors, assignmentDate: '' }) }}
            className={validationErrors.assignmentDate ? 'input-error' : ''}
          />
          {validationErrors.assignmentDate && (
            <span className="field-error">{validationErrors.assignmentDate}</span>
          )}
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
      )}

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
                  {canManageAssetAssignment && (
                    <button type="button" onClick={() => handleEdit(item)}>
                      Edit
                    </button>
                  )}

                  {canManageAssetAssignment && (
                    <button type="button" onClick={() => { setSuccessMsg(''); setErrorMsg(''); setConfirmDeleteId(item.id) }}>
                      Delete
                    </button>
                  )}
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