import { useEffect, useMemo, useState } from 'react'
import {
  createVesselOperation,
  deleteVesselOperation,
  getVesselOperations,
  updateVesselOperation,
} from '../api/vesselOperationApi'
import PageHeader from '../components/common/PageHeader'
import AlertMessage from '../components/common/AlertMessage'
import FormDialog from '../components/common/FormDialog'
import Icon from '../components/common/Icon'
import { useConfirm } from '../components/common/ConfirmProvider'
import { usePermissions } from '../hooks/usePermissions'
import { logUiAction } from '../utils/actionLogger'
import PaginationControls, { paginateRows, usePageSize } from '../components/common/PaginationControls'
import DataTableToolbar from '../components/common/DataTableToolbar'
import { useDataFilters } from '../hooks/useDataFilters'
import { useAutoColumns } from '../hooks/useAutoColumns'

function VesselOperationMaster({ locations = [], assetTypes = [], loggedInUser }) {
  const confirm = useConfirm()
  const { hasPermission } = usePermissions(loggedInUser)
  const canCreate = hasPermission('Create Vessel Operation')
  const canEdit = hasPermission('Edit Vessel Operation')
  const canDelete = hasPermission('Delete Vessel Operation')
  const [filters, setFilters] = useState({
    location_code: '',
    applicable_asset_type_code: '',
    status: 'Active',
  })
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [formError, setFormError] = useState('')
  const [page, setPage] = useState(1)
  const pageSize = usePageSize()

  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({
    location_code: '',
    applicable_asset_type_code: '',
    operation_code: '',
    operation_label: '',
    operation_category: '',
    operation_sign: 'IN',
    show_in: 'Both',
    sort_order: 1,
    description: '',
    status: 'Active',
  })

  const rowsFilters = useDataFilters(rows, useAutoColumns(rows), { module: 'Vessel Operation Master' })
  const visibleRows = paginateRows(rowsFilters.filteredRows, page, pageSize)

  const vesselAssetTypes = useMemo(() => {
    return assetTypes.filter((t) => t.status === 'Active')
  }, [assetTypes])

  const load = async () => {
    try {
      setLoading(true)
      const data = await getVesselOperations(filters)
      setRows(Array.isArray(data) ? data : [])
    } catch (e) {
      setErrorMsg(e.message || 'Unable to load vessel operations')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onFilterChange = (e) => {
    const { name, value } = e.target
    setFilters((c) => ({ ...c, [name]: value }))
  }

  const onFormChange = (e) => {
    const { name, value } = e.target
    setForm((c) => ({ ...c, [name]: value }))
  }

  const resetForm = () => {
    setEditing(null)
    setFormError('')
    setForm({
      location_code: '',
      applicable_asset_type_code: '',
      operation_code: '',
      operation_label: '',
      operation_category: '',
      operation_sign: 'IN',
      show_in: 'Both',
      sort_order: 1,
      description: '',
      status: 'Active',
    })
  }

  const openCreate = () => {
    resetForm()
    setSuccessMsg('')
    setErrorMsg('')
    setFormOpen(true)
    logUiAction('Vessel Operation Master', 'Open Create Dialog')
  }

  const closeForm = () => {
    resetForm()
    setFormOpen(false)
  }

  const startEdit = (row) => {
    setSuccessMsg('')
    setErrorMsg('')
    setFormError('')
    setFormOpen(true)
    logUiAction('Vessel Operation Master', 'Open Edit Dialog', { operationCode: row.operation_code })
    setEditing(row)
    setForm({
      location_code: row.location_code || '',
      applicable_asset_type_code: row.applicable_asset_type_code || '',
      operation_code: row.operation_code || '',
      operation_label: row.operation_label || '',
      operation_category: row.operation_category || '',
      operation_sign: row.operation_sign || 'IN',
      show_in: row.show_in || 'Both',
      sort_order: row.sort_order || 1,
      description: row.description || '',
      status: row.status || 'Active',
    })
  }

  const save = async () => {
    if (!(editing?.id ? canEdit : canCreate)) {
      setFormError(`You do not have permission to ${editing?.id ? 'edit' : 'create'} vessel operations.`)
      return
    }
    try {
      setLoading(true)

      if (editing?.id) {
        await updateVesselOperation(editing.id, form)
      } else {
        await createVesselOperation(form)
      }

      setSuccessMsg(editing?.id ? 'Vessel operation updated successfully.' : 'Vessel operation created successfully.')
      closeForm()
      await load()
    } catch (e) {
      setFormError(e.message || 'Unable to save vessel operation')
    } finally {
      setLoading(false)
    }
  }

  /* -------------------------------------------------------- bulk upload */

  const VESSEL_SIGNS = ['IN', 'OUT', 'NEUTRAL', 'SET']
  const SHOW_IN_OPTIONS = ['Both', 'Entry', 'Tracking']
  const VESSEL_STATUSES = ['Active', 'Inactive', 'Blocked']

  const importConfig = {
    title: 'Bulk upload vessel operations',
    description:
      'Upload an Excel (.xlsx) or CSV file. Operations are matched on Location + Asset Type + Operation Code and updated when they already exist.',
    templateFileName: 'vessel-operation-master',
    fields: [
      { key: 'location_code', label: 'Location Code', required: true, example: 'UTP', aliases: ['Location'] },
      {
        key: 'applicable_asset_type_code',
        label: 'Applicable Asset Type Code',
        required: true,
        example: 'VESSEL',
        aliases: ['Asset Type', 'Asset Type Code'],
      },
      { key: 'operation_code', label: 'Operation Code', required: true, example: 'LOADING', aliases: ['Code'] },
      { key: 'operation_label', label: 'Operation Label', required: true, example: 'Vessel Loading' },
      { key: 'operation_category', label: 'Category', required: true, example: 'LOADING' },
      { key: 'operation_sign', label: 'Sign', required: true, options: VESSEL_SIGNS, defaultValue: 'IN', example: 'IN' },
      { key: 'show_in', label: 'Show In', options: SHOW_IN_OPTIONS, defaultValue: 'Both', example: 'Both' },
      { key: 'sort_order', label: 'Sort Order', example: '1' },
      { key: 'description', label: 'Description', example: '' },
      { key: 'status', label: 'Status', options: VESSEL_STATUSES, defaultValue: 'Active', example: 'Active' },
    ],
    validateRow: (record) => {
      const location = locations.find(
        (item) => String(item.locationCode).toLowerCase() === String(record.location_code).trim().toLowerCase()
      )
      if (!location || location.status !== 'Active') {
        return `Unknown or inactive location code "${record.location_code}"`
      }
      const assetType = assetTypes.find(
        (item) =>
          String(item.assetTypeCode).toLowerCase() ===
          String(record.applicable_asset_type_code).trim().toLowerCase()
      )
      if (!assetType || assetType.status !== 'Active') {
        return `Unknown or inactive asset type code "${record.applicable_asset_type_code}"`
      }
      if (!VESSEL_SIGNS.includes(String(record.operation_sign).trim().toUpperCase())) {
        return `Sign must be one of ${VESSEL_SIGNS.join(', ')}`
      }
      if (record.show_in && !SHOW_IN_OPTIONS.includes(String(record.show_in).trim())) {
        return `Show In must be one of ${SHOW_IN_OPTIONS.join(', ')}`
      }
      if (record.sort_order && !Number.isFinite(Number(record.sort_order))) {
        return 'Sort Order must be a number'
      }
      if (record.status && !VESSEL_STATUSES.includes(record.status)) {
        return `Status must be one of ${VESSEL_STATUSES.join(', ')}`
      }
      return null
    },
    onImportRow: async (record) => {
      const payload = {
        location_code: String(record.location_code).trim(),
        applicable_asset_type_code: String(record.applicable_asset_type_code).trim(),
        operation_code: String(record.operation_code).trim().toUpperCase(),
        operation_label: String(record.operation_label).trim(),
        operation_category: String(record.operation_category).trim().toUpperCase(),
        operation_sign: String(record.operation_sign || 'IN').trim().toUpperCase(),
        show_in: record.show_in || 'Both',
        sort_order:
          record.sort_order === '' || record.sort_order === undefined ? 1 : Number(record.sort_order),
        description: String(record.description || '').trim(),
        status: record.status || 'Active',
      }
      const existing = rows.find(
        (item) =>
          String(item.location_code).toLowerCase() === payload.location_code.toLowerCase() &&
          String(item.applicable_asset_type_code).toLowerCase() ===
            payload.applicable_asset_type_code.toLowerCase() &&
          String(item.operation_code).toLowerCase() === payload.operation_code.toLowerCase()
      )
      if (existing) {
        await updateVesselOperation(existing.id, payload)
      } else {
        await createVesselOperation(payload)
      }
    },
    onComplete: async () => {
      await load()
    },
  }

  const remove = async (row) => {
    setSuccessMsg('')
    setErrorMsg('')
    if (!canDelete) {
      setErrorMsg('You do not have permission to delete vessel operations.')
      return
    }
    const confirmed = await confirm({
      title: 'Delete vessel operation',
      message: `Delete vessel operation ${row.operation_label} (${row.operation_code})?`,
      tone: 'danger',
      confirmLabel: 'Delete',
      module: 'Vessel Operation Master',
    })
    if (!confirmed) return

    try {
      setLoading(true)
      await deleteVesselOperation(row.id)
      setSuccessMsg(`Vessel operation ${row.operation_label} deleted successfully.`)
      await load()
    } catch (e) {
      setErrorMsg(e.message || 'Unable to delete vessel operation')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="Vessel Operation Master"
        description="Configure soft-coded shuttle vessel / FSO operations (Loading, Unloading, STS, Decanting, etc.) per location and asset type."
        count={`${rows.length} Records`}
        actions={
          canCreate && (
            <button type="button" className="btn-primary" onClick={openCreate}>
              <Icon name="plus" size={15} />
              New Vessel Operation
            </button>
          )
        }
      />

      <AlertMessage tone="success" message={successMsg} onDismiss={() => setSuccessMsg('')} />
      <AlertMessage tone="error" message={errorMsg} onDismiss={() => setErrorMsg('')} />

      {!canCreate && !canEdit && !canDelete && (
        <div className="info-box">You have view-only access to Vessel Operation Master.</div>
      )}

      <div className="report-filter-panel no-print">
        <div>
          <label>Location</label>
          <select
            name="location_code"
            value={filters.location_code}
            onChange={onFilterChange}
          >
            <option value="">All Locations</option>
            {locations.map((l) => (
              <option key={l.id} value={l.locationCode}>
                {l.locationName} ({l.locationCode})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label>Asset Type</label>
          <select
            name="applicable_asset_type_code"
            value={filters.applicable_asset_type_code}
            onChange={onFilterChange}
          >
            <option value="">All Asset Types</option>
            {vesselAssetTypes.map((t) => (
              <option key={t.id} value={t.assetTypeCode}>
                {t.assetTypeName} ({t.assetTypeCode})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label>Status</label>
          <select name="status" value={filters.status} onChange={onFilterChange}>
            <option value="">All Statuses</option>
            <option>Active</option>
            <option>Inactive</option>
          </select>
        </div>

        <div className="report-filter-actions">
          <button type="button" onClick={load} disabled={loading}>
            {loading ? 'Loading...' : 'Load Data'}
          </button>
        </div>
      </div>

      <FormDialog
        open={formOpen}
        title={editing ? 'Edit Vessel Operation' : 'New Vessel Operation'}
        size="lg"
        columns={3}
        submitLabel={editing ? 'Update Vessel Operation' : 'Save Vessel Operation'}
        busy={loading}
        error={formError}
        onDismissError={() => setFormError('')}
        onSubmit={save}
        onCancel={closeForm}
      >
        <div>
          <label>Location *</label>
          <select
            name="location_code"
            value={form.location_code}
            onChange={onFormChange}
            disabled={loading}
          >
            <option value="">Select Location</option>
            {locations.map((l) => (
              <option key={l.id} value={l.locationCode}>
                {l.locationName} ({l.locationCode})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label>Asset Type *</label>
          <select
            name="applicable_asset_type_code"
            value={form.applicable_asset_type_code}
            onChange={onFormChange}
            disabled={loading}
          >
            <option value="">Select Asset Type</option>
            {vesselAssetTypes.map((t) => (
              <option key={t.id} value={t.assetTypeCode}>
                {t.assetTypeName} ({t.assetTypeCode})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label>Operation Code *</label>
          <input
            name="operation_code"
            value={form.operation_code}
            onChange={onFormChange}
            placeholder="LOADING / UNLOADING / STS_IN / STS_OUT ..."
            disabled={loading}
          />
        </div>

        <div>
          <label>Operation Label *</label>
          <input
            name="operation_label"
            value={form.operation_label}
            onChange={onFormChange}
            placeholder="Loading / Unloading / STS IN ..."
            disabled={loading}
          />
        </div>

        <div>
          <label>Category *</label>
          <input
            name="operation_category"
            value={form.operation_category}
            onChange={onFormChange}
            placeholder="LOADING / UNLOADING / STS / DECANTING ..."
            disabled={loading}
          />
        </div>

        <div>
          <label>Sign *</label>
          <select
            name="operation_sign"
            value={form.operation_sign}
            onChange={onFormChange}
            disabled={loading}
          >
            <option>IN</option>
            <option>OUT</option>
            <option>NEUTRAL</option>
            <option>SET</option>
          </select>
        </div>

        <div>
          <label>Show In</label>
          <select name="show_in" value={form.show_in} onChange={onFormChange} disabled={loading}>
            <option value="Both">Both</option>
            <option value="Entry">Entry</option>
            <option value="Tracking">Tracking</option>
          </select>
        </div>

        <div>
          <label>Sort Order</label>
          <input
            type="number"
            name="sort_order"
            value={form.sort_order}
            onChange={onFormChange}
            disabled={loading}
          />
        </div>

        <div>
          <label>Status</label>
          <select name="status" value={form.status} onChange={onFormChange} disabled={loading}>
            <option>Active</option>
            <option>Inactive</option>
          </select>
        </div>

        <div className="full-width-field">
          <label>Description</label>
          <textarea
            name="description"
            rows="3"
            value={form.description}
            onChange={onFormChange}
            disabled={loading}
          />
        </div>
      </FormDialog>

      <DataTableToolbar
        filters={rowsFilters}
        columns={rowsFilters.columns}
        exportFileName="vessel-operation-master"
        exportTitle="Vessel Operation Master"
        module="Vessel Operation Master"
        importConfig={importConfig}
        canImport={canCreate}
      />

      <table>
        <thead>
          <tr>
            <th>Location</th>
            <th>Asset Type</th>
            <th>Code</th>
            <th>Label</th>
            <th>Category</th>
            <th>Sign</th>
            <th>Show In</th>
            <th>Status</th>
            {(canEdit || canDelete) && <th>Actions</th>}
          </tr>
        </thead>

        <tbody>
          {visibleRows.length === 0 ? (
            <tr>
              <td colSpan={canEdit || canDelete ? 9 : 8} className="empty-table">
                No vessel operations found.
              </td>
            </tr>
          ) : (
            visibleRows.map((r) => (
              <tr key={r.id}>
                <td>
                  {r.location_name} <br />
                  <small>{r.location_code}</small>
                </td>
                <td>{r.applicable_asset_type_code}</td>
                <td>{r.operation_code}</td>
                <td>{r.operation_label}</td>
                <td>{r.operation_category}</td>
                <td>{r.operation_sign}</td>
                <td>{r.show_in || 'Both'}</td>
                <td><span className={`status-badge ${String(r.status || '').toLowerCase()}`}>{r.status}</span></td>
                {(canEdit || canDelete) && (
                  <td className="row-actions">
                    {canEdit && (
                      <button type="button" onClick={() => startEdit(r)}>
                        Edit
                      </button>
                    )}
                    {canDelete && (
                      <button type="button" onClick={() => remove(r)}>
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

      <PaginationControls currentPage={page} totalRows={rowsFilters.filteredRows.length} onPageChange={setPage} />
    </div>
  )
}

export default VesselOperationMaster
