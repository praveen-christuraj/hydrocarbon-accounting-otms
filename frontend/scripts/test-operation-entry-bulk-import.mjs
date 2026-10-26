/*
 * Operation Entry bulk upload – contract test.
 *
 * Exercises the spreadsheet ⇄ ticket engine used by the Operation Entry Bulk
 * Upload dialog (utils/operationEntryBulkImport.js) without a browser:
 *
 *   npm run test:operation-entry-bulk
 *
 *  - the upload layout always carries every operation-entry metadata column,
 *  - payload fields are exposed as flat `payload.<field>.<path>` columns and
 *    assembled back into the JSON payload the layouts save,
 *  - a row is rejected before anything is written when the operation type, the
 *    asset, its asset type, a location, a required template field or a
 *    mandatory payload section is wrong,
 *  - duplicate rows / duplicate shuttle numbers are reported instead of
 *    silently creating two identical tickets,
 *  - tank gauging quantities are calculated from the active calibration table,
 *  - real .xlsx and .csv files go through parseImportFile + autoMapColumns and
 *    land in the same validated rows.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const nodeTimers = {
  setTimeout: globalThis.setTimeout,
  clearTimeout: globalThis.clearTimeout,
  setInterval: globalThis.setInterval,
  clearInterval: globalThis.clearInterval,
  setImmediate: globalThis.setImmediate,
  clearImmediate: globalThis.clearImmediate,
  queueMicrotask: globalThis.queueMicrotask,
}
GlobalRegistrator.register({ url: 'http://localhost:5173/', width: 1440, height: 900 })
Object.assign(globalThis, nodeTimers)

const { createServer } = await import('vite')
const viteServer = await createServer({
  configFile: path.join(frontendRoot, 'vite.config.js'),
  root: frontendRoot,
  logLevel: 'error',
  server: { middlewareMode: true, hmr: false, watch: null },
  appType: 'custom',
  optimizeDeps: { noDiscovery: true, include: [] },
  ssr: { external: ['react', 'react-dom', 'react-router-dom', 'react-router'] },
})

const bulk = await viteServer.ssrLoadModule('/src/utils/operationEntryBulkImport.js')
const { parseImportFile, autoMapColumns } = await viteServer.ssrLoadModule('/src/utils/importUtils.js')
const ExcelJS = (await import('exceljs')).default

let failures = 0
const check = (name, ok, extra = '') => {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  ${extra}` : ''}`)
}

/* ------------------------------------------------------------- fixtures */

const field = (overrides) => ({
  id: overrides.id,
  fieldCode: overrides.fieldCode,
  fieldName: overrides.fieldName || overrides.fieldCode,
  fieldGroup: overrides.fieldGroup || 'General',
  dataType: overrides.dataType || 'Text',
  unit: overrides.unit || '',
  isRequired: overrides.isRequired || 'No',
  inputMode: overrides.inputMode || 'Manual',
  calculationRole: overrides.calculationRole || 'Input',
  sortOrder: overrides.sortOrder || 1,
  status: overrides.status || 'Active',
})

const tankTemplate = {
  id: 11,
  templateName: 'Tank Gauging – Crude',
  operationTypeCode: 'TANK_GAUGING',
  entryLayoutType: 'Tank Gauging',
  calculationEngine: 'Tank Quantity',
  status: 'Active',
  fields: [
    field({ id: 1, fieldCode: 'tank_gauging_payload', fieldName: 'Tank Gauging', dataType: 'JSON', inputMode: 'System', sortOrder: 1 }),
    field({ id: 2, fieldCode: 'sample_reference', fieldName: 'Sample Reference', isRequired: 'Yes', sortOrder: 2 }),
    field({ id: 3, fieldCode: 'shift_code', fieldName: 'Shift Code', sortOrder: 3 }),
    field({ id: 4, fieldCode: 'inactive_field', fieldName: 'Inactive Field', status: 'Inactive' }),
  ],
}

const shuttleTemplate = {
  id: 12,
  templateName: 'Shuttle Tracking',
  operationTypeCode: 'SHUTTLE',
  entryLayoutType: 'Shuttle Tracking',
  status: 'Active',
  fields: [
    field({ id: 5, fieldCode: 'shuttle_payload', fieldName: 'Shuttle Payload', dataType: 'JSON', inputMode: 'System' }),
  ],
}

const multiTankTemplate = {
  id: 13,
  templateName: 'Multi-Tank Before/After',
  operationTypeCode: 'BARGE_DISCHARGE',
  entryLayoutType: 'Multi-Tank Before/After',
  status: 'Active',
  fields: [
    field({ id: 6, fieldCode: 'multi_tank_payload', fieldName: 'Multi Tank Payload', dataType: 'JSON', inputMode: 'System' }),
  ],
}

const flowmeterTemplate = {
  id: 14,
  templateName: 'Meter Reading',
  operationTypeCode: 'METER_READING',
  entryLayoutType: 'Meter Reading',
  status: 'Active',
  fields: [
    field({ id: 7, fieldCode: 'flowmeter_payload', fieldName: 'Flowmeter Payload', dataType: 'JSON', inputMode: 'System' }),
  ],
}

const operationTypes = [
  { operationTypeCode: 'TANK_GAUGING', operationTypeName: 'Tank Gauging', applicableAssetTypeCode: 'TANK', requiresReceiverLocation: 'No', status: 'Active' },
  { operationTypeCode: 'SHUTTLE', operationTypeName: 'Shuttle', applicableAssetTypeCode: 'VESSEL', requiresReceiverLocation: 'No', status: 'Active' },
  { operationTypeCode: 'BARGE_DISCHARGE', operationTypeName: 'Barge Discharge', applicableAssetTypeCode: 'BARGE', requiresReceiverLocation: 'Yes', status: 'Active' },
  { operationTypeCode: 'METER_READING', operationTypeName: 'Meter Reading', applicableAssetTypeCode: 'STREAM', requiresReceiverLocation: 'No', status: 'Active' },
]

const locations = [
  { id: 1, locationCode: 'UTP', locationName: 'Utapate', status: 'Active' },
  { id: 2, locationCode: 'BNY', locationName: 'Bonny', status: 'Active' },
  { id: 3, locationCode: 'OLD', locationName: 'Closed Terminal', status: 'Inactive' },
]

const assets = [
  { id: 1, assetCode: 'TK-101', assetName: 'Tank 101', assetTypeCode: 'TANK', assetScope: 'Local', locationCode: 'UTP', status: 'Active' },
  { id: 2, assetCode: 'BRG-001', assetName: 'Barge Ada', assetTypeCode: 'BARGE', assetScope: 'Global', status: 'Active' },
  { id: 3, assetCode: 'VES-001', assetName: 'MT Kainji', assetTypeCode: 'VESSEL', assetScope: 'Global', status: 'Active' },
  { id: 4, assetCode: 'MSKID-1', assetName: 'Metering Skid', assetTypeCode: 'STREAM', assetScope: 'Local', locationCode: 'UTP', status: 'Active' },
]

const tankRow = {
  'metadata.operationTypeCode': 'TANK_GAUGING',
  'metadata.operationTemplateName': 'Tank Gauging – Crude',
  'metadata.primaryAssetCode': 'TK-101',
  'metadata.senderLocationCode': 'UTP',
  'metadata.productName': 'Crude Oil',
  'metadata.remarks': 'Bulk import',
  'field.sample_reference': 'S-1001',
  'field.shift_code': 'A',
  'payload.tank_gauging_payload.inputs.gaugingDate': '2026-10-20',
  'payload.tank_gauging_payload.inputs.gaugingTime': '08:30',
  'payload.tank_gauging_payload.inputs.dipCm': '845',
  'payload.tank_gauging_payload.inputs.waterLevelCm': '1.2',
  'payload.tank_gauging_payload.inputs.tankTemperature': '38.2',
  'payload.tank_gauging_payload.inputs.sampleTemperature': '28.4',
  'payload.tank_gauging_payload.inputs.bswPercent': '0.5',
  'payload.tank_gauging_payload.inputs.observedInputType': 'Observed API',
  'payload.tank_gauging_payload.inputs.observedApi': '34.5',
  'unrelated_column': 'ignore me',
}

const prepare = (params) => {
  const seenShuttleNumbers = params.seenShuttleNumbers || new Set()
  const seenSignatures = params.seenSignatures || new Set()
  const result = bulk.prepareOperationEntryImportRow({
    operationTypes,
    locations,
    assets,
    existingEntries: [],
    defaults: {},
    seenShuttleNumbers,
    seenSignatures,
    ...params,
  })
  return { result, seenShuttleNumbers, seenSignatures }
}

/* ---------------------------------------------- 1. the upload template */

const tankFields = bulk.buildOperationEntryImportFields({
  template: tankTemplate,
  layoutType: 'Tank Gauging',
})

const metadataKeys = tankFields.filter((item) => item.kind === 'metadata').map((item) => item.key)
check(
  'upload layout carries every operation-entry metadata column',
  [
    'metadata.operationTypeCode',
    'metadata.operationTemplateName',
    'metadata.primaryAssetCode',
    'metadata.senderLocationCode',
    'metadata.receiverLocationCode',
    'metadata.convoyNumber',
    'metadata.productName',
    'metadata.createdBy',
    'metadata.remarks',
  ].every((key) => metadataKeys.includes(key)),
  metadataKeys.join(', ')
)
check(
  'inactive template fields are not offered as columns',
  !tankFields.some((item) => item.key === 'field.inactive_field')
)
check(
  'required template field is marked required',
  tankFields.find((item) => item.key === 'field.sample_reference')?.required === true
)
check(
  'tank gauging payload is exposed as payload path columns',
  ['inputs.dipCm', 'inputs.gaugingDate', 'inputs.observedApi'].every((suffix) =>
    tankFields.some((item) => item.key === `payload.tank_gauging_payload.${suffix}`)
  ),
  `${tankFields.filter((item) => item.kind === 'payload').length} payload columns`
)
check(
  'the whole payload JSON is also accepted as one column',
  tankFields.some((item) => item.key === 'payload.tank_gauging_payload')
)
check(
  'layout note explains what the importer calculates',
  bulk.describeImportBehaviour('Tank Gauging').toLowerCase().includes('calculated')
)
check('only tank gauging reports calculated-on-import', bulk.canCalculateOnImport('Tank Gauging') === true && bulk.canCalculateOnImport('FSO Tracking') === false)

/* -------------------------------------------- 2. row → entry assembly */

const assembled = bulk.buildOperationEntryFromRecord({
  record: tankRow,
  template: tankTemplate,
  layoutType: 'Tank Gauging',
  asset: assets[0],
})
const assembledPayload = assembled.entry.values.find((item) => item.fieldCode === 'tank_gauging_payload').fieldValue

check('operation type / template / asset are read from the row', assembled.entry.operationTypeCode === 'TANK_GAUGING' && assembled.entry.operationTemplateId === '11' && assembled.entry.primaryAssetCode === 'TK-101')
check('sender writes both halves of the clubbed pair', assembled.entry.originLocationCode === 'UTP' && assembled.entry.senderLocationCode === 'UTP')
check('empty receiver leaves both destination columns blank', assembled.entry.destinationLocationCode === '' && assembled.entry.receiverLocationCode === '')
check('payload values are nested at their path', Number(assembledPayload.inputs.dipCm) === 845 && assembledPayload.inputs.gaugingTime === '08:30', JSON.stringify(assembledPayload.inputs).slice(0, 120))
check('payload keeps the layout markers the form writes', assembledPayload.layout_type === 'Tank Gauging' && assembledPayload.calculation_engine === 'Tank Quantity')
check('numbers arrive as numbers, not text', typeof assembledPayload.inputs.dipCm === 'number' && typeof assembledPayload.inputs.observedApi === 'number')
check('ticket date is resolved from the gauging date in the payload', assembled.entry.operationDate === '2026-10-20', assembled.entry.operationDate)
check('plain template fields are written as values', assembled.entry.values.find((item) => item.fieldCode === 'sample_reference').fieldValue === 'S-1001')
check('unmapped columns are reported, not silently dropped', assembled.unmatched.includes('unrelated_column'), assembled.unmatched.join(','))

const jsonCell = bulk.buildOperationEntryFromRecord({
  record: { ...tankRow, 'payload.tank_gauging_payload': JSON.stringify({ inputs: { dipCm: 100, waterLevelCm: 0, observedInputType: 'Observed API', observedApi: 33 }, notes: 'from json' }) },
  template: tankTemplate,
  layoutType: 'Tank Gauging',
})
const mergedPayload = jsonCell.entry.values.find((item) => item.fieldCode === 'tank_gauging_payload').fieldValue
check(
  'a raw JSON column and path columns merge (paths win)',
  mergedPayload.notes === 'from json' && Number(mergedPayload.inputs.dipCm) === 845,
  JSON.stringify(mergedPayload.inputs).slice(0, 100)
)

/* ------------------------------------------------- 3. row validation */

const ok = prepare({ record: tankRow, rowNumber: 2, template: tankTemplate, layoutType: 'Tank Gauging' })
check('a complete row prepares a Draft ticket', ok.result.status === 'success', ok.result.message)
check('the prepared ticket is a Draft', ok.result.entry.status === 'Draft')
check('asset name / internal helper keys never reach the API', !('__assetName' in ok.result.entry), Object.keys(ok.result.entry).join(','))

const missingDip = prepare({
  record: { ...tankRow, 'payload.tank_gauging_payload.inputs.dipCm': '' },
  rowNumber: 3,
  template: tankTemplate,
  layoutType: 'Tank Gauging',
})
check('a missing dip is rejected before the API is called', missingDip.result.status === 'skipped' && missingDip.result.message.includes('Dip'), missingDip.result.message)

const densityMode = prepare({
  record: {
    ...tankRow,
    'payload.tank_gauging_payload.inputs.observedInputType': 'Observed Density',
    'payload.tank_gauging_payload.inputs.observedApi': '',
    'payload.tank_gauging_payload.inputs.observedDensity': '',
  },
  rowNumber: 4,
  template: tankTemplate,
  layoutType: 'Tank Gauging',
})
check('observed density mode needs a density', densityMode.result.status === 'skipped' && densityMode.result.message.includes('Observed Density'), densityMode.result.message.slice(0, 120))

const wrongType = prepare({ record: { ...tankRow, 'metadata.operationTypeCode': 'SHUTTLE' }, rowNumber: 5, template: tankTemplate, layoutType: 'Tank Gauging' })
check('a row for another operation type is rejected', wrongType.result.status === 'skipped' && wrongType.result.message.includes('does not match'), wrongType.result.message)

const wrongTemplate = prepare({ record: { ...tankRow, 'metadata.operationTemplateName': 'Something else' }, rowNumber: 6, template: tankTemplate, layoutType: 'Tank Gauging' })
check('a row for another template is rejected', wrongTemplate.result.status === 'skipped' && wrongTemplate.result.message.includes('does not match'), wrongTemplate.result.message)

const wrongAssetType = prepare({ record: { ...tankRow, 'metadata.primaryAssetCode': 'BRG-001' }, rowNumber: 7, template: tankTemplate, layoutType: 'Tank Gauging' })
check('an asset of the wrong asset type is rejected', wrongAssetType.result.status === 'skipped' && wrongAssetType.result.message.includes('needs TANK'), wrongAssetType.result.message)

const unknownAsset = prepare({ record: { ...tankRow, 'metadata.primaryAssetCode': 'NOPE' }, rowNumber: 8, template: tankTemplate, layoutType: 'Tank Gauging' })
check('an unknown asset is rejected', unknownAsset.result.status === 'skipped' && unknownAsset.result.message.includes('was not found'), unknownAsset.result.message)

const inactiveLocation = prepare({ record: { ...tankRow, 'metadata.senderLocationCode': 'OLD' }, rowNumber: 9, template: tankTemplate, layoutType: 'Tank Gauging' })
check('an inactive sender location is rejected', inactiveLocation.result.status === 'skipped' && inactiveLocation.result.message.includes('not Active'), inactiveLocation.result.message)

const localAssetElsewhere = prepare({ record: { ...tankRow, 'metadata.senderLocationCode': 'BNY' }, rowNumber: 10, template: tankTemplate, layoutType: 'Tank Gauging' })
check('a local asset pins the sender to its own location', localAssetElsewhere.result.status === 'skipped' && localAssetElsewhere.result.message.includes('must be UTP'), localAssetElsewhere.result.message)

const missingTemplateField = prepare({ record: { ...tankRow, 'field.sample_reference': '' }, rowNumber: 11, template: tankTemplate, layoutType: 'Tank Gauging' })
check('a required template field is enforced', missingTemplateField.result.status === 'skipped' && missingTemplateField.result.message.includes('Sample Reference'), missingTemplateField.result.message)

const noPayload = prepare({
  record: Object.fromEntries(Object.entries(tankRow).filter(([key]) => !key.startsWith('payload.'))),
  rowNumber: 12,
  template: tankTemplate,
  layoutType: 'Tank Gauging',
})
check('a row without payload values is rejected', noPayload.result.status === 'skipped' && noPayload.result.message.includes('No Tank Gauging Payload values'), noPayload.result.message)

const restricted = prepare({
  record: tankRow,
  rowNumber: 13,
  template: tankTemplate,
  layoutType: 'Tank Gauging',
  allowedOperationTypeCodes: new Set(['other']),
})
check('operation types outside the user scope are rejected', restricted.result.status === 'skipped' && restricted.result.message.includes('not enabled'), restricted.result.message)

/* --------------------------------------------------- 4. duplicate rows */

const seenSignatures = new Set()
const firstDup = prepare({ record: tankRow, rowNumber: 14, template: tankTemplate, layoutType: 'Tank Gauging', seenSignatures })
const secondDup = prepare({ record: tankRow, rowNumber: 15, template: tankTemplate, layoutType: 'Tank Gauging', seenSignatures })
check('the first of two identical rows is accepted', firstDup.result.status === 'success')
check('the repeated identical row is reported as a duplicate', secondDup.result.status === 'skipped' && secondDup.result.message.includes('Duplicate'), secondDup.result.message)

/* ------------------------------------------- 5. shuttle number rules */

const shuttleRecord = {
  'metadata.operationTypeCode': 'SHUTTLE',
  'metadata.primaryAssetCode': 'VES-001',
  'metadata.senderLocationCode': 'UTP',
  'metadata.convoyNumber': 'SH-2026-001',
  'payload.shuttle_payload.inputs.operation_date': '2026-10-20',
  'payload.shuttle_payload.inputs.opening_stock_bbl': '120000',
  'payload.shuttle_payload.inputs.opening_water_bbl': '150',
  'payload.shuttle_payload.inputs.closing_stock_bbl': '118500',
  'payload.shuttle_payload.inputs.closing_water_bbl': '140',
}

const shuttleSeen = new Set()
const shuttleFirst = prepare({ record: shuttleRecord, rowNumber: 2, template: shuttleTemplate, layoutType: 'Shuttle Tracking', seenShuttleNumbers: shuttleSeen })
check('a shuttle row prepares', shuttleFirst.result.status === 'success', shuttleFirst.result.message)
const shuttlePayload = shuttleFirst.result.entry.values[0].fieldValue
check('shuttle net stock / net water are calculated', shuttlePayload.calculated?.net?.net_stock_bbl === -1500 && shuttlePayload.calculated?.net?.net_water_bbl === -10, JSON.stringify(shuttlePayload.calculated))
check('shuttle payload mirrors the convoy / asset for reporting', shuttlePayload.meta.shuttle_number === 'SH-2026-001' && shuttlePayload.meta.shuttle_asset_code === 'VES-001')

const shuttleRepeat = prepare({ record: shuttleRecord, rowNumber: 3, template: shuttleTemplate, layoutType: 'Shuttle Tracking', seenShuttleNumbers: shuttleSeen })
check('a repeated shuttle number inside the file is rejected', shuttleRepeat.result.status === 'skipped' && shuttleRepeat.result.message.includes('repeated'), shuttleRepeat.result.message)

const shuttleExisting = prepare({
  record: shuttleRecord,
  rowNumber: 4,
  template: shuttleTemplate,
  layoutType: 'Shuttle Tracking',
  existingEntries: [{ id: 99, convoyNumber: 'SH-2026-001', status: 'Draft' }],
})
check('a shuttle number already on another ticket is rejected', shuttleExisting.result.status === 'skipped' && shuttleExisting.result.message.includes('already exists'), shuttleExisting.result.message)

const shuttleNoDate = prepare({ record: { ...shuttleRecord, 'payload.shuttle_payload.inputs.operation_date': '' }, rowNumber: 5, template: shuttleTemplate, layoutType: 'Shuttle Tracking' })
check('the shuttle payload date is mandatory', shuttleNoDate.result.status === 'skipped' && shuttleNoDate.result.message.includes('Operation Date'), shuttleNoDate.result.message)

const shuttleNoConvoy = prepare({ record: { ...shuttleRecord, 'metadata.convoyNumber': '' }, rowNumber: 6, template: shuttleTemplate, layoutType: 'Shuttle Tracking' })
check('the shuttle number is mandatory', shuttleNoConvoy.result.status === 'skipped' && shuttleNoConvoy.result.message.includes('Shuttle Number'), shuttleNoConvoy.result.message)

/* --------------------------------- 6. dynamic multi-tank dip columns */

const multiTankRecord = {
  'metadata.operationTypeCode': 'BARGE_DISCHARGE',
  'metadata.primaryAssetCode': 'BRG-001',
  'metadata.senderLocationCode': 'UTP',
  'metadata.receiverLocationCode': 'BNY',
  'metadata.convoyNumber': 'CNV-2026-007',
  'payload.multi_tank_payload.meta.tankIds': 'C1,C2',
  'payload.multi_tank_payload.inputs.before.tankTemp': '38',
  'payload.multi_tank_payload.inputs.before.sampleTemp': '28',
  'payload.multi_tank_payload.inputs.before.bswPct': '0.4',
  'payload.multi_tank_payload.inputs.before.obsMode': 'Observed API',
  'payload.multi_tank_payload.inputs.before.obsApi': '34.5',
  'payload.multi_tank_payload.inputs.before.dips.C1.total': '120',
  'payload.multi_tank_payload.inputs.before.dips.C1.water': '0',
  'payload.multi_tank_payload.inputs.before.dips.C2.total': '110',
  'payload.multi_tank_payload.inputs.before.dips.C2.water': '0',
  'payload.multi_tank_payload.inputs.after.tankTemp': '39',
  'payload.multi_tank_payload.inputs.after.sampleTemp': '29',
  'payload.multi_tank_payload.inputs.after.bswPct': '0.5',
  'payload.multi_tank_payload.inputs.after.obsMode': 'Observed API',
  'payload.multi_tank_payload.inputs.after.obsApi': '34.6',
  'payload.multi_tank_payload.inputs.after.dips.C1.total': '150',
  'payload.multi_tank_payload.inputs.after.dips.C1.water': '0',
  'payload.multi_tank_payload.inputs.after.dips.C2.total': '140',
  'payload.multi_tank_payload.inputs.after.dips.C2.water': '0',
}

const multiTankFields = bulk.buildOperationEntryImportFields({ template: multiTankTemplate, layoutType: 'Multi-Tank Before/After' })
check(
  'multi-tank upload layout includes its static input columns',
  multiTankFields.some((item) => item.key === 'payload.multi_tank_payload.inputs.before.tankTemp')
)

const multiPrepared = prepare({ record: multiTankRecord, rowNumber: 2, template: multiTankTemplate, layoutType: 'Multi-Tank Before/After' })
check('multi-tank row with per-tank dip columns prepares', multiPrepared.result.status === 'success', multiPrepared.result.message)
const multiPayload = multiPrepared.result.entry.values[0].fieldValue
check('tank ids become an array', Array.isArray(multiPayload.meta.tankIds) && multiPayload.meta.tankIds.join(',') === 'C1,C2')
check('per-tank dips are nested by tank id', Number(multiPayload.inputs.before.dips.C1.total) === 120 && Number(multiPayload.inputs.after.dips.C2.water) === 0)

const multiMissingTank = prepare({
  record: { ...multiTankRecord, 'payload.multi_tank_payload.inputs.after.dips.C2.total': '' },
  rowNumber: 3,
  template: multiTankTemplate,
  layoutType: 'Multi-Tank Before/After',
})
check('a missing per-tank dip is rejected', multiMissingTank.result.status === 'skipped' && multiMissingTank.result.message.includes('C2 Total Dip'), multiMissingTank.result.message.slice(0, 160))

/* ------------------------------------ 7. flowmeter meter array indices */

const flowmeterRecord = {
  'metadata.operationTypeCode': 'METER_READING',
  'metadata.primaryAssetCode': 'MSKID-1',
  'metadata.senderLocationCode': 'UTP',
  'payload.flowmeter_payload.inputs.reading_date': '2026-10-20',
  'payload.flowmeter_payload.inputs.stream_name': 'Export Line 1',
  'payload.flowmeter_payload.inputs.meters.0.opening_reading': '1000',
  'payload.flowmeter_payload.inputs.meters.0.closing_reading': '1200',
  'payload.flowmeter_payload.inputs.meters.1.opening_reading': '500',
  'payload.flowmeter_payload.inputs.meters.1.closing_reading': '650',
  'payload.flowmeter_payload.inputs.tank_temperature': '38',
  'payload.flowmeter_payload.inputs.sample_temperature': '28',
  'payload.flowmeter_payload.inputs.bsw_percent': '0.5',
  'payload.flowmeter_payload.inputs.observed_input_type': 'Observed API',
  'payload.flowmeter_payload.inputs.observed_api': '34.5',
}

const flowPrepared = prepare({ record: flowmeterRecord, rowNumber: 2, template: flowmeterTemplate, layoutType: 'Meter Reading' })
check('flowmeter row prepares', flowPrepared.result.status === 'success', flowPrepared.result.message)
const flowPayload = flowPrepared.result.entry.values[0].fieldValue
check('indexed meter columns build the meters array', Array.isArray(flowPayload.inputs.meters) && flowPayload.inputs.meters.length === 2 && Number(flowPayload.inputs.meters[1].closing_reading) === 650)
check('flowmeter meter label follows the stream name', flowPayload.inputs.meter_label === 'Export Line 1')

const flowBadMeter = prepare({ record: { ...flowmeterRecord, 'payload.flowmeter_payload.inputs.meters.0.closing_reading': '900' }, rowNumber: 3, template: flowmeterTemplate, layoutType: 'Meter Reading' })
check('a closing reading below the opening reading is rejected', flowBadMeter.result.status === 'skipped' && flowBadMeter.result.message.includes('below Opening'), flowBadMeter.result.message.slice(0, 140))

/* -------------------------------- 8. calculated tank gauging quantities */

const calibrationTemplates = [
  {
    id: 1,
    templateName: 'Tank Strapping',
    columns: [
      { columnName: 'Ullage', interpolationRole: 'Input X' },
      { columnName: 'Volume', interpolationRole: 'Output' },
    ],
  },
]
const assetCalibrationTables = [
  {
    id: 5,
    assetCode: 'TK-101',
    calibrationName: 'TK-101 Strapping 2026',
    templateId: 1,
    templateName: 'Tank Strapping',
    effectiveDate: '2026-01-01',
    status: 'Active',
    rowsLoaded: true,
    rows: [
      { rowData: { Ullage: 0, Volume: 0 } },
      { rowData: { Ullage: 1000, Volume: 850 } },
      { rowData: { Ullage: 2000, Volume: 1720 } },
    ],
  },
]

const enriched = await bulk.enrichTankGaugingEntry({
  entry: ok.result.entry,
  assetCalibrationTables,
  calibrationTemplates,
  lookupTable11: async () => ({ ltFactor: 0.9759, lookupMethod: 'Interpolated', lowerApi60: 34, upperApi60: 35 }),
})
const enrichedPayload = enriched.entry.values.find((item) => item.fieldCode === 'tank_gauging_payload').fieldValue
check('calibration table is recorded on the payload', enrichedPayload.calibration?.calibration_table_id === 5, JSON.stringify(enrichedPayload.calibration || {}))
check('tank quantities are calculated during the import', Number(enrichedPayload.calculated?.nsvBbl) > 0 && Number(enrichedPayload.calculated?.gsvBbl) > 0, `NSV ${enrichedPayload.calculated?.nsvBbl}`)
check('Table 11 converts NSV to LT / MT', Number(enrichedPayload.calculated?.lt) > 0 && Number(enrichedPayload.calculated?.mt) > 0, `LT ${enrichedPayload.calculated?.lt}`)
check('no warning when the calculation succeeds', enriched.warnings.length === 0, enriched.warnings.join(' · '))

const noCalibration = await bulk.enrichTankGaugingEntry({
  entry: ok.result.entry,
  assetCalibrationTables: [],
  calibrationTemplates,
  lookupTable11: async () => null,
})
check(
  'a missing calibration table is a warning, not a failure',
  noCalibration.warnings.some((warning) => warning.includes('No active calibration table'))
)

/* --------------------------- 9. real xlsx / csv through the same pipeline */

const buildXlsx = async (rows) => {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Tickets')
  rows.forEach((row) => sheet.addRow(row))
  return Buffer.from(await workbook.xlsx.writeBuffer())
}

const headers = [
  'Operation Type Code',
  'Operation Template',
  'Primary Asset Code',
  'Sender Location Code',
  'Sample Reference',
  'Gauging Date',
  'Gauging Time',
  'Payload Dip',
  'Water Level',
  'Tank Temperature',
  'Sample Temperature',
  'BS&W %',
  'Observed Input Type',
  'Observed API',
]
const fieldByHeader = {
  'Operation Type Code': 'metadata.operationTypeCode',
  'Operation Template': 'metadata.operationTemplateName',
  'Primary Asset Code': 'metadata.primaryAssetCode',
  'Sender Location Code': 'metadata.senderLocationCode',
  'Sample Reference': 'field.sample_reference',
  'Gauging Date': 'payload.tank_gauging_payload.inputs.gaugingDate',
  'Gauging Time': 'payload.tank_gauging_payload.inputs.gaugingTime',
  'Payload Dip': 'payload.tank_gauging_payload.inputs.dipCm',
  'Water Level': 'payload.tank_gauging_payload.inputs.waterLevelCm',
  'Tank Temperature': 'payload.tank_gauging_payload.inputs.tankTemperature',
  'Sample Temperature': 'payload.tank_gauging_payload.inputs.sampleTemperature',
  'BS&W %': 'payload.tank_gauging_payload.inputs.bswPercent',
  'Observed Input Type': 'payload.tank_gauging_payload.inputs.observedInputType',
  'Observed API': 'payload.tank_gauging_payload.inputs.observedApi',
}

const completeRow = (overrides = {}) => {
  const base = {
    'Operation Type Code': 'TANK_GAUGING',
    'Operation Template': 'Tank Gauging – Crude',
    'Primary Asset Code': 'TK-101',
    'Sender Location Code': 'UTP',
    'Sample Reference': 'S-2001',
    'Gauging Date': '2026-10-20',
    'Gauging Time': '08:30',
    'Payload Dip': 700,
    'Water Level': 1,
    'Tank Temperature': 38,
    'Sample Temperature': 28,
    'BS&W %': 0.5,
    'Observed Input Type': 'Observed API',
    'Observed API': 34.5,
  }
  return { ...base, ...overrides }
}

const xlsxBuffer = await buildXlsx([
  headers,
  headers.map((header) => completeRow()[header]),
  headers.map((header) => completeRow({ 'Sample Reference': 'S-2002', 'Payload Dip': '' })[header]),
])
const parsedXlsx = await parseImportFile(new File([xlsxBuffer], 'tickets.xlsx'))
check('xlsx: both tickets are read', parsedXlsx.rows.length === 2, `${parsedXlsx.rows.length} rows`)
check('xlsx: numeric cells survive', Number(parsedXlsx.rows[0]['Payload Dip']) === 700)

const autoMapping = autoMapColumns(parsedXlsx.headers, tankFields)
check(
  'xlsx: every human heading auto-maps onto the upload layout',
  Object.keys(fieldByHeader).every((header) => autoMapping[fieldByHeader[header]] === header),
  Object.entries(autoMapping).length + ' mapped'
)

const mappedRecord = (row) =>
  Object.fromEntries(
    Object.entries(fieldByHeader)
      .filter(([header]) => row[header] !== undefined)
      .map(([header, key]) => [key, row[header]])
  )

const xlsxPrepared = parsedXlsx.rows.map((row, index) =>
  prepare({
    record: mappedRecord(row),
    rowNumber: index + 2,
    template: tankTemplate,
    layoutType: 'Tank Gauging',
  }).result
)
check('xlsx: the complete row prepares', xlsxPrepared[0].status === 'success', xlsxPrepared[0].message)
check(
  'xlsx: the row missing its dip is reported with its own row number',
  xlsxPrepared[1].status === 'skipped' && xlsxPrepared[1].rowNumber === 3 && xlsxPrepared[1].message.includes('Dip'),
  xlsxPrepared[1].message
)

const csvText =
  headers.join(',') +
  '\r\n' +
  headers
    .map((header) => {
      const value = completeRow({ 'Payload Dip': '1,250' })[header]
      return typeof value === 'string' && value.includes(',') ? `"${value}"` : value
    })
    .join(',') +
  '\r\n'
const parsedCsv = await parseImportFile(new File([Buffer.from(csvText)], 'tickets.csv', { type: 'text/csv' }))
check('csv: row read', parsedCsv.rows.length === 1)
check('csv: quoted thousands separator parsed', parsedCsv.rows[0]['Payload Dip'] === '1,250', parsedCsv.rows[0]['Payload Dip'])
const csvPrepared = prepare({
  record: mappedRecord(parsedCsv.rows[0]),
  rowNumber: 2,
  template: tankTemplate,
  layoutType: 'Tank Gauging',
}).result
check(
  'csv: thousands separators are converted to a number',
  csvPrepared.status === 'success' &&
    Number(csvPrepared.entry.values.find((item) => item.fieldCode === 'tank_gauging_payload').fieldValue.inputs.dipCm) === 1250,
  csvPrepared.message
)

/* ------------------------------------------------------------- summary */

await viteServer.close()
console.log(`\n${failures === 0 ? 'All checks passed' : `${failures} check(s) failed`}`)
process.exit(failures === 0 ? 0 : 1)
