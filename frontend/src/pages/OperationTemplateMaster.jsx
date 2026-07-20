import { useEffect, useMemo, useState } from 'react'
import {
  createOperationTemplate,
  createOperationTemplateLayout,
  deleteOperationTemplate,
  getOperationTemplateLayout,
  getOperationTemplateLayouts,
  updateOperationTemplateLayout,
  updateOperationTemplate,
} from '../api/operationTemplateApi'

function OperationTemplateMaster({
  operationTypes,
  operationTemplates,
  reloadOperationTemplates,
  loggedInUser,
}) {
  const isAdminBootstrap =
    String(loggedInUser?.username || '').toLowerCase() === 'admin'

  const hasPermission = (permissionName) =>
    Boolean(
      loggedInUser?.permissions?.some(
        (p) => p.permissionName === permissionName
      )
    )

  const canManageOperationTemplate = useMemo(() => {
    if (isAdminBootstrap) return true
    return hasPermission('Manage Operation Template')
  }, [loggedInUser])
  const emptyTemplate = {
    templateName: '',
    operationTypeCode: '',
    entryLayoutType: 'Standard Form',
    calculationEngine: 'None',
    description: '',
    status: 'Active',
    fields: [],
  }

  const emptyField = {
    fieldName: '',
    fieldCode: '',
    fieldGroup: 'General',
    dataType: '',
    unit: '',
    isRequired: 'Yes',
    inputMode: 'Manual',
    calculationRole: 'Input',
    sortOrder: '',
    status: 'Active',
  }

  const [template, setTemplate] = useState(emptyTemplate)
  const [field, setField] = useState(emptyField)
  const [editId, setEditId] = useState(null)
  const [loading, setLoading] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [layoutLoading, setLayoutLoading] = useState(false)
  const [layouts, setLayouts] = useState([])
  const [selectedLayoutId, setSelectedLayoutId] = useState('')
  const [successMsg, setSuccessMsg] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [confirmRemoveField, setConfirmRemoveField] = useState(null)
  const [confirmDeleteTemplate, setConfirmDeleteTemplate] = useState(null)
  const [draggingSectionId, setDraggingSectionId] = useState('')
  const [draggingItemId, setDraggingItemId] = useState('')
  const [layoutDraft, setLayoutDraft] = useState({
    layoutName: '',
    versionNo: 1,
    status: 'Draft',
    isDefault: 'No',
    sections: [],
    items: [],
  })

  const activeOperationTypes = operationTypes.filter(
    (item) => item.status === 'Active'
  )

  const fieldOptions = useMemo(() => {
    return [...(template.fields || [])].sort(
      (a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0)
    )
  }, [template.fields])

  const layoutPreviewSections = useMemo(() => {
    if (!layoutDraft.sections.length || !layoutDraft.items.length) return []

    const fieldById = new Map(fieldOptions.map((f) => [Number(f.id), f]))
    const itemsBySectionRef = new Map()

    layoutDraft.items.forEach((item) => {
      const sectionRef = item.sectionRef || ''
      if (!itemsBySectionRef.has(sectionRef)) {
        itemsBySectionRef.set(sectionRef, [])
      }
      itemsBySectionRef.get(sectionRef).push(item)
    })

    return [...layoutDraft.sections]
      .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0))
      .map((section) => {
        const items = (itemsBySectionRef.get(section.localId) || [])
          .map((item) => {
            const sourceField = fieldById.get(Number(item.fieldId))
            return {
              ...item,
              rowNo: Number(item.rowNo || 1),
              colStart: Number(item.colStart || 1),
              colSpan: Number(item.colSpan || 1),
              sortOrder: Number(item.sortOrder || 1),
              label:
                String(item.labelOverride || '').trim() ||
                sourceField?.fieldName ||
                'Unmapped Field',
              code: sourceField?.fieldCode || '',
            }
          })
          .sort((a, b) => {
            if (a.rowNo !== b.rowNo) return a.rowNo - b.rowNo
            if (a.colStart !== b.colStart) return a.colStart - b.colStart
            return a.sortOrder - b.sortOrder
          })

        const rowsMap = new Map()
        items.forEach((item) => {
          if (!rowsMap.has(item.rowNo)) rowsMap.set(item.rowNo, [])
          rowsMap.get(item.rowNo).push(item)
        })
        const rows = [...rowsMap.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([rowNo, rowItems]) => ({
            rowNo,
            items: [...rowItems].sort((a, b) => a.colStart - b.colStart),
          }))

        return {
          ...section,
          items,
          rows,
        }
      })
  }, [layoutDraft.sections, layoutDraft.items, fieldOptions])

  const handleTemplateChange = (e) => {
    setTemplate({
      ...template,
      [e.target.name]: e.target.value,
    })
  }

  const handleFieldChange = (e) => {
    setField({
      ...field,
      [e.target.name]: e.target.value,
    })
  }

  const handleAddField = () => {
    if (!canManageOperationTemplate) {
      setErrorMsg('You do not have permission to manage operation templates')
      return
    }
    if (field.fieldName.trim() === '') {
      setErrorMsg('Field Name is required')
      return
    }

    if (field.fieldCode.trim() === '') {
      setErrorMsg('Field Code is required')
      return
    }

    if (field.dataType.trim() === '') {
      setErrorMsg('Data Type is required')
      return
    }

    const duplicateFieldCode = template.fields.some((item) => {
      return item.fieldCode.toLowerCase() === field.fieldCode.toLowerCase()
    })

    if (duplicateFieldCode) {
      setErrorMsg('Field Code already exists in this template.')
      return
    }

    const duplicateFieldName = template.fields.some((item) => {
      return item.fieldName.toLowerCase() === field.fieldName.toLowerCase()
    })

    if (duplicateFieldName) {
      setErrorMsg('Field Name already exists in this template.')
      return
    }

    const newField = {
      ...field,
      sortOrder:
        field.sortOrder.trim() === ''
          ? String(template.fields.length + 1)
          : field.sortOrder,
    }

    setTemplate({
      ...template,
      fields: [...template.fields, newField],
    })

    setField(emptyField)
  }

  const handleRemoveField = (indexToRemove) => {
    setConfirmRemoveField(indexToRemove)
  }

  const confirmRemoveFieldAction = () => {
    if (!canManageOperationTemplate) {
      setErrorMsg('You do not have permission to manage operation templates')
      setConfirmRemoveField(null)
      return
    }
    if (confirmRemoveField === null) return
    setTemplate({
      ...template,
      fields: template.fields.filter((item, index) => index !== confirmRemoveField),
    })
    setConfirmRemoveField(null)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()

    if (!canManageOperationTemplate) {
      setErrorMsg('You do not have permission to manage operation templates')
      return
    }

    if (template.templateName.trim() === '') {
      setErrorMsg('Template Name is required')
      return
    }

    if (template.operationTypeCode.trim() === '') {
      setErrorMsg('Operation Type is required')
      return
    }

    if (template.fields.length === 0) {
      setErrorMsg('Please add at least one operation template field')
      return
    }

    const duplicateTemplate = operationTemplates.some((item) => {
      return (
        item.templateName.toLowerCase() === template.templateName.toLowerCase() &&
        item.id !== editId
      )
    })

    if (duplicateTemplate) {
      setErrorMsg('Operation Template Name already exists.')
      return
    }

    try {
      setLoading(true)

      if (editId === null) {
        await createOperationTemplate(template)
        setSuccessMsg('Operation Template saved successfully')
      } else {
        await updateOperationTemplate(editId, template)
        setSuccessMsg('Operation Template updated successfully')
      }

      await reloadOperationTemplates()
      setTemplate(emptyTemplate)
      setField(emptyField)
      setEditId(null)
    } catch (error) {
      setErrorMsg(error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleEdit = (templateToEdit) => {
    setTemplate({
      templateName: templateToEdit.templateName,
      operationTypeCode: templateToEdit.operationTypeCode,
      entryLayoutType: templateToEdit.entryLayoutType || 'Standard Form',
      calculationEngine: templateToEdit.calculationEngine || 'None',
      description: templateToEdit.description,
      status: templateToEdit.status,
      fields: templateToEdit.fields,
    })

    setField(emptyField)
    setEditId(templateToEdit.id)
  }

  const handleDelete = async (templateId) => {
    setConfirmDeleteTemplate(templateId)
  }

  const confirmDeleteTemplateAction = async () => {
    const templateId = confirmDeleteTemplate
    setConfirmDeleteTemplate(null)
    if (!canManageOperationTemplate) {
      setErrorMsg('You do not have permission to manage operation templates')
      return
    }
    if (!templateId) return

    try {
      setLoading(true)

      await deleteOperationTemplate(templateId)
      await reloadOperationTemplates()

      if (editId === templateId) {
        setTemplate(emptyTemplate)
        setField(emptyField)
        setEditId(null)
        setLayouts([])
        setSelectedLayoutId('')
      }

      setSuccessMsg('Operation Template deleted successfully')
    } catch (error) {
      setErrorMsg(error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleCancelEdit = () => {
    setTemplate(emptyTemplate)
    setField(emptyField)
    setEditId(null)
    setLayouts([])
    setSelectedLayoutId('')
    setLayoutDraft({
      layoutName: '',
      versionNo: 1,
      status: 'Draft',
      isDefault: 'No',
      sections: [],
      items: [],
    })
  }

  const buildDefaultLayoutDraft = () => {
    const sections = [
      {
        localId: `sec-${Date.now()}`,
        id: null,
        sectionKey: 'main',
        title: 'Main Section',
        sortOrder: 1,
        collapsible: 'No',
        defaultOpen: 'Yes',
      },
    ]

    const items = fieldOptions.map((f, index) => ({
      localId: `item-${f.fieldCode}-${index}`,
      id: null,
      fieldId: f.id,
      sectionRef: sections[0].localId,
      rowNo: Math.floor(index / 2) + 1,
      colStart: (index % 2) + 1,
      colSpan: 1,
      sortOrder: index + 1,
      labelOverride: '',
      placeholderOverride: '',
    }))

    return {
      layoutName: `${template.templateName || 'Template'} Layout`,
      versionNo: 1,
      status: 'Draft',
      isDefault: 'No',
      sections,
      items,
    }
  }

  const loadTemplateLayouts = async (templateId) => {
    if (!templateId) return
    setLayoutLoading(true)
    try {
      const data = await getOperationTemplateLayouts(templateId)
      setLayouts(data)
    } catch (error) {
      setErrorMsg(error.message)
    } finally {
      setLayoutLoading(false)
    }
  }

  useEffect(() => {
    if (editId) {
      loadTemplateLayouts(editId)
    }
  }, [editId])

  const handleInitializeLayoutDraft = () => {
    if (fieldOptions.length === 0) {
      setErrorMsg('Please add fields before configuring layout.')
      return
    }
    setSelectedLayoutId('')
    setLayoutDraft(buildDefaultLayoutDraft())
  }

  const handleLoadLayout = async (layoutId) => {
    if (!layoutId) return
    setLayoutLoading(true)
    try {
      const loaded = await getOperationTemplateLayout(Number(layoutId))
      setSelectedLayoutId(String(loaded.id))
      const sectionMap = new Map()
      const sections = (loaded.sections || []).map((s, index) => {
        const localId = `sec-existing-${s.id || index}`
        sectionMap.set(s.id, localId)
        return {
          localId,
          id: s.id,
          sectionKey: s.sectionKey,
          title: s.title,
          sortOrder: s.sortOrder,
          collapsible: s.collapsible,
          defaultOpen: s.defaultOpen,
        }
      })

      const items = (loaded.items || []).map((i, index) => ({
        localId: `item-existing-${i.id || index}`,
        id: i.id,
        fieldId: i.fieldId,
        sectionRef: sectionMap.get(i.sectionId) || '',
        rowNo: i.rowNo,
        colStart: i.colStart,
        colSpan: i.colSpan,
        sortOrder: i.sortOrder,
        labelOverride: i.labelOverride || '',
        placeholderOverride: i.placeholderOverride || '',
      }))

      setLayoutDraft({
        layoutName: loaded.layoutName,
        versionNo: loaded.versionNo,
        status: loaded.status,
        isDefault: loaded.isDefault,
        sections,
        items,
      })
    } catch (error) {
      setErrorMsg(error.message)
    } finally {
      setLayoutLoading(false)
    }
  }

  const handleLayoutHeaderChange = (e) => {
    setLayoutDraft((prev) => ({ ...prev, [e.target.name]: e.target.value }))
  }

  const handleSectionChange = (localId, name, value) => {
    setLayoutDraft((prev) => ({
      ...prev,
      sections: prev.sections.map((section) =>
        section.localId === localId ? { ...section, [name]: value } : section
      ),
    }))
  }

  const handleAddSection = () => {
    setLayoutDraft((prev) => ({
      ...prev,
      sections: [
        ...prev.sections,
        {
          localId: `sec-${Date.now()}-${prev.sections.length + 1}`,
          id: null,
          sectionKey: `section_${prev.sections.length + 1}`,
          title: `Section ${prev.sections.length + 1}`,
          sortOrder: prev.sections.length + 1,
          collapsible: 'No',
          defaultOpen: 'Yes',
        },
      ],
    }))
  }

  const handleRemoveSection = (localId) => {
    const inUse = layoutDraft.items.some((item) => item.sectionRef === localId)
    if (inUse) {
      setErrorMsg('Cannot remove a section that still contains fields.')
      return
    }
    setLayoutDraft((prev) => ({
      ...prev,
      sections: prev.sections.filter((s) => s.localId !== localId),
    }))
  }

  const handleItemChange = (localId, name, value) => {
    setLayoutDraft((prev) => ({
      ...prev,
      items: prev.items.map((item) =>
        item.localId === localId ? { ...item, [name]: value } : item
      ),
    }))
  }

  const handleSectionDragStart = (localId) => {
    setDraggingSectionId(localId)
  }

  const handleSectionDrop = (targetLocalId) => {
    if (!draggingSectionId || draggingSectionId === targetLocalId) return
    setLayoutDraft((prev) => {
      const nextSections = [...prev.sections]
      const fromIndex = nextSections.findIndex((s) => s.localId === draggingSectionId)
      const toIndex = nextSections.findIndex((s) => s.localId === targetLocalId)
      if (fromIndex < 0 || toIndex < 0) return prev
      const [moved] = nextSections.splice(fromIndex, 1)
      nextSections.splice(toIndex, 0, moved)
      return {
        ...prev,
        sections: nextSections.map((section, index) => ({
          ...section,
          sortOrder: index + 1,
        })),
      }
    })
    setDraggingSectionId('')
  }

  const handleItemDragStart = (localId) => {
    setDraggingItemId(localId)
  }

  const handleItemDrop = (targetLocalId) => {
    if (!draggingItemId || draggingItemId === targetLocalId) return
    setLayoutDraft((prev) => {
      const nextItems = [...prev.items]
      const fromIndex = nextItems.findIndex((i) => i.localId === draggingItemId)
      const toIndex = nextItems.findIndex((i) => i.localId === targetLocalId)
      if (fromIndex < 0 || toIndex < 0) return prev
      const [moved] = nextItems.splice(fromIndex, 1)
      nextItems.splice(toIndex, 0, moved)
      return {
        ...prev,
        items: nextItems.map((item, index) => ({
          ...item,
          sortOrder: index + 1,
        })),
      }
    })
    setDraggingItemId('')
  }

  const handleLayoutSave = async () => {
    if (!canManageOperationTemplate) {
      setErrorMsg('You do not have permission to manage operation templates')
      return
    }
    if (!editId) {
      setErrorMsg('Save the template first, then configure layout.')
      return
    }
    if (String(layoutDraft.layoutName || '').trim() === '') {
      setErrorMsg('Layout Name is required.')
      return
    }
    if (layoutDraft.sections.length === 0) {
      setErrorMsg('At least one section is required.')
      return
    }
    if (layoutDraft.items.length === 0) {
      setErrorMsg('At least one layout item is required.')
      return
    }

    const sectionPayload = layoutDraft.sections.map((section, index) => ({
      sectionKey: section.sectionKey,
      title: section.title,
      sortOrder: Number(section.sortOrder || index + 1),
      collapsible: section.collapsible || 'No',
      defaultOpen: section.defaultOpen || 'Yes',
    }))

    const sectionIdByLocalRef = {}
    layoutDraft.sections.forEach((section, index) => {
      sectionIdByLocalRef[section.localId] = index + 1
    })

    const itemPayload = layoutDraft.items.map((item, index) => ({
      sectionId: sectionIdByLocalRef[item.sectionRef],
      fieldId: Number(item.fieldId),
      rowNo: Number(item.rowNo || 1),
      colStart: Number(item.colStart || 1),
      colSpan: Number(item.colSpan || 1),
      sortOrder: Number(item.sortOrder || index + 1),
      labelOverride: item.labelOverride || null,
      placeholderOverride: item.placeholderOverride || null,
    }))

    if (itemPayload.some((item) => Number.isNaN(item.fieldId))) {
      setErrorMsg('All layout items must have a valid field.')
      return
    }
    if (itemPayload.some((item) => !item.sectionId)) {
      setErrorMsg('Each layout item must be mapped to a valid section.')
      return
    }

    const seenFields = new Set()
    const occupied = new Set()
    for (const item of itemPayload) {
      if (seenFields.has(item.fieldId)) {
        setErrorMsg('Each field can be placed only once in a layout.')
        return
      }
      seenFields.add(item.fieldId)

      if (item.colStart <= 0 || item.colSpan <= 0 || item.rowNo <= 0) {
        setErrorMsg('Row, column and span values must be greater than 0.')
        return
      }
      if (item.colStart + item.colSpan - 1 > 3) {
        setErrorMsg('Layout grid supports maximum 3 columns.')
        return
      }

      for (let col = item.colStart; col < item.colStart + item.colSpan; col += 1) {
        const key = `${item.sectionId}|${item.rowNo}|${col}`
        if (occupied.has(key)) {
          setErrorMsg('Overlapping cells detected in the same section row.')
          return
        }
        occupied.add(key)
      }
    }

    setLayoutLoading(true)
    try {
      if (selectedLayoutId) {
        await updateOperationTemplateLayout(Number(selectedLayoutId), {
          layoutName: layoutDraft.layoutName,
          status: layoutDraft.status,
          isDefault: layoutDraft.isDefault,
          sections: sectionPayload,
          items: itemPayload,
        })
        setSuccessMsg('Layout updated successfully')
      } else {
        await createOperationTemplateLayout(editId, {
          layoutName: layoutDraft.layoutName,
          versionNo: Number(layoutDraft.versionNo || 1),
          status: layoutDraft.status,
          isDefault: layoutDraft.isDefault,
          sections: sectionPayload,
          items: itemPayload,
        })
        setSuccessMsg('Layout created successfully')
      }

      await loadTemplateLayouts(editId)
    } catch (error) {
      setErrorMsg(error.message)
    } finally {
      setLayoutLoading(false)
    }
  }

  const getOperationTypeName = (operationTypeCode) => {
    const operationType = operationTypes.find(
      (item) => item.operationTypeCode === operationTypeCode
    )

    if (!operationType) {
      return ''
    }

    return operationType.operationTypeName
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
      {confirmRemoveField !== null && (
        <div className="confirm-overlay">
          <div className="confirm-dialog">
            <p>Are you sure you want to remove this field?</p>
            <div className="confirm-actions">
              <button onClick={confirmRemoveFieldAction}>Yes</button>
              <button onClick={() => setConfirmRemoveField(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
      {confirmDeleteTemplate && (
        <div className="confirm-overlay">
          <div className="confirm-dialog">
            <p>Are you sure you want to delete this operation template?</p>
            <div className="confirm-actions">
              <button onClick={confirmDeleteTemplateAction}>Yes</button>
              <button onClick={() => setConfirmDeleteTemplate(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
      <div className="page-title">
        <div>
          <div className="title-with-help">
            <h2>Operation Template Master</h2>

            <button
              type="button"
              className="help-icon-button"
              onClick={() => setShowHelp(true)}
              title="Help"
            >
              ?
            </button>
          </div>

          <p>
            Define data-entry fields, input modes, and calculation roles for
            each operation type.
          </p>
        </div>

        <span className="record-count">
          {operationTemplates.length} Templates
        </span>
      </div>

      {showHelp && (
        <div className="help-modal-overlay">
          <div className="help-modal">
            <div className="help-modal-header">
              <h3>Operation Template Help</h3>

              <button
                type="button"
                className="help-close-button"
                onClick={() => setShowHelp(false)}
              >
                ×
              </button>
            </div>

            <div className="help-modal-body">
              <p>
                Operation Templates define what fields appear in operation data
                entry screens. This allows Tank, Barge, Vessel, FSO, and
                Flowmeter operations to have different field structures.
              </p>

              <div className="help-section">
                <h4>Input Mode</h4>
                <ul>
                  <li>
                    <strong>Manual:</strong> User enters the value.
                  </li>
                  <li>
                    <strong>Calculated:</strong> System calculates the value.
                  </li>
                  <li>
                    <strong>Lookup:</strong> System picks value from another
                    table, such as calibration data.
                  </li>
                  <li>
                    <strong>System:</strong> System generated value, such as
                    ticket number or timestamp.
                  </li>
                </ul>
              </div>

              <div className="help-section">
                <h4>Calculation Role</h4>
                <ul>
                  <li>
                    <strong>Input:</strong> Field used as calculation input.
                  </li>
                  <li>
                    <strong>Output:</strong> Final calculated result.
                  </li>
                  <li>
                    <strong>Correction:</strong> Adjustment or correction value.
                  </li>
                  <li>
                    <strong>Comparison:</strong> Sender/receiver comparison
                    value.
                  </li>
                  <li>
                    <strong>Reference:</strong> Informational field.
                  </li>
                  <li>
                    <strong>Approval:</strong> Approval-related field.
                  </li>
                </ul>
              </div>

              <div className="help-section">
                <h4>Example Tank Fields</h4>
                <table>
                  <thead>
                    <tr>
                      <th>Field Name</th>
                      <th>Input Mode</th>
                      <th>Role</th>
                    </tr>
                  </thead>

                  <tbody>
                    <tr>
                      <td>Opening Ullage</td>
                      <td>Manual</td>
                      <td>Input</td>
                    </tr>
                    <tr>
                      <td>Opening Volume</td>
                      <td>Lookup</td>
                      <td>Output</td>
                    </tr>
                    <tr>
                      <td>Gross Quantity</td>
                      <td>Calculated</td>
                      <td>Output</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeOperationTypes.length === 0 && (
        <div className="info-box">
          Please create at least one active Operation Type before creating
          operation templates.
        </div>
      )}

      {!canManageOperationTemplate && (
        <div className="info-box">
          You have view-only access. Assign <strong>Manage Operation Template</strong> to create, edit, or delete operation templates and layouts.
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div>
          <label>Template Name</label>
          <input
            name="templateName"
            type="text"
            value={template.templateName}
            onChange={handleTemplateChange}
            placeholder="Example: Tank Operation Template"
            disabled={!canManageOperationTemplate}
          />
        </div>

        <div>
          <label>Operation Type</label>
          <select
            name="operationTypeCode"
            value={template.operationTypeCode}
            onChange={handleTemplateChange}
            disabled={!canManageOperationTemplate}
          >
            <option value="">Select Operation Type</option>

            {activeOperationTypes.map((operationType) => (
              <option
                key={operationType.id}
                value={operationType.operationTypeCode}
              >
                {operationType.operationTypeName} (
                {operationType.operationTypeCode})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label>Entry Layout Type</label>
          <select
            name="entryLayoutType"
            value={template.entryLayoutType}
            onChange={handleTemplateChange}
            disabled={!canManageOperationTemplate}
          >
            <option>Standard Form</option>
            <option>Tank Gauging</option>
            <option>Multi-Tank Before/After</option>
            <option>Tanker Loading</option>
            <option>Vessel Cycle</option>
            <option>Shuttle Tracking</option> {/* ✅ NEW */}
            <option>FSO Tracking</option> {/* ✅ NEW */}
            <option>Stock Movement</option>
            <option>Meter Reading</option>
          </select>
        </div>

        <div>
          <label>Calculation Engine</label>
          <select
            name="calculationEngine"
            value={template.calculationEngine}
            onChange={handleTemplateChange}
            disabled={!canManageOperationTemplate}
          >
            <option>None</option>
            <option>Tank Quantity</option>
            <option>Barge Before/After Quantity</option>
            <option>Tanker Quantity</option>
            <option>Vessel Cycle Quantity</option>
            <option>Stock Movement Net/Variance</option>
            <option>Meter Reading Quantity</option>
          </select>
        </div>

        <div>
          <label>Status</label>
          <select
            name="status"
            value={template.status}
            onChange={handleTemplateChange}
            disabled={!canManageOperationTemplate}
          >
            <option>Active</option>
            <option>Inactive</option>
            <option>Blocked</option>
          </select>
        </div>

        <div className="full-width-field">
          <label>Description</label>
          <textarea
            name="description"
            value={template.description}
            onChange={handleTemplateChange}
            placeholder="Enter template description"
            rows="3"
            disabled={!canManageOperationTemplate}
          />
        </div>

        <div className="full-width-field">
          <div className="section-title compact-section-title">
            <h3>Field Definition</h3>
            <p>
              Add the fields that should appear in the operation data entry
              screen.
            </p>
          </div>
        </div>

        <div>
          <label>Field Name</label>
          <input
            name="fieldName"
            type="text"
            value={field.fieldName}
            onChange={handleFieldChange}
            placeholder="Example: Opening Ullage"
            disabled={!canManageOperationTemplate}
          />
        </div>

        <div>
          <label>Field Code</label>
          <input
            name="fieldCode"
            type="text"
            value={field.fieldCode}
            onChange={handleFieldChange}
            placeholder="Example: opening_ullage"
            disabled={!canManageOperationTemplate}
          />
        </div>

        <div>
          <label>Field Group</label>
          <select
            name="fieldGroup"
            value={field.fieldGroup}
            onChange={handleFieldChange}
            disabled={!canManageOperationTemplate}
          >
            <option>General</option>
            <option>Sender</option>
            <option>Receiver</option>
            <option>Calculation</option>
            <option>Comparison</option>
            <option>Approval</option>
          </select>
        </div>

        <div>
          <label>Data Type</label>
          <select
            name="dataType"
            value={field.dataType}
            onChange={handleFieldChange}
            disabled={!canManageOperationTemplate}
          >
            <option value="">Select Data Type</option>
            <option>Text</option>
            <option>Number</option>
            <option>Date</option>
            <option>DateTime</option>
            <option>Boolean</option>
            <option>JSON</option>
          </select>
        </div>

        <div>
          <label>Unit</label>
          <input
            name="unit"
            type="text"
            value={field.unit}
            onChange={handleFieldChange}
            placeholder="Example: m, bbl, m3, °C"
            disabled={!canManageOperationTemplate}
          />
        </div>

        <div>
          <label>Required</label>
          <select
            name="isRequired"
            value={field.isRequired}
            onChange={handleFieldChange}
            disabled={!canManageOperationTemplate}
          >
            <option>Yes</option>
            <option>No</option>
          </select>
        </div>

        <div>
          <label>Input Mode</label>
          <select
            name="inputMode"
            value={field.inputMode}
            onChange={handleFieldChange}
            disabled={!canManageOperationTemplate}
          >
            <option>Manual</option>
            <option>Calculated</option>
            <option>Lookup</option>
            <option>System</option>
          </select>
        </div>

        <div>
          <label>Calculation Role</label>
          <select
            name="calculationRole"
            value={field.calculationRole}
            onChange={handleFieldChange}
            disabled={!canManageOperationTemplate}
          >
            <option>Input</option>
            <option>Output</option>
            <option>Correction</option>
            <option>Comparison</option>
            <option>Reference</option>
            <option>Approval</option>
          </select>
        </div>

        <div>
          <label>Sort Order</label>
          <input
            name="sortOrder"
            type="number"
            value={field.sortOrder}
            onChange={handleFieldChange}
            placeholder="Example: 1"
            disabled={!canManageOperationTemplate}
          />
        </div>

        <div>
          <label>Field Status</label>
          <select
            name="status"
            value={field.status}
            onChange={handleFieldChange}
            disabled={!canManageOperationTemplate}
          >
            <option>Active</option>
            <option>Inactive</option>
            <option>Blocked</option>
          </select>
        </div>

        <div className="form-actions">
          <button type="button" onClick={handleAddField} disabled={loading || !canManageOperationTemplate}>
            Add Field
          </button>
        </div>

        <div className="full-width-field">
          <table>
            <thead>
              <tr>
                <th>Field Name</th>
                <th>Code</th>
                <th>Group</th>
                <th>Type</th>
                <th>Unit</th>
                <th>Required</th>
                <th>Input Mode</th>
                <th>Role</th>
                <th>Sort</th>
                <th>Action</th>
              </tr>
            </thead>

            <tbody>
              {template.fields.length === 0 ? (
                <tr>
                  <td colSpan="10" className="empty-table">
                    No fields added yet.
                  </td>
                </tr>
              ) : (
                template.fields.map((item, index) => (
                  <tr key={index}>
                    <td>{item.fieldName}</td>
                    <td>{item.fieldCode}</td>
                    <td>{item.fieldGroup}</td>
                    <td>{item.dataType}</td>
                    <td>{item.unit}</td>
                    <td>{item.isRequired}</td>
                    <td>{item.inputMode}</td>
                    <td>
                      <span className="permission-badge">
                        {item.calculationRole}
                      </span>
                    </td>
                    <td>{item.sortOrder}</td>
                    <td>
                      <button
                        type="button"
                        onClick={() => handleRemoveField(index)}
                        disabled={loading || !canManageOperationTemplate}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="form-actions">
          <button type="submit" disabled={loading || !canManageOperationTemplate}>
            {loading
              ? 'Please wait...'
              : editId === null
                ? 'Save Template'
                : 'Update Template'}
          </button>

          {editId !== null && (
            <button type="button" onClick={handleCancelEdit} disabled={loading}>
              Cancel Edit
            </button>
          )}
        </div>
      </form>

      <div className="section-title">
        <h3>Saved Operation Templates</h3>
        <p>
          These templates will later generate operation data entry screens.
        </p>
      </div>

      <table>
        <thead>
          <tr>
            <th>Template Name</th>
            <th>Operation Type</th>
            <th>Layout</th>
            <th>Engine</th>
            <th>Fields</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>

        <tbody>
          {operationTemplates.length === 0 ? (
            <tr>
              <td colSpan="7" className="empty-table">
                No operation templates added yet.
              </td>
            </tr>
          ) : (
            operationTemplates.map((item) => (
              <tr key={item.id}>
                <td>{item.templateName}</td>
                <td>
                  {getOperationTypeName(item.operationTypeCode)} (
                  {item.operationTypeCode})
                </td>
                <td>{item.entryLayoutType || 'Standard Form'}</td>
                <td>{item.calculationEngine || 'None'}</td>
                <td>
                  <div className="permission-list">
                    {[...item.fields]
                      .sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder))
                      .map((fieldItem) => (
                        <span
                          key={fieldItem.id || fieldItem.fieldCode}
                          className="permission-badge"
                        >
                          {fieldItem.fieldName}
                        </span>
                      ))}
                  </div>
                </td>
                <td>
                  <span className={`status-badge ${item.status.toLowerCase()}`}>
                    {item.status}
                  </span>
                </td>
                <td>
                  <button type="button" onClick={() => handleEdit(item)} disabled={!canManageOperationTemplate}>
                    Edit
                  </button>

                  <button type="button" onClick={() => handleDelete(item.id)} disabled={!canManageOperationTemplate}>
                    Delete
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <div className="info-box">
        Rule: Operation Template fields define the future data entry form.
        Manual fields are entered by users. Lookup and Calculated fields will be
        populated by the calculation engine later.
      </div>

      <div className="section-title">
        <h3>Template Layout Designer</h3>
        <p>
          Configure row/column placement after field creation. This is versioned
          and stored separately from base template fields.
        </p>
      </div>

      {editId === null ? (
        <div className="info-box">
          Open a saved template in Edit mode to manage its entry layout.
        </div>
      ) : (
        <div>
          <div className="form-actions">
            <button
              type="button"
              onClick={handleInitializeLayoutDraft}
              disabled={layoutLoading || !canManageOperationTemplate}
            >
              New Layout Draft
            </button>
          </div>

          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Version</th>
                <th>Status</th>
                <th>Default</th>
                <th>Sections</th>
                <th>Items</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {layouts.length === 0 ? (
                <tr>
                  <td colSpan="7" className="empty-table">
                    No layouts yet for this template.
                  </td>
                </tr>
              ) : (
                layouts.map((layout) => (
                  <tr key={layout.id}>
                    <td>{layout.layoutName}</td>
                    <td>{layout.versionNo}</td>
                    <td>{layout.status}</td>
                    <td>{layout.isDefault}</td>
                    <td>{layout.sections.length}</td>
                    <td>{layout.items.length}</td>
                    <td>
                      <button
                        type="button"
                        onClick={() => handleLoadLayout(layout.id)}
                      >
                        Edit Layout
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          {layoutDraft.sections.length > 0 && (
            <>
              <div className="full-width-field">
                <div className="section-title compact-section-title">
                  <h3>Layout Header</h3>
                  <p>Define metadata and section structure.</p>
                </div>
              </div>

              <form onSubmit={(e) => e.preventDefault()}>
                 <div>
                  <label>Layout Name</label>
                  <input
                    name="layoutName"
                    type="text"
                    value={layoutDraft.layoutName}
                    onChange={handleLayoutHeaderChange}
                    disabled={!canManageOperationTemplate}
                  />
                </div>
                <div>
                  <label>Version No</label>
                  <input
                    name="versionNo"
                    type="number"
                    value={layoutDraft.versionNo}
                    onChange={handleLayoutHeaderChange}
                    disabled={Boolean(selectedLayoutId) || !canManageOperationTemplate}
                  />
                </div>
                <div>
                  <label>Status</label>
                  <select
                    name="status"
                    value={layoutDraft.status}
                    onChange={handleLayoutHeaderChange}
                    disabled={!canManageOperationTemplate}
                  >
                    <option>Draft</option>
                    <option>Active</option>
                    <option>Archived</option>
                  </select>
                </div>
                <div>
                  <label>Default</label>
                  <select
                    name="isDefault"
                    value={layoutDraft.isDefault}
                    onChange={handleLayoutHeaderChange}
                    disabled={!canManageOperationTemplate}
                  >
                    <option>No</option>
                    <option>Yes</option>
                  </select>
                </div>
              </form>

              <div className="form-actions">
                <button type="button" onClick={handleAddSection} disabled={!canManageOperationTemplate}>
                  Add Section
                </button>
              </div>

              <table>
                <thead>
                  <tr>
                    <th>Move</th>
                    <th>Key</th>
                    <th>Title</th>
                    <th>Sort</th>
                    <th>Collapsible</th>
                    <th>Default Open</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {layoutDraft.sections.map((section) => (
                    <tr
                      key={section.localId}
                      draggable
                      onDragStart={() => handleSectionDragStart(section.localId)}
                      onDragEnd={() => setDraggingSectionId('')}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => handleSectionDrop(section.localId)}
                    >
                      <td>
                        <span className="drag-handle" title="Drag to reorder">
                          ::
                        </span>
                      </td>
                      <td>
                        <input
                          type="text"
                          value={section.sectionKey}
                          onChange={(e) =>
                            handleSectionChange(
                              section.localId,
                              'sectionKey',
                              e.target.value
                            )
                          }
                          disabled={!canManageOperationTemplate}
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          value={section.title}
                          onChange={(e) =>
                            handleSectionChange(
                              section.localId,
                              'title',
                              e.target.value
                            )
                          }
                          disabled={!canManageOperationTemplate}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          value={section.sortOrder}
                          onChange={(e) =>
                            handleSectionChange(
                              section.localId,
                              'sortOrder',
                              e.target.value
                            )
                          }
                          disabled={!canManageOperationTemplate}
                        />
                      </td>
                      <td>
                        <select
                          value={section.collapsible}
                          onChange={(e) =>
                            handleSectionChange(
                              section.localId,
                              'collapsible',
                              e.target.value
                            )
                          }
                          disabled={!canManageOperationTemplate}
                        >
                          <option>No</option>
                          <option>Yes</option>
                        </select>
                      </td>
                      <td>
                        <select
                          value={section.defaultOpen}
                          onChange={(e) =>
                            handleSectionChange(
                              section.localId,
                              'defaultOpen',
                              e.target.value
                            )
                          }
                          disabled={!canManageOperationTemplate}
                        >
                          <option>Yes</option>
                          <option>No</option>
                        </select>
                      </td>
                      <td>
                        <button
                          type="button"
                          onClick={() => handleRemoveSection(section.localId)}
                          disabled={!canManageOperationTemplate}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="full-width-field">
                <div className="section-title compact-section-title">
                  <h3>Field Placement</h3>
                  <p>
                    Assign each field to a section and define row/column
                    placement.
                  </p>
                </div>
              </div>

              <table>
                <thead>
                  <tr>
                    <th>Move</th>
                    <th>Field</th>
                    <th>Section</th>
                    <th>Row</th>
                    <th>Col</th>
                    <th>Span</th>
                    <th>Sort</th>
                    <th>Label Override</th>
                    <th>Placeholder</th>
                  </tr>
                </thead>
                <tbody>
                  {layoutDraft.items.map((item) => (
                    <tr
                      key={item.localId}
                      draggable
                      onDragStart={() => handleItemDragStart(item.localId)}
                      onDragEnd={() => setDraggingItemId('')}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => handleItemDrop(item.localId)}
                    >
                      <td>
                        <span className="drag-handle" title="Drag to reorder">
                          ::
                        </span>
                      </td>
                      <td>
                        <select
                          value={item.fieldId || ''}
                          onChange={(e) =>
                            handleItemChange(
                              item.localId,
                              'fieldId',
                              e.target.value
                            )
                          }
                          disabled={!canManageOperationTemplate}
                        >
                          <option value="">Select Field</option>
                          {fieldOptions.map((f) => (
                            <option key={f.id || f.fieldCode} value={f.id}>
                              {f.fieldName}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <select
                          value={item.sectionRef || ''}
                          onChange={(e) =>
                            handleItemChange(
                              item.localId,
                              'sectionRef',
                              e.target.value
                            )
                          }
                          disabled={!canManageOperationTemplate}
                        >
                          <option value="">Select Section</option>
                          {layoutDraft.sections.map((section) => (
                            <option key={section.localId} value={section.localId}>
                              {section.title}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          type="number"
                          min="1"
                          value={item.rowNo}
                          onChange={(e) =>
                            handleItemChange(item.localId, 'rowNo', e.target.value)
                          }
                          disabled={!canManageOperationTemplate}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min="1"
                          max="3"
                          value={item.colStart}
                          onChange={(e) =>
                            handleItemChange(
                              item.localId,
                              'colStart',
                              e.target.value
                            )
                          }
                          disabled={!canManageOperationTemplate}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min="1"
                          max="3"
                          value={item.colSpan}
                          onChange={(e) =>
                            handleItemChange(item.localId, 'colSpan', e.target.value)
                          }
                          disabled={!canManageOperationTemplate}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min="1"
                          value={item.sortOrder}
                          onChange={(e) =>
                            handleItemChange(
                              item.localId,
                              'sortOrder',
                              e.target.value
                            )
                          }
                          disabled={!canManageOperationTemplate}
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          value={item.labelOverride}
                          onChange={(e) =>
                            handleItemChange(
                              item.localId,
                              'labelOverride',
                              e.target.value
                            )
                          }
                          disabled={!canManageOperationTemplate}
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          value={item.placeholderOverride}
                          onChange={(e) =>
                            handleItemChange(
                              item.localId,
                              'placeholderOverride',
                              e.target.value
                            )
                          }
                          disabled={!canManageOperationTemplate}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="full-width-field">
                <div className="section-title compact-section-title">
                  <h3>Layout Preview</h3>
                  <p>
                    Read-only preview of section arrangement and field
                    placement.
                  </p>
                </div>
              </div>

              <div className="layout-preview-wrap">
                {layoutPreviewSections.length === 0 ? (
                  <div className="info-box">
                    Add sections and field placements to generate preview.
                  </div>
                ) : (
                  layoutPreviewSections.map((section) => (
                    <div key={section.localId} className="layout-preview-section">
                      <div className="layout-preview-header">
                        <strong>{section.title || section.sectionKey}</strong>
                        <span className="permission-badge">
                          {section.items.length} Fields
                        </span>
                      </div>

                      {section.rows.length === 0 ? (
                        <div className="layout-preview-empty">
                          No fields mapped to this section.
                        </div>
                      ) : (
                        section.rows.map((row) => (
                          <div key={`${section.localId}-row-${row.rowNo}`}>
                            <div className="layout-preview-row-label">
                              Row {row.rowNo}
                            </div>
                            <div className="layout-preview-grid">
                              {row.items.map((item) => (
                                <div
                                  key={item.localId}
                                  className={`layout-preview-cell span-${Math.min(
                                    Math.max(item.colSpan, 1),
                                    3
                                  )}`}
                                >
                                  <div className="layout-preview-label">
                                    {item.label}
                                  </div>
                                  <div className="layout-preview-meta">
                                    Col {item.colStart} | Span {item.colSpan}
                                    {item.code ? ` | ${item.code}` : ''}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  ))
                )}
              </div>

              <div className="form-actions">
                <button
                  type="button"
                  onClick={handleLayoutSave}
                  disabled={layoutLoading || !canManageOperationTemplate}
                >
                  {layoutLoading
                    ? 'Please wait...'
                    : selectedLayoutId
                      ? 'Update Layout'
                      : 'Save Layout'}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default OperationTemplateMaster
