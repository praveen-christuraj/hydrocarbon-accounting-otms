import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  getShuttleTracking,
  closeShuttleVoyage,
  reopenShuttleVoyage,
  downloadShuttleVoyageXlsx,
} from '../api/shuttleTrackingApi'
import { createOperationEntry } from '../api/operationEntryApi'
import { getVesselOperations } from '../api/vesselOperationApi'

const defaultFilters = {
  date_from: '',
  date_to: '',
  location_code: '',
  shuttle_number: '',
  shuttle_asset_code: '',
}

const escapeCsvValue = (value) => {
  const text = String(value ?? '')
  if (text.includes(',') || text.includes('"') || text.includes('\n')) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

function ShuttleTracking({
  locations = [],
  assets = [],
  operationTemplates = [],
  loggedInUser,
}) {
  const navigate = useNavigate()

  const isAdminBootstrap =
    String(loggedInUser?.username || '').toLowerCase() === 'admin'

  const hasPermission = (permissionName) =>
    Boolean(
      loggedInUser?.permissions?.some(
        (p) => p.permissionName === permissionName
      )
    )

  const canManageShuttle = useMemo(() => {
    if (isAdminBootstrap) return true
    return hasPermission('Manage Shuttle Tracking')
  }, [loggedInUser])

  const canCreateOperationEntry = useMemo(() => {
    if (isAdminBootstrap) return true
    return hasPermission('Create Operation Entry')
  }, [loggedInUser])

  // ----------------------------
  // Main state
  // ----------------------------
  const [filters, setFilters] = useState(defaultFilters)
  const [report, setReport] = useState({ rows: [], totalGroups: 0 })
  const [loading, setLoading] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [validationErrors, setValidationErrors] = useState({})
  const [promptModal, setPromptModal] = useState(null) // { action: 'close'|'reopen', message, value }

  const [selectedGroupKey, setSelectedGroupKey] = useState('')

  const selectedGroup = useMemo(() => {
    return report.rows.find((r) => r.groupKey === selectedGroupKey) || null
  }, [report.rows, selectedGroupKey])

  const isVoyageClosed = useMemo(() => {
    return String(selectedGroup?.voyageStatus || '').toUpperCase() === 'CLOSED'
  }, [selectedGroup])

  const activeAssets = useMemo(
    () => assets.filter((a) => a.status === 'Active'),
    [assets]
  )

  const shuttleTemplates = useMemo(() => {
    return operationTemplates.filter((t) => {
      return (
        t.status === 'Active' &&
        String(t.entryLayoutType || '') === 'Shuttle Tracking'
      )
    })
  }, [operationTemplates])

  // ----------------------------
  // Voyage list large-data UX
  // ----------------------------
  const [activeVoyageTab, setActiveVoyageTab] = useState('OPEN') // OPEN | CLOSED
  const [voyageSearch, setVoyageSearch] = useState('')
  const [voyagePage, setVoyagePage] = useState(1)
  const [openVoyageCount, setOpenVoyageCount] = useState(0)
  const [closedVoyageCount, setClosedVoyageCount] = useState(0)
  const VOYAGE_PAGE_SIZE = 20

  const filteredVoyageRows = useMemo(() => {
    const rows = [...(report.rows || [])]
    const tab = String(activeVoyageTab || 'OPEN').toUpperCase()
    const search = String(voyageSearch || '').trim().toLowerCase()

    const filtered = rows.filter((r) => {
      const status = String(r.voyageStatus || 'OPEN').toUpperCase()
      const isClosed = status === 'CLOSED'

      if (tab === 'CLOSED' && !isClosed) return false
      if (tab === 'OPEN' && isClosed) return false

      if (!search) return true

      const key = `${r.locationCode}|${r.shuttleAssetCode}|${r.shuttleNumber}|${r.locationName}|${r.shuttleAssetName}`.toLowerCase()
      return key.includes(search)
    })

    filtered.sort((a, b) => {
      const ka = `${a.locationCode}|${a.shuttleAssetCode}|${a.shuttleNumber}`
      const kb = `${b.locationCode}|${b.shuttleAssetCode}|${b.shuttleNumber}`
      return ka.localeCompare(kb)
    })

    return filtered
  }, [report.rows, activeVoyageTab, voyageSearch])

  const voyageTotalPages = useMemo(() => {
    return Math.max(1, Math.ceil(filteredVoyageRows.length / VOYAGE_PAGE_SIZE))
  }, [filteredVoyageRows.length])

  const pagedVoyageRows = useMemo(() => {
    const start = (voyagePage - 1) * VOYAGE_PAGE_SIZE
    return filteredVoyageRows.slice(start, start + VOYAGE_PAGE_SIZE)
  }, [filteredVoyageRows, voyagePage])

  useEffect(() => {
    setVoyagePage(1)
  }, [activeVoyageTab, voyageSearch])

  // ----------------------------
  // Timeline sorting + large-data UX
  // ----------------------------
  const sortedSelectedTickets = useMemo(() => {
    if (!selectedGroup) return []
    const rows = [...(selectedGroup.tickets || [])]

    rows.sort((a, b) => {
      const da = String(a.operationDate || '')
      const db = String(b.operationDate || '')
      if (da !== db) return da.localeCompare(db)

      const ta = String(a.eventTime || '')
      const tb = String(b.eventTime || '')
      if (ta !== tb) return ta.localeCompare(tb)

      return Number(a.transactionId || 0) - Number(b.transactionId || 0)
    })

    return rows
  }, [selectedGroup])

  const [timelineSearch, setTimelineSearch] = useState('')
  const [timelineOpCode, setTimelineOpCode] = useState('')
  const [timelinePage, setTimelinePage] = useState(1)
  const TIMELINE_PAGE_SIZE = 30
  const [expandedTicketIds, setExpandedTicketIds] = useState(() => new Set())

  const filteredTimelineTickets = useMemo(() => {
    const rows = [...(sortedSelectedTickets || [])]
    const search = String(timelineSearch || '').trim().toLowerCase()
    const opCode = String(timelineOpCode || '').trim()

    return rows.filter((t) => {
      if (opCode && String(t.vesselOperationCode || '') !== opCode) return false
      if (!search) return true

      const blob = `${t.ticketNumber} ${t.operationNumber} ${t.operationDate} ${t.eventTime} ${t.vesselOperationLabel} ${t.vesselOperationCode} ${t.remarks}`.toLowerCase()
      return blob.includes(search)
    })
  }, [sortedSelectedTickets, timelineSearch, timelineOpCode])

  const timelineTotalPages = useMemo(() => {
    return Math.max(1, Math.ceil(filteredTimelineTickets.length / TIMELINE_PAGE_SIZE))
  }, [filteredTimelineTickets.length])

  const pagedTimelineTickets = useMemo(() => {
    const start = (timelinePage - 1) * TIMELINE_PAGE_SIZE
    return filteredTimelineTickets.slice(start, start + TIMELINE_PAGE_SIZE)
  }, [filteredTimelineTickets, timelinePage])

  const getDisplayOperationLabel = (tickets, index) => {
    const t = tickets[index]
    const base = String(t?.vesselOperationLabel || t?.vesselOperationCode || '').trim()
    const code = String(t?.vesselOperationCode || '').toUpperCase()

    const isTopUp =
      code === 'TOP_UP' ||
      base.toUpperCase().includes('TOP_UP') ||
      base.toUpperCase().includes('TOP-UP')
    const isUnload =
      code === 'UNLOADING' ||
      base.toUpperCase().includes('UNLOADING') ||
      base.toUpperCase().includes('UNLOAD')

    if (!isTopUp && !isUnload) return base

    let count = 0
    for (let i = 0; i <= index; i++) {
      const ci = String(tickets[i]?.vesselOperationCode || '').toUpperCase()
      const li = String(tickets[i]?.vesselOperationLabel || '').toUpperCase()

      const top = ci === 'TOP_UP' || li.includes('TOP_UP') || li.includes('TOP-UP')
      const unl = ci === 'UNLOADING' || li.includes('UNLOADING') || li.includes('UNLOAD')

      if (isTopUp && top) count++
      if (isUnload && unl) count++
    }

    if (isTopUp) return `Top-Up ${count}`
    return `Unload ${count}`
  }

  const isTicketExpanded = (id) => expandedTicketIds.has(id)

  const toggleTicket = (id) => {
    setExpandedTicketIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const collapseAllTickets = () => setExpandedTicketIds(new Set())

  const expandAllTickets = () => {
    const allIds = (pagedTimelineTickets || [])
      .map((t) => t.transactionId)
      .filter(Boolean)
    setExpandedTicketIds(new Set(allIds))
  }

  useEffect(() => {
    setTimelinePage(1)
  }, [timelineSearch, timelineOpCode, selectedGroupKey])

  // ----------------------------
  // Create form (Tracking actions)
  // ----------------------------
  const createFormRef = useRef(null)

  const [createForm, setCreateForm] = useState({
    operationTemplateId: '',
    originLocationCode: '',
    primaryAssetCode: '',
    convoyNumber: '', // Shuttle Number
    operationDate: '',
    productName: '',
    vesselOperationCode: '',
    eventTime: '',
    openingStockBbl: '',
    openingWaterBbl: '',
    closingStockBbl: '',
    closingWaterBbl: '',
    bargeReference: '',
    remarks: '',
  })
  const [showCreatePanel, setShowCreatePanel] = useState(false)
  const [selectedStageLabel, setSelectedStageLabel] = useState('')

  // Auto lock key fields + opening from last closing when selecting a voyage
  useEffect(() => {
    if (!selectedGroup) return

    const last = sortedSelectedTickets.length
      ? sortedSelectedTickets[sortedSelectedTickets.length - 1]
      : null

    setCreateForm((c) => ({
      ...c,
      originLocationCode: selectedGroup.locationCode || '',
      primaryAssetCode: selectedGroup.shuttleAssetCode || '',
      convoyNumber: selectedGroup.shuttleNumber || '',

      operationDate: c.operationDate || (last?.operationDate || ''),

      openingStockBbl:
        String(c.openingStockBbl || '').trim() !== ''
          ? c.openingStockBbl
          : String(last?.closingStockBbl ?? ''),

      openingWaterBbl:
        String(c.openingWaterBbl || '').trim() !== ''
          ? c.openingWaterBbl
          : String(last?.closingWaterBbl ?? ''),

      closingStockBbl: '',
      closingWaterBbl: '',
      eventTime: '',
      vesselOperationCode: '',
      bargeReference: '',
      remarks: '',
    }))
    setShowCreatePanel(false)
    setSelectedStageLabel('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGroupKey])

  const liveNet = useMemo(() => {
    const openingStock = Number(createForm.openingStockBbl || 0)
    const openingWater = Number(createForm.openingWaterBbl || 0)
    const closingStock = Number(createForm.closingStockBbl || 0)
    const closingWater = Number(createForm.closingWaterBbl || 0)

    const netStock = closingStock - openingStock // Net Stock is NSV rule
    const netWater = closingWater - openingWater

    return { netStock, netWater }
  }, [
    createForm.openingStockBbl,
    createForm.openingWaterBbl,
    createForm.closingStockBbl,
    createForm.closingWaterBbl,
  ])

  // ----------------------------
  // Vessel operations (Tracking-only)
  // ----------------------------
  const [vesselOps, setVesselOps] = useState([])

  useEffect(() => {
    const loadOps = async () => {
      const loc = String(createForm.originLocationCode || '').trim()
      const asset = assets.find((a) => a.assetCode === createForm.primaryAssetCode)
      const assetType = String(asset?.assetTypeCode || '').trim()

      if (!loc || !assetType) {
        setVesselOps([])
        return
      }

      try {
        const data = await getVesselOperations({
          location_code: loc,
          applicable_asset_type_code: assetType,
          status: 'Active',
          show_in: 'Tracking',
        })
        setVesselOps(Array.isArray(data) ? data : [])
      } catch (e) {
        setErrorMsg(e.message || 'Unable to load Vessel Operations')
      }
    }

    loadOps()
  }, [createForm.originLocationCode, createForm.primaryAssetCode, assets])

  // Quick stage buttons (soft-coded)
  const stageOps = useMemo(() => {
    const rows = [...(vesselOps || [])]
    const filtered = rows.filter((op) => {
      const code = String(op.operation_code || op.operationCode || '').toUpperCase()
      const label = String(op.operation_label || op.operationLabel || '').toUpperCase()

      if (code === 'LOADING') return false
      if (label === 'LOADING') return false
      return true
    })

    filtered.sort((a, b) => {
      const sa = Number(a.sort_order ?? a.sortOrder ?? 0)
      const sb = Number(b.sort_order ?? b.sortOrder ?? 0)
      if (sa !== sb) return sa - sb
      return String(a.operation_label || a.operationLabel || '').localeCompare(
        String(b.operation_label || b.operationLabel || '')
      )
    })
    return filtered
  }, [vesselOps])

  const pickStage = (op) => {
    if (!selectedGroup) return

    const code = String(op?.operation_code || op?.operationCode || '').trim()
    if (!code) return

    const label = String(op?.operation_label || op?.operationLabel || '').trim()

    const now = new Date()
    const yyyy = now.getFullYear()
    const mm = String(now.getMonth() + 1).padStart(2, '0')
    const dd = String(now.getDate()).padStart(2, '0')
    const hh = String(now.getHours()).padStart(2, '0')
    const mi = String(now.getMinutes()).padStart(2, '0')
    const today = `${yyyy}-${mm}-${dd}`
    const timeNow = `${hh}:${mi}`

    const last = sortedSelectedTickets.length ? sortedSelectedTickets[sortedSelectedTickets.length - 1] : null

    const openingStock = String(last?.closingStockBbl ?? '')
    const openingWater = String(last?.closingWaterBbl ?? '')

    const defaultTemplateId = shuttleTemplates.length > 0 ? String(shuttleTemplates[0].id) : ''

    setSelectedStageLabel(label || code)
    setShowCreatePanel(true)

    setCreateForm((c) => ({
      ...c,

      originLocationCode: selectedGroup.locationCode,
      primaryAssetCode: selectedGroup.shuttleAssetCode,
      convoyNumber: selectedGroup.shuttleNumber,

      operationTemplateId: c.operationTemplateId || defaultTemplateId,
      operationDate: today,
      eventTime: timeNow,
      vesselOperationCode: code,

      openingStockBbl: openingStock,
      openingWaterBbl: openingWater,

      closingStockBbl: '',
      closingWaterBbl: '',
      remarks: '',
      bargeReference: '',
    }))

    if (createFormRef.current) {
      createFormRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  const openMappingForVoyage = (mode) => {
    if (!selectedGroup) return

    const params = new URLSearchParams()
    params.set('mapping_type', 'BARGE_TO_SHUTTLE')
    params.set('location_code', selectedGroup.locationCode)
    params.set('reference_number', selectedGroup.shuttleNumber)
    params.set('status', mode === 'openOnly' ? 'OPEN' : '')
    params.set('auto_suggest', '1')

    navigate(`/movement-mappings?${params.toString()}`)
  }

  // ----------------------------
  // Voyage summary
  // ----------------------------
  const voyageSummary = useMemo(() => {
    if (!selectedGroup) return null

    const tickets = [...(sortedSelectedTickets || [])]
    const last = tickets.length ? tickets[tickets.length - 1] : null

    const isClosed = String(selectedGroup.voyageStatus || '').toUpperCase() === 'CLOSED'

    return {
      status: String(selectedGroup.voyageStatus || 'OPEN'),
      ticketCount: tickets.length,
      lastClosingStock: last ? Number(last.closingStockBbl || 0) : 0,
      lastClosingWater: last ? Number(last.closingWaterBbl || 0) : 0,

      isClosed,
      netDischargeBbl: Number(selectedGroup.netDischargeBbl || 0),
    }
  }, [selectedGroup, sortedSelectedTickets])

  // ----------------------------
  // API load
  // ----------------------------
  const loadTracking = async () => {
    try {
      setLoading(true)

      // 1) load current tab page (list only, no tickets)
      const data = await getShuttleTracking({
        ...filters,
        tab: activeVoyageTab,
        search: voyageSearch,
        page: voyagePage,
        page_size: 20,
        include_tickets: false,
      })

      setReport({ rows: data.rows, totalGroups: data.totalGroups })

      // 2) set count for current tab
      if (String(activeVoyageTab).toUpperCase() === 'CLOSED') {
        setClosedVoyageCount(data.totalGroups)
      } else {
        setOpenVoyageCount(data.totalGroups)
      }

      // 3) fetch other-tab count (super light: page_size=1)
      const otherTab = String(activeVoyageTab).toUpperCase() === 'CLOSED' ? 'OPEN' : 'CLOSED'
      const other = await getShuttleTracking({
        ...filters,
        tab: otherTab,
        search: voyageSearch,
        page: 1,
        page_size: 1,
        include_tickets: false,
      })

      if (otherTab === 'CLOSED') setClosedVoyageCount(other.totalGroups)
      else setOpenVoyageCount(other.totalGroups)

      // 4) if selected voyage no longer on page, collapse
      if (selectedGroupKey) {
        const still = (data.rows || []).find((r) => r.groupKey === selectedGroupKey)
        setSelectedGroupKey(still ? still.groupKey : '')
      }
    } catch (e) {
      setErrorMsg(e.message || 'Unable to load Shuttle Tracking')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadTracking()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    loadTracking()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeVoyageTab, voyageSearch, voyagePage])

  const onFilterChange = (e) => {
    const { name, value } = e.target
    setFilters((c) => ({ ...c, [name]: value }))
  }

  const clearFilters = () => setFilters(defaultFilters)

  // ----------------------------
  // Close / Reopen voyage
  // ----------------------------
  const closeVoyage = async () => {
    if (!canManageShuttle) {
      setErrorMsg('You do not have permission to close shuttle voyage')
      return
    }
    if (!selectedGroup) return
    setPromptModal({ action: 'close', value: '' })
  }

  const confirmCloseVoyage = async () => {
    if (!selectedGroup || !promptModal) return
    const closureRemarks = promptModal.value || ''
    setPromptModal(null)
    try {
      setLoading(true)
      await closeShuttleVoyage({
        locationCode: selectedGroup.locationCode,
        shuttleNumber: selectedGroup.shuttleNumber,
        shuttleAssetCode: selectedGroup.shuttleAssetCode,
        closureRemarks,
      })
      setSuccessMsg('Voyage closed.')
      await loadTracking()
    } catch (e) {
      setErrorMsg(e.message || 'Unable to close voyage')
    } finally {
      setLoading(false)
    }
  }

  const reopenVoyage = async () => {
    if (!canManageShuttle) {
      setErrorMsg('You do not have permission to reopen shuttle voyage')
      return
    }
    if (!selectedGroup) return
    const confirmText = `REOPEN ${selectedGroup.locationCode} | ${selectedGroup.shuttleAssetCode} | ${selectedGroup.shuttleNumber}`
    setPromptModal({ action: 'reopen', confirmText, value: '', remarks: '' })
  }

  const confirmReopenVoyage = async () => {
    if (!selectedGroup || !promptModal) return
    const { confirmText, value, remarks } = promptModal
    if (String(value || '').trim() !== confirmText) {
      setErrorMsg('Reopen cancelled (confirmation text did not match).')
      setPromptModal(null)
      return
    }
    const finalRemarks = remarks || ''
    setPromptModal(null)
    try {
      setLoading(true)
      await reopenShuttleVoyage({
        locationCode: selectedGroup.locationCode,
        shuttleNumber: selectedGroup.shuttleNumber,
        shuttleAssetCode: selectedGroup.shuttleAssetCode,
        remarks: finalRemarks,
      })
      setSuccessMsg('Voyage reopened.')
      await loadTracking()
    } catch (e) {
      setErrorMsg(e.message || 'Unable to reopen voyage')
    } finally {
      setLoading(false)
    }
  }

  // ----------------------------
  // Export
  // ----------------------------
  const downloadCsvForSelected = () => {
    if (!selectedGroup) {
      setErrorMsg('Select a voyage first')
      return
    }

    const rows = sortedSelectedTickets
    const headers = [
      'TicketNumber',
      'OperationNumber',
      'LocationCode',
      'ShuttleNumber',
      'ShuttleAssetCode',
      'OperationDate',
      'OperationTime',
      'Operation',
      'OpeningStock',
      'OpeningWater',
      'ClosingStock',
      'ClosingWater',
      'NetStock',
      'NetWater',
      'Remarks',
      'Status',
    ]

    const lines = [headers.join(',')]
    rows.forEach((t) => {
      lines.push(
        [
          escapeCsvValue(t.ticketNumber),
          escapeCsvValue(t.operationNumber),
          escapeCsvValue(t.locationCode),
          escapeCsvValue(t.shuttleNumber),
          escapeCsvValue(t.shuttleAssetCode),
          escapeCsvValue(t.operationDate),
          escapeCsvValue(t.eventTime),
          escapeCsvValue(t.vesselOperationLabel),
          escapeCsvValue(t.openingStockBbl),
          escapeCsvValue(t.openingWaterBbl),
          escapeCsvValue(t.closingStockBbl),
          escapeCsvValue(t.closingWaterBbl),
          escapeCsvValue(t.netStockBbl),
          escapeCsvValue(t.netWaterBbl),
          escapeCsvValue(t.remarks),
          escapeCsvValue(t.status),
        ].join(',')
      )
    })

    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `shuttle-tracking-${selectedGroup.locationCode}-${selectedGroup.shuttleAssetCode}-${selectedGroup.shuttleNumber}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const exportExcelForSelected = async () => {
    if (!selectedGroup) {
      setErrorMsg('Select a voyage first')
      return
    }

    try {
      setLoading(true)
      await downloadShuttleVoyageXlsx({ group_key: selectedGroup.groupKey })
    } catch (e) {
      setErrorMsg(e.message || 'Unable to export excel')
    } finally {
      setLoading(false)
    }
  }

  // ----------------------------
  // Create ticket
  // ----------------------------
  const initValuesFromTemplate = (templateId) => {
    const template = shuttleTemplates.find((t) => String(t.id) === String(templateId))
    if (!template) return []

    return [...(template.fields || [])]
      .filter((f) => f.status === 'Active')
      .sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder))
      .map((f) => ({
        fieldCode: f.fieldCode,
        fieldName: f.fieldName,
        fieldGroup: f.fieldGroup,
        dataType: f.dataType,
        unit: f.unit,
        inputMode: f.inputMode,
        calculationRole: f.calculationRole,
        fieldValue: '',
        sortOrder: f.sortOrder,
      }))
  }

  const createTicket = async () => {
    if (!canCreateOperationEntry) {
      setErrorMsg('You do not have permission to create operation entry')
      return
    }
    if (!selectedGroup) {
      setErrorMsg('Select a voyage first')
      return
    }

    if (isVoyageClosed) {
      setErrorMsg('This voyage is CLOSED. Reopen voyage to create new tickets.')
      return
    }

    const valErrors = {}
    if (!createForm.operationTemplateId) valErrors.operationTemplateId = 'Operation Template is required'
    if (!createForm.operationDate) valErrors.operationDate = 'Operation Date is required'
    if (!createForm.vesselOperationCode) valErrors.vesselOperationCode = 'Tracking Operation is required'
    if (Object.keys(valErrors).length) {
      setValidationErrors(valErrors)
      return
    }
    setValidationErrors({})

    const template = shuttleTemplates.find(
      (t) => String(t.id) === String(createForm.operationTemplateId)
    )
    if (!template) {
      setErrorMsg('Selected template not found')
      return
    }

    const op = vesselOps.find((o) => o.operation_code === createForm.vesselOperationCode)

    const openingStock = Number(createForm.openingStockBbl || 0)
    const openingWater = Number(createForm.openingWaterBbl || 0)

    const closingStock =
      String(createForm.closingStockBbl || '').trim() === ''
        ? openingStock
        : Number(createForm.closingStockBbl || 0)

    const closingWater =
      String(createForm.closingWaterBbl || '').trim() === ''
        ? openingWater
        : Number(createForm.closingWaterBbl || 0)

    const netStock = closingStock - openingStock
    const netWater = closingWater - openingWater

    const payload = {
      meta: {
        schema: 'shuttle_payload_v2',
        location_code: selectedGroup.locationCode,
        shuttle_number: selectedGroup.shuttleNumber,
        shuttle_asset_code: selectedGroup.shuttleAssetCode,
        vessel_operation_code: createForm.vesselOperationCode,
        vessel_operation_label: op?.operation_label || '',
        vessel_operation_category: op?.operation_category || '',
        vessel_operation_sign: op?.operation_sign || '',
      },
      inputs: {
        operation_date: createForm.operationDate,
        event_time: createForm.eventTime || null,
        opening_stock_bbl: openingStock,
        opening_water_bbl: openingWater,
        closing_stock_bbl: closingStock,
        closing_water_bbl: closingWater,
        barge_reference: createForm.bargeReference
          ? String(createForm.bargeReference).trim()
          : null,
        remarks: createForm.remarks || null,
      },
      calculated: {
        net: {
          net_stock_bbl: netStock,
          net_water_bbl: netWater,
          TOV: netStock,
          FW: netWater,
          NSV: netStock,
        },
      },
    }

    const values = initValuesFromTemplate(createForm.operationTemplateId).map((v) => {
      if (v.fieldCode === 'shuttle_payload') return { ...v, fieldValue: payload }
      return v
    })

    const entry = {
      operationTypeCode: template.operationTypeCode,
      operationTemplateId: Number(template.id),
      primaryAssetCode: selectedGroup.shuttleAssetCode,
      originLocationCode: selectedGroup.locationCode,
      destinationLocationCode: '',
      senderLocationCode: '',
      receiverLocationCode: '',
      convoyNumber: selectedGroup.shuttleNumber,
      operationDate: createForm.operationDate,
      operationStartDatetime: '',
      operationEndDatetime: '',
      productName: createForm.productName || '',
      remarks: createForm.remarks || '',
      status: 'Draft',
      values,
    }

    try {
      setLoading(true)
      const created = await createOperationEntry(entry)
      const createdId = created?.id

      setSuccessMsg('Draft ticket created. Submit & Approve from OTR to appear in tracking.')

      if (createdId) {
        navigate(`/operation-transactions/${createdId}`)
        return
      }

      await loadTracking()
    } catch (e) {
      setErrorMsg(e.message || 'Unable to create ticket')
    } finally {
      setLoading(false)
    }
  }

  const onCreateChange = (e) => {
    const { name, value } = e.target
    setCreateForm((c) => ({ ...c, [name]: value }))
  }

  // Toggle expand/minimize voyage
  const toggleVoyage = async (key) => {
    const nextKey = selectedGroupKey === key ? '' : key
    setSelectedGroupKey(nextKey)

    if (nextKey) {
      try {
        setLoading(true)
        const resp = await getShuttleTracking({
          ...filters,
          group_key: nextKey,
          include_tickets: true,
          page: 1,
          page_size: 1,
        })
        const loaded = (resp.rows || [])[0]
        if (loaded) {
          setReport((r) => ({
            ...r,
            rows: (r.rows || []).map((row) => (row.groupKey === nextKey ? loaded : row)),
          }))
        }
      } catch (e) {
        setErrorMsg(e.message || 'Unable to load voyage tickets')
      } finally {
        setLoading(false)
      }
    }
  }

  const minimizeVoyage = () => {
    setSelectedGroupKey('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // ----------------------------
  // RENDER
  // ----------------------------
  return (
    <>
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
      {promptModal && promptModal.action === 'close' && (
        <div className="confirm-overlay">
          <div className="confirm-dialog">
            <p>Close this voyage?</p>
            <textarea
              rows="3"
              placeholder="Closure remarks (optional)"
              value={promptModal.value}
              onChange={(e) => setPromptModal({ ...promptModal, value: e.target.value })}
            />
            <div className="confirm-actions">
              <button onClick={confirmCloseVoyage}>Close Voyage</button>
              <button onClick={() => setPromptModal(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
      {promptModal && promptModal.action === 'reopen' && (
        <div className="confirm-overlay">
          <div className="confirm-dialog">
            <p>Type exactly to confirm reopen:</p>
            <pre style={{ fontSize: 12, background: '#f5f5f5', padding: 8 }}>{promptModal.confirmText}</pre>
            <input
              type="text"
              placeholder="Type the confirmation text above"
              value={promptModal.value}
              onChange={(e) => setPromptModal({ ...promptModal, value: e.target.value })}
            />
            <textarea
              rows="2"
              placeholder="Reopen remarks (optional)"
              value={promptModal.remarks}
              onChange={(e) => setPromptModal({ ...promptModal, remarks: e.target.value })}
              style={{ marginTop: 8 }}
            />
            <div className="confirm-actions">
              <button onClick={confirmReopenVoyage}>Reopen Voyage</button>
              <button onClick={() => setPromptModal(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
      <div className="print-only mtr-page">
        {selectedGroup ? (
          <>
            <div className="mtr-header">
              <h1>SHUTTLE VOYAGE MTR</h1>
              <div className="mtr-sub">
                <div><strong>Location:</strong> {selectedGroup.locationCode} - {selectedGroup.locationName}</div>
                <div><strong>Printed:</strong> {new Date().toLocaleString()}</div>
                <div><strong>Shuttle:</strong> {selectedGroup.shuttleAssetCode} - {selectedGroup.shuttleAssetName}</div>
                <div><strong>Shuttle No:</strong> {selectedGroup.shuttleNumber}</div>
              </div>
            </div>

            <div className="mtr-kv">
              <div className="mtr-kv-grid">
                <div><strong>Status:</strong> {selectedGroup.voyageStatus}</div>
                <div><strong>Tickets (Approved):</strong> {(sortedSelectedTickets || []).length}</div>

                <div><strong>Net Receipt (BBL):</strong> {Number(selectedGroup.netReceiptBbl || 0).toFixed(3)}</div>
                <div><strong>Net Discharge (BBL):</strong> {Number(selectedGroup.netDischargeBbl || 0).toFixed(3)}</div>

                <div><strong>Last Closing Stock (BBL):</strong> {Number(voyageSummary?.lastClosingStock || 0).toFixed(3)}</div>
                <div><strong>Last Closing Water (BBL):</strong> {Number(voyageSummary?.lastClosingWater || 0).toFixed(3)}</div>
              </div>
            </div>

            <table className="mtr-table">
              <thead>
                <tr>
                  <th style={{ width: '10%' }}>Date</th>
                  <th style={{ width: '8%' }}>Time</th>
                  <th style={{ width: '14%' }}>Operation</th>
                  <th style={{ width: '8%' }}>Sign</th>
                  <th style={{ width: '12%' }}>Net Stock</th>
                  <th style={{ width: '12%' }}>Net Water</th>
                  <th style={{ width: '12%' }}>Qty (Abs S+W)</th>
                  <th style={{ width: '24%' }}>Ticket</th>
                </tr>
              </thead>
              <tbody>
                {(sortedSelectedTickets || []).map((t) => {
                  const netStock = Number(t.netStockBbl || 0)
                  const netWater = Number(t.netWaterBbl || 0)
                  const qty = Math.abs(netStock) + Math.abs(netWater)

                  return (
                    <tr key={`p-${t.transactionId}`}>
                      <td>{t.operationDate || ''}</td>
                      <td>{t.eventTime || ''}</td>
                      <td>{t.vesselOperationLabel || t.vesselOperationCode || ''}</td>
                      <td>{t.vesselOperationSign || ''}</td>
                      <td>{netStock.toFixed(3)}</td>
                      <td>{netWater.toFixed(3)}</td>
                      <td>{qty.toFixed(3)}</td>
                      <td>{t.ticketNumber || t.transactionId}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            <div className="mtr-footer">
              <div>System: Hydrocarbon Accounting</div>
              <div>Module: Shuttle Tracking</div>
            </div>
          </>
        ) : (
          <div className="mtr-header">
            <h1>SHUTTLE VOYAGE MTR</h1>
            <div style={{ fontSize: 11 }}>Select a voyage on screen first, then click Print.</div>
          </div>
        )}
      </div>

      <div className="screen-only">
        <div>
      <div className="page-title">
        <div>
          <h2>Shuttle Tracking</h2>
          <p>
            Approved-only voyage tracking within a single location (Location + Shuttle Number + Shuttle Asset).
          </p>
        </div>
        <span className="record-count">{report.totalGroups} Voyages</span>
      </div>

      <div className="info-box">
        Shuttle Tracking shows only <strong>Approved</strong> tickets.
      </div>

      {!canManageShuttle && !canCreateOperationEntry && (
        <div className="info-box">
          You have view-only access. Assign <strong>Manage Shuttle Tracking</strong> to
          close/reopen voyages, or <strong>Create Operation Entry</strong> to create
          tracking tickets.
        </div>
      )}

      <div className="two-column-grid">
        {/* LEFT COLUMN */}
        <div>
          {/* Find Voyages (HORIZONTAL filters) */}
          <div className="info-box">
            <strong>Find Voyages</strong>

            <div
              style={{
                marginTop: 10,
                display: 'flex',
                flexWrap: 'wrap',
                gap: 10,
                alignItems: 'flex-end',
              }}
            >
              <div style={{ minWidth: 220 }}>
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

              <div style={{ minWidth: 220 }}>
                <label>Shuttle Number</label>
                <input
                  name="shuttle_number"
                  value={filters.shuttle_number}
                  onChange={onFilterChange}
                  placeholder="Voyage number"
                />
              </div>

              <div style={{ minWidth: 220 }}>
                <label>Shuttle Asset</label>
                <select name="shuttle_asset_code" value={filters.shuttle_asset_code} onChange={onFilterChange}>
                  <option value="">All</option>
                  {activeAssets.map((a) => (
                    <option key={a.id} value={a.assetCode}>
                      {a.assetName} ({a.assetCode})
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ minWidth: 170 }}>
                <label>Date From</label>
                <input type="date" name="date_from" value={filters.date_from} onChange={onFilterChange} />
              </div>

              <div style={{ minWidth: 170 }}>
                <label>Date To</label>
                <input type="date" name="date_to" value={filters.date_to} onChange={onFilterChange} />
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" disabled={loading} onClick={loadTracking}>
                  {loading ? 'Loading...' : 'Search'}
                </button>
                <button type="button" disabled={loading} onClick={clearFilters}>
                  Clear
                </button>
              </div>
            </div>
          </div>

          {/* Open/Closed tabs + search + pagination (already horizontal) */}
          <div className="info-box">
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <button
                type="button"
                className={activeVoyageTab === 'OPEN' ? 'active-tab-btn' : ''}
                onClick={() => setActiveVoyageTab('OPEN')}
              >
                Open Voyages ({openVoyageCount})
              </button>

              <button
                type="button"
                className={activeVoyageTab === 'CLOSED' ? 'active-tab-btn' : ''}
                onClick={() => setActiveVoyageTab('CLOSED')}
              >
                Closed Voyages ({closedVoyageCount})
              </button>

              <div style={{ flex: 1, minWidth: 260 }}>
                <input
                  value={voyageSearch}
                  onChange={(e) => setVoyageSearch(e.target.value)}
                  placeholder="Live search: location / asset / shuttle number..."
                />
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  disabled={voyagePage <= 1}
                  onClick={() => setVoyagePage((p) => Math.max(1, p - 1))}
                >
                  Prev
                </button>
                <span style={{ alignSelf: 'center' }}>
                  Page {voyagePage} / {voyageTotalPages}
                </span>
                <button
                  type="button"
                  disabled={voyagePage >= voyageTotalPages}
                  onClick={() => setVoyagePage((p) => Math.min(voyageTotalPages, p + 1))}
                >
                  Next
                </button>
              </div>
            </div>

            <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}>
              Showing {pagedVoyageRows.length} of {filteredVoyageRows.length} voyages
            </div>
          </div>

          {/* Voyage list */}
          <div className="section-title">
            <h3>Voyage List</h3>
            <p>Click a voyage to expand. Click again or press “Minimize” to collapse.</p>
          </div>

          <table>
            <thead>
              <tr>
                <th>Key</th>
                <th>Status</th>
                <th>Net Receipt</th>
                <th>Net Discharge</th>
                <th>Tickets</th>
              </tr>
            </thead>
            <tbody>
              {pagedVoyageRows.length === 0 ? (
                <tr>
                  <td colSpan="5" className="empty-table">No voyages found.</td>
                </tr>
              ) : (
                pagedVoyageRows.map((r) => (
                  <tr
                    key={r.groupKey}
                    style={{
                      cursor: 'pointer',
                      background: r.groupKey === selectedGroupKey ? '#eff6ff' : 'transparent',
                    }}
                    onClick={() => toggleVoyage(r.groupKey)}
                  >
                    <td>
                      <strong>{r.locationCode}</strong> | {r.shuttleAssetCode} | {r.shuttleNumber}
                    </td>
                    <td>{r.voyageStatus}</td>
                    <td>{Number(r.netReceiptBbl || 0).toFixed(3)}</td>
                    <td>{Number(r.netDischargeBbl || 0).toFixed(3)}</td>
                    <td>{(r.tickets || []).length}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* RIGHT COLUMN */}
        <div>
          {!selectedGroup ? (
            <div className="info-box">Select a voyage to view timeline and actions.</div>
          ) : (
            <>
              {/* Selected voyage header with minimize */}
              <div className="info-box compact-card sticky-right-header">
                <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', flexWrap: 'wrap' }}>
                  <div>
                    <strong>Voyage:</strong> {selectedGroup.locationCode} | {selectedGroup.shuttleAssetCode} | {selectedGroup.shuttleNumber}
                    <div style={{ marginTop: 8 }}>
                      <span className="permission-badge">{selectedGroup.voyageStatus}</span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <button type="button" onClick={minimizeVoyage}>
                      Minimize
                    </button>
                    <button
                      type="button"
                      disabled={loading || !canManageShuttle || isVoyageClosed}
                      onClick={closeVoyage}
                      title={!canManageShuttle ? 'You do not have permission to close shuttle voyage' : ''}
                    >
                      Close Voyage
                    </button>
                    <button
                      type="button"
                      disabled={loading || !canManageShuttle || !isVoyageClosed}
                      onClick={reopenVoyage}
                      title={!canManageShuttle ? 'You do not have permission to reopen shuttle voyage' : ''}
                    >
                      Reopen Voyage
                    </button>
                    <button type="button" disabled={loading} onClick={downloadCsvForSelected}>
                      Export CSV
                    </button>
                    <button type="button" disabled={loading} onClick={exportExcelForSelected}>
                      Export Excel
                    </button>
                    <button type="button" className="no-print" onClick={() => window.print()}>
                      Print (MTR)
                    </button>
                  </div>
                </div>
              </div>

              <div className="compact-row-2">
                {/* Summary */}
                {voyageSummary && (
                  <div className="info-box compact-card">
                    <strong>Voyage Summary</strong>
                    <table className="summary-table" style={{ marginTop: 8 }}>
                      <thead>
                        <tr>
                          <th>Status</th>
                          <th>Approved Tickets</th>
                          <th>Last Closing Stock (BBL)</th>
                          <th>Last Closing Water (BBL)</th>
                        </tr>
                      </thead>

                      <tbody>
                        <tr>
                          <td>{voyageSummary?.status || '-'}</td>
                          <td>{voyageSummary?.ticketCount ?? 0}</td>
                          <td>{Number(voyageSummary?.lastClosingStock ?? 0).toFixed(3)}</td>
                          <td>{Number(voyageSummary?.lastClosingWater ?? 0).toFixed(3)}</td>
                        </tr>
                      </tbody>
                    </table>
                    {voyageSummary?.isClosed && voyageSummary?.netDischargeBbl != null ? (
                      <div className="info-box" style={{ marginTop: 10 }}>
                        <strong>Total Discharge to FSO (BBL):</strong>{' '}
                        {Number(voyageSummary.netDischargeBbl).toFixed(3)}
                      </div>
                    ) : null}
                    <div className="form-actions no-print" style={{ marginTop: 10 }}>
                      <button type="button" onClick={() => openMappingForVoyage('all')}>
                        Open Movement Mapping
                      </button>

                      <button type="button" onClick={() => openMappingForVoyage('openOnly')}>
                        Open Mapping (OPEN only)
                      </button>
                    </div>
                  </div>
                )}

                {/* Quick stages */}
                <div className="info-box compact-card">
                  <strong>Quick Stages</strong>
                  <div className="stage-wrap">
                    {stageOps.length === 0 ? (
                      <span>No Tracking operations configured in Vessel Operation Master.</span>
                    ) : (
                      stageOps.map((op) => (
                        <button
                          key={op.id || op.operation_code}
                          type="button"
                          disabled={loading || !canCreateOperationEntry || isVoyageClosed}
                          onClick={() => pickStage(op)}
                          title={!canCreateOperationEntry ? 'You do not have permission to create operation entry' : ''}
                        >
                          {op.operation_label}
                        </button>
                      ))
                    )}
                  </div>
                  {isVoyageClosed && (
                    <div style={{ marginTop: 6, fontSize: 12, opacity: 0.8 }}>
                      Voyage is CLOSED — actions are read-only.
                    </div>
                  )}
                </div>
              </div>

              {/* Timeline Filters (horizontal) */}
              <div className="section-title">
                <h3>Voyage Timeline</h3>
                <p>Approved tickets in chronological order.</p>
              </div>

              <div className="info-box compact-card">
                <div className="compact-toolbar">
                  <div className="compact-toolbar-left">
                    <input
                      value={timelineSearch}
                      onChange={(e) => setTimelineSearch(e.target.value)}
                      placeholder="Search timeline..."
                      style={{ minWidth: 260 }}
                    />

                    <select
                      value={timelineOpCode}
                      onChange={(e) => setTimelineOpCode(e.target.value)}
                      style={{ minWidth: 260 }}
                    >
                      <option value="">All Operations</option>
                      {(vesselOps || []).map((o) => (
                        <option key={o.id} value={o.operation_code}>
                          {o.operation_label} ({o.operation_code})
                        </option>
                      ))}
                    </select>

                    <button type="button" onClick={expandAllTickets} disabled={pagedTimelineTickets.length === 0}>
                      Expand Page
                    </button>
                    <button type="button" onClick={collapseAllTickets} disabled={expandedTicketIds.size === 0}>
                      Collapse All
                    </button>

                    <span style={{ fontSize: 12, opacity: 0.75 }}>
                      Expanded: {expandedTicketIds.size}
                    </span>
                  </div>

                  <div className="compact-toolbar-right">
                    <button
                      type="button"
                      disabled={timelinePage <= 1}
                      onClick={() => setTimelinePage((p) => Math.max(1, p - 1))}
                    >
                      Prev
                    </button>

                    <span style={{ fontSize: 12, opacity: 0.8 }}>
                      Page {timelinePage} / {timelineTotalPages}
                    </span>

                    <button
                      type="button"
                      disabled={timelinePage >= timelineTotalPages}
                      onClick={() => setTimelinePage((p) => Math.min(timelineTotalPages, p + 1))}
                    >
                      Next
                    </button>

                    <button type="button" disabled={timelineTotalPages <= 1} onClick={() => setTimelinePage(timelineTotalPages)}>
                      Latest
                    </button>
                  </div>
                </div>

                <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}>
                  Showing {pagedTimelineTickets.length} of {filteredTimelineTickets.length} tickets (filtered)
                </div>
              </div>

              <table className="dense-table">
                <thead>
                  <tr>
                    <th></th>
                    <th>Ticket</th>
                    <th>Date</th>
                    <th>Time</th>
                    <th>Operation</th>
                    <th>Net Stock</th>
                    <th>Net Water</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedTimelineTickets.length === 0 ? (
                    <tr>
                      <td colSpan="7" className="empty-table">
                        No tickets for current filters.
                      </td>
                    </tr>
                  ) : (
                    pagedTimelineTickets.map((t, index) => {
                      const expanded = isTicketExpanded(t.transactionId)
                      const globalIndex = (timelinePage - 1) * TIMELINE_PAGE_SIZE + index

                      return (
                        <>
                          <tr key={t.transactionId}>
                            <td>
                              <button type="button" onClick={() => toggleTicket(t.transactionId)}>
                                {expanded ? '−' : '+'}
                              </button>
                            </td>

                            <td>
                              <button
                                type="button"
                                onClick={() => navigate(`/operation-transactions/${t.transactionId}`)}
                              >
                                {t.ticketNumber || t.transactionId}
                              </button>
                            </td>

                            <td>{t.operationDate}</td>
                            <td>{t.eventTime || '-'}</td>
                            <td>{getDisplayOperationLabel(filteredTimelineTickets, globalIndex)}</td>
                            <td>{Number(t.netStockBbl || 0).toFixed(3)}</td>
                            <td>{Number(t.netWaterBbl || 0).toFixed(3)}</td>
                          </tr>

                          {expanded && (
                            <tr key={`${t.transactionId}-details`}>
                              <td colSpan="7">
                                <div className="info-box" style={{ margin: 0 }}>
                                  <strong>Ticket Details</strong>

                                  <table className="ticket-details-table" style={{ marginTop: 8 }}>
                                    <thead>
                                      <tr>
                                        <th>Open Stock</th>
                                        <th>Open Water</th>
                                        <th>Close Stock</th>
                                        <th>Close Water</th>
                                        <th>Net Stock</th>
                                        <th>Net Water</th>
                                        <th>Barge Ref</th>
                                      </tr>
                                    </thead>

                                    <tbody>
                                      <tr className="ticket-details-row">
                                        <td>{Number(t.openingStockBbl || 0).toFixed(3)}</td>
                                        <td>{Number(t.openingWaterBbl || 0).toFixed(3)}</td>
                                        <td>{Number(t.closingStockBbl || 0).toFixed(3)}</td>
                                        <td>{Number(t.closingWaterBbl || 0).toFixed(3)}</td>
                                        <td>{Number(t.netStockBbl || 0).toFixed(3)}</td>
                                        <td>{Number(t.netWaterBbl || 0).toFixed(3)}</td>
                                        <td>{t.bargeReference || '-'}</td>
                                      </tr>
                                    </tbody>
                                  </table>

                                  <div style={{ marginTop: 8, fontSize: 12 }}>
                                    <strong>Remarks:</strong> {t.remarks || '-'}
                                  </div>

                                  <div className="ticket-details-actions">
                                    <button
                                      type="button"
                                      onClick={() => navigate(`/operation-transactions/${t.transactionId}`)}
                                    >
                                      Open Ticket
                                    </button>

                                    <button type="button" onClick={() => toggleTicket(t.transactionId)}>
                                      Minimize
                                    </button>
                                  </div>
                              </div>
                            </td>
                          </tr>
                        )}
                        </>
                      )
                    })
                  )}
                </tbody>
              </table>

              {/* ✅ IMPORTANT: Create module hidden completely when voyage is CLOSED */}
              {!isVoyageClosed ? (
                <>
                  {!showCreatePanel ? (
                    <div className="info-box">
                      <strong>Create Tracking Ticket</strong>
                      <div style={{ marginTop: 6, opacity: 0.85 }}>
                        Click a <strong>Quick Stage</strong> above (TOP_UP / STS / UNLOADING) to open the entry form.
                      </div>
                    </div>
                  ) : null}

                  {showCreatePanel ? (
                    <>
                      <div className="section-title">
                        <h3>Create Tracking Ticket (Draft)</h3>
                        <p>Stage: <strong>{selectedStageLabel}</strong></p>
                      </div>

                      <div className="info-box" ref={createFormRef}>
                        <div className="create-2col-grid">
                          <div>
                            <label>Operation Template (Shuttle Tracking)</label>
                            <select
                              name="operationTemplateId"
                              value={createForm.operationTemplateId}
                              onChange={(e) =>
                                setCreateForm((c) => ({ ...c, operationTemplateId: e.target.value }))
                              }
                            >
                              <option value="">Select</option>
                              {shuttleTemplates.map((t) => (
                                <option key={t.id} value={String(t.id)}>
                                  {t.templateName} ({t.operationTypeCode})
                                </option>
                              ))}
                            </select>
                          </div>

                          <div>
                            <label>Tracking Operation</label>
                            <select
                              name="vesselOperationCode"
                              value={createForm.vesselOperationCode}
                              onChange={onCreateChange}
                            >
                              <option value="">Select</option>
                              {vesselOps.map((o) => (
                                <option key={o.id} value={o.operation_code}>
                                  {o.operation_label} ({o.operation_code}) [{o.operation_sign}]
                                </option>
                              ))}
                            </select>
                          </div>

                          <div>
                            <label>Operation Date</label>
                            <input
                              type="date"
                              name="operationDate"
                              value={createForm.operationDate}
                              onChange={onCreateChange}
                            />
                          </div>

                          <div>
                            <label>Event Time</label>
                            <input
                              type="time"
                              name="eventTime"
                              value={createForm.eventTime}
                              onChange={onCreateChange}
                            />
                          </div>

                          <div>
                            <label>Location</label>
                            <input value={selectedGroup.locationCode} disabled />
                          </div>

                          <div>
                            <label>Shuttle Asset</label>
                            <input value={selectedGroup.shuttleAssetCode} disabled />
                          </div>

                          <div>
                            <label>Shuttle Number</label>
                            <input value={selectedGroup.shuttleNumber} disabled />
                          </div>

                          <div>
                            <label>Barge Reference</label>
                            <input
                              name="bargeReference"
                              value={createForm.bargeReference}
                              onChange={onCreateChange}
                              placeholder="Optional"
                            />
                          </div>

                          <div>
                            <label>Opening Stock (BBL)</label>
                            <input
                              type="number"
                              name="openingStockBbl"
                              value={createForm.openingStockBbl}
                              onChange={onCreateChange}
                            />
                          </div>

                          <div>
                            <label>Opening Water (BBL)</label>
                            <input
                              type="number"
                              name="openingWaterBbl"
                              value={createForm.openingWaterBbl}
                              onChange={onCreateChange}
                            />
                          </div>

                          <div>
                            <label>Closing Stock (BBL)</label>
                            <input
                              type="number"
                              name="closingStockBbl"
                              value={createForm.closingStockBbl}
                              onChange={onCreateChange}
                              placeholder="Leave blank to use Opening"
                            />
                          </div>

                          <div>
                            <label>Closing Water (BBL)</label>
                            <input
                              type="number"
                              name="closingWaterBbl"
                              value={createForm.closingWaterBbl}
                              onChange={onCreateChange}
                              placeholder="Leave blank to use Opening"
                            />
                          </div>

                          <div>
                            <label>Net Stock</label>
                            <input value={liveNet.netStock.toFixed(3)} disabled />
                          </div>

                          <div>
                            <label>Net Water</label>
                            <input value={liveNet.netWater.toFixed(3)} disabled />
                          </div>

                          <div className="full-width">
                            <label>Remarks</label>
                            <textarea
                              name="remarks"
                              rows="2"
                              value={createForm.remarks}
                              onChange={onCreateChange}
                            />
                          </div>
                        </div>

                        <div className="form-actions" style={{ marginTop: 10 }}>
                          <button
                            type="button"
                            disabled={loading || !canCreateOperationEntry}
                            onClick={createTicket}
                            title={!canCreateOperationEntry ? 'You do not have permission to create operation entry' : ''}
                          >
                            {loading ? 'Saving...' : 'Create Draft Ticket'}
                          </button>
                        </div>
                      </div>
                    </>
                  ) : null}
                </>
              ) : (
                <div className="info-box compact-card">
                  <strong>Voyage is CLOSED</strong>
                  <div style={{ marginTop: 6, opacity: 0.85 }}>
                    Draft creation is not available for a closed voyage. Use <strong>Reopen Voyage</strong> if you need to continue.
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
      </div>
      </div>
    </>
  )
}


export default ShuttleTracking
