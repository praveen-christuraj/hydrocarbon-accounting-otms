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

export const getPermissions = async () => {
  const data = await apiGet('/permissions')
  return data.map(convertPermissionFromApi)
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