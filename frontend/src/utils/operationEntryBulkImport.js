/*
 * Bulk Operation Entry import – spreadsheet ⇄ ticket engine.
 *
 * Operation Entry is different from the master-data pages: one row is not one
 * record, it is a whole ticket (metadata + operation type + template + the
 * values of every template field, including the asset-specific JSON payload).
 * This module owns that translation so it can be tested without React:
 *
 *   const fields = buildOperationEntryImportFields({ template, layoutType })
 *   const prepared = prepareOperationEntryImportRow({ record, template, … })
 *   await createOperationEntry(prepared.entry)
 *
 * Design rules
 *  - The upload layout is derived from the *selected* Operation Template, so
 *    the file always matches the ticket the user is about to create.
 *  - Every operation-entry metadata column is part of the template (operation
 *    type, template, asset, sender, receiver, convoy/shuttle number, product,
 *    created by, remarks), so a single file can carry complete tickets.
 *  - Asset-specific payload fields (tank gauging, tanker, multi-tank, shuttle,
 *    FSO, flowmeter) are exposed as flat `payload.<fieldCode>.<path>` columns
 *    (for example `payload.tank_gauging_payload.inputs.dipCm`). A column that
 *    carries the whole JSON document is also supported and wins over nothing –
 *    individual path columns override the raw document.
 *  - Rows are validated against the same masters the form uses (operation
 *    types, locations, assets, the template's required fields and the
 *    mandatory payload sections), so a bad row is reported before anything is
 *    written.
 *  - Nothing here writes to the API: the dialog creates one Draft ticket per
 *    valid row, in order, and reports the result of each row.
 */
import { toIsoDateString } from './format'
import { resolveOperationDate } from './operationDate'
import {
  calculateTankQuantity,
  getCalibrationColumnsByRole,
  getCalibrationMaxInput,
  validateTankGaugingInput,
} from './tankQuantityEngine'
import {
  loadCalibrationRows,
  selectActiveCalibrationTable,
} from '../hooks/useActiveCalibrationTable'
import { lookupTable11Factor } from '../api/table11Api'

const LONG_TON_TO_METRIC_TON = 1.01605

/** Every JSON payload field code the application knows about. */
export const PAYLOAD_FIELD_CODES = [
  'tank_gauging_payload',
  'multi_tank_payload',
  'tanker_payload',
  'shuttle_payload',
  'fso_payload',
  'flowmeter_payload',
]

export const normalizeLayoutType = (value) =>
  String(value ?? '').trim().toLowerCase()

export const isPayloadField = (field) =>
  PAYLOAD_FIELD_CODES.includes(String(field?.fieldCode || '')) ||
  String(field?.dataType || '').trim().toLowerCase() === 'json'

/* ------------------------------------------------------------------ metadata */

/**
 * Operation-entry metadata columns. `key` is the entry property the value is
 * written to; the clubbed Sender / Receiver columns fill both halves of their
 * pair exactly like the on-screen dropdowns do.
 */
export const OPERATION_ENTRY_METADATA_DEFINITIONS = [
  {
    key: 'operationTypeCode',
    label: 'Operation Type Code',
    required: true,
    aliases: ['Operation Type', 'Operation Type Code', 'Op Type', 'Operation Code'],
    example: 'TANK_GAUGING',
    hint: 'Must match the operation type selected for this upload.',
  },
  {
    key: 'operationTemplateName',
    label: 'Operation Template',
    required: false,
    aliases: ['Template', 'Operation Template Name', 'Template Name', 'Operation Template'],
    example: '',
    hint: 'Optional. When filled it must match the template selected for this upload.',
  },
  {
    key: 'primaryAssetCode',
    label: 'Primary Asset Code',
    required: true,
    aliases: ['Primary Asset', 'Asset', 'Asset Code', 'Primary Asset Code'],
    example: '',
    hint: 'The asset must be Active and its asset type must match the operation type.',
  },
  {
    key: 'senderLocationCode',
    label: 'Sender Location Code',
    required: true,
    aliases: [
      'Sender',
      'Sender Location',
      'Sender Location Code',
      'Origin',
      'Origin Location',
      'Origin Location Code',
    ],
    example: '',
    hint: 'Sets both Origin and Sender, like the Sender dropdown on the form.',
  },
  {
    key: 'receiverLocationCode',
    label: 'Receiver Location Code',
    required: false,
    aliases: [
      'Receiver',
      'Receiver Location',
      'Receiver Location Code',
      'Destination',
      'Destination Location',
      'Destination Location Code',
    ],
    example: '',
    hint: 'Sets both Destination and Receiver. Mandatory for operation types that require it.',
  },
  {
    key: 'convoyNumber',
    label: 'Convoy / Shuttle Number',
    required: false,
    aliases: [
      'Convoy',
      'Convoy Number',
      'Convoy No',
      'Shuttle',
      'Shuttle Number',
      'Shuttle No',
    ],
    example: '',
    hint: 'Mandatory for Multi-Tank, Tanker and Shuttle Tracking layouts.',
  },
  {
    key: 'productName',
    label: 'Product',
    required: false,
    aliases: ['Product', 'Product Name', 'Cargo'],
    example: '',
  },
  {
    key: 'createdBy',
    label: 'Created By',
    required: false,
    aliases: ['Created By', 'Creator', 'Entered By'],
    example: '',
    hint: 'Defaults to the signed-in user when left blank.',
  },
  {
    key: 'remarks',
    label: 'Remarks',
    required: false,
    aliases: ['Remarks', 'Remark', 'Comments', 'Notes'],
    example: '',
  },
]

export const METADATA_KEYS = OPERATION_ENTRY_METADATA_DEFINITIONS.map((item) => item.key)

/* ------------------------------------------------------------ payload shapes */

const numberPath = (path, label, extra = {}) => ({
  path,
  label,
  dataType: 'Number',
  ...extra,
})
const textPath = (path, label, extra = {}) => ({
  path,
  label,
  dataType: 'Text',
  ...extra,
})
const datePath = (path, label, extra = {}) => ({
  path,
  label,
  dataType: 'Date',
  ...extra,
})

const OBSERVED_PATHS = [
  textPath('inputs.observedInputType', 'Observed Input Type', {
    example: 'Observed API',
    hint: 'Observed API or Observed Density',
  }),
  numberPath('inputs.observedApi', 'Observed API', { example: '34.5' }),
  numberPath('inputs.observedDensity', 'Observed Density', { example: '825.4' }),
]

const TEMPERATURE_PATHS = [
  numberPath('inputs.tankTemperature', 'Tank Temperature', { example: '38.2' }),
  textPath('inputs.tankTemperatureUnit', 'Tank Temperature Unit', { example: 'C' }),
  numberPath('inputs.sampleTemperature', 'Sample Temperature', { example: '28.4' }),
  textPath('inputs.sampleTemperatureUnit', 'Sample Temperature Unit', { example: 'F' }),
]

/**
 * Flat payload columns per entry layout. Paths are relative to the payload
 * document (e.g. `inputs.dipCm` for `tank_gauging_payload`).
 *
 * Any additional column named `payload.<fieldCode>.<path>` (or
 * `<fieldCode>.<path>`) is also accepted, so dynamic structures such as the
 * multi-tank per-tank dips do not need a static column list.
 */
export const PAYLOAD_PROFILES = {
  'tank gauging': {
    fieldCode: 'tank_gauging_payload',
    label: 'Tank Gauging Payload',
    note:
      'Quantities (TOV / GOV / GSV / NSV / LT / MT) are calculated during the upload from the active calibration table of the asset.',
    paths: [
      datePath('inputs.gaugingDate', 'Gauging Date', { example: '2026-10-20' }),
      textPath('inputs.gaugingTime', 'Gauging Time', { example: '08:30' }),
      numberPath('inputs.dipCm', 'Dip (cm)', { example: '845.0' }),
      numberPath('inputs.waterLevelCm', 'Water Level (cm)', { example: '1.2' }),
      ...TEMPERATURE_PATHS,
      numberPath('inputs.bswPercent', 'BS&W %', { example: '0.5' }),
      ...OBSERVED_PATHS,
      textPath('inputs.tankOperationCode', 'Tank Operation Code', {
        hint: 'Optional: the tank operation recorded for this gauging.',
      }),
      textPath('inputs.remarks', 'Gauging Remarks'),
    ],
    requiredPaths: [
      ['inputs.gaugingDate', 'Gauging Date'],
      ['inputs.gaugingTime', 'Gauging Time'],
      ['inputs.dipCm', 'Dip (cm)'],
      ['inputs.waterLevelCm', 'Water Level (cm)'],
      ['inputs.tankTemperature', 'Tank Temperature'],
      ['inputs.sampleTemperature', 'Sample Temperature'],
      ['inputs.bswPercent', 'BS&W %'],
    ],
    observedPathRule: true,
  },

  'tanker loading': {
    fieldCode: 'tanker_payload',
    label: 'Tanker Payload',
    note:
      'The entered tanker observations are saved with the ticket. Quantities that depend on the trailer calibration are completed when the ticket is opened for review.',
    paths: [
      datePath('inputs.tankerTransactionDate', 'Tanker Date', { example: '2026-10-20' }),
      textPath('inputs.tankerTransactionTime', 'Tanker Time', { example: '09:15' }),
      textPath('inputs.compartment', 'Compartment / Manhole', { example: 'C1' }),
      numberPath('inputs.totalDipCm', 'Total Dip (cm)', { example: '180.0' }),
      numberPath('inputs.waterDipCm', 'Water Dip (cm)', { example: '0' }),
      numberPath('inputs.bswPercent', 'BS&W %', { example: '0.4' }),
      ...TEMPERATURE_PATHS,
      ...OBSERVED_PATHS,
      textPath('inputs.operation', 'Operation'),
      textPath('inputs.sealC1', 'Seal C1'),
      textPath('inputs.sealC2', 'Seal C2'),
      textPath('inputs.sealM1', 'Seal M1'),
      textPath('inputs.sealM2', 'Seal M2'),
      textPath('inputs.remarks', 'Tanker Remarks'),
    ],
    requiredPaths: [
      ['inputs.tankerTransactionDate', 'Tanker Date'],
      ['inputs.tankerTransactionTime', 'Tanker Time'],
      ['inputs.compartment', 'Compartment / Manhole'],
      ['inputs.totalDipCm', 'Total Dip (cm)'],
      ['inputs.waterDipCm', 'Water Dip (cm)'],
      ['inputs.bswPercent', 'BS&W %'],
      ['inputs.tankTemperature', 'Tank Temperature'],
      ['inputs.sampleTemperature', 'Sample Temperature'],
    ],
    observedPathRule: true,
  },

  'multi-tank before/after': {
    fieldCode: 'multi_tank_payload',
    label: 'Multi-Tank Payload',
    note:
      'Enter the tank ids in meta.tankIds (comma separated) and one pair of dip columns per tank, e.g. payload.multi_tank_payload.inputs.before.dips.TK-101.total. Calculated values are completed when the ticket is opened.',
    paths: [
      textPath('meta.tankIds', 'Tank IDs', {
        example: 'TK-101,TK-102',
        hint: 'Comma separated list of the tanks gauged before and after.',
      }),
      datePath('inputs.before.date', 'Before Date', {
        example: '2026-10-20',
        hint: 'The ticket date is taken from this value (Multi-Tank = before).',
      }),
      textPath('inputs.before.time', 'Before Time', { example: '06:30' }),
      datePath('inputs.after.date', 'After Date', { example: '2026-10-21' }),
      textPath('inputs.after.time', 'After Time', { example: '06:30' }),
      textPath('inputs.before.tankTemp', 'Before Tank Temp', { example: '38.2' }),
      textPath('inputs.before.sampleTemp', 'Before Sample Temp', { example: '28.4' }),
      textPath('inputs.before.bswPct', 'Before BS&W %', { example: '0.5' }),
      textPath('inputs.before.obsMode', 'Before Observed Mode', { example: 'Observed API' }),
      textPath('inputs.before.obsApi', 'Before Observed API', { example: '34.5' }),
      textPath('inputs.before.obsDensity', 'Before Observed Density', { example: '825.4' }),
      textPath('inputs.after.tankTemp', 'After Tank Temp', { example: '39.1' }),
      textPath('inputs.after.sampleTemp', 'After Sample Temp', { example: '28.9' }),
      textPath('inputs.after.bswPct', 'After BS&W %', { example: '0.6' }),
      textPath('inputs.after.obsMode', 'After Observed Mode', { example: 'Observed API' }),
      textPath('inputs.after.obsApi', 'After Observed API', { example: '34.6' }),
      textPath('inputs.after.obsDensity', 'After Observed Density', { example: '825.2' }),
    ],
    requiredPaths: [],
    multiTankRule: true,
  },

  'shuttle tracking': {
    fieldCode: 'shuttle_payload',
    label: 'Shuttle Payload',
    note:
      'Net stock / net water are calculated from the opening and closing figures during the upload.',
    paths: [
      datePath('inputs.operation_date', 'Operation Date', { example: '2026-10-20' }),
      textPath('inputs.event_time', 'Event Time', { example: '06:30' }),
      numberPath('inputs.opening_stock_bbl', 'Opening Stock (bbl)', { example: '120000' }),
      numberPath('inputs.opening_water_bbl', 'Opening Water (bbl)', { example: '150' }),
      numberPath('inputs.closing_stock_bbl', 'Closing Stock (bbl)', { example: '118500' }),
      numberPath('inputs.closing_water_bbl', 'Closing Water (bbl)', { example: '140' }),
      textPath('inputs.barge_reference', 'Barge Reference'),
      textPath('inputs.remarks', 'Payload Remarks'),
    ],
    requiredPaths: [['inputs.operation_date', 'Operation Date']],
    netRule: 'shuttle',
  },

  'fso tracking': {
    fieldCode: 'fso_payload',
    label: 'FSO Payload',
    note:
      'Net stock, net water and the vessel variance are calculated from the opening / closing figures during the upload.',
    paths: [
      datePath('inputs.operation_date', 'Operation Date', { example: '2026-10-20' }),
      textPath('inputs.event_time', 'Event Time', { example: '06:30' }),
      textPath('inputs.shuttle_number', 'Shuttle Number'),
      textPath('inputs.vessel_name', 'Vessel Name', { example: 'MT Kainji' }),
      numberPath('inputs.vessel_quantity_bbl', 'Vessel Quantity (bbl)', { example: '95000' }),
      numberPath('inputs.opening_stock_bbl', 'Opening Stock (bbl)', { example: '120000' }),
      numberPath('inputs.opening_water_bbl', 'Opening Water (bbl)', { example: '150' }),
      numberPath('inputs.closing_stock_bbl', 'Closing Stock (bbl)', { example: '118500' }),
      numberPath('inputs.closing_water_bbl', 'Closing Water (bbl)', { example: '140' }),
      textPath('inputs.remarks', 'Payload Remarks'),
    ],
    requiredPaths: [['inputs.operation_date', 'Operation Date']],
    netRule: 'fso',
  },

  'meter reading': {
    fieldCode: 'flowmeter_payload',
    label: 'Flowmeter Payload',
    note:
      'Enter the meter readings per stream; calculated gross / net values are completed when the ticket is opened.',
    paths: [
      datePath('inputs.reading_date', 'Reading Date', { example: '2026-10-20' }),
      textPath('inputs.event_time', 'Event Time', { example: '06:30' }),
      textPath('inputs.stream_name', 'Stream Name', { example: 'Export Line 1' }),
      textPath('inputs.meter_label', 'Meter Label'),
      numberPath('inputs.meters.0.opening_reading', 'Meter 1 Opening Reading', { example: '10500' }),
      numberPath('inputs.meters.0.closing_reading', 'Meter 1 Closing Reading', { example: '11250' }),
      textPath('inputs.meters.0.meter_unit', 'Meter 1 Unit', { example: 'bbl' }),
      numberPath('inputs.meters.0.meter_factor', 'Meter 1 Factor', { example: '1' }),
      numberPath('inputs.meters.1.opening_reading', 'Meter 2 Opening Reading'),
      numberPath('inputs.meters.1.closing_reading', 'Meter 2 Closing Reading'),
      textPath('inputs.meters.1.meter_unit', 'Meter 2 Unit'),
      numberPath('inputs.meters.1.meter_factor', 'Meter 2 Factor'),
      ...TEMPERATURE_PATHS,
      numberPath('inputs.bsw_percent', 'BS&W %', { example: '0.4' }),
      ...OBSERVED_PATHS.map((item) =>
        item.path === 'inputs.observedApi'
          ? numberPath('inputs.observed_api', 'Observed API')
          : item.path === 'inputs.observedDensity'
            ? numberPath('inputs.observed_density', 'Observed Density')
            : textPath('inputs.observed_input_type', 'Observed Input Type', {
                example: 'Observed API',
              })
      ),
      textPath('inputs.remarks', 'Payload Remarks'),
    ],
    requiredPaths: [
      ['inputs.reading_date', 'Reading Date'],
      ['inputs.tank_temperature', 'Tank Temperature'],
      ['inputs.sample_temperature', 'Sample Temperature'],
      ['inputs.bsw_percent', 'BS&W %'],
    ],
    flowmeterRule: true,
  },
}

export const getPayloadProfile = (layoutType) =>
  PAYLOAD_PROFILES[normalizeLayoutType(layoutType)] || null

/** JSON payload template fields that belong to the given layout. */
export const getPayloadFieldCodes = (template) =>
  (template?.fields || [])
    .filter((field) => field.status === 'Active' && isPayloadField(field))
    .map((field) => field.fieldCode)

/* ------------------------------------------------------- template / columns */

const isActiveField = (field) =>
  String(field?.status || '').trim().toLowerCase() === 'active'

export const activeTemplateFields = (template) =>
  [...(template?.fields || [])]
    .filter(isActiveField)
    .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0))

const exampleForDataType = (dataType) => {
  const type = String(dataType || '').trim().toLowerCase()
  if (type === 'number') return '0'
  if (type === 'date') return '2026-10-20'
  if (type === 'datetime') return '2026-10-20T08:30'
  if (type === 'boolean') return 'Yes'
  return ''
}

/**
 * Column list for the upload template and the mapping step.
 *
 * Each column carries the key that `buildOperationEntryFromRecord` reads, the
 * human label used in the template and the aliases accepted when auto-mapping
 * a file the client prepared themselves.
 */

/**
 * Headings a client may already use for a payload column. The template itself
 * writes `item.label`; the aliases accept the label without its unit, the last
 * path segment (`dipCm`), the spaced form (`dip cm`) and a "Payload …" prefix
 * so a file prepared by hand still maps automatically.
 */
const payloadAliases = (item, fieldCode) => {
  const label = String(item.label || '')
  const withoutUnit = label.replace(/\s*\([^)]*\)\s*$/, '').trim()
  const lastSegment = String(item.path || '').split('.').filter(Boolean).pop() || ''
  const spacedSegment = lastSegment
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replaceAll('_', ' ')
    .trim()

  return [
    label,
    withoutUnit,
    `Payload ${withoutUnit}`,
    lastSegment,
    spacedSegment,
    `Payload ${spacedSegment}`,
    `${fieldCode}.${item.path}`,
    `${fieldCode}.${item.path}`.replaceAll('.', ' '),
  ].filter(Boolean)
}

export const buildOperationEntryImportFields = ({ template, layoutType }) => {
  const fields = OPERATION_ENTRY_METADATA_DEFINITIONS.map((definition) => ({
    key: `metadata.${definition.key}`,
    metadataKey: definition.key,
    kind: 'metadata',
    label: definition.label,
    required: Boolean(definition.required) && definition.key !== 'operationTypeCode',
    // Operation Type / Template always come from the upload selection; the
    // file may repeat them, but a blank or matching value is never an error.
    aliases: definition.aliases,
    example: definition.example || '',
    hint: definition.hint || '',
    dataType: 'Text',
  }))

  const templateFields = activeTemplateFields(template)
  const payloadCodes = new Set(
    templateFields.filter((field) => isPayloadField(field)).map((field) => field.fieldCode)
  )

  templateFields.forEach((field) => {
    if (payloadCodes.has(field.fieldCode)) return
    fields.push({
      key: `field.${field.fieldCode}`,
      fieldCode: field.fieldCode,
      kind: 'field',
      label: field.unit ? `${field.fieldName} (${field.unit})` : field.fieldName,
      required:
        String(field.isRequired || '').trim().toLowerCase() === 'yes' &&
        String(field.inputMode || '').trim().toLowerCase() === 'manual',
      aliases: [field.fieldName, field.fieldCode],
      example: exampleForDataType(field.dataType),
      hint: `Template field · ${field.inputMode || 'Manual'}${field.fieldGroup ? ` · ${field.fieldGroup}` : ''}`,
      dataType: field.dataType,
    })
  })

  const profile = getPayloadProfile(layoutType)
  templateFields
    .filter((field) => payloadCodes.has(field.fieldCode))
    .forEach((field) => {
      const usesProfile = profile && profile.fieldCode === field.fieldCode
      fields.push({
        key: `payload.${field.fieldCode}`,
        fieldCode: field.fieldCode,
        kind: 'payload-json',
        label: `${field.fieldName} (raw JSON)`,
        required: false,
        aliases: [field.fieldName, field.fieldCode],
        example: '',
        hint: 'Advanced: paste the complete payload JSON in one cell.',
        dataType: 'JSON',
      })

      if (!usesProfile) return

      profile.paths.forEach((item) => {
        fields.push({
          key: `payload.${field.fieldCode}.${item.path}`,
          fieldCode: field.fieldCode,
          path: item.path,
          kind: 'payload',
          label: item.label,
          required: Boolean(item.required),
          aliases: payloadAliases(item, field.fieldCode),
          example: item.example || '',
          hint: item.hint || `Payload path · ${item.path}`,
          dataType: item.dataType,
        })
      })
    })

  return fields
}

/* --------------------------------------------------------- value utilities */

const isBlank = (value) =>
  value === null || value === undefined || String(value).trim() === ''

const trimText = (value) => (value === null || value === undefined ? '' : String(value).trim())

const toNumberOrText = (value) => {
  const text = trimText(value)
  if (text === '') return ''
  const number = Number(String(text).replaceAll(',', ''))
  return Number.isFinite(number) ? number : text
}

const coerceValue = (value, dataType) => {
  const type = String(dataType || '').trim().toLowerCase()
  if (isBlank(value)) return ''
  if (type === 'number') return toNumberOrText(value)
  if (type === 'date') return toIsoDateString(value) || trimText(value)
  if (type === 'boolean') {
    const text = trimText(value).toLowerCase()
    if (['yes', 'true', '1', 'y'].includes(text)) return true
    if (['no', 'false', '0', 'n'].includes(text)) return false
    return trimText(value)
  }
  return trimText(value)
}

/** Infer the value type of a payload path that is not in the static profile. */
const coercePayloadValue = (value, dataType) => {
  if (dataType) return coerceValue(value, dataType)
  return toNumberOrText(value)
}

const splitPath = (path) =>
  String(path || '')
    .split('.')
    .map((part) => part.trim())
    .filter(Boolean)

const setDeepValue = (target, path, value) => {
  const parts = splitPath(path)
  if (parts.length === 0) return target
  let cursor = target
  parts.forEach((part, index) => {
    const isLast = index === parts.length - 1
    const nextPart = parts[index + 1]
    const arrayIndex = /^\d+$/.test(part) ? Number(part) : null
    const nextIsArrayIndex = nextPart !== undefined && /^\d+$/.test(nextPart)

    if (isLast) {
      if (arrayIndex !== null) {
        if (!Array.isArray(cursor)) return
        cursor[arrayIndex] = value
      } else {
        cursor[part] = value
      }
      return
    }

    if (arrayIndex !== null) {
      if (!Array.isArray(cursor)) return
      if (!cursor[arrayIndex] || typeof cursor[arrayIndex] !== 'object') {
        cursor[arrayIndex] = nextIsArrayIndex ? [] : {}
      }
      cursor = cursor[arrayIndex]
      return
    }

    if (!cursor[part] || typeof cursor[part] !== 'object') {
      cursor[part] = nextIsArrayIndex ? [] : {}
    }
    cursor = cursor[part]
  })
  return target
}

const getDeepValue = (source, path) => {
  if (!source || typeof source !== 'object') return undefined
  return splitPath(path).reduce((acc, part) => {
    if (acc === null || acc === undefined) return undefined
    return acc[part]
  }, source)
}

const parseJsonCell = (value) => {
  if (value === null || value === undefined) return null
  if (typeof value === 'object') return value
  const text = String(value).trim()
  if (!text) return null
  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

/* ----------------------------------------------------------- record assembly */

const PAYLOAD_PREFIX = 'payload.'

/**
 * Read every payload path that belongs to one payload field out of a mapped
 * record. Accepts both `payload.<fieldCode>.<path>` and `<fieldCode>.<path>`.
 */
export const readPayloadPaths = (record, fieldCode) => {
  const prefix = `${PAYLOAD_PREFIX}${fieldCode}.`
  const barePrefix = `${fieldCode}.`
  const values = []
  Object.entries(record || {}).forEach(([key, value]) => {
    if (isBlank(value)) return
    if (key.startsWith(prefix)) {
      values.push({ path: key.slice(prefix.length), value })
      return
    }
    if (key.startsWith(barePrefix)) {
      values.push({ path: key.slice(barePrefix.length), value })
    }
  })
  return values
}

const buildPayloadValue = ({ record, field, layoutType, entry }) => {
  const profile = getPayloadProfile(layoutType)
  const usesProfile = profile && profile.fieldCode === field.fieldCode
  const rawJson = parseJsonCell(record?.[`payload.${field.fieldCode}`])
  const payload = rawJson ? { ...rawJson } : {}

  if (rawJson && Array.isArray(rawJson.inputs?.meters)) {
    payload.inputs = { ...(rawJson.inputs || {}), meters: rawJson.inputs.meters.map((row) => ({ ...row })) }
  }

  const paths = readPayloadPaths(record, field.fieldCode)
  paths.forEach(({ path, value }) => {
    const known = usesProfile
      ? profile.paths.find((item) => item.path === path)
      : null
    let coerced = coercePayloadValue(value, known?.dataType)

    // A comma separated tank id list is stored as an array, like the layout.
    if (usesProfile && path === 'meta.tankIds' && typeof coerced === 'string') {
      coerced = coerced
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    }

    setDeepValue(payload, path, coerced)
  })

  const hasContent = Object.keys(payload).length > 0
  if (!hasContent) return null

  return decoratePayload({ payload, fieldCode: field.fieldCode, layoutType, entry })
}

/**
 * Add the structural keys the on-screen layouts always write (schema markers,
 * asset / location references and the simple calculated blocks). Quantities
 * that need a calibration table are added later by `enrichTankGaugingEntry`.
 */
const decoratePayload = ({ payload, fieldCode, layoutType, entry }) => {
  const next = { ...payload }
  const inputs = { ...(next.inputs || {}) }
  next.inputs = inputs

  const locationCode = trimText(entry.originLocationCode)
  const assetCode = trimText(entry.primaryAssetCode)
  const convoy = trimText(entry.convoyNumber)
  const assetName = trimText(entry.__assetName)
  const assetTypeCode = trimText(entry.__assetTypeCode)

  if (fieldCode === 'tank_gauging_payload') {
    next.layout_type = next.layout_type || 'Tank Gauging'
    next.calculation_engine = next.calculation_engine || 'Tank Quantity'
    next.asset = next.asset || {
      asset_code: assetCode,
      asset_name: assetName,
      asset_type_code: assetTypeCode,
    }
    return next
  }

  if (fieldCode === 'tanker_payload') {
    next.layout_type = next.layout_type || 'Tanker Loading'
    next.calculation_engine = next.calculation_engine || 'Tanker Quantity'
    inputs.convoyNumber = trimText(inputs.convoyNumber) || convoy
    inputs.cargo = trimText(inputs.cargo) || trimText(entry.productName)
    next.asset = next.asset || {
      asset_code: assetCode,
      asset_name: assetName,
      asset_type_code: assetTypeCode,
    }
    return next
  }

  if (fieldCode === 'multi_tank_payload') {
    next.meta = {
      layout: 'Multi-Tank Before/After',
      assetCode,
      assetName,
      ...(next.meta || {}),
    }
    const tankIds = next.meta.tankIds
    if (typeof tankIds === 'string') {
      next.meta.tankIds = tankIds
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    }
    return next
  }

  if (fieldCode === 'shuttle_payload') {
    next.meta = {
      schema: 'shuttle_payload_v2',
      location_code: locationCode,
      shuttle_number: convoy,
      shuttle_asset_code: assetCode,
      ...(next.meta || {}),
    }
    const opening = toNumberOrText(inputs.opening_stock_bbl)
    const openingWater = toNumberOrText(inputs.opening_water_bbl)
    const closing = toNumberOrText(inputs.closing_stock_bbl)
    const closingWater = toNumberOrText(inputs.closing_water_bbl)
    if ([opening, openingWater, closing, closingWater].every((item) => typeof item === 'number')) {
      const netStock = closing - opening
      const netWater = closingWater - openingWater
      next.calculated = {
        net: {
          net_stock_bbl: netStock,
          net_water_bbl: netWater,
          TOV: netStock,
          FW: netWater,
          NSV: netStock,
        },
      }
    }
    return next
  }

  if (fieldCode === 'fso_payload') {
    const shuttleNumber = trimText(inputs.shuttle_number) || convoy
    inputs.shuttle_number = shuttleNumber || inputs.shuttle_number || null
    next.meta = {
      schema: 'fso_payload_v2',
      location_code: locationCode,
      fso_asset_code: assetCode,
      shuttle_number: shuttleNumber || null,
      ...(next.meta || {}),
    }
    const opening = toNumberOrText(inputs.opening_stock_bbl)
    const openingWater = toNumberOrText(inputs.opening_water_bbl)
    const closing = toNumberOrText(inputs.closing_stock_bbl)
    const closingWater = toNumberOrText(inputs.closing_water_bbl)
    const vesselQty = toNumberOrText(inputs.vessel_quantity_bbl)
    if ([opening, openingWater, closing, closingWater].every((item) => typeof item === 'number')) {
      const netStock = closing - opening
      const netWater = closingWater - openingWater
      next.calculated = {
        net: {
          net_stock_bbl: netStock,
          net_water_bbl: netWater,
          ...(typeof vesselQty === 'number'
            ? { variance_bbl: vesselQty - Math.abs(netStock + netWater) }
            : {}),
        },
      }
    }
    return next
  }

  if (fieldCode === 'flowmeter_payload') {
    next.meta = {
      schema: 'flowmeter_payload_v2',
      location_code: locationCode,
      asset_code: assetCode,
      asset_type_code: assetTypeCode,
      ...(next.meta || {}),
    }
    if (!trimText(inputs.meter_label) && trimText(inputs.stream_name)) {
      inputs.meter_label = trimText(inputs.stream_name)
    }
    if (Array.isArray(inputs.meters)) {
      inputs.meters = inputs.meters.filter(
        (meter) =>
          meter && (trimText(meter.opening_reading) !== '' || trimText(meter.closing_reading) !== '')
      )
    }
    return next
  }

  void layoutType
  return next
}

/**
 * Turn one mapped spreadsheet row into an Operation Entry payload.
 *
 * Returns `{ entry, payloadFieldCodes, extraPayloadPaths, unmatched }`:
 *  - `entry` is exactly what `createOperationEntry` expects,
 *  - `unmatched` lists record keys that do not map to a known column, so the
 *    dialog can tell the user which columns were ignored.
 */
export const buildOperationEntryFromRecord = ({
  record = {},
  template,
  layoutType,
  defaults = {},
  asset = null,
}) => {
  const valueByKey = (key) => trimText(record?.[key])
  const metadata = (key) => {
    const explicit = valueByKey(`metadata.${key}`)
    if (explicit !== '') return explicit
    return trimText(defaults?.[key])
  }

  const sender = metadata('senderLocationCode')
  const receiver = metadata('receiverLocationCode')

  const entry = {
    operationTypeCode: metadata('operationTypeCode') || trimText(template?.operationTypeCode),
    operationTemplateId: template?.id ? String(template.id) : '',
    primaryAssetCode: metadata('primaryAssetCode'),
    convoyNumber: metadata('convoyNumber'),
    // Clubbed pairs: one column writes both halves.
    originLocationCode: sender,
    senderLocationCode: sender,
    destinationLocationCode: receiver,
    receiverLocationCode: receiver,
    operationDate: '',
    operationStartDatetime: '',
    operationEndDatetime: '',
    productName: metadata('productName'),
    createdBy: metadata('createdBy'),
    remarks: metadata('remarks'),
    status: 'Draft',
    linkedTicketId: null,
    __assetName: asset?.assetName || '',
    __assetTypeCode: asset?.assetTypeCode || '',
    values: [],
  }

  const payloadCodes = []
  activeTemplateFields(template).forEach((field) => {
    if (isPayloadField(field)) {
      const payload = buildPayloadValue({ record, field, layoutType, entry })
      payloadCodes.push(field.fieldCode)
      entry.values.push({
        fieldCode: field.fieldCode,
        fieldName: field.fieldName,
        fieldGroup: field.fieldGroup,
        dataType: field.dataType,
        unit: field.unit || '',
        inputMode: field.inputMode,
        calculationRole: field.calculationRole,
        fieldValue: payload === null ? '' : payload,
        sortOrder: field.sortOrder,
      })
      return
    }

    entry.values.push({
      fieldCode: field.fieldCode,
      fieldName: field.fieldName,
      fieldGroup: field.fieldGroup,
      dataType: field.dataType,
      unit: field.unit || '',
      inputMode: field.inputMode,
      calculationRole: field.calculationRole,
      fieldValue: coerceValue(record?.[`field.${field.fieldCode}`], field.dataType),
      sortOrder: field.sortOrder,
    })
  })

  entry.operationDate = resolveOperationDate(entry)

  const knownKeys = new Set([
    ...METADATA_KEYS.map((key) => `metadata.${key}`),
    ...activeTemplateFields(template).map((field) => `field.${field.fieldCode}`),
    ...payloadCodes.flatMap((code) => [`payload.${code}`, `${code}.`]),
  ])

  const unmatched = Object.keys(record || {}).filter((key) => {
    if (key === '__rowNumber' || isBlank(record[key])) return false
    if (knownKeys.has(key)) return false
    if (PAYLOAD_FIELD_CODES.some((code) => key.startsWith(`payload.${code}.`))) return false
    if (PAYLOAD_FIELD_CODES.some((code) => key.startsWith(`${code}.`))) return false
    return true
  })

  return { entry, payloadFieldCodes: payloadCodes, unmatched }
}

/* --------------------------------------------------------------- validation */

const normaliseCode = (value) => trimText(value).toLowerCase()

const findOperationType = (operationTypes, code) =>
  (operationTypes || []).find(
    (item) => normaliseCode(item.operationTypeCode) === normaliseCode(code)
  )

const findLocation = (locations, code) =>
  (locations || []).find((item) => normaliseCode(item.locationCode) === normaliseCode(code))

const findAsset = (assets, code) =>
  (assets || []).find((item) => normaliseCode(item.assetCode) === normaliseCode(code))

const getPayloadValue = (entry, fieldCode) => {
  const row = (entry.values || []).find((value) => value.fieldCode === fieldCode)
  if (!row) return null
  return parseJsonCell(row.fieldValue)
}

const isYes = (value) => normaliseCode(value) === 'yes'

const formatList = (items, limit = 6) =>
  `${items.slice(0, limit).join(', ')}${items.length > limit ? ` (+${items.length - limit} more)` : ''}`

/** Required payload sections that mirror the on-screen layout rules. */
export const validatePayloadRequirements = ({ payload, layoutType, profile }) => {
  const missing = []
  if (!payload) return missing
  const inputs = payload.inputs || {}

  ;(profile?.requiredPaths || []).forEach(([path, label]) => {
    if (isBlank(getDeepValue(payload, path))) missing.push(label)
  })

  if (profile?.observedPathRule) {
    const observedType = normaliseCode(
      inputs.observedInputType ?? inputs.observed_input_type ?? inputs.obsMode
    )
    if (observedType.includes('api')) {
      if (isBlank(inputs.observedApi ?? inputs.observed_api)) missing.push('Observed API')
    } else if (observedType.includes('densit')) {
      if (isBlank(inputs.observedDensity ?? inputs.observed_density)) {
        missing.push('Observed Density')
      }
    } else {
      missing.push('Observed Input Type (Observed API or Observed Density)')
    }
  }

  if (profile?.multiTankRule) {
    const tankIds = Array.isArray(payload.meta?.tankIds)
      ? payload.meta.tankIds
      : String(payload.meta?.tankIds || '')
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
    if (tankIds.length === 0) missing.push('Tank IDs (meta.tankIds)')

    ;['before', 'after'].forEach((stage) => {
      const label = stage === 'before' ? 'Before' : 'After'
      const data = inputs[stage] || {}
      if (isBlank(data.tankTemp)) missing.push(`${label}: Tank Temp`)
      if (isBlank(data.sampleTemp)) missing.push(`${label}: Sample Temp`)
      if (isBlank(data.bswPct)) missing.push(`${label}: BS&W %`)

      const mode = normaliseCode(data.obsMode)
      if (mode.includes('api')) {
        if (isBlank(data.obsApi)) missing.push(`${label}: Observed API`)
      } else if (mode.includes('densit')) {
        if (isBlank(data.obsDensity)) missing.push(`${label}: Observed Density`)
      } else if (tankIds.length > 0) {
        missing.push(`${label}: Observed Input Type`)
      }

      tankIds.forEach((tankId) => {
        const dip = (data.dips || {})[tankId] || {}
        if (isBlank(dip.total)) missing.push(`${label}: ${tankId} Total Dip`)
        if (isBlank(dip.water)) missing.push(`${label}: ${tankId} Water Dip`)
      })
    })
  }

  if (profile?.flowmeterRule) {
    const meters = Array.isArray(inputs.meters) ? inputs.meters : []
    if (meters.length === 0 && isBlank(inputs.meter_label)) {
      missing.push('Meter Label (or at least one meter reading row)')
    }
    meters.forEach((meter, index) => {
      const label = trimText(meter.meter_label) || `Meter ${index + 1}`
      const opening = toNumberOrText(meter.opening_reading)
      const closing = toNumberOrText(meter.closing_reading)
      if (typeof opening !== 'number') missing.push(`${label}: Opening Reading`)
      if (typeof closing !== 'number') missing.push(`${label}: Closing Reading`)
      if (typeof opening === 'number' && typeof closing === 'number' && closing < opening) {
        missing.push(`${label}: Closing Reading is below Opening Reading`)
      }
    })
    const bsw = toNumberOrText(inputs.bsw_percent)
    if (typeof bsw === 'number' && (bsw < 0 || bsw > 100)) {
      missing.push('BS&W % must be between 0 and 100')
    }
    const observedType = normaliseCode(inputs.observed_input_type)
    if (observedType.includes('api')) {
      if (isBlank(inputs.observed_api)) missing.push('Observed API')
    } else if (observedType.includes('densit')) {
      if (isBlank(inputs.observed_density)) missing.push('Observed Density')
    } else {
      missing.push('Observed Input Type (Observed API or Observed Density)')
    }
  }

  void layoutType
  return missing
}

const requiresConvoy = (layoutType) => {
  const layout = normalizeLayoutType(layoutType)
  return (
    layout.includes('multi-tank') ||
    layout.includes('tanker') ||
    layout.includes('shuttle tracking')
  )
}

/**
 * Validate one mapped row and return the ready-to-create entry.
 *
 *   { rowNumber, status: 'success' | 'skipped', message, entry, warnings, signature }
 *
 * `context.seenShuttleNumbers` / `context.seenSignatures` are mutated so a file
 * that repeats a shuttle number or an identical ticket is rejected row by row.
 */
export const prepareOperationEntryImportRow = ({
  record,
  rowNumber,
  template,
  layoutType,
  operationType = null,
  operationTypes = [],
  locations = [],
  assets = [],
  existingEntries = [],
  defaults = {},
  seenShuttleNumbers = null,
  seenSignatures = null,
  allowedOperationTypeCodes = null,
}) => {
  const skip = (message) => ({
    rowNumber,
    status: 'skipped',
    message,
    entry: null,
    warnings: [],
  })

  if (!template) return skip('Select an Operation Template before importing.')

  // Asset is needed for the asset-type check and for the payload decoration.
  const assetCode = trimText(record?.['metadata.primaryAssetCode']) || trimText(defaults.primaryAssetCode)
  const asset = findAsset(assets, assetCode)

  const { entry, unmatched } = buildOperationEntryFromRecord({
    record,
    template,
    layoutType,
    defaults,
    asset,
  })
  const warnings = []
  if (unmatched.length > 0) {
    warnings.push(`Ignored column${unmatched.length === 1 ? '' : 's'}: ${formatList(unmatched)}`)
  }

  /* ------------------------------------------------------------- metadata */
  const opTypeCode = trimText(entry.operationTypeCode)
  if (!opTypeCode) return skip('Operation Type Code is required.')
  if (normaliseCode(template.operationTypeCode) !== normaliseCode(opTypeCode)) {
    return skip(
      `Operation Type ${opTypeCode} does not match the selected template (${template.operationTypeCode}).`
    )
  }

  const templateNameCell = trimText(record?.['metadata.operationTemplateName'])
  if (templateNameCell) {
    const wanted = [
      trimText(template.templateName),
      trimText(template.id),
      trimText(template.templateCode),
    ]
      .filter(Boolean)
      .map(normaliseCode)
    if (!wanted.includes(normaliseCode(templateNameCell))) {
      return skip(
        `Operation Template "${templateNameCell}" does not match the template selected for this upload (${template.templateName}).`
      )
    }
  }

  const resolvedOperationType =
    operationType || findOperationType(operationTypes, opTypeCode)
  if (!resolvedOperationType) return skip(`Operation Type ${opTypeCode} was not found.`)
  if (
    String(resolvedOperationType.status || '').trim().toLowerCase() !== 'active'
  ) {
    return skip(`Operation Type ${opTypeCode} is not Active.`)
  }
  if (
    allowedOperationTypeCodes &&
    !allowedOperationTypeCodes.has(normaliseCode(opTypeCode))
  ) {
    return skip(
      `Operation Type ${opTypeCode} is not enabled for your assigned location.`
    )
  }

  if (!assetCode) return skip('Primary Asset Code is required.')
  if (!asset) return skip(`Primary Asset ${assetCode} was not found.`)
  if (String(asset.status || '').trim().toLowerCase() !== 'active') {
    return skip(`Primary Asset ${assetCode} is not Active.`)
  }
  const applicableType = trimText(resolvedOperationType.applicableAssetTypeCode)
  if (
    applicableType &&
    normaliseCode(asset.assetTypeCode) !== normaliseCode(applicableType)
  ) {
    return skip(
      `Asset ${assetCode} is a ${asset.assetTypeCode} asset, but ${opTypeCode} needs ${applicableType}.`
    )
  }

  // A local asset pins the Sender to its own location, exactly like the form.
  const assetIsLocal = normaliseCode(asset.assetScope) === 'local'
  const assetLocation = trimText(asset.locationCode)
  if (assetIsLocal && assetLocation && !trimText(entry.senderLocationCode)) {
    entry.senderLocationCode = assetLocation
    entry.originLocationCode = assetLocation
  }

  const senderCode = trimText(entry.senderLocationCode)
  if (!senderCode) return skip('Sender Location Code is required.')
  const senderLocation = findLocation(locations, senderCode)
  if (!senderLocation) return skip(`Sender Location ${senderCode} was not found.`)
  if (String(senderLocation.status || '').trim().toLowerCase() !== 'active') {
    return skip(`Sender Location ${senderCode} is not Active.`)
  }
  if (assetIsLocal && assetLocation && normaliseCode(assetLocation) !== normaliseCode(senderCode)) {
    return skip(
      `Asset ${assetCode} belongs to ${assetLocation}; the Sender must be ${assetLocation}.`
    )
  }

  const receiverCode = trimText(entry.receiverLocationCode)
  if (receiverCode) {
    const receiverLocation = findLocation(locations, receiverCode)
    if (!receiverLocation) return skip(`Receiver Location ${receiverCode} was not found.`)
    if (String(receiverLocation.status || '').trim().toLowerCase() !== 'active') {
      return skip(`Receiver Location ${receiverCode} is not Active.`)
    }
  }

  const isShuttleLayout = normalizeLayoutType(layoutType).includes('shuttle tracking')
  if (
    !isShuttleLayout &&
    isYes(resolvedOperationType.requiresReceiverLocation) &&
    !receiverCode
  ) {
    return skip(`Receiver Location Code is required for ${opTypeCode}.`)
  }

  const convoy = trimText(entry.convoyNumber)
  if (requiresConvoy(layoutType) && !convoy) {
    const label = isShuttleLayout ? 'Shuttle Number' : 'Convoy Number'
    return skip(`${label} is required for this layout.`)
  }

  if (isShuttleLayout && convoy && seenShuttleNumbers) {
    const key = convoy.toLowerCase()
    if (seenShuttleNumbers.has(key)) {
      return skip(`Shuttle Number ${convoy} is repeated in this file.`)
    }
    const alreadyUsed = (existingEntries || []).some(
      (item) => trimText(item?.convoyNumber).toLowerCase() === key
    )
    if (alreadyUsed) {
      return skip(`Shuttle Number ${convoy} already exists on another ticket.`)
    }
    seenShuttleNumbers.add(key)
  }

  /* ------------------------------------------------------- template fields */
  const payloadFields = activeTemplateFields(template).filter((field) => isPayloadField(field))
  const missingFields = []
  activeTemplateFields(template).forEach((field) => {
    if (isPayloadField(field)) return
    if (!isYes(field.isRequired)) return
    if (normaliseCode(field.inputMode) !== 'manual') return
    const value = (entry.values || []).find((item) => item.fieldCode === field.fieldCode)
    if (isBlank(value?.fieldValue)) missingFields.push(field.fieldName)
  })
  if (missingFields.length > 0) {
    return skip(`Missing required template field${missingFields.length === 1 ? '' : 's'}: ${formatList(missingFields)}`)
  }

  /* --------------------------------------------------------------- payload */
  const profile = getPayloadProfile(layoutType)
  const requiredPayloadCode = profile?.fieldCode
  const payloadFieldCodes = payloadFields.map((field) => field.fieldCode)

  if (requiredPayloadCode && payloadFieldCodes.includes(requiredPayloadCode)) {
    const payload = getPayloadValue(entry, requiredPayloadCode)
    if (!payload) {
      return skip(
        `No ${profile.label} values found. Fill the payload columns (payload.${requiredPayloadCode}.*) or paste the payload JSON.`
      )
    }
    const missingPayload = validatePayloadRequirements({
      payload,
      layoutType,
      profile,
    })
    if (missingPayload.length > 0) {
      return skip(`Mandatory payload values missing: ${formatList(missingPayload, 8)}`)
    }
  }

  // Shuttle / FSO keep their date inside the payload (layout rule).
  if (requiredPayloadCode) {
    const payload = getPayloadValue(entry, requiredPayloadCode)
    if (payload && (profile?.netRule === 'shuttle' || profile?.netRule === 'fso')) {
      if (isBlank(payload.inputs?.operation_date)) {
        return skip('Operation Date is required inside the payload.')
      }
    }
  }

  /* ------------------------------------------------------ duplicate in file */
  const signature = JSON.stringify({
    opTypeCode: normaliseCode(opTypeCode),
    asset: normaliseCode(assetCode),
    conveyor: normaliseCode(convoy),
    sender: normaliseCode(senderCode),
    receiver: normaliseCode(receiverCode),
    values: (entry.values || []).map((value) => [
      value.fieldCode,
      typeof value.fieldValue === 'object'
        ? JSON.stringify(value.fieldValue)
        : trimText(value.fieldValue),
    ]),
  })
  if (seenSignatures) {
    if (seenSignatures.has(signature)) {
      return skip('Duplicate of an earlier row in this file (same metadata and values).')
    }
    seenSignatures.add(signature)
  }

  // Internal helper keys must never reach the API.
  delete entry.__assetName
  delete entry.__assetTypeCode

  return {
    rowNumber,
    status: 'success',
    message: 'Ready to import as a Draft ticket',
    entry,
    warnings,
    signature,
  }
}

/* ------------------------------------------- calculated tank-gauging payload */

/**
 * Rebuild the `calculated` block of a tank-gauging payload with the same engine
 * and calibration table the on-screen layout uses. Failures are warnings, never
 * import failures: the Draft ticket keeps the entered observations either way.
 */
export const enrichTankGaugingEntry = async ({
  entry,
  assetCalibrationTables = [],
  calibrationTemplates = [],
  lookupTable11 = lookupTable11Factor,
}) => {
  const row = (entry.values || []).find((value) => value.fieldCode === 'tank_gauging_payload')
  const payload = parseJsonCell(row?.fieldValue)
  if (!payload || typeof payload !== 'object') {
    return { entry, warnings: ['No tank gauging payload to calculate.'] }
  }

  const warnings = []
  const applyPayload = (nextPayload) => {
    const values = (entry.values || []).map((value) =>
      value.fieldCode === 'tank_gauging_payload'
        ? { ...value, fieldValue: nextPayload }
        : value
    )
    return { ...entry, values }
  }

  const activeTable = selectActiveCalibrationTable(
    assetCalibrationTables,
    entry.primaryAssetCode
  )
  if (!activeTable) {
    warnings.push(
      `No active calibration table for ${entry.primaryAssetCode}: quantities are completed when the ticket is opened.`
    )
    return { entry, warnings }
  }

  let rows = activeTable.rowsLoaded ? activeTable.rows || [] : []
  if (rows.length === 0) {
    try {
      rows = await loadCalibrationRows(activeTable.id)
    } catch (error) {
      warnings.push(
        `Calibration data could not be loaded (${error.message || 'unknown error'}): quantities are completed when the ticket is opened.`
      )
      return { entry, warnings }
    }
  }

  const calibrationTemplate = (calibrationTemplates || []).find(
    (template) => Number(template.id) === Number(activeTable.templateId)
  )
  const columns = getCalibrationColumnsByRole(calibrationTemplate)
  if (!columns.inputColumnName || !columns.outputColumnName) {
    warnings.push(
      'The calibration template has no input / output columns: quantities are completed when the ticket is opened.'
    )
    return { entry, warnings }
  }

  const inputs = payload.inputs || {}
  const maxDip = getCalibrationMaxInput(rows, columns.inputColumnName)
  const validation = validateTankGaugingInput({
    dipCm: inputs.dipCm,
    waterLevelCm: inputs.waterLevelCm,
    maxCalibrationDipCm: maxDip,
    tankTemperature: inputs.tankTemperature,
    tankTemperatureUnit: inputs.tankTemperatureUnit,
    observedInputType: inputs.observedInputType,
    observedApi: inputs.observedApi,
    observedDensity: inputs.observedDensity,
    sampleTemperature: inputs.sampleTemperature,
    sampleTemperatureUnit: inputs.sampleTemperatureUnit,
    bswPercent: inputs.bswPercent,
  })

  if (validation.errors.length > 0) {
    warnings.push(
      `Quantities not calculated: ${formatList(validation.errors, 4)}. Review the ticket and save it again.`
    )
    return { entry: applyPayload({ ...payload, validation }), warnings }
  }

  let calculated = null
  try {
    calculated = calculateTankQuantity({
      dipCm: inputs.dipCm,
      waterLevelCm: inputs.waterLevelCm,
      tankTemperature: inputs.tankTemperature,
      tankTemperatureUnit: inputs.tankTemperatureUnit,
      observedInputType: inputs.observedInputType,
      observedApi: inputs.observedApi,
      observedDensity: inputs.observedDensity,
      sampleTemperature: inputs.sampleTemperature,
      sampleTemperatureUnit: inputs.sampleTemperatureUnit,
      bswPercent: inputs.bswPercent,
      calibrationRows: rows,
      inputColumnName: columns.inputColumnName,
      outputColumnName: columns.outputColumnName,
    })
  } catch (error) {
    warnings.push(
      `Quantities not calculated (${error.message || 'calculation error'}): review the ticket and save it again.`
    )
    return { entry: applyPayload({ ...payload, validation }), warnings }
  }

  let table11 = null
  if (calculated?.api60 > 0) {
    try {
      table11 = await lookupTable11(calculated.api60)
    } catch {
      table11 = null
    }
  }

  const finalCalculated =
    table11?.ltFactor
      ? (() => {
          const lt = Math.round(Number(calculated.nsvBbl || 0) * Number(table11.ltFactor))
          return {
            ...calculated,
            ltFactor: Number(table11.ltFactor),
            lt,
            mt: Math.round(lt * LONG_TON_TO_METRIC_TON),
            table11LookupMethod: table11.lookupMethod || null,
            table11LowerApi60: table11.lowerApi60 ?? null,
            table11UpperApi60: table11.upperApi60 ?? null,
            massMethod: 'Table 11 factor lookup',
          }
        })()
      : {
          ...calculated,
          ltFactor: calculated?.ltFactor || null,
          table11LookupMethod: null,
          massMethod:
            calculated?.massMethod ||
            'Approximate density conversion - Table 11 unavailable',
        }

  return {
    entry: applyPayload({
      ...payload,
      layout_type: 'Tank Gauging',
      calculation_engine: 'Tank Quantity',
      calibration: {
        calibration_table_id: activeTable.id,
        calibration_name: activeTable.calibrationName,
        template_id: activeTable.templateId,
        template_name: activeTable.templateName,
        effective_date: activeTable.effectiveDate,
        input_column: columns.inputColumnName,
        output_column: columns.outputColumnName,
        max_dip_cm: maxDip,
      },
      inputs,
      calculated: finalCalculated,
      validation,
    }),
    warnings,
  }
}

/** Layouts whose calculated block this importer can complete on its own. */
export const canCalculateOnImport = (layoutType) =>
  normalizeLayoutType(layoutType).includes('tank gauging')

/** Human-readable description of what the importer does for a layout. */
export const describeImportBehaviour = (layoutType) => {
  const profile = getPayloadProfile(layoutType)
  if (!profile) {
    return 'This layout has no JSON payload: every value is written straight into its template field.'
  }
  return profile.note
}
