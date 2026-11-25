import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Responsive, WidthProvider } from 'react-grid-layout'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'
import PageHeader from '../components/common/PageHeader'
import AlertMessage from '../components/common/AlertMessage'
import Modal from '../components/common/Modal'
import AnalyticsVisual from '../components/analytics/AnalyticsVisual'
import FormulaBuilder from '../components/reportBuilder/FormulaBuilder'
import { usePermissions } from '../hooks/usePermissions'
import { useToast } from '../components/common/Toast'
import {
  createAnalyticsDefinition,
  getAnalyticsCatalog,
  getAnalyticsDefinition,
  publishAnalyticsDefinition,
  runAnalyticsPreview,
  updateAnalyticsDefinition,
  validateAnalyticsFormula,
} from '../api/analyticsApi'
import { logUiAction } from '../utils/actionLogger'
import useActionFeedback from '../hooks/useActionFeedback'

const ResponsiveGridLayout = WidthProvider(Responsive)
const emptyDefinition = () => ({ schema_version: 2, visuals: [], layout: [], slicers: [] })
const makeKey = (value) => {
  const key = String(value || 'column').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'column'
  return /^[a-z]/.test(key) ? key : `field_${key}`
}
const defaultLayoutForType = (type) => {
  if (type === 'KPI_CARD' || type === 'GAUGE') return { w: 3, h: 4 }
  if (type === 'TABLE' || type === 'MATRIX') return { w: 12, h: 8 }
  if (type === 'PIE' || type === 'DONUT') return { w: 5, h: 7 }
  return { w: 6, h: 7 }
}
const SLICER_TYPES = ['SELECT', 'TEXT', 'NUMBER', 'NUMBER_RANGE', 'DATE', 'DATE_RANGE']

function StyleEditor({ visual, onChange, onClose }) {
  if (!visual) return null
  const style = visual.style || {}
  const kpi = style.kpi || {}
  const table = style.table || {}
  const chart = style.chart || {}
  const type = String(visual.type || '').toUpperCase()
  const update = (patch) => onChange({ ...style, ...patch })
  const updateKpi = (patch) => update({ kpi: { ...kpi, ...patch } })
  const updateTable = (patch) => update({ table: { ...table, ...patch } })
  const updateChart = (patch) => update({ chart: { ...chart, ...patch } })

  return (
    <Modal open title={`Customize: ${visual.title || 'Visual'}`} onClose={onClose} size="lg">
      <div className="analytics-style-editor">
        <section className="analytics-style-section">
          <h4>Card</h4>
          <div className="analytics-builder-fields">
            <label>Title color<input type="color" value={style.titleColor || '#1f2937'} onChange={(e) => update({ titleColor: e.target.value })} /></label>
            <label>Card background<input type="color" value={style.cardBackground || '#ffffff'} onChange={(e) => update({ cardBackground: e.target.value })} /></label>
            <label className="analytics-inline-check"><input type="checkbox" checked={style.cardBorder !== false} onChange={(e) => update({ cardBorder: e.target.checked })} /> Show border</label>
            <button type="button" className="btn-link" onClick={() => update({ titleColor: null, cardBackground: null, cardBorder: true })}>Reset card style</button>
          </div>
        </section>

        {(type === 'KPI_CARD' || type === 'GAUGE') && (
          <section className="analytics-style-section">
            <h4>KPI</h4>
            <div className="analytics-builder-fields">
              <label>Value color<input type="color" value={kpi.valueColor || '#f27b2f'} onChange={(e) => updateKpi({ valueColor: e.target.value })} /></label>
              <label>Label color<input type="color" value={kpi.labelColor || '#6b7280'} onChange={(e) => updateKpi({ labelColor: e.target.value })} /></label>
              <label>Value font size<input type="number" min="20" max="96" value={kpi.valueFontSize ?? 48} onChange={(e) => updateKpi({ valueFontSize: Number(e.target.value) })} /></label>
              <label>Label font size<input type="number" min="10" max="32" value={kpi.labelFontSize ?? 13} onChange={(e) => updateKpi({ labelFontSize: Number(e.target.value) })} /></label>
              <label>Decimals<input type="number" min="0" max="6" value={kpi.decimals ?? 2} onChange={(e) => updateKpi({ decimals: Number(e.target.value) })} /></label>
              <label>Align<select value={kpi.align || 'left'} onChange={(e) => updateKpi({ align: e.target.value })}><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></label>
              <label>Prefix<input value={kpi.prefix || ''} onChange={(e) => updateKpi({ prefix: e.target.value })} maxLength={24} /></label>
              <label>Suffix<input value={kpi.suffix || ''} onChange={(e) => updateKpi({ suffix: e.target.value })} maxLength={24} /></label>
              <label className="analytics-inline-check"><input type="checkbox" checked={kpi.compact === true} onChange={(e) => updateKpi({ compact: e.target.checked })} /> Compact number</label>
            </div>
          </section>
        )}

        {(type === 'TABLE' || type === 'MATRIX') && (
          <section className="analytics-style-section">
            <h4>Table</h4>
            <div className="analytics-builder-fields">
              <label>Density<select value={table.density || 'comfortable'} onChange={(e) => updateTable({ density: e.target.value })}><option value="compact">Compact</option><option value="comfortable">Comfortable</option><option value="spacious">Spacious</option></select></label>
              <label className="analytics-inline-check"><input type="checkbox" checked={table.stickyHeader !== false} onChange={(e) => updateTable({ stickyHeader: e.target.checked })} /> Sticky header</label>
              <label className="analytics-inline-check"><input type="checkbox" checked={table.striped === true} onChange={(e) => updateTable({ striped: e.target.checked })} /> Striped rows</label>
              <label className="analytics-inline-check"><input type="checkbox" checked={table.wrapText === true} onChange={(e) => updateTable({ wrapText: e.target.checked })} /> Wrap text</label>
            </div>
          </section>
        )}

        {['BAR','COLUMN','LINE','AREA','PIE','DONUT'].includes(type) && (
          <section className="analytics-style-section">
            <h4>Chart</h4>
            <div className="analytics-builder-fields">
              <label className="analytics-inline-check"><input type="checkbox" checked={chart.showLegend !== false} onChange={(e) => updateChart({ showLegend: e.target.checked })} /> Show legend</label>
              <label className="analytics-inline-check"><input type="checkbox" checked={chart.showLabels === true} onChange={(e) => updateChart({ showLabels: e.target.checked })} /> Show labels</label>
              <label className="analytics-inline-check"><input type="checkbox" checked={chart.showGrid !== false} onChange={(e) => updateChart({ showGrid: e.target.checked })} /> Show grid</label>
              {['LINE','AREA'].includes(type) && <label className="analytics-inline-check"><input type="checkbox" checked={chart.smooth === true} onChange={(e) => updateChart({ smooth: e.target.checked })} /> Smooth line</label>}
              {['LINE','AREA','BAR','COLUMN'].includes(type) && <label className="analytics-inline-check"><input type="checkbox" checked={chart.areaFill === true} onChange={(e) => updateChart({ areaFill: e.target.checked })} /> Area fill</label>}
              {['BAR','COLUMN'].includes(type) && <label className="analytics-inline-check"><input type="checkbox" checked={chart.stacked === true} onChange={(e) => updateChart({ stacked: e.target.checked })} /> Stacked</label>}
              <label>X label rotation<input type="number" min="0" max="90" value={chart.xLabelRotation ?? 0} onChange={(e) => updateChart({ xLabelRotation: Number(e.target.value) })} /></label>
              <label>Palette (comma hex)<input value={(chart.palette || []).join(', ')} onChange={(e) => updateChart({ palette: e.target.value.split(',').map((v) => v.trim()).filter(Boolean) })} placeholder="#f27b2f, #2ea3f2, #10b981" /></label>
            </div>
          </section>
        )}
      </div>
      <div className="app-modal-footer"><button type="button" className="btn-primary" onClick={onClose}>Done</button></div>
    </Modal>
  )
}


function AnalyticsBuilder({ loggedInUser }) {
  const { dashboardId } = useParams()
  const navigate = useNavigate()
  const { hasPermission } = usePermissions(loggedInUser)
  const canCreate = hasPermission('Create Analytics Definition')
  const canEdit = hasPermission('Edit Analytics Definition')
  const canPublish = hasPermission('Publish Analytics Definition')
  const toast = useToast()
  const feedback = useActionFeedback()
  const [catalog, setCatalog] = useState(null)
  const [locations, setLocations] = useState([])
  const [dashboardName, setDashboardName] = useState('')
  const [description, setDescription] = useState('')
  const [locationCode, setLocationCode] = useState('')
  const [isPublished, setIsPublished] = useState(false)
  const [definition, setDefinition] = useState(emptyDefinition)
  const [grants, setGrants] = useState([])
  const [draftResults, setDraftResults] = useState({})
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(Boolean(dashboardId))
  const [visualTitle, setVisualTitle] = useState('')
  const [datasetId, setDatasetId] = useState('')
  const [visualType, setVisualType] = useState('TABLE')
  const [selectedFields, setSelectedFields] = useState([])
  const [dimensionKey, setDimensionKey] = useState('')
  const [measureKey, setMeasureKey] = useState('')
  const [calculation, setCalculation] = useState(null)
  const [formulaDialogOpen, setFormulaDialogOpen] = useState(false)
  const [unit, setUnit] = useState('nsv')
  const [slicerField, setSlicerField] = useState('')
  const [slicerType, setSlicerType] = useState('SELECT')
  const [slicerLabel, setSlicerLabel] = useState('')
  const [slicerVisualIds, setSlicerVisualIds] = useState([])
  const [styleVisualId, setStyleVisualId] = useState(null)
  const [loadError, setLoadError] = useState('')
  const formulaInitial = useMemo(() => calculation ? { label: calculation.label, formula: calculation.formula } : null, [calculation])

  useEffect(() => {
    let cancelled = false
    getAnalyticsCatalog()
      .then((nextCatalog) => {
        if (cancelled) return
        setCatalog(nextCatalog)
        setLocations((nextCatalog.locations || []).map((item, index) => ({
          id: item.location_code || index,
          locationCode: item.location_code,
          locationName: item.location_name,
          status: 'Active',
        })))
        const firstDataset = nextCatalog.datasets?.[0]?.id || ''
        setDatasetId((current) => current || firstDataset)
      })
      .catch((error) => { if (!cancelled) setLoadError(error.message || 'Unable to load Analytics catalog.') })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!dashboardId) return undefined
    let cancelled = false
    getAnalyticsDefinition(dashboardId)
      .then((saved) => {
        if (cancelled) return
        setDashboardName(saved.dashboard_name || '')
        setDescription(saved.description || '')
        setLocationCode(saved.location_code || '')
        setDefinition(saved.definition || emptyDefinition())
        setIsPublished(Boolean(saved.is_published))
        setGrants(saved.grants || [])
      })
      .catch((error) => { if (!cancelled) setLoadError(error.message || 'Unable to load this dashboard.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [dashboardId])

  const datasets = useMemo(() => {
    if (!catalog) return []
    return [
      ...(catalog.datasets || []),
      ...(catalog.tables || []).map((table) => ({
        id: `table:${table.table}`,
        kind: 'table',
        table: table.table,
        name: `${table.label} — table`,
        columns: table.columns,
        default_date_basis: table.date_columns?.length ? 'COLUMN' : 'NONE',
        date_columns: table.date_columns || [],
      })),
    ]
  }, [catalog])
  const dataset = datasets.find((item) => item.id === datasetId) || null
  const fields = useMemo(() => (dataset?.columns || []).filter((item) => !item.is_json && item.data_type !== 'json'), [dataset])
  const isMaterialBalance = dataset?.kind === 'material_balance'
  const isChart = ['BAR', 'COLUMN', 'LINE', 'AREA', 'PIE', 'DONUT'].includes(visualType)
  const isMatrix = visualType === 'MATRIX'

  const toggleField = (field) => {
    setSelectedFields((current) => current.includes(field.column)
      ? current.filter((key) => key !== field.column)
      : [...current, field.column])
  }

  const ensureColumnInVisual = (visual, field) => {
    const query = visual.query || {}
    const columns = [...(query.columns || [])]
    const key = makeKey(field.column)
    if (columns.some((col) => col.key === key)) return visual
    const hasGrouping = (query.group_by || []).length > 0 || query.report_type === 'MATRIX' || query.matrix
    columns.push({
      key,
      label: field.label || field.column,
      kind: 'data',
      source: { type: 'column', column: field.column },
      data_type: field.data_type || 'text',
      format: { decimals: 2 },
      hidden: true,
      ...(hasGrouping ? { aggregate: 'FIRST' } : {}),
    })
    return { ...visual, query: { ...query, columns } }
  }

  const buildVisual = () => {
    const title = visualTitle.trim() || (isMaterialBalance ? 'Material Balance' : `${visualType} visual`)
    const id = `visual_${Date.now()}`
    let query
    if (isMaterialBalance) {
      query = { source: { kind: 'material_balance' }, unit }
    } else {
      const chosen = fields.filter((field) => selectedFields.includes(field.column))
      if (!chosen.length) throw new Error('Select at least one field for this visual.')
      const toColumn = (field, hidden = false) => ({
        key: makeKey(field.column),
        label: field.label || field.column,
        kind: 'data',
        source: { type: 'column', column: field.column },
        data_type: field.data_type || 'text',
        format: { decimals: 2 },
        ...(hidden ? { hidden: true } : {}),
      })
      const calculatedSpec = calculation ? {
        key: calculation.key,
        label: calculation.label,
        kind: 'calculated',
        formula: calculation.formula,
        data_type: 'number',
        format: { decimals: 2 },
      } : null
      const asNumericMeasure = () => {
        if (calculatedSpec && measureKey === calculatedSpec.key) return calculatedSpec
        const selected = chosen.find((field) => field.column === measureKey) || chosen.find((field) => field.data_type === 'number')
        return selected ? toColumn(selected) : null
      }
      let columns = chosen.map((f) => toColumn(f))
      let groupBy = []
      let matrix = undefined
      let configuredDimensionKey = null
      let configuredMeasureKey = null
      if (visualType === 'KPI_CARD' || visualType === 'GAUGE') {
        const measure = asNumericMeasure()
        if (!measure || (measure.data_type !== 'number' && measure.kind !== 'calculated')) throw new Error('Choose a numeric measure for a KPI visual.')
        configuredMeasureKey = measure.key
        columns = calculation && measure.key === calculatedSpec?.key
          ? [...chosen.map((f) => toColumn(f)), calculatedSpec]
          : [measure]
        columns.forEach((column) => { if (column.data_type === 'number' || column.kind === 'calculated') { column.aggregate = 'SUM'; column.show_total = column.key === measure.key } })
      } else if (isChart) {
        const dimension = chosen.find((field) => field.column === dimensionKey) || chosen.find((field) => field.data_type !== 'number')
        const measure = asNumericMeasure()
        if (!dimension || !measure || (measure.data_type !== 'number' && measure.kind !== 'calculated')) throw new Error('Choose one category field and one numeric measure for this chart.')
        configuredDimensionKey = makeKey(dimension.column)
        configuredMeasureKey = measure.key
        columns = chosen.map((f) => toColumn(f))
        if (calculatedSpec && measure.key === calculatedSpec.key) columns.push(calculatedSpec)
        if (!columns.some((column) => column.key === makeKey(dimension.column))) columns.push(toColumn(dimension))
        columns.forEach((column) => {
          if (column.key === makeKey(dimension.column)) return
          column.aggregate = column.data_type === 'number' || column.kind === 'calculated' ? 'SUM' : 'FIRST'
        })
        groupBy = [{ key: makeKey(dimension.column), bucket: 'VALUE' }]
      } else if (isMatrix) {
        const dimensions = chosen.filter((field) => field.data_type !== 'number')
        const measure = asNumericMeasure()
        if (dimensions.length < 2 || !measure || (measure.data_type !== 'number' && measure.kind !== 'calculated')) throw new Error('Choose two category fields and one numeric measure for the matrix.')
        const rowColumn = toColumn(dimensions[0])
        const pivotColumn = toColumn(dimensions[1])
        configuredDimensionKey = rowColumn.key
        configuredMeasureKey = measure.key
        columns = chosen.map((f) => toColumn(f))
        if (calculatedSpec && measure.key === calculatedSpec.key) columns.push(calculatedSpec)
        if (!columns.some((column) => column.key === rowColumn.key)) columns.push(rowColumn)
        if (!columns.some((column) => column.key === pivotColumn.key)) columns.push(pivotColumn)
        if (!columns.some((column) => column.key === measure.key)) columns.push(measure)
        measure.aggregate = 'SUM'
        matrix = { row_keys: [rowColumn.key], column_key: pivotColumn.key, column_bucket: 'VALUE', value_key: measure.key, aggregate: 'SUM', show_row_totals: true, show_column_totals: true }
      } else if (calculatedSpec) {
        columns.push(calculatedSpec)
      }
      const source = dataset.kind === 'table'
        ? { kind: 'table', table: dataset.table }
        : dataset.kind === 'operation_tickets'
          ? { kind: 'operation_tickets', operation_type_codes: [], template_ids: [], statuses: ['Approved'] }
          : { kind: dataset.kind }
      query = {
        schema_version: 1,
        report_type: isMatrix ? 'MATRIX' : 'TABULAR',
        source,
        date_basis: dataset.default_date_basis || 'ACCOUNTING_DATE',
        date_column: dataset.default_date_basis === 'COLUMN' ? dataset.date_columns?.[0] : undefined,
        columns,
        filters: [],
        filter_logic: 'AND',
        runtime_filters: [],
        group_by: groupBy,
        ...(matrix ? { matrix } : {}),
        sort: [],
        options: { show_totals: visualType === 'KPI_CARD' || visualType === 'GAUGE', page_size: 50 },
        ...(configuredDimensionKey ? { dimension_key: configuredDimensionKey } : {}),
        ...(configuredMeasureKey ? { measure_key: configuredMeasureKey } : {}),
        ...((visualType === 'KPI_CARD' || visualType === 'GAUGE') ? { metric_key: configuredMeasureKey } : {}),
      }
    }
    const size = defaultLayoutForType(isMaterialBalance ? 'TABLE' : visualType)
    const visual = { id, title, type: isMaterialBalance ? 'TABLE' : visualType, query, style: {} }
    const nextDefinition = {
      ...definition,
      schema_version: 2,
      visuals: [...definition.visuals, visual],
      layout: [...(definition.layout || []), { i: id, x: 0, y: Infinity, w: size.w, h: size.h, minW: 2, minH: 3 }],
    }
    setDefinition(nextDefinition)
    setVisualTitle('')
    setSelectedFields([])
    setDimensionKey('')
    setMeasureKey('')
    setDraftResults((current) => ({ ...current, [id]: null }))
    logUiAction('Analytics', 'Add Dashboard Visual', { dashboardId: dashboardId || null, visualId: id, type: visual.type })
  }


  const removeVisual = (id) => {
    setDefinition((current) => ({
      ...current,
      visuals: current.visuals.filter((item) => item.id !== id),
      layout: (current.layout || []).filter((item) => item.i !== id),
      slicers: (current.slicers || []).map((s) => ({ ...s, visual_ids: (s.visual_ids || []).filter((vid) => vid !== id) })).filter((s) => (s.visual_ids || []).length > 0),
    }))
    setDraftResults((current) => { const next = { ...current }; delete next[id]; return next })
    logUiAction('Analytics', 'Remove Dashboard Visual', { visualId: id })
  }

  const updateVisualStyle = (visualId, style) => {
    setDefinition((current) => ({
      ...current,
      visuals: current.visuals.map((v) => v.id === visualId ? { ...v, style } : v),
    }))
  }

  const addSlicer = () => {
    if (!slicerField) return
    const field = fields.find((item) => item.column === slicerField)
    if (!field) return
    const keyBase = `s_${makeKey(field.column)}`
    let key = keyBase
    let suffix = 2
    while ((definition.slicers || []).some((item) => item.key === key)) { key = `${keyBase}_${suffix}`; suffix += 1 }
    const targetIds = slicerVisualIds.length ? slicerVisualIds : definition.visuals.map((v) => v.id)
    const columnKey = makeKey(field.column)
    const nextVisuals = definition.visuals.map((visual) => {
      if (!targetIds.includes(visual.id)) return visual
      if (visual.query?.source?.kind === 'material_balance') return visual
      const hasColumn = (visual.query?.columns || []).some((col) => col.key === columnKey)
      if (hasColumn) return visual
      return ensureColumnInVisual(visual, field)
    })
    setDefinition((current) => ({
      ...current,
      visuals: nextVisuals,
      slicers: [...(current.slicers || []), {
        id: `slicer_${Date.now()}`,
        key,
        label: slicerLabel.trim() || field.label || field.column,
        type: slicerType,
        column_key: columnKey,
        field: columnKey,
        visual_ids: targetIds,
        config: { multi: slicerType === 'SELECT', allowAll: true },
      }],
    }))
    setSlicerField('')
    setSlicerLabel('')
    setSlicerVisualIds([])
    setSlicerType('SELECT')
    logUiAction('Analytics', 'Add Dashboard Slicer', { columnKey, type: slicerType })
  }

  const removeSlicer = (id) => {
    setDefinition((current) => ({ ...current, slicers: (current.slicers || []).filter((item) => item.id !== id) }))
    logUiAction('Analytics', 'Remove Dashboard Slicer', { slicerId: id })
  }

  const runPreview = async (visual) => {
    setSaving(true)
    try {
      const params = {
        ...(locationCode.trim() ? { location_codes: [locationCode.trim()] } : {}),
        ...(visual.query?.source?.kind === 'material_balance' ? { date_from: new Date().toISOString().slice(0, 10), date_to: new Date().toISOString().slice(0, 10) } : {}),
      }
      const result = await runAnalyticsPreview(definition, params)
      setDraftResults((current) => ({ ...current, [visual.id]: result.results?.[visual.id] || null }))
      logUiAction('Analytics', 'Preview Dashboard Visual', { visualId: visual.id })
    } catch (error) {
      feedback.notifyError(error.message || 'Preview failed.')
    } finally {
      setSaving(false)
    }
  }

  const payload = () => ({
    dashboard_name: dashboardName.trim(),
    description: description.trim() || null,
    scope_type: 'LOCATION',
    location_code: locationCode.trim(),
    visibility: 'PRIVATE',
    is_published: isPublished,
    status: 'Active',
    definition,
    grants: grants.length ? grants.map((grant) => ({
      grant_type: grant.grant_type,
      user_id: grant.user_id,
      role_id: grant.role_id,
      location_code: grant.location_code,
      access_level: grant.access_level,
    })) : (locationCode.trim() ? [{ grant_type: 'LOCATION', location_code: locationCode.trim(), access_level: 'VIEW' }] : []),
  })

  const save = async () => {
    if ((!dashboardId && !canCreate) || (dashboardId && !canEdit)) return
    setSaving(true)
    feedback.clearError()
    try {
      const result = dashboardId
        ? await updateAnalyticsDefinition(dashboardId, payload())
        : await createAnalyticsDefinition(payload())
      setGrants(result.grants || [])
      setIsPublished(Boolean(result.is_published))
      setDefinition(result.definition || definition)
      logUiAction('Analytics', dashboardId ? 'Update Dashboard Definition' : 'Create Dashboard Definition', { dashboardId: result.id })
      toast.success('Analytics dashboard saved.')
      navigate(`/analytics/builder/${result.id}`, { replace: true })
    } catch (error) {
      const message = error.message || 'Unable to save dashboard.'
      feedback.notifyError(message.includes('already exists') ? `${message} Open Analytics Home to find the existing draft/definition.` : message)
    } finally {
      setSaving(false)
    }
  }

  const togglePublish = async () => {
    if (!dashboardId || !canPublish) return
    setSaving(true)
    try {
      const result = await publishAnalyticsDefinition(dashboardId, !isPublished)
      setIsPublished(Boolean(result.is_published))
      logUiAction('Analytics', result.is_published ? 'Publish Dashboard' : 'Unpublish Dashboard', { dashboardId })
      toast.success(result.is_published ? 'Dashboard published.' : 'Dashboard unpublished.')
    } catch (error) {
      feedback.notifyError(error.message || 'Unable to update publish status.')
    } finally {
      setSaving(false)
    }
  }

  const previewAll = useCallback(async () => {
    setSaving(true)
    try {
      const params = locationCode.trim() ? { location_codes: [locationCode.trim()] } : {}
      const result = await runAnalyticsPreview(definition, params)
      setDraftResults(result.results || {})
      logUiAction('Analytics', 'Preview Dashboard', { dashboardId: dashboardId || null })
    } catch (error) {
      feedback.notifyError(error.message || 'Preview failed.')
    } finally {
      setSaving(false)
    }
  }, [definition, feedback, locationCode, dashboardId])


  const activeLocations = locations
  const selectedDatasetColumns = useMemo(() => fields.filter((field) => selectedFields.includes(field.column)), [fields, selectedFields])
  const formulaColumns = useMemo(() => selectedDatasetColumns.map((field) => ({ key: makeKey(field.column), label: field.label || field.column })), [selectedDatasetColumns])
  const numericMeasureChoices = useMemo(() => [
    ...selectedDatasetColumns.filter((field) => field.data_type === 'number').map((field) => ({ key: field.column, label: field.label || field.column })),
    ...(calculation ? [{ key: calculation.key, label: `${calculation.label} (calculated)` }] : []),
  ], [selectedDatasetColumns, calculation])
  const dataSourceSelectItems = datasets.map((item) => ({ key: item.id, name: item.name }))

  const responsiveLayouts = useMemo(() => {
    const base = Array.isArray(definition.layout) ? definition.layout : (definition.layout?.lg || [])
    const ids = definition.visuals.map((v) => v.id)
    const normalize = (items, cols) => {
      const seen = new Set()
      const out = []
      for (const item of items || []) {
        if (!item || !ids.includes(item.i) || seen.has(item.i)) continue
        seen.add(item.i)
        const w = Math.max(1, Math.min(Number(item.w) || cols, cols))
        out.push({ ...item, w, x: Math.max(0, Math.min(Number(item.x) || 0, cols - w)), h: Math.max(2, Number(item.h) || 6), minW: 2, minH: 3 })
      }
      definition.visuals.forEach((visual, index) => {
        if (seen.has(visual.id)) return
        const size = defaultLayoutForType(visual.type)
        out.push({ i: visual.id, x: 0, y: 1000 + index * 6, w: Math.min(size.w, cols), h: size.h, minW: 2, minH: 3 })
      })
      return out
    }
    return { lg: normalize(base, 12), md: normalize(base, 10), sm: normalize(base.map((i) => ({ ...i, x: 0, w: Math.min(6, i.w || 6) })), 6), xs: normalize(base.map((i) => ({ ...i, x: 0, w: 2 })), 2) }
  }, [definition.layout, definition.visuals])

  const saveLayout = (_currentLayout, allLayouts) => {
    const source = (allLayouts && allLayouts.lg) || _currentLayout || []
    const nextLayout = source.map(({ i, x, y, w, h, minW, minH }) => ({ i, x, y, w, h, minW: minW || 2, minH: minH || 3 }))
    setDefinition((current) => JSON.stringify(current.layout || []) === JSON.stringify(nextLayout)
      ? current
      : { ...current, layout: nextLayout })
  }

  const styleVisual = definition.visuals.find((v) => v.id === styleVisualId) || null

  if (loading) return <div className="page-container"><p>Loading Analytics Studio…</p></div>

  return (
    <div className="page-container analytics-page">
      <PageHeader
        title={dashboardId ? 'Edit Analytics Dashboard' : 'Analytics Studio'}
        description="Build location-scoped dashboards with governed report datasets, calculations, charts and tables."
        actions={<Link className="btn-secondary" to="/analytics">My Dashboards</Link>}
      />
      <AlertMessage tone="error" message={loadError} onDismiss={() => setLoadError('')} />
      <AlertMessage tone="error" message={feedback.errorMsg} onDismiss={feedback.clearError} />
      <section className="analytics-builder-panel">
        <div className="analytics-builder-fields">
          <label>Dashboard name<input value={dashboardName} onChange={(event) => setDashboardName(event.target.value)} maxLength={200} /></label>
          <label>Description<input value={description} onChange={(event) => setDescription(event.target.value)} maxLength={500} /></label>
          <label>Location code
            <select value={locationCode} onChange={(event) => setLocationCode(event.target.value)}>
              <option value="">Choose location</option>
              {activeLocations.map((location) => <option key={location.id} value={location.locationCode}>{location.locationName} ({location.locationCode})</option>)}
            </select>
          </label>
          <div className="analytics-builder-actions">
            <button type="button" className="btn-secondary" onClick={previewAll} disabled={saving || definition.visuals.length === 0}>Preview all</button>
            <button type="button" className="btn-primary" onClick={save} disabled={saving || !dashboardName.trim() || !locationCode.trim() || definition.visuals.length === 0 || (dashboardId ? !canEdit : !canCreate)}>{saving ? 'Saving…' : 'Save dashboard'}</button>
            {dashboardId && canPublish && <button type="button" className="btn-secondary" onClick={togglePublish} disabled={saving}>{isPublished ? 'Unpublish' : 'Publish'}</button>}
          </div>
        </div>
      </section>

      <section className="analytics-builder-panel">
        <div className="analytics-section-title"><div><h2>Add a visual</h2><p>Choose a governed source and select fields. Drag visual headers to reposition and use resize handles to change size.</p></div></div>
        <div className="analytics-builder-fields analytics-visual-config">
          <label>Data source<select value={datasetId} onChange={(event) => { setDatasetId(event.target.value); setSelectedFields([]); setDimensionKey(''); setMeasureKey(''); setCalculation(null) }}>{dataSourceSelectItems.map((item) => <option key={item.key} value={item.key}>{item.name}</option>)}</select></label>
          {!isMaterialBalance && <label>Visual type<select value={visualType} onChange={(event) => setVisualType(event.target.value)}>{['TABLE', 'KPI_CARD', 'BAR', 'COLUMN', 'LINE', 'AREA', 'PIE', 'DONUT', 'MATRIX'].map((type) => <option key={type} value={type}>{type.replace('_', ' ')}</option>)}</select></label>}
          {isMaterialBalance && <label>Volume unit<select value={unit} onChange={(event) => setUnit(event.target.value)}><option value="nsv">NSV</option><option value="gsv">GSV</option><option value="lt">LT</option><option value="mt">MT</option></select></label>}
          <label>Visual title<input value={visualTitle} onChange={(event) => setVisualTitle(event.target.value)} placeholder={isMaterialBalance ? 'Material Balance' : 'e.g. Movement by operation'} /></label>
        </div>
        {!isMaterialBalance && (
          <>
            <div className="analytics-field-picker" aria-label="Dataset fields">
              {fields.map((field) => (
                <label className="analytics-field-option" key={field.column}>
                  <input type="checkbox" checked={selectedFields.includes(field.column)} onChange={() => toggleField(field)} />
                  <span>{field.label || field.column}</span><small>{field.data_type}</small>
                </label>
              ))}
              {!fields.length && <p>No supported fields are available for this source.</p>}
            </div>
            <div className="analytics-builder-actions">
              <button type="button" className="btn-secondary" onClick={() => setFormulaDialogOpen(true)} disabled={!formulaColumns.length || saving}>
                {calculation ? `Edit calculated measure: ${calculation.label}` : 'Add calculated measure'}
              </button>
              {calculation && <button type="button" className="btn-link" onClick={() => { setCalculation(null); setMeasureKey('') }}>Remove calculation</button>}
            </div>
            {(isChart || isMatrix || visualType === 'KPI_CARD') && selectedDatasetColumns.length > 0 && (
              <div className="analytics-builder-fields analytics-dimension-fields">
                {isChart && <label>Category field<select value={dimensionKey} onChange={(event) => setDimensionKey(event.target.value)}><option value="">Auto-select first text field</option>{selectedDatasetColumns.filter((field) => field.data_type !== 'number').map((field) => <option key={field.column} value={field.column}>{field.label}</option>)}</select></label>}
                {(isChart || isMatrix || visualType === 'KPI_CARD') && <label>Numeric measure<select value={measureKey} onChange={(event) => setMeasureKey(event.target.value)}><option value="">Auto-select first numeric field</option>{numericMeasureChoices.map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}</select></label>}
              </div>
            )}
          </>
        )}
        <div className="analytics-builder-actions">
          <button type="button" className="btn-primary" onClick={() => { try { buildVisual() } catch (error) { feedback.notifyError(error.message) } }} disabled={!dataset || saving}>Add visual</button>
        </div>
      </section>


      <section className="analytics-builder-panel">
        <div className="analytics-section-title"><div><h2>Dashboard slicers</h2><p>Add interactive filters. Slicers can use any dataset field and be applied to selected visuals; missing fields are added as hidden filter columns.</p></div></div>
        <div className="analytics-builder-fields analytics-visual-config">
          <label>Slicer field
            <select value={slicerField} onChange={(event) => { setSlicerField(event.target.value); const f = fields.find((x) => x.column === event.target.value); if (f && !slicerLabel) setSlicerLabel(f.label || f.column) }}>
              <option value="">Choose a field</option>
              {fields.map((field) => <option key={field.column} value={field.column}>{field.label || field.column} ({field.data_type})</option>)}
            </select>
          </label>
          <label>Slicer type
            <select value={slicerType} onChange={(event) => setSlicerType(event.target.value)}>
              {SLICER_TYPES.map((type) => <option key={type} value={type}>{type.replace('_', ' ')}</option>)}
            </select>
          </label>
          <label>Slicer label<input value={slicerLabel} onChange={(event) => setSlicerLabel(event.target.value)} placeholder="Label shown to users" /></label>
          <label>Apply to visuals
            <select multiple value={slicerVisualIds} onChange={(event) => setSlicerVisualIds(Array.from(event.target.selectedOptions).map((o) => o.value))} size={Math.min(6, Math.max(3, definition.visuals.length || 3))}>
              {definition.visuals.map((visual) => <option key={visual.id} value={visual.id}>{visual.title}</option>)}
            </select>
            <small style={{ color: 'var(--text-muted)', fontWeight: 400 }}>Leave empty to target all visuals.</small>
          </label>
          <div className="analytics-builder-actions"><button type="button" className="btn-secondary" onClick={addSlicer} disabled={!slicerField || (definition.slicers || []).length >= 12}>Add slicer</button></div>
        </div>
        {!!definition.slicers?.length && (
          <div className="analytics-slicer-list">
            {definition.slicers.map((slicer) => (
              <span key={slicer.id || slicer.key} className="analytics-slicer-chip">
                <strong>{slicer.label}</strong>
                <small>{slicer.type}</small>
                <small>{(slicer.visual_ids || []).length ? `${slicer.visual_ids.length} visual(s)` : 'all visuals'}</small>
                <button type="button" className="btn-link" onClick={() => removeSlicer(slicer.id)}>Remove</button>
              </span>
            ))}
          </div>
        )}
      </section>

      <section className="analytics-builder-canvas" aria-label="Dashboard canvas">
        {definition.visuals.length ? (
          <ResponsiveGridLayout
            className="analytics-grid-layout"
            layouts={responsiveLayouts}
            breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480 }}
            cols={{ lg: 12, md: 10, sm: 6, xs: 2 }}
            rowHeight={56}
            margin={[16, 16]}
            onLayoutChange={saveLayout}
            isDraggable
            isResizable
            draggableHandle=".analytics-visual-head"
            compactType="vertical"
            measureBeforeMount
          >
            {definition.visuals.map((visual) => (
              <div className="analytics-builder-visual" key={visual.id}>
                <div className="analytics-builder-visual-actions">
                  <span>{visual.type.replace('_', ' ')}</span>
                  <button type="button" className="btn-secondary btn-sm" onClick={() => setStyleVisualId(visual.id)}>Customize</button>
                  <button type="button" className="btn-secondary btn-sm" onClick={() => runPreview(visual)} disabled={saving}>Preview</button>
                  <button type="button" className="btn-danger btn-sm" onClick={() => removeVisual(visual.id)} disabled={saving}>Remove</button>
                </div>
                <AnalyticsVisual visual={visual} result={draftResults[visual.id]} busy={saving} />
              </div>
            ))}
          </ResponsiveGridLayout>
        ) : <div className="analytics-empty-state">Add your first visual above to start designing the dashboard.</div>}
      </section>

      <StyleEditor visual={styleVisual} onClose={() => setStyleVisualId(null)} onChange={(style) => styleVisual && updateVisualStyle(styleVisual.id, style)} />
      <FormulaBuilder
        open={formulaDialogOpen}
        initial={formulaInitial}
        columns={formulaColumns}
        validateFormula={validateAnalyticsFormula}
        onClose={() => setFormulaDialogOpen(false)}
        onSave={({ label, formula }) => {
          const taken = new Set(formulaColumns.map((column) => column.key))
          const base = makeKey(label)
          let key = base
          let suffix = 2
          while (taken.has(key)) { key = `${base}_${suffix}`; suffix += 1 }
          setCalculation({ key, label, formula })
          setMeasureKey(key)
          setFormulaDialogOpen(false)
        }}
      />
    </div>
  )
}

export default AnalyticsBuilder
