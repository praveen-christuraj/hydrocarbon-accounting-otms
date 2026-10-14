import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import Icon from '../common/Icon'
import {
  clearUiActionLog,
  getUiActionLogSnapshot,
  subscribeUiActionLog,
} from '../../utils/actionLogger'
import { formatDateTime } from '../../utils/format'
import { usePermissions } from '../../hooks/usePermissions'

const describeDetails = (details) => {
  if (details === undefined || details === null) return ''
  if (typeof details === 'string') return details
  try {
    return Object.entries(details)
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : String(value)}`)
      .join(' · ')
  } catch {
    return String(details)
  }
}

/**
 * Slide-over panel listing the client-side activity trail (owner rule 1).
 * Server-side mutations are in the Audit Log page; this panel covers the
 * UI-only events (navigation, exports, filters, theme changes…).
 */
function ActivityPanel({ open, onClose }) {
  const rawEntries = useSyncExternalStore(subscribeUiActionLog, getUiActionLogSnapshot)
  const entries = useMemo(() => [...rawEntries].reverse(), [rawEntries])
  const [query, setQuery] = useState('')
  const { hasPermission } = usePermissions()

  useEffect(() => {
    if (!open) return undefined
    const handleKey = (event) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return entries
    return entries.filter((entry) =>
      [entry.module, entry.action, entry.route, describeDetails(entry.details)]
        .join(' ')
        .toLowerCase()
        .includes(needle)
    )
  }, [entries, query])

  if (!open) return null

  return createPortal(
    <div className="activity-panel-root no-print">
      <aside
        className="activity-panel"
        role="dialog"
        aria-modal="false"
        aria-labelledby="activity-panel-title"
      >
        <header className="activity-panel-header">
          <div>
            <h2 id="activity-panel-title">Session activity</h2>
            <p>Actions taken in this browser session. Data changes are recorded in the Audit Log.</p>
          </div>
          <button
            type="button"
            className="btn-ghost activity-panel-close"
            onClick={onClose}
            aria-label="Close activity panel"
          >
            <Icon name="close" size={18} />
          </button>
        </header>

        <div className="activity-panel-tools">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter activity…"
            aria-label="Filter activity"
            autoComplete="off"
          />
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={clearUiActionLog}
            disabled={entries.length === 0}
          >
            Clear
          </button>
        </div>

        <div className="activity-panel-body">
          {filtered.length === 0 ? (
            <p className="activity-panel-empty">
              {entries.length === 0 ? 'No activity recorded yet.' : 'No activity matches the filter.'}
            </p>
          ) : (
            <ol className="activity-list">
              {filtered.map((entry) => (
                <li key={entry.id} className="activity-item">
                  <div className="activity-item-head">
                    <span className="activity-item-action">{entry.action}</span>
                    <time dateTime={entry.at}>{formatDateTime(entry.at)}</time>
                  </div>
                  <div className="activity-item-meta">
                    <span>{entry.module}</span>
                    {entry.route && <span className="activity-item-route">{entry.route}</span>}
                  </div>
                  {entry.details !== undefined && (
                    <div className="activity-item-details">{describeDetails(entry.details)}</div>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>

        <footer className="activity-panel-footer">
          <span>{entries.length} event{entries.length === 1 ? '' : 's'} this session</span>
          {hasPermission('View Audit Log') && (
            <Link to="/audit-logs" onClick={onClose}>
              Open Audit Log
            </Link>
          )}
        </footer>
      </aside>
    </div>,
    document.body
  )
}

export default ActivityPanel
