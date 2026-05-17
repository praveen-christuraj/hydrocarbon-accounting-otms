import { useState } from 'react'
import {
  createOperationType,
  deleteOperationType,
  updateOperationType,
} from '../api/operationTypeApi'

function OperationTypeMaster({
  assetTypes,
  operationTypes,
  reloadOperationTypes,
}) {
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

  const activeAssetTypes = assetTypes.filter((item) => item.status === 'Active')

  const handleChange = (e) => {
    setOperationType({
      ...operationType,
      [e.target.name]: e.target.value,
    })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()

    if (operationType.operationTypeName.trim() === '') {
      alert('Operation Type Name is required')
      return
    }

    if (operationType.operationTypeCode.trim() === '') {
      alert('Operation Type Code is required')
      return
    }

    if (operationType.applicableAssetTypeCode.trim() === '') {
      alert('Applicable Asset Type is required')
      return
    }

    if (operationType.operationCategory.trim() === '') {
      alert('Operation Category is required')
      return
    }

    const duplicateCode = operationTypes.some((item) => {
      return (
        item.operationTypeCode.toLowerCase() ===
          operationType.operationTypeCode.toLowerCase() &&
        item.id !== editId
      )
    })

    if (duplicateCode) {
      alert('Operation Type Code already exists. Please choose another code.')
      return
    }

    try {
      setLoading(true)

      if (editId === null) {
        await createOperationType(operationType)
        alert('Operation Type saved successfully')
      } else {
        await updateOperationType(editId, operationType)
        alert('Operation Type updated successfully')
      }

      await reloadOperationTypes()
      setOperationType(emptyOperationType)
      setEditId(null)
    } catch (error) {
      alert(error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleEdit = (item) => {
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

  const handleDelete = async (operationTypeId) => {
    const confirmDelete = window.confirm(
      'Are you sure you want to delete this operation type?'
    )

    if (confirmDelete === false) {
      return
    }

    try {
      setLoading(true)

      await deleteOperationType(operationTypeId)
      await reloadOperationTypes()

      if (editId === operationTypeId) {
        setOperationType(emptyOperationType)
        setEditId(null)
      }

      alert('Operation Type deleted successfully')
    } catch (error) {
      alert(error.message)
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

      <form onSubmit={handleSubmit}>
        <div>
          <label>Operation Type Name</label>
          <input
            name="operationTypeName"
            type="text"
            value={operationType.operationTypeName}
            onChange={handleChange}
            placeholder="Example: Tank Operations"
          />
        </div>

        <div>
          <label>Operation Type Code</label>
          <input
            name="operationTypeCode"
            type="text"
            value={operationType.operationTypeCode}
            onChange={handleChange}
            placeholder="Example: TANK_OPS"
          />
        </div>

        <div>
          <label>Applicable Asset Type</label>
          <select
            name="applicableAssetTypeCode"
            value={operationType.applicableAssetTypeCode}
            onChange={handleChange}
          >
            <option value="">Select Asset Type</option>

            {activeAssetTypes.map((assetType) => (
              <option key={assetType.id} value={assetType.assetTypeCode}>
                {assetType.assetTypeName} ({assetType.assetTypeCode})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label>Operation Category</label>
          <select
            name="operationCategory"
            value={operationType.operationCategory}
            onChange={handleChange}
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
        </div>

        <div>
          <label>Requires Sender Location</label>
          <select
            name="requiresSenderLocation"
            value={operationType.requiresSenderLocation}
            onChange={handleChange}
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
          />
        </div>

        <div className="form-actions">
          <button type="submit" disabled={loading}>
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
        Example: If Asset Type is Barge and Operation Type is Barge Operations,
        any location having a Barge asset can later perform Barge Operations.
      </div>
    </div>
  )
}

export default OperationTypeMaster