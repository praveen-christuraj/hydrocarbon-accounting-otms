import { apiDelete, apiGet, apiPost, apiPut } from './apiClient'

const convertRoleFromApi = (role) => {
  return {
    id: role.id,
    roleName: role.role_name,
    description: role.description || '',
    status: role.status,
    createdAt: role.created_at,
    updatedAt: role.updated_at,
  }
}

const convertRoleToApi = (role) => {
  return {
    role_name: role.roleName,
    description: role.description,
    status: role.status,
  }
}

export const getRoles = async () => {
  const data = await apiGet('/roles')
  return data.map(convertRoleFromApi)
}

export const createRole = async (role) => {
  const data = await apiPost('/roles', convertRoleToApi(role))
  return convertRoleFromApi(data)
}

export const updateRole = async (roleId, role) => {
  const data = await apiPut(`/roles/${roleId}`, convertRoleToApi(role))
  return convertRoleFromApi(data)
}

export const deleteRole = async (roleId) => {
  return apiDelete(`/roles/${roleId}`)
}