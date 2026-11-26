import { useEffect, useId, useMemo, useState } from 'react'
import AlertMessage from '../common/AlertMessage'

const UNIT_META = {
  nsv: { short: 'NSV', suffix: 'BBL', isVolume: true },
  gsv: { short: 'GSV', suffix: 'BBL', isVolume: true },
  lt: { short: 'LT', suffix: 'LT', isVolume: false },
  mt: { short: 'MT', suffix: 'MT', isVolume: false },
}

function normalizeUnit(value) {
  const key = String(value || 'nsv').toLowerCase()
  return UNIT_META[key] ? key : 'nsv'
}

function TankVisualRenderer({
  visual,
  rows = [],
  activeSelection = null,
  onCrossFilter = null,
}) {
  const clipPrefix = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const [unit, setUnit] = useState(() => normalizeUnit(visual?.query?.unit))

  useEffect(() => {
    setUnit(normalizeUnit(visual?.query?.unit))
  }, [visual?.query?.unit])

  const unitMeta = UNIT_META[unit] || UNIT_META.nsv

  const { tanks, hasMultipleLocations } = useMemo(() => {
    if (!Array.isArray(rows) || !rows.length) {
      return { tanks: [], hasMultipleLocations: false }
    }
    const byKey = new Map()
    const locs = new Set()
    for (const r of rows) {
      const code = String(r.tank_asset_code || r.asset_code || r.tank || 'TANK')
      const loc = String(r.location_code || '').trim()
      if (loc) locs.add(loc.toUpperCase())
      const dedupeKey = `${loc.toUpperCase()}::${code.toUpperCase()}`
      if (!byKey.has(dedupeKey)) {
        const fallbackStock = Number(r.current_stock ?? 0)
        const nsv = Number(r.stock_nsv_bbl ?? r.current_stock ?? r.movement_nsv_bbl ?? 0)
        const gsv = Number(r.stock_gsv_bbl ?? r.current_stock ?? r.movement_gsv_bbl ?? nsv)
        const lt = Number(r.stock_lt ?? 0)
        const mt = Number(r.stock_mt ?? 0)
        const stockByUnit = { nsv, gsv, lt, mt }
        const stock = Number.isFinite(stockByUnit[unit]) ? stockByUnit[unit] : fallbackStock

        const capBase = Number(r.capacity ?? 0)
        const capNsv = Number(r.capacity_nsv_bbl ?? capBase)
        const capGsv = Number(r.capacity_gsv_bbl ?? capNsv)
        const rawCap = unit === 'gsv' ? capGsv : capNsv
        const cap = unitMeta.isVolume && Number.isFinite(rawCap) && rawCap > 0 ? rawCap : null

        const pct = cap !== null
          ? Math.max(0, Math.min(100, (stock / cap) * 100))
          : (unitMeta.isVolume && r.fill_pct != null && Number.isFinite(Number(r.fill_pct))
            ? Math.max(0, Math.min(100, Number(r.fill_pct)))
            : null)

        const ullage = cap !== null
          ? Math.max(0, cap - stock)
          : (unitMeta.isVolume && r.ullage != null && Number.isFinite(Number(r.ullage))
            ? Math.max(0, Number(r.ullage))
            : null)

        byKey.set(dedupeKey, {
          key: dedupeKey,
          code,
          name: r.tank_asset_name || r.tank_name || code,
          assetType: r.asset_type_code || '',
          location: loc,
          product: r.product_name || 'Unassigned',
          stock,
          capacity: cap,
          ullage,
          fillPct: pct,
          lastDate: r.accounting_date || '',
        })
      }
    }
    return {
      tanks: [...byKey.values()],
      hasMultipleLocations: locs.size > 1,
    }
  }, [rows, unit, unitMeta.isVolume])

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
  const maxStock = Math.max(...tanks.map((x) => Number(x.stock) || 0), 0)
  const farmUtilPct = unitMeta.isVolume && totalCap > 0 ? ((totalStock / totalCap) * 100).toFixed(1) : null

  return (
    <div className="analytics-tank-farm">
      <div className="analytics-tank-farm-bar">
        <div className="analytics-tank-farm-summary">
          <span><strong>{tanks.length}</strong> Shore {tanks.length === 1 ? 'Tank' : 'Tanks'}</span>
          <span>
            Stock ({unitMeta.short}): <strong>{totalStock.toLocaleString(undefined, { maximumFractionDigits: 0 })} {unitMeta.suffix}</strong>
          </span>
          {farmUtilPct !== null && (
            <span>
              Utilization: <strong>{farmUtilPct}%</strong> ({Math.max(0, totalCap - totalStock).toLocaleString(undefined, { maximumFractionDigits: 0 })} {unitMeta.suffix} ullage)
            </span>
          )}
        </div>
        <div className="analytics-unit-pill-group" role="group" aria-label="Volume or mass basis">
          {Object.entries(UNIT_META).map(([uKey, uInfo]) => (
            <button
              key={uKey}
              type="button"
              className={unit === uKey ? 'is-active' : ''}
              onClick={() => setUnit(uKey)}
            >
              {uInfo.short}
            </button>
          ))}
        </div>
      </div>

      <div className="analytics-tank-grid">
        {tanks.map((tank) => {
          const visualPct = tank.fillPct != null
            ? tank.fillPct
            : (maxStock > 0 && tank.stock > 0
              ? Math.min(92, Math.max(12, (tank.stock / maxStock) * 85))
              : 0)
          const levelTone = tank.fillPct != null
            ? (tank.fillPct >= 92 ? 'danger' : (tank.fillPct >= 82 ? 'warning' : (tank.fillPct <= 8 ? 'muted' : 'normal')))
            : (tank.stock > 0 ? 'normal' : 'muted')
          const isSelected = activeSelection?.column_key === 'tank_asset_code' && String(activeSelection.value) === tank.code
          const liquidHeight = Math.max(0, Math.min(72, (visualPct / 100) * 72))
          const liquidY = 90 - liquidHeight

          const fillHex = levelTone === 'danger'
            ? '#b42318'
            : (levelTone === 'warning' ? '#b36b00' : (levelTone === 'muted' ? '#64748b' : '#2f63b3'))

          const safeClipId = `clip-${clipPrefix}-${tank.key.replace(/[^a-zA-Z0-9]/g, '_')}`

          return (
            <button
              key={tank.key}
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
              title={`${tank.code}${tank.location ? ` · ${tank.location}` : ''} (${tank.product}) — Click to cross-filter dashboard`}
            >
              <div className="analytics-tank-card-top">
                <div className="analytics-tank-code-wrap">
                  <strong className="analytics-tank-code">{tank.code}</strong>
                  {hasMultipleLocations && tank.location && (
                    <span className="analytics-tank-loc-badge">{tank.location}</span>
                  )}
                </div>
                <span className="analytics-tank-product-chip">{tank.product}</span>
              </div>

              <div className="analytics-tank-visual-row">
                <svg
                  className="analytics-tank-svg"
                  viewBox="0 0 88 106"
                  aria-hidden="true"
                >
                  <defs>
                    <clipPath id={safeClipId}>
                      <rect x="14" y="18" width="60" height="72" rx="4" />
                    </clipPath>
                  </defs>
                  {/* Tank roof dome */}
                  <ellipse cx="44" cy="18" rx="30" ry="7" className="tank-svg-shell" />
                  {/* Tank cylinder body */}
                  <rect x="14" y="18" width="60" height="72" rx="3" className="tank-svg-body" />
                  {/* Liquid fill */}
                  <g clipPath={`url(#${safeClipId})`}>
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
                    <small>Stock ({unitMeta.short})</small>
                    <strong>{tank.stock.toLocaleString(undefined, { maximumFractionDigits: 1 })} {unitMeta.suffix}</strong>
                  </div>
                  <div>
                    <small>Capacity</small>
                    <span>
                      {unitMeta.isVolume
                        ? (tank.capacity ? `${tank.capacity.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${unitMeta.suffix}` : 'Unstrapped')
                        : 'Vol. basis only'}
                    </span>
                  </div>
                  <div>
                    <small>Ullage</small>
                    <span>
                      {tank.ullage != null
                        ? `${tank.ullage.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${unitMeta.suffix}`
                        : '—'}
                    </span>
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
