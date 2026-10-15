import { useState } from 'react'
import {
  createCalibrationTemplate,
  updateCalibrationTemplate,
  deleteCalibrationTemplate,
} from '../api/calibrationTemplateApi'
import PaginationControls, { paginateRows, usePageSize } from '../components/common/PaginationControls'
import DataTableToolbar from '../components/common/DataTableToolbar'
import { useDataFilters } from '../hooks/useDataFilters'
import { useAutoColumns } from '../hooks/useAutoColumns'
import { usePermissions } from '../hooks/usePermissions'
import AlertMessage from '../components/common/AlertMessage'
import useActionFeedback from '../hooks/useActionFeedback'

function CalibrationTemplateMaster({
  assetTypes,
  calibrationTemplates,
  reloadCalibrationTemplates,
  loggedInUser,
}) {
  const emptyTemplate = {
    templateName: '',
    assetTypeCode: '',
    calibrationType: '',
    description: '',
    status: 'Active',
    columns: [],
  }

  const emptyColumn = {
    columnName: '',
    dataType: '',
    unit: '',
    isRequired: 'Yes',
    interpolationRole: 'None',
    sortOrder: '',
  }

  const [template, setTemplate] = useState(emptyTemplate)
  const [column, setColumn] = useState(emptyColumn)
  const [editTemplateId, setEditTemplateId] = useState(null)
  const [showHelp, setShowHelp] = useState(false)
  const [loading, setLoading] = useState(false)
  // Action feedback: little pop-up (toast) + inline message near the
  // action area (owner rule 8) - never at the bottom of the page.
  const feedback = useActionFeedback()
  const { notifySuccess, notifyError, clearSuccess, clearError } = feedback
  const [validationErrors, setValidationErrors] = useState({})
  const [confirmRemoveColumnIndex, setConfirmRemoveColumnIndex] = useState(null)
  const [confirmDeleteItem, setConfirmDeleteItem] = useState(null)
  const [page, setPage] = useState(1)

  const pageSize = usePageSize()
  const calibrationTemplatesFilters = useDataFilters(calibrationTemplates, useAutoColumns(calibrationTemplates), { module: 'Calibration Template Master' })
  const visibleTemplates = paginateRows(calibrationTemplatesFilters.filteredRows, page, pageSize)

  const activeAssetTypes = assetTypes.filter((item) => item.status === 'Active')

  const { hasPermission } = usePermissions(loggedInUser)
  const canCreate = hasPermission('Create Calibration Template')
  const canEdit = hasPermission('Edit Calibration Template')
  const canDelete = hasPermission('Delete Calibration Template')
  const canWriteTemplate = canCreate || canEdit

  const handleTemplateChange = (e) => {
    setTemplate({
      ...template,
      [e.target.name]: e.target.value,
    })
  }

  const handleColumnChange = (e) => {
    setColumn({
      ...column,
      [e.target.name]: e.target.value,
    })
  }

  const handleAddColumn = () => {
    clearSuccess()
    clearError()
    setValidationErrors({})

    if (!canWriteTemplate) {
      notifyError(
        `You do not have permission to ${editTemplateId === null ? 'create' : 'edit'} calibration templates.`
      )
      return
    }

    const errors = {}

    if (column.columnName.trim() === '') {
      errors.columnName = 'Column Name is required'
    }

    if (column.dataType.trim() === '') {
      errors.dataType = 'Data Type is required'
    }

    if (!errors.columnName) {
      const columnAlreadyExists = template.columns.some((item) => {
        return item.columnName.toLowerCase() === column.columnName.toLowerCase()
      })

      if (columnAlreadyExists) {
        errors.columnName = 'Column already exists in this template.'
      }
    }

    setValidationErrors(errors)

    if (Object.keys(errors).length > 0) {
      return
    }

    const newColumn = {
      ...column,
      sortOrder:
        column.sortOrder.trim() === ''
          ? String(template.columns.length + 1)
          : column.sortOrder,
    }

    setTemplate({
      ...template,
      columns: [...template.columns, newColumn],
    })

    setColumn(emptyColumn)
  }

  const confirmRemoveColumn = () => {
    if (!canWriteTemplate) {
      notifyError(
        `You do not have permission to ${editTemplateId === null ? 'create' : 'edit'} calibration templates.`
      )
      return
    }

    const updatedColumns = template.columns.filter(
      (item, index) => index !== confirmRemoveColumnIndex
    )

    setTemplate({
      ...template,
      columns: updatedColumns,
    })

    setConfirmRemoveColumnIndex(null)
  }

  const validateTemplate = () => {
    const errors = {}

    if (template.templateName.trim() === '') {
      errors.templateName = 'Template Name is required'
    }

    if (template.assetTypeCode.trim() === '') {
      errors.assetTypeCode = 'Asset Type is required'
    }

    if (template.calibrationType.trim() === '') {
      errors.calibrationType = 'Calibration Type is required'
    }

    if (template.columns.length === 0) {
      errors.columns = 'Please add at least one template column'
    }

    if (!errors.templateName) {
      const templateAlreadyExists = calibrationTemplates.some((item) => {
        return (
          item.templateName.toLowerCase() ===
            template.templateName.toLowerCase() &&
          item.id !== editTemplateId
        )
      })

      if (templateAlreadyExists) {
        errors.templateName = 'Template Name already exists. Please choose another name.'
      }
    }

    if (template.columns.length > 0) {
      const requiredInputExists = template.columns.some((item) => {
        return item.interpolationRole === 'Input X'
      })

      const requiredOutputExists = template.columns.some((item) => {
        return item.interpolationRole === 'Output'
      })

      if (!requiredInputExists) {
        errors.interpolationRoles = 'At least one column must have Interpolation Role as Input X'
      }

      if (!requiredOutputExists) {
        errors.interpolationRoles = errors.interpolationRoles
          ? errors.interpolationRoles + ' and one as Output'
          : 'At least one column must have Interpolation Role as Output'
      }
    }

    setValidationErrors(errors)
    return Object.keys(errors).length === 0
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    clearSuccess()
    clearError()
    setValidationErrors({})

    if (!(editTemplateId === null ? canCreate : canEdit)) {
      notifyError(
        `You do not have permission to ${editTemplateId === null ? 'create' : 'edit'} calibration templates.`
      )
      return
    }

    if (!validateTemplate()) {
      return
    }

    try {
      setLoading(true)

      if (editTemplateId === null) {
        await createCalibrationTemplate(template)
        notifySuccess('Calibration template created successfully')
      } else {
        await updateCalibrationTemplate(editTemplateId, template)
        notifySuccess('Calibration template updated successfully')
      }

      await reloadCalibrationTemplates()

      setTemplate(emptyTemplate)
      setColumn(emptyColumn)
      setEditTemplateId(null)
    } catch (error) {
      notifyError(error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleEdit = (item) => {
    clearSuccess()
    clearError()

    if (!canEdit) {
      notifyError('You do not have permission to edit calibration templates.')
      return
    }

    setTemplate({
      templateName: item.templateName,
      assetTypeCode: item.assetTypeCode,
      calibrationType: item.calibrationType,
      description: item.description || '',
      status: item.status,
      columns: item.columns || [],
    })

    setEditTemplateId(item.id)
  }

  const handleDelete = async () => {
    clearSuccess()
    clearError()

    if (!canDelete) {
      notifyError('You do not have permission to delete calibration templates.')
      return
    }

    try {
      setLoading(true)
      await deleteCalibrationTemplate(confirmDeleteItem.id)
      await reloadCalibrationTemplates()

      if (editTemplateId === confirmDeleteItem.id) {
        setTemplate(emptyTemplate)
        setColumn(emptyColumn)
        setEditTemplateId(null)
      }

      setConfirmDeleteItem(null)
      notifySuccess('Calibration template deleted successfully')
    } catch (error) {
      notifyError(error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleCancelEdit = () => {
    setTemplate(emptyTemplate)
    setColumn(emptyColumn)
    setEditTemplateId(null)
  }

  /* -------------------------------------------------------- bulk upload */

  const CALIBRATION_TYPES = [
    'Tank Ullage Table',
    'Tank Sounding Table',
    'Tank Capacity Table',
    'Trim Correction Table',
    'Heel/List Correction Table',
    'Meter Proving Table',
    'Meter Factor Table',
    'Temperature Correction Table',
    'Density Correction Table',
    'Other',
  ]
  const TEMPLATE_STATUSES = ['Active', 'Inactive', 'Blocked']

  const importConfig = {
    title: 'Bulk upload calibration templates',
    description:
      'Upload an Excel (.xlsx) or CSV file with one row per calibration template. This creates the template header; add its columns on the template itself. Existing template names are updated.',
    templateFileName: 'calibration-template-master',
    fields: [
      {
        key: 'templateName',
        label: 'Template Name',
        required: true,
        example: 'Tank Strapping Table',
        aliases: ['Name'],
      },
      {
        key: 'assetTypeCode',
        label: 'Asset Type Code',
        required: true,
        example: 'TANK',
        aliases: ['Asset Type'],
      },
      {
        key: 'calibrationType',
        label: 'Calibration Type',
        required: true,
        options: CALIBRATION_TYPES,
        example: 'Tank Ullage Table',
      },
      { key: 'description', label: 'Description', example: '' },
      {
        key: 'status',
        label: 'Status',
        options: TEMPLATE_STATUSES,
        defaultValue: 'Active',
        example: 'Active',
      },
    ],
    validateRow: (record) => {
      if (!activeAssetTypes.some((item) => item.assetTypeCode === String(record.assetTypeCode).trim())) {
        return `Unknown or inactive asset type code "${record.assetTypeCode}"`
      }
      if (!CALIBRATION_TYPES.includes(String(record.calibrationType).trim())) {
        return `Calibration Type must be one of ${CALIBRATION_TYPES.join(', ')}`
      }
      if (record.status && !TEMPLATE_STATUSES.includes(record.status)) {
        return `Status must be one of ${TEMPLATE_STATUSES.join(', ')}`
      }
      return null
    },
    onImportRow: async (record) => {
      const payload = {
        ...emptyTemplate,
        ...record,
        status: record.status || 'Active',
        columns: [],
      }
      const existing = calibrationTemplates.find(
        (item) => String(item.templateName).toLowerCase() === String(payload.templateName).toLowerCase()
      )
      if (existing) {
        // Never wipe the columns of an existing template from a bulk upload.
        await updateCalibrationTemplate(existing.id, { ...payload, columns: existing.columns || [] })
      } else {
        await createCalibrationTemplate(payload)
      }
    },
    onComplete: async () => {
      await reloadCalibrationTemplates()
    },
  }

  const getAssetTypeName = (assetTypeCode) => {
    const selectedAssetType = assetTypes.find(
      (item) => item.assetTypeCode === assetTypeCode
    )

    if (!selectedAssetType) {
      return ''
    }

    return selectedAssetType.assetTypeName
  }

  return (
    <div>
      <div className="page-title">
        <div>
          <div className="title-with-help">
            <h2>Calibration Template Master</h2>

            <button
              type="button"
              className="help-icon-button"
              onClick={() => setShowHelp(true)}
              title="Help"
            >
              ?
            </button>
          </div>

          <p>
            Define soft-coded XLSX/CSV structures for calibration table uploads.
          </p>
        </div>

        <span className="record-count">
          {calibrationTemplates.length} Templates
        </span>
      </div>
      {/* Action feedback: right next to the page actions + a little pop-up
          toast - never at the bottom of the page (owner rule 8). */}
      <AlertMessage tone="success" message={feedback.successMsg} onDismiss={clearSuccess} />
      <AlertMessage tone="error" message={feedback.errorMsg} onDismiss={clearError} />

      {showHelp && (
        <div className="help-modal-overlay">
          <div className="help-modal">
            <div className="help-modal-header">
              <h3>Interpolation Role Help</h3>

              <button
                type="button"
                className="help-close-button"
                onClick={() => setShowHelp(false)}
              >
                ×
              </button>
            </div>

            <div className="help-modal-body">
              <p>
                The interpolation role tells the system how each uploaded
                calibration table column should be used during future
                calculations.
              </p>

              <div className="help-section">
                <h4>Simple Tank Ullage Example</h4>

                <table>
                  <thead>
                    <tr>
                      <th>Column Name</th>
                      <th>Sample Value</th>
                      <th>Interpolation Role</th>
                    </tr>
                  </thead>

                  <tbody>
                    <tr>
                      <td>Tank Name</td>
                      <td>Tank 101</td>
                      <td>Reference</td>
                    </tr>
                    <tr>
                      <td>Dip</td>
                      <td>25 cm</td>
                      <td>Input X</td>
                    </tr>
                    <tr>
                      <td>Volume</td>
                      <td>?</td>
                      <td>Output</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="help-section">
                <h4>Two-Dimensional Correction Example</h4>

                <table>
                  <thead>
                    <tr>
                      <th>Column Name</th>
                      <th>Sample Value</th>
                      <th>Interpolation Role</th>
                    </tr>
                  </thead>

                  <tbody>
                    <tr>
                      <td>Ullage</td>
                      <td>2.5 m</td>
                      <td>Input X</td>
                    </tr>
                    <tr>
                      <td>Trim</td>
                      <td>0.4 m</td>
                      <td>Input Y</td>
                    </tr>
                    <tr>
                      <td>Correction</td>
                      <td>?</td>
                      <td>Correction</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="info-box">
                Rule: every template must have at least one Input X column and
                one Output column for future interpolation.
              </div>
            </div>
          </div>
        </div>
      )}

      {!canCreate && !canEdit && !canDelete && (
        <div className="info-box">
          You have View Calibration Template permission only. Create, edit, and
          delete actions are disabled.
        </div>
      )}

      {confirmRemoveColumnIndex !== null && (
        <div className="confirm-overlay">
          <div className="confirm-box">
            <p>Are you sure you want to remove this column?</p>
            <div className="confirm-actions">
              <button onClick={confirmRemoveColumn}>Yes, Remove</button>
              <button onClick={() => setConfirmRemoveColumnIndex(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {confirmDeleteItem && (
        <div className="confirm-overlay">
          <div className="confirm-box">
            <p>Are you sure you want to delete this calibration template?</p>
            <div className="confirm-actions">
              <button onClick={handleDelete} disabled={loading}>
                {loading ? 'Deleting...' : 'Yes, Delete'}
              </button>
              <button onClick={() => setConfirmDeleteItem(null)} disabled={loading}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {validationErrors.interpolationRoles && (
        <div className="error-box">{validationErrors.interpolationRoles}</div>
      )}

      {canWriteTemplate && (
        <>
        <form onSubmit={handleSubmit}>
          <div>
            <label>Template Name</label>
            <input
              name="templateName"
              type="text"
              value={template.templateName}
              onChange={(e) => { handleTemplateChange(e); setValidationErrors({ ...validationErrors, templateName: '' }) }}
              placeholder="Example: Tank Ullage Table Template"
              className={validationErrors.templateName ? 'input-error' : ''}
            />
            {validationErrors.templateName && (
              <span className="field-error">{validationErrors.templateName}</span>
            )}
          </div>

          <div>
            <label>Asset Type</label>
            <select
              name="assetTypeCode"
              value={template.assetTypeCode}
              onChange={(e) => { handleTemplateChange(e); setValidationErrors({ ...validationErrors, assetTypeCode: '' }) }}
              className={validationErrors.assetTypeCode ? 'input-error' : ''}
            >
              <option value="">Select Asset Type</option>

              {activeAssetTypes.map((item) => (
                <option key={item.id} value={item.assetTypeCode}>
                  {item.assetTypeName} ({item.assetTypeCode})
                </option>
              ))}
            </select>
            {validationErrors.assetTypeCode && (
              <span className="field-error">{validationErrors.assetTypeCode}</span>
            )}
          </div>

          <div>
            <label>Calibration Type</label>
            <select
              name="calibrationType"
              value={template.calibrationType}
              onChange={(e) => { handleTemplateChange(e); setValidationErrors({ ...validationErrors, calibrationType: '' }) }}
              className={validationErrors.calibrationType ? 'input-error' : ''}
            >
              <option value="">Select Calibration Type</option>
              <option>Tank Ullage Table</option>
              <option>Tank Sounding Table</option>
              <option>Tank Capacity Table</option>
              <option>Trim Correction Table</option>
              <option>Heel/List Correction Table</option>
              <option>Meter Proving Table</option>
              <option>Meter Factor Table</option>
              <option>Temperature Correction Table</option>
              <option>Density Correction Table</option>
              <option>Other</option>
            </select>
            {validationErrors.calibrationType && (
              <span className="field-error">{validationErrors.calibrationType}</span>
            )}
          </div>

          <div>
            <label>Status</label>
            <select
              name="status"
              value={template.status}
              onChange={handleTemplateChange}
            >
              <option>Active</option>
              <option>Inactive</option>
              <option>Blocked</option>
            </select>
          </div>

          <div className="full-width-field">
            <label>Description</label>
            <textarea
              name="description"
              value={template.description}
              onChange={handleTemplateChange}
              placeholder="Enter template description"
              rows="3"
            />
          </div>

          <div className="full-width-field">
            <div className="section-title compact-section-title">
              <div className="title-with-help">
                <h3>Template Column Definition</h3>

                <button
                  type="button"
                  className="small-help-icon-button"
                  onClick={() => setShowHelp(true)}
                  title="Interpolation Role Help"
                >
                  ?
                </button>
              </div>

              <p>
                Define the expected columns in the uploaded XLSX/CSV calibration
                file.
              </p>
            </div>
          </div>

          <div>
            <label>Column Name</label>
            <input
              name="columnName"
              type="text"
              value={column.columnName}
              onChange={(e) => { handleColumnChange(e); setValidationErrors({ ...validationErrors, columnName: '' }) }}
              placeholder="Example: Ullage"
              className={validationErrors.columnName ? 'input-error' : ''}
            />
            {validationErrors.columnName && (
              <span className="field-error">{validationErrors.columnName}</span>
            )}
          </div>

          <div>
            <label>Data Type</label>
            <select
              name="dataType"
              value={column.dataType}
              onChange={(e) => { handleColumnChange(e); setValidationErrors({ ...validationErrors, dataType: '' }) }}
              className={validationErrors.dataType ? 'input-error' : ''}
            >
              <option value="">Select Data Type</option>
              <option>Text</option>
              <option>Number</option>
              <option>Date</option>
              <option>Boolean</option>
            </select>
            {validationErrors.dataType && (
              <span className="field-error">{validationErrors.dataType}</span>
            )}
          </div>

          <div>
            <label>Unit</label>
            <input
              name="unit"
              type="text"
              value={column.unit}
              onChange={handleColumnChange}
              placeholder="Example: m, m3, bbl"
            />
          </div>

          <div>
            <label>Required</label>
            <select
              name="isRequired"
              value={column.isRequired}
              onChange={handleColumnChange}
            >
              <option>Yes</option>
              <option>No</option>
            </select>
          </div>

          <div>
            <label>Interpolation Role</label>
            <select
              name="interpolationRole"
              value={column.interpolationRole}
              onChange={handleColumnChange}
            >
              <option>None</option>
              <option>Reference</option>
              <option>Input X</option>
              <option>Input Y</option>
              <option>Output</option>
              <option>Correction</option>
            </select>
          </div>

          <div>
            <label>Sort Order</label>
            <input
              name="sortOrder"
              type="number"
              value={column.sortOrder}
              onChange={handleColumnChange}
              placeholder="Example: 1"
            />
          </div>

          <div className="form-actions">
            <button type="button" onClick={handleAddColumn}>
              Add Column
            </button>
          </div>

          {validationErrors.columns && (
            <div className="full-width-field">
              <span className="field-error">{validationErrors.columns}</span>
            </div>
          )}

          {template.columns.length > 0 && (
            <div className="full-width-field">
              <div className="section-title compact-section-title">
                <h3>Columns Added</h3>
                <p>Review the columns before saving the template.</p>
              </div>

              <table>
                <thead>
                  <tr>
                    <th>Column Name</th>
                    <th>Data Type</th>
                    <th>Unit</th>
                    <th>Required</th>
                    <th>Interpolation Role</th>
                    <th>Sort Order</th>
                    <th>Actions</th>
                  </tr>
                </thead>

                <tbody>
                  {template.columns
                    .sort(
                      (a, b) => Number(a.sortOrder) - Number(b.sortOrder)
                    )
                    .map((columnItem, columnIndex) => (
                      <tr key={columnIndex}>
                        <td>{columnItem.columnName}</td>
                        <td>{columnItem.dataType}</td>
                        <td>{columnItem.unit}</td>
                        <td>{columnItem.isRequired}</td>
                        <td>
                          <span className="permission-badge">
                            {columnItem.interpolationRole}
                          </span>
                        </td>
                        <td>{columnItem.sortOrder}</td>
                        <td>
                          <button
                            type="button"
                            onClick={() => { clearSuccess(); clearError(); setConfirmRemoveColumnIndex(columnIndex) }}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="form-actions">
            <button type="submit" disabled={loading}>
              {loading
                ? 'Saving...'
                : editTemplateId === null
                  ? 'Save Template'
                  : 'Update Template'}
            </button>

            {editTemplateId !== null && (
              <button type="button" onClick={handleCancelEdit}>
                Cancel Edit
              </button>
            )}
          </div>
        </form>

      </>
      )}

      <div className="section-title">
        <h3>Saved Calibration Templates</h3>
        <p>
          These templates will later be used to validate uploaded XLSX/CSV
          calibration files.
        </p>
      </div>

      <DataTableToolbar
        filters={calibrationTemplatesFilters}
        columns={calibrationTemplatesFilters.columns}
        exportFileName="calibration-template-master"
        exportTitle="Calibration Template Master"
        module="Calibration Template Master"
        importConfig={importConfig}
        canImport={canCreate}
      />

      <table>
        <thead>
          <tr>
            <th>Template Name</th>
            <th>Asset Type</th>
            <th>Calibration Type</th>
            <th>Columns</th>
            <th>Status</th>
            {(canEdit || canDelete) && <th>Actions</th>}
          </tr>
        </thead>

        <tbody>
          {calibrationTemplates.length === 0 ? (
            <tr>
              <td
                colSpan={canEdit || canDelete ? 6 : 5}
                className="empty-table"
              >
                No calibration templates added yet.
              </td>
            </tr>
          ) : (
            visibleTemplates.map((item) => (
              <tr key={item.id}>
                <td>{item.templateName}</td>
                <td>
                  {getAssetTypeName(item.assetTypeCode)} ({item.assetTypeCode})
                </td>
                <td>{item.calibrationType}</td>
                <td>
                  <div className="permission-list">
                    {[...(item.columns || [])]
                      .sort(
                        (a, b) => Number(a.sortOrder) - Number(b.sortOrder)
                      )
                      .map((columnItem, columnIndex) => (
                        <span key={columnIndex} className="permission-badge">
                          {columnItem.columnName}
                        </span>
                      ))}
                  </div>
                </td>
                <td>
                  <span className={`status-badge ${item.status.toLowerCase()}`}>
                    {item.status}
                  </span>
                </td>

                {(canEdit || canDelete) && (
                  <td>
                    {canEdit && (
                      <button type="button" onClick={() => handleEdit(item)}>
                        Edit
                      </button>
                    )}

                    {canDelete && (
                      <button type="button" onClick={() => { clearSuccess(); clearError(); setConfirmDeleteItem(item) }}>
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

      <PaginationControls
        currentPage={page}
        totalRows={calibrationTemplatesFilters.filteredRows.length}
        onPageChange={setPage}
      />

      <div className="info-box">
        Rule: every template must have at least one Input X column and one Output
        column for future interpolation.
      </div>
    </div>
  )
}

export default CalibrationTemplateMaster