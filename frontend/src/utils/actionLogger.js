/*
 * Client-side UI action log.
 *
 * The backend already writes an AuditLog row for every data mutation that goes
 * through the API (create / update / delete / approve / export endpoints).
 * This logger complements it for actions that never reach the server –
 * navigation, client-side exports, imports, prints, filter usage, theme
 * changes – so that "every action on every page" leaves a trace.
 *
 * Entries are kept in an in-memory ring buffer mirrored to sessionStorage
 * (per browser tab) and can be inspected from the user menu ("Activity").
 * Persisting them centrally requires a backend endpoint, which is out of
 * scope while the backend is frozen (see CLAUDE.md, section 0).
 */

const STORAGE_KEY = 'hca.uiActivityLog'
const MAX_ENTRIES = 500

let entries = null
let currentUser = null
let version = 0
const listeners = new Set()

const safeStorage = () => {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null
  } catch {
    return null
  }
}

const load = () => {
  if (entries) return entries
  const storage = safeStorage()
  try {
    const raw = storage ? storage.getItem(STORAGE_KEY) : null
    entries = raw ? JSON.parse(raw) : []
    if (!Array.isArray(entries)) entries = []
  } catch {
    entries = []
  }
  return entries
}

const persist = () => {
  const storage = safeStorage()
  if (!storage) return
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(entries))
  } catch {
    // Storage full or disabled – keep the in-memory copy only.
  }
}

const notify = () => {
  version += 1
  listeners.forEach((listener) => {
    try {
      listener(entries)
    } catch {
      // ignore listener errors
    }
  })
}

export const setActionLogUser = (user) => {
  currentUser = user
    ? {
        id: user.id,
        username: user.username,
        fullName: user.fullName || user.full_name || '',
      }
    : null
}

/**
 * Record a UI action.
 * @param {string} module   Page / module name, e.g. "Location Master"
 * @param {string} action   Verb, e.g. "Export CSV", "Open Page", "Apply Filter"
 * @param {object} [details] Small, serialisable payload (no secrets, no passwords)
 */
export const logUiAction = (module, action, details = undefined) => {
  const list = load()
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    module: String(module || 'Application'),
    action: String(action || 'Action'),
    route:
      typeof window !== 'undefined' && window.location
        ? window.location.pathname
        : '',
    user: currentUser ? currentUser.username : null,
    details: details === undefined ? undefined : details,
  }
  list.push(entry)
  if (list.length > MAX_ENTRIES) {
    list.splice(0, list.length - MAX_ENTRIES)
  }
  persist()
  notify()
  return entry
}

export const getUiActionLog = () => [...load()].reverse()

/**
 * Stable snapshot for useSyncExternalStore: returns the same array reference
 * until the log changes (oldest first – reverse it for display).
 */
let snapshot = null
let snapshotVersion = -1
export const getUiActionLogSnapshot = () => {
  if (snapshotVersion !== version) {
    snapshot = [...load()]
    snapshotVersion = version
  }
  return snapshot
}

export const clearUiActionLog = () => {
  entries = []
  persist()
  notify()
}

export const subscribeUiActionLog = (listener) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
