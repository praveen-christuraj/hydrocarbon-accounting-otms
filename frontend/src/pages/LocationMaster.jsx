import { useState } from 'react'
import {
  createLocation,
  deleteLocation,
  updateLocation,
} from '../api/locationApi'

function LocationMaster({ locations, reloadLocations }) {
  const emptyLocation = {
    locationName: '',
    locationCode: '',
    locationType: '',
    parentLocation: '',
    description: '',
    status: 'Active',
  }

  const [location, setLocation] = useState(emptyLocation)
  const [editId, setEditId] = useState(null)
  const [loading, setLoading] = useState(false)

  const activeLocations = locations.filter((item) => {
    if (item.status !== 'Active') {
      return false
    }

    if (editId !== null && item.id === editId) {
      return false
    }

    return true
  })

  const handleChange = (e) => {
    setLocation({
      ...location,
      [e.target.name]: e.target.value,
    })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()

    if (location.locationName.trim() === '') {
      alert('Location Name is required')
      return
    }

    if (location.locationCode.trim() === '') {
      alert('Location Code is required')
      return
    }

    if (location.locationType.trim() === '') {
      alert('Location Type is required')
      return
    }

    if (
      location.parentLocation.trim() !== '' &&
      location.parentLocation.toLowerCase() ===
        location.locationCode.toLowerCase()
    ) {
      alert('Location cannot be its own parent')
      return
    }

    const locationCodeAlreadyExists = locations.some((item) => {
      return (
        item.locationCode.toLowerCase() ===
          location.locationCode.toLowerCase() &&
        item.id !== editId
      )
    })

    if (locationCodeAlreadyExists) {
      alert('Location Code already exists. Please choose another code.')
      return
    }

    try {
      setLoading(true)

      if (editId === null) {
        await createLocation(location)
        alert('Location saved successfully')
      } else {
        await updateLocation(editId, location)
        alert('Location updated successfully')
      }

      await reloadLocations()
      setLocation(emptyLocation)
      setEditId(null)
    } catch (error) {
      alert(error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleEdit = (locationToEdit) => {
    setLocation({
      locationName: locationToEdit.locationName,
      locationCode: locationToEdit.locationCode,
      locationType: locationToEdit.locationType,
      parentLocation: locationToEdit.parentLocation,
      description: locationToEdit.description,
      status: locationToEdit.status,
    })

    setEditId(locationToEdit.id)
  }

  const handleDelete = async (locationId) => {
    const confirmDelete = window.confirm(
      'Are you sure you want to delete this location?'
    )

    if (confirmDelete === false) {
      return
    }

    try {
      setLoading(true)

      await deleteLocation(locationId)
      await reloadLocations()

      if (editId === locationId) {
        setLocation(emptyLocation)
        setEditId(null)
      }

      alert('Location deleted successfully')
    } catch (error) {
      alert(error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleCancelEdit = () => {
    setLocation(emptyLocation)
    setEditId(null)
  }

  const getParentLocationDisplay = (parentLocationCode) => {
    if (!parentLocationCode) {
      return 'None'
    }

    const parent = locations.find(
      (locationItem) => locationItem.locationCode === parentLocationCode
    )

    if (!parent) {
      return parentLocationCode
    }

    return `${parent.locationName} (${parent.locationCode})`
  }

  return (
    <div>
      <div className="page-title">
        <div>
          <h2>Location Master</h2>
          <p>Create, update, and manage operational locations.</p>
        </div>

        <span className="record-count">{locations.length} Locations</span>
      </div>

      <form onSubmit={handleSubmit}>
        <div>
          <label>Location Name</label>
          <input
            name="locationName"
            type="text"
            value={location.locationName}
            onChange={handleChange}
            placeholder="Example: Utapate Terminal"
          />
        </div>

        <div>
          <label>Location Code</label>
          <input
            name="locationCode"
            type="text"
            value={location.locationCode}
            onChange={handleChange}
            placeholder="Example: UTP"
          />
        </div>

        <div>
          <label>Location Type</label>
          <select
            name="locationType"
            value={location.locationType}
            onChange={handleChange}
          >
            <option value="">Select Location Type</option>
            <option>Company</option>
            <option>Region</option>
            <option>Terminal</option>
            <option>Station</option>
            <option>Tank Farm</option>
            <option>Jetty</option>
            <option>Warehouse</option>
            <option>Office</option>
            <option>Other</option>
          </select>
        </div>

        <div>
          <label>Parent Location</label>
          <select
            name="parentLocation"
            value={location.parentLocation}
            onChange={handleChange}
          >
            <option value="">None</option>

            {activeLocations.map((item) => (
              <option key={item.id} value={item.locationCode}>
                {item.locationName} ({item.locationCode})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label>Status</label>
          <select
            name="status"
            value={location.status}
            onChange={handleChange}
          >
            <option>Active</option>
            <option>Inactive</option>
            <option>Blocked</option>
          </select>
        </div>

        <div className="full-width-field">
          <label>Description</label>
          <textarea
            name="description"
            value={location.description}
            onChange={handleChange}
            placeholder="Enter location description"
            rows="3"
          />
        </div>

        <div className="form-actions">
          <button type="submit" disabled={loading}>
            {loading
              ? 'Please wait...'
              : editId === null
                ? 'Save Location'
                : 'Update Location'}
          </button>

          {editId !== null && (
            <button type="button" onClick={handleCancelEdit} disabled={loading}>
              Cancel Edit
            </button>
          )}
        </div>
      </form>

      <div className="section-title">
        <h3>Saved Locations</h3>
        <p>Locations are now saved permanently in PostgreSQL.</p>
      </div>

      <table>
        <thead>
          <tr>
            <th>Location Name</th>
            <th>Code</th>
            <th>Type</th>
            <th>Parent Location</th>
            <th>Description</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>

        <tbody>
          {locations.length === 0 ? (
            <tr>
              <td colSpan="7" className="empty-table">
                No locations added yet.
              </td>
            </tr>
          ) : (
            locations.map((item) => (
              <tr key={item.id}>
                <td>{item.locationName}</td>
                <td>{item.locationCode}</td>
                <td>{item.locationType}</td>
                <td>{getParentLocationDisplay(item.parentLocation)}</td>
                <td>{item.description}</td>
                <td>
                  <span
                    className={`status-badge ${item.status.toLowerCase()}`}
                  >
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
        Location Code must be unique. Example: UTP for Utapate Terminal.
      </div>
    </div>
  )
}

export default LocationMaster