import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import {
  addMovementMappingItems,
  closeMovementMapping,
  createMovementMapping,
  getMovementMapping,
  getMovementMappings,
  removeMovementMappingItem,
} from '../api/movementMappingApi'
import { getTripTimelineByConvoy } from '../api/bargeTrackingApi'
import { getOperationTransactions } from '../api/operationTransactionApi'

const formatNumber = (v, d = 3) => {
  const n = Number(v || 0)
  return n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d })
}

function MovementMapping({ locations = [] }) {
  const location = useLocation()

  const getQuery = () => {
    const params = new URLSearchParams(location.search || '')
    return {
      mapping_type: params.get('mapping_type') || '',
      location_code: params.get('location_code') || '',
      reference_number: params.get('reference_number') || '',
      status: params.get('status') || '',
      auto_suggest: params.get('auto_suggest') || '1',
    }
  }

  const [loading, setLoading] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [confirmRemoveItem, setConfirmRemoveItem] = useState(null)
  const [confirmCloseMap, setConfirmCloseMap] = useState(false)

  const [filters, setFilters] = useState({
    mapping_type: '',
    location_code: '',
    reference_number: '',
    status: '',
  })
  const [mappings, setMappings] = useState([])
  const [selectedMappingId, setSelectedMappingId] = useState(null)
  const [selectedMapping, setSelectedMapping] = useState(null)

  const [createForm, setCreateForm] = useState({
    mapping_type: 'BARGE_TO_SHUTTLE',
    location_code: '',
    reference_number: '',
    product_name: '',
    remarks: '',
  })

  const [convoyNumber, setConvoyNumber] = useState('')
  const [bargeUnloadCandidates, setBargeUnloadCandidates] = useState([])
  const [selectedSourceTxIds, setSelectedSourceTxIds] = useState([])

  const [txSearch, setTxSearch] = useState({
    locationCode: '',
    assetCode: '',
    status: 'Approved',
    searchText: '',
  })
  const [txCandidates, setTxCandidates] = useState([])
  const [selectedTargetTxIds, setSelectedTargetTxIds] = useState([])

  const loadList = async () => {
    try {
      setLoading(true)
      const data = await getMovementMappings(filters)
      setMappings(Array.isArray(data) ? data : [])
    } catch (e) {
      setErrorMsg(e.message || 'Unable to load movement mappings')
    } finally {
      setLoading(false)
    }
  }

  const loadMapping = async (id) => {
    try {
      setLoading(true)
      const data = await getMovementMapping(id)
      setSelectedMapping(data)
      setSelectedMappingId(id)
    } catch (e) {
      setErrorMsg(e.message || 'Unable to load mapping')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadList()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const q = getQuery()

    const hasAny = q.mapping_type || q.location_code || q.reference_number || q.status
    if (!hasAny) return

    setFilters((c) => ({
      ...c,
      mapping_type: q.mapping_type,
      location_code: q.location_code,
      reference_number: q.reference_number,
      status: q.status,
    }))

    setCreateForm((c) => ({
      ...c,
      mapping_type: q.mapping_type || c.mapping_type || 'BARGE_TO_SHUTTLE',
      location_code: q.location_code || c.location_code,
      reference_number: q.reference_number || c.reference_number,
    }))

    setConvoyNumber(q.reference_number || '')

    let nextTxSearch = null
    setTxSearch((c) => {
      nextTxSearch = {
        ...c,
        status: 'Approved',
        locationCode: q.location_code || c.locationCode,
        searchText: q.reference_number || c.searchText,
      }
      return nextTxSearch
    })

    // eslint-disable-next-line react-hooks/exhaustive-deps
    ;(async () => {
      try {
        setLoading(true)
        const data = await getMovementMappings({
          mapping_type: q.mapping_type,
          location_code: q.location_code,
          reference_number: q.reference_number,
          status: q.status,
        })
        setMappings(Array.isArray(data) ? data : [])
      } catch (e) {
        setErrorMsg(e.message || 'Unable to load movement mappings')
      } finally {
        setLoading(false)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps

    if (String(q.auto_suggest || '1') !== '0' && q.reference_number) {
      ;(async () => {
        try {
          await loadBargeUnloads(q.reference_number)
        } catch {
        }
      })()

      ;(async () => {
        try {
          const s =
            nextTxSearch || {
              status: 'Approved',
              locationCode: q.location_code || '',
              assetCode: '',
              searchText: q.reference_number || '',
            }
          await searchTargets(s)
        } catch {
        }
      })()
    }
  }, [location.search])

  const onFilterChange = (e) => {
    const { name, value } = e.target
    setFilters((c) => ({ ...c, [name]: value }))
    if (errorMsg) setErrorMsg('')
  }

  const onCreateFormChange = (e) => {
    const { name, value } = e.target
    setCreateForm((c) => ({ ...c, [name]: value }))
    if (errorMsg) setErrorMsg('')
  }

  const createNew = async () => {
    try {
      setLoading(true)
      const created = await createMovementMapping(createForm)
      await loadList()
      await loadMapping(created.id)
      setSuccessMsg('Mapping created')
    } catch (e) {
      setErrorMsg(e.message || 'Unable to create mapping')
    } finally {
      setLoading(false)
    }
  }

  const loadBargeUnloads = async (convoyOverride) => {
    const convoy = String(convoyOverride ?? convoyNumber ?? '').trim()
    if (!convoy) {
      setErrorMsg('Enter Convoy Number')
      return
    }

    try {
      setLoading(true)
      const timeline = await getTripTimelineByConvoy(convoy)

      const events = Array.isArray(timeline?.events) ? timeline.events : []
      const unloads = events
        .filter((e) => String(e.event_type || '').toUpperCase() === 'UNLOAD')
        .filter((e) => e.operation_transaction_id)

      const rows = unloads.map((e) => ({
        key: `${e.asset_code}-${e.operation_transaction_id}`,
        asset_code: e.asset_code,
        location_code: e.location_code,
        event_datetime: e.event_datetime,
        transaction_id: e.operation_transaction_id,
      }))

      setBargeUnloadCandidates(rows)
      setSelectedSourceTxIds([])
    } catch (e) {
      setErrorMsg(e.message || 'Unable to load barge UNLOAD candidates')
    } finally {
      setLoading(false)
    }
  }

  const searchTargets = async (searchOverride) => {
    try {
      setLoading(true)
      const results = await getOperationTransactions(searchOverride || txSearch)
      setTxCandidates(results)
      setSelectedTargetTxIds([])
    } catch (e) {
      setErrorMsg(e.message || 'Unable to search approved transactions')
    } finally {
      setLoading(false)
    }
  }

  const addItems = async (role, ids) => {
    if (!selectedMappingId) {
      setErrorMsg('Select a mapping first')
      return
    }

    if (!ids || ids.length === 0) {
      setErrorMsg('Select at least one ticket')
      return
    }

    try {
      setLoading(true)
      const updated = await addMovementMappingItems(selectedMappingId, {
        role,
        transaction_ids: ids,
      })
      setSelectedMapping(updated)
      await loadList()
    } catch (e) {
      setErrorMsg(e.message || 'Unable to add items')
    } finally {
      setLoading(false)
    }
  }

  const removeItem = (item) => {
    if (!selectedMappingId) return
    setConfirmRemoveItem(item)
  }

  const confirmRemoveMappingItem = async () => {
    if (!confirmRemoveItem || !selectedMappingId) return
    const item = confirmRemoveItem

    try {
      setLoading(true)
      const updated = await removeMovementMappingItem(selectedMappingId, item.id)
      setSelectedMapping(updated)
      setConfirmRemoveItem(null)
      await loadList()
    } catch (e) {
      setErrorMsg(e.message || 'Unable to remove item')
      setConfirmRemoveItem(null)
    } finally {
      setLoading(false)
    }
  }

  const closeMap = () => {
    if (!selectedMappingId) return
    setConfirmCloseMap(true)
  }

  const confirmCloseMapping = async () => {
    if (!selectedMappingId) return

    try {
      setLoading(true)
      const updated = await closeMovementMapping(selectedMappingId)
      setSelectedMapping(updated)
      setConfirmCloseMap(false)
      await loadList()
      setSuccessMsg('Mapping closed.')
    } catch (e) {
      setErrorMsg(e.message || 'Unable to close mapping')
      setConfirmCloseMap(false)
    } finally {
      setLoading(false)
    }
  }

  const sourceItems = useMemo(() => {
    const items = selectedMapping?.items || []
    return items.filter((i) => String(i.role || '').toUpperCase() === 'SOURCE')
  }, [selectedMapping])

  const targetItems = useMemo(() => {
    const items = selectedMapping?.items || []
    return items.filter((i) => String(i.role || '').toUpperCase() === 'TARGET')
  }, [selectedMapping])

  const cmp = selectedMapping?.comparison || null

  return (
    <div>
      {successMsg && (
        <div className="success-box" onClick={() => setSuccessMsg('')}>
          {successMsg}
        </div>
      )}
      {errorMsg && (
        <div className="error-box" onClick={() => setErrorMsg('')}>
          {errorMsg}
        </div>
      )}
      {confirmRemoveItem && (
        <div className="confirm-overlay">
          <div className="confirm-dialog">
            <p>Remove ticket {confirmRemoveItem.ticket_number || confirmRemoveItem.transaction_id}?</p>
            <div className="confirm-actions">
              <button onClick={confirmRemoveMappingItem}>Yes, Remove</button>
              <button onClick={() => setConfirmRemoveItem(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
      {confirmCloseMap && (
        <div className="confirm-overlay">
          <div className="confirm-dialog">
            <p>Close this mapping? After closing, it becomes read-only.</p>
            <div className="confirm-actions">
              <button onClick={confirmCloseMapping}>Yes, Close</button>
              <button onClick={() => setConfirmCloseMap(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
      <div className="page-title">
        <div>
          <h2>Movement Mapping</h2>
          <p>
            Link Approved tickets for reconciliation (Barge ↔ Shuttle ↔ FSO). Many-to-many supported.
          </p>
        </div>
        <span className="record-count">{mappings.length} Mappings</span>
      </div>

      <div className="two-column-grid">
        {/* LEFT: Mapping list + create */}
        <div>
          <div className="info-box">
            <strong>Find Mappings</strong>

            <div className="operation-entry-subgrid" style={{ marginTop: 10 }}>
              <div>
                <label>Type</label>
                <select name="mapping_type" value={filters.mapping_type} onChange={onFilterChange}>
                  <option value="">All</option>
                  <option value="BARGE_TO_SHUTTLE">BARGE → SHUTTLE</option>
                  <option value="SHUTTLE_TO_FSO">SHUTTLE → FSO</option>
                  <option value="BARGE_TO_FSO">BARGE → FSO</option>
                </select>
              </div>

              <div>
                <label>Location</label>
                <select name="location_code" value={filters.location_code} onChange={onFilterChange}>
                  <option value="">All</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.locationCode}>
                      {l.locationName} ({l.locationCode})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label>Reference</label>
                <input
                  name="reference_number"
                  value={filters.reference_number}
                  onChange={onFilterChange}
                  placeholder="Shuttle No / Batch / Voyage"
                />
              </div>

              <div>
                <label>Status</label>
                <select name="status" value={filters.status} onChange={onFilterChange}>
                  <option value="">All</option>
                  <option value="OPEN">OPEN</option>
                  <option value="CLOSED">CLOSED</option>
                </select>
              </div>
            </div>

            <div className="form-actions">
              <button type="button" onClick={loadList} disabled={loading}>
                {loading ? 'Loading...' : 'Load'}
              </button>
            </div>
          </div>

          <table style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>Type</th>
                <th>Location</th>
                <th>Reference</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {mappings.length === 0 ? (
                <tr>
                  <td colSpan="5" className="empty-table">
                    No mappings found.
                  </td>
                </tr>
              ) : (
                mappings.map((m) => (
                  <tr key={m.id}>
                    <td>{m.mapping_type}</td>
                    <td>{m.location_code}</td>
                    <td>{m.reference_number}</td>
                    <td>{m.status}</td>
                    <td>
                      <button type="button" onClick={() => loadMapping(m.id)}>
                        Open
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          <div className="info-box" style={{ marginTop: 12 }}>
            <strong>Create New Mapping</strong>

            <div className="operation-entry-subgrid" style={{ marginTop: 10 }}>
              <div>
                <label>Type *</label>
                <select name="mapping_type" value={createForm.mapping_type} onChange={onCreateFormChange}>
                  <option value="BARGE_TO_SHUTTLE">BARGE → SHUTTLE</option>
                  <option value="SHUTTLE_TO_FSO">SHUTTLE → FSO</option>
                  <option value="BARGE_TO_FSO">BARGE → FSO</option>
                </select>
              </div>

              <div>
                <label>Location *</label>
                <select name="location_code" value={createForm.location_code} onChange={onCreateFormChange}>
                  <option value="">Select</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.locationCode}>
                      {l.locationName} ({l.locationCode})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label>Reference No *</label>
                <input name="reference_number" value={createForm.reference_number} onChange={onCreateFormChange} />
              </div>

              <div>
                <label>Product</label>
                <input name="product_name" value={createForm.product_name} onChange={onCreateFormChange} />
              </div>

              <div className="full-width-field">
                <label>Remarks</label>
                <textarea name="remarks" rows="2" value={createForm.remarks} onChange={onCreateFormChange} />
              </div>
            </div>

            <div className="form-actions">
              <button type="button" onClick={createNew} disabled={loading}>
                Create Mapping
              </button>
            </div>
          </div>
        </div>

        {/* RIGHT: Selected mapping */}
        <div>
          {!selectedMapping ? (
            <div className="info-box">
              Select a mapping from the left panel.
            </div>
          ) : (
            <>
              <div className="info-box">
                <strong>Mapping Details</strong>
                <div style={{ marginTop: 6 }}>
                  <div><strong>ID:</strong> {selectedMapping.id}</div>
                  <div><strong>Type:</strong> {selectedMapping.mapping_type}</div>
                  <div><strong>Location:</strong> {selectedMapping.location_code}</div>
                  <div><strong>Reference:</strong> {selectedMapping.reference_number}</div>
                  <div><strong>Status:</strong> {selectedMapping.status}</div>
                </div>

                <div className="form-actions" style={{ marginTop: 10 }}>
                  <button type="button" onClick={closeMap} disabled={loading || selectedMapping.status === 'CLOSED'}>
                    Close Mapping
                  </button>
                </div>
              </div>

              {cmp && (
                <div className="info-box" style={{ marginTop: 12 }}>
                  <strong>Comparison</strong>
                  <div style={{ marginTop: 8 }}>
                    <div>Source NSV: <strong>{formatNumber(cmp.source_nsv_bbl)}</strong></div>
                    <div>Target NSV: <strong>{formatNumber(cmp.target_nsv_bbl)}</strong></div>
                    <div>Diff NSV: <strong>{formatNumber(cmp.diff_nsv_bbl)}</strong></div>
                    <div>Diff %: <strong>{formatNumber(cmp.diff_nsv_percent, 4)}%</strong></div>
                  </div>
                </div>
              )}

              <div className="two-column-grid" style={{ marginTop: 12 }}>
                <div>
                  <h3>Sources</h3>
                  <table>
                    <thead>
                      <tr>
                        <th>Ticket</th>
                        <th>Asset</th>
                        <th>NSV</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {sourceItems.length === 0 ? (
                        <tr>
                          <td colSpan="4" className="empty-table">No sources added.</td>
                        </tr>
                      ) : (
                        sourceItems.map((i) => (
                          <tr key={i.id}>
                            <td>{i.ticket_number || i.transaction_id}</td>
                            <td>{i.asset_code || '-'}</td>
                            <td>{formatNumber(i.nsv_bbl)}</td>
                            <td>
                              <button type="button" disabled={selectedMapping.status === 'CLOSED'} onClick={() => removeItem(i)}>
                                Remove
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                <div>
                  <h3>Targets</h3>
                  <table>
                    <thead>
                      <tr>
                        <th>Ticket</th>
                        <th>Asset</th>
                        <th>NSV</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {targetItems.length === 0 ? (
                        <tr>
                          <td colSpan="4" className="empty-table">No targets added.</td>
                        </tr>
                      ) : (
                        targetItems.map((i) => (
                          <tr key={i.id}>
                            <td>{i.ticket_number || i.transaction_id}</td>
                            <td>{i.asset_code || '-'}</td>
                            <td>{formatNumber(i.nsv_bbl)}</td>
                            <td>
                              <button type="button" disabled={selectedMapping.status === 'CLOSED'} onClick={() => removeItem(i)}>
                                Remove
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Add Sources from Barge Tracking */}
              <div className="info-box" style={{ marginTop: 12 }}>
                <strong>Add SOURCE from Barge UNLOAD (by Convoy)</strong>
                <div className="operation-entry-subgrid" style={{ marginTop: 10 }}>
                  <div>
                    <label>Convoy Number</label>
                    <input value={convoyNumber} onChange={(e) => { setConvoyNumber(e.target.value); setErrorMsg(''); }} />
                  </div>
                  <div className="report-filter-actions">
                    <button type="button" onClick={loadBargeUnloads} disabled={loading || selectedMapping.status === 'CLOSED'}>
                      Load UNLOAD Tickets
                    </button>
                    <button
                      type="button"
                      disabled={loading || selectedMapping.status === 'CLOSED'}
                      onClick={async () => {
                        await loadBargeUnloads()
                        await searchTargets()
                      }}
                    >
                      Auto Suggest (Source + Target)
                    </button>
                  </div>
                </div>

                {bargeUnloadCandidates.length > 0 && (
                  <>
                    <table style={{ marginTop: 10 }}>
                      <thead>
                        <tr>
                          <th />
                          <th>Barge</th>
                          <th>Tx ID</th>
                          <th>Loc</th>
                          <th>Date</th>
                        </tr>
                      </thead>
                      <tbody>
                        {bargeUnloadCandidates.map((r) => (
                          <tr key={r.key}>
                            <td>
                              <input
                                type="checkbox"
                                checked={selectedSourceTxIds.includes(r.transaction_id)}
                                onChange={(e) => {
                                  const checked = e.target.checked
                                  setSelectedSourceTxIds((cur) =>
                                    checked
                                      ? [...cur, r.transaction_id]
                                      : cur.filter((x) => x !== r.transaction_id)
                                  )
                                }}
                              />
                            </td>
                            <td>{r.asset_code}</td>
                            <td>{r.transaction_id}</td>
                            <td>{r.location_code}</td>
                            <td>{r.event_datetime || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    <div className="form-actions" style={{ marginTop: 10 }}>
                      <button
                        type="button"
                        disabled={loading || selectedMapping.status === 'CLOSED'}
                        onClick={() => addItems('SOURCE', selectedSourceTxIds)}
                      >
                        Add Selected as SOURCE
                      </button>
                    </div>
                  </>
                )}
              </div>

              {/* Add Targets from OTR search */}
              <div className="info-box" style={{ marginTop: 12 }}>
                <strong>Add TARGET from Approved Tickets (OTR search)</strong>

                <div className="operation-entry-subgrid" style={{ marginTop: 10 }}>
                  <div>
                    <label>Location</label>
                    <input
                      value={txSearch.locationCode}
                      onChange={(e) => { setTxSearch((c) => ({ ...c, locationCode: e.target.value })); if (errorMsg) setErrorMsg(''); }}
                      placeholder="UTP"
                    />
                  </div>

                  <div>
                    <label>Asset Code</label>
                    <input
                      value={txSearch.assetCode}
                      onChange={(e) => setTxSearch((c) => ({ ...c, assetCode: e.target.value }))}
                      placeholder="Shuttle/FSO asset code"
                    />
                  </div>

                  <div>
                    <label>Search</label>
                    <input
                      value={txSearch.searchText}
                      onChange={(e) => setTxSearch((c) => ({ ...c, searchText: e.target.value }))}
                      placeholder="Reference / Ticket / Convoy"
                    />
                  </div>

                  <div className="report-filter-actions">
                    <button type="button" onClick={searchTargets} disabled={loading || selectedMapping.status === 'CLOSED'}>
                      Search Approved
                    </button>
                    <button
                      type="button"
                      disabled={loading || selectedMapping.status === 'CLOSED'}
                      onClick={async () => {
                        await loadBargeUnloads()
                        await searchTargets()
                      }}
                    >
                      Auto Suggest (Source + Target)
                    </button>
                  </div>
                </div>

                {txCandidates.length > 0 && (
                  <>
                    <table style={{ marginTop: 10 }}>
                      <thead>
                        <tr>
                          <th />
                          <th>Ticket</th>
                          <th>Asset</th>
                          <th>Date</th>
                          <th>Type</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {txCandidates.map((t) => (
                          <tr key={t.id}>
                            <td>
                              <input
                                type="checkbox"
                                checked={selectedTargetTxIds.includes(t.id)}
                                onChange={(e) => {
                                  const checked = e.target.checked
                                  setSelectedTargetTxIds((cur) =>
                                    checked ? [...cur, t.id] : cur.filter((x) => x !== t.id)
                                  )
                                }}
                              />
                            </td>
                            <td>{t.ticketNumber}</td>
                            <td>{t.primaryAssetCode}</td>
                            <td>{t.operationDate}</td>
                            <td>{t.operationTypeCode}</td>
                            <td>{t.status}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    <div className="form-actions" style={{ marginTop: 10 }}>
                      <button
                        type="button"
                        disabled={loading || selectedMapping.status === 'CLOSED'}
                        onClick={() => addItems('TARGET', selectedTargetTxIds)}
                      >
                        Add Selected as TARGET
                      </button>
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default MovementMapping
