import { useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import {
  createAssetCalibrationTable,
  deleteAssetCalibrationTable,
  updateAssetCalibrationTable,
} from '../api/assetCalibrationApi'

function AssetCalibrationTable({
  assets,
  calibrationTemplates,
  calibrationTables,
  reloadAssetCalibrationTables,
}) {
  const emptyForm = {
    calibrationName: '',
    assetCode: '',
    templateId: '',
    effectiveDate: '',
    remarks: '',
    status: 'Active',
    rows: [],
  }

  const [formData, setFormData] = useState(emptyForm)
  const [rowData, setRowData] = useState({})
  const [editId, setEditId] = useState(null)
  const [loading, setLoading] = useState(false)

  const [uploadFileName, setUploadFileName] = useState('')
  const [uploadFileFormat, setUploadFileFormat] = useState('')
  const [uploadedRows, setUploadedRows] = useState([])
  const [uploadValidationErrors, setUploadValidationErrors] = useState([])
  const [showUploadHelp, setShowUploadHelp] = useState(false)

  const visibleRowLimit = 10

  const activeAssets = assets.filter((asset) => asset.status === 'Active')
  const activeTemplates = calibrationTemplates.filter(
    (template) => template.status === 'Active'
  )

  const selectedAsset = activeAssets.find(
    (asset) => asset.assetCode === formData.assetCode
  )

  const availableTemplates = useMemo(() => {
    if (!selectedAsset) {
      return []
    }

    return activeTemplates.filter((template) => {
      return template.assetTypeCode === selectedAsset.assetTypeCode
    })
  }, [activeTemplates, selectedAsset])

  const selectedTemplate = activeTemplates.find((template) => {
    return template.id === Number(formData.templateId)
  })

  const sortedTemplateColumns = selectedTemplate
    ? [...selectedTemplate.columns].sort(
        (a, b) => Number(a.sortOrder) - Number(b.sortOrder)
      )
    : []

  const resetUploadState = () => {
    setUploadFileName('')
    setUploadFileFormat('')
    setUploadedRows([])
    setUploadValidationErrors([])
  }

  const handleFormChange = (e) => {
    const { name, value } = e.target

    if (name === 'assetCode') {
      setFormData({
        ...formData,
        assetCode: value,
        templateId: '',
        rows: [],
      })
      setRowData({})
      resetUploadState()
      return
    }

    if (name === 'templateId') {
      setFormData({
        ...formData,
        templateId: value,
        rows: [],
      })
      setRowData({})
      resetUploadState()
      return
    }

    setFormData({
      ...formData,
      [name]: value,
    })
  }

  const handleRowChange = (columnName, value) => {
    setRowData({
      ...rowData,
      [columnName]: value,
    })
  }

  const convertValueByDataType = (value, dataType) => {
    if (value === undefined || value === null) {
      return ''
    }

    const cleanedValue = String(value).trim()

    if (cleanedValue === '') {
      return ''
    }

    if (dataType === 'Number') {
      const numericValue = Number(cleanedValue)

      if (Number.isNaN(numericValue)) {
        return cleanedValue
      }

      return numericValue
    }

    if (dataType === 'Boolean') {
      if (cleanedValue.toLowerCase() === 'true') {
        return true
      }

      if (cleanedValue.toLowerCase() === 'false') {
        return false
      }

      if (cleanedValue.toLowerCase() === 'yes') {
        return true
      }

      if (cleanedValue.toLowerCase() === 'no') {
        return false
      }

      return cleanedValue
    }

    return cleanedValue
  }

  const handleAddRow = () => {
    if (!selectedTemplate) {
      alert('Please select a calibration template first')
      return
    }

    for (const column of sortedTemplateColumns) {
      if (column.isRequired === 'Yes') {
        const value = rowData[column.columnName]

        if (value === undefined || String(value).trim() === '') {
          alert(`${column.columnName} is required`)
          return
        }
      }
    }

    const newRow = {}

    sortedTemplateColumns.forEach((column) => {
      newRow[column.columnName] = convertValueByDataType(
        rowData[column.columnName],
        column.dataType
      )
    })

    setFormData({
      ...formData,
      rows: [...formData.rows, newRow],
    })

    setRowData({})
  }

  const handleRemoveRow = (indexToRemove) => {
    const confirmRemove = window.confirm(
      'Are you sure you want to remove this row?'
    )

    if (confirmRemove === false) {
      return
    }

    setFormData({
      ...formData,
      rows: formData.rows.filter((row, index) => index !== indexToRemove),
    })
  }

  const parseCsvText = (csvText) => {
    const lines = csvText
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .split('\n')
      .filter((line) => line.trim() !== '')

    if (lines.length === 0) {
      return []
    }

    const parseCsvLine = (line) => {
      const values = []
      let currentValue = ''
      let insideQuotes = false

      for (let i = 0; i < line.length; i += 1) {
        const character = line[i]
        const nextCharacter = line[i + 1]

        if (character === '"' && insideQuotes && nextCharacter === '"') {
          currentValue += '"'
          i += 1
        } else if (character === '"') {
          insideQuotes = !insideQuotes
        } else if (character === ',' && !insideQuotes) {
          values.push(currentValue.trim())
          currentValue = ''
        } else {
          currentValue += character
        }
      }

      values.push(currentValue.trim())
      return values
    }

    const headers = parseCsvLine(lines[0]).map((header) => header.trim())

    return lines.slice(1).map((line) => {
      const values = parseCsvLine(line)
      const row = {}

      headers.forEach((header, index) => {
        row[header] = values[index] === undefined ? '' : values[index]
      })

      return row
    })
  }

  const validateAndNormalizeUploadedRows = (rawRows) => {
    const errors = []

    if (!selectedTemplate) {
      errors.push('Please select a calibration template before uploading.')
      return {
        rows: [],
        errors,
      }
    }

    if (rawRows.length === 0) {
      errors.push('Uploaded file does not contain any data rows.')
      return {
        rows: [],
        errors,
      }
    }

    const fileColumns = Object.keys(rawRows[0] || {}).map((columnName) =>
      String(columnName).trim()
    )

    if (fileColumns.length === 0) {
      errors.push('Uploaded file does not contain a valid header row.')
      return {
        rows: [],
        errors,
      }
    }

    const lowerCaseFileColumnMap = {}

    fileColumns.forEach((columnName) => {
      lowerCaseFileColumnMap[columnName.toLowerCase()] = columnName
    })

    sortedTemplateColumns.forEach((templateColumn) => {
      const matchingFileColumn =
        lowerCaseFileColumnMap[templateColumn.columnName.toLowerCase()]

      if (!matchingFileColumn) {
        errors.push(
          `Missing template column in uploaded file: ${templateColumn.columnName}`
        )
      }
    })

    if (errors.length > 0) {
      return {
        rows: [],
        errors,
      }
    }

    const normalizedRows = rawRows.map((rawRow) => {
      const normalizedRow = {}

      sortedTemplateColumns.forEach((templateColumn) => {
        const matchingFileColumn =
          lowerCaseFileColumnMap[templateColumn.columnName.toLowerCase()]

        normalizedRow[templateColumn.columnName] = convertValueByDataType(
          rawRow[matchingFileColumn],
          templateColumn.dataType
        )
      })

      return normalizedRow
    })

    normalizedRows.forEach((normalizedRow, rowIndex) => {
      sortedTemplateColumns.forEach((templateColumn) => {
        if (templateColumn.isRequired === 'Yes') {
          const value = normalizedRow[templateColumn.columnName]

          if (
            value === undefined ||
            value === null ||
            String(value).trim() === ''
          ) {
            errors.push(
              `Row ${rowIndex + 1}: ${templateColumn.columnName} is required`
            )
          }
        }

        if (
          templateColumn.dataType === 'Number' &&
          normalizedRow[templateColumn.columnName] !== '' &&
          typeof normalizedRow[templateColumn.columnName] !== 'number'
        ) {
          errors.push(
            `Row ${rowIndex + 1}: ${templateColumn.columnName} must be a number`
          )
        }
      })
    })

    return {
      rows: errors.length === 0 ? normalizedRows : [],
      errors,
    }
  }

  const handleFileUpload = async (e) => {
    const selectedFile = e.target.files[0]

    resetUploadState()

    if (!selectedTemplate) {
      alert('Please select Asset and Calibration Template before uploading file')
      e.target.value = ''
      return
    }

    if (!selectedFile) {
      return
    }

    const fileName = selectedFile.name
    const fileExtension = fileName.split('.').pop().toLowerCase()

    if (fileExtension !== 'xlsx' && fileExtension !== 'csv') {
      alert('Only XLSX and CSV files are allowed')
      e.target.value = ''
      return
    }

    try {
      let rawRows = []

      if (fileExtension === 'csv') {
        const csvText = await selectedFile.text()
        rawRows = parseCsvText(csvText)
      } else {
        const arrayBuffer = await selectedFile.arrayBuffer()
        const workbook = XLSX.read(arrayBuffer, { type: 'array' })
        const firstSheetName = workbook.SheetNames[0]

        if (!firstSheetName) {
          throw new Error('Uploaded XLSX file does not contain any sheet')
        }

        const worksheet = workbook.Sheets[firstSheetName]

        rawRows = XLSX.utils.sheet_to_json(worksheet, {
          defval: '',
          raw: false,
        })
      }

      const validationResult = validateAndNormalizeUploadedRows(rawRows)

      setUploadFileName(fileName)
      setUploadFileFormat(fileExtension.toUpperCase())
      setUploadedRows(validationResult.rows)
      setUploadValidationErrors(validationResult.errors)

      if (validationResult.errors.length > 0) {
        alert('Uploaded file has validation errors. Please review below.')
      } else {
        alert(`${validationResult.rows.length} rows parsed successfully`)
      }
    } catch (error) {
      setUploadValidationErrors([error.message])
      alert(error.message)
    } finally {
      e.target.value = ''
    }
  }

  const handleUseUploadedRows = () => {
    if (uploadedRows.length === 0) {
      alert('No valid uploaded rows available')
      return
    }

    setFormData({
      ...formData,
      rows: uploadedRows,
    })

    alert('Uploaded rows added to calibration table')
  }

  const handleAppendUploadedRows = () => {
    if (uploadedRows.length === 0) {
      alert('No valid uploaded rows available')
      return
    }

    setFormData({
      ...formData,
      rows: [...formData.rows, ...uploadedRows],
    })

    alert('Uploaded rows appended to calibration table')
  }

  const handleClearRows = () => {
    const confirmClear = window.confirm(
      'Are you sure you want to clear all calibration rows?'
    )

    if (confirmClear === false) {
      return
    }

    setFormData({
      ...formData,
      rows: [],
    })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()

    if (formData.calibrationName.trim() === '') {
      alert('Calibration Name is required')
      return
    }

    if (formData.assetCode.trim() === '') {
      alert('Asset is required')
      return
    }

    if (String(formData.templateId).trim() === '') {
      alert('Calibration Template is required')
      return
    }

    if (formData.rows.length === 0) {
      alert('Please add or upload at least one calibration data row')
      return
    }

    try {
      setLoading(true)

      if (editId === null) {
        await createAssetCalibrationTable(formData)
        alert('Asset Calibration Table saved successfully')
      } else {
        await updateAssetCalibrationTable(editId, formData)
        alert('Asset Calibration Table updated successfully')
      }

      await reloadAssetCalibrationTables()
      setFormData(emptyForm)
      setRowData({})
      setEditId(null)
      resetUploadState()
    } catch (error) {
      alert(error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleEdit = (table) => {
    setFormData({
      calibrationName: table.calibrationName,
      assetCode: table.assetCode,
      templateId: String(table.templateId),
      effectiveDate: table.effectiveDate,
      remarks: table.remarks,
      status: table.status,
      rows: table.rows.map((row) => row.rowData),
    })

    setRowData({})
    resetUploadState()
    setEditId(table.id)
  }

  const handleDelete = async (tableId) => {
    const confirmDelete = window.confirm(
      'Are you sure you want to delete this calibration table?'
    )

    if (confirmDelete === false) {
      return
    }

    try {
      setLoading(true)
      await deleteAssetCalibrationTable(tableId)
      await reloadAssetCalibrationTables()

      if (editId === tableId) {
        setFormData(emptyForm)
        setRowData({})
        setEditId(null)
        resetUploadState()
      }

      alert('Asset Calibration Table deleted successfully')
    } catch (error) {
      alert(error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleCancelEdit = () => {
    setFormData(emptyForm)
    setRowData({})
    setEditId(null)
    resetUploadState()
  }

  return (
    <div>
      <div className="page-title">
        <div>
          <h2>Asset Calibration Table</h2>
          <p>
            Enter or upload calibration data for each asset based on its
            calibration template.
          </p>
        </div>

        <span className="record-count">
          {calibrationTables.length} Calibration Tables
        </span>
      </div>

      {showUploadHelp && (
        <div className="help-modal-overlay">
          <div className="help-modal">
            <div className="help-modal-header">
              <h3>XLSX / CSV Upload Help</h3>

              <button
                type="button"
                className="help-close-button"
                onClick={() => setShowUploadHelp(false)}
              >
                ×
              </button>
            </div>

            <div className="help-modal-body">
              <p>
                The uploaded file must follow the column structure defined in the
                selected Calibration Template.
              </p>

              <div className="help-section">
                <h4>Column Header Rule</h4>
                <p>
                  The first row of your Excel or CSV file must contain column
                  names. These names must match the template column names.
                </p>

                <table>
                  <thead>
                    <tr>
                      <th>Template Column</th>
                      <th>Excel / CSV Header</th>
                      <th>Allowed?</th>
                    </tr>
                  </thead>

                  <tbody>
                    <tr>
                      <td>Ullage</td>
                      <td>Ullage</td>
                      <td>Yes</td>
                    </tr>
                    <tr>
                      <td>Volume</td>
                      <td>Volume</td>
                      <td>Yes</td>
                    </tr>
                    <tr>
                      <td>Ullage</td>
                      <td>ullage</td>
                      <td>Yes, case-insensitive</td>
                    </tr>
                    <tr>
                      <td>Volume</td>
                      <td>Tank Volume</td>
                      <td>No</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="help-section">
                <h4>Example CSV</h4>

                <pre>
{`Ullage,Volume
1,1000
2,2000
3,3000`}
                </pre>
              </div>

              <div className="help-section">
                <h4>Validations Applied</h4>

                <ul>
                  <li>Only .xlsx and .csv files are allowed.</li>
                  <li>Asset and Calibration Template must be selected first.</li>
                  <li>All template columns must exist in the uploaded file.</li>
                  <li>Required columns cannot be blank.</li>
                  <li>Number columns must contain valid numeric values.</li>
                  <li>Extra uploaded columns are ignored if not in template.</li>
                  <li>
                    Uploaded rows are previewed first. They are not saved until
                    you click Replace Rows or Append Rows and then save the
                    calibration table.
                  </li>
                </ul>
              </div>

              {selectedTemplate && (
                <div className="help-section">
                  <h4>Expected Columns for Selected Template</h4>

                  <table>
                    <thead>
                      <tr>
                        <th>Column Name</th>
                        <th>Data Type</th>
                        <th>Unit</th>
                        <th>Required</th>
                      </tr>
                    </thead>

                    <tbody>
                      {sortedTemplateColumns.map((column) => (
                        <tr key={column.id || column.columnName}>
                          <td>{column.columnName}</td>
                          <td>{column.dataType}</td>
                          <td>{column.unit}</td>
                          <td>{column.isRequired}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div>
          <label>Calibration Name</label>
          <input
            name="calibrationName"
            type="text"
            value={formData.calibrationName}
            onChange={handleFormChange}
            placeholder="Example: Tank 101 Dip Table 2026"
          />
        </div>

        <div>
          <label>Asset</label>
          <select
            name="assetCode"
            value={formData.assetCode}
            onChange={handleFormChange}
          >
            <option value="">Select Asset</option>

            {activeAssets.map((asset) => (
              <option key={asset.id} value={asset.assetCode}>
                {asset.assetName} ({asset.assetCode})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label>Calibration Template</label>
          <select
            name="templateId"
            value={formData.templateId}
            onChange={handleFormChange}
            disabled={!selectedAsset}
          >
            <option value="">
              {selectedAsset
                ? 'Select Calibration Template'
                : 'Select Asset First'}
            </option>

            {availableTemplates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.templateName}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label>Effective Date</label>
          <input
            name="effectiveDate"
            type="date"
            value={formData.effectiveDate}
            onChange={handleFormChange}
          />
        </div>

        <div>
          <label>Status</label>
          <select
            name="status"
            value={formData.status}
            onChange={handleFormChange}
          >
            <option>Active</option>
            <option>Inactive</option>
            <option>Blocked</option>
          </select>
        </div>

        <div className="full-width-field">
          <label>Remarks</label>
          <textarea
            name="remarks"
            value={formData.remarks}
            onChange={handleFormChange}
            placeholder="Enter remarks"
            rows="3"
          />
        </div>

        {selectedTemplate && (
          <>
            <div className="full-width-field">
              <div className="section-title compact-section-title">
                <div className="title-with-help">
                  <h3>Upload XLSX / CSV</h3>

                  <button
                    type="button"
                    className="small-help-icon-button"
                    onClick={() => setShowUploadHelp(true)}
                    title="Upload Help"
                  >
                    ?
                  </button>
                </div>

                <p>
                  Uploaded file headers must match the selected template columns.
                  Click ? to view the required structure.
                </p>
              </div>
            </div>

            <div>
              <label>Upload Calibration File</label>
              <input
                type="file"
                accept=".xlsx,.csv"
                onChange={handleFileUpload}
                disabled={loading}
              />
            </div>

            <div>
              <label>Uploaded File</label>
              <input
                type="text"
                value={
                  uploadFileName
                    ? `${uploadFileName} (${uploadFileFormat})`
                    : ''
                }
                placeholder="No file uploaded"
                disabled
              />
            </div>

            {uploadValidationErrors.length > 0 && (
              <div className="full-width-field">
                <div className="info-box">
                  <strong>Upload validation errors:</strong>
                  <ul>
                    {uploadValidationErrors.map((error, index) => (
                      <li key={index}>{error}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {uploadedRows.length > 0 && (
              <>
                <div className="full-width-field">
                  <div className="section-title compact-section-title">
                    <h3>Uploaded Rows Preview</h3>
                    <p>
                      {uploadedRows.length} rows parsed successfully. Review and
                      add them to the calibration table.
                    </p>
                  </div>

                  <table>
                    <thead>
                      <tr>
                        <th>#</th>
                        {sortedTemplateColumns.map((column) => (
                          <th key={column.id || column.columnName}>
                            {column.columnName}
                          </th>
                        ))}
                      </tr>
                    </thead>

                    <tbody>
                      {uploadedRows.slice(0, 10).map((row, rowIndex) => (
                        <tr key={rowIndex}>
                          <td>{rowIndex + 1}</td>
                          {sortedTemplateColumns.map((column) => (
                            <td key={column.id || column.columnName}>
                              {String(row[column.columnName] ?? '')}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {uploadedRows.length > 10 && (
                    <div className="info-box">
                      Showing first 10 rows only. Total parsed rows:{' '}
                      {uploadedRows.length}
                    </div>
                  )}
                </div>

                <div className="form-actions">
                  <button
                    type="button"
                    onClick={handleUseUploadedRows}
                    disabled={loading}
                  >
                    Replace Rows
                  </button>

                  <button
                    type="button"
                    onClick={handleAppendUploadedRows}
                    disabled={loading}
                  >
                    Append Rows
                  </button>
                </div>
              </>
            )}

            <div className="full-width-field">
              <div className="section-title compact-section-title">
                <h3>Manual Row Entry</h3>
                <p>
                  You can also manually add rows. Fields are generated from the
                  selected calibration template.
                </p>
              </div>
            </div>

            {sortedTemplateColumns.map((column) => (
              <div key={column.id || column.columnName}>
                <label>
                  {column.columnName}
                  {column.unit ? ` (${column.unit})` : ''}
                  {column.isRequired === 'Yes' ? ' *' : ''}
                </label>
                <input
                  type={column.dataType === 'Number' ? 'number' : 'text'}
                  value={rowData[column.columnName] || ''}
                  onChange={(e) =>
                    handleRowChange(column.columnName, e.target.value)
                  }
                  placeholder={`Enter ${column.columnName}`}
                />
              </div>
            ))}

            <div className="form-actions">
              <button type="button" onClick={handleAddRow} disabled={loading}>
                Add Manual Row
              </button>

              {formData.rows.length > 0 && (
                <button type="button" onClick={handleClearRows} disabled={loading}>
                  Clear Rows
                </button>
              )}
            </div>
          </>
        )}

        <div className="full-width-field">
          <table>
            <thead>
              <tr>
                <th>#</th>
                {sortedTemplateColumns.map((column) => (
                  <th key={column.id || column.columnName}>
                    {column.columnName}
                  </th>
                ))}
                <th>Action</th>
              </tr>
            </thead>

            <tbody>
              {formData.rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={sortedTemplateColumns.length + 2}
                    className="empty-table"
                  >
                    No calibration rows added yet.
                  </td>
                </tr>
              ) : (
                formData.rows.slice(0, visibleRowLimit).map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    <td>{rowIndex + 1}</td>
                    {sortedTemplateColumns.map((column) => (
                      <td key={column.id || column.columnName}>
                        {String(row[column.columnName] ?? '')}
                      </td>
                    ))}
                    <td>
                      <button
                        type="button"
                        onClick={() => handleRemoveRow(rowIndex)}
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

          {formData.rows.length > visibleRowLimit && (
            <div className="info-box">
              Showing first {visibleRowLimit} rows only. Total rows added:{' '}
              {formData.rows.length}. All rows will be saved.
            </div>
          )}
        </div>

        <div className="form-actions">
          <button type="submit" disabled={loading}>
            {loading
              ? 'Please wait...'
              : editId === null
                ? 'Save Calibration Table'
                : 'Update Calibration Table'}
          </button>

          {editId !== null && (
            <button type="button" onClick={handleCancelEdit} disabled={loading}>
              Cancel Edit
            </button>
          )}
        </div>
      </form>

      <div className="section-title">
        <h3>Saved Asset Calibration Tables</h3>
        <p>Calibration rows are stored as JSONB in PostgreSQL.</p>
      </div>

      <table>
        <thead>
          <tr>
            <th>Calibration Name</th>
            <th>Asset</th>
            <th>Template</th>
            <th>Effective Date</th>
            <th>Rows</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>

        <tbody>
          {calibrationTables.length === 0 ? (
            <tr>
              <td colSpan="7" className="empty-table">
                No asset calibration tables added yet.
              </td>
            </tr>
          ) : (
            calibrationTables.map((table) => (
              <tr key={table.id}>
                <td>{table.calibrationName}</td>
                <td>
                  {table.assetName} ({table.assetCode})
                </td>
                <td>{table.templateName}</td>
                <td>{table.effectiveDate}</td>
                <td>{table.rows.length}</td>
                <td>
                  <span className={`status-badge ${table.status.toLowerCase()}`}>
                    {table.status}
                  </span>
                </td>
                <td>
                  <button type="button" onClick={() => handleEdit(table)}>
                    Edit
                  </button>

                  <button type="button" onClick={() => handleDelete(table.id)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <div className="info-box">
        XLSX/CSV headers must match the selected calibration template columns.
        Parsed rows are saved into PostgreSQL JSONB.
      </div>
    </div>
  )
}

export default AssetCalibrationTable