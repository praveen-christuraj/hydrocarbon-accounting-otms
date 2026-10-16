import { apiDelete, apiGet, apiPost, apiPut } from './apiClient'

const convertPermissionFromApi = (permission) => {
  return {
    id: permission.id,
    permissionName: permission.permission_name,
    moduleName: permission.module_name,
    description: permission.description || '',
    status: permission.status,
    createdAt: permission.created_at,
    updatedAt: permission.updated_at,
  }
}

const convertPermissionToApi = (permission) => {
  return {
    permission_name: permission.permissionName,
    module_name: permission.moduleName,
    description: permission.description,
    status: permission.status,
  }
}

export const getPermissions = async (params = {}) => {
  const { skip = 0, limit = 200, search = '', moduleName = '' } = params
  let endpoint = `/permissions?skip=${skip}&limit=${limit}`
  if (search) endpoint += `&search=${encodeURIComponent(search)}`
  if (moduleName) endpoint += `&module_name=${encodeURIComponent(moduleName)}`
  const data = await apiGet(endpoint)
  return {
    items: (data.items || []).map(convertPermissionFromApi),
    total: data.total || 0,
    skip: data.skip || 0,
    limit: data.limit || limit,
    has_more: data.has_more || false,
  }
}

export const createPermission = async (permission) => {
  const data = await apiPost('/permissions', convertPermissionToApi(permission))
  return convertPermissionFromApi(data)
}

export const updatePermission = async (permissionId, permission) => {
  const data = await apiPut(
    `/permissions/${permissionId}`,
    convertPermissionToApi(permission)
  )

  return convertPermissionFromApi(data)
}

export const deletePermission = async (permissionId) => {
  return apiDelete(`/permissions/${permissionId}`)
}

/**
 * Load every permission. The API caps a page at 200 rows and the standard
 * catalog alone is close to that, so pages are fetched until `has_more` is
 * false.
 */
export const getAllPermissions = async () => {
  const pageSize = 200
  const items = []
  let skip = 0
  // Hard stop protects against a misbehaving API returning has_more forever.
  for (let page = 0; page < 50; page += 1) {
    const result = await getPermissions({ skip, limit: pageSize })
    items.push(...result.items)
    if (!result.has_more || result.items.length === 0) {
      return { items, total: result.total || items.length }
    }
    skip += result.items.length
  }
  return { items, total: items.length }
}

/**
 * Module-wise CRUD structure of the standard permissions:
 * { actions: ['View','Create','Edit','Delete','Other'], categories: [{ category, modules: [{ module_name, permissions: [{ permission_name, action, description }] }] }] }
 */
export const getPermissionCatalog = async () => {
  const data = await apiGet('/permissions/catalog')
  return {
    actions: data?.actions || ['View', 'Create', 'Edit', 'Delete', 'Other'],
    totalStandardPermissions: data?.total_standard_permissions || 0,
    categories: (data?.categories || []).map((category) => ({
      category: category.category,
      modules: (category.modules || []).map((module) => ({
        moduleName: module.module_name,
        permissions: (module.permissions || []).map((permission) => ({
          permissionName: permission.permission_name,
          action: permission.action,
          description: permission.description || '',
        })),
      })),
    })),
  }
}

export const seedStandardPermissions = async () => apiPost('/permissions/seed-standard', {})

/**
 * Read-only access decision diagnostic ("why can this user see this?").
 * Composes the four criteria of PERMISSION_CRITERIA_MODEL.md for one user and,
 * optionally, one operation ticket.
 */
export const getAccessDiagnostic = async ({ userId, transactionId = null, actionCode = null }) => {
  let endpoint = `/permissions/access-diagnostic?user_id=${encodeURIComponent(userId)}`
  if (transactionId !== null && transactionId !== undefined && String(transactionId).trim() !== '') {
    endpoint += `&transaction_id=${encodeURIComponent(transactionId)}`
  }
  if (actionCode) endpoint += `&action_code=${encodeURIComponent(actionCode)}`
  return apiGet(endpoint)
}
