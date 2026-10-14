import { useEffect, useMemo, useState } from 'react'
import {
  createOperationWorkflowPolicy,
  deleteOperationWorkflowPolicy,
  getOperationWorkflowPolicies,
  saveOperationWorkflowPolicyRoles,
  updateOperationWorkflowPolicy,
} from '../api/operationWorkflowPolicyApi'
import PaginationControls, { paginateRows, usePageSize } from '../components/common/PaginationControls'
import DataTableToolbar from '../components/common/DataTableToolbar'
import PageHeader from '../components/common/PageHeader'
import AlertMessage from '../components/common/AlertMessage'
import FormDialog from '../components/common/FormDialog'
import Icon from '../components/common/Icon'
import { useConfirm } from '../components/common/ConfirmProvider'
import { useDataFilters } from '../hooks/useDataFilters'
import { useAutoColumns } from '../hooks/useAutoColumns'
import { usePermissions } from '../hooks/usePermissions'
import { logUiAction } from '../utils/actionLogger'

function OperationWorkflowPolicyMaster({ roles = [], operationTypes = [], operationTemplates = [], assets = [], locations = [], loggedInUser }) {
  const confirm = useConfirm()
  const { hasPermission } = usePermissions(loggedInUser)
  const canCreate = hasPermission('Create Operation Workflow Policy')
  const canEdit = hasPermission('Edit Operation Workflow Policy')
  const canDelete = hasPermission('Delete Operation Workflow Policy')
  const empty = {
    policyName: '',
    actionCode: 'SUBMIT',
    operationTypeCode: '',
    operationTemplateId: '',
    assetTypeCode: '',
    locationCode: '',
    priority: 100,
    status: 'Active',
    roleIds: [],
  }
  const [policies, setPolicies] = useState([])
  const [form, setForm] = useState(empty)
  const [editId, setEditId] = useState(null)
  const [formOpen, setFormOpen] = useState(false)
  const [formError, setFormError] = useState('')
  const [loading, setLoading] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [page, setPage] = useState(1)

  const pageSize = usePageSize()
  const activeRoles = useMemo(() => roles.filter((r) => r.status === 'Active'), [roles])
  const policiesFilters = useDataFilters(policies, useAutoColumns(policies), { module: 'Operation Workflow Policy' })
  const visiblePolicies = paginateRows(policiesFilters.filteredRows, page, pageSize)

  const load = async () => {
    const data = await getOperationWorkflowPolicies()
    setPolicies(data)
  }

  useEffect(() => {
    let cancelled = false
    getOperationWorkflowPolicies()
      .then((data) => {
        if (!cancelled) setPolicies(data)
      })
      .catch((err) => {
        if (!cancelled) setErrorMsg(err.message)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const onSubmit = async () => {
    setFormError('')
    if (!(editId ? canEdit : canCreate)) {
      setFormError(`You do not have permission to ${editId ? 'edit' : 'create'} workflow policies.`)
      return
    }
    if (!form.policyName.trim()) {
      setFormError('Policy Name is required')
      return
    }
    if (!form.actionCode.trim()) {
      setFormError('Action is required')
      return
    }
    setLoading(true)
    try {
      const payload = {
        policy_name: form.policyName.trim(),
        action_code: form.actionCode,
        operation_type_code: form.operationTypeCode || null,
        operation_template_id: form.operationTemplateId ? Number(form.operationTemplateId) : null,
        asset_type_code: form.assetTypeCode || null,
        location_code: form.locationCode || null,
        priority: Number(form.priority || 100),
        status: form.status,
        role_ids: form.roleIds.map(Number),
      }
      if (editId) {
        await updateOperationWorkflowPolicy(editId, payload)
        await saveOperationWorkflowPolicyRoles(editId, form.roleIds.map(Number))
      } else {
        await createOperationWorkflowPolicy(payload)
      }
      await load()
      setSuccessMsg(editId ? 'Workflow policy updated' : 'Workflow policy created')
      closeForm()
    } catch (err) {
      setFormError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const toggleRole = (roleId) => {
    setForm((prev) => ({
      ...prev,
      roleIds: prev.roleIds.includes(roleId)
        ? prev.roleIds.filter((x) => x !== roleId)
        : [...prev.roleIds, roleId],
    }))
  }

  const openCreate = () => {
    setSuccessMsg('')
    setErrorMsg('')
    setFormError('')
    setEditId(null)
    setForm(empty)
    setFormOpen(true)
    logUiAction('Operation Workflow Policy', 'Open Create Dialog')
  }

  const onEdit = (p) => {
    setSuccessMsg('')
    setErrorMsg('')
    setFormError('')
    setEditId(p.id)
    setForm({
      policyName: p.policyName || '',
      actionCode: p.actionCode || 'SUBMIT',
      operationTypeCode: p.operationTypeCode || '',
      operationTemplateId: p.operationTemplateId || '',
      assetTypeCode: p.assetTypeCode || '',
      locationCode: p.locationCode || '',
      priority: p.priority ?? 100,
      status: p.status || 'Active',
      roleIds: (p.roles || []).map((r) => Number(r.role_id)),
    })
    setFormOpen(true)
    logUiAction('Operation Workflow Policy', 'Open Edit Dialog', { policyName: p.policyName })
  }

  const closeForm = () => {
    setFormOpen(false)
    setEditId(null)
    setForm(empty)
    setFormError('')
  }

  const onDelete = async (p) => {
    setSuccessMsg('')
    setErrorMsg('')
    if (!canDelete) {
      setErrorMsg('You do not have permission to delete workflow policies.')
      return
    }
    const confirmed = await confirm({
      title: 'Delete workflow policy',
      message: `Delete the workflow policy "${p.policyName}"?`,
      tone: 'danger',
      confirmLabel: 'Delete',
      module: 'Operation Workflow Policy',
    })
    if (!confirmed) return
    try {
      await deleteOperationWorkflowPolicy(p.id)
      setSuccessMsg('Workflow policy deleted.')
      await load()
    } catch (err) {
      setErrorMsg(err.message)
    }
  }

  const showActions = canEdit || canDelete

  return (
    <div>
      <PageHeader
        title="Operation Workflow Policy"
        description="Soft-code who can submit, review, approve, reject, cancel or recall by context."
        count={`${policies.length} Policies`}
        actions={
          canCreate && (
            <button type="button" className="btn-primary" onClick={openCreate}>
              <Icon name="plus" size={15} />
              New Policy
            </button>
          )
        }
      />
      <AlertMessage tone="success" message={successMsg} onDismiss={() => setSuccessMsg('')} />
      <AlertMessage tone="error" message={errorMsg} onDismiss={() => setErrorMsg('')} />
      {!canCreate && !canEdit && !canDelete && (
        <div className="info-box">You have view-only access to Operation Workflow Policy.</div>
      )}

      <FormDialog
        open={formOpen}
        title={editId ? 'Edit Workflow Policy' : 'New Workflow Policy'}
        description="Leave a scope field on Any to apply the policy to every value."
        size="lg"
        columns={3}
        submitLabel={editId ? 'Update Policy' : 'Save Policy'}
        busy={loading}
        error={formError}
        onDismissError={() => setFormError('')}
        onSubmit={onSubmit}
        onCancel={closeForm}
      >
        <div><label>Policy Name</label><input value={form.policyName} onChange={(e) => { setForm({ ...form, policyName: e.target.value }); setFormError('') }} /></div>
        <div><label>Action</label><select value={form.actionCode} onChange={(e) => setForm({ ...form, actionCode: e.target.value })}><option>CREATE_ENTRY</option><option>EDIT_DRAFT</option><option>REVIEW</option><option>SUBMIT</option><option>APPROVE</option><option>REJECT</option><option>CANCEL</option><option>RECALL</option></select></div>
        <div><label>Priority</label><input type="number" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} /></div>
        <div><label>Operation Type</label><select value={form.operationTypeCode} onChange={(e) => setForm({ ...form, operationTypeCode: e.target.value })}><option value="">Any</option>{operationTypes.map((o) => <option key={o.id} value={o.operationTypeCode}>{o.operationTypeName}</option>)}</select></div>
        <div><label>Operation Template</label><select value={form.operationTemplateId} onChange={(e) => setForm({ ...form, operationTemplateId: e.target.value })}><option value="">Any</option>{operationTemplates.map((t) => <option key={t.id} value={t.id}>{t.templateName}</option>)}</select></div>
        <div><label>Asset Type</label><select value={form.assetTypeCode} onChange={(e) => setForm({ ...form, assetTypeCode: e.target.value })}><option value="">Any</option>{[...new Set(assets.map((a) => a.assetTypeCode))].map((x) => <option key={x}>{x}</option>)}</select></div>
        <div><label>Location</label><select value={form.locationCode} onChange={(e) => setForm({ ...form, locationCode: e.target.value })}><option value="">Any</option>{locations.map((l) => <option key={l.id} value={l.locationCode}>{l.locationName}</option>)}</select></div>
        <div><label>Status</label><select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}><option>Active</option><option>Inactive</option></select></div>
        <fieldset className="full-width-field checkbox-chip-group">
          <legend>Allowed Roles</legend>
          {activeRoles.map((r) => {
            const checked = form.roleIds.includes(r.id)
            return (
              <label key={r.id} className={`checkbox-chip ${checked ? 'is-checked' : ''}`.trim()}>
                <input type="checkbox" checked={checked} onChange={() => toggleRole(r.id)} /> {r.roleName}
              </label>
            )
          })}
        </fieldset>
      </FormDialog>

      <DataTableToolbar
        filters={policiesFilters}
        columns={policiesFilters.columns}
        exportFileName="operation-workflow-policy"
        exportTitle="Operation Workflow Policy"
        module="Operation Workflow Policy"
      />

      <table>
        <thead><tr><th>Name</th><th>Action</th><th>Scope</th><th>Priority</th><th>Status</th><th>Roles</th>{showActions && <th>Actions</th>}</tr></thead>
        <tbody>
          {visiblePolicies.length === 0 ? <tr><td colSpan={showActions ? 7 : 6} className="empty-table">No workflow policies</td></tr> : visiblePolicies.map((p) => (
            <tr key={p.id}>
              <td><strong className="cell-strong">{p.policyName}</strong></td><td>{p.actionCode}</td>
              <td className="cell-wrap">{[p.operationTypeCode || 'Any OpType', p.operationTemplateId ? `Tpl ${p.operationTemplateId}` : 'Any Template', p.assetTypeCode || 'Any AssetType', p.locationCode || 'Any Location'].join(' | ')}</td>
              <td>{p.priority}</td>
              <td><span className={`status-badge ${String(p.status || '').toLowerCase()}`}>{p.status}</span></td>
              <td className="cell-wrap">{(p.roles || []).map((r) => r.role_name).join(', ') || '-'}</td>
              {showActions && (
                <td className="row-actions">
                  {canEdit && <button type="button" onClick={() => onEdit(p)}>Edit</button>}
                  {canDelete && <button type="button" onClick={() => onDelete(p)}>Delete</button>}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      <PaginationControls currentPage={page} totalRows={policiesFilters.filteredRows.length} onPageChange={setPage} />
    </div>
  )
}

export default OperationWorkflowPolicyMaster
