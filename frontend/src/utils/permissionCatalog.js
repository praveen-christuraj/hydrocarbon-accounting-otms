/**
 * Module-wise permission structure shared by Permission Master,
 * Role Permission Assignment and Access Summary.
 *
 * The backend catalog (GET /permissions/catalog) defines categories (same as the
 * top menu), modules and each permission's action (View / Create / Edit /
 * Delete / Other). Database permissions are matched to it by name. Custom
 * permissions created in Permission Master are placed in their module's row
 * when the module is known, otherwise under "Custom Permissions".
 */

export const CRUD_ACTIONS = ['View', 'Create', 'Edit', 'Delete']
export const ACTION_ORDER = [...CRUD_ACTIONS, 'Other']
export const CUSTOM_CATEGORY = 'Custom Permissions'

const key = (value) => String(value || '').trim().toLowerCase()

export const permissionNameOf = (permission) =>
  permission?.permissionName ?? permission?.permission_name ?? ''

export const actionFromName = (name) => {
  const first = String(name || '').trim().split(/\s+/)[0]
  return CRUD_ACTIONS.includes(first) ? first : 'Other'
}

const emptyModule = (category, moduleName) => ({
  category,
  moduleName,
  key: `${category}::${moduleName}`,
  cells: { View: null, Create: null, Edit: null, Delete: null },
  other: [],
  entries: [],
})

const placeEntry = (module, entry, preferredAction) => {
  const action = preferredAction || entry.action
  if (CRUD_ACTIONS.includes(action) && !module.cells[action]) {
    module.cells[action] = entry
    entry.action = action
  } else {
    module.other.push(entry)
    entry.action = CRUD_ACTIONS.includes(action) ? action : 'Other'
  }
  module.entries.push(entry)
}

/**
 * @param {object|null} catalog  result of getPermissionCatalog()
 * @param {Array} permissions    database permissions ({ id, permissionName, moduleName, description, status })
 * @returns {{ categories: Array, entries: Array, infoByName: Map }}
 *   categories: [{ category, modules: [{ moduleName, cells: {View,Create,Edit,Delete}, other: [], entries: [] }] }]
 *   entry: { permissionName, action, description, isStandard, permission (db row | null), category, moduleName, order }
 */
export function buildPermissionGroups(catalog, permissions = []) {
  const dbByName = new Map()
  for (const permission of permissions || []) {
    const name = key(permissionNameOf(permission))
    if (name && !dbByName.has(name)) dbByName.set(name, permission)
  }

  const categories = []
  const moduleByName = new Map()
  const standardNames = new Set()
  let order = 0

  for (const category of catalog?.categories || []) {
    const categoryGroup = { category: category.category, modules: [] }
    categories.push(categoryGroup)
    for (const module of category.modules || []) {
      const moduleGroup = emptyModule(category.category, module.moduleName)
      categoryGroup.modules.push(moduleGroup)
      moduleByName.set(key(module.moduleName), moduleGroup)
      for (const permission of module.permissions || []) {
        standardNames.add(key(permission.permissionName))
        placeEntry(moduleGroup, {
          permissionName: permission.permissionName,
          action: permission.action,
          description: permission.description,
          isStandard: true,
          permission: dbByName.get(key(permission.permissionName)) || null,
          category: category.category,
          moduleName: module.moduleName,
          order: order++,
        }, permission.action)
      }
    }
  }

  // Custom (non-catalog) permissions.
  const customCategory = { category: CUSTOM_CATEGORY, modules: [] }
  const customModules = new Map()
  const customPermissions = (permissions || [])
    .filter((permission) => !standardNames.has(key(permissionNameOf(permission))))
    .sort((a, b) =>
      String(a.moduleName || '').localeCompare(String(b.moduleName || '')) ||
      String(permissionNameOf(a)).localeCompare(String(permissionNameOf(b)))
    )

  for (const permission of customPermissions) {
    const name = permissionNameOf(permission)
    const moduleName = String(permission.moduleName || permission.module_name || 'General').trim() || 'General'
    let moduleGroup = moduleByName.get(key(moduleName))
    if (!moduleGroup) {
      moduleGroup = customModules.get(key(moduleName))
      if (!moduleGroup) {
        moduleGroup = emptyModule(CUSTOM_CATEGORY, moduleName)
        customModules.set(key(moduleName), moduleGroup)
        customCategory.modules.push(moduleGroup)
      }
    }
    placeEntry(moduleGroup, {
      permissionName: name,
      action: actionFromName(name),
      description: permission.description || '',
      isStandard: false,
      permission,
      category: moduleGroup.category,
      moduleName: moduleGroup.moduleName,
      order: 100000 + order++,
    })
  }

  if (customCategory.modules.length > 0) categories.push(customCategory)

  const entries = []
  const infoByName = new Map()
  for (const category of categories) {
    for (const module of category.modules) {
      for (const entry of module.entries) {
        entries.push(entry)
        infoByName.set(key(entry.permissionName), entry)
      }
    }
  }
  entries.sort((a, b) => a.order - b.order)

  return { categories, entries, infoByName }
}

/** Database permissions enriched with category / action / type, in menu order. */
export function permissionRows(groups) {
  const actionRank = (action) => {
    const index = ACTION_ORDER.indexOf(action)
    return index === -1 ? ACTION_ORDER.length : index
  }
  return groups.entries
    .filter((entry) => entry.permission)
    .map((entry) => ({
      ...entry.permission,
      category: entry.category,
      moduleName: entry.permission.moduleName || entry.moduleName,
      action: entry.action,
      type: entry.isStandard ? 'Standard' : 'Custom',
      isStandard: entry.isStandard,
      sortOrder: entry.order * 10 + actionRank(entry.action),
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder)
}

export const isStandardPermission = (groups, permissionName) =>
  Boolean(groups.infoByName.get(key(permissionName))?.isStandard)
