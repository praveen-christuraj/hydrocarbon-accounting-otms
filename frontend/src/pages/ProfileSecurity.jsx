import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import PageHeader from '../components/common/PageHeader'
import AlertMessage from '../components/common/AlertMessage'
import Icon from '../components/common/Icon'
import usePermissions from '../hooks/usePermissions'
import MySecurityPanel from '../components/security/MySecurityPanel'

/**
 * Profile & Security – the signed-in user's own security page.
 *
 * Owner permissions:
 *   View Own Security Settings / Edit Own Security Settings
 * Administrator console (other users) lives on /security.
 */
function ProfileSecurity({ loggedInUser, users = [], onUserRefresh }) {
  const { hasPermission } = usePermissions(loggedInUser)
  const navigate = useNavigate()
  const [expiryDismissed, setExpiryDismissed] = useState(false)

  const security = loggedInUser?.security || {}
  const canViewConsole = hasPermission('View User Security')
  const passwordExpired = Boolean(security.passwordExpired)
  const forcePasswordChange = Boolean(security.forcePasswordChange)

  const refreshUser = useCallback(async () => {
    if (onUserRefresh) {
      await onUserRefresh()
    }
  }, [onUserRefresh])

  return (
    <div>
      <PageHeader
        title="Profile & Security"
        description="Your password, two-factor authentication, recovery codes and account security history."
        actions={
          canViewConsole ? (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => navigate('/security')}
            >
              <Icon name="shieldCheck" size={15} />
              Security console
            </button>
          ) : null
        }
      />

      {!expiryDismissed && (forcePasswordChange || passwordExpired) && (
        <AlertMessage
          tone={passwordExpired ? 'error' : 'warning'}
          title={passwordExpired ? 'Your password has expired' : 'Password change required'}
          message={
            passwordExpired
              ? 'Change your password now. Only this page, sign-out and two-factor recovery remain available until you do.'
              : 'Your administrator requires a new password before you continue using the system.'
          }
          onDismiss={() => setExpiryDismissed(true)}
        />
      )}

      <MySecurityPanel loggedInUser={loggedInUser} onUserRefresh={refreshUser} users={users} />
    </div>
  )
}

export default ProfileSecurity
