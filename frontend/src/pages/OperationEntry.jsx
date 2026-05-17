import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { apiPost } from '../api/apiClient'
import { createTripEvent, createTripComparison } from '../api/convoyTrackerApi'
import {
  createOperationEntry,
  deleteOperationEntry,
  updateOperationEntry,
} from '../api/operationEntryApi'
import TankGaugingLayout from '../components/operationLayouts/TankGaugingLayout'
import MultiTankBeforeAfterLayout from '../components/operationLayouts/MultiTankBeforeAfterLayout'

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

function OperationLayoutRenderer({
  entry,
  editId,
  selectedTemplate,
  selectedTemplateFields,
  selectedAsset,
  assetCalibrationTables,
  calibrationTemplates,
  handleValueChange,
  getInputType,
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
        <LayoutPlaceholder
          title="Stock Movement Layout"
          description="Designed for FSO, storage, or stock movement operations using opening and closing stock values."
          sections={[
            {
              title: 'Movement Details',
              items: [
                'Reference / shuttle number',
                'Counterparty asset',
                'Reference quantity',
                'Product / cargo',
              ],
            },
            {
              title: 'Stock Details',
              items: [
                'Opening stock',
                'Opening water',
                'Closing stock',
                'Closing water',
              ],
            },
            {
              title: 'Live Results',
              items: ['Net stock', 'Net water', 'Variance', 'Warning status'],
            },
          ]}
        />

        <OperationTemplateFields
          entry={entry}
          selectedTemplate={selectedTemplate}
          selectedTemplateFields={selectedTemplateFields}
          handleValueChange={handleValueChange}
          getInputType={getInputType}
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
          excludedFieldCodes={['multi_tank_payload']}
        />
      </>
    )
  }

  if (layoutType === 'Vessel Cycle') {
    return (
      <>
        <LayoutPlaceholder
          title="Vessel Cycle Layout"
          description="Designed for vessel loading, sailing, STS, unloading and cycle completion workflow."
          sections={[
            {
              title: 'Cycle Header',
              items: [
                'Vessel asset',
                'Shuttle number',
                'Cycle status',
                'Current stage',
              ],
            },
            {
              title: 'Stages',
              items: ['Loading', 'STS optional', 'Unloading', 'Completed'],
            },
            {
              title: 'Cycle Results',
              items: [
                'Loaded quantity',
                'STS quantity',
                'Discharged quantity',
                'Final balance',
              ],
            },
          ]}
        />

        <OperationTemplateFields
          entry={entry}
          selectedTemplate={selectedTemplate}
          selectedTemplateFields={selectedTemplateFields}
          handleValueChange={handleValueChange}
          getInputType={getInputType}
        />
      </>
    )
  }

  if (layoutType === 'Tanker Loading') {
    return (
      <>
        <LayoutPlaceholder
          title="Tanker Loading Layout"
          description="Designed for road tanker loading or receipt with compartment dip, quality, volume and seal details."
          sections={[
            {
              title: 'Tanker Details',
              items: [
                'Tanker asset',
                'Prime mover',
                'Convoy number',
                'Destination',
              ],
            },
            {
              title: 'Dip & Quality',
              items: [
                'Compartment',
                'Total dip',
                'Water dip',
                'API/density',
                'Temperature',
              ],
            },
            {
              title: 'Seal & Results',
              items: ['Seal numbers', 'GOV', 'GSV', 'NSV', 'MT', 'LT'],
            },
          ]}
        />

        <OperationTemplateFields
          entry={entry}
          selectedTemplate={selectedTemplate}
          selectedTemplateFields={selectedTemplateFields}
          handleValueChange={handleValueChange}
          getInputType={getInputType}
        />
      </>
    )
  }

  if (layoutType === 'Meter Reading') {
    return (
      <>
        <LayoutPlaceholder
          title="Meter Reading Layout"
          description="Designed for flowmeter or metering skid entries using opening/closing meter readings and meter factor."
          sections={[
            {
              title: 'Meter Details',
              items: ['Metering asset', 'Meter stream', 'Unit', 'Meter factor'],
            },
            {
              title: 'Readings',
              items: [
                'Opening reading',
                'Closing reading',
                'Corrected net',
                'Converted net',
              ],
            },
            {
              title: 'Totalization',
              items: ['Stream totals', 'Total net volume', 'Warning checks'],
            },
          ]}
        />

        <OperationTemplateFields
          entry={entry}
          selectedTemplate={selectedTemplate}
          selectedTemplateFields={selectedTemplateFields}
          handleValueChange={handleValueChange}
          getInputType={getInputType}
        />
      </>
    )
  }

  return (
    <OperationTemplateFields
      entry={entry}
      selectedTemplate={selectedTemplate}
      selectedTemplateFields={selectedTemplateFields}
      handleValueChange={handleValueChange}
      getInputType={getInputType}
    />
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
}) {
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
  const [editId, setEditId] = useState(null)
  const [loading, setLoading] = useState(false)

  const location = useLocation()
  const navigate = useNavigate()
  const [prefillApplied, setPrefillApplied] = useState(false)

  const prefill = useMemo(() => {
    const params = new URLSearchParams(location.search)

    const convoyNumber = String(params.get('convoy_number') || '').trim()
    const primaryAssetCode = String(params.get('primary_asset_code') || '').trim()
    const originLocationCode = String(params.get('origin_location_code') || '').trim()
    const operationTypeCode = String(params.get('operation_type_code') || '').trim()

    const autoEventType = String(params.get('auto_event_type') || '').trim()
    const leftTicketIdRaw = String(params.get('left_ticket_id') || '').trim()
    const leftTicketId = leftTicketIdRaw ? Number(leftTicketIdRaw) : null

    return {
      convoyNumber,
      primaryAssetCode,
      originLocationCode,
      operationTypeCode,
      autoEventType,
      leftTicketId,
    }
  }, [location.search])

  useEffect(() => {
    if (prefillApplied) return

    const hasAny =
      prefill.convoyNumber ||
      prefill.primaryAssetCode ||
      prefill.originLocationCode ||
      prefill.operationTypeCode ||
      prefill.autoEventType ||
      prefill.leftTicketId

    if (!hasAny) return

    setEntry((current) => ({
      ...current,
      convoyNumber: prefill.convoyNumber || current.convoyNumber,
      primaryAssetCode: prefill.primaryAssetCode || current.primaryAssetCode,
      originLocationCode: prefill.originLocationCode || current.originLocationCode,
      operationTypeCode: prefill.operationTypeCode || current.operationTypeCode,
    }))

    setPrefillApplied(true)
  }, [prefill, prefillApplied])

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

  const validateAssetSpecificMandatory = (entryValues) => {
    const tankPayloadRaw = entryValues.find((v) => v.fieldCode === 'tank_gauging_payload')?.fieldValue
    const multiTankPayloadRaw = entryValues.find((v) => v.fieldCode === 'multi_tank_payload')?.fieldValue

    const tankPayload = parseFieldObject(tankPayloadRaw)
    const multiTankPayload = parseFieldObject(multiTankPayloadRaw)

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

    return null
  }

  const handleSubmit = async (e) => {
    e.preventDefault()

    if (entry.operationTypeCode.trim() === '') {
      alert('Operation Type is required')
      return
    }

    if (String(entry.operationTemplateId).trim() === '') {
      alert('Operation Template is required')
      return
    }

    if (entry.primaryAssetCode.trim() === '') {
      alert('Primary Asset is required')
      return
    }
    const needsConvoyNumber = String(selectedTemplate?.entryLayoutType || '')
      .toLowerCase()
      .includes('multi-tank')

    if (needsConvoyNumber && entry.convoyNumber.trim() === '') {
      alert('Convoy Number is required for Multi-Tank operations')
      return
    }
    if (entry.originLocationCode.trim() === '') {
      alert('Origin Location is required')
      return
    }

    if (entry.operationDate.trim() === '') {
      alert('Operation Date is required')
      return
    }

    if (
      selectedOperationType?.requiresSenderLocation === 'Yes' &&
      entry.senderLocationCode.trim() === ''
    ) {
      alert('Sender Location is required for this operation type')
      return
    }

    if (
      selectedOperationType?.requiresReceiverLocation === 'Yes' &&
      entry.receiverLocationCode.trim() === ''
    ) {
      alert('Receiver Location is required for this operation type')
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
        alert(`${value.fieldName} is required`)
        return
      }
    }

    const layoutType = String(selectedTemplate?.entryLayoutType || '').trim()

    if (layoutType === 'Tank Gauging') {
      const hasTankPayload = (entry.values || []).some((v) => v.fieldCode === 'tank_gauging_payload')
      if (!hasTankPayload) {
        alert('Template setup required: Add System field "tank_gauging_payload" in Operation Template.')
        return
      }
    }

    if (layoutType === 'Multi-Tank Before/After') {
      const hasMultiTankPayload = (entry.values || []).some((v) => v.fieldCode === 'multi_tank_payload')
      if (!hasMultiTankPayload) {
        alert('Template setup required: Add System field "multi_tank_payload" in Operation Template.')
        return
      }
    }

    const mandatoryError = validateAssetSpecificMandatory(entry.values || [])
    if (mandatoryError) {
      alert(mandatoryError)
      return
    }

    const actionLabel = editId === null ? 'save' : 'update'
    const ok = window.confirm(
      `Confirm to ${actionLabel} this Draft ticket?\n\n` +
      `Operation Type: ${entry.operationTypeCode}\n` +
      `Template ID: ${entry.operationTemplateId}\n` +
      `Asset: ${entry.primaryAssetCode}\n` +
      `Date: ${entry.operationDate}`
    )

    if (!ok) return
    try {
      setLoading(true)

      let saved = null

      if (editId === null) {
        saved = await createOperationEntry({ ...entry, status: 'Draft' })
        alert('Operation Entry saved successfully')
      } else {
        saved = await updateOperationEntry(editId, {
          ...entry,
          status: entry.status || 'Draft',
        })
        alert('Operation Entry updated successfully')
      }

      await reloadOperationEntries()
      if (typeof reloadOperationTransactions === 'function') {
        await reloadOperationTransactions()
      }

      // ✅ Auto UNLOAD + Comparison only when triggered by Step 11C params
      if (saved && prefill.autoEventType) {
        const convoy = String(entry.convoyNumber || '').trim()
        if (!convoy) {
          alert(`Auto-link skipped: Convoy Number is required for ${prefill.autoEventType}`)
          setLoading(false)
          return
        }

        await createTripEvent({
          convoyNumber: convoy,
          eventType: prefill.autoEventType,
          locationCode: entry.originLocationCode || null,
          assetCode: entry.primaryAssetCode,
          operationTransactionId: saved.id,
          remarks: `Auto-linked ${prefill.autoEventType} from Acknowledge Receipt`,
        })

        if (prefill.leftTicketId) {
          await createTripComparison({
            convoyNumber: convoy,
            comparisonType: 'LOAD_AFTER_vs_UNLOAD_BEFORE',
            leftTransactionId: prefill.leftTicketId,
            rightTransactionId: saved.id,
            remarks: 'Auto-created from Acknowledge Receipt',
          })
        }

        navigate(`/convoy-tracker?convoy_number=${encodeURIComponent(convoy)}`)
        return
      }

      setEntry(emptyEntry)
      setEditId(null)
    } catch (error) {
      alert(error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleEdit = (entryToEdit) => {
    if (entryToEdit.status !== 'Draft' && entryToEdit.status !== 'Rejected') {
      alert('Only Draft or Rejected operation entries can be edited.')
      return
    }
    const ok = window.confirm(
      'Open this ticket for editing?\n\nAny current form changes will be replaced.'
    )
    if (!ok) return

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

  const handleDelete = async (entryId) => {
    const confirmDelete = window.confirm(
      'Are you sure you want to cancel this Draft/Rejected operation entry? This will preserve the audit history.'
    )

    if (confirmDelete === false) {
      return
    }

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

      alert('Operation Entry cancelled successfully')
    } catch (error) {
      alert(error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleCancelEdit = () => {
    const ok = window.confirm('Cancel editing and clear the current form?')
    if (!ok) return

    setEntry(emptyEntry)
    setEditId(null)
  }
  const showConvoyNumber = String(selectedTemplate?.entryLayoutType || '')
    .toLowerCase()
    .includes('multi-tank')

  return (
    <div>
      <div className="page-title">
        <div>
          <h2>Operation Entry</h2>
          <p>
            Create new operation tickets or edit Draft/Rejected tickets using
            asset-specific entry layouts.
          </p>
        </div>

        <span className="record-count">
          {editableOperationEntries.length} Editable Entries
        </span>
      </div>

      <form onSubmit={handleSubmit}>
        <div>
          <label>Operation Type</label>
          <select
            name="operationTypeCode"
            value={entry.operationTypeCode}
            onChange={handleChange}
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
            disabled={!selectedOperationType}
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
            disabled={!selectedOperationType}
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
            <label>Convoy Number *</label>
            <input
              name="convoyNumber"
              type="text"
              value={entry.convoyNumber}
              onChange={handleChange}
              placeholder="Example: CNV-2026-001"
            />
          </div>
        )}
        <div>
          <label>Origin Location</label>
          <select
            name="originLocationCode"
            value={entry.originLocationCode}
            onChange={handleChange}
            disabled={selectedAsset?.assetScope === 'Local'}
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
          />
        </div>

        <div>
          <label>Start Date/Time</label>
          <input
            name="operationStartDatetime"
            type="datetime-local"
            value={entry.operationStartDatetime}
            onChange={handleChange}
          />
        </div>

        <div>
          <label>End Date/Time</label>
          <input
            name="operationEndDatetime"
            type="datetime-local"
            value={entry.operationEndDatetime}
            onChange={handleChange}
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
          />
        </div>

        <OperationLayoutRenderer
          entry={entry}
          editId={editId}
          selectedTemplate={selectedTemplate}
          selectedTemplateFields={selectedTemplateFields}
          selectedAsset={selectedAsset}
          assetCalibrationTables={assetCalibrationTables}
          calibrationTemplates={calibrationTemplates}
          handleValueChange={handleValueChange}
          getInputType={getInputType}
        />

        <div className="form-actions">
          <button type="submit" disabled={loading}>
            {loading
              ? 'Please wait...'
              : editId === null
                ? 'Save Operation Entry'
                : 'Update Operation Entry'}
          </button>

          {editId !== null && (
            <button type="button" onClick={handleCancelEdit} disabled={loading}>
              Cancel Edit
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
          {editableOperationEntries.length === 0 ? (
            <tr>
              <td colSpan="10" className="empty-table">
                No Draft or Rejected operation entries available for editing.
              </td>
            </tr>
          ) : (
            editableOperationEntries.map((item) => (
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
                  <button type="button" onClick={() => handleEdit(item)}>
                    Edit
                  </button>

                  <button type="button" onClick={() => handleDelete(item.id)}>
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