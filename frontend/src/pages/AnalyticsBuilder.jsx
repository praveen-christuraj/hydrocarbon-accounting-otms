import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import AlertMessage from '../components/common/AlertMessage'
import { useConfirm } from '../components/common/ConfirmProvider'
import Icon from '../components/common/Icon'
import Modal from '../components/common/Modal'
import { useToast } from '../components/common/Toast'
import AnalyticsVisual from '../components/analytics/AnalyticsVisual'
import GridStackCanvas from '../components/analytics/GridStackCanvas'
import FormulaBuilder from '../components/reportBuilder/FormulaBuilder'
import usePermissions from '../hooks/usePermissions'
import {
  createAnalyticsDefinition,
  getAnalyticsCatalog,
  getAnalyticsDefinition,
  getAnalyticsLookups,
  getAnalyticsVersions,
  publishAnalyticsDefinition,
  revertAnalyticsDefinition,
  runAnalyticsPreview,
  updateAnalyticsDefinition,
  validateAnalyticsFormula,
} from '../api/analyticsApi'
import { logUiAction } from '../utils/actionLogger'
import {
  BUCKET_OPTIONS,
  ECHARTS_VISUAL_TYPES,
  PLOTLY_VISUAL_TYPES,
  VISUAL_CATALOG,
  VISUAL_GROUPS,
  buildStarterTemplates,
  defaultLayoutForVisualType,
  getVisualMeta,
  makeSafeKey,
  normalizeLayoutForGridStack,
} from '../utils/analyticsEngine'
import '../styles/analytics.css'

const REPORT_AGG_OPTIONS = ['SUM', 'AVG', 'COUNT', 'MIN', 'MAX', 'FIRST', 'LAST']

const EMPTY_DEFINITION = {
  schema_version: 2,
  canvas: { floatMode: false, cellHeight: 64, margin: 14 },
  slicers: [],
  visuals: [],
  layout: [],
}

function buildQueryFromDataset(dataset, visualType, customTitle = '') {
  const type = String(visualType || 'COLUMN').toUpperCase()
  const meta = getVisualMeta(type)

  if (type === 'TEXT') {
    return {
      title: customTitle || 'Executive Operating Note',
      type: 'TEXT',
      text: 'Enter terminal reconciliation context, operating notes, or threshold commentary here.',
      query: {},
      style: {},
      explorer: { allowViewSwitch: false },
      interactions: { crossFilter: false },
    }
  }

  if (type === 'TANK_VISUAL' || dataset?.kind === 'tank_snapshot') {
    return {
      title: customTitle || 'Shore Tank Live Stock & Ullage',
      type: type === 'TANK_VISUAL' ? 'TANK_VISUAL' : type,
      query: { source: { kind: 'tank_snapshot' }, unit: 'nsv' },
      style: {},
      explorer: { allowViewSwitch: type !== 'TANK_VISUAL' },
      interactions: { crossFilter: true, drillThrough: { enabled: true, mode: 'RECORDS' } },
    }
  }

  if (dataset?.kind === 'material_balance') {
    return {
      title: customTitle || `${meta.shortLabel} · Material Balance`,
      type,
      query: {
        source: { kind: 'material_balance' },
        unit: 'nsv',
        dimension_key: 'tank',
        measure_key: 'closing_stock',
        metric_key: 'closing_stock',
      },
      style: {
        table: { dataBars: true, showSummaryBar: true, stickyHeader: true, striped: true },
        chart: { showLegend: true, showToolbox: true },
      },
      explorer: { allowViewSwitch: true, showShelfByDefault: type === 'PIVOT_GRID' },
      interactions: { crossFilter: true, drillThrough: { enabled: true, mode: 'RECORDS' } },
    }
  }

  const dsCols = Array.isArray(dataset?.columns) ? dataset.columns : []
  const textCols = dsCols.filter((c) => c.data_type !== 'number')
  const numCols = dsCols.filter((c) => c.data_type === 'number')
  const pickedRaw = [
    ...textCols.slice(0, 2),
    ...numCols.slice(0, 2),
  ]
  const fallbackRaw = pickedRaw.length ? pickedRaw : dsCols.slice(0, 4)

  const columns = fallbackRaw.map((col) => {
    const key = makeSafeKey(col.column || col.label)
    return {
      key,
      label: col.label || col.column,
      kind: 'data',
      source: {
        type: col.source_type || 'column',
        column: col.column,
        template_id: col.template_id,
      },
      data_type: col.data_type || 'text',
      aggregate: col.data_type === 'number' ? 'SUM' : 'FIRST',
      show_total: col.data_type === 'number',
      format: { decimals: col.data_type === 'number' ? 2 : 0 },
    }
  })

  const firstDim = columns.find((c) => c.data_type !== 'number')?.key || columns[0]?.key || ''
  const firstMeasure = columns.find((c) => c.data_type === 'number')?.key || columns[columns.length - 1]?.key || ''
  const needsUnaggregatedDistribution = ['BOX_PLOT', 'VIOLIN_PLOT', 'HISTOGRAM', 'SCATTER', 'PIVOT_GRID', 'TABLE', 'CONTOUR_2D'].includes(type)

  return {
    title: customTitle || `${dataset?.label || 'Dataset'} · ${meta.shortLabel}`,
    type,
    query: {
      schema_version: 1,
      report_type: 'TABULAR',
      source: {
        kind: dataset?.kind || 'tank_stock_ledger',
        operation_type_codes: [],
        template_ids: [],
        statuses: dataset?.kind === 'operation_tickets' ? ['Approved'] : [],
      },
      date_basis: 'ACCOUNTING_DATE',
      columns,
      filters: [],
      filter_logic: 'AND',
      runtime_filters: [],
      group_by: !needsUnaggregatedDistribution && firstDim ? [{ key: firstDim, bucket: 'VALUE' }] : [],
      sort: [],
      options: { show_totals: true, page_size: needsUnaggregatedDistribution ? 500 : 200 },
      dimension_key: firstDim,
      measure_key: firstMeasure,
      metric_key: firstMeasure,
      measure_keys: columns.filter((c) => c.data_type === 'number').map((c) => c.key).slice(0, 2),
    },
    explorer: {
      groupByKeys: type === 'PIVOT_GRID' && firstDim ? [firstDim] : [],
      splitByKeys: [],
      measureSpecs: firstMeasure
        ? [{ key: firstMeasure, aggregate: columns.find((c) => c.key === firstMeasure)?.data_type === 'number' ? 'SUM' : 'COUNT', label: columns.find((c) => c.key === firstMeasure)?.label || firstMeasure }]
        : [],
      sortSpecs: [],
      whereRules: [],
      allowViewSwitch: true,
      showShelfByDefault: type === 'PIVOT_GRID',
    },
    style: {
      kpi: { decimals: 1, showSparkline: true },
      chart: { showLegend: true, showToolbox: true, dataZoom: false },
      table: { dataBars: true, colorScale: 'none', showSummaryBar: true, stickyHeader: true, striped: true },
      plotly: { showModeBar: true, trendline: true, boxMean: true, showOutliers: true },
    },
    interactions: {
      crossFilter: true,
      drillThrough: { enabled: true, mode: 'RECORDS' },
    },
  }
}

function AnalyticsBuilder() {
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  const isNew = !id || id === 'new'
  const navigate = useNavigate()
  const toast = useToast()
  const confirm = useConfirm()
  const { hasAny } = usePermissions()
  const canPublish = hasAny(['Publish Analytics Dashboard'])

  const starterTemplates = useMemo(() => buildStarterTemplates(), [])

  const [catalog, setCatalog] = useState({ is_admin: false, datasets: [], templates: [], operation_types: [] })
  const [lookups, setLookups] = useState({ users: [], roles: [], locations: [] })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [error, setError] = useState('')

  // Dashboard Metadata & Access
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [visibilityScope, setVisibilityScope] = useState('PRIVATE')
  const [locationCode, setLocationCode] = useState('')
  const [isPublished, setIsPublished] = useState(false)
  const [versionNum, setVersionNum] = useState(1)
  const [grants, setGrants] = useState([])
  const [definition, setDefinition] = useState(EMPTY_DEFINITION)

  // Studio UI State
  const [selectedVisualId, setSelectedVisualId] = useState(null)
  const [leftTab, setLeftTab] = useState('visuals') // visuals | fields
  const [inspectorTab, setInspectorTab] = useState('data') // data | perspective | style | slicers
  const [fieldSearch, setFieldSearch] = useState('')
  const [activeDatasetId, setActiveDatasetId] = useState('tank_stock_ledger')

  // Preview Execution State
  const [previewDateFrom, setPreviewDateFrom] = useState('')
  const [previewDateTo, setPreviewDateTo] = useState('')
  const [previewResults, setPreviewResults] = useState({})

  // Modals: FormulaBuilder, RBAC Sharing, Version History
  const [formulaModalOpen, setFormulaModalOpen] = useState(false)
  const [editingFormulaCol, setEditingFormulaCol] = useState(null)
  const [accessModalOpen, setAccessModalOpen] = useState(false)
  const [historyModalOpen, setHistoryModalOpen] = useState(false)
  const [versions, setVersions] = useState([])
  const [loadingVersions, setLoadingVersions] = useState(false)

  // Grant adder draft inside Access Modal
  const [grantTargetKind, setGrantTargetKind] = useState('role')
  const [grantRoleId, setGrantRoleId] = useState('')
  const [grantUserId, setGrantUserId] = useState('')
  const [grantType, setGrantType] = useState('VIEW')

  const executePreview = useCallback(async (defToRun, fromDate = previewDateFrom, toDate = previewDateTo) => {
    if (!defToRun?.visuals?.length) {
      setPreviewResults({})
      return
    }
    setPreviewing(true)
    try {
      const response = await runAnalyticsPreview(defToRun, {
        date_from: fromDate || null,
        date_to: toDate || null,
        location_codes: locationCode ? [locationCode] : null,
        runtime_values: {},
      })
      setPreviewResults(response?.results || {})
    } catch (err) {
      toast.error(err.message || 'Unable to execute studio preview.')
    } finally {
      setPreviewing(false)
    }
  }, [locationCode, previewDateFrom, previewDateTo, toast])

  useEffect(() => {
    let active = true
    const load = async () => {
      setLoading(true)
      setError('')
      try {
        const [catalogData, lookupData, existing] = await Promise.all([
          getAnalyticsCatalog(),
          getAnalyticsLookups().catch(() => ({ users: [], roles: [], locations: [] })),
          isNew ? Promise.resolve(null) : getAnalyticsDefinition(id),
        ])
        if (!active) return
        setCatalog(catalogData || { is_admin: false, datasets: [] })
        setLookups(lookupData || { users: [], roles: [], locations: [] })
        const firstDs = catalogData?.datasets?.find((d) => d.id === 'tank_stock_ledger')?.id || catalogData?.datasets?.[0]?.id || 'tank_stock_ledger'
        setActiveDatasetId(firstDs)

        if (existing) {
          setName(existing.name || '')
          setDescription(existing.description || '')
          setVisibilityScope(existing.visibility_scope || 'PRIVATE')
          setLocationCode(existing.location_code || '')
          setIsPublished(Boolean(existing.is_published))
          setVersionNum(Number(existing.version) || 1)
          setGrants(Array.isArray(existing.grants) ? existing.grants.map((g) => ({
            user_id: g.user_id || null,
            role_id: g.role_id || null,
            grant_type: g.grant_type || 'VIEW',
          })) : [])
          const rawDef = existing.definition_json || EMPTY_DEFINITION
          const normLayout = normalizeLayoutForGridStack(rawDef.layout, rawDef.visuals || [])
          const hydrated = {
            ...EMPTY_DEFINITION,
            ...rawDef,
            canvas: { floatMode: false, cellHeight: 64, margin: 14, ...(rawDef.canvas || {}) },
            layout: normLayout,
          }
          setDefinition(hydrated)
          if (hydrated.visuals?.length) {
            setSelectedVisualId(hydrated.visuals[0].id)
            executePreview(hydrated)
          }
        } else {
          const tplId = searchParams.get('template')
          const matchedTpl = tplId ? starterTemplates.find((t) => t.id === tplId) : null
          if (matchedTpl) {
            const built = matchedTpl.buildDefinition()
            setName(matchedTpl.name)
            setDescription(matchedTpl.description)
            setDefinition(built)
            if (built.visuals?.length) {
              setSelectedVisualId(built.visuals[0].id)
              executePreview(built)
            }
          }
        }
      } catch (err) {
        if (active) setError(err.message || 'Unable to load Analytics Studio.')
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    return () => { active = false }
  }, [executePreview, id, isNew, searchParams, starterTemplates])

  const selectedVisual = useMemo(
    () => (definition.visuals || []).find((v) => String(v.id) === String(selectedVisualId)) || null,
    [definition.visuals, selectedVisualId]
  )

  const selectedDataset = useMemo(() => {
    const kind = selectedVisual?.query?.source?.kind || activeDatasetId
    return (catalog.datasets || []).find((ds) => ds.kind === kind || ds.id === kind) || catalog.datasets?.[0] || null
  }, [activeDatasetId, catalog.datasets, selectedVisual?.query?.source?.kind])

  const updateVisualById = useCallback((visualId, updater) => {
    setDefinition((prev) => {
      const nextVisuals = (prev.visuals || []).map((v) => {
        if (String(v.id) !== String(visualId)) return v
        return typeof updater === 'function' ? updater(v) : { ...v, ...updater }
      })
      return {
        ...prev,
        visuals: nextVisuals,
        layout: normalizeLayoutForGridStack(prev.layout, nextVisuals),
      }
    })
  }, [])

  const addVisualToCanvas = useCallback((visualType, dropCoords = null) => {
    const ds = (catalog.datasets || []).find((d) => d.id === activeDatasetId || d.kind === activeDatasetId) || catalog.datasets?.[0]
    const idStr = `vis_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`
    const visualSkeleton = buildQueryFromDataset(ds, visualType)
    const newVisual = { id: idStr, ...visualSkeleton }
    const defaults = defaultLayoutForVisualType(visualType)

    setDefinition((prev) => {
      const nextVisuals = [...(prev.visuals || []), newVisual]
      const existingNorm = normalizeLayoutForGridStack(prev.layout, prev.visuals || [])
      const maxBottom = existingNorm.reduce((acc, item) => Math.max(acc, (item.y || 0) + (item.h || 4)), 0)
      const newLayoutItem = {
        i: idStr,
        id: idStr,
        x: dropCoords?.x != null ? Math.max(0, Math.min(12 - defaults.w, dropCoords.x)) : 0,
        y: dropCoords?.y != null ? Math.max(0, dropCoords.y) : maxBottom,
        w: defaults.w,
        h: defaults.h,
        minW: defaults.minW,
        minH: defaults.minH,
        locked: false,
      }
      const nextDef = {
        ...prev,
        visuals: nextVisuals,
        layout: [...existingNorm, newLayoutItem],
      }
      executePreview(nextDef)
      return nextDef
    })
    setSelectedVisualId(idStr)
    setInspectorTab('data')
  }, [activeDatasetId, catalog.datasets, executePreview])

  const handleDuplicateVisual = useCallback((visualId) => {
    const orig = (definition.visuals || []).find((v) => String(v.id) === String(visualId))
    if (!orig) return
    const copyId = `vis_${Date.now().toString(36)}`
    const cloned = JSON.parse(JSON.stringify(orig))
    cloned.id = copyId
    cloned.title = `${orig.title || 'Visual'} (Copy)`
    const defaults = defaultLayoutForVisualType(cloned.type)
    setDefinition((prev) => {
      const nextVisuals = [...(prev.visuals || []), cloned]
      const norm = normalizeLayoutForGridStack(prev.layout, prev.visuals || [])
      const maxY = norm.reduce((m, item) => Math.max(m, (item.y || 0) + (item.h || 4)), 0)
      const nextDef = {
        ...prev,
        visuals: nextVisuals,
        layout: [...norm, { i: copyId, id: copyId, x: 0, y: maxY, w: defaults.w, h: defaults.h, minW: defaults.minW, minH: defaults.minH }],
      }
      executePreview(nextDef)
      return nextDef
    })
    setSelectedVisualId(copyId)
  }, [definition.visuals, executePreview])

  const handleDeleteVisual = useCallback(async (visualId) => {
    const target = (definition.visuals || []).find((v) => String(v.id) === String(visualId))
    const ok = await confirm({
      title: 'Remove Visual from Canvas',
      message: `Remove "${target?.title || visualId}" from this dashboard?`,
      confirmLabel: 'Remove Visual',
      cancelLabel: 'Cancel',
      variant: 'danger',
    })
    if (!ok) return
    setDefinition((prev) => {
      const nextVisuals = (prev.visuals || []).filter((v) => String(v.id) !== String(visualId))
      const nextLayout = (prev.layout || []).filter((l) => String(l.i || l.id) !== String(visualId))
      const nextSlicers = (prev.slicers || []).map((s) => ({
        ...s,
        visual_ids: (s.visual_ids || []).filter((vid) => String(vid) !== String(visualId)),
      }))
      return { ...prev, visuals: nextVisuals, layout: nextLayout, slicers: nextSlicers }
    })
    if (String(selectedVisualId) === String(visualId)) {
      setSelectedVisualId(null)
    }
  }, [confirm, definition.visuals, selectedVisualId])

  const handleToggleLock = useCallback((visualId) => {
    setDefinition((prev) => ({
      ...prev,
      layout: normalizeLayoutForGridStack(prev.layout, prev.visuals).map((item) => (
        String(item.i) === String(visualId)
          ? { ...item, locked: !item.locked, noMove: !item.locked, noResize: !item.locked }
          : item
      )),
    }))
  }, [])

  const applyBlueprint = async (tplId) => {
    if (!tplId) return
    const tpl = starterTemplates.find((t) => t.id === tplId)
    if (!tpl) return
    if (definition.visuals.length > 0) {
      const ok = await confirm({
        title: 'Load Blueprint Layout',
        message: `Replace the current canvas (${definition.visuals.length} visuals) with "${tpl.name}"?`,
        confirmLabel: 'Load Blueprint',
        cancelLabel: 'Cancel',
      })
      if (!ok) return
    }
    const built = tpl.buildDefinition()
    if (!name.trim()) setName(tpl.name)
    if (!description.trim()) setDescription(tpl.description)
    setDefinition(built)
    setSelectedVisualId(built.visuals?.[0]?.id || null)
    executePreview(built)
  }

  // Toggle dataset column on the currently selected tabular/report visual
  const toggleFieldOnSelectedVisual = (rawField) => {
    if (!selectedVisual) {
      toast.info('Select or add a visual card first to bind dataset fields.')
      return
    }
    if (selectedVisual.type === 'TEXT' || selectedVisual.query?.source?.kind === 'material_balance' || selectedVisual.query?.source?.kind === 'tank_snapshot') {
      toast.info('Switch this visual’s data source to a tabular dataset to toggle custom fields.')
      return
    }
    const colKey = makeSafeKey(rawField.column || rawField.label)
    updateVisualById(selectedVisual.id, (v) => {
      const currentCols = Array.isArray(v.query?.columns) ? v.query.columns : []
      const exists = currentCols.some((c) => c.source?.column === rawField.column || c.key === colKey)
      let nextCols
      if (exists) {
        if (currentCols.length <= 1) return v
        nextCols = currentCols.filter((c) => c.source?.column !== rawField.column && c.key !== colKey)
      } else {
        nextCols = [
          ...currentCols,
          {
            key: colKey,
            label: rawField.label || rawField.column,
            kind: 'data',
            source: {
              type: rawField.source_type || 'column',
              column: rawField.column,
              template_id: rawField.template_id,
            },
            data_type: rawField.data_type || 'text',
            aggregate: rawField.data_type === 'number' ? 'SUM' : 'FIRST',
            show_total: rawField.data_type === 'number',
            format: { decimals: rawField.data_type === 'number' ? 2 : 0 },
          },
        ]
      }
      const nextDim = nextCols.some((c) => c.key === v.query?.dimension_key)
        ? v.query.dimension_key
        : (nextCols.find((c) => c.data_type !== 'number')?.key || nextCols[0]?.key || '')
      const nextMeas = nextCols.some((c) => c.key === v.query?.measure_key)
        ? v.query.measure_key
        : (nextCols.find((c) => c.data_type === 'number')?.key || nextCols[0]?.key || '')

      return {
        ...v,
        query: {
          ...v.query,
          columns: nextCols,
          dimension_key: nextDim,
          measure_key: nextMeas,
          metric_key: nextMeas,
          group_by: (v.query?.group_by || []).filter((g) => nextCols.some((c) => c.key === g.key)),
        },
      }
    })
  }

  const handleSaveFormulaColumn = ({ label, formula }) => {
    if (!selectedVisual) return
    const key = editingFormulaCol?.key || makeSafeKey(label || 'calc_metric')
    updateVisualById(selectedVisual.id, (v) => {
      const cols = Array.isArray(v.query?.columns) ? v.query.columns : []
      const calcCol = {
        key,
        label: label || 'Calculated Metric',
        kind: 'calculated',
        formula,
        data_type: 'number',
        aggregate: 'SUM',
        show_total: true,
        format: { decimals: 2 },
      }
      const nextCols = editingFormulaCol
        ? cols.map((c) => (c.key === editingFormulaCol.key ? calcCol : c))
        : [...cols, calcCol]
      return {
        ...v,
        query: {
          ...v.query,
          columns: nextCols,
          measure_key: v.query?.measure_key || key,
          metric_key: v.query?.metric_key || key,
        },
      }
    })
    setFormulaModalOpen(false)
    setEditingFormulaCol(null)
    toast.success(`Saved calculated column "${label}". Click Run Preview to evaluate.`)
  }

  const saveDashboard = async (publishAfterSave = null) => {
    if (!name.trim()) {
      toast.error('Please enter a Dashboard Name before saving.')
      return
    }
    if (visibilityScope === 'LOCATION' && !locationCode.trim()) {
      toast.error('Please choose a Location inside Scope & Access when Scope is LOCATION.')
      setAccessModalOpen(true)
      return
    }
    setSaving(true)
    try {
      const cleanDefinition = {
        ...definition,
        schema_version: 2,
        layout: normalizeLayoutForGridStack(definition.layout, definition.visuals || []),
      }
      const payload = {
        name: name.trim(),
        description: description.trim() || null,
        visibility_scope: visibilityScope,
        location_code: locationCode.trim() || null,
        definition_json: cleanDefinition,
        grants,
      }
      const saved = isNew
        ? await createAnalyticsDefinition(payload)
        : await updateAnalyticsDefinition(id, payload)

      if (publishAfterSave !== null && canPublish) {
        await publishAnalyticsDefinition(saved.id, Boolean(publishAfterSave))
        setIsPublished(Boolean(publishAfterSave))
      }

      setVersionNum(Number(saved.version) || versionNum + 1)
      logUiAction({
        module: 'Analytics',
        action: isNew ? 'Create Dashboard' : 'Update Dashboard',
        entityType: 'AnalyticsDashboardDefinition',
        entityId: String(saved.id),
      })
      toast.success(publishAfterSave ? 'Dashboard saved and published.' : 'Analytics dashboard saved.')
      if (isNew) {
        navigate(`/analytics/studio/${saved.id}`, { replace: true })
      }
    } catch (err) {
      toast.error(err.message || 'Unable to save analytics dashboard.')
    } finally {
      setSaving(false)
    }
  }

  const openVersionHistory = async () => {
    if (isNew) return
    setHistoryModalOpen(true)
    setLoadingVersions(true)
    try {
      const list = await getAnalyticsVersions(id)
      setVersions(Array.isArray(list) ? list : [])
    } catch (err) {
      toast.error(err.message || 'Unable to load version history.')
    } finally {
      setLoadingVersions(false)
    }
  }

  const handleRevertVersion = async (ver) => {
    const ok = await confirm({
      title: `Revert to Version v${ver.version}`,
      message: `Restore dashboard layout, visuals, and slicers from Version v${ver.version} (${String(ver.created_at || '').slice(0, 19).replace('T', ' ')})? A new audit snapshot will be recorded.`,
      confirmLabel: `Restore v${ver.version}`,
      cancelLabel: 'Cancel',
    })
    if (!ok) return
    try {
      const restored = await revertAnalyticsDefinition(id, { version_id: ver.id })
      const rawDef = restored.definition_json || EMPTY_DEFINITION
      const hydrated = {
        ...EMPTY_DEFINITION,
        ...rawDef,
        layout: normalizeLayoutForGridStack(rawDef.layout, rawDef.visuals || []),
      }
      setDefinition(hydrated)
      setVersionNum(Number(restored.version) || versionNum + 1)
      setHistoryModalOpen(false)
      toast.success(`Reverted dashboard to v${ver.version}.`)
      executePreview(hydrated)
    } catch (err) {
      toast.error(err.message || 'Unable to revert dashboard version.')
    }
  }

  // Filtered dataset fields for the Left Field Explorer
  const filteredDatasetFields = useMemo(() => {
    const cols = Array.isArray(selectedDataset?.columns) ? selectedDataset.columns : []
    const q = fieldSearch.trim().toLowerCase()
    if (!q) return cols
    return cols.filter((c) => (
      String(c.label || '').toLowerCase().includes(q)
      || String(c.column || '').toLowerCase().includes(q)
    ))
  }, [fieldSearch, selectedDataset])

  const selectedVisualColumns = useMemo(
    () => (Array.isArray(selectedVisual?.query?.columns) ? selectedVisual.query.columns : []),
    [selectedVisual]
  )

  if (loading) {
    return (
      <div className="page-shell analytics-page">
        <div className="card">Loading Analytics Studio…</div>
      </div>
    )
  }

  return (
    <div className="page-shell analytics-page analytics-studio-shell">
      {/* Studio Top Bar */}
      <div className="analytics-studio-topbar card">
        <div className="analytics-studio-meta-inputs">
          <div className="analytics-studio-name-field">
            <label htmlFor="studio-dash-name">Dashboard Title</label>
            <input
              id="studio-dash-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Terminal Stock & Movement Executive Overview"
            />
          </div>
          <div className="analytics-studio-desc-field">
            <label htmlFor="studio-dash-desc">Subtitle / Operational Purpose</label>
            <input
              id="studio-dash-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional executive summary shown in the dashboard header"
            />
          </div>
        </div>

        <div className="analytics-studio-toolbar-row">
          <div className="analytics-studio-toolbar-left">
            <select
              className="analytics-blueprint-select"
              aria-label="Load starter blueprint"
              value=""
              onChange={(e) => applyBlueprint(e.target.value)}
            >
              <option value="">Load Blueprint…</option>
              {starterTemplates.map((tpl) => (
                <option key={tpl.id} value={tpl.id}>{tpl.name}</option>
              ))}
            </select>

            <label className="analytics-canvas-mode-toggle" title="Float mode lets widgets sit anywhere vertically without auto-compacting upward">
              <input
                type="checkbox"
                checked={Boolean(definition.canvas?.floatMode)}
                onChange={(e) => setDefinition((prev) => ({
                  ...prev,
                  canvas: { ...(prev.canvas || {}), floatMode: e.target.checked },
                }))}
              />
              <span>Free-Float Grid</span>
            </label>

            <div className="analytics-studio-preview-dates">
              <span>Preview Range:</span>
              <input
                type="date"
                aria-label="Preview from date"
                value={previewDateFrom}
                onChange={(e) => setPreviewDateFrom(e.target.value)}
              />
              <span>–</span>
              <input
                type="date"
                aria-label="Preview to date"
                value={previewDateTo}
                onChange={(e) => setPreviewDateTo(e.target.value)}
              />
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() => executePreview(definition)}
                disabled={previewing}
              >
                <Icon name="refresh" size={14} /> {previewing ? 'Running…' : 'Run Preview'}
              </button>
            </div>
          </div>

          <div className="analytics-studio-toolbar-right">
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() => setAccessModalOpen(true)}
            >
              <Icon name="shield" size={14} /> Scope: {visibilityScope}
              {grants.length > 0 ? ` (${grants.length})` : ''}
            </button>

            {!isNew && (
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={openVersionHistory}
              >
                <Icon name="history" size={14} /> v{versionNum} History
              </button>
            )}

            {!isNew && (
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() => navigate(`/analytics/view/${id}`)}
              >
                <Icon name="eye" size={14} /> Viewer
              </button>
            )}

            <button
              type="button"
              className="btn-secondary"
              onClick={() => navigate('/analytics')}
            >
              Back
            </button>

            <button
              type="button"
              className="btn-primary"
              onClick={() => saveDashboard(null)}
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Save Draft'}
            </button>

            {canPublish && (
              <button
                type="button"
                className={isPublished ? 'btn-secondary' : 'btn-primary'}
                onClick={() => saveDashboard(!isPublished)}
                disabled={saving}
              >
                {isPublished ? 'Save & Unpublish' : 'Save & Publish'}
              </button>
            )}
          </div>
        </div>
      </div>

      {error && <AlertMessage tone="error" message={error} />}

      {/* 3-Pane Studio Workspace */}
      <div className="analytics-studio-3pane">
        {/* LEFT PANE: Visual Palette & Dataset Field Explorer */}
        <aside className="card analytics-studio-left">
          <div className="analytics-pane-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={leftTab === 'visuals'}
              className={leftTab === 'visuals' ? 'is-active' : ''}
              onClick={() => setLeftTab('visuals')}
            >
              <Icon name="barChart" size={14} /> Visuals ({VISUAL_CATALOG.length})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={leftTab === 'fields'}
              className={leftTab === 'fields' ? 'is-active' : ''}
              onClick={() => setLeftTab('fields')}
            >
              <Icon name="database" size={14} /> Data Fields
            </button>
          </div>

          {leftTab === 'visuals' ? (
            <div className="analytics-palette-scroll">
              <div className="analytics-palette-dataset-box">
                <label htmlFor="palette-default-ds">Default Dataset for New Visuals</label>
                <select
                  id="palette-default-ds"
                  value={activeDatasetId}
                  onChange={(e) => setActiveDatasetId(e.target.value)}
                >
                  {(catalog.datasets || []).map((ds) => (
                    <option key={ds.id} value={ds.id}>{ds.label}</option>
                  ))}
                </select>
                <small>Drag any tile onto the 12-col GridStack canvas or click to append.</small>
              </div>

              {VISUAL_GROUPS.map((grp) => {
                const items = VISUAL_CATALOG.filter((v) => v.group === grp.id)
                return (
                  <div key={grp.id} className="analytics-palette-group">
                    <h5>{grp.label}</h5>
                    <div className="analytics-palette-tiles">
                      {items.map((item) => (
                        <button
                          key={item.type}
                          type="button"
                          className="analytics-palette-drag-item grid-stack-item"
                          gs-w={item.defaultW}
                          gs-h={item.defaultH}
                          data-visual-type={item.type}
                          title={`${item.label} — ${item.description}`}
                          onClick={() => addVisualToCanvas(item.type)}
                        >
                          <Icon name={item.icon} size={16} />
                          <span>{item.shortLabel}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="analytics-field-explorer">
              <div className="analytics-palette-dataset-box">
                <label htmlFor="explorer-ds-select">
                  {selectedVisual ? `Dataset for "${selectedVisual.title}"` : 'Browse Dataset'}
                </label>
                <select
                  id="explorer-ds-select"
                  value={selectedVisual?.query?.source?.kind || activeDatasetId}
                  onChange={(e) => {
                    const nextKind = e.target.value
                    setActiveDatasetId(nextKind)
                    if (selectedVisual && selectedVisual.type !== 'TEXT') {
                      const ds = (catalog.datasets || []).find((d) => d.kind === nextKind || d.id === nextKind)
                      if (ds) {
                        const rebuilt = buildQueryFromDataset(ds, selectedVisual.type, selectedVisual.title)
                        updateVisualById(selectedVisual.id, { query: rebuilt.query, explorer: rebuilt.explorer })
                      }
                    }
                  }}
                >
                  {(catalog.datasets || []).map((ds) => (
                    <option key={ds.id} value={ds.kind}>{ds.label}</option>
                  ))}
                </select>
              </div>

              <div className="analytics-field-search-box">
                <Icon name="search" size={14} />
                <input
                  type="search"
                  value={fieldSearch}
                  onChange={(e) => setFieldSearch(e.target.value)}
                  placeholder="Search dataset columns…"
                />
              </div>

              {selectedVisual && selectedVisual.type !== 'TEXT' && selectedDataset?.kind !== 'material_balance' && selectedDataset?.kind !== 'tank_snapshot' && (
                <button
                  type="button"
                  className="btn-secondary btn-sm analytics-fx-btn"
                  onClick={() => {
                    setEditingFormulaCol(null)
                    setFormulaModalOpen(true)
                  }}
                >
                  <Icon name="calculator" size={14} /> + Calculated Formula (fx)
                </button>
              )}

              <div className="analytics-field-list">
                {filteredDatasetFields.map((col) => {
                  const checked = selectedVisualColumns.some(
                    (c) => c.source?.column === col.column || c.key === makeSafeKey(col.column)
                  )
                  return (
                    <label key={`${col.source_type || 'col'}-${col.column}`} className={`analytics-field-row ${checked ? 'is-checked' : ''}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleFieldOnSelectedVisual(col)}
                      />
                      <span className="analytics-field-name">{col.label || col.column}</span>
                      <small className={`analytics-dtype-badge dtype-${col.data_type || 'text'}`}>
                        {col.data_type === 'number' ? '#' : (col.data_type === 'date' ? '📅' : 'Abc')}
                      </small>
                    </label>
                  )
                })}
                {!filteredDatasetFields.length && (
                  <p className="analytics-muted-hint">
                    {selectedDataset?.kind === 'tank_snapshot' || selectedDataset?.kind === 'material_balance'
                      ? 'Pre-modeled engine dataset with built-in stock, inflow, outflow, and ullage columns.'
                      : 'No columns matched search.'}
                  </p>
                )}
              </div>
            </div>
          )}
        </aside>

        {/* CENTER PANE: Interactive 12-Col GridStack Canvas */}
        <section className="analytics-studio-canvas-pane">
          {(definition.visuals || []).length === 0 ? (
            <div className="card analytics-empty-canvas">
              <Icon name="grid" size={28} />
              <h3>12-Column Interactive GridStack Canvas</h3>
              <p>
                Click or drag any KPI, Shore Tank, Perspective Pivot Grid, Apache ECharts, or Plotly visual from the left palette — or load a Quick-Start Terminal Blueprint from the top toolbar.
              </p>
              <div className="analytics-empty-canvas-actions">
                {starterTemplates.map((tpl) => (
                  <button
                    key={tpl.id}
                    type="button"
                    className="btn-secondary"
                    onClick={() => applyBlueprint(tpl.id)}
                  >
                    <Icon name="compass" size={15} /> {tpl.name}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <GridStackCanvas
              visuals={definition.visuals}
              layout={definition.layout}
              editable
              floatMode={Boolean(definition.canvas?.floatMode)}
              cellHeight={Number(definition.canvas?.cellHeight) || 64}
              margin={Number(definition.canvas?.margin) || 14}
              selectedId={selectedVisualId}
              onSelectVisual={(vid) => setSelectedVisualId(vid)}
              onLayoutChange={(nextLayout) => setDefinition((prev) => ({ ...prev, layout: nextLayout }))}
              onExternalDrop={(visType, coords) => addVisualToCanvas(visType, coords)}
              renderVisual={(visual, layoutItem) => (
                <AnalyticsVisual
                  visual={visual}
                  result={previewResults[visual.id]}
                  loading={previewing}
                  editable
                  isLocked={Boolean(layoutItem?.locked)}
                  onEditVisual={(vid) => {
                    setSelectedVisualId(vid)
                    setInspectorTab('data')
                  }}
                  onDuplicateVisual={handleDuplicateVisual}
                  onDeleteVisual={handleDeleteVisual}
                  onToggleLock={handleToggleLock}
                  onExplorerChange={(nextExp) => updateVisualById(visual.id, { explorer: nextExp })}
                />
              )}
            />
          )}
        </section>

        {/* RIGHT PANE: Multi-Tab Visual & Slicer Inspector */}
        <aside className="card analytics-studio-right">
          <div className="analytics-pane-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={inspectorTab === 'data'}
              className={inspectorTab === 'data' ? 'is-active' : ''}
              onClick={() => setInspectorTab('data')}
            >
              Data
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={inspectorTab === 'perspective'}
              className={inspectorTab === 'perspective' ? 'is-active' : ''}
              onClick={() => setInspectorTab('perspective')}
            >
              Pivot &amp; Rules
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={inspectorTab === 'style'}
              className={inspectorTab === 'style' ? 'is-active' : ''}
              onClick={() => setInspectorTab('style')}
            >
              Style
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={inspectorTab === 'slicers'}
              className={inspectorTab === 'slicers' ? 'is-active' : ''}
              onClick={() => setInspectorTab('slicers')}
            >
              Slicers ({definition.slicers?.length || 0})
            </button>
          </div>

          <div className="analytics-inspector-scroll">
            {inspectorTab === 'slicers' ? (
              <div className="analytics-inspector-section">
                <div className="analytics-section-head">
                  <h4>Global Slicers</h4>
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={() => {
                      const firstVis = definition.visuals?.[0]
                      const defaultCol = firstVis?.query?.columns?.[0]?.key || 'product_name'
                      const newSlicer = {
                        id: `slicer_${Date.now().toString(36)}`,
                        key: `s_${makeSafeKey(defaultCol)}_${(definition.slicers?.length || 0) + 1}`,
                        label: 'Product / Tank Filter',
                        type: 'SELECT',
                        column_key: defaultCol,
                        field: defaultCol,
                        visual_ids: (definition.visuals || []).filter((v) => v.type !== 'TEXT').map((v) => v.id),
                        config: { multi: true, allowAll: true },
                      }
                      setDefinition((prev) => ({ ...prev, slicers: [...(prev.slicers || []), newSlicer] }))
                    }}
                  >
                    <Icon name="plus" size={13} /> Add Slicer
                  </button>
                </div>

                {(definition.slicers || []).map((slicer, idx) => (
                  <div key={slicer.id || idx} className="analytics-slicer-editor-card">
                    <div className="analytics-slicer-editor-top">
                      <strong>{slicer.label || slicer.key}</strong>
                      <button
                        type="button"
                        className="btn-link is-danger"
                        onClick={() => setDefinition((prev) => ({
                          ...prev,
                          slicers: prev.slicers.filter((_, i) => i !== idx),
                        }))}
                      >
                        Remove
                      </button>
                    </div>
                    <label>
                      Label
                      <input
                        value={slicer.label || ''}
                        onChange={(e) => setDefinition((prev) => ({
                          ...prev,
                          slicers: prev.slicers.map((s, i) => (i === idx ? { ...s, label: e.target.value } : s)),
                        }))}
                      />
                    </label>
                    <label>
                      Control Type
                      <select
                        value={slicer.type || 'SELECT'}
                        onChange={(e) => setDefinition((prev) => ({
                          ...prev,
                          slicers: prev.slicers.map((s, i) => (i === idx ? { ...s, type: e.target.value } : s)),
                        }))}
                      >
                        <option value="SELECT">Multi-Select Dropdown</option>
                        <option value="SINGLE_DATE">Single Date</option>
                        <option value="DATE_RANGE">Date Range</option>
                        <option value="TEXT">Text Contains</option>
                        <option value="NUMBER">Numeric Equals</option>
                      </select>
                    </label>
                    <label>
                      Bound Column Key
                      <input
                        value={slicer.column_key || slicer.field || ''}
                        placeholder="e.g. product_name or tank_asset_code"
                        onChange={(e) => setDefinition((prev) => ({
                          ...prev,
                          slicers: prev.slicers.map((s, i) => (
                            i === idx ? { ...s, column_key: e.target.value, field: e.target.value } : s
                          )),
                        }))}
                      />
                    </label>
                    <div className="analytics-slicer-targets">
                      <span>Target Visuals:</span>
                      {(definition.visuals || []).filter((v) => v.type !== 'TEXT').map((v) => {
                        const checked = (slicer.visual_ids || []).includes(v.id)
                        return (
                          <label key={v.id} className="analytics-mini-check">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {
                                const cur = new Set(slicer.visual_ids || [])
                                if (checked) cur.delete(v.id)
                                else cur.add(v.id)
                                setDefinition((prev) => ({
                                  ...prev,
                                  slicers: prev.slicers.map((s, i) => (
                                    i === idx ? { ...s, visual_ids: [...cur] } : s
                                  )),
                                }))
                              }}
                            />
                            <span>{v.title}</span>
                          </label>
                        )
                      })}
                    </div>
                  </div>
                ))}
                {!(definition.slicers || []).length && (
                  <p className="analytics-muted-hint">
                    Date Range, Single Date, and Location slicers are built in automatically. Add custom slicers here for Product, Tank, Operation Type, or Status.
                  </p>
                )}
              </div>
            ) : !selectedVisual ? (
              <p className="analytics-muted-hint">
                Click any visual card on the canvas to inspect and edit its data bindings, Perspective pivot rules, and chart styling.
              </p>
            ) : inspectorTab === 'data' ? (
              <div className="analytics-inspector-section">
                <label>
                  Visual Title
                  <input
                    value={selectedVisual.title || ''}
                    onChange={(e) => updateVisualById(selectedVisual.id, { title: e.target.value })}
                  />
                </label>

                <label>
                  Subtitle (optional)
                  <input
                    value={selectedVisual.subtitle || ''}
                    onChange={(e) => updateVisualById(selectedVisual.id, { subtitle: e.target.value })}
                    placeholder="e.g. NSV Barrels · Approved Entries"
                  />
                </label>

                <label>
                  Visual Type
                  <select
                    value={selectedVisual.type}
                    onChange={(e) => {
                      const nextType = e.target.value
                      const defaults = defaultLayoutForVisualType(nextType)
                      updateVisualById(selectedVisual.id, { type: nextType })
                      setDefinition((prev) => ({
                        ...prev,
                        layout: normalizeLayoutForGridStack(prev.layout, prev.visuals).map((l) => (
                          String(l.i) === String(selectedVisual.id)
                            ? { ...l, w: Math.max(l.w, defaults.minW), h: Math.max(l.h, defaults.minH), minW: defaults.minW, minH: defaults.minH }
                            : l
                        )),
                      }))
                    }}
                  >
                    {VISUAL_CATALOG.map((vc) => (
                      <option key={vc.type} value={vc.type}>{vc.label}</option>
                    ))}
                  </select>
                </label>

                {selectedVisual.type === 'TEXT' ? (
                  <label>
                    Note / Callout Content
                    <textarea
                      rows={6}
                      value={selectedVisual.text || ''}
                      onChange={(e) => updateVisualById(selectedVisual.id, { text: e.target.value })}
                    />
                  </label>
                ) : selectedVisual.query?.source?.kind === 'tank_snapshot' || selectedVisual.type === 'TANK_VISUAL' ? (
                  <label>
                    Stock &amp; Capacity Basis
                    <select
                      value={selectedVisual.query?.unit || 'nsv'}
                      onChange={(e) => updateVisualById(selectedVisual.id, {
                        query: { ...selectedVisual.query, unit: e.target.value },
                      })}
                    >
                      <option value="nsv">Net Standard Volume (NSV BBL)</option>
                      <option value="gsv">Gross Standard Volume (GSV BBL)</option>
                    </select>
                  </label>
                ) : selectedVisual.query?.source?.kind === 'material_balance' ? (
                  <>
                    <label>
                      Volume Basis
                      <select
                        value={selectedVisual.query?.unit || 'nsv'}
                        onChange={(e) => updateVisualById(selectedVisual.id, {
                          query: { ...selectedVisual.query, unit: e.target.value },
                        })}
                      >
                        <option value="nsv">NSV (BBL)</option>
                        <option value="gsv">GSV (BBL)</option>
                      </select>
                    </label>
                    <label>
                      Primary Metric
                      <select
                        value={selectedVisual.query?.measure_key || 'closing_stock'}
                        onChange={(e) => updateVisualById(selectedVisual.id, {
                          query: { ...selectedVisual.query, measure_key: e.target.value, metric_key: e.target.value },
                        })}
                      >
                        <option value="opening_stock">Opening Stock</option>
                        <option value="total_in">Total Receipts (In)</option>
                        <option value="total_out">Total Dispatches (Out)</option>
                        <option value="closing_stock">Closing Stock</option>
                        <option value="loss_gain">Loss / Gain Variance</option>
                      </select>
                    </label>
                  </>
                ) : (
                  <>
                    <label>
                      Date Basis
                      <select
                        value={selectedVisual.query?.date_basis || 'ACCOUNTING_DATE'}
                        onChange={(e) => updateVisualById(selectedVisual.id, {
                          query: { ...selectedVisual.query, date_basis: e.target.value },
                        })}
                      >
                        <option value="ACCOUNTING_DATE">Accounting Date</option>
                        <option value="OPERATIONAL_DATE">Operational / Reading Date</option>
                      </select>
                    </label>

                    <label>
                      Category / X-Axis Dimension
                      <select
                        value={selectedVisual.query?.dimension_key || ''}
                        onChange={(e) => updateVisualById(selectedVisual.id, {
                          query: { ...selectedVisual.query, dimension_key: e.target.value },
                        })}
                      >
                        <option value="">(None)</option>
                        {selectedVisualColumns.map((c) => (
                          <option key={c.key} value={c.key}>{c.label || c.key}</option>
                        ))}
                      </select>
                    </label>

                    {['SANKEY', 'TREEMAP', 'SUNBURST', 'HEATMAP', 'SURFACE_3D'].includes(selectedVisual.type) && (
                      <label>
                        Secondary Dimension (Target / Sub-ring / Y)
                        <select
                          value={selectedVisual.query?.secondary_dimension_key || ''}
                          onChange={(e) => updateVisualById(selectedVisual.id, {
                            query: { ...selectedVisual.query, secondary_dimension_key: e.target.value || undefined },
                          })}
                        >
                          <option value="">(Auto)</option>
                          {selectedVisualColumns.map((c) => (
                            <option key={c.key} value={c.key}>{c.label || c.key}</option>
                          ))}
                        </select>
                      </label>
                    )}

                    <label>
                      Primary Metric / Y-Axis
                      <select
                        value={selectedVisual.query?.measure_key || selectedVisual.query?.metric_key || ''}
                        onChange={(e) => updateVisualById(selectedVisual.id, {
                          query: {
                            ...selectedVisual.query,
                            measure_key: e.target.value,
                            metric_key: e.target.value,
                          },
                        })}
                      >
                        {selectedVisualColumns.map((c) => (
                          <option key={c.key} value={c.key}>{c.label || c.key}</option>
                        ))}
                      </select>
                    </label>

                    <div className="analytics-inspector-subbox">
                      <div className="analytics-section-head">
                        <span>Server Group By</span>
                        <select
                          className="analytics-shelf-adder"
                          value=""
                          onChange={(e) => {
                            if (!e.target.value) return
                            const cur = selectedVisual.query?.group_by || []
                            if (cur.some((g) => g.key === e.target.value)) return
                            updateVisualById(selectedVisual.id, {
                              query: { ...selectedVisual.query, group_by: [...cur, { key: e.target.value, bucket: 'VALUE' }] },
                            })
                          }}
                        >
                          <option value="">+ Add Group</option>
                          {selectedVisualColumns.map((c) => (
                            <option key={c.key} value={c.key}>{c.label || c.key}</option>
                          ))}
                        </select>
                      </div>
                      {(selectedVisual.query?.group_by || []).map((gb, gIdx) => {
                        const col = selectedVisualColumns.find((c) => c.key === gb.key)
                        return (
                          <div key={gb.key} className="analytics-gb-item">
                            <span>{col?.label || gb.key}</span>
                            <select
                              value={gb.bucket || 'VALUE'}
                              onChange={(e) => {
                                const nextGb = (selectedVisual.query?.group_by || []).map((item, i) => (
                                  i === gIdx ? { ...item, bucket: e.target.value } : item
                                ))
                                updateVisualById(selectedVisual.id, { query: { ...selectedVisual.query, group_by: nextGb } })
                              }}
                            >
                              {BUCKET_OPTIONS.map((b) => (
                                <option key={b.value} value={b.value}>{b.label}</option>
                              ))}
                            </select>
                            <button
                              type="button"
                              className="btn-link is-danger"
                              onClick={() => updateVisualById(selectedVisual.id, {
                                query: {
                                  ...selectedVisual.query,
                                  group_by: (selectedVisual.query?.group_by || []).filter((_, i) => i !== gIdx),
                                },
                              })}
                            >
                              ×
                            </button>
                          </div>
                        )
                      })}
                    </div>

                    <div className="analytics-inspector-subbox">
                      <div className="analytics-section-head">
                        <span>Selected Columns ({selectedVisualColumns.length})</span>
                        <button
                          type="button"
                          className="btn-link"
                          onClick={() => {
                            setEditingFormulaCol(null)
                            setFormulaModalOpen(true)
                          }}
                        >
                          + fx
                        </button>
                      </div>
                      {selectedVisualColumns.map((col, cIdx) => (
                        <div key={col.key} className="analytics-col-config-row">
                          <div className="analytics-col-config-head">
                            <strong>{col.label}</strong>
                            <div>
                              {col.kind === 'calculated' && (
                                <button
                                  type="button"
                                  className="btn-link"
                                  onClick={() => {
                                    setEditingFormulaCol(col)
                                    setFormulaModalOpen(true)
                                  }}
                                >
                                  Edit fx
                                </button>
                              )}
                              {selectedVisualColumns.length > 1 && (
                                <button
                                  type="button"
                                  className="btn-link is-danger"
                                  onClick={() => updateVisualById(selectedVisual.id, {
                                    query: {
                                      ...selectedVisual.query,
                                      columns: selectedVisualColumns.filter((_, i) => i !== cIdx),
                                    },
                                  })}
                                >
                                  ×
                                </button>
                              )}
                            </div>
                          </div>
                          <div className="analytics-col-config-controls">
                            <select
                              aria-label={`Aggregate for ${col.label}`}
                              value={col.aggregate || 'SUM'}
                              onChange={(e) => {
                                const nextCols = selectedVisualColumns.map((item, i) => (
                                  i === cIdx ? { ...item, aggregate: e.target.value } : item
                                ))
                                updateVisualById(selectedVisual.id, { query: { ...selectedVisual.query, columns: nextCols } })
                              }}
                            >
                              {REPORT_AGG_OPTIONS.map((agg) => (
                                <option key={agg} value={agg}>{agg}</option>
                              ))}
                            </select>
                            {col.data_type === 'number' && (
                              <input
                                type="number"
                                min={0}
                                max={6}
                                title="Decimal places"
                                value={col.format?.decimals ?? 2}
                                onChange={(e) => {
                                  const nextCols = selectedVisualColumns.map((item, i) => (
                                    i === cIdx ? { ...item, format: { ...(item.format || {}), decimals: Number(e.target.value) } } : item
                                  ))
                                  updateVisualById(selectedVisual.id, { query: { ...selectedVisual.query, columns: nextCols } })
                                }}
                              />
                            )}
                          </div>
                        </div>
                      ))}
                    </div>

                    <button
                      type="button"
                      className="btn-primary btn-sm"
                      onClick={() => executePreview(definition)}
                      disabled={previewing}
                    >
                      <Icon name="refresh" size={14} /> Apply &amp; Refresh Visual
                    </button>
                  </>
                )}
              </div>
            ) : inspectorTab === 'perspective' ? (
              <div className="analytics-inspector-section">
                <label className="analytics-mini-check">
                  <input
                    type="checkbox"
                    checked={Boolean(selectedVisual.explorer?.showShelfByDefault)}
                    onChange={(e) => updateVisualById(selectedVisual.id, {
                      explorer: { ...(selectedVisual.explorer || {}), showShelfByDefault: e.target.checked },
                    })}
                  />
                  <span>Show Perspective Pivot Shelf Expanded by Default</span>
                </label>

                <label className="analytics-mini-check">
                  <input
                    type="checkbox"
                    checked={selectedVisual.style?.table?.dataBars !== false}
                    onChange={(e) => updateVisualById(selectedVisual.id, {
                      style: {
                        ...(selectedVisual.style || {}),
                        table: { ...(selectedVisual.style?.table || {}), dataBars: e.target.checked },
                      },
                    })}
                  />
                  <span>Render Inline Numeric Data Bars</span>
                </label>

                <label>
                  Cell Heatmap Scale
                  <select
                    value={selectedVisual.style?.table?.colorScale || 'none'}
                    onChange={(e) => updateVisualById(selectedVisual.id, {
                      style: {
                        ...(selectedVisual.style || {}),
                        table: { ...(selectedVisual.style?.table || {}), colorScale: e.target.value },
                      },
                    })}
                  >
                    <option value="none">None</option>
                    <option value="diverging">Diverging Green / Crimson (±)</option>
                    <option value="navy">Sequential Navy Intensity</option>
                    <option value="emerald">Sequential Emerald</option>
                    <option value="amber">Sequential Amber</option>
                  </select>
                </label>

                {/* Conditional Formatting Rules */}
                <div className="analytics-inspector-subbox">
                  <div className="analytics-section-head">
                    <span>Conditional Cell Rules</span>
                    <button
                      type="button"
                      className="btn-link"
                      onClick={() => {
                        const cur = selectedVisual.style?.table?.conditionalRules || []
                        const defaultKey = selectedVisualColumns.find((c) => c.data_type === 'number')?.key || selectedVisualColumns[0]?.key || ''
                        updateVisualById(selectedVisual.id, {
                          style: {
                            ...(selectedVisual.style || {}),
                            table: {
                              ...(selectedVisual.style?.table || {}),
                              conditionalRules: [
                                ...cur,
                                { id: `rule_${Date.now()}`, columnKey: defaultKey, operator: 'lt', value: '0', tone: 'danger' },
                              ],
                            },
                          },
                        })
                      }}
                    >
                      + Rule
                    </button>
                  </div>
                  {(selectedVisual.style?.table?.conditionalRules || []).map((rule, rIdx) => (
                    <div key={rule.id || rIdx} className="analytics-cond-rule-card">
                      <select
                        value={rule.columnKey || ''}
                        onChange={(e) => {
                          const rules = (selectedVisual.style?.table?.conditionalRules || []).map((r, i) => (
                            i === rIdx ? { ...r, columnKey: e.target.value } : r
                          ))
                          updateVisualById(selectedVisual.id, {
                            style: { ...(selectedVisual.style || {}), table: { ...(selectedVisual.style?.table || {}), conditionalRules: rules } },
                          })
                        }}
                      >
                        <option value="">Any Column</option>
                        {selectedVisualColumns.map((c) => (
                          <option key={c.key} value={c.key}>{c.label || c.key}</option>
                        ))}
                      </select>
                      <div className="analytics-cond-rule-inline">
                        <select
                          value={rule.operator || 'lt'}
                          onChange={(e) => {
                            const rules = (selectedVisual.style?.table?.conditionalRules || []).map((r, i) => (
                              i === rIdx ? { ...r, operator: e.target.value } : r
                            ))
                            updateVisualById(selectedVisual.id, {
                              style: { ...(selectedVisual.style || {}), table: { ...(selectedVisual.style?.table || {}), conditionalRules: rules } },
                            })
                          }}
                        >
                          <option value="lt">&lt;</option>
                          <option value="lte">≤</option>
                          <option value="gt">&gt;</option>
                          <option value="gte">≥</option>
                          <option value="eq">=</option>
                          <option value="contains">Contains</option>
                        </select>
                        <input
                          value={rule.value ?? ''}
                          placeholder="Threshold"
                          onChange={(e) => {
                            const rules = (selectedVisual.style?.table?.conditionalRules || []).map((r, i) => (
                              i === rIdx ? { ...r, value: e.target.value } : r
                            ))
                            updateVisualById(selectedVisual.id, {
                              style: { ...(selectedVisual.style || {}), table: { ...(selectedVisual.style?.table || {}), conditionalRules: rules } },
                            })
                          }}
                        />
                        <select
                          value={rule.tone || 'danger'}
                          onChange={(e) => {
                            const rules = (selectedVisual.style?.table?.conditionalRules || []).map((r, i) => (
                              i === rIdx ? { ...r, tone: e.target.value } : r
                            ))
                            updateVisualById(selectedVisual.id, {
                              style: { ...(selectedVisual.style || {}), table: { ...(selectedVisual.style?.table || {}), conditionalRules: rules } },
                            })
                          }}
                        >
                          <option value="danger">Danger (Red)</option>
                          <option value="warning">Warning (Amber)</option>
                          <option value="success">Success (Green)</option>
                          <option value="info">Info (Blue)</option>
                        </select>
                        <button
                          type="button"
                          className="btn-link is-danger"
                          onClick={() => {
                            const rules = (selectedVisual.style?.table?.conditionalRules || []).filter((_, i) => i !== rIdx)
                            updateVisualById(selectedVisual.id, {
                              style: { ...(selectedVisual.style || {}), table: { ...(selectedVisual.style?.table || {}), conditionalRules: rules } },
                            })
                          }}
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              /* STYLE & INTERACTIONS TAB */
              <div className="analytics-inspector-section">
                {(selectedVisual.type === 'KPI_CARD' || selectedVisual.type === 'GAUGE' || selectedVisual.type === 'INDICATOR_BULLET') && (
                  <>
                    <label>
                      Unit Suffix (e.g. " BBL" or "%")
                      <input
                        value={selectedVisual.style?.kpi?.suffix ?? ''}
                        onChange={(e) => updateVisualById(selectedVisual.id, {
                          style: { ...(selectedVisual.style || {}), kpi: { ...(selectedVisual.style?.kpi || {}), suffix: e.target.value } },
                        })}
                      />
                    </label>
                    <label>
                      Decimal Places
                      <input
                        type="number"
                        min={0}
                        max={6}
                        value={selectedVisual.style?.kpi?.decimals ?? 1}
                        onChange={(e) => updateVisualById(selectedVisual.id, {
                          style: { ...(selectedVisual.style || {}), kpi: { ...(selectedVisual.style?.kpi || {}), decimals: Number(e.target.value) } },
                        })}
                      />
                    </label>
                    <label>
                      Target / Reference Value
                      <input
                        type="number"
                        value={selectedVisual.style?.kpi?.targetValue ?? ''}
                        placeholder="Optional target threshold"
                        onChange={(e) => updateVisualById(selectedVisual.id, {
                          style: {
                            ...(selectedVisual.style || {}),
                            kpi: { ...(selectedVisual.style?.kpi || {}), targetValue: e.target.value === '' ? null : Number(e.target.value) },
                          },
                        })}
                      />
                    </label>
                    <label className="analytics-mini-check">
                      <input
                        type="checkbox"
                        checked={Boolean(selectedVisual.style?.kpi?.compact)}
                        onChange={(e) => updateVisualById(selectedVisual.id, {
                          style: { ...(selectedVisual.style || {}), kpi: { ...(selectedVisual.style?.kpi || {}), compact: e.target.checked } },
                        })}
                      />
                      <span>Compact Number Notation (1.2M / 45K)</span>
                    </label>
                    <label className="analytics-mini-check">
                      <input
                        type="checkbox"
                        checked={selectedVisual.style?.kpi?.showSparkline !== false}
                        onChange={(e) => updateVisualById(selectedVisual.id, {
                          style: { ...(selectedVisual.style || {}), kpi: { ...(selectedVisual.style?.kpi || {}), showSparkline: e.target.checked } },
                        })}
                      />
                      <span>Show Embedded Trend Sparkline</span>
                    </label>
                  </>
                )}

                {ECHARTS_VISUAL_TYPES.has(selectedVisual.type) && selectedVisual.type !== 'GAUGE' && (
                  <>
                    <label>
                      Series Stack Mode
                      <select
                        value={selectedVisual.style?.chart?.stackMode || 'none'}
                        onChange={(e) => updateVisualById(selectedVisual.id, {
                          style: { ...(selectedVisual.style || {}), chart: { ...(selectedVisual.style?.chart || {}), stackMode: e.target.value } },
                        })}
                      >
                        <option value="none">Clustered / Unstacked</option>
                        <option value="stack">Stacked</option>
                        <option value="percent">100% Proportional Stacked</option>
                      </select>
                    </label>
                    <label>
                      Reference Threshold Line (Y / X Value)
                      <input
                        type="number"
                        value={selectedVisual.style?.chart?.referenceLine ?? ''}
                        placeholder="Optional threshold markLine"
                        onChange={(e) => updateVisualById(selectedVisual.id, {
                          style: {
                            ...(selectedVisual.style || {}),
                            chart: { ...(selectedVisual.style?.chart || {}), referenceLine: e.target.value === '' ? null : Number(e.target.value) },
                          },
                        })}
                      />
                    </label>
                    <label className="analytics-mini-check">
                      <input
                        type="checkbox"
                        checked={selectedVisual.style?.chart?.showLegend !== false}
                        onChange={(e) => updateVisualById(selectedVisual.id, {
                          style: { ...(selectedVisual.style || {}), chart: { ...(selectedVisual.style?.chart || {}), showLegend: e.target.checked } },
                        })}
                      />
                      <span>Show Legend</span>
                    </label>
                    <label className="analytics-mini-check">
                      <input
                        type="checkbox"
                        checked={Boolean(selectedVisual.style?.chart?.showLabels)}
                        onChange={(e) => updateVisualById(selectedVisual.id, {
                          style: { ...(selectedVisual.style || {}), chart: { ...(selectedVisual.style?.chart || {}), showLabels: e.target.checked } },
                        })}
                      />
                      <span>Show Value Callout Labels</span>
                    </label>
                    <label className="analytics-mini-check">
                      <input
                        type="checkbox"
                        checked={Boolean(selectedVisual.style?.chart?.dataZoom)}
                        onChange={(e) => updateVisualById(selectedVisual.id, {
                          style: { ...(selectedVisual.style || {}), chart: { ...(selectedVisual.style?.chart || {}), dataZoom: e.target.checked } },
                        })}
                      />
                      <span>Enable Interactive Zoom Slider (dataZoom)</span>
                    </label>
                    <label className="analytics-mini-check">
                      <input
                        type="checkbox"
                        checked={Boolean(selectedVisual.style?.chart?.smooth)}
                        onChange={(e) => updateVisualById(selectedVisual.id, {
                          style: { ...(selectedVisual.style || {}), chart: { ...(selectedVisual.style?.chart || {}), smooth: e.target.checked } },
                        })}
                      />
                      <span>Smooth Curve Interpolation</span>
                    </label>
                  </>
                )}

                {PLOTLY_VISUAL_TYPES.has(selectedVisual.type) && (
                  <>
                    <label className="analytics-mini-check">
                      <input
                        type="checkbox"
                        checked={selectedVisual.style?.plotly?.showModeBar !== false}
                        onChange={(e) => updateVisualById(selectedVisual.id, {
                          style: { ...(selectedVisual.style || {}), plotly: { ...(selectedVisual.style?.plotly || {}), showModeBar: e.target.checked } },
                        })}
                      />
                      <span>Show Plotly Scientific Modebar on Hover</span>
                    </label>
                    {selectedVisual.type === 'SCATTER' && (
                      <label className="analytics-mini-check">
                        <input
                          type="checkbox"
                          checked={selectedVisual.style?.plotly?.trendline !== false}
                          onChange={(e) => updateVisualById(selectedVisual.id, {
                            style: { ...(selectedVisual.style || {}), plotly: { ...(selectedVisual.style?.plotly || {}), trendline: e.target.checked } },
                          })}
                        />
                        <span>Fit OLS Linear Regression Trendline &amp; R²</span>
                      </label>
                    )}
                    {(selectedVisual.type === 'BOX_PLOT' || selectedVisual.type === 'VIOLIN_PLOT') && (
                      <label className="analytics-mini-check">
                        <input
                          type="checkbox"
                          checked={selectedVisual.style?.plotly?.showOutliers !== false}
                          onChange={(e) => updateVisualById(selectedVisual.id, {
                            style: { ...(selectedVisual.style || {}), plotly: { ...(selectedVisual.style?.plotly || {}), showOutliers: e.target.checked } },
                          })}
                        />
                        <span>Plot Outlier Points &amp; Mean Diamond</span>
                      </label>
                    )}
                  </>
                )}

                <hr className="analytics-divider" />
                <h5>Interactive Behavior</h5>
                <label className="analytics-mini-check">
                  <input
                    type="checkbox"
                    checked={selectedVisual.interactions?.crossFilter !== false}
                    onChange={(e) => updateVisualById(selectedVisual.id, {
                      interactions: { ...(selectedVisual.interactions || {}), crossFilter: e.target.checked },
                    })}
                  />
                  <span>Click-to-Cross-Filter Sibling Visuals</span>
                </label>

                <label className="analytics-mini-check">
                  <input
                    type="checkbox"
                    checked={selectedVisual.explorer?.allowViewSwitch !== false}
                    onChange={(e) => updateVisualById(selectedVisual.id, {
                      explorer: { ...(selectedVisual.explorer || {}), allowViewSwitch: e.target.checked },
                    })}
                  />
                  <span>Allow Runtime View Switching in Viewer</span>
                </label>
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* Calculated Column Formula Builder Modal */}
      <FormulaBuilder
        open={formulaModalOpen}
        initial={editingFormulaCol}
        columns={selectedVisualColumns.filter((c) => c.key !== editingFormulaCol?.key)}
        validateFormula={validateAnalyticsFormula}
        onClose={() => {
          setFormulaModalOpen(false)
          setEditingFormulaCol(null)
        }}
        onSave={handleSaveFormulaColumn}
      />

      {/* RBAC Scope & Explicit Sharing Modal */}
      <Modal
        isOpen={accessModalOpen}
        onClose={() => setAccessModalOpen(false)}
        title="Dashboard Visibility Scope & Access Grants"
        size="lg"
        footer={(
          <button type="button" className="btn-primary" onClick={() => setAccessModalOpen(false)}>
            Done
          </button>
        )}
      >
        <div className="analytics-access-modal">
          <div className="analytics-access-grid">
            <label>
              Visibility Scope
              <select
                value={visibilityScope}
                onChange={(e) => setVisibilityScope(e.target.value)}
              >
                <option value="PRIVATE">PRIVATE (Creator &amp; Explicit Grants Only)</option>
                <option value="ROLE">ROLE (Granted Roles &amp; Users)</option>
                <option value="LOCATION">LOCATION (Users Scoped to Location)</option>
                {(catalog.is_admin || visibilityScope === 'GLOBAL') && (
                  <option value="GLOBAL">GLOBAL (All Terminal Locations — Admin)</option>
                )}
              </select>
            </label>

            <label>
              Bound Location {visibilityScope === 'LOCATION' ? '(Required)' : '(Optional)'}
              <select
                value={locationCode}
                onChange={(e) => setLocationCode(e.target.value)}
              >
                <option value="">All Accessible Locations</option>
                {(lookups.locations || []).map((loc) => (
                  <option key={loc.location_code} value={loc.location_code}>
                    {loc.location_code} — {loc.location_name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="analytics-grants-box">
            <h4>Explicit Role &amp; User Access Grants</h4>
            <div className="analytics-grant-adder-row">
              <select value={grantTargetKind} onChange={(e) => setGrantTargetKind(e.target.value)}>
                <option value="role">Role</option>
                <option value="user">User</option>
              </select>

              {grantTargetKind === 'role' ? (
                <select value={grantRoleId} onChange={(e) => setGrantRoleId(e.target.value)}>
                  <option value="">Select Role…</option>
                  {(lookups.roles || []).map((r) => (
                    <option key={r.id} value={r.id}>{r.role_name}</option>
                  ))}
                </select>
              ) : (
                <select value={grantUserId} onChange={(e) => setGrantUserId(e.target.value)}>
                  <option value="">Select User…</option>
                  {(lookups.users || []).map((u) => (
                    <option key={u.id} value={u.id}>{u.full_name} ({u.username})</option>
                  ))}
                </select>
              )}

              <select value={grantType} onChange={(e) => setGrantType(e.target.value)}>
                <option value="VIEW">VIEW</option>
                <option value="EXPORT">EXPORT</option>
                <option value="EDIT">EDIT</option>
              </select>

              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() => {
                  if (grantTargetKind === 'role' && grantRoleId) {
                    const rId = Number(grantRoleId)
                    if (!grants.some((g) => g.role_id === rId && g.grant_type === grantType)) {
                      setGrants([...grants, { role_id: rId, user_id: null, grant_type: grantType }])
                    }
                  } else if (grantTargetKind === 'user' && grantUserId) {
                    const uId = Number(grantUserId)
                    if (!grants.some((g) => g.user_id === uId && g.grant_type === grantType)) {
                      setGrants([...grants, { user_id: uId, role_id: null, grant_type: grantType }])
                    }
                  }
                }}
              >
                <Icon name="plus" size={14} /> Add Grant
              </button>
            </div>

            <div className="analytics-grants-list">
              {grants.map((g, idx) => {
                const roleName = g.role_id ? lookups.roles?.find((r) => r.id === g.role_id)?.role_name || `Role #${g.role_id}` : null
                const userObj = g.user_id ? lookups.users?.find((u) => u.id === g.user_id) : null
                const label = roleName ? `Role: ${roleName}` : `User: ${userObj ? `${userObj.full_name} (${userObj.username})` : `#${g.user_id}`}`
                return (
                  <div key={`${g.role_id || 'u'}-${g.user_id || 'r'}-${g.grant_type}-${idx}`} className="analytics-grant-pill">
                    <span>{label}</span>
                    <span className="analytics-scope-pill">{g.grant_type}</span>
                    <button
                      type="button"
                      className="btn-link is-danger"
                      onClick={() => setGrants(grants.filter((_, i) => i !== idx))}
                    >
                      Remove
                    </button>
                  </div>
                )
              })}
              {!grants.length && <p className="analytics-muted-hint">No explicit role or user grants added.</p>}
            </div>
          </div>
        </div>
      </Modal>

      {/* Version History & One-Click Revert Modal */}
      <Modal
        isOpen={historyModalOpen}
        onClose={() => setHistoryModalOpen(false)}
        title={`Version History — ${name || 'Dashboard'}`}
        size="lg"
        footer={(
          <button type="button" className="btn-primary" onClick={() => setHistoryModalOpen(false)}>
            Close
          </button>
        )}
      >
        {loadingVersions ? (
          <div>Loading version snapshots…</div>
        ) : (
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Version</th>
                  <th scope="col">Timestamp</th>
                  <th scope="col">Change Summary</th>
                  <th scope="col">Visuals</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {versions.map((ver) => (
                  <tr key={ver.id}>
                    <td><strong>v{ver.version}</strong></td>
                    <td>{String(ver.created_at || '').slice(0, 19).replace('T', ' ')}</td>
                    <td>{ver.change_summary || 'Saved snapshot'}</td>
                    <td>{Array.isArray(ver.definition_json?.visuals) ? ver.definition_json.visuals.length : 0}</td>
                    <td>
                      <button
                        type="button"
                        className="btn-secondary btn-sm"
                        onClick={() => handleRevertVersion(ver)}
                      >
                        <Icon name="repeat" size={13} /> Revert to v{ver.version}
                      </button>
                    </td>
                  </tr>
                ))}
                {!versions.length && (
                  <tr>
                    <td colSpan={5}>No historical versions recorded yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Modal>
    </div>
  )
}

export default AnalyticsBuilder
