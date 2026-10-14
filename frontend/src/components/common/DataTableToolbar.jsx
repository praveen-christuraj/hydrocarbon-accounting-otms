import { useState } from 'react'
import DataFilterBar from './DataFilterBar'
import ExportMenu from './ExportMenu'
import ImportDialog from './ImportDialog'
import Icon from './Icon'

/**
 * One-line integration for list pages: filter bar + export + (optional) import.
 *
 *   const filters = useDataFilters(rows, columns, { module: 'Location Master' })
 *   <DataTableToolbar
 *     filters={filters}
 *     columns={columns}
 *     exportFileName="locations"
 *     exportTitle="Location Master"
 *     importConfig={{ fields, onImportRow, onComplete }}   // optional
 *     canImport={canManage}
 *     extraActions={<button type="button">…</button>}       // optional
 *   />
 */
function DataTableToolbar({
  filters,
  columns,
  exportFileName,
  exportTitle,
  exportSubtitle,
  module,
  importConfig,
  canImport = true,
  canExport = true,
  extraActions,
  searchPlaceholder,
  generatedBy,
}) {
  const [importOpen, setImportOpen] = useState(false)
  const exportColumns = (columns || []).filter((column) => column.export !== false)

  const actions = (
    <>
      {extraActions}
      {importConfig && canImport && (
        <button
          type="button"
          className="btn-secondary"
          onClick={() => setImportOpen(true)}
        >
          <Icon name="upload" size={15} />
          Import
        </button>
      )}
      {canExport && (
        <ExportMenu
          rows={filters.filteredRows}
          columns={exportColumns}
          fileName={exportFileName}
          title={exportTitle}
          subtitle={exportSubtitle}
          module={module || exportTitle}
          generatedBy={generatedBy}
        />
      )}
    </>
  )

  return (
    <>
      <DataFilterBar
        {...filters.barProps}
        actions={actions}
        searchPlaceholder={searchPlaceholder}
      />

      {importConfig && (
        <ImportDialog
          open={importOpen}
          onClose={() => setImportOpen(false)}
          title={importConfig.title || `Import ${exportTitle || 'data'}`}
          module={module || exportTitle}
          fields={importConfig.fields}
          onImportRow={importConfig.onImportRow}
          onComplete={importConfig.onComplete}
          validateRow={importConfig.validateRow}
          templateFileName={importConfig.templateFileName || exportFileName}
          description={importConfig.description}
        />
      )}
    </>
  )
}

export default DataTableToolbar
