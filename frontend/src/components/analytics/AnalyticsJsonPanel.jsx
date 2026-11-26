import { useCallback, useEffect, useMemo, useState } from 'react'
import Icon from '../common/Icon'
import AlertMessage from '../common/AlertMessage'
import JsonColumnPicker from '../reportBuilder/JsonColumnPicker'
import { discoverAnalyticsJsonPaths, getAnalyticsOperationFields } from '../../api/analyticsApi'

/**
 * "JSON / payload fields" explorer used inside Analytics Studio.
 *
 * Report Builder lets a designer split the JSON saved inside a ticket answer
 * (or the ledger's `source_payload`) into real columns; the Studio shipped
 * without it, so dashboards could not use the same payload data. This panel
 * talks to the same discovery endpoint family (`/analytics/json-paths`,
 * `/analytics/operation-fields`) and reuses `JsonColumnPicker`, so the two
 * builders offer identical paths, labels and "one row per item" wildcards.
 *
 * Props:
 *  - sourceKind: operation_tickets | tank_stock_ledger | table | '' (unsupported)
 *  - table: table name when sourceKind === 'table'
 *  - jsonColumns: candidate JSON columns of the source table
 *  - operationTypeCodes, templateIds: current source restrictions
 *  - existingPaths: Set of already-added path keys for duplicate marking
 *  - disabled: true for TEXT / engine datasets
 *  - onAddColumns(columns): receives report columns with a payload source spec
 */
function AnalyticsJsonPanel({
  sourceKind,
  table,
  jsonColumns = [],
  operationTypeCodes = [],
  templateIds = [],
  existingPaths,
  disabled = false,
  onAddColumns,
}) {
  const [fieldCode, setFieldCode] = useState('')
  const [jsonColumn, setJsonColumn] = useState('')
  const [savedFields, setSavedFields] = useState([])
  const [templates, setTemplates] = useState([])
  const [loadingFields, setLoadingFields] = useState(false)
  const [fieldsError, setFieldsError] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)

  const isTickets = sourceKind === 'operation_tickets'
  const payloadColumns = useMemo(() => (jsonColumns || []).filter(Boolean), [jsonColumns])

  // Ticket answer / payload field list (same endpoint Report Builder uses).
  useEffect(() => {
    if (disabled || !isTickets) {
      setSavedFields([])
      setTemplates([])
      return undefined
    }
    let cancelled = false
    setLoadingFields(true)
    setFieldsError('')
    getAnalyticsOperationFields(operationTypeCodes)
      .then((data) => {
        if (cancelled) return
        const payloads = (data?.saved_fields || []).filter((field) => field.is_payload)
        setSavedFields(payloads.length ? payloads : (data?.saved_fields || []))
        setTemplates(data?.templates || [])
      })
      .catch((err) => { if (!cancelled) setFieldsError(err.message || 'Unable to load ticket payload fields.') })
      .finally(() => { if (!cancelled) setLoadingFields(false) })
    return () => { cancelled = true }
  }, [disabled, isTickets, operationTypeCodes])

  // Default to the first JSON column of a ledger/table source.
  useEffect(() => {
    if (isTickets) {
      setFieldCode((current) => current || '')
      return
    }
    if (!payloadColumns.length) {
      setJsonColumn('')
      return
    }
    setJsonColumn((current) => (current && payloadColumns.includes(current) ? current : payloadColumns[0]))
  }, [isTickets, payloadColumns])

  const request = useMemo(() => {
    if (disabled) return null
    if (isTickets) {
      if (!fieldCode) return null
      return {
        source_kind: 'operation_tickets',
        field_code: fieldCode,
        operation_type_codes: operationTypeCodes,
      }
    }
    if (!jsonColumn) return null
    return {
      source_kind: sourceKind || 'tank_stock_ledger',
      table: sourceKind === 'table' ? table : null,
      json_column: jsonColumn,
    }
  }, [disabled, fieldCode, isTickets, jsonColumn, operationTypeCodes, sourceKind, table])

  const handleAdd = useCallback((paths) => {
    if (!onAddColumns || !request) return
    const ref = request.source_kind === 'operation_tickets' ? request.field_code : request.json_column
    const columns = (paths || []).map((entry, index) => {
      const path = String(entry.path || '')
      // Key must be a valid report column key and stable per source+path so a
      // slicer/filter bound to it keeps resolving after a reload.
      const rawKey = path.replace(/\[\]/g, '_item').replace(/\./g, '_').replace(/[^A-Za-z0-9_]/g, '_')
      const baseKey = `p_${rawKey}`.toLowerCase().replace(/_+/g, '_').replace(/^_+|_+$/g, '').slice(0, 50)
      const key = /^[a-z]/.test(baseKey) ? baseKey : `p_${baseKey}`
      const source = request.source_kind === 'operation_tickets'
        ? { type: 'payload_path', field_code: request.field_code, path }
        : {
          type: sourceKind === 'table' ? 'json_path' : 'payload_path',
          json_column: request.json_column,
          path,
        }
      return {
        key: key || `p_col_${index + 1}`,
        label: entry.short_label || entry.label || path,
        kind: 'data',
        source,
        data_type: entry.data_type || 'text',
        aggregate: entry.is_wildcard ? 'FIRST' : (entry.data_type === 'number' ? 'SUM' : 'FIRST'),
        show_total: !entry.is_wildcard && entry.data_type === 'number',
        format: { decimals: entry.data_type === 'number' ? 2 : 0 },
      }
    })
    onAddColumns(columns)
    setPickerOpen(false)
  }, [onAddColumns, request, sourceKind])

  const payloadRef = isTickets ? fieldCode : jsonColumn
  const templateHint = useMemo(() => {
    if (!templateIds?.length || !templates.length) return ''
    const names = templates
      .filter((tpl) => templateIds.includes(tpl.id))
      .map((tpl) => tpl.template_name)
      .filter(Boolean)
    return names.length ? `Filtered to ${names.slice(0, 3).join(', ')}${names.length > 3 ? '…' : ''}.` : ''
  }, [templateIds, templates])

  if (disabled) {
    return (
      <div className="analytics-json-panel">
        <p className="analytics-muted-hint">
          Payload splitting is available for Operation Tickets, the Tank Stock Ledger and database tables.
        </p>
      </div>
    )
  }

  return (
    <div className="analytics-json-panel">
      <div className="analytics-section-head">
        <h4>JSON / payload fields</h4>
        <button
          type="button"
          className="btn-secondary btn-sm"
          disabled={!request}
          onClick={() => setPickerOpen(true)}
        >
          <Icon name="plus" size={13} /> Split JSON into columns
        </button>
      </div>

      {isTickets ? (
        <label>
          Ticket answer / payload
          <select value={fieldCode} onChange={(e) => setFieldCode(e.target.value)}>
            <option value="">{loadingFields ? 'Loading saved payloads…' : '(Choose a saved payload)'}</option>
            {savedFields.map((field) => (
              <option key={field.field_code} value={field.field_code}>
                {field.label || field.field_name || field.field_code}
                {field.saved_count ? ` — ${field.saved_count} saved` : ''}
              </option>
            ))}
          </select>
          <span className="analytics-muted-hint">
            {templateHint || 'Values saved inside this answer become separate columns (e.g. calculated.gsvBbl, inputs.tankOperationLabel).'}
          </span>
        </label>
      ) : (
        <label>
          JSON column
          <select value={jsonColumn} onChange={(e) => setJsonColumn(e.target.value)}>
            {payloadColumns.map((column) => (
              <option key={column} value={column}>{column}</option>
            ))}
          </select>
          <span className="analytics-muted-hint">
            Pick any value inside the stored JSON — repeatable sections can be split as “one row per item”.
          </span>
        </label>
      )}

      {fieldsError && <AlertMessage tone="error" compact message={fieldsError} />}
      {!request && (
        <p className="analytics-muted-hint">
          {isTickets ? 'Choose a saved payload to discover its fields.' : 'Choose a JSON column to discover its fields.'}
        </p>
      )}

      <JsonColumnPicker
        open={pickerOpen}
        title={`Split ${payloadRef || 'saved JSON'} into columns`}
        request={request}
        existingPaths={existingPaths}
        discover={discoverAnalyticsJsonPaths}
        onClose={() => setPickerOpen(false)}
        onAdd={handleAdd}
      />
    </div>
  )
}

export default AnalyticsJsonPanel
