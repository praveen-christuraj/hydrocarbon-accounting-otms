import { useEffect, useMemo, useState } from 'react'
import {
  createTrackingModuleConfig,
  deleteTrackingModuleConfig,
  getTrackingModuleCatalog,
  getTrackingModuleConfigs,
  updateTrackingModuleConfig,
} from '../api/trackingModuleConfigApi'
import PaginationControls, { paginateRows, usePageSize } from '../components/common/PaginationControls'
import DataTableToolbar from '../components/common/DataTableToolbar'
import { useDataFilters } from '../hooks/useDataFilters'
import { useAutoColumns } from '../hooks/useAutoColumns'
import AlertMessage from '../components/common/AlertMessage'
import FormDialog from '../components/common/FormDialog'
import ConfirmDialog from '../components/common/ConfirmDialog'
import Icon from '../components/common/Icon'
import { usePermissions } from '../hooks/usePermissions'
import useActionFeedback from '../hooks/useActionFeedback'
import { logUiAction } from '../utils/actionLogger'

const emptyForm = {
  moduleCode: 'BARGE',
  operationTypeCode: '',
  movementRole: 'SENDER',
  status: 'Active',
  remarks: '',
}

function TrackingModuleConfiguration({ loggedInUser }) {
  const { hasPermission } = usePermissions(loggedInUser)
  const canView = hasPermission('View Tracking Module Configuration')
  const canCreate = hasPermission('Create Tracking Module Configuration')
  const canEdit = hasPermission('Edit Tracking Module Configuration')
  const canDelete = hasPermission('Delete Tracking Module Configuration')

  const feedback = useActionFeedback()
  const [catalog, setCatalog] = useState({ modules: [], roles: [], statuses: [], operation_types: [] })
  const [configs, setConfigs] = useState([])
  const [loading, setLoading] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [editId, setEditId] = useState(null)
  const [formData, setFormData] = useState(emptyForm)
  const [validationErrors, setValidationErrors] = useState({})
  const [confirmDeleteItem, setConfirmDeleteItem] = useState(null)
  const [page, setPage] = useState(1)

  const pageSize = usePageSize()
  const configFilters = useDataFilters(configs, useAutoColumns(configs), { module: 'Tracking Module Configuration' })
  const visibleConfigs = paginateRows(configFilters.filteredRows, page, pageSize)

  const activeOperationTypes = useMemo(
    () => (catalog.operation_types || []).filter((item) => item.status === 'Active'),
    [catalog.operation_types]
  )

  const unmappedOperationTypes = useMemo(
    () => activeOperationTypes.filter((item) => (item.mappings || []).length === 0),
    [activeOperationTypes]
  )

  const fetchAll = async () => {
    const [catalogData, configData] = await Promise.all([
      getTrackingModuleCatalog(),
      getTrackingModuleConfigs(),
    ])
    return { catalogData, configData }
  }

  const loadAll = async () => {
    if (!canView) return
    setLoading(true)
    try {
      const { catalogData, configData } = await fetchAll()
      setCatalog(catalogData)
      setConfigs(configData)
    } catch (error) {
      feedback.notifyError(error.message)
    } finally {
      setLoading(false)
    }
  }

  // Initial load: state is only set after the request resolves.
  useEffect(() => {
    if (!canView) return undefined
    let active = true
    fetchAll()
      .then(({ catalogData, configData }) => {
        if (!active) return
        setCatalog(catalogData)
        setConfigs(configData)
      })
      .catch((error) => {
        if (active) feedback.notifyError(error.message)
      })
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView])

  const moduleLabel = (code) => catalog.modules.find((item) => item.code === code)?.label || code
  const roleLabel = (code) => catalog.roles.find((item) => item.code === code)?.label || code

  const resetForm = () => {
    setFormData(emptyForm)
    setEditId(null)
    setValidationErrors({})
  }

  const openCreate = (operationTypeCode = '') => {
    resetForm()
    feedback.clearError()
    feedback.clearSuccess?.()
    setFormData({ ...emptyForm, operationTypeCode })
    setFormOpen(true)
    logUiAction('Tracking Module Configuration', 'Open Create Dialog', { operationTypeCode })
  }

  const openEdit = (item) => {
    if (!canEdit) return
    resetForm()
    feedback.clearError()
    setFormData({
      moduleCode: item.moduleCode,
      operationTypeCode: item.operationTypeCode,
      movementRole: item.movementRole,
      status: item.status,
      remarks: item.remarks || '',
    })
    setEditId(item.id)
    setFormOpen(true)
    logUiAction('Tracking Module Configuration', 'Open Edit Dialog', { id: item.id })
  }

  const handleCancel = () => {
    resetForm()
    setFormOpen(false)
  }

  const handleChange = (e) => {
    const { name, value } = e.target
    setFormData((prev) => ({ ...prev, [name]: value }))
    setValidationErrors((prev) => {
      const next = { ...prev }
      delete next[name]
      delete next._form
      return next
    })
  }

  const validateForm = () => {
    const errors = {}
    if (!formData.operationTypeCode) errors.operationTypeCode = 'Operation type is required'
    const duplicate = configs.some(
      (item) =>
        item.id !== editId &&
        item.moduleCode === formData.moduleCode &&
        String(item.operationTypeCode).toLowerCase() === String(formData.operationTypeCode).toLowerCase()
    )
    if (duplicate) {
      errors._form = 'This operation type is already mapped to this tracking module.'
    }
    setValidationErrors(errors)
    return Object.keys(errors).length === 0
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const isCreate = editId === null
    if (!(isCreate ? canCreate : canEdit)) {
      feedback.notifyError(`You do not have permission to ${isCreate ? 'create' : 'edit'} tracking module configuration.`)
      return
    }
    if (!validateForm()) return

    setLoading(true)
    try {
      if (isCreate) {
        await createTrackingModuleConfig(formData)
        feedback.notifySuccess('Tracking module mapping created')
      } else {
        await updateTrackingModuleConfig(editId, formData)
        feedback.notifySuccess('Tracking module mapping updated')
      }
      resetForm()
      setFormOpen(false)
      await loadAll()
    } catch (error) {
      setValidationErrors({ _form: error.message })
    } finally {
      setLoading(false)
    }
  }

  const confirmDelete = async () => {
    if (!confirmDeleteItem) return
    setLoading(true)
    try {
      await deleteTrackingModuleConfig(confirmDeleteItem.id)
      feedback.notifySuccess('Tracking module mapping deleted')
      setConfirmDeleteItem(null)
      await loadAll()
    } catch (error) {
      feedback.notifyError(error.message)
      setConfirmDeleteItem(null)
    } finally {
      setLoading(false)
    }
  }

  if (!canView) {
    return <div className="info-box">You do not have permission to view tracking module configuration.</div>
  }

  return (
    <div>
      <div className="page-title">
        <div>
          <h2>Tracking Module Configuration</h2>
          <p>
            Map operation types of the Operation Type Master to Barge Tracking and Tanker Tracking.
            Each tracking page lists the approved tickets of its mapped operation types for the user's locations.
            No stage is configured here: Barge Tracking captures the barge stage on the ticket itself,
            so the same operation type serves the sender and the receiver with any stage (Load 1, Top-up,
            STS, Unload).
          </p>
        </div>
        <div className="page-title-actions">
          {canCreate && (
            <button type="button" className="btn-primary" onClick={() => openCreate()}>
              <Icon name="plus" size={15} />New Mapping
            </button>
          )}
          <span className="record-count">{configs.length} Mappings</span>
        </div>
      </div>

      <AlertMessage tone="success" message={feedback.successMsg} onDismiss={feedback.clearSuccess} />
      <AlertMessage tone="error" message={feedback.errorMsg} onDismiss={feedback.clearError} />

      {!canCreate && !canEdit && !canDelete && (
        <div className="info-box">You have view-only access to Tracking Module Configuration.</div>
      )}

      {unmappedOperationTypes.length > 0 && (
        <div className="section-title">
          <h3>Operation types not mapped to any tracking module</h3>
          <p>These operation types are not captured by any tracking page yet.</p>
          <ul>
            {unmappedOperationTypes.map((item) => (
              <li key={item.operation_type_code}>
                {item.operation_type_name} ({item.operation_type_code})
                {canCreate && (
                  <button type="button" onClick={() => openCreate(item.operation_type_code)} style={{ marginLeft: 8 }}>
                    Map
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <FormDialog
        open={formOpen}
        title={editId === null ? 'New Tracking Mapping' : 'Edit Tracking Mapping'}
        description="Map an operation type to a tracking module. A receiver ticket is created against an approved sender ticket of the same barge and convoy."
        submitLabel={editId === null ? 'Save Mapping' : 'Update Mapping'}
        busy={loading}
        error={validationErrors._form}
        onDismissError={() => setValidationErrors((prev) => ({ ...prev, _form: undefined }))}
        onSubmit={handleSubmit}
        onCancel={handleCancel}
      >
        <div>
          <label>Tracking Module</label>
          <select name="moduleCode" value={formData.moduleCode} onChange={handleChange}>
            {catalog.modules.map((item) => (
              <option key={item.code} value={item.code}>{item.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label>Operation Type</label>
          <select name="operationTypeCode" value={formData.operationTypeCode} onChange={handleChange}>
            <option value="">Select Operation Type</option>
            {activeOperationTypes.map((item) => (
              <option key={item.operation_type_code} value={item.operation_type_code}>
                {item.operation_type_name} ({item.operation_type_code})
              </option>
            ))}
          </select>
          {validationErrors.operationTypeCode && (
            <span className="field-error">{validationErrors.operationTypeCode}</span>
          )}
        </div>

        <div>
          <label>Movement Role</label>
          <select name="movementRole" value={formData.movementRole} onChange={handleChange}>
            {catalog.roles.map((item) => (
              <option key={item.code} value={item.code}>{item.label}</option>
            ))}
          </select>
          {formData.moduleCode === 'BARGE' && (
            <small>
              Barge Tracking uses one operation type for both sides: the receiver ticket is
              created against the approved sender ticket, so this role does not limit the
              operation type to one side. No stage is mapped here - the barge stage is
              selected on the ticket itself.
            </small>
          )}
        </div>

        <div>
          <label>Status</label>
          <select name="status" value={formData.status} onChange={handleChange}>
            {(catalog.statuses || ['Active', 'Inactive']).map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </div>

        <div className="full-width-field">
          <label>Remarks</label>
          <textarea name="remarks" value={formData.remarks} onChange={handleChange} rows="3" placeholder="Enter remarks" />
        </div>
      </FormDialog>

      <div className="section-title">
        <h3>Configured Mappings</h3>
        <p>Operation types listed here are captured by the matching tracking page.</p>
      </div>

      <DataTableToolbar
        filters={configFilters}
        columns={configFilters.columns}
        exportFileName="tracking-module-configuration"
        exportTitle="Tracking Module Configuration"
        module="Tracking Module Configuration"
        canImport={false}
      />

      <table>
        <thead>
          <tr>
            <th>Tracking Module</th>
            <th>Operation Type</th>
            <th>Movement Role</th>
            <th>Status</th>
            <th>Remarks</th>
            {(canEdit || canDelete) && <th>Actions</th>}
          </tr>
        </thead>
        <tbody>
          {visibleConfigs.length === 0 ? (
            <tr>
              <td colSpan={canEdit || canDelete ? 6 : 5} className="empty-table">
                No tracking module mappings configured yet.
              </td>
            </tr>
          ) : (
            visibleConfigs.map((item) => (
              <tr key={item.id}>
                <td>{moduleLabel(item.moduleCode)}</td>
                <td>{item.operationTypeName || item.operationTypeCode} ({item.operationTypeCode})</td>
                <td>{roleLabel(item.movementRole)}</td>
                <td>
                  <span className={`status-badge ${String(item.status).toLowerCase()}`}>{item.status}</span>
                </td>
                <td>{item.remarks}</td>
                {(canEdit || canDelete) && (
                  <td className="row-actions">
                    {canEdit && <button type="button" onClick={() => openEdit(item)}>Edit</button>}
                    {canDelete && (
                      <button type="button" onClick={() => setConfirmDeleteItem(item)}>Delete</button>
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
        totalRows={configFilters.filteredRows.length}
        onPageChange={setPage}
      />

      <ConfirmDialog
        open={Boolean(confirmDeleteItem)}
        title="Delete tracking mapping"
        message={
          confirmDeleteItem
            ? `Remove ${confirmDeleteItem.operationTypeCode} from ${moduleLabel(confirmDeleteItem.moduleCode)}? Existing tickets are not changed.`
            : ''
        }
        confirmLabel="Delete"
        busy={loading}
        onConfirm={confirmDelete}
        onCancel={() => setConfirmDeleteItem(null)}
      />
    </div>
  )
}

export default TrackingModuleConfiguration
