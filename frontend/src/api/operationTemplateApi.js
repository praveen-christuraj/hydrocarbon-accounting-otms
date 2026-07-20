import { apiDelete, apiGet, apiPost, apiPut } from './apiClient'

const convertFieldFromApi = (field) => {
  return {
    id: field.id,
    fieldName: field.field_name || '',
    fieldCode: field.field_code || '',
    fieldGroup: field.field_group || '',
    dataType: field.data_type || 'Text',
    unit: field.unit || '',
    isRequired: field.is_required || 'No',
    inputMode: field.input_mode || 'Manual',
    calculationRole: field.calculation_role || 'Input',
    sortOrder: field.sort_order || 1,
    status: field.status || 'Active',
  }
}

const convertTemplateFromApi = (template) => {
  return {
    id: template.id,
    templateName: template.template_name || '',
    operationTypeCode: template.operation_type_code || '',
    operationTypeName: template.operation_type_name || '',
    entryLayoutType: template.entry_layout_type || 'Standard Form',
    calculationEngine: template.calculation_engine || 'None',
    description: template.description || '',
    status: template.status || 'Active',
    createdAt: template.created_at,
    updatedAt: template.updated_at,
    fields: (template.fields || []).map(convertFieldFromApi),
  }
}

const convertFieldToApi = (field, index) => {
  return {
    field_name: String(field.fieldName || '').trim(),
    field_code: String(field.fieldCode || '').trim(),
    field_group: String(field.fieldGroup || 'General').trim(),
    data_type: field.dataType || 'Text',
    unit: field.unit ? String(field.unit).trim() : null,
    is_required: field.isRequired || 'No',
    input_mode: field.inputMode || 'Manual',
    calculation_role: field.calculationRole || 'Input',
    sort_order: Number(field.sortOrder || index + 1),
    status: field.status || 'Active',
  }
}

const convertTemplateToApi = (template) => {
  return {
    template_name: String(template.templateName || '').trim(),
    operation_type_code: String(template.operationTypeCode || '').trim(),
    entry_layout_type: template.entryLayoutType || 'Standard Form',
    calculation_engine: template.calculationEngine || 'None',
    description: template.description
      ? String(template.description).trim()
      : null,
    status: template.status || 'Active',
    fields: (template.fields || []).map(convertFieldToApi),
  }
}

export const getOperationTemplates = async () => {
  const data = await apiGet('/operation-templates')
  return data.map(convertTemplateFromApi)
}

export const createOperationTemplate = async (template) => {
  const data = await apiPost(
    '/operation-templates',
    convertTemplateToApi(template)
  )

  return convertTemplateFromApi(data)
}

export const updateOperationTemplate = async (templateId, template) => {
  const data = await apiPut(
    `/operation-templates/${templateId}`,
    convertTemplateToApi(template)
  )

  return convertTemplateFromApi(data)
}

export const deleteOperationTemplate = async (templateId) => {
  return apiDelete(`/operation-templates/${templateId}`)
}

const normalizeLayoutSectionFromApi = (section) => {
  return {
    id: section.id,
    layoutId: section.layout_id ?? section.layoutId,
    sectionKey: section.section_key ?? section.sectionKey ?? '',
    title: section.title || '',
    sortOrder: section.sort_order ?? section.sortOrder ?? 1,
    collapsible: section.collapsible || 'No',
    defaultOpen: section.default_open ?? section.defaultOpen ?? 'Yes',
    visibilityRuleJson:
      section.visibility_rule_json ?? section.visibilityRuleJson ?? null,
  }
}

const normalizeLayoutItemFromApi = (item) => {
  return {
    id: item.id,
    layoutId: item.layout_id ?? item.layoutId,
    sectionId: item.section_id ?? item.sectionId,
    fieldId: item.field_id ?? item.fieldId,
    rowNo: item.row_no ?? item.rowNo ?? 1,
    colStart: item.col_start ?? item.colStart ?? 1,
    colSpan: item.col_span ?? item.colSpan ?? 1,
    sortOrder: item.sort_order ?? item.sortOrder ?? 1,
    labelOverride: item.label_override ?? item.labelOverride ?? '',
    placeholderOverride:
      item.placeholder_override ?? item.placeholderOverride ?? '',
    readOnlyOverride: item.read_only_override ?? item.readOnlyOverride ?? '',
    widthMode: item.width_mode ?? item.widthMode ?? '',
    ruleJson: item.rule_json ?? item.ruleJson ?? null,
  }
}

const normalizeLayoutFromApi = (layout) => {
  return {
    id: layout.id,
    templateId: layout.template_id ?? layout.templateId,
    layoutName: layout.layout_name ?? layout.layoutName ?? '',
    versionNo: layout.version_no ?? layout.versionNo ?? 1,
    status: layout.status || 'Draft',
    isDefault: layout.is_default ?? layout.isDefault ?? 'No',
    createdAt: layout.created_at ?? layout.createdAt,
    updatedAt: layout.updated_at ?? layout.updatedAt,
    sections: (layout.sections || []).map(normalizeLayoutSectionFromApi),
    items: (layout.items || []).map(normalizeLayoutItemFromApi),
  }
}

const toLayoutSectionApi = (section, index) => {
  return {
    section_key: String(section.sectionKey || '').trim(),
    title: String(section.title || '').trim(),
    sort_order: Number(section.sortOrder || index + 1),
    collapsible: section.collapsible || 'No',
    default_open: section.defaultOpen || 'Yes',
    visibility_rule_json: section.visibilityRuleJson || null,
  }
}

const toLayoutItemApi = (item, index) => {
  return {
    section_id: Number(item.sectionId),
    field_id: Number(item.fieldId),
    row_no: Number(item.rowNo || 1),
    col_start: Number(item.colStart || 1),
    col_span: Number(item.colSpan || 1),
    sort_order: Number(item.sortOrder || index + 1),
    label_override: item.labelOverride
      ? String(item.labelOverride).trim()
      : null,
    placeholder_override: item.placeholderOverride
      ? String(item.placeholderOverride).trim()
      : null,
    read_only_override: item.readOnlyOverride
      ? String(item.readOnlyOverride).trim()
      : null,
    width_mode: item.widthMode ? String(item.widthMode).trim() : null,
    rule_json: item.ruleJson || null,
  }
}

const toLayoutApi = (layout) => {
  return {
    layout_name: String(layout.layoutName || '').trim(),
    version_no: Number(layout.versionNo || 1),
    status: layout.status || 'Draft',
    is_default: layout.isDefault || 'No',
    sections: (layout.sections || []).map(toLayoutSectionApi),
    items: (layout.items || []).map(toLayoutItemApi),
  }
}

export const getOperationTemplateLayouts = async (templateId) => {
  const data = await apiGet(`/operation-templates/${templateId}/layouts`)
  return (data || []).map(normalizeLayoutFromApi)
}

export const getOperationTemplateLayout = async (layoutId) => {
  const data = await apiGet(`/operation-template-layouts/${layoutId}`)
  return normalizeLayoutFromApi(data)
}

export const createOperationTemplateLayout = async (templateId, layout) => {
  const data = await apiPost(
    `/operation-templates/${templateId}/layouts`,
    toLayoutApi(layout)
  )
  return normalizeLayoutFromApi(data)
}

export const updateOperationTemplateLayout = async (layoutId, layout) => {
  const data = await apiPut(`/operation-template-layouts/${layoutId}`, {
    layout_name: String(layout.layoutName || '').trim(),
    status: layout.status || 'Draft',
    is_default: layout.isDefault || 'No',
    sections: (layout.sections || []).map(toLayoutSectionApi),
    items: (layout.items || []).map(toLayoutItemApi),
  })
  return normalizeLayoutFromApi(data)
}
