import { useState } from 'react'
import {
  createAsset,
  deleteAsset,
  updateAsset,
} from '../api/assetApi'

function AssetMaster({ assets, reloadAssets, assetTypes, locations, loggedInUser }) {
  const emptyAsset = {
    assetName: '',
    assetCode: '',
    assetScope: '',
    assetTypeCode: '',
    locationCode: '',
    serialNumber: '',
    manufacturer: '',
    model: '',
    commissionDate: '',
    description: '',
    status: 'Active',
  }

  const [asset, setAsset] = useState(emptyAsset)
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

  const canManageAsset = hasPermission('Manage Asset')

  const activeAssetTypes = assetTypes.filter((item) => item.status === 'Active')
  const activeLocations = locations.filter((item) => item.status === 'Active')

  const handleChange = (e) => {
    const { name, value } = e.target

    if (name === 'assetScope' && value === 'Global') {
      setAsset({
        ...asset,
        assetScope: value,
        locationCode: '',
      })
      return
    }

    setAsset({
      ...asset,
      [name]: value,
    })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSuccessMsg('')
    setErrorMsg('')
    setValidationErrors({})

    const errors = {}

    if (asset.assetName.trim() === '') {
      errors.assetName = 'Asset Name is required'
    }

    if (asset.assetCode.trim() === '') {
      errors.assetCode = 'Asset Code is required'
    }

    if (asset.assetScope.trim() === '') {
      errors.assetScope = 'Asset Scope is required'
    }

    if (asset.assetTypeCode.trim() === '') {
      errors.assetTypeCode = 'Asset Type is required'
    }

    if (asset.assetScope === 'Local' && asset.locationCode.trim() === '') {
      errors.locationCode = 'Location is required for Local Assets'
    }

    if (!errors.assetCode) {
      const assetCodeAlreadyExists = assets.some((item) => {
        return (
          item.assetCode.toLowerCase() === asset.assetCode.toLowerCase() &&
          item.id !== editId
        )
      })

      if (assetCodeAlreadyExists) {
        errors.assetCode = 'Asset Code already exists. Please choose another code.'
      }
    }

    setValidationErrors(errors)

    if (Object.keys(errors).length > 0) {
      return
    }

    if (!canManageAsset) {
      setErrorMsg('You do not have permission to manage assets.')
      return
    }

    try {
      setLoading(true)

      if (editId === null) {
        await createAsset(asset)
        setSuccessMsg('Asset saved successfully')
      } else {
        await updateAsset(editId, asset)
        setSuccessMsg('Asset updated successfully')
      }

      await reloadAssets()
      setAsset(emptyAsset)
      setEditId(null)
    } catch (error) {
      setErrorMsg(error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleEdit = (assetToEdit) => {
    setSuccessMsg('')
    setErrorMsg('')
    setValidationErrors({})

    if (!canManageAsset) {
      setErrorMsg('You do not have permission to manage assets.')
      return
    }

    setAsset({
      assetName: assetToEdit.assetName,
      assetCode: assetToEdit.assetCode,
      assetScope: assetToEdit.assetScope,
      assetTypeCode: assetToEdit.assetTypeCode,
      locationCode: assetToEdit.locationCode,
      serialNumber: assetToEdit.serialNumber,
      manufacturer: assetToEdit.manufacturer,
      model: assetToEdit.model,
      commissionDate: assetToEdit.commissionDate,
      description: assetToEdit.description,
      status: assetToEdit.status,
    })

    setEditId(assetToEdit.id)
  }

  const handleDelete = async () => {
    setSuccessMsg('')
    setErrorMsg('')

    if (!canManageAsset) {
      setErrorMsg('You do not have permission to manage assets.')
      setConfirmDeleteId(null)
      return
    }

    try {
      setLoading(true)

      await deleteAsset(confirmDeleteId)
      await reloadAssets()

      if (editId === confirmDeleteId) {
        setAsset(emptyAsset)
        setEditId(null)
      }

      setConfirmDeleteId(null)
      setSuccessMsg('Asset deleted successfully')
    } catch (error) {
      setErrorMsg(error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleCancelEdit = () => {
    setAsset(emptyAsset)
    setEditId(null)
  }

  const getAssetTypeName = (assetTypeCode) => {
    const selectedAssetType = assetTypes.find(
      (item) => item.assetTypeCode === assetTypeCode
    )

    if (!selectedAssetType) {
      return ''
    }

    return selectedAssetType.assetTypeName
  }

  const getLocationName = (locationCode) => {
    const selectedLocation = locations.find(
      (item) => item.locationCode === locationCode
    )

    if (!selectedLocation) {
      return ''
    }

    return selectedLocation.locationName
  }

  return (
    <div>
      <div className="page-title">
        <div>
          <h2>Asset Master</h2>
          <p>Create, update, and manage centralized asset registry.</p>
        </div>

        <span className="record-count">{assets.length} Assets</span>
      </div>

      {activeAssetTypes.length === 0 && (
        <div className="info-box">
          Please create at least one active Asset Type before creating assets.
        </div>
      )}

      {activeLocations.length === 0 && (
        <div className="info-box">
          Please create at least one active Location before creating Local Assets.
          Global Assets can be created without a fixed location.
        </div>
      )}

      {successMsg && (
        <div className="success-box">{successMsg}</div>
      )}

      {errorMsg && (
        <div className="error-box">{errorMsg}</div>
      )}

      {!canManageAsset && (
        <div className="info-box">
          You are in view-only mode. Admin can manage assets.
        </div>
      )}

      {confirmDeleteId && (
        <div className="confirm-overlay">
          <div className="confirm-box">
            <p>Are you sure you want to delete this asset?</p>
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

      {canManageAsset && (
      <form onSubmit={handleSubmit}>
        <div>
          <label>Asset Name</label>
          <input
            name="assetName"
            type="text"
            value={asset.assetName}
            onChange={(e) => { handleChange(e); setValidationErrors({ ...validationErrors, assetName: '' }) }}
            placeholder="Example: Utapate Metering Skid"
            className={validationErrors.assetName ? 'input-error' : ''}
          />
          {validationErrors.assetName && (
            <span className="field-error">{validationErrors.assetName}</span>
          )}
        </div>

        <div>
          <label>Asset Code</label>
          <input
            name="assetCode"
            type="text"
            value={asset.assetCode}
            onChange={(e) => { handleChange(e); setValidationErrors({ ...validationErrors, assetCode: '' }) }}
            placeholder="Example: UTP-MSKID-001"
            className={validationErrors.assetCode ? 'input-error' : ''}
          />
          {validationErrors.assetCode && (
            <span className="field-error">{validationErrors.assetCode}</span>
          )}
        </div>

        <div>
          <label>Asset Scope</label>
          <select
            name="assetScope"
            value={asset.assetScope}
            onChange={(e) => { handleChange(e); setValidationErrors({ ...validationErrors, assetScope: '' }) }}
            className={validationErrors.assetScope ? 'input-error' : ''}
          >
            <option value="">Select Asset Scope</option>
            <option>Local</option>
            <option>Global</option>
          </select>
          {validationErrors.assetScope && (
            <span className="field-error">{validationErrors.assetScope}</span>
          )}
        </div>

        <div>
          <label>Asset Type</label>
          <select
            name="assetTypeCode"
            value={asset.assetTypeCode}
            onChange={(e) => { handleChange(e); setValidationErrors({ ...validationErrors, assetTypeCode: '' }) }}
            className={validationErrors.assetTypeCode ? 'input-error' : ''}
          >
            <option value="">Select Asset Type</option>

            {activeAssetTypes.map((item) => (
              <option key={item.id} value={item.assetTypeCode}>
                {item.assetTypeName} ({item.assetTypeCode})
              </option>
            ))}
          </select>
          {validationErrors.assetTypeCode && (
            <span className="field-error">{validationErrors.assetTypeCode}</span>
          )}
        </div>

        <div>
          <label>
            Location {asset.assetScope === 'Global' ? '(Optional)' : ''}
          </label>
          <select
            name="locationCode"
            value={asset.locationCode}
            onChange={(e) => { handleChange(e); setValidationErrors({ ...validationErrors, locationCode: '' }) }}
            disabled={asset.assetScope === 'Global'}
            className={validationErrors.locationCode ? 'input-error' : ''}
          >
            <option value="">
              {asset.assetScope === 'Global'
                ? 'Not required for Global Asset'
                : 'Select Location'}
            </option>

            {activeLocations.map((item) => (
              <option key={item.id} value={item.locationCode}>
                {item.locationName} ({item.locationCode})
              </option>
            ))}
          </select>
          {validationErrors.locationCode && (
            <span className="field-error">{validationErrors.locationCode}</span>
          )}
        </div>

        <div>
          <label>Serial Number</label>
          <input
            name="serialNumber"
            type="text"
            value={asset.serialNumber}
            onChange={handleChange}
            placeholder="Enter serial number"
          />
        </div>

        <div>
          <label>Manufacturer</label>
          <input
            name="manufacturer"
            type="text"
            value={asset.manufacturer}
            onChange={handleChange}
            placeholder="Enter manufacturer"
          />
        </div>

        <div>
          <label>Model</label>
          <input
            name="model"
            type="text"
            value={asset.model}
            onChange={handleChange}
            placeholder="Enter model"
          />
        </div>

        <div>
          <label>Commission Date</label>
          <input
            name="commissionDate"
            type="date"
            value={asset.commissionDate}
            onChange={handleChange}
          />
        </div>

        <div>
          <label>Status</label>
          <select name="status" value={asset.status} onChange={handleChange}>
            <option>Active</option>
            <option>Inactive</option>
            <option>Blocked</option>
          </select>
        </div>

        <div className="full-width-field">
          <label>Description</label>
          <textarea
            name="description"
            value={asset.description}
            onChange={handleChange}
            placeholder="Enter asset description"
            rows="3"
          />
        </div>

        <div className="form-actions">
          <button type="submit" disabled={loading}>
            {loading
              ? 'Please wait...'
              : editId === null
                ? 'Save Asset'
                : 'Update Asset'}
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
        <h3>Saved Assets</h3>
        <p>
          Local assets are linked to a fixed location. Global assets can be used
          across multiple locations through assignment.
        </p>
      </div>

      <table>
        <thead>
          <tr>
            <th>Asset Name</th>
            <th>Asset Code</th>
            <th>Scope</th>
            <th>Asset Type</th>
            <th>Primary Location</th>
            <th>Serial No.</th>
            <th>Manufacturer</th>
            <th>Model</th>
            <th>Commission Date</th>
            <th>Status</th>
            {canManageAsset && <th>Actions</th>}
          </tr>
        </thead>

        <tbody>
          {assets.length === 0 ? (
            <tr>
              <td colSpan={canManageAsset ? 11 : 10} className="empty-table">
                No assets added yet.
              </td>
            </tr>
          ) : (
            assets.map((item) => (
              <tr key={item.id}>
                <td>{item.assetName}</td>
                <td>{item.assetCode}</td>
                <td>
                  <span
                    className={
                      item.assetScope === 'Global'
                        ? 'scope-badge global'
                        : 'scope-badge local'
                    }
                  >
                    {item.assetScope}
                  </span>
                </td>
                <td>
                  {getAssetTypeName(item.assetTypeCode)} ({item.assetTypeCode})
                </td>
                <td>
                  {item.assetScope === 'Global'
                    ? 'Available for multiple locations'
                    : `${getLocationName(item.locationCode)} (${item.locationCode})`}
                </td>
                <td>{item.serialNumber}</td>
                <td>{item.manufacturer}</td>
                <td>{item.model}</td>
                <td>{item.commissionDate}</td>
                <td>
                  <span className={`status-badge ${item.status.toLowerCase()}`}>
                    {item.status}
                  </span>
                </td>
                {canManageAsset && (
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
        Asset Code must be unique. Local assets require a primary location.
        Global assets can be assigned to multiple locations later.
      </div>
    </div>
  )
}

export default AssetMaster