import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import PageHeader from '../components/common/PageHeader'
import AlertMessage from '../components/common/AlertMessage'
import PaginationControls, { paginateRows, usePageSize } from '../components/common/PaginationControls'
import { deleteAnalyticsDefinition, getAnalyticsDefinitions, getMyAnalyticsDashboards, publishAnalyticsDefinition } from '../api/analyticsApi'
import { usePermissions } from '../hooks/usePermissions'
import { logUiAction } from '../utils/actionLogger'
import { useToast } from '../components/common/Toast'

function AnalyticsHome({ loggedInUser }) {
  const { hasPermission } = usePermissions(loggedInUser)
  const canBuild = hasPermission('View Analytics Definition') || hasPermission('Create Analytics Definition') || hasPermission('Edit Analytics Definition')
  const canCreate = hasPermission('Create Analytics Definition')
  const canPublish = hasPermission('Publish Analytics Definition')
  const canDelete = hasPermission('Delete Analytics Definition')
  const toast = useToast()
  const [published, setPublished] = useState([])
  const [definitions, setDefinitions] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState(null)
  const [publishedPage, setPublishedPage] = useState(1)
  const [definitionsPage, setDefinitionsPage] = useState(1)
  const pageSize = usePageSize()

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const [publishedItems, definitionItems] = await Promise.all([
        getMyAnalyticsDashboards().catch(() => []),
        canBuild ? getAnalyticsDefinitions().catch(() => []) : Promise.resolve([]),
      ])
      setPublished(Array.isArray(publishedItems) ? publishedItems : [])
      setDefinitions(Array.isArray(definitionItems) ? definitionItems : [])
    } catch (loadError) {
      setError(loadError.message || 'Unable to load dashboards.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const visiblePublished = useMemo(() => paginateRows(published, publishedPage, pageSize), [published, publishedPage, pageSize])
  const visibleDefinitions = useMemo(() => paginateRows(definitions, definitionsPage, pageSize), [definitions, definitionsPage, pageSize])

  const onTogglePublish = async (dashboard) => {
    if (!canPublish) return
    setBusyId(dashboard.id)
    try {
      await publishAnalyticsDefinition(dashboard.id, !dashboard.is_published)
      toast.success(dashboard.is_published ? 'Dashboard unpublished.' : 'Dashboard published.')
      logUiAction('Analytics', dashboard.is_published ? 'Unpublish Dashboard' : 'Publish Dashboard', { dashboardId: dashboard.id })
      await load()
    } catch (err) {
      setError(err.message || 'Unable to update publish status.')
    } finally {
      setBusyId(null)
    }
  }

  const onDelete = async (dashboard) => {
    if (!canDelete) return
    const ok = window.confirm(`Delete dashboard "${dashboard.dashboard_name}"? This cannot be undone.`)
    if (!ok) return
    setBusyId(dashboard.id)
    try {
      await deleteAnalyticsDefinition(dashboard.id)
      toast.success('Dashboard deleted.')
      logUiAction('Analytics', 'Delete Dashboard Definition', { dashboardId: dashboard.id })
      await load()
    } catch (err) {
      setError(err.message || 'Unable to delete dashboard.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="page-container analytics-page">
      <PageHeader
        title="Analytics"
        description="Published interactive dashboards and your saved dashboard definitions."
        count={`${published.length} published · ${definitions.length} definition${definitions.length === 1 ? '' : 's'}`}
        actions={canCreate ? <Link className="btn-primary" to="/analytics/builder" onClick={() => logUiAction('Analytics', 'Open Analytics Studio')}>Create dashboard</Link> : null}
      />
      <AlertMessage tone="error" message={error} onDismiss={() => setError('')} />
      {loading ? <p>Loading dashboards…</p> : (
        <>
          <section className="analytics-home-section">
            <div className="analytics-section-title"><div><h2>Published dashboards</h2><p>Dashboards available for interactive viewing in your reporting scope.</p></div></div>
            <div className="analytics-gallery-grid">
              {visiblePublished.map((dashboard) => (
                <article className="analytics-gallery-card" key={dashboard.id}>
                  <div className="analytics-gallery-icon" aria-hidden="true">A</div>
                  <div className="analytics-gallery-content">
                    <h2>{dashboard.dashboard_name}</h2>
                    <p>{dashboard.description || 'Interactive analytics dashboard'}</p>
                    <div className="analytics-gallery-meta">
                      <span className="analytics-status-badge published">Published</span>
                      <span>{dashboard.scope_type === 'LOCATION' ? dashboard.location_code : 'Global'}</span>
                      <span>{dashboard.visual_count} visual{dashboard.visual_count === 1 ? '' : 's'}</span>
                      <span>Version {dashboard.version}</span>
                    </div>
                  </div>
                  <Link className="btn-primary btn-sm" to={`/analytics/view/${dashboard.id}`} onClick={() => logUiAction('Analytics', 'Open Dashboard', { dashboardId: dashboard.id })}>Open</Link>
                </article>
              ))}
            </div>
            {!published.length && <div className="analytics-empty-state">No published dashboards are available to you yet.</div>}
            <PaginationControls currentPage={publishedPage} totalRows={published.length} onPageChange={setPublishedPage} />
          </section>

          {canBuild && (
            <section className="analytics-home-section">
              <div className="analytics-section-title"><div><h2>My definitions & drafts</h2><p>Saved dashboards you can edit. Drafts are not visible in the published gallery until published.</p></div></div>
              <div className="analytics-gallery-grid">
                {visibleDefinitions.map((dashboard) => (
                  <article className="analytics-gallery-card" key={`def-${dashboard.id}`}>
                    <div className="analytics-gallery-icon draft" aria-hidden="true">{dashboard.is_published ? 'P' : 'D'}</div>
                    <div className="analytics-gallery-content">
                      <h2>{dashboard.dashboard_name}</h2>
                      <p>{dashboard.description || 'Saved dashboard definition'}</p>
                      <div className="analytics-gallery-meta">
                        <span className={`analytics-status-badge ${dashboard.is_published ? 'published' : 'draft'}`}>{dashboard.is_published ? 'Published' : 'Draft'}</span>
                        <span>{dashboard.scope_type === 'LOCATION' ? dashboard.location_code : 'Global'}</span>
                        <span>{dashboard.visual_count || 0} visual{(dashboard.visual_count || 0) === 1 ? '' : 's'}</span>
                        <span>Version {dashboard.version}</span>
                      </div>
                    </div>
                    <div className="analytics-card-actions">
                      {dashboard.is_published && <Link className="btn-secondary btn-sm" to={`/analytics/view/${dashboard.id}`}>View</Link>}
                      <Link className="btn-primary btn-sm" to={`/analytics/builder/${dashboard.id}`}>Edit</Link>
                      {canPublish && <button type="button" className="btn-secondary btn-sm" disabled={busyId === dashboard.id} onClick={() => onTogglePublish(dashboard)}>{dashboard.is_published ? 'Unpublish' : 'Publish'}</button>}
                      {canDelete && <button type="button" className="btn-danger btn-sm" disabled={busyId === dashboard.id} onClick={() => onDelete(dashboard)}>Delete</button>}
                    </div>
                  </article>
                ))}
              </div>
              {!definitions.length && <div className="analytics-empty-state">No saved dashboard definitions yet. Create a dashboard to start designing.</div>}
              <PaginationControls currentPage={definitionsPage} totalRows={definitions.length} onPageChange={setDefinitionsPage} />
            </section>
          )}
        </>
      )}
    </div>
  )
}

export default AnalyticsHome
