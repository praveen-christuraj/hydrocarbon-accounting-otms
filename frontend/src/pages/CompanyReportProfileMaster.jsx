import { useEffect, useState } from 'react'
import {
  getCompanyReportProfiles,
  createCompanyReportProfile,
  updateCompanyReportProfile,
  deleteCompanyReportProfile,
} from '../api/companyReportProfileApi'

const emptyProfile = {
  id: null,
  profileName: '',
  companyName: '',
  systemName: 'Hydrocarbon Accounting System',
  reportSubtitle: 'Tank Gauging Quantity Report',
  logoUrl: '',
  logoText: 'LOGO',
  footerFormula:
    'Formula: GOV = TOV - Free Water | GSV = GOV × VCF | NSV = GSV - BS&W Volume | LT = NSV × Table 11 LT Factor | MT = LT × 1.01605',
  footerNote:
    'This report is system-generated from saved operation transaction data. Verify all measurements, calibration references, and approval status before operational or commercial use.',
  status: 'Active',
}

function CompanyReportProfileMaster({ loggedInUser }) {
  const [profiles, setProfiles] = useState([])
  const [profile, setProfile] = useState(emptyProfile)
  const [editId, setEditId] = useState(null)
  const [loading, setLoading] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [validationErrors, setValidationErrors] = useState({})
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)

  const isAdminBootstrap =
    String(loggedInUser?.username || '').toLowerCase() === 'admin'

  const hasPermission = (permissionName) => {
    if (isAdminBootstrap) return true
    if (!loggedInUser || !Array.isArray(loggedInUser.permissions)) return false
    return loggedInUser.permissions.some(
      (p) => p.permissionName === permissionName
    )
  }

  const canManageProfiles = hasPermission('Manage Company Report Profile')

  const reloadProfiles = async () => {
    try {
      setLoading(true)
      const profilesFromApi = await getCompanyReportProfiles()
      setProfiles(profilesFromApi)
    } catch (error) {
      setErrorMsg(error.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    reloadProfiles()
  }, [])

  const handleChange = (e) => {
    setProfile({
      ...profile,
      [e.target.name]: e.target.value,
    })
  }

  const handleLogoUpload = (e) => {
    const selectedFile = e.target.files[0]

    if (!selectedFile) {
      return
    }

    setErrorMsg('')

    const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg']

    if (!allowedTypes.includes(selectedFile.type)) {
      setErrorMsg('Only PNG, JPG, and JPEG logo files are allowed.')
      e.target.value = ''
      return
    }

    const maxSizeBytes = 1.5 * 1024 * 1024

    if (selectedFile.size > maxSizeBytes) {
      setErrorMsg('Logo is too large. Please upload an image below 1.5 MB.')
      e.target.value = ''
      return
    }

    const reader = new FileReader()

    reader.onload = () => {
      setProfile({
        ...profile,
        logoUrl: reader.result,
      })
    }

    reader.readAsDataURL(selectedFile)
  }

  const handleRemoveLogo = () => {
    setProfile({
      ...profile,
      logoUrl: '',
    })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSuccessMsg('')
    setErrorMsg('')
    setValidationErrors({})

    if (!canManageProfiles) {
      setErrorMsg('You do not have permission to manage company report profiles.')
      return
    }

    const errors = {}

    if (profile.profileName.trim() === '') {
      errors.profileName = 'Profile Name is required.'
    }

    if (profile.companyName.trim() === '') {
      errors.companyName = 'Company Name is required.'
    }

    if (profile.systemName.trim() === '') {
      errors.systemName = 'System Name is required.'
    }

    if (profile.reportSubtitle.trim() === '') {
      errors.reportSubtitle = 'Report Subtitle is required.'
    }

    if (profile.logoText.trim() === '') {
      errors.logoText = 'Logo Placeholder Text is required.'
    }

    setValidationErrors(errors)

    if (Object.keys(errors).length > 0) {
      return
    }

    const cleanedProfile = {
      ...profile,
      profileName: profile.profileName.trim(),
      companyName: profile.companyName.trim(),
      systemName: profile.systemName.trim(),
      reportSubtitle: profile.reportSubtitle.trim(),
      logoText: profile.logoText.trim(),
      status: profile.status || 'Active',
    }

    try {
      setLoading(true)

      if (editId === null) {
        await createCompanyReportProfile(cleanedProfile)
        setSuccessMsg('Company report profile saved successfully')
      } else {
        await updateCompanyReportProfile(editId, cleanedProfile)
        setSuccessMsg('Company report profile updated successfully')
      }

      await reloadProfiles()
      setProfile(emptyProfile)
      setEditId(null)
      setShowPreview(false)
    } catch (error) {
      setErrorMsg(error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleEdit = (profileToEdit) => {
    setSuccessMsg('')
    setErrorMsg('')

    if (!canManageProfiles) {
      setErrorMsg('You do not have permission to manage company report profiles.')
      return
    }

    setProfile({
      id: profileToEdit.id,
      profileName: profileToEdit.profileName,
      companyName: profileToEdit.companyName,
      systemName: profileToEdit.systemName,
      reportSubtitle: profileToEdit.reportSubtitle,
      logoUrl: profileToEdit.logoUrl || '',
      logoText: profileToEdit.logoText || 'LOGO',
      footerFormula: profileToEdit.footerFormula || '',
      footerNote: profileToEdit.footerNote || '',
      status: profileToEdit.status || 'Active',
    })

    setEditId(profileToEdit.id)
    setShowPreview(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleDelete = async () => {
    setSuccessMsg('')
    setErrorMsg('')

    if (!canManageProfiles) {
      setErrorMsg('You do not have permission to manage company report profiles.')
      setConfirmDeleteId(null)
      return
    }

    try {
      setLoading(true)
      await deleteCompanyReportProfile(confirmDeleteId)
      await reloadProfiles()

      if (editId === confirmDeleteId) {
        setProfile(emptyProfile)
        setEditId(null)
        setShowPreview(false)
      }

      setConfirmDeleteId(null)
      setSuccessMsg('Company report profile deleted successfully')
    } catch (error) {
      setErrorMsg(error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleCancelEdit = () => {
    setProfile(emptyProfile)
    setEditId(null)
    setShowPreview(false)
  }

  const handleNewProfile = () => {
    setProfile(emptyProfile)
    setEditId(null)
    setShowPreview(false)
  }

  return (
    <div>
      <div className="page-title">
        <div>
          <h2>Company Report Profile Master</h2>
          <p>
            Create and manage company names, logos, and report footer settings
            used in printable reports.
          </p>
        </div>

        <span className="record-count">{profiles.length} Profiles</span>
      </div>

      {!canManageProfiles && (
        <div className="info-box">
          You have View Company Report Profile permission only. Create, edit, and
          delete actions are disabled.
        </div>
      )}

      {successMsg && (
        <div className="success-box">{successMsg}</div>
      )}

      {errorMsg && (
        <div className="error-box">{errorMsg}</div>
      )}

      {confirmDeleteId && (
        <div className="confirm-overlay">
          <div className="confirm-box">
            <p>Are you sure you want to delete this company report profile?</p>
            <div className="confirm-actions">
              <button onClick={handleDelete} disabled={loading}>
                {loading ? 'Deleting...' : 'Yes, Delete'}
              </button>
              <button onClick={() => setConfirmDeleteId(null)} disabled={loading}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {canManageProfiles && (
        <form onSubmit={handleSubmit}>
          <div>
            <label>Profile Name</label>
            <input
              name="profileName"
              type="text"
              value={profile.profileName}
              onChange={(e) => { handleChange(e); setValidationErrors({ ...validationErrors, profileName: '' }) }}
              placeholder="Example: Allied Company A"
              disabled={loading}
              className={validationErrors.profileName ? 'input-error' : ''}
            />
            {validationErrors.profileName && (
              <span className="field-error">{validationErrors.profileName}</span>
            )}
          </div>

          <div>
            <label>Company Name</label>
            <input
              name="companyName"
              type="text"
              value={profile.companyName}
              onChange={(e) => { handleChange(e); setValidationErrors({ ...validationErrors, companyName: '' }) }}
              placeholder="Enter company name"
              disabled={loading}
              className={validationErrors.companyName ? 'input-error' : ''}
            />
            {validationErrors.companyName && (
              <span className="field-error">{validationErrors.companyName}</span>
            )}
          </div>

          <div>
            <label>System Name</label>
            <input
              name="systemName"
              type="text"
              value={profile.systemName}
              onChange={(e) => { handleChange(e); setValidationErrors({ ...validationErrors, systemName: '' }) }}
              placeholder="Hydrocarbon Accounting System"
              disabled={loading}
              className={validationErrors.systemName ? 'input-error' : ''}
            />
            {validationErrors.systemName && (
              <span className="field-error">{validationErrors.systemName}</span>
            )}
          </div>

          <div>
            <label>Report Subtitle</label>
            <input
              name="reportSubtitle"
              type="text"
              value={profile.reportSubtitle}
              onChange={(e) => { handleChange(e); setValidationErrors({ ...validationErrors, reportSubtitle: '' }) }}
              placeholder="Tank Gauging Quantity Report"
              disabled={loading}
              className={validationErrors.reportSubtitle ? 'input-error' : ''}
            />
            {validationErrors.reportSubtitle && (
              <span className="field-error">{validationErrors.reportSubtitle}</span>
            )}
          </div>

          <div>
            <label>Logo Placeholder Text</label>
            <input
              name="logoText"
              type="text"
              value={profile.logoText}
              onChange={(e) => { handleChange(e); setValidationErrors({ ...validationErrors, logoText: '' }) }}
              placeholder="LOGO"
              disabled={loading}
              className={validationErrors.logoText ? 'input-error' : ''}
            />
            {validationErrors.logoText && (
              <span className="field-error">{validationErrors.logoText}</span>
            )}
          </div>

          <div>
            <label>Status</label>
            <select
              name="status"
              value={profile.status}
              onChange={handleChange}
              disabled={loading}
            >
              <option>Active</option>
              <option>Inactive</option>
              <option>Blocked</option>
            </select>
          </div>

          <div className="full-width-field">
            <label>Company Logo</label>
            <input
              type="file"
              accept=".png,.jpg,.jpeg,image/png,image/jpeg"
              onChange={handleLogoUpload}
              disabled={loading}
            />

            {profile.logoUrl ? (
              <div className="company-profile-logo-row">
                <img
                  src={profile.logoUrl}
                  alt="Company Logo Preview"
                  className="company-profile-logo-preview"
                />

                <button
                  type="button"
                  onClick={handleRemoveLogo}
                  disabled={loading}
                >
                  Remove Logo
                </button>
              </div>
            ) : (
              <div className="info-box">
                No logo uploaded. Printable reports will show the placeholder
                text.
              </div>
            )}
          </div>

          <div className="full-width-field">
            <label>Footer Formula</label>
            <textarea
              name="footerFormula"
              value={profile.footerFormula}
              onChange={handleChange}
              rows="3"
              placeholder="Enter formula text for report footer"
              disabled={loading}
            />
          </div>

          <div className="full-width-field">
            <label>Footer Note</label>
            <textarea
              name="footerNote"
              value={profile.footerNote}
              onChange={handleChange}
              rows="3"
              placeholder="Enter footer note"
              disabled={loading}
            />
          </div>

          <div className="form-actions">
            <button type="submit" disabled={loading}>
              {loading
                ? 'Please wait...'
                : editId === null
                  ? 'Save Profile'
                  : 'Update Profile'}
            </button>

            <button type="button" onClick={handleNewProfile} disabled={loading}>
              New Profile
            </button>

            {editId !== null && (
              <button
                type="button"
                onClick={handleCancelEdit}
                disabled={loading}
              >
                Cancel Edit
              </button>
            )}

            <button
              type="button"
              onClick={() => setShowPreview(!showPreview)}
              disabled={loading}
            >
              {showPreview ? 'Hide Preview' : 'Show Preview'}
            </button>
          </div>
        </form>
      )}

      {canManageProfiles && showPreview && (
        <div className="company-profile-preview-card">
          <div className="company-profile-preview-logo">
            {profile.logoUrl ? (
              <img src={profile.logoUrl} alt="Company Logo" />
            ) : (
              <span>{profile.logoText || 'LOGO'}</span>
            )}
          </div>

          <div>
            <h3>{profile.companyName || 'Company Name'}</h3>
            <p>{profile.systemName || 'Hydrocarbon Accounting System'}</p>
            <p>{profile.reportSubtitle || 'Report Subtitle'}</p>
          </div>
        </div>
      )}

      <div className="section-title">
        <h3>Saved Company Report Profiles</h3>
        <p>
          These profiles are saved in the backend database and can be used from
          Tank Gauging report print settings.
        </p>
      </div>

      <table>
        <thead>
          <tr>
            <th>Profile Name</th>
            <th>Company Name</th>
            <th>System Name</th>
            <th>Report Subtitle</th>
            <th>Logo</th>
            <th>Status</th>
            {canManageProfiles && <th>Actions</th>}
          </tr>
        </thead>

        <tbody>
          {profiles.length === 0 ? (
            <tr>
              <td
                colSpan={canManageProfiles ? 7 : 6}
                className="empty-table"
              >
                No company report profiles found.
              </td>
            </tr>
          ) : (
            profiles.map((item) => (
              <tr key={item.id}>
                <td>{item.profileName}</td>
                <td>{item.companyName}</td>
                <td>{item.systemName}</td>
                <td>{item.reportSubtitle}</td>
                <td>
                  {item.logoUrl ? (
                    <img
                      src={item.logoUrl}
                      alt={item.profileName}
                      className="company-profile-table-logo"
                    />
                  ) : (
                    <span className="permission-badge">
                      {item.logoText || 'LOGO'}
                    </span>
                  )}
                </td>
                <td>
                  <span className={`status-badge ${item.status.toLowerCase()}`}>
                    {item.status}
                  </span>
                </td>

                {canManageProfiles && (
                  <td>
                    <button type="button" onClick={() => handleEdit(item)}>
                      Edit
                    </button>

                    <button type="button" onClick={() => { setSuccessMsg(''); setErrorMsg(''); setConfirmDeleteId(item.id) }}>
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
        Recommended: keep one Active profile for each allied company. Inactive
        or Blocked profiles will remain stored but should not be selected for new
        reports.
      </div>
    </div>
  )
}

export default CompanyReportProfileMaster