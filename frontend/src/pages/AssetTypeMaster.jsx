import { useState } from 'react'
import {
  createAssetType,
  deleteAssetType,
  updateAssetType,
} from '../api/assetTypeApi'

function AssetTypeMaster({ assetTypes, reloadAssetTypes, loggedInUser }) {
  const emptyAssetType = {
    assetTypeName: '',
    assetTypeCode: '',
    description: '',
    status: 'Active',
  }

  const [assetType, setAssetType] = useState(emptyAssetType)
  const [editId, setEditId] = useState(null)
  const [loading, setLoading] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [validationErrors, setValidationErrors] = useState({})
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)

  const isAdminBootstrap =
    String(loggedInUser?.username || '').toLowerCase() === 'admin'

  const hasPermission = (permissionName) => {
    if (isAdminBootstrap) return true
    if (!loggedInUser || !Array.isArray(loggedInUser.permissions)) return false
    return loggedInUser.permissions.some(
      (p) => p.permissionName === permissionName
    )
  }

  const canManageAssetType = hasPermission('Manage Asset Type')

  const handleChange = (e) => {
    setAssetType({
      ...assetType,
      [e.target.name]: e.target.value,
    })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSuccessMsg('')
    setErrorMsg('')
    setValidationErrors({})

    if (!canManageAssetType) {
      setErrorMsg('You do not have permission to manage asset types.')
      return
    }

    const errors = {}

    if (assetType.assetTypeName.trim() === '') {
      errors.assetTypeName = 'Asset Type Name is required'
    }

    if (assetType.assetTypeCode.trim() === '') {
      errors.assetTypeCode = 'Asset Type Code is required'
    }

    if (!errors.assetTypeCode) {
      const assetTypeCodeAlreadyExists = assetTypes.some((item) => {
        return (
          item.assetTypeCode.toLowerCase() ===
            assetType.assetTypeCode.toLowerCase() &&
          item.id !== editId
        )
      })

      if (assetTypeCodeAlreadyExists) {
        errors.assetTypeCode = 'Asset Type Code already exists. Please choose another code.'
      }
    }

    setValidationErrors(errors)

    if (Object.keys(errors).length > 0) {
      return
    }

    try {
      setLoading(true)

      if (editId === null) {
        await createAssetType(assetType)
        setSuccessMsg('Asset Type saved successfully')
      } else {
        await updateAssetType(editId, assetType)
        setSuccessMsg('Asset Type updated successfully')
      }

      await reloadAssetTypes()
      setAssetType(emptyAssetType)
      setEditId(null)
    } catch (error) {
      setErrorMsg(error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleEdit = (assetTypeToEdit) => {
    setSuccessMsg('')
    setErrorMsg('')
    setValidationErrors({})

    if (!canManageAssetType) {
      setErrorMsg('You do not have permission to manage asset types.')
      return
    }

    setAssetType({
      assetTypeName: assetTypeToEdit.assetTypeName,
      assetTypeCode: assetTypeToEdit.assetTypeCode,
      description: assetTypeToEdit.description,
      status: assetTypeToEdit.status,
    })

    setEditId(assetTypeToEdit.id)
  }

  const handleDelete = async () => {
    setSuccessMsg('')
    setErrorMsg('')

    if (!canManageAssetType) {
      setErrorMsg('You do not have permission to manage asset types.')
      setConfirmDeleteId(null)
      return
    }

    try {
      setLoading(true)

      await deleteAssetType(confirmDeleteId)
      await reloadAssetTypes()

      if (editId === confirmDeleteId) {
        setAssetType(emptyAssetType)
        setEditId(null)
      }

      setConfirmDeleteId(null)
      setSuccessMsg('Asset Type deleted successfully')
    } catch (error) {
      setErrorMsg(error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleCancelEdit = () => {
    setAssetType(emptyAssetType)
    setEditId(null)
  }

  return (
    <div>
      <div className="page-title">
        <div>
          <h2>Asset Type Master</h2>
          <p>Create, update, and manage asset categories.</p>
        </div>

        <span className="record-count">{assetTypes.length} Asset Types</span>
      </div>

      {successMsg && (
        <div className="success-box">{successMsg}</div>
      )}

      {errorMsg && (
        <div className="error-box">{errorMsg}</div>
      )}

      {!canManageAssetType && (
        <div className="info-box">
          You are in view-only mode. Admin can manage asset types.
        </div>
      )}

      {confirmDeleteId && (
        <div className="confirm-overlay">
          <div className="confirm-box">
            <p>Are you sure you want to delete this asset type?</p>
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

      {canManageAssetType && (
      <form onSubmit={handleSubmit}>
        <div>
          <label>Asset Type Name</label>
          <input
            name="assetTypeName"
            type="text"
            value={assetType.assetTypeName}
            onChange={(e) => { handleChange(e); setValidationErrors({ ...validationErrors, assetTypeName: '' }) }}
            placeholder="Example: Metering Skid"
            className={validationErrors.assetTypeName ? 'input-error' : ''}
          />
          {validationErrors.assetTypeName && (
            <span className="field-error">{validationErrors.assetTypeName}</span>
          )}
        </div>

        <div>
          <label>Asset Type Code</label>
          <input
            name="assetTypeCode"
            type="text"
            value={assetType.assetTypeCode}
            onChange={(e) => { handleChange(e); setValidationErrors({ ...validationErrors, assetTypeCode: '' }) }}
            placeholder="Example: MSKID"
            className={validationErrors.assetTypeCode ? 'input-error' : ''}
          />
          {validationErrors.assetTypeCode && (
            <span className="field-error">{validationErrors.assetTypeCode}</span>
          )}
        </div>

        <div>
          <label>Status</label>
          <select
            name="status"
            value={assetType.status}
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
            value={assetType.description}
            onChange={handleChange}
            placeholder="Enter asset type description"
            rows="3"
          />
        </div>

        <div className="form-actions">
          <button type="submit" disabled={loading}>
            {loading
              ? 'Please wait...'
              : editId === null
                ? 'Save Asset Type'
                : 'Update Asset Type'}
          </button>

          {editId !== null && (
            <button type="button" onClick={handleCancelEdit} disabled={loading}>
              Cancel Edit
            </button>
          )}
        </div>
      </form>
      )}

      <div className="section-title">
        <h3>Saved Asset Types</h3>
        <p>Asset types are now saved permanently in PostgreSQL.</p>
      </div>

      <table>
        <thead>
          <tr>
            <th>Asset Type Name</th>
            <th>Asset Type Code</th>
            <th>Description</th>
            <th>Status</th>
            {canManageAssetType && <th>Actions</th>}
          </tr>
        </thead>

        <tbody>
          {assetTypes.length === 0 ? (
            <tr>
              <td colSpan={canManageAssetType ? 5 : 4} className="empty-table">
                No asset types added yet.
              </td>
            </tr>
          ) : (
            assetTypes.map((item) => (
              <tr key={item.id}>
                <td>{item.assetTypeName}</td>
                <td>{item.assetTypeCode}</td>
                <td>{item.description}</td>
                <td>
                  <span className={`status-badge ${item.status.toLowerCase()}`}>
                    {item.status}
                  </span>
                </td>
                {canManageAssetType && (
                <td>
                  <button type="button" onClick={() => handleEdit(item)}>
                    Edit
                  </button>

                  <button type="button" onClick={() => { setSuccessMsg(''); setErrorMsg(''); setConfirmDeleteId(item.id) }}>
                    Delete
                  </button>
                </td>
                )}
              </tr>
            ))
          )}
        </tbody>
      </table>

      <div className="info-box">
        Asset Type Code must be unique. Example: MSKID for Metering Skid.
      </div>
    </div>
  )
}

export default AssetTypeMaster