import { useEffect, useMemo, useState } from 'react'
import {
  createFlowmeterConfig,
  deleteFlowmeterConfig,
  getFlowmeterConfigHistory,
  getFlowmeterConfigs,
  updateFlowmeterConfig,
} from '../api/flowmeterApi'

const emptyForm = {
  id: null,
  locationCode: '',
  assetCode: '',
  streamName: 'Default',
  meterLabel: '',
  meterFactor: '1',
  meterUnit: 'bbls',
  calibrationDate: '',
  remarks: '',
  status: 'Active',
}

function FlowmeterConfigMaster({ locations = [], assets = [], assetAssignments = [], loggedInUser }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [historyRows, setHistoryRows] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [successMsg, setSuccessMsg] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [validationErrors, setValidationErrors] = useState({})
  const [confirmDeleteItem, setConfirmDeleteItem] = useState(null)

  const isAdminBootstrap =
    String(loggedInUser?.username || '').toLowerCase() === 'admin'
  const hasPermission = (permissionName) => {
    if (isAdminBootstrap) return true
    if (!loggedInUser || !Array.isArray(loggedInUser.permissions)) return false
    return loggedInUser.permissions.some(
      (p) => p.permissionName === permissionName
    )
  }
  const canManageFlowmeterConfig = hasPermission('Manage Flowmeter Config')

  const activeAssets = useMemo(() => {
    return (assets || []).filter((a) => String(a.status || '').toLowerCase() === 'active')
  }, [assets])

  const streamAssets = useMemo(() => {
    return activeAssets.filter((a) => {
      const t = String(a.assetTypeCode || '').toUpperCase()
      const n = String(a.assetName || '').toUpperCase()
      return t.includes('STREAM') || n.includes('STREAM') || n.includes('SKID')
    })
  }, [activeAssets])

  const assignedLocationByAssetCode = useMemo(() => {
    const map = {}
    ;(assetAssignments || []).forEach((assignment) => {
      if (String(assignment.status || '').toLowerCase() !== 'active') return
      const code = String(assignment.assetCode || '').trim()
      const locationCode = String(assignment.assignmentLocationCode || '').trim()
      if (!code || !locationCode) return
      if (!map[code]) map[code] = locationCode
    })
    return map
  }, [assetAssignments])

  const locationNameByCode = useMemo(() => {
    const map = {}
    ;(locations || []).forEach((l) => {
      map[l.locationCode] = l.locationName
    })
    return map
  }, [locations])

  const reload = async () => {
    try {
      setLoading(true)
      setHistoryLoading(true)
      const [data, history] = await Promise.all([
        getFlowmeterConfigs(),
        getFlowmeterConfigHistory(),
      ])
      setRows(data)
      setHistoryRows(history)
    } catch (error) {
      setErrorMsg(error?.message || 'Failed to load flowmeter configs')
    } finally {
      setLoading(false)
      setHistoryLoading(false)
    }
  }

  useEffect(() => {
    reload()
  }, [])

  const handleSave = async () => {
    if (!canManageFlowmeterConfig) {
      setErrorMsg('You do not have permission to manage flowmeter configurations.')
      return
    }

    setSuccessMsg('')
    setErrorMsg('')
    setValidationErrors({})

    const errors = {}
    if (!form.assetCode) errors.assetCode = 'Stream asset is required'
    if (!String(form.streamName || '').trim()) errors.streamName = 'Stream Name is required'
    if (!String(form.meterLabel || '').trim()) errors.meterLabel = 'Meter Label is required'
    if (Number(form.meterFactor || 0) <= 0) errors.meterFactor = 'Meter Factor must be greater than 0'
    const assignedLocationCode = assignedLocationByAssetCode[form.assetCode]
    if (!assignedLocationCode && form.assetCode) errors.locationCode = 'Selected stream asset must have an active location assignment'

    setValidationErrors(errors)
    if (Object.keys(errors).length > 0) return

    try {
      setSaving(true)
      const payload = {
        ...form,
        locationCode: assignedLocationCode,
      }
      if (form.id) {
        await updateFlowmeterConfig(form.id, payload)
        setSuccessMsg('Flowmeter config updated')
      } else {
        await createFlowmeterConfig(payload)
        setSuccessMsg('Flowmeter config created')
      }
      setForm(emptyForm)
      await reload()
    } catch (error) {
      setErrorMsg(error?.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const handleEdit = (row) => {
    if (!canManageFlowmeterConfig) {
      setErrorMsg('You do not have permission to manage flowmeter configurations.')
      return
    }

    setForm({
      id: row.id,
      locationCode: row.locationCode,
      assetCode: row.assetCode,
      streamName: row.streamName || 'Default',
      meterLabel: row.meterLabel,
      meterFactor: String(row.meterFactor ?? '1'),
      meterUnit: row.meterUnit || 'bbls',
      calibrationDate: row.calibrationDate || '',
      remarks: row.remarks || '',
      status: row.status || 'Active',
    })
  }

  const handleDelete = async () => {
    if (!canManageFlowmeterConfig) {
      setErrorMsg('You do not have permission to manage flowmeter configurations.')
      return
    }

    setSuccessMsg('')
    setErrorMsg('')
    try {
      setSaving(true)
      await deleteFlowmeterConfig(confirmDeleteItem.id)
      setConfirmDeleteItem(null)
      await reload()
      setSuccessMsg('Flowmeter config deleted')
    } catch (error) {
      setErrorMsg(error?.message || 'Delete failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="page-title">
        <div>
          <h2>Flowmeter Config</h2>
          <p>Configure flowmeters (sub-assets) under selected metering stream asset.</p>
        </div>
      </div>

      {successMsg && (
        <div className="success-box">{successMsg}</div>
      )}

      {errorMsg && (
        <div className="error-box">{errorMsg}</div>
      )}

      {confirmDeleteItem && (
        <div className="confirm-overlay">
          <div className="confirm-box">
            <p>Delete <strong>{confirmDeleteItem.assetCode}</strong> / <strong>{confirmDeleteItem.streamName}</strong> / <strong>{confirmDeleteItem.meterLabel}</strong>?</p>
            <div className="confirm-actions">
              <button onClick={handleDelete} disabled={saving}>
                {saving ? 'Deleting...' : 'Yes, Delete'}
              </button>
              <button onClick={() => setConfirmDeleteItem(null)} disabled={saving}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {!canManageFlowmeterConfig && (
        <div className="info-box">
          You are in view-only mode. Contact an administrator to configure
          flowmeters.
        </div>
      )}

      {canManageFlowmeterConfig && (
      <>
      <div className="form-grid">
        <div>
          <label>Stream Asset *</label>
          <select
            value={form.assetCode}
            onChange={(e) => {
              setForm((p) => ({
                ...p,
                assetCode: e.target.value,
                locationCode: assignedLocationByAssetCode[e.target.value] || '',
                streamName: e.target.value || 'Default',
              }))
              setValidationErrors({ ...validationErrors, assetCode: '' })
            }}
            className={validationErrors.assetCode ? 'input-error' : ''}
          >
            <option value="">Select Stream Asset</option>
            {(streamAssets.length > 0 ? streamAssets : activeAssets).map((a) => (
              <option key={a.assetCode} value={a.assetCode}>{a.assetName} ({a.assetCode})</option>
            ))}
          </select>
          {validationErrors.assetCode && (
            <span className="field-error">{validationErrors.assetCode}</span>
          )}
        </div>

        <div>
          <label>Assigned Location</label>
          <input
            value={
              form.assetCode
                ? `${locationNameByCode[assignedLocationByAssetCode[form.assetCode]] || ''} (${assignedLocationByAssetCode[form.assetCode] || '-'})`
                : ''
            }
            disabled
            placeholder="Auto from active assignment"
          />
        </div>

        <div>
          <label>Stream Code</label>
          <input value={form.streamName} disabled className={validationErrors.streamName ? 'input-error' : ''} />
          {validationErrors.streamName && (
            <span className="field-error">{validationErrors.streamName}</span>
          )}
        </div>

        <div>
          <label>Meter Label *</label>
          <input value={form.meterLabel} onChange={(e) => { setForm((p) => ({ ...p, meterLabel: e.target.value })); setValidationErrors({ ...validationErrors, meterLabel: '' }) }} placeholder="Example: Meter 1" className={validationErrors.meterLabel ? 'input-error' : ''} />
          {validationErrors.meterLabel && (
            <span className="field-error">{validationErrors.meterLabel}</span>
          )}
        </div>

        <div>
          <label>Meter Factor *</label>
          <input type="number" min="0.0001" step="0.0001" value={form.meterFactor} onChange={(e) => { setForm((p) => ({ ...p, meterFactor: e.target.value })); setValidationErrors({ ...validationErrors, meterFactor: '' }) }} className={validationErrors.meterFactor ? 'input-error' : ''} />
          {validationErrors.meterFactor && (
            <span className="field-error">{validationErrors.meterFactor}</span>
          )}
        </div>

        <div>
          <label>Meter Unit *</label>
          <select value={form.meterUnit} onChange={(e) => setForm((p) => ({ ...p, meterUnit: e.target.value }))}>
            <option value="bbls">bbls</option>
            <option value="m3">m3</option>
          </select>
        </div>

        <div>
          <label>Calibration Date</label>
          <input type="date" value={form.calibrationDate} onChange={(e) => setForm((p) => ({ ...p, calibrationDate: e.target.value }))} />
        </div>

        <div>
          <label>Status</label>
          <select value={form.status} onChange={(e) => setForm((p) => ({ ...p, status: e.target.value }))}>
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
          </select>
        </div>

        <div className="full-width-field">
          <label>Remarks</label>
          <input value={form.remarks} onChange={(e) => setForm((p) => ({ ...p, remarks: e.target.value }))} />
        </div>
      </div>

      <div className="form-actions">
        <button type="button" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : form.id ? 'Update Config' : 'Save Config'}
        </button>
        <button type="button" onClick={() => setForm(emptyForm)} disabled={saving}>Clear</button>
      </div>
      </>
      )}

      <div className="section-title">
        <h3>Saved Configs</h3>
      </div>

      {loading ? (
        <div className="info-box">Loading...</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Location</th>
              <th>Stream Asset</th>
              <th>Stream</th>
              <th>Meter Label</th>
              <th>Factor</th>
              <th>Unit</th>
              <th>Calibration Date</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.locationName || row.locationCode}</td>
                <td>{row.assetName || row.assetCode}</td>
                <td>{row.streamName || 'Default'}</td>
                <td>{row.meterLabel}</td>
                <td>{row.meterFactor}</td>
                <td>{row.meterUnit}</td>
                <td>{row.calibrationDate || '-'}</td>
                <td>{row.status}</td>
                <td className="action-buttons">
                  {canManageFlowmeterConfig && (
                    <button type="button" onClick={() => handleEdit(row)}>Edit</button>
                  )}
                  {canManageFlowmeterConfig && (
                    <button type="button" className="danger-button" onClick={() => { setSuccessMsg(''); setErrorMsg(''); setConfirmDeleteItem(row) }}>Delete</button>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={9}>No flowmeter config found.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      )}

      <div className="section-title">
        <h3>Meter History</h3>
      </div>

      {historyLoading ? (
        <div className="info-box">Loading history...</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Changed At</th>
              <th>Stream Asset</th>
              <th>Stream</th>
              <th>Meter Label</th>
              <th>Action</th>
              <th>Old Factor</th>
              <th>New Factor</th>
              <th>Old Unit</th>
              <th>New Unit</th>
              <th>Old Calibration</th>
              <th>New Calibration</th>
              <th>Changed By</th>
            </tr>
          </thead>
          <tbody>
            {historyRows.map((row) => (
              <tr key={row.id}>
                <td>{row.changedAt}</td>
                <td>{row.assetCode}</td>
                <td>{row.streamName || 'Default'}</td>
                <td>{row.meterLabel}</td>
                <td>{row.changeAction}</td>
                <td>{row.oldMeterFactor ?? '-'}</td>
                <td>{row.newMeterFactor ?? '-'}</td>
                <td>{row.oldMeterUnit || '-'}</td>
                <td>{row.newMeterUnit || '-'}</td>
                <td>{row.oldCalibrationDate || '-'}</td>
                <td>{row.newCalibrationDate || '-'}</td>
                <td>{row.changedBy || '-'}</td>
              </tr>
            ))}
            {historyRows.length === 0 ? (
              <tr>
                <td colSpan={12}>No meter history yet.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      )}
    </div>
  )
}

export default FlowmeterConfigMaster
