import { useState } from 'react'
import {
  createLocationOperationAvailability,
  updateLocationOperationAvailability,
  deleteLocationOperationAvailability,
} from '../api/locationOperationAvailabilityApi'

function LocationOperationAvailability({
  locations,
  operationTypes,
  locationOperationAvailability,
  reloadLocationOperationAvailability,
  loggedInUser,
}) {
  const emptyForm = {
    locationCode: '',
    operationTypeCode: '',
    status: 'Active',
    remarks: '',
  }

  const [formData, setFormData] = useState(emptyForm)
  const [editId, setEditId] = useState(null)
  const [loading, setLoading] = useState(false)

  const activeLocations = locations.filter((location) => {
    return location.status === 'Active'
  })

  const activeOperationTypes = operationTypes.filter((operationType) => {
    return operationType.status === 'Active'
  })

  const hasPermission = (permissionName) => {
    if (!loggedInUser || !loggedInUser.permissions) {
      return false
    }

    return loggedInUser.permissions.some((permission) => {
      return permission.permissionName === permissionName
    })
  }

  const canManageAvailability = hasPermission(
    'Manage Location Operation Availability'
  )

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    })
  }

  const validateForm = () => {
    if (formData.locationCode.trim() === '') {
      alert('Location is required')
      return false
    }

    if (formData.operationTypeCode.trim() === '') {
      alert('Operation Type is required')
      return false
    }

    const duplicate = locationOperationAvailability.some((item) => {
      return (
        item.locationCode === formData.locationCode &&
        item.operationTypeCode === formData.operationTypeCode &&
        item.id !== editId
      )
    })

    if (duplicate) {
      alert('This operation type is already configured for this location.')
      return false
    }

    return true
  }

  const handleSubmit = async (e) => {
    e.preventDefault()

    if (!canManageAvailability) {
      alert('You do not have permission to manage location operation availability.')
      return
    }

    if (!validateForm()) {
      return
    }

    try {
      setLoading(true)

      if (editId === null) {
        await createLocationOperationAvailability(formData)
        alert('Location operation availability created successfully')
      } else {
        await updateLocationOperationAvailability(editId, formData)
        alert('Location operation availability updated successfully')
      }

      await reloadLocationOperationAvailability()

      setFormData(emptyForm)
      setEditId(null)
    } catch (error) {
      alert(error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleEdit = (item) => {
    if (!canManageAvailability) {
      alert('You do not have permission to manage location operation availability.')
      return
    }

    setFormData({
      locationCode: item.locationCode,
      operationTypeCode: item.operationTypeCode,
      status: item.status,
      remarks: item.remarks || '',
    })

    setEditId(item.id)
  }

  const handleDelete = async (item) => {
    if (!canManageAvailability) {
      alert('You do not have permission to manage location operation availability.')
      return
    }

    const confirmDelete = window.confirm(
      'Are you sure you want to delete this configuration?'
    )

    if (confirmDelete === false) {
      return
    }

    try {
      setLoading(true)

      await deleteLocationOperationAvailability(item.id)
      await reloadLocationOperationAvailability()

      if (editId === item.id) {
        setFormData(emptyForm)
        setEditId(null)
      }

      alert('Location operation availability deleted successfully')
    } catch (error) {
      alert(error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleCancelEdit = () => {
    setFormData(emptyForm)
    setEditId(null)
  }

  const getLocationDisplay = (locationCode) => {
    const location = locations.find((item) => {
      return item.locationCode === locationCode
    })

    if (!location) {
      return locationCode
    }

    return `${location.locationName} (${location.locationCode})`
  }

  const getOperationTypeDisplay = (operationTypeCode) => {
    const operationType = operationTypes.find((item) => {
      return item.operationTypeCode === operationTypeCode
    })

    if (!operationType) {
      return operationTypeCode
    }

    return `${operationType.operationTypeName} (${operationType.operationTypeCode})`
  }

  return (
    <div>
      <div className="page-title">
        <div>
          <h2>Location Operation Availability</h2>
          <p>
            Configure which operation types are available at each location.
          </p>
        </div>

        <span className="record-count">
          {locationOperationAvailability.length} Configurations
        </span>
      </div>

      {!canManageAvailability && (
        <div className="info-box">
          You have View Location Operation Availability permission only. Create,
          edit, and delete actions are disabled.
        </div>
      )}

      {canManageAvailability && (
        <form onSubmit={handleSubmit}>
          <div>
            <label>Location</label>
            <select
              name="locationCode"
              value={formData.locationCode}
              onChange={handleChange}
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
            <label>Operation Type</label>
            <select
              name="operationTypeCode"
              value={formData.operationTypeCode}
              onChange={handleChange}
            >
              <option value="">Select Operation Type</option>

              {activeOperationTypes.map((operationType) => (
                <option
                  key={operationType.id}
                  value={operationType.operationTypeCode}
                >
                  {operationType.operationTypeName} (
                  {operationType.operationTypeCode})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label>Status</label>
            <select
              name="status"
              value={formData.status}
              onChange={handleChange}
            >
              <option>Active</option>
              <option>Inactive</option>
              <option>Blocked</option>
            </select>
          </div>

          <div className="full-width-field">
            <label>Remarks</label>
            <textarea
              name="remarks"
              value={formData.remarks}
              onChange={handleChange}
              placeholder="Enter remarks"
              rows="3"
            />
          </div>

          <div className="form-actions">
            <button type="submit" disabled={loading}>
              {loading
                ? 'Saving...'
                : editId === null
                  ? 'Save Configuration'
                  : 'Update Configuration'}
            </button>

            {editId !== null && (
              <button type="button" onClick={handleCancelEdit}>
                Cancel Edit
              </button>
            )}
          </div>
        </form>
      )}

      <div className="section-title">
        <h3>Configured Availability</h3>
        <p>
          These records control the operation types available for each location.
        </p>
      </div>

      <table>
        <thead>
          <tr>
            <th>Location</th>
            <th>Operation Type</th>
            <th>Status</th>
            <th>Remarks</th>
            {canManageAvailability && <th>Actions</th>}
          </tr>
        </thead>

        <tbody>
          {locationOperationAvailability.length === 0 ? (
            <tr>
              <td
                colSpan={canManageAvailability ? 5 : 4}
                className="empty-table"
              >
                No location operation availability configured yet.
              </td>
            </tr>
          ) : (
            locationOperationAvailability.map((item) => (
              <tr key={item.id}>
                <td>{getLocationDisplay(item.locationCode)}</td>
                <td>{getOperationTypeDisplay(item.operationTypeCode)}</td>
                <td>
                  <span className={`status-badge ${item.status.toLowerCase()}`}>
                    {item.status}
                  </span>
                </td>
                <td>{item.remarks}</td>

                {canManageAvailability && (
                  <td>
                    <button type="button" onClick={() => handleEdit(item)}>
                      Edit
                    </button>

                    <button type="button" onClick={() => handleDelete(item)}>
                      Delete
                    </button>
                  </td>
                )}
              </tr>
            ))
          )}
        </tbody>
      </table>

      <div className="info-box">
        Example: If Truck Loading is configured for Utapate Terminal, then
        Operation Entry can later show Truck Loading only for that location.
      </div>
    </div>
  )
}

export default LocationOperationAvailability