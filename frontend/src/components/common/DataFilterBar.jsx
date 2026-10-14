import { useId, useState } from 'react'
import Icon from './Icon'
import {
  operatorNeedsSecondValue,
  operatorNeedsValue,
  operatorsForType,
} from '../../hooks/useDataFilters'

/**
 * Filter bar for list pages (owner rule 5).
 *
 * - Quick search over every column (easy filter)
 * - Advanced: any number of field / operator / value conditions, match all or any
 * - Date filter (single day) and Date range filter – separate controls
 *
 * Receives the `barProps` object produced by `useDataFilters`.
 * Optional `actions` renders on the right (export / import / custom buttons).
 */
function DataFilterBar({
  columns,
  dateColumns,
  quick,
  setQuick,
  conditions,
  addCondition,
  updateCondition,
  removeCondition,
  match,
  setMatch,
  dateFilter,
  setDateFilter,
  dateRange,
  setDateRange,
  activeFilterCount,
  resetFilters,
  totalRows,
  filteredCount,
  actions,
  searchPlaceholder = 'Search all columns…',
  compact = false,
}) {
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showDates, setShowDates] = useState(false)
  const searchId = useId()

  const hasDateColumns = dateColumns && dateColumns.length > 0
  const conditionCount = conditions.filter((condition) => condition.field).length
  const dateCount =
    (dateFilter.field && dateFilter.date ? 1 : 0) +
    (dateRange.field && (dateRange.from || dateRange.to) ? 1 : 0)

  const renderValueInput = (condition, column) => {
    if (!operatorNeedsValue(condition.operator)) return null
    const type = column ? column.resolvedType : 'text'
    const common = {
      value: condition.value ?? '',
      onChange: (event) => updateCondition(condition.id, { value: event.target.value }),
      'aria-label': 'Filter value',
    }

    if ((type === 'select' || type === 'boolean') && column && column.options) {
      return (
        <select {...common}>
          <option value="">Select value…</option>
          {column.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      )
    }

    const inputType = type === 'number' ? 'number' : type === 'date' ? 'date' : 'text'
    return (
      <>
        <input type={inputType} placeholder={type === 'text' ? 'Value…' : undefined} {...common} />
        {operatorNeedsSecondValue(condition.operator) && (
          <>
            <span className="filter-condition-and">and</span>
            <input
              type={inputType}
              value={condition.value2 ?? ''}
              onChange={(event) => updateCondition(condition.id, { value2: event.target.value })}
              aria-label="Filter second value"
            />
          </>
        )}
      </>
    )
  }

  return (
    <div className={`data-filter-bar ${compact ? 'compact' : ''}`.trim()}>
      <div className="data-filter-row">
        <div className="data-filter-search">
          <label htmlFor={searchId} className="visually-hidden">
            Quick search
          </label>
          <span className="data-filter-search-icon">
            <Icon name="search" size={16} />
          </span>
          <input
            id={searchId}
            type="search"
            value={quick}
            onChange={(event) => setQuick(event.target.value)}
            placeholder={searchPlaceholder}
            autoComplete="off"
            spellCheck={false}
          />
          {quick && (
            <button
              type="button"
              className="data-filter-search-clear"
              onClick={() => setQuick('')}
              aria-label="Clear search"
            >
              <Icon name="close" size={14} />
            </button>
          )}
        </div>

        <div className="data-filter-toggles">
          <button
            type="button"
            className={`btn-secondary filter-toggle ${showAdvanced ? 'is-open' : ''} ${conditionCount ? 'has-active' : ''}`}
            onClick={() => setShowAdvanced((value) => !value)}
            aria-expanded={showAdvanced}
          >
            <Icon name="filter" size={15} />
            Advanced filters
            {conditionCount > 0 && <span className="filter-count">{conditionCount}</span>}
          </button>

          {hasDateColumns && (
            <button
              type="button"
              className={`btn-secondary filter-toggle ${showDates ? 'is-open' : ''} ${dateCount ? 'has-active' : ''}`}
              onClick={() => setShowDates((value) => !value)}
              aria-expanded={showDates}
            >
              <Icon name="calendarRange" size={15} />
              Date filters
              {dateCount > 0 && <span className="filter-count">{dateCount}</span>}
            </button>
          )}

          {activeFilterCount > 0 && (
            <button type="button" className="btn-ghost filter-clear" onClick={resetFilters}>
              Clear all
            </button>
          )}
        </div>

        {actions && <div className="data-filter-actions">{actions}</div>}
      </div>

      {showAdvanced && (
        <div className="data-filter-panel" role="group" aria-label="Advanced filters">
          <div className="data-filter-panel-header">
            <strong>Advanced filters</strong>
            <label className="filter-match">
              <span>Show rows matching</span>
              <select value={match} onChange={(event) => setMatch(event.target.value)}>
                <option value="all">all conditions</option>
                <option value="any">any condition</option>
              </select>
            </label>
          </div>

          {conditions.length === 0 && (
            <p className="data-filter-empty">
              No conditions yet. Add a condition to filter on any column.
            </p>
          )}

          {conditions.map((condition) => {
            const column = columns.find((item) => item.id === condition.field)
            const operators = operatorsForType(column ? column.resolvedType : 'text')
            return (
              <div key={condition.id} className="filter-condition">
                <select
                  value={condition.field}
                  onChange={(event) => {
                    const nextColumn = columns.find((item) => item.id === event.target.value)
                    const nextOperators = operatorsForType(
                      nextColumn ? nextColumn.resolvedType : 'text'
                    )
                    updateCondition(condition.id, {
                      field: event.target.value,
                      operator: nextOperators[0].value,
                      value: '',
                      value2: '',
                    })
                  }}
                  aria-label="Filter column"
                >
                  <option value="">Select column…</option>
                  {columns.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>

                <select
                  value={condition.operator}
                  onChange={(event) =>
                    updateCondition(condition.id, { operator: event.target.value })
                  }
                  aria-label="Filter operator"
                >
                  {operators.map((operator) => (
                    <option key={operator.value} value={operator.value}>
                      {operator.label}
                    </option>
                  ))}
                </select>

                <div className="filter-condition-value">{renderValueInput(condition, column)}</div>

                <button
                  type="button"
                  className="btn-ghost btn-sm filter-condition-remove"
                  onClick={() => removeCondition(condition.id)}
                  aria-label="Remove condition"
                >
                  <Icon name="close" size={15} />
                </button>
              </div>
            )
          })}

          <div className="data-filter-panel-footer">
            <button type="button" className="btn-secondary btn-sm" onClick={addCondition}>
              <Icon name="plus" size={14} />
              Add condition
            </button>
          </div>
        </div>
      )}

      {showDates && hasDateColumns && (
        <div className="data-filter-panel data-filter-dates" role="group" aria-label="Date filters">
          <div className="date-filter-group">
            <div className="date-filter-group-title">
              <Icon name="calendar" size={15} />
              <strong>Date</strong>
              <span>rows on a specific day</span>
            </div>
            <div className="date-filter-fields">
              <select
                value={dateFilter.field}
                onChange={(event) =>
                  setDateFilter({ ...dateFilter, field: event.target.value })
                }
                aria-label="Date column"
              >
                <option value="">Select date column…</option>
                {dateColumns.map((column) => (
                  <option key={column.id} value={column.id}>
                    {column.label}
                  </option>
                ))}
              </select>
              <input
                type="date"
                value={dateFilter.date}
                onChange={(event) =>
                  setDateFilter({ ...dateFilter, date: event.target.value })
                }
                aria-label="Date"
              />
              {(dateFilter.field || dateFilter.date) && (
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  onClick={() => setDateFilter({ field: '', date: '' })}
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          <div className="date-filter-group">
            <div className="date-filter-group-title">
              <Icon name="calendarRange" size={15} />
              <strong>Date range</strong>
              <span>rows between two dates (inclusive)</span>
            </div>
            <div className="date-filter-fields">
              <select
                value={dateRange.field}
                onChange={(event) => setDateRange({ ...dateRange, field: event.target.value })}
                aria-label="Date range column"
              >
                <option value="">Select date column…</option>
                {dateColumns.map((column) => (
                  <option key={column.id} value={column.id}>
                    {column.label}
                  </option>
                ))}
              </select>
              <input
                type="date"
                value={dateRange.from}
                max={dateRange.to || undefined}
                onChange={(event) => setDateRange({ ...dateRange, from: event.target.value })}
                aria-label="From date"
              />
              <span className="filter-condition-and">to</span>
              <input
                type="date"
                value={dateRange.to}
                min={dateRange.from || undefined}
                onChange={(event) => setDateRange({ ...dateRange, to: event.target.value })}
                aria-label="To date"
              />
              {(dateRange.field || dateRange.from || dateRange.to) && (
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  onClick={() => setDateRange({ field: '', from: '', to: '' })}
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {typeof totalRows === 'number' && (
        <div className="data-filter-summary" aria-live="polite">
          {activeFilterCount > 0 ? (
            <>
              Showing <strong>{filteredCount}</strong> of <strong>{totalRows}</strong> records
              {' '}· {activeFilterCount} filter{activeFilterCount === 1 ? '' : 's'} active
            </>
          ) : (
            <>
              <strong>{totalRows}</strong> record{totalRows === 1 ? '' : 's'}
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default DataFilterBar
