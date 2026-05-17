import { useState } from 'react'
import {
  createOperationTemplate,
  deleteOperationTemplate,
  updateOperationTemplate,
} from '../api/operationTemplateApi'

function OperationTemplateMaster({
  operationTypes,
  operationTemplates,
  reloadOperationTemplates,
}) {
  const emptyTemplate = {
    templateName: '',
    operationTypeCode: '',
    entryLayoutType: 'Standard Form',
    calculationEngine: 'None',
    description: '',
    status: 'Active',
    fields: [],
  }

  const emptyField = {
    fieldName: '',
    fieldCode: '',
    fieldGroup: 'General',
    dataType: '',
    unit: '',
    isRequired: 'Yes',
    inputMode: 'Manual',
    calculationRole: 'Input',
    sortOrder: '',
    status: 'Active',
  }

  const [template, setTemplate] = useState(emptyTemplate)
  const [field, setField] = useState(emptyField)
  const [editId, setEditId] = useState(null)
  const [loading, setLoading] = useState(false)
  const [showHelp, setShowHelp] = useState(false)

  const activeOperationTypes = operationTypes.filter(
    (item) => item.status === 'Active'
  )

  const handleTemplateChange = (e) => {
    setTemplate({
      ...template,
      [e.target.name]: e.target.value,
    })
  }

  const handleFieldChange = (e) => {
    setField({
      ...field,
      [e.target.name]: e.target.value,
    })
  }

  const handleAddField = () => {
    if (field.fieldName.trim() === '') {
      alert('Field Name is required')
      return
    }

    if (field.fieldCode.trim() === '') {
      alert('Field Code is required')
      return
    }

    if (field.dataType.trim() === '') {
      alert('Data Type is required')
      return
    }

    const duplicateFieldCode = template.fields.some((item) => {
      return item.fieldCode.toLowerCase() === field.fieldCode.toLowerCase()
    })

    if (duplicateFieldCode) {
      alert('Field Code already exists in this template.')
      return
    }

    const duplicateFieldName = template.fields.some((item) => {
      return item.fieldName.toLowerCase() === field.fieldName.toLowerCase()
    })

    if (duplicateFieldName) {
      alert('Field Name already exists in this template.')
      return
    }

    const newField = {
      ...field,
      sortOrder:
        field.sortOrder.trim() === ''
          ? String(template.fields.length + 1)
          : field.sortOrder,
    }

    setTemplate({
      ...template,
      fields: [...template.fields, newField],
    })

    setField(emptyField)
  }

  const handleRemoveField = (indexToRemove) => {
    const confirmRemove = window.confirm(
      'Are you sure you want to remove this field?'
    )

    if (confirmRemove === false) {
      return
    }

    setTemplate({
      ...template,
      fields: template.fields.filter((item, index) => index !== indexToRemove),
    })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()

    if (template.templateName.trim() === '') {
      alert('Template Name is required')
      return
    }

    if (template.operationTypeCode.trim() === '') {
      alert('Operation Type is required')
      return
    }

    if (template.fields.length === 0) {
      alert('Please add at least one operation template field')
      return
    }

    const duplicateTemplate = operationTemplates.some((item) => {
      return (
        item.templateName.toLowerCase() === template.templateName.toLowerCase() &&
        item.id !== editId
      )
    })

    if (duplicateTemplate) {
      alert('Operation Template Name already exists.')
      return
    }

    try {
      setLoading(true)

      if (editId === null) {
        await createOperationTemplate(template)
        alert('Operation Template saved successfully')
      } else {
        await updateOperationTemplate(editId, template)
        alert('Operation Template updated successfully')
      }

      await reloadOperationTemplates()
      setTemplate(emptyTemplate)
      setField(emptyField)
      setEditId(null)
    } catch (error) {
      alert(error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleEdit = (templateToEdit) => {
    setTemplate({
      templateName: templateToEdit.templateName,
      operationTypeCode: templateToEdit.operationTypeCode,
      entryLayoutType: templateToEdit.entryLayoutType || 'Standard Form',
      calculationEngine: templateToEdit.calculationEngine || 'None',
      description: templateToEdit.description,
      status: templateToEdit.status,
      fields: templateToEdit.fields,
    })

    setField(emptyField)
    setEditId(templateToEdit.id)
  }

  const handleDelete = async (templateId) => {
    const confirmDelete = window.confirm(
      'Are you sure you want to delete this operation template?'
    )

    if (confirmDelete === false) {
      return
    }

    try {
      setLoading(true)

      await deleteOperationTemplate(templateId)
      await reloadOperationTemplates()

      if (editId === templateId) {
        setTemplate(emptyTemplate)
        setField(emptyField)
        setEditId(null)
      }

      alert('Operation Template deleted successfully')
    } catch (error) {
      alert(error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleCancelEdit = () => {
    setTemplate(emptyTemplate)
    setField(emptyField)
    setEditId(null)
  }

  const getOperationTypeName = (operationTypeCode) => {
    const operationType = operationTypes.find(
      (item) => item.operationTypeCode === operationTypeCode
    )

    if (!operationType) {
      return ''
    }

    return operationType.operationTypeName
  }

  return (
    <div>
      <div className="page-title">
        <div>
          <div className="title-with-help">
            <h2>Operation Template Master</h2>

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
            Define data-entry fields, input modes, and calculation roles for
            each operation type.
          </p>
        </div>

        <span className="record-count">
          {operationTemplates.length} Templates
        </span>
      </div>

      {showHelp && (
        <div className="help-modal-overlay">
          <div className="help-modal">
            <div className="help-modal-header">
              <h3>Operation Template Help</h3>

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
                Operation Templates define what fields appear in operation data
                entry screens. This allows Tank, Barge, Vessel, FSO, and
                Flowmeter operations to have different field structures.
              </p>

              <div className="help-section">
                <h4>Input Mode</h4>
                <ul>
                  <li>
                    <strong>Manual:</strong> User enters the value.
                  </li>
                  <li>
                    <strong>Calculated:</strong> System calculates the value.
                  </li>
                  <li>
                    <strong>Lookup:</strong> System picks value from another
                    table, such as calibration data.
                  </li>
                  <li>
                    <strong>System:</strong> System generated value, such as
                    ticket number or timestamp.
                  </li>
                </ul>
              </div>

              <div className="help-section">
                <h4>Calculation Role</h4>
                <ul>
                  <li>
                    <strong>Input:</strong> Field used as calculation input.
                  </li>
                  <li>
                    <strong>Output:</strong> Final calculated result.
                  </li>
                  <li>
                    <strong>Correction:</strong> Adjustment or correction value.
                  </li>
                  <li>
                    <strong>Comparison:</strong> Sender/receiver comparison
                    value.
                  </li>
                  <li>
                    <strong>Reference:</strong> Informational field.
                  </li>
                  <li>
                    <strong>Approval:</strong> Approval-related field.
                  </li>
                </ul>
              </div>

              <div className="help-section">
                <h4>Example Tank Fields</h4>
                <table>
                  <thead>
                    <tr>
                      <th>Field Name</th>
                      <th>Input Mode</th>
                      <th>Role</th>
                    </tr>
                  </thead>

                  <tbody>
                    <tr>
                      <td>Opening Ullage</td>
                      <td>Manual</td>
                      <td>Input</td>
                    </tr>
                    <tr>
                      <td>Opening Volume</td>
                      <td>Lookup</td>
                      <td>Output</td>
                    </tr>
                    <tr>
                      <td>Gross Quantity</td>
                      <td>Calculated</td>
                      <td>Output</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeOperationTypes.length === 0 && (
        <div className="info-box">
          Please create at least one active Operation Type before creating
          operation templates.
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div>
          <label>Template Name</label>
          <input
            name="templateName"
            type="text"
            value={template.templateName}
            onChange={handleTemplateChange}
            placeholder="Example: Tank Operation Template"
          />
        </div>

        <div>
          <label>Operation Type</label>
          <select
            name="operationTypeCode"
            value={template.operationTypeCode}
            onChange={handleTemplateChange}
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
          <label>Entry Layout Type</label>
          <select
            name="entryLayoutType"
            value={template.entryLayoutType}
            onChange={handleTemplateChange}
          >
            <option>Standard Form</option>
            <option>Tank Gauging</option>
            <option>Multi-Tank Before/After</option>
            <option>Tanker Loading</option>
            <option>Vessel Cycle</option>
            <option>Stock Movement</option>
            <option>Meter Reading</option>
          </select>
        </div>

        <div>
          <label>Calculation Engine</label>
          <select
            name="calculationEngine"
            value={template.calculationEngine}
            onChange={handleTemplateChange}
          >
            <option>None</option>
            <option>Tank Quantity</option>
            <option>Barge Before/After Quantity</option>
            <option>Tanker Quantity</option>
            <option>Vessel Cycle Quantity</option>
            <option>Stock Movement Net/Variance</option>
            <option>Meter Reading Quantity</option>
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
            <h3>Field Definition</h3>
            <p>
              Add the fields that should appear in the operation data entry
              screen.
            </p>
          </div>
        </div>

        <div>
          <label>Field Name</label>
          <input
            name="fieldName"
            type="text"
            value={field.fieldName}
            onChange={handleFieldChange}
            placeholder="Example: Opening Ullage"
          />
        </div>

        <div>
          <label>Field Code</label>
          <input
            name="fieldCode"
            type="text"
            value={field.fieldCode}
            onChange={handleFieldChange}
            placeholder="Example: opening_ullage"
          />
        </div>

        <div>
          <label>Field Group</label>
          <select
            name="fieldGroup"
            value={field.fieldGroup}
            onChange={handleFieldChange}
          >
            <option>General</option>
            <option>Sender</option>
            <option>Receiver</option>
            <option>Calculation</option>
            <option>Comparison</option>
            <option>Approval</option>
          </select>
        </div>

        <div>
          <label>Data Type</label>
          <select
            name="dataType"
            value={field.dataType}
            onChange={handleFieldChange}
          >
            <option value="">Select Data Type</option>
            <option>Text</option>
            <option>Number</option>
            <option>Date</option>
            <option>DateTime</option>
            <option>Boolean</option>
            <option>JSON</option>
          </select>
        </div>

        <div>
          <label>Unit</label>
          <input
            name="unit"
            type="text"
            value={field.unit}
            onChange={handleFieldChange}
            placeholder="Example: m, bbl, m3, °C"
          />
        </div>

        <div>
          <label>Required</label>
          <select
            name="isRequired"
            value={field.isRequired}
            onChange={handleFieldChange}
          >
            <option>Yes</option>
            <option>No</option>
          </select>
        </div>

        <div>
          <label>Input Mode</label>
          <select
            name="inputMode"
            value={field.inputMode}
            onChange={handleFieldChange}
          >
            <option>Manual</option>
            <option>Calculated</option>
            <option>Lookup</option>
            <option>System</option>
          </select>
        </div>

        <div>
          <label>Calculation Role</label>
          <select
            name="calculationRole"
            value={field.calculationRole}
            onChange={handleFieldChange}
          >
            <option>Input</option>
            <option>Output</option>
            <option>Correction</option>
            <option>Comparison</option>
            <option>Reference</option>
            <option>Approval</option>
          </select>
        </div>

        <div>
          <label>Sort Order</label>
          <input
            name="sortOrder"
            type="number"
            value={field.sortOrder}
            onChange={handleFieldChange}
            placeholder="Example: 1"
          />
        </div>

        <div>
          <label>Field Status</label>
          <select
            name="status"
            value={field.status}
            onChange={handleFieldChange}
          >
            <option>Active</option>
            <option>Inactive</option>
            <option>Blocked</option>
          </select>
        </div>

        <div className="form-actions">
          <button type="button" onClick={handleAddField} disabled={loading}>
            Add Field
          </button>
        </div>

        <div className="full-width-field">
          <table>
            <thead>
              <tr>
                <th>Field Name</th>
                <th>Code</th>
                <th>Group</th>
                <th>Type</th>
                <th>Unit</th>
                <th>Required</th>
                <th>Input Mode</th>
                <th>Role</th>
                <th>Sort</th>
                <th>Action</th>
              </tr>
            </thead>

            <tbody>
              {template.fields.length === 0 ? (
                <tr>
                  <td colSpan="10" className="empty-table">
                    No fields added yet.
                  </td>
                </tr>
              ) : (
                template.fields.map((item, index) => (
                  <tr key={index}>
                    <td>{item.fieldName}</td>
                    <td>{item.fieldCode}</td>
                    <td>{item.fieldGroup}</td>
                    <td>{item.dataType}</td>
                    <td>{item.unit}</td>
                    <td>{item.isRequired}</td>
                    <td>{item.inputMode}</td>
                    <td>
                      <span className="permission-badge">
                        {item.calculationRole}
                      </span>
                    </td>
                    <td>{item.sortOrder}</td>
                    <td>
                      <button
                        type="button"
                        onClick={() => handleRemoveField(index)}
                        disabled={loading}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="form-actions">
          <button type="submit" disabled={loading}>
            {loading
              ? 'Please wait...'
              : editId === null
                ? 'Save Template'
                : 'Update Template'}
          </button>

          {editId !== null && (
            <button type="button" onClick={handleCancelEdit} disabled={loading}>
              Cancel Edit
            </button>
          )}
        </div>
      </form>

      <div className="section-title">
        <h3>Saved Operation Templates</h3>
        <p>
          These templates will later generate operation data entry screens.
        </p>
      </div>

      <table>
        <thead>
          <tr>
            <th>Template Name</th>
            <th>Operation Type</th>
            <th>Layout</th>
            <th>Engine</th>
            <th>Fields</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>

        <tbody>
          {operationTemplates.length === 0 ? (
            <tr>
              <td colSpan="7" className="empty-table">
                No operation templates added yet.
              </td>
            </tr>
          ) : (
            operationTemplates.map((item) => (
              <tr key={item.id}>
                <td>{item.templateName}</td>
                <td>
                  {getOperationTypeName(item.operationTypeCode)} (
                  {item.operationTypeCode})
                </td>
                <td>{item.entryLayoutType || 'Standard Form'}</td>
                <td>{item.calculationEngine || 'None'}</td>
                <td>
                  <div className="permission-list">
                    {[...item.fields]
                      .sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder))
                      .map((fieldItem) => (
                        <span
                          key={fieldItem.id || fieldItem.fieldCode}
                          className="permission-badge"
                        >
                          {fieldItem.fieldName}
                        </span>
                      ))}
                  </div>
                </td>
                <td>
                  <span className={`status-badge ${item.status.toLowerCase()}`}>
                    {item.status}
                  </span>
                </td>
                <td>
                  <button type="button" onClick={() => handleEdit(item)}>
                    Edit
                  </button>

                  <button type="button" onClick={() => handleDelete(item.id)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <div className="info-box">
        Rule: Operation Template fields define the future data entry form.
        Manual fields are entered by users. Lookup and Calculated fields will be
        populated by the calculation engine later.
      </div>
    </div>
  )
}

export default OperationTemplateMaster