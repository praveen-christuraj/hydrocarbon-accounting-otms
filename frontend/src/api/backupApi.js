import { apiDelete, apiGet, apiPost, apiPut, apiDownload } from './apiClient'

const fromSettingsApi = (row) => ({
  id: row.id,
  enabled: Boolean(row.enabled),
  scheduleMode: row.schedule_mode || 'Daily',
  intervalValue: row.interval_value || 24,
  runTime: row.run_time || '02:00',
  retentionDays: row.retention_days || 30,
  keepMinimum: row.keep_minimum || 5,
  backupDirectory: row.backup_directory || '',
  compressionEnabled: Boolean(row.compression_enabled),
  status: row.status || 'Active',
  nextRunAt: row.next_run_at || '',
  lastRunAt: row.last_run_at || '',
  createdAt: row.created_at || '',
  updatedAt: row.updated_at || '',
})

const toSettingsApi = (row) => ({
  enabled: Boolean(row.enabled),
  schedule_mode: row.scheduleMode,
  interval_value: Number(row.intervalValue || 1),
  run_time: row.runTime || '02:00',
  retention_days: Number(row.retentionDays || 30),
  keep_minimum: Number(row.keepMinimum || 5),
  backup_directory: row.backupDirectory || null,
  compression_enabled: Boolean(row.compressionEnabled),
})

const fromJobApi = (row) => ({
  id: row.id,
  backupNumber: row.backup_number || '',
  backupType: row.backup_type || '',
  triggerSource: row.trigger_source || '',
  status: row.status || '',
  description: row.description || '',
  fileName: row.file_name || '',
  fileSizeBytes: row.file_size_bytes || 0,
  checksumSha256: row.checksum_sha256 || '',
  databaseName: row.database_name || '',
  backupFormat: row.backup_format || '',
  requestedByUserId: row.requested_by_user_id || null,
  requestedByDisplay: row.requested_by_display || '',
  startedAt: row.started_at || '',
  completedAt: row.completed_at || '',
  errorMessage: row.error_message || '',
  metadataJson: row.metadata_json || null,
  createdAt: row.created_at || '',
  updatedAt: row.updated_at || '',
})

const fromRestoreRequestApi = (row) => ({
  id: row.id,
  requestNumber: row.request_number || '',
  backupJobId: row.backup_job_id || null,
  backupNumber: row.backup_number || '',
  status: row.status || '',
  reason: row.reason || '',
  businessImpact: row.business_impact || '',
  requestedByUserId: row.requested_by_user_id || null,
  requestedByDisplay: row.requested_by_display || '',
  requestedAt: row.requested_at || '',
  approvedByUserId: row.approved_by_user_id || null,
  approvedByDisplay: row.approved_by_display || '',
  approvedAt: row.approved_at || '',
  rejectedByUserId: row.rejected_by_user_id || null,
  rejectedByDisplay: row.rejected_by_display || '',
  rejectedAt: row.rejected_at || '',
  cancelledByUserId: row.cancelled_by_user_id || null,
  cancelledByDisplay: row.cancelled_by_display || '',
  cancelledAt: row.cancelled_at || '',
  actionRemarks: row.action_remarks || '',
  metadataJson: row.metadata_json || null,
  createdAt: row.created_at || '',
  updatedAt: row.updated_at || '',
})

const fromValidationApi = (row) => ({
  id: row.id,
  validationNumber: row.validation_number || '',
  restoreRequestId: row.restore_request_id || null,
  backupJobId: row.backup_job_id || null,
  backupNumber: row.backup_number || '',
  status: row.status || '',
  validationDatabaseName: row.validation_database_name || '',
  startedByUserId: row.started_by_user_id || null,
  startedByDisplay: row.started_by_display || '',
  startedAt: row.started_at || '',
  completedAt: row.completed_at || '',
  errorMessage: row.error_message || '',
  tableCountsJson: row.table_counts_json || null,
  validationReportJson: row.validation_report_json || null,
  createdAt: row.created_at || '',
  updatedAt: row.updated_at || '',
})

export const getBackupSettings = async () => {
  const data = await apiGet('/backup-settings')
  return fromSettingsApi(data)
}

export const updateBackupSettings = async (payload) => {
  const data = await apiPut('/backup-settings', toSettingsApi(payload))
  return fromSettingsApi(data)
}

export const getBackupJobs = async (filters = {}) => {
  const params = new URLSearchParams()
  if (filters.status) params.append('status', filters.status)
  if (filters.backupType) params.append('backup_type', filters.backupType)
  const query = params.toString()
  const data = await apiGet(query ? `/backups?${query}` : '/backups')
  return (data || []).map(fromJobApi)
}

export const createManualBackup = async (description) => {
  const data = await apiPost('/backups/manual', {
    description,
  })
  return fromJobApi(data)
}

export const verifyBackupChecksum = async (backupId) => {
  return apiPost(`/backups/${backupId}/verify-checksum`, {})
}

export const deleteBackup = async (backupId) => {
  const data = await apiDelete(`/backups/${backupId}`)
  return fromJobApi(data)
}

export const cleanupBackups = async () => {
  return apiPost('/backups/cleanup', {})
}

export const downloadBackup = async (backupId, fallbackFileName = 'backup.dump') => {
  await apiDownload(`/backups/${backupId}/download`, fallbackFileName)
}

export const getBackupRestoreRequests = async (filters = {}) => {
  const params = new URLSearchParams()
  if (filters.status) params.append('status', filters.status)
  const query = params.toString()
  const data = await apiGet(
    query ? `/backup-restore-requests?${query}` : '/backup-restore-requests'
  )
  return (data || []).map(fromRestoreRequestApi)
}

export const createBackupRestoreRequest = async (payload) => {
  const data = await apiPost('/backup-restore-requests', {
    backup_job_id: payload.backupJobId,
    reason: payload.reason,
    business_impact: payload.businessImpact || null,
  })
  return fromRestoreRequestApi(data)
}

export const approveBackupRestoreRequest = async (requestId, remarks = '') => {
  const data = await apiPost(`/backup-restore-requests/${requestId}/approve`, {
    remarks,
  })
  return fromRestoreRequestApi(data)
}

export const rejectBackupRestoreRequest = async (requestId, remarks = '') => {
  const data = await apiPost(`/backup-restore-requests/${requestId}/reject`, {
    remarks,
  })
  return fromRestoreRequestApi(data)
}

export const cancelBackupRestoreRequest = async (requestId, remarks = '') => {
  const data = await apiPost(`/backup-restore-requests/${requestId}/cancel`, {
    remarks,
  })
  return fromRestoreRequestApi(data)
}

export const validateBackupRestoreRequest = async (requestId) => {
  const data = await apiPost(`/backup-restore-requests/${requestId}/validate`, {})
  return fromValidationApi(data)
}

export const executeBackupRestoreRequest = async (
  requestId,
  confirmationText,
  remarks = ''
) => {
  const data = await apiPost(`/backup-restore-requests/${requestId}/execute`, {
    confirmation_text: confirmationText,
    remarks,
  })
  return fromRestoreRequestApi(data)
}

export const getBackupRestoreValidations = async (requestId) => {
  const data = await apiGet(`/backup-restore-requests/${requestId}/validations`)
  return (data || []).map(fromValidationApi)
}
