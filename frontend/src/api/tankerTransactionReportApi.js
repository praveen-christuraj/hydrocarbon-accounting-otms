import { apiGet } from './apiClient'

const buildQueryString = (filters = {}) => {
  const params = new URLSearchParams()

  Object.entries(filters).forEach(([key, value]) => {
    const cleanedValue = String(value ?? '').trim()

    if (cleanedValue !== '') {
      params.append(key, cleanedValue)
    }
  })

  const queryString = params.toString()

  return queryString ? `?${queryString}` : ''
}

const toNumber = (value) => {
  const numericValue = Number(value || 0)

  if (Number.isNaN(numericValue)) {
    return 0
  }

  return numericValue
}

const convertRowFromApi = (row) => {
  return {
    transactionId: row.transaction_id,
    operationNumber: row.operation_number || '',
    ticketNumber: row.ticket_number || '',

    operationDate: row.operation_date || '',
    operationStartDatetime: row.operation_start_datetime || '',
    operationEndDatetime: row.operation_end_datetime || '',

    operationTypeCode: row.operation_type_code || '',
    operationTypeName: row.operation_type_name || '',

    locationCode: row.location_code || '',
    locationName: row.location_name || '',

    assetCode: row.asset_code || '',
    assetName: row.asset_name || '',
    assetTypeCode: row.asset_type_code || '',

    convoyNumber: row.convoy_number || '',
    tankerName: row.tanker_name || '',
    primeMoverNumber: row.prime_mover_number || '',
    chassisNumber: row.chassis_number || '',

    cargo: row.cargo || '',
    tankerOperation: row.tanker_operation || '',
    destination: row.destination || '',
    loadingBay: row.loading_bay || '',
    compartment: row.compartment || '',

    totalDipCm: toNumber(row.total_dip_cm),
    waterDipCm: toNumber(row.water_dip_cm),
    bswPercent: toNumber(row.bsw_percent),

    tankTemperature: row.tank_temperature,
    tankTemperatureUnit: row.tank_temperature_unit || '',
    sampleTemperature: row.sample_temperature,
    sampleTemperatureUnit: row.sample_temperature_unit || '',

    observedInputType: row.observed_input_type || '',
    observedApi: row.observed_api,
    observedDensity: row.observed_density,
    api60: row.api60,
    vcf: row.vcf,

    tovBbl: toNumber(row.tov_bbl),
    freeWaterBbl: toNumber(row.free_water_bbl),
    govBbl: toNumber(row.gov_bbl),
    gsvBbl: toNumber(row.gsv_bbl),
    bswBbl: toNumber(row.bsw_bbl),
    nsvBbl: toNumber(row.nsv_bbl),

    ltFactor: row.lt_factor,
    lt: toNumber(row.lt),
    mt: toNumber(row.mt),

    sealC1: row.seal_c1 || '',
    sealC2: row.seal_c2 || '',
    sealM1: row.seal_m1 || '',
    sealM2: row.seal_m2 || '',

    remarks: row.remarks || '',
    status: row.status || '',
    createdBy: row.created_by || '',
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
  }
}

const convertTotalsFromApi = (totals = {}) => {
  return {
    rowsCount: toNumber(totals.rows_count),
    totalTovBbl: toNumber(totals.total_tov_bbl),
    totalFreeWaterBbl: toNumber(totals.total_free_water_bbl),
    totalGovBbl: toNumber(totals.total_gov_bbl),
    totalGsvBbl: toNumber(totals.total_gsv_bbl),
    totalBswBbl: toNumber(totals.total_bsw_bbl),
    totalNsvBbl: toNumber(totals.total_nsv_bbl),
    totalLt: toNumber(totals.total_lt),
    totalMt: toNumber(totals.total_mt),
  }
}

export const getTankerTransactionReport = async (filters = {}) => {
  const queryString = buildQueryString(filters)
  const data = await apiGet(`/tanker-transaction-report${queryString}`)

  return {
    rows: (data.rows || []).map(convertRowFromApi),
    totals: convertTotalsFromApi(data.totals || {}),
  }
}