import { Link } from 'react-router-dom'
import Icon from '../components/common/Icon'
import { navigationItems } from '../data/navigationItems'

// Tile icon + one-line description per route. Tiles follow the top menu
// (data/navigationItems.js), so categories and permissions stay in sync.
const TILE_META = {
  '/users': { icon: 'user', description: 'Users' },
  '/roles': { icon: 'shield', description: 'Roles' },
  '/permissions': { icon: 'key', description: 'Module-wise permissions' },
  '/permission-presets': { icon: 'layers', description: 'Reusable permission sets' },
  '/role-permissions': { icon: 'shieldCheck', description: 'Role access matrix' },
  '/user-roles': { icon: 'users', description: 'User access' },
  '/user-locations': { icon: 'mapPin', description: 'Location access' },
  '/profile-security': { icon: 'lock', description: 'Password & 2FA' },
  '/access-summary': { icon: 'clipboardList', description: 'RBAC summary' },
  '/locations': { icon: 'globe', description: 'Locations' },
  '/asset-types': { icon: 'tag', description: 'Asset categories' },
  '/assets': { icon: 'factory', description: 'Asset registry' },
  '/prime-mover-tanker-links': { icon: 'link', description: 'Truck pairing' },
  '/calibration-templates': { icon: 'ruler', description: 'Table structures' },
  '/asset-calibrations': { icon: 'barChart', description: 'Calibration data' },
  '/asset-assignments': { icon: 'repeat', description: 'Asset deployment' },
  '/asset-assignment-summary': { icon: 'folder', description: 'Current deployment' },
  '/operation-types': { icon: 'settings', description: 'Operation setup' },
  '/tank-operations': { icon: 'droplet', description: 'Tank operations' },
  '/vessel-operations': { icon: 'ship', description: 'Vessel operations' },
  '/operation-templates': { icon: 'fileText', description: 'Entry templates' },
  '/operation-workflow-policies': { icon: 'workflow', description: 'Approval rules' },
  '/location-operation-availability': { icon: 'compass', description: 'Location mapping' },
  '/table11-factors': { icon: 'calculator', description: 'API60/LT factors' },
  '/company-report-profiles': { icon: 'building', description: 'Report branding' },
  '/barge-seal-master': { icon: 'anchor', description: 'Seal register' },
  '/location-accounting-day-settings': { icon: 'calendar', description: 'Accounting day' },
  '/material-balance-template-master': { icon: 'layers', description: 'Balance templates' },
  '/flowmeter-configs': { icon: 'gauge', description: 'Meter setup' },
  '/operation-entry': { icon: 'filePlus', description: 'Create ticket' },
  '/operation-transactions': { icon: 'list', description: 'Tickets & approval' },
  '/movement-mappings': { icon: 'repeat', description: 'Convoy mapping' },
  '/flowmeter-records': { icon: 'activity', description: 'Meter readings' },
  '/barge-tracking': { icon: 'anchor', description: 'Barge movements' },
  '/tanker-tracking': { icon: 'truck', description: 'Tanker movements' },
  '/shuttle-tracking': { icon: 'ship', description: 'Shuttle voyages' },
  '/fso-tracking': { icon: 'database', description: 'FSO voyages' },
  '/export-operations': { icon: 'trendingUp', description: 'Export overview' },
  '/export-operations/transactions': { icon: 'export', description: 'Export liftings' },
  '/export-operations/reports': { icon: 'fileSpreadsheet', description: 'Export report' },
  '/export-operations/permits': { icon: 'clipboard', description: 'Permits & volumes' },
  '/export-operations/locations': { icon: 'mapPin', description: 'Export locations' },
  '/export-operations/entities': { icon: 'building', description: 'Export entities' },
  '/export-operations/blocks': { icon: 'grid', description: 'Blocks & mappings' },
  '/export-operations/consignees': { icon: 'package', description: 'Consignees' },
  '/export-operations/settings': { icon: 'sliders', description: 'Export settings' },
  '/tank-operation-summary': { icon: 'table', description: 'Tank summary' },
  '/out-turn-summary': { icon: 'barChart', description: 'Out-turn' },
  '/material-balance-report': { icon: 'layers', description: 'Material balance' },
  '/tanker-transaction-report': { icon: 'truck', description: 'Tanker report' },
  '/system-notifications': { icon: 'bellRing', description: 'Announcements' },
  '/backup-recovery': { icon: 'archive', description: 'Backups' },
  '/database-browser': { icon: 'database', description: 'Read-only data' },
  '/audit-logs': { icon: 'history', description: 'Audit trail' },
}

const dashboardCards = navigationItems
  .filter((group) => group.type === 'dropdown')
  .flatMap((group) =>
    group.items
      .filter((item) => item.path && !item.disabled)
      .map((item) => ({
        title: item.label,
        description: TILE_META[item.path]?.description || '',
        icon: TILE_META[item.path]?.icon || 'folder',
        path: item.path,
        permission: item.permission,
        group: group.label,
      }))
  )

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