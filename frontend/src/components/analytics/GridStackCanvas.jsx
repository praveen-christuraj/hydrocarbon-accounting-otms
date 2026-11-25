import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { GridStack } from 'gridstack'
import 'gridstack/dist/gridstack.min.css'
import { normalizeLayoutForGridStack } from '../../utils/analyticsEngine'

/**
 * Production React + Portal wrapper around GridStack.js v14.
 *
 * - Keeps all visual children inside the single React tree via createPortal.
 * - StrictMode-safe: cleanly unmounts GridStack wrappers and resets refs on teardown.
 * - Preserves canonical 12-column editing in Studio (`preserveTwelveColumns`) while
 *   supporting responsive 1/6/12 column scaling in Viewer mode without overwriting
 *   canonical 12-column coordinates on narrow viewports.
 * - Supports external drag-to-grid from Studio's `.analytics-palette-drag-item` tiles.
 */
function GridStackCanvas({
  visuals = [],
  layout = [],
  editable = false,
  preserveTwelveColumns = false,
  floatMode = false,
  cellHeight = 64,
  margin = 14,
  dragInTrigger = '',
  selectedId = null,
  onSelectVisual = null,
  onLayoutChange = null,
  onExternalDrop = null,
  renderVisual,
  className = '',
}) {
  const containerRef = useRef(null)
  const gridRef = useRef(null)
  const itemElsRef = useRef(new Map())
  const suppressChangeRef = useRef(false)
  const latestOnLayoutChange = useRef(onLayoutChange)
  const latestOnExternalDrop = useRef(onExternalDrop)
  const [portalTargets, setPortalTargets] = useState({})

  useEffect(() => { latestOnLayoutChange.current = onLayoutChange }, [onLayoutChange])
  useEffect(() => { latestOnExternalDrop.current = onExternalDrop }, [onExternalDrop])

  const canonicalLayout = useMemo(
    () => normalizeLayoutForGridStack(layout, visuals),
    [layout, visuals]
  )
  const layoutById = useMemo(
    () => new Map(canonicalLayout.map((item) => [String(item.i), item])),
    [canonicalLayout]
  )

  // Initialize GridStack on mount (and cleanly re-init if preserveTwelveColumns changes)
  useEffect(() => {
    const container = containerRef.current
    if (!container || !GridStack?.init) return undefined

    const options = {
      column: 12,
      cellHeight,
      margin: Math.round(margin / 2),
      float: Boolean(floatMode),
      staticGrid: !editable,
      animate: false,
      handle: '.analytics-card-drag-handle',
      acceptWidgets: editable && Boolean(latestOnExternalDrop.current) ? '.analytics-palette-drag-item' : false,
      resizable: {
        handles: 'e, se, s, sw, w',
      },
    }

    if (!preserveTwelveColumns) {
      options.columnOpts = {
        breakpointForWindow: false,
        columnMax: 12,
        breakpoints: [
          { w: 600, c: 1 },
          { w: 860, c: 6 },
        ],
        layout: 'moveScale',
      }
    }

    const grid = GridStack.init(options, container)
    gridRef.current = grid

    const emitCanonicalSave = () => {
      if (suppressChangeRef.current || !latestOnLayoutChange.current) return
      // Never overwrite saved 12-col layout if viewport temporarily collapsed to 1 or 6 columns
      if (typeof grid.getColumn === 'function' && grid.getColumn() !== 12) return
      const nodes = grid.engine?.nodes || []
      if (!nodes.length) return
      const next = nodes
        .filter((n) => n && n.id && !String(n.id).startsWith('__drop_'))
        .map((n) => ({
          i: String(n.id),
          id: String(n.id),
          x: Number(n.x) || 0,
          y: Number(n.y) || 0,
          w: Math.max(Number(n.minW) || 3, Number(n.w) || 6),
          h: Math.max(Number(n.minH) || 3, Number(n.h) || 5),
          minW: Number(n.minW) || 3,
          minH: Number(n.minH) || 3,
          locked: Boolean(n.locked),
          noMove: Boolean(n.noMove),
          noResize: Boolean(n.noResize),
        }))
      if (next.length) {
        latestOnLayoutChange.current(next)
      }
    }

    grid.on('change', emitCanonicalSave)
    grid.on('resizestop', (_event, el) => {
      emitCanonicalSave()
      if (el) {
        window.dispatchEvent(new Event('resize'))
      }
    })
    grid.on('dropped', (_event, _prevNode, newNode) => {
      if (!newNode?.el) return
      const visualType = newNode.el.getAttribute('data-visual-type') || 'COLUMN'
      const dropPos = {
        x: Number(newNode.x) || 0,
        y: Number(newNode.y) || 0,
        w: Number(newNode.w) || undefined,
        h: Number(newNode.h) || undefined,
      }
      suppressChangeRef.current = true
      try {
        grid.removeWidget(newNode.el, true, false)
      } catch {
        newNode.el.remove()
      } finally {
        suppressChangeRef.current = false
      }
      if (latestOnExternalDrop.current) {
        latestOnExternalDrop.current(visualType, dropPos)
      }
    })

    return () => {
      try {
        grid.destroy(false)
      } catch {
        // Ignore teardown issues in headless DOM
      }
      // Remove wrappers and clear refs so StrictMode remount starts from a clean container
      for (const entry of itemElsRef.current.values()) {
        try {
          entry.wrapper.remove()
        } catch {
          // Ignore DOM removal errors
        }
      }
      itemElsRef.current.clear()
      gridRef.current = null
      setPortalTargets({})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preserveTwelveColumns])

  // Sync static/editable mode and external palette drag-in whenever editable or palette DOM changes
  useEffect(() => {
    const grid = gridRef.current
    if (!grid) return
    grid.setStatic(!editable)
    if (grid.opts) {
      grid.opts.acceptWidgets = editable && Boolean(latestOnExternalDrop.current) ? '.analytics-palette-drag-item' : false
    }
    if (editable && latestOnExternalDrop.current && typeof GridStack?.setupDragIn === 'function') {
      const timer = window.setTimeout(() => {
        try {
          if (document.querySelector('.analytics-palette-drag-item')) {
            GridStack.setupDragIn('.analytics-palette-drag-item', {
              appendTo: 'body',
              helper: 'clone',
            })
          }
        } catch {
          // Ignore if no palette elements exist
        }
      }, 60)
      return () => window.clearTimeout(timer)
    }
    return undefined
  }, [editable, visuals.length, dragInTrigger])

  // Sync float mode, cellHeight & margin dynamically
  useEffect(() => {
    const grid = gridRef.current
    if (!grid) return
    if (typeof grid.float === 'function') {
      grid.float(Boolean(floatMode))
    }
    if (typeof grid.cellHeight === 'function') {
      grid.cellHeight(cellHeight)
    }
    if (typeof grid.margin === 'function') {
      grid.margin(Math.round(margin / 2))
    }
  }, [floatMode, cellHeight, margin])

  // Sync widgets & coordinates with GridStack DOM elements
  useEffect(() => {
    const grid = gridRef.current
    const container = containerRef.current
    if (!grid || !container) return

    suppressChangeRef.current = true
    grid.batchUpdate(true)
    try {
      const activeIds = new Set(visuals.map((v) => String(v.id)))

      // Remove stale widget containers
      for (const [id, entry] of itemElsRef.current.entries()) {
        if (!activeIds.has(id)) {
          try {
            grid.removeWidget(entry.wrapper, true, false)
          } catch {
            entry.wrapper.remove()
          }
          itemElsRef.current.delete(id)
        }
      }

      // Add or update active widgets
      for (const visual of visuals) {
        const id = String(visual.id)
        const spec = layoutById.get(id) || { x: 0, y: 0, w: 6, h: 6, minW: 4, minH: 4 }
        let entry = itemElsRef.current.get(id)
        if (!entry || !container.contains(entry.wrapper)) {
          const wrapper = document.createElement('div')
          wrapper.className = 'grid-stack-item analytics-gs-item'
          wrapper.setAttribute('gs-id', id)
          const content = document.createElement('div')
          content.className = 'grid-stack-item-content analytics-gs-item-content'
          wrapper.appendChild(content)
          container.appendChild(wrapper)
          grid.makeWidget(wrapper, {
            id,
            x: spec.x,
            y: spec.y,
            w: spec.w,
            h: spec.h,
            minW: spec.minW,
            minH: spec.minH,
            locked: Boolean(spec.locked),
            noMove: Boolean(spec.noMove || spec.locked),
            noResize: Boolean(spec.noResize || spec.locked),
          })
          entry = { wrapper, content }
          itemElsRef.current.set(id, entry)
        } else if (!editable || grid.getColumn?.() === 12) {
          grid.update(entry.wrapper, {
            x: spec.x,
            y: spec.y,
            w: spec.w,
            h: spec.h,
            minW: spec.minW,
            minH: spec.minH,
            locked: Boolean(spec.locked),
            noMove: Boolean(spec.noMove || spec.locked),
            noResize: Boolean(spec.noResize || spec.locked),
          })
        }
        entry.wrapper.classList.toggle('is-selected', selectedId === id)
        entry.wrapper.classList.toggle('is-locked', Boolean(spec.locked))
      }
    } finally {
      grid.batchUpdate(false)
      suppressChangeRef.current = false
    }

    const nextTargets = {}
    for (const [id, entry] of itemElsRef.current.entries()) {
      if (entry?.content) nextTargets[id] = entry.content
    }
    setPortalTargets(nextTargets)
  }, [visuals, layoutById, editable, selectedId, preserveTwelveColumns])

  return (
    <div
      className={`analytics-gridstack-shell ${editable ? 'is-editable' : 'is-static'} ${className}`.trim()}
    >
      <div ref={containerRef} className="grid-stack analytics-gridstack-root" />
      {visuals.map((visual) => {
        const id = String(visual.id)
        const targetNode = portalTargets[id]
        const layoutItem = layoutById.get(id)
        if (!targetNode) return null
        return createPortal(
          <div
            className={`analytics-gs-portal-inner ${selectedId === id ? 'is-selected' : ''}`}
            onMouseDown={() => {
              if (editable && onSelectVisual && selectedId !== id) {
                onSelectVisual(id)
              }
            }}
          >
            {renderVisual(visual, layoutItem)}
          </div>,
          targetNode,
          id
        )
      })}
    </div>
  )
}

export default GridStackCanvas
