import { useMemo, useState } from 'react'
import Icon from '../common/Icon'
import PaginationControls, { paginateRows, usePageSize } from '../common/PaginationControls'
import {
  AGGREGATE_OPTIONS,
  computePerspectiveView,
  evaluateConditionalRules,
  formatMetricValue,
} from '../../utils/analyticsEngine'

function computeHeatmapBackground(numVal, stat, colorScale) {
  if (numVal === null || !stat || !colorScale || colorScale === 'none') return undefined
  if (colorScale === 'diverging') {
    const ratio = Math.min(1, Math.abs(numVal) / (stat.maxAbs || 1))
    const alpha = (0.06 + ratio * 0.24).toFixed(3)
    if (numVal > 0) return `rgba(31, 122, 77, ${alpha})`
    if (numVal < 0) return `rgba(180, 35, 24, ${alpha})`
    return undefined
  }
  const span = stat.max - stat.min
  const ratio = span > 1e-9 ? Math.max(0, Math.min(1, (numVal - stat.min) / span)) : 0.5
  const alpha = (0.05 + ratio * 0.25).toFixed(3)
  if (colorScale === 'emerald') return `rgba(31, 122, 77, ${alpha})`
  if (colorScale === 'amber') return `rgba(179, 107, 0, ${alpha})`
  return `rgba(47, 99, 179, ${alpha})`
}

function PerspectiveGrid({
  visual,
  columns = [],
  rows = [],
  totals = {},
  expanded = false,
  shelfOpen = false,
  activeSelection = null,
  onCrossFilter = null,
  onExplorerChange = null,
  containerWidth = 900,
}) {
  const pageSize = usePageSize()
  const [page, setPage] = useState(1)
  const [searchQuery, setSearchQuery] = useState('')
  const [collapsedKeys, setCollapsedKeys] = useState(() => new Set())

  // Runtime local overrides layered on top of visual.explorer & visual.style.table
  const [explorerOverrides, setExplorerOverrides] = useState({})
  const [styleOverrides, setStyleOverrides] = useState({})

  const visualIdKey = String(visual?.id || 'default')
  const localExplorer = useMemo(
    () => ({ ...(visual?.explorer || {}), ...(explorerOverrides[visualIdKey] || {}) }),
    [explorerOverrides, visual?.explorer, visualIdKey]
  )
  const localTableStyle = useMemo(
    () => ({ ...(visual?.style?.table || {}), ...(styleOverrides[visualIdKey] || {}) }),
    [styleOverrides, visual?.style?.table, visualIdKey]
  )

  const updateExplorer = (patch) => {
    const next = { ...localExplorer, ...patch }
    setExplorerOverrides((prev) => ({ ...prev, [visualIdKey]: next }))
    setPage(1)
    if (onExplorerChange) onExplorerChange(next)
  }

  const updateTableStyle = (patch) => {
    setStyleOverrides((prev) => ({
      ...prev,
      [visualIdKey]: { ...(prev[visualIdKey] || {}), ...patch },
    }))
  }

  const view = useMemo(
    () => computePerspectiveView({
      rows,
      columns,
      totals,
      explorer: localExplorer,
      searchQuery,
    }),
    [rows, columns, totals, localExplorer, searchQuery]
  )

  // Filter out children whose ancestor tree node is collapsed
  const visibleTreeRows = useMemo(() => {
    if (!view.isPivoted) return view.rows
    if (!collapsedKeys.size) return view.rows
    return view.rows.filter((row) => {
      if (!row.__parentKey) return true
      const parts = row.__parentKey.split('||')
      let prefix = ''
      for (const p of parts) {
        prefix = prefix ? `${prefix}||${p}` : p
        if (collapsedKeys.has(prefix)) return false
      }
      return true
    })
  }, [view, collapsedKeys])

  const totalPages = Math.max(1, Math.ceil(visibleTreeRows.length / pageSize))
  const safePage = Math.min(page, totalPages)

  const pagedRows = useMemo(
    () => paginateRows(visibleTreeRows, safePage, pageSize),
    [visibleTreeRows, safePage, pageSize]
  )

  const density = localTableStyle.density || 'comfortable'
  const showDataBars = localTableStyle.dataBars !== false
  const colorScale = localTableStyle.colorScale || 'none'
  const showSummaryBar = localTableStyle.showSummaryBar !== false
  const freezeFirst = localTableStyle.freezeFirstColumn !== false
  const conditionalRules = localTableStyle.conditionalRules || []

  const groupByKeys = Array.isArray(localExplorer?.groupByKeys) ? localExplorer.groupByKeys : []
  const splitByKeys = Array.isArray(localExplorer?.splitByKeys) ? localExplorer.splitByKeys : []
  const sortSpecs = Array.isArray(localExplorer?.sortSpecs) ? localExplorer.sortSpecs : []
  const measureSpecs = Array.isArray(localExplorer?.measureSpecs) && localExplorer.measureSpecs.length
    ? localExplorer.measureSpecs
    : columns.filter((c) => c.data_type === 'number').map((c) => ({ key: c.key, aggregate: c.aggregate || 'SUM', label: c.label || c.key }))

  const toggleHeaderSort = (colKey) => {
    const existing = sortSpecs.find((s) => s.key === colKey)
    let nextSpecs
    if (!existing) {
      nextSpecs = [{ key: colKey, direction: 'DESC' }]
    } else if (existing.direction === 'DESC') {
      nextSpecs = [{ key: colKey, direction: 'ASC' }]
    } else if (existing.direction === 'ASC') {
      nextSpecs = [{ key: colKey, direction: 'ABS_DESC' }]
    } else {
      nextSpecs = []
    }
    updateExplorer({ sortSpecs: nextSpecs })
  }

  const toggleNodeCollapse = (treeKey) => {
    setCollapsedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(treeKey)) next.delete(treeKey)
      else next.add(treeKey)
      return next
    })
  }

  const collapseAll = () => {
    const allParents = view.rows.filter((r) => r.__hasChildren).map((r) => r.__treeKey)
    setCollapsedKeys(new Set(allParents))
  }

  const expandAll = () => setCollapsedKeys(new Set())

  // Primary summary stat for the Perspective status bar
  const primaryNumericCol = view.columns.find((c) => c.data_type === 'number')
  const primaryStat = primaryNumericCol ? view.columnStats[primaryNumericCol.key] : null
  const useCompactPager = !expanded && containerWidth > 0 && containerWidth < 560

  const availableGroupCols = columns.filter((c) => !groupByKeys.includes(c.key) && !splitByKeys.includes(c.key))
  const availableMeasureCols = columns.filter((c) => c.data_type === 'number' || groupByKeys.length > 0)

  return (
    <div className="analytics-perspective-wrap">
      {shelfOpen && (
        <div className="analytics-perspective-shelf" role="region" aria-label="Perspective pivot configuration">
          <div className="analytics-shelf-row">
            <div className="analytics-shelf-slot">
              <span className="analytics-shelf-label">Group By</span>
              <div className="analytics-shelf-chips">
                {groupByKeys.map((k) => {
                  const col = columns.find((c) => c.key === k)
                  return (
                    <span key={k} className="analytics-shelf-chip">
                      {col?.label || k}
                      <button
                        type="button"
                        aria-label={`Remove ${col?.label || k} from Group By`}
                        onClick={() => updateExplorer({ groupByKeys: groupByKeys.filter((x) => x !== k) })}
                      >
                        <Icon name="close" size={12} />
                      </button>
                    </span>
                  )
                })}
                {availableGroupCols.length > 0 && groupByKeys.length < 4 && (
                  <select
                    className="analytics-shelf-adder"
                    aria-label="Add Group By field"
                    value=""
                    onChange={(e) => {
                      if (e.target.value) updateExplorer({ groupByKeys: [...groupByKeys, e.target.value] })
                    }}
                  >
                    <option value="">+ Group</option>
                    {availableGroupCols.map((c) => (
                      <option key={c.key} value={c.key}>{c.label || c.key}</option>
                    ))}
                  </select>
                )}
              </div>
            </div>

            <div className="analytics-shelf-slot">
              <span className="analytics-shelf-label">Split By</span>
              <div className="analytics-shelf-chips">
                {splitByKeys.map((k) => {
                  const col = columns.find((c) => c.key === k)
                  return (
                    <span key={k} className="analytics-shelf-chip is-split">
                      {col?.label || k}
                      <button
                        type="button"
                        aria-label={`Remove ${col?.label || k} from Split By`}
                        onClick={() => updateExplorer({ splitByKeys: splitByKeys.filter((x) => x !== k) })}
                      >
                        <Icon name="close" size={12} />
                      </button>
                    </span>
                  )
                })}
                {availableGroupCols.length > 0 && splitByKeys.length < 2 && (
                  <select
                    className="analytics-shelf-adder"
                    aria-label="Add Split By field"
                    value=""
                    onChange={(e) => {
                      if (e.target.value) updateExplorer({ splitByKeys: [...splitByKeys, e.target.value] })
                    }}
                  >
                    <option value="">+ Split</option>
                    {availableGroupCols.map((c) => (
                      <option key={c.key} value={c.key}>{c.label || c.key}</option>
                    ))}
                  </select>
                )}
              </div>
            </div>

            {(groupByKeys.length > 0 || splitByKeys.length > 0) && (
              <div className="analytics-shelf-slot">
                <span className="analytics-shelf-label">Values</span>
                <div className="analytics-shelf-chips">
                  {measureSpecs.map((ms, idx) => {
                    const col = columns.find((c) => c.key === ms.key)
                    return (
                      <span key={`${ms.key}-${idx}`} className="analytics-shelf-chip is-measure">
                        <select
                          aria-label={`Aggregation for ${col?.label || ms.key}`}
                          value={ms.aggregate || 'SUM'}
                          onChange={(e) => {
                            const next = measureSpecs.map((item, i) => (
                              i === idx ? { ...item, aggregate: e.target.value } : item
                            ))
                            updateExplorer({ measureSpecs: next })
                          }}
                        >
                          {AGGREGATE_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                        <span>{col?.label || ms.key}</span>
                        {measureSpecs.length > 1 && (
                          <button
                            type="button"
                            aria-label={`Remove ${col?.label || ms.key} measure`}
                            onClick={() => updateExplorer({ measureSpecs: measureSpecs.filter((_, i) => i !== idx) })}
                          >
                            <Icon name="close" size={12} />
                          </button>
                        )}
                      </span>
                    )
                  })}
                  {availableMeasureCols.length > 0 && measureSpecs.length < 6 && (
                    <select
                      className="analytics-shelf-adder"
                      aria-label="Add measure value"
                      value=""
                      onChange={(e) => {
                        if (!e.target.value) return
                        const c = columns.find((col) => col.key === e.target.value)
                        updateExplorer({
                          measureSpecs: [
                            ...measureSpecs,
                            { key: e.target.value, aggregate: c?.data_type === 'number' ? 'SUM' : 'COUNT', label: c?.label || e.target.value },
                          ],
                        })
                      }}
                    >
                      <option value="">+ Value</option>
                      {availableMeasureCols.map((c) => (
                        <option key={c.key} value={c.key}>{c.label || c.key}</option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="analytics-shelf-controls">
            <div className="analytics-shelf-search">
              <Icon name="search" size={14} />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setPage(1) }}
                placeholder="Filter grid rows…"
                aria-label="Filter grid rows"
              />
            </div>
            <label className="analytics-shelf-toggle">
              <input
                type="checkbox"
                checked={showDataBars}
                onChange={(e) => updateTableStyle({ dataBars: e.target.checked })}
              />
              <span>Data Bars</span>
            </label>
            <label className="analytics-shelf-toggle">
              <span>Heatmap</span>
              <select
                value={colorScale}
                onChange={(e) => updateTableStyle({ colorScale: e.target.value })}
                aria-label="Heatmap color scale"
              >
                <option value="none">Off</option>
                <option value="diverging">Diverging (±)</option>
                <option value="navy">Navy Intensity</option>
                <option value="emerald">Emerald Scale</option>
                <option value="amber">Amber Scale</option>
              </select>
            </label>
            {view.isPivoted && groupByKeys.length > 1 && (
              <div className="analytics-tree-btns">
                <button type="button" className="btn-secondary btn-sm" onClick={expandAll}>Expand all</button>
                <button type="button" className="btn-secondary btn-sm" onClick={collapseAll}>Collapse all</button>
              </div>
            )}
            {(groupByKeys.length > 0 || splitByKeys.length > 0 || sortSpecs.length > 0 || searchQuery) && (
              <button
                type="button"
                className="btn-link"
                onClick={() => {
                  setSearchQuery('')
                  updateExplorer({ groupByKeys: [], splitByKeys: [], sortSpecs: [] })
                }}
              >
                Flat table
              </button>
            )}
          </div>
        </div>
      )}

      <div
        className={[
          'analytics-table-scroll',
          expanded ? 'is-expanded' : '',
          `density-${density}`,
          localTableStyle.striped !== false ? 'is-striped' : '',
          localTableStyle.wrapText ? 'wrap-text' : '',
        ].filter(Boolean).join(' ')}
      >
        <table className="analytics-result-table">
          <thead>
            <tr>
              {view.columns.map((column, colIdx) => {
                const sortSpec = sortSpecs.find((s) => s.key === column.key)
                const isNumeric = column.data_type === 'number'
                const stickyCol = freezeFirst && colIdx === 0
                return (
                  <th
                    scope="col"
                    key={column.key}
                    onClick={() => toggleHeaderSort(column.key)}
                    className={[
                      localTableStyle.stickyHeader === false ? '' : 'is-sticky',
                      stickyCol ? 'is-sticky-col' : '',
                      isNumeric ? 'is-num' : '',
                      'is-sortable',
                    ].filter(Boolean).join(' ')}
                    title="Click to sort (Desc → Asc → Abs Magnitude)"
                  >
                    <span className="analytics-th-inner">
                      <span>{column.label || column.key}</span>
                      {sortSpec && (
                        <span className="analytics-sort-indicator" aria-label={`Sorted ${sortSpec.direction}`}>
                          {sortSpec.direction === 'ASC' ? '↑' : (sortSpec.direction === 'ABS_DESC' ? '|↓|' : '↓')}
                        </span>
                      )}
                    </span>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {pagedRows.map((row, rowIndex) => {
              const rowKey = row.__treeKey || `${row.id ?? row.accounting_date ?? 'row'}-${rowIndex}`
              const isGroupRow = Boolean(row.__isGroup)
              const isCollapsed = row.__treeKey ? collapsedKeys.has(row.__treeKey) : false
              const firstColKey = view.isPivoted ? row.__groupColumnKey : view.columns[0]?.key
              const firstVal = view.isPivoted ? row.__groupValue : row[firstColKey]
              const isSelectedRow = activeSelection && firstColKey && activeSelection.column_key === firstColKey && String(activeSelection.value) === String(firstVal)

              return (
                <tr
                  key={rowKey}
                  className={[
                    isGroupRow ? 'is-group-row' : '',
                    isSelectedRow ? 'is-cross-selected' : '',
                    onCrossFilter ? 'is-interactive-row' : '',
                  ].filter(Boolean).join(' ')}
                  onClick={() => {
                    if (!onCrossFilter || !firstColKey || firstVal === undefined || firstVal === null || firstVal === 'Total') return
                    onCrossFilter({
                      column_key: firstColKey,
                      value: firstVal,
                      label: `${columns.find((c) => c.key === firstColKey)?.label || firstColKey}: ${firstVal}`,
                    })
                  }}
                >
                  {view.columns.map((column, colIdx) => {
                    const rawVal = row[column.key]
                    const isNum = column.data_type === 'number'
                    const numVal = isNum && rawVal !== null && rawVal !== undefined && rawVal !== '' ? Number(rawVal) : null
                    const stat = isNum ? view.columnStats[column.key] : null
                    const stickyCol = freezeFirst && colIdx === 0

                    if (column.isHierarchy) {
                      const indentPx = (Number(row.__depth) || 0) * 18
                      return (
                        <td
                          key={column.key}
                          className={`analytics-hierarchy-cell ${stickyCol ? 'is-sticky-col' : ''}`}
                          style={{ paddingLeft: `${10 + indentPx}px` }}
                        >
                          <span className="analytics-hierarchy-inner">
                            {row.__hasChildren ? (
                              <button
                                type="button"
                                className="analytics-tree-toggle"
                                aria-label={isCollapsed ? `Expand ${rawVal}` : `Collapse ${rawVal}`}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  toggleNodeCollapse(row.__treeKey)
                                }}
                              >
                                <Icon name={isCollapsed ? 'chevronRight' : 'chevronDown'} size={13} />
                              </button>
                            ) : (
                              <span className="analytics-tree-leaf-spacer" />
                            )}
                            <span className="analytics-hierarchy-text">{formatMetricValue(rawVal, column)}</span>
                            {row.__childCount > 0 && (
                              <small className="analytics-group-badge">{row.__childCount}</small>
                            )}
                          </span>
                        </td>
                      )
                    }

                    const condStyle = evaluateConditionalRules(rawVal, column.key, conditionalRules)
                    const heatBg = !condStyle?.backgroundColor ? computeHeatmapBackground(numVal, stat, colorScale) : undefined
                    const barPct = showDataBars && numVal !== null && Number.isFinite(numVal) && stat?.maxAbs
                      ? Math.min(100, Math.round((Math.abs(numVal) / stat.maxAbs) * 100))
                      : 0

                    return (
                      <td
                        key={column.key}
                        className={[
                          isNum ? 'is-num' : '',
                          stickyCol ? 'is-sticky-col' : '',
                          column.isRowTotal ? 'is-row-total' : '',
                          numVal !== null && numVal < 0 ? 'is-negative' : '',
                        ].filter(Boolean).join(' ')}
                        style={{
                          ...(heatBg ? { backgroundColor: heatBg } : {}),
                          ...(condStyle || {}),
                        }}
                      >
                        {barPct > 0 ? (
                          <div className="analytics-databar-cell">
                            <span
                              className={`analytics-databar-fill ${numVal < 0 ? 'is-neg' : ''}`}
                              style={{ width: `${Math.max(3, Math.round(barPct * 0.42))}%` }}
                              aria-hidden="true"
                            />
                            <span className="analytics-databar-text">{formatMetricValue(rawVal, column)}</span>
                          </div>
                        ) : (
                          formatMetricValue(rawVal, column)
                        )}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
            {!pagedRows.length && (
              <tr>
                <td colSpan={Math.max(view.columns.length, 1)} className="analytics-empty-cell">
                  No rows matched the selected filters.
                </td>
              </tr>
            )}
          </tbody>
          {pagedRows.length > 0 && view.columns.some((c) => view.totals && view.totals[c.key] !== undefined) && (
            <tfoot>
              <tr className="analytics-grand-total-row">
                {view.columns.map((column, colIdx) => {
                  const hasTotal = Object.prototype.hasOwnProperty.call(view.totals || {}, column.key)
                  const isNum = column.data_type === 'number'
                  const stickyCol = freezeFirst && colIdx === 0
                  return (
                    <td
                      key={`tot-${column.key}`}
                      className={`${isNum ? 'is-num' : ''} ${stickyCol ? 'is-sticky-col' : ''}`.trim()}
                    >
                      {hasTotal
                        ? formatMetricValue(view.totals[column.key], column)
                        : (colIdx === 0 ? 'Grand Total' : '')}
                    </td>
                  )
                })}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <div className="analytics-perspective-footer">
        {showSummaryBar && (
          <div className="analytics-summary-bar" aria-label="Grid summary statistics">
            <span><strong>{view.flatLeafCount.toLocaleString()}</strong> records</span>
            {view.isPivoted && groupByKeys.length > 0 && (
              <span><strong>{view.groupCount.toLocaleString()}</strong> groups</span>
            )}
            {primaryNumericCol && primaryStat && (
              <>
                <span>Sum {primaryNumericCol.label}: <strong>{formatMetricValue(primaryStat.sum, primaryNumericCol)}</strong></span>
                <span className="hide-narrow">Avg: <strong>{formatMetricValue(primaryStat.avg, primaryNumericCol)}</strong></span>
              </>
            )}
          </div>
        )}

        {useCompactPager ? (
          <div className="analytics-compact-pager">
            <button
              type="button"
              className="btn-secondary btn-sm"
              disabled={safePage <= 1}
              onClick={() => setPage(Math.max(1, safePage - 1))}
              aria-label="Previous page"
            >
              <Icon name="chevronLeft" size={14} />
            </button>
            <span>{safePage} / {totalPages}</span>
            <button
              type="button"
              className="btn-secondary btn-sm"
              disabled={safePage >= totalPages}
              onClick={() => setPage(Math.min(totalPages, safePage + 1))}
              aria-label="Next page"
            >
              <Icon name="chevronRight" size={14} />
            </button>
          </div>
        ) : (
          <PaginationControls
            currentPage={safePage}
            totalRows={visibleTreeRows.length}
            onPageChange={setPage}
          />
        )}
      </div>
    </div>
  )
}

export default PerspectiveGrid
