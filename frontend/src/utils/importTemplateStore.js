/*
 * Bulk import template store – layered templates (owner rule 6).
 *
 * Every module ships with a SYSTEM DEFAULT template that is derived from the
 * page's own column definitions. On top of that a user can save named variants
 * (re-ordered / renamed / reduced column sets) that are used when generating
 * the downloadable upload template and when auto-mapping the uploaded file.
 *
 * The backend is frozen (CLAUDE.md section 0), so there is no server-side
 * template table yet. Everything is kept behind this module so switching to a
 * real `/import-templates` API later is a one-file change.
 *
 * Dynamic modules do NOT use this store: their templates come from a real
 * template master that already exists in the application. Asset Calibration
 * Table, for instance, is driven by the Calibration Template Master, so the
 * page passes those templates straight into the import dialog.
 */

const STORAGE_KEY = 'hca.bulkTemplates.v1'

export const SYSTEM_TEMPLATE_ID = 'system-default'
export const SYSTEM_TEMPLATE_NAME = 'System default'

const safeStorage = () => {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}

// The store is read on every render of a page that shows a bulk-upload
// dialog, so keep a parsed copy in memory and only re-read after a write.
let cache = null

const readStore = () => {
  if (cache) return cache
  const storage = safeStorage()
  if (!storage) return {}
  try {
    const raw = storage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    cache = parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    cache = {}
  }
  return cache
}

const writeStore = (store) => {
  cache = store
  const storage = safeStorage()
  if (!storage) return
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch {
    // Storage full or disabled – the in-memory copy is still returned.
  }
}

/** Column descriptor stored inside a template. */
export const buildTemplateColumns = (fields = []) =>
  fields.map((field) => ({
    key: field.key,
    label: field.label || field.key,
    included: true,
    aliases: Array.isArray(field.aliases) ? [...field.aliases] : [],
  }))

export const buildSystemTemplate = (fields = []) => ({
  id: SYSTEM_TEMPLATE_ID,
  name: SYSTEM_TEMPLATE_NAME,
  system: true,
  columns: buildTemplateColumns(fields),
})

/** All templates for a module: system default first, then the saved variants. */
export const listTemplates = (moduleKey, fields = []) => {
  if (!moduleKey) return [buildSystemTemplate(fields)]
  const store = readStore()
  const saved = Array.isArray(store[moduleKey]) ? store[moduleKey] : []
  return [
    buildSystemTemplate(fields),
    ...saved.filter((template) => template && template.id && template.id !== SYSTEM_TEMPLATE_ID),
  ]
}

export const getTemplate = (moduleKey, templateId, fields = []) => {
  const templates = listTemplates(moduleKey, fields)
  return templates.find((template) => template.id === templateId) || templates[0]
}

export const saveTemplate = (moduleKey, template) => {
  if (!moduleKey) return template
  const store = readStore()
  const saved = Array.isArray(store[moduleKey]) ? store[moduleKey] : []
  const id =
    template.id && template.id !== SYSTEM_TEMPLATE_ID
      ? template.id
      : `tpl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  const next = { ...template, id, system: false }
  const index = saved.findIndex((item) => item.id === id)
  if (index >= 0) saved[index] = next
  else saved.push(next)
  store[moduleKey] = saved
  writeStore(store)
  return next
}

export const deleteTemplate = (moduleKey, templateId) => {
  if (!moduleKey || !templateId || templateId === SYSTEM_TEMPLATE_ID) return
  const store = readStore()
  const saved = Array.isArray(store[moduleKey]) ? store[moduleKey] : []
  store[moduleKey] = saved.filter((item) => item.id !== templateId)
  writeStore(store)
}

/**
 * Apply a template's column order / labels / aliases on top of the module's
 * base field definitions.
 *
 * Required fields are never dropped – a user template can hide optional
 * columns but it can never weaken the validation of an import.
 */
export const applyTemplate = (fields = [], template) => {
  if (!template || template.system || !Array.isArray(template.columns)) return fields

  const byKey = new Map(fields.map((field) => [field.key, field]))
  const resolved = []
  // Columns the template mentions, whether it keeps them or switches them off.
  const mentioned = new Set()

  template.columns.forEach((column) => {
    const base = byKey.get(column.key)
    if (!base) return
    mentioned.add(base.key)
    if (base.required || column.included !== false) {
      resolved.push({
        ...base,
        label: column.label || base.label,
        aliases:
          Array.isArray(column.aliases) && column.aliases.length
            ? column.aliases
            : base.aliases,
      })
    }
  })

  // Columns the template does not mention at all are appended unchanged.
  fields.forEach((field) => {
    if (!mentioned.has(field.key)) resolved.push(field)
  })

  return resolved
}

/** Ordered list of the columns a template actually contains. */
export const templateColumnKeys = (template, fields = []) =>
  applyTemplate(fields, template).map((field) => field.key)
