import { useMemo } from 'react'
import Icon from '../common/Icon'
import { FILTER_OPERATORS } from '../../utils/reportBuilder'

const sourceId = (source) => JSON.stringify(source || {})

const valueText = (value) => Array.isArray(value) ? value.join(', ') : value ?? ''

/**
 * Rules attached to a data column, rather than to the whole report. This is
 * what lets one stored quantity become separate Dispatch, Receipt, location,
 * asset, or other comparison measures in the same result.
 */
function ComparisonConditionsEditor({ column, fields = [], onChange }) {
  const conditions = Array.isArray(column.value_conditions) ? column.value_conditions : []
  const fieldsById = useMemo(() => new Map(fields.map((field) => [field.id || sourceId(field.source), field])), [fields])
  const fieldGroups = useMemo(() => {
    const groups = new Map()
    fields.forEach((field) => {
      const group = field.group || 'Available values'
      if (!groups.has(group)) groups.set(group, [])
      groups.get(group).push(field)
    })
    return [...groups.entries()]
  }, [fields])

  const updateConditions = (next) => onChange({ value_conditions: next })
  const updateCondition = (index, patch) => updateConditions(conditions.map((condition, i) => (
    i === index ? { ...condition, ...patch } : condition
  )))

  const addCondition = () => {
    const first = fields[0]
    if (!first) return
    updateConditions([
      ...conditions,
      {
        source: first.source,
        label: first.label,
        data_type: first.data_type || 'text',
        operator: 'eq',
        value: '',
      },
    ])
  }

  return (
    <div className="rb-comparison-panel">
      <div className="rb-comparison-head">
        <div>
          <strong>Comparison rules — only include this value when…</strong>
          <p className="rb-muted">Rules belong to this column only. This is how the same saved quantity can become separate Dispatch and Receipt, location or asset columns.</p>
        </div>
        <button type="button" className="btn-secondary btn-sm" onClick={addCondition} disabled={!fields.length}>
          <Icon name="plus" size={14} /> Add rule
        </button>
      </div>

      {conditions.length > 1 && (
        <div className="rb-comparison-logic">
          <label htmlFor={`rb-comparison-logic-${column.key}`}>Match</label>
          <select
            id={`rb-comparison-logic-${column.key}`}
            value={column.value_condition_logic || 'AND'}
            onChange={(event) => onChange({ value_condition_logic: event.target.value })}
          >
            <option value="AND">ALL rules (AND)</option>
            <option value="OR">ANY rule (OR)</option>
          </select>
        </div>
      )}

      {conditions.map((condition, index) => {
        const selectedId = sourceId(condition.source)
        const selected = fieldsById.get(selectedId)
        const dataType = condition.data_type || selected?.data_type || 'text'
        const operator = condition.operator || 'eq'
        const hidesValue = ['is_blank', 'is_not_blank'].includes(operator)
        const listValue = ['in', 'not_in'].includes(operator)
        const booleanValue = dataType === 'boolean'
        const inputType = listValue ? 'text' : dataType === 'number' ? 'number' : dataType === 'date' ? 'date' : 'text'

        return (
          <div className="rb-comparison-rule" key={`${column.key}-${index}`}>
            <div className="rb-filter-row">
              <div className="rb-field">
                <label>Use this field</label>
                <select
                  value={selected ? selectedId : ''}
                  onChange={(event) => {
                    const next = fieldsById.get(event.target.value)
                    if (!next) return
                    updateCondition(index, {
                      source: next.source,
                      label: next.label,
                      data_type: next.data_type || 'text',
                      operator: 'eq',
                      value: '',
                      value2: '',
                    })
                  }}
                >
                  {!selected && <option value="">This field is no longer available</option>}
                  {fieldGroups.map(([group, entries]) => (
                    <optgroup key={group} label={group}>
                      {entries.map((field) => {
                        const id = field.id || sourceId(field.source)
                        return <option key={id} value={id}>{field.label}</option>
                      })}
                    </optgroup>
                  ))}
                </select>
              </div>
              <div className="rb-field">
                <label>Condition</label>
                <select value={operator} onChange={(event) => updateCondition(index, { operator: event.target.value })}>
                  {FILTER_OPERATORS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </div>
              {!hidesValue && (
                <div className="rb-field">
                  <label>{listValue ? 'Values (comma separated)' : 'Value'}</label>
                  {booleanValue ? (
                    <select value={String(condition.value ?? '')} onChange={(event) => updateCondition(index, { value: event.target.value })}>
                      <option value="">Choose…</option>
                      <option value="true">Yes</option>
                      <option value="false">No</option>
                    </select>
                  ) : (
                    <input
                      type={inputType}
                      step={dataType === 'number' ? 'any' : undefined}
                      value={valueText(condition.value)}
                      onChange={(event) => updateCondition(index, { value: event.target.value })}
                      placeholder={listValue ? 'A, B, C' : dataType === 'number' ? 'Number' : 'Value'}
                    />
                  )}
                </div>
              )}
              {operator === 'between' && (
                <div className="rb-field">
                  <label>And value</label>
                  <input
                    type={inputType}
                    step={dataType === 'number' ? 'any' : undefined}
                    value={condition.value2 ?? ''}
                    onChange={(event) => updateCondition(index, { value2: event.target.value })}
                  />
                </div>
              )}
              <button
                type="button"
                className="btn-secondary btn-sm rb-comparison-remove"
                onClick={() => updateConditions(conditions.filter((_, i) => i !== index))}
                aria-label={`Remove comparison rule ${index + 1}`}
                title="Remove rule"
              >
                <Icon name="trash" size={14} />
              </button>
            </div>
          </div>
        )
      })}

      {conditions.length === 0 && (
        <p className="rb-muted rb-comparison-empty">No comparison rules yet: this column includes every row. Add a rule to make it a conditional comparison value.</p>
      )}
      {!fields.length && <p className="rb-muted">Available fields are still loading. Try again in a moment.</p>}
    </div>
  )
}

export default ComparisonConditionsEditor
