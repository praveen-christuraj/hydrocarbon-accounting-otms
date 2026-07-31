import { useEffect, useMemo, useState } from 'react'
import {
  getExportLocations, createExportLocation, updateExportLocation, deleteExportLocation,
  getExportEntities, createExportEntity, updateExportEntity, deleteExportEntity,
  getExportBlocks, createExportBlock, updateExportBlock, deleteExportBlock,
  getExportPermits, createExportPermit, updateExportPermit, deleteExportPermit,
  getExportTransactions, createExportTransaction, updateExportTransaction, deleteExportTransaction,
  bulkUploadExport,
  getExportConfigs, saveExportConfig,
  getExportDashboard,
  getExportReport,
  getEntityBlocks, createEntityBlock, deleteEntityBlock,
  getExportConsignees, createExportConsignee, updateExportConsignee, deleteExportConsignee,
} from '../api/exportOperationsApi'
import { useCompanyPrintProfile } from '../hooks/useCompanyPrintProfile'
import CompanyPrintHeader from '../components/reports/CompanyPrintHeader'
import CompanyPrintFooter from '../components/reports/CompanyPrintFooter'

const fmt = (v, d = 2) => {
  const n = Number(v || 0)
  return n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d })
}

const buildPermitQuarterValue = (quarter, year) => {
  const q = String(quarter || '').trim().toUpperCase()
  const y = String(year ?? '').trim()
  if (!q) return ''
  if (q.includes('_')) return q
  return y ? `${q}_${y}` : q
}

const splitPermitQuarterValue = (value) => {
  const text = String(value || '').trim().toUpperCase()
  if (!text) return { quarter: 'Q1', year: new Date().getFullYear() }
  if (text.includes('_')) {
    const [quarter, yearText] = text.split('_', 2)
    return { quarter, year: yearText ? Number(yearText) : new Date().getFullYear() }
  }
  return { quarter: text, year: new Date().getFullYear() }
}

const COUNTRIES = [
  "Afghanistan","Albania","Algeria","Andorra","Angola","Antigua and Barbuda","Argentina","Armenia","Australia","Austria","Azerbaijan",
  "Bahamas","Bahrain","Bangladesh","Barbados","Belarus","Belgium","Belize","Benin","Bhutan","Bolivia","Bosnia and Herzegovina","Botswana","Brazil","Brunei","Bulgaria","Burkina Faso","Burundi",
  "Cabo Verde","Cambodia","Cameroon","Canada","Central African Republic","Chad","Chile","China","Colombia","Comoros","Congo","Costa Rica","Côte d'Ivoire","Croatia","Cuba","Cyprus","Czech Republic",
  "Denmark","Djibouti","Dominica","Dominican Republic","DR Congo","Ecuador","Egypt","El Salvador","Equatorial Guinea","Eritrea","Estonia","Eswatini","Ethiopia",
  "Fiji","Finland","France","Gabon","Gambia","Georgia","Germany","Ghana","Greece","Grenada","Guatemala","Guinea","Guinea-Bissau","Guyana",
  "Haiti","Honduras","Hungary","Iceland","India","Indonesia","Iran","Iraq","Ireland","Israel","Italy",
  "Jamaica","Japan","Jordan","Kazakhstan","Kenya","Kiribati","Kuwait","Kyrgyzstan",
  "Laos","Latvia","Lebanon","Lesotho","Liberia","Libya","Liechtenstein","Lithuania","Luxembourg",
  "Madagascar","Malawi","Malaysia","Maldives","Mali","Malta","Marshall Islands","Mauritania","Mauritius","Mexico","Micronesia","Moldova","Monaco","Mongolia","Montenegro","Morocco","Mozambique","Myanmar",
  "Namibia","Nauru","Nepal","Netherlands","New Zealand","Nicaragua","Niger","Nigeria","North Korea","North Macedonia","Norway",
  "Oman","Pakistan","Palau","Palestine","Panama","Papua New Guinea","Paraguay","Peru","Philippines","Poland","Portugal",
  "Qatar","Romania","Russia","Rwanda","Saint Kitts and Nevis","Saint Lucia","Saint Vincent and the Grenadines","Samoa","San Marino","Sao Tome and Principe","Saudi Arabia","Senegal","Serbia","Seychelles","Sierra Leone","Singapore","Slovakia","Slovenia","Solomon Islands","Somalia","South Africa","South Korea","South Sudan","Spain","Sri Lanka","Sudan","Suriname","Sweden","Switzerland","Syria",
  "Taiwan","Tajikistan","Tanzania","Thailand","Timor-Leste","Togo","Tonga","Trinidad and Tobago","Tunisia","Turkey","Turkmenistan","Tuvalu",
  "Uganda","Ukraine","United Arab Emirates","United Kingdom","United States","Uruguay","Uzbekistan",
  "Vanuatu","Vatican City","Venezuela","Vietnam",
  "Yemen","Zambia","Zimbabwe"
]

const sortOptions = (arr, labelKey, valKey) =>
  (arr || []).map((i) => (
    <option key={i[valKey] || i.id} value={i[valKey]}>
      {i[labelKey]} ({i[valKey]})
    </option>
  ))

function ExportOperations({ loggedInUser }) {
  const isAdmin = String(loggedInUser?.username || '').toLowerCase() === 'admin'
  const hasPerm = (name) => isAdmin || (loggedInUser?.permissions || []).some((p) => p.permissionName === name)
  const canManage = hasPerm('Manage Export Operations')
  const [activeTab, setActiveTab] = useState('dashboard')
  const tabs = [
    { key: 'dashboard', label: 'Dashboard' },
    { key: 'data-entry', label: 'Export Data' },
    { key: 'reports', label: 'Reports' },
    { key: 'configuration', label: 'Configuration' },
  ]

  return (
    <div className="export-operations-page">
      <div className="page-title no-print">
        <div>
          <h2>Export Operations</h2>
          <p>Manage export volumes, permits, and configurations across locations and entities.</p>
        </div>
      </div>
      <div className="tabs no-print">
        {tabs.map((t) => (
          <button key={t.key} type="button" className={activeTab === t.key ? 'tab-active' : ''} onClick={() => setActiveTab(t.key)}>{t.label}</button>
        ))}
      </div>
      {!canManage && (
        <div className="info-box">
          You have view-only access. Assign <strong>Manage Export Operations</strong> permission to create, edit, or delete export data.
        </div>
      )}
      {activeTab === 'dashboard' && <DashboardTab loggedInUser={loggedInUser} />}
      {activeTab === 'data-entry' && <DataEntryTab loggedInUser={loggedInUser} canManage={canManage} />}
      {activeTab === 'reports' && <ReportsTab loggedInUser={loggedInUser} />}
      {activeTab === 'configuration' && <ConfigurationTab loggedInUser={loggedInUser} canManage={canManage} />}
    </div>
  )
}

function DashboardTab({ loggedInUser }) {
  const [dash, setDash] = useState(null)
  const [loading, setLoading] = useState(false)
  const [locations, setLocations] = useState([])
  const [entities, setEntities] = useState([])
  const [blocks, setBlocks] = useState([])
  const [quarters, setQuarters] = useState([])
  const [filters, setFilters] = useState({ location_code: '', entity_code: '', block_code: '', quarter: '', from_date: '', to_date: '' })

  const load = async () => {
    try {
      setLoading(true)
      const params = {}
      Object.entries(filters).forEach(([k, v]) => { if (v) params[k] = v })
      const [d, locs, ents, blks] = await Promise.all([
        getExportDashboard(params),
        getExportLocations(),
        getExportEntities(),
        getExportBlocks(),
      ])
      setDash(d)
      setLocations(Array.isArray(locs) ? locs : [])
      setEntities(Array.isArray(ents) ? ents : [])
      setBlocks(Array.isArray(blks) ? blks : [])
      const qs = [...new Set((d?.blocks_summary || []).map((b) => b.quarter).filter(Boolean))].sort().reverse()
      setQuarters(qs)
    } catch (e) { console.error(e) } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const blockColumns = useMemo(() => {
    if (!dash?.blocks_summary?.length) return []
    return [...new Set(dash.blocks_summary.map((b) => b.block_code))].sort()
  }, [dash])

  const groupedBlockRows = useMemo(() => {
    if (!dash?.blocks_summary?.length) return []
    const map = {}
    dash.blocks_summary.forEach((b) => {
      const key = `${b.location_code}|${b.entity_code}|${b.quarter}`
      if (!map[key]) {
        map[key] = { location_name: b.location_name, location_code: b.location_code, entity_name: b.entity_name, entity_code: b.entity_code, quarter: b.quarter, permit_count: 0, total_export: 0, total_permit: 0, blocks: {} }
      }
      map[key].blocks[b.block_code] = b
      map[key].permit_count += b.permit_count
      map[key].total_export += b.export_volume
      map[key].total_permit += b.permit_volume
    })
    return Object.values(map)
  }, [dash])

  return (
    <div>
      <div className="report-filter-panel no-print" style={{ marginTop: '1rem' }}>
        <div><label>Location</label>
          <select value={filters.location_code} onChange={(e) => setFilters((c) => ({ ...c, location_code: e.target.value }))}>
            <option value="">All</option>
            {sortOptions(locations, 'location_name', 'location_code')}
          </select>
        </div>
        <div><label>Entity</label>
          <select value={filters.entity_code} onChange={(e) => setFilters((c) => ({ ...c, entity_code: e.target.value }))}>
            <option value="">All</option>
            {sortOptions(entities, 'entity_name', 'entity_code')}
          </select>
        </div>
        <div><label>Block</label>
          <select value={filters.block_code} onChange={(e) => setFilters((c) => ({ ...c, block_code: e.target.value }))}>
            <option value="">All</option>
            {sortOptions(blocks, 'block_name', 'block_code')}
          </select>
        </div>
        <div><label>Quarter</label>
          <select value={filters.quarter} onChange={(e) => setFilters((c) => ({ ...c, quarter: e.target.value }))}>
            <option value="">All</option>
            {quarters.map((q) => <option key={q} value={q}>{q}</option>)}
          </select>
        </div>
        <div><label>From</label><input type="date" value={filters.from_date} onChange={(e) => setFilters((c) => ({ ...c, from_date: e.target.value }))} /></div>
        <div><label>To</label><input type="date" value={filters.to_date} onChange={(e) => setFilters((c) => ({ ...c, to_date: e.target.value }))} /></div>
        <div className="report-filter-actions">
          <button type="button" onClick={load} disabled={loading}>{loading ? 'Loading...' : 'Refresh'}</button>
        </div>
      </div>
      {dash && (
        <>

          {dash.permit_insufficient_count > 0 && (
            <div className="warn-box" style={{ background: '#fff3cd', border: '1px solid #ffc107', padding: '1rem', borderRadius: '8px', marginBottom: '1rem' }}>
              <strong>Permit Insufficiency Alert:</strong> {dash.permit_insufficient_count} permit(s) exceed {dash.insufficient_threshold_pct}% usage. Supplementary permits may be required.
            </div>
          )}

          {/* Block Summary Table — blocks as columns */}
          <div className="section-title"><h3>Blocks Summary</h3></div>
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Location</th><th>Entity</th><th>Quarter</th><th>Permits</th>
                  {blockColumns.map((bc) => <th key={bc} colSpan={2}>{bc}<br /><span style={{ fontWeight: 400, fontSize: '0.75rem' }}>Export / Permit</span></th>)}
                </tr>
              </thead>
              <tbody>
                {!groupedBlockRows.length ? <tr><td colSpan={3 + blockColumns.length * 2} className="empty-table">No data</td></tr> :
                  groupedBlockRows.map((g, idx) => (
                    <tr key={idx}>
                      <td>{g.location_name}</td><td>{g.entity_name || '-'}</td><td>{g.quarter || '-'}</td><td>{g.permit_count}</td>
                      {blockColumns.map((bc) => {
                        const b = g.blocks[bc]
                        return [
                          <td key={`${bc}-exp`} style={b && b.usage_pct >= (dash?.insufficient_threshold_pct || 90) ? { background: '#fff3cd' } : {}}>{b ? fmt(b.export_volume) : '-'}</td>,
                          <td key={`${bc}-per`} style={{ fontSize: '0.8rem' }}>{b ? fmt(b.permit_volume) : '-'}</td>,
                        ]
                      })}
                    </tr>
                  ))
                }
              </tbody>
            </table>
          </div>

          {/* Recent Exports */}
          <div className="section-title" style={{ marginTop: '1rem' }}><h3>Recent Exports (Last 10)</h3></div>
          <table>
            <thead><tr><th>BL Date</th><th>Vessel</th><th>Location</th><th>Entity</th><th>Block</th><th>Volume</th><th>Consignee</th><th>Quarter</th></tr></thead>
            <tbody>
              {(dash.recent_exports || []).length === 0 ? <tr><td colSpan="8" className="empty-table">No recent exports</td></tr> :
                dash.recent_exports.map((tx) => (
                  <tr key={tx.id}>
                    <td>{tx.bl_date}</td><td>{tx.vessel_name || '-'}</td><td>{tx.location_name || tx.location_code}</td>
                    <td>{tx.entity_name || tx.entity_code}</td><td>{tx.block_name || tx.block_code}</td>
                    <td>{fmt(tx.volume)}</td><td>{tx.consignee}</td><td>{tx.quarter}</td>
                  </tr>
                ))
              }
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}

function DataEntryTab({ loggedInUser, canManage }) {
  const [txns, setTxns] = useState([])
  const [locations, setLocations] = useState([])
  const [entities, setEntities] = useState([])
  const [blocks, setBlocks] = useState([])
  const [entityBlocks, setEntityBlocks] = useState([])
  const [consignees, setConsignees] = useState([])
  const [loading, setLoading] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [filters, setFilters] = useState({ location_code: '', quarter: '' })
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({ bl_date: '', location_code: '', entity_code: '', block_code: '', volume: '', consignee: '', destination: '', country: '', vessel_name: '', permit_number: '', remarks: '', block_entries: [] })
  const [permitOverride, setPermitOverride] = useState(false)
  const [permits, setPermits] = useState([])
  const [showBulk, setShowBulk] = useState(false)
  const [bulkItems, setBulkItems] = useState([])
  const [bulkErrors, setBulkErrors] = useState([])

  const resetForm = () => {
    setEditing(null)
    setPermitOverride(false)
    setForm({ bl_date: '', location_code: '', entity_code: '', block_code: '', volume: '', consignee: '', destination: '', country: '', vessel_name: '', permit_number: '', remarks: '', block_entries: [] })
  }

  const load = async () => {
    try {
      setLoading(true)
      const [t, l, e, b, p, eb, cs] = await Promise.all([getExportTransactions(filters), getExportLocations(), getExportEntities(), getExportBlocks(), getExportPermits(), getEntityBlocks(), getExportConsignees()])
      setTxns(Array.isArray(t) ? t : [])
      setLocations(Array.isArray(l) ? l : [])
      setEntities(Array.isArray(e) ? e : [])
      setBlocks(Array.isArray(b) ? b : [])
      setPermits(Array.isArray(p) ? p : [])
      setEntityBlocks(Array.isArray(eb) ? eb : [])
      setConsignees(Array.isArray(cs) ? cs : [])
    } catch (e) { setErrorMsg(e.message || 'Failed to load') } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const filteredBlocks = useMemo(() => {
    if (!form.entity_code) return blocks
    // Get block_codes linked to this entity via entity-block mapping
    const linkedBlockCodes = entityBlocks
      .filter((eb) => eb.entity_code === form.entity_code)
      .map((eb) => eb.block_code)
    return blocks.filter((b) => linkedBlockCodes.includes(b.block_code))
  }, [blocks, entityBlocks, form.entity_code])

  const buildBlockEntries = (entityCode, selectedBlockCode = '', selectedVolume = '') => {
    if (!entityCode) return []
    const linkedBlockCodes = entityBlocks
      .filter((eb) => eb.entity_code === entityCode)
      .map((eb) => eb.block_code)
    const options = blocks.filter((b) => linkedBlockCodes.includes(b.block_code))
    return options.map((b) => ({ block_code: b.block_code, volume: selectedBlockCode === b.block_code ? Number(selectedVolume || 0) : 0 }))
  }

  const updateBlockEntry = (idx, value) => {
    setForm((c) => {
      const copy = [...(c.block_entries || [])]
      copy[idx] = { ...copy[idx], volume: value }
      return { ...c, block_entries: copy }
    })
  }

  const handleEntityChange = (e) => {
    const entityCode = e.target.value
    setPermitOverride(false)
    setForm((c) => ({ ...c, entity_code: entityCode, block_entries: buildBlockEntries(entityCode) }))
  }

  const permitIssues = useMemo(() => {
    if (!form.permit_number) return []
    const entries = (form.block_entries || []).length
      ? form.block_entries
      : (form.block_code ? [{ block_code: form.block_code, volume: Number(form.volume || 0) }] : [])
    if (!entries.length) return []
    return entries.reduce((acc, entry) => {
      const volume = Number(entry.volume || 0)
      if (!volume) return acc
      const permit = permits.find((p) => p.permit_number === form.permit_number && p.location_code === form.location_code && p.entity_code === form.entity_code && p.block_code === entry.block_code)
      if (!permit) return acc
      const remaining = Number(permit.remaining_volume || 0)
      if (volume > remaining) {
        acc.push({
          permit_number: permit.permit_number,
          block_code: entry.block_code,
          required_volume: volume,
          remaining_volume: remaining,
        })
      }
      return acc
    }, [])
  }, [form.bl_date, form.location_code, form.entity_code, form.permit_number, form.block_entries, form.block_code, form.volume, permits])

  const startEdit = (tx) => {
    setEditing(tx)
    setForm({
      bl_date: tx.bl_date || '', location_code: tx.location_code || '', entity_code: tx.entity_code || '',
      block_code: tx.block_code || '', volume: tx.volume || '', consignee: tx.consignee || '',
      destination: tx.destination || '', country: tx.country || '', vessel_name: tx.vessel_name || '',
      permit_number: tx.permit_number || '', remarks: tx.remarks || '', block_entries: buildBlockEntries(tx.entity_code || '', tx.block_code || '', tx.volume || 0),
    })
  }

  const save = async () => {
    if (!canManage) { setErrorMsg('No permission'); return }
    if (permitIssues.length && !permitOverride) {
      setErrorMsg('Permit volume exceeds remaining volume. Check the override box to save anyway.')
      return
    }
    try {
      setLoading(true)
      const payload = {
        ...form,
        volume: Number(form.volume || 0),
        override: permitOverride,
        block_entries: (form.block_entries || []).length
          ? form.block_entries.map((entry) => ({ block_code: entry.block_code, volume: Number(entry.volume || 0) }))
          : (form.block_code ? [{ block_code: form.block_code, volume: Number(form.volume || 0) }] : []),
      }
      if (editing?.id) await updateExportTransaction(editing.id, payload)
      else await createExportTransaction(payload)
      resetForm(); await load()
      setSuccessMsg(editing?.id ? 'Export updated' : 'Export created')
    } catch (e) { setErrorMsg(e.message || 'Save failed') } finally { setLoading(false) }
  }

  const remove = async (tx) => {
    if (!canManage || !window.confirm(`Delete export for ${tx.bl_date}?`)) return
    try {
      setLoading(true); await deleteExportTransaction(tx.id)
      setSuccessMsg('Deleted'); await load()
    } catch (e) { setErrorMsg(e.message) } finally { setLoading(false) }
  }

  const getQ = (d) => {
    if (!d) return ''
    const dt = new Date(d)
    return `Q${Math.floor(dt.getMonth() / 3) + 1}_${dt.getFullYear()}`
  }

  const parseCSV = (text) => {
    const lines = []
    let current = ''
    let inQuotes = false
    for (let i = 0; i < text.length; i++) {
      const char = text[i]
      const nextChar = text[i + 1]
      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          current += '"'
          i++
        } else {
          inQuotes = !inQuotes
        }
      } else if (char === ',' && !inQuotes) {
        lines.push(current)
        current = ''
      } else if ((char === '\n' || char === '\r') && !inQuotes) {
        if (char === '\r' && nextChar === '\n') i++
        lines.push(current)
        current = ''
      } else {
        current += char
      }
    }
    lines.push(current)
    return lines
  }

  const parseCSVFile = (text) => {
    const rawLines = parseCSV(text).filter((l) => l.trim())
    if (rawLines.length < 2) throw new Error('CSV must have header + at least 1 data row')
    const headers = parseCSV(rawLines[0]).map((h) => h.trim().toLowerCase())
    const required = ['bl_date', 'location_code', 'entity_code', 'block_code', 'volume']
    const missing = required.filter((r) => !headers.includes(r))
    if (missing.length) throw new Error(`Missing required columns: ${missing.join(', ')}`)
    const items = []
    const errors = []
    rawLines.slice(1).forEach((line, rowIdx) => {
      const vals = parseCSV(line)
      if (vals.every((v) => !v.trim())) return
      const obj = {}
      headers.forEach((h, i) => { obj[h] = (vals[i] || '').trim() })
      const rowErrors = validateBulkRow(obj, rowIdx + 2)
      if (rowErrors.length) {
        errors.push({ row: rowIdx + 2, data: obj, errors: rowErrors })
      } else {
        items.push(obj)
      }
    })
    return { items, errors }
  }

  const validateBulkRow = (row, rowNum) => {
    const errs = []
    if (!row.bl_date) errs.push('BL Date is required')
    else if (isNaN(Date.parse(row.bl_date))) errs.push('Invalid BL Date format (use YYYY-MM-DD)')
    if (!row.location_code) errs.push('Location Code is required')
    if (!row.entity_code) errs.push('Entity Code is required')
    if (!row.block_code) errs.push('Block Code is required')
    if (!row.consignee) errs.push('Consignee is required')
    if (!row.destination) errs.push('Destination is required')
    if (!row.volume || isNaN(Number(row.volume))) errs.push('Volume must be a number')
    else if (Number(row.volume) <= 0) errs.push('Volume must be positive')
    if (row.country && !COUNTRIES.includes(row.country)) {
      errs.push(`Invalid country: ${row.country}`)
    }
    return errs
  }

  const downloadCSVTemplate = () => {
    const headers = ['bl_date', 'location_code', 'entity_code', 'block_code', 'volume', 'consignee', 'destination', 'country', 'vessel_name', 'permit_number', 'remarks']
    const sample = ['2024-01-15', 'LOC001', 'ENT001', 'BLK001', '1000', 'Consignee Name', 'Destination Port', 'United States', 'Vessel Name', 'PERMIT-001', '']
    const csv = [headers.join(','), sample.join(',')].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'export_bulk_upload_template.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleFileUpload = (e) => {
    const file = e.target.files[0]
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setErrorMsg('Please select a CSV file')
      return
    }
    const reader = new FileReader()
    reader.onload = (evt) => {
      try {
        const { items, errors } = parseCSVFile(evt.target.result)
        setBulkItems(items)
        setBulkErrors(errors)
        if (errors.length) {
          setErrorMsg(`${errors.length} row(s) have validation errors. Please fix before upload.`)
        } else {
          setErrorMsg('')
        }
      } catch (err) {
        setErrorMsg(err.message)
        setBulkItems([])
        setBulkErrors([])
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const handleBulkUpload = async () => {
    if (!canManage || !bulkItems.length) { setErrorMsg('No valid items to upload'); return }
    if (bulkErrors.length) { setErrorMsg('Fix validation errors before upload'); return }
    try {
      setLoading(true)
      const result = await bulkUploadExport(bulkItems)
      setBulkErrors(result.errors || [])
      setSuccessMsg(`Bulk upload: ${result.created} created, ${result.errors.length} errors`)
      setBulkItems([]); setShowBulk(false); await load()
    } catch (e) { setErrorMsg(e.message) } finally { setLoading(false) }
  }

  const updateBulkRow = (idx, field, value) => {
    setBulkItems((c) => { const copy = [...c]; copy[idx] = { ...copy[idx], [field]: value }; return copy })
    if (bulkErrors.some((e) => e.row === idx + 2)) {
      setBulkErrors((prev) => prev.filter((e) => e.row !== idx + 2))
    }
  }

  const getRowValidationErrors = (idx) => {
    const err = bulkErrors.find((e) => e.row === idx + 2)
    return err ? err.errors : []
  }

  return (
    <div>
      <div className="report-filter-panel no-print" style={{ marginTop: '1rem' }}>
        <div>
          <label>Location</label>
          <select value={filters.location_code} onChange={(e) => setFilters((c) => ({ ...c, location_code: e.target.value }))}>
            <option value="">All</option>
            {sortOptions(locations, 'location_name', 'location_code')}
          </select>
        </div>
        <div className="report-filter-actions">
          <button type="button" onClick={load} disabled={loading}>{loading ? 'Loading...' : 'Load'}</button>
          <button type="button" onClick={() => { resetForm(); setShowBulk(!showBulk) }} disabled={!canManage}>{showBulk ? 'Hide Bulk' : 'Bulk Upload'}</button>
        </div>
      </div>
      {successMsg && <div className="success-box" onClick={() => setSuccessMsg('')}>{successMsg}</div>}
      {errorMsg && <div className="error-box" onClick={() => setErrorMsg('')}>{errorMsg}</div>}

      {showBulk && (
        <div style={{ border: '1px solid #ccc', padding: '1rem', margin: '1rem 0', borderRadius: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <h4 style={{ margin: 0 }}>Bulk Upload</h4>
            <button type="button" onClick={downloadCSVTemplate} style={{ padding: '0.25rem 0.75rem', fontSize: '0.85rem' }}>Download Template</button>
          </div>
          <p style={{ margin: '0.5rem 0', color: '#555', fontSize: '0.9rem' }}>CSV columns: bl_date, location_code, entity_code, block_code, volume, consignee, destination, country, vessel_name, permit_number, remarks</p>
          <input type="file" accept=".csv" onChange={handleFileUpload} style={{ marginBottom: '0.5rem' }} />
          {bulkItems.length > 0 && (
            <div style={{ maxHeight: '400px', overflow: 'auto', marginTop: '0.5rem' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#f5f5f5', position: 'sticky', top: 0 }}>
                    <th style={{ padding: '0.5rem', textAlign: 'left', border: '1px solid #ddd' }}>#</th>
                    <th style={{ padding: '0.5rem', textAlign: 'left', border: '1px solid #ddd' }}>BL Date</th>
                    <th style={{ padding: '0.5rem', textAlign: 'left', border: '1px solid #ddd' }}>Location</th>
                    <th style={{ padding: '0.5rem', textAlign: 'left', border: '1px solid #ddd' }}>Entity</th>
                    <th style={{ padding: '0.5rem', textAlign: 'left', border: '1px solid #ddd' }}>Block</th>
                    <th style={{ padding: '0.5rem', textAlign: 'left', border: '1px solid #ddd' }}>Volume</th>
                    <th style={{ padding: '0.5rem', textAlign: 'left', border: '1px solid #ddd' }}>Consignee</th>
                    <th style={{ padding: '0.5rem', textAlign: 'left', border: '1px solid #ddd' }}>Destination</th>
                    <th style={{ padding: '0.5rem', textAlign: 'left', border: '1px solid #ddd' }}>Country</th>
                    <th style={{ padding: '0.5rem', textAlign: 'left', border: '1px solid #ddd' }}>Vessel Name</th>
                    <th style={{ padding: '0.5rem', textAlign: 'left', border: '1px solid #ddd' }}>Permit #</th>
                  </tr>
                </thead>
                <tbody>
                  {bulkItems.map((item, idx) => {
                    const rowErrors = getRowValidationErrors(idx)
                    return (
                      <tr key={idx} style={{ background: rowErrors.length ? '#fff3cd' : '' }}>
                        <td style={{ padding: '0.5rem', border: '1px solid #ddd' }}>{idx + 1}</td>
                        <td style={{ padding: '0.5rem', border: '1px solid #ddd' }}>
                          <input type="date" style={{ width: '120px' }} value={item.bl_date} onChange={(e) => updateBulkRow(idx, 'bl_date', e.target.value)} />
                        </td>
                        <td style={{ padding: '0.5rem', border: '1px solid #ddd' }}>
                          <select style={{ width: '100px' }} value={item.location_code} onChange={(e) => updateBulkRow(idx, 'location_code', e.target.value)} disabled={!canManage || loading}>
                            <option value="">Select</option>
                            {sortOptions(locations, 'location_name', 'location_code')}
                          </select>
                        </td>
                        <td style={{ padding: '0.5rem', border: '1px solid #ddd' }}>
                          <select style={{ width: '100px' }} value={item.entity_code} onChange={(e) => updateBulkRow(idx, 'entity_code', e.target.value)} disabled={!canManage || loading}>
                            <option value="">Select</option>
                            {sortOptions(entities, 'entity_name', 'entity_code')}
                          </select>
                        </td>
                        <td style={{ padding: '0.5rem', border: '1px solid #ddd' }}>
                          <select style={{ width: '100px' }} value={item.block_code} onChange={(e) => updateBulkRow(idx, 'block_code', e.target.value)} disabled={!canManage || loading}>
                            <option value="">Select</option>
                            {sortOptions(blocks, 'block_name', 'block_code')}
                          </select>
                        </td>
                        <td style={{ padding: '0.5rem', border: '1px solid #ddd' }}>
                          <input type="number" step="0.01" style={{ width: '90px' }} value={item.volume} onChange={(e) => updateBulkRow(idx, 'volume', e.target.value)} disabled={!canManage || loading} />
                        </td>
                        <td style={{ padding: '0.5rem', border: '1px solid #ddd' }}>
                          <select style={{ width: '120px' }} value={item.consignee} onChange={(e) => updateBulkRow(idx, 'consignee', e.target.value)} disabled={!canManage || loading}>
                            <option value="">Select</option>
                            {sortOptions(consignees, 'consignee_name', 'consignee_name')}
                          </select>
                        </td>
                        <td style={{ padding: '0.5rem', border: '1px solid #ddd' }}>
                          <input style={{ width: '100px' }} value={item.destination} onChange={(e) => updateBulkRow(idx, 'destination', e.target.value)} disabled={!canManage || loading} />
                        </td>
                        <td style={{ padding: '0.5rem', border: '1px solid #ddd' }}>
                          <select style={{ width: '100px' }} value={item.country} onChange={(e) => updateBulkRow(idx, 'country', e.target.value)} disabled={!canManage || loading}>
                            <option value="">Select</option>
                            {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
                          </select>
                        </td>
                        <td style={{ padding: '0.5rem', border: '1px solid #ddd' }}>
                          <input style={{ width: '100px' }} value={item.vessel_name || ''} onChange={(e) => updateBulkRow(idx, 'vessel_name', e.target.value)} disabled={!canManage || loading} />
                        </td>
                        <td style={{ padding: '0.5rem', border: '1px solid #ddd' }}>
                          <input style={{ width: '100px' }} value={item.permit_number} onChange={(e) => updateBulkRow(idx, 'permit_number', e.target.value)} disabled={!canManage || loading} />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <div className="form-actions" style={{ marginTop: '0.75rem' }}>
                <button type="button" onClick={handleBulkUpload} disabled={loading || !canManage || bulkErrors.length > 0}>{loading ? 'Uploading...' : `Upload ${bulkItems.length}`}</button>
                {bulkErrors.length > 0 && <span style={{ marginLeft: '1rem', color: '#dc3545', fontSize: '0.9rem' }}>Fix {bulkErrors.length} error(s) before upload</span>}
              </div>
              {bulkErrors.length > 0 && (
                <div className="error-box" style={{ marginTop: '0.75rem', fontSize: '0.85rem' }}>
                  <strong>Validation Errors:</strong>
                  {bulkErrors.map((e, i) => (
                    <div key={i} style={{ marginTop: '0.25rem', padding: '0.25rem', background: '#fff', border: '1px solid #f5c6cb', borderRadius: '4px' }}>
                      <strong>Row {e.row}:</strong> {e.errors.join('; ')}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <form onSubmit={(e) => { e.preventDefault(); save() }} style={{ margin: '1rem 0' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.5rem' }}>
          <div><label>BL Date *</label><input type="date" value={form.bl_date} onChange={(e) => setForm((c) => ({ ...c, bl_date: e.target.value }))} required disabled={!canManage || loading} /></div>
          <div><label>Vessel Name</label><input value={form.vessel_name} onChange={(e) => setForm((c) => ({ ...c, vessel_name: e.target.value }))} disabled={!canManage || loading} /></div>
          <div><label>Location *</label>
            <select value={form.location_code} onChange={(e) => setForm((c) => ({ ...c, location_code: e.target.value }))} required disabled={!canManage || loading}>
              <option value="">Select</option>
              {sortOptions(locations, 'location_name', 'location_code')}
            </select>
          </div>
          <div><label>Entity *</label>
            <select value={form.entity_code} onChange={handleEntityChange} required disabled={!canManage || loading}>
              <option value="">Select</option>
              {sortOptions(entities, 'entity_name', 'entity_code')}
            </select>
          </div>
          <div><label>Quarter (auto)</label><input value={getQ(form.bl_date)} disabled /></div>
          <div><label>Consignee *</label>
            <select value={form.consignee} onChange={(e) => setForm((c) => ({ ...c, consignee: e.target.value }))} required disabled={!canManage || loading}>
              <option value="">Select</option>
              {sortOptions(consignees, 'consignee_name', 'consignee_name')}
            </select>
          </div>
          <div><label>Destination *</label><input value={form.destination} onChange={(e) => setForm((c) => ({ ...c, destination: e.target.value }))} required disabled={!canManage || loading} /></div>
          <div><label>Country *</label>
            <select value={form.country} onChange={(e) => setForm((c) => ({ ...c, country: e.target.value }))} required disabled={!canManage || loading}>
              <option value="">Select Country</option>
              {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div><label>Permit #</label><input value={form.permit_number} onChange={(e) => setForm((c) => ({ ...c, permit_number: e.target.value }))} disabled={!canManage || loading} /></div>
          <div><label>Remarks</label><textarea rows="2" value={form.remarks} onChange={(e) => setForm((c) => ({ ...c, remarks: e.target.value }))} disabled={!canManage || loading} /></div>
        </div>
        {form.entity_code && filteredBlocks.length > 0 && (
          <div style={{ marginTop: '1rem', border: '1px solid #ddd', borderRadius: '8px', padding: '0.75rem' }}>
            <div style={{ fontWeight: 600, marginBottom: '0.5rem' }}>Block volumes</div>
            <table style={{ width: '100%' }}>
              <thead><tr><th style={{ textAlign: 'left' }}>Block</th><th style={{ textAlign: 'left' }}>Volume</th></tr></thead>
              <tbody>
                {(form.block_entries || []).map((entry, idx) => (
                  <tr key={`${entry.block_code}-${idx}`}>
                    <td>{entry.block_code}</td>
                    <td><input type="number" step="0.01" value={entry.volume || 0} onChange={(e) => updateBlockEntry(idx, e.target.value)} disabled={!canManage || loading} /></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ fontWeight: 700 }}>
                  <td style={{ borderTop: '2px solid #333', padding: '0.5rem 0' }}>Total</td>
                  <td style={{ borderTop: '2px solid #333', padding: '0.5rem 0' }}>{fmt((form.block_entries || []).reduce((s, e) => s + Number(e.volume || 0), 0))}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        {!form.entity_code && (
          <div className="info-box" style={{ marginTop: '1rem' }}>Select an entity to show all available blocks and enter volumes per block.</div>
        )}
        {permitIssues.length > 0 && (
          <div className="warn-box" style={{ marginTop: '1rem', background: '#fff3cd', border: '1px solid #ffc107', padding: '0.75rem', borderRadius: '8px' }}>
            <strong>Permit warning:</strong> The requested volume exceeds the remaining permit volume for {permitIssues.map((issue) => `${issue.block_code}`).join(', ')}.
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem' }}>
              <input type="checkbox" checked={permitOverride} onChange={(e) => setPermitOverride(e.target.checked)} />
              Override and save anyway
            </label>
          </div>
        )}
        <div className="form-actions" style={{ marginTop: '1rem' }}>
          <button type="submit" disabled={loading || !canManage}>{loading ? 'Saving...' : editing ? 'Update' : 'Add Export'}</button>
          <button type="button" onClick={resetForm} disabled={loading}>Clear</button>
        </div>
      </form>

      <div className="section-title"><h3>Export Transactions ({txns.length})</h3></div>
      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead><tr><th>BL Date</th><th>Vessel</th><th>Quarter</th><th>Location</th><th>Entity</th><th colSpan={2}>Consignee / Dest.</th><th>Permit #</th><th>Remarks</th><th>Action</th></tr></thead>
          <tbody>
            {!txns.length ? <tr><td colSpan="10" className="empty-table">No export transactions.</td></tr> :
              (() => {
                const grouped = {}
                txns.forEach((tx) => {
                  const key = `${tx.bl_date}|${tx.vessel_name || ''}|${tx.location_code}|${tx.entity_code}|${tx.consignee}|${tx.destination}|${tx.country}|${tx.quarter}|${tx.permit_number || ''}`
                  if (!grouped[key]) {
                    grouped[key] = { ...tx, blockEntries: [] }
                  }
                  grouped[key].blockEntries.push({ block_name: tx.block_name || tx.block_code, block_code: tx.block_code, volume: tx.volume })
                })
                return Object.values(grouped).map((g) => (
                  <tr key={g.id}>
                    <td rowSpan={1}>{g.bl_date}</td><td>{g.vessel_name || '-'}</td><td>{g.quarter}</td>
                    <td>{g.location_name || g.location_code}</td><td>{g.entity_name || g.entity_code}</td>
                    <td colSpan={2}>{g.consignee} / {g.destination} / {g.country}</td>
                    <td>{g.permit_number || '-'}</td>
                    <td style={{ maxWidth: '120px', whiteSpace: 'normal', wordBreak: 'break-word' }}>{g.remarks || '-'}</td>
                    <td>
                      {g.blockEntries.map((be, bi) => (
                        <div key={bi} style={{ fontSize: '0.85rem', whiteSpace: 'nowrap' }}>{be.block_name}: {fmt(be.volume)}</div>
                      ))}
                      <button onClick={() => startEdit(txns.find(t => t.id === g.id))} disabled={!canManage} style={{ marginTop: '0.25rem' }}>Edit</button>
                      <button onClick={() => remove(txns.find(t => t.id === g.id))} disabled={!canManage}>Delete</button>
                    </td>
                  </tr>
                ))
              })()
            }
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ReportsTab({ loggedInUser }) {
  const profile = useCompanyPrintProfile()

  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(false)
  const [locations, setLocations] = useState([])
  const [filters, setFilters] = useState({ location_code: '', quarter: '', from_date: '', to_date: '', country: '' })
  const [quarters, setQuarters] = useState([])

  const load = async () => {
    try {
      setLoading(true)
      const [rpt, locs] = await Promise.all([getExportReport(filters), getExportLocations()])
      setReport(rpt)
      setLocations(Array.isArray(locs) ? locs : [])
      if (rpt?.rows) {
        const qs = [...new Set(rpt.rows.map((r) => r.quarter))].sort().reverse()
        setQuarters(qs)
      }
    } catch (e) { console.error(e) } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const escCSV = (v) => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }

  const exportCSV = () => {
    if (!report?.rows?.length) return
    const headers = ['BL Date', 'Vessel', 'Quarter', 'Location', 'Entity', 'Block', 'Volume', 'Consignee', 'Destination', 'Country', 'Permit #', 'Remarks']
    const rows = report.rows.map((r) => [r.bl_date, r.vessel_name || '', r.quarter, r.location_name || r.location_code, r.entity_name || r.entity_code, r.block_name || r.block_code, r.volume, r.consignee, r.destination, r.country, r.permit_number || '', r.remarks || ''].map(escCSV).join(','))
    const blob = new Blob(['\ufeff' + headers.join(',') + '\n' + rows.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `export_report_${new Date().toISOString().slice(0, 10)}.csv`
    a.click(); URL.revokeObjectURL(url)
  }

  return (
    <div>
      <CompanyPrintHeader profile={profile} defaultSubtitle="Export Report" />
      <div className="report-filter-panel no-print" style={{ marginTop: '1rem' }}>
        <div><label>Location</label>
          <select value={filters.location_code} onChange={(e) => setFilters((c) => ({ ...c, location_code: e.target.value }))}>
            <option value="">All</option>
            {sortOptions(locations, 'location_name', 'location_code')}
          </select>
        </div>
        <div><label>Quarter</label>
          <select value={filters.quarter} onChange={(e) => setFilters((c) => ({ ...c, quarter: e.target.value }))}>
            <option value="">All</option>
            {quarters.map((q) => <option key={q} value={q}>{q}</option>)}
          </select>
        </div>
        <div><label>From</label><input type="date" value={filters.from_date} onChange={(e) => setFilters((c) => ({ ...c, from_date: e.target.value }))} /></div>
        <div><label>To</label><input type="date" value={filters.to_date} onChange={(e) => setFilters((c) => ({ ...c, to_date: e.target.value }))} /></div>
        <div><label>Country</label>
          <select value={filters.country} onChange={(e) => setFilters((c) => ({ ...c, country: e.target.value }))}>
            <option value="">All</option>
            {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="report-filter-actions">
          <button onClick={load} disabled={loading}>{loading ? 'Loading...' : 'Generate'}</button>
          <button onClick={exportCSV} disabled={!report?.rows?.length}>CSV</button>
          <button onClick={() => window.print()} disabled={!report?.rows?.length}>Print/PDF</button>
        </div>
      </div>
      {report && (
        <div>
          <div className="section-title">
            <h3>Export Report</h3>
            <span className="record-count">{report.total_rows} Records | Total: {fmt(report.total_volume)}</span>
          </div>
          <table>
            <thead><tr><th>BL Date</th><th>Vessel</th><th>Quarter</th><th>Location</th><th>Entity</th><th>Block</th><th>Volume</th><th>Consignee</th><th>Destination</th><th>Country</th><th>Permit #</th><th>Remarks</th></tr></thead>
            <tbody>
              {!report.rows?.length ? <tr><td colSpan="12" className="empty-table">No data</td></tr> :
                report.rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.bl_date}</td><td>{r.vessel_name || '-'}</td><td>{r.quarter}</td><td>{r.location_name || r.location_code}</td>
                    <td>{r.entity_name || r.entity_code}</td><td>{r.block_name || r.block_code}</td>
                    <td>{fmt(r.volume)}</td><td>{r.consignee}</td><td>{r.destination}</td><td>{r.country}</td><td>{r.permit_number || '-'}</td><td style={{ maxWidth: '150px', whiteSpace: 'normal', wordBreak: 'break-word' }}>{r.remarks || '-'}</td>
                  </tr>
                ))
              }
            </tbody>
          </table>
        </div>
      )}
      <CompanyPrintFooter profile={profile} />
    </div>
  )
}

function ConfigurationTab({ loggedInUser, canManage }) {
  const [successMsg, setSuccessMsg] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [activeConfigTab, setActiveConfigTab] = useState('locations')
  const configTabs = [
    { key: 'locations', label: 'Locations' },
    { key: 'entities', label: 'Entities' },
    { key: 'blocks', label: 'Blocks' },
    { key: 'permits', label: 'Permits' },
    { key: 'consignees', label: 'Consignees' },
    { key: 'settings', label: 'Settings' },
  ]
  return (
    <div>
      <div className="tabs no-print" style={{ marginTop: '1rem' }}>
        {configTabs.map((t) => (
          <button key={t.key} type="button" className={activeConfigTab === t.key ? 'tab-active' : ''} onClick={() => setActiveConfigTab(t.key)}>{t.label}</button>
        ))}
      </div>
      {successMsg && <div className="success-box" onClick={() => setSuccessMsg('')}>{successMsg}</div>}
      {errorMsg && <div className="error-box" onClick={() => setErrorMsg('')}>{errorMsg}</div>}
      {activeConfigTab === 'locations' && <LocationConfig canManage={canManage} />}
      {activeConfigTab === 'entities' && <EntityConfig canManage={canManage} />}
      {activeConfigTab === 'blocks' && <BlockConfig canManage={canManage} />}
      {activeConfigTab === 'permits' && <PermitConfig canManage={canManage} />}
      {activeConfigTab === 'consignees' && <ConsigneeConfig canManage={canManage} />}
      {activeConfigTab === 'settings' && <SettingsConfig canManage={canManage} />}
    </div>
  )
}

function LocationConfig({ canManage }) {
  const [items, setItems] = useState([])
  const [form, setForm] = useState({ location_name: '', location_code: '', description: '' })
  const [editing, setEditing] = useState(null)
  const [loading, setLoading] = useState(false)

  const load = async () => {
    try {
      setLoading(true)
      const data = await getExportLocations()
      setItems(Array.isArray(data) ? data : [])
    } catch (e) { alert(e.message) } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const save = async () => {
    if (!canManage) return
    try {
      setLoading(true)
      if (editing?.id) await updateExportLocation(editing.id, form)
      else await createExportLocation(form)
      setEditing(null); setForm({ location_name: '', location_code: '', description: '' }); await load()
    } catch (e) { alert(e.message) } finally { setLoading(false) }
  }

  const remove = async (item) => {
    if (!canManage || !window.confirm(`Delete ${item.location_name}?`)) return
    try { await deleteExportLocation(item.id); await load() } catch (e) { alert(e.message) }
  }

  return (
    <div>
      <form onSubmit={(e) => { e.preventDefault(); save() }} style={{ margin: '1rem 0', display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'end' }}>
        <div><label>Name *</label><input value={form.location_name} onChange={(e) => setForm((c) => ({ ...c, location_name: e.target.value }))} required disabled={!canManage} /></div>
        <div><label>Code *</label><input value={form.location_code} onChange={(e) => setForm((c) => ({ ...c, location_code: e.target.value }))} required disabled={!canManage} /></div>
        <div><label>Description</label><input value={form.description} onChange={(e) => setForm((c) => ({ ...c, description: e.target.value }))} disabled={!canManage} /></div>
        <div>
          <button type="submit" disabled={loading || !canManage}>{loading ? '...' : editing?.id ? 'Update' : 'Add'}</button>
          {editing && <button type="button" onClick={() => { setEditing(null); setForm({ location_name: '', location_code: '', description: '' }) }}>Cancel</button>}
        </div>
      </form>
      <table>
        <thead><tr><th>Name</th><th>Code</th><th>Description</th><th>Status</th><th>Action</th></tr></thead>
        <tbody>
          {!items.length ? <tr><td colSpan="5" className="empty-table">No locations</td></tr> :
            items.map((i) => (
              <tr key={i.id}>
                <td>{i.location_name}</td><td>{i.location_code}</td><td>{i.description || '-'}</td><td>{i.status}</td>
                <td><button onClick={() => { setEditing(i); setForm({ location_name: i.location_name, location_code: i.location_code, description: i.description || '' }) }} disabled={!canManage}>Edit</button>
                <button onClick={() => remove(i)} disabled={!canManage}>Delete</button></td>
              </tr>
            ))
          }
        </tbody>
      </table>
    </div>
  )
}

function EntityConfig({ canManage }) {
  const [items, setItems] = useState([])
  const [form, setForm] = useState({ entity_name: '', entity_code: '', description: '' })
  const [editing, setEditing] = useState(null)
  const [loading, setLoading] = useState(false)

  const load = async () => {
    try {
      setLoading(true)
      const data = await getExportEntities()
      setItems(Array.isArray(data) ? data : [])
    } catch (e) { alert(e.message) } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const save = async () => {
    if (!canManage) return
    try {
      setLoading(true)
      if (editing?.id) await updateExportEntity(editing.id, form)
      else await createExportEntity(form)
      setEditing(null); setForm({ entity_name: '', entity_code: '', description: '' }); await load()
    } catch (e) { alert(e.message) } finally { setLoading(false) }
  }

  const remove = async (item) => {
    if (!canManage || !window.confirm(`Delete ${item.entity_name}?`)) return
    try { await deleteExportEntity(item.id); await load() } catch (e) { alert(e.message) }
  }

  return (
    <div>
      <form onSubmit={(e) => { e.preventDefault(); save() }} style={{ margin: '1rem 0', display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'end' }}>
        <div><label>Name *</label><input value={form.entity_name} onChange={(e) => setForm((c) => ({ ...c, entity_name: e.target.value }))} required disabled={!canManage} /></div>
        <div><label>Code *</label><input value={form.entity_code} onChange={(e) => setForm((c) => ({ ...c, entity_code: e.target.value }))} required disabled={!canManage} /></div>
        <div><label>Description</label><input value={form.description} onChange={(e) => setForm((c) => ({ ...c, description: e.target.value }))} disabled={!canManage} /></div>
        <div>
          <button type="submit" disabled={loading || !canManage}>{loading ? '...' : editing?.id ? 'Update' : 'Add'}</button>
          {editing && <button onClick={() => { setEditing(null); setForm({ entity_name: '', entity_code: '', description: '' }) }}>Cancel</button>}
        </div>
      </form>
      <table>
        <thead><tr><th>Name</th><th>Code</th><th>Description</th><th>Status</th><th>Action</th></tr></thead>
        <tbody>
          {!items.length ? <tr><td colSpan="5" className="empty-table">No entities</td></tr> :
            items.map((i) => (
              <tr key={i.id}>
                <td>{i.entity_name}</td><td>{i.entity_code}</td><td>{i.description || '-'}</td><td>{i.status}</td>
                <td><button onClick={() => { setEditing(i); setForm({ entity_name: i.entity_name, entity_code: i.entity_code, description: i.description || '' }) }} disabled={!canManage}>Edit</button>
                <button onClick={() => remove(i)} disabled={!canManage}>Delete</button></td>
              </tr>
            ))
          }
        </tbody>
      </table>
    </div>
  )
}

function BlockConfig({ canManage }) {
  const [items, setItems] = useState([])
  const [entities, setEntities] = useState([])
  const [blocks, setBlocks] = useState([])
  const [form, setForm] = useState({ block_name: '', block_code: '', description: '' })
  const [editing, setEditing] = useState(null)
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState('blocks')
  const [entityBlockForm, setEntityBlockForm] = useState({ entity_code: '', block_code: '' })
  const [entityBlockEditing, setEntityBlockEditing] = useState(null)
  const [entityBlocks, setEntityBlocks] = useState([])

  const load = async () => {
    try {
      setLoading(true)
      const [blks, ents, ebs] = await Promise.all([getExportBlocks(), getExportEntities(), getEntityBlocks()])
      setItems(Array.isArray(blks) ? blks : [])
      setBlocks(Array.isArray(blks) ? blks : [])
      setEntities(Array.isArray(ents) ? ents : [])
      setEntityBlocks(Array.isArray(ebs) ? ebs : [])
    } catch (e) { alert(e.message) } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const save = async () => {
    if (!canManage) return
    try {
      setLoading(true)
      if (editing?.id) await updateExportBlock(editing.id, form)
      else await createExportBlock(form)
      setEditing(null); setForm({ block_name: '', block_code: '', description: '' }); await load()
    } catch (e) { alert(e.message) } finally { setLoading(false) }
  }

  const remove = async (item) => {
    if (!canManage || !window.confirm(`Delete ${item.block_name}?`)) return
    try { await deleteExportBlock(item.id); await load() } catch (e) { alert(e.message) }
  }

  const saveEntityBlock = async () => {
    if (!canManage) return
    try {
      setLoading(true)
      if (entityBlockEditing?.id) {
        // For editing, we need to delete and recreate since it's a composite key
        await deleteEntityBlock(entityBlockEditing.id)
      }
      await createEntityBlock(entityBlockForm.entity_code, entityBlockForm.block_code)
      setEntityBlockEditing(null); setEntityBlockForm({ entity_code: '', block_code: '' }); await load()
    } catch (e) { alert(e.message) } finally { setLoading(false) }
  }

  const removeEntityBlock = async (item) => {
    if (!canManage || !window.confirm(`Delete mapping ${item.entity_name} - ${item.block_name}?`)) return
    try { await deleteEntityBlock(item.id); await load() } catch (e) { alert(e.message) }
  }

  const startEntityBlockEdit = (item) => {
    setEntityBlockEditing(item)
    setEntityBlockForm({ entity_code: item.entity_code, block_code: item.block_code })
  }

  const tabs = [
    { key: 'blocks', label: 'Blocks' },
    { key: 'entity-blocks', label: 'Entity-Block Mappings' },
  ]

  return (
    <div>
      <div className="tabs no-print" style={{ marginTop: '1rem' }}>
        {tabs.map((t) => (
          <button key={t.key} type="button" className={activeTab === t.key ? 'tab-active' : ''} onClick={() => setActiveTab(t.key)}>{t.label}</button>
        ))}
      </div>

      {activeTab === 'blocks' && (
        <div>
          <form onSubmit={(e) => { e.preventDefault(); save() }} style={{ margin: '1rem 0', display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'end' }}>
            <div><label>Name *</label><input value={form.block_name} onChange={(e) => setForm((c) => ({ ...c, block_name: e.target.value }))} required disabled={!canManage} /></div>
            <div><label>Code *</label><input value={form.block_code} onChange={(e) => setForm((c) => ({ ...c, block_code: e.target.value }))} required disabled={!canManage} /></div>
            <div><label>Description</label><input value={form.description} onChange={(e) => setForm((c) => ({ ...c, description: e.target.value }))} disabled={!canManage} /></div>
            <div>
              <button type="submit" disabled={loading || !canManage}>{loading ? '...' : editing?.id ? 'Update' : 'Add'}</button>
              {editing && <button type="button" onClick={() => { setEditing(null); setForm({ block_name: '', block_code: '', description: '' }) }}>Cancel</button>}
            </div>
          </form>
          <table>
            <thead><tr><th>Name</th><th>Code</th><th>Entities</th><th>Description</th><th>Status</th><th>Action</th></tr></thead>
            <tbody>
              {!items.length ? <tr><td colSpan="6" className="empty-table">No blocks</td></tr> :
                items.map((i) => (
                  <tr key={i.id}>
                    <td>{i.block_name}</td><td>{i.block_code}</td>
                    <td>{(i.entity_names || []).length ? i.entity_names.join(', ') : '—'}</td>
                    <td>{i.description || '-'}</td><td>{i.status}</td>
                    <td><button onClick={() => { setEditing(i); setForm({ block_name: i.block_name, block_code: i.block_code, description: i.description || '' }) }} disabled={!canManage}>Edit</button>
                    <button onClick={() => remove(i)} disabled={!canManage}>Delete</button></td>
                  </tr>
                ))
              }
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'entity-blocks' && (
        <div>
          <form onSubmit={(e) => { e.preventDefault(); saveEntityBlock() }} style={{ margin: '1rem 0', display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'end' }}>
            <div><label>Entity *</label>
              <select value={entityBlockForm.entity_code} onChange={(e) => setEntityBlockForm((c) => ({ ...c, entity_code: e.target.value }))} required disabled={!canManage}>
                <option value="">Select</option>
                {entities.map((e) => <option key={e.id} value={e.entity_code}>{e.entity_name}</option>)}
              </select>
            </div>
            <div><label>Block *</label>
              <select value={entityBlockForm.block_code} onChange={(e) => setEntityBlockForm((c) => ({ ...c, block_code: e.target.value }))} required disabled={!canManage}>
                <option value="">Select</option>
                {blocks.map((b) => <option key={b.id} value={b.block_code}>{b.block_name}</option>)}
              </select>
            </div>
            <div>
              <button type="submit" disabled={loading || !canManage}>{loading ? '...' : entityBlockEditing?.id ? 'Update' : 'Add Mapping'}</button>
              {entityBlockEditing && <button type="button" onClick={() => { setEntityBlockEditing(null); setEntityBlockForm({ entity_code: '', block_code: '' }) }}>Cancel</button>}
            </div>
          </form>
          <table>
            <thead><tr><th>Entity</th><th>Block</th><th>Action</th></tr></thead>
            <tbody>
              {!entityBlocks.length ? <tr><td colSpan="3" className="empty-table">No entity-block mappings</td></tr> :
                entityBlocks.map((i) => (
                  <tr key={i.id}>
                    <td>{i.entity_name} ({i.entity_code})</td><td>{i.block_name} ({i.block_code})</td>
                    <td><button onClick={() => startEntityBlockEdit(i)} disabled={!canManage}>Edit</button>
                    <button onClick={() => removeEntityBlock(i)} disabled={!canManage}>Delete</button></td>
                  </tr>
                ))
              }
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function PermitConfig({ canManage }) {
  const [items, setItems] = useState([])
  const [locations, setLocations] = useState([])
  const [entities, setEntities] = useState([])
  const [blocks, setBlocks] = useState([])
  const [entityBlocks, setEntityBlocks] = useState([])
  const getCurrentQuarter = () => {
    const m = new Date().getMonth()
    if (m < 3) return 'Q1'
    if (m < 6) return 'Q2'
    if (m < 9) return 'Q3'
    return 'Q4'
  }
  const [form, setForm] = useState({ permit_number: '', location_code: '', entity_code: '', block_code: '', block_codes: [], permit_quarter: getCurrentQuarter(), permit_year: new Date().getFullYear(), permit_volume: '', supplementary_permit: 'No', permit_status: 'Active', permit_remarks: '' })
  const [editing, setEditing] = useState(null)
  const [loading, setLoading] = useState(false)
  const [filters, setFilters] = useState({ location_code: '' })
  const [showBulk, setShowBulk] = useState(false)
  const [bulkItems, setBulkItems] = useState([])
  const [bulkErrors, setBulkErrors] = useState([])
  const [successMsg, setSuccessMsg] = useState('')
  const [errorMsg, setErrorMsg] = useState('')

  const load = async () => {
    try {
      setLoading(true)
      const [prms, locs, ents, blks, eb] = await Promise.all([getExportPermits(filters), getExportLocations(), getExportEntities(), getExportBlocks(), getEntityBlocks()])
      setItems(Array.isArray(prms) ? prms : [])
      setLocations(Array.isArray(locs) ? locs : [])
      setEntities(Array.isArray(ents) ? ents : [])
      setBlocks(Array.isArray(blks) ? blks : [])
      setEntityBlocks(Array.isArray(eb) ? eb : [])
    } catch (e) { alert(e.message) } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const filteredBlocks = useMemo(() => {
    if (!form.entity_code) return blocks
    const linkedBlockCodes = entityBlocks
      .filter((eb) => eb.entity_code === form.entity_code)
      .map((eb) => eb.block_code)
    return blocks.filter((b) => linkedBlockCodes.includes(b.block_code))
  }, [blocks, entityBlocks, form.entity_code])

  const handleEntityChange = (e) => {
    const entityCode = e.target.value
    setForm((c) => ({ ...c, entity_code: entityCode, block_code: '', block_codes: [] }))
  }

  const getFilteredBlocks = (entityCode) => {
    if (!entityCode) return blocks
    const linkedBlockCodes = entityBlocks
      .filter((eb) => eb.entity_code === entityCode)
      .map((eb) => eb.block_code)
    return blocks.filter((b) => linkedBlockCodes.includes(b.block_code))
  }

  const parseCSV = (text) => {
    const lines = []
    let current = ''
    let inQuotes = false
    for (let i = 0; i < text.length; i++) {
      const char = text[i]
      const nextChar = text[i + 1]
      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          current += '"'
          i++
        } else {
          inQuotes = !inQuotes
        }
      } else if (char === ',' && !inQuotes) {
        lines.push(current)
        current = ''
      } else if ((char === '\n' || char === '\r') && !inQuotes) {
        if (char === '\r' && nextChar === '\n') i++
        lines.push(current)
        current = ''
      } else {
        current += char
      }
    }
    lines.push(current)
    return lines
  }

  const parseCSVFile = (text) => {
    const rawLines = parseCSV(text).filter((l) => l.trim())
    if (rawLines.length < 2) throw new Error('CSV must have header + at least 1 data row')
    const headers = parseCSV(rawLines[0]).map((h) => h.trim().toLowerCase())
    const required = ['permit_number', 'location_code', 'entity_code', 'block_code', 'quarter', 'year', 'permit_volume']
    const missing = required.filter((r) => !headers.includes(r))
    if (missing.length) throw new Error(`Missing required columns: ${missing.join(', ')}`)
    const items = []
    const errors = []
    rawLines.slice(1).forEach((line, rowIdx) => {
      const vals = parseCSV(line)
      if (vals.every((v) => !v.trim())) return
      const obj = {}
      headers.forEach((h, i) => { obj[h] = (vals[i] || '').trim() })
      const rowErrors = validatePermitRow(obj, rowIdx + 2)
      if (rowErrors.length) {
        errors.push({ row: rowIdx + 2, data: obj, errors: rowErrors })
      } else {
        items.push(obj)
      }
    })
    return { items, errors }
  }

  const validatePermitRow = (row, rowNum) => {
    const errs = []
    if (!row.permit_number) errs.push('Permit Number is required')
    if (!row.location_code) errs.push('Location Code is required')
    if (!row.entity_code) errs.push('Entity Code is required')
    if (!row.block_code) errs.push('Block Code is required')
    if (!row.quarter || !['Q1', 'Q2', 'Q3', 'Q4'].includes(row.quarter.toUpperCase())) errs.push('Quarter must be Q1, Q2, Q3, or Q4')
    if (!row.year || isNaN(Number(row.year))) errs.push('Year must be a number')
    if (!row.permit_volume || isNaN(Number(row.permit_volume))) errs.push('Permit Volume must be a number')
    else if (Number(row.permit_volume) <= 0) errs.push('Permit Volume must be positive')
    if (row.supplementary_permit && !['Yes', 'No'].includes(row.supplementary_permit)) errs.push('Supplementary must be Yes or No')
    if (row.status && !['Active', 'Expired', 'Inactive'].includes(row.status)) errs.push('Status must be Active, Expired, or Inactive')
    return errs
  }

  const downloadPermitTemplate = () => {
    const headers = ['permit_number', 'location_code', 'entity_code', 'block_code', 'quarter', 'year', 'permit_volume', 'supplementary_permit', 'status', 'remarks']
    const sample = ['PERMIT-001', 'LOC001', 'ENT001', 'BLK001', 'Q1', '2024', '10000', 'No', 'Active', 'Initial permit']
    const csv = [headers.join(','), sample.join(',')].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'permit_bulk_upload_template.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleFileUpload = (e) => {
    const file = e.target.files[0]
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setErrorMsg('Please select a CSV file')
      return
    }
    const reader = new FileReader()
    reader.onload = (evt) => {
      try {
        const { items, errors } = parseCSVFile(evt.target.result)
        setBulkItems(items)
        setBulkErrors(errors)
        if (errors.length) {
          setErrorMsg(`${errors.length} row(s) have validation errors. Please fix before upload.`)
        } else {
          setErrorMsg('')
        }
      } catch (err) {
        setErrorMsg(err.message)
        setBulkItems([])
        setBulkErrors([])
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const handleBulkUpload = async () => {
    if (!canManage || !bulkItems.length) { setErrorMsg('No valid items to upload'); return }
    if (bulkErrors.length) { setErrorMsg('Fix validation errors before upload'); return }
    try {
      setLoading(true)
      const result = await bulkUploadPermits(bulkItems)
      setBulkErrors(result.errors || [])
      setSuccessMsg(`Bulk upload: ${result.created} created, ${result.errors.length} errors`)
      setBulkItems([]); setShowBulk(false); await load()
    } catch (e) { setErrorMsg(e.message) } finally { setLoading(false) }
  }

  const updateBulkRow = (idx, field, value) => {
    setBulkItems((c) => { const copy = [...c]; copy[idx] = { ...copy[idx], [field]: value }; return copy })
    if (bulkErrors.some((e) => e.row === idx + 2)) {
      setBulkErrors((prev) => prev.filter((e) => e.row !== idx + 2))
    }
  }

  const getRowValidationErrors = (idx) => {
    const err = bulkErrors.find((e) => e.row === idx + 2)
    return err ? err.errors : []
  }

  const save = async () => {
    if (!canManage) return
    try {
      setLoading(true)
      const blockCodes = form.block_codes?.length ? form.block_codes : (form.block_code ? [form.block_code] : [])
      const payload = {
        ...form,
        block_codes: blockCodes,
        quarter: buildPermitQuarterValue(form.permit_quarter, form.permit_year),
        permit_volume: Number(form.permit_volume || 0),
        status: form.permit_status,
        remarks: form.permit_remarks,
      }
      if (editing?.id) await updateExportPermit(editing.id, payload)
      else await createExportPermit(payload)
      setEditing(null); setForm({ permit_number: '', location_code: '', entity_code: '', block_code: '', block_codes: [], permit_quarter: getCurrentQuarter(), permit_year: new Date().getFullYear(), permit_volume: '', supplementary_permit: 'No', permit_status: 'Active', permit_remarks: '' }); setSuccessMsg(editing?.id ? 'Permit updated successfully' : 'Permit created successfully'); await load()
    } catch (e) { alert(e.message) } finally { setLoading(false) }
  }

  const remove = async (item) => {
    if (!canManage || !window.confirm(`Delete permit ${item.permit_number}?`)) return
    try { await deleteExportPermit(item.id); await load() } catch (e) { alert(e.message) }
  }

  const quarterOpts = ['Q1', 'Q2', 'Q3', 'Q4']
  const yearOpts = Array.from({ length: 20 }, (_, idx) => new Date().getFullYear() - 10 + idx)

  return (
    <div>
      <div className="report-filter-panel no-print" style={{ marginTop: '1rem' }}>
        <div><label>Location</label>
          <select value={filters.location_code} onChange={(e) => setFilters((c) => ({ ...c, location_code: e.target.value }))}>
            <option value="">All</option>
            {sortOptions(locations, 'location_name', 'location_code')}
          </select>
        </div>
        <div className="report-filter-actions">
          <button onClick={load} disabled={loading}>Refresh</button>
          <button type="button" onClick={() => setShowBulk(!showBulk)} disabled={!canManage}>{showBulk ? 'Hide Bulk' : 'Bulk Upload'}</button>
        </div>
      </div>
      {successMsg && <div className="success-box" onClick={() => setSuccessMsg('')}>{successMsg}</div>}
      {errorMsg && <div className="error-box" onClick={() => setErrorMsg('')}>{errorMsg}</div>}

      {showBulk && (
        <div style={{ border: '1px solid #ccc', padding: '1rem', margin: '1rem 0', borderRadius: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <h4 style={{ margin: 0 }}>Bulk Upload Permits</h4>
            <button type="button" onClick={downloadPermitTemplate} style={{ padding: '0.25rem 0.75rem', fontSize: '0.85rem' }}>Download Template</button>
          </div>
          <p style={{ margin: '0.5rem 0', color: '#555', fontSize: '0.9rem' }}>CSV columns: permit_number, location_code, entity_code, block_code, quarter, year, permit_volume, supplementary_permit, status, remarks</p>
          <input type="file" accept=".csv" onChange={handleFileUpload} style={{ marginBottom: '0.5rem' }} />
          {bulkItems.length > 0 && (
            <div style={{ maxHeight: '400px', overflow: 'auto', marginTop: '0.5rem' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#f5f5f5', position: 'sticky', top: 0 }}>
                    <th style={{ padding: '0.5rem', textAlign: 'left', border: '1px solid #ddd' }}>#</th>
                    <th style={{ padding: '0.5rem', textAlign: 'left', border: '1px solid #ddd' }}>Permit #</th>
                    <th style={{ padding: '0.5rem', textAlign: 'left', border: '1px solid #ddd' }}>Location</th>
                    <th style={{ padding: '0.5rem', textAlign: 'left', border: '1px solid #ddd' }}>Entity</th>
                    <th style={{ padding: '0.5rem', textAlign: 'left', border: '1px solid #ddd' }}>Block</th>
                    <th style={{ padding: '0.5rem', textAlign: 'left', border: '1px solid #ddd' }}>Quarter</th>
                    <th style={{ padding: '0.5rem', textAlign: 'left', border: '1px solid #ddd' }}>Year</th>
                    <th style={{ padding: '0.5rem', textAlign: 'left', border: '1px solid #ddd' }}>Volume</th>
                    <th style={{ padding: '0.5rem', textAlign: 'left', border: '1px solid #ddd' }}>Supplementary</th>
                    <th style={{ padding: '0.5rem', textAlign: 'left', border: '1px solid #ddd' }}>Status</th>
                    <th style={{ padding: '0.5rem', textAlign: 'left', border: '1px solid #ddd' }}>Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {bulkItems.map((item, idx) => {
                    const rowErrors = getRowValidationErrors(idx)
                    return (
                      <tr key={idx} style={{ background: rowErrors.length ? '#fff3cd' : '' }}>
                        <td style={{ padding: '0.5rem', border: '1px solid #ddd' }}>{idx + 1}</td>
                        <td style={{ padding: '0.5rem', border: '1px solid #ddd' }}>
                          <input style={{ width: '120px' }} value={item.permit_number} onChange={(e) => updateBulkRow(idx, 'permit_number', e.target.value)} disabled={!canManage || loading} />
                        </td>
                        <td style={{ padding: '0.5rem', border: '1px solid #ddd' }}>
                          <select style={{ width: '120px' }} value={item.location_code} onChange={(e) => updateBulkRow(idx, 'location_code', e.target.value)} disabled={!canManage || loading}>
                            <option value="">Select</option>
                            {sortOptions(locations, 'location_name', 'location_code')}
                          </select>
                        </td>
                        <td style={{ padding: '0.5rem', border: '1px solid #ddd' }}>
                          <select style={{ width: '120px' }} value={item.entity_code} onChange={(e) => { updateBulkRow(idx, 'entity_code', e.target.value); updateBulkRow(idx, 'block_code', '') }} disabled={!canManage || loading}>
                            <option value="">Select</option>
                            {sortOptions(entities, 'entity_name', 'entity_code')}
                          </select>
                        </td>
                        <td style={{ padding: '0.5rem', border: '1px solid #ddd' }}>
                          <select style={{ width: '120px' }} value={item.block_code} onChange={(e) => updateBulkRow(idx, 'block_code', e.target.value)} disabled={!canManage || loading}>
                            <option value="">Select</option>
                            {sortOptions(getFilteredBlocks(item.entity_code), 'block_name', 'block_code')}
                          </select>
                        </td>
                        <td style={{ padding: '0.5rem', border: '1px solid #ddd' }}>
                          <select style={{ width: '80px' }} value={item.quarter} onChange={(e) => updateBulkRow(idx, 'quarter', e.target.value)} disabled={!canManage || loading}>
                            <option value="">Select</option>
                            {quarterOpts.map((q) => <option key={q} value={q}>{q}</option>)}
                          </select>
                        </td>
                        <td style={{ padding: '0.5rem', border: '1px solid #ddd' }}>
                          <select style={{ width: '80px' }} value={item.year} onChange={(e) => updateBulkRow(idx, 'year', e.target.value)} disabled={!canManage || loading}>
                            <option value="">Select</option>
                            {yearOpts.map((y) => <option key={y} value={y}>{y}</option>)}
                          </select>
                        </td>
                        <td style={{ padding: '0.5rem', border: '1px solid #ddd' }}>
                          <input type="number" step="0.01" style={{ width: '100px' }} value={item.permit_volume} onChange={(e) => updateBulkRow(idx, 'permit_volume', e.target.value)} disabled={!canManage || loading} />
                        </td>
                        <td style={{ padding: '0.5rem', border: '1px solid #ddd' }}>
                          <select style={{ width: '100px' }} value={item.supplementary_permit} onChange={(e) => updateBulkRow(idx, 'supplementary_permit', e.target.value)} disabled={!canManage || loading}>
                            <option value="No">No</option><option value="Yes">Yes</option>
                          </select>
                        </td>
                        <td style={{ padding: '0.5rem', border: '1px solid #ddd' }}>
                          <select style={{ width: '100px' }} value={item.status} onChange={(e) => updateBulkRow(idx, 'status', e.target.value)} disabled={!canManage || loading}>
                            <option value="Active">Active</option><option value="Expired">Expired</option><option value="Inactive">Inactive</option>
                          </select>
                        </td>
                        <td style={{ padding: '0.5rem', border: '1px solid #ddd' }}>
                          <input style={{ width: '120px' }} value={item.remarks || ''} onChange={(e) => updateBulkRow(idx, 'remarks', e.target.value)} disabled={!canManage || loading} />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <div className="form-actions" style={{ marginTop: '0.75rem' }}>
                <button type="button" onClick={handleBulkUpload} disabled={loading || !canManage || bulkErrors.length > 0}>{loading ? 'Uploading...' : `Upload ${bulkItems.length}`}</button>
                {bulkErrors.length > 0 && <span style={{ marginLeft: '1rem', color: '#dc3545', fontSize: '0.9rem' }}>Fix {bulkErrors.length} error(s) before upload</span>}
              </div>
              {bulkErrors.length > 0 && (
                <div className="error-box" style={{ marginTop: '0.75rem', fontSize: '0.85rem' }}>
                  <strong>Validation Errors:</strong>
                  {bulkErrors.map((e, i) => (
                    <div key={i} style={{ marginTop: '0.25rem', padding: '0.25rem', background: '#fff', border: '1px solid #f5c6cb', borderRadius: '4px' }}>
                      <strong>Row {e.row}:</strong> {e.errors.join('; ')}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <form onSubmit={(e) => { e.preventDefault(); save() }} style={{ margin: '1rem 0', display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'end' }}>
        <div><label>Permit # *</label><input value={form.permit_number} onChange={(e) => setForm((c) => ({ ...c, permit_number: e.target.value }))} required disabled={!canManage} /></div>
        <div><label>Location *</label>
          <select value={form.location_code} onChange={(e) => setForm((c) => ({ ...c, location_code: e.target.value }))} required disabled={!canManage}>
            <option value="">Select</option>
            {sortOptions(locations, 'location_name', 'location_code')}
          </select>
        </div>
        <div><label>Entity *</label>
          <select value={form.entity_code} onChange={handleEntityChange} required disabled={!canManage}>
            <option value="">Select</option>
            {sortOptions(entities, 'entity_name', 'entity_code')}
          </select>
        </div>
        <div style={{ gridColumn: '1 / -1' }}><label>Blocks (check all that apply)</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.25rem' }}>
            {filteredBlocks.map((b) => {
              const checked = form.block_codes?.includes(b.block_code) || (!form.block_codes?.length && form.block_code === b.block_code)
              return (
                <label key={b.block_code} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', cursor: 'pointer', padding: '0.25rem 0.5rem', borderRadius: '4px', background: checked ? '#e3f2fd' : '#f5f5f5', border: '1px solid ' + (checked ? '#1976d2' : '#ddd') }}>
                  <input type="checkbox" checked={checked} onChange={() => {
                    const cur = form.block_codes || []
                    let next
                    if (checked) {
                      next = cur.filter((x) => x !== b.block_code)
                    } else {
                      next = [...cur, b.block_code]
                    }
                    setForm((c) => ({ ...c, block_codes: next, block_code: next[0] || b.block_code }))
                  }} disabled={!canManage} />
                  {b.block_name} ({b.block_code})
                </label>
              )
            })}
            {!filteredBlocks.length && <span style={{ color: '#999' }}>No blocks available for selected entity</span>}
          </div>
        </div>
        <div><label>Quarter *</label>
          <select value={form.permit_quarter} onChange={(e) => setForm((c) => ({ ...c, permit_quarter: e.target.value }))} required disabled={!canManage}>
            <option value="">Select</option>
            {quarterOpts.map((q) => <option key={q} value={q}>{q}</option>)}
          </select>
        </div>
        <div><label>Year *</label>
          <select value={form.permit_year} onChange={(e) => setForm((c) => ({ ...c, permit_year: e.target.value }))} required disabled={!canManage}>
            <option value="">Select</option>
            {yearOpts.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div><label>Volume *</label><input type="number" step="0.01" value={form.permit_volume} onChange={(e) => setForm((c) => ({ ...c, permit_volume: e.target.value }))} required disabled={!canManage} /></div>
        <div><label>Supplementary</label>
          <select value={form.supplementary_permit} onChange={(e) => setForm((c) => ({ ...c, supplementary_permit: e.target.value }))} disabled={!canManage}>
            <option value="No">No</option><option value="Yes">Yes</option>
          </select>
        </div>
        <div><label>Status</label>
          <select value={form.permit_status} onChange={(e) => setForm((c) => ({ ...c, permit_status: e.target.value }))} disabled={!canManage}>
            <option value="Active">Active</option><option value="Expired">Expired</option><option value="Inactive">Inactive</option>
          </select>
        </div>
        <div><label>Remarks</label><input value={form.permit_remarks} onChange={(e) => setForm((c) => ({ ...c, permit_remarks: e.target.value }))} disabled={!canManage} /></div>
        <div>
          <button type="submit" disabled={loading || !canManage}>{loading ? '...' : editing?.id ? 'Update' : 'Add'}</button>
          {editing && <button onClick={() => { setEditing(null); setForm({ permit_number: '', location_code: '', entity_code: '', block_code: '', block_codes: [], permit_quarter: getCurrentQuarter(), permit_year: new Date().getFullYear(), permit_volume: '', supplementary_permit: 'No', permit_status: 'Active', permit_remarks: '' }) }}>Cancel</button>}
        </div>
      </form>
      <table>
        <thead><tr><th>Permit #</th><th>Quarter</th><th>Location</th><th>Entity</th><th>Blocks</th><th>Permit Vol</th><th>Used</th><th>Remaining</th><th>Suppl.</th><th>Status</th><th>Remarks</th><th>Action</th></tr></thead>
        <tbody>
          {!items.length ? <tr><td colSpan="12" className="empty-table">No permits</td></tr> :
            items.map((i) => (
              <tr key={i.id}>
                <td>{i.permit_number}</td><td>{i.quarter}</td><td>{i.location_name || i.location_code}</td>
                <td>{i.entity_name || i.entity_code}</td>
                <td>{(i.block_names && i.block_names.length ? i.block_names : [i.block_name || i.block_code]).join(', ')}</td>
                <td>{fmt(i.permit_volume)}</td><td>{fmt(i.used_volume)}</td><td>{fmt(i.remaining_volume)}</td>
                <td>{i.supplementary_permit}</td><td>{i.status}</td><td>{i.remarks || '-'}</td>
                <td><button onClick={() => {
                  const parsed = splitPermitQuarterValue(i.quarter)
                  const codes = (i.block_codes && i.block_codes.length ? i.block_codes : [i.block_code].filter(Boolean))
                  setEditing(i)
                  setForm({ permit_number: i.permit_number, location_code: i.location_code, entity_code: i.entity_code, block_code: codes[0] || '', block_codes: codes, permit_quarter: parsed.quarter, permit_year: parsed.year, permit_volume: i.permit_volume, supplementary_permit: i.supplementary_permit, permit_status: i.status || 'Active', permit_remarks: i.remarks || '' })
                }} disabled={!canManage}>Edit</button>
                <button onClick={() => remove(i)} disabled={!canManage}>Delete</button></td>
              </tr>
            ))
          }
        </tbody>
      </table>
    </div>
  )
}

function ConsigneeConfig({ canManage }) {
  const [items, setItems] = useState([])
  const [form, setForm] = useState({ consignee_name: '', description: '' })
  const [editing, setEditing] = useState(null)
  const [loading, setLoading] = useState(false)

  const load = async () => {
    try { setLoading(true); const data = await getExportConsignees(); setItems(Array.isArray(data) ? data : []) }
    catch (e) { alert(e.message) } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const save = async () => {
    if (!canManage || !form.consignee_name.trim()) return
    try {
      setLoading(true)
      if (editing) { await updateExportConsignee(editing.id, { consignee_name: form.consignee_name, description: form.description }) }
      else { await createExportConsignee({ consignee_name: form.consignee_name, description: form.description }) }
      setForm({ consignee_name: '', description: '' }); setEditing(null); await load()
    } catch (e) { alert(e.message) } finally { setLoading(false) }
  }

  const remove = async (item) => {
    if (!canManage || !window.confirm(`Delete consignee "${item.consignee_name}"?`)) return
    try { await deleteExportConsignee(item.id); await load() } catch (e) { alert(e.message) }
  }

  return (
    <div>
      <div className="info-box">Manage consignee list. These appear as dropdown options in the Export Data entry form.</div>
      <form onSubmit={(e) => { e.preventDefault(); save() }} style={{ margin: '1rem 0', display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'end' }}>
        <div><label>Consignee Name *</label><input value={form.consignee_name} onChange={(e) => setForm((c) => ({ ...c, consignee_name: e.target.value }))} required disabled={!canManage} /></div>
        <div><label>Description</label><input value={form.description} onChange={(e) => setForm((c) => ({ ...c, description: e.target.value }))} disabled={!canManage} /></div>
        <div>
          <button type="submit" disabled={loading || !canManage}>{loading ? '...' : editing ? 'Update' : 'Add'}</button>
          {editing && <button type="button" onClick={() => { setEditing(null); setForm({ consignee_name: '', description: '' }) }} disabled={loading}>Cancel</button>}
        </div>
      </form>
      <table>
        <thead><tr><th>Consignee Name</th><th>Description</th><th>Action</th></tr></thead>
        <tbody>
          {!items.length ? <tr><td colSpan="3" className="empty-table">No consignees configured</td></tr> :
            items.map((i) => (
              <tr key={i.id}>
                <td>{i.consignee_name}</td><td>{i.description || '-'}</td>
                <td><button onClick={() => { setEditing(i); setForm({ consignee_name: i.consignee_name, description: i.description || '' }) }} disabled={!canManage}>Edit</button>
                <button onClick={() => remove(i)} disabled={!canManage}>Delete</button></td>
              </tr>
            ))
          }
        </tbody>
      </table>
    </div>
  )
}

function SettingsConfig({ canManage }) {
  const [configs, setConfigs] = useState([])
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({ config_key: '', config_value: '', description: '' })

  const load = async () => {
    try {
      setLoading(true)
      const data = await getExportConfigs()
      setConfigs(Array.isArray(data) ? data : [])
    } catch (e) { alert(e.message) } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const save = async () => {
    if (!canManage) return
    try {
      setLoading(true)
      await saveExportConfig(form)
      setForm({ config_key: '', config_value: '', description: '' }); await load()
    } catch (e) { alert(e.message) } finally { setLoading(false) }
  }

  const defaults = [
    { key: 'permit_insufficiency_threshold_pct', desc: 'Permit insufficiency alert threshold (%)', val: '90' },
    { key: 'default_export_uom', desc: 'Default unit of measure for volumes', val: 'bbls' },
  ]

  return (
    <div>
      <div className="info-box">Configure export settings. Values are stored as key-value pairs.</div>
      <form onSubmit={(e) => { e.preventDefault(); save() }} style={{ margin: '1rem 0', display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'end' }}>
        <div><label>Key *</label>
          <select value={form.config_key} onChange={(e) => {
            const d = defaults.find((x) => x.key === e.target.value)
            setForm((c) => ({ ...c, config_key: e.target.value, description: d?.desc || '', config_value: d?.val || '' }))
          }} required disabled={!canManage}>
            <option value="">Select</option>
            {defaults.map((d) => <option key={d.key} value={d.key}>{d.key}</option>)}
          </select>
        </div>
        <div><label>Value *</label><input value={form.config_value} onChange={(e) => setForm((c) => ({ ...c, config_value: e.target.value }))} required disabled={!canManage} /></div>
        <div><label>Description</label><input value={form.description} onChange={(e) => setForm((c) => ({ ...c, description: e.target.value }))} disabled={!canManage} /></div>
        <div><button type="submit" disabled={loading || !canManage}>{loading ? '...' : 'Save'}</button></div>
      </form>
      <table>
        <thead><tr><th>Key</th><th>Value</th><th>Description</th><th>Status</th></tr></thead>
        <tbody>
          {!configs.length ? <tr><td colSpan="4" className="empty-table">No settings</td></tr> :
            configs.map((c) => (
              <tr key={c.id}><td>{c.config_key}</td><td>{c.config_value}</td><td>{c.description || '-'}</td><td>{c.status}</td></tr>
            ))
          }
        </tbody>
      </table>
    </div>
  )
}

export default ExportOperations
