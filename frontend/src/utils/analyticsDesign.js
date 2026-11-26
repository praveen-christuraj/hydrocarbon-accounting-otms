/**
 * Design-level helpers shared by the Analytics Studio and Viewer: stable ids,
 * id de-duplication, date-basis migration and per-visual/per-slicer migration
 * to a save-safe shape.
 *
 * These live outside the page component so importing them never breaks Fast
 * Refresh (component files must only export components).
 */
import { makeSafeKey } from './analyticsEngine'

/**
 * Collision-proof ids for visuals and slicers.
 *
 * ``Date.now()`` alone is too coarse: two quick clicks ("duplicate" twice, or
 * "re-add a deleted slicer") produced identical ids and the engine rejected the
 * whole save with "Visual 2 needs a unique id" / "Every slicer needs a unique
 * key" — a 400 that named an index instead of the thing the user had clicked.
 * A monotonic counter + random suffix makes every id unique within a session.
 */
let analyticsIdCounter = 0
function makeAnalyticsId(prefix) {
  analyticsIdCounter += 1
  const random = Math.random().toString(36).slice(2, 7)
  return `${prefix}_${Date.now().toString(36)}${analyticsIdCounter.toString(36)}${random}`
}

/**
 * Guarantee every visual id / slicer key in a definition is unique.
 *
 * Returns the migrated definition. Numbered ids (``Visual 2``) and duplicated
 * slicer keys coming from an older release, an import, or a paste are renamed
 * to fresh ids, and any layout/slicer reference to the renamed id follows it,
 * so the save can never fail on "needs a unique id" again.
 */
function ensureUniqueDesignIds(definition) {
  if (!definition || typeof definition !== 'object') return definition
  const visuals = Array.isArray(definition.visuals) ? definition.visuals : []
  const seenVisual = new Set()
  const visualIdMap = new Map()
  const nextVisuals = visuals.map((visual, index) => {
    if (!visual || typeof visual !== 'object') return visual
    const rawId = String(visual.id || '').trim()
    let id = rawId
    if (!id || seenVisual.has(id)) {
      id = makeAnalyticsId('vis')
      if (rawId) visualIdMap.set(rawId, id)
    }
    seenVisual.add(id)
    return id === visual.id ? visual : { ...visual, id }
  })

  const seenKeys = new Set()
  const slicers = Array.isArray(definition.slicers) ? definition.slicers : []
  const nextSlicers = slicers.map((slicer) => {
    if (!slicer || typeof slicer !== 'object') return slicer
    const patched = { ...slicer }
    if (Array.isArray(patched.visual_ids)) {
      patched.visual_ids = Array.from(new Set(patched.visual_ids.map((vid) => (
        visualIdMap.get(String(vid)) || vid
      ))))
    }
    let key = String(patched.key || '').trim()
    if (!key || seenKeys.has(key)) {
      key = `s_${makeSafeKey(patched.column_key || patched.field || key || 'field')}_${seenKeys.size + 1}`
    }
    seenKeys.add(key)
    patched.key = key
    if (!patched.field) patched.field = patched.column_key || key
    return patched
  })

  if (!visualIdMap.size && nextSlicers.every((item, i) => item === slicers[i])) {
    return definition
  }
  const layout = Array.isArray(definition.layout)
    ? definition.layout.map((item) => {
      if (!item || typeof item !== 'object') return item
      const mapped = visualIdMap.get(String(item.i || item.id))
      return mapped ? { ...item, i: mapped, id: mapped } : item
    })
    : definition.layout
  return { ...definition, visuals: nextVisuals, slicers: nextSlicers, layout }
}

/** Date bases the report engine accepts, with the labels the Studio shows. */
const DATE_BASIS_CHOICES = [
  { value: 'ACCOUNTING_DATE', label: 'Accounting Date', help: 'Uses the ticket date/time with the Location Accounting Day Setting. Recommended for stock accounting.' },
  { value: 'PAYLOAD_OPERATION_DATE', label: 'Operation / Gauging Date (from ticket answers)', help: 'The date typed inside the ticket, without the accounting-day shift.' },
  { value: 'OPERATION_DATE', label: 'Operation Date (ticket header)', help: 'The header operation date stored on the ticket.' },
  { value: 'CREATED_AT', label: 'Created Date', help: 'When the record was created in the system.' },
  { value: 'COLUMN', label: 'A date column I choose', help: 'Pick any date column of the selected table.' },
  { value: 'NONE', label: 'No date filtering', help: 'For master-data style visuals.' },
]

/**
 * Legacy date-basis names (and typos) accepted by older Studio releases.
 * Mirrors ``DATE_BASIS_ALIASES`` in the backend engine so the dropdown can
 * never emit a value the save path rejects.
 */
const DATE_BASIS_ALIASES = {
  OPERATIONAL_DATE: 'OPERATION_DATE',
  OPERATION_DATETIME: 'OPERATION_DATE',
  TICKET_DATE: 'OPERATION_DATE',
  GAUGING_DATE: 'PAYLOAD_OPERATION_DATE',
  PAYLOAD_DATE: 'PAYLOAD_OPERATION_DATE',
  ACCOUNTING_DAY: 'ACCOUNTING_DATE',
  CREATED_DATE: 'CREATED_AT',
  CREATED: 'CREATED_AT',
  NO_DATE: 'NONE',
  NONE_DATE: 'NONE',
}

function canonicalDateBasis(value) {
  const text = String(value || 'ACCOUNTING_DATE').trim().toUpperCase()
  return DATE_BASIS_ALIASES[text] || text
}

/** Migrate one visual to the current, save-safe shape. */
function normalizeVisualForSave(visual) {
  if (!visual || typeof visual !== 'object') return visual
  const query = visual.query && typeof visual.query === 'object' ? { ...visual.query } : visual.query
  if (query && !['TANK_VISUAL', 'TEXT'].includes(String(visual.type || '').toUpperCase())
    && !String((query.source || {}).kind || '').startsWith('tank_')
    && !['material_balance', 'tracking_status'].includes(String((query.source || {}).kind || ''))) {
    query.schema_version = 1
    if (query.date_basis !== undefined) query.date_basis = canonicalDateBasis(query.date_basis)
  }
  return query === visual.query ? visual : { ...visual, query }
}

/** Migrate one slicer to the current, save-safe shape. */
function normalizeSlicerForSave(slicer) {
  if (!slicer || typeof slicer !== 'object') return slicer
  const columnKey = String(slicer.column_key || slicer.field || '').trim()
  return {
    ...slicer,
    id: slicer.id || makeAnalyticsId('slicer'),
    key: String(slicer.key || '').trim() || `s_${makeSafeKey(columnKey || 'field')}_${Math.random().toString(36).slice(2, 6)}`,
    column_key: columnKey,
    field: columnKey,
  }
}

/**
 * Bring a definition loaded from the API to the shape this release can save.
 *
 * Migrates: legacy date bases (``OPERATIONAL_DATE`` → ``OPERATION_DATE``),
 * report ``schema_version`` drift, duplicate visual ids / slicer keys, and
 * slicers whose ``column_key`` was only stored on ``field``. Idempotent.
 */
function migrateLoadedDesign(definition) {
  if (!definition || typeof definition !== 'object') return definition
  const visuals = (Array.isArray(definition.visuals) ? definition.visuals : []).map(normalizeVisualForSave)
  const slicers = (Array.isArray(definition.slicers) ? definition.slicers : []).map(normalizeSlicerForSave)
  return ensureUniqueDesignIds({
    ...definition,
    schema_version: 2,
    visuals,
    slicers,
  })
}

export {
  makeAnalyticsId,
  ensureUniqueDesignIds,
  DATE_BASIS_CHOICES,
  canonicalDateBasis,
  normalizeVisualForSave,
  normalizeSlicerForSave,
  migrateLoadedDesign,
}
