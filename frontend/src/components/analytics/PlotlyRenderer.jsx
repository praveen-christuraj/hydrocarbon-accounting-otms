import { useEffect, useMemo, useRef, useState } from 'react'
import AlertMessage from '../common/AlertMessage'
import {
  DARK_CHART_PALETTE,
  NAVY_CHART_PALETTE,
  formatMetricValue,
} from '../../utils/analyticsEngine'

let plotlyPromise = null
function loadPlotly() {
  if (!plotlyPromise) {
    plotlyPromise = import('plotly.js-dist-min').then((mod) => mod.default || mod)
  }
  return plotlyPromise
}

function computeLinearRegression(xs, ys) {
  const n = Math.min(xs.length, ys.length)
  if (n < 2) return null
  let sumX = 0
  let sumY = 0
  let sumXY = 0
  let sumXX = 0
  let sumYY = 0
  for (let i = 0; i < n; i += 1) {
    const x = xs[i]
    const y = ys[i]
    sumX += x
    sumY += y
    sumXY += x * y
    sumXX += x * x
    sumYY += y * y
  }
  const denom = n * sumXX - sumX * sumX
  if (Math.abs(denom) < 1e-12) return null
  const slope = (n * sumXY - sumX * sumY) / denom
  const intercept = (sumY - slope * sumX) / n
  const ssTot = sumYY - (sumY * sumY) / n
  let ssRes = 0
  for (let i = 0; i < n; i += 1) {
    const pred = slope * xs[i] + intercept
    ssRes += (ys[i] - pred) ** 2
  }
  const r2 = ssTot > 1e-12 ? Math.max(0, 1 - ssRes / ssTot) : 1
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  return {
    x: [minX, maxX],
    y: [slope * minX + intercept, slope * maxX + intercept],
    r2,
    slope,
    intercept,
  }
}

function PlotlyRenderer({
  visual,
  effectiveType,
  columns = [],
  rows = [],
  totals = {},
  expanded = false,
  chartHeight = 300,
  onCrossFilter = null,
}) {
  const plotElRef = useRef(null)
  const [plotlyLib, setPlotlyLib] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [themeTick, setThemeTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    loadPlotly()
      .then((lib) => {
        if (!cancelled) setPlotlyLib(lib)
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err?.message || 'Unable to load statistical plotting engine.')
      })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return undefined
    const obs = new MutationObserver(() => setThemeTick((t) => t + 1))
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => obs.disconnect()
  }, [])

  const type = String(effectiveType || visual?.type || 'BOX_PLOT').toUpperCase()
  const query = visual?.query || {}
  const style = visual?.style || {}
  const plotlyStyle = style.plotly || {}
  const kpiStyle = style.kpi || {}
  const chartStyle = style.chart || {}
  const showDataLabels = chartStyle.showLabels === true

  const numericCols = useMemo(() => columns.filter((c) => c.data_type === 'number'), [columns])
  const textCols = useMemo(() => columns.filter((c) => c.data_type !== 'number'), [columns])
  const measureKey = query.measure_key || query.metric_key || numericCols[0]?.key || columns[0]?.key
  const measureCol = columns.find((c) => c.key === measureKey) || numericCols[0] || columns[0]
  const dimensionKey = (query.dimension_key && columns.some((c) => c.key === query.dimension_key))
    ? query.dimension_key
    : (textCols[0]?.key || columns.find((c) => c.key !== measureCol?.key)?.key || columns[0]?.key)

  const plotSpec = useMemo(() => {
    void themeTick
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark'
    const css = typeof getComputedStyle === 'function' ? getComputedStyle(document.documentElement) : null
    const textColor = css?.getPropertyValue('--text').trim() || (isDark ? '#e7edf6' : '#0f1f3d')
    const muted = css?.getPropertyValue('--text-muted').trim() || (isDark ? '#a3b2c8' : '#5b6b85')
    const borderCol = css?.getPropertyValue('--border').trim() || (isDark ? '#27354d' : '#d8e0ea')
    const palette = isDark ? DARK_CHART_PALETTE : NAVY_CHART_PALETTE
    const successCol = isDark ? '#3fbf7f' : '#1f7a4d'
    const dangerCol = isDark ? '#e5534b' : '#b42318'

    const baseLayout = {
      paper_bgcolor: 'rgba(0,0,0,0)',
      plot_bgcolor: 'rgba(0,0,0,0)',
      font: { family: 'Inter Variable, Inter, sans-serif', color: textColor, size: 11 },
      margin: { l: 54, r: 22, t: 28, b: 46 },
      xaxis: { gridcolor: borderCol, zerolinecolor: borderCol, tickfont: { color: muted, size: 10 } },
      yaxis: { gridcolor: borderCol, zerolinecolor: borderCol, tickfont: { color: muted, size: 10 } },
      legend: { orientation: 'h', y: 1.12, x: 0, font: { color: muted, size: 10 } },
      colorway: palette,
      hovermode: 'closest',
    }

    // 1. INDICATOR_BULLET
    if (type === 'INDICATOR_BULLET') {
      const rawTotal = totals?.[measureCol?.key]
      const fallbackVal = rows.reduce((s, r) => s + (Number(r?.[measureCol?.key]) || 0), 0)
      const val = rawTotal !== undefined ? Number(rawTotal) : fallbackVal
      const target = Number.isFinite(Number(kpiStyle.targetValue))
        ? Number(kpiStyle.targetValue)
        : (val > 0 ? Math.round(val * 1.1) : 100)
      const maxRange = Math.max(target * 1.25, val * 1.2, 100)
      return {
        data: [
          {
            type: 'indicator',
            mode: 'number+gauge+delta',
            value: Number.isFinite(val) ? Number(val.toFixed(2)) : 0,
            delta: { reference: target, increasing: { color: successCol }, decreasing: { color: dangerCol } },
            domain: { x: [0.06, 0.96], y: [0.22, 0.82] },
            title: { text: measureCol?.label || 'Actual', font: { size: 12, color: muted } },
            gauge: {
              shape: 'bullet',
              axis: { range: [0, maxRange], tickcolor: muted },
              threshold: {
                line: { color: dangerCol, width: 2.5 },
                thickness: 0.78,
                value: target,
              },
              steps: [
                { range: [0, target * 0.75], color: isDark ? 'rgba(91,141,239,0.12)' : 'rgba(18,49,95,0.08)' },
                { range: [target * 0.75, maxRange], color: isDark ? 'rgba(91,141,239,0.22)' : 'rgba(18,49,95,0.15)' },
              ],
              bar: { color: palette[0] },
            },
          },
        ],
        layout: { ...baseLayout, margin: { l: 96, r: 28, t: 24, b: 24 } },
      }
    }

    if (!rows.length || !measureCol) return null

    // 2. BOX_PLOT & VIOLIN_PLOT
    if (type === 'BOX_PLOT' || type === 'VIOLIN_PLOT') {
      const groups = new Map()
      for (const r of rows) {
        const g = dimensionKey ? String(r?.[dimensionKey] ?? 'All') : (measureCol.label || 'Distribution')
        const v = Number(r?.[measureCol.key])
        if (!Number.isFinite(v)) continue
        if (!groups.has(g)) groups.set(g, [])
        groups.get(g).push(v)
      }
      const entries = [...groups.entries()].slice(0, 18)
      if (!entries.length) return null
      const traces = entries.map(([gName, vals], idx) => (
        type === 'VIOLIN_PLOT'
          ? {
            type: 'violin',
            name: gName,
            y: vals,
            box: { visible: true },
            meanline: { visible: true },
            points: plotlyStyle.showOutliers === false ? false : 'outliers',
            line: { color: palette[idx % palette.length] },
            fillcolor: isDark ? 'rgba(91,141,239,0.24)' : 'rgba(47,99,179,0.20)',
          }
          : {
            type: 'box',
            name: gName,
            y: vals,
            boxmean: plotlyStyle.boxMean !== false,
            boxpoints: plotlyStyle.showOutliers === false ? false : 'outliers',
            marker: { color: palette[idx % palette.length], size: 5 },
          }
      ))
      return {
        data: traces,
        layout: {
          ...baseLayout,
          showlegend: entries.length <= 8,
          yaxis: { ...baseLayout.yaxis, title: { text: measureCol.label || measureCol.key, font: { size: 11, color: muted } } },
        },
      }
    }

    // 3. HISTOGRAM
    if (type === 'HISTOGRAM') {
      const vals = rows.map((r) => Number(r?.[measureCol.key])).filter(Number.isFinite)
      if (!vals.length) return null
      const resolvedBins = Number(plotlyStyle.bins ?? plotlyStyle.binCount)
      return {
        data: [
          {
            type: 'histogram',
            x: vals,
            nbinsx: resolvedBins > 0 ? resolvedBins : undefined,
            name: measureCol.label || measureCol.key,
            marker: {
              color: palette[0],
              line: { color: isDark ? '#121b2e' : '#ffffff', width: 1 },
            },
            opacity: 0.88,
            texttemplate: showDataLabels ? '%{y}' : undefined,
            textposition: showDataLabels ? 'outside' : undefined,
          },
        ],
        layout: {
          ...baseLayout,
          bargap: 0.04,
          xaxis: { ...baseLayout.xaxis, title: { text: measureCol.label || measureCol.key, font: { size: 11, color: muted } } },
          yaxis: { ...baseLayout.yaxis, title: { text: 'Frequency (Count)', font: { size: 11, color: muted } } },
        },
      }
    }

    // 4. PLOTLY_WATERFALL
    if (type === 'PLOTLY_WATERFALL') {
      const grouped = new Map()
      for (const r of rows) {
        const cat = String(r?.[dimensionKey] ?? '—')
        const v = Number(r?.[measureCol.key]) || 0
        grouped.set(cat, (grouped.get(cat) || 0) + v)
      }
      const entries = [...grouped.entries()].slice(0, 24)
      const x = [...entries.map(([k]) => k), 'Closing Total']
      const y = [...entries.map(([, v]) => Number(v.toFixed(2))), 0]
      const measure = [...entries.map(() => 'relative'), 'total']
      return {
        data: [
          {
            type: 'waterfall',
            orientation: 'v',
            measure,
            x,
            y,
            textposition: showDataLabels ? 'outside' : 'none',
            texttemplate: showDataLabels ? '%{y:,.2f}' : undefined,
            connector: { line: { color: borderCol, width: 1.2 } },
            increasing: { marker: { color: successCol } },
            decreasing: { marker: { color: dangerCol } },
            totals: { marker: { color: palette[0] } },
          },
        ],
        layout: baseLayout,
      }
    }

    // 5. SCATTER / BUBBLE + OLS REGRESSION
    if (type === 'SCATTER') {
      const xNumCol = numericCols.length >= 2
        ? (numericCols.find((c) => c.key !== measureCol.key) || numericCols[0])
        : null
      const sizeCol = numericCols.length >= 3
        ? numericCols.find((c) => c.key !== measureCol.key && c.key !== xNumCol?.key)
        : null

      const xs = []
      const ys = []
      const labels = []
      const sizes = []

      rows.slice(0, 600).forEach((r, idx) => {
        const yv = Number(r?.[measureCol.key])
        if (!Number.isFinite(yv)) return
        const xv = xNumCol ? Number(r?.[xNumCol.key]) : idx + 1
        if (!Number.isFinite(xv)) return
        xs.push(xv)
        ys.push(yv)
        labels.push(dimensionKey ? String(r?.[dimensionKey] ?? `#${idx + 1}`) : `#${idx + 1}`)
        if (sizeCol) {
          const sv = Math.abs(Number(r?.[sizeCol.key]) || 8)
          sizes.push(sv)
        }
      })
      if (!ys.length) return null

      let markerSizes = 9
      if (sizes.length) {
        const maxS = Math.max(...sizes, 1)
        markerSizes = sizes.map((s) => Math.max(7, Math.min(34, Math.round((s / maxS) * 32))))
      }

      const traces = [
        {
          type: 'scatter',
          mode: showDataLabels ? 'markers+text' : 'markers',
          name: `${measureCol.label || measureCol.key}`,
          x: xs,
          y: ys,
          text: labels,
          textposition: 'top center',
          textfont: { size: 9, color: textColor },
          hovertemplate: `<b>%{text}</b><br>${xNumCol?.label || 'Index'}: %{x}<br>${measureCol.label || 'Value'}: %{y}<extra></extra>`,
          marker: {
            size: markerSizes,
            color: palette[1] || palette[0],
            opacity: 0.78,
            line: { width: 1, color: palette[0] },
          },
        },
      ]

      if (plotlyStyle.trendline !== false && xs.length >= 3) {
        const ols = computeLinearRegression(xs, ys)
        if (ols) {
          traces.push({
            type: 'scatter',
            mode: 'lines',
            name: `OLS Trend (R² = ${ols.r2.toFixed(3)})`,
            x: ols.x,
            y: ols.y,
            line: { color: dangerCol, width: 2, dash: 'dash' },
          })
        }
      }

      return {
        data: traces,
        layout: {
          ...baseLayout,
          xaxis: { ...baseLayout.xaxis, title: { text: xNumCol?.label || 'Observation Index', font: { size: 11, color: muted } } },
          yaxis: { ...baseLayout.yaxis, title: { text: measureCol.label || measureCol.key, font: { size: 11, color: muted } } },
        },
      }
    }

    // 6. CONTOUR_2D
    if (type === 'CONTOUR_2D') {
      const xCol = numericCols.find((c) => c.key !== measureCol.key) || columns.find((c) => c.key === dimensionKey)
      const xs = []
      const ys = []
      for (const r of rows.slice(0, 800)) {
        const yv = Number(r?.[measureCol.key])
        if (!Number.isFinite(yv)) continue
        xs.push(xCol?.data_type === 'number' ? Number(r?.[xCol.key]) || 0 : String(r?.[xCol?.key] ?? '—'))
        ys.push(yv)
      }
      if (!ys.length) return null
      return {
        data: [
          {
            type: 'histogram2dcontour',
            x: xs,
            y: ys,
            colorscale: isDark
              ? [[0, '#121b2e'], [0.5, '#2f63b3'], [1, '#38bdf8']]
              : [[0, '#f4f7fb'], [0.5, '#2f63b3'], [1, '#0b2447']],
            contours: { coloring: 'heatmap' },
          },
        ],
        layout: baseLayout,
      }
    }

    // 7. SURFACE_3D
    if (type === 'SURFACE_3D') {
      const yCatCol = textCols.find((c) => c.key !== dimensionKey) || numericCols.find((c) => c.key !== measureCol.key)
      const xCats = []
      const yCats = []
      const grid = new Map()
      for (const r of rows.slice(0, 600)) {
        const xv = String(r?.[dimensionKey] ?? '—')
        const yv = yCatCol ? String(r?.[yCatCol.key] ?? '—') : (measureCol.label || 'Series')
        if (!xCats.includes(xv) && xCats.length < 25) xCats.push(xv)
        if (!yCats.includes(yv) && yCats.length < 25) yCats.push(yv)
        const ck = `${xv}|||${yv}`
        grid.set(ck, (grid.get(ck) || 0) + (Number(r?.[measureCol.key]) || 0))
      }
      if (yCats.length < 2) {
        yCats.push('Band +10%')
      }
      const zMatrix = yCats.map((yv, yi) => (
        xCats.map((xv) => {
          const base = grid.get(`${xv}|||${yv}`)
          if (base !== undefined) return Number(base.toFixed(2))
          const fallback = grid.get(`${xv}|||${yCats[0]}`) || 0
          return Number((fallback * (1 + yi * 0.08)).toFixed(2))
        })
      ))
      return {
        data: [
          {
            type: 'surface',
            x: xCats,
            y: yCats,
            z: zMatrix,
            colorscale: 'YlGnBu',
            showscale: true,
          },
        ],
        layout: {
          ...baseLayout,
          margin: { l: 8, r: 8, t: 18, b: 12 },
          scene: {
            xaxis: { title: dimensionKey || 'X', color: muted },
            yaxis: { title: yCatCol?.label || 'Y', color: muted },
            zaxis: { title: measureCol.label || 'Z', color: muted },
          },
        },
      }
    }

    return null
  }, [
    columns,
    dimensionKey,
    kpiStyle.targetValue,
    measureCol,
    numericCols,
    plotlyStyle.binCount,
    plotlyStyle.bins,
    plotlyStyle.boxMean,
    plotlyStyle.showOutliers,
    plotlyStyle.trendline,
    rows,
    showDataLabels,
    textCols,
    themeTick,
    totals,
    type,
  ])

  useEffect(() => {
    const el = plotElRef.current
    if (!plotlyLib || !el || !plotSpec) return undefined

    const config = {
      responsive: true,
      displaylogo: false,
      displayModeBar: plotlyStyle.showModeBar === false ? false : 'hover',
      modeBarButtonsToRemove: ['lasso2d', 'sendDataToCloud'],
    }

    plotlyLib.react(el, plotSpec.data, plotSpec.layout, config)

    const handlePlotlyClick = (evt) => {
      if (!onCrossFilter || !dimensionKey) return
      const pt = evt?.points?.[0]
      const rawCat = pt?.text || pt?.data?.name || pt?.x
      if (rawCat !== undefined && rawCat !== null && rawCat !== 'Closing Total') {
        onCrossFilter({
          column_key: dimensionKey,
          value: String(rawCat),
          label: `${columns.find((c) => c.key === dimensionKey)?.label || dimensionKey}: ${rawCat}`,
        })
      }
    }

    if (typeof el.on === 'function') {
      el.on('plotly_click', handlePlotlyClick)
    }

    let ro = null
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => {
        if (plotElRef.current && plotlyLib?.Plots?.resize) {
          try {
            plotlyLib.Plots.resize(plotElRef.current)
          } catch {
            // Ignore resize race
          }
        }
      })
      ro.observe(el)
    }

    return () => {
      if (ro) ro.disconnect()
      if (el && typeof el.removeAllListeners === 'function') {
        el.removeAllListeners('plotly_click')
      }
    }
  }, [columns, dimensionKey, onCrossFilter, plotSpec, plotlyLib, plotlyStyle.showModeBar])

  useEffect(() => {
    const el = plotElRef.current
    return () => {
      if (el && plotlyLib?.purge) {
        try {
          plotlyLib.purge(el)
        } catch {
          // Ignore teardown
        }
      }
    }
  }, [plotlyLib])

  if (loadError) {
    return <AlertMessage tone="error" compact message={loadError} />
  }
  if (!plotSpec) {
    return (
      <AlertMessage
        tone="info"
        compact
        message={`No numeric distribution rows matched for ${formatMetricValue(measureCol?.label || 'selected measure')}.`}
      />
    )
  }
  if (!plotlyLib) {
    return <div className="analytics-visual-loading">Loading Plotly statistical engine…</div>
  }

  return (
    <div
      ref={plotElRef}
      className="analytics-plotly-surface"
      style={{
        width: '100%',
        minHeight: expanded ? 430 : 215,
        height: chartHeight || (expanded ? '64vh' : 295),
      }}
    />
  )
}

export default PlotlyRenderer
