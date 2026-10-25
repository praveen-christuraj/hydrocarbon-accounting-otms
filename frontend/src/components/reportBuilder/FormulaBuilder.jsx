import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Modal from '../common/Modal'
import AlertMessage from '../common/AlertMessage'
import Icon from '../common/Icon'
import { validateReportFormula } from '../../api/reportBuilderApi'
import {
  COMPARISONS,
  OPERATORS,
  buildIfFormula,
  buildIfsFormula,
  formulaInWords,
} from '../../utils/reportBuilder'

const FUNCTIONS = [
  { name: 'IF', snippet: 'IF([col] > 0, , )', caretBack: 4, help: 'IF(condition, value if true, value if false)' },
  { name: 'IFS', snippet: 'IFS([col] >= 100, "Large", "Small")', help: 'First true condition wins' },
  { name: 'AND', snippet: 'AND([col] > 0, [col] < 10)', help: 'All conditions true' },
  { name: 'OR', snippet: 'OR([col] = "A", [col] = "B")', help: 'Any condition true' },
  { name: 'NOT', snippet: 'NOT([col] = "Draft")', help: 'Reverse a condition' },
  { name: 'IFERROR', snippet: 'IFERROR([a] / [b], 0)', help: 'Fallback when calculation fails' },
  { name: 'COALESCE', snippet: 'COALESCE([col], 0)', help: 'Use 0 when blank' },
  { name: 'ISBLANK', snippet: 'ISBLANK([col])', help: 'True when empty' },
  { name: 'ABS', snippet: 'ABS([col])', help: 'Positive value' },
  { name: 'ROUND', snippet: 'ROUND([col], 3)', help: 'Round decimals' },
  { name: 'SUM', snippet: 'SUM([a], [b])', help: 'Add row values, ignore blanks' },
  { name: 'AVG', snippet: 'AVG([a], [b])', help: 'Average of row values' },
  { name: 'MIN', snippet: 'MIN([a], [b])', help: 'Smallest' },
  { name: 'MAX', snippet: 'MAX([a], [b])', help: 'Largest' },
  { name: 'PCT', snippet: 'PCT([part], [whole])', help: 'Percentage (same as %)' },
  { name: 'CONCAT', snippet: 'CONCAT([a], " - ", [b])', help: 'Join text' },
  { name: 'DATEDIFF', snippet: 'DATEDIFF([later], [earlier])', help: 'Days between dates' },
]

function OperandPicker({ label, operand, onChange, columns }) {
  const kind = operand?.kind || 'column'
  return (
    <div className="rb-operand">
      <label>{label}</label>
      <div className="rb-operand-row">
        <select
          value={kind}
          onChange={(e) =>
            onChange(
              e.target.value === 'column'
                ? { kind: 'column', key: columns[0]?.key || '' }
                : { kind: 'value', value: '', valueType: 'number' }
            )
          }
        >
          <option value="column">A column</option>
          <option value="value">A typed value</option>
        </select>
        {kind === 'column' ? (
          <select value={operand?.key || ''} onChange={(e) => onChange({ kind: 'column', key: e.target.value })}>
            {columns.map((c) => (
              <option key={c.key} value={c.key}>{c.label}</option>
            ))}
          </select>
        ) : (
          <>
            <input
              type="text"
              value={operand?.value ?? ''}
              placeholder="e.g. 0.5 or Approved"
              onChange={(e) => onChange({ kind: 'value', value: e.target.value, valueType: operand?.valueType || 'number' })}
            />
            <select
              value={operand?.valueType || 'number'}
              onChange={(e) => onChange({ kind: 'value', value: operand?.value ?? '', valueType: e.target.value })}
              title="Is the typed value a number or text?"
            >
              <option value="number">Number</option>
              <option value="text">Text</option>
            </select>
          </>
        )}
      </div>
    </div>
  )
}

/**
 * Calculated-column editor for non-technical users: pick columns and
 * operators by clicking, or describe an IF / IFS rule in rows; the formula
 * text stays visible (and editable) with a plain-English reading and live
 * server validation.
 */
function FormulaBuilder({ open, initial, columns, onClose, onSave }) {
  const [label, setLabel] = useState('')
  const [formula, setFormula] = useState('')
  const [mode, setMode] = useState('click') // click | if | ifs | text
  const [verdict, setVerdict] = useState(null)
  const [checking, setChecking] = useState(false)
  const textareaRef = useRef(null)

  const [conditions, setConditions] = useState([{ left: null, comparison: '=', right: null }])
  const [joiner, setJoiner] = useState('AND')
  const [thenValue, setThenValue] = useState(null)
  const [elseValue, setElseValue] = useState(null)
  const [bands, setBands] = useState([{ left: null, comparison: '>=', right: null, result: null }])
  const [defaultBand, setDefaultBand] = useState(null)

  useEffect(() => {
    if (!open) return
  // eslint-disable-next-line react-hooks/set-state-in-effect
    setLabel(initial?.label || '')
    setFormula(initial?.formula || '')
    setMode(initial?.formula ? 'text' : 'click')
    setVerdict(null)
    const first = columns[0] ? { kind: 'column', key: columns[0].key } : null
    setConditions([{ left: first, comparison: '=', right: { kind: 'value', value: '', valueType: 'number' } }])
    setThenValue(first)
    setElseValue({ kind: 'value', value: '0', valueType: 'number' })
    setBands([{ left: first, comparison: '>=', right: { kind: 'value', value: '', valueType: 'number' }, result: { kind: 'value', value: '', valueType: 'text' } }])
    setDefaultBand({ kind: 'value', value: '', valueType: 'text' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial])

  const columnKeys = useMemo(() => columns.map((c) => c.key), [columns])

  const runValidation = useCallback(async (text) => {
    if (!String(text || '').trim()) {
      setVerdict(null)
      return null
    }
    setChecking(true)
    try {
      const result = await validateReportFormula(text, columnKeys)
      setVerdict(result)
      return result
    } catch (error) {
      const fallback = { valid: false, error: error.message }
      setVerdict(fallback)
      return fallback
    } finally {
      setChecking(false)
    }
  }, [columnKeys])

  useEffect(() => {
    if (!open) return undefined
    const timer = window.setTimeout(() => { runValidation(formula) }, 500)
    return () => window.clearTimeout(timer)
  }, [formula, open, runValidation])

  const insertAtCursor = (text, caretBack = 0) => {
    const area = textareaRef.current
    if (!area) {
      setFormula((current) => `${current}${text}`)
      return
    }
    const start = area.selectionStart ?? formula.length
    const end = area.selectionEnd ?? formula.length
    const next = `${formula.slice(0, start)}${text}${formula.slice(end)}`
    setFormula(next)
    window.requestAnimationFrame(() => {
      area.focus()
      const pos = start + text.length - caretBack
      area.setSelectionRange(pos, pos)
    })
  }

  const applyComposer = () => {
    const built = mode === 'ifs'
      ? buildIfsFormula({ bands, defaultValue: defaultBand })
      : buildIfFormula({ conditions, joiner, thenValue, elseValue })
    if (built) setFormula(built)
  }

  const handleSave = async () => {
    const result = verdict?.valid === true ? verdict : await runValidation(formula)
    if (!result?.valid) return
    onSave({ label: label.trim() || 'Calculated Column', formula: formula.trim() })
  }

  return (
    <Modal
      open={open}
      title={initial ? 'Edit Calculated Column' : 'Add Calculated Column'}
      description="Build the calculation by clicking, or type it. % between two columns means “as a percentage of”."
      onClose={onClose}
      size="lg"
      footer={(
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary" onClick={handleSave} disabled={!formula.trim() || checking || verdict?.valid === false}>
            <Icon name="check" size={15} /> Use this calculation
          </button>
        </>
      )}
    >
      <div className="rb-formula-builder">
        <div className="rb-field">
          <label htmlFor="rb-calc-label">Column heading</label>
          <input id="rb-calc-label" type="text" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Variance % of Received" />
        </div>

        <div className="rb-mode-tabs" role="tablist" aria-label="How to build the formula">
          {[
            ['click', 'Click to build'],
            ['if', 'IF … then … else'],
            ['ifs', 'Bands (IFS)'],
            ['text', 'Type formula'],
          ].map(([value, text]) => (
            <button key={value} type="button" role="tab" aria-selected={mode === value} className={mode === value ? 'active' : ''} onClick={() => setMode(value)}>
              {text}
            </button>
          ))}
        </div>

        {mode === 'click' && (
          <div className="rb-click-help">
            <p>Click columns, operators and functions to build the formula — for example <strong>Variance</strong>, then <strong>%</strong>, then <strong>Received</strong> gives the variance as a percentage of what was received.</p>
          </div>
        )}

        {mode === 'if' && (
          <div className="rb-composer">
            {conditions.map((condition, index) => (
              <div className="rb-condition-row" key={index}>
                <OperandPicker label={index === 0 ? 'When this' : `${joiner} this`} operand={condition.left} columns={columns} onChange={(left) => setConditions((cur) => cur.map((c, i) => (i === index ? { ...c, left } : c)))} />
                <div className="rb-field">
                  <label>Comparison</label>
                  <select value={condition.comparison} onChange={(e) => setConditions((cur) => cur.map((c, i) => (i === index ? { ...c, comparison: e.target.value } : c)))}>
                    {COMPARISONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>
                <OperandPicker label="This value" operand={condition.right} columns={columns} onChange={(right) => setConditions((cur) => cur.map((c, i) => (i === index ? { ...c, right } : c)))} />
                {conditions.length > 1 && (
                  <button type="button" className="btn-secondary btn-sm" onClick={() => setConditions((cur) => cur.filter((_, i) => i !== index))} aria-label="Remove condition">
                    <Icon name="trash" size={14} />
                  </button>
                )}
              </div>
            ))}
            <div className="rb-composer-actions">
              <select value={joiner} onChange={(e) => setJoiner(e.target.value)} aria-label="Combine conditions with">
                <option value="AND">All must be true (AND)</option>
                <option value="OR">Any can be true (OR)</option>
              </select>
              <button type="button" className="btn-secondary btn-sm" onClick={() => setConditions((cur) => [...cur, { left: columns[0] ? { kind: 'column', key: columns[0].key } : null, comparison: '=', right: { kind: 'value', value: '', valueType: 'number' } }])}>
                <Icon name="plus" size={14} /> Add condition
              </button>
            </div>
            <div className="rb-condition-row">
              <OperandPicker label="Then use" operand={thenValue} columns={columns} onChange={setThenValue} />
              <OperandPicker label="Otherwise use" operand={elseValue} columns={columns} onChange={setElseValue} />
            </div>
            <button type="button" className="btn-secondary" onClick={applyComposer}>Put this rule into the formula</button>
          </div>
        )}

        {mode === 'ifs' && (
          <div className="rb-composer">
            <p className="rb-click-help">Bands are checked from top to bottom — the first matching band gives the answer (like grading Large / Medium / Small).</p>
            {bands.map((band, index) => (
              <div className="rb-condition-row" key={index}>
                <OperandPicker label="When this" operand={band.left} columns={columns} onChange={(left) => setBands((cur) => cur.map((b, i) => (i === index ? { ...b, left } : b)))} />
                <div className="rb-field">
                  <label>Comparison</label>
                  <select value={band.comparison} onChange={(e) => setBands((cur) => cur.map((b, i) => (i === index ? { ...b, comparison: e.target.value } : b)))}>
                    {COMPARISONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>
                <OperandPicker label="This value" operand={band.right} columns={columns} onChange={(right) => setBands((cur) => cur.map((b, i) => (i === index ? { ...b, right } : b)))} />
                <OperandPicker label="Answer is" operand={band.result} columns={columns} onChange={(result) => setBands((cur) => cur.map((b, i) => (i === index ? { ...b, result } : b)))} />
                {bands.length > 1 && (
                  <button type="button" className="btn-secondary btn-sm" onClick={() => setBands((cur) => cur.filter((_, i) => i !== index))} aria-label="Remove band"><Icon name="trash" size={14} /></button>
                )}
              </div>
            ))}
            <div className="rb-composer-actions">
              <button type="button" className="btn-secondary btn-sm" onClick={() => setBands((cur) => [...cur, { left: columns[0] ? { kind: 'column', key: columns[0].key } : null, comparison: '>=', right: { kind: 'value', value: '', valueType: 'number' }, result: { kind: 'value', value: '', valueType: 'text' } }])}>
                <Icon name="plus" size={14} /> Add band
              </button>
            </div>
            <OperandPicker label="If nothing matches, use" operand={defaultBand} columns={columns} onChange={setDefaultBand} />
            <button type="button" className="btn-secondary" onClick={applyComposer}>Put these bands into the formula</button>
          </div>
        )}

        {(mode === 'click' || mode === 'text') && (
          <>
            <div className="rb-chip-block">
              <span className="rb-chip-title">Columns</span>
              <div className="rb-chips">
                {columns.length === 0 && <span className="rb-muted">Add data columns first, then calculate from them.</span>}
                {columns.map((c) => (
                  <button key={c.key} type="button" className="rb-chip" onClick={() => insertAtCursor(`[${c.key}]`)} title={`Insert ${c.label}`}>
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="rb-chip-block">
              <span className="rb-chip-title">Maths</span>
              <div className="rb-chips">
                {OPERATORS.map((op) => (
                  <button key={op.symbol} type="button" className="rb-chip" onClick={() => insertAtCursor(` ${op.symbol} `)}>{op.label}</button>
                ))}
                <button type="button" className="rb-chip" onClick={() => insertAtCursor('(')}>(</button>
                <button type="button" className="rb-chip" onClick={() => insertAtCursor(')')}>)</button>
                {[' = ', ' <> ', ' > ', ' >= ', ' < ', ' <= '].map((op) => (
                  <button key={op} type="button" className="rb-chip" onClick={() => insertAtCursor(op)}>{op.trim()}</button>
                ))}
              </div>
            </div>
            <div className="rb-chip-block">
              <span className="rb-chip-title">Functions</span>
              <div className="rb-chips">
                {FUNCTIONS.map((fn) => (
                  <button key={fn.name} type="button" className="rb-chip" title={fn.help} onClick={() => insertAtCursor(fn.snippet, fn.caretBack || 0)}>{fn.name}</button>
                ))}
              </div>
            </div>
          </>
        )}

        <div className="rb-field">
          <label htmlFor="rb-formula-text">Formula</label>
          <textarea
            id="rb-formula-text"
            ref={textareaRef}
            rows={3}
            value={formula}
            onChange={(e) => setFormula(e.target.value)}
            placeholder="e.g. IFERROR(([closing] - [opening]) % [opening], 0)"
            spellCheck={false}
          />
        </div>

        {formula.trim() && (
          <div className="rb-formula-words">
            <strong>In words:</strong> {formulaInWords(formula, columns)}
          </div>
        )}
        {checking && <AlertMessage tone="info" message="Checking the formula…" />}
        {!checking && verdict?.valid && (
          <AlertMessage tone="success" message={`Formula is valid. It uses: ${verdict.referenced_columns?.map((k) => columns.find((c) => c.key === k)?.label || k).join(', ') || 'no columns'}.`} />
        )}
        {!checking && verdict && !verdict.valid && (
          <AlertMessage tone="error" title="This formula needs a fix" message={verdict.error} />
        )}
        <p className="rb-muted">
          Tips: blanks stay blank through + − × ÷ (use COALESCE([col], 0) to treat blank as zero).
          Wrap divisions in IFERROR(…, 0) so a zero divisor shows 0 instead of blank.
        </p>
      </div>
    </Modal>
  )
}

export default FormulaBuilder
