import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  addMovementMappingItems,
  closeMovementMapping,
  createMovementMapping,
  deleteMovementMapping,
  getMovementMapping,
  getMovementMappings,
  removeMovementMappingItem,
  restoreMovementMapping,
  updateMovementMapping,
} from '../api/movementMappingApi'
import { getTripTimelineByConvoy } from '../api/bargeTrackingApi'
import { getOperationTransactions } from '../api/operationTransactionApi'
import { usePermissions } from '../hooks/usePermissions'
import AlertMessage from '../components/common/AlertMessage'
import Modal from '../components/common/Modal'
import useActionFeedback from '../hooks/useActionFeedback'
import { logUiAction } from '../utils/actionLogger'

const MAPPING_TYPES = [
  { value: 'BARGE_TO_SHUTTLE', label: 'Barge → Shuttle' },
  { value: 'SHUTTLE_TO_FSO', label: 'Shuttle → FSO' },
  { value: 'BARGE_TO_FSO', label: 'Barge → FSO' },
]

const MAPPING_TABS = [
  { value: 'PENDING', label: 'Pending mappings' },
  { value: 'MAPPED', label: 'Mapped movements' },
  { value: 'CLOSED', label: 'Closed' },
  { value: 'DELETED', label: 'Deleted / archived' },
]

const emptyMappingForm = {
  mapping_type: 'BARGE_TO_SHUTTLE',
  location_code: '',
  reference_number: '',
  product_name: '',
  remarks: '',
}

const formatNumber = (value, decimals = 3) => {
  if (value === null || value === undefined || String(value).trim() === '') return '-'
  const number = Number(value)
  if (!Number.isFinite(number)) return '-'
  return number.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

const formatDate = (value) => {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString()
}

const mappingTypeLabel = (value) =>
  MAPPING_TYPES.find((item) => item.value === value)?.label || value || '-'

const getItemCounts = (mapping) => {
  const items = Array.isArray(mapping?.items) ? mapping.items : []
  return {
    source: items.filter((item) => String(item.role || '').toUpperCase() === 'SOURCE').length,
    target: items.filter((item) => String(item.role || '').toUpperCase() === 'TARGET').length,
  }
}

const getMappingProgress = (mapping) => {
  const { source, target } = getItemCounts(mapping)
  if (source > 0 && target > 0) return 'Mapped'
  if (source === 0 && target === 0) return 'Waiting for source and target'
  if (source === 0) return 'Waiting for source'
  return 'Waiting for target'
}

const locationDisplay = (locationCode, locations) => {
  const location = locations.find((item) => String(item.locationCode || item.location_code) === String(locationCode))
  return location ? `${location.locationName || location.location_name} (${locationCode})` : locationCode || '-'
}

const getQuery = (search) => {
  const params = new URLSearchParams(search || '')
  return {
    mapping_type: params.get('mapping_type') || '',
    location_code: params.get('location_code') || '',
    reference_number: params.get('reference_number') || '',
    status: params.get('status') || '',
    auto_suggest: params.get('auto_suggest') || '1',
  }
}

function MappingFormFields({ form, setForm, locations, hasItems = false }) {
  const onChange = (event) => {
    const { name, value } = event.target
    setForm((current) => ({ ...current, [name]: value }))
  }

  return (
    <div className="mapping-form-grid">
      <div>
        <label htmlFor="mapping-type">Movement pathway *</label>
        <select
          id="mapping-type"
          name="mapping_type"
          value={form.mapping_type}
          onChange={onChange}
          disabled={hasItems}
        >
          {MAPPING_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
        {hasItems && <span className="field-help">Remove attached tickets before changing the pathway.</span>}
      </div>
      <div>
        <label htmlFor="mapping-location">Location *</label>
        <select id="mapping-location" name="location_code" value={form.location_code} onChange={onChange} disabled={hasItems}>
          <option value="">Select a location</option>
          {locations.map((location) => (
            <option key={location.id || location.locationCode} value={location.locationCode || location.location_code}>
              {location.locationName || location.location_name} ({location.locationCode || location.location_code})
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="mapping-reference">Reference / voyage number *</label>
        <input id="mapping-reference" name="reference_number" value={form.reference_number} onChange={onChange} placeholder="Shuttle number, convoy or voyage" />
      </div>
      <div>
        <label htmlFor="mapping-product">Product</label>
        <input id="mapping-product" name="product_name" value={form.product_name} onChange={onChange} placeholder="Optional" />
      </div>
      <div className="mapping-form-wide">
        <label htmlFor="mapping-remarks">Remarks</label>
        <textarea id="mapping-remarks" name="remarks" rows="3" value={form.remarks} onChange={onChange} placeholder="Optional mapping notes" />
      </div>
    </div>
  )
}

function MovementMapping({ locations = [], loggedInUser }) {
  const location = useLocation()
  const { hasPermission } = usePermissions(loggedInUser)
  const canCreate = hasPermission('Create Movement Mapping')
  const canEdit = hasPermission('Edit Movement Mapping')
  const canClose = hasPermission('Close Movement Mapping')
  const canViewTransactions = hasPermission('View Operation Transaction')

  const feedback = useActionFeedback()
  const { notifySuccess, notifyError, clearSuccess, clearError } = feedback
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState('PENDING')
  const [filters, setFilters] = useState({ mapping_type: '', location_code: '', reference_number: '', status: '' })
  const [mappings, setMappings] = useState([])
  const [selectedMapping, setSelectedMapping] = useState(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [formMode, setFormMode] = useState('create')
  const [mappingForm, setMappingForm] = useState(emptyMappingForm)
  const [confirmAction, setConfirmAction] = useState(null)

  const [convoyNumber, setConvoyNumber] = useState('')
  const [bargeUnloadCandidates, setBargeUnloadCandidates] = useState([])
  const [selectedSourceTxIds, setSelectedSourceTxIds] = useState([])
  const [sourceSearch, setSourceSearch] = useState({ locationCode: '', assetCode: '', searchText: '' })
  const [sourceCandidates, setSourceCandidates] = useState([])
  const [selectedGenericSourceIds, setSelectedGenericSourceIds] = useState([])
  const [targetSearch, setTargetSearch] = useState({ locationCode: '', assetCode: '', searchText: '' })
  const [targetCandidates, setTargetCandidates] = useState([])
  const [selectedTargetTxIds, setSelectedTargetTxIds] = useState([])

  const loadList = useCallback(async () => {
    setLoading(true)
    try {
      const data = await getMovementMappings({
        ...filters,
        archived: activeTab === 'DELETED',
      })
      setMappings(Array.isArray(data) ? data : [])
    } catch (error) {
      notifyError(error.message || 'Unable to load movement mappings')
    } finally {
      setLoading(false)
    }
  }, [activeTab, filters, notifyError])

  useEffect(() => {
    const timeout = window.setTimeout(loadList, 200)
    return () => window.clearTimeout(timeout)
  }, [loadList])


  const onFilterChange = (event) => {
    const { name, value } = event.target
    setFilters((current) => ({ ...current, [name]: value }))
    if (feedback.errorMsg) clearError()
  }

  const openCreateForm = () => {
    setActiveTab('PENDING')
    setFilters((current) => ({ ...current, status: '' }))
    setFormMode('create')
    setMappingForm({ ...emptyMappingForm, ...filters, status: '', mapping_type: filters.mapping_type || 'BARGE_TO_SHUTTLE' })
    setFormOpen(true)
  }

  const openEditForm = async (mapping) => {
    try {
      setLoading(true)
      const freshMapping = await getMovementMapping(mapping.id)
      setSelectedMapping(freshMapping)
      setFormMode('edit')
      setMappingForm({
        mapping_type: freshMapping.mapping_type || 'BARGE_TO_SHUTTLE',
        location_code: freshMapping.location_code || '',
        reference_number: freshMapping.reference_number || '',
        product_name: freshMapping.product_name || '',
        remarks: freshMapping.remarks || '',
      })
      setFormOpen(true)
    } catch (error) {
      notifyError(error.message || 'Unable to open mapping for editing')
    } finally {
      setLoading(false)
    }
  }

  const submitMappingForm = async () => {
    const payload = {
      mapping_type: mappingForm.mapping_type,
      location_code: mappingForm.location_code,
      reference_number: mappingForm.reference_number.trim(),
      product_name: mappingForm.product_name.trim() || null,
      remarks: mappingForm.remarks.trim() || null,
    }
    if (!payload.location_code || !payload.reference_number) {
      notifyError('Select a location and enter a reference number')
      return
    }
    if (!canCreate && formMode === 'create') {
      notifyError('You do not have permission to create movement mappings')
      return
    }
    if (!canEdit && formMode === 'edit') {
      notifyError('You do not have permission to edit movement mappings')
      return
    }

    setLoading(true)
    try {
      if (formMode === 'create') {
        const created = await createMovementMapping(payload)
        setSelectedMapping(created)
        setDetailOpen(true)
        notifySuccess('Movement mapping created.')
        logUiAction('Movement Mapping', 'Create Mapping', { mappingId: created.id, mappingType: created.mapping_type })
      } else if (selectedMapping) {
        const updated = await updateMovementMapping(selectedMapping.id, payload)
        setSelectedMapping(updated)
        notifySuccess('Movement mapping details updated.')
        logUiAction('Movement Mapping', 'Edit Mapping', { mappingId: updated.id })
      }
      setFormOpen(false)
      await loadList()
    } catch (error) {
      notifyError(error.message || `Unable to ${formMode === 'create' ? 'create' : 'update'} mapping`)
    } finally {
      setLoading(false)
    }
  }

  const openMapping = async (mapping) => {
    setDetailOpen(true)
    setSelectedMapping(mapping)
    setSelectedSourceTxIds([])
    setSelectedGenericSourceIds([])
    setSelectedTargetTxIds([])
    clearError()
    try {
      setLoading(true)
      const freshMapping = await getMovementMapping(mapping.id)
      setSelectedMapping(freshMapping)
      setConvoyNumber((current) => current || freshMapping.reference_number || '')
      logUiAction('Movement Mapping', 'View Mapping', { mappingId: mapping.id })
    } catch (error) {
      notifyError(error.message || 'Unable to load mapping details')
    } finally {
      setLoading(false)
    }
  }

  const loadBargeUnloads = async (convoyOverride) => {
    const convoy = String(convoyOverride ?? convoyNumber ?? '').trim()
    if (!convoy) {
      notifyError('Enter a convoy number to load approved Barge UNLOAD tickets')
      return
    }

    setLoading(true)
    try {
      const timeline = await getTripTimelineByConvoy(convoy)
      const rowsByTransaction = new Map()
      for (const event of Array.isArray(timeline?.events) ? timeline.events : []) {
        if (String(event.event_type || '').toUpperCase() !== 'UNLOAD' || !event.operation_transaction_id) continue
        if (String(event.ticket_status || '').toUpperCase() !== 'APPROVED') continue
        rowsByTransaction.set(String(event.operation_transaction_id), {
          key: `${event.asset_code}-${event.operation_transaction_id}`,
          asset_code: event.asset_code || '',
          asset_name: event.asset_name || '',
          location_code: event.location_code || '',
          event_datetime: event.event_datetime || '',
          ticket_number: event.ticket_number || '',
          transaction_id: Number(event.operation_transaction_id),
        })
      }
      setBargeUnloadCandidates([...rowsByTransaction.values()])
      setSelectedSourceTxIds([])
      if (rowsByTransaction.size === 0) notifySuccess('No approved UNLOAD transactions were found for that convoy.')
    } catch (error) {
      notifyError(error.message || 'Unable to load Barge UNLOAD candidates')
    } finally {
      setLoading(false)
    }
  }

  const searchApprovedTransactions = async (role, overrides = {}) => {
    const searchState = role === 'SOURCE' ? sourceSearch : targetSearch
    const query = {
      status: 'Approved',
      locationCode: overrides.locationCode ?? searchState.locationCode,
      assetCode: overrides.assetCode ?? searchState.assetCode,
      searchText: overrides.searchText ?? searchState.searchText,
      limit: 200,
    }
    setLoading(true)
    try {
      const results = await getOperationTransactions(query)
      if (role === 'SOURCE') {
        setSourceCandidates(results)
        setSelectedGenericSourceIds([])
      } else {
        setTargetCandidates(results)
        setSelectedTargetTxIds([])
      }
    } catch (error) {
      notifyError(error.message || `Unable to search approved ${role.toLowerCase()} transactions`)
    } finally {
      setLoading(false)
    }
  }

  const autoSuggestBargeAndTarget = async () => {
    await loadBargeUnloads()
    await searchApprovedTransactions('TARGET')
  }

  const autoSuggestSourceAndTarget = async () => {
    await searchApprovedTransactions('SOURCE')
    await searchApprovedTransactions('TARGET')
  }

  useEffect(() => {
    const timeout = window.setTimeout(() => {
    const query = getQuery(location.search)
    const hasQueryFilters = query.mapping_type || query.location_code || query.reference_number || query.status
    if (!hasQueryFilters) return

    setFilters((current) => ({
      ...current,
      mapping_type: query.mapping_type,
      location_code: query.location_code,
      reference_number: query.reference_number,
      status: query.status,
    }))
    setMappingForm((current) => ({
      ...current,
      mapping_type: query.mapping_type || current.mapping_type || 'BARGE_TO_SHUTTLE',
      location_code: query.location_code || current.location_code,
      reference_number: query.reference_number || current.reference_number,
    }))
    setConvoyNumber(query.reference_number || '')
    setSourceSearch((current) => ({
      ...current,
      locationCode: query.location_code || current.locationCode,
      searchText: query.reference_number || current.searchText,
    }))
    setTargetSearch((current) => ({
      ...current,
      locationCode: query.location_code || current.locationCode,
      searchText: query.reference_number || current.searchText,
    }))

    if (String(query.auto_suggest) !== '0' && query.reference_number) {
      loadBargeUnloads(query.reference_number)
      searchApprovedTransactions('TARGET', {
        locationCode: query.location_code,
        searchText: query.reference_number,
      })
    }
    // The linked mapping page intentionally turns URL data into convenient
    // filters and candidate searches; it does not auto-create or alter maps.
    }, 0)
    return () => window.clearTimeout(timeout)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search])


  const addItems = async (role, transactionIds) => {
    if (!canEdit) {
      notifyError('You do not have permission to edit movement mappings')
      return
    }
    if (!selectedMapping) {
      notifyError('Open a mapping before attaching tickets')
      return
    }
    if (selectedMapping.status === 'CLOSED' || selectedMapping.archived_at) {
      notifyError('Closed or deleted mappings are read-only')
      return
    }
    if (!transactionIds?.length) {
      notifyError('Select at least one approved ticket')
      return
    }

    setLoading(true)
    try {
      const updated = await addMovementMappingItems(selectedMapping.id, {
        role,
        transaction_ids: transactionIds,
      })
      setSelectedMapping(updated)
      setSelectedSourceTxIds([])
      setSelectedGenericSourceIds([])
      setSelectedTargetTxIds([])
      notifySuccess(`${transactionIds.length} ${role.toLowerCase()} ticket${transactionIds.length === 1 ? '' : 's'} processed.`)
      logUiAction('Movement Mapping', 'Add Tickets', { mappingId: updated.id, role, transactionIds })
      await loadList()
    } catch (error) {
      notifyError(error.message || 'Unable to attach selected tickets')
    } finally {
      setLoading(false)
    }
  }

  const requestRemoveItem = (item) => {
    setConfirmAction({
      type: 'remove-item',
      item,
      title: 'Remove ticket from mapping?',
      message: `Remove ${item.ticket_number || `transaction #${item.transaction_id}`} from this mapping? The comparison totals will be recalculated.`,
    })
  }

  const requestDeleteMapping = (mapping) => {
    setConfirmAction({
      type: 'archive-mapping',
      mapping,
      title: 'Delete this mapping?',
      message: 'The mapping will be removed from active lists, but all attached tickets and comparison history will be preserved. You can restore it from the Deleted / archived tab.',
    })
  }

  const requestCloseMapping = () => {
    if (!selectedMapping) return
    setConfirmAction({
      type: 'close-mapping',
      mapping: selectedMapping,
      title: 'Close this mapping?',
      message: 'The mapping becomes read-only after closing. You can still view and print its saved comparison.',
    })
  }

  const executeConfirmedAction = async () => {
    if (!confirmAction) return
    const action = confirmAction
    setConfirmAction(null)
    setLoading(true)
    try {
      if (action.type === 'remove-item') {
        if (!canEdit || !selectedMapping) throw new Error('You do not have permission to edit this mapping')
        const updated = await removeMovementMappingItem(selectedMapping.id, action.item.id)
        setSelectedMapping(updated)
        notifySuccess('Ticket removed and comparison recalculated.')
      } else if (action.type === 'archive-mapping') {
        if (!canEdit) throw new Error('You do not have permission to delete movement mappings')
        const updated = await deleteMovementMapping(action.mapping.id)
        setSelectedMapping(updated)
        setDetailOpen(false)
        setActiveTab('DELETED')
        notifySuccess('Mapping deleted safely. Its tickets and comparison history were preserved.')
        logUiAction('Movement Mapping', 'Delete Mapping (Archived)', { mappingId: updated.id })
      } else if (action.type === 'close-mapping') {
        if (!canClose || !selectedMapping) throw new Error('You do not have permission to close movement mappings')
        const updated = await closeMovementMapping(selectedMapping.id)
        setSelectedMapping(updated)
        notifySuccess('Mapping closed and set to read-only.')
        logUiAction('Movement Mapping', 'Close Mapping', { mappingId: updated.id })
      }
      await loadList()
    } catch (error) {
      notifyError(error.message || 'The requested mapping action could not be completed')
    } finally {
      setLoading(false)
    }
  }

  const restoreMapping = async (mapping) => {
    if (!canEdit) {
      notifyError('You do not have permission to restore deleted movement mappings')
      return
    }
    setLoading(true)
    try {
      const restored = await restoreMovementMapping(mapping.id)
      setSelectedMapping(restored)
      setDetailOpen(true)
      setFilters((current) => ({ ...current, status: '' }))
      const restoredTab = String(restored.status || '').toUpperCase() === 'CLOSED'
        ? 'CLOSED'
        : getItemCounts(restored).source > 0 && getItemCounts(restored).target > 0
          ? 'MAPPED'
          : 'PENDING'
      setActiveTab(restoredTab)
      notifySuccess('Mapping restored with its original ticket and comparison history.')
      logUiAction('Movement Mapping', 'Restore Mapping', { mappingId: restored.id })
      await loadList()
    } catch (error) {
      notifyError(error.message || 'Unable to restore movement mapping')
    } finally {
      setLoading(false)
    }
  }

  const sourceItems = useMemo(
    () => (selectedMapping?.items || []).filter((item) => String(item.role || '').toUpperCase() === 'SOURCE'),
    [selectedMapping]
  )
  const targetItems = useMemo(
    () => (selectedMapping?.items || []).filter((item) => String(item.role || '').toUpperCase() === 'TARGET'),
    [selectedMapping]
  )

  const visibleMappings = useMemo(() => mappings.filter((mapping) => {
    const archived = Boolean(mapping.archived_at)
    const status = String(mapping.status || '').toUpperCase()
    if (activeTab === 'DELETED') return archived
    if (archived) return false
    if (activeTab === 'CLOSED') return status === 'CLOSED'
    if (status === 'CLOSED') return false
    const counts = getItemCounts(mapping)
    if (activeTab === 'MAPPED') return counts.source > 0 && counts.target > 0
    return counts.source === 0 || counts.target === 0
  }), [activeTab, mappings])

  const tabCounts = useMemo(() => {
    if (activeTab === 'DELETED') return { DELETED: mappings.filter((mapping) => Boolean(mapping.archived_at)).length }
    const active = mappings.filter((mapping) => !mapping.archived_at)
    return {
      PENDING: active.filter((mapping) => String(mapping.status).toUpperCase() !== 'CLOSED' && (getItemCounts(mapping).source === 0 || getItemCounts(mapping).target === 0)).length,
      MAPPED: active.filter((mapping) => String(mapping.status).toUpperCase() !== 'CLOSED' && getItemCounts(mapping).source > 0 && getItemCounts(mapping).target > 0).length,
      CLOSED: active.filter((mapping) => String(mapping.status).toUpperCase() === 'CLOSED').length,
    }
  }, [activeTab, mappings])

  const selectedMappingArchived = Boolean(selectedMapping?.archived_at)
  const selectedMappingClosed = String(selectedMapping?.status || '').toUpperCase() === 'CLOSED'
  const canEditSelected = canEdit && selectedMapping && !selectedMappingArchived && !selectedMappingClosed
  const isBargeSourcePath = ['BARGE_TO_SHUTTLE', 'BARGE_TO_FSO'].includes(selectedMapping?.mapping_type)
  const attachedTransactionIds = new Set((selectedMapping?.items || []).map((item) => Number(item.transaction_id)))
  const visibleBargeCandidates = bargeUnloadCandidates.filter((candidate) => !attachedTransactionIds.has(Number(candidate.transaction_id)))
  const visibleGenericSourceCandidates = sourceCandidates.filter((candidate) => !attachedTransactionIds.has(Number(candidate.id)))
  const visibleTargetCandidates = targetCandidates.filter((candidate) => !attachedTransactionIds.has(Number(candidate.id)))

  return (
    <div className="movement-mapping-page">
      <div className="page-title">
        <div>
          <h2>Movement Mapping</h2>
          <p>Match approved movements across Barge → Shuttle and Shuttle → FSO handoffs, then compare recorded volumes.</p>
        </div>
        <div className="mapping-title-actions">
          <span className="record-count">{visibleMappings.length} {activeTab === 'DELETED' ? 'Archived' : 'Mappings'}</span>
          {canCreate && <button type="button" onClick={openCreateForm}>Create Mapping</button>}
        </div>
      </div>

      <AlertMessage tone="success" message={feedback.successMsg} onDismiss={clearSuccess} />
      <AlertMessage tone="error" message={feedback.errorMsg} onDismiss={clearError} />

      {!canCreate && !canEdit && !canClose && (
        <div className="info-box">You have view-only access. Assign <strong>Create Movement Mapping</strong>, <strong>Edit Movement Mapping</strong> or <strong>Close Movement Mapping</strong> for the corresponding actions.</div>
      )}

      <div className="mapping-summary-cards">
        <div><span>Pending</span><strong>{tabCounts.PENDING ?? '—'}</strong><small>Needs a source or target ticket</small></div>
        <div><span>Mapped</span><strong>{tabCounts.MAPPED ?? '—'}</strong><small>Both sides have at least one ticket</small></div>
        <div><span>Closed</span><strong>{tabCounts.CLOSED ?? '—'}</strong><small>Read-only reconciliations</small></div>
        <div><span>Deleted / archived</span><strong>{tabCounts.DELETED ?? '—'}</strong><small>History retained and recoverable</small></div>
      </div>

      <div className="list-tabs movement-mapping-tabs" role="tablist" aria-label="Movement mapping status">
        {MAPPING_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.value}
            className="list-tab"
            onClick={() => setActiveTab(tab.value)}
          >
            {tab.label}
            <span className="list-tab-count">{tabCounts[tab.value] ?? 0}</span>
          </button>
        ))}
      </div>

      <section className="mapping-filter-card">
        <div className="mapping-filter-header">
          <div><strong>Find a movement mapping</strong><span>Filter by pathway, location, status or reference.</span></div>
          <button type="button" className="btn-secondary" onClick={loadList} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>
        </div>
        <div className="mapping-filter-grid">
          <div>
            <label htmlFor="filter-mapping-type">Pathway</label>
            <select id="filter-mapping-type" name="mapping_type" value={filters.mapping_type} onChange={onFilterChange}>
              <option value="">All pathways</option>
              {MAPPING_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="filter-mapping-location">Location</label>
            <select id="filter-mapping-location" name="location_code" value={filters.location_code} onChange={onFilterChange}>
              <option value="">All locations</option>
              {locations.map((item) => <option key={item.id || item.locationCode} value={item.locationCode || item.location_code}>{item.locationName || item.location_name} ({item.locationCode || item.location_code})</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="filter-mapping-status">Record status</label>
            <select id="filter-mapping-status" name="status" value={filters.status} onChange={onFilterChange}>
              <option value="">All</option><option value="OPEN">Open</option><option value="CLOSED">Closed</option>
            </select>
          </div>
          <div className="mapping-reference-filter">
            <label htmlFor="filter-mapping-reference">Reference</label>
            <input id="filter-mapping-reference" name="reference_number" value={filters.reference_number} onChange={onFilterChange} placeholder="Shuttle / convoy / voyage" />
          </div>
        </div>
      </section>

      <section className="mapping-list-card">
        <div className="mapping-list-heading">
          <div><h3>{MAPPING_TABS.find((tab) => tab.value === activeTab)?.label}</h3><p>{activeTab === 'PENDING' ? 'Open a pending mapping to attach its missing movement tickets.' : activeTab === 'MAPPED' ? 'Review source and target tickets with the latest quantity comparison.' : activeTab === 'CLOSED' ? 'Closed mappings are preserved as read-only records.' : 'Deleted mappings are soft-deleted and can be restored.'}</p></div>
          <span className="mapping-result-count">{visibleMappings.length} result{visibleMappings.length === 1 ? '' : 's'}</span>
        </div>
        <div className="mapping-table-scroll">
          <table className="movement-mapping-table">
            <thead><tr><th>Pathway</th><th>Location</th><th>Reference</th><th>Product</th><th>Progress</th><th>Tickets</th><th>Status</th><th>Updated</th><th>Actions</th></tr></thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="9" className="empty-table">Loading movement mappings…</td></tr>
              ) : visibleMappings.length === 0 ? (
                <tr><td colSpan="9" className="empty-table">No mappings found in this tab. Create a mapping or adjust the filters.</td></tr>
              ) : visibleMappings.map((mapping) => {
                const counts = getItemCounts(mapping)
                const archived = Boolean(mapping.archived_at)
                const statusLabel = archived ? 'Deleted' : String(mapping.status || '').toUpperCase() === 'CLOSED' ? 'Closed' : 'Open'
                return (
                  <tr key={mapping.id}>
                    <td><strong>{mappingTypeLabel(mapping.mapping_type)}</strong></td>
                    <td>{locationDisplay(mapping.location_code, locations)}</td>
                    <td><strong>{mapping.reference_number}</strong></td>
                    <td>{mapping.product_name || '-'}</td>
                    <td><span className={`mapping-progress ${getMappingProgress(mapping) === 'Mapped' ? 'complete' : 'pending'}`}>{archived ? 'Archived' : getMappingProgress(mapping)}</span></td>
                    <td><span className="mapping-ticket-counts">{counts.source} source · {counts.target} target</span></td>
                    <td><span className={`status-badge ${statusLabel.toLowerCase()}`}>{statusLabel}</span></td>
                    <td>{formatDate(mapping.updated_at || mapping.created_at)}</td>
                    <td>
                      <div className="mapping-row-actions">
                        <button type="button" className="btn-secondary" onClick={() => openMapping(mapping)} disabled={loading}>View</button>
                        {archived ? (
                          <button type="button" onClick={() => restoreMapping(mapping)} disabled={!canEdit || loading} title={!canEdit ? 'Requires Edit Movement Mapping permission' : 'Restore this mapping'}>Restore</button>
                        ) : (
                          <>
                            <button type="button" className="btn-secondary" onClick={() => openEditForm(mapping)} disabled={!canEdit || String(mapping.status).toUpperCase() === 'CLOSED' || loading} title={!canEdit ? 'Requires Edit Movement Mapping permission' : String(mapping.status).toUpperCase() === 'CLOSED' ? 'Closed mappings are read-only' : 'Edit mapping details'}>Edit</button>
                            <button type="button" className="btn-danger" onClick={() => requestDeleteMapping(mapping)} disabled={!canEdit || loading} title={!canEdit ? 'Requires Edit Movement Mapping permission' : 'Soft-delete while preserving comparison history'}>Delete</button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      <Modal
        open={formOpen}
        title={formMode === 'create' ? 'Create movement mapping' : 'Edit movement mapping'}
        description={formMode === 'create' ? 'Set the pathway and reference before attaching approved tickets.' : 'Update mapping metadata. Ticket history is retained.'}
        onClose={() => !loading && setFormOpen(false)}
        size="md"
        footer={(
          <>
            <button type="button" className="btn-secondary" onClick={() => setFormOpen(false)} disabled={loading}>Cancel</button>
            <button type="button" onClick={submitMappingForm} disabled={loading || (formMode === 'create' ? !canCreate : !canEdit)}>{loading ? 'Saving…' : formMode === 'create' ? 'Create Mapping' : 'Save Changes'}</button>
          </>
        )}
      >
        <MappingFormFields
          form={mappingForm}
          setForm={setMappingForm}
          locations={locations}
          hasItems={formMode === 'edit' && (selectedMapping?.items || []).length > 0}
        />
      </Modal>

      <Modal
        open={detailOpen}
        title={selectedMapping ? `${mappingTypeLabel(selectedMapping.mapping_type)} · ${selectedMapping.reference_number}` : 'Movement mapping'}
        description={selectedMapping ? `${locationDisplay(selectedMapping.location_code, locations)} · ${selectedMapping.product_name || 'Product not specified'}` : ''}
        onClose={() => setDetailOpen(false)}
        size="xl"
        className="movement-mapping-detail-modal"
      >
        {!selectedMapping ? (
          <div className="info-box">Loading mapping details…</div>
        ) : (
          <div className="movement-mapping-detail">
            <div className="mapping-detail-toolbar">
              <div className="mapping-detail-badges">
                <span className={`status-badge ${selectedMappingArchived ? 'deleted' : selectedMappingClosed ? 'closed' : 'open'}`}>{selectedMappingArchived ? 'Deleted' : selectedMappingClosed ? 'Closed' : 'Open'}</span>
                <span className={`mapping-progress ${getMappingProgress(selectedMapping) === 'Mapped' ? 'complete' : 'pending'}`}>{getMappingProgress(selectedMapping)}</span>
                <span className="mapping-ticket-counts">{sourceItems.length} source · {targetItems.length} target</span>
              </div>
              <div className="mapping-row-actions">
                {!selectedMappingArchived && !selectedMappingClosed && canEdit && <button type="button" className="btn-secondary" onClick={() => { setFormMode('edit'); setMappingForm({ mapping_type: selectedMapping.mapping_type, location_code: selectedMapping.location_code, reference_number: selectedMapping.reference_number, product_name: selectedMapping.product_name || '', remarks: selectedMapping.remarks || '' }); setFormOpen(true) }}>Edit Details</button>}
                {!selectedMappingArchived && !selectedMappingClosed && canClose && <button type="button" className="btn-secondary" onClick={requestCloseMapping} disabled={loading}>Close Mapping</button>}
                {!selectedMappingArchived && canEdit && <button type="button" className="btn-danger" onClick={() => requestDeleteMapping(selectedMapping)} disabled={loading}>Delete</button>}
                {selectedMappingArchived && canEdit && <button type="button" onClick={() => restoreMapping(selectedMapping)} disabled={loading}>Restore</button>}
              </div>
            </div>

            <div className="mapping-detail-metadata">
              <div><span>Reference</span><strong>{selectedMapping.reference_number}</strong></div>
              <div><span>Pathway</span><strong>{mappingTypeLabel(selectedMapping.mapping_type)}</strong></div>
              <div><span>Location</span><strong>{locationDisplay(selectedMapping.location_code, locations)}</strong></div>
              <div><span>Product</span><strong>{selectedMapping.product_name || '-'}</strong></div>
              <div><span>Created by</span><strong>{selectedMapping.created_by || '-'}</strong></div>
              <div><span>Updated</span><strong>{formatDate(selectedMapping.updated_at || selectedMapping.created_at)}</strong></div>
            </div>
            {selectedMapping.remarks && <div className="mapping-remarks"><span>Remarks</span><p>{selectedMapping.remarks}</p></div>}

            <section className="mapping-comparison-section">
              <div className="mapping-section-heading"><div><h3>Volume comparison</h3><p>Source totals compared with target totals. Difference is target minus source.</p></div><span className="mapping-comparison-status">{sourceItems.length && targetItems.length ? 'Comparison ready' : 'Waiting for both sides'}</span></div>
              {selectedMapping.comparison ? (
                <div className="mapping-comparison-table-scroll">
                  <table className="mapping-comparison-table">
                    <thead><tr><th>Measurement</th><th>Source total</th><th>Target total</th><th>Difference</th><th>Difference %</th></tr></thead>
                    <tbody>
                      <tr><td><strong>TOV / Volume (bbl)</strong></td><td>{formatNumber(selectedMapping.comparison.source_qty_bbl)}</td><td>{formatNumber(selectedMapping.comparison.target_qty_bbl)}</td><td>{formatNumber(selectedMapping.comparison.diff_qty_bbl)}</td><td>{formatNumber(selectedMapping.comparison.diff_qty_percent, 4)}%</td></tr>
                      <tr><td><strong>GSV (bbl)</strong></td><td>{formatNumber(selectedMapping.comparison.source_gsv_bbl)}</td><td>{formatNumber(selectedMapping.comparison.target_gsv_bbl)}</td><td>{formatNumber(selectedMapping.comparison.diff_gsv_bbl)}</td><td>{formatNumber(selectedMapping.comparison.diff_gsv_percent, 4)}%</td></tr>
                      <tr><td><strong>Free Water (bbl)</strong></td><td>{formatNumber(selectedMapping.comparison.source_water_bbl)}</td><td>{formatNumber(selectedMapping.comparison.target_water_bbl)}</td><td>{formatNumber(selectedMapping.comparison.diff_water_bbl)}</td><td>{formatNumber(selectedMapping.comparison.diff_water_percent, 4)}%</td></tr>
                      <tr><td><strong>NSV (bbl)</strong></td><td>{formatNumber(selectedMapping.comparison.source_nsv_bbl)}</td><td>{formatNumber(selectedMapping.comparison.target_nsv_bbl)}</td><td>{formatNumber(selectedMapping.comparison.diff_nsv_bbl)}</td><td>{formatNumber(selectedMapping.comparison.diff_nsv_percent, 4)}%</td></tr>
                    </tbody>
                  </table>
                  {(selectedMapping.comparison.source_gsv_bbl === null || selectedMapping.comparison.source_gsv_bbl === undefined || selectedMapping.comparison.target_gsv_bbl === null || selectedMapping.comparison.target_gsv_bbl === undefined) && (
                    <p className="mapping-data-note">GSV is shown only when captured by the source/target ticket. Legacy or non-GSV layouts remain blank rather than being treated as zero.</p>
                  )}
                </div>
              ) : <div className="mapping-empty-comparison">Attach at least one source and target ticket to calculate the comparison.</div>}
            </section>

            <div className="mapping-side-grid">
              <section className="mapping-side-card">
                <div className="mapping-section-heading"><div><h3>Sources</h3><p>{isBargeSourcePath ? 'Barge UNLOAD tickets' : 'Approved source tickets'} · {sourceItems.length} attached</p></div></div>
                <div className="mapping-table-scroll">
                  <table className="mapping-ticket-table">
                    <thead><tr><th>Ticket</th><th>Asset</th><th>Date</th><th>TOV</th><th>GSV</th><th>Free water</th><th>NSV</th><th>Action</th></tr></thead>
                    <tbody>
                      {sourceItems.length === 0 ? <tr><td colSpan="8" className="empty-table">No source tickets attached.</td></tr> : sourceItems.map((item) => (
                        <tr key={item.id}>
                          <td>{canViewTransactions ? <Link to={`/operation-transactions/${item.transaction_id}`}>{item.ticket_number || item.transaction_id}</Link> : item.ticket_number || item.transaction_id}</td>
                          <td>{item.asset_code || '-'}</td><td>{formatDate(item.operation_date)}</td>
                          <td>{formatNumber(item.qty_bbl)}</td><td>{formatNumber(item.gsv_bbl)}</td><td>{formatNumber(item.water_bbl)}</td><td>{formatNumber(item.nsv_bbl)}</td>
                          <td><button type="button" className="btn-danger btn-compact" onClick={() => requestRemoveItem(item)} disabled={!canEditSelected || loading} title={!canEditSelected ? 'Only open mappings can be edited' : 'Remove ticket and recalculate totals'}>Remove</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
              <section className="mapping-side-card">
                <div className="mapping-section-heading"><div><h3>Targets</h3><p>Approved destination tickets · {targetItems.length} attached</p></div></div>
                <div className="mapping-table-scroll">
                  <table className="mapping-ticket-table">
                    <thead><tr><th>Ticket</th><th>Asset</th><th>Date</th><th>TOV</th><th>GSV</th><th>Free water</th><th>NSV</th><th>Action</th></tr></thead>
                    <tbody>
                      {targetItems.length === 0 ? <tr><td colSpan="8" className="empty-table">No target tickets attached.</td></tr> : targetItems.map((item) => (
                        <tr key={item.id}>
                          <td>{canViewTransactions ? <Link to={`/operation-transactions/${item.transaction_id}`}>{item.ticket_number || item.transaction_id}</Link> : item.ticket_number || item.transaction_id}</td>
                          <td>{item.asset_code || '-'}</td><td>{formatDate(item.operation_date)}</td>
                          <td>{formatNumber(item.qty_bbl)}</td><td>{formatNumber(item.gsv_bbl)}</td><td>{formatNumber(item.water_bbl)}</td><td>{formatNumber(item.nsv_bbl)}</td>
                          <td><button type="button" className="btn-danger btn-compact" onClick={() => requestRemoveItem(item)} disabled={!canEditSelected || loading} title={!canEditSelected ? 'Only open mappings can be edited' : 'Remove ticket and recalculate totals'}>Remove</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>

            {canEditSelected && (
              <section className="mapping-attach-panel">
                <div className="mapping-section-heading"><div><h3>Attach approved tickets</h3><p>Transactions are snapshotted into this mapping; duplicates are ignored and totals recalculate after every change.</p></div></div>

                {isBargeSourcePath ? (
                  <div className="mapping-candidate-card">
                    <div className="mapping-candidate-heading"><div><h4>1. Add source from Barge UNLOAD</h4><p>Load approved UNLOAD tickets from the convoy timeline.</p></div></div>
                    <div className="mapping-candidate-search-row">
                      <div><label htmlFor="mapping-convoy-number">Convoy number</label><input id="mapping-convoy-number" value={convoyNumber} onChange={(event) => setConvoyNumber(event.target.value)} placeholder="Enter convoy number" /></div>
                      <div className="mapping-candidate-action-group">
                        <button type="button" className="btn-secondary" onClick={() => loadBargeUnloads()} disabled={loading}>Load UNLOAD tickets</button>
                        <button type="button" className="btn-secondary" onClick={autoSuggestBargeAndTarget} disabled={loading || !canViewTransactions} title={!canViewTransactions ? 'Requires View Operation Transaction permission to suggest target tickets' : 'Load Barge UNLOAD sources and search approved target tickets'}>Auto Suggest (Source + Target)</button>
                      </div>
                    </div>
                    {!canViewTransactions && <p className="mapping-data-note">Ticket search requires the View Operation Transaction permission. Barge UNLOAD tickets can still be loaded from the convoy timeline.</p>}
                    {visibleBargeCandidates.length > 0 && (
                      <>
                        <div className="mapping-table-scroll">
                          <table className="mapping-candidate-table">
                            <thead><tr><th>Select</th><th>Asset</th><th>Ticket / Transaction</th><th>Location</th><th>Event date</th></tr></thead>
                            <tbody>{visibleBargeCandidates.map((row) => (
                              <tr key={row.key}><td><input type="checkbox" aria-label={`Select ${row.ticket_number || row.transaction_id}`} checked={selectedSourceTxIds.includes(row.transaction_id)} onChange={(event) => setSelectedSourceTxIds((current) => event.target.checked ? [...new Set([...current, row.transaction_id])] : current.filter((id) => id !== row.transaction_id))} /></td><td>{row.asset_name ? `${row.asset_name} (${row.asset_code})` : row.asset_code || '-'}</td><td>{row.ticket_number || `#${row.transaction_id}`}</td><td>{locationDisplay(row.location_code, locations)}</td><td>{formatDate(row.event_datetime)}</td></tr>
                            ))}</tbody>
                          </table>
                        </div>
                        <div className="form-actions"><button type="button" onClick={() => addItems('SOURCE', selectedSourceTxIds)} disabled={loading || selectedSourceTxIds.length === 0}>Add selected sources</button></div>
                      </>
                    )}
                    {bargeUnloadCandidates.length > 0 && visibleBargeCandidates.length === 0 && <div className="mapping-empty-comparison">All UNLOAD tickets from this convoy are already attached.</div>}
                  </div>
                ) : (
                  <div className="mapping-candidate-card">
                    <div className="mapping-candidate-heading"><div><h4>1. Search source tickets</h4><p>Use for Shuttle → FSO mappings, selecting the approved shuttle movement as the source.</p></div></div>
                    <div className="mapping-candidate-search-grid">
                      <div><label htmlFor="source-location">Location</label><select id="source-location" value={sourceSearch.locationCode} onChange={(event) => setSourceSearch((current) => ({ ...current, locationCode: event.target.value }))}><option value="">All in my scope</option>{locations.map((item) => <option key={item.id || item.locationCode} value={item.locationCode || item.location_code}>{item.locationName || item.location_name} ({item.locationCode || item.location_code})</option>)}</select></div>
                      <div><label htmlFor="source-asset">Asset code</label><input id="source-asset" value={sourceSearch.assetCode} onChange={(event) => setSourceSearch((current) => ({ ...current, assetCode: event.target.value }))} placeholder="Shuttle asset" /></div>
                      <div><label htmlFor="source-search">Ticket / reference</label><input id="source-search" value={sourceSearch.searchText} onChange={(event) => setSourceSearch((current) => ({ ...current, searchText: event.target.value }))} placeholder="Ticket, number or reference" /></div>
                      <div className="mapping-candidate-action-group">
                        <button type="button" className="btn-secondary" onClick={() => searchApprovedTransactions('SOURCE')} disabled={loading || !canViewTransactions}>Search source</button>
                        <button type="button" className="btn-secondary" onClick={autoSuggestSourceAndTarget} disabled={loading || !canViewTransactions}>Auto Suggest (Source + Target)</button>
                      </div>
                    </div>
                    {!canViewTransactions && <p className="mapping-data-note">Ticket search requires the View Operation Transaction permission.</p>}
                    {visibleGenericSourceCandidates.length > 0 && <CandidateTable rows={visibleGenericSourceCandidates} selectedIds={selectedGenericSourceIds} onToggle={(id, checked) => setSelectedGenericSourceIds((current) => checked ? [...new Set([...current, id])] : current.filter((value) => value !== id))} locations={locations} canViewTransactions={canViewTransactions} />}
                    {sourceCandidates.length > 0 && visibleGenericSourceCandidates.length === 0 && <div className="mapping-empty-comparison">All matching source tickets are already attached.</div>}
                    {visibleGenericSourceCandidates.length > 0 && <div className="form-actions"><button type="button" onClick={() => addItems('SOURCE', selectedGenericSourceIds)} disabled={loading || selectedGenericSourceIds.length === 0}>Add selected sources</button></div>}
                  </div>
                )}

                <div className="mapping-candidate-card">
                  <div className="mapping-candidate-heading"><div><h4>2. Add target tickets</h4><p>Search approved Shuttle or FSO destination movements for this pathway.</p></div></div>
                  <div className="mapping-candidate-search-grid">
                    <div><label htmlFor="target-location">Location</label><select id="target-location" value={targetSearch.locationCode} onChange={(event) => setTargetSearch((current) => ({ ...current, locationCode: event.target.value }))}><option value="">All in my scope</option>{locations.map((item) => <option key={item.id || item.locationCode} value={item.locationCode || item.location_code}>{item.locationName || item.location_name} ({item.locationCode || item.location_code})</option>)}</select></div>
                    <div><label htmlFor="target-asset">Asset code</label><input id="target-asset" value={targetSearch.assetCode} onChange={(event) => setTargetSearch((current) => ({ ...current, assetCode: event.target.value }))} placeholder="Shuttle / FSO asset" /></div>
                    <div><label htmlFor="target-search">Ticket / reference</label><input id="target-search" value={targetSearch.searchText} onChange={(event) => setTargetSearch((current) => ({ ...current, searchText: event.target.value }))} placeholder="Ticket, number or reference" /></div>
                    <button type="button" className="btn-secondary" onClick={() => searchApprovedTransactions('TARGET')} disabled={loading || !canViewTransactions}>Search target</button>
                  </div>
                  {visibleTargetCandidates.length > 0 && <CandidateTable rows={visibleTargetCandidates} selectedIds={selectedTargetTxIds} onToggle={(id, checked) => setSelectedTargetTxIds((current) => checked ? [...new Set([...current, id])] : current.filter((value) => value !== id))} locations={locations} canViewTransactions={canViewTransactions} />}
                  {targetCandidates.length > 0 && visibleTargetCandidates.length === 0 && <div className="mapping-empty-comparison">All matching target tickets are already attached.</div>}
                  {visibleTargetCandidates.length > 0 && <div className="form-actions"><button type="button" onClick={() => addItems('TARGET', selectedTargetTxIds)} disabled={loading || selectedTargetTxIds.length === 0}>Add selected targets</button></div>}
                </div>
              </section>
            )}

            {selectedMappingClosed && <div className="info-box">This mapping is closed and read-only. Reopen functionality is not enabled for movement mappings.</div>}
            {selectedMappingArchived && <div className="info-box">This mapping is deleted from active lists but its tickets and comparison history are preserved. Restore it to continue editing.</div>}
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(confirmAction)}
        title={confirmAction?.title || 'Confirm action'}
        description={confirmAction?.message || ''}
        onClose={() => setConfirmAction(null)}
        size="sm"
        footer={(
          <>
            <button type="button" className="btn-secondary" onClick={() => setConfirmAction(null)} disabled={loading}>Cancel</button>
            <button type="button" className={confirmAction?.type === 'archive-mapping' || confirmAction?.type === 'remove-item' ? 'btn-danger' : ''} onClick={executeConfirmedAction} disabled={loading}>{loading ? 'Processing…' : confirmAction?.type === 'archive-mapping' ? 'Delete safely' : confirmAction?.type === 'remove-item' ? 'Remove ticket' : 'Close mapping'}</button>
          </>
        )}
      >
        {confirmAction?.type === 'archive-mapping' && <p className="mapping-data-note">This is a recoverable delete. The mapping record, tickets and comparison remain available in the archive.</p>}
      </Modal>
    </div>
  )
}

function CandidateTable({ rows, selectedIds, onToggle, locations, canViewTransactions }) {
  return (
    <div className="mapping-table-scroll">
      <table className="mapping-candidate-table">
        <thead><tr><th>Select</th><th>Ticket</th><th>Operation</th><th>Asset</th><th>Location</th><th>Date</th><th>Status</th></tr></thead>
        <tbody>{rows.map((row) => (
          <tr key={row.id}>
            <td><input type="checkbox" aria-label={`Select ${row.ticketNumber || row.id}`} checked={selectedIds.includes(row.id)} onChange={(event) => onToggle(row.id, event.target.checked)} /></td>
            <td>{canViewTransactions ? <Link to={`/operation-transactions/${row.id}`}>{row.ticketNumber || row.id}</Link> : row.ticketNumber || row.id}</td>
            <td>{row.operationTypeName || row.operationTypeCode || '-'}</td>
            <td>{row.primaryAssetName ? `${row.primaryAssetName} (${row.primaryAssetCode})` : row.primaryAssetCode || '-'}</td>
            <td>{locationDisplay(row.locationCode, locations)}</td>
            <td>{formatDate(row.operationDate)}</td>
            <td>{row.status || '-'}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  )
}

export default MovementMapping
