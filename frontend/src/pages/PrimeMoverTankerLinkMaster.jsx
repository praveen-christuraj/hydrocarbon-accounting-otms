import { useEffect, useMemo, useState } from 'react'
import {
  closePrimeMoverTankerLink,
  createPrimeMoverTankerLink,
  deletePrimeMoverTankerLink,
  getPrimeMoverTankerLinks,
  updatePrimeMoverTankerLink,
} from '../api/primeMoverTankerLinkApi'

const today = new Date().toISOString().slice(0, 10)

const emptyLink = {
  primeMoverAssetCode: '',
  tankerAssetCode: '',
  linkedFrom: today,
  linkedTo: '',
  remarks: '',
  status: 'Active',
}

const isPrimeMoverAsset = (asset) => {
  const typeCode = String(asset.assetTypeCode || '').toUpperCase()
  const name = String(asset.assetName || '').toUpperCase()
  const code = String(asset.assetCode || '').toUpperCase()

  return (
    typeCode.includes('PRIME') ||
    typeCode.includes('MOVER') ||
    name.includes('PRIME') ||
    name.includes('MOVER') ||
    code.startsWith('PM')
  )
}

const isTankerTrailerAsset = (asset) => {
  const typeCode = String(asset.assetTypeCode || '').toUpperCase()
  const name = String(asset.assetName || '').toUpperCase()

  return (
    typeCode.includes('TANKER') ||
    typeCode.includes('TRAILER') ||
    typeCode.includes('TRUCK') ||
    name.includes('TANKER') ||
    name.includes('TRAILER')
  )
}

function PrimeMoverTankerLinkMaster({ assets = [], loggedInUser }) {
  const [links, setLinks] = useState([])
  const [link, setLink] = useState(emptyLink)
  const [editId, setEditId] = useState(null)
  const [loading, setLoading] = useState(false)
  const [filterStatus, setFilterStatus] = useState('Active')
  const [successMsg, setSuccessMsg] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [validationErrors, setValidationErrors] = useState({})
  const [confirmDeleteItem, setConfirmDeleteItem] = useState(null)
  const [closeForm, setCloseForm] = useState({
    linkId: null,
    linkedTo: today,
    remarks: '',
  })

  const activeAssets = useMemo(() => {
    return assets.filter((asset) => asset.status === 'Active')
  }, [assets])

  const primeMoverAssets = useMemo(() => {
    return activeAssets.filter(isPrimeMoverAsset)
  }, [activeAssets])

  const tankerTrailerAssets = useMemo(() => {
    return activeAssets.filter(isTankerTrailerAsset)
  }, [activeAssets])

  const selectedPrimeMover = activeAssets.find((asset) => {
    return asset.assetCode === link.primeMoverAssetCode
  })

  const selectedTanker = activeAssets.find((asset) => {
    return asset.assetCode === link.tankerAssetCode
  })

  const loadLinks = async () => {
    try {
      setLoading(true)
      setSuccessMsg('')
      setErrorMsg('')

      const filters = {}

      if (filterStatus !== '') {
        filters.status = filterStatus
      }

      const data = await getPrimeMoverTankerLinks(filters)
      setLinks(data)
    } catch (error) {
      setErrorMsg(error.message || 'Unable to load Prime Mover - Tanker links')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadLinks()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterStatus])

  const handleChange = (e) => {
    const { name, value } = e.target

    setLink((current) => ({
      ...current,
      [name]: value,
    }))
  }

  const validateForm = () => {
    const errors = {}

    if (link.primeMoverAssetCode.trim() === '') {
      errors.primeMoverAssetCode = 'Prime Mover is required'
    }

    if (link.tankerAssetCode.trim() === '') {
      errors.tankerAssetCode = 'Tanker Trailer is required'
    }

    if (link.primeMoverAssetCode && link.tankerAssetCode && link.primeMoverAssetCode === link.tankerAssetCode) {
      errors.tankerAssetCode = 'Prime Mover and Tanker Trailer cannot be the same asset'
    }

    if (link.linkedFrom.trim() === '') {
      errors.linkedFrom = 'Linked From date is required'
    }

    if (
      link.linkedTo.trim() !== '' &&
      link.linkedTo < link.linkedFrom
    ) {
      errors.linkedTo = 'Linked To cannot be earlier than Linked From'
    }

    setValidationErrors(errors)
    return Object.keys(errors).length === 0
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSuccessMsg('')
    setErrorMsg('')
    setValidationErrors({})

    if (!validateForm()) {
      return
    }

    try {
      setLoading(true)

      if (editId === null) {
        await createPrimeMoverTankerLink(link)
        setSuccessMsg('Prime Mover - Tanker link saved successfully')
      } else {
        await updatePrimeMoverTankerLink(editId, link)
        setSuccessMsg('Prime Mover - Tanker link updated successfully')
      }

      setLink(emptyLink)
      setEditId(null)
      await loadLinks()
    } catch (error) {
      setErrorMsg(error.message || 'Unable to save Prime Mover - Tanker link')
    } finally {
      setLoading(false)
    }
  }

  const handleEdit = (item) => {
    setLink({
      primeMoverAssetCode: item.primeMoverAssetCode,
      tankerAssetCode: item.tankerAssetCode,
      linkedFrom: item.linkedFrom,
      linkedTo: item.linkedTo || '',
      remarks: item.remarks || '',
      status: item.status,
    })

    setEditId(item.id)
  }

  const handleCancelEdit = () => {
    setLink(emptyLink)
    setEditId(null)
  }

  const handleDelete = async () => {
    setSuccessMsg('')
    setErrorMsg('')

    try {
      setLoading(true)
      await deletePrimeMoverTankerLink(confirmDeleteItem.id)
      setConfirmDeleteItem(null)
      await loadLinks()
      setSuccessMsg('Prime Mover - Tanker link deleted successfully')
    } catch (error) {
      setErrorMsg(error.message || 'Unable to delete link')
    } finally {
      setLoading(false)
    }
  }

  const openCloseForm = (item) => {
    setCloseForm({
      linkId: item.id,
      linkedTo: today,
      remarks: '',
    })
  }

  const handleCloseFormChange = (e) => {
    const { name, value } = e.target

    setCloseForm((current) => ({
      ...current,
      [name]: value,
    }))
  }

  const handleCloseLink = async () => {
    setSuccessMsg('')
    setErrorMsg('')

    if (!closeForm.linkId) {
      return
    }

    if (closeForm.linkedTo.trim() === '') {
      setErrorMsg('Close date is required')
      return
    }

    try {
      setLoading(true)

      await closePrimeMoverTankerLink(
        closeForm.linkId,
        closeForm.linkedTo,
        closeForm.remarks
      )

      setCloseForm({
        linkId: null,
        linkedTo: today,
        remarks: '',
      })

      await loadLinks()
      setSuccessMsg('Link closed successfully')
    } catch (error) {
      setErrorMsg(error.message || 'Unable to close link')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <div className="page-title">
        <div>
          <h2>Prime Mover - Tanker Link</h2>
          <p>
            Link the active prime mover/tractor head with the calibrated tanker
            trailer. Operation Entry will use this active link to pick tanker
            chassis and calibration.
          </p>
        </div>

        <span className="record-count">{links.length} Links</span>
      </div>

      {primeMoverAssets.length === 0 && (
        <div className="info-box">
          No active Prime Mover assets found. Create assets with asset type code
          like <strong>PRIME_MOVER</strong>.
        </div>
      )}

      {tankerTrailerAssets.length === 0 && (
        <div className="info-box">
          No active Tanker Trailer assets found. Create assets with asset type
          code like <strong>TANKER_TRAILER</strong>. The tanker trailer asset
          must have calibration.
        </div>
      )}

      {successMsg && (
        <div className="success-box">{successMsg}</div>
      )}

      {errorMsg && (
        <div className="error-box">{errorMsg}</div>
      )}

      {confirmDeleteItem && (
        <div className="confirm-overlay">
          <div className="confirm-box">
            <p>Delete link <strong>{confirmDeleteItem.primeMoverAssetCode}</strong> → <strong>{confirmDeleteItem.tankerAssetCode}</strong>?</p>
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

      <form onSubmit={handleSubmit}>
        <div>
          <label>Prime Mover *</label>
          <select
            name="primeMoverAssetCode"
            value={link.primeMoverAssetCode}
            onChange={(e) => { handleChange(e); setValidationErrors({ ...validationErrors, primeMoverAssetCode: '' }) }}
            className={validationErrors.primeMoverAssetCode ? 'input-error' : ''}
          >
            <option value="">Select Prime Mover</option>

            {primeMoverAssets.map((asset) => (
              <option key={asset.id} value={asset.assetCode}>
                {asset.assetName} ({asset.assetCode})
              </option>
            ))}
          </select>
          {validationErrors.primeMoverAssetCode && (
            <span className="field-error">{validationErrors.primeMoverAssetCode}</span>
          )}
        </div>

        <div>
          <label>Tanker Trailer / Chassis *</label>
          <select
            name="tankerAssetCode"
            value={link.tankerAssetCode}
            onChange={(e) => { handleChange(e); setValidationErrors({ ...validationErrors, tankerAssetCode: '' }) }}
            className={validationErrors.tankerAssetCode ? 'input-error' : ''}
          >
            <option value="">Select Tanker Trailer</option>

            {tankerTrailerAssets.map((asset) => (
              <option key={asset.id} value={asset.assetCode}>
                {asset.assetName} ({asset.assetCode}) — Chassis:{' '}
                {asset.serialNumber || 'N/A'}
              </option>
            ))}
          </select>
          {validationErrors.tankerAssetCode && (
            <span className="field-error">{validationErrors.tankerAssetCode}</span>
          )}
        </div>

        <div>
          <label>Linked From *</label>
          <input
            name="linkedFrom"
            type="date"
            value={link.linkedFrom}
            onChange={(e) => { handleChange(e); setValidationErrors({ ...validationErrors, linkedFrom: '' }) }}
            className={validationErrors.linkedFrom ? 'input-error' : ''}
          />
          {validationErrors.linkedFrom && (
            <span className="field-error">{validationErrors.linkedFrom}</span>
          )}
        </div>

        <div>
          <label>Linked To</label>
          <input
            name="linkedTo"
            type="date"
            value={link.linkedTo}
            onChange={(e) => { handleChange(e); setValidationErrors({ ...validationErrors, linkedTo: '' }) }}
            className={validationErrors.linkedTo ? 'input-error' : ''}
          />
          {validationErrors.linkedTo && (
            <span className="field-error">{validationErrors.linkedTo}</span>
          )}
        </div>

        <div>
          <label>Status</label>
          <select name="status" value={link.status} onChange={handleChange}>
            <option>Active</option>
            <option>Inactive</option>
          </select>
        </div>

        <div className="full-width-field">
          <label>Remarks</label>
          <textarea
            name="remarks"
            value={link.remarks}
            onChange={handleChange}
            rows="3"
            placeholder="Example: Initial link / Prime mover changed / Breakdown replacement"
          />
        </div>

        {(selectedPrimeMover || selectedTanker) && (
          <div className="full-width-field">
            <div className="operation-layout-banner">
              <div>
                <span>Prime Mover</span>
                <strong>
                  {selectedPrimeMover
                    ? `${selectedPrimeMover.assetName} (${selectedPrimeMover.assetCode})`
                    : 'Not selected'}
                </strong>
              </div>

              <div>
                <span>Tanker Trailer</span>
                <strong>
                  {selectedTanker
                    ? `${selectedTanker.assetName} (${selectedTanker.assetCode})`
                    : 'Not selected'}
                </strong>
              </div>

              <div>
                <span>Chassis</span>
                <strong>{selectedTanker?.serialNumber || 'N/A'}</strong>
              </div>
            </div>
          </div>
        )}

        <div className="form-actions">
          <button type="submit" disabled={loading}>
            {loading
              ? 'Please wait...'
              : editId === null
                ? 'Save Link'
                : 'Update Link'}
          </button>

          {editId !== null && (
            <button type="button" onClick={handleCancelEdit} disabled={loading}>
              Cancel Edit
            </button>
          )}
        </div>
      </form>

      <div className="section-title">
        <h3>Saved Prime Mover - Tanker Links</h3>
        <p>
          Active links are used in Operation Entry. Inactive links are retained
          as history.
        </p>
      </div>

      <div className="report-filter-panel no-print">
        <div>
          <label>Status Filter</label>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
          >
            <option value="">All</option>
            <option>Active</option>
            <option>Inactive</option>
          </select>
        </div>

        <div className="report-filter-actions">
          <button type="button" onClick={loadLinks} disabled={loading}>
            {loading ? 'Loading...' : 'Reload'}
          </button>
        </div>
      </div>

      {closeForm.linkId && (
        <div className="info-box">
          <strong>Close Active Link</strong>

          <div className="operation-entry-subgrid" style={{ marginTop: 12 }}>
            <div>
              <label>Close Date</label>
              <input
                name="linkedTo"
                type="date"
                value={closeForm.linkedTo}
                onChange={handleCloseFormChange}
              />
            </div>

            <div className="full-width-field">
              <label>Close Remarks</label>
              <input
                name="remarks"
                type="text"
                value={closeForm.remarks}
                onChange={handleCloseFormChange}
                placeholder="Example: Prime mover breakdown"
              />
            </div>
          </div>

          <div className="form-actions">
            <button type="button" onClick={handleCloseLink} disabled={loading}>
              Confirm Close Link
            </button>

            <button
              type="button"
              onClick={() =>
                setCloseForm({
                  linkId: null,
                  linkedTo: today,
                  remarks: '',
                })
              }
              disabled={loading}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <table>
        <thead>
          <tr>
            <th>Prime Mover</th>
            <th>Tanker Trailer</th>
            <th>Chassis No.</th>
            <th>Linked From</th>
            <th>Linked To</th>
            <th>Status</th>
            <th>Remarks</th>
            <th>Created By</th>
            <th>Actions</th>
          </tr>
        </thead>

        <tbody>
          {links.length === 0 ? (
            <tr>
              <td colSpan="9" className="empty-table">
                No Prime Mover - Tanker links found.
              </td>
            </tr>
          ) : (
            links.map((item) => (
              <tr key={item.id}>
                <td>
                  <strong>{item.primeMoverAssetName}</strong>
                  <br />
                  <small>{item.primeMoverAssetCode}</small>
                </td>

                <td>
                  <strong>{item.tankerAssetName}</strong>
                  <br />
                  <small>{item.tankerAssetCode}</small>
                </td>

                <td>{item.tankerChassisNumber || 'N/A'}</td>
                <td>{item.linkedFrom}</td>
                <td>{item.linkedTo || '-'}</td>

                <td>
                  <span
                    className={`status-badge ${String(
                      item.status || ''
                    ).toLowerCase()}`}
                  >
                    {item.status}
                  </span>
                </td>

                <td>{item.remarks}</td>
                <td>{item.createdBy || '-'}</td>

                <td>
                  <div className="table-actions">
                    <button
                      type="button"
                      onClick={() => handleEdit(item)}
                      disabled={loading}
                    >
                      Edit
                    </button>

                    {item.status === 'Active' && (
                      <button
                        type="button"
                        onClick={() => openCloseForm(item)}
                        disabled={loading}
                      >
                        Close
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => { setSuccessMsg(''); setErrorMsg(''); setConfirmDeleteItem(item) }}
                      disabled={loading}
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

export default PrimeMoverTankerLinkMaster