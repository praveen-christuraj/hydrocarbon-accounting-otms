import { useEffect, useMemo, useState } from 'react'
import {
  createVesselOperation,
  deleteVesselOperation,
  getVesselOperations,
  updateVesselOperation,
} from '../api/vesselOperationApi'

function VesselOperationMaster({ locations = [], assetTypes = [], loggedInUser }) {
  const isAdminBootstrap =
    String(loggedInUser?.username || '').toLowerCase() === 'admin'

  const hasPermission = (permissionName) =>
    Boolean(
      loggedInUser?.permissions?.some(
        (p) => p.permissionName === permissionName
      )
    )

  const canManageVesselOperation = useMemo(() => {
    if (isAdminBootstrap) return true
    return hasPermission('Manage Vessel Operation')
  }, [loggedInUser])
  const [filters, setFilters] = useState({
    location_code: '',
    applicable_asset_type_code: '',
    status: 'Active',
  })
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)

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

  const startEdit = (row) => {
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
    if (!canManageVesselOperation) {
      setErrorMsg('You do not have permission to manage vessel operations')
      return
    }
    try {
      setLoading(true)

      if (editing?.id) {
        await updateVesselOperation(editing.id, form)
      } else {
        await createVesselOperation(form)
      }

      resetForm()
      await load()
      setSuccessMsg(editing?.id ? 'Vessel operation updated successfully.' : 'Vessel operation created successfully.')
    } catch (e) {
      setErrorMsg(e.message || 'Unable to save vessel operation')
    } finally {
      setLoading(false)
    }
  }

  const remove = async (row) => {
    setConfirmDelete(row)
  }

  const confirmRemove = async () => {
    if (!canManageVesselOperation) {
      setErrorMsg('You do not have permission to manage vessel operations')
      setConfirmDelete(null)
      return
    }
    if (!confirmDelete) return

    try {
      setLoading(true)
      await deleteVesselOperation(confirmDelete.id)
      setConfirmDelete(null)
      setSuccessMsg(`Vessel operation ${confirmDelete.operation_label} deleted successfully.`)
      await load()
    } catch (e) {
      setErrorMsg(e.message || 'Unable to delete vessel operation')
      setConfirmDelete(null)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      {successMsg && (
        <div className="success-box" onClick={() => setSuccessMsg('')}>
          {successMsg}
        </div>
      )}
      {errorMsg && (
        <div className="error-box" onClick={() => setErrorMsg('')}>
          {errorMsg}
        </div>
      )}
      {confirmDelete && (
        <div className="confirm-overlay">
          <div className="confirm-dialog">
            <p>Delete vessel operation {confirmDelete.operation_label} ({confirmDelete.operation_code})?</p>
            <div className="confirm-actions">
              <button onClick={confirmRemove}>Yes, Delete</button>
              <button onClick={() => setConfirmDelete(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
      <div className="page-title">
        <div>
          <h2>Vessel Operation Master</h2>
          <p>
            Configure soft-coded shuttle vessel / FSO operations (Loading,
            Unloading, STS, Decanting, etc.) per location and asset type.
          </p>
        </div>
        <span className="record-count">{rows.length} Records</span>
      </div>

      {!canManageVesselOperation && (
        <div className="info-box">
          You have view-only access. Assign <strong>Manage Vessel Operation</strong> to create, edit, or delete vessel operations.
        </div>
      )}

      <div className="report-filter-panel no-print">
        <div>
          <label>Location</label>
          <select
            name="location_code"
            value={filters.location_code}
            onChange={onFilterChange}
          >
            <option value="">All</option>
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
            <option value="">All</option>
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
            <option value="">All</option>
            <option>Active</option>
            <option>Inactive</option>
          </select>
        </div>

        <div className="report-filter-actions">
          <button type="button" onClick={load} disabled={loading}>
            {loading ? 'Loading...' : 'Load'}
          </button>
        </div>
      </div>

      <div className="two-column-grid">
        <div>
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
                <th>Action</th>
              </tr>
            </thead>

            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan="9" className="empty-table">
                    No vessel operations found.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
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
                    <td>{r.status}</td>
                    <td>
                      <div className="table-actions">
                        <button type="button" onClick={() => startEdit(r)} disabled={!canManageVesselOperation}>
                          Edit
                        </button>
                        <button type="button" onClick={() => remove(r)} disabled={!canManageVesselOperation}>
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div>
          <div className="info-box">
            <strong>{editing ? 'Edit Operation' : 'Create Operation'}</strong>
            <div style={{ marginTop: 10 }} className="operation-entry-subgrid">
              <div>
                <label>Location *</label>
                <select
                  name="location_code"
                  value={form.location_code}
                  onChange={onFormChange}
                  disabled={!canManageVesselOperation || loading}
                >
                  <option value="">Select</option>
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
                  disabled={!canManageVesselOperation || loading}
                >
                  <option value="">Select</option>
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
                  disabled={!canManageVesselOperation || loading}
                />
              </div>

              <div>
                <label>Operation Label *</label>
                <input
                  name="operation_label"
                  value={form.operation_label}
                  onChange={onFormChange}
                  placeholder="Loading / Unloading / STS IN ..."
                  disabled={!canManageVesselOperation || loading}
                />
              </div>

              <div>
                <label>Category *</label>
                <input
                  name="operation_category"
                  value={form.operation_category}
                  onChange={onFormChange}
                  placeholder="LOADING / UNLOADING / STS / DECANTING ..."
                  disabled={!canManageVesselOperation || loading}
                />
              </div>

              <div>
                <label>Sign *</label>
                <select
                  name="operation_sign"
                  value={form.operation_sign}
                  onChange={onFormChange}
                  disabled={!canManageVesselOperation || loading}
                >
                  <option>IN</option>
                  <option>OUT</option>
                  <option>NEUTRAL</option>
                  <option>SET</option>
                </select>
              </div>

              <div>
                <label>Show In</label>
                <select name="show_in" value={form.show_in} onChange={onFormChange} disabled={!canManageVesselOperation || loading}>
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
                  disabled={!canManageVesselOperation || loading}
                />
              </div>

              <div>
                <label>Status</label>
                <select name="status" value={form.status} onChange={onFormChange} disabled={!canManageVesselOperation || loading}>
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
                  disabled={!canManageVesselOperation || loading}
                />
              </div>
            </div>

            <div className="form-actions">
              <button type="button" onClick={save} disabled={loading || !canManageVesselOperation}>
                {loading ? 'Saving...' : editing ? 'Update' : 'Create'}
              </button>
              <button type="button" onClick={resetForm} disabled={loading}>
                Clear
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default VesselOperationMaster
