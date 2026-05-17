import { useState } from 'react'
import {
  createCalibrationTemplate,
  updateCalibrationTemplate,
  deleteCalibrationTemplate,
} from '../api/calibrationTemplateApi'

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

  const activeAssetTypes = assetTypes.filter((item) => item.status === 'Active')

  const hasPermission = (permissionName) => {
    if (!loggedInUser || !loggedInUser.permissions) {
      return false
    }

    return loggedInUser.permissions.some((permission) => {
      return permission.permissionName === permissionName
    })
  }

  const canManageCalibrationTemplate = hasPermission(
    'Manage Calibration Template'
  )

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
    if (!canManageCalibrationTemplate) {
      alert('You do not have permission to manage calibration templates.')
      return
    }

    if (column.columnName.trim() === '') {
      alert('Column Name is required')
      return
    }

    if (column.dataType.trim() === '') {
      alert('Data Type is required')
      return
    }

    const columnAlreadyExists = template.columns.some((item) => {
      return item.columnName.toLowerCase() === column.columnName.toLowerCase()
    })

    if (columnAlreadyExists) {
      alert('Column already exists in this template.')
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

  const handleRemoveColumn = (indexToRemove) => {
    if (!canManageCalibrationTemplate) {
      alert('You do not have permission to manage calibration templates.')
      return
    }

    const confirmRemove = window.confirm(
      'Are you sure you want to remove this column?'
    )

    if (confirmRemove === false) {
      return
    }

    const updatedColumns = template.columns.filter(
      (item, index) => index !== indexToRemove
    )

    setTemplate({
      ...template,
      columns: updatedColumns,
    })
  }

  const validateTemplate = () => {
    if (template.templateName.trim() === '') {
      alert('Template Name is required')
      return false
    }

    if (template.assetTypeCode.trim() === '') {
      alert('Asset Type is required')
      return false
    }

    if (template.calibrationType.trim() === '') {
      alert('Calibration Type is required')
      return false
    }

    if (template.columns.length === 0) {
      alert('Please add at least one template column')
      return false
    }

    const templateAlreadyExists = calibrationTemplates.some((item) => {
      return (
        item.templateName.toLowerCase() ===
          template.templateName.toLowerCase() &&
        item.id !== editTemplateId
      )
    })

    if (templateAlreadyExists) {
      alert('Template Name already exists. Please choose another name.')
      return false
    }

    const requiredOutputExists = template.columns.some((item) => {
      return item.interpolationRole === 'Output'
    })

    const requiredInputExists = template.columns.some((item) => {
      return item.interpolationRole === 'Input X'
    })

    if (!requiredInputExists) {
      alert('At least one column must have Interpolation Role as Input X')
      return false
    }

    if (!requiredOutputExists) {
      alert('At least one column must have Interpolation Role as Output')
      return false
    }

    return true
  }

  const handleSubmit = async (e) => {
    e.preventDefault()

    if (!canManageCalibrationTemplate) {
      alert('You do not have permission to manage calibration templates.')
      return
    }

    if (!validateTemplate()) {
      return
    }

    try {
      setLoading(true)

      if (editTemplateId === null) {
        await createCalibrationTemplate(template)
        alert('Calibration template created successfully')
      } else {
        await updateCalibrationTemplate(editTemplateId, template)
        alert('Calibration template updated successfully')
      }

      await reloadCalibrationTemplates()

      setTemplate(emptyTemplate)
      setColumn(emptyColumn)
      setEditTemplateId(null)
    } catch (error) {
      alert(error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleEdit = (item) => {
    if (!canManageCalibrationTemplate) {
      alert('You do not have permission to manage calibration templates.')
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

  const handleDelete = async (item) => {
    if (!canManageCalibrationTemplate) {
      alert('You do not have permission to manage calibration templates.')
      return
    }

    const confirmDelete = window.confirm(
      'Are you sure you want to delete this calibration template?'
    )

    if (confirmDelete === false) {
      return
    }

    try {
      setLoading(true)
      await deleteCalibrationTemplate(item.id)
      await reloadCalibrationTemplates()

      if (editTemplateId === item.id) {
        setTemplate(emptyTemplate)
        setColumn(emptyColumn)
        setEditTemplateId(null)
      }

      alert('Calibration template deleted successfully')
    } catch (error) {
      alert(error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleCancelEdit = () => {
    setTemplate(emptyTemplate)
    setColumn(emptyColumn)
    setEditTemplateId(null)
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

      {!canManageCalibrationTemplate && (
        <div className="info-box">
          You have View Calibration Template permission only. Create, edit, and
          delete actions are disabled.
        </div>
      )}

      {canManageCalibrationTemplate && (
        <form onSubmit={handleSubmit}>
          <div>
            <label>Template Name</label>
            <input
              name="templateName"
              type="text"
              value={template.templateName}
              onChange={handleTemplateChange}
              placeholder="Example: Tank Ullage Table Template"
            />
          </div>

          <div>
            <label>Asset Type</label>
            <select
              name="assetTypeCode"
              value={template.assetTypeCode}
              onChange={handleTemplateChange}
            >
              <option value="">Select Asset Type</option>

              {activeAssetTypes.map((item) => (
                <option key={item.id} value={item.assetTypeCode}>
                  {item.assetTypeName} ({item.assetTypeCode})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label>Calibration Type</label>
            <select
              name="calibrationType"
              value={template.calibrationType}
              onChange={handleTemplateChange}
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
              onChange={handleColumnChange}
              placeholder="Example: Ullage"
            />
          </div>

          <div>
            <label>Data Type</label>
            <select
              name="dataType"
              value={column.dataType}
              onChange={handleColumnChange}
            >
              <option value="">Select Data Type</option>
              <option>Text</option>
              <option>Number</option>
              <option>Date</option>
              <option>Boolean</option>
            </select>
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
                            onClick={() => handleRemoveColumn(columnIndex)}
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
      )}

      <div className="section-title">
        <h3>Saved Calibration Templates</h3>
        <p>
          These templates will later be used to validate uploaded XLSX/CSV
          calibration files.
        </p>
      </div>

      <table>
        <thead>
          <tr>
            <th>Template Name</th>
            <th>Asset Type</th>
            <th>Calibration Type</th>
            <th>Columns</th>
            <th>Status</th>
            {canManageCalibrationTemplate && <th>Actions</th>}
          </tr>
        </thead>

        <tbody>
          {calibrationTemplates.length === 0 ? (
            <tr>
              <td
                colSpan={canManageCalibrationTemplate ? 6 : 5}
                className="empty-table"
              >
                No calibration templates added yet.
              </td>
            </tr>
          ) : (
            calibrationTemplates.map((item) => (
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

                {canManageCalibrationTemplate && (
                  <td>
                    <button type="button" onClick={() => handleEdit(item)}>
                      Edit
                    </button>

                    <button type="button" onClick={() => handleDelete(item)}>
                      Delete
                    </button>
                  </td>
                )}
              </tr>
            ))
          )}
        </tbody>
      </table>

      <div className="info-box">
        Rule: every template must have at least one Input X column and one Output
        column for future interpolation.
      </div>
    </div>
  )
}

export default CalibrationTemplateMaster