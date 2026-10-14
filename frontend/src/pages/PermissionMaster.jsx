import { Fragment, useEffect, useMemo, useState } from 'react'
import {
  createPermission,
  deletePermission,
  getPermissionCatalog,
  seedStandardPermissions,
  updatePermission,
} from '../api/permissionApi'
import PaginationControls, { paginateRows, usePageSize } from '../components/common/PaginationControls'
import DataTableToolbar from '../components/common/DataTableToolbar'
import PageHeader from '../components/common/PageHeader'
import AlertMessage from '../components/common/AlertMessage'
import FormDialog from '../components/common/FormDialog'
import Icon from '../components/common/Icon'
import { useConfirm } from '../components/common/ConfirmProvider'
import { useToast } from '../components/common/Toast'
import { useDataFilters } from '../hooks/useDataFilters'
import { usePermissions } from '../hooks/usePermissions'
import { logUiAction } from '../utils/actionLogger'
import { buildPermissionGroups, isStandardPermission, permissionRows } from '../utils/permissionCatalog'

const STATUSES = ['Active', 'Inactive', 'Blocked']
const MODULE = 'Permission Master'

const COLUMNS = [
  { key: 'category', label: 'Category', type: 'select' },
  { key: 'moduleName', label: 'Module', type: 'select' },
  { key: 'permissionName', label: 'Permission' },
  { key: 'action', label: 'Action', type: 'select' },
  { key: 'type', label: 'Type', type: 'select' },
  { key: 'status', label: 'Status', type: 'select' },
  { key: 'description', label: 'Description' },
]

const emptyPermission = {
  permissionName: '',
  moduleName: '',
  description: '',
  status: 'Active',
}

function PermissionMaster({ permissions, reloadPermissions, loggedInUser }) {
  const confirm = useConfirm()
  const toast = useToast()
  const { hasPermission, isAdmin } = usePermissions(loggedInUser)
  const canCreate = hasPermission('Create Permission')
  const canEdit = hasPermission('Edit Permission')
  const canDelete = hasPermission('Delete Permission')

  const [catalog, setCatalog] = useState(null)
  const [catalogError, setCatalogError] = useState('')
  const [permission, setPermission] = useState(emptyPermission)
  const [editTarget, setEditTarget] = useState(null)
  const [formOpen, setFormOpen] = useState(false)
  const [formError, setFormError] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [page, setPage] = useState(1)
  const pageSize = usePageSize()

  useEffect(() => {
    let cancelled = false
    getPermissionCatalog()
      .then((data) => {
        if (!cancelled) setCatalog(data)
      })
      .catch((err) => {
        if (!cancelled) setCatalogError(err.message || 'Unable to load the permission catalog.')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const groups = useMemo(() => buildPermissionGroups(catalog, permissions), [catalog, permissions])
  const rows = useMemo(() => permissionRows(groups), [groups])
  const filters = useDataFilters(rows, COLUMNS, { module: MODULE })
  const visibleRows = paginateRows(filters.filteredRows, page, pageSize)

  const standardCount = rows.filter((row) => row.isStandard).length
  const missingStandard = groups.entries.filter((entry) => entry.isStandard && !entry.permission).length
  const moduleOptions = useMemo(() => {
    const names = new Set()
    for (const category of groups.categories) {
      for (const module of category.modules) names.add(module.moduleName)
    }
    for (const row of permissions) if (row.moduleName) names.add(row.moduleName)
    return [...names].sort((a, b) => a.localeCompare(b))
  }, [groups, permissions])

  const editingStandard = Boolean(editTarget && isStandardPermission(groups, editTarget.permissionName))
  // Renaming, moving or (de)activating a permission is administrator-only in the API.
  const statusLocked = Boolean(editTarget) && !isAdmin

  const clearMessages = () => {
    setError('')
    setSuccess('')
  }

  const openCreate = () => {
    clearMessages()
    setPermission(emptyPermission)
    setEditTarget(null)
    setFieldErrors({})
    setFormError('')
    setFormOpen(true)
    logUiAction(MODULE, 'Open Create Dialog')
  }

  const openEdit = (row) => {
    clearMessages()
    setPermission({
      permissionName: row.permissionName,
      moduleName: row.moduleName,
      description: row.description || '',
      status: row.status,
    })
    setEditTarget(row)
    setFieldErrors({})
    setFormError('')
    setFormOpen(true)
    logUiAction(MODULE, 'Open Edit Dialog', { permissionName: row.permissionName })
  }

  const closeForm = () => {
    setFormOpen(false)
    setEditTarget(null)
    setPermission(emptyPermission)
    setFieldErrors({})
    setFormError('')
  }

  const handleChange = (event) => {
    const { name, value } = event.target
    setPermission((current) => ({ ...current, [name]: value }))
    setFieldErrors((current) => ({ ...current, [name]: '' }))
  }

  const validate = () => {
    const errors = {}
    const name = permission.permissionName.trim()
    if (!name) errors.permissionName = 'Permission Name is required'
    if (!permission.moduleName.trim()) errors.moduleName = 'Module is required'
    if (name && !editingStandard) {
      const duplicate = permissions.find(
        (item) =>
          item.permissionName.trim().toLowerCase() === name.toLowerCase() &&
          item.id !== editTarget?.id
      )
      if (duplicate) errors.permissionName = `Already used in module ${duplicate.moduleName}`
    }
    setFieldErrors(errors)
    return Object.keys(errors).length === 0
  }

  const handleSubmit = async () => {
    setFormError('')
    if (!(editTarget ? canEdit : canCreate)) {
      setFormError(`You do not have permission to ${editTarget ? 'edit' : 'create'} permissions.`)
      return
    }
    if (!validate()) return

    try {
      setLoading(true)
      if (editTarget) {
        await updatePermission(editTarget.id, permission)
        setSuccess(`Permission "${permission.permissionName}" updated.`)
      } else {
        await createPermission(permission)
        setSuccess(`Permission "${permission.permissionName}" created.`)
      }
      await reloadPermissions()
      closeForm()
    } catch (err) {
      setFormError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (row) => {
    clearMessages()
    if (!canDelete || row.isStandard) return
    const confirmed = await confirm({
      title: 'Delete permission',
      message: `Delete the custom permission "${row.permissionName}" (${row.moduleName})?`,
      details: 'A permission that is still assigned to a role cannot be deleted.',
      tone: 'danger',
      confirmLabel: 'Delete',
      module: MODULE,
    })
    if (!confirmed) return
    try {
      setLoading(true)
      await deletePermission(row.id)
      await reloadPermissions()
      setSuccess(`Permission "${row.permissionName}" deleted.`)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleSync = async () => {
    clearMessages()
    const confirmed = await confirm({
      title: 'Sync standard permissions',
      message:
        'Create any missing standard permissions and restore their module and description from the system catalog?',
      details: 'Status values and custom permissions are left unchanged.',
      tone: 'primary',
      confirmLabel: 'Sync',
      module: MODULE,
    })
    if (!confirmed) return
    try {
      setSyncing(true)
      const result = await seedStandardPermissions()
      await reloadPermissions()
      toast.success(
        `${result.created_count} created, ${result.updated_count} updated, ${result.existing_count} already up to date.`,
        { title: 'Standard permissions synced' }
      )
    } catch (err) {
      setError(err.message)
    } finally {
      setSyncing(false)
    }
  }

  const importConfig = {
    title: 'Import custom permissions',
    description:
      'Create custom permissions from an Excel or CSV file. Names that already exist (including standard permissions) are skipped.',
    fields: [
      { key: 'permissionName', label: 'Permission Name', required: true, example: 'Approve Fuel Voucher' },
      { key: 'moduleName', label: 'Module Name', required: true, example: 'Fuel Management' },
      { key: 'description', label: 'Description', example: '' },
      { key: 'status', label: 'Status', options: STATUSES, defaultValue: 'Active', example: 'Active' },
    ],
    validateRow: (record) => {
      const name = String(record.permissionName || '').trim().toLowerCase()
      if (permissions.some((item) => item.permissionName.toLowerCase() === name)) return 'Permission name already exists'
      if (isStandardPermission(groups, name)) return 'This is a standard permission'
      if (record.status && !STATUSES.includes(record.status)) return `Status must be one of ${STATUSES.join(', ')}`
      return null
    },
    onImportRow: async (record) => {
      await createPermission({ ...emptyPermission, ...record, status: record.status || 'Active' })
    },
    onComplete: async () => {
      await reloadPermissions()
    },
  }

  const showActions = canEdit || canDelete
  const columnCount = showActions ? 7 : 6

  return (
    <div>
      <PageHeader
        title="Permission Master"
        description="Module-wise View / Create / Edit / Delete permissions, grouped like the navigation menu."
        count={`${permissions.length} Permissions`}
        actions={
          <>
            {canCreate && (
              <button type="button" className="btn-secondary" onClick={handleSync} disabled={syncing}>
                <Icon name="refresh" size={15} />
                {syncing ? 'Syncing…' : 'Sync Standard Permissions'}
              </button>
            )}
            {canCreate && (
              <button type="button" className="btn-primary" onClick={openCreate}>
                <Icon name="plus" size={15} />
                New Permission
              </button>
            )}
          </>
        }
      />

      <AlertMessage tone="success" message={success} onDismiss={() => setSuccess('')} />
      <AlertMessage tone="error" message={error} onDismiss={() => setError('')} />
      <AlertMessage tone="warning" message={catalogError} onDismiss={() => setCatalogError('')} />
      {catalog && missingStandard > 0 && (
        <AlertMessage
          tone="warning"
          message={`${missingStandard} standard permission(s) are missing from the database. Use Sync Standard Permissions to restore them.`}
        />
      )}

      <div className="permission-summary-strip">
        <span><strong>{standardCount}</strong> standard</span>
        <span><strong>{rows.length - standardCount}</strong> custom</span>
        <span><strong>{groups.categories.length}</strong> categories</span>
        <span className="permission-summary-hint">
          Standard permissions come from the system catalog: they cannot be renamed or deleted, only deactivated.
        </span>
      </div>

      <FormDialog
        open={formOpen}
        title={editTarget ? 'Edit Permission' : 'New Custom Permission'}
        description={
          editTarget
            ? `${editTarget.category} · ${editTarget.moduleName}`
            : 'Use a verb + entity name, for example "Approve Fuel Voucher".'
        }
        submitLabel={editTarget ? 'Update Permission' : 'Save Permission'}
        busy={loading}
        submitDisabled={editingStandard && statusLocked}
        error={formError}
        onDismissError={() => setFormError('')}
        onSubmit={handleSubmit}
        onCancel={closeForm}
      >
        {editingStandard && (
          <div className="info-box">
            This is a standard permission from the system catalog. Only its status can be changed
            {statusLocked ? ', and only by an administrator.' : '.'}
          </div>
        )}
        <div>
          <label htmlFor="permission-name">Permission Name</label>
          <input
            id="permission-name"
            name="permissionName"
            type="text"
            value={permission.permissionName}
            onChange={handleChange}
            placeholder="Example: Approve Fuel Voucher"
            disabled={editingStandard}
            aria-invalid={fieldErrors.permissionName ? 'true' : undefined}
          />
          {fieldErrors.permissionName && <small className="field-error">{fieldErrors.permissionName}</small>}
        </div>
        <div>
          <label htmlFor="permission-module">Module</label>
          <input
            id="permission-module"
            name="moduleName"
            type="text"
            list="permission-module-options"
            value={permission.moduleName}
            onChange={handleChange}
            placeholder="Select or type a module"
            disabled={editingStandard}
            aria-invalid={fieldErrors.moduleName ? 'true' : undefined}
          />
          <datalist id="permission-module-options">
            {moduleOptions.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          {fieldErrors.moduleName && <small className="field-error">{fieldErrors.moduleName}</small>}
        </div>
        <div>
          <label htmlFor="permission-status">Status</label>
          <select
            id="permission-status"
            name="status"
            value={permission.status}
            onChange={handleChange}
            disabled={statusLocked}
          >
            {STATUSES.map((status) => (
              <option key={status}>{status}</option>
            ))}
          </select>
          {statusLocked && <small className="field-hint">Only an administrator can change the status.</small>}
        </div>
        <div className="full-width-field">
          <label htmlFor="permission-description">Description</label>
          <textarea
            id="permission-description"
            name="description"
            value={permission.description}
            onChange={handleChange}
            placeholder="What this permission allows"
            rows="2"
            disabled={editingStandard}
          />
        </div>
      </FormDialog>

      <DataTableToolbar
        filters={filters}
        columns={COLUMNS}
        exportFileName="permission-master"
        exportTitle="Permission Master"
        module={MODULE}
        importConfig={importConfig}
        canImport={canCreate}
        searchPlaceholder="Search permissions, modules…"
      />

      <div className="table-scroll">
        <table className="grouped-table">
          <thead>
            <tr>
              <th>Module</th>
              <th>Permission</th>
              <th>Action</th>
              <th>Type</th>
              <th>Status</th>
              <th>Description</th>
              {showActions && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 ? (
              <tr>
                <td colSpan={columnCount} className="empty-table">
                  {permissions.length === 0 ? 'No permissions loaded.' : 'No permissions match the filters.'}
                </td>
              </tr>
            ) : (
              visibleRows.map((row, index) => {
                const previous = visibleRows[index - 1]
                const newCategory = !previous || previous.category !== row.category
                const newModule = newCategory || previous.moduleName !== row.moduleName
                return (
                  <Fragment key={row.id}>
                    {newCategory && (
                      <tr className="table-group-row">
                        <td colSpan={columnCount}>{row.category}</td>
                      </tr>
                    )}
                    <tr className={newModule ? 'module-first-row' : undefined}>
                      <td className="cell-muted">{newModule ? row.moduleName : ''}</td>
                      <td><strong className="cell-strong">{row.permissionName}</strong></td>
                      <td><span className={`action-chip action-${row.action.toLowerCase()}`}>{row.action}</span></td>
                      <td>{row.type}</td>
                      <td>
                        <span className={`status-badge ${String(row.status || '').toLowerCase()}`}>{row.status}</span>
                      </td>
                      <td className="cell-wrap">{row.description}</td>
                      {showActions && (
                        <td className="row-actions">
                          {canEdit && (
                            <button type="button" onClick={() => openEdit(row)}>
                              Edit
                            </button>
                          )}
                          {canDelete && !row.isStandard && (
                            <button type="button" onClick={() => handleDelete(row)} disabled={loading}>
                              Delete
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  </Fragment>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      <PaginationControls currentPage={page} totalRows={filters.filteredRows.length} onPageChange={setPage} />
    </div>
  )
}

export default PermissionMaster
