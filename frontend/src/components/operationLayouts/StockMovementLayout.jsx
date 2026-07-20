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

function StockMovementLayout({
  entry,
  editId,
  selectedAsset,
  assets = [],
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
    () => findValue(entry, ['movement_reference', 'reference_number']),
    [entry]
  )
  const openingStockField = useMemo(
    () => findValue(entry, ['opening_stock', 'opening_qty']),
    [entry]
  )
  const openingWaterField = useMemo(
    () => findValue(entry, ['opening_water']),
    [entry]
  )
  const closingStockField = useMemo(
    () => findValue(entry, ['closing_stock', 'closing_qty']),
    [entry]
  )
  const closingWaterField = useMemo(
    () => findValue(entry, ['closing_water']),
    [entry]
  )
  const netStockField = useMemo(
    () => findValue(entry, ['net_stock', 'net_qty']),
    [entry]
  )
  const netWaterField = useMemo(
    () => findValue(entry, ['net_water']),
    [entry]
  )
  const netNsvField = useMemo(
    () => findValue(entry, ['net_nsv']),
    [entry]
  )

  const [local, setLocal] = useState({
    vessel_operation_code: '',
    movement_reference: '',
    opening_stock: '',
    opening_water: '',
    closing_stock: '',
    closing_water: '',
  })

  useEffect(() => {
    if (hydratedKey === seedKey) return

    setLocal({
      vessel_operation_code: clean(opCodeField?.fieldValue),
      movement_reference: clean(refField?.fieldValue),
      opening_stock: clean(openingStockField?.fieldValue),
      opening_water: clean(openingWaterField?.fieldValue),
      closing_stock: clean(closingStockField?.fieldValue),
      closing_water: clean(closingWaterField?.fieldValue),
    })

    setHydratedKey(seedKey)
  }, [
    seedKey,
    hydratedKey,
    opCodeField,
    refField,
    openingStockField,
    openingWaterField,
    closingStockField,
    closingWaterField,
  ])

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

  const netStock = useMemo(() => {
    return toNum(local.closing_stock) - toNum(local.opening_stock)
  }, [local.closing_stock, local.opening_stock])

  const netWater = useMemo(() => {
    return toNum(local.closing_water) - toNum(local.opening_water)
  }, [local.closing_water, local.opening_water])

  const netNsv = useMemo(() => {
    return netStock - netWater
  }, [netStock, netWater])

  useEffect(() => {
    if (netStockField) handleValueChange(netStockField.fieldCode, String(netStock))
    if (netWaterField) handleValueChange(netWaterField.fieldCode, String(netWater))
    if (netNsvField) handleValueChange(netNsvField.fieldCode, String(netNsv))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [netStock, netWater, netNsv])

  const onChange = (key, value) => {
    setLocal((c) => ({ ...c, [key]: value }))

    if (key === 'vessel_operation_code' && opCodeField) {
      handleValueChange(opCodeField.fieldCode, value)
    }
    if (key === 'movement_reference' && refField) {
      handleValueChange(refField.fieldCode, value)
    }
    if (key === 'opening_stock' && openingStockField) {
      handleValueChange(openingStockField.fieldCode, value)
    }
    if (key === 'opening_water' && openingWaterField) {
      handleValueChange(openingWaterField.fieldCode, value)
    }
    if (key === 'closing_stock' && closingStockField) {
      handleValueChange(closingStockField.fieldCode, value)
    }
    if (key === 'closing_water' && closingWaterField) {
      handleValueChange(closingWaterField.fieldCode, value)
    }
  }

  return (
    <div className="full-width-field">
      <div className="operation-special-layout">
        <div className="operation-special-layout-header">
          <h3>Stock Movement Entry</h3>
          <p>
            Designed for FSO/manual stock movement. Enter opening/closing stock
            + water and system computes net.
          </p>
        </div>

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
            <label>Reference (optional)</label>
            <input
              value={local.movement_reference}
              onChange={(e) => onChange('movement_reference', e.target.value)}
              placeholder="Shuttle / Batch / Reference"
              disabled={!refField}
              title={!refField ? 'Add field_code movement_reference to template' : ''}
            />
          </div>

          <div>
            <label>Opening Stock</label>
            <input
              type="number"
              value={local.opening_stock}
              onChange={(e) => onChange('opening_stock', e.target.value)}
              disabled={!openingStockField}
              title={!openingStockField ? 'Add field_code opening_stock to template' : ''}
            />
          </div>

          <div>
            <label>Opening Water</label>
            <input
              type="number"
              value={local.opening_water}
              onChange={(e) => onChange('opening_water', e.target.value)}
              disabled={!openingWaterField}
              title={!openingWaterField ? 'Add field_code opening_water to template' : ''}
            />
          </div>

          <div>
            <label>Closing Stock</label>
            <input
              type="number"
              value={local.closing_stock}
              onChange={(e) => onChange('closing_stock', e.target.value)}
              disabled={!closingStockField}
              title={!closingStockField ? 'Add field_code closing_stock to template' : ''}
            />
          </div>

          <div>
            <label>Closing Water</label>
            <input
              type="number"
              value={local.closing_water}
              onChange={(e) => onChange('closing_water', e.target.value)}
              disabled={!closingWaterField}
              title={!closingWaterField ? 'Add field_code closing_water to template' : ''}
            />
          </div>

          <div>
            <label>Net Stock (auto)</label>
            <input type="number" value={String(netStock)} readOnly />
          </div>

          <div>
            <label>Net Water (auto)</label>
            <input type="number" value={String(netWater)} readOnly />
          </div>

          <div>
            <label>Net NSV (auto)</label>
            <input type="number" value={String(netNsv)} readOnly />
          </div>
        </div>

        <div className="info-box">
          <strong>Note:</strong> Operation labels/stages are soft-coded from Vessel
          Operation Master.
        </div>
      </div>
    </div>
  )
}

export default StockMovementLayout