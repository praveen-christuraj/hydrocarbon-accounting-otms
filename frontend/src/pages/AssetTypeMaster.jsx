import { useState } from 'react'
import {
  createAssetType,
  deleteAssetType,
  updateAssetType,
} from '../api/assetTypeApi'
import PaginationControls, { paginateRows, usePageSize } from '../components/common/PaginationControls'
import DataTableToolbar from '../components/common/DataTableToolbar'
import { useDataFilters } from '../hooks/useDataFilters'
import { useAutoColumns } from '../hooks/useAutoColumns'
import AlertMessage from '../components/common/AlertMessage'
import FormDialog from '../components/common/FormDialog'
import Icon from '../components/common/Icon'
import { usePermissions } from '../hooks/usePermissions'
import { logUiAction } from '../utils/actionLogger'

const IMPORT_STATUSES = ['Active', 'Inactive', 'Blocked']

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
  const [page, setPage] = useState(1)

  const pageSize = usePageSize()
  const assetTypesFilters = useDataFilters(assetTypes, useAutoColumns(assetTypes), { module: 'Asset Type Master' })
  const visibleItems = paginateRows(assetTypesFilters.filteredRows, page, pageSize)

  const { hasPermission } = usePermissions(loggedInUser)

  const canCreate = hasPermission('Create Asset Type')
  const canEdit = hasPermission('Edit Asset Type')
  const canDelete = hasPermission('Delete Asset Type')
  const [formOpen, setFormOpen] = useState(false)

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

    if (!(editId === null ? canCreate : canEdit)) {
      setErrorMsg(`You do not have permission to ${editId === null ? 'create' : 'edit'} asset types.`)
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
      setFormOpen(false)
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

    if (!canEdit) {
      setErrorMsg('You do not have permission to edit asset types.')
      return
    }

    setAssetType({
      assetTypeName: assetTypeToEdit.assetTypeName,
      assetTypeCode: assetTypeToEdit.assetTypeCode,
      description: assetTypeToEdit.description,
      status: assetTypeToEdit.status,
    })

    setEditId(assetTypeToEdit.id)
    setFormOpen(true)
    logUiAction('Asset Type Master', 'Open Edit Dialog', { assetTypeCode: assetTypeToEdit.assetTypeCode })
  }

  const handleDelete = async () => {
    setSuccessMsg('')
    setErrorMsg('')

    if (!canDelete) {
      setErrorMsg('You do not have permission to delete asset types.')
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
    setValidationErrors({})
    setErrorMsg('')
    setFormOpen(false)
  }

  const openCreate = () => {
    handleCancelEdit()
    setSuccessMsg('')
    setFormOpen(true)
    logUiAction('Asset Type Master', 'Open Create Dialog')
  }


  const importConfig = {
    title: 'Bulk upload asset types',
    description: 'Create records from an Excel or CSV file. Existing codes are skipped.',
    fields: [
    { key: 'assetTypeName', label: 'Asset Type Name', required: true, example: 'Storage Tank' },
    { key: 'assetTypeCode', label: 'Asset Type Code', required: true, example: 'TANK' },
    { key: 'description', label: 'Description', example: '' },
    { key: 'status', label: 'Status', options: IMPORT_STATUSES, defaultValue: 'Active', example: 'Active' },
  ],
    validateRow: (record) => {
    const code = String(record.assetTypeCode || '').trim().toLowerCase()
    if (assetTypes.some((item) => item.assetTypeCode.toLowerCase() === code)) return 'Asset type code already exists'
    if (record.status && !IMPORT_STATUSES.includes(record.status)) return `Status must be one of ${IMPORT_STATUSES.join(', ')}`
    return null
  },
    onImportRow: async (record) => {
      await createAssetType({ ...emptyAssetType, ...record, status: record.status || 'Active' })
    },
    onComplete: async () => {
      await reloadAssetTypes()
    },
  }

  return (
    <div>
      <div className="page-title">
        <div>
          <h2>Asset Type Master</h2>
          <p>Create, update, and manage asset categories.</p>
        </div>

        <div className="page-title-actions">
          {canCreate && (<button type="button" className="btn-primary" onClick={openCreate}><Icon name="plus" size={15} />New Asset Type</button>)}
          <span className="record-count">{assetTypes.length} Asset Types</span>
        </div>
      </div>

      {!formOpen && <AlertMessage tone="success" message={successMsg} onDismiss={() => setSuccessMsg('')} />}
      {!formOpen && <AlertMessage tone="error" message={errorMsg} onDismiss={() => setErrorMsg('')} />}

      {!canCreate && !canEdit && !canDelete && (
        <div className="info-box">
          You have view-only access to Asset Type Master.
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

      <FormDialog
        open={formOpen}
        title={editId === null ? 'New Asset Type' : 'Edit Asset Type'}
        description="Asset Type Code must be unique. Example: MSKID for Metering Skid."
        submitLabel={editId === null ? 'Save Asset Type' : 'Update Asset Type'}
        busy={loading}
        error={errorMsg}
        onDismissError={() => setErrorMsg('')}
        onSubmit={handleSubmit}
        onCancel={handleCancelEdit}
      >
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
      </FormDialog>

      <div className="section-title">
        <h3>Saved Asset Types</h3>
        <p>Asset types are now saved permanently in PostgreSQL.</p>
      </div>

      <DataTableToolbar
        filters={assetTypesFilters}
        columns={assetTypesFilters.columns}
        exportFileName="asset-type-master"
        exportTitle="Asset Type Master"
        module="Asset Type Master"
        importConfig={importConfig}
        canImport={canCreate}
      />

      <table>
        <thead>
          <tr>
            <th>Asset Type Name</th>
            <th>Asset Type Code</th>
            <th>Description</th>
            <th>Status</th>
            {(canEdit || canDelete) && <th>Actions</th>}
          </tr>
        </thead>

        <tbody>
          {assetTypes.length === 0 ? (
            <tr>
              <td colSpan={canEdit || canDelete ? 5 : 4} className="empty-table">
                No asset types added yet.
              </td>
            </tr>
          ) : (
            visibleItems.map((item) => (
              <tr key={item.id}>
                <td>{item.assetTypeName}</td>
                <td>{item.assetTypeCode}</td>
                <td>{item.description}</td>
                <td>
                  <span className={`status-badge ${item.status.toLowerCase()}`}>
                    {item.status}
                  </span>
                </td>
                {(canEdit || canDelete) && (
                <td className="row-actions">
                  {canEdit && (
                    <button type="button" onClick={() => handleEdit(item)}>
                      Edit
                    </button>
                  )}
                  {canDelete && (
                    <button type="button" onClick={() => { setSuccessMsg(''); setErrorMsg(''); setConfirmDeleteId(item.id) }}>
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

      <PaginationControls currentPage={page} totalRows={assetTypesFilters.filteredRows.length} onPageChange={setPage} />

      <div className="info-box">
        Asset Type Code must be unique. Example: MSKID for Metering Skid.
      </div>
    </div>
  )
}

export default AssetTypeMaster