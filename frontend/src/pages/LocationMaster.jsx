import { useState } from 'react'
import {
  createLocation,
  deleteLocation,
  updateLocation,
} from '../api/locationApi'

function LocationMaster({ locations, reloadLocations, loggedInUser }) {
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
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [fieldErrors, setFieldErrors] = useState({})

  const isAdminBootstrap =
    String(loggedInUser?.username || '').toLowerCase() === 'admin'

  const hasPermission = (permissionName) => {
    if (isAdminBootstrap) return true
    if (!loggedInUser || !Array.isArray(loggedInUser.permissions)) return false
    return loggedInUser.permissions.some(
      (p) => p.permissionName === permissionName
    )
  }

  const canManageLocation = hasPermission('Manage Location')

  const activeLocations = locations.filter((item) => {
    if (item.status !== 'Active') return false
    if (editId !== null && item.id === editId) return false
    return true
  })

  const clearMessages = () => { setError(''); setSuccess('') }

  const handleChange = (e) => {
    setLocation({ ...location, [e.target.name]: e.target.value })
    setFieldErrors({ ...fieldErrors, [e.target.name]: '' })
  }

  const validateLocation = () => {
    const errors = {}

    if (location.locationName.trim() === '') errors.locationName = 'Location Name is required'
    if (location.locationCode.trim() === '') errors.locationCode = 'Location Code is required'
    if (location.locationType.trim() === '') errors.locationType = 'Location Type is required'

    if (
      location.parentLocation.trim() !== '' &&
      location.parentLocation.toLowerCase() === location.locationCode.toLowerCase()
    ) {
      errors.parentLocation = 'Location cannot be its own parent'
    }

    if (!errors.locationCode) {
      const codeAlreadyExists = locations.some((item) => {
        return (
          item.locationCode.toLowerCase() === location.locationCode.toLowerCase() &&
          item.id !== editId
        )
      })
      if (codeAlreadyExists) errors.locationCode = 'Location Code already exists'
    }

    setFieldErrors(errors)
    return Object.keys(errors).length === 0
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    clearMessages()

    if (!canManageLocation) { setError('You do not have permission to manage locations.'); return }
    if (!validateLocation()) return

    try {
      setLoading(true)

      if (editId === null) {
        await createLocation(location)
        setSuccess('Location saved successfully')
      } else {
        await updateLocation(editId, location)
        setSuccess('Location updated successfully')
      }

      setFieldErrors({})
      await reloadLocations()
      setLocation(emptyLocation)
      setEditId(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleEdit = (item) => {
    clearMessages()
    setConfirmDelete(null)
    setFieldErrors({})
    setLocation({
      locationName: item.locationName,
      locationCode: item.locationCode,
      locationType: item.locationType,
      parentLocation: item.parentLocation,
      description: item.description,
      status: item.status,
    })
    setEditId(item.id)
  }

  const handleDeleteRequest = (id) => {
    clearMessages()
    setConfirmDelete(id)
  }

  const handleDeleteConfirm = async (id) => {
    if (!canManageLocation) { setError('You do not have permission to manage locations.'); return }

    try {
      setLoading(true)
      await deleteLocation(id)
      setConfirmDelete(null)
      setSuccess('Location deleted successfully')
      await reloadLocations()

      if (editId === id) { setLocation(emptyLocation); setEditId(null) }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleCancelEdit = () => {
    setLocation(emptyLocation)
    setEditId(null)
    setFieldErrors({})
    clearMessages()
    setConfirmDelete(null)
  }

  const getParentLocationDisplay = (parentLocationCode) => {
    if (!parentLocationCode) return 'None'
    const parent = locations.find((l) => l.locationCode === parentLocationCode)
    return parent ? `${parent.locationName} (${parent.locationCode})` : parentLocationCode
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

      {success && (
        <div className="error-box" style={{ background: '#f0fdf4', color: '#166534', borderColor: '#bbf7d0' }}>
          {success}
          <button className="error-close" onClick={() => setSuccess('')} type="button">&times;</button>
        </div>
      )}
      {error && (
        <div className="error-box">
          {error}
          <button className="error-close" onClick={() => setError('')} type="button">&times;</button>
        </div>
      )}

      {!canManageLocation && (
        <div className="info-box">You are in view-only mode. Admin can manage locations.</div>
      )}

      <form onSubmit={handleSubmit}>
        <div>
          <label>Location Name</label>
          <input name="locationName" type="text" value={location.locationName} onChange={handleChange}
            placeholder="Example: Utapate Terminal"
            style={fieldErrors.locationName ? { borderColor: '#dc2626' } : {}} />
          {fieldErrors.locationName && <small style={{ color: '#dc2626', marginTop: 4 }}>{fieldErrors.locationName}</small>}
        </div>
        <div>
          <label>Location Code</label>
          <input name="locationCode" type="text" value={location.locationCode} onChange={handleChange}
            placeholder="Example: UTP"
            style={fieldErrors.locationCode ? { borderColor: '#dc2626' } : {}} />
          {fieldErrors.locationCode && <small style={{ color: '#dc2626', marginTop: 4 }}>{fieldErrors.locationCode}</small>}
        </div>
        <div>
          <label>Location Type</label>
          <select name="locationType" value={location.locationType} onChange={handleChange}
            style={fieldErrors.locationType ? { borderColor: '#dc2626' } : {}}>
            <option value="">Select Location Type</option>
            <option>Company</option><option>Region</option><option>Terminal</option>
            <option>Station</option><option>Tank Farm</option><option>Jetty</option>
            <option>Warehouse</option><option>Office</option><option>Other</option>
          </select>
          {fieldErrors.locationType && <small style={{ color: '#dc2626', marginTop: 4 }}>{fieldErrors.locationType}</small>}
        </div>
        <div>
          <label>Parent Location</label>
          <select name="parentLocation" value={location.parentLocation} onChange={handleChange}>
            <option value="">None</option>
            {activeLocations.map((item) => (
              <option key={item.id} value={item.locationCode}>{item.locationName} ({item.locationCode})</option>
            ))}
          </select>
          {fieldErrors.parentLocation && <small style={{ color: '#dc2626', marginTop: 4 }}>{fieldErrors.parentLocation}</small>}
        </div>
        <div>
          <label>Status</label>
          <select name="status" value={location.status} onChange={handleChange}>
            <option>Active</option><option>Inactive</option><option>Blocked</option>
          </select>
        </div>
        <div className="full-width-field">
          <label>Description</label>
          <textarea name="description" value={location.description} onChange={handleChange}
            placeholder="Enter location description" rows="3" />
        </div>
        <div className="form-actions">
          <button type="submit" disabled={loading || !canManageLocation}>
            {loading ? 'Please wait...' : editId === null ? 'Save Location' : 'Update Location'}
          </button>
          {editId !== null && (
            <button type="button" onClick={handleCancelEdit} disabled={loading}>Cancel Edit</button>
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
            <th>Location Name</th><th>Code</th><th>Type</th>
            <th>Parent Location</th><th>Description</th><th>Status</th>
            {canManageLocation && <th>Actions</th>}
          </tr>
        </thead>
        <tbody>
          {locations.length === 0 ? (
            <tr><td colSpan={canManageLocation ? 7 : 6} className="empty-table">No locations added yet.</td></tr>
          ) : (
            locations.map((item) => (
              <tr key={item.id}>
                <td>{item.locationName}</td>
                <td>{item.locationCode}</td>
                <td>{item.locationType}</td>
                <td>{getParentLocationDisplay(item.parentLocation)}</td>
                <td>{item.description}</td>
                <td><span className={`status-badge ${item.status.toLowerCase()}`}>{item.status}</span></td>
                {canManageLocation && (
                  <td>
                    <button type="button" onClick={() => handleEdit(item)}>Edit</button>
                    {confirmDelete === item.id ? (
                      <span>
                        <button type="button" onClick={() => handleDeleteConfirm(item.id)} disabled={loading}
                          style={{ background: '#dc2626', color: '#fff' }}>{loading ? 'Deleting...' : 'Confirm'}</button>
                        <button type="button" onClick={() => setConfirmDelete(null)} disabled={loading}
                          style={{ background: '#64748b', color: '#fff' }}>Cancel</button>
                      </span>
                    ) : (
                      <button type="button" onClick={() => handleDeleteRequest(item.id)}>Delete</button>
                    )}
                  </td>
                )}
              </tr>
            ))
          )}
        </tbody>
      </table>

      <div className="info-box">Location Code must be unique. Example: UTP for Utapate Terminal.</div>
    </div>
  )
}

export default LocationMaster