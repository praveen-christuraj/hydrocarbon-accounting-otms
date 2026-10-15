import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  createExportTransaction,
  deleteExportTransaction,
  getExportTransactions,
  updateExportTransaction,
} from '../../api/exportOperationsApi'
import PaginationControls, { paginateRows, usePageSize } from '../../components/common/PaginationControls'
import DataTableToolbar from '../../components/common/DataTableToolbar'
import PageHeader from '../../components/common/PageHeader'
import AlertMessage from '../../components/common/AlertMessage'
import FormDialog from '../../components/common/FormDialog'
import Icon from '../../components/common/Icon'
import { useConfirm } from '../../components/common/ConfirmProvider'
import { useDataFilters } from '../../hooks/useDataFilters'
import { logUiAction } from '../../utils/actionLogger'
import {
  COUNTRIES,
  EXPORT_MODULE,
  blocksForEntity,
  codeOptions,
  fmt,
  quarterFromDate,
  useExportPermissions,
  useExportReferenceData,
} from './exportShared'

const MODULE = 'Export Transactions'

const COLUMNS = [
  { key: 'bl_date', label: 'BL Date', type: 'date' },
  { key: 'vessel_name', label: 'Vessel' },
  { key: 'quarter', label: 'Quarter', type: 'select' },
  { key: 'location_label', label: 'Location', type: 'select' },
  { key: 'entity_label', label: 'Entity', type: 'select' },
  { key: 'block_label', label: 'Block', type: 'select' },
  { key: 'volume', label: 'Volume', type: 'number' },
  { key: 'consignee', label: 'Consignee', type: 'select' },
  { key: 'destination', label: 'Destination' },
  { key: 'country', label: 'Country', type: 'select' },
  { key: 'permit_number', label: 'Permit #' },
  { key: 'remarks', label: 'Remarks' },
]

const emptyForm = {
  bl_date: '',
  location_code: '',
  entity_code: '',
  consignee: '',
  destination: '',
  country: '',
  vessel_name: '',
  permit_number: '',
  remarks: '',
  block_code: '',
  volume: '',
  block_entries: [],
}

function ExportTransactions({ loggedInUser }) {
  const confirm = useConfirm()
  const { canCreate, canEdit, canDelete } = useExportPermissions(loggedInUser, 'Export Transaction')
  const reference = useExportReferenceData(['locations', 'entities', 'blocks', 'entityBlocks', 'consignees', 'permits'])
  const { locations, entities, blocks, entityBlocks, consignees, permits } = reference.data

  const [transactions, setTransactions] = useState([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [form, setForm] = useState(emptyForm)
  const [editing, setEditing] = useState(null)
  const [formOpen, setFormOpen] = useState(false)
  const [formError, setFormError] = useState('')
  const [permitOverride, setPermitOverride] = useState(false)
  const [page, setPage] = useState(1)
  const pageSize = usePageSize()

  const loadTransactions = useCallback(async () => {
    setLoading(true)
    try {
      const data = await getExportTransactions()
      setTransactions(Array.isArray(data) ? data : [])
    } catch (err) {
      setError(err.message || 'Unable to load export transactions.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    getExportTransactions()
      .then((data) => {
        if (!cancelled) setTransactions(Array.isArray(data) ? data : [])
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Unable to load export transactions.')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const rows = useMemo(
    () =>
      [...transactions]
        .sort((a, b) => String(b.bl_date || '').localeCompare(String(a.bl_date || '')) || b.id - a.id)
        .map((tx) => ({
          ...tx,
          location_label: tx.location_name || tx.location_code,
          entity_label: tx.entity_name || tx.entity_code,
          block_label: tx.block_name || tx.block_code,
        })),
    [transactions]
  )
  const filters = useDataFilters(rows, COLUMNS, { module: MODULE })
  const visibleRows = paginateRows(filters.filteredRows, page, pageSize)
  const totalVolume = filters.filteredRows.reduce((sum, row) => sum + Number(row.volume || 0), 0)

  const linkedBlocks = useMemo(
    () => blocksForEntity(blocks, entityBlocks, form.entity_code),
    [blocks, entityBlocks, form.entity_code]
  )

  const entriesForSave = () =>
    editing
      ? [{ block_code: form.block_code, volume: Number(form.volume || 0) }]
      : form.block_entries
          .map((entry) => ({ block_code: entry.block_code, volume: Number(entry.volume || 0) }))
          .filter((entry) => entry.volume > 0)

  const permitIssues = useMemo(() => {
    if (!form.permit_number) return []
    const entries = editing
      ? [{ block_code: form.block_code, volume: Number(form.volume || 0) }]
      : form.block_entries.map((entry) => ({ block_code: entry.block_code, volume: Number(entry.volume || 0) }))
    return entries.filter((entry) => {
      if (!entry.volume) return false
      const permit = permits.find(
        (item) =>
          item.permit_number === form.permit_number &&
          item.location_code === form.location_code &&
          item.entity_code === form.entity_code &&
          (item.block_code === entry.block_code || (item.block_codes || []).includes(entry.block_code))
      )
      if (!permit) return false
      const remaining = Number(permit.remaining_volume || 0) + (editing ? Number(editing.volume || 0) : 0)
      return entry.volume > remaining
    })
  }, [form, editing, permits])

  const setField = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }))
    setFormError('')
  }

  const handleEntityChange = (entityCode) => {
    setPermitOverride(false)
    setForm((current) => ({
      ...current,
      entity_code: entityCode,
      block_code: '',
      block_entries: blocksForEntity(blocks, entityBlocks, entityCode).map((block) => ({
        block_code: block.block_code,
        block_name: block.block_name,
        volume: '',
      })),
    }))
  }

  const updateBlockEntry = (index, value) => {
    setForm((current) => {
      const entries = [...current.block_entries]
      entries[index] = { ...entries[index], volume: value }
      return { ...current, block_entries: entries }
    })
  }

  const openCreate = () => {
    setError('')
    setSuccess('')
    setEditing(null)
    setForm(emptyForm)
    setPermitOverride(false)
    setFormError('')
    setFormOpen(true)
    logUiAction(MODULE, 'Open Create Dialog')
  }

  const openEdit = (tx) => {
    setError('')
    setSuccess('')
    setEditing(tx)
    setForm({
      ...emptyForm,
      bl_date: tx.bl_date || '',
      location_code: tx.location_code || '',
      entity_code: tx.entity_code || '',
      consignee: tx.consignee || '',
      destination: tx.destination || '',
      country: tx.country || '',
      vessel_name: tx.vessel_name || '',
      permit_number: tx.permit_number || '',
      remarks: tx.remarks || '',
      block_code: tx.block_code || '',
      volume: tx.volume ?? '',
    })
    setPermitOverride(false)
    setFormError('')
    setFormOpen(true)
    logUiAction(MODULE, 'Open Edit Dialog', { id: tx.id })
  }

  const closeForm = () => {
    setFormOpen(false)
    setEditing(null)
    setForm(emptyForm)
    setFormError('')
  }

  const validate = () => {
    const missing = []
    if (!form.bl_date) missing.push('BL Date')
    if (!form.location_code) missing.push('Location')
    if (!form.entity_code) missing.push('Entity')
    if (!form.consignee) missing.push('Consignee')
    if (!form.destination.trim()) missing.push('Destination')
    if (!form.country) missing.push('Country')
    if (editing && !form.block_code) missing.push('Block')
    if (missing.length) return `Required: ${missing.join(', ')}.`
    if (entriesForSave().length === 0) return 'Enter a volume greater than zero for at least one block.'
    if (permitIssues.length && !permitOverride) {
      return 'The volume exceeds the remaining permit volume. Tick "Override" to save anyway.'
    }
    return ''
  }

  const handleSubmit = async () => {
    if (!(editing ? canEdit : canCreate)) {
      setFormError(`You do not have permission to ${editing ? 'edit' : 'create'} export transactions.`)
      return
    }
    const problem = validate()
    if (problem) {
      setFormError(problem)
      return
    }
    const entries = entriesForSave()
    const payload = {
      bl_date: form.bl_date,
      location_code: form.location_code,
      entity_code: form.entity_code,
      consignee: form.consignee,
      destination: form.destination.trim(),
      country: form.country,
      vessel_name: form.vessel_name.trim() || null,
      permit_number: form.permit_number.trim() || null,
      remarks: form.remarks.trim() || null,
      block_code: entries[0].block_code,
      volume: entries[0].volume,
      block_entries: entries,
      override: permitOverride,
    }
    try {
      setSaving(true)
      if (editing) await updateExportTransaction(editing.id, payload)
      else await createExportTransaction(payload)
      setSuccess(
        editing
          ? 'Export transaction updated.'
          : `Export saved (${entries.length} block ${entries.length === 1 ? 'entry' : 'entries'}).`
      )
      closeForm()
      await Promise.all([loadTransactions(), reference.reload()])
    } catch (err) {
      setFormError(err.message || 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (tx) => {
    setError('')
    setSuccess('')
    const confirmed = await confirm({
      title: 'Delete export transaction',
      message: `Delete the ${tx.bl_date} export of ${fmt(tx.volume)} from block ${tx.block_name || tx.block_code}?`,
      tone: 'danger',
      confirmLabel: 'Delete',
      module: EXPORT_MODULE,
    })
    if (!confirmed) return
    try {
      setLoading(true)
      await deleteExportTransaction(tx.id)
      setSuccess('Export transaction deleted.')
      await Promise.all([loadTransactions(), reference.reload()])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const codes = (items, key) => new Set(items.map((item) => item[key]))
  const importConfig = {
    title: 'Bulk upload export transactions',
    description: 'One row per block. Rows are validated against export locations, entities, blocks and consignees.',
    fields: [
      { key: 'bl_date', label: 'BL Date (YYYY-MM-DD)', required: true, example: '2026-01-15' },
      { key: 'location_code', label: 'Location Code', required: true, example: locations[0]?.location_code || 'LOC001' },
      { key: 'entity_code', label: 'Entity Code', required: true, example: entities[0]?.entity_code || 'ENT001' },
      { key: 'block_code', label: 'Block Code', required: true, example: blocks[0]?.block_code || 'BLK001' },
      { key: 'volume', label: 'Volume', required: true, example: '1000' },
      { key: 'consignee', label: 'Consignee', required: true, example: consignees[0]?.consignee_name || '' },
      { key: 'destination', label: 'Destination', required: true, example: 'Rotterdam' },
      { key: 'country', label: 'Country', required: true, example: 'Netherlands' },
      { key: 'vessel_name', label: 'Vessel Name', example: '' },
      { key: 'permit_number', label: 'Permit Number', example: '' },
      { key: 'remarks', label: 'Remarks', example: '' },
    ],
    validateRow: (record) => {
      if (Number.isNaN(Date.parse(record.bl_date))) return 'BL Date must be a valid date (YYYY-MM-DD)'
      if (!codes(locations, 'location_code').has(record.location_code)) return `Unknown location code ${record.location_code}`
      if (!codes(entities, 'entity_code').has(record.entity_code)) return `Unknown entity code ${record.entity_code}`
      const linked = blocksForEntity(blocks, entityBlocks, record.entity_code)
      if (!linked.some((block) => block.block_code === record.block_code)) {
        return `Block ${record.block_code} is not mapped to entity ${record.entity_code}`
      }
      if (!(Number(record.volume) > 0)) return 'Volume must be a positive number'
      if (!codes(consignees, 'consignee_name').has(record.consignee)) return `Unknown consignee ${record.consignee}`
      if (!COUNTRIES.includes(record.country)) return `Unknown country ${record.country}`
      return null
    },
    onImportRow: async (record) => {
      const volume = Number(record.volume)
      await createExportTransaction({
        ...record,
        vessel_name: record.vessel_name || null,
        permit_number: record.permit_number || null,
        remarks: record.remarks || null,
        volume,
        block_entries: [{ block_code: record.block_code, volume }],
        override: false,
      })
    },
    onComplete: async () => {
      await Promise.all([loadTransactions(), reference.reload()])
    },
  }

  const showActions = canEdit || canDelete
  const blockTotal = form.block_entries.reduce((sum, entry) => sum + Number(entry.volume || 0), 0)

  return (
    <div className="export-operations-page">
      <PageHeader
        title="Export Transactions"
        description="Export liftings by BL date, with volumes per block checked against permits."
        count={`${transactions.length} Transactions`}
        actions={
          canCreate && (
            <button type="button" className="btn-primary" onClick={openCreate}>
              <Icon name="plus" size={15} />
              New Export
            </button>
          )
        }
      />

      <AlertMessage tone="success" message={success} onDismiss={() => setSuccess('')} />
      <AlertMessage tone="error" message={error || reference.error} onDismiss={() => setError('')} />
      {!canCreate && !canEdit && !canDelete && (
        <div className="info-box">You have view-only access to export transactions.</div>
      )}

      <DataTableToolbar
        filters={filters}
        columns={COLUMNS}
        exportFileName="export-transactions"
        exportTitle="Export Transactions"
        module={MODULE}
        importConfig={importConfig}
        canImport={canCreate}
        searchPlaceholder="Search vessel, consignee, permit…"
        extraActions={<span className="toolbar-total">Total volume: <strong>{fmt(totalVolume)}</strong></span>}
      />

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>BL Date</th>
              <th>Vessel</th>
              <th>Quarter</th>
              <th>Location</th>
              <th>Entity</th>
              <th>Block</th>
              <th className="numeric">Volume</th>
              <th>Consignee</th>
              <th>Destination / Country</th>
              <th>Permit #</th>
              <th>Remarks</th>
              {showActions && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 ? (
              <tr>
                <td colSpan={showActions ? 12 : 11} className="empty-table">
                  {loading ? 'Loading…' : transactions.length === 0 ? 'No export transactions yet.' : 'No transactions match the filters.'}
                </td>
              </tr>
            ) : (
              visibleRows.map((tx) => (
                <tr key={tx.id}>
                  <td>{tx.bl_date}</td>
                  <td>{tx.vessel_name || '—'}</td>
                  <td>{tx.quarter}</td>
                  <td>{tx.location_label}</td>
                  <td>{tx.entity_label}</td>
                  <td>{tx.block_label}</td>
                  <td className="numeric">{fmt(tx.volume)}</td>
                  <td>{tx.consignee}</td>
                  <td>
                    {tx.destination}
                    <div className="muted-table-text">{tx.country}</div>
                  </td>
                  <td>{tx.permit_number || '—'}</td>
                  <td className="cell-wrap">{tx.remarks || '—'}</td>
                  {showActions && (
                    <td className="row-actions">
                      {canEdit && (
                        <button type="button" onClick={() => openEdit(tx)}>
                          Edit
                        </button>
                      )}
                      {canDelete && (
                        <button type="button" onClick={() => handleDelete(tx)} disabled={loading}>
                          Delete
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <PaginationControls currentPage={page} totalRows={filters.filteredRows.length} onPageChange={setPage} />

      <FormDialog
        open={formOpen}
        title={editing ? 'Edit Export Transaction' : 'New Export'}
        description={
          editing
            ? `Editing the ${editing.block_name || editing.block_code} entry of this lifting.`
            : 'Enter the lifting details, then the volume exported from each block.'
        }
        size="lg"
        columns={3}
        submitLabel={editing ? 'Update Export' : 'Save Export'}
        busy={saving}
        error={formError}
        onDismissError={() => setFormError('')}
        onSubmit={handleSubmit}
        onCancel={closeForm}
      >
        <div>
          <label htmlFor="xt-bl-date">BL Date *</label>
          <input id="xt-bl-date" type="date" value={form.bl_date} onChange={(e) => setField('bl_date', e.target.value)} />
        </div>
        <div>
          <label htmlFor="xt-quarter">Quarter</label>
          <input id="xt-quarter" value={quarterFromDate(form.bl_date)} disabled placeholder="From BL date" />
        </div>
        <div>
          <label htmlFor="xt-vessel">Vessel Name</label>
          <input id="xt-vessel" value={form.vessel_name} onChange={(e) => setField('vessel_name', e.target.value)} />
        </div>
        <div>
          <label htmlFor="xt-location">Location *</label>
          <select id="xt-location" value={form.location_code} onChange={(e) => setField('location_code', e.target.value)}>
            <option value="">Select location</option>
            {codeOptions(locations, 'location_name', 'location_code')}
          </select>
        </div>
        <div>
          <label htmlFor="xt-entity">Entity *</label>
          <select id="xt-entity" value={form.entity_code} onChange={(e) => handleEntityChange(e.target.value)}>
            <option value="">Select entity</option>
            {codeOptions(entities, 'entity_name', 'entity_code')}
          </select>
        </div>
        <div>
          <label htmlFor="xt-permit">Permit #</label>
          <input id="xt-permit" value={form.permit_number} onChange={(e) => setField('permit_number', e.target.value)} />
        </div>
        <div>
          <label htmlFor="xt-consignee">Consignee *</label>
          <select id="xt-consignee" value={form.consignee} onChange={(e) => setField('consignee', e.target.value)}>
            <option value="">Select consignee</option>
            {codeOptions(consignees, 'consignee_name', 'consignee_name')}
          </select>
        </div>
        <div>
          <label htmlFor="xt-destination">Destination *</label>
          <input id="xt-destination" value={form.destination} onChange={(e) => setField('destination', e.target.value)} />
        </div>
        <div>
          <label htmlFor="xt-country">Country *</label>
          <select id="xt-country" value={form.country} onChange={(e) => setField('country', e.target.value)}>
            <option value="">Select country</option>
            {COUNTRIES.map((country) => (
              <option key={country} value={country}>
                {country}
              </option>
            ))}
          </select>
        </div>
        <div className="full-width-field">
          <label htmlFor="xt-remarks">Remarks</label>
          <textarea id="xt-remarks" rows="2" value={form.remarks} onChange={(e) => setField('remarks', e.target.value)} />
        </div>

        <h4 className="dialog-section-title">Block volumes</h4>
        {editing ? (
          <>
            <div>
              <label htmlFor="xt-block">Block *</label>
              <select id="xt-block" value={form.block_code} onChange={(e) => setField('block_code', e.target.value)}>
                <option value="">Select block</option>
                {codeOptions(linkedBlocks, 'block_name', 'block_code')}
              </select>
            </div>
            <div>
              <label htmlFor="xt-volume">Volume *</label>
              <input
                id="xt-volume"
                type="number"
                step="0.01"
                min="0"
                value={form.volume}
                onChange={(e) => setField('volume', e.target.value)}
              />
            </div>
          </>
        ) : !form.entity_code ? (
          <div className="info-box">Select an entity to list its blocks.</div>
        ) : form.block_entries.length === 0 ? (
          <div className="warning-box">No blocks are mapped to this entity. Map blocks under Export Blocks.</div>
        ) : (
          <div className="table-scroll">
            <table className="compact-table">
              <thead>
                <tr>
                  <th>Block</th>
                  <th className="numeric">Volume</th>
                </tr>
              </thead>
              <tbody>
                {form.block_entries.map((entry, index) => (
                  <tr key={entry.block_code}>
                    <td>
                      {entry.block_name || entry.block_code}{' '}
                      <span className="muted-table-text">({entry.block_code})</span>
                    </td>
                    <td className="numeric">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={entry.volume}
                        onChange={(e) => updateBlockEntry(index, e.target.value)}
                        aria-label={`Volume for ${entry.block_code}`}
                        placeholder="0.00"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th>Total</th>
                  <th className="numeric">{fmt(blockTotal)}</th>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {permitIssues.length > 0 && (
          <div className="warning-box">
            <strong>Permit warning:</strong> the volume exceeds the remaining volume of permit {form.permit_number} for{' '}
            {permitIssues.map((issue) => issue.block_code).join(', ')}.
            <label className="inline-check">
              <input type="checkbox" checked={permitOverride} onChange={(e) => setPermitOverride(e.target.checked)} />
              Override and save anyway
            </label>
          </div>
        )}
      </FormDialog>
    </div>
  )
}

export default ExportTransactions
