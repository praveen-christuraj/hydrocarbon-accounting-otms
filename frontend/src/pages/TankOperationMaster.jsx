import { useEffect, useMemo, useState } from 'react'
import {
  createTankOperation,
  deleteTankOperation,
  getTankOperations,
  updateTankOperation,
} from '../api/tankOperationApi'

function TankOperationMaster({ locations, loggedInUser }) {
  const emptyTankOperation = {
    locationCode: '',
    operationCode: '',
    operationLabel: '',
    operationCategory: '',
    operationSign: '',
    sortOrder: 1,
    description: '',
    status: 'Active',
  }

  const operationCategories = [
    'OPENING',
    'RECEIPT',
    'PRODUCTION',
    'DISPATCH',
    'DRAINING',
    'CLOSING',
    'ADJUSTMENT',
  ]

  const operationSigns = ['SET', 'IN', 'OUT', 'NEUTRAL']

  const [tankOperations, setTankOperations] = useState([])
  const [tankOperation, setTankOperation] = useState(emptyTankOperation)
  const [selectedLocationCode, setSelectedLocationCode] = useState('')
  const [editId, setEditId] = useState(null)
  const [loading, setLoading] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [validationErrors, setValidationErrors] = useState({})
  const [confirmDeleteItem, setConfirmDeleteItem] = useState(null)

  const activeLocations = useMemo(() => {
    return (locations || []).filter((location) => location.status === 'Active')
  }, [locations])

  const isAdminBootstrap =
    String(loggedInUser?.username || '').toLowerCase() === 'admin'

  const hasPermission = (permissionName) =>
    Boolean(
      loggedInUser?.permissions?.some(
        (p) => p.permissionName === permissionName
      )
    )

  const canManageTankOperation = useMemo(() => {
    if (isAdminBootstrap) return true
    return hasPermission('Manage Tank Operation')
  }, [loggedInUser])

  const reloadTankOperations = async (locationCode = selectedLocationCode) => {
    try {
      setLoading(true)

      const filters = {}

      if (locationCode) {
        filters.locationCode = locationCode
      }

      const data = await getTankOperations(filters)
      setTankOperations(data)
    } catch (error) {
      setErrorMsg(error.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    reloadTankOperations('')
  }, [])

  const handleFilterLocationChange = async (e) => {
    const locationCode = e.target.value

    setSelectedLocationCode(locationCode)

    setTankOperation({
      ...tankOperation,
      locationCode,
    })

    await reloadTankOperations(locationCode)
  }

  const handleChange = (e) => {
    const { name, value } = e.target

    setTankOperation({
      ...tankOperation,
      [name]: value,
    })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSuccessMsg('')
    setErrorMsg('')
    setValidationErrors({})

    if (!canManageTankOperation) {
      setErrorMsg('You do not have permission to manage Tank Operations.')
      return
    }

    const errors = {}

    if (tankOperation.locationCode.trim() === '') {
      errors.locationCode = 'Location is required'
    }

    if (tankOperation.operationCode.trim() === '') {
      errors.operationCode = 'Operation Code is required'
    }

    if (tankOperation.operationLabel.trim() === '') {
      errors.operationLabel = 'Operation Label is required'
    }

    if (tankOperation.operationCategory.trim() === '') {
      errors.operationCategory = 'Operation Category is required'
    }

    if (tankOperation.operationSign.trim() === '') {
      errors.operationSign = 'Operation Sign is required'
    }

    setValidationErrors(errors)

    if (Object.keys(errors).length > 0) {
      return
    }

    try {
      setLoading(true)

      if (editId === null) {
        await createTankOperation(tankOperation)
        setSuccessMsg('Tank Operation saved successfully')
      } else {
        await updateTankOperation(editId, tankOperation)
        setSuccessMsg('Tank Operation updated successfully')
      }

      const locationToReload = selectedLocationCode || tankOperation.locationCode

      setTankOperation({
        ...emptyTankOperation,
        locationCode: selectedLocationCode,
      })
      setEditId(null)

      await reloadTankOperations(locationToReload)
    } catch (error) {
      setErrorMsg(error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleEdit = (item) => {
    setTankOperation({
      locationCode: item.locationCode,
      operationCode: item.operationCode,
      operationLabel: item.operationLabel,
      operationCategory: item.operationCategory,
      operationSign: item.operationSign,
      sortOrder: item.sortOrder,
      description: item.description,
      status: item.status,
    })

    setEditId(item.id)
  }

  const handleDelete = async () => {
    setSuccessMsg('')
    setErrorMsg('')

    if (!canManageTankOperation) {
      setErrorMsg('You do not have permission to manage Tank Operations.')
      setConfirmDeleteItem(null)
      return
    }

    try {
      setLoading(true)

      await deleteTankOperation(confirmDeleteItem.id)
      setSuccessMsg('Tank Operation deleted successfully')

      if (editId === confirmDeleteItem.id) {
        setTankOperation({
          ...emptyTankOperation,
          locationCode: selectedLocationCode,
        })
        setEditId(null)
      }

      setConfirmDeleteItem(null)
      await reloadTankOperations(selectedLocationCode)
    } catch (error) {
      setErrorMsg(error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleCancelEdit = () => {
    setTankOperation({
      ...emptyTankOperation,
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

  const getSignDescription = (operationSign) => {
    if (operationSign === 'SET') {
      return 'Sets declared stock balance'
    }

    if (operationSign === 'IN') {
      return 'Increases stock'
    }

    if (operationSign === 'OUT') {
      return 'Decreases stock'
    }

    if (operationSign === 'NEUTRAL') {
      return 'No stock movement'
    }

    return ''
  }

  return (
    <div>
      <div className="page-title">
        <div>
          <h2>Tank Operation Master</h2>
          <p>
            Configure location-wise tank operations for Tank Gauging and future
            stock ledger calculations.
          </p>
        </div>

        <span className="record-count">
          {tankOperations.length} Tank Operations
        </span>
      </div>

      {activeLocations.length === 0 && (
        <div className="info-box">
          Please create at least one Active Location before configuring Tank
          Operations.
        </div>
      )}

      {!canManageTankOperation && (
        <div className="info-box">
          You can view Tank Operations, but you do not have permission to create,
          update, or delete them.
        </div>
      )}

      {successMsg && (
        <div className="success-box">{successMsg}</div>
      )}

      {errorMsg && (
        <div className="error-box">{errorMsg}</div>
      )}

      {confirmDeleteItem && (
        <div className="confirm-overlay">
          <div className="confirm-box">
            <p>Are you sure you want to delete <strong>{confirmDeleteItem.operationLabel}</strong>?</p>
            <div className="confirm-actions">
              <button onClick={handleDelete} disabled={loading}>
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
            onClick={() => reloadTankOperations(selectedLocationCode)}
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
            value={tankOperation.locationCode}
            onChange={(e) => { handleChange(e); setValidationErrors({ ...validationErrors, locationCode: '' }) }}
            disabled={!canManageTankOperation || loading}
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
          <label>Operation Code</label>
          <input
            name="operationCode"
            type="text"
            value={tankOperation.operationCode}
            onChange={(e) => { handleChange(e); setValidationErrors({ ...validationErrors, operationCode: '' }) }}
            placeholder="Example: OPEN, RCPT, DSP"
            disabled={!canManageTankOperation || loading}
            className={validationErrors.operationCode ? 'input-error' : ''}
          />
          {validationErrors.operationCode && (
            <span className="field-error">{validationErrors.operationCode}</span>
          )}
        </div>

        <div>
          <label>Operation Label</label>
          <input
            name="operationLabel"
            type="text"
            value={tankOperation.operationLabel}
            onChange={(e) => { handleChange(e); setValidationErrors({ ...validationErrors, operationLabel: '' }) }}
            placeholder="Example: Opening Stock"
            disabled={!canManageTankOperation || loading}
            className={validationErrors.operationLabel ? 'input-error' : ''}
          />
          {validationErrors.operationLabel && (
            <span className="field-error">{validationErrors.operationLabel}</span>
          )}
        </div>

        <div>
          <label>Operation Category</label>
          <select
            name="operationCategory"
            value={tankOperation.operationCategory}
            onChange={(e) => { handleChange(e); setValidationErrors({ ...validationErrors, operationCategory: '' }) }}
            disabled={!canManageTankOperation || loading}
            className={validationErrors.operationCategory ? 'input-error' : ''}
          >
            <option value="">Select Category</option>

            {operationCategories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
          {validationErrors.operationCategory && (
            <span className="field-error">{validationErrors.operationCategory}</span>
          )}
        </div>

        <div>
          <label>Operation Sign</label>
          <select
            name="operationSign"
            value={tankOperation.operationSign}
            onChange={(e) => { handleChange(e); setValidationErrors({ ...validationErrors, operationSign: '' }) }}
            disabled={!canManageTankOperation || loading}
            className={validationErrors.operationSign ? 'input-error' : ''}
          >
            <option value="">Select Sign</option>

            {operationSigns.map((sign) => (
              <option key={sign} value={sign}>
                {sign} {getSignDescription(sign) ? `- ${getSignDescription(sign)}` : ''}
              </option>
            ))}
          </select>
          {validationErrors.operationSign && (
            <span className="field-error">{validationErrors.operationSign}</span>
          )}
        </div>

        <div>
          <label>Sort Order</label>
          <input
            name="sortOrder"
            type="number"
            value={tankOperation.sortOrder}
            onChange={handleChange}
            min="1"
            disabled={!canManageTankOperation || loading}
          />
        </div>

        <div>
          <label>Status</label>
          <select
            name="status"
            value={tankOperation.status}
            onChange={handleChange}
            disabled={!canManageTankOperation || loading}
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
            value={tankOperation.description}
            onChange={handleChange}
            placeholder="Enter description"
            rows="3"
            disabled={!canManageTankOperation || loading}
          />
        </div>

        <div className="form-actions">
          <button
            type="submit"
            disabled={!canManageTankOperation || loading}
          >
            {loading
              ? 'Please wait...'
              : editId === null
                ? 'Save Operation'
                : 'Update Operation'}
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
        <h3>Saved Tank Operations</h3>
        <p>
          These operations will later appear as a dropdown inside Tank Gauging
          Entry, filtered by location.
        </p>
      </div>

      <table>
        <thead>
          <tr>
            <th>Location</th>
            <th>Code</th>
            <th>Label</th>
            <th>Category</th>
            <th>Sign</th>
            <th>Sort</th>
            <th>Description</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>

        <tbody>
          {tankOperations.length === 0 ? (
            <tr>
              <td colSpan="9" className="empty-table">
                No Tank Operations found.
              </td>
            </tr>
          ) : (
            tankOperations.map((item) => (
              <tr key={item.id}>
                <td>{getLocationDisplay(item.locationCode)}</td>
                <td>{item.operationCode}</td>
                <td>{item.operationLabel}</td>
                <td>
                  <span className="permission-badge">
                    {item.operationCategory}
                  </span>
                </td>
                <td>
                  <span className="permission-badge">
                    {item.operationSign}
                  </span>
                  <div className="muted-table-text">
                    {getSignDescription(item.operationSign)}
                  </div>
                </td>
                <td>{item.sortOrder}</td>
                <td>{item.description}</td>
                <td>
                  <span className={`status-badge ${item.status.toLowerCase()}`}>
                    {item.status}
                  </span>
                </td>
                <td>
                  <button
                    type="button"
                    onClick={() => handleEdit(item)}
                    disabled={loading || !canManageTankOperation}
                  >
                    Edit
                  </button>

                  <button
                    type="button"
                    onClick={() => { setSuccessMsg(''); setErrorMsg(''); setConfirmDeleteItem(item) }}
                    disabled={loading || !canManageTankOperation}
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
        Stock logic rule: SET declares a stock balance, IN increases stock, OUT
        decreases stock, and NEUTRAL does not affect stock. These mappings will
        be used later by the Tank Stock Ledger.
      </div>
    </div>
  )
}

export default TankOperationMaster