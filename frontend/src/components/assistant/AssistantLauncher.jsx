import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import Icon from '../common/Icon'
import AnswerCard from './AnswerCard'
import { askAssistant, getAssistantOverview } from '../../api/assistantApi'
import { userHasPermission } from '../../hooks/usePermissions'
import { logUiAction } from '../../utils/actionLogger'

/**
 * Global top-bar AI Guide launcher + route-aware slide-over drawer (Alt+G).
 * Strictly local, permission-scoped, zero-hallucination hydrocarbon guide.
 * Never closes on accidental backdrop clicks (uses explicit Close button).
 */
function AssistantLauncher({ loggedInUser }) {
  const location = useLocation()
  const canUseAssistant = userHasPermission(loggedInUser, 'View AI Assistant')

  const [open, setOpen] = useState(false)
  const [overview, setOverview] = useState(null)
  const [question, setQuestion] = useState('')
  const [asking, setAsking] = useState(false)
  const [error, setError] = useState('')
  const [turns, setTurns] = useState([])

  const loadOverview = useCallback(async () => {
    if (!canUseAssistant) return
    try {
      const data = await getAssistantOverview(location.pathname)
      setOverview(data)
    } catch {
      // Keep drawer usable even if overview fetch fails
    }
  }, [canUseAssistant, location.pathname])

  useEffect(() => {
    if (open) {
      loadOverview()
    }
  }, [open, loadOverview])

  // Global Alt+G shortcut (never hijacks typing inside editable fields)
  useEffect(() => {
    if (!canUseAssistant) return undefined
    const handleKeyDown = (event) => {
      if (!event.altKey || event.ctrlKey || event.metaKey) return
      if (String(event.key || '').toLowerCase() !== 'g') return
      const tag = event.target?.tagName?.toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || event.target?.isContentEditable) {
        return
      }
      event.preventDefault()
      setOpen((prev) => {
        const next = !prev
        if (next) {
          logUiAction('AI Accounting Guide', 'Open Guide Drawer (Alt+G)', {
            path: location.pathname,
          })
        }
        return next
      })
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [canUseAssistant, location.pathname])

  const submitQuestion = async (rawText) => {
    const q = String(rawText ?? question).trim()
    if (!q || asking) return
    setAsking(true)
    setError('')
    try {
      const response = await askAssistant({
        question: q,
        route: location.pathname,
      })
      setTurns((prev) => [{ question: q, response }, ...prev].slice(0, 10))
      setQuestion('')
      logUiAction('AI Accounting Guide', 'Ask Guide Question', {
        path: location.pathname,
        intent: response?.intent,
      })
    } catch (err) {
      setError(err?.message || 'Unable to query the AI Guide right now.')
    } finally {
      setAsking(false)
    }
  }

  if (!canUseAssistant) return null

  return (
    <>
      <button
        type="button"
        className="ai-launcher-btn"
        onClick={() => {
          setOpen(true)
          logUiAction('AI Accounting Guide', 'Open Guide Drawer', {
            path: location.pathname,
          })
        }}
        title="Open Hydrocarbon Accounting AI Guide (Alt+G)"
      >
        <Icon name="compass" size={15} />
        <span>AI Guide</span>
        <span className="ai-launcher-kbd">Alt+G</span>
      </button>

      {open && (
        <div
          className="ai-drawer-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Hydrocarbon Accounting AI Guide"
        >
          <div className="ai-drawer">
            <div className="ai-drawer-header">
              <div>
                <h3>Hydrocarbon Accounting AI Guide</h3>
                <div className="ai-drawer-subtitle">
                  Local semantic memory + live permission-scoped diagnostics · {location.pathname}
                </div>
              </div>
              <div className="ai-checks-badges">
                <Link
                  to="/ai-assistant"
                  className="btn btn-sm btn-secondary"
                  onClick={() => setOpen(false)}
                >
                  Full Workspace
                </Link>
                <button
                  type="button"
                  className="btn btn-sm btn-secondary"
                  onClick={() => setOpen(false)}
                  aria-label="Close AI Guide"
                >
                  <Icon name="close" size={15} />
                </button>
              </div>
            </div>

            <div className="ai-drawer-body">
              {overview && (
                <div className="ai-checks-badges">
                  <span className="ai-pill ai-pill-neutral">
                    {overview.memory_count} Curated Topics
                  </span>
                  <span className="ai-pill ai-pill-neutral">
                    {overview.manual_guides_indexed} Manuals Indexed
                  </span>
                  {overview.outstanding_checks > 0 && (
                    <span className="ai-pill ai-pill-warning">
                      {overview.outstanding_checks} Readiness Items
                    </span>
                  )}
                </div>
              )}

              {overview?.quick_prompts?.length > 0 && (
                <div>
                  <div className="ai-fact-label" style={{ marginBottom: 6 }}>
                    Suggested for this screen:
                  </div>
                  <div className="ai-quick-prompts">
                    {overview.quick_prompts.map((prompt) => (
                      <button
                        key={prompt}
                        type="button"
                        className="ai-prompt-chip"
                        disabled={asking}
                        onClick={() => submitQuestion(prompt)}
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {error && (
                <div className="alert alert-danger" role="alert">
                  {error}
                </div>
              )}

              {turns.length === 0 ? (
                <div className="ai-answer-card">
                  <p className="ai-answer-text">
                    Ask about ASTM tank calculations, Material Balance Loss/Gain root causes,
                    CUSUM creeping losses, custody-transfer variances, open ticket abnormalities,
                    or month-end close readiness. Every answer is computed locally and strictly
                    scoped to your permissions and assigned locations.
                  </p>
                </div>
              ) : (
                turns.map((turn, idx) => (
                  <AnswerCard
                    key={`drawer-turn-${idx}`}
                    question={turn.question}
                    response={turn.response}
                    onSelectFollowUp={(p) => submitQuestion(p)}
                    onNavigate={() => setOpen(false)}
                  />
                ))
              )}
            </div>

            <div className="ai-drawer-footer">
              <form
                className="ai-ask-form"
                onSubmit={(e) => {
                  e.preventDefault()
                  submitQuestion(question)
                }}
              >
                <input
                  type="text"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="Ask a formula, loss/gain question, or readiness check..."
                  aria-label="Ask Hydrocarbon Accounting AI Guide"
                />
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={asking || !question.trim()}
                >
                  {asking ? 'Asking...' : 'Ask'}
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default AssistantLauncher
