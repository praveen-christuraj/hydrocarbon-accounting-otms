import { Link } from 'react-router-dom'

function PermissionGuard({
  loggedInUser,
  requiredPermission,
  requiredPermissions,
  children,
  fallbackTitle = 'Access Denied',
  fallbackMessage = 'You do not have permission to access this page.',
}) {
  const userHasPermission = (permissionName) => {
    if (!permissionName) {
      return true
    }

    if (!loggedInUser || !loggedInUser.permissions) {
      return false
    }

    return loggedInUser.permissions.some((permission) => {
      return permission.permissionName === permissionName
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
          Required permission
          {permissionList.length > 1 ? 's' : ''}:{' '}
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