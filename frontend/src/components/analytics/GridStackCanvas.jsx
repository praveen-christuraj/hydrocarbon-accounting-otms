import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import GridStackPkg from 'gridstack/dist/gridstack-all.js'
import 'gridstack/dist/gridstack.min.css'
import { normalizeLayoutForGridStack } from '../../utils/analyticsEngine'

const GridStack = GridStackPkg?.init ? GridStackPkg : (GridStackPkg?.GridStack || GridStackPkg?.default)

/**
 * Production React + Portal wrapper around GridStack.js v14.
 *
 * - Keeps all visual children inside the single React tree via createPortal.
 * - Protects canonical 12-column layout coordinates from being overwritten when
 *   GridStack scales down on narrow/mobile viewports.
 * - Supports external drag-to-grid from Studio's `.analytics-palette-drag-item` tiles.
 */
function GridStackCanvas({
  visuals = [],
  layout = [],
  editable = false,
  floatMode = false,
  cellHeight = 64,
  margin = 14,
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

  // Initialize GridStack once on mount
  useEffect(() => {
    const container = containerRef.current
    if (!container || !GridStack?.init) return undefined

    const grid = GridStack.init(
      {
        column: 12,
        cellHeight,
        margin: Math.round(margin / 2),
        float: Boolean(floatMode),
        staticGrid: !editable,
        animate: false,
        disableOneColumnMode: false,
        handle: '.analytics-card-drag-handle',
        acceptWidgets: editable ? '.analytics-palette-drag-item' : false,
        resizable: {
          handles: 'e, se, s, sw, w',
        },
        columnOpts: {
          breakpointForWindow: false,
          breakpoints: [
            { w: 680, c: 1 },
            { w: 960, c: 6 },
            { w: 1200, c: 12 },
          ],
          layout: 'moveScale',
        },
      },
      container
    )

    gridRef.current = grid

    const emitCanonicalSave = () => {
      if (suppressChangeRef.current || !latestOnLayoutChange.current) return
      // Never overwrite saved 12-col layout if viewport temporarily collapsed to 1 or 6 columns!
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
      gridRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Setup external palette drag-in whenever editable changes
  useEffect(() => {
    const grid = gridRef.current
    if (!grid) return
    grid.setStatic(!editable)
    if (editable && typeof GridStack?.setupDragIn === 'function') {
      const timer = window.setTimeout(() => {
        try {
          GridStack.setupDragIn('.analytics-palette-drag-item', {
            appendTo: 'body',
            helper: 'clone',
          })
        } catch {
          // Ignore if no palette elements exist
        }
      }, 60)
      return () => window.clearTimeout(timer)
    }
    return undefined
  }, [editable, visuals.length])

  // Sync float mode & cellHeight dynamically
  useEffect(() => {
    const grid = gridRef.current
    if (!grid) return
    if (typeof grid.float === 'function') {
      grid.float(Boolean(floatMode))
    }
    if (typeof grid.cellHeight === 'function') {
      grid.cellHeight(cellHeight)
    }
  }, [floatMode, cellHeight])

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
        if (!entry) {
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
  }, [visuals, layoutById, editable, selectedId])

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
