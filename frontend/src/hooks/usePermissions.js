import { createContext, useContext, useMemo } from 'react'

/**
 * Single source of truth for RBAC checks in the frontend.
 *
 * Pages historically received `loggedInUser` as a prop and re-implemented the
 * admin bootstrap / permission matching logic. New code should call
 * `usePermissions()` (reads the logged-in user from AuthContext) or
 * `usePermissions(loggedInUser)` when the user object is already at hand.
 */

export const AuthContext = createContext({ loggedInUser: null })

export const AuthProvider = AuthContext.Provider

export const useAuth = () => useContext(AuthContext)

const normalise = (value) => String(value || '').trim().toLowerCase()

export const isAdminUser = (user) => {
  if (!user) return false
  if (normalise(user.username) === 'admin') return true

  const roles = user.roles || user.user_roles || []
  if (
    Array.isArray(roles) &&
    roles.some((role) => {
      const name =
        role?.role_name || role?.roleName || role?.role?.role_name || role?.role?.roleName
      return normalise(name) === 'admin'
    })
  ) {
    return true
  }

  const singleRole =
    user.role?.role_name || user.role?.roleName || user.role_name || user.roleName
  return normalise(singleRole) === 'admin'
}

export const userHasPermission = (user, permissionName) => {
  if (!permissionName) return true
  if (!user) return false
  if (isAdminUser(user)) return true
  if (!Array.isArray(user.permissions)) return false
  return user.permissions.some(
    (permission) =>
      permission?.permissionName === permissionName ||
      permission?.permission_name === permissionName
  )
}

export const usePermissions = (explicitUser) => {
  const { loggedInUser } = useAuth()
  const user = explicitUser || loggedInUser

  return useMemo(() => {
    const hasPermission = (permissionName) => userHasPermission(user, permissionName)
    return {
      user,
      isAdmin: isAdminUser(user),
      hasPermission,
      hasAll: (names = []) => names.every(hasPermission),
      hasAny: (names = []) => names.some(hasPermission),
    }
  }, [user])
}

export default usePermissions
