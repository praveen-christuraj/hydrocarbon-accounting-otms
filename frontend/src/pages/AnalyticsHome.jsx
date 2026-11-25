import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AlertMessage from '../components/common/AlertMessage'
import { useConfirm } from '../components/common/ConfirmProvider'
import DataFilterBar from '../components/common/DataFilterBar'
import ExportMenu from '../components/common/ExportMenu'
import Icon from '../components/common/Icon'
import PaginationControls, { paginateRows, usePageSize } from '../components/common/PaginationControls'
import { useToast } from '../components/common/Toast'
import useDataFilters from '../hooks/useDataFilters'
import usePermissions from '../hooks/usePermissions'
import {
  deleteAnalyticsDefinition,
  duplicateAnalyticsDefinition,
  getAnalyticsDefinitions,
  getMyAnalyticsDashboards,
  publishAnalyticsDefinition,
} from '../api/analyticsApi'
import { logUiAction } from '../utils/actionLogger'
import { buildStarterTemplates } from '../utils/analyticsEngine'
import '../styles/analytics.css'

function AnalyticsHome({ loggedInUser }) {
  const navigate = useNavigate()
  const toast = useToast()
  const confirm = useConfirm()
  const pageSize = usePageSize()
  const { hasAny } = usePermissions(loggedInUser)

  const canViewDashboards = hasAny(['View Analytics Dashboard'])
  const canViewStudio = hasAny([
    'View Analytics Definition',
    'Create Analytics Definition',
    'Edit Analytics Definition',
    'Publish Analytics Definition',
    'Delete Analytics Definition',
  ])
  const canCreate = hasAny(['Create Analytics Definition'])
  const canEdit = hasAny(['Edit Analytics Definition'])
  const canPublish = hasAny(['Publish Analytics Definition'])
  const canDelete = hasAny(['Delete Analytics Definition'])

  const [tab, setTab] = useState(() => (canViewDashboards ? 'dashboards' : 'studio'))
  const [dashboards, setDashboards] = useState([])
  const [definitions, setDefinitions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)

  const starterTemplates = useMemo(() => buildStarterTemplates(), [])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [myList, defs] = await Promise.all([
        canViewDashboards ? getMyAnalyticsDashboards() : Promise.resolve([]),
        canViewStudio ? getAnalyticsDefinitions().catch(() => []) : Promise.resolve([]),
      ])
      setDashboards(Array.isArray(myList) ? myList : [])
      setDefinitions(Array.isArray(defs) ? defs : [])
    } catch (err) {
      setError(err.message || 'Unable to load analytics dashboards.')
    } finally {
      setLoading(false)
    }
  }, [canViewDashboards, canViewStudio])

  useEffect(() => {
    let active = true
    Promise.all([
      canViewDashboards ? getMyAnalyticsDashboards() : Promise.resolve([]),
      canViewStudio ? getAnalyticsDefinitions().catch(() => []) : Promise.resolve([]),
    ])
      .then(([myList, defs]) => {
        if (!active) return
        setDashboards(Array.isArray(myList) ? myList : [])
        setDefinitions(Array.isArray(defs) ? defs : [])
        setError('')
      })
      .catch((err) => {
        if (active) setError(err.message || 'Unable to load analytics dashboards.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [canViewDashboards, canViewStudio])

  const activeRows = useMemo(
    () => (tab === 'studio' ? definitions : dashboards).map((item) => ({
      ...item,
      dashboard_name: item.dashboard_name || item.name || `Dashboard #${item.id}`,
      scope_type: item.scope_type || 'LOCATION',
      status_label: item.is_published ? 'Published' : 'Draft',
      visual_count: Number.isFinite(Number(item.visual_count))
        ? Number(item.visual_count)
        : (Array.isArray(item.definition?.visuals) ? item.definition.visuals.length : 0),
      updated_date: item.updated_at ? String(item.updated_at).slice(0, 10) : '',
    })),
    [dashboards, definitions, tab]
  )

  const filterColumns = useMemo(() => [
    { key: 'dashboard_name', label: 'Dashboard Name', type: 'text' },
    { key: 'description', label: 'Description', type: 'text' },
    { key: 'scope_type', label: 'Scope', type: 'select', options: ['LOCATION', 'GLOBAL'] },
    { key: 'location_code', label: 'Location', type: 'text' },
    { key: 'status_label', label: 'Status', type: 'select', options: ['Published', 'Draft'] },
    { key: 'version', label: 'Version', type: 'number' },
    { key: 'updated_date', label: 'Updated Date', type: 'date' },
  ], [])

  const filters = useDataFilters(activeRows, filterColumns, { module: 'Analytics Dashboards' })

  const totalPages = Math.max(1, Math.ceil(filters.filteredRows.length / pageSize))
  const safePage = Math.min(page, totalPages)

  const paged = useMemo(
    () => paginateRows(filters.filteredRows, safePage, pageSize),
    [filters.filteredRows, safePage, pageSize]
  )

  const togglePublish = async (item) => {
    try {
      await publishAnalyticsDefinition(item.id, !item.is_published)
      logUiAction(
        'Analytics',
        item.is_published ? 'Unpublish Dashboard' : 'Publish Dashboard',
        { dashboardId: item.id, dashboardName: item.dashboard_name }
      )
      toast.success(item.is_published ? 'Dashboard unpublished.' : 'Dashboard published.')
      await load()
    } catch (err) {
      toast.error(err.message || 'Unable to update publish status.')
    }
  }

  const handleDuplicate = async (item) => {
    try {
      const cloned = await duplicateAnalyticsDefinition(item.id)
      logUiAction('Analytics', 'Duplicate Dashboard', {
        sourceDashboardId: item.id,
        dashboardId: cloned.id,
        dashboardName: cloned.dashboard_name,
      })
      toast.success(`Duplicated as "${cloned.dashboard_name || 'Copy'}".`)
      await load()
    } catch (err) {
      toast.error(err.message || 'Unable to duplicate dashboard.')
    }
  }

  const removeDashboard = async (item) => {
    const ok = await confirm({
      title: 'Delete Analytics Dashboard',
      message: `Are you sure you want to permanently delete "${item.dashboard_name}"? Published links and version history for this dashboard will be removed.`,
      confirmLabel: 'Delete Dashboard',
      cancelLabel: 'Cancel',
      tone: 'danger',
    })
    if (!ok) return
    try {
      await deleteAnalyticsDefinition(item.id)
      logUiAction('Analytics', 'Delete Dashboard', {
        dashboardId: item.id,
        dashboardName: item.dashboard_name,
      })
      toast.success('Analytics dashboard deleted.')
      await load()
    } catch (err) {
      toast.error(err.message || 'Unable to delete analytics dashboard.')
    }
  }

  const exportColumns = useMemo(() => [
    { key: 'dashboard_name', label: 'Dashboard Name' },
    { key: 'description', label: 'Description' },
    { key: 'scope_type', label: 'Scope' },
    { key: 'location_code', label: 'Location' },
    { key: 'visual_count', label: 'Visuals' },
    { key: 'version', label: 'Version' },
    { key: 'status_label', label: 'Status' },
    { key: 'updated_date', label: 'Last Updated' },
  ], [])

  return (
    <div className="page-shell analytics-page">
      <div className="page-header analytics-header">
        <div>
          <p className="eyebrow">Business Intelligence &amp; Terminal Analytics</p>
          <h1>Analytics Workspace</h1>
          <p className="page-subtitle">
            Interactive GridStack executive dashboards, Perspective pivot matrices, Apache ECharts &amp; Plotly statistical explorers.
          </p>
        </div>
        <div className="analytics-header-actions">
          <button type="button" className="btn-secondary" onClick={load} disabled={loading}>
            <Icon name="refresh" size={16} /> Refresh
          </button>
          {canCreate && (
            <button type="button" className="btn-primary" onClick={() => navigate('/analytics/builder')}>
              <Icon name="plus" size={16} /> New Dashboard
            </button>
          )}
        </div>
      </div>

      {error && <AlertMessage tone="error" message={error} />}

      {/* Starter Blueprint Strip for Builders */}
      {canCreate && (
        <section className="analytics-blueprints-strip" aria-label="Quick-start dashboard blueprints">
          <div className="analytics-blueprints-title">
            <Icon name="compass" size={16} />
            <div>
              <strong>Quick-Start Terminal Blueprints</strong>
              <span>Launch pre-wired GridStack + Perspective + ECharts + Plotly dashboards in Studio</span>
            </div>
          </div>
          <div className="analytics-blueprints-cards">
            {starterTemplates.map((tpl) => (
              <button
                key={tpl.id}
                type="button"
                className="analytics-blueprint-card"
                onClick={() => navigate(`/analytics/builder?template=${encodeURIComponent(tpl.id)}`)}
              >
                <div>
                  <strong>{tpl.name}</strong>
                  <p>{tpl.description}</p>
                </div>
                <span className="analytics-blueprint-cta">
                  Use Blueprint <Icon name="chevronRight" size={14} />
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      <div className="analytics-toolbar-tabs">
        <div className="analytics-tabs" role="tablist" aria-label="Analytics views">
          {canViewDashboards && (
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'dashboards'}
              className={tab === 'dashboards' ? 'is-active' : ''}
              onClick={() => { setTab('dashboards'); setPage(1) }}
            >
              My Dashboards ({dashboards.length})
            </button>
          )}
          {canViewStudio && (
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'studio'}
              className={tab === 'studio' ? 'is-active' : ''}
              onClick={() => { setTab('studio'); setPage(1) }}
            >
              Studio Definitions ({definitions.length})
            </button>
          )}
        </div>
      </div>

      <DataFilterBar
        {...filters.barProps}
        searchPlaceholder="Search dashboards by name, scope, location, status…"
        actions={(
          <ExportMenu
            label="Export Register"
            title={tab === 'studio' ? 'Analytics Studio Definitions' : 'Accessible Analytics Dashboards'}
            fileName="analytics_dashboards_register"
            columns={exportColumns}
            rows={filters.filteredRows}
            disabled={!filters.filteredRows.length}
          />
        )}
      />

      <div className="card analytics-list-card">
        <div className="table-responsive">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Dashboard</th>
                <th scope="col">Scope</th>
                <th scope="col">Location</th>
                <th scope="col" className="is-num">Visuals</th>
                <th scope="col" className="is-num">Version</th>
                <th scope="col">Status</th>
                <th scope="col">Updated</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={8}>Loading analytics dashboards…</td>
                </tr>
              )}
              {!loading && paged.map((item) => {
                const canOpenViewer = item.is_published && canViewDashboards
                const hasEditAccess = item.my_access === 'OWNER' || item.my_access === 'EDIT'
                return (
                  <tr key={item.id}>
                    <td>
                      <div className="analytics-name-cell">
                        <button
                          type="button"
                          className="analytics-title-link"
                          onClick={() => navigate(
                            canOpenViewer ? `/analytics/view/${item.id}` : `/analytics/builder/${item.id}`
                          )}
                        >
                          {item.dashboard_name}
                        </button>
                        {item.description && <span>{item.description}</span>}
                      </div>
                    </td>
                    <td>
                      <span className="analytics-scope-pill">{item.scope_type}</span>
                    </td>
                    <td>{item.location_code || 'All Scoped'}</td>
                    <td className="is-num">{item.visual_count}</td>
                    <td className="is-num">v{item.version}</td>
                    <td>
                      <span className={`status-pill ${item.is_published ? 'status-approved' : 'status-draft'}`}>
                        {item.is_published ? 'Published' : 'Draft'}
                      </span>
                    </td>
                    <td>{item.updated_date || '—'}</td>
                    <td>
                      <div className="analytics-row-actions">
                        {canOpenViewer && (
                          <button
                            type="button"
                            className="btn-secondary btn-sm"
                            onClick={() => navigate(`/analytics/view/${item.id}`)}
                          >
                            <Icon name="eye" size={14} /> Open
                          </button>
                        )}
                        {canViewStudio && (canEdit || tab === 'studio') && (
                          <button
                            type="button"
                            className="btn-secondary btn-sm"
                            onClick={() => navigate(`/analytics/builder/${item.id}`)}
                          >
                            <Icon name="edit" size={14} /> Studio
                          </button>
                        )}
                        {canCreate && tab === 'studio' && (
                          <button
                            type="button"
                            className="btn-secondary btn-sm"
                            title="Duplicate as private copy"
                            onClick={() => handleDuplicate(item)}
                          >
                            <Icon name="copy" size={14} /> Clone
                          </button>
                        )}
                        {tab === 'studio' && canPublish && hasEditAccess && (
                          <button
                            type="button"
                            className="btn-secondary btn-sm"
                            onClick={() => togglePublish(item)}
                          >
                            {item.is_published ? 'Unpublish' : 'Publish'}
                          </button>
                        )}
                        {tab === 'studio' && canDelete && hasEditAccess && (
                          <button
                            type="button"
                            className="btn-danger btn-sm"
                            onClick={() => removeDashboard(item)}
                          >
                            <Icon name="trash" size={14} /> Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
              {!loading && !paged.length && (
                <tr>
                  <td colSpan={8}>
                    No analytics dashboards matched your filter criteria.
                    {canCreate ? ' Click "New Dashboard" or pick a Quick-Start Blueprint above.' : ''}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <PaginationControls
          currentPage={safePage}
          totalRows={filters.filteredRows.length}
          onPageChange={setPage}
        />
      </div>
    </div>
  )
}

export default AnalyticsHome
