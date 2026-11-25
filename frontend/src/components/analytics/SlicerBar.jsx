import { useEffect, useRef, useState } from 'react'
import Icon from '../common/Icon'
import { computeDatePreset } from '../../utils/analyticsEngine'

function MultiSelectPopover({
  label,
  options = [],
  selected = [],
  onChange,
  placeholder = 'All',
  icon = 'filter',
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const wrapRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const handleOutside = (evt) => {
      if (wrapRef.current && !wrapRef.current.contains(evt.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [open])

  const normalizedOptions = options.map((opt) => (
    typeof opt === 'object' && opt !== null
      ? { value: String(opt.value), label: String(opt.label ?? opt.value) }
      : { value: String(opt), label: String(opt) }
  ))

  const filtered = normalizedOptions.filter((opt) => (
    !search.trim() || opt.label.toLowerCase().includes(search.trim().toLowerCase())
  ))

  const selectedSet = new Set((Array.isArray(selected) ? selected : []).map(String))
  const summaryText = selectedSet.size === 0
    ? placeholder
    : (selectedSet.size === 1
      ? (normalizedOptions.find((o) => selectedSet.has(o.value))?.label || [...selectedSet][0])
      : `${selectedSet.size} selected`)

  const toggleVal = (val) => {
    const next = new Set(selectedSet)
    if (next.has(val)) next.delete(val)
    else next.add(val)
    onChange([...next])
  }

  return (
    <div ref={wrapRef} className="analytics-slicer-popover-field">
      <span className="analytics-slicer-field-label">{label}</span>
      <button
        type="button"
        className={`analytics-slicer-trigger ${selectedSet.size > 0 ? 'has-selection' : ''}`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name={icon} size={14} />
        <span className="analytics-slicer-trigger-text">{summaryText}</span>
        <Icon name="chevronDown" size={14} />
      </button>

      {open && (
        <div className="analytics-slicer-dropdown" role="dialog" aria-label={label}>
          <div className="analytics-slicer-dropdown-head">
            <div className="analytics-slicer-search">
              <Icon name="search" size={13} />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={`Search ${label.toLowerCase()}…`}
                aria-label={`Search ${label}`}
              />
            </div>
            <div className="analytics-slicer-dropdown-actions">
              <button
                type="button"
                className="btn-link"
                onClick={() => onChange(filtered.map((o) => o.value))}
              >
                All
              </button>
              <button
                type="button"
                className="btn-link"
                onClick={() => onChange([])}
              >
                Clear
              </button>
            </div>
          </div>
          <div className="analytics-slicer-options-list">
            {filtered.map((opt) => (
              <label key={opt.value} className="analytics-slicer-option-row">
                <input
                  type="checkbox"
                  checked={selectedSet.has(opt.value)}
                  onChange={() => toggleVal(opt.value)}
                />
                <span>{opt.label}</span>
              </label>
            ))}
            {!filtered.length && (
              <div className="analytics-slicer-empty">No matching values</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

const DATE_PRESETS = [
  { key: '7D', label: '7D' },
  { key: '30D', label: '30D' },
  { key: 'MTD', label: 'MTD' },
  { key: 'QTD', label: 'QTD' },
  { key: 'YTD', label: 'YTD' },
  { key: 'PREV_MONTH', label: 'Prev Mth' },
]

function SlicerBar({
  dateFrom = '',
  dateTo = '',
  singleDate = '',
  activePreset = '',
  onDateRangeChange,
  onSingleDateChange,
  onApplyPreset,
  availableLocations = [],
  selectedLocations = [],
  onLocationsChange,
  slicers = [],
  slicerOptions = {},
  runtimeValues = {},
  onRuntimeValueChange,
  selectionFilters = [],
  onRemoveSelectionFilter,
  onClearAllFilters,
  onApply,
  running = false,
  lastExecutedAt = null,
}) {
  const hasAnyFilter = Boolean(
    dateFrom
    || dateTo
    || singleDate
    || selectedLocations.length > 0
    || selectionFilters.length > 0
    || Object.values(runtimeValues || {}).some((v) => (Array.isArray(v) ? v.length > 0 : Boolean(v)))
  )

  return (
    <section className="analytics-slicer-bar" aria-label="Dashboard global filters and slicers">
      <div className="analytics-slicer-controls-grid">
        {/* 1. Separate Date Range control + Presets */}
        <div className="analytics-slicer-date-group">
          <span className="analytics-slicer-field-label">Date Range (From – To)</span>
          <div className="analytics-date-range-inputs">
            <input
              type="date"
              aria-label="Date range from"
              value={dateFrom}
              onChange={(e) => onDateRangeChange(e.target.value, dateTo)}
            />
            <span className="analytics-date-sep">–</span>
            <input
              type="date"
              aria-label="Date range to"
              value={dateTo}
              onChange={(e) => onDateRangeChange(dateFrom, e.target.value)}
            />
            <div className="analytics-preset-pills" role="group" aria-label="Relative date presets">
              {DATE_PRESETS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  className={`analytics-preset-pill ${activePreset === p.key ? 'is-active' : ''}`}
                  onClick={() => {
                    const range = computeDatePreset(p.key)
                    if (onApplyPreset) onApplyPreset(p.key, range)
                    else onDateRangeChange(range.from, range.to)
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 2. Separate Single Accounting Date control */}
        <div className="analytics-slicer-single-date">
          <span className="analytics-slicer-field-label">Single Date</span>
          <input
            type="date"
            aria-label="Exact single accounting date"
            value={singleDate}
            onChange={(e) => onSingleDateChange(e.target.value)}
          />
        </div>

        {/* 3. Scoped Location multi-select */}
        {availableLocations.length > 0 && (
          <MultiSelectPopover
            label="Locations"
            icon="mapPin"
            placeholder="All Accessible"
            options={availableLocations.map((loc) => (
              typeof loc === 'object'
                ? { value: loc.location_code, label: `${loc.location_code}${loc.location_name ? ` — ${loc.location_name}` : ''}` }
                : { value: loc, label: loc }
            ))}
            selected={selectedLocations}
            onChange={onLocationsChange}
          />
        )}

        {/* 4. Custom Dashboard Slicers */}
        {slicers.map((slicer) => {
          const sKey = slicer.key || slicer.id
          const sType = String(slicer.type || 'SELECT').toUpperCase()
          const val = runtimeValues?.[sKey]
          if (sType === 'SELECT') {
            return (
              <MultiSelectPopover
                key={slicer.id || sKey}
                label={slicer.label || sKey}
                icon="filter"
                placeholder="All"
                options={slicerOptions[slicer.id] || []}
                selected={Array.isArray(val) ? val : (val ? [val] : [])}
                onChange={(nextList) => onRuntimeValueChange(sKey, nextList)}
              />
            )
          }
          if (sType === 'SINGLE_DATE') {
            return (
              <div key={slicer.id || sKey} className="analytics-slicer-single-date">
                <span className="analytics-slicer-field-label">{slicer.label || sKey}</span>
                <input
                  type="date"
                  value={typeof val === 'string' ? val : ''}
                  onChange={(e) => onRuntimeValueChange(sKey, e.target.value)}
                />
              </div>
            )
          }
          if (sType === 'DATE_RANGE') {
            const obj = typeof val === 'object' && val !== null ? val : { from: '', to: '' }
            return (
              <div key={slicer.id || sKey} className="analytics-slicer-date-group">
                <span className="analytics-slicer-field-label">{slicer.label || sKey}</span>
                <div className="analytics-date-range-inputs">
                  <input
                    type="date"
                    value={obj.from || ''}
                    onChange={(e) => onRuntimeValueChange(sKey, { ...obj, from: e.target.value })}
                  />
                  <span className="analytics-date-sep">–</span>
                  <input
                    type="date"
                    value={obj.to || ''}
                    onChange={(e) => onRuntimeValueChange(sKey, { ...obj, to: e.target.value })}
                  />
                </div>
              </div>
            )
          }
          return (
            <div key={slicer.id || sKey} className="analytics-slicer-single-date">
              <span className="analytics-slicer-field-label">{slicer.label || sKey}</span>
              <input
                type={sType === 'NUMBER' ? 'number' : 'text'}
                placeholder={`Filter ${(slicer.label || sKey).toLowerCase()}…`}
                value={val ?? ''}
                onChange={(e) => onRuntimeValueChange(sKey, e.target.value)}
              />
            </div>
          )
        })}

        {/* 5. Apply & Reset action buttons */}
        <div className="analytics-slicer-apply-box">
          <button
            type="button"
            className="btn-primary"
            onClick={onApply}
            disabled={running}
          >
            <Icon name="refresh" size={14} />
            <span>{running ? 'Running…' : 'Apply & Refresh'}</span>
          </button>
          {hasAnyFilter && (
            <button
              type="button"
              className="btn-secondary"
              onClick={onClearAllFilters}
              disabled={running}
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {/* Active cross-filter chip strip + execution timestamp */}
      {(selectionFilters.length > 0 || lastExecutedAt) && (
        <div className="analytics-slicer-status-strip">
          <div className="analytics-crossfilter-chips">
            {selectionFilters.length > 0 && (
              <span className="analytics-crossfilter-title">
                <Icon name="filter" size={13} /> Cross-Filters:
              </span>
            )}
            {selectionFilters.map((sf, idx) => (
              <span key={`${sf.column_key}-${sf.value}-${idx}`} className="analytics-crossfilter-chip">
                <span>{sf.label || `${sf.column_key}: ${sf.value}`}</span>
                <button
                  type="button"
                  aria-label={`Remove cross-filter ${sf.label || sf.value}`}
                  onClick={() => onRemoveSelectionFilter && onRemoveSelectionFilter(sf)}
                >
                  <Icon name="close" size={12} />
                </button>
              </span>
            ))}
          </div>
          {lastExecutedAt && (
            <span className="analytics-last-updated">
              Updated {lastExecutedAt}
            </span>
          )}
        </div>
      )}
    </section>
  )
}

export default SlicerBar
