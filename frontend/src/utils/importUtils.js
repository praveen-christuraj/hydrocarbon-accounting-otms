/*
 * Import helpers (owner rule 6): read .xlsx / .csv files in the browser into
 * plain row objects keyed by the header cells.
 *
 *   const { headers, rows, sheetName } = await parseImportFile(file)
 */
import { toIsoDateString } from './format'

const normaliseHeader = (value, index) => {
  const text = String(value ?? '').trim()
  return text || `Column ${index + 1}`
}

/* ------------------------------------------------------------------ CSV */
export const parseCsvText = (text) => {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  const input = String(text || '').replace(/^\uFEFF/, '')

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i]
    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"'
          i += 1
        } else {
          inQuotes = false
        }
      } else {
        field += char
      }
    } else if (char === '"') {
      inQuotes = true
    } else if (char === ',' || char === ';' || char === '\t') {
      // Accept comma, semicolon or tab delimited files – use the first
      // delimiter found on the header line consistently.
      if (rows.length === 0 && row.length === 0 && field === '' && char !== ',') {
        field += char
      } else {
        row.push(field)
        field = ''
      }
    } else if (char === '\r') {
      // ignore – handled by \n
    } else if (char === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += char
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  // Detect delimiter: if header has a single cell containing ; or \t, re-split.
  if (rows.length > 0 && rows[0].length === 1) {
    const header = rows[0][0]
    const delimiter = header.includes('\t') ? '\t' : header.includes(';') ? ';' : null
    if (delimiter) {
      return rows.map((cells) => cells.join(',').split(delimiter))
    }
  }
  return rows
}

/* ----------------------------------------------------------------- XLSX */
const cellToValue = (cell) => {
  const value = cell && cell.value !== undefined ? cell.value : cell
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return toIsoDateString(value)
  if (typeof value === 'object') {
    if (value.richText) return value.richText.map((part) => part.text).join('')
    if (value.text !== undefined) return String(value.text)
    if (value.result !== undefined) return cellToValue({ value: value.result })
    if (value.hyperlink) return String(value.text || value.hyperlink)
    if (value.error) return ''
    return String(value)
  }
  return value
}

const parseXlsxFile = async (file) => {
  const ExcelJS = (await import('exceljs')).default || (await import('exceljs'))
  const workbook = new ExcelJS.Workbook()
  const buffer = await file.arrayBuffer()
  await workbook.xlsx.load(buffer)
  const sheet = workbook.worksheets.find((item) => item.rowCount > 0) || workbook.worksheets[0]
  if (!sheet) return { matrix: [], sheetName: '' }

  const matrix = []
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const cells = []
    const count = Math.max(row.cellCount, sheet.columnCount || 0)
    for (let col = 1; col <= count; col += 1) {
      cells.push(cellToValue(row.getCell(col)))
    }
    matrix.push(cells)
  })
  return { matrix, sheetName: sheet.name }
}

/* ------------------------------------------------------------- dispatch */
export const SUPPORTED_IMPORT_EXTENSIONS = ['.xlsx', '.csv']

const matrixToRows = (matrix) => {
  const nonEmpty = matrix.filter((cells) =>
    cells.some((value) => String(value ?? '').trim() !== '')
  )
  if (nonEmpty.length === 0) return { headers: [], rows: [] }
  const headers = nonEmpty[0].map(normaliseHeader)
  const rows = nonEmpty.slice(1).map((cells, index) => {
    const record = { __rowNumber: index + 2 }
    headers.forEach((header, col) => {
      const raw = cells[col]
      record[header] = typeof raw === 'string' ? raw.trim() : raw === undefined ? '' : raw
    })
    return record
  })
  return { headers, rows }
}

export const parseImportFile = async (file) => {
  if (!file) throw new Error('Please choose a file to import.')
  const name = String(file.name || '').toLowerCase()

  if (name.endsWith('.csv') || name.endsWith('.txt')) {
    const text = await file.text()
    const matrix = parseCsvText(text)
    return { ...matrixToRows(matrix), sheetName: file.name, format: 'csv' }
  }

  if (name.endsWith('.xlsx') || name.endsWith('.xlsm')) {
    const { matrix, sheetName } = await parseXlsxFile(file)
    return { ...matrixToRows(matrix), sheetName, format: 'xlsx' }
  }

  if (name.endsWith('.xls')) {
    throw new Error(
      'Legacy .xls files are not supported. Save the workbook as .xlsx or .csv and try again.'
    )
  }

  throw new Error('Unsupported file type. Choose an .xlsx or .csv file.')
}

/**
 * Guess a mapping from import headers to target fields by comparing
 * normalised header text with field keys / labels / aliases.
 */
export const autoMapColumns = (headers, fields) => {
  const normalise = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '')
  const mapping = {}
  const used = new Set()

  fields.forEach((field) => {
    const candidates = [field.key, field.label, ...(field.aliases || [])].map(normalise)
    const match = headers.find(
      (header) => !used.has(header) && candidates.includes(normalise(header))
    )
    if (match) {
      mapping[field.key] = match
      used.add(match)
    }
  })

  return mapping
}
