import { useEffect, useMemo, useState } from 'react'
import {
  createLocationAccountingDaySetting,
  deleteLocationAccountingDaySetting,
  getLocationAccountingDaySettings,
  updateLocationAccountingDaySetting,
} from '../api/locationAccountingDaySettingApi'
import PaginationControls, { paginateRows, usePageSize } from '../components/common/PaginationControls'
import DataTableToolbar from '../components/common/DataTableToolbar'
import { useDataFilters } from '../hooks/useDataFilters'
import { useAutoColumns } from '../hooks/useAutoColumns'
import { usePermissions } from '../hooks/usePermissions'
import AlertMessage from '../components/common/AlertMessage'
import FormDialog from '../components/common/FormDialog'
import Icon from '../components/common/Icon'
import { logUiAction } from '../utils/actionLogger'

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
  const [successMsg, setSuccessMsg] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [validationErrors, setValidationErrors] = useState({})
  const [confirmDeleteItem, setConfirmDeleteItem] = useState(null)
  const [page, setPage] = useState(1)

  const pageSize = usePageSize()
  const activeLocations = useMemo(() => {
    return (locations || []).filter((location) => location.status === 'Active')
  }, [locations])

  const { hasPermission } = usePermissions(loggedInUser)
  const canCreate = hasPermission('Create Location Accounting Day Setting')
  const canEdit = hasPermission('Edit Location Accounting Day Setting')
  const canDelete = hasPermission('Delete Location Accounting Day Setting')
  const [formOpen, setFormOpen] = useState(false)
  const canManage = editId === null ? canCreate : canEdit

  const settingsFilters = useDataFilters(settings, useAutoColumns(settings), { module: 'Location Accounting Day Settings' })
  const visibleSettings = paginateRows(settingsFilters.filteredRows, page, pageSize)

  const reloadSettings = async (locationCode = selectedLocationCode) => {
    try {
      setLoading(true)
      setSuccessMsg('')
      setErrorMsg('')

      const filters = {}

      if (locationCode) {
        filters.locationCode = locationCode
      }

      const data = await getLocationAccountingDaySettings(filters)
      setSettings(data)
    } catch (error) {
      setErrorMsg(error.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    reloadSettings('')
  }, [])

  useEffect(() => {
    setPage(1)
  }, [settings.length])

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
    const errors = {}

    if (setting.locationCode.trim() === '') {
      errors.locationCode = 'Location is required'
    }

    if (setting.dayStartTime.trim() === '') {
      errors.dayStartTime = 'Day Start Time is required'
    }

    if (setting.dayEndTime.trim() === '') {
      errors.dayEndTime = 'Day End Time is required'
    }

    if (setting.dayStartTime && setting.dayEndTime && setting.dayStartTime === setting.dayEndTime) {
      errors.dayEndTime = 'Day Start Time and Day End Time cannot be same'
    }

    if (setting.effectiveFrom.trim() === '') {
      errors.effectiveFrom = 'Effective From is required'
    }

    if (
      setting.effectiveTo &&
      setting.effectiveTo.trim() !== '' &&
      setting.effectiveTo < setting.effectiveFrom
    ) {
      errors.effectiveTo = 'Effective To cannot be earlier than Effective From'
    }

    if (setting.timezoneName.trim() === '') {
      errors.timezoneName = 'Timezone is required'
    }

    setValidationErrors(errors)
    return Object.keys(errors).length === 0
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSuccessMsg('')
    setErrorMsg('')
    setValidationErrors({})

    if (!canManage) {
      setErrorMsg('You do not have permission to manage Location Accounting Day Settings.')
      return
    }

    if (!validateBeforeSave()) {
      return
    }

    try {
      setLoading(true)

      if (editId === null) {
        await createLocationAccountingDaySetting(setting)
        setSuccessMsg('Location Accounting Day Setting saved successfully')
      } else {
        await updateLocationAccountingDaySetting(editId, setting)
        setSuccessMsg('Location Accounting Day Setting updated successfully')
      }

      const locationToReload = selectedLocationCode || setting.locationCode

      setSetting({
        ...emptySetting,
        locationCode: selectedLocationCode,
      })
      setEditId(null)
      setFormOpen(false)

      await reloadSettings(locationToReload)
    } catch (error) {
      setErrorMsg(error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleEdit = (item) => {
    if (!canEdit) {
      setErrorMsg('You do not have permission to edit Location Accounting Day Settings.')
      return
    }
    setSuccessMsg('')
    setErrorMsg('')
    setFormOpen(true)
    logUiAction('Location Accounting Day Settings', 'Open Edit Dialog', { locationCode: item.locationCode })
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
    setSuccessMsg('')
    setErrorMsg('')

    if (!canDelete) {
      setErrorMsg('You do not have permission to delete Location Accounting Day Settings.')
      return
    }

    try {
      setLoading(true)

      await deleteLocationAccountingDaySetting(item.id)
      setConfirmDeleteItem(null)
      setSuccessMsg('Location Accounting Day Setting deleted successfully')

      if (editId === item.id) {
        setSetting({
          ...emptySetting,
          locationCode: selectedLocationCode,
        })
        setEditId(null)
      }

      await reloadSettings(selectedLocationCode)
    } catch (error) {
      setErrorMsg(error.message)
    } finally {
      setLoading(false)
    }
  }

  /* -------------------------------------------------------- bulk upload */

  const SETTING_STATUSES = ['Active', 'Inactive', 'Blocked']

  const importConfig = {
    title: 'Bulk upload accounting day settings',
    description:
      'Upload an Excel (.xlsx) or CSV file. Settings are matched on Location + Effective From and updated when they already exist. Times use the 24-hour HH:MM format.',
    templateFileName: 'location-accounting-day-settings',
    fields: [
      { key: 'locationCode', label: 'Location Code', required: true, example: 'UTP', aliases: ['Location'] },
      { key: 'dayStartTime', label: 'Day Start Time', required: true, example: '06:01', hint: 'HH:MM' },
      { key: 'dayEndTime', label: 'Day End Time', required: true, example: '06:00', hint: 'HH:MM' },
      { key: 'effectiveFrom', label: 'Effective From', example: '2026-01-01', hint: 'YYYY-MM-DD' },
      { key: 'effectiveTo', label: 'Effective To', example: '', hint: 'YYYY-MM-DD, blank = open ended' },
      { key: 'timezoneName', label: 'Timezone Name', example: 'Africa/Lagos' },
      { key: 'description', label: 'Description', example: '' },
      { key: 'status', label: 'Status', options: SETTING_STATUSES, defaultValue: 'Active', example: 'Active' },
    ],
    validateRow: (record) => {
      if (!activeLocations.some((item) => String(item.locationCode).toLowerCase() === String(record.locationCode).trim().toLowerCase())) {
        return `Unknown or inactive location code "${record.locationCode}"`
      }
      const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/
      if (!timePattern.test(String(record.dayStartTime).trim())) {
        return 'Day Start Time must use the HH:MM format'
      }
      if (!timePattern.test(String(record.dayEndTime).trim())) {
        return 'Day End Time must use the HH:MM format'
      }
      if (record.effectiveTo && String(record.effectiveTo) < String(record.effectiveFrom)) {
        return 'Effective To cannot be earlier than Effective From'
      }
      if (record.status && !SETTING_STATUSES.includes(record.status)) {
        return `Status must be one of ${SETTING_STATUSES.join(', ')}`
      }
      return null
    },
    onImportRow: async (record) => {
      const payload = {
        ...emptySetting,
        ...record,
        effectiveTo: String(record.effectiveTo || '').trim(),
        timezoneName: String(record.timezoneName || '').trim() || 'Africa/Lagos',
        status: record.status || 'Active',
      }
      const existing = settings.find(
        (item) =>
          String(item.locationCode).toLowerCase() === String(payload.locationCode).trim().toLowerCase() &&
          String(item.effectiveFrom || '') === String(payload.effectiveFrom || '')
      )
      if (existing) {
        await updateLocationAccountingDaySetting(existing.id, payload)
      } else {
        await createLocationAccountingDaySetting(payload)
      }
    },
    onComplete: async () => {
      await reloadSettings('')
    },
  }

  const handleCancelEdit = () => {
    setSetting({
      ...emptySetting,
      locationCode: selectedLocationCode,
    })
    setEditId(null)
    setErrorMsg('')
    setFormOpen(false)
  }

  const openCreate = () => {
    handleCancelEdit()
    setSuccessMsg('')
    setFormOpen(true)
    logUiAction('Location Accounting Day Settings', 'Open Create Dialog')
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

        <div className="page-title-actions">
          {canCreate && (<button type="button" className="btn-primary" onClick={openCreate}><Icon name="plus" size={15} />New Setting</button>)}
          <span className="record-count">
          {settings.length} Settings
        </span>
        </div>
      </div>

      {activeLocations.length === 0 && (
        <div className="info-box">
          Please create at least one Active Location before configuring
          accounting day settings.
        </div>
      )}

      {!formOpen && <AlertMessage tone="success" message={successMsg} onDismiss={() => setSuccessMsg('')} />}
      {!formOpen && <AlertMessage tone="error" message={errorMsg} onDismiss={() => setErrorMsg('')} />}

      {!canCreate && !canEdit && !canDelete && (
        <div className="info-box">You have view-only access to Location Accounting Day Settings.</div>
      )}

      {confirmDeleteItem && (
        <div className="confirm-overlay">
          <div className="confirm-box">
            <p>Are you sure you want to delete accounting day setting for <strong>{confirmDeleteItem.locationCode}</strong>?</p>
            <div className="confirm-actions">
              <button onClick={() => handleDelete(confirmDeleteItem)} disabled={loading}>
                {loading ? 'Deleting...' : 'Yes, Delete'}
              </button>
              <button onClick={() => setConfirmDeleteItem(null)} disabled={loading}>
                Cancel
              </button>
            </div>
          </div>
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

      <FormDialog
        open={formOpen}
        title={editId === null ? 'New Accounting Day Setting' : 'Edit Accounting Day Setting'}
        description="Example: start 06:01 and end 06:00 means accounting date 17/05 runs from 17/05 06:01 to 18/05 06:00."
        size="lg"
        columns={3}
        submitLabel={editId === null ? 'Save Setting' : 'Update Setting'}
        busy={loading}
        error={errorMsg}
        onDismissError={() => setErrorMsg('')}
        onSubmit={handleSubmit}
        onCancel={handleCancelEdit}
      >
        <div>
          <label>Location</label>
          <select
            name="locationCode"
            value={setting.locationCode}
            onChange={(e) => { handleChange(e); setValidationErrors({ ...validationErrors, locationCode: '' }) }}
            disabled={loading}
            className={validationErrors.locationCode ? 'input-error' : ''}
          >
            <option value="">Select Location</option>

            {activeLocations.map((location) => (
              <option key={location.id} value={location.locationCode}>
                {location.locationName} ({location.locationCode})
              </option>
            ))}
          </select>
          {validationErrors.locationCode && (
            <span className="field-error">{validationErrors.locationCode}</span>
          )}
        </div>

        <div>
          <label>Day Start Time</label>
          <input
            name="dayStartTime"
            type="time"
            value={setting.dayStartTime}
            onChange={(e) => { handleChange(e); setValidationErrors({ ...validationErrors, dayStartTime: '' }) }}
            disabled={loading}
            className={validationErrors.dayStartTime ? 'input-error' : ''}
          />
          {validationErrors.dayStartTime && (
            <span className="field-error">{validationErrors.dayStartTime}</span>
          )}
        </div>

        <div>
          <label>Day End Time</label>
          <input
            name="dayEndTime"
            type="time"
            value={setting.dayEndTime}
            onChange={(e) => { handleChange(e); setValidationErrors({ ...validationErrors, dayEndTime: '' }) }}
            disabled={loading}
            className={validationErrors.dayEndTime ? 'input-error' : ''}
          />
          {validationErrors.dayEndTime && (
            <span className="field-error">{validationErrors.dayEndTime}</span>
          )}
        </div>

        <div>
          <label>Timezone</label>
          <input
            name="timezoneName"
            type="text"
            value={setting.timezoneName}
            onChange={(e) => { handleChange(e); setValidationErrors({ ...validationErrors, timezoneName: '' }) }}
            placeholder="Example: Africa/Lagos"
            disabled={loading}
            className={validationErrors.timezoneName ? 'input-error' : ''}
          />
          {validationErrors.timezoneName && (
            <span className="field-error">{validationErrors.timezoneName}</span>
          )}
        </div>

        <div>
          <label>Effective From</label>
          <input
            name="effectiveFrom"
            type="date"
            value={setting.effectiveFrom}
            onChange={(e) => { handleChange(e); setValidationErrors({ ...validationErrors, effectiveFrom: '' }) }}
            disabled={loading}
            className={validationErrors.effectiveFrom ? 'input-error' : ''}
          />
          {validationErrors.effectiveFrom && (
            <span className="field-error">{validationErrors.effectiveFrom}</span>
          )}
        </div>

        <div>
          <label>Effective To</label>
          <input
            name="effectiveTo"
            type="date"
            value={setting.effectiveTo}
            onChange={(e) => { handleChange(e); setValidationErrors({ ...validationErrors, effectiveTo: '' }) }}
            disabled={loading}
            className={validationErrors.effectiveTo ? 'input-error' : ''}
          />
          {validationErrors.effectiveTo && (
            <span className="field-error">{validationErrors.effectiveTo}</span>
          )}
        </div>

        <div>
          <label>Status</label>
          <select
            name="status"
            value={setting.status}
            onChange={handleChange}
            disabled={loading}
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
            disabled={loading}
          />
        </div>
      </FormDialog>

      <DataTableToolbar
        filters={settingsFilters}
        columns={settingsFilters.columns}
        exportFileName="location-accounting-day-settings"
        exportTitle="Location Accounting Day Settings"
        module="Location Accounting Day Settings"
        importConfig={importConfig}
        canImport={canCreate}
      />

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
            {(canEdit || canDelete) && <th>Actions</th>}
          </tr>
        </thead>

        <tbody>
          {settings.length === 0 ? (
            <tr>
              <td colSpan={canEdit || canDelete ? 10 : 9} className="empty-table">
                No Location Accounting Day Settings found.
              </td>
            </tr>
          ) : (
            visibleSettings.map((item) => (
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
                {(canEdit || canDelete) && (
                  <td className="row-actions">
                    {canEdit && (
                      <button type="button" onClick={() => handleEdit(item)} disabled={loading}>
                        Edit
                      </button>
                    )}
                    {canDelete && (
                      <button
                        type="button"
                        onClick={() => { setSuccessMsg(''); setErrorMsg(''); setConfirmDeleteItem(item) }}
                        disabled={loading}
                      >
                        Delete
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))
          )}
        </tbody>
      </table>

      <PaginationControls currentPage={page} totalRows={settingsFilters.filteredRows.length} onPageChange={setPage} />
    </div>
  )
}

export default LocationAccountingDaySetting