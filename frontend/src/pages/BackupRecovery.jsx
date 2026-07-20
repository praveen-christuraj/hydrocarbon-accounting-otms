import { useEffect, useMemo, useState } from 'react'
import {
  approveBackupRestoreRequest,
  cancelBackupRestoreRequest,
  cleanupBackups,
  createManualBackup,
  createBackupRestoreRequest,
  deleteBackup,
  downloadBackup,
  executeBackupRestoreRequest,
  getBackupRestoreRequests,
  getBackupJobs,
  getBackupSettings,
  rejectBackupRestoreRequest,
  updateBackupSettings,
  validateBackupRestoreRequest,
  verifyBackupChecksum,
} from '../api/backupApi'
import PaginationControls, { paginateRows } from '../components/common/PaginationControls'

const emptySettings = {
  enabled: false,
  scheduleMode: 'Daily',
  intervalValue: 24,
  runTime: '02:00',
  retentionDays: 30,
  keepMinimum: 5,
  backupDirectory: '',
  compressionEnabled: true,
}

const formatDateTime = (value) => {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString()
}

const formatBytes = (value) => {
  const bytes = Number(value || 0)
  if (!bytes) return '-'
  const mb = bytes / (1024 * 1024)
  if (mb < 1024) return `${mb.toFixed(2)} MB`
  return `${(mb / 1024).toFixed(2)} GB`
}

function BackupRecovery({ loggedInUser }) {
  const [settings, setSettings] = useState(emptySettings)
  const [jobs, setJobs] = useState([])
  const [restoreRequests, setRestoreRequests] = useState([])
  const [description, setDescription] = useState('')
  const [restoreForm, setRestoreForm] = useState({
    backupJobId: '',
    reason: '',
    businessImpact: '',
  })
  const [statusFilter, setStatusFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [restoreStatusFilter, setRestoreStatusFilter] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [restoreCurrentPage, setRestoreCurrentPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [validationErrors, setValidationErrors] = useState({})

  // Confirm / Prompt overlays
  const [confirmManualBackup, setConfirmManualBackup] = useState(false)
  const [confirmDeleteBackup, setConfirmDeleteBackup] = useState(null)
  const [deleteBackupText, setDeleteBackupText] = useState('')
  const [confirmCleanup, setConfirmCleanup] = useState(false)
  const [confirmRestoreRequest, setConfirmRestoreRequest] = useState(false)
  const [confirmValidateRequest, setConfirmValidateRequest] = useState(null)
  const [confirmExecuteRestore, setConfirmExecuteRestore] = useState(null)
  const [executeConfirmText, setExecuteConfirmText] = useState('')
  const [executeRemarks, setExecuteRemarks] = useState('')
  const [approvalRemarks, setApprovalRemarks] = useState('')
  const [actionRequest, setActionRequest] = useState(null) // { request, action }

  const isAdminBootstrap =
    String(loggedInUser?.username || '').toLowerCase() === 'admin' ||
    (loggedInUser?.roles || []).some(
      (role) =>
        String(role?.role_name || role?.roleName || '').toLowerCase() ===
        'admin'
    ) ||
    String(loggedInUser?.role_name || loggedInUser?.roleName || '').toLowerCase() ===
      'admin'

  const hasPermission = (permissionName) => {
    if (isAdminBootstrap) return true
    if (!loggedInUser || !Array.isArray(loggedInUser.permissions)) return false
    return loggedInUser.permissions.some(
      (p) => p.permissionName === permissionName
    )
  }

  const loadData = async () => {
    try {
      setLoading(true)
      const [settingsData, jobsData, restoreRequestData] = await Promise.all([
        getBackupSettings(),
        getBackupJobs({
          status: statusFilter,
          backupType: typeFilter,
        }),
        getBackupRestoreRequests({
          status: restoreStatusFilter,
        }),
      ])
      setSettings(settingsData)
      setJobs(jobsData)
      setRestoreRequests(restoreRequestData)
      setCurrentPage(1)
      setRestoreCurrentPage(1)
    } catch (error) {
      setErrorMsg(error.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [statusFilter, typeFilter, restoreStatusFilter])

  const summary = useMemo(() => {
    const completed = jobs.filter((job) => job.status === 'Completed')
    const failed = jobs.filter((job) => job.status === 'Failed')
    return {
      lastCompleted: completed[0] || null,
      failedCount: failed.length,
      runningCount: jobs.filter((job) => ['Pending', 'Running'].includes(job.status)).length,
    }
  }, [jobs])

  const visibleJobs = paginateRows(jobs, currentPage)
  const visibleRestoreRequests = paginateRows(restoreRequests, restoreCurrentPage)
  const completedBackupOptions = jobs.filter((job) => job.status === 'Completed')

  const updateField = (fieldName, value) => {
    setSettings((current) => ({
      ...current,
      [fieldName]: value,
    }))
  }

  const saveSettings = async (event) => {
    event.preventDefault()
    if (!hasPermission('Manage Backup Settings')) {
      setErrorMsg('You do not have permission to manage backup settings')
      return
    }
    setSuccessMsg('')
    setErrorMsg('')
    setValidationErrors({})
    if (settings.scheduleMode === 'Daily' && !settings.runTime) {
      setValidationErrors({ runTime: 'Run time is required for daily schedule' })
      return
    }

    try {
      setLoading(true)
      const updated = await updateBackupSettings(settings)
      setSettings(updated)
      setSuccessMsg('Backup settings saved')
      await loadData()
    } catch (error) {
      setErrorMsg(error.message)
    } finally {
      setLoading(false)
    }
  }

  const runManualBackup = async (event) => {
    event.preventDefault()
    if (!hasPermission('Create Manual Backup')) {
      setErrorMsg('You do not have permission to create manual backups')
      return
    }
    setSuccessMsg('')
    setErrorMsg('')
    setConfirmManualBackup(true)
  }

  const executeManualBackup = async () => {
    if (!hasPermission('Create Manual Backup')) {
      setErrorMsg('You do not have permission to create manual backups')
      return
    }
    setConfirmManualBackup(false)
    try {
      setLoading(true)
      await createManualBackup(description || 'Manual backup')
      setDescription('')
      await loadData()
      setSuccessMsg('Manual backup completed')
    } catch (error) {
      await loadData()
      setErrorMsg(error.message)
    } finally {
      setLoading(false)
    }
  }

  const runVerifyChecksum = async (job) => {
    setSuccessMsg('')
    setErrorMsg('')
    try {
      setLoading(true)
      const result = await verifyBackupChecksum(job.id)
      await loadData()
      setSuccessMsg(result.matched ? 'Checksum verified successfully' : 'Checksum mismatch detected')
    } catch (error) {
      await loadData()
      setErrorMsg(error.message)
    } finally {
      setLoading(false)
    }
  }

  const runDownloadBackup = async (job) => {
    setErrorMsg('')
    try {
      setLoading(true)
      await downloadBackup(job.id, job.fileName || `${job.backupNumber}.dump`)
      await loadData()
    } catch (error) {
      await loadData()
      setErrorMsg(error.message)
    } finally {
      setLoading(false)
    }
  }

  const runDeleteBackup = async (job) => {
    setSuccessMsg('')
    setErrorMsg('')
    setDeleteBackupText('')
    setConfirmDeleteBackup(job)
  }

  const executeDeleteBackup = async () => {
    const job = confirmDeleteBackup
    if (deleteBackupText.trim() !== job.backupNumber) {
      setErrorMsg('Confirmation text does not match the backup number')
      return
    }

    setConfirmDeleteBackup(null)
    setDeleteBackupText('')
    try {
      setLoading(true)
      await deleteBackup(job.id)
      await loadData()
      setSuccessMsg('Backup file deleted. Job history retained.')
    } catch (error) {
      await loadData()
      setErrorMsg(error.message)
    } finally {
      setLoading(false)
    }
  }

  const runCleanup = async () => {
    setSuccessMsg('')
    setErrorMsg('')
    setConfirmCleanup(true)
  }

  const executeCleanup = async () => {
    setConfirmCleanup(false)
    try {
      setLoading(true)
      const result = await cleanupBackups()
      await loadData()
      setSuccessMsg(`Cleanup complete. Deleted: ${result.deleted_count}, Skipped: ${result.skipped_count}`)
    } catch (error) {
      await loadData()
      setErrorMsg(error.message)
    } finally {
      setLoading(false)
    }
  }

  const updateRestoreField = (fieldName, value) => {
    setRestoreForm((current) => ({
      ...current,
      [fieldName]: value,
    }))
  }

  const runCreateRestoreRequest = async (event) => {
    event.preventDefault()
    setSuccessMsg('')
    setErrorMsg('')
    setValidationErrors({})

    const errors = {}
    if (!restoreForm.backupJobId) {
      errors.backupJobId = 'Select a completed backup'
    }
    if (restoreForm.reason.trim() === '') {
      errors.reason = 'Restore reason is required'
    }
    setValidationErrors(errors)
    if (Object.keys(errors).length > 0) return

    setConfirmRestoreRequest(true)
  }

  const executeCreateRestoreRequest = async () => {
    setConfirmRestoreRequest(false)
    try {
      setLoading(true)
      await createBackupRestoreRequest({
        backupJobId: Number(restoreForm.backupJobId),
        reason: restoreForm.reason,
        businessImpact: restoreForm.businessImpact,
      })
      setRestoreForm({
        backupJobId: '',
        reason: '',
        businessImpact: '',
      })
      await loadData()
      setSuccessMsg('Restore approval request created')
    } catch (error) {
      await loadData()
      setErrorMsg(error.message)
    } finally {
      setLoading(false)
    }
  }

  const runRestoreRequestAction = async (request, action) => {
    setSuccessMsg('')
    setErrorMsg('')
    setApprovalRemarks('')
    setActionRequest({ request, action })
  }

  const executeRestoreRequestAction = async () => {
    const { request, action } = actionRequest
    const remarks = approvalRemarks

    if (action === 'reject' && remarks.trim() === '') {
      setErrorMsg('Rejection remarks are required')
      return
    }

    setActionRequest(null)
    setApprovalRemarks('')

    const promptLabels = {
      approve: 'Approval remarks',
      reject: 'Rejection remarks',
      cancel: 'Cancellation remarks',
    }

    try {
      setLoading(true)
      if (action === 'approve') {
        await approveBackupRestoreRequest(request.id, remarks)
      } else if (action === 'reject') {
        await rejectBackupRestoreRequest(request.id, remarks)
      } else {
        await cancelBackupRestoreRequest(request.id, remarks)
      }
      await loadData()
      setSuccessMsg(`Restore request ${action} action completed`)
    } catch (error) {
      await loadData()
      setErrorMsg(error.message)
    } finally {
      setLoading(false)
    }
  }

  const runValidateRestoreRequest = async (request) => {
    setSuccessMsg('')
    setErrorMsg('')
    setConfirmValidateRequest(request)
  }

  const executeValidateRestoreRequest = async () => {
    const request = confirmValidateRequest
    setConfirmValidateRequest(null)
    try {
      setLoading(true)
      await validateBackupRestoreRequest(request.id)
      await loadData()
      setSuccessMsg('Restore validation completed')
    } catch (error) {
      await loadData()
      setErrorMsg(error.message)
    } finally {
      setLoading(false)
    }
  }

  const runExecuteRestoreRequest = async (request) => {
    setSuccessMsg('')
    setErrorMsg('')
    setExecuteConfirmText('')
    setExecuteRemarks('')
    setConfirmExecuteRestore(request)
  }

  const executeExecuteRestoreRequest = async () => {
    const request = confirmExecuteRestore
    const expectedConfirmation = `EXECUTE RESTORE ${request.requestNumber}`
    if (executeConfirmText.trim() !== expectedConfirmation) {
      setErrorMsg('Confirmation text does not match')
      return
    }

    setConfirmExecuteRestore(null)
    try {
      setLoading(true)
      await executeBackupRestoreRequest(request.id, executeConfirmText.trim(), executeRemarks)
      await loadData()
      setSuccessMsg('Production restore completed')
    } catch (error) {
      await loadData()
      setErrorMsg(error.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <div className="page-title">
        <div>
          <h2>Backup Recovery</h2>
          <p>Manual backup, automatic backup, validation, and controlled restore execution.</p>
        </div>
        <span className="record-count">{jobs.length} Jobs</span>
      </div>

      {successMsg && (
        <div className="success-box">{successMsg}</div>
      )}

      {errorMsg && (
        <div className="error-box">{errorMsg}</div>
      )}

      {validationErrors.runTime && (
        <div className="error-box">{validationErrors.runTime}</div>
      )}

      {/* Confirm: Manual Backup */}
      {confirmManualBackup && (
        <div className="confirm-overlay">
          <div className="confirm-box">
            <p>Create a manual database backup now?</p>
            <div className="confirm-actions">
              <button onClick={executeManualBackup} disabled={loading}>
                {loading ? 'Creating...' : 'Yes, Create Backup'}
              </button>
              <button onClick={() => setConfirmManualBackup(false)} disabled={loading}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm: Delete Backup */}
      {confirmDeleteBackup && (
        <div className="confirm-overlay">
          <div className="confirm-box">
            <p>Type <strong>{confirmDeleteBackup.backupNumber}</strong> to delete the backup file. Job history will be retained.</p>
            <input
              type="text"
              value={deleteBackupText}
              onChange={(e) => setDeleteBackupText(e.target.value)}
              placeholder={confirmDeleteBackup.backupNumber}
            />
            <div className="confirm-actions">
              <button onClick={executeDeleteBackup} disabled={loading}>
                {loading ? 'Deleting...' : 'Confirm Delete'}
              </button>
              <button onClick={() => { setConfirmDeleteBackup(null); setDeleteBackupText('') }} disabled={loading}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm: Cleanup */}
      {confirmCleanup && (
        <div className="confirm-overlay">
          <div className="confirm-box">
            <p>Run retention cleanup now? This uses {settings.retentionDays} retention days and keeps at least {settings.keepMinimum} completed backups.</p>
            <div className="confirm-actions">
              <button onClick={executeCleanup} disabled={loading}>
                {loading ? 'Cleaning...' : 'Yes, Run Cleanup'}
              </button>
              <button onClick={() => setConfirmCleanup(false)} disabled={loading}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm: Restore Request */}
      {confirmRestoreRequest && (
        <div className="confirm-overlay">
          <div className="confirm-box">
            <p>Create restore approval request? This does not restore the database.</p>
            <div className="confirm-actions">
              <button onClick={executeCreateRestoreRequest} disabled={loading}>
                {loading ? 'Creating...' : 'Yes, Create Request'}
              </button>
              <button onClick={() => setConfirmRestoreRequest(false)} disabled={loading}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm: Validate Restore Request */}
      {confirmValidateRequest && (
        <div className="confirm-overlay">
          <div className="confirm-box">
            <p>Validate this restore request against the separate validation database? Production will not be restored.</p>
            <div className="confirm-actions">
              <button onClick={executeValidateRestoreRequest} disabled={loading}>
                {loading ? 'Validating...' : 'Yes, Validate'}
              </button>
              <button onClick={() => setConfirmValidateRequest(null)} disabled={loading}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm: Execute Restore */}
      {confirmExecuteRestore && (
        <div className="confirm-overlay">
          <div className="confirm-box">
            <p>This will restore the production database from the selected backup. A safety backup will be created first. Continue?</p>
            <label>Type <strong>EXECUTE RESTORE {confirmExecuteRestore.requestNumber}</strong> to confirm:</label>
            <input
              type="text"
              value={executeConfirmText}
              onChange={(e) => setExecuteConfirmText(e.target.value)}
              placeholder={`EXECUTE RESTORE ${confirmExecuteRestore.requestNumber}`}
            />
            <label>Execution remarks</label>
            <input
              type="text"
              value={executeRemarks}
              onChange={(e) => setExecuteRemarks(e.target.value)}
              placeholder="Optional remarks"
            />
            <div className="confirm-actions">
              <button onClick={executeExecuteRestoreRequest} disabled={loading}>
                {loading ? 'Executing...' : 'Execute Restore'}
              </button>
              <button onClick={() => { setConfirmExecuteRestore(null); setExecuteConfirmText(''); setExecuteRemarks('') }} disabled={loading}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Prompt: Approval / Rejection / Cancellation remarks */}
      {actionRequest && (
        <div className="confirm-overlay">
          <div className="confirm-box">
            <p>
              {actionRequest.action === 'approve' ? 'Approval remarks' :
               actionRequest.action === 'reject' ? 'Rejection remarks' :
               'Cancellation remarks'}
            </p>
            <input
              type="text"
              value={approvalRemarks}
              onChange={(e) => setApprovalRemarks(e.target.value)}
              placeholder={actionRequest.action === 'reject' ? 'Required for rejection' : 'Optional'}
            />
            <div className="confirm-actions">
              <button onClick={executeRestoreRequestAction} disabled={loading}>
                {loading ? 'Processing...' : 'Confirm'}
              </button>
              <button onClick={() => { setActionRequest(null); setApprovalRemarks('') }} disabled={loading}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="backup-kpi-grid">
        <div className="info-box">
          <strong>Auto Backup</strong>
          <p>{settings.enabled ? 'Enabled' : 'Disabled'}</p>
          <small>
            {settings.scheduleMode} | Next: {formatDateTime(settings.nextRunAt)}
          </small>
        </div>
        <div className="info-box">
          <strong>Last Successful Backup</strong>
          <p>{summary.lastCompleted ? summary.lastCompleted.backupNumber : '-'}</p>
          <small>{formatDateTime(summary.lastCompleted?.completedAt)}</small>
        </div>
        <div className="info-box">
          <strong>Running / Pending</strong>
          <p>{summary.runningCount}</p>
          <small>Duplicate backup runs are blocked by the backend.</small>
        </div>
        <div className="info-box">
          <strong>Failed Jobs</strong>
          <p>{summary.failedCount}</p>
          <small>Open history for the latest error message.</small>
        </div>
      </div>

      {hasPermission('Create Manual Backup') && (
      <>
      <div className="section-title">
        <h3>Manual Backup</h3>
        <p>Create an immediate PostgreSQL backup using the backend server.</p>
      </div>
      <form onSubmit={runManualBackup} className="backup-form">
        <div className="full-width-field">
          <label>Description</label>
          <input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Before maintenance / End of day backup"
            disabled={loading}
          />
        </div>
        <div className="form-actions">
          <button type="submit" disabled={loading}>
            Create Backup
          </button>
          <button type="button" onClick={loadData} disabled={loading}>
            Refresh
          </button>
        </div>
      </form>
      </>)}

      {hasPermission('Manage Backup Settings') && (
      <>
      <div className="section-title">
        <h3>Automatic Backup Settings</h3>
        <p>Frontend-controlled schedule. The backend scheduler executes due jobs.</p>
      </div>
      <form onSubmit={saveSettings} className="backup-form">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={(event) => updateField('enabled', event.target.checked)}
          />
          Enable automatic backup
        </label>

        <div>
          <label>Schedule Mode</label>
          <select
            value={settings.scheduleMode}
            onChange={(event) => updateField('scheduleMode', event.target.value)}
          >
            <option>Minutes</option>
            <option>Hours</option>
            <option>Daily</option>
            <option>Weekly</option>
          </select>
        </div>

        <div>
          <label>Interval Value</label>
          <input
            type="number"
            min="1"
            value={settings.intervalValue}
            onChange={(event) => updateField('intervalValue', event.target.value)}
          />
        </div>

        <div>
          <label>Run Time</label>
          <input
            type="time"
            value={settings.runTime}
            onChange={(event) => { updateField('runTime', event.target.value); setValidationErrors({ ...validationErrors, runTime: '' }) }}
          />
        </div>

        <div>
          <label>Retention Days</label>
          <input
            type="number"
            min="1"
            value={settings.retentionDays}
            onChange={(event) => updateField('retentionDays', event.target.value)}
          />
        </div>

        <div>
          <label>Keep Minimum Backups</label>
          <input
            type="number"
            min="1"
            value={settings.keepMinimum}
            onChange={(event) => updateField('keepMinimum', event.target.value)}
          />
        </div>

        <div className="full-width-field">
          <label>Backup Directory</label>
          <input
            value={settings.backupDirectory}
            onChange={(event) => updateField('backupDirectory', event.target.value)}
            placeholder="Leave blank to use server default backups folder"
          />
        </div>

        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={settings.compressionEnabled}
            onChange={(event) => updateField('compressionEnabled', event.target.checked)}
          />
          Use compressed pg_dump custom format
        </label>

        <div className="form-actions">
          <button type="submit" disabled={loading}>
            Save Settings
          </button>
        </div>
      </form>
      </>)}
      
      <div className="section-title">
        <h3>Backup History</h3>
        <p>Completed and failed backup jobs are retained for audit and operational review.</p>
      </div>
      <div className="filter-panel">
        <div>
          <label>Status</label>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="">All</option>
            <option>Pending</option>
            <option>Running</option>
            <option>Completed</option>
            <option>Failed</option>
            <option>Checksum Mismatch</option>
            <option>Deleted</option>
          </select>
        </div>
        <div>
          <label>Type</label>
          <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
            <option value="">All</option>
            <option>Manual</option>
            <option>Scheduled</option>
          </select>
        </div>
        <div className="filter-actions">
          <button type="button" onClick={loadData} disabled={loading}>
            Refresh
          </button>
          {hasPermission('Run Backup Cleanup') && (
            <button type="button" onClick={runCleanup} disabled={loading}>
              Run Cleanup
            </button>
          )}
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th>Backup No.</th>
            <th>Type</th>
            <th>Status</th>
            <th>File</th>
            <th>Size</th>
            <th>Started</th>
            <th>Completed</th>
            <th>Requested By</th>
            <th>Error / Checksum</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {visibleJobs.length === 0 ? (
            <tr>
              <td colSpan="10" className="empty-table">
                No backup jobs found.
              </td>
            </tr>
          ) : (
            visibleJobs.map((job) => (
              <tr key={job.id}>
                <td>{job.backupNumber}</td>
                <td>{job.backupType}</td>
                <td>
                  <span className={`status-badge ${job.status.toLowerCase()}`}>
                    {job.status}
                  </span>
                </td>
                <td>
                  {job.fileName || '-'}
                  <div className="muted-table-text">{job.databaseName || '-'}</div>
                </td>
                <td>{formatBytes(job.fileSizeBytes)}</td>
                <td>{formatDateTime(job.startedAt)}</td>
                <td>{formatDateTime(job.completedAt)}</td>
                <td>{job.requestedByDisplay || 'System Scheduler'}</td>
                <td>
                  {job.errorMessage ? (
                    <span className="negative">{job.errorMessage}</span>
                  ) : (
                    <span className="muted-table-text">
                      {job.checksumSha256 ? job.checksumSha256.slice(0, 18) : '-'}
                    </span>
                  )}
                </td>
                <td>
                  <div className="table-actions">
                    {hasPermission('Verify Backup Checksum') && job.status === 'Completed' && (
                      <button
                        type="button"
                        onClick={() => runVerifyChecksum(job)}
                        disabled={loading}
                      >
                        Verify
                      </button>
                    )}
                    {hasPermission('Download Backup') && job.status === 'Completed' && (
                      <button
                        type="button"
                        onClick={() => runDownloadBackup(job)}
                        disabled={loading}
                      >
                        Download
                      </button>
                    )}
                    {hasPermission('Delete Backup') &&
                      !['Pending', 'Running', 'Deleted'].includes(job.status) && (
                        <button
                          type="button"
                          onClick={() => runDeleteBackup(job)}
                          disabled={loading}
                        >
                          Delete File
                        </button>
                      )}
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <PaginationControls
        totalRows={jobs.length}
        currentPage={currentPage}
        onPageChange={setCurrentPage}
      />

      <div className="section-title">
        <h3>Restore Request Workflow</h3>
        <p>
          Restore requires approval, validation, exact confirmation text, and an automatic
          safety backup before production execution.
        </p>
      </div>

      {hasPermission('Request Backup Restore') && (
        <form onSubmit={runCreateRestoreRequest} className="backup-form">
          <div>
            <label>Completed Backup</label>
            <select
              value={restoreForm.backupJobId}
              onChange={(event) => { updateRestoreField('backupJobId', event.target.value); setValidationErrors({ ...validationErrors, backupJobId: '' }) }}
              className={validationErrors.backupJobId ? 'input-error' : ''}
            >
              <option value="">Select backup</option>
              {completedBackupOptions.map((job) => (
                <option key={job.id} value={job.id}>
                  {job.backupNumber} | {job.fileName || 'No file name'}
                </option>
              ))}
            </select>
            {validationErrors.backupJobId && (
              <span className="field-error">{validationErrors.backupJobId}</span>
            )}
          </div>
          <div className="full-width-field">
            <label>Reason</label>
            <textarea
              rows="3"
              value={restoreForm.reason}
              onChange={(event) => { updateRestoreField('reason', event.target.value); setValidationErrors({ ...validationErrors, reason: '' }) }}
              placeholder="Explain why this backup may be needed for recovery"
              className={validationErrors.reason ? 'input-error' : ''}
            />
            {validationErrors.reason && (
              <span className="field-error">{validationErrors.reason}</span>
            )}
          </div>
          <div className="full-width-field">
            <label>Business Impact</label>
            <textarea
              rows="3"
              value={restoreForm.businessImpact}
              onChange={(event) => updateRestoreField('businessImpact', event.target.value)}
              placeholder="Describe operational impact, affected period, and urgency"
            />
          </div>
          <div className="form-actions">
            <button type="submit" disabled={loading}>
              Request Restore Approval
            </button>
          </div>
        </form>
      )}

      <div className="filter-panel">
        <div>
          <label>Restore Request Status</label>
          <select
            value={restoreStatusFilter}
            onChange={(event) => setRestoreStatusFilter(event.target.value)}
          >
            <option value="">All</option>
            <option>Pending Approval</option>
            <option>Approved</option>
            <option>Validation Running</option>
            <option>Validated</option>
            <option>Validation Failed</option>
            <option>Restore Running</option>
            <option>Restored</option>
            <option>Restore Failed</option>
            <option>Rejected</option>
            <option>Cancelled</option>
          </select>
        </div>
        <div className="filter-actions">
          <button type="button" onClick={loadData} disabled={loading}>
            Refresh
          </button>
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th>Request No.</th>
            <th>Backup</th>
            <th>Status</th>
            <th>Reason</th>
            <th>Requested By</th>
            <th>Actioned By</th>
            <th>Validation</th>
            <th>Remarks</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {visibleRestoreRequests.length === 0 ? (
            <tr>
              <td colSpan="9" className="empty-table">
                No restore requests found.
              </td>
            </tr>
          ) : (
            visibleRestoreRequests.map((request) => (
              <tr key={request.id}>
                <td>{request.requestNumber}</td>
                <td>{request.backupNumber}</td>
                <td>
                  <span className={`status-badge ${request.status.toLowerCase().replaceAll(' ', '-')}`}>
                    {request.status}
                  </span>
                </td>
                <td>
                  {request.reason}
                  {request.businessImpact && (
                    <div className="muted-table-text">{request.businessImpact}</div>
                  )}
                </td>
                <td>
                  {request.requestedByDisplay || '-'}
                  <div className="muted-table-text">{formatDateTime(request.requestedAt)}</div>
                </td>
                <td>
                  {request.approvedByDisplay ||
                    request.rejectedByDisplay ||
                    request.cancelledByDisplay ||
                    '-'}
                </td>
                <td>
                  {request.metadataJson?.latest_validation ? (
                    <>
                      <strong>{request.metadataJson.latest_validation.validation_number}</strong>
                      <div className="muted-table-text">
                        {request.metadataJson.latest_validation.status} |{' '}
                        {request.metadataJson.latest_validation.validation_database_name || '-'}
                      </div>
                    </>
                  ) : (
                    '-'
                  )}
                </td>
                <td>{request.actionRemarks || '-'}</td>
                <td>
                  <div className="table-actions">
                    {['Approved', 'Validation Failed'].includes(request.status) &&
                      hasPermission('Validate Backup Restore') && (
                        <button
                          type="button"
                          onClick={() => runValidateRestoreRequest(request)}
                          disabled={loading}
                        >
                          Validate
                        </button>
                      )}
                    {request.status === 'Validated' &&
                      hasPermission('Execute Backup Restore') && (
                        <button
                          type="button"
                          onClick={() => runExecuteRestoreRequest(request)}
                          disabled={loading}
                        >
                          Execute Restore
                        </button>
                      )}
                    {request.status === 'Pending Approval' &&
                      hasPermission('Approve Backup Restore') && (
                        <button
                          type="button"
                          onClick={() => runRestoreRequestAction(request, 'approve')}
                          disabled={loading}
                        >
                          Approve
                        </button>
                      )}
                    {request.status === 'Pending Approval' &&
                      hasPermission('Reject Backup Restore') && (
                        <button
                          type="button"
                          onClick={() => runRestoreRequestAction(request, 'reject')}
                          disabled={loading}
                        >
                          Reject
                        </button>
                      )}
                    {request.status === 'Pending Approval' &&
                      (hasPermission('Approve Backup Restore') ||
                        request.requestedByUserId === loggedInUser?.id) && (
                        <button
                          type="button"
                          onClick={() => runRestoreRequestAction(request, 'cancel')}
                          disabled={loading}
                        >
                          Cancel
                        </button>
                      )}
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <PaginationControls
        totalRows={restoreRequests.length}
        currentPage={restoreCurrentPage}
        onPageChange={setRestoreCurrentPage}
      />
    </div>
  )
}

export default BackupRecovery
