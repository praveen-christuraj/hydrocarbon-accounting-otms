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