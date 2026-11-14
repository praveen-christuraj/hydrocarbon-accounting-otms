import { useCallback, useEffect, useMemo, useState } from 'react'
import Icon from '../components/common/Icon'
import Modal from '../components/common/Modal'
import AlertMessage from '../components/common/AlertMessage'
import AnswerCard from '../components/assistant/AnswerCard'
import { useConfirm } from '../components/common/ConfirmProvider'
import {
  askAssistant,
  createAssistantMemory,
  deleteAssistantMemory,
  getAssistantHistory,
  getAssistantOverview,
  listAssistantMemory,
  updateAssistantMemory,
} from '../api/assistantApi'
import { userHasPermission } from '../hooks/usePermissions'
import { logUiAction } from '../utils/actionLogger'

const MEMORY_CATEGORIES = [
  'workflow',
  'calculation',
  'data-entry',
  'accounting-analysis',
  'navigation',
  'policy',
  'faq',
]

const EMPTY_FORM = {
  memory_key: '',
  title: '',
  category: 'policy',
  keywords: '',
  body: '',
  stepsText: '',
  route: '',
  location_code: '',
  permission: '',
  is_active: true,
  sort_order: 120,
}

function AIAssistantPage({ locations = [], loggedInUser }) {
  const confirm = useConfirm()
  const canViewMemory =
    userHasPermission(loggedInUser, 'View Assistant Memory') ||
    userHasPermission(loggedInUser, 'View AI Assistant')
  const canCreateMemory = userHasPermission(loggedInUser, 'Create Assistant Memory')
  const canEditMemory = userHasPermission(loggedInUser, 'Edit Assistant Memory')
  const canDeleteMemory = userHasPermission(loggedInUser, 'Delete Assistant Memory')

  const [activeTab, setActiveTab] = useState('guide')
  const [overview, setOverview] = useState(null)
  const [history, setHistory] = useState([])
  const [selectedLocation, setSelectedLocation] = useState('')
  const [question, setQuestion] = useState('')
  const [asking, setAsking] = useState(false)
  const [turns, setTurns] = useState([])
  const [feedback, setFeedback] = useState({ type: '', text: '' })

  // Curated Memory state
  const [memories, setMemories] = useState([])
  const [memorySearch, setMemorySearch] = useState('')
  const [memoryCategoryFilter, setMemoryCategoryFilter] = useState('all')
  const [loadingMemory, setLoadingMemory] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingEntry, setEditingEntry] = useState(null)
  const [formState, setFormState] = useState(EMPTY_FORM)
  const [savingMemory, setSavingMemory] = useState(false)

  const loadWorkspace = useCallback(async () => {
    try {
      const [ov, hist] = await Promise.all([
        getAssistantOverview('/ai-assistant'),
        getAssistantHistory(25),
      ])
      setOverview(ov)
      setHistory(Array.isArray(hist?.items) ? hist.items : [])
    } catch (err) {
      setFeedback({ type: 'error', text: err?.message || 'Failed to load AI Guide workspace.' })
    }
  }, [])

  const loadMemoryEntries = useCallback(async () => {
    if (!canViewMemory) return
    setLoadingMemory(true)
    try {
      const res = await listAssistantMemory(true)
      setMemories(Array.isArray(res?.items) ? res.items : [])
    } catch (err) {
      setFeedback({ type: 'error', text: err?.message || 'Failed to load assistant memory.' })
    } finally {
      setLoadingMemory(false)
    }
  }, [canViewMemory])

  useEffect(() => {
    loadWorkspace()
  }, [loadWorkspace])

  useEffect(() => {
    if (activeTab === 'memory') {
      loadMemoryEntries()
    }
  }, [activeTab, loadMemoryEntries])

  const handleAsk = async (rawQuestion) => {
    const q = String(rawQuestion ?? question).trim()
    if (!q || asking) return
    setAsking(true)
    setFeedback({ type: '', text: '' })
    try {
      const response = await askAssistant({
        question: q,
        route: '/ai-assistant',
        locationCode: selectedLocation,
      })
      setTurns((prev) => [{ question: q, response }, ...prev].slice(0, 20))
      setQuestion('')
      logUiAction('AI Accounting Guide', 'Ask Question', {
        locationCode: selectedLocation || 'ALL',
        intent: response?.intent,
      })
      const hist = await getAssistantHistory(25)
      setHistory(Array.isArray(hist?.items) ? hist.items : [])
    } catch (err) {
      setFeedback({ type: 'error', text: err?.message || 'Could not process question.' })
    } finally {
      setAsking(false)
    }
  }

  const filteredMemories = useMemo(() => {
    const q = memorySearch.trim().toLowerCase()
    return memories.filter((item) => {
      if (memoryCategoryFilter !== 'all' && item.category !== memoryCategoryFilter) return false
      if (!q) return true
      return (
        String(item.title || '').toLowerCase().includes(q) ||
        String(item.memory_key || '').toLowerCase().includes(q) ||
        String(item.keywords || '').toLowerCase().includes(q) ||
        String(item.body || '').toLowerCase().includes(q)
      )
    })
  }, [memories, memorySearch, memoryCategoryFilter])

  const openCreateModal = () => {
    setEditingEntry(null)
    setFormState(EMPTY_FORM)
    setModalOpen(true)
  }

  const openEditModal = (entry) => {
    setEditingEntry(entry)
    setFormState({
      memory_key: entry.memory_key || '',
      title: entry.title || '',
      category: entry.category || 'policy',
      keywords: entry.keywords || '',
      body: entry.body || '',
      stepsText: Array.isArray(entry.steps) ? entry.steps.join('\n') : '',
      route: entry.route || '',
      location_code: entry.location_code || '',
      permission: entry.permission || '',
      is_active: Boolean(entry.is_active),
      sort_order: entry.sort_order ?? 120,
    })
    setModalOpen(true)
  }

  const handleSaveMemory = async (event) => {
    event.preventDefault()
    if (!formState.title.trim() || !formState.body.trim()) {
      setFeedback({ type: 'error', text: 'Title and guidance body are required.' })
      return
    }
    setSavingMemory(true)
    setFeedback({ type: '', text: '' })
    const payload = {
      memory_key: formState.memory_key.trim() || undefined,
      title: formState.title.trim(),
      category: formState.category,
      keywords: formState.keywords.trim(),
      body: formState.body.trim(),
      steps: formState.stepsText
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
      route: formState.route.trim(),
      location_code: formState.location_code.trim() || null,
      permission: formState.permission.trim(),
      is_active: Boolean(formState.is_active),
      sort_order: Number(formState.sort_order) || 120,
    }
    try {
      if (editingEntry) {
        await updateAssistantMemory(editingEntry.id, payload)
        logUiAction('Assistant Memory', 'Edit Custom Memory', {
          memoryId: editingEntry.id,
          title: payload.title,
        })
        setFeedback({ type: 'success', text: 'Custom memory directive updated.' })
      } else {
        await createAssistantMemory(payload)
        logUiAction('Assistant Memory', 'Create Custom Memory', {
          title: payload.title,
          category: payload.category,
        })
        setFeedback({ type: 'success', text: 'Custom memory directive created and indexed.' })
      }
      setModalOpen(false)
      await Promise.all([loadMemoryEntries(), loadWorkspace()])
    } catch (err) {
      setFeedback({ type: 'error', text: err?.message || 'Failed to save memory directive.' })
    } finally {
      setSavingMemory(false)
    }
  }

  const handleDeleteMemory = async (entry) => {
    const confirmed = await confirm({
      title: 'Delete Custom Memory Directive',
      message: `Remove "${entry.title}" from the AI Guide knowledge base?`,
      confirmText: 'Delete',
      variant: 'danger',
    })
    if (!confirmed) return
    try {
      await deleteAssistantMemory(entry.id)
      logUiAction('Assistant Memory', 'Delete Custom Memory', {
        memoryId: entry.id,
        memoryKey: entry.memory_key,
      })
      setFeedback({ type: 'success', text: 'Custom memory directive deleted.' })
      await Promise.all([loadMemoryEntries(), loadWorkspace()])
    } catch (err) {
      setFeedback({ type: 'error', text: err?.message || 'Failed to delete memory directive.' })
    }
  }

  return (
    <div className="page-container">
      <div className="page-title">
        <div>
          <h2>Hydrocarbon Accounting AI Guide</h2>
          <p>
            Local zero-hallucination accounting guide, semantic manual search, live
            permission-scoped diagnostics, and site SOP memory.
          </p>
        </div>
        <div className="ai-checks-badges">
          {overview && (
            <>
              <span className="ai-pill ai-pill-neutral">
                {overview.memory_count} Memory Entries
              </span>
              <span className="ai-pill ai-pill-neutral">
                {overview.manual_guides_indexed} Manuals Indexed
              </span>
              <span className="ai-pill ai-pill-ml">
                100% Local CPU · Tier 2 ML Ready
              </span>
            </>
          )}
        </div>
      </div>

      {feedback.text && (
        <AlertMessage
          type={feedback.type === 'error' ? 'error' : 'success'}
          message={feedback.text}
          onClose={() => setFeedback({ type: '', text: '' })}
        />
      )}

      <div className="ai-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'guide'}
          className={`ai-tab-btn ${activeTab === 'guide' ? 'active' : ''}`}
          onClick={() => setActiveTab('guide')}
        >
          <Icon name="compass" size={15} />
          <span>Ask &amp; Diagnostics Guide</span>
        </button>

        {canViewMemory && (
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'memory'}
            className={`ai-tab-btn ${activeTab === 'memory' ? 'active' : ''}`}
            onClick={() => setActiveTab('memory')}
          >
            <Icon name="book" size={15} />
            <span>Curated Memory &amp; Site SOPs</span>
          </button>
        )}
      </div>

      {activeTab === 'guide' && (
        <div className="ai-workspace-grid">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="card">
              <div className="card-body">
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    handleAsk(question)
                  }}
                  style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}
                >
                  <select
                    value={selectedLocation}
                    onChange={(e) => setSelectedLocation(e.target.value)}
                    aria-label="Filter by location"
                    style={{ minWidth: 165 }}
                  >
                    <option value="">All Accessible Locations</option>
                    {(locations || []).map((loc) => (
                      <option key={loc.locationCode || loc.location_code} value={loc.locationCode || loc.location_code}>
                        {loc.locationCode || loc.location_code} — {loc.locationName || loc.location_name}
                      </option>
                    ))}
                  </select>

                  <input
                    type="text"
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    placeholder="Ask a calculation rule, loss/gain diagnostic, stock query, or readiness check..."
                    style={{ flex: '1 1 280px' }}
                  />

                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={asking || !question.trim()}
                  >
                    {asking ? 'Analyzing...' : 'Ask Guide'}
                  </button>
                </form>

                {overview?.quick_prompts?.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <div className="ai-fact-label" style={{ marginBottom: 6 }}>
                      Quick analytical &amp; workflow questions:
                    </div>
                    <div className="ai-quick-prompts">
                      {overview.quick_prompts.map((p) => (
                        <button
                          key={p}
                          type="button"
                          className="ai-prompt-chip"
                          disabled={asking}
                          onClick={() => handleAsk(p)}
                        >
                          {p}
                        </button>
                      ))}
                      <button
                        type="button"
                        className="ai-prompt-chip"
                        disabled={asking}
                        onClick={() => handleAsk('Show custody transfer transit variances')}
                      >
                        Show custody transfer transit variances
                      </button>
                      <button
                        type="button"
                        className="ai-prompt-chip"
                        disabled={asking}
                        onClick={() => handleAsk('Show latest tank stock positions')}
                      >
                        Show latest tank stock positions
                      </button>
                      <button
                        type="button"
                        className="ai-prompt-chip"
                        disabled={asking}
                        onClick={() => handleAsk('Show active export permit utilization')}
                      >
                        Show active export permit utilization
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {turns.length === 0 ? (
              <div className="card">
                <div className="card-body">
                  <p className="ai-answer-text">
                    Select any prompt above or ask a question in plain English. Questions about
                    <strong> live operational data</strong> (Material Balance losses/gains, CUSUM
                    creeping losses, transit variances, tank stock, Book Stock, Export Permits,
                    open ticket abnormalities, or month-end readiness) query your exact
                    permission- and location-scoped ledgers. Questions about
                    <strong> procedures and ASTM formulas</strong> search curated system memory,
                    site SOPs, and all {overview?.manual_guides_indexed || 54} indexed manuals
                    locally via hybrid BM25 + SVD semantic retrieval.
                  </p>
                </div>
              </div>
            ) : (
              turns.map((turn, idx) => (
                <AnswerCard
                  key={`turn-${idx}`}
                  question={turn.question}
                  response={turn.response}
                  onSelectFollowUp={(p) => handleAsk(p)}
                />
              ))
            )}
          </div>

          <aside style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="card">
              <div className="card-header">
                <h3 style={{ margin: 0, fontSize: '0.94rem' }}>Local AI Engine Status</h3>
              </div>
              <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div className="ai-fact-hint">
                  Runs 100% inside the OTMS backend CPU — zero external API calls, zero cloud
                  telemetry, strict RBAC &amp; Location/Party scoping.
                </div>
                <ul className="ai-steps-list">
                  {(overview?.ai_engine?.ml_models || [
                    'NumpyIsolationForest (48 trees)',
                    'StreamingHalfSpaceForest (20 trees)',
                    'RobustMahalanobis (Ledoit-Wolf shrinkage)',
                    'Page Two-Sided CUSUM',
                  ]).map((model) => (
                    <li key={model}>{model}</li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="card">
              <div className="card-header">
                <h3 style={{ margin: 0, fontSize: '0.94rem' }}>Your Recent Questions</h3>
              </div>
              <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {history.length === 0 ? (
                  <span className="ai-fact-hint">No recent questions recorded yet.</span>
                ) : (
                  history.slice(0, 10).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="ai-prompt-chip"
                      onClick={() => handleAsk(item.question)}
                    >
                      {item.question}
                    </button>
                  ))
                )}
              </div>
            </div>
          </aside>
        </div>
      )}

      {activeTab === 'memory' && canViewMemory && (
        <div className="card">
          <div className="card-body">
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 10,
                marginBottom: 14,
              }}
            >
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, flex: '1 1 320px' }}>
                <input
                  type="text"
                  value={memorySearch}
                  onChange={(e) => setMemorySearch(e.target.value)}
                  placeholder="Search memory title, keywords, or SOP body..."
                  style={{ flex: '1 1 240px' }}
                />
                <select
                  value={memoryCategoryFilter}
                  onChange={(e) => setMemoryCategoryFilter(e.target.value)}
                  aria-label="Filter by category"
                >
                  <option value="all">All Categories</option>
                  {MEMORY_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>

              {canCreateMemory && (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={openCreateModal}
                >
                  <Icon name="plus" size={15} />
                  <span>Add Custom SOP Memory</span>
                </button>
              )}
            </div>

            {loadingMemory ? (
              <p className="ai-fact-hint">Loading curated memory entries...</p>
            ) : (
              <div className="table-responsive">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Title &amp; Key</th>
                      <th>Category</th>
                      <th>Scope</th>
                      <th>Origin</th>
                      <th>Status</th>
                      <th style={{ width: 150 }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredMemories.map((entry) => (
                      <tr key={entry.id}>
                        <td>
                          <strong>{entry.title}</strong>
                          <div className="ai-finding-basis">{entry.memory_key}</div>
                          <div className="ai-fact-hint" style={{ marginTop: 4 }}>
                            {String(entry.body || '').slice(0, 160)}
                            {String(entry.body || '').length > 160 ? '...' : ''}
                          </div>
                        </td>
                        <td>
                          <span className="ai-pill ai-pill-neutral">{entry.category}</span>
                        </td>
                        <td>{entry.location_code || 'All Locations'}</td>
                        <td>
                          {entry.is_system ? (
                            <span className="ai-pill ai-pill-info">System (Read-Only)</span>
                          ) : (
                            <span className="ai-pill ai-pill-success">Company SOP</span>
                          )}
                        </td>
                        <td>
                          <span
                            className={`ai-pill ${
                              entry.is_active ? 'ai-pill-success' : 'ai-pill-neutral'
                            }`}
                          >
                            {entry.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td>
                          {entry.is_system ? (
                            <span className="ai-fact-hint">Shipped</span>
                          ) : (
                            <div style={{ display: 'flex', gap: 6 }}>
                              {canEditMemory && (
                                <button
                                  type="button"
                                  className="btn btn-sm btn-secondary"
                                  onClick={() => openEditModal(entry)}
                                >
                                  Edit
                                </button>
                              )}
                              {canDeleteMemory && (
                                <button
                                  type="button"
                                  className="btn btn-sm btn-danger"
                                  onClick={() => handleDeleteMemory(entry)}
                                >
                                  Delete
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                    {filteredMemories.length === 0 && (
                      <tr>
                        <td colSpan={6} style={{ textAlign: 'center', padding: 20 }}>
                          No memory directives match the current search.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      <Modal
        open={modalOpen}
        title={editingEntry ? 'Edit Custom SOP Memory' : 'Add Custom SOP Memory'}
        description="Custom company or location directives are indexed immediately into the local semantic search engine and audited."
        onClose={() => setModalOpen(false)}
        size="lg"
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setModalOpen(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={savingMemory}
              onClick={handleSaveMemory}
            >
              {savingMemory ? 'Saving...' : 'Save Directive'}
            </button>
          </div>
        }
      >
        <form onSubmit={handleSaveMemory} className="form-grid">
          <div className="form-group">
            <label>Title *</label>
            <input
              type="text"
              value={formState.title}
              onChange={(e) => setFormState((s) => ({ ...s, title: e.target.value }))}
              placeholder="e.g., Bonny Terminal Night-Shift Gauging Tolerance"
              required
            />
          </div>

          <div className="form-group">
            <label>Category</label>
            <select
              value={formState.category}
              onChange={(e) => setFormState((s) => ({ ...s, category: e.target.value }))}
            >
              {MEMORY_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>Location Scope (optional)</label>
            <select
              value={formState.location_code}
              onChange={(e) => setFormState((s) => ({ ...s, location_code: e.target.value }))}
            >
              <option value="">All Locations</option>
              {(locations || []).map((loc) => (
                <option key={loc.locationCode || loc.location_code} value={loc.locationCode || loc.location_code}>
                  {loc.locationCode || loc.location_code} — {loc.locationName || loc.location_name}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>Related Route (optional)</label>
            <input
              type="text"
              value={formState.route}
              onChange={(e) => setFormState((s) => ({ ...s, route: e.target.value }))}
              placeholder="/material-balance-report"
            />
          </div>

          <div className="form-group" style={{ gridColumn: '1 / -1' }}>
            <label>Keywords (space-separated)</label>
            <input
              type="text"
              value={formState.keywords}
              onChange={(e) => setFormState((s) => ({ ...s, keywords: e.target.value }))}
              placeholder="tolerance bsw sampling night shift custody transfer"
            />
          </div>

          <div className="form-group" style={{ gridColumn: '1 / -1' }}>
            <label>Guidance Body *</label>
            <textarea
              rows={4}
              value={formState.body}
              onChange={(e) => setFormState((s) => ({ ...s, body: e.target.value }))}
              placeholder="Write the authoritative SOP rule or explanation..."
              required
            />
          </div>

          <div className="form-group" style={{ gridColumn: '1 / -1' }}>
            <label>Action Steps (one step per line)</label>
            <textarea
              rows={3}
              value={formState.stepsText}
              onChange={(e) => setFormState((s) => ({ ...s, stepsText: e.target.value }))}
              placeholder={'Verify tank sample temperature before dip.\nRecord supervisor remark if variance exceeds 0.3%.'}
            />
          </div>

          <div className="form-group">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                checked={formState.is_active}
                onChange={(e) => setFormState((s) => ({ ...s, is_active: e.target.checked }))}
              />
              <span>Active in AI Guide search</span>
            </label>
          </div>
        </form>
      </Modal>
    </div>
  )
}

export default AIAssistantPage
