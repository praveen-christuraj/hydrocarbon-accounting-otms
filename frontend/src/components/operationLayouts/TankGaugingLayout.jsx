import { useEffect, useMemo, useRef, useState } from 'react'
import { lookupTable11Factor } from '../../api/table11Api'
import { getTankOperations } from '../../api/tankOperationApi'
import {
  calculateTankQuantity,
  formatNumber,
  getCalibrationColumnsByRole,
  getCalibrationMaxInput,
  getTemperatureLimits,
  OBSERVED_API_LIMITS,
  OBSERVED_DENSITY_LIMITS,
  validateTankGaugingInput,
} from '../../utils/tankQuantityEngine'

const LONG_TON_TO_METRIC_TON = 1.01605

const emptyTankInput = {
  tankOperationCode: '',
  tankOperationLabel: '',
  tankOperationCategory: '',
  tankOperationSign: '',
  gaugingDate: '',
  gaugingTime: '',
  dipCm: '',
  waterLevelCm: '',
  tankTemperatureUnit: 'C',
  tankTemperature: '',
  observedInputType: 'Observed API',
  observedApi: '',
  observedDensity: '',
  sampleTemperatureUnit: 'F',
  sampleTemperature: '',
  bswPercent: '',
  remarks: '',
}

const getExistingTankPayload = (entry) => {
  const payloadValue = (entry.values || []).find((item) => {
    return item.fieldCode === 'tank_gauging_payload'
  })

  if (!payloadValue || !payloadValue.fieldValue) {
    return null
  }

  if (typeof payloadValue.fieldValue === 'object') {
    return payloadValue.fieldValue
  }

  const rawValue = String(payloadValue.fieldValue || '').trim()

  if (rawValue === '' || rawValue === '[object Object]') {
    return null
  }

  try {
    return JSON.parse(rawValue)
  } catch {
    return null
  }
}

function TankGaugingLayout({
  entry,
  editId,
  selectedAsset,
  assetCalibrationTables = [],
  calibrationTemplates = [],
  handleValueChange,
}) {
  const existingPayload = useMemo(() => {
    return getExistingTankPayload(entry)
  }, [entry.values])

  const [tankInput, setTankInput] = useState(() => {
    if (existingPayload?.inputs) {
      return {
        ...emptyTankInput,
        ...existingPayload.inputs,
      }
    }

    return emptyTankInput
  })

  const lastLoadedPayloadRef = useRef('')
  const [table11Lookup, setTable11Lookup] = useState(null)
  const [table11Error, setTable11Error] = useState('')
  const [table11Loading, setTable11Loading] = useState(false)
  const [tankOperations, setTankOperations] = useState([])
  const [tankOperationsLoading, setTankOperationsLoading] = useState(false)
  const [tankOperationsError, setTankOperationsError] = useState('')

  useEffect(() => {
    const currentEditKey = editId === null ? 'new-entry' : `edit-${editId}`

    const currentPayloadKey = existingPayload?.inputs
      ? JSON.stringify(existingPayload.inputs)
      : ''

    const combinedKey = `${currentEditKey}-${currentPayloadKey}`

    if (lastLoadedPayloadRef.current === combinedKey) {
      return
    }

    lastLoadedPayloadRef.current = combinedKey

    if (existingPayload?.inputs) {
      setTankInput({
        ...emptyTankInput,
        ...existingPayload.inputs,
      })
      return
    }

    if (editId === null) {
      setTankInput(emptyTankInput)
    }
  }, [editId, existingPayload])

  useEffect(() => {
    const loadTankOperations = async () => {
      const locationCode = entry.originLocationCode

      if (!locationCode) {
        setTankOperations([])
        setTankOperationsError('')
        return
      }

      try {
        setTankOperationsLoading(true)
        setTankOperationsError('')

        const data = await getTankOperations({
          locationCode,
          status: 'Active',
        })

        setTankOperations(data)
      } catch (error) {
        setTankOperations([])
        setTankOperationsError(error.message || 'Failed to load Tank Operations')
      } finally {
        setTankOperationsLoading(false)
      }
    }

    loadTankOperations()
  }, [entry.originLocationCode])
  
  const activeCalibrationTable = useMemo(() => {
    if (!selectedAsset) {
      return null
    }

    const matchingTables = assetCalibrationTables.filter((table) => {
      return (
        table.assetCode === selectedAsset.assetCode &&
        table.status === 'Active'
      )
    })

    if (matchingTables.length === 0) {
      return null
    }

    return [...matchingTables].sort((a, b) => {
      const dateA = a.effectiveDate || ''
      const dateB = b.effectiveDate || ''

      return dateB.localeCompare(dateA)
    })[0]
  }, [assetCalibrationTables, selectedAsset])

  const activeCalibrationTemplate = useMemo(() => {
    if (!activeCalibrationTable) {
      return null
    }

    return calibrationTemplates.find((template) => {
      return Number(template.id) === Number(activeCalibrationTable.templateId)
    })
  }, [activeCalibrationTable, calibrationTemplates])

  const calibrationColumns = useMemo(() => {
    return getCalibrationColumnsByRole(activeCalibrationTemplate)
  }, [activeCalibrationTemplate])

  const maxCalibrationDipCm = useMemo(() => {
    if (!activeCalibrationTable || !calibrationColumns.inputColumnName) {
      return 0
    }

    return getCalibrationMaxInput(
      activeCalibrationTable.rows,
      calibrationColumns.inputColumnName
    )
  }, [activeCalibrationTable, calibrationColumns.inputColumnName])

  const validationResult = useMemo(() => {
    return validateTankGaugingInput({
      dipCm: tankInput.dipCm,
      waterLevelCm: tankInput.waterLevelCm,
      maxCalibrationDipCm,
      tankTemperature: tankInput.tankTemperature,
      tankTemperatureUnit: tankInput.tankTemperatureUnit,
      observedInputType: tankInput.observedInputType,
      observedApi: tankInput.observedApi,
      observedDensity: tankInput.observedDensity,
      sampleTemperature: tankInput.sampleTemperature,
      sampleTemperatureUnit: tankInput.sampleTemperatureUnit,
      bswPercent: tankInput.bswPercent,
    })
  }, [tankInput, maxCalibrationDipCm])

  const calculated = useMemo(() => {
    if (
      !activeCalibrationTable ||
      !calibrationColumns.inputColumnName ||
      !calibrationColumns.outputColumnName
    ) {
      return null
    }

    if (validationResult.errors.length > 0) {
      return null
    }

    return calculateTankQuantity({
      dipCm: tankInput.dipCm,
      waterLevelCm: tankInput.waterLevelCm,
      tankTemperature: tankInput.tankTemperature,
      tankTemperatureUnit: tankInput.tankTemperatureUnit,
      observedInputType: tankInput.observedInputType,
      observedApi: tankInput.observedApi,
      observedDensity: tankInput.observedDensity,
      sampleTemperature: tankInput.sampleTemperature,
      sampleTemperatureUnit: tankInput.sampleTemperatureUnit,
      bswPercent: tankInput.bswPercent,
      calibrationRows: activeCalibrationTable.rows,
      inputColumnName: calibrationColumns.inputColumnName,
      outputColumnName: calibrationColumns.outputColumnName,
    })
  }, [
    activeCalibrationTable,
    calibrationColumns.inputColumnName,
    calibrationColumns.outputColumnName,
    tankInput,
    validationResult.errors.length,
  ])
  useEffect(() => {
    let isActive = true

    const loadTable11Lookup = async () => {
      if (!calculated || !calculated.api60 || calculated.api60 <= 0) {
        setTable11Lookup(null)
        setTable11Error('')
        return
      }

      try {
        setTable11Loading(true)
        setTable11Error('')

        const lookupResult = await lookupTable11Factor(calculated.api60)

        if (!isActive) {
          return
        }

        setTable11Lookup(lookupResult)
      } catch (error) {
        if (!isActive) {
          return
        }

        setTable11Lookup(null)
        setTable11Error(
          error.message ||
            'Table 11 lookup failed. Approximate mass calculation is being used.'
        )
      } finally {
        if (isActive) {
          setTable11Loading(false)
        }
      }
    }

    loadTable11Lookup()

    return () => {
      isActive = false
    }
  }, [calculated?.api60])

  const finalCalculated = useMemo(() => {
    if (!calculated) {
      return null
    }

    if (!table11Lookup || !table11Lookup.ltFactor) {
      return {
        ...calculated,
        ltFactor: calculated.ltFactor || null,
        table11LookupMethod: null,
        massMethod:
          calculated.massMethod ||
          'Approximate density conversion - Table 11 unavailable',
      }
    }

    const lt = Math.round(
      Number(calculated.nsvBbl || 0) * Number(table11Lookup.ltFactor)
    )

    const mt = Math.round(lt * LONG_TON_TO_METRIC_TON)

    return {
      ...calculated,
      ltFactor: Number(table11Lookup.ltFactor),
      lt,
      mt,
      table11LookupMethod: table11Lookup.lookupMethod,
      table11LowerApi60: table11Lookup.lowerApi60,
      table11UpperApi60: table11Lookup.upperApi60,
      massMethod: 'Table 11 factor lookup',
    }
  }, [calculated, table11Lookup])

  const tankPayload = useMemo(() => {
    return {
      layout_type: 'Tank Gauging',
      calculation_engine: 'Tank Quantity',
      asset: selectedAsset
        ? {
            asset_code: selectedAsset.assetCode,
            asset_name: selectedAsset.assetName,
            asset_type_code: selectedAsset.assetTypeCode,
          }
        : null,
      calibration: activeCalibrationTable
        ? {
            calibration_table_id: activeCalibrationTable.id,
            calibration_name: activeCalibrationTable.calibrationName,
            template_id: activeCalibrationTable.templateId,
            template_name: activeCalibrationTable.templateName,
            effective_date: activeCalibrationTable.effectiveDate,
            input_column: calibrationColumns.inputColumnName,
            output_column: calibrationColumns.outputColumnName,
            max_dip_cm: maxCalibrationDipCm,
          }
        : null,
      inputs: tankInput,
      calculated: finalCalculated || {
        tovBbl: null,
        freeWaterBbl: null,
        govBbl: null,
        observedApi: null,
        observedDensity: null,
        api60: null,
        density15: null,
        vcf: null,
        gsvBbl: null,
        bswBbl: null,
        nsvBbl: null,
        lt: null,
        mt: null,
      },
      validation: validationResult,
    }
  }, [
    selectedAsset,
    activeCalibrationTable,
    calibrationColumns.inputColumnName,
    calibrationColumns.outputColumnName,
    maxCalibrationDipCm,
    tankInput,
    finalCalculated,
    validationResult,
  ])

  const payloadJson = useMemo(() => {
    return JSON.stringify(tankPayload)
  }, [tankPayload])

  useEffect(() => {
    const hasPayloadField = (entry.values || []).some((item) => {
      return item.fieldCode === 'tank_gauging_payload'
    })

    if (!hasPayloadField) {
      return
    }

    const existingValue = (entry.values || []).find((item) => {
      return item.fieldCode === 'tank_gauging_payload'
    })?.fieldValue

    const existingJson =
      typeof existingValue === 'object'
        ? JSON.stringify(existingValue)
        : String(existingValue || '')

    if (existingJson === payloadJson) {
      return
    }

    handleValueChange('tank_gauging_payload', tankPayload)
  }, [payloadJson])

  const handleTankInputChange = (e) => {
    const { name, value } = e.target

    setTankInput((current) => {
      if (name === 'observedInputType') {
        return {
          ...current,
          observedInputType: value,
          observedApi: '',
          observedDensity: '',
        }
      }

      if (name === 'tankTemperatureUnit') {
        return {
          ...current,
          tankTemperatureUnit: value,
          tankTemperature: '',
        }
      }

      if (name === 'sampleTemperatureUnit') {
        return {
          ...current,
          sampleTemperatureUnit: value,
          sampleTemperature: '',
        }
      }

      return {
        ...current,
        [name]: value,
      }
    })
  }

  const handleTankOperationChange = (e) => {
    const selectedOperationCode = e.target.value

    const selectedOperation = tankOperations.find((operation) => {
      return operation.operationCode === selectedOperationCode
    })

    setTankInput((current) => {
      if (!selectedOperation) {
        return {
          ...current,
          tankOperationCode: '',
          tankOperationLabel: '',
          tankOperationCategory: '',
          tankOperationSign: '',
        }
      }

      return {
        ...current,
        tankOperationCode: selectedOperation.operationCode,
        tankOperationLabel: selectedOperation.operationLabel,
        tankOperationCategory: selectedOperation.operationCategory,
        tankOperationSign: selectedOperation.operationSign,
      }
    })
  }

  const tankTempLimits = getTemperatureLimits(
    tankInput.tankTemperatureUnit,
    'tank'
  )

  const sampleTempLimits = getTemperatureLimits(
    tankInput.sampleTemperatureUnit,
    'sample'
  )

  const hasPayloadField = (entry.values || []).some((item) => {
    return item.fieldCode === 'tank_gauging_payload'
  })

  return (
    <div className="full-width-field">
      <div className="operation-special-layout tank-gauging-layout">
        <div className="operation-special-layout-header">
          <h3>Tank Gauging Entry</h3>
          <p>
            Enter tank dip, water level, temperature, observed API/density, sample
            temperature, and BS&W. Quantities are calculated live from the active
            asset calibration table.
          </p>
        </div>

        {!selectedAsset && (
          <div className="info-box">
            Select a Tank asset to load calibration details.
          </div>
        )}

        {selectedAsset && !activeCalibrationTable && (
          <div className="info-box">
            No active calibration table found for this tank. Please upload an
            active calibration table in Asset Calibration Table before entering
            tank quantities.
          </div>
        )}

        {activeCalibrationTable && (
          <div className="tank-calibration-banner">
            <div>
              <span>Tank</span>
              <strong>
                {selectedAsset.assetName} ({selectedAsset.assetCode})
              </strong>
            </div>

            <div>
              <span>Calibration</span>
              <strong>{activeCalibrationTable.calibrationName}</strong>
            </div>

            <div>
              <span>Interpolation</span>
              <strong>
                {calibrationColumns.inputColumnName || 'Input'} →{' '}
                {calibrationColumns.outputColumnName || 'Output'}
              </strong>
            </div>

            <div>
              <span>Max Dip</span>
              <strong>{formatNumber(maxCalibrationDipCm, 1)} cm</strong>
            </div>
          </div>
        )}

        {!hasPayloadField && (
          <div className="info-box">
            <strong>Template setup required:</strong> Add a JSON/System field in
            Operation Template Master with field code{' '}
            <strong>tank_gauging_payload</strong>. Without this field, the tank
            inputs and calculated values will not be saved with the ticket.
          </div>
        )}

        <div className="section-title compact-section-title">
          <h3>Gauging Details</h3>
        </div>

        {!entry.originLocationCode && (
          <div className="info-box">
            Select Origin Location in Operation Entry to load Tank Operations.
          </div>
        )}

        {entry.originLocationCode && tankOperationsLoading && (
          <div className="info-box">
            Loading Tank Operations for {entry.originLocationCode}...
          </div>
        )}

        {entry.originLocationCode &&
          !tankOperationsLoading &&
          tankOperations.length === 0 && (
            <div className="info-box">
              No Active Tank Operations found for {entry.originLocationCode}.
              Please configure them in Tank Operation Master.
            </div>
          )}

        {tankOperationsError && (
          <div className="info-box">
            Unable to load Tank Operations: {tankOperationsError}
          </div>
        )}

        <div className="operation-entry-subgrid">
          <div>
            <label>Tank Operation *</label>
            <select
              name="tankOperationCode"
              value={tankInput.tankOperationCode}
              onChange={handleTankOperationChange}
              disabled={!entry.originLocationCode || tankOperationsLoading}
            >
              <option value="">Select Tank Operation</option>

              {tankOperations.map((operation) => (
                <option key={operation.id} value={operation.operationCode}>
                  {operation.operationLabel} ({operation.operationCategory} /{' '}
                  {operation.operationSign})
                </option>
              ))}
            </select>

            {tankInput.tankOperationCode && (
              <small>
                {tankInput.tankOperationCategory} / {tankInput.tankOperationSign}
              </small>
            )}
          </div>

          <div>
            <label>Date *</label>
            <input
              name="gaugingDate"
              type="date"
              value={tankInput.gaugingDate}
              onChange={handleTankInputChange}
            />
          </div>

          <div>
            <label>Time *</label>
            <input
              name="gaugingTime"
              type="time"
              value={tankInput.gaugingTime}
              onChange={handleTankInputChange}
            />
            <small>HH:MM format</small>
          </div>

          <div>
            <label>Dip (cm) *</label>
            <input
              name="dipCm"
              type="number"
              min="0"
              max={maxCalibrationDipCm || undefined}
              step="0.1"
              value={tankInput.dipCm}
              onChange={handleTankInputChange}
              placeholder="Enter dip in cm"
            />
            {maxCalibrationDipCm > 0 && (
              <small>Maximum: {formatNumber(maxCalibrationDipCm, 1)} cm</small>
            )}
          </div>

          <div>
            <label>Water Level (cm) *</label>
            <input
              name="waterLevelCm"
              type="number"
              min="0"
              max={maxCalibrationDipCm || undefined}
              step="0.1"
              value={tankInput.waterLevelCm}
              onChange={handleTankInputChange}
              placeholder="Enter water level in cm"
            />
            {maxCalibrationDipCm > 0 && (
              <small>Maximum: {formatNumber(maxCalibrationDipCm, 1)} cm</small>
            )}
          </div>
        </div>

        <div className="section-title compact-section-title">
          <h3>Temperature & Quality</h3>
        </div>

        <div className="operation-entry-subgrid">
          <div>
            <label>Tank Temperature Unit *</label>
            <select
              name="tankTemperatureUnit"
              value={tankInput.tankTemperatureUnit}
              onChange={handleTankInputChange}
            >
              <option value="C">°C</option>
              <option value="F">°F</option>
            </select>
          </div>

          <div>
            <label>Tank Temperature *</label>
            <input
              name="tankTemperature"
              type="number"
              min={tankTempLimits.min}
              max={tankTempLimits.max}
              step="0.1"
              value={tankInput.tankTemperature}
              onChange={handleTankInputChange}
              placeholder={`Min ${tankTempLimits.min}, Max ${tankTempLimits.max}`}
            />
            <small>
              Allowed: {tankTempLimits.min} to {tankTempLimits.max} °
              {tankInput.tankTemperatureUnit}
            </small>
          </div>

          <div>
            <label>Observed Input Type *</label>
            <select
              name="observedInputType"
              value={tankInput.observedInputType}
              onChange={handleTankInputChange}
            >
              <option>Observed API</option>
              <option>Observed Density (kg/m³)</option>
            </select>
          </div>

          {tankInput.observedInputType === 'Observed API' ? (
            <div>
              <label>Observed API *</label>
              <input
                name="observedApi"
                type="number"
                min={OBSERVED_API_LIMITS.min}
                max={OBSERVED_API_LIMITS.max}
                step="0.01"
                value={tankInput.observedApi}
                onChange={handleTankInputChange}
                placeholder="Enter observed API"
              />
              <small>
                Allowed: {OBSERVED_API_LIMITS.min} to{' '}
                {OBSERVED_API_LIMITS.max}
              </small>
            </div>
          ) : (
            <div>
              <label>Observed Density (kg/m³) *</label>
              <input
                name="observedDensity"
                type="number"
                min={OBSERVED_DENSITY_LIMITS.min}
                max={OBSERVED_DENSITY_LIMITS.max}
                step="0.1"
                value={tankInput.observedDensity}
                onChange={handleTankInputChange}
                placeholder="Enter observed density"
              />
              <small>
                Allowed: {OBSERVED_DENSITY_LIMITS.min} to{' '}
                {OBSERVED_DENSITY_LIMITS.max} kg/m³
              </small>
            </div>
          )}

          <div>
            <label>Sample Temperature Unit *</label>
            <select
              name="sampleTemperatureUnit"
              value={tankInput.sampleTemperatureUnit}
              onChange={handleTankInputChange}
            >
              <option value="F">°F</option>
              <option value="C">°C</option>
            </select>
          </div>

          <div>
            <label>Sample Temperature *</label>
            <input
              name="sampleTemperature"
              type="number"
              min={sampleTempLimits.min}
              max={sampleTempLimits.max}
              step="0.1"
              value={tankInput.sampleTemperature}
              onChange={handleTankInputChange}
              placeholder={`Min ${sampleTempLimits.min}, Max ${sampleTempLimits.max}`}
            />
            <small>
              Allowed: {sampleTempLimits.min} to {sampleTempLimits.max} °
              {tankInput.sampleTemperatureUnit}
            </small>
          </div>

          <div>
            <label>BS&W (%) *</label>
            <input
              name="bswPercent"
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={tankInput.bswPercent}
              onChange={handleTankInputChange}
              placeholder="Enter BS&W %"
            />
            <small>Allowed: 0 to 100%</small>
          </div>
        </div>

        <div className="full-width-field">
          <label>Tank Remarks</label>
          <textarea
            name="remarks"
            value={tankInput.remarks}
            onChange={handleTankInputChange}
            placeholder="Enter tank gauging remarks"
            rows="3"
          />
        </div>

        {(validationResult.errors.length > 0 ||
          validationResult.warnings.length > 0) && (
          <div className="tank-validation-panel">
            {validationResult.errors.length > 0 && (
              <div className="tank-validation-errors">
                <strong>Validation Errors</strong>
                <ul>
                  {validationResult.errors.map((error) => (
                    <li key={error}>{error}</li>
                  ))}
                </ul>
              </div>
            )}

            {validationResult.warnings.length > 0 && (
              <div className="tank-validation-warnings">
                <strong>Warnings</strong>
                <ul>
                  {validationResult.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <div className="section-title compact-section-title">
          <h3>Live Quantity Calculation</h3>
        </div>

        {!finalCalculated ? (
          <div className="info-box">
            Complete valid tank inputs and ensure active calibration exists to view live
            calculated quantities.
          </div>
        ) : (
          <>
            <div className="live-calculation-grid tank-live-grid">
              <div className="live-calculation-card">
                <span>TOV</span>
                <strong>{formatNumber(finalCalculated.tovBbl, 3)} bbl</strong>
              </div>

              <div className="live-calculation-card">
                <span>Free Water</span>
                <strong>{formatNumber(finalCalculated.freeWaterBbl, 3)} bbl</strong>
              </div>

              <div className="live-calculation-card">
                <span>GOV</span>
                <strong>{formatNumber(finalCalculated.govBbl, 3)} bbl</strong>
              </div>

              <div className="live-calculation-card">
                <span>API @ 60°F</span>
                <strong>{formatNumber(finalCalculated.api60, 3)}</strong>
              </div>

              <div className="live-calculation-card">
                <span>Density @ 15°C</span>
                <strong>
                  {finalCalculated.density15
                    ? `${formatNumber(finalCalculated.density15, 3)} kg/m³`
                    : '-'}
                </strong>
              </div>

              <div className="live-calculation-card">
                <span>VCF</span>
                <strong>{formatNumber(finalCalculated.vcf, 5)}</strong>
              </div>

              <div className="live-calculation-card">
                <span>LT Factor</span>
                <strong>
                  {finalCalculated.ltFactor
                    ? formatNumber(finalCalculated.ltFactor, 8)
                    : '-'}
                </strong>
              </div>

              <div className="live-calculation-card">
                <span>Table 11 Method</span>
                <strong>{finalCalculated.table11LookupMethod || '-'}</strong>
              </div>

              <div className="live-calculation-card">
                <span>Lower API @ 60°F</span>
                <strong>
                  {finalCalculated.table11LowerApi60
                    ? formatNumber(finalCalculated.table11LowerApi60, 3)
                    : '-'}
                </strong>
              </div>

              <div className="live-calculation-card">
                <span>Upper API @ 60°F</span>
                <strong>
                  {finalCalculated.table11UpperApi60
                    ? formatNumber(finalCalculated.table11UpperApi60, 3)
                    : '-'}
                </strong>
              </div>

              <div className="live-calculation-card">
                <span>GSV</span>
                <strong>{formatNumber(finalCalculated.gsvBbl, 0)} bbl</strong>
              </div>

              <div className="live-calculation-card">
                <span>BS&W Volume</span>
                <strong>{formatNumber(finalCalculated.bswBbl, 0)} bbl</strong>
              </div>

              <div className="live-calculation-card">
                <span>NSV</span>
                <strong>{formatNumber(finalCalculated.nsvBbl, 0)} bbl</strong>
              </div>

              <div className="live-calculation-card">
                <span>LT</span>
                <strong>{formatNumber(finalCalculated.lt, 0)}</strong>
              </div>

              <div className="live-calculation-card">
                <span>MT</span>
                <strong>{formatNumber(finalCalculated.mt, 0)}</strong>
              </div>
            </div>

            {table11Loading && (
              <div className="info-box">
                Looking up Table 11 factor from common reference master...
              </div>
            )}

            {table11Error && (
              <div className="info-box">
                {table11Error}
              </div>
            )}

            {finalCalculated?.massMethod && (
              <div className="info-box">
                Mass calculation method: {finalCalculated.massMethod}
                {finalCalculated.table11LookupMethod
                  ? ` (${finalCalculated.table11LookupMethod})`
                  : ''}
              </div>
            )}
          </>
        )}

        <div className="info-box">
          Formula sequence: TOV and Free Water are interpolated from calibration.
          GOV = TOV - Free Water. API@60 and VCF are calculated from observed
          quality and temperature. GSV = GOV × VCF. NSV = GSV - BS&W volume.
          LT Factor is taken from common Table 11 using API @ 60°F. LT = NSV ×
          LT Factor. MT = LT × 1.01605.
        </div>
      </div>
    </div>
  )
}

export default TankGaugingLayout
