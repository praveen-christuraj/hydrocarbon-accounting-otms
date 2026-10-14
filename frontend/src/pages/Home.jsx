import { Link } from 'react-router-dom'
import Icon from '../components/common/Icon'

const dashboardCards = [
  {
    title: 'User Master',
    description: 'Users',
    path: '/users',
    permission: 'View User',
    group: 'User Management',
    icon: 'user',
  },
  {
    title: 'Role Master',
    description: 'Roles',
    path: '/roles',
    permission: 'View Role',
    group: 'User Management',
    icon: 'shield',
  },
  {
    title: 'Permission Master',
    description: 'Permissions',
    path: '/permissions',
    permission: 'View Permission',
    group: 'User Management',
    icon: 'key',
  },
  {
    title: 'Role Permissions',
    description: 'Role access',
    path: '/role-permissions',
    permission: 'View Role Permission Assignment',
    group: 'User Management',
    icon: 'shieldCheck',
  },
  {
    title: 'User Roles',
    description: 'User access',
    path: '/user-roles',
    permission: 'View User Role Assignment',
    group: 'User Management',
    icon: 'users',
  },
  {
    title: 'User Locations',
    description: 'Location access',
    path: '/user-locations',
    permission: 'View User Location Assignment',
    group: 'User Management',
    icon: 'mapPin',
  },
  {
    title: 'Access Summary',
    description: 'RBAC summary',
    path: '/access-summary',
    permission: 'View Access Summary',
    group: 'User Management',
    icon: 'clipboardList',
  },
  {
    title: 'Location Master',
    description: 'Locations',
    path: '/locations',
    permission: 'View Location',
    group: 'Master Data',
    icon: 'globe',
  },
  {
    title: 'Asset Type',
    description: 'Asset categories',
    path: '/asset-types',
    permission: 'View Asset Type',
    group: 'Master Data',
    icon: 'tag',
  },
  {
    title: 'Asset Master',
    description: 'Asset registry',
    path: '/assets',
    permission: 'View Asset',
    group: 'Master Data',
    icon: 'factory',
  },
  {
    title: 'Calibration Templates',
    description: 'Table structures',
    path: '/calibration-templates',
    permission: 'View Calibration Template',
    group: 'Master Data',
    icon: 'ruler',
  },
  {
    title: 'Asset Calibration',
    description: 'Calibration data',
    path: '/asset-calibrations',
    permission: 'View Asset Calibration',
    group: 'Master Data',
    icon: 'barChart',
  },
  {
    title: 'Table 11 Factors',
    description: 'API60/LT factors',
    path: '/table11-factors',
    permission: 'View Asset Calibration',
    group: 'Master Data',
    icon: 'calculator',
  },
  {
    title: 'Asset Assignment',
    description: 'Asset deployment',
    path: '/asset-assignments',
    permission: 'View Asset Assignment',
    group: 'Master Data',
    icon: 'repeat',
  },
  {
    title: 'Assignment Summary',
    description: 'Current deployment',
    path: '/asset-assignment-summary',
    permission: 'View Asset Assignment Summary',
    group: 'Master Data',
    icon: 'folder',
  },
  {
    title: 'Operation Types',
    description: 'Operation setup',
    path: '/operation-types',
    permission: 'View Operation Type',
    group: 'Operations',
    icon: 'settings',
  },
  {
    title: 'Operation Availability',
    description: 'Location mapping',
    path: '/location-operation-availability',
    permission: 'View Location Operation Availability',
    group: 'Operations',
    icon: 'compass',
  },
  {
    title: 'Operation Templates',
    description: 'Entry templates',
    path: '/operation-templates',
    permission: 'View Operation Template',
    group: 'Operations',
    icon: 'fileText',
  },
  {
    title: 'Operation Entry',
    description: 'Create ticket',
    path: '/operation-entry',
    permission: 'Create Operation Entry',
    group: 'Operations',
    icon: 'filePlus',
  },
  {
    title: 'Transaction Register',
    description: 'Tickets & approval',
    path: '/operation-transactions',
    permission: 'View Operation Transaction',
    group: 'Operations',
    icon: 'list',
  },
]

function Home({ hasPermission }) {
  const canViewCard = (card) => {
    if (!card.permission) {
      return true
    }

    if (typeof hasPermission !== 'function') {
      return true
    }

    return hasPermission(card.permission)
  }

  const visibleCards = dashboardCards.filter(canViewCard)

  const groupedCards = visibleCards.reduce((groups, card) => {
    if (!groups[card.group]) {
      groups[card.group] = []
    }

    groups[card.group].push(card)
    return groups
  }, {})

  return (
    <div>
      <div className="page-title">
        <div>
          <h2>Dashboard</h2>
          <p>Select an available module to continue.</p>
        </div>

        <span className="record-count">
          {visibleCards.length} Available Modules
        </span>
      </div>

      {visibleCards.length === 0 ? (
        <div className="info-box">
          No dashboard modules are available for your current role. Please contact
          an administrator to review your permissions.
        </div>
      ) : (
        Object.entries(groupedCards).map(([groupName, cards]) => (
          <div key={groupName}>
            <div className="section-title compact-dashboard-section">
              <h3>{groupName}</h3>
            </div>

            <div className="dashboard-tile-grid">
              {cards.map((card) => (
                <Link key={card.path} to={card.path} className="dashboard-tile">
                  <div className="dashboard-tile-icon" aria-hidden="true"><Icon name={card.icon} size={20} /></div>

                  <div className="dashboard-tile-content">
                    <h3>{card.title}</h3>
                    <p>{card.description}</p>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  )
}

export default Home