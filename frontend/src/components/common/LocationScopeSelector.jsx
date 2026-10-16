import { useEffect, useId, useMemo, useRef, useState } from 'react'
import Icon from './Icon'

/*
 * Location scope selector (User Location Assignment / Role Location Assignment).
 *
 * A dense, uniformly aligned checkbox list inside a bordered panel:
 *
 *   ┌ toolbar: search · select all · clear all · "n of m selected" ┐
 *   │ grid of rows: [checkbox] Location name            LOC-CODE   │
 *   └ footer: showing x of y locations                             ┘
 *
 * Why a component: both assignment pages render the exact same control, so the
 * order, alignment and behaviour cannot drift apart again.
 *
 * Notes for future edits
 *  - The panel lives inside a page <form>, and the global rule
 *    `form div { display:flex; flex-direction:column }` applies to every div in
 *    it. Every flex/grid container here therefore sets `flex-direction: row`
 *    explicitly (see .location-scope-* in styles/components.css) – that rule is
 *    what used to turn the old filter row into a 220px-tall centred stack.
 *  - Locations are sorted by name, then code, so the list order is stable and
 *    rows line up in a predictable reading order.
 */

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

const codeOf = (location) => String(location?.locationCode ?? '').trim()
const nameOf = (location) => String(location?.locationName ?? '').trim()

const compareLocations = (a, b) => {
  const byName = collator.compare(nameOf(a), nameOf(b))
  if (byName !== 0) return byName
  return collator.compare(codeOf(a), codeOf(b))
}

function LocationScopeSelector({
  locations = [],
  selectedCodes = [],
  onToggle,
  onSelectCodes,
  onClear,
  disabled = false,
  searchPlaceholder = 'Filter locations by name or code…',
  emptyMessage = 'No active location is available. Create one in Location Master first.',
  footnote,
}) {
  const [search, setSearch] = useState('')
  const searchId = useId()
  const selectAllRef = useRef(null)

  const ordered = useMemo(
    () => [...locations].sort(compareLocations),
    [locations]
  )

  const selectedSet = useMemo(
    () => new Set(selectedCodes.map((code) => String(code))),
    [selectedCodes]
  )

  const query = search.trim().toLowerCase()
  const visible = useMemo(() => {
    if (!query) return ordered
    return ordered.filter(
      (location) =>
        nameOf(location).toLowerCase().includes(query) ||
        codeOf(location).toLowerCase().includes(query)
    )
  }, [ordered, query])

  const visibleCodes = visible.map(codeOf)
  const selectedVisibleCount = visibleCodes.filter((code) => selectedSet.has(code)).length
  const allVisibleSelected = visibleCodes.length > 0 && selectedVisibleCount === visibleCodes.length
  const someVisibleSelected = selectedVisibleCount > 0 && !allVisibleSelected

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someVisibleSelected
    }
  }, [someVisibleSelected, allVisibleSelected, visibleCodes.length])

  const handleSelectVisible = (checked) => {
    onSelectCodes?.(visibleCodes, checked)
  }

  if (ordered.length === 0) {
    return (
      <div className="location-scope">
        <p className="location-scope-empty">{emptyMessage}</p>
      </div>
    )
  }

  return (
    <div className="location-scope">
      <div className="location-scope-toolbar">
        <label htmlFor={searchId} className="visually-hidden">
          Filter locations
        </label>
        <div className="location-scope-search">
          <span className="location-scope-search-icon" aria-hidden="true">
            <Icon name="search" size={15} />
          </span>
          <input
            id={searchId}
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={searchPlaceholder}
            autoComplete="off"
            spellCheck={false}
            disabled={disabled}
          />
          {search && (
            <button
              type="button"
              className="location-scope-search-clear"
              onClick={() => setSearch('')}
              aria-label="Clear location filter"
            >
              <Icon name="close" size={14} />
            </button>
          )}
        </div>

        <label className="location-scope-selectall">
          <input
            ref={selectAllRef}
            type="checkbox"
            checked={allVisibleSelected}
            disabled={disabled || visibleCodes.length === 0}
            onChange={(event) => handleSelectVisible(event.target.checked)}
          />
          <span>{query ? 'Select all shown' : 'Select all'}</span>
        </label>

        <button
          type="button"
          className="btn-ghost btn-sm location-scope-clear"
          onClick={() => onClear?.()}
          disabled={disabled || selectedCodes.length === 0}
        >
          Clear all
        </button>

        <span className="location-scope-count" aria-live="polite">
          {selectedCodes.length} of {ordered.length} selected
        </span>
      </div>

      <div className="location-scope-body" role="group" aria-label="Locations available for assignment">
        {visible.length === 0 ? (
          <p className="location-scope-empty">No location matches “{search.trim()}”.</p>
        ) : (
          visible.map((location) => {
            const code = codeOf(location)
            const checked = selectedSet.has(code)
            const label = `${nameOf(location)} (${code})`
            return (
              <label
                key={code || label}
                className={`location-option ${checked ? 'is-selected' : ''}`.trim()}
                title={label}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled}
                  onChange={() => onToggle?.(code)}
                  aria-label={label}
                />
                <span className="location-option-name">{nameOf(location) || code}</span>
                <span className="location-option-code">{code}</span>
              </label>
            )
          })
        )}
      </div>

      <div className="location-scope-footer">
        <span>
          Showing {visible.length} of {ordered.length} location{ordered.length === 1 ? '' : 's'}
        </span>
        {footnote && <span className="location-scope-footnote">{footnote}</span>}
      </div>
    </div>
  )
}

export default LocationScopeSelector
