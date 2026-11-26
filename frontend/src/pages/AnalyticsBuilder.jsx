import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import AlertMessage from '../components/common/AlertMessage'
import { useConfirm } from '../components/common/ConfirmProvider'
import Icon from '../components/common/Icon'
import Modal from '../components/common/Modal'
import ExportMenu from '../components/common/ExportMenu'
import { useToast } from '../components/common/Toast'
import AnalyticsJsonPanel from '../components/analytics/AnalyticsJsonPanel'
import AnalyticsVisual from '../components/analytics/AnalyticsVisual'
import GridStackCanvas from '../components/analytics/GridStackCanvas'
import PerspectiveGrid from '../components/analytics/PerspectiveGrid'
import FormulaBuilder from '../components/reportBuilder/FormulaBuilder'
import ComparisonConditionsEditor from '../components/reportBuilder/ComparisonConditionsEditor'
import usePermissions from '../hooks/usePermissions'
import {
  createAnalyticsDefinition,
  getAnalyticsCatalog,
  getAnalyticsDefinition,
  getAnalyticsLookups,
  getAnalyticsPreviewVisualRecords,
  getAnalyticsVersions,
  revertAnalyticsDefinition,
  runAnalyticsPreview,
  updateAnalyticsDefinition,
  validateAnalyticsFormula,
} from '../api/analyticsApi'
import { logUiAction } from '../utils/actionLogger'
import { FILTER_OPERATORS } from '../utils/reportBuilder'
import {
  BLUEPRINT_CATEGORIES,
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
import {
  DATE_BASIS_CHOICES,
  canonicalDateBasis,
  ensureUniqueDesignIds,
  makeAnalyticsId,
  migrateLoadedDesign,
  normalizeSlicerForSave,
  normalizeVisualForSave,
} from '../utils/analyticsDesign'
import '../styles/analytics.css'

const REPORT_AGG_OPTIONS = ['SUM', 'AVG', 'COUNT', 'MIN', 'MAX', 'FIRST', 'LAST']
const MATERIAL_BALANCE_VISUAL_TYPES = new Set(['TABLE', 'PIVOT_GRID', 'MATRIX'])

const EMPTY_DEFINITION = {
  schema_version: 2,
  canvas: { floatMode: false, cellHeight: 64, margin: 14 },
  slicers: [],
  visuals: [],
  layout: [],
}

function getDatasetDisplayName(ds) {
  return ds?.name || ds?.label || ds?.table || ds?.id || 'Dataset'
}

function getDatasetIdForSource(source, fallbackId = 'tank_stock_ledger') {
  if (!source || typeof source !== 'object') return fallbackId
  if (source.kind === 'table' && source.table) return `table:${source.table}`
  return source.kind || fallbackId
}

function buildQueryFromDataset(dataset, visualType, customTitle = '') {
  const requestedType = String(visualType || 'COLUMN').toUpperCase()

  if (requestedType === 'TEXT') {
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

  if (requestedType === 'TANK_VISUAL' || dataset?.kind === 'tank_snapshot') {
    const resolvedTankType = requestedType === 'TANK_VISUAL' ? 'TANK_VISUAL' : requestedType
    const isChartLike = ['BAR', 'COLUMN', 'LINE', 'AREA', 'PIE', 'DONUT', 'KPI_CARD'].includes(resolvedTankType)
    return {
      title: customTitle || 'Shore Tank Live Stock & Ullage',
      type: resolvedTankType,
      query: {
        source: { kind: 'tank_snapshot' },
        unit: 'nsv',
        filters: [],
        filter_logic: 'AND',
        ...(isChartLike ? { dimension_key: 'tank_asset_code', measure_key: 'current_stock', metric_key: 'current_stock' } : {}),
      },
      style: {},
      explorer: { allowViewSwitch: resolvedTankType !== 'TANK_VISUAL' },
      interactions: { crossFilter: true, drillThrough: { enabled: true, mode: 'RECORDS' } },
    }
  }

  const type = dataset?.kind === 'material_balance' && !MATERIAL_BALANCE_VISUAL_TYPES.has(requestedType)
    ? 'PIVOT_GRID'
    : requestedType
  const meta = getVisualMeta(type)

  if (dataset?.kind === 'tracking_status' || String(dataset?.kind || '').includes('tracking_status')) {
    const defaultDim = 'current_status'
    const defaultMeasure = 'movement_count'
    return {
      title: customTitle || 'Vessel & Barge Tracking Status',
      type: ['KPI_CARD', 'TABLE', 'PIVOT_GRID', 'MATRIX', 'BAR', 'COLUMN', 'LINE', 'AREA', 'PIE', 'DONUT'].includes(type) ? type : 'TABLE',
      query: {
        source: { kind: dataset?.kind || 'tracking_status' },
        tracking_module: 'ALL',
        dimension_key: defaultDim,
        measure_key: defaultMeasure,
        metric_key: defaultMeasure,
        columns: [
          { key: 'tracking_module', label: 'Tracking Module', kind: 'data', source: { type: 'column', column: 'tracking_module' }, data_type: 'text', aggregate: 'FIRST', format: {} },
          { key: 'tracking_ref', label: 'Tracking Ref / Convoy', kind: 'data', source: { type: 'column', column: 'tracking_ref' }, data_type: 'text', aggregate: 'FIRST', format: {} },
          { key: 'asset_code', label: 'Asset Code', kind: 'data', source: { type: 'column', column: 'asset_code' }, data_type: 'text', aggregate: 'FIRST', format: {} },
          { key: 'location_code', label: 'Location', kind: 'data', source: { type: 'column', column: 'location_code' }, data_type: 'text', aggregate: 'FIRST', format: {} },
          { key: 'current_status', label: 'Current Status', kind: 'data', source: { type: 'column', column: 'current_status' }, data_type: 'text', aggregate: 'FIRST', format: {} },
          { key: 'last_event_at', label: 'Last Event Date/Time', kind: 'data', source: { type: 'column', column: 'last_event_at' }, data_type: 'datetime', aggregate: 'MAX', format: {} },
          { key: 'quantity_gsv_bbl', label: 'Last Qty GSV (BBL)', kind: 'data', source: { type: 'column', column: 'quantity_gsv_bbl' }, data_type: 'number', aggregate: 'SUM', show_total: true, format: { decimals: 2 } },
          { key: 'movement_count', label: 'Movements', kind: 'data', source: { type: 'column', column: 'movement_count' }, data_type: 'number', aggregate: 'SUM', show_total: true, format: { decimals: 0 } },
        ],
        filters: [],
        filter_logic: 'AND',
        runtime_filters: [],
        group_by: ['KPI_CARD', 'BAR', 'COLUMN', 'LINE', 'AREA', 'PIE', 'DONUT'].includes(type) ? [{ key: defaultDim, bucket: 'VALUE' }] : [],
        sort: [],
        options: { show_totals: true, page_size: 500 },
      },
      style: { chart: { showLabels: true } },
      explorer: { allowViewSwitch: true, showShelfByDefault: type === 'PIVOT_GRID' },
      interactions: { crossFilter: true, drillThrough: { enabled: true, mode: 'RECORDS' } },
    }
  }

  if (dataset?.kind === 'material_balance') {
    return {
      title: customTitle || `Material Balance · ${meta.shortLabel}`,
      type,
      query: {
        source: { kind: 'material_balance' },
        unit: 'nsv',
      },
      style: {
        table: { dataBars: true, showSummaryBar: true, stickyHeader: true, striped: true },
        chart: { showLegend: true, showToolbox: true },
      },
      explorer: { allowViewSwitch: true, showShelfByDefault: type === 'PIVOT_GRID' },
      interactions: { crossFilter: true, drillThrough: { enabled: true, mode: 'RECORDS' } },
    }
  }

  const rawCols = Array.isArray(dataset?.columns) ? dataset.columns : []
  const scalarCols = rawCols.filter((c) => !c.is_json && c.data_type !== 'json')
  const preferredCols = scalarCols.filter((c) => c.column !== 'id' && !String(c.column || '').endsWith('_id'))
  const candidateCols = preferredCols.length >= 2 ? preferredCols : (scalarCols.length ? scalarCols : rawCols)

  const textCols = candidateCols.filter((c) => c.data_type !== 'number')
  const numCols = candidateCols.filter((c) => c.data_type === 'number')
  const pickedRaw = [
    ...textCols.slice(0, 2),
    ...numCols.slice(0, 2),
  ]
  const fallbackRaw = pickedRaw.length ? pickedRaw : candidateCols.slice(0, 4)

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

  // New visuals default to no status restriction: hard-coding
  // `statuses: ['Approved']` here silently hid draft/submitted tickets and was
  // one of the "Studio cannot do what Report Builder can" gaps. The Source
  // Restrictions editor in the inspector can narrow it per visual.
  const source = dataset?.kind === 'table' && dataset?.table
    ? { kind: 'table', table: dataset.table }
    : {
      kind: dataset?.kind || 'tank_stock_ledger',
      operation_type_codes: [],
      template_ids: [],
      statuses: [],
    }

  const shortDsName = getDatasetDisplayName(dataset).split('—')[0].trim()

  return {
    title: customTitle || `${shortDsName} · ${meta.shortLabel}`,
    type,
    query: {
      schema_version: 1,
      report_type: 'TABULAR',
      source,
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
      plotly: { showModeBar: true, trendline: true, boxMean: true, showOutliers: true, bins: 20 },
    },
    interactions: {
      crossFilter: true,
      drillThrough: { enabled: true, mode: 'RECORDS' },
    },
  }
}

function AnalyticsBuilder({ loggedInUser }) {
  const { dashboardId } = useParams()
  const id = dashboardId
  const [searchParams] = useSearchParams()
  const templateParam = searchParams.get('template') || ''
  const isNew = !id || id === 'new'
  const navigate = useNavigate()
  const toast = useToast()
  const confirm = useConfirm()
  const { hasAny } = usePermissions(loggedInUser)

  const canCreate = hasAny(['Create Analytics Definition'])
  const canEdit = hasAny(['Edit Analytics Definition'])
  const canPublish = hasAny(['Publish Analytics Definition'])

  const starterTemplates = useMemo(() => buildStarterTemplates(), [])

  const [catalog, setCatalog] = useState({ is_admin: false, datasets: [], tables: [], locations: [] })
  const [lookups, setLookups] = useState({
    users: [], roles: [], locations: [], asset_types: [],
    operation_types: [], templates: [], statuses: [], products: [], assets: [],
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [error, setError] = useState('')
  const lastExternalDropRef = useRef(0)

  // Dashboard Metadata & Access (canonical backend fields)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [scopeType, setScopeType] = useState('LOCATION')
  const [locationCode, setLocationCode] = useState('')
  const [isPublished, setIsPublished] = useState(false)
  const [versionNum, setVersionNum] = useState(1)
  const [myAccess, setMyAccess] = useState('OWNER')
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

  // Refs to keep executePreview stable and avoid resetting unsaved work on date/location changes
  const locationCodeRef = useRef(locationCode)
  const previewDateFromRef = useRef(previewDateFrom)
  const previewDateToRef = useRef(previewDateTo)
  const definitionRef = useRef(definition)
  useEffect(() => { locationCodeRef.current = locationCode }, [locationCode])
  useEffect(() => { previewDateFromRef.current = previewDateFrom }, [previewDateFrom])
  useEffect(() => { previewDateToRef.current = previewDateTo }, [previewDateTo])
  useEffect(() => { definitionRef.current = definition }, [definition])

  // Modals: FormulaBuilder, RBAC Sharing, Version History
  const [formulaModalOpen, setFormulaModalOpen] = useState(false)
  const [editingFormulaCol, setEditingFormulaCol] = useState(null)
  const [accessModalOpen, setAccessModalOpen] = useState(false)
  const [historyModalOpen, setHistoryModalOpen] = useState(false)
  // Drill-through inside Studio (Viewer parity): the underlying rows of the
  // previewed visual, read from the in-memory design.
  const [recordsModalVisual, setRecordsModalVisual] = useState(null)
  const [recordsLoading, setRecordsLoading] = useState(false)
  const [recordsPayload, setRecordsPayload] = useState(null)
  const [versions, setVersions] = useState([])
  const [loadingVersions, setLoadingVersions] = useState(false)

  // Grant adder draft inside Access Modal
  const [grantTargetKind, setGrantTargetKind] = useState('ROLE')
  const [grantRoleId, setGrantRoleId] = useState('')
  const [grantUserId, setGrantUserId] = useState('')
  const [grantLocationCode, setGrantLocationCode] = useState('')
  const [grantAccessLevel, setGrantAccessLevel] = useState('VIEW')

  const canModify = isNew
    ? canCreate
    : (canEdit && (myAccess === 'OWNER' || myAccess === 'EDIT'))

  const allDatasets = useMemo(() => {
    const featured = (catalog.datasets || []).map((ds) => ({
      ...ds,
      id: ds.id || ds.kind,
      name: getDatasetDisplayName(ds),
      isFeatured: true,
    }))
    const tables = (catalog.tables || []).map((tbl) => ({
      id: `table:${tbl.table}`,
      kind: 'table',
      table: tbl.table,
      name: tbl.label || tbl.table,
      columns: tbl.columns || [],
      isFeatured: false,
    }))
    return [...featured, ...tables]
  }, [catalog.datasets, catalog.tables])

  const executePreview = useCallback(async (defToRun, overrides = {}) => {
    if (!defToRun?.visuals?.length) {
      setPreviewResults({})
      return
    }
    const fromDate = overrides.date_from !== undefined ? overrides.date_from : previewDateFromRef.current
    const toDate = overrides.date_to !== undefined ? overrides.date_to : previewDateToRef.current
    const loc = overrides.location_code !== undefined ? overrides.location_code : locationCodeRef.current
    setPreviewing(true)
    try {
      const response = await runAnalyticsPreview(defToRun, {
        date_from: fromDate || null,
        date_to: toDate || null,
        location_codes: loc ? [loc] : [],
        // Studio preview of a GLOBAL dashboard means "everything I can see",
        // not "nothing" — state that explicitly (see analytics_engine tank scope).
        scope_mode: loc ? 'SELECTED' : 'ALL',
        runtime_values: {},
      })
      setPreviewResults(response?.results || {})
    } catch (err) {
      toast.error(err.message || 'Unable to execute studio preview.')
    } finally {
      setPreviewing(false)
    }
  }, [toast])

  const handleInspectRecords = useCallback(async (visual) => {
    if (!visual?.id) return
    const design = definitionRef.current
    if (!design?.visuals?.length) return
    const loc = locationCodeRef.current
    setRecordsModalVisual(visual)
    setRecordsLoading(true)
    setRecordsPayload(null)
    try {
      const data = await getAnalyticsPreviewVisualRecords(design, visual.id, {
        date_from: previewDateFromRef.current || null,
        date_to: previewDateToRef.current || null,
        location_codes: loc ? [loc] : [],
        scope_mode: loc ? 'SELECTED' : 'ALL',
        runtime_values: {},
      })
      setRecordsPayload(data)
    } catch (err) {
      toast.error(err.message || 'Unable to load the underlying records for this visual.')
    } finally {
      setRecordsLoading(false)
    }
  }, [toast])

  useEffect(() => {
    let active = true
    const load = async () => {
      setLoading(true)
      setError('')
      try {
        const [catalogData, lookupData, existing] = await Promise.all([
          getAnalyticsCatalog(),
          getAnalyticsLookups().catch(() => ({ users: [], roles: [], locations: [], asset_types: [], operation_types: [], templates: [], statuses: [], products: [], assets: [] })),
          isNew ? Promise.resolve(null) : getAnalyticsDefinition(id),
        ])
        if (!active) return
        setCatalog(catalogData || { is_admin: false, datasets: [], tables: [], locations: [] })
        const resolvedLookups = {
          users: lookupData?.users || [],
          roles: lookupData?.roles || [],
          locations: (lookupData?.locations?.length ? lookupData.locations : catalogData?.locations) || [],
          // Parity with Report Builder's source restrictions / slicer pickers.
          operation_types: lookupData?.operation_types || [],
          templates: lookupData?.templates || [],
          statuses: lookupData?.statuses || [],
          products: lookupData?.products || [],
          assets: lookupData?.assets || [],
        }
        setLookups(resolvedLookups)
        const firstDs = catalogData?.datasets?.find((d) => d.id === 'tank_stock_ledger')?.id
          || catalogData?.datasets?.[0]?.id
          || 'tank_stock_ledger'
        setActiveDatasetId(firstDs)

        if (existing) {
          setName(existing.dashboard_name || existing.name || '')
          setDescription(existing.description || '')
          setScopeType(existing.scope_type || 'LOCATION')
          const existingLoc = existing.location_code || ''
          setLocationCode(existingLoc)
          locationCodeRef.current = existingLoc
          setIsPublished(Boolean(existing.is_published))
          setVersionNum(Number(existing.version) || 1)
          setMyAccess(existing.my_access || 'VIEW')
          setGrants(Array.isArray(existing.grants) ? existing.grants.map((g) => ({
            grant_type: String(g.grant_type || (g.role_id ? 'ROLE' : (g.user_id ? 'USER' : 'LOCATION'))).toUpperCase(),
            user_id: g.user_id || null,
            role_id: g.role_id || null,
            location_code: g.location_code || null,
            access_level: String(g.access_level || 'VIEW').toUpperCase(),
            label: g.label || '',
          })) : [])
          const rawDef = existing.definition || existing.definition_json || EMPTY_DEFINITION
          const normLayout = normalizeLayoutForGridStack(rawDef.layout, rawDef.visuals || [])
          const hydrated = migrateLoadedDesign({
            ...EMPTY_DEFINITION,
            ...rawDef,
            canvas: { floatMode: false, cellHeight: 64, margin: 14, ...(rawDef.canvas || {}) },
            layout: normLayout,
          })
          setDefinition(hydrated)
          definitionRef.current = hydrated
          if (hydrated.visuals?.length) {
            setSelectedVisualId(hydrated.visuals[0].id)
            executePreview(hydrated, { location_code: existingLoc })
          }
        } else {
          // Initialize sensible defaults for a new dashboard so first-click Save works cleanly
          const isAdmin = Boolean(catalogData?.is_admin)
          const defaultLoc = resolvedLookups.locations?.[0]?.location_code || ''
          const initScope = isAdmin ? 'GLOBAL' : 'LOCATION'
          const initLoc = initScope === 'LOCATION' ? defaultLoc : ''
          setScopeType(initScope)
          setLocationCode(initLoc)
          locationCodeRef.current = initLoc
          setIsPublished(false)
          setVersionNum(1)
          setMyAccess('OWNER')
          setGrants(
            initScope === 'LOCATION' && initLoc
              ? [{ grant_type: 'LOCATION', user_id: null, role_id: null, location_code: initLoc, access_level: 'VIEW' }]
              : []
          )

          const matchedTpl = templateParam ? starterTemplates.find((t) => t.id === templateParam) : null
          if (matchedTpl) {
            const built = matchedTpl.buildDefinition()
            setName(matchedTpl.name)
            setDescription(matchedTpl.description)
            setDefinition(built)
            definitionRef.current = built
            if (built.visuals?.length) {
              setSelectedVisualId(built.visuals[0].id)
              executePreview(built, { location_code: initLoc })
            }
          } else {
            setName('')
            setDescription('')
            setDefinition(EMPTY_DEFINITION)
            definitionRef.current = EMPTY_DEFINITION
            setSelectedVisualId(null)
            setPreviewResults({})
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
  }, [executePreview, id, isNew, starterTemplates, templateParam])

  const selectedVisual = useMemo(
    () => (definition.visuals || []).find((v) => String(v.id) === String(selectedVisualId)) || null,
    [definition.visuals, selectedVisualId]
  )

  const selectedDataset = useMemo(() => {
    const targetId = selectedVisual
      ? getDatasetIdForSource(selectedVisual.query?.source, activeDatasetId)
      : activeDatasetId
    return allDatasets.find((ds) => ds.id === targetId || ds.kind === targetId) || allDatasets[0] || null
  }, [activeDatasetId, allDatasets, selectedVisual])

  const updateVisualById = useCallback((visualId, updater) => {
    setDefinition((prev) => {
      const nextVisuals = (prev.visuals || []).map((v) => {
        if (String(v.id) !== String(visualId)) return v
        return typeof updater === 'function' ? updater(v) : { ...v, ...updater }
      })
      const next = {
        ...prev,
        visuals: nextVisuals,
        layout: normalizeLayoutForGridStack(prev.layout, nextVisuals),
      }
      // Keep the ref used by preview/save in lockstep with state, otherwise a
      // save issued right after an inspector edit persisted the stale design.
      definitionRef.current = next
      return next
    })
  }, [])

  const addVisualToCanvas = useCallback((visualType, dropCoords = null) => {
    if (dropCoords) {
      lastExternalDropRef.current = Date.now()
    } else if (Date.now() - lastExternalDropRef.current < 450) {
      return
    }
    const ds = allDatasets.find((d) => d.id === activeDatasetId || d.kind === activeDatasetId) || allDatasets[0]
    const idStr = makeAnalyticsId('vis')
    const visualSkeleton = buildQueryFromDataset(ds, visualType)
    if (ds?.kind === 'material_balance' && visualSkeleton.type !== String(visualType || '').toUpperCase()) {
      toast.info('Material Balance visuals render as Table, Pivot Grid, or Matrix. Switched to Pivot Grid.')
    }
    const newVisual = { id: idStr, ...visualSkeleton }
    const defaults = defaultLayoutForVisualType(newVisual.type)

    const prev = definitionRef.current || EMPTY_DEFINITION
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
    definitionRef.current = nextDef
    setDefinition(nextDef)
    setSelectedVisualId(idStr)
    setInspectorTab('data')
    executePreview(nextDef)
  }, [activeDatasetId, allDatasets, executePreview, toast])

  const handleDuplicateVisual = useCallback((visualId) => {
    const prev = definitionRef.current || EMPTY_DEFINITION
    const orig = (prev.visuals || []).find((v) => String(v.id) === String(visualId))
    if (!orig) return
    const copyId = makeAnalyticsId('vis')
    const cloned = JSON.parse(JSON.stringify(orig))
    cloned.id = copyId
    cloned.title = `${orig.title || 'Visual'} (Copy)`
    const defaults = defaultLayoutForVisualType(cloned.type)
    const nextVisuals = [...(prev.visuals || []), cloned]
    const norm = normalizeLayoutForGridStack(prev.layout, prev.visuals || [])
    const maxY = norm.reduce((m, item) => Math.max(m, (item.y || 0) + (item.h || 4)), 0)
    const nextDef = {
      ...prev,
      visuals: nextVisuals,
      layout: [...norm, { i: copyId, id: copyId, x: 0, y: maxY, w: defaults.w, h: defaults.h, minW: defaults.minW, minH: defaults.minH }],
    }
    definitionRef.current = nextDef
    setDefinition(nextDef)
    setSelectedVisualId(copyId)
    executePreview(nextDef)
  }, [executePreview])

  const handleDeleteVisual = useCallback(async (visualId) => {
    const target = (definition.visuals || []).find((v) => String(v.id) === String(visualId))
    const ok = await confirm({
      title: 'Remove Visual from Canvas',
      message: `Remove "${target?.title || visualId}" from this dashboard?`,
      confirmLabel: 'Remove Visual',
      cancelLabel: 'Cancel',
      tone: 'danger',
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
    definitionRef.current = built
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
    const colKey = makeSafeKey(rawField.field || rawField.column || rawField.label)
    // Virtual fields (payload dates, looked-up names) are addressed by
    // `{type: 'virtual', field}`; real columns by `{type: 'column', column}`.
    const sourceSpec = String(rawField.source_type || 'column') === 'virtual'
      ? { type: 'virtual', field: rawField.field || rawField.column }
      : {
        type: rawField.source_type || 'column',
        column: rawField.column,
        ...(rawField.template_id ? { template_id: rawField.template_id } : {}),
      }
    const matchesField = (c) => (
      (sourceSpec.type === 'virtual'
        ? c.source?.type === 'virtual' && c.source?.field === sourceSpec.field
        : c.source?.column === sourceSpec.column)
      || c.key === colKey
    )
    updateVisualById(selectedVisual.id, (v) => {
      const currentCols = Array.isArray(v.query?.columns) ? v.query.columns : []
      const exists = currentCols.some(matchesField)
      let nextCols
      if (exists) {
        if (currentCols.length <= 1) return v
        nextCols = currentCols.filter((c) => !matchesField(c))
      } else {
        nextCols = [
          ...currentCols,
          {
            key: colKey,
            label: rawField.label || rawField.column,
            kind: 'data',
            source: sourceSpec,
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
    if (!canModify) {
      toast.error('You have read-only access to this dashboard definition.')
      return
    }
    if (!name.trim()) {
      toast.error('Please enter a Dashboard Name before saving.')
      return
    }
    if (scopeType === 'LOCATION' && !locationCode.trim()) {
      toast.error('Please choose a Location inside Scope & Access when Scope is LOCATION.')
      setAccessModalOpen(true)
      return
    }
    setSaving(true)
    try {
      // Normalise before saving: unique ids, migrated date bases, pinned report
      // schema. A save must never fail with "needs a unique id" or "unknown date
      // basis" for a state the Studio itself can repair.
      const normalizedDesign = ensureUniqueDesignIds({
        ...definition,
        schema_version: 2,
        visuals: (definition.visuals || []).map(normalizeVisualForSave),
        slicers: (definition.slicers || []).map(normalizeSlicerForSave),
      })
      const cleanDefinition = {
        ...normalizedDesign,
        schema_version: 2,
        layout: normalizeLayoutForGridStack(normalizedDesign.layout, normalizedDesign.visuals || []),
      }
      if (JSON.stringify(normalizedDesign.visuals) !== JSON.stringify(definition.visuals)
        || JSON.stringify(normalizedDesign.slicers) !== JSON.stringify(definition.slicers)) {
        setDefinition((prev) => ({ ...prev, visuals: normalizedDesign.visuals, slicers: normalizedDesign.slicers }))
        definitionRef.current = { ...(definitionRef.current || {}), visuals: normalizedDesign.visuals, slicers: normalizedDesign.slicers }
      }
      const nextPublished = publishAfterSave !== null && canPublish
        ? Boolean(publishAfterSave)
        : Boolean(isPublished)

      const canonicalGrants = grants
        .map((g) => {
          const kind = String(g.grant_type || '').toUpperCase()
          if (kind === 'ROLE' && g.role_id) {
            return { grant_type: 'ROLE', role_id: Number(g.role_id), user_id: null, location_code: null, access_level: g.access_level === 'EDIT' ? 'EDIT' : 'VIEW' }
          }
          if (kind === 'USER' && g.user_id) {
            return { grant_type: 'USER', user_id: Number(g.user_id), role_id: null, location_code: null, access_level: g.access_level === 'EDIT' ? 'EDIT' : 'VIEW' }
          }
          if (kind === 'LOCATION' && g.location_code) {
            return { grant_type: 'LOCATION', location_code: String(g.location_code).trim().toUpperCase(), user_id: null, role_id: null, access_level: 'VIEW' }
          }
          return null
        })
        .filter(Boolean)

      const payload = {
        dashboard_name: name.trim(),
        description: description.trim() || null,
        scope_type: scopeType,
        location_code: scopeType === 'LOCATION' ? (locationCode.trim() || null) : null,
        visibility: 'PRIVATE',
        is_published: nextPublished,
        status: 'Active',
        definition: cleanDefinition,
        grants: canonicalGrants,
      }
      const saved = isNew
        ? await createAnalyticsDefinition(payload)
        : await updateAnalyticsDefinition(id, payload)

      setIsPublished(Boolean(saved.is_published))
      setVersionNum(Number(saved.version) || versionNum + 1)
      logUiAction('Analytics', isNew ? 'Create Dashboard' : 'Update Dashboard', {
        dashboardId: saved.id,
        dashboardName: saved.dashboard_name || name.trim(),
        isPublished: Boolean(saved.is_published),
      })
      toast.success(
        publishAfterSave === true
          ? 'Dashboard saved and published.'
          : (publishAfterSave === false ? 'Dashboard saved and unpublished.' : 'Analytics dashboard saved.')
      )
      if (isNew) {
        navigate(`/analytics/builder/${saved.id}`, { replace: true })
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
    const vNum = ver.version_number ?? ver.version
    const ok = await confirm({
      title: `Revert to Version v${vNum}`,
      message: `Restore dashboard layout, visuals, and slicers from Version v${vNum} (${String(ver.created_at || '').slice(0, 19).replace('T', ' ')})? A new audit snapshot will be recorded.`,
      confirmLabel: `Restore v${vNum}`,
      cancelLabel: 'Cancel',
    })
    if (!ok) return
    try {
      const restored = await revertAnalyticsDefinition(id, { version_id: ver.id })
      const rawDef = restored.definition || restored.definition_json || EMPTY_DEFINITION
      const hydrated = migrateLoadedDesign({
        ...EMPTY_DEFINITION,
        ...rawDef,
        layout: normalizeLayoutForGridStack(rawDef.layout, rawDef.visuals || []),
      })
      setDefinition(hydrated)
      definitionRef.current = hydrated
      setVersionNum(Number(restored.version) || versionNum + 1)
      setHistoryModalOpen(false)
      toast.success(`Reverted dashboard to v${vNum}.`)
      executePreview(hydrated)
    } catch (err) {
      toast.error(err.message || 'Unable to revert dashboard version.')
    }
  }

  // Filtered dataset fields for the Left Field Explorer.
  // Includes the dataset's virtual fields (payload dates, looked-up names) so
  // Studio matches Report Builder's explorer sections instead of offering only
  // the raw table columns.
  const filteredDatasetFields = useMemo(() => {
    const cols = Array.isArray(selectedDataset?.columns) ? selectedDataset.columns : []
    const virtuals = (Array.isArray(selectedDataset?.virtual_fields) ? selectedDataset.virtual_fields : [])
      .map((field) => ({
        column: field.field,
        field: field.field,
        source_type: 'virtual',
        label: field.label || field.field,
        data_type: field.data_type || 'text',
        group: field.group || 'Derived fields',
        help: field.help || '',
      }))
    const all = [...virtuals, ...cols]
    const q = fieldSearch.trim().toLowerCase()
    if (!q) return all
    return all.filter((c) => (
      String(c.label || '').toLowerCase().includes(q)
      || String(c.column || '').toLowerCase().includes(q)
      || String(c.group || '').toLowerCase().includes(q)
    ))
  }, [fieldSearch, selectedDataset])

  /**
   * Date bases offered in the inspector. Prefer the API catalog (single source
   * of truth with the engine) and fall back to the local mirror when the
   * catalog is old or the call failed — either way the list can never contain a
   * value the save path rejects.
   */
  const dateBasisChoices = useMemo(() => {
    const fromCatalog = (catalog?.date_bases || []).filter((basis) => basis?.value)
    if (!fromCatalog.length) return DATE_BASIS_CHOICES
    const allowed = Array.isArray(catalog?.date_basis_values) && catalog.date_basis_values.length
      ? new Set(catalog.date_basis_values.map((value) => canonicalDateBasis(value)))
      : null
    const filtered = allowed
      ? fromCatalog.filter((basis) => allowed.has(canonicalDateBasis(basis.value)))
      : fromCatalog
    return filtered.length ? filtered : DATE_BASIS_CHOICES
  }, [catalog])

  /** Selected dataset fields grouped exactly like Report Builder's explorer. */
  const groupedDatasetFields = useMemo(() => {
    const groups = new Map()
    filteredDatasetFields.forEach((col) => {
      const isVirtual = String(col.source_type || '') === 'virtual'
      const group = isVirtual
        ? (col.group || 'Derived fields')
        : (col.is_json ? 'JSON / payload columns' : 'Data columns')
      if (!groups.has(group)) groups.set(group, [])
      groups.get(group).push(col)
    })
    return [...groups.entries()]
  }, [filteredDatasetFields])

  const selectedVisualColumns = useMemo(
    () => (Array.isArray(selectedVisual?.query?.columns) ? selectedVisual.query.columns : []),
    [selectedVisual]
  )

  const visualConditionFields = useMemo(() => {
    if (!selectedVisual || selectedVisual.type === 'TEXT') return []
    const ds = selectedDataset
    if (!ds) return []
    const fields = []
    const seen = new Set()
    const add = (label, source, dataType = 'text', group = 'Available fields') => {
      if (!source?.type) return
      const id = JSON.stringify(source)
      if (seen.has(id)) return
      seen.add(id)
      fields.push({ id, label, source, data_type: dataType || 'text', group })
    }
    ;(ds.virtual_fields || []).forEach((field) => add(
      field.label || field.field,
      { type: 'virtual', field: field.field },
      field.data_type || 'text',
      field.group || 'Derived fields',
    ))
    ;(ds.columns || []).filter((c) => !c.is_json).forEach((col) => add(
      col.label || col.column,
      { type: 'column', column: col.column || col.key },
      col.data_type || 'text',
      col.group || 'Data columns',
    ))
    // Also include current visual columns so user can reference them
    ;(selectedVisual.query?.columns || []).forEach((col) => {
      if (col?.kind === 'calculated' || !col?.source) return
      add(col.label || col.key, col.source, col.data_type || 'text', 'Visual columns')
    })
    return fields
  }, [selectedDataset, selectedVisual])

  /** Existing payload column references, so the picker can mark them as added. */
  const existingPayloadPaths = useMemo(() => {
    const refs = new Set()
    ;(selectedVisualColumns || []).forEach((col) => {
      const spec = col?.source
      if (!spec || !['payload_path', 'json_path'].includes(String(spec.type || ''))) return
      const ref = spec.field_code || spec.json_column || ''
      if (spec.path) refs.add(`${ref}::${spec.path}`)
      refs.add(String(spec.path || ''))
    })
    return refs
  }, [selectedVisualColumns])

  const handleAddPayloadColumns = useCallback((columns) => {
    if (!selectedVisual || !Array.isArray(columns) || !columns.length) return
    updateVisualById(selectedVisual.id, (v) => {
      const currentCols = Array.isArray(v.query?.columns) ? v.query.columns : []
      const existingKeys = new Set(currentCols.map((c) => String(c.key || '')))
      const additions = columns
        .filter((col) => col?.key && !existingKeys.has(String(col.key)))
        .map((col) => ({ ...col, hidden: false }))
      if (!additions.length) return v
      const nextCols = [...currentCols, ...additions]
      const firstMeasure = additions.find((c) => c.data_type === 'number')?.key
        || v.query?.measure_key
        || nextCols.find((c) => c.data_type === 'number')?.key
        || ''
      return {
        ...v,
        query: {
          ...v.query,
          columns: nextCols,
          measure_key: firstMeasure,
          metric_key: firstMeasure,
        },
      }
    })
    toast.success(`Added ${columns.length} payload column${columns.length === 1 ? '' : 's'}. Click Run Preview to evaluate.`)
  }, [selectedVisual, toast, updateVisualById])

  const getSlicerFieldOptions = (targetVisualIds = []) => {
    const targets = (definition.visuals || []).filter((v) => (targetVisualIds || []).includes(v.id) && v.type !== 'TEXT')
    const seen = new Set()
    const options = []
    const pushOption = (key, label, dataType, sourceLabel, source = null) => {
      const normalizedKey = String(key || '').trim()
      if (!normalizedKey || seen.has(normalizedKey)) return
      seen.add(normalizedKey)
      options.push({
        key: normalizedKey,
        label: label || normalizedKey,
        dataType: dataType || 'text',
        sourceLabel,
        source: source || null,
      })
    }

    for (const visual of targets) {
      const dsId = getDatasetIdForSource(visual?.query?.source, activeDatasetId)
      const ds = allDatasets.find((d) => d.id === dsId)
      for (const col of (ds?.columns || [])) {
        const key = col.column || col.key || col.field
        if (!key || col.is_json) continue
        pushOption(key, col.label || key, col.data_type || 'text', ds?.name || dsId, {
          type: col.source_type || 'column',
          column: key,
        })
      }
      // Virtual fields (payload dates, looked-up names) are bindable too.
      for (const field of (ds?.virtual_fields || [])) {
        const key = field.field
        if (!key) continue
        pushOption(key, field.label || key, field.data_type || 'text', `${ds?.name || dsId} · ${field.group || 'Derived'}`, {
          type: 'virtual',
          field: key,
        })
      }
      // Columns already on the visual (calculated / virtual / payload splits)
      for (const col of (visual?.query?.columns || [])) {
        if (!col?.key) continue
        const isPayload = ['payload_path', 'json_path'].includes(String(col?.source?.type || ''))
        pushOption(
          col.key,
          col.label || col.key,
          col.data_type || 'text',
          isPayload ? 'Payload column' : 'Visual column',
          col.source || null,
        )
      }
    }
    // Fallback: if no targets, show active dataset columns
    if (!options.length) {
      for (const col of (selectedDataset?.columns || [])) {
        const key = col.column || col.key || col.field
        if (key && !col.is_json) {
          pushOption(key, col.label || key, col.data_type || 'text', selectedDataset?.name || 'Dataset', {
            type: col.source_type || 'column',
            column: key,
          })
        }
      }
    }
    return options.sort((a, b) => String(a.label).localeCompare(String(b.label)))
  }

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
              <option value="">Load Blueprint ({starterTemplates.length})…</option>
              {BLUEPRINT_CATEGORIES.map((category) => {
                const items = starterTemplates.filter((tpl) => tpl.category === category)
                if (!items.length) return null
                return (
                  <optgroup key={category} label={category}>
                    {items.map((tpl) => (
                      <option key={tpl.id} value={tpl.id}>{tpl.name}</option>
                    ))}
                  </optgroup>
                )
              })}
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
              <Icon name="shield" size={14} /> Scope: {scopeType}
              {scopeType === 'LOCATION' && locationCode ? ` · ${locationCode}` : ''}
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

            {!isNew && isPublished && (
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
              disabled={saving || !canModify}
              title={!canModify ? 'Read-only access — requires Create/Edit Analytics Definition permission' : undefined}
            >
              {saving ? 'Saving…' : (isPublished ? 'Save Changes' : 'Save Draft')}
            </button>

            {canPublish && canModify && (
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

      {!canModify && (
        <AlertMessage
          tone="info"
          compact
          message="You are viewing this dashboard definition in read-only mode. Contact an administrator for Edit Analytics Definition access to save changes."
        />
      )}

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
                  <optgroup label="Featured Terminal Datasets">
                    {allDatasets.filter((ds) => ds.isFeatured).map((ds) => (
                      <option key={ds.id} value={ds.id}>{ds.name}</option>
                    ))}
                  </optgroup>
                  {allDatasets.some((ds) => !ds.isFeatured) && (
                    <optgroup label="Reportable Database Tables">
                      {allDatasets.filter((ds) => !ds.isFeatured).map((ds) => (
                        <option key={ds.id} value={ds.id}>{ds.name}</option>
                      ))}
                    </optgroup>
                  )}
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
                  value={selectedVisual ? getDatasetIdForSource(selectedVisual.query?.source, activeDatasetId) : activeDatasetId}
                  onChange={(e) => {
                    const nextId = e.target.value
                    setActiveDatasetId(nextId)
                    if (selectedVisual && selectedVisual.type !== 'TEXT') {
                      const ds = allDatasets.find((d) => d.id === nextId || d.kind === nextId)
                      if (ds) {
                        const rebuilt = buildQueryFromDataset(ds, selectedVisual.type, selectedVisual.title)
                        updateVisualById(selectedVisual.id, {
                          type: rebuilt.type,
                          query: rebuilt.query,
                          explorer: rebuilt.explorer,
                        })
                        if (ds.kind === 'material_balance' && rebuilt.type !== selectedVisual.type) {
                          toast.info('Material Balance visuals render as Table, Pivot Grid, or Matrix. Switched to Pivot Grid.')
                        }
                      }
                    }
                  }}
                >
                  <optgroup label="Featured Terminal Datasets">
                    {allDatasets.filter((ds) => ds.isFeatured).map((ds) => (
                      <option key={ds.id} value={ds.id}>{ds.name}</option>
                    ))}
                  </optgroup>
                  {allDatasets.some((ds) => !ds.isFeatured) && (
                    <optgroup label="Reportable Database Tables">
                      {allDatasets.filter((ds) => !ds.isFeatured).map((ds) => (
                        <option key={ds.id} value={ds.id}>{ds.name}</option>
                      ))}
                    </optgroup>
                  )}
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

              {selectedVisual && selectedVisual.type !== 'TEXT' && selectedDataset?.kind !== 'material_balance' && selectedDataset?.kind !== 'tank_snapshot' && selectedDataset?.kind !== 'tracking_status' && (
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
                {groupedDatasetFields.map(([group, entries]) => (
                  <div key={group} className="analytics-field-group">
                    <h5 className="analytics-field-group-title">{group}</h5>
                    {entries.map((col) => {
                      const isVirtual = String(col.source_type || '') === 'virtual'
                      const checked = selectedVisualColumns.some((c) => (
                        isVirtual
                          ? c.source?.type === 'virtual' && c.source?.field === (col.field || col.column)
                          : c.source?.column === col.column || c.key === makeSafeKey(col.column)
                      ))
                      return (
                        <label
                          key={`${col.source_type || 'col'}-${col.column}`}
                          className={`analytics-field-row ${checked ? 'is-checked' : ''}`}
                          title={col.help || ''}
                        >
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
                  </div>
                ))}
                {!filteredDatasetFields.length && (
                  <p className="analytics-muted-hint">
                    {['tank_snapshot','material_balance','tracking_status'].includes(selectedDataset?.kind)
                      ? (selectedDataset?.kind === 'tracking_status'
                        ? 'Pre-modeled tracking dataset with live barge, shuttle, FSO and tanker status columns. Use slicers/filters to focus by module, status, location or asset.'
                        : 'Pre-modeled engine dataset with built-in stock, inflow, outflow, and ullage columns.')
                      : 'No columns matched search.'}
                  </p>
                )}
              </div>

              <AnalyticsJsonPanel
                sourceKind={selectedDataset?.kind || 'tank_stock_ledger'}
                table={selectedDataset?.table}
                jsonColumns={(selectedDataset?.columns || []).filter((c) => c.is_json).map((c) => c.column)}
                operationTypeCodes={selectedVisual?.query?.source?.operation_type_codes || []}
                templateIds={selectedVisual?.query?.source?.template_ids || []}
                existingPaths={existingPayloadPaths}
                disabled={!selectedVisual
                  || selectedVisual.type === 'TEXT'
                  || ['tank_snapshot', 'material_balance', 'tracking_status'].includes(selectedDataset?.kind)}
                onAddColumns={handleAddPayloadColumns}
              />
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
              preserveTwelveColumns
              dragInTrigger={`${leftTab}:${activeDatasetId}:${(definition.visuals || []).length}`}
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
                  onInspectRecords={handleInspectRecords}
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
                      const candidateCols = (selectedDataset?.columns || []).filter((c) => !c.is_json)
                      const preferred = candidateCols.find((c) => c.column === 'product_name')
                        || candidateCols.find((c) => c.column === 'tank_asset_code')
                        || candidateCols.find((c) => c.data_type !== 'number')
                        || candidateCols[0]
                      const defaultCol = firstVis?.query?.columns?.find((c) => c.data_type !== 'number' && !c.hidden)?.key
                        || preferred?.column
                        || 'product_name'
                      // Keys must be unique even when two slicers are added in the
                      // same millisecond, otherwise the save fails validation.
                      const existingKeys = new Set((definition.slicers || []).map((s) => String(s.key || '')))
                      let candidateKey = `s_${makeSafeKey(defaultCol)}_${(definition.slicers?.length || 0) + 1}`
                      let suffix = 2
                      while (existingKeys.has(candidateKey)) {
                        candidateKey = `s_${makeSafeKey(defaultCol)}_${suffix}`
                        suffix += 1
                      }
                      const newSlicer = {
                        id: makeAnalyticsId('slicer'),
                        key: candidateKey,
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
                        value={slicer.type === 'SINGLE_DATE' ? 'DATE' : (slicer.type || 'SELECT')}
                        onChange={(e) => setDefinition((prev) => ({
                          ...prev,
                          slicers: prev.slicers.map((s, i) => (i === idx ? { ...s, type: e.target.value } : s)),
                        }))}
                      >
                        <option value="SELECT">Multi-Select Dropdown</option>
                        <option value="DATE">Single Date</option>
                        <option value="DATE_RANGE">Date Range</option>
                        <option value="TEXT">Text Contains</option>
                        <option value="NUMBER">Numeric Equals</option>
                        <option value="NUMBER_RANGE">Numeric Range</option>
                      </select>
                    </label>
                    <label>
                      Bound DB / Source Column
                      {(() => {
                        const fieldOptions = getSlicerFieldOptions(slicer.visual_ids || (definition.visuals || []).map((v) => v.id))
                        const currentKey = slicer.column_key || slicer.field || ''
                        const hasCurrent = !currentKey || fieldOptions.some((opt) => opt.key === currentKey)
                        return (
                          <select
                            value={currentKey}
                            onChange={(e) => {
                              const nextKey = e.target.value
                              const chosen = fieldOptions.find((opt) => opt.key === nextKey)
                              const isPayload = ['payload_path', 'json_path'].includes(String(chosen?.source?.type || ''))
                              setDefinition((prev) => ({
                                ...prev,
                                slicers: prev.slicers.map((s, i) => {
                                  if (i !== idx) return s
                                  // Only payload-sourced fields keep a `source`
                                  // descriptor; a DB/virtual column is resolved
                                  // from column_key alone by the engine.
                                  const next = { ...s, column_key: nextKey, field: nextKey }
                                  if (isPayload) next.source = chosen.source
                                  else delete next.source
                                  return next
                                }),
                              }))
                            }}
                          >
                            <option value="">Select a column…</option>
                            {!hasCurrent && <option value={currentKey}>{currentKey} (current)</option>}
                            {fieldOptions.map((opt) => (
                              <option key={opt.key} value={opt.key}>
                                {opt.label}{opt.dataType ? ` — ${opt.dataType}` : ''}
                              </option>
                            ))}
                          </select>
                        )
                      })()}
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
                      const prevType = String(selectedVisual.type || '').toUpperCase()
                      const prevKind = String(selectedVisual.query?.source?.kind || '')

                      let patch = { type: nextType }
                      if (nextType === 'TANK_VISUAL' && prevKind !== 'tank_snapshot') {
                        patch = {
                          type: 'TANK_VISUAL',
                          query: {
                            source: { kind: 'tank_snapshot' },
                            unit: selectedVisual.query?.unit || 'nsv',
                            filters: [],
                            filter_logic: 'AND',
                          },
                          explorer: { ...(selectedVisual.explorer || {}), allowViewSwitch: false },
                        }
                      } else if (nextType === 'TEXT') {
                        patch = {
                          type: 'TEXT',
                          text: selectedVisual.text || 'Enter terminal reconciliation context, operating notes, or threshold commentary here.',
                          query: {},
                          explorer: { allowViewSwitch: false },
                        }
                      } else if ((prevType === 'TEXT' || prevType === 'TANK_VISUAL') && nextType !== 'TANK_VISUAL') {
                        const fallbackDs = allDatasets.find((d) => d.id === activeDatasetId || d.kind === activeDatasetId)
                          || allDatasets.find((d) => d.kind === 'tank_stock_ledger')
                          || allDatasets[0]
                        if (fallbackDs) {
                          const rebuilt = buildQueryFromDataset(fallbackDs, nextType, selectedVisual.title)
                          patch = {
                            type: rebuilt.type,
                            query: rebuilt.query,
                            explorer: rebuilt.explorer,
                          }
                        }
                      }

                      const nextVisuals = (definitionRef.current?.visuals || []).map((v) => (
                        String(v.id) === String(selectedVisual.id) ? { ...v, ...patch } : v
                      ))
                      const nextDef = {
                        ...(definitionRef.current || EMPTY_DEFINITION),
                        visuals: nextVisuals,
                        layout: normalizeLayoutForGridStack(definitionRef.current?.layout, nextVisuals).map((l) => (
                          String(l.i) === String(selectedVisual.id)
                            ? { ...l, w: Math.max(l.w, defaults.minW), h: Math.max(l.h, defaults.minH), minW: defaults.minW, minH: defaults.minH }
                            : l
                        )),
                      }
                      definitionRef.current = nextDef
                      setDefinition(nextDef)
                      if (nextType !== 'TEXT') {
                        executePreview(nextDef)
                      }
                    }}
                  >
                    {(selectedVisual.query?.source?.kind === 'material_balance'
                      ? VISUAL_CATALOG.filter((vc) => MATERIAL_BALANCE_VISUAL_TYPES.has(vc.type))
                      : VISUAL_CATALOG
                    ).map((vc) => (
                      <option key={vc.type} value={vc.type}>{vc.label}</option>
                    ))}
                  </select>
                </label>

                {String(selectedVisual.query?.source?.kind || '') === 'tracking_status' && (
                  <label>
                    Tracking Module
                    <select
                      value={selectedVisual.query?.tracking_module || 'ALL'}
                      onChange={(e) => updateVisualById(selectedVisual.id, {
                        query: { ...selectedVisual.query, tracking_module: e.target.value },
                      })}
                    >
                      <option value="ALL">All Tracking Modules</option>
                      <option value="BARGE">Barge Tracking</option>
                      <option value="SHUTTLE">Shuttle Tracking</option>
                      <option value="FSO">FSO Tracking</option>
                      <option value="TANKER">Tanker Tracking</option>
                    </select>
                  </label>
                )}

                {!['TEXT', 'TANK_VISUAL'].includes(selectedVisual.type)
                  && !['tank_snapshot', 'material_balance', 'tracking_status'].includes(String(selectedVisual.query?.source?.kind || ''))
                  && (
                    <div className="analytics-inspector-subbox">
                      <div className="analytics-section-head">
                        <span>Source Restrictions</span>
                      </div>
                      <p className="analytics-muted-hint">
                        Which tickets this visual reads. The Studio used to hard-code “Approved” and offer no choice,
                        so a dashboard could never include draft or non-approved tickets (Report Builder always could).
                      </p>
                      <label>
                        Ticket Statuses
                        <select
                          multiple
                          size={Math.min(6, Math.max(3, (lookups.statuses || []).length))}
                          value={selectedVisual.query?.source?.statuses || []}
                          onChange={(e) => {
                            const chosen = Array.from(e.target.selectedOptions).map((opt) => opt.value)
                            updateVisualById(selectedVisual.id, {
                              query: {
                                ...selectedVisual.query,
                                source: { ...(selectedVisual.query?.source || {}), statuses: chosen },
                              },
                            })
                          }}
                        >
                          {(lookups.statuses?.length ? lookups.statuses : ['Approved', 'Submitted', 'Draft', 'Rejected', 'Cancelled']).map((status) => (
                            <option key={status} value={status}>{status}</option>
                          ))}
                        </select>
                        <span className="analytics-muted-hint">
                          Leave empty for every status. Hold Ctrl/Cmd to pick several.
                        </span>
                      </label>
                      <label>
                        Operation Types
                        <select
                          multiple
                          size={Math.min(8, Math.max(3, (lookups.operation_types || []).length))}
                          value={selectedVisual.query?.source?.operation_type_codes || []}
                          onChange={(e) => {
                            const chosen = Array.from(e.target.selectedOptions).map((opt) => opt.value)
                            updateVisualById(selectedVisual.id, {
                              query: {
                                ...selectedVisual.query,
                                source: { ...(selectedVisual.query?.source || {}), operation_type_codes: chosen },
                              },
                            })
                          }}
                        >
                          {(lookups.operation_types || []).map((op) => (
                            <option key={op.operation_type_code} value={op.operation_type_code}>
                              {op.operation_type_name || op.operation_type_code}
                            </option>
                          ))}
                        </select>
                        <span className="analytics-muted-hint">Leave empty for every operation type.</span>
                      </label>
                      <label>
                        Entry Forms (Templates)
                        <select
                          multiple
                          size={Math.min(8, Math.max(3, (lookups.templates || []).length))}
                          value={(selectedVisual.query?.source?.template_ids || []).map(String)}
                          onChange={(e) => {
                            const chosen = Array.from(e.target.selectedOptions).map((opt) => Number(opt.value)).filter((n) => Number.isFinite(n))
                            updateVisualById(selectedVisual.id, {
                              query: {
                                ...selectedVisual.query,
                                source: { ...(selectedVisual.query?.source || {}), template_ids: chosen },
                              },
                            })
                          }}
                        >
                          {(lookups.templates || []).map((tpl) => (
                            <option key={tpl.id} value={tpl.id}>{tpl.template_name}</option>
                          ))}
                        </select>
                        <span className="analytics-muted-hint">Leave empty for every entry form.</span>
                      </label>
                    </div>
                  )}

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
                  <>
                    <label>
                      Stock &amp; Capacity Basis
                      <select
                        value={selectedVisual.query?.unit || 'nsv'}
                        onChange={(e) => updateVisualById(selectedVisual.id, {
                          query: {
                            ...(selectedVisual.query || {}),
                            source: { ...(selectedVisual.query?.source || {}), kind: 'tank_snapshot' },
                            unit: e.target.value,
                          },
                        })}
                      >
                        <option value="nsv">Net Standard Volume (NSV BBL)</option>
                        <option value="gsv">Gross Standard Volume (GSV BBL)</option>
                        <option value="lt">Long Tons (LT)</option>
                        <option value="mt">Metric Tons (MT)</option>
                      </select>
                    </label>

                    <label>
                      Restrict This Visual to Location (optional)
                      <select
                        value={selectedVisual.query?.source?.location_code || ''}
                        onChange={(e) => updateVisualById(selectedVisual.id, {
                          query: {
                            ...(selectedVisual.query || {}),
                            source: {
                              kind: 'tank_snapshot',
                              ...(e.target.value ? { location_code: e.target.value } : {}),
                            },
                          },
                        })}
                      >
                        <option value="">Use Dashboard / Slicer Location</option>
                        {(lookups.locations || []).map((loc) => (
                          <option key={loc.location_code} value={loc.location_code}>
                            {loc.location_code} — {loc.location_name}
                          </option>
                        ))}
                      </select>
                    </label>

                    {(lookups.asset_types || []).length > 0 && (
                      <div className="analytics-inspector-subbox">
                        <div className="analytics-section-head">
                          <span>Tank Asset Types (optional)</span>
                          {(selectedVisual.query?.asset_type_codes || []).length > 0 && (
                            <button
                              type="button"
                              className="btn-link"
                              onClick={() => updateVisualById(selectedVisual.id, {
                                query: { ...(selectedVisual.query || {}), asset_type_codes: [] },
                              })}
                            >
                              Reset
                            </button>
                          )}
                        </div>
                        <p className="analytics-muted-hint">
                          Leave unchecked to automatically show active shore tanks with stock or tank calibration. Selected types narrow the rows shown and never suppress stock/calibration discovery.
                        </p>
                        <div className="analytics-slicer-targets">
                          {(lookups.asset_types || []).map((at) => {
                            const selectedTypes = selectedVisual.query?.asset_type_codes || []
                            const isChecked = selectedTypes.includes(at.asset_type_code)
                            return (
                              <label key={at.asset_type_code} className="analytics-check-row">
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => {
                                    const nextTypes = isChecked
                                      ? selectedTypes.filter((c) => c !== at.asset_type_code)
                                      : [...selectedTypes, at.asset_type_code]
                                    updateVisualById(selectedVisual.id, {
                                      query: { ...(selectedVisual.query || {}), asset_type_codes: nextTypes },
                                    })
                                  }}
                                />
                                <span>{at.asset_type_name || at.asset_type_code}</span>
                              </label>
                            )
                          })}
                        </div>
                      </div>
                    )}

                    <div className="analytics-inspector-subbox">
                      <div className="analytics-section-head">
                        <span>Tank Filters</span>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <select
                            aria-label="Tank filter logic"
                            value={selectedVisual.query?.filter_logic || 'AND'}
                            onChange={(e) => updateVisualById(selectedVisual.id, {
                              query: { ...(selectedVisual.query || {}), filter_logic: e.target.value },
                            })}
                          >
                            <option value="AND">AND</option>
                            <option value="OR">OR</option>
                          </select>
                          <button
                            type="button"
                            className="btn-link"
                            onClick={() => {
                              const nextFilters = [...(selectedVisual.query?.filters || []), {
                                column_key: 'product_name',
                                operator: 'eq',
                                value: '',
                              }]
                              updateVisualById(selectedVisual.id, {
                                query: { ...(selectedVisual.query || {}), filters: nextFilters },
                              })
                            }}
                          >
                            + Filter
                          </button>
                        </div>
                      </div>
                      {(selectedVisual.query?.filters || []).length === 0 && (
                        <p className="analytics-muted-hint">Filter specific shore tanks by tank code, product, location, or fill %.</p>
                      )}
                      {(selectedVisual.query?.filters || []).map((flt, fIdx) => (
                        <div key={`tank-flt-${fIdx}`} className="analytics-filter-row" style={{ display: 'grid', gap: 6, marginBottom: 8 }}>
                          <select
                            aria-label={`Tank filter column ${fIdx + 1}`}
                            value={flt.column_key || 'product_name'}
                            onChange={(e) => {
                              const nextFilters = (selectedVisual.query?.filters || []).map((item, i) => (
                                i === fIdx ? { ...item, column_key: e.target.value } : item
                              ))
                              updateVisualById(selectedVisual.id, { query: { ...(selectedVisual.query || {}), filters: nextFilters } })
                            }}
                          >
                            <option value="tank_asset_code">Tank Code</option>
                            <option value="tank_asset_name">Tank Name</option>
                            <option value="asset_type_code">Asset Type</option>
                            <option value="location_code">Location</option>
                            <option value="product_name">Product</option>
                            <option value="fill_pct">Fill %</option>
                            <option value="current_stock">Current Stock</option>
                          </select>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 6 }}>
                            <select
                              aria-label={`Tank filter operator ${fIdx + 1}`}
                              value={flt.operator || 'eq'}
                              onChange={(e) => {
                                const nextFilters = (selectedVisual.query?.filters || []).map((item, i) => (
                                  i === fIdx ? { ...item, operator: e.target.value } : item
                                ))
                                updateVisualById(selectedVisual.id, { query: { ...(selectedVisual.query || {}), filters: nextFilters } })
                              }}
                            >
                              {FILTER_OPERATORS.map((op) => <option key={op.value} value={op.value}>{op.label}</option>)}
                            </select>
                            {!['is_blank', 'is_not_blank'].includes(flt.operator) && (
                              <input
                                aria-label={`Tank filter value ${fIdx + 1}`}
                                value={flt.value ?? ''}
                                placeholder="Value"
                                onChange={(e) => {
                                  const nextFilters = (selectedVisual.query?.filters || []).map((item, i) => (
                                    i === fIdx ? { ...item, value: e.target.value } : item
                                  ))
                                  updateVisualById(selectedVisual.id, { query: { ...(selectedVisual.query || {}), filters: nextFilters } })
                                }}
                              />
                            )}
                            <button
                              type="button"
                              className="btn-link is-danger"
                              aria-label={`Remove tank filter ${fIdx + 1}`}
                              onClick={() => {
                                const nextFilters = (selectedVisual.query?.filters || []).filter((_, i) => i !== fIdx)
                                updateVisualById(selectedVisual.id, { query: { ...(selectedVisual.query || {}), filters: nextFilters } })
                              }}
                            >
                              ×
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>

                    <button
                      type="button"
                      className="btn-primary btn-sm"
                      onClick={() => executePreview(definitionRef.current)}
                      disabled={previewing}
                    >
                      <Icon name="refresh" size={14} /> Apply &amp; Refresh Tank Levels
                    </button>
                  </>
                ) : selectedVisual.query?.source?.kind === 'material_balance' ? (
                  <>
                    <label>
                      Material Balance Location
                      <select
                        value={selectedVisual.query?.source?.location_code || ''}
                        onChange={(e) => updateVisualById(selectedVisual.id, {
                          query: {
                            ...selectedVisual.query,
                            source: {
                              ...(selectedVisual.query?.source || { kind: 'material_balance' }),
                              location_code: e.target.value || undefined,
                            },
                          },
                        })}
                      >
                        <option value="">Use Dashboard / Slicer Location</option>
                        {(lookups.locations || []).map((loc) => (
                          <option key={loc.location_code} value={loc.location_code}>
                            {loc.location_code} — {loc.location_name}
                          </option>
                        ))}
                      </select>
                    </label>
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
                        <option value="lt">Long Tons (LT)</option>
                        <option value="mt">Metric Tons (MT)</option>
                      </select>
                    </label>
                    <p className="analytics-muted-hint">
                      Material Balance visuals load columns dynamically from the active Material Balance Template for the chosen location and preview date range.
                    </p>
                  </>
                ) : (
                  <>
                    <label>
                      Date Basis
                      <select
                        value={canonicalDateBasis(selectedVisual.query?.date_basis)}
                        onChange={(e) => updateVisualById(selectedVisual.id, {
                          query: { ...selectedVisual.query, date_basis: canonicalDateBasis(e.target.value) },
                        })}
                      >
                        {/* Only bases the engine accepts — the old list offered
                            OPERATIONAL_DATE, which previewed fine and then failed
                            the save with "Unknown date basis". */}
                        {dateBasisChoices.map((basis) => (
                          <option key={basis.value} value={basis.value}>{basis.label}</option>
                        ))}
                      </select>
                      <span className="analytics-muted-hint">
                        {dateBasisChoices.find((b) => canonicalDateBasis(b.value) === canonicalDateBasis(selectedVisual.query?.date_basis))?.help || ''}
                      </span>
                    </label>
                    {canonicalDateBasis(selectedVisual.query?.date_basis) === 'COLUMN' && (
                      <label>
                        Date Column
                        <select
                          value={selectedVisual.query?.date_column || ''}
                          onChange={(e) => updateVisualById(selectedVisual.id, {
                            query: { ...selectedVisual.query, date_column: e.target.value },
                          })}
                        >
                          <option value="">(Choose a date column)</option>
                          {selectedVisualColumns.filter((c) => c.data_type === 'date' || c.data_type === 'datetime').map((c) => (
                            <option key={c.key} value={c.key}>{c.label || c.key}</option>
                          ))}
                        </select>
                      </label>
                    )}

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
                          {(col.kind || 'data') === 'data' && (
                            <ComparisonConditionsEditor
                              column={col}
                              fields={visualConditionFields}
                              onChange={(patch) => {
                                const nextCols = selectedVisualColumns.map((item, i) => (
                                  i === cIdx ? { ...item, ...patch } : item
                                ))
                                updateVisualById(selectedVisual.id, { query: { ...selectedVisual.query, columns: nextCols } })
                              }}
                            />
                          )}
                        </div>
                      ))}
                    </div>

                    <div className="analytics-inspector-subbox">
                      <div className="analytics-section-head">
                        <span>Sort &amp; Hidden Columns</span>
                      </div>
                      <p className="analytics-muted-hint">
                        Sort order and hidden columns are saved into the report definition, exactly like Report Builder.
                      </p>
                      <div className="analytics-sort-editor">
                        {(selectedVisual.query?.sort || []).map((srt, sIdx) => (
                          <div key={`srt-${sIdx}`} className="analytics-gb-item">
                            <select
                              aria-label={`Sort column ${sIdx + 1}`}
                              value={srt.key || ''}
                              onChange={(e) => {
                                const next = (selectedVisual.query?.sort || []).map((item, i) => (
                                  i === sIdx ? { ...item, key: e.target.value } : item
                                ))
                                updateVisualById(selectedVisual.id, { query: { ...selectedVisual.query, sort: next } })
                              }}
                            >
                              <option value="">Select column…</option>
                              {selectedVisualColumns.map((c) => (
                                <option key={c.key} value={c.key}>{c.label || c.key}</option>
                              ))}
                            </select>
                            <select
                              aria-label={`Sort direction ${sIdx + 1}`}
                              value={String(srt.direction || 'ASC').toUpperCase()}
                              onChange={(e) => {
                                const next = (selectedVisual.query?.sort || []).map((item, i) => (
                                  i === sIdx ? { ...item, direction: e.target.value } : item
                                ))
                                updateVisualById(selectedVisual.id, { query: { ...selectedVisual.query, sort: next } })
                              }}
                            >
                              <option value="ASC">A → Z / 0 → 9</option>
                              <option value="DESC">Z → A / 9 → 0</option>
                            </select>
                            <button
                              type="button"
                              className="btn-link is-danger"
                              aria-label={`Remove sort ${sIdx + 1}`}
                              onClick={() => updateVisualById(selectedVisual.id, {
                                query: {
                                  ...selectedVisual.query,
                                  sort: (selectedVisual.query?.sort || []).filter((_, i) => i !== sIdx),
                                },
                              })}
                            >
                              ×
                            </button>
                          </div>
                        ))}
                        <button
                          type="button"
                          className="btn-link"
                          onClick={() => {
                            const firstKey = selectedVisualColumns[0]?.key
                            if (!firstKey) return
                            const cur = selectedVisual.query?.sort || []
                            if (cur.length >= 3) {
                              toast.info('A visual can be sorted by at most three columns.')
                              return
                            }
                            if (cur.some((item) => item.key === firstKey)) return
                            updateVisualById(selectedVisual.id, {
                              query: { ...selectedVisual.query, sort: [...cur, { key: firstKey, direction: 'ASC' }] },
                            })
                          }}
                        >
                          + Add Sort
                        </button>
                      </div>
                      <div className="analytics-mini-check-list">
                        {selectedVisualColumns.map((col, cIdx) => (
                          <label key={`hidden-${col.key}`} className="analytics-mini-check">
                            <input
                              type="checkbox"
                              checked={Boolean(col.hidden)}
                              onChange={(e) => {
                                const nextCols = selectedVisualColumns.map((item, i) => (
                                  i === cIdx ? { ...item, hidden: e.target.checked } : item
                                ))
                                updateVisualById(selectedVisual.id, { query: { ...selectedVisual.query, columns: nextCols } })
                              }}
                            />
                            <span>{col.label || col.key}</span>
                          </label>
                        ))}
                      </div>
                      <span className="analytics-muted-hint">Tick to hide a column from the visual (it stays available for filters and slicers).</span>
                    </div>

                    <div className="analytics-inspector-subbox">
                      <div className="analytics-section-head">
                        <span>Visual Filters</span>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <select
                            aria-label="Filter logic"
                            value={selectedVisual.query?.filter_logic || 'AND'}
                            onChange={(e) => updateVisualById(selectedVisual.id, {
                              query: { ...selectedVisual.query, filter_logic: e.target.value },
                            })}
                          >
                            <option value="AND">AND</option>
                            <option value="OR">OR</option>
                          </select>
                          <button
                            type="button"
                            className="btn-link"
                            onClick={() => {
                              const defaultField = visualConditionFields[0]
                              if (!defaultField) return
                              const nextFilters = [...(selectedVisual.query?.filters || []), {
                                column_key: defaultField.source?.column || defaultField.source?.field || defaultField.source?.field_code || '',
                                operator: 'eq',
                                value: '',
                              }]
                              updateVisualById(selectedVisual.id, { query: { ...selectedVisual.query, filters: nextFilters } })
                            }}
                          >
                            + Filter
                          </button>
                        </div>
                      </div>
                      {(selectedVisual.query?.filters || []).length === 0 && (
                        <p className="analytics-muted-hint">Add fixed filters to limit data for this visual (e.g. receipt only, specific operation code/label).</p>
                      )}
                      {(selectedVisual.query?.filters || []).map((flt, fIdx) => {
                        const colKey = flt.column_key || ''
                        return (
                          <div key={`flt-${fIdx}`} className="analytics-filter-row" style={{ display: 'grid', gap: 6, marginBottom: 8 }}>
                            <select
                              aria-label={`Filter column ${fIdx + 1}`}
                              value={colKey}
                              onChange={(e) => {
                                const nextFilters = (selectedVisual.query?.filters || []).map((item, i) => (
                                  i === fIdx ? { ...item, column_key: e.target.value } : item
                                ))
                                updateVisualById(selectedVisual.id, { query: { ...selectedVisual.query, filters: nextFilters } })
                              }}
                            >
                              <option value="">Select column…</option>
                              {visualConditionFields.map((field) => {
                                const key = field.source?.column || field.source?.field || field.source?.field_code || ''
                                return <option key={field.id || key} value={key}>{field.label}</option>
                              })}
                            </select>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 6 }}>
                              <select
                                aria-label={`Filter operator ${fIdx + 1}`}
                                value={flt.operator || 'eq'}
                                onChange={(e) => {
                                  const nextFilters = (selectedVisual.query?.filters || []).map((item, i) => (
                                    i === fIdx ? { ...item, operator: e.target.value } : item
                                  ))
                                  updateVisualById(selectedVisual.id, { query: { ...selectedVisual.query, filters: nextFilters } })
                                }}
                              >
                                {FILTER_OPERATORS.map((op) => <option key={op.value} value={op.value}>{op.label}</option>)}
                              </select>
                              {!['is_blank', 'is_not_blank'].includes(flt.operator) && (
                                <input
                                  aria-label={`Filter value ${fIdx + 1}`}
                                  value={flt.value ?? ''}
                                  placeholder={flt.operator === 'between' ? 'From' : 'Value'}
                                  onChange={(e) => {
                                    const nextFilters = (selectedVisual.query?.filters || []).map((item, i) => (
                                      i === fIdx ? { ...item, value: e.target.value } : item
                                    ))
                                    updateVisualById(selectedVisual.id, { query: { ...selectedVisual.query, filters: nextFilters } })
                                  }}
                                />
                              )}
                              <button
                                type="button"
                                className="btn-link is-danger"
                                aria-label={`Remove filter ${fIdx + 1}`}
                                onClick={() => {
                                  const nextFilters = (selectedVisual.query?.filters || []).filter((_, i) => i !== fIdx)
                                  updateVisualById(selectedVisual.id, { query: { ...selectedVisual.query, filters: nextFilters } })
                                }}
                              >
                                ×
                              </button>
                            </div>
                            {flt.operator === 'between' && (
                              <input
                                aria-label={`Filter value 2 ${fIdx + 1}`}
                                value={flt.value2 ?? ''}
                                placeholder="To"
                                onChange={(e) => {
                                  const nextFilters = (selectedVisual.query?.filters || []).map((item, i) => (
                                    i === fIdx ? { ...item, value2: e.target.value } : item
                                  ))
                                  updateVisualById(selectedVisual.id, { query: { ...selectedVisual.query, filters: nextFilters } })
                                }}
                              />
                            )}
                          </div>
                        )
                      })}
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
                        checked={selectedVisual.style?.kpi?.showDelta !== false}
                        onChange={(e) => updateVisualById(selectedVisual.id, {
                          style: { ...(selectedVisual.style || {}), kpi: { ...(selectedVisual.style?.kpi || {}), showDelta: e.target.checked } },
                        })}
                      />
                      <span>Show Comparison Delta % (green / red)</span>
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
                        checked={selectedVisual.style?.chart?.showLabels === true || (selectedVisual.style?.chart?.showLabels == null && ['PIE','DONUT','FUNNEL','TREEMAP','SUNBURST','SANKEY'].includes(String(selectedVisual.type || '').toUpperCase()))}
                        onChange={(e) => updateVisualById(selectedVisual.id, {
                          style: { ...(selectedVisual.style || {}), chart: { ...(selectedVisual.style?.chart || {}), showLabels: e.target.checked } },
                        })}
                      />
                      <span>Show Data Labels</span>
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
                    {['SCATTER', 'HISTOGRAM', 'PLOTLY_WATERFALL'].includes(String(selectedVisual.type || '').toUpperCase()) && (
                      <label className="analytics-mini-check">
                        <input
                          type="checkbox"
                          checked={Boolean(selectedVisual.style?.chart?.showLabels)}
                          onChange={(e) => updateVisualById(selectedVisual.id, {
                            style: { ...(selectedVisual.style || {}), chart: { ...(selectedVisual.style?.chart || {}), showLabels: e.target.checked } },
                          })}
                        />
                        <span>Show Data Labels</span>
                      </label>
                    )}
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
                    {selectedVisual.type === 'HISTOGRAM' && (
                      <label>
                        Histogram Bins (5–100)
                        <input
                          type="number"
                          min={5}
                          max={100}
                          value={selectedVisual.style?.plotly?.bins ?? 20}
                          onChange={(e) => updateVisualById(selectedVisual.id, {
                            style: {
                              ...(selectedVisual.style || {}),
                              plotly: {
                                ...(selectedVisual.style?.plotly || {}),
                                bins: Math.max(5, Math.min(100, Number(e.target.value) || 20)),
                              },
                            },
                          })}
                        />
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
        open={accessModalOpen}
        onClose={() => setAccessModalOpen(false)}
        title="Dashboard Scope & Explicit Access Grants"
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
              Dashboard Scope
              <select
                value={scopeType}
                onChange={(e) => {
                  const nextScope = e.target.value
                  setScopeType(nextScope)
                  if (nextScope === 'GLOBAL') {
                    setLocationCode('')
                  } else if (!locationCode && lookups.locations?.[0]?.location_code) {
                    setLocationCode(lookups.locations[0].location_code)
                  }
                }}
              >
                <option value="LOCATION">LOCATION (Bound to a Terminal Location)</option>
                {(catalog.is_admin || scopeType === 'GLOBAL') && (
                  <option value="GLOBAL">GLOBAL (All Terminal Locations — Admin)</option>
                )}
              </select>
            </label>

            <label>
              Bound Location {scopeType === 'LOCATION' ? '(Required)' : '(Not used for GLOBAL)'}
              <select
                value={scopeType === 'LOCATION' ? locationCode : ''}
                disabled={scopeType === 'GLOBAL'}
                onChange={(e) => setLocationCode(e.target.value)}
              >
                <option value="">{scopeType === 'GLOBAL' ? 'All Accessible Locations' : 'Select Location…'}</option>
                {(lookups.locations || []).map((loc) => (
                  <option key={loc.location_code} value={loc.location_code}>
                    {loc.location_code} — {loc.location_name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="analytics-grants-box">
            <h4>Explicit Role, User &amp; Location Access Grants</h4>
            <div className="analytics-grant-adder-row">
              <select
                value={grantTargetKind}
                onChange={(e) => {
                  const nextKind = e.target.value
                  setGrantTargetKind(nextKind)
                  if (nextKind === 'LOCATION') setGrantAccessLevel('VIEW')
                }}
              >
                <option value="ROLE">Role</option>
                <option value="USER">User</option>
                <option value="LOCATION">Location (View Only)</option>
              </select>

              {grantTargetKind === 'ROLE' ? (
                <select value={grantRoleId} onChange={(e) => setGrantRoleId(e.target.value)}>
                  <option value="">Select Role…</option>
                  {(lookups.roles || []).map((r) => (
                    <option key={r.id} value={r.id}>{r.role_name}</option>
                  ))}
                </select>
              ) : grantTargetKind === 'USER' ? (
                <select value={grantUserId} onChange={(e) => setGrantUserId(e.target.value)}>
                  <option value="">Select User…</option>
                  {(lookups.users || []).map((u) => (
                    <option key={u.id} value={u.id}>{u.full_name} ({u.username})</option>
                  ))}
                </select>
              ) : (
                <select value={grantLocationCode} onChange={(e) => setGrantLocationCode(e.target.value)}>
                  <option value="">Select Location…</option>
                  {(lookups.locations || []).map((loc) => (
                    <option key={loc.location_code} value={loc.location_code}>
                      {loc.location_code} — {loc.location_name}
                    </option>
                  ))}
                </select>
              )}

              <select
                value={grantTargetKind === 'LOCATION' ? 'VIEW' : grantAccessLevel}
                disabled={grantTargetKind === 'LOCATION'}
                onChange={(e) => setGrantAccessLevel(e.target.value)}
              >
                <option value="VIEW">VIEW</option>
                {grantTargetKind !== 'LOCATION' && <option value="EDIT">EDIT</option>}
              </select>

              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() => {
                  if (grantTargetKind === 'ROLE' && grantRoleId) {
                    const rId = Number(grantRoleId)
                    if (!grants.some((g) => g.grant_type === 'ROLE' && g.role_id === rId && g.access_level === grantAccessLevel)) {
                      setGrants([...grants, { grant_type: 'ROLE', role_id: rId, user_id: null, location_code: null, access_level: grantAccessLevel }])
                    }
                  } else if (grantTargetKind === 'USER' && grantUserId) {
                    const uId = Number(grantUserId)
                    if (!grants.some((g) => g.grant_type === 'USER' && g.user_id === uId && g.access_level === grantAccessLevel)) {
                      setGrants([...grants, { grant_type: 'USER', user_id: uId, role_id: null, location_code: null, access_level: grantAccessLevel }])
                    }
                  } else if (grantTargetKind === 'LOCATION' && grantLocationCode) {
                    const locCode = grantLocationCode.trim().toUpperCase()
                    if (!grants.some((g) => g.grant_type === 'LOCATION' && g.location_code === locCode)) {
                      setGrants([...grants, { grant_type: 'LOCATION', location_code: locCode, user_id: null, role_id: null, access_level: 'VIEW' }])
                    }
                  }
                }}
              >
                <Icon name="plus" size={14} /> Add Grant
              </button>
            </div>

            <div className="analytics-grants-list">
              {grants.map((g, idx) => {
                let label = g.label
                if (!label) {
                  if (g.grant_type === 'ROLE') {
                    const roleName = lookups.roles?.find((r) => r.id === g.role_id)?.role_name || `Role #${g.role_id}`
                    label = `Role: ${roleName}`
                  } else if (g.grant_type === 'USER') {
                    const userObj = lookups.users?.find((u) => u.id === g.user_id)
                    label = `User: ${userObj ? `${userObj.full_name} (${userObj.username})` : `#${g.user_id}`}`
                  } else {
                    const locObj = lookups.locations?.find((l) => l.location_code === g.location_code)
                    label = `Location: ${locObj ? `${locObj.location_code} — ${locObj.location_name}` : g.location_code}`
                  }
                }
                return (
                  <div key={`${g.grant_type}-${g.role_id || g.user_id || g.location_code}-${g.access_level}-${idx}`} className="analytics-grant-pill">
                    <span>{label}</span>
                    <span className="analytics-scope-pill">{g.grant_type} · {g.access_level || 'VIEW'}</span>
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
              {!grants.length && <p className="analytics-muted-hint">No explicit role, user, or location grants added (private to creator &amp; admins).</p>}
            </div>
          </div>
        </div>
      </Modal>

      {/* Studio drill-through: underlying rows of the previewed visual */}
      <Modal
        open={Boolean(recordsModalVisual)}
        onClose={() => {
          setRecordsModalVisual(null)
          setRecordsPayload(null)
        }}
        title={recordsModalVisual ? `Underlying Records — ${recordsModalVisual.title}` : 'Underlying Source Records'}
        size="xl"
        footer={(
          <div className="analytics-modal-footer-bar">
            <div className="analytics-modal-footer-left">
              {recordsPayload?.rows?.length > 0 && (
                <ExportMenu
                  label="Export Records"
                  title={`${recordsModalVisual?.title || 'Visual'} — Underlying Records`}
                  fileName="analytics_preview_underlying_records"
                  columns={(recordsPayload.columns || []).map((c) => ({ key: c.key, label: c.label || c.key }))}
                  rows={recordsPayload.rows}
                />
              )}
            </div>
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                setRecordsModalVisual(null)
                setRecordsPayload(null)
              }}
            >
              Close
            </button>
          </div>
        )}
      >
        <div className="analytics-expanded-modal-body">
          {recordsLoading ? (
            <div className="analytics-visual-loading">Fetching ungrouped underlying source records…</div>
          ) : recordsPayload ? (
            <>
              {(recordsPayload.meta?.warnings || []).map((warning, idx) => (
                <AlertMessage key={`preview-records-warning-${idx}`} tone="warning" compact message={warning} />
              ))}
              {recordsPayload.meta?.applied_filters?.length > 0 && (
                <div className="analytics-records-applied-filters">
                  Applied filters: {recordsPayload.meta.applied_filters.join(' · ')}
                </div>
              )}
              {!recordsPayload.rows?.length && recordsPayload.meta?.filter_breakdown && (
                <div className="analytics-records-applied-filters">
                  Candidates: {recordsPayload.meta.filter_breakdown.candidates ?? 0} · with stock evidence:{' '}
                  {recordsPayload.meta.filter_breakdown.with_stock_evidence ?? 0} · after type filter:{' '}
                  {recordsPayload.meta.filter_breakdown.after_type_filter ?? 0} · after slicers:{' '}
                  {recordsPayload.meta.filter_breakdown.after_slicer_filters ?? 0} · after fixed filters:{' '}
                  {recordsPayload.meta.filter_breakdown.after_fixed_filters ?? 0}
                </div>
              )}
              <PerspectiveGrid
                visual={{
                  id: `preview_records_${recordsModalVisual?.id}`,
                  type: 'TABLE',
                  explorer: { showShelfByDefault: true },
                  style: { table: { dataBars: true, showSummaryBar: true, stickyHeader: true, striped: true } },
                }}
                columns={(recordsPayload.columns || []).filter((c) => !c.hidden)}
                rows={recordsPayload.rows || []}
                totals={recordsPayload.totals || {}}
                expanded
                shelfOpen
                containerWidth={1100}
              />
            </>
          ) : (
            <AlertMessage tone="info" message="No underlying records available." />
          )}
        </div>
      </Modal>

      {/* Version History & One-Click Revert Modal */}
      <Modal
        open={historyModalOpen}
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
                  <th scope="col">Change Note</th>
                  <th scope="col">Visuals</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {versions.map((ver) => {
                  const vNum = ver.version_number ?? ver.version
                  const verDef = ver.definition || ver.definition_json || {}
                  return (
                    <tr key={ver.id}>
                      <td><strong>v{vNum}</strong></td>
                      <td>{String(ver.created_at || '').slice(0, 19).replace('T', ' ')}</td>
                      <td>{ver.change_note || ver.change_summary || 'Saved snapshot'}</td>
                      <td>{Array.isArray(verDef.visuals) ? verDef.visuals.length : 0}</td>
                      <td>
                        <button
                          type="button"
                          className="btn-secondary btn-sm"
                          disabled={!canModify}
                          onClick={() => handleRevertVersion(ver)}
                        >
                          <Icon name="repeat" size={13} /> Revert to v{vNum}
                        </button>
                      </td>
                    </tr>
                  )
                })}
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
