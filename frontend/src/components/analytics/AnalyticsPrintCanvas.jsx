import AnalyticsVisual from './AnalyticsVisual'

/**
 * Print-only rendering of an Analytics dashboard.
 *
 * Reuses the exact same visual renderer and the canonical 12-column layout as
 * the live GridStack canvas. GridStack positions are pixel-based and tied to
 * the screen width, which produces a truncated/blank paper layout, so paper
 * uses the canonical x/y/w/h values in a CSS grid instead. The arrangement
 * (including a browser-session rearrangement) is therefore identical to what
 * the user sees on screen.
 */
function AnalyticsPrintCanvas({ visuals = [], results = {}, layout = [], canvas = {}, renderVisual }) {
  const safeVisuals = Array.isArray(visuals) ? visuals.filter((v) => v?.id) : []
  const layoutById = new Map(
    (Array.isArray(layout) ? layout : []).map((item) => [String(item.i || item.id || ''), item])
  )
  const cellHeight = Math.max(32, Math.min(120, Number(canvas.cellHeight) || 64))
  const margin = Math.max(0, Math.min(28, Number(canvas.margin) || 14))

  return (
    <div className="analytics-print-canvas">
      <div
        className="analytics-print-grid"
        style={{
          '--print-row-height': `${cellHeight}px`,
          '--print-grid-gap': `${Math.round(margin / 2)}px`,
        }}
      >
        {safeVisuals.map((visual) => {
          const id = String(visual.id)
          const spec = layoutById.get(id) || { x: 0, y: 0, w: 12, h: 5 }
          const x = Math.max(0, Math.min(11, Number(spec.x) || 0))
          const w = Math.max(1, Math.min(12 - x, Number(spec.w) || 12))
          const y = Math.max(0, Number(spec.y) || 0)
          const h = Math.max(1, Number(spec.h) || 5)
          return (
            <div
              key={id}
              className="analytics-print-item"
              style={{
                gridColumn: `${x + 1} / span ${w}`,
                gridRow: `${y + 1} / span ${h}`,
              }}
            >
              {typeof renderVisual === 'function'
                ? renderVisual(visual, spec, { printMode: true })
                : <AnalyticsVisual visual={visual} result={results[id]} printMode />}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default AnalyticsPrintCanvas
