import { useCallback, useEffect, useState } from 'react'
import {
  createBookStockSubField,
  updateBookStockSubField,
  deleteBookStockSubField,
  getBookStockSubFields,
} from '../../api/bookStockApi'
import AlertMessage from '../../components/common/AlertMessage'
import FormDialog from '../../components/common/FormDialog'
import { useConfirm } from '../../components/common/ConfirmProvider'

const initial = {
  field_id: '',
  sub_field_code: '',
  sub_field_name: '',
  description: '',
  status: 'Active',
}

export default function SubFieldsPanel({
  fields,
  canCreate,
  canEdit,
  canDelete,
}) {
  const [items, setItems] = useState([])
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(initial)
  const [error, setError] = useState('')
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const confirm = useConfirm()
  const load = useCallback(async () => {
    try {
      setItems(await getBookStockSubFields({ include_inactive: true }))
    } catch (err) {
      setError(err.message)
    }
  }, [])
  useEffect(() => {
    // Load the scope-filtered master list on mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load])
  const set = (key, value) => setForm((old) => ({ ...old, [key]: value }))
  const show = (item = null) => {
    setEditing(item)
    setForm(
      item
        ? {
            field_id: String(item.field_id),
            sub_field_code: item.sub_field_code,
            sub_field_name: item.sub_field_name,
            description: item.description || '',
            status: item.status,
          }
        : { ...initial },
    )
    setFormError('')
    setOpen(true)
  }
  const save = async () => {
    if (
      !form.field_id ||
      !form.sub_field_code.trim() ||
      !form.sub_field_name.trim()
    ) {
      setFormError('Main field, sub-field code and name are required.')
      return
    }
    setSaving(true)
    try {
      const payload = { ...form, field_id: Number(form.field_id) }
      if (editing) await updateBookStockSubField(editing.id, payload)
      else await createBookStockSubField(payload)
      setOpen(false)
      await load()
    } catch (err) {
      setFormError(err.message)
    } finally {
      setSaving(false)
    }
  }
  const deactivate = async (item) => {
    if (
      !(await confirm({
        title: 'Deactivate sub-field',
        message: `Deactivate ${item.sub_field_name}? Historical production will be retained.`,
        tone: 'danger',
        confirmLabel: 'Deactivate',
        module: 'Book Stock Management',
      }))
    )
      return
    try {
      await deleteBookStockSubField(item.id)
      await load()
    } catch (err) {
      setError(err.message)
    }
  }
  return (
    <section className="bs-field-production">
      <h3>Sub-Fields</h3>
      <p>
        Each sub-field belongs to a main field and inherits its products. Daily
        production is entered per sub-field.
      </p>
      <AlertMessage
        tone="error"
        message={error}
        onDismiss={() => setError('')}
      />
      {canCreate && (
        <button type="button" className="btn-primary" onClick={() => show()}>
          New Sub-Field
        </button>
      )}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Entity</th>
              <th>Block</th>
              <th>Main Field (ID)</th>
              <th>Sub-Field ID</th>
              <th>Sub-Field Code</th>
              <th>Sub-Field Name</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={8}>No sub-fields configured.</td>
              </tr>
            ) : (
              items.map((item) => (
                <tr key={item.id}>
                  <td>{item.entity_code}</td>
                  <td>{item.block_code}</td>
                  <td>
                    {item.field_name} ({item.field_code}, ID {item.field_id})
                  </td>
                  <td>{item.id}</td>
                  <td>{item.sub_field_code}</td>
                  <td>{item.sub_field_name}</td>
                  <td>{item.status}</td>
                  <td className="row-actions">
                    {item.sub_field_code !== '__LEGACY__' && (
                      <>
                        {canEdit && (
                          <button type="button" onClick={() => show(item)}>
                            Edit
                          </button>
                        )}
                        {canDelete && item.status === 'Active' && (
                          <button
                            type="button"
                            onClick={() => deactivate(item)}
                          >
                            Deactivate
                          </button>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <FormDialog
        open={open}
        title={editing ? 'Edit Sub-Field' : 'New Sub-Field'}
        columns={2}
        submitLabel="Save Sub-Field"
        busy={saving}
        error={formError}
        onDismissError={() => setFormError('')}
        onSubmit={save}
        onCancel={() => setOpen(false)}
      >
        <div>
          <label htmlFor="sub-field-parent">Main Field *</label>
          <select
            id="sub-field-parent"
            value={form.field_id}
            disabled={!!editing}
            onChange={(e) => set('field_id', e.target.value)}
          >
            <option value="">Select main field</option>
            {fields
              .filter((f) => f.status === 'Active')
              .map((f) => (
                <option value={f.id} key={f.id}>
                  {f.entity_code} / {f.block_code} / {f.field_name} (
                  {f.field_code})
                </option>
              ))}
          </select>
        </div>
        <div>
          <label htmlFor="sub-field-code">Sub-Field Code *</label>
          <input
            id="sub-field-code"
            maxLength={50}
            value={form.sub_field_code}
            onChange={(e) => set('sub_field_code', e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="sub-field-name">Sub-Field Name *</label>
          <input
            id="sub-field-name"
            maxLength={200}
            value={form.sub_field_name}
            onChange={(e) => set('sub_field_name', e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="sub-field-status">Status</label>
          <select
            id="sub-field-status"
            value={form.status}
            onChange={(e) => set('status', e.target.value)}
          >
            <option>Active</option>
            <option>Inactive</option>
          </select>
        </div>
        <div className="bs-form-wide">
          <label htmlFor="sub-field-description">Description</label>
          <textarea
            id="sub-field-description"
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
          />
        </div>
      </FormDialog>
    </section>
  )
}
