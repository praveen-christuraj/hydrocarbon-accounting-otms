import { useState } from 'react'
import DataFilterBar from './DataFilterBar'
import ExportMenu from './ExportMenu'
import ImportDialog from './ImportDialog'
import Icon from './Icon'
import { useBulkTemplates } from '../../hooks/useBulkTemplates'

/**
 * One-line integration for list pages: filter bar + bulk export (xlsx / csv /
 * pdf) + bulk upload (xlsx / csv) with layered templates.
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
 *
 * `importConfig` may also carry a module whose templates come from a real
 * template master instead of the built-in column set – pass
 * `{ templates, activeTemplateId, onSelectTemplate, onSaveTemplate,
 *    onDeleteTemplate }` and they will drive the upload dialog directly.
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

  const importFields = importConfig?.fields || []
  const externalTemplates = Array.isArray(importConfig?.templates)
    ? {
        templates: importConfig.templates,
        activeTemplateId: importConfig.activeTemplateId,
        onSelectTemplate: importConfig.onSelectTemplate,
        onSaveTemplate: importConfig.onSaveTemplate,
        onDeleteTemplate: importConfig.onDeleteTemplate,
      }
    : null

  const bulkTemplates = useBulkTemplates(
    importConfig?.templateKey || module || exportTitle,
    importFields,
    externalTemplates
  )

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
          Bulk Upload
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
          title={importConfig.title || `Bulk upload ${exportTitle || 'data'}`}
          module={module || exportTitle}
          fields={bulkTemplates.fields}
          onImportRow={importConfig.onImportRow}
          onImportBatch={importConfig.onImportBatch}
          onComplete={importConfig.onComplete}
          validateRow={importConfig.validateRow}
          templateFileName={importConfig.templateFileName || exportFileName}
          description={importConfig.description}
          maxRows={importConfig.maxRows}
          templates={bulkTemplates.templates}
          activeTemplateId={bulkTemplates.activeTemplateId}
          onSelectTemplate={bulkTemplates.select}
          onSaveTemplate={bulkTemplates.saveAs}
          onDeleteTemplate={bulkTemplates.remove}
          columns={bulkTemplates.columns}
          onToggleColumn={bulkTemplates.toggleColumn}
          onMoveColumn={bulkTemplates.moveColumn}
          onResetTemplate={bulkTemplates.reset}
          canConfigure={bulkTemplates.canConfigure}
        />
      )}
    </>
  )
}

export default DataTableToolbar
