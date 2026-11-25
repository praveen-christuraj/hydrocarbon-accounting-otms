import { useEffect, useId, useMemo, useState } from 'react'
import AlertMessage from '../common/AlertMessage'

function TankVisualRenderer({
  visual,
  rows = [],
  activeSelection = null,
  onCrossFilter = null,
}) {
  const clipPrefix = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const [unit, setUnit] = useState(() => String(visual?.query?.unit || 'nsv').toLowerCase())

  useEffect(() => {
    const nextUnit = String(visual?.query?.unit || 'nsv').toLowerCase()
    if (nextUnit === 'nsv' || nextUnit === 'gsv') {
      setUnit(nextUnit)
    }
  }, [visual?.query?.unit])

  const tanks = useMemo(() => {
    if (!Array.isArray(rows) || !rows.length) return []
    const byTank = new Map()
    for (const r of rows) {
      const code = String(r.tank_asset_code || r.asset_code || r.tank || 'TANK')
      if (!byTank.has(code)) {
        const fallbackStock = Number(r.current_stock ?? 0)
        const nsv = Number(r.stock_nsv_bbl ?? r.current_stock ?? r.movement_nsv_bbl ?? 0)
        const gsv = Number(r.stock_gsv_bbl ?? r.current_stock ?? r.movement_gsv_bbl ?? nsv)
        const capBase = Number(r.capacity ?? 0)
        const capNsv = Number(r.capacity_nsv_bbl ?? capBase)
        const capGsv = Number(r.capacity_gsv_bbl ?? capNsv)
        const stock = unit === 'gsv' ? gsv : (unit === 'nsv' ? nsv : fallbackStock)
        const cap = unit === 'gsv' ? capGsv : capNsv
        const pct = cap > 0
          ? Math.max(0, Math.min(100, (stock / cap) * 100))
          : (r.fill_pct != null ? Math.max(0, Math.min(100, Number(r.fill_pct))) : null)
        const ullage = cap > 0
          ? Math.max(0, cap - stock)
          : (r.ullage != null && Number.isFinite(Number(r.ullage)) ? Math.max(0, Number(r.ullage)) : null)
        byTank.set(code, {
          code,
          name: r.tank_asset_name || r.tank_name || code,
          location: r.location_code || '',
          product: r.product_name || 'Unassigned',
          stock,
          capacity: cap > 0 ? cap : null,
          ullage,
          fillPct: pct,
          lastDate: r.accounting_date || '',
        })
      }
    }
    return [...byTank.values()]
  }, [rows, unit])

  if (!tanks.length) {
    return (
      <AlertMessage
        tone="info"
        compact
        message="No active shore tanks matched the selected location and filter criteria."
      />
    )
  }

  const totalStock = tanks.reduce((acc, t) => acc + (Number(t.stock) || 0), 0)
  const totalCap = tanks.reduce((acc, t) => acc + (Number(t.capacity) || 0), 0)
  const farmUtilPct = totalCap > 0 ? ((totalStock / totalCap) * 100).toFixed(1) : null

  return (
    <div className="analytics-tank-farm">
      <div className="analytics-tank-farm-bar">
        <div className="analytics-tank-farm-summary">
          <span><strong>{tanks.length}</strong> Shore Tanks</span>
          <span>Stock ({unit.toUpperCase()}): <strong>{totalStock.toLocaleString(undefined, { maximumFractionDigits: 0 })} BBL</strong></span>
          {totalCap > 0 && (
            <span>Utilization: <strong>{farmUtilPct}%</strong> ({(totalCap - totalStock).toLocaleString(undefined, { maximumFractionDigits: 0 })} BBL ullage)</span>
          )}
        </div>
        <div className="analytics-unit-pill-group" role="group" aria-label="Volume basis">
          <button
            type="button"
            className={unit === 'nsv' ? 'is-active' : ''}
            onClick={() => setUnit('nsv')}
          >
            NSV
          </button>
          <button
            type="button"
            className={unit === 'gsv' ? 'is-active' : ''}
            onClick={() => setUnit('gsv')}
          >
            GSV
          </button>
        </div>
      </div>

      <div className="analytics-tank-grid">
        {tanks.map((tank) => {
          const pct = tank.fillPct != null ? tank.fillPct : (totalStock > 0 ? Math.min(92, Math.max(12, (tank.stock / Math.max(...tanks.map((x) => x.stock), 1)) * 85)) : 0)
          const levelTone = pct >= 92 ? 'danger' : (pct >= 82 ? 'warning' : (pct <= 8 ? 'muted' : 'normal'))
          const isSelected = activeSelection?.column_key === 'tank_asset_code' && String(activeSelection.value) === tank.code
          const liquidHeight = Math.max(0, Math.min(72, (pct / 100) * 72))
          const liquidY = 90 - liquidHeight

          const fillHex = levelTone === 'danger'
            ? '#b42318'
            : (levelTone === 'warning' ? '#b36b00' : (levelTone === 'muted' ? '#64748b' : '#2f63b3'))

          return (
            <button
              key={tank.code}
              type="button"
              className={`analytics-tank-card tone-${levelTone} ${isSelected ? 'is-selected' : ''}`}
              onClick={() => {
                if (onCrossFilter) {
                  onCrossFilter({
                    column_key: 'tank_asset_code',
                    value: tank.code,
                    label: `Tank: ${tank.code}`,
                  })
                }
              }}
              title={`${tank.code} (${tank.product}) — Click to cross-filter dashboard`}
            >
              <div className="analytics-tank-card-top">
                <strong className="analytics-tank-code">{tank.code}</strong>
                <span className="analytics-tank-product-chip">{tank.product}</span>
              </div>

              <div className="analytics-tank-visual-row">
                <svg
                  className="analytics-tank-svg"
                  viewBox="0 0 88 106"
                  aria-hidden="true"
                >
                  <defs>
                    <clipPath id={`clip-${clipPrefix}-${tank.code.replace(/[^a-zA-Z0-9]/g, '_')}`}>
                      <rect x="14" y="18" width="60" height="72" rx="4" />
                    </clipPath>
                  </defs>
                  {/* Tank roof dome */}
                  <ellipse cx="44" cy="18" rx="30" ry="7" className="tank-svg-shell" />
                  {/* Tank cylinder body */}
                  <rect x="14" y="18" width="60" height="72" rx="3" className="tank-svg-body" />
                  {/* Liquid fill */}
                  <g clipPath={`url(#clip-${clipPrefix}-${tank.code.replace(/[^a-zA-Z0-9]/g, '_')})`}>
                    <rect
                      x="14"
                      y={liquidY}
                      width="60"
                      height={liquidHeight + 6}
                      fill={fillHex}
                      fillOpacity="0.86"
                    />
                    {liquidHeight > 2 && (
                      <ellipse
                        cx="44"
                        cy={liquidY}
                        rx="30"
                        ry="4"
                        fill={fillHex}
                      />
                    )}
                  </g>
                  {/* Safe-fill 90% dashed gauge marker */}
                  <line x1="14" y1="25" x2="74" y2="25" stroke="#b42318" strokeDasharray="3,2" strokeWidth="1" opacity="0.65" />
                  {/* Tank bottom */}
                  <ellipse cx="44" cy="90" rx="30" ry="6" className="tank-svg-shell" />
                  <text
                    x="44"
                    y="58"
                    textAnchor="middle"
                    className="tank-svg-pct"
                  >
                    {tank.fillPct != null ? `${tank.fillPct.toFixed(0)}%` : '—'}
                  </text>
                </svg>

                <div className="analytics-tank-metrics">
                  <div>
                    <small>Stock ({unit.toUpperCase()})</small>
                    <strong>{tank.stock.toLocaleString(undefined, { maximumFractionDigits: 1 })} BBL</strong>
                  </div>
                  <div>
                    <small>Capacity</small>
                    <span>{tank.capacity ? `${tank.capacity.toLocaleString(undefined, { maximumFractionDigits: 0 })} BBL` : 'Unstrapped'}</span>
                  </div>
                  <div>
                    <small>Ullage</small>
                    <span>{tank.ullage != null ? `${tank.ullage.toLocaleString(undefined, { maximumFractionDigits: 0 })} BBL` : '—'}</span>
                  </div>
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default TankVisualRenderer
