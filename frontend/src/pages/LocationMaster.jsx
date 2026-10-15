import { useState } from 'react'
import {
  createLocation,
  deleteLocation,
  updateLocation,
} from '../api/locationApi'
import PaginationControls, { paginateRows, usePageSize } from '../components/common/PaginationControls'
import DataTableToolbar from '../components/common/DataTableToolbar'
import PageHeader from '../components/common/PageHeader'
import AlertMessage from '../components/common/AlertMessage'
import FormDialog from '../components/common/FormDialog'
import Icon from '../components/common/Icon'
import { useConfirm } from '../components/common/ConfirmProvider'
import { useDataFilters } from '../hooks/useDataFilters'
import { useAutoColumns } from '../hooks/useAutoColumns'
import { usePermissions } from '../hooks/usePermissions'
import { logUiAction } from '../utils/actionLogger'

const LOCATION_TYPES = ['Company', 'Region', 'Terminal', 'Station', 'Tank Farm', 'Jetty', 'Warehouse', 'Office', 'Other']
const IMPORT_STATUSES = ['Active', 'Inactive', 'Blocked']

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
  const [formOpen, setFormOpen] = useState(false)
  const [formError, setFormError] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const [page, setPage] = useState(1)

  const pageSize = usePageSize()
  const locationsFilters = useDataFilters(locations, useAutoColumns(locations), { module: 'Location Master' })
  const visibleItems = paginateRows(locationsFilters.filteredRows, page, pageSize)

  const confirm = useConfirm()
  const { hasPermission } = usePermissions(loggedInUser)
  const canCreate = hasPermission('Create Location')
  const canEdit = hasPermission('Edit Location')
  const canDelete = hasPermission('Delete Location')
  const readOnly = !canCreate && !canEdit && !canDelete

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

  const handleSubmit = async () => {
    clearMessages()
    setFormError('')

    const allowed = editId === null ? canCreate : canEdit
    if (!allowed) {
      setFormError(`You do not have permission to ${editId === null ? 'create' : 'edit'} locations.`)
      return
    }
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
      setFormOpen(false)
    } catch (err) {
      setFormError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const openCreate = () => {
    clearMessages()
    setFormError('')
    setFieldErrors({})
    setLocation(emptyLocation)
    setEditId(null)
    setFormOpen(true)
    logUiAction('Location Master', 'Open Create Dialog')
  }

  const handleEdit = (item) => {
    clearMessages()
    setFormError('')
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
    setFormOpen(true)
    logUiAction('Location Master', 'Open Edit Dialog', { locationCode: item.locationCode })
  }

  const handleDelete = async (item) => {
    clearMessages()
    if (!canDelete) { setError('You do not have permission to delete locations.'); return }
    const confirmed = await confirm({
      title: 'Delete location',
      message: `Delete ${item.locationName} (${item.locationCode})? This cannot be undone.`,
      tone: 'danger',
      confirmLabel: 'Delete',
      module: 'Location Master',
    })
    if (!confirmed) return

    try {
      setLoading(true)
      await deleteLocation(item.id)
      setSuccess('Location deleted successfully')
      await reloadLocations()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const closeForm = () => {
    setFormOpen(false)
    setLocation(emptyLocation)
    setEditId(null)
    setFieldErrors({})
    setFormError('')
  }

  const getParentLocationDisplay = (parentLocationCode) => {
    if (!parentLocationCode) return 'None'
    const parent = locations.find((l) => l.locationCode === parentLocationCode)
    return parent ? `${parent.locationName} (${parent.locationCode})` : parentLocationCode
  }


  const importConfig = {
    title: 'Bulk upload locations',
    description: 'Create records from an Excel or CSV file. Existing codes are skipped.',
    fields: [
    { key: 'locationName', label: 'Location Name', required: true, example: 'Utapate Terminal' },
    { key: 'locationCode', label: 'Location Code', required: true, example: 'UTP' },
    { key: 'locationType', label: 'Location Type', required: true, options: LOCATION_TYPES, example: 'Terminal' },
    { key: 'parentLocation', label: 'Parent Location (code)', example: '' },
    { key: 'description', label: 'Description', example: '' },
    { key: 'status', label: 'Status', options: IMPORT_STATUSES, defaultValue: 'Active', example: 'Active' },
  ],
    validateRow: (record) => {
    const code = String(record.locationCode || '').trim().toLowerCase()
    if (locations.some((item) => item.locationCode.toLowerCase() === code)) return 'Location code already exists'
    if (!LOCATION_TYPES.includes(record.locationType)) return `Location type must be one of ${LOCATION_TYPES.join(', ')}`
    if (record.parentLocation && String(record.parentLocation).toLowerCase() === code) return 'Location cannot be its own parent'
    if (record.status && !IMPORT_STATUSES.includes(record.status)) return `Status must be one of ${IMPORT_STATUSES.join(', ')}`
    return null
  },
    onImportRow: async (record) => {
      await createLocation({ ...emptyLocation, ...record, status: record.status || 'Active' })
    },
    onComplete: async () => {
      await reloadLocations()
    },
  }

  return (
    <div>
      <PageHeader
        title="Location Master"
        description="Create, update, and manage operational locations."
        count={`${locations.length} Locations`}
        actions={
          canCreate && (
            <button type="button" className="btn-primary" onClick={openCreate}>
              <Icon name="plus" size={15} />
              New Location
            </button>
          )
        }
      />

      <AlertMessage tone="success" message={success} onDismiss={() => setSuccess('')} />
      <AlertMessage tone="error" message={error} onDismiss={() => setError('')} />

      {readOnly && (
        <div className="info-box">You have view-only access to Location Master.</div>
      )}

      <FormDialog
        open={formOpen}
        title={editId === null ? 'New Location' : 'Edit Location'}
        description="Location Code must be unique. Example: UTP for Utapate Terminal."
        submitLabel={editId === null ? 'Save Location' : 'Update Location'}
        busy={loading}
        error={formError}
        onDismissError={() => setFormError('')}
        onSubmit={handleSubmit}
        onCancel={closeForm}
      >
        <div>
          <label>Location Name</label>
          <input name="locationName" type="text" value={location.locationName} onChange={handleChange}
            placeholder="Example: Utapate Terminal"
            aria-invalid={fieldErrors.locationName ? 'true' : undefined} />
          {fieldErrors.locationName && <small className="field-error">{fieldErrors.locationName}</small>}
        </div>
        <div>
          <label>Location Code</label>
          <input name="locationCode" type="text" value={location.locationCode} onChange={handleChange}
            placeholder="Example: UTP"
            aria-invalid={fieldErrors.locationCode ? 'true' : undefined} />
          {fieldErrors.locationCode && <small className="field-error">{fieldErrors.locationCode}</small>}
        </div>
        <div>
          <label>Location Type</label>
          <select name="locationType" value={location.locationType} onChange={handleChange}
            aria-invalid={fieldErrors.locationType ? 'true' : undefined}>
            <option value="">Select Location Type</option>
            <option>Company</option><option>Region</option><option>Terminal</option>
            <option>Station</option><option>Tank Farm</option><option>Jetty</option>
            <option>Warehouse</option><option>Office</option><option>Other</option>
          </select>
          {fieldErrors.locationType && <small className="field-error">{fieldErrors.locationType}</small>}
        </div>
        <div>
          <label>Parent Location</label>
          <select name="parentLocation" value={location.parentLocation} onChange={handleChange}>
            <option value="">None</option>
            {activeLocations.map((item) => (
              <option key={item.id} value={item.locationCode}>{item.locationName} ({item.locationCode})</option>
            ))}
          </select>
          {fieldErrors.parentLocation && <small className="field-error">{fieldErrors.parentLocation}</small>}
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
      </FormDialog>

      <DataTableToolbar
        filters={locationsFilters}
        columns={locationsFilters.columns}
        exportFileName="location-master"
        exportTitle="Location Master"
        module="Location Master"
        importConfig={importConfig}
        canImport={canCreate}
      />

      <table>
        <thead>
          <tr>
            <th>Location Name</th><th>Code</th><th>Type</th>
            <th>Parent Location</th><th>Description</th><th>Status</th>
            {(canEdit || canDelete) && <th>Actions</th>}
          </tr>
        </thead>
        <tbody>
          {locations.length === 0 ? (
            <tr><td colSpan={canEdit || canDelete ? 7 : 6} className="empty-table">No locations added yet.</td></tr>
          ) : (
            visibleItems.map((item) => (
              <tr key={item.id}>
                <td>{item.locationName}</td>
                <td>{item.locationCode}</td>
                <td>{item.locationType}</td>
                <td>{getParentLocationDisplay(item.parentLocation)}</td>
                <td>{item.description}</td>
                <td><span className={`status-badge ${item.status.toLowerCase()}`}>{item.status}</span></td>
                {(canEdit || canDelete) && (
                  <td className="row-actions">
                    {canEdit && <button type="button" onClick={() => handleEdit(item)}>Edit</button>}
                    {canDelete && (
                      <button type="button" onClick={() => handleDelete(item)} disabled={loading}>Delete</button>
                    )}
                  </td>
                )}
              </tr>
            ))
          )}
        </tbody>
      </table>

      <PaginationControls currentPage={page} totalRows={locationsFilters.filteredRows.length} onPageChange={setPage} />
    </div>
  )
}

export default LocationMaster