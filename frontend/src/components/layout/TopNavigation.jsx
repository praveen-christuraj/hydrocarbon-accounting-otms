import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import Icon from '../common/Icon'
import { findNavigationItem, navigationItems } from '../../data/navigationItems'
import { usePermissions } from '../../hooks/usePermissions'
import { getMyReports } from '../../api/reportBuilderApi'

/**
 * Top-side navigation with dropdown menus (owner rule 3).
 *
 * - Click a group to open its menu (hover also opens after a short intent delay)
 * - Escape, outside click or route change closes menus
 * - Arrow keys move between top-level groups and within a menu
 * - The active route and its group are underlined in navy
 * - Items are filtered by RBAC permissions (admin sees everything)
 */
function TopNavigation({ loggedInUser }) {
  const { isAdmin, hasPermission } = usePermissions(loggedInUser)
  const location = useLocation()
  // Menus close automatically on navigation: the open index is only valid for
  // the path it was opened on.
  const [openState, setOpenState] = useState({ index: null, path: location.pathname })
  const openIndex = openState.path === location.pathname ? openState.index : null
  const setOpenIndex = useCallback(
    (value) => {
      setOpenState((current) => ({
        index: typeof value === 'function' ? value(current.index) : value,
        path: location.pathname,
      }))
    },
    [location.pathname]
  )
  const navRef = useRef(null)
  const hoverTimer = useRef(null)

  const hasRequiredPermissions = useCallback(
    (item) => {
      if (isAdmin) return true
      if (item.requiredPermissions && item.requiredPermissions.length > 0) {
        return item.requiredPermissions.every((name) => hasPermission(name))
      }
      if (item.anyPermission && item.anyPermission.length > 0) {
        return item.anyPermission.some((name) => hasPermission(name))
      }
      if (item.requiredPermission) return hasPermission(item.requiredPermission)
      if (item.permission) return hasPermission(item.permission)
      return true
    },
    [isAdmin, hasPermission]
  )

  const close = useCallback(() => setOpenIndex(null), [setOpenIndex])

  // Close on outside click / Escape
  useEffect(() => {
    if (openIndex === null) return undefined
    const handlePointer = (event) => {
      if (navRef.current && !navRef.current.contains(event.target)) close()
    }
    const handleKey = (event) => {
      if (event.key === 'Escape') {
        close()
        const button = navRef.current?.querySelector(`[data-nav-index="${openIndex}"]`)
        button?.focus()
      }
    }
    document.addEventListener('mousedown', handlePointer)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handlePointer)
      document.removeEventListener('keydown', handleKey)
    }
  }, [openIndex, close])

  useEffect(() => () => window.clearTimeout(hoverTimer.current), [])

  // Published Report Builder reports shared with this user become their own
  // Reporting-menu entries (refreshed when the route changes, so a report
  // published a moment ago appears without a full reload).
  const [customReportItems, setCustomReportItems] = useState([])
  const canViewCustomReports = isAdmin || hasPermission('View Custom Report')
  useEffect(() => {
    if (!canViewCustomReports) {
      setCustomReportItems([])
      return undefined
    }
    let cancelled = false
  // eslint-disable-next-line react-hooks/set-state-in-effect
    getMyReports()
      .then((reports) => {
        if (cancelled) return
        setCustomReportItems(
          (reports || []).map((report) => ({
            label: report.report_name,
            path: `/reporting/custom-reports/${report.id}`,
            permission: 'View Custom Report',
            customReport: true,
          }))
        )
      })
      .catch(() => {
        if (!cancelled) setCustomReportItems([])
      })
    return () => { cancelled = true }
  }, [canViewCustomReports, location.pathname])

  const visibleGroups = navigationItems
    .map((navItem, index) => {
      if (navItem.type === 'link') {
        return hasRequiredPermissions(navItem) ? { ...navItem, index } : null
      }
      const sourceItems = navItem.label === 'Reporting'
        ? [...navItem.items, ...customReportItems]
        : navItem.items
      const items = isAdmin
        ? sourceItems.filter((item) => !item.disabled)
        : sourceItems.filter((item) => !item.disabled && hasRequiredPermissions(item))
      return items.length > 0 ? { ...navItem, items, index } : null
    })
    .filter(Boolean)

  // The active item is the one whose path best matches the URL, so that
  // /export-operations/permits does not also highlight /export-operations.
  const activeMatch = findNavigationItem(location.pathname)
  const activePath = activeMatch?.item?.path || null
  const isGroupActive = (group) =>
    group.type !== 'link' && group.items.some((item) => item.path && item.path === activePath)

  const handleHoverOpen = (index) => {
    if (openIndex === null) return // hover only switches menus once one is open
    window.clearTimeout(hoverTimer.current)
    hoverTimer.current = window.setTimeout(() => setOpenIndex(index), 60)
  }

  const handleTopKeyDown = (event, position) => {
    const buttons = Array.from(navRef.current?.querySelectorAll('[data-nav-top]') || [])
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault()
      const delta = event.key === 'ArrowRight' ? 1 : -1
      const next = buttons[(position + delta + buttons.length) % buttons.length]
      next?.focus()
      if (openIndex !== null) {
        const nextIndex = Number(next?.getAttribute('data-nav-index'))
        setOpenIndex(Number.isNaN(nextIndex) ? null : nextIndex)
      }
    } else if (event.key === 'ArrowDown') {
      const index = Number(event.currentTarget.getAttribute('data-nav-index'))
      if (!Number.isNaN(index)) {
        event.preventDefault()
        setOpenIndex(index)
        window.setTimeout(() => {
          navRef.current?.querySelector(`[data-nav-menu="${index}"] a`)?.focus()
        }, 0)
      }
    }
  }

  const handleMenuKeyDown = (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const links = Array.from(event.currentTarget.querySelectorAll('a'))
    const current = links.indexOf(document.activeElement)
    const delta = event.key === 'ArrowDown' ? 1 : -1
    const next = links[(current + delta + links.length) % links.length]
    next?.focus()
  }

  return (
    <nav className="top-nav no-print" aria-label="Main navigation" ref={navRef}>
      <ul className="top-nav-list">
        {visibleGroups.map((group, position) => {
          if (group.type === 'link') {
            return (
              <li key={group.label} className="top-nav-item">
                <NavLink
                  to={group.path}
                  end={group.path === '/'}
                  className={({ isActive }) =>
                    `top-nav-link ${isActive ? 'is-active' : ''}`.trim()
                  }
                  data-nav-top="true"
                  onKeyDown={(event) => handleTopKeyDown(event, position)}
                >
                  {group.label}
                </NavLink>
              </li>
            )
          }

          const open = openIndex === group.index
          const active = isGroupActive(group)

          return (
            <li
              key={group.label}
              className={`top-nav-item has-menu ${open ? 'is-open' : ''}`.trim()}
              onMouseEnter={() => handleHoverOpen(group.index)}
            >
              <button
                type="button"
                className={`top-nav-link top-nav-button ${active ? 'is-active' : ''} ${open ? 'is-open' : ''}`.trim()}
                aria-haspopup="menu"
                aria-expanded={open}
                aria-controls={`top-nav-menu-${group.index}`}
                data-nav-top="true"
                data-nav-index={group.index}
                onClick={() => setOpenIndex(open ? null : group.index)}
                onKeyDown={(event) => handleTopKeyDown(event, position)}
              >
                {group.label}
                <Icon name="chevronDown" size={14} className="top-nav-chevron" />
              </button>

              {open && (
                <div
                  id={`top-nav-menu-${group.index}`}
                  className="top-nav-menu"
                  role="menu"
                  data-nav-menu={group.index}
                  onKeyDown={handleMenuKeyDown}
                >
                  {group.items.map((item) => {
                    const itemActive = Boolean(item.path) && item.path === activePath
                    return (
                      <Link
                        key={item.path || item.label}
                        to={item.path}
                        role="menuitem"
                        className={`top-nav-menu-item ${itemActive ? 'is-active' : ''}`.trim()}
                        onClick={close}
                      >
                        {item.label}
                      </Link>
                    )
                  })}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

export default TopNavigation
