import { useEffect, useMemo, useState } from 'react'
import {
  bulkSaveTable11Factors,
  clearTable11Factors,
  getTable11Factors,
  lookupTable11Factor,
} from '../api/table11Api'

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
  const [successMsg, setSuccessMsg] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)
  const [confirmSaveRowsAction, setConfirmSaveRowsAction] = useState(null)

  const isAdminBootstrap =
    String(loggedInUser?.username || '').toLowerCase() === 'admin'

  const hasPermission = (permissionName) => {
    if (isAdminBootstrap) return true
    if (!loggedInUser || !Array.isArray(loggedInUser.permissions)) return false
    return loggedInUser.permissions.some(
      (p) => p.permissionName === permissionName
    )
  }

  const canManage = hasPermission('Manage Asset Calibration')

  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => Number(a.api60) - Number(b.api60))
  }, [rows])

  const resetUploadState = () => {
    setUploadFileName('')
    setUploadFileFormat('')
    setUploadedRows([])
    setUploadValidationErrors([])
  }

  const loadTable11Factors = async () => {
    try {
      setLoading(true)
      setSuccessMsg('')
      setErrorMsg('')

      const data = await getTable11Factors()
      setRows(data)
    } catch (error) {
      setErrorMsg(error.message)
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
    setSuccessMsg('')
    setErrorMsg('')

    try {
      const parsedRows = parsePastedRows()
      setRows(parsedRows)
      setUploadedRows([])
      setUploadValidationErrors([])
      setSuccessMsg(`${parsedRows.length} Table 11 rows loaded for preview.`)
    } catch (error) {
      setErrorMsg(error.message)
    }
  }

  const handleFileUpload = async (e) => {
    const selectedFile = e.target.files[0]
    setSuccessMsg('')
    setErrorMsg('')

    resetUploadState()

    if (!selectedFile) {
      return
    }

    const fileName = selectedFile.name
    const fileExtension = fileName.split('.').pop().toLowerCase()

    if (fileExtension !== 'csv') {
      setErrorMsg('XLSX upload disabled. Upload CSV.')
      e.target.value = ''
      return
    }

    try {
      let matrixRows = []

      const csvText = await selectedFile.text()
      matrixRows = parseCsvTextToMatrix(csvText)

      const validation = normalizeRowsFromMatrix(matrixRows)

      setUploadFileName(fileName)
      setUploadFileFormat(fileExtension.toUpperCase())
      setUploadedRows(validation.rows)
      setUploadValidationErrors(validation.errors)

      if (validation.errors.length > 0) {
        setErrorMsg('Uploaded file has validation errors. Please review below.')
      } else {
        setRows(validation.rows)
        setSuccessMsg(`${validation.rows.length} Table 11 rows parsed successfully.`)
      }
    } catch (error) {
      setUploadValidationErrors([error.message])
      setErrorMsg(error.message)
    } finally {
      e.target.value = ''
    }
  }

  const executeSaveRows = async () => {
    setSuccessMsg('')
    setErrorMsg('')

    try {
      setLoading(true)

      const savedRows = await bulkSaveTable11Factors(confirmSaveRowsAction)
      setRows(savedRows)
      setPasteText('')
      resetUploadState()
      setLookupResult(null)
      setConfirmSaveRowsAction(null)

      setSuccessMsg('Table 11 factors saved successfully.')
    } catch (error) {
      setErrorMsg(error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleSaveRows = async (sourceRows, sourceName) => {
    setSuccessMsg('')
    setErrorMsg('')

    if (!canManage) {
      setErrorMsg('You do not have permission to manage Table 11 factors.')
      return
    }

    if (!Array.isArray(sourceRows) || sourceRows.length === 0) {
      setErrorMsg(`No valid ${sourceName} rows available to save.`)
      return
    }

    setConfirmSaveRowsAction(sourceRows)
  }

  const handleSavePastedRows = async () => {
    setSuccessMsg('')
    setErrorMsg('')

    let parsedRows = []

    try {
      parsedRows = parsePastedRows()
    } catch (error) {
      setErrorMsg(error.message)
      return
    }

    await handleSaveRows(parsedRows, 'pasted')
  }

  const handleSaveUploadedRows = async () => {
    await handleSaveRows(uploadedRows, 'uploaded')
  }

  const executeClearTable = async () => {
    setSuccessMsg('')
    setErrorMsg('')

    try {
      setLoading(true)

      await clearTable11Factors()
      setRows([])
      setPasteText('')
      resetUploadState()
      setLookupResult(null)
      setConfirmClear(false)

      setSuccessMsg('Table 11 factors cleared successfully.')
    } catch (error) {
      setErrorMsg(error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleClear = () => {
    setSuccessMsg('')
    setErrorMsg('')

    if (!canManage) {
      setErrorMsg('You do not have permission to clear Table 11 factors.')
      return
    }

    setConfirmClear(true)
  }

  const handleLookup = async () => {
    setSuccessMsg('')
    setErrorMsg('')

    if (String(lookupApi60).trim() === '') {
      setErrorMsg('Enter API@60 value for lookup test.')
      return
    }

    try {
      setLoading(true)

      const data = await lookupTable11Factor(lookupApi60)
      setLookupResult(data)
    } catch (error) {
      setErrorMsg(error.message)
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

      <div className="info-box">
        Table 11 is common reference data. It is not asset-specific. Required
        structure: first column API @ 60°F, second column LT Factor.
      </div>

      {successMsg && (
        <div className="success-box">{successMsg}</div>
      )}

      {errorMsg && (
        <div className="error-box">{errorMsg}</div>
      )}

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
              Upload CSV. Header row is optional. The first two columns
              must be API @ 60°F and LT Factor.
            </p>
          </div>
        </div>

        <div>
          <label>Upload CSV</label>
          <input
            type="file"
            accept=".csv"
            onChange={handleFileUpload}
            disabled={!canManage || loading}
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
                disabled={!canManage || loading}
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
            disabled={!canManage || loading}
          />
        </div>

        <div className="form-actions">
          <button
            type="button"
            onClick={handlePreview}
            disabled={!canManage || loading || pasteText.trim() === ''}
          >
            Preview Pasted Rows
          </button>

          <button
            type="button"
            onClick={handleSavePastedRows}
            disabled={!canManage || loading || pasteText.trim() === ''}
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
            disabled={!canManage || loading || rows.length === 0}
          >
            Clear All Rows
          </button>
        </div>
      </form>

      {!canManage && (
        <div className="info-box">
          You have view-only access. Required permission for changes: Manage
          Asset Calibration.
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
            sortedRows.slice(0, 10).map((row) => (
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
