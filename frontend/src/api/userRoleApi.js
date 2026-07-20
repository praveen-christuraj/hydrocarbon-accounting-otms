import { apiDelete, apiGet, apiPost } from './apiClient'

const convertUserRoleFromApi = (assignment) => {
  return {
    id: assignment.id,
    userId: assignment.user_id,
    fullName: assignment.full_name,
    username: assignment.username,
    roleId: assignment.role_id,
    roleName: assignment.role_name,
  }
}

export const getUserRoleAssignments = async () => {
  const data = await apiGet('/user-roles')
  return data.map(convertUserRoleFromApi)
}

export const saveUserRole = async (userId, roleId) => {
  const data = await apiPost('/user-roles', {
    user_id: Number(userId),
    role_id: Number(roleId),
  })

  return convertUserRoleFromApi(data)
}

export const deleteUserRole = async (assignmentId) => {
  return apiDelete(`/user-roles/${assignmentId}`)
}