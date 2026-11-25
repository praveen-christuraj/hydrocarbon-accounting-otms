import { useEffect, useMemo, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import AlertMessage from '../common/AlertMessage'
import {
  DARK_CHART_PALETTE,
  NAVY_CHART_PALETTE,
  formatMetricValue,
} from '../../utils/analyticsEngine'

function useThemeVersion() {
  const [version, setVersion] = useState(0)
  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return undefined
    const obs = new MutationObserver(() => setVersion((v) => v + 1))
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => obs.disconnect()
  }, [])
  return version
}

function aggregateSeriesByCategory(rows, dimKey, measureColumns) {
  const map = new Map()
  for (const row of rows) {
    const cat = String(row?.[dimKey] ?? '—')
    if (!map.has(cat)) {
      const init = { __cat: cat, __count: 0 }
      for (const mc of measureColumns) init[mc.key] = 0
      map.set(cat, init)
    }
    const bucket = map.get(cat)
    bucket.__count += 1
    for (const mc of measureColumns) {
      const v = Number(row?.[mc.key])
      if (Number.isFinite(v)) bucket[mc.key] += v
    }
  }
  return [...map.values()]
}

function EChartsRenderer({
  visual,
  effectiveType,
  columns = [],
  rows = [],
  totals = {},
  expanded = false,
  chartHeight = 300,
  activeSelection = null,
  onCrossFilter = null,
}) {
  const themeVersion = useThemeVersion()
  const type = String(effectiveType || visual?.type || 'COLUMN').toUpperCase()
  const chartStyle = useMemo(() => visual?.style?.chart || {}, [visual?.style?.chart])
  const kpiStyle = useMemo(() => visual?.style?.kpi || {}, [visual?.style?.kpi])
  const query = visual?.query || {}

  const numericColumns = useMemo(
    () => columns.filter((c) => c.data_type === 'number'),
    [columns]
  )
  const textColumns = useMemo(
    () => columns.filter((c) => c.data_type !== 'number'),
    [columns]
  )

  const primaryMeasureKey = query.metric_key || query.measure_key || numericColumns[0]?.key || columns[0]?.key
  const primaryMeasureCol = columns.find((c) => c.key === primaryMeasureKey) || numericColumns[0] || columns[0]

  const measureColumns = useMemo(() => {
    if (Array.isArray(query.measure_keys) && query.measure_keys.length) {
      const matched = query.measure_keys.map((k) => columns.find((c) => c.key === k)).filter(Boolean)
      if (matched.length) return matched
    }
    if (numericColumns.length > 0) return numericColumns.slice(0, 5)
    return primaryMeasureCol ? [primaryMeasureCol] : []
  }, [columns, numericColumns, primaryMeasureCol, query.measure_keys])

  const dimensionKey = useMemo(() => {
    if (query.dimension_key && columns.some((c) => c.key === query.dimension_key)) {
      return query.dimension_key
    }
    return textColumns[0]?.key || columns.find((c) => c.key !== primaryMeasureCol?.key)?.key || columns[0]?.key
  }, [columns, primaryMeasureCol?.key, query.dimension_key, textColumns])

  const secondaryDimKey = useMemo(() => {
    if (query.secondary_dimension_key && columns.some((c) => c.key === query.secondary_dimension_key)) {
      return query.secondary_dimension_key
    }
    return textColumns.find((c) => c.key !== dimensionKey)?.key || null
  }, [columns, dimensionKey, query.secondary_dimension_key, textColumns])

  const option = useMemo(() => {
    // Reference themeVersion so theme switches recompute option
    void themeVersion
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark'
    const css = typeof getComputedStyle === 'function' ? getComputedStyle(document.documentElement) : null
    const textColor = css?.getPropertyValue('--text').trim() || (isDark ? '#e7edf6' : '#0f1f3d')
    const muted = css?.getPropertyValue('--text-muted').trim() || (isDark ? '#a3b2c8' : '#5b6b85')
    const borderCol = css?.getPropertyValue('--border').trim() || (isDark ? '#27354d' : '#d8e0ea')
    const surfaceCol = css?.getPropertyValue('--surface').trim() || (isDark ? '#121b2e' : '#ffffff')
    const successCol = isDark ? '#3fbf7f' : '#1f7a4d'
    const dangerCol = isDark ? '#e5534b' : '#b42318'
    const warningCol = isDark ? '#e0a030' : '#b36b00'
    const defaultPalette = isDark ? DARK_CHART_PALETTE : NAVY_CHART_PALETTE
    const palette = Array.isArray(chartStyle.palette) && chartStyle.palette.length ? chartStyle.palette : defaultPalette

    // 1. GAUGE (does not require dimensionKey)
    if (type === 'GAUGE') {
      const rawTotal = totals?.[primaryMeasureCol?.key]
      const computedSum = rows.reduce((s, r) => s + (Number(r?.[primaryMeasureCol?.key]) || 0), 0)
      const val = rawTotal !== undefined ? Number(rawTotal) : (rows.length === 1 ? Number(rows[0]?.[primaryMeasureCol?.key] || 0) : computedSum)
      const minVal = Number.isFinite(Number(kpiStyle.minValue)) ? Number(kpiStyle.minValue) : 0
      const maxVal = Number.isFinite(Number(kpiStyle.maxValue)) && Number(kpiStyle.maxValue) > minVal
        ? Number(kpiStyle.maxValue)
        : Math.max(100, val > 0 ? Math.ceil(val * 1.25) : 100)
      const warnRatio = Math.max(0.1, Math.min(0.95, (Number(kpiStyle.warningThreshold) || 80) / 100))
      const critRatio = Math.max(warnRatio + 0.02, Math.min(0.99, (Number(kpiStyle.dangerThreshold) || 95) / 100))

      return {
        animation: false,
        tooltip: {
          formatter: () => `${primaryMeasureCol?.label || 'Value'}: <strong>${formatMetricValue(val, primaryMeasureCol, kpiStyle)}</strong>`,
        },
        series: [
          {
            type: 'gauge',
            startAngle: 200,
            endAngle: -20,
            min: minVal,
            max: maxVal,
            center: ['50%', '62%'],
            radius: '92%',
            axisLine: {
              lineStyle: {
                width: 16,
                color: [
                  [warnRatio, palette[0]],
                  [critRatio, warningCol],
                  [1, dangerCol],
                ],
              },
            },
            pointer: {
              width: 5,
              length: '62%',
              itemStyle: { color: textColor },
            },
            axisTick: { show: false },
            splitLine: { length: 10, lineStyle: { width: 1.5, color: borderCol } },
            axisLabel: {
              distance: 20,
              color: muted,
              fontSize: 10,
              formatter: (v) => formatMetricValue(v, primaryMeasureCol, { compact: true, decimals: 0 }),
            },
            title: {
              offsetCenter: [0, '28%'],
              fontSize: 12,
              color: muted,
            },
            detail: {
              valueAnimation: false,
              offsetCenter: [0, '4%'],
              fontSize: expanded ? 28 : 22,
              fontWeight: 700,
              color: textColor,
              formatter: (v) => formatMetricValue(v, primaryMeasureCol, kpiStyle),
            },
            data: [{ value: Number.isFinite(val) ? Number(val.toFixed(2)) : 0, name: primaryMeasureCol?.label || '' }],
          },
        ],
      }
    }

    if (!rows.length || !dimensionKey || !measureColumns.length) {
      return null
    }

    const baseToolbox = chartStyle.showToolbox === false ? undefined : {
      right: 8,
      top: 0,
      iconStyle: { borderColor: muted },
      feature: {
        ...(type === 'COLUMN' || type === 'BAR' || type === 'LINE' || type === 'AREA'
          ? { magicType: { show: true, type: ['line', 'bar', 'stack'], title: { line: 'Line', bar: 'Bar', stack: 'Stack' } } }
          : {}),
        restore: { show: true, title: 'Reset' },
        saveAsImage: { show: true, title: 'Save PNG', pixelRatio: 2, backgroundColor: surfaceCol },
      },
    }

    // 2. SANKEY (Source → Target flow)
    if (type === 'SANKEY') {
      const targetKey = secondaryDimKey || dimensionKey
      const mKey = measureColumns[0].key
      const nodesSet = new Set()
      const linkMap = new Map()
      for (const r of rows) {
        const src = `From: ${String(r?.[dimensionKey] ?? '—')}`
        const dst = targetKey === dimensionKey
          ? `Total: ${measureColumns[0].label || mKey}`
          : `To: ${String(r?.[targetKey] ?? '—')}`
        if (src === dst) continue
        const w = Math.max(0, Number(r?.[mKey]) || 0)
        if (w <= 0) continue
        nodesSet.add(src)
        nodesSet.add(dst)
        const lk = `${src}|||${dst}`
        linkMap.set(lk, (linkMap.get(lk) || 0) + w)
      }
      const nodes = [...nodesSet].map((name) => ({ name }))
      const links = [...linkMap.entries()].map(([k, value]) => {
        const [source, target] = k.split('|||')
        return { source, target, value }
      })
      if (!links.length) return null
      return {
        animation: false,
        color: palette,
        tooltip: { trigger: 'item', triggerOn: 'mousemove' },
        toolbox: baseToolbox,
        series: [{
          type: 'sankey',
          emphasis: { focus: 'adjacency' },
          nodeAlign: 'justify',
          data: nodes,
          links,
          label: { color: textColor, fontSize: 11 },
          lineStyle: { color: 'source', curveness: 0.45, opacity: 0.35 },
        }],
      }
    }

    // 3. TREEMAP & SUNBURST
    if (type === 'TREEMAP' || type === 'SUNBURST') {
      const mKey = measureColumns[0].key
      let treeData
      if (secondaryDimKey) {
        const l1 = new Map()
        for (const r of rows) {
          const k1 = String(r?.[dimensionKey] ?? '—')
          const k2 = String(r?.[secondaryDimKey] ?? '—')
          const v = Math.abs(Number(r?.[mKey]) || 0)
          if (!l1.has(k1)) l1.set(k1, new Map())
          const l2 = l1.get(k1)
          l2.set(k2, (l2.get(k2) || 0) + v)
        }
        treeData = [...l1.entries()].map(([name, childrenMap]) => ({
          name,
          children: [...childrenMap.entries()].map(([cName, value]) => ({ name: cName, value })),
        }))
      } else {
        const grouped = aggregateSeriesByCategory(rows, dimensionKey, [measureColumns[0]])
        treeData = grouped.map((g) => ({ name: g.__cat, value: Math.abs(g[mKey] || 0) }))
      }
      return {
        animation: false,
        color: palette,
        tooltip: {
          formatter: (info) => `${info.name}: <strong>${formatMetricValue(info.value, measureColumns[0])}</strong>`,
        },
        toolbox: baseToolbox,
        series: [
          type === 'TREEMAP'
            ? {
              type: 'treemap',
              roam: false,
              breadcrumb: { show: true, itemStyle: { color: borderCol, textStyle: { color: textColor } } },
              label: { show: true, formatter: '{b}\n{c}', color: '#ffffff', fontSize: 11 },
              itemStyle: { borderColor: surfaceCol, borderWidth: 2, gapWidth: 2 },
              data: treeData,
            }
            : {
              type: 'sunburst',
              radius: ['18%', '86%'],
              data: treeData,
              label: { rotate: 'radial', color: textColor, fontSize: 10 },
              itemStyle: { borderColor: surfaceCol, borderWidth: 1.5 },
            },
        ],
      }
    }

    // 4. 2D HEATMAP
    if (type === 'HEATMAP') {
      const mKey = measureColumns[0].key
      const xKey = dimensionKey
      const yKey = secondaryDimKey || dimensionKey
      const xSet = []
      const ySet = []
      const cellMap = new Map()
      for (const r of rows) {
        const xv = String(r?.[xKey] ?? '—')
        const yv = yKey === xKey ? (measureColumns[0].label || mKey) : String(r?.[yKey] ?? '—')
        if (!xSet.includes(xv) && xSet.length < 40) xSet.push(xv)
        if (!ySet.includes(yv) && ySet.length < 30) ySet.push(yv)
        const xi = xSet.indexOf(xv)
        const yi = ySet.indexOf(yv)
        if (xi >= 0 && yi >= 0) {
          const ck = `${xi}:${yi}`
          cellMap.set(ck, (cellMap.get(ck) || 0) + (Number(r?.[mKey]) || 0))
        }
      }
      const heatData = [...cellMap.entries()].map(([ck, v]) => {
        const [xi, yi] = ck.split(':').map(Number)
        return [xi, yi, Number(v.toFixed(2))]
      })
      const vals = heatData.map((d) => d[2])
      const minV = vals.length ? Math.min(...vals) : 0
      const maxV = vals.length ? Math.max(...vals) : 100
      return {
        animation: false,
        tooltip: { position: 'top' },
        toolbox: baseToolbox,
        grid: { left: 56, right: 24, top: 32, bottom: 58, containLabel: true },
        xAxis: { type: 'category', data: xSet, axisLabel: { color: muted, rotate: xSet.length > 8 ? 30 : 0 } },
        yAxis: { type: 'category', data: ySet, axisLabel: { color: muted } },
        visualMap: {
          min: minV,
          max: maxV === minV ? minV + 1 : maxV,
          calculable: true,
          orient: 'horizontal',
          left: 'center',
          bottom: 2,
          inRange: { color: isDark ? ['#182339', '#2f63b3', '#38bdf8'] : ['#e8eff9', '#2f63b3', '#0b2447'] },
          textStyle: { color: muted, fontSize: 10 },
        },
        series: [{
          type: 'heatmap',
          data: heatData,
          label: { show: heatData.length <= 48, color: textColor, fontSize: 10 },
        }],
      }
    }

    // Group rows by primary dimension so flat tables also chart cleanly
    const groupedRows = aggregateSeriesByCategory(rows, dimensionKey, measureColumns).slice(0, 120)
    const categories = groupedRows.map((g) => g.__cat)

    // 5. PIE, DONUT, FUNNEL
    if (type === 'PIE' || type === 'DONUT' || type === 'FUNNEL') {
      const mCol = measureColumns[0]
      const pieData = groupedRows.map((g) => ({
        name: g.__cat,
        value: Number((g[mCol.key] || 0).toFixed(3)),
      }))
      const totalVal = pieData.reduce((s, d) => s + d.value, 0)
      return {
        animation: false,
        color: palette,
        tooltip: {
          trigger: 'item',
          formatter: (p) => `${p.name}: <strong>${formatMetricValue(p.value, mCol)}</strong> (${p.percent ?? 0}%)`,
        },
        toolbox: baseToolbox,
        legend: chartStyle.showLegend === false
          ? { show: false }
          : { orient: 'vertical', right: 8, top: 'middle', textStyle: { color: muted, fontSize: 11 } },
        graphic: type === 'DONUT'
          ? [{
            type: 'text',
            left: '36%',
            top: '46%',
            style: {
              text: `${formatMetricValue(totalVal, mCol, { compact: true, decimals: 1 })}\nTotal`,
              textAlign: 'center',
              fill: textColor,
              fontSize: 13,
              fontWeight: 700,
              lineHeight: 18,
            },
          }]
          : undefined,
        series: [
          type === 'FUNNEL'
            ? {
              name: mCol.label || mCol.key,
              type: 'funnel',
              left: '8%',
              top: 32,
              bottom: 18,
              width: '68%',
              sort: 'descending',
              gap: 3,
              label: { show: true, position: 'inside', color: '#ffffff', fontSize: 11 },
              data: pieData,
            }
            : {
              name: mCol.label || mCol.key,
              type: 'pie',
              radius: type === 'DONUT' ? ['44%', '74%'] : '72%',
              center: ['36%', '52%'],
              data: pieData,
              label: { color: textColor, show: chartStyle.showLabels !== false, fontSize: 11 },
            },
        ],
      }
    }

    // 6. RADAR
    if (type === 'RADAR') {
      const topCats = groupedRows.slice(0, 10)
      const maxPerCat = topCats.map((g) => {
        const mMax = Math.max(...measureColumns.map((mc) => Math.abs(g[mc.key] || 0)), 1)
        return { name: g.__cat, max: Math.ceil(mMax * 1.2) }
      })
      return {
        animation: false,
        color: palette,
        tooltip: { trigger: 'item' },
        toolbox: baseToolbox,
        legend: { top: 0, textStyle: { color: muted, fontSize: 11 } },
        radar: {
          indicator: maxPerCat,
          axisName: { color: muted, fontSize: 11 },
          splitLine: { lineStyle: { color: borderCol } },
          splitArea: { show: false },
        },
        series: [{
          type: 'radar',
          data: measureColumns.map((mc) => ({
            name: mc.label || mc.key,
            value: topCats.map((g) => Number((g[mc.key] || 0).toFixed(2))),
            areaStyle: { opacity: 0.14 },
          })),
        }],
      }
    }

    // 7. WATERFALL (Material Balance / Variance Bridge)
    if (type === 'WATERFALL') {
      const mCol = measureColumns[0]
      const baseAssist = []
      const posSeries = []
      const negSeries = []
      const runningLine = []
      let cumulative = 0
      for (const g of groupedRows) {
        const delta = Number(g[mCol.key] || 0)
        if (delta >= 0) {
          baseAssist.push(Number(cumulative.toFixed(3)))
          posSeries.push(Number(delta.toFixed(3)))
          negSeries.push('-')
        } else {
          baseAssist.push(Number((cumulative + delta).toFixed(3)))
          posSeries.push('-')
          negSeries.push(Number(Math.abs(delta).toFixed(3)))
        }
        cumulative += delta
        runningLine.push(Number(cumulative.toFixed(3)))
      }
      const wfCats = [...categories, 'Closing / Net']
      baseAssist.push(0)
      const rotate = chartStyle.xLabelRotation != null ? Number(chartStyle.xLabelRotation) : (wfCats.length > 7 ? 24 : 0)

      return {
        animation: false,
        color: [successCol, dangerCol, palette[0]],
        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
        toolbox: baseToolbox,
        legend: chartStyle.showLegend === false ? { show: false } : { top: 2, textStyle: { color: muted, fontSize: 11 } },
        grid: { left: 54, right: 24, top: 42, bottom: chartStyle.dataZoom ? 74 : 46, containLabel: true },
        xAxis: { type: 'category', data: wfCats, axisLabel: { color: muted, rotate, fontSize: 11 } },
        yAxis: { type: 'value', axisLabel: { color: muted, fontSize: 11 }, splitLine: { lineStyle: { color: borderCol } } },
        dataZoom: chartStyle.dataZoom ? [{ type: 'inside' }, { type: 'slider', height: 18, bottom: 8 }] : undefined,
        series: [
          {
            name: 'Base',
            type: 'bar',
            stack: 'wf',
            silent: true,
            itemStyle: { borderColor: 'transparent', color: 'transparent' },
            emphasis: { itemStyle: { borderColor: 'transparent', color: 'transparent' } },
            data: baseAssist,
            tooltip: { show: false },
          },
          {
            name: 'Inflow (+)',
            type: 'bar',
            stack: 'wf',
            barMaxWidth: 42,
            itemStyle: { color: successCol },
            data: [...posSeries, cumulative >= 0 ? { value: Number(cumulative.toFixed(3)), itemStyle: { color: palette[0] } } : '-'],
          },
          {
            name: 'Outflow (−)',
            type: 'bar',
            stack: 'wf',
            barMaxWidth: 42,
            itemStyle: { color: dangerCol },
            data: [...negSeries, cumulative < 0 ? { value: Number(Math.abs(cumulative).toFixed(3)), itemStyle: { color: palette[0] } } : '-'],
          },
          {
            name: 'Cumulative Balance',
            type: 'line',
            smooth: false,
            symbolSize: 6,
            lineStyle: { width: 2, color: palette[1] || palette[0] },
            data: [...runningLine, Number(cumulative.toFixed(3))],
          },
        ],
      }
    }

    // 8. CARTESIAN SUITE: BAR (horizontal), COLUMN (vertical), LINE, AREA, COMBO
    const isHorizontal = type === 'BAR'
    const stackMode = chartStyle.stackMode || (chartStyle.stacked ? 'stack' : 'none')
    const rotate = chartStyle.xLabelRotation != null
      ? Number(chartStyle.xLabelRotation)
      : (!isHorizontal && categories.length > 7 ? 25 : 0)

    const markLine = chartStyle.referenceLine != null && Number.isFinite(Number(chartStyle.referenceLine))
      ? {
        silent: true,
        symbol: 'none',
        lineStyle: { color: warningCol, type: 'dashed', width: 1.5 },
        label: { formatter: chartStyle.referenceLabel || `Ref: ${chartStyle.referenceLine}`, color: warningCol, fontSize: 10 },
        data: [isHorizontal ? { xAxis: Number(chartStyle.referenceLine) } : { yAxis: Number(chartStyle.referenceLine) }],
      }
      : undefined

    const series = measureColumns.map((mc, idx) => {
      const isComboLine = type === 'COMBO' && idx > 0
      const sType = (type === 'LINE' || type === 'AREA' || isComboLine) ? 'line' : 'bar'
      const rawValues = groupedRows.map((g, rowIdx) => {
        const v = Number(g[mc.key] || 0)
        if (stackMode === 'percent' && measureColumns.length > 1) {
          const rowSum = measureColumns.reduce((acc, col) => acc + Math.abs(Number(groupedRows[rowIdx][col.key] || 0)), 0)
          return rowSum > 0 ? Number(((v / rowSum) * 100).toFixed(2)) : 0
        }
        return Number(v.toFixed(3))
      })

      const styledData = rawValues.map((val, cIdx) => {
        const isSelected = activeSelection && activeSelection.column_key === dimensionKey && String(activeSelection.value) === String(categories[cIdx])
        const hasOtherSelection = activeSelection && activeSelection.column_key === dimensionKey && !isSelected
        return hasOtherSelection
          ? { value: val, itemStyle: { opacity: 0.35 } }
          : val
      })

      return {
        name: mc.label || mc.key,
        type: sType,
        data: styledData,
        yAxisIndex: isComboLine ? 1 : 0,
        barMaxWidth: 44,
        smooth: sType === 'line' && Boolean(chartStyle.smooth),
        showSymbol: sType === 'line',
        symbolSize: 6,
        ...(sType === 'line' && (type === 'AREA' || chartStyle.areaFill) ? { areaStyle: { opacity: 0.18 } } : {}),
        ...(stackMode !== 'none' && !isComboLine ? { stack: 'total' } : {}),
        label: {
          show: chartStyle.showLabels === true,
          position: isHorizontal ? 'right' : 'top',
          color: textColor,
          fontSize: 10,
        },
        ...(idx === 0 && markLine ? { markLine } : {}),
      }
    })

    const catAxis = {
      type: 'category',
      data: categories,
      axisLabel: { color: muted, rotate: isHorizontal ? 0 : rotate, fontSize: 11 },
      axisLine: { lineStyle: { color: borderCol } },
    }
    const valAxis = {
      type: 'value',
      axisLabel: {
        color: muted,
        fontSize: 11,
        formatter: stackMode === 'percent' && measureColumns.length > 1 ? '{value}%' : undefined,
      },
      splitLine: { show: chartStyle.showGrid !== false, lineStyle: { color: borderCol } },
    }

    const yAxes = type === 'COMBO' && measureColumns.length > 1
      ? [
        valAxis,
        {
          type: 'value',
          name: measureColumns[1]?.label || '',
          nameTextStyle: { color: muted, fontSize: 10 },
          axisLabel: { color: muted, fontSize: 11 },
          splitLine: { show: false },
        },
      ]
      : valAxis

    const legendPos = chartStyle.legendPosition || 'top'
    const legendCfg = chartStyle.showLegend === false
      ? { show: false }
      : {
        show: true,
        ...(legendPos === 'bottom' ? { bottom: chartStyle.dataZoom ? 28 : 0 } : { top: 2 }),
        textStyle: { color: muted, fontSize: 11 },
      }

    return {
      animation: false,
      color: palette,
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: type === 'LINE' || type === 'AREA' ? 'cross' : 'shadow' },
      },
      toolbox: baseToolbox,
      legend: legendCfg,
      grid: {
        left: 52,
        right: type === 'COMBO' ? 52 : 24,
        top: chartStyle.showLegend === false ? 28 : 42,
        bottom: chartStyle.dataZoom ? 68 : 42,
        containLabel: true,
      },
      xAxis: isHorizontal ? valAxis : catAxis,
      yAxis: isHorizontal ? { ...catAxis, inverse: true } : yAxes,
      dataZoom: chartStyle.dataZoom && !isHorizontal
        ? [
          { type: 'inside' },
          { type: 'slider', height: 18, bottom: 6, borderColor: borderCol, textStyle: { color: muted } },
        ]
        : undefined,
      textStyle: { color: textColor, fontFamily: 'Inter Variable, Inter, sans-serif' },
      series,
    }
  }, [
    activeSelection,
    chartStyle,
    dimensionKey,
    expanded,
    kpiStyle,
    measureColumns,
    primaryMeasureCol,
    rows,
    secondaryDimKey,
    themeVersion,
    totals,
    type,
  ])

  const onEvents = useMemo(() => {
    if (!onCrossFilter || type === 'GAUGE') return undefined
    return {
      click: (params) => {
        const clickedName = params?.name
        if (!clickedName || clickedName === 'Closing / Net' || !dimensionKey) return
        const cleanVal = String(clickedName).replace(/^(From:\s*|To:\s*)/, '')
        onCrossFilter({
          column_key: dimensionKey,
          value: cleanVal,
          label: `${columns.find((c) => c.key === dimensionKey)?.label || dimensionKey}: ${cleanVal}`,
        })
      },
    }
  }, [columns, dimensionKey, onCrossFilter, type])

  if (!option) {
    return (
      <AlertMessage
        tone="info"
        compact
        message="No data rows or valid category/measure bindings matched the active filters."
      />
    )
  }

  return (
    <ReactECharts
      option={option}
      notMerge
      lazyUpdate
      onEvents={onEvents}
      style={{
        width: '100%',
        minHeight: expanded ? 420 : 210,
        height: chartHeight || (expanded ? '62vh' : 290),
      }}
      opts={{ renderer: 'canvas' }}
    />
  )
}

export default EChartsRenderer
