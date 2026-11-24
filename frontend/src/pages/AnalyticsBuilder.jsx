import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Responsive, WidthProvider } from 'react-grid-layout'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'
import PageHeader from '../components/common/PageHeader'
import AlertMessage from '../components/common/AlertMessage'
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
  const formulaInitial = useMemo(() => calculation ? { label: calculation.label, formula: calculation.formula } : null, [calculation])
  const [unit, setUnit] = useState('nsv')
  const [slicerColumnKey, setSlicerColumnKey] = useState('')
  const [loadError, setLoadError] = useState('')

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
        setDatasetId(firstDataset)
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

  const buildVisual = () => {
    const title = visualTitle.trim() || (isMaterialBalance ? 'Material Balance' : `${visualType} visual`)
    const id = `visual_${Date.now()}`
    let query
    if (isMaterialBalance) {
      query = { source: { kind: 'material_balance' }, unit }
    } else {
      const chosen = fields.filter((field) => selectedFields.includes(field.column))
      if (!chosen.length) throw new Error('Select at least one field for this visual.')
      const toColumn = (field) => ({
        key: makeKey(field.column),
        label: field.label || field.column,
        kind: 'data',
        source: { type: 'column', column: field.column },
        data_type: field.data_type || 'text',
        format: { decimals: 2 },
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
      let columns = chosen.map(toColumn)
      let groupBy = []
      let matrix = undefined
      let configuredDimensionKey = null
      let configuredMeasureKey = null
      if (visualType === 'KPI_CARD' || visualType === 'GAUGE') {
        const measure = asNumericMeasure()
        if (!measure || (measure.data_type !== 'number' && measure.kind !== 'calculated')) throw new Error('Choose a numeric measure for a KPI visual.')
        configuredMeasureKey = measure.key
        columns = calculation && measure.key === calculatedSpec?.key
          ? [...chosen.map(toColumn), calculatedSpec]
          : [measure]
        columns.forEach((column) => { if (column.data_type === 'number' || column.kind === 'calculated') { column.aggregate = 'SUM'; column.show_total = column.key === measure.key } })
      } else if (isChart) {
        const dimension = chosen.find((field) => field.column === dimensionKey) || chosen.find((field) => field.data_type !== 'number')
        const measure = asNumericMeasure()
        if (!dimension || !measure || (measure.data_type !== 'number' && measure.kind !== 'calculated')) throw new Error('Choose one category field and one numeric measure for this chart.')
        configuredDimensionKey = makeKey(dimension.column)
        configuredMeasureKey = measure.key
        columns = chosen.map(toColumn)
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
        columns = chosen.map(toColumn)
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
    const visual = { id, title, type: isMaterialBalance ? 'TABLE' : visualType, query }
    const nextVisuals = [...definition.visuals, visual]
    const nextDefinition = {
      ...definition,
      schema_version: 2,
      visuals: nextVisuals,
      layout: [...(definition.layout || []), { i: id, x: 0, y: (definition.layout || []).length * 5, w: 12, h: 5 }],
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
    }))
    setDraftResults((current) => { const next = { ...current }; delete next[id]; return next })
    logUiAction('Analytics', 'Remove Dashboard Visual', { visualId: id })
  }

  const addSlicer = () => {
    if (!slicerColumnKey) return
    const [visualId, columnKey] = slicerColumnKey.split('::')
    const visual = definition.visuals.find((item) => item.id === visualId)
    const column = visual?.query?.columns?.find((item) => item.key === columnKey)
    if (!visual || !column) return
    const keyBase = `s_${makeKey(column.key)}`
    let key = keyBase
    let suffix = 2
    while ((definition.slicers || []).some((item) => item.key === key)) { key = `${keyBase}_${suffix}`; suffix += 1 }
    setDefinition((current) => ({
      ...current,
      slicers: [...(current.slicers || []), { id: `slicer_${Date.now()}`, key, label: column.label || column.key, type: 'SELECT', column_key: column.key, visual_ids: [visualId] }],
    }))
    setSlicerColumnKey('')
    logUiAction('Analytics', 'Add Dashboard Slicer', { visualId, columnKey: column.key })
  }

  const removeSlicer = (id) => {
    setDefinition((current) => ({ ...current, slicers: (current.slicers || []).filter((item) => item.id !== id) }))
    logUiAction('Analytics', 'Remove Dashboard Slicer', { slicerId: id })
  }

  const slicerChoices = definition.visuals.flatMap((visual) => (visual.query?.columns || []).map((column) => ({
    id: `${visual.id}::${column.key}`,
    label: `${column.label || column.key} — ${visual.title}`,
    visualId: visual.id,
    columnKey: column.key,
  })))

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
      logUiAction('Analytics', dashboardId ? 'Update Dashboard Definition' : 'Create Dashboard Definition', { dashboardId: result.id })
      toast.success('Analytics dashboard saved.')
      navigate(`/analytics/builder/${result.id}`, { replace: true })
    } catch (error) {
      feedback.notifyError(error.message || 'Unable to save dashboard.')
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
    const base = definition.layout || []
    const adapt = (columnCount) => base.map((item) => {
      const w = Math.max(1, Math.min(Number(item.w) || columnCount, columnCount))
      return { ...item, x: Math.max(0, Math.min(Number(item.x) || 0, columnCount - w)), w }
    })
    return { lg: adapt(12), md: adapt(10), sm: adapt(6), xs: adapt(2) }
  }, [definition.layout])
  const saveLayout = (layout) => {
    const nextLayout = layout.map(({ i, x, y, w, h }) => ({ i, x, y, w, h }))
    setDefinition((current) => JSON.stringify(current.layout || []) === JSON.stringify(nextLayout)
      ? current
      : { ...current, layout: nextLayout })
  }

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
        <div className="analytics-section-title"><div><h2>Add a visual</h2><p>Choose a governed source and select fields. Material Balance renders the current location template.</p></div></div>
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
        <div className="analytics-section-title"><div><h2>Dashboard slicers</h2><p>Add a text/select slicer bound to a field exposed by a visual.</p></div></div>
        <div className="analytics-builder-fields analytics-visual-config">
          <label>Bound field<select value={slicerColumnKey} onChange={(event) => setSlicerColumnKey(event.target.value)}><option value="">Choose a field</option>{slicerChoices.map((choice) => <option key={choice.id} value={`${choice.visualId}::${choice.columnKey}`}>{choice.label}</option>)}</select></label>
          <div className="analytics-builder-actions"><button type="button" className="btn-secondary" onClick={addSlicer} disabled={!slicerColumnKey || (definition.slicers || []).length >= 6}>Add slicer</button></div>
        </div>
        {!!definition.slicers?.length && <div className="analytics-slicer-list">{definition.slicers.map((slicer) => <span key={slicer.id}>{slicer.label}<button type="button" className="btn-link" onClick={() => removeSlicer(slicer.id)}>Remove</button></span>)}</div>}
      </section>

      <section className="analytics-builder-canvas" aria-label="Dashboard canvas">
        {definition.visuals.length ? (
          <ResponsiveGridLayout
            className="analytics-grid-layout"
            layouts={responsiveLayouts}
            breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480 }}
            cols={{ lg: 12, md: 10, sm: 6, xs: 2 }}
            rowHeight={48}
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
                  <button type="button" className="btn-secondary btn-sm" onClick={() => runPreview(visual)} disabled={saving}>Preview</button>
                  <button type="button" className="btn-danger btn-sm" onClick={() => removeVisual(visual.id)} disabled={saving}>Remove</button>
                </div>
                <AnalyticsVisual visual={visual} result={draftResults[visual.id]} busy={saving} />
              </div>
            ))}
          </ResponsiveGridLayout>
        ) : <div className="analytics-empty-state">Add your first visual above to start designing the dashboard.</div>}
      </section>
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
