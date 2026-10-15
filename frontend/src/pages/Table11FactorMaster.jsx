import { useEffect, useMemo, useState } from 'react'
import {
  bulkSaveTable11Factors,
  clearTable11Factors,
  getTable11Factors,
  lookupTable11Factor,
} from '../api/table11Api'
import PaginationControls, { paginateRows, usePageSize } from '../components/common/PaginationControls'
import DataTableToolbar from '../components/common/DataTableToolbar'
import Icon from '../components/common/Icon'
import { useDataFilters } from '../hooks/useDataFilters'
import { useAutoColumns } from '../hooks/useAutoColumns'
import { usePermissions } from '../hooks/usePermissions'
import { parseImportMatrix } from '../utils/importUtils'
import { exportRows } from '../utils/exportUtils'
import { logUiAction } from '../utils/actionLogger'
import AlertMessage from '../components/common/AlertMessage'
import useActionFeedback from '../hooks/useActionFeedback'

const UPLOAD_EXTENSIONS = ['xlsx', 'xlsm', 'csv', 'txt']

function Table11FactorMaster({ loggedInUser }) {
  const [rows, setRows] = useState([])
  const [pasteText, setPasteText] = useState('')
  const [lookupApi60, setLookupApi60] = useState('')
  const [lookupResult, setLookupResult] = useState(null)
  const [loading, setLoading] = useState(false)

  const [uploadFileName, setUploadFileName] = useState('')
  const [uploadFileFormat, setUploadFileFormat] = useState('')
  const [uploadedRows, setUploadedRows] = useState([])
  const [uploadValidationErrors, setUploadValidationErrors] = useState([])
  // Action feedback: little pop-up (toast) + inline message near the
  // action area (owner rule 8) - never at the bottom of the page.
  const feedback = useActionFeedback()
  const { notifySuccess, notifyError, clearSuccess, clearError } = feedback
  const [confirmClear, setConfirmClear] = useState(false)
  const [confirmSaveRowsAction, setConfirmSaveRowsAction] = useState(null)

  const { hasPermission } = usePermissions(loggedInUser)
  const canEditTable11 = hasPermission('Edit Table 11 Factor')
  const canDeleteTable11 = hasPermission('Delete Table 11 Factor')

  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => Number(a.api60) - Number(b.api60))
  }, [rows])

  const [page, setPage] = useState(1)

  const pageSize = usePageSize()
  const sortedRowsFilters = useDataFilters(sortedRows, useAutoColumns(sortedRows), { module: 'Table 11 Factor Master' })
  const visibleRows = paginateRows(sortedRowsFilters.filteredRows, page, pageSize)

  const resetUploadState = () => {
    setUploadFileName('')
    setUploadFileFormat('')
    setUploadedRows([])
    setUploadValidationErrors([])
  }

  const loadTable11Factors = async () => {
    try {
      setLoading(true)
      clearSuccess()
      clearError()

      const data = await getTable11Factors()
      setRows(data)
    } catch (error) {
      notifyError(error.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadTable11Factors()
  }, [])

  const isNumeric = (value) => {
    if (value === undefined || value === null) {
      return false
    }

    const cleanedValue = String(value).trim()

    if (cleanedValue === '') {
      return false
    }

    return !Number.isNaN(Number(cleanedValue))
  }

  const normalizeRowsFromMatrix = (matrixRows) => {
    const errors = []
    const parsedRows = []

    const cleanMatrixRows = matrixRows
      .map((row) => row.map((cell) => String(cell ?? '').trim()))
      .filter((row) => row.some((cell) => cell !== ''))

    if (cleanMatrixRows.length === 0) {
      return {
        rows: [],
        errors: ['Uploaded file does not contain any data rows.'],
      }
    }

    let startIndex = 0

    const firstRow = cleanMatrixRows[0] || []
    const firstValue = firstRow[0]
    const secondValue = firstRow[1]

    // If first row is header like "API@60, LT Factor", skip it.
    if (!isNumeric(firstValue) || !isNumeric(secondValue)) {
      startIndex = 1
    }

    for (let index = startIndex; index < cleanMatrixRows.length; index += 1) {
      const row = cleanMatrixRows[index]
      const api60 = Number(row[0])
      const ltFactor = Number(row[1])

      if (!isNumeric(row[0])) {
        errors.push(`Row ${index + 1}: API @ 60°F must be a number.`)
        continue
      }

      if (!isNumeric(row[1])) {
        errors.push(`Row ${index + 1}: LT Factor must be a number.`)
        continue
      }

      if (api60 <= 0) {
        errors.push(`Row ${index + 1}: API @ 60°F must be greater than zero.`)
        continue
      }

      if (ltFactor <= 0) {
        errors.push(`Row ${index + 1}: LT Factor must be greater than zero.`)
        continue
      }

      parsedRows.push({
        api60,
        ltFactor,
      })
    }

    if (parsedRows.length === 0 && errors.length === 0) {
      errors.push('No valid API@60 / LT Factor rows found.')
    }

    const apiValues = parsedRows.map((row) => row.api60)
    const uniqueApiValues = new Set(apiValues)

    if (apiValues.length !== uniqueApiValues.size) {
      errors.push('Duplicate API @ 60°F values found.')
    }

    return {
      rows: errors.length === 0 ? parsedRows.sort((a, b) => a.api60 - b.api60) : [],
      errors,
    }
  }

  const parseCsvTextToMatrix = (csvText) => {
    return csvText
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '')
      .map((line) => {
        return line
          .split(/[\t,; ]+/)
          .map((part) => part.trim())
          .filter((part) => part !== '')
      })
  }

  const parsePastedRows = () => {
    const matrixRows = parseCsvTextToMatrix(pasteText)
    const validation = normalizeRowsFromMatrix(matrixRows)

    if (validation.errors.length > 0) {
      throw new Error(validation.errors.join('\n'))
    }

    return validation.rows
  }

  const handlePreview = () => {
    clearSuccess()
    clearError()

    try {
      const parsedRows = parsePastedRows()
      setRows(parsedRows)
      setUploadedRows([])
      setUploadValidationErrors([])
      notifySuccess(`${parsedRows.length} Table 11 rows loaded for preview.`)
    } catch (error) {
      notifyError(error.message)
    }
  }

  const handleFileUpload = async (e) => {
    const selectedFile = e.target.files[0]
    clearSuccess()
    clearError()

    resetUploadState()

    if (!selectedFile) {
      return
    }

    const fileName = selectedFile.name
    const fileExtension = fileName.split('.').pop().toLowerCase()

    if (!UPLOAD_EXTENSIONS.includes(fileExtension)) {
      notifyError('Unsupported file type. Upload an Excel (.xlsx) or CSV (.csv) file.')
      e.target.value = ''
      return
    }

    try {
      const { matrix, format } = await parseImportMatrix(selectedFile)
      const validation = normalizeRowsFromMatrix(matrix)

      setUploadFileName(fileName)
      setUploadFileFormat(format === 'csv' ? 'CSV' : 'XLSX')
      setUploadedRows(validation.rows)
      setUploadValidationErrors(validation.errors)

      if (validation.errors.length > 0) {
        notifyError(
          `Uploaded file has ${validation.errors.length} validation error(s). Correct the file and upload it again – nothing has been saved yet.`
        )
      } else {
        setRows(validation.rows)
        notifySuccess(`${validation.rows.length} Table 11 rows parsed successfully.`)
        logUiAction('Table 11 Factor Master', 'Factor File Parsed', {
          fileName,
          rows: validation.rows.length,
          format,
        })
      }
    } catch (error) {
      setUploadValidationErrors([error.message])
      notifyError(error.message)
    } finally {
      e.target.value = ''
    }
  }

  /** Blank two-column upload file for the Table 11 factor table. */
  const downloadFactorTemplate = async (format) => {
    try {
      await exportRows({
        format,
        rows: [
          { api60: 30, ltFactor: 0.9759 },
          { api60: 31, ltFactor: 0.9723 },
        ],
        columns: [
          { key: 'api60', label: 'API @ 60F', type: 'number' },
          { key: 'ltFactor', label: 'LT Factor', type: 'number' },
        ],
        fileName: 'table11-factor-upload-template',
        title: 'Table 11 factor template',
        subtitle: 'First column API @ 60°F, second column LT Factor. The header row is optional.',
        module: 'Table 11 Factor Master',
      })
    } catch (error) {
      notifyError(error.message || 'Unable to build the template file.')
    }
  }

  const executeSaveRows = async () => {
    clearSuccess()
    clearError()

    try {
      setLoading(true)

      const savedRows = await bulkSaveTable11Factors(confirmSaveRowsAction)
      setRows(savedRows)
      setPasteText('')
      resetUploadState()
      setLookupResult(null)
      setConfirmSaveRowsAction(null)

      notifySuccess('Table 11 factors saved successfully.')
    } catch (error) {
      notifyError(error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleSaveRows = async (sourceRows, sourceName) => {
    clearSuccess()
    clearError()

    if (!canEditTable11) {
      notifyError('You do not have permission to save Table 11 factors.')
      return
    }

    if (!Array.isArray(sourceRows) || sourceRows.length === 0) {
      notifyError(`No valid ${sourceName} rows available to save.`)
      return
    }

    setConfirmSaveRowsAction(sourceRows)
  }

  const handleSavePastedRows = async () => {
    clearSuccess()
    clearError()

    let parsedRows = []

    try {
      parsedRows = parsePastedRows()
    } catch (error) {
      notifyError(error.message)
      return
    }

    await handleSaveRows(parsedRows, 'pasted')
  }

  const handleSaveUploadedRows = async () => {
    await handleSaveRows(uploadedRows, 'uploaded')
  }

  const executeClearTable = async () => {
    clearSuccess()
    clearError()

    try {
      setLoading(true)

      await clearTable11Factors()
      setRows([])
      setPasteText('')
      resetUploadState()
      setLookupResult(null)
      setConfirmClear(false)

      notifySuccess('Table 11 factors cleared successfully.')
    } catch (error) {
      notifyError(error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleClear = () => {
    clearSuccess()
    clearError()

    if (!canDeleteTable11) {
      notifyError('You do not have permission to clear Table 11 factors.')
      return
    }

    setConfirmClear(true)
  }

  const handleLookup = async () => {
    clearSuccess()
    clearError()

    if (String(lookupApi60).trim() === '') {
      notifyError('Enter API@60 value for lookup test.')
      return
    }

    try {
      setLoading(true)

      const data = await lookupTable11Factor(lookupApi60)
      setLookupResult(data)
    } catch (error) {
      notifyError(error.message)
      setLookupResult(null)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <div className="page-title">
        <div>
          <h2>Table 11 Factor Master</h2>
          <p>
            Maintain the common API @ 60°F to LT factor reference table used by
            Tank, Barge, Tanker, Vessel, and FSO calculations.
          </p>
        </div>

        <span className="record-count">{rows.length} Rows</span>
      </div>
      {/* Action feedback: right next to the page actions + a little pop-up
          toast - never at the bottom of the page (owner rule 8). */}
      <AlertMessage tone="success" message={feedback.successMsg} onDismiss={clearSuccess} />
      <AlertMessage tone="error" message={feedback.errorMsg} onDismiss={clearError} />

      <div className="info-box">
        Table 11 is common reference data. It is not asset-specific. Required
        structure: first column API @ 60°F, second column LT Factor.
      </div>

      {confirmSaveRowsAction && (
        <div className="confirm-overlay">
          <div className="confirm-box">
            <p>This will replace the existing Table 11 factor master with <strong>{confirmSaveRowsAction.length}</strong> rows. Continue?</p>
            <div className="confirm-actions">
              <button onClick={executeSaveRows} disabled={loading}>
                {loading ? 'Saving...' : 'Yes, Save'}
              </button>
              <button onClick={() => setConfirmSaveRowsAction(null)} disabled={loading}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmClear && (
        <div className="confirm-overlay">
          <div className="confirm-box">
            <p>Are you sure you want to clear all Table 11 factor rows?</p>
            <div className="confirm-actions">
              <button onClick={executeClearTable} disabled={loading}>
                {loading ? 'Clearing...' : 'Yes, Clear'}
              </button>
              <button onClick={() => setConfirmClear(false)} disabled={loading}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <form>
        <div className="full-width-field">
          <div className="section-title compact-section-title">
            <h3>Upload Table 11 File</h3>
            <p>
              Upload an Excel (.xlsx) or CSV file. The header row is optional.
              The first two columns must be API @ 60°F and LT Factor.
            </p>

            <div className="upload-template-downloads">
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() => downloadFactorTemplate('xlsx')}
                disabled={loading}
              >
                <Icon name="fileSpreadsheet" size={14} />
                Download XLSX template
              </button>
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() => downloadFactorTemplate('csv')}
                disabled={loading}
              >
                <Icon name="fileText" size={14} />
                Download CSV template
              </button>
            </div>
          </div>
        </div>

        <div>
          <label>Upload Table 11 File (.xlsx or .csv)</label>
          <input
            type="file"
            accept=".xlsx,.xlsm,.csv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            onChange={handleFileUpload}
            disabled={!canEditTable11 || loading}
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
                  {uploadedRows.length} rows parsed successfully. Showing first
                  10 rows.
                </p>
              </div>

              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>API @ 60°F</th>
                    <th>LT Factor</th>
                  </tr>
                </thead>

                <tbody>
                  {uploadedRows.slice(0, 10).map((row, index) => (
                    <tr key={`${row.api60}-${row.ltFactor}-${index}`}>
                      <td>{index + 1}</td>
                      <td>{row.api60}</td>
                      <td>{row.ltFactor}</td>
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
                onClick={handleSaveUploadedRows}
                disabled={!canEditTable11 || loading}
              >
                Replace & Save Uploaded Rows
              </button>

              <button type="button" onClick={resetUploadState} disabled={loading}>
                Clear Upload Preview
              </button>
            </div>
          </>
        )}
      </form>

      <form>
        <div className="full-width-field">
          <div className="section-title compact-section-title">
            <h3>Paste Table 11 Rows</h3>
            <p>
              You can also paste rows directly. Accepted separators: space, tab,
              comma, or semicolon.
            </p>
          </div>
        </div>

        <div className="full-width-field">
          <label>Paste Table 11 Rows</label>
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder={`Paste rows as:
API@60 LT_FACTOR
35 0.13456
36 0.13391
37 0.13326`}
            rows="8"
            disabled={!canEditTable11 || loading}
          />
        </div>

        <div className="form-actions">
          <button
            type="button"
            onClick={handlePreview}
            disabled={!canEditTable11 || loading || pasteText.trim() === ''}
          >
            Preview Pasted Rows
          </button>

          <button
            type="button"
            onClick={handleSavePastedRows}
            disabled={!canEditTable11 || loading || pasteText.trim() === ''}
          >
            Replace & Save Pasted Rows
          </button>

          <button
            type="button"
            onClick={loadTable11Factors}
            disabled={loading}
          >
            Reload Saved Rows
          </button>

          <button
            type="button"
            onClick={handleClear}
            disabled={!canDeleteTable11 || loading || rows.length === 0}
          >
            Clear All Rows
          </button>
        </div>
      </form>

      {!canEditTable11 && !canDeleteTable11 && (
        <div className="info-box">
          You have view-only access. Editing the factor table requires Edit
          Table 11 Factor; clearing it requires Delete Table 11 Factor.
        </div>
      )}

      <div className="section-title">
        <h3>Lookup Test</h3>
        <p>Test LT factor lookup and interpolation for any API @ 60°F value.</p>
      </div>

      <form>
        <div>
          <label>API @ 60°F</label>
          <input
            type="number"
            step="0.001"
            value={lookupApi60}
            onChange={(e) => setLookupApi60(e.target.value)}
            placeholder="Example: 35.5"
          />
        </div>

        <div className="form-actions">
          <button type="button" onClick={handleLookup} disabled={loading}>
            Test Lookup
          </button>
        </div>
      </form>

      {lookupResult && (
        <div className="tank-calibration-banner">
          <div>
            <span>API @ 60°F</span>
            <strong>{lookupResult.api60}</strong>
          </div>

          <div>
            <span>Lower API</span>
            <strong>{lookupResult.lowerApi60 ?? '-'}</strong>
          </div>

          <div>
            <span>Upper API</span>
            <strong>{lookupResult.upperApi60 ?? '-'}</strong>
          </div>

          <div>
            <span>LT Factor</span>
            <strong>{lookupResult.ltFactor}</strong>
          </div>

          <div>
            <span>Lookup Method</span>
            <strong>{lookupResult.lookupMethod}</strong>
          </div>
        </div>
      )}

      <div className="section-title">
        <h3>Saved Table 11 Factors</h3>
        <p>Current common API@60 to LT factor reference table.</p>
      </div>

      <DataTableToolbar
        filters={sortedRowsFilters}
        columns={sortedRowsFilters.columns}
        exportFileName="table-11-factor-master"
        exportTitle="Table 11 Factor Master"
        module="Table 11 Factor Master"
      />

      <table>
        <thead>
          <tr>
            <th>API @ 60°F</th>
            <th>LT Factor</th>
            <th>Updated At</th>
          </tr>
        </thead>

        <tbody>
          {sortedRows.length === 0 ? (
            <tr>
              <td colSpan="3" className="empty-table">
                No Table 11 factors saved yet.
              </td>
            </tr>
          ) : (
            visibleRows.map((row) => (
              <tr key={`${row.api60}-${row.ltFactor}`}>
                <td>{row.api60}</td>
                <td>
                  <strong>{row.ltFactor}</strong>
                </td>
                <td>{row.updatedAt || '-'}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <PaginationControls currentPage={page} totalRows={sortedRowsFilters.filteredRows.length} onPageChange={setPage} />

      {sortedRows.length > 10 && (
        <div className="info-box">
          Showing first 10 rows only for easy viewing. Total saved Table 11 rows:{' '}
          {sortedRows.length}. Use Lookup Test to verify any API @ 60°F value.
        </div>
      )}

      <div className="info-box">
        Calculation rule: API@60 → LT Factor lookup → LT = NSV × LT Factor → MT
        = LT × 1.01605.
      </div>
    </div>
  )
}

export default Table11FactorMaster
