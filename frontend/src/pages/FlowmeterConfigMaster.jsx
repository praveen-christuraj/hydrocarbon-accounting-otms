import { useEffect, useMemo, useState } from 'react'
import {
  createFlowmeterConfig,
  deleteFlowmeterConfig,
  getFlowmeterConfigHistory,
  getFlowmeterConfigs,
  updateFlowmeterConfig,
} from '../api/flowmeterApi'
import PaginationControls, { paginateRows, usePageSize } from '../components/common/PaginationControls'
import DataTableToolbar from '../components/common/DataTableToolbar'
import { useDataFilters } from '../hooks/useDataFilters'
import { useAutoColumns } from '../hooks/useAutoColumns'
import AlertMessage from '../components/common/AlertMessage'
import FormDialog from '../components/common/FormDialog'
import Icon from '../components/common/Icon'
import { usePermissions } from '../hooks/usePermissions'
import { logUiAction } from '../utils/actionLogger'

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
  const [configPage, setConfigPage] = useState(1)
  const pageSize = usePageSize()
  const [historyPage, setHistoryPage] = useState(1)

  const rowsFilters = useDataFilters(rows, useAutoColumns(rows), { module: 'Flowmeter Config' })
  const historyRowsFilters = useDataFilters(historyRows, useAutoColumns(historyRows), { module: 'Flowmeter Config' })
  const visibleRows = paginateRows(rowsFilters.filteredRows, configPage, pageSize)
  const visibleHistoryRows = paginateRows(historyRowsFilters.filteredRows, historyPage, pageSize)

  useEffect(() => {
    setConfigPage(1)
  }, [rows.length])

  useEffect(() => {
    setHistoryPage(1)
  }, [historyRows.length])

  const { hasPermission } = usePermissions(loggedInUser)
  const canCreate = hasPermission('Create Flowmeter Config')
  const canEdit = hasPermission('Edit Flowmeter Config')
  const canDelete = hasPermission('Delete Flowmeter Config')
  const [formOpen, setFormOpen] = useState(false)

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
    if (!(form.id ? canEdit : canCreate)) {
      setErrorMsg(`You do not have permission to ${form.id ? 'edit' : 'create'} flowmeter configurations.`)
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
      setFormOpen(false)
      await reload()
    } catch (error) {
      setErrorMsg(error?.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const handleEdit = (row) => {
    if (!canEdit) {
      setErrorMsg('You do not have permission to edit flowmeter configurations.')
      return
    }
    setSuccessMsg('')
    setErrorMsg('')
    setValidationErrors({})
    setFormOpen(true)
    logUiAction('Flowmeter Config', 'Open Edit Dialog', { meterLabel: row.meterLabel })

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

  /* -------------------------------------------------------- bulk upload */

  const CONFIG_STATUSES = ['Active', 'Inactive', 'Blocked']

  const importConfig = {
    title: 'Bulk upload flowmeter configurations',
    description:
      'Upload an Excel (.xlsx) or CSV file. Configurations are matched on Stream Asset + Stream Name + Meter Label and updated when they already exist. The location is taken from the active assignment of the stream asset.',
    templateFileName: 'flowmeter-config',
    fields: [
      { key: 'assetCode', label: 'Stream Asset Code', required: true, example: 'STREAM-01', aliases: ['Asset', 'Asset Code'] },
      { key: 'streamName', label: 'Stream Name', required: true, example: 'Default' },
      { key: 'meterLabel', label: 'Meter Label', required: true, example: 'Meter 1' },
      { key: 'meterFactor', label: 'Meter Factor', required: true, example: '1', hint: 'Must be greater than 0' },
      { key: 'meterUnit', label: 'Meter Unit', example: 'bbls' },
      { key: 'calibrationDate', label: 'Calibration Date', example: new Date().toISOString().slice(0, 10), hint: 'YYYY-MM-DD' },
      { key: 'remarks', label: 'Remarks', example: '' },
      { key: 'status', label: 'Status', options: CONFIG_STATUSES, defaultValue: 'Active', example: 'Active' },
    ],
    validateRow: (record) => {
      const assetCode = String(record.assetCode || '').trim()
      if (!streamAssets.some((item) => String(item.assetCode) === assetCode)) {
        return `Unknown stream asset code "${assetCode}"`
      }
      if (!assignedLocationByAssetCode[assetCode]) {
        return `Stream asset "${assetCode}" has no active location assignment`
      }
      if (!(Number(record.meterFactor) > 0)) {
        return 'Meter Factor must be greater than 0'
      }
      if (record.status && !CONFIG_STATUSES.includes(record.status)) {
        return `Status must be one of ${CONFIG_STATUSES.join(', ')}`
      }
      return null
    },
    onImportRow: async (record) => {
      const assetCode = String(record.assetCode || '').trim()
      const payload = {
        ...emptyForm,
        ...record,
        assetCode,
        locationCode: assignedLocationByAssetCode[assetCode],
        meterFactor: String(record.meterFactor),
        status: record.status || 'Active',
      }
      const existing = rows.find(
        (item) =>
          String(item.assetCode) === payload.assetCode &&
          String(item.streamName || '').toLowerCase() === String(payload.streamName).toLowerCase() &&
          String(item.meterLabel || '').toLowerCase() === String(payload.meterLabel).toLowerCase()
      )
      if (existing) {
        await updateFlowmeterConfig(existing.id, { ...payload, id: existing.id })
      } else {
        await createFlowmeterConfig(payload)
      }
    },
    onComplete: async () => {
      await reload()
    },
  }

  const openCreate = () => {
    setForm(emptyForm)
    setSuccessMsg('')
    setErrorMsg('')
    setValidationErrors({})
    setFormOpen(true)
    logUiAction('Flowmeter Config', 'Open Create Dialog')
  }

  const closeForm = () => {
    setForm(emptyForm)
    setErrorMsg('')
    setValidationErrors({})
    setFormOpen(false)
  }

  const handleDelete = async () => {
    if (!canDelete) {
      setErrorMsg('You do not have permission to delete flowmeter configurations.')
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
        <div className="page-title-actions">
          {canCreate && (<button type="button" className="btn-primary" onClick={openCreate}><Icon name="plus" size={15} />New Flowmeter Config</button>)}
          <span className="record-count">{rows.length} Configs</span>
        </div>
      </div>

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

      {!formOpen && <AlertMessage tone="success" message={successMsg} onDismiss={() => setSuccessMsg('')} />}
      {!formOpen && <AlertMessage tone="error" message={errorMsg} onDismiss={() => setErrorMsg('')} />}

      {!canCreate && !canEdit && !canDelete && (
        <div className="info-box">You have view-only access to Flowmeter Config.</div>
      )}

      <FormDialog
        open={formOpen}
        title={form.id ? 'Edit Flowmeter Config' : 'New Flowmeter Config'}
        description="Flowmeters are configured under a metering stream asset with an active location assignment."
        size="lg"
        columns={3}
        submitLabel={form.id ? 'Update Config' : 'Save Config'}
        busy={saving}
        error={errorMsg}
        onDismissError={() => setErrorMsg('')}
        onSubmit={handleSave}
        onCancel={closeForm}
      >
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
      </FormDialog>

      <div className="section-title">
        <h3>Saved Configs</h3>
      </div>

      {loading ? (
        <div className="info-box">Loading...</div>
      ) : (
        <>
          <DataTableToolbar
            filters={rowsFilters}
            columns={rowsFilters.columns}
            exportFileName="flowmeter-config-rows"
            exportTitle="Flowmeter Config"
            module="Flowmeter Config"
            importConfig={importConfig}
            canImport={canCreate}
          />

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
                {(canEdit || canDelete) && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr key={row.id}>
                  <td>{row.locationName || row.locationCode}</td>
                  <td>{row.assetName || row.assetCode}</td>
                  <td>{row.streamName || 'Default'}</td>
                  <td>{row.meterLabel}</td>
                  <td>{row.meterFactor}</td>
                  <td>{row.meterUnit}</td>
                  <td>{row.calibrationDate || '-'}</td>
                  <td><span className={`status-badge ${String(row.status || '').toLowerCase()}`}>{row.status}</span></td>
                  {(canEdit || canDelete) && (
                    <td className="row-actions">
                      {canEdit && (
                        <button type="button" onClick={() => handleEdit(row)}>Edit</button>
                      )}
                      {canDelete && (
                        <button type="button" onClick={() => { setSuccessMsg(''); setErrorMsg(''); setConfirmDeleteItem(row) }}>Delete</button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={canEdit || canDelete ? 9 : 8} className="empty-table">No flowmeter config found.</td>
                </tr>
              ) : null}
            </tbody>
          </table>

          <PaginationControls currentPage={configPage} totalRows={rowsFilters.filteredRows.length} onPageChange={setConfigPage} />
        </>
      )}

      <div className="section-title">
        <h3>Meter History</h3>
      </div>

      {historyLoading ? (
        <div className="info-box">Loading history...</div>
      ) : (
        <>
          <DataTableToolbar
            filters={historyRowsFilters}
            columns={historyRowsFilters.columns}
            exportFileName="flowmeter-config-history-rows"
            exportTitle="Flowmeter Config History"
            module="Flowmeter Config"
          />

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
              {visibleHistoryRows.map((row) => (
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

          <PaginationControls currentPage={historyPage} totalRows={historyRowsFilters.filteredRows.length} onPageChange={setHistoryPage} />
        </>
      )}
    </div>
  )
}

export default FlowmeterConfigMaster
