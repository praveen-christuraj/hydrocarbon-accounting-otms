const WATER_DENSITY_AT_60F = 999.012
const BARREL_TO_CUBIC_METER = 0.158987294928
const LONG_TON_TO_METRIC_TON = 1.01605

export const TANK_TEMP_LIMITS = {
  C: {
    min: 15,
    max: 70,
  },
  F: {
    min: 60,
    max: 160,
  },
}

export const SAMPLE_TEMP_LIMITS = {
  C: {
    min: 15,
    max: 70,
  },
  F: {
    min: 60,
    max: 160,
  },
}

export const OBSERVED_API_LIMITS = {
  min: 15,
  max: 90,
}

export const OBSERVED_DENSITY_LIMITS = {
  min: 600,
  max: 1000,
}

export const BSW_LIMITS = {
  min: 0,
  max: 100,
}

export const normalizeTemperatureUnit = (unit) => {
  const value = String(unit || '')
    .replace('°', '')
    .trim()
    .toUpperCase()

  if (value === 'F') {
    return 'F'
  }

  return 'C'
}

export const celsiusToFahrenheit = (value) => {
  return Number(value || 0) * 1.8 + 32
}

export const fahrenheitToCelsius = (value) => {
  return (Number(value || 0) - 32) / 1.8
}

export const getTemperatureLimits = (unit, type = 'tank') => {
  const normalizedUnit = normalizeTemperatureUnit(unit)

  if (type === 'sample') {
    return SAMPLE_TEMP_LIMITS[normalizedUnit]
  }

  return TANK_TEMP_LIMITS[normalizedUnit]
}

export const clampNumber = (value, minimum, maximum) => {
  const numericValue = Number(value)

  if (Number.isNaN(numericValue)) {
    return minimum
  }

  if (numericValue < minimum) {
    return minimum
  }

  if (numericValue > maximum) {
    return maximum
  }

  return numericValue
}

export const parseNumber = (value, fallback = 0) => {
  if (value === null || value === undefined || value === '') {
    return fallback
  }

  const numericValue = Number(value)

  if (Number.isNaN(numericValue)) {
    return fallback
  }

  return numericValue
}

export const roundTo = (value, decimals = 3) => {
  const numericValue = Number(value)

  if (Number.isNaN(numericValue)) {
    return 0
  }

  const factor = 10 ** decimals
  return Math.round(numericValue * factor) / factor
}

export const formatNumber = (value, decimals = 3) => {
  const numericValue = Number(value)

  if (Number.isNaN(numericValue)) {
    return '0'
  }

  return numericValue.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  })
}

export const densityFromApi = (api) => {
  const apiValue = Number(api || 0)

  if (apiValue <= 0) {
    return 0
  }

  const specificGravity = 141.5 / (apiValue + 131.5)

  return roundTo(specificGravity * WATER_DENSITY_AT_60F, 1)
}

export const apiFromDensity = (density) => {
  const densityValue = Number(density || 0)

  if (densityValue <= 0) {
    return 0
  }

  const specificGravity = densityValue / WATER_DENSITY_AT_60F

  if (specificGravity <= 0) {
    return 0
  }

  return roundTo(141.5 / specificGravity - 131.5, 2)
}

export const apiObservedToApi60 = (apiObserved, sampleTemperatureF) => {
  const apiValue = Number(apiObserved || 0)
  const temperatureF = Number(sampleTemperatureF || 60)

  if (apiValue <= 0) {
    return 0
  }

  const temperatureDifference = temperatureF - 60

  const observedDensity =
    (141.5 * WATER_DENSITY_AT_60F) /
    (131.5 + apiValue) *
    ((1 - 0.00001278 * temperatureDifference) -
      0.0000000062 * temperatureDifference * temperatureDifference)

  let correctedDensity = observedDensity

  for (let index = 0; index < 10; index += 1) {
    const alpha = 341.0957 / (correctedDensity * correctedDensity)

    const vcf = Math.exp(
      -alpha * temperatureDifference -
        0.8 * alpha * alpha * temperatureDifference * temperatureDifference
    )

    correctedDensity = observedDensity / vcf
  }

  const api60 =
    (141.5 * WATER_DENSITY_AT_60F) / correctedDensity - 131.5

  return roundTo(api60, 3)
}

export const densityObservedToApi60 = (densityObserved, sampleTemperatureC) => {
  const densityValue = Number(densityObserved || 0)
  const temperatureC = Number(sampleTemperatureC || 15)

  if (densityValue <= 0) {
    return {
      api60: 0,
      density15: 0,
    }
  }

  const temperatureDifference = temperatureC - 15

  const hydrocarbonCorrection =
    (1 - 0.00001278 * temperatureDifference) -
    0.0000000062 * temperatureDifference * temperatureDifference

  const correctedObservedDensity = densityValue * hydrocarbonCorrection

  let density15 = correctedObservedDensity

  for (let index = 0; index < 17; index += 1) {
    const coefficient = 613.9723 / (density15 * density15)

    const vcf = Math.exp(
      -coefficient *
        temperatureDifference *
        (1 + 0.8 * coefficient * temperatureDifference)
    )

    density15 = correctedObservedDensity / vcf
  }

  const specificGravity60 =
    density15 / WATER_DENSITY_AT_60F

  const api60 =
    specificGravity60 > 0 ? 141.5 / specificGravity60 - 131.5 : 0

  return {
    api60: roundTo(api60, 3),
    density15: roundTo(density15, 3),
  }
}

export const getApi60FromObservedInput = ({
  observedInputType,
  observedApi,
  observedDensity,
  sampleTemperature,
  sampleTemperatureUnit,
}) => {
  const sampleUnit = normalizeTemperatureUnit(sampleTemperatureUnit)

  if (observedInputType === 'Observed API') {
    const sampleTemperatureF =
      sampleUnit === 'F'
        ? parseNumber(sampleTemperature, 60)
        : celsiusToFahrenheit(sampleTemperature)

    const api60 = apiObservedToApi60(observedApi, sampleTemperatureF)

    return {
      api60,
      density15: 0,
      observedApi: parseNumber(observedApi),
      observedDensity: densityFromApi(observedApi),
    }
  }

  const sampleTemperatureC =
    sampleUnit === 'C'
      ? parseNumber(sampleTemperature, 15)
      : fahrenheitToCelsius(sampleTemperature)

  const densityResult = densityObservedToApi60(
    observedDensity,
    sampleTemperatureC
  )

  return {
    api60: densityResult.api60,
    density15: densityResult.density15,
    observedApi: apiFromDensity(observedDensity),
    observedDensity: parseNumber(observedDensity),
  }
}

export const calculateVcf = (api60, tankTemperatureF) => {
  const apiValue = Number(api60 || 0)
  const temperatureF = Number(tankTemperatureF || 60)

  if (apiValue <= 0) {
    return 0
  }

  const temperatureDifference = temperatureF - 60

  const density60 =
    (141.5 * WATER_DENSITY_AT_60F) / (apiValue + 131.5)

  const alpha = 341.0957 / (density60 * density60)

  const vcf = Math.exp(
    -alpha * temperatureDifference -
      0.8 * alpha * alpha * temperatureDifference * temperatureDifference
  )

  return roundTo(vcf, 5)
}

export const calculateVcfFromApi60AndTankTemperature = ({
  api60,
  tankTemperature,
  tankTemperatureUnit,
}) => {
  const tankUnit = normalizeTemperatureUnit(tankTemperatureUnit)

  const tankTemperatureF =
    tankUnit === 'F'
      ? parseNumber(tankTemperature, 60)
      : celsiusToFahrenheit(tankTemperature)

  return calculateVcf(api60, tankTemperatureF)
}

export const linearInterpolation = (rows, inputValue, inputColumn, outputColumn) => {
  if (!Array.isArray(rows) || rows.length === 0) {
    return 0
  }

  const cleanRows = rows
    .map((row) => {
      const rowData = row.rowData || row.row_data || row

      return {
        input: parseNumber(rowData[inputColumn], null),
        output: parseNumber(rowData[outputColumn], null),
      }
    })
    .filter((row) => row.input !== null && row.output !== null)
    .sort((a, b) => a.input - b.input)

  if (cleanRows.length === 0) {
    return 0
  }

  const x = parseNumber(inputValue, 0)

  if (x <= cleanRows[0].input) {
    return cleanRows[0].output
  }

  if (x >= cleanRows[cleanRows.length - 1].input) {
    return cleanRows[cleanRows.length - 1].output
  }

  for (let index = 1; index < cleanRows.length; index += 1) {
    const previous = cleanRows[index - 1]
    const next = cleanRows[index]

    if (x <= next.input) {
      if (next.input === previous.input) {
        return previous.output
      }

      const ratio = (x - previous.input) / (next.input - previous.input)

      return previous.output + ratio * (next.output - previous.output)
    }
  }

  return 0
}

export const getCalibrationColumnsByRole = (calibrationTemplate) => {
  const columns = calibrationTemplate?.columns || []

  const inputColumn = columns.find((column) => {
    return column.interpolationRole === 'Input X'
  })

  const outputColumn = columns.find((column) => {
    return column.interpolationRole === 'Output'
  })

  return {
    inputColumnName: inputColumn?.columnName || inputColumn?.column_name || '',
    outputColumnName: outputColumn?.columnName || outputColumn?.column_name || '',
  }
}

export const getCalibrationMaxInput = (rows, inputColumnName) => {
  if (!Array.isArray(rows) || rows.length === 0 || !inputColumnName) {
    return 0
  }

  const values = rows
    .map((row) => {
      const rowData = row.rowData || row.row_data || row
      return parseNumber(rowData[inputColumnName], null)
    })
    .filter((value) => value !== null)

  if (values.length === 0) {
    return 0
  }

  return Math.max(...values)
}

export const density15FromApi60 = (api60) => {
  const apiValue = Number(api60 || 0)

  if (apiValue <= 0) {
    return 0
  }

  const specificGravity60 = 141.5 / (apiValue + 131.5)

  return roundTo(specificGravity60 * WATER_DENSITY_AT_60F, 3)
}

export const calculateApproximateMassFromNsv = ({
  nsvBbl,
  api60,
  density15,
}) => {
  const safeNsvBbl = Number(nsvBbl || 0)

  if (safeNsvBbl <= 0) {
    return {
      lt: 0,
      mt: 0,
      massMethod: 'Approximate density conversion',
    }
  }

  let workingDensity15 = Number(density15 || 0)

  if (workingDensity15 <= 0) {
    workingDensity15 = density15FromApi60(api60)
  }

  if (workingDensity15 <= 0) {
    return {
      lt: 0,
      mt: 0,
      massMethod: 'Mass not calculated - API/Density missing',
    }
  }

  const volumeM3 = safeNsvBbl * BARREL_TO_CUBIC_METER
  const metricTon = volumeM3 * (workingDensity15 / 1000)
  const longTon = metricTon / LONG_TON_TO_METRIC_TON

  return {
    lt: Math.round(longTon),
    mt: Math.round(metricTon),
    massMethod: 'Approximate density conversion',
  }
}


export const calculateTankQuantity = ({
  dipCm,
  waterLevelCm,
  tankTemperature,
  tankTemperatureUnit,
  observedInputType,
  observedApi,
  observedDensity,
  sampleTemperature,
  sampleTemperatureUnit,
  bswPercent,
  calibrationRows,
  inputColumnName,
  outputColumnName,
}) => {
  const tovBbl = linearInterpolation(
    calibrationRows,
    dipCm,
    inputColumnName,
    outputColumnName
  )

  const freeWaterBbl =
    parseNumber(waterLevelCm) <= 0
      ? 0
      : linearInterpolation(
          calibrationRows,
          waterLevelCm,
          inputColumnName,
          outputColumnName
        )

  const govBbl = Math.max(tovBbl - freeWaterBbl, 0)

  const apiResult = getApi60FromObservedInput({
    observedInputType,
    observedApi,
    observedDensity,
    sampleTemperature,
    sampleTemperatureUnit,
  })

  const vcf = calculateVcfFromApi60AndTankTemperature({
    api60: apiResult.api60,
    tankTemperature,
    tankTemperatureUnit,
  })

  const gsvBbl = Math.round(govBbl * vcf)

  const safeBswPercent = clampNumber(
    parseNumber(bswPercent, 0),
    BSW_LIMITS.min,
    BSW_LIMITS.max
  )

  const bswBbl = Math.round(gsvBbl * (safeBswPercent / 100))

  const nsvBbl = Math.max(Math.round(gsvBbl - bswBbl), 0)

  const resolvedDensity15 =
    apiResult.density15 && apiResult.density15 > 0
      ? apiResult.density15
      : density15FromApi60(apiResult.api60)

  const massResult = calculateApproximateMassFromNsv({
    nsvBbl,
    api60: apiResult.api60,
    density15: resolvedDensity15,
  })

  return {
    tovBbl: roundTo(tovBbl, 3),
    freeWaterBbl: roundTo(freeWaterBbl, 3),
    govBbl: roundTo(govBbl, 3),
    observedApi: roundTo(apiResult.observedApi, 3),
    observedDensity: roundTo(apiResult.observedDensity, 3),
    api60: roundTo(apiResult.api60, 3),
    density15: roundTo(resolvedDensity15, 3),
    vcf: roundTo(vcf, 5),
    gsvBbl,
    bswBbl,
    nsvBbl,
    lt: massResult.lt,
    mt: massResult.mt,
    massMethod: massResult.massMethod,
  }
}

export const validateTankGaugingInput = ({
  dipCm,
  waterLevelCm,
  maxCalibrationDipCm,
  tankTemperature,
  tankTemperatureUnit,
  observedInputType,
  observedApi,
  observedDensity,
  sampleTemperature,
  sampleTemperatureUnit,
  bswPercent,
}) => {
  const errors = []
  const warnings = []

  const maxDip = parseNumber(maxCalibrationDipCm, 0)
  const dip = parseNumber(dipCm, null)
  const waterLevel = parseNumber(waterLevelCm, null)

  if (dip === null) {
    errors.push('Dip is required.')
  } else if (dip < 0) {
    errors.push('Dip cannot be less than 0 cm.')
  } else if (maxDip > 0 && dip > maxDip) {
    errors.push(`Dip cannot exceed calibration maximum ${maxDip} cm.`)
  }

  if (waterLevel === null) {
    errors.push('Water Level is required.')
  } else if (waterLevel < 0) {
    errors.push('Water Level cannot be less than 0 cm.')
  } else if (maxDip > 0 && waterLevel > maxDip) {
    errors.push(`Water Level cannot exceed calibration maximum ${maxDip} cm.`)
  }

  if (waterLevel > dip) {
    warnings.push('Water Level is greater than Dip. Please verify the gauging.')
  }

  const tankUnit = normalizeTemperatureUnit(tankTemperatureUnit)
  const tankLimits = getTemperatureLimits(tankUnit, 'tank')
  const tankTemp = parseNumber(tankTemperature, null)

  if (tankTemp === null) {
    errors.push('Tank Temperature is required.')
  } else if (tankTemp < tankLimits.min || tankTemp > tankLimits.max) {
    errors.push(
      `Tank Temperature must be between ${tankLimits.min} and ${tankLimits.max} °${tankUnit}.`
    )
  }

  const sampleUnit = normalizeTemperatureUnit(sampleTemperatureUnit)
  const sampleLimits = getTemperatureLimits(sampleUnit, 'sample')
  const sampleTemp = parseNumber(sampleTemperature, null)

  if (sampleTemp === null) {
    errors.push('Sample Temperature is required.')
  } else if (sampleTemp < sampleLimits.min || sampleTemp > sampleLimits.max) {
    errors.push(
      `Sample Temperature must be between ${sampleLimits.min} and ${sampleLimits.max} °${sampleUnit}.`
    )
  }

  if (observedInputType === 'Observed API') {
    const api = parseNumber(observedApi, null)

    if (api === null) {
      errors.push('Observed API is required.')
    } else if (
      api < OBSERVED_API_LIMITS.min ||
      api > OBSERVED_API_LIMITS.max
    ) {
      errors.push(
        `Observed API must be between ${OBSERVED_API_LIMITS.min} and ${OBSERVED_API_LIMITS.max}.`
      )
    }
  } else {
    const density = parseNumber(observedDensity, null)

    if (density === null) {
      errors.push('Observed Density is required.')
    } else if (
      density < OBSERVED_DENSITY_LIMITS.min ||
      density > OBSERVED_DENSITY_LIMITS.max
    ) {
      errors.push(
        `Observed Density must be between ${OBSERVED_DENSITY_LIMITS.min} and ${OBSERVED_DENSITY_LIMITS.max} kg/m³.`
      )
    }
  }

  const bsw = parseNumber(bswPercent, null)

  if (bsw === null) {
    errors.push('BS&W % is required.')
  } else if (bsw < BSW_LIMITS.min || bsw > BSW_LIMITS.max) {
    errors.push('BS&W % must be between 0 and 100.')
  }

  return {
    errors,
    warnings,
  }
}