import { useState } from 'react'
import { createRole, deleteRole, updateRole } from '../api/roleApi'
import PaginationControls, { paginateRows, usePageSize } from '../components/common/PaginationControls'
import DataTableToolbar from '../components/common/DataTableToolbar'
import { useDataFilters } from '../hooks/useDataFilters'
import { useAutoColumns } from '../hooks/useAutoColumns'
import { usePermissions } from '../hooks/usePermissions'
import FormDialog from '../components/common/FormDialog'
import Icon from '../components/common/Icon'
import { useConfirm } from '../components/common/ConfirmProvider'
import { logUiAction } from '../utils/actionLogger'
import AlertMessage from '../components/common/AlertMessage'
import useActionFeedback from '../hooks/useActionFeedback'

const IMPORT_STATUSES = ['Active', 'Inactive', 'Blocked']

function RoleMaster({ roles, reloadRoles, loggedInUser }) {
  const emptyRole = {
    roleName: '',
    description: '',
    status: 'Active',
  }

  const [role, setRole] = useState(emptyRole)
  const [editId, setEditId] = useState(null)
  const [loading, setLoading] = useState(false)
  // Action feedback: little pop-up (toast) + inline message near the action
  // area (owner rule 8). Aliased to the page's existing variable names.
  const feedback = useActionFeedback()
  const {
    successMsg: success,
    errorMsg: error,
    notifySuccess: setSuccess,
    notifyError: setError,
    clearSuccess,
    clearError,
  } = feedback
  const [formOpen, setFormOpen] = useState(false)
  const [fieldErrors, setFieldErrors] = useState({})
  const [page, setPage] = useState(1)

  const pageSize = usePageSize()
  const rolesFilters = useDataFilters(roles, useAutoColumns(roles), { module: 'Role Master' })
  const visibleItems = paginateRows(rolesFilters.filteredRows, page, pageSize)

  const { hasPermission } = usePermissions(loggedInUser)
  const confirm = useConfirm()
  const canCreate = hasPermission('Create Role')
  const canEdit = hasPermission('Edit Role')
  const canDelete = hasPermission('Delete Role')


  const handleChange = (e) => {
    setRole({ ...role, [e.target.name]: e.target.value })
    setFieldErrors({ ...fieldErrors, [e.target.name]: '' })
  }

  const validateRole = () => {
    const errors = {}
    if (role.roleName.trim() === '') errors.roleName = 'Role Name is required'
    setFieldErrors(errors)
    return Object.keys(errors).length === 0
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    clearError()
    clearSuccess()

    if (!(editId === null ? canCreate : canEdit)) {
      setError(`You do not have permission to ${editId === null ? 'create' : 'edit'} roles.`)
      return
    }

    if (!validateRole()) return

    try {
      setLoading(true)

      if (editId === null) {
        await createRole(role)
        setSuccess('Role saved successfully')
      } else {
        await updateRole(editId, role)
        setSuccess('Role updated successfully')
      }

      setFieldErrors({})
      await reloadRoles()
      setRole(emptyRole)
      setEditId(null)
      setFormOpen(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleEdit = (roleToEdit) => {
    clearError()
    clearSuccess()
    setFieldErrors({})

    if (String(roleToEdit.roleName || '').trim().toLowerCase() === 'admin') {
      setError('The reserved Admin role is managed by system provisioning.')
      return
    }
    if (!canEdit) {
      setError('You do not have permission to edit roles.')
      return
    }

    setRole({
      roleName: roleToEdit.roleName,
      description: roleToEdit.description,
      status: roleToEdit.status,
    })

    setEditId(roleToEdit.id)
    setFormOpen(true)
    logUiAction('Role Master', 'Open Edit Dialog', { roleName: roleToEdit.roleName })
  }

  const handleDeleteRequest = async (target) => {
    clearError()
    clearSuccess()
    const confirmed = await confirm({
      title: 'Delete role',
      message: `Delete role ${target.roleName}? This cannot be undone.`,
      tone: 'danger',
      confirmLabel: 'Delete',
      module: 'Role Master',
    })
    if (confirmed) await handleDeleteConfirm(target.id)
  }

  const handleDeleteConfirm = async (roleId) => {
    if (!canDelete) {
      setError('You do not have permission to delete roles.')
      return
    }

    try {
      setLoading(true)
      await deleteRole(roleId)
      setSuccess('Role deleted successfully')
      await reloadRoles()

      if (editId === roleId) {
        setRole(emptyRole)
        setEditId(null)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleCancelEdit = () => {
    setRole(emptyRole)
    setEditId(null)
    setFieldErrors({})
    clearError()
    clearSuccess()
    setFormOpen(false)
  }

  const openCreate = () => {
    handleCancelEdit()
    setFormOpen(true)
    logUiAction('Role Master', 'Open Create Dialog')
  }


  const importConfig = {
    title: 'Bulk upload roles',
    description: 'Create records from an Excel or CSV file. Existing codes are skipped.',
    fields: [
    { key: 'roleName', label: 'Role Name', required: true, example: 'Terminal Supervisor' },
    { key: 'description', label: 'Description', example: '' },
    { key: 'status', label: 'Status', options: IMPORT_STATUSES, defaultValue: 'Active', example: 'Active' },
  ],
    validateRow: (record) => {
    const name = String(record.roleName || '').trim().toLowerCase()
    if (roles.some((item) => item.roleName.toLowerCase() === name)) return 'Role name already exists'
    if (record.status && !IMPORT_STATUSES.includes(record.status)) return `Status must be one of ${IMPORT_STATUSES.join(', ')}`
    return null
  },
    onImportRow: async (record) => {
      await createRole({ ...emptyRole, ...record, status: record.status || 'Active' })
    },
    onComplete: async () => {
      await reloadRoles()
    },
  }

  return (
    <div>
      <div className="page-title">
        <div>
          <h2>Role Master</h2>
          <p>Create, update, and manage application roles.</p>
        </div>

        <div className="page-title-actions">
          {canCreate && (<button type="button" className="btn-primary" onClick={openCreate}><Icon name="plus" size={15} />New Role</button>)}
          <span className="record-count">{roles.length} Roles</span>
        </div>
      </div>

      <AlertMessage tone="success" message={success} onDismiss={clearSuccess} />
      <AlertMessage tone="error" message={error} onDismiss={clearError} />

      {!canCreate && !canEdit && !canDelete && (
        <div className="info-box">
          You have view-only access to Role Master.
        </div>
      )}

      <FormDialog
        open={formOpen}
        title={editId === null ? 'New Role' : 'Edit Role'}
        submitLabel={editId === null ? 'Save Role' : 'Update Role'}
        busy={loading}
        error={error}
        onDismissError={clearError}
        onSubmit={handleSubmit}
        onCancel={handleCancelEdit}
      >
        <div>
          <label>Role Name</label>
          <input
            name="roleName"
            type="text"
            value={role.roleName}
            onChange={handleChange}
            placeholder="Enter role name"
            aria-invalid={fieldErrors.roleName ? 'true' : undefined}
          />
          {fieldErrors.roleName && (
            <small className="field-error">{fieldErrors.roleName}</small>
          )}
        </div>

        <div>
          <label>Status</label>
          <select name="status" value={role.status} onChange={handleChange}>
            <option>Active</option>
            <option>Inactive</option>
            <option>Blocked</option>
          </select>
        </div>

        <div className="full-width-field">
          <label>Description</label>
          <textarea
            name="description"
            value={role.description}
            onChange={handleChange}
            placeholder="Enter role description"
            rows="3"
          />
        </div>
      </FormDialog>
      <div className="section-title">
        <h3>Saved Roles</h3>
        <p>Roles are now saved permanently in PostgreSQL.</p>
      </div>

      <DataTableToolbar
        filters={rolesFilters}
        columns={rolesFilters.columns}
        exportFileName="role-master"
        exportTitle="Role Master"
        module="Role Master"
        importConfig={importConfig}
        canImport={canCreate}
      />

      <table>
        <thead>
          <tr>
            <th>Role Name</th>
            <th>Description</th>
            <th>Status</th>
            {(canEdit || canDelete) && <th>Actions</th>}
          </tr>
        </thead>

        <tbody>
          {roles.length === 0 ? (
            <tr>
              <td colSpan={canEdit || canDelete ? 4 : 3} className="empty-table">
                No roles added yet.
              </td>
            </tr>
          ) : (
            visibleItems.map((item) => (
              <tr key={item.id}>
                <td>{item.roleName}</td>
                <td>{item.description}</td>
                <td>
                  <span className={`status-badge ${item.status.toLowerCase()}`}>
                    {item.status}
                  </span>
                </td>

                {(canEdit || canDelete) && (
                  <td className="row-actions">
                    {String(item.roleName || '').trim().toLowerCase() === 'admin' ? (
                      <span>System managed</span>
                    ) : (
                    <>
                    {canEdit && (
                      <button type="button" onClick={() => handleEdit(item)}>
                        Edit
                      </button>
                    )}

                    {canDelete && (
                      <button type="button" onClick={() => handleDeleteRequest(item)} disabled={loading}>
                        Delete
                      </button>
                    )}
                    </>
                    )}
                  </td>
                )}
              </tr>
            ))
          )}
        </tbody>
      </table>

      <PaginationControls currentPage={page} totalRows={rolesFilters.filteredRows.length} onPageChange={setPage} />
    </div>
  )
}

export default RoleMaster