import { useEffect, useMemo, useState } from 'react'
import {
  createOperationWorkflowPolicy,
  deleteOperationWorkflowPolicy,
  getOperationWorkflowPolicies,
  saveOperationWorkflowPolicyRoles,
  updateOperationWorkflowPolicy,
} from '../api/operationWorkflowPolicyApi'

function OperationWorkflowPolicyMaster({ roles = [], operationTypes = [], operationTemplates = [], assets = [], locations = [] }) {
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
  const [loading, setLoading] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)

  const activeRoles = useMemo(() => roles.filter((r) => r.status === 'Active'), [roles])

  const load = async () => {
    const data = await getOperationWorkflowPolicies()
    setPolicies(data)
  }
  useEffect(() => { load() }, [])

  const onSubmit = async (e) => {
    e.preventDefault()
    if (!form.policyName.trim()) {
      setErrorMsg('Policy Name is required')
      return
    }
    if (!form.actionCode.trim()) {
      setErrorMsg('Action is required')
      return
    }
    setLoading(true)
    try {
      let createdOrUpdated
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
        createdOrUpdated = await updateOperationWorkflowPolicy(editId, payload)
        await saveOperationWorkflowPolicyRoles(editId, form.roleIds.map(Number))
      } else {
        createdOrUpdated = await createOperationWorkflowPolicy(payload)
      }
      await load()
      setForm(empty)
      setEditId(null)
      setSuccessMsg(editId ? 'Workflow policy updated' : 'Workflow policy created')
      return createdOrUpdated
    } catch (err) {
      setErrorMsg(err.message)
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

  const onEdit = (p) => {
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
  }

  const onDelete = async (id) => {
    setConfirmDeleteId(id)
  }

  const confirmDeletePolicy = async () => {
    if (!confirmDeleteId) return
    await deleteOperationWorkflowPolicy(confirmDeleteId)
    setConfirmDeleteId(null)
    setSuccessMsg('Workflow policy deleted.')
    await load()
  }

  return (
    <div>
      {successMsg && (
        <div className="success-box" onClick={() => setSuccessMsg('')}>
          {successMsg}
        </div>
      )}
      {errorMsg && (
        <div className="error-box" onClick={() => setErrorMsg('')}>
          {errorMsg}
        </div>
      )}
      {confirmDeleteId && (
        <div className="confirm-overlay">
          <div className="confirm-dialog">
            <p>Delete this workflow policy?</p>
            <div className="confirm-actions">
              <button onClick={confirmDeletePolicy}>Yes, Delete</button>
              <button onClick={() => setConfirmDeleteId(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
      <div className="page-title"><div><h2>Operation Workflow Policy</h2><p>Soft-code who can submit/review/approve/reject/cancel/recall by context.</p></div></div>
      <form onSubmit={onSubmit}>
        <div><label>Policy Name</label><input value={form.policyName} onChange={(e) => { setForm({ ...form, policyName: e.target.value }); setErrorMsg(''); }} /></div>
        <div><label>Action</label><select value={form.actionCode} onChange={(e) => setForm({ ...form, actionCode: e.target.value })}><option>CREATE_ENTRY</option><option>EDIT_DRAFT</option><option>REVIEW</option><option>SUBMIT</option><option>APPROVE</option><option>REJECT</option><option>CANCEL</option><option>RECALL</option></select></div>
        <div><label>Operation Type</label><select value={form.operationTypeCode} onChange={(e) => setForm({ ...form, operationTypeCode: e.target.value })}><option value="">Any</option>{operationTypes.map((o) => <option key={o.id} value={o.operationTypeCode}>{o.operationTypeName}</option>)}</select></div>
        <div><label>Operation Template</label><select value={form.operationTemplateId} onChange={(e) => setForm({ ...form, operationTemplateId: e.target.value })}><option value="">Any</option>{operationTemplates.map((t) => <option key={t.id} value={t.id}>{t.templateName}</option>)}</select></div>
        <div><label>Asset Type</label><select value={form.assetTypeCode} onChange={(e) => setForm({ ...form, assetTypeCode: e.target.value })}><option value="">Any</option>{[...new Set(assets.map((a) => a.assetTypeCode))].map((x) => <option key={x}>{x}</option>)}</select></div>
        <div><label>Location</label><select value={form.locationCode} onChange={(e) => setForm({ ...form, locationCode: e.target.value })}><option value="">Any</option>{locations.map((l) => <option key={l.id} value={l.locationCode}>{l.locationName}</option>)}</select></div>
        <div><label>Priority</label><input type="number" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} /></div>
        <div><label>Status</label><select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}><option>Active</option><option>Inactive</option></select></div>
        <div className="full-width-field">
          <label>Allowed Roles</label>
          <div className="permission-list">
            {activeRoles.map((r) => (
              <label key={r.id} className="permission-badge" style={{ cursor: 'pointer' }}>
                <input type="checkbox" checked={form.roleIds.includes(r.id)} onChange={() => toggleRole(r.id)} /> {r.roleName}
              </label>
            ))}
          </div>
        </div>
        <div className="form-actions"><button type="submit" disabled={loading}>{loading ? 'Please wait...' : editId ? 'Update Policy' : 'Save Policy'}</button>{editId && <button type="button" onClick={() => { setEditId(null); setForm(empty) }}>Cancel</button>}</div>
      </form>
      <table>
        <thead><tr><th>Name</th><th>Action</th><th>Scope</th><th>Priority</th><th>Status</th><th>Roles</th><th>Actions</th></tr></thead>
        <tbody>
          {policies.length === 0 ? <tr><td colSpan="7" className="empty-table">No workflow policies</td></tr> : policies.map((p) => (
            <tr key={p.id}>
              <td>{p.policyName}</td><td>{p.actionCode}</td>
              <td>{[p.operationTypeCode || 'Any OpType', p.operationTemplateId ? `Tpl ${p.operationTemplateId}` : 'Any Template', p.assetTypeCode || 'Any AssetType', p.locationCode || 'Any Location'].join(' | ')}</td>
              <td>{p.priority}</td><td>{p.status}</td><td>{(p.roles || []).map((r) => r.role_name).join(', ') || '-'}</td>
              <td><button type="button" onClick={() => onEdit(p)}>Edit</button><button type="button" onClick={() => onDelete(p.id)}>Delete</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default OperationWorkflowPolicyMaster
