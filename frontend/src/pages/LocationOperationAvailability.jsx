import { useEffect, useState } from 'react'
import {
  createLocationOperationAvailability,
  updateLocationOperationAvailability,
  deleteLocationOperationAvailability,
} from '../api/locationOperationAvailabilityApi'
import PaginationControls, { paginateRows, usePageSize } from '../components/common/PaginationControls'
import DataTableToolbar from '../components/common/DataTableToolbar'
import { useDataFilters } from '../hooks/useDataFilters'
import { useAutoColumns } from '../hooks/useAutoColumns'
import AlertMessage from '../components/common/AlertMessage'
import FormDialog from '../components/common/FormDialog'
import Icon from '../components/common/Icon'
import { usePermissions } from '../hooks/usePermissions'
import { logUiAction } from '../utils/actionLogger'

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
  const [successMsg, setSuccessMsg] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [validationErrors, setValidationErrors] = useState({})
  const [confirmDeleteItem, setConfirmDeleteItem] = useState(null)
  const [page, setPage] = useState(1)

  const pageSize = usePageSize()
  const activeLocations = locations.filter((location) => {
    return location.status === 'Active'
  })

  const activeOperationTypes = operationTypes.filter((operationType) => {
    return operationType.status === 'Active'
  })

  const { hasPermission } = usePermissions(loggedInUser)

  const canCreate = hasPermission('Create Location Operation Availability')
  const canEdit = hasPermission('Edit Location Operation Availability')
  const canDelete = hasPermission('Delete Location Operation Availability')
  const [formOpen, setFormOpen] = useState(false)
  const locationOperationAvailabilityFilters = useDataFilters(locationOperationAvailability, useAutoColumns(locationOperationAvailability), { module: 'Location Operation Availability' })
  const visibleEntries = paginateRows(locationOperationAvailabilityFilters.filteredRows, page, pageSize)

  useEffect(() => {
    setPage(1)
  }, [locationOperationAvailability.length])

  const handleChange = (e) => {
    const { name, value } = e.target
    setFormData({
      ...formData,
      [name]: value,
    })
    if (errorMsg) setErrorMsg('')
    if (validationErrors[name]) {
      setValidationErrors((prev) => {
        const next = { ...prev }
        delete next[name]
        return next
      })
    }
    if (validationErrors._form) {
      setValidationErrors((prev) => {
        const next = { ...prev }
        delete next._form
        return next
      })
    }
  }

  const validateForm = () => {
    const errors = {}
    if (formData.locationCode.trim() === '') {
      errors.locationCode = 'Location is required'
    }

    if (formData.operationTypeCode.trim() === '') {
      errors.operationTypeCode = 'Operation Type is required'
    }

    if (!Object.keys(errors).length) {
      const duplicate = locationOperationAvailability.some((item) => {
        return (
          item.locationCode === formData.locationCode &&
          item.operationTypeCode === formData.operationTypeCode &&
          item.id !== editId
        )
      })

      if (duplicate) {
        errors._form = 'This operation type is already configured for this location.'
      }
    }

    setValidationErrors(errors)
    return Object.keys(errors).length === 0
  }

  const handleSubmit = async (e) => {
    e.preventDefault()

    if (!(editId === null ? canCreate : canEdit)) {
      setErrorMsg(`You do not have permission to ${editId === null ? 'create' : 'edit'} location operation availability.`)
      return
    }

    if (!validateForm()) {
      return
    }

    try {
      setLoading(true)

      if (editId === null) {
        await createLocationOperationAvailability(formData)
        setSuccessMsg('Location operation availability created successfully')
      } else {
        await updateLocationOperationAvailability(editId, formData)
        setSuccessMsg('Location operation availability updated successfully')
      }

      await reloadLocationOperationAvailability()

      setFormData(emptyForm)
      setEditId(null)
      setFormOpen(false)
    } catch (error) {
      setErrorMsg(error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleEdit = (item) => {
    if (!canEdit) {
      setErrorMsg('You do not have permission to edit location operation availability.')
      return
    }
    setSuccessMsg('')
    setErrorMsg('')
    setValidationErrors({})
    setFormOpen(true)
    logUiAction('Location Operation Availability', 'Open Edit Dialog', { locationCode: item.locationCode, operationTypeCode: item.operationTypeCode })

    setFormData({
      locationCode: item.locationCode,
      operationTypeCode: item.operationTypeCode,
      status: item.status,
      remarks: item.remarks || '',
    })

    setEditId(item.id)
  }

  const handleDelete = (item) => {
    if (!canDelete) {
      setErrorMsg('You do not have permission to delete location operation availability.')
      return
    }

    setConfirmDeleteItem(item)
  }

  const confirmDeleteAvailability = async () => {
    if (!confirmDeleteItem) return
    const item = confirmDeleteItem

    try {
      setLoading(true)

      await deleteLocationOperationAvailability(item.id)
      await reloadLocationOperationAvailability()

      if (editId === item.id) {
        setFormData(emptyForm)
        setEditId(null)
      }

      setConfirmDeleteItem(null)
      setSuccessMsg('Location operation availability deleted successfully')
    } catch (error) {
      setErrorMsg(error.message)
      setConfirmDeleteItem(null)
    } finally {
      setLoading(false)
    }
  }

  const handleCancelEdit = () => {
    setFormData(emptyForm)
    setEditId(null)
    setValidationErrors({})
    setErrorMsg('')
    setFormOpen(false)
  }

  const openCreate = () => {
    handleCancelEdit()
    setSuccessMsg('')
    setFormOpen(true)
    logUiAction('Location Operation Availability', 'Open Create Dialog')
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
      {confirmDeleteItem && (
        <div className="confirm-overlay">
          <div className="confirm-dialog">
            <p>Are you sure you want to delete this configuration?</p>
            <div className="confirm-actions">
              <button onClick={confirmDeleteAvailability}>Yes, Delete</button>
              <button onClick={() => setConfirmDeleteItem(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
      <div className="page-title">
        <div>
          <h2>Location Operation Availability</h2>
          <p>
            Configure which operation types are available at each location.
          </p>
        </div>

        <div className="page-title-actions">
          {canCreate && (<button type="button" className="btn-primary" onClick={openCreate}><Icon name="plus" size={15} />New Availability</button>)}
          <span className="record-count">
          {locationOperationAvailability.length} Configurations
        </span>
        </div>
      </div>

      {!formOpen && <AlertMessage tone="success" message={successMsg} onDismiss={() => setSuccessMsg('')} />}
      {!formOpen && <AlertMessage tone="error" message={errorMsg} onDismiss={() => setErrorMsg('')} />}

      {!canCreate && !canEdit && !canDelete && (
        <div className="info-box">You have view-only access to Location Operation Availability.</div>
      )}

      <FormDialog
        open={formOpen}
        title={editId === null ? 'New Availability' : 'Edit Availability'}
        description="Operation Entry offers an operation type at a location only when it is configured here."
        submitLabel={editId === null ? 'Save Availability' : 'Update Availability'}
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
          {validationErrors.locationCode && (
            <span className="field-error">{validationErrors.locationCode}</span>
          )}
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
          {validationErrors.operationTypeCode && (
            <span className="field-error">{validationErrors.operationTypeCode}</span>
          )}
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

        {validationErrors._form && (
          <span className="field-error" style={{ display: 'block', marginTop: 8 }}>{validationErrors._form}</span>
        )}
      </FormDialog>
      <div className="section-title">
        <h3>Configured Availability</h3>
        <p>
          These records control the operation types available for each location.
        </p>
      </div>

      <DataTableToolbar
        filters={locationOperationAvailabilityFilters}
        columns={locationOperationAvailabilityFilters.columns}
        exportFileName="location-operation-availability"
        exportTitle="Location Operation Availability"
      />

      <table>
        <thead>
          <tr>
            <th>Location</th>
            <th>Operation Type</th>
            <th>Status</th>
            <th>Remarks</th>
            {(canEdit || canDelete) && <th>Actions</th>}
          </tr>
        </thead>

        <tbody>
          {visibleEntries.length === 0 ? (
            <tr>
              <td
                colSpan={canEdit || canDelete ? 5 : 4}
                className="empty-table"
              >
                No location operation availability configured yet.
              </td>
            </tr>
          ) : (
            visibleEntries.map((item) => (
              <tr key={item.id}>
                <td>{getLocationDisplay(item.locationCode)}</td>
                <td>{getOperationTypeDisplay(item.operationTypeCode)}</td>
                <td>
                  <span className={`status-badge ${item.status.toLowerCase()}`}>
                    {item.status}
                  </span>
                </td>
                <td>{item.remarks}</td>

                {(canEdit || canDelete) && (
                  <td className="row-actions">
                    {canEdit && (
                      <button type="button" onClick={() => handleEdit(item)}>
                        Edit
                      </button>
                    )}
                    {canDelete && (
                      <button type="button" onClick={() => handleDelete(item)}>
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

      <PaginationControls
        currentPage={page}
        totalRows={locationOperationAvailabilityFilters.filteredRows.length}
        onPageChange={setPage}
      />

    </div>
  )
}

export default LocationOperationAvailability