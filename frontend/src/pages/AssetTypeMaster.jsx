import { useState } from 'react'
import {
  createAssetType,
  deleteAssetType,
  updateAssetType,
} from '../api/assetTypeApi'

function AssetTypeMaster({ assetTypes, reloadAssetTypes }) {
  const emptyAssetType = {
    assetTypeName: '',
    assetTypeCode: '',
    description: '',
    status: 'Active',
  }

  const [assetType, setAssetType] = useState(emptyAssetType)
  const [editId, setEditId] = useState(null)
  const [loading, setLoading] = useState(false)

  const handleChange = (e) => {
    setAssetType({
      ...assetType,
      [e.target.name]: e.target.value,
    })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()

    if (assetType.assetTypeName.trim() === '') {
      alert('Asset Type Name is required')
      return
    }

    if (assetType.assetTypeCode.trim() === '') {
      alert('Asset Type Code is required')
      return
    }

    const assetTypeCodeAlreadyExists = assetTypes.some((item) => {
      return (
        item.assetTypeCode.toLowerCase() ===
          assetType.assetTypeCode.toLowerCase() &&
        item.id !== editId
      )
    })

    if (assetTypeCodeAlreadyExists) {
      alert('Asset Type Code already exists. Please choose another code.')
      return
    }

    try {
      setLoading(true)

      if (editId === null) {
        await createAssetType(assetType)
        alert('Asset Type saved successfully')
      } else {
        await updateAssetType(editId, assetType)
        alert('Asset Type updated successfully')
      }

      await reloadAssetTypes()
      setAssetType(emptyAssetType)
      setEditId(null)
    } catch (error) {
      alert(error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleEdit = (assetTypeToEdit) => {
    setAssetType({
      assetTypeName: assetTypeToEdit.assetTypeName,
      assetTypeCode: assetTypeToEdit.assetTypeCode,
      description: assetTypeToEdit.description,
      status: assetTypeToEdit.status,
    })

    setEditId(assetTypeToEdit.id)
  }

  const handleDelete = async (assetTypeId) => {
    const confirmDelete = window.confirm(
      'Are you sure you want to delete this asset type?'
    )

    if (confirmDelete === false) {
      return
    }

    try {
      setLoading(true)

      await deleteAssetType(assetTypeId)
      await reloadAssetTypes()

      if (editId === assetTypeId) {
        setAssetType(emptyAssetType)
        setEditId(null)
      }

      alert('Asset Type deleted successfully')
    } catch (error) {
      alert(error.message)
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

      <form onSubmit={handleSubmit}>
        <div>
          <label>Asset Type Name</label>
          <input
            name="assetTypeName"
            type="text"
            value={assetType.assetTypeName}
            onChange={handleChange}
            placeholder="Example: Metering Skid"
          />
        </div>

        <div>
          <label>Asset Type Code</label>
          <input
            name="assetTypeCode"
            type="text"
            value={assetType.assetTypeCode}
            onChange={handleChange}
            placeholder="Example: MSKID"
          />
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
            <th>Actions</th>
          </tr>
        </thead>

        <tbody>
          {assetTypes.length === 0 ? (
            <tr>
              <td colSpan="5" className="empty-table">
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
        Asset Type Code must be unique. Example: MSKID for Metering Skid.
      </div>
    </div>
  )
}

export default AssetTypeMaster