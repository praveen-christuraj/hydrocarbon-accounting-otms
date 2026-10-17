/*
 * Permission presets – pure helpers shared by the Permission Presets page and
 * the preset bar of Role Permission Assignment. No React, no API calls.
 *
 * `groups` is the result of buildPermissionGroups() (utils/permissionCatalog):
 * entries carry the permission name, catalog action / module / category and
 * the database row (`permission`: { id, status }) when it is known.
 */
import { CUSTOM_CATEGORY } from './permissionCatalog'

const key = (value) => String(value || '').trim().toLowerCase()

export const STANDARD_PRESET_PREFIX = 'standard:'

export const isStandardPreset = (preset) => String(preset?.id || '').startsWith(STANDARD_PRESET_PREFIX)

const slug = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

/**
 * Built-in presets derived from the live permission catalog, so they always
 * match the permissions that exist: "Read only – all modules" and, for each
 * menu category, "<Category> – view only" and "<Category> – full access".
 * They are read-only, always Active and do not use a preset slot.
 */
export const buildStandardPresets = (groups) => {
  const categories = (groups?.categories || []).filter((group) => group.category !== CUSTOM_CATEGORY)
  const standardEntries = (group) =>
    group.modules.flatMap((module) => module.entries).filter((entry) => entry.isStandard)
  const viewNames = (entries) => entries.filter((entry) => entry.action === 'View').map((entry) => entry.permissionName)

  const presets = [
    {
      id: `${STANDARD_PRESET_PREFIX}read-only`,
      presetName: 'Read only – all modules',
      description: 'The View permission of every module. No create, edit, delete or workflow action.',
      permissionNames: viewNames(categories.flatMap(standardEntries)),
    },
  ]
  categories.forEach((group) => {
    const entries = standardEntries(group)
    presets.push(
      {
        id: `${STANDARD_PRESET_PREFIX}${slug(group.category)}:view`,
        presetName: `${group.category} – view only`,
        description: `The View permissions of the ${group.category} menu.`,
        permissionNames: viewNames(entries),
      },
      {
        id: `${STANDARD_PRESET_PREFIX}${slug(group.category)}:full`,
        presetName: `${group.category} – full access`,
        description: `Every permission of the ${group.category} menu: view, create, edit, delete and workflow actions.`,
        permissionNames: entries.map((entry) => entry.permissionName),
      }
    )
  })

  return presets
    .filter((preset) => preset.permissionNames.length > 0)
    .map((preset) => ({
      ...preset,
      type: 'Standard',
      status: 'Active',
      timesApplied: null,
      lastAppliedAt: '',
      createdAt: '',
      createdBy: 'System',
      updatedAt: '',
      updatedBy: '',
    }))
}

/**
 * Split a preset's permissions by what can be done with them right now:
 *   assignable – active permissions the current user may grant (entries)
 *   inactive   – permissions deactivated in Permission Master (names)
 *   unknown    – names not found (deleted, renamed, or not visible without View Permission)
 *   outOfScope – active permissions the current user does not hold (non-administrators)
 */
export const resolvePreset = (preset, groups, canAssign = () => true) => {
  const result = { assignable: [], inactive: [], unknown: [], outOfScope: [] }
  const seen = new Set()
  for (const name of preset?.permissionNames || []) {
    const lowered = key(name)
    if (!lowered || seen.has(lowered)) continue
    seen.add(lowered)
    const entry = groups?.infoByName?.get(lowered)
    if (!entry || !entry.permission) {
      result.unknown.push(entry?.permissionName || String(name).trim())
    } else if (String(entry.permission.status || 'Active') !== 'Active') {
      result.inactive.push(entry.permissionName)
    } else if (!canAssign(entry)) {
      result.outOfScope.push(entry.permissionName)
    } else {
      result.assignable.push(entry)
    }
  }
  result.assignable.sort((a, b) => a.order - b.order)
  return result
}

/** Module names covered by a preset, in menu order. */
export const presetModules = (preset, groups) => {
  const modules = []
  const seen = new Set()
  const entries = (preset?.permissionNames || [])
    .map((name) => groups?.infoByName?.get(key(name)))
    .filter(Boolean)
    .sort((a, b) => a.order - b.order)
  for (const entry of entries) {
    if (!seen.has(entry.moduleName)) {
      seen.add(entry.moduleName)
      modules.push(entry.moduleName)
    }
  }
  return modules
}

/** Display-case permission names for a Set of lower-cased names. */
export const namesFromSelection = (selection, groups) =>
  [...(selection || [])].map((lowered) => groups?.infoByName?.get(lowered)?.permissionName || lowered)

/** Lower-cased keys of preset entries. */
export const entryKeys = (entries) => entries.map((entry) => key(entry.permissionName))

/** New selection after staging a preset in `replace` or `add` mode. */
export const stageSelection = (selection, entries, mode) => {
  const incoming = entryKeys(entries)
  return mode === 'replace' ? new Set(incoming) : new Set([...(selection || []), ...incoming])
}

/** How a preset would change a selection: replace adds / removes, add only adds. */
export const selectionDelta = (selection, entries) => {
  const current = selection || new Set()
  const incoming = new Set(entryKeys(entries))
  return {
    adds: [...incoming].filter((name) => !current.has(name)).length,
    removes: [...current].filter((name) => !incoming.has(name)).length,
  }
}

/**
 * Permission ids to save for one role.
 * `assigned` = the role's current permissions [{ id, permissionName, status }].
 * Inactive permissions cannot be (re)assigned by the API, so they drop out –
 * the same rule as saving from the permission matrix.
 */
export const planRoleApplication = ({ assigned = [], entries = [], mode = 'replace' }) => {
  const current = new Map(assigned.map((permission) => [key(permission.permissionName), permission]))
  const target = new Map()
  if (mode === 'add') {
    current.forEach((permission, lowered) => target.set(lowered, permission))
  }
  entries.forEach((entry) => {
    target.set(key(entry.permissionName), {
      id: entry.permission.id,
      permissionName: entry.permissionName,
      status: entry.permission.status,
    })
  })
  const savable = [...target.entries()].filter(([, permission]) => String(permission.status || 'Active') === 'Active')
  const savableKeys = new Set(savable.map(([lowered]) => lowered))
  return {
    permissionIds: savable.map(([, permission]) => permission.id),
    added: [...savableKeys].filter((lowered) => !current.has(lowered)).length,
    removed: [...current.keys()].filter((lowered) => !savableKeys.has(lowered)).length,
    total: savable.length,
  }
}

/** Why a role cannot receive permission changes from the current user ('' when it can). */
export const roleLockReason = ({ roleName, status, assigned = [], isAdmin, actorPermissionNames }) => {
  if (key(roleName) === 'admin') return 'The Admin role always has every permission (system managed).'
  if (status !== 'Active') return 'Only active roles can be changed.'
  if (!isAdmin && assigned.some((permission) => !actorPermissionNames.has(key(permission.permissionName)))) {
    return 'This role holds permissions you do not have.'
  }
  return ''
}

/**
 * "View Location, Create Location" ↔ ['View Location', 'Create Location'] (import / export).
 * Exports join with commas: the CSV export quotes such a cell, so it survives
 * a CSV round trip (the CSV reader also treats an unquoted ";" as a delimiter).
 * Imports accept commas, semicolons and line breaks.
 */
export const splitPermissionNames = (value) =>
  String(value || '')
    .split(/[;,\n]/)
    .map((name) => name.trim())
    .filter(Boolean)

export const joinPermissionNames = (names = []) => names.join(', ')
