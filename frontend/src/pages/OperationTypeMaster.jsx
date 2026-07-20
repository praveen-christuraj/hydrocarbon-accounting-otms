import { useMemo, useState } from 'react'
import {
  createOperationType,
  deleteOperationType,
  updateOperationType,
} from '../api/operationTypeApi'

function OperationTypeMaster({
  assetTypes,
  operationTypes,
  reloadOperationTypes,
  loggedInUser,
}) {
  const isAdminBootstrap =
    String(loggedInUser?.username || '').toLowerCase() === 'admin'

  const hasPermission = (permissionName) =>
    Boolean(
      loggedInUser?.permissions?.some(
        (p) => p.permissionName === permissionName
      )
    )

  const canManageOperationType = useMemo(() => {
    if (isAdminBootstrap) return true
    return hasPermission('Manage Operation Type')
  }, [loggedInUser])
  const emptyOperationType = {
    operationTypeName: '',
    operationTypeCode: '',
    applicableAssetTypeCode: '',
    operationCategory: '',
    requiresSenderLocation: 'No',
    requiresReceiverLocation: 'No',
    requiresComparison: 'No',
    requiresApproval: 'No',
    description: '',
    status: 'Active',
  }

  const [operationType, setOperationType] = useState(emptyOperationType)
  const [editId, setEditId] = useState(null)
  const [loading, setLoading] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [validationErrors, setValidationErrors] = useState({})
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)

  const activeAssetTypes = assetTypes.filter((item) => item.status === 'Active')

  const handleChange = (e) => {
    setOperationType({
      ...operationType,
      [e.target.name]: e.target.value,
    })
    setValidationErrors({ ...validationErrors, [e.target.name]: '' })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!canManageOperationType) {
      setErrorMsg('You do not have permission to manage operation types')
      return
    }
    setSuccessMsg('')
    setErrorMsg('')
    setValidationErrors({})

    const errors = {}

    if (operationType.operationTypeName.trim() === '') {
      errors.operationTypeName = 'Operation Type Name is required'
    }

    if (operationType.operationTypeCode.trim() === '') {
      errors.operationTypeCode = 'Operation Type Code is required'
    }

    if (operationType.applicableAssetTypeCode.trim() === '') {
      errors.applicableAssetTypeCode = 'Applicable Asset Type is required'
    }

    if (operationType.operationCategory.trim() === '') {
      errors.operationCategory = 'Operation Category is required'
    }

    if (!errors.operationTypeCode) {
      const duplicateCode = operationTypes.some((item) => {
        return (
          item.operationTypeCode.toLowerCase() ===
            operationType.operationTypeCode.toLowerCase() &&
          item.id !== editId
        )
      })

      if (duplicateCode) {
        errors.operationTypeCode = 'Operation Type Code already exists. Please choose another code.'
      }
    }

    setValidationErrors(errors)

    if (Object.keys(errors).length > 0) {
      return
    }

    try {
      setLoading(true)

      if (editId === null) {
        await createOperationType(operationType)
        setSuccessMsg('Operation Type saved successfully')
      } else {
        await updateOperationType(editId, operationType)
        setSuccessMsg('Operation Type updated successfully')
      }

      await reloadOperationTypes()
      setOperationType(emptyOperationType)
      setEditId(null)
    } catch (error) {
      setErrorMsg(error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleEdit = (item) => {
    if (!canManageOperationType) {
      setErrorMsg('You do not have permission to manage operation types')
      return
    }
    setOperationType({
      operationTypeName: item.operationTypeName,
      operationTypeCode: item.operationTypeCode,
      applicableAssetTypeCode: item.applicableAssetTypeCode,
      operationCategory: item.operationCategory,
      requiresSenderLocation: item.requiresSenderLocation,
      requiresReceiverLocation: item.requiresReceiverLocation,
      requiresComparison: item.requiresComparison,
      requiresApproval: item.requiresApproval,
      description: item.description,
      status: item.status,
    })

    setEditId(item.id)
  }

  const handleDelete = async () => {
    if (!canManageOperationType) {
      setErrorMsg('You do not have permission to manage operation types')
      setConfirmDeleteId(null)
      return
    }
    setSuccessMsg('')
    setErrorMsg('')

    try {
      setLoading(true)

      await deleteOperationType(confirmDeleteId)
      await reloadOperationTypes()

      if (editId === confirmDeleteId) {
        setOperationType(emptyOperationType)
        setEditId(null)
      }

      setConfirmDeleteId(null)
      setSuccessMsg('Operation Type deleted successfully')
    } catch (error) {
      setErrorMsg(error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleCancelEdit = () => {
    setOperationType(emptyOperationType)
    setEditId(null)
  }

  const getAssetTypeName = (assetTypeCode) => {
    const assetType = assetTypes.find(
      (item) => item.assetTypeCode === assetTypeCode
    )

    if (!assetType) {
      return ''
    }

    return assetType.assetTypeName
  }

  return (
    <div>
      <div className="page-title">
        <div>
          <h2>Operation Type Master</h2>
          <p>
            Define which operation types are applicable for each asset type.
          </p>
        </div>

        <span className="record-count">
          {operationTypes.length} Operation Types
        </span>
      </div>

      {activeAssetTypes.length === 0 && (
        <div className="info-box">
          Please create at least one active Asset Type before creating operation
          types.
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
            <p>Are you sure you want to delete this operation type?</p>
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

      <form onSubmit={handleSubmit}>
        <div>
          <label>Operation Type Name</label>
          <input
            name="operationTypeName"
            type="text"
            value={operationType.operationTypeName}
            onChange={handleChange}
            placeholder="Example: Tank Operations"
            disabled={!canManageOperationType}
            className={validationErrors.operationTypeName ? 'input-error' : ''}
          />
          {validationErrors.operationTypeName && (
            <span className="field-error">{validationErrors.operationTypeName}</span>
          )}
        </div>

        <div>
          <label>Operation Type Code</label>
          <input
            name="operationTypeCode"
            type="text"
            value={operationType.operationTypeCode}
            onChange={handleChange}
            placeholder="Example: TANK_OPS"
            disabled={!canManageOperationType}
            className={validationErrors.operationTypeCode ? 'input-error' : ''}
          />
          {validationErrors.operationTypeCode && (
            <span className="field-error">{validationErrors.operationTypeCode}</span>
          )}
        </div>

        <div>
          <label>Applicable Asset Type</label>
          <select
            name="applicableAssetTypeCode"
            value={operationType.applicableAssetTypeCode}
            onChange={handleChange}
            disabled={!canManageOperationType}
            className={validationErrors.applicableAssetTypeCode ? 'input-error' : ''}
          >
            <option value="">Select Asset Type</option>

            {activeAssetTypes.map((assetType) => (
              <option key={assetType.id} value={assetType.assetTypeCode}>
                {assetType.assetTypeName} ({assetType.assetTypeCode})
              </option>
            ))}
          </select>
          {validationErrors.applicableAssetTypeCode && (
            <span className="field-error">{validationErrors.applicableAssetTypeCode}</span>
          )}
        </div>

        <div>
          <label>Operation Category</label>
          <select
            name="operationCategory"
            value={operationType.operationCategory}
            onChange={handleChange}
            disabled={!canManageOperationType}
            className={validationErrors.operationCategory ? 'input-error' : ''}
          >
            <option value="">Select Category</option>
            <option>Storage</option>
            <option>Transfer</option>
            <option>Loading</option>
            <option>Discharge</option>
            <option>Movement</option>
            <option>Metering</option>
            <option>Reconciliation</option>
            <option>Other</option>
          </select>
          {validationErrors.operationCategory && (
            <span className="field-error">{validationErrors.operationCategory}</span>
          )}
        </div>

        <div>
          <label>Requires Sender Location</label>
          <select
            name="requiresSenderLocation"
            value={operationType.requiresSenderLocation}
            onChange={handleChange}
            disabled={!canManageOperationType}
          >
            <option>Yes</option>
            <option>No</option>
          </select>
        </div>

        <div>
          <label>Requires Receiver Location</label>
          <select
            name="requiresReceiverLocation"
            value={operationType.requiresReceiverLocation}
            onChange={handleChange}
            disabled={!canManageOperationType}
          >
            <option>Yes</option>
            <option>No</option>
          </select>
        </div>

        <div>
          <label>Requires Comparison</label>
          <select
            name="requiresComparison"
            value={operationType.requiresComparison}
            onChange={handleChange}
            disabled={!canManageOperationType}
          >
            <option>Yes</option>
            <option>No</option>
          </select>
        </div>

        <div>
          <label>Requires Approval</label>
          <select
            name="requiresApproval"
            value={operationType.requiresApproval}
            onChange={handleChange}
            disabled={!canManageOperationType}
          >
            <option>Yes</option>
            <option>No</option>
          </select>
        </div>

        <div>
          <label>Status</label>
          <select
            name="status"
            value={operationType.status}
            onChange={handleChange}
            disabled={!canManageOperationType}
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
            value={operationType.description}
            onChange={handleChange}
            placeholder="Enter operation type description"
            rows="3"
            disabled={!canManageOperationType}
          />
        </div>

        <div className="form-actions">
          <button type="submit" disabled={loading || !canManageOperationType}>
            {loading
              ? 'Please wait...'
              : editId === null
                ? 'Save Operation Type'
                : 'Update Operation Type'}
          </button>

          {editId !== null && (
            <button type="button" onClick={handleCancelEdit} disabled={loading}>
              Cancel Edit
            </button>
          )}
        </div>
      </form>

      {!canManageOperationType && (
        <div className="info-box">
          You have view-only access. Assign <strong>Manage Operation Type</strong> to create, edit, or delete operation types.
        </div>
      )}

      <div className="section-title">
        <h3>Saved Operation Types</h3>
        <p>
          These operation types will control which operations are available for
          assets and locations.
        </p>
      </div>

      <table>
        <thead>
          <tr>
            <th>Operation Type</th>
            <th>Code</th>
            <th>Asset Type</th>
            <th>Category</th>
            <th>Sender</th>
            <th>Receiver</th>
            <th>Comparison</th>
            <th>Approval</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>

        <tbody>
          {operationTypes.length === 0 ? (
            <tr>
              <td colSpan="10" className="empty-table">
                No operation types added yet.
              </td>
            </tr>
          ) : (
            operationTypes.map((item) => (
              <tr key={item.id}>
                <td>{item.operationTypeName}</td>
                <td>{item.operationTypeCode}</td>
                <td>
                  {getAssetTypeName(item.applicableAssetTypeCode)} (
                  {item.applicableAssetTypeCode})
                </td>
                <td>{item.operationCategory}</td>
                <td>{item.requiresSenderLocation}</td>
                <td>{item.requiresReceiverLocation}</td>
                <td>{item.requiresComparison}</td>
                <td>{item.requiresApproval}</td>
                <td>
                  <span className={`status-badge ${item.status.toLowerCase()}`}>
                    {item.status}
                  </span>
                </td>
                <td>
                  <button type="button" onClick={() => handleEdit(item)} disabled={!canManageOperationType}>
                    Edit
                  </button>

                  <button type="button" onClick={() => { setSuccessMsg(''); setErrorMsg(''); setConfirmDeleteId(item.id) }} disabled={!canManageOperationType}>
                    Delete
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <div className="info-box">
        Example: If Asset Type is Barge and Operation Type is Barge Operations,
        any location having a Barge asset can later perform Barge Operations.
      </div>
    </div>
  )
}

export default OperationTypeMaster