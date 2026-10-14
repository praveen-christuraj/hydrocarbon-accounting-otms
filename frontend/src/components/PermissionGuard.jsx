import { Link } from 'react-router-dom'
import { userHasPermission as checkUserPermission } from '../hooks/usePermissions'

/**
 * Route guard (owner rule 9).
 *  - requiredPermission   single permission
 *  - requiredPermissions  all of the listed permissions
 *  - anyOfPermissions     at least one of the listed permissions
 */
function PermissionGuard({
  loggedInUser,
  requiredPermission,
  requiredPermissions,
  anyOfPermissions,
  children,
  fallbackTitle = 'Access Denied',
  fallbackMessage = 'You do not have permission to access this page.',
}) {
  const currentUser = loggedInUser

  const userHasPermission = (permissionName) =>
    checkUserPermission(currentUser, permissionName)

  const permissionList =
    requiredPermissions && requiredPermissions.length > 0
      ? requiredPermissions
      : requiredPermission
        ? [requiredPermission]
        : []

  const anyList = Array.isArray(anyOfPermissions) ? anyOfPermissions.filter(Boolean) : []

  const hasAllPermissions = permissionList.every((permissionName) => {
    return userHasPermission(permissionName)
  })
  const hasAnyPermission =
    anyList.length === 0 || anyList.some((permissionName) => userHasPermission(permissionName))

  if (!hasAllPermissions || !hasAnyPermission) {
    const missingText =
      !hasAllPermissions || anyList.length === 0
        ? `Required permission${permissionList.length > 1 ? 's' : ''}: ${permissionList.join(', ')}`
        : `Requires one of: ${anyList.join(', ')}`
    return (
      <div>
        <div className="page-title">
          <div>
            <h2>{fallbackTitle}</h2>
            <p>{fallbackMessage}</p>
          </div>
        </div>

        <div className="info-box">{missingText}</div>

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