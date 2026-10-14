/*
 * Export helpers (owner rule 6): CSV, XLSX (exceljs) and PDF (jspdf + autotable).
 * Heavy libraries are loaded on demand with dynamic import() so they do not
 * inflate the initial bundle.
 *
 *   await exportRows({ format: 'xlsx', rows, columns, fileName: 'locations', title: 'Location Master' })
 *
 * `columns` = [{ key, label, accessor?, format?, type? }]
 *   - accessor(row) overrides row[key]
 *   - format(value, row) converts the value to the exported text / number
 */
import { fileTimestamp, slugify, toIsoDateString } from './format'
import { logUiAction } from './actionLogger'

const isBlank = (value) => value === null || value === undefined || value === ''

export const getCellValue = (row, column) => {
  let value
  if (typeof column.accessor === 'function') value = column.accessor(row)
  else if (column.key && column.key.includes('.')) {
    value = column.key.split('.').reduce((acc, part) => (acc == null ? acc : acc[part]), row)
  } else value = row ? row[column.key] : undefined

  if (typeof column.format === 'function') return column.format(value, row)
  if (isBlank(value)) return ''
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (value instanceof Date) return toIsoDateString(value)
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  return value
}

const buildMatrix = (rows, columns) => {
  const header = columns.map((column) => column.label || column.key)
  const body = rows.map((row) => columns.map((column) => getCellValue(row, column)))
  return { header, body }
}

const triggerDownload = (blob, fileName) => {
  const url = window.URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  window.setTimeout(() => window.URL.revokeObjectURL(url), 1000)
}

const resolveFileName = (fileName, extension) => {
  const base = slugify(fileName || 'export')
  return `${base}-${fileTimestamp()}.${extension}`
}

/* ------------------------------------------------------------------ CSV */
const csvEscape = (value) => {
  const text = isBlank(value) ? '' : String(value)
  // Guard against spreadsheet formula injection.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
  if (/[",\r\n]/.test(safe)) return `"${safe.replace(/"/g, '""')}"`
  return safe
}

export const rowsToCsv = (rows, columns) => {
  const { header, body } = buildMatrix(rows, columns)
  const lines = [header.map(csvEscape).join(',')]
  body.forEach((cells) => lines.push(cells.map(csvEscape).join(',')))
  return lines.join('\r\n')
}

export const exportCsv = ({ rows, columns, fileName }) => {
  const csv = rowsToCsv(rows, columns)
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' })
  triggerDownload(blob, resolveFileName(fileName, 'csv'))
}

/* ----------------------------------------------------------------- XLSX */
export const exportXlsx = async ({ rows, columns, fileName, sheetName = 'Data', title }) => {
  const excelModule = await import('exceljs')
  const ExcelJS = excelModule.default || excelModule
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Hydrocarbon Accounting System'
  workbook.created = new Date()

  const sheet = workbook.addWorksheet(String(sheetName).slice(0, 31) || 'Data', {
    views: [{ state: 'frozen', ySplit: 1 }],
  })

  const { header, body } = buildMatrix(rows, columns)

  sheet.columns = columns.map((column, index) => ({
    header: header[index],
    key: column.key || `col${index}`,
    width: Math.min(
      60,
      Math.max(
        12,
        ...[header[index], ...body.slice(0, 200).map((cells) => cells[index])].map(
          (value) => String(isBlank(value) ? '' : value).length + 2
        )
      )
    ),
  }))

  body.forEach((cells) => {
    sheet.addRow(
      cells.map((value) => {
        if (typeof value === 'number') return value
        if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim()) && value.trim() !== '') {
          const number = Number(value)
          return Number.isFinite(number) && value.length < 16 ? number : value
        }
        return value
      })
    )
  })

  const headerRow = sheet.getRow(1)
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B2447' } }
  headerRow.alignment = { vertical: 'middle' }
  headerRow.height = 20

  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: Math.max(1, columns.length) },
  }

  if (title) {
    workbook.title = title
  }

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  triggerDownload(blob, resolveFileName(fileName, 'xlsx'))
}

/* ------------------------------------------------------------------ PDF */
export const exportPdf = async ({
  rows,
  columns,
  fileName,
  title,
  subtitle,
  orientation,
  generatedBy,
}) => {
  const [jspdfModule, autoTableModule] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ])
  // The browser build exposes jsPDF as the default export; the node build
  // (used by the headless smoke test) only as a named export.
  const JsPDF =
    jspdfModule.jsPDF ||
    (jspdfModule.default && jspdfModule.default.jsPDF) ||
    jspdfModule.default
  const autoTable = autoTableModule.autoTable || autoTableModule.default

  const { header, body } = buildMatrix(rows, columns)
  const landscape = orientation ? orientation === 'landscape' : columns.length > 6

  const doc = new JsPDF({
    orientation: landscape ? 'landscape' : 'portrait',
    unit: 'pt',
    format: 'a4',
  })

  const pageWidth = doc.internal.pageSize.getWidth()
  const margin = 36

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.setTextColor(11, 36, 71)
  doc.text(String(title || 'Export'), margin, 40)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(90, 105, 130)
  const metaParts = [
    `Generated ${new Date().toLocaleString()}`,
    generatedBy ? `by ${generatedBy}` : null,
    `${rows.length} record${rows.length === 1 ? '' : 's'}`,
  ].filter(Boolean)
  doc.text(metaParts.join('  |  '), margin, 56)
  if (subtitle) {
    doc.text(String(subtitle), margin, 70)
  }

  autoTable(doc, {
    head: [header],
    body: body.map((cells) => cells.map((value) => (isBlank(value) ? '' : String(value)))),
    startY: subtitle ? 82 : 68,
    margin: { left: margin, right: margin, bottom: 40 },
    styles: {
      font: 'helvetica',
      fontSize: 8,
      cellPadding: 4,
      textColor: [15, 31, 61],
      lineColor: [216, 224, 234],
      lineWidth: 0.5,
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: [11, 36, 71],
      textColor: 255,
      fontStyle: 'bold',
    },
    alternateRowStyles: { fillColor: [247, 249, 252] },
    columnStyles: columns.reduce((acc, column, index) => {
      if (column.type === 'number') acc[index] = { halign: 'right' }
      return acc
    }, {}),
    didDrawPage: (data) => {
      const pageCount = doc.internal.getNumberOfPages()
      doc.setFontSize(8)
      doc.setTextColor(120, 130, 150)
      doc.text(
        `Page ${data.pageNumber} of ${pageCount}`,
        pageWidth - margin,
        doc.internal.pageSize.getHeight() - 18,
        { align: 'right' }
      )
      doc.text(
        'Hydrocarbon Accounting System',
        margin,
        doc.internal.pageSize.getHeight() - 18
      )
    },
  })

  doc.save(resolveFileName(fileName, 'pdf'))
}

/* ----------------------------------------------------------- dispatcher */
export const exportRows = async ({
  format,
  rows,
  columns,
  fileName,
  title,
  subtitle,
  sheetName,
  module,
  generatedBy,
}) => {
  const safeRows = Array.isArray(rows) ? rows : []
  const safeColumns = (columns || []).filter((column) => column && (column.key || column.accessor))
  if (safeColumns.length === 0) {
    throw new Error('Nothing to export: no columns are defined for this list.')
  }

  if (format === 'csv') exportCsv({ rows: safeRows, columns: safeColumns, fileName })
  else if (format === 'xlsx')
    await exportXlsx({ rows: safeRows, columns: safeColumns, fileName, sheetName, title })
  else if (format === 'pdf')
    await exportPdf({ rows: safeRows, columns: safeColumns, fileName, title, subtitle, generatedBy })
  else throw new Error(`Unsupported export format: ${format}`)

  logUiAction(module || title || 'List', `Export ${String(format).toUpperCase()}`, {
    rows: safeRows.length,
    columns: safeColumns.map((column) => column.key || column.label),
    fileName,
  })
}
