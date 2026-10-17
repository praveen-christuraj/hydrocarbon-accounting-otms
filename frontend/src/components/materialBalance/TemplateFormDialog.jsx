import { useId, useMemo, useState } from 'react'
import FormDialog from '../common/FormDialog'
import AlertMessage from '../common/AlertMessage'
import { computeReportUsage, isActive } from '../../utils/materialBalanceTemplate'

const START_OPTIONS = [
  {
    value: 'generate',
    label: 'Columns from Tank Operations',
    description:
      'Proposes Opening Stock, one column per receipt / dispatch operation of the location, Book Closing, Closing Stock and Loss/Gain. You review them before they are created.',
  },
  {
    value: 'copy',
    label: 'Copy an existing template',
    description: 'Copies every column (mapping, flags and order) of the template you choose.',
  },
  {
    value: 'empty',
    label: 'Empty template',
    description: 'Add the columns one by one.',
  },
]

const sameLocation = (a, b) => String(a || '').toUpperCase() === String(b || '').toUpperCase()

/**
 * New / Edit / Duplicate Material Balance Template (FormDialog, owner rule 10).
 *
 * `mode`: 'create' | 'edit' | 'duplicate'. Create and duplicate also choose
 * how the template starts (columns from Tank Operations, copy, empty).
 * Mounted with a `key` per opening, so the initial state is read once.
 */
function TemplateFormDialog({
  open,
  mode,
  initial,
  locations,
  templates,
  canAddColumns,
  busy,
  busyLabel,
  error,
  onDismissError,
  onSubmit,
  onCancel,
}) {
  const startGroupId = useId()
  const isEdit = mode === 'edit'

  const hasActiveTemplate = (locationCode) =>
    templates.some((template) => sameLocation(template.locationCode, locationCode) && isActive(template))

  const [form, setForm] = useState(() => {
    const locationCode = initial?.locationCode || ''
    return {
      locationCode,
      templateName: initial?.templateName || '',
      description: initial?.description || '',
      // A new Active template immediately becomes the template of the report,
      // so a location that already has one starts the new template Inactive.
      status: isEdit
        ? initial?.status || 'Active'
        : locationCode && hasActiveTemplate(locationCode)
          ? 'Inactive'
          : 'Active',
      start: initial?.start || (canAddColumns ? 'generate' : 'empty'),
      copyFromId: initial?.copyFromId ? String(initial.copyFromId) : '',
    }
  })
  const [statusTouched, setStatusTouched] = useState(false)
  const [errors, setErrors] = useState({})

  const usage = useMemo(() => computeReportUsage(templates), [templates])

  const locationOptions = useMemo(() => {
    const options = (locations || []).filter((location) => location.status === 'Active')
    if (form.locationCode && !options.some((location) => sameLocation(location.locationCode, form.locationCode))) {
      const current = (locations || []).find((location) => sameLocation(location.locationCode, form.locationCode))
      options.push(current || { id: `current-${form.locationCode}`, locationCode: form.locationCode, locationName: form.locationCode })
    }
    return options
  }, [locations, form.locationCode])

  const copySources = useMemo(
    () =>
      [...templates]
        .filter((template) => !isEdit && (template.columns || []).length > 0)
        .sort(
          (a, b) =>
            String(a.locationCode).localeCompare(String(b.locationCode)) ||
            String(a.templateName).localeCompare(String(b.templateName))
        ),
    [templates, isEdit]
  )

  const copySource = copySources.find((template) => String(template.id) === String(form.copyFromId)) || null

  const reportTemplate = useMemo(() => {
    if (!form.locationCode) return null
    return (
      templates
        .filter((template) => sameLocation(template.locationCode, form.locationCode) && isActive(template))
        .sort((a, b) => Number(b.id) - Number(a.id))[0] || null
    )
  }, [templates, form.locationCode])

  const setField = (name, value) => {
    setForm((current) => ({ ...current, [name]: value }))
    if (errors[name]) setErrors((current) => ({ ...current, [name]: '' }))
  }

  const handleLocationChange = (value) => {
    setForm((current) => ({
      ...current,
      locationCode: value,
      status: isEdit || statusTouched ? current.status : value && hasActiveTemplate(value) ? 'Inactive' : 'Active',
    }))
    if (errors.locationCode) setErrors((current) => ({ ...current, locationCode: '' }))
  }

  const validate = () => {
    const next = {}
    if (!form.locationCode) next.locationCode = 'Location is required'
    const name = form.templateName.trim()
    if (!name) next.templateName = 'Template Name is required'
    else if (
      templates.some(
        (template) =>
          template.id !== initial?.id &&
          sameLocation(template.locationCode, form.locationCode) &&
          String(template.templateName).trim().toLowerCase() === name.toLowerCase()
      )
    ) {
      next.templateName = 'A template with this name already exists for this location'
    }
    if (!isEdit && form.start === 'copy' && !form.copyFromId) next.copyFromId = 'Choose the template to copy'
    setErrors(next)
    return Object.keys(next).length === 0
  }

  const handleSubmit = () => {
    if (!validate()) return
    onSubmit({
      locationCode: form.locationCode,
      templateName: form.templateName.trim(),
      description: form.description.trim(),
      status: form.status,
      start: isEdit ? 'none' : form.start,
      copyFromId: form.start === 'copy' ? Number(form.copyFromId) : null,
    })
  }

  // What saving does to the Material Balance Report of this location.
  let reportNote = null
  if (form.locationCode) {
    const willBeActive = form.status === 'Active'
    if (!isEdit) {
      if (willBeActive && reportTemplate) {
        reportNote = {
          tone: 'warning',
          message: `${form.locationCode} already reports with “${reportTemplate.templateName}”. An Active new template replaces it in the Material Balance Report as soon as it is saved. Keep it Inactive while you configure its columns.`,
        }
      } else if (willBeActive) {
        reportNote = {
          tone: 'info',
          message: `This becomes the template of the Material Balance Report for ${form.locationCode}.`,
        }
      } else if (reportTemplate) {
        reportNote = {
          tone: 'info',
          message: `Saved as Inactive: the report keeps using “${reportTemplate.templateName}”. Activate this template, or use “Use for report”, when its columns are ready.`,
        }
      }
    } else if (initial) {
      const state = usage.get(initial.id)?.state
      const movedLocation = !sameLocation(initial.locationCode, form.locationCode)
      if (movedLocation) {
        reportNote = {
          tone: 'warning',
          message:
            'Movement columns are mapped to the Tank Operations of the current location. Check the mapping after moving the template to another location.',
        }
      } else if (state === 'in-use' && !willBeActive) {
        const fallback = templates
          .filter(
            (template) =>
              template.id !== initial.id && sameLocation(template.locationCode, form.locationCode) && isActive(template)
          )
          .sort((a, b) => Number(b.id) - Number(a.id))[0]
        reportNote = fallback
          ? { tone: 'warning', message: `The report for ${form.locationCode} will use “${fallback.templateName}” instead.` }
          : {
              tone: 'warning',
              message: `${form.locationCode} will have no active template, so its Material Balance Report cannot run.`,
            }
      } else if (state !== 'in-use' && willBeActive && reportTemplate && reportTemplate.id !== initial.id) {
        if (Number(reportTemplate.id) > Number(initial.id)) {
          reportNote = {
            tone: 'info',
            message: `The report uses the newest active template, “${reportTemplate.templateName}”. Use “Use for report” in the list to switch to this one.`,
          }
        }
      }
    }
  }

  const title = isEdit ? 'Edit Template' : mode === 'duplicate' ? 'Duplicate Template' : 'New Template'
  const submitLabel = isEdit ? 'Update Template' : 'Create Template'

  return (
    <FormDialog
      open={open}
      title={title}
      description="A template defines the columns of the Material Balance Report for one location."
      size="lg"
      columns={2}
      submitLabel={submitLabel}
      busy={busy}
      busyLabel={busyLabel || 'Saving…'}
      error={error}
      onDismissError={onDismissError}
      onSubmit={handleSubmit}
      onCancel={onCancel}
    >
      <div>
        <label htmlFor="mb-template-location">Location</label>
        <select
          id="mb-template-location"
          value={form.locationCode}
          onChange={(event) => handleLocationChange(event.target.value)}
          disabled={busy}
          aria-invalid={errors.locationCode ? 'true' : undefined}
          className={errors.locationCode ? 'input-error' : ''}
        >
          <option value="">Select Location</option>
          {locationOptions.map((location) => (
            <option key={location.id} value={location.locationCode}>
              {location.locationName} ({location.locationCode})
            </option>
          ))}
        </select>
        {errors.locationCode && <span className="field-error">{errors.locationCode}</span>}
      </div>

      <div>
        <label htmlFor="mb-template-name">Template Name</label>
        <input
          id="mb-template-name"
          type="text"
          value={form.templateName}
          onChange={(event) => setField('templateName', event.target.value)}
          placeholder="Example: UTP Daily Material Balance"
          maxLength={150}
          disabled={busy}
          aria-invalid={errors.templateName ? 'true' : undefined}
          className={errors.templateName ? 'input-error' : ''}
        />
        {errors.templateName && <span className="field-error">{errors.templateName}</span>}
      </div>

      <div>
        <label htmlFor="mb-template-status">Status</label>
        <select
          id="mb-template-status"
          value={form.status}
          onChange={(event) => {
            setStatusTouched(true)
            setField('status', event.target.value)
          }}
          disabled={busy}
        >
          <option value="Active">Active</option>
          <option value="Inactive">Inactive</option>
          {form.status === 'Blocked' && <option value="Blocked">Blocked</option>}
        </select>
        <span className="field-hint">The report uses the newest Active template of the location.</span>
      </div>

      <div className="full-width-field">
        <label htmlFor="mb-template-description">Description</label>
        <textarea
          id="mb-template-description"
          rows="2"
          value={form.description}
          onChange={(event) => setField('description', event.target.value)}
          placeholder="Optional description"
          disabled={busy}
        />
      </div>

      {reportNote && (
        <AlertMessage tone={reportNote.tone} message={reportNote.message} className="full-width-field" />
      )}

      {!isEdit && (
        <div className="full-width-field">
          <span className="field-label" id={startGroupId}>
            Start with
          </span>
          <div className="choice-row" role="radiogroup" aria-labelledby={startGroupId}>
            {START_OPTIONS.map((option) => {
              const needsColumns = option.value !== 'empty'
              const disabled = busy || (needsColumns && !canAddColumns)
              return (
                <label
                  key={option.value}
                  className={`choice-option ${form.start === option.value ? 'is-selected' : ''} ${
                    disabled ? 'is-disabled' : ''
                  }`.trim()}
                >
                  <input
                    type="radio"
                    name="mb-template-start"
                    value={option.value}
                    checked={form.start === option.value}
                    onChange={() => setField('start', option.value)}
                    disabled={disabled}
                  />
                  <span className="choice-option-text">
                    <strong>{option.label}</strong>
                    <span>{option.description}</span>
                  </span>
                </label>
              )
            })}
          </div>
          {!canAddColumns && (
            <span className="field-hint">
              Adding columns requires the Edit Material Balance Template permission.
            </span>
          )}
        </div>
      )}

      {!isEdit && form.start === 'copy' && (
        <div className="full-width-field">
          <label htmlFor="mb-template-copy">Template to copy</label>
          <select
            id="mb-template-copy"
            value={form.copyFromId}
            onChange={(event) => setField('copyFromId', event.target.value)}
            disabled={busy}
            aria-invalid={errors.copyFromId ? 'true' : undefined}
            className={errors.copyFromId ? 'input-error' : ''}
          >
            <option value="">Select a template</option>
            {copySources.map((template) => (
              <option key={template.id} value={template.id}>
                {template.templateName} ({template.locationCode}) – {(template.columns || []).length} columns
              </option>
            ))}
          </select>
          {errors.copyFromId && <span className="field-error">{errors.copyFromId}</span>}
          {copySource && form.locationCode && !sameLocation(copySource.locationCode, form.locationCode) && (
            <span className="field-hint">
              The source belongs to {copySource.locationCode}. Its movement columns keep their Tank Operation codes –
              check them against the operations of {form.locationCode} after copying.
            </span>
          )}
          {copySources.length === 0 && (
            <span className="field-hint">No template with columns is available to copy yet.</span>
          )}
        </div>
      )}
    </FormDialog>
  )
}

export default TemplateFormDialog
