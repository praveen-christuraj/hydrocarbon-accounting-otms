import { useEffect } from 'react'

const CONTROL_KEYS = new Set(['ctrl', 'control', 'cmd', 'meta', 'command'])

// Punctuation characters that need Shift on most keyboard layouts. When a
// binding uses one of these as a bare key, an active Shift modifier is
// ignored during matching so "?" (Shift+/) still resolves.
const SHIFTED_PUNCTUATION = /^[!@#$%^&*()_+|}{:"?><~]/

/**
 * Parse a combo string such as "mod+s", "mod+shift+s", "escape" or "?" into
 * a modifier set plus a normalized key. "mod" is platform-independent: it is
 * satisfied by Ctrl on Windows/Linux and Cmd on macOS (we simply accept
 * either at match time).
 */
export function parseCombo(combo) {
  const parts = String(combo || '')
    .toLowerCase()
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean)

  const mods = new Set()
  let key = ''
  for (const part of parts) {
    if (part === 'mod') mods.add('Mod')
    else if (CONTROL_KEYS.has(part)) mods.add('Control')
    else if (part === 'shift') mods.add('Shift')
    else if (part === 'alt') mods.add('Alt')
    else key = part
  }
  return { mods, key }
}

export function normalizeAlwaysOn(value) {
  const values = Array.isArray(value)
    ? value
    : String(value || '').split('+')
  const keys = new Set()
  values.forEach((item) => {
    String(item)
      .toLowerCase()
      .split('+')
      .map((part) => part.trim())
      .filter(Boolean)
      .forEach((part) => keys.add(part))
  })
  return keys
}

export function isEditableTarget(target) {
  if (!(target instanceof Element)) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return Boolean(target.isContentEditable)
}

export function modifiersMatch(mods, event) {
  const hasCtrl = Boolean(event.ctrlKey)
  const hasMeta = Boolean(event.metaKey)
  const hasAlt = Boolean(event.altKey)
  const hasShift = Boolean(event.shiftKey)

  // "Mod" requires at least one of Ctrl/Cmd to be held.
  if (mods.has('Mod') && !hasCtrl && !hasMeta) return false
  if (mods.has('Control') && !hasCtrl && !hasMeta) return false
  if (mods.has('Meta') && !hasMeta) return false
  if (mods.has('Alt') && !hasAlt) return false
  if (mods.has('Shift') && !hasShift) return false

  // Reject any extra modifier that the binding does not account for. Shift
  // is tolerated for bare punctuation keys (e.g. "?" = Shift+/).
  const controlAccounted = mods.has('Control') || mods.has('Mod')
  const metaAccounted = mods.has('Meta') || mods.has('Mod')
  const shiftTolerated =
    mods.has('Shift') || SHIFTED_PUNCTUATION.test(String(event.key).toLowerCase())
  if (hasCtrl && !controlAccounted) return false
  if (hasMeta && !metaAccounted) return false
  if (hasAlt && !mods.has('Alt')) return false
  if (hasShift && !shiftTolerated) return false
  return true
}

/**
 * Resolve which binding (if any) should handle a keyboard event. Pure and
 * exported so the dispatch rules can be verified without a browser.
 *
 * `isEditable` indicates the event originated inside an input/textarea/select
 * or contenteditable element. `alwaysOnKeys` is the set of bare keys allowed
 * to fire even from inside such a field.
 */
export function resolveShortcut(entries, event, { isEditable = false, alwaysOnKeys = new Set() } = {}) {
  const key = event.key.toLowerCase()
  const hasModifier = event.ctrlKey || event.metaKey || event.altKey

  // A bare key pressed inside a form field must never be stolen, except for
  // explicitly always-on shortcuts such as Escape.
  if (isEditable && !hasModifier) {
    return (
      entries.find(
        (entry) =>
          entry.mods.size === 0 &&
          entry.key === key &&
          alwaysOnKeys.has(entry.key)
      ) || null
    )
  }

  for (const entry of entries) {
    if (!entry.key || entry.key !== key) continue
    if (!modifiersMatch(entry.mods, event)) continue
    return entry
  }
  return null
}

/**
 * Build the parsed binding list that the hook (and resolveShortcut) uses.
 */
export function buildShortcutEntries(bindings = {}, alwaysOn = []) {
  return {
    entries: Object.entries(bindings).map(([combo, handler]) => ({
      ...parseCombo(combo),
      handler,
    })),
    alwaysOnKeys: normalizeAlwaysOn(alwaysOn),
  }
}

/**
 * Page-scoped keyboard shortcuts.
 *
 * `bindings` maps a combo like "mod+s", "mod+shift+s", "escape", "?" to a
 * handler. "mod" resolves to Ctrl/Cmd. Shortcuts never fire while the user
 * is typing inside an editable input, textarea or select - unless the combo
 * uses a modifier key (ctrl/cmd/alt), so Ctrl+S still saves from inside a
 * field. Bare keys such as "?" only fire when focus is outside a field.
 * Combos listed in `alwaysOn` (for example "escape" to dismiss a
 * confirmation) fire regardless of focus.
 *
 * Every handled key is preventDefault'ed so browser defaults (Ctrl+S = save
 * page) never intercept the action.
 *
 * Pass a memoized `bindings` object and a stable `alwaysOn` array from the
 * caller so the document listener is not needlessly re-subscribed.
 */
export default function useKeyboardShortcuts({
  bindings = {},
  enabled = true,
  alwaysOn = [],
} = {}) {
  useEffect(() => {
    if (!enabled) return undefined

    const { entries, alwaysOnKeys } = buildShortcutEntries(bindings, alwaysOn)

    const onKeyDown = (event) => {
      const entry = resolveShortcut(entries, event, {
        isEditable: isEditableTarget(event.target),
        alwaysOnKeys,
      })
      if (!entry) return
      event.preventDefault()
      entry.handler(event)
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [bindings, enabled, alwaysOn])
}
