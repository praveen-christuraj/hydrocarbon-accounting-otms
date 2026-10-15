import { useMemo, useState } from 'react'
import { createExportPermit, deleteExportPermit, updateExportPermit } from '../../api/exportOperationsApi'
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
  EXPORT_MODULE,
  QUARTERS,
  blocksForEntity,
  buildPermitQuarterValue,
  codeOptions,
  fmt,
  getCurrentQuarter,
  splitPermitQuarterValue,
  useExportPermissions,
  useExportReferenceData,
  yearOptions,
} from './exportShared'

const MODULE = 'Export Permits'
const PERMIT_STATUSES = ['Active', 'Expired', 'Inactive']

const COLUMNS = [
  { key: 'permit_number', label: 'Permit #' },
  { key: 'quarter', label: 'Quarter', type: 'select' },
  { key: 'location_label', label: 'Location', type: 'select' },
  { key: 'entity_label', label: 'Entity', type: 'select' },
  { key: 'block_list', label: 'Blocks' },
  { key: 'permit_volume', label: 'Permit Volume', type: 'number' },
  { key: 'used_volume', label: 'Used', type: 'number' },
  { key: 'remaining_volume', label: 'Remaining', type: 'number' },
  { key: 'usage_pct', label: 'Usage %', type: 'number' },
  { key: 'supplementary_permit', label: 'Supplementary', type: 'select' },
  { key: 'status', label: 'Status', type: 'select' },
  { key: 'remarks', label: 'Remarks' },
]

const newForm = () => ({
  permit_number: '',
  location_code: '',
  entity_code: '',
  block_codes: [],
  permit_quarter: getCurrentQuarter(),
  permit_year: new Date().getFullYear(),
  permit_volume: '',
  supplementary_permit: 'No',
  status: 'Active',
  remarks: '',
})

function ExportPermits({ loggedInUser }) {
  const confirm = useConfirm()
  const { canCreate, canEdit, canDelete } = useExportPermissions(loggedInUser, 'Export Permit')
  const reference = useExportReferenceData(['permits', 'locations', 'entities', 'blocks', 'entityBlocks'])
  const { permits, locations, entities, blocks, entityBlocks } = reference.data

  const [form, setForm] = useState(newForm)
  const [editing, setEditing] = useState(null)
  const [formOpen, setFormOpen] = useState(false)
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [page, setPage] = useState(1)
  const pageSize = usePageSize()

  const rows = useMemo(
    () =>
      permits.map((permit) => {
        const blockNames = permit.block_names?.length ? permit.block_names : [permit.block_name || permit.block_code]
        const volume = Number(permit.permit_volume || 0)
        return {
          ...permit,
          location_label: permit.location_name || permit.location_code,
          entity_label: permit.entity_name || permit.entity_code,
          block_list: blockNames.filter(Boolean).join(', '),
          usage_pct: volume ? Math.round((Number(permit.used_volume || 0) / volume) * 1000) / 10 : 0,
        }
      }),
    [permits]
  )
  const filters = useDataFilters(rows, COLUMNS, { module: MODULE })
  const visibleRows = paginateRows(filters.filteredRows, page, pageSize)

  const linkedBlocks = useMemo(
    () => blocksForEntity(blocks, entityBlocks, form.entity_code),
    [blocks, entityBlocks, form.entity_code]
  )

  const setField = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }))
    setFormError('')
  }

  const toggleBlock = (code) =>
    setForm((current) => ({
      ...current,
      block_codes: current.block_codes.includes(code)
        ? current.block_codes.filter((item) => item !== code)
        : [...current.block_codes, code],
    }))

  const openCreate = () => {
    setError('')
    setSuccess('')
    setEditing(null)
    setForm(newForm())
    setFormError('')
    setFormOpen(true)
    logUiAction(MODULE, 'Open Create Dialog')
  }

  const openEdit = (permit) => {
    setError('')
    setSuccess('')
    const parsed = splitPermitQuarterValue(permit.quarter)
    setEditing(permit)
    setForm({
      permit_number: permit.permit_number,
      location_code: permit.location_code,
      entity_code: permit.entity_code,
      block_codes: permit.block_codes?.length ? permit.block_codes : [permit.block_code].filter(Boolean),
      permit_quarter: parsed.quarter,
      permit_year: parsed.year,
      permit_volume: permit.permit_volume ?? '',
      supplementary_permit: permit.supplementary_permit || 'No',
      status: permit.status || 'Active',
      remarks: permit.remarks || '',
    })
    setFormError('')
    setFormOpen(true)
    logUiAction(MODULE, 'Open Edit Dialog', { permitNumber: permit.permit_number })
  }

  const closeForm = () => {
    setFormOpen(false)
    setEditing(null)
    setFormError('')
  }

  const handleSubmit = async () => {
    if (!(editing ? canEdit : canCreate)) {
      setFormError(`You do not have permission to ${editing ? 'edit' : 'create'} export permits.`)
      return
    }
    const missing = []
    if (!form.permit_number.trim()) missing.push('Permit #')
    if (!form.location_code) missing.push('Location')
    if (!form.entity_code) missing.push('Entity')
    if (!form.block_codes.length) missing.push('at least one Block')
    if (!form.permit_quarter || !form.permit_year) missing.push('Quarter and Year')
    if (missing.length) {
      setFormError(`Required: ${missing.join(', ')}.`)
      return
    }
    if (!(Number(form.permit_volume) > 0)) {
      setFormError('Permit volume must be greater than zero.')
      return
    }
    const payload = {
      permit_number: form.permit_number.trim(),
      location_code: form.location_code,
      entity_code: form.entity_code,
      block_code: form.block_codes[0],
      block_codes: form.block_codes,
      quarter: buildPermitQuarterValue(form.permit_quarter, form.permit_year),
      permit_volume: Number(form.permit_volume),
      supplementary_permit: form.supplementary_permit,
      status: form.status,
      remarks: form.remarks.trim() || null,
    }
    try {
      setSaving(true)
      if (editing) await updateExportPermit(editing.id, payload)
      else await createExportPermit(payload)
      setSuccess(`Permit ${payload.permit_number} ${editing ? 'updated' : 'created'}.`)
      closeForm()
      await reference.reload()
    } catch (err) {
      setFormError(err.message || 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (permit) => {
    setError('')
    setSuccess('')
    const confirmed = await confirm({
      title: 'Delete permit',
      message: `Delete permit ${permit.permit_number} (${permit.quarter})?`,
      tone: 'danger',
      confirmLabel: 'Delete',
      module: EXPORT_MODULE,
    })
    if (!confirmed) return
    try {
      await deleteExportPermit(permit.id)
      setSuccess(`Permit ${permit.permit_number} deleted.`)
      await reference.reload()
    } catch (err) {
      setError(err.message)
    }
  }

  const importConfig = {
    title: 'Bulk upload export permits',
    description: 'One row per permit and block. Quarter is Q1–Q4 and Year is four digits.',
    fields: [
      { key: 'permit_number', label: 'Permit Number', required: true, example: 'PERMIT-001' },
      { key: 'location_code', label: 'Location Code', required: true, example: locations[0]?.location_code || 'LOC001' },
      { key: 'entity_code', label: 'Entity Code', required: true, example: entities[0]?.entity_code || 'ENT001' },
      { key: 'block_code', label: 'Block Code', required: true, example: blocks[0]?.block_code || 'BLK001' },
      { key: 'quarter', label: 'Quarter', required: true, options: QUARTERS, example: 'Q1' },
      { key: 'year', label: 'Year', required: true, example: String(new Date().getFullYear()) },
      { key: 'permit_volume', label: 'Permit Volume', required: true, example: '10000' },
      { key: 'supplementary_permit', label: 'Supplementary', options: ['No', 'Yes'], defaultValue: 'No', example: 'No' },
      { key: 'status', label: 'Status', options: PERMIT_STATUSES, defaultValue: 'Active', example: 'Active' },
      { key: 'remarks', label: 'Remarks', example: '' },
    ],
    validateRow: (record) => {
      if (permits.some((permit) => permit.permit_number === record.permit_number)) return 'Permit number already exists'
      if (!locations.some((item) => item.location_code === record.location_code)) return `Unknown location code ${record.location_code}`
      if (!entities.some((item) => item.entity_code === record.entity_code)) return `Unknown entity code ${record.entity_code}`
      if (!blocksForEntity(blocks, entityBlocks, record.entity_code).some((block) => block.block_code === record.block_code)) {
        return `Block ${record.block_code} is not mapped to entity ${record.entity_code}`
      }
      if (!QUARTERS.includes(String(record.quarter || '').toUpperCase())) return 'Quarter must be Q1, Q2, Q3 or Q4'
      if (!/^\d{4}$/.test(String(record.year || ''))) return 'Year must be four digits'
      if (!(Number(record.permit_volume) > 0)) return 'Permit volume must be a positive number'
      return null
    },
    onImportRow: async (record) => {
      await createExportPermit({
        permit_number: record.permit_number,
        location_code: record.location_code,
        entity_code: record.entity_code,
        block_code: record.block_code,
        block_codes: [record.block_code],
        quarter: buildPermitQuarterValue(String(record.quarter).toUpperCase(), record.year),
        permit_volume: Number(record.permit_volume),
        supplementary_permit: record.supplementary_permit || 'No',
        status: record.status || 'Active',
        remarks: record.remarks || null,
      })
    },
    onComplete: async () => {
      await reference.reload()
    },
  }

  const showActions = canEdit || canDelete

  return (
    <div className="export-operations-page">
      <PageHeader
        title="Export Permits"
        description="Quarterly export permits per location, entity and block, with used and remaining volume."
        count={`${permits.length} Permits`}
        actions={
          canCreate && (
            <button type="button" className="btn-primary" onClick={openCreate}>
              <Icon name="plus" size={15} />
              New Permit
            </button>
          )
        }
      />

      <AlertMessage tone="success" message={success} onDismiss={() => setSuccess('')} />
      <AlertMessage tone="error" message={error || reference.error} onDismiss={() => setError('')} />
      {!canCreate && !canEdit && !canDelete && (
        <div className="info-box">You have view-only access to export permits.</div>
      )}

      <DataTableToolbar
        filters={filters}
        columns={COLUMNS}
        exportFileName="export-permits"
        exportTitle="Export Permits"
        module={MODULE}
        importConfig={importConfig}
        canImport={canCreate}
        searchPlaceholder="Search permits…"
      />

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Permit #</th>
              <th>Quarter</th>
              <th>Location</th>
              <th>Entity</th>
              <th>Blocks</th>
              <th className="numeric">Permit Vol.</th>
              <th className="numeric">Used</th>
              <th className="numeric">Remaining</th>
              <th className="numeric">Usage</th>
              <th>Suppl.</th>
              <th>Status</th>
              <th>Remarks</th>
              {showActions && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 ? (
              <tr>
                <td colSpan={showActions ? 13 : 12} className="empty-table">
                  {reference.loading ? 'Loading…' : permits.length === 0 ? 'No permits yet.' : 'No permits match the filters.'}
                </td>
              </tr>
            ) : (
              visibleRows.map((permit) => (
                <tr key={permit.id}>
                  <td><strong className="cell-strong">{permit.permit_number}</strong></td>
                  <td>{permit.quarter}</td>
                  <td>{permit.location_label}</td>
                  <td>{permit.entity_label}</td>
                  <td>{permit.block_list}</td>
                  <td className="numeric">{fmt(permit.permit_volume)}</td>
                  <td className="numeric">{fmt(permit.used_volume)}</td>
                  <td className="numeric">{fmt(permit.remaining_volume)}</td>
                  <td className="numeric">{fmt(permit.usage_pct, 1)}%</td>
                  <td>{permit.supplementary_permit}</td>
                  <td>
                    <span className={`status-badge ${String(permit.status || '').toLowerCase()}`}>{permit.status}</span>
                  </td>
                  <td className="cell-wrap">{permit.remarks || '—'}</td>
                  {showActions && (
                    <td className="row-actions">
                      {canEdit && (
                        <button type="button" onClick={() => openEdit(permit)}>
                          Edit
                        </button>
                      )}
                      {canDelete && (
                        <button type="button" onClick={() => handleDelete(permit)}>
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
        title={editing ? `Edit Permit ${editing.permit_number}` : 'New Permit'}
        size="lg"
        columns={3}
        submitLabel={editing ? 'Update Permit' : 'Save Permit'}
        busy={saving}
        error={formError}
        onDismissError={() => setFormError('')}
        onSubmit={handleSubmit}
        onCancel={closeForm}
      >
        <div>
          <label htmlFor="xp-number">Permit # *</label>
          <input id="xp-number" value={form.permit_number} onChange={(e) => setField('permit_number', e.target.value)} />
        </div>
        <div>
          <label htmlFor="xp-location">Location *</label>
          <select id="xp-location" value={form.location_code} onChange={(e) => setField('location_code', e.target.value)}>
            <option value="">Select location</option>
            {codeOptions(locations, 'location_name', 'location_code')}
          </select>
        </div>
        <div>
          <label htmlFor="xp-entity">Entity *</label>
          <select
            id="xp-entity"
            value={form.entity_code}
            onChange={(e) => setForm((current) => ({ ...current, entity_code: e.target.value, block_codes: [] }))}
          >
            <option value="">Select entity</option>
            {codeOptions(entities, 'entity_name', 'entity_code')}
          </select>
        </div>
        <fieldset className="full-width-field checkbox-chip-group">
          <legend>Blocks * (tick all that the permit covers)</legend>
          {!form.entity_code ? (
            <span className="field-hint">Select an entity to list its blocks.</span>
          ) : linkedBlocks.length === 0 ? (
            <span className="field-hint">No blocks are mapped to this entity.</span>
          ) : (
            linkedBlocks.map((block) => {
              const checked = form.block_codes.includes(block.block_code)
              return (
                <label key={block.block_code} className={`checkbox-chip ${checked ? 'is-checked' : ''}`.trim()}>
                  <input type="checkbox" checked={checked} onChange={() => toggleBlock(block.block_code)} />
                  {block.block_name} ({block.block_code})
                </label>
              )
            })
          )}
        </fieldset>
        <div>
          <label htmlFor="xp-quarter">Quarter *</label>
          <select id="xp-quarter" value={form.permit_quarter} onChange={(e) => setField('permit_quarter', e.target.value)}>
            {QUARTERS.map((quarter) => (
              <option key={quarter} value={quarter}>
                {quarter}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="xp-year">Year *</label>
          <select id="xp-year" value={form.permit_year} onChange={(e) => setField('permit_year', e.target.value)}>
            {yearOptions().map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="xp-volume">Permit Volume *</label>
          <input
            id="xp-volume"
            type="number"
            step="0.01"
            min="0"
            value={form.permit_volume}
            onChange={(e) => setField('permit_volume', e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="xp-supplementary">Supplementary</label>
          <select
            id="xp-supplementary"
            value={form.supplementary_permit}
            onChange={(e) => setField('supplementary_permit', e.target.value)}
          >
            <option value="No">No</option>
            <option value="Yes">Yes</option>
          </select>
        </div>
        <div>
          <label htmlFor="xp-status">Status</label>
          <select id="xp-status" value={form.status} onChange={(e) => setField('status', e.target.value)}>
            {PERMIT_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </div>
        <div className="full-width-field">
          <label htmlFor="xp-remarks">Remarks</label>
          <textarea id="xp-remarks" rows="2" value={form.remarks} onChange={(e) => setField('remarks', e.target.value)} />
        </div>
      </FormDialog>
    </div>
  )
}

export default ExportPermits
