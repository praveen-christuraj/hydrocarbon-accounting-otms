import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  SYSTEM_TEMPLATE_ID,
  applyTemplate,
  buildTemplateColumns,
  deleteTemplate,
  listTemplates,
  saveTemplate,
} from '../utils/importTemplateStore'
import { logUiAction } from '../utils/actionLogger'

/*
 * Layered template state for the bulk-upload dialog (owner rule 6).
 *
 *   const templates = useBulkTemplates('Asset Master', fields)
 *   <ImportDialog fields={templates.fields} {...templates.controls} />
 *
 * Two modes:
 *
 *  1. Module mode (default) – the system default is derived from `fields` and
 *     user variants are persisted in the browser by importTemplateStore.
 *  2. External mode – pass `external` when the templates come from a real
 *     template master that already exists in the application (for example the
 *     Calibration Template Master drives Asset Calibration Table). The caller
 *     owns the list and the persistence.
 *
 * The returned `fields` are the resolved, template-shaped field list and are
 * what the dialog must use for mapping, template generation and validation.
 */

const cloneColumns = (columns = []) =>
  columns.map((column) => ({
    key: column.key,
    label: column.label || column.key,
    included: column.included !== false,
    aliases: Array.isArray(column.aliases) ? [...column.aliases] : [],
  }))

export function useBulkTemplates(moduleKey, fields = [], external = null) {
  const [storeVersion, setStoreVersion] = useState(0)
  const [activeTemplateId, setActiveTemplateId] = useState(SYSTEM_TEMPLATE_ID)
  const [workingColumns, setWorkingColumns] = useState(null)

  const externalTemplates = external?.templates
  const isExternal = Array.isArray(externalTemplates)

  const templates = useMemo(() => {
    if (isExternal) return externalTemplates
    void storeVersion // re-read the browser store after a save / delete
    return listTemplates(moduleKey, fields)
  }, [isExternal, externalTemplates, moduleKey, fields, storeVersion])

  const externalActiveId = external?.activeTemplateId
  const activeTemplateIdResolved = isExternal
    ? externalActiveId || templates[0]?.id || SYSTEM_TEMPLATE_ID
    : activeTemplateId

  const activeTemplate = useMemo(
    () => templates.find((item) => item.id === activeTemplateIdResolved) || templates[0] || null,
    [templates, activeTemplateIdResolved]
  )

  // Start a new module on the system default.
  const lastModuleKey = useRef(moduleKey)
  useEffect(() => {
    if (lastModuleKey.current === moduleKey) return
    lastModuleKey.current = moduleKey
    setActiveTemplateId(SYSTEM_TEMPLATE_ID)
    setWorkingColumns(null)
  }, [moduleKey])

  const templateColumns = useMemo(
    () => (activeTemplate ? cloneColumns(activeTemplate.columns) : buildTemplateColumns(fields)),
    [activeTemplate, fields]
  )

  // In external mode the caller owns the columns, so never shadow them.
  const columns = isExternal ? templateColumns : workingColumns || templateColumns

  const resolvedFields = useMemo(
    () => applyTemplate(fields, { id: activeTemplate?.id, columns }),
    [fields, activeTemplate, columns]
  )

  const select = useCallback(
    (templateId) => {
      if (isExternal) {
        if (typeof external?.onSelectTemplate === 'function') external.onSelectTemplate(templateId)
        return
      }
      setActiveTemplateId(templateId)
      setWorkingColumns(null)
    },
    [isExternal, external]
  )

  const moveColumn = useCallback(
    (key, direction) => {
      if (isExternal) return
      setWorkingColumns((current) => {
        const list = cloneColumns(current || templateColumns)
        const index = list.findIndex((column) => column.key === key)
        const target = index + direction
        if (index < 0 || target < 0 || target >= list.length) return list
        const [moved] = list.splice(index, 1)
        list.splice(target, 0, moved)
        return list
      })
    },
    [isExternal, templateColumns]
  )

  const toggleColumn = useCallback(
    (key) => {
      if (isExternal) return
      setWorkingColumns((current) =>
        cloneColumns(current || templateColumns).map((column) =>
          column.key === key ? { ...column, included: !column.included } : column
        )
      )
    },
    [isExternal, templateColumns]
  )

  const renameColumn = useCallback(
    (key, label) => {
      if (isExternal) return
      setWorkingColumns((current) =>
        cloneColumns(current || templateColumns).map((column) =>
          column.key === key ? { ...column, label } : column
        )
      )
    },
    [isExternal, templateColumns]
  )

  const saveAs = useCallback(
    (name) => {
      const trimmed = String(name || '').trim()
      if (!trimmed) return null
      if (isExternal) {
        if (typeof external?.onSaveTemplate === 'function') external.onSaveTemplate(trimmed, cloneColumns(columns))
        return null
      }
      const saved = saveTemplate(moduleKey, {
        name: trimmed,
        columns: cloneColumns(columns),
      })
      setStoreVersion((value) => value + 1)
      setActiveTemplateId(saved.id)
      setWorkingColumns(null)
      logUiAction(moduleKey, 'Import Template Saved', {
        templateId: saved.id,
        templateName: saved.name,
        columns: saved.columns.filter((column) => column.included !== false).map((column) => column.key),
      })
      return saved
    },
    [isExternal, external, columns, moduleKey]
  )

  const remove = useCallback(
    (templateId) => {
      if (!templateId || templateId === SYSTEM_TEMPLATE_ID) return
      if (isExternal) {
        if (typeof external?.onDeleteTemplate === 'function') external.onDeleteTemplate(templateId)
        return
      }
      deleteTemplate(moduleKey, templateId)
      setStoreVersion((value) => value + 1)
      setActiveTemplateId(SYSTEM_TEMPLATE_ID)
      setWorkingColumns(null)
      logUiAction(moduleKey, 'Import Template Deleted', { templateId })
    },
    [isExternal, external, moduleKey]
  )

  const reset = useCallback(() => {
    if (isExternal) {
      if (typeof external?.onSelectTemplate === 'function') external.onSelectTemplate(templates[0]?.id)
      return
    }
    setActiveTemplateId(SYSTEM_TEMPLATE_ID)
    setWorkingColumns(null)
  }, [isExternal, external, templates])

  const isSystem = !activeTemplate || activeTemplate.system === true || activeTemplate.id === SYSTEM_TEMPLATE_ID
  const dirty = !isSystem || Boolean(workingColumns)

  return {
    templates,
    activeTemplate,
    activeTemplateId: activeTemplate?.id || SYSTEM_TEMPLATE_ID,
    columns,
    fields: resolvedFields,
    isSystem,
    dirty,
    canConfigure: !isExternal,
    select,
    moveColumn,
    toggleColumn,
    renameColumn,
    saveAs,
    remove,
    reset,
  }
}

export default useBulkTemplates
