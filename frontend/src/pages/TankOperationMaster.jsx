import { useEffect, useMemo, useState } from 'react'
import {
  createTankOperation,
  deleteTankOperation,
  getTankOperations,
  updateTankOperation,
} from '../api/tankOperationApi'
import PaginationControls, { paginateRows, usePageSize } from '../components/common/PaginationControls'
import DataTableToolbar from '../components/common/DataTableToolbar'
import { useDataFilters } from '../hooks/useDataFilters'
import { useAutoColumns } from '../hooks/useAutoColumns'
import AlertMessage from '../components/common/AlertMessage'
import FormDialog from '../components/common/FormDialog'
import Icon from '../components/common/Icon'
import { usePermissions } from '../hooks/usePermissions'
import { logUiAction } from '../utils/actionLogger'

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
  const [page, setPage] = useState(1)

  const pageSize = usePageSize()
  const tankOperationsFilters = useDataFilters(tankOperations, useAutoColumns(tankOperations), { module: 'Tank Operation Master' })
  const visibleTankOperations = paginateRows(tankOperationsFilters.filteredRows, page, pageSize)

  const activeLocations = useMemo(() => {
    return (locations || []).filter((location) => location.status === 'Active')
  }, [locations])

  const { hasPermission } = usePermissions(loggedInUser)
  const canCreate = hasPermission('Create Tank Operation')
  const canEdit = hasPermission('Edit Tank Operation')
  const canDelete = hasPermission('Delete Tank Operation')
  const [formOpen, setFormOpen] = useState(false)
  const canManageTankOperation = editId === null ? canCreate : canEdit

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
      setFormOpen(false)

      await reloadTankOperations(locationToReload)
    } catch (error) {
      setErrorMsg(error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleEdit = (item) => {
    if (!canEdit) {
      setErrorMsg('You do not have permission to edit Tank Operations.')
      return
    }
    setSuccessMsg('')
    setErrorMsg('')
    setValidationErrors({})
    setFormOpen(true)
    logUiAction('Tank Operation Master', 'Open Edit Dialog', { operationCode: item.operationCode })
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

    if (!canDelete) {
      setErrorMsg('You do not have permission to delete Tank Operations.')
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

  /* -------------------------------------------------------- bulk upload */

  const TANK_OPERATION_STATUSES = ['Active', 'Inactive', 'Blocked']

  const importConfig = {
    title: 'Bulk upload tank operations',
    description:
      'Upload an Excel (.xlsx) or CSV file. Location codes must already exist. Operations are matched on Location + Operation Code and updated when they already exist.',
    templateFileName: 'tank-operation-master',
    fields: [
      { key: 'locationCode', label: 'Location Code', required: true, example: 'UTP', aliases: ['Location'] },
      { key: 'operationCode', label: 'Operation Code', required: true, example: 'OPENING', aliases: ['Code'] },
      { key: 'operationLabel', label: 'Operation Label', required: true, example: 'Opening Stock' },
      {
        key: 'operationCategory',
        label: 'Operation Category',
        required: true,
        options: operationCategories,
        example: 'OPENING',
      },
      { key: 'operationSign', label: 'Operation Sign', required: true, options: operationSigns, example: 'SET' },
      { key: 'sortOrder', label: 'Sort Order', example: '1', hint: 'Whole number' },
      { key: 'description', label: 'Description', example: '' },
      { key: 'status', label: 'Status', options: TANK_OPERATION_STATUSES, defaultValue: 'Active', example: 'Active' },
    ],
    validateRow: (record) => {
      const location = locations.find(
        (item) => String(item.locationCode).toLowerCase() === String(record.locationCode).trim().toLowerCase()
      )
      if (!location || location.status !== 'Active') {
        return `Unknown or inactive location code "${record.locationCode}"`
      }
      if (!operationCategories.includes(String(record.operationCategory).trim().toUpperCase())) {
        return `Operation Category must be one of ${operationCategories.join(', ')}`
      }
      if (!operationSigns.includes(String(record.operationSign).trim().toUpperCase())) {
        return `Operation Sign must be one of ${operationSigns.join(', ')}`
      }
      if (record.sortOrder && !Number.isFinite(Number(record.sortOrder))) {
        return 'Sort Order must be a number'
      }
      if (record.status && !TANK_OPERATION_STATUSES.includes(record.status)) {
        return `Status must be one of ${TANK_OPERATION_STATUSES.join(', ')}`
      }
      return null
    },
    onImportRow: async (record) => {
      const payload = {
        ...emptyTankOperation,
        ...record,
        locationCode: String(record.locationCode).trim(),
        operationCode: String(record.operationCode).trim().toUpperCase(),
        operationCategory: String(record.operationCategory).trim().toUpperCase(),
        operationSign: String(record.operationSign).trim().toUpperCase(),
        sortOrder: record.sortOrder === '' || record.sortOrder === undefined ? 1 : Number(record.sortOrder),
        status: record.status || 'Active',
      }
      const existing = tankOperations.find(
        (item) =>
          String(item.locationCode).toLowerCase() === payload.locationCode.toLowerCase() &&
          String(item.operationCode).toLowerCase() === payload.operationCode.toLowerCase()
      )
      if (existing) {
        await updateTankOperation(existing.id, payload)
      } else {
        await createTankOperation(payload)
      }
    },
    onComplete: async () => {
      await reloadTankOperations('')
    },
  }

  const handleCancelEdit = () => {
    setTankOperation({
      ...emptyTankOperation,
      locationCode: selectedLocationCode,
    })
    setEditId(null)
    setValidationErrors({})
    setErrorMsg('')
    setFormOpen(false)
  }

  const openCreate = () => {
    handleCancelEdit()
    setSuccessMsg('')
    setFormOpen(true)
    logUiAction('Tank Operation Master', 'Open Create Dialog')
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

        <div className="page-title-actions">
          {canCreate && (<button type="button" className="btn-primary" onClick={openCreate}><Icon name="plus" size={15} />New Tank Operation</button>)}
          <span className="record-count">
          {tankOperations.length} Tank Operations
        </span>
        </div>
      </div>

      {activeLocations.length === 0 && (
        <div className="info-box">
          Please create at least one Active Location before configuring Tank
          Operations.
        </div>
      )}

      {!formOpen && <AlertMessage tone="success" message={successMsg} onDismiss={() => setSuccessMsg('')} />}
      {!formOpen && <AlertMessage tone="error" message={errorMsg} onDismiss={() => setErrorMsg('')} />}

      {!canCreate && !canEdit && !canDelete && (
        <div className="info-box">You have view-only access to Tank Operation Master.</div>
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

      <FormDialog
        open={formOpen}
        title={editId === null ? 'New Tank Operation' : 'Edit Tank Operation'}
        description="Operations appear in Tank Gauging Entry, filtered by location. SET declares a balance, IN adds, OUT reduces, NEUTRAL has no stock effect."
        size="lg"
        columns={3}
        submitLabel={editId === null ? 'Save Tank Operation' : 'Update Tank Operation'}
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
      </FormDialog>

      <div className="section-title">
        <h3>Saved Tank Operations</h3>
        <p>
          These operations will later appear as a dropdown inside Tank Gauging
          Entry, filtered by location.
        </p>
      </div>

      <DataTableToolbar
        filters={tankOperationsFilters}
        columns={tankOperationsFilters.columns}
        exportFileName="tank-operation-master"
        exportTitle="Tank Operation Master"
        module="Tank Operation Master"
        importConfig={importConfig}
        canImport={canCreate}
      />

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
            {(canEdit || canDelete) && <th>Actions</th>}
          </tr>
        </thead>

        <tbody>
          {tankOperations.length === 0 ? (
            <tr>
              <td colSpan={canEdit || canDelete ? 9 : 8} className="empty-table">
                No Tank Operations found.
              </td>
            </tr>
          ) : (
            visibleTankOperations.map((item) => (
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

      <PaginationControls currentPage={page} totalRows={tankOperationsFilters.filteredRows.length} onPageChange={setPage} />

    </div>
  )
}

export default TankOperationMaster