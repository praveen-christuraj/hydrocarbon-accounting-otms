import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../common/Icon'
import {
  getTransactionEntryChecks,
  keepEntryCheckAsEntered,
  previewEntryChecks,
  reopenEntryCheck,
} from '../../api/entryChecksApi'
import { mergeEntryFindings, runLocalEntryGuardrails } from '../../utils/entryGuardrails'
import { userHasPermission } from '../../hooks/usePermissions'
import { logUiAction } from '../../utils/actionLogger'

/**
 * Advisory Pre-Save & Saved-Ticket Entry Quality Checks Panel.
 *
 * Combines:
 *  - Phase 0 Instant Client-Side Guardrails (< 1 ms, zero network lag)
 *  - Phase 1–2 Server Statistical & Continuity Checks (debounced 400 ms)
 *  - Phase 3 Tier 2 Multi-Variable Anomaly ML (Isolation Forest + Half-Space
 *    Trees + Robust Mahalanobis with per-feature attribution)
 *  - Audited 'Keep as entered' & 'Reopen' workflow on saved tickets/entries.
 *
 * Strictly advisory and fail-open — never blocks saving or submission.
 */
function EntryChecksPanel({
  mode = 'preview', // 'preview' | 'saved'
  layout = 'tank_gauging',
  entityType = 'operation_transaction',
  entityId = null,
  locationCode = '',
  assetCode = '',
  linkedSenderTransactionId = null,
  payload = null,
  transactionStatus = '',
  loggedInUser = null,
  onApplySuggestion = null,
  compact = false,
}) {
  const canView = userHasPermission(loggedInUser, 'View Entry Checks')
  const canReview = userHasPermission(loggedInUser, 'Review Entry Check')
  const isLocked = String(transactionStatus || '').trim().toLowerCase() === 'approved'

  const [serverData, setServerData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState(true)
  const [keepOpenKey, setKeepOpenKey] = useState(null)
  const [keepNote, setKeepNote] = useState('')
  const [busyKey, setBusyKey] = useState(null)
  const [actionError, setActionError] = useState('')
  const reqSeqRef = useRef(0)

  // Phase 0 instant synchronous guardrails (< 1 ms)
  const localFindings = useMemo(() => {
    if (mode !== 'preview' || !payload) return []
    try {
      return runLocalEntryGuardrails({ layout, assetCode, payload })
    } catch {
      return []
    }
  }, [mode, layout, assetCode, payload])

  const payloadKey = useMemo(() => {
    if (mode !== 'preview' || !payload) return ''
    try {
      return JSON.stringify({
        layout,
        entityId,
        locationCode,
        assetCode,
        linkedSenderTransactionId,
        payload,
      })
    } catch {
      return ''
    }
  }, [mode, layout, entityId, locationCode, assetCode, linkedSenderTransactionId, payload])

  const fetchServerChecks = useCallback(async () => {
    if (!canView) return
    const seq = ++reqSeqRef.current
    setLoading(true)
    try {
      let data
      if (mode === 'saved' && entityId) {
        data = await getTransactionEntryChecks(entityId)
      } else if (mode === 'preview' && payload) {
        data = await previewEntryChecks({
          layout,
          entity_type: entityType,
          entity_id: entityId || null,
          location_code: locationCode || '',
          asset_code: assetCode || '',
          linked_sender_transaction_id: linkedSenderTransactionId || null,
          payload,
        })
      } else {
        setServerData(null)
        setLoading(false)
        return
      }
      if (seq === reqSeqRef.current) {
        setServerData(data)
      }
    } catch {
      // Fail-open: never block data entry when preview service is unavailable
      if (seq === reqSeqRef.current) {
        setServerData(null)
      }
    } finally {
      if (seq === reqSeqRef.current) {
        setLoading(false)
      }
    }
  }, [
    canView,
    mode,
    entityId,
    payload,
    layout,
    entityType,
    locationCode,
    assetCode,
    linkedSenderTransactionId,
  ])

  useEffect(() => {
    if (!canView) return undefined
    if (mode === 'saved') {
      if (entityId) fetchServerChecks()
      return undefined
    }
    if (!payloadKey) {
      setServerData(null)
      return undefined
    }
    const timer = setTimeout(() => {
      fetchServerChecks()
    }, 420)
    return () => clearTimeout(timer)
  }, [canView, mode, entityId, payloadKey, fetchServerChecks])

  const mergedChecks = useMemo(
    () => mergeEntryFindings(localFindings, serverData?.checks || []),
    [localFindings, serverData]
  )

  const counts = useMemo(() => {
    let warnings = 0
    let notices = 0
    let reviewed = 0
    for (const c of mergedChecks) {
      if (c.reviewed) reviewed += 1
      else if (c.severity === 'warning') warnings += 1
      else notices += 1
    }
    return { warnings, notices, reviewed }
  }, [mergedChecks])

  if (!canView && localFindings.length === 0) {
    return null
  }

  const handleApply = (finding) => {
    if (typeof onApplySuggestion !== 'function') return
    onApplySuggestion(finding)
    logUiAction('Entry Quality Checks', 'Apply Entry Suggestion', {
      code: finding.code,
      field: finding.field,
      suggested: finding.suggested_value,
      suggestedUnit: finding.suggested_unit,
    })
  }

  const handleKeepSubmit = async (finding) => {
    if (!entityId) return
    setBusyKey(finding.key)
    setActionError('')
    try {
      await keepEntryCheckAsEntered({
        entity_type: serverData?.entity_type || entityType,
        entity_id: entityId,
        check_key: finding.key,
        check_code: finding.code,
        fingerprint: finding.fingerprint,
        subject_label: finding.subject_label || assetCode || '',
        value_label: finding.current_display || finding.current_value || '',
        note: keepNote,
        location_code: locationCode || serverData?.location_code || null,
        asset_code: assetCode || serverData?.primary_asset_code || null,
      })
      logUiAction('Entry Quality Checks', 'Keep Entry Check As Entered', {
        entityId,
        code: finding.code,
        checkKey: finding.key,
      })
      setKeepOpenKey(null)
      setKeepNote('')
      await fetchServerChecks()
    } catch (err) {
      setActionError(err?.message || 'Could not save review decision.')
    } finally {
      setBusyKey(null)
    }
  }

  const handleReopen = async (finding) => {
    if (!entityId) return
    setBusyKey(finding.key)
    setActionError('')
    try {
      await reopenEntryCheck({
        entity_type: serverData?.entity_type || entityType,
        entity_id: entityId,
        check_key: finding.key,
      })
      logUiAction('Entry Quality Checks', 'Reopen Entry Check', {
        entityId,
        code: finding.code,
        checkKey: finding.key,
      })
      await fetchServerChecks()
    } catch (err) {
      setActionError(err?.message || 'Could not reopen check.')
    } finally {
      setBusyKey(null)
    }
  }

  const mlAvailable = Boolean(serverData?.ml?.available)
  const historyCount = serverData?.history_count ?? 0

  return (
    <section
      className={`ai-checks-panel ${counts.warnings > 0 ? 'has-warnings' : ''}`}
      aria-label="Entry quality and anomaly checks"
    >
      <div className="ai-checks-header">
        <div className="ai-checks-title-group">
          <Icon
            name={counts.warnings > 0 ? 'alertTriangle' : 'shieldCheck'}
            size={16}
          />
          <h4 className="ai-checks-title">
            Entry Quality &amp; Anomaly Checks
          </h4>
          {loading && <span className="ai-pill ai-pill-neutral">Checking...</span>}
        </div>

        <div className="ai-checks-badges">
          {counts.warnings > 0 && (
            <span className="ai-pill ai-pill-warning">
              {counts.warnings} Warning{counts.warnings === 1 ? '' : 's'}
            </span>
          )}
          {counts.notices > 0 && (
            <span className="ai-pill ai-pill-info">
              {counts.notices} Notice{counts.notices === 1 ? '' : 's'}
            </span>
          )}
          {counts.reviewed > 0 && (
            <span className="ai-pill ai-pill-success">
              {counts.reviewed} Kept as Entered
            </span>
          )}
          {counts.warnings === 0 && counts.notices === 0 && !loading && (
            <span className="ai-pill ai-pill-success">All Clear</span>
          )}
          {mlAvailable && (
            <span
              className="ai-pill ai-pill-ml"
              title="Tier 2 Multi-Variable Anomaly ML (Isolation Forest + Half-Space Trees + Robust Mahalanobis)"
            >
              Tier 2 ML Active ({historyCount} hist)
            </span>
          )}
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            onClick={() => setExpanded((prev) => !prev)}
          >
            {expanded ? 'Hide' : 'Show'}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="ai-checks-body">
          {actionError && (
            <div className="alert alert-danger" role="alert">
              {actionError}
            </div>
          )}

          {mergedChecks.length === 0 ? (
            <div className="ai-checks-empty">
              <Icon name="checkCircle" size={15} />
              <span>
                {loading
                  ? 'Evaluating physics, continuity, historical norms, and Tier 2 multi-variable ML...'
                  : 'No keying slips, continuity gaps, or multi-variable anomalies detected. Checks are advisory and never block saving.'}
              </span>
            </div>
          ) : (
            mergedChecks.map((finding) => {
              const severityCls = finding.reviewed
                ? 'is-reviewed'
                : finding.severity === 'warning'
                  ? 'severity-warning'
                  : 'severity-info'
              const canApplyHere =
                mode === 'preview' &&
                !finding.reviewed &&
                typeof onApplySuggestion === 'function' &&
                finding.suggested_value !== null &&
                finding.suggested_value !== undefined
              const canKeepHere =
                Boolean(entityId) &&
                !finding.localOnly &&
                !finding.reviewed &&
                canReview &&
                !isLocked

              return (
                <div key={finding.key} className={`ai-finding-card ${severityCls}`}>
                  <div className="ai-finding-head">
                    <div className="ai-finding-title">
                      <Icon
                        name={
                          finding.reviewed
                            ? 'checkCircle'
                            : finding.severity === 'warning'
                              ? 'alertTriangle'
                              : 'info'
                        }
                        size={15}
                      />
                      <span>{finding.title}</span>
                    </div>
                    <div className="ai-checks-badges">
                      {finding.category === 'ml_multivariate' && (
                        <span className="ai-pill ai-pill-ml">
                          ML Score {finding.ml_score !== null ? Number(finding.ml_score).toFixed(2) : ''}
                        </span>
                      )}
                      {finding.category === 'security' && (
                        <span className="ai-pill ai-pill-danger">Custody Security</span>
                      )}
                      {finding.subject_label && (
                        <span className="ai-pill ai-pill-neutral">{finding.subject_label}</span>
                      )}
                    </div>
                  </div>

                  <p className="ai-finding-message">{finding.message}</p>

                  {!compact && finding.basis && (
                    <div className="ai-finding-basis">{finding.basis}</div>
                  )}

                  {Array.isArray(finding.ml_drivers) && finding.ml_drivers.length > 0 && (
                    <div className="ai-ml-drivers">
                      {finding.ml_drivers.map((drv, idx) => (
                        <span key={`${finding.key}-drv-${idx}`} className="ai-ml-driver-chip">
                          {drv.feature}: {drv.value} (typical {drv.median}, z={drv.robust_z})
                        </span>
                      ))}
                    </div>
                  )}

                  {finding.reviewed ? (
                    <div className="ai-reviewed-meta">
                      <span>
                        Kept as entered by <strong>{finding.reviewed_by || 'Operator'}</strong>
                        {finding.review_note ? ` — "${finding.review_note}"` : ''}
                      </span>
                      {canReview && !isLocked && entityId && (
                        <button
                          type="button"
                          className="btn btn-sm btn-secondary"
                          disabled={busyKey === finding.key}
                          onClick={() => handleReopen(finding)}
                        >
                          Reopen
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="ai-finding-actions">
                      {canApplyHere && (
                        <button
                          type="button"
                          className="btn btn-sm btn-primary"
                          onClick={() => handleApply(finding)}
                        >
                          Apply {finding.suggested_display || finding.suggested_value}
                        </button>
                      )}
                      {canKeepHere && keepOpenKey !== finding.key && (
                        <button
                          type="button"
                          className="btn btn-sm btn-secondary"
                          onClick={() => {
                            setKeepOpenKey(finding.key)
                            setKeepNote('')
                          }}
                        >
                          Keep as entered
                        </button>
                      )}
                    </div>
                  )}

                  {keepOpenKey === finding.key && (
                    <div className="ai-keep-form">
                      <input
                        type="text"
                        value={keepNote}
                        maxLength={300}
                        placeholder="Optional explanation for supervisors (e.g., heated crude batch or verified dip)..."
                        onChange={(e) => setKeepNote(e.target.value)}
                      />
                      <button
                        type="button"
                        className="btn btn-sm btn-primary"
                        disabled={busyKey === finding.key}
                        onClick={() => handleKeepSubmit(finding)}
                      >
                        {busyKey === finding.key ? 'Saving...' : 'Confirm Keep'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-secondary"
                        onClick={() => setKeepOpenKey(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      )}
    </section>
  )
}

export default EntryChecksPanel
