import { Link } from 'react-router-dom'

function PermissionGuard({
  loggedInUser,
  requiredPermission,
  requiredPermissions,
  children,
  fallbackTitle = 'Access Denied',
  fallbackMessage = 'You do not have permission to access this page.',
}) {
  const currentUser = loggedInUser

  const userHasPermission = (permissionName) => {
    // If no permission is required, allow
    if (!permissionName) {
      return true
    }

    // Must be logged in
    if (!currentUser) {
      return false
    }

    // ✅ Admin bypass (bootstrap): allow all if username is admin OR role is Admin
    const username = String(currentUser?.username || '').toLowerCase()
    if (username === 'admin') {
      return true
    }

    const roles = currentUser?.roles || currentUser?.user_roles || []
    const isAdmin = roles.some((r) => {
      const roleName =
        r?.role_name || r?.roleName || r?.role?.role_name || r?.role?.roleName
      return String(roleName || '').toLowerCase() === 'admin'
    })

    if (isAdmin) {
      return true
    }

    // Normal permission check (expects loggedInUser.permissions to be available)
    if (!currentUser.permissions || !Array.isArray(currentUser.permissions)) {
      return false
    }

    return currentUser.permissions.some((permission) => {
      return (
        permission?.permissionName === permissionName ||
        permission?.permission_name === permissionName
      )
    })
  }

  const permissionList =
    requiredPermissions && requiredPermissions.length > 0
      ? requiredPermissions
      : requiredPermission
        ? [requiredPermission]
        : []

  const hasAllPermissions = permissionList.every((permissionName) => {
    return userHasPermission(permissionName)
  })

  if (!hasAllPermissions) {
    return (
      <div>
        <div className="page-title">
          <div>
            <h2>{fallbackTitle}</h2>
            <p>{fallbackMessage}</p>
          </div>
        </div>

        <div className="info-box">
          Required permission{permissionList.length > 1 ? 's' : ''}:{' '}
          {permissionList.join(', ')}
        </div>

        <div className="form-actions">
          <Link to="/">
            <button type="button">Back to Dashboard</button>
          </Link>
        </div>
      </div>
    )
  }

  return children
}

export default PermissionGuard