import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import useKeyboardShortcuts from '../hooks/useKeyboardShortcuts'
import ShortcutsHelp from '../components/common/ShortcutsHelp'
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
import { getLinkedSenderTicket } from '../api/operationEntryApi'
import { getAllLocations } from '../api/locationApi'
import StockMovementLayout from '../components/operationLayouts/StockMovementLayout'
import VesselCycleLayout from '../components/operationLayouts/VesselCycleLayout'
import ShuttleTrackingLayout from '../components/operationLayouts/ShuttleTrackingLayout'
import FSOTrackingLayout from '../components/operationLayouts/FSOTrackingLayout.jsx'
import FlowmeterReadingLayout from '../components/operationLayouts/FlowmeterReadingLayout'
import PaginationControls, { paginateRows, usePageSize } from '../components/common/PaginationControls'
import AlertMessage from '../components/common/AlertMessage'
import OperationEntryBulkImportDialog from '../components/operationEntry/OperationEntryBulkImportDialog'
import Icon from '../components/common/Icon'
import useActionFeedback from '../hooks/useActionFeedback'
import { logUiAction } from '../utils/actionLogger'
import {
  entryReceiverCode,
  entrySenderCode,
  formatSenderLabel,
  withClubbedReceiver,
  withClubbedSender,
} from '../utils/senderReceiver'
import { resolveOperationDate } from '../utils/operationDate'

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
  fieldErrors = {},
  setFieldErrors,
  notifyError,
  notifySuccess,
}) {
  if (!selectedTemplate) {
    return null
  }

  const setFieldError = (fieldCode, message) => {
    setFieldErrors((current) => ({ ...current, [fieldCode]: message }))
  }

  const clearFieldError = (fieldCode) => {
    setFieldErrors((current) => {
      const next = { ...current }
      if (next[fieldCode]) {
        delete next[fieldCode]
        return next
      }
      return current
    })
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
              id={`field-${value.fieldCode}`}
              type={getInputType(value.dataType)}
              onWheel={(e) => e.target.blur()}
              value={
                typeof value.fieldValue === 'object'
                  ? JSON.stringify(value.fieldValue)
                  : value.fieldValue
              }
              onChange={(e) => {
                handleValueChange(value.fieldCode, e.target.value)
                clearFieldError(value.fieldCode)
              }}
              onBlur={(e) => {
                const templateField = selectedTemplateFields.find(
                  (field) => field.fieldCode === value.fieldCode
                )
                const isRequiredManual =
                  templateField?.isRequired === 'Yes' &&
                  templateField?.inputMode === 'Manual'
                if (
                  isRequiredManual &&
                  String(e.target.value ?? '').trim() === ''
                ) {
                  setFieldError(value.fieldCode, `${value.fieldName} is required`)
                } else {
                  clearFieldError(value.fieldCode)
                }
              }}
              disabled={value.inputMode !== 'Manual'}
              placeholder={
                value.inputMode === 'Manual'
                  ? `Enter ${value.fieldName}`
                  : `${value.inputMode} field - populated by system`
              }
              aria-invalid={Boolean(fieldErrors[value.fieldCode])}
            />

            {fieldErrors[value.fieldCode] && (
              <div className="field-error">{fieldErrors[value.fieldCode]}</div>
            )}

            {value.inputMode === 'Manual' && value.dataType === 'Date' && (
              <button
                type="button"
                className="field-shortcuts"
                onClick={() =>
                  handleValueChange(
                    value.fieldCode,
                    new Date().toISOString().slice(0, 10)
                  )
                }
                title={`Set ${value.fieldName} to today`}
              >
                Today
              </button>
            )}

            {value.inputMode === 'Manual' && value.dataType === 'DateTime' && (
              <button
                type="button"
                className="field-shortcuts"
                onClick={() =>
                  handleValueChange(
                    value.fieldCode,
                    new Date().toISOString().slice(0, 16)
                  )
                }
                title={`Set ${value.fieldName} to now`}
              >
                Now
              </button>
            )}

            {value.dataType === 'JSON' && (
              <button
                type="button"
                className="field-shortcuts"
                onClick={async () => {
                  try {
                    const text = await navigator.clipboard.readText()
                    const parsed = JSON.parse(text)
                    handleValueChange(value.fieldCode, parsed)
                    notifySuccess(`Pasted JSON into ${value.fieldName}`)
                  } catch {
                    notifyError('The clipboard does not contain valid JSON.')
                  }
                }}
                title={`Paste JSON from clipboard into ${value.fieldName}`}
              >
                Paste JSON
              </button>
            )}

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
  fieldErrors = {},
  setFieldErrors,
  notifyError,
  notifySuccess,
}) {
  if (!templateLayout || !Array.isArray(templateLayout.items)) {
    return null
  }

  const valueByFieldCode = new Map((entry.values || []).map((v) => [v.fieldCode, v]))
  const fieldById = new Map((selectedTemplateFields || []).map((f) => [Number(f.id), f]))

  const setFieldError = (fieldCode, message) => {
    setFieldErrors((current) => ({ ...current, [fieldCode]: message }))
  }

  const clearFieldError = (fieldCode) => {
    setFieldErrors((current) => {
      const next = { ...current }
      if (next[fieldCode]) {
        delete next[fieldCode]
        return next
      }
      return current
    })
  }

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
                            onWheel={(e) => e.target.blur()}
                            value={
                              typeof value.fieldValue === 'object'
                                ? JSON.stringify(value.fieldValue)
                                : value.fieldValue
                            }
                            onChange={(e) => {
                              handleValueChange(value.fieldCode, e.target.value)
                              clearFieldError(value.fieldCode)
                            }}
                            onBlur={(e) => {
                              const field = fieldById.get(Number(item.fieldId))
                              const isRequiredManual =
                                field?.isRequired === 'Yes' &&
                                field?.inputMode === 'Manual'
                              if (
                                isRequiredManual &&
                                String(e.target.value ?? '').trim() === ''
                              ) {
                                setFieldError(
                                  value.fieldCode,
                                  `${value.fieldName} is required`
                                )
                              } else {
                                clearFieldError(value.fieldCode)
                              }
                            }}
                            disabled={value.inputMode !== 'Manual'}
                            aria-invalid={Boolean(fieldErrors[value.fieldCode])}
                            placeholder={
                              item.placeholderOverride ||
                              (value.inputMode === 'Manual'
                                ? `Enter ${value.fieldName}`
                                : `${value.inputMode} field - populated by system`)}
                          />

                          {fieldErrors[value.fieldCode] && (
                            <div className="field-error">{fieldErrors[value.fieldCode]}</div>
                          )}

                          {value.inputMode === 'Manual' && value.dataType === 'Date' && (
                            <button
                              type="button"
                              className="field-shortcuts"
                              onClick={() =>
                                handleValueChange(
                                  value.fieldCode,
                                  new Date().toISOString().slice(0, 10)
                                )
                              }
                              title={`Set ${value.fieldName} to today`}
                            >
                              Today
                            </button>
                          )}

                          {value.inputMode === 'Manual' && value.dataType === 'DateTime' && (
                            <button
                              type="button"
                              className="field-shortcuts"
                              onClick={() =>
                                handleValueChange(
                                  value.fieldCode,
                                  new Date().toISOString().slice(0, 16)
                                )
                              }
                              title={`Set ${value.fieldName} to now`}
                            >
                              Now
                            </button>
                          )}

                          {value.dataType === 'JSON' && (
                            <button
                              type="button"
                              className="field-shortcuts"
                              onClick={async () => {
                                try {
                                  const text = await navigator.clipboard.readText()
                                  const parsed = JSON.parse(text)
                                  handleValueChange(value.fieldCode, parsed)
                                  notifySuccess(`Pasted JSON into ${value.fieldName}`)
                                } catch {
                                  notifyError(
                                    'The clipboard does not contain valid JSON.'
                                  )
                                }
                              }}
                              title={`Paste JSON from clipboard into ${value.fieldName}`}
                            >
                              Paste JSON
                            </button>
                          )}
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
  fieldErrors = {},
  setFieldErrors,
  notifyError,
  notifySuccess,
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
          fieldErrors={fieldErrors}
          setFieldErrors={setFieldErrors}
          notifyError={notifyError}
          notifySuccess={notifySuccess}
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
          fieldErrors={fieldErrors}
          setFieldErrors={setFieldErrors}
          notifyError={notifyError}
          notifySuccess={notifySuccess}
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
          fieldErrors={fieldErrors}
          setFieldErrors={setFieldErrors}
          notifyError={notifyError}
          notifySuccess={notifySuccess}
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
          fieldErrors={fieldErrors}
          setFieldErrors={setFieldErrors}
          notifyError={notifyError}
          notifySuccess={notifySuccess}
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
          key={`shuttle-tracking-${editId ?? 'new'}-${entry.operationTemplateId}-${entry.primaryAssetCode}`}
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
          fieldErrors={fieldErrors}
          setFieldErrors={setFieldErrors}
          notifyError={notifyError}
          notifySuccess={notifySuccess}
          excludedFieldCodes={['shuttle_payload']}
        />
      </>
    )
  }

  if (layoutType === 'FSO Tracking') {
    return (
      <>
        <FSOTrackingLayout
          key={`fso-tracking-${editId ?? 'new'}-${entry.operationTemplateId}-${entry.primaryAssetCode}`}
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
          fieldErrors={fieldErrors}
          setFieldErrors={setFieldErrors}
          notifyError={notifyError}
          notifySuccess={notifySuccess}
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
              fieldErrors={fieldErrors}
              setFieldErrors={setFieldErrors}
              notifyError={notifyError}
              notifySuccess={notifySuccess}
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
            fieldErrors={fieldErrors}
            setFieldErrors={setFieldErrors}
            notifyError={notifyError}
            notifySuccess={notifySuccess}
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
          fieldErrors={fieldErrors}
          setFieldErrors={setFieldErrors}
          notifyError={notifyError}
          notifySuccess={notifySuccess}
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
        fieldErrors={fieldErrors}
        setFieldErrors={setFieldErrors}
        notifyError={notifyError}
        notifySuccess={notifySuccess}
      />

      <OperationTemplateFields
        entry={entry}
        selectedTemplate={selectedTemplate}
        selectedTemplateFields={selectedTemplateFields}
        handleValueChange={handleValueChange}
        getInputType={getInputType}
        fieldErrors={fieldErrors}
        setFieldErrors={setFieldErrors}
        notifyError={notifyError}
        notifySuccess={notifySuccess}
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

// Stable reference so useKeyboardShortcuts does not re-subscribe each render.
const SHORTCUTS_ALWAYS_ON = ['escape']

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
  locationOperationAvailability = [],
}) {
  const isAdminBootstrap =
    loggedInUser?.isAdmin === true ||
    (Array.isArray(loggedInUser?.roles) && loggedInUser.roles.some((role) =>
      String(role?.role_name || role?.roleName || '').trim().toLowerCase() === 'admin'
    ))

  const hasPermission = (permissionName) =>
    Boolean(
      loggedInUser?.permissions?.some(
        (p) => p.permissionName === permissionName
      )
    )

  const canCreateOperationEntry = useMemo(() => {
    if (isAdminBootstrap) return true
    // Create Receiving Ticket (PERMISSION_CRITERIA_MODEL.md, section 7.1) lets
    // a receiving terminal save the receiving ticket of an approved sender
    // ticket without the general Create Operation Entry right. The backend
    // still enforces which of the two the request actually needs.
    return (
      hasPermission('Create Operation Entry') ||
      hasPermission('Create Receiving Ticket')
    )
  }, [loggedInUser])

  const canCancelOperationTransaction = useMemo(() => {
    if (isAdminBootstrap) return true
    return hasPermission('Cancel Operation Transaction')
  }, [loggedInUser])
  const defaultEntryLocationCode = (() => {
    const allAccess = loggedInUser?.allLocationsAccess === 'Yes'
    const assigned = loggedInUser?.assignedLocationCodes || []
    if (isAdminBootstrap || allAccess) return ''
    if (Array.isArray(assigned) && assigned.length === 1) {
      return String(assigned[0]).trim()
    }
    return ''
  })()

  const emptyEntry = {
    operationTypeCode: '',
    operationTemplateId: '',
    primaryAssetCode: '',
    convoyNumber: '',
    // Clubbed Sender / Receiver dropdowns. Both columns of each pair are
    // written from a single choice so the four database columns stay in
    // sync; the columns themselves are unchanged.
    originLocationCode: defaultEntryLocationCode,
    destinationLocationCode: '',
    senderLocationCode: defaultEntryLocationCode,
    receiverLocationCode: '',
    // Operation date is no longer captured in the metadata - it is derived
    // from the date the user enters inside the data-entry payload (see
    // resolveOperationDate). Start / end date-time are kept in state only so
    // that editing an old ticket does not wipe values already stored.
    operationDate: '',
    operationStartDatetime: '',
    operationEndDatetime: '',
    productName: '',
    createdBy: '',
    remarks: '',
    status: 'Draft',
    values: [],
    // Receiver ticket created against an approved sender ticket (tracking modules).
    linkedTicketId: null,
  }

  const [entry, setEntry] = useState(emptyEntry)
  // Sender ticket summary for a linked receiver ticket (locations, convoy, receiving op types).
  const [linkedSender, setLinkedSender] = useState(null)
  const isLinkedEntry = Boolean(entry.linkedTicketId)
  // Only trust sender info that belongs to the currently linked ticket.
  const activeLinkedSender =
    isLinkedEntry && linkedSender && Number(linkedSender.transaction_id) === Number(entry.linkedTicketId)
      ? linkedSender
      : null

  const [allSystemLocations, setAllSystemLocations] = useState([])

  const [editId, setEditId] = useState(null)
  const [loading, setLoading] = useState(false)
  const feedback = useActionFeedback()
  const { notifySuccess, notifyError, clearSuccess, clearError } = feedback

  // Full location master for the Receiver dropdown (and for the Sender
  // dropdown of a linked receiving ticket). A ticket can be addressed to any
  // terminal, so this list is deliberately not limited to the locations the
  // signed-in user is assigned to.
  useEffect(() => {
    let active = true
    getAllLocations()
      .then((data) => {
        if (active) setAllSystemLocations(data?.items || [])
      })
      .catch((error) => {
        // Report instead of swallowing: when this call fails the Receiver
        // dropdown silently collapses to the user's own location.
        console.error('Unable to load the full location list:', error)
        if (active) {
          notifyError(
            `Unable to load the full location list, so Receiver only shows your own location: ${error.message}`,
            { title: 'Locations' }
          )
        }
      })
    return () => {
      active = false
    }
  }, [notifyError])

  const setEntryField = (field, value) => {
    setEntry((prev) => ({
      ...prev,
      [field]: value,
    }))
  }

  // Operation Date / Start / End are no longer entered in the metadata: the
  // operation date lives inside the data-entry payload (gauging date, tanker
  // transaction date, reading date, ...). Keep the ticket date in sync with
  // it, falling back to the date already stored on the ticket and then to
  // today, so `operation_date` is never blank on save.
  useEffect(() => {
    const resolved = resolveOperationDate(entry)

    if (resolved === String(entry.operationDate || '').trim()) {
      return
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEntry((current) => ({ ...current, operationDate: resolved }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.values, entry.operationDate])

  const [confirmAction, setConfirmAction] = useState(null)
  const [fieldErrors, setFieldErrors] = useState({})
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false)
  const [bulkImportOpen, setBulkImportOpen] = useState(false)
  const entryFormRef = useRef(null)
  const handlerRef = useRef({ handleSubmit: null })
  const cloneEntryRef = useRef(null)
  const shortcutStateRef = useRef({ entry, editId, confirmAction, loading, canCreateOperationEntry })
  const [tankerSenderReference, setTankerSenderReference] = useState(null)
  const [tankerSenderReferenceLoading, setTankerSenderReferenceLoading] =
    useState(false)
  const [editableSearch, setEditableSearch] = useState('')
  const [editableStatusFilter, setEditableStatusFilter] = useState('ALL') // ALL | Draft | Rejected
  const [editablePage, setEditablePage] = useState(1)
  const editablePageSize = usePageSize()
  const [selectedTemplateLayout, setSelectedTemplateLayout] = useState(null)

  const location = useLocation()
  const navigate = useNavigate()
  const [prefillApplied, setPrefillApplied] = useState(false)

  const normalizeCode = (value) => String(value ?? '').trim().toLowerCase()
  const hasAllLocationsAccess = loggedInUser?.allLocationsAccess === 'Yes'
  // Reused for operation availability, origin/sender locations, and local assets.
  const scopedLocationCodeSet = useMemo(() => {
    return new Set(
      (loggedInUser?.assignedLocationCodes || [])
        .map(normalizeCode)
        .filter(Boolean)
    )
  }, [loggedInUser])

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

    const autoEventType = String(
      params.get('barge_event_type') || params.get('auto_event_type') || ''
    ).trim()
    const linkedTicketIdRaw = String(params.get('linked_ticket_id') || '').trim()
    const linkedTicketId = linkedTicketIdRaw ? Number(linkedTicketIdRaw) : null

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
      fromBargeTracking:
        Boolean(autoEventType) || String(source || '').trim() === 'barge-tracking',
      linkedTicketId,
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
      prefill.fromBargeTracking ||
      prefill.linkedTicketId

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
      linkedTicketId: prefill.linkedTicketId || current.linkedTicketId,
      status: 'Draft',
    }))

    setPrefillApplied(true)
  }, [prefill, prefillApplied])

  // Linked receiver ticket: load the sender ticket. On a new ticket the sender's
  // route, convoy and barge are copied into the form and locked; the receiving
  // operation type is preselected when the sender has only one receiving type.
  useEffect(() => {
    const linkedId = entry.linkedTicketId
    if (!linkedId) return

    let active = true
    getLinkedSenderTicket(linkedId)
      .then((info) => {
        if (!active) return
        setLinkedSender(info)
        if (editId !== null) return
        setEntry((current) => {
          if (Number(current.linkedTicketId) !== Number(linkedId)) return current
          const receivingTypes = info.receiver_operation_types || []
          const onlyType = receivingTypes.length === 1 ? receivingTypes[0].operation_type_code : ''
          return {
            ...current,
            convoyNumber: info.convoy_number || current.convoyNumber,
            primaryAssetCode: info.primary_asset_code || current.primaryAssetCode,
            originLocationCode: info.origin_location_code || current.originLocationCode,
            destinationLocationCode: info.destination_location_code || '',
            senderLocationCode: info.sender_location_code || '',
            receiverLocationCode: info.receiver_location_code || '',
            operationTypeCode: onlyType || current.operationTypeCode,
            operationTemplateId: onlyType ? '' : current.operationTemplateId,
          }
        })
      })
      .catch((error) => {
        if (!active) return
        setLinkedSender(null)
        notifyError(error.message)
      })

    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.linkedTicketId, editId])

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
          notifyError(error.message || 'Unable to load sender tanker reference')
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

  const operationTypeOptions = useMemo(() => {
    const statusFiltered = operationTypes.filter(
      (item) => item.status === 'Active'
    )

    if (isAdminBootstrap || hasAllLocationsAccess) {
      return statusFiltered.map((item) => ({
        ...item,
        disabled: false,
      }))
    }

    const activeAvail = (locationOperationAvailability || []).filter(
      (x) => x.status === 'Active'
    )
    const allowedOpTypeCodes = new Set()
    activeAvail
      .filter((x) => scopedLocationCodeSet.has(normalizeCode(x.locationCode)))
      .forEach((x) => allowedOpTypeCodes.add(normalizeCode(x.operationTypeCode)))

    return statusFiltered.map((ot) => ({
      ...ot,
      disabled: !allowedOpTypeCodes.has(normalizeCode(ot.operationTypeCode)),
    }))
  }, [
    operationTypes,
    locationOperationAvailability,
    scopedLocationCodeSet,
    isAdminBootstrap,
    hasAllLocationsAccess,
  ])

  const availableOperationTypes = useMemo(() => {
    return operationTypeOptions.filter((item) => !item.disabled)
  }, [operationTypeOptions])

  const activeOperationTemplates = operationTemplates.filter(
    (item) => item.status === 'Active'
  )

  const activeAssets = assets.filter((item) => item.status === 'Active')

  const activeLocations = useMemo(() => {
    const statusFiltered = locations.filter((item) => item.status === 'Active')
    if (isAdminBootstrap || hasAllLocationsAccess) {
      return statusFiltered
    }
    // For activeLocations (used in asset filtering), use scoped set
    return statusFiltered.filter((item) =>
      scopedLocationCodeSet.has(normalizeCode(item.locationCode))
    )
  }, [
    locations,
    isAdminBootstrap,
    hasAllLocationsAccess,
    scopedLocationCodeSet,
  ])

  // Get all locations for the Receiver dropdown - not filtered by user scope
  const allActiveLocations = useMemo(() => {
    const source =
      allSystemLocations && allSystemLocations.length > 0
        ? allSystemLocations
        : locations
    return (source || []).filter((item) => item.status === 'Active')
  }, [allSystemLocations, locations])

  const operationTypeChoices = useMemo(() => {
    if (!activeLinkedSender) return operationTypeOptions
    const receivingCodes = new Set(
      (activeLinkedSender.receiver_operation_types || []).map((item) => normalizeCode(item.operation_type_code))
    )
    // No tracking configuration for this sender: nothing to restrict to.
    if (receivingCodes.size === 0) return operationTypeOptions
    return operationTypeOptions.filter((item) => receivingCodes.has(normalizeCode(item.operationTypeCode)))
  }, [activeLinkedSender, operationTypeOptions])

  const selectedOperationType = operationTypeOptions.find((item) => {
    return item.operationTypeCode === entry.operationTypeCode
  })

  const availableTemplates = useMemo(() => {
    if (!selectedOperationType) {
      return []
    }

    return operationTemplates.filter((template) => {
      return (
        normalizeCode(template.operationTypeCode) ===
          normalizeCode(selectedOperationType.operationTypeCode) &&
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

    // If an origin location has been selected, narrow filtering to that location
    // Otherwise, use the user's assigned location codes
    const locationFilter = entry.originLocationCode
      ? [normalizeCode(entry.originLocationCode)]
      : [...scopedLocationCodeSet]

    return activeAssets.filter((asset) => {
      // Must match the operation type's applicable asset type
      if (
        normalizeCode(asset.assetTypeCode) !==
        normalizeCode(selectedOperationType.applicableAssetTypeCode)
      ) {
        return false
      }

      // Admin / all-locations-access users see all matching assets
      if (isAdminBootstrap || hasAllLocationsAccess) {
        return true
      }

      // Global assets are available at every location
      if (normalizeCode(asset.assetScope) === 'global') {
        return true
      }

      // Local assets must have a location_code matching the target location(s)
      if (normalizeCode(asset.assetScope) === 'local' && asset.locationCode) {
        return locationFilter.includes(normalizeCode(asset.locationCode))
      }

      // Fallback: include the asset (safety net for undefined scope)
      return true
    })
  }, [
    activeAssets,
    selectedOperationType,
    entry.originLocationCode,
    scopedLocationCodeSet,
    isAdminBootstrap,
    hasAllLocationsAccess,
  ])

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

      const blob = `${item.operationNumber} ${item.operationTypeName} ${item.operationTemplateName} ${item.primaryAssetName} ${item.primaryAssetCode} ${item.originLocationName} ${item.originLocationCode} ${item.senderLocationName || ''} ${item.senderLocationCode || ''} ${item.destinationLocationName || ''} ${item.destinationLocationCode || ''} ${item.receiverLocationName || ''} ${item.receiverLocationCode || ''} ${item.operationDate} ${item.productName} ${item.status}`.toLowerCase()

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

  const pagedEditableEntries = useMemo(() => {
    return paginateRows(filteredEditableEntries, editablePage, editablePageSize)
  }, [filteredEditableEntries, editablePage, editablePageSize])

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

  // Apply a barge stage passed from Barge Tracking ("Create Ticket" passes
  // ?barge_event_type=UNLOAD / LOAD_2_TOPUP / STS) to the ticket's
  // barge_event_type value, so the timeline event gets the correct type on
  // approval. Applied both when the template is prefilled from the URL and
  // when the user selects the template manually.
  const applyPrefilledBargeStage = (values) => {
    if (!prefill.autoEventType) {
      return values
    }

    return values.map((value) => {
      if (
        value.fieldCode === 'barge_event_type' &&
        String(value.fieldValue ?? '').trim() === ''
      ) {
        return { ...value, fieldValue: prefill.autoEventType }
      }

      return value
    })
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
      values: applyPrefilledBargeStage(
        initializeValuesFromTemplate(prefill.operationTemplateId)
      ),
    }))
  }, [prefillApplied, prefill.operationTemplateId, prefill.autoEventType])

  const handleChange = (e) => {
    const { name, value } = e.target

    if (name === 'operationTypeCode' && isLinkedEntry) {
      // Linked receiver ticket: route, convoy and barge come from the sender ticket.
      setEntry({
        ...entry,
        operationTypeCode: value,
        operationTemplateId: '',
        values: [],
      })
      return
    }

    if (name === 'operationTypeCode') {
      const preserveAsset = prefillApplied && prefill.primaryAssetCode

      // Changing the operation type clears both clubbed pairs (unless the
      // asset is being preserved from a tracking prefill).
      setEntry(
        withClubbedReceiver(
          withClubbedSender(
            {
              ...entry,
              operationTypeCode: value,
              operationTemplateId: '',
              primaryAssetCode: preserveAsset ? entry.primaryAssetCode : '',
              values: [],
              convoyNumber: entry.convoyNumber, // keep convoy
            },
            preserveAsset ? entry.originLocationCode : '',
          ),
          '',
        ),
      )
      return
    }

    if (name === 'operationTemplateId') {
      setEntry({
        ...entry,
        operationTemplateId: value,
        values: applyPrefilledBargeStage(initializeValuesFromTemplate(value)),
      })
      return
    }

    // Clubbed dropdowns: one Sender choice feeds Origin + Sender, one
    // Receiver choice feeds Destination + Receiver. The four columns are
    // kept in the database - they are simply written together.
    if (name === 'senderLocationCode') {
      setEntry((current) => withClubbedSender(current, value))
      return
    }

    if (name === 'receiverLocationCode') {
      setEntry((current) => withClubbedReceiver(current, value))
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
        senderLocationCode: '',
      })
      return
    }

    // A local asset pins the entry to its own location: keep the clubbed
    // Sender pair in step with the asset's location.
    setEntry(
      asset.assetScope === 'Local'
        ? withClubbedSender({ ...entry, primaryAssetCode: asset.assetCode }, asset.locationCode)
        : { ...entry, primaryAssetCode: asset.assetCode },
    )
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

  const validateVesselPayloadDate = (payload, label) => {
    // FSO / Shuttle payloads keep their operation date inside the payload,
    // like every other asset-specific layout. Payloads saved before the date
    // field existed are completed by the layout, so the check is safe for
    // existing tickets too.
    if (!payload) return null

    const inputs = payload.inputs || {}
    if (isBlank(inputs.operation_date)) {
      return `${label} Date is required.`
    }

    return null
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
      const shuttlePayloadRaw = entryValues.find((v) => v.fieldCode === 'shuttle_payload')?.fieldValue
      const fsoPayloadRaw = entryValues.find((v) => v.fieldCode === 'fso_payload')?.fieldValue

      const tankPayload = parseFieldObject(tankPayloadRaw)
      const multiTankPayload = parseFieldObject(multiTankPayloadRaw)
      const tankerPayload = parseFieldObject(tankerPayloadRaw)
      const shuttlePayload = parseFieldObject(shuttlePayloadRaw)
      const fsoPayload = parseFieldObject(fsoPayloadRaw)

    const shuttleDateError = validateVesselPayloadDate(shuttlePayload, 'Shuttle')
    if (shuttleDateError) {
      return shuttleDateError
    }

    const fsoDateError = validateVesselPayloadDate(fsoPayload, 'FSO')
    if (fsoDateError) {
      return fsoDateError
    }

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
      notifyError('You do not have permission to create operation entries')
      return
    }

    if (entry.operationTypeCode.trim() === '') {
      notifyError('Operation Type is required')
      return
    }

    if (String(entry.operationTemplateId).trim() === '') {
      notifyError('Operation Template is required')
      return
    }

    if (entry.primaryAssetCode.trim() === '') {
      notifyError('Primary Asset is required')
      return
    }
    const selectedLayoutType = String(selectedTemplate?.entryLayoutType || '')
      .toLowerCase()

    const isMultiTank = selectedLayoutType.includes('multi-tank')
    const isTanker = selectedLayoutType.includes('tanker')
    const isShuttleTracking = selectedLayoutType.includes('shuttle tracking')

    if ((isMultiTank || isTanker) && entry.convoyNumber.trim() === '') {
      notifyError('Convoy Number is required for Multi-Tank / Tanker operations')
      return
    }

    if (isShuttleTracking && entry.convoyNumber.trim() === '') {
      notifyError('Shuttle Number is required for Shuttle Tracking')
      return
    }

    // Shuttle Number must be unique across all tickets and must not be repeated.
    if (isShuttleTracking) {
      const shuttleNo = entry.convoyNumber.trim().toLowerCase()
      const duplicateShuttleNumber = (operationEntries || []).some((item) => {
        if (editId !== null && Number(item?.id) === Number(editId)) {
          return false
        }
        return String(item?.convoyNumber || '').trim().toLowerCase() === shuttleNo
      })
      if (duplicateShuttleNumber) {
        notifyError('Shuttle Number must be unique and cannot be repeated across tickets')
        return
      }
    }
    // Clubbed Sender / Receiver: the single Sender choice is the Origin of
    // the ticket and is always mandatory; the Receiver is required when the
    // operation type asks for it.
    const senderCode = entrySenderCode(entry)
    const receiverCode = entryReceiverCode(entry)

    if (senderCode === '') {
      notifyError('Sender Location is required')
      return
    }

    // The operation date is captured inside the data-entry payload, so it is
    // resolved instead of typed (see resolveOperationDate). Nothing to check.

    // Shuttle Tracking entries are captured from the Shuttle Tracking page,
    // which has no sender / receiver location row, so those locations are not
    // applicable to this layout and must not be enforced.
    if (
      !isShuttleTracking &&
      selectedOperationType?.requiresSenderLocation === 'Yes' &&
      senderCode === ''
    ) {
      notifyError('Sender Location is required for this operation type')
      return
    }

    if (
      !isShuttleTracking &&
      selectedOperationType?.requiresReceiverLocation === 'Yes' &&
      receiverCode === ''
    ) {
      notifyError('Receiver Location is required for this operation type')
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
        notifyError(`${value.fieldName} is required`)
        return
      }
    }

    const layoutType = String(selectedTemplate?.entryLayoutType || '').trim()

    if (layoutType === 'Tank Gauging') {
      const hasTankPayload = (entry.values || []).some((v) => v.fieldCode === 'tank_gauging_payload')
      if (!hasTankPayload) {
        notifyError('Template setup required: Add System field "tank_gauging_payload" in Operation Template.')
        return
      }
    }

    if (layoutType === 'Multi-Tank Before/After') {
      const hasMultiTankPayload = (entry.values || []).some((v) => v.fieldCode === 'multi_tank_payload')
      if (!hasMultiTankPayload) {
        notifyError('Template setup required: Add System field "multi_tank_payload" in Operation Template.')
        return
      }
    }

    if (layoutType === 'Tanker Loading') {
      const hasTankerPayload = (entry.values || []).some((v) => v.fieldCode === 'tanker_payload')
      if (!hasTankerPayload) {
        notifyError('Template setup required: Add System field "tanker_payload" in Operation Template.')
        return
      }
    }

    if (layoutType === 'Meter Reading') {
      const hasFlowmeterPayload = (entry.values || []).some((v) => v.fieldCode === 'flowmeter_payload')
      if (!hasFlowmeterPayload) {
        notifyError('Template setup required: Add System field "flowmeter_payload" in Operation Template.')
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
        notifyError('Flowmeter Date is required.')
        return
      }
      if (meters.length > 0) {
        if (!inputs.stream_name) {
          notifyError('Flowmeter Stream is required.')
          return
        }
        for (const meter of meters) {
          const opening = Number(meter.opening_reading ?? NaN)
          const closing = Number(meter.closing_reading ?? NaN)
          const label = String(meter.meter_label || 'Meter')
          if (!Number.isFinite(opening) || opening < 0) {
            notifyError(`${label}: Opening Reading cannot be negative.`)
            return
          }
          if (!Number.isFinite(closing) || closing < 0) {
            notifyError(`${label}: Closing Reading cannot be negative.`)
            return
          }
          if (closing < opening) {
            notifyError(`${label}: Closing Reading cannot be less than Opening Reading.`)
            return
          }
        }
      } else if (!inputs.meter_label) {
        notifyError('Flowmeter Meter Label is required.')
        return
      }
      if (!Number.isFinite(tankTemp)) {
        notifyError('Tank Temperature is required.')
        return
      }
      if (!Number.isFinite(sampleTemp)) {
        notifyError('Sample Temperature is required.')
        return
      }
      if (!Number.isFinite(bsw) || bsw < 0 || bsw > 100) {
        notifyError('BS & W must be between 0 and 100.')
        return
      }
      if (observedType === 'Observed API') {
        if (!Number.isFinite(observedApi)) {
          notifyError('Observed API is required.')
          return
        }
      } else if (observedType === 'Observed Density') {
        if (!Number.isFinite(observedDensity)) {
          notifyError('Observed Density is required.')
          return
        }
      } else {
        notifyError('Observed Input Type is required.')
        return
      }
    }

    if (layoutType === 'Shuttle Tracking') {
      const hasShuttlePayload = (entry.values || []).some((v) => v.fieldCode === 'shuttle_payload')
      if (!hasShuttlePayload) {
        notifyError('Template setup required: Add System field "shuttle_payload" in Operation Template.')
        return
      }
    }

    const mandatoryError = validateAssetSpecificMandatory(entry.values || [])
    if (mandatoryError) {
      notifyError(mandatoryError)
      return
    }

    const actionLabel = editId === null ? 'save' : 'update'
    setConfirmAction({
      type: 'submit',
      actionLabel,
      message: `Confirm to ${actionLabel} this Draft ticket?\n\nOperation Type: ${entry.operationTypeCode}\nTemplate ID: ${entry.operationTemplateId}\nAsset: ${entry.primaryAssetCode}\nDate: ${entry.operationDate}`,
    })
  }

  /**
   * Clone an existing Draft/Rejected ticket into the form as a brand new
   * draft, pre-filled with its metadata, locations, product and template
   * values so the user only reviews and saves.
   */
  const cloneEntry = (source) => {
    if (!canCreateOperationEntry) {
      notifyError('You do not have permission to create operation entries')
      return
    }

    setEntry({
      linkedTicketId: null,
      operationTypeCode: source.operationTypeCode,
      operationTemplateId: String(source.operationTemplateId || ''),
      primaryAssetCode: source.primaryAssetCode || '',
      convoyNumber: source.convoyNumber || '',
      originLocationCode: source.originLocationCode || '',
      destinationLocationCode: source.destinationLocationCode || '',
      senderLocationCode: source.senderLocationCode || '',
      receiverLocationCode: source.receiverLocationCode || '',
      operationDate: source.operationDate || '',
      operationStartDatetime: '',
      operationEndDatetime: '',
      productName: source.productName || '',
      createdBy: '',
      remarks: source.remarks
        ? `Clone of ${source.operationNumber || 'ticket'}: ${source.remarks}`
        : '',
      status: 'Draft',
      values: (source.values || []).map((value) => ({
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
    setEditId(null)
    setConfirmAction(null)
    setFieldErrors({})
    if (entryFormRef.current) {
      entryFormRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
    notifySuccess('Ticket cloned as a new draft. Review the values and save.')
    logUiAction('Operation Entry', 'Clone Ticket', {
      source: source.operationNumber || source.id,
    })
  }
  // Keep the latest submit handler, clone handler and page state in refs so
  // the one-time keyboard listener (registered by useKeyboardShortcuts below)
  // always reads current values without re-subscribing on every render. The
  // sync runs in an effect (after commit) rather than during render.
  useEffect(() => {
    handlerRef.current = { handleSubmit }
    shortcutStateRef.current = {
      entry,
      editId,
      confirmAction,
      loading,
      canCreateOperationEntry,
    }
    cloneEntryRef.current = cloneEntry
  })


  // Stable shortcut handlers. They read refs that are synced every render,
  // so the callbacks themselves never change and the hook subscribes once.
  const saveDraftFromShortcut = useCallback(() => {
    const current = shortcutStateRef.current
    if (current.loading) return
    const { handleSubmit: submit } = handlerRef.current
    if (submit) submit({ preventDefault: () => {} })
  }, [])

  const dismissOrCancelEdit = useCallback(() => {
    const current = shortcutStateRef.current
    if (current.confirmAction) {
      setConfirmAction(null)
      return
    }
    if (current.editId !== null) {
      setEntry(emptyEntry)
      setEditId(null)
      setFieldErrors({})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const cloneFromShortcut = useCallback(() => {
    const current = shortcutStateRef.current
    if (current.editId !== null && cloneEntryRef.current) {
      cloneEntryRef.current(current.entry)
    }
  }, [])

  const focusSearchFromShortcut = useCallback(() => {
    const searchInput = document.querySelector('.editable-entries-search')
    if (searchInput) searchInput.focus()
  }, [])

  const openShortcutsHelp = useCallback(() => setShowShortcutsHelp(true), [])

  const shortcutBindings = useMemo(
    () => ({
      'mod+s': saveDraftFromShortcut,
      'mod+enter': saveDraftFromShortcut,
      escape: dismissOrCancelEdit,
      'mod+d': cloneFromShortcut,
      'mod+/': focusSearchFromShortcut,
      '?': openShortcutsHelp,
    }),
    [
      saveDraftFromShortcut,
      dismissOrCancelEdit,
      cloneFromShortcut,
      focusSearchFromShortcut,
      openShortcutsHelp,
    ]
  )

  useKeyboardShortcuts({
    bindings: shortcutBindings,
    // Escape dismisses a confirmation or cancels editing even while the focus
    // is inside a field.
    alwaysOn: SHORTCUTS_ALWAYS_ON,
    // Do not steal keys while a full-screen dialog owns the interaction.
    enabled: !bulkImportOpen && !showShortcutsHelp,
  })


  const confirmSubmitAction = async () => {
    setConfirmAction(null)
    try {
      setLoading(true)

      let saved = null

      // The metadata no longer carries an Operation Date input: it is
      // resolved from the date captured inside the data-entry payload.
      const payload = {
        ...entry,
        operationDate:
          String(entry.operationDate || '').trim() || resolveOperationDate(entry),
      }

      if (editId === null) {
        saved = await createOperationEntry({ ...payload, status: 'Draft' })
        notifySuccess('Operation Entry saved successfully')
      } else {
        saved = await updateOperationEntry(editId, {
          ...payload,
          status: entry.status || 'Draft',
        })
        notifySuccess('Operation Entry updated successfully')
      }

      await reloadOperationEntries()
      if (typeof reloadOperationTransactions === 'function') {
        await reloadOperationTransactions()
      }

      // ✅ Auto navigation back to Barge Tracking only (events/comparisons are created on APPROVAL in backend)
      if (saved && prefill.fromBargeTracking) {
        const convoy = String(entry.convoyNumber || '').trim()
        if (!convoy) {
          notifyError(
            `Auto navigation skipped: Convoy Number is required for ${prefill.autoEventType || 'this barge stage'}`
          )
          setLoading(false)
          return
        }

        navigate(`/barge-tracking?convoy_number=${encodeURIComponent(convoy)}`)
        return
      }

      setEntry(emptyEntry)
      setEditId(null)
      setFieldErrors({})
    } catch (error) {
      notifyError(error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleEdit = (entryToEdit) => {
    if (!canCreateOperationEntry) {
      notifyError('You do not have permission to create operation entries')
      return
    }
    if (entryToEdit.status !== 'Draft' && entryToEdit.status !== 'Rejected') {
      notifyError('Only Draft or Rejected operation entries can be edited.')
      return
    }
    setConfirmAction({ type: 'edit', data: entryToEdit, message: 'Open this ticket for editing?\n\nAny current form changes will be replaced.' })
  }

  const confirmEditAction = () => {
    if (!confirmAction?.data) return
    const entryToEdit = confirmAction.data
    setConfirmAction(null)

    setEntry({
      linkedTicketId: entryToEdit.linkedTicketId || null,
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
    setFieldErrors({})
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleCloseEdit = () => {
    setConfirmAction({ type: 'closeEdit', message: 'Close editing window?\n\nAny unsaved changes will be lost.' })
  }

  const confirmCloseEditAction = () => {
    setConfirmAction(null)
    setEntry(emptyEntry)
    setEditId(null)
    setFieldErrors({})
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleDelete = async (entryId) => {
    setConfirmAction({ type: 'delete', data: entryId, message: 'Are you sure you want to cancel this Draft/Rejected operation entry? This will preserve the audit history.' })
  }

  const confirmDeleteAction = async () => {
    const entryId = confirmAction?.data
    setConfirmAction(null)
    if (!canCancelOperationTransaction) {
      notifyError('You do not have permission to cancel operation transactions')
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

      notifySuccess('Operation Entry cancelled successfully')
    } catch (error) {
      notifyError(error.message)
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
    setFieldErrors({})
  }
  const isShuttleTrackingLayout = useMemo(() => {
    return String(selectedTemplate?.entryLayoutType || '')
      .toLowerCase()
      .includes('shuttle tracking')
  }, [selectedTemplate])

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

  // Bulk upload may only use operation types the signed-in user can pick in the
  // form (location availability + Active). The dialog checks each row again.
  const bulkAllowedOperationTypeCodes = useMemo(() => {
    if (isAdminBootstrap || hasAllLocationsAccess) return null
    return new Set(
      availableOperationTypes.map((item) => normalizeCode(item.operationTypeCode))
    )
  }, [availableOperationTypes, isAdminBootstrap, hasAllLocationsAccess])

  const handleBulkImportComplete = async (summary) => {
    await reloadOperationEntries()
    if (typeof reloadOperationTransactions === 'function') {
      await reloadOperationTransactions()
    }
    if (summary?.success > 0) {
      notifySuccess(
        `${summary.success} draft ticket${summary.success === 1 ? '' : 's'} created by bulk upload. Review and submit them from the Operation Transaction Register.`
      )
    }
  }

  return (
    <div className="operation-entry-page">
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

        <div className="operation-entry-title-actions">
          <span className="record-count">
            {filteredEditableEntries.length} Editable Entries
          </span>

          {canCreateOperationEntry && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setBulkImportOpen(true)
                logUiAction('Operation Entry', 'Open Bulk Upload Dialog')
              }}
            >
              <Icon name="upload" size={15} />
              Bulk Upload Tickets
            </button>
          )}

          <button
            type="button"
            className="btn-secondary"
            onClick={() => setShowShortcutsHelp(true)}
            title="Keyboard shortcuts (?)"
          >
            <Icon name="help" size={13} />
            Shortcuts (?)
          </button>
        </div>
      </div>

      {!canCreateOperationEntry && (
        <div className="info-box">
          You have view-only access. Assign <strong>Create Operation Entry</strong> to create or edit tickets, and <strong>Cancel Operation Transaction</strong> to cancel them.
        </div>
      )}

      <form ref={entryFormRef} onSubmit={handleSubmit}>
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
            disabled={!canCreateOperationEntry || (isLinkedEntry && operationTypeChoices.length <= 1)}
          >
            <option value="">Select Operation Type</option>

            {operationTypeChoices.map((operationType) => (
              <option
                key={operationType.id}
                value={operationType.operationTypeCode}
                disabled={operationType.disabled}
              >
                {operationType.operationTypeName} (
                {operationType.operationTypeCode})
                {operationType.disabled ? ' - Not enabled for your location' : ''}
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
            disabled={!selectedOperationType || !canCreateOperationEntry || isLinkedEntry}
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
              disabled={!canCreateOperationEntry || isLinkedEntry}
            />
          </div>
        )}
        <div>
          <label>Sender *</label>
          <select
            name="senderLocationCode"
            value={entrySenderCode(entry)}
            onChange={handleChange}
            disabled={selectedAsset?.assetScope === 'Local' || !canCreateOperationEntry || isLinkedEntry}
          >
            <option value="">Select Sender Location</option>

            {(isLinkedEntry ? allActiveLocations : activeLocations).map((location) => (
              <option key={location.id} value={location.locationCode}>
                {location.locationName} ({location.locationCode})
              </option>
            ))}
          </select>
          <small>
            The terminal the movement starts from. This sets both the Origin and
            the Sender of the ticket.
          </small>
        </div>

        <div>
          <label>
            Receiver{' '}
            {!isShuttleTrackingLayout &&
            selectedOperationType?.requiresReceiverLocation === 'Yes'
              ? '*'
              : ''}
          </label>
          <select
            name="receiverLocationCode"
            value={entryReceiverCode(entry)}
            onChange={handleChange}
            disabled={!canCreateOperationEntry || isLinkedEntry}
          >
            <option value="">None</option>

            {allActiveLocations.map((location) => (
              <option key={location.id} value={location.locationCode}>
                {location.locationName} ({location.locationCode})
              </option>
            ))}
          </select>
          <small>
            The terminal the movement is addressed to. This sets both the
            Destination and the Receiver of the ticket.
          </small>
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
          fieldErrors={fieldErrors}
          setFieldErrors={setFieldErrors}
          notifyError={notifyError}
          notifySuccess={notifySuccess}
        />

        {/* Action feedback lives right next to the Save / Update button
            (owner rule 8) - never at the bottom of the page. */}
        <AlertMessage
          tone="success"
          message={feedback.successMsg}
          onDismiss={clearSuccess}
        />
        <AlertMessage
          tone="error"
          message={feedback.errorMsg}
          onDismiss={clearError}
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
              className="editable-entries-search"
              value={editableSearch}
              onChange={(e) => setEditableSearch(e.target.value)}
              placeholder="Search ticket / asset / sender / receiver / template / product…"
            />
          </div>
        </div>

        <div className="field-hint">
          {filteredEditableEntries.length} editable entr{filteredEditableEntries.length === 1 ? 'y' : 'ies'}
          {' '}match the current search.
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th>Ticket No.</th>
            <th>Operation Type</th>
            <th>Template</th>
            <th>Asset</th>
            <th>Sender</th>
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
                  {formatSenderLabel(item)}
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

                  <button type="button" className="btn-sm" onClick={() => cloneEntry(item)} disabled={!canCreateOperationEntry || loading} title="Clone this ticket into a new draft (mod+d when editing)">
                    Clone
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

      <PaginationControls
        currentPage={editablePage}
        totalRows={filteredEditableEntries.length}
        onPageChange={setEditablePage}
      />

      <div className="info-box">
        Operation Entry is for creating new tickets and editing Draft/Rejected
        tickets. The official full ticket list remains Operation Transaction
        Register.
      </div>

      {canCreateOperationEntry && (
        <OperationEntryBulkImportDialog
          open={bulkImportOpen}
          onClose={() => setBulkImportOpen(false)}
          operationTypes={operationTypes}
          operationTemplates={operationTemplates}
          locations={allActiveLocations}
          assets={assets}
          operationEntries={operationEntries}
          assetCalibrationTables={assetCalibrationTables}
          calibrationTemplates={calibrationTemplates}
          loggedInUser={loggedInUser}
          allowedOperationTypeCodes={bulkAllowedOperationTypeCodes}
          onComplete={handleBulkImportComplete}
        />
      )}

      <ShortcutsHelp
        open={showShortcutsHelp}
        onClose={() => setShowShortcutsHelp(false)}
        module="Operation Entry"
        shortcuts={[
          { key: 'mod+s', label: 'mod+s', action: 'Save the draft ticket' },
          { key: 'mod+enter', label: 'mod+enter', action: 'Save the draft ticket' },
          { key: 'escape', label: 'escape', action: 'Dismiss confirmation or cancel editing' },
          { key: 'mod+d', label: 'mod+d', action: 'Clone the ticket into a new draft (edit mode)' },
          { key: 'mod+/', label: 'mod+/', action: 'Focus the editable entries search' },
          { key: '?', label: '?', action: 'Open this shortcuts help' },
        ]}
      />
    </div>
  )
}

export default OperationEntry
