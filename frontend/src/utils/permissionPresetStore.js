/*
 * Permission Preset store – named, reusable permission sets for roles.
 *
 * Follows the Permission Preset module of HCA-System: at most 20 saved
 * presets (active and inactive both count), unique names of 2–120
 * characters, at least one permission per preset, Active / Inactive status
 * and an "applied" counter.
 *
 * The backend and database of this application are frozen (CLAUDE.md §0),
 * so there is no preset table: saved presets are kept in this browser
 * (localStorage), behind this module, exactly like the bulk-upload templates
 * in importTemplateStore.js. Moving to a server-side `/permission-presets`
 * API later is a change to this file only. Presets never grant anything by
 * themselves – applying one always goes through the existing, audited Role
 * Permission Assignment endpoint (POST /role-permissions/{role_id}).
 *
 * A preset stores permission NAMES (the stable identity of a permission in
 * every environment), so exported presets can be imported elsewhere.
 */

const STORAGE_KEY = 'hca.permissionPresets.v1'

export const MAX_PERMISSION_PRESETS = 20
export const PRESET_NAME_MIN_LENGTH = 2
export const PRESET_NAME_MAX_LENGTH = 120
export const PRESET_DESCRIPTION_MAX_LENGTH = 500
export const PRESET_STATUSES = ['Active', 'Inactive']

const listeners = new Set()
let cache = null

const safeStorage = () => {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}

const nameKey = (value) => String(value || '').trim().toLowerCase()

const uniqueNames = (names = []) => {
  const seen = new Set()
  const result = []
  for (const name of names) {
    const cleaned = String(name || '').trim()
    const lowered = cleaned.toLowerCase()
    if (!cleaned || seen.has(lowered)) continue
    seen.add(lowered)
    result.push(cleaned)
  }
  return result
}

const sanitise = (preset) => ({
  id: String(preset.id),
  presetName: String(preset.presetName || '').trim(),
  description: String(preset.description || ''),
  status: PRESET_STATUSES.includes(preset.status) ? preset.status : 'Active',
  permissionNames: uniqueNames(Array.isArray(preset.permissionNames) ? preset.permissionNames : []),
  timesApplied: Math.max(0, Number(preset.timesApplied) || 0),
  lastAppliedAt: preset.lastAppliedAt || '',
  createdAt: preset.createdAt || '',
  createdBy: preset.createdBy || '',
  updatedAt: preset.updatedAt || preset.createdAt || '',
  updatedBy: preset.updatedBy || preset.createdBy || '',
})

const read = () => {
  if (cache) return cache
  const storage = safeStorage()
  let presets = []
  try {
    const raw = storage ? storage.getItem(STORAGE_KEY) : null
    const parsed = raw ? JSON.parse(raw) : null
    if (parsed && Array.isArray(parsed.presets)) {
      presets = parsed.presets.filter((item) => item && item.id && item.presetName).map(sanitise)
    }
  } catch {
    presets = []
  }
  cache = Object.freeze(presets)
  return cache
}

const notify = () => {
  listeners.forEach((listener) => {
    try {
      listener()
    } catch {
      // A broken subscriber must not stop the others.
    }
  })
}

const write = (presets) => {
  cache = Object.freeze(presets.map(sanitise))
  const storage = safeStorage()
  if (storage) {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, presets: cache }))
    } catch {
      // Storage full or disabled – the in-memory copy still works for this tab.
    }
  }
  notify()
}

// Keep several open tabs in step.
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY) return
    cache = null
    notify()
  })
}

/* ------------------------------------------------------------ reading */

/** Stable (frozen) array – safe for useSyncExternalStore. */
export const getPresetsSnapshot = () => read()

export const subscribePresets = (listener) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const getPreset = (id) => read().find((preset) => preset.id === String(id)) || null

export const presetSlots = () => {
  const used = read().length
  return { used, limit: MAX_PERMISSION_PRESETS, remaining: Math.max(MAX_PERMISSION_PRESETS - used, 0) }
}

/* ----------------------------------------------------------- validation */

/**
 * Validate preset values. Throws an Error with a user-facing message, or
 * returns the cleaned values.
 */
export const validatePresetValues = (values, { excludeId = null } = {}) => {
  const presetName = String(values?.presetName || '').trim().replace(/\s+/g, ' ')
  if (presetName.length < PRESET_NAME_MIN_LENGTH) {
    throw new Error(`Preset name must have at least ${PRESET_NAME_MIN_LENGTH} characters.`)
  }
  if (presetName.length > PRESET_NAME_MAX_LENGTH) {
    throw new Error(`Preset name can have at most ${PRESET_NAME_MAX_LENGTH} characters.`)
  }
  if (read().some((preset) => preset.id !== excludeId && nameKey(preset.presetName) === nameKey(presetName))) {
    throw new Error(`A preset named “${presetName}” already exists.`)
  }
  const description = String(values?.description || '').trim()
  if (description.length > PRESET_DESCRIPTION_MAX_LENGTH) {
    throw new Error(`Description can have at most ${PRESET_DESCRIPTION_MAX_LENGTH} characters.`)
  }
  const status = values?.status || 'Active'
  if (!PRESET_STATUSES.includes(status)) throw new Error('Status must be Active or Inactive.')
  const permissionNames = uniqueNames(values?.permissionNames || [])
  if (permissionNames.length === 0) {
    throw new Error('A preset must contain at least one permission.')
  }
  return { presetName, description, status, permissionNames }
}

/* ------------------------------------------------------------ writing */

const newId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `preset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

export const createPreset = (values, actorName = '') => {
  const presets = read()
  if (presets.length >= MAX_PERMISSION_PRESETS) {
    throw new Error(
      `The preset limit of ${MAX_PERMISSION_PRESETS} is reached. Delete a preset you no longer need to free a slot.`
    )
  }
  const cleaned = validatePresetValues(values)
  const now = new Date().toISOString()
  const preset = sanitise({
    ...cleaned,
    id: newId(),
    timesApplied: 0,
    lastAppliedAt: '',
    createdAt: now,
    createdBy: actorName,
    updatedAt: now,
    updatedBy: actorName,
  })
  write([...presets, preset])
  return preset
}

export const updatePreset = (id, values, actorName = '') => {
  const presets = read()
  const current = presets.find((preset) => preset.id === String(id))
  if (!current) throw new Error('This preset no longer exists.')
  const cleaned = validatePresetValues({ ...current, ...values }, { excludeId: current.id })
  const updated = sanitise({ ...current, ...cleaned, updatedAt: new Date().toISOString(), updatedBy: actorName })
  write(presets.map((preset) => (preset.id === current.id ? updated : preset)))
  return updated
}

export const setPresetStatus = (id, status, actorName = '') => updatePreset(id, { status }, actorName)

export const deletePreset = (id) => {
  const presets = read()
  if (!presets.some((preset) => preset.id === String(id))) throw new Error('This preset no longer exists.')
  write(presets.filter((preset) => preset.id !== String(id)))
}

/** Count an application (one per role that received the preset). */
export const recordPresetApplication = (id, roleCount = 1) => {
  const presets = read()
  const current = presets.find((preset) => preset.id === String(id))
  if (!current || roleCount <= 0) return
  const updated = {
    ...current,
    timesApplied: current.timesApplied + roleCount,
    lastAppliedAt: new Date().toISOString(),
  }
  write(presets.map((preset) => (preset.id === current.id ? updated : preset)))
}
