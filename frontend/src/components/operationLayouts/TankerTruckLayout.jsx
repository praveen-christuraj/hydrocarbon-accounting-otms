import { useEffect, useMemo, useRef, useState } from 'react'
import {
  getCurrentPrimeMoverTankerLink,
  getPrimeMoverTankerLinks,
} from '../../api/primeMoverTankerLinkApi'
import { lookupTable11Factor } from '../../api/table11Api'
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
const LITRES_PER_BBL = 158.987

const emptyTankerInput = {
  tankerTransactionDate: '',
  tankerTransactionTime: '',
  tankerName: '',
  primeMoverNumber: '',
  chassisNumber: '',
  operation: '',
  compartment: 'C1',
  totalDipCm: '',
  waterDipCm: '',
  bswPercent: '',
  tankTemperatureUnit: 'C',
  tankTemperature: '',
  observedInputType: 'Observed API',
  observedApi: '',
  observedDensity: '',
  sampleTemperatureUnit: 'F',
  sampleTemperature: '',
  sealC1: '',
  sealC2: '',
  sealM1: '',
  sealM2: '',
  remarks: '',
}

const getExistingTankerPayload = (entry) => {
  const payloadValue = (entry.values || []).find((item) => {
    return item.fieldCode === 'tanker_payload'
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

const buildLinkAssetFromPayload = (payload) => {
  const linkedAsset =
    payload?.tanker_trailer_asset ||
    payload?.linked_tanker_asset ||
    payload?.tanker_asset ||
    payload?.asset ||
    null

  if (!linkedAsset) {
    return null
  }

  return {
    tankerAssetCode:
      linkedAsset.asset_code ||
      linkedAsset.tanker_asset_code ||
      linkedAsset.assetCode ||
      '',
    tankerAssetName:
      linkedAsset.asset_name ||
      linkedAsset.tanker_asset_name ||
      linkedAsset.assetName ||
      '',
    tankerAssetTypeCode:
      linkedAsset.asset_type_code ||
      linkedAsset.tanker_asset_type_code ||
      linkedAsset.assetTypeCode ||
      '',
    tankerChassisNumber:
      linkedAsset.serial_number ||
      linkedAsset.tanker_chassis_number ||
      linkedAsset.serialNumber ||
      '',
  }
}

const safeText = (value, fallback = '—') => {
  const text = String(value ?? '').trim()
  return text === '' ? fallback : text
}

const getNowDateTime = () => {
  const now = new Date()

  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  const hh = String(now.getHours()).padStart(2, '0')
  const mi = String(now.getMinutes()).padStart(2, '0')

  return {
    date: `${yyyy}-${mm}-${dd}`,
    time: `${hh}:${mi}`,
  }
}

const stringifyPayload = (value) => {
  if (value === null || value === undefined) {
    return ''
  }

  if (typeof value === 'object') {
    return JSON.stringify(value)
  }

  return String(value || '')
}

const isPrimeMoverAsset = (asset) => {
  const typeCode = String(asset?.assetTypeCode || '').toUpperCase()
  const name = String(asset?.assetName || '').toUpperCase()
  const code = String(asset?.assetCode || '').toUpperCase()

  return (
    typeCode.includes('PRIME') ||
    typeCode.includes('MOVER') ||
    name.includes('PRIME') ||
    name.includes('MOVER') ||
    code.startsWith('PM')
  )
}

const isTankerTrailerAsset = (asset) => {
  const typeCode = String(asset?.assetTypeCode || '').toUpperCase()
  const name = String(asset?.assetName || '').toUpperCase()

  return (
    typeCode.includes('TANKER') ||
    typeCode.includes('TRAILER') ||
    typeCode.includes('TRUCK') ||
    name.includes('TANKER') ||
    name.includes('TRAILER')
  )
}

const buildTankerFromSelectedAsset = (asset) => {
  if (!asset) {
    return null
  }

  return {
    tankerAssetCode: asset.assetCode || '',
    tankerAssetName: asset.assetName || '',
    tankerAssetTypeCode: asset.assetTypeCode || '',
    tankerChassisNumber: asset.serialNumber || '',
  }
}

const convertCalibrationRowsLitresToBbl = (rows, outputColumnName) => {
  return (rows || []).map((row) => {
    const sourceRowData = row.rowData || row.row_data || {}
    const sourceVolume = Number(sourceRowData[outputColumnName] || 0)

    return {
      ...row,
      rowData: {
        ...sourceRowData,
        [outputColumnName]: sourceVolume / LITRES_PER_BBL,
      },
      row_data: {
        ...sourceRowData,
        [outputColumnName]: sourceVolume / LITRES_PER_BBL,
      },
    }
  })
}

const ValuePill = ({ label, value, muted = false }) => {
  return (
    <div className={`tanker-pill ${muted ? 'muted' : ''}`}>
      <span>{label}</span>
      <strong>{safeText(value)}</strong>
    </div>
  )
}

const QuantityCard = ({ title, rows }) => {
  return (
    <div className="operation-layout-section-card tanker-result-card">
      <h4>{title}</h4>

      {rows.map((row) => (
        <p key={row.label}>
          <span>{row.label}</span>
          <strong>{row.value}</strong>
        </p>
      ))}
    </div>
  )
}

const Field = ({
  label,
  name,
  type = 'text',
  value,
  onChange,
  required = false,
  placeholder = '',
  disabled = false,
  min,
  max,
  step,
  helpText = '',
}) => {
  return (
    <div>
      <label>
        {label}
        {required ? ' *' : ''}
      </label>
      <input
        name={name}
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        disabled={disabled}
        min={min}
        max={max}
        step={step}
      />
      {helpText && <small>{helpText}</small>}
    </div>
  )
}

function TankerTruckLayout({
  entry,
  editId,
  selectedAsset,
  assetCalibrationTables = [],
  calibrationTemplates = [],
  handleValueChange,
  senderReference = null,
  senderReferenceLoading = false,
  receiverMode = false,
}) {
  const existingPayload = useMemo(() => {
    return getExistingTankerPayload(entry)
  }, [entry.values])

  const [linkedTanker, setLinkedTanker] = useState(() => {
    return buildLinkAssetFromPayload(existingPayload)
  })

  const [linkLoading, setLinkLoading] = useState(false)
  const [linkError, setLinkError] = useState('')

  const [tankerInput, setTankerInput] = useState(() => {
    if (existingPayload?.inputs) {
      return {
        ...emptyTankerInput,
        ...existingPayload.inputs,
      }
    }

    return {
      ...emptyTankerInput,
      tankerTransactionDate: entry.operationDate || '',
      primeMoverNumber: isPrimeMoverAsset(selectedAsset)
        ? selectedAsset?.assetCode || ''
        : '',
    }
  })

  const lastLoadedEntryRef = useRef('')
  const [table11Lookup, setTable11Lookup] = useState(null)
  const [table11Error, setTable11Error] = useState('')
  const [table11Loading, setTable11Loading] = useState(false)

  const hasPayloadField = useMemo(() => {
    return (entry.values || []).some((item) => item.fieldCode === 'tanker_payload')
  }, [entry.values])

  useEffect(() => {
    let isActive = true

    const loadCurrentLink = async () => {
      setLinkError('')

      if (!selectedAsset?.assetCode) {
        setLinkedTanker(buildLinkAssetFromPayload(existingPayload))
        return
      }

      try {
        setLinkLoading(true)

        if (isPrimeMoverAsset(selectedAsset)) {
          const response = await getCurrentPrimeMoverTankerLink(
            selectedAsset.assetCode
          )

          if (!isActive) {
            return
          }

          if (!response.hasActiveLink || !response.link) {
            setLinkedTanker(buildLinkAssetFromPayload(existingPayload))
            setLinkError(
              `No Active Tanker Trailer link found for Prime Mover ${selectedAsset.assetCode}. Create the link in Prime Mover - Tanker Link page before tanker entry.`
            )
            return
          }

          setLinkedTanker(response.link)
          return
        }

        if (isTankerTrailerAsset(selectedAsset)) {
          const selectedTanker = buildTankerFromSelectedAsset(selectedAsset)

          const activeLinks = await getPrimeMoverTankerLinks({
            status: 'Active',
            tanker_asset_code: selectedAsset.assetCode,
          })

          if (!isActive) {
            return
          }

          if (activeLinks.length > 0) {
            setLinkedTanker({
              ...activeLinks[0],
              tankerAssetCode: selectedAsset.assetCode,
              tankerAssetName: selectedAsset.assetName,
              tankerAssetTypeCode: selectedAsset.assetTypeCode,
              tankerChassisNumber: selectedAsset.serialNumber || '',
            })
          } else {
            setLinkedTanker(selectedTanker)
          }

          return
        }

        setLinkedTanker(buildLinkAssetFromPayload(existingPayload))
        setLinkError(
          `Selected asset ${selectedAsset.assetCode} is not recognized as Prime Mover or Tanker Trailer.`
        )
      } catch (error) {
        if (!isActive) {
          return
        }

        if (isTankerTrailerAsset(selectedAsset)) {
          setLinkedTanker(buildTankerFromSelectedAsset(selectedAsset))
        } else {
          setLinkedTanker(buildLinkAssetFromPayload(existingPayload))
        }

        setLinkError(
          error.message ||
            'Unable to load active Prime Mover - Tanker Trailer link.'
        )
      } finally {
        if (isActive) {
          setLinkLoading(false)
        }
      }
    }

    loadCurrentLink()

    return () => {
      isActive = false
    }
  }, [selectedAsset?.assetCode, existingPayload])

  useEffect(() => {
    const currentEntryKey = editId === null ? 'new-entry' : `edit-${editId}`

    if (lastLoadedEntryRef.current === currentEntryKey) {
      return
    }

    lastLoadedEntryRef.current = currentEntryKey

    if (existingPayload?.inputs) {
      setTankerInput({
        ...emptyTankerInput,
        ...existingPayload.inputs,
      })
      return
    }

    setTankerInput({
      ...emptyTankerInput,
      tankerTransactionDate: entry.operationDate || '',
      primeMoverNumber: isPrimeMoverAsset(selectedAsset)
        ? selectedAsset?.assetCode || ''
        : linkedTanker?.primeMoverAssetCode || '',
      tankerName: linkedTanker?.tankerAssetName || '',
      chassisNumber: linkedTanker?.tankerChassisNumber || '',
    })
  }, [editId])

  useEffect(() => {
    setTankerInput((current) => ({
      ...current,
      tankerTransactionDate:
        current.tankerTransactionDate || entry.operationDate || '',
      primeMoverNumber:
        current.primeMoverNumber ||
        (isPrimeMoverAsset(selectedAsset) ? selectedAsset?.assetCode || '' : '') ||
        linkedTanker?.primeMoverAssetCode ||
        '',
      tankerName:
        linkedTanker?.tankerAssetName ||
        current.tankerName ||
        '',
      chassisNumber:
        linkedTanker?.tankerChassisNumber ||
        current.chassisNumber ||
        '',
    }))
  }, [
    entry.operationDate,
    selectedAsset?.assetCode,
    linkedTanker?.tankerAssetName,
    linkedTanker?.tankerChassisNumber,
    linkedTanker?.primeMoverAssetCode,
  ])

  const calibrationAssetCode =
    linkedTanker?.tankerAssetCode ||
    buildLinkAssetFromPayload(existingPayload)?.tankerAssetCode ||
    ''

  const activeCalibrationTable = useMemo(() => {
    if (!calibrationAssetCode) {
      return null
    }

    const matchingTables = assetCalibrationTables.filter((table) => {
      return (
        table.assetCode === calibrationAssetCode &&
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
  }, [assetCalibrationTables, calibrationAssetCode])

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

  const tankTempLimits = getTemperatureLimits(tankerInput.tankTemperatureUnit)
  const sampleTempLimits = getTemperatureLimits(tankerInput.sampleTemperatureUnit)

  const validationResult = useMemo(() => {
    const baseValidation = validateTankGaugingInput({
      dipCm: tankerInput.totalDipCm,
      waterLevelCm: tankerInput.waterDipCm,
      maxCalibrationDipCm,
      tankTemperature: tankerInput.tankTemperature,
      tankTemperatureUnit: tankerInput.tankTemperatureUnit,
      observedInputType: tankerInput.observedInputType,
      observedApi: tankerInput.observedApi,
      observedDensity: tankerInput.observedDensity,
      sampleTemperature: tankerInput.sampleTemperature,
      sampleTemperatureUnit: tankerInput.sampleTemperatureUnit,
      bswPercent: tankerInput.bswPercent,
    })

    const errors = [...(baseValidation.errors || [])]
    const warnings = [...(baseValidation.warnings || [])]

    if (!selectedAsset?.assetCode) {
      errors.push('Primary Asset is required.')
    }

    if (selectedAsset?.assetCode && isPrimeMoverAsset(selectedAsset) && !linkedTanker?.tankerAssetCode) {
      errors.push('No active Tanker Trailer is linked to the selected Prime Mover.')
    }

    if (!activeCalibrationTable) {
      errors.push(
        'No active calibration table found for the linked Tanker Trailer asset.'
      )
    }

    return {
      ...baseValidation,
      errors,
      warnings,
    }
  }, [
    tankerInput,
    maxCalibrationDipCm,
    selectedAsset?.assetCode,
    linkedTanker?.tankerAssetCode,
    activeCalibrationTable,
  ])

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

    const tankerCalibrationRowsInBbl = convertCalibrationRowsLitresToBbl(
      activeCalibrationTable.rows,
      calibrationColumns.outputColumnName
    )

    return calculateTankQuantity({
      dipCm: tankerInput.totalDipCm,
      waterLevelCm: tankerInput.waterDipCm,
      tankTemperature: tankerInput.tankTemperature,
      tankTemperatureUnit: tankerInput.tankTemperatureUnit,
      observedInputType: tankerInput.observedInputType,
      observedApi: tankerInput.observedApi,
      observedDensity: tankerInput.observedDensity,
      sampleTemperature: tankerInput.sampleTemperature,
      sampleTemperatureUnit: tankerInput.sampleTemperatureUnit,
      bswPercent: tankerInput.bswPercent,
      calibrationRows: tankerCalibrationRowsInBbl,
      inputColumnName: calibrationColumns.inputColumnName,
      outputColumnName: calibrationColumns.outputColumnName,
    })
  }, [
    activeCalibrationTable,
    calibrationColumns.inputColumnName,
    calibrationColumns.outputColumnName,
    tankerInput,
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

  const tankerPayload = useMemo(() => {
    const selectedIsPrimeMover = isPrimeMoverAsset(selectedAsset)
    const selectedIsTanker = isTankerTrailerAsset(selectedAsset)

    const tankerAsset = selectedIsTanker
      ? selectedAsset
      : linkedTanker?.tankerAssetCode
        ? {
            assetCode: linkedTanker.tankerAssetCode,
            assetName: linkedTanker.tankerAssetName,
            assetTypeCode: linkedTanker.tankerAssetTypeCode,
            serialNumber: linkedTanker.tankerChassisNumber || null,
          }
        : null

    const primeMoverAsset = selectedIsPrimeMover
      ? selectedAsset
      : linkedTanker?.primeMoverAssetCode
        ? {
            assetCode: linkedTanker.primeMoverAssetCode,
            assetName: linkedTanker.primeMoverAssetName,
            assetTypeCode: linkedTanker.primeMoverAssetTypeCode,
            serialNumber: null,
          }
        : null

    const finalInputs = {
      ...tankerInput,
      convoyNumber: entry.convoyNumber || '',
      cargo: entry.productName || '',
      primeMoverNumber: primeMoverAsset?.assetCode || tankerInput.primeMoverNumber || '',
      tankerName:
        tankerAsset?.assetName || tankerInput.tankerName || '',
      chassisNumber:
        tankerAsset?.serialNumber || tankerInput.chassisNumber || '',
    }

    return {
      layout_type: 'Tanker Loading',
      calculation_engine: 'Tanker Quantity',

      prime_mover_asset: primeMoverAsset
        ? {
            asset_code: primeMoverAsset.assetCode,
            asset_name: primeMoverAsset.assetName,
            asset_type_code: primeMoverAsset.assetTypeCode,
            serial_number: primeMoverAsset.serialNumber || null,
          }
        : null,

      tanker_trailer_asset: tankerAsset
        ? {
            asset_code: tankerAsset.assetCode,
            asset_name: tankerAsset.assetName,
            asset_type_code: tankerAsset.assetTypeCode,
            serial_number: tankerAsset.serialNumber || null,
          }
        : null,

      // Backward-compatible alias for existing tanker report code.
      asset: tankerAsset
        ? {
            asset_code: tankerAsset.assetCode,
            asset_name: tankerAsset.assetName,
            asset_type_code: tankerAsset.assetTypeCode,
            serial_number: tankerAsset.serialNumber || null,
          }
        : primeMoverAsset
          ? {
              asset_code: primeMoverAsset.assetCode,
              asset_name: primeMoverAsset.assetName,
              asset_type_code: primeMoverAsset.assetTypeCode,
              serial_number: primeMoverAsset.serialNumber || null,
            }
          : null,

      calibration: activeCalibrationTable
        ? {
            calibration_table_id: activeCalibrationTable.id,
            calibration_name: activeCalibrationTable.calibrationName,
            asset_code: activeCalibrationTable.assetCode,
            template_id: activeCalibrationTable.templateId,
            template_name: activeCalibrationTable.templateName,
            effective_date: activeCalibrationTable.effectiveDate,
            input_column: calibrationColumns.inputColumnName,
            output_column: calibrationColumns.outputColumnName,
            max_dip_cm: maxCalibrationDipCm,
          }
        : null,

      inputs: finalInputs,

      sender_reference:
        receiverMode && senderReference
          ? {
              sender_transaction_id: senderReference.transactionId,
              ticket_number: senderReference.ticketNumber,
              operation_number: senderReference.operationNumber,
              convoy_number: senderReference.convoyNumber,
              tanker_asset_code: senderReference.tankerAssetCode,
              prime_mover_asset_code: senderReference.primeMoverAssetCode,
              sender_nsv_bbl: senderReference.nsvBbl,
              sender_gsv_bbl: senderReference.gsvBbl,
              sender_gov_bbl: senderReference.govBbl,
              sender_seal_c1: senderReference.sealC1,
              sender_seal_c2: senderReference.sealC2,
              sender_seal_m1: senderReference.sealM1,
              sender_seal_m2: senderReference.sealM2,
            }
          : null,

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
        ltFactor: null,
        lt: null,
        mt: null,
      },

      validation: validationResult,
    }
  }, [
    selectedAsset,
    linkedTanker,
    activeCalibrationTable,
    calibrationColumns.inputColumnName,
    calibrationColumns.outputColumnName,
    maxCalibrationDipCm,
    tankerInput,
    finalCalculated,
    validationResult,
    receiverMode,
    senderReference,
  ])

  const payloadJson = useMemo(() => {
    return JSON.stringify(tankerPayload)
  }, [tankerPayload])

  useEffect(() => {
    if (!hasPayloadField) {
      return
    }

    const existingValue = (entry.values || []).find((item) => {
      return item.fieldCode === 'tanker_payload'
    })?.fieldValue

    const existingJson = stringifyPayload(existingValue)

    if (existingJson === payloadJson) {
      return
    }

    handleValueChange('tanker_payload', tankerPayload)
  }, [hasPayloadField, payloadJson])

  const handleTankerInputChange = (e) => {
    const { name, value } = e.target

    setTankerInput((current) => ({
      ...current,
      [name]: value,
    }))
  }

  const copySenderSeals = () => {
    if (!senderReference) {
      return
    }

    setTankerInput((current) => ({
      ...current,
      sealC1: senderReference.sealC1 || current.sealC1,
      sealC2: senderReference.sealC2 || current.sealC2,
      sealM1: senderReference.sealM1 || current.sealM1,
      sealM2: senderReference.sealM2 || current.sealM2,
    }))
  }

  const copySenderQuality = () => {
    if (!senderReference) {
      return
    }

    setTankerInput((current) => ({
      ...current,
      bswPercent:
        senderReference.bswPercent !== null &&
        senderReference.bswPercent !== undefined
          ? String(senderReference.bswPercent)
          : current.bswPercent,
      tankTemperatureUnit:
        senderReference.tankTemperatureUnit || current.tankTemperatureUnit,
      tankTemperature:
        senderReference.tankTemperature !== null &&
        senderReference.tankTemperature !== undefined
          ? String(senderReference.tankTemperature)
          : current.tankTemperature,
      sampleTemperatureUnit:
        senderReference.sampleTemperatureUnit ||
        current.sampleTemperatureUnit,
      sampleTemperature:
        senderReference.sampleTemperature !== null &&
        senderReference.sampleTemperature !== undefined
          ? String(senderReference.sampleTemperature)
          : current.sampleTemperature,
      observedInputType:
        senderReference.observedInputType || current.observedInputType,
      observedApi:
        senderReference.observedApi !== null &&
        senderReference.observedApi !== undefined
          ? String(senderReference.observedApi)
          : current.observedApi,
      observedDensity:
        senderReference.observedDensity !== null &&
        senderReference.observedDensity !== undefined
          ? String(senderReference.observedDensity)
          : current.observedDensity,
    }))
  }

  const copySenderDips = () => {
    if (!senderReference) {
      return
    }

    const confirmed = window.confirm(
      'Copy sender dips into receiver entry? Receiver dips are normally measured independently. Use this only when you intentionally want to start from sender values.'
    )

    if (!confirmed) {
      return
    }

    setTankerInput((current) => ({
      ...current,
      compartment: senderReference.compartment || current.compartment,
      totalDipCm:
        senderReference.totalDipCm !== null &&
        senderReference.totalDipCm !== undefined
          ? String(senderReference.totalDipCm)
          : current.totalDipCm,
      waterDipCm:
        senderReference.waterDipCm !== null &&
        senderReference.waterDipCm !== undefined
          ? String(senderReference.waterDipCm)
          : current.waterDipCm,
    }))
  }

  const copyAllSenderReference = () => {
    if (!senderReference) {
      return
    }

    const confirmed = window.confirm(
      'Copy sender dips, quality and seals into receiver entry? You can edit all copied values before saving.'
    )

    if (!confirmed) {
      return
    }

    setTankerInput((current) => ({
      ...current,
      compartment: senderReference.compartment || current.compartment,
      totalDipCm:
        senderReference.totalDipCm !== null &&
        senderReference.totalDipCm !== undefined
          ? String(senderReference.totalDipCm)
          : current.totalDipCm,
      waterDipCm:
        senderReference.waterDipCm !== null &&
        senderReference.waterDipCm !== undefined
          ? String(senderReference.waterDipCm)
          : current.waterDipCm,
      bswPercent:
        senderReference.bswPercent !== null &&
        senderReference.bswPercent !== undefined
          ? String(senderReference.bswPercent)
          : current.bswPercent,
      tankTemperatureUnit:
        senderReference.tankTemperatureUnit || current.tankTemperatureUnit,
      tankTemperature:
        senderReference.tankTemperature !== null &&
        senderReference.tankTemperature !== undefined
          ? String(senderReference.tankTemperature)
          : current.tankTemperature,
      sampleTemperatureUnit:
        senderReference.sampleTemperatureUnit ||
        current.sampleTemperatureUnit,
      sampleTemperature:
        senderReference.sampleTemperature !== null &&
        senderReference.sampleTemperature !== undefined
          ? String(senderReference.sampleTemperature)
          : current.sampleTemperature,
      observedInputType:
        senderReference.observedInputType || current.observedInputType,
      observedApi:
        senderReference.observedApi !== null &&
        senderReference.observedApi !== undefined
          ? String(senderReference.observedApi)
          : current.observedApi,
      observedDensity:
        senderReference.observedDensity !== null &&
        senderReference.observedDensity !== undefined
          ? String(senderReference.observedDensity)
          : current.observedDensity,
      sealC1: senderReference.sealC1 || current.sealC1,
      sealC2: senderReference.sealC2 || current.sealC2,
      sealM1: senderReference.sealM1 || current.sealM1,
      sealM2: senderReference.sealM2 || current.sealM2,
    }))
  }

  const setTankerDateTimeNow = () => {
    const now = getNowDateTime()

    setTankerInput((current) => ({
      ...current,
      tankerTransactionDate: now.date,
      tankerTransactionTime: now.time,
    }))
  }

  const clearWaterAndBsw = () => {
    setTankerInput((current) => ({
      ...current,
      waterDipCm: '0',
      bswPercent: '0',
    }))
  }

  const resetSampleParameters = () => {
    setTankerInput((current) => ({
      ...current,
      tankTemperatureUnit: 'C',
      tankTemperature: '',
      observedInputType: 'Observed API',
      observedApi: '',
      observedDensity: '',
      sampleTemperatureUnit: 'F',
      sampleTemperature: '',
    }))
  }

  const clearSealDetails = () => {
    setTankerInput((current) => ({
      ...current,
      sealC1: '',
      sealC2: '',
      sealM1: '',
      sealM2: '',
    }))
  }

  const sealValues = [
    tankerInput.sealC1,
    tankerInput.sealC2,
    tankerInput.sealM1,
    tankerInput.sealM2,
  ].map((item) => String(item || '').trim())

  const enteredSealCount = sealValues.filter((item) => item !== '').length
  const duplicateSealCount =
    enteredSealCount - new Set(sealValues.filter((item) => item !== '')).size

  const isReadyForCalculation =
    selectedAsset?.assetCode &&
    linkedTanker?.tankerAssetCode &&
    activeCalibrationTable

  return (
    <div className="full-width-field">
      <div className="operation-special-layout tanker-compact-layout">
        <div className="operation-special-layout-header tanker-header-row">
          <div>
            <h3>Tanker Loading / Receipt</h3>
            <p>
              Primary Asset is the Prime Mover. The linked Tanker Trailer,
              chassis and calibration are auto-picked from the active link.
            </p>
          </div>

          <div className="tanker-ready-status">
            {isReadyForCalculation ? (
              <span className="status-badge active">Ready</span>
            ) : (
              <span className="status-badge draft">Setup Required</span>
            )}
          </div>
        </div>

        {!hasPayloadField && (
          <div className="info-box">
            <strong>Template setup required:</strong> Add a JSON/System field in
            Operation Template Master with field code{' '}
            <strong>tanker_payload</strong>.
          </div>
        )}

        {linkLoading && (
          <div className="info-box">
            Loading active Prime Mover - Tanker Trailer link...
          </div>
        )}

        {linkError && <div className="info-box">{linkError}</div>}

        <div className="tanker-status-strip">
          <ValuePill
            label="Prime Mover"
            value={
              linkedTanker?.primeMoverAssetName && linkedTanker?.primeMoverAssetCode
                ? `${linkedTanker.primeMoverAssetName} (${linkedTanker.primeMoverAssetCode})`
                : isPrimeMoverAsset(selectedAsset)
                  ? `${selectedAsset.assetName} (${selectedAsset.assetCode})`
                  : ''
            }
          />

          <ValuePill
            label="Linked Tanker"
            value={
              linkedTanker?.tankerAssetName
                ? `${linkedTanker.tankerAssetName} (${linkedTanker.tankerAssetCode})`
                : ''
            }
          />

          <ValuePill
            label="Chassis No."
            value={linkedTanker?.tankerChassisNumber}
          />

          <ValuePill
            label="Calibration"
            value={
              activeCalibrationTable
                ? `${activeCalibrationTable.calibrationName}`
                : ''
            }
            muted={!activeCalibrationTable}
          />

          <ValuePill
            label="Max Dip"
            value={
              maxCalibrationDipCm > 0
                ? `${formatNumber(maxCalibrationDipCm, 1)} cm`
                : ''
            }
            muted={maxCalibrationDipCm <= 0}
          />
          <ValuePill
            label="Volume Unit"
            value="Calibration litres → calculation bbl"
          />
        </div>

        <div className="multi-tank-actions tanker-quick-actions">
          <div className="actions-left">
            <span className="actions-title">Quick Actions</span>
            <span className="actions-sub">
              Applies to this tanker ticket only
            </span>
          </div>

          <div className="actions-right">
            <div className="actions-btn-row">
              <button
                type="button"
                className="mini-btn"
                onClick={setTankerDateTimeNow}
              >
                Set Date/Time Now
              </button>

              <button
                type="button"
                className="mini-btn secondary-btn"
                onClick={clearWaterAndBsw}
              >
                Clear Water & BS&W
              </button>

              <button
                type="button"
                className="mini-btn secondary-btn"
                onClick={resetSampleParameters}
              >
                Reset Sample Params
              </button>

              <button
                type="button"
                className="mini-btn secondary-btn"
                onClick={clearSealDetails}
              >
                Clear Seals
              </button>
            </div>
          </div>
        </div>

        {!activeCalibrationTable && (
          <div className="info-box">
            Upload an active calibration table against the linked Tanker Trailer
            asset. Do not upload tanker calibration against the Prime Mover.
          </div>
        )}

        {receiverMode && (
          <div className="tanker-sender-reference-panel">
            <div className="tanker-sender-reference-header">
              <div>
                <h4>Sender Reference</h4>
                <p>
                  Receiver entry is linked to the approved sender tanker ticket.
                  Copy buttons are only shortcuts; receiver can edit all values
                  before saving.
                </p>
              </div>

              {senderReferenceLoading && (
                <span className="status-badge submitted">Loading...</span>
              )}
            </div>

            {!senderReferenceLoading && !senderReference && (
              <div className="info-box">
                Sender reference could not be loaded. Receiver can still enter
                values manually.
              </div>
            )}

            {senderReference && (
              <>
                <div className="tanker-sender-reference-grid">
                  <div>
                    <span>Sender Ticket</span>
                    <strong>
                      {senderReference.ticketNumber ||
                        senderReference.operationNumber ||
                        '-'}
                    </strong>
                  </div>

                  <div>
                    <span>Convoy</span>
                    <strong>{senderReference.convoyNumber || '-'}</strong>
                  </div>

                  <div>
                    <span>Sender Operation</span>
                    <strong>
                      {senderReference.operationTypeName ||
                        senderReference.operationTypeCode ||
                        '-'}
                    </strong>
                  </div>

                  <div>
                    <span>Product</span>
                    <strong>{senderReference.productName || '-'}</strong>
                  </div>

                  <div>
                    <span>Sender TOV</span>
                    <strong>
                      {formatNumber(senderReference.tovBbl || 0, 3)} bbl
                    </strong>
                  </div>

                  <div>
                    <span>Sender GOV</span>
                    <strong>
                      {formatNumber(senderReference.govBbl || 0, 3)} bbl
                    </strong>
                  </div>

                  <div>
                    <span>Sender GSV</span>
                    <strong>
                      {formatNumber(senderReference.gsvBbl || 0, 3)} bbl
                    </strong>
                  </div>

                  <div>
                    <span>Sender NSV</span>
                    <strong>
                      {formatNumber(senderReference.nsvBbl || 0, 3)} bbl
                    </strong>
                  </div>

                  <div>
                    <span>Sender Dips</span>
                    <strong>
                      Total {formatNumber(senderReference.totalDipCm || 0, 1)}
                      cm / Water{' '}
                      {formatNumber(senderReference.waterDipCm || 0, 1)} cm
                    </strong>
                  </div>

                  <div>
                    <span>Sender Quality</span>
                    <strong>
                      BS&W {formatNumber(senderReference.bswPercent || 0, 2)}%
                      / API60{' '}
                      {senderReference.api60 !== null &&
                      senderReference.api60 !== undefined
                        ? formatNumber(senderReference.api60, 2)
                        : '-'}
                    </strong>
                  </div>

                  <div className="sender-reference-wide">
                    <span>Sender Seals</span>
                    <strong>
                      C1: {senderReference.sealC1 || '-'} / C2:{' '}
                      {senderReference.sealC2 || '-'} / M1:{' '}
                      {senderReference.sealM1 || '-'} / M2:{' '}
                      {senderReference.sealM2 || '-'}
                    </strong>
                  </div>
                </div>

                <div className="tanker-sender-copy-actions">
                  <button type="button" onClick={copySenderSeals}>
                    Copy Seals
                  </button>

                  <button type="button" onClick={copySenderQuality}>
                    Copy Quality / Sample
                  </button>

                  <button type="button" onClick={copySenderDips}>
                    Copy Dips
                  </button>

                  <button type="button" onClick={copyAllSenderReference}>
                    Copy All
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        <div className="tanker-main-grid">
          <div className="tanker-entry-panel">
            <details open className="tanker-section">
              <summary>1. Trip & Asset Details</summary>

              <div className="operation-entry-subgrid tanker-tight-grid">
                <Field
                  label="Tanker Trailer"
                  name="tankerName"
                  value={
                    linkedTanker?.tankerAssetName ||
                    tankerInput.tankerName ||
                    ''
                  }
                  onChange={handleTankerInputChange}
                  disabled
                  placeholder="Auto-filled from active link"
                />

                <Field
                  label="Prime Mover Number"
                  name="primeMoverNumber"
                  value={
                    tankerInput.primeMoverNumber ||
                    selectedAsset?.assetCode ||
                    ''
                  }
                  onChange={handleTankerInputChange}
                  placeholder="Auto-filled from selected Prime Mover"
                />

                <Field
                  label="Chassis Number"
                  name="chassisNumber"
                  value={
                    linkedTanker?.tankerChassisNumber ||
                    tankerInput.chassisNumber ||
                    ''
                  }
                  onChange={handleTankerInputChange}
                  disabled
                  placeholder="Auto-filled"
                />

                <Field
                  label="Date"
                  name="tankerTransactionDate"
                  type="date"
                  value={tankerInput.tankerTransactionDate}
                  onChange={handleTankerInputChange}
                  required
                />

                <Field
                  label="Time"
                  name="tankerTransactionTime"
                  type="time"
                  value={tankerInput.tankerTransactionTime}
                  onChange={handleTankerInputChange}
                  required
                />

                <Field
                  label="Operation"
                  name="operation"
                  value={tankerInput.operation}
                  onChange={handleTankerInputChange}
                  placeholder="Loading / Receipt / Dispatch"
                />
              </div>
            </details>

            <details open className="tanker-section">
              <summary>2. Dip, Water & BS&W</summary>

              <div className="operation-entry-subgrid tanker-tight-grid">
                <div>
                  <label>Compartment / Manhole *</label>
                  <select
                    name="compartment"
                    value={tankerInput.compartment}
                    onChange={handleTankerInputChange}
                  >
                    <option>C1</option>
                    <option>C2</option>
                    <option>M1</option>
                    <option>M2</option>
                    <option>Main</option>
                  </select>
                </div>

                <Field
                  label="Total Dip"
                  name="totalDipCm"
                  type="number"
                  value={tankerInput.totalDipCm}
                  onChange={handleTankerInputChange}
                  required
                  min="0"
                  max={maxCalibrationDipCm || undefined}
                  step="0.1"
                  placeholder="cm"
                  helpText={
                    maxCalibrationDipCm > 0
                      ? `Maximum: ${formatNumber(maxCalibrationDipCm, 1)} cm`
                      : ''
                  }
                />

                <Field
                  label="Water Dip"
                  name="waterDipCm"
                  type="number"
                  value={tankerInput.waterDipCm}
                  onChange={handleTankerInputChange}
                  required
                  min="0"
                  max={maxCalibrationDipCm || undefined}
                  step="0.1"
                  placeholder="cm"
                />

                <Field
                  label="BS&W"
                  name="bswPercent"
                  type="number"
                  value={tankerInput.bswPercent}
                  onChange={handleTankerInputChange}
                  required
                  min="0"
                  max="100"
                  step="0.01"
                  placeholder="%"
                />
              </div>
            </details>

            <details open className="tanker-section">
              <summary>3. Temperature & Quality</summary>

              <div className="operation-entry-subgrid tanker-tight-grid">
                <div>
                  <label>Tank Temp Unit *</label>
                  <select
                    name="tankTemperatureUnit"
                    value={tankerInput.tankTemperatureUnit}
                    onChange={handleTankerInputChange}
                  >
                    <option value="C">°C</option>
                    <option value="F">°F</option>
                  </select>
                </div>

                <Field
                  label="Tank Temp"
                  name="tankTemperature"
                  type="number"
                  value={tankerInput.tankTemperature}
                  onChange={handleTankerInputChange}
                  required
                  min={tankTempLimits.min}
                  max={tankTempLimits.max}
                  step="0.1"
                  placeholder={`${tankTempLimits.min} - ${tankTempLimits.max}`}
                />

                <div>
                  <label>Observed Input Type *</label>
                  <select
                    name="observedInputType"
                    value={tankerInput.observedInputType}
                    onChange={handleTankerInputChange}
                  >
                    <option>Observed API</option>
                    <option>Observed Density (kg/m³)</option>
                  </select>
                </div>

                {tankerInput.observedInputType === 'Observed API' ? (
                  <Field
                    label="Observed API"
                    name="observedApi"
                    type="number"
                    value={tankerInput.observedApi}
                    onChange={handleTankerInputChange}
                    required
                    min={OBSERVED_API_LIMITS.min}
                    max={OBSERVED_API_LIMITS.max}
                    step="0.01"
                  />
                ) : (
                  <Field
                    label="Observed Density"
                    name="observedDensity"
                    type="number"
                    value={tankerInput.observedDensity}
                    onChange={handleTankerInputChange}
                    required
                    min={OBSERVED_DENSITY_LIMITS.min}
                    max={OBSERVED_DENSITY_LIMITS.max}
                    step="0.1"
                    placeholder="kg/m³"
                  />
                )}

                <div>
                  <label>Sample Temp Unit *</label>
                  <select
                    name="sampleTemperatureUnit"
                    value={tankerInput.sampleTemperatureUnit}
                    onChange={handleTankerInputChange}
                  >
                    <option value="F">°F</option>
                    <option value="C">°C</option>
                  </select>
                </div>

                <Field
                  label="Sample Temp"
                  name="sampleTemperature"
                  type="number"
                  value={tankerInput.sampleTemperature}
                  onChange={handleTankerInputChange}
                  required
                  min={sampleTempLimits.min}
                  max={sampleTempLimits.max}
                  step="0.1"
                  placeholder={`${sampleTempLimits.min} - ${sampleTempLimits.max}`}
                />
              </div>
            </details>

            <details className="tanker-section">
              <summary>4. Seal Details & Remarks</summary>

              <div className="operation-entry-subgrid tanker-tight-grid">
                <Field
                  label="Seal C1"
                  name="sealC1"
                  value={tankerInput.sealC1}
                  onChange={handleTankerInputChange}
                />

                <Field
                  label="Seal C2"
                  name="sealC2"
                  value={tankerInput.sealC2}
                  onChange={handleTankerInputChange}
                />

                <Field
                  label="Seal M1"
                  name="sealM1"
                  value={tankerInput.sealM1}
                  onChange={handleTankerInputChange}
                />

                <Field
                  label="Seal M2"
                  name="sealM2"
                  value={tankerInput.sealM2}
                  onChange={handleTankerInputChange}
                />

                <div className="full-width-field">
                  <div className="info-box tanker-seal-check-box">
                    <strong>Seal Cross-check</strong>
                    <div>
                      Entered seals: {enteredSealCount} / 4
                    </div>
                    <div>
                      Duplicate seals:{' '}
                      {duplicateSealCount > 0 ? (
                        <strong style={{ color: '#b91c1c' }}>
                          {duplicateSealCount}
                        </strong>
                      ) : (
                        <strong>0</strong>
                      )}
                    </div>
                    <small>
                      Sender/Receiver seal matching will be added in the Tanker
                      Tracking workflow after dispatch/receipt linking is built.
                    </small>
                  </div>
                </div>

                <div className="full-width-field">
                  <label>Tanker Remarks</label>
                  <textarea
                    name="remarks"
                    value={tankerInput.remarks}
                    onChange={handleTankerInputChange}
                    rows="3"
                    placeholder="Enter tanker remarks"
                  />
                </div>
              </div>
            </details>
          </div>

          <div className="tanker-results-panel">
            <div className="tanker-results-sticky">
              <div className="section-title compact-section-title">
                <h3>Live Quantity Preview</h3>
                <p>Calculated from linked tanker calibration.</p>
              </div>

              {validationResult.errors.length > 0 && (
                <div className="info-box tanker-error-box">
                  {validationResult.errors.map((error) => (
                    <div key={error}>{error}</div>
                  ))}
                </div>
              )}

              {validationResult.warnings?.length > 0 && (
                <div className="info-box">
                  {validationResult.warnings.map((warning) => (
                    <div key={warning}>{warning}</div>
                  ))}
                </div>
              )}

              {table11Loading && (
                <div className="info-box">Looking up Table 11 LT factor...</div>
              )}

              {table11Error && <div className="info-box">{table11Error}</div>}

              <div className="operation-layout-section-grid tanker-result-grid">
                <QuantityCard
                  title="Gross"
                  rows={[
                    {
                      label: 'TOV',
                      value: `${formatNumber(finalCalculated?.tovBbl, 3)} bbl`,
                    },
                    {
                      label: 'Free Water',
                      value: `${formatNumber(finalCalculated?.freeWaterBbl, 3)} bbl`,
                    },
                    {
                      label: 'GOV',
                      value: `${formatNumber(finalCalculated?.govBbl, 3)} bbl`,
                    },
                  ]}
                />

                <QuantityCard
                  title="Quality"
                  rows={[
                    {
                      label: 'Obs. API',
                      value: formatNumber(finalCalculated?.observedApi, 3),
                    },
                    {
                      label: 'Obs. Density',
                      value: formatNumber(finalCalculated?.observedDensity, 3),
                    },
                    {
                      label: 'API @ 60°F',
                      value: formatNumber(finalCalculated?.api60, 3),
                    },
                    {
                      label: 'VCF',
                      value: formatNumber(finalCalculated?.vcf, 5),
                    },
                  ]}
                />

                <QuantityCard
                  title="Net"
                  rows={[
                    {
                      label: 'GSV',
                      value: `${formatNumber(finalCalculated?.gsvBbl, 3)} bbl`,
                    },
                    {
                      label: 'BS&W Vol.',
                      value: `${formatNumber(finalCalculated?.bswBbl, 3)} bbl`,
                    },
                    {
                      label: 'NSV',
                      value: `${formatNumber(finalCalculated?.nsvBbl, 3)} bbl`,
                    },
                  ]}
                />

                <QuantityCard
                  title="Mass"
                  rows={[
                    {
                      label: 'LT Factor',
                      value: formatNumber(finalCalculated?.ltFactor, 6),
                    },
                    {
                      label: 'LT',
                      value: formatNumber(finalCalculated?.lt, 3),
                    },
                    {
                      label: 'MT',
                      value: formatNumber(finalCalculated?.mt, 3),
                    },
                  ]}
                />
              </div>

              <small className="tanker-method-note">
                {finalCalculated?.massMethod || ''}
              </small>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default TankerTruckLayout
