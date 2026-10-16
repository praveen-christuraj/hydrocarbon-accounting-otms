import { useEffect, useMemo, useState } from 'react'
import { bulkSaveBargeSealMaster, getBargeSealMaster } from '../api/bargeSealApi'
import { useActiveCalibrationTable } from '../hooks/useActiveCalibrationTable'
import { usePermissions } from '../hooks/usePermissions'
import { useBulkTemplates } from '../hooks/useBulkTemplates'
import ImportDialog from '../components/common/ImportDialog'
import ExportMenu from '../components/common/ExportMenu'
import Icon from '../components/common/Icon'
import { logUiAction } from '../utils/actionLogger'
import AlertMessage from '../components/common/AlertMessage'
import useActionFeedback from '../hooks/useActionFeedback'

const TANK_POSITIONS = ['MH1', 'MH2', 'LOCK', 'DIPHATCH']
const SEAL_STATUSES = ['Active', 'Inactive']

const normalizeText = (v) => String(v || '').trim()

const IMPORT_FIELDS = [
  {
    key: 'assetCode',
    label: 'Asset Code',
    required: true,
    example: 'BRG-001',
    hint: 'Must match an existing active asset',
    aliases: ['Asset', 'Barge', 'Barge Code'],
  },
  { key: 'tankId', label: 'Tank ID', required: true, example: 'C1', aliases: ['Tank', 'Tank No'] },
  {
    key: 'sealPosition',
    label: 'Seal Position',
    required: true,
    options: TANK_POSITIONS,
    example: 'MH1',
    hint: `One of ${TANK_POSITIONS.join(', ')}`,
    aliases: ['Position'],
  },
  {
    key: 'sealNumber',
    label: 'Seal Number',
    required: true,
    example: 'SL-10021',
    aliases: ['Seal No', 'Seal'],
  },
  { key: 'remarks', label: 'Remarks', example: '' },
  {
    key: 'status',
    label: 'Status',
    options: SEAL_STATUSES,
    defaultValue: 'Active',
    example: 'Active',
  },
]

function BargeSealMaster({
  assets,
  assetCalibrationTables,
  calibrationTemplates,
  loggedInUser,
}) {
  const [selectedAssetCode, setSelectedAssetCode] = useState('')
  const [manualTankInput, setManualTankInput] = useState('')
  const [manualTankIds, setManualTankIds] = useState([])

  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  // Action feedback: little pop-up (toast) + inline message next to the
  // Save action (owner rule 8).
  const feedback = useActionFeedback()
  const {
    successMsg: message,
    errorMsg: error,
    notifySuccess: setMessage,
    notifyError: setError,
    clearSuccess,
    clearError,
  } = feedback

  // grid: { [tankId]: { [sealPos]: sealNumber } }
  const [grid, setGrid] = useState({})
  const [dirty, setDirty] = useState(false)
  // raw rows as stored on the server – used for the export file
  const [sealRows, setSealRows] = useState([])
  const [importOpen, setImportOpen] = useState(false)

  const { hasPermission } = usePermissions(loggedInUser)
  const canEditBargeSeal = hasPermission('Edit Barge Seal Master')

  const bulkTemplates = useBulkTemplates('Barge Seal Master', IMPORT_FIELDS)

  const activeAssets = useMemo(() => {
    return (assets || [])
      .filter((a) => a.status === 'Active')
      .sort((a, b) => (a.assetCode || '').localeCompare(b.assetCode || ''))
  }, [assets])

  // Active calibration table for the selected asset, with the rows that list
  // the tank IDs it covers fetched on demand (the calibration list is lean).
  const {
    table: activeCalibrationTable,
    loading: calibrationLoading,
    error: calibrationError,
  } = useActiveCalibrationTable({
    assetCalibrationTables,
    assetCode: selectedAssetCode,
  })

  const calibrationTemplate = useMemo(() => {
    if (!activeCalibrationTable) return null
    return (calibrationTemplates || []).find(
      (t) => Number(t.id) === Number(activeCalibrationTable.templateId)
    )
  }, [calibrationTemplates, activeCalibrationTable])

  const referenceColName = useMemo(() => {
    const cols = calibrationTemplate?.columns || []
    const ref = cols.find((c) => c.interpolationRole === 'Reference')
    return ref?.columnName || null
  }, [calibrationTemplate])

  const tankIdsFromCalibration = useMemo(() => {
    if (!activeCalibrationTable || !referenceColName) return []
    const rows = activeCalibrationTable.rows || []
    const out = new Set()

    for (const r of rows) {
      const d = r.rowData || r.row_data || {}
      const raw = d[referenceColName]
      const tank = normalizeText(raw)
      if (tank) out.add(tank)
    }

    return Array.from(out).sort((a, b) => a.localeCompare(b))
  }, [activeCalibrationTable, referenceColName])

  const tankIds = useMemo(() => {
    return tankIdsFromCalibration.length > 0 ? tankIdsFromCalibration : manualTankIds
  }, [tankIdsFromCalibration, manualTankIds])

  const rebuildGrid = (rowsFromApi = []) => {
    const next = {}

    // init empty
    for (const tid of tankIds) {
      next[tid] = {}
      for (const pos of TANK_POSITIONS) next[tid][pos] = ''
    }

    // fill from API (only keep tank positions; ignore any extra records in DB)
    for (const row of rowsFromApi) {
      const tid = normalizeText(row.tankId)
      const pos = normalizeText(row.sealPosition).toUpperCase()
      if (!tid || !pos) continue
      if (!TANK_POSITIONS.includes(pos)) continue
      if (!next[tid]) next[tid] = {}
      next[tid][pos] = normalizeText(row.sealNumber)
    }

    setGrid(next)
    setDirty(false)
  }

  const loadMaster = async (assetCode) => {
    if (!assetCode) return
    try {
      setLoading(true)
      clearError()
      clearSuccess()
      const rows = await getBargeSealMaster(assetCode)
      setSealRows(rows || [])
      rebuildGrid(rows)
    } catch (e) {
      setError(e?.message || 'Failed to load barge seal master')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!selectedAssetCode) return
    loadMaster(selectedAssetCode)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAssetCode, referenceColName])

  const updateCell = (tankId, sealPosition, value) => {
    setGrid((prev) => ({
      ...prev,
      [tankId]: { ...(prev[tankId] || {}), [sealPosition]: value },
    }))
    setDirty(true)
  }

  const addManualTank = () => {
    const t = normalizeText(manualTankInput)
    if (!t) return
    if (manualTankIds.includes(t)) {
      setManualTankInput('')
      return
    }
    setManualTankIds((prev) => [...prev, t].sort((a, b) => a.localeCompare(b)))
    setManualTankInput('')
  }

  const validateBeforeSave = () => {
    if (!selectedAssetCode) return 'Please select an Asset'
    if (tankIds.length === 0) {
      return 'No tanks detected. Upload calibration with tank Reference column, or add tanks manually.'
    }

    const missing = []
    for (const tid of tankIds) {
      for (const pos of TANK_POSITIONS) {
        const val = grid?.[tid]?.[pos]
        if (!normalizeText(val)) missing.push(`${tid}/${pos}`)
      }
    }

    if (missing.length > 0) {
      return `Please fill all permanent tank seals. Missing: ${missing.slice(0, 12).join(', ')}${missing.length > 12 ? ' ...' : ''}`
    }

    return null
  }

  const handleSave = async () => {
    const validation = validateBeforeSave()
    if (validation) {
      setError(validation)
      return
    }

    try {
      setSaving(true)
      clearError()
      clearSuccess()

      const rows = []
      for (const tid of tankIds) {
        for (const pos of TANK_POSITIONS) {
          rows.push({
            tankId: tid,
            sealPosition: pos,
            sealNumber: grid[tid][pos],
            status: 'Active',
          })
        }
      }

      await bulkSaveBargeSealMaster({
        assetCode: selectedAssetCode,
        effectiveDate: null,
        rows,
      })

      setMessage('Barge Seal Master (Permanent Tank Seals) saved successfully.')
      await loadMaster(selectedAssetCode)
    } catch (e) {
      setError(e?.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  /* ------------------------------------------------- bulk upload / export */

  const exportColumns = useMemo(
    () => [
      { key: 'assetCode', label: 'Asset Code' },
      { key: 'tankId', label: 'Tank ID' },
      { key: 'sealPosition', label: 'Seal Position' },
      { key: 'sealNumber', label: 'Seal Number' },
      { key: 'status', label: 'Status' },
      { key: 'remarks', label: 'Remarks' },
    ],
    []
  )

  const exportRows = useMemo(
    () =>
      (sealRows || [])
        .filter((row) => !selectedAssetCode || normalizeText(row.assetCode) === selectedAssetCode)
        .map((row) => ({
          assetCode: row.assetCode,
          tankId: row.tankId,
          sealPosition: normalizeText(row.sealPosition).toUpperCase(),
          sealNumber: row.sealNumber,
          status: row.status,
          remarks: row.remarks || '',
        }))
        .sort(
          (a, b) =>
            a.tankId.localeCompare(b.tankId) || a.sealPosition.localeCompare(b.sealPosition)
        ),
    [sealRows, selectedAssetCode]
  )

  /**
   * The seal API replaces the whole set for an asset, so merge the uploaded
   * rows over whatever is already stored instead of dropping the seals the
   * file does not mention.
   */
  const handleImportBatch = async (items) => {
    const overrides = []
    const byAsset = new Map()
    const seen = new Set()

    items.forEach(({ rowNumber, record }) => {
      const assetCode = normalizeText(record.assetCode)
      const tankId = normalizeText(record.tankId)
      const sealPosition = normalizeText(record.sealPosition).toUpperCase()
      const key = `${assetCode.toUpperCase()}|${tankId.toUpperCase()}|${sealPosition}`

      if (seen.has(key)) {
        overrides.push({
          rowNumber,
          status: 'skipped',
          message: `Duplicate seal for ${tankId}/${sealPosition} in this file`,
        })
        return
      }
      seen.add(key)

      if (!byAsset.has(assetCode)) byAsset.set(assetCode, [])
      byAsset.get(assetCode).push({
        rowNumber,
        row: {
          tankId,
          sealPosition,
          sealNumber: normalizeText(record.sealNumber),
          remarks: normalizeText(record.remarks),
          status: record.status || 'Active',
        },
      })
    })

    for (const [assetCode, entries] of byAsset) {
      try {
        const existing = await getBargeSealMaster(assetCode)
        const merged = new Map()
        ;(existing || []).forEach((row) => {
          const tankId = normalizeText(row.tankId)
          const sealPosition = normalizeText(row.sealPosition).toUpperCase()
          if (!tankId || !sealPosition) return
          merged.set(`${tankId.toUpperCase()}|${sealPosition}`, {
            tankId,
            sealPosition,
            sealNumber: normalizeText(row.sealNumber),
            remarks: normalizeText(row.remarks),
            status: row.status || 'Active',
          })
        })
        entries.forEach(({ row }) => {
          merged.set(`${row.tankId.toUpperCase()}|${row.sealPosition}`, row)
        })

        await bulkSaveBargeSealMaster({
          assetCode,
          effectiveDate: null,
          rows: Array.from(merged.values()),
        })
      } catch (err) {
        const failure = err?.message || 'Save failed'
        entries.forEach(({ rowNumber }) =>
          overrides.push({ rowNumber, status: 'failed', message: failure })
        )
      }
    }

    if (byAsset.has(selectedAssetCode)) {
      await loadMaster(selectedAssetCode)
    }

    return overrides
  }

  const validateImportRow = (record) => {
    const assetCode = normalizeText(record.assetCode)
    const sealPosition = normalizeText(record.sealPosition).toUpperCase()
    const match = activeAssets.find(
      (asset) => normalizeText(asset.assetCode).toUpperCase() === assetCode.toUpperCase()
    )
    if (!match) return `Unknown or inactive asset code "${assetCode}"`
    if (!TANK_POSITIONS.includes(sealPosition)) {
      return `Seal position must be one of ${TANK_POSITIONS.join(', ')}`
    }
    return null
  }

  const openImport = () => {
    clearError()
    clearSuccess()
    setImportOpen(true)
    logUiAction('Barge Seal Master', 'Open Bulk Upload Dialog')
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h2>Barge Seal Master</h2>
          <p>
            Permanent tank seals only (MH1/MH2/LOCK/DIPHATCH). Temporary seals
            (manifold/pumproom) will be entered per movement ticket.
          </p>
        </div>

        <div className="page-header-actions">
          {canEditBargeSeal && (
            <button type="button" className="btn-secondary" onClick={openImport}>
              <Icon name="upload" size={15} />
              Bulk Upload
            </button>
          )}
          <ExportMenu
            rows={exportRows}
            columns={exportColumns}
            fileName="barge-seal-master"
            title="Barge Seal Master"
            subtitle={selectedAssetCode ? `Asset ${selectedAssetCode}` : undefined}
            module="Barge Seal Master"
            generatedBy={loggedInUser?.full_name || loggedInUser?.username}
          />
        </div>
      </div>

      <div className="section-title">
        <h3>Selection</h3>
        <p>Select a barge asset. Tank list is derived from the active calibration table.</p>
      </div>

      <div className="form-grid">
        <div>
          <label>Asset</label>
          <select
            value={selectedAssetCode}
            onChange={(e) => {
              setSelectedAssetCode(e.target.value)
              clearSuccess()
              clearError()
            }}
          >
            <option value="">-- Select Asset --</option>
            {activeAssets.map((a) => (
              <option key={a.assetCode} value={a.assetCode}>
                {a.assetName} ({a.assetCode})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label>Tank Source</label>
          <input
            type="text"
            value={
              tankIdsFromCalibration.length > 0
                ? `From Calibration (${tankIdsFromCalibration.length} tanks)`
                : 'Manual (no calibration reference found)'
            }
            disabled
          />
        </div>
      </div>

      {!selectedAssetCode ? (
        <div className="info-box">Select an asset to load the seal master.</div>
      ) : null}

      {calibrationLoading ? (
        <div className="info-box">Loading calibration data…</div>
      ) : null}

      {calibrationError ? <div className="error-box">{calibrationError}</div> : null}

      {selectedAssetCode && !calibrationLoading && tankIdsFromCalibration.length === 0 ? (
        <div className="section-title compact-section-title">
          <h3>Manual Tank List (only if calibration doesn’t provide tank IDs)</h3>
          <p>Add tank IDs like C1, C2, P1…</p>

          <div className="form-actions">
            <input
              type="text"
              value={manualTankInput}
              placeholder="Tank ID (e.g., C1)"
              onChange={(e) => setManualTankInput(e.target.value)}
              disabled={!canEditBargeSeal}
            />
            <button type="button" onClick={addManualTank} disabled={!canEditBargeSeal}>
              Add Tank
            </button>
          </div>

          {manualTankIds.length > 0 ? (
            <div className="info-box">
              Tanks: <strong>{manualTankIds.join(', ')}</strong>
            </div>
          ) : null}
        </div>
      ) : null}

      {loading ? <div className="info-box">Loading seal master...</div> : null}

      {selectedAssetCode && tankIds.length > 0 ? (
        <>
          <div className="section-title">
            <h3>Permanent Tank Seals</h3>
            <p>Fill MH1 / MH2 / LOCK / DIPHATCH for each tank.</p>
          </div>

          <table>
            <thead>
              <tr>
                <th>Tank</th>
                {TANK_POSITIONS.map((p) => (
                  <th key={p}>{p}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tankIds.map((tid) => (
                <tr key={tid}>
                  <td><strong>{tid}</strong></td>
                  {TANK_POSITIONS.map((pos) => (
                    <td key={`${tid}-${pos}`}>
                      <input
                        type="text"
                        value={grid?.[tid]?.[pos] ?? ''}
                        onChange={(e) => updateCell(tid, pos, e.target.value)}
                        disabled={!canEditBargeSeal}
                        placeholder="Seal No"
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>

          {/* Action feedback lives right next to the Save / Reload buttons. */}
          <AlertMessage tone="success" message={message} onDismiss={clearSuccess} />
          <AlertMessage tone="error" message={error} onDismiss={clearError} />

          <div className="form-actions" style={{ marginTop: 16 }}>
            <button
              type="button"
              onClick={() => loadMaster(selectedAssetCode)}
              disabled={!selectedAssetCode || loading || saving}
            >
              Reload From Server
            </button>

            <button
              type="button"
              onClick={handleSave}
              disabled={!canEditBargeSeal || saving || loading}
            >
              {saving ? 'Saving...' : dirty ? 'Save Changes' : 'Save'}
            </button>
          </div>

          {!canEditBargeSeal ? (
            <div className="info-box">
              You have view-only access. Assign <strong>Edit Barge Seal Master</strong> to edit.
            </div>
          ) : null}
        </>
      ) : null}

      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="Bulk upload barge seals"
        description="Upload an Excel (.xlsx) or CSV file. Download the template, fill it in and upload it back. Uploaded seals are merged over the seals already stored for the asset."
        module="Barge Seal Master"
        templateFileName="barge-seal-master"
        fields={bulkTemplates.fields}
        templates={bulkTemplates.templates}
        activeTemplateId={bulkTemplates.activeTemplateId}
        onSelectTemplate={bulkTemplates.select}
        onSaveTemplate={bulkTemplates.saveAs}
        onDeleteTemplate={bulkTemplates.remove}
        columns={bulkTemplates.columns}
        onToggleColumn={bulkTemplates.toggleColumn}
        onMoveColumn={bulkTemplates.moveColumn}
        onResetTemplate={bulkTemplates.reset}
        canConfigure={bulkTemplates.canConfigure}
        validateRow={validateImportRow}
        onImportBatch={handleImportBatch}
        onComplete={async (summary) => {
          if (selectedAssetCode) await loadMaster(selectedAssetCode)
          if (summary.failed === 0 && summary.skipped === 0) {
            setMessage(`${summary.success} seal row(s) uploaded successfully.`)
          } else {
            setError(
              `Upload finished: ${summary.success} imported, ${summary.skipped} skipped, ${summary.failed} failed.`
            )
          }
        }}
      />
    </div>
  )
}

export default BargeSealMaster
