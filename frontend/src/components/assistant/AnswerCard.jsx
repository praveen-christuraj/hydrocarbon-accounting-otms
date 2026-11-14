import { Link } from 'react-router-dom'
import Icon from '../common/Icon'

const MODE_LABELS = {
  live_service: 'Live Verified Data',
  rbac_guard: 'Permission Check',
  semantic_lsa: 'Local Semantic Guide',
  semantic_model2vec: 'Local Semantic Guide',
  semantic_fastembed: 'Local Semantic Guide',
  prompt: 'Guide',
  fallback: 'Safe Fallback',
}

/**
 * Structured response card for the Local AI Accounting Guide.
 * Renders answer text, verified live fact tiles, ordered workflow steps,
 * clickable navigation sources, and follow-up question chips.
 */
function AnswerCard({
  question,
  response,
  onSelectFollowUp,
  onNavigate,
}) {
  if (!response) return null
  const modeLabel = MODE_LABELS[response.retrieval_mode] || 'Local AI Guide'
  const confidenceClass =
    response.confidence === 'high'
      ? 'ai-pill-success'
      : response.confidence === 'medium'
        ? 'ai-pill-info'
        : 'ai-pill-warning'

  return (
    <article className="ai-answer-card">
      {question && (
        <div className="ai-answer-question">
          <span>{question}</span>
          <div className="ai-checks-badges">
            <span className="ai-pill ai-pill-neutral">{modeLabel}</span>
            <span className={`ai-pill ${confidenceClass}`}>
              {response.confidence || 'medium'}
            </span>
          </div>
        </div>
      )}

      <p className="ai-answer-text">{response.answer}</p>

      {Array.isArray(response.facts) && response.facts.length > 0 && (
        <div className="ai-facts-grid">
          {response.facts.map((fact, idx) =>
            fact.route ? (
              <Link
                key={`${fact.label}-${idx}`}
                to={fact.route}
                className="ai-fact-tile"
                onClick={onNavigate}
              >
                <span className="ai-fact-label">{fact.label}</span>
                <span className="ai-fact-value">{fact.value}</span>
                {fact.hint && <span className="ai-fact-hint">{fact.hint}</span>}
              </Link>
            ) : (
              <div key={`${fact.label}-${idx}`} className="ai-fact-tile">
                <span className="ai-fact-label">{fact.label}</span>
                <span className="ai-fact-value">{fact.value}</span>
                {fact.hint && <span className="ai-fact-hint">{fact.hint}</span>}
              </div>
            )
          )}
        </div>
      )}

      {Array.isArray(response.steps) && response.steps.length > 0 && (
        <ol className="ai-steps-list">
          {response.steps.map((step, idx) => (
            <li key={`step-${idx}`}>{step}</li>
          ))}
        </ol>
      )}

      {Array.isArray(response.sources) && response.sources.length > 0 && (
        <div className="ai-sources-row">
          <span className="ai-fact-label">Open screen:</span>
          {response.sources.map((src, idx) => (
            <Link
              key={`${src.route}-${idx}`}
              to={src.route}
              className="ai-source-link"
              onClick={onNavigate}
            >
              <Icon name="externalLink" size={12} />
              <span>{src.label}</span>
            </Link>
          ))}
        </div>
      )}

      {Array.isArray(response.follow_ups) &&
        response.follow_ups.length > 0 &&
        typeof onSelectFollowUp === 'function' && (
          <div className="ai-quick-prompts">
            {response.follow_ups.map((prompt) => (
              <button
                key={prompt}
                type="button"
                className="ai-prompt-chip"
                onClick={() => onSelectFollowUp(prompt)}
              >
                {prompt}
              </button>
            ))}
          </div>
        )}
    </article>
  )
}

export default AnswerCard
