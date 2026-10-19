import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import PageHeader from '../components/common/PageHeader'
import Icon from '../components/common/Icon'
import usePermissions from '../hooks/usePermissions'
import { getSecurityOverview } from '../api/securityApi'
import { logUiAction } from '../utils/actionLogger'
import PasswordResetRequestsPanel from '../components/security/PasswordResetRequestsPanel'
import UserSecurityPanel from '../components/security/UserSecurityPanel'

const TABS = [
  {
    key: 'accounts',
    label: 'User accounts',
    description: 'Lock state, password status and two-factor coverage for every account.',
  },
  {
    key: 'requests',
    label: 'Password reset requests',
    description: 'Self-service reset requests raised from the sign-in page.',
  },
]

function SecurityConsole({ loggedInUser }) {
  const { hasPermission } = usePermissions(loggedInUser)
  const navigate = useNavigate()
  const location = useLocation()

  const canView = hasPermission('View User Security')
  const canViewOwn = hasPermission('View Own Security Settings') || canView
  const [activeTab, setActiveTab] = useState('accounts')
  const [overview, setOverview] = useState(null)

  const initialUserId = useMemo(() => {
    const params = new URLSearchParams(location.search)
    const value = Number(params.get('user_id'))
    return Number.isFinite(value) && value > 0 ? value : null
  }, [location.search])

  const loadOverview = useCallback(async () => {
    if (!canView) return
    try {
      setOverview(await getSecurityOverview())
    } catch {
      /* the panels surface their own errors */
    }
  }, [canView])

  useEffect(() => {
    loadOverview()
  }, [loadOverview])

  const pendingRequests = overview?.pendingPasswordResetRequests || 0
  const lockedUsers = overview?.lockedUsers || 0

  const switchTab = (key) => {
    if (key === activeTab) return
    setActiveTab(key)
    logUiAction('Profile & Security', 'Switch Security Console Tab', { tab: key })
  }

  return (
    <div>
      <PageHeader
        title="Security Console"
        description="Enterprise account security: locked accounts, password resets, two-factor enforcement and the self-service reset queue."
        count={canView && overview ? `${overview.totalUsers} accounts` : undefined}
        actions={
          canViewOwn ? (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => navigate('/profile-security')}
            >
              <Icon name="user" size={15} />
              My security
            </button>
          ) : null
        }
      />

      {canView && (
        <div className="security-metric-grid security-metric-grid-4">
          <div className="security-summary-tile">
            <span className="security-summary-label">Locked accounts</span>
            <strong className={lockedUsers > 0 ? 'is-danger' : ''}>{lockedUsers}</strong>
            <span className="security-muted-text">
              {overview?.automaticLockedUsers ?? 0} automatic ·{' '}
              {overview?.administrativelyLockedUsers ?? 0} administrative
            </span>
          </div>
          <div className="security-summary-tile">
            <span className="security-summary-label">Pending reset requests</span>
            <strong className={pendingRequests > 0 ? 'is-warning' : ''}>{pendingRequests}</strong>
            <span className="security-muted-text">Awaiting administrator action</span>
          </div>
          <div className="security-summary-tile">
            <span className="security-summary-label">2FA coverage</span>
            <strong>{overview ? `${overview.twoFactorEnabledUsers}/${overview.totalUsers}` : '—'}</strong>
            <span className="security-muted-text">
              {overview?.twoFactorRequiredUsers ?? 0} accounts where 2FA is mandatory
            </span>
          </div>
          <div className="security-summary-tile">
            <span className="security-summary-label">Password attention</span>
            <strong className={overview?.passwordChangeRequiredUsers ? 'is-warning' : ''}>
              {overview?.passwordChangeRequiredUsers ?? 0}
            </strong>
            <span className="security-muted-text">
              {overview?.passwordExpiredUsers ?? 0} expired passwords
            </span>
          </div>
        </div>
      )}

      <div className="list-tabs security-console-tabs" role="tablist" aria-label="Security console views">
        {TABS.map((tab) => {
          const selected = activeTab === tab.key
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={selected}
              className="list-tab"
              onClick={() => switchTab(tab.key)}
            >
              {tab.label}
              {tab.key === 'requests' && pendingRequests > 0 && (
                <span className="security-console-tab-count">{pendingRequests}</span>
              )}
              {tab.key === 'accounts' && lockedUsers > 0 && (
                <span className="security-console-tab-count">{lockedUsers}</span>
              )}
            </button>
          )
        })}
      </div>

      <p className="security-console-hint">
        {TABS.find((tab) => tab.key === activeTab)?.description}
      </p>

      {activeTab === 'accounts' ? (
        <UserSecurityPanel
          key={initialUserId || 'all'}
          loggedInUser={loggedInUser}
          onSecurityChanged={loadOverview}
          initialUserId={initialUserId}
        />
      ) : (
        <PasswordResetRequestsPanel
          loggedInUser={loggedInUser}
          onSecurityChanged={loadOverview}
        />
      )}
    </div>
  )
}

export default SecurityConsole
