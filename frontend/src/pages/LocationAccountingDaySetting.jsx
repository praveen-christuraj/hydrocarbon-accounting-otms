import { useEffect, useMemo, useState } from 'react'
import {
  createLocationAccountingDaySetting,
  deleteLocationAccountingDaySetting,
  getLocationAccountingDaySettings,
  updateLocationAccountingDaySetting,
} from '../api/locationAccountingDaySettingApi'

function LocationAccountingDaySetting({ locations, loggedInUser }) {
  const emptySetting = {
    locationCode: '',
    dayStartTime: '06:01',
    dayEndTime: '06:00',
    effectiveFrom: '',
    effectiveTo: '',
    timezoneName: 'Africa/Lagos',
    description: '',
    status: 'Active',
  }

  const [settings, setSettings] = useState([])
  const [setting, setSetting] = useState(emptySetting)
  const [selectedLocationCode, setSelectedLocationCode] = useState('')
  const [editId, setEditId] = useState(null)
  const [loading, setLoading] = useState(false)

  const activeLocations = useMemo(() => {
    return (locations || []).filter((location) => location.status === 'Active')
  }, [locations])

  const canManage = useMemo(() => {
    if (!loggedInUser || !loggedInUser.permissions) {
      return false
    }

    return loggedInUser.permissions.some((permission) => {
      return (
        permission.permissionName ===
        'Manage Location Accounting Day Setting'
      )
    })
  }, [loggedInUser])

  const reloadSettings = async (locationCode = selectedLocationCode) => {
    try {
      setLoading(true)

      const filters = {}

      if (locationCode) {
        filters.locationCode = locationCode
      }

      const data = await getLocationAccountingDaySettings(filters)
      setSettings(data)
    } catch (error) {
      alert(error.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    reloadSettings('')
  }, [])

  const handleFilterLocationChange = async (e) => {
    const locationCode = e.target.value

    setSelectedLocationCode(locationCode)

    setSetting({
      ...setting,
      locationCode,
    })

    await reloadSettings(locationCode)
  }

  const handleChange = (e) => {
    const { name, value } = e.target

    setSetting({
      ...setting,
      [name]: value,
    })
  }

  const validateBeforeSave = () => {
    if (setting.locationCode.trim() === '') {
      alert('Location is required')
      return false
    }

    if (setting.dayStartTime.trim() === '') {
      alert('Day Start Time is required')
      return false
    }

    if (setting.dayEndTime.trim() === '') {
      alert('Day End Time is required')
      return false
    }

    if (setting.dayStartTime === setting.dayEndTime) {
      alert('Day Start Time and Day End Time cannot be same')
      return false
    }

    if (setting.effectiveFrom.trim() === '') {
      alert('Effective From is required')
      return false
    }

    if (
      setting.effectiveTo &&
      setting.effectiveTo.trim() !== '' &&
      setting.effectiveTo < setting.effectiveFrom
    ) {
      alert('Effective To cannot be earlier than Effective From')
      return false
    }

    if (setting.timezoneName.trim() === '') {
      alert('Timezone is required')
      return false
    }

    return true
  }

  const handleSubmit = async (e) => {
    e.preventDefault()

    if (!canManage) {
      alert('You do not have permission to manage Location Accounting Day Settings.')
      return
    }

    if (!validateBeforeSave()) {
      return
    }

    try {
      setLoading(true)

      if (editId === null) {
        await createLocationAccountingDaySetting(setting)
        alert('Location Accounting Day Setting saved successfully')
      } else {
        await updateLocationAccountingDaySetting(editId, setting)
        alert('Location Accounting Day Setting updated successfully')
      }

      const locationToReload = selectedLocationCode || setting.locationCode

      setSetting({
        ...emptySetting,
        locationCode: selectedLocationCode,
      })
      setEditId(null)

      await reloadSettings(locationToReload)
    } catch (error) {
      alert(error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleEdit = (item) => {
    setSetting({
      locationCode: item.locationCode,
      dayStartTime: item.dayStartTime,
      dayEndTime: item.dayEndTime,
      effectiveFrom: item.effectiveFrom,
      effectiveTo: item.effectiveTo || '',
      timezoneName: item.timezoneName || 'Africa/Lagos',
      description: item.description || '',
      status: item.status,
    })

    setEditId(item.id)
  }

  const handleDelete = async (item) => {
    if (!canManage) {
      alert('You do not have permission to manage Location Accounting Day Settings.')
      return
    }

    const confirmDelete = window.confirm(
      `Are you sure you want to delete accounting day setting for ${item.locationCode}?`
    )

    if (confirmDelete === false) {
      return
    }

    try {
      setLoading(true)

      await deleteLocationAccountingDaySetting(item.id)
      alert('Location Accounting Day Setting deleted successfully')

      if (editId === item.id) {
        setSetting({
          ...emptySetting,
          locationCode: selectedLocationCode,
        })
        setEditId(null)
      }

      await reloadSettings(selectedLocationCode)
    } catch (error) {
      alert(error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleCancelEdit = () => {
    setSetting({
      ...emptySetting,
      locationCode: selectedLocationCode,
    })
    setEditId(null)
  }

  const getLocationDisplay = (locationCode) => {
    const location = (locations || []).find((item) => {
      return item.locationCode === locationCode
    })

    if (!location) {
      return locationCode
    }

    return `${location.locationName} (${location.locationCode})`
  }

  const getWindowDescription = (item) => {
    return `${item.dayStartTime} today to ${item.dayEndTime} next day`
  }

  return (
    <div>
      <div className="page-title">
        <div>
          <h2>Location Accounting Day Settings</h2>
          <p>
            Configure location-wise operational day windows for stock ledger and
            daily closing calculations.
          </p>
        </div>

        <span className="record-count">
          {settings.length} Settings
        </span>
      </div>

      {activeLocations.length === 0 && (
        <div className="info-box">
          Please create at least one Active Location before configuring
          accounting day settings.
        </div>
      )}

      {!canManage && (
        <div className="info-box">
          You can view accounting day settings, but you do not have permission to
          create, update, or delete them.
        </div>
      )}

      <div className="filter-panel">
        <div>
          <label>Filter by Location</label>
          <select
            value={selectedLocationCode}
            onChange={handleFilterLocationChange}
            disabled={loading}
          >
            <option value="">All Locations</option>

            {activeLocations.map((location) => (
              <option key={location.id} value={location.locationCode}>
                {location.locationName} ({location.locationCode})
              </option>
            ))}
          </select>
        </div>

        <div className="filter-actions">
          <button
            type="button"
            onClick={() => reloadSettings(selectedLocationCode)}
            disabled={loading}
          >
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <div>
          <label>Location</label>
          <select
            name="locationCode"
            value={setting.locationCode}
            onChange={handleChange}
            disabled={!canManage || loading}
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
          <label>Day Start Time</label>
          <input
            name="dayStartTime"
            type="time"
            value={setting.dayStartTime}
            onChange={handleChange}
            disabled={!canManage || loading}
          />
        </div>

        <div>
          <label>Day End Time</label>
          <input
            name="dayEndTime"
            type="time"
            value={setting.dayEndTime}
            onChange={handleChange}
            disabled={!canManage || loading}
          />
        </div>

        <div>
          <label>Timezone</label>
          <input
            name="timezoneName"
            type="text"
            value={setting.timezoneName}
            onChange={handleChange}
            placeholder="Example: Africa/Lagos"
            disabled={!canManage || loading}
          />
        </div>

        <div>
          <label>Effective From</label>
          <input
            name="effectiveFrom"
            type="date"
            value={setting.effectiveFrom}
            onChange={handleChange}
            disabled={!canManage || loading}
          />
        </div>

        <div>
          <label>Effective To</label>
          <input
            name="effectiveTo"
            type="date"
            value={setting.effectiveTo}
            onChange={handleChange}
            disabled={!canManage || loading}
          />
        </div>

        <div>
          <label>Status</label>
          <select
            name="status"
            value={setting.status}
            onChange={handleChange}
            disabled={!canManage || loading}
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
            value={setting.description}
            onChange={handleChange}
            placeholder="Example: Daily accounting window from 06:01 to 06:00 next day"
            rows="3"
            disabled={!canManage || loading}
          />
        </div>

        <div className="form-actions">
          <button type="submit" disabled={!canManage || loading}>
            {loading
              ? 'Please wait...'
              : editId === null
                ? 'Save Setting'
                : 'Update Setting'}
          </button>

          {editId !== null && (
            <button
              type="button"
              onClick={handleCancelEdit}
              disabled={loading}
            >
              Cancel Edit
            </button>
          )}
        </div>
      </form>

      <div className="section-title">
        <h3>Saved Accounting Day Settings</h3>
        <p>
          These settings will be used by the Tank Stock Ledger to assign each
          approved movement to the correct operational accounting date.
        </p>
      </div>

      <table>
        <thead>
          <tr>
            <th>Location</th>
            <th>Start Time</th>
            <th>End Time</th>
            <th>Window Meaning</th>
            <th>Effective From</th>
            <th>Effective To</th>
            <th>Timezone</th>
            <th>Status</th>
            <th>Description</th>
            <th>Actions</th>
          </tr>
        </thead>

        <tbody>
          {settings.length === 0 ? (
            <tr>
              <td colSpan="10" className="empty-table">
                No Location Accounting Day Settings found.
              </td>
            </tr>
          ) : (
            settings.map((item) => (
              <tr key={item.id}>
                <td>{getLocationDisplay(item.locationCode)}</td>
                <td>{item.dayStartTime}</td>
                <td>{item.dayEndTime}</td>
                <td>{getWindowDescription(item)}</td>
                <td>{item.effectiveFrom}</td>
                <td>{item.effectiveTo || 'Open-ended'}</td>
                <td>{item.timezoneName}</td>
                <td>
                  <span className={`status-badge ${item.status.toLowerCase()}`}>
                    {item.status}
                  </span>
                </td>
                <td>{item.description}</td>
                <td>
                  <button
                    type="button"
                    onClick={() => handleEdit(item)}
                    disabled={loading}
                  >
                    Edit
                  </button>

                  <button
                    type="button"
                    onClick={() => handleDelete(item)}
                    disabled={loading}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <div className="info-box">
        Example: if the start time is 06:01 and end time is 06:00, then
        accounting date 17/05/2026 runs from 17/05/2026 06:01 to 18/05/2026
        06:00. Any transaction before 06:01 belongs to the previous accounting
        date.
      </div>
    </div>
  )
}

export default LocationAccountingDaySetting