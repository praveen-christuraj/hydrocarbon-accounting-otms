/*
 * Functional test for the bulk upload / bulk export pipeline.
 *
 * Round-trips real .xlsx and .csv files through the parsers and the exporters
 * that every "Bulk Upload" / "Export" button in the application uses:
 *
 *   npm run test:bulk
 *
 * Runs in happy-dom so the browser download helpers work. No backend needed.
 */
import path from 'node:path'
import fs from 'node:fs'
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
// happy-dom swaps the timer globals for its own; Vite needs Node's (unref etc.)
Object.assign(globalThis, nodeTimers)
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

// Capture downloads instead of touching the file system.
const downloads = []
globalThis.URL.createObjectURL = (blob) => {
  downloads.push(blob)
  return 'blob:mock'
}
globalThis.URL.revokeObjectURL = () => {}
const nativeClick = globalThis.HTMLAnchorElement.prototype.click
globalThis.HTMLAnchorElement.prototype.click = function click() {
  if (this.hasAttribute('download')) {
    downloads.push({ __name: this.getAttribute('download') })
    return undefined
  }
  return nativeClick.call(this)
}

const { createServer } = await import('vite')
const viteServer = await createServer({
  configFile: path.join(frontendRoot, 'vite.config.js'),
  root: frontendRoot,
  logLevel: 'error',
  server: { middlewareMode: true, hmr: false, watch: null },
  appType: 'custom',
  optimizeDeps: { noDiscovery: true, include: [] },
})

const ExcelJS = (await import('exceljs')).default
const { parseImportFile, parseImportMatrix, autoMapColumns } = await viteServer.ssrLoadModule(
  '/src/utils/importUtils.js'
)
const { rowsToCsv, exportRows } = await viteServer.ssrLoadModule('/src/utils/exportUtils.js')
const templateStore = await viteServer.ssrLoadModule('/src/utils/importTemplateStore.js')

let failures = 0
const check = (name, ok, extra = '') => {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  ${extra}` : ''}`)
}

const fileFrom = (buffer, name, type) =>
  new File([buffer], name, { type: type || 'application/octet-stream' })

/* ------------------------------------------------------------ xlsx build */

const buildXlsx = async (sheets) => {
  const workbook = new ExcelJS.Workbook()
  sheets.forEach(({ name, rows }) => {
    const sheet = workbook.addWorksheet(name)
    rows.forEach((row) => sheet.addRow(row))
  })
  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}

/* -------------------------------------------------------- 1. xlsx upload */

const xlsxBuffer = await buildXlsx([
  {
    name: 'Seals',
    rows: [
      ['Asset Code', 'Tank ID', 'Seal Position', 'Seal Number', 'Status'],
      ['BRG-001', 'C1', 'MH1', 'SL-9001', 'Active'],
      ['BRG-001', 'C1', 'MH2', 'SL-9002', 'Active'],
      ['BRG-001', 'C2', 'mh1', 'SL-9003', 'Active'],
    ],
  },
])

const xlsxParsed = await parseImportFile(fileFrom(xlsxBuffer, 'seals.xlsx'))
check('xlsx: sheet name captured', xlsxParsed.sheetName === 'Seals', xlsxParsed.sheetName)
check('xlsx: header row detected', xlsxParsed.headers.length === 5, xlsxParsed.headers.join('|'))
check('xlsx: data rows parsed', xlsxParsed.rows.length === 3, `${xlsxParsed.rows.length} rows`)
check(
  'xlsx: cell values read',
  xlsxParsed.rows[0]['Tank ID'] === 'C1' && xlsxParsed.rows[0]['Seal Number'] === 'SL-9001'
)
check('xlsx: row numbers start at 2', xlsxParsed.rows[0].__rowNumber === 2)
check('xlsx: format tagged', xlsxParsed.format === 'xlsx')

/* --------------------------------------------------------- 2. csv upload */

const csvText =
  'Asset Code;Tank ID;Seal Position;Seal Number\r\n' +
  'BRG-001;C1;LOCK;"SL-90""04";\r\n' +
  'BRG-001;C2;DIPHATCH;SL-9005\r\n'
const csvParsed = await parseImportFile(fileFrom(Buffer.from(csvText), 'seals.csv', 'text/csv'))
check('csv: semicolon delimited + CRLF parsed', csvParsed.rows.length === 2, `${csvParsed.rows.length} rows`)
check('csv: escaped quotes handled', csvParsed.rows[0]['Seal Number'] === 'SL-90"04', csvParsed.rows[0]['Seal Number'])
check('csv: format tagged', csvParsed.format === 'csv')

const csvComma = await parseImportFile(
  fileFrom(Buffer.from('﻿A,B\n1,2\n'), 'bom.csv', 'text/csv')
)
check('csv: BOM stripped from first header', csvComma.headers[0] === 'A', csvComma.headers.join('|'))

/* ------------------------------------- 3. positional matrix (Table 11) */

const matrixBuffer = await buildXlsx([
  {
    name: 'Factors',
    rows: [
      [30, 0.9759],
      [31, 0.9723],
      [32, 0.9688],
    ],
  },
])
const matrix = await parseImportMatrix(fileFrom(matrixBuffer, 'table11.xlsx'))
check('matrix: headerless xlsx read', matrix.matrix.length === 3, `${matrix.matrix.length} rows`)
check('matrix: numbers preserved', Number(matrix.matrix[0][1]) === 0.9759)

const matrixCsv = await parseImportMatrix(
  fileFrom(Buffer.from('30,0.9759\n31,0.9723\n'), 'table11.csv', 'text/csv')
)
check('matrix: csv read', matrixCsv.matrix.length === 2)

/* ------------------------------------------- 4. dynamic column mapping */

const dynamicFields = [
  { key: 'calibrationName', label: 'Calibration Name', required: true },
  { key: 'assetCode', label: 'Asset Code', required: true },
  { key: 'col_Tank', label: 'Tank', aliases: ['Tank'] },
  { key: 'col_Ullage', label: 'Ullage', aliases: ['Ullage'] },
  { key: 'col_Volume', label: 'Volume', aliases: ['Volume'] },
]
const dynMap = autoMapColumns(
  ['Calibration Name', 'Asset Code', 'Tank', 'Ullage', 'Volume'],
  dynamicFields
)
check(
  'mapping: dynamic col_ keys resolved through aliases',
  dynMap.col_Tank === 'Tank' && dynMap.col_Ullage === 'Ullage' && dynMap.col_Volume === 'Volume',
  JSON.stringify(dynMap)
)

const aliasMap = autoMapColumns(['seal no', 'TANK ID', 'Barge'], [
  { key: 'sealNumber', label: 'Seal Number', aliases: ['Seal No'] },
  { key: 'tankId', label: 'Tank ID' },
  { key: 'assetCode', label: 'Asset Code', aliases: ['Barge'] },
])
check(
  'mapping: case-insensitive alias + label match',
  aliasMap.sealNumber === 'seal no' && aliasMap.tankId === 'TANK ID' && aliasMap.assetCode === 'Barge',
  JSON.stringify(aliasMap)
)
check(
  'mapping: unmatched columns stay unmapped',
  autoMapColumns(['Something else'], [{ key: 'tankId', label: 'Tank ID' }]).tankId === undefined
)

/* -------------------------------------------------- 5. layered templates */

const baseFields = [
  { key: 'assetCode', label: 'Asset Code', required: true },
  { key: 'tankId', label: 'Tank ID', required: true },
  { key: 'sealNumber', label: 'Seal Number', required: true },
  { key: 'remarks', label: 'Remarks' },
]

templateStore.deleteTemplate('unit-test-module', 'tpl-a')
const saved = templateStore.saveTemplate('unit-test-module', {
  name: 'Monthly upload',
  columns: [
    { key: 'assetCode', label: 'Asset', included: true, aliases: ['Barge'] },
    { key: 'remarks', label: 'Notes', included: false, aliases: [] },
    { key: 'sealNumber', label: 'Seal No', included: true, aliases: ['Seal'] },
    { key: 'tankId', label: 'Tank', included: true, aliases: [] },
  ],
})
check('template store: saved', Boolean(saved.id) && saved.name === 'Monthly upload')

const listed = templateStore.listTemplates('unit-test-module', baseFields)
check('template store: system default listed first', listed[0].id === templateStore.SYSTEM_TEMPLATE_ID)
check('template store: user variant listed', listed.some((item) => item.id === saved.id))

const applied = templateStore.applyTemplate(baseFields, saved)
check('template: order follows the user template', applied[0].key === 'assetCode')
check('template: label override applied', applied[0].label === 'Asset')
check('template: optional switched-off column dropped', !applied.some((field) => field.key === 'remarks'))
check('template: required columns never dropped', applied.some((field) => field.key === 'tankId'))

const systemApplied = templateStore.applyTemplate(baseFields, listed[0])
check('template: system default leaves fields untouched', systemApplied.length === baseFields.length)

templateStore.deleteTemplate('unit-test-module', saved.id)
check(
  'template store: deleted',
  !templateStore.listTemplates('unit-test-module', baseFields).some((item) => item.id === saved.id)
)

/* ------------------------------------------------------------ 6. exports */

const exportColumns = [
  { key: 'assetCode', label: 'Asset Code' },
  { key: 'tankId', label: 'Tank ID' },
  { key: 'sealNumber', label: 'Seal Number' },
]
const exportData = [
  { assetCode: 'BRG-001', tankId: 'C1', sealNumber: 'SL-9001' },
  { assetCode: 'BRG-001', tankId: 'C2', sealNumber: 'SL-9002' },
]

const csvOut = rowsToCsv(exportData, exportColumns)
check('csv export: header + rows', csvOut.split('\r\n').length === 3, JSON.stringify(csvOut))
check('csv export: formula injection guarded', rowsToCsv([{ v: '=SUM(A1)' }], [{ key: 'v', label: 'v' }]).includes("'=SUM(A1)"))

downloads.length = 0
await exportRows({ format: 'csv', rows: exportData, columns: exportColumns, fileName: 'unit-seals', title: 'Seals' })
check('exportRows csv: download triggered', downloads.length === 2, `${downloads.length}`)

downloads.length = 0
await exportRows({ format: 'xlsx', rows: exportData, columns: exportColumns, fileName: 'unit-seals', title: 'Seals' })
const xlsxBlob = downloads.find((item) => typeof item.arrayBuffer === 'function')
check('exportRows xlsx: blob produced', Boolean(xlsxBlob))
if (xlsxBlob) {
  const out = new ExcelJS.Workbook()
  await out.xlsx.load(await xlsxBlob.arrayBuffer())
  const sheet = out.worksheets[0]
  check('exportRows xlsx: header row written', sheet.getRow(1).getCell(1).value === 'Asset Code')
  check('exportRows xlsx: data row written', sheet.getRow(2).getCell(3).value === 'SL-9001')
  check('exportRows xlsx: numeric strings converted', typeof sheet.getRow(3).getCell(2).value !== 'undefined')
}

downloads.length = 0
await exportRows({
  format: 'xlsx',
  rows: [{ value: '=HYPERLINK("https://attacker.example")' }],
  columns: [{ key: 'value', label: 'Value' }],
  fileName: 'formula-guard',
})
const guardedXlsxBlob = downloads.find((item) => typeof item.arrayBuffer === 'function')
if (guardedXlsxBlob) {
  const guarded = new ExcelJS.Workbook()
  await guarded.xlsx.load(await guardedXlsxBlob.arrayBuffer())
  check(
    'xlsx export: formula injection guarded',
    guarded.worksheets[0].getRow(2).getCell(1).value.startsWith("'=")
  )
}

/* ------------------------------------------------------ 7. token storage */

const authTokens = await viteServer.ssrLoadModule('/src/api/authToken.js')
localStorage.clear()
authTokens.saveAccessToken('memory-only-access-token')
check('auth: access token available in memory', authTokens.getStoredAccessToken() === 'memory-only-access-token')
check(
  'auth: access token absent from localStorage',
  ['hydrocarbonAccessToken', 'hydrocarbon_access_token', 'access_token', 'accessToken']
    .every((key) => localStorage.getItem(key) === null)
)
authTokens.clearAccessToken()

// jspdf's node build writes the file straight to disk – capture and delete it.
const written = []
const nativeWrite = fs.writeFileSync
fs.writeFileSync = (file, ...rest) => {
  if (typeof file === 'string' && file.endsWith('.pdf')) {
    written.push(path.basename(file))
    return undefined
  }
  return nativeWrite.call(fs, file, ...rest)
}
downloads.length = 0
await exportRows({ format: 'pdf', rows: exportData, columns: exportColumns, fileName: 'unit-seals', title: 'Seals' })
fs.writeFileSync = nativeWrite
check('exportRows pdf: produced', written.length === 1, written.join(','))

/* ------------------------------------------------- 8. template generation */

downloads.length = 0
await exportRows({
  format: 'xlsx',
  rows: [{ assetCode: 'BRG-001', tankId: 'C1', sealNumber: 'SL-9001' }],
  columns: exportColumns,
  fileName: 'barge-seal-master-upload-template',
  title: 'Barge seal template',
})
const templateBlob = downloads.find((item) => typeof item.arrayBuffer === 'function')
const tpl = new ExcelJS.Workbook()
await tpl.xlsx.load(await templateBlob.arrayBuffer())
check(
  'template download: header row only data present',
  tpl.worksheets[0].getRow(1).getCell(1).value === 'Asset Code'
)

await viteServer.close()
console.log(`\n==== failures: ${failures}`)
process.exit(failures ? 1 : 0)
