import { useEffect, useMemo, useState } from 'react'
import { getVesselOperations } from '../../api/vesselOperationApi'

const clean = (v) => String(v ?? '').trim()

const findValue = (entry, codes) => {
  for (const c of codes) {
    const v = entry.values.find((x) => x.fieldCode === c)
    if (v) return v
  }
  return null
}

const toNum = (v) => {
  const s = clean(v)
  if (!s) return 0
  const n = Number(s)
  return Number.isFinite(n) ? n : 0
}

function VesselCycleLayout({
  entry,
  editId,
  selectedAsset,
  assets = [],
  locations = [],
  handleValueChange,
}) {
  const seedKey = useMemo(() => {
    return `${editId ?? 'new'}-${entry.operationTemplateId}-${entry.primaryAssetCode}`
  }, [editId, entry.operationTemplateId, entry.primaryAssetCode])

  const [hydratedKey, setHydratedKey] = useState('')
  const [ops, setOps] = useState([])
  const [loadingOps, setLoadingOps] = useState(false)

  const opCodeField = useMemo(
    () => findValue(entry, ['vessel_operation_code']),
    [entry]
  )
  const refField = useMemo(
    () => findValue(entry, ['movement_reference', 'shuttle_number', 'reference_number']),
    [entry]
  )
  const counterpartyField = useMemo(
    () => findValue(entry, ['counterparty_asset_code', 'counterparty_asset']),
    [entry]
  )
  const qtyField = useMemo(
    () => findValue(entry, ['quantity_bbl', 'gross_qty_bbl', 'vessel_qty_bbl']),
    [entry]
  )
  const waterField = useMemo(
    () => findValue(entry, ['water_bbl', 'vessel_water_bbl']),
    [entry]
  )
  const nsvField = useMemo(
    () => findValue(entry, ['nsv_bbl', 'vessel_nsv_bbl']),
    [entry]
  )

  const [local, setLocal] = useState({
    vessel_operation_code: '',
    movement_reference: '',
    counterparty_asset_code: '',
    quantity_bbl: '',
    water_bbl: '',
  })

  useEffect(() => {
    if (hydratedKey === seedKey) return

    setLocal({
      vessel_operation_code: clean(opCodeField?.fieldValue),
      movement_reference: clean(refField?.fieldValue),
      counterparty_asset_code: clean(counterpartyField?.fieldValue),
      quantity_bbl: clean(qtyField?.fieldValue),
      water_bbl: clean(waterField?.fieldValue),
    })

    setHydratedKey(seedKey)
  }, [seedKey, hydratedKey, opCodeField, refField, counterpartyField, qtyField, waterField])

  const locationCode = clean(entry.originLocationCode)
  const assetTypeCode = clean(selectedAsset?.assetTypeCode)

  useEffect(() => {
    const shouldLoad = locationCode && assetTypeCode
    if (!shouldLoad) {
      setOps([])
      return
    }

    let cancelled = false

    const loadOps = async () => {
      try {
        setLoadingOps(true)
        const data = await getVesselOperations({
          location_code: locationCode,
          applicable_asset_type_code: assetTypeCode,
          status: 'Active',
        })
        if (!cancelled) setOps(Array.isArray(data) ? data : [])
      } catch (e) {
        if (!cancelled) setOps([])
      } finally {
        if (!cancelled) setLoadingOps(false)
      }
    }

    loadOps()

    return () => {
      cancelled = true
    }
  }, [locationCode, assetTypeCode])

  const selectedOp = useMemo(() => {
    return ops.find((o) => o.operation_code === local.vessel_operation_code) || null
  }, [ops, local.vessel_operation_code])

  const nsv = useMemo(() => {
    return toNum(local.quantity_bbl) - toNum(local.water_bbl)
  }, [local.quantity_bbl, local.water_bbl])

  useEffect(() => {
    if (nsvField) {
      handleValueChange(nsvField.fieldCode, String(nsv))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nsv])

  const counterpartyOptions = useMemo(() => {
    return assets
      .filter((a) => a.status === 'Active')
      .map((a) => ({
        code: a.assetCode,
        name: a.assetName,
        type: a.assetTypeCode,
      }))
  }, [assets])

  const onChange = (key, value) => {
    setLocal((c) => ({ ...c, [key]: value }))

    if (key === 'vessel_operation_code' && opCodeField) {
      handleValueChange(opCodeField.fieldCode, value)
    }

    if (key === 'movement_reference' && refField) {
      handleValueChange(refField.fieldCode, value)
    }

    if (key === 'counterparty_asset_code' && counterpartyField) {
      handleValueChange(counterpartyField.fieldCode, value)
    }

    if (key === 'quantity_bbl' && qtyField) {
      handleValueChange(qtyField.fieldCode, value)
    }

    if (key === 'water_bbl' && waterField) {
      handleValueChange(waterField.fieldCode, value)
    }
  }

  return (
    <div className="full-width-field">
      <div className="operation-special-layout">
        <div className="operation-special-layout-header">
          <h3>Vessel Cycle Entry</h3>
          <p>
            Shuttle vessel manual entry (no calibration). Select a soft-coded
            operation (Loading/Unloading/STS/etc) and enter quantity + water.
          </p>
        </div>

        {!locationCode && (
          <div className="info-box">
            Select Origin Location in header to load vessel operations.
          </div>
        )}

        {!assetTypeCode && (
          <div className="info-box">
            Select a Shuttle Vessel asset to load vessel operations.
          </div>
        )}

        <div className="operation-entry-subgrid">
          <div className="full-width-field">
            <label>Operation *</label>
            <select
              value={local.vessel_operation_code}
              onChange={(e) => onChange('vessel_operation_code', e.target.value)}
              disabled={loadingOps || ops.length === 0 || !opCodeField}
              title={!opCodeField ? 'Add field_code vessel_operation_code to the template' : ''}
            >
              <option value="">
                {loadingOps ? 'Loading...' : 'Select Operation'}
              </option>
              {ops.map((o) => (
                <option key={o.id} value={o.operation_code}>
                  {o.operation_label} ({o.operation_sign})
                </option>
              ))}
            </select>

            {selectedOp && (
              <div style={{ marginTop: 6, color: '#475569', fontSize: 13 }}>
                Category: <strong>{selectedOp.operation_category}</strong> | Sign:{' '}
                <strong>{selectedOp.operation_sign}</strong>
              </div>
            )}
          </div>

          <div>
            <label>Shuttle / Reference No</label>
            <input
              value={local.movement_reference}
              onChange={(e) => onChange('movement_reference', e.target.value)}
              placeholder="Shuttle No / Voyage No"
              disabled={!refField}
              title={!refField ? 'Add field_code movement_reference OR shuttle_number to template' : ''}
            />
          </div>

          <div>
            <label>Counterparty Asset</label>
            <select
              value={local.counterparty_asset_code}
              onChange={(e) => onChange('counterparty_asset_code', e.target.value)}
              disabled={!counterpartyField}
              title={!counterpartyField ? 'Add field_code counterparty_asset_code to template' : ''}
            >
              <option value="">Optional</option>
              {counterpartyOptions.map((a) => (
                <option key={a.code} value={a.code}>
                  {a.name} ({a.code}) - {a.type}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label>Quantity (bbl)</label>
            <input
              type="number"
              value={local.quantity_bbl}
              onChange={(e) => onChange('quantity_bbl', e.target.value)}
              disabled={!qtyField}
              title={!qtyField ? 'Add field_code quantity_bbl (or gross_qty_bbl) to template' : ''}
            />
          </div>

          <div>
            <label>Water (bbl)</label>
            <input
              type="number"
              value={local.water_bbl}
              onChange={(e) => onChange('water_bbl', e.target.value)}
              disabled={!waterField}
              title={!waterField ? 'Add field_code water_bbl to template' : ''}
            />
          </div>

          <div>
            <label>NSV (auto)</label>
            <input type="number" value={String(nsv)} readOnly />
          </div>
        </div>

        <div className="info-box">
          <strong>Note:</strong> Operation labels/stages are soft-coded from Vessel
          Operation Master. Configure them per location + asset type.
        </div>
      </div>
    </div>
  )
}

export default VesselCycleLayout