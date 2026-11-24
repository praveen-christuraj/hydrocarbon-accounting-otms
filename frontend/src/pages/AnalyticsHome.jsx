import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import PageHeader from '../components/common/PageHeader'
import AlertMessage from '../components/common/AlertMessage'
import PaginationControls, { paginateRows, usePageSize } from '../components/common/PaginationControls'
import { getMyAnalyticsDashboards } from '../api/analyticsApi'
import { usePermissions } from '../hooks/usePermissions'
import { logUiAction } from '../utils/actionLogger'

function AnalyticsHome({ loggedInUser }) {
  const { hasPermission } = usePermissions(loggedInUser)
  const canBuild = hasPermission('View Analytics Definition') && hasPermission('Create Analytics Definition')
  const [dashboards, setDashboards] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const pageSize = usePageSize()

  useEffect(() => {
    let cancelled = false
    getMyAnalyticsDashboards()
      .then((items) => { if (!cancelled) setDashboards(Array.isArray(items) ? items : []) })
      .catch((loadError) => { if (!cancelled) setError(loadError.message || 'Unable to load dashboards.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const visible = useMemo(() => paginateRows(dashboards, page, pageSize), [dashboards, page, pageSize])

  return (
    <div className="page-container analytics-page">
      <PageHeader
        title="Analytics"
        description="Published interactive dashboards available to your account and reporting scope."
        count={`${dashboards.length} dashboard${dashboards.length === 1 ? '' : 's'}`}
        actions={canBuild ? <Link className="btn-primary" to="/analytics/builder" onClick={() => logUiAction('Analytics', 'Open Analytics Studio')}>Create dashboard</Link> : null}
      />
      <AlertMessage tone="error" message={error} onDismiss={() => setError('')} />
      {loading ? <p>Loading dashboards…</p> : (
        <>
          <div className="analytics-gallery-grid">
            {visible.map((dashboard) => (
              <article className="analytics-gallery-card" key={dashboard.id}>
                <div className="analytics-gallery-icon" aria-hidden="true">A</div>
                <div className="analytics-gallery-content">
                  <h2>{dashboard.dashboard_name}</h2>
                  <p>{dashboard.description || 'Interactive analytics dashboard'}</p>
                  <div className="analytics-gallery-meta">
                    <span>{dashboard.scope_type === 'LOCATION' ? dashboard.location_code : 'Global'}</span>
                    <span>{dashboard.visual_count} visual{dashboard.visual_count === 1 ? '' : 's'}</span>
                    <span>Version {dashboard.version}</span>
                  </div>
                </div>
                <Link className="btn-primary btn-sm" to={`/analytics/view/${dashboard.id}`} onClick={() => logUiAction('Analytics', 'Open Dashboard', { dashboardId: dashboard.id })}>Open</Link>
              </article>
            ))}
          </div>
          {!dashboards.length && <div className="analytics-empty-state">No published dashboards are available to you yet.</div>}
          <PaginationControls currentPage={page} totalRows={dashboards.length} onPageChange={setPage} />
        </>
      )}
    </div>
  )
}

export default AnalyticsHome
