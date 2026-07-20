import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { apiPost } from '../api/apiClient'
import {
  createOperationEntry,
  deleteOperationEntry,
  updateOperationEntry,
} from '../api/operationEntryApi'
import { getOperationTemplateLayouts } from '../api/operationTemplateApi'
import TankGaugingLayout from '../components/operationLayouts/TankGaugingLayout'
import MultiTankBeforeAfterLayout from '../components/operationLayouts/MultiTankBeforeAfterLayout'
import TankerTruckLayout from '../components/operationLayouts/TankerTruckLayout'
import TankerPayloadPreview from '../components/operationLayouts/TankerPayloadPreview'
import { getTankerSenderReference } from '../api/tankerTrackingApi'
import StockMovementLayout from '../components/operationLayouts/StockMovementLayout'
import VesselCycleLayout from '../components/operationLayouts/VesselCycleLayout'
import ShuttleTrackingLayout from '../components/operationLayouts/ShuttleTrackingLayout'
import FSOTrackingLayout from '../components/operationLayouts/FSOTrackingLayout.jsx'
import FlowmeterReadingLayout from '../components/operationLayouts/FlowmeterReadingLayout'

function LayoutSummaryPanel({ selectedTemplate }) {
  if (!selectedTemplate) {
    return null
  }

  return (
    <div className="full-width-field">
      <div className="operation-layout-banner">
        <div>
          <span>Entry Layout</span>
          <strong>{selectedTemplate.entryLayoutType || 'Standard Form'}</strong>
        </div>

        <div>
          <span>Calculation Engine</span>
          <strong>{selectedTemplate.calculationEngine || 'None'}</strong>
        </div>

        <div>
          <span>Template</span>
          <strong>{selectedTemplate.templateName}</strong>
        </div>
      </div>
    </div>
  )
}

function LayoutPlaceholder({ title, description, sections }) {
  return (
    <div className="full-width-field">
      <div className="operation-special-layout">
        <div className="operation-special-layout-header">
          <h3>{title}</h3>
          <p>{description}</p>
        </div>

        <div className="operation-layout-section-grid">
          {sections.map((section) => (
            <div key={section.title} className="operation-layout-section-card">
              <h4>{section.title}</h4>

              <ul>
                {section.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="info-box">
          Layout foundation is active. This section will be converted into a
          dedicated asset-specific entry layout in the next phase.
        </div>
      </div>
    </div>
  )
}

function OperationTemplateFields({
  entry,
  selectedTemplate,
  selectedTemplateFields,
  handleValueChange,
  getInputType,
  excludedFieldCodes = [],
}) {
  if (!selectedTemplate) {
    return null
  }

  const visibleValues = entry.values.filter((value) => {
    return !excludedFieldCodes.includes(value.fieldCode)
  })

  if (visibleValues.length === 0) {
    return (
      <div className="full-width-field">
        <div className="info-box">
          No additional template fields are available outside the selected
          asset-specific layout.
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="full-width-field">
        <div className="section-title compact-section-title">
          <h3>Additional Template Fields</h3>
          <p>
            These fields are generated from the selected Operation Template. The
            asset-specific layout fields are handled above.
          </p>
        </div>
      </div>

      {visibleValues.map((value) => {
        const templateField = selectedTemplateFields.find((field) => {
          return field.fieldCode === value.fieldCode
        })

        const isRequiredManual =
          templateField?.isRequired === 'Yes' && value.inputMode === 'Manual'

        return (
          <div key={value.fieldCode}>
            <label>
              {value.fieldName}
              {value.unit ? ` (${value.unit})` : ''}
              {isRequiredManual ? ' *' : ''}
            </label>

            <input
              type={getInputType(value.dataType)}
              value={
                typeof value.fieldValue === 'object'
                  ? JSON.stringify(value.fieldValue)
                  : value.fieldValue
              }
              onChange={(e) =>
                handleValueChange(value.fieldCode, e.target.value)
              }
              disabled={value.inputMode !== 'Manual'}
              placeholder={
                value.inputMode === 'Manual'
                  ? `Enter ${value.fieldName}`
                  : `${value.inputMode} field - populated by system`
              }
            />

            <small>
              {value.fieldGroup} / {value.inputMode} / {value.calculationRole}
            </small>
          </div>
        )
      })}
    </>
  )
}

function OperationTemplateStructuredFields({
  entry,
  selectedTemplateFields,
  templateLayout,
  handleValueChange,
  getInputType,
}) {
  if (!templateLayout || !Array.isArray(templateLayout.items)) {
    return null
  }

  const valueByFieldCode = new Map((entry.values || []).map((v) => [v.fieldCode, v]))
  const fieldById = new Map((selectedTemplateFields || []).map((f) => [Number(f.id), f]))
  const sectionBuckets = (templateLayout.sections || []).map((section) => {
    return {
      ...section,
      items: [],
    }
  })
  const sectionBucketById = new Map(sectionBuckets.map((s) => [Number(s.id), s]))

  ;(templateLayout.items || []).forEach((item) => {
    const sectionBucket = sectionBucketById.get(Number(item.sectionId))
    const field = fieldById.get(Number(item.fieldId))
    if (!sectionBucket || !field) return
    const value = valueByFieldCode.get(field.fieldCode)
    if (!value) return
    sectionBucket.items.push({ item, field, value })
  })

  const renderedSections = sectionBuckets
    .map((section) => ({
      ...section,
      items: section.items.sort((a, b) => {
        const rowDiff = Number(a.item.rowNo || 0) - Number(b.item.rowNo || 0)
        if (rowDiff !== 0) return rowDiff
        const colDiff = Number(a.item.colStart || 0) - Number(b.item.colStart || 0)
        if (colDiff !== 0) return colDiff
        return Number(a.item.sortOrder || 0) - Number(b.item.sortOrder || 0)
      }),
    }))
    .filter((section) => section.items.length > 0)

  if (renderedSections.length === 0) return null

  return (
    <div className="full-width-field">
      <div className="operation-special-layout">
        <div className="operation-special-layout-header">
          <h3>Structured Template Fields</h3>
          <p>Rendered from saved operation template layout configuration.</p>
        </div>

        {renderedSections.map((section) => {
          const rows = new Map()
          section.items.forEach((wrapped) => {
            const rowNo = Number(wrapped.item.rowNo || 1)
            if (!rows.has(rowNo)) rows.set(rowNo, [])
            rows.get(rowNo).push(wrapped)
          })
          const sortedRows = [...rows.entries()].sort((a, b) => a[0] - b[0])

          return (
            <div key={section.id} className="full-width-field">
              <div className="section-title compact-section-title">
                <h3>{section.title || section.sectionKey}</h3>
                <p>Section fields arranged by configured row and column.</p>
              </div>

              {sortedRows.map(([rowNo, rowItems]) => (
                <div key={`${section.id}-${rowNo}`} className="layout-preview-grid">
                  {rowItems
                    .sort((a, b) => Number(a.item.colStart || 0) - Number(b.item.colStart || 0))
                    .map(({ item, field, value }) => {
                      const isRequiredManual =
                        field?.isRequired === 'Yes' && value.inputMode === 'Manual'
                      const span = Math.min(Math.max(Number(item.colSpan || 1), 1), 3)
                      return (
                        <div key={item.id || `${field.fieldCode}-${rowNo}`} className={`layout-preview-cell span-${span}`}>
                          <label>
                            {item.labelOverride || value.fieldName}
                            {value.unit ? ` (${value.unit})` : ''}
                            {isRequiredManual ? ' *' : ''}
                          </label>
                          <input
                            type={getInputType(value.dataType)}
                            value={
                              typeof value.fieldValue === 'object'
                                ? JSON.stringify(value.fieldValue)
                                : value.fieldValue
                            }
                            onChange={(e) => handleValueChange(value.fieldCode, e.target.value)}
                            disabled={value.inputMode !== 'Manual'}
                            placeholder={
                              item.placeholderOverride ||
                              (value.inputMode === 'Manual'
                                ? `Enter ${value.fieldName}`
                                : `${value.inputMode} field - populated by system`)
                            }
                          />
                        </div>
                      )
                    })}
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function OperationLayoutRenderer({
  entry,
  editId,
  selectedTemplate,
  selectedTemplateFields,
  selectedAsset,
  assets = [],
  locations = [],
  assetCalibrationTables,
  calibrationTemplates,
  handleValueChange,
  getInputType,
  senderReference = null,
  senderReferenceLoading = false,
  receiverMode = false,
  setEntryField,
  templateLayout = null,
}) {
  if (!selectedTemplate) {
    return (
      <div className="full-width-field">
        <div className="info-box">
          Selected operation template could not be found. Please reload Operation
          Templates or check whether this ticket has a valid operation template.
        </div>
      </div>
    )
  }

  const layoutType = String(
    selectedTemplate.entryLayoutType || 'Standard Form'
  ).trim()

  const calculationEngine = String(
    selectedTemplate.calculationEngine || 'None'
  ).trim()

  const normalizedLayoutType = layoutType.toLowerCase()
  const normalizedCalculationEngine = calculationEngine.toLowerCase()
  const normalizedTemplateName = String(
    selectedTemplate.templateName || ''
  ).toLowerCase()

  const hasTankPayloadField = entry.values.some((value) => {
    return value.fieldCode === 'tank_gauging_payload'
  })

  const isTankGaugingLayout =
    normalizedLayoutType === 'tank gauging' ||
    normalizedCalculationEngine === 'tank quantity' ||
    hasTankPayloadField

  if (isTankGaugingLayout) {
    return (
      <>
        <TankGaugingLayout
          key={`tank-gauging-${editId ?? 'new'}-${entry.operationTemplateId}-${entry.primaryAssetCode}`}
          entry={entry}
          editId={editId}
          selectedAsset={selectedAsset}
          assetCalibrationTables={assetCalibrationTables}
          calibrationTemplates={calibrationTemplates}
          handleValueChange={handleValueChange}
        />

        <OperationTemplateFields
          entry={entry}
          selectedTemplate={selectedTemplate}
          selectedTemplateFields={selectedTemplateFields}
          handleValueChange={handleValueChange}
          getInputType={getInputType}
          excludedFieldCodes={['tank_gauging_payload']}
        />
      </>
    )
  }

  if (layoutType === 'Stock Movement') {
    return (
      <>
        <StockMovementLayout
          entry={entry}
          editId={editId}
          selectedAsset={selectedAsset}
          assets={assets}
          handleValueChange={handleValueChange}
        />

        <OperationTemplateFields
          entry={entry}
          selectedTemplate={selectedTemplate}
          selectedTemplateFields={selectedTemplateFields}
          handleValueChange={handleValueChange}
          getInputType={getInputType}
          excludedFieldCodes={[
            'vessel_operation_code',
            'movement_reference',
            'reference_number',
            'opening_stock',
            'opening_water',
            'closing_stock',
            'closing_water',
            'net_stock',
            'net_water',
            'net_nsv',
          ]}
        />
      </>
    )
  }

  if (layoutType === 'Multi-Tank Before/After') {
    return (
      <>
        <MultiTankBeforeAfterLayout
          key={`multi-tank-${editId ?? 'new'}-${entry.operationTemplateId}-${entry.primaryAssetCode}`}
          entry={entry}
          editId={editId}
          selectedAsset={selectedAsset}
          assetCalibrationTables={assetCalibrationTables}
          calibrationTemplates={calibrationTemplates}
          handleValueChange={handleValueChange}
        />

        <OperationTemplateFields
          entry={entry}
          selectedTemplate={selectedTemplate}
          selectedTemplateFields={selectedTemplateFields}
          handleValueChange={handleValueChange}
          getInputType={getInputType}
          excludedFieldCodes={['multi_tank_payload', 'barge_event_type']}
        />
      </>
    )
  }

  if (layoutType === 'Vessel Cycle') {
    return (
      <>
        <VesselCycleLayout
          entry={entry}
          editId={editId}
          selectedAsset={selectedAsset}
          assets={assets}
          locations={locations}
          handleValueChange={handleValueChange}
        />

        <OperationTemplateFields
          entry={entry}
          selectedTemplate={selectedTemplate}
          selectedTemplateFields={selectedTemplateFields}
          handleValueChange={handleValueChange}
          getInputType={getInputType}
          excludedFieldCodes={[
            'vessel_operation_code',
            'movement_reference',
            'shuttle_number',
            'reference_number',
            'counterparty_asset_code',
            'quantity_bbl',
            'gross_qty_bbl',
            'water_bbl',
            'nsv_bbl',
          ]}
        />
      </>
    )
  }

  if (layoutType === 'Shuttle Tracking') {
    return (
      <>
        <ShuttleTrackingLayout
          entry={entry}
          selectedAsset={selectedAsset}
          handleValueChange={handleValueChange}
        />

        <OperationTemplateFields
          entry={entry}
          selectedTemplate={selectedTemplate}
          selectedTemplateFields={selectedTemplateFields}
          handleValueChange={handleValueChange}
          getInputType={getInputType}
          excludedFieldCodes={['shuttle_payload']}
        />
      </>
    )
  }

  if (layoutType === 'FSO Tracking') {
    return (
      <>
        <FSOTrackingLayout
          entry={entry}
          selectedAsset={selectedAsset}
          handleValueChange={handleValueChange}
          setEntryField={setEntryField}
        />

        <OperationTemplateFields
          entry={entry}
          selectedTemplate={selectedTemplate}
          selectedTemplateFields={selectedTemplateFields}
          handleValueChange={handleValueChange}
          getInputType={getInputType}
          excludedFieldCodes={['fso_payload']}
        />
      </>
    )
  }

    const hasTankerPayloadField = entry.values.some((value) => {
      return value.fieldCode === 'tanker_payload'
    })

    const isTankerLayout =
      normalizedLayoutType === 'tanker loading' ||
      normalizedCalculationEngine === 'tanker quantity' ||
      hasTankerPayloadField

    if (isTankerLayout) {
      const isLockedForReview =
        entry.status === 'Submitted' ||
        entry.status === 'Approved' ||
        entry.status === 'Cancelled'

      if (isLockedForReview) {
        return (
          <>
            <TankerPayloadPreview entry={entry} title="Tanker Ticket Preview" />

            <OperationTemplateFields
              entry={entry}
              selectedTemplate={selectedTemplate}
              selectedTemplateFields={selectedTemplateFields}
              handleValueChange={handleValueChange}
              getInputType={getInputType}
              excludedFieldCodes={['tanker_payload']}
            />
          </>
        )
      }

      return (
        <>
          <TankerTruckLayout
            key={`tanker-truck-${editId ?? 'new'}-${entry.operationTemplateId}-${entry.primaryAssetCode}`}
            entry={entry}
            editId={editId}
            selectedAsset={selectedAsset}
            assetCalibrationTables={assetCalibrationTables}
            calibrationTemplates={calibrationTemplates}
            handleValueChange={handleValueChange}
            senderReference={senderReference}
            senderReferenceLoading={senderReferenceLoading}
            receiverMode={receiverMode}
          />

          <OperationTemplateFields
            entry={entry}
            selectedTemplate={selectedTemplate}
            selectedTemplateFields={selectedTemplateFields}
            handleValueChange={handleValueChange}
            getInputType={getInputType}
            excludedFieldCodes={['tanker_payload']}
          />
        </>
      )
    }

  if (layoutType === 'Meter Reading') {
    return (
      <>
        <FlowmeterReadingLayout
          entry={entry}
          selectedAsset={selectedAsset}
          handleValueChange={handleValueChange}
          setEntryField={setEntryField}
        />

        <OperationTemplateFields
          entry={entry}
          selectedTemplate={selectedTemplate}
          selectedTemplateFields={selectedTemplateFields}
          handleValueChange={handleValueChange}
          getInputType={getInputType}
          excludedFieldCodes={[
            'flowmeter_payload',
            'meter_label',
            'opening_reading',
            'closing_reading',
            'meter_factor',
            'meter_unit',
            'gross_observed',
            'net_standard',
            'net_standard_bbl',
          ]}
        />
      </>
    )
  }

  return (
    <>
      <OperationTemplateStructuredFields
        entry={entry}
        selectedTemplateFields={selectedTemplateFields}
        templateLayout={templateLayout}
        handleValueChange={handleValueChange}
        getInputType={getInputType}
      />

      <OperationTemplateFields
        entry={entry}
        selectedTemplate={selectedTemplate}
        selectedTemplateFields={selectedTemplateFields}
        handleValueChange={handleValueChange}
        getInputType={getInputType}
        excludedFieldCodes={
          templateLayout
            ? (templateLayout.items || [])
                .map((item) => {
                  const field = selectedTemplateFields.find(
                    (f) => Number(f.id) === Number(item.fieldId)
                  )
                  return field?.fieldCode || null
                })
                .filter(Boolean)
            : []
        }
      />
    </>
  )
}

function OperationEntry({
  operationTypes,
  operationTemplates,
  assets,
  locations,
  assetCalibrationTables = [],
  calibrationTemplates = [],
  operationEntries = [],
  reloadOperationEntries,
  reloadOperationTransactions,
  loggedInUser,
}) {
  const isAdminBootstrap =
    String(loggedInUser?.username || '').toLowerCase() === 'admin'

  const hasPermission = (permissionName) =>
    Boolean(
      loggedInUser?.permissions?.some(
        (p) => p.permissionName === permissionName
      )
    )

  const canCreateOperationEntry = useMemo(() => {
    if (isAdminBootstrap) return true
    return hasPermission('Create Operation Entry')
  }, [loggedInUser])

  const canCancelOperationTransaction = useMemo(() => {
    if (isAdminBootstrap) return true
    return hasPermission('Cancel Operation Transaction')
  }, [loggedInUser])
  const emptyEntry = {
    operationTypeCode: '',
    operationTemplateId: '',
    primaryAssetCode: '',
    convoyNumber: '',
    originLocationCode: '',
    destinationLocationCode: '',
    senderLocationCode: '',
    receiverLocationCode: '',
    operationDate: '',
    operationStartDatetime: '',
    operationEndDatetime: '',
    productName: '',
    createdBy: '',
    remarks: '',
    status: 'Draft',
    values: [],
  }

  const [entry, setEntry] = useState(emptyEntry)

  const setEntryField = (field, value) => {
    setEntry((prev) => ({
      ...prev,
      [field]: value,
    }))
  }

  const [editId, setEditId] = useState(null)
  const [loading, setLoading] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [confirmAction, setConfirmAction] = useState(null)
  const [tankerSenderReference, setTankerSenderReference] = useState(null)
  const [tankerSenderReferenceLoading, setTankerSenderReferenceLoading] =
    useState(false)
  const [editableSearch, setEditableSearch] = useState('')
  const [editableStatusFilter, setEditableStatusFilter] = useState('ALL') // ALL | Draft | Rejected
  const [editablePage, setEditablePage] = useState(1)
  const [selectedTemplateLayout, setSelectedTemplateLayout] = useState(null)
  const EDITABLE_PAGE_SIZE = 20

  const location = useLocation()
  const navigate = useNavigate()
  const [prefillApplied, setPrefillApplied] = useState(false)

  const prefill = useMemo(() => {
    const params = new URLSearchParams(location.search)

    const mode = String(params.get('mode') || '').trim()
    const source = String(params.get('source') || '').trim()

    const senderTransactionIdRaw = String(
      params.get('sender_transaction_id') || ''
    ).trim()
    const senderTransactionId = senderTransactionIdRaw
      ? Number(senderTransactionIdRaw)
      : null

    const convoyNumber = String(params.get('convoy_number') || '').trim()
    const primaryAssetCode = String(params.get('primary_asset_code') || '').trim()
    const originLocationCode = String(params.get('origin_location_code') || '').trim()
    const destinationLocationCode = String(
      params.get('destination_location_code') || ''
    ).trim()
    const senderLocationCode = String(
      params.get('sender_location_code') || ''
    ).trim()
    const receiverLocationCode = String(
      params.get('receiver_location_code') || ''
    ).trim()
    const operationTypeCode = String(params.get('operation_type_code') || '').trim()
    const operationTemplateId = String(
      params.get('operation_template_id') || ''
    ).trim()
    const productName = String(params.get('product_name') || '').trim()
    const remarks = String(params.get('remarks') || '').trim()

    const autoEventType = String(params.get('auto_event_type') || '').trim()
    const leftTicketIdRaw = String(params.get('left_ticket_id') || '').trim()
    const leftTicketId = leftTicketIdRaw ? Number(leftTicketIdRaw) : null

    return {
      mode,
      source,
      senderTransactionId,
      convoyNumber,
      primaryAssetCode,
      originLocationCode,
      destinationLocationCode,
      senderLocationCode,
      receiverLocationCode,
      operationTypeCode,
      operationTemplateId,
      productName,
      remarks,
      autoEventType,
      leftTicketId,
    }
  }, [location.search])

  useEffect(() => {
    if (prefillApplied) return

    const hasAny =
      prefill.mode ||
      prefill.source ||
      prefill.senderTransactionId ||
      prefill.convoyNumber ||
      prefill.primaryAssetCode ||
      prefill.originLocationCode ||
      prefill.destinationLocationCode ||
      prefill.senderLocationCode ||
      prefill.receiverLocationCode ||
      prefill.operationTypeCode ||
      prefill.operationTemplateId ||
      prefill.productName ||
      prefill.remarks ||
      prefill.autoEventType ||
      prefill.leftTicketId

    if (!hasAny) return

    setEntry((current) => ({
      ...current,
      convoyNumber: prefill.convoyNumber || current.convoyNumber,
      primaryAssetCode: prefill.primaryAssetCode || current.primaryAssetCode,
      originLocationCode:
        prefill.originLocationCode || current.originLocationCode,
      destinationLocationCode:
        prefill.destinationLocationCode || current.destinationLocationCode,
      senderLocationCode:
        prefill.senderLocationCode || current.senderLocationCode,
      receiverLocationCode:
        prefill.receiverLocationCode || current.receiverLocationCode,
      operationTypeCode: prefill.operationTypeCode || current.operationTypeCode,
      operationTemplateId:
        prefill.operationTemplateId || current.operationTemplateId,
      productName: prefill.productName || current.productName,
      remarks: prefill.remarks || current.remarks,
      status: 'Draft',
    }))

    setPrefillApplied(true)
  }, [prefill, prefillApplied])

  useEffect(() => {
    const shouldLoadSenderReference =
      prefill.mode === 'tanker-receiver' &&
      prefill.senderTransactionId

    if (!shouldLoadSenderReference) {
      setTankerSenderReference(null)
      return
    }

    let isCancelled = false

    const loadSenderReference = async () => {
      try {
        setTankerSenderReferenceLoading(true)

        const reference = await getTankerSenderReference(
          prefill.senderTransactionId
        )

        if (!isCancelled) {
          setTankerSenderReference(reference)
        }
      } catch (error) {
        if (!isCancelled) {
          setTankerSenderReference(null)
          setErrorMsg(error.message || 'Unable to load sender tanker reference')
        }
      } finally {
        if (!isCancelled) {
          setTankerSenderReferenceLoading(false)
        }
      }
    }

    loadSenderReference()

    return () => {
      isCancelled = true
    }
  }, [prefill.mode, prefill.senderTransactionId])

  const activeOperationTypes = operationTypes.filter(
    (item) => item.status === 'Active'
  )

  const activeOperationTemplates = operationTemplates.filter(
    (item) => item.status === 'Active'
  )

  const activeAssets = assets.filter((item) => item.status === 'Active')
  const activeLocations = locations.filter((item) => item.status === 'Active')

  const selectedOperationType = activeOperationTypes.find((item) => {
    return item.operationTypeCode === entry.operationTypeCode
  })

  const availableTemplates = useMemo(() => {
    if (!selectedOperationType) {
      return []
    }

    return operationTemplates.filter((template) => {
      return (
        template.operationTypeCode === selectedOperationType.operationTypeCode &&
        template.status === 'Active'
      )
    })
  }, [operationTemplates, selectedOperationType])

  const selectedTemplate = operationTemplates.find((template) => {
    return Number(template.id) === Number(entry.operationTemplateId)
  })

  const selectedTemplateFields = selectedTemplate
    ? [...selectedTemplate.fields]
        .filter((field) => field.status === 'Active')
        .sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder))
    : []

  useEffect(() => {
    const loadLayout = async () => {
      setSelectedTemplateLayout(null)
      if (!selectedTemplate?.id) return
      if (String(selectedTemplate.entryLayoutType || '').trim() !== 'Standard Form') {
        return
      }
      try {
        const layouts = await getOperationTemplateLayouts(selectedTemplate.id)
        if (!Array.isArray(layouts) || layouts.length === 0) return
        const activeLayouts = layouts.filter((l) => l.status === 'Active')
        const defaultActive = activeLayouts.find((l) => l.isDefault === 'Yes')
        const chosen = defaultActive || activeLayouts[0] || layouts[0]
        setSelectedTemplateLayout(chosen || null)
      } catch {
        setSelectedTemplateLayout(null)
      }
    }
    loadLayout()
  }, [selectedTemplate?.id, selectedTemplate?.entryLayoutType])

  const availableAssets = useMemo(() => {
    if (!selectedOperationType) {
      return []
    }

    return activeAssets.filter((asset) => {
      return asset.assetTypeCode === selectedOperationType.applicableAssetTypeCode
    })
  }, [activeAssets, selectedOperationType])

  const selectedAsset = activeAssets.find((asset) => {
    return asset.assetCode === entry.primaryAssetCode
  })

  const editableOperationEntries = operationEntries.filter((item) => {
    return item.status === 'Draft' || item.status === 'Rejected'
  })

  const filteredEditableEntries = useMemo(() => {
    const rows = [...(editableOperationEntries || [])]

    const search = String(editableSearch || '').trim().toLowerCase()
    const status = String(editableStatusFilter || 'ALL')

    const filtered = rows.filter((item) => {
      if (status !== 'ALL' && String(item.status || '') !== status) return false

      if (!search) return true

      const blob = `${item.operationNumber} ${item.operationTypeName} ${item.operationTemplateName} ${item.primaryAssetName} ${item.primaryAssetCode} ${item.originLocationName} ${item.originLocationCode} ${item.operationDate} ${item.productName} ${item.status}`.toLowerCase()

      return blob.includes(search)
    })

    filtered.sort((a, b) => {
      const da = String(a.operationDate || '')
      const db = String(b.operationDate || '')
      if (da !== db) return db.localeCompare(da)
      return Number(b.id || 0) - Number(a.id || 0)
    })

    return filtered
  }, [editableOperationEntries, editableSearch, editableStatusFilter])

  const editableTotalPages = useMemo(() => {
    return Math.max(1, Math.ceil(filteredEditableEntries.length / EDITABLE_PAGE_SIZE))
  }, [filteredEditableEntries.length])

  const pagedEditableEntries = useMemo(() => {
    const start = (editablePage - 1) * EDITABLE_PAGE_SIZE
    return filteredEditableEntries.slice(start, start + EDITABLE_PAGE_SIZE)
  }, [filteredEditableEntries, editablePage])

  useEffect(() => {
    setEditablePage(1)
  }, [editableSearch, editableStatusFilter])

  const initializeValuesFromTemplate = (templateId) => {
    const template = activeOperationTemplates.find((item) => {
      return item.id === Number(templateId)
    })

    if (!template) {
      return []
    }

    return [...template.fields]
      .filter((field) => field.status === 'Active')
      .sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder))
      .map((field) => ({
        fieldCode: field.fieldCode,
        fieldName: field.fieldName,
        fieldGroup: field.fieldGroup,
        dataType: field.dataType,
        unit: field.unit,
        inputMode: field.inputMode,
        calculationRole: field.calculationRole,
        fieldValue: '',
        sortOrder: field.sortOrder,
      }))
  }

  useEffect(() => {
    if (!prefillApplied) {
      return
    }

    if (!prefill.operationTemplateId) {
      return
    }

    if (entry.values && entry.values.length > 0) {
      return
    }

    setEntry((current) => ({
      ...current,
      values: initializeValuesFromTemplate(prefill.operationTemplateId),
    }))
  }, [prefillApplied, prefill.operationTemplateId])

  const handleChange = (e) => {
    const { name, value } = e.target

    if (name === 'operationTypeCode') {
      const preserveAsset = prefillApplied && prefill.primaryAssetCode

      setEntry({
        ...entry,
        operationTypeCode: value,
        operationTemplateId: '',
        primaryAssetCode: preserveAsset ? entry.primaryAssetCode : '',
        originLocationCode: preserveAsset ? entry.originLocationCode : '',
        destinationLocationCode: '',
        senderLocationCode: '',
        receiverLocationCode: '',
        values: [],
        convoyNumber: entry.convoyNumber, // keep convoy
      })
      return
    }

    if (name === 'operationTemplateId') {
      setEntry({
        ...entry,
        operationTemplateId: value,
        values: initializeValuesFromTemplate(value),
      })
      return
    }

    setEntry({
      ...entry,
      [name]: value,
    })
  }

  const handleAssetChange = (e) => {
    const assetCode = e.target.value
    const asset = activeAssets.find((item) => item.assetCode === assetCode)

    if (!asset) {
      setEntry({
        ...entry,
        primaryAssetCode: '',
        originLocationCode: '',
      })
      return
    }

    setEntry({
      ...entry,
      primaryAssetCode: asset.assetCode,
      originLocationCode:
        asset.assetScope === 'Local'
          ? asset.locationCode
          : entry.originLocationCode,
    })
  }

  const handleValueChange = (fieldCode, value) => {
    setEntry((currentEntry) => ({
      ...currentEntry,
      values: currentEntry.values.map((item) => {
        if (item.fieldCode === fieldCode) {
          return {
            ...item,
            fieldValue: value,
          }
        }

        return item
      }),
    }))
  }

  const getInputType = (dataType) => {
    if (dataType === 'Number') {
      return 'number'
    }

    if (dataType === 'Date') {
      return 'date'
    }

    if (dataType === 'DateTime') {
      return 'datetime-local'
    }

    return 'text'
  }

  const parseFieldObject = (raw) => {
    if (raw === null || raw === undefined) return null
    if (typeof raw === 'object') return raw
    const s = String(raw || '').trim()
    if (!s) return null
    try {
      return JSON.parse(s)
    } catch {
      return null
    }
  }

  const isBlank = (v) => String(v ?? '').trim() === ''

  const validateTankGaugingMandatory = (tankPayload) => {
    const inputs = tankPayload?.inputs || {}

    const missing = []
    if (isBlank(inputs.gaugingDate)) missing.push('Gauging Date')
    if (isBlank(inputs.gaugingTime)) missing.push('Gauging Time')
    if (isBlank(inputs.dipCm)) missing.push('Dip (cm)')
    if (isBlank(inputs.waterLevelCm)) missing.push('Water Level (cm)')
    if (isBlank(inputs.tankTemperature)) missing.push('Tank Temperature')
    if (isBlank(inputs.sampleTemperature)) missing.push('Sample Temperature')
    if (isBlank(inputs.bswPercent)) missing.push('BS&W %')

    const mode = String(inputs.observedInputType || '').toLowerCase()
    if (mode.includes('api')) {
      if (isBlank(inputs.observedApi)) missing.push('Observed API')
    } else {
      if (isBlank(inputs.observedDensity)) missing.push('Observed Density')
    }

    return missing
  }

  const validateMultiTankMandatory = (multiTankPayload) => {
    const meta = multiTankPayload?.meta || {}
    const inputs = multiTankPayload?.inputs || {}
    const tankIds = Array.isArray(meta.tankIds) ? meta.tankIds : []

    const stageMissing = (stageName, stage) => {
      const miss = []

      // Sample parameters mandatory
      if (isBlank(stage?.tankTemp)) miss.push(`${stageName}: Tank Temp`)
      if (isBlank(stage?.sampleTemp)) miss.push(`${stageName}: Sample Temp`)
      if (isBlank(stage?.bswPct)) miss.push(`${stageName}: BS&W %`)

      const mode = String(stage?.obsMode || '').toLowerCase()
      if (mode.includes('api')) {
        if (isBlank(stage?.obsApi)) miss.push(`${stageName}: Observed API`)
      } else {
        if (isBlank(stage?.obsDensity)) miss.push(`${stageName}: Observed Density`)
      }

      // Dips mandatory
      for (const tid of tankIds) {
        const d = (stage?.dips || {})[tid] || {}
        if (isBlank(d.total)) miss.push(`${stageName}: ${tid} Total Dip`)
        if (isBlank(d.water)) miss.push(`${stageName}: ${tid} Water Dip`)
      }

      return miss
    }

    const missing = []
    missing.push(...stageMissing('Before', inputs.before || {}))
    missing.push(...stageMissing('After', inputs.after || {}))

    return missing
  }

  const validateTankerMandatory = (tankerPayload) => {
    const inputs = tankerPayload?.inputs || {}

    const missing = []

    if (isBlank(inputs.tankerTransactionDate)) missing.push('Tanker Date')
    if (isBlank(inputs.tankerTransactionTime)) missing.push('Tanker Time')
    if (isBlank(inputs.convoyNumber)) missing.push('Convoy Number')
    if (isBlank(inputs.compartment)) missing.push('Compartment / Manhole')
    if (isBlank(inputs.totalDipCm)) missing.push('Total Dip (cm)')
    if (isBlank(inputs.waterDipCm)) missing.push('Water Dip (cm)')
    if (isBlank(inputs.bswPercent)) missing.push('BS&W %')
    if (isBlank(inputs.tankTemperature)) missing.push('Tank Temperature')
    if (isBlank(inputs.sampleTemperature)) missing.push('Sample Temperature')

    const mode = String(inputs.observedInputType || '').toLowerCase()

    if (mode.includes('api')) {
      if (isBlank(inputs.observedApi)) missing.push('Observed API')
    } else {
      if (isBlank(inputs.observedDensity)) missing.push('Observed Density')
    }

    return missing
  }

    const validateAssetSpecificMandatory = (entryValues) => {
      const tankPayloadRaw = entryValues.find((v) => v.fieldCode === 'tank_gauging_payload')?.fieldValue
      const multiTankPayloadRaw = entryValues.find((v) => v.fieldCode === 'multi_tank_payload')?.fieldValue
      const tankerPayloadRaw = entryValues.find((v) => v.fieldCode === 'tanker_payload')?.fieldValue

      const tankPayload = parseFieldObject(tankPayloadRaw)
      const multiTankPayload = parseFieldObject(multiTankPayloadRaw)
      const tankerPayload = parseFieldObject(tankerPayloadRaw)

    if (tankPayload) {
      const missing = validateTankGaugingMandatory(tankPayload)
      if (missing.length > 0) {
        return `Tank Gauging mandatory sections missing: ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? ' ...' : ''}`
      }
    }

    if (multiTankPayload) {
      const missing = validateMultiTankMandatory(multiTankPayload)
      if (missing.length > 0) {
        return `Multi-Tank mandatory sections missing: ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? ' ...' : ''}`
      }
    }

    if (tankerPayload) {
      const missing = validateTankerMandatory(tankerPayload)
      if (missing.length > 0) {
        return `Tanker mandatory sections missing: ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? ' ...' : ''}`
      }
    }

    return null
  }

  const handleSubmit = async (e) => {
    e.preventDefault()

    if (!canCreateOperationEntry) {
      setErrorMsg('You do not have permission to create operation entries')
      return
    }

    if (entry.operationTypeCode.trim() === '') {
      setErrorMsg('Operation Type is required')
      return
    }

    if (String(entry.operationTemplateId).trim() === '') {
      setErrorMsg('Operation Template is required')
      return
    }

    if (entry.primaryAssetCode.trim() === '') {
      setErrorMsg('Primary Asset is required')
      return
    }
    const selectedLayoutType = String(selectedTemplate?.entryLayoutType || '')
      .toLowerCase()

    const isMultiTank = selectedLayoutType.includes('multi-tank')
    const isTanker = selectedLayoutType.includes('tanker')
    const isShuttleTracking = selectedLayoutType.includes('shuttle tracking')

    if ((isMultiTank || isTanker) && entry.convoyNumber.trim() === '') {
      setErrorMsg('Convoy Number is required for Multi-Tank / Tanker operations')
      return
    }

    if (isShuttleTracking && entry.convoyNumber.trim() === '') {
      setErrorMsg('Shuttle Number is required for Shuttle Tracking')
      return
    }
    if (entry.originLocationCode.trim() === '') {
      setErrorMsg('Origin Location is required')
      return
    }

    if (entry.operationDate.trim() === '') {
      setErrorMsg('Operation Date is required')
      return
    }

    if (
      selectedOperationType?.requiresSenderLocation === 'Yes' &&
      entry.senderLocationCode.trim() === ''
    ) {
      setErrorMsg('Sender Location is required for this operation type')
      return
    }

    if (
      selectedOperationType?.requiresReceiverLocation === 'Yes' &&
      entry.receiverLocationCode.trim() === ''
    ) {
      setErrorMsg('Receiver Location is required for this operation type')
      return
    }

    for (const value of entry.values) {
      const templateField = selectedTemplateFields.find((field) => {
        return field.fieldCode === value.fieldCode
      })

      if (
        templateField?.isRequired === 'Yes' &&
        templateField?.inputMode === 'Manual' &&
        String(value.fieldValue ?? '').trim() === ''
      ) {
        setErrorMsg(`${value.fieldName} is required`)
        return
      }
    }

    const layoutType = String(selectedTemplate?.entryLayoutType || '').trim()

    if (layoutType === 'Tank Gauging') {
      const hasTankPayload = (entry.values || []).some((v) => v.fieldCode === 'tank_gauging_payload')
      if (!hasTankPayload) {
        setErrorMsg('Template setup required: Add System field "tank_gauging_payload" in Operation Template.')
        return
      }
    }

    if (layoutType === 'Multi-Tank Before/After') {
      const hasMultiTankPayload = (entry.values || []).some((v) => v.fieldCode === 'multi_tank_payload')
      if (!hasMultiTankPayload) {
        setErrorMsg('Template setup required: Add System field "multi_tank_payload" in Operation Template.')
        return
      }
    }

    if (layoutType === 'Tanker Loading') {
      const hasTankerPayload = (entry.values || []).some((v) => v.fieldCode === 'tanker_payload')
      if (!hasTankerPayload) {
        setErrorMsg('Template setup required: Add System field "tanker_payload" in Operation Template.')
        return
      }
    }

    if (layoutType === 'Meter Reading') {
      const hasFlowmeterPayload = (entry.values || []).some((v) => v.fieldCode === 'flowmeter_payload')
      if (!hasFlowmeterPayload) {
        setErrorMsg('Template setup required: Add System field "flowmeter_payload" in Operation Template.')
        return
      }

      const flowmeterPayloadRow = (entry.values || []).find((v) => v.fieldCode === 'flowmeter_payload')
      const payload =
        typeof flowmeterPayloadRow?.fieldValue === 'object'
          ? flowmeterPayloadRow.fieldValue
          : (() => {
              try {
                return JSON.parse(String(flowmeterPayloadRow?.fieldValue || '{}'))
              } catch {
                return null
              }
            })()

      const inputs = payload?.inputs || {}
      const meters = Array.isArray(inputs.meters) ? inputs.meters : []
      const tankTemp = Number(inputs.tank_temperature ?? NaN)
      const sampleTemp = Number(inputs.sample_temperature ?? NaN)
      const bsw = Number(inputs.bsw_percent ?? NaN)
      const observedType = String(inputs.observed_input_type || '')
      const observedApi = Number(inputs.observed_api ?? NaN)
      const observedDensity = Number(inputs.observed_density ?? NaN)

      if (!inputs.reading_date) {
        setErrorMsg('Flowmeter Date is required.')
        return
      }
      if (meters.length > 0) {
        if (!inputs.stream_name) {
          setErrorMsg('Flowmeter Stream is required.')
          return
        }
        for (const meter of meters) {
          const opening = Number(meter.opening_reading ?? NaN)
          const closing = Number(meter.closing_reading ?? NaN)
          const label = String(meter.meter_label || 'Meter')
          if (!Number.isFinite(opening) || opening < 0) {
            setErrorMsg(`${label}: Opening Reading cannot be negative.`)
            return
          }
          if (!Number.isFinite(closing) || closing < 0) {
            setErrorMsg(`${label}: Closing Reading cannot be negative.`)
            return
          }
          if (closing < opening) {
            setErrorMsg(`${label}: Closing Reading cannot be less than Opening Reading.`)
            return
          }
        }
      } else if (!inputs.meter_label) {
        setErrorMsg('Flowmeter Meter Label is required.')
        return
      }
      if (!Number.isFinite(tankTemp)) {
        setErrorMsg('Tank Temperature is required.')
        return
      }
      if (!Number.isFinite(sampleTemp)) {
        setErrorMsg('Sample Temperature is required.')
        return
      }
      if (!Number.isFinite(bsw) || bsw < 0 || bsw > 100) {
        setErrorMsg('BS & W must be between 0 and 100.')
        return
      }
      if (observedType === 'Observed API') {
        if (!Number.isFinite(observedApi)) {
          setErrorMsg('Observed API is required.')
          return
        }
      } else if (observedType === 'Observed Density') {
        if (!Number.isFinite(observedDensity)) {
          setErrorMsg('Observed Density is required.')
          return
        }
      } else {
        setErrorMsg('Observed Input Type is required.')
        return
      }
    }

    if (layoutType === 'Shuttle Tracking') {
      const hasShuttlePayload = (entry.values || []).some((v) => v.fieldCode === 'shuttle_payload')
      if (!hasShuttlePayload) {
        setErrorMsg('Template setup required: Add System field "shuttle_payload" in Operation Template.')
        return
      }
    }

    const mandatoryError = validateAssetSpecificMandatory(entry.values || [])
    if (mandatoryError) {
      setErrorMsg(mandatoryError)
      return
    }

    const actionLabel = editId === null ? 'save' : 'update'
    setConfirmAction({
      type: 'submit',
      actionLabel,
      message: `Confirm to ${actionLabel} this Draft ticket?\n\nOperation Type: ${entry.operationTypeCode}\nTemplate ID: ${entry.operationTemplateId}\nAsset: ${entry.primaryAssetCode}\nDate: ${entry.operationDate}`,
    })
  }

  const confirmSubmitAction = async () => {
    setConfirmAction(null)
    try {
      setLoading(true)

      let saved = null

      if (editId === null) {
        saved = await createOperationEntry({ ...entry, status: 'Draft' })
        setSuccessMsg('Operation Entry saved successfully')
      } else {
        saved = await updateOperationEntry(editId, {
          ...entry,
          status: entry.status || 'Draft',
        })
        setSuccessMsg('Operation Entry updated successfully')
      }

      await reloadOperationEntries()
      if (typeof reloadOperationTransactions === 'function') {
        await reloadOperationTransactions()
      }

      // ✅ Auto navigation back to Barge Tracking only (events/comparisons are created on APPROVAL in backend)
      if (saved && prefill.autoEventType) {
        const convoy = String(entry.convoyNumber || '').trim()
        if (!convoy) {
          setErrorMsg(`Auto navigation skipped: Convoy Number is required for ${prefill.autoEventType}`)
          setLoading(false)
          return
        }

        navigate(`/barge-tracking?convoy_number=${encodeURIComponent(convoy)}`)
        return
      }

      setEntry(emptyEntry)
      setEditId(null)
    } catch (error) {
      setErrorMsg(error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleEdit = (entryToEdit) => {
    if (!canCreateOperationEntry) {
      setErrorMsg('You do not have permission to create operation entries')
      return
    }
    if (entryToEdit.status !== 'Draft' && entryToEdit.status !== 'Rejected') {
      setErrorMsg('Only Draft or Rejected operation entries can be edited.')
      return
    }
    setConfirmAction({ type: 'edit', data: entryToEdit, message: 'Open this ticket for editing?\n\nAny current form changes will be replaced.' })
  }

  const confirmEditAction = () => {
    if (!confirmAction?.data) return
    const entryToEdit = confirmAction.data
    setConfirmAction(null)

    setEntry({
      operationTypeCode: entryToEdit.operationTypeCode,
      operationTemplateId: String(entryToEdit.operationTemplateId),
      primaryAssetCode: entryToEdit.primaryAssetCode,
      convoyNumber: entryToEdit.convoyNumber || '',
      originLocationCode: entryToEdit.originLocationCode,
      destinationLocationCode: entryToEdit.destinationLocationCode || '',
      senderLocationCode: entryToEdit.senderLocationCode || '',
      receiverLocationCode: entryToEdit.receiverLocationCode || '',
      operationDate: entryToEdit.operationDate || '',
      operationStartDatetime:
        entryToEdit.operationStartDatetime?.slice(0, 16) || '',
      operationEndDatetime: entryToEdit.operationEndDatetime?.slice(0, 16) || '',
      productName: entryToEdit.productName || '',
      createdBy: entryToEdit.createdBy || '',
      remarks: entryToEdit.remarks || '',
      status: entryToEdit.status || 'Draft',
      values: entryToEdit.values.map((value) => ({
        fieldCode: value.fieldCode,
        fieldName: value.fieldName,
        fieldGroup: value.fieldGroup,
        dataType: value.dataType,
        unit: value.unit,
        inputMode: value.inputMode,
        calculationRole: value.calculationRole,
        fieldValue: value.fieldValue ?? '',
        sortOrder: value.sortOrder,
      })),
    })

    setEditId(entryToEdit.id)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleCloseEdit = () => {
    setConfirmAction({ type: 'closeEdit', message: 'Close editing window?\n\nAny unsaved changes will be lost.' })
  }

  const confirmCloseEditAction = () => {
    setConfirmAction(null)
    setEntry(emptyEntry)
    setEditId(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleDelete = async (entryId) => {
    setConfirmAction({ type: 'delete', data: entryId, message: 'Are you sure you want to cancel this Draft/Rejected operation entry? This will preserve the audit history.' })
  }

  const confirmDeleteAction = async () => {
    const entryId = confirmAction?.data
    setConfirmAction(null)
    if (!canCancelOperationTransaction) {
      setErrorMsg('You do not have permission to cancel operation transactions')
      return
    }
    if (!entryId) return

    try {
      setLoading(true)

      await deleteOperationEntry(entryId)
      await reloadOperationEntries()

      if (typeof reloadOperationTransactions === 'function') {
        await reloadOperationTransactions()
      }

      if (editId === entryId) {
        setEntry(emptyEntry)
        setEditId(null)
      }

      setSuccessMsg('Operation Entry cancelled successfully')
    } catch (error) {
      setErrorMsg(error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleCancelEdit = () => {
    setConfirmAction({ type: 'cancelEdit', message: 'Cancel editing and clear the current form?' })
  }

  const confirmCancelEditAction = () => {
    setConfirmAction(null)
    setEntry(emptyEntry)
    setEditId(null)
  }
  const showConvoyNumber = useMemo(() => {
    const layout = String(selectedTemplate?.entryLayoutType || '').toLowerCase()

    return (
      layout.includes('multi-tank') ||
      layout.includes('tanker') ||
      layout.includes('shuttle tracking')
    )
  }, [selectedTemplate])

  const convoyLabel = (() => {
    const layout = String(selectedTemplate?.entryLayoutType || '').toLowerCase()
    if (layout.includes('shuttle tracking')) return 'Shuttle Number'
    return 'Convoy Number'
  })()

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
      {confirmAction && (
        <div className="confirm-overlay">
          <div className="confirm-dialog">
            <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{confirmAction.message}</pre>
            <div className="confirm-actions">
              <button onClick={
                confirmAction.type === 'submit' ? confirmSubmitAction :
                confirmAction.type === 'edit' ? confirmEditAction :
                confirmAction.type === 'closeEdit' ? confirmCloseEditAction :
                confirmAction.type === 'delete' ? confirmDeleteAction :
                confirmCancelEditAction
              }>Yes</button>
              <button onClick={() => setConfirmAction(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
      <div className="page-title">
        <div>
          <h2>Operation Entry</h2>
          <p>
            Create new operation tickets or edit Draft/Rejected tickets using
            asset-specific entry layouts.
          </p>
        </div>

        <span className="record-count">
          {filteredEditableEntries.length} Editable Entries
        </span>
      </div>

      {!canCreateOperationEntry && (
        <div className="info-box">
          You have view-only access. Assign <strong>Create Operation Entry</strong> to create or edit tickets, and <strong>Cancel Operation Transaction</strong> to cancel them.
        </div>
      )}

      <form onSubmit={handleSubmit}>
        {prefill.mode === 'tanker-receiver' && (
          <div className="info-box full-width-field">
            <strong>Receiver Tanker Entry</strong>
            <div>
              This entry was created from Tanker Tracking against sender
              transaction ID: {prefill.senderTransactionId || '-'}.
            </div>
            <div>
              Convoy, product, asset and receiver location were prefilled from
              the sender tracking record. Enter the receiver dips, sample
              parameters and seals, then save as a new receiver ticket.
            </div>
          </div>
        )}
        <div>
          <label>Operation Type</label>
          <select
            name="operationTypeCode"
            value={entry.operationTypeCode}
            onChange={handleChange}
            disabled={!canCreateOperationEntry}
          >
            <option value="">Select Operation Type</option>

            {activeOperationTypes.map((operationType) => (
              <option
                key={operationType.id}
                value={operationType.operationTypeCode}
              >
                {operationType.operationTypeName} (
                {operationType.operationTypeCode})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label>Operation Template</label>
          <select
            name="operationTemplateId"
            value={entry.operationTemplateId}
            onChange={handleChange}
            disabled={!selectedOperationType || !canCreateOperationEntry}
          >
            <option value="">
              {selectedOperationType
                ? 'Select Operation Template'
                : 'Select Operation Type First'}
            </option>

            {availableTemplates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.templateName} -{' '}
                {template.entryLayoutType || 'Standard Form'}
              </option>
            ))}
          </select>
        </div>

        <LayoutSummaryPanel selectedTemplate={selectedTemplate} />
        
        <div>
          <label>Primary Asset</label>
          <select
            name="primaryAssetCode"
            value={entry.primaryAssetCode}
            onChange={handleAssetChange}
            disabled={!selectedOperationType || !canCreateOperationEntry}
          >
            <option value="">
              {selectedOperationType ? 'Select Asset' : 'Select Operation First'}
            </option>

            {availableAssets.map((asset) => (
              <option key={asset.id} value={asset.assetCode}>
                {asset.assetName} ({asset.assetCode}) - {asset.assetTypeCode}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label>Asset Type</label>
          <input
            type="text"
            value={selectedAsset ? selectedAsset.assetTypeCode : ''}
            disabled
            placeholder="Auto-filled"
          />
        </div>
        {showConvoyNumber && (
          <div>
            <label>{convoyLabel} *</label>
            <input
              name="convoyNumber"
              type="text"
              value={entry.convoyNumber}
              onChange={handleChange}
              placeholder="Example: CNV-2026-001"
              disabled={!canCreateOperationEntry}
            />
          </div>
        )}
        <div>
          <label>Origin Location</label>
          <select
            name="originLocationCode"
            value={entry.originLocationCode}
            onChange={handleChange}
            disabled={selectedAsset?.assetScope === 'Local' || !canCreateOperationEntry}
          >
            <option value="">Select Origin Location</option>

            {activeLocations.map((location) => (
              <option key={location.id} value={location.locationCode}>
                {location.locationName} ({location.locationCode})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label>Destination Location</label>
          <select
            name="destinationLocationCode"
            value={entry.destinationLocationCode}
            onChange={handleChange}
            disabled={!canCreateOperationEntry}
          >
            <option value="">None</option>

            {activeLocations.map((location) => (
              <option key={location.id} value={location.locationCode}>
                {location.locationName} ({location.locationCode})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label>
            Sender Location{' '}
            {selectedOperationType?.requiresSenderLocation === 'Yes' ? '*' : ''}
          </label>
          <select
            name="senderLocationCode"
            value={entry.senderLocationCode}
            onChange={handleChange}
            disabled={!canCreateOperationEntry}
          >
            <option value="">None</option>

            {activeLocations.map((location) => (
              <option key={location.id} value={location.locationCode}>
                {location.locationName} ({location.locationCode})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label>
            Receiver Location{' '}
            {selectedOperationType?.requiresReceiverLocation === 'Yes'
              ? '*'
              : ''}
          </label>
          <select
            name="receiverLocationCode"
            value={entry.receiverLocationCode}
            onChange={handleChange}
            disabled={!canCreateOperationEntry}
          >
            <option value="">None</option>

            {activeLocations.map((location) => (
              <option key={location.id} value={location.locationCode}>
                {location.locationName} ({location.locationCode})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label>Operation Date</label>
          <input
            name="operationDate"
            type="date"
            value={entry.operationDate}
            onChange={handleChange}
            disabled={!canCreateOperationEntry}
          />
        </div>

        <div>
          <label>Start Date/Time</label>
          <input
            name="operationStartDatetime"
            type="datetime-local"
            value={entry.operationStartDatetime}
            onChange={handleChange}
            disabled={!canCreateOperationEntry}
          />
        </div>

        <div>
          <label>End Date/Time</label>
          <input
            name="operationEndDatetime"
            type="datetime-local"
            value={entry.operationEndDatetime}
            onChange={handleChange}
            disabled={!canCreateOperationEntry}
          />
        </div>

        <div>
          <label>Product</label>
          <input
            name="productName"
            type="text"
            value={entry.productName}
            onChange={handleChange}
            placeholder="Example: Crude Oil"
            disabled={!canCreateOperationEntry}
          />
        </div>

        <div>
          <label>Created By</label>
          <input
            name="createdBy"
            type="text"
            value={entry.createdBy}
            onChange={handleChange}
            placeholder="Auto-filled by backend if blank"
            disabled={!canCreateOperationEntry}
          />
        </div>

        <div>
          <label>Status</label>
          <input type="text" value={entry.status} disabled />
          <small>
            Status changes are controlled from Operation Transaction Detail.
          </small>
        </div>

        <div className="full-width-field">
          <label>Remarks</label>
          <textarea
            name="remarks"
            value={entry.remarks}
            onChange={handleChange}
            placeholder="Enter operation remarks"
            rows="3"
            disabled={!canCreateOperationEntry}
          />
        </div>

        <OperationLayoutRenderer
          entry={entry}
          editId={editId}
          selectedTemplate={selectedTemplate}
          selectedTemplateFields={selectedTemplateFields}
          selectedAsset={selectedAsset}
          assets={assets}
          locations={locations}
          assetCalibrationTables={assetCalibrationTables}
          calibrationTemplates={calibrationTemplates}
          handleValueChange={handleValueChange}
          getInputType={getInputType}
          senderReference={tankerSenderReference}
          senderReferenceLoading={tankerSenderReferenceLoading}
          receiverMode={prefill.mode === 'tanker-receiver'}
          setEntryField={setEntryField}
          templateLayout={selectedTemplateLayout}
        />

        <div className="form-actions">
          <button type="submit" disabled={loading || !canCreateOperationEntry}>
            {loading ? 'Saving...' : editId === null ? 'Save Draft' : 'Update Draft'}
          </button>

          {editId !== null && (
            <button type="button" onClick={handleCloseEdit} disabled={loading}>
              Close Edit
            </button>
          )}
        </div>
      </form>

      <div className="section-title">
        <h3>Editable Operation Entries</h3>
        <p>
          Only Draft and Rejected tickets are listed here. Submitted tickets must
          be recalled to Draft before editing. Approved and Cancelled tickets are
          locked.
        </p>
      </div>

      <div className="info-box">
        <div
          style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}
        >
          <div style={{ minWidth: 200 }}>
            <label style={{ display: 'block', fontSize: 12, opacity: 0.8 }}>
              Status
            </label>
            <select
              value={editableStatusFilter}
              onChange={(e) => setEditableStatusFilter(e.target.value)}
            >
              <option value="ALL">All</option>
              <option value="Draft">Draft</option>
              <option value="Rejected">Rejected</option>
            </select>
          </div>

          <div style={{ flex: 1, minWidth: 280 }}>
            <label style={{ display: 'block', fontSize: 12, opacity: 0.8 }}>
              Search
            </label>
            <input
              value={editableSearch}
              onChange={(e) => setEditableSearch(e.target.value)}
              placeholder="Search ticket / asset / origin / template / product..."
            />
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'end' }}>
            <button
              type="button"
              disabled={editablePage <= 1}
              onClick={() => setEditablePage((p) => Math.max(1, p - 1))}
            >
              Prev
            </button>

            <span style={{ alignSelf: 'center' }}>
              Page {editablePage} / {editableTotalPages}
            </span>

            <button
              type="button"
              disabled={editablePage >= editableTotalPages}
              onClick={() =>
                setEditablePage((p) => Math.min(editableTotalPages, p + 1))
              }
            >
              Next
            </button>
          </div>
        </div>

        <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}>
          Showing {pagedEditableEntries.length} of {filteredEditableEntries.length}{' '}
          editable entries
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th>Ticket No.</th>
            <th>Operation Type</th>
            <th>Template</th>
            <th>Asset</th>
            <th>Origin</th>
            <th>Date</th>
            <th>Product</th>
            <th>Status</th>
            <th>Fields</th>
            <th>Actions</th>
          </tr>
        </thead>

        <tbody>
          {pagedEditableEntries.length === 0 ? (
            <tr>
              <td colSpan="10" className="empty-table">
                No Draft or Rejected operation entries available for editing.
              </td>
            </tr>
          ) : (
            pagedEditableEntries.map((item) => (
              <tr key={item.id}>
                <td>{item.operationNumber}</td>
                <td>{item.operationTypeName}</td>
                <td>{item.operationTemplateName}</td>
                <td>
                  {item.primaryAssetName} ({item.primaryAssetCode})
                </td>
                <td>
                  {item.originLocationName} ({item.originLocationCode})
                </td>
                <td>{item.operationDate}</td>
                <td>{item.productName}</td>
                <td>
                  <span
                    className={`status-badge ${item.status
                      .toLowerCase()
                      .replaceAll(' ', '-')}`}
                  >
                    {item.status}
                  </span>
                </td>
                <td>{item.values.length}</td>
                <td>
                  <button type="button" onClick={() => handleEdit(item)} disabled={!canCreateOperationEntry}>
                    Edit
                  </button>

                  <button type="button" onClick={() => handleDelete(item.id)} disabled={!canCancelOperationTransaction}>
                    Cancel
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <div className="info-box">
        Operation Entry is for creating new tickets and editing Draft/Rejected
        tickets. The official full ticket list remains Operation Transaction
        Register.
      </div>
    </div>
  )
}

export default OperationEntry
