import { useEffect, useMemo, useState } from 'react'
import Modal from '../common/Modal'
import AlertMessage from '../common/AlertMessage'
import Icon from '../common/Icon'
import { discoverJsonPaths } from '../../api/reportBuilderApi'

/**
 * "Split JSON into columns": samples real saved payloads / JSON values and
 * lets the user tick each inner value that should become its own report
 * column.  Repeated sections (per-tank dips, arrays) are offered as
 * "one row per item" columns.
 *
 * Props: open, title, request (JsonPathsRequest body), existingPaths (Set of
 * "ref::path"), onClose, onAdd(paths:[{path,label,data_type,is_wildcard}])
 */
function JsonColumnPicker({ open, title, request, existingPaths, onClose, onAdd }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [selected, setSelected] = useState(new Set())
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (!open || !request) return
    let cancelled = false
    setLoading(true)
    setError('')
    setSelected(new Set())
    setSearch('')
  // eslint-disable-next-line react-hooks/set-state-in-effect
    discoverJsonPaths(request)
      .then((data) => { if (!cancelled) setResult(data) })
      .catch((err) => { if (!cancelled) setError(err.message || 'Could not read the saved data.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [open, request])

  const allPaths = useMemo(() => {
    if (!result) return []
    const normal = (result.paths || []).map((p) => ({ ...p, is_wildcard: false }))
    const wild = (result.wildcard_paths || []).map((p) => ({ ...p, is_wildcard: true }))
    return [...normal, ...wild]
  }, [result])

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return allPaths
    return allPaths.filter((p) => p.path.toLowerCase().includes(needle) || p.label.toLowerCase().includes(needle))
  }, [allPaths, search])

  const grouped = useMemo(() => {
    const groups = new Map()
    filtered.forEach((entry) => {
      const group = entry.is_wildcard
        ? 'Repeated section — one row per item (per tank / per line)'
        : entry.path.includes('.')
          ? entry.path.split('.')[0].replace('[]', '')
          : 'Top level'
      if (!groups.has(group)) groups.set(group, [])
      groups.get(group).push(entry)
    })
    return [...groups.entries()]
  }, [filtered])

  const toggle = (path) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const handleAdd = () => {
    const chosen = allPaths.filter((p) => selected.has(p.path))
    onAdd(chosen)
    onClose()
  }

  return (
    <Modal
      open={open}
      title={title || 'Split saved JSON into columns'}
      description="These are the values actually saved inside the data. Tick each one that should become its own report column."
      onClose={onClose}
      size="lg"
      footer={(
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary" onClick={handleAdd} disabled={selected.size === 0}>
            <Icon name="plus" size={15} /> Add {selected.size || ''} column{selected.size === 1 ? '' : 's'}
          </button>
        </>
      )}
    >
      {loading && <AlertMessage tone="info" message="Reading saved examples to find every value…" />}
      <AlertMessage tone="error" message={error} />
      {!loading && result && (
        <>
          <AlertMessage
            tone={result.rows_with_json ? 'success' : 'warning'}
            message={
              result.rows_with_json
                ? `Found ${allPaths.length} value(s) across ${result.rows_with_json} saved example(s). “Seen in” shows how many examples contain the value.`
                : 'No saved examples were found in your locations yet, so there is nothing to split. Create one ticket/record first, or pick another payload.'
            }
          />
          <div className="rb-field rb-json-search">
            <label htmlFor="rb-json-search">Find a value</label>
            <input id="rb-json-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="e.g. nsv, gauging, dip…" />
          </div>
          <div className="rb-json-groups">
            {grouped.map(([group, entries]) => (
              <div key={group} className="rb-json-group">
                <h4>{group.startsWith('Repeated') ? group : `Section: ${group}`}</h4>
                {entries.map((entry) => {
                  const already = existingPaths?.has(entry.path)
                  return (
                    <label key={entry.path} className={`rb-json-row ${already ? 'is-added' : ''}`}>
                      <input type="checkbox" checked={selected.has(entry.path)} disabled={already} onChange={() => toggle(entry.path)} />
                      <span className="rb-json-main">
                        <strong>{entry.short_label}</strong>
                        <span className="rb-json-path">{entry.label}</span>
                        <span className="rb-json-tech">{entry.path}</span>
                      </span>
                      <span className="rb-json-meta">
                        <span className="rb-badge">{entry.data_type}</span>
                        <span className="rb-muted">Seen in {entry.present_in}</span>
                        {entry.examples?.length ? <span className="rb-muted">e.g. {entry.examples.slice(0, 2).join(', ')}</span> : null}
                        {already ? <span className="rb-badge">Already a column</span> : null}
                      </span>
                    </label>
                  )
                })}
              </div>
            ))}
            {grouped.length === 0 && <p className="rb-muted">No values match that search.</p>}
          </div>
        </>
      )}
    </Modal>
  )
}

export default JsonColumnPicker
