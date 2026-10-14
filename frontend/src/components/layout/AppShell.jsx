import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import TopNavigation from './TopNavigation'
import UserMenu from './UserMenu'
import SystemNotificationCenter from '../SystemNotificationCenter'
import { logUiAction } from '../../utils/actionLogger'
import { findNavigationItem, hiddenRouteLabels } from '../../data/navigationItems'

const routeLabel = (pathname) => {
  if (hiddenRouteLabels[pathname]) return hiddenRouteLabels[pathname]
  const match = findNavigationItem(pathname)
  return match ? match.item.label : pathname
}

/**
 * Application frame: brand bar with utilities, top navigation with dropdown
 * menus (owner rule 3), notification banners, page content.
 */
function AppShell({ loggedInUser, onLogout, children }) {
  const location = useLocation()
  const [utilitySlot, setUtilitySlot] = useState(null)

  // Owner rule 1 – every page visit is logged.
  useEffect(() => {
    logUiAction(routeLabel(location.pathname), 'Open Page', { path: location.pathname })
  }, [location.pathname])

  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>

      <header className="app-topbar no-print">
        <div className="app-topbar-inner">
          <Link to="/" className="app-brand" aria-label="Hydrocarbon Accounting System – home">
            <span className="app-brand-mark" aria-hidden="true">
              HA
            </span>
            <span className="app-brand-text">
              <strong>Hydrocarbon Accounting System</strong>
              <span>Operations, terminals &amp; material balance</span>
            </span>
          </Link>

          <div className="app-topbar-utilities">
            <div className="app-topbar-slot" ref={setUtilitySlot} />
            <UserMenu loggedInUser={loggedInUser} onLogout={onLogout} />
          </div>
        </div>

        <div className="app-navbar">
          <div className="app-navbar-inner">
            <TopNavigation loggedInUser={loggedInUser} />
          </div>
        </div>
      </header>

      <SystemNotificationCenter loggedInUser={loggedInUser} toplineContainer={utilitySlot} />

      <main id="main-content" className="main-content" tabIndex={-1}>
        {children}
      </main>

      <footer className="app-footer no-print">
        <span>Hydrocarbon Accounting System</span>
        <span>
          Signed in as {loggedInUser?.username}
          {' · '}
          every change is recorded in the audit log
        </span>
      </footer>
    </div>
  )
}

export default AppShell
