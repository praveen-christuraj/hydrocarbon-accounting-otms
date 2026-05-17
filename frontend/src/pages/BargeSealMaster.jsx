import { useEffect, useMemo, useState } from 'react'
import { bulkSaveBargeSealMaster, getBargeSealMaster } from '../api/bargeSealApi'

const TANK_POSITIONS = ['MH1', 'MH2', 'LOCK', 'DIPHATCH']

const normalizeText = (v) => String(v || '').trim()

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
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  // grid: { [tankId]: { [sealPos]: sealNumber } }
  const [grid, setGrid] = useState({})
  const [dirty, setDirty] = useState(false)

  const canManage = useMemo(() => {
    return Boolean(
      loggedInUser?.permissions?.some(
        (p) => p.permissionName === 'Manage Barge Seal Master'
      )
    )
  }, [loggedInUser])

  const activeAssets = useMemo(() => {
    return (assets || [])
      .filter((a) => a.status === 'Active')
      .sort((a, b) => (a.assetCode || '').localeCompare(b.assetCode || ''))
  }, [assets])

  const activeCalibrationTable = useMemo(() => {
    if (!selectedAssetCode) return null
    const tables = (assetCalibrationTables || [])
      .filter((t) => t.assetCode === selectedAssetCode && String(t.status) === 'Active')
      .sort((a, b) => String(b.effectiveDate || '').localeCompare(String(a.effectiveDate || '')))
    return tables[0] || null
  }, [assetCalibrationTables, selectedAssetCode])

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
      setError('')
      setMessage('')
      const rows = await getBargeSealMaster(assetCode)
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
      alert(validation)
      return
    }

    try {
      setSaving(true)
      setError('')
      setMessage('')

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
              setMessage('')
              setError('')
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

      {selectedAssetCode && tankIdsFromCalibration.length === 0 ? (
        <div className="section-title compact-section-title">
          <h3>Manual Tank List (only if calibration doesn’t provide tank IDs)</h3>
          <p>Add tank IDs like C1, C2, P1…</p>

          <div className="form-actions">
            <input
              type="text"
              value={manualTankInput}
              placeholder="Tank ID (e.g., C1)"
              onChange={(e) => setManualTankInput(e.target.value)}
              disabled={!canManage}
            />
            <button type="button" onClick={addManualTank} disabled={!canManage}>
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
      {error ? <div className="error-box">{error}</div> : null}
      {message ? <div className="success-box">{message}</div> : null}

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
                        disabled={!canManage}
                        placeholder="Seal No"
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>

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
              disabled={!canManage || saving || loading}
            >
              {saving ? 'Saving...' : dirty ? 'Save Changes' : 'Save'}
            </button>
          </div>

          {!canManage ? (
            <div className="info-box">
              You have view-only access. Assign <strong>Manage Barge Seal Master</strong> to edit.
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  )
}

export default BargeSealMaster