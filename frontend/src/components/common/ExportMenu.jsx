import { useEffect, useRef, useState } from 'react'
import Icon from './Icon'
import { exportRows } from '../../utils/exportUtils'
import { useToast } from './Toast'

const FORMATS = [
  { value: 'xlsx', label: 'Excel workbook (.xlsx)', icon: 'fileSpreadsheet' },
  { value: 'csv', label: 'CSV file (.csv)', icon: 'fileText' },
  { value: 'pdf', label: 'PDF document (.pdf)', icon: 'print' },
]

/**
 * Export dropdown (owner rule 6). Exports the rows it is given – pass the
 * *filtered* rows so the user gets what they see.
 *
 *   <ExportMenu rows={filteredRows} columns={columns} fileName="locations" title="Location Master" />
 */
function ExportMenu({
  rows,
  columns,
  fileName,
  title,
  subtitle,
  module,
  disabled = false,
  label = 'Export',
  generatedBy,
  onBeforeExport,
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState('')
  const wrapperRef = useRef(null)
  const toast = useToast()

  // Dropdown menus (not dialogs) close on outside click / Escape.
  useEffect(() => {
    if (!open) return undefined
    const handlePointer = (event) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setOpen(false)
      }
    }
    const handleKey = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handlePointer)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handlePointer)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  const rowCount = Array.isArray(rows) ? rows.length : 0

  const run = async (format) => {
    setOpen(false)
    if (rowCount === 0) {
      toast.warning('There are no rows to export with the current filters.', { title })
      return
    }
    try {
      setBusy(format)
      if (typeof onBeforeExport === 'function') await onBeforeExport(format)
      await exportRows({
        format,
        rows,
        columns,
        fileName: fileName || title,
        title: title || fileName,
        subtitle,
        module: module || title,
        generatedBy,
      })
      toast.success(`${rowCount} row${rowCount === 1 ? '' : 's'} exported to ${format.toUpperCase()}.`, {
        title: title || 'Export',
      })
    } catch (error) {
      toast.error(error.message || 'Export failed.', { title: title || 'Export' })
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="export-menu" ref={wrapperRef}>
      <button
        type="button"
        className="btn-secondary export-menu-button"
        onClick={() => setOpen((value) => !value)}
        disabled={disabled || Boolean(busy)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Icon name="download" size={15} />
        {busy ? `Exporting ${busy.toUpperCase()}…` : label}
        <Icon name="chevronDown" size={14} className="export-menu-chevron" />
      </button>

      {open && (
        <div className="export-menu-popover" role="menu">
          <div className="export-menu-title">
            Export {rowCount} row{rowCount === 1 ? '' : 's'}
          </div>
          {FORMATS.map((format) => (
            <button
              key={format.value}
              type="button"
              role="menuitem"
              className="export-menu-item"
              onClick={() => run(format.value)}
            >
              <Icon name={format.icon} size={16} />
              {format.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default ExportMenu
