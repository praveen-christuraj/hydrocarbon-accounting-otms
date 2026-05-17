import { apiGet, apiPost } from './apiClient'

const convertRolePermissionFromApi = (item) => {
  return {
    roleId: item.role_id,
    roleName: item.role_name,
    permissions: item.permissions.map((permission) => ({
      id: permission.permission_id,
      permissionName: permission.permission_name,
      moduleName: permission.module_name,
      description: permission.description || '',
      status: permission.status,
    })),
  }
}

export const getAllRolePermissions = async () => {
  const data = await apiGet('/role-permissions')
  return data.map(convertRolePermissionFromApi)
}

export const getRolePermissions = async (roleId) => {
  const data = await apiGet(`/role-permissions/${roleId}`)
  return convertRolePermissionFromApi(data)
}

export const saveRolePermissions = async (roleId, permissionIds) => {
  const data = await apiPost(`/role-permissions/${roleId}`, {
    permission_ids: permissionIds,
  })

  return convertRolePermissionFromApi(data)
}